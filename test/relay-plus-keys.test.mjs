import test from 'node:test';
import assert from 'node:assert/strict';
import { hkdfSync, randomBytes, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openPasswordEnvelope } from '../engine/relay-plus/account-key.mjs';
import { createRecoveryEnvelope, createRelayPlusKeys } from '../engine/relay-plus/keys.mjs';

const phrase = Array(24).fill('acorn').join(' ');
function fixture() {
  const keys = new Map(), states = new Map(), stores = new Map(), minds = new Map();
  const accountKeyStore = {
    readAccountKey: async (id, { file }) => { const stored = stores.get(`${file}:${id}`); return stored ? Buffer.from(stored) : null; },
    writeAccountKey: async (id, key, { file }) => stores.set(`${file}:${id}`, Buffer.from(key)),
  };
  function machine(deviceId, mindId = 'mind', overrides = {}) {
    return createRelayPlusKeys({ accountId: 'account', deviceId, mindId, accountKeyStoreFile: deviceId, accountKeyStore,
      loadState: async () => structuredClone(states.get(deviceId) ?? null),
      saveState: async value => states.set(deviceId, structuredClone(value)),
      loadMindKey: async () => minds.get(`${deviceId}:${mindId}`),
      saveMindKey: async value => minds.set(`${deviceId}:${mindId}`, { ...value, key: Buffer.from(value.key) }),
      client: { async request(path, options) {
        if (path === '/v1/key-approvers/availability') return { available: false };
        assert.equal(path, '/v1/keys');
        assert.equal(options, undefined, 'ONEM1ND never writes account recipients');
        return { keys: [...keys.values()] };
      } },
      ...overrides,
    });
  }
  return { keys, states, stores, minds, machine };
}

test('phrase recovery uses site binary PBKDF2 layout and HKDF app keys', async () => {
  const { keys, machine, stores } = fixture(), key = randomBytes(32);
  const { envelope } = createRecoveryEnvelope({ phrase, key });
  assert.equal(Buffer.from(envelope.wrapped, 'base64').length, 77);
  const bytes = Buffer.from(envelope.wrapped, 'base64');
  const raw = await webcrypto.subtle.importKey('raw', Buffer.from(phrase), 'PBKDF2', false, ['deriveKey']);
  const wrapping = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes.subarray(1, 17), iterations: 600000 }, raw, { name: 'AES-GCM', length: 256 }, false, ['decrypt', 'encrypt']);
  assert.deepEqual(Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(17, 29), additionalData: Buffer.from(envelope.algorithm), tagLength: 128 }, wrapping, bytes.subarray(29))), key);
  // Produce the envelope through the same browser primitive used by site/src/recovery.ts.
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes.subarray(17, 29), additionalData: Buffer.from(envelope.algorithm), tagLength: 128 }, wrapping, key);
  keys.set('phrase', { recipient: 'phrase', algorithm: envelope.algorithm, wrapped: Buffer.concat([bytes.subarray(0, 29), Buffer.from(ciphertext)]).toString('base64') });
  const first = machine('first');
  await assert.rejects(first.recover(Array(24).fill('amber').join(' ')), { code: 'key_authentication_failed' });
  await first.recover(phrase);
  assert.deepEqual(stores.get('first:account'), key);
  assert.deepEqual(first.headKey(), Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'cosmic/account/hivem1nd/heads', 32)));
  assert.equal(first.keyProvider(first.encryption.keyId), null, 'account key never becomes a pack key');
  await first.createMindKey();
  assert.notDeepEqual(first.keyProvider(first.encryption.keyId), key);
  first.lock(); assert.equal(await first.unlock(), true);
  assert.ok(first.keyProvider(first.encryption.keyId));
});

test('a missing phrase does not tell a password-less account to create one', async () => {
  const { machine, keys } = fixture(), first = machine('first');
  assert.equal(await first.unlock(), false);
  assert.equal(first.requiredState.code, 'account_key_unavailable');
  assert.equal(first.requiredState.methods.phrase, false);
  assert.equal(first.requiredState.methods.password, false);
  await assert.rejects(first.recover(phrase), { code: 'account_key_unavailable' });
  keys.set('phrase', { recipient: 'phrase', ...createRecoveryEnvelope({ phrase }).envelope });
  await first.refresh();
  assert.equal(first.requiredState.code, 'key_required');
  assert.equal(first.requiredState.methods.phrase, true);
  assert.equal(first.requiredState.methods.password, false);
});

