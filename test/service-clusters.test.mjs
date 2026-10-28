import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createCluster, listClusters, migrateClusters, patchCluster, rawClusters, readCluster, readClusterMappings, removeCluster, validateClusterBundle } from '../engine/service/clusters.mjs';
import { createGroup, projectGroup } from '../engine/service/groups.mjs';
import { postChat } from '../engine/service/chats.mjs';
import { createSettingsOwner, answerDiscoveryOffer, createClusterLink, discoveryOffer, publishMachineSettings, readMachineSettings, removeClusterLink } from '../engine/service/settings.mjs';
import { composeCore, writeBeat } from '../engine/service/service.mjs';
import { createUnit, resolveUnitCluster } from '../engine/service/units.mjs';
import { clusterMembers } from '../engine/service/cluster-policy.mjs';
import { readProjection } from '../engine/service/projection.mjs';
import { createStore, revisionOf, undoChange, withReceipt } from '../engine/service/store.mjs';
import { legacyTreeInventory } from '../engine/legacy-copy.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function world(t) {
  const fixture = await makeCoreFixture(), cleanups = [];
  t.after(async () => {
    try { for (const cleanup of cleanups.toReversed()) await cleanup(); }
    finally { await dispose(fixture); }
  });
  for (const name of ['one', 'two']) {
    await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
    await writeFile(path.join(fixture.paths.mind, 'user', 'state', `${name}.md`), `unit: ${name}\nunit-id: root:${name}\nrole: executor\nstate: out\nlead-id: root:overseer\n\nRetained.\n`);
  }
  const gitRunner = async (_exe, args, options) => {
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true); assert.equal(options.env.GIT_OPTIONAL_LOCKS, '0');
    if (args.includes('rev-parse')) return { stdout: args.includes('--show-toplevel') ? `${options.cwd}\n` : `${path.join(options.cwd, '.git')}\n` };
    if (args.includes('worktree')) return { stdout: `worktree ${options.cwd}\0HEAD ${'a'.repeat(40)}\0branch refs/heads/main\0\0` };
    if (args.includes('config')) return { stdout: '', code: 1 };
    throw new Error('Unexpected Git operation');
  };
  const context = createSettingsOwner({ ...fixture, now: () => fixture.clock.now, homeDir: fixture.home, env: { PATH: '' }, projects: [], gitRunner, probeAgents: async () => ({}) });
  context.ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: context.now, machine: fixture.machine });
  return { fixture, context, cleanups };
}
function file(context, id) { return path.join(context.paths.mind, 'user', 'gui', 'groups', `${id}.json`); }
async function legacyGroup(context, title, members) {
  const group = await createGroup(context, { title, members });
  const record = JSON.parse(await readFile(file(context, group.id)));
  delete record.link; delete record.parentId; record.format = 'hivem1nd-group-v1'; // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  await writeFile(file(context, group.id), JSON.stringify(record));
  return projectGroup(await readFile(file(context, group.id)), group.id);
}

test('migration retains active/deleted UUIDs, chats, messages, leads, ambiguity and old guarded Undo', async t => {
  const { fixture, context } = await world(t);
  const one = await legacyGroup(context, 'One', ['root:one']);
  const two = await legacyGroup(context, 'Two', ['root:one', 'root:two']);
  const deleted = await legacyGroup(context, 'Archived', ['root:two']);
  const archived = await removeCluster(context, deleted.id, { machine: fixture.machine, confirmed: true, expectedRevision: deleted.revision });
  const message = await postChat(context, one.id, { body: 'Retained history' });
  const chatBefore = await readFile(path.join(context.paths.mind, 'user', 'relay', 'chats', one.id, 'chat.md'));
  await migrateClusters(context);
  const records = await rawClusters(context);
  assert.deepEqual(records.map(item => item.cluster.id).sort(), [one.id, two.id, deleted.id].sort());
  assert.ok(records.every(item => item.record.format === 'hivem1nd-cluster-v1')); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  const view = await readProjection(context);
  assert.equal(view.units.find(unit => unit.id === 'root:one').clusterAmbiguous, true);
  await assert.rejects(resolveUnitCluster(context, 'root:one'), { code: 'scope_unresolved' });
  assert.equal(await resolveUnitCluster(context, 'root:two'), two.id);
  assert.ok(view.units.every(unit => unit.leadId === 'root:overseer'));
  assert.ok(view.messages.some(item => item.id === message.message.id));
  assert.deepEqual(await readFile(path.join(context.paths.mind, 'user', 'relay', 'chats', one.id, 'chat.md')), chatBefore);
  await undoChange(context, archived.changeId);
  assert.equal((await rawClusters(context)).find(item => item.cluster.id === deleted.id).cluster.deleted, false);
  const before = await legacyTreeInventory(context.paths.mind), localBefore = await legacyTreeInventory(context.paths.localDirectory);
  await migrateClusters(context);
  assert.deepEqual(await legacyTreeInventory(context.paths.mind), before);
  assert.deepEqual(await legacyTreeInventory(context.paths.localDirectory), localBefore);
});

