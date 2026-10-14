import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { acquireAdditionSource, additionSourceIdentity, additionStagingRoot, disposeAdditionSource, receiveAdditionChunk, validateAdditionSource, writeAdditionLocal } from './addition-source.mjs';
import { CoreError, canonicalJson, hashBytes, isUuid, uuidV8, validateMachineName, validateName } from './identity.mjs';
import { assertNoLinks } from './paths.mjs';
import { readCollection } from './projection.mjs';
import { readContent, readPublishedSettings } from './settings.mjs';
import { additionSourceError } from './security.mjs';
import { withLocks } from './store.mjs';

const REVIEW_MS = 15 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
function fail(status, code, message) { throw new CoreError(status, code, message); }
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(422, 'invalid_body', 'An Add body must be an object.');
  if (Object.keys(value).some(key => !fields.includes(key))) fail(400, 'unknown_field', 'The Add body contains an unknown field.');
  if (fields.some(key => !Object.hasOwn(value, key))) fail(422, 'invalid_body', 'The Add body is missing a required field.');
}
function owner(context) { return context.additionOwner ?? context.settingsOwner ?? context; }
function acquisitionContext(context) { return { ...owner(context), paths: context.paths, store: context.store, now: context.now }; }
function binding(context) {
  if (context.principal?.audience !== 'desktop' || context.principal?.unitId !== 'root:master' || !context.principal?.stableId) fail(403, 'forbidden', 'Only the desktop may inspect additions.');
  return { ownerHash: hashBytes(Buffer.from(canonicalJson([context.paths.mindKey, context.paths.machine, path.resolve(context.paths.localDirectory)]))),
    principalHash: hashBytes(Buffer.from(context.additionPrincipal ?? context.principal.stableId)), machine: context.paths.machine };
}
function machine(context, selected) {
  validateMachineName(selected);
  if (selected !== context.paths.machine || owner(context).active === false) fail(409, 'machine_unavailable', 'Open Add on the selected owning machine.');
}
function bound(context, record) {
  const expected = binding(context);
  if (Object.keys(expected).some(key => record[key] !== expected[key])) fail(403, 'forbidden', 'The preview belongs to another owner.');
  machine(context, record.machine);
}
async function location(context, kind, id) {
  if (!isUuid(id)) fail(422, 'invalid_body', 'The Add identity must be a UUID.');
  return path.join(await additionStagingRoot(acquisitionContext(context), { create: false }), kind, `${id}.json`);
}
async function save(context, kind, record) {
  await writeAdditionLocal(acquisitionContext(context), await location(context, kind, record.id), Buffer.from(canonicalJson(record)));
}
async function load(context, kind, id, { allowCancelled = false } = {}) {
  binding(context);
  machine(context, context.paths.machine);
  const file = await location(context, kind, id);
  await assertNoLinks(file, { root: context.paths.localDirectory });
  const info = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) fail(404, kind === 'previews' ? 'preview_not_found' : 'invalid_source', 'The local review was not found.');
  if (!info.isFile() || info.nlink !== 1 || info.size > 32 * 1024 * 1024) fail(409, 'source_changed', 'The local review changed.');
  let record; try { record = JSON.parse(await readFile(file)); } catch { fail(409, 'source_changed', 'The local review changed.'); }
  bound(context, record);
  if (record.id !== id) fail(409, 'source_changed', 'The local review changed.');
  const accepted = kind === 'previews' && record.preview.state === 'accepted';
  const deadline = accepted ? (typeof record.retainedUntil === 'number' ? record.retainedUntil : Date.parse(record.retainedUntil))
    || (typeof record.acceptedAt === 'number' ? record.acceptedAt : Date.parse(record.acceptedAt)) + RETENTION_MS : Date.parse(record.expiresAt);
  if (!Number.isFinite(Number(deadline)) || Number(deadline) <= context.now()) {
    await disposeRecord(context, kind, record);
    fail(409, 'preview_expired', 'The local review expired. Inspect the source again.');
  }
  if (record.cancelled && !allowCancelled) fail(404, 'preview_not_found', 'The local review was canceled.');
  return record;
}
async function disposeRecord(context, kind, record) {
  const service = owner(context);
  service.additionJobs?.get(record.id)?.controller.abort();
  if (kind === 'previews') {
    await disposeAdditionSource(acquisitionContext(context), record.id);
    if (record.uploadId) await disposeAdditionSource(acquisitionContext(context), record.uploadId, 'uploads');
  } else await disposeAdditionSource(acquisitionContext(context), record.id, 'uploads');
  // Keep the owner and consumed proof after staging disposal; cancellation never erases an acceptance.
  if (record.preview?.state !== 'accepted') { record.cancelled = true; await save(context, kind, record); }
}
function expiry(context, kind, record) {
  const service = owner(context);
  service.additionExpiry ??= new Map();
  const key = `${kind}:${record.id}`;
  clearTimeout(service.additionExpiry.get(key));
  const timer = setTimeout(async () => {
    service.additionExpiry.delete(key);
    await withLocks(context.store, [`addition:${record.id}`], async () => {
      const current = await load(context, kind, record.id).catch(() => null);
      if (current?.preview?.state === 'accepted') await disposeRecord(context, kind, current);
    }).catch(() => {});
  }, Math.max(1, Date.parse(record.expiresAt) - context.now()));
  timer.unref?.(); service.additionExpiry.set(key, timer);
}

