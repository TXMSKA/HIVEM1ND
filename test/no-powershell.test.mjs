import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Antivirus behavior rules kill encoded PowerShell command lines, so the kit
// never starts PowerShell: ACLs use icacls.exe and hooks start node directly.
const ROOT = path.resolve(import.meta.dirname, '..');
const FOLDERS = ['engine', 'cli', 'scripts', 'gui', 'features'];
const STARTS = [/(['"`])(?:powershell|pwsh)(?:\.exe)?\1/i, /-EncodedCommand \$\{/];

async function sources(folder) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') found.push(...await sources(full));
    else if (/\.(?:mjs|cjs|js)$/.test(entry.name)) found.push(full);
  }
  return found;
}

test('no source file starts PowerShell or builds an encoded command', async () => {
  const offenders = [];
  for (const folder of FOLDERS) {
    for (const file of await sources(path.join(ROOT, folder))) {
      const text = await readFile(file, 'utf8');
      if (STARTS.some((pattern) => pattern.test(text))) offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, []);
});
