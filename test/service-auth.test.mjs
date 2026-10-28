import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { connect, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { exchange, openHome } from '../engine/service/home.mjs';
import { composeCore, startService, stopService, writeBeat } from '../engine/service/service.mjs';
import { CoreError, canonicalJson, hashText } from '../engine/service/identity.mjs';
import { revisionOf } from '../engine/service/store.mjs';
import { createNativeAdapter, enqueueStart } from '../engine/service/adapters.mjs';
import { requestApproval } from '../engine/service/approvals.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { legacyTreeInventory } from '../engine/legacy-copy.mjs';
import { authorize, checkHost, checkLimits, checkOrigin, checkPeer, createAclRunner, createCredentialStore, createSecuritySink, protectBootstrapFiles, protectLocalFile, safeError, SECURITY_ALERT_THRESHOLD, SECURITY_FAILURE_LIMIT, SECURITY_FAILURE_WINDOW_MS, stubAclRunner } from '../engine/service/security.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const PHONE_FORBIDDEN = ['unit.create', 'chat.manage', 'layout.write', 'settings.write', 'home.manage', 'grant.revoke', 'session.start', 'session.stop', 'task.undo', 'editor.write', 'comment.write', 'asset.write', 'proposal.answer', 'watch', 'viewer.write'];
const LOOPBACK = { kind: 'loopback', address: '127.0.0.1', port: 8765 };

test('phone standing and push answers fail before receipt creation or replay, with no grant or notice changes', async t => {
  const fixture = await makeCoreFixture();
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups.toReversed()) await cleanup(); await dispose(fixture); });
  const unitId = 'project:shop:executor-shop', sessionId = randomUUID();
  const stateFile = path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `unit: executor-shop\nunit-id: ${unitId}\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: {"client":"codex","model":"strong","effort":"high","mode":null}\n\nReady.\n`);
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: ['project:shop'], schedule() {}, principal: { audience: 'agent', unitId, sessionId } };
  const credentials = createCredentialStore({ now: context.now });
  const phone = credentials.issue({ audience: 'phone', unitId: 'root:master' }).token;
  const http = await createHttpServer({ ...context, credentials });
  cleanups.push(() => http.close());
  for (const [action, pattern, decision] of [
    ['process.run', { command: 'npm run build', cwd: 'project:shop' }, 'approve-always'],
    ['git.push', { repository: 'project:shop', args: ['origin', 'main'] }, 'approve'],
    ['process.run', { command: 'git -C "C:\\work" push origin main', cwd: 'project:shop' }, 'deny'],
  ]) {
    const ask = await requestApproval(context, { action, pattern, display: 'Build', alwaysAllowed: true });
    const route = `/approvals/${ask.approval.id}/answer`, body = { decision, expectedRevision: ask.approval.revision };
    const approvalDirectory = path.join(fixture.paths.mind, 'user', 'relay', 'approvals', ask.approval.id);
    const notices = path.join(fixture.paths.mind, 'user', 'relay', 'chats');
    const before = await legacyTreeInventory(approvalDirectory), beforeNotices = await legacyTreeInventory(notices), beforeState = await readFile(stateFile);
    const denied = await requestJson(http.port, 'POST', `/api/v1${route}`, { token: phone, body });
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, 'phone_read_only');
    assert.deepEqual(denied.json.error.details, decision === 'approve-always' ? {} : { desktopOnly: true });
    const key = randomUUID(), receiptRoot = path.join(fixture.paths.localDirectory, 'receipts', hashText(phone));
    await mkdir(receiptRoot, { recursive: true });
    const file = path.join(receiptRoot, `${key}.json`);
    const receipt = { principalHash: hashText(phone), key, method: 'POST', path: route, bodyHash: hashText(canonicalJson(body)), requestId: randomUUID(), status: 200, response: { approval: { state: 'approved' } }, createdAt: new Date(fixture.clock.now).toISOString(), expiresAt: new Date(fixture.clock.now + 60000).toISOString() };
    await writeFile(file, JSON.stringify(receipt));
    const replay = await requestJson(http.port, 'POST', `/api/v1${route}`, { token: phone, body, headers: { 'idempotency-key': key } });
    assert.equal(replay.status, 403);
    assert.equal(replay.json.error.code, 'phone_read_only');
    assert.deepEqual(await legacyTreeInventory(approvalDirectory), before);
    assert.deepEqual(await legacyTreeInventory(notices), beforeNotices);
    assert.deepEqual(await readFile(stateFile), beforeState);
    assert.equal(JSON.stringify(JSON.parse(await readFile(file))) === JSON.stringify(receipt), true);
  }
  for (const [action, pattern] of [
    ['process.run', { command: 'npm run build', cwd: 'project:shop' }],
    ['git.commit', { repository: 'project:shop', args: ['-m', 'Reviewed task'] }],
  ]) {
    const ask = await requestApproval(context, { action, pattern, display: 'git push', alwaysAllowed: false });
    const answered = await requestJson(http.port, 'POST', `/api/v1/approvals/${ask.approval.id}/answer`, { token: phone, body: { decision: 'approve', expectedRevision: ask.approval.revision }, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(answered.status, 200);
    assert.equal(answered.json.data.approval.desktopOnly, false);
    assert.equal(answered.json.data.approval.grantId, null);
  }
});

