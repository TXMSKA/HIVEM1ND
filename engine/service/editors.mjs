import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateSketch, SketchError } from '../../features/blueprint/review/sketch-format.mjs';
import { CoreError, canonicalJson, hashBytes, isUuid, uuidV8 } from './identity.mjs';
import { admitMessage } from '../sync/limits.mjs';
import { createAnchor, findAnchor, place } from '../../features/void/comments.mjs';
import { plain } from '../../features/void/text.mjs';
import { assertNoLinks } from './paths.mjs';
import { bindProjects, commitTransaction } from './store.mjs';

const ASSET_LIMIT = 10000000;

function fail(status, code, message) {
  throw new CoreError(status, code, message);
}

function projectOf(context, name) {
  const found = (context.projects ?? []).find((item) => item.name === name);
  if (!found?.localPath) fail(503, 'project_unavailable', 'The project is not available on this machine.');
  return found;
}

function inside(root, relative) {
  if (typeof relative !== 'string' || relative === '' || path.isAbsolute(relative)) fail(422, 'invalid_path', 'The path id is not canonical.');
  const parts = relative.split('/');
  if (relative.includes('\\') || parts.some((part) => part === '' || part === '.' || part === '..')) fail(422, 'invalid_path', 'The path id is not canonical.');
  const full = path.resolve(root, ...parts);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(`${base}${path.sep}`)) fail(422, 'invalid_path', 'The path id is not canonical.');
  return full;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function loadBytes(file) {
  await assertNoLinks(file);
  try {
    const stats = await lstat(file);
    if (stats.isSymbolicLink()) fail(422, 'unsafe_path', 'Refusing to follow a link.');
    if (!stats.isFile()) fail(404, 'not_found', 'The resource does not exist.');
    const bytes = await readFile(file);
    return { bytes, revision: hashBytes(bytes) };
  } catch (error) {
    if (error instanceof CoreError) throw error;
    if (error?.code === 'ENOENT') return { bytes: null, revision: null };
    throw error;
  }
}

async function contained(root, file) {
  await assertNoLinks(root);
  await assertNoLinks(file);
  const base = await realpath(root).catch(() => path.resolve(root));
  let stats;
  try {
    stats = await lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (stats.isSymbolicLink()) fail(422, 'unsafe_path', 'Refusing to follow a link.');
  if (!stats.isFile()) fail(404, 'not_found', 'The resource does not exist.');
  const final = await realpath(file);
  if (final !== base && !final.startsWith(`${base}${path.sep}`)) fail(422, 'unsafe_path', 'Refusing to follow a link.');
  return final;
}

function parseJson(bytes, code = 'corrupt_resource') {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(409, code, 'The resource could not be read.');
  }
}

function catalogFile(context) {
  return path.join(context.paths.mind, 'user', 'gui', 'resources.json');
}

function indexFile(project) {
  return path.join(project.localPath, 'docs', 'flows', 'boards', 'index.json');
}

function commentsFile(project, legacyId) {
  return path.join(project.localPath, 'docs', 'flows', 'comments', `${legacyId}.json`);
}

async function readCatalog(context) {
  const loaded = await loadBytes(catalogFile(context));
  const value = loaded.bytes ? parseJson(loaded.bytes) : { format: 'hivem1nd-resources-v1', resources: [] };
  if (!value || typeof value !== 'object' || !Array.isArray(value.resources)) fail(409, 'corrupt_resource', 'The resource could not be read.');
  return { ...loaded, value };
}

function entryOf(catalog, id) {
  return catalog.value.resources.find((item) => item.id === id) ?? null;
}

function view(entry, document, revision) {
  return {
    id: entry.id,
    kind: entry.kind,
    project: entry.project,
    path: entry.path,
    legacyId: entry.legacyId,
    readOnly: entry.readOnly === true,
    attached: [...(entry.attached ?? [])],
    revision,
    document,
  };
}

export function preserveUnknown(before, after) {
  walk(before, after);
  return true;
}

function walk(left, right) {
  if (Array.isArray(left)) {
    if (!Array.isArray(right)) fail(409, 'unsupported_fields_lost', 'A saved field was dropped.');
    for (const item of left) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const match = right.find((entry) => entry && entry.id === item.id);
      if (match) walk(item, match);
    }
    return;
  }
  if (!left || typeof left !== 'object') return;
  if (!right || typeof right !== 'object' || Array.isArray(right)) fail(409, 'unsupported_fields_lost', 'A saved field was dropped.');
  for (const key of Object.keys(left)) {
    if (!Object.hasOwn(right, key)) fail(409, 'unsupported_fields_lost', 'A saved field was dropped.');
    walk(left[key], right[key]);
  }
}

export function validateBoard(document) {
  try {
    return validateSketch(document);
  } catch (error) {
    if (error instanceof SketchError) fail(422, 'invalid_document', error.message);
    throw error;
  }
}

