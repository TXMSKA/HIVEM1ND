import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runElectronEntry } from '../gui/electron-entry.mjs';
import { secureWebPreferences } from '../gui/electron-preferences.mjs';
import { secureWebPreferences as hostPreferences } from '../gui/electron.mjs';

test('Electron preferences remain one immutable object shared by the host and embedded apps', () => {
  assert.equal(hostPreferences, secureWebPreferences);
  assert.equal(Object.isFrozen(secureWebPreferences), true);
});

test('desktop startup returns before readiness and only the explicit upgrade call can run a migration', { timeout: 1000 }, async () => {
  const kitPath = path.resolve('.'), homeDir = path.resolve('.tools/test-temp/electron-home');
  const app = { isPackaged: false, getAppPath: () => kitPath, exit: () => assert.fail('Desktop startup must not exit.') };
  const argv = [process.execPath, path.join(kitPath, 'gui/electron-entry.cjs'), '--home-dir', homeDir];
  let start, migrated = 0;
  const relocation = { relocatedPaths: [] };
  await runElectronEntry({ app }, argv, {
    startElectronApp(electron, received, dependencies) {
      start = { electron, received, dependencies };
      return new Promise(() => {});
    },
    async migrate(options) {
      migrated++;
      assert.deepEqual(options, { platform: process.platform, env: process.env, homeDir, kitPath, nodePath: process.execPath });
      return relocation;
    },
  });
  assert.equal(start.electron.app, app);
  assert.deepEqual(start.received, argv.slice(2));
  assert.equal(migrated, 0);
  assert.equal(await start.dependencies.upgrade({ homeDir, kitPath }), relocation);
  assert.equal(migrated, 1);
});

test('the production entry preserves packaged and development CLI commands and exits with their result', async () => {
  const kitPath = path.resolve('.');
  const args = ['service', 'run', '--mind-path', path.resolve('.tools/test-temp/mind'), '--hostname', 'TEST'];
  for (const isPackaged of [true, false]) {
    const exits = [];
    const app = { isPackaged, getAppPath: () => kitPath, exit: code => exits.push(code) };
    const argv = [process.execPath, ...(!isPackaged ? [path.join(kitPath, 'gui/electron-entry.cjs')] : []), path.join(kitPath, 'cli/index.mjs'), ...args];
    await runElectronEntry({ app }, argv, {
      async runCli(received, dependencies) { assert.deepEqual(received, args); assert.deepEqual(dependencies, { upgrade: true }); return 7; },
      startElectronApp: () => assert.fail('A CLI request must not open the desktop.'),
      migrate: () => assert.fail('The CLI owns its upgrade.'),
    });
    assert.deepEqual(exits, [7]);
  }
});

test('desktop and CLI launch failures exit instead of being left as unhandled rejections', async context => {
  const kitPath = path.resolve('.'), exits = [];
  const app = { isPackaged: true, getAppPath: () => kitPath, exit: code => exits.push(code) };
  const logged = context.mock.method(console, 'error', () => {});
  const failure = new Error('Fixture launch failed.');
  await runElectronEntry({ app }, [process.execPath], { async startElectronApp() { throw failure; } });
  await runElectronEntry({ app }, [process.execPath, path.join(kitPath, 'cli/index.mjs'), '--help'], { async runCli() { throw failure; } });
  assert.deepEqual(exits, [1, 1]);
  assert.equal(logged.mock.calls.length, 2);
});

test('the bootstrap starts only as the packaged or explicit development Electron browser main', async () => {
  const source = await readFile(new URL('../gui/electron-entry.cjs', import.meta.url), 'utf8');
  const configuration = await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8');
  assert.match(configuration, /^  main: gui\/electron-entry\.cjs$/m);
  const script = `
    import assert from 'node:assert/strict';
    import vm from 'node:vm';
    import path from 'node:path';
    globalThis.starts = [];
    const entryUrl = 'data:text/javascript,' + encodeURIComponent('export function runElectronEntry(electron) { globalThis.starts.push(electron.app); }');
    const electronUrl = 'data:text/javascript,export const app = "fixture"';
    const filename = path.resolve('gui/electron-entry.cjs');
    for (const [direct, browser, version, development, namedFile] of [
      [false, true, true, false, false], [true, false, true, false, false],
      [true, true, false, false, false], [true, true, true, false, false],
      [false, true, true, true, false], [false, true, true, true, true],
      [false, false, true, true, true],
    ]) {
      const imports = [], failures = [], module = {};
      const require = name => { if (name === 'node:path') return path; throw new Error('The fixture must never load a real module.'); };
      require.main = direct ? module : {};
      const process = { type: browser ? 'browser' : 'renderer', versions: version ? { electron: '44.3.0' } : {}, defaultApp: development,
        argv: ['fixture.exe', namedFile ? filename : 'cli/index.mjs', 'service', 'run'] };
      new vm.Script(${JSON.stringify(source)}, { importModuleDynamically(specifier) {
        imports.push(specifier);
        return import(specifier === './electron-entry.mjs' ? entryUrl : electronUrl);
      } }).runInNewContext({ require, module, process, __filename: filename, console: { error: error => failures.push(error) } });
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(imports, browser && version && (direct || (development && namedFile)) ? ['./electron-entry.mjs', 'electron'] : []);
      assert.deepEqual(failures, []);
    }
    assert.deepEqual(globalThis.starts, ['fixture', 'fixture']);
    process.stdout.write('BOOTSTRAP_GUARD_PASS\\n');
  `;
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', script], {
    windowsHide: true, shell: false, encoding: 'utf8', timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'BOOTSTRAP_GUARD_PASS\n');
});
