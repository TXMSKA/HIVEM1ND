import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { CoreError, canonicalJson, hashBytes, isUuid, uuidV8, validateMachineName, validateName } from '../service/identity.mjs';
import { safeRelative } from '../service/paths.mjs';

// Reserved encrypted envelope from contract 2.9. It is not wired in 3.0.
// The envelope is {algorithm:"aes-256-gcm",keyId,nonce,tag}: a 12-byte nonce
// and a 16-byte tag, both base64url. The index and blob payload are encrypted
// after compression. Authenticated data is the UTF-8 string
// hivem1nd-pack-v1:<machine>:<sequence>:<keyId>. Account and team keys stay
// outside synced files. Requested encryption or Quantum is unsupported_origin.

export const MAX_PACK_BYTES = 50000000;
export const MAX_OBJECT_BYTES = 16000000;
export const MAX_AGGREGATE_BYTES = 64000000;
export const MAX_INDEX_ITEMS = 10000;
const MAX_SEQUENCE = 999999999999;
const HASH = /^[0-9a-f]{64}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEADER_KEYS = ['encryption', 'format', 'machine', 'payloadBytes', 'payloadHash', 'sequence'];
const INDEX_KEYS = ['changes', 'compression', 'dependencies', 'format', 'objects', 'transactions'];
const OBJECT_KEYS = ['compressedBytes', 'hash', 'offset', 'rawBytes'];
const DEPENDENCY_KEYS = ['hash', 'machine', 'packHash', 'sequence'];
const TRANSACTION_KEYS = ['changeIds', 'id'];
const CHANGE_KEYS = ['at', 'baseHash', 'format', 'hash', 'id', 'machine', 'messageId', 'operation', 'size', 'target', 'transactionId'];

const LOCAL_PREFIXES = ['user/relay/sessions/', 'user/relay/leases/', 'user/relay/credentials/'];

export function compressObject(raw) {
  const bytes = asBuffer(raw);
  if (bytes.length > MAX_OBJECT_BYTES) throw new CoreError(413, 'resource_too_large', 'An object exceeds 16 MB.');
  return brotliCompressSync(bytes);
}

export function decompressObject(compressed, maxOutputLength) {
  try {
    return brotliDecompressSync(compressed, { maxOutputLength });
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') throw new CoreError(413, 'resource_too_large', 'An object exceeds its declared size.');
    throw new CoreError(422, 'invalid_pack', 'The compressed object is not a complete Brotli stream.');
  }
}

export function packFileName(sequence) {
  assertSequence(sequence);
  return `${String(sequence).padStart(12, '0')}.pack`;
}

export function normalizeTarget(target) {
  if (!target || typeof target !== 'object') throw new CoreError(422, 'invalid_pack', 'The change target is not valid.');
  if (target.kind === 'mind') {
    const relative = safeMindPath(target.path);
    return { kind: 'mind', path: relative };
  }
  if (target.kind === 'project') {
    const project = validateName(target.project, { label: 'project', max: 80 });
    const relative = safeProjectPath(target.path);
    return { kind: 'project', project, path: relative };
  }
  throw new CoreError(422, 'invalid_pack', 'The change target is not valid.');
}

