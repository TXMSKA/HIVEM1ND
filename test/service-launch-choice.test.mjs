import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createNativeAdapter, enqueueStart, nativePermissionReply, stopSession } from '../engine/service/adapters.mjs';
import { createCluster } from '../engine/service/clusters.mjs';
import { createUnit, setUnitRunsIn } from '../engine/service/units.mjs';
import { connectedClients, defaultRunsIn } from '../engine/service/settings.mjs';
import { readDetail } from '../engine/service/projection.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { request } from '../engine/service/client.mjs';

const choice = client => ({ client, model: 'verified-model', effort: 'high', mode: null });
const report = client => ({ id: client, title: client, connected: true, scopeEnforced: true,
  models: [{ id: 'verified-model', title: 'Verified', efforts: ['high'], modes: [] }], quota: { remainingPercent: null, period: null, known: false } });
function child(onMessage) {
  const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.pid = 5151; proc.exitCode = null; proc.writes = [];
  proc.stdin = { write(line) { const message = JSON.parse(line); proc.writes.push(message); queueMicrotask(() => onMessage(message, value => proc.stdout.emit('data', `${JSON.stringify(value)}\n`))); }, end() {} };
  proc.kill = () => { proc.killed = true; proc.exitCode = 0; proc.emit('exit', 0); };
  return proc;
}

test('every external choice reaches real native arguments or acknowledged protocol fields', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  for (const client of ['codex', 'claude', 'cursor']) {
    await t.test(client, async t => {
      const launches = [], native = child((message, send) => {
        if (client === 'claude') {
          if (message.type === 'user') send({ type: 'system', subtype: 'init', session_id: native.nativeId, model: 'verified-model' });
          return;
        }
        if (message.id == null) return;
        let result = {};
        if (message.method === 'initialize') result = { authMethods: [{ id: 'existing-login' }] };
        if (message.method === 'account/read') result = { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
        if (message.method === 'thread/start') result = { thread: { id: 'owned' }, model: message.params.model,
          reasoningEffort: message.params.config.model_reasoning_effort, sandbox: { type: 'readOnly' } };
        if (message.method === 'turn/start') result = { turn: { id: 'turn' } };
        if (message.method === 'session/new') result = { sessionId: 'owned', configOptions: configOptions() };
        if (message.method === 'session/set_config_option') result = { configOptions: configOptions().map(option => ({ ...option, currentValue: message.params.value })) };
        send({ jsonrpc: '2.0', id: message.id, result });
      });
      const spawn = (command, args, options) => { launches.push({ command, args, options }); native.nativeId = args[args.indexOf('--session-id') + 1]; return native; };
      const adapter = createNativeAdapter(client, { command: 'known-client', describe: async () => report(client), timeoutMs: 1000,
        enforceScope: async launch => { assert.equal(launch.policy.gitBrokerOnly, true); return { verified: true, spawn: () => spawn(launch.command, launch.args, launch.options) }; } });
      t.after(() => adapter.close());
      const runsIn = choice(client);
      await adapter.create({ unitId: 'root:worker', cwd: fixture.root, model: runsIn.model, effort: runsIn.effort, runsIn,
        launchScope: { id: randomUUID(), writeRoots: [] } });
      assert.equal(launches[0].options.shell, false);
      if (client === 'claude') {
        assert.equal(launches[0].args[launches[0].args.indexOf('--model') + 1], 'verified-model');
        assert.equal(launches[0].args[launches[0].args.indexOf('--effort') + 1], 'high');
        assert.equal(native.writes[0].message.content.includes('verified-model'), false);
      } else if (client === 'codex') {
        const start = native.writes.find(message => message.method === 'thread/start');
        assert.equal(start.params.model, 'verified-model'); assert.equal(start.params.config.model_reasoning_effort, 'high');
        assert.equal(start.params.sandbox, 'read-only');
        await adapter.send({ nativeSessionId: 'owned', text: 'Next turn' });
        const turn = native.writes.find(message => message.method === 'turn/start');
        assert.equal(turn.params.model, 'verified-model'); assert.equal(turn.params.effort, 'high');
      } else {
        const updates = native.writes.filter(message => message.method === 'session/set_config_option');
        assert.deepEqual(updates.map(message => [message.params.configId, message.params.value]), [['model-option', 'verified-model'], ['effort-option', 'high']]);
      }
      await assert.rejects(adapter.create({ cwd: fixture.root, unitId: 'root:worker', model: 'verified-model', effort: 'max', runsIn: { ...runsIn, effort: 'max' } }), { code: 'unsupported_launch_choice' });
      assert.equal(launches.length, 1);
    });
  }
});
function configOptions() { return [
  { id: 'model-option', category: 'model', type: 'select', options: [{ value: 'verified-model' }], currentValue: 'default' },
  { id: 'effort-option', category: 'thought_level', type: 'select', options: [{ value: 'high' }], currentValue: 'default' },
]; }