export async function assertAdditionRequest(context, operation, input, id = null) {
  binding(context);
  if (operation === 'upload') {
    exact(input, ['machine', 'name']); machine(context, input.machine);
    validateName(input.name, { label: 'folder name' });
  } else if (operation === 'inspect') {
    exact(input, ['machine', 'source', 'updateOf']); machine(context, input.machine); validateAdditionSource(input.source);
    if (input.updateOf !== null && !isUuid(input.updateOf)) fail(422, 'invalid_body', 'The update identity must be a UUID or null.');
    if (input.source.kind === 'folder') await load(context, 'uploads', input.source.uploadId);
    if (input.updateOf) await updateTarget(context, input);
  } else if (operation === 'chunk') {
    exact(input, ['path', 'index', 'total', 'base64']); await load(context, 'uploads', id);
  } else {
    if (operation !== 'read') exact(input, []);
    await load(context, operation === 'cancelUpload' ? 'uploads' : 'previews', id, { allowCancelled: ['cancel', 'cancelUpload'].includes(operation) });
  }
}

async function updateTarget(context, input) {
  const target = path.join(context.paths.mind, 'user', 'additions', `${input.updateOf}.json`);
  await assertNoLinks(target, { root: context.paths.mind });
  const bytes = await readFile(target).catch(error => { if (error.code === 'ENOENT') fail(404, 'addition_not_found', 'The accepted addition was not found.'); throw error; });
  let record; try { record = JSON.parse(bytes); } catch { fail(409, 'destination_changed', 'The accepted addition changed.'); }
  if (record.id !== input.updateOf || record.removed || record.machine !== input.machine || !['skill', 'repository', 'docs'].includes(record.kind)) fail(409, 'source_changed', 'The update target changed.');
  if (input.source.kind === 'folder') {
    if (record.source?.kind !== 'folder') fail(409, 'source_changed', 'Choose the same source for this update.');
  } else {
    if (canonicalJson(record.source ?? null) !== canonicalJson(additionSourceIdentity(input.source))) fail(409, 'source_changed', 'Choose the same source for this update.');
  }
  return { id: record.id, kind: record.kind, name: record.name, source: record.source, sourcePath: record.sourcePath, revision: hashBytes(bytes) };
}