export function validateChange(change, owner = null) {
  assertPlain(change);
  exactKeys(change, CHANGE_KEYS, 'change');
  if (change.format !== 'hivem1nd-change-v1') throw new CoreError(422, 'invalid_pack', 'The change format is not supported.');
  if (!isUuid(change.id)) throw new CoreError(422, 'invalid_pack', 'The change id must be a UUID.');
  const machine = validateMachineName(change.machine);
  if (owner && machine !== owner) throw new CoreError(422, 'invalid_record_owner', 'The change owner does not match the pack.');
  if (typeof change.at !== 'string' || !TIME.test(change.at)) throw new CoreError(422, 'invalid_pack', 'The change time must be UTC.');
  const target = normalizeTarget(change.target);
  if (change.operation !== 'put' && change.operation !== 'delete') throw new CoreError(422, 'invalid_pack', 'The change operation is not valid.');
  if (change.transactionId !== null && !isUuid(change.transactionId)) throw new CoreError(422, 'invalid_pack', 'The transaction id must be a UUID.');
  if (change.messageId !== null && (typeof change.messageId !== 'string' || change.messageId.length > 256 || /[\r\n\u0000]/.test(change.messageId))) {
    throw new CoreError(422, 'invalid_pack', 'The message id is not valid.');
  }
  if (change.operation === 'delete') {
    if (change.hash !== null || change.size !== 0) throw new CoreError(422, 'invalid_pack', 'A tombstone has no object.');
  } else if (!HASH.test(change.hash ?? '') || !Number.isSafeInteger(change.size) || change.size < 0 || change.size > MAX_OBJECT_BYTES) {
    throw new CoreError(422, 'invalid_pack', 'The object hash or size is not valid.');
  }
  if (change.baseHash !== null && !HASH.test(change.baseHash)) throw new CoreError(422, 'invalid_pack', 'The base hash is not valid.');
  return {
    format: 'hivem1nd-change-v1',
    id: change.id,
    machine,
    at: change.at,
    target,
    operation: change.operation,
    hash: change.operation === 'delete' ? null : change.hash,
    size: change.operation === 'delete' ? 0 : change.size,
    baseHash: change.baseHash,
    messageId: change.messageId,
    transactionId: change.transactionId,
  };
}

export function encodePack({ machine, sequence, changes, objects = [], dependencies = [], transactions = [], encryption = { algorithm: 'none' } }) {
  const owner = validateMachineName(machine);
  assertSequence(sequence);
  assertEncryption(encryption);
  const normalized = (changes ?? []).map((change) => validateChange(change, owner));
  if (normalized.length > MAX_INDEX_ITEMS) throw new CoreError(413, 'pack_too_large', 'The pack lists too many changes.');
  const available = objectMap(objects);
  const dependencyList = dependencies.map(validateDependency);
  const included = [];
  for (const change of normalized) {
    if (change.operation !== 'put') continue;
    if (available.has(change.hash)) {
      if (!included.includes(change.hash)) included.push(change.hash);
      continue;
    }
    if (!dependencyList.some((item) => item.hash === change.hash)) {
      throw new CoreError(422, 'invalid_pack', 'A change object is missing from the pack.');
    }
  }
  included.sort();
  let offset = 0;
  const objectEntries = [];
  const blobs = [];
  let aggregate = 0;
  for (const hash of included) {
    const raw = available.get(hash);
    if (hashBytes(raw) !== hash) throw new CoreError(422, 'corrupt_resource', 'The object bytes do not match the declared hash.');
    const compressed = compressObject(raw);
    aggregate += raw.length;
    if (aggregate > MAX_AGGREGATE_BYTES) throw new CoreError(413, 'pack_too_large', 'The pack expands past 64 MB.');
    objectEntries.push({ hash, offset, compressedBytes: compressed.length, rawBytes: raw.length });
    blobs.push(compressed);
    offset += compressed.length;
  }
  const transactionList = validateTransactions(transactions, normalized);
  const index = {
    format: 'hivem1nd-pack-index-v1',
    compression: 'br',
    objects: objectEntries,
    changes: normalized,
    dependencies: dependencyList,
    transactions: transactionList,
  };
  const payload = payloadOf(index, blobs);
  if (payload.length > MAX_PACK_BYTES) throw new CoreError(413, 'pack_too_large', 'The pack exceeds 50 MB.');
  const header = {
    format: 'hivem1nd-pack-v1',
    machine: owner,
    sequence,
    payloadBytes: payload.length,
    payloadHash: hashBytes(payload),
    encryption: { algorithm: 'none' },
  };
  const packed = framed(header, payload);
  if (packed.length > MAX_PACK_BYTES) throw new CoreError(413, 'pack_too_large', 'The pack exceeds 50 MB.');
  return packed;
}

