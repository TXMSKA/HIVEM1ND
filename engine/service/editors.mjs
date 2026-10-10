import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { validateSketch, SketchError } from '../../features/blueprint/review/sketch-format.mjs';
import { CoreError, hashBytes, isUuid } from './identity.mjs';
import { commitTransaction } from './store.mjs';

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
  try {
    const bytes = await readFile(file);
    return { bytes, revision: hashBytes(bytes) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { bytes: null, revision: null };
    throw error;
  }
}

function parseJson(bytes, code = 'corrupt_resource') {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(409, code, 'The resource could not be read.');
  }
}

function catalogFile(project) {
  return path.join(project.localPath, 'docs', 'flows', 'resources.json');
}

function indexFile(project) {
  return path.join(project.localPath, 'docs', 'flows', 'boards', 'index.json');
}

function commentsFile(project, legacyId) {
  return path.join(project.localPath, 'docs', 'flows', 'comments', `${legacyId}.json`);
}

async function readCatalog(project) {
  const loaded = await loadBytes(catalogFile(project));
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

async function commit(context, entries) {
  return commitTransaction(context.store, { id: randomUUID(), entries });
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
  const catalog = await readCatalog(project);
  if (catalog.value.resources.some((item) => item.project === project.name && item.legacyId === legacyId)) fail(409, 'board_id_exists', 'That board id is already registered.');
  if (catalog.value.resources.some((item) => item.path === relative)) fail(409, 'resource_exists', 'That path is already registered.');
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
  await commit(context, [record(catalogFile(project), catalog.revision, jsonBytes(next))]);
  return view(entry, document, loaded.revision);
}

export async function list(context, query = {}) {
  const names = query.project ? [query.project] : (context.projects ?? []).map((item) => item.name);
  const items = [];
  for (const name of names) {
    const project = projectOf(context, name);
    const catalog = await readCatalog(project);
    for (const entry of catalog.value.resources) {
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
  for (const project of context.projects ?? []) {
    const catalog = await readCatalog(project);
    const entry = entryOf(catalog, id);
    if (entry) return { project, catalog, entry };
  }
  fail(404, 'not_found', 'The resource does not exist.');
}

export async function readEditor(context, id) {
  const { project, entry } = await resourceOf(context, id);
  const file = inside(project.localPath, entry.path);
  const loaded = await loadBytes(file);
  if (!loaded.bytes) fail(409, 'corrupt_resource', 'The resource could not be read.');
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
  const catalog = await readCatalog(project);
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
    record(catalogFile(project), catalog.revision, jsonBytes(nextCatalog)),
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
  const { project, entry } = await resourceOf(context, id);
  const loaded = await loadBytes(commentsFile(project, entry.legacyId));
  if (!loaded.bytes) return { board: entry.legacyId, threads: [] };
  return parseJson(loaded.bytes);
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
  await commit(context, [record(catalogFile(found.project), found.catalog.revision, bytes)]);
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
  const loaded = await loadBytes(file);
  if (!loaded.bytes) fail(404, 'not_found', 'The asset does not exist.');
  const kind = sniff(loaded.bytes);
  if (!kind) fail(422, 'invalid_asset', 'The asset is not a verified image.');
  return { bytes: loaded.bytes, type: kind.type };
}