test('a phone can approve or deny session.open over HTTP once without creating standing authority', async t => {
  const fixture = await makeCoreFixture(), cleanups = [];
  t.after(async () => { for (const cleanup of cleanups.toReversed()) await cleanup(); await dispose(fixture); });
  const unitId = 'project:shop:executor-shop';
  const stateFile = path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `unit: executor-shop\nunit-id: ${unitId}\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: {"client":"codex","model":"strong","effort":"high","mode":null}\n\nReady.\n`);
  const parentAdapter = createNativeAdapter('codex', { fixture: true, models: ['strong'], transcript: ['{"jsonrpc":"2.0","id":1,"result":{"thread":{"id":"parent-thread"}}}'] });
  const childAdapter = createNativeAdapter('cursor', { fixture: true, models: ['strong'], transcript: ['{"jsonrpc":"2.0","id":1,"result":{"sessionId":"child-session"}}'] });
  cleanups.push(async () => { await parentAdapter.close(); await childAdapter.close(); });
  let creates = 0;
  const create = childAdapter.create.bind(childAdapter);
  childAdapter.create = async input => { creates++; return create(input); };
  const paths = { ...fixture.paths, origin: path.join(fixture.root, 'origin') };
  await mkdir(paths.origin, { recursive: true });
  const context = { store: fixture.store, paths, now: () => fixture.clock.now, projects: [{ name: 'shop', localPath: fixture.root }],
    adapters: { codex: parentAdapter, cursor: childAdapter }, ownedPids: new Set(), beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() },
    schedule() {}, principal: { audience: 'agent', unitId } };
  const parent = await enqueueStart(context, { unitId, client: 'codex', runMode: 'chat', stateRevision: revisionOf(await readFile(stateFile)) });
  context.principal.sessionId = parent.result.sessionId;
  await writeBeat(context, 'running');
  const childId = 'project:shop:executor-child';
  await writeFile(path.join(path.dirname(stateFile), 'executor-child.md'), `unit: executor-child\nunit-id: ${childId}\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: {"client":"cursor","model":"strong","effort":"high","mode":null}\n\nReady.\n`);
  const credentials = createCredentialStore({ now: context.now });
  const phone = credentials.issue({ audience: 'phone', unitId: 'root:master' }).token;
  const http = await createHttpServer({ ...context, credentials }); cleanups.push(() => http.close());
  for (const decision of ['deny', 'approve']) {
    const ask = await requestApproval(context, { action: 'session.open', pattern: { client: 'cursor', machine: 'DESKTOP', unitId: childId, runMode: 'chat', taskId: null }, display: 'Open another CLI' });
    const options = { token: phone, body: { decision, expectedRevision: ask.approval.revision }, headers: { 'idempotency-key': randomUUID() } };
    const route = `/api/v1/approvals/${ask.approval.id}/answer`;
    const result = await requestJson(http.port, 'POST', route, options);
    assert.equal(result.status, 200);
    assert.equal(result.json.data.approval.grantId, null);
    assert.equal(result.json.data.approval.desktopOnly, false);
    assert.equal((await requestJson(http.port, 'POST', route, options)).status, 200);
    assert.equal(creates, decision === 'approve' ? 1 : 0);
  }
});

