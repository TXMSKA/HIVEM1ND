import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CoreError, canonicalJson, isUuid, uuidV8 } from './identity.mjs';
import { checkRevision, commitTransaction, readBytes, revisionOf, withLocks } from './store.mjs';
import { contextSession } from './adapters.mjs';
import { contextBootstrap, contextHistory } from './chats.mjs';
import { publishDomainEvents } from './events.mjs';

const unavailable = () => { throw new CoreError(409, 'context_unavailable', 'The native context cannot be verified.'); };
const unknown = () => ({ used: null, capacity: null, unit: 'unknown', percent: null, estimated: false, budgets: null });

// These are native input pressure measurements, never lifetime token billing.
export function contextMeter(value) {
  if (value?.budgets) {
    const limits = { message: 8000, appContext: 12000, history: 16000 };
    if (Object.entries(limits).some(([name, capacity]) => value.budgets[name]?.capacity !== capacity
      || !Number.isSafeInteger(value.budgets[name].used) || value.budgets[name].used < 0 || value.budgets[name].used > capacity)) return unknown();
    return { used: null, capacity: null, unit: 'characters', estimated: true, budgets: structuredClone(value.budgets),
      percent: Math.max(...Object.values(value.budgets).map(budget => budget.used / budget.capacity)) * 100 };
  }
  if (!Number.isSafeInteger(value?.used) || value.used < 0 || !Number.isSafeInteger(value.capacity) || value.capacity <= 0
    || !['tokens', 'characters'].includes(value.unit)) return unknown();
  return { used: value.used, capacity: value.capacity, unit: value.unit, percent: Math.min(100, value.used / value.capacity * 100),
    estimated: value.estimated === true, budgets: null };
}

export function contextNotice(context) {
  return context.percent !== null && context.percent >= 80 && !context.dismissed;
}

export function validateContextSummary(summary) {
  if (typeof summary !== 'string' || !summary.trim() || summary.length > 8000 || Buffer.byteLength(summary) > 32000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(summary)) unavailable();
  return summary;
}

async function owner(context, sessionId, write = false) {
  if (context.principal?.audience !== 'desktop' || context.principal.capabilities
    && !context.principal.capabilities.includes(write ? 'session.start' : 'read')) throw new CoreError(403, 'forbidden', 'Only an authorized desktop may read or renew context.');
  if (!isUuid(sessionId)) throw new CoreError(422, 'invalid_body', 'The session identity must be a UUID.');
  return contextSession(context, sessionId);
}

const directory = (context, sessionId) => path.join(context.paths.localDirectory, 'contexts', sessionId);
const statePath = (context, sessionId) => path.join(directory(context, sessionId), 'context.json');
const bytesOf = value => Buffer.from(`${canonicalJson(value)}\n`);
const entry = (file, before, after) => ({ resource: file, recordPath: file, private: true, beforeRevision: revisionOf(before), afterBytes: bytesOf(after) });
const projected = (value, bytes) => ({ sessionId: value.sessionId, generationId: value.generationId, revision: revisionOf(bytes),
  ...value.meter, dismissed: value.dismissed, operation: value.operation });

async function save(context, file, before, value, extra = []) {
  const after = bytesOf(value);
  await commitTransaction(context.store, { id: randomUUID(), entries: [...extra, entry(file, before, value)], events: [] });
  publishDomainEvents(context, [{ name: 'session.context', unitId: value.unitId,
    data: { sessionId: value.sessionId, revision: revisionOf(after) } }]);
  return projected(value, after);
}

export async function createContext(context, registration, adapter, bootstrap) {
  return withLocks(context.store, [`context:${registration.sessionId}`], async () => {
    const file = statePath(context, registration.sessionId), before = await readBytes(context.store, file);
    if (before) return projected(JSON.parse(before), before);
    const value = { format: 'hivem1nd-context-v1', sessionId: registration.sessionId, unitId: registration.unitId,
      client: registration.client, generationId: randomUUID(), dismissed: false, meter: contextMeter(await adapter.readContext?.(registration)),
      operation: null, bootstrap: bootstrap ?? await contextBootstrap(context, registration.unitId) };
    return save(context, file, null, value);
  });
}

