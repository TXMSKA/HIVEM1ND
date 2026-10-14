import './relay-local-state.mjs';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachNative, closeBridge, createNativeLaunch, dispatchLocal, openBridge } from '../engine/service/bridge.mjs';
import { request as httpRequest } from 'node:http';
import { createChat, postChat } from '../engine/service/chats.mjs';
import { canonicalJson, uuidV8 } from '../engine/service/identity.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { createRelay } from '../engine/relay/store.mjs';
import { createRelayWakeController } from '../engine/relay/wake.mjs';
import { createNativeAdapter } from '../engine/service/adapters.mjs';
import { adoptWake, composeCore, guardPortFor, restartService, startService, stopConfiguredService, stopService } from '../engine/service/service.mjs';
import { stageTransaction } from '../engine/sync/store.mjs';
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

test('running restart holds the user guard through replacement and revokes every old audience', async t => {
  const { fixture, options, listeners } = await optionsFor(t, await freePort());
  const owner = await startService(options);
  t.after(() => stopService(owner, { force: true }));
  const guard = owner.guard;
  const nonce = owner.nonce;
  const secret = owner.bootstrap.secret;
  const oldCredentials = owner.credentials;
  const tokens = ['desktop', 'phone', 'agent'].map(audience => oldCredentials.issue({ audience, unitId: 'root:master', viewerId: randomUUID() }).token);
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const close = owner.adopted.controller.close.bind(owner.adopted.controller);
  owner.adopted.controller.close = async () => { entered(); await gate; await close(); };
  const first = restartService(owner);
  const second = restartService(owner);
  assert.equal(first === second, true);
  t.after(() => release());
  await started;
  const contender = startService(options);
  assert.equal(guard.listening, true);
  for (const token of tokens) assert.throws(() => oldCredentials.verify(token), { code: 'invalid_session' });
  assert.equal(JSON.parse(await readFile(fixture.paths.lockFile, 'utf8')).nonce, nonce);
  release();
  await first;
  const attached = await contender;
  assert.equal(attached.attached, true);
  assert.equal(owner.guard === guard, true);
  assert.equal(owner.nonce === nonce, false);
  assert.equal(owner.bootstrap.secret === secret, false);
  assert.equal(listeners(), 2);
  assert.equal((await jsonCall(owner.http.port, 'GET', '/api/v1/viewer', { token: tokens[0] })).status, 401);
});

test('a stopped browser or embedded host recovers one owned service with isolated viewers and retained receipts', async t => {
  const fixture = await makeCoreFixture();
  const { startGui, closeGuiHost } = await import('../gui/index.mjs');
  const hosts = [];
  t.after(async () => { for (const host of hosts) await host.stop(); await closeGuiHost(); await dispose(fixture); });
  await writeFile(fixture.paths.configFile, JSON.stringify({ format: 'hivem1nd-service-config-v1', mindPath: fixture.paths.mind,
    machine: fixture.machine, origin: { kind: 'folder', path: path.join(fixture.root, 'origin') }, stagingPath: fixture.paths.staging, port: 0 }));
  const input = { mindPath: fixture.paths.mind, platform: fixture.platform, env: fixture.env, cosmicPath: fixture.paths.cosmic,
    machine: fixture.machine, aclRunner: stubAclRunner(), guardPort: await freePort(), userKey: fixture.root, confineRoot: fixture.root };
  const first = await startGui({ ...input, look: 'nebula', language: 'es' }); hosts.push(first);
  const second = await startGui({ ...input, embedded: true, hostOrigin: 'http://host.example', look: 'ntk' }); hosts.push(second);
  const originalToken = first.token;
  const otherToken = second.token;
  const bridge = (await jsonCall(new URL(first.origin).port, 'GET', '/api/v1/viewer/recovery', { token: first.token })).json.data;
  const headers = { Origin: first.origin, Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' };
  const shell = await shellHeaders(first.url);
  assert.equal(shell.csp.includes(`connect-src 'self' ${bridge.origin}`), true);
  assert.equal((await fetch(`${bridge.origin}/recover`, { method: 'POST', headers: { ...headers, Origin: 'http://foreign.example' }, body: '{}' })).status, 403);
  const operationKey = randomUUID();
  const body = { sendToAgent: false, expectedRevision: null };
  const created = await jsonCall(new URL(first.origin).port, 'PATCH', '/api/v1/settings', { token: first.token, body, key: operationKey });
  assert.equal(created.status, 200);
  await stopService(first.service, { force: true });
  assert.equal((await fetch(`${bridge.origin}/status`, { headers })).status, 200);
  assert.equal((await (await fetch(`${bridge.origin}/status`, { headers })).json()).state, 'stopped');
  const [left, right] = await Promise.all([fetch(`${bridge.origin}/recover`, { method: 'POST', headers, body: '{}' }), first.recover()]);
  assert.equal(left.status, 200);
  const recovered = await left.json();
  assert.equal(recovered.token === right.token, true);
  assert.equal(first.token === originalToken, false);
  assert.equal(first.service.guard.listening, true);
  assert.equal(first.origin, second.origin);
  const replay = await jsonCall(new URL(first.origin).port, 'PATCH', '/api/v1/settings', { token: first.token, body, key: operationKey });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.meta.replayed, true);
  assert.equal(replay.json.data.revision, created.json.data.revision);
  assert.equal((await call(first.origin, otherToken)).status, 401);
  await second.recover();
  assert.equal(first.service === second.service, true);
  assert.equal(first.viewerId === second.viewerId, false);
  assert.equal(first.token === second.token, false);
  assert.equal((await call(first.origin, first.token)).json.data.look, 'nebula');
  assert.equal((await call(second.origin, second.token)).json.data.look, 'ntk');
  const restart = await jsonCall(new URL(first.origin).port, 'POST', '/api/v1/settings/service/restart', {
    token: first.token, body: { machine: fixture.machine }, key: randomUUID(),
  });
  assert.equal(restart.status, 202);
  await first.recover();
  assert.equal((await call(first.origin, first.token)).status, 200);
  const retainedGuard = first.service.guard;
  await first.service.http.close();
  assert.equal((await first.serviceStatus()).state, 'stopped');
  await first.recover();
  assert.equal(first.service.guard === retainedGuard, true);
  assert.equal((await call(first.origin, first.token)).status, 200);
  await jsonCall(new URL(first.origin).port, 'POST', '/api/v1/auth/logout', { token: first.token, body: {} });
  await assert.rejects(first.recover(), { code: 'invalid_session' });
});