export function decodePack(bytes, { expectedHash = null, machine = null } = {}) {
  const buffer = asBuffer(bytes);
  if (buffer.length > MAX_PACK_BYTES) throw new CoreError(413, 'pack_too_large', 'The pack exceeds 50 MB.');
  if (expectedHash !== null && hashBytes(buffer) !== expectedHash) throw new CoreError(422, 'corrupt_resource', 'The pack digest does not match the head.');
  if (buffer.length < 8 || buffer.subarray(0, 4).toString('ascii') !== 'H1P3') throw new CoreError(422, 'invalid_pack', 'The pack magic is not valid.');
  const headerFrame = readSpan(buffer, 4);
  const header = parseJson(headerFrame.bytes);
  assertPlain(header);
  if (header.quantum || (header.encryption && header.encryption.algorithm !== 'none')) {
    throw new CoreError(422, 'unsupported_origin', 'Encryption and Quantum origins are not available.');
  }
  exactKeys(header, HEADER_KEYS, 'header');
  if (header.format !== 'hivem1nd-pack-v1') throw new CoreError(422, 'invalid_pack', 'The pack format is not supported.');
  const owner = validateMachineName(header.machine);
  if (machine && owner !== machine) throw new CoreError(422, 'invalid_record_owner', 'The pack owner does not match its directory.');
  assertSequence(header.sequence);
  assertEncryption(header.encryption);
  const payload = buffer.subarray(headerFrame.end);
  if (header.payloadBytes !== payload.length || header.payloadHash !== hashBytes(payload)) {
    throw new CoreError(422, 'corrupt_resource', 'The payload digest does not match the header.');
  }
  if (payload.length < 4) throw new CoreError(422, 'invalid_pack', 'The pack payload is truncated.');
  const indexFrame = readSpan(payload, 0);
  if (indexFrame.end > payload.length) throw new CoreError(422, 'invalid_pack', 'The pack index is truncated.');
  const index = parseJson(indexFrame.bytes);
  assertPlain(index);
  exactKeys(index, INDEX_KEYS, 'index');
  if (index.format !== 'hivem1nd-pack-index-v1' || index.compression !== 'br') throw new CoreError(422, 'invalid_pack', 'The pack index is not supported.');
  assertArray(index.objects, 'objects');
  assertArray(index.changes, 'changes');
  assertArray(index.dependencies, 'dependencies');
  assertArray(index.transactions, 'transactions');
  const changes = index.changes.map((change) => validateChange(change, owner));
  const dependencies = index.dependencies.map(validateDependency);
  const transactions = validateTransactions(index.transactions, changes);
  const blobArea = payload.subarray(indexFrame.end);
  const objects = expandObjects(index.objects, blobArea);
  const seenHashes = new Set();
  for (const change of changes) {
    if (change.operation !== 'put') continue;
    const raw = objects.get(change.hash);
    if (!raw) {
      if (!dependencies.some((item) => item.hash === change.hash)) throw new CoreError(422, 'invalid_pack', 'A change object is missing from the pack.');
      continue;
    }
    if (raw.length !== change.size) throw new CoreError(422, 'corrupt_resource', 'The object size does not match the change.');
    seenHashes.add(change.hash);
  }
  for (const hash of objects.keys()) {
    if (!seenHashes.has(hash)) throw new CoreError(422, 'invalid_pack', 'The pack contains an unreferenced object.');
  }
  return {
    header: { ...header, machine: owner, encryption: { algorithm: 'none' } },
    index: { ...index, changes, dependencies, transactions },
    changes,
    dependencies,
    transactions,
    objects,
    packHash: hashBytes(buffer),
  };
}

