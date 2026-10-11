import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { validateSketch, SketchError } from '../../features/blueprint/review/sketch-format.mjs';
import { CoreError, canonicalJson, hashBytes, hashText, isUuid, parseUnitId, uuidV8 } from './identity.mjs';
import { paginate } from './projection.mjs';
import { admitMessage } from '../sync/limits.mjs';
import { createAnchor, findAnchor, place } from '../../features/void/comments.mjs';
import { plain } from '../../features/void/text.mjs';
import { assertNoLinks } from './paths.mjs';
import { bindProjects, commitTransaction } from './store.mjs';
import { noteSync, openSync, stageTransaction } from '../sync/store.mjs';
import { convertMedia } from '../sync/media.mjs';
import { startResourceWatch } from './watch.mjs';

const ASSET_LIMIT = 10000000;
const PNG_RAW_LIMIT = 32_000_000;
const ASSET_COUNT_LIMIT = 200;
const ASSET_BYTE_LIMIT = 50_000_000;
const TEXT_LIMIT = 16_000_000;
const PAGE_LIMIT = 2000;

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

function bindingFile(context, id) {
  return path.join(context.paths.mind, 'user', 'relay', 'editors', `${id}.json`);
}

function editorId(kind, project, relative) {
  return uuidV8(['editor', kind, project, relative.split('\\').join('/')]);
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

const ACTIVITY_WINDOW_MS = 15 * 60 * 1000;

function currentActivity(context, resourceId) {
  const records = context.watch?.activity ?? [];
  const now = context.now?.() ?? Date.now();
  const fresh = records.filter((item) => item.resourceId === resourceId && Number.isFinite(Date.parse(item.at)) && now - Date.parse(item.at) <= ACTIVITY_WINDOW_MS);
  fresh.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0));
  const latest = fresh.at(-1);
  return latest ? { unitId: latest.unitId, at: latest.at } : null;
}

export async function summarizeCatalog(context, resources) {
  const editors = [];
  for (const entry of resources) {
    if (!entry || typeof entry.id !== 'string') continue;
    const project = (context.projects ?? []).find((item) => item.name === entry.project && item.localPath);
    if (!project) {
      editors.push(catalogSummary(entry));
      continue;
    }
    try {
      const file = inside(project.localPath, entry.path);
      const loaded = await loadBytes(file);
      let document = null;
      if (entry.readOnly !== true && loaded.bytes) {
        try {
          document = JSON.parse(loaded.bytes.toString('utf8'));
        } catch {
          document = null;
        }
      }
      editors.push(summaryOf(await projectEditor(context, entry, document, loaded.revision)));
    } catch (error) {
      if (error?.code !== 'invalid_path' && error?.code !== 'project_unavailable' && error?.code !== 'not_found') throw error;
      editors.push(catalogSummary(entry));
    }
  }
  return editors;
}

function catalogSummary(entry) {
  return {
    id: entry.id,
    kind: entry.kind ?? null,
    project: entry.project ?? null,
    title: entry.title ?? entry.legacyId ?? entry.path ?? '',
    path: entry.path ?? null,
    readOnly: entry.readOnly === true,
    revision: null,
    attached: [],
    openThreads: 0,
    activity: null,
  };
}

function summaryOf(editor) {
  return {
    id: editor.id,
    kind: editor.kind,
    project: editor.project,
    title: editor.title,
    path: editor.path,
    readOnly: editor.readOnly,
    revision: editor.revision,
    attached: editor.attached,
    openThreads: editor.openThreads,
    activity: editor.activity,
  };
}