test('one active host prevents owned runtime shutdown', async t => {
  const { fixture, options } = await optionsFor(t, await freePort());
  const started = await startService({ ...options, retainHosts: true });
  t.after(async () => { if (!started.runtime.closed) await stopService(started, { force: true }); });
  const auth = () => jsonCall(started.http.port, 'POST', '/api/v1/auth/local', {
    token: started.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  const first = await auth();
  const second = await auth();
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal((await jsonCall(started.http.port, 'POST', '/api/v1/auth/logout', { token: second.json.data.token, body: {} })).status, 204);
  const lock = await readFile(fixture.paths.lockFile);
  const beat = await readFile(path.join(fixture.root, 'origin', 'machines', fixture.machine, 'service.json'));
  const pulse = started.runtime.pulse;
  const beatTimer = started.runtime.beatTimer;
  assert.deepEqual(await stopService(started), { stopped: false, inUse: true });
  await assert.rejects(stopConfiguredService({
    platform: fixture.platform, env: fixture.env, cosmicPath: fixture.paths.cosmic, mindPath: fixture.paths.mind,
    hostname: fixture.machine, userKey: options.userKey, guardPort: options.guardPort, aclRunner: fixture.store.aclRunner,
  }), { code: 'service_in_use' });
  assert.equal((await readFile(fixture.paths.lockFile)).equals(lock), true);
  assert.equal((await readFile(path.join(fixture.root, 'origin', 'machines', fixture.machine, 'service.json'))).equals(beat), true);
  assert.equal(started.runtime.pulse, pulse);
  assert.equal(started.runtime.beatTimer, beatTimer);
  assert.equal(started.runtime.closed, false);
  assert.equal((await jsonCall(started.http.port, 'GET', '/api/v1/viewer', { token: first.json.data.token })).status, 200);
  assert.equal((await jsonCall(started.http.port, 'POST', '/api/v1/auth/logout', { token: first.json.data.token, body: {} })).status, 204);
  const native = createNativeLaunch(started.bridge, { unitId: 'root:overseer', client: 'codex' });
  assert.deepEqual(await stopService(started), { stopped: false, inUse: true });
  native.close();
  const stopped = await stopService(started);
  assert.equal(stopped.stopped, true);
  assert.equal(started.runtime.closed, true);
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, 'origin', 'machines', fixture.machine, 'service.json'), 'utf8')).state, 'stopped');
});

