import { lstat, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, hashText, uuidV8 } from '../service/identity.mjs';
import { resolveTarget } from '../service/paths.mjs';
import { atomicWrite, exclusiveRecord, readBytes, withLocks } from '../service/store.mjs';
import { compressObject, decompressObject, isTemporaryName, normalizeTarget, resolveDependencies, validateChange } from './pack.mjs';

const LOCK = 'sync-stage';
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function openSync({ store, paths, now = () => Date.now(), projects = [] } = {}) {
  if (!store || !paths?.localDirectory || !paths?.mind || !paths?.machine) {
    throw new CoreError(500, 'internal_error', 'Sync needs a store and service paths.');
  }
  return { store, paths, now, projects, machine: paths.machine };
}

export function targetKey(target) {
  return hashText(canonicalJson(normalizeTarget(target)));
}

export async function eligibleTargets(sync) {
  const targets = [];
  await walkMind(sync, targets);
  for (const project of sync.projects) {
    if (!project?.localPath || project.eligible === false) continue;
    targets.push(...await projectTargets(sync, project));
  }
  const unique = new Map();
  for (const target of targets) unique.set(`${target.kind}\0${target.project ?? ''}\0${target.path}`, target);
  return [...unique.values()].sort((left, right) => targetKey(left).localeCompare(targetKey(right)));
}

export async function observeLocalChange(sync, target, options = {}) {
  return withLocks(sync.store, [LOCK], () => observeUnlocked(sync, target, options));
}

export async function stageTransaction(sync, entries, options = {}) {
  return withLocks(sync.store, [LOCK], () => stageUnlocked(sync, entries, options));
}

export async function stageBaselines(sync, at = timestamp(sync.now())) {
  const staged = [];
  for (const target of await eligibleTargets(sync)) {
    const located = await resolveTarget(sync.paths, target, { projects: sync.projects });
    const bytes = await readBytes(sync.store, located.absolute);
    if (!bytes) continue;
    const result = await observeLocalChange(sync, target, { bytes, at });
    if (result.staged) staged.push(result.change);
  }
  return staged;
}

export async function readObject(sync, hash) {
  if (!/^[0-9a-f]{64}$/.test(hash ?? '')) throw new CoreError(422, 'invalid_pack', 'The object hash is not valid.');
  const bytes = await readBytes(sync.store, objectPath(sync, hash));
  if (!bytes) throw new CoreError(404, 'not_found', 'The staged object does not exist.');
  const raw = decompressObject(bytes, 16000000);
  if (hashBytes(raw) !== hash) throw new CoreError(422, 'corrupt_resource', 'The staged object does not match its hash.');
  return raw;
}

export async function ackPublished(sync, ids) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new CoreError(422, 'invalid_body', 'Published ids must be a list.');
  return withLocks(sync.store, [LOCK], async () => {
    const acked = [];
    for (const id of ids) {
      const source = changePath(sync, id);
      const destination = ackedPath(sync, id);
      const bytes = await readBytes(sync.store, source);
      if (!bytes) {
        const done = await readBytes(sync.store, destination);
        if (done) acked.push(id);
        continue;
      }
      await exclusiveRecord(sync.store, destination, bytes).catch(async (error) => {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await readBytes(sync.store, destination);
        if (!existing || !existing.equals(bytes)) throw new CoreError(409, 'revision_conflict', 'The published change does not match the staged bytes.');
      });
      await unlink(source);
      acked.push(id);
    }
    return { acked };
  });
}

export async function listStaged(sync) {
  return stagedChanges(sync);
}

export async function resolveIncoming(sync, packBytes, provider) {
  const result = await resolveDependencies(packBytes, provider);
  const file = pendingPath(sync, result.decoded.header.machine, result.decoded.header.sequence);
  if (result.status !== 'pending') {
    await removeFile(sync, file);
    return result;
  }
  const existing = await readBytes(sync.store, file);
  let firstSeenAt = timestamp(sync.now());
  if (existing) {
    try {
      const parsed = JSON.parse(existing.toString('utf8'));
      if (typeof parsed.firstSeenAt === 'string' && TIME.test(parsed.firstSeenAt)) firstSeenAt = parsed.firstSeenAt;
    } catch {
      firstSeenAt = timestamp(sync.now());
    }
  }
  const record = { packHash: result.packHash, dependencies: result.missing, firstSeenAt };
  await atomicWrite(sync.store, file, Buffer.from(`${canonicalJson(record)}\n`, 'utf8'));
  return result;
}

