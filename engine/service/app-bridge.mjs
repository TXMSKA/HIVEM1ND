import { randomUUID } from 'node:crypto';
import { lstat, mkdir, opendir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, hashBytes } from './identity.mjs';
import { assertNoLinks } from './paths.mjs';
import { atomicWrite, readBytes, withLocalChanges, withLocks } from './store.mjs';
import { listAppAgents, sendAppAgent } from './app-agents.mjs';
import { loadPersonAliases } from './projection.mjs';
import { verifiedImage } from './editors.mjs';
import { appPathKey, insideAppPath, sameAppPath } from './app-paths.mjs';

export const APP_UPLOAD_LIMITS = Object.freeze({ fileBytes: 10_000_000, count: 200, totalBytes: 50_000_000 });
const FILE_LIMIT = 16_000_000;
const TEXT_EXTENSIONS = new Set(['.json', '.md', '.txt', '.html', '.htm', '.void']);
const IMAGE_TYPES = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]);
const FONT_TYPES = new Map([['woff2', 'font/woff2'], ['woff', 'font/woff'], ['ttf', 'font/ttf'], ['otf', 'font/otf']]);
const LIST_LIMIT = 10_000;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);
const METHODS = {
  blueprint: ['blueprint.locations', 'blueprint.list', 'blueprint.read', 'blueprint.save', 'blueprint.asset', 'blueprint.upload'],
  void: ['void.files.list', 'void.files.read', 'void.files.write', 'void.files.url', 'void.files.asset', 'void.files.attribution',
    'void.storage.load', 'void.storage.save', 'void.open.pick', 'void.open.switchTo', 'void.export.save', 'void.export.pdf', 'void.project'],
};
const states = new WeakMap();

function fail(code) {
  throw new CoreError({ invalid: 422, denied: 403, conflict: 409, not_found: 404, no_agent: 409, unavailable: 503 }[code], code, `App bridge: ${code}.`);
}

export function appCapabilities(app) {
  if (!Object.hasOwn(METHODS, app)) fail('invalid');
  return ['hello', 'app.saved', 'agents.list', 'agents.send', ...METHODS[app]];
}

function stateFor(context) {
  let state = states.get(context.store);
  if (!state) {
    state = { files: new Map(), selections: new Map(), projects: null, clients: new Map(), scan: null, observedScopes: new Set(), agentProjects: new Set(), agentTimer: null, schedule: null, generation: 0 };
    states.set(context.store, state);
  }
  return state;
}

function attached(context) {
  return (context.projects ?? []).filter(project => project.eligible !== false && project.localPath);
}

function identity(project) {
  return { id: project.id ?? project.name, name: project.name, path: path.resolve(project.localPath) };
}

function projectFor(context, location) {
  if (typeof location !== 'string' || !location) fail('denied');
  const project = attached(context).find(item => item.name === location || item.id === location
    || sameAppPath(item.localPath, location) || sameAppPath(path.resolve(item.localPath, 'docs/flows'), location));
  if (!project) fail('denied');
  return project;
}

