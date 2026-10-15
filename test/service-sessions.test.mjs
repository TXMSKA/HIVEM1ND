import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelStart, clientRecords, completeSessionTask, consumeStart, createNativeAdapter, enqueueStart, parseClaudeLine, parseCodexLine, parseCursorLine, probeClients, readStartRequest, recoverStarts, registerNative, sessionGitPermissions, stopSession } from '../engine/service/adapters.mjs';
import { readDetail } from '../engine/service/projection.mjs';
import { composeCore, openNativeAdapters, restartService, startService, stopService } from '../engine/service/service.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { requestApproval } from '../engine/service/approvals.mjs';
import { readScopedAdditions } from '../engine/service/additions.mjs';
import { bindManualAdditionContent } from '../engine/relay/local-wake.mjs';
import { closeBridge, createNativeLaunch, dispatchNative, openBridge } from '../engine/service/bridge.mjs';
import { createCluster } from '../engine/service/clusters.mjs';
import { directoryIdentity, readRepositoryIdentity } from '../engine/service/cluster-git.mjs';
import { createPlan } from '../engine/service/plans.mjs';
import { readRun } from '../engine/service/runs.mjs';

async function linkRepository(context, directory) {
  await mkdir(directory, { recursive: true });
  const git = promisify(execFile);
  await git('git', ['init', '--initial-branch=main'], { cwd: directory, timeout: 10000, windowsHide: true });
  await git('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Fixture baseline'], { cwd: directory, timeout: 10000, windowsHide: true });
  const identity = await readRepositoryIdentity(directory);
  await writeFile(path.join(context.paths.localDirectory, 'cluster-links.json'), JSON.stringify({ format: 'hivem1nd-cluster-links-v1', machine: 'DESKTOP', links: {
    'repository:shop': { machine: 'DESKTOP', localPath: directory, identity: await directoryIdentity(directory), repositoryId: identity.id },
  } }));
  return createCluster(context, { title: 'Shop', members: [UNIT], machine: 'DESKTOP', parentId: null, link: { kind: 'repository', projectId: 'shop' }, confirmed: true });
}

async function scopedPackage(context, requirements = []) {
  const id = randomUUID(), content = Buffer.from('---\nname: pdf\nruntime: none\n---\nPDF support\n');
  const file = path.join(context.paths.mind, 'user', 'features', 'pdf', 'SKILL.md');
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content);
  const record = { format: 'hivem1nd-addition-v1', id, kind: 'skill', name: 'pdf', title: 'pdf', source: { kind: 'git', display: 'acme/pdf', url: 'https://github.com/acme/pdf' },
    sourcePath: '.', pin: { kind: 'commit', value: 'a'.repeat(40), digest: 'b'.repeat(64) }, license: 'MIT', publishedAt: '2026-10-01T00:00:00.000Z', requirements,
    scope: { everyUnit: false, units: [UNIT], groups: [] }, unitCount: 1, machine: 'DESKTOP', projectId: null, installedAt: new Date(context.now()).toISOString(), updatedAt: new Date(context.now()).toISOString(), removed: false,
    files: [{ path: 'user/features/pdf/SKILL.md', hash: hashBytes(content), bytes: content.length }] };
  const manifest = path.join(context.paths.mind, 'user', 'additions', `${id}.json`);
  await mkdir(path.dirname(manifest), { recursive: true }); await writeFile(manifest, JSON.stringify(record));
  return { id, file, manifest, content };
}

