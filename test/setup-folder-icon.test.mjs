import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { applyFolderIcon, FOLDER_ICON, mergeDesktopIni } from '../engine/folder-icon.mjs';
import { readMachineRecord } from '../engine/records.mjs';
import { createSetupSession } from '../engine/setup.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { uninstall } from '../engine/uninstall.mjs';

const KIT_PATH = path.resolve(import.meta.dirname, '..');
const ICON = 'assets\\installer.ico';
const VIEW = '[ViewState]\r\nMode=\r\nVid=\r\nFolderType=StorageProviderGeneric\r\n';

test('the icon is added to a new desktop.ini and replaces only the icon lines of an existing one', () => {
  assert.equal(mergeDesktopIni(null), `[.ShellClassInfo]\r\nIconResource=${ICON},0\r\n`);
  const existing = `[.ShellClassInfo]\r\nIconResource=C:\\old.ico,0\r\nIconFile=old.ico\r\nIconIndex=3\r\nInfoTip=Kept\r\n${VIEW}`;
  assert.equal(mergeDesktopIni(existing), `[.ShellClassInfo]\r\nIconResource=${ICON},0\r\nInfoTip=Kept\r\n${VIEW}`);
  assert.equal(mergeDesktopIni(VIEW), `[.ShellClassInfo]\r\nIconResource=${ICON},0\r\n${VIEW}`);
  assert.equal(mergeDesktopIni(mergeDesktopIni(existing)), mergeDesktopIni(existing), 'merging twice changes nothing');
  assert.equal(mergeDesktopIni('[.ShellClassInfo]\nInfoTip=x\n'), `[.ShellClassInfo]\nIconResource=${ICON},0\nInfoTip=x\n`, 'line endings stay as they were');
});

test('the folder icon clears the attributes before writing and sets Hidden, System and ReadOnly after', async context => {
  const mind = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-icon-'));
  context.after(() => rm(mind, { recursive: true, force: true }));
  const calls = [];
  const attrib = async args => { calls.push(args); };
  assert.deepEqual(await applyFolderIcon(mind, { platform: 'linux', attrib }), { status: 'skipped', reason: 'platform' });
  assert.equal((await applyFolderIcon(mind, { platform: 'win32', attrib })).reason, 'icon-missing');
  await mkdir(path.join(mind, 'assets'));
  await writeFile(path.join(mind, 'assets', 'installer.ico'), 'icon');
  const created = await applyFolderIcon(mind, { platform: 'win32', attrib });
  assert.equal(created.status, 'applied');
  assert.equal(created.created, true);
  const file = path.join(mind, 'desktop.ini');
  assert.deepEqual(calls, [['+h', '+s', file], ['+r', mind]]);
  assert.equal(await readFile(file, 'utf8'), `[.ShellClassInfo]\r\nIconResource=${FOLDER_ICON},0\r\n`);
  calls.length = 0;
  const again = await applyFolderIcon(mind, { platform: 'win32', attrib });
  assert.equal(again.created, false);
  assert.equal(again.hash, created.hash);
  assert.deepEqual(calls, [['+h', '+s', file], ['+r', mind]], 'an unchanged file is not rewritten');
  calls.length = 0;
  await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`[ViewState]\r\nMode=\r\n`, 'utf16le')]));
  await applyFolderIcon(mind, { platform: 'win32', attrib });
  assert.deepEqual(calls[0], ['-h', '-s', '-r', file], 'a changed file is made writable first');
  const bytes = await readFile(file);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe], 'a UTF-16 desktop.ini stays UTF-16');
  assert.equal(bytes.subarray(2).toString('utf16le'), `[.ShellClassInfo]\r\nIconResource=${ICON},0\r\n[ViewState]\r\nMode=\r\n`);
});

async function kitFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-icon-setup-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const kitPath = path.join(root, 'kit');
  await mkdir(path.join(kitPath, 'migrations'), { recursive: true });
  await mkdir(path.join(kitPath, 'assets'));
  await writeFile(path.join(kitPath, 'package.json'), '{"name":"hivem1nd-fixture","version":"3.0.0","files":["rules.md","files.md","migrations/","assets/"]}\n');
  await writeFile(path.join(kitPath, 'rules.md'), 'Current rules.\n');
  await writeFile(path.join(kitPath, 'files.md'), 'Current formats.\n');
  await writeFile(path.join(kitPath, 'assets', 'installer.ico'), 'icon');
  for (const name of ['2.0.0-experimental.4', '3.0.0']) {
    await writeFile(path.join(kitPath, 'migrations', `${name}.mjs`),
      `export {version, idempotent, migrate} from ${JSON.stringify(pathToFileURL(path.join(KIT_PATH, 'migrations', `${name}.mjs`)).href)};\n`);
  }
  const homeDir = path.join(root, 'home');
  await mkdir(homeDir, { recursive: true });
  return { root, kitPath, homeDir, mindPath: path.join(root, 'mind'), cosmicPath: path.join(root, 'Cosmic') };
}

async function installed(fixture, overrides = {}) {
  const session = await createSetupSession({ kitPath: fixture.kitPath, mindPath: fixture.mindPath, homeDir: fixture.homeDir,
    cosmicPath: fixture.cosmicPath, hostname: 'TESTBOX', env: { PATH: '' }, language: 'en', resume: false, aclRunner: stubAclRunner(), ...overrides });
  await session.answer({});
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ confirm: true });
  const result = await session.install();
  assert.equal(result.completed, true, JSON.stringify(session.checkpoint?.error));
  return session;
}

