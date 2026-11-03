import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APPS = ['blueprint', 'void'];
const IMPORTS = ['gui/electron-preferences.mjs', 'gui/electron.mjs', 'gui/index.mjs', 'gui/app-bridge.mjs', 'gui/electron-entry.mjs', 'gui/electron-entry.cjs'];

export function checkEnvironment(profile, inherited = process.env) {
  // Windows environment names are case insensitive. Remove inherited variants before setting our own.
  const environment = Object.fromEntries(Object.entries(inherited).filter(([name]) => !/^(?:LOCALAPPDATA|APPDATA|USERPROFILE|HOME|HOMEDRIVE|HOMEPATH|TEMP|TMP|OneDrive(?:Consumer|Commercial)?|XDG_(?:DATA|CONFIG|CACHE)_HOME|NODE_OPTIONS|ELECTRON_RUN_AS_NODE|(?:ONEM1ND|HIVEM1ND|RELAY)_.*)$/i.test(name)));
  const home = path.join(profile, 'home');
  return {
    ...environment,
    LOCALAPPDATA: path.join(profile, 'localappdata'), APPDATA: path.join(profile, 'appdata'),
    USERPROFILE: home, HOME: home,
    HOMEDRIVE: path.parse(home).root.replace(/[\\/]$/, ''), HOMEPATH: home.slice(path.parse(home).root.length - 1),
    TEMP: path.join(profile, 'tmp'), TMP: path.join(profile, 'tmp'),
    XDG_DATA_HOME: path.join(profile, 'data'), XDG_CONFIG_HOME: path.join(profile, 'config'), XDG_CACHE_HOME: path.join(profile, 'cache'),
    OneDrive: path.join(profile, 'onedrive'), RELAY_LOCAL_STATE_DIR: path.join(profile, 'relay'),
    ONEM1ND_SMOKE_PROFILE: profile,
  };
}

const singleLine = value => String(value).replace(/[\r\n]+/g, ' ').slice(0, 300);

export function resultReporter(write = line => process.stdout.write(`${line}\n`)) {
  const results = new Map();
  let finished = false;
  return {
    record(app, status, detail) {
      if (finished || !APPS.includes(app) || results.has(app) || !['PASS', 'FAIL', 'SKIP'].includes(status)) return;
      results.set(app, status);
      write(`${app}: ${status} (${singleLine(detail)})`);
    },
    finish(detail, failed = false) {
      if (finished) return;
      for (const app of APPS) if (!results.has(app)) this.record(app, 'FAIL', detail);
      finished = true;
      const code = failed || [...results.values()].includes('FAIL') ? 1 : 0;
      write(`Electron check: ${code ? 'FAIL' : 'PASS'} (${singleLine(detail)})`);
      return code;
    },
  };
}

function deadline(work, milliseconds, message) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

export async function verifyInertImports(electron, root, importModule = url => import(url)) {
  const { app, BrowserWindow } = electron;
  const names = ['home', 'appData', 'userData', 'sessionData'];
  const paths = names.map(name => app.getPath(name));
  assert.equal(BrowserWindow.getAllWindows().length, 0, 'Imports must precede every window.');
  const attempted = [], descriptors = new Map();
  try {
    // A bad import must fail before it can acquire the real app lock or reach a migration.
    for (const name of ['getPath', 'setPath', 'requestSingleInstanceLock', 'whenReady', 'quit', 'exit']) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(app, name));
      Object.defineProperty(app, name, { configurable: true, writable: true, value() {
        attempted.push(name);
        if (!['quit', 'exit'].includes(name)) throw new Error(`Import attempted app.${name}.`);
      } });
    }
    for (const name of IMPORTS) await importModule(pathToFileURL(path.join(root, name)).href);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(attempted, [], 'Importing host modules must not start Electron or a migration.');
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(app, name, descriptor);
      else delete app[name];
    }
  }
  assert.equal(BrowserWindow.getAllWindows().length, 0, 'Importing modules opened a window.');
  assert.deepEqual(names.map(name => app.getPath(name)), paths, 'Importing modules changed Electron paths.');
}