test('two canonical units on one client receive different native scoped channels and verified manual sessions cannot widen them', async t => {
  const { context, file, fixture } = await world(t), imported = await scopedPackage(context);
  const second = 'project:shop:second', secondFile = path.join(fixture.paths.mind, 'user', 'state', 'second.md');
  await writeFile(secondFile, `unit: second\nunit-id: ${second}\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: {"client":"codex","model":"strong","effort":"high","mode":null}\n`);
  const channels = new Map(), transcript = [...CODEX]; let count = 0;
  const adapter = createNativeAdapter('codex', { fixture: true, models: ['strong'], transcript, scopedContent: {
    async bind(proof, read) { channels.set(proof.nativeSessionId, { proof, read }); return { ...proof, bound: true }; }, runtimeAvailable: async () => true,
  } });
  const original = adapter.create.bind(adapter);
  adapter.create = async request => { transcript[2] = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { thread: { id: `scoped-${++count}` } } }); return original(request); };
  context.adapters.codex = adapter; t.after(() => adapter.close());
  const selected = await start(context, file, { runMode: 'chat' });
  const unselected = await enqueueStart(context, { unitId: second, client: 'codex', model: 'strong', stateRevision: hashBytes(await readFile(secondFile)), runMode: 'chat' });
  const firstSession = await readDetail(context, 'sessions', selected.result.sessionId), secondSession = await readDetail(context, 'sessions', unselected.result.sessionId);
  assert.equal((await channels.get(firstSession.nativeSessionId).read())[0].addition.id, imported.id);
  assert.deepEqual(await channels.get(secondSession.nativeSessionId).read(), []);
  const bridge = await openBridge({ paths: context.paths, adapters: context.adapters, now: context.now }); t.after(() => closeBridge(bridge));
  const policies = path.join(context.paths.mind, 'user', 'relay', 'wake', 'policies'); await mkdir(policies, { recursive: true });
  const grants = [];
  for (const session of [firstSession, secondSession]) {
    await writeFile(path.join(policies, `${session.id}.json`), JSON.stringify({ key: session.id, enabled: true, generation: 'scoped', deadlineAt: new Date(context.now() + 60000).toISOString(),
      binding: { unitId: session.unitId, nativeSessionId: session.nativeSessionId, client: 'codex', machine: 'DESKTOP' } }));
    const launch = createNativeLaunch(bridge, { unitId: session.unitId, client: 'codex', contentReader: proof => readScopedAdditions(context, proof) });
    launch.ready(session.nativeSessionId); grants.push(launch);
  }
  const scopedCall = (index, input = {}) => dispatchNative(bridge.endpoint, grants[index].env.HIVEM1ND_SERVICE_GRANT, 'content', input);
  assert.equal((await scopedCall(0))[0].addition.id, imported.id); assert.deepEqual(await scopedCall(1), []);
  assert.deepEqual(Buffer.from((await scopedCall(0, { additionId: imported.id, path: 'SKILL.md', offset: 0 })).bytesBase64, 'base64'), imported.content);
  await assert.rejects(scopedCall(1, { additionId: imported.id, path: 'SKILL.md' }), { code: 'forbidden' });
  await assert.rejects(scopedCall(0, { unitId: second }), { code: 'forbidden' });
  const otherNative = await adapter.create({ unitId: second });
  const manual = await registerNative(context, { client: 'codex', unitId: second, nativeSessionId: otherNative.nativeSessionId });
  const proof = { unitId: second, client: 'codex', nativeSessionId: otherNative.nativeSessionId, machine: 'DESKTOP', sessionId: manual.sessionId };
  await bindManualAdditionContent(context, proof); assert.deepEqual(await channels.get(proof.nativeSessionId).read(), []);
  await assert.rejects(bindManualAdditionContent(context, { ...proof, unitId: UNIT }), { code: 'scope_unavailable' });
  await assert.rejects(readScopedAdditions(context, { ...proof, unitId: UNIT, sessionId: selected.result.sessionId }), { code: 'scope_unavailable' });
  assert.deepEqual(await readFile(imported.file), imported.content);
  assert.deepEqual(await readdir(fixture.home), []);
  await stopSession(context, selected.result.sessionId, { confirmed: true });
  await assert.rejects(channels.get(firstSession.nativeSessionId).read(), { code: 'scope_unavailable' });
});

test('unsupported scope and missing runtimes refuse a launch before a native process or installer is created', async t => {
  const first = await world(t), imported = await scopedPackage(first.context);
  await assert.rejects(start(first.context, first.file), { code: 'scope_unavailable' });
  assert.equal(first.calls.create, 0); assert.deepEqual(await readFile(imported.file), imported.content);
  const requestId = (await readdir(path.join(first.context.paths.mind, 'user', 'relay', 'requests', 'DESKTOP')))[0].slice(0, -5);
  const failed = await readStartRequest(first.context, requestId, { readOnly: true });
  assert.equal(failed.result.state, 'failed'); assert.equal(failed.result.error.code, 'scope_unavailable');
  assert.equal((await consumeStart(first.context, requestId)).result.error.code, 'scope_unavailable'); assert.equal(first.calls.create, 0);
  const second = await world(t), python = await scopedPackage(second.context, ['Python']); let creates = 0;
  second.context.adapters.codex.capabilities.scopedContent = true;
  second.context.adapters.codex.bindContent = async () => ({ bound: true });
  second.context.adapters.codex.runtimeAvailable = async () => false;
  second.context.adapters.codex.create = async () => { creates++; throw new Error('Must not launch'); };
  await assert.rejects(start(second.context, second.file), error => error.code === 'runtime_unavailable' && error.details.requirement === 'Python');
  assert.equal(creates, 0); assert.deepEqual(await readFile(python.file), python.content);
  for (const client of ['codex', 'claude', 'cursor']) assert.equal(createNativeAdapter(client, { fixture: true }).capabilities.scopedContent, false);
});

const UNIT = 'project:shop:executor-shop';
const CODEX = [
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"hivem1nd","title":"HIVEM1ND","version":"3.0.0"}}}',
  '{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"C:/work","model":"strong"}}',
  '{"jsonrpc":"2.0","id":2,"result":{"thread":{"id":"thread-1"}}}',
];

function state() {
  return `unit: executor-shop\nunit-id: ${UNIT}\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: {"client":"codex","model":"strong","effort":"high","mode":null}\n\nReady.\n`;
}

async function world(t, transcript = CODEX) {
  const fixture = await makeCoreFixture();
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await Promise.all(Object.values(context.adapters).map(adapter => adapter.close?.()));
    await dispose(fixture);
  });
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
  return { fixture, context, calls, signaled, file, cleanup: close => cleanups.push(close) };
}

async function start(context, file, extra = {}) {
  const revision = hashBytes(await readFile(file));
  return enqueueStart(context, { unitId: UNIT, client: 'codex', model: 'strong', stateRevision: revision, prompt: 'Say ok.', ...extra });
}

