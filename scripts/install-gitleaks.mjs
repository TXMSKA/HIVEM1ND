import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '8.30.1';
const ASSETS = {
  'darwin-arm64': ['gitleaks_8.30.1_darwin_arm64.tar.gz', 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5'],
  'darwin-x64': ['gitleaks_8.30.1_darwin_x64.tar.gz', 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709'],
  'linux-arm64': ['gitleaks_8.30.1_linux_arm64.tar.gz', 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080'],
  'linux-x64': ['gitleaks_8.30.1_linux_x64.tar.gz', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
  'win32-arm64': ['gitleaks_8.30.1_windows_arm64.zip', 'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f'],
  'win32-x64': ['gitleaks_8.30.1_windows_x64.zip', 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e'],
};

const asset = ASSETS[`${process.platform}-${process.arch}`];
if (!asset) fail(`gitleaks ${VERSION} has no pinned build for ${process.platform}-${process.arch}`);
const [name, sha256] = asset;
const url = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${name}`;
const response = await fetch(url);
if (!response.ok) fail(`gitleaks download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== sha256) fail('gitleaks download failed checksum');
const folder = mkdtempSync(path.join(os.tmpdir(), 'onem1nd-gitleaks-install-'));
try {
  const archive = path.join(folder, name);
  await writeFile(archive, bytes);
  const extracted = path.join(folder, 'out');
  mkdirSync(extracted);
  const unpacked = spawnSync('tar', ['-xf', archive, '-C', extracted], { encoding: 'utf8', shell: false, windowsHide: true });
  if (unpacked.status !== 0) fail('gitleaks archive could not be unpacked');
  const binaryName = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  const binary = readFileSync(path.join(extracted, binaryName));
  const destinationDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tools');
  mkdirSync(destinationDir, { recursive: true });
  const destination = path.join(destinationDir, binaryName);
  await writeFile(destination, binary);
  if (process.platform !== 'win32') chmodSync(destination, 0o755);
} finally {
  rmSync(folder, { recursive: true, force: true });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