describe('service auth', { concurrency: false }, () => {
test('audiences, peers and limits fail closed without leaking secrets', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const store = createCredentialStore({ now: () => Date.parse('2026-10-10T12:00:00.000Z') });
  const desktop = store.verify(store.issue({ audience: 'desktop', expiresAt: '2026-10-10T13:00:00.000Z' }).token);
  const phone = store.verify(store.issue({ audience: 'phone', expiresAt: '2026-10-10T13:00:00.000Z' }).token);
  const agent = store.verify(store.issue({ audience: 'agent', unitId: 'project:shop:executor-shop', expiresAt: '2026-10-10T13:00:00.000Z', attached: false }).token);
  assert.equal(desktop.capabilities.includes('task.undo'), true);
  assert.equal(phone.capabilities.includes('task.undo'), false);
  assert.equal(authorize(desktop, 'task.undo').allowed, true);
  for (const operation of PHONE_FORBIDDEN) {
    await assert.rejects(async () => authorize(phone, operation), (error) => error.code === 'phone_read_only');
  }
  assert.equal(authorize(phone, 'task.accept', { reviewable: true }).allowed, true);
  await assert.rejects(async () => authorize(phone, 'task.accept', { reviewable: false }), (error) => error.status === 403);
  await assert.rejects(async () => authorize(agent, 'approval.answer'), (error) => error.status === 403);
  await assert.rejects(async () => authorize(agent, 'task.accept'), (error) => error.status === 403);
  await assert.rejects(async () => authorize(agent, 'mailbox.read', { unitId: 'root:master' }), (error) => error.status === 403);
  assert.equal(authorize(agent, 'task.status', { unitId: 'project:shop:executor-shop' }).allowed, true);
  await assert.rejects(async () => authorize(agent, 'editor.write'), (error) => error.status === 403);
  await assert.rejects(async () => authorize({ ...agent, attached: true }, 'editor.write'), (error) => error.status === 403);
  assert.equal(authorize(agent, 'editor.write', { attached: true }).allowed, true);
  await assert.rejects(async () => authorize(desktop, 'task.undo', { listener: 'lan' }), (error) => error.status === 403);
  assert.equal(checkPeer('127.0.0.1', LOOPBACK).ok, true);
  assert.equal(checkPeer('::ffff:127.0.0.1', LOOPBACK).ok, true);
  await assert.rejects(async () => checkPeer('127.0.0.2', LOOPBACK), (error) => error.status === 403 && error.code === 'loopback_only');
  await assert.rejects(async () => checkPeer('::1', LOOPBACK), (error) => error.status === 403 && error.code === 'loopback_only');
  assert.equal(checkHost('127.0.0.1:8765', LOOPBACK).ok, true);
  await assert.rejects(async () => checkHost('localhost:8765', LOOPBACK), (error) => error.status === 400 && error.code === 'invalid_host');
  await assert.rejects(async () => checkHost('127.0.0.1:8765, evil', LOOPBACK), (error) => error.status === 400 && error.code === 'invalid_host');
  assert.equal(checkOrigin(undefined, LOOPBACK, { write: false }).ok, true);
  await assert.rejects(async () => checkOrigin(undefined, LOOPBACK, { write: true }), (error) => error.status === 403 && error.code === 'invalid_origin');
  await assert.rejects(async () => checkOrigin('http://evil.example', LOOPBACK, { write: true }), (error) => error.status === 403 && error.code === 'invalid_origin');
  const lan = { kind: 'lan', address: '192.168.1.20', port: 80, netmask: '255.255.255.0' };
  assert.equal(checkPeer('192.168.1.40', lan).ok, true);
  await assert.rejects(async () => checkPeer('192.168.2.40', lan), (error) => error.status === 403 && error.code === 'peer_not_allowed');
  assert.equal(checkHost('192.168.1.20:80', lan).ok, true);
  await assert.rejects(async () => checkHost('1.2.3.4:80', lan), (error) => error.status === 400 && error.code === 'invalid_host');
  const bucket = {};
  for (let index = 0; index < 240; index += 1) checkLimits(bucket, { url: '/api/v1/units' }, 1_000);
  await assert.rejects(async () => checkLimits(bucket, { url: '/api/v1/units' }, 1_000), (error) => error.status === 429 && error.code === 'request_rate_limited' && typeof error.retryAt === 'string');
  checkLimits({}, { url: '/api/v1/units' }, 1_000);
  const streams = { streams: new Set(['a', 'b', 'c', 'd']) };
  await assert.rejects(async () => checkLimits(streams, { url: '/api/v1/events', stream: true }, 1_000), (error) => error.code === 'request_rate_limited');
  streams.streams.delete('d');
  assert.equal(checkLimits(streams, { url: '/api/v1/events', stream: true }, 1_000).ok, true);
  assert.equal(streams.requests?.length ?? 0, 0);
  await assert.rejects(async () => checkLimits({}, { url: `/${'a'.repeat(3000)}` }), (error) => error.status === 414 && error.code === 'uri_too_long');
  await assert.rejects(async () => checkLimits({}, { url: `/${'é'.repeat(1024)}` }), (error) => error.status === 414 && error.code === 'uri_too_long');
  assert.equal(checkLimits({}, { url: `/${'a'.repeat(2047)}` }).ok, true);
  const home = {};
  for (let index = 0; index < 5; index += 1) checkLimits(home, { homeFailure: true, peer: '192.168.1.40' }, 2_000);
  await assert.rejects(async () => checkLimits(home, { homeFailure: true, peer: '192.168.1.40' }, 2_000), (error) => error.code === 'auth_rate_limited');
  const grant = {};
  for (let index = 0; index < 30; index += 1) checkLimits(grant, { homeFailure: true, peer: `192.168.1.${index + 1}` }, 3_000);
  await assert.rejects(async () => checkLimits(grant, { homeFailure: true, peer: '10.0.0.8' }, 3_000), (error) => error.code === 'auth_rate_limited');
  const secret = 'super-secret-token';
  const failure = new Error(`C:\\secret\\${secret}\\stack`);
  failure.code = 'bootstrap_unavailable';
  failure.stack = `Error\n at ${secret}`;
  const body = safeError(failure, 'request-1');
  assert.equal(JSON.stringify(body).includes(secret), false);
  assert.equal(body.error.code, 'internal_error');
  assert.equal(body.error.message, 'The request failed.');
  assert.deepEqual(body.error.details, {});
  assert.equal(body.error.retryAt, null);
  assert.equal(body.error.requestId, 'request-1');
  const typed = safeError(new CoreError(429, 'request_rate_limited', 'Too many requests.', { remaining: 0 }, '2026-10-10T12:01:00.000Z'), 'request-2');
  assert.equal(typed.error.code, 'request_rate_limited');
  assert.equal(typed.error.details.remaining, 0);
  assert.equal(typed.error.retryAt, '2026-10-10T12:01:00.000Z');
  const limited = safeError(new CoreError(429, 'sync_limited', 'Sync is paused.', {
    machine: 'DESKTOP',
    path: '/home/test/private.txt',
    windows: 'C:\\Users\\test\\private.txt',
    limits: {
      messages: { used: 60, max: 60, windowSeconds: 60 },
      messageBytes: { max: 1000000 },
      syncBytes: { used: 1, max: 50000000, windowSeconds: 3600 },
      state: 'paused',
      retryAt: '2026-10-10T13:00:00.000Z',
    },
  }), 'request-3');
  assert.equal(JSON.stringify(limited).includes('/home/'), false);
  assert.equal(JSON.stringify(limited).includes('C:\\Users'), false);
  assert.equal(limited.error.details.path, undefined);
  assert.equal(limited.error.details.limits.messages.max, 60);
  assert.equal(limited.error.details.limits.syncBytes.max, 50000000);
  assert.equal(limited.error.details.limits.state, 'paused');
  const hidden = safeError(new CoreError(422, 'invalid_asset', 'see /etc/qa040-private.ini and /opt/qa040-config.ini', {
    path: '/etc/qa040-private.ini',
    config: '/opt/qa040-config.ini',
    limits: { messages: { max: 60 } },
  }), 'request-4');
  assert.equal(JSON.stringify(hidden).includes('/etc/'), false);
  assert.equal(JSON.stringify(hidden).includes('/opt/'), false);
  assert.equal(hidden.error.message, 'The request failed.');
  assert.equal(hidden.error.details.path, undefined);
  assert.equal(hidden.error.details.config, undefined);
  assert.equal(hidden.error.details.limits.messages.max, 60);
  const file = path.join(fixture.root, 'secret', 'bootstrap.json');
  await writeFile(file, '{}\n').catch(async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{}\n');
  });
  await assert.rejects(() => protectLocalFile(file, { fail: true }), (error) => error.code === 'bootstrap_unavailable' && !String(error.message).includes(secret));
  const runner = stubAclRunner();
  const protectedFile = await protectLocalFile(file, { aclRunner: runner });
  assert.equal(protectedFile.protected, true);
  if (process.platform === 'win32') assert.equal(runner.calls.filter((call) => call.op === 'protect').length, 1);
  store.revoke(desktop.token);
  await assert.rejects(async () => store.verify(desktop.token), (error) => error.status === 401);
});