async function projectEditor(context, entry, document, revision) {
  const binding = await readAttachments(context, entry.id);
  const comments = await loadComments(await resourceOf(context, entry.id));
  const threads = comments.bytes ? (projectComments(comments.value, entry.id).threads ?? []) : [];
  return {
    id: entry.id,
    kind: entry.kind,
    project: entry.project,
    title: document?.title || entry.legacyId || '',
    path: entry.path,
    legacyId: entry.legacyId,
    readOnly: entry.readOnly === true,
    revision,
    attached: [...binding.attached],
    openThreads: threads.filter((thread) => thread.status !== 'resolved').length,
    activity: currentActivity(context, entry.id),
    document: document ?? null,
    legacy: entry.readOnly ? { id: entry.legacyId, path: entry.path, reason: 'conversion_required' } : null,
    attachmentRevision: binding.revision,
    commentsRevision: comments.revision,
    threads,
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
      if (!item || typeof item !== 'object') continue;
      const key = item.id != null ? 'id' : item.k != null ? 'k' : null;
      if (!key) continue;
      const match = right.find((entry) => entry && entry[key] === item[key]);
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
  const transactionId = randomUUID();
  const result = await commitTransaction(context.store, { id: transactionId, entries: prepared, events });
  const stage = [];
  for (const entry of prepared) {
    const target = syncTarget(context, entry);
    if (!target) continue;
    const bytes = entryBytes(entry);
    if (!bytes) continue;
    stage.push({
      target,
      bytes,
      id: uuidV8(['editor-change', transactionId, target.kind, target.project ?? '', target.path, hashBytes(bytes)]),
    });
  }
  if (stage.length > 0) {
    const sync = context.sync ?? openSync({
      store: context.store,
      paths: context.paths,
      now: () => context.now?.() ?? Date.now(),
      projects: context.projects ?? [],
    });
    const changes = await stageTransaction(sync, stage, { transactionId });
    noteSync(context, 'pending');
    if (context.pulse) {
      const published = await context.pulse.changed(changes.map((item) => item.id));
      if (published?.published === true) noteSync(context, 'published');
    }
  } else {
    noteSync(context, 'local');
  }
  if (context.bus) {
    for (const event of events) context.bus.emit(event);
  }
  return result;
}

function syncTarget(context, entry) {
  if (entry?.target?.kind === 'project' && entry.target.project && entry.target.path) return entry.target;
  const file = entry?.recordPath;
  const mind = context.paths?.mind;
  if (!file || !mind) return null;
  const relative = path.relative(path.resolve(mind), path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const slash = relative.split(path.sep).join('/');
  if (!slash.startsWith('user/')) return null;
  if (slash.startsWith('user/relay/leases/') || slash.startsWith('user/relay/credentials/') || slash.startsWith('user/relay/endpoints/')) return null;
  return { kind: 'mind', path: slash };
}

function entryBytes(entry) {
  if (Buffer.isBuffer(entry?.afterBytes)) return entry.afterBytes;
  if (typeof entry?.afterBytes === 'string') return Buffer.from(entry.afterBytes);
  if (typeof entry?.afterBytesBase64 === 'string') return Buffer.from(entry.afterBytesBase64, 'base64');
  return null;
}

function record(file, before, bytes) {
  return { resource: file, recordPath: file, beforeRevision: before, afterBytes: bytes };
}

function voidSidecar(name) {
  return name.endsWith('.orig.json') || name.endsWith('.comments.json') || name.endsWith('.versions.jsonl');
}

export async function discoverResources(context, projectName) {
  const project = projectOf(context, projectName);
  const root = path.join(project.localPath, 'docs');
  const found = [];
  const walk = async (dir, relative) => {
    let names = [];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return;
    }
    for (const name of names) {
      if (voidSidecar(name) || name === 'index.json') continue;
      const next = relative ? `${relative}/${name}` : name;
      const full = path.join(dir, name);
      const stat = await lstat(full);
      if (stat.isDirectory()) {
        await walk(full, next);
        continue;
      }
      if (!name.endsWith('.json') && !name.endsWith('.mjs')) continue;
      const kind = next.startsWith('flows/boards/') ? 'blueprint' : 'void';
      found.push({
        project: projectName,
        path: `docs/${next}`,
        kind,
        legacyId: name.replace(/\.(json|mjs)$/, ''),
        readOnly: kind === 'blueprint' && name.endsWith('.mjs'),
      });
    }
  };
  await walk(root, '');
  return found;
}

export async function registerResource(context, input) {
  const project = projectOf(context, input.project);
  const relative = input.path;
  const full = inside(project.localPath, relative);
  const loaded = await loadBytes(full);
  if (!loaded.bytes) fail(404, 'not_found', 'The resource does not exist.');
  const kind = input.kind === 'void' ? 'void' : 'blueprint';
  const readOnly = kind === 'blueprint' && relative.endsWith('.mjs');
  const document = readOnly ? null : kind === 'void' ? parseJson(loaded.bytes) : validateBoard(parseJson(loaded.bytes));
  const legacyId = document?.id ?? path.basename(relative).replace(/\.(json|mjs)$/, '');
  const catalog = await readCatalog(context);
  const id = editorId(kind, project.name, relative);
  const existing = catalog.value.resources.find((item) => item.id === id || (item.project === project.name && item.path === relative));
  if (existing) {
    const current = await shown(context, existing, document, loaded.revision);
    current.httpStatus = 200;
    return current;
  }
  const entry = {
    id,
    kind,
    project: project.name,
    path: relative,
    legacyId,
    readOnly,
    attached: [],
  };
  const next = { ...catalog.value, resources: [...catalog.value.resources, entry] };
  await commit(context, [record(catalogFile(context), catalog.revision, jsonBytes(next))]);
  const created = await shown(context, entry, document, loaded.revision);
  created.httpStatus = 201;
  return created;
}

export async function list(context, query = {}) {
  if (query.q != null && String(query.q).length > 200) fail(422, 'invalid_query', 'The search is longer than 200 characters.');
  const names = query.project ? [query.project] : (context.projects ?? []).map((item) => item.name);
  const catalog = await readCatalog(context);
  const editors = [];
  for (const name of names) {
    const project = projectOf(context, name);
    for (const entry of catalog.value.resources) {
      if (entry.project !== project.name) continue;
      if (query.kind && entry.kind !== query.kind) continue;
      const file = inside(project.localPath, entry.path);
      const loaded = await loadBytes(file);
      let document = null;
      if (!entry.readOnly && loaded.bytes) {
        try {
          document = JSON.parse(loaded.bytes.toString('utf8'));
        } catch {
          document = null;
        }
      }
      editors.push(await projectEditor(context, entry, document, loaded.revision));
    }
  }
  editors.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const needle = query.q == null || query.q === '' ? '' : String(query.q).toLowerCase();
  const matched = needle
    ? editors.filter((item) => `${item.title} ${item.path} ${item.id}`.toLowerCase().includes(needle))
    : editors;
  const snapshot = hashText(canonicalJson(matched.map((item) => [item.id, item.revision, item.attachmentRevision, item.commentsRevision, item.openThreads, item.attached, item.activity])));
  return paginate(matched.map(summaryOf), {
    limit: query.limit,
    cursor: query.cursor || null,
    filters: { project: query.project ?? null, kind: query.kind ?? null, q: query.q ?? null },
    snapshot,
  });
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
  await requireAttachment(context, id);
  const { project, entry } = await resourceOf(context, id);
  const file = inside(project.localPath, entry.path);
  await contained(project.localPath, file);
  const loaded = await loadBytes(file);
  if (!loaded.bytes) fail(409, 'corrupt_resource', 'The resource could not be read.');
  if (entry.kind === 'void') {
    connectExternal(context, id, file);
    return shown(context, entry, validateText(parseJson(loaded.bytes)), loaded.revision);
  }
  if (entry.readOnly) return shown(context, entry, null, loaded.revision);
  return shown(context, entry, validateBoard(parseJson(loaded.bytes)), loaded.revision);
}

function indexEntry(document) {
  const title = document.title || document.id;
  return { id: document.id, letter: title.slice(0, 1).toUpperCase(), short: title.slice(0, 24), title };
}

function mergeIndex(current, document) {
  const entry = indexEntry(document);
  if (current == null) return [entry];
  if (Array.isArray(current)) {
    const index = current.findIndex((item) => item?.id === document.id);
    if (index < 0) return [...current, entry];
    const next = [...current];
    next[index] = { ...current[index], ...entry };
    return next;
  }
  const boards = Array.isArray(current.boards) ? [...current.boards] : [];
  const index = boards.findIndex((item) => item?.id === document.id);
  if (index < 0) boards.push(entry);
  else boards[index] = { ...boards[index], ...entry };
  return { ...current, boards };
}

function boardEvents(context, id, revision, operation, nodeId, screenId) {
  const unitId = context.principal?.unitId ?? 'root:master';
  return [
    {
      name: 'blueprint.changed',
      resourceId: id,
      data: { resourceId: id, revision, operation, nodeId: nodeId ?? null },
    },
    {
      name: 'editor.activity',
      resourceId: id,
      unitId,
      data: {
        resourceId: id,
        kind: 'blueprint',
        unitId,
        at: clock(context),
        focus: nodeId ? { screenId: screenId ?? null, nodeId } : null,
      },
    },
  ];
}

async function stageBoard(context, found, document, operation, nodeId, screenId) {
  const bytes = jsonBytes(document);
  const revision = hashBytes(bytes);
  const index = await loadBytes(indexFile(found.project));
  const comments = await loadComments(found);
  const nextIndex = mergeIndex(index.bytes ? parseJson(index.bytes) : null, document);
  await commit(context, [
    record(found.file, found.loaded.revision, bytes),
    record(catalogFile(context), found.catalog.revision, jsonBytes(found.catalog.value)),
    record(indexFile(found.project), index.revision, jsonBytes(nextIndex)),
    record(comments.file, comments.revision, jsonBytes(comments.value)),
  ], boardEvents(context, found.entry.id, revision, operation, nodeId, screenId));
  return shown(context, found.entry, document, revision);
}

function deepMerge(target, changes, root = true) {
  if (root && (Object.hasOwn(changes, 'id') || Object.hasOwn(changes, 't') || Object.hasOwn(changes, 'kids'))) {
    fail(422, 'invalid_node', 'The node id, type and children cannot change.');
  }
  for (const [key, value] of Object.entries(changes)) {
    const current = target[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)) {
      deepMerge(current, value, false);
    } else {
      target[key] = value;
    }
  }
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
    id: editorId('blueprint', project.name, relative),
    kind: 'blueprint',
    project: project.name,
    path: relative,
    legacyId: document.id,
    readOnly: false,
    attached: Array.isArray(input.attached) ? [...input.attached] : [],
  };
  const nextCatalog = { ...catalog.value, resources: [...catalog.value.resources, entry] };
  const nextIndex = mergeIndex(index.bytes ? parseJson(index.bytes) : null, document);
  const sidecar = { board: document.id, threads: [] };
  const bytes = jsonBytes(document);
  await commit(context, [
    record(full, null, bytes),
    record(catalogFile(context), catalog.revision, jsonBytes(nextCatalog)),
    record(indexFile(project), index.revision, jsonBytes(nextIndex)),
    record(commentsFile(project, document.id), null, jsonBytes(sidecar)),
  ], boardEvents(context, entry.id, hashBytes(bytes), 'create', null, null));
  return shown(context, entry, document, hashBytes(bytes));
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
  await requireAttachment(context, id);
  const found = await boardFile(context, id);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The board changed since it was read.');
  const document = validateBoard(input.document);
  preserveUnknown(found.document, document);
  return stageBoard(context, found, document, 'replace', null, null);
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
  await requireAttachment(context, id);
  const found = await boardFile(context, id);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The board changed since it was read.');
  const located = findNode(found.document, input.parentId);
  if (!located || located.node.t !== 'box' || !Array.isArray(located.node.kids)) fail(422, 'invalid_parent', 'The parent must be a box.');
  if (typeof input.screenId !== 'string' || located.screen?.id !== input.screenId) fail(422, 'invalid_parent', 'The parent must belong to the requested screen.');
  if (findNode(found.document, input.node?.id)) fail(409, 'node_exists', 'That node already exists.');
  const index = input.index ?? located.node.kids.length;
  if (!Number.isInteger(index) || index < 0 || index > located.node.kids.length) fail(422, 'invalid_parent', 'The index is outside the box.');
  located.node.kids.splice(index, 0, input.node);
  const document = validateBoard(found.document);
  const editor = await stageBoard(context, found, document, 'add-node', input.node.id, input.screenId);
  return { editor, nodeId: input.node.id };
}

