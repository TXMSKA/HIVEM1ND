import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, rm, rmdir, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';

const FENCE = '```json';

export function parseFrontmatter(text) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { attributes: {}, body: normalized, rawLines: [] };
  }

  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { attributes: {}, body: normalized, rawLines: [] };
  }

  const rawLines = normalized.slice(4, end).split('\n');
  const attributes = {};
  for (const line of rawLines) {
    const separator = line.indexOf(':');
    if (separator <= 0 || /^\s/.test(line)) continue;
    attributes[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return {
    attributes,
    rawLines,
    body: normalized.slice(end + 5),
  };
}

export function serializeFrontmatter(parsed, { allowedKeys, additions = {} } = {}) {
  const permitted = allowedKeys ? new Set(allowedKeys) : null;
  const attributes = { ...parsed.attributes, ...additions };
  const emitted = new Set();
  const lines = [];

  for (const line of parsed.rawLines ?? []) {
    const separator = line.indexOf(':');
    if (separator <= 0 || /^\s/.test(line)) continue;
    const key = line.slice(0, separator).trim();
    if (permitted && !permitted.has(key)) continue;
    if (!(key in attributes) || emitted.has(key)) continue;
    lines.push(`${key}: ${attributes[key]}`);
    emitted.add(key);
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (permitted && !permitted.has(key)) continue;
    if (emitted.has(key) || value === undefined || value === null) continue;
    lines.push(`${key}: ${value}`);
    emitted.add(key);
  }

  if (lines.length === 0) return parsed.body;
  return `---\n${lines.join('\n')}\n---\n${parsed.body}`;
}

export function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

// Machines that share one mind check the kit out with different line endings, so a text file
// is the same file under either one. Binary content has no such forms and keeps its bytes.
export function hashLineEndingForms(content) {
  const text = decodeText(content);
  if (text === null) return null;
  const lf = text.replace(/\r\n/g, '\n');
  return { lf: hashContent(lf), crlf: hashContent(lf.replaceAll('\n', '\r\n')) };
}

function decodeText(content) {
  if (typeof content === 'string') return content;
  if (content.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
  } catch {
    return null;
  }
}

export function parseMachineRecord(text) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  const [header = ''] = normalized.split(/\n\n/, 1);
  const record = {
    machine: '',
    mind: '',
    language: 'en',
    updateCheck: 'off',
    lastCheck: '',
    keepExistingPreferences: true,
    setup: 1,
    agents: [],
    paths: [],
    excluded: [],
    draft: {},
    managedFiles: {},
  };

  for (const line of header.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === 'machine') record.machine = value;
    if (key === 'mind') record.mind = value;
    if (key === 'language') record.language = value === 'es' ? 'es' : 'en';
    if (key === 'update-check') record.updateCheck = value;
    if (key === 'last-check') record.lastCheck = value;
    if (key === 'preferences-first') record.keepExistingPreferences = value !== 'no';
    if (key === 'setup') record.setup = value === 'done' ? 'done' : Number(value) || 1;
  }

  record.agents = parseListSection(normalized, 'Agents').map((line) => {
    const separator = line.indexOf(':');
    return {
      name: separator === -1 ? line : line.slice(0, separator).trim(),
      mode: separator === -1 ? 'on-demand' : line.slice(separator + 1).trim(),
    };
  });
  record.paths = parseListSection(normalized, 'Paths').map((line) => {
    const separator = line.indexOf(':');
    return {
      name: separator === -1 ? line : line.slice(0, separator).trim(),
      path: separator === -1 ? '' : line.slice(separator + 1).trim(),
    };
  });
  record.excluded = parseListSection(normalized, 'Excluded');
  record.draft = parseJsonSection(normalized, 'Setup Draft', {});
  record.managedFiles = parseJsonSection(normalized, 'Managed Files', {});
  return record;
}