test('shared store unlock avoids network and preserves existing ReLAN pack key', async () => {
  const { machine, stores } = fixture();
  stores.set('first:account', randomBytes(32));
  const existingMindKey = { keyId: 'existing-key', relanId: 'existing-mind', key: randomBytes(32) };
  const first = machine('first', 'mind', { existingMindKey, client: { request: () => assert.fail('store hit must not request a phrase') } });
  assert.equal(await first.unlock(), true);
  await first.createMindKey();
  assert.equal(first.encryption.keyId, 'existing-key');
  assert.deepEqual(first.keyProvider('existing-key'), existingMindKey.key);
});

test('sealed M1ND material is account and M1ND bound; each M1ND retains its own key', async () => {
  const { machine, stores } = fixture(), key = randomBytes(32);
  for (const id of ['first', 'second', 'third']) stores.set(`${id}:account`, key);
  const first = machine('first'), second = machine('second'), other = machine('third', 'other');
  await first.unlock(); await second.unlock(); await other.unlock();
  await first.createMindKey();
  await second.openMindKey(first.sealMindKey());
  assert.deepEqual(second.keyProvider(second.encryption.keyId), first.keyProvider(first.encryption.keyId));
  await assert.rejects(other.openMindKey(first.sealMindKey()), { code: 'key_authentication_failed' });
  await other.createMindKey();
  assert.notDeepEqual(other.keyProvider(other.encryption.keyId), first.keyProvider(first.encryption.keyId));
});

test('legacy pending approval state is removed and unrelated fields stay', async () => {
  const { machine, states } = fixture();
  states.set('first', { pending: { privateKey: 'not-resumed' }, note: 'kept' });
  const first = machine('first');
  assert.equal(await first.unlock(), false);
  assert.equal(states.get('first').pending, undefined);
  assert.equal(states.get('first').note, 'kept');
  assert.equal(first.createApprovalRequest, undefined);
  assert.equal(first.approve, undefined);
});

test('remote copies of retained ReLAN material do not rewrite its key file', async () => {
  const { machine, stores } = fixture(), account = randomBytes(32);
  stores.set('first:account', account); stores.set('second:account', account);
  const retained = { relanId: 'retained', keyId: 'retained-key', key: randomBytes(32) };
  const first = machine('first', 'mind', { existingMindKey: retained });
  const second = machine('second', 'mind', { loadMindKey: async () => retained, saveMindKey: () => assert.fail('identical material must not rewrite the ReLAN key') });
  await first.unlock(); await second.unlock();
  await second.openMindKey(first.sealMindKey());
  await second.openMindKey(first.sealMindKey());
  await second.createMindKey();
});

test('password and phrase availability stay separate and a store hit does not fetch envelopes', async () => {
  const { machine, keys, stores } = fixture();
  const calls = [];
  const quiet = machine('quiet', 'mind', { client: { request: () => assert.fail('store hit must not fetch envelopes') } });
  stores.set('quiet:account', randomBytes(32));
  assert.equal(await quiet.unlock(), true);
  keys.set('password', { recipient: 'password', algorithm: 'QNT_PASSWORD_PBKDF2_SHA256_AES256GCM_V1', wrapped: 'A'.repeat(108) });
  keys.set('phrase', { recipient: 'phrase', algorithm: 'nope', wrapped: 'QQ==' });
  const both = machine('both', 'mind', { client: { async request(path) { calls.push(path); return path.endsWith('availability') ? { available: true } : { keys: [...keys.values()] }; } } });
  assert.equal(await both.unlock(), false);
  assert.equal(both.requiredState.methods.password, false);
  assert.equal(both.requiredState.formats.password, 'unsupported');
  assert.equal(both.requiredState.formats.phrase, 'unsupported');
  assert.equal(both.requiredState.methods.approval, true);
  assert.deepEqual(calls, ['/v1/keys', '/v1/key-approvers/availability']);
  const other = randomBytes(32);
  stores.set('other:account', other);
  assert.equal(stores.has('quiet:account'), true);
});