test('reviewed Git capability reaches only newly owned sessions and is rechecked after revocation', async t => {
  const transcript = [...CODEX];
  const { fixture, context, file } = await world(t, transcript);
  await linkRepository(context, fixture.root);
  const permissionFile = path.join(fixture.paths.localDirectory, 'client-permissions.json');
  const launches = [], adapter = context.adapters.codex, original = adapter.create.bind(adapter);
  adapter.create = async request => {
    launches.push(request);
    transcript[2] = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { thread: { id: `permission-thread-${launches.length}` } } });
    return original(request);
  };
  const earlier = await start(context, file, { runMode: 'chat' });
  assert.deepEqual(launches[0].agentPermissions, []);
  const permission = { id: randomUUID(), machine: fixture.machine, client: 'codex', actions: ['git.commit', 'git.push'], scope: 'hivem1nd-started-sessions', grantedAt: new Date(fixture.clock.now).toISOString(), grantedBy: 'root:master' };
  await writeFile(permissionFile, JSON.stringify({ permissions: [permission] }));
  const binding = { unitId: UNIT, client: 'codex', repository: fixture.root };
  assert.deepEqual(await sessionGitPermissions(context, earlier.result.sessionId, binding), []);
  await stopSession(context, earlier.result.sessionId, { confirmed: true });
  const started = await start(context, file, { runMode: 'chat' });
  assert.equal(launches[1].agentPermissions[0].id, permission.id);
  assert.equal(launches[1].agentPermissions[0].unitId, UNIT);
  assert.equal(launches[1].agentPermissions[0].repository, fixture.root);
  assert.equal(launches[1].agentPermissions[0].requestId, started.request.id);
  const permitted = await sessionGitPermissions(context, started.result.sessionId, binding);
  assert.equal(permitted[0].sessionId, started.result.sessionId);
  const registration = await readDetail(context, 'sessions', started.result.sessionId);
  assert.equal((await adapter.gitPermissions({ nativeSessionId: registration.nativeSessionId, unitId: UNIT }))[0].id, permission.id);
  for (const changed of [{ unitId: 'root:overseer' }, { client: 'cursor' }, { repository: path.join(fixture.root, 'foreign') }]) {
    assert.deepEqual(await sessionGitPermissions(context, started.result.sessionId, { ...binding, ...changed }), []);
  }
  assert.deepEqual(await sessionGitPermissions({ ...context, paths: { ...context.paths, machine: 'LAPTOP' } }, started.result.sessionId, binding), []);
  const manual = await registerNative(context, { client: 'codex', unitId: UNIT, nativeSessionId: 'manual-foreign' });
  assert.deepEqual(await sessionGitPermissions(context, manual.sessionId, binding), []);
  const agent = { ...context, principal: { audience: 'agent', unitId: UNIT, sessionId: started.result.sessionId } };
  const ask = await requestApproval(agent, { action: 'git.push', pattern: { repository: 'project:shop', args: ['origin', 'main'] }, display: 'Push the reviewed task' });
  assert.equal(ask.prompted, true);
  assert.equal(ask.allow, false);
  assert.equal(ask.approval.alwaysAllowed, false);
  await writeFile(permissionFile, JSON.stringify({ permissions: [] }));
  assert.deepEqual(await sessionGitPermissions(context, started.result.sessionId, binding), []);
  assert.deepEqual(await adapter.gitPermissions({ nativeSessionId: registration.nativeSessionId, unitId: UNIT }), []);
  await writeFile(permissionFile, JSON.stringify({ permissions: [{ ...permission, id: randomUUID() }] }));
  assert.deepEqual(await sessionGitPermissions(context, started.result.sessionId, binding), []);
  await stopSession(context, started.result.sessionId, { confirmed: true });
  await writeFile(permissionFile, JSON.stringify({ permissions: [] }));
  await start(context, file, { runMode: 'chat' });
  assert.deepEqual(launches.at(-1).agentPermissions, []);
  await writeFile(permissionFile, JSON.stringify({ permissions: [permission] }));
  for (const [unitId, role] of [['root:overseer', 'overseer'], ['env:web:overlord-web', 'overlord']]) {
    const unit = unitId.split(':').at(-1), otherFile = path.join(fixture.paths.mind, 'user', 'state', `${unit}.md`);
    await writeFile(otherFile, `unit: ${unit}\nunit-id: ${unitId}\nrole: ${role}\nstate: in\nmachine: DESKTOP\nruns-in: {"client":"codex","model":"strong","effort":"high","mode":null}\n\nReady.\n`);
    const started = await enqueueStart(context, { unitId, client: 'codex', runMode: 'chat', stateRevision: hashBytes(await readFile(otherFile)) });
    assert.equal(started.result.state, 'started');
    assert.deepEqual(launches.at(-1).agentPermissions, []);
    assert.deepEqual(await sessionGitPermissions(context, started.result.sessionId, { ...binding, unitId }), []);
  }
});

