import { randomBytes, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, hashText, isUuid, uuidV8 } from './identity.mjs';
import { assertNoLinks, safeRelative } from './paths.mjs';
import { protectLocalFile } from './security.mjs';
import { clearResource } from './watch.mjs';

export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const localChanges = new AsyncLocalStorage();

function createLockTable() {
  const tails = new Map();
  return {
    async acquire(key) {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const previous = tails.get(key) ?? Promise.resolve();
      const next = previous.then(() => gate);
      tails.set(key, next);
      next.then(() => {
        if (tails.get(key) === next) tails.delete(key);
      });
      await previous;
      return release;
    },
  };
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function refuseProject() {
  throw new CoreError(422, 'unsafe_path', 'Refusing to write outside a registered project.');
}

function canonicalTarget(target) {
  try {
    if (!target || target.kind !== 'project' || typeof target.project !== 'string' || target.project === '') refuseProject();
    return { kind: 'project', project: target.project, path: safeRelative(target.path) };
  } catch (error) {
    if (error instanceof CoreError && error.code === 'unsafe_path') throw error;
    refuseProject();
  }
}

export function bindProjects(store, projects = []) {
  const next = [];
  for (const project of projects ?? []) {
    if (!project || typeof project.name !== 'string' || project.name === '' || typeof project.localPath !== 'string') continue;
    if (project.eligible === false) continue;
    next.push({ name: project.name, localPath: path.resolve(project.localPath), eligible: true });
  }
  store.projects = next;
}

function resolveRegistered(store, target) {
  const canonical = canonicalTarget(target);
  const project = (store.projects ?? []).find((item) => item.name === canonical.project && item.localPath);
  if (!project) refuseProject();
  const root = path.resolve(project.localPath);
  const resolved = path.resolve(root, ...canonical.path.split('/'));
  if (resolved === root || !isInside(root, resolved)) refuseProject();
  if (store.confineRoot && !isInside(store.confineRoot, resolved)) {
    throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the test root.');
  }
  return { resolved, canonical };
}

export function resolveAuthorized(store, target) {
  return assertAllowed(store, target);
}

function assertAllowed(store, target) {
  if (target && typeof target === 'object' && target.kind === 'project') return resolveRegistered(store, target).resolved;
  const resolved = path.resolve(target);
  if (![store.mindPath, store.localDirectory].some((root) => root && isInside(root, resolved))) {
    throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the mind or local service directory.');
  }
  if (store.confineRoot && !isInside(store.confineRoot, resolved)) {
    throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the test root.');
  }
  return resolved;
}

function assertBeside(store, destination, temporary) {
  const resolved = path.resolve(temporary);
  if (destination && typeof destination === 'object' && destination.kind === 'project') {
    const parent = path.dirname(assertAllowed(store, destination));
    if (path.dirname(resolved) !== parent || !isInside(parent, resolved)) refuseProject();
    if (store.confineRoot && !isInside(store.confineRoot, resolved)) {
      throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the test root.');
    }
    return resolved;
  }
  return assertAllowed(store, temporary);
}

function sidecarsOf(resource, normalized) {
  const out = [];
  if (resource.kind === 'void' && normalized.endsWith('.json')) {
    const stem = normalized.slice(0, -'.json'.length);
    out.push(`${stem}.orig.json`, `${stem}.versions.jsonl`, `${stem}.comments.json`);
  }
  if (resource.kind === 'blueprint') {
    out.push('docs/flows/boards/index.json');
    const legacyId = resource.legacyId;
    if (typeof legacyId === 'string' && legacyId !== '' && !legacyId.includes('/') && !legacyId.includes('\\') && legacyId !== '.' && legacyId !== '..') {
      out.push(`docs/flows/comments/${legacyId}.json`);
    }
  }
  return out;
}

function catalogAllows(catalog, projectName, relative) {
  if (relative === 'docs/flows/library.json') return true;
  if (relative === 'docs/flows/boards/index.json') return true;
  const resources = Array.isArray(catalog?.resources) ? catalog.resources : [];
  const mine = resources.filter((item) => item?.project === projectName && typeof item.path === 'string');
  if (mine.length === 0) return false;
  const allowed = new Set();
  let blueprint = false;
  for (const resource of mine) {
    let normalized;
    try {
      normalized = safeRelative(resource.path);
    } catch {
      continue;
    }
    allowed.add(normalized);
    if (resource.kind === 'blueprint') blueprint = true;
    for (const sidecar of sidecarsOf(resource, normalized)) allowed.add(sidecar);
  }
  if (allowed.has(relative)) return true;
  if (mine.some((resource) => relative.startsWith(`docs/flows/history/${resource.id}/`)
    && isUuid(relative.slice(`docs/flows/history/${resource.id}/`.length).replace(/\.(document\.|comments\.)?json$/, ''))
    && /^[0-9a-f-]{36}\.(json|document\.json|comments\.json)$/.test(relative.slice(`docs/flows/history/${resource.id}/`.length)))) return true;
  return (blueprint || mine.some((item) => item.kind === 'void')) && /^docs\/flows\/assets\/[^/]+$/.test(relative);
}

async function catalogSnapshot(store, entries = []) {
  const catalogPath = path.resolve(store.mindPath, 'user', 'gui', 'resources.json');
  let parsed = null;
  const current = await readBytesRaw(catalogPath);
  if (current) {
    try {
      parsed = JSON.parse(current.toString('utf8'));
    } catch {
      parsed = null;
    }
  }
  for (const entry of entries) {
    if (!entry?.recordPath || path.resolve(entry.recordPath) !== catalogPath) continue;
    const bytes = Buffer.isBuffer(entry.afterBytes) ? entry.afterBytes : Buffer.from(entry.afterBytesBase64 ?? '', 'base64');
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new CoreError(422, 'invalid_body', 'The resource catalog is not JSON.');
    }
  }
  return parsed;
}