// `.void/` is Void's own project state: only the void.files calls open it, every other dot path stays refused.
function relativePath(value, dotVoid = false) {
  if (typeof value !== 'string' || value.length > 2048 || !value || value.includes('\\') || /[\x00-\x1f:]/.test(value)) fail('denied');
  const parts = value.split('/');
  const dotted = (part, index) => part.startsWith('.') && !(dotVoid && index === 0 && part === '.void');
  if (parts.some((part, index) => !part || dotted(part, index) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('denied');
  return value;
}

async function contained(project, relative, dotVoid = false) {
  const root = path.resolve(project.localPath);
  const file = path.resolve(root, ...relativePath(relative, dotVoid).split('/'));
  if (!insideAppPath(root, file)) fail('denied');
  await assertNoLinks(file);
  return file;
}

async function bytesOf(file) {
  await assertNoLinks(file);
  const stats = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stats) return null;
  if (!stats.isFile()) fail('denied');
  if (stats.size > FILE_LIMIT) fail('invalid');
  return readFile(file);
}

function currentProject(context, clientId) {
  const selected = stateFor(context).selections.get(clientId);
  return attached(context).find(project => project.name === selected) ?? (attached(context).length === 1 ? attached(context)[0] : null);
}

async function voidFile(context, params, clientId, dotVoid = false) {
  let value = params.path;
  let project = params.location ? projectFor(context, params.location) : null;
  if (typeof value !== 'string' || !value) fail('invalid');
  if (path.isAbsolute(value)) {
    project ??= attached(context).filter(item => insideAppPath(item.localPath, value)).sort((a, b) => b.localPath.length - a.localPath.length)[0];
    if (!project) fail('denied');
    value = path.relative(project.localPath, value).split(path.sep).join('/');
  }
  project ??= currentProject(context, clientId);
  if (!project) fail('denied');
  const file = await contained(project, value, dotVoid);
  return { project, relative: value, file };
}

function appEvent(context, app, name, params, clientId = null) {
  context.bus?.emit({ name: 'app.bridge', data: { app, name, params, ...(clientId ? { clientId } : {}) } });
}

function noteFile(context, project, relative, revision, { clientId = null, by = null } = {}) {
  const absolute = path.resolve(project.localPath, ...relative.split('/'));
  const files = stateFor(context).files, key = appPathKey(absolute), previous = files.get(key);
  if (!files.has(key) && files.size >= 50000) files.delete(files.keys().next().value);
  files.set(key, { revision, project: project.name, relative, by });
  if (previous?.revision === revision) return;
  const board = /^docs\/flows\/boards\/([A-Za-z0-9_-]+)\.json$/.exec(relative);
  if (board) appEvent(context, 'blueprint', 'blueprint.changed', { location: identity(project).id, id: board[1], ...(by ? { by } : {}) }, context.bridgeApp === 'blueprint' ? clientId : null);
  const change = { path: relative, kind: revision === null ? 'deleted' : previous && previous.revision !== null ? 'changed' : 'created', ...(by ? { by } : {}) };
  if (context.appChanges) context.appChanges.push(change);
  else appEvent(context, 'void', 'void.files.changed', [change], context.bridgeApp === 'void' ? clientId : null);
}

// `expectedRevision`: null means the file must not exist, undefined skips the check, otherwise the SHA-256 of what is replaced.
// `bytes` null removes the file.
async function putFile(context, project, relative, bytes, expectedRevision, clientId, dotVoid = false) {
  if (bytes && bytes.length > FILE_LIMIT || expectedRevision !== undefined && expectedRevision !== null && !(typeof expectedRevision === 'string' && /^[a-f0-9]{64}$/.test(expectedRevision))) fail('invalid');
  const file = await contained(project, relative, dotVoid);
  return withLocalChanges(context.store, () => withLocks(context.store, [`app-file:${appPathKey(file)}`], async () => {
    const before = await bytesOf(file);
    if (expectedRevision !== undefined && (before ? hashBytes(before) : null) !== expectedRevision) fail('conflict');
    if (bytes === null) {
      if (!before) return '';
      await rm(file);
      noteFile(context, project, relative, null, { clientId, by: context.principal?.unitId ?? null });
      return '';
    }
    await mkdir(path.dirname(file), { recursive: true });
    await assertNoLinks(file);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      const fresh = await bytesOf(file);
      if (expectedRevision !== undefined && (fresh ? hashBytes(fresh) : null) !== expectedRevision) fail('conflict');
      await assertNoLinks(file);
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    const revision = hashBytes(bytes);
    noteFile(context, project, relative, revision, { clientId, by: context.principal?.unitId ?? null });
    const stats = await lstat(file);
    stateFor(context).files.get(appPathKey(file)).signature = `${stats.size}:${stats.mtimeMs}:${stats.ino}`;
    return revision;
  }));
}

function boardId(value) {
  if (typeof value !== 'string' || value === 'index' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) fail('invalid');
  return value;
}

function fileBytes(params) {
  if (params.remove === true) return null;
  if (typeof params.base64 !== 'string' || params.base64.length > Math.ceil(FILE_LIMIT / 3) * 4 || /[^A-Za-z0-9+/=]/.test(params.base64)) fail('invalid');
  const bytes = Buffer.from(params.base64, 'base64');
  if (bytes.length > FILE_LIMIT || bytes.toString('base64') !== params.base64) fail('invalid');
  return bytes;
}

function binaryBytes(params) {
  if (Array.isArray(params.bytes) && params.bytes.length <= APP_UPLOAD_LIMITS.fileBytes && params.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return Buffer.from(params.bytes);
  if (typeof params.base64 !== 'string' || params.base64.length > Math.ceil(APP_UPLOAD_LIMITS.fileBytes / 3) * 4 || /[^A-Za-z0-9+/=]/.test(params.base64)) fail('invalid');
  const bytes = Buffer.from(params.base64, 'base64');
  if (bytes.length > APP_UPLOAD_LIMITS.fileBytes || bytes.toString('base64') !== params.base64) fail('invalid');
  return bytes;
}

function imageType(bytes) {
  const image = verifiedImage(bytes);
  if (!image) fail('invalid');
  return image.type;
}

// A board font by its signature, never by its name or declared type.
function fontExtension(bytes) {
  const magic = bytes.subarray(0, 4).toString('latin1');
  if (magic === 'wOF2') return 'woff2';
  if (magic === 'wOFF') return 'woff';
  if (magic === 'OTTO') return 'otf';
  if (magic === 'true' || magic === 'ttcf' || bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]))) return 'ttf';
  return null;
}