test('migration journal recovers a partial upgrade without duplicating UUIDs or chats', async t => {
  const { fixture, context } = await world(t);
  const one = await legacyGroup(context, 'Old', ['root:one']);
  fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(migrateClusters(context), { code: 'injected_crash' });
  const store = createStore({ root: fixture.root, confineRoot: fixture.root, mindPath: fixture.paths.mind, localDirectory: fixture.paths.localDirectory, now: context.now });
  store.aclRunner = fixture.store.aclRunner;
  await migrateClusters({ ...context, store });
  assert.equal((await listClusters({ ...context, store })).total, 1);
  assert.equal((await rawClusters({ ...context, store }))[0].cluster.id, one.id);
  assert.equal((await readProjection({ ...context, store })).chats.length, 1);
});

test('a concurrent edit during migration keeps foreign bytes, old Undo and every recovery journal', async t => {
  const { fixture, context } = await world(t);
  await legacyGroup(context, 'Active', ['root:one']);
  const archived = await legacyGroup(context, 'Archived', ['root:two']);
  const removal = await removeCluster(context, archived.id, { machine: fixture.machine, confirmed: true, expectedRevision: archived.revision });
  fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(migrateClusters(context), { code: 'injected_crash' });
  const state = path.join(context.paths.mind, 'user', 'state', 'one.md');
  await writeFile(state, Buffer.concat([await readFile(state), Buffer.from('\nForeign context retained.\n')]));
  const store = createStore({ root: fixture.root, confineRoot: fixture.root, mindPath: fixture.paths.mind, localDirectory: fixture.paths.localDirectory, now: context.now });
  store.aclRunner = fixture.store.aclRunner;
  const resumed = { ...context, store };
  await migrateClusters(resumed);
  assert.match(await readFile(state, 'utf8'), /Foreign context retained/);
  const directory = path.join(context.paths.localDirectory, 'transactions');
  const journals = await Promise.all((await readdir(directory)).map(async name => JSON.parse(await readFile(path.join(directory, name)))));
  assert.ok(journals.some(record => record.phase === 'conflict' && record.additionAcceptance));
  await undoChange(resumed, removal.changeId);
  assert.equal((await listClusters(resumed)).total, 2);
});