async function observeUnlocked(sync, target, options) {
  const normalized = await prepareTarget(sync, target);
  const key = targetKey(normalized);
  const at = options.at ? requireTime(options.at) : timestamp(sync.now());
  const deleted = options.deleted === true;
  if (!deleted && options.bytes == null) throw new CoreError(422, 'invalid_body', 'A change needs its bytes.');
  const nextHash = deleted ? null : hashBytes(Buffer.isBuffer(options.bytes) ? options.bytes : Buffer.from(options.bytes));
  if (options.applied === true) {
    const id = uuidV8(['applied', sync.machine, key, nextHash ?? 'deleted', at]);
    await atomicWrite(sync.store, markerPath(sync, key), Buffer.from(`${canonicalJson({ hash: nextHash, deleted, at, id })}\n`, 'utf8'));
    return { staged: false, applied: true };
  }
  const marker = await readJson(sync, markerPath(sync, key));
  if (marker) {
    const matches = marker.deleted === true ? deleted : marker.hash === nextHash;
    if (!matches) return { staged: false, held: true };
    await writeVersion(sync, key, { hash: nextHash, at, machine: sync.machine, id: marker.id, deleted });
    await removeFile(sync, markerPath(sync, key));
    return { staged: false, cleared: true };
  }
  const pending = (await stagedChanges(sync)).find((change) => targetKey(change.target) === key && change.hash === nextHash && change.operation === (deleted ? 'delete' : 'put'));
  if (pending) return { staged: false, unchanged: true, change: pending };
  const current = (await readVersions(sync)).targets[key] ?? null;
  if (current && current.deleted === deleted && current.hash === nextHash) return { staged: false, unchanged: true };
  const [change] = await stageUnlocked(sync, [{
    target: normalized,
    bytes: options.bytes,
    deleted,
    at,
    id: options.id,
    baseHash: current && !current.deleted ? current.hash : null,
    messageId: options.messageId ?? null,
  }]);
  return { staged: true, change };
}

async function stageUnlocked(sync, entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new CoreError(422, 'invalid_body', 'A transaction needs at least one change.');
  const transactionId = options.transactionId ?? null;
  if (transactionId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(transactionId)) {
    throw new CoreError(422, 'invalid_body', 'The transaction id must be a UUID.');
  }
  const atDefault = options.at ? requireTime(options.at) : timestamp(sync.now());
  const prepared = [];
  for (const entry of entries) {
    const normalized = await prepareTarget(sync, entry.target);
    const deleted = entry.deleted === true;
    const raw = deleted ? null : Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes ?? '');
    if (!deleted && entry.bytes == null) throw new CoreError(422, 'invalid_body', 'A change needs its bytes.');
    const at = entry.at ? requireTime(entry.at) : atDefault;
    const hash = raw ? hashBytes(raw) : null;
    const id = entry.id ?? uuidV8(['change', sync.machine, canonicalJson(normalized), deleted ? 'delete' : 'put', hash ?? 'deleted', at]);
    const change = validateChange({
      format: 'hivem1nd-change-v1',
      id,
      machine: sync.machine,
      at,
      target: normalized,
      operation: deleted ? 'delete' : 'put',
      hash,
      size: raw ? raw.length : 0,
      baseHash: entry.baseHash ?? null,
      messageId: entry.messageId ?? null,
      transactionId,
    }, sync.machine);
    prepared.push({ change, raw });
  }
  for (const item of prepared) {
    if (!item.raw) continue;
    await publishObject(sync, item.change.hash, item.raw);
  }
  for (const item of prepared) await publishChange(sync, item.change);
  if (transactionId) {
    const record = { id: transactionId, changeIds: prepared.map((item) => item.change.id) };
    await exclusiveRecord(sync.store, path.join(sync.paths.localDirectory, 'staging', 'transactions', `${transactionId}.json`), Buffer.from(`${canonicalJson(record)}\n`, 'utf8'));
  }
  const versions = await readVersions(sync);
  for (const item of prepared) {
    versions.targets[targetKey(item.change.target)] = {
      hash: item.change.hash,
      at: item.change.at,
      machine: item.change.machine,
      id: item.change.id,
      deleted: item.change.operation === 'delete',
    };
  }
  await atomicWrite(sync.store, versionPath(sync), Buffer.from(`${canonicalJson(versions)}\n`, 'utf8'));
  return prepared.map((item) => item.change);
}