test('unavailable clients, bad models, stale state and a quiet machine do not start', async (t) => {
  const { fixture, context, file, calls } = await world(t);
  const probe = await probeClients({ env: fixture.env, spawnVersion: true, fixture });
  for (const client of ['claude', 'codex', 'cursor']) assert.equal(probe[client].nativeSupport, false);
  const revision = hashBytes(await readFile(file));
  await assert.rejects(() => enqueueStart(context, { unitId: UNIT, client: 'opencode', stateRevision: revision }), (error) => error.code === 'unsupported_launch_choice');
  await assert.rejects(() => start(context, file, { model: 'giant' }), (error) => error.code === 'unsupported_launch_choice');
  await assert.rejects(() => start(context, file, { stateRevision: 'a'.repeat(64) }), (error) => error.code === 'unit_changed');
  context.beat = null;
  await assert.rejects(() => start(context, file), (error) => error.code === 'machine_unavailable');
  assert.equal(calls.create, 0);
  assert.throws(() => parseCodexLine('not-json'), (error) => error.code === 'protocol_error');
  assert.throws(() => parseCursorLine('{"jsonrpc":"2.0","result":{"outcome":"allow-always"}}'), (error) => error.code === 'protocol_error');
  assert.throws(() => parseClaudeLine('{"type":"system","subtype":"init"}'), (error) => error.code === 'protocol_error');
});

test('an npm wrapper probes the client version through its script prefix', async (t) => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const wrapper = path.join(fixture.root, 'codex.cmd');
  const script = path.join(fixture.root, 'client.js');
  await writeFile(script, 'if (process.argv[2] !== "--version") process.exit(1); console.log("codex-cli fixture-version");');
  await writeFile(wrapper, `@echo off\n"${process.execPath}" "${script}" %*\n`);
  const reports = await probeClients({ env: { ...fixture.env, PATH: '', HIVEM1ND_CODEX: wrapper }, spawnVersion: true });
  assert.equal(reports.codex.version, 'codex-cli fixture-version');
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
  const inbox = await readdir(path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'inbox', 'executor-shop'));
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
  await assert.rejects(() => start(spawned.context, spawned.file), { code: 'unit_in_use' });
  const journals = await readdir(path.join(spawned.fixture.paths.localDirectory, 'session-starts'));
  const journal = JSON.parse(await readFile(path.join(spawned.fixture.paths.localDirectory, 'session-starts', journals[0])));
  const retry = await consumeStart(spawned.context, journal.requestId);
  assert.equal(retry.result.error.code, 'launch_ambiguous');
  assert.equal(spawned.calls.create, 1);

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
  await linkRepository(context, shop);
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
  assert.equal(writes[0].includes('Model: strong'), false);
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
  adapter.capabilities.create = false;
  const core = await composeCore({
    store: fixture.store,
    paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now,
    projects,
    adapters: { codex: adapter },
    env: fixture.env,
    clients: [],
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
    body: { prompt: 'Complete the task', expectedRevision: revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(denied.status, 503);
  assert.equal(denied.json.error.code, 'client_unavailable');
  const reserved = await readdir(path.join(fixture.paths.localDirectory, 'session-starts')).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  assert.equal(reserved.length, 0);
  projects.push({ name: 'shop', localPath: fixture.root, eligible: true });
  adapter.capabilities.create = true;
  const retried = await jsonCall(core.http.port, 'POST', `/api/v1/units/${UNIT}/session`, {
    token,
    body: { prompt: 'Complete the task', expectedRevision: revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(retried.status, 202);
  assert.equal(retried.json.data.state, 'queued');
  await Promise.all([...fixture.store.sessionLaunches.values()]);
  const reconciled = await jsonCall(core.http.port, 'GET', `/api/v1/session-requests/${retried.json.data.requestId}`, { token });
  assert.equal(reconciled.json.data.state, 'started');
  const queued = await enqueueStart({
    store: fixture.store,
    paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now,
    projects,
    adapters: { codex: adapter },
    principal: { unitId: 'root:master', audience: 'desktop' },
  }, { unitId: UNIT, client: 'codex', runMode: 'chat', stateRevision: revision, targetMachine: 'LAPTOP' });
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
    else if (message.method === 'thread/start') child.respond(message, { result: { thread: { id: 'thread-1' },
      ...(message.params.model ? { model: message.params.model, reasoningEffort: message.params.config?.model_reasoning_effort, sandbox: { type: 'readOnly' } } : {}) } });
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

test('owned native startup passes only its launch capability in the child environment and registers the shared MCP', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const child = liveChild();
  installHandshake(child, { result: { account: { type: 'chatgpt', email: FIXTURE_EMAIL }, requiresOpenaiAuth: true } });
  let receivedEnv;
  let ready = null;
  let revoked = false;
  const grant = 'synthetic-launch-capability';
  const adapter = createNativeAdapter('codex', {
    command: path.join(fixture.root, 'codex.exe'),
    env: fixture.env,
    createNativeLaunch(request) {
      assert.equal(request.unitId, UNIT);
      return {
        env: { HIVEM1ND_SERVICE_BRIDGE: 'synthetic-endpoint', HIVEM1ND_SERVICE_GRANT: grant },
        mcp: { name: 'hivem1nd-relay', command: process.execPath, args: ['owned-cli.mjs'], env: [] },
        ready(id) { ready = id; },
        close() { revoked = true; },
      };
    },
    spawn(_command, _args, options) { receivedEnv = options.env; return child; },
  });
  t.after(() => adapter.close());
  await adapter.create({ cwd: fixture.root, unitId: UNIT });
  assert.equal(ready, 'thread-1');
  assert.equal(receivedEnv.HIVEM1ND_SERVICE_GRANT, grant);
  const started = rpcMethods(child).find((message) => message.method === 'thread/start');
  assert.deepEqual(started.params.config.mcp_servers['hivem1nd-relay'].env_vars, ['HIVEM1ND_SERVICE_BRIDGE', 'HIVEM1ND_SERVICE_GRANT']);
  assert.equal(JSON.stringify(rpcMethods(child)).includes(grant), false);
  await adapter.close();
  assert.equal(revoked, true);
});

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
  assert.equal(child.written.length, beforeNotice + 1);
  assert.deepEqual(rpcMethods(child).find(message => message.id === 90), { jsonrpc: '2.0', id: 90, result: { decision: 'decline' } });
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

test('an unsupported Cursor native permission request is canceled without hanging or allowing', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const child = liveChild();
  child.onRequest(message => {
    if (message.method === 'initialize') child.respond(message, { result: { authMethods: [{ id: 'existing-login' }] } });
    if (message.method === 'authenticate') child.respond(message, { result: {} });
    if (message.method === 'session/new') child.respond(message, { result: { sessionId: 'cursor-owned' } });
  });
  const adapter = createNativeAdapter('cursor', { command: path.join(fixture.root, 'cursor.exe'), env: fixture.env, spawn: () => child });
  t.after(() => adapter.close());
  await adapter.create({ cwd: fixture.root, unitId: UNIT });
  const response = new Promise(resolve => child.onRequest(message => { if (message.id === 'permission-owned') resolve(message); }));
  child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 'permission-owned', method: 'session/request_permission', params: { sessionId: 'cursor-owned', options: [{ optionId: 'allow-once', kind: 'allow_once' }] } })}\n`);
  const completed = await settleOr(response, 500);
  assert.equal(completed.settled, true);
  assert.deepEqual(completed.value.result, { outcome: { outcome: 'cancelled' } });
  assert.equal(completed.value.error, undefined);
  assert.equal(JSON.stringify(completed.value).includes('allow'), false);
});

test('task mode requires an assignment and projects exact task and launch fields', async (t) => {
  const { fixture, context, file, calls } = await world(t);
  await assert.rejects(() => start(context, file, { prompt: '  ' }), { code: 'task_required' });
  await assert.rejects(() => start(context, file, { runMode: 'other' }), { code: 'invalid_body' });
  await assert.rejects(() => start(context, file, { runMode: null }), { code: 'invalid_body' });
  assert.equal(calls.create, 0);
  const taskId = 'project:shop:029';
  const directory = path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'tasks');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, '029.md'), `id: ${taskId}\nstatus: open\ntitle: Assigned\nto-id: ${UNIT}\nfrom-id: root:master\n\n## Request\nWork.\n`);
  const started = await start(context, file, { prompt: null, taskId });
  assert.equal(started.request.runMode, 'task');
  assert.equal(started.request.taskId, taskId);
  const session = await readDetail(context, 'sessions', started.result.sessionId);
  assert.equal(session.runMode, 'task');
  assert.equal(session.taskId, taskId);
  assert.equal(session.launchKind, 'cli');
  await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'sessions', 'later-registration.json'), JSON.stringify({
    kind: 'registration', sessionId: session.id, unit: 'executor-shop', unitId: UNIT, nativeSessionId: session.nativeSessionId,
    client: session.client, machine: session.machine, registeredAt: new Date(fixture.clock.now + 1000).toISOString(), activity: 'busy',
  }));
  assert.equal((await readDetail(context, 'sessions', session.id)).launchKind, 'cli');
  const agent = { ...context, principal: { unitId: UNIT, sessionId: session.id, audience: 'agent' } };
  await assert.rejects(() => completeSessionTask(agent, session.id, { outcome: 'delivered', taskId }), { code: 'task_not_terminal' });
  await writeFile(path.join(directory, '029.md'), `id: ${taskId}\nstatus: review\ntitle: Assigned\nto-id: ${UNIT}\nfrom-id: root:master\n\n## Report\nDelivered.\n`);
  await assert.rejects(() => completeSessionTask(agent, session.id, { outcome: 'delivered', taskId: 'project:shop:030' }), { code: 'invalid_binding' });
  await completeSessionTask(agent, session.id, { outcome: 'delivered', taskId });
  assert.equal((await readDetail(context, 'sessions', session.id)).state, 'registered');
  await context.adapters.codex.taskEnded({ nativeSessionId: session.nativeSessionId });
  assert.equal((await readDetail(context, 'sessions', session.id)).state, 'stopped');
});