test('owned shutdown closes host admission before awaiting controller cleanup', async t => {
  const { options } = await optionsFor(t, await freePort());
  const started = await startService({ ...options, retainHosts: true });
  const close = started.adopted.controller.close.bind(started.adopted.controller);
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  started.adopted.controller.close = async () => { entered(); await gate; await close(); };
  const stopping = stopService(started);
  t.after(async () => { release(); await stopping; });
  await ready;
  assert.equal(started.stopping, true);
  assert.throws(() => started.credentials.issue({ audience: 'desktop', unitId: 'root:master', viewerId: randomUUID() }), { code: 'service_unavailable' });
  assert.throws(() => started.credentials.issue({ audience: 'agent', unitId: 'root:overseer' }), { code: 'service_unavailable' });
  const attempted = await jsonCall(started.http.port, 'POST', '/api/v1/auth/local', {
    token: started.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  assert.equal(attempted.status, 503);
  assert.equal(started.http.viewers.size, 0);
  release();
  assert.equal((await stopping).stopped, true);
});

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
  assert.equal(owner.adopted.controller.started, true);
  assert.equal(owner.http.port === owner.port, false);
  assert.equal(owner.userKey, 'lifecycle-user');
  assert.equal(owner.adapters.adapters.claude.nativeSupport, false);
  const other = { ...options, paths: { ...options.paths, mind: path.join(fixture.root, 'other-mind') } };
  await assert.rejects(() => startService(other), (error) => error.code === 'service_mind_conflict');
  const lock = await readFile(fixture.paths.lockFile, 'utf8');
  assert.equal(lock.includes(owner.nonce), true);
  await assert.equal(await readFile(path.join(fixture.paths.localDirectory, 'service.lock')).then(() => true, () => false), false);
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
  await assert.equal(await readFile(options.paths.lockFile).then(() => true, () => false), false);
  await new Promise((resolve) => blocker.close(() => resolve()));
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  t.after(() => { if (child.exitCode == null && child.signalCode == null) child.kill(); });
  const started = await startService(options);
  const lock = JSON.parse(await readFile(options.paths.lockFile, 'utf8'));
  await writeFile(options.paths.lockFile, JSON.stringify({ ...lock, pid: child.pid }));
  await stopService(started);
  assert.equal(child.exitCode, null);
  const held = JSON.stringify({ nonce: 'old', pid: child.pid, digest: lock.digest });
  await writeFile(options.paths.lockFile, held);
  await assert.rejects(() => startService(options), (error) => error.code === 'service_unavailable');
  assert.equal(await readFile(options.paths.lockFile, 'utf8'), held);
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
  const replaced = await startService(options);
  assert.equal(replaced.signaled.length, 0);
  assert.equal(JSON.parse(await readFile(options.paths.lockFile, 'utf8')).pid, process.pid);
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
  assert.equal(adopted.controller.started, true);
  adopted.controller.close();
  const started = await startService(options);
  let replacedToken = null;
  try {
    assert.equal(started.bridge.endpoint.startsWith('\\\\.\\pipe\\hivem1nd-'), true);
    assert.equal(started.bridge.port, undefined);
    await assert.rejects(() => dispatchLocal(started.bridge, 'register', { unitId: binding.unitId }), (error) => error.code === 'INVALID_INPUT');
    await assert.rejects(() => dispatchLocal(started.bridge, 'exec', {}), { code: 'invalid_body' });
    await assert.rejects(() => attachNative(started.bridge, { unitId: binding.unitId, nativeSessionId: 'native-1', handshake: true }), (error) => error.code === 'stop_unavailable');
    started.bridge.adapters = {
      codex: { async confirm(proof) { return proof.nativeSessionId === 'native-1' && proof.machine === fixture.machine; } },
    };
    await assert.rejects(() => attachNative(started.bridge, { unitId: binding.unitId, client: 'codex', machine: fixture.machine, nativeSessionId: 'native-1' }), (error) => error.code === 'stop_unavailable');
    const firstId = await writeObservedSession(fixture, binding);
    await writeActiveWake(fixture, binding, 'wake-native-1', '2026-10-10T18:00:00.000Z');
    const attached = await attachNative(started.bridge, { unitId: binding.unitId, client: 'codex', machine: fixture.machine, nativeSessionId: 'native-1' });
    const first = started.credentials.verify(attached.token);
    assert.equal(first.audience, 'agent');
    assert.equal(first.sessionId, firstId);
    assert.notEqual(first.sessionId, 'native-1');
    assert.equal(first.wakeId, 'wake-native-1');
    assert.equal(first.expiresAt, '2026-10-10T18:00:00.000Z');
    const secondBinding = { ...binding, nativeSessionId: 'native-2' };
    const secondId = await writeObservedSession(fixture, secondBinding);
    await writeActiveWake(fixture, secondBinding, 'wake-native-2', '2026-10-12T11:00:00.000Z');
    started.bridge.adapters.codex.confirm = async (proof) => proof.nativeSessionId === 'native-2';
    const replaced = await attachNative(started.bridge, { unitId: binding.unitId, client: 'codex', machine: fixture.machine, nativeSessionId: 'native-2' });
    replacedToken = replaced.token;
    assert.notEqual(replaced.token, attached.token);
    assert.throws(() => started.credentials.verify(attached.token), { code: 'invalid_session' });
    const second = started.credentials.verify(replaced.token);
    assert.equal(second.sessionId, secondId);
    assert.equal(second.wakeId, 'wake-native-2');
    const held = fixture.clock.now;
    fixture.clock.now = Date.parse('2026-10-13T00:00:00.000Z');
    assert.throws(() => started.credentials.verify(replaced.token), { code: 'invalid_session' });
    fixture.clock.now = held;
    await mkdir(path.join(fixture.paths.mind, 'user', 'relay', 'session-status', secondId), { recursive: true });
    await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'session-status', secondId, 'stopped.json'), JSON.stringify({ sessionId: secondId, state: 'stopped' }));
    await assert.rejects(() => attachNative(started.bridge, { unitId: binding.unitId, client: 'codex', machine: fixture.machine, nativeSessionId: 'native-2' }), (error) => error.code === 'stop_unavailable');
  } finally {
    await stopService(started);
  }
  assert.throws(() => started.credentials.verify(replacedToken), { code: 'invalid_session' });
});

async function writeObservedSession(fixture, binding) {
  const sessionId = uuidV8(['session', binding.machine, binding.client, binding.nativeSessionId, binding.unitId]);
  const directory = path.join(fixture.paths.mind, 'user', 'relay', 'sessions');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${sessionId}.json`), JSON.stringify({
    sessionId, unitId: binding.unitId, client: binding.client, machine: binding.machine,
    nativeSessionId: binding.nativeSessionId, registeredAt: '2026-10-10T12:00:00.000Z',
  }));
  return sessionId;
}

async function writeActiveWake(fixture, binding, key, deadlineAt) {
  const directory = path.join(fixture.paths.mind, 'user', 'relay', 'wake', 'policies');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${key}.json`), JSON.stringify({ key, enabled: true, deadlineAt, binding }));
}

