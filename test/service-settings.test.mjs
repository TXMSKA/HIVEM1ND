import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createSettingsOwner, findAgent, mutateMachineSettings, processSettingsRequests, publishMachineSettings, readContent, readMachineSettings, readPublishedSettings, scanAgents, writeContent } from '../engine/service/settings.mjs';
import { createProjectionCache, createStore, noteProjectionChange } from '../engine/service/store.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { composeCore, writeBeat } from '../engine/service/service.mjs';
import { machineSettingsPath, writeMachineRecord } from '../engine/records.mjs';
import { legacyTreeInventory } from '../engine/legacy-copy.mjs';
import { clientConfigPaths } from '../engine/relay/config.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { createGuiFixture } from './gui-fixture.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';

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
  const pump = async pending => {
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });
    do {
      await processSettingsRequests(laptop);
      if (!settled) await new Promise(resolve => setTimeout(resolve, 10));
    } while (!settled);
    return pending;
  };
  const changed = mutateMachineSettings({ ...domain, receipt: { key: '11111111-1111-4111-8111-111111111111', principalHash: 'fixture' } }, 'scan', { machine: 'LAPTOP' });
  const result = await pump(changed);
  assert.equal(result.body.machine, 'LAPTOP');
  assert.equal(result.body.items.find(item => item.id === 'codex').version, 'laptop-version');
  assert.equal(scans, 1);
  await processSettingsRequests(laptop);
  assert.equal(scans, 1);
  assert.deepEqual(await legacyTreeInventory(fixture.home), before);
  const stale = mutateMachineSettings({ ...domain, operationId: 'stale' }, 'service', { machine: 'LAPTOP', startWithWindows: true, expectedRevision: 'a'.repeat(64) });
  const staleRejection = assert.rejects(stale, { code: 'revision_conflict' });
  await pump(staleRejection);
  let publishRequest;
  const requestPublished = new Promise(resolve => { publishRequest = resolve; });
  const expired = mutateMachineSettings({ ...domain, operationId: 'expired', pulse: { changed: async () => publishRequest() } }, 'scan', { machine: 'LAPTOP' });
  const expiredRejection = assert.rejects(expired, { code: 'machine_unavailable' });
  // The sync pulse runs after commit, so expiry starts before advancing the fixture clock.
  await requestPublished;
  fixture.clock.now += 31000;
  await pump(expiredRejection);
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

async function reviewWorld(t) {
  const world = await setup(t);
  const { fixture, domain } = world;
  const content = await readContent(domain);
  await writeContent(domain, { includedFeatures: [], includedKnowledge: [], preferences: content.preferences, expectedRevision: content.revision });
  const paths = clientConfigPaths({ client: 'cursor', homeDir: fixture.home });
  const secret = randomBytes(24).toString('hex');
  const originals = { mcp: Buffer.from(JSON.stringify({ token: secret, mcpServers: { other: { command: 'foreign', env: { CREDENTIAL: secret } } } })), hooks: Buffer.from(JSON.stringify({ version: 1, secret, hooks: { stop: [{ command: 'foreign-stop' }] } })) };
  await mkdir(path.dirname(paths.mcp), { recursive: true });
  for (const kind of ['mcp', 'hooks']) await writeFile(paths[kind], originals[kind]);
  await publishMachineSettings(world.owner);
  return { ...world, paths, secret, originals };
}

async function review(world, options = {}) {
  return (await mutateMachineSettings(world.domain, 'preview', { machine: world.fixture.machine, mode: 'on-demand', target: 'cli', ...options }, 'cursor')).body;
}

async function applyReview(world, preview, changeIds = preview.changes.filter(item => item.selected).map(item => item.id), client = 'cursor') {
  return (await mutateMachineSettings(world.domain, 'apply', { machine: world.fixture.machine, previewId: preview.previewId, changeIds, expectedRevision: preview.revision }, client)).body;
}

