import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../cli/index.mjs';
import { createWizardServer } from '../gui/server.mjs';
import { bootstrapConfig, configureOwnedService, installService, planRegistration, queryRegistration, removeOwnedRegistration, runServicePhases, startConfiguredViewer, uninstallService, verifyOwnedRegistration } from '../engine/service/install.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { mindKeyFor } from '../engine/service/paths.mjs';
import { EMBEDDED_BROWSER_FILES } from '../engine/service/http.mjs';
import { composeCore, runConfiguredService, stopService } from '../engine/service/service.mjs';
import { requireLegacyClosure, spawnLocalWakeWorker, writeLegacyClosure } from '../engine/relay/local-wake.mjs';
import { copyLegacyTree, legacyTreeInventory } from '../engine/legacy-copy.mjs';
import { createSetupSession } from '../engine/setup.mjs';
import { evolve } from '../engine/lifecycle.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { assertReleaseAssets, assertZipBounds, BROWSER_ASSETS, browserReferences, build, cleanStage, collectPayload, confirmRuntimeVersion, dryRun, installerEntry, installerScript, installPayload, main, manifestDocument, missingPackagedBrowserAssets, NODE_ENTRY_LIMIT, NODE_EXE_NAME, productionPackages, readArchive, verifyInstalled, verifyRuntime, writeZip } from '../scripts/build-installer.mjs';

const base = {
  nodePath: 'C:\\Program Files\\node\\node.exe',
  cliPath: 'C:\\kit\\cli\\index.mjs',
  mindPath: 'C:\\Users\\Ada\\AppData\\Local\\Cosmic\\hivem1nd',
  workingDirectory: 'C:\\kit',
  localDirectory: 'C:\\Users\\Ada\\AppData\\Local\\Cosmic\\hivem1nd-service\\key\\DESKTOP',
  sid: 'S-1-5-21-1',
};

async function startupFixture(t, platform) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-startup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mindPath = path.join(root, 'mind');
  const cosmicPath = path.join(root, 'Cosmic');
  const directory = path.join(cosmicPath, 'hivem1nd-service', mindKeyFor(mindPath, platform), 'TESTBOX');
  const commands = [];
  const aclRunner = stubAclRunner();
  let plan = null;
  let registered = false;
  let enabled = false;
  let foreign = false;
  let failure = false;
  let starts = 0;
  let queries = 0;
  const options = {
    platform, mindPath, cosmicPath, hostname: 'TESTBOX', homeDir: path.join(root, 'home'),
    kitPath: path.join(root, 'kit'), originPath: path.join(root, 'origin'), dryRun: false, aclRunner,
    async run(argv) {
      if (failure) throw new Error('The user service manager refused the operation.');
      commands.push(argv);
      if (argv.includes('/Create') || argv.includes('enable') || argv.includes('bootstrap')) { registered = true; enabled = true; }
      if (argv.includes('/Delete') || argv.includes('disable') || argv.includes('bootout')) {
        enabled = false;
        if (platform === 'win32') registered = false;
      }
    },
    async query(candidate) {
      queries += 1;
      plan ??= candidate;
      if (!registered) return { present: false };
      if (foreign) return { present: true, digest: 'foreign', executable: 'foreign', arguments: [], installationId: 'foreign' };
      const current = JSON.parse(await readFile(path.join(directory, 'registration.json'), 'utf8').catch(() => 'null'));
      return { present: true, digest: plan.digest, executable: plan.executable, arguments: plan.arguments,
        matchesPlan: enabled, enabled, installationId: current?.installationId };
    },
    async start() { starts += 1; return { viewerUrl: 'http://127.0.0.1:9/gui/viewer' }; },
  };
  return { options, commands, aclRunner, directory, starts: () => starts, queries: () => queries,
    fail: value => { failure = value; }, makeForeign: () => { foreign = true; } };
}

test('default setup records zero logon registration runner calls', async t => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const fixture = await startupFixture(t, platform);
    const result = await configureOwnedService({ ...fixture.options, userManager: false });
    assert.equal(result.status, 'started');
    assert.equal(result.state.registration, true);
    assert.equal(result.state.configBody.startWithWindows, false);
    assert.equal(fixture.starts(), 1);
    assert.equal(fixture.queries(), 0);
    assert.deepEqual(fixture.commands, []);
    assert.equal(JSON.parse(await readFile(result.configFile, 'utf8')).startWithWindows, false);
    assert.equal(fixture.aclRunner.calls.some(call => call.op === 'protect'), true);
    await assert.rejects(readFile(path.join(fixture.directory, 'registration.json')), { code: 'ENOENT' });
    const resumed = await configureOwnedService({ ...fixture.options, resumeSetup: true });
    assert.equal(resumed.status, 'started');
    assert.deepEqual(fixture.commands, []);
    assert.equal(fixture.queries(), 0);
  }
  assert.throws(() => bootstrapConfig({ startWithWindows: 'true' }), { code: 'invalid_body' });
});

test('enable startup records exactly one owned registration', async t => {
  for (const platform of ['win32', 'linux']) {
    const fixture = await startupFixture(t, platform);
    const initial = await configureOwnedService(fixture.options);
    const enabled = await configureOwnedService({ ...fixture.options, state: initial.state, startWithWindows: true });
    assert.equal(enabled.status, 'started');
    assert.equal(enabled.state.configBody.startWithWindows, true);
    assert.equal(fixture.starts(), 1);
    const registrations = fixture.commands.filter(argv => argv.includes('/Create') || argv.includes('enable'));
    assert.equal(registrations.length, 1);
    const record = JSON.parse(await readFile(path.join(fixture.directory, 'registration.json'), 'utf8'));
    assert.equal(record.verification, 'verified');
    assert.ok(record.installationId);
    const repeated = await configureOwnedService({ ...fixture.options, state: enabled.state, startWithWindows: true });
    assert.equal(repeated.status, 'started');
    assert.equal(fixture.commands.filter(argv => argv.includes('/Create') || argv.includes('enable')).length, 1);
    assert.equal(JSON.parse(await readFile(enabled.configFile, 'utf8')).startWithWindows, true);
    const disabled = await configureOwnedService({ ...fixture.options, state: repeated.state, startWithWindows: false });
    assert.equal(disabled.status, 'started');
    assert.equal(disabled.state.configBody.startWithWindows, false);
    assert.equal(fixture.starts(), 1);
    assert.equal(disabled.state.start, true);
    if (platform === 'linux') assert.deepEqual(fixture.commands.find(argv => argv.includes('disable')), ['systemctl', '--user', 'disable', record.name]);
    if (platform === 'win32') await assert.rejects(readFile(path.join(fixture.directory, 'registration.json')), { code: 'ENOENT' });
    else assert.equal(JSON.parse(await readFile(path.join(fixture.directory, 'registration.json'), 'utf8')).installationId, record.installationId);
    assert.equal(JSON.parse(await readFile(disabled.configFile, 'utf8')).startWithWindows, false);
    const restored = await configureOwnedService({ ...fixture.options, state: disabled.state, startWithWindows: true });
    assert.equal(restored.status, 'started');
    assert.equal(restored.state.configBody.startWithWindows, true);
    assert.equal(fixture.starts(), 1);
  }
});

test('disable startup preserves foreign registrations', async t => {
  for (const platform of ['win32', 'linux']) {
    const fixture = await startupFixture(t, platform);
    const initial = await configureOwnedService({ ...fixture.options, startWithWindows: true });
    const before = await readFile(initial.configFile);
    const ownershipFile = path.join(fixture.directory, 'registration.json');
    const ownership = await readFile(ownershipFile);
    const commands = fixture.commands.length;
    fixture.makeForeign();
    const result = await configureOwnedService({ ...fixture.options, state: initial.state, startWithWindows: false });
    assert.equal(result.status, 'failed');
    assert.equal(result.phase, 'registration');
    assert.match(result.conflict, /left in place/);
    assert.equal(fixture.commands.length, commands);
    assert.equal((await readFile(initial.configFile)).equals(before), true);
    assert.equal((await readFile(ownershipFile)).equals(ownership), true);
    assert.equal(result.state.configBody.startWithWindows, true);
    assert.equal(result.state.start, true);
    assert.equal(fixture.starts(), 1);
  }
});

test('registration failure preserves the prior startup setting', async t => {
  for (const platform of ['win32', 'linux']) {
    const fixture = await startupFixture(t, platform);
    const initial = await configureOwnedService(fixture.options);
    const before = await readFile(initial.configFile);
    fixture.fail(true);
    const failed = await configureOwnedService({ ...fixture.options, state: initial.state, startWithWindows: true });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.phase, 'registration');
    assert.equal(failed.state.configBody.startWithWindows, false);
    assert.equal(failed.state.start, true);
    assert.equal(initial.state.configBody.startWithWindows, false);
    assert.equal((await readFile(initial.configFile)).equals(before), true);
    fixture.fail(false);
    const enabled = await configureOwnedService({ ...fixture.options, state: failed.state, startWithWindows: true });
    assert.equal(enabled.status, 'started');
    const enabledBytes = await readFile(enabled.configFile);
    fixture.fail(true);
    const removal = await configureOwnedService({ ...fixture.options, state: enabled.state, startWithWindows: false });
    assert.equal(removal.status, 'failed');
    assert.equal(removal.state.configBody.startWithWindows, true);
    assert.equal(removal.state.start, true);
    assert.equal((await readFile(enabled.configFile)).equals(enabledBytes), true);
    assert.equal(fixture.starts(), 1);
  }
});