test('a phone token is rejected for a desktop write on the real listener', async (t) => {
  const fixture = await makeCoreFixture();
  let core;
  t.after(async () => { await core?.http.close(); await dispose(fixture); });
  core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const phone = core.credentials.issue({ audience: 'phone', expiresAt: new Date(fixture.clock.now + 60_000).toISOString() });
  const status = await new Promise((resolve, reject) => {
    const payload = Buffer.from('{"language":"es"}');
    const req = httpRequest({
      host: '127.0.0.1',
      port: core.http.port,
      method: 'PATCH',
      path: '/api/v1/settings',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        authorization: `Bearer ${phone.token}`,
        'content-type': 'application/json',
        'content-length': String(payload.length),
        'idempotency-key': '6f1d7c2e-1b4a-4e3a-9c55-0a0b0c0d0e0f',
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(payload);
  });
  assert.equal(status, 403);
  const home = {
    now: () => fixture.clock.now,
    credentials: core.credentials,
    interfaces: () => [{ name: 'Ethernet', address: '10.0.0.8', netmask: '255.255.255.0', internal: false }],
    listen: async (address) => ({ address: address.address, netmask: address.netmask, port: 43123, close: async () => {} }),
    bus: { emit() {} },
  };
  const grant = await openHome(home, {});
  await assert.rejects(() => exchange(home, { key: `${grant.key}no` }, '10.0.0.8'), (error) => error.code === 'invalid_home_key');
  await closeQuiet(home);
});

test('local login requires the protected bootstrap secret and binds only the viewer fields', async (t) => {
  const fixture = await makeCoreFixture();
  let started;
  t.after(async () => { await stopService(started); await dispose(fixture); });
  const port = await new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const assigned = server.address().port;
      server.close(() => resolve(assigned));
    });
  });
  started = await startService({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    userKey: 'auth-user',
    guardPort: port,
  });
  const httpPort = started.http.port;
  const secret = started.bootstrap.secret;
  const bootFile = path.join(fixture.paths.localDirectory, 'bootstrap.json');
  const boot = JSON.parse(await readFile(bootFile, 'utf8'));
  const active = JSON.parse(await readFile(fixture.paths.activeFile, 'utf8'));
  const local = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'service.json'), 'utf8'));
  assert.deepEqual(Object.keys(boot).sort(), ['format', 'origin', 'secret', 'startedAt']);
  assert.equal(boot.format, 'hivem1nd-bootstrap-v1'); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  assert.equal(Buffer.from(boot.secret, 'base64url').length, 32);
  assert.equal(JSON.stringify(active).includes(secret), false);
  assert.equal(JSON.stringify(local).includes(secret), false);
  assert.equal(local.format, 'hivem1nd-service-local-v1'); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  assert.equal(active.mindPath, fixture.paths.mind);
  const missing = await requestJson(httpPort, 'POST', '/api/v1/auth/local', { body: {} });
  assert.equal(missing.status, 401);
  assert.equal(missing.json.error.code, 'invalid_bootstrap');
  const wrong = await requestJson(httpPort, 'POST', '/api/v1/auth/local', { token: randomBytes(32).toString('base64url'), body: {} });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error.code, 'invalid_bootstrap');
  const opened = await requestJson(httpPort, 'POST', '/api/v1/auth/local', {
    token: secret,
    body: { embedded: false, hostOrigin: null, look: 'high-contrast', language: 'es' },
  });
  assert.equal(opened.status, 201);
  assert.equal(opened.json.contract, 'hivem1nd-gui-v3'); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  assert.equal(opened.json.meta.sync, 'local');
  assert.equal(opened.json.token, undefined);
  assert.equal(typeof opened.json.data.token, 'string');
  assert.equal(opened.json.data.capabilities.length, 22);
  assert.equal(opened.json.data.expiresAt, null);
  const reused = await requestJson(httpPort, 'POST', '/api/v1/auth/local', { token: opened.json.data.token, body: {} });
  assert.equal(reused.status, 401);
  assert.equal(reused.json.error.code, 'invalid_bootstrap');
  const session = await requestJson(httpPort, 'GET', '/api/v1/units', { token: secret });
  assert.equal(session.status, 401);
  const viewer = await requestJson(httpPort, 'GET', '/api/v1/viewer', { token: opened.json.data.token });
  assert.equal(viewer.json.data.look, 'high-contrast');
  assert.equal(viewer.json.data.language, 'es');
  assert.equal(viewer.json.data.embedded, false);
  const extra = await requestJson(httpPort, 'POST', '/api/v1/auth/local', { token: secret, body: { unit: 'nope' } });
  assert.equal(extra.status, 400);
  assert.equal(extra.json.error.code, 'unknown_field');
  const host = await requestJson(httpPort, 'POST', '/api/v1/auth/local', { token: secret, body: { embedded: true, hostOrigin: 'file://local', look: null, language: null } });
  assert.equal(host.status, 422);
  assert.equal(host.json.error.code, 'invalid_host_origin');
  const doubled = await rawHttp(httpPort, `GET /api/v1/units HTTP/1.1\r\nHost: 127.0.0.1:${httpPort}\r\nHost: evil.example\r\nConnection: close\r\n\r\n`);
  assert.match(doubled, /^HTTP\/1\.1 400\b/);
  assert.match(doubled, /invalid_host/);
  const forwarded = await requestJson(httpPort, 'GET', '/api/v1/viewer', {
    token: opened.json.data.token,
    headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-for': '1.2.3.4' },
  });
  assert.equal(forwarded.status, 200);
  const localBody = { embedded: false, hostOrigin: null, look: null, language: null };
  const flooded = await requestJson(httpPort, 'POST', '/api/v1/auth/local', { token: secret, body: localBody });
  const spared = await requestJson(httpPort, 'POST', '/api/v1/auth/local', { token: secret, body: localBody });
  // The local desktop has a budget of 1200 reads a minute; other callers keep 240.
  for (let index = 0; index < 1200; index += 1) {
    const once = await requestJson(httpPort, 'GET', '/api/v1/viewer', { token: flooded.json.data.token });
    assert.equal(once.status, 200);
  }
  const limited = await requestJson(httpPort, 'GET', '/api/v1/viewer', { token: flooded.json.data.token });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error.code, 'request_rate_limited');
  assert.ok(Number(limited.headers['retry-after']) >= 1);
  const still = await requestJson(httpPort, 'GET', '/api/v1/viewer', { token: spared.json.data.token });
  assert.equal(still.status, 200);
  const page = await requestJson(httpPort, 'GET', '/');
  assert.notEqual(page.status, 429);
  await writeFile(bootFile, '{}\n');
  const closed = await requestJson(httpPort, 'POST', '/api/v1/auth/local', { token: secret, body: localBody });
  assert.equal(closed.status, 503);
  assert.equal(closed.json.error.code, 'bootstrap_unavailable');
  assert.equal(closed.json.token, undefined);
});

