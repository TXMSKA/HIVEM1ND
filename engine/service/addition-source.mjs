import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { atomicWriteFile, parseFrontmatter } from '../records.mjs';
import { additionPath, interpreterRuntimes, recognizeAdditionParts, skillRuntimes } from './addition-parts.mjs';
import { checkAddition } from './addition-check.mjs';
import { CoreError, canonicalJson, hashBytes, isUuid } from './identity.mjs';
import { assertLocalStaging, assertNoLinks } from './paths.mjs';
import { additionSourceError, protectLocalFile } from './security.mjs';

const FILE_MAX = 16 * 1024 * 1024;
const TREE_MAX = 64 * 1024 * 1024;
const ARCHIVE_MAX = TREE_MAX + 2 * 1024 * 1024;
function fail(status, code, message) { throw new CoreError(status, code, message); }
function invalid() { fail(422, 'invalid_source', 'The source evidence is not valid.'); }
export const ACCEPTED_SOURCES = 'a GitHub or GitLab repository link with an owner and a name, an npm package link, or a dropped folder';
function invalidLink() { fail(422, 'invalid_source', `The source link is not accepted. Accepted sources are ${ACCEPTED_SOURCES}.`); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (Object.keys(value).some(key => !keys.includes(key))) fail(400, 'unknown_field', 'The source contains an unknown field.');
  if (keys.some(key => !Object.hasOwn(value, key))) invalid();
}

export function validateAdditionSource(source) {
  if (source?.kind === 'folder') {
    exact(source, ['kind', 'uploadId']);
    if (!isUuid(source.uploadId)) invalid();
  } else {
    exact(source, ['kind', 'url']);
    if (!['link', 'git', 'registry'].includes(source.kind)) invalid();
    publicUrl(source.url);
    provider(source);
  }
  return source;
}

export function additionSourceIdentity(source) {
  validateAdditionSource(source);
  if (source.kind === 'folder') return null;
  const { kind, display, url } = provider(source);
  return { kind, display, url };
}

function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { invalidLink(); }
  if (typeof value !== 'string' || value.length > 2048 || url.protocol !== 'https:' || url.username || url.password
    || url.search || url.hash || url.port && url.port !== '443' || /[\x00-\x20\\]/.test(value)) invalidLink();
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !publicAddress(url.hostname.replace(/^\[|\]$/g, ''))) invalidLink();
  return url;
}

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 168 || b === 0 || b === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51)
      || a === 203 && b === 0);
  }
  // Only global unicast IPv6 is accepted; mapped and transition addresses fail closed.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^200[12]:|^2001:db8:/i.test(address);
}

function provider(source) {
  const url = publicUrl(source.url);
  const parts = url.pathname.split('/').filter(Boolean).map(value => {
    let part; try { part = decodeURIComponent(value); } catch { invalidLink(); }
    if (!/^[A-Za-z0-9@._~-]+$/.test(part) || part === '.' || part === '..') invalidLink();
    return part;
  });
  if (['github.com', 'gitlab.com'].includes(url.hostname) && source.kind !== 'registry') {
    if (parts.length < 2 || parts.length > 4 || parts.length > 2 && !['tree', 'commit'].includes(parts[2]) || parts.length === 3) invalidLink();
    const project = parts.slice(0, 2).join('/').replace(/\.git$/, '');
    return { kind: 'git', host: url.hostname, project, ref: parts[3] ?? 'HEAD', name: project.split('/').at(-1), display: project,
      url: `https://${url.hostname}/${project}` };
  }
  if (['www.npmjs.com', 'npmjs.com', 'registry.npmjs.org'].includes(url.hostname) && source.kind !== 'git') {
    if (url.hostname !== 'registry.npmjs.org' && parts.shift() !== 'package') invalidLink();
    const scoped = parts[0]?.startsWith('@');
    const packageName = parts.splice(0, scoped ? 2 : 1).join('/');
    if (!/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(packageName)) invalidLink();
    if (parts[0] === 'v') parts.shift();
    if (parts.length > 1) invalidLink();
    return { kind: 'registry', packageName, ref: parts[0] ?? 'latest', name: packageName.split('/').at(-1), display: packageName,
      url: `https://www.npmjs.com/package/${packageName}` };
  }
  invalidLink();
}