test('macOS startup toggles keep the loaded owned runtime', async t => {
  const fixture = await startupFixture(t, 'darwin');
  const initial = await configureOwnedService(fixture.options);
  const enabled = await configureOwnedService({ ...fixture.options, state: initial.state, startWithWindows: true });
  assert.equal(enabled.status, 'started');
  const record = JSON.parse(await readFile(path.join(fixture.directory, 'registration.json'), 'utf8'));
  const disabled = await configureOwnedService({ ...fixture.options, state: enabled.state, startWithWindows: false });
  assert.equal(disabled.status, 'started');
  assert.equal(disabled.state.configBody.startWithWindows, false);
  assert.deepEqual(fixture.commands[1], ['launchctl', 'disable', `gui/${record.uid}/${record.name}`]);
  assert.equal(JSON.parse(await readFile(path.join(fixture.directory, 'registration.json'), 'utf8')).installationId, record.installationId);
  const restored = await configureOwnedService({ ...fixture.options, state: disabled.state, startWithWindows: true });
  assert.equal(restored.status, 'started');
  assert.deepEqual(fixture.commands[2], ['launchctl', 'enable', `gui/${record.uid}/${record.name}`]);
  assert.equal(restored.state.installed.os, true);
  assert.deepEqual(restored.state.installed.executed, [fixture.commands[2]]);
  assert.equal(fixture.starts(), 1);
});

test('offline legacy ownership blocks wake adoption until closure', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-closure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'legacy');
  const mind = path.join(root, 'destination');
  const cosmic = path.join(root, 'local', 'Cosmic');
  const machine = os.hostname();
  await mkdir(path.join(source, 'user'), { recursive: true });
  await writeFile(path.join(source, 'user', 'VERSION'), '2.0.0\n');
  await writeFile(path.join(source, 'user', 'private.txt'), 'Original private record.\n');
  const sourceBefore = await legacyTreeInventory(source);
  await copyLegacyTree(source, mind);
  const directory = path.join(cosmic, 'hivem1nd-service', mindKeyFor(mind, process.platform), machine);
  const config = bootstrapConfig({ mindPath: mind, machine, origin: { kind: 'folder', path: path.join(root, 'origin') }, stagingPath: path.join(directory, 'staging') });
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'config.json'), JSON.stringify(config));
  const binding = { registrationId: '11111111-1111-4111-8111-111111111111', unit: 'executor', unitId: 'root:executor',
    client: 'host', machine, nativeSessionId: 'offline-native' };
  await writeLegacyClosure(mind, { format: 'hivem1nd-legacy-closure-v1', sourcePath: source, sessions: [{ binding, status: 'required' }] });
  let forks = 0;
  const forkProcess = () => {
    forks += 1;
    const child = new EventEmitter();
    child.unref = () => {};
    child.disconnect = () => {};
    child.kill = () => assert.fail('No native process may be signaled');
    setImmediate(() => child.emit('message', { type: 'relay-wake-ready', state: 'already-running', ownsLease: false }));
    return child;
  };
  const blocked = error => error.code === 'legacy_closure_required';
  assert.throws(() => bootstrapConfig(config), blocked);
  await assert.rejects(runConfiguredService({ mindPath: mind, hostname: machine, cosmicPath: cosmic }), blocked);
  assert.throws(() => spawnLocalWakeWorker({ cliPath: 'fixture.mjs', mindPath: mind, binding, forkProcess }), blocked);
  assert.equal(forks, 0);
  await assert.rejects(requireLegacyClosure(mind, { machine }), blocked);
  const events = [];
  let live = true;
  const control = {
    async confirm(expected) { events.push(live ? 'live' : 'ended'); return { binding: expected, owned: true, live }; },
    async save(expected) { events.push('saved'); return { binding: expected, saved: true }; },
    async close(expected) { events.push('closed'); live = false; return { binding: expected, closed: true }; },
  };
  await requireLegacyClosure(mind, { machine, control });
  assert.deepEqual(events, ['live', 'saved', 'closed', 'ended']);
  assert.equal(bootstrapConfig(config).machine, machine);
  const worker = spawnLocalWakeWorker({ cliPath: 'fixture.mjs', mindPath: mind, binding, forkProcess });
  assert.deepEqual(await worker.ready, { state: 'already-running', ownsLease: false });
  assert.equal(forks, 1);
  assert.deepEqual(await legacyTreeInventory(source), sourceBefore);
  assert.equal(JSON.parse(await readFile(path.join(mind, '.migration', 'legacy-closure.json'), 'utf8')).sessions[0].status, 'closed');
});

test('the real wizard retries only service startup and opens its authenticated viewer', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  const home = path.join(root, 'home');
  const local = path.join(root, 'local');
  const cosmic = path.join(root, 'custom', 'Cosmic');
  const mind = path.join(root, 'OneDrive', 'HIVEM1ND');
  const origin = path.join(root, 'origin');
  const aclRunner = stubAclRunner();
  const env = { PATH: '', HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: local, CODEX_HOME: path.join(home, '.codex') };
  await mkdir(home, { recursive: true });
  await mkdir(local, { recursive: true });
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const guardPort = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const commands = [];
  const opened = [];
  let starts = 0;
  let owned;
  t.after(async () => { if (owned) await stopService(owned, { force: true }); await rm(root, { recursive: true, force: true }); });
  const sessionOptions = {
    kitPath: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    mindPath: mind, homeDir: home, cosmicPath: cosmic, hostname: 'TESTBOX', env, language: 'en',
    originKind: 'folder', originPath: origin,
    serviceSetup: true, serviceDryRun: false, serviceProtect: false, aclRunner,
    serviceQuery: async (plan) => {
      if (commands.length === 0) return { present: false };
      const file = path.join(cosmic, 'hivem1nd-service', mindKeyFor(mind, process.platform), 'TESTBOX', 'registration.json');
      const current = await readFile(file, 'utf8').then(JSON.parse, () => null);
      return { present: true, digest: plan.digest, executable: plan.executable, arguments: plan.arguments, installationId: current?.installationId };
    },
    serviceRunner: async (argv) => { commands.push(argv); },
    serviceStart: async (config) => {
      starts += 1;
      assert.match(await readFile(path.join(mind, 'user', 'machines', 'TESTBOX.md'), 'utf8'), /^setup: 7$/m);
      const directory = path.join(cosmic, 'hivem1nd-service', mindKeyFor(mind, process.platform), 'TESTBOX');
      assert.equal(JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8')).startWithWindows, false);
      await assert.rejects(readFile(path.join(directory, 'registration.json')), { code: 'ENOENT' });
      assert.equal(commands.length, 0);
      if (starts === 1) throw new Error('temporary service failure');
      const ready = await startConfiguredViewer(config, { env, homeDir: home, cosmicPath: cosmic, hostname: 'TESTBOX', aclRunner, guardPort, userKey: root, confineRoot: root });
      if (!ready.handle.attached) owned = ready.handle;
      return ready;
    },
  };
  const session = await createSetupSession(sessionOptions);
  const server = await createWizardServer({ session, openCompletedViewer: async (url) => { opened.push(url); } });
  let wizardClosed = false;
  t.after(() => wizardClosed ? undefined : server.close());
  const call = async (route, body, wizard = server) => {
    const response = await fetch(`${wizard.origin}/api/v1/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${wizard.token}`, origin: wizard.origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, 200, `${route} status`);
    return (await response.json()).data;
  };
  const initial = await call('step');
  assert.equal(initial.id, 'install');
  assert.equal(initial.number, 1);
  assert.equal(initial.total, 4);
  const location = await call('answer', { values: {} });
  assert.equal(location.id, 'location');
  assert.equal(location.number, 2);
  const service = await call('answer', { values: { mindPath: mind } });
  assert.equal(service.id, 'service');
  assert.equal(service.number, 3);
  assert.equal(service.back, false);
  const first = await call('install', { confirm: true, conflicts: {} });
  assert.equal(first.completed, false);
  assert.equal(first.service.phase, 'start');
  const pending = await call('step');
  assert.equal(pending.id, 'service');
  assert.equal(pending.number, 3);
  assert.equal(pending.done, false);
  assert.match(pending.failure.headline, /could not complete the start phase/);
  assert.equal(pending.failure.headline, first.service.error);
  assert.deepEqual(pending.progress.map(row => [row.id, row.state]), [
    ['folder', 'done'], ['legacy', 'done'], ['registration', 'done'], ['start', 'fail'], ['open', 'todo'],
  ]);
  assert.equal(starts, 1);
  assert.deepEqual(opened, []);
  const before = await stat(path.join(mind, 'rules.md'));
  const configFile = path.join(cosmic, 'hivem1nd-service', mindKeyFor(mind, process.platform), 'TESTBOX', 'config.json');
  const configBefore = await stat(configFile);
  const registered = commands.length;
  const finished = await call('install', { confirm: true, conflicts: {} });
  assert.equal(finished.completed, true);
  const ready = await call('step');
  assert.equal(ready.id, 'ready');
  assert.equal(ready.number, 4);
  assert.equal(ready.done, true);
  assert.equal(ready.back, false);
  assert.equal(starts, 2);
  assert.match(await readFile(path.join(mind, 'user', 'machines', 'TESTBOX.md'), 'utf8'), /^setup: done$/m);
  assert.equal(commands.length, registered);
  assert.equal((await stat(path.join(mind, 'rules.md'))).mtimeMs, before.mtimeMs);
  assert.equal((await stat(configFile)).mtimeMs, configBefore.mtimeMs);
  assert.deepEqual(opened, []);
  for (let index = 0; index < 2; index += 1) {
    assert.deepEqual(await call('open', {}), { opened: true, viewerUrl: null });
  }
  assert.deepEqual(opened, [finished.viewerUrl]);
  assert.equal(finished.service.state.configBody.origin.path, origin);
  const url = new URL(finished.viewerUrl);
  const token = new URLSearchParams(url.hash.slice(1)).get('session');
  const view = await fetch(`${url.origin}/api/v1/view`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(view.status, 200);
  assert.equal((await view.json()).contract, 'hivem1nd-gui-v3');
  await server.close();
  wizardClosed = true;
  assert.equal((await fetch(url)).status, 200);
  const resumed = await createSetupSession(sessionOptions);
  assert.equal((await resumed.getStep()).done, true);
  const resumedOpened = [];
  const resumedServer = await createWizardServer({ session: resumed, openCompletedViewer: async viewer => { resumedOpened.push(viewer); } });
  t.after(() => resumedServer.close());
  for (let index = 0; index < 2; index += 1) {
    const step = await call('step', undefined, resumedServer);
    assert.equal(step.id, 'ready');
    assert.equal(step.number, 4);
    assert.equal(step.done, true);
  }
  assert.deepEqual(resumedOpened, []);
  for (let index = 0; index < 2; index += 1) {
    assert.deepEqual(await call('open', {}, resumedServer), { opened: true, viewerUrl: null });
  }
  assert.deepEqual(resumedOpened, [resumed.result.viewerUrl]);
  let failed = true;
  const retry = await createSetupSession({ ...sessionOptions, serviceStart: async config => {
    if (failed) { failed = false; throw new Error('existing service temporary failure'); }
    return sessionOptions.serviceStart(config);
  } });
  assert.equal((await retry.getStep()).done, false);
  assert.equal((await retry.getStep()).id, 'service');
  assert.equal((await retry.getStep()).number, 3);
  assert.deepEqual((await retry.preview()).files, []);
  await retry.answer({ confirm: true });
  assert.equal((await retry.install()).completed, true);
  assert.equal(commands.length, registered);
  assert.equal((await stat(path.join(mind, 'rules.md'))).mtimeMs, before.mtimeMs);
  assert.equal((await stat(configFile)).mtimeMs, configBefore.mtimeMs);
  assert.equal(await readFile(path.join(mind, 'user', 'VERSION'), 'utf8'), '3.0.0\n');
  const progressFile = path.join(mind, '.migration', 'migration-3.0.0.json');
  const progress = await readFile(progressFile).catch(error => { if (error?.code === 'ENOENT') return null; throw error; });
  await mkdir(path.dirname(progressFile), { recursive: true });
  await writeFile(progressFile, '{broken');
  const migrationRetry = await createSetupSession(sessionOptions);
  assert.equal((await migrationRetry.getStep()).done, true);
  assert.equal(await readFile(progressFile, 'utf8'), '{broken');
  assert.match(await readFile(path.join(mind, 'user', 'machines', 'TESTBOX.md'), 'utf8'), /^setup: done$/m);
  if (progress) await writeFile(progressFile, progress);
  else await unlink(progressFile);
  assert.equal(migrationRetry.result.completed, true);
  assert.equal(commands.length, registered);
  assert.equal((await stat(path.join(mind, 'rules.md'))).mtimeMs, before.mtimeMs);
});

test('evolve keeps its previous completion markers until owned service setup succeeds', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mind = path.join(root, 'mind');
  const kit = path.join(root, 'kit');
  const machine = path.join(mind, 'user', 'machines', 'TESTBOX.md');
  await mkdir(path.dirname(machine), { recursive: true });
  await mkdir(kit);
  await writeFile(path.join(kit, 'package.json'), JSON.stringify({ name: 'fixture', version: '3.0.0' }));
  await writeFile(path.join(mind, 'user', 'VERSION'), '2.0.0\n');
  await writeFile(machine, `machine: TESTBOX\nmind: ${mind}\nlast-check: 2029-01-01\nsetup: done\n`);
  let starts = 0;
  const runner = async () => {};
  const start = async () => {};
  const query = async () => {};
  const options = {
    kitPath: kit, mindPath: mind, hostname: 'TESTBOX', homeDir: path.join(root, 'home'), pull: false,
    now: new Date('2030-01-02T12:00:00Z'), serviceSetup: true, serviceDryRun: false,
    serviceRunner: runner, serviceStart: start, serviceQuery: query,
    installAgentAssets: async () => ({ agents: [], baseFiles: [], warnings: [], conflicts: [] }),
    configureService: async (input) => {
      assert.equal(input.kitPath, kit);
      assert.equal(input.run, runner);
      assert.equal(input.start, start);
      assert.equal(input.query, query);
      assert.equal(input.dryRun, false);
      assert.equal(input.requireOrigin, true);
      starts += 1;
      return { status: starts === 1 ? 'failed' : 'started', phase: starts === 1 ? 'registration' : null };
    },
  };
  assert.equal((await evolve(options)).completed, false);
  assert.equal(await readFile(path.join(mind, 'user', 'VERSION'), 'utf8'), '2.0.0\n');
  assert.match(await readFile(machine, 'utf8'), /^last-check: 2029-01-01$/m);
  assert.equal((await evolve(options)).completed, true);
  assert.equal(await readFile(path.join(mind, 'user', 'VERSION'), 'utf8'), '3.0.0\n');
  assert.match(await readFile(machine, 'utf8'), /^last-check: 2030-01-02$/m);
});