export async function updateNode(context, id, nodeId, input) {
  await requireAttachment(context, id);
  const found = await boardFile(context, id);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The board changed since it was read.');
  const located = findNode(found.document, nodeId);
  if (!located) fail(404, 'node_not_found', 'The node does not exist.');
  const changes = input.changes ?? {};
  deepMerge(located.node, changes);
  const document = validateBoard(found.document);
  return stageBoard(context, found, document, 'update-node', nodeId, located.screen?.id ?? null);
}

export async function removeNode(context, id, nodeId, input) {
  await requireAttachment(context, id);
  const found = await boardFile(context, id);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The board changed since it was read.');
  const located = findNode(found.document, nodeId);
  if (!located) fail(404, 'node_not_found', 'The node does not exist.');
  if (!located.parent) fail(422, 'root_node', 'The root node cannot be removed.');
  const screenId = located.screen?.id ?? null;
  const dropped = new Set();
  const collect = (node) => {
    dropped.add(node.id);
    for (const kid of node.kids ?? []) collect(kid);
  };
  collect(located.node);
  located.parent.kids = located.parent.kids.filter((kid) => kid.id !== nodeId);
  found.document.links = (found.document.links ?? []).filter((link) => !dropped.has(link.element) && !dropped.has(link.fromNode) && !dropped.has(link.toNode));
  const document = validateBoard(found.document);
  return stageBoard(context, found, document, 'remove-node', nodeId, screenId);
}

