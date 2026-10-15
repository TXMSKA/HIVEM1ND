import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createNativeAdapter, enqueueStart, stopSession, supervisedBoundary } from '../engine/service/adapters.mjs';
import { answerApproval, readApproval } from '../engine/service/approvals.mjs';
import { createCluster } from '../engine/service/clusters.mjs';
import { directoryIdentity, readRepositoryIdentity } from '../engine/service/cluster-git.mjs';
import { createUnit, setUnitRunsIn } from '../engine/service/units.mjs';
import { connectedClients, createSettingsOwner, mutateMachineSettings, readAgentPermissions, readMachineSettings } from '../engine/service/settings.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { readDetail } from '../engine/service/projection.mjs';
import { createPlan, startPlan } from '../engine/service/plans.mjs';
import { drainRunLaunches, readRun } from '../engine/service/runs.mjs';
import { cleanupRunAttempt, closeRunProcesses, liveRunProcess, stopRunStep, verifyRunProcess } from '../engine/service/run-processes.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { launchBoundary } from '../engine/service/runs-in.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { MODEL, choice, claudeNative, codexNative, cursorNative, fakeChild, fakeOwner, nativeFor, report, until } from './native-fakes.mjs';

const run = promisify(execFile);
async function git(directory, ...args) { return (await run('git', args, { cwd: directory, windowsHide: true, timeout: 10000,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' } })).stdout.trim(); }

function claudeProbe() {
  return fakeChild((message, send) => {
    const response = message.request.subtype === 'initialize' ? { account: { apiKeySource: 'fixture-provider' }, models: [
      { value: 'alias', resolvedModel: MODEL, displayName: 'Observed', supportsEffort: true, supportedEffortLevels: ['low', 'high'] }] }
      : { rate_limits_available: false };
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } });
  });
}

function cursorProbe() {
  return fakeChild((message, send) => {
    if (message.id == null) return;
    const config = [
      { id: 'model-option', category: 'model', type: 'select', currentValue: MODEL, options: [{ value: MODEL, name: 'Observed' }] },
      { id: 'effort-option', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'low' }, { value: 'high' }] },
    ];
    const result = message.method === 'initialize' ? { authMethods: [{ id: 'existing-login' }] }
      : message.method === 'session/new' ? { sessionId: 'catalog-session', configOptions: config }
      : message.method === 'session/set_config_option' ? { configOptions: config } : {};
    send({ jsonrpc: '2.0', id: message.id, result });
  });
}

function codexProbe() {
  return fakeChild((message, send) => {
    if (message.id == null) return;
    const result = message.method === 'account/read' ? { account: { type: 'chatgpt' }, requiresOpenaiAuth: true }
      : message.method === 'model/list' ? { data: [{ model: MODEL, displayName: 'Observed', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: null }
      : {};
    send({ jsonrpc: '2.0', id: message.id, result });
  });
}

test('connected Claude Code and Cursor report a supervised boundary while Codex reports a confined one', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const probes = { claude: claudeProbe, cursor: cursorProbe, codex: codexProbe };
  for (const client of ['claude', 'cursor', 'codex']) {
    const adapter = createNativeAdapter(client, { command: 'known-client', spawn: () => probes[client](), timeoutMs: 1000 }); t.after(() => adapter.close());
    const live = await adapter.describe({ localDirectory: fixture.paths.localDirectory, store: fixture.store });
    assert.equal(live.connected, true, client);
    assert.equal(live.boundary, client === 'codex' ? 'confined' : 'supervised', client);
    assert.equal(live.scopeEnforced, client === 'codex', client);
    const [reported] = await connectedClients({ paths: fixture.paths, store: fixture.store, adapters: { [client]: adapter } });
    assert.equal(reported.boundary, client === 'codex' ? 'confined' : 'supervised', client);
    assert.equal(reported.scopeEnforced, client === 'codex', client);
    assert.equal(launchBoundary(reported), reported.boundary);
  }
});

test('a client that is not connected has no boundary and an unknown boundary fails closed', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  for (const client of ['claude', 'cursor', 'codex']) {
    const adapter = createNativeAdapter(client, { command: 'known-client', spawn: () => { throw new Error('not installed'); }, timeoutMs: 200 }); t.after(() => adapter.close());
    const offline = await adapter.describe({ localDirectory: fixture.paths.localDirectory, store: fixture.store });
    assert.equal(offline.connected, false); assert.equal(offline.boundary, null); assert.equal(offline.scopeEnforced, false);
    assert.equal(launchBoundary(offline), null);
  }
  const base = { id: 'claude', connected: true, scopeEnforced: false };
  assert.equal(launchBoundary({ ...base, boundary: 'supervised' }), 'supervised');
  assert.equal(launchBoundary({ ...base, boundary: 'supervised', connected: false }), null);
  assert.equal(launchBoundary({ ...base, boundary: 'supervised', id: 'codex' }), null, 'only Claude Code and Cursor are supervised');
  assert.equal(launchBoundary({ ...base, boundary: 'supervised', id: 'lyra' }), null);
  assert.equal(launchBoundary({ ...base, boundary: 'invented' }), null);
  assert.equal(launchBoundary({ ...base, boundary: 'supervised', scopeEnforced: true }), null, 'a supervised client is never scope enforced');
  assert.equal(launchBoundary({ ...base, boundary: 'confined' }), null, 'confined needs scopeEnforced');
  assert.equal(launchBoundary({ ...base, boundary: 'confined', scopeEnforced: true, id: 'codex' }), 'confined');
  assert.equal(launchBoundary({ ...base, scopeEnforced: false }), null);
  assert.equal(launchBoundary({ ...base, id: 'codex', scopeEnforced: true }), 'confined', 'an older report keeps the meaning of scopeEnforced');
  assert.equal(launchBoundary(null), null);
});