test('the completed installer signs into the real HTTP viewer on startup and reattachment', async (t) => {
  const fixture = await makeCoreFixture();
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: [] });
  t.after(async () => { await core.http.close(); await dispose(fixture); });
  for (const handle of [core, { attached: true, bootstrap: { ...core.bootstrap.record, secret: core.bootstrap.secret } }]) {
    const ready = await startConfiguredViewer({}, { start: async () => handle });
    const url = new URL(ready.viewerUrl);
    const token = new URLSearchParams(url.hash.slice(1)).get('session');
    assert.equal(url.origin, `http://127.0.0.1:${core.http.port}`);
    assert.ok(token);
    const response = await fetch(`${url.origin}/api/v1/view`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).contract, 'hivem1nd-gui-v3');
  }
});

test('owned configuration uses the user SID and retains an installed legacy mind and origin', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mind = path.join(root, 'OneDrive', 'HIVEM1ND');
  const cosmic = path.join(root, 'local', 'Cosmic');
  const origin = path.join(root, 'chosen-origin');
  const aclRunner = stubAclRunner();
  const calls = [];
  let registered;
  const options = {
    platform: 'win32', mindPath: mind, cosmicPath: cosmic, hostname: 'TESTBOX', kitPath: path.join(root, 'kit'),
    env: { LOCALAPPDATA: path.join(root, 'local'), OneDrive: path.join(root, 'OneDrive') },
    originPath: origin, dryRun: false, protect: false, aclRunner,
    startWithWindows: true,
    query: async (plan) => calls.length === 0 ? { present: false } : { present: true, digest: registered?.digest ?? plan.digest, executable: plan.executable, arguments: plan.arguments, installationId: registered?.installationId },
    run: async (argv) => { calls.push(argv); },
    start: async () => ({ viewerUrl: 'http://127.0.0.1:9/gui/viewer#/' }),
  };
  const first = await configureOwnedService(options);
  registered = first.state.installed;
  assert.equal(first.status, 'started');
  assert.match(first.state.installed.body, /S-1-5-21-1-2-3-1001/);
  assert.equal(first.state.installed.body.includes('S-1-5-21-current'), false);
  assert.equal(first.state.configBody.mindPath, mind);
  assert.equal(first.state.configBody.origin.path, origin);
  const second = await configureOwnedService({ ...options, originPath: path.join(root, 'wrong-origin') });
  assert.equal(second.status, 'started');
  assert.equal(second.state.configBody.origin.path, origin);
  assert.equal(calls.every((argv) => argv[0] === 'schtasks.exe'), true);
  const legacy = { ...registered, name: 'HIVEM1ND-legacy-owned' };
  const retained = await configureOwnedService({ ...options, current: legacy, query: async (plan) => {
    assert.equal(plan.name, legacy.name);
    return { present: true, digest: legacy.actualDigest ?? legacy.digest, executable: legacy.executable, arguments: legacy.arguments, installationId: legacy.installationId };
  } });
  assert.equal(retained.status, 'started');
  assert.equal(retained.state.installed.name, legacy.name);
});

test('registration query preserves the actual scheduler XML and a modified task is never replaced', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = planRegistration({ ...base, platform: 'win32', localDirectory: root });
  const actualXml = plan.body.replace('<Settings>', '<Settings>\n  ');
  let actualDigest;
  const current = { ...plan, installationId: 'owned' };
  const observe = async () => queryRegistration(plan, { current, run(file, args) {
    assert.equal(file, 'schtasks.exe');
    assert.deepEqual(args, ['/Query', '/TN', plan.name, '/XML']);
    return { status: 0, stdout: Buffer.from(`\uFEFF${actualXml}`, 'utf16le') };
  } });
  const actual = await observe();
  assert.equal(actual.present, true);
  const unowned = await installService({ ...base, platform: 'win32', localDirectory: root }, {
    dryRun: false, query: async () => ({ ...actual, digest: plan.digest, executable: plan.executable, arguments: plan.arguments }),
    run: async () => { throw new Error('unowned'); },
  });
  assert.equal(unowned.conflict, true);
  actualDigest = actual.digest;
  current.actualDigest = actualDigest;
  const owned = await observe();
  assert.equal(owned.installationId, 'owned');
  assert.deepEqual(owned.arguments, plan.arguments);
  const unchanged = await installService({ ...base, platform: 'win32', localDirectory: root }, {
    dryRun: false, current, query: observe, run: async () => { throw new Error('unchanged'); },
  });
  assert.equal(unchanged.action, 'unchanged');
  const modified = await installService({ ...base, platform: 'win32', localDirectory: root, cliPath: 'C:\\changed\\cli.mjs' }, {
    dryRun: false, current,
    query: async () => ({ ...owned, digest: 'modified', installationId: 'owned' }),
    run: async () => { throw new Error('replaced'); },
  });
  assert.equal(modified.conflict, true);
});