export async function readContext(context, sessionId) {
  const binding = await owner(context, sessionId);
  return withLocks(context.store, [`context:${sessionId}`], async () => {
    const file = statePath(context, sessionId), before = await readBytes(context.store, file);
    if (!before) unavailable();
    let value = JSON.parse(before);
    if (value.operation?.state === 'pending' && !context.store.contextJobs?.has(sessionId)) {
      value = await reconcile(context, binding, value, before);
      return projected(value, await readBytes(context.store, file));
    }
    if (value.operation?.state !== 'pending') {
      const meter = contextMeter(await binding.adapter.readContext?.(binding.registration));
      if (canonicalJson(meter) !== canonicalJson(value.meter)) return save(context, file, before, { ...value, meter });
    }
    return projected(value, before);
  });
}

export const compactContext = (context, sessionId, input) => renew(context, sessionId, 'compact', input);
export const clearContext = (context, sessionId, input) => renew(context, sessionId, 'clear', input);
export const dismissContext = (context, sessionId, input) => renew(context, sessionId, 'dismiss', input);

async function renew(context, sessionId, action, input) {
  const binding = await owner(context, sessionId, true);
  return withLocks(context.store, [`context:${sessionId}`], async () => {
    const file = statePath(context, sessionId), before = await readBytes(context.store, file);
    if (!before) unavailable();
    const value = JSON.parse(before);
    // Retry binds to the original generation and request, including after a lost HTTP receipt.
    if (value.operation?.action === action && (value.expectedRevision === input?.expectedRevision
      || value.operation.state !== 'applied' && revisionOf(before) === input?.expectedRevision)) {
      if (value.operation.state !== 'applied') startJob(context, binding, value);
      return { requestId: value.operation.requestId, state: 'pending', context: projected(value, before) };
    }
    checkRevision(before, input?.expectedRevision);
    if (value.operation?.state === 'pending') throw new CoreError(409, 'context_unavailable', 'The previous context operation is still being reconciled.');
    const requestId = context.receipt ? uuidV8(['context', context.receipt.principalHash, context.receipt.key]) : randomUUID();
    const next = { ...value, expectedRevision: revisionOf(before), operation: { requestId, action, state: 'pending', error: null } };
    const checkpoint = { context: value, native: await binding.adapter.checkpointContext?.({ ...binding.registration, cached: action !== 'compact' }) ?? null,
      history: await contextHistory(context, binding.registration.unitId) };
    const checkpointFile = path.join(directory(context, sessionId), `${requestId}.json`);
    const result = await save(context, file, before, next, [entry(checkpointFile, null, checkpoint)]);
    startJob(context, binding, next);
    return { requestId, state: 'pending', context: result };
  });
}

function startJob(context, binding, value) {
  context.store.contextJobs ??= new Map();
  if (context.store.contextJobs.has(value.sessionId)) return;
  const work = Promise.resolve().then(() => withLocks(context.store, [`context:${value.sessionId}`], async () => {
    const before = await readBytes(context.store, statePath(context, value.sessionId));
    await execute(context, binding, JSON.parse(before), before);
  })).finally(() => context.store.contextJobs.delete(value.sessionId));
  context.store.contextJobs.set(value.sessionId, work);
  work.catch(() => {});
}