function assetType(bytes, extension) {
  if (FONT_TYPES.has(extension)) {
    const font = fontExtension(bytes);
    // An OpenType file with TrueType outlines may carry either name.
    if (!font || font !== extension && !(['ttf', 'otf'].includes(font) && ['ttf', 'otf'].includes(extension))) fail('invalid');
    return FONT_TYPES.get(extension);
  }
  const mime = imageType(bytes);
  if (IMAGE_TYPES.get(mime) !== extension) fail('invalid');
  return mime;
}

async function blueprintCall(context, method, params, clientId) {
  if (method === 'blueprint.locations') return { locations: attached(context).map(project => ({ ...identity(project), path: path.resolve(project.localPath, 'docs/flows') })) };
  const project = projectFor(context, params.location);
  const location = identity(project).id;
  if (method === 'blueprint.list') {
    const directory = await contained(project, 'docs/flows/boards');
    const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const boards = [];
    for (const name of names.filter(name => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(name) && name !== 'index.json')) {
      const file = await contained(project, `docs/flows/boards/${name}`);
      const bytes = await bytesOf(file);
      if (!bytes) continue;
      let document;
      try { document = JSON.parse(bytes); } catch { continue; }
      boards.push({ id: name.slice(0, -5), title: document.title ?? name.slice(0, -5), updatedAt: Math.round((await lstat(file)).mtimeMs), location, revision: hashBytes(bytes) });
    }
    return { boards };
  }
  if (method === 'blueprint.read') {
    const id = boardId(params.id);
    const bytes = await bytesOf(await contained(project, `docs/flows/boards/${id}.json`));
    if (!bytes) fail('not_found');
    let board;
    try { board = JSON.parse(bytes); } catch { fail('invalid'); }
    return { id, location, board, revision: hashBytes(bytes) };
  }
  if (method === 'blueprint.save') {
    const board = params.board;
    if (!board || typeof board !== 'object' || Array.isArray(board) || params.revision !== null && typeof params.revision !== 'string') fail('invalid');
    const id = boardId(board.id);
    const revision = await putFile(context, project, `docs/flows/boards/${id}.json`, Buffer.from(`${JSON.stringify(board, null, 2)}\n`), params.revision, clientId);
    return { id, location, revision };
  }
  if (method === 'blueprint.upload') {
    const bytes = binaryBytes(params), font = fontExtension(bytes), declared = typeof params.type === 'string' ? params.type : null;
    if (!bytes.length || bytes.length > APP_UPLOAD_LIMITS.fileBytes) fail('invalid');
    let mime, extension;
    if (font) {
      if (declared && !/^(?:font\/|application\/(?:x-)?(?:font|octet-stream))/.test(declared)) fail('invalid');
      extension = font;
      mime = FONT_TYPES.get(font);
    } else {
      mime = imageType(bytes);
      if ((declared ?? mime) !== mime) fail('invalid');
      extension = IMAGE_TYPES.get(mime);
    }
    return withLocks(context.store, [`app-assets:${appPathKey(path.resolve(project.localPath, 'docs/flows'))}`], async () => {
      const directory = await contained(project, 'docs/flows/assets');
      const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      let total = 0, count = 0;
      for (const name of names) {
        const file = await contained(project, `docs/flows/assets/${name}`);
        const stats = await lstat(file);
        if (stats.isFile()) { count++; total += stats.size; }
      }
      if (count >= APP_UPLOAD_LIMITS.count || total + bytes.length > APP_UPLOAD_LIMITS.totalBytes) fail('invalid');
      const id = `${randomUUID()}.${extension}`, relative = `docs/flows/assets/${id}`;
      const revision = await putFile(context, project, relative, bytes, null, clientId);
      return { src: `assets/${id}`, id, path: `assets/${id}`, mime, size: bytes.length, revision };
    });
  }
  if (method === 'blueprint.asset') {
    const id = String(params.src ?? '').replace(/^assets\//, '');
    const extension = /^[a-f0-9-]{36}\.(png|jpg|webp|woff2|woff|ttf|otf)$/.exec(id)?.[1];
    if (!extension) fail('invalid');
    const bytes = await bytesOf(await contained(project, `docs/flows/assets/${id}`));
    if (!bytes) fail('not_found');
    return { src: `assets/${id}`, base64: bytes.toString('base64'), type: assetType(bytes, extension), revision: hashBytes(bytes) };
  }
  fail('invalid');
}

async function storageCall(context, method, params, clientId) {
  const project = params.location ? projectFor(context, params.location) : currentProject(context, clientId);
  if (!project) fail('not_found');
  if (typeof params.key !== 'string' || !params.key || params.key.length > 200) fail('invalid');
  const file = path.join(context.paths.localDirectory, 'app-bridge', hashBytes(Buffer.from(appPathKey(project.localPath))), `${hashBytes(Buffer.from(params.key))}.json`);
  return withLocks(context.store, [`app-storage:${file}`], async () => {
    await assertNoLinks(file);
    const bytes = await readBytes(context.store, file);
    if (method === 'void.storage.load') return bytes ? JSON.parse(bytes) : null;
    if (!Object.hasOwn(params, 'value')) fail('invalid');
    const next = Buffer.from(JSON.stringify(params.value));
    if (next.length > FILE_LIMIT) fail('invalid');
    await atomicWrite(context.store, file, next);
    return { revision: hashBytes(next) };
  });
}

async function listDirectory(context, project, relative) {
  const directory = relative === '' ? path.resolve(project.localPath) : await contained(project, relative, true);
  await assertNoLinks(directory);
  const stats = await lstat(directory);
  if (!stats.isDirectory()) fail('not_found');
  const names = (await readdir(directory, { withFileTypes: true })).filter(entry => !entry.isSymbolicLink() && !entry.name.startsWith('.') && !SKIP_DIRECTORIES.has(entry.name));
  const truncated = names.length > LIST_LIMIT;
  const entries = [];
  for (const entry of truncated ? names.sort((a, b) => a.name.localeCompare(b.name, 'en')).slice(0, LIST_LIMIT) : names) {
    if (entry.isDirectory()) entries.push({ name: entry.name, kind: 'dir', size: 0, mtime: 0 });
    else if (entry.isFile()) {
      const found = await lstat(path.join(directory, entry.name));
      entries.push({ name: entry.name, kind: 'file', size: found.size, mtime: Math.round(found.mtimeMs) });
    }
  }
  return truncated ? { entries, truncated: true, limit: LIST_LIMIT } : entries;
}

async function voidCall(context, method, params, clientId) {
  if (method === 'void.project') {
    const project = currentProject(context, clientId);
    return project ? identity(project) : null;
  }
  if (method.startsWith('void.storage.')) return storageCall(context, method, params, clientId);
  if (method.startsWith('void.open.')) {
    const found = params.path ? await voidFile(context, params, clientId, false) : null;
    const project = found?.project ?? projectFor(context, params.location ?? params.project);
    stateFor(context).selections.set(clientId, project.name);
    if (found) return voidCall(context, 'void.files.read', { path: found.file }, clientId);    return identity(project);
  }
  if (method === 'void.files.list') {
    const project = params.location ? projectFor(context, params.location) : currentProject(context, clientId);
    if (!project) fail('denied');
    if (typeof params.path !== 'string') fail('invalid');
    return listDirectory(context, project, params.path.split('/').filter(part => part && part !== '.').join('/'));
  }
  const { project, relative, file } = await voidFile(context, params, clientId, true);
  if (method === 'void.files.write') {
    if (relative !== '.void' && !relative.startsWith('.void/') && !TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) fail('denied');
    const revision = await putFile(context, project, relative, fileBytes(params), params.expected === '' ? null : params.expected, clientId, true);
    return { path: relative, revision };
  }
  if (method === 'void.files.attribution') {
    const bytes = await bytesOf(file);
    if (!bytes) fail('not_found');
    await loadAppCatalog(context);
    return { path: relative, by: writerFor(context, project, relative, hashBytes(bytes)) };
  }
  const bytes = await bytesOf(file);
  if (!bytes) fail('not_found');
  if (method === 'void.files.read') return { path: relative, base64: bytes.toString('base64'), revision: hashBytes(bytes) };
  if (method === 'void.files.url' || method === 'void.files.asset') {
    const mime = TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) ? 'text/plain;charset=utf-8' : imageType(bytes);
    return { path: relative, ...(method === 'void.files.url' ? { url: `data:${mime};base64,${bytes.toString('base64')}` } : { base64: bytes.toString('base64') }), mime, revision: hashBytes(bytes) };
  }
  fail('unavailable');
}