function rooted(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function rewriteEntry(context, entry) {
  if (!entry?.recordPath || entry.target) return entry;
  const resolved = path.resolve(entry.recordPath);
  for (const project of context.projects ?? []) {
    if (!project?.localPath || project.eligible === false) continue;
    const root = path.resolve(project.localPath);
    if (!rooted(root, resolved)) continue;
    const relative = path.relative(root, resolved).split(path.sep).join('/');
    return {
      resource: `project:${project.name}:${relative}`,
      target: { kind: 'project', project: project.name, path: relative },
      beforeRevision: entry.beforeRevision,
      afterBytes: entry.afterBytes,
      afterBytesBase64: entry.afterBytesBase64,
      afterRevision: entry.afterRevision,
      record: entry.record ?? null,
    };
  }
  return entry;
}

async function commit(context, entries, events = []) {
  bindProjects(context.store, context.projects ?? []);
  const prepared = entries.map((entry) => rewriteEntry(context, entry));
  for (const entry of prepared) {
    const file = entry.target
      ? path.resolve((context.projects ?? []).find((item) => item.name === entry.target.project)?.localPath ?? '', ...entry.target.path.split('/'))
      : entry.recordPath;
    if (file) await assertNoLinks(file);
  }
  const result = await commitTransaction(context.store, { id: randomUUID(), entries: prepared, events });
  if (context.bus) {
    for (const event of events) context.bus.emit(event);
  }
  return result;
}

function record(file, before, bytes) {
  return { resource: file, recordPath: file, beforeRevision: before, afterBytes: bytes };
}

export async function discoverResources(context, projectName) {
  const project = projectOf(context, projectName);
  const dir = path.join(project.localPath, 'docs', 'flows', 'boards');
  let names = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return names
    .filter((name) => name.endsWith('.json') || name.endsWith('.mjs'))
    .filter((name) => name !== 'index.json')
    .map((name) => ({ project: projectName, path: `docs/flows/boards/${name}`, legacyId: name.replace(/\.(json|mjs)$/, ''), readOnly: name.endsWith('.mjs') }));
}

export async function registerResource(context, input) {
  const project = projectOf(context, input.project);
  const relative = input.path;
  const full = inside(project.localPath, relative);
  const loaded = await loadBytes(full);
  if (!loaded.bytes) fail(404, 'not_found', 'The resource does not exist.');
  const readOnly = relative.endsWith('.mjs');
  const document = readOnly ? null : validateBoard(parseJson(loaded.bytes));
  const legacyId = document?.id ?? path.basename(relative).replace(/\.(json|mjs)$/, '');
  const catalog = await readCatalog(context);
  if (catalog.value.resources.some((item) => item.project === project.name && item.legacyId === legacyId)) fail(409, 'board_id_exists', 'That board id is already registered.');
  if (catalog.value.resources.some((item) => item.project === project.name && item.path === relative)) fail(409, 'resource_exists', 'That path is already registered.');
  const entry = {
    id: randomUUID(),
    kind: input.kind ?? 'blueprint',
    project: project.name,
    path: relative,
    legacyId,
    readOnly,
    attached: [],
  };
  const next = { ...catalog.value, resources: [...catalog.value.resources, entry] };
  await commit(context, [record(catalogFile(context), catalog.revision, jsonBytes(next))]);
  return view(entry, document, loaded.revision);
}

export async function list(context, query = {}) {
  const names = query.project ? [query.project] : (context.projects ?? []).map((item) => item.name);
  const items = [];
  for (const name of names) {
    const project = projectOf(context, name);
    const catalog = await readCatalog(context);
    for (const entry of catalog.value.resources) {
      if (entry.project !== project.name) continue;
      if (query.kind && entry.kind !== query.kind) continue;
      const file = inside(project.localPath, entry.path);
      const loaded = await loadBytes(file);
      items.push({ id: entry.id, kind: entry.kind, project: entry.project, path: entry.path, legacyId: entry.legacyId, readOnly: entry.readOnly === true, revision: loaded.revision });
    }
  }
  return { items };
}

async function resourceOf(context, id) {
  if (!isUuid(id)) fail(404, 'not_found', 'The resource does not exist.');
  const catalog = await readCatalog(context);
  const entry = entryOf(catalog, id);
  if (!entry) fail(404, 'not_found', 'The resource does not exist.');
  const project = (context.projects ?? []).find((item) => item.name === entry.project && item.localPath);
  if (!project) fail(503, 'project_unavailable', 'The project is not available on this machine.');
  return { project, catalog, entry };
}

export async function readEditor(context, id) {
  const { project, entry } = await resourceOf(context, id);
  const file = inside(project.localPath, entry.path);
  await contained(project.localPath, file);
  const loaded = await loadBytes(file);
  if (!loaded.bytes) fail(409, 'corrupt_resource', 'The resource could not be read.');
  if (entry.kind === 'void') return view(entry, validateText(parseJson(loaded.bytes)), loaded.revision);
  if (entry.readOnly) return view(entry, null, loaded.revision);
  return view(entry, validateBoard(parseJson(loaded.bytes)), loaded.revision);
}

function indexEntry(document) {
  const title = document.title || document.id;
  return { id: document.id, letter: title.slice(0, 1).toUpperCase(), short: title.slice(0, 24), title };
}

function addIndex(current, entry) {
  if (current == null) return [entry];
  if (Array.isArray(current)) return [...current, entry];
  const boards = Array.isArray(current.boards) ? [...current.boards, entry] : [entry];
  return { ...current, boards };
}

export async function createBoard(context, input) {
  const document = validateBoard(input.document);
  const project = projectOf(context, input.project);
  const relative = input.path ?? `docs/flows/boards/${document.id}.json`;
  if (relative.endsWith('.mjs')) fail(409, 'read_only_resource', 'A module board cannot be overwritten.');
  const full = inside(project.localPath, relative);
  const existing = await loadBytes(full);
  if (existing.bytes) fail(409, 'resource_exists', 'That path is already registered.');
  const catalog = await readCatalog(context);
  if (catalog.value.resources.some((item) => item.project === project.name && item.legacyId === document.id)) fail(409, 'board_id_exists', 'That board id is already registered.');
  const index = await loadBytes(indexFile(project));
  const comments = await loadBytes(commentsFile(project, document.id));
  if (comments.bytes) fail(409, 'resource_exists', 'That path is already registered.');
  const entry = {
    id: randomUUID(),
    kind: 'blueprint',
    project: project.name,
    path: relative,
    legacyId: document.id,
    readOnly: false,
    attached: Array.isArray(input.attached) ? [...input.attached] : [],
  };
  const nextCatalog = { ...catalog.value, resources: [...catalog.value.resources, entry] };
  const nextIndex = addIndex(index.bytes ? parseJson(index.bytes) : null, indexEntry(document));
  const sidecar = { board: document.id, threads: [] };
  const bytes = jsonBytes(document);
  await commit(context, [
    record(full, null, bytes),
    record(catalogFile(context), catalog.revision, jsonBytes(nextCatalog)),
    record(indexFile(project), index.revision, jsonBytes(nextIndex)),
    record(commentsFile(project, document.id), null, jsonBytes(sidecar)),
  ]);
  return view(entry, document, hashBytes(bytes));
}

async function boardFile(context, id) {
  const found = await resourceOf(context, id);
  if (found.entry.readOnly || found.entry.path.endsWith('.mjs')) fail(409, 'read_only_resource', 'A module board cannot be overwritten.');
  const file = inside(found.project.localPath, found.entry.path);
  const loaded = await loadBytes(file);
  if (!loaded.bytes) fail(409, 'corrupt_resource', 'The resource could not be read.');
  return { ...found, file, loaded, document: parseJson(loaded.bytes) };
}

export async function replaceBoard(context, id, input) {
  const found = await boardFile(context, id);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The board changed since it was read.');
  const document = validateBoard(input.document);
  preserveUnknown(found.document, document);
  const bytes = jsonBytes(document);
  await commit(context, [record(found.file, found.loaded.revision, bytes)]);
  return view(found.entry, document, hashBytes(bytes));
}

function eachNode(document, visit) {
  for (const screen of document.screens ?? []) {
    visit(screen.root, null, screen);
    const walk = (node, parent) => {
      for (const kid of node.kids ?? []) {
        visit(kid, parent, screen);
        if (kid.kids) walk(kid, kid);
      }
    };
    if (screen.root) walk(screen.root, screen.root);
  }
}

function findNode(document, nodeId) {
  let found = null;
  eachNode(document, (node, parent, screen) => {
    if (node?.id === nodeId) found = { node, parent, screen };
  });
  return found;
}

export async function addNode(context, id, input) {
  const found = await boardFile(context, id);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The board changed since it was read.');
  const located = findNode(found.document, input.parentId);
  if (!located || located.node.t !== 'box' || !Array.isArray(located.node.kids)) fail(422, 'invalid_parent', 'The parent must be a box.');
  if (findNode(found.document, input.node?.id)) fail(409, 'node_exists', 'That node already exists.');
  const index = input.index ?? located.node.kids.length;
  if (!Number.isInteger(index) || index < 0 || index > located.node.kids.length) fail(422, 'invalid_parent', 'The index is outside the box.');
  located.node.kids.splice(index, 0, input.node);
  const document = validateBoard(found.document);
  const bytes = jsonBytes(document);
  await commit(context, [record(found.file, found.loaded.revision, bytes)]);
  return { editor: view(found.entry, document, hashBytes(bytes)), nodeId: input.node.id };
}

export async function updateNode(context, id, nodeId, input) {
  const found = await boardFile(context, id);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The board changed since it was read.');
  const located = findNode(found.document, nodeId);
  if (!located) fail(404, 'node_not_found', 'The node does not exist.');
  const changes = input.changes ?? {};
  if ((changes.id !== undefined && changes.id !== nodeId) || (changes.t !== undefined && changes.t !== located.node.t)) {
    fail(422, 'invalid_node', 'The node id and type cannot change.');
  }
  Object.assign(located.node, changes, { id: nodeId, t: located.node.t });
  const document = validateBoard(found.document);
  const bytes = jsonBytes(document);
  await commit(context, [record(found.file, found.loaded.revision, bytes)]);
  return view(found.entry, document, hashBytes(bytes));
}

export async function removeNode(context, id, nodeId, input) {
  const found = await boardFile(context, id);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The board changed since it was read.');
  const located = findNode(found.document, nodeId);
  if (!located) fail(404, 'node_not_found', 'The node does not exist.');
  if (!located.parent) fail(422, 'root_node', 'The root node cannot be removed.');
  const dropped = new Set();
  const collect = (node) => {
    dropped.add(node.id);
    for (const kid of node.kids ?? []) collect(kid);
  };
  collect(located.node);
  located.parent.kids = located.parent.kids.filter((kid) => kid.id !== nodeId);
  found.document.links = (found.document.links ?? []).filter((link) => !dropped.has(link.from) && !dropped.has(link.to) && !dropped.has(link.fromNode) && !dropped.has(link.toNode));
  const document = validateBoard(found.document);
  const bytes = jsonBytes(document);
  await commit(context, [record(found.file, found.loaded.revision, bytes)]);
  return view(found.entry, document, hashBytes(bytes));
}

export async function readComments(context, id) {
  const found = await resourceOf(context, id);
  const loaded = await loadComments(found);
  return { ...projectComments(loaded.value, found.entry.id), commentsRevision: loaded.revision };
}

export async function readAttachments(context, id) {
  const { catalog, entry } = await resourceOf(context, id);
  return { attached: [...(entry.attached ?? [])], revision: catalog.revision };
}

export async function writeAttachments(context, id, input) {
  const found = await resourceOf(context, id);
  if (input.expectedRevision !== found.catalog.revision) fail(409, 'revision_conflict', 'The board changed since it was read.');
  if (!Array.isArray(input.attached) || input.attached.some((item) => typeof item !== 'string')) fail(422, 'invalid_body', 'Attachments must be unit ids.');
  const resources = found.catalog.value.resources.map((item) => (item.id === id ? { ...item, attached: [...input.attached] } : item));
  const next = { ...found.catalog.value, resources };
  const bytes = jsonBytes(next);
  await commit(context, [record(catalogFile(context), found.catalog.revision, bytes)]);
  return { attached: [...input.attached], revision: hashBytes(bytes) };
}

function sniff(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'image/png', ext: 'png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

export async function createAsset(context, id, input) {
  const found = await resourceOf(context, id);
  let bytes;
  try {
    bytes = Buffer.from(input.data ?? '', 'base64');
  } catch {
    fail(422, 'invalid_asset', 'The asset is not a verified image.');
  }
  if (bytes.length === 0 || bytes.length > ASSET_LIMIT) fail(413, 'request_too_large', 'The asset is too large.');
  const head = bytes.subarray(0, 64).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<html') || head.startsWith('<!doctype')) fail(422, 'invalid_asset', 'The asset is not a verified image.');
  const kind = sniff(bytes);
  if (!kind) fail(422, 'invalid_asset', 'The asset is not a verified image.');
  const name = `${randomUUID()}.${kind.ext}`;
  const relative = `docs/flows/assets/${name}`;
  const file = inside(found.project.localPath, relative);
  await commit(context, [record(file, null, bytes)]);
  return { src: `assets/${name}`, type: kind.type, bytes: bytes.length };
}

export async function readAsset(context, id, assetId) {
  const found = await resourceOf(context, id);
  if (typeof assetId !== 'string' || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(assetId)) fail(404, 'not_found', 'The asset does not exist.');
  const file = inside(found.project.localPath, `docs/flows/assets/${assetId}`);
  const document = await loadBytes(inside(found.project.localPath, found.entry.path));
  const text = document.bytes ? document.bytes.toString('utf8') : '';
  if (!text.includes(`docs/flows/assets/${assetId}`) && !text.includes(`assets/${assetId}`)) fail(404, 'not_found', 'The asset is not referenced.');
  await contained(found.project.localPath, file);
  const loaded = await loadBytes(file);
  if (!loaded.bytes) fail(404, 'not_found', 'The asset does not exist.');
  const kind = sniff(loaded.bytes);
  if (!kind) fail(422, 'invalid_asset', 'The asset is not a verified image.');
  return { bytes: loaded.bytes, type: kind.type };
}

function clock(context) {
  return new Date(context.now?.() ?? Date.now()).toISOString();
}

function actor(context) {
  const principal = context.principal ?? { audience: 'desktop', unitId: 'root:master' };
  if (principal.audience === 'agent') return { author: principal.unitId, authorId: principal.unitId };
  return { author: 'master', authorId: principal.unitId ?? 'root:master' };
}

function assertCanEdit(context, entry) {
  const principal = context.principal;
  if (principal?.audience === 'agent' && !(entry.attached ?? []).includes(principal.unitId)) {
    fail(403, 'forbidden', 'The agent is not attached to that resource.');
  }
}

function stemOf(file) {
  return file.replace(/\.json$/i, '');
}

function commentsPath(found) {
  if (found.entry.kind === 'void') return `${stemOf(inside(found.project.localPath, found.entry.path))}.comments.json`;
  return commentsFile(found.project, found.entry.legacyId);
}

async function loadComments(found) {
  const file = commentsPath(found);
  const loaded = await loadBytes(file);
  if (!loaded.bytes) {
    const value = found.entry.kind === 'void'
      ? { path: path.basename(found.entry.path), threads: [] }
      : { board: found.entry.legacyId, threads: [] };
    return { file, bytes: null, revision: null, value };
  }
  let value;
  try {
    value = JSON.parse(loaded.bytes.toString('utf8'));
  } catch {
    fail(409, 'corrupt_resource', 'The resource could not be read.');
  }
  if (!value || typeof value !== 'object' || !Array.isArray(value.threads)) fail(409, 'corrupt_resource', 'The resource could not be read.');
  return { file, ...loaded, value };
}

function projectComments(value, resourceId) {
  const copy = structuredClone(value);
  for (const thread of copy.threads ?? []) {
    thread.messages = (thread.messages ?? []).map((message, index) => ({
      ...message,
      id: message.id ?? uuidV8(['comment-message', resourceId, thread.id, index, message.author, message.at, message.text]),
      author: ['person', 'user', 'User'].includes(message.author) ? 'master' : message.author,
    }));
  }
  return copy;
}

function assignIds(value, resourceId) {
  for (const thread of value.threads ?? []) {
    thread.messages = (thread.messages ?? []).map((message, index) => (
      message.id ? message : { ...message, id: uuidV8(['comment-message', resourceId, thread.id, index, message.author, message.at, message.text]) }
    ));
  }
  return value;
}

export function validateText(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) fail(422, 'invalid_document', 'The text is not a document.');
  if (typeof document.title !== 'string' || document.title.length < 1 || document.title.length > 240) fail(422, 'invalid_document', 'The title must be 1 to 240 characters.');
  if (!Array.isArray(document.pages)) fail(422, 'invalid_document', 'The text needs pages.');
  const keys = new Set();
  for (const page of document.pages) {
    if (!page || typeof page !== 'object' || typeof page.k !== 'string' || page.k.length < 1 || page.k.length > 240) fail(422, 'invalid_document', 'Each page needs a stable key.');
    if (keys.has(page.k)) fail(422, 'invalid_document', 'A page key is used twice.');
    keys.add(page.k);
    for (const [key, item] of Object.entries(page)) {
      if (key === 'k') continue;
      if (typeof item === 'string' && item.length > 1000000) fail(422, 'invalid_document', 'A language string is too long.');
    }
  }
  if (document.rev !== undefined && (!Number.isInteger(document.rev) || document.rev < 0)) fail(422, 'invalid_document', 'The revision must be a whole number.');
  return structuredClone(document);
}

function textChanges(before, after) {
  const changes = [];
  const leftPages = new Map((before?.pages ?? []).map((page) => [page.k, page]));
  const rightPages = new Map((after?.pages ?? []).map((page) => [page.k, page]));
  for (const key of new Set([...leftPages.keys(), ...rightPages.keys()])) {
    const left = leftPages.get(key) ?? {};
    const right = rightPages.get(key) ?? {};
    for (const lang of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (lang === 'k' || (typeof left[lang] !== 'string' && typeof right[lang] !== 'string')) continue;
      const previous = typeof left[lang] === 'string' ? left[lang] : '';
      const next = typeof right[lang] === 'string' ? right[lang] : '';
      if (previous !== next) changes.push({ k: key, lang, before: previous, after: next });
    }
  }
  return changes;
}

function rememberExternal(context, id, revision, document) {
  if (!context.externalHashes) context.externalHashes = new Map();
  if (!context.snapshots) context.snapshots = new Map();
  context.externalHashes.set(id, revision);
  if (document) context.snapshots.set(id, document);
}

async function textBundle(context, id) {
  const found = await resourceOf(context, id);
  if (found.entry.kind !== 'void') fail(404, 'not_found', 'The resource does not exist.');
  const file = inside(found.project.localPath, found.entry.path);
  await contained(found.project.localPath, file);
  const loaded = await loadBytes(file);
  if (!loaded.bytes) fail(409, 'corrupt_resource', 'The resource could not be read.');
  return { ...found, file, loaded, document: parseJson(loaded.bytes) };
}

export async function createText(context, input) {
  const document = validateText(input.document);
  document.rev = Number.isInteger(document.rev) ? document.rev : 0;
  const project = projectOf(context, input.project);
  const relative = input.path;
  const full = inside(project.localPath, relative);
  if (relative.endsWith('.orig.json') || relative.endsWith('.comments.json') || relative.endsWith('.versions.jsonl')) {
    fail(422, 'invalid_path', 'The path id is not canonical.');
  }
  if ((await loadBytes(full)).bytes) fail(409, 'resource_exists', 'That path is already registered.');
  const catalog = await readCatalog(context);
  const id = uuidV8(['editor', 'void', project.name, relative]);
  if (catalog.value.resources.some((item) => item.id === id || (item.project === project.name && item.path === relative))) fail(409, 'resource_exists', 'That path is already registered.');
  const entry = {
    id, kind: 'void', project: project.name, path: relative, legacyId: path.basename(relative, '.json'), readOnly: false,
    attached: Array.isArray(input.attached) ? [...input.attached] : [],
  };
  const bytes = jsonBytes(document);
  const comments = { path: path.basename(relative), threads: [] };
  const nextCatalog = { ...catalog.value, resources: [...catalog.value.resources, entry] };
  await commit(context, [
    record(full, null, bytes),
    record(`${stemOf(full)}.orig.json`, null, bytes),
    record(`${stemOf(full)}.comments.json`, null, jsonBytes(comments)),
    record(catalogFile(context), catalog.revision, jsonBytes(nextCatalog)),
  ], [{ name: 'void.changed', resourceId: id, revision: hashBytes(bytes), data: { resourceId: id, revision: hashBytes(bytes), operation: 'create' } }]);
  rememberExternal(context, id, hashBytes(bytes), document);
  return view(entry, document, hashBytes(bytes));
}

export async function replaceText(context, id, input) {
  const found = await textBundle(context, id);
  assertCanEdit(context, found.entry);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The text changed since it was read.');
  const incoming = validateText(input.document);
  preserveUnknown(found.document, incoming);
  const changes = textChanges(found.document, incoming);
  incoming.rev = (found.document.rev || 0) + (changes.length > 0 ? 1 : 0);
  if (changes.length === 0) return view(found.entry, found.document, found.loaded.revision);
  const bytes = jsonBytes(incoming);
  const entries = [record(found.file, found.loaded.revision, bytes)];
  const orig = `${stemOf(found.file)}.orig.json`;
  const origLoaded = await loadBytes(orig);
  if (!origLoaded.bytes) entries.push(record(orig, null, found.loaded.bytes));
  const versions = `${stemOf(found.file)}.versions.jsonl`;
  const history = await loadBytes(versions);
  const at = clock(context);
  const lines = `${changes.map((change) => JSON.stringify({ at, rev: incoming.rev, ...change })).join('\n')}\n`;
  entries.push(record(versions, history.revision, Buffer.concat([history.bytes ?? Buffer.alloc(0), Buffer.from(lines)])));
  const revision = hashBytes(bytes);
  await commit(context, entries, [{ name: 'void.changed', resourceId: id, revision, data: { resourceId: id, revision, operation: 'replace' } }]);
  rememberExternal(context, id, revision, incoming);
  return view(found.entry, incoming, revision);
}

function assertRange(source, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) fail(422, 'invalid_range', 'The range is outside the text.');
  const splitsPair = (index) => {
    if (index <= 0 || index >= source.length) return false;
    const previous = source.charCodeAt(index - 1);
    const here = source.charCodeAt(index);
    return previous >= 0xd800 && previous <= 0xdbff && here >= 0xdc00 && here <= 0xdfff;
  };
  if (splitsPair(start) || splitsPair(end)) fail(422, 'invalid_range', 'The range splits a character.');
  for (const match of source.matchAll(/<\/?[bi]>/g)) {
    const from = match.index;
    const to = from + match[0].length;
    if ((start > from && start < to) || (end > from && end < to)) fail(422, 'invalid_range', 'The range splits a markup tag.');
  }
}