test('an eligible wake policy starts one worker and delivery needs a verified native session', async (t) => {
  const { fixture, options } = await optionsFor(t, await freePort());
  const relay = await createRelay({ mindPath: fixture.paths.mind, hostname: fixture.machine });
  const registration = await relay.register({ unit: 'master', nativeSessionId: 'native-live', client: 'codex' });
  const preparer = await createRelayWakeController({
    mindPath: fixture.paths.mind,
    hostname: fixture.machine,
    clock: { now: () => fixture.clock.now, sleep: () => Promise.resolve() },
    sink: async () => ({ status: 'not_submitted', reason: 'SINK_NOT_SUBMITTED' }),
  });
  await preparer.enable({
    unit: 'master',
    nativeSessionId: 'native-live',
    client: 'codex',
    machine: fixture.machine,
    windowHours: 4,
  });
  const policies = path.join(fixture.paths.mind, 'user', 'relay', 'wake', 'policies');
  await writeFile(path.join(policies, 'ineligible.json'), JSON.stringify({
    kind: 'relay-wake-policy',
    version: 1,
    generation: randomUUID(),
    enabled: false,
    deadlineAt: '2026-10-10T11:00:00.000Z',
    binding: { unit: 'other', nativeSessionId: 'native-old', client: 'codex', machine: fixture.machine },
  }));
  const adopted = await adoptWake(options, { nonce: 'owner' });
  assert.equal(adopted.policies.length, 2);
  assert.equal(adopted.workersSpawned, 1);
  await adopted.controller.close();
  const pid = 4242;
  options.ownedPids = new Set([pid]);
  let sendCalls = 0;
  let sendResult = { submitted: true };
  options.adapters = {
    codex: {
      async confirm(proof) {
        return proof.nativeSessionId === 'native-live' && proof.client === 'codex' && proof.machine === fixture.machine;
      },
      async send() {
        sendCalls += 1;
        if (sendResult instanceof Error) throw sendResult;
        return sendResult;
      },
    },
  };
  await mkdir(path.join(fixture.paths.localDirectory, 'session-starts'), { recursive: true });
  await writeFile(path.join(fixture.paths.localDirectory, 'session-starts', 'start.json'), JSON.stringify({
    sessionId: registration.sessionId,
    pid,
    requestId: 'wake-start',
  }));
  const started = await startService(options);
  try {
    assert.equal(started.adopted.workersSpawned, 1);
    const binding = {
      unit: 'master',
      unitId: registration.unitId,
      nativeSessionId: 'native-live',
      client: 'codex',
      machine: fixture.machine,
      sessionId: registration.sessionId,
    };
    const submitted = await dispatchLocal(started.bridge, 'wake', { ...binding, activity: 'idle', deliveryId: 'wake-live' });
    assert.equal(submitted.delivered, true);
    assert.equal(submitted.state, 'submitted');
    const urgent = await dispatchLocal(started.bridge, 'wake', { ...binding, activity: 'busy', urgent: true, deliveryId: 'wake-urgent' });
    assert.equal(urgent.state, 'submitted');
    const busy = await dispatchLocal(started.bridge, 'wake', { ...binding, activity: 'busy', deliveryId: 'wake-busy' });
    assert.equal(busy.delivered, false);
    assert.equal(busy.state, 'not_submitted');
    assert.equal(busy.deferred, true);
    const unknown = await dispatchLocal(started.bridge, 'wake', { ...binding, activity: 'unknown', deliveryId: 'wake-unknown' });
    assert.equal(unknown.state, 'not_submitted');
    assert.equal(unknown.deferred, undefined);
    const exhausted = await dispatchLocal(started.bridge, 'wake', { ...binding, activity: 'idle', quota: { exhausted: true }, deliveryId: 'wake-quota' });
    assert.equal(exhausted.state, 'not_submitted');
    const watched = await dispatchLocal(started.bridge, 'wake', { ...binding, activity: 'idle', watch: true, deliveryId: 'wake-watch' });
    assert.equal(watched.state, 'not_submitted');
    const foreign = await dispatchLocal(started.bridge, 'wake', { ...binding, nativeSessionId: 'native-other', activity: 'idle', deliveryId: 'wake-foreign' });
    assert.equal(foreign.state, 'not_submitted');
    assert.equal(foreign.reason, 'SINK_NOT_SUBMITTED');
    const activity = await dispatchLocal(started.bridge, 'activity', { ...binding, activity: 'idle' });
    assert.equal(activity.verified, true);
    assert.equal(activity.activity, 'idle');
    const missing = await dispatchLocal(started.bridge, 'activity', { ...binding, nativeSessionId: 'native-other' });
    assert.equal(missing.verified, false);
    assert.equal(missing.activity, 'unknown');
    assert.equal(sendCalls, 2);
    sendResult = { submitted: false };
    const rejected = await dispatchLocal(started.bridge, 'wake', { ...binding, activity: 'idle', deliveryId: 'wake-rejected' });
    assert.equal(rejected.delivered, false);
    assert.equal(rejected.state, 'not_submitted');
    assert.equal(sendCalls, 3);
    sendResult = new Error('native submit failed');
    const ambiguous = await dispatchLocal(started.bridge, 'wake', { ...binding, activity: 'idle', deliveryId: 'wake-ambiguous' });
    assert.equal(ambiguous.delivered, false);
    assert.equal(ambiguous.state, 'ambiguous');
    assert.equal(sendCalls, 4);
  } finally {
    await stopService(started);
  }
});