test('windows acl tools come from System32', async () => {
  const calls = [];
  const runner = createAclRunner({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    spawnSync: (command, args, options) => {
      calls.push({ command, args, shell: options.shell, windowsHide: options.windowsHide });
      if (String(command).endsWith(`${path.sep}whoami.exe`)) return { status: 0, stdout: '"machine\\user","S-1-5-21-1-2-3-1001"\r\n' };
      const saved = args[args.indexOf('/save') + 1];
      if (args.includes('/save') && saved) writeFileSync(saved, aclText);
      return { status: 0, stdout: '' };
    },
  });
  assert.equal(runner.userSid(), 'S-1-5-21-1-2-3-1001');
  assert.equal(calls[0].command, path.join('C:\\Windows', 'System32', 'whoami.exe'));
  const target = path.join(os.tmpdir(), `onem1nd-acl-${randomBytes(4).toString('hex')}`);
  await writeFile(target, 'acl');
  const user = 'S-1-5-21-1-2-3-1001';
  let aclText = `O:${user}G:DU\r\nD:P(A;;FA;;;SY)(A;;FA;;;${user})\r\n`;
  runner.protect(target);
  assert.equal(calls[1].args.some((part) => String(part).includes('S-1-5-32-544')), false);
  assert.equal(calls[1].args.some((part) => String(part).includes('S-1-5-18')), true);
  assert.equal(calls[1].args.some((part) => String(part).includes(user)), true);
  runner.check(target);
  aclText = `O:BAG:DU\r\nD:P(A;;FA;;;BA)(A;;FA;;;SY)(A;;FA;;;${user})\r\n`;
  assert.throws(() => runner.check(target), (error) => error.code === 'bootstrap_unavailable');
  const directory = path.join(os.tmpdir(), `onem1nd-acl-dir-${randomBytes(4).toString('hex')}`);
  const link = path.join(os.tmpdir(), `onem1nd-acl-link-${randomBytes(4).toString('hex')}`);
  await mkdir(directory);
  await symlink(directory, link, 'junction');
  assert.throws(() => runner.check(link), (error) => error.code === 'bootstrap_unavailable');
  await unlink(link);
  await rm(directory, { recursive: true });
  await unlink(target);
  assert.equal(calls[1].command, path.join('C:\\Windows', 'System32', 'icacls.exe'));
  assert.equal(calls.every((call) => call.shell === false && call.windowsHide === true), true);
  if (process.platform === 'win32') {
    assert.match(createAclRunner().userSid(), /^S-\d+-\d+(?:-\d+)+$/);
  }
});