function applySlice(source, start, end, replacement, expected) {
  assertRange(source, start, end);
  if (source.slice(start, end) !== expected) fail(409, 'range_changed', 'The text at that range changed.');
  return source.slice(0, start) + replacement + source.slice(end);
}

async function historyEntry(file, beforeRevision, lines) {
  const versions = `${stemOf(file)}.versions.jsonl`;
  const history = await loadBytes(versions);
  const next = Buffer.concat([history.bytes ?? Buffer.alloc(0), Buffer.from(lines)]);
  return { versions, entry: record(versions, history.revision ?? beforeRevision, next), history };
}

export async function replaceRange(context, id, input) {
  const found = await textBundle(context, id);
  assertCanEdit(context, found.entry);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The text changed since it was read.');
  const page = found.document.pages.find((item) => item.k === input.k);
  if (!page || typeof page[input.lang] !== 'string') fail(422, 'invalid_range', 'The page language does not exist.');
  const mode = input.mode ?? 'apply';
  if (mode === 'propose') return proposeRange(context, found, input);
  const next = applySlice(page[input.lang], input.start, input.end, input.replacement ?? '', input.expectedText);
  const document = structuredClone(found.document);
  document.pages.find((item) => item.k === input.k)[input.lang] = next;
  document.rev = (document.rev || 0) + 1;
  const bytes = jsonBytes(document);
  const entries = [record(found.file, found.loaded.revision, bytes)];
  const orig = await loadBytes(`${stemOf(found.file)}.orig.json`);
  if (!orig.bytes) entries.push(record(`${stemOf(found.file)}.orig.json`, null, found.loaded.bytes));
  const at = clock(context);
  const line = `${JSON.stringify({ at, rev: document.rev, k: input.k, lang: input.lang, before: page[input.lang], after: next })}\n`;
  const history = await historyEntry(found.file, null, line);
  entries.push(history.entry);
  const revision = hashBytes(bytes);
  await commit(context, entries, [{ name: 'void.changed', resourceId: id, revision, data: { resourceId: id, revision, operation: 'range' } }]);
  rememberExternal(context, id, revision, document);
  return { editor: view(found.entry, document, revision), proposal: null };
}

