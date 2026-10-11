import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, hashText, isUuid } from './identity.mjs';
import { assertNoLinks, safeRelative } from './paths.mjs';

export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

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
  return blueprint && /^docs\/flows\/assets\/[^/]+$/.test(relative);
}

async function catalogSnapshot(store, entries) {
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
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  store.writes.push(target);
  return target;
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
  for (const event of events ?? []) store.events.push(structuredClone(event));
}

export async function commitTransaction(store, prepared) {
  if (!isUuid(prepared?.id)) throw new CoreError(422, 'invalid_body', 'The transaction id must be a UUID.');
  const source = prepared.entries ?? [];
  if (source.length === 0) throw new CoreError(422, 'invalid_body', 'A transaction needs at least one record.');
  const resources = source.map((entry) => entry.resource);
  if (new Set(resources).size !== resources.length) throw new CoreError(422, 'invalid_body', 'A transaction cannot change one resource twice.');
  return withLocks(store, resources, () => commitLocked(store, prepared));
}

async function commitLocked(store, prepared) {
  const checked = [];
  const catalog = await catalogSnapshot(store, prepared.entries);
  for (const entry of prepared.entries) {
    if (typeof entry.resource !== 'string' || entry.resource === '') throw new CoreError(422, 'invalid_body', 'A transaction entry needs a resource key.');
    const canonical = entry.target?.kind === 'project' ? canonicalTarget(entry.target) : null;
    if (canonical && !catalogAllows(catalog, canonical.project, canonical.path)) refuseProject();
    const destination = canonical ?? entry.recordPath;
    const recordPath = assertAllowed(store, destination);
    await assertNoLinks(path.dirname(recordPath), { root: store.confineRoot });
    await assertNoLinks(recordPath, { root: store.confineRoot });
    const current = await readBytesRaw(recordPath);
    checkRevision(current, entry.beforeRevision ?? null);
    const afterBytes = Buffer.isBuffer(entry.afterBytes) ? entry.afterBytes : Buffer.from(entry.afterBytesBase64 ?? '', 'base64');
    const afterRevision = hashBytes(afterBytes);
    if (entry.afterRevision && entry.afterRevision !== afterRevision) {
      throw new CoreError(409, 'revision_conflict', 'The prepared bytes do not match the declared revision.', { currentRevision: revisionOf(current) });
    }
    const saved = {
      resource: canonical ? `project:${canonical.project}:${canonical.path}` : entry.resource,
      beforeRevision: entry.beforeRevision ?? null,
      afterRevision,
      afterBytesBase64: afterBytes.toString('base64'),
      recordPath,
      record: entry.record ?? null,
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
    conflicts: [],
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
  let renamed = 0;
  for (const entry of entries) {
    const destination = entry.target?.kind === 'project' ? entry.target : entry.recordPath;
    await atomicWrite(store, destination, Buffer.from(entry.afterBytesBase64, 'base64'));
    renamed += 1;
    if (store.fault?.afterRenames === renamed) {
      store.fault = null;
      store.recovered = false;
      throw new CoreError(500, 'injected_crash', 'Injected crash after a partial transaction.');
    }
  }
  if (store.fault?.beforeReceipt) {
    store.fault = null;
    store.recovered = false;
    throw new CoreError(500, 'injected_crash', 'Injected crash before the receipt was published.');
  }
  if (receipt) await writeReceipt(store, receipt);
  const committed = { ...journal, phase: 'committed', emitted: true, staged: true };
  await atomicWrite(store, journalFile(store, prepared.id), journalBytes(committed));
  for (const entry of entries) store.hidden.delete(entry.recordPath);
  emit(store, journal.events);
  return { status: receipt?.status ?? prepared.response?.status ?? 200, body: receipt?.response ?? prepared.response?.body ?? null, id: prepared.id };
}

export async function recoverTransactions(store) {
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
        await atomicWrite(store, destination, Buffer.from(item.entry.afterBytesBase64, 'base64'));
      }
      store.hidden.delete(item.recordPath);
    }
    if (fresh.receipt) {
      const existing = await readReceipt(store, fresh.receipt.principalHash, fresh.receipt.key);
      if (!existing) await writeReceipt(store, fresh.receipt);
    }
    const finished = { ...fresh, phase: 'committed', conflicts: [], emitted: true, staged: true };
    await atomicWrite(store, file, journalBytes(finished));
    if (!fresh.emitted) emit(store, fresh.events ?? []);
    return finished.id;
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
      return { status: existing.status, body: existing.response, id: existing.requestId, replayed: true };
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
