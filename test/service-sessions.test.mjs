import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientRecords, consumeStart, createNativeAdapter, enqueueStart, parseClaudeLine, parseCodexLine, parseCursorLine, probeClients, recoverStarts, registerNative, stopSession } from '../engine/service/adapters.mjs';
import { composeCore, openNativeAdapters } from '../engine/service/service.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
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
  const probe = await probeClients({ env: fixture.env, spawnVersion: true, fixture });
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
  await assert.rejects(() => stopSession(context, started.result.sessionId, { confirmed: false }), { code: 'invalid_body' });
  const credentials = createCredentialStore({ now: () => fixture.clock.now });
  const agent = credentials.issue({ audience: 'agent', unitId: UNIT, sessionId: started.result.sessionId, expiresAt: '2026-10-10T18:00:00.000Z' });
  context.credentials = credentials;
  const status = await stopSession(context, started.result.sessionId, { confirmed: true });
  assert.throws(() => credentials.verify(agent.token), { code: 'invalid_session' });
  assert.equal(status.state, 'stopping');
  assert.equal(status.sessionId, started.result.sessionId);
  assert.equal(signaled.length, 1);
  const external = await registerNative(context, { client: 'codex', nativeSessionId: 'external-1', unitId: UNIT });
  await assert.rejects(() => stopSession(context, external.sessionId, { confirmed: true }), (error) => error.code === 'stop_unavailable');
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

function scriptedChild(lines) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.written = [];
  child.stdin = {
    write(text) {
      child.written.push(String(text));
      return true;
    },
    end() {},
  };
  child.pid = 5151;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 1;
    child.emit('exit', 1);
  };
  queueMicrotask(() => {
    for (const line of lines) child.stdout.emit('data', `${line}\n`);
  });
  return child;
}

test('a start uses the unit project path instead of the first registered project', async (t) => {
  const { fixture, context, file } = await world(t);
  const shop = path.join(fixture.root, 'shop-project');
  const other = path.join(fixture.root, 'other-project');
  context.projects = [
    { name: 'other', localPath: other },
    { name: 'shop', localPath: shop },
  ];
  const seen = [];
  const original = context.adapters.codex.create.bind(context.adapters.codex);
  context.adapters.codex.create = async (request) => {
    seen.push(request.cwd);
    return original(request);
  };
  const started = await start(context, file);
  assert.equal(started.result.state, 'started');
  assert.equal(seen[0], shop);
});

