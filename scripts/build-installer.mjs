import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export const NODE_ZIP_NAME = 'node-v22.23.3-win-x64.zip';
export const NODE_ZIP_SHA256 = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71';
export const NODE_EXE_SHA256 = '9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e';
export const BROWSER_ASSETS = Object.freeze(['index.html', 'styles.css', 'app.js']);
export const NODE_EXE_NAME = 'node-v22.23.3-win-x64/node.exe';
export const NODE_LICENSE_NAME = 'node-v22.23.3-win-x64/LICENSE';
export const NODE_ENTRY_LIMIT = 86973768;
export const NODE_VERSION = 'v22.23.3';

const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const ZIP32 = 0xffffffff;

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function assertZipBounds({ count, offset, size }) {
  if (count > 65535 || offset > ZIP32 || size > ZIP32) {
    throw Object.assign(new Error('The archive exceeds the ZIP32 limit.'), { code: 'zip_too_large' });
  }
}

function rejectName(name) {
  if (typeof name !== 'string' || name === '' || name.includes('\\') || name.includes('\0') || path.win32.isAbsolute(name) || path.posix.isAbsolute(name)) {
    throw Object.assign(new Error('The archive name is not a relative path.'), { code: 'zip_rejected' });
  }
  const text = name.endsWith('/') ? name.slice(0, -1) : name;
  if (text === '') throw Object.assign(new Error('The archive name leaves its root.'), { code: 'zip_rejected' });
  for (const part of text.split('/')) {
    if (part === '' || part === '.' || part === '..') {
      throw Object.assign(new Error('The archive name leaves its root.'), { code: 'zip_rejected' });
    }
  }
}

function zipError(message) {
  return Object.assign(new Error(message), { code: 'zip_rejected' });
}