export async function callAppBridge(context, input) {
  try {
    if (!input || !appCapabilities(input.app).includes(input.method)) fail('invalid');
    if (context.principal?.audience !== 'desktop') fail('denied');
    const { app, method } = input, params = input.params ?? {}, clientId = input.clientId;
    context = { ...context, bridgeApp: app };
    if (!params || typeof params !== 'object' || Array.isArray(params) || typeof clientId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(clientId)) fail('invalid');
    if (method === 'hello') {
      if (params.app !== app || params.protocol !== 1 || typeof params.appVersion !== 'string') fail('invalid');
      const selected = params.project || params.location ? projectFor(context, params.project ?? params.location).name : null;
      touchApp(context, app, clientId);
      if (selected) stateFor(context).selections.set(clientId, selected);
      const name = (context.aliases ?? await loadPersonAliases(context.paths.mind))[0];
      const person = typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, 200) } : null;
      const project = currentProject(context, clientId);
      return { ...(person ? { person } : {}), project: project ? identity(project) : null };
    }
    touchApp(context, app, clientId);
    if (method === 'app.saved') return { saved: true };
    if (method === 'agents.list') return await listAppAgents(context, params);
    if (method === 'agents.send') return await sendAppAgent(context, params);
    return await (app === 'blueprint' ? blueprintCall(context, method, params, clientId) : voidCall(context, method, params, clientId));
  } catch (error) {
    if (['not_found', 'conflict', 'invalid', 'denied', 'unavailable', 'no_agent'].includes(error?.code)) throw error;
    if (error?.code === 'ENOENT') fail('not_found');
    if (['unsafe_path', 'invalid_path', 'EACCES', 'EPERM', 'ELOOP'].includes(error?.code)) fail('denied');
    fail('unavailable');
  }
}