export function validateHead(head, { machine = null, previous = null, packBytes = null, sequence = null } = {}) {
  const value = Buffer.isBuffer(head) || typeof head === 'string' ? parseJson(asBuffer(head)) : head;
  assertPlain(value);
  exactKeys(value, ['format', 'machine', 'packs', 'sequence', 'updatedAt'], 'head');
  if (value.format !== 'hivem1nd-head-v1') throw new CoreError(422, 'invalid_pack', 'The head format is not supported.');
  const owner = validateMachineName(value.machine);
  if (machine && owner !== machine) throw new CoreError(422, 'invalid_record_owner', 'The head owner does not match its directory.');
  if (typeof value.updatedAt !== 'string' || !TIME.test(value.updatedAt)) throw new CoreError(422, 'invalid_pack', 'The head time must be UTC.');
  assertArray(value.packs, 'packs');
  let priorSequence = 0;
  const packs = [];
  for (const entry of value.packs) {
    assertPlain(entry);
    exactKeys(entry, ['bytes', 'file', 'hash', 'sequence'], 'head pack');
    assertSequence(entry.sequence);
    if (entry.sequence <= priorSequence) throw new CoreError(422, 'invalid_pack', 'Head sequences must increase.');
    priorSequence = entry.sequence;
    if (entry.file !== packFileName(entry.sequence)) throw new CoreError(422, 'invalid_pack', 'The head names a pack file incorrectly.');
    if (!HASH.test(entry.hash ?? '')) throw new CoreError(422, 'invalid_pack', 'The head pack hash is not valid.');
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 8 || entry.bytes > MAX_PACK_BYTES) throw new CoreError(422, 'invalid_pack', 'The head pack length is not valid.');
    packs.push({ sequence: entry.sequence, file: entry.file, hash: entry.hash, bytes: entry.bytes });
  }
  if (packs.length === 0) {
    if (value.sequence !== 0) throw new CoreError(422, 'invalid_pack', 'An empty head has sequence zero.');
  } else if (value.sequence !== packs[packs.length - 1].sequence) {
    throw new CoreError(422, 'invalid_pack', 'The head sequence must match its last pack.');
  }
  const normalized = { format: 'hivem1nd-head-v1', machine: owner, sequence: value.sequence, updatedAt: value.updatedAt, packs };
  if (previous) {
    const prior = validateHead(previous, { machine: owner });
    if (normalized.sequence < prior.sequence) throw new CoreError(422, 'invalid_pack', 'The head sequence regressed.');
    for (const pack of prior.packs) {
      const found = normalized.packs.find((item) => item.sequence === pack.sequence);
      if (!found || found.hash !== pack.hash || found.bytes !== pack.bytes || found.file !== pack.file) {
        throw new CoreError(422, 'corrupt_resource', 'A committed pack hash changed.');
      }
    }
  }
  if (packBytes) {
    const entry = normalized.packs.find((item) => item.sequence === sequence);
    if (!entry) throw new CoreError(422, 'invalid_pack', 'The head does not list that pack.');
    const body = asBuffer(packBytes);
    if (entry.bytes !== body.length || entry.hash !== hashBytes(body)) throw new CoreError(422, 'corrupt_resource', 'The pack digest does not match the head.');
  }
  return normalized;
}

