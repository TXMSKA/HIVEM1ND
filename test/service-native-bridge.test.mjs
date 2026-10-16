import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import net, { createServer as createNetServer } from 'node:net';
import { mkdir, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createNativeLaunch, dispatchNative, handleNativeHook, initializeNativeEntry } from '../engine/service/bridge.mjs';
import { closeAttachedServices, connectNativeService, nativeHook, openRelayOperations, relayPolicy, request, subscribe } from '../engine/service/client.mjs';
import { createPersonRelay } from '../engine/relay/person.mjs';
import { runCli } from '../cli/index.mjs';
import { createText, moveEditor, readEditor, writeAttachments } from '../engine/service/editors.mjs';
import { prepareRepositoryClusters } from '../engine/service/clusters.mjs';
import { consumeStart, createNativeAdapter, enqueueStart, registerNative } from '../engine/service/adapters.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { composeCore, runConfiguredService, startService, stopService } from '../engine/service/service.mjs';
import { commitChange, createStore } from '../engine/service/store.mjs';
import { machineRecordPath, serializeMachineRecord } from '../engine/records.mjs';
import { runRelayHook } from '../engine/relay/hooks.mjs';
import { createRelayWakeController } from '../engine/relay/wake.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const UNIT = 'root:one';
const NATIVE = 'owned-protocol-session';

async function world(t, client = 'codex', fresh = false, configured = false) {
  const fixture = await makeCoreFixture();
  const projects = [{ name: 'shop', localPath: path.join(fixture.root, 'repository') }];
  await mkdir(projects[0].localPath, { recursive: true });
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'one.md'), 'unit: one\nunit-id: root:one\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: {"client":"codex","model":"strong","effort":"high","mode":null}\n\nReady.\n');
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects, principal: { audience: 'desktop', unitId: 'root:master' } };
  const editor = await createText(context, { project: 'shop', path: 'docs/note.json', document: { title: 'Owned', rev: 0, pages: [{ k: 'body', en: 'Original' }] } });
  await writeAttachments(context, editor.id, { attached: [UNIT], expectedRevision: null });
  const foreign = await createText(context, { project: 'shop', path: 'docs/foreign.json', document: { title: 'Foreign', rev: 0, pages: [{ k: 'body', en: 'Private foreign body' }] } });
  let service;
  let launch;
  const ownedPids = new Set();
  const adapters = { [client]: { async confirm(proof) { return proof.nativeSessionId === NATIVE && proof.unitId === UNIT && proof.client === client; } } };
  if (fresh) {
    const script = path.join(fixture.root, 'owned-native-protocol.mjs');
    await writeFile(script, `import { createInterface } from 'node:readline';
${configured ? `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(path.join(fixture.root, 'native-cwd.txt'))}, process.cwd());` : ''}
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line); if (message.id == null) continue;
  let result = {};
  if (message.method === 'account/read') result = { account: { type: 'chatgpt', email: 'fixture@example.com' }, requiresOpenaiAuth: true };
  if (message.method === 'thread/start') result = { thread: { id: '${NATIVE}' }, model: message.params.model, reasoningEffort: message.params.config?.model_reasoning_effort, sandbox: { type: 'readOnly' } };
  if (message.method === 'turn/start') result = { turn: { id: 'owned-fixture-turn' } };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
}
`);
    adapters[client] = createNativeAdapter(client, {
      command: process.execPath, args: [script], env: fixture.env,
      describe: async () => ({ id: client, connected: true, scopeEnforced: true, models: [{ id: 'strong', title: 'Strong', efforts: ['high'], modes: [] }] }),
      createNativeLaunch(request) { launch = createNativeLaunch(service.bridge, request); return launch; },
      onNativeRegistered({ request, registration }) { return initializeNativeEntry({ controller: service.adopted.controller.wake, bridge: service.bridge, request, registration }); },
    });
  } else ownedPids.add(4242);
  const probe = createNetServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const guardPort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const common = { store: fixture.store, adapters, ownedPids, now: () => fixture.clock.now, userKey: `native-${randomUUID()}`, guardPort, env: fixture.env };
  if (configured) {
    await configureProjects(fixture, projects);
    service = await runConfiguredService({ ...common, mindPath: fixture.paths.mind, platform: fixture.platform, homeDir: fixture.home, cosmicPath: fixture.paths.cosmic });
  } else service = await startService({ ...common, paths: fixture.paths, projects });
  // A configured service retains itself while a viewer or a launch is open; teardown closes what the test opened.
  t.after(async () => { await stopService(service, { force: configured }); await dispose(fixture); });
  if (fresh) return { fixture, service, projects, editor, ownedPids, adapters, get launch() { return launch; } };
  const registration = await registerNative(context, { client, nativeSessionId: NATIVE, unitId: UNIT });
  const controller = await createRelayWakeController({ mindPath: fixture.paths.mind, hostname: fixture.machine, clock: { now: () => fixture.clock.now, sleep: () => Promise.resolve() }, sink: async () => ({ status: 'not_submitted' }) });
  await controller.enable({ unit: 'one', nativeSessionId: NATIVE, client, machine: fixture.machine, windowHours: 4 });
  const policies = path.join(fixture.paths.mind, 'user', 'relay', 'wake', 'policies');
  const policyFile = path.join(policies, (await readdir(policies))[0]);
  const policy = JSON.parse(await readFile(policyFile, 'utf8'));
  await mkdir(path.join(fixture.paths.localDirectory, 'session-starts'), { recursive: true });
  await writeFile(path.join(fixture.paths.localDirectory, 'session-starts', `${randomUUID()}.json`), JSON.stringify({ sessionId: registration.sessionId, pid: 4242 }));
  launch = createNativeLaunch(service.bridge, { unitId: UNIT, client });
  return { fixture, service, launch, policy, policyFile, editor, foreign, projects, registration };
}

