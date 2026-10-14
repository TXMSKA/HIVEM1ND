import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { acquireAdditionSource, additionSourceIdentity, additionStagingRoot, disposeAdditionSource, receiveAdditionChunk, validateAdditionSource, writeAdditionLocal } from './addition-source.mjs';
import { CoreError, canonicalJson, hashBytes, isUuid, parseUnitId, uuidV8, validateMachineName, validateName } from './identity.mjs';
import { additionPath } from './addition-parts.mjs';
import { checkAddition, resolveAdditionScope } from './addition-check.mjs';
import { assertNoLinks } from './paths.mjs';
import { readCollection } from './projection.mjs';
import { prepareAdditionProjects, readContent, readPublishedSettings } from './settings.mjs';
import { additionSourceError } from './security.mjs';
import { commitChange, prepareChangeUndo, readBytes, revisionOf, withLocalChanges, withLocks } from './store.mjs';
import { EVENT_NAMES } from './events.mjs';
import { clusterMembers } from './cluster-policy.mjs';
import { machineRecordPath } from '../records.mjs';

if (!EVENT_NAMES.includes('additions.changed')) EVENT_NAMES.push('additions.changed');

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
  let record; try { record = JSON.parse(await readBytes(context.store, file)); } catch { fail(409, 'source_changed', 'The local review changed.'); }
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
  if (operation === 'apply') {
    exact(input, ['machine', 'previewId', 'selections', 'expectedContentRevision', 'expectedProjectRevision', 'confirmed']);
    machine(context, input.machine);
    if (input.confirmed !== true || !Array.isArray(input.selections) || !input.selections.length || input.selections.length > 1024
      || ![input.expectedContentRevision, input.expectedProjectRevision].every(value => value === null || /^[a-f0-9]{64}$/.test(value ?? ''))) fail(422, 'invalid_body', 'Review and confirm at least one addition.');
    const ids = new Set();
    for (const selection of input.selections) {
      exact(selection, ['candidateId', 'scope']);
      if (!isUuid(selection.candidateId) || ids.has(selection.candidateId)) fail(422, 'invalid_body', 'Select each candidate once.');
      ids.add(selection.candidateId); validateScope(selection.scope);
    }
    await load(context, 'previews', input.previewId);
  } else if (operation === 'remove') {
    exact(input, ['machine', 'confirmed', 'expectedRevision']); machine(context, input.machine);
    if (input.confirmed !== true || !/^[a-f0-9]{64}$/.test(input.expectedRevision ?? '')) fail(422, 'invalid_body', 'Confirm removal of the reviewed addition.');
    const current = await acceptedRecord(context, id);
    if (current.record.machine !== input.machine) fail(409, 'machine_unavailable', 'Remove the addition on its owning machine.');
  } else if (operation === 'list') {
    if (input != null) { exact(input, Object.hasOwn(input, 'machine') ? ['machine'] : []); machine(context, input.machine ?? context.paths.machine); }
  } else if (operation === 'upload') {
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
  const units = (await all('units')).filter(item => item.id !== 'root:master' && !item.removed);
  const groups = (await all('groups')).filter(item => !item.deleted);
  const snapshot = { units: units.map(item => ({ id: item.id, title: item.alias ?? item.unit ?? item.id })),
    groups: groups.map(item => ({ id: item.id, title: item.title, members: clusterMembers(groups, [item.id], units) })) };
  return { snapshot, revision: hashBytes(Buffer.from(canonicalJson({ units: units.map(item => [item.id, item.revision]), groups: groups.map(item => [item.id, item.revision]), snapshot }))) };
}

