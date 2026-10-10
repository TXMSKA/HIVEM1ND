import path from 'node:path';
import { CoreError, canonicalJson, uuidV8 } from '../service/identity.mjs';
import { atomicWrite, readBytes, withLocks } from '../service/store.mjs';

export const MESSAGE_MAX = 60;
export const MESSAGE_WINDOW_MS = 60000;
export const MESSAGE_BYTES_MAX = 1000000;
export const SYNC_BYTES_MAX = 50000000;
export const SYNC_WINDOW_MS = 3600000;
const LOCK = 'sync-ledger';
const SLOWING_NUMERATOR = 8;
const SLOWING_DENOMINATOR = 10;

export function openLedger({ store, paths, now = () => Date.now(), machine }) {
  if (!store || !paths?.localDirectory || !machine) throw new CoreError(500, 'internal_error', 'Limits need a store, local directory, and machine.');
  return { store, paths, now, machine, file: path.join(paths.localDirectory, 'sync-ledger.json') };
}

export async function admitMessage(ledger, { id, record, notice = false } = {}) {
  const bytes = measure(record);
  if (!id || typeof id !== 'string') throw new CoreError(422, 'invalid_body', 'A message needs an id.');
  if (bytes > MESSAGE_BYTES_MAX) {
    throw blocked(ledger, 'admission', 413, 'message_too_large', 'The message exceeds 1000000 bytes.', null, await limitsFor(ledger, 'admission'));
  }
  return mutate(ledger, (data, now) => {
    const active = activeEntries(data.admitted, now, MESSAGE_WINDOW_MS);
    if (active.some((entry) => entry.id === id) || notice) {
      return { admitted: true, counted: false, duplicate: !notice && active.some((entry) => entry.id === id), limits: view(ledger, 'admission', data, now) };
    }
    if (active.length >= MESSAGE_MAX) {
      const retryAt = retryAtFor(now, active.map(asCharge), { messages: 1, bytes: 0 });
      throw blocked(ledger, 'admission', 429, 'message_rate_limited', 'The message window is full.', retryAt, view(ledger, 'admission', data, now, retryAt));
    }
    data.admitted.push({ id, at: iso(now) });
    return { admitted: true, counted: true, duplicate: false, limits: view(ledger, 'admission', data, now) };
  });
}

export async function reservePublication(ledger, charge) {
  return reserve(ledger, 'publication', charge, (data) => data.outgoing);
}

export async function reserveReceipt(ledger, charge) {
  if (!charge?.machine) throw new CoreError(422, 'invalid_body', 'A receipt needs the publisher machine.');
  return reserve(ledger, 'receipt', charge, (data) => {
    data.incoming[charge.machine] ??= [];
    return data.incoming[charge.machine];
  });
}

export async function chargeMetadata(ledger, { machine, path: resource, contentHash, bytes, phase = 'publication' } = {}) {
  if (!machine || !resource || !contentHash) throw new CoreError(422, 'invalid_body', 'Metadata needs a machine, path, and hash.');
  const charge = { id: canonicalJson([machine, resource, contentHash]), messages: 0, bytes: count(bytes), machine };
  if (phase === 'receipt') return reserveReceipt(ledger, charge);
  return reservePublication(ledger, charge);
}

export async function limitsFor(ledger, phase = 'publication', machine = null) {
  const data = await readLedger(ledger);
  return view(ledger, phase, data, ledger.now(), null, machine);
}

export function retryAtFor(now, entries, proposed) {
  const messages = Math.max(0, proposed?.messages ?? 0);
  const bytes = Math.max(0, proposed?.bytes ?? 0);
  const messageRetry = messages > MESSAGE_MAX ? null : dimensionRetry(now, entries, messages, MESSAGE_WINDOW_MS, MESSAGE_MAX, (entry) => entry.messages ?? 1);
  const byteRetry = bytes > SYNC_BYTES_MAX ? null : dimensionRetry(now, entries, bytes, SYNC_WINDOW_MS, SYNC_BYTES_MAX, (entry) => entry.bytes ?? 0);
  if (messages > MESSAGE_MAX || bytes > SYNC_BYTES_MAX) return null;
  const times = [messageRetry, byteRetry].filter((value) => value !== null);
  if (times.length === 0) return null;
  return Math.max(...times);
}