async function proposeRange(context, found, input) {
  if (!input.threadId || input.expectedCommentsRevision === undefined) fail(422, 'invalid_body', 'A proposal needs a thread and a comments revision.');
  applySlice(found.document.pages.find((item) => item.k === input.k)[input.lang], input.start, input.end, input.replacement ?? '', input.expectedText);
  const comments = await loadComments(found);
  if (input.expectedCommentsRevision !== comments.revision) fail(409, 'revision_conflict', 'The comments changed since they were read.');
  const thread = comments.value.threads.find((item) => item.id === input.threadId);
  if (!thread) fail(404, 'thread_not_found', 'The thread does not exist.');
  const { author, authorId } = actor(context);
  const message = {
    id: randomUUID(), author, authorId, at: clock(context), text: input.replacement || 'Suggested edit',
    proposal: {
      id: randomUUID(), state: 'pending', k: input.k, lang: input.lang, start: input.start, end: input.end,
      expectedText: input.expectedText, replacement: input.replacement ?? '', baseRevision: found.loaded.revision,
      createdBy: authorId, createdAt: clock(context), decidedBy: null, decidedAt: null,
    },
  };
  assignIds(comments.value, found.entry.id);
  thread.messages.push(message);
  thread.status = 'open';
  const bytes = jsonBytes(comments.value);
  const revision = hashBytes(bytes);
  const notices = await noticePlan(context, message.id, found.entry.id, recipientsFor(context, found.entry.attached, authorId));
  await admitComment(context, message.id);
  await commit(context, [record(comments.file, comments.revision, bytes), ...notices.entries], [
    { name: 'comment.changed', resourceId: found.entry.id, data: { resourceId: found.entry.id, thread, commentsRevision: revision, operation: 'reply' } },
    { name: 'void.proposal.changed', resourceId: found.entry.id, data: { resourceId: found.entry.id, proposal: { ...message.proposal, resourceId: found.entry.id, threadId: thread.id, commentsRevision: revision }, commentsRevision: revision } },
    ...notices.events,
  ]);
  return { editor: view(found.entry, found.document, found.loaded.revision), proposal: { ...message.proposal, resourceId: found.entry.id, threadId: thread.id, commentsRevision: revision } };
}

