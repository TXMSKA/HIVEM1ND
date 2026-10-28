import { randomUUID } from 'node:crypto';
import { CoreError, canonicalJson, hashBytes, isUuid } from './identity.mjs';
import { commitTransaction, readBytes, revisionOf } from './store.mjs';
import path from 'node:path';

const witnesses = new WeakSet();
const handles = new WeakMap();
const claimedHandles = new WeakSet();
const unavailable = () => { throw new CoreError(409, 'cleanup_unavailable', 'Owned execution cleanup cannot be verified.'); };
const table = context => { if (!handles.has(context.store)) handles.set(context.store, new Map()); return handles.get(context.store); };
export function verifiedProcessWitness(value) { return witnesses.has(value); }

// The live job/process-group or local AbortSignal handle is the authority. Persisted PIDs are never used to signal work.
export async function ownRunProcess(context, binding, handle, onEvidence) {
  if (!isUuid(binding.runId) || !isUuid(binding.attemptId) || !isUuid(binding.sessionId)
    || !handle || typeof handle.identity !== 'string' || !handle.identity || typeof handle.verify !== 'function'
    || typeof handle.cleanup !== 'function' || typeof handle.onExit !== 'function' || await handle.verify() !== true) unavailable();
  const key = `${binding.runId}:${binding.attemptId}`;
  if (table(context).has(key) || claimedHandles.has(handle)) unavailable();
  if ([...table(context).values()].some(owned => !owned.record.cleaned && (owned.handle === handle || owned.handle.identity === handle.identity))) unavailable();
  const file = path.join(context.paths.localDirectory, 'runs', binding.runId, 'processes', `${binding.attemptId}.json`);
  const previous = await readBytes(context.store, file);
  if (previous) unavailable();
  const record = { format: 'hivem1nd-run-process-v1', ...binding, identity: hashBytes(Buffer.from(handle.identity)), generation: randomUUID(), exited: false, cleaned: false }; // Compatibility: persisted format and contract identifiers keep existing records and peers readable.
  await commitTransaction(context.store, { id: randomUUID(), entries: [{ resource: file, recordPath: file, beforeRevision: null,
    afterBytes: Buffer.from(canonicalJson(record)), private: true }], events: [] });
  const owned = { record, handle, identity: handle.identity, file, onEvidence, pending: Promise.resolve(), error: null };
  claimedHandles.add(handle);
  table(context).set(key, owned);
  const emit = kind => {
    const witness = Object.freeze({ ...binding, generation: record.generation, kind, source: 'process', id: `${record.generation}:${kind}` });
    witnesses.add(witness); return onEvidence(witness);
  };
  const save = async () => {
    const bytes = await readBytes(context.store, file);
    await commitTransaction(context.store, { id: randomUUID(), entries: [{ resource: file, recordPath: file, beforeRevision: revisionOf(bytes),
      afterBytes: Buffer.from(canonicalJson(record)), private: true }], events: [] });
  };
  owned.clean = async () => {
    if (record.cleaned) return true;
    // A live handle must still verify; once the exit is recorded verify is false by definition and cleanup alone proves closure.
    if (handle.identity !== owned.identity || !record.exited && await handle.verify() !== true) unavailable();
    // A parent may have exited while descendants keep its stdout open; closure observes the job independently.
    const result = await handle.cleanup();
    if (result?.closed !== true || result.identity !== owned.identity) unavailable();
    record.cleaned = true; await save(); await emit('cleanup'); return true;
  };
  owned.detach = handle.onExit(() => {
    owned.pending = owned.pending.then(async () => {
      if (handle.identity !== owned.identity) unavailable();
      if (!record.exited) { record.exited = true; await save(); await emit('exit'); }
      await owned.clean();
    }).catch(error => { owned.error = error; });
    return owned.pending;
  });
  return { generation: record.generation };
}
export async function cleanupRunAttempt(context, runId, attemptId, { stop = false } = {}) {
  const owned = table(context).get(`${runId}:${attemptId}`);
  if (!owned) unavailable();
  await owned.pending;
  if (stop && !owned.record.exited) {
    if (owned.handle.identity !== owned.identity || await owned.handle.verify() !== true || typeof owned.handle.stop !== 'function') unavailable();
    if ((await owned.handle.stop())?.acknowledged !== true) unavailable();
    await owned.pending;
    if (!owned.record.exited) unavailable();
  }
  await owned.clean();
  return { exited: owned.record.exited, cleaned: owned.record.cleaned };
}
export async function stopRunStep(context, runId, attemptId) {
  const owned = table(context).get(`${runId}:${attemptId}`);
  if (!owned || owned.record.exited || owned.handle.identity !== owned.identity || await owned.handle.verify() !== true || typeof owned.handle.stopStep !== 'function') unavailable();
  const result = await owned.handle.stopStep();
  if (result?.acknowledged !== true) unavailable();
  return { acknowledged: true };
}
export function liveRunProcess(context, runId, attemptId) { return table(context).has(`${runId}:${attemptId}`); }
export async function verifyRunProcess(context, runId, attemptId) {
  const owned = table(context).get(`${runId}:${attemptId}`);
  return Boolean(owned && (owned.record.exited || owned.record.cleaned || owned.handle.identity === owned.identity && await owned.handle.verify() === true));
}
export function retireRunProcess(context, runId, attemptId) {
  const key = `${runId}:${attemptId}`, owned = table(context).get(key);
  if (!owned?.record.exited || !owned.record.cleaned) unavailable();
  owned.detach?.(); table(context).delete(key);
}
export async function drainRunProcesses(context) {
  for (const owned of table(context).values()) await owned.pending;
}
export async function closeRunProcesses(context) {
  for (const owned of table(context).values()) {
    await cleanupRunAttempt(context, owned.record.runId, owned.record.attemptId, { stop: true });
    owned.detach?.();
  }
  table(context).clear();
}