test('security events keep a bounded trail without secrets', async (t) => {
  const fixture = await makeCoreFixture();
  const core = await composeCore({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    projects: [],
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await requestJson(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  assert.equal(local.status, 201);
  const token = local.json.data.token;
  const success = core.http.security.events.find((event) => event.type === 'auth.success');
  assert.equal(success.outcome, 'success');
  assert.equal(success.peer, '127.0.0.1');
  assert.equal(success.sessionHash.length, 16);
  assert.equal(JSON.stringify(core.http.security.events).includes(token), false);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const phone = core.credentials.issue({ audience: 'phone', sessionId, expiresAt: new Date(fixture.clock.now + 60_000).toISOString() });
  const deniedWrite = await requestJson(core.http.port, 'PATCH', '/api/v1/settings', {
    token: phone.token,
    body: { language: 'es' },
    headers: { 'idempotency-key': '6f1d7c2e-1b4a-4e3a-9c55-0a0b0c0d0e0f' },
  });
  assert.equal(deniedWrite.status, 403);
  const deniedEvent = core.http.security.events.find((event) => event.type === 'permission.denied');
  assert.equal(deniedEvent.actorHash.length, 16);
  assert.equal(deniedEvent.sessionHash.length, 16);
  assert.equal(JSON.stringify(deniedEvent).includes(phone.token), false);
  assert.equal(JSON.stringify(deniedEvent).includes(sessionId), false);
  for (let index = 0; index < core.http.security.alertThreshold; index += 1) {
    const denied = await requestJson(core.http.port, 'GET', '/api/v1/units', { token: `forged-${index}` });
    assert.equal(denied.status, 401);
  }
  const alert = core.http.security.events.find((event) => event.type === 'security.alert');
  assert.equal(alert.outcome, 'alert');
  assert.equal(alert.threshold, core.http.security.alertThreshold);
  core.credentials.revoke(token);
  assert.equal(core.http.security.events.some((event) => event.type === 'credential.revoked'), true);
  const trail = await readFile(path.join(fixture.paths.localDirectory, 'security-events.jsonl'), 'utf8');
  assert.equal(trail.includes(token), false);
  assert.match(trail, /auth\.success/);
  assert.equal(core.http.security.retention, 200);
  const clock = { now: 0 };
  const sink = createSecuritySink({ now: () => clock.now });
  for (let index = 0; index < SECURITY_ALERT_THRESHOLD; index += 1) {
    sink.record({ type: 'auth.failure', peer: '10.0.0.9', outcome: 'failure' });
  }
  assert.equal(sink.events.filter((event) => event.type === 'security.alert').length, 1);
  clock.now += SECURITY_FAILURE_WINDOW_MS;
  for (let index = 0; index < SECURITY_ALERT_THRESHOLD - 1; index += 1) {
    sink.record({ type: 'auth.failure', peer: '10.0.0.9', outcome: 'failure' });
  }
  assert.equal(sink.events.filter((event) => event.type === 'security.alert').length, 1);
  sink.record({ type: 'auth.failure', peer: '10.0.0.9', outcome: 'failure' });
  assert.equal(sink.events.filter((event) => event.type === 'security.alert').length, 2);
  for (let index = 0; index < SECURITY_FAILURE_LIMIT + 10; index += 1) {
    sink.record({ type: 'auth.failure', peer: `10.1.0.${index}`, outcome: 'failure' });
  }
  assert.equal(sink.events.length <= sink.retention, true);
});

test('forged bearers share the peer limit and idle buckets expire', async (t) => {
  const fixture = await makeCoreFixture();
  const core = await composeCore({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    projects: [],
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await requestJson(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  assert.equal(local.status, 201);
  const token = local.json.data.token;
  fixture.clock.now += 60_000;
  for (let index = 0; index < 240; index += 1) {
    const denied = await requestJson(core.http.port, 'GET', '/api/v1/units', { token: `forged-${index}` });
    assert.equal(denied.status, 401);
    assert.equal(denied.json.error.code, 'invalid_session');
  }
  const limited = await requestJson(core.http.port, 'GET', '/api/v1/units');
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error.code, 'request_rate_limited');
  assert.ok(Number(limited.headers['retry-after']) >= 1);
  const valid = await requestJson(core.http.port, 'GET', '/api/v1/units', { token });
  assert.equal(valid.status, 200);
  fixture.clock.now += 60_000;
  const again = await requestJson(core.http.port, 'GET', '/api/v1/units', { token: 'forged-after-idle' });
  assert.equal(again.status, 401);
  assert.equal(again.json.error.code, 'invalid_session');
});
});

function requestJson(port, method, target, { token = null, body = undefined, headers = {} } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      method,
      path: target,
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const json = raw && String(res.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : null;
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

function rawHttp(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.end(payload));
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

async function closeQuiet(home) {
  const { closeHome } = await import('../engine/service/home.mjs');
  await closeHome(home);
}

test('ending a watch, logging out and opening the event stream refuse unknown fields', async (t) => {
  const fixture = await makeCoreFixture();
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: [] });
  t.after(async () => { await core.http.close(); await dispose(fixture); });
  clearInterval(core.runtime.beatTimer); core.runtime.beatTimer = null;
  const port = core.http.port;
  const signIn = async () => (await requestJson(port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } })).json.data.token;
  const viewer = await signIn();
  const watched = await requestJson(port, 'POST', '/api/v1/watch', { token: viewer, body: { unitId: 'root:master' }, headers: { 'idempotency-key': randomUUID() } });
  assert.equal(watched.status < 300, true, `watch opened with ${watched.status}`);
  const watchId = watched.json.data.id ?? watched.json.data.watchId;
  const extraEnd = await requestJson(port, 'DELETE', `/api/v1/watch/${watchId}`, { token: viewer, body: { qaUnknown: true }, headers: { 'idempotency-key': randomUUID() } });
  assert.equal(extraEnd.status, 400);
  assert.equal(extraEnd.json.error.code, 'unknown_field');
  assert.equal((await requestJson(port, 'DELETE', `/api/v1/watch/${watchId}`, { token: viewer, body: {}, headers: { 'idempotency-key': randomUUID() } })).status, 204);
  const stream = await requestJson(port, 'GET', '/api/v1/events?qaUnknown=1', { token: viewer });
  assert.equal(stream.status, 400);
  assert.equal(stream.json.error.code, 'invalid_query');
  const extraLogout = await requestJson(port, 'POST', '/api/v1/auth/logout', { token: viewer, body: { qaUnknown: true } });
  assert.equal(extraLogout.status, 400);
  assert.equal(extraLogout.json.error.code, 'unknown_field');
  assert.equal((await requestJson(port, 'POST', '/api/v1/auth/logout', { token: viewer, body: {} })).status, 204);
  assert.equal((await requestJson(port, 'POST', '/api/v1/auth/logout', { token: await signIn() })).status, 204, 'a logout without a body still works');
});

test('a private folder already limited to its owner is not protected again, and one that is not gets protected', { skip: process.platform !== 'win32' }, async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const directory = await mkdtemp(path.join(tmpdir(), 'onem1nd-acl-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'bootstrap.json');
  await writeFile(file, '{}\n');
  // Protecting a folder rewrites everything inside it, which outlasted the time limit on a large folder after a restart.
  const limited = stubAclRunner();
  await protectBootstrapFiles(directory, file, { aclRunner: limited });
  assert.deepEqual(limited.calls.filter((call) => call.op === 'protect').map((call) => call.target), [file]);
  const open = stubAclRunner();
  let first = true;
  const check = open.check;
  open.check = (target) => { if (first && target === directory) { first = false; throw new Error('inherits'); } return check(target); };
  await protectBootstrapFiles(directory, file, { aclRunner: open });
  assert.deepEqual(open.calls.filter((call) => call.op === 'protect').map((call) => call.target), [directory, file]);
  assert.ok(open.calls.some((call) => call.op === 'check' && call.target === directory), 'the folder is checked after it is protected');
});
