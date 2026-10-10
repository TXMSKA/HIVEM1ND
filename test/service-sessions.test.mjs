import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeStart, createNativeAdapter, enqueueStart, parseClaudeLine, parseCodexLine, parseCursorLine, probeClients, recoverStarts, registerNative, stopSession } from '../engine/service/adapters.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const UNIT = 'project:shop:executor-shop';
const CODEX = [
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"hivem1nd","title":"HIVEM1ND","version":"3.0.0"}}}',
  '{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"C:/work","model":"strong"}}',
  '{"jsonrpc":"2.0","id":2,"result":{"thread":{"id":"thread-1"}}}',
];

function state() {
  return `unit: executor-shop\nunit-id: ${UNIT}\nrole: executor\nstate: in\nmachine: DESKTOP\n\nReady.\n`;
}

async function world(t, transcript = CODEX) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  const file = path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  await writeFile(file, state());
  const calls = { create: 0 };
  const signaled = [];
  const adapter = createNativeAdapter('codex', { fixture: true, models: ['strong'], transcript, signaled });
  const original = adapter.create.bind(adapter);
  adapter.create = async (request) => {
    calls.create += 1;
    return original(request);
  };
  const context = {
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() },
    principal: { unitId: 'root:master', audience: 'desktop' },
    adapters: { codex: adapter, claude: createNativeAdapter('claude', { fixture: true, models: ['strong'], transcript: ['{"type":"system","subtype":"init","session_id":"11111111-1111-4111-8111-111111111111"}'] }), cursor: createNativeAdapter('cursor', { fixture: true, models: ['strong'], transcript: ['{"jsonrpc":"2.0","id":3,"method":"session/new","params":{"cwd":"C:/work","mcpServers":[]}}', '{"jsonrpc":"2.0","id":3,"result":{"sessionId":"cursor-session-1"}}'] }) },
    projects: [{ name: 'shop', localPath: fixture.root }],
    ownedPids: new Set(),
  };
  return { fixture, context, calls, signaled, file };
}

async function start(context, file, extra = {}) {
  const revision = hashBytes(await readFile(file));
  return enqueueStart(context, { unitId: UNIT, client: 'codex', model: 'strong', stateRevision: revision, prompt: 'Say ok.', ...extra });
}

test('unavailable clients, bad models, stale state and a quiet machine do not start', async (t) => {
  const { fixture, context, file, calls } = await world(t);
  const probe = await probeClients({ env: process.env, spawnVersion: true, fixture });
  for (const client of ['claude', 'codex', 'cursor']) assert.equal(probe[client].nativeSupport, false);
  const revision = hashBytes(await readFile(file));
  await assert.rejects(() => enqueueStart(context, { unitId: UNIT, client: 'opencode', stateRevision: revision }), (error) => error.code === 'client_unavailable');
  await assert.rejects(() => start(context, file, { model: 'giant' }), (error) => error.code === 'unsupported_model');
  await assert.rejects(() => start(context, file, { stateRevision: 'a'.repeat(64) }), (error) => error.code === 'unit_changed');
  context.beat = null;
  await assert.rejects(() => start(context, file), (error) => error.code === 'machine_unavailable');
  assert.equal(calls.create, 0);
  assert.throws(() => parseCodexLine('not-json'), (error) => error.code === 'protocol_error');
  assert.throws(() => parseCursorLine('{"jsonrpc":"2.0","result":{"outcome":"allow-always"}}'), (error) => error.code === 'protocol_error');
  assert.throws(() => parseClaudeLine('{"type":"system","subtype":"init"}'), (error) => error.code === 'protocol_error');
});

test('a fixture launch preloads once, does not leak endpoints, and stops only an owned process', async (t) => {
  const { fixture, context, calls, signaled, file } = await world(t);
  const started = await start(context, file);
  assert.equal(started.result.state, 'started');
  assert.equal(started.result.sessionId == null, false);
  assert.equal(calls.create, 1);
  const saved = JSON.stringify(started);
  assert.equal(/token|pipe|authorization|secret/i.test(saved), false);
  const again = await consumeStart(context, started.request.id);
  assert.equal(again.replayed, true);
  assert.equal(again.result.state, 'started');
  const inbox = await readdir(path.join(fixture.paths.mind, 'user', 'inbox', 'executor-shop'));
  assert.equal(inbox.length, 1);
  const status = await stopSession(context, started.result.sessionId);
  assert.equal(status.state, 'stopped');
  assert.equal(status.reason, 'native-acknowledged');
  assert.equal(signaled.length, 1);
  const external = await registerNative(context, { client: 'codex', nativeSessionId: 'external-1', unitId: UNIT });
  await assert.rejects(() => stopSession(context, external.sessionId), (error) => error.code === 'stop_unavailable');
  assert.equal(signaled.length, 1);
});