test('creating an agent and changing Runs in accept a supervised client and refuse one without a boundary', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const adapters = { claude: createNativeAdapter('claude', { describe: async () => report('claude', 'supervised') }),
    cursor: createNativeAdapter('cursor', { describe: async () => report('cursor', null) }) };
  const paths = { ...fixture.paths, origin: path.join(fixture.root, 'origin') };
  const context = { store: fixture.store, paths, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' }, adapters, projects: [] };
  await mkdir(path.join(paths.origin, 'machines', 'DESKTOP'), { recursive: true });
  await writeFile(path.join(paths.origin, 'machines', 'DESKTOP', 'service.json'), JSON.stringify({ state: 'running', heartbeatAt: new Date(context.now()).toISOString() }));
  const cluster = await createCluster(context, { title: 'Shop', machine: 'DESKTOP', parentId: null, link: { kind: 'none' }, members: [], confirmed: true });
  const created = await createUnit(context, { clusterId: cluster.id, role: 'executor', machine: 'DESKTOP', runsIn: choice('claude'), useAsDefault: false, expectedRevision: cluster.revision });
  assert.deepEqual(created.unit.runsIn, choice('claude'));
  await assert.rejects(setUnitRunsIn(context, created.unit.id, { machine: 'DESKTOP', runsIn: choice('cursor'), useAsDefault: false, expectedRevision: created.unit.revision }),
    { code: 'scope_unavailable' }, 'a client with no boundary is refused');
  adapters.cursor.describe = async () => report('cursor', 'supervised');
  const changed = await setUnitRunsIn(context, created.unit.id, { machine: 'DESKTOP', runsIn: choice('cursor'), useAsDefault: false, expectedRevision: created.unit.revision });
  assert.deepEqual(changed.unit.runsIn, choice('cursor'));
  adapters.claude.describe = async () => ({ ...report('claude', 'supervised'), boundary: 'invented' });
  await assert.rejects(setUnitRunsIn(context, created.unit.id, { machine: 'DESKTOP', runsIn: choice('claude'), useAsDefault: false, expectedRevision: changed.unit.revision }), { code: 'scope_unavailable' });
});