test('accepted repositories migrate; discoveries remain offers and imports preserve every source byte', async t => {
  const { fixture, context } = await world(t);
  const accepted = path.join(fixture.home, 'Web', 'accepted'), found = path.join(fixture.home, 'Web', 'new');
  for (const directory of [accepted, found]) { await mkdir(path.join(directory, '.git'), { recursive: true }); await writeFile(path.join(directory, 'source.txt'), 'Unchanged.'); }
  const before = await legacyTreeInventory(fixture.home);
  context.projects.push({ name: 'accepted', localPath: accepted });
  await migrateClusters(context);
  let clusters = (await listClusters(context)).items;
  assert.equal(clusters.length, 2);
  assert.equal(clusters.find(item => item.link.kind === 'repository').members.length, 0);
  const offer = await discoveryOffer(context);
  assert.deepEqual(offer.groups.flatMap(group => group.repositories.map(item => item.name)), ['new']);
  assert.equal((await listClusters(context)).total, 2);
  const key = randomUUID(), input = { machine: fixture.machine, repositoryIds: [offer.groups[0].repositories[0].id], confirmed: true, expectedRevision: offer.revision };
  const request = { principal: 'desktop', key, requestId: randomUUID(), method: 'POST', path: `/discovery/offers/${offer.id}/answer`, body: input };
  const result = await withReceipt(context.store, request, receipt => answerDiscoveryOffer({ ...context, receipt }, offer.id, input));
  const replay = await withReceipt(context.store, request, () => { throw new Error('Must replay'); });
  assert.equal(replay.replayed, true);
  assert.deepEqual(result, replay.body);
  assert.equal((await listClusters(context)).total, 3);
  const imported = result.clusters[0];
  const detached = await removeClusterLink(context, imported.id, { machine: fixture.machine, confirmed: true, expectedRevision: imported.revision });
  assert.equal((await readCluster(context, imported.id, { machine: fixture.machine })).link.kind, 'none');
  await undoChange(context, detached.changeId);
  assert.equal((await readCluster(context, imported.id, { machine: fixture.machine })).link.kind, 'repository');
  assert.deepEqual(await legacyTreeInventory(fixture.home), before);
});

test('Not now persists across reopen, empty acceptance creates no tree, worktree IDs cannot inflate selection', async t => {
  const { fixture, context } = await world(t);
  await mkdir(path.join(fixture.home, 'repo', '.git'), { recursive: true });
  const offer = await discoveryOffer(context), repository = offer.groups[0].repositories[0];
  await assert.rejects(answerDiscoveryOffer(context, offer.id, { machine: fixture.machine, repositoryIds: [repository.worktrees[0].id], confirmed: true, expectedRevision: offer.revision }), { code: 'invalid_body' });
  const result = await answerDiscoveryOffer(context, offer.id, { machine: fixture.machine, repositoryIds: [], confirmed: false, expectedRevision: offer.revision });
  assert.deepEqual(result.clusters, []);
  assert.equal((await discoveryOffer({ ...context })).dismissed, true);
  assert.equal((await listClusters(context)).total, 0);
  await assert.rejects(answerDiscoveryOffer(context, offer.id, { machine: fixture.machine, repositoryIds: [], confirmed: true, expectedRevision: offer.revision }), { code: 'revision_conflict' });
});

test('a missing or unconfined discovery root produces an empty persisted offer without scanning a foreign home', async t => {
  const { fixture, context } = await world(t);
  context.discoveryRoots = [path.join(fixture.root, 'missing'), path.dirname(fixture.root)];
  context.gitRunner = async () => { throw new Error('No Git operation is authorized outside the fixture.'); };
  const offer = await discoveryOffer(context);
  assert.deepEqual(offer.groups, []);
  assert.equal((await discoveryOffer(context)).id, offer.id);
  assert.equal((await listClusters(context)).total, 0);
});

test('empty clusters, nested scope, cycle and owner checks, removal and guarded Undo share one collection', async t => {
  const { fixture, context } = await world(t);
  const root = await createCluster(context, { title: 'Folder', parentId: null, link: { kind: 'none' }, machine: fixture.machine, confirmed: true });
  const child = await createCluster(context, { title: 'Repository', parentId: root.id, link: { kind: 'none' }, machine: fixture.machine, confirmed: true, members: ['root:one'] });
  assert.deepEqual(clusterMembers((await listClusters(context)).items, [root.id], (await readProjection(context)).units), ['root:one']);
  await assert.rejects(patchCluster(context, root.id, { parentId: child.id, machine: fixture.machine, expectedRevision: root.revision }), { code: 'cluster_cycle' });
  await assert.rejects(removeCluster(context, root.id, { confirmed: true, machine: fixture.machine, expectedRevision: root.revision }), { code: 'cluster_has_children' });
  await assert.rejects(readCluster(context, root.id, { machine: 'OFFLINE' }), { code: 'machine_unavailable' });
  await assert.rejects(createCluster({ ...context, principal: { audience: 'agent' } }, { title: 'Denied', parentId: null, link: { kind: 'none' }, machine: fixture.machine, confirmed: true }), { code: 'forbidden' });
  const removed = await removeCluster(context, child.id, { machine: fixture.machine, confirmed: true, expectedRevision: child.revision });
  assert.equal((await listClusters(context)).total, 1);
  await undoChange(context, removed.changeId);
  assert.equal((await readProjection(context)).groups.length, (await listClusters(context)).total);
  await assert.rejects(validateClusterBundle(context, [{ target: { kind: 'mind', path: `user/gui/groups/${root.id}.json` }, bytes: Buffer.from(JSON.stringify({ ...JSON.parse(await readFile(file(context, root.id))), parentId: child.id })) }]), { code: 'cluster_cycle' });
});