export async function openAdditionUpload(context, input) {
  await assertAdditionRequest(context, 'upload', input);
  const id = operationIdentity(context, 'upload'), prior = await priorOperation(context, 'uploads', id);
  if (prior) return { uploadId: prior.id, expiresAt: prior.expiresAt };
  const record = { id, ...binding(context), request: requestBinding(context), name: input.name, expiresAt: new Date(context.now() + REVIEW_MS).toISOString(), files: {}, cancelled: false, sealedBy: null };
  await save(context, 'uploads', record); expiry(context, 'uploads', record);
  return { uploadId: record.id, expiresAt: record.expiresAt };
}
export async function writeAdditionChunk(context, id, input) {
  await assertAdditionRequest(context, 'chunk', input, id);
  return withLocks(context.store, [`addition:${id}`], async () => {
    const record = await load(context, 'uploads', id);
    if (record.sealedBy) fail(409, 'source_changed', 'The uploaded snapshot is already under review.');
    const result = await receiveAdditionChunk(acquisitionContext(context), record, input);
    await save(context, 'uploads', record);
    return result;
  });
}
export async function cancelAdditionUpload(context, id, input = {}) {
  await assertAdditionRequest(context, 'cancelUpload', input, id);
  return withLocks(context.store, [`addition:${id}`], async () => {
    const upload = await load(context, 'uploads', id, { allowCancelled: true });
    if (upload.cancelled) return;
    if (upload.sealedBy) {
      const preview = await load(context, 'previews', upload.sealedBy, { allowCancelled: true });
      if (preview.preview.state === 'accepted') { await disposeAdditionSource(acquisitionContext(context), id, 'uploads'); return; }
      if (!preview.cancelled) await cancelAdditionPreview(context, preview.id);
    }
    await disposeRecord(context, 'uploads', upload);
  });
}
async function choices(context) {
  async function all(collection) {
    const items = []; let cursor = null;
    do { const page = await readCollection(context, collection, { limit: 200, cursor }); items.push(...page.items); cursor = page.nextCursor; } while (cursor);
    return items;
  }
  const units = (await all('units')).filter(item => item.id !== 'root:master');
  const groups = (await all('groups')).filter(item => !item.deleted);
  const snapshot = { units: units.map(item => ({ id: item.id, title: item.alias ?? item.unit ?? item.id })),
    groups: groups.map(item => ({ id: item.id, title: item.title, members: [...item.members] })) };
  return { snapshot, revision: hashBytes(Buffer.from(canonicalJson({ units: units.map(item => [item.id, item.revision]), groups: groups.map(item => [item.id, item.revision]), snapshot }))) };
}

export async function inspectAddition(context, input) {
  await assertAdditionRequest(context, 'inspect', input);
  const id = operationIdentity(context, 'inspect'), prior = await priorOperation(context, 'previews', id);
  if (prior) return readAdditionPreview(context, id);
  const [scope, content, projects] = await Promise.all([choices(context), readContent(context), readPublishedSettings(context, input.machine)]);
  const expiresAt = new Date(context.now() + REVIEW_MS).toISOString();
  const upload = input.source.kind === 'folder' ? await load(context, 'uploads', input.source.uploadId) : null;
  if (upload?.sealedBy) fail(409, 'source_changed', 'The uploaded snapshot is already under review.');
  const record = { id, ...binding(context), source: input.source, updateTarget: input.updateOf ? await updateTarget(context, input) : null,
    uploadId: upload?.id ?? null, scopeSnapshot: scope.snapshot, expiresAt, cancelled: false, attemptId: randomUUID(), resolvedPin: null,
    request: requestBinding(context),
    preview: { id, machine: input.machine, state: 'inspecting', sourceDisplay: upload?.name ?? input.source.url, pin: null, candidates: [], choices: scope.snapshot,
      scopeRevision: scope.revision, contentRevision: content.revision, projectRevision: projects?.projects.revision ?? null, expiresAt, error: null, result: null } };
  if (upload) {
    await withLocks(context.store, [`addition:${upload.id}`], async () => {
      const current = await load(context, 'uploads', upload.id);
      if (current.sealedBy) fail(409, 'source_changed', 'The uploaded snapshot is already under review.');
      current.sealedBy = id; await save(context, 'uploads', current);
    });
  }
  await save(context, 'previews', record); expiry(context, 'previews', record);
  launchInspection(context, record, upload);
  return structuredClone(record.preview);
}

