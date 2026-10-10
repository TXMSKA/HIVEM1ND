import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, hashText, isUuid } from './identity.mjs';
import { assertNoLinks } from './paths.mjs';

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

function assertAllowed(store, target) {
  const resolved = path.resolve(target);
  if (![store.mindPath, store.localDirectory].some((root) => isInside(root, resolved))) {
    throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the mind or local service directory.');
  }
  if (store.confineRoot && !isInside(store.confineRoot, resolved)) {
    throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the test root.');
  }
  return resolved;
}

export function createStore({ root, mindPath, localDirectory, now = () => Date.now(), events = [], confineRoot = null, autoRecover = true } = {}) {
  if (!root || !mindPath || !localDirectory) throw new CoreError(500, 'internal_error', 'A store needs a root, mind, and local directory.');
  return {
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
  };
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
  assertAllowed(store, temporary);
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
  for (const entry of prepared.entries) {
    if (typeof entry.resource !== 'string' || entry.resource === '') throw new CoreError(422, 'invalid_body', 'A transaction entry needs a resource key.');
    const recordPath = assertAllowed(store, entry.recordPath);
    await assertNoLinks(path.dirname(recordPath), { root: store.confineRoot });
    await assertNoLinks(recordPath, { root: store.confineRoot });
    const current = await readBytesRaw(recordPath);
    checkRevision(current, entry.beforeRevision ?? null);
    const afterBytes = Buffer.isBuffer(entry.afterBytes) ? entry.afterBytes : Buffer.from(entry.afterBytesBase64 ?? '', 'base64');
    const afterRevision = hashBytes(afterBytes);
    if (entry.afterRevision && entry.afterRevision !== afterRevision) {
      throw new CoreError(409, 'revision_conflict', 'The prepared bytes do not match the declared revision.', { currentRevision: revisionOf(current) });
    }
    checked.push({
      resource: entry.resource,
      beforeRevision: entry.beforeRevision ?? null,
      afterRevision,
      afterBytesBase64: afterBytes.toString('base64'),
      recordPath,
      record: entry.record ?? null,
      current,
    });
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
    await atomicWrite(store, entry.recordPath, Buffer.from(entry.afterBytesBase64, 'base64'));
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
    if (fresh.phase === 'committed' && fresh.emitted) {
      for (const entry of fresh.entries ?? []) store.hidden.delete(path.resolve(entry.recordPath));
      return null;
    }
    const conflicts = [];
    for (const entry of fresh.entries ?? []) {
      const recordPath = path.resolve(entry.recordPath);
      const current = await readBytesRaw(recordPath);
      const revision = revisionOf(current);
      if (revision === entry.afterRevision) {
        store.hidden.delete(recordPath);
        continue;
      }
      if (revision === entry.beforeRevision) {
        await atomicWrite(store, recordPath, Buffer.from(entry.afterBytesBase64, 'base64'));
        store.hidden.delete(recordPath);
        continue;
      }
      conflicts.push({ resource: entry.resource, recordPath, currentRevision: revision });
      store.hidden.delete(recordPath);
    }
    if (fresh.receipt) {
      const existing = await readReceipt(store, fresh.receipt.principalHash, fresh.receipt.key);
      if (!existing) await writeReceipt(store, fresh.receipt);
    }
    const finished = {
      ...fresh,
      phase: conflicts.length > 0 ? 'conflict' : 'committed',
      conflicts,
      emitted: true,
      staged: conflicts.length === 0,
    };
    await atomicWrite(store, file, journalBytes(finished));
    if (!fresh.emitted && conflicts.length === 0) emit(store, fresh.events ?? []);
    return finished.id;
  });
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