export async function resolveDependencies(packBytes, provider, state = { stack: new Set(), seen: 0 }) {
  const buffer = asBuffer(packBytes);
  const decoded = decodePack(buffer);
  const here = `${decoded.header.machine}:${decoded.header.sequence}`;
  if (state.stack.has(here)) throw new CoreError(422, 'invalid_pack', 'Pack dependencies form a cycle.');
  state.seen += 1;
  if (state.seen > MAX_INDEX_ITEMS) throw new CoreError(413, 'pack_too_large', 'The dependency graph is too large.');
  state.stack.add(here);
  const objects = new Map(decoded.objects);
  const missing = [];
  try {
    for (const dependency of decoded.dependencies) {
      if (state.stack.has(`${dependency.machine}:${dependency.sequence}`)) {
        throw new CoreError(422, 'invalid_pack', 'Pack dependencies form a cycle.');
      }
      const head = await provider.readHead(dependency.machine);
      if (!head) {
        missing.push(dependency);
        continue;
      }
      let validated;
      try {
        validated = validateHead(head, { machine: dependency.machine });
      } catch (error) {
        if (error?.code === 'corrupt_resource' || error?.code === 'invalid_pack' || error?.code === 'invalid_record_owner') throw error;
        throw new CoreError(422, 'corrupt_resource', 'The dependency head is not valid.');
      }
      const listed = validated.packs.find((item) => item.sequence === dependency.sequence);
      if (!listed) {
        missing.push(dependency);
        continue;
      }
      if (listed.hash !== dependency.packHash) throw new CoreError(422, 'corrupt_resource', 'The dependency digest does not match the head.');
      const packed = await provider.readPack(dependency.machine, dependency.sequence);
      if (!packed) {
        missing.push(dependency);
        continue;
      }
      const body = asBuffer(packed);
      if (body.length !== listed.bytes || hashBytes(body) !== dependency.packHash) {
        throw new CoreError(422, 'corrupt_resource', 'The dependency bytes do not match the head.');
      }
      const nested = await resolveDependencies(body, provider, state);
      if (nested.status === 'pending') {
        missing.push(...nested.missing);
        continue;
      }
      if (nested.decoded.header.machine !== dependency.machine || nested.decoded.header.sequence !== dependency.sequence) {
        throw new CoreError(422, 'corrupt_resource', 'The dependency owner does not match the reference.');
      }
      const raw = nested.objects.get(dependency.hash);
      if (!raw || hashBytes(raw) !== dependency.hash) throw new CoreError(422, 'corrupt_resource', 'The dependency does not contain the object.');
      objects.set(dependency.hash, raw);
    }
  } finally {
    state.stack.delete(here);
  }
  if (missing.length > 0) return { status: 'pending', decoded, objects, missing, packHash: decoded.packHash };
  for (const change of decoded.changes) {
    if (change.operation === 'put' && !objects.has(change.hash)) throw new CoreError(422, 'invalid_pack', 'A change object is missing from the pack.');
  }
  return { status: 'ready', decoded, objects, missing: [], packHash: decoded.packHash };
}

const NOTICE_KINDS = new Set(['chat-notice', 'approval-notice', 'task-notice', 'comment-notice', 'sync-notice', 'conflict-notice']);

export function countLogicalMessages(decoded, knownIds = null) {
  const seen = new Set(knownIds ?? []);
  let count = 0;
  const accept = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    count += 1;
  };
  for (const change of decoded.changes ?? []) {
    if (change.operation !== 'put') continue;
    const raw = decoded.objects?.get(change.hash);
    if (!raw) continue;
    if (raw.length > 1000000 && isMessageTarget(change.target)) {
      throw new CoreError(413, 'message_too_large', 'The message exceeds 1000000 bytes.');
    }
    if (isMessageTarget(change.target)) {
      const message = readMessage(raw, change.target);
      if (!message?.id || isDeterministicNotice(message)) continue;
      accept(message.id);
      continue;
    }
    if (!isCommentTarget(change.target)) continue;
    for (const id of commentIds(raw)) accept(id);
  }
  return count;
}

export function isDeterministicNotice(message) {
  if (!message || typeof message.id !== 'string' || !NOTICE_KINDS.has(message.kind)) return false;
  const expected = uuidV8(['notice', message.phase ?? '', message.window ?? '', message.subject ?? '']);
  if (message.id === expected) return true;
  return typeof message.resourceId === 'string' && message.resourceId !== '' && typeof message.noticeKey === 'string' && message.noticeKey === `${message.resourceId}:${message.recipient ?? message.toId ?? ''}`;
}