async function publishObject(sync, hash, raw) {
  const compressed = compressObject(raw);
  try {
    await exclusiveRecord(sync.store, objectPath(sync, hash), compressed);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readBytes(sync.store, objectPath(sync, hash));
    if (!existing) throw error;
    const decoded = decompressObject(existing, raw.length === 0 ? 1 : raw.length);
    if (!decoded.equals(raw)) throw new CoreError(422, 'corrupt_resource', 'The staged object does not match its hash.');
  }
}

async function publishChange(sync, change) {
  const bytes = Buffer.from(`${canonicalJson(change)}\n`, 'utf8');
  try {
    await exclusiveRecord(sync.store, changePath(sync, change.id), bytes);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readBytes(sync.store, changePath(sync, change.id));
    if (!existing || !existing.equals(bytes)) throw new CoreError(409, 'revision_conflict', 'The staged change already exists with different bytes.');
  }
}

async function prepareTarget(sync, target) {
  const normalized = normalizeTarget(target);
  if (normalized.kind === 'project') {
    const project = sync.projects.find((item) => item.name === normalized.project && item.localPath && item.eligible !== false);
    if (!project) throw new CoreError(409, 'project_unavailable', 'The project is not registered on this machine.');
    const allowed = await projectPathSet(project);
    if (!allowed.has(normalized.path)) throw new CoreError(422, 'invalid_pack', 'The target is not an eligible record.');
  }
  await resolveTarget(sync.paths, normalized, { projects: sync.projects });
  return normalized;
}

async function walkMind(sync, targets) {
  await walkDirectory(sync.paths.mind, '', async (relative, absolute) => {
    if (!relative.startsWith('user/')) return;
    if (isInside(sync.paths.origin, absolute) || isInside(sync.paths.localDirectory, absolute) || isInside(sync.paths.staging, absolute)) return;
    try {
      targets.push(normalizeTarget({ kind: 'mind', path: relative }));
    } catch {
      return;
    }
  });
}