async function configureProjects(fixture, projects) {
  const origin = path.join(fixture.root, 'configured-origin');
  await mkdir(origin, { recursive: true });
  await mkdir(path.dirname(machineRecordPath(fixture.paths.mind, fixture.machine)), { recursive: true });
  await writeFile(machineRecordPath(fixture.paths.mind, fixture.machine), serializeMachineRecord({ machine: fixture.machine, mind: fixture.paths.mind, setup: 'done', paths: [{ name: 'web', path: fixture.root }, ...projects.map(project => ({ name: project.name, path: project.localPath }))] }));
  await writeFile(path.join(fixture.paths.mind, 'user', 'routes.md'), '## Environments\n- web: shop, remote\n\n## Projects\n- shop (web)\n- remote (web)\n');
  await writeFile(fixture.paths.configFile, JSON.stringify({ format: 'hivem1nd-service-config-v1', mindPath: fixture.paths.mind, machine: fixture.machine, origin: { kind: 'folder', path: origin }, stagingPath: fixture.paths.staging, port: 0 }));
}

function stdio(env, mindPath, requests) {
  const cli = fileURLToPath(new URL('../cli/index.mjs', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'relay', 'mcp', '--mind-path', mindPath, '--client', 'codex'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    const errors = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('The owned stdio child timed out.')); }, 10000);
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(Buffer.concat(errors).toString('utf8'))); return; }
      resolve(Buffer.concat(output).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
    });
    child.stdin.end(requests.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  });
}

test('a launch grant forwards an actual stdio child to the agent-only service and preserves editor idempotency', async (t) => {
  const { fixture, service, launch, editor, foreign, projects } = await world(t);
  await assert.rejects(() => dispatchNative(launch.env.HIVEM1ND_SERVICE_BRIDGE, launch.env.HIVEM1ND_SERVICE_GRANT, 'attach'), { code: 'native_login_unverified' });
  launch.ready(NATIVE);
  const env = { ...process.env, ...fixture.env, ...launch.env };
  const native = await connectNativeService({ env, client: 'codex', nativeSessionId: NATIVE });
  assert.equal(service.credentials.verify(native.token).audience, 'agent');
  assert.notEqual(native.token, service.bootstrap.secret);
  const edit = { resourceId: editor.id, k: 'body', lang: 'en', start: 0, end: 8, expectedText: 'Original', replacement: 'Updated', expectedRevision: editor.revision, requestId: randomUUID() };
  const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const lines = await stdio(env, fixture.paths.mind, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    call(2, 'void_open', { resourceId: editor.id }),
    call(3, 'void_replace_range', edit),
    call(4, 'void_replace_range', edit),
    call(5, 'void_open', { resourceId: foreign.id }),
  ]);
  assert.equal(lines[0].result.protocolVersion, '2025-11-25');
  assert.equal(lines[1].result.isError, false);
  assert.equal(lines[2].result.isError, false);
  assert.deepEqual(JSON.parse(lines[3].result.content[0].text), JSON.parse(lines[2].result.content[0].text));
  assert.equal(lines[4].result.isError, true);
  assert.equal(JSON.stringify(lines).includes('Private foreign body'), false);
  const document = JSON.parse(await readFile(path.join(projects[0].localPath, 'docs', 'note.json'), 'utf8'));
  assert.equal(document.pages[0].en, 'Updated');
  assert.equal(document.rev, 1);
  await assert.rejects(() => connectNativeService({ env, client: 'cursor' }), { code: 'forbidden' });
  launch.close();
  await assert.rejects(() => connectNativeService({ env, client: 'codex' }), { code: 'unauthorized' });
  native.close();
});

test('a fresh GUI start enters Relay once before its first stdio editor call, without a preexisting wake policy', async (t) => {
  const state = await world(t, 'codex', true);
  const { fixture, service, projects, editor, ownedPids, adapters } = state;
  const file = path.join(fixture.paths.mind, 'user', 'state', 'one.md');
  const context = { store: fixture.store, paths: service.runtime.paths, projects, ownedPids, adapters, credentials: service.credentials, now: () => fixture.clock.now, beat: service.runtime.beat, principal: { audience: 'desktop', unitId: 'root:master' } };
  const started = await enqueueStart(context, { unitId: UNIT, client: 'codex', runMode: 'chat', stateRevision: hashBytes(await readFile(file)) });
  assert.equal(started.result.state, 'started', JSON.stringify(started.result));
  const directory = path.join(fixture.paths.mind, 'user', 'relay', 'wake', 'policies');
  // A wake update stages a temporary file beside the committed policy before its atomic rename.
  await writeFile(path.join(directory, '.policy.pending.tmp'), 'Pending replacement');
  const names = (await readdir(directory)).filter(name => name.endsWith('.json'));
  assert.equal(names.length, 1);
  assert.match(names[0], /^[a-f0-9]{64}\.json$/);
  const policyFile = path.join(directory, names[0]);
  const before = JSON.parse(await readFile(policyFile, 'utf8'));
  assert.equal(before.kind, 'relay-wake-policy');
  assert.equal(before.binding.unitId, UNIT);
  assert.equal(before.binding.nativeSessionId, NATIVE);
  assert.equal(before.binding.client, 'codex');
  assert.equal(before.binding.machine, fixture.machine);
  assert.equal(Date.parse(before.deadlineAt) - Date.parse(before.startedAt), 4 * 3600000);
  assert.equal(before.maxHandoffs, 20);
  const lines = await stdio({ ...process.env, ...fixture.env, ...state.launch.env }, fixture.paths.mind, [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'void_open', arguments: { resourceId: editor.id } } }]);
  assert.equal(lines[0].result.isError, false);
  assert.equal((await consumeStart(context, started.request.id)).replayed, true);
  fixture.clock.now = Date.parse(before.deadlineAt) + 1;
  await consumeStart(context, started.request.id);
  const after = JSON.parse(await readFile(policyFile, 'utf8'));
  assert.equal(after.deadlineAt, before.deadlineAt);
  assert.equal(after.generation, before.generation);
  await assert.rejects(() => connectNativeService({ env: state.launch.env, client: 'codex' }), { code: 'stop_unavailable' });
});