export async function listProposals(context, id, query = {}) {
  const found = await textBundle(context, id);
  const comments = await loadComments(found);
  const state = query.state ?? 'pending';
  const items = [];
  for (const thread of comments.value.threads) {
    for (const message of thread.messages ?? []) {
      if (!message.proposal || (state !== 'all' && message.proposal.state !== state)) continue;
      items.push({ ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision: comments.revision });
    }
  }
  return { items };
}

export async function answerProposal(context, id, proposalId, input) {
  if (context.principal?.audience === 'agent') fail(403, 'forbidden', 'The agent cannot accept a proposal.');
  const found = await textBundle(context, id);
  const comments = await loadComments(found);
  if (input.expectedRevision !== found.loaded.revision || input.expectedCommentsRevision !== comments.revision) {
    fail(409, 'revision_conflict', 'The text changed since it was read.');
  }
  let message = null;
  let thread = null;
  for (const item of comments.value.threads) {
    message = (item.messages ?? []).find((entry) => entry.proposal?.id === proposalId) ?? null;
    if (message) { thread = item; break; }
  }
  if (!message) fail(404, 'not_found', 'The proposal does not exist.');
  if (message.proposal.state !== 'pending') fail(409, 'proposal_resolved', 'The proposal was already answered.');
  const decidedAt = clock(context);
  const decidedBy = actor(context).authorId;
  if (input.decision === 'discard') {
    message.proposal.state = 'discarded';
    message.proposal.decidedBy = decidedBy;
    message.proposal.decidedAt = decidedAt;
    const bytes = jsonBytes(comments.value);
    const revision = hashBytes(bytes);
    await commit(context, [record(comments.file, comments.revision, bytes)], [
      { name: 'void.proposal.changed', resourceId: id, data: { resourceId: id, proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision: revision }, commentsRevision: revision } },
    ]);
    return { editor: view(found.entry, found.document, found.loaded.revision), proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision: revision } };
  }
  if (message.proposal.baseRevision !== found.loaded.revision) fail(409, 'proposal_stale', 'The proposal no longer matches the text.');
  const page = found.document.pages.find((item) => item.k === message.proposal.k);
  const source = page?.[message.proposal.lang];
  if (typeof source !== 'string' || source.slice(message.proposal.start, message.proposal.end) !== message.proposal.expectedText) {
    fail(409, 'proposal_stale', 'The proposal no longer matches the text.');
  }
  const document = structuredClone(found.document);
  const next = applySlice(source, message.proposal.start, message.proposal.end, message.proposal.replacement, message.proposal.expectedText);
  document.pages.find((item) => item.k === message.proposal.k)[message.proposal.lang] = next;
  document.rev = (document.rev || 0) + 1;
  message.proposal.state = 'accepted';
  message.proposal.decidedBy = decidedBy;
  message.proposal.decidedAt = decidedAt;
  const bytes = jsonBytes(document);
  const commentBytes = jsonBytes(comments.value);
  const at = clock(context);
  const line = `${JSON.stringify({ at, rev: document.rev, k: message.proposal.k, lang: message.proposal.lang, before: source, after: next })}\n`;
  const history = await historyEntry(found.file, null, line);
  const entries = [record(found.file, found.loaded.revision, bytes), record(comments.file, comments.revision, commentBytes), history.entry];
  const orig = await loadBytes(`${stemOf(found.file)}.orig.json`);
  if (!orig.bytes) entries.push(record(`${stemOf(found.file)}.orig.json`, null, found.loaded.bytes));
  const revision = hashBytes(bytes);
  const commentsRevision = hashBytes(commentBytes);
  await commit(context, entries, [
    { name: 'void.changed', resourceId: id, revision, data: { resourceId: id, revision, operation: 'accept' } },
    { name: 'void.proposal.changed', resourceId: id, data: { resourceId: id, proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision }, commentsRevision } },
  ]);
  rememberExternal(context, id, revision, document);
  return { editor: view(found.entry, document, revision), proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision } };
}

