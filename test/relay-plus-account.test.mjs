import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
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
  const ended = await account.status();
  assert.equal(ended.state, 'authentication-required');
  assert.equal(ended.reason, 'session-expired');
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
  assert.equal(separate.pages('en').acceptance, 'http://127.0.0.1:10002/');
  assert.equal(separate.pages('es').acceptance, 'http://127.0.0.1:10002/es/');
  assert.equal(separate.pages('en').recovery, 'http://127.0.0.1:10002/security/');
  assert.equal(separate.pages('es').recovery, 'http://127.0.0.1:10002/es/security/');
  for (const siteUrl of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?token=secret']) {
    assert.throws(() => createRelayPlusAccount({ ...common, siteUrl }), /invalid_account_site_url/);
  }
});

test('a computer that never signed in has no credentials under the real permission check', async t => {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.tmp/relay-unsigned-account-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const account = createRelayPlusAccount({ localDirectory: path.join(root, 'service'), computerId: 'qa-unsigned', deviceName: 'QA device',
    baseUrl: 'http://127.0.0.1:49999', fetch: async () => { throw new Error('No request expected'); } });
  assert.equal(await account.credentials(), null);
});

test('cancelling an in-flight PKCE exchange closes its callback and refuses late credentials', async t => {
  const root = await mkdtemp(path.resolve('.tmp/relay-cancelled-account-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const account = createRelayPlusAccount({ localDirectory: root, computerId: 'qa-cancelled', deviceName: 'QA device',
    baseUrl: 'http://127.0.0.1:49999', aclRunner: stubAclRunner(), fetch: async () => {
      entered(); await gate;
      return Response.json({ accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43), expiresIn: 900, account_id: 'qa-account', deviceId: 'qa-device' });
    } });
  const pending = await account.beginSignIn();
  t.after(() => { release(); pending.cancel(); });
  const authorization = new URL(pending.url), callback = new URL(authorization.searchParams.get('redirectUri'));
  callback.searchParams.set('code', 'c'.repeat(43)); callback.searchParams.set('state', authorization.searchParams.get('state'));
  const receiving = fetch(callback).catch(() => null);
  await started;
  pending.cancel();
  await assert.rejects(pending.complete, { code: 'sign_in_cancelled' });
  release();
  await receiving;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(await account.credentials(), null);
  const probe = http.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(Number(callback.port), '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
});

for (const mode of ['access response', 'refresh response']) {
  test(`a late revoked ${mode} from the previous PKCE session cannot stop the new session`, { timeout: 10_000 }, async t => {
    const temporaryRoot = path.resolve('.tmp');
    await mkdir(temporaryRoot, { recursive: true });
    const root = await mkdtemp(path.join(temporaryRoot, 'relay-relogin-'));
    let grant = 0, gateEnabled = false, release, entered, stale;
    const gate = new Promise(resolve => { release = resolve; });
    const arrival = new Promise(resolve => { entered = resolve; });
    const flows = [];
    t.after(async () => {
      release();
      for (const flow of flows) flow.cancel();
      await stale;
      const relative = path.relative(temporaryRoot, root);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The fixture cleanup escaped its temporary root.');
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    });
    const account = createRelayPlusAccount({ localDirectory: root, computerId: 'qa-relogin', deviceName: 'QA device',
      baseUrl: 'http://127.0.0.1:49123', aclRunner: stubAclRunner(), fetch: async (url, options) => {
        if (url.pathname === '/v1/oauth/token') {
          const body = JSON.parse(options.body);
          if (body.grantType === 'refresh_token') {
            entered(); await gate;
            return Response.json({ error: { code: 'invalid_grant', reason: 'device_revoked' } }, { status: 400 });
          }
          grant += 1;
          return Response.json({ accessToken: (grant === 1 ? 'a' : 'b').repeat(43), refreshToken: 'r'.repeat(43),
            expiresIn: 900, deviceId: 'qa-device', account_id: 'qa-account' });
        }
        if (url.pathname === '/v1/me') {
          if (gateEnabled && options.headers.get('Authorization') === `Bearer ${'a'.repeat(43)}`) {
            if (mode === 'access response') {
              entered(); await gate;
              return Response.json({ error: { code: 'unauthorized', reason: 'device_revoked' } }, { status: 401 });
            }
            return Response.json({ error: { code: 'unauthorized' } }, { status: 401 });
          }
          return Response.json({ accountId: 'qa-account', plans: [], devices: [] });
        }
        if (url.pathname === '/v1/bootstrap') return Response.json({ capabilities: { relayPlus: false } });
        if (url.pathname === '/v1/usage') return Response.json({ usedBytes: 0, poolBytes: 1 });
        throw new Error('An unexpected synthetic API route was requested.');
      } });
    const signIn = async () => {
      const flow = await account.beginSignIn();
      flows.push(flow);
      const authorization = new URL(flow.url);
      const callback = new URL(authorization.searchParams.get('redirectUri'));
      callback.searchParams.set('code', 'c'.repeat(43));
      callback.searchParams.set('state', authorization.searchParams.get('state'));
      assert.equal((await fetch(callback)).status, 200);
      await flow.complete;
    };
    await signIn();
    gateEnabled = true;
    stale = account.status().catch(error => ({ code: error.code }));
    await arrival;
    await signIn();
    assert.equal((await account.status()).state, 'read-only');
    const file = path.join(root, 'relay-plus', 'credentials.json');
    const before = createHash('sha256').update(await readFile(file)).digest('hex');
    release();
    await stale;
    assert.equal((await account.status()).state, 'read-only', 'A response belonging to the previous session must not revoke the new session.');
    assert.equal(createHash('sha256').update(await readFile(file)).digest('hex') === before, true, 'The new credentials must remain unchanged.');
  });
}