const vectors = JSON.parse(await readFile(new URL('./fixtures/cosmic-keys-vectors.json', import.meta.url), 'utf8'));
// Fixture copied from Quantum commit f999f553ca3f5f205231e317872f8add7108f75c docs/keys-vectors.json, git blob 48e19a657da657322ffeb88ace52fc222545cdbc.

test('the frozen password vector opens to K and malformed envelopes never derive', async () => {
  const password = vectors.password;
  const key = Buffer.from(password.keyHex, 'hex');
  const opened = await openPasswordEnvelope({ algorithm: password.algorithm, wrapped: password.wrapped }, password.password, password.accountId);
  assert.deepEqual(opened, key);
  let derived = 0;
  const derive = () => { derived += 1; return Buffer.alloc(32); };
  const envelope = { algorithm: password.algorithm, wrapped: password.wrapped };
  await assert.rejects(openPasswordEnvelope(envelope, 'wrong horse battery staple', password.accountId), { code: 'key_authentication_failed' });
  await assert.rejects(openPasswordEnvelope(envelope, password.password, '00000000-0000-4000-8000-000000000002'), { code: 'key_authentication_failed' });
  await assert.rejects(openPasswordEnvelope({ ...envelope, algorithm: 'other' }, password.password, password.accountId, { derive }), { code: 'unsupported_key_format' });
  await assert.rejects(openPasswordEnvelope({ ...envelope, wrapped: password.wrapped.slice(0, -1) }, password.password, password.accountId, { derive }), { code: 'invalid_key_envelope' });
  const decoded = Buffer.from(password.wrapped, 'base64');
  decoded[0] = 2;
  await assert.rejects(openPasswordEnvelope({ ...envelope, wrapped: decoded.toString('base64') }, password.password, password.accountId, { derive }), { code: 'unsupported_key_format' });
  decoded[0] = 1; decoded[2] ^= 0xff;
  await assert.rejects(openPasswordEnvelope({ ...envelope, wrapped: decoded.toString('base64') }, password.password, password.accountId, { derive }), { code: 'unsupported_key_format' });
  decoded[2] ^= 0xff;
  decoded[decoded.length - 1] ^= 1;
  await assert.rejects(openPasswordEnvelope({ ...envelope, wrapped: decoded.toString('base64') }, password.password, password.accountId), { code: 'key_authentication_failed' });
  await assert.rejects(openPasswordEnvelope(envelope, '', password.accountId, { derive }), { code: 'key_authentication_failed' });
  await assert.rejects(openPasswordEnvelope(envelope, 'a'.repeat(129), password.accountId, { derive }), { code: 'key_authentication_failed' });
  await openPasswordEnvelope(envelope, 'a', password.accountId, { derive }).catch(error => assert.equal(error.code, 'key_authentication_failed'));
  assert.equal(derived, 1, 'only a length-valid password reaches PBKDF2');
  const composed = 'e\u0301';
  let seen = null;
  await openPasswordEnvelope(envelope, ` ${composed} `, password.accountId, { derive: bytes => { seen = Buffer.from(bytes); return Buffer.alloc(32); } }).catch(() => {});
  assert.deepEqual(seen, Buffer.from(` ${composed.normalize('NFC')} `));
});

test('one shared-store write records a successful password open and keeps another account', async () => {
  const { machine, keys, stores } = fixture();
  const password = vectors.password;
  let writes = 0;
  const kept = randomBytes(32);
  stores.set('other-file:other', kept);
  keys.set('password', { recipient: 'password', algorithm: password.algorithm, wrapped: password.wrapped });
  const first = machine('first', 'mind', { accountId: password.accountId, accountKeyStore: {
    readAccountKey: async () => null,
    writeAccountKey: async (_id, key) => { writes += 1; stores.set('saved', Buffer.from(key)); },
  } });
  await assert.rejects(first.unlockPassword('not-the-vector-secret'), { code: 'key_authentication_failed' });
  assert.equal(writes, 0);
  await first.unlockPassword(password.password);
  await first.unlockPassword(password.password);
  assert.equal(writes, 1);
  assert.deepEqual(stores.get('saved'), Buffer.from(password.keyHex, 'hex'));
  assert.deepEqual(stores.get('other-file:other'), kept);
});