test('an enabled policy keeps its canonical unit and one native call is the submission', async (t) => {
  const { fixture, options } = await optionsFor(t, await freePort());
  const relay = await createRelay({ mindPath: fixture.paths.mind, hostname: fixture.machine });
  const registration = await relay.register({ unit: 'master', nativeSessionId: 'native-live', client: 'codex' });
  const preparer = await createRelayWakeController({
    mindPath: fixture.paths.mind,
    hostname: fixture.machine,
    clock: { now: () => fixture.clock.now, sleep: () => Promise.resolve() },
    sink: async () => ({ status: 'not_submitted', reason: 'SINK_NOT_SUBMITTED' }),
  });
  const enabled = await preparer.enable({
    unit: 'master',
    nativeSessionId: 'native-live',
    client: 'codex',
    machine: fixture.machine,
    windowHours: 4,
  });
  assert.equal(enabled.binding.unitId, registration.unitId);
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.calls = [];
  child.rejectSubmit = false;
  child.stdin = {
    write(text) {
      const message = JSON.parse(String(text));
      const emit = (body) => queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: message.id, ...body })}\n`));
      if (message.method === 'initialize') emit({ result: { userAgent: 'codex' } });
      else if (message.method === 'account/read') emit({ result: { account: { type: 'chatgpt' }, requiresOpenaiAuth: false } });
      else if (message.method === 'thread/start') emit({ result: { thread: { id: 'native-live' } } });
      else if (message.method === 'turn/start' || message.method === 'turn/steer') {
        child.calls.push(message);
        if (child.rejectSubmit) emit({ error: { code: 1, message: 'rejected' } });
        else emit({ result: { turn: { id: `turn-${child.calls.length}` } } });
      }
      return true;
    },
  };
  child.pid = 5150;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 0;
    child.emit('exit', 0);
  };
  const adapter = createNativeAdapter('codex', {
    command: path.join(fixture.root, 'codex.exe'),
    timeoutMs: 1000,
    describe: async () => ({ id: 'codex', connected: false, models: [], scopeEnforced: false }),
    spawn() { return child; },
  });
  const created = await adapter.create({ cwd: fixture.root, unitId: registration.unitId });
  assert.equal(created.nativeSessionId, 'native-live');
  assert.equal(await adapter.confirm({
    client: 'codex',
    nativeSessionId: 'native-live',
    unitId: registration.unitId,
    machine: fixture.machine,
  }), true);
  await mkdir(path.join(fixture.paths.localDirectory, 'session-starts'), { recursive: true });
  await writeFile(path.join(fixture.paths.localDirectory, 'session-starts', 'start.json'), JSON.stringify({
    sessionId: registration.sessionId,
    pid: child.pid,
    requestId: 'wake-rpc',
  }));
  options.adapters = { codex: adapter };
  options.ownedPids = new Set([child.pid]);
  const started = await startService(options);
  try {
    const proof = {
      unitId: registration.unitId,
      client: 'codex',
      machine: fixture.machine,
      nativeSessionId: 'native-live',
    };
    const attached = await attachNative(started.bridge, proof);
    assert.equal(attached.attached, true);
    assert.equal(attached.unitId, registration.unitId);
    const binding = {
      unit: 'master',
      unitId: registration.unitId,
      nativeSessionId: 'native-live',
      client: 'codex',
      machine: fixture.machine,
      sessionId: registration.sessionId,
      activity: 'idle',
      text: 'Read the unread message through Relay.',
    };
    const delivered = await dispatchLocal(started.bridge, 'wake', { ...binding, deliveryId: 'wake-rpc' });
    assert.equal(delivered.delivered, true);
    assert.equal(delivered.state, 'submitted');
    assert.equal(child.calls.length, 1);
    assert.equal(child.calls[0].method, 'turn/start');
    assert.equal(child.calls[0].params.threadId, 'native-live');
    assert.deepEqual(child.calls[0].params.input, [{ type: 'text', text: binding.text }]);
    child.rejectSubmit = true;
    const rejected = await dispatchLocal(started.bridge, 'wake', { ...binding, deliveryId: 'wake-rpc-rejected' });
    assert.equal(rejected.delivered, false);
    assert.equal(rejected.state, 'ambiguous');
    assert.equal(child.calls.length, 2);
  } finally {
    await stopService(started);
    await preparer.stopAll();
  }
});

test('a comment delivery is submitted once and a failure is not acceptance', async (t) => {
  let calls = 0;
  const bridge = await openBridge({
    operations: {
      async send(binding) {
        calls += 1;
        assert.equal(binding.deliveryId, 'comment-1');
        return { delivered: true, state: 'submitted', deliveryId: binding.deliveryId };
      },
      async wake() {
        throw Object.assign(new Error('The notice was not delivered.'), { code: 'delivery_failed' });
      },
    },
  });
  t.after(() => closeBridge(bridge));
  const first = await dispatchLocal(bridge, 'send', { deliveryId: 'comment-1', unitId: 'project:shop:executor-shop' });
  const second = await dispatchLocal(bridge, 'send', { deliveryId: 'comment-1', unitId: 'project:shop:executor-shop' });
  assert.equal(calls, 1);
  assert.equal(first.state, 'submitted');
  assert.deepEqual(second, first);
  assert.equal(first.accepted, undefined);
  const failed = await dispatchLocal(bridge, 'wake', { deliveryId: 'comment-2' });
  assert.equal(failed.delivered, false);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.code, 'delivery_failed');
  assert.equal(failed.accepted, undefined);
});

test('the HTTP event stream stays up beside the service guard', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  t.after(() => core.http.close());
  const local = await new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ embedded: false, hostOrigin: null, look: null, language: null }));
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
        authorization: `Bearer ${local.data.token}`,
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
  const hosts = [];
  t.after(async () => {
    for (const host of hosts) await host.stop();
    await closeGuiHost();
    await dispose(fixture);
  });
  const originPath = path.join(fixture.root, 'gui-origin');
  const assetDir = path.join(fixture.root, 'gui-assets');
  await mkdir(originPath, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, 'index.html'), '<!doctype html><title>HIVEM1ND</title>\n');
  await writeFile(fixture.paths.configFile, `${JSON.stringify({
    format: 'hivem1nd-service-config-v1',
    mindPath: fixture.paths.mind,
    machine: fixture.machine,
    origin: { kind: 'folder', path: originPath },
    stagingPath: fixture.paths.staging,
    port: 0,
  })}\n`);
  const input = { mindPath: fixture.paths.mind, env: fixture.env, home: path.join(fixture.root, 'home'), platform: fixture.platform, machine: fixture.machine, now: () => fixture.clock.now, aclRunner: stubAclRunner(), assetDir };
  await assert.rejects(startGui({ ...input, mindPath: path.join(fixture.root, 'missing') }), { code: 'mind_not_configured' });
  await assert.rejects(startGui({ ...input, embedded: true, hostOrigin: 'file://local' }), { code: 'invalid_body' });
  const first = await startGui({ ...input, look: 'modern' });
  hosts.push(first);
  const second = await startGui({ ...input, embedded: true, hostOrigin: 'http://embed.example' });
  hosts.push(second);
  assert.equal(first.origin, second.origin);
  assert.notEqual(first.token, second.token);
  assert.equal(first.url, `${first.origin}/gui/${first.viewerId}/#session=${first.token}`);
  assert.equal(new URL(first.url).search, '');
  assert.equal(first.isDirty(), false);
  assert.equal(second.isDirty(), false);
  await assert.rejects(() => first.setTheme('paper'), { code: 'invalid_body' });
  await first.setTheme('high-contrast');
  const seen = await call(first.origin, first.token);
  const other = await call(second.origin, second.token);
  assert.equal(seen.json.data.look, 'high-contrast');
  assert.equal(other.json.data.look ?? null, null);
  assert.equal(other.json.data.language ?? null, null);
  const ownShell = await shellHeaders(`${first.origin}/gui/${first.viewerId}/`);
  const embeddedShell = await shellHeaders(`${second.origin}/gui/${second.viewerId}/`);
  const rootShell = await shellHeaders(`${first.origin}/`);
  assert.match(ownShell.csp, /frame-ancestors 'none'/);
  assert.equal(ownShell.frame, 'DENY');
  assert.match(embeddedShell.csp, /frame-ancestors http:\/\/embed\.example/);
  assert.equal(embeddedShell.frame, undefined);
  assert.match(rootShell.csp, /frame-ancestors 'none'/);
  assert.equal(rootShell.frame, 'DENY');
  await patchDirty(first);
  await waitFor(() => (first.isDirty() ? 'dirty' : Promise.reject(new Error('clean'))), 'viewer dirty');
  assert.equal(second.isDirty(), false);
  await second.stop();
  await second.stop();
  const still = await call(first.origin, first.token);
  assert.equal(still.status, 200);
  const otherMind = path.join(fixture.root, 'localappdata', 'Cosmic', 'other-mind');
  await mkdir(path.join(otherMind, 'user'), { recursive: true });
  await assert.rejects(startGui({ ...input, mindPath: otherMind }), { code: 'service_mind_conflict' });
});

