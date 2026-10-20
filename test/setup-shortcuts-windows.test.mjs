import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyShortcuts, shortcutPlan } from '../engine/shortcuts.mjs';

// The one test that runs the real Windows Script Host: it writes a shortcut in a temporary folder and reads it back.
test('the Windows Script Host writes a real shortcut that quotes its arguments and keeps accented folders', { skip: process.platform !== 'win32' }, async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-lnk-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'Desktop');
  await mkdir(folder);
  const mind = 'C:\\Users\\Tom Ás\\M1ND';
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  const items = shortcutPlan({ platform: 'win32', mindPath: mind, nodePath: node, cosmicPath: '', folders: { desktop: folder },
    message: 'It could not start.', description: 'Open HIVEM1ND', env: process.env });
  const [result] = await applyShortcuts(items);
  assert.equal(result.status, 'applied');
  const reader = [
    'Set link = CreateObject("WScript.Shell").CreateShortcut(WScript.Arguments(0))',
    'Set file = CreateObject("Scripting.FileSystemObject").CreateTextFile(WScript.Arguments(1), True, True)',
    'file.WriteLine link.TargetPath',
    'file.WriteLine link.Arguments',
    'file.WriteLine link.IconLocation',
    'file.WriteLine link.WindowStyle',
    'file.Close',
  ].join('\r\n');
  const script = path.join(root, 'read.vbs');
  const out = path.join(root, 'link.txt');
  await writeFile(script, reader);
  execFileSync(path.join(process.env.SystemRoot, 'System32', 'cscript.exe'), ['//nologo', script, result.file, out]);
  const lines = (await readFile(out)).toString('utf16le').replace(/^\uFEFF/, '').split(/\r?\n/);
  assert.match(lines[0], /wscript\.exe$/i);
  const quoted = [path.join(mind, 'gui', 'launch.vbs'), node, path.join(mind, 'cli', 'index.mjs'), mind, 'It could not start.', ''].map(part => `"${part}"`);
  assert.equal(lines[1], quoted.join(' '));
  assert.equal(lines[2], `${path.join(mind, 'assets', 'installer.ico')},0`);
  assert.equal(lines[3], '7');
});
