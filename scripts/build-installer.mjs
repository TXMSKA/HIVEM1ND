import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_STATIC_FILES, EMBEDDED_BROWSER_FILES } from '../engine/service/http.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export const NODE_ZIP_NAME = 'node-v22.23.3-win-x64.zip';
export const NODE_ZIP_SHA256 = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71';
export const NODE_EXE_SHA256 = '9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e';
export const BROWSER_ASSETS = BROWSER_STATIC_FILES;

export function missingPackagedBrowserAssets(included, embedded = EMBEDDED_BROWSER_FILES) {
  const missing = [];
  for (const name of BROWSER_ASSETS) {
    if (Object.hasOwn(embedded, name)) continue;
    const packaged = `gui/app/${name}`;
    if (!included.has(packaged)) missing.push(packaged);
  }
  return missing;
}
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
  return '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0installer.mjs" %*\r\n';
}

export function installerEntry() {
  return [
    "import { createHash, randomBytes } from 'node:crypto';",
    "import { spawn } from 'node:child_process';",
    "import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    '',
    'const here = path.dirname(fileURLToPath(import.meta.url));',
    "const manifest = JSON.parse(await readFile(path.join(here, 'manifest.json'), 'utf8'));",
    "if (manifest.format !== 'hivem1nd-installer-v1' || manifest.version !== '3.0.0') {",
    "  throw new Error('The installer manifest is not valid.');",
    '}',
    'for (const file of manifest.files) {',
    "  if (file.name === 'manifest.json') continue;",
    '  const bytes = await readFile(path.join(here, file.name));',
    "  const digest = createHash('sha256').update(bytes).digest('hex');",
    '  if (digest !== file.sha256 || bytes.length !== file.bytes) {',
    "    throw new Error('A payload file does not match the manifest.');",
    '  }',
    '}',
    'const localAppData = process.env.LOCALAPPDATA;',
    "if (!localAppData || !path.win32.isAbsolute(localAppData)) throw new Error('LOCALAPPDATA must be an absolute path.');",
    "const cosmic = path.resolve(localAppData, 'Cosmic');",
    "const destination = path.join(cosmic, 'hivem1nd-kit');",
    "const activeFile = path.join(cosmic, 'hivem1nd-service', 'active.json');",
    'await assertNoAncestorLink(destination, localAppData);',
    'let active = null;',
    'try {',
    "  const state = await lstat(activeFile);",
    "  if (state.isSymbolicLink()) throw new Error('Refusing to follow a link.');",
    "  active = JSON.parse(await readFile(activeFile, 'utf8'));",
    '} catch (error) {',
    "  if (error?.code !== 'ENOENT') throw error;",
    '}',
    'if (active && !(await ownedInstallation(active, cosmic))) {',
    "  throw new Error('The active mind or service does not match this payload.');",
    '}',
    'async function ownedInstallation(active, cosmicRoot) {',
    '  const normalize = (value) => {',
    "    if (typeof value !== 'string' || !value.trim() || value.includes('\\0')) return null;",
    '    const resolved = path.resolve(value);',
    "    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;",
    '  };',
    '  const inside = (parent, child) => {',
    '    if (!parent || !child) return false;',
    '    const relative = path.relative(parent, child);',
    "    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);",
    '  };',
    "  const machine = typeof active?.machine === 'string' ? active.machine.trim() : '';",
    '  const mindPath = normalize(active?.mindPath);',
    '  const localDirectory = normalize(active?.localDirectory);',
    "  const started = typeof active?.startedAt === 'string' && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(active.startedAt);",
    '  const pid = Number.isInteger(active?.pid) && active.pid > 0;',
    "  const serviceRoot = normalize(path.join(cosmicRoot, 'hivem1nd-service'));",
    '  if (!mindPath || !localDirectory || !machine || !started || !pid || !serviceRoot || !inside(serviceRoot, localDirectory)) return false;',
    "  const mindKey = createHash('sha256').update(mindPath).digest('hex').slice(0, 16);",
    "  const owned = normalize(path.join(cosmicRoot, 'hivem1nd-service', mindKey, machine));",
    '  if (!owned || owned !== localDirectory) return false;',
    "  const config = await readOwnedJson(path.join(localDirectory, 'config.json'));",
    "  const registration = await readOwnedJson(path.join(localDirectory, 'registration.json'));",
    "  if (!config || config.format !== 'hivem1nd-service-config-v1' || !registration || registration.format !== 'hivem1nd-registration-v1') return false;",
    '  const configuredMind = normalize(config.mindPath);',
    "  const configuredMachine = typeof config.machine === 'string' ? config.machine.trim() : '';",
    '  if (!configuredMind || !configuredMachine || configuredMind !== mindPath || configuredMachine !== machine) return false;',
    "  if (typeof registration.digest !== 'string' || registration.digest.length === 0) return false;",
    '  return true;',
    '}',
    'async function readOwnedJson(file) {',
    '  try {',
    '    const state = await lstat(file);',
    '    if (!state.isFile() || state.isSymbolicLink()) return null;',
    "    const parsed = JSON.parse(await readFile(file, 'utf8'));",
    "    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;",
    '    return parsed;',
    '  } catch {',
    '    return null;',
    '  }',
    '}',
    "const command = [path.join(destination, 'cli', 'index.mjs'), 'init', '--gui'];",
    "const dryRun = process.argv.includes('--dry-run') || manifest.label === 'dry-run';",
    'if (dryRun) {',
    "  console.log('dry-run');",
    "  console.log('destination: ' + destination);",
    "  console.log('action: plan');",
    "  console.log('command: ' + command.join(' '));",
    '  process.exit(0);',
    '}',
    "if (!manifest.files.some((file) => file.name === 'cli/index.mjs')) throw new Error('The payload has no setup command.');",
    'const nonce = randomBytes(4).toString(\'hex\');',
    "const stage = path.join(cosmic, 'hivem1nd-kit.3.0.0.' + nonce + '.stage');",
    'let backup = null;',
    'let moved = false;',
    'let created = false;',
    'try {',
    '  await mkdir(cosmic, { recursive: true });',
    '  await assertNoAncestorLink(stage, localAppData);',
    '  await mkdir(stage);',
    '  created = true;',
    '  const stageReal = await realpath(stage);',
    '  for (const file of manifest.files) {',
    "    if (file.name === 'manifest.json' || file.name === 'installer.mjs' || file.name === 'install.cmd') continue;",
    '    const target = path.resolve(stageReal, file.name);',
    '    const relative = path.relative(stageReal, target);',
    "    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Refusing a path outside the install root.');",
    '    await mkdir(path.dirname(target), { recursive: true });',
    '    await writeFile(target, await readFile(path.join(here, file.name)));',
    '  }',
    '  let existing = null;',
    '  try {',
    '    existing = await lstat(destination);',
    '  } catch (error) {',
    "    if (error?.code !== 'ENOENT') throw error;",
    '  }',
    "  if (existing?.isSymbolicLink()) throw new Error('Refusing to activate over a link.');",
    '  if (existing) {',
    "    backup = path.join(cosmic, 'hivem1nd-kit.' + nonce + '.backup');",
    '    await rename(destination, backup);',
    '    moved = true;',
    '  }',
    '  await rename(stage, destination);',
    '  created = false;',
    '  try {',
    '    const runner = process.env.HIVEM1ND_REGISTRATION_RUNNER;',
    "    const executable = runner ? process.execPath : path.join(destination, 'runtime', 'node.exe');",
    '    const args = runner ? [runner, ...command] : command;',
    "    const child = spawn(executable, args, { shell: false, windowsHide: true, cwd: destination, stdio: 'inherit' });",
    '    const status = await new Promise((resolve, reject) => {',
    "      child.once('error', reject);",
    "      child.once('exit', (code) => resolve(code ?? 1));",
    '    });',
    "    if (status !== 0) throw new Error('Setup did not finish.');",
    '  } catch (error) {',
    "    const failed = path.join(cosmic, 'hivem1nd-kit.' + nonce + '.failed');",
    '    await rename(destination, failed).catch(() => {});',
    '    if (moved && backup) await rename(backup, destination).catch(() => {});',
    '    await rm(failed, { recursive: true, force: true }).catch(() => {});',
    '    throw error;',
    '  }',
    "  console.log('installed: ' + destination);",
    '} catch (error) {',
    '  if (moved && backup) {',
    '    const occupying = await lstat(destination).catch(() => null);',
    '    if (!occupying) await rename(backup, destination).catch(() => {});',
    '  }',
    '  throw error;',
    '} finally {',
    '  if (created) await rm(stage, { recursive: true, force: true }).catch(() => {});',
    '}',
    '',
    'async function assertNoAncestorLink(target, stop) {',
    '  let current = path.resolve(target);',
    '  const base = path.resolve(stop);',
    '  while (true) {',
    '    try {',
    '      const state = await lstat(current);',
    "      if (state.isSymbolicLink()) throw new Error('Refusing to follow a link.');",
    '    } catch (error) {',
    "      if (error?.code !== 'ENOENT') throw error;",
    '    }',
    '    if (current === base) return;',
    '    const parent = path.dirname(current);',
    "    if (parent === current) throw new Error('Refusing to leave the install root.');",
    '    current = parent;',
    '  }',
    '}',
    '',
  ].join('\n');
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

export function browserReferences(text) {
  const names = [];
  const add = (raw) => {
    if (typeof raw !== 'string') return;
    const clean = raw.split('#')[0].split('?')[0].trim();
    if (!clean || clean.startsWith('#') || clean.startsWith('data:') || clean.startsWith('http:') || clean.startsWith('https:') || clean.startsWith('mailto:') || clean.startsWith('/')) return;
    const name = clean.replace(/^\.\//, '');
    if (!name || name.includes('..') || name.includes('\\') || name.includes('/')) return;
    names.push(name);
  };
  for (const match of text.matchAll(/(?:from\s+|import\s+)['"](\.[^'"]+)['"]/g)) add(match[1]);
  for (const match of text.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) add(match[1]);
  for (const match of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) add(match[1]);
  return names;
}

export async function referencedBrowserFiles(assetDir) {
  const pending = ['index.html', 'styles.css', 'main.mjs'];
  const seen = new Set();
  while (pending.length > 0) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    let text;
    try {
      text = await readFile(path.join(assetDir, name), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT' && Object.hasOwn(EMBEDDED_BROWSER_FILES, name)) continue;
      if (error?.code === 'ENOENT') throw new Error(`Release packaging needs browser asset ${name}.`);
      throw error;
    }
    for (const ref of browserReferences(text)) {
      if (!seen.has(ref)) pending.push(ref);
    }
  }
  return [...seen];
}

export async function assertReleaseAssets(assetDir) {
  const referenced = await referencedBrowserFiles(assetDir);
  const required = new Set([...BROWSER_ASSETS, ...referenced]);
  for (const name of required) {
    if (!BROWSER_ASSETS.includes(name)) throw new Error(`Release packaging needs browser asset ${name}.`);
    if (Object.hasOwn(EMBEDDED_BROWSER_FILES, name)) continue;
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
      if (files.some((file) => file.name === payloadName)) continue;
      if (Object.hasOwn(EMBEDDED_BROWSER_FILES, name)) {
        const disk = path.join(assetDir, name);
        const data = await readFile(disk).catch((error) => {
          if (error?.code === 'ENOENT') return Buffer.from(EMBEDDED_BROWSER_FILES[name]);
          throw error;
        });
        files.push({ name: payloadName, data });
        continue;
      }
      files.push({ name: payloadName, data: await readFile(path.join(assetDir, name)) });
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

export function assertActiveIdentity(active, identity) {
  if (!active) return;
  const current = canonicalInstallIdentity(active, { requireProcess: true });
  const intended = canonicalInstallIdentity(identity, { requireProcess: false });
  if (!current || !intended || current.mindPath !== intended.mindPath || current.machine !== intended.machine || current.localDirectory !== intended.localDirectory) {
    throw Object.assign(new Error('The active mind or service does not match this payload.'), { code: 'identity_mismatch' });
  }
}

function canonicalInstallIdentity(value, { requireProcess }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const mindPath = normalizeInstallPath(value.mindPath);
  const localDirectory = normalizeInstallPath(value.localDirectory);
  const machine = typeof value.machine === 'string' ? value.machine.trim() : '';
  if (!mindPath || !localDirectory || !machine) return null;
  if (requireProcess) {
    const started = typeof value.startedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.startedAt);
    if (!started || !Number.isInteger(value.pid) || value.pid <= 0) return null;
  }
  return { mindPath, machine, localDirectory };
}

function normalizeInstallPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return null;
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export async function installPayload(options) {
  if (options.dryRun !== false) return { dryRun: true, activated: false };
  const rootDir = path.resolve(options.root ?? path.dirname(path.resolve(options.destination)));
  const destination = path.resolve(options.destination);
  insideRoot(rootDir, destination);
  await assertRealChain(destination, rootDir);
  if (options.manifest) hashesMatch(options.files, options.manifest);
  assertActiveIdentity(options.active, options.identity);
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