test('two machines on one origin replicate a change and one ledger stops a flood', async (t) => {
  const origin = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-origin-'));
  const left = await makeCoreFixture({ machine: 'ALPHA' });
  const right = await makeCoreFixture({ machine: 'BRAVO' });
  left.store.confineRoot = os.tmpdir();
  right.store.confineRoot = os.tmpdir();
  let leftService = null;
  let rightService = null;
  t.after(async () => {
    if (leftService) await stopService(leftService);
    if (rightService) await stopService(rightService);
    await dispose(left);
    await dispose(right);
    await rm(origin, { recursive: true, force: true });
  });
  leftService = await startService({ ...serviceOptions(left, origin), now: () => left.clock.now });
  rightService = await startService({ ...serviceOptions(right, origin), now: () => right.clock.now });
  assert.deepEqual(await packNames(origin), []);
  const changes = await stageTransaction(leftService.runtime.sync, [{
    target: { kind: 'mind', path: 'user/notes/hello.txt' },
    bytes: Buffer.from('hello\n'),
  }]);
  await leftService.runtime.pulse.changed(changes.map((change) => change.id));
  await leftService.runtime.pulse.flush();
  const copied = await waitFor(
    () => readFile(path.join(right.paths.mind, 'user', 'notes', 'hello.txt'), 'utf8'),
    'replica',
    rightService.runtime,
  );
  assert.equal(copied, 'hello\n');
  const mirrored = JSON.parse(await waitFor(
    () => readFile(path.join(right.paths.mind, 'machines', 'ALPHA', 'service.json'), 'utf8'),
    'mirrored beat',
    rightService.runtime,
  ));
  assert.equal(mirrored.machine, 'ALPHA');
  assert.equal(mirrored.state, 'running');
  const context = {
    store: left.store,
    paths: leftService.runtime.paths,
    now: () => left.clock.now,
    principal: { audience: 'desktop', unitId: 'root:master' },
    ledger: leftService.runtime.ledger,
    sync: leftService.runtime.sync,
    pulse: leftService.runtime.pulse,
  };
  const created = await createChat(context, { members: ['root:master'], title: 'Flood' });
  for (let index = 0; index < 60; index += 1) {
    await postChat(context, created.chat.id, { body: `note ${index}` });
  }
  await assert.rejects(postChat(context, created.chat.id, { body: 'overflow' }), { code: 'message_rate_limited' });
  const names = await readdir(path.join(left.paths.mind, 'user', 'relay', 'chats', created.chat.id));
  assert.equal(names.filter((name) => name !== 'chat.md').length, 60);
  await assert.rejects(postChat({ ...context, ledger: null }, created.chat.id, { body: 'uncomposed' }), { code: 'service_unavailable' });
});

