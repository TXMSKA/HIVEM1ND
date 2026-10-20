import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { readMachineRecord } from '../engine/records.mjs';
import { createSetupSession } from '../engine/setup.mjs';
import { applyShortcuts, shortcutPlan, windowsShortcutFolders } from '../engine/shortcuts.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { uninstall } from '../engine/uninstall.mjs';

const KIT_PATH = path.resolve(import.meta.dirname, '..');

async function temporary(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-shortcuts-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const plan = folders => shortcutPlan({ platform: 'win32', mindPath: 'C:/Users/t/M1ND', nodePath: 'C:/node/node.exe', cosmicPath: '', folders,
  message: 'It could not start.', description: 'Open HIVEM1ND', env: { SystemRoot: 'C:/Windows' } });

test('the plan holds a desktop and a Start menu shortcut that run the hidden launcher, with the hexagon icon', () => {
  const items = plan({ desktop: 'C:/Users/t/Desktop', startMenu: 'C:/Users/t/Start Menu/Programs' });
  assert.deepEqual(items.map(item => item.file), [path.join('C:/Users/t/Desktop', 'HIVEM1ND.lnk'), path.join('C:/Users/t/Start Menu/Programs', 'HIVEM1ND.lnk')]);
  const [item] = items;
  assert.match(item.target, /wscript\.exe$/i, 'the Script Host has no console window');
  assert.equal(item.args[0], path.join('C:/Users/t/M1ND', 'gui', 'launch.vbs'));
  assert.deepEqual(item.args.slice(1), ['C:/node/node.exe', path.join('C:/Users/t/M1ND', 'cli', 'index.mjs'), 'C:/Users/t/M1ND', 'It could not start.', '']);
  assert.equal(item.icon, `${path.join('C:/Users/t/M1ND', 'assets', 'installer.ico')},0`);
  assert.doesNotMatch(JSON.stringify(item), /session|token|viewerUrl/i, 'no address or token is part of a shortcut');
  assert.deepEqual(plan({ desktop: null, startMenu: 'C:/menu' }).length, 1);
  assert.deepEqual(shortcutPlan({ platform: 'linux', mindPath: '/m', folders: { desktop: '/d' } }), []);
});

test('a redirected desktop comes from the shell folder setting and falls back to the home folder', async () => {
  const env = { APPDATA: 'C:\\Users\\t\\AppData\\Roaming', OneDrive: 'C:\\Users\\t\\OneDrive' };
  const redirected = await windowsShortcutFolders({ env, home: 'C:\\Users\\t', query: async () => '%OneDrive%\\Desktop' });
  assert.equal(redirected.desktop, 'C:\\Users\\t\\OneDrive\\Desktop');
  assert.equal(redirected.startMenu, path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  assert.equal((await windowsShortcutFolders({ env, home: 'C:\\Users\\t', query: async () => { throw new Error('none'); } })).desktop, path.join('C:\\Users\\t', 'Desktop'));
  assert.equal((await windowsShortcutFolders({ env: {}, home: 'C:\\Users\\t', query: async () => '%Missing%\\Desktop' })).desktop, path.join('C:\\Users\\t', 'Desktop'));
});

test('a shortcut is written once, refreshed while it is the one setup made, and never replaces a file of the person', async context => {
  const root = await temporary(context);
  const desktop = path.join(root, 'Desktop');
  await mkdir(desktop);
  const items = plan({ desktop, startMenu: path.join(root, 'missing') });
  const runs = [];
  const run = async item => { runs.push(item.file); await writeFile(item.file, `link ${runs.length}`); };
  const [first] = await applyShortcuts(items, { run });
  assert.deepEqual({ status: first.status, created: first.created }, { status: 'applied', created: true });
  const [again] = await applyShortcuts(items, { run, managed: { [first.file]: first.hash } });
  assert.deepEqual({ status: again.status, created: again.created }, { status: 'applied', created: false });
  await writeFile(first.file, 'a shortcut the person made');
  const [kept] = await applyShortcuts(items, { run, managed: { [first.file]: first.hash } });
  assert.deepEqual({ status: kept.status, reason: kept.reason }, { status: 'kept', reason: 'not-ours' });
  assert.equal(await readFile(first.file, 'utf8'), 'a shortcut the person made');
  const [unknown] = await applyShortcuts(items, { run });
  assert.equal(unknown.status, 'kept', 'without a record the file is not ours');
  const folderMissing = await applyShortcuts(plan({ desktop: path.join(root, 'nope'), startMenu: null }), { run });
  assert.equal(folderMissing[0].status, 'skipped');
  assert.equal(runs.length, 2);
});

async function installedMind(context, extra = {}) {
  const root = await temporary(context);
  const kitPath = path.join(root, 'kit');
  for (const folder of ['migrations', 'assets', 'cli', 'gui']) await mkdir(path.join(kitPath, folder), { recursive: true });
  await writeFile(path.join(kitPath, 'package.json'), '{"name":"hivem1nd-fixture","version":"3.0.0","files":["rules.md","migrations/","assets/","cli/","gui/"]}\n');
  await writeFile(path.join(kitPath, 'rules.md'), 'Current rules.\n');
  await writeFile(path.join(kitPath, 'assets', 'installer.ico'), 'icon');
  await writeFile(path.join(kitPath, 'cli', 'index.mjs'), '// cli\n');
  await writeFile(path.join(kitPath, 'gui', 'launch.vbs'), "' launcher\n");
  for (const name of ['2.0.0-experimental.4', '3.0.0']) {
    await writeFile(path.join(kitPath, 'migrations', `${name}.mjs`),
      `export {version, idempotent, migrate} from ${JSON.stringify(pathToFileURL(path.join(KIT_PATH, 'migrations', `${name}.mjs`)).href)};\n`);
  }
  const homeDir = path.join(root, 'home');
  const desktop = path.join(root, 'Desktop');
  const startMenu = path.join(root, 'Programs');
  await Promise.all([homeDir, desktop, startMenu].map(folder => mkdir(folder, { recursive: true })));
  const fixture = { root, kitPath, homeDir, desktop, startMenu, mindPath: path.join(root, 'mind'), cosmicPath: path.join(root, 'Cosmic') };
  const runs = [];
  const options = { kitPath, mindPath: fixture.mindPath, homeDir, cosmicPath: fixture.cosmicPath, hostname: 'TESTBOX', env: {}, language: 'en', resume: false,
    aclRunner: stubAclRunner(), serviceSetup: true, serviceDryRun: false, serviceProtect: false, serviceRunner: async () => {}, serviceQuery: async () => ({ present: false }),
    serviceStart: async () => ({ viewerUrl: 'http://127.0.0.1:9/gui/viewer' }), folderIconPlatform: 'win32', attribRunner: async () => {},
    shortcuts: true, shortcutFolders: { desktop, startMenu }, nodePath: 'C:/node/node.exe',
    shortcutRunner: async item => { runs.push(item); await writeFile(item.file, `link to ${item.args.join(' ')}`); }, ...extra };
  const session = await createSetupSession(options);
  await session.answer({});
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ confirm: true });
  const result = await session.install();
  assert.equal(result.completed, true, JSON.stringify(session.checkpoint?.error));
  return { ...fixture, runs, options };
}

