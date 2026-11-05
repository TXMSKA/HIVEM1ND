import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createRelayPlusAccount } from '../engine/relay-plus/account.mjs';
import { createRelayPlusClient, createRelayPlusMessages } from '../engine/relay-plus/client.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';

test('loopback PKCE persists protected credentials, rotates once and revokes token chain', async t => {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.tmp/relay-account-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let now = 1000, rotations = 0, revoked = false, revokedDevice = null, flow;
  const server = http.createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = parts.length ? JSON.parse(Buffer.concat(parts)) : null;
    let result;
    if (req.url === '/v1/oauth/token') {
      if (body.grantType === 'authorization_code') {
        assert.equal(body.appId, 'hivem1nd');
        assert.equal(body.redirectUri, flow.searchParams.get('redirectUri'));
        assert.equal(createHash('sha256').update(body.codeVerifier).digest('base64url'), flow.searchParams.get('codeChallenge'));
      } else rotations++;
      result = { accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43), expiresIn: 900,
        deviceId: 'device-one', account_id: 'account-one' };
    } else if (req.url === '/v1/oauth/revoke' && req.method === 'POST') { revokedDevice = req.url; result = { success: true }; }
    else if (revoked) { res.writeHead(401); res.end(JSON.stringify({ error: { code: 'unauthorized' } })); return; }
    else if (req.url === '/v1/me') result = { accountId: 'account-one', plans: [], devices: [] };
    else if (req.url === '/v1/bootstrap') result = { capabilities: { relayPlus: false } };
    else if (req.url === '/v1/usage') result = { usedBytes: 1, poolBytes: 100 };
    else { res.writeHead(404); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const aclRunner = stubAclRunner();
  const account = createRelayPlusAccount({ localDirectory: root, computerId: 'writer-one', deviceName: 'First machine',
    baseUrl: `http://127.0.0.1:${server.address().port}`, now: () => now, aclRunner });
  assert.equal((await account.status()).state, 'signed-out');
  const pending = await account.beginSignIn();
  t.after(pending.cancel);
  flow = new URL(pending.url);
  assert.equal(flow.pathname, '/authorize/');
  assert.equal(flow.searchParams.get('computerId'), 'writer-one');
  const callback = new URL(flow.searchParams.get('redirectUri'));
  assert.equal((await fetch(callback)).status, 400);
  callback.searchParams.set('code', 'c'.repeat(43));
  callback.searchParams.set('state', 'forged');
  assert.equal((await fetch(callback)).status, 400);
  callback.searchParams.set('state', flow.searchParams.get('state'));
  assert.equal((await fetch(callback)).status, 200);
  assert.deepEqual(await pending.complete, { accountId: 'account-one', deviceId: 'device-one' });
  const saved = JSON.parse(await readFile(path.join(root, 'relay-plus/credentials.json'), 'utf8'));
  assert.equal(saved.refreshToken, 'r'.repeat(43));
  now += 900_000;
  const status = await account.status();
  assert.equal(rotations, 1);
  assert.equal(status.state, 'read-only');
  assert.equal(status.entitled, false);
  await account.signOut();
  assert.equal(revokedDevice, '/v1/oauth/revoke');
  assert.equal((await account.status()).state, 'signed-out');
  const again = await account.beginSignIn(); flow = new URL(again.url);
  const againCallback = new URL(flow.searchParams.get('redirectUri')); againCallback.searchParams.set('code', 'c'.repeat(43)); againCallback.searchParams.set('state', flow.searchParams.get('state'));
  await fetch(againCallback); await again.complete;
  revoked = true;
  assert.equal((await account.status()).state, 'device_revoked_or_session_expired');
  assert.equal((await account.signOut()).state, 'signed-out');
  assert.equal(await account.credentials(), null, 'an already revoked account can remove its local credentials');
});

test('messages preserve published, delivered, read and expired states and contract errors', async () => {
  const calls = [];
  const client = createRelayPlusClient({ baseUrl: 'http://127.0.0.1:5000', getAccessToken: async () => 'token',
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      if (url.pathname.endsWith('/blocked')) return Response.json({ error: { code: 'relayplus_required' } }, { status: 403, headers: { 'Retry-After': '3' } });
      if (url.pathname === '/v1/relay/outbox') return Response.json({ messages: [{ id: 'message', state: 'expired' }], after: null });
      return Response.json({ state: options.method === 'PUT' ? 'published' : url.pathname.endsWith('/read') ? 'read' : 'delivered' });
    } });
  const messages = createRelayPlusMessages(client);
  assert.equal((await messages.publish('other', Buffer.from('opaque'), 'message1234567890')).state, 'published');
  assert.equal(calls[0].headers.get('X-Content-SHA256'), createHash('sha256').update('opaque').digest('hex'));
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer token');
  assert.equal((await messages.delivered('message1234567890')).state, 'delivered');
  assert.equal((await messages.read('message1234567890')).state, 'read');
  assert.equal((await messages.outbox()).messages[0].state, 'expired');
  await assert.rejects(messages.publish('other', Buffer.alloc(0), 'blocked'), error => error.code === 'relayplus_required' && error.retryAfter === 3);
  assert.throws(() => createRelayPlusClient({ baseUrl: 'http://example.com' }), /invalid_quantum_url/);
  await assert.rejects(client.request('https://example.com/v1/me'), /invalid_quantum_path/);
});

test('authorization opens the Cosmic site separately from the Quantum API without requesting either', async t => {
  const failFetch = async () => { throw new Error('Authorization preparation must not access the network'); };
  const common = { localDirectory: path.resolve('.tmp/relay-url-only'), computerId: 'writer', deviceName: 'Machine', fetch: failFetch };
  const production = createRelayPlusAccount(common);
  const pending = await production.beginSignIn();
  t.after(pending.cancel);
  assert.equal(new URL(pending.url).origin, 'https://cosmic.txmska.com');
  assert.equal(new URL(pending.url).pathname, '/authorize/');
  const local = createRelayPlusAccount({ ...common, baseUrl: 'http://127.0.0.1:10001' });
  const localPending = await local.beginSignIn();
  t.after(localPending.cancel);
  assert.equal(new URL(localPending.url).origin, 'http://127.0.0.1:10001');
  const separate = createRelayPlusAccount({ ...common, baseUrl: 'http://127.0.0.1:10001', siteUrl: 'http://127.0.0.1:10002' });
  const separatePending = await separate.beginSignIn();
  t.after(separatePending.cancel);
  assert.equal(new URL(separatePending.url).origin, 'http://127.0.0.1:10002');
  for (const siteUrl of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?token=secret']) {
    assert.throws(() => createRelayPlusAccount({ ...common, siteUrl }), /invalid_account_site_url/);
  }
});
