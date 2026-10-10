import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export const NODE_ZIP_NAME = 'node-v22.23.3-win-x64.zip';
export const NODE_ZIP_SHA256 = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71';
export const NODE_EXE_SHA256 = '9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e';
export const BROWSER_ASSETS = Object.freeze(['index.html', 'styles.css', 'app.js']);

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
  for (const part of name.split('/')) {
    if (part === '' || part === '.' || part === '..') {
      throw Object.assign(new Error('The archive name leaves its root.'), { code: 'zip_rejected' });
    }
  }
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
    const stored = method === 8 ? deflateRawSync(data) : data;
    assertZipBounds({ count: files.length, offset: 0, size: stored.length });
    return { name: file.name, data, stored, method, crc: crc32(data) };
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
    header.writeUInt16LE(0, 28);
    locals.push({ offset, bytes: Buffer.concat([header, name, entry.stored]) });
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
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    header.writeUInt32LE(local.offset, 42);
    centrals.push(Buffer.concat([header, name]));
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
    const localOffset = zip.readUInt32LE(cursor + 42);
    if (extraLength !== 0 || commentLength !== 0 || compressed === ZIP32 || uncompressed === ZIP32) {
      throw Object.assign(new Error('ZIP64, encryption, and extra fields are rejected.'), { code: 'zip_rejected' });
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0008) !== 0) {
      throw Object.assign(new Error('Encrypted or descriptor entries are rejected.'), { code: 'zip_rejected' });
    }
    if (method !== 0 && method !== 8) throw Object.assign(new Error('The compression method is not accepted.'), { code: 'zip_rejected' });
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    rejectName(name);
    if (names.has(name)) throw Object.assign(new Error('The archive repeats a name.'), { code: 'zip_rejected' });
    names.add(name);
    const cap = options.maxOutput ?? 64_000_000;
    if (uncompressed > cap || compressed > cap) throw Object.assign(new Error('The entry is larger than the output cap.'), { code: 'zip_rejected' });
    if (localOffset + 30 + nameLength + compressed > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw Object.assign(new Error('The local header offset is not accepted.'), { code: 'zip_rejected' });
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const stored = zip.subarray(localOffset + 30 + localNameLength, localOffset + 30 + localNameLength + compressed);
    const data = method === 8 ? inflateRawSync(stored, { maxOutputLength: cap }) : stored;
    if (data.length !== uncompressed) throw Object.assign(new Error('The expanded size does not match.'), { code: 'zip_rejected' });
    if (crc32(data) !== crc) throw Object.assign(new Error('The entry checksum does not match.'), { code: 'zip_rejected' });
    entries.push({ name, data, crc });
    cursor += 46 + nameLength;
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

export async function verifyRuntime(zipPath) {
  if (!zipPath) throw Object.assign(new Error(`Pass --node-zip <absolute-file> pointing at ${NODE_ZIP_NAME}. The build does not download it.`), { code: 'missing_runtime' });
  const bytes = await readFile(zipPath);
  const digest = sha256(bytes);
  if (digest !== NODE_ZIP_SHA256) {
    throw Object.assign(new Error('The pinned Node archive digest does not match. No download was performed.'), { code: 'runtime_digest' });
  }
  const entries = readArchive(bytes);
  const executable = entries.find((entry) => entry.name.endsWith('/node.exe'));
  const license = entries.find((entry) => entry.name.endsWith('/LICENSE'));
  if (!executable || sha256(executable.data) !== NODE_EXE_SHA256) {
    throw Object.assign(new Error('The extracted Node executable digest does not match the pin.'), { code: 'runtime_digest' });
  }
  if (!license) throw Object.assign(new Error('The Node license is missing from the pinned archive.'), { code: 'runtime_digest' });
  return { digest, executable: executable.data, license: license.data, available: true };
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

export function manifestDocument(files, runtime = 'unverified') {
  return {
    format: 'hivem1nd-installer-v1',
    version: '3.0.0',
    runtime,
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
  const manifest = Buffer.from(`${JSON.stringify(manifestDocument(files, options.runtime ?? 'unverified'))}\n`);
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
  return {
    dryRun: true,
    os: false,
    osCalls: 0,
    commands: plan.commands,
    body: plan.body,
    script: installerScript(),
    browserAssets: options.browserAssets ?? 'unavailable',
    activated: false,
  };
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

export async function installPayload(options) {
  if (options.dryRun !== false) return { dryRun: true, activated: false };
  const destination = path.resolve(options.destination);
  const stage = `${destination}.stage`;
  try {
    const state = await lstat(destination);
    if (state.isSymbolicLink()) throw new Error('Refusing to activate over a link.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(stage, { recursive: true });
  for (const file of options.files ?? []) {
    rejectName(file.name);
    const target = path.join(stage, file.name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.data);
  }
  await rm(destination, { recursive: true, force: true });
  const { rename } = await import('node:fs/promises');
  await rename(stage, destination);
  return { dryRun: false, activated: true, destination };
}

export async function main(argv) {
  const input = readInputs(argv);
  if (!input.nodeZip) {
    throw new Error(`Pass --node-zip <absolute-file> pointing at ${NODE_ZIP_NAME}. The build does not download it.`);
  }
  if (input.dryRun !== true) await assertReleaseAssets(input.assetDir ?? path.join(root, 'gui', 'app'));
  await verifyRuntime(input.nodeZip);
  const artifact = build({ dryRun: input.dryRun, release: input.dryRun !== true, browserAssets: input.dryRun ? 'unavailable' : 'packaged' });
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
