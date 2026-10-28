import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashContent } from './records.mjs';
import { assertNoLinks } from './service/paths.mjs';

// The desktop and Start menu shortcuts of the app. A shortcut runs the Windows Script Host with gui/launch.vbs, which
// runs `service launch` with no console window, so no black window stays open and no address is ever printed.
// Windows Script Host also writes the .lnk files (engine/make-shortcut.vbs); nothing here starts PowerShell.

const NAME = 'ONEM1ND.lnk';
const MAKER = fileURLToPath(new URL('./make-shortcut.vbs', import.meta.url));

const system32 = env => path.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32');

// A Windows desktop can be redirected (OneDrive does it), so the folder comes from the user's shell folder setting.
export async function windowsShortcutFolders({ env = process.env, home, query = queryDesktopFolder } = {}) {
  const expand = value => value.replace(/%([^%]+)%/g, (whole, name) => env[name] ?? env[name.toUpperCase()] ?? whole);
  const registered = await query(env).catch(() => null);
  const desktop = registered ? expand(registered) : path.join(home, 'Desktop');
  const startMenu = env.APPDATA ? path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : null;
  return { desktop: desktop.includes('%') ? path.join(home, 'Desktop') : desktop, startMenu };
}

function queryDesktopFolder(env) {
  return new Promise((resolve, reject) => {
    execFile(path.join(system32(env), 'reg.exe'),
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Desktop'],
      { windowsHide: true }, (error, stdout) => {
        const match = /Desktop\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(String(stdout));
        if (error || !match) reject(error ?? new Error('Desktop folder not found'));
        else resolve(match[1]);
      });
  });
}

// Pure: what each shortcut is. The target is the Script Host, the arguments carry the runtime, the CLI of the mind, the
// mind and the sentence to show if the app cannot start.
// `kitPath` is the installed kit the shortcut starts; a joined M1ND may hold an older kit copy without the launcher.
export function shortcutPlan({ platform = process.platform, mindPath, kitPath = mindPath, nodePath = process.execPath, cosmicPath = '', folders, message, description, env = process.env }) {
  if (platform !== 'win32') return [];
  const launcher = path.join(kitPath, 'gui', 'launch.vbs');
  const common = {
    target: path.join(system32(env), 'wscript.exe'),
    args: [launcher, nodePath, path.join(kitPath, 'cli', 'index.mjs'), mindPath, message, cosmicPath],
    workingDirectory: kitPath,
    icon: `${path.join(kitPath, 'assets', 'installer.ico')},0`,
    description,
  };
  return [
    folders?.desktop && { file: path.join(folders.desktop, NAME), ...common },
    folders?.startMenu && { file: path.join(folders.startMenu, 'Cosmic', NAME), startMenuRoot: folders.startMenu, ...common },
  ].filter(Boolean);
}

function runMaker(item, env) {
  return new Promise((resolve, reject) => {
    execFile(path.join(system32(env), 'wscript.exe'),
      ['//Nologo', MAKER, item.file, item.target, item.workingDirectory, item.icon, item.description, ...item.args],
      { windowsHide: true, timeout: 15000 }, error => error ? reject(error) : resolve());
  });
}

async function bytesOf(file) {
  const state = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!state) return null;
  if (!state.isFile()) return undefined;
  return readFile(file);
}

// A shortcut is written when none exists or the one there is the one setup made (its bytes still match the record);
// any other file with that name is the person's and stays. Only Cosmic is created inside an existing Start menu root.
export async function applyShortcuts(plan, { managed = {}, run = runMaker, env = process.env } = {}) {
  const results = [];
  for (const item of plan) {
    if (item.startMenuRoot) {
      if (path.resolve(path.dirname(item.file)) !== path.resolve(item.startMenuRoot, 'Cosmic')) throw new Error('The Start menu shortcut must stay inside Cosmic.');
      await assertNoLinks(item.file);
      const root = await lstat(item.startMenuRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!root?.isDirectory()) { results.push({ file: item.file, status: 'skipped', reason: 'folder-missing' }); continue; }
      await mkdir(path.dirname(item.file)).catch(error => { if (error.code !== 'EEXIST') throw error; });
    }
    const existing = await bytesOf(item.file);
    const folder = await lstat(path.dirname(item.file)).catch(() => null);
    if (!folder?.isDirectory()) { results.push({ file: item.file, status: 'skipped', reason: 'folder-missing' }); continue; }
    if (existing === undefined || existing && hashContent(existing) !== managed[item.file]) {
      results.push({ file: item.file, status: 'kept', reason: 'not-ours' });
      continue;
    }
    await run(item, env);
    const written = await bytesOf(item.file);
    if (!written) throw new Error(`The shortcut was not created: ${item.file}`);
    results.push({ file: item.file, status: 'applied', created: existing === null, hash: hashContent(written) });
  }
  return results;
}

// A shortcut setup made and the person has not changed is taken away, the way uninstall does; any other file with that
// name is the person's and stays. Only a shortcut in the record is ever touched.
export async function removeOwnedShortcuts(folders, { managed = {} } = {}) {
  const results = [];
  for (const folder of folders.filter(Boolean)) {
    const file = path.join(folder, NAME);
    if (!Object.hasOwn(managed, file)) continue;
    const existing = await bytesOf(file);
    if (existing === null) { results.push({ file, status: 'missing' }); continue; }
    if (existing === undefined || hashContent(existing) !== managed[file]) { results.push({ file, status: 'kept', reason: 'not-ours' }); continue; }
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    results.push({ file, status: 'removed' });
  }
  return results;
}