export async function claimLimitNotice(ledger, phase) {
  return mutate(ledger, (data, now) => {
    const windowMs = phase === 'admission' ? MESSAGE_WINDOW_MS : SYNC_WINDOW_MS;
    const window = Math.floor(now / windowMs);
    data.notices = (data.notices ?? []).filter((item) => item.phase === phase ? item.window === window : item.window === Math.floor(now / (item.phase === 'admission' ? MESSAGE_WINDOW_MS : SYNC_WINDOW_MS)));
    const existing = data.notices.find((item) => item.phase === phase && item.window === window);
    if (existing) return { id: existing.id, created: false };
    const id = uuidV8(['notice', phase, String(window), 'limit']);
    data.notices.push({ phase, window, id, at: iso(now) });
    return { id, created: true };
  });
}

function reserve(ledger, phase, charge, select) {
  const messages = Math.max(0, charge?.messages ?? 0);
  const bytes = count(charge?.bytes ?? 0);
  if (!charge?.id) throw new CoreError(422, 'invalid_body', 'A sync charge needs an id.');
  if (bytes > SYNC_BYTES_MAX || messages > MESSAGE_MAX) {
    throw new CoreError(413, 'pack_too_large', 'The sync charge exceeds a single window.', { phase, machine: ledger.machine });
  }
  return mutate(ledger, (data, now) => {
    const entries = select(data);
    const known = entries.find((entry) => entry.id === charge.id);
    if (known) return { charged: false, replayed: true, limits: view(ledger, phase, data, now, null, charge.machine ?? null) };
    const active = activeEntries(entries, now, SYNC_WINDOW_MS);
    const messageActive = activeEntries(entries, now, MESSAGE_WINDOW_MS);
    const usedMessages = sum(messageActive, (entry) => entry.messages ?? 0);
    const usedBytes = sum(active, (entry) => entry.bytes ?? 0);
    if (usedMessages + messages <= MESSAGE_MAX && usedBytes + bytes <= SYNC_BYTES_MAX) {
      entries.push({ id: charge.id, at: iso(now), messages, bytes });
      return { charged: true, replayed: false, limits: view(ledger, phase, data, now, null, charge.machine ?? null) };
    }
    const retryAt = retryAtFor(now, uniqueCharges(active), { messages, bytes });
    throw blocked(ledger, phase, 429, 'sync_rate_limited', 'The sync window is full.', retryAt, view(ledger, phase, data, now, retryAt, charge.machine ?? null));
  });
}

function view(ledger, phase, data, now, forcedRetry = null, machine = null) {
  const entries = phase === 'admission'
    ? data.admitted
    : phase === 'receipt'
      ? (data.incoming[machine ?? ledger.machine] ?? [])
      : data.outgoing;
  const messageActive = activeEntries(entries, now, MESSAGE_WINDOW_MS);
  const byteActive = activeEntries(entries, now, SYNC_WINDOW_MS);
  const messagesUsed = phase === 'admission' ? messageActive.length : sum(messageActive, (entry) => entry.messages ?? 0);
  const bytesUsed = phase === 'admission' ? 0 : sum(byteActive, (entry) => entry.bytes ?? 0);
  const state = hard(messagesUsed, bytesUsed) ? 'paused' : slow(messagesUsed, bytesUsed) ? 'slowing' : 'normal';
  const retryAt = forcedRetry ?? (state === 'paused'
    ? retryAtFor(now, uniqueCharges([...messageActive, ...byteActive]), {
      messages: messagesUsed >= MESSAGE_MAX ? 1 : 0,
      bytes: bytesUsed >= SYNC_BYTES_MAX ? 1 : 0,
    })
    : null);
  return {
    messages: { used: messagesUsed, max: MESSAGE_MAX, windowSeconds: MESSAGE_WINDOW_MS / 1000 },
    messageBytes: { max: MESSAGE_BYTES_MAX },
    syncBytes: { used: bytesUsed, max: SYNC_BYTES_MAX, windowSeconds: SYNC_WINDOW_MS / 1000 },
    state,
    retryAt: retryAt === null ? null : iso(retryAt),
  };
}

function dimensionRetry(now, entries, proposed, windowMs, max, amount) {
  const active = entries
    .map((entry) => ({ amount: amount(asCharge(entry)), expires: stamp(entry) + windowMs }))
    .filter((entry) => entry.amount > 0 && entry.expires > now)
    .sort((left, right) => left.expires - right.expires || left.amount - right.amount);
  const used = sum(active, (entry) => entry.amount);
  if (used + proposed <= max) return null;
  let freed = 0;
  let when = null;
  for (const entry of active) {
    freed += entry.amount;
    when = entry.expires;
    if (used - freed + proposed <= max) return when;
  }
  return when;
}