function writerFor(context, project, relative, revision) {
  const catalog = context.appCatalog?.resources ?? [];
  const resource = catalog.find(item => item.project === project.name && item.path === relative);
  const event = resource ? (context.store.events ?? []).findLast(item => item.resourceId === resource.id && (item.revision ?? item.data?.revision) === revision) : null;
  const author = event?.source?.unitId ?? event?.unitId;
  if (author) return author;
  const known = stateFor(context).files.get(appPathKey(path.resolve(project.localPath, ...relative.split('/'))));
  return known?.revision === revision ? known.by ?? null : null;
}

async function loadAppCatalog(context) {
  const catalog = await withLocalChanges(context.store, () => readBytes(context.store, path.join(context.paths.mind, 'user', 'gui', 'resources.json')));
  try { context.appCatalog = catalog ? JSON.parse(catalog) : null; } catch { context.appCatalog = null; }
}

function pruneClients(context, state) {
  const now = (context.now ?? Date.now)();
  for (const [clientId, client] of state.clients) if (client.expiresAt <= now) {
    state.clients.delete(clientId);
    state.selections.delete(clientId);
  }
}

function touchApp(context, app, clientId) {
  const state = stateFor(context);
  pruneClients(context, state);
  const client = state.clients.get(clientId) ?? { apps: new Set() };
  if (!state.clients.has(clientId) && state.clients.size >= 64) fail('unavailable');
  const added = !client.apps.has(app);
  client.apps.add(app);
  client.expiresAt = (context.now ?? Date.now)() + 90000;
  state.clients.set(clientId, client);
  if (added) state.schedule?.();
}