test('the owned native task closes only after terminal delivery and its actual turn acknowledgment', async (t) => {
  const { fixture, context, file } = await world(t);
  const child = liveChild();
  installHandshake(child, { result: { account: null, requiresOpenaiAuth: false } });
  let turn = 0;
  child.onRequest((message) => { if (message.method === 'turn/start') child.respond(message, { result: { turn: { id: `task-${++turn}` } } }); });
  const adapter = createNativeAdapter('codex', { command: path.join(fixture.root, 'codex.exe'), env: fixture.env, models: ['strong'], spawn: () => child,
    describe: async () => ({ id: 'codex', connected: true, scopeEnforced: true, models: [{ id: 'strong', title: 'Strong', efforts: ['high'], modes: [] }] }) });
  context.adapters.codex = adapter;
  t.after(() => adapter.close());
  const started = await start(context, file);
  const session = await readDetail(context, 'sessions', started.result.sessionId);
  const notice = (id, threadId = session.nativeSessionId) => child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId, turn: { id, status: 'completed' } } })}\n`);
  await adapter.send({ nativeSessionId: session.nativeSessionId, text: 'Work' });
  notice('task-1');
  await tick();
  assert.equal(child.killed, false);
  await adapter.send({ nativeSessionId: session.nativeSessionId, text: 'Deliver' });
  const agent = { ...context, principal: { unitId: UNIT, sessionId: session.id, audience: 'agent' } };
  await completeSessionTask(agent, session.id, { outcome: 'delivered' });
  notice('task-other');
  notice('task-2', 'other-thread');
  await tick();
  assert.equal(child.killed, false);
  notice('task-2');
  for (let count = 0; count < 100 && context.ownedPids.size; count += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(child.killed, true);
  assert.equal((await readDetail(context, 'sessions', session.id)).state, 'stopped');
  assert.equal((await readFile(file, 'utf8')), state());
});

test('chat mode stays open and manual app registration preserves the canonical unit', async (t) => {
  const { context, file, signaled } = await world(t);
  const before = await readFile(file);
  const started = await start(context, file, { runMode: 'chat', prompt: null });
  const session = await readDetail(context, 'sessions', started.result.sessionId);
  const agent = { ...context, principal: { unitId: UNIT, sessionId: session.id, audience: 'agent' } };
  await assert.rejects(() => completeSessionTask(agent, session.id, { outcome: 'delivered' }), { code: 'invalid_binding' });
  await context.adapters.codex.taskEnded({ nativeSessionId: session.nativeSessionId });
  assert.equal(signaled.length, 0);
  const manual = await registerNative(context, { client: 'codex', unitId: UNIT, nativeSessionId: 'manual-app' });
  assert.equal((await readDetail(context, 'sessions', manual.sessionId)).launchKind, 'manual-app');
  assert.deepEqual(await readFile(file), before);
  await stopSession(context, session.id, { confirmed: true });
  assert.equal(signaled.length, 1);
});

test('cancel before consumption and a cancel racing spawn both settle once after verified stop', async (t) => {
  const prepared = await world(t);
  prepared.context.launchFault = 'prepared';
  await assert.rejects(() => start(prepared.context, prepared.file), { code: 'injected_crash' });
  const journalNames = await readdir(path.join(prepared.fixture.paths.localDirectory, 'session-starts'));
  const journal = JSON.parse(await readFile(path.join(prepared.fixture.paths.localDirectory, 'session-starts', journalNames[0])));
  assert.equal((await cancelStart(prepared.context, journal.requestId)).state, 'canceled');
  prepared.context.launchFault = null;
  assert.equal((await consumeStart(prepared.context, journal.requestId)).result.state, 'canceled');
  assert.equal(prepared.calls.create, 0);

  const racing = await world(t);
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const original = racing.context.adapters.codex.create;
  let requestId;
  racing.context.adapters.codex.create = async (request) => { requestId = request.id; entered(); await gate; return original(request); };
  const first = start(racing.context, racing.file);
  await ready;
  const canceled = cancelStart(racing.context, requestId);
  const marker = path.join(racing.fixture.paths.mind, 'user', 'relay', 'request-cancellations', `${requestId}.json`);
  for (let count = 0; count < 100; count += 1) { if (await readFile(marker).catch(() => null)) break; await new Promise((resolve) => setTimeout(resolve, 10)); }
  release();
  assert.equal((await first).result.state, 'canceled');
  assert.equal((await canceled).state, 'canceled');
  assert.equal(racing.calls.create, 1);
  assert.equal(racing.signaled.length, 1);
  assert.equal((await consumeStart(racing.context, requestId)).result.state, 'canceled');
  assert.equal(racing.calls.create, 1);
});

test('the same uncertain request reconciles after thirty seconds and unavailable stop never claims closure', async (t) => {
  const { fixture, context, file, calls } = await world(t);
  context.receipt = { principalHash: 'fixture', key: randomUUID() };
  const started = await start(context, file);
  fixture.clock.now += 31000;
  const retried = await start(context, file);
  assert.equal(retried.request.id, started.request.id);
  assert.equal(calls.create, 1);
  context.adapters.codex.stop = async () => ({ acknowledged: false });
  await assert.rejects(() => cancelStart(context, started.request.id), { code: 'stop_unavailable' });
  assert.equal((await readStartRequest(context, started.request.id)).result.state, 'canceling');
  assert.equal((await readDetail(context, 'sessions', started.result.sessionId)).state, 'registered');
});

test('Cursor and Claude task failures wait for their real terminal result and native shutdown', async (t) => {
  for (const client of ['cursor', 'claude']) {
    const { fixture, context, file } = await world(t);
    const child = liveChild();
    let nativeId;
    let finishPrompt;
    if (client === 'cursor') child.onRequest((message) => {
      if (message.method === 'initialize') child.respond(message, { result: { authMethods: [{ id: 'existing-login' }] } });
      if (message.method === 'authenticate') child.respond(message, { result: {} });
      const configOptions = [
        { id: 'model', category: 'model', type: 'select', currentValue: 'strong', options: [{ value: 'strong' }] },
        { id: 'effort', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'high' }] },
      ];
      if (message.method === 'session/new') { nativeId = 'cursor-task'; child.respond(message, { result: { sessionId: nativeId, configOptions } }); }
      if (message.method === 'session/set_config_option') child.respond(message, { result: { configOptions } });
      if (message.method === 'session/prompt') finishPrompt = () => child.respond(message, { result: { stopReason: 'end_turn' } });
    });
    await writeFile(file, (await readFile(file, 'utf8')).replace('"client":"codex"', `"client":"${client}"`));
    const spawnNative = (_command, args) => {
      if (client === 'claude') {
        nativeId = args[args.indexOf('--session-id') + 1];
        queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'init', session_id: nativeId, model: 'strong' })}\n`));
        finishPrompt = () => child.stdout.emit('data', `${JSON.stringify({ type: 'result', subtype: 'success', session_id: nativeId })}\n`);
      }
      return child;
    };
    const adapter = createNativeAdapter(client, { command: path.join(fixture.root, `${client}.exe`), env: fixture.env, models: ['strong'],
      describe: async () => ({ id: client, connected: true, scopeEnforced: true, models: [{ id: 'strong', title: 'Strong', efforts: ['high'], modes: [] }] }),
      enforceScope: async launch => ({ verified: true, spawn: () => spawnNative(launch.command, launch.args) }) });
    context.adapters[client] = adapter;
    t.after(() => adapter.close());
    const started = await start(context, file, { client });
    const session = await readDetail(context, 'sessions', started.result.sessionId);
    const send = adapter.send({ nativeSessionId: nativeId, text: 'Finish assigned task' });
    await tick();
    const agent = { ...context, principal: { unitId: UNIT, sessionId: session.id, audience: 'agent' } };
    await completeSessionTask(agent, session.id, { outcome: 'failed' });
    assert.equal(child.killed, false);
    finishPrompt();
    assert.equal((await send).submitted, true);
    for (let count = 0; count < 100 && context.ownedPids.size; count += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await readDetail(context, 'sessions', session.id)).state, 'stopped');
  }
});