function hard(messagesUsed, bytesUsed) {
  return messagesUsed >= MESSAGE_MAX || bytesUsed >= SYNC_BYTES_MAX;
}

function slow(messagesUsed, bytesUsed) {
  return messagesUsed * SLOWING_DENOMINATOR >= MESSAGE_MAX * SLOWING_NUMERATOR
    || bytesUsed * SLOWING_DENOMINATOR >= SYNC_BYTES_MAX * SLOWING_NUMERATOR;
}

function uniqueCharges(entries) {
  const seen = new Set();
  const charges = [];
  for (const entry of entries ?? []) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    charges.push(asCharge(entry));
  }
  return charges;
}

function asCharge(entry) {
  return {
    at: stamp(entry),
    messages: entry.messages ?? 1,
    bytes: entry.bytes ?? 0,
  };
}

function activeEntries(entries, now, windowMs) {
  return (entries ?? []).filter((entry) => stamp(entry) + windowMs > now);
}

async function mutate(ledger, operation) {
  return withLocks(ledger.store, [LOCK], async () => {
    const now = ledger.now();
    const data = prune(await readLedger(ledger), now);
    const result = operation(data, now);
    await saveLedger(ledger, data);
    return result;
  });
}

function prune(data, now) {
  data.admitted = activeEntries(data.admitted, now, MESSAGE_WINDOW_MS);
  data.outgoing = activeEntries(data.outgoing, now, SYNC_WINDOW_MS);
  for (const machine of Object.keys(data.incoming)) {
    data.incoming[machine] = activeEntries(data.incoming[machine], now, SYNC_WINDOW_MS);
    if (data.incoming[machine].length === 0) delete data.incoming[machine];
  }
  data.notices = (data.notices ?? []).filter((item) => {
    const windowMs = item.phase === 'admission' ? MESSAGE_WINDOW_MS : SYNC_WINDOW_MS;
    return item.window === Math.floor(now / windowMs);
  });
  return data;
}

async function readLedger(ledger) {
  const bytes = await readBytes(ledger.store, ledger.file);
  if (!bytes) return emptyLedger();
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new CoreError(422, 'corrupt_resource', 'The sync ledger is not valid.');
  }
  if (parsed?.format !== 'hivem1nd-sync-ledger-v1' || !Array.isArray(parsed.admitted) || !Array.isArray(parsed.outgoing)) {
    throw new CoreError(422, 'corrupt_resource', 'The sync ledger is not valid.');
  }
  parsed.incoming ??= {};
  parsed.applied ??= {};
  parsed.notices ??= [];
  return parsed;
}

async function saveLedger(ledger, data) {
  const record = {
    format: 'hivem1nd-sync-ledger-v1',
    admitted: data.admitted,
    outgoing: data.outgoing,
    incoming: data.incoming,
    applied: data.applied ?? {},
    notices: data.notices ?? [],
  };
  await atomicWrite(ledger.store, ledger.file, Buffer.from(`${canonicalJson(record)}\n`, 'utf8'));
}

function emptyLedger() {
  return { format: 'hivem1nd-sync-ledger-v1', admitted: [], outgoing: [], incoming: {}, applied: {}, notices: [] };
}

function blocked(ledger, phase, status, code, message, retryAt, limits) {
  const retryAfter = retryAt === null ? null : Math.max(1, Math.ceil((retryAt - ledger.now()) / 1000));
  return new CoreError(status, code, message, { machine: ledger.machine, phase, limits, retryAfter }, retryAt === null ? null : iso(retryAt));
}

function measure(record) {
  if (Buffer.isBuffer(record) || record instanceof Uint8Array) return record.length;
  if (typeof record === 'string') return Buffer.byteLength(record);
  throw new CoreError(422, 'invalid_body', 'A message needs its complete record.');
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new CoreError(422, 'invalid_body', 'A byte charge must be a whole number.');
  return value;
}

function sum(entries, read) {
  return entries.reduce((total, entry) => total + read(entry), 0);
}

function stamp(entry) {
  const value = typeof entry.at === 'number' ? entry.at : Date.parse(entry.at);
  if (!Number.isFinite(value)) throw new CoreError(422, 'corrupt_resource', 'The sync ledger time is not valid.');
  return value;
}

function iso(value) {
  return new Date(value).toISOString();
}
