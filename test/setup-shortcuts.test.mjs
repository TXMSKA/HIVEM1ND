import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { hashContent, readMachineRecord, writeMachineRecord } from '../engine/records.mjs';
import { createSetupSession } from '../engine/setup.mjs';
import { applyShortcuts, removeOwnedShortcuts, shortcutPlan, windowsShortcutFolders } from '../engine/shortcuts.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { uninstall } from '../engine/uninstall.mjs';

const KIT_PATH = path.resolve(import.meta.dirname, '..');

async function temporary(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'onem1nd-shortcuts-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const plan = folders => shortcutPlan({ platform: 'win32', mindPath: 'C:/Users/t/M1ND', nodePath: 'C:/node/node.exe', cosmicPath: '', folders,
  message: 'It could not start.', description: 'Open ONEM1ND', env: { SystemRoot: 'C:/Windows' } });

test('the plan holds a desktop and a Start menu shortcut that run the hidden launcher, with the hexagon icon', () => {
  const items = plan({ desktop: 'C:/Users/t/Desktop', startMenu: 'C:/Users/t/Start Menu/Programs' });
  assert.deepEqual(items.map(item => item.file), [path.join('C:/Users/t/Desktop', 'ONEM1ND.lnk'), path.join('C:/Users/t/Start Menu/Programs', 'Cosmic', 'ONEM1ND.lnk')]);
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

test('a shortcut setup made and left unchanged is removed, and one of the person or not in the record stays', async context => {
  const root = await temporary(context);
  const desktop = path.join(root, 'Desktop');
  const menu = path.join(root, 'Programs');
  await Promise.all([desktop, menu].map(folder => mkdir(folder)));
  const items = plan({ desktop, startMenu: menu });
  const run = async item => { await writeFile(item.file, `link to ${item.file}`); };
  const [owned, other] = await applyShortcuts(items, { run });
  const managed = { [owned.file]: owned.hash };
  assert.deepEqual(await removeOwnedShortcuts([desktop, menu, null], { managed }), [{ file: owned.file, status: 'removed' }]);
  await assert.rejects(stat(owned.file), { code: 'ENOENT' });
  assert.equal(await readFile(other.file, 'utf8'), `link to ${other.file}`, 'a shortcut that is not in the record is not touched');
  assert.deepEqual(await removeOwnedShortcuts([desktop], { managed }), [{ file: owned.file, status: 'missing' }]);
  await writeFile(owned.file, 'a shortcut the person made');
  assert.deepEqual(await removeOwnedShortcuts([desktop], { managed }), [{ file: owned.file, status: 'kept', reason: 'not-ours' }]);
  assert.equal(await readFile(owned.file, 'utf8'), 'a shortcut the person made');
});

test('without the desktop folder only the Start menu shortcut is planned, and both are planned by default', () => {
  const startMenu = 'C:/Users/t/Start Menu/Programs';
  assert.deepEqual(plan({ startMenu }).map(item => item.file), [path.join(startMenu, 'Cosmic', 'ONEM1ND.lnk')]);
  assert.equal(plan({ desktop: 'C:/Users/t/Desktop', startMenu }).length, 2);
});

async function installedMind(context, extra = {}) {
  const root = await temporary(context);
  const kitPath = path.join(root, 'kit');
  for (const folder of ['migrations', 'assets', 'cli', 'gui']) await mkdir(path.join(kitPath, folder), { recursive: true });
  await writeFile(path.join(kitPath, 'package.json'), '{"name":"onem1nd-fixture","version":"3.0.0","files":["rules.md","migrations/","assets/","cli/","gui/"]}\n');
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
  const files = [path.join(fixture.desktop, 'ONEM1ND.lnk'), path.join(fixture.startMenu, 'Cosmic', 'ONEM1ND.lnk')];
  assert.deepEqual(fixture.runs.map(item => item.file), files);
  assert.deepEqual(await readdir(fixture.startMenu), ['Cosmic']);
  assert.deepEqual(await readdir(path.join(fixture.startMenu, 'Cosmic')), ['ONEM1ND.lnk']);
  // The shortcut starts the installed kit, which always has the launcher, and passes the M1ND as an argument.
  assert.equal(fixture.runs[0].args[0], path.join(fixture.options.kitPath, 'gui', 'launch.vbs'));
  assert.equal(fixture.runs[0].args[2], path.join(fixture.options.kitPath, 'cli', 'index.mjs'));
  assert.equal(fixture.runs[0].args[3], fixture.mindPath);
  assert.equal(fixture.runs[0].args[4], 'ONEM1ND could not start. Open it again, or run onem1nd init if the problem stays.');
  const { record } = await readMachineRecord(fixture.mindPath, 'TESTBOX');
  for (const file of files) assert.ok(Object.hasOwn(record.managedFiles, file), file);
  const done = await uninstall({ mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: {}, cosmicPath: fixture.cosmicPath,
    registrationRunner: async () => ({ status: 0, stdout: '', stderr: '' }), stopService: async () => {} });
  for (const file of files) {
    assert.ok(done.removed.includes(file), file);
    await assert.rejects(stat(file), { code: 'ENOENT' });
  }
  await assert.rejects(stat(path.join(fixture.startMenu, 'Cosmic')), { code: 'ENOENT' });
  assert.ok((await stat(fixture.startMenu)).isDirectory(), 'Programs is retained when Cosmic becomes empty');
});

test('setup leaves a shortcut of the person alone and writes nothing outside a real Windows installation', async context => {
  const root = await temporary(context);
  const desktop = path.join(root, 'Desktop');
  await mkdir(desktop);
  await writeFile(path.join(desktop, 'ONEM1ND.lnk'), 'made by the person');
  const own = await installedMind(context, { shortcutFolders: { desktop, startMenu: path.join(root, 'none') } });
  assert.equal(await readFile(path.join(desktop, 'ONEM1ND.lnk'), 'utf8'), 'made by the person');
  assert.equal(own.runs.length, 0);
  assert.equal(Object.hasOwn((await readMachineRecord(own.mindPath, 'TESTBOX')).record.managedFiles, path.join(desktop, 'ONEM1ND.lnk')), false);
  for (const extra of [{ shortcuts: false }, { serviceDryRun: true }, { folderIconPlatform: 'linux' }]) {
    const quiet = await installedMind(context, extra);
    assert.equal(quiet.runs.length, 0, JSON.stringify(extra));
  }
});

const shortcutOf = folder => path.join(folder, 'ONEM1ND.lnk');
const startMenuShortcutOf = folder => path.join(folder, 'Cosmic', 'ONEM1ND.lnk');

// A later run of setup over the M1ND the first run made: this machine joins it after a first look at the folder.
async function setupAgain(fixture, extra) {
  const session = await createSetupSession({ ...fixture.options, ...extra });
  await session.answer({});
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ confirm: true });
  const result = await session.install();
  assert.equal(result.completed, true, JSON.stringify(session.checkpoint?.error));
  return readMachineRecord(fixture.mindPath, 'TESTBOX').then(({ record }) => record.managedFiles);
}