export async function readComments(context, id) {
  await requireAttachment(context, id);
  const found = await resourceOf(context, id);
  const loaded = await loadComments(found);
  return { ...projectComments(loaded.value, found.entry.id), commentsRevision: loaded.revision };
}

export async function readAttachments(context, id) {
  const found = await resourceOf(context, id);
  const loaded = await loadBytes(bindingFile(context, id));
  if (!loaded.bytes) return { attached: [...(found.entry.attached ?? [])], revision: null };
  const value = parseJson(loaded.bytes);
  return { attached: [...(value.attached ?? [])], revision: loaded.revision };
}

export async function writeAttachments(context, id, input) {
  const found = await resourceOf(context, id);
  const file = bindingFile(context, id);
  const loaded = await loadBytes(file);
  if (input.expectedRevision !== loaded.revision) fail(409, 'revision_conflict', 'The board changed since it was read.');
  const attached = await canonicalAttachments(context, input.attached);
  const bytes = jsonBytes({
    format: 'hivem1nd-editor-binding-v1',
    resourceId: id,
    kind: found.entry.kind,
    attached,
    updatedAt: clock(context),
  });
  const revision = hashBytes(bytes);
  await commit(context, [record(file, loaded.revision, bytes)], [{
    name: 'editor.attachments.changed',
    resourceId: id,
    data: { resourceId: id, attached, revision },
  }]);
  return { attached, revision: hashBytes(bytes) };
}

async function canonicalAttachments(context, list) {
  if (!Array.isArray(list) || list.length > 256) fail(422, 'invalid_body', 'Attachments must be unit ids.');
  const seen = new Set();
  const attached = [];
  for (const item of list) {
    let parsed;
    try {
      parsed = parseUnitId(item);
    } catch {
      fail(422, 'invalid_unit', 'The unit id is not canonical.');
    }
    if (seen.has(parsed.id)) fail(422, 'invalid_body', 'Attachments must be unique unit ids.');
    seen.add(parsed.id);
    attached.push(parsed);
  }
  for (const parsed of attached) {
    if (!(await unitOnMind(context, parsed))) fail(422, 'unknown_unit', 'The unit does not exist.');
  }
  return attached.map((parsed) => parsed.id);
}