function requestBinding(context) {
  return context.receipt ? { key: context.receipt.key, principalHash: context.receipt.principalHash, bodyHash: context.receipt.bodyHash } : null;
}
function operationIdentity(context, operation) {
  return context.receipt ? uuidV8(['addition', operation, binding(context), context.receipt.key]) : randomUUID();
}
async function priorOperation(context, kind, id) {
  const record = await load(context, kind, id).catch(error => { if (error.status === 404) return null; throw error; });
  if (record && canonicalJson(record.request) !== canonicalJson(requestBinding(context))) fail(409, 'idempotency_conflict', 'This Add request identity was already used.');
  return record;
}
async function publishInspection(context, record) {
  return withLocks(context.store, [`addition:${record.id}`], async () => {
    const current = await load(context, 'previews', record.id, { allowCancelled: true });
    if (current.cancelled || current.attemptId !== record.attemptId || current.preview.state === 'accepted') return false;
    await save(context, 'previews', record); return true;
  });
}
function launchInspection(context, record, upload) {
  const service = owner(context);
  service.additionJobs ??= new Map();
  const controller = new AbortController();
  const promise = new Promise(resolve => setImmediate(resolve)).then(async () => {
    const result = await acquireAdditionSource(acquisitionContext(context), { id: record.id, operationId: record.attemptId, source: record.source, upload,
      pin: record.resolvedPin, integrity: record.resolvedIntegrity ?? null, signal: controller.signal, onResolved: async evidence => {
        record.resolvedPin = evidence.pin; record.resolvedSource = evidence.source;
        record.resolvedIntegrity = evidence.integrity;
        record.preview.pin = evidence.pin.digest ? evidence.pin : null;
        if (!controller.signal.aborted) await publishInspection(context, record);
      } });
    if (controller.signal.aborted || Date.parse(record.expiresAt) <= context.now()) { await disposeAdditionSource(acquisitionContext(context), record.id); return; }
    if (record.updateTarget && (canonicalJson(record.updateTarget.source) !== canonicalJson(result.source)
      || !result.candidates.some(candidate => candidate.kind === record.updateTarget.kind && candidate.name === record.updateTarget.name && candidate.path === record.updateTarget.sourcePath))) {
      fail(409, 'source_changed', 'The update does not match the accepted source and part.');
    }
    record.acquisition = result; record.resolvedPin = result.pin;
    record.preview = { ...record.preview, state: 'ready', sourceDisplay: result.source.display, pin: result.pin, candidates: result.candidates };
    await publishInspection(context, record);
  }).catch(async error => {
    if (controller.signal.aborted || Date.parse(record.expiresAt) <= context.now()) return;
    const safe = additionSourceError(error);
    record.preview.state = 'failed'; record.preview.error = { code: safe.code, message: safe.message };
    await disposeAdditionSource(acquisitionContext(context), record.id);
    await publishInspection(context, record);
  }).finally(() => { if (service.additionJobs.get(record.id)?.controller === controller) service.additionJobs.delete(record.id); });
  service.additionJobs.set(record.id, { controller, promise });
  promise.catch(() => {});
}

export async function readAdditionPreview(context, id) {
  return withLocks(context.store, [`addition:${id}`], async () => {
    const record = await load(context, 'previews', id);
    if (record.preview.state === 'inspecting' && !owner(context).additionJobs?.has(id)) {
      record.preview.state = 'failed';
      record.preview.error = { code: 'source_unavailable', message: 'The inspection was interrupted. Retry the inspection.' };
      await save(context, 'previews', record);
    }
    return structuredClone(record.preview);
  });
}
export async function cancelAdditionPreview(context, id, input = {}) {
  await assertAdditionRequest(context, 'cancel', input, id);
  return withLocks(context.store, [`addition:${id}`], async () => {
    const record = await load(context, 'previews', id, { allowCancelled: true });
    if (record.cancelled) return;
    await disposeRecord(context, 'previews', record);
  });
}
export async function retryAdditionPreview(context, id, input = {}) {
  await assertAdditionRequest(context, 'retry', input, id);
  await readAdditionPreview(context, id);
  return withLocks(context.store, [`addition:${id}`], async () => {
    const record = await load(context, 'previews', id);
    const request = requestBinding(context);
    if (request && record.retryRequest?.key === request.key) return structuredClone(record.preview);
    if (record.preview.state !== 'failed') return structuredClone(record.preview);
    record.attemptId = randomUUID();
    record.retryRequest = request;
    record.preview = { ...record.preview, state: 'inspecting', candidates: [], error: null, result: null };
    const upload = record.uploadId ? await load(context, 'uploads', record.uploadId) : null;
    await save(context, 'previews', record);
    launchInspection(context, record, upload);
    return structuredClone(record.preview);
  });
}

export async function closeAdditionJobs(context) {
  const service = owner(context);
  for (const timer of service.additionExpiry?.values() ?? []) clearTimeout(timer);
  service.additionExpiry?.clear();
  const jobs = [...(service.additionJobs?.values() ?? [])];
  for (const job of jobs) job.controller.abort();
  await Promise.allSettled(jobs.map(job => job.promise));
}