test('ordinary configured startup loads exact machine project paths for native launches and HTTP editors', async (t) => {
  const state = await world(t, 'codex', true, true);
  const { fixture, service, projects } = state;
  const origin = new URL(`http://127.0.0.1:${service.http.port}`);
  const login = await request({ origin, token: service.bootstrap.secret, closed: false }, { path: '/api/v1/auth/local', body: { embedded: false, hostOrigin: null, look: null, language: null } });
  assert.equal(login.status, 201);
  const desktop = { origin, token: login.json.data.token, closed: false };
  let started = await request(desktop, { path: `/api/v1/units/${UNIT}/session`, headers: { 'idempotency-key': randomUUID() }, body: { runMode: 'chat', expectedRevision: hashBytes(await readFile(path.join(fixture.paths.mind, 'user', 'state', 'one.md'))) } });
  assert.equal(started.status, 202, JSON.stringify(started.json));
  // The route queues the start; the same request reports the verified launch. The ceiling only covers a loaded suite.
  for (const deadline = Date.now() + 30000; ['queued', 'starting'].includes(started.json.data.state) && Date.now() < deadline;) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    started = await request(desktop, { method: 'GET', path: `/api/v1/session-requests/${started.json.data.requestId}` });
  }
  assert.equal(started.json.data.state, 'started', JSON.stringify(started.json));
  assert.equal(path.dirname(await readFile(path.join(fixture.root, 'native-cwd.txt'), 'utf8')), path.join(fixture.paths.localDirectory, 'sessions'));
  const created = await request(desktop, { path: '/api/v1/void/texts', headers: { 'idempotency-key': randomUUID() }, body: { project: 'shop', path: 'docs/configured.json', document: { title: 'Configured', rev: 0, pages: [{ k: 'body', en: 'Registered repository' }] }, attached: [UNIT] } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const lines = await stdio({ ...process.env, ...fixture.env, ...state.launch.env }, fixture.paths.mind, [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'void_open', arguments: { resourceId: created.json.data.id } } }]);
  assert.equal(lines[0].result.isError, false);
  assert.match(await readFile(path.join(projects[0].localPath, 'docs', 'configured.json'), 'utf8'), /Registered repository/);
  const absent = await request(desktop, { path: '/api/v1/void/texts', headers: { 'idempotency-key': randomUUID() }, body: { project: 'remote', path: 'docs/no.json', document: { title: 'Unavailable', rev: 0, pages: [] } } });
  assert.equal(absent.status, 409, JSON.stringify(absent.json));
  assert.equal(absent.json.error.code, 'project_unavailable');
  assert.deepEqual(service.options.projects.find(project => project.name === 'remote'), { name: 'remote', localPath: null, eligible: false });
  assert.equal(service.runtime.sync.projects.find(project => project.name === 'shop').localPath, projects[0].localPath);
});

test('configured project paths preserve an explicit empty override and leave missing machine mappings unavailable', async (t) => {
  const fixture = await makeCoreFixture();
  const options = { store: fixture.store, mindPath: fixture.paths.mind, platform: fixture.platform, homeDir: fixture.home, cosmicPath: fixture.paths.cosmic, env: fixture.env, now: () => fixture.clock.now, userKey: `configured-${randomUUID()}`, guardPort: 0 };
  let service;
  t.after(async () => { await stopService(service); await dispose(fixture); });
  await configureProjects(fixture, [{ name: 'shop', localPath: path.join(fixture.root, 'absent-repository') }]);
  service = await runConfiguredService({ ...options, projects: [] });
  assert.deepEqual(service.options.projects, []);
  assert.deepEqual(fixture.store.projects, []);
  await stopService(service);
  service = await runConfiguredService(options);
  assert.deepEqual(service.options.projects, [{ name: 'shop', localPath: null, eligible: false }, { name: 'remote', localPath: null, eligible: false }]);
  await stopService(service);
  await unlink(machineRecordPath(fixture.paths.mind, fixture.machine));
  service = await runConfiguredService(options);
  assert.equal(service.options.projects.every(project => project.eligible === false && project.localPath === null), true);
});