test('with the desktop shortcut off setup makes and records only the Start menu shortcut', async context => {
  const off = await installedMind(context, { desktopShortcut: false });
  assert.deepEqual(off.runs.map(item => item.file), [startMenuShortcutOf(off.startMenu)]);
  await assert.rejects(stat(shortcutOf(off.desktop)), { code: 'ENOENT' });
  const { record } = await readMachineRecord(off.mindPath, 'TESTBOX');
  assert.equal(Object.hasOwn(record.managedFiles, shortcutOf(off.desktop)), false);
  assert.equal(Object.hasOwn(record.managedFiles, startMenuShortcutOf(off.startMenu)), true);
  const on = await installedMind(context, { desktopShortcut: true });
  assert.deepEqual(on.runs.map(item => item.file), [shortcutOf(on.desktop), startMenuShortcutOf(on.startMenu)]);
});

test('unticking the desktop shortcut on a later run removes the one setup made, keeps one the person changed, and ticking brings it back', async context => {
  const first = await installedMind(context);
  const desktop = shortcutOf(first.desktop);
  const menu = startMenuShortcutOf(first.startMenu);
  assert.equal(Object.hasOwn((await readMachineRecord(first.mindPath, 'TESTBOX')).record.managedFiles, desktop), true);
  const without = await setupAgain(first, { desktopShortcut: false });
  await assert.rejects(stat(desktop), { code: 'ENOENT' });
  assert.equal(Object.hasOwn(without, desktop), false, 'a removed shortcut leaves the record');
  assert.equal(Object.hasOwn(without, menu), true);
  assert.ok((await stat(menu)).isFile(), 'the Start menu shortcut stays');
  await setupAgain(first, { desktopShortcut: true });
  assert.ok((await stat(desktop)).isFile(), 'ticking the box again makes it again');

  const changed = await installedMind(context);
  await writeFile(shortcutOf(changed.desktop), 'edited by the person');
  const kept = await setupAgain(changed, { desktopShortcut: false });
  assert.equal(await readFile(shortcutOf(changed.desktop), 'utf8'), 'edited by the person');
  assert.equal(Object.hasOwn(kept, shortcutOf(changed.desktop)), false, 'a file the person changed is never claimed');
});