test('user manager queries verify loaded registrations and fail closed on unavailable managers', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const platform of ['darwin', 'linux']) {
    const plan = planRegistration({ ...base, platform, home: root, uid: 501, localDirectory: root });
    await mkdir(path.dirname(plan.file), { recursive: true });
    await writeFile(plan.file, plan.body);
    const current = { ...plan, installationId: 'owned' };
    let modified = false;
    let disabled = false;
    const run = (file, args, options) => {
      assert.equal(options.timeout, 8000);
      assert.equal(options.shell, false);
      if (file === 'systemctl') {
        assert.deepEqual(args, ['--user', 'show', plan.unit, '--no-pager', '--property=LoadState,FragmentPath,DropInPaths,NeedDaemonReload,UnitFileState']);
        return { status: 0, stdout: `LoadState=loaded\nFragmentPath=${plan.file}\nDropInPaths=${modified ? '/foreign.conf' : ''}\nNeedDaemonReload=no\nUnitFileState=${disabled ? 'disabled' : 'enabled'}\n` };
      }
      assert.equal(file, 'launchctl');
      if (args[0] === 'manageruid') return { status: 0, stdout: '501\n' };
      if (args.length === 1) return { status: 0, stdout: `PID\tStatus\tLabel\n-\t0\t${plan.label}\n` };
      assert.deepEqual(args, ['list', plan.label]);
      return { status: 0, stdout: `{\n"Label" = ${JSON.stringify(plan.label)};\n"WorkingDirectory" = ${JSON.stringify(base.workingDirectory)};\n"ProgramArguments" = (\n${(modified ? ['foreign'] : plan.arguments).map(value => JSON.stringify(value)).join(',\n')}\n);\n}` };
    };
    const actual = await queryRegistration(plan, { current, run });
    assert.equal(actual.installationId, 'owned');
    assert.equal(actual.matchesPlan, true);
    if (platform === 'linux') {
      disabled = true;
      const dormant = await queryRegistration(plan, { current, run });
      assert.equal(dormant.enabled, false);
      assert.equal(dormant.matchesPlan, false);
      assert.equal(dormant.installationId, current.installationId);
      const commands = [];
      const restored = await installService({ ...base, platform, home: root, uid: 501, localDirectory: root }, {
        dryRun: false, current, query: candidate => queryRegistration(candidate, { current, run }),
        run: async argv => { commands.push(argv); disabled = false; },
      });
      assert.deepEqual(commands, [['systemctl', '--user', 'enable', plan.unit]]);
      assert.equal(restored.os, true);
      assert.deepEqual(restored.executed, commands);
    }
    modified = true;
    const foreign = await queryRegistration(plan, { current, run });
    assert.equal(foreign.installationId, null);
    assert.equal(foreign.matchesPlan, false);
    await assert.rejects(queryRegistration(plan, { current, run: () => ({ error: new Error('unavailable'), status: null }) }), { code: 'service_unavailable' });
    await writeFile(plan.file, 'foreign service file');
    const absent = (_file, args) => ({ status: 0, stdout: args[0] === 'manageruid' ? '501\n' : platform === 'darwin' ? 'PID\tStatus\tLabel\n' : 'LoadState=not-found\n' });
    const kept = await installService({ ...base, platform, home: root, uid: 501, localDirectory: root }, {
      dryRun: false, query: candidate => queryRegistration(candidate, { run: absent }),
      run: async () => { throw new Error('foreign file was replaced'); },
    });
    assert.equal(kept.conflict, true);
    assert.equal(await readFile(plan.file, 'utf8'), 'foreign service file');
  }
});

test('an unverified successful registration command does not complete the registration phase', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await runServicePhases({
    config: { mindPath: path.join(root, 'mind'), stagingPath: path.join(root, 'staging'), machine: 'TESTBOX', origin: { kind: 'folder', path: path.join(root, 'origin') }, startWithWindows: true },
    registration: { ...base, platform: 'win32', localDirectory: root },
  }, { dryRun: false, run: async () => {}, query: async () => ({ present: false }), start: async () => { throw new Error('must not start'); } });
  assert.equal(result.status, 'failed');
  assert.equal(result.phase, 'registration');
  assert.equal(result.state.registration, true);
  assert.equal(result.state.configBody.startWithWindows, false);
  assert.match(result.error, /could not be verified/);
});

test('a successful registration with a transient query failure retries verification without replacing the task', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const modified of [false, 'parallel', 'disabled']) {
    const cosmic = path.join(root, String(modified), 'Cosmic');
    const mind = path.join(root, String(modified), 'mind');
    const ownershipFile = path.join(cosmic, 'hivem1nd-service', mindKeyFor(mind, 'win32'), 'TESTBOX', 'registration.json');
    let registered;
    let unavailable = true;
    let commands = 0;
    let starts = 0;
    const options = {
      platform: 'win32', mindPath: mind, cosmicPath: cosmic, hostname: 'TESTBOX', kitPath: path.join(root, 'kit'),
      originPath: path.join(root, String(modified), 'origin'), dryRun: false, protect: false, aclRunner: stubAclRunner(),
      startWithWindows: true,
      run: async () => { commands += 1; },
      start: async () => { starts += 1; return { viewerUrl: 'http://127.0.0.1:9/gui/viewer#/' }; },
      query: async plan => {
        registered ??= plan;
        if (!commands) return { present: false };
        const current = JSON.parse(await readFile(ownershipFile, 'utf8'));
        assert.equal(current.verification, 'pending');
        if (unavailable) { unavailable = false; throw new Error('temporary scheduler query failure'); }
        let body = registered.body.replace('<Settings>', '<Settings>\n');
        if (modified === 'parallel') body = body.replace('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>', '<MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>');
        if (modified === 'disabled') body = body.replace('<Settings>', '<Settings><Enabled>false</Enabled>');
        return queryRegistration(plan, { current, run: () => ({ status: 0, stdout: Buffer.from(`\uFEFF${body}`, 'utf16le') }) });
      },
    };
    const first = await configureOwnedService(options);
    assert.equal(first.status, 'failed');
    assert.equal(first.phase, 'registration');
    assert.equal(first.state.registration, true);
    assert.equal(first.state.configBody.startWithWindows, false);
    assert.equal(starts, 0);
    assert.equal(JSON.parse(await readFile(ownershipFile, 'utf8')).verification, 'pending');
    const second = await configureOwnedService(options);
    assert.equal(second.status, modified ? 'failed' : 'started');
    assert.equal(commands, 1);
    assert.equal(starts, modified ? 0 : 1);
    assert.equal(JSON.parse(await readFile(ownershipFile, 'utf8')).verification, modified ? 'pending' : 'verified');
  }
});

test('registration plans stay dry and quote the current user', async () => {
  const windows = await installService({ ...base, platform: 'win32' });
  assert.equal(windows.dryRun, true);
  assert.equal(windows.executed.length, 0);
  assert.match(windows.commands[0], /^schtasks\.exe \/Create /);
  assert.match(windows.body, /InteractiveToken/);
  assert.match(windows.body, /LeastPrivilege/);
  assert.equal(windows.body.includes('SYSTEM'), false);
  assert.match(windows.body, /S-1-5-21-1/);
  const mac = planRegistration({ ...base, platform: 'darwin', home: '/Users/ada', uid: 501, nodePath: '/usr/local/bin/node', cliPath: '/kit/cli/index.mjs', mindPath: '/Users/ada/Library/Application Support/Cosmic/hivem1nd', workingDirectory: '/kit' });
  assert.match(mac.commands[0], /launchctl bootstrap gui\/501/);
  const linux = planRegistration({ ...base, platform: 'linux', home: '/home/ada', nodePath: '/usr/bin/node', cliPath: '/kit/cli/index.mjs', mindPath: '/home/ada/.local/share/Cosmic/hivem1nd', workingDirectory: '/kit' });
  assert.match(linux.body, /Restart=on-failure/);
  assert.match(linux.commands[0], /systemctl --user daemon-reload/);
  const removed = uninstallService(windows);
  assert.match(removed.commands[0], /schtasks\.exe \/Delete/);
  assert.equal(verifyOwnedRegistration(null, windows).reason, 'absent');
  assert.equal(verifyOwnedRegistration({ digest: 'other' }, windows).reason, 'modified');
  assert.equal(verifyOwnedRegistration({ digest: windows.digest }, windows).owned, true);
  const config = bootstrapConfig({
    mindPath: 'C:\\mind',
    machine: 'DESKTOP',
    stagingPath: 'C:\\local\\staging',
    origin: { kind: 'folder', path: 'D:\\origin' },
  });
  assert.equal(config.format, 'hivem1nd-service-config-v1');
  assert.equal(config.port, 0);
  await assert.rejects(async () => bootstrapConfig({
    mindPath: 'C:\\mind',
    machine: 'DESKTOP',
    stagingPath: 'C:\\mind\\staging',
    origin: { kind: 'folder', path: 'D:\\origin' },
    preset: 'quantum',
  }), { code: 'unsupported_origin' });
});