test('setup makes the desktop and Start menu shortcuts of a new M1ND, records them, and uninstall removes them', async context => {
  const fixture = await installedMind(context);
  const files = [path.join(fixture.desktop, 'HIVEM1ND.lnk'), path.join(fixture.startMenu, 'HIVEM1ND.lnk')];
  assert.deepEqual(fixture.runs.map(item => item.file), files);
  assert.equal(fixture.runs[0].args[0], path.join(fixture.mindPath, 'gui', 'launch.vbs'));
  assert.equal(fixture.runs[0].args[3], fixture.mindPath);
  assert.equal(fixture.runs[0].args[4], 'HIVEM1ND could not start. Open it again, or run hivem1nd init if the problem stays.');
  const { record } = await readMachineRecord(fixture.mindPath, 'TESTBOX');
  for (const file of files) assert.ok(Object.hasOwn(record.managedFiles, file), file);
  const done = await uninstall({ mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: {}, cosmicPath: fixture.cosmicPath,
    registrationRunner: async () => ({ status: 0, stdout: '', stderr: '' }), stopService: async () => {} });
  for (const file of files) {
    assert.ok(done.removed.includes(file), file);
    await assert.rejects(stat(file), { code: 'ENOENT' });
  }
});

test('setup leaves a shortcut of the person alone and writes nothing outside a real Windows installation', async context => {
  const root = await temporary(context);
  const desktop = path.join(root, 'Desktop');
  await mkdir(desktop);
  await writeFile(path.join(desktop, 'HIVEM1ND.lnk'), 'made by the person');
  const own = await installedMind(context, { shortcutFolders: { desktop, startMenu: path.join(root, 'none') } });
  assert.equal(await readFile(path.join(desktop, 'HIVEM1ND.lnk'), 'utf8'), 'made by the person');
  assert.equal(own.runs.length, 0);
  assert.equal(Object.hasOwn((await readMachineRecord(own.mindPath, 'TESTBOX')).record.managedFiles, path.join(desktop, 'HIVEM1ND.lnk')), false);
  for (const extra of [{ shortcuts: false }, { serviceDryRun: true }, { folderIconPlatform: 'linux' }]) {
    const quiet = await installedMind(context, extra);
    assert.equal(quiet.runs.length, 0, JSON.stringify(extra));
  }
});
