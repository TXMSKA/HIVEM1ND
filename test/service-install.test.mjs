import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../cli/index.mjs';
import { createWizardServer } from '../gui/server.mjs';
import { bootstrapConfig, installService, planRegistration, removeOwnedRegistration, runServicePhases, uninstallService, verifyOwnedRegistration } from '../engine/service/install.mjs';
import { mindKeyFor } from '../engine/service/paths.mjs';

const base = {
  nodePath: 'C:\\Program Files\\node\\node.exe',
  cliPath: 'C:\\kit\\cli\\index.mjs',
  mindPath: 'C:\\Users\\Ada\\AppData\\Local\\Cosmic\\hivem1nd',
  workingDirectory: 'C:\\kit',
  localDirectory: 'C:\\Users\\Ada\\AppData\\Local\\Cosmic\\hivem1nd-service\\key\\DESKTOP',
  sid: 'S-1-5-21-1',
};

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

test('registration quoting, reinstall, and failed phase recovery stay off the operating system', async () => {
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
  const input = {
    config: {
      mindPath: 'C:\\mind',
      machine: 'DESKTOP',
      stagingPath: 'C:\\local\\staging',
      origin: { kind: 'folder', path: 'D:\\origin' },
    },
    registration: { ...base, platform: 'win32' },
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
  assert.equal(persisted, 1);
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
  assert.equal(persisted, 1);
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

test('service install dry-run is a plan and the wizard opens one viewer', async (context) => {
  const parsed = parseArgs(['service', 'install', '--dry-run', '--origin-kind', 'folder', '--origin-path', 'D:\\origin', '--cosmic-path', 'D:\\Cosmic', '--mind-path', 'D:\\Cosmic\\hivem1nd']);
  assert.equal(parsed.command, 'service');
  assert.equal(parsed.options.action, 'install');
  assert.equal(parsed.options.dryRun, true);
  assert.equal(parsed.options.originKind, 'folder');
  const opened = [];
  let number = 7;
  const session = {
    async getStep() { return { number, language: 'en', fields: [], values: {}, done: number === 8 }; },
    async preview() { return { conflicts: [] }; },
    async answer() {},
    async install() {
      number = 8;
      return { viewerUrl: 'http://127.0.0.1:9/gui/viewer#/' };
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
  assert.deepEqual(opened, ['http://127.0.0.1:9/gui/viewer#/']);
});
