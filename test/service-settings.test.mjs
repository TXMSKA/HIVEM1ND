import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createSettingsOwner, findAgent, mutateMachineSettings, processSettingsRequests, publishMachineSettings, readContent, readMachineSettings, readPublishedSettings, scanAgents, writeContent } from '../engine/service/settings.mjs';
import { createStore } from '../engine/service/store.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { composeCore, writeBeat } from '../engine/service/service.mjs';
import { machineSettingsPath, writeMachineRecord } from '../engine/records.mjs';
import { legacyTreeInventory } from '../engine/legacy-copy.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function setup(t) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const kitPath = path.join(fixture.root, 'kit');
  const write = async (relative, value) => {
    const file = path.join(kitPath, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value);
  };
  for (const [name, category] of [['plan', 'planning'], ['qa', 'quality'], ['relay', 'continuity'], ['extra', 'custom']]) {
    await write(`features/${name}/SKILL.md`, `---\nname: ${name}\ncategory: ${category}\n---\n\n# ${name}\n`);
  }
  await write('knowledge/security/security.md', '# Security\n');
  await write('knowledge/coding/coding.md', '# Coding\n');
  await write('package.json', JSON.stringify({ name: 'fixture-kit', files: ['features/', 'knowledge/'] }));
  await writeMachineRecord(fixture.paths.mind, fixture.machine, { machine: fixture.machine, mind: fixture.paths.mind, setup: 'done', agents: [{ name: 'codex', mode: 'auto' }], excluded: ['feature:qa'], paths: [], managedFiles: {}, keepExistingPreferences: true, updateCheck: 'daily' });
  const owner = createSettingsOwner({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, kitPath, homeDir: fixture.home, env: { PATH: '' },
    bus: createEventBus({ machine: fixture.machine, now: () => fixture.clock.now }), projects: [{ name: 'shop', localPath: path.join(fixture.root, 'projects', 'shop') }],
    probeAgents: async () => ({ codex: { installed: true, version: '1.2.3', secret: 'probe-private-value', config: 'client-configuration-value' } }) });
  const domain = { ...owner, settingsOwner: owner };
  return { fixture, owner, domain, kitPath };
}

test('reports keep machine locations, registered projects, found versions and CLI/app facts without private material', async t => {
  const { fixture, owner, domain } = await setup(t);
  const report = await publishMachineSettings(owner);
  assert.equal(report.locations.mind, fixture.paths.mind);
  assert.equal(report.locations.staging, fixture.paths.staging);
  assert.equal(report.service.startWithWindows, false);
  assert.equal(report.agents.items.find(item => item.id === 'codex').version, '1.2.3');
  assert.equal(report.agents.items.find(item => item.id === 'codex').mode, 'auto');
  assert.equal(report.agents.items.find(item => item.id === 'codex').cli.state, 'changes-needed');
  assert.equal(report.agents.items.find(item => item.id === 'claude').cli.state, 'missing');
  assert.equal(report.agents.items.find(item => item.id === 'codex').app.state, 'missing');
  assert.equal(report.projects.folders[0].repositories[0].id, 'shop');
  const serialized = JSON.stringify(report);
  for (const name of ['probe-private-value', 'client-configuration-value', 'privateKey', 'afterText', 'endpoint', 'keptCopies']) assert.equal(serialized.includes(name), false);
  assert.equal((await readMachineSettings(domain)).readOnly, false);
  const file = machineSettingsPath(fixture.paths.mind, fixture.machine);
  const modified = JSON.parse(await readFile(file));
  modified.locations.staging = 'tampered';
  await writeFile(file, JSON.stringify(modified));
  await assert.rejects(readPublishedSettings(domain, fixture.machine), { code: 'corrupt_resource' });
});

test('an offline selection retains the last report and every mutation makes zero local configuration writes', async t => {
  const { fixture, owner, domain } = await setup(t);
  const laptopStore = createStore({ root: fixture.root, mindPath: fixture.paths.mind, localDirectory: path.join(fixture.root, 'laptop'), confineRoot: fixture.root, now: owner.now });
  laptopStore.aclRunner = fixture.store.aclRunner;
  const laptop = createSettingsOwner({ ...owner, store: laptopStore, paths: { ...owner.paths, machine: 'LAPTOP', localDirectory: laptopStore.localDirectory, staging: path.join(laptopStore.localDirectory, 'staging') }, key: null });
  const last = await publishMachineSettings(laptop);
  const before = await legacyTreeInventory(fixture.home);
  const beforeLocal = await legacyTreeInventory(fixture.paths.localDirectory);
  for (const section of [null, 'agents', 'permissions', 'projects']) {
    const detail = await readMachineSettings(domain, 'LAPTOP', section);
    assert.equal(detail.readOnly, true);
    assert.equal(detail.reportedAt, last.reportedAt);
    if (!section) assert.equal(detail.locations.staging, laptop.paths.staging);
  }
  for (const [operation, input] of [
    ['scan', {}], ['find', { client: 'codex', path: path.join(fixture.home, 'codex.cmd') }],
    ['preview', { mode: 'auto', target: 'cli', allowGit: false }], ['apply', { previewId: '11111111-1111-4111-8111-111111111111', changeIds: [], expectedRevision: null }],
    ['disconnect', { confirmed: true, expectedRevision: 'a'.repeat(64) }], ['revoke', { expectedRevision: 'a'.repeat(64) }],
    ['folder', { path: fixture.home, environment: null, expectedRevision: null }], ['removeProject', { confirmed: true, expectedRevision: 'a'.repeat(64) }],
    ['service', { startWithWindows: true, expectedRevision: null }], ['restart', {}],
  ]) await assert.rejects(mutateMachineSettings(domain, operation, { machine: 'LAPTOP', ...input }), { code: 'machine_unavailable' });
  assert.deepEqual(await legacyTreeInventory(fixture.home), before);
  assert.deepEqual(await legacyTreeInventory(fixture.paths.localDirectory), beforeLocal);
});