function materialize(store, entry) {
  if (entry?.target?.kind === 'project') return resolveAuthorized(store, entry.target);
  return assertAllowed(store, entry.recordPath);
}

export function createStore({ root, mindPath, localDirectory, now = () => Date.now(), events = [], confineRoot = null, autoRecover = true, projects = [] } = {}) {
  if (!root || !mindPath || !localDirectory) throw new CoreError(500, 'internal_error', 'A store needs a root, mind, and local directory.');
  const store = {
    root: path.resolve(root),
    mindPath: path.resolve(mindPath),
    localDirectory: path.resolve(localDirectory),
    confineRoot: confineRoot ? path.resolve(confineRoot) : null,
    now,
    events,
    locks: createLockTable(),
    hidden: new Map(),
    fault: null,
    writes: [],
    recovered: false,
    recovering: false,
    autoRecover,
    projects: [],
  };
  bindProjects(store, projects);
  return store;
}

export function revisionOf(bytes) {
  return bytes == null ? null : hashBytes(bytes);
}

export async function withLocks(store, keys, operation) {
  const ordered = [...new Set(keys)].sort();
  const releases = [];
  try {
    for (const key of ordered) releases.push(await store.locks.acquire(key));
    return await operation();
  } finally {
    while (releases.length > 0) releases.pop()();
  }
}

export async function withLocalChanges(store, operation) {
  const inherited = localChanges.getStore();
  if (inherited?.get(store)?.active) return operation();
  return withLocks(store, ['local-observation'], () => {
    const lease = { active: true };
    const owners = new Map(inherited ?? []);
    owners.set(store, lease);
    return localChanges.run(owners, async () => {
      try {
        return await operation();
      } finally {
        lease.active = false;
      }
    });
  });
}