export function updateAppActivity(context, input) {
  if (context.principal?.audience !== 'desktop') fail('denied');
  if (!input || typeof input.clientId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(input.clientId)
    || !Array.isArray(input.apps) || input.apps.length > 2 || input.apps.some(app => !Object.hasOwn(METHODS, app))) fail('invalid');
  const state = stateFor(context);
  pruneClients(context, state);
  const selected = input.location ? projectFor(context, input.location).name : null;
  if (input.apps.length && !state.clients.has(input.clientId) && state.clients.size >= 64) fail('unavailable');
  if (input.apps.length) {
    const previous = state.clients.get(input.clientId);
    state.clients.set(input.clientId, { apps: new Set(input.apps), hostProject: selected, expiresAt: (context.now ?? Date.now)() + 90000 });
    if (selected && (previous?.hostProject !== selected || !state.selections.has(input.clientId))) state.selections.set(input.clientId, selected);
  } else {
    state.clients.delete(input.clientId);
    state.selections.delete(input.clientId);
  }
  state.schedule?.();
  return { active: true };
}

export function setAppObservationScheduler(context, schedule) {
  stateFor(context).schedule = schedule;
}

export async function stopAppObservation(context) {
  const state = stateFor(context);
  clearTimeout(state.agentTimer);
  state.agentTimer = null;
  state.agentProjects.clear();
  state.schedule = null;
  state.clients.clear();
  state.generation++;
  const scan = state.scan;
  state.scan = null;
  await scan?.iterator.return();
  state.files.clear();
  state.observedScopes.clear();
}