export function serializeMachineRecord(record) {
  const lines = [
    `machine: ${record.machine}`,
    `mind: ${record.mind}`,
    `language: ${record.language === 'es' ? 'es' : 'en'}`,
    `update-check: ${record.updateCheck || 'off'}`,
    `last-check: ${record.lastCheck || ''}`,
    `preferences-first: ${record.keepExistingPreferences === false ? 'no' : 'yes'}`,
    `setup: ${record.setup === 'done' ? 'done' : Number(record.setup) || 1}`,
    '',
    '## Agents',
    ...sortByName(record.agents ?? []).map((agent) => `- ${agent.name}: ${agent.mode}`),
    '',
    '## Paths',
    ...(record.paths ?? []).map((entry) => `- ${entry.name}: ${entry.path}`),
    '',
    '## Excluded',
    ...(record.excluded ?? []).map((item) => `- ${item}`),
  ];

  if (record.setup !== 'done' && Object.keys(record.draft ?? {}).length > 0) {
    lines.push('', '## Setup Draft', FENCE, JSON.stringify(record.draft, null, 2), '```');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// The managed map lives beside the machine file. A machine file written before that split
// still carries it in a `## Managed Files` section, which is read until the next write moves it.
export async function readManagedFiles(machineFilePath, fallback = {}) {
  const jsonPath = machineFilePath.replace(/\.md$/i, '') + '.managed.json';
  const text = await readTextIfPresent(jsonPath);
  if (text === null) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export async function readMachineRecord(mindPath, hostname) {
  const filePath = machineRecordPath(mindPath, hostname);
  try {
    const record = parseMachineRecord(await readFile(filePath, 'utf8'));
    record.managedFiles = await readManagedFiles(filePath, record.managedFiles);
    return { filePath, record };
  } catch (error) {
    if (error?.code === 'ENOENT') return { filePath, record: null };
    throw error;
  }
}

// The other machines of a mind record the kit copies they installed into it, so a file that
// matches one of those records was written by an install and is not the user's own.
export async function readPeerManagedFiles(mindPath, hostname) {
  const directory = path.dirname(machineManagedPath(mindPath, hostname));
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const own = hostname.toLowerCase();
  const peers = entries
    .filter((entry) => entry.isFile())
    .map((entry) => /^(.+)\.managed\.json$/.exec(entry.name)?.[1])
    .filter((name) => name && name.toLowerCase() !== own);
  return Promise.all(peers.map((name) => readManagedFiles(path.join(directory, `${name}.md`))));
}

export async function writeMachineRecord(mindPath, hostname, record) {
  const filePath = machineRecordPath(mindPath, hostname);
  const existing = await readTextIfPresent(filePath);
  if (existing !== null) {
    const parsed = parseMachineRecord(existing);
    if (!parsed.machine || parsed.machine !== hostname) {
      throw new Error(`Refusing to replace an unrecognized machine record: ${filePath}`);
    }
  }
  // The map goes first: a run that stops between the two writes leaves a machine file that
  // still holds the old section, and the map beside it wins when both exist.
  const managedPath = machineManagedPath(mindPath, hostname);
  const managed = record.managedFiles ?? {};
  if (Object.keys(managed).length > 0 || await readTextIfPresent(managedPath) !== null) {
    await atomicWriteFile(managedPath, `${JSON.stringify(managed, null, 2)}
`, { root: mindPath });
  }
  await atomicWriteFile(filePath, serializeMachineRecord(record), { root: mindPath });
  return filePath;
}

export function machineRecordPath(mindPath, hostname) {
  return path.join(path.resolve(mindPath), 'user', 'machines', `${safeSegment(hostname, 'hostname')}.md`);
}

export function machineManagedPath(mindPath, hostname) {
  return path.join(path.resolve(mindPath), 'user', 'machines', `${safeSegment(hostname, 'hostname')}.managed.json`);
}

export function machineReportPath(mindPath, hostname) {
  return path.join(path.resolve(mindPath), 'user', 'machines', `${safeSegment(hostname, 'hostname')}.report.md`);
}

// Removes the link itself, never what it points at, so a junction left by an older setup
// can be replaced without touching the folder behind it.
export async function removeSymbolicLink(root, target) {
  const destination = path.resolve(target);
  assertWithin(path.resolve(root), destination);
  const state = await lstatIfPresent(destination);
  if (!state) return null;
  if (!state.isSymbolicLink()) throw new Error(`Refusing to remove a path that is not a symbolic link: ${destination}`);
  const linkTarget = await readlink(destination).catch(() => null);
  try {
    await unlink(destination);
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EISDIR') throw error;
    await rmdir(destination);
  }
  return { path: destination, target: linkTarget };
}

export async function restoreSymbolicLink(link) {
  if (!link?.target) throw new Error(`Cannot restore a link with no recorded target: ${link?.path}`);
  await symlink(link.target, link.path, process.platform === 'win32' ? 'junction' : undefined);
}

export async function atomicWriteFile(filePath, content, { root, overwrite = true } = {}) {
  const destination = path.resolve(filePath);
  const selectedRoot = path.resolve(root ?? path.dirname(destination));
  assertWithin(selectedRoot, destination);
  await ensureSafeDirectory(selectedRoot, path.dirname(destination));

  const current = await lstatIfPresent(destination);
  if (current?.isSymbolicLink()) throw new Error(`Refusing to write through a symbolic link: ${destination}`);
  if (current && !current.isFile()) throw new Error(`Refusing to replace a non-file path: ${destination}`);
  if (current && !overwrite) throw Object.assign(new Error(`File already exists: ${destination}`), { code: 'EEXIST' });

  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomBytes(8).toString('hex')}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (!current) {
    await rename(temporary, destination);
    return;
  }

  const backup = `${temporary}.backup`;
  await rename(destination, backup);
  try {
    await rename(temporary, destination);
    await rm(backup, { force: true });
  } catch (error) {
    try {
      await rename(backup, destination);
    } catch {
      // The original error is the actionable one; the backup remains beside the target.
    }
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function readTextIfPresent(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function assertWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return;
  throw new Error(`Path escapes the selected destination: ${target}`);
}

export async function assertSafePath(root, target, { allowMissing = true } = {}) {
  const selectedRoot = path.resolve(root);
  const destination = path.resolve(target);
  assertWithin(selectedRoot, destination);

  const rootState = await lstatIfPresent(selectedRoot);
  if (!rootState) {
    if (allowMissing) return destination;
    throw new Error(`Path does not exist: ${selectedRoot}`);
  }
  if (rootState.isSymbolicLink()) throw new Error(`Refusing to use a symbolic destination: ${selectedRoot}`);
  if (!rootState.isDirectory()) throw new Error(`Destination root is not a directory: ${selectedRoot}`);

  const canonicalRoot = await realpath(selectedRoot);
  const segments = path.relative(selectedRoot, destination).split(path.sep).filter(Boolean);
  let cursor = selectedRoot;
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    const state = await lstatIfPresent(cursor);
    if (!state) {
      if (allowMissing) return destination;
      throw new Error(`Path does not exist: ${cursor}`);
    }
    if (state.isSymbolicLink()) throw new Error(`Refusing to use a symbolic destination: ${cursor}`);
    const isTarget = index === segments.length - 1;
    if (!state.isDirectory() && !(isTarget && state.isFile())) {
      throw new Error(`Destination component is not a directory or regular file: ${cursor}`);
    }
    assertWithin(canonicalRoot, await realpath(cursor));
  }
  return destination;
}

export async function unsafeDestinationReason(root, target) {
  const selectedRoot = path.resolve(root);
  const destination = path.resolve(target);
  try {
    assertWithin(selectedRoot, destination);
  } catch (error) {
    return error.message;
  }

  const rootState = await lstatIfPresent(selectedRoot);
  if (rootState?.isSymbolicLink()) return `Destination root is a symbolic link: ${selectedRoot}`;
  if (rootState && !rootState.isDirectory()) return `Destination root is not a directory: ${selectedRoot}`;
  if (!rootState) return null;

  const relativeParent = path.relative(selectedRoot, path.dirname(destination));
  let cursor = selectedRoot;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const state = await lstatIfPresent(cursor);
    if (!state) return null;
    if (state.isSymbolicLink()) return `Destination component is a symbolic link: ${cursor}`;
    if (!state.isDirectory()) return `Destination component is not a directory: ${cursor}`;
  }
  return null;
}

export async function ensureSafeDirectory(root, directory) {
  const selectedRoot = path.resolve(root);
  const destination = path.resolve(directory);
  assertWithin(selectedRoot, destination);

  const rootState = await lstatIfPresent(selectedRoot);
  if (rootState?.isSymbolicLink()) throw new Error(`Refusing to use a symbolic destination: ${selectedRoot}`);
  if (rootState && !rootState.isDirectory()) throw new Error(`Destination is not a directory: ${selectedRoot}`);
  if (!rootState) await mkdir(selectedRoot, { recursive: true });
  const canonicalRoot = await realpath(selectedRoot);

  const relative = path.relative(selectedRoot, destination);
  let cursor = selectedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const state = await lstatIfPresent(cursor);
    if (state?.isSymbolicLink()) throw new Error(`Refusing to use a symbolic destination: ${cursor}`);
    if (state && !state.isDirectory()) throw new Error(`Destination component is not a directory: ${cursor}`);
    if (!state) await mkdir(cursor);
    assertWithin(canonicalRoot, await realpath(cursor));
  }
}

function parseListSection(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`(?:^|\\n)## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`));
  if (!match) return [];
  return match[1].split('\n').map((line) => line.match(/^-\s+(.+)$/)?.[1]?.trim()).filter(Boolean);
}

function parseJsonSection(text, name, fallback) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = '(?:^|\\n)## ' + escaped + '\\n```json\\n([\\s\\S]*?)\\n```(?=\\n|$)';
  const match = text.match(new RegExp(pattern));
  if (!match) return fallback;
  try {
    return JSON.parse(match[1]);
  } catch {
    return fallback;
  }
}

async function lstatIfPresent(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function safeSegment(value, label) {
  const segment = String(value ?? '').trim();
  if (!segment || segment === '.' || segment === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(segment)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return segment;
}

function sortByName(values) {
  return [...values].sort((left, right) => left.name.localeCompare(right.name));
}