// A repository cluster whose agent runs in Claude Code or Cursor, started through the real launch path with a fake native transport.
async function world(t, { client = 'claude', ownProcess = true } = {}) {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const repository = path.join(fixture.root, 'repository'); await mkdir(repository);
  await git(repository, 'init', '--initial-branch=main'); await git(repository, 'config', 'user.name', 'Fixture'); await git(repository, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(repository, 'task.txt'), 'original');
  await git(repository, 'add', '--', 'task.txt'); await git(repository, 'commit', '-m', 'Fixture baseline');
  const unitId = 'project:shop:worker';
  const state = `unit: worker\nunit-id: ${unitId}\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: ${JSON.stringify(choice(client))}\n\nReady.\n`;
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'worker.md'), state);
  const spawned = [], handles = [], natives = [];
  const adapter = createNativeAdapter(client, { command: `${client}-fake`, timeoutMs: 2000, interruptTimeoutMs: 100, describe: async () => report(client, 'supervised'),
    spawn: (command, args, options) => {
      const native = nativeFor[client](7000 + natives.length);
      native.nativeId = args[args.indexOf('--session-id') + 1]; natives.push(native); spawned.push({ command, args, options });
      return native;
    },
    ...ownProcess ? { ownProcess: fakeOwner(handles) } : {},
    createNativeLaunch: () => ({ env: {}, mcp: { name: 'hivem1nd-relay', command: 'node', args: [] }, ready() {}, close() {} }) });
  t.after(() => adapter.close());
  const owner = createSettingsOwner({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: [{ name: 'shop', localPath: repository }],
    bus: createEventBus({ machine: fixture.machine, now: () => fixture.clock.now }), probeAgents: async () => ({}), homeDir: fixture.home, env: process.env,
    adapters: { [client]: adapter }, ownedPids: new Set(), beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() } });
  const context = owner;
  const identity = await readRepositoryIdentity(repository);
  await writeFile(path.join(fixture.paths.localDirectory, 'cluster-links.json'), JSON.stringify({ format: 'hivem1nd-cluster-links-v1', machine: 'DESKTOP', links: {
    'repository:shop': { localPath: repository, machine: 'DESKTOP', identity: await directoryIdentity(repository), repositoryId: identity.id },
  } }));
  const cluster = await createCluster(context, { title: 'Shop', members: [unitId], parentId: null, link: { kind: 'repository', projectId: 'shop' }, machine: 'DESKTOP', confirmed: true });
  const asked = [];
  let decision = 'approve';
  context.notify = async request => {
    asked.push(request);
    const approval = await readApproval(context, request.id);
    await answerApproval(context, request.id, { decision: typeof decision === 'function' ? decision(request) : decision, expectedRevision: approval.revision });
  };
  const launch = async () => {
    const started = await enqueueStart(context, { unitId, runMode: 'chat', stateRevision: hashBytes(await readFile(path.join(fixture.paths.mind, 'user', 'state', 'worker.md'))) });
    return { started, native: natives.at(-1) };
  };
  let counter = 0;
  const ask = async (native, tool, input) => {
    const id = `native-${client}-${++counter}`;
    native.stdout.emit('data', `${JSON.stringify({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: tool, input } })}\n`);
    const reply = await until(() => native.writes.find(message => message.type === 'control_response' && message.response?.request_id === id));
    return reply.response.response.behavior;
  };
  return { fixture, context, repository, unitId, cluster, adapter, spawned, handles, natives, asked, launch, ask, state: () => ({ decision }),
    decide: value => { decision = value; }, permissionFile: path.join(fixture.paths.localDirectory, 'client-permissions.json') };
}

