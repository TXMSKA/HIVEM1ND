import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createNativeAdapter, enqueueStart, stopSession } from '../engine/service/adapters.mjs';
import { createCluster } from '../engine/service/clusters.mjs';
import { createUnit, setUnitRunsIn } from '../engine/service/units.mjs';
import { connectedClients } from '../engine/service/settings.mjs';
import { confirmDetected } from '../engine/service/accounts.mjs';
import { readDetail } from '../engine/service/projection.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const report = (client, model, remaining) => ({ id: client, title: client, connected: true, scopeEnforced: true, boundary: 'confined',
  models: [{ id: model, title: model, efforts: ['high'], modes: [] }], quota: { remainingPercent: remaining, period: '5h', known: true } });

test('a unit keeps its account, the launch gets that home and models and quota come from that account', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const work = path.join(fixture.home, '.codex-work');
  await mkdir(work, { recursive: true }); await writeFile(path.join(work, 'auth.json'), '{"token":"SECRET-TOKEN"}');
  const adapter = createNativeAdapter('codex', { fixture: true, models: ['base-model'], transcript: ['{"id":1,"result":{"thread":{"id":"owned"}}}'] });
  t.after(() => adapter.close());
  const seen = [];
  adapter.describe = async input => { seen.push(input.accountHome); return input.accountHome === work ? report('codex', 'work-model', 12) : report('codex', 'base-model', 80); };
  const context = { store: fixture.store, homeDir: fixture.home, paths: { ...fixture.paths, origin: path.join(fixture.root, 'origin') }, now: () => fixture.clock.now,
    principal: { audience: 'desktop', unitId: 'root:master' }, adapters: { codex: adapter }, ownedPids: new Set(),
    projects: [{ name: 'first', localPath: fixture.root }], beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() } };
  await mkdir(path.join(context.paths.origin, 'machines', 'DESKTOP'), { recursive: true });
  await writeFile(path.join(context.paths.origin, 'machines', 'DESKTOP', 'service.json'), JSON.stringify(context.beat));

  // One account: no accounts list, so the picker has no Account row.
  assert.equal((await connectedClients(context))[0].accounts, undefined);
  await confirmDetected(context, { client: 'codex', home: work, label: 'Work' });
  const [codex] = await connectedClients(context);
  assert.deepEqual(codex.models.map(model => model.id), ['base-model']);
  assert.equal(codex.quota.remainingPercent, 80);
  assert.equal(codex.accounts.length, 1);
  assert.equal(codex.accounts[0].id, 'work');
  assert.deepEqual(codex.accounts[0].models.map(model => model.id), ['work-model']);
  assert.equal(codex.accounts[0].quota.remainingPercent, 12);
  assert.ok(seen.includes(null) && seen.includes(work));

  const plain = { client: 'codex', model: 'base-model', effort: 'high', mode: null };
  const onWork = { client: 'codex', model: 'work-model', effort: 'high', mode: null, account: 'work' };
  const cluster = await createCluster(context, { title: 'Planning', parentId: null, link: { kind: 'none' }, members: [], machine: 'DESKTOP', confirmed: true });
  const first = await createUnit(context, { clusterId: cluster.id, role: 'overlord', machine: 'DESKTOP', runsIn: onWork, useAsDefault: false, expectedRevision: cluster.revision });
  assert.deepEqual(first.unit.runsIn, onWork);
  const updated = await readDetail(context, 'groups', cluster.id);
  const second = await createUnit(context, { clusterId: cluster.id, role: 'overlord', machine: 'DESKTOP', runsIn: plain, useAsDefault: false, expectedRevision: updated.revision });
  assert.deepEqual(second.unit.runsIn, plain);
  assert.equal(Object.hasOwn(second.unit.runsIn, 'account'), false);
  await assert.rejects(setUnitRunsIn(context, second.unit.id, { machine: 'DESKTOP', runsIn: { ...onWork, model: 'base-model' }, useAsDefault: false, expectedRevision: second.unit.revision }),
    { code: 'unsupported_launch_choice' });

  const launches = [], original = adapter.create.bind(adapter); adapter.create = async input => { launches.push(input); return original(input); };
  const started = await enqueueStart(context, { unitId: first.unit.id, runMode: 'chat', stateRevision: first.unit.revision });
  assert.equal(launches[0].accountHome, work);
  assert.deepEqual(launches[0].runsIn, onWork);
  // The session record notes the account; the session id depends on the unit, not on the account.
  const records = [];
  const sessionsDir = path.join(fixture.paths.mind, 'user', 'relay', 'sessions');
  for (const name of await readdir(sessionsDir)) records.push(JSON.parse(await readFile(path.join(sessionsDir, name), 'utf8')));
  assert.equal(records.find(item => item.sessionId === started.result.sessionId).account, 'work');
  await stopSession(context, started.result.sessionId, { confirmed: true });
  const startedPlain = await enqueueStart(context, { unitId: second.unit.id, runMode: 'chat', stateRevision: second.unit.revision });
  assert.equal(launches[1].accountHome, null);
  assert.deepEqual(launches[1].runsIn, plain);
  const after = [];
  for (const name of await readdir(sessionsDir)) after.push(JSON.parse(await readFile(path.join(sessionsDir, name), 'utf8')));
  assert.equal(after.find(item => item.sessionId === startedPlain.result.sessionId).account, null);
  await stopSession(context, startedPlain.result.sessionId, { confirmed: true });
});

test('a live adapter sets the account home for that process only; the default leaves the variable unset', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const launches = [];
  const spawn = (command, args, options) => {
    launches.push(options.env);
    const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.pid = 4242; proc.exitCode = null;
    const id = args[args.indexOf('--session-id') + 1];
    proc.stdin = { write() { queueMicrotask(() => proc.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'init', session_id: id, model: 'm' })}\n`)); }, end() {} };
    proc.kill = () => { proc.killed = true; proc.exitCode = 0; proc.emit('exit', 0); };
    return proc;
  };
  const env = { PATH: process.env.PATH ?? '', CLAUDE_CONFIG_DIR: 'C:\\inherited' };
  const adapter = createNativeAdapter('claude', { command: 'known-client', env, spawn, describe: async () => report('claude', 'm', null), timeoutMs: 1000,
    enforceScope: async launch => ({ verified: true, spawn: () => spawn(launch.command, launch.args, launch.options) }) });
  t.after(() => adapter.close());
  const runsIn = { client: 'claude', model: 'm', effort: 'high', mode: null };
  const create = extra => adapter.create({ unitId: 'root:worker', cwd: fixture.root, model: 'm', effort: 'high', runsIn: extra.runsIn ?? runsIn, launchScope: { id: 'scope', writeRoots: [] }, ...extra });
  await create({ accountHome: 'C:\\homes\\alt', runsIn: { ...runsIn, account: 'alt' } });
  await create({ accountHome: null });
  await create({});
  assert.equal(launches[0].CLAUDE_CONFIG_DIR, 'C:\\homes\\alt');
  assert.equal(Object.hasOwn(launches[1], 'CLAUDE_CONFIG_DIR'), false);
  assert.equal(Object.hasOwn(launches[2], 'CLAUDE_CONFIG_DIR'), false);
  assert.equal(env.CLAUDE_CONFIG_DIR, 'C:\\inherited');
});