function commentText(value) {
  if (typeof value !== 'string') fail(422, 'invalid_body', 'The comment needs text.');
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text || text.length > 10000) fail(422, 'invalid_body', 'The comment needs text of at most 10000 characters.');
  return text;
}

function recipientsFor(context, attached, authorId) {
  const list = [...new Set(attached ?? [])].filter((item) => item !== authorId);
  if (context.principal?.audience === 'agent' && authorId !== 'root:master' && !list.includes('root:master')) list.push('root:master');
  return list;
}

async function noticePlan(context, messageId, resourceId, recipients) {
  if (!context.paths?.mind || recipients.length === 0) return { entries: [], events: [] };
  const file = path.join(context.paths.mind, 'user', 'relay', 'fanout', `${messageId}.json`);
  const loaded = await loadBytes(file);
  const parsed = loaded.bytes ? parseJson(loaded.bytes) : { format: 'hivem1nd-fanout-v1', messageId, notices: [] };
  const events = [];
  for (const unitId of recipients) {
    const key = `${messageId}:${unitId}`;
    if (parsed.notices.some((item) => item.key === key)) continue;
    parsed.notices.push({ key, unitId, state: 'pending', resourceId });
    events.push({ name: 'notification.changed', unitId, resourceId, data: { noticeKey: key, unitId, resourceId, state: 'pending', error: null } });
  }
  if (events.length === 0) return { entries: [], events: [] };
  return { entries: [record(file, loaded.revision, Buffer.from(`${canonicalJson(parsed)}\n`))], events };
}