test('Start menu setup creates only Cosmic inside an existing Programs root and preserves personal shortcuts', async context => {
  const root = await temporary(context), programs = path.join(root, 'Programs');
  await mkdir(programs);
  const items = plan({ startMenu: programs });
  const runs = [];
  const run = async item => { runs.push(item.file); await writeFile(item.file, 'owned link'); };
  const [created] = await applyShortcuts(items, { run });
  assert.equal(created.file, startMenuShortcutOf(programs));
  assert.equal(created.status, 'applied');
  assert.deepEqual(await readdir(programs), ['Cosmic']);
  await writeFile(created.file, 'personal replacement');
  const [kept] = await applyShortcuts(items, { run, managed: { [created.file]: created.hash } });
  assert.equal(kept.status, 'kept');
  assert.equal(await readFile(created.file, 'utf8'), 'personal replacement');
  const missing = path.join(root, 'missing', 'Programs');
  assert.equal((await applyShortcuts(plan({ startMenu: missing }), { run }))[0].reason, 'folder-missing');
  await assert.rejects(stat(missing), { code: 'ENOENT' });
  assert.equal(runs.length, 1);
});

for (const otherApp of [false, true]) {
  test(`uninstall removes only its Start menu shortcut and ${otherApp ? 'preserves the shared Cosmic folder' : 'removes empty Cosmic without removing Programs'}`, async context => {
    const root = await temporary(context), homeDir = path.join(root, 'home'), mindPath = path.join(root, 'mind');
    const programs = path.join(homeDir, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const directory = path.join(programs, 'Cosmic'), file = startMenuShortcutOf(programs);
    await mkdir(directory, { recursive: true });
    await writeFile(file, 'owned link');
    const sibling = path.join(directory, 'Other Cosmic app.lnk');
    if (otherApp) await writeFile(sibling, 'another app');
    await writeMachineRecord(mindPath, 'TESTBOX', { machine: 'TESTBOX', mind: mindPath, agents: [], paths: [], excluded: [],
      managedFiles: { [file]: hashContent(Buffer.from('owned link')) } });
    const options = { mindPath, homeDir, hostname: 'TESTBOX', cosmicPath: path.join(root, 'Cosmic'), env: {},
      registrationRunner: async () => ({ status: 0, stdout: '', stderr: '' }), stopService: async () => {} };
    await uninstall({ ...options, dryRun: true });
    assert.equal(await readFile(file, 'utf8'), 'owned link', 'a dry run leaves the shortcut and directory untouched');
    await uninstall(options);
    await assert.rejects(stat(file), { code: 'ENOENT' });
    assert.ok((await stat(programs)).isDirectory());
    assert.ok((await stat(path.dirname(programs))).isDirectory());
    if (otherApp) {
      assert.deepEqual(await readdir(directory), ['Other Cosmic app.lnk']);
      assert.equal(await readFile(sibling, 'utf8'), 'another app');
    } else await assert.rejects(stat(directory), { code: 'ENOENT' });
  });
}

test('uninstall never cleans a shared Cosmic folder through a linked Programs root', async context => {
  const root = await temporary(context), homeDir = path.join(root, 'home'), mindPath = path.join(root, 'mind');
  const programs = path.join(homeDir, 'Programs'), target = path.join(root, 'shared-programs');
  await mkdir(path.join(target, 'Cosmic'), { recursive: true });
  await mkdir(homeDir);
  try { await symlink(target, programs, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { context.skip('The host does not permit a directory link.'); return; }
    throw error;
  }
  const file = startMenuShortcutOf(programs);
  await writeMachineRecord(mindPath, 'TESTBOX', { machine: 'TESTBOX', mind: mindPath, agents: [], paths: [], excluded: [],
    managedFiles: { [file]: hashContent(Buffer.from('already removed link')) } });
  const result = await uninstall({ mindPath, homeDir, hostname: 'TESTBOX', cosmicPath: path.join(root, 'Cosmic'), env: {},
    registrationRunner: async () => ({ status: 0, stdout: '', stderr: '' }), stopService: async () => {} });
  assert.ok(result.kept.some(item => item.path === file && item.reason.includes('symbolic link')));
  assert.ok((await stat(path.join(target, 'Cosmic'))).isDirectory());
  assert.deepEqual(await readdir(target), ['Cosmic']);
});