async function fetchBytes(context, value, signal, redirects = 0) {
  signal.throwIfAborted();
  const url = publicUrl(value);
  const addresses = await (context.additionLookup ?? lookup)(url.hostname, { all: true, verbatim: true });
  signal.throwIfAborted();
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(item => !publicAddress(item.address))) invalid();
  const transport = context.additionTransport ?? httpsBytes;
  const response = await transport(url, { signal, addresses, maxBytes: ARCHIVE_MAX, redirect: 'manual' });
  signal.throwIfAborted();
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= 3 || ++context.additionRedirects.count > 3 || typeof response.headers?.location !== 'string') invalid();
    return fetchBytes(context, new URL(response.headers.location, url).href, signal, redirects + 1);
  }
  if (response.status !== 200) fail(503, 'source_unavailable', 'The public source could not be read.');
  if (!Buffer.isBuffer(response.bytes) || response.bytes.length > ARCHIVE_MAX) fail(413, 'addition_too_large', 'The source archive is too large.');
  return response.bytes;
}

function httpsBytes(url, { signal, addresses, maxBytes }) {
  return new Promise((resolve, reject) => {
    const req = request(url, { signal, headers: { 'user-agent': 'HIVEM1ND/3.0', accept: 'application/json, application/octet-stream', 'accept-encoding': 'identity' },
      lookup: (_hostname, options, callback) => callback(null, options.all ? addresses : addresses[0].address, addresses[0].family) }, res => {
      const chunks = []; let count = 0;
      res.on('data', bytes => {
        count += bytes.length;
        if (count > maxBytes) req.destroy(new CoreError(413, 'addition_too_large', 'The source archive is too large.'));
        else chunks.push(bytes);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function metadata(context, url, signal) {
  const bytes = await fetchBytes(context, url, signal);
  if (bytes.length > 2 * 1024 * 1024) invalid();
  try {
    const value = JSON.parse(bytes);
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    return value;
  } catch { invalid(); }
}

function gitOptions(context, signal, cwd) {
  const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, 'absent-config'), GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: '', GIT_CEILING_DIRECTORIES: cwd, HOME: cwd, USERPROFILE: cwd, XDG_CONFIG_HOME: cwd, TMPDIR: cwd, TEMP: cwd, TMP: cwd };
  const systemRoot = context.additionSystemRoot ?? process.env.SystemRoot;
  if (process.platform === 'win32' && systemRoot) env.SystemRoot = systemRoot;
  return { signal, cwd, env, shell: false, windowsHide: true, timeout: 30000, maxBytes: ARCHIVE_MAX };
}

function runGit(command, args, options, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    const chunks = []; let count = 0;
    const timer = setTimeout(() => child.kill(), options.timeout);
    child.stdout.on('data', bytes => { count += bytes.length; if (count > 256) child.kill(); else chunks.push(bytes); });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); if (code === 0 && count <= 256) resolve(Buffer.concat(chunks)); else reject(new Error('Git evidence unavailable')); });
    child.stdin.end(input);
  });
}