test('HTTP start responds while native creation is pending so its exact request can be canceled', async (t) => {
  const { fixture, context, file, calls, signaled, cleanup } = await world(t);
  await linkRepository(context, fixture.root);
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const create = context.adapters.codex.create.bind(context.adapters.codex);
  context.adapters.codex.create = async (request) => { entered(); await gate; return create(request); };
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: context.now, projects: context.projects, adapters: context.adapters, ownedPids: context.ownedPids, env: fixture.env, clients: [] });
  cleanup(() => core.http.close());
  cleanup(() => release());
  const local = await jsonCall(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } });
  const token = local.json.data.token;
  const headers = { 'idempotency-key': randomUUID() };
  const started = await jsonCall(core.http.port, 'POST', `/api/v1/units/${UNIT}/session`, { token, headers, body: { runMode: 'task', taskId: null, prompt: 'Complete the assigned task', expectedRevision: hashBytes(await readFile(file)) } });
  assert.equal(started.status, 202);
  assert.equal(started.json.data.state, 'queued');
  assert.equal(started.json.data.runMode, 'task');
  const enteredNative = await settleOr(ready, 10000);
  if (!enteredNative.settled) {
    release();
    const tracked = await jsonCall(core.http.port, 'GET', `/api/v1/session-requests/${started.json.data.requestId}`, { token });
    assert.fail(`The native start did not begin: ${JSON.stringify(tracked.json)}`);
  }
  const requestId = started.json.data.requestId;
  const read = await settleOr(jsonCall(core.http.port, 'GET', `/api/v1/session-requests/${requestId}`, { token }), 500);
  assert.equal(read.settled, true);
  assert.equal(read.value.json.data.state, 'starting');
  const canceled = jsonCall(core.http.port, 'POST', `/api/v1/session-requests/${requestId}/cancel`, { token, headers: { 'idempotency-key': randomUUID() }, body: {} });
  const marker = path.join(fixture.paths.mind, 'user', 'relay', 'request-cancellations', `${requestId}.json`);
  for (let count = 0; count < 100; count += 1) { if (await readFile(marker).catch(() => null)) break; await new Promise((resolve) => setTimeout(resolve, 10)); }
  release();
  assert.equal((await canceled).json.data.state, 'canceled');
  assert.equal(calls.create, 1);
  assert.equal(signaled.length, 1);
  const reread = await jsonCall(core.http.port, 'GET', `/api/v1/session-requests/${requestId}`, { token });
  assert.equal(reread.json.data.state, 'canceled');
});