test('reviewed links create no agents or imports and shared reports never contain private cluster roots', async t => {
  const { fixture, context } = await world(t);
  const directory = path.join(fixture.root, 'private-folder'); await mkdir(directory);
  const report = await publishMachineSettings(context);
  const link = await createClusterLink(context, { machine: fixture.machine, kind: 'folder', path: directory, expectedReportRevision: report.projects.revision });
  assert.equal((await listClusters(context)).total, 0);
  const cluster = await createCluster(context, { title: 'Reviewed folder', parentId: null, link: link.link, machine: fixture.machine, confirmed: true });
  const published = await publishMachineSettings(context);
  assert.equal(published.clusterLinks.find(item => item.clusterId === cluster.id).localPath, null);
  assert.equal(JSON.stringify(published).includes(directory), false);
  assert.equal((await readMachineSettings(context, fixture.machine, 'projects')).clusterLinks.find(item => item.clusterId === cluster.id).localPath, directory);
  const mappings = await readClusterMappings(context);
  assert.equal(mappings.record.links[`folder:${link.link.folderId}`].localPath, directory);
});

test('cluster agents derive stable names, owner and nearest lead while retaining existing reporting fields', async t => {
  const { fixture, context } = await world(t);
  context.paths = { ...context.paths, origin: path.join(fixture.root, 'origin') };
  await writeBeat(context, 'running');
  const root = await createCluster(context, { title: 'Team', parentId: null, link: { kind: 'none' }, machine: fixture.machine, confirmed: true });
  const first = (await createUnit(context, { role: 'overlord', clusterId: root.id, machine: fixture.machine })).unit;
  const child = await createCluster(context, { title: 'Child', parentId: root.id, link: { kind: 'none' }, machine: fixture.machine, confirmed: true });
  const one = (await createUnit(context, { role: 'executor', clusterId: child.id, machine: fixture.machine })).unit;
  const two = (await createUnit(context, { role: 'executor', clusterId: child.id, machine: fixture.machine })).unit;
  assert.equal(one.leadId, first.id); assert.equal(two.leadId, first.id);
  assert.equal(two.unit, `${one.unit}-2`); assert.equal(one.machine, fixture.machine); assert.equal(one.clusterId, child.id);
  assert.ok((await readCluster(context, child.id, { machine: fixture.machine })).members.includes(two.id));
  assert.ok((await readProjection(context)).units.filter(unit => ['root:one', 'root:two'].includes(unit.id)).every(unit => unit.leadId === 'root:overseer'));
  // A lead chosen on the Map, by dropping a connection on empty space, wins over the cluster's own.
  const chosen = (await createUnit(context, { role: 'executor', clusterId: child.id, machine: fixture.machine, leadId: one.id })).unit;
  assert.equal(chosen.leadId, one.id);
  await assert.rejects(createUnit(context, { role: 'executor', clusterId: child.id, machine: fixture.machine, leadId: 'root:missing' }), { code: 'invalid_lead' });
});

