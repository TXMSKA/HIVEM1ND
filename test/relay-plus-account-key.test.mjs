import assert from 'node:assert/strict';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeCanonicalBase64, HANDOFF_ALGORITHM, openHandoffEnvelope, openPasswordEnvelope, PASSWORD_ALGORITHM } from '../engine/relay-plus/account-key.mjs';

const vectors = JSON.parse(await readFile(new URL('./fixtures/cosmic-keys-vectors.json', import.meta.url), 'utf8'));
const vector = vectors.password;
const accountId = vector.accountId;
const sealed = { algorithm: vector.algorithm, wrapped: vector.wrapped };

// Independent test-only sealer: it follows docs/keys.md and shares no code with the opener.
function seal(password, key, id = accountId, parts = {}) {
  const salt = parts.salt ?? randomBytes(16);
  const iv = parts.iv ?? randomBytes(12);
  const derived = pbkdf2Sync(Buffer.from(password.normalize('NFC')), salt, 600000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', derived, iv);
  cipher.setAAD(Buffer.from(JSON.stringify([PASSWORD_ALGORITHM, id, 'password', 1, 600000])));
  const body = Buffer.concat([cipher.update(key), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(5);
  head[0] = 1;
  head.writeUInt32BE(600000, 1);
  return { algorithm: PASSWORD_ALGORITHM, wrapped: Buffer.concat([head, salt, iv, body]).toString('base64') };
}
function counting() {
  const calls = [];
  return { calls, derive: (password, salt) => { calls.push({ password: Buffer.from(password), salt: Buffer.from(salt) }); return Buffer.alloc(32, 7); } };
}
function mutate(index, mask = 1) {
  const bytes = Buffer.from(vector.wrapped, 'base64');
  bytes[index] ^= mask;
  return { ...sealed, wrapped: bytes.toString('base64') };
}

test('the frozen vector is the documented layout and opens to its K', async () => {
  const bytes = Buffer.from(vector.wrapped, 'base64');
  assert.equal(bytes.length, 81);
  assert.equal(bytes.length, vector.wrappedLength);
  assert.equal(bytes[0], 1);
  assert.equal(bytes.subarray(1, 5).toString('hex'), '000927c0');
  assert.equal(bytes.subarray(5, 21).toString('hex'), vector.saltHex);
  assert.equal(bytes.subarray(21, 33).toString('hex'), vector.ivHex);
  assert.equal(vector.additionalData, JSON.stringify([PASSWORD_ALGORITHM, accountId, 'password', 1, 600000]));
  assert.deepEqual(await openPasswordEnvelope(sealed, vector.password, accountId), Buffer.from(vector.keyHex, 'hex'));
  // The independent sealer reproduces the vector byte for byte, so the opener is not checked against itself.
  const rebuilt = seal(vector.password, Buffer.from(vector.keyHex, 'hex'), accountId, {
    salt: Buffer.from(vector.saltHex, 'hex'), iv: Buffer.from(vector.ivHex, 'hex') });
  assert.equal(rebuilt.wrapped, vector.wrapped);
});

test('a wrong password, a wrong account and every tampered region fail authentication', async () => {
  await assert.rejects(openPasswordEnvelope(sealed, 'Correct horse battery staple', accountId), { code: 'key_authentication_failed' });
  await assert.rejects(openPasswordEnvelope(sealed, `${vector.password} `, accountId), { code: 'key_authentication_failed' });
  await assert.rejects(openPasswordEnvelope(sealed, vector.password, '00000000-0000-4000-8000-000000000002'), { code: 'key_authentication_failed' });
  await assert.rejects(openPasswordEnvelope(sealed, vector.password, ''), { code: 'key_authentication_failed' });
  for (const [name, index] of [['salt', 5], ['iv', 21], ['ciphertext', 33], ['tag', 80]]) {
    await assert.rejects(openPasswordEnvelope(mutate(index), vector.password, accountId), { code: 'key_authentication_failed' }, name);
  }
});

test('malformed or unsupported envelopes are refused before PBKDF2 runs', async () => {
  const spy = counting();
  const bytes = Buffer.from(vector.wrapped, 'base64');
  const refuse = async (envelope, code) => assert.rejects(openPasswordEnvelope(envelope, vector.password, accountId, { derive: spy.derive }), { code });
  await refuse({ ...sealed, algorithm: 'QNT_PBKDF2_SHA256_AES256GCM_V1' }, 'unsupported_key_format');
  await refuse({ ...sealed, algorithm: undefined }, 'unsupported_key_format');
  await refuse(null, 'unsupported_key_format');
  assert.equal(vector.wrapped.endsWith('='), false, 'an 81 byte envelope needs no padding');
  await refuse({ ...sealed, wrapped: vector.wrapped.slice(0, -1) }, 'invalid_key_envelope');
  await refuse({ ...sealed, wrapped: `${bytes.subarray(0, 80).toString('base64').replace(/=+$/, '')}` }, 'invalid_key_envelope');
  await refuse({ ...sealed, wrapped: `${vector.wrapped}\n` }, 'invalid_key_envelope');
  await refuse({ ...sealed, wrapped: vector.wrapped.replace(/\+/g, '-').replace(/\//g, '_') === vector.wrapped ? `${vector.wrapped}!` : vector.wrapped.replace(/\+/g, '-').replace(/\//g, '_') }, 'invalid_key_envelope');
  await refuse({ ...sealed, wrapped: Buffer.concat([bytes, Buffer.from([0])]).toString('base64') }, 'invalid_key_envelope');
  await refuse({ ...sealed, wrapped: bytes.subarray(0, 80).toString('base64') }, 'invalid_key_envelope');
  await refuse({ ...sealed, wrapped: Buffer.alloc(4096, 1).toString('base64') }, 'invalid_key_envelope');
  await refuse({ ...sealed, wrapped: 42 }, 'invalid_key_envelope');
  for (const version of [0, 2, 255]) {
    const copy = Buffer.from(bytes);
    copy[0] = version;
    await refuse({ ...sealed, wrapped: copy.toString('base64') }, 'unsupported_key_format');
  }
  for (const iterations of [0, 1, 599999, 600001, 1_000_000, 0xffffffff]) {
    const copy = Buffer.from(bytes);
    copy.writeUInt32BE(iterations, 1);
    await refuse({ ...sealed, wrapped: copy.toString('base64') }, 'unsupported_key_format');
  }
  assert.equal(spy.calls.length, 0, 'the work factor is never taken from an envelope');
});

test('the password is 1 to 128 NFC code points, NFC normalised, with spaces and case kept', async () => {
  const spy = counting();
  const open = password => openPasswordEnvelope(sealed, password, accountId, { derive: spy.derive });
  for (const bad of ['', 'x'.repeat(129), '\u{1F600}'.repeat(129), undefined, null, 42]) {
    await assert.rejects(open(bad), { code: 'key_authentication_failed' });
  }
  assert.equal(spy.calls.length, 0, 'out of range input never reaches PBKDF2');
  await assert.rejects(open('x'), { code: 'key_authentication_failed' });
  await assert.rejects(open('x'.repeat(128)), { code: 'key_authentication_failed' });
  await assert.rejects(open('\u{1F600}'.repeat(128)), { code: 'key_authentication_failed' });
  assert.equal(spy.calls.length, 3, '1 and 128 code points are accepted for an existing password');
  // 129 decomposed letters normalise to 64 code points and so are within bounds.
  await assert.rejects(open('é'.repeat(64)), { code: 'key_authentication_failed' });
  assert.equal(spy.calls.length, 4);
  assert.deepEqual(spy.calls[3].password, Buffer.from('é'.repeat(64)));
  await assert.rejects(open('  Mixed Case  '), { code: 'key_authentication_failed' });
  assert.deepEqual(spy.calls.at(-1).password, Buffer.from('  Mixed Case  '));
  assert.deepEqual(spy.calls.at(-1).salt, Buffer.from(vector.saltHex, 'hex'));
});

test('composed and decomposed forms open the same envelope, and spaces and case matter', async () => {
  const key = randomBytes(32);
  const composed = 'café au lait Über';
  const decomposed = 'café au lait Über';
  const envelope = seal(composed, key);
  assert.deepEqual(await openPasswordEnvelope(envelope, decomposed, accountId), key);
  assert.deepEqual(await openPasswordEnvelope(envelope, composed, accountId), key);
  await assert.rejects(openPasswordEnvelope(envelope, composed.toLowerCase(), accountId), { code: 'key_authentication_failed' });
  await assert.rejects(openPasswordEnvelope(envelope, ` ${composed}`, accountId), { code: 'key_authentication_failed' });
  const spaced = seal('  leading and trailing  ', key);
  assert.deepEqual(await openPasswordEnvelope(spaced, '  leading and trailing  ', accountId), key);
  await assert.rejects(openPasswordEnvelope(spaced, 'leading and trailing', accountId), { code: 'key_authentication_failed' });
});

test('K is returned as a private copy and secret buffers are cleared', async () => {
  const wrapping = Buffer.alloc(32, 9);
  let seenPassword = null;
  await assert.rejects(openPasswordEnvelope(sealed, vector.password, accountId, { derive: password => { seenPassword = password; return wrapping; } }), { code: 'key_authentication_failed' });
  assert.equal(wrapping.every(byte => byte === 0), true, 'the derived wrapping key is zeroed');
  assert.equal(seenPassword.every(byte => byte === 0), true, 'the password bytes are zeroed');
  const short = Buffer.alloc(31, 1);
  await assert.rejects(openPasswordEnvelope(sealed, vector.password, accountId, { derive: () => short }), { code: 'key_authentication_failed' });
  const first = await openPasswordEnvelope(sealed, vector.password, accountId);
  first.fill(0);
  assert.deepEqual(await openPasswordEnvelope(sealed, vector.password, accountId), Buffer.from(vector.keyHex, 'hex'));
});

test('canonical base64 rejects padding, alphabet and length mistakes', () => {
  const good = Buffer.from('abcdefgh').toString('base64');
  assert.ok(decodeCanonicalBase64(good, 8));
  assert.equal(decodeCanonicalBase64(good, 7), null);
  assert.equal(decodeCanonicalBase64(good.replace(/=+$/, ''), 8), null);
  assert.equal(decodeCanonicalBase64(`${good} `, 8), null);
  assert.equal(decodeCanonicalBase64('AAAA\nAAAA', 6), null);
  assert.equal(decodeCanonicalBase64('AAA=', 2).length, 2);
  assert.equal(decodeCanonicalBase64('AAB=', 2), null, 'non-zero trailing bits are not canonical');
  assert.equal(decodeCanonicalBase64(undefined), null);
  assert.equal(decodeCanonicalBase64(Buffer.alloc(3, 255).toString('base64').replace(/\//g, '_')), null);
});

test('the setup handoff vector opens to K and refuses another account or attempt', () => {
  const handoff = vectors.handoff;
  assert.equal(handoff.algorithm, HANDOFF_ALGORITHM);
  const context = { accountId: handoff.accountId, appId: handoff.appId, clientId: handoff.clientId, redirectUri: handoff.redirectUri,
    codeChallenge: handoff.codeChallenge, state: handoff.state };
  assert.equal(JSON.stringify(['cosmic-app-key-handoff-v1', ...Object.values(context)]), handoff.additionalData);
  const secret = Buffer.from(handoff.secretBase64Url, 'base64url');
  assert.equal(secret.toString('hex'), handoff.secretHex);
  assert.equal(openHandoffEnvelope({ algorithm: handoff.algorithm, wrapped: handoff.wrapped }, secret, context).toString('hex'), handoff.keyHex);
  for (const wrong of [handoff.wrongAccount, handoff.wrongTranscript]) {
    assert.throws(() => openHandoffEnvelope({ algorithm: handoff.algorithm, wrapped: wrong.wrapped }, secret, context), { code: 'key_authentication_failed' });
  }
  assert.throws(() => openHandoffEnvelope({ algorithm: handoff.algorithm, wrapped: handoff.wrapped }, secret, { ...context, accountId: handoff.wrongAccount.accountId }), { code: 'key_authentication_failed' });
  assert.throws(() => openHandoffEnvelope({ algorithm: handoff.algorithm, wrapped: handoff.wrapped }, secret, { ...context, state: handoff.wrongTranscript.state }), { code: 'key_authentication_failed' });
  assert.throws(() => openHandoffEnvelope({ algorithm: 'other', wrapped: handoff.wrapped }, secret, context), { code: 'unsupported_key_format' });
  assert.throws(() => openHandoffEnvelope({ algorithm: handoff.algorithm, wrapped: handoff.wrapped.slice(4) }, secret, context), { code: 'invalid_key_envelope' });
  assert.throws(() => openHandoffEnvelope({ algorithm: handoff.algorithm, wrapped: handoff.wrapped }, secret.subarray(1), context), { code: 'invalid_key_envelope' });
});