async function execute(context, binding, value, before) {
  const file = statePath(context, value.sessionId), { requestId, action } = value.operation;
  try {
    if (action === 'dismiss') return save(context, file, before, { ...value, dismissed: true,
      operation: { ...value.operation, state: 'applied', error: null } });
    const checkpointFile = path.join(directory(context, value.sessionId), `${requestId}.json`);
    const checkpointBytes = await readBytes(context.store, checkpointFile), checkpoint = JSON.parse(checkpointBytes);
    if (checkpoint.attempted) return reconcile(context, binding, value, before);
    if (await binding.adapter.contextBusy?.(binding.registration) === true) unavailable();
    if (binding.adapter.reserveContext && await binding.adapter.reserveContext(binding.registration) !== true) unavailable();
    const bootstrap = await contextBootstrap(context, value.unitId);
    let summary = null;
    // Persist before the first inference call; an interrupted summary is never submitted twice.
    await commitTransaction(context.store, { id: randomUUID(), entries: [entry(checkpointFile, checkpointBytes,
      { ...checkpoint, attempted: true, bootstrap })], events: [] });
    if (action === 'compact') summary = validateContextSummary(await binding.adapter.summarizeContext?.({ ...binding.registration, requestId,
      checkpoint: checkpoint.native, bootstrap }));
    const replacement = await binding.adapter.prepareContext?.({ ...binding.registration, requestId, summary, bootstrap });
    if (replacement?.acknowledged !== true) unavailable();
    const acknowledgmentFile = path.join(directory(context, value.sessionId), `${requestId}.result.json`);
    await commitTransaction(context.store, { id: randomUUID(), entries: [entry(acknowledgmentFile, null,
      { requestId, generationId: replacement.generationId ?? randomUUID(), replacement, summary, bootstrap })], events: [] });
    return reconcile(context, binding, value, before);
  } catch (error) {
    return save(context, file, before, { ...value, operation: { ...value.operation, state: 'failed',
      error: { code: error.code === 'context_unavailable' ? error.code : 'context_unconfirmed', message: 'The current context was kept; retry reconciles this same operation.' } } });
  } finally { await binding.adapter.releaseContext?.(binding.registration); }
}

async function reconcile(context, binding, value, before) {
  const requestId = value.operation.requestId, resultFile = path.join(directory(context, value.sessionId), `${requestId}.result.json`);
  let resultBytes = await readBytes(context.store, resultFile), result = resultBytes ? JSON.parse(resultBytes) : null;
  if (!result) {
    const recovered = await binding.adapter.reconcileContext?.({ ...binding.registration, requestId });
    if (recovered?.acknowledged === true) {
      result = recovered;
      await commitTransaction(context.store, { id: randomUUID(), entries: [entry(resultFile, null, result)], events: [] });
    }
  }
  if (result && result.requestId === requestId && isUuid(result.generationId) && result.replacement?.acknowledged === true) {
    if (value.operation.action === 'compact') validateContextSummary(result.summary);
    if (await binding.adapter.commitContext?.({ ...binding.registration, requestId, replacement: result.replacement }) !== true) unavailable();
    const next = { ...value, generationId: result.generationId, bootstrap: result.bootstrap, dismissed: false,
      meter: contextMeter(await binding.adapter.readContext?.(binding.registration)), operation: { ...value.operation, state: 'applied', error: null } };
    await save(context, statePath(context, value.sessionId), before, next);
    return next;
  }
  const next = { ...value, operation: { ...value.operation, state: 'failed',
    error: { code: 'context_unconfirmed', message: 'The current context was kept; native success has not been confirmed.' } } };
  await save(context, statePath(context, value.sessionId), before, next);
  return next;
}

export async function recoverContexts(context) {
  let names;
  try { names = await readdir(path.join(context.paths.localDirectory, 'contexts')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const sessionId of names.filter(isUuid)) {
    const bytes = await readBytes(context.store, statePath(context, sessionId));
    if (!bytes || JSON.parse(bytes).operation?.state !== 'pending') continue;
    const binding = await contextSession(context, sessionId).catch(() => null);
    if (binding) await withLocks(context.store, [`context:${sessionId}`], () => reconcile(context, binding, JSON.parse(bytes), bytes));
  }
}