test('HTTP clusters enforce exact bodies, explicit owner and replay without exposing phone mutations', async t => {
  const { fixture, context, cleanups } = await world(t);
  const core = await composeCore({ ...context, origin: fixture.paths.origin, projects: [] }); cleanups.push(() => core.http.close());
  const origin = `http://127.0.0.1:${core.http.port}`;
  const login = await fetch(`${origin}/api/v1/auth/local`, { method: 'POST', headers: { origin, authorization: `Bearer ${core.bootstrap.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ embedded: false, hostOrigin: null, look: null, language: null }) });
  const token = (await login.json()).data.token;
  const call = async (method, route, body, key = randomUUID()) => {
    const response = await fetch(`${origin}/api/v1${route}`, { method, headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, value: await response.json() };
  };
  const input = { title: 'Empty', parentId: null, link: { kind: 'none' }, machine: fixture.machine, confirmed: true }, key = randomUUID();
  assert.equal((await call('POST', '/clusters', { ...input, extra: true })).status, 400);
  const created = await call('POST', '/clusters', input, key); assert.equal(created.status, 201);
  assert.deepEqual((await call('POST', '/clusters', input, key)).value.data, created.value.data);
  assert.equal((await call('GET', `/clusters/${created.value.data.id}?machine=OFFLINE`)).status, 409);
  assert.equal((await call('GET', `/clusters/${created.value.data.id}`)).status, 422);
  assert.equal((await call('GET', '/clusters')).value.data.total, 1);
  await createGroup(context, { title: 'Choice one', members: ['root:one'] });
  await createGroup(context, { title: 'Choice two', members: ['root:one'] });
  const unit = (await call('GET', '/units/root%3Aone')).value.data;
  const launch = await call('POST', '/units/root%3Aone/session', { prompt: 'Fixture task', expectedRevision: unit.revision });
  assert.equal(launch.status, 409); assert.equal(launch.value.error.code, 'scope_unresolved');
});

test('a cluster agent takes any preset role or a custom one with its own name and description', async t => {
  const { fixture, context } = await world(t);
  context.paths = { ...context.paths, origin: path.join(fixture.root, 'origin') };
  await writeBeat(context, 'running');
  const team = await createCluster(context, { title: 'Team', parentId: null, link: { kind: 'none' }, machine: fixture.machine, confirmed: true });
  const create = (input) => createUnit(context, { clusterId: team.id, machine: fixture.machine, ...input });
  const security = (await create({ role: 'security-consultant' })).unit;
  assert.match(security.unit, /^security-consultant-/);
  assert.match((await create({ role: 'helper' })).unit.unit, /^helper-/);
  await assert.rejects(create({ role: 'qa', roleName: 'QA' }), { code: 'invalid_body' });
  await assert.rejects(create({ role: 'custom' }), { code: 'invalid_body' });
  await assert.rejects(create({ role: 'custom', roleName: 'Two\nlines', roleDescription: 'Text' }), { code: 'invalid_body' });
  await assert.rejects(create({ role: 'custom', roleName: 'Long', roleDescription: 'x'.repeat(4001) }), { code: 'invalid_body' });
  await assert.rejects(create({ role: 'overseer' }), { code: 'invalid_role' });
  const description = 'Helps the person decide.\nLists the options and recommends one.';
  const consultant = (await create({ role: 'custom', roleName: 'Consultor de decisiones', roleDescription: description })).unit;
  assert.match(consultant.unit, /^consultor-de-decisiones-/);
  const units = (await readProjection(context)).units;
  const projected = units.find(unit => unit.id === consultant.id);
  assert.equal(projected.role, 'custom');
  assert.equal(projected.roleName, 'Consultor de decisiones');
  assert.equal(projected.roleDescription, description);
  assert.equal(projected.malformed, false);
  const preset = units.find(unit => unit.id === security.id);
  assert.equal(preset.role, 'security-consultant');
  assert.equal(preset.roleName, null);
  const state = await readFile(path.join(context.paths.mind, 'user', 'state', `${consultant.unit}.md`), 'utf8');
  assert.ok(state.split('\n').includes(`role-description: ${JSON.stringify(description)}`), 'the description stays on one header line');
});