test('registration quoting, reinstall, and failed phase recovery stay off the operating system', async (context) => {
  const quoted = planRegistration({
    platform: 'win32',
    nodePath: 'C:\\Program Files\\node.exe',
    cliPath: 'C:\\kit\\"tools"\\cli.mjs',
    mindPath: 'C:\\Users\\Niño\\mind',
    workingDirectory: 'C:\\work\\',
    localDirectory: 'C:\\local',
    sid: 'S-1-5-21-9',
  });
  assert.match(quoted.body, /Niño/);
  assert.match(quoted.body, /&quot;/);
  assert.equal(quoted.body.includes('SYSTEM'), false);
  assert.equal(quoted.body.includes('HighestAvailable'), false);
  assert.equal(quoted.encoding, 'utf-16le');
  assert.throws(() => planRegistration({ ...base, platform: 'win32', cliPath: 'bad\npath' }), { code: 'invalid_path' });
  const linux = planRegistration({
    platform: 'linux',
    nodePath: '/usr/bin/node',
    cliPath: '/opt/kit/cli/index.mjs',
    mindPath: '/home/ada/100% done',
    workingDirectory: '/opt/kit',
    home: '/home/ada',
  });
  assert.match(linux.body, /100%% done/);
  assert.equal(linux.body.includes('100% done'), false);
  assert.throws(() => planRegistration({
    platform: 'linux',
    nodePath: '/usr/bin/node',
    cliPath: '/opt/kit/cli/index.mjs',
    mindPath: '/home/ada/mind',
    workingDirectory: '/opt/kit',
    userManager: false,
  }), { code: 'service_unavailable' });

  const calls = [];
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const input = {
    config: {
      mindPath: 'C:\\mind',
      machine: 'DESKTOP',
      stagingPath: 'C:\\local\\staging',
      origin: { kind: 'folder', path: 'D:\\origin' },
      startWithWindows: true,
    },
    registration: { ...base, platform: 'win32', localDirectory: path.join(root, 'local') },
  };
  let persisted = 0;
  const first = await runServicePhases(input, {
    dryRun: false,
    run: async (command) => { calls.push(command); },
    persistConfig: async () => { persisted += 1; },
    start: async () => { throw new Error('down'); },
  });
  assert.equal(first.status, 'failed');
  assert.equal(first.phase, 'start');
  assert.equal(first.viewerUrl, null);
  const xml = await readFile(path.join(root, 'local', 'service-task.xml'));
  assert.equal(xml[0], 0xff);
  assert.equal(xml[1], 0xfe);
  assert.match(xml.toString('utf16le'), /--mind-path/);
  assert.equal(Array.isArray(calls[0]), true);
  assert.equal(calls[0][0], 'schtasks.exe');
  assert.equal(calls[0].includes('--mind'), false);
  assert.equal(persisted, 2);
  assert.equal(calls.length, 1);
  const second = await runServicePhases(input, {
    dryRun: false,
    state: first.state,
    current: { digest: first.state.installed.digest },
    run: async (command) => { calls.push(command); },
    persistConfig: async () => { persisted += 1; },
    start: async () => ({ viewerUrl: 'http://127.0.0.1/gui/v#/' }),
  });
  assert.equal(second.status, 'started');
  assert.equal(second.viewerUrl, 'http://127.0.0.1/gui/v#/');
  assert.equal(persisted, 2);
  assert.equal(calls.length, 1);
  const third = await runServicePhases(input, {
    dryRun: false,
    state: second.state,
    current: { digest: first.state.installed.digest },
    run: async (command) => { calls.push(command); },
    persistConfig: async () => { persisted += 1; },
    start: async () => ({ viewerUrl: 'http://127.0.0.1/gui/v#/' }),
  });
  assert.equal(third.status, 'started');
  assert.equal(calls.length, 1);
  const foreign = await installService({ ...base, platform: 'win32' }, {
    dryRun: false,
    current: { digest: 'other' },
    run: async () => { calls.push('foreign'); },
  });
  assert.equal(foreign.conflict, true);
  assert.equal(foreign.commands.length, 0);
  assert.equal(calls.includes('foreign'), false);
  const same = await installService({ ...base, platform: 'win32' }, {
    dryRun: false,
    current: { digest: foreign.digest },
    run: async () => { calls.push('same'); },
  });
  assert.equal(same.action, 'unchanged');
  assert.equal(calls.includes('same'), false);
  assert.notEqual(planRegistration({ ...base, platform: 'win32', sid: 'S-1-5-21-1' }).name, planRegistration({ ...base, platform: 'win32', sid: 'S-1-5-99-1' }).name);
  assert.equal(planRegistration({ ...base, platform: 'win32' }).arguments.includes('--mind'), false);
});

test('a mismatched operating system registration is left in place', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const localDirectory = path.join(root, 'local');
  const acl = stubAclRunner();
  const calls = [];
  const created = await installService({ ...base, platform: 'win32', localDirectory }, {
    dryRun: false,
    aclRunner: acl,
    query: async (plan) => calls.length === 0 ? { present: false } : { present: true, digest: plan.digest, executable: plan.executable, arguments: plan.arguments },
    run: async (argv) => { calls.push(argv); },
  });
  assert.equal(created.action, 'create');
  assert.equal(created.os, true);
  assert.equal(acl.calls.some((call) => call.op === 'protect'), true);
  assert.equal(calls[0][0], 'schtasks.exe');
  const blocked = await installService({ ...base, platform: 'win32', localDirectory }, {
    dryRun: false,
    current: { installationId: 'ours', digest: created.digest },
    query: async () => ({ present: true, installationId: 'foreign', executable: 'C:\\other.exe', arguments: [], digest: 'no' }),
    run: async () => { calls.push('again'); },
  });
  assert.equal(blocked.conflict, true);
  assert.equal(calls.includes('again'), false);
  const mind = path.join(root, 'mind');
  const directory = path.join(root, 'Cosmic', 'hivem1nd-service', mindKeyFor(mind, 'win32'), 'TESTBOX');
  await mkdir(directory, { recursive: true });
  const record = {
    format: 'hivem1nd-registration-v1',
    installationId: 'ours',
    executable: created.executable,
    arguments: created.arguments,
    name: created.name,
    path: created.file,
    body: created.body,
    digest: created.digest,
  };
  const file = path.join(directory, 'registration.json');
  await writeFile(file, `${JSON.stringify(record)}\n`);
  const kept = await removeOwnedRegistration({
    platform: 'win32',
    mindPath: mind,
    hostname: 'TESTBOX',
    cosmicPath: path.join(root, 'Cosmic'),
    dryRun: false,
    query: async () => ({ present: true, installationId: 'foreign', executable: 'C:\\other.exe', arguments: [], digest: 'no' }),
    run: async () => { throw new Error('deleted'); },
  });
  assert.match(kept.kept.reason, /left in place/);
  assert.match(await readFile(file, 'utf8'), /ours/);
  await assert.rejects(() => startConfiguredViewer({}, {
    start: async () => ({ http: { port: 1 } }),
    login: async () => 'http://127.0.0.1/gui/viewer#/',
  }), { code: 'service_unavailable' });
  const ready = await startConfiguredViewer({}, {
    start: async () => ({ http: { port: 9 }, bootstrap: { secret: 's' } }),
    login: async ({ port, secret }) => (port === 9 && secret === 's' ? 'http://127.0.0.1:9/gui/v#/' : null),
  });
  assert.equal(ready.viewerUrl, 'http://127.0.0.1:9/gui/v#/');
});

test('uninstall describes an owned registration and keeps a modified one', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mind = path.join(root, 'mind');
  const home = path.join(root, 'home');
  const platform = process.platform;
  const env = platform === 'win32'
    ? { LOCALAPPDATA: path.join(root, 'local') }
    : platform === 'darwin'
      ? {}
      : { XDG_DATA_HOME: path.join(root, 'share') };
  const cosmic = platform === 'win32'
    ? path.join(env.LOCALAPPDATA, 'Cosmic')
    : platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Cosmic')
      : path.join(env.XDG_DATA_HOME, 'Cosmic');
  const directory = path.join(cosmic, 'hivem1nd-service', mindKeyFor(mind, platform), 'TESTBOX');
  await mkdir(directory, { recursive: true });
  const body = '<Task>owned</Task>';
  const record = {
    format: 'hivem1nd-registration-v1',
    executable: platform === 'win32' ? 'C:\\node.exe' : '/usr/bin/node',
    arguments: [platform === 'win32' ? 'C:\\cli.mjs' : '/kit/cli.mjs'],
    name: 'HIVEM1ND-service',
    path: path.join(directory, 'service-task.xml'),
    body,
    digest: createHash('sha256').update(body).digest('hex'),
  };
  const file = path.join(directory, 'registration.json');
  await writeFile(file, `${JSON.stringify(record)}\n`);
  const described = await removeOwnedRegistration({
    platform, mindPath: mind, hostname: 'TESTBOX', env, homeDir: home, dryRun: true,
  });
  assert.equal(described.described, true);
  assert.equal(described.commands.length, 1);
  record.digest = 'tampered';
  await writeFile(file, `${JSON.stringify(record)}\n`);
  const kept = await removeOwnedRegistration({
    platform, mindPath: mind, hostname: 'TESTBOX', env, homeDir: home, dryRun: false, run: async () => { throw new Error('os'); },
  });
  assert.equal(kept.kept.path, file);
  assert.match(await readFile(file, 'utf8'), /tampered/);
});