async function unitOnMind(context, parsed) {
  if (parsed.id === 'root:master') return true;
  const file = path.join(context.paths.mind, 'user', 'state', `${parsed.unit}.md`);
  try {
    const text = await readFile(file, 'utf8');
    return text.includes(`unit-id: ${parsed.id}`);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function sniff(bytes) {
  if (framedPng(bytes)) return { type: 'image/png', ext: 'png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

export async function createAsset(context, id, input) {
  await requireAttachment(context, id);
  const found = await resourceOf(context, id);
  const contentType = input?.contentType;
  if (contentType !== 'image/png' && contentType !== 'image/jpeg' && contentType !== 'image/webp') {
    fail(422, 'invalid_asset', 'The asset type is not supported.');
  }
  const encoded = input?.bytesBase64;
  if (typeof encoded !== 'string' || encoded.length > 16_000_000 || !strictBase64(encoded)) {
    if (typeof encoded === 'string' && encoded.length > 16_000_000) fail(413, 'asset_too_large', 'The asset is too large.');
    fail(422, 'invalid_asset', 'The asset is not strict base64.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) fail(422, 'invalid_asset', 'The asset is not strict base64.');
  if (bytes.length > ASSET_LIMIT) fail(413, 'asset_too_large', 'The asset is too large.');
  const head = bytes.subarray(0, 64).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<html') || head.startsWith('<!doctype')) fail(422, 'invalid_asset', 'The asset is not a verified image.');
  const kind = sniff(bytes);
  if (!kind || kind.type !== contentType) fail(422, 'invalid_asset', 'The asset is not a verified image.');
  const size = imageSize(bytes, kind.type);
  if (!size || size.width < 1 || size.height < 1 || size.width > 16384 || size.height > 16384) {
    fail(422, 'invalid_asset', 'The asset dimensions are not supported.');
  }
  const held = await reserveAssetQuota(context, found.project.name, bytes.length);
  try {
    const stored = input.historical === true || input.immutable === true ? { bytes, kind } : await convertedAsset(context, bytes, kind);
    const name = `${randomUUID()}.${stored.kind.ext}`;
    const relative = `docs/flows/assets/${name}`;
    const file = inside(found.project.localPath, relative);
    const revision = hashBytes(stored.bytes);
    const asset = {
      id: name,
      src: `assets/${name}`,
      contentType: stored.kind.type,
      bytes: stored.bytes.length,
      revision,
      url: `/api/v1/editors/${id}/assets/${name}`,
    };
    const quota = await settledQuota(context, found.project.name, held, stored.bytes.length);
    await commit(context, [record(file, null, stored.bytes), await rememberAsset(context, id, name), quota], [{ name: 'editor.asset.created', resourceId: id, data: { resourceId: id, asset } }]);
    return asset;
  } catch (error) {
    try {
      await releaseAssetQuota(context, found.project.name, held);
    } catch { /* a failed reservation stays counted until a later settle */ }
    throw error;
  }
}

function assetRegistryFile(context, id) {
  return path.join(context.paths.mind, 'user', 'relay', 'editors', `${id}.assets.json`);
}

async function rememberAsset(context, id, name) {
  const file = assetRegistryFile(context, id);
  const loaded = await loadBytes(file);
  const value = loaded.bytes ? parseJson(loaded.bytes) : { format: 'hivem1nd-asset-registry-v1', resourceId: id, assets: [] };
  if (!Array.isArray(value.assets)) value.assets = [];
  if (!value.assets.includes(name)) value.assets.push(name);
  return record(file, loaded.revision, jsonBytes(value));
}

function assetLimits(context) {
  return {
    count: positiveLimit(context?.assetCountLimit, ASSET_COUNT_LIMIT),
    bytes: positiveLimit(context?.assetByteLimit, ASSET_BYTE_LIMIT),
  };
}

function positiveLimit(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function quotaFile(context, project) {
  if (typeof project !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(project)) fail(422, 'invalid_project', 'The project name is not valid.');
  return path.join(context.paths.mind, 'user', 'relay', 'editors', 'quotas', `${project}.json`);
}

function freshQuota(project) {
  return { format: 'hivem1nd-asset-quota-v1', project, count: 0, bytes: 0, reservations: [] };
}

function readQuota(loaded, project) {
  const quota = loaded.bytes ? parseJson(loaded.bytes) : freshQuota(project);
  if (!Array.isArray(quota.reservations)) quota.reservations = [];
  if (!Number.isInteger(quota.count) || quota.count < 0) quota.count = 0;
  if (!Number.isInteger(quota.bytes) || quota.bytes < 0) quota.bytes = 0;
  return quota;
}

async function withQuota(context, project, change) {
  const file = quotaFile(context, project);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await loadBytes(file);
    const quota = readQuota(loaded, project);
    if (change(quota) !== true) return;
    try {
      await commit(context, [record(file, loaded.revision, jsonBytes(quota))]);
      return;
    } catch (error) {
      if (error?.code !== 'revision_conflict' || attempt === 4) throw error;
    }
  }
}

async function reserveAssetQuota(context, project, bytes) {
  const limits = assetLimits(context);
  if (bytes > limits.bytes) fail(413, 'asset_quota', 'The project asset quota is full.');
  const id = randomUUID();
  await withQuota(context, project, (quota) => {
    if (quota.count + 1 > limits.count || quota.bytes + bytes > limits.bytes) fail(413, 'asset_quota', 'The project asset quota is full.');
    quota.count += 1;
    quota.bytes += bytes;
    quota.reservations.push({ id, bytes });
    return true;
  });
  return { id, bytes };
}

async function settledQuota(context, project, held, storedBytes) {
  const limits = assetLimits(context);
  const file = quotaFile(context, project);
  const loaded = await loadBytes(file);
  const quota = readQuota(loaded, project);
  const reservation = quota.reservations.find((item) => item.id === held.id);
  if (!reservation) fail(409, 'revision_conflict', 'The asset reservation is no longer current.');
  const nextBytes = quota.bytes - reservation.bytes + storedBytes;
  if (nextBytes < 0 || nextBytes > limits.bytes) fail(413, 'asset_quota', 'The project asset quota is full.');
  quota.bytes = nextBytes;
  quota.reservations = quota.reservations.filter((item) => item.id !== held.id);
  return record(file, loaded.revision, jsonBytes(quota));
}

async function releaseAssetQuota(context, project, held) {
  await withQuota(context, project, (quota) => {
    const reservation = quota.reservations.find((item) => item.id === held.id);
    if (!reservation) return false;
    quota.count = Math.max(0, quota.count - 1);
    quota.bytes = Math.max(0, quota.bytes - reservation.bytes);
    quota.reservations = quota.reservations.filter((item) => item.id !== held.id);
    return true;
  });
}

async function convertedAsset(context, bytes, kind) {
  const directory = path.join(context.paths.localDirectory, 'media');
  const converted = await convertMedia({
    bytes,
    contentType: kind.type,
    name: `upload.${kind.ext}`,
  }, {
    directory,
    converter: context.converter,
    spawn: context.spawn,
    env: context.env,
    handles: [],
  });
  if (Array.isArray(converted?.issues) && converted.issues.length > 0) fail(422, 'invalid_asset', 'The asset is not a verified image.');
  if (converted?.converted !== true || !Buffer.isBuffer(converted.bytes)) return { bytes, kind };
  const nextKind = sniff(converted.bytes);
  const nextSize = nextKind ? imageSize(converted.bytes, nextKind.type) : null;
  if (!nextKind || nextKind.type !== converted.contentType || !nextSize || nextSize.width < 1 || nextSize.height < 1 || nextSize.width > 16384 || nextSize.height > 16384) {
    fail(422, 'invalid_asset', 'The asset is not a verified image.');
  }
  return { bytes: converted.bytes, kind: nextKind };
}

function strictBase64(value) {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  let padding = 0;
  for (let index = value.length - 1; index >= 0 && value[index] === '='; index -= 1) padding += 1;
  if (padding > 2) return false;
  const body = value.length - padding;
  for (let index = 0; index < body; index += 1) {
    const code = value.charCodeAt(index);
    const ok = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47;
    if (!ok) return false;
  }
  return true;
}

function imageSize(bytes, type) {
  if (type === 'image/png') return pngSize(bytes);
  if (type === 'image/jpeg') return jpegSize(bytes);
  return webpSize(bytes);
}

function pngSize(bytes) {
  return framedPng(bytes);
}

function framedPng(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.isBuffer(bytes) || bytes.length < signature.length + 12 || !bytes.subarray(0, signature.length).equals(signature)) return null;
  let offset = signature.length;
  let size = null;
  let ended = false;
  const image = [];
  for (let chunks = 0; chunks < 64 && offset + 12 <= bytes.length; chunks += 1) {
    const length = bytes.readUInt32BE(offset);
    if (length > 16_000_000 || offset + 12 + length > bytes.length) return null;
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const type = bytes.toString('ascii', typeStart, dataStart);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if ((crc32(bytes.subarray(typeStart, dataEnd)) >>> 0) !== bytes.readUInt32BE(dataEnd)) return null;
    if (chunks === 0 && (type !== 'IHDR' || length !== 13)) return null;
    if (ended) return null;
    if (type === 'IHDR') size = pngHeader(bytes.subarray(dataStart, dataEnd));
    if (type === 'IHDR' && !size) return null;
    if (type === 'IDAT') image.push(bytes.subarray(dataStart, dataEnd));
    offset = dataEnd + 4;
    if (type === 'IEND') {
      if (length !== 0) return null;
      ended = true;
      break;
    }
  }
  if (!ended || offset !== bytes.length || !size || image.length === 0) return null;
  const rawLength = pngRawLength(size);
  if (rawLength < 1 || rawLength > PNG_RAW_LIMIT) return null;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(image), { maxOutputLength: rawLength });
  } catch {
    return null;
  }
  if (raw.length !== rawLength || !pngFiltersValid(raw, size)) return null;
  return { width: size.width, height: size.height };
}

function pngHeader(data) {
  if (data.length !== 13) return null;
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const depth = data[8];
  const color = data[9];
  if (width < 1 || height < 1 || width > 16384 || height > 16384) return null;
  if (data[10] !== 0 || data[11] !== 0 || (data[12] !== 0 && data[12] !== 1)) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels) return null;
  const depths = color === 3 ? [1, 2, 4, 8] : (color === 0 ? [1, 2, 4, 8, 16] : [8, 16]);
  if (!depths.includes(depth)) return null;
  return { width, height, depth, channels, interlace: data[12] };
}

function pngRawLength(size) {
  if (size.interlace === 0) return size.height * pngRowBytes(size.width, size.depth, size.channels);
  const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  let total = 0;
  for (const [x0, y0, dx, dy] of passes) {
    if (size.width <= x0 || size.height <= y0) continue;
    const width = Math.ceil((size.width - x0) / dx);
    const height = Math.ceil((size.height - y0) / dy);
    total += height * pngRowBytes(width, size.depth, size.channels);
  }
  return total;
}

function pngRowBytes(width, depth, channels) {
  return 1 + Math.ceil((width * depth * channels) / 8);
}

function pngFiltersValid(raw, size) {
  const rows = size.interlace === 0
    ? [[size.width, size.height]]
    : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]].map(([x0, y0, dx, dy]) => {
      if (size.width <= x0 || size.height <= y0) return [0, 0];
      return [Math.ceil((size.width - x0) / dx), Math.ceil((size.height - y0) / dy)];
    });
  let offset = 0;
  for (const [width, height] of rows) {
    if (width < 1 || height < 1) continue;
    const row = pngRowBytes(width, size.depth, size.channels);
    for (let line = 0; line < height; line += 1) {
      if (raw[offset] > 4) return false;
      offset += row;
    }
  }
  return offset === raw.length;
}