async function resolveRemote(context, source, fixedPin, signal, directory, resolved, expectedIntegrity) {
  const item = provider(source);
  let archiveUrl, archiveDigest = null, publishedAt, pin, integrity = null;
  if (item.kind === 'registry') {
    const data = await metadata(context, `https://registry.npmjs.org/${item.packageName.replace('/', '%2f')}`, signal);
    const version = fixedPin?.value ?? data['dist-tags']?.[item.ref] ?? item.ref;
    if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)) invalid();
    const release = data.versions?.[version];
    if (release?.name !== item.packageName || release?.version !== version) invalid();
    integrity = release.dist?.integrity;
    if (expectedIntegrity && expectedIntegrity !== integrity) fail(409, 'source_changed', 'The pinned release archive changed.');
    if (typeof integrity !== 'string' || !/^sha(?:256|512)-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) invalid();
    const [algorithm, encoded] = integrity.split('-');
    const expected = Buffer.from(encoded, 'base64');
    if (expected.toString('base64') !== encoded || expected.length !== (algorithm === 'sha512' ? 64 : 32)) invalid();
    archiveDigest = { algorithm, expected };
    archiveUrl = release.dist.tarball;
    publishedAt = credibleDate(data.time?.[version]);
    pin = { kind: 'version', value: version, digest: fixedPin?.digest ?? null };
  } else {
    const ref = fixedPin?.value ?? item.ref;
    const base = item.host === 'github.com' ? `https://api.github.com/repos/${item.project}` : `https://gitlab.com/api/v4/projects/${encodeURIComponent(item.project)}/repository`;
    const commit = await metadata(context, `${base}/commits/${encodeURIComponent(ref)}`, signal);
    const value = commit.sha ?? commit.id;
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value ?? '') || fixedPin && value !== fixedPin.value) invalid();
    publishedAt = credibleDate(commit.commit?.committer?.date ?? commit.committed_date);
    pin = { kind: 'commit', value, digest: fixedPin?.digest ?? null };
    archiveUrl = item.host === 'github.com' ? `https://api.github.com/repos/${item.project}/tarball/${value}`
      : `https://gitlab.com/${item.project}/-/archive/${value}/${item.name}-${value}.tar.gz`;
  }
  await resolved({ pin, source: item, publishedAt, integrity });
  const archive = await fetchBytes(context, archiveUrl, signal);
  if (archiveDigest && !createHash(archiveDigest.algorithm).update(archive).digest().equals(archiveDigest.expected)) invalid();
  if (item.kind === 'git') {
    // Providers supply immutable HTTPS archives. Git only verifies a local blob, never resolves a remote or loads source configuration.
    const args = ['-c', 'core.hooksPath=', '-c', 'credential.helper=', '-c', 'submodule.recurse=false', '-c', 'protocol.allow=never',
      '-c', 'core.attributesFile=', '-c', 'filter.lfs.required=false', 'hash-object', '--stdin', '--no-filters'];
    const result = await (context.additionRunner ?? runGit)(context.additionGitCommand ?? 'git', args, gitOptions(context, signal, directory), archive);
    signal.throwIfAborted();
    const expected = createHash('sha1').update(`blob ${archive.length}\0`).update(archive).digest('hex');
    if (String(result).trim() !== expected) invalid();
  }
  return { ...item, publishedAt, pin, archiveHash: hashBytes(archive), entries: archiveEntries(archive) };
}

function credibleDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function archiveEntries(archive) {
  let tar;
  try { tar = gunzipSync(archive, { maxOutputLength: ARCHIVE_MAX }); } catch { invalid(); }
  const entries = []; let offset = 0, ended = false, pax = null, longName = null;
  const string = bytes => bytes.toString('utf8').split('\0')[0];
  const octal = bytes => { const value = string(bytes).trim(); if (!/^[0-7]+$/.test(value)) invalid(); return parseInt(value, 8); };
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) {
      if (offset + 512 > tar.length || !tar.subarray(offset).every(byte => byte === 0)) invalid();
      ended = true; break;
    }
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (octal(header.subarray(148, 156)) !== checksum) invalid();
    const size = octal(header.subarray(124, 136));
    if (size > FILE_MAX) fail(413, 'addition_too_large', 'A source file is too large.');
    if (offset + Math.ceil(size / 512) * 512 > tar.length) invalid();
    const data = tar.subarray(offset, offset + size); offset += Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(header[156] || 48);
    let name = string(header.subarray(0, 100));
    const prefix = string(header.subarray(345, 500));
    if (prefix) name = `${prefix}/${name}`;
    if (type === 'x' || type === 'g') {
      const values = {}; let cursor = 0;
      while (cursor < data.length) {
        const space = data.indexOf(32, cursor); if (space < 0) invalid();
        const length = Number(data.subarray(cursor, space).toString());
        if (!Number.isInteger(length) || length <= space - cursor + 1 || cursor + length > data.length || data[cursor + length - 1] !== 10) invalid();
        const entry = data.subarray(space + 1, cursor + length - 1).toString('utf8');
        const equal = entry.indexOf('='); if (equal < 1) invalid();
        const key = entry.slice(0, equal); if (!['path', 'mtime', 'atime', 'ctime', 'comment'].includes(key)) invalid();
        values[key] = entry.slice(equal + 1); cursor += length;
      }
      if (type === 'g' && values.path) invalid();
      if (type === 'x') pax = values;
      continue;
    }
    if (type === 'L') { if (longName !== null) invalid(); longName = string(data).replace(/\n$/, ''); continue; }
    name = pax?.path ?? longName ?? name; pax = null; longName = null;
    if (!['0', '5'].includes(type) || string(header.subarray(157, 257))) invalid();
    if (type === '5') { if (size !== 0) invalid(); name = name.replace(/\/$/, ''); }
    additionPath(name);
    entries.push({ path: name, kind: type === '5' ? 'directory' : 'file', data });
    if (entries.length > 2048) fail(413, 'addition_too_large', 'The source has too many entries.');
  }
  if (!ended || pax !== null || longName !== null) invalid();
  const root = entries[0]?.path.split('/')[0];
  if (!root || entries.some(entry => entry.path !== root && !entry.path.startsWith(`${root}/`)) || entries.some(entry => entry.path === root && entry.kind !== 'directory')) invalid();
  return entries.filter(entry => entry.path !== root).map(entry => ({ ...entry, path: entry.path.slice(root.length + 1) }));
}