function framed(header, payload) {
  const json = Buffer.from(canonicalJson(header), 'utf8');
  const prefix = Buffer.alloc(8);
  prefix.write('H1P3', 0, 'ascii');
  prefix.writeUInt32BE(json.length, 4);
  return Buffer.concat([prefix, json, payload]);
}

function payloadOf(index, blobs) {
  const json = Buffer.from(canonicalJson(index), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return Buffer.concat([length, json, ...blobs]);
}

function expandObjects(entries, blobArea) {
  if (entries.length > MAX_INDEX_ITEMS) throw new CoreError(413, 'pack_too_large', 'The pack lists too many objects.');
  const ranges = [];
  const seen = new Set();
  let aggregate = 0;
  for (const entry of entries) {
    assertPlain(entry);
    exactKeys(entry, OBJECT_KEYS, 'object');
    if (!HASH.test(entry.hash ?? '')) throw new CoreError(422, 'invalid_pack', 'The object hash is not valid.');
    if (seen.has(entry.hash)) throw new CoreError(422, 'invalid_pack', 'The pack repeats an object hash.');
    seen.add(entry.hash);
    if (!Number.isSafeInteger(entry.offset) || entry.offset < 0) throw new CoreError(422, 'invalid_pack', 'The object offset is not valid.');
    if (!Number.isSafeInteger(entry.compressedBytes) || entry.compressedBytes < 1) throw new CoreError(422, 'invalid_pack', 'The compressed length is not valid.');
    if (!Number.isSafeInteger(entry.rawBytes) || entry.rawBytes < 0 || entry.rawBytes > MAX_OBJECT_BYTES) {
      throw new CoreError(413, 'resource_too_large', 'An object exceeds 16 MB.');
    }
    const end = entry.offset + entry.compressedBytes;
    if (end > blobArea.length) throw new CoreError(422, 'invalid_pack', 'The object extends past the pack.');
    aggregate += entry.rawBytes;
    if (aggregate > MAX_AGGREGATE_BYTES) throw new CoreError(413, 'pack_too_large', 'The pack expands past 64 MB.');
    ranges.push({ hash: entry.hash, start: entry.offset, end, rawBytes: entry.rawBytes });
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) throw new CoreError(422, 'invalid_pack', 'Pack objects overlap.');
    if (range.start > cursor) throw new CoreError(422, 'invalid_pack', 'The pack payload contains trailing bytes.');
    cursor = range.end;
  }
  if (cursor !== blobArea.length) throw new CoreError(422, 'invalid_pack', 'The pack payload contains trailing bytes.');
  const objects = new Map();
  for (const range of ranges) {
    const compressed = blobArea.subarray(range.start, range.end);
    const raw = decompressObject(compressed, range.rawBytes === 0 ? 1 : range.rawBytes);
    if (raw.length !== range.rawBytes || hashBytes(raw) !== range.hash) {
      throw new CoreError(422, 'corrupt_resource', 'The object bytes do not match the declared hash.');
    }
    objects.set(range.hash, raw);
  }
  return objects;
}

function validateDependency(dependency) {
  assertPlain(dependency);
  exactKeys(dependency, DEPENDENCY_KEYS, 'dependency');
  if (!HASH.test(dependency.hash ?? '') || !HASH.test(dependency.packHash ?? '')) throw new CoreError(422, 'invalid_pack', 'The dependency hash is not valid.');
  assertSequence(dependency.sequence);
  return {
    hash: dependency.hash,
    machine: validateMachineName(dependency.machine),
    sequence: dependency.sequence,
    packHash: dependency.packHash,
  };
}