function jpegSize(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xc2) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes) {
  if (bytes.length < 30) return null;
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export async function readAsset(context, id, assetId) {
  await requireAttachment(context, id);
  const found = await resourceOf(context, id);
  if (typeof assetId !== 'string' || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(assetId)) fail(404, 'not_found', 'The asset does not exist.');
  const file = inside(found.project.localPath, `docs/flows/assets/${assetId}`);
  const document = await loadBytes(inside(found.project.localPath, found.entry.path));
  const text = document.bytes ? document.bytes.toString('utf8') : '';
  const registry = await loadBytes(assetRegistryFile(context, id));
  const listed = registry.bytes ? (parseJson(registry.bytes).assets ?? []) : [];
  const referenced = text.includes(`docs/flows/assets/${assetId}`) || text.includes(`assets/${assetId}`);
  if (!listed.includes(assetId) && !referenced) fail(404, 'not_found', 'The asset is not referenced.');
  await contained(found.project.localPath, file);
  const loaded = await loadBytes(file);
  if (!loaded.bytes) fail(404, 'not_found', 'The asset does not exist.');
  const head = loaded.bytes.subarray(0, 64).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<html') || head.startsWith('<!doctype')) fail(422, 'invalid_asset', 'The asset is not a verified image.');
  const kind = sniff(loaded.bytes);
  const size = kind ? imageSize(loaded.bytes, kind.type) : null;
  if (!kind || !size || size.width < 1 || size.height < 1 || size.width > 16384 || size.height > 16384 || !assetId.endsWith(`.${kind.ext}`)) {
    fail(422, 'invalid_asset', 'The asset is not a verified image.');
  }
  return { bytes: loaded.bytes, type: kind.type, revision: hashBytes(loaded.bytes) };
}

function clock(context) {
  return new Date(context.now?.() ?? Date.now()).toISOString();
}

function actor(context) {
  const principal = context.principal ?? { audience: 'desktop', unitId: 'root:master' };
  if (principal.audience === 'agent') return { author: principal.unitId, authorId: principal.unitId };
  return { author: 'master', authorId: principal.unitId ?? 'root:master' };
}

export async function requireAttachment(context, resourceId) {
  const principal = context.principal ?? {};
  const audience = principal.audience ?? context.credential?.audience ?? 'desktop';
  const unitId = principal.unitId ?? context.credential?.unitId ?? null;
  const binding = await readAttachments(context, resourceId);
  if (audience === 'agent' && !binding.attached.includes(unitId)) {
    fail(403, 'forbidden', 'The agent is not attached to that resource.');
  }
  return binding;
}

async function shown(context, entry, document, revision) {
  return projectEditor(context, entry, document, revision);
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
  if (!Array.isArray(document.pages) || document.pages.length > PAGE_LIMIT) fail(422, 'invalid_document', 'The text needs at most 2000 pages.');
  if (Buffer.byteLength(JSON.stringify(document)) > TEXT_LIMIT) fail(413, 'resource_too_large', 'The text is larger than 16 MB.');
  const keys = new Set();
  for (const page of document.pages) {
    if (!page || typeof page !== 'object' || typeof page.k !== 'string' || page.k.length < 1 || page.k.length > 240) fail(422, 'invalid_document', 'Each page needs a stable key.');
    if (keys.has(page.k)) fail(422, 'invalid_document', 'A page key is used twice.');
    keys.add(page.k);
    for (const [key, item] of Object.entries(page)) {
      if (key === 'k') continue;
      if (/^[a-z]{2,3}$/.test(key) && typeof item !== 'string') fail(422, 'invalid_document', 'A language value must be text.');
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
  ], [voidEvent(id, hashBytes(bytes), document.rev, 'create')]);
  rememberExternal(context, id, hashBytes(bytes), document);
  connectExternal(context, id, full);
  return shown(context, entry, document, hashBytes(bytes));
}

function voidEvent(id, revision, rev, operation, k = null, lang = null) {
  return { name: 'void.changed', resourceId: id, revision, data: { resourceId: id, revision, rev, operation, k, lang } };
}

function connectExternal(context, id, file) {
  if (!context.watch) return;
  startResourceWatch(context.watch, id, file);
  context.watch.pending = (resourceId) => {
    observeExternal(context, resourceId).catch(() => {});
  };
}

export async function replaceText(context, id, input) {
  const found = await textBundle(context, id);
  await requireAttachment(context, found.entry.id);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The text changed since it was read.');
  const incoming = validateText(input.document);
  preserveUnknown(found.document, incoming);
  const changes = textChanges(found.document, incoming);
  incoming.rev = (found.document.rev || 0) + (changes.length > 0 ? 1 : 0);
  if (changes.length === 0 && canonicalJson(found.document) === canonicalJson(incoming)) {
    return shown(context, found.entry, found.document, found.loaded.revision);
  }
  const bytes = jsonBytes(incoming);
  const entries = [record(found.file, found.loaded.revision, bytes)];
  const orig = `${stemOf(found.file)}.orig.json`;
  const origLoaded = await loadBytes(orig);
  if (!origLoaded.bytes) entries.push(record(orig, null, found.loaded.bytes));
  else entries.push(record(orig, origLoaded.revision, origLoaded.bytes));
  const comments = await loadComments(found);
  if (comments.bytes) entries.push(record(comments.file, comments.revision, comments.bytes));
  if (changes.length > 0) {
    const versions = `${stemOf(found.file)}.versions.jsonl`;
    const history = await loadBytes(versions);
    const at = clock(context);
    const lines = `${changes.map((change) => JSON.stringify({ at, rev: incoming.rev, ...change })).join('\n')}\n`;
    entries.push(record(versions, history.revision, Buffer.concat([history.bytes ?? Buffer.alloc(0), Buffer.from(lines)])));
  }
  const revision = hashBytes(bytes);
  await commit(context, entries, [voidEvent(id, revision, incoming.rev, 'replace')]);
  rememberExternal(context, id, revision, incoming);
  return shown(context, found.entry, incoming, revision);
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
  await requireAttachment(context, found.entry.id);
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The text changed since it was read.');
  const page = found.document.pages.find((item) => item.k === input.k);
  if (!page || typeof page[input.lang] !== 'string') fail(422, 'invalid_range', 'The page language does not exist.');
  const mode = input.mode ?? 'apply';
  if (mode !== 'apply' && mode !== 'propose') fail(422, 'invalid_body', 'The mode must be apply or propose.');
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
  const rangeComments = await loadComments(found);
  if (rangeComments.bytes) entries.push(record(rangeComments.file, rangeComments.revision, rangeComments.bytes));
  const revision = hashBytes(bytes);
  await commit(context, entries, [voidEvent(id, revision, document.rev, 'replace-range', input.k, input.lang)]);
  rememberExternal(context, id, revision, document);
  return { editor: await shown(context, found.entry, document, revision), proposal: null };
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
  const notices = await noticePlan(context, message.id, found.entry.id, recipientsFor(context, (await readAttachments(context, found.entry.id)).attached, authorId));
  await admitComment(context, message.id);
  await commit(context, [record(comments.file, comments.revision, bytes), ...notices.entries], [
    { name: 'comment.changed', resourceId: found.entry.id, data: { resourceId: found.entry.id, thread, commentsRevision: revision, operation: 'reply' } },
    { name: 'void.proposal.changed', resourceId: found.entry.id, data: { resourceId: found.entry.id, proposal: { ...message.proposal, resourceId: found.entry.id, threadId: thread.id, commentsRevision: revision }, commentsRevision: revision } },
    ...notices.events,
  ]);
  return { editor: await shown(context, found.entry, found.document, found.loaded.revision), proposal: { ...message.proposal, resourceId: found.entry.id, threadId: thread.id, commentsRevision: revision } };
}

export async function listProposals(context, id, query = {}) {
  await requireAttachment(context, id);
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
  if (input.expectedCommentsRevision !== comments.revision) fail(409, 'revision_conflict', 'The comments changed since they were read.');
  let message = null;
  let thread = null;
  for (const item of comments.value.threads) {
    message = (item.messages ?? []).find((entry) => entry.proposal?.id === proposalId) ?? null;
    if (message) { thread = item; break; }
  }
  if (!message) fail(404, 'not_found', 'The proposal does not exist.');
  if (message.proposal.state !== 'pending') fail(409, 'proposal_resolved', 'The proposal was already answered.');
  if (input.decision !== 'accept' && input.decision !== 'discard') fail(422, 'invalid_body', 'The decision must be accept or discard.');
  if (input.decision === 'accept' && message.proposal.baseRevision !== found.loaded.revision) {
    fail(409, 'proposal_stale', 'The proposal no longer matches the text.');
  }
  if (input.expectedRevision !== found.loaded.revision) fail(409, 'revision_conflict', 'The text changed since it was read.');
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
    return { editor: await shown(context, found.entry, found.document, found.loaded.revision), proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision: revision } };
  }
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
    voidEvent(id, revision, document.rev, 'replace-range', message.proposal.k, message.proposal.lang),
    { name: 'void.proposal.changed', resourceId: id, data: { resourceId: id, proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision }, commentsRevision } },
  ]);
  rememberExternal(context, id, revision, document);
  return { editor: await shown(context, found.entry, document, revision), proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision } };
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
  await requireAttachment(context, id);
  const found = await resourceOf(context, id);
  const loaded = await loadComments(found);
  const projected = projectComments(loaded.value, found.entry.id);
  const status = query.status ?? 'all';
  const threads = (projected.threads ?? []).filter((thread) => status === 'all' || thread.status === status);
  const pages = found.entry.kind === 'void' ? await currentPages(context, found) : [];
  const board = found.entry.kind === 'blueprint' ? parseJson((await loadBytes(inside(found.project.localPath, found.entry.path))).bytes ?? Buffer.from('{}')) : null;
  const items = [];
  for (const thread of threads) {
    items.push(await presentThread(context, thread, found.entry.id, loaded.revision, found.entry.kind === 'void' ? place(pages, thread) : blueprintPlace(board, thread)));
  }
  return { items, commentsRevision: loaded.revision };
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
  await requireAttachment(context, found.entry.id);
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
  const notices = await noticePlan(context, messageId, id, recipientsFor(context, (await readAttachments(context, found.entry.id)).attached, authorId));
  await admitComment(context, messageId);
  await commit(context, [record(comments.file, comments.revision, bytes), ...notices.entries], [
    { name: 'comment.changed', resourceId: id, data: { resourceId: id, thread: projectComments({ threads: [thread] }, id).threads[0], commentsRevision: revision, operation: 'create' } },
    ...notices.events,
  ]);
  const derived = found.entry.kind === 'void' ? place(document.pages, thread) : blueprintPlace(document, thread);
  return { thread: await presentThread(context, thread, id, revision, derived), commentsRevision: revision };
}