function inventory(entries) {
  const names = new Map(), spelling = new Map(); let total = 0, count = 0;
  for (const entry of entries) {
    additionPath(entry.path);
    const key = entry.path.toLowerCase();
    if (names.has(key) || !['file', 'directory'].includes(entry.kind)) fail(422, 'invalid_path', 'The source contains colliding or nonregular paths.');
    names.set(key, entry.kind);
    const parts = entry.path.split('/');
    for (let index = 1; index <= parts.length; index++) {
      const prefix = parts.slice(0, index).join('/'), lower = prefix.toLowerCase();
      if (spelling.has(lower) && spelling.get(lower) !== prefix) fail(422, 'invalid_path', 'The source contains colliding paths.');
      spelling.set(lower, prefix);
    }
    if (entry.kind === 'file') {
      if (!Buffer.isBuffer(entry.data)) invalid();
      if (entry.data.length > FILE_MAX || ++count > 1024 || (total += entry.data.length) > TREE_MAX) fail(413, 'addition_too_large', 'The source exceeds its file limits.');
    }
  }
  for (const entry of entries) {
    const parts = entry.path.toLowerCase().split('/'); parts.pop();
    while (parts.length) { if (names.get(parts.join('/')) === 'file') fail(422, 'invalid_path', 'A source file collides with a directory.'); parts.pop(); }
  }
  return entries.filter(entry => entry.kind === 'file').map(entry => {
    let text = null;
    // Binary support files are retained, but only recognized declarative text is decoded.
    if (/\.(?:md|txt|rst|json|toml|yaml|yml)$/i.test(entry.path) || /(?:^|\/)(?:LICENSE|LICENCE|COPYING|NOTICE)(?:\.[^/]*)?$/i.test(entry.path)) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(entry.data); } catch { /* Binary data remains opaque. */ }
      if (text !== null && Buffer.byteLength(text) !== entry.data.length) text = null;
    }
    return { path: entry.path, kind: 'file', bytes: entry.data.length, text, hash: hashBytes(entry.data) };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

function packageAt(files, root) {
  const file = files.find(item => item.path === (root === '.' ? 'package.json' : `${root}/package.json`));
  if (!file) return null;
  try { const value = JSON.parse(file.text); if (!value || Array.isArray(value) || typeof value !== 'object') invalid(); return value; } catch { invalid(); }
}

function evidenceFor(candidate, files, acquisition) {
  const within = (file, root) => root === '.' || file.path.startsWith(`${root}/`);
  let root = candidate.path, license = null, licenseFile = null;
  while (true) {
    const manifest = packageAt(files, root);
    const declared = manifest?.license;
    if (declared !== undefined && (typeof declared !== 'string' || !/^[A-Za-z0-9 ().+\-]{1,128}$/.test(declared))) invalid();
    const file = files.find(item => path.posix.dirname(item.path) === root && /^(?:LICENSE|LICENCE|COPYING)(?:\.[^/]*)?$/i.test(path.posix.basename(item.path)));
    if (declared || file) {
      license = /^UNLICENSED$/i.test(declared ?? '') ? null : declared ?? file?.text?.match(/SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)/)?.[1]
        ?? (file?.text && /MIT License|Permission is hereby granted, free of charge/.test(file.text) ? 'MIT' : null);
      licenseFile = file ? { path: file.path, hash: file.hash } : null;
      break;
    }
    if (root === '.') break;
    root = path.posix.dirname(root);
  }
  const requirements = new Set(candidate.requirements);
  let runtimeVerified = candidate.kind === 'docs', unknownRuntime = false;
  const selected = files.filter(file => within(file, candidate.path));
  const manifests = files.filter(file => path.posix.basename(file.path) === 'package.json'
    && (within(file, candidate.path) || within({ path: candidate.path }, path.posix.dirname(file.path))));
  for (const file of manifests) {
    const manifest = packageAt(files, path.posix.dirname(file.path));
    runtimeVerified = true;
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'engines', 'scripts']) {
      if (manifest[field] !== undefined && (!manifest[field] || typeof manifest[field] !== 'object' || Array.isArray(manifest[field])
        || Object.values(manifest[field]).some(value => typeof value !== 'string'))) runtimeVerified = false;
    }
    if (manifest.engines?.node !== undefined) {
      if (!/^[0-9A-Za-z .<>=|^~*+\-]{1,100}$/.test(manifest.engines.node)) runtimeVerified = false;
      else requirements.add(`Node.js ${manifest.engines.node}`);
    }
    if (manifest.engines && Object.keys(manifest.engines).some(key => !['node', 'npm'].includes(key))) runtimeVerified = false;
    if (['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(field => Object.keys(manifest[field] ?? {}).length)) requirements.add('Node.js');
    for (const field of ['main', 'module', 'bin']) {
      const entries = typeof manifest[field] === 'string' ? [manifest[field]] : field === 'bin' && manifest[field] && typeof manifest[field] === 'object' ? Object.values(manifest[field]) : [];
      if (manifest[field] != null && !entries.length) runtimeVerified = false;
      for (const entry of entries) {
        if (typeof entry !== 'string') { runtimeVerified = false; continue; }
        const local = entry.replace(/^\.\//, '');
        try { additionPath(local); } catch { runtimeVerified = false; continue; }
        const target = path.posix.dirname(file.path) === '.' ? local : `${path.posix.dirname(file.path)}/${local}`;
        if (!files.some(item => item.path === target)) runtimeVerified = false;
        if (/\.(?:js|mjs|cjs)$/.test(local)) requirements.add('Node.js');
        else if (/\.py$/.test(local)) requirements.add('Python');
        else runtimeVerified = false;
      }
    }
    for (const script of Object.values(manifest.scripts ?? {})) {
      if (typeof script !== 'string') { runtimeVerified = false; continue; }
      const commands = script.split(/&&|\|\||[;|]/).map(command => command.trim().split(/\s+/)[0]);
      for (const command of commands) {
        const runtime = Object.hasOwn(interpreterRuntimes, command) ? interpreterRuntimes[command] : null;
        if (runtime) requirements.add(runtime); else runtimeVerified = false;
      }
    }
    if (!runtimeVerified) unknownRuntime = true;
  }
  const skill = selected.find(file => file.path === (candidate.path === '.' ? 'SKILL.md' : `${candidate.path}/SKILL.md`));
  if (skill) {
    const runtime = parseFrontmatter(skill.text).attributes.runtime;
    if (runtime !== undefined) {
      const names = String(runtime).replace(/^["']|["']$/g, '').split(',').map(name => name.trim().toLowerCase());
      if (names.every(name => Object.hasOwn(skillRuntimes, name))) {
        runtimeVerified = true;
        for (const name of names.filter(name => name !== 'none')) requirements.add(skillRuntimes[name]);
      } else runtimeVerified = false;
    }
  }
  if (selected.some(file => !/\.(?:md|txt|rst|html|pdf|docx|json|toml|yaml|yml|png|jpg|jpeg|gif|webp|svg|js|mjs|cjs|py|sh|ps1)$/i.test(file.path)
    && !/^(?:LICENSE|LICENCE|NOTICE|COPYING)(?:\.[^/]*)?$/i.test(path.posix.basename(file.path)))) runtimeVerified = false;
  if (requirements.has('Native executable') || selected.some(file => /(?:^|\/)(?:pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod)$/i.test(file.path))) runtimeVerified = false;
  if (unknownRuntime) runtimeVerified = false;
  candidate.requirements = [...requirements].sort();
  return { pin: acquisition.pin, pinVerified: true, license, licenseFile, publishedAt: acquisition.publishedAt, runtimeVerified, noInstallScripts: true };
}

export async function additionStagingRoot(context, { create = true } = {}) {
  const root = path.join(context.paths.localDirectory, 'additions');
  await assertLocalStaging(root, { platform: context.paths.platform, origin: context.paths.origin, syncedRoots: [context.paths.mind], env: context.env ?? process.env });
  await assertNoLinks(root, { root: context.paths.localDirectory });
  if (create) {
    await mkdir(root, { recursive: true });
    await (context.protectLocalFile ?? protectLocalFile)(root, { store: context.store });
  }
  return root;
}

export async function writeAdditionLocal(context, file, bytes) {
  const root = await additionStagingRoot(context);
  await assertNoLinks(file, { root });
  await atomicWriteFile(file, bytes, { root });
  await (context.protectLocalFile ?? protectLocalFile)(file, { store: context.store });
}

export async function receiveAdditionChunk(context, upload, input) {
  exact(input, ['path', 'index', 'total', 'base64']);
  additionPath(input.path);
  if (!Number.isInteger(input.index) || !Number.isInteger(input.total) || input.total < 1 || input.total > 256 || input.index < 0 || input.index >= input.total
    || typeof input.base64 !== 'string' || input.base64.length > 87384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) invalid();
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.length > 65536) fail(413, 'addition_too_large', 'The uploaded chunk is too large.');
  if (input.index < input.total - 1 && bytes.length !== 65536) invalid();
  upload.files ??= {};
  const key = hashBytes(Buffer.from(input.path.toLowerCase()));
  const prior = upload.files[key];
  if (prior && (prior.path !== input.path || prior.total !== input.total)) fail(409, 'source_changed', 'The upload contains conflicting chunks.');
  const hash = hashBytes(bytes);
  if (prior?.chunks[input.index] && prior.chunks[input.index].hash !== hash) fail(409, 'source_changed', 'The upload contains conflicting chunks.');
  const record = structuredClone(prior ?? { path: input.path, total: input.total, chunks: {} });
  record.chunks[input.index] = { hash, bytes: bytes.length };
  const files = { ...upload.files, [key]: record };
  inventory(Object.values(files).map(file => ({ path: file.path, kind: 'file', data: Buffer.alloc(0) })));
  const size = Object.values(files).reduce((total, file) => total + Object.values(file.chunks).reduce((sum, chunk) => sum + chunk.bytes, 0), 0);
  if (size > TREE_MAX) fail(413, 'addition_too_large', 'The uploaded source is too large.');
  const root = await additionStagingRoot(context);
  await writeAdditionLocal(context, path.join(root, 'uploads', upload.id, 'chunks', key, String(input.index)), bytes);
  upload.files = files;
  return { uploadId: upload.id, path: input.path, index: input.index };
}

async function uploadedEntries(context, upload, signal) {
  const root = await additionStagingRoot(context), entries = [];
  for (const [key, file] of Object.entries(upload.files ?? {})) {
    if (Object.keys(file.chunks).length !== file.total) fail(409, 'source_changed', 'The folder upload is incomplete.');
    const chunks = [];
    for (let index = 0; index < file.total; index++) {
      signal.throwIfAborted();
      const target = path.join(root, 'uploads', upload.id, 'chunks', key, String(index));
      await assertNoLinks(target, { root });
      const info = await lstat(target); if (!info.isFile() || info.nlink !== 1 || info.size > 65536) invalid();
      const bytes = await readFile(target);
      if (hashBytes(bytes) !== file.chunks[index]?.hash) fail(409, 'source_changed', 'The uploaded bytes changed.');
      chunks.push(bytes);
    }
    entries.push({ path: file.path, kind: 'file', data: Buffer.concat(chunks) });
  }
  return entries;
}

export async function acquireAdditionSource(context, input) {
  context = { ...context, additionRedirects: { count: 0 } };
  validateAdditionSource(input.source);
  const controller = new AbortController();
  const onAbort = () => controller.abort(input.signal.reason);
  input.signal?.addEventListener('abort', onAbort, { once: true });
  if (input.signal?.aborted) onAbort();
  const schedule = context.additionSchedule ?? setTimeout, cancel = context.additionClearTimeout ?? clearTimeout;
  let timer;
  const deadline = new Promise((_, reject) => { timer = schedule(() => {
    const error = new CoreError(503, 'source_timeout', 'The source did not answer in 30 seconds.');
    controller.abort(error); reject(error);
  }, 30000); timer?.unref?.(); });
  let directory;
  const work = async () => {
    const signal = controller.signal;
    signal.throwIfAborted();
    const root = await additionStagingRoot(context);
    if (!isUuid(input.id)) invalid();
    if (input.operationId && !isUuid(input.operationId)) invalid();
    directory = input.operationId ? path.join(root, 'sources', input.id, input.operationId) : path.join(root, 'sources', input.id);
    await assertNoLinks(directory, { root }); await mkdir(directory, { recursive: true });
    await (context.protectLocalFile ?? protectLocalFile)(directory, { store: context.store });
    let acquisition;
    if (input.source.kind === 'folder') {
      const entries = await uploadedEntries(context, input.upload, signal);
      acquisition = { kind: 'folder', url: null, display: input.upload.name, name: input.upload.name, publishedAt: null, entries };
    } else acquisition = await resolveRemote(context, input.source, input.pin ?? null, signal, directory, input.onResolved ?? (() => {}), input.integrity ?? null);
    signal.throwIfAborted();
    const files = inventory(acquisition.entries);
    if (acquisition.kind === 'registry') {
      const manifest = packageAt(files, '.');
      if (manifest?.name !== acquisition.packageName || manifest?.version !== acquisition.pin.value) invalid();
    }
    const digest = hashBytes(Buffer.from(canonicalJson(files.map(({ path, bytes, hash }) => ({ path, bytes, hash })))));
    if (acquisition.kind === 'folder') acquisition.pin = { kind: 'snapshot', value: digest, digest };
    else acquisition.pin.digest = acquisition.kind === 'registry' ? acquisition.archiveHash : digest;
    if (input.pin?.digest && acquisition.pin.digest !== input.pin.digest) fail(409, 'source_changed', 'The pinned source bytes changed.');
    const candidates = recognizeAdditionParts(files, { repository: acquisition.kind === 'git', name: acquisition.name });
    const evidence = {};
    for (const candidate of candidates) { evidence[candidate.id] = evidenceFor(candidate, files, acquisition); candidate.check = checkAddition(candidate, evidence[candidate.id], context.now()); }
    for (const file of acquisition.entries.filter(entry => entry.kind === 'file')) {
      signal.throwIfAborted();
      additionPath(file.path);
      await writeAdditionLocal(context, path.join(directory, 'tree', ...file.path.split('/')), file.data);
      signal.throwIfAborted();
    }
    const result = { source: { kind: acquisition.kind, display: acquisition.display, url: acquisition.url }, pin: acquisition.pin,
      manifestHash: digest, publishedAt: acquisition.publishedAt, files: files.map(({ text, ...file }) => file), candidates, evidence, directory };
    const manifest = { ...result }; delete manifest.directory;
    await writeAdditionLocal(context, path.join(directory, 'manifest.json'), Buffer.from(canonicalJson(manifest)));
    signal.throwIfAborted();
    return result;
  };
  let result;
  const running = work();
  running.catch(() => {});
  const aborted = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    if (controller.signal.aborted) reject(controller.signal.reason);
  });
  try { result = await Promise.race([running, deadline, aborted]); return result; }
  catch (error) {
    controller.abort(error);
    throw additionSourceError(error);
  } finally {
    cancel(timer);
    input.signal?.removeEventListener('abort', onAbort);
    if (!result && directory) await disposeAdditionSource(context, input.id, 'sources', input.operationId);
    // A timed-out transport cannot publish, even if an injected transport resolves late.
    if (!result) running.finally(async () => { if (directory) await disposeAdditionSource(context, input.id, 'sources', input.operationId); }).catch(() => {});
  }
}

export async function disposeAdditionSource(context, id, kind = 'sources', operationId = null) {
  if (!isUuid(id) || !['sources', 'uploads'].includes(kind)) invalid();
  if (operationId && !isUuid(operationId)) invalid();
  const root = await additionStagingRoot(context, { create: false }), target = operationId ? path.join(root, kind, id, operationId) : path.join(root, kind, id);
  await assertNoLinks(target, { root });
  await rm(target, { recursive: true, force: true });
}