async function walkDirectory(root, relative, visit) {
  let entries;
  try {
    entries = await readdir(path.join(root, ...relative.split('/').filter(Boolean)), { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(root, ...next.split('/'));
    if (entry.isDirectory()) {
      const stats = await lstat(full);
      if (stats.isSymbolicLink()) continue;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (next === 'user/relay/sessions' || next === 'user/relay/leases' || next === 'user/relay/credentials') continue;
      await walkDirectory(root, next, visit);
      continue;
    }
    if (!entry.isFile()) continue;
    await visit(next, full);
  }
}

async function projectTargets(sync, project) {
  const allowed = await projectPathSet(project);
  const targets = [];
  for (const relative of allowed) {
    const absolute = path.resolve(project.localPath, ...relative.split('/'));
    if (isInside(sync.paths.origin, absolute) || isInside(sync.paths.localDirectory, absolute)) continue;
    if (!(await isRegular(absolute))) continue;
    targets.push({ kind: 'project', project: project.name, path: relative });
  }
  return targets;
}

export async function projectPathSet(project) {
  const allowed = new Set();
  const add = (relative) => {
    try {
      allowed.add(normalizeTarget({ kind: 'project', project: project.name, path: relative }).path);
    } catch {
      return;
    }
  };
  if (await isRegular(path.join(project.localPath, 'gui', 'resources.json'))) add('gui/resources.json');
  for (const resource of await readCatalog(project)) {
    if (resource?.project !== project.name || typeof resource.path !== 'string') continue;
    add(resource.path);
    for (const sidecar of sidecars(resource)) add(sidecar);
    const absolute = path.join(project.localPath, ...String(resource.path).split('/'));
    if (await isRegular(absolute)) {
      for (const asset of referencedAssets(await readFile(absolute))) add(asset);
    }
  }
  return allowed;
}

function sidecars(resource) {
  const out = [];
  if (resource.kind === 'void' && typeof resource.path === 'string' && resource.path.endsWith('.json')) {
    const stem = resource.path.slice(0, -'.json'.length);
    out.push(`${stem}.orig.json`, `${stem}.versions.jsonl`, `${stem}.comments.json`);
  }
  if (resource.kind === 'blueprint') {
    out.push('docs/flows/boards/index.json');
    if (typeof resource.legacyId === 'string' && resource.legacyId) out.push(`docs/flows/comments/${resource.legacyId}.json`);
  }
  return out;
}

function referencedAssets(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return [];
  }
  const found = [];
  const visit = (value, depth) => {
    if (depth > 40) return;
    if (typeof value === 'string' && value.startsWith('docs/flows/assets/')) found.push(value);
    else if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
    else if (value && typeof value === 'object') Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  visit(parsed, 1);
  return found;
}

async function readCatalog(project) {
  const file = path.join(project.localPath, 'gui', 'resources.json');
  if (!(await isRegular(file))) return [];
  try {
    const parsed = JSON.parse((await readFile(file)).toString('utf8'));
    return parsed?.format === 'hivem1nd-resources-v1' && Array.isArray(parsed.resources) ? parsed.resources : [];
  } catch {
    return [];
  }
}

async function stagedChanges(sync) {
  const directory = path.join(sync.paths.localDirectory, 'staging', 'changes');
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const changes = [];
  for (const name of names) {
    if (!name.endsWith('.json') || isTemporaryName(name)) continue;
    const parsed = await readJson(sync, path.join(directory, name));
    if (parsed) changes.push(parsed);
  }
  return changes;
}

async function readVersions(sync) {
  const parsed = await readJson(sync, versionPath(sync));
  if (!parsed) return { format: 'hivem1nd-sync-versions-v1', targets: {} };
  if (parsed.format !== 'hivem1nd-sync-versions-v1' || !parsed.targets || typeof parsed.targets !== 'object') {
    throw new CoreError(422, 'corrupt_resource', 'The sync version record is not valid.');
  }
  return parsed;
}

async function writeVersion(sync, key, value) {
  const versions = await readVersions(sync);
  versions.targets[key] = value;
  await atomicWrite(sync.store, versionPath(sync), Buffer.from(`${canonicalJson(versions)}\n`, 'utf8'));
}

async function readJson(sync, file) {
  const bytes = await readBytes(sync.store, file);
  if (!bytes) return null;
  return JSON.parse(bytes.toString('utf8'));
}

async function isRegular(file) {
  try {
    const stats = await lstat(file);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function removeFile(sync, file) {
  if (!isInside(sync.paths.localDirectory, file)) throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the local service directory.');
  await unlink(file).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

function pendingPath(sync, machine, sequence) {
  return path.join(sync.paths.localDirectory, 'received', 'pending', machine, `${sequence}.json`);
}

function objectPath(sync, hash) {
  return path.join(sync.paths.localDirectory, 'staging', 'objects', `${hash}.br`);
}

function changePath(sync, id) {
  return path.join(sync.paths.localDirectory, 'staging', 'changes', `${id}.json`);
}

function ackedPath(sync, id) {
  return path.join(sync.paths.localDirectory, 'staging', 'acked', `${id}.json`);
}

function markerPath(sync, key) {
  return path.join(sync.paths.localDirectory, 'staging', 'applied', `${key}.json`);
}

function versionPath(sync) {
  return path.join(sync.paths.localDirectory, 'sync-versions.json');
}

function timestamp(now) {
  return requireTime(new Date(now).toISOString());
}

function requireTime(value) {
  if (typeof value !== 'string' || !TIME.test(value)) throw new CoreError(422, 'invalid_body', 'The change time must be UTC.');
  return value;
}

function isInside(parent, child) {
  if (!parent || !child) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