test('owned macOS removal uses the current UID and removes only the matching launch file', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mind = path.join(root, 'mind');
  const cosmic = path.join(root, 'Cosmic');
  const directory = path.join(cosmic, 'hivem1nd-service', mindKeyFor(mind, 'darwin'), 'TESTBOX');
  const plan = planRegistration({ ...base, platform: 'darwin', home: root, uid: 731, mindPath: mind });
  const record = { ...plan, installationId: 'owned', path: plan.file, name: plan.label };
  await mkdir(directory, { recursive: true });
  await mkdir(path.dirname(plan.file), { recursive: true });
  await writeFile(plan.file, plan.body);
  const file = path.join(directory, 'registration.json');
  await writeFile(file, JSON.stringify(record));
  const commands = [];
  const options = {
    platform: 'darwin', mindPath: mind, cosmicPath: cosmic, hostname: 'TESTBOX', dryRun: false,
    query: async () => ({ ...record, present: true }), run: async argv => { commands.push(argv); },
  };
  const foreign = await removeOwnedRegistration({ ...options, uid: 501 });
  assert.match(foreign.kept.reason, /another user/);
  assert.deepEqual(commands, []);
  const removed = await removeOwnedRegistration({ ...options, uid: 731 });
  assert.deepEqual(commands, [['launchctl', 'bootout', 'gui/731', plan.file]]);
  assert.deepEqual(removed.removedPaths, [plan.file, file]);
  await assert.rejects(readFile(plan.file), { code: 'ENOENT' });
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});

