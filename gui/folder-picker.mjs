import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The browser wizard cannot open a native folder dialog itself, so its local server opens the one the system has.
// Windows runs the Windows Script Host with a small script (Shell.Application is the system folder dialog), macOS
// runs osascript, Linux runs zenity or kdialog. Nothing here starts PowerShell.

const SCRIPT = fileURLToPath(new URL('./folder-picker.vbs', import.meta.url));

export class PickerUnavailableError extends Error {
  constructor(message = 'No folder picker is available on this system.') {
    super(message);
    this.name = 'PickerUnavailableError';
    this.code = 'browse_unavailable';
  }
}

function runProgram(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: false, timeout: 10 * 60 * 1000, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error && typeof error.code === 'string') reject(error);
      else resolve({ code: error ? error.code ?? 1 : 0, stdout: String(stdout ?? '') });
    });
  });
}

// One entry per attempt: a program, its arguments, and how to read the answer. A person closing the dialog is an
// answer (null), a program that cannot start is not (the next entry is tried).
export function pickerAttempts(platform, { title, env = process.env, output = null } = {}) {
  if (platform === 'win32') {
    const system = path.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32');
    return [{ file: path.join(system, 'cscript.exe'), args: ['//nologo', SCRIPT, title, output], source: 'file' }];
  }
  if (platform === 'darwin') {
    const prompt = title.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return [{ file: 'osascript', args: ['-e', `POSIX path of (choose folder with prompt "${prompt}")`], source: 'stdout' }];
  }
  return [
    { file: 'zenity', args: ['--file-selection', '--directory', `--title=${title}`], source: 'stdout' },
    { file: 'kdialog', args: ['--getexistingdirectory', os.homedir(), '--title', title], source: 'stdout' },
  ];
}

function cleanPath(value) {
  const trimmed = String(value).replace(/^\uFEFF/, '').trim();
  const stripped = trimmed.length > 1 ? trimmed.replace(/[\\/]+$/, '') : trimmed;
  return stripped.length === 2 && stripped[1] === ':' ? `${stripped}\\` : stripped;
}

export async function pickFolder({ title = 'Choose a folder', platform = process.platform, run = runProgram, env = process.env } = {}) {
  const scratch = platform === 'win32' ? await mkdtemp(path.join(os.tmpdir(), 'onem1nd-pick-')) : null;
  try {
    const output = scratch ? path.join(scratch, 'folder.txt') : null;
    for (const attempt of pickerAttempts(platform, { title, env, output })) {
      let result;
      try {
        result = await run(attempt.file, attempt.args);
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'EACCES') continue;
        throw error;
      }
      if (result.code !== 0) return null;
      const chosen = attempt.source === 'file'
        ? await readFile(output).then(bytes => bytes.toString('utf16le'), error => { if (error.code === 'ENOENT') return ''; throw error; })
        : result.stdout;
      const folder = cleanPath(chosen);
      return folder === '' ? null : folder;
    }
    throw new PickerUnavailableError();
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