function validateTransactions(transactions, changes) {
  assertArray(transactions, 'transactions');
  if (transactions.length > MAX_INDEX_ITEMS) throw new CoreError(413, 'pack_too_large', 'The pack lists too many transactions.');
  const byId = new Map();
  for (const change of changes) {
    if (!change.transactionId) continue;
    const group = byId.get(change.transactionId) ?? [];
    group.push(change.id);
    byId.set(change.transactionId, group);
  }
  const seen = new Set();
  const normalized = transactions.map((transaction) => {
    assertPlain(transaction);
    exactKeys(transaction, TRANSACTION_KEYS, 'transaction');
    if (!isUuid(transaction.id)) throw new CoreError(422, 'invalid_pack', 'The transaction id must be a UUID.');
    if (seen.has(transaction.id)) throw new CoreError(422, 'invalid_pack', 'The pack repeats a transaction.');
    seen.add(transaction.id);
    assertArray(transaction.changeIds, 'changeIds');
    if (transaction.changeIds.length === 0 || transaction.changeIds.some((id) => !isUuid(id))) {
      throw new CoreError(422, 'invalid_pack', 'The transaction members are not valid.');
    }
    if (new Set(transaction.changeIds).size !== transaction.changeIds.length) throw new CoreError(422, 'invalid_pack', 'The transaction repeats a change.');
    const members = byId.get(transaction.id) ?? [];
    const left = [...transaction.changeIds].sort();
    const right = [...members].sort();
    if (left.length !== right.length || left.some((id, index) => id !== right[index])) {
      throw new CoreError(422, 'invalid_pack', 'A transaction group is split across packs.');
    }
    return { id: transaction.id, changeIds: transaction.changeIds };
  });
  for (const id of byId.keys()) {
    if (!seen.has(id)) throw new CoreError(422, 'invalid_pack', 'A transaction group is split across packs.');
  }
  const ids = new Set();
  for (const change of changes) {
    if (ids.has(change.id)) throw new CoreError(422, 'invalid_pack', 'The pack repeats a change id.');
    ids.add(change.id);
  }
  return normalized;
}

function safeMindPath(input) {
  const relative = safeRelative(input);
  if (!relative.startsWith('user/') || relative === 'user') throw new CoreError(422, 'invalid_pack', 'A mind target must stay inside private records.');
  rejectExcluded(relative);
  if (LOCAL_PREFIXES.some((prefix) => relative.startsWith(prefix))) throw new CoreError(422, 'invalid_pack', 'Machine-local secrets are not replicated.');
  return relative;
}

function safeProjectPath(input) {
  const relative = safeRelative(input);
  rejectExcluded(relative);
  return relative;
}

function rejectExcluded(relative) {
  const parts = relative.split('/');
  if (parts.some((part) => part === '.git' || part === 'node_modules')) throw new CoreError(422, 'invalid_pack', 'Kit and repository metadata are not replicated.');
  const name = parts[parts.length - 1];
  if (isTemporaryName(name) || isConflictName(name) || isSecretName(name)) throw new CoreError(422, 'invalid_pack', 'Temporary and secret files are not replicated.');
}

export function isTemporaryName(name) {
  return name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.partial') || name.endsWith('~');
}

export function isConflictName(name) {
  return name.includes('.conflict-');
}

export function isSecretName(name) {
  return name === 'credentials.json' || name.endsWith('.key') || name.endsWith('.token');
}

function isMessageTarget(target) {
  if (!target?.path || target.path.includes('/read/')) return false;
  return /(^|\/)inbox\/[^/]+\/[^/]+\.md$/.test(target.path)
    || /(^|\/)archive\/[^/]+\/[^/]+\.md$/.test(target.path)
    || /(^|\/)chats\/[^/]+\/[^/]+\.md$/.test(target.path);
}

function isCommentTarget(target) {
  return Boolean(target && (target.path.endsWith('.comments.json') || target.path.includes('/comments/')));
}