test('service install dry-run is a plan and the wizard opens one viewer', async (context) => {
  const parsed = parseArgs(['service', 'install', '--dry-run', '--origin-kind', 'folder', '--origin-path', 'D:\\origin', '--cosmic-path', 'D:\\Cosmic', '--mind-path', 'D:\\Cosmic\\hivem1nd']);
  assert.equal(parsed.command, 'service');
  assert.equal(parsed.options.action, 'install');
  assert.equal(parsed.options.dryRun, true);
  assert.equal(parsed.options.originKind, 'folder');
  const planned = await installService({ ...base, platform: 'win32' }, {
    dryRun: parsed.options.dryRun,
    run: async () => { assert.fail('A dry run must not execute service registration.'); },
  });
  assert.equal(planned.dryRun, true);
  assert.deepEqual(planned.executed, []);
  assert.ok(planned.commands.length > 0);
  const opened = [];
  let number = 3;
  let result = null;
  const session = {
    async getStep() { return { id: number === 3 ? 'service' : 'ready', number, total: 4, back: false, busy: false, language: 'en', fields: [], values: {}, done: number === 4, result }; },
    async preview() { return { conflicts: [] }; },
    async answer() {},
    async install() {
      number = 4;
      result = { completed: true, viewerUrl: 'http://127.0.0.1:9/gui/viewer#/' };
      return result;
    },
  };
  const server = await createWizardServer({
    session,
    token: 'a'.repeat(43),
    openCompletedViewer: async (url) => { opened.push(url); },
  });
  context.after(() => server.close());
  const response = await fetch(`${server.origin}/api/v1/install`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${server.token}`,
      Origin: server.origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirm: true, conflicts: {} }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, result);
  assert.deepEqual(opened, []);
  for (let index = 0; index < 2; index += 1) {
    const step = await fetch(`${server.origin}/api/v1/step`, { headers: { Authorization: `Bearer ${server.token}` } });
    assert.equal(step.status, 200);
    const ready = (await step.json()).data;
    assert.equal(ready.id, 'ready');
    assert.equal(ready.number, 4);
    assert.equal(ready.done, true);
  }
  assert.deepEqual(opened, []);
  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(`${server.origin}/api/v1/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${server.token}`, Origin: server.origin, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { opened: true, viewerUrl: null });
  }
  assert.deepEqual(opened, ['http://127.0.0.1:9/gui/viewer#/']);
});

function independentCrc(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test('installer archives are reproducible and reject malicious containers', async (context) => {
  const files = [
    { name: 'notes/readme.txt', data: Buffer.from('alpha') },
    { name: 'b.txt', data: Buffer.from('beta') },
  ];
  const first = build({ files, runtime: 'unverified' });
  const second = build({ files, runtime: 'unverified' });
  assert.equal(first.digest, second.digest);
  assert.equal(first.zip.equals(second.zip), true);
  assert.equal(first.zip.readUInt32LE(0), 0x04034b50);
  assert.equal(first.zip.readUInt32LE(first.zip.length - 22), 0x06054b50);
  const nameLength = first.zip.readUInt16LE(26);
  const size = first.zip.readUInt32LE(22);
  const data = first.zip.subarray(30 + nameLength, 30 + nameLength + size);
  assert.equal(independentCrc(data), first.zip.readUInt32LE(14));
  const entries = readArchive(first.zip);
  assert.deepEqual(entries.map((entry) => entry.name), ['b.txt', 'install.cmd', 'manifest.json', 'notes/readme.txt']);
  const broken = Buffer.from(first.zip);
  broken[30 + nameLength] ^= 0xff;
  assert.throws(() => readArchive(broken), { code: 'zip_rejected' });
  const traversal = Buffer.from(writeZip([{ name: 'aa.txt', data: Buffer.from('hi') }]));
  const from = Buffer.from('aa.txt');
  const to = Buffer.from('../a/b');
  let found = 0;
  let offset = 0;
  while (offset >= 0 && found < 2) {
    offset = traversal.indexOf(from, offset);
    if (offset < 0) break;
    to.copy(traversal, offset);
    found += 1;
    offset += from.length;
  }
  assert.equal(found, 2);
  assert.throws(() => readArchive(traversal), { code: 'zip_rejected' });
  assert.throws(() => writeZip([{ name: '../x', data: Buffer.from('no') }]), { code: 'zip_rejected' });
  assert.throws(() => writeZip([{ name: 'a', data: Buffer.from('1') }, { name: 'a', data: Buffer.from('2') }]), { code: 'zip_rejected' });
  const odd = Buffer.from(writeZip([{ name: 'aa.txt', data: Buffer.from('hi') }]));
  odd.writeUInt16LE(99, odd.readUInt32LE(odd.length - 6) + 10);
  assert.throws(() => readArchive(odd), { code: 'zip_rejected' });
  const shifted = Buffer.from(writeZip([{ name: 'aa.txt', data: Buffer.from('hi') }]));
  const central = shifted.readUInt32LE(shifted.length - 6);
  shifted.writeUInt32LE(0xfffffff0, central + 42);
  assert.throws(() => readArchive(shifted), { code: 'zip_rejected' });
  assert.throws(() => assertZipBounds({ count: 65536, offset: 0, size: 1 }), { code: 'zip_too_large' });
  const expanded = writeZip([{ name: 'c.txt', data: Buffer.alloc(80, 7), method: 8 }]);
  assert.throws(() => readArchive(expanded, { maxOutput: 10 }), { code: 'zip_rejected' });
  const manifest = JSON.parse(entries.find((entry) => entry.name === 'manifest.json').data.toString('utf8'));
  assert.equal(Object.hasOwn(manifest, 'user'), false);
  assert.equal(JSON.stringify(manifest).includes('C:\\'), false);

  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const stage = path.join(root, 'stage');
  const child = path.join(stage, 'child');
  await mkdir(child, { recursive: true });
  await writeFile(path.join(child, 'note.txt'), 'keep');
  await assert.rejects(() => cleanStage(stage, stage));
  await assert.rejects(() => cleanStage(path.join(root, '..', 'outside'), stage));
  const outside = path.join(root, 'outside');
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'safe.txt'), 'safe');
  const link = path.join(stage, 'link');
  await symlink(outside, link, 'junction');
  await assert.rejects(() => cleanStage(link, stage));
  assert.equal(await readFile(path.join(outside, 'safe.txt'), 'utf8'), 'safe');
  await cleanStage(child, stage);
  await assert.rejects(() => access(child), { code: 'ENOENT' });

  const planned = await dryRun({ cliPath: 'C:\\Program Files\\kit\\cli\\index.mjs' });
  assert.equal(planned.osCalls, 0);
  assert.equal(planned.activated, false);
  assert.equal(planned.browserAssets, 'unavailable');
  assert.match(planned.script, /"%~dp0runtime\\node\.exe"/);
  assert.match(planned.body, /&quot;C:\\Program Files\\kit\\cli\\index\.mjs&quot;/);
  assert.throws(() => build({ release: true, browserAssets: 'unavailable' }), /browser assets/);
  await assert.rejects(() => assertReleaseAssets(root), /browser asset/);
  const fake = path.join(root, 'fake-node.zip');
  await writeFile(fake, writeZip([{ name: 'node-v22.23.3-win-x64/node.exe', data: Buffer.from('not-node') }]));
  const missing = path.join(root, 'artifact.zip');
  await assert.rejects(() => main(['--node-zip', fake, '--dry-run', '--output', missing]), /digest/);
  await assert.rejects(() => access(missing), { code: 'ENOENT' });
  await assert.rejects(() => main(['--output', missing]), /does not download/);

  const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const lock = JSON.parse(await readFile(path.join(packageRoot, 'package-lock.json'), 'utf8'));
  const packages = productionPackages(lock);
  assert.equal(packages.length, 8);
  assert.equal(packages.some((item) => item.name === '@clack/prompts'), true);
  assert.equal(packages.some((item) => item.name === 'electron'), false);
  await verifyInstalled(packageRoot, packages);
  const cached = [process.env.HIVEM1ND_NODE_ZIP, path.join(os.homedir(), 'Downloads', 'node-v22.23.3-win-x64.zip')].filter(Boolean);
  let runtime = 'pinned node-v22.23.3-win-x64.zip unavailable';
  for (const candidate of cached) {
    try {
      await access(candidate);
      await verifyRuntime(candidate);
      runtime = `verified ${candidate}`;
      break;
    } catch (error) {
      if (error?.code === 'runtime_digest') runtime = `pinned node archive digest mismatch at ${candidate}`;
    }
  }
  assert.match(runtime, /unavailable|verified|digest mismatch/);
});

test('the runtime reader accepts the pinned NTFS extra and a dry-run stages offline', async (context) => {
  assert.ok(NODE_ENTRY_LIMIT >= 86973768);
  const extra = Buffer.alloc(36);
  extra.writeUInt16LE(0x000a, 0);
  extra.writeUInt16LE(32, 2);
  const archive = writeZip([
    { name: 'node-v22.23.3-win-x64/', data: Buffer.alloc(0) },
    { name: NODE_EXE_NAME, data: Buffer.alloc(20, 1), extra },
    { name: 'node-v22.23.3-win-x64/LICENSE', data: Buffer.from('license'), extra },
  ]);
  const entries = readArchive(archive, { maxOutput: 10, only: [NODE_EXE_NAME, 'node-v22.23.3-win-x64/LICENSE'] });
  assert.deepEqual(entries.map((entry) => entry.name), ['node-v22.23.3-win-x64/LICENSE', NODE_EXE_NAME]);
  const bad = Buffer.from(archive);
  const at = bad.indexOf(extra);
  bad.writeUInt16LE(0x0001, at);
  assert.throws(() => readArchive(bad), { code: 'zip_rejected' });
  assert.throws(() => readArchive(writeZip([{ name: 'link.txt', data: Buffer.from('target'), mode: 0o120000 }])), { code: 'zip_rejected' });
  const version = await confirmRuntimeVersion(Buffer.from('MZ'), {
    spawn(file, args, options) {
      assert.equal(args[0], '--version');
      assert.equal(options.shell, false);
      assert.equal(options.env.PATH, '');
      assert.equal(file.endsWith(`${path.sep}node.exe`), true);
      return 'v22.23.3\n';
    },
  });
  assert.equal(version, 'v22.23.3');
  await assert.rejects(() => confirmRuntimeVersion(Buffer.from('MZ'), { spawn: () => 'v22.0.0\n' }), { code: 'runtime_version' });

  const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const lock = JSON.parse(await readFile(path.join(packageRoot, 'package-lock.json'), 'utf8'));
  const payload = await collectPayload({
    executable: Buffer.from('runtime'),
    license: Buffer.from('node-license'),
    lock,
    packageRoot,
    includeBrowser: false,
  });
  const names = new Set(payload.map((file) => file.name));
  assert.equal(names.has('runtime/node.exe'), true);
  assert.equal(names.has('runtime/LICENSE'), true);
  assert.equal(names.has('installer.mjs'), true);
  assert.equal(names.has('install.cmd'), true);
  for (const item of productionPackages(lock)) assert.equal(names.has(`${item.key}/package.json`), true);
  assert.equal([...names].some((name) => name.startsWith('node_modules/electron/')), false);
  const artifact = build({ files: payload.slice(0, 4), dryRun: true, runtime: 'verified', label: 'dry-run' });
  const manifest = JSON.parse(readArchive(artifact.zip).find((entry) => entry.name === 'manifest.json').data.toString('utf8'));
  assert.equal(manifest.label, 'dry-run');
  assert.equal(manifest.files.some((file) => file.name === 'installer.mjs'), true);

  const stageRoot = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  context.after(() => rm(stageRoot, { recursive: true, force: true }));
  const planned = await dryRun({
    files: [{ name: 'runtime/node.exe', data: Buffer.from('runtime') }, { name: 'notes.txt', data: Buffer.from('staged') }],
    stageRoot,
    cliPath: 'C:\\Program Files\\kit\\cli\\index.mjs',
    spawn(file, args, options) {
      assert.equal(options.env.PATH, '');
      assert.equal(options.shell, false);
      assert.match(args.at(-1), /@clack\/prompts/);
      assert.equal(file.endsWith(`${path.sep}node.exe`), true);
      return '';
    },
  });
  assert.equal(planned.label, 'dry-run');
  assert.equal(planned.osCalls, 0);
  assert.equal(planned.activated, false);
  assert.equal(planned.importSmoke, 'passed');
  assert.equal(await readFile(path.join(planned.staged, 'notes.txt'), 'utf8'), 'staged');
});

test('activation keeps the previous payload and refuses a junction stage', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const outside = path.join(root, 'outside');
  const kit = path.join(root, 'kit');
  await mkdir(outside, { recursive: true });
  await mkdir(kit, { recursive: true });
  await writeFile(path.join(outside, 'secret.txt'), 'safe');
  await writeFile(path.join(kit, 'previous.txt'), 'keep');
  await symlink(outside, path.join(root, 'kit.stage'), 'junction');
  await symlink(outside, path.join(root, 'linked'), 'junction');
  await assert.rejects(() => installPayload({
    dryRun: false,
    root,
    destination: path.join(root, 'linked', 'kit'),
    files: [{ name: 'notes.txt', data: Buffer.from('new') }],
  }), /link/);
  assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'safe');
  const notes = Buffer.from('new');
  const manifest = {
    files: [{ name: 'notes.txt', bytes: notes.length, sha256: createHash('sha256').update(notes).digest('hex') }],
  };
  const identity = { mindPath: path.join(root, 'mind'), machine: 'DESKTOP', localDirectory: path.join(root, 'service-local') };
  const active = { ...identity, pid: 4, startedAt: '2026-10-10T12:00:00.000Z' };
  await assert.rejects(() => installPayload({
    dryRun: false,
    root,
    destination: kit,
    files: [{ name: 'notes.txt', data: notes }],
    manifest,
    identity,
    active: { ...active, mindPath: path.join(root, 'foreign-mind') },
  }), { code: 'identity_mismatch' });
  await assert.rejects(() => installPayload({
    dryRun: false,
    root,
    destination: kit,
    files: [{ name: 'notes.txt', data: notes }],
    manifest,
    active,
  }), { code: 'identity_mismatch' });
  assert.equal(await readFile(path.join(kit, 'previous.txt'), 'utf8'), 'keep');
  const activated = await installPayload({
    dryRun: false,
    root,
    destination: kit,
    files: [{ name: 'runtime/node.exe', data: Buffer.from('runtime') }, { name: 'notes.txt', data: notes }],
    manifest,
    identity,
    active,
    smoke: true,
    spawn(file, args, options) {
      assert.equal(options.env.PATH, '');
      assert.equal(options.shell, false);
      assert.match(String(args.at(-1)), /@clack\/prompts/);
      return '';
    },
  });
  assert.equal(activated.activated, true);
  assert.equal(await readFile(path.join(kit, 'notes.txt'), 'utf8'), 'new');
  assert.equal(await readFile(path.join(activated.backup, 'previous.txt'), 'utf8'), 'keep');
  await assert.rejects(() => access(path.join(kit, 'previous.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'safe');
  const names = await readdir(root);
  assert.deepEqual(names.filter((name) => name.endsWith('.stage')), ['kit.stage']);
});

test('release packaging uses the served browser modules', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  await mkdir(app);
  assert.equal(BROWSER_ASSETS.includes('app.js'), false);
  assert.equal(BROWSER_ASSETS.includes('main.mjs'), true);
  assert.equal(BROWSER_ASSETS.includes('find-worker.mjs'), true);
  for (const name of BROWSER_ASSETS) {
    const body = name === 'index.html'
      ? '<link rel="stylesheet" href="./styles.css">\n<script type="module" src="./main.mjs"></script>\n'
      : name === 'main.mjs'
        ? "import './api.mjs';\n"
        : 'kept';
    await writeFile(path.join(app, name), body);
  }
  await assertReleaseAssets(app);
  const archived = new Set(BROWSER_ASSETS.filter((name) => !Object.hasOwn(EMBEDDED_BROWSER_FILES, name)).map((name) => `gui/app/${name}`));
  assert.equal(missingPackagedBrowserAssets(archived, EMBEDDED_BROWSER_FILES).length, 0);
  assert.equal(BROWSER_ASSETS.includes('mark.svg'), true);
  assert.deepEqual(missingPackagedBrowserAssets(archived, EMBEDDED_BROWSER_FILES), []);
  archived.delete('gui/app/find-worker.mjs');
  assert.deepEqual(missingPackagedBrowserAssets(archived, EMBEDDED_BROWSER_FILES), ['gui/app/find-worker.mjs']);
  archived.add('gui/app/find-worker.mjs');
  archived.delete('gui/app/main.mjs');
  assert.deepEqual(missingPackagedBrowserAssets(archived, EMBEDDED_BROWSER_FILES), ['gui/app/main.mjs']);
  await rm(path.join(app, 'mark.svg'));
  await writeFile(path.join(app, 'index.html'), '<link rel="icon" href="mark.svg">\n<link rel="stylesheet" href="./styles.css">\n<script type="module" src="./main.mjs"></script>\n');
  await assertReleaseAssets(app);
  await writeFile(path.join(app, 'main.mjs'), "import './extra.mjs';\n");
  await assert.rejects(() => assertReleaseAssets(app), /browser asset extra\.mjs/);
  await rm(path.join(app, 'main.mjs'));
  await assert.rejects(() => assertReleaseAssets(app), /browser asset main\.mjs/);
});

test('runtime ownership survives absent registration.json', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const local = path.join(root, 'local');
  const payload = path.join(root, 'payload');
  await mkdir(path.join(payload, 'cli'), { recursive: true });
  await mkdir(path.join(payload, 'runtime'), { recursive: true });
  await mkdir(path.join(payload, 'engine', 'service'), { recursive: true });
  const cli = "process.stdout.write('setup');\n";
  const security = "export async function verifyBootstrapFiles() { if (process.env.FIXTURE_UNPROTECTED === '1') throw new Error('Unprotected fixture'); }\nexport function aclRunnerFrom() { return { userSid() { return 'S-1-5-21-1-2-3-1001'; } }; }\n";
  await writeFile(path.join(payload, 'cli', 'index.mjs'), cli);
  await writeFile(path.join(payload, 'engine', 'service', 'security.mjs'), security);
  await writeFile(path.join(payload, 'runtime', 'node.exe'), Buffer.from('runtime'));
  const files = [
    { name: 'cli/index.mjs', data: Buffer.from(cli) },
    { name: 'runtime/node.exe', data: Buffer.from('runtime') },
    { name: 'engine/service/security.mjs', data: Buffer.from(security) },
  ];
  const manifest = manifestDocument(files);
  assert.equal(manifest.identity, undefined);
  manifest.identity = {
    mindPath: path.join(local, 'Cosmic', 'not-this-mind'),
    machine: 'OTHER',
    localDirectory: path.join(local, 'Cosmic', 'not-this-service'),
  };
  await writeFile(path.join(payload, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  await writeFile(path.join(payload, 'installer.mjs'), installerEntry());
  assert.match(installerScript(), /%\*/);
  const recorder = path.join(root, 'record.mjs');
  const recordFile = path.join(root, 'recorded.txt');
  await writeFile(recorder, "import { writeFile } from 'node:fs/promises';\nawait writeFile(process.env.RECORD_PATH, process.argv.slice(2).join('\\n'));\n");
  const env = { ...process.env, LOCALAPPDATA: local, RECORD_PATH: recordFile, HIVEM1ND_REGISTRATION_RUNNER: recorder };
  const dry = spawnSync(process.execPath, [path.join(payload, 'installer.mjs'), '--dry-run'], { env, shell: false, windowsHide: true, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /dry-run/);
  assert.match(dry.stdout, /action: plan/);
  assert.match(dry.stdout, /hivem1nd-kit/);
  await assert.rejects(() => access(path.join(local, 'Cosmic', 'hivem1nd-kit')), { code: 'ENOENT' });
  const installed = spawnSync(process.execPath, [path.join(payload, 'installer.mjs')], { env, shell: false, windowsHide: true, encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(await readFile(path.join(local, 'Cosmic', 'hivem1nd-kit', 'cli', 'index.mjs'), 'utf8'), cli);
  const recorded = await readFile(recordFile, 'utf8');
  assert.match(recorded, /init/);
  assert.match(recorded, /--gui/);
  await assert.rejects(() => access(path.join(local, 'Cosmic', '.m1nd')), { code: 'ENOENT' });
  const target = path.join(root, 'junction-target');
  const linked = path.join(root, 'linked-local');
  await mkdir(target, { recursive: true });
  await mkdir(linked, { recursive: true });
  await symlink(target, path.join(linked, 'Cosmic'), 'junction');
  const blocked = spawnSync(process.execPath, [path.join(payload, 'installer.mjs')], {
    env: { ...env, LOCALAPPDATA: linked },
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
  });
  assert.notEqual(blocked.status, 0);
  await assert.rejects(() => access(path.join(target, 'hivem1nd-kit')), { code: 'ENOENT' });
  const mindPath = path.join(local, 'Cosmic', 'mind');
  const machine = 'DESKTOP';
  const ownedDirectory = path.join(local, 'Cosmic', 'hivem1nd-service', mindKeyFor(mindPath, 'win32'), machine);
  await mkdir(ownedDirectory, { recursive: true });
  await writeFile(path.join(ownedDirectory, 'config.json'), `${JSON.stringify({
    format: 'hivem1nd-service-config-v1',
    mindPath,
    machine,
    origin: { kind: 'folder', path: path.join(local, 'Cosmic', 'origin') },
    stagingPath: path.join(ownedDirectory, 'staging'),
    port: 0,
  })}\n`);
  await writeFile(path.join(ownedDirectory, 'service.json'), `${JSON.stringify({
    format: 'hivem1nd-service-local-v1', pid: 9, origin: 'http://127.0.0.1:43123', startedAt: '2026-10-10T12:00:00.000Z',
  })}\n`);
  await assert.rejects(readFile(path.join(ownedDirectory, 'registration.json')), { code: 'ENOENT' });
  await mkdir(path.join(local, 'Cosmic', 'hivem1nd-service'), { recursive: true });
  const userKey = process.platform === 'win32' ? 'S-1-5-21-1-2-3-1001' : String(process.getuid());
  const port = 49152 + (createHash('sha256').update(userKey).digest().readUInt16BE(0) % 16384);
  const lockFile = path.join(local, 'Cosmic', 'hivem1nd-service', 'service.lock');
  const descriptor = { format: 'hivem1nd-service-descriptor-v1', machine, mind: path.resolve(mindPath), pid: 9, port, userKey };
  const lock = { nonce: 'fixture-owner', pid: 9, digest: createHash('sha256').update(JSON.stringify(descriptor)).digest('hex') };
  await writeFile(lockFile, JSON.stringify(lock));
  const activeFile = path.join(local, 'Cosmic', 'hivem1nd-service', 'active.json');
  await writeFile(activeFile, JSON.stringify({
    pid: 9,
    mindPath,
    machine,
    localDirectory: ownedDirectory,
    startedAt: '2026-10-10T12:00:00.000Z',
  }));
  const failRunner = path.join(root, 'fail.mjs');
  await writeFile(failRunner, 'process.exit(1);\n');
  const rolled = spawnSync(process.execPath, [path.join(payload, 'installer.mjs')], {
    env: { ...env, HIVEM1ND_REGISTRATION_RUNNER: failRunner },
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
  });
  assert.notEqual(rolled.status, 0);
  assert.equal(await readFile(path.join(local, 'Cosmic', 'hivem1nd-kit', 'cli', 'index.mjs'), 'utf8'), cli);
  const matched = spawnSync(process.execPath, [path.join(payload, 'installer.mjs')], { env, shell: false, windowsHide: true, encoding: 'utf8' });
  assert.equal(matched.status, 0, matched.stderr);
  assert.match(matched.stdout, /installed:/);
  const unprotected = spawnSync(process.execPath, [path.join(payload, 'installer.mjs')], {
    env: { ...env, FIXTURE_UNPROTECTED: '1' }, shell: false, windowsHide: true, encoding: 'utf8',
  });
  assert.notEqual(unprotected.status, 0);
  await writeFile(lockFile, JSON.stringify({ ...lock, digest: '0'.repeat(64) }));
  const tampered = spawnSync(process.execPath, [path.join(payload, 'installer.mjs')], { env, shell: false, windowsHide: true, encoding: 'utf8' });
  assert.notEqual(tampered.status, 0);
  await writeFile(lockFile, JSON.stringify(lock));
  assert.equal(await readFile(path.join(local, 'Cosmic', 'hivem1nd-kit', 'cli', 'index.mjs'), 'utf8'), cli);
  await writeFile(activeFile, JSON.stringify({ pid: 9 }));
  const malformed = spawnSync(process.execPath, [path.join(payload, 'installer.mjs')], { env, shell: false, windowsHide: true, encoding: 'utf8' });
  assert.notEqual(malformed.status, 0);
  assert.match(`${malformed.stderr}\n${malformed.stdout}`, /does not match/);
  assert.equal(await readFile(path.join(local, 'Cosmic', 'hivem1nd-kit', 'cli', 'index.mjs'), 'utf8'), cli);
  const mind = path.join(local, 'Cosmic', '.m1nd');
  await mkdir(mind, { recursive: true });
  await writeFile(path.join(mind, 'keep.txt'), 'mind');
  await mkdir(path.join(local, 'Cosmic', 'hivem1nd-service'), { recursive: true });
  await writeFile(path.join(local, 'Cosmic', 'hivem1nd-service', 'active.json'), JSON.stringify({
    pid: 9,
    mindPath: path.join(local, 'Cosmic', 'foreign-mind'),
    machine: 'DESKTOP',
    localDirectory: ownedDirectory,
    startedAt: '2026-10-10T12:00:00.000Z',
  }));
  const refused = spawnSync(process.execPath, [path.join(payload, 'installer.mjs')], { env, shell: false, windowsHide: true, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(`${refused.stderr}\n${refused.stdout}`, /does not match/);
  assert.equal(await readFile(path.join(mind, 'keep.txt'), 'utf8'), 'mind');
  assert.equal(await readFile(path.join(local, 'Cosmic', 'hivem1nd-kit', 'cli', 'index.mjs'), 'utf8'), cli);
});

test('CI pins action commits and the install policy ignores scripts', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ci = await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const release = await readFile(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const policy = await readFile(path.join(root, '.npmrc'), 'utf8');
  assert.match(ci, /permissions:\s+contents: read/);
  assert.match(ci, /npm ci --ignore-scripts/);
  for (const text of [ci, release]) {
    assert.equal(/uses: actions\/[A-Za-z0-9-]+@v\d+/.test(text), false);
    const pins = [...text.matchAll(/uses: actions\/[A-Za-z0-9-]+@([0-9a-f]{40})/g)].map((match) => match[1]);
    assert.equal(pins.length > 0, true);
  }
  assert.match(policy, /^ignore-scripts=true$/m);
  assert.match(policy, /^min-release-age=7$/m);
  const readme = await readFile(path.join(root, 'engine', 'service', 'README.md'), 'utf8');
  assert.match(readme, /whoami\.exe \/user/);
  assert.match(readme, /icacls\.exe/);
  assert.equal(readme.includes('.NET'), false);
  assert.match(readme, /A real login registration was not verified/);
});

test('a browser reference built at runtime names no packaged file', () => {
  const text = 'const html = `<script type="module" src="${dataUrl(script)}"></script>`;' + '<img src="./mark.svg"><link href="./styles.css">';
  assert.deepEqual(browserReferences(text), ['mark.svg', 'styles.css']);
});
