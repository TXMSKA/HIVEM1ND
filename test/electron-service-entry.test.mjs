import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { electronCliArgs, parseElectronOptions, startElectronApp } from '../gui/electron.mjs';

test('a packaged Electron login task dispatches the exact local service command without changing its flags', () => {
  const kitPath = 'C:\\Apps\\ONEM1ND\\resources\\app';
  const argv = ['C:\\Apps\\ONEM1ND\\ONEM1ND.exe', path.win32.join(kitPath, 'cli', 'index.mjs'),
    'service', 'run', '--mind-path', 'C:\\Cosmic\\onem1nd', '--hostname', 'DESKTOP'];
  const original = [...argv];
  assert.deepEqual(electronCliArgs(argv, { isPackaged: true, kitPath, platform: 'win32' }), argv.slice(2));
  assert.deepEqual(argv, original);
});

test('a development Electron entry dispatches its local service command after the main script', () => {
  const kitPath = '/work/onem1nd';
  const argv = ['/usr/bin/electron', `${kitPath}/gui/electron.mjs`, `${kitPath}/cli/index.mjs`,
    'service', 'run', '--mind-path', '/data/onem1nd'];
  assert.deepEqual(electronCliArgs(argv, { kitPath, platform: 'linux' }), argv.slice(3));
});

test('local MCP, hook, wake and other CLI requests keep their arguments and leave command validation to the CLI', () => {
  const kitPath = '/apps/onem1nd';
  for (const args of [
    ['relay', 'mcp', '--mind-path', '/data/onem1nd'],
    ['relay', 'hook', '--client', 'claude'],
    ['relay', 'wake', 'watch', '--unit', 'executor-shop', '--native-session-id', 'session-1'],
    ['service', 'status'],
    ['init', '--gui'],
    ['--version'],
    ['unknown-command'],
    [],
  ]) {
    assert.deepEqual(electronCliArgs(['/apps/ONEM1ND', `${kitPath}/cli/index.mjs`, ...args],
      { isPackaged: true, kitPath, platform: 'linux' }), args);
  }
});

test('foreign CLI paths keep the GUI entry and its folder options', () => {
  const kitPath = 'C:\\Apps\\ONEM1ND\\resources\\app';
  for (const command of [
    ['C:\\Other\\cli\\index.mjs', 'service', 'run'],
    ['cli\\index.mjs', 'service', 'run'],
    [path.win32.join(kitPath, 'other', 'index.mjs'), 'service', 'run'],
    [],
  ]) {
    const argv = ['C:\\Apps\\ONEM1ND\\ONEM1ND.exe', ...command, '--mind-path', path.resolve('.work', 'gui-mind')];
    assert.equal(electronCliArgs(argv, { isPackaged: true, kitPath, platform: 'win32' }), null);
    assert.equal(parseElectronOptions(argv.slice(1), path.resolve('.work')).mindPath, path.resolve('.work', 'gui-mind'));
  }
});

test('CLI path identity follows the host platform case rules', () => {
  assert.deepEqual(electronCliArgs(['app.exe', 'c:\\apps\\onem1nd\\cli\\index.mjs', 'service', 'run'],
    { isPackaged: true, kitPath: 'C:\\Apps\\ONEM1ND', platform: 'win32' }), ['service', 'run']);
  assert.equal(electronCliArgs(['/bin/app', '/Apps/ONEM1ND/cli/index.mjs', 'service', 'run'],
    { isPackaged: true, kitPath: '/apps/onem1nd', platform: 'linux' }), null);
});

function importCliAsElectron(runAsNode) {
  const cliPath = fileURLToPath(new URL('../cli/index.mjs', import.meta.url));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'));
  if (runAsNode) env.ELECTRON_RUN_AS_NODE = '1';
  const script = `Object.defineProperty(process.versions, 'electron', { value: '44.3.0' });
process.defaultApp = false;
process.type = ${JSON.stringify(runAsNode ? undefined : 'browser')};
process.argv = [process.execPath, ${JSON.stringify(cliPath)}, '--help'];
await import(${JSON.stringify(pathToFileURL(cliPath).href)});
process.stdout.write('CLI_IMPORT_COMPLETE\\n');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, windowsHide: true, shell: false, encoding: 'utf8', timeout: 30000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('Electron run-as-Node still starts the CLI when its executable reports an Electron version', () => {
  const output = importCliAsElectron(true);
  assert.match(output, /^ONEM1ND /m);
  assert.match(output, /CLI_IMPORT_COMPLETE/);
});

test('importing the CLI from a packaged browser process does not run the same command twice', () => {
  assert.equal(importCliAsElectron(false), 'CLI_IMPORT_COMPLETE\n');
});

test('a secondary desktop instance leaves migration and the active service untouched', async () => {
  let upgraded = false, quit = false;
  await startElectronApp({ app: {
    getPath: () => path.resolve('.work'), getAppPath: () => path.resolve('.'), setPath() {},
    requestSingleInstanceLock: () => false, quit() { quit = true; },
  } }, ['--user-data-dir', path.resolve('.work', 'electron-profile')], {
    async upgrade() { upgraded = true; throw new Error('Migration must not run.'); },
  });
  assert.equal(quit, true);
  assert.equal(upgraded, false);
});

test('the owning desktop selects its profile and lock before upgrade, then follows relocated mind and kit paths', async () => {
  const events = [], stop = new Error('Stop before a window is created.');
  const source = path.resolve('.work', 'old-mind'), destination = path.resolve('.work', 'new-mind');
  let upgradedOptions;
  const app = {
    getPath: () => path.resolve('.work'), getAppPath: () => path.join(source, 'kit'),
    setPath(name) { events.push(name); }, requestSingleInstanceLock() { events.push('lock'); return true; },
    async whenReady() { throw stop; },
  };
  await assert.rejects(startElectronApp({ app, ipcMain: { handle() {} } },
    ['--user-data-dir', path.resolve('.work', 'electron-profile'), '--mind-path', source], {
      async upgrade(options) {
        events.push('upgrade'); upgradedOptions = options;
        return { relocatedPaths: [{ source, destination }] };
      },
    }), error => error === stop);
  assert.deepEqual(events, ['userData', 'lock', 'upgrade']);
  assert.equal(upgradedOptions.mindPath, destination);
  assert.equal(upgradedOptions.kitPath, path.join(destination, 'kit'));
});
