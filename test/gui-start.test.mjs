import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApi, createOperation, dispose as disposeApi, request } from '../gui/app/api.mjs';
import * as start from '../gui/app/start-api.mjs';
import { initialRunsIn, filterRepositories, repositorySelection, validRunsIn } from '../gui/app/clusters.mjs';
import { consumeStart, createNativeAdapter, stopSession } from '../engine/service/adapters.mjs';
import { legacyTreeInventory } from '../engine/legacy-copy.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function world(t, repositories = true) {
  const fixture = await makeCoreFixture(), origin = path.join(fixture.root, 'origin');
  let core, api, adapter;
  t.after(async () => {
    if (api) disposeApi(api);
    try { await core?.http.close(); await adapter?.close(); }
    finally { await dispose(fixture); }
  });
  await mkdir(origin, { recursive: true });
  const directory = path.join(fixture.home, 'Web', 'shop');
  if (repositories) {
    await mkdir(directory, { recursive: true });
    const git = (...args) => new Promise((resolve, reject) => execFile('git', args, { cwd: directory, shell: false, windowsHide: true, signal: t.signal,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_TERMINAL_PROMPT: '0' } }, error => error ? reject(error) : resolve()));
    await git('init', '-b', 'main'); await writeFile(path.join(directory, 'source.txt'), 'Retained source.\n');
    await git('add', 'source.txt'); await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture');
    await git('worktree', 'add', '-b', 'review', path.join(fixture.home, 'Web', 'shop-work'));
  }
  adapter = createNativeAdapter('codex', { fixture: true, models: ['observed'], transcript: ['{"id":1,"result":{"thread":{"id":"owned"}}}'] });
  const launches = [], nativeCreate = adapter.create.bind(adapter);
  adapter.create = async input => { launches.push(input); return nativeCreate(input); };
  const options = { store: fixture.store, paths: { ...fixture.paths, origin }, now: () => fixture.clock.now, homeDir: fixture.home,
    env: fixture.env, projects: [], adapters: { codex: adapter }, ownedPids: new Set(), probeAgents: async () => ({}) };
  core = await composeCore(options);
  const address = `http://127.0.0.1:${core.http.port}`;
  const response = await fetch(`${address}/api/v1/auth/local`, { method: 'POST', headers: { origin: address, authorization: `Bearer ${core.bootstrap.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ embedded: false, hostOrigin: null, look: null, language: null }) });
  assert.equal(response.status, 201);
  const token = (await response.json()).data.token;
  api = createApi({ location: { origin: address, hash: '' }, fetch }); api.token = token;
  return { fixture, core, options, api, directory, launches };
}

test('browser discovery imports canonical repositories once, retains worktrees and every repository byte', async t => {
  const { api, fixture, launches } = await world(t);
  const before = await legacyTreeInventory(fixture.home);
  const report = (await request(api, 'GET', '/settings/projects')).data, offer = report.discoveryOffer;
  assert.equal((await start.getClusters(api)).data.total, 0);
  assert.equal(repositorySelection(offer).size, 1); assert.equal(offer.groups[0].repositories[0].worktrees.length, 2);
  const selected = repositorySelection(offer);
  assert.equal(filterRepositories(offer, 'review')[0].repositories.length, 1);
  assert.deepEqual(repositorySelection(offer), selected);
  const result = await start.answerRepositoryOffer(api, offer.id, { machine: fixture.machine, repositoryIds: [...selected], confirmed: true, expectedRevision: offer.revision });
  const replay = await start.answerRepositoryOffer(api, offer.id, {}, result.operation);
  assert.deepEqual(replay.data, result.data); assert.equal(replay.meta.replayed, true);
  const clusters = (await start.getClusters(api)).data.items;
  assert.equal(clusters.length, 2); assert.equal(clusters.filter(item => item.link.kind === 'repository').length, 1);
  assert.equal(clusters.find(item => item.link.kind === 'repository').parentId, clusters.find(item => item.link.kind === 'folder').id);
  assert.equal(clusters.every(item => !item.members.length), true); assert.deepEqual(launches, []);
  assert.deepEqual(await legacyTreeInventory(fixture.home), before);
});

test('Not now survives another read and never imports or launches; explicit Overseer creation stays closed', async t => {
  const { api, fixture, launches } = await world(t);
  const offer = (await request(api, 'GET', '/settings/projects')).data.discoveryOffer;
  await start.answerRepositoryOffer(api, offer.id, { machine: fixture.machine, repositoryIds: [], confirmed: false, expectedRevision: offer.revision });
  assert.equal((await request(api, 'GET', '/settings/projects')).data.discoveryOffer.dismissed, true);
  assert.equal((await start.getClusters(api)).data.total, 0); assert.equal(launches.length, 0);
  const clients = (await request(api, 'GET', '/settings/agents')).data.connectedClients;
  const runsIn = initialRunsIn(clients);
  const created = await start.createOverseer(api, { machine: fixture.machine, runsIn, fresh: true, expectedRevision: null });
  assert.equal(created.data.id, 'root:overseer'); assert.equal(created.data.fresh, true); assert.deepEqual(created.data.runsIn, runsIn);
  const replay = await start.createOverseer(api, {}, created.operation);
  assert.equal(replay.data.id, created.data.id); assert.equal(launches.length, 0);
});

test('New agent derives its identity and stored native choice; only explicit selection changes the default', async t => {
  const { api, fixture, launches, options, core } = await world(t, false);
  const cluster = (await start.createCluster(api, { title: 'Ideas', parentId: null, link: { kind: 'none' }, machine: fixture.machine })).data;
  const clients = (await request(api, 'GET', '/settings/agents')).data.connectedClients, runsIn = initialRunsIn(clients);
  assert.ok(validRunsIn(runsIn, clients));
  const created = await start.createClusterAgent(api, cluster.id, { machine: fixture.machine, role: 'executor', runsIn, useAsDefault: false, expectedRevision: cluster.revision });
  assert.equal(created.data.clusterId, cluster.id); assert.equal(created.data.machine, fixture.machine); assert.equal(created.data.role, 'executor');
  assert.equal((await request(api, 'GET', '/settings/agents')).data.defaultRunsIn, null); assert.equal(launches.length, 0);
  const changed = await start.setRunsIn(api, created.data.id, { machine: fixture.machine, runsIn, useAsDefault: true, expectedRevision: created.data.revision });
  assert.deepEqual((await request(api, 'GET', '/settings/agents')).data.defaultRunsIn, runsIn);
  const launch = createOperation({ method: 'POST', path: '/units/:unitId/session', params: { unitId: changed.data.id }, body: { runMode: 'chat', expectedRevision: changed.data.revision } });
  const started = await request(api, 'POST', launch.path, { operation: launch });
  assert.equal(started.data.state, 'queued');
  const context = { ...options, settingsOwner: core.runtime.settingsOwner, principal: { audience: 'desktop', unitId: 'root:master' } };
  const consumed = await consumeStart(context, started.data.requestId);
  assert.equal(consumed.result.state, 'started'); assert.equal(launches.length, 1);
  assert.deepEqual(launches[0].runsIn, runsIn); assert.equal(launches[0].model, runsIn.model); assert.equal(launches[0].effort, runsIn.effort);
  assert.deepEqual(launches[0].launchScope.writeRoots, []);
  await stopSession(context, consumed.result.sessionId, { confirmed: true });
});

test('Git facts, bounded Changes and the reviewed editor are read-only; link removal and Undo preserve files', async t => {
  const { api, fixture, directory, core } = await world(t);
  const report = (await request(api, 'GET', '/settings/projects')).data, offer = report.discoveryOffer;
  await start.answerRepositoryOffer(api, offer.id, { machine: fixture.machine, repositoryIds: [...repositorySelection(offer)], confirmed: true, expectedRevision: offer.revision });
  const cluster = (await start.getClusters(api)).data.items.find(item => item.link.kind === 'repository');
  await writeFile(path.join(directory, 'source.txt'), 'Uncommitted work.\n');
  const before = await legacyTreeInventory(fixture.home);
  const git = (await start.getClusterGit(api, cluster.id, fixture.machine)).data;
  assert.equal(git.branch, 'main'); assert.equal(git.dirtyCount, 1);
  const changes = (await start.getClusterChanges(api, cluster.id, fixture.machine, { limit: 1 })).data;
  assert.equal(changes.items[0].path, 'source.txt'); assert.equal(changes.total, 1);
  await assert.rejects(start.openClusterEditor(api, cluster.id, fixture.machine), { code: 'editor_unavailable' });
  let opened;
  core.runtime.settingsOwner.editorLauncher = { reviewed: true, open: async input => { opened = input; return { requestId: 'reviewed-editor' }; } };
  await start.openClusterEditor(api, cluster.id, fixture.machine); assert.equal(opened.path, directory); assert.equal(opened.shell, false);
  const detached = await start.removeClusterLink(api, cluster.id, { machine: fixture.machine, expectedRevision: cluster.revision });
  assert.equal((await start.getClusters(api)).data.items.find(item => item.id === cluster.id).link.kind, 'none');
  const undo = createOperation({ method: 'POST', path: '/changes/:changeId/undo', params: { changeId: detached.data.changeId }, body: {} });
  await request(api, 'POST', undo.path, { operation: undo });
  assert.equal((await start.getClusters(api)).data.items.find(item => item.id === cluster.id).link.kind, 'repository');
  assert.deepEqual(await legacyTreeInventory(fixture.home), before);
  assert.equal(await readFile(path.join(directory, 'source.txt'), 'utf8'), 'Uncommitted work.\n');
});
