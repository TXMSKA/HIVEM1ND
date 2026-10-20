import { execFile } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashContent } from './records.mjs';

// Windows shows a custom folder icon from a desktop.ini inside the folder. The icon sits in the kit copy the mind
// already holds, so the reference is relative and stays valid on every machine that shares the folder.
export const FOLDER_ICON = 'assets\\installer.ico';
const SECTION = '[.ShellClassInfo]';
const ICON_KEYS = /^\s*(?:IconResource|IconFile|IconIndex)\s*=/i;

// Replaces only the icon lines of [.ShellClassInfo]; every other line and section, [ViewState] included, stays as it is.
export function mergeDesktopIni(existing, icon = FOLDER_ICON) {
  const eol = existing?.includes('\r\n') || !existing?.includes('\n') ? '\r\n' : '\n';
  const lines = existing ? existing.split(/\r?\n/) : [];
  while (lines.length > 0 && lines.at(-1).trim() === '') lines.pop();
  const entry = `IconResource=${icon},0`;
  const start = lines.findIndex(line => line.trim().toLowerCase() === SECTION.toLowerCase());
  if (start === -1) return `${[SECTION, entry, ...lines].join(eol)}${eol}`;
  let end = lines.findIndex((line, index) => index > start && line.trim().startsWith('['));
  if (end === -1) end = lines.length;
  const kept = lines.slice(start + 1, end).filter(line => !ICON_KEYS.test(line));
  return `${[...lines.slice(0, start + 1), entry, ...kept, ...lines.slice(end)].join(eol)}${eol}`;
}

function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: bytes.subarray(2).toString('utf16le'), encoding: 'utf16le' };
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: bytes.subarray(3).toString('utf8'), encoding: 'utf8-bom' };
  return { text: bytes.toString('utf8'), encoding: 'utf8' };
}

function encode(text, encoding) {
  if (encoding === 'utf16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  if (encoding === 'utf8-bom') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  return Buffer.from(text, 'utf8');
}

export function windowsAttrib(env = process.env) {
  const program = path.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'attrib.exe');
  return args => new Promise((resolve, reject) => {
    execFile(program, args, { windowsHide: true }, error => error ? reject(error) : resolve());
  });
}

// Gives the mind folder its icon: desktop.ini carries the icon and is Hidden and System, the folder is ReadOnly so
// that Windows reads it. The file is created, or merged into the one already there; it is never removed or replaced.
export async function applyFolderIcon(mindPath, { platform = process.platform, attrib, env = process.env } = {}) {
  if (platform !== 'win32') return { status: 'skipped', reason: 'platform' };
  const folder = path.resolve(mindPath);
  const file = path.join(folder, 'desktop.ini');
  const state = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (state && (state.isSymbolicLink() || !state.isFile())) return { status: 'skipped', reason: 'unsafe', file };
  const icon = await lstat(path.join(folder, FOLDER_ICON.replaceAll('\\', path.sep))).catch(() => null);
  if (!icon?.isFile()) return { status: 'skipped', reason: 'icon-missing', file };
  const run = attrib ?? windowsAttrib(env);
  const bytes = state ? await readFile(file) : null;
  const decoded = bytes ? decode(bytes) : { text: null, encoding: 'utf8' };
  const next = encode(mergeDesktopIni(decoded.text, FOLDER_ICON), decoded.encoding);
  if (!bytes || !bytes.equals(next)) {
    // A file with the Hidden or System attribute cannot be opened for writing until they are cleared.
    if (state) await run(['-h', '-s', '-r', file]);
    await writeFile(file, next);
  }
  await run(['+h', '+s', file]);
  await run(['+r', folder]);
  return { status: 'applied', file, created: !state, hash: hashContent(next) };
}