test('a new account opts into the setup handoff and stores only a K bound to this attempt', async t => {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.tmp/relay-account-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32);
  let flow, sealFor = 'account-one';
  const server = http.createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts));
    assert.equal(req.url, '/v1/oauth/token');
    assert.equal(body.keyHandoff, true);
    const secret = Buffer.from(new URLSearchParams(flow.hash.slice(1)).get('keyHandoffSecret'), 'base64url');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(['cosmic-app-key-handoff-v1', sealFor, 'hivem1nd', null, body.redirectUri,
      flow.searchParams.get('codeChallenge'), flow.searchParams.get('state')])));
    const wrapped = Buffer.concat([Buffer.from([1]), iv, cipher.update(key), cipher.final(), cipher.getAuthTag()]).toString('base64');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43), expiresIn: 900, deviceId: 'device-one', account_id: 'account-one',
      keyHandoff: { algorithm: 'QNT_APP_KEY_HANDOFF_AES256GCM_V1', wrapped } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const written = [];
  const accountKeyStore = { async writeAccountKey(accountId, value, options) { written.push({ accountId, key: Buffer.from(value), writer: options.writer }); } };
  const account = createRelayPlusAccount({ localDirectory: root, computerId: 'writer-one', deviceName: 'First machine',
    baseUrl: `http://127.0.0.1:${server.address().port}`, aclRunner: stubAclRunner(), accountKeyStore });
  for (const expected of [1, 1]) {
    const pending = await account.beginSignIn();
    t.after(pending.cancel);
    flow = new URL(pending.url);
    assert.equal(flow.searchParams.get('keyHandoff'), '1');
    assert.match(flow.hash, /^#keyHandoffSecret=[A-Za-z0-9_-]{43}$/);
    const callback = new URL(flow.searchParams.get('redirectUri'));
    callback.searchParams.set('code', 'c'.repeat(43));
    callback.searchParams.set('state', flow.searchParams.get('state'));
    assert.equal((await fetch(callback)).status, 200);
    await pending.complete;
    assert.equal(written.length, expected, 'a handoff sealed for another account is ignored and sign-in still completes');
    sealFor = 'account-two';
  }
  assert.deepEqual(written[0], { accountId: 'account-one', key, writer: 'hivem1nd' });
  const saved = JSON.parse(await readFile(path.join(root, 'relay-plus/credentials.json'), 'utf8'));
  assert.equal(Object.hasOwn(saved, 'keyHandoff'), false);
});