async function readBytesRaw(filePath) {
  const resolved = path.resolve(filePath);
  try {
    const stats = await lstat(resolved);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new CoreError(422, 'unsafe_path', 'Refusing to read a link.');
    const handle = await open(resolved, 'r');
    try {
      const size = (await handle.stat()).size;
      const bytes = Buffer.alloc(size);
      if (size > 0) await handle.read(bytes, 0, size, 0);
      return bytes;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureRecovered(store) {
  if (store.autoRecover === false || store.recovered || store.recovering) return;
  await recoverTransactions(store);
  store.recovered = true;
}

export async function readBytes(store, filePath) {
  await ensureRecovered(store);
  const resolved = path.resolve(filePath);
  if (store.hidden.has(resolved)) return store.hidden.get(resolved);
  return readBytesRaw(resolved);
}

export async function readRecord(store, filePath) {
  const bytes = await readBytes(store, filePath);
  return { path: path.resolve(filePath), bytes, revision: revisionOf(bytes) };
}

export function checkRevision(currentBytes, expected) {
  const current = revisionOf(currentBytes);
  if (current !== expected) {
    throw new CoreError(409, 'revision_conflict', 'The record changed since it was read.', { currentRevision: current });
  }
  return current;
}

export async function atomicWrite(store, destination, bytes) {
  const target = assertAllowed(store, destination);
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  await assertNoLinks(target, { root: store.confineRoot });
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(8).toString('hex')}.tmp`);
  assertBeside(store, destination, temporary);
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  await renameReplacing(temporary, target, payload);
  store.writes.push(target);
  return target;
}

async function renameReplacing(temporary, target, payload) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(temporary, target);
      return;
    } catch (error) {
      last = error;
      if (error?.code === 'ENOENT') {
        const existing = await readBytesRaw(target);
        if (existing && existing.equals(payload)) return;
      }
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || attempt === 5) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5 * (attempt + 1));
        timer.unref?.();
      });
    }
  }
  await unlink(temporary).catch(() => {});
  throw last;
}

export async function exclusiveRecord(store, destination, bytes) {
  const target = assertAllowed(store, destination);
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  await assertNoLinks(target, { root: store.confineRoot });
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, 'wx');
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(target).catch(() => {});
    throw error;
  }
  await handle.close();
  store.writes.push(target);
  return target;
}

function journalFile(store, id) {
  return path.join(store.localDirectory, 'transactions', `${id}.json`);
}

function receiptFile(store, principalHash, key) {
  return path.join(store.localDirectory, 'receipts', principalHash, `${key}.json`);
}

function journalBytes(journal) {
  return Buffer.from(`${canonicalJson(journal)}\n`, 'utf8');
}

async function writeReceipt(store, receipt) {
  const safe = {
    principalHash: receipt.principalHash,
    key: receipt.key,
    method: receipt.method,
    path: receipt.path,
    bodyHash: receipt.bodyHash,
    status: receipt.status,
    response: receipt.response,
    requestId: receipt.requestId,
    eventCursor: receipt.eventCursor ?? null,
    createdAt: receipt.createdAt,
    expiresAt: receipt.expiresAt,
  };
  await atomicWrite(store, receiptFile(store, safe.principalHash, safe.key), journalBytes(safe));
  return safe;
}

async function readReceipt(store, principalHash, key) {
  const bytes = await readBytesRaw(receiptFile(store, principalHash, key));
  if (!bytes) return null;
  return JSON.parse(bytes.toString('utf8'));
}

function emit(store, events) {
  for (const event of events ?? []) {
    if (event.name === 'editor.removed') {
      const id = event.resourceId ?? event.data?.resourceId;
      const watch = store.changeWatch;
      if (watch) {
        clearResource(watch, id);
        watch.handles.get(id)?.close?.();
        watch.handles.delete(id);
      }
    }
    store.events.push(structuredClone(event));
  }
}

export async function commitTransaction(store, prepared) {
  await ensureRecovered(store);
  if (!isUuid(prepared?.id)) throw new CoreError(422, 'invalid_body', 'The transaction id must be a UUID.');
  const source = prepared.entries ?? [];
  if (source.length === 0) throw new CoreError(422, 'invalid_body', 'A transaction needs at least one record.');
  const resources = source.map((entry) => entry.resource);
  if (new Set(resources).size !== resources.length) throw new CoreError(422, 'invalid_body', 'A transaction cannot change one resource twice.');
  return withLocks(store, resources, () => commitLocked(store, prepared));
}

async function commitLocked(store, prepared) {
  const checked = [];
  const beforeCatalog = await catalogSnapshot(store);
  const catalog = await catalogSnapshot(store, prepared.entries);
  const destinations = new Set();
  for (const entry of prepared.entries) {
    if (typeof entry.resource !== 'string' || entry.resource === '') throw new CoreError(422, 'invalid_body', 'A transaction entry needs a resource key.');
    const canonical = entry.target?.kind === 'project' ? canonicalTarget(entry.target) : null;
    const operation = entry.operation ?? 'put';
    if (!['put', 'delete'].includes(operation)) throw new CoreError(422, 'invalid_body', 'The journal operation is not valid.');
    if (canonical && !catalogAllows(operation === 'delete' ? beforeCatalog : catalog, canonical.project, canonical.path)) refuseProject();
    const destination = canonical ?? entry.recordPath;
    const recordPath = assertAllowed(store, destination);
    if (destinations.has(recordPath)) throw new CoreError(422, 'invalid_body', 'A transaction cannot change one path twice.');
    destinations.add(recordPath);
    await assertNoLinks(path.dirname(recordPath), { root: store.confineRoot });
    await assertNoLinks(recordPath, { root: store.confineRoot });
    const current = await readBytesRaw(recordPath);
    checkRevision(current, entry.beforeRevision ?? null);
    const afterBytes = operation === 'delete' ? null : Buffer.isBuffer(entry.afterBytes) ? entry.afterBytes : Buffer.from(entry.afterBytesBase64 ?? '', 'base64');
    const afterRevision = revisionOf(afterBytes);
    if (canonical?.path.startsWith('docs/flows/history/') && operation !== 'delete') {
      if (afterBytes.length > 16_000_000) throw new CoreError(413, 'resource_too_large', 'A history object exceeds 16 MB.');
      if (current && !current.equals(afterBytes)) throw new CoreError(409, 'corrupt_resource', 'An immutable history object cannot be replaced.');
    }
    if (Object.hasOwn(entry, 'afterRevision') && entry.afterRevision !== undefined && entry.afterRevision !== afterRevision) {
      throw new CoreError(409, 'revision_conflict', 'The prepared bytes do not match the declared revision.', { currentRevision: revisionOf(current) });
    }
    const saved = {
      resource: canonical ? `project:${canonical.project}:${canonical.path}` : entry.resource,
      beforeRevision: entry.beforeRevision ?? null,
      beforeBytesBase64: current?.toString('base64') ?? null,
      operation,
      afterRevision,
      afterBytesBase64: afterBytes?.toString('base64') ?? null,
      recordPath,
      record: entry.record ?? null,
      private: entry.private === true,
      current,
    };
    if (canonical) saved.target = canonical;
    checked.push(saved);
  }
  const receipt = prepared.receipt ? {
    principalHash: prepared.receipt.principalHash,
    key: prepared.receipt.key,
    method: prepared.receipt.method,
    path: prepared.receipt.path,
    bodyHash: prepared.receipt.bodyHash,
    status: prepared.response?.status ?? 200,
    response: prepared.response?.body ?? null,
    requestId: prepared.receipt.requestId,
    eventCursor: prepared.receipt.eventCursor ?? null,
    createdAt: prepared.receipt.createdAt,
    expiresAt: prepared.receipt.expiresAt,
  } : null;
  const entries = checked.map(({ current, ...entry }) => entry);
  const journal = {
    id: prepared.id,
    phase: 'prepared',
    entries,
    receipt,
    events: prepared.events ?? [],
    emitted: false,
    staged: false,
    sync: prepared.sync ?? null,
    conflicts: [],
    catalogs: { before: beforeCatalog, after: catalog },
  };
  if (entries.length === 1) {
    journal.resource = entries[0].resource;
    journal.beforeRevision = entries[0].beforeRevision;
    journal.afterRevision = entries[0].afterRevision;
    journal.afterBytesBase64 = entries[0].afterBytesBase64;
    journal.recordPath = entries[0].recordPath;
    journal.record = entries[0].record;
  }
  for (const entry of checked) store.hidden.set(entry.recordPath, entry.current);
  await atomicWrite(store, journalFile(store, prepared.id), journalBytes(journal));
  try {
    if (entries.some((entry) => entry.operation === 'delete')) await protectLocalFile(journalFile(store, prepared.id), { store });
    if (store.fault?.afterPrepared) {
      store.fault = null;
      throw new CoreError(500, 'injected_crash', 'Injected crash after journal preparation.');
    }
    let renamed = 0;
    for (const entry of entries) {
      const destination = entry.target?.kind === 'project' ? entry.target : entry.recordPath;
      await applyJournalEntry(store, entry, destination);
      renamed += 1;
      if (store.fault?.afterRenames === renamed) {
        store.fault = null;
        throw new CoreError(500, 'injected_crash', 'Injected crash after a partial transaction.');
      }
    }
    if (store.fault?.beforeReceipt) {
      store.fault = null;
      throw new CoreError(500, 'injected_crash', 'Injected crash before the receipt was published.');
    }
    await stageJournal(store, journal);
    if (store.fault?.afterStage) {
      store.fault = null;
      throw new CoreError(500, 'injected_crash', 'Injected crash after sync staging.');
    }
    if (receipt) await writeReceipt(store, receipt);
    if (store.fault?.afterReceipt) {
      store.fault = null;
      throw new CoreError(500, 'injected_crash', 'Injected crash after receipt publication.');
    }
    const committed = { ...journal, phase: 'committed', emitted: true, staged: true };
    await atomicWrite(store, journalFile(store, prepared.id), journalBytes(committed));
    for (const entry of entries) store.hidden.delete(entry.recordPath);
    emit(store, journal.events);
    if (journal.sync) for (const event of journal.events) store.changeBus?.emit(event);
    return { status: receipt?.status ?? prepared.response?.status ?? 200, body: receipt?.response ?? prepared.response?.body ?? null, id: prepared.id };
  } catch (error) {
    store.recovered = false;
    throw error;
  }
}

export async function recoverTransactions(store) {
  return withLocalChanges(store, () => recoverTransactionsLocked(store));
}

async function applyJournalEntry(store, entry, destination) {
  if (entry.operation === 'delete') {
    const file = assertAllowed(store, destination);
    await assertNoLinks(file, { root: store.confineRoot });
    await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    store.writes.push(file);
  } else {
    await atomicWrite(store, destination, Buffer.from(entry.afterBytesBase64, 'base64'));
    if (entry.private) await protectLocalFile(entry.recordPath, { store });
  }
}

async function recoverTransactionsLocked(store) {
  if (store.recovering) return [];
  store.recovering = true;
  try {
    const directory = path.join(store.localDirectory, 'transactions');
    let names;
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const recovered = [];
    for (const name of names) recovered.push(await recoverOne(store, name.slice(0, -'.json'.length)));
    return recovered.filter(Boolean);
  } finally {
    store.recovering = false;
  }
}

async function recoverOne(store, id) {
  const file = journalFile(store, id);
  const bytes = await readBytesRaw(file);
  if (!bytes) return null;
  const journal = JSON.parse(bytes.toString('utf8'));
  const keys = (journal.entries ?? []).map((entry) => entry.resource);
  return withLocks(store, keys, async () => {
    const freshBytes = await readBytesRaw(file);
    if (!freshBytes) return null;
    const fresh = JSON.parse(freshBytes.toString('utf8'));
    if (fresh.phase === 'conflict') return fresh.id;
    if (fresh.phase === 'committed' && fresh.emitted) {
      for (const entry of fresh.entries ?? []) store.hidden.delete(materialize(store, entry));
      return null;
    }
    const classified = [];
    for (const entry of fresh.entries ?? []) {
      if (!['put', 'delete'].includes(entry.operation ?? 'put') || entry.operation === 'delete' && entry.afterRevision !== null) {
        throw new CoreError(422, 'corrupt_resource', 'The journal operation is not valid.');
      }
      if (entry.target && fresh.catalogs && !catalogAllows(entry.operation === 'delete' ? fresh.catalogs.before : fresh.catalogs.after, entry.target.project, entry.target.path)) refuseProject();
      const recordPath = materialize(store, entry);
      const current = await readBytesRaw(recordPath);
      const revision = revisionOf(current);
      let state = 'conflict';
      if (revision === entry.afterRevision) state = 'applied';
      else if (revision === entry.beforeRevision) state = 'pending';
      classified.push({ entry, recordPath, revision, state });
    }
    const conflicts = classified.filter((item) => item.state === 'conflict').map((item) => ({
      resource: item.entry.resource,
      recordPath: item.recordPath,
      currentRevision: item.revision,
    }));
    if (conflicts.length > 0) {
      for (const item of classified) store.hidden.delete(item.recordPath);
      const response = conflictReceiptBody(fresh, conflicts);
      const receipt = fresh.receipt ? { ...fresh.receipt, status: 409, response } : null;
      if (receipt) {
        const existing = await readReceipt(store, receipt.principalHash, receipt.key);
        if (!existing || existing.status !== 409) await writeReceipt(store, receipt);
      }
      const finished = {
        ...fresh,
        receipt: receipt ?? fresh.receipt,
        phase: 'conflict',
        conflicts,
        emitted: false,
        staged: false,
      };
      await atomicWrite(store, file, journalBytes(finished));
      return finished.id;
    }
    for (const item of classified) {
      if (item.state === 'pending') {
        const destination = item.entry.target?.kind === 'project' ? item.entry.target : item.recordPath;
        await applyJournalEntry(store, item.entry, destination);
      }
      if (item.entry.private && item.entry.operation !== 'delete') await protectLocalFile(item.recordPath, { store });
      store.hidden.delete(item.recordPath);
    }
    await stageJournal(store, fresh);
    if (fresh.receipt) {
      const existing = await readReceipt(store, fresh.receipt.principalHash, fresh.receipt.key);
      if (!existing) await writeReceipt(store, fresh.receipt);
    }
    const finished = { ...fresh, phase: 'committed', conflicts: [], emitted: true, staged: true };
    await atomicWrite(store, file, journalBytes(finished));
    if (!fresh.emitted) {
      emit(store, fresh.events ?? []);
      if (fresh.sync) for (const event of fresh.events ?? []) store.changeBus?.emit(event);
    }
    return finished.id;
  });
}

async function stageJournal(store, journal) {
  if (!journal.sync) return [];
  const { openSync, stageTransaction } = await import('../sync/store.mjs');
  const sync = openSync({ store, paths: { mind: store.mindPath, localDirectory: store.localDirectory, machine: journal.sync.machine }, now: store.now, projects: store.projects });
  const entries = journal.entries.filter((entry) => !entry.private).map((entry) => ({
    target: entry.target ?? { kind: 'mind', path: safeRelative(path.relative(store.mindPath, entry.recordPath).replaceAll('\\', '/')) },
    bytes: entry.operation === 'delete' ? null : Buffer.from(entry.afterBytesBase64, 'base64'),
    deleted: entry.operation === 'delete',
    baseHash: entry.beforeRevision,
    id: uuidV8(['journal-change', journal.id, entry.resource, entry.afterRevision]),
  }));
  return stageTransaction(sync, entries, { transactionId: journal.id, at: journal.sync.at,
    authorizedTargets: journal.entries.filter((entry) => entry.target).map((entry) => entry.target) });
}

export async function commitChange(context, prepared) {
  if (context.bus) context.store.changeBus = context.bus;
  if (context.watch) context.store.changeWatch = context.watch;
  const events = (prepared.events ?? []).map((event) => ({ ...event,
    source: { kind: context.principal?.audience === 'agent' ? 'mcp' : 'gui', id: context.paths.machine, unitId: context.principal?.unitId ?? 'root:master' },
  }));
  const result = await commitTransaction(context.store, { ...prepared, events,
    receipt: context.receipt ?? null,
    sync: { machine: context.paths.machine, at: new Date(context.now()).toISOString() },
  });
  const { noteSync } = await import('../sync/store.mjs');
  noteSync(context, 'pending');
  if (context.pulse) {
    const ids = prepared.entries.filter((entry) => !entry.private).map((entry) => uuidV8(['journal-change', prepared.id, entry.resource, revisionOf(entry.afterBytes)]));
    if ((await context.pulse.changed(ids))?.published === true) noteSync(context, 'published');
  }
  return result.body;
}

export async function prepareChangeUndo(context, { id, permission, resourceIds, entries, events }) {
  if (context.projects) bindProjects(context.store, context.projects);
  const directory = path.join(context.store.localDirectory, 'change-undo');
  await assertNoLinks(directory, { root: context.store.confineRoot });
  await mkdir(directory, { recursive: true });
  await protectLocalFile(directory, { store: context.store });
  const transactions = path.join(context.store.localDirectory, 'transactions');
  await mkdir(transactions, { recursive: true });
  await protectLocalFile(transactions, { store: context.store });
  const undoUntil = new Date(context.now() + 10000).toISOString();
  const record = { format: 'hivem1nd-change-undo-v1', id, permission, resourceIds, undoUntil, undone: false,
    entries: entries.map((entry) => {
      const project = entry.recordPath ? context.store.projects.find((item) => isInside(item.localPath, entry.recordPath)) : null;
      const target = entry.target ?? (project ? { kind: 'project', project: project.name, path: path.relative(project.localPath, entry.recordPath).replaceAll('\\', '/') } : null);
      return { resource: target ? `project:${target.project}:${target.path}` : entry.resource, recordPath: entry.recordPath, target,
        afterRevision: entry.operation === 'delete' ? null : revisionOf(entry.afterBytes), beforeBytesBase64: entry.beforeBytes?.toString('base64') ?? null };
    }), events };
  return { undoUntil, entry: { resource: `change-undo:${id}`, recordPath: path.join(directory, `${id}.json`),
    beforeRevision: null, afterBytes: journalBytes(record), private: true } };
}

export async function undoChange(context, changeId) {
  if (!isUuid(changeId)) throw new CoreError(404, 'change_not_found', 'The change does not exist.');
  if (context.principal?.audience !== 'desktop') throw new CoreError(403, 'forbidden', 'Only the desktop can undo a change.');
  return withLocalChanges(context.store, async () => {
    const recordPath = path.join(context.store.localDirectory, 'change-undo', `${changeId}.json`);
    const bytes = await readBytes(context.store, recordPath);
    if (!bytes) throw new CoreError(404, 'change_not_found', 'The change does not exist.');
    const record = JSON.parse(bytes);
    if (record.format !== 'hivem1nd-change-undo-v1' || record.id !== changeId) throw new CoreError(409, 'undo_conflict', 'The undo record is not valid.');
    if (context.principal.capabilities && !context.principal.capabilities.includes(record.permission)) throw new CoreError(403, 'forbidden', 'The originating change permission is required.');
    if (context.now() >= Date.parse(record.undoUntil)) throw new CoreError(410, 'undo_expired', 'The ten-second undo period ended.');
    if (record.undone) throw new CoreError(409, 'undo_conflict', 'The change was already undone.');
    const entries = [];
    for (const entry of record.entries) {
      const destination = entry.target ?? entry.recordPath;
      if (revisionOf(await readBytes(context.store, resolveAuthorized(context.store, destination))) !== entry.afterRevision) throw new CoreError(409, 'undo_conflict', 'A changed record prevents undo.');
      entries.push({ resource: entry.resource, recordPath: entry.recordPath, ...(entry.target ? { target: entry.target } : {}),
        beforeRevision: entry.afterRevision, operation: entry.beforeBytesBase64 === null ? 'delete' : 'put',
        afterBytes: entry.beforeBytesBase64 === null ? null : Buffer.from(entry.beforeBytesBase64, 'base64') });
    }
    const id = randomUUID();
    entries.push({ resource: `change-undo:${changeId}`, recordPath, beforeRevision: revisionOf(bytes),
      afterBytes: journalBytes({ ...record, undone: true, undoOf: id }), private: true });
    try {
      return await commitChange(context, { id, entries, events: record.events,
        response: { status: 200, body: { changeId: id, undoOf: changeId, resourceIds: record.resourceIds } } });
    } catch (error) {
      if (error?.code === 'revision_conflict') throw new CoreError(409, 'undo_conflict', 'A changed record prevents undo.');
      throw error;
    }
  });
}

function conflictReceiptBody(journal, conflicts) {
  const requestId = journal.receipt?.requestId ?? journal.id;
  return {
    code: 'revision_conflict',
    message: 'The record changed since it was read.',
    requestId,
    operationId: journal.id,
    details: {
      currentRevision: conflicts[0]?.currentRevision ?? null,
      conflicts: conflicts.map((item) => ({
        resource: item.resource,
        requestId,
        operationId: journal.id,
        currentRevision: item.currentRevision,
      })),
    },
  };
}

export async function withReceipt(store, input, operation) {
  if (!isUuid(input?.key)) throw new CoreError(422, 'invalid_body', 'Idempotency-Key must be a UUID.');
  if (!isUuid(input.requestId)) throw new CoreError(422, 'invalid_body', 'The request id must be a UUID.');
  const principalHash = hashText(String(input.principal));
  const bodyHash = hashText(canonicalJson(input.body ?? null));
  return withLocks(store, [`receipt:${principalHash}:${input.key}`], async () => {
    await ensureRecovered(store);
    const existing = await readReceipt(store, principalHash, input.key);
    if (existing && Date.parse(existing.expiresAt) > store.now()) {
      if (existing.method !== input.method || existing.path !== input.path || existing.bodyHash !== bodyHash) {
        throw new CoreError(409, 'idempotency_conflict', 'This idempotency key was already used with a different request.');
      }
      return { status: existing.status, body: existing.response, id: existing.requestId, replayed: true, sync: existing.sync ?? 'local' };
    }
    const now = store.now();
    const receipt = {
      principalHash,
      key: input.key,
      method: input.method,
      path: input.path,
      bodyHash,
      requestId: input.requestId,
      eventCursor: input.eventCursor ?? null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + RECEIPT_TTL_MS).toISOString(),
    };
    return operation(receipt);
  });
}