test('stored choices and explicitly selected defaults survive creation while unlinked/root roles launch privately', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const adapter = createNativeAdapter('codex', { fixture: true, models: ['verified-model'], transcript: ['{"id":1,"result":{"thread":{"id":"owned"}}}'] });
  t.after(() => adapter.close());
  const context = { store: fixture.store, paths: { ...fixture.paths, origin: path.join(fixture.root, 'origin') }, now: () => fixture.clock.now,
    principal: { audience: 'desktop', unitId: 'root:master' }, adapters: { codex: adapter }, ownedPids: new Set(),
    projects: [{ name: 'first', localPath: fixture.root }, { name: 'second', localPath: fixture.home }], beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() } };
  await mkdir(path.join(context.paths.origin, 'machines', 'DESKTOP'), { recursive: true });
  await writeFile(path.join(context.paths.origin, 'machines', 'DESKTOP', 'service.json'), JSON.stringify(context.beat));
  const cluster = await createCluster(context, { title: 'Planning', parentId: null, link: { kind: 'none' }, members: [], machine: 'DESKTOP', confirmed: true });
  const first = await createUnit(context, { clusterId: cluster.id, role: 'overlord', machine: 'DESKTOP', runsIn: choice('codex'), useAsDefault: false, expectedRevision: cluster.revision });
  assert.equal(await defaultRunsIn(context), null);
  const updated = await readDetail(context, 'groups', cluster.id);
  const second = await createUnit(context, { clusterId: cluster.id, role: 'overlord', machine: 'DESKTOP', runsIn: choice('codex'), useAsDefault: true, expectedRevision: updated.revision });
  assert.equal(second.unit.unit, `${first.unit.unit}-2`); assert.equal(second.unit.leadId, first.unit.id);
  assert.deepEqual(await defaultRunsIn(context), choice('codex'));
  assert.deepEqual(second.unit.runsIn, choice('codex')); assert.equal(second.unit.clusterId, cluster.id);
  const overseer = await createUnit(context, { unit: 'overseer', role: 'overseer', scope: { kind: 'root' }, machine: 'DESKTOP', runsIn: choice('codex') });
  assert.equal(overseer.unit.fresh, true);
  const changed = await setUnitRunsIn(context, second.unit.id, { machine: 'DESKTOP', runsIn: choice('codex'), useAsDefault: false, expectedRevision: second.unit.revision });
  assert.deepEqual(changed.unit.runsIn, choice('codex'));
  const launches = [], original = adapter.create.bind(adapter); adapter.create = async input => { launches.push(input); return original(input); };
  const started = await enqueueStart(context, { unitId: first.unit.id, runMode: 'chat', stateRevision: first.unit.revision });
  assert.deepEqual(launches[0].runsIn, choice('codex')); assert.deepEqual(launches[0].launchScope.writeRoots, []);
  assert.equal(path.dirname(launches[0].cwd), path.join(fixture.paths.localDirectory, 'sessions'));
  await stopSession(context, started.result.sessionId, { confirmed: true });
  adapter.describe = async () => ({ ...report('codex'), models: [] });
  await assert.rejects(enqueueStart(context, { unitId: first.unit.id, runMode: 'chat', stateRevision: first.unit.revision }), { code: 'unsupported_launch_choice' });
  assert.equal(launches.length, 1);
});