function observationScopes(context, state) {
  pruneClients(context, state);
  const scopes = new Map();
  for (const [clientId, client] of state.clients) for (const app of client.apps) {
    const projects = app === 'blueprint' ? attached(context) : [currentProject(context, clientId)].filter(Boolean);
    for (const project of projects) for (const relative of app === 'blueprint' ? ['docs/flows/boards', 'docs/flows/assets'] : ['']) {
      const key = `${appPathKey(project.localPath)}:${relative}`;
      scopes.set(key, { key, project, relative });
    }
  }
  // A Void project already contains Blueprint's two directories.
  for (const [key, scope] of scopes) if (scope.relative && scopes.has(`${appPathKey(scope.project.localPath)}:`)) scopes.delete(key);
  return [...scopes.values()];
}

async function* observationEntries(scopes) {
  async function* directory(scope, relative, depth = 0) {
    const file = path.resolve(scope.project.localPath, ...relative.split('/').filter(Boolean));
    let handle;
    try {
      if (depth > 32 || relative.length > 2048) fail('denied');
      await assertNoLinks(file);
      handle = await opendir(file);
    } catch (error) {
      if (error.code !== 'ENOENT') yield { error, file };
      return;
    }
    try {
      for await (const entry of handle) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        const child = path.join(file, entry.name);
        try { relativePath(name); } catch (error) { yield { error, file: child }; continue; }
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) { yield {}; continue; }
        if (entry.isDirectory()) {
          yield {};
          yield* directory(scope, name, depth + 1);
        } else if (entry.isFile() && (TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()) || /^docs\/flows\/assets\//.test(name))
          && !/\.(?:orig|comments)\.json$|\.versions\.jsonl$/.test(name)) yield { scope, relative: name, file: child };
        else yield {};
      }
    } catch (error) { yield { error, file }; }
  }
  for (const scope of scopes) yield* directory(scope, scope.relative);
}