test('HTTP shutdown drains a pending start before closing sync and prevents a late native creation', async t => {
  const { fixture, context, file, cleanup } = await world(t);
  await linkRepository(context, fixture.root);
  const adapter = context.adapters.codex;
  const create = adapter.create.bind(adapter);
  const close = adapter.close.bind(adapter);
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  const adapterClosed = Promise.withResolvers();
  adapter.create = async request => { entered.resolve(); await released.promise; return create(request); };
  adapter.close = async () => { await close(); adapterClosed.resolve(); };
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: context.now, projects: context.projects,
    adapters: context.adapters, ownedPids: context.ownedPids, env: fixture.env, clients: [] });
  cleanup(() => core.http.close());
  cleanup(() => released.resolve());
  const local = await jsonCall(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null } });
  const token = local.json.data.token;
  const started = await jsonCall(core.http.port, 'POST', `/api/v1/units/${UNIT}/session`, { token,
    headers: { 'idempotency-key': randomUUID() }, body: { runMode: 'chat', expectedRevision: hashBytes(await readFile(file)) } });
  assert.equal(started.status, 202);
  await entered.promise;
  const closing = core.http.close();
  await adapterClosed.promise;
  assert.equal(core.runtime.closed, false);
  assert.equal((await jsonCall(core.http.port, 'GET', '/api/v1/viewer', { token })).status, 503);
  released.resolve();
  await closing;
  assert.equal(fixture.store.sessionLaunches.size, 0);
  assert.equal(core.runtime.closed, true);
  const request = await readStartRequest(context, started.json.data.requestId, { readOnly: true });
  assert.equal(request.result.state, 'failed');
  assert.equal(request.result.error.code, 'client_unavailable');
  await assert.rejects(adapter.create({}), { code: 'client_unavailable' });
  const writes = fixture.store.writes.length;
  await tick();
  assert.equal(fixture.store.writes.length, writes);
});