async function projectBindingRevision(context) {
  const files = [path.join(context.paths.mind, 'user', 'routes.md'), machineRecordPath(context.paths.mind, context.paths.machine)];
  const revisions = [];
  for (const file of files) { await assertNoLinks(file, { root: context.paths.mind }); revisions.push(revisionOf(await readBytes(context.store, file))); }
  return hashBytes(Buffer.from(canonicalJson(revisions)));
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
    request: requestBinding(context), projectBindingRevision: await projectBindingRevision(context),
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
  const job = owner(context).additionJobs?.get(id);
  job?.controller.abort();
  // Acquisition owns its cleanup until it settles. Joining outside the preview
  // lock also lets an already queued inspection publication finish safely.
  await job?.promise;
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

function jsonBytes(value) { return Buffer.from(`${canonicalJson(value)}\n`); }
function manifestPath(context, id) { return path.join(context.paths.mind, 'user', 'additions', `${id}.json`); }
function validateScope(scope) {
  exact(scope, ['everyUnit', 'units', 'groups']);
  if (typeof scope.everyUnit !== 'boolean' || !Array.isArray(scope.units) || !Array.isArray(scope.groups)
    || scope.units.length > 255 || scope.groups.length > 255 || scope.everyUnit && (scope.units.length || scope.groups.length)
    || new Set(scope.units).size !== scope.units.length || new Set(scope.groups).size !== scope.groups.length
    || scope.groups.some(id => !isUuid(id))) fail(422, 'invalid_scope', 'Choose Every unit or distinct units and groups.');
  for (const id of scope.units) {
    let canonical;
    try { canonical = parseUnitId(id).id; } catch { fail(422, 'invalid_scope', 'Choose a canonical agent.'); }
    if (id === 'root:master' || canonical !== id) fail(422, 'invalid_scope', 'Choose a canonical agent.');
  }
}
function contentRoot(record) { return `user/${record.kind === 'skill' ? 'features' : 'knowledge'}/${record.name}`; }
function additionView(record, revision, unitCount = record.unitCount) {
  const { format, files, ...value } = record;
  return { ...value, revision, unitCount };
}
function validateManifest(record, id) {
  exact(record, ['format', 'id', 'kind', 'name', 'title', 'source', 'sourcePath', 'pin', 'license', 'publishedAt', 'requirements', 'scope', 'unitCount', 'machine', 'projectId', 'installedAt', 'updatedAt', 'removed', 'files']);
  if (record.format !== 'hivem1nd-addition-v1' || record.id !== id || !isUuid(id) || !['skill', 'docs', 'repository'].includes(record.kind)) fail(422, 'invalid_pack', 'The addition manifest is invalid.');
  validateName(record.name); validateMachineName(record.machine); validateScope(record.scope);
  if (record.sourcePath !== '.') additionPath(record.sourcePath);
  exact(record.source, ['kind', 'display', 'url']); exact(record.pin, ['kind', 'value', 'digest']);
  if (!['git', 'registry', 'folder'].includes(record.source.kind) || typeof record.source.display !== 'string' || record.source.display.length > 2048 || /[\x00-\x1f\x7f]/.test(record.source.display)
    || record.source.kind === 'folder' && record.source.url !== null) fail(422, 'invalid_pack', 'The source provenance is invalid.');
  if (record.source.url !== null) validateAdditionSource({ kind: record.source.kind, url: record.source.url });
  if (typeof record.removed !== 'boolean' || !Array.isArray(record.requirements) || record.requirements.length > 100
    || record.requirements.some(value => typeof value !== 'string' || !value || value.length > 128 || /[\x00-\x1f\x7f]/.test(value))
    || !Number.isInteger(record.unitCount) || record.unitCount < 0 || typeof record.title !== 'string' || !record.title || record.title.length > 240
    || /[\x00-\x1f\x7f]/.test(record.title) || ![record.installedAt, record.updatedAt, record.publishedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) fail(422, 'invalid_pack', 'The accepted addition is invalid.');
  const check = checkAddition({ supported: true, requirements: record.requirements }, { pin: record.pin, pinVerified: true, license: record.license, publishedAt: record.publishedAt, noInstallScripts: true, runtimeVerified: true }, Date.parse(record.updatedAt));
  if (!check.eligible || record.kind === 'repository' && (record.projectId !== record.name || record.unitCount !== 0 || canonicalJson(record.scope) !== canonicalJson({ everyUnit: false, units: [], groups: [] }))
    || record.kind !== 'repository' && record.projectId !== null || !Array.isArray(record.files) || record.files.length > 1024) fail(422, 'invalid_pack', 'The addition check or ownership manifest is invalid.');
  const seen = new Set(); let total = 0;
  for (const file of record.files) {
    exact(file, ['path', 'hash', 'bytes']); additionPath(file.path);
    if (!file.path.startsWith(`${contentRoot(record)}/`) || record.kind === 'repository' || seen.has(file.path.toLowerCase()) || !/^[a-f0-9]{64}$/.test(file.hash ?? '')
      || !Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > 16777216) fail(422, 'invalid_pack', 'The owned content inventory is invalid.');
    seen.add(file.path.toLowerCase()); total += file.bytes;
  }
  if (total > 67108864 || record.kind !== 'repository' && !record.files.length) fail(422, 'invalid_pack', 'The owned content inventory is invalid.');
  return record;
}
async function acceptedRecord(context, id) {
  if (!isUuid(id)) fail(404, 'addition_not_found', 'The accepted addition was not found.');
  const file = manifestPath(context, id);
  await assertNoLinks(file, { root: context.paths.mind });
  const bytes = await readBytes(context.store, file);
  if (!bytes) fail(404, 'addition_not_found', 'The accepted addition was not found.');
  let record; try { record = JSON.parse(bytes); validateManifest(record, id); } catch { fail(409, 'destination_changed', 'The accepted addition manifest changed.'); }
  return { record, bytes, revision: revisionOf(bytes) };
}
async function acceptedRecords(context) {
  const root = path.join(context.paths.mind, 'user', 'additions');
  await readBytes(context.store, path.join(context.paths.mind, 'user', 'gui', 'content.json'));
  await assertNoLinks(root, { root: context.paths.mind });
  const names = await readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const result = [];
  for (const name of names.sort()) if (isUuid(name.slice(0, -5)) && name.endsWith('.json')) {
    const file = path.join(root, name);
    if (context.store.hidden.has(file) && context.store.hidden.get(file) === null) continue;
    result.push(await acceptedRecord(context, name.slice(0, -5)));
  }
  return result;
}
function allowedUnits(scope, snapshot) {
  const known = new Set(snapshot.units.map(item => item.id));
  const ids = new Set(scope.everyUnit ? known : scope.units.filter(id => known.has(id)));
  for (const id of scope.groups) for (const member of snapshot.groups.find(group => group.id === id)?.members ?? []) if (known.has(member)) ids.add(member);
  return ids;
}
export async function readAdditions(context, selectedMachine = context.paths.machine) {
  binding(context); validateMachineName(selectedMachine);
  return withLocalChanges(context.store, async () => {
    const snapshot = (await choices(context)).snapshot;
    const items = (await acceptedRecords(context)).filter(item => !item.record.removed && item.record.machine === selectedMachine)
      .map(item => additionView(item.record, item.revision, item.record.kind === 'repository' ? 0 : allowedUnits(item.record.scope, snapshot).size));
    return { machine: selectedMachine, readOnly: selectedMachine !== context.paths.machine || owner(context).active === false, items };
  });
}

export async function readAdditionContent(context) {
  const records = await acceptedRecords(context);
  if (!records.length) return [];
  const snapshot = (await choices(context)).snapshot;
  return records.map(item => additionView(item.record, item.revision,
    item.record.kind === 'repository' ? 0 : allowedUnits(item.record.scope, snapshot).size));
}

async function treeInventory(root) {
  const files = [];
  async function visit(directory, prefix) {
    await assertNoLinks(directory, { root });
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name; additionPath(relative);
      const absolute = path.join(root, ...relative.split('/')), info = await lstat(absolute);
      if (info.isSymbolicLink() || info.nlink > 1 && info.isFile() || !info.isFile() && !info.isDirectory()) fail(409, 'destination_changed', 'An owned content path changed.');
      if (info.isDirectory()) await visit(absolute, relative); else files.push({ path: relative, hash: hashBytes(await readFile(absolute)), bytes: info.size });
    }
  }
  await visit(root, ''); return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
async function verifyOwned(context, record) {
  if (record.kind === 'repository') {
    const local = await additionStagingRoot(acquisitionContext(context));
    const recoveryFile = path.join(local, 'repository-recovery', `${record.id}-${record.pin.digest}.json`);
    await assertNoLinks(recoveryFile, { root: local });
    const bytes = await readBytes(context.store, recoveryFile);
    if (!bytes) fail(409, 'destination_changed', 'The checkout ownership record is unavailable.');
    const recovery = JSON.parse(bytes), root = path.join(local, 'repositories', record.id, record.pin.digest);
    if (recovery.id !== record.id || recovery.ownerHash !== binding(context).ownerHash || canonicalJson(recovery.pin) !== canonicalJson(record.pin)
      || canonicalJson(await treeInventory(root)) !== canonicalJson([...recovery.files].sort((a, b) => a.path.localeCompare(b.path, 'en')))) fail(409, 'destination_changed', 'The registered checkout has foreign changes.');
    return;
  }
  const root = path.join(context.paths.mind, ...contentRoot(record).split('/'));
  const actual = await treeInventory(root), expected = record.files.map(file => ({ ...file, path: file.path.slice(contentRoot(record).length + 1) })).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(409, 'destination_changed', 'Imported content has foreign changes; the accepted pin remains active.');
}
function changeEntry(context, relative, beforeBytes, afterBytes, extra = {}) {
  return { resource: `addition-file:${relative}`, recordPath: path.join(context.paths.mind, ...relative.split('/')), beforeRevision: revisionOf(beforeBytes), beforeBytes, afterBytes,
    ...(afterBytes === null ? { operation: 'delete' } : {}), ...extra };
}
function undoReportEvents(context, entries) {
  const events = [];
  if (entries.some(entry => /^user\/gui\/groups\//.test(path.relative(context.paths.mind, entry.recordPath).replaceAll('\\', '/')))) events.push({ name: 'view.changed', data: { revision: null, collections: ['clusters', 'groups', 'chats'] } });
  for (const entry of entries) {
    if (entry.recordPath === path.join(context.paths.mind, 'user', 'gui', 'content.json')) events.push({ name: 'settings.content.changed', data: { revision: revisionOf(entry.beforeBytes) } });
    if (entry.resource === `settings-report:${context.paths.machine}`) {
      const report = entry.beforeBytes ? JSON.parse(entry.beforeBytes) : null;
      events.push({ name: 'machine.settings.changed', data: { machine: context.paths.machine, section: 'projects', reportedAt: report?.reportedAt ?? new Date(context.now()).toISOString(), revision: report?.projects.revision ?? null } });
    }
  }
  return events;
}
async function verifiedSource(context, record) {
  try {
    const acquisition = record.acquisition;
    const directory = path.join(await additionStagingRoot(acquisitionContext(context)), 'sources', record.id, record.attemptId);
    if (!acquisition || path.resolve(acquisition.directory) !== path.resolve(directory)) fail(409, 'preview_changed', 'The reviewed snapshot changed.');
    const { directory: ignored, ...expected } = acquisition;
    await assertNoLinks(path.join(directory, 'manifest.json'), { root: context.paths.localDirectory });
    if (!(await readFile(path.join(directory, 'manifest.json'))).equals(Buffer.from(canonicalJson(expected)))) fail(409, 'preview_changed', 'The reviewed manifest changed.');
    const files = await treeInventory(path.join(directory, 'tree'));
    if (canonicalJson(files) !== canonicalJson(acquisition.files.map(({ path, bytes, hash }) => ({ path, bytes, hash })).sort((a, b) => a.path.localeCompare(b.path, 'en')))
      || hashBytes(Buffer.from(canonicalJson(files))) !== acquisition.manifestHash) fail(409, 'preview_changed', 'The reviewed source bytes changed.');
    return acquisition;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'unsafe_path', 'destination_changed'].includes(error.code)) fail(409, 'preview_changed', 'The reviewed source snapshot changed. Inspect it again.');
    throw error;
  }
}
async function candidateFiles(context, acquisition, candidate) {
  const root = candidate.path, prefix = root === '.' ? '' : `${root}/`;
  const selected = new Map(acquisition.files.filter(file => root === '.' || file.path.startsWith(prefix)).map(file => [file.path.slice(prefix.length), file]));
  const license = acquisition.evidence[candidate.id].licenseFile;
  if (license && !selected.has(license.path.slice(prefix.length))) {
    const original = acquisition.files.find(file => file.path === license.path && file.hash === license.hash);
    if (!original) fail(409, 'preview_changed', 'The reviewed license changed.');
    if (selected.has('LICENSE') && selected.get('LICENSE').hash !== original.hash) fail(409, 'name_conflict', 'The inherited license collides with an owned file.');
    selected.set('LICENSE', original);
  }
  // Notices above a nested package belong to the reviewed license as well.
  if (license) for (const file of acquisition.files.filter(file => path.posix.dirname(file.path) === path.posix.dirname(license.path) && /^NOTICE(?:\.[^/]*)?$/i.test(path.posix.basename(file.path)))) {
    const name = path.posix.basename(file.path);
    if (selected.has(name) && selected.get(name).hash !== file.hash) fail(409, 'name_conflict', 'The inherited notice collides with an owned file.');
    selected.set(name, file);
  }
  const result = [];
  for (const [relative, file] of selected) {
    additionPath(relative);
    const bytes = await readFile(path.join(acquisition.directory, 'tree', ...file.path.split('/')));
    if (hashBytes(bytes) !== file.hash) fail(409, 'preview_changed', 'The reviewed source bytes changed.');
    result.push({ path: relative, hash: file.hash, bytes: bytes.length, data: bytes });
  }
  return result;
}
async function publishCheckout(context, id, acquisition, files) {
  const local = await additionStagingRoot(acquisitionContext(context));
  const directory = path.join(local, 'repositories', id, acquisition.pin.digest);
  const recoveryPath = path.join(local, 'repository-recovery', `${id}-${acquisition.pin.digest}.json`);
  const inventory = files.map(({ data, ...file }) => file);
  const recovery = { format: 'hivem1nd-addition-checkout-v1', id, ...binding(context), pin: acquisition.pin, files: inventory };
  const previous = await readBytes(context.store, recoveryPath);
  if (previous && canonicalJson(JSON.parse(previous)) !== canonicalJson(recovery)) fail(409, 'destination_changed', 'The owned checkout recovery record changed.');
  await writeAdditionLocal(acquisitionContext(context), recoveryPath, jsonBytes(recovery));
  for (const [index, file] of files.entries()) {
    const target = path.join(directory, ...file.path.split('/'));
    await assertNoLinks(target, { root: local });
    const prior = await readBytes(context.store, target);
    if (prior && hashBytes(prior) !== file.hash) fail(409, 'destination_changed', 'The owned checkout has foreign edits.');
    if (!prior) await writeAdditionLocal(acquisitionContext(context), target, file.data);
    if (owner(context).additionFault === `checkout:${index + 1}`) { owner(context).additionFault = null; fail(500, 'injected_crash', 'Checkout publication was interrupted.'); }
  }
  if (canonicalJson(await treeInventory(directory)) !== canonicalJson([...inventory].sort((a, b) => a.path.localeCompare(b.path, 'en')))) fail(409, 'destination_changed', 'The owned checkout failed byte verification.');
  return directory;
}

export async function applyAdditions(context, input) {
  await assertAdditionRequest(context, 'apply', input);
  return withLocalChanges(context.store, () => withLocks(context.store, [`addition:${input.previewId}`, 'settings-content-edit'], async () => {
    const record = await load(context, 'previews', input.previewId);
    const requestHash = hashBytes(Buffer.from(canonicalJson(input)));
    if (record.preview.state === 'accepted') {
      if (record.acceptance?.hash !== requestHash) fail(409, 'preview_changed', 'This preview was already accepted with another selection.');
      await refreshProjects(context); return structuredClone(record.preview.result);
    }
    if (record.preview.state !== 'ready') fail(409, 'preview_changed', 'Wait for a completed source check.');
    const acquisition = await verifiedSource(context, record), scope = await choices(context);
    if (scope.revision !== record.preview.scopeRevision) fail(409, 'scope_changed', 'The selected agents or groups changed since review.');
    const content = await readContent(context), report = await readPublishedSettings(context, input.machine);
    if (record.projectBindingRevision !== await projectBindingRevision(context)) fail(409, 'revision_conflict', 'The local project mapping changed since review.');
    if (content.revision !== input.expectedContentRevision || content.revision !== record.preview.contentRevision
      || (report?.projects.revision ?? null) !== input.expectedProjectRevision || input.expectedProjectRevision !== record.preview.projectRevision) fail(409, 'revision_conflict', 'Content or registered projects changed since review.');
    const items = [], entries = [], repositories = [], names = new Set();
    const existing = await acceptedRecords(context);
    const now = new Date(context.now()).toISOString();
    for (const selection of input.selections) {
      const candidate = acquisition.candidates.find(item => item.id === selection.candidateId);
      if (!candidate?.supported || !['skill', 'docs', 'repository'].includes(candidate.kind)) fail(422, 'unsupported_addition', 'That addition is not supported in 3.0.');
      if (!checkAddition(candidate, acquisition.evidence[candidate.id], context.now()).eligible) fail(422, 'check_failed', 'The reviewed source does not pass the required checks.');
      if (names.has(candidate.name.toLowerCase())) fail(409, 'name_conflict', 'Selected additions have colliding names.');
      names.add(candidate.name.toLowerCase());
      const update = record.updateTarget ? await acceptedRecord(context, record.updateTarget.id) : null;
      if (update && (input.selections.length !== 1 || update.revision !== record.updateTarget.revision || update.record.removed || update.record.name !== candidate.name || update.record.kind !== candidate.kind)) fail(409, 'destination_changed', 'The accepted update target changed.');
      if (!update && existing.some(item => item.record.name.toLowerCase() === candidate.name.toLowerCase())) fail(409, 'name_conflict', 'An accepted addition already owns that name.');
      const resolved = candidate.kind === 'repository' ? (() => {
        if (canonicalJson(selection.scope) !== canonicalJson({ everyUnit: false, units: [], groups: [] })) fail(422, 'invalid_scope', 'A repository creates no content grant.');
        return { scope: selection.scope, unitCount: 0 };
      })() : resolveAdditionScope(selection.scope, scope.snapshot.units.map(item => item.id), scope.snapshot.groups);
      const id = update?.record.id ?? uuidV8(['accepted-addition', record.id, candidate.id]);
      const accepted = { format: 'hivem1nd-addition-v1', id, kind: candidate.kind, name: candidate.name, title: candidate.title, source: acquisition.source, sourcePath: candidate.path,
        pin: acquisition.pin, license: acquisition.evidence[candidate.id].license, publishedAt: acquisition.publishedAt, requirements: candidate.requirements, scope: resolved.scope,
        unitCount: resolved.unitCount, machine: input.machine, projectId: candidate.kind === 'repository' ? candidate.name : null,
        installedAt: update?.record.installedAt ?? now, updatedAt: now, removed: false, files: [] };
      if (update) await verifyOwned(context, update.record);
      if (!update && candidate.kind !== 'repository') {
        const catalog = candidate.kind === 'skill' ? content.features : content.knowledge;
        if (catalog.some(item => item.id.slice(item.id.indexOf(':') + 1).toLowerCase() === candidate.name.toLowerCase())) fail(409, 'name_conflict', 'Existing kit or private content owns that name.');
        const destination = path.join(context.paths.mind, ...contentRoot(accepted).split('/'));
        await assertNoLinks(destination, { root: context.paths.mind });
        if (await lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) fail(409, 'name_conflict', 'A private content destination already exists.');
      }
      const files = await candidateFiles(context, acquisition, candidate);
      if (candidate.kind === 'repository') repositories.push({ record: accepted, acquisition, files });
      else {
        accepted.files = files.map(({ data, ...file }) => ({ ...file, path: `${contentRoot(accepted)}/${file.path}` }));
        for (const file of files) {
          const relative = `${contentRoot(accepted)}/${file.path}`;
          entries.push(changeEntry(context, relative, await readBytes(context.store, path.join(context.paths.mind, ...relative.split('/'))), file.data));
        }
        for (const file of update?.record.files ?? []) if (!accepted.files.some(item => item.path === file.path)) entries.push(changeEntry(context, file.path, await readBytes(context.store, path.join(context.paths.mind, ...file.path.split('/'))), null));
      }
      const bytes = jsonBytes(accepted); validateManifest(accepted, id);
      entries.push(changeEntry(context, `user/additions/${id}.json`, update?.bytes ?? null, bytes));
      items.push(additionView(accepted, revisionOf(bytes)));
    }
    // Validate every visible destination before publishing any owned checkout.
    const projectPlan = await prepareAdditionProjects(context, repositories.map(item => item.record), { checkOnly: true });
    for (const repository of repositories) repository.localPath = await publishCheckout(context, repository.record.id, repository.acquisition, repository.files);
    const projects = repositories.length ? await prepareAdditionProjects(context, repositories.map(item => ({ ...item.record, localPath: item.localPath }))) : projectPlan;
    entries.push(...projects.entries);
    const contentPath = path.join(context.paths.mind, 'user', 'gui', 'content.json'), beforeContent = await readBytes(context.store, contentPath);
    let contentRevision = content.revision;
    if (items.some(item => item.kind !== 'repository')) {
      const saved = beforeContent ? JSON.parse(beforeContent) : { format: 'hivem1nd-content-settings-v1', preferences: content.preferences,
        includedFeatures: content.features.filter(item => item.included).map(item => item.id), includedKnowledge: content.knowledge.filter(item => item.included).map(item => item.id) };
      for (const item of items) if (item.kind !== 'repository') {
        const key = item.kind === 'skill' ? 'includedFeatures' : 'includedKnowledge', id = `${item.kind === 'skill' ? 'feature' : 'knowledge'}:${item.name}`;
        if (!saved[key].includes(id)) saved[key].push(id);
      }
      const after = jsonBytes(saved); contentRevision = revisionOf(after);
      entries.push(changeEntry(context, 'user/gui/content.json', beforeContent, after));
    }
    const changeId = uuidV8(['addition-acceptance', record.id]);
    const events = items.map(item => ({ name: 'additions.changed', data: { additionId: item.id, operation: record.updateTarget ? 'update' : 'add', revision: item.revision } }));
    if (contentRevision !== content.revision) events.push({ name: 'settings.content.changed', data: { revision: contentRevision } });
    events.push(...projects.events);
    const undo = await prepareChangeUndo(context, { id: changeId, permission: 'settings.write', resourceIds: items.map(item => item.id), entries,
      events: [...items.map(item => ({ name: 'additions.changed', data: { additionId: item.id, operation: 'undo', revision: record.updateTarget?.revision ?? null } })), ...undoReportEvents(context, entries)] });
    const result = { items, changeId, undoUntil: undo.undoUntil, contentRevision, projectRevision: projects.revision };
    record.preview.state = 'accepted'; record.preview.result = result; record.acceptedAt = context.now(); record.retainedUntil = context.now() + RETENTION_MS;
    record.acceptance = { ...binding(context), hash: requestHash, request: requestBinding(context), result, manifestHash: acquisition.manifestHash };
    const previewPath = await location(context, 'previews', record.id), beforePreview = await readBytes(context.store, previewPath);
    await commitChange(context, { id: changeId, additionAcceptance: true, entries: [...entries, undo.entry, { resource: `addition-preview:${record.id}`, recordPath: previewPath, beforeRevision: revisionOf(beforePreview), afterBytes: jsonBytes(record), private: true }],
      events, response: { status: 201, body: result } });
    await refreshProjects(context);
    return result;
  }));
}
async function refreshProjects(context) {
  const { refreshAdditionProjects } = await import('./service.mjs');
  await refreshAdditionProjects(context);
}

export async function removeAddition(context, id, input) {
  await assertAdditionRequest(context, 'remove', input, id);
  return withLocalChanges(context.store, async () => {
    const current = await acceptedRecord(context, id);
    if (current.revision !== input.expectedRevision || current.record.removed) fail(409, 'revision_conflict', 'The accepted addition changed.');
    const record = { ...current.record, removed: true, updatedAt: new Date(context.now()).toISOString() };
    const entries = [];
    // Remove only bytes whose hashes still prove ownership; foreign edits remain on disk.
    for (const file of record.files) {
      const absolute = path.join(context.paths.mind, ...file.path.split('/')); await assertNoLinks(absolute, { root: context.paths.mind });
      const before = await readBytes(context.store, absolute);
      if (revisionOf(before) === file.hash) entries.push(changeEntry(context, file.path, before, null));
    }
    const after = jsonBytes(record), revision = revisionOf(after);
    entries.push(changeEntry(context, `user/additions/${id}.json`, current.bytes, after));
    const projects = await prepareAdditionProjects(context, record.kind === 'repository' ? [record] : [], { remove: true });
    entries.push(...projects.entries);
    const contentPath = path.join(context.paths.mind, 'user', 'gui', 'content.json'), before = await readBytes(context.store, contentPath);
    if (record.kind !== 'repository' && before) {
      const saved = JSON.parse(before), key = record.kind === 'skill' ? 'includedFeatures' : 'includedKnowledge';
      saved[key] = saved[key].filter(item => item !== `${record.kind === 'skill' ? 'feature' : 'knowledge'}:${record.name}`);
      entries.push(changeEntry(context, 'user/gui/content.json', before, jsonBytes(saved)));
    }
    const changeId = randomUUID(), undo = await prepareChangeUndo(context, { id: changeId, permission: 'settings.write', resourceIds: [id], entries,
      events: [{ name: 'additions.changed', data: { additionId: id, operation: 'undo', revision: current.revision } }, ...undoReportEvents(context, entries)] });
    const result = { additionId: id, changeId, undoUntil: undo.undoUntil, revision };
    const events = [{ name: 'additions.changed', data: { additionId: id, operation: 'remove', revision } }, ...projects.events];
    const contentEntry = entries.find(entry => entry.recordPath === contentPath);
    if (contentEntry) events.push({ name: 'settings.content.changed', data: { revision: revisionOf(contentEntry.afterBytes) } });
    await commitChange(context, { id: changeId, entries: [...entries, undo.entry], events, response: { status: 200, body: result } });
    await pruneAdditionDirectories(context, record);
    await refreshProjects(context); return result;
  });
}

export async function pruneAdditionDirectories(context, record) {
  if (record.kind === 'repository') return;
  const root = path.join(context.paths.mind, ...contentRoot(record).split('/')), directories = new Set();
  for (const file of record.files) {
    let directory = path.dirname(path.join(context.paths.mind, ...file.path.split('/')));
    while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
      directories.add(directory); if (directory === root) break; directory = path.dirname(directory);
    }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    await assertNoLinks(directory, { root: context.paths.mind });
    await rmdir(directory).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
  }
}

// This reader is given only to an adapter's verified, session-bound content channel.
// There is deliberately no agent HTTP route or all-client skill installation.
export async function readScopedAdditions(context, { unitId, client, sessionId, nativeSessionId }) {
  const adapter = context.adapters?.[client];
  if (!sessionId || adapter?.capabilities?.scopedContent !== true || await adapter.confirm?.({ unitId, client, nativeSessionId, machine: context.paths.machine }) !== true) fail(503, 'scope_unavailable', 'The client cannot enforce scoped content for this session.');
  const session = await readCollection(context, 'sessions', { unitId, limit: 200 });
  if (!session.items.some(item => item.id === sessionId && item.nativeSessionId === nativeSessionId && item.unitId === unitId && item.client === client && item.machine === context.paths.machine && item.state !== 'stopped')) fail(503, 'scope_unavailable', 'The canonical session binding is no longer available.');
  return withLocalChanges(context.store, async () => {
    const snapshot = (await choices(context)).snapshot;
    const content = await readContent(context), result = [];
    for (const item of await acceptedRecords(context)) {
      const record = item.record;
      if (record.removed || record.kind === 'repository' || !allowedUnits(record.scope, snapshot).has(unitId)) continue;
      const selection = record.kind === 'skill' ? content.features : content.knowledge;
      if (!selection.some(value => value.additionId === record.id && value.included)) continue;
      for (const requirement of record.requirements) if (await adapter.runtimeAvailable?.(requirement) !== true) throw new CoreError(503, 'runtime_unavailable', `Required runtime unavailable: ${requirement}.`, { requirement });
      await verifyOwned(context, record);
      result.push({ addition: additionView(record, item.revision, allowedUnits(record.scope, snapshot).size), files: await Promise.all(record.files.map(async file => ({ path: file.path.slice(contentRoot(record).length + 1), bytesBase64: (await readBytes(context.store, path.join(context.paths.mind, ...file.path.split('/')))).toString('base64') }))) });
    }
    return result;
  });
}

export async function additionsForUnit(context, unitId) {
  const records = await acceptedRecords(context);
  if (!records.length) return [];
  const snapshot = (await choices(context)).snapshot;
  const content = await readContent(context);
  return records.filter(item => !item.record.removed && item.record.kind !== 'repository' && allowedUnits(item.record.scope, snapshot).has(unitId)
    && [...content.features, ...content.knowledge].some(value => value.additionId === item.record.id && value.included));
}

export async function additionSyncEligible(context, relative) {
  if (/^user\/machines\/[^/]+\.md$/.test(relative)) {
    const bytes = await readBytes(context.store, path.join(context.paths.mind, ...relative.split('/')));
    if (bytes?.toString('utf8').replaceAll('\\', '/').includes('/additions/repositories/')) return false;
  }
  if (!/^user\/(?:additions|features|knowledge)\//.test(relative)) return true;
  const records = await acceptedRecords(context);
  const record = records.find(item => relative === `user/additions/${item.record.id}.json` || item.record.files.some(file => file.path === relative));
  if (!record) return true;
  if (record.record.machine !== (context.machine ?? context.paths.machine)) return false;
  if (relative.startsWith('user/additions/')) return true;
  const file = record.record.files.find(file => file.path === relative);
  return !record.record.removed && revisionOf(await readBytes(context.store, path.join(context.paths.mind, ...relative.split('/')))) === file.hash;
}

export async function validateAdditionBundle(sync, entries, publishingMachine) {
  const incoming = new Map(entries.filter(item => item.target.kind === 'mind').map(item => [item.target.path, item.deleted ? null : item.bytes]));
  const current = await acceptedRecords(sync), records = new Map(current.map(item => [item.record.id, item.record]));
  for (const [relative, raw] of incoming) {
    const match = /^user\/additions\/([a-f0-9-]{36})\.json$/.exec(relative);
    if (!match) continue;
    if (!raw) { records.delete(match[1]); continue; }
    let record; try { record = validateManifest(JSON.parse(raw), match[1]); } catch { fail(422, 'invalid_pack', 'The accepted addition manifest is invalid.'); }
    if (record.machine !== publishingMachine) fail(422, 'invalid_record_owner', 'Only the accepting owner may publish the addition.');
    if ([...records.values()].some(item => item.id !== record.id && item.name.toLowerCase() === record.name.toLowerCase())) fail(409, 'name_conflict', 'Accepted additions have colliding names.');
    if (!records.has(record.id) && !sync.store.hidden.has(manifestPath(sync, record.id)) && record.kind !== 'repository') {
      for (const root of [path.join(sync.paths.mind, ...contentRoot(record).split('/')), path.join(sync.paths.mind, record.kind === 'skill' ? 'features' : 'knowledge', record.name)]) {
        if ((await treeInventory(root)).length) fail(409, 'name_conflict', 'A private or kit destination already owns the imported name.');
      }
    }
    records.set(record.id, record);
  }
  const owns = file => [...records.values()].find(record => record.files.some(item => item.path === file));
  for (const [relative, raw] of incoming) {
    if (!/^user\/(features|knowledge)\//.test(relative)) continue;
    const record = owns(relative), prior = current.find(item => item.record.files.some(file => file.path === relative));
    if (!record && !prior) continue;
    if ((record ?? prior.record).machine !== publishingMachine) fail(422, 'invalid_record_owner', 'Only the accepting owner may publish imported bytes.');
    const expected = record?.files.find(file => file.path === relative);
    if (raw && (!record || record.removed || hashBytes(raw) !== expected?.hash || raw.length !== expected?.bytes)
      || !raw && record && !record.removed && expected) fail(422, 'invalid_pack', 'Imported bytes do not match accepted ownership.');
  }
  for (const record of records.values()) {
    if (record.removed || !incoming.has(`user/additions/${record.id}.json`)) continue;
    for (const file of record.files) {
      const raw = incoming.has(file.path) ? incoming.get(file.path) : await readBytes(sync.store, path.join(sync.paths.mind, ...file.path.split('/')));
      if (!raw || hashBytes(raw) !== file.hash || raw.length !== file.bytes) fail(422, 'invalid_pack', 'The accepted content bundle is incomplete or changed.');
    }
  }
}