for (const entry of ['composeCore', 'startService']) test(`${entry} loads accepted cluster links before cold recovery of committed and interrupted editor moves`, async t => {
  for (const fault of [null, { afterPrepared: true }, { afterRenames: 1 }, { beforeReceipt: true }]) await t.test(JSON.stringify(fault), async sub => {
    const fixture = await makeCoreFixture();
    let service;
    sub.after(async () => {
      if (entry === 'startService') await stopService(service, { force: true });
      else await service?.http.close();
      await dispose(fixture);
    });
    const projects = ['shop', 'blog'].map(name => ({ name, localPath: path.join(fixture.root, name) }));
    for (const project of projects) await mkdir(project.localPath);
    const context = { store: fixture.store, paths: fixture.paths, projects, now: () => fixture.clock.now,
      principal: { audience: 'desktop', unitId: 'root:master' },
      gitRunner: async () => { throw Object.assign(new Error('Git is not installed in this fixture.'), { code: 'git_unavailable' }); } };
    const prepared = await prepareRepositoryClusters(context, projects);
    await commitChange(context, { id: randomUUID(), entries: prepared.entries, events: prepared.events });
    const text = await createText(context, { project: 'shop', path: 'docs/note.json', document: { title: 'Retained', pages: [{ k: 'body', en: 'Original', es: 'Original' }] } });
    const source = await readFile(path.join(projects[0].localPath, text.path));
    const input = { project: 'blog', path: 'docs/moved.json', folderId: null, confirmedRepositoryChange: true,
      expectedRevision: text.revision, expectedCommentsRevision: text.commentsRevision,
      expectedAttachmentRevision: text.attachmentRevision, expectedLibraryRevision: text.libraryRevision };
    fixture.store.fault = fault;
    if (fault) await assert.rejects(() => moveEditor(context, text.id, input), { code: 'injected_crash' });
    else await moveEditor(context, text.id, input);
    const store = createStore({ root: fixture.root, confineRoot: fixture.root, mindPath: fixture.paths.mind,
      localDirectory: fixture.paths.localDirectory, now: context.now });
    store.aclRunner = fixture.store.aclRunner;
    assert.deepEqual(store.projects, []);
    const options = { store, paths: fixture.paths, now: context.now, env: fixture.env, clients: [],
      gitRunner: context.gitRunner, probeAgents: async () => ({}), guardPort: 0, userKey: fixture.root };
    service = await (entry === 'startService' ? startService(options) : composeCore(options));
    assert.deepEqual(store.projects.map(project => project.name).sort(), ['blog', 'shop']);
    await assert.rejects(readFile(path.join(projects[0].localPath, text.path)), { code: 'ENOENT' });
    assert.deepEqual(await readFile(path.join(projects[1].localPath, input.path)), source);
    const journalDirectory = path.join(fixture.paths.localDirectory, 'transactions');
    const journals = await Promise.all((await readdir(journalDirectory)).map(async name => JSON.parse(await readFile(path.join(journalDirectory, name)))));
    assert.ok(journals.every(journal => journal.phase === 'committed'));
    assert.equal(service.runtime.lastError, null);
  });
});

test('configured project paths reject ambiguous identities, relative mappings, and linked repository ancestors', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const repository = path.join(fixture.root, 'registered-repository');
  await mkdir(repository);
  const options = { store: fixture.store, mindPath: fixture.paths.mind, platform: fixture.platform, homeDir: fixture.home, cosmicPath: fixture.paths.cosmic, env: fixture.env };
  await configureProjects(fixture, [{ name: 'shop', localPath: repository }, { name: 'SHOP', localPath: repository }]);
  await assert.rejects(() => runConfiguredService(options), { code: 'project_unavailable' });
  await configureProjects(fixture, [{ name: 'shop', localPath: repository }]);
  await writeFile(path.join(fixture.paths.mind, 'user', 'routes.md'), '## Projects\n- shop (web)\n- SHOP (web)\n');
  await assert.rejects(() => runConfiguredService(options), { code: 'project_unavailable' });
  await configureProjects(fixture, [{ name: 'shop', localPath: '../registered-repository' }]);
  await assert.rejects(() => runConfiguredService(options), { code: 'invalid_path' });
  const link = path.join(fixture.root, 'linked-repository');
  await symlink(repository, link, process.platform === 'win32' ? 'junction' : 'dir');
  await mkdir(path.join(repository, 'child'));
  await configureProjects(fixture, [{ name: 'shop', localPath: path.join(link, 'child') }]);
  await assert.rejects(() => runConfiguredService(options), { code: 'unsafe_path' });
});

test('an explicitly ineligible descriptor blocks new and existing editors even when its repository exists', async (t) => {
  const { fixture, projects, editor } = await world(t);
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' }, projects: projects.map(project => ({ ...project, eligible: false })) };
  await assert.rejects(() => readEditor(context, editor.id), { status: 409, code: 'project_unavailable' });
  await assert.rejects(() => createText(context, { project: 'shop', path: 'docs/denied.json', document: { title: 'Denied', rev: 0, pages: [] } }), { status: 409, code: 'project_unavailable' });
  assert.equal(await readFile(path.join(projects[0].localPath, 'docs', 'note.json'), 'utf8').then(bytes => bytes.includes('Original')), true);
  await assert.rejects(() => readFile(path.join(projects[0].localPath, 'docs', 'denied.json')), { code: 'ENOENT' });
});

