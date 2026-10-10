import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachNative, dispatchLocal } from '../engine/service/bridge.mjs';
import { request as httpRequest } from 'node:http';
import { adoptWake, composeCore, guardPortFor, startService, stopService } from '../engine/service/service.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function optionsFor(t, port) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  let listeners = 0;
  const options = {
    store: fixture.store,
    paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now,
    userKey: 'lifecycle-user',
    guardPort: port,
    listener: async () => {
      listeners += 1;
      return { close: async () => {} };
    },
  };
  return { fixture, options, listeners: () => listeners };
}

test('one guard serves one mind and a second contender attaches without replacing it', async (t) => {
  assert.equal(guardPortFor('same-user'), guardPortFor('same-user'));
  assert.equal(guardPortFor('same-user') >= 49152 && guardPortFor('same-user') < 49152 + 16384, true);
  const port = await freePort();
  const { fixture, options, listeners } = await optionsFor(t, port);
  const [first, second] = await Promise.all([startService(options), startService(options)]);
  const owner = first.guard ? first : second;
  const attached = first.attached ? first : second;
  assert.equal(Boolean(owner.guard), true);
  assert.equal(attached.attached, true);
  assert.equal(attached.mutated, false);
  assert.equal(listeners(), 1);
  assert.equal(owner.children.length, 0);
  assert.equal(owner.adopted.workersSpawned, 0);
  const other = { ...options, paths: { ...options.paths, mind: path.join(fixture.root, 'other-mind') } };
  await assert.rejects(() => startService(other), (error) => error.code === 'service_mind_conflict');
  const lock = await readFile(path.join(fixture.paths.localDirectory, 'service.lock'), 'utf8');
  assert.equal(lock.includes(owner.nonce), true);
  const beat = JSON.parse(await readFile(path.join(fixture.root, 'origin', 'machines', fixture.machine, 'service.json'), 'utf8'));
  assert.equal(beat.state, 'running');
  const stopped = await stopService(owner);
  assert.equal(stopped.signaled.length, 0);
  const after = JSON.parse(await readFile(path.join(fixture.root, 'origin', 'machines', fixture.machine, 'service.json'), 'utf8'));
  assert.equal(after.state, 'stopped');
  const restarted = await startService(options);
  assert.equal(Boolean(restarted.guard), true);
  await stopService(restarted);
});

test('an unrelated occupant and a stale pid are not signaled or replaced blindly', async (t) => {
  const port = await freePort();
  const blocker = createServer((socket) => socket.end());
  await new Promise((resolve) => blocker.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => blocker.close(() => resolve())));
  const { options } = await optionsFor(t, port);
  await assert.rejects(() => startService({ ...options, attachTimeoutMs: 40 }), (error) => error.code === 'service_unavailable');
  await assert.equal(await readFile(path.join(options.paths.localDirectory, 'service.lock')).then(() => true, () => false), false);
  await new Promise((resolve) => blocker.close(() => resolve()));
  const started = await startService(options);
  const lockPath = path.join(options.paths.localDirectory, 'service.lock');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  await writeFile(lockPath, JSON.stringify({ ...lock, pid: 4 }));
  await stopService(started);
  await writeFile(lockPath, JSON.stringify({ nonce: 'old', pid: 4, digest: lock.digest }));
  await assert.rejects(() => startService(options), (error) => error.code === 'service_unavailable');
  const replaced = await startService({ ...options, allowStale: true });
  assert.equal(replaced.signaled.length, 0);
  await stopService(replaced);
});