function readMessage(raw, target) {
  const text = raw.toString('utf8');
  const split = text.split(/\r?\n\r?\n/, 2);
  const headers = {};
  for (const line of split[0].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  const fileId = target?.path?.split('/').pop()?.replace(/\.md$/, '') ?? '';
  const id = headers.id || (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fileId) ? fileId : '');
  if (!id) return null;
  return {
    id,
    kind: headers.kind ?? null,
    phase: headers.phase ?? '',
    window: headers.window ?? '',
    subject: headers.subject ?? '',
    resourceId: headers['resource-id'] ?? null,
    noticeKey: headers['notice-key'] ?? null,
    recipient: headers['to-id'] ?? null,
    toId: headers['to-id'] ?? null,
  };
}

function commentIds(raw) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return [];
  }
  const ids = [];
  const threads = Array.isArray(parsed?.threads) ? parsed.threads : [];
  for (const thread of threads) {
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];
    for (const message of messages) {
      if (typeof message?.id === 'string') ids.push(message.id);
      if (typeof message?.proposal?.id === 'string') ids.push(message.proposal.id);
    }
  }
  return ids;
}

function objectMap(objects) {
  const map = new Map();
  const entries = objects instanceof Map ? [...objects.entries()].map(([hash, raw]) => ({ hash, raw })) : objects;
  if (!Array.isArray(entries) && !(objects instanceof Map)) throw new CoreError(422, 'invalid_pack', 'Pack objects must be a list.');
  for (const entry of entries) {
    if (!HASH.test(entry.hash ?? '')) throw new CoreError(422, 'invalid_pack', 'The object hash is not valid.');
    const raw = asBuffer(entry.raw);
    if (map.has(entry.hash)) throw new CoreError(422, 'invalid_pack', 'The pack repeats an object hash.');
    map.set(entry.hash, raw);
  }
  return map;
}

function assertSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SEQUENCE) throw new CoreError(422, 'invalid_pack', 'The pack sequence is not valid.');
}

function assertEncryption(encryption) {
  if (!encryption || encryption.algorithm !== 'none') throw new CoreError(422, 'unsupported_origin', 'Encryption and Quantum origins are not available.');
  exactKeys(encryption, ['algorithm'], 'encryption');
}

function assertArray(value, label) {
  if (!Array.isArray(value) || value.length > MAX_INDEX_ITEMS) throw new CoreError(422, 'invalid_pack', `The pack ${label} list is not valid.`);
}

function exactKeys(value, keys, label) {
  const present = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (present.length !== expected.length || present.some((key, index) => key !== expected[index])) {
    throw new CoreError(422, 'invalid_pack', `The pack ${label} contains an unexpected field.`);
  }
}

function assertPlain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CoreError(422, 'invalid_pack', 'The pack structure is not valid.');
}

function parseJson(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CoreError(400, 'invalid_json', 'The pack is not valid UTF-8.');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CoreError(400, 'invalid_json', 'The pack is not valid JSON.');
  }
  assertBounded(value, 1);
  return value;
}

function assertBounded(value, depth) {
  if (depth > 40) throw new CoreError(400, 'invalid_json', 'JSON exceeds the maximum nesting depth.');
  if (Array.isArray(value)) {
    if (value.length > MAX_INDEX_ITEMS) throw new CoreError(400, 'invalid_json', 'JSON exceeds the maximum array length.');
    for (const item of value) assertBounded(item, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > MAX_INDEX_ITEMS) throw new CoreError(400, 'invalid_json', 'JSON exceeds the maximum object size.');
    for (const key of keys) assertBounded(value[key], depth + 1);
  }
}

function readSpan(buffer, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > buffer.length) throw new CoreError(422, 'invalid_pack', 'The pack length is truncated.');
  const length = buffer.readUInt32BE(offset);
  const start = offset + 4;
  if (!Number.isSafeInteger(length) || length > buffer.length - start) throw new CoreError(422, 'invalid_pack', 'The pack length is out of range.');
  return { bytes: buffer.subarray(start, start + length), end: start + length };
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  throw new CoreError(422, 'invalid_pack', 'Pack bytes are required.');
}