export async function observeAppFiles(context, { baseline = false, rescan = false } = {}) {
  const state = stateFor(context), result = { entries: 0, files: 0, bytes: 0, skipped: 0, pending: false };
  const generation = state.generation;
  let repeat = false;
  const appChanges = [];
  context = { ...context, appChanges };
  try {
    const projects = attached(context), scopes = observationScopes(context, state);
    const signature = JSON.stringify(projects.map(identity)), scopeSignature = JSON.stringify(scopes.map(scope => scope.key));
    if (state.projects !== null && state.projects !== signature) {
      appEvent(context, 'blueprint', 'blueprint.locations', projects.map(project => ({ ...identity(project), path: path.resolve(project.localPath, 'docs/flows') })));
      const selected = currentProject(context, [...state.selections.keys()][0]);
      appEvent(context, 'void', 'void.project', selected ? identity(selected) : null);
      appAgentsChanged(context);
    }
    state.projects = signature;
    if (state.scan && state.scan.signature !== scopeSignature) { await state.scan.iterator.return(); state.scan = null; }
    if (!scopes.length) { state.files.clear(); state.observedScopes.clear(); return result; }
    if (!state.scan) {
      const currentKeys = new Set(scopes.map(scope => scope.key));
      for (const key of state.observedScopes) if (!currentKeys.has(key)) state.observedScopes.delete(key);
      for (const scope of scopes) scope.baseline = baseline || !state.observedScopes.has(scope.key);
      state.scan = { signature: scopeSignature, scopes, iterator: observationEntries(scopes), present: new Set(), blocked: new Set(), uncertain: false, deletions: null, held: null, rescan: false };
      await loadAppCatalog(context);
      state.scan.catalog = context.appCatalog;
    } else if (rescan) state.scan.rescan = true;
    const scan = state.scan, started = performance.now();
    context.appCatalog = scan.catalog;
    const block = file => { if (scan.blocked.size < 50000) scan.blocked.add(appPathKey(file)); else scan.uncertain = true; };
    const blocked = file => {
      for (let current = file;; current = path.dirname(current)) {
        if (scan.blocked.has(current)) return true;
        if (path.dirname(current) === current) return false;
      }
    };
    while (state.generation === generation && result.entries < 400 && result.files < 32 && result.bytes < FILE_LIMIT && performance.now() - started < 40) {
      if (scan.deletions) {
        const next = scan.deletions.next();
        if (next.done) {
          for (const scope of scan.scopes) state.observedScopes.add(scope.key);
          repeat = scan.rescan;
          state.scan = null;
          break;
        }
        result.entries++;
        const [key, previous] = next.value;
        if (scan.present.has(key)) continue;
        const scope = scopes.find(scope => scope.project.name === previous.project && (!scope.relative || previous.relative.startsWith(`${scope.relative}/`)));
        if (!scope) { state.files.delete(key); continue; }
        if (scan.uncertain || blocked(key)) continue;
        try {
          await withLocalChanges(context.store, async () => {
            if (state.files.get(key) !== previous) return;
            const file = path.resolve(scope.project.localPath, ...previous.relative.split('/'));
            await assertNoLinks(file);
            try { await lstat(file); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (!scope.baseline && previous.revision !== null) noteFile(context, scope.project, previous.relative, null);
            state.files.delete(key);
          });
        } catch { result.skipped++; }
        continue;
      }
      const next = scan.held ? { value: scan.held } : await scan.iterator.next();
      scan.held = null;
      if (next.done) { scan.deletions = state.files.entries(); continue; }
      result.entries++;
      const entry = next.value;
      if (entry.error) { result.skipped++; block(entry.file); continue; }
      if (!entry.file) continue;
      const { scope, relative, file } = entry, key = appPathKey(file);
      if (state.files.size >= 50000 && !state.files.has(key)) { result.skipped++; continue; }
      scan.present.add(key);
      try {
        await withLocalChanges(context.store, async () => {
          const stats = await lstat(file);
          if (!stats.isFile() || stats.isSymbolicLink() || stats.size > FILE_LIMIT) { result.skipped++; return; }
          const signature = `${stats.size}:${stats.mtimeMs}:${stats.ino}`, previous = state.files.get(key);
          if (previous?.signature === signature) return;
          if (scope.baseline && !previous) {
            state.files.set(key, { revision: undefined, project: scope.project.name, relative, signature });
            return;
          }
          if (result.bytes + stats.size > FILE_LIMIT) { scan.held = entry; return; }
          result.files++;
          result.bytes += stats.size;
          const bytes = await bytesOf(file);
          if (!bytes) return;
          const revision = hashBytes(bytes);
          if (previous?.revision === revision) previous.signature = signature;
          else {
            noteFile(context, scope.project, relative, revision, { by: writerFor(context, scope.project, relative, revision) });
            state.files.get(key).signature = signature;
          }
        });
        if (scan.held) break;
      } catch { result.skipped++; block(key); }
    }
    result.pending = state.generation === generation && (state.scan !== null || repeat);
  } catch {
    result.skipped++;
    await state.scan?.iterator.return().catch(() => {});
    state.scan = null;
  }
  if (state.generation === generation && appChanges.length) appEvent(context, 'void', 'void.files.changed', appChanges);
  return result;
}

export function appAgentsChanged(context, projectName = null) {
  const state = stateFor(context);
  for (const project of attached(context)) if (!projectName || project.name === projectName) state.agentProjects.add(project.name);
  if (state.agentTimer) return;
  state.agentTimer = setTimeout(() => {
    state.agentTimer = null;
    for (const project of attached(context)) if (state.agentProjects.has(project.name)) appEvent(context, null, 'agents.changed', { location: path.resolve(project.localPath) });
    state.agentProjects.clear();
  }, 50);
  state.agentTimer.unref?.();
}
