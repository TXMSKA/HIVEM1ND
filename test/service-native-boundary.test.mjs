import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createNativeAdapter } from '../engine/service/adapters.mjs';
import { createCluster } from '../engine/service/clusters.mjs';
import { createUnit, setUnitRunsIn } from '../engine/service/units.mjs';
import { connectedClients } from '../engine/service/settings.mjs';
import { launchBoundary } from '../engine/service/runs-in.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const choice = client => ({ client, model: 'observed-model', effort: 'high', mode: null });

export function fakeChild(onMessage) {
  const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.pid = 6161; proc.exitCode = null; proc.writes = [];
  proc.stdin = { write(line) { const message = JSON.parse(line); proc.writes.push(message); queueMicrotask(() => onMessage(message, value => proc.stdout.emit('data', `${JSON.stringify(value)}\n`))); }, end() {} };
  proc.kill = () => { proc.killed = true; proc.exitCode = 0; proc.emit('exit', 0); };
  return proc;
}

function claudeProbe() {
  return fakeChild((message, send) => {
    const response = message.request.subtype === 'initialize' ? { account: { apiKeySource: 'fixture-provider' }, models: [
      { value: 'alias', resolvedModel: 'observed-model', displayName: 'Observed', supportsEffort: true, supportedEffortLevels: ['low', 'high'] }] }
      : { rate_limits_available: false };
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } });
  });
}

function cursorProbe() {
  return fakeChild((message, send) => {
    if (message.id == null) return;
    const config = [
      { id: 'model-option', category: 'model', type: 'select', currentValue: 'observed-model', options: [{ value: 'observed-model', name: 'Observed' }] },
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
      : message.method === 'model/list' ? { data: [{ model: 'observed-model', displayName: 'Observed', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: null }
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
    const [report] = await connectedClients({ paths: fixture.paths, store: fixture.store, adapters: { [client]: adapter } });
    assert.equal(report.boundary, client === 'codex' ? 'confined' : 'supervised', client);
    assert.equal(report.scopeEnforced, client === 'codex', client);
    assert.equal(launchBoundary(report), report.boundary);
  }
});

test('a client that is not connected has no boundary and an unknown boundary fails closed', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  for (const client of ['claude', 'cursor', 'codex']) {
    const adapter = createNativeAdapter(client, { command: 'known-client', spawn: () => { throw new Error('not installed'); }, timeoutMs: 200 }); t.after(() => adapter.close());
    const report = await adapter.describe({ localDirectory: fixture.paths.localDirectory, store: fixture.store });
    assert.equal(report.connected, false); assert.equal(report.boundary, null); assert.equal(report.scopeEnforced, false);
    assert.equal(launchBoundary(report), null);
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
  const report = (client, extra) => ({ id: client, title: client, connected: true, scopeEnforced: false,
    models: [{ id: 'observed-model', title: 'Observed', efforts: ['high'], modes: [] }], quota: { remainingPercent: null, period: null, known: false }, ...extra });
  const adapters = { claude: createNativeAdapter('claude', { describe: async () => report('claude', { boundary: 'supervised' }) }),
    cursor: createNativeAdapter('cursor', { describe: async () => report('cursor', { boundary: null }) }) };
  const paths = { ...fixture.paths, origin: path.join(fixture.root, 'origin') };
  const context = { store: fixture.store, paths, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' }, adapters, projects: [] };
  await mkdir(path.join(paths.origin, 'machines', 'DESKTOP'), { recursive: true });
  await writeFile(path.join(paths.origin, 'machines', 'DESKTOP', 'service.json'), JSON.stringify({ state: 'running', heartbeatAt: new Date(context.now()).toISOString() }));
  const cluster = await createCluster(context, { title: 'Shop', machine: 'DESKTOP', parentId: null, link: { kind: 'none' }, members: [], confirmed: true });
  const created = await createUnit(context, { clusterId: cluster.id, role: 'executor', machine: 'DESKTOP', runsIn: choice('claude'), useAsDefault: false, expectedRevision: cluster.revision });
  assert.deepEqual(created.unit.runsIn, choice('claude'));
  await assert.rejects(setUnitRunsIn(context, created.unit.id, { machine: 'DESKTOP', runsIn: choice('cursor'), useAsDefault: false, expectedRevision: created.unit.revision }),
    { code: 'scope_unavailable' }, 'a client with no boundary is refused');
  adapters.cursor.describe = async () => report('cursor', { boundary: 'supervised' });
  const changed = await setUnitRunsIn(context, created.unit.id, { machine: 'DESKTOP', runsIn: choice('cursor'), useAsDefault: false, expectedRevision: created.unit.revision });
  assert.deepEqual(changed.unit.runsIn, choice('cursor'));
  adapters.claude.describe = async () => report('claude', { boundary: 'invented' });
  await assert.rejects(setUnitRunsIn(context, created.unit.id, { machine: 'DESKTOP', runsIn: choice('claude'), useAsDefault: false, expectedRevision: changed.unit.revision }), { code: 'scope_unavailable' });
});
