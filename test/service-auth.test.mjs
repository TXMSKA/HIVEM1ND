import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { connect, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { exchange, openHome } from '../engine/service/home.mjs';
import { composeCore, startService, stopService } from '../engine/service/service.mjs';
import { CoreError } from '../engine/service/identity.mjs';
import { authorize, checkHost, checkLimits, checkOrigin, checkPeer, createAclRunner, createCredentialStore, protectLocalFile, safeError, stubAclRunner } from '../engine/service/security.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const PHONE_FORBIDDEN = ['unit.create', 'chat.manage', 'layout.write', 'settings.write', 'home.manage', 'grant.revoke', 'session.start', 'session.stop', 'task.undo', 'editor.write', 'comment.write', 'asset.write', 'proposal.answer', 'watch', 'viewer.write'];
const LOOPBACK = { kind: 'loopback', address: '127.0.0.1', port: 8765 };

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
  t.after(() => dispose(fixture));
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  t.after(() => core.http.close());
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
  t.after(() => dispose(fixture));
  const port = await new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const assigned = server.address().port;
      server.close(() => resolve(assigned));
    });
  });
  const started = await startService({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    userKey: 'auth-user',
    guardPort: port,
  });
  t.after(() => stopService(started));
  const httpPort = started.http.port;
  const secret = started.bootstrap.secret;
  const bootFile = path.join(fixture.paths.localDirectory, 'bootstrap.json');
  const boot = JSON.parse(await readFile(bootFile, 'utf8'));
  const active = JSON.parse(await readFile(fixture.paths.activeFile, 'utf8'));
  const local = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'service.json'), 'utf8'));
  assert.deepEqual(Object.keys(boot).sort(), ['format', 'origin', 'secret', 'startedAt']);
  assert.equal(boot.format, 'hivem1nd-bootstrap-v1');
  assert.equal(Buffer.from(boot.secret, 'base64url').length, 32);
  assert.equal(JSON.stringify(active).includes(secret), false);
  assert.equal(JSON.stringify(local).includes(secret), false);
  assert.equal(local.format, 'hivem1nd-service-local-v1');
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
  assert.equal(opened.json.contract, 'hivem1nd-gui-v3');
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
  for (let index = 0; index < 240; index += 1) {
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
  const target = path.join(os.tmpdir(), `hivem1nd-acl-${randomBytes(4).toString('hex')}`);
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
  const directory = path.join(os.tmpdir(), `hivem1nd-acl-dir-${randomBytes(4).toString('hex')}`);
  const link = path.join(os.tmpdir(), `hivem1nd-acl-link-${randomBytes(4).toString('hex')}`);
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