async function admitComment(context, id) {
  if (!context.ledger) throw new CoreError(503, 'service_unavailable', 'Message admission is not composed.');
  await admitMessage(context.ledger, { id, record: canonicalJson({ id, kind: 'comment' }) });
}

export async function notifyAttached(context, input) {
  const planned = await noticePlan(context, input.messageId, input.resourceId, input.recipients ?? []);
  if (planned.entries.length > 0) await commit(context, planned.entries, planned.events);
  return planned.events.map((event) => event.data.noticeKey);
}

export async function listComments(context, id, query = {}) {
  const found = await resourceOf(context, id);
  const loaded = await loadComments(found);
  const projected = projectComments(loaded.value, found.entry.id);
  const status = query.status ?? 'all';
  const threads = (projected.threads ?? []).filter((thread) => status === 'all' || thread.status === status);
  const pages = found.entry.kind === 'void' ? await currentPages(context, found) : [];
  return { items: threads.map((thread) => ({ ...thread, place: found.entry.kind === 'void' ? place(pages, thread) : null })), commentsRevision: loaded.revision };
}

async function currentPages(context, found) {
  if (found.entry.kind !== 'void') return [];
  const loaded = await loadBytes(inside(found.project.localPath, found.entry.path));
  if (!loaded.bytes) return [];
  return parseJson(loaded.bytes).pages ?? [];
}

function validateAnchor(found, document, anchor) {
  if (!anchor || typeof anchor !== 'object') fail(422, 'invalid_body', 'The anchor is not valid.');
  if (found.entry.kind === 'void') {
    const page = document.pages.find((item) => item.k === anchor.k);
    const source = page?.[anchor.lang];
    if (typeof source !== 'string') fail(409, 'anchor_changed', 'The anchor no longer matches the text.');
    const rendered = plain(source);
    if (rendered.slice(anchor.start, anchor.end) !== anchor.quote) fail(409, 'anchor_changed', 'The anchor no longer matches the text.');
    return createAnchor(rendered, anchor.start, anchor.end, anchor.lang, anchor.k);
  }
  if (anchor.screen) {
    const screen = (document.screens ?? []).find((item) => item.id === anchor.screen);
    if (!screen) fail(409, 'anchor_changed', 'The anchor no longer matches the board.');
    if (anchor.element && !findNode(document, anchor.element)) fail(409, 'anchor_changed', 'The anchor no longer matches the board.');
  }
  if (typeof anchor.label === 'string' && anchor.label.length > 160) fail(422, 'invalid_body', 'The anchor label is too long.');
  return anchor;
}

