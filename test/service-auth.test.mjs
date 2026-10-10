import { writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exchange, openHome } from '../engine/service/home.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { authorize, checkHost, checkLimits, checkOrigin, checkPeer, createCredentialStore, protectLocalFile, safeError } from '../engine/service/security.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const PHONE_FORBIDDEN = ['unit.create', 'chat.manage', 'layout.write', 'settings.write', 'home.manage', 'grant.revoke', 'session.start', 'session.stop', 'task.undo', 'editor.write', 'comment.write', 'asset.write', 'proposal.answer', 'watch', 'viewer.write'];
const LOOPBACK = { kind: 'loopback', address: '127.0.0.1', port: 8765 };

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
  const attached = { ...agent, attached: true };
  assert.equal(authorize(attached, 'editor.write').allowed, true);
  await assert.rejects(async () => authorize(desktop, 'task.undo', { listener: 'lan' }), (error) => error.status === 403);
  assert.equal(checkPeer('127.0.0.1', LOOPBACK).ok, true);
  assert.equal(checkPeer('::ffff:127.0.0.1', LOOPBACK).ok, true);
  await assert.rejects(async () => checkPeer('127.0.0.2', LOOPBACK), (error) => error.status === 403);
  await assert.rejects(async () => checkPeer('::1', LOOPBACK), (error) => error.status === 403);
  assert.equal(checkHost('127.0.0.1:8765', LOOPBACK).ok, true);
  await assert.rejects(async () => checkHost('localhost:8765', LOOPBACK), (error) => error.status === 403);
  await assert.rejects(async () => checkHost('127.0.0.1:8765, evil', LOOPBACK), (error) => error.status === 403);
  assert.equal(checkOrigin(undefined, LOOPBACK, { write: false }).ok, true);
  await assert.rejects(async () => checkOrigin(undefined, LOOPBACK, { write: true }), (error) => error.status === 403);
  await assert.rejects(async () => checkOrigin('http://evil.example', LOOPBACK, { write: true }), (error) => error.status === 403);
  const lan = { kind: 'lan', address: '192.168.1.20', port: 80, netmask: '255.255.255.0' };
  assert.equal(checkPeer('192.168.1.40', lan).ok, true);
  await assert.rejects(async () => checkPeer('192.168.2.40', lan), (error) => error.status === 403);
  assert.equal(checkHost('192.168.1.20:80', lan).ok, true);
  await assert.rejects(async () => checkHost('1.2.3.4:80', lan), (error) => error.status === 403);
  const bucket = {};
  for (let index = 0; index < 240; index += 1) checkLimits(bucket, { url: '/api/v1/units' }, 1_000);
  await assert.rejects(async () => checkLimits(bucket, { url: '/api/v1/units' }, 1_000), (error) => error.status === 429);
  await assert.rejects(async () => checkLimits({}, { url: `/${'a'.repeat(3000)}` }), (error) => error.status === 414);
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
  assert.equal(body.error.requestId, 'request-1');
  const file = path.join(fixture.root, 'secret', 'bootstrap.json');
  await writeFile(file, '{}\n').catch(async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{}\n');
  });
  await assert.rejects(() => protectLocalFile(file, { fail: true }), (error) => error.code === 'bootstrap_unavailable' && !String(error.message).includes(secret));
  const protectedFile = await protectLocalFile(file, { handles: fixture.children });
  assert.equal(protectedFile.protected, true);
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

async function closeQuiet(home) {
  const { closeHome } = await import('../engine/service/home.mjs');
  await closeHome(home);
}