test('a supervised Claude Code launch starts without a sandbox and asks the person before every change and command', async t => {
  const w = await world(t);
  const { started, native } = await w.launch();
  assert.equal(started.result.state, 'started', JSON.stringify(started.result.error));
  assert.equal(w.spawned.length, 1);
  assert.equal(w.handles.length, 1, 'the owned process handle was built for the supervised launch');
  assert.equal(w.spawned[0].options.shell, false);
  assert.equal(w.spawned[0].options.detached, process.platform === 'win32' ? undefined : true);
  const target = path.join(w.repository, 'task.txt');
  assert.equal(await w.ask(native, 'Edit', { file_path: target }), 'allow');
  assert.equal(w.asked.length, 1);
  const approval = await readApproval(w.context, w.asked[0].id);
  assert.equal(approval.alwaysAllowed, false);
  assert.equal(approval.action, 'file.write');
  assert.ok(approval.display.includes(target), 'the person sees the exact path');
  w.decide('deny');
  assert.equal(await w.ask(native, 'Edit', { file_path: target }), 'deny');
  assert.equal(w.asked.length, 2);
  w.decide('approve');
  const command = 'node build.mjs --target "release"';
  assert.equal(await w.ask(native, 'Bash', { command }), 'allow');
  assert.ok((await readApproval(w.context, w.asked.at(-1).id)).display.includes(command), 'the person sees the exact command');
  const asked = w.asked.length;
  assert.equal(await w.ask(native, 'Bash', { command: 'git commit -m "Applied"' }), 'deny', 'a native Git command is never approved');
  assert.equal(await w.ask(native, 'Edit', { file_path: path.join(w.repository, '.git', 'config') }), 'deny', 'a .git write is never approved');
  assert.equal(await w.ask(native, 'Write', { file_path: path.join(w.fixture.paths.mind, 'user', 'note.md') }), 'deny', 'the M1ND folder is never written');
  assert.equal(await w.ask(native, 'Write', { file_path: path.join(w.fixture.paths.localDirectory, 'note.json') }), 'deny', 'the owner-local directory is never written');
  assert.equal(w.asked.length, asked, 'those four never reached the person');
  assert.equal(await readFile(target, 'utf8'), 'original');
});

test('the boundary authorizes one exact approval once, and automatic work only for the bridge itself', async () => {
  const signal = new AbortController().signal;
  const supervised = supervisedBoundary({ mode: 'supervised', processHandle: null, signal });
  assert.equal(supervised.verified, true); assert.equal(supervised.confined, false); assert.equal(supervised.mode, 'supervised');
  assert.equal(Object.isFrozen(supervised), true);
  assert.deepEqual(await supervised.authorize({ once: true, approvalId: 'first' }), { authorized: true });
  assert.deepEqual(await supervised.authorize({ once: true, approvalId: 'first' }), { authorized: false }, 'the same approval is never reused');
  assert.deepEqual(await supervised.authorize({ once: true, approvalId: 'second' }), { authorized: true });
  for (const input of [{ approvalId: 'third' }, { once: true }, { once: true, automatic: true }, undefined]) assert.deepEqual(await supervised.authorize(input), { authorized: false });
  const automatic = supervisedBoundary({ mode: 'automatic', processHandle: null, signal });
  assert.equal(automatic.mode, 'automatic');
  assert.deepEqual(await automatic.authorize({ once: true, automatic: true, approvalId: null }), { authorized: true });
  assert.deepEqual(await automatic.authorize({ once: true, automatic: true, approvalId: null }), { authorized: true });
  for (const input of [{ once: true, approvalId: 'approved' }, { automatic: true }]) assert.deepEqual(await automatic.authorize(input), { authorized: false });
});

test('only the launch\'s own HIVEM1ND tools skip the question; every other tool and a Read outside the folder stay denied', async t => {
  const w = await world(t);
  const { native } = await w.launch();
  const before = w.asked.length;
  assert.equal(await w.ask(native, 'mcp__hivem1nd-relay__session_complete', { outcome: 'delivered' }), 'allow');
  assert.equal(await w.ask(native, 'mcp__hivem1nd-relay__reminder', {}), 'allow');
  assert.equal(w.asked.length, before, 'the own server never asks');
  for (const [tool, input] of [['mcp__other-server__run', {}], ['mcp__hivem1nd-relay', {}], ['mcp__hivem1nd-relayx__run', {}], ['WebFetch', { url: 'https://example.invalid' }],
    ['Read', { file_path: path.join(w.fixture.root, 'outside.txt') }], ['Task', {}]]) {
    assert.equal(await w.ask(native, tool, input), 'deny', tool);
  }
  assert.equal(w.asked.length, before, 'a denied tool never reaches the person either');
});

test('an operation too long to show whole is refused instead of being cut', async t => {
  const w = await world(t);
  const { native } = await w.launch();
  const long = `node -e "${'x'.repeat(2100)}"`;
  assert.equal(await w.ask(native, 'Bash', { command: long }), 'deny');
  assert.equal(w.asked.length, 0);
  const nearly = `node -e "${'x'.repeat(1800)}"`;
  assert.equal(await w.ask(native, 'Bash', { command: nearly }), 'allow');
  assert.equal(w.asked.length, 1);
  assert.ok((await readApproval(w.context, w.asked[0].id)).display.includes(nearly), 'a long command is shown whole');
});

