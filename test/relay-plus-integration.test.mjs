import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayPlusClient } from '../engine/relay-plus/client.mjs';

const baseUrl = process.env.RELAY_PLUS_TEST_URL;
const token = process.env.RELAY_PLUS_TEST_TOKEN;

test('local frozen Quantum account and first-device recovery contract', {
  skip: !baseUrl || !token ? 'Set RELAY_PLUS_TEST_URL and RELAY_PLUS_TEST_TOKEN for a disposable local Quantum.' : false,
}, async () => {
  const target = new URL(baseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Integration proof must never call a production service');
  const client = createRelayPlusClient({ baseUrl, getAccessToken: () => token });
  const me = await client.request('/v1/me');
  assert.equal(typeof me.accountId, 'string');
  assert.ok(Array.isArray(me.devices));
  const usage = await client.request('/v1/usage');
  assert.equal(typeof usage.usedBytes, 'number');
  assert.ok(Array.isArray(usage.objectCaps.hivem1nd));
  const keys = await client.request('/v1/keys');
  assert.ok(Array.isArray(keys.keys));
  const phrase = keys.keys.find(key => key.recipient === 'phrase');
  assert.ok(phrase, 'The disposable account must save its recovery phrase through the Cosmic site flow');
  assert.equal(phrase.algorithm, 'QNT_PBKDF2_SHA256_AES256GCM_V1');
  const wrapped = Buffer.from(phrase.wrapped, 'base64');
  assert.equal(wrapped.length, 77);
  assert.equal(wrapped[0], 1);
  // Only the account site owns this recipient; app credentials must preserve it.
  await assert.rejects(client.request('/v1/keys/phrase', {
    method: 'PUT', body: { algorithm: phrase.algorithm, wrapped: phrase.wrapped },
  }), { status: 403, code: 'app_forbidden' });
  assert.deepEqual((await client.request('/v1/keys')).keys.find(key => key.recipient === 'phrase'), phrase);
});