test('hook activity uses only the shared controller and cannot change identity or renew a policy', async () => {
  const calls = [];
  const controller = {
    async findEnabledBinding() { return { unit: 'one' }; },
    async observeActivity(binding, state) { calls.push({ binding, state }); },
    async endSession(binding) { calls.push({ ended: binding }); },
  };
  const credentials = { revokeSession(id) { calls.push({ revoked: id }); } };
  const binding = { unitId: UNIT, nativeSessionId: NATIVE, client: 'claude', machine: 'DESKTOP', sessionId: randomUUID() };
  await handleNativeHook({ controller, credentials, binding: { ...binding, event: 'PreToolUse' } });
  assert.equal(calls[0].state.activity, 'busy');
  await handleNativeHook({ controller, credentials, binding: { ...binding, event: 'SessionEnd' } });
  assert.equal(calls[1].ended.unitId, UNIT);
  assert.equal(calls[2].revoked, binding.sessionId);
  await assert.rejects(() => handleNativeHook({ controller, credentials, binding: { ...binding, event: 'beforeSubmitPrompt' } }), { code: 'service_unavailable' });
});

test('a Relay tool call keeps its verified window open and a hook reports the ended window once without reviving it', async t => {
  const w = await world(t, 'claude');
  w.launch.ready(NATIVE);
  const env = { ...w.launch.env, CLAUDE_CODE_SESSION_ID: NATIVE, CLAUDE_CODE_HOST_SESSION_ID: 'verified-host' };
  const client = await connectNativeService({ env, client: 'claude' });
  t.after(() => client.close());
  const binding = { unit: 'one', unitId: UNIT, nativeSessionId: NATIVE, client: 'claude', machine: w.fixture.machine };
  const before = await w.service.adopted.controller.wake.status(binding);
  w.fixture.clock.now += 3600000;
  const received = await client.callTool('list_inbox', {});
  assert.equal(received.isError, false);
  assert.equal(JSON.parse(received.content[0].text).data.wakeNotice, undefined);
  const renewed = await w.service.adopted.controller.wake.status(binding);
  assert.equal(Date.parse(renewed.deadlineAt), w.fixture.clock.now + 4 * 3600000);
  assert.ok(renewed.deadlineAt > before.deadlineAt);
  w.fixture.clock.now += 5 * 3600000;
  const ended = await nativeHook({ env, nativeSessionId: NATIVE, client: 'claude', event: 'UserPromptSubmit' });
  assert.match(ended.wakeNotice, /window passed without activity/);
  assert.equal((await nativeHook({ env, nativeSessionId: NATIVE, client: 'claude', event: 'UserPromptSubmit' })).wakeNotice, undefined);
  assert.equal((await w.service.adopted.controller.wake.status(binding)).enabled, false);
});

test('verified owner host continuity survives an MCP reconnect and rejects another host without making a separate worker', async t => {
  const w = await world(t, 'claude');
  w.launch.ready(NATIVE);
  for (const hostSessionId of ['', null]) await assert.rejects(() => dispatchNative(w.launch.env.HIVEM1ND_SERVICE_BRIDGE,
    w.launch.env.HIVEM1ND_SERVICE_GRANT, 'attach', { client: 'claude', hostSessionId }), { code: 'forbidden' });
  const env = { ...w.launch.env, CLAUDE_CODE_SESSION_ID: NATIVE, CLAUDE_CODE_HOST_SESSION_ID: 'owned-conversation' };
  const first = await connectNativeService({ env, client: 'claude' });
  first.close();
  const second = await connectNativeService({ env, client: 'claude' });
  t.after(() => second.close());
  const result = await second.callTool('status', { detail: true, limit: 1 });
  assert.equal(result.isError, false);
  const detail = JSON.parse(result.content[0].text).data;
  assert.equal(detail.units.length, 1);
  assert.equal(detail.total, 1, 'legacy user and canonical root registrations describe one unit');
  assert.equal(JSON.stringify(detail).includes(NATIVE), false);
  assert.equal(JSON.stringify(detail).includes('owned-conversation'), false);
  await assert.rejects(connectNativeService({ env: { ...env, CLAUDE_CODE_HOST_SESSION_ID: 'different-host' }, client: 'claude' }), { code: 'forbidden' });
  const records = await readdir(path.join(w.fixture.paths.mind, 'user', 'relay', 'sessions'));
  assert.ok(records.length >= 2, 'continuity registrations use the owner journal');
});

test('a verified host attach waits for owner continuity work beyond the bridge deadline', { timeout: 15000 }, async t => {
  const w = await world(t, 'claude');
  w.launch.ready(NATIVE);
  const accepted = Promise.withResolvers();
  const release = Promise.withResolvers();
  const carry = w.service.bridge.carryConversation;
  w.service.bridge.carryConversation = async (...args) => { await release.promise; return carry(...args); };
  const createConnection = net.createConnection;
  const observer = t.mock.method(net, 'createConnection', (...args) => {
    const socket = createConnection(...args);
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      for (let end; (end = buffer.indexOf('\n')) >= 0;) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.pending === true) accepted.resolve();
      }
    });
    return socket;
  });
  syncBuiltinESMExports();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    t.mock.timers.reset();
    observer.mock.restore();
    syncBuiltinESMExports();
    release.resolve();
  };
  t.after(cleanup);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = { ...w.launch.env, CLAUDE_CODE_SESSION_ID: NATIVE, CLAUDE_CODE_HOST_SESSION_ID: 'owned-conversation' };
  let settled = false;
  const waiting = connectNativeService({ env, client: 'claude' });
  waiting.then(() => { settled = true; }, () => { settled = true; });
  try {
    await Promise.race([accepted.promise, waiting.then(() => { throw new Error('The attach completed before the owner finished.'); })]);
    t.mock.timers.tick(3001);
    await new Promise(setImmediate);
    assert.equal(settled, false, 'The owner has acknowledged the attach but has not finished its continuity work.');
  } finally { cleanup(); }
  const connected = await waiting;
  t.after(() => connected.close());
  assert.equal((await connected.callTool('status', { detail: true, limit: 1 })).isError, false);
});