test('a supervised launch without a verified process handle fails closed and leaves no child behind', async t => {
  const w = await world(t, { ownProcess: false });
  const { started } = await w.launch().catch(error => ({ started: { result: { state: 'failed', error: { code: error.code } } } }));
  assert.equal(started.result.state, 'failed');
  assert.equal(started.result.error.code, 'cleanup_unavailable');
  assert.equal(w.spawned.length, 0, 'nothing was spawned');
});

test('the automatic grant lets the same Edit through without a question while Git, .git and M1ND writes stay denied', async t => {
  const w = await world(t);
  const first = await w.launch();
  const target = path.join(w.repository, 'task.txt');
  assert.equal(await w.ask(first.native, 'Edit', { file_path: target }), 'allow');
  assert.equal(w.asked.length, 1, 'supervised by default');
  await stopSession(w.context, first.started.result.sessionId, { confirmed: true });
  // Create the grant through the real desktop permission path.
  const report0 = await readMachineSettings(w.context, 'DESKTOP', 'permissions');
  const granted = await mutateMachineSettings(w.context, 'grant', { machine: 'DESKTOP', unitId: w.unitId, client: 'claude', action: 'native.automatic', expectedRevision: report0.revision });
  assert.equal(granted.status, 201);
  assert.deepEqual(granted.body.permission.actions, ['native.automatic']);
  assert.equal(granted.body.permission.unitId, w.unitId);
  const listed = await readMachineSettings(w.context, 'DESKTOP', 'permissions');
  assert.deepEqual(listed.agentPermissions.map(item => item.id), [granted.body.permission.id]);
  const second = await w.launch();
  assert.equal(second.started.result.state, 'started', JSON.stringify(second.started.result.error));
  w.asked.length = 0;
  w.decide('deny');
  assert.equal(await w.ask(second.native, 'Edit', { file_path: target }), 'allow', 'automatic work needs no answer, and a denial would not matter');
  assert.equal(await w.ask(second.native, 'Bash', { command: 'node build.mjs' }), 'allow');
  assert.equal(await w.ask(second.native, 'Bash', { command: 'git commit -m "Applied"' }), 'deny');
  assert.equal(await w.ask(second.native, 'Bash', { command: 'git push origin main' }), 'deny');
  assert.equal(await w.ask(second.native, 'Edit', { file_path: path.join(w.repository, '.git', 'config') }), 'deny');
  assert.equal(await w.ask(second.native, 'Write', { file_path: path.join(w.fixture.paths.mind, 'user', 'note.md') }), 'deny');
  assert.equal(await w.ask(second.native, 'Write', { file_path: path.join(w.fixture.paths.localDirectory, 'note.json') }), 'deny');
  assert.equal(await w.ask(second.native, 'Write', { file_path: path.join(w.fixture.root, 'outside-the-cluster.txt') }), 'allow', 'automatic work is not confined');
  assert.equal(w.asked.length, 0, 'not one question was asked');
  // Revoking makes the next launch supervised; the running session keeps its mode until it ends.
  const current = await readMachineSettings(w.context, 'DESKTOP', 'permissions');
  await mutateMachineSettings(w.context, 'revoke', { machine: 'DESKTOP', expectedRevision: current.revision }, granted.body.permission.id);
  assert.deepEqual(await readAgentPermissions(w.context), []);
  assert.equal(await w.ask(second.native, 'Edit', { file_path: target }), 'allow', 'the running session stays automatic');
  assert.equal(w.asked.length, 0);
  await stopSession(w.context, second.started.result.sessionId, { confirmed: true });
  const third = await w.launch();
  w.decide('approve');
  assert.equal(await w.ask(third.native, 'Edit', { file_path: target }), 'allow');
  assert.equal(w.asked.length, 1, 'the next launch asks again');
});

