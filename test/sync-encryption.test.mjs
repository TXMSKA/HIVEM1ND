import { createDecipheriv, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, hashBytes, uuidV8 } from '../engine/service/identity.mjs';
import { applyPack } from '../engine/sync/apply.mjs';
import { decodePack, encodePack, packFileName, resolveDependencies } from '../engine/sync/pack.mjs';
import { openSync } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const AT = '2026-10-10T12:00:00.000Z';
const KEY = randomBytes(32);
const KEY_ID = 'relan:primary';
const ENCRYPTION = { algorithm: 'aes-256-gcm', keyId: KEY_ID };
const keyProvider = keyId => keyId === KEY_ID ? KEY : null;

function change(name, raw) {
  return {
    format: 'hivem1nd-change-v1',
    id: uuidV8(['encrypted-change', name]),
    machine: 'LAPTOP',
    at: AT,
    target: { kind: 'mind', path: `user/${name}.txt` },
    operation: raw ? 'put' : 'delete',
    hash: raw ? hashBytes(raw) : null,
    size: raw?.length ?? 0,
    baseHash: null,
    messageId: null,
    transactionId: null,
  };
}

function pack(options = {}) {
  const raw = Buffer.from('private pack content');
  return encodePack({
    machine: 'LAPTOP', sequence: 1,
    changes: [change('private', raw)],
    objects: [{ hash: hashBytes(raw), raw }],
    encryption: ENCRYPTION,
    keyProvider,
    ...options,
  });
}

function readFramed(bytes) {
  const length = bytes.readUInt32BE(4);
  return { header: JSON.parse(bytes.subarray(8, 8 + length)), payload: bytes.subarray(8 + length) };
}

function rewrite(bytes, mutateHeader = () => {}, mutatePayload = () => {}, updateHash = false) {
  const framed = readFramed(bytes);
  const payload = Buffer.from(framed.payload);
  mutatePayload(payload);
  if (updateHash) {
    framed.header.payloadHash = hashBytes(payload);
    framed.header.payloadBytes = payload.length;
  }
  mutateHeader(framed.header);
  const json = Buffer.from(canonicalJson(framed.header));
  const prefix = Buffer.alloc(8);
  prefix.write('H1P3', 0, 'ascii');
  prefix.writeUInt32BE(json.length, 4);
  return Buffer.concat([prefix, json, payload]);
}

function headFor(packs) {
  return {
    format: 'hivem1nd-head-v1', machine: 'LAPTOP', sequence: packs.length, updatedAt: AT,
    packs: packs.map((bytes, index) => ({ sequence: index + 1, file: packFileName(index + 1), hash: hashBytes(bytes), bytes: bytes.length })),
  };
}

async function snapshot(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files.push([path.relative(root, file), hashBytes(await readFile(file))]);
    }
  }
  await walk(root);
  return files.sort(([left], [right]) => left.localeCompare(right));
}

test('AES-256-GCM encrypts the complete index and compressed blobs with the contract additional data', () => {
  const bytes = pack();
  const { header, payload } = readFramed(bytes);
  assert.deepEqual(Object.keys(header.encryption).sort(), ['algorithm', 'keyId', 'nonce', 'tag']);
  assert.equal(header.encryption.algorithm, 'aes-256-gcm');
  assert.equal(header.encryption.keyId, KEY_ID);
  assert.equal(Buffer.from(header.encryption.nonce, 'base64url').length, 12);
  assert.equal(Buffer.from(header.encryption.tag, 'base64url').length, 16);
  assert.equal(header.payloadHash, hashBytes(payload));
  assert.equal(header.payloadBytes, payload.length);
  assert.equal(payload.includes(Buffer.from('user/private.txt')), false);
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(header.encryption.nonce, 'base64url'), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(`hivem1nd-pack-v1:LAPTOP:1:${KEY_ID}`));
  decipher.setAuthTag(Buffer.from(header.encryption.tag, 'base64url'));
  const plain = Buffer.concat([decipher.update(payload), decipher.final()]);
  assert.deepEqual(plain, readFramed(pack({ encryption: { algorithm: 'none' } })).payload);
  const decoded = decodePack(bytes, { keyProvider, expectedHash: hashBytes(bytes), machine: 'LAPTOP' });
  assert.deepEqual(decoded.header.encryption, header.encryption);
  assert.deepEqual(decoded.objects.get(decoded.changes[0].hash), Buffer.from('private pack content'));
  assert.equal(decoded.packHash, hashBytes(bytes));
  assert.deepEqual(decodePack(bytes, { keyProvider: () => new Uint8Array(KEY) }).changes, decoded.changes);
  const unicode = pack({ encryption: { algorithm: 'aes-256-gcm', keyId: 'key-\u00e9-\ud83d\udd10' }, keyProvider: () => KEY });
  assert.equal(decodePack(unicode, { keyProvider: () => KEY }).header.encryption.keyId, 'key-\u00e9-\ud83d\udd10');
});