test('preview, clipboard copy and cancel leave the entire fixture unchanged, with two required changes and unchecked scoped Git', async t => {
  const world = await reviewWorld(t);
  const before = await legacyTreeInventory(world.fixture.root);
  for (const allowGit of [undefined, false, true]) {
    const preview = await review(world, allowGit === undefined ? {} : { allowGit });
    assert.deepEqual(preview.changes.filter(item => !item.optional).map(item => item.id), ['mcp', 'hooks']);
    assert.equal(preview.changes.find(item => item.id === 'git').selected, false);
    assert.equal(preview.restartRequired, true);
    const copied = preview.changes.map(item => `${item.path}\n${item.afterText}`).join('\n');
    assert.equal(copied.includes(world.secret), false);
    for (const item of preview.changes.filter(item => !item.optional)) assert.match(item.beforeHash, /^[a-f0-9]{64}$/);
    // Copy and Cancel consume only this redacted view, without an HTTP mutation.
    assert.equal(typeof copied, 'string');
  }
  assert.deepEqual(await legacyTreeInventory(world.fixture.root), before);
});

test('Apply writes only the selected subset, protects the kept original, and retries once even after an owner restart', async t => {
  const world = await reviewWorld(t);
  const preview = await review(world);
  const result = await applyReview(world, preview, ['mcp']);
  assert.equal(result.state, 'connected');
  assert.deepEqual(await readFile(world.paths.hooks), world.originals.hooks);
  assert.deepEqual(await readFile(`${world.paths.mcp}.relay-backup`), world.originals.mcp);
  const configured = JSON.parse(await readFile(world.paths.mcp));
  assert.equal(configured.token === world.secret, true);
  assert.equal(configured.mcpServers.other.env.CREDENTIAL === world.secret, true);
  assert.ok(world.fixture.store.aclRunner.calls.some(item => item.op === 'protect' && item.target === `${world.paths.mcp}.relay-backup`));
  assert.equal((await readMachineSettings(world.domain, world.fixture.machine, 'agents')).items.find(item => item.id === 'cursor').cli.state, 'changes-needed');
  const beforeRetry = await legacyTreeInventory(world.fixture.root);
  const restarted = createSettingsOwner({ ...world.owner, clientPreviews: undefined });
  const retry = { ...world, domain: { ...restarted, settingsOwner: restarted } };
  assert.deepEqual(await applyReview(retry, preview, ['mcp']), result);
  assert.deepEqual(await legacyTreeInventory(world.fixture.root), beforeRetry);
  await assert.rejects(applyReview(world, preview, ['hooks']), { code: 'configuration_changed' });
  await assert.rejects(readFile(path.join(world.fixture.paths.localDirectory, 'client-permissions.json')), { code: 'ENOENT' });
});

test('any reviewed file drift, target mismatch or expired preview refuses Apply without filesystem mutation', async t => {
  const world = await reviewWorld(t);
  let preview = await review(world);
  await writeFile(world.paths.hooks, 'changed after review');
  let before = await legacyTreeInventory(world.fixture.root);
  await assert.rejects(applyReview(world, preview, ['mcp']), { code: 'configuration_changed' });
  assert.deepEqual(await legacyTreeInventory(world.fixture.root), before);
  await writeFile(world.paths.hooks, world.originals.hooks);
  preview = await review(world);
  before = await legacyTreeInventory(world.fixture.root);
  await assert.rejects(applyReview(world, preview, ['mcp'], 'codex'), { code: 'configuration_changed' });
  await assert.rejects(mutateMachineSettings(world.domain, 'apply', { machine: 'LAPTOP', previewId: preview.previewId, changeIds: ['mcp'], expectedRevision: preview.revision }, 'cursor'), { code: 'machine_unavailable' });
  await assert.rejects(applyReview(world, preview, ['foreign']), { code: 'invalid_body' });
  world.fixture.clock.now += 600001;
  await assert.rejects(applyReview(world, preview), { code: 'configuration_changed' });
  assert.deepEqual(await legacyTreeInventory(world.fixture.root), before);
});