test('setup writes the icon file of a new M1ND, records it, and a second setup keeps it', async context => {
  const fixture = await kitFixture(context);
  const calls = [];
  const options = { folderIconPlatform: 'win32', attribRunner: async args => { calls.push(args); } };
  await installed(fixture, options);
  const file = path.join(fixture.mindPath, 'desktop.ini');
  assert.equal(await readFile(file, 'utf8'), `[.ShellClassInfo]\r\nIconResource=${ICON},0\r\n`);
  assert.ok(calls.some(args => args[0] === '+r' && args[1] === fixture.mindPath));
  const { record } = await readMachineRecord(fixture.mindPath, 'TESTBOX');
  assert.ok(Object.hasOwn(record.managedFiles, file), 'setup created the file, so uninstall may remove it while its bytes are unchanged');
  await installed(fixture, options);
  assert.equal(await readFile(file, 'utf8'), `[.ShellClassInfo]\r\nIconResource=${ICON},0\r\n`, 'a repeated setup does not remove it as retired kit content');
});

test('an existing desktop.ini keeps its view settings, is not claimed, and survives a migration copy', async context => {
  const fixture = await kitFixture(context);
  const legacy = path.join(fixture.root, 'legacy');
  await mkdir(path.join(legacy, 'user', 'state'), { recursive: true });
  await mkdir(path.join(legacy, 'user', 'machines'), { recursive: true });
  await writeFile(path.join(legacy, 'files.md'), 'Older formats.\n');
  await writeFile(path.join(legacy, 'user', 'VERSION'), '2.0.0\n');
  await writeFile(path.join(legacy, 'user', 'state', 'user.md'), 'unit: user\n\nPrivate person state.\n');
  await writeFile(path.join(legacy, 'user', 'preferences.md'), '- 2026-01-01: Kept. Why: chosen before setup.\n');
  await writeFile(path.join(legacy, 'user', 'routes.md'), '## Environments\n\n## Projects\n\n## Minds\n');
  await writeFile(path.join(legacy, 'rules.md'), 'Rules of 2.x.\n');
  const original = `[.ShellClassInfo]\r\nIconResource=C:\\old.ico,0\r\n${VIEW}`;
  await writeFile(path.join(legacy, 'desktop.ini'), original);
  const calls = [];
  const session = await createSetupSession({ kitPath: fixture.kitPath, mindPath: fixture.mindPath, legacySourcePath: legacy, homeDir: fixture.homeDir,
    cosmicPath: fixture.cosmicPath, hostname: 'TESTBOX', env: { PATH: '' }, language: 'en', resume: false, aclRunner: stubAclRunner(),
    folderIconPlatform: 'win32', attribRunner: async args => { calls.push(args); } });
  await session.answer({});
  await session.answer({ mindPath: fixture.mindPath });
  if ((await session.getStep()).legacy?.confirmation) await session.answer({ mindPath: fixture.mindPath, closeLegacy: true });
  await session.answer({ confirm: true });
  const result = await session.install();
  assert.equal(result.completed, true, JSON.stringify(session.checkpoint?.error));
  const file = path.join(fixture.mindPath, 'desktop.ini');
  assert.equal(await readFile(file, 'utf8'), `[.ShellClassInfo]\r\nIconResource=${ICON},0\r\n${VIEW}`);
  assert.equal(await readFile(path.join(legacy, 'desktop.ini'), 'utf8'), original, 'the previous M1ND keeps its bytes');
  assert.ok(calls.some(args => args[0] === '-h' && args.at(-1) === file), 'the hidden file is made writable before it is changed');
  const { record } = await readMachineRecord(fixture.mindPath, 'TESTBOX');
  assert.equal(Object.hasOwn(record.managedFiles, file), false, 'a desktop.ini the person had is merged, never claimed');
});

test('on Windows the real attributes are Hidden and System on the file and ReadOnly on the folder', { skip: process.platform !== 'win32' }, async context => {
  const fixture = await kitFixture(context);
  await installed(fixture);
  const listing = execFileSync(path.join(process.env.SystemRoot, 'System32', 'attrib.exe'), [path.join(fixture.mindPath, 'desktop.ini')], { encoding: 'utf8' });
  assert.match(listing.slice(0, 20), /S.*H|H.*S/);
  const folder = execFileSync('cmd.exe', ['/c', 'dir', '/ad', '/b', fixture.root], { encoding: 'utf8' });
  assert.match(folder, /mind/);
  const readOnly = execFileSync(path.join(process.env.SystemRoot, 'System32', 'attrib.exe'), ['/d', fixture.mindPath], { encoding: 'utf8' });
  assert.match(readOnly.slice(0, 20), /R/);
  assert.ok((await stat(fixture.mindPath)).isDirectory());
});

test('removing the M1ND folder is allowed with the icon file setup created, even with its attributes', async context => {
  const fixture = await kitFixture(context);
  await installed(fixture);
  const uninstallOptions = { mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' }, cosmicPath: fixture.cosmicPath,
    registrationRunner: async () => ({ status: 0, stdout: '', stderr: '' }), stopService: async () => {} };
  const done = await uninstall({ ...uninstallOptions, removeMind: true });
  assert.ok(done.removed.includes(fixture.mindPath), JSON.stringify(done.kept));
  await assert.rejects(stat(fixture.mindPath), { code: 'ENOENT' });
});