test('installed Codex is discovered off PATH and notifications are not replies', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const versionDir = path.join(fixture.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin', '2e5e00daee91c61d');
  await mkdir(versionDir, { recursive: true });
  const executable = path.join(versionDir, 'codex.exe');
  await writeFile(executable, '');
  const elsewhere = path.join(fixture.root, 'elsewhere');
  await mkdir(elsewhere, { recursive: true });
  await writeFile(path.join(elsewhere, 'codex.exe'), '');
  await symlink(elsewhere, path.join(fixture.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin', 'linked'), 'junction');
  const env = { ...fixture.env, PATH: '', PATHEXT: '.EXE' };
  const probe = await probeClients({ env, platform: 'win32' });
  assert.equal(probe.codex.installed, true);
  assert.equal(probe.codex.command, executable);
  assert.equal(probe.codex.capabilities.create, false);
  assert.equal(JSON.stringify(clientRecords(probe)).includes(executable), false);
  const blocked = await probeClients({ env: { ...env, HIVEM1ND_CODEX: 'codex.exe' }, platform: 'win32' });
  assert.equal(blocked.codex.installed, false);

  const shop = path.join(fixture.root, 'shop-project');
  await mkdir(shop, { recursive: true });
  const seen = [];
  const opened = openNativeAdapters(env, {
    platform: 'win32',
    spawn(command, args, options) {
      const child = scriptedChild([
        '{"jsonrpc":"2.0","id":1,"result":{"userAgent":"codex"}}',
        '{"jsonrpc":"2.0","method":"remoteControl/status/changed","params":{"status":"ready"}}',
        '{"jsonrpc":"2.0","id":99,"method":"item/started","params":{}}',
        '{"jsonrpc":"2.0","id":2,"result":{"account":{"type":"chatgpt"},"requiresOpenaiAuth":false}}',
        '{"jsonrpc":"2.0","id":3,"result":{"thread":{"id":"thread-smoke"}}}',
      ]);
      seen.push({ command, args, options, child });
      return child;
    },
  });
  t.after(() => opened.close());
  const created = await opened.adapters.codex.create({
    cwd: shop,
    unitId: UNIT,
    job: 'build',
    leadId: 'root:lead',
    prompt: 'do-not-embed-this-prompt',
  });
  assert.equal(created.nativeSessionId, 'thread-smoke');
  assert.equal(seen[0].command, executable);
  assert.deepEqual(seen[0].args, ['app-server', '--listen', 'stdio://']);
  assert.equal(seen[0].options.env, env);
  assert.equal(seen[0].options.cwd, shop);
  assert.equal(seen[0].options.shell, false);
  assert.equal(seen[0].options.windowsHide, true);
  const written = seen[0].child.written.join('');
  const lines = seen[0].child.written.map((line) => JSON.parse(line));
  const initialize = lines.find((line) => line.method === 'initialize');
  const account = lines.find((line) => line.method === 'account/read');
  const thread = lines.find((line) => line.method === 'thread/start');
  assert.equal(written.includes('do-not-embed-this-prompt'), false);
  assert.equal(initialize.id, 1);
  assert.equal(account.id, 2);
  assert.deepEqual(account.params, {});
  assert.equal(thread.id, 3);
  assert.equal(written.includes(JSON.stringify(shop).slice(1, -1)), true);

  const deniedChild = [];
  const denied = openNativeAdapters(env, {
    platform: 'win32',
    spawn() {
      const child = scriptedChild([
        '{"jsonrpc":"2.0","id":1,"result":{}}',
        '{"jsonrpc":"2.0","method":"remoteControl/status/changed","params":{}}',
        '{"jsonrpc":"2.0","id":2,"result":{"account":null,"requiresOpenaiAuth":true}}',
      ]);
      deniedChild.push(child);
      return child;
    },
  });
  t.after(() => denied.close());
  await assert.rejects(
    () => denied.adapters.codex.create({ cwd: shop, unitId: UNIT }),
    (error) => error.code === 'client_unavailable',
  );
  assert.equal(deniedChild[0].killed, true);
  const deniedAccount = deniedChild[0].written.map((line) => JSON.parse(line)).find((line) => line.method === 'account/read');
  assert.equal(deniedAccount.id, 2);
  assert.deepEqual(deniedAccount.params, {});
});

test('Cursor correlates authenticate replies and Claude receives the startup instruction first', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const cursorDir = path.join(fixture.env.LOCALAPPDATA, 'cursor-agent');
  await mkdir(cursorDir, { recursive: true });
  const node = path.join(cursorDir, 'node.exe');
  const script = path.join(cursorDir, 'index.js');
  await writeFile(node, '');
  await writeFile(script, '');
  const env = { ...fixture.env, PATH: '', PATHEXT: '.EXE' };
  const shop = path.join(fixture.root, 'shop-project');
  await mkdir(shop, { recursive: true });
  const seen = [];
  const opened = openNativeAdapters(env, {
    platform: 'win32',
    spawn(command, args, options) {
      const child = scriptedChild([
        '{"jsonrpc":"2.0","id":1,"result":{"authMethods":[{"id":"existing-login","name":"Existing login"}]}}',
        '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"early"}}',
        '{"jsonrpc":"2.0","id":2,"result":{}}',
        '{"jsonrpc":"2.0","id":3,"result":{"sessionId":"cursor-smoke"}}',
      ]);
      seen.push({ command, args, options, child });
      return child;
    },
  });
  t.after(() => opened.close());
  const created = await opened.adapters.cursor.create({ cwd: shop, unitId: UNIT, prompt: 'do-not-embed-this-prompt' });
  assert.equal(created.nativeSessionId, 'cursor-smoke');
  assert.equal(seen[0].command, node);
  assert.deepEqual(seen[0].args, [script, 'acp']);
  assert.equal(seen[0].options.env, env);
  assert.equal(seen[0].options.shell, false);
  assert.equal(seen[0].child.written.join('').includes('do-not-embed-this-prompt'), false);

  const writes = [];
  const claude = createNativeAdapter('claude', {
    command: path.join(fixture.root, 'claude.exe'),
    models: ['strong'],
    env,
    spawn(_command, args) {
      const session = args[args.indexOf('--session-id') + 1];
      const child = scriptedChild([JSON.stringify({ type: 'system', subtype: 'init', session_id: session })]);
      const original = child.stdin.write;
      child.stdin.write = (text) => {
        writes.push(String(text));
        return original.call(child.stdin, text);
      };
      return child;
    },
  });
  t.after(() => claude.close());
  const session = await claude.create({
    cwd: shop,
    unitId: UNIT,
    job: 'build',
    model: 'strong',
    leadId: 'root:lead',
    prompt: 'do-not-embed-this-prompt',
  });
  assert.equal(session.owned, true);
  assert.equal(writes.length > 0, true);
  assert.equal(writes[0].includes('Unit: project:shop:executor-shop'), true);
  assert.equal(writes[0].includes('Job: build'), true);
  assert.equal(writes[0].includes('Model: strong'), true);
  assert.equal(writes[0].includes('Lead: root:lead'), true);
  assert.equal(writes[0].includes('do-not-embed-this-prompt'), false);
  assert.equal(writes[0].includes('"type":"user"'), true);
});

test('a failed native start can be retried and an unconsumed request expires over HTTP', async (t) => {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  const file = path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  await writeFile(file, state());
  const projects = [];
  const adapter = createNativeAdapter('codex', { fixture: true, models: ['strong'], transcript: CODEX });
  const core = await composeCore({
    store: fixture.store,
    paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now,
    projects,
    adapters: { codex: adapter },
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await jsonCall(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  assert.equal(local.status, 201);
  const token = local.json.data.token;
  const revision = hashBytes(await readFile(file));
  const denied = await jsonCall(core.http.port, 'POST', `/api/v1/units/${UNIT}/session`, {
    token,
    body: { client: 'codex', expectedRevision: revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(denied.status, 503);
  assert.equal(denied.json.error.code, 'client_unavailable');
  const reserved = await readdir(path.join(fixture.paths.localDirectory, 'session-starts')).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  assert.equal(reserved.length, 0);
  projects.push({ name: 'shop', localPath: fixture.root, eligible: true });
  const retried = await jsonCall(core.http.port, 'POST', `/api/v1/units/${UNIT}/session`, {
    token,
    body: { client: 'codex', expectedRevision: revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(retried.status, 202);
  assert.equal(retried.json.data.state, 'started');
  const queued = await enqueueStart({
    store: fixture.store,
    paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now,
    projects,
    adapters: { codex: adapter },
    principal: { unitId: 'root:master', audience: 'desktop' },
  }, { unitId: UNIT, client: 'codex', stateRevision: revision, targetMachine: 'LAPTOP' });
  assert.equal(queued.status, 202);
  assert.equal(queued.state, 'queued');
  fixture.clock.now += 121000;
  const expired = await jsonCall(core.http.port, 'GET', `/api/v1/session-requests/${queued.request.id}`, { token });
  assert.equal(expired.status, 200);
  assert.equal(expired.json.data.state, 'expired');
  assert.equal(expired.json.data.error.code, 'approval_expired');
});

const FIXTURE_EMAIL = 'person@example.com';

function tick() {
  return new Promise((resolve) => { setImmediate(resolve); });
}

function settleOr(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ settled: false }), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve({ settled: true, value });
    }, () => {
      clearTimeout(timer);
      resolve({ settled: true, value: null });
    });
  });
}

function liveChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.written = [];
  child.handlers = [];
  child.stdin = {
    write(text) {
      const raw = String(text);
      child.written.push(raw);
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return true;
      }
      queueMicrotask(() => {
        for (const handler of child.handlers) handler(message);
      });
      return true;
    },
    end() {},
  };
  child.pid = 5252;
  child.killed = false;
  child.exitCode = null;
  child.kill = () => {
    if (child.killed) return;
    child.killed = true;
    child.exitCode = 1;
    child.emit('exit', 1);
  };
  child.onRequest = (handler) => { child.handlers.push(handler); };
  child.respond = (message, body) => {
    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: message.id, ...body })}\n`);
  };
  return child;
}

function installHandshake(child, accountBody) {
  child.onRequest((message) => {
    if (message.method === 'initialize') child.respond(message, { result: { userAgent: 'codex' } });
    else if (message.method === 'account/read') child.respond(message, accountBody);
    else if (message.method === 'thread/start') child.respond(message, { result: { thread: { id: 'thread-1' } } });
  });
}

async function ownedCodex(t, child, timeoutMs = 1000) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const adapter = createNativeAdapter('codex', {
    command: path.join(fixture.root, 'codex.exe'),
    env: fixture.env,
    timeoutMs,
    spawn() { return child; },
  });
  t.after(() => adapter.close());
  return { fixture, adapter, child };
}

function rpcMethods(child) {
  return child.written.map((line) => JSON.parse(line));
}

test('codex account read accepts a signed-in account and an unauthenticated provider', async (t) => {
  const cases = [
    { result: { account: { type: 'chatgpt', email: FIXTURE_EMAIL, planType: 'plus' }, requiresOpenaiAuth: true }, ok: true },
    { result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true }, ok: true },
    { result: { account: null, requiresOpenaiAuth: false }, ok: true },
    { result: { account: null, requiresOpenaiAuth: true }, ok: false },
    { result: { requiresOpenaiAuth: false }, ok: false },
    { result: { account: { type: 'chatgpt' } }, ok: false },
    { result: { account: null, requiresOpenaiAuth: 'true' }, ok: false },
    { result: { account: { type: 'other' }, requiresOpenaiAuth: true }, ok: false },
    { error: { code: -32000, message: 'not logged in', data: { email: FIXTURE_EMAIL } }, ok: false },
    { error: { code: -32000, message: 'unavailable' }, ok: false },
  ];
  for (const entry of cases) {
    const child = liveChild();
    const { ok, ...accountBody } = entry;
    installHandshake(child, accountBody);
    const { fixture, adapter } = await ownedCodex(t, child);
    const started = adapter.create({ cwd: fixture.root, unitId: UNIT });
    if (ok) {
      const created = await started;
      assert.equal(created.nativeSessionId, 'thread-1');
      assert.equal(JSON.stringify(created).includes(FIXTURE_EMAIL), false);
      assert.equal(rpcMethods(child).some((line) => line.method === 'thread/start'), true);
    } else {
      await assert.rejects(started, (error) => {
        assert.equal(error.code, 'client_unavailable');
        assert.equal(String(error.message).includes(FIXTURE_EMAIL), false);
        assert.equal(JSON.stringify(error.details ?? {}).includes(FIXTURE_EMAIL), false);
        return true;
      });
      assert.equal(rpcMethods(child).some((line) => line.method === 'thread/start'), false);
    }
    assert.equal(child.written.join('').includes(FIXTURE_EMAIL), false);
    assert.equal(rpcMethods(child).some((line) => line.method === 'account/read' && JSON.stringify(line.params) === '{}'), true);
  }
  const child = liveChild();
  child.onRequest((message) => {
    if (message.method === 'initialize') child.respond(message, { result: { userAgent: 'codex' } });
    else if (message.method === 'account/read') {
      child.stderr.emit('data', 'not logged in\n');
      child.respond(message, { result: { account: { type: 'chatgpt', email: FIXTURE_EMAIL }, requiresOpenaiAuth: true } });
    }
  });
  const { fixture, adapter } = await ownedCodex(t, child);
  await assert.rejects(() => adapter.create({ cwd: fixture.root, unitId: UNIT }), (error) => {
    assert.equal(error.code, 'client_unavailable');
    assert.equal(String(error.message).includes(FIXTURE_EMAIL), false);
    return true;
  });
});

test('an active codex turn steers once and the next message starts after completion', async (t) => {
  const child = liveChild();
  installHandshake(child, { result: { account: { type: 'chatgpt' }, requiresOpenaiAuth: true } });
  let starts = 0;
  child.onRequest((message) => {
    if (message.method === 'turn/start') {
      starts += 1;
      child.respond(message, { result: { turn: { id: `turn-${starts}`, items: [], status: 'inProgress' } } });
    } else if (message.method === 'turn/steer') {
      child.respond(message, { result: { turnId: message.params.expectedTurnId } });
    }
  });
  const { fixture, adapter } = await ownedCodex(t, child);
  const created = await adapter.create({ cwd: fixture.root, unitId: UNIT });
  const first = await adapter.send({ nativeSessionId: created.nativeSessionId, text: 'alpha' });
  const second = await adapter.send({ nativeSessionId: created.nativeSessionId, text: 'beta' });
  const turnWrites = () => rpcMethods(child).filter((line) => line.method === 'turn/start' || line.method === 'turn/steer');
  assert.equal(first.submitted, true);
  assert.equal(second.submitted, true);
  assert.equal(turnWrites()[0].method, 'turn/start');
  assert.deepEqual(turnWrites()[0].params.input, [{ type: 'text', text: 'alpha' }]);
  assert.equal(turnWrites()[1].method, 'turn/steer');
  assert.equal(turnWrites()[1].params.expectedTurnId, 'turn-1');
  assert.equal(turnWrites()[1].params.threadId, 'thread-1');
  assert.deepEqual(turnWrites()[1].params.input, [{ type: 'text', text: 'beta' }]);
  assert.equal(turnWrites()[1].params.turn, undefined);
  const beforeNotice = child.written.length;
  child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } })}\n`);
  child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 90, method: 'item/commandExecution/requestApproval', params: { id: 'req-1' } })}\n`);
  child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 'other-thread', turn: { id: 'turn-1', items: [], status: 'completed' } } })}\n`);
  await tick();
  assert.equal(child.written.length, beforeNotice);
  const steered = await adapter.send({ nativeSessionId: created.nativeSessionId, text: 'gamma' });
  assert.equal(steered.submitted, true);
  assert.equal(turnWrites().at(-1).method, 'turn/steer');
  assert.equal(turnWrites().at(-1).params.expectedTurnId, 'turn-1');
  child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-other', items: [], status: 'completed' } } })}\n`);
  await tick();
  const still = await adapter.send({ nativeSessionId: created.nativeSessionId, text: 'delta' });
  assert.equal(still.submitted, true);
  assert.equal(turnWrites().at(-1).method, 'turn/steer');
  child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'completed' } } })}\n`);
  await tick();
  const restarted = await adapter.send({ nativeSessionId: created.nativeSessionId, text: 'epsilon' });
  assert.equal(restarted.submitted, true);
  assert.equal(turnWrites().at(-1).method, 'turn/start');
  assert.equal(turnWrites().at(-1).params.threadId, 'thread-1');
  assert.deepEqual(turnWrites().at(-1).params.input, [{ type: 'text', text: 'epsilon' }]);
  const joined = child.written.join('\n');
  for (const text of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) assert.equal(joined.split(text).length - 1, 1);
});

test('a timed-out codex response does not consume the next rpc', async (t) => {
  const child = liveChild();
  installHandshake(child, { result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } });
  const answered = [];
  child.onRequest((message) => {
    if (message.method !== 'turn/start') return;
    answered.push(message.id);
    if (answered.length === 1) return;
    child.respond(message, { result: { turn: { id: 'turn-later', items: [], status: 'inProgress' } } });
  });
  const { fixture, adapter } = await ownedCodex(t, child, 1000);
  const created = await adapter.create({ cwd: fixture.root, unitId: UNIT });
  const first = await adapter.send({ nativeSessionId: created.nativeSessionId, text: 'late' });
  assert.equal(first.submitted, false);
  assert.equal(first.ambiguous, true);
  assert.equal(answered.length, 1);
  const second = await adapter.send({ nativeSessionId: created.nativeSessionId, text: 'next' });
  assert.equal(second.submitted, true);
  assert.equal(second.ambiguous, undefined);
  assert.equal(answered.length, 2);
  assert.notEqual(answered[0], answered[1]);
  const starts = rpcMethods(child).filter((line) => line.method === 'turn/start');
  assert.equal(starts.length, 2);
  assert.equal(starts[0].id, answered[0]);
  assert.equal(starts[1].id, answered[1]);
  assert.equal(starts[1].params.input[0].text, 'next');
});

test('a rejected or malformed codex ack is ambiguous and is not replayed', async (t) => {
  const outcomes = [
    { method: 'turn/start', body: { result: { turnId: 'turn-1' } } },
    { method: 'turn/steer', body: { result: { turn: { id: 'turn-1' } } } },
    { method: 'turn/steer', body: { result: { turnId: 'turn-other' } } },
    { method: 'turn/steer', body: { error: { code: 1, message: 'rejected' } } },
  ];
  for (const outcome of outcomes) {
    const child = liveChild();
    installHandshake(child, { result: { account: { type: 'chatgpt' }, requiresOpenaiAuth: true } });
    child.onRequest((message) => {
      if (message.method === 'turn/start' && outcome.method !== 'turn/start') {
        child.respond(message, { result: { turn: { id: 'turn-1', items: [], status: 'inProgress' } } });
      } else if (message.method === outcome.method) child.respond(message, outcome.body);
    });
    const { fixture, adapter } = await ownedCodex(t, child);
    const created = await adapter.create({ cwd: fixture.root, unitId: UNIT });
    if (outcome.method === 'turn/steer') {
      const started = await adapter.send({ nativeSessionId: created.nativeSessionId, text: 'alpha' });
      assert.equal(started.submitted, true);
    }
    const before = child.written.length;
    const result = await adapter.send({ nativeSessionId: created.nativeSessionId, text: 'beta' });
    assert.equal(result.submitted, false);
    assert.equal(result.ambiguous, true);
    assert.equal(child.written.length, before + 1);
    assert.equal(child.written.join('').includes('beta'), true);
    assert.equal(child.written.join('').split('beta').length - 1, 1);
  }
});

test('closing the owned codex child settles a pending response', async (t) => {
  const exited = liveChild();
  installHandshake(exited, { result: { account: null, requiresOpenaiAuth: false } });
  exited.onRequest((message) => {
    if (message.method === 'turn/start') {
      exited.exitCode = 1;
      exited.emit('exit', 1);
    }
  });
  const first = await ownedCodex(t, exited, 5000);
  const created = await first.adapter.create({ cwd: first.fixture.root, unitId: UNIT });
  const pending = first.adapter.send({ nativeSessionId: created.nativeSessionId, text: 'stop' });
  const exitedResult = await settleOr(pending, 500);
  assert.equal(exitedResult.settled, true);
  assert.equal(exitedResult.value.submitted, false);
  assert.equal(exitedResult.value.ambiguous, true);
  assert.equal(rpcMethods(exited).filter((line) => line.method === 'turn/start').length, 1);

  const closed = liveChild();
  installHandshake(closed, { result: { account: null, requiresOpenaiAuth: false } });
  const second = await ownedCodex(t, closed, 5000);
  const session = await second.adapter.create({ cwd: second.fixture.root, unitId: UNIT });
  const hanging = second.adapter.send({ nativeSessionId: session.nativeSessionId, text: 'close' });
  await tick();
  const closeResult = await settleOr((async () => {
    await second.adapter.close();
    return hanging;
  })(), 500);
  assert.equal(closeResult.settled, true);
  assert.equal(closeResult.value.submitted, false);
  assert.equal(closeResult.value.ambiguous, true);
  assert.equal(rpcMethods(closed).filter((line) => line.method === 'turn/start').length, 1);
});

function jsonCall(port, method, target, { token = null, body = undefined, headers = {} } = {}) {
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
        resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : null });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}