test('scan and find use installed known paths, preserve configuration, and reject unavailable, malformed and foreign paths', async t => {
  const { fixture, owner, domain } = await setup(t);
  const before = await legacyTreeInventory(fixture.home);
  const scanned = await scanAgents(domain, { machine: fixture.machine });
  assert.equal(scanned.body.items.find(item => item.id === 'codex').version, '1.2.3');
  const second = await scanAgents(domain, { machine: fixture.machine });
  assert.equal(second.body.revision, scanned.body.revision);
  assert.deepEqual(await legacyTreeInventory(fixture.home), before);
  await assert.rejects(findAgent(domain, { machine: fixture.machine, client: 'codex', path: 'relative' }), { code: 'invalid_path' });
  await assert.rejects(findAgent(domain, { machine: fixture.machine, client: 'codex', path: path.join(fixture.home, 'codex.cmd') }), { code: 'invalid_path' });
  const custom = path.join(fixture.root, 'known-client', 'codex.cmd');
  await mkdir(path.dirname(custom));
  await writeFile(custom, 'This file must never execute.\n');
  const found = await findAgent(domain, { machine: fixture.machine, client: 'codex', path: custom });
  assert.equal(found.body.items.find(item => item.id === 'codex').found, true);
  await assert.rejects(findAgent(domain, { machine: fixture.machine, client: 'foreign', path: custom }), { code: 'invalid_body' });
  await assert.rejects(findAgent(domain, { machine: fixture.machine, client: 'claude', path: custom }), { code: 'invalid_path' });
  await assert.rejects(scanAgents(domain, { machine: fixture.machine, unknown: true }), { code: 'unknown_field' });
  await assert.rejects(scanAgents({ ...domain, principal: { audience: 'agent' } }, { machine: fixture.machine }), { code: 'forbidden' });
  assert.equal(await readFile(custom, 'utf8'), 'This file must never execute.\n');
  owner.probeAgents = async () => ({});
  const reopened = await scanAgents(domain, { machine: fixture.machine });
  assert.equal(reopened.body.items.find(item => item.id === 'codex').found, true);
});

test('Content retains all categories, knowledge packs and foreign preferences, with shared selections and exact revisions', async t => {
  const { fixture, domain, owner } = await setup(t);
  const file = path.join(fixture.paths.mind, 'user', 'preferences.md');
  const foreign = 'Existing foreign preferences.\n';
  await writeFile(file, foreign);
  const content = await readContent(domain);
  assert.deepEqual(new Set(content.features.map(item => item.category)), new Set(['planning', 'quality', 'continuity', 'other']));
  assert.equal(content.features.find(item => item.id === 'feature:qa').included, false);
  assert.deepEqual(new Set(content.knowledge.map(item => item.id)), new Set(['knowledge:coding', 'knowledge:security']));
  const body = { includedFeatures: ['feature:plan'], includedKnowledge: ['knowledge:security'], preferences: { addressStyle: 'formal', additionalInstructions: 'Retain my project conventions.', keepExistingPreferencesFirst: true, updateChecks: 'daily' }, expectedRevision: null };
  const beforeClients = await legacyTreeInventory(fixture.home);
  const written = await writeContent(domain, body);
  assert.equal(written.preferences.addressStyle, 'formal');
  assert.ok((await readFile(file, 'utf8')).startsWith(foreign));
  assert.deepEqual(await legacyTreeInventory(fixture.home), beforeClients);
  assert.deepEqual((await readContent({ ...domain, paths: { ...owner.paths, machine: 'LAPTOP' } })).preferences, written.preferences);
  await assert.rejects(writeContent(domain, body), { code: 'revision_conflict' });
  await assert.rejects(writeContent(domain, { ...body, expectedRevision: written.revision, preferences: { ...body.preferences, extra: true } }), { code: 'unknown_field' });
  const changed = await writeContent(domain, { ...body, expectedRevision: written.revision, preferences: { ...body.preferences, keepExistingPreferencesFirst: false, additionalInstructions: 'Updated instructions.' } });
  assert.ok((await readFile(file, 'utf8')).endsWith(foreign));
  await writeFile(file, (await readFile(file, 'utf8')).replace('Updated instructions.', 'Foreign edit.'));
  const before = await readFile(file);
  await assert.rejects(writeContent(domain, { ...body, expectedRevision: changed.revision }), { code: 'configuration_changed' });
  assert.deepEqual(await readFile(file), before);
});