test('native one-time decisions preserve exact option IDs and never widen a missing boundary', async () => {
  const request = { nativeSessionId: 'owned', runsIn: choice('cursor'), nativeBoundary: { verified: true }, nativePermission: async () => true };
  const message = { jsonrpc: '2.0', id: 'exact-id', method: 'session/request_permission', params: { sessionId: 'owned', toolCall: { kind: 'edit', locations: [{ path: 'C:/reviewed.txt' }] },
    options: [{ optionId: 'forever', kind: 'allow_always' }, { optionId: 'one-use-only', kind: 'allow_once' }, { optionId: 'refused-once', kind: 'reject_once' }] } };
  assert.deepEqual(await nativePermissionReply(message, request), { jsonrpc: '2.0', id: 'exact-id', result: { outcome: { outcome: 'selected', optionId: 'one-use-only' } } });
  for (const changed of [{ nativeBoundary: null }, { nativePermission: async () => false }, { nativeSessionId: 'foreign' }]) {
    assert.equal((await nativePermissionReply(message, { ...request, ...changed })).result.outcome.optionId, 'refused-once');
  }
  const codex = await nativePermissionReply({ ...message, id: 17, method: 'item/commandExecution/requestApproval', params: { threadId: 'owned', command: 'build', cwd: 'C:/reviewed' } }, request);
  assert.deepEqual(codex, { jsonrpc: '2.0', id: 17, result: { decision: 'accept' } });
  assert.deepEqual((await nativePermissionReply({ ...message, method: 'item/permissions/requestApproval' }, request)).result, { permissions: {}, scope: 'turn' });
});

test('native capability reports use the observed catalog and quota, with no installed-model invention', async t => {
  const proc = child((message, send) => {
    if (message.id == null) return;
    const result = message.method === 'account/read' ? { account: { type: 'chatgpt' }, requiresOpenaiAuth: true }
      : message.method === 'model/list' ? { data: [{ model: 'observed', displayName: 'Observed', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: null }
      : message.method === 'account/rateLimits/read' ? { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 60 } } } : {};
    send({ jsonrpc: '2.0', id: message.id, result });
  });
  const adapter = createNativeAdapter('codex', { command: 'known-client', spawn: () => proc, timeoutMs: 1000 }); t.after(() => adapter.close());
  const reports = await connectedClients({ adapters: { codex: adapter } });
  assert.deepEqual(reports[0].models, [{ id: 'observed', title: 'Observed', efforts: ['high'], modes: [] }]);
  assert.deepEqual(reports[0].quota, { remainingPercent: 75, period: '60m', known: true });
  assert.equal(proc.killed, true);
  const unsupported = createNativeAdapter('claude', { command: 'known-client' });
  assert.deepEqual(await connectedClients({ adapters: { claude: unsupported } }), []);
});