test('partial client and ownership writes roll back every file and newly created kept copy', async t => {
  for (const faultIndex of [1, 2]) {
    const world = await reviewWorld(t);
    const preview = await review(world);
    const before = await legacyTreeInventory(world.fixture.root);
    world.owner.configurationBeforeWrite = (change, index) => { if (index === faultIndex) throw new Error('Injected selected write failure.'); };
    await assert.rejects(applyReview(world, preview), /Injected selected write failure/);
    assert.deepEqual(await legacyTreeInventory(world.fixture.root), before);
    delete world.owner.configurationBeforeWrite;
    assert.equal((await applyReview(world, preview)).state, 'connected');
  }
});

test('Disconnect restores kept entries and credential bytes while preserving later foreign servers, hooks and fields', async t => {
  const world = await reviewWorld(t);
  const applied = await applyReview(world, await review(world));
  const mcp = JSON.parse(await readFile(world.paths.mcp));
  mcp.mcpServers.later = { command: 'later-foreign' };
  mcp.newPreference = true;
  await writeFile(world.paths.mcp, JSON.stringify(mcp));
  const hooks = JSON.parse(await readFile(world.paths.hooks));
  hooks.hooks.stop.unshift({ command: 'later-hook' });
  await writeFile(world.paths.hooks, JSON.stringify(hooks));
  const disconnected = await mutateMachineSettings(world.domain, 'disconnect', { machine: world.fixture.machine, confirmed: true, expectedRevision: applied.revision }, 'cursor');
  assert.equal(disconnected.body.state, 'disconnected');
  const restored = JSON.parse(await readFile(world.paths.mcp));
  assert.equal(restored.token === world.secret, true);
  assert.equal(restored.mcpServers['hivem1nd-relay'], undefined);
  assert.deepEqual(restored.mcpServers.later, { command: 'later-foreign' });
  assert.equal(restored.newPreference, true);
  const restoredHooks = JSON.parse(await readFile(world.paths.hooks));
  assert.deepEqual(restoredHooks.hooks.stop, [{ command: 'later-hook' }, { command: 'foreign-stop' }]);
  assert.equal(restoredHooks.secret === world.secret, true);
});

test('Disconnect refuses drift in an owned entry before writing any file', async t => {
  const world = await reviewWorld(t);
  const result = await applyReview(world, await review(world));
  const hooks = JSON.parse(await readFile(world.paths.hooks));
  hooks.hooks.sessionStart[0].command = 'a foreign replacement';
  await writeFile(world.paths.hooks, JSON.stringify(hooks));
  const before = await legacyTreeInventory(world.fixture.root);
  await assert.rejects(mutateMachineSettings(world.domain, 'disconnect', { machine: world.fixture.machine, confirmed: true, expectedRevision: result.revision }, 'cursor'), { code: 'configuration_changed' });
  await assert.rejects(review(world), { code: 'configuration_changed' });
  assert.deepEqual(await legacyTreeInventory(world.fixture.root), before);
});