test('automatic work is granted per agent and client only, once, and only for an agent that runs in that client', async t => {
  const w = await world(t);
  const report0 = await readMachineSettings(w.context, 'DESKTOP', 'permissions');
  const input = { machine: 'DESKTOP', unitId: w.unitId, client: 'claude', action: 'native.automatic', expectedRevision: report0.revision };
  await assert.rejects(mutateMachineSettings(w.context, 'grant', { ...input, client: 'codex' }), { code: 'invalid_body' });
  await assert.rejects(mutateMachineSettings(w.context, 'grant', { ...input, action: 'git.commit' }), { code: 'invalid_body' });
  await assert.rejects(mutateMachineSettings(w.context, 'grant', { ...input, expectedRevision: null }), { code: 'invalid_body' });
  await assert.rejects(mutateMachineSettings(w.context, 'grant', { ...input, unitId: 'project:shop:missing' }), { code: 'unit_not_found' });
  await assert.rejects(mutateMachineSettings(w.context, 'grant', { ...input, client: 'cursor' }), { code: 'scope_unresolved' }, 'the agent runs in Claude Code, not Cursor');
  await assert.rejects(mutateMachineSettings({ ...w.context, principal: { audience: 'phone', unitId: 'root:master' } }, 'grant', input), { code: 'forbidden' });
  const granted = await mutateMachineSettings(w.context, 'grant', input);
  assert.equal(granted.status, 201);
  const again = await mutateMachineSettings(w.context, 'grant', { ...input, expectedRevision: granted.body.revision });
  assert.equal(again.status, 200);
  assert.equal(again.body.permission.id, granted.body.permission.id, 'granting twice keeps one grant');
  assert.equal((await readAgentPermissions(w.context)).length, 1);
  // A Git permission list and an automatic grant coexist, and the grant never counts as Git authority.
  await writeFile(w.permissionFile, JSON.stringify({ permissions: [...(await readAgentPermissions(w.context)), { id: randomUUID(), machine: 'DESKTOP', client: 'claude',
    actions: ['git.commit', 'git.push'], scope: 'hivem1nd-started-sessions', grantedAt: new Date(w.fixture.clock.now).toISOString(), grantedBy: 'root:master' }] }));
  const { started, native } = await w.launch();
  assert.equal(started.result.state, 'started');
  assert.equal(await w.ask(native, 'Bash', { command: 'git commit -m "Applied"' }), 'deny', 'automatic work is not Git authority');
});

test('a supervised Cursor launch asks through the ACP permission request and a plain tool is denied', async t => {
  const w = await world(t, { client: 'cursor' });
  const { started, native } = await w.launch();
  assert.equal(started.result.state, 'started', JSON.stringify(started.result.error));
  assert.equal(w.handles.length, 1);
  const target = path.join(w.repository, 'task.txt');
  let counter = 0;
  const request = async (kind, extra) => {
    const id = `acp-${++counter}`;
    native.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id, method: 'session/request_permission', params: { sessionId: 'owned',
      toolCall: { kind, ...extra }, options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] } })}\n`);
    const reply = await until(() => native.writes.find(message => message.id === id && message.result));
    return reply.result.outcome.optionId;
  };
  assert.equal(await request('edit', { locations: [{ path: target }] }), 'yes');
  assert.equal(w.asked.length, 1);
  w.decide('deny');
  assert.equal(await request('edit', { locations: [{ path: target }] }), 'no');
  assert.equal(await request('execute', { rawInput: { command: 'git commit -m "Applied"' } }), 'no');
  assert.equal(w.asked.length, 2);
});

// A plan whose every role runs in one real-protocol client over a fake transport, started through the real Run path.
async function planWorld(t, client) {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const natives = [], handles = [], spawned = [];
  const adapter = createNativeAdapter(client, { command: `${client}-fake`, timeoutMs: 2000, describe: async () => report(client, client === 'codex' ? 'confined' : 'supervised'),
    spawn: (command, args, options) => {
      const native = nativeFor[client](9000 + natives.length); native.nativeId = args[args.indexOf('--session-id') + 1]; natives.push(native); spawned.push({ command, args, options });
      return native;
    }, ownProcess: fakeOwner(handles) });
  const paths = { ...fixture.paths, origin: path.join(fixture.root, 'origin') };
  await mkdir(path.join(paths.origin, 'machines', fixture.machine), { recursive: true });
  await writeFile(path.join(paths.origin, 'machines', fixture.machine, 'service.json'), JSON.stringify({ state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() }));
  const context = { paths, store: fixture.store, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' },
    projects: [], adapters: { [client]: adapter }, ownedPids: new Set(), homeDir: fixture.home, env: fixture.env, platform: fixture.platform };
  const cluster = await createCluster(context, { title: 'Planning', parentId: null, link: { kind: 'none' }, members: [], machine: fixture.machine, confirmed: true });
  const unit = (await createUnit(context, { clusterId: cluster.id, role: 'executor', machine: fixture.machine, runsIn: choice(client), useAsDefault: false, expectedRevision: cluster.revision })).unit;
  const taskId = 'root:001';
  await mkdir(path.join(paths.mind, 'user', 'tasks'), { recursive: true });
  await writeFile(path.join(paths.mind, 'user', 'tasks', '001.md'), `id: ${taskId}\ntitle: Actual task\nstatus: open\nfrom-id: root:master\nto-id: ${unit.id}\nfiles: ["result.txt"]\n\n## Request\nKeep the accepted draft.\n`);
  const assignment = { kind: 'unit', unitId: unit.id, runsIn: choice(client) };
  const chat = await readDetail(context, 'chats', (await readDetail(context, 'groups', cluster.id)).chatId);
  const input = { clusterId: cluster.id, chatId: chat.id, machine: fixture.machine, title: 'Actual plan', branch: 'actual-plan', mode: 'planning',
    tasks: [{ id: taskId, title: 'Actual task', assignment }], roles: { coordinator: assignment, planner: assignment, builder: assignment, reviewer: assignment }, expectedChatRevision: chat.revision };
  t.after(async () => { await drainRunLaunches(context); await closeRunProcesses(context).catch(() => {}); await adapter.close(); });
  return { fixture, context, input, natives, handles, spawned, adapter };
}