function acceptExtra(bytes, start, length) {
  if (length === 0) return;
  if (length !== 36 || start + length > bytes.length) throw zipError('An unsupported extra field was rejected.');
  const id = bytes.readUInt16LE(start);
  const size = bytes.readUInt16LE(start + 2);
  if (id !== 0x000a || size !== 32) throw zipError('An unsupported extra field was rejected.');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function writeZip(files, options = {}) {
  const entries = files.map((file) => {
    rejectName(file.name);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const method = file.method ?? 0;
    if (method !== 0 && method !== 8) throw Object.assign(new Error('Only stored and deflated entries are written.'), { code: 'zip_rejected' });
    const extra = Buffer.isBuffer(file.extra) ? file.extra : Buffer.alloc(0);
    acceptExtra(extra, 0, extra.length);
    const stored = method === 8 ? deflateRawSync(data) : data;
    assertZipBounds({ count: files.length, offset: 0, size: stored.length });
    return { name: file.name, data, stored, method, extra, mode: file.mode ?? 0o100644, crc: crc32(data) };
  });
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
  const seen = new Set();
  const locals = [];
  let offset = 0;
  for (const entry of entries) {
    if (seen.has(entry.name)) throw Object.assign(new Error('The archive repeats a name.'), { code: 'zip_rejected' });
    seen.add(entry.name);
    const name = Buffer.from(entry.name);
    assertZipBounds({ count: entries.length, offset, size: entry.stored.length });
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.stored.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(entry.extra.length, 28);
    locals.push({ offset, bytes: Buffer.concat([header, name, entry.extra, entry.stored]) });
    offset += locals[locals.length - 1].bytes.length;
    assertZipBounds({ count: entries.length, offset, size: entry.stored.length });
  }
  const centralStart = offset;
  const centrals = [];
  for (const entry of entries) {
    const local = locals[centrals.length];
    const name = Buffer.from(entry.name);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.stored.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(entry.extra.length, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE((entry.mode << 16) >>> 0, 38);
    header.writeUInt32LE(local.offset, 42);
    centrals.push(Buffer.concat([header, name, entry.extra]));
  }
  const central = Buffer.concat(centrals);
  assertZipBounds({ count: entries.length, offset: centralStart, size: central.length });
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  if (options.returnEntries === true) return { zip: Buffer.concat([...locals.map((item) => item.bytes), central, end]), entries };
  return Buffer.concat([...locals.map((item) => item.bytes), central, end]);
}

export function readArchive(bytes, options = {}) {
  const zip = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (zip.length < 22) throw Object.assign(new Error('The archive is too small.'), { code: 'zip_rejected' });
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50 || zip.readUInt16LE(end + 20) !== 0) {
    throw Object.assign(new Error('The archive comment or end record is not accepted.'), { code: 'zip_rejected' });
  }
  const count = zip.readUInt16LE(end + 10);
  const centralSize = zip.readUInt32LE(end + 12);
  const centralOffset = zip.readUInt32LE(end + 16);
  if (centralOffset + centralSize !== end) throw Object.assign(new Error('The central directory is not contiguous.'), { code: 'zip_rejected' });
  const entries = [];
  const names = new Set();
  const ranges = [];
  let aggregate = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== 0x02014b50) {
      throw Object.assign(new Error('The central directory is truncated.'), { code: 'zip_rejected' });
    }
    const method = zip.readUInt16LE(cursor + 10);
    const flags = zip.readUInt16LE(cursor + 8);
    const crc = zip.readUInt32LE(cursor + 16);
    const compressed = zip.readUInt32LE(cursor + 20);
    const uncompressed = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const external = zip.readUInt32LE(cursor + 38);
    const localOffset = zip.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLength + extraLength + commentLength > end) throw zipError('The central directory is truncated.');
    if (commentLength !== 0 || compressed === ZIP32 || uncompressed === ZIP32 || zip.readUInt16LE(cursor + 34) === 0xffff) {
      throw zipError('ZIP64, encryption, and comments are rejected.');
    }
    acceptExtra(zip, cursor + 46 + nameLength, extraLength);
    if ((flags & 0x0001) !== 0 || (flags & 0x0008) !== 0) {
      throw zipError('Encrypted or descriptor entries are rejected.');
    }
    if (method !== 0 && method !== 8) throw zipError('The compression method is not accepted.');
    const unix = external >>> 16;
    if ((unix & 0o170000) === 0o120000 || (external & 0x400) !== 0) throw zipError('The archive contains a link.');
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const directory = name.endsWith('/') || (external & 0x10) !== 0 || (unix & 0o170000) === 0o040000;
    rejectName(name);
    if (names.has(name)) throw zipError('The archive repeats a name.');
    names.add(name);
    if (directory && (uncompressed !== 0 || compressed !== 0)) throw zipError('A directory entry is not empty.');
    const cap = name === NODE_EXE_NAME || name === NODE_LICENSE_NAME ? (options.nodeLimit ?? NODE_ENTRY_LIMIT) : (options.maxOutput ?? 64_000_000);
    if (!directory && (uncompressed > cap || compressed > cap)) throw zipError('The entry is larger than the output cap.');
    aggregate += uncompressed;
    if (aggregate > (options.maxAggregate ?? 512_000_000)) throw zipError('The archive exceeds the output cap.');
    if (localOffset >= centralOffset || zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw zipError('The local header offset is not accepted.');
    }
    const localFlags = zip.readUInt16LE(localOffset + 6);
    const localMethod = zip.readUInt16LE(localOffset + 8);
    const localCrc = zip.readUInt32LE(localOffset + 14);
    const localCompressed = zip.readUInt32LE(localOffset + 18);
    const localUncompressed = zip.readUInt32LE(localOffset + 22);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    if ((localFlags & 0x0001) !== 0 || (localFlags & 0x0008) !== 0 || localMethod !== method || localCrc !== crc || localCompressed !== compressed || localUncompressed !== uncompressed) {
      throw zipError('The local header does not match the central directory.');
    }
    const localName = zip.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8');
    if (localName !== name) throw zipError('The local header name does not match.');
    acceptExtra(zip, localOffset + 30 + localNameLength, localExtraLength);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressed;
    if (dataEnd > centralOffset) throw zipError('The local header offset is not accepted.');
    for (const range of ranges) {
      if (localOffset < range.end && dataEnd > range.start) throw zipError('The archive overlaps an entry.');
    }
    ranges.push({ start: localOffset, end: dataEnd });
    const wanted = !options.only || options.only.includes(name);
    if (!directory && wanted) {
      const stored = zip.subarray(dataStart, dataEnd);
      const data = method === 8 ? inflateRawSync(stored, { maxOutputLength: cap }) : stored;
      if (data.length !== uncompressed) throw zipError('The expanded size does not match.');
      if (crc32(data) !== crc) throw zipError('The entry checksum does not match.');
      entries.push({ name, data, crc });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readInputs(argv) {
  const input = { dryRun: false, nodeZip: null, output: null, assetDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      input.dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (token === '--node-zip') {
      input.nodeZip = value;
      index += 1;
      continue;
    }
    if (token === '--output') {
      input.output = value;
      index += 1;
      continue;
    }
    if (token === '--asset-dir') {
      input.assetDir = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown installer option: ${token}`);
  }
  if (input.assetDir && input.dryRun !== true) throw new Error('Release packaging does not accept an asset override.');
  return input;
}

export async function verifyRuntime(zipPath, options = {}) {
  if (!zipPath) throw Object.assign(new Error(`Pass --node-zip <absolute-file> pointing at ${NODE_ZIP_NAME}. The build does not download it.`), { code: 'missing_runtime' });
  const bytes = await readFile(zipPath);
  const digest = sha256(bytes);
  if (digest !== NODE_ZIP_SHA256) {
    throw Object.assign(new Error('The pinned Node archive digest does not match. No download was performed.'), { code: 'runtime_digest' });
  }
  const entries = readArchive(bytes, { only: [NODE_EXE_NAME, NODE_LICENSE_NAME] });
  const executable = entries.find((entry) => entry.name === NODE_EXE_NAME);
  const license = entries.find((entry) => entry.name === NODE_LICENSE_NAME);
  if (!executable || sha256(executable.data) !== NODE_EXE_SHA256) {
    throw Object.assign(new Error('The extracted Node executable digest does not match the pin.'), { code: 'runtime_digest' });
  }
  if (!license) throw Object.assign(new Error('The Node license is missing from the pinned archive.'), { code: 'runtime_digest' });
  const version = await confirmRuntimeVersion(executable.data, options);
  return { digest, executable: executable.data, license: license.data, version, available: true };
}

export async function confirmRuntimeVersion(executable, options = {}) {
  const stage = await mkdtemp(path.join(tmpdir(), 'hivem1nd-runtime-'));
  const exe = path.join(stage, 'node.exe');
  const spawnOptions = {
    shell: false,
    windowsHide: true,
    cwd: stage,
    env: { PATH: '', SystemRoot: process.env.SystemRoot ?? '' },
  };
  try {
    await writeFile(exe, executable);
    const output = options.spawn
      ? await options.spawn(exe, ['--version'], spawnOptions)
      : await capture(exe, ['--version'], spawnOptions);
    const version = String(output ?? '').trim();
    if (version !== NODE_VERSION) {
      throw Object.assign(new Error(`The staged runtime reported ${version || 'no version'}, expected ${NODE_VERSION}.`), { code: 'runtime_version' });
    }
    return version;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function capture(file, args, spawnOptions) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(Object.assign(new Error('The staged runtime did not report its version.'), { code: 'runtime_version' }));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

export function productionPackages(lock) {
  const packages = lock.packages ?? {};
  const queue = Object.keys(packages['']?.dependencies ?? {}).map((name) => ({ name, from: '' }));
  const seen = new Set();
  const result = [];
  while (queue.length) {
    const item = queue.shift();
    const key = resolveLockKey(packages, item.from, item.name);
    if (!key) throw new Error(`Missing locked package: ${item.name}`);
    if (seen.has(key)) continue;
    const pkg = packages[key];
    if (pkg.dev === true) continue;
    seen.add(key);
    result.push({ name: item.name, version: pkg.version, key });
    for (const dependency of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dependency, from: key });
    for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) queue.push({ name: dependency, from: key });
  }
  return result.sort((left, right) => left.key.localeCompare(right.key));
}

function resolveLockKey(packages, from, name) {
  const bases = [];
  if (from) {
    const pieces = from.split('/node_modules/');
    let built = '';
    for (const piece of pieces) {
      built = built ? `${built}/node_modules/${piece}` : piece;
      bases.unshift(built);
    }
  }
  bases.push('');
  for (const base of bases) {
    const key = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[key]) return key;
  }
  return null;
}

export async function verifyInstalled(packageRoot, packages) {
  for (const item of packages) {
    const directory = path.join(packageRoot, item.key);
    const state = await lstat(directory);
    if (state.isSymbolicLink()) throw new Error(`Refusing a linked package: ${item.key}`);
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    if (manifest.name !== item.name || manifest.version !== item.version) {
      throw new Error(`Installed package does not match the lock: ${item.key}`);
    }
  }
  return packages;
}

export function installerScript() {
  return '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0installer.mjs"\r\n';
}

export function installerEntry() {
  return `import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(path.join(here, 'manifest.json'), 'utf8'));
if (manifest.format !== 'hivem1nd-installer-v1' || manifest.version !== '3.0.0') {
  throw new Error('The installer manifest is not valid.');
}
for (const file of manifest.files) {
  if (file.name === 'manifest.json') continue;
  const bytes = await readFile(path.join(here, file.name));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== file.sha256 || bytes.length !== file.bytes) {
    throw new Error('A payload file does not match the manifest.');
  }
}
if (process.argv.includes('--dry-run') || manifest.label === 'dry-run') {
  console.log('dry-run');
} else {
  console.log('installer ready');
}
`;
}

export function manifestDocument(files, runtime = 'unverified', label = 'release') {
  return {
    format: 'hivem1nd-installer-v1',
    version: '3.0.0',
    runtime,
    label,
    files: files.map((file) => ({
      name: file.name,
      bytes: file.data.length,
      sha256: sha256(file.data),
    })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name))),
  };
}

export async function assertReleaseAssets(assetDir) {
  for (const name of BROWSER_ASSETS) {
    try {
      await access(path.join(assetDir, name));
    } catch {
      throw new Error(`Release packaging needs browser asset ${name}.`);
    }
  }
}

export function build(options = {}) {
  if (options.release === true) {
    if (options.browserAssets === 'unavailable') throw new Error('Release packaging needs the browser assets.');
  }
  const files = (options.files ?? []).map((file) => ({
    name: file.name,
    data: Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data),
  }));
  if (!files.some((file) => file.name === 'install.cmd')) files.push({ name: 'install.cmd', data: Buffer.from(installerScript()) });
  const label = options.label ?? (options.dryRun === true ? 'dry-run' : 'release');
  const manifest = Buffer.from(`${JSON.stringify(manifestDocument(files, options.runtime ?? 'unverified', label))}\n`);
  files.push({ name: 'manifest.json', data: manifest });
  const zip = writeZip(files);
  return {
    zip,
    digest: sha256(zip),
    dryRun: options.dryRun === true,
    browserAssets: options.browserAssets ?? (options.release === true ? 'packaged' : 'unavailable'),
  };
}

export async function dryRun(options = {}) {
  const { planRegistration } = await import('../engine/service/install.mjs');
  const plan = planRegistration({
    platform: 'win32',
    nodePath: options.nodePath ?? 'C:\\Program Files\\node\\node.exe',
    cliPath: options.cliPath ?? 'C:\\kit\\cli\\index.mjs',
    mindPath: options.mindPath ?? 'C:\\Users\\Ada\\AppData\\Local\\Cosmic\\hivem1nd',
    workingDirectory: options.workingDirectory ?? 'C:\\kit',
    localDirectory: options.localDirectory ?? 'C:\\local',
    sid: options.sid ?? 'S-1-5-21-1',
  });
  let staged = null;
  let importSmoke = 'not-run';
  if (options.files && options.stageRoot) {
    staged = await stagePayload(options.files, options.stageRoot);
    if (options.spawn) {
      await smokeImports(staged, { spawn: options.spawn });
      importSmoke = 'passed';
    }
  }
  return {
    dryRun: true,
    label: 'dry-run',
    os: false,
    osCalls: 0,
    commands: plan.commands,
    body: plan.body,
    script: installerScript(),
    browserAssets: options.browserAssets ?? 'unavailable',
    activated: false,
    staged,
    importSmoke,
  };
}

export async function stagePayload(files, stageRoot) {
  const staged = path.join(path.resolve(stageRoot), 'dry-run-stage');
  await mkdir(staged, { recursive: true });
  for (const file of files) {
    rejectName(file.name);
    const target = path.join(staged, file.name);
    const relative = path.relative(staged, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Refusing to stage a path outside the dry-run root.');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.data);
  }
  return staged;
}

export async function smokeImports(stage, options = {}) {
  const node = path.join(stage, 'runtime', 'node.exe');
  const spawnOptions = {
    shell: false,
    windowsHide: true,
    cwd: stage,
    env: { PATH: '', SystemRoot: process.env.SystemRoot ?? '' },
  };
  const script = "import '@clack/prompts'; import 'jsonc-parser'; import 'smol-toml';";
  if (options.spawn) {
    await options.spawn(node, ['--input-type=module', '-e', script], spawnOptions);
    return;
  }
  await capture(node, ['--input-type=module', '-e', script], spawnOptions);
}

const PAYLOAD_ROOTS = Object.freeze(['cli', 'engine', 'gui', 'roles', 'commands', 'features', 'knowledge', 'migrations', 'fixtures', 'assets']);
const PAYLOAD_FILES = Object.freeze(['rules.md', 'files.md', 'uninstall.cmd', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md', 'package.json']);

function payloadSkipped(name, modules) {
  return /^(user|test|dist|\.git|\.claude|\.codex|\.cursor)(\/|$)/.test(name)
    || /(^|\/)(AGENTS|CLAUDE|memo)\.md$/.test(name)
    || (modules !== true && name.includes('node_modules/'))
    || name.endsWith('.env');
}

async function walkPayload(directory, prefix, modules = false) {
  const files = [];
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const name = `${prefix}${entry.name}`;
    if (payloadSkipped(name, modules)) continue;
    const full = path.join(directory, entry.name);
    const state = await lstat(full);
    if (state.isSymbolicLink()) throw new Error(`Refusing a linked payload file: ${name}`);
    if (state.isDirectory()) files.push(...await walkPayload(full, `${name}/`, modules));
    else if (state.isFile()) files.push({ name, data: await readFile(full) });
  }
  return files;
}

export async function collectPayload(options) {
  const packageRoot = options.packageRoot ?? root;
  const files = [
    { name: 'runtime/node.exe', data: Buffer.from(options.executable) },
    { name: 'runtime/LICENSE', data: Buffer.from(options.license) },
    { name: 'installer.mjs', data: Buffer.from(installerEntry()) },
    { name: 'install.cmd', data: Buffer.from(installerScript()) },
  ];
  for (const directory of PAYLOAD_ROOTS) files.push(...await walkPayload(path.join(packageRoot, directory), `${directory}/`));
  for (const name of PAYLOAD_FILES) {
    try {
      files.push({ name, data: await readFile(path.join(packageRoot, name)) });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const packages = await verifyInstalled(packageRoot, productionPackages(options.lock));
  if (packages.length !== 8) throw new Error(`Expected 8 production packages, found ${packages.length}.`);
  for (const item of packages) files.push(...await walkPayload(path.join(packageRoot, item.key), `${item.key}/`, true));
  if (options.includeBrowser === true) {
    const assetDir = options.assetDir ?? path.join(packageRoot, 'gui', 'app');
    await assertReleaseAssets(assetDir);
    for (const name of BROWSER_ASSETS) {
      const payloadName = `gui/app/${name}`;
      if (!files.some((file) => file.name === payloadName)) {
        files.push({ name: payloadName, data: await readFile(path.join(assetDir, name)) });
      }
    }
  }
  return files;
}

export async function cleanStage(target, rootDir) {
  const base = path.resolve(rootDir);
  const resolved = path.resolve(target);
  const relative = path.relative(base, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to clean a path that is not inside the stage root.');
  }
  let current = resolved;
  while (current !== base) {
    try {
      const state = await lstat(current);
      if (state.isSymbolicLink()) throw new Error('Refusing to clean a link.');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    current = path.dirname(current);
  }
  await rm(resolved, { recursive: true, force: true });
}

function insideRoot(rootDir, target) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(target));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing a path outside the install root.');
  }
}

async function assertRealChain(target, rootDir) {
  let current = path.resolve(target);
  const base = path.resolve(rootDir);
  while (true) {
    try {
      const state = await lstat(current);
      if (state.isSymbolicLink()) throw new Error('Refusing to follow a link.');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (current === base) return;
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Refusing to leave the install root.');
    current = parent;
  }
}

function hashesMatch(files, manifest) {
  for (const item of manifest?.files ?? []) {
    if (item.name === 'manifest.json') continue;
    const file = (files ?? []).find((entry) => entry.name === item.name);
    const data = Buffer.from(file?.data ?? []);
    if (!file || data.length !== item.bytes || sha256(data) !== item.sha256) {
      throw Object.assign(new Error('A payload file does not match the manifest.'), { code: 'payload_mismatch' });
    }
  }
}

export async function installPayload(options) {
  if (options.dryRun !== false) return { dryRun: true, activated: false };
  const rootDir = path.resolve(options.root ?? path.dirname(path.resolve(options.destination)));
  const destination = path.resolve(options.destination);
  insideRoot(rootDir, destination);
  await assertRealChain(destination, rootDir);
  if (options.manifest) hashesMatch(options.files, options.manifest);
  if (options.active || options.identity) {
    if (options.active?.mind !== options.identity?.mind || options.active?.service !== options.identity?.service) {
      throw Object.assign(new Error('The active mind or service does not match this payload.'), { code: 'identity_mismatch' });
    }
  }
  const nonce = randomBytes(4).toString('hex');
  const stage = path.join(rootDir, `${path.basename(destination)}.${options.version ?? '3.0.0'}.${nonce}.stage`);
  insideRoot(rootDir, stage);
  await assertRealChain(stage, rootDir);
  let created = false;
  let backup = null;
  let moved = false;
  try {
    await mkdir(stage);
    created = true;
    const rootReal = await realpath(rootDir);
    const stageReal = await realpath(stage);
    insideRoot(rootReal, stageReal);
    for (const file of options.files ?? []) {
      rejectName(file.name);
      const target = path.resolve(stageReal, file.name);
      insideRoot(stageReal, target);
      await assertRealChain(path.dirname(target), stageReal);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.data);
    }
    if (options.smoke === true) await smokeImports(stageReal, { spawn: options.spawn });
    let existing = null;
    try {
      existing = await lstat(destination);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (existing?.isSymbolicLink()) throw new Error('Refusing to activate over a link.');
    if (existing) {
      backup = path.join(rootDir, `${path.basename(destination)}.${nonce}.backup`);
      insideRoot(rootDir, backup);
      await rename(destination, backup);
      moved = true;
    }
    await rename(stage, destination);
    created = false;
    return { dryRun: false, activated: true, destination, backup };
  } catch (error) {
    if (moved && backup) await rename(backup, destination).catch(() => {});
    throw error;
  } finally {
    if (created) {
      const state = await lstat(stage).catch(() => null);
      if (state && !state.isSymbolicLink()) {
        const rootReal = await realpath(rootDir).catch(() => null);
        const stageReal = await realpath(stage).catch(() => null);
        if (rootReal && stageReal) {
          const relative = path.relative(rootReal, stageReal);
          if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
            await rm(stage, { recursive: true, force: true });
          }
        }
      }
    }
  }
}

export async function main(argv) {
  const input = readInputs(argv);
  if (!input.nodeZip) {
    throw new Error(`Pass --node-zip <absolute-file> pointing at ${NODE_ZIP_NAME}. The build does not download it.`);
  }
  if (input.dryRun !== true) await assertReleaseAssets(input.assetDir ?? path.join(root, 'gui', 'app'));
  const runtime = await verifyRuntime(input.nodeZip);
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const files = await collectPayload({
    executable: runtime.executable,
    license: runtime.license,
    lock,
    includeBrowser: input.dryRun !== true,
    assetDir: input.assetDir,
  });
  const artifact = build({
    files,
    dryRun: input.dryRun,
    release: input.dryRun !== true,
    runtime: runtime.digest,
    browserAssets: input.dryRun ? 'unavailable' : 'packaged',
    label: input.dryRun ? 'dry-run' : 'release',
  });
  if (input.dryRun) {
    const stageRoot = await mkdtemp(path.join(tmpdir(), 'hivem1nd-dry-run-'));
    try {
      const staged = await stagePayload(files, stageRoot);
      await smokeImports(staged);
      artifact.plan = await dryRun({
        nodePath: path.join(staged, 'runtime', 'node.exe'),
        cliPath: path.join(staged, 'cli', 'index.mjs'),
        workingDirectory: staged,
      });
      artifact.importSmoke = 'passed';
    } finally {
      await rm(stageRoot, { recursive: true, force: true });
    }
  }
  if (input.output) {
    await mkdir(path.dirname(path.resolve(input.output)), { recursive: true });
    await writeFile(input.output, artifact.zip);
  }
  return artifact;
}

const isMain = process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]));
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