test('remote, expired, and prepared crashes do not invent a second native session', async (t) => {
  const { fixture, context, calls, file } = await world(t);
  const remote = await start(context, file, { targetMachine: 'LAPTOP' });
  assert.equal(remote.status, 202);
  assert.equal(calls.create, 0);
  context.launchFault = 'prepared';
  const crashed = await start(context, file).catch((error) => error);
  assert.equal(crashed.code, 'injected_crash');
  fixture.clock.now += 121000;
  context.launchFault = null;
  const expired = await recoverStarts(context);
  assert.equal(expired[0].result.state, 'expired');
  assert.equal(calls.create, 0);
});

test('spawned work stays ambiguous and only one of two claims creates a session', async (t) => {
  const spawned = await world(t);
  spawned.context.launchFault = 'spawned';
  await assert.rejects(() => start(spawned.context, spawned.file), (error) => error.code === 'injected_crash');
  assert.equal(spawned.calls.create, 1);
  spawned.context.launchFault = null;
  const recovered = await recoverStarts(spawned.context);
  assert.equal(recovered[0].error.code, 'launch_ambiguous');
  assert.equal(spawned.calls.create, 1);
  const fresh = await start(spawned.context, spawned.file);
  assert.equal(fresh.result.state, 'started');
  assert.equal(spawned.calls.create, 2);

  const { context, calls, file } = await world(t);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const enteredGate = new Promise((resolve) => {
    entered = resolve;
  });
  const adapter = context.adapters.codex;
  const wrapped = adapter.create;
  adapter.create = async (request) => {
    entered();
    await gate;
    return wrapped(request);
  };
  const first = start(context, file);
  await enteredGate;
  const second = start(context, file);
  release();
  const results = await Promise.all([first.catch((error) => error), second.catch((error) => error)]);
  assert.equal(results.filter((item) => item.result?.state === 'started').length, 1);
  assert.equal(results.filter((item) => item.code === 'unit_in_use').length, 1);
  assert.equal(calls.create, 1);
});

test('a wrapper resolves to the executable and a missing login does not register', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  await mkdir(bin, { recursive: true });
  const executable = path.join(bin, 'claude.exe');
  await writeFile(executable, '');
  await writeFile(path.join(root, 'claude.cmd'), `"%dp0%\\bin\\claude.exe" %*\n`);
  const probe = await probeClients({ env: { PATH: root, PATHEXT: '.CMD;.EXE' }, platform: 'win32' });
  assert.equal(probe.claude.installed, true);
  assert.equal(probe.claude.nativeSupport, false);
  assert.equal(probe.claude.command, executable);
  const launches = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {} };
  child.pid = 4242;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('exit', 1);
  };
  const denied = createNativeAdapter('claude', {
    command: executable,
    spawn(command, args, options) {
      launches.push({ command, args, options });
      queueMicrotask(() => child.stdout.emit('data', 'Not logged in\n'));
      return child;
    },
  });
  await assert.rejects(() => denied.create({ cwd: root }), { code: 'client_unavailable' });
  assert.equal(launches[0].options.shell, false);
  assert.equal(launches[0].options.windowsHide, true);
  assert.equal(launches[0].args.includes('--session-id'), true);
  assert.equal(launches[0].args.some((arg) => /dangerously-skip-permissions/i.test(arg)), false);
  assert.equal(child.killed, true);
  const owned = new EventEmitter();
  owned.stdout = new EventEmitter();
  owned.stderr = new EventEmitter();
  owned.stdin = { write() {}, end() {} };
  owned.pid = 4243;
  owned.kill = () => owned.emit('exit', 0);
  const started = createNativeAdapter('claude', {
    command: executable,
    spawn(_command, args) {
      const session = args[args.indexOf('--session-id') + 1];
      queueMicrotask(() => owned.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'init', session_id: session })}\n`));
      return owned;
    },
  });
  const created = await started.create({ cwd: root });
  assert.equal(created.owned, true);
  const stopped = await started.stop({ owned: true, pid: created.pid });
  assert.equal(stopped.acknowledged, true);
  assert.equal(stopped.exitCode, 0);
  await started.close();
});