test('native host attach bounds an unacknowledged owner and requires a complete final reply', async t => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  for (const mode of ['silent', 'interrupted', 'coalesced', 'wrong-id']) await t.test(mode, async t => {
    const received = Promise.withResolvers();
    const sockets = new Set();
    const server = createNetServer(socket => {
      sockets.add(socket);
      socket.on('error', () => {});
      let buffer = '';
      socket.on('data', chunk => {
        buffer += chunk.toString();
        if (!buffer.includes('\n')) return;
        const { id } = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        received.resolve();
        if (mode === 'silent') return;
        const pending = JSON.stringify({ id: mode === 'wrong-id' ? randomUUID() : id, pending: true });
        socket.end(`${pending}\n${mode === 'coalesced' ? `${JSON.stringify({ id, result: { attached: true } })}\n` : ''}`);
      });
    });
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\hivem1nd-native-test-${randomUUID()}` : path.join(fixture.root, `${randomUUID()}.sock`);
    await new Promise(resolve => server.listen(endpoint, resolve));
    t.after(() => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = dispatchNative(endpoint, 'a'.repeat(43), 'attach', { hostSessionId: 'owned-conversation' });
    const finished = mode === 'coalesced' ? assert.doesNotReject(async () => assert.deepEqual(await pending, { attached: true }))
      : assert.rejects(pending, { code: mode === 'wrong-id' ? 'invalid_binding' : 'service_unavailable' });
    try {
      await received.promise;
      if (mode === 'silent') t.mock.timers.tick(3001);
      await finished;
    } finally { t.mock.timers.reset(); }
  });
});

test('a pending native host attach expires once even when the owner repeats its acknowledgment', async t => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const acknowledged = [Promise.withResolvers(), Promise.withResolvers()];
  let peer, requestId, frameCount = 0;
  const server = createNetServer(socket => {
    peer = socket;
    socket.on('error', () => {});
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (!buffer.includes('\n')) return;
      requestId = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))).id;
      socket.write(`${JSON.stringify({ id: requestId, pending: true })}\n`);
    });
  });
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\hivem1nd-native-test-${randomUUID()}` : path.join(fixture.root, `${randomUUID()}.sock`);
  await new Promise(resolve => server.listen(endpoint, resolve));
  t.after(() => new Promise(resolve => { peer?.destroy(); server.close(resolve); }));
  const createConnection = net.createConnection;
  const observer = t.mock.method(net, 'createConnection', (...args) => {
    const socket = createConnection(...args);
    socket.on('data', () => acknowledged[frameCount++]?.resolve());
    return socket;
  });
  syncBuiltinESMExports();
  t.after(() => { observer.mock.restore(); syncBuiltinESMExports(); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  let settled = false;
  const pending = dispatchNative(endpoint, 'a'.repeat(43), 'attach', { hostSessionId: 'owned-conversation' });
  const rejected = assert.rejects(pending, { code: 'service_unavailable' });
  pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await acknowledged[0].promise;
    t.mock.timers.tick(29999);
    await new Promise(setImmediate);
    assert.equal(settled, false, 'The first acknowledgment allows the existing 30-second owner deadline.');
    peer.write(`${JSON.stringify({ id: requestId, pending: true })}\n`);
    await acknowledged[1].promise;
    t.mock.timers.tick(2);
    await new Promise(setImmediate);
    assert.equal(settled, true, 'A repeated acknowledgment cannot move the owner deadline.');
    await rejected;
  } finally {
    peer?.destroy();
    await rejected;
  }
});

test('shared attach and enable carry the exact daily cap and reject unreviewed consent fields', async t => {
  const w = await world(t);
  w.launch.ready(NATIVE);
  const binding = { unit: 'one', unitId: UNIT, nativeSessionId: NATIVE, client: 'codex', machine: w.fixture.machine };
  const input = { action: 'enable', binding, consent: { maxDailyHandoffs: 31 } };
  const enabled = await relayPolicy({ mindPath: w.fixture.paths.mind, env: w.launch.env }, input);
  assert.equal(enabled.policy.dailyBudget, 31);
  await assert.rejects(relayPolicy({ mindPath: w.fixture.paths.mind, env: w.launch.env }, { ...input, consent: { maxDailyHandoffs: 31, execute: true } }), { code: 'invalid_body' });
  await relayPolicy({ mindPath: w.fixture.paths.mind, env: w.launch.env }, { ...input, consent: { unlimited: true, manualConsent: true, maxDailyHandoffs: 1 } });
  const connected = await connectNativeService({ env: w.launch.env, client: 'codex', nativeSessionId: NATIVE });
  t.after(() => connected.close());
  assert.equal((await connected.callTool('list_inbox', {})).isError, false);
  assert.equal((await w.service.adopted.controller.wake.status(binding)).dailyBudget, 1);
});

test('an expired launch grant and an unbound permission hook fail closed without starting another service', async (t) => {
  const { fixture, launch } = await world(t);
  launch.ready(NATIVE);
  fixture.clock.now += 4 * 3600000 + 1;
  await assert.rejects(() => connectNativeService({ env: launch.env, client: 'codex' }), { code: 'stop_unavailable' });
  const stdin = new PassThrough();
  stdin.end(JSON.stringify({ session_id: NATIVE, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo safe' }, cwd: fixture.root }));
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  await runRelayHook({ client: 'claude', mindPath: fixture.paths.mind, stdin, stdout, stderr: new PassThrough(), env: fixture.env });
  assert.equal(JSON.parse(Buffer.concat(chunks).toString('utf8')).hookSpecificOutput.permissionDecision, 'ask');
});

test('a synchronous owned Claude hook waits for the actual GUI approval over HTTP and SSE', async (t) => {
  const { fixture, service, launch, projects, policyFile, policy } = await world(t, 'claude');
  launch.ready(NATIVE);
  const env = { ...fixture.env, ...launch.env };
  const native = await connectNativeService({ env, client: 'claude' });
  assert.deepEqual(await native.hook('PreToolUse'), { verified: true });
  const stdin = new PassThrough();
  stdin.end(JSON.stringify({ session_id: NATIVE, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo approved' }, cwd: projects[0].localPath }));
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  const waiting = runRelayHook({ client: 'claude', mindPath: fixture.paths.mind, stdin, stdout, stderr: new PassThrough(), env, approvalTimeoutMs: 5000 });
  const directory = path.join(fixture.paths.mind, 'user', 'relay', 'approvals');
  let id = null;
  let detail = null;
  const deadline = Date.now() + 3000;
  while (!id && Date.now() < deadline) {
    const names = await readdir(directory).catch(() => []);
    const candidate = names.find((name) => /^[0-9a-f-]{36}$/.test(name));
    if (candidate && await readFile(path.join(directory, candidate, 'request.json')).then(() => true, () => false)) {
      const loaded = await request(native, { method: 'GET', path: `/api/v1/approvals/${candidate}` });
      if (loaded.status === 200) { id = candidate; detail = loaded; }
    }
    if (!id) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!id) await waiting;
  assert.ok(id, `The hook must persist an actual service approval: ${Buffer.concat(chunks).toString('utf8')}`);
  assert.equal(detail.json.data.pattern.command, 'echo approved');
  const login = await request({ origin: native.origin, token: service.bootstrap.secret, closed: false }, { path: '/api/v1/auth/local', body: { embedded: false, hostOrigin: null, look: null, language: null } });
  const desktop = { origin: native.origin, token: login.json.data.token, closed: false };
  const answer = await request(desktop, { path: `/api/v1/approvals/${id}/answer`, headers: { 'idempotency-key': randomUUID() }, body: { decision: 'approve', expectedRevision: detail.json.data.revision } });
  assert.equal(answer.status, 200);
  await waiting;
  assert.equal(JSON.parse(Buffer.concat(chunks).toString('utf8')).hookSpecificOutput.permissionDecision, 'allow');
  const after = JSON.parse(await readFile(policyFile, 'utf8'));
  assert.equal(after.deadlineAt, policy.deadlineAt);
  assert.equal(after.maxHandoffs, policy.maxHandoffs);
  launch.close();
  native.close();
});

test('native HTTP requests reject interrupted and malformed responses within the request deadline', async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/malformed') { res.end('{broken'); return; }
    res.write('{"data":');
    if (req.url === '/aborted') setImmediate(() => res.destroy());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const client = { origin: new URL(`http://127.0.0.1:${server.address().port}`), token: 'synthetic-fixture-token', closed: false };
  for (const route of ['/aborted', '/malformed', '/stalled']) {
    const before = Date.now();
    await assert.rejects(() => request(client, { method: 'GET', path: route, timeoutMs: 100 }), { code: route === '/malformed' ? 'invalid_json' : 'service_unavailable' });
    assert.ok(Date.now() - before < 1000, 'A partial response must not leave an approval waiter pending.');
  }
});

test('an interrupted native SSE emits one disconnect and reconnects until its owner closes it', async (t) => {
  let connections = 0;
  const server = createServer((_req, res) => {
    connections += 1;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: stream.ready\ndata: {"data":{}}\n\n');
    setTimeout(() => res.destroy(), 10);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const frames = [];
  const stream = subscribe({ origin: new URL(`http://127.0.0.1:${server.address().port}`), token: 'synthetic-fixture-token' }, (frame) => frames.push(frame));
  t.after(() => stream.close());
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(connections >= 2);
  assert.equal(frames.filter((frame) => frame.event === 'disconnect').length, connections);
  stream.close();
  const closed = connections;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(connections, closed);
});

test('ordinary v3 Relay CLI and policy controls use the existing verified service without spawning a worker', async (t) => {
  const { fixture, service, launch, policyFile } = await world(t);
  launch.ready(NATIVE);
  const env = { ...fixture.env, ...launch.env };
  const options = { mindPath: fixture.paths.mind, env, client: 'codex', nativeSessionId: NATIVE };
  const relay = await openRelayOperations(options);
  assert.equal((await relay.register({ unit: 'one', nativeSessionId: NATIVE, client: 'codex' })).unit, 'one');
  await assert.rejects(() => relay.register({ unit: 'master', nativeSessionId: NATIVE, client: 'codex' }), { code: 'forbidden' });
  let stdout = '';
  let stderr = '';
  const before = JSON.parse(await readFile(policyFile, 'utf8'));
  const code = await runCli(['relay', 'wake', 'attach', '--mind-path', fixture.paths.mind, '--unit', 'one', '--native-session-id', NATIVE, '--client', 'codex', '--hostname', fixture.machine], {
    env, stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
    createRelayWakeController() { throw new Error('The CLI must not create its own controller.'); },
    spawnLocalWakeWorker() { throw new Error('The CLI must not spawn a worker.'); },
  });
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).service, 'ready');
  assert.equal(JSON.parse(await readFile(policyFile, 'utf8')).deadlineAt, before.deadlineAt);
  await assert.rejects(() => dispatchNative(launch.env.HIVEM1ND_SERVICE_BRIDGE, launch.env.HIVEM1ND_SERVICE_GRANT, 'shutdown', {}), { code: 'native_login_unverified' });
  const binding = { unit: 'one', unitId: UNIT, nativeSessionId: NATIVE, client: 'codex', machine: fixture.machine };
  await assert.rejects(() => relayPolicy(options, { action: 'enable', binding, consent: { unit: 'master' } }), { code: 'invalid_body' });
  const disabled = await relayPolicy(options, { action: 'disable', binding });
  assert.equal(disabled.enabled, false);
  assert.equal(service.guard.listening, true);
});

test('a v3 person tool lazily posts through the real service as master with the existing result shape', async (t) => {
  const { fixture, service } = await world(t);
  const origin = path.join(fixture.root, 'person-origin');
  await mkdir(origin, { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'VERSION'), '3.0.0\n');
  await writeFile(path.join(fixture.paths.mind, 'user', 'routes.md'), '## Projects\n- shop (web)\n');
  const state = path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'state');
  await mkdir(state, { recursive: true });
  await writeFile(path.join(state, 'executor-shop.md'), `unit: executor-shop\nunit-id: project:shop:executor-shop\nrole: executor\nstate: in\nmachine: ${fixture.machine}\n\nReady.\n`);
  await writeFile(fixture.paths.configFile, JSON.stringify({ format: 'hivem1nd-service-config-v1', mindPath: fixture.paths.mind, machine: fixture.machine, origin: { kind: 'folder', path: origin }, stagingPath: fixture.paths.staging, port: 0 }));
  t.after(() => closeAttachedServices());
  const serviceOptions = { env: fixture.env, platform: fixture.platform, homeDir: fixture.home, cosmicPath: fixture.paths.cosmic, aclRunner: fixture.store.aclRunner, now: () => fixture.clock.now, userKey: service.userKey, guardPort: service.guard.address().port };
  const before = await readdir(path.join(fixture.paths.mind, 'user', 'relay', 'sessions'));
  const person = await createPersonRelay({ mindPath: fixture.paths.mind, tool: 'void', hostname: fixture.machine, serviceOptions });
  assert.deepEqual(await readdir(path.join(fixture.paths.mind, 'user', 'relay', 'sessions')), before);
  assert.deepEqual(await person.agentFor('shop'), { unit: 'executor-shop', awake: false });
  const sent = await person.send({ project: 'shop', subject: 'Service message', body: 'From the person' });
  assert.equal(sent.sent, true);
  assert.match(sent.id, /^[0-9a-f-]{36}$/);
  const files = await readdir(path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'inbox', 'executor-shop'));
  const bytes = await readFile(path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'inbox', 'executor-shop', files[0]), 'utf8');
  assert.match(bytes, /from-id: root:master/);
  assert.match(bytes, /From the person/);
  assert.deepEqual(await readdir(path.join(fixture.paths.mind, 'user', 'relay', 'sessions')), before);
  await assert.rejects(() => openRelayOperations({ mindPath: fixture.paths.mind, env: fixture.env, client: 'codex' }), { code: 'native_login_unverified' });
});

test('a configured mind never falls back to an offline writer because its active descriptor is malformed', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  await writeFile(path.join(fixture.paths.mind, 'user', 'VERSION'), '2.12.0\n');
  await writeFile(fixture.paths.activeFile, '{partial');
  await assert.rejects(() => openRelayOperations({ mindPath: fixture.paths.mind, env: fixture.env, platform: fixture.platform, cosmicPath: fixture.paths.cosmic, client: 'codex' }), { code: 'native_login_unverified' });
});

test('native task CLI uses its agent binding and cannot accept a delivery as master', async (t) => {
  const { fixture, service, launch } = await world(t);
  launch.ready(NATIVE);
  const directory = path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'tasks');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, '001.md');
  await writeFile(file, 'id: project:shop:001\ntitle: Own task\nstatus: open\nfrom: user\nto-id: root:one\ndate: 2026-10-10\n\n## Request\nWork.\n\n## Report\nReady.\n');
  let stdout = '';
  let stderr = '';
  const dependencies = { env: { ...fixture.env, ...launch.env }, stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } } };
  const argv = ['task', 'status', 'shop', '001'];
  assert.equal(await runCli([...argv, 'review', '--mind-path', fixture.paths.mind], dependencies), 0, stderr);
  assert.equal(JSON.parse(stdout).task.status, 'review');
  stdout = ''; stderr = '';
  const review = await readFile(file, 'utf8');
  assert.match(review, /root:one/);
  assert.equal(await runCli([...argv, 'done', '--mind-path', fixture.paths.mind], dependencies), 1);
  assert.match(stderr, /forbidden/);
  assert.equal(await readFile(file, 'utf8'), review);
  assert.equal(service.guard.listening, true);
});