test('a running restart reopens a drained injected adapter and terminal shutdown keeps it closed', async t => {
  const { fixture, context, file, calls, cleanup } = await world(t);
  await linkRepository(context, fixture.root);
  const adapter = context.adapters.codex;
  const initial = await adapter.create({ unitId: UNIT });
  const service = await startService({ ...context, env: fixture.env, clients: [], guardPort: 0, userKey: fixture.root });
  cleanup(() => stopService(service, { force: true }));
  assert.equal(await adapter.confirm({ client: 'codex', unitId: UNIT, nativeSessionId: initial.nativeSessionId }), true);
  await restartService(service);
  assert.equal(service.adapters.adapters.codex, adapter);
  assert.equal(await adapter.confirm({ client: 'codex', unitId: UNIT, nativeSessionId: initial.nativeSessionId }), false);
  const restarted = await start(context, file, { runMode: 'chat' });
  assert.equal(restarted.result.state, 'started');
  assert.equal(calls.create, 2);
  await stopService(service, { force: true });
  await assert.rejects(adapter.create({ unitId: UNIT }), { code: 'client_unavailable' });
});

test('shutdown drains a plan start admitted before its body completes before closing sync', async t => {
  const { fixture, context, cleanup } = await world(t);
  const cluster = await linkRepository(context, fixture.root);
  await mkdir(path.join(fixture.paths.mind, 'user', 'tasks'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'tasks', '001.md'), `id: root:001\ntitle: Plan task\nstatus: open\nfrom-id: root:master\nto-id: ${UNIT}\n\n## Request\nFinish the task.\n`);
  const assignment = { kind: 'unit', unitId: UNIT, runsIn: { client: 'codex', model: 'strong', effort: 'high', mode: null } };
  const plan = await createPlan(context, { clusterId: cluster.id, chatId: cluster.chatId, machine: fixture.machine, title: 'Closing plan',
    branch: 'closing-plan', mode: 'planning', tasks: [{ id: 'root:001', title: 'Plan task', assignment }],
    roles: { coordinator: assignment, planner: assignment, builder: assignment, reviewer: assignment },
    expectedChatRevision: (await readDetail(context, 'chats', cluster.chatId)).revision });
  const adapter = context.adapters.codex, create = adapter.create.bind(adapter), close = adapter.close.bind(adapter);
  const entered = Promise.withResolvers(), released = Promise.withResolvers(), adapterClosed = Promise.withResolvers();
  adapter.create = async request => { entered.resolve(); await released.promise; return create(request); };
  adapter.close = async () => { await close(); adapterClosed.resolve(); };
  const core = await composeCore({ ...context, env: fixture.env, clients: [] });
  cleanup(() => core.http.close());
  cleanup(() => released.resolve());
  const local = await jsonCall(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null } });
  const body = Buffer.from(JSON.stringify({ confirmed: true, expectedRevision: plan.revision }));
  const admitted = Promise.withResolvers();
  core.http.server.once('request', admitted.resolve);
  let pending;
  const result = new Promise((resolve, reject) => {
    pending = httpRequest({ host: '127.0.0.1', port: core.http.port, method: 'POST', path: `/api/v1/plans/${plan.id}/run`,
      headers: { host: `127.0.0.1:${core.http.port}`, origin: `http://127.0.0.1:${core.http.port}`, authorization: `Bearer ${local.json.data.token}`,
        'content-type': 'application/json', 'content-length': body.length, 'idempotency-key': randomUUID() } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(Buffer.concat(chunks)) }));
    });
    pending.on('error', reject); pending.write(body.subarray(0, 1));
  });
  cleanup(() => pending.destroy());
  await admitted.promise;
  const closing = core.http.close();
  await adapterClosed.promise;
  pending.end(body.subarray(1));
  const started = await result;
  assert.equal(started.status, 202);
  await entered.promise;
  await tick();
  assert.equal(core.runtime.closed, false);
  released.resolve();
  await closing;
  assert.equal(fixture.store.planLaunches.size, 0);
  assert.equal(core.runtime.closed, true);
  const run = await readRun(context, started.json.data.runId);
  assert.equal(run.alerts.some(alert => alert.kind === 'cleanup'), true);
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