test('each encoding uses a new random nonce even when its payload and key are identical', () => {
  const first = pack();
  const second = pack();
  assert.notEqual(readFramed(first).header.encryption.nonce, readFramed(second).header.encryption.nonce);
  assert.notDeepEqual(first, second);
  assert.deepEqual(decodePack(first, { keyProvider }).index, decodePack(second, { keyProvider }).index);
});

test('plain folder and OneDrive packs keep their framing and never request a key', async () => {
  const options = { encryption: { algorithm: 'none' }, keyProvider() { throw new Error('Plain packs need no key.'); } };
  const bytes = pack(options);
  assert.deepEqual(bytes, pack({ encryption: { algorithm: 'none' }, keyProvider: null }));
  assert.deepEqual(decodePack(bytes, options).header.encryption, { algorithm: 'none' });
  assert.deepEqual(decodePack(bytes).objects.get(hashBytes(Buffer.from('private pack content'))), Buffer.from('private pack content'));
  assert.equal((await resolveDependencies(bytes)).status, 'ready');
  const tomb = change('deleted', null);
  const empty = pack({ changes: [tomb], objects: [] });
  assert.equal(decodePack(empty, { keyProvider }).changes[0].operation, 'delete');
  assert.equal(decodePack(pack({ changes: [], objects: [] }), { keyProvider }).objects.size, 0);
});

test('missing, unavailable and invalid keys have explicit errors on both encode and decode', () => {
  const bytes = pack();
  for (const provider of [null, undefined, () => null, () => undefined, () => { throw new Error('Unavailable secret'); }]) {
    assert.throws(() => pack({ keyProvider: provider }), { code: 'encryption_key_missing' });
    assert.throws(() => decodePack(bytes, { keyProvider: provider }), { code: 'encryption_key_missing' });
  }
  for (const key of [Buffer.alloc(31), Buffer.alloc(33), 'a'.repeat(32), Array(32).fill(0), new ArrayBuffer(32), Promise.resolve(KEY)]) {
    assert.throws(() => pack({ keyProvider: () => key }), { code: 'invalid_encryption_key' });
    assert.throws(() => decodePack(bytes, { keyProvider: () => key }), { code: 'invalid_encryption_key' });
  }
  assert.throws(() => decodePack(bytes, { keyProvider: () => Buffer.alloc(32) }), { code: 'authentication_failed' });
});

test('changed ciphertext, tag, nonce, machine, sequence and key id are refused before decoding', () => {
  const bytes = pack();
  const cases = [
    ['ciphertext digest', rewrite(bytes, () => {}, payload => { payload[0] ^= 1; }), 'corrupt_resource'],
    ['ciphertext with rewritten digest', rewrite(bytes, () => {}, payload => { payload[payload.length - 1] ^= 1; }, true), 'authentication_failed'],
    ['machine additional data', rewrite(bytes, header => { header.machine = 'OTHER'; }), 'authentication_failed'],
    ['sequence additional data', rewrite(bytes, header => { header.sequence = 2; }), 'authentication_failed'],
    ['key id additional data', rewrite(bytes, header => { header.encryption.keyId = 'other-key'; }), 'authentication_failed'],
    ['nonce', rewrite(bytes, header => { const nonce = Buffer.from(header.encryption.nonce, 'base64url'); nonce[0] ^= 1; header.encryption.nonce = nonce.toString('base64url'); }), 'authentication_failed'],
    ['tag', rewrite(bytes, header => { const tag = Buffer.from(header.encryption.tag, 'base64url'); tag[0] ^= 1; header.encryption.tag = tag.toString('base64url'); }), 'authentication_failed'],
    ['length', rewrite(bytes, header => { header.payloadBytes += 1; }), 'corrupt_resource'],
    ['hash', rewrite(bytes, header => { header.payloadHash = 'ff'.repeat(32); }), 'corrupt_resource'],
  ];
  for (const [name, corrupted, code] of cases) {
    assert.throws(() => decodePack(corrupted, { keyProvider: () => KEY }), error => {
      assert.equal(error.code, code, name);
      return true;
    });
  }
  assert.throws(() => decodePack(bytes, { keyProvider, expectedHash: 'ff'.repeat(32) }), { code: 'corrupt_resource' });
  assert.throws(() => decodePack(bytes, { keyProvider, machine: 'OTHER' }), { code: 'invalid_record_owner' });
});