test('C13 creation and stored-choice changes enforce owners, exact bodies and idempotent replay', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const adapter = createNativeAdapter('codex', { fixture: true, models: ['verified-model'] }); t.after(() => adapter.close());
  const paths = { ...fixture.paths, origin: path.join(fixture.root, 'origin') };
  const context = { paths, store: fixture.store, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' }, adapters: { codex: adapter }, projects: [] };
  await mkdir(path.join(paths.origin, 'machines', 'DESKTOP'), { recursive: true });
  await writeFile(path.join(paths.origin, 'machines', 'DESKTOP', 'service.json'), JSON.stringify({ state: 'running', heartbeatAt: new Date(context.now()).toISOString() }));
  const cluster = await createCluster(context, { title: 'Planning', machine: 'DESKTOP', parentId: null, link: { kind: 'none' }, members: [], confirmed: true });
  const credentials = createCredentialStore({ now: context.now }), desktop = credentials.issue({ audience: 'desktop' }).token;
  const phone = credentials.issue({ audience: 'phone' }).token, agent = credentials.issue({ audience: 'agent', unitId: 'root:foreign', sessionId: randomUUID() }).token;
  const http = await createHttpServer({ ...context, credentials }); t.after(() => http.close());
  const call = (token, path, body, key = randomUUID(), method = 'POST') => request({ origin: new URL(`http://127.0.0.1:${http.port}`), token },
    { path: `/api/v1${path}`, method, body, headers: { 'idempotency-key': key } });
  const input = { machine: 'DESKTOP', role: 'executor', runsIn: choice('codex'), useAsDefault: false, expectedRevision: cluster.revision }, key = randomUUID();
  for (const token of [phone, agent]) assert.equal((await call(token, `/clusters/${cluster.id}/agents`, input, key)).status, 403);
  const created = await call(desktop, `/clusters/${cluster.id}/agents`, input, key);
  assert.equal(created.status, 201, JSON.stringify(created.json)); assert.deepEqual(created.json.data.runsIn, choice('codex'));
  const replay = await call(desktop, `/clusters/${cluster.id}/agents`, input, key);
  assert.equal(replay.status, 201); assert.equal(replay.json.data.id, created.json.data.id); assert.equal(replay.json.meta.replayed, true);
  for (const override of [{ client: 'codex' }, { model: 'verified-model' }, { effort: 'high' }]) {
    const rejected = await call(desktop, `/units/${created.json.data.id}/session`, { ...override, runMode: 'chat', expectedRevision: created.json.data.revision });
    assert.equal(rejected.status, 422); assert.equal(rejected.json.error.code, 'unsupported_launch_choice');
  }
  const changed = await call(desktop, `/units/${created.json.data.id}/runs-in`, { machine: 'DESKTOP', runsIn: choice('codex'), useAsDefault: true, expectedRevision: created.json.data.revision }, randomUUID(), 'PATCH');
  assert.equal(changed.status, 200, JSON.stringify(changed.json)); assert.deepEqual(await defaultRunsIn(context), choice('codex'));
  assert.equal((await call(desktop, '/overseer', { machine: 'OFFLINE', runsIn: choice('codex'), fresh: true, expectedRevision: null })).status, 409);
  const overseer = await call(desktop, '/overseer', { machine: 'DESKTOP', runsIn: choice('codex'), fresh: true, expectedRevision: null });
  assert.equal(overseer.status, 201, JSON.stringify(overseer.json)); assert.equal(overseer.json.data.fresh, true);
});

test('Claude control initialization and ACP configuration supply only observed models, efforts and quotas', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  for (const client of ['claude', 'cursor']) {
    const native = child((message, send) => {
      if (client === 'claude') {
        const response = message.request.subtype === 'initialize' ? { account: { apiKeySource: 'fixture-provider' }, models: [
          { value: 'alias', resolvedModel: 'observed-model', displayName: 'Observed', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
          { value: 'unverified', displayName: 'Unverified', supportsEffort: true },
        ] } : { rate_limits_available: true, rate_limits: { five_hour: { utilization: 40 }, seven_day: { utilization: 15 } } };
        send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } });
      } else if (message.id != null) {
        const config = [
          { id: 'actual-model', category: 'model', type: 'select', currentValue: 'observed-model', options: [{ group: 'installed', options: [{ value: 'observed-model', name: 'Observed' }] }] },
          { id: 'actual-effort', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'low' }, { value: 'high' }] },
        ];
        const result = message.method === 'initialize' ? { authMethods: [{ id: 'existing-login' }] }
          : message.method === 'session/new' ? { sessionId: 'catalog-session', configOptions: config }
          : message.method === 'session/set_config_option' ? { configOptions: config } : {};
        send({ jsonrpc: '2.0', id: message.id, result });
      }
    });
    const adapter = createNativeAdapter(client, { command: 'known-client', spawn: () => native, timeoutMs: 1000 }); t.after(() => adapter.close());
    const reports = await connectedClients({ paths: fixture.paths, store: fixture.store, adapters: { [client]: adapter } });
    assert.deepEqual(reports[0].models, [{ id: 'observed-model', title: 'Observed', efforts: ['low', 'high'], modes: [] }]);
    assert.equal(reports[0].scopeEnforced, false);
    assert.equal(reports[0].boundary, 'supervised');
    assert.equal(reports[0].quota.remainingPercent, client === 'claude' ? 60 : null);
    assert.equal(native.writes.some(message => message.type === 'user' || message.method === 'session/prompt'), false);
    assert.equal(native.killed, true);
  }
  assert.deepEqual((await readdir(fixture.paths.localDirectory)).filter(name => name.startsWith('probe-')), []);
});
