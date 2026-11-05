import test from 'node:test';
import assert from 'node:assert/strict';
import { hkdfSync, randomBytes, webcrypto } from 'node:crypto';
import { createRecoveryEnvelope, createRelayPlusKeys } from '../engine/relay-plus/keys.mjs';

const phrase = Array(24).fill('acorn').join(' ');
function fixture() {
  const keys = new Map(), states = new Map(), stores = new Map(), minds = new Map();
  const accountKeyStore = {
    readAccountKey: async (id, { file }) => stores.get(`${file}:${id}`) ?? null,
    writeAccountKey: async (id, key, { file }) => stores.set(`${file}:${id}`, Buffer.from(key)),
  };
  function machine(deviceId, mindId = 'mind', overrides = {}) {
    return createRelayPlusKeys({ accountId: 'account', deviceId, mindId, accountKeyStoreFile: deviceId, accountKeyStore,
      loadState: async () => structuredClone(states.get(deviceId)),
      saveState: async value => states.set(deviceId, structuredClone(value)),
      loadMindKey: async () => minds.get(`${deviceId}:${mindId}`),
      saveMindKey: async value => minds.set(`${deviceId}:${mindId}`, { ...value, key: Buffer.from(value.key) }),
      client: { async request(path, options) { assert.equal(path, '/v1/keys'); assert.equal(options, undefined, 'ONEM1ND never writes account recipients'); return { keys: [...keys.values()] }; } },
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

test('missing phrase directs the person to the Cosmic site without writing a recipient', async () => {
  const { machine, keys } = fixture(), first = machine('first');
  assert.equal(await first.unlock(), false);
  assert.equal(first.requiredState.code, 'recovery_phrase_setup_required');
  assert.match(first.requiredState.message, /Cosmic account site/);
  await assert.rejects(first.recover(phrase), { code: 'recovery_phrase_setup_required' });
  keys.set('phrase', { recipient: 'phrase', ...createRecoveryEnvelope({ phrase }).envelope });
  assert.equal(await first.unlock(), false);
  assert.equal(first.requiredState.code, 'recovery_phrase_required');
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

test('temporary X25519 approval wraps K, confirms fingerprint and rejects replay', async () => {
  const { machine, stores, states } = fixture(), key = randomBytes(32);
  stores.set('first:account', key);
  const first = machine('first'), second = machine('second');
  await first.unlock(); await first.createMindKey();
  const request = await second.createApprovalRequest('first');
  assert.equal((await first.inspectApproval(request.ciphertext, 'second')).fingerprint, request.fingerprint);
  await assert.rejects(first.approve(request.ciphertext, { senderDeviceId: 'second', fingerprint: 'wrong' }), { code: 'approval_confirmation_required' });
  await assert.rejects(first.inspectApproval(request.ciphertext, 'impostor'), { code: 'invalid_approval' });
  const approval = await first.approve(request.ciphertext, { senderDeviceId: 'second', fingerprint: request.fingerprint });
  const payload = JSON.parse(approval.ciphertext);
  assert.equal(payload.algorithm, 'QNT_X25519_HKDF_SHA256_AES256GCM_V1');
  assert.equal(Buffer.from(payload.wrapped, 'base64').length, 93);
  const encoded = Buffer.from(payload.wrapped, 'base64');
  const pending = states.get('second').pending;
  const privateKey = await webcrypto.subtle.importKey('pkcs8', Buffer.from(pending.privateKey, 'base64'), { name: 'X25519' }, false, ['deriveBits']);
  const ephemeral = await webcrypto.subtle.importKey('raw', encoded.subarray(1, 33), { name: 'X25519' }, false, []);
  const secret = await webcrypto.subtle.deriveBits({ name: 'X25519', public: ephemeral }, privateKey, 256);
  const hkdf = await webcrypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const wrapping = await webcrypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: Buffer.concat([encoded.subarray(1, 33), Buffer.from(pending.publicKey, 'base64')]), info: Buffer.from(payload.algorithm) }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const aad = `cosmic/account/account/hivem1nd/approval:${pending.id}:second`;
  assert.deepEqual(Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: encoded.subarray(33, 45), additionalData: Buffer.from(aad), tagLength: 128 }, wrapping, encoded.subarray(45))), key);
  await assert.rejects(webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: encoded.subarray(33, 45), additionalData: Buffer.from(aad.replace('/account/account/', '/account/other/')), tagLength: 128 }, wrapping, encoded.subarray(45)));
  const tampered = Buffer.from(encoded); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(second.acceptApproval(Buffer.from(JSON.stringify({ ...payload, wrapped: tampered.toString('base64') })), 'first'), { code: 'key_authentication_failed' });
  assert.ok(!approval.ciphertext.includes(key));
  await assert.rejects(second.acceptApproval(approval.ciphertext, 'impostor'), { code: 'invalid_approval' });
  await second.acceptApproval(approval.ciphertext, 'first');
  assert.deepEqual(stores.get('second:account'), key);
  assert.equal(states.get('second').pending, undefined);
  await assert.rejects(second.acceptApproval(approval.ciphertext, 'first'), { code: 'invalid_approval' });
  await second.openMindKey(first.sealMindKey());
  assert.deepEqual(second.keyProvider(second.encryption.keyId), first.keyProvider(first.encryption.keyId));
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

test('account approval works across M1NDs without exposing their identities', async () => {
  const { machine, stores } = fixture(), account = randomBytes(32);
  stores.set('first:account', account);
  const first = machine('first', 'first-mind'), second = machine('second', 'second-mind');
  await first.unlock();
  const request = await second.createApprovalRequest('first');
  assert.equal(JSON.parse(request.ciphertext).mindId, undefined);
  const approval = await first.approve(request.ciphertext, { senderDeviceId: 'second', fingerprint: request.fingerprint });
  await second.acceptApproval(approval.ciphertext, 'first');
  assert.deepEqual(stores.get('second:account'), account);
  const otherAccount = machine('third', 'first-mind', { accountId: 'another-account' });
  await assert.rejects(otherAccount.inspectApproval(request.ciphertext, 'second'), { code: 'invalid_approval' });
});
