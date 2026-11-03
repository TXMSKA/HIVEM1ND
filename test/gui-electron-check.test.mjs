import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkEnvironment, launchElectronCheck, resultReporter, runNativeCheck, verifyInertImports } from './gui-electron-check.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'test', 'gui-app-bridge-electron.mjs');

test('the child environment replaces Windows home and application data without inheriting launch overrides', () => {
  const profile = path.join(root, '.tools', 'environment-fixture');
  const inherited = { Path: 'preserved', SystemRoot: 'preserved', localappdata: 'real', AppData: 'real', USERPROFILE: 'real', HOME: 'real', OneDriveCommercial: 'real', node_options: '--import unsafe', electron_run_as_node: '1', HIVEM1ND_MIND_PATH: 'real', relay_local_state_dir: 'real' };
  const env = checkEnvironment(profile, inherited);
  for (const name of ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'OneDrive', 'RELAY_LOCAL_STATE_DIR', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) {
    const relative = path.relative(profile, env[name]);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), name);
  }
  for (const name of ['localappdata', 'AppData', 'OneDriveCommercial', 'node_options', 'electron_run_as_node', 'HIVEM1ND_MIND_PATH', 'relay_local_state_dir']) assert.equal(Object.hasOwn(env, name), false, name);
  assert.equal(env.Path, 'preserved'); assert.equal(env.SystemRoot, 'preserved');
  assert.equal(inherited.USERPROFILE, 'real');
});

test('every early failure reports exactly one result for each app and a final failure', () => {
  const lines = [], reporter = resultReporter(line => lines.push(line));
  reporter.record('blueprint', 'PASS', 'Loaded.');
  reporter.record('blueprint', 'FAIL', 'Duplicate.');
  assert.equal(reporter.finish('Early\nfailure.', true), 1);
  reporter.finish('Duplicate.'); reporter.record('void', 'PASS', 'Late.');
  assert.deepEqual(lines, ['blueprint: PASS (Loaded.)', 'void: FAIL (Early failure.)', 'Electron check: FAIL (Early failure.)']);
});

function electronFixture() {
  const app = {
    getPath: name => `isolated/${name}`, setPath() {}, requestSingleInstanceLock() {}, whenReady() {}, quit() {}, exit() {},
  };
  return { app, BrowserWindow: { getAllWindows: () => [] } };
}

test('import verification checks each host module, rejects startup attempts, and restores Electron methods', async () => {
  const electron = electronFixture(), getPath = electron.app.getPath, imports = [];
  await verifyInertImports(electron, root, async url => imports.push(url));
  assert.equal(imports.length, 6);
  assert.ok(imports.some(url => url.endsWith('/gui/electron.mjs')));
  assert.ok(imports.some(url => url.endsWith('/gui/electron-entry.cjs')));
  for (const name of ['getPath', 'requestSingleInstanceLock', 'whenReady']) {
    await assert.rejects(verifyInertImports(electron, root, async () => electron.app[name]('home')), new RegExp(`Import attempted app.${name}`));
    assert.equal(electron.app.getPath, getPath);
  }
  await assert.rejects(verifyInertImports(electron, root, async () => electron.app.exit(1)), /must not start Electron/);
  assert.equal(electron.app.getPath, getPath);
});

test('the inner watchdog reports all results even when Electron import never resolves', { timeout: 1000 }, async () => {
  const lines = [], exits = [];
  const before = ['uncaughtException', 'unhandledRejection'].map(name => process.listenerCount(name));
  const code = await runNativeCheck({ root, timeoutMs: 20, loadElectron: () => new Promise(() => {}), write: line => lines.push(line), exit: code => exits.push(code) });
  assert.equal(code, 1); assert.deepEqual(exits, [1]);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^blueprint: FAIL .*overall timeout/);
  assert.match(lines[1], /^void: FAIL .*overall timeout/);
  assert.match(lines[2], /^Electron check: FAIL .*overall timeout/);
  assert.deepEqual(['uncaughtException', 'unhandledRejection'].map(name => process.listenerCount(name)), before);
});

function childFixture() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), killed: false, unreferenced: false,
    kill() { this.killed = true; }, unref() { this.unreferenced = true; },
  });
}

test('the parent watchdog kills a silent child and reports a bounded failure with an isolated hidden launch', { timeout: 5000 }, async () => {
  const child = childFixture(), lines = [];
  let options;
  const code = await launchElectronCheck({ root, script, timeoutMs: 20, inherited: { LOCALAPPDATA: 'real', HOME: 'real', ELECTRON_RUN_AS_NODE: '1' }, write: line => lines.push(line),
    spawnImpl(_executable, args, received) {
      options = received;
      assert.equal(args[0], script);
      assert.ok(args[1].startsWith(`--user-data-dir=${path.join(root, '.tools')}`));
      return child;
    },
  });
  assert.equal(code, 1); assert.equal(child.killed, true); assert.equal(child.unreferenced, true);
  assert.equal(options.windowsHide, true); assert.equal(options.shell, false);
  assert.equal(options.env.HOME, options.env.USERPROFILE);
  assert.notEqual(options.env.LOCALAPPDATA, 'real'); assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(lines.length, 3); assert.match(lines[2], /Parent process overall timeout/);
});

test('a child exiting before its final result cannot silently pass or omit app results', async () => {
  const child = childFixture(), lines = [];
  const code = await launchElectronCheck({ root, script, write: line => lines.push(line), spawnImpl() {
    setImmediate(() => { child.stdout.write('blueprint: PASS (Loaded.)\n'); child.emit('close', 0); });
    return child;
  } });
  assert.equal(code, 1);
  assert.deepEqual(lines, ['blueprint: PASS (Loaded.)', 'void: FAIL (Electron child failed (exit 0).)', 'Electron check: FAIL (Electron child failed (exit 0).)']);
});

test('importing host modules in an actual Electron browser process starts no app or migration', { timeout: 35_000 }, async () => {
  const child = spawn(process.execPath, [script, '--imports-only'], { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 30_000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, `${stdout}\n${stderr}`);
    assert.match(stdout, /^blueprint: SKIP \(Import-only check; no windows opened\.\)$/m);
    assert.match(stdout, /^void: SKIP \(Import-only check; no windows opened\.\)$/m);
    assert.match(stdout, /^Electron check: PASS \(Module imports started no app or migration\.\)$/m);
  } finally { clearTimeout(timer); }
});