export async function createComment(context, id, input) {
  const found = await resourceOf(context, id);
  assertCanEdit(context, found.entry);
  const text = commentText(input.text);
  const document = found.entry.kind === 'void' ? (await textBundle(context, id)).document : (await boardFile(context, id)).document;
  const fileRevision = found.entry.kind === 'void'
    ? (await loadBytes(inside(found.project.localPath, found.entry.path))).revision
    : (await loadBytes(inside(found.project.localPath, found.entry.path))).revision;
  if (input.expectedRevision !== fileRevision) fail(409, 'revision_conflict', 'The document changed since it was read.');
  const comments = await loadComments(found);
  if (input.expectedCommentsRevision !== comments.revision) fail(409, 'revision_conflict', 'The comments changed since they were read.');
  const anchor = validateAnchor(found, document, input.anchor);
  const { author, authorId } = actor(context);
  const thread = {
    id: randomUUID(), anchor, to: null, status: 'open', layer: found.entry.kind === 'blueprint' ? 'design' : undefined,
    messages: [{ id: randomUUID(), author, authorId, at: clock(context), text }],
  };
  if (thread.layer === undefined) delete thread.layer;
  assignIds(comments.value, found.entry.id);
  comments.value.threads.push(thread);
  const bytes = jsonBytes(comments.value);
  const revision = hashBytes(bytes);
  const messageId = thread.messages[0].id;
  const notices = await noticePlan(context, messageId, id, recipientsFor(context, found.entry.attached, authorId));
  await admitComment(context, messageId);
  await commit(context, [record(comments.file, comments.revision, bytes), ...notices.entries], [
    { name: 'comment.changed', resourceId: id, data: { resourceId: id, thread: projectComments({ threads: [thread] }, id).threads[0], commentsRevision: revision, operation: 'create' } },
    ...notices.events,
  ]);
  return { thread: projectComments({ threads: [thread] }, id).threads[0], commentsRevision: revision };
}

export async function replyComment(context, id, threadId, input) {
  const found = await resourceOf(context, id);
  assertCanEdit(context, found.entry);
  const text = commentText(input.text);
  const comments = await loadComments(found);
  if (input.expectedCommentsRevision !== comments.revision) fail(409, 'revision_conflict', 'The comments changed since they were read.');
  const thread = comments.value.threads.find((item) => item.id === threadId);
  if (!thread) fail(404, 'thread_not_found', 'The thread does not exist.');
  const { author, authorId } = actor(context);
  const message = { id: randomUUID(), author, authorId, at: clock(context), text };
  assignIds(comments.value, found.entry.id);
  thread.messages.push(message);
  thread.status = 'open';
  const bytes = jsonBytes(comments.value);
  const revision = hashBytes(bytes);
  const notices = await noticePlan(context, message.id, id, recipientsFor(context, found.entry.attached, authorId));
  await admitComment(context, message.id);
  await commit(context, [record(comments.file, comments.revision, bytes), ...notices.entries], [
    { name: 'comment.changed', resourceId: id, data: { resourceId: id, thread, commentsRevision: revision, operation: 'reply' } },
    ...notices.events,
  ]);
  return { thread: projectComments({ threads: [thread] }, id).threads[0], commentsRevision: revision };
}

export async function setCommentStatus(context, id, threadId, input) {
  const found = await resourceOf(context, id);
  assertCanEdit(context, found.entry);
  if (input.status !== 'open' && input.status !== 'resolved') fail(422, 'invalid_body', 'The status must be open or resolved.');
  const comments = await loadComments(found);
  if (input.expectedCommentsRevision !== comments.revision) fail(409, 'revision_conflict', 'The comments changed since they were read.');
  const thread = comments.value.threads.find((item) => item.id === threadId);
  if (!thread) fail(404, 'thread_not_found', 'The thread does not exist.');
  thread.status = input.status;
  const bytes = jsonBytes(comments.value);
  const revision = hashBytes(bytes);
  await commit(context, [record(comments.file, comments.revision, bytes)], [
    { name: 'comment.changed', resourceId: id, data: { resourceId: id, thread, commentsRevision: revision, operation: input.status === 'resolved' ? 'resolve' : 'reopen' } },
  ]);
  return { thread: projectComments({ threads: [thread] }, id).threads[0], commentsRevision: revision };
}

export async function observeExternal(context, id) {
  const found = await resourceOf(context, id);
  const file = inside(found.project.localPath, found.entry.path);
  const loaded = await loadBytes(file);
  if (!loaded.bytes) return { changed: false, issue: true };
  if (!context.externalHashes) context.externalHashes = new Map();
  if (!context.snapshots) context.snapshots = new Map();
  if (!context.externalIssues) context.externalIssues = new Map();
  if (context.externalHashes.get(id) === loaded.revision) return { changed: false };
  let document;
  try {
    document = validateText(parseJson(loaded.bytes));
  } catch {
    if (context.externalIssues.get(id) !== loaded.revision) {
      context.externalIssues.set(id, loaded.revision);
      context.store.events.push({ name: 'issue.changed', resourceId: id, data: { resourceId: id, issue: 'malformed' } });
    }
    return { changed: false, issue: true };
  }
  const previous = context.snapshots.get(id);
  context.externalHashes.set(id, loaded.revision);
  context.snapshots.set(id, document);
  const changes = previous ? textChanges(previous, document) : [];
  if (changes.length === 0) return { changed: false };
  const at = clock(context);
  const line = `${changes.map((change) => JSON.stringify({ at, rev: document.rev || 0, ...change, by: 'outside' })).join('\n')}\n`;
  const history = await historyEntry(file, null, line);
  await commit(context, [history.entry], [{ name: 'void.changed', resourceId: id, data: { resourceId: id, operation: 'import' } }]);
  return { changed: true };
}

export { findAnchor, place };