test('remote requests execute on their authenticated selected owner once, with stale/expired requests and forged answers refused', async t => {
  const { fixture, owner, domain } = await setup(t);
  fixture.paths.origin = path.join(fixture.root, 'origin');
  owner.paths.origin = fixture.paths.origin;
  domain.paths.origin = fixture.paths.origin;
  await mkdir(fixture.paths.origin);
  const store = createStore({ root: fixture.root, mindPath: fixture.paths.mind, localDirectory: path.join(fixture.root, 'laptop'), confineRoot: fixture.root, now: owner.now });
  store.aclRunner = fixture.store.aclRunner;
  let scans = 0;
  const laptop = createSettingsOwner({ ...owner, store, paths: { ...owner.paths, machine: 'LAPTOP', localDirectory: store.localDirectory, staging: path.join(store.localDirectory, 'staging') }, probeAgents: async () => { scans += 1; return { codex: { installed: true, version: 'laptop-version' } }; } });
  await publishMachineSettings(owner);
  await publishMachineSettings(laptop);
  await writeBeat({ store, paths: laptop.paths, now: owner.now }, 'running');
  scans = 0;
  const before = await legacyTreeInventory(fixture.home);
  const pump = async () => {
    for (let index = 0; index < 30; index += 1) {
      await processSettingsRequests(laptop);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const changed = mutateMachineSettings({ ...domain, receipt: { key: '11111111-1111-4111-8111-111111111111', principalHash: 'fixture' } }, 'scan', { machine: 'LAPTOP' });
  await pump();
  const result = await changed;
  assert.equal(result.body.machine, 'LAPTOP');
  assert.equal(result.body.items.find(item => item.id === 'codex').version, 'laptop-version');
  assert.equal(scans, 1);
  await processSettingsRequests(laptop);
  assert.equal(scans, 1);
  assert.deepEqual(await legacyTreeInventory(fixture.home), before);
  const stale = mutateMachineSettings({ ...domain, operationId: 'stale' }, 'service', { machine: 'LAPTOP', startWithWindows: true, expectedRevision: 'a'.repeat(64) });
  const staleRejection = assert.rejects(stale, { code: 'revision_conflict' });
  await pump(); await staleRejection;
  const expired = mutateMachineSettings({ ...domain, operationId: 'expired' }, 'scan', { machine: 'LAPTOP' });
  const expiredRejection = assert.rejects(expired, { code: 'machine_unavailable' });
  await new Promise(resolve => setTimeout(resolve, 30));
  fixture.clock.now += 31000;
  await pump(); await expiredRejection;
  assert.equal(scans, 1);
});

test('composed services route a remote mutation through origin sync and return the selected owner report', async t => {
  const fixture = await makeCoreFixture();
  const cores = [];
  t.after(async () => { for (const core of cores) await core.http.close(); await dispose(fixture); });
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin);
  const otherMind = path.join(fixture.root, 'laptop-mind');
  const otherPaths = servicePaths({ platform: fixture.platform, env: fixture.env, home: fixture.home, mindPath: otherMind, machine: 'LAPTOP', originPath: origin });
  const otherLocal = otherPaths.localDirectory;
  await mkdir(path.join(otherMind, 'user'), { recursive: true });
  const otherStore = createStore({ root: fixture.root, confineRoot: fixture.root, mindPath: otherMind, localDirectory: otherLocal, now: Date.now });
  otherStore.aclRunner = fixture.store.aclRunner;
  let scans = 0;
  const common = { now: Date.now, env: { PATH: '' }, homeDir: fixture.home, projects: [], clients: [], settingsTimeoutMs: 10000 };
  const desktop = await composeCore({ ...common, store: fixture.store, paths: { ...fixture.paths, origin }, probeAgents: async () => ({}) });
  cores.push(desktop);
  const laptop = await composeCore({ ...common, store: otherStore, paths: otherPaths, probeAgents: async () => { scans += 1; return {}; } });
  cores.push(laptop);
  const domain = { ...desktop.runtime.settingsOwner, settingsOwner: desktop.runtime.settingsOwner, operationId: 'composed-remote-scan' };
  const deadline = Date.now() + 10000;
  while (!await readPublishedSettings(domain, 'LAPTOP') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(await readPublishedSettings(domain, 'LAPTOP'));
  const before = scans;
  const result = await scanAgents(domain, { machine: 'LAPTOP' });
  assert.equal(result.body.machine, 'LAPTOP');
  assert.equal(scans, before + 1);
  assert.ok((await readMachineSettings(domain, 'LAPTOP', 'agents')).revision);
});