test('a plan with a Claude Code task and a plan with a Codex task both start and are owned by a process handle', async t => {
  for (const client of ['claude', 'codex']) await t.test(client, async t => {
    const w = await planWorld(t, client);
    const plan = await createPlan(w.context, w.input);
    const started = await startPlan(w.context, plan.id, { confirmed: true, expectedRevision: plan.revision });
    await drainRunLaunches(w.context);
    const run = await readRun(w.context, started.runId), attempt = run.attempts[0];
    assert.ok(attempt.sessionId, `${client} bound its plan actor: ${JSON.stringify(run.alerts)}`);
    assert.equal(w.spawned.length, 1);
    assert.equal(w.handles.length, 1, 'one owned handle for the plan actor');
    assert.equal(w.spawned[0].options.detached, process.platform === 'win32' ? undefined : true);
    assert.equal(liveRunProcess(w.context, run.id, attempt.id), true, 'the run supervisor owns that handle');
    assert.equal(await verifyRunProcess(w.context, run.id, attempt.id), true);
    const closed = await cleanupRunAttempt(w.context, run.id, attempt.id, { stop: true });
    assert.deepEqual(closed, { exited: true, cleaned: true });
    assert.equal(w.natives[0].killed, true, 'the owned stop ended the client');
    assert.equal(await w.handles[0].handle.verify(), false);
  });
});

test('Stop the step of a plan actor reaches the Claude Code turn through the plan handle', async t => {
  const w = await planWorld(t, 'claude');
  const plan = await createPlan(w.context, w.input);
  const started = await startPlan(w.context, plan.id, { confirmed: true, expectedRevision: plan.revision });
  await drainRunLaunches(w.context);
  const run = await readRun(w.context, started.runId), attempt = run.attempts[0];
  await stopRunStep(w.context, run.id, attempt.id);
  const interrupts = w.natives[0].writes.filter(message => message.type === 'control_request' && message.request?.subtype === 'interrupt');
  assert.equal(interrupts.length, 1, 'the plan step stop interrupted the Claude Code turn');
  await cleanupRunAttempt(w.context, run.id, attempt.id, { stop: true });
});

test('stopping a supervised session ends its whole process tree through the owned handle', async t => {
  const w = await world(t);
  const { started, native } = await w.launch();
  assert.equal(native.killed, undefined);
  await stopSession(w.context, started.result.sessionId, { confirmed: true });
  assert.equal(native.killed, true);
  assert.equal(await w.handles[0].handle.verify(), false);
  assert.equal((await w.handles[0].handle.cleanup()).closed, true);
});