test('service run reads the configured mind and holds the process until stop', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const { runCli } = await import('../cli/index.mjs');
  const output = { chunks: [], write(text) { this.chunks.push(text); } };
  const missing = await runCli(['service', 'run', '--mind-path', fixture.paths.mind, '--cosmic-path', fixture.paths.cosmic], {
    stdout: output,
    stderr: output,
    env: fixture.env,
    platform: 'win32',
    aclRunner: stubAclRunner(),
    confineRoot: fixture.root,
    guardPort: await freePort(),
    stop: Promise.resolve(),
    now: () => fixture.clock.now,
  });
  assert.equal(missing, 1);
  assert.match(output.chunks.join(''), /mind_not_configured/);
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  await writeFile(fixture.paths.configFile, `${JSON.stringify({
    format: 'hivem1nd-service-config-v1',
    mindPath: fixture.paths.mind,
    machine: fixture.machine,
    origin: { kind: 'folder', path: origin },
    stagingPath: fixture.paths.staging,
    port: 0,
  }, null, 2)}\n`);
  let release = () => {};
  const stop = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const port = await freePort();
  const running = runCli(['service', 'run', '--mind-path', fixture.paths.mind, '--cosmic-path', fixture.paths.cosmic], {
    stdout: output,
    stderr: output,
    env: fixture.env,
    platform: 'win32',
    aclRunner: stubAclRunner(),
    confineRoot: fixture.root,
    guardPort: port,
    stop,
    now: () => fixture.clock.now,
  });
  const bootstrap = JSON.parse(await waitFor(
    () => readFile(path.join(fixture.paths.localDirectory, 'bootstrap.json'), 'utf8'),
    'bootstrap',
  ));
  const lock = JSON.parse(await readFile(fixture.paths.lockFile, 'utf8'));
  const httpPort = Number(new URL(bootstrap.origin).port);
  assert.equal(httpPort === port, false);
  assert.equal(lock.pid, process.pid);
  const userKey = 'S-1-5-21-1-2-3-1001';
  const digest = createHash('sha256').update(canonicalJson({
    format: 'hivem1nd-service-descriptor-v1',
    mind: path.resolve(fixture.paths.mind),
    machine: fixture.machine,
    userKey,
    port,
    pid: process.pid,
  })).digest('hex');
  assert.equal(lock.digest, digest);
  assert.notEqual(digest, createHash('sha256').update(canonicalJson({
    format: 'hivem1nd-service-descriptor-v1',
    mind: path.resolve(fixture.paths.mind),
    machine: fixture.machine,
    userKey: 'user',
    port,
    pid: process.pid,
  })).digest('hex'));
  release();
  assert.equal(await running, 0);
  await assert.equal(await readFile(fixture.paths.lockFile).then(() => true, () => false), false);
  const beat = JSON.parse(await readFile(path.join(origin, 'machines', fixture.machine, 'service.json'), 'utf8'));
  assert.equal(beat.state, 'stopped');
});

function serviceOptions(fixture, origin) {
  return {
    paths: { ...fixture.paths, origin },
    store: fixture.store,
    now: () => Date.now(),
    guardPort: 0,
    userKey: fixture.machine,
  };
}