function loaded(contents, milliseconds = 25_000) {
  let timer;
  const promise = new Promise((resolve, reject) => {
    function finish(error) {
      clearTimeout(timer);
      contents.removeListener('did-finish-load', ready);
      contents.removeListener('did-fail-load', failed);
      if (error) reject(error); else resolve();
    }
    const ready = () => finish();
    const failed = (_event, code, _description, _url, mainFrame) => {
      if (mainFrame !== false && code !== -3) finish(new Error(`App load failed (${code}).`));
    };
    timer = setTimeout(() => finish(new Error('App load timed out.')), milliseconds);
    contents.once('did-finish-load', ready);
    contents.on('did-fail-load', failed);
  });
  // The overall app deadline can win while this operation is still pending.
  void promise.catch(() => {});
  return promise;
}

export async function runNativeCheck({ root, importsOnly = false, timeoutMs = 110_000, appTimeoutMs = 45_000, loadElectron = () => import('electron'), write, exit } = {}) {
  const reporter = resultReporter(write);
  let nativeExit = exit ?? (code => process.exit(code)), host, window, finished = false, resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const unexpected = error => finish(error?.message ?? 'Unexpected Electron failure.', true);
  const finish = (detail, failed = false, cleanup = true) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    process.removeListener('uncaughtException', unexpected);
    process.removeListener('unhandledRejection', unexpected);
    if (cleanup) {
      try { host?.dispose(); window?.destroy(); } catch { failed = true; }
    }
    const code = reporter.finish(detail, failed);
    resolveDone(code);
    nativeExit(code);
  };
  // Installed before Electron import/readiness, independently of the parent watchdog.
  const timer = setTimeout(() => finish('Electron process overall timeout.', true, false), timeoutMs);
  process.once('uncaughtException', unexpected);
  process.once('unhandledRejection', unexpected);
  void (async () => {
    try {
      const electron = await loadElectron();
      if (finished) return;
      if (!exit) nativeExit = electron.app.exit.bind(electron.app);
      const profile = process.env.ONEM1ND_SMOKE_PROFILE;
      if (!profile || !path.isAbsolute(profile)) throw new Error('An isolated Electron profile is required.');
      const isolated = checkEnvironment(profile);
      for (const name of ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOME']) assert.equal(process.env[name], isolated[name], `${name} must be isolated.`);
      // Windows known folders can ignore environment overrides; redirect native paths too, before GUI imports.
      const appPaths = { home: isolated.HOME, appData: isolated.APPDATA, userData: path.join(profile, 'user-data'), sessionData: path.join(profile, 'sessions'), temp: isolated.TEMP, logs: path.join(profile, 'logs'), crashDumps: path.join(profile, 'crashes') };
      await Promise.all(Object.values(appPaths).map(directory => mkdir(directory, { recursive: true })));
      if (finished) return;
      for (const [name, directory] of Object.entries(appPaths)) electron.app.setPath(name, directory);
      await deadline(() => electron.app.whenReady(), 15_000, 'Electron readiness timed out.');
      if (finished) return;
      await deadline(() => verifyInertImports(electron, root), 15_000, 'Module import check timed out.');
      if (finished) return;
      if (importsOnly) {
        for (const app of APPS) reporter.record(app, 'SKIP', 'Import-only check; no windows opened.');
        finish('Module imports started no app or migration.');
        return;
      }
      const { secureWebPreferences } = await import('../gui/electron-preferences.mjs');
      const { APP_TARGETS, createEmbeddedApps } = await import('../gui/app-bridge.mjs');
      window = new electron.BrowserWindow({ x: -2560, y: 0, width: 1463, height: 914, show: false, focusable: false, webPreferences: secureWebPreferences });
      await deadline(() => window.loadURL('data:text/html,<title>ONEM1ND embedded apps verification</title>'), 10_000, 'Verification window load timed out.');
      if (finished) return;
      const views = [];
      const CapturedView = new Proxy(electron.WebContentsView, { construct(Type, args) { const view = new Type(...args); views.push(view); return view; } });
      host = createEmbeddedApps({ window, WebContentsView: CapturedView, session: electron.session, secureWebPreferences,
        // The check must never open external windows, native dialogs, or the person's service.
        shell: { async openExternal() {} },
        dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; }, async showSaveDialog() { return { canceled: true }; } },
        preload: path.join(root, 'gui', 'app-preload.cjs'), hostVersion: '3.0.0', serviceOrigin: () => 'http://127.0.0.1:9',
        fetchImpl: async () => new Response(JSON.stringify({ data: { person: { name: 'Verification' } } })),
      });
      electron.ipcMain.handle('cosmic:bridge-call', (event, method, params) => host.call(event, method, params));
      for (const app of APPS) {
        const cancellation = new AbortController();
        let contents;
        try {
          await deadline(async () => {
            host.update({ app, bounds: { x: 0, y: 60, width: 1463, height: 854 }, locale: 'en', tokens: {}, token: 'verification-only' });
            contents = views.at(-1).webContents;
            await loaded(contents);
            cancellation.signal.throwIfAborted();
            assert.equal(new URL(contents.getURL()).origin, APP_TARGETS[app].origin);
            const hello = await contents.executeJavaScript(`window.cosmicBridge.call('hello', {app: ${JSON.stringify(app)}, appVersion: 'verification', protocol: 1})`);
            cancellation.signal.throwIfAborted();
            assert.equal(hello.protocol, 1); assert.equal(hello.host, 'ONEM1ND'); assert.equal(hello.person.name, 'Verification');
            assert.equal(await deadline(() => contents.executeJavaScript('navigator.serviceWorker?.ready.then(() => true)'), 5_000, 'Offline cache readiness timed out.'), true);
            cancellation.signal.throwIfAborted();
            const partition = electron.session.fromPartition(`persist:app-${app}`);
            partition.enableNetworkEmulation({ offline: true });
            try {
              const reloaded = loaded(contents, 15_000);
              contents.reload();
              await reloaded;
              cancellation.signal.throwIfAborted();
              assert.equal(new URL(contents.getURL()).origin, APP_TARGETS[app].origin);
            } finally { partition.disableNetworkEmulation(); }
          }, appTimeoutMs, `${app} verification timed out.`);
          reporter.record(app, 'PASS', 'Online load, bridge handshake and offline reload passed.');
        } catch (error) {
          cancellation.abort();
          contents?.stop();
          reporter.record(app, 'FAIL', error.message);
        }
        if (finished) return;
      }
      finish('Native app checks completed.');
    } catch (error) { finish(error.message, true); }
  })();
  return done;
}