test('wake adoption keeps the earlier deadline and the ambiguous delivery', async (t) => {
  const { fixture, options } = await optionsFor(t, await freePort());
  const directory = path.join(fixture.paths.mind, 'user', 'relay', 'wake', 'policies');
  await mkdir(directory, { recursive: true });
  const binding = { unit: 'executor-shop', unitId: 'project:shop:executor-shop', nativeSessionId: 'native-1', client: 'codex', machine: fixture.machine };
  await writeFile(path.join(directory, 'old.json'), JSON.stringify({
    binding, deadlineAt: '2026-10-10T11:00:00.000Z', maxHandoffs: 5, unlimited: false,
    deliveries: { one: { state: 'ambiguous' } },
  }));
  await writeFile(path.join(directory, 'new.json'), JSON.stringify({
    binding, deadlineAt: '2026-10-12T11:00:00.000Z', maxHandoffs: 20, unlimited: true,
    deliveries: { one: { state: 'not_submitted' }, two: { state: 'submitted' } },
  }));
  const adopted = await adoptWake(options, { nonce: 'owner' });
  assert.equal(adopted.policies.length, 1);
  assert.equal(adopted.policies[0].deadlineAt, '2026-10-10T11:00:00.000Z');
  assert.equal(adopted.policies[0].maxHandoffs, 5);
  assert.equal(adopted.policies[0].deliveries.one.state, 'ambiguous');
  assert.equal(adopted.policies[0].unlimited, false);
  assert.equal(adopted.workersSpawned, 0);
  const started = await startService(options);
  const accepted = await dispatchLocal(started.bridge, 'register', { unitId: binding.unitId });
  assert.equal(accepted.accepted, true);
  await assert.rejects(() => attachNative(started.bridge, { unitId: binding.unitId, nativeSessionId: 'native-1', handshake: false }), (error) => error.code === 'stop_unavailable');
  await stopService(started);
});

test('the HTTP event stream stays up beside the service guard', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  t.after(() => core.http.close());
  const local = await new Promise((resolve, reject) => {
    const payload = Buffer.from('{}');
    const req = httpRequest({
      host: '127.0.0.1',
      port: core.http.port,
      method: 'POST',
      path: '/api/v1/auth/local',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        'content-type': 'application/json',
        'content-length': String(payload.length),
        authorization: `Bearer ${core.bootstrap.secret}`,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.end(payload);
  });
  const opened = await new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: core.http.port,
      path: '/api/v1/events',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        authorization: `Bearer ${local.token}`,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk.toString('utf8');
        if (raw.includes('event: stream.ready')) {
          req.destroy();
          resolve(res.statusCode);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(opened, 200);
});

test('two GUI hosts share one service and keep separate viewers', async (t) => {
  const fixture = await makeCoreFixture();
  const { startGui, closeGuiHost } = await import('../gui/index.mjs');
  t.after(async () => {
    await closeGuiHost();
    await dispose(fixture);
  });
  const input = { mindPath: fixture.paths.mind, env: fixture.env, home: path.join(fixture.root, 'home'), platform: fixture.platform, machine: fixture.machine, now: () => fixture.clock.now };
  await assert.rejects(startGui({ ...input, mindPath: path.join(fixture.root, 'missing') }), { code: 'mind_not_configured' });
  await assert.rejects(startGui({ ...input, embedded: true, hostOrigin: 'file://local' }), { code: 'invalid_body' });
  const first = await startGui({ ...input, look: 'modern' });
  const second = await startGui({ ...input, embedded: true, hostOrigin: 'http://embed.example' });
  assert.equal(first.origin, second.origin);
  assert.notEqual(first.token, second.token);
  assert.equal(first.url.includes('token='), false);
  assert.equal(first.isDirty(), false);
  assert.equal(second.isDirty(), false);
  await first.setTheme('high-contrast');
  const seen = await call(first.origin, first.token);
  const other = await call(second.origin, second.token);
  assert.equal(seen.json.data.look, 'high-contrast');
  assert.equal(other.json.data.look ?? null, null);
  assert.equal(other.json.data.language ?? null, null);
  await second.stop();
  await second.stop();
  const still = await call(first.origin, first.token);
  assert.equal(still.status, 200);
  const otherMind = path.join(fixture.root, 'localappdata', 'Cosmic', 'other-mind');
  await mkdir(path.join(otherMind, 'user'), { recursive: true });
  await assert.rejects(startGui({ ...input, mindPath: otherMind }), { code: 'service_mind_conflict' });
});

function call(origin, token) {
  const url = new URL('/api/v1/viewer', origin);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: { host: url.host, origin: url.origin, authorization: `Bearer ${token}` },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end();
  });
}