async function packNames(origin) {
  const names = [];
  const machines = path.join(origin, 'machines');
  for (const machine of await readdir(machines)) {
    try {
      for (const name of await readdir(path.join(machines, machine, 'packs'))) {
        if (name.endsWith('.pack')) names.push(`${machine}/${name}`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return names;
}

async function waitFor(read, label, runtime) {
  let last = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const detail = runtime?.lastError ? `${runtime.lastError.code ?? ''} ${runtime.lastError.message}` : '';
  throw new Error(`${label} timed out${detail ? `: ${detail}` : ''}${last ? ` (${last.code ?? last.message})` : ''}`);
}

function shellHeaders(target) {
  const url = new URL(target);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET', headers: { host: url.host } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, csp: res.headers['content-security-policy'], frame: res.headers['x-frame-options'] });
    });
    req.on('error', reject);
    req.end();
  });
}

function patchDirty(handle) {
  const url = new URL('/api/v1/viewer', handle.origin);
  const payload = Buffer.from(JSON.stringify({ dirty: true }));
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'PATCH',
      headers: {
        host: url.host,
        origin: url.origin,
        authorization: `Bearer ${handle.token}`,
        'content-type': 'application/json',
        'content-length': String(payload.length),
        'idempotency-key': randomUUID(),
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

test('a published heartbeat keeps installed clients on the machine list', async (t) => {
  const { fixture, options } = await optionsFor(t, await freePort());
  const started = await startService({
    ...options,
    clients: [
      { id: 'codex', enabled: true, installed: true, command: 'C:\\secret\\codex.exe' },
      { id: 'codex', enabled: false, installed: false },
      { id: 'cursor', enabled: false, installed: true },
      { id: 'claude', enabled: 'yes', installed: true },
      { id: 'opencode', enabled: true, installed: true },
    ],
  });
  try {
    const expected = [
      { id: 'codex', enabled: true, installed: true },
      { id: 'cursor', enabled: false, installed: true },
    ];
    const beat = JSON.parse(await readFile(path.join(fixture.root, 'origin', 'machines', fixture.machine, 'service.json'), 'utf8'));
    assert.deepEqual(beat.clients, expected);
    assert.equal(JSON.stringify(beat).includes('codex.exe'), false);
    const local = await jsonCall(started.http.port, 'POST', '/api/v1/auth/local', {
      token: started.bootstrap.secret,
      body: { embedded: false, hostOrigin: null, look: null, language: null },
    });
    assert.equal(local.status, 201);
    const machines = await jsonCall(started.http.port, 'GET', '/api/v1/machines', { token: local.json.data.token });
    assert.equal(machines.status, 200);
    const machine = machines.json.data.items.find((item) => item.id === fixture.machine);
    assert.deepEqual(machine.clients, expected);
  } finally {
    await stopService(started);
  }
});

test('a wake credential is rejected as soon as its policy stops', async (t) => {
  const { fixture, options } = await optionsFor(t, await freePort());
  const binding = { unit: 'master', unitId: 'root:master', nativeSessionId: 'native-live', client: 'codex', machine: fixture.machine };
  const sessionId = await writeObservedSession(fixture, binding);
  const generation = randomUUID();
  const policy = {
    key: 'wake-live-key',
    enabled: true,
    generation,
    deadlineAt: '2026-10-10T18:00:00.000Z',
    pausedReason: null,
    binding,
  };
  await writeWakePolicy(fixture, policy);
  options.adapters = { codex: { async confirm(proof) { return proof.nativeSessionId === 'native-live'; } } };
  const started = await startService(options);
  try {
    const proof = { unitId: binding.unitId, client: 'codex', machine: fixture.machine, nativeSessionId: 'native-live' };
    const attached = await attachNative(started.bridge, proof);
    assert.equal(started.credentials.verify(attached.token).wakeId, 'wake-live-key');
    await writeWakePolicy(fixture, { ...policy, enabled: false });
    assert.throws(() => started.credentials.verify(attached.token), { code: 'invalid_session' });
    await writeWakePolicy(fixture, policy);
    const paused = await attachNative(started.bridge, proof);
    await writeWakePolicy(fixture, { ...policy, pausedReason: 'handoff-budget-exhausted' });
    assert.throws(() => started.credentials.verify(paused.token), { code: 'invalid_session' });
    await writeWakePolicy(fixture, policy);
    const current = await attachNative(started.bridge, proof);
    await writeWakePolicy(fixture, { ...policy, generation: randomUUID() });
    assert.throws(() => started.credentials.verify(current.token), { code: 'invalid_session' });
    await writeWakePolicy(fixture, policy);
    const live = await attachNative(started.bridge, proof);
    assert.equal(started.credentials.verify(live.token).sessionId, sessionId);
    await mkdir(path.join(fixture.paths.mind, 'user', 'relay', 'session-status', sessionId), { recursive: true });
    await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'session-status', sessionId, 'stopped.json'), JSON.stringify({ sessionId, state: 'stopped' }));
    assert.throws(() => started.credentials.verify(live.token), { code: 'invalid_session' });
  } finally {
    await stopService(started);
  }
});

async function writeWakePolicy(fixture, policy) {
  const directory = path.join(fixture.paths.mind, 'user', 'relay', 'wake', 'policies');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${policy.key}.json`), JSON.stringify(policy));
}

function jsonCall(port, method, target, { token = null, body = undefined, key = null } = {}) {
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
        ...(key ? { 'idempotency-key': key } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : null });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

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