export async function launchElectronCheck({ root, script, importsOnly = false, timeoutMs = 120_000, write, spawnImpl = spawn, inherited = process.env } = {}) {
  const reporter = resultReporter(write);
  let profile, child, timer, childFinal = null, problem = null;
  try {
    const directory = path.join(root, '.tools');
    await mkdir(directory, { recursive: true });
    assert.equal(path.relative(await realpath(root), await realpath(directory)), '.tools', 'The profile must stay inside this checkout.');
    profile = await mkdtemp(path.join(directory, 'electron-check-'));
    const env = checkEnvironment(profile, inherited);
    await Promise.all(['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'TEMP', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'OneDrive', 'RELAY_LOCAL_STATE_DIR'].map(name => mkdir(env[name], { recursive: true })));
    const executable = path.join(root, 'node_modules', 'electron', 'dist', (await readFile(path.join(root, 'node_modules', 'electron', 'path.txt'), 'utf8')).trim());
    child = spawnImpl(executable, [script, `--user-data-dir=${path.join(profile, 'user-data')}`, '--disable-gpu', '--in-process-gpu', ...(importsOnly ? ['--imports-only'] : [])], {
      cwd: root, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      pending += chunk;
      const lines = pending.split(/\r?\n/); pending = lines.pop().slice(-4096);
      for (const line of lines) {
        const result = /^(blueprint|void): (PASS|FAIL|SKIP) \((.*)\)$/.exec(line);
        if (result) reporter.record(result[1], result[2], result[3]);
        if (/^Electron check: (PASS|FAIL) /.test(line)) childFinal = line.startsWith('Electron check: PASS ');
      }
    });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    const outcome = await new Promise(resolve => {
      child.once('error', error => resolve({ error }));
      child.once('close', code => resolve({ code }));
      timer = setTimeout(() => {
        try { child.kill(); } catch { /* Report a bounded failure even if Windows refuses termination. */ }
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        resolve({ error: new Error('Parent process overall timeout.') });
      }, timeoutMs);
    });
    clearTimeout(timer);
    if (outcome.error || outcome.code !== 0 || childFinal !== true) problem = outcome.error?.message ?? `Electron child failed (exit ${outcome.code ?? 'unknown'}).`;
  } catch (error) { problem = error.message; }
  finally {
    clearTimeout(timer);
    if (profile) {
      const relative = path.relative(path.join(root, '.tools'), profile);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        await deadline(() => rm(profile, { recursive: true, force: true, maxRetries: 2 }), 2_000, 'Profile cleanup timed out.').catch(() => {});
      }
    }
  }
  return reporter.finish(problem ?? (importsOnly ? 'Module imports started no app or migration.' : 'Native app checks completed.'), Boolean(problem));
}