test('the HTTP review uses memory receipts, exact route schemas and selected Apply replay without leaking configuration', async t => {
  const world = await reviewWorld(t);
  const credentials = createCredentialStore({ now: world.owner.now });
  const token = credentials.issue({ audience: 'desktop', unitId: 'root:master', viewerId: randomUUID() }).token;
  const http = await createHttpServer({ ...world.owner, settingsOwner: world.owner, credentials });
  t.after(() => http.close());
  const origin = `http://127.0.0.1:${http.port}`;
  const call = async (method, target, body, token, key = randomUUID()) => {
    const response = await fetch(`${origin}/api/v1${target}`, { method, signal: AbortSignal.timeout(5000), headers: { origin,
      authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  const key = randomUUID();
  const before = await legacyTreeInventory(world.fixture.root);
  const body = { machine: world.fixture.machine, mode: 'on-demand', target: 'cli' };
  const first = await call('POST', '/settings/agents/cursor/preview', body, token, key);
  assert.equal(first.status, 200);
  const again = await call('POST', '/settings/agents/cursor/preview', body, token, key);
  assert.equal(again.json.data.previewId, first.json.data.previewId);
  assert.equal(JSON.stringify(first.json.data).includes(world.secret), false);
  assert.deepEqual(await legacyTreeInventory(world.fixture.root), before);
  const preview = first.json.data;
  const applyBody = { machine: world.fixture.machine, previewId: preview.previewId, changeIds: ['mcp', 'hooks'], expectedRevision: preview.revision };
  const applyKey = randomUUID();
  const applied = await call('POST', '/settings/agents/cursor/apply', applyBody, token, applyKey);
  assert.equal(applied.status, 200);
  const files = await legacyTreeInventory(world.fixture.home);
  assert.deepEqual((await call('POST', '/settings/agents/cursor/apply', applyBody, token, applyKey)).json.data, applied.json.data);
  assert.deepEqual(await legacyTreeInventory(world.fixture.home), files);
  const invalid = await call('POST', '/settings/agents/cursor/preview', { ...body, afterText: 'unreviewed input' }, token);
  assert.equal(invalid.status, 400);
  const disconnected = await call('DELETE', '/settings/agents/cursor', { machine: world.fixture.machine, confirmed: true, expectedRevision: applied.json.data.revision }, token);
  assert.equal(disconnected.status, 200);
  assert.deepEqual(await readFile(world.paths.mcp), world.originals.mcp);
  assert.deepEqual(await readFile(world.paths.hooks), world.originals.hooks);
});

test('app connection and Auto/On demand changes have separate bindings and preserve foreign rules', async t => {
  const world = await reviewWorld(t);
  world.owner.probeApps = async () => ({ name: 'Cursor editor', available: true, connected: true });
  const app = await review(world, { target: 'app', mode: 'auto' });
  await applyReview(world, app);
  let report = await readMachineSettings(world.domain, world.fixture.machine, 'agents');
  assert.equal(report.items.find(item => item.id === 'cursor').mode, 'on-demand');
  assert.equal(report.items.find(item => item.id === 'cursor').app.state, 'connected');
  const auto = await review(world, { mode: 'auto' });
  assert.ok(auto.changes.some(item => item.path.endsWith('hivem1nd.mdc')));
  await applyReview(world, auto);
  report = await readMachineSettings(world.domain, world.fixture.machine, 'agents');
  assert.equal(report.items.find(item => item.id === 'cursor').mode, 'auto');
  const demand = await review(world);
  const rule = demand.changes.find(item => item.path.endsWith('hivem1nd.mdc'));
  assert.ok(rule);
  await applyReview(world, demand);
  await assert.rejects(readFile(rule.path), { code: 'ENOENT' });
  report = await readMachineSettings(world.domain, world.fixture.machine, 'agents');
  assert.equal(report.items.find(item => item.id === 'cursor').mode, 'on-demand');
  assert.equal(report.items.find(item => item.id === 'cursor').app.state, 'connected');
});

test('optional Git records only the reviewed machine and started-session scope without broad client grants', async t => {
  const world = await reviewWorld(t);
  const preview = await review(world);
  await applyReview(world, preview, ['git']);
  assert.deepEqual(await readFile(world.paths.mcp), world.originals.mcp);
  assert.deepEqual(await readFile(world.paths.hooks), world.originals.hooks);
  const report = await readMachineSettings(world.domain, world.fixture.machine, 'permissions');
  assert.equal(report.agentPermissions.length, 1);
  assert.equal(report.agentPermissions[0].scope, 'hivem1nd-started-sessions');
  assert.equal(report.agentPermissions[0].machine, world.fixture.machine);
  assert.deepEqual(report.agentPermissions[0].actions, ['git.commit', 'git.push']);
  assert.equal(JSON.stringify(report).includes(world.secret), false);
  await mutateMachineSettings(world.domain, 'disconnect', { machine: world.fixture.machine, confirmed: true, expectedRevision: (await readMachineSettings(world.domain, world.fixture.machine, 'agents')).revision }, 'cursor');
  assert.equal((await readMachineSettings(world.domain, world.fixture.machine, 'permissions')).agentPermissions.length, 0);
});

test('Revoke removes only its reviewed permission, survives retry and cannot be undone by Disconnect or Apply replay', async t => {
  const world = await reviewWorld(t);
  const defaultPreview = await review(world, { allowGit: false });
  await applyReview(world, defaultPreview);
  assert.deepEqual((await readMachineSettings(world.domain, world.fixture.machine, 'permissions')).agentPermissions, []);
  const preview = await review(world);
  await applyReview(world, preview, ['git']);
  const permissionFile = path.join(world.fixture.paths.localDirectory, 'client-permissions.json');
  const cursor = (await readMachineSettings(world.domain, world.fixture.machine, 'permissions')).agentPermissions[0];
  const other = { ...cursor, id: randomUUID(), client: 'codex' };
  await writeFile(permissionFile, JSON.stringify({ permissions: [cursor, other] }));
  const beforeHome = await legacyTreeInventory(world.fixture.home);
  let report = await readMachineSettings(world.domain, world.fixture.machine, 'permissions');
  await assert.rejects(mutateMachineSettings(world.domain, 'revoke', { machine: world.fixture.machine, expectedRevision: 'a'.repeat(64) }, cursor.id), { code: 'revision_conflict' });
  const revoked = await mutateMachineSettings(world.domain, 'revoke', { machine: world.fixture.machine, expectedRevision: report.revision }, cursor.id);
  assert.equal(revoked.body.state, 'revoked');
  report = await readMachineSettings(world.domain, world.fixture.machine, 'permissions');
  assert.deepEqual(report.agentPermissions.map(item => item.id), [other.id]);
  assert.equal(report.revision, revoked.body.revision);
  assert.deepEqual(await legacyTreeInventory(world.fixture.home), beforeHome);
  await applyReview(world, preview, ['git']);
  assert.deepEqual((await readMachineSettings(world.domain, world.fixture.machine, 'permissions')).agentPermissions.map(item => item.id), [other.id]);
  const fresh = await review(world);
  assert.equal(fresh.changes.find(item => item.id === 'git').selected, false);
  await mutateMachineSettings(world.domain, 'disconnect', { machine: world.fixture.machine, confirmed: true, expectedRevision: (await readMachineSettings(world.domain, world.fixture.machine, 'agents')).revision }, 'cursor');
  assert.deepEqual((await readMachineSettings(world.domain, world.fixture.machine, 'permissions')).agentPermissions.map(item => item.id), [other.id]);
  assert.deepEqual(await readFile(world.paths.mcp), world.originals.mcp);
  assert.deepEqual(await readFile(world.paths.hooks), world.originals.hooks);
});

test('permission HTTP revocation is desktop-only and replays without changing unrelated configuration', async t => {
  const world = await reviewWorld(t);
  await applyReview(world, await review(world), ['git']);
  const credentials = createCredentialStore({ now: world.owner.now });
  const desktop = credentials.issue({ audience: 'desktop', unitId: 'root:master' }).token;
  const phone = credentials.issue({ audience: 'phone', unitId: 'root:master' }).token;
  const agent = credentials.issue({ audience: 'agent', unitId: 'project:shop:executor-shop' }).token;
  const http = await createHttpServer({ ...world.owner, settingsOwner: world.owner, credentials });
  t.after(() => http.close());
  const origin = `http://127.0.0.1:${http.port}`;
  const report = await readMachineSettings(world.domain, world.fixture.machine, 'permissions'), permission = report.agentPermissions[0];
  const input = { machine: world.fixture.machine, expectedRevision: report.revision }, key = randomUUID();
  const call = async (token, body = input) => {
    const response = await fetch(`${origin}/api/v1/settings/permissions/${permission.id}`, { method: 'DELETE', signal: AbortSignal.timeout(5000),
      headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  for (const token of [phone, agent]) assert.equal((await call(token)).status, 403);
  assert.equal((await call(desktop, { ...input, action: '*' })).status, 400);
  const revoked = await call(desktop);
  assert.equal(revoked.status, 200);
  const beforeRetry = await legacyTreeInventory(world.fixture.root);
  assert.deepEqual((await call(desktop)).json.data, revoked.json.data);
  assert.deepEqual(await legacyTreeInventory(world.fixture.root), beforeRetry);
  assert.equal(JSON.stringify(revoked.json).includes(world.secret), false);
});

test('remote permission revocation executes only on the selected authenticated owner and offline requests write nothing', async t => {
  const { fixture, owner, domain } = await setup(t);
  fixture.paths.origin = path.join(fixture.root, 'origin');
  await mkdir(fixture.paths.origin);
  const store = createStore({ root: fixture.root, mindPath: fixture.paths.mind, localDirectory: path.join(fixture.root, 'laptop'), confineRoot: fixture.root, now: owner.now });
  store.aclRunner = fixture.store.aclRunner;
  const laptop = createSettingsOwner({ ...owner, store, paths: { ...owner.paths, machine: 'LAPTOP', localDirectory: store.localDirectory, staging: path.join(store.localDirectory, 'staging') } });
  await mkdir(store.localDirectory, { recursive: true });
  const permission = { id: randomUUID(), machine: 'LAPTOP', client: 'cursor', actions: ['git.commit', 'git.push'], scope: 'hivem1nd-started-sessions', grantedAt: new Date(fixture.clock.now).toISOString(), grantedBy: 'root:master' };
  await writeFile(path.join(store.localDirectory, 'client-permissions.json'), JSON.stringify({ permissions: [permission] }));
  await publishMachineSettings(owner);
  const report = await publishMachineSettings(laptop);
  const input = { machine: 'LAPTOP', expectedRevision: report.permissions.revision };
  const beforeOffline = await legacyTreeInventory(fixture.root);
  await assert.rejects(mutateMachineSettings(domain, 'revoke', input, permission.id), { code: 'machine_unavailable' });
  assert.deepEqual(await legacyTreeInventory(fixture.root), beforeOffline);
  await writeBeat(laptop, 'running');
  const localBefore = await legacyTreeInventory(fixture.home);
  const request = mutateMachineSettings({ ...domain, operationId: 'remote-revoke' }, 'revoke', input, permission.id);
  for (let index = 0; index < 25; index += 1) { await processSettingsRequests(laptop); await new Promise(resolve => setTimeout(resolve, 10)); }
  const result = await request;
  assert.equal(result.body.state, 'revoked');
  assert.deepEqual(await legacyTreeInventory(fixture.home), localBefore);
  await assert.rejects(readFile(path.join(fixture.paths.localDirectory, 'client-permissions.json')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readFile(path.join(store.localDirectory, 'client-permissions.json'))).permissions, []);
  await processSettingsRequests(laptop);
  assert.deepEqual((await readMachineSettings(domain, 'LAPTOP', 'permissions')).agentPermissions, []);
});

test('Auto and On demand review only their owned instruction while retaining foreign rule credentials through Disconnect', async t => {
  const world = await reviewWorld(t);
  const rulesPath = path.join(world.fixture.home, '.codex', 'AGENTS.md');
  await mkdir(path.dirname(rulesPath), { recursive: true });
  const original = Buffer.from(`Foreign instructions and a retained credential: ${world.secret}\n`);
  await writeFile(rulesPath, original);
  const preview = async mode => (await mutateMachineSettings(world.domain, 'preview', { machine: world.fixture.machine, mode, target: 'cli' }, 'codex')).body;
  const auto = await preview('auto');
  assert.equal(JSON.stringify(auto).includes(world.secret), false);
  await applyReview(world, auto, auto.changes.filter(item => item.selected).map(item => item.id), 'codex');
  const demand = await preview('on-demand');
  assert.equal(JSON.stringify(demand).includes(world.secret), false);
  const result = await applyReview(world, demand, demand.changes.filter(item => item.selected).map(item => item.id), 'codex');
  assert.equal((await readFile(rulesPath)).equals(original), true);
  await mutateMachineSettings(world.domain, 'disconnect', { machine: world.fixture.machine, confirmed: true, expectedRevision: result.revision }, 'codex');
  assert.equal((await readFile(rulesPath)).equals(original), true);
});

test('reviewed reload refuses unsupported owned work, reloads once with verified PIDs, and never stops foreign app work', async t => {
  const world = await reviewWorld(t);
  const journalRoot = path.join(world.fixture.paths.localDirectory, 'session-starts');
  await mkdir(journalRoot);
  for (const pid of [101, 202]) await writeFile(path.join(journalRoot, `${pid}.json`), JSON.stringify({ client: 'cursor', phase: 'registered', pid, sessionId: randomUUID() }));
  world.owner.ownedPids = new Set([101]);
  const preview = await review(world);
  const before = await legacyTreeInventory(world.fixture.root);
  await assert.rejects(applyReview(world, preview), { code: 'client_reload_required' });
  assert.deepEqual(await legacyTreeInventory(world.fixture.root), before);
  let reloads = 0;
  world.owner.adapters = { cursor: { async reload(input) { reloads += 1; assert.equal(input.owned, true); assert.deepEqual(input.sessions.map(item => item.pid), [101]); return { acknowledged: true }; } } };
  const result = await applyReview(world, preview);
  assert.deepEqual(await applyReview(world, preview), result);
  assert.equal(reloads, 1);
});

test('the isolated GUI fixture reviews without disk writes and applies, replays and disconnects its selected configuration', async t => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const call = async (method, route, body, key = randomUUID()) => {
    const response = await fetch(`${fixture.origin}/api/v1${route}`, { method, signal: AbortSignal.timeout(5000), headers: { ...fixture.headers,
      'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  const before = await legacyTreeInventory(fixture.root);
  const reviewed = await call('POST', '/settings/agents/cursor/preview', { machine: 'DESKTOP', mode: 'on-demand', target: 'cli' });
  assert.equal(reviewed.status, 200);
  assert.deepEqual(await legacyTreeInventory(fixture.root), before);
  const preview = reviewed.json.data;
  assert.equal(preview.changes.filter(item => item.selected).length, 2);
  assert.equal(preview.changes.find(item => item.optional).selected, false);
  const input = { machine: 'DESKTOP', previewId: preview.previewId, changeIds: ['mcp'], expectedRevision: preview.revision };
  const key = randomUUID();
  const applied = await call('POST', '/settings/agents/cursor/apply', input, key);
  assert.equal(applied.status, 200);
  assert.deepEqual((await call('POST', '/settings/agents/cursor/apply', input, key)).json.data, applied.json.data);
  await assert.rejects(readFile(preview.changes.find(item => item.id === 'hooks').path), { code: 'ENOENT' });
  const disconnected = await call('DELETE', '/settings/agents/cursor', { machine: 'DESKTOP', confirmed: true, expectedRevision: applied.json.data.revision });
  assert.equal(disconnected.status, 200);
  await assert.rejects(readFile(preview.changes.find(item => item.id === 'mcp').path), { code: 'ENOENT' });
});

test('the GUI fixture lists a scoped permission, revokes it once and Disconnect preserves revocation', async t => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const call = async (method, route, body, key = randomUUID()) => {
    const response = await fetch(`${fixture.origin}/api/v1${route}`, { method, signal: AbortSignal.timeout(5000), headers: { ...fixture.headers,
      'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  const preview = (await call('POST', '/settings/agents/cursor/preview', { machine: 'DESKTOP', mode: 'on-demand', target: 'cli', allowGit: false })).json.data;
  assert.equal(preview.changes.find(item => item.id === 'git').selected, false);
  const applied = await call('POST', '/settings/agents/cursor/apply', { machine: 'DESKTOP', previewId: preview.previewId, changeIds: ['git'], expectedRevision: preview.revision });
  assert.equal(applied.status, 200);
  const report = (await call('GET', '/settings/permissions?machine=DESKTOP')).json.data;
  assert.equal(report.agentPermissions.length, 1);
  const permission = report.agentPermissions[0], input = { machine: 'DESKTOP', expectedRevision: report.revision }, key = randomUUID();
  assert.equal(permission.scope, 'hivem1nd-started-sessions');
  assert.equal(permission.grantedBy, 'root:master');
  const revoked = await call('DELETE', `/settings/permissions/${permission.id}`, input, key);
  assert.equal(revoked.status, 200);
  assert.deepEqual((await call('DELETE', `/settings/permissions/${permission.id}`, input, key)).json.data, revoked.json.data);
  assert.deepEqual((await call('GET', '/settings/permissions')).json.data.agentPermissions, []);
  const disconnected = await call('DELETE', '/settings/agents/cursor', { machine: 'DESKTOP', confirmed: true, expectedRevision: applied.json.data.revision });
  assert.equal(disconnected.status, 200);
  assert.deepEqual((await call('GET', '/settings/permissions')).json.data.agentPermissions, []);
});

test('a running service answers a read of its own report from the last report and rebuilds only after a change', async t => {
  const { fixture, owner, domain } = await setup(t);
  fixture.store.projectionCache = createProjectionCache();
  const cache = fixture.store.projectionCache;
  owner.startedAt = new Date(fixture.clock.now).toISOString();
  // The first report does not wait for the walk that looks for repositories; the offer joins the report once it is saved.
  assert.equal((await publishMachineSettings(owner)).discoveryOffer, null);
  await owner.discoverySaved;
  const first = await publishMachineSettings(owner);
  assert.notEqual(first.discoveryOffer, null);
  const builds = cache.builds;
  const file = machineSettingsPath(fixture.paths.mind, fixture.machine);
  const written = await readFile(file, 'utf8');
  for (let index = 0; index < 5; index += 1) assert.equal((await readMachineSettings(domain)).reportedAt, first.reportedAt);
  assert.equal(cache.builds, builds, 'a read must not read the whole M1ND again');
  // Something changed in the M1ND: the next read builds the report once more, finds it unchanged and writes nothing.
  noteProjectionChange(fixture.store);
  fixture.clock.now += 1000;
  assert.equal((await readMachineSettings(domain)).reportedAt, first.reportedAt);
  assert.equal(cache.builds, builds + 1);
  assert.equal(await readFile(file, 'utf8'), written);
  for (let index = 0; index < 3; index += 1) await readMachineSettings(domain, fixture.machine, 'permissions');
  assert.equal(cache.builds, builds + 1);
  // A report older than five minutes is written again so its time stays meaningful.
  noteProjectionChange(fixture.store);
  fixture.clock.now += 6 * 60000;
  const later = await readMachineSettings(domain);
  assert.equal(later.reportedAt, new Date(fixture.clock.now).toISOString());
  assert.notEqual(await readFile(file, 'utf8'), written);
  // The report a previous run left answers the first read of a new one while its own is built.
  const restarted = createSettingsOwner({ ...owner, key: null, lastReport: null, refreshing: null });
  const answer = await readMachineSettings({ ...restarted, settingsOwner: restarted });
  assert.equal(answer.reportedAt, later.reportedAt);
});