export async function replyComment(context, id, threadId, input) {
  const found = await resourceOf(context, id);
  await requireAttachment(context, found.entry.id);
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
  const notices = await noticePlan(context, message.id, id, recipientsFor(context, (await readAttachments(context, found.entry.id)).attached, authorId));
  await admitComment(context, message.id);
  await commit(context, [record(comments.file, comments.revision, bytes), ...notices.entries], [
    { name: 'comment.changed', resourceId: id, data: { resourceId: id, thread, commentsRevision: revision, operation: 'reply' } },
    ...notices.events,
  ]);
  return { thread: await presentThread(context, thread, id, revision, null), commentsRevision: revision };
}

async function presentThread(context, thread, resourceId, commentsRevision, derived) {
  const projected = projectComments({ threads: [thread] }, resourceId).threads[0];
  return {
    ...projected,
    revision: commentsRevision,
    place: derived ?? null,
    notifications: await notificationsFor(context, projected),
  };
}

async function notificationsFor(context, thread) {
  if (!context.paths?.mind) return [];
  const items = [];
  for (const message of thread.messages ?? []) {
    if (!message.id) continue;
    const loaded = await loadBytes(path.join(context.paths.mind, 'user', 'relay', 'fanout', `${message.id}.json`));
    if (!loaded.bytes) continue;
    for (const notice of parseJson(loaded.bytes).notices ?? []) {
      const state = notice.state === 'submitted' || notice.state === 'ambiguous' || notice.state === 'failed' ? notice.state : 'pending';
      items.push({ unitId: notice.unitId, state });
    }
  }
  return items;
}

function blueprintPlace(document, thread) {
  const anchor = thread?.anchor;
  if (!anchor || (anchor.screen == null && anchor.element == null)) return null;
  const screen = (document?.screens ?? []).find((item) => item.id === anchor.screen);
  const node = anchor.element ? findNode(document, anchor.element)?.node : null;
  if (anchor.element && !node) return null;
  if (anchor.screen && !screen) return null;
  return {
    screenId: anchor.screen ?? null,
    nodeId: anchor.element ?? null,
    x: Number.isInteger(anchor.point?.x) ? anchor.point.x : node?.place?.x ?? 0,
    y: Number.isInteger(anchor.point?.y) ? anchor.point.y : node?.place?.y ?? 0,
  };
}

export async function setCommentStatus(context, id, threadId, input) {
  const found = await resourceOf(context, id);
  await requireAttachment(context, found.entry.id);
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
  return { thread: await presentThread(context, thread, id, revision, null), commentsRevision: revision };
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
  const change = changes[0];
  await commit(context, [history.entry], [voidEvent(id, loaded.revision, document.rev || 0, 'import', change.k, change.lang)]);
  return { changed: true };
}

export { findAnchor, place };