test('malformed envelopes, key ids and noncanonical nonce or tag encodings are refused', () => {
  const bytes = pack();
  const { encryption } = readFramed(bytes).header;
  const malformed = [
    null, [], 'aes-256-gcm',
    { ...encryption, keyId: '' }, { ...encryption, keyId: 7 }, { ...encryption, keyId: 'a'.repeat(257) },
    ...['\n', '\r', '\u0000', '\ud800', '\udfff'].map(value => ({ ...encryption, keyId: `key${value}` })),
    { algorithm: encryption.algorithm, keyId: KEY_ID, tag: encryption.tag },
    { algorithm: encryption.algorithm, keyId: KEY_ID, nonce: encryption.nonce }, { ...encryption, extra: true },
    ...[null, 7, '', 'n', 'a'.repeat(15), 'a'.repeat(17), `${encryption.nonce}=`, '+'.repeat(16)].map(nonce => ({ ...encryption, nonce })),
    ...[null, 7, '', 't', 'a'.repeat(21), 'a'.repeat(23), `${encryption.tag}=`, '/'.repeat(22), `${'A'.repeat(21)}B`].map(tag => ({ ...encryption, tag })),
  ];
  for (const envelope of malformed) {
    const changed = rewrite(bytes, header => { header.encryption = envelope; });
    assert.throws(() => decodePack(changed, { keyProvider }), { code: 'invalid_pack' });
  }
  for (const value of ['', 7, 'a'.repeat(257), 'key\n', 'key\ud800', 'key\udfff']) {
    assert.throws(() => pack({ encryption: { algorithm: 'aes-256-gcm', keyId: value } }), { code: 'invalid_pack' });
  }
  assert.throws(() => pack({ encryption }), { code: 'invalid_pack' });
  assert.throws(() => pack({ encryption: { algorithm: 'aes-128-gcm', keyId: KEY_ID } }), { code: 'unsupported_origin' });
  assert.throws(() => decodePack(rewrite(bytes, header => { header.encryption.algorithm = 'aes-128-gcm'; }), { keyProvider }), { code: 'unsupported_origin' });
  assert.throws(() => decodePack(rewrite(bytes, header => { header.quantum = true; }), { keyProvider }), { code: 'unsupported_origin' });
});

test('encrypted dependencies use the provider for each key and refuse a missing or wrong dependency key', async () => {
  const base = pack();
  const hash = hashBytes(Buffer.from('private pack content'));
  const nextKey = randomBytes(32);
  const later = pack({ sequence: 2, changes: [change('later', Buffer.from('private pack content'))], objects: [],
    dependencies: [{ hash, machine: 'LAPTOP', sequence: 1, packHash: hashBytes(base) }],
    encryption: { algorithm: 'aes-256-gcm', keyId: 'next' }, keyProvider: () => nextKey });
  const requested = [];
  const provider = {
    keyProvider(keyId) { requested.push(keyId); return keyId === 'next' ? nextKey : keyProvider(keyId); },
    async readHead() { return headFor([base, later]); },
    async readPack() { return base; },
  };
  const ready = await resolveDependencies(later, provider);
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.objects.get(hash), Buffer.from('private pack content'));
  assert.deepEqual(requested, ['next', KEY_ID]);
  await assert.rejects(resolveDependencies(later, { ...provider, keyProvider: keyId => keyId === 'next' ? nextKey : null }), { code: 'encryption_key_missing' });
  await assert.rejects(resolveDependencies(later, { ...provider, keyProvider: () => nextKey }), { code: 'authentication_failed' });
  assert.equal((await resolveDependencies(later, { ...provider, async readPack() { return null; } })).status, 'pending');
});

test('authentication failures leave all mind and received files unchanged, then valid keys apply the whole pack', async t => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const sync = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const first = Buffer.from('first encrypted file');
  const second = Buffer.from('second encrypted file');
  const transactionId = uuidV8(['encrypted-transaction']);
  const changes = [change('first', first), change('second', second)].map(item => ({ ...item, transactionId }));
  const bytes = pack({ changes, objects: [{ hash: hashBytes(first), raw: first }, { hash: hashBytes(second), raw: second }],
    transactions: [{ id: transactionId, changeIds: changes.map(item => item.id) }] });
  const before = await snapshot(fixture.root);
  const provider = { keyProvider, async readHead() { return headFor([bytes]); }, async readPack() { return null; } };
  for (const [body, keys, code] of [
    [bytes, null, 'encryption_key_missing'],
    [bytes, () => Buffer.alloc(32), 'authentication_failed'],
    [rewrite(bytes, () => {}, payload => { payload[0] ^= 1; }, true), keyProvider, 'authentication_failed'],
    [rewrite(bytes, header => { header.sequence = 2; }), keyProvider, 'authentication_failed'],
  ]) {
    await assert.rejects(applyPack(sync, body, { provider: { ...provider, keyProvider: keys } }), { code });
    assert.deepEqual(await snapshot(fixture.root), before);
  }
  assert.equal((await applyPack(sync, bytes, { provider })).status, 'applied');
  assert.deepEqual(await readFile(path.join(fixture.paths.mind, 'user', 'first.txt')), first);
  assert.deepEqual(await readFile(path.join(fixture.paths.mind, 'user', 'second.txt')), second);
  const received = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'received', 'LAPTOP', 'head.json')));
  assert.equal(received.sequence, 1);
  assert.equal((await applyPack(sync, bytes, { provider })).replayed, true);
});
