import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { validateSketch, SketchError } from '../../features/blueprint/review/sketch-format.mjs';
import { prepareLegacyExport } from '../../features/blueprint/server.mjs';
import { CoreError, canonicalJson, hashBytes, hashText, isUuid, parseUnitId, uuidV8 } from './identity.mjs';
import { paginate } from './projection.mjs';
import { admitMessage } from '../sync/limits.mjs';
import { createAnchor, findAnchor, place } from '../../features/void/comments.mjs';
import { plain } from '../../features/void/text.mjs';
import { boundaryInsideTag, tokenizeMarkup, validUtf16Boundary } from '../../gui/app/markup.mjs';
import { assertNoLinks } from './paths.mjs';
import { bindProjects, checkRevision, commitChange, prepareChangeUndo, prepareReplaceUndo, readReplaceUndo, readBytes, revisionOf, withLocalChanges, withLocks } from './store.mjs';
import { openSync } from '../sync/store.mjs';
import { convertMedia, webpPayload } from '../sync/media.mjs';
import { clearResource, startResourceWatch } from './watch.mjs';
import { readUnitState } from './state.mjs';

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
  const found = (context.projects ?? []).find((item) => item.name === name && item.eligible !== false);
  if (!found?.localPath) fail(409, 'project_unavailable', 'The project is not available on this machine.');
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

async function loadBytes(file, store = null) {
  await assertNoLinks(file);
  if (store) {
    const bytes = await readBytes(store, file);
    return { bytes, revision: revisionOf(bytes) };
  }
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
  const loaded = await loadBytes(catalogFile(context), context.store);
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
    folderId: null,
    updatedAt: null,
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
    folderId: editor.folderId,
    updatedAt: editor.updatedAt,
  };
}

async function projectEditor(context, entry, document, revision) {
  const binding = await readAttachments(context, entry.id);
  const comments = await loadComments(await resourceOf(context, entry.id));
  const threads = comments.bytes ? (projectComments(comments.value, entry.id).threads ?? []) : [];
  const library = await loadLibrary(context, entry.project);
  const item = library.value.items[entry.id];
  const times = await Promise.all([inside(library.project.localPath, entry.path), comments.file].map((file) => lstat(file).then((stat) => stat.mtimeMs).catch((error) => { if (error.code === 'ENOENT') return 0; throw error; })));
  return {
    id: entry.id,
    kind: entry.kind,
    project: entry.project,
    title: item?.title ?? document?.title ?? entry.title ?? entry.legacyId ?? '',
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
    folderId: item?.folderId ?? null,
    updatedAt: item?.updatedAt ?? (Math.max(...times) ? new Date(Math.max(...times)).toISOString() : null),
    libraryRevision: library.revision,
  };
}

export function preserveUnknown(before, after, known = NONE) {
  walk(before, after, known);
  return true;
}

const NONE = new Set();
// Fields this product writes itself and may legitimately be absent from an earlier version, such as the start
// screen a frame sets on its page. A restore may drop them; an unknown field from a newer client is still kept.
const KNOWN_OPTIONAL = new Set(['start']);

function walk(left, right, known = NONE) {
  if (Array.isArray(left)) {
    if (!Array.isArray(right)) fail(409, 'unsupported_fields_lost', 'A saved field was dropped.');
    for (const item of left) {
      if (!item || typeof item !== 'object') continue;
      const key = item.id != null ? 'id' : item.k != null ? 'k' : null;
      if (!key) continue;
      const match = right.find((entry) => entry && entry[key] === item[key]);
      if (match) walk(item, match, known);
    }
    return;
  }
  if (!left || typeof left !== 'object') return;
  if (!right || typeof right !== 'object' || Array.isArray(right)) fail(409, 'unsupported_fields_lost', 'A saved field was dropped.');
  for (const key of Object.keys(left)) {
    if (!Object.hasOwn(right, key)) {
      if (known.has(key)) continue;
      fail(409, 'unsupported_fields_lost', 'A saved field was dropped.');
    }
    walk(left[key], right[key], known);
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
      recordPath: resolved,
      beforeBytes: entry.beforeBytes,
      operation: entry.operation,
    };
  }
  return entry;
}

async function commit(context, entries, events = [], response) {
  return withLocalChanges(context.store, () => commitEditor(context, entries, events, response));
}

async function commitEditor(context, entries, events, response, replaceUndo = null) {
  bindProjects(context.store, context.projects ?? []);
  await historyEdits(context, entries, events);
  await libraryEdits(context, entries, events);
  if (response?.body?.id) {
    const resource = response.body;
    const library = entries.find((entry) => entry.recordPath === inside(projectOf(context, resource.project).localPath, 'docs/flows/library.json'));
    if (library) Object.assign(resource, parseJson(library.afterBytes).items[resource.id], { libraryRevision: hashBytes(library.afterBytes) });
  }
  for (const editor of response?.body?.editor ? [response.body.editor] : response?.body?.editors ?? []) {
    const library = entries.find((entry) => entry.recordPath === inside(projectOf(context, editor.project).localPath, 'docs/flows/library.json'));
    if (library) Object.assign(editor, parseJson(library.afterBytes).items[editor.id], { libraryRevision: hashBytes(library.afterBytes) });
  }
  const prepared = entries.map((entry) => rewriteEntry(context, entry));
  for (const entry of prepared) {
    if (entry.target && entry.afterBytes?.length > TEXT_LIMIT) fail(413, 'resource_too_large', 'An editor object exceeds 16 MB.');
    const file = entry.target
      ? path.resolve((context.projects ?? []).find((item) => item.name === entry.target.project)?.localPath ?? '', ...entry.target.path.split('/'))
      : entry.recordPath;
    if (file) await assertNoLinks(file);
  }
  const id = replaceUndo?.id ?? (response?.body?.undoOf ? response.body.changeId : randomUUID());
  if (replaceUndo) prepared.push(prepareReplaceUndo(context, id, replaceUndo.resourceIds, replaceUndo.entries.map((entry) => rewriteEntry(context, entry))));
  const result = await commitChange(context, { id, entries: prepared, events, response });
  const { listStaged } = await import('../sync/store.mjs');
  const sync = context.sync ?? openSync({ store: context.store, paths: context.paths, now: context.now, projects: context.projects ?? [] });
  context.lastEditorChanges = (await listStaged(sync)).filter((change) => change.transactionId === id);
  return result;
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
      if (voidSidecar(name) || name === 'index.json' || name === 'library.json' || relative === 'flows' && name === 'history') continue;
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

// A mind that was migrated holds its boards in the projects but has no register of them. The first time a project is read,
// the boards it already holds in its flows folder are registered in one change, so they list
// without anyone registering them by hand. A board that cannot be read is left out and the rest still list.
const BOARD_PLACES = [['docs/flows/boards', 'index.json']];
const foundProjects = new WeakMap();

export async function registerFound(context, names) {
  const key = context.store ?? context.paths;
  if (!key || typeof key !== 'object') return 0;
  const done = foundProjects.get(key) ?? new Set();
  foundProjects.set(key, done);
  const fresh = names.filter((name) => !done.has(name));
  if (!fresh.length) return 0;
  for (const name of fresh) done.add(name);
  const catalog = await readCatalog(context);
  const known = new Set(catalog.value.resources.map((item) => `${item.project}\u0000${item.path}`));
  const added = [];
  for (const name of fresh) {
    const project = (context.projects ?? []).find((item) => item.name === name && item.eligible !== false && item.localPath);
    if (!project) { done.delete(name); continue; }
    for (const [place, skip] of BOARD_PLACES) {
      let files = [];
      try { files = await readdir(inside(project.localPath, place)); } catch { continue; }
      for (const file of files.sort()) {
        if (file === skip || !/\.(json|mjs)$/.test(file) || known.has(`${name}\u0000${place}/${file}`)) continue;
        const relative = `${place}/${file}`;
        try {
          const loaded = await loadBytes(inside(project.localPath, relative));
          if (!loaded.bytes) continue;
          const readOnly = file.endsWith('.mjs');
          const document = readOnly ? null : validateBoard(parseJson(loaded.bytes));
          added.push({ id: editorId('blueprint', name, relative), kind: 'blueprint', project: name, path: relative,
            legacyId: document?.id ?? file.replace(/\.(json|mjs)$/, ''), readOnly, attached: [] });
        } catch { /* This board is not readable; it stays out of the register. */ }
      }
    }
  }
  if (!added.length) return 0;
  await commit(context, [record(catalogFile(context), catalog.revision, jsonBytes({ ...catalog.value, resources: [...catalog.value.resources, ...added] }))]);
  return added.length;
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

export function editorSearchText(editor) {
  const values = [editor.title, editor.path, editor.id];
  for (const screen of editor.document?.screens ?? []) {
    values.push(screen.title);
    const walk = (node) => {
      if (!node) return;
      values.push(node.name, node.value);
      for (const child of node.kids ?? []) walk(child);
    };
    walk(screen.root);
  }
  for (const page of editor.document?.pages ?? []) {
    for (const [key, value] of Object.entries(page)) {
      if (key !== 'k' && typeof value === 'string') values.push(value);
    }
  }
  for (const thread of editor.threads ?? []) {
    for (const message of thread.messages ?? []) values.push(message.text);
  }
  return values.filter((value) => typeof value === 'string').join('\n').toLowerCase();
}

export async function list(context, query = {}) {
  if (query.q != null && String(query.q).length > 200) fail(422, 'invalid_query', 'The search is longer than 200 characters.');
  const names = query.project ? [query.project] : (context.projects ?? []).map((item) => item.name);
  if (!query.kind || query.kind === 'blueprint') await registerFound(context, names).catch(() => 0);
  const catalog = await readCatalog(context);
  const editors = [];
  const issues = [];
  for (const name of names) {
    let project;
    try { project = (await loadLibrary(context, name)).project; }
    catch (error) { issues.push({ project: name, code: error.code ?? 'project_unavailable', message: 'The project library is not available.' }); continue; }
    for (const entry of catalog.value.resources) {
      if (entry.project !== project.name) continue;
      if (query.kind && entry.kind !== query.kind) continue;
      try {
        const file = inside(project.localPath, entry.path);
        const loaded = await loadBytes(file, context.store);
        let document = null;
        if (!entry.readOnly && loaded.bytes) {
          try {
            document = JSON.parse(loaded.bytes.toString('utf8'));
          } catch {
            document = null;
          }
        }
        if (!loaded.bytes) issues.push({ project: name, resourceId: entry.id, code: 'corrupt_resource', message: 'The library document is not available.' });
        editors.push(await projectEditor(context, entry, document, loaded.revision));
      } catch (error) {
        issues.push({ project: name, resourceId: entry.id, code: error.code ?? 'corrupt_resource', message: 'The library item is not available.' });
      }
    }
  }
  editors.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const needle = query.q == null || query.q === '' ? '' : String(query.q).toLowerCase();
  let matched = needle
    ? editors.filter((item) => editorSearchText(item).includes(needle))
    : editors;
  if (query.folderId !== undefined) {
    if (!isUuid(query.folderId)) fail(422, 'invalid_query', 'The folder id must be a UUID.');
    matched = matched.filter((item) => item.folderId === query.folderId);
  }
  const monday = new Date(context.now?.() ?? Date.now());
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  for (const key of ['openComments', 'attachedAgents', 'changedThisWeek']) {
    if (query[key] === undefined) continue;
    if (![true, false, 'true', 'false'].includes(query[key])) fail(422, 'invalid_query', 'Library filters must be boolean.');
    if (query[key] === true || query[key] === 'true') matched = matched.filter((item) => key === 'openComments' ? item.openThreads > 0 : key === 'attachedAgents' ? item.attached.length > 0 : Date.parse(item.updatedAt) >= monday.getTime());
  }
  const snapshot = hashText(canonicalJson(matched.map((item) => [item.id, item.revision, item.libraryRevision, item.attachmentRevision, item.commentsRevision, item.openThreads, item.attached, item.activity])));
  return { ...paginate(matched.map(summaryOf), {
    limit: query.limit,
    cursor: query.cursor || null,
    filters: { project: query.project ?? null, kind: query.kind ?? null, q: query.q ?? null, folderId: query.folderId ?? null,
      openComments: query.openComments ?? null, attachedAgents: query.attachedAgents ?? null, changedThisWeek: query.changedThisWeek ?? null },
    snapshot,
  }), issues };
}

async function resourceOf(context, id) {
  if (!isUuid(id)) fail(404, 'not_found', 'The resource does not exist.');
  const catalog = await readCatalog(context);
  const entry = entryOf(catalog, id);
  if (!entry) fail(404, 'not_found', 'The resource does not exist.');
  const project = projectOf(context, entry.project);
  return { project, catalog, entry, store: context.store };
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
  const library = await loadLibrary(context, project.name);
  validateFolder(library, input.folderId ?? null, 'blueprint');
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
    attached: await canonicalAttachments(context, input.attached ?? []),
  };
  const nextCatalog = { ...catalog.value, resources: [...catalog.value.resources, entry] };
  const nextIndex = mergeIndex(index.bytes ? parseJson(index.bytes) : null, document);
  const sidecar = { board: document.id, threads: [] };
  const bytes = jsonBytes(document);
  library.value.items[entry.id] = { folderId: input.folderId ?? null, title: document.title, updatedAt: clock(context) };
  const editor = createdEditor(context, entry, document, bytes, jsonBytes(sidecar), library);
  await commit(context, [
    ...(context.createGuards ?? []),
    ...(context.initialAssets ?? []),
    record(full, null, bytes),
    record(catalogFile(context), catalog.revision, jsonBytes(nextCatalog)),
    record(indexFile(project), index.revision, jsonBytes(nextIndex)),
    record(commentsFile(project, document.id), null, jsonBytes(sidecar)),
    record(library.file, library.revision, jsonBytes(library.value)),
    ...await initialHistory(context, entry, bytes, jsonBytes(sidecar)),
  ], boardEvents(context, entry.id, hashBytes(bytes), 'create', null, null), { status: 201, body: editor });
  return editor;
}

export async function readLegacyExport(context, id) {
  desktopLibrary(context);
  const found = await resourceOf(context, id);
  try {
    return await prepareLegacyExport(found.project, found.entry);
  } catch (error) {
    if (error instanceof CoreError && ['unsafe_path', 'import_unavailable'].includes(error.code)) throw error;
    fail(422, 'import_unavailable', 'This registered board cannot be exported.');
  }
}

export async function importBoard(context, input) {
  desktopLibrary(context);
  return withLocalChanges(context.store, async () => {
    const found = await resourceOf(context, input.legacyResourceId);
    const exported = await readLegacyExport(context, input.legacyResourceId);
    if (input.project !== found.entry.project || input.path !== exported.path) fail(422, 'invalid_path', 'The JSON copy must be beside its registered module.');
    if (input.expectedRevision !== exported.expectedRevision) fail(409, 'revision_conflict', 'The module changed since it was exported.');
    if (canonicalJson(input.document?.legacySource ?? null) !== canonicalJson(exported.sourceRevisions)) fail(409, 'revision_conflict', 'The source or kit changed since it was exported.');
    const document = validateBoard(input.document);
    if (document.id !== found.entry.legacyId || !document.screens.length) fail(422, 'import_unavailable', 'The export must contain the selected board.');
    if (exported.sketch && canonicalJson(document.legacySketch ?? null) !== canonicalJson(exported.sketch)) fail(422, 'import_unavailable', 'The export must retain the existing sketch.');
    if (exported.sketch) {
      for (const key of ['pages', 'screens', 'links']) for (const item of exported.sketch[key]) {
        if (canonicalJson(document[key].find((candidate) => candidate.id === item.id) ?? null) !== canonicalJson(item)) fail(422, 'import_unavailable', 'The export must retain every sketch item.');
      }
    }
    document.title = libraryTitle(input.title);
    const library = await loadLibrary(context, input.project);
    validateFolder(library, input.folderId, 'blueprint');
    const file = inside(found.project.localPath, input.path);
    const existing = await loadBytes(file);
    const id = editorId('blueprint', input.project, input.path);
    if (existing.bytes || found.catalog.value.resources.some((item) => item.id === id || item.project === input.project && item.legacyId === document.id && item.id !== found.entry.id)) fail(409, 'resource_exists', 'The JSON copy already exists.');
    const entry = { id, kind: 'blueprint', project: input.project, path: input.path, legacyId: document.id, readOnly: false, attached: [...(found.entry.attached ?? [])], importedFrom: found.entry.id };
    const catalog = { ...found.catalog.value, resources: [...found.catalog.value.resources.map((item) => item.id === found.entry.id ? { ...item, convertedTo: id } : item), entry] };
    const index = await loadBytes(indexFile(found.project));
    const nextIndex = mergeIndex(parseJson(index.bytes), document);
    for (const item of Array.isArray(nextIndex) ? nextIndex : nextIndex.boards) if (item.id === document.id) Object.assign(item, { path: input.path, resourceId: id, legacyPath: found.entry.path });
    const comments = await loadComments(found);
    const sidecar = comments.bytes ?? jsonBytes(comments.value);
    const bytes = jsonBytes(document);
    library.value.items[id] = { folderId: input.folderId, title: document.title, updatedAt: clock(context) };
    const editor = createdEditor(context, entry, document, bytes, sidecar, library);
    checkRevision((await loadBytes(inside(found.project.localPath, found.entry.path))).bytes, input.expectedRevision);
    await commit(context, [record(file, null, bytes), record(catalogFile(context), found.catalog.revision, jsonBytes(catalog)),
      record(indexFile(found.project), index.revision, jsonBytes(nextIndex)), record(library.file, library.revision, jsonBytes(library.value)),
      ...(!comments.bytes ? [record(comments.file, null, sidecar)] : []), ...await initialHistory(context, entry, bytes, sidecar)],
    boardEvents(context, id, hashBytes(bytes), 'import', null, null), { status: 201, body: editor });
    return editor;
  });
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
  const loaded = await loadBytes(bindingFile(context, id), context.store);
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
  const state = await readUnitState(context, parsed);
  return Boolean(state && !/^removed: true\r?$/m.test(state.bytes.toString('utf8')));
}

function sniff(bytes) {
  if (framedPng(bytes)) return { type: 'image/png', ext: 'png' };
  if (jpegSize(bytes)) return { type: 'image/jpeg', ext: 'jpg' };
  if (webpPayload(bytes)) return { type: 'image/webp', ext: 'webp' };
  return null;
}

export function imageComplete(bytes, contentType) {
  if (contentType === 'image/png') return Boolean(framedPng(bytes));
  if (contentType === 'image/jpeg') return Boolean(jpegSize(bytes));
  if (contentType === 'image/webp') return Boolean(webpPayload(bytes));
  return false;
}

// The type, extension and size of bytes that are a whole PNG, JPEG or WebP image, or null. A picture in a chat is
// checked as strictly as one on a board.
export function verifiedImage(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  const head = bytes.subarray(0, 64).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<html') || head.startsWith('<!doctype')) return null;
  const kind = sniff(bytes);
  const size = kind ? imageSize(bytes, kind.type) : null;
  if (!kind || !size || size.width < 1 || size.height < 1 || size.width > 16384 || size.height > 16384) return null;
  return { type: kind.type, ext: kind.ext, width: size.width, height: size.height };
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

export function strictBase64(value) {
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
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let size = null;
  let sawScan = false;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) return size && sawScan && offset === bytes.length ? size : null;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xc2) {
      if (length < 8) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (width < 1 || height < 1 || width > 16384 || height > 16384) return null;
      size = { width, height };
    }
    if (marker === 0xda) {
      if (!size) return null;
      sawScan = true;
      offset += length;
      while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        let mark = offset + 1;
        while (mark < bytes.length && bytes[mark] === 0xff) mark += 1;
        if (mark >= bytes.length) return null;
        const next = bytes[mark];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          offset = mark + 1;
          continue;
        }
        offset = mark - 1;
        break;
      }
      continue;
    }
    offset += length;
  }
  return null;
}

function webpSize(bytes) {
  return webpPayload(bytes);
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
  const loaded = await loadBytes(file, found.store);
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
  externalState(context);
  context.externalHashes.set(id, revision);
  if (document) context.snapshots.set(id, document);
}

function externalState(context) {
  const state = context.store.editorExternal ??= {
    hashes: context.externalHashes ?? new Map(),
    snapshots: context.snapshots ?? new Map(),
    issues: context.externalIssues ?? new Map(),
  };
  context.externalHashes ??= state.hashes;
  context.snapshots ??= state.snapshots;
  context.externalIssues ??= state.issues;
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
  const library = await loadLibrary(context, project.name);
  validateFolder(library, input.folderId ?? null, 'void');
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
    attached: await canonicalAttachments(context, input.attached ?? []),
  };
  const bytes = jsonBytes(document);
  const comments = { path: path.basename(relative), threads: [] };
  const nextCatalog = { ...catalog.value, resources: [...catalog.value.resources, entry] };
  library.value.items[id] = { folderId: input.folderId ?? null, title: document.title, updatedAt: clock(context) };
  const editor = createdEditor(context, entry, document, bytes, jsonBytes(comments), library);
  await commit(context, [
    ...(context.createGuards ?? []),
    ...(context.initialAssets ?? []),
    record(full, null, bytes),
    record(`${stemOf(full)}.orig.json`, null, bytes),
    record(`${stemOf(full)}.comments.json`, null, jsonBytes(comments)),
    record(catalogFile(context), catalog.revision, jsonBytes(nextCatalog)),
    record(library.file, library.revision, jsonBytes(library.value)),
    ...await initialHistory(context, entry, bytes, jsonBytes(comments)),
  ], [voidEvent(id, hashBytes(bytes), document.rev, 'create')], { status: 201, body: editor });
  rememberExternal(context, id, hashBytes(bytes), document);
  connectExternal(context, id, full);
  return editor;
}

function voidEvent(id, revision, rev, operation, k = null, lang = null) {
  return { name: 'void.changed', resourceId: id, revision, data: { resourceId: id, revision, rev, operation, k, lang } };
}

function connectExternal(context, id, file) {
  if (!context.watch || context.store.localChangesWatched) return;
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
  incoming.rev = found.document.rev ?? 0;
  if (Object.hasOwn(found.document, 'history')) incoming.history = structuredClone(found.document.history);
  else delete incoming.history;
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

function assertRange(source, start, end, insideSyntax = (offset) => boundaryInsideTag(source, offset)) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) fail(422, 'invalid_range', 'The range is outside the text.');
  const splitsPair = (index) => {
    if (index <= 0 || index >= source.length) return false;
    const previous = source.charCodeAt(index - 1);
    const here = source.charCodeAt(index);
    return previous >= 0xd800 && previous <= 0xdbff && here >= 0xdc00 && here <= 0xdfff;
  };
  if (splitsPair(start) || splitsPair(end)) fail(422, 'invalid_range', 'The range splits a character.');
  if (insideSyntax(start) || insideSyntax(end)) fail(422, 'invalid_range', 'The range splits markup syntax.');
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

export async function replaceTextMatches(context, input) {
  desktopLibrary(context);
  const fields = ['resourceId', 'k', 'lang', 'start', 'end', 'expectedText', 'replacement', 'expectedRevision'];
  if (!input || Object.keys(input).some((key) => !['items', 'expectedCommentsRevisions'].includes(key))) fail(400, 'unknown_field', 'The replace body has an unknown field.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 10000
    || !input.expectedCommentsRevisions || typeof input.expectedCommentsRevisions !== 'object' || Array.isArray(input.expectedCommentsRevisions)) {
    fail(422, 'invalid_body', 'Replace needs 1 to 10000 matches and their comments revisions.');
  }
  for (const item of input.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(422, 'invalid_body', 'A replace item must be an object.');
    if (Object.keys(item).some((key) => !fields.includes(key))) fail(400, 'unknown_field', 'A replace item has an unknown field.');
    if (fields.some((key) => !Object.hasOwn(item, key)) || !isUuid(item.resourceId)
      || typeof item.k !== 'string' || !item.k || item.k.length > 240 || !/^[a-z]{2,3}$/.test(item.lang ?? '')
      || typeof item.expectedText !== 'string' || typeof item.replacement !== 'string'
      || !/^[0-9a-f]{64}$/.test(item.expectedRevision ?? '') || !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.end <= item.start) {
      fail(422, 'invalid_body', 'The replace item is not valid.');
    }
  }
  const groups = Map.groupBy(input.items, (item) => item.resourceId);
  if (Object.keys(input.expectedCommentsRevisions).length !== groups.size
    || [...groups.keys()].some((id) => !Object.hasOwn(input.expectedCommentsRevisions, id)
      || input.expectedCommentsRevisions[id] !== null && !/^[0-9a-f]{64}$/.test(input.expectedCommentsRevisions[id] ?? ''))) {
    fail(422, 'invalid_body', 'Every affected text needs its comments revision.');
  }
  return withLocalChanges(context.store, async () => {
    const entries = [], snapshots = [], events = [], editors = [];
    for (const [id, items] of groups) {
      const found = await textBundle(context, id);
      if (found.entry.readOnly) fail(409, 'read_only_resource', 'The text is read only.');
      for (const item of items) checkRevision(found.loaded.bytes, item.expectedRevision);
      const comments = await loadComments(found);
      checkRevision(comments.bytes, input.expectedCommentsRevisions[id]);
      const document = structuredClone(found.document);
      for (const ranges of Map.groupBy(items, (item) => `${item.k}\0${item.lang}`).values()) {
        const page = document.pages.find((page) => page.k === ranges[0].k), lang = ranges[0].lang;
        if (!page || typeof page[lang] !== 'string') fail(422, 'invalid_range', 'The page language does not exist.');
        const source = page[lang];
        const offsets = [...new Set(ranges.flatMap((item) => [item.start, item.end]))].sort((a, b) => a - b), unsafe = new Set();
        for (const token of tokenizeMarkup(source)) {
          if (token.type !== 'tag' || token.sourceEnd <= token.sourceStart) continue;
          let low = 0, high = offsets.length;
          while (low < high) { const middle = (low + high) >>> 1; if (offsets[middle] <= token.sourceStart) low = middle + 1; else high = middle; }
          for (let index = low; index < offsets.length && offsets[index] < token.sourceEnd; index++) unsafe.add(offsets[index]);
        }
        let boundary = source.length;
        const pieces = [];
        for (const item of ranges.toSorted((a, b) => b.start - a.start)) {
          if (item.end > boundary) fail(422, 'invalid_range', 'Replace ranges cannot overlap.');
          assertRange(source, item.start, item.end, (offset) => unsafe.has(offset));
          if (source.slice(item.start, item.end) !== item.expectedText) fail(409, 'range_changed', 'The text at that range changed.');
          pieces.push(source.slice(item.end, boundary), item.replacement);
          boundary = item.start;
        }
        page[lang] = source.slice(0, boundary) + pieces.reverse().join('');
      }
      document.rev = (document.rev || 0) + 1;
      validateText(document);
      const bytes = jsonBytes(document);
      const documentEntry = byteEntry(found.file, found.loaded.bytes, bytes), commentsEntry = byteEntry(comments.file, comments.bytes, comments.bytes);
      entries.push(documentEntry, commentsEntry);
      snapshots.push(documentEntry, commentsEntry);
      const orig = await loadBytes(`${stemOf(found.file)}.orig.json`);
      if (!orig.bytes) entries.push(record(`${stemOf(found.file)}.orig.json`, null, found.loaded.bytes));
      const lines = textChanges(found.document, document).map((change) => JSON.stringify({ at: clock(context), rev: document.rev, ...change })).join('\n');
      entries.push((await historyEntry(found.file, null, `${lines}\n`)).entry);
      const revision = hashBytes(bytes);
      events.push(voidEvent(id, revision, document.rev, 'replace-matches'));
      editors.push(await shown(context, found.entry, document, revision));
    }
    const changeId = randomUUID(), response = { changeId, editors, matches: input.items.length };
    await commitEditor(context, entries, events, { status: 200, body: response }, { id: changeId, resourceIds: [...groups.keys()], entries: snapshots });
    for (const editor of editors) rememberExternal(context, editor.id, editor.revision, editor.document);
    return response;
  });
}

export async function undoTextReplace(context, changeId) {
  desktopLibrary(context);
  return withLocalChanges(context.store, async () => {
    bindProjects(context.store, context.projects ?? []);
    const undo = await readReplaceUndo(context, changeId), entries = undo.entries, editors = [], events = [];
    for (const id of undo.resourceIds) {
      const found = await textBundle(context, id);
      const restored = entries.find((entry) => entry.recordPath === found.file);
      if (!restored?.afterBytes) fail(409, 'undo_conflict', 'The replaced text is no longer available.');
      const document = validateText(parseJson(restored.afterBytes)), revision = hashBytes(restored.afterBytes);
      const lines = textChanges(found.document, document).map((change) => JSON.stringify({ at: clock(context), rev: document.rev, ...change })).join('\n');
      entries.push((await historyEntry(found.file, null, `${lines}\n`)).entry);
      events.push(voidEvent(id, revision, document.rev, 'undo-replace'));
      editors.push(await shown(context, found.entry, document, revision));
    }
    const response = { changeId: randomUUID(), undoOf: changeId, editors };
    try { await commit(context, entries, events, { status: 200, body: response }); }
    catch (error) { if (error.code === 'revision_conflict') fail(409, 'undo_conflict', 'A changed record prevents undo.'); throw error; }
    for (const editor of editors) rememberExternal(context, editor.id, editor.revision, editor.document);
    return response;
  });
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
  if (input.replacement !== undefined && (input.decision !== 'accept' || typeof input.replacement !== 'string')) {
    fail(422, 'invalid_body', 'A replacement must be text and requires accept.');
  }
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
    const response = { editor: { ...await shown(context, found.entry, found.document, found.loaded.revision),
      commentsRevision: revision, threads: projectComments(comments.value, id).threads },
    proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision: revision } };
    await commit(context, [record(comments.file, comments.revision, bytes)], [
      { name: 'void.proposal.changed', resourceId: id, data: { resourceId: id, proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision: revision }, commentsRevision: revision } },
    ], { status: 200, body: response });
    return response;
  }
  const page = found.document.pages.find((item) => item.k === message.proposal.k);
  const source = page?.[message.proposal.lang];
  if (typeof source !== 'string' || source.slice(message.proposal.start, message.proposal.end) !== message.proposal.expectedText) {
    fail(409, 'proposal_stale', 'The proposal no longer matches the text.');
  }
  const document = structuredClone(found.document);
  const replacement = input.replacement ?? message.proposal.replacement;
  const next = applySlice(source, message.proposal.start, message.proposal.end, replacement, message.proposal.expectedText);
  document.pages.find((item) => item.k === message.proposal.k)[message.proposal.lang] = next;
  document.rev = (document.rev || 0) + 1;
  validateText(document);
  message.proposal.replacement = replacement;
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
  const response = { editor: { ...await shown(context, found.entry, document, revision),
    commentsRevision, threads: projectComments(comments.value, id).threads },
  proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision } };
  await commit(context, entries, [
    voidEvent(id, revision, document.rev, 'replace-range', message.proposal.k, message.proposal.lang),
    { name: 'void.proposal.changed', resourceId: id, data: { resourceId: id, proposal: { ...message.proposal, resourceId: id, threadId: thread.id, commentsRevision }, commentsRevision } },
  ], { status: 200, body: response });
  rememberExternal(context, id, revision, document);
  return response;
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

export function commentRecipients(context, input, attached, authorId) {
  if (input.sendToAgent !== undefined && typeof input.sendToAgent !== 'boolean') fail(422, 'invalid_body', 'Send to agent must be a boolean.');
  const recipients = recipientsFor(context, attached, authorId);
  return input.sendToAgent === false ? recipients.filter((unitId) => unitId === 'root:master') : recipients;
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
  // A board kept as a script module is read only and has no JSON to place comments on; its threads list without a place.
  const board = found.entry.kind === 'blueprint' && /\.json$/i.test(found.entry.path) ? parseJson((await loadBytes(inside(found.project.localPath, found.entry.path))).bytes ?? Buffer.from('{}')) : null;
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
    if (!Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) || anchor.end <= anchor.start
      || !validUtf16Boundary(rendered, anchor.start) || !validUtf16Boundary(rendered, anchor.end)) fail(422, 'invalid_range', 'The anchor splits a character or lies outside the text.');
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
    messages: [{ id: randomUUID(), author, authorId, at: clock(context), text, sendToAgent: input.sendToAgent !== false }],
  };
  if (thread.layer === undefined) delete thread.layer;
  assignIds(comments.value, found.entry.id);
  comments.value.threads.push(thread);
  const bytes = jsonBytes(comments.value);
  const revision = hashBytes(bytes);
  const messageId = thread.messages[0].id;
  const notices = await noticePlan(context, messageId, id, commentRecipients(context, input, (await readAttachments(context, found.entry.id)).attached, authorId));
  if (notices.entries.length) await admitComment(context, messageId);
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
  const message = { id: randomUUID(), author, authorId, at: clock(context), text, sendToAgent: input.sendToAgent !== false };
  assignIds(comments.value, found.entry.id);
  thread.messages.push(message);
  thread.status = 'open';
  const bytes = jsonBytes(comments.value);
  const revision = hashBytes(bytes);
  const notices = await noticePlan(context, message.id, id, commentRecipients(context, input, (await readAttachments(context, found.entry.id)).attached, authorId));
  if (notices.entries.length) await admitComment(context, message.id);
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
  if (!document) return null;
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

export async function observeExternal(context, id, options = {}) {
  return withLocalChanges(context.store, () => withLocks(context.store, [`external-editor:${id}`], () => observeExternalUnlocked(context, id, options)));
}

async function observeExternalUnlocked(context, id, options) {
  const found = await resourceOf(context, id);
  const file = inside(found.project.localPath, found.entry.path);
  // A baseline adopts the bytes already classified. Rereading would fold a newer write into that baseline and lose it.
  const loaded = options.baseline === true && options.bytes
    ? { bytes: options.bytes, revision: hashBytes(options.bytes) }
    : await loadBytes(file);
  if (!loaded.bytes) return { changed: false, issue: true };
  externalState(context);
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
  if (options.baseline === true) {
    rememberExternal(context, id, loaded.revision, document);
    return { changed: false };
  }
  const changes = previous ? textChanges(previous, document) : [];
  if (changes.length === 0) {
    rememberExternal(context, id, loaded.revision, document);
    return { changed: false };
  }
  const at = clock(context);
  const line = `${changes.map((change) => JSON.stringify({ at, rev: document.rev || 0, ...change, by: 'outside' })).join('\n')}\n`;
  const history = await historyEntry(file, null, line);
  const change = changes[0];
  await commit(context, [record(file, loaded.revision, loaded.bytes), history.entry], [voidEvent(id, loaded.revision, document.rev || 0, 'import', change.k, change.lang)]);
  rememberExternal(context, id, loaded.revision, document);
  return { changed: true, changes: context.lastEditorChanges ?? [] };
}

export { findAnchor, place };

function libraryTitle(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value) || !value.trim() || value.trim().length > 240) fail(422, 'invalid_title', 'The title must be one nonblank line of at most 240 characters.');
  return value.trim();
}

function desktopLibrary(context) {
  if (context.principal?.audience && context.principal.audience !== 'desktop') fail(403, 'forbidden', 'Only the desktop can manage the library.');
}

async function loadLibrary(context, name) {
  const project = projectOf(context, name);
  await assertNoLinks(project.localPath);
  const stats = await lstat(project.localPath).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stats?.isDirectory()) fail(409, 'project_unavailable', 'The project repository is not available on this machine.');
  const file = inside(project.localPath, 'docs/flows/library.json');
  const loaded = await loadBytes(file, context.store);
  const value = loaded.bytes ? parseJson(loaded.bytes) : { format: 'hivem1nd-library-v1', folders: [], items: {} };
  if (value.format !== 'hivem1nd-library-v1' || !Array.isArray(value.folders) || !value.items || typeof value.items !== 'object' || Array.isArray(value.items)) fail(409, 'corrupt_resource', 'The library metadata is not valid.');
  const ids = new Set();
  for (const folder of value.folders) {
    if (!isUuid(folder.id) || ids.has(folder.id) || !['blueprint', 'void'].includes(folder.kind) || libraryTitle(folder.title) !== folder.title) fail(409, 'corrupt_resource', 'The library folder is not valid.');
    ids.add(folder.id);
  }
  for (const folder of value.folders) validateParent(value.folders, folder);
  return { project, file, ...loaded, value };
}

function validateParent(folders, folder) {
  const seen = new Set([folder.id]);
  let parentId = folder.parentId;
  while (parentId !== null) {
    const parent = folders.find((item) => item.id === parentId && item.kind === folder.kind);
    if (!parent || seen.has(parentId)) fail(422, 'invalid_parent', 'The parent must be a folder of the same kind without a cycle.');
    seen.add(parentId);
    parentId = parent.parentId;
  }
}

function validateFolder(library, id, kind) {
  if (id !== null && (!isUuid(id) || !library.value.folders.some((item) => item.id === id && item.kind === kind))) fail(422, 'invalid_folder', 'The folder must exist in the selected project and editor library.');
}

function libraryEvent(library, kind, bytes = jsonBytes(library.value)) {
  return { name: 'library.changed', data: { project: library.project.name, kind, revision: hashBytes(bytes) } };
}

async function libraryEdits(context, entries, events) {
  const edits = events.filter((event) => ['blueprint.changed', 'void.changed', 'comment.changed', 'void.proposal.changed'].includes(event.name));
  if (!edits.length) return;
  const catalogEntry = entries.find((entry) => entry.recordPath === catalogFile(context));
  const catalog = catalogEntry ? parseJson(catalogEntry.afterBytes) : (await readCatalog(context)).value;
  const libraries = new Map();
  const kinds = new Map();
  for (const event of edits) {
    const resource = catalog.resources.find((item) => item.id === event.resourceId);
    if (!resource) continue;
    let library = libraries.get(resource.project);
    if (!library) {
      library = await loadLibrary(context, resource.project);
      const planned = entries.find((entry) => entry.recordPath === library.file);
      if (planned) library.value = parseJson(planned.afterBytes);
      libraries.set(resource.project, library);
    }
    const file = inside(library.project.localPath, resource.path);
    const planned = entries.find((entry) => entry.recordPath === file);
    const document = planned?.afterBytes ? parseJson(planned.afterBytes) : null;
    const previous = library.value.items[resource.id];
    const current = document ? await loadBytes(file) : null;
    const changedTitle = document && (!current.bytes || parseJson(current.bytes).title !== document.title);
    const restoredTitle = edits.some((event) => event.resourceId === resource.id && event.data?.operation === 'restore');
    library.value.items[resource.id] = { ...previous, folderId: previous?.folderId ?? null,
      title: changedTitle && !restoredTitle ? document.title : previous?.title ?? document?.title ?? resource.title ?? resource.legacyId, updatedAt: clock(context) };
    kinds.set(`${resource.project}:${resource.kind}`, { library, kind: resource.kind });
  }
  for (const library of libraries.values()) {
    const planned = entries.find((entry) => entry.recordPath === library.file);
    if (planned) planned.afterBytes = jsonBytes(library.value);
    else entries.push(record(library.file, library.revision, jsonBytes(library.value)));
  }
  for (const { library, kind } of kinds.values()) events.unshift(libraryEvent(library, kind));
}

async function initialHistory(context, entry, document, comments, operation = 'create', provenance = {}) {
  for (const bytes of [document, comments]) if (bytes && bytes.length > TEXT_LIMIT) fail(413, 'resource_too_large', 'A history object exceeds 16 MB.');
  const project = projectOf(context, entry.project);
  const id = randomUUID();
  const relative = `docs/flows/history/${entry.id}/${id}`;
  const metadata = { format: 'hivem1nd-editor-history-v1', id, resourceId: entry.id, at: clock(context),
    by: actor(context).authorId, operation, documentPath: entry.path,
    commentsPath: comments ? path.relative(project.localPath, commentsPath({ project, entry })).replaceAll('\\', '/') : null,
    revision: hashBytes(document), commentsRevision: revisionOf(comments), title: parseJson(document).title,
    source: { kind: ({ desktop: 'gui', agent: 'mcp', cli: 'cli', hook: 'hook' })[context.principal?.audience] ?? 'service', id: context.paths.machine, unitId: actor(context).authorId }, ...provenance };
  return [record(inside(project.localPath, `${relative}.json`), null, jsonBytes(metadata)),
    record(inside(project.localPath, `${relative}.document.json`), null, document),
    ...(comments ? [record(inside(project.localPath, `${relative}.comments.json`), null, comments)] : [])];
}

async function historyRecords(context, found) {
  const directory = inside(found.project.localPath, `docs/flows/history/${found.entry.id}`);
  await assertNoLinks(directory);
  const items = [];
  for (const name of await readdir(directory).catch((error) => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    const loaded = await loadBytes(path.join(directory, name), context.store);
    if (!loaded.bytes) continue;
    if (loaded.bytes.length > TEXT_LIMIT) fail(413, 'resource_too_large', 'A history object exceeds 16 MB.');
    const item = parseJson(loaded.bytes);
    if (item.format !== 'hivem1nd-editor-history-v1' || !isUuid(item.id) || name !== `${item.id}.json`
      || item.resourceId !== found.entry.id || !Number.isFinite(Date.parse(item.at))
      || !/^[0-9a-f]{64}$/.test(item.revision) || item.commentsRevision !== null && !/^[0-9a-f]{64}$/.test(item.commentsRevision)
      || !['create', 'rename', 'board-edit', 'sketch', 'text-edit', 'comment', 'proposal', 'conflict', 'restore'].includes(item.operation)) {
      fail(409, 'corrupt_resource', 'The history metadata is not valid.');
    }
    parseUnitId(item.by);
    items.push(item);
  }
  return items.sort((a, b) => b.at.localeCompare(a.at) || (b.sequence ?? 0) - (a.sequence ?? 0) || b.id.localeCompare(a.id));
}

function historyEvent(item) {
  return { name: 'editor.history.changed', resourceId: item.resourceId,
    data: { resourceId: item.resourceId, historyId: item.id, revision: item.revision } };
}

function historyOperation(events, before, after, kind) {
  const operation = events.find((event) => ['restore', 'conflict', 'rename'].includes(event.data?.operation))?.data.operation;
  if (operation) return operation;
  if (events.some((event) => event.name === 'void.proposal.changed')) return 'proposal';
  if (events.some((event) => event.name === 'comment.changed')) return 'comment';
  if (!before) return 'create';
  const left = parseJson(before), right = parseJson(after);
  if (left.title !== right.title && canonicalJson({ ...left, title: right.title, ...(kind === 'void' ? { rev: right.rev } : {}) }) === canonicalJson(right)) return 'rename';
  if (kind === 'void') return 'text-edit';
  const strokes = (value) => { const nodes = []; eachNode(value, (node) => { if (node?.kind === 'pen') nodes.push(node); }); return canonicalJson(nodes); };
  return strokes(left) !== strokes(right) ? 'sketch' : 'board-edit';
}

async function historyEdits(context, entries, events) {
  const edits = events.filter((event) => ['blueprint.changed', 'void.changed', 'comment.changed', 'void.proposal.changed'].includes(event.name));
  if (!edits.length) return;
  const plannedCatalog = entries.find((entry) => entry.recordPath === catalogFile(context));
  const catalog = plannedCatalog ? parseJson(plannedCatalog.afterBytes) : (await readCatalog(context)).value;
  for (const resourceId of new Set(edits.map((event) => event.resourceId))) {
    const entry = catalog.resources.find((item) => item.id === resourceId);
    if (!entry || entry.readOnly) continue;
    const project = projectOf(context, entry.project), found = { project, entry, store: context.store };
    const prepared = entries.filter((item) => item.recordPath?.startsWith(`${inside(project.localPath, `docs/flows/history/${resourceId}`)}${path.sep}`) && /^[0-9a-f-]{36}\.json$/.test(path.basename(item.recordPath)));
    if (prepared.length) { events.unshift(...prepared.map((item) => historyEvent(parseJson(item.afterBytes)))); continue; }
    const file = inside(project.localPath, entry.path), before = await loadBytes(file, context.store), comments = await loadComments(found);
    const documentEntry = entries.find((item) => item.recordPath === file);
    const commentsEntry = entries.find((item) => item.recordPath === comments.file);
    const documentBytes = documentEntry ? documentEntry.afterBytes : before.bytes, commentBytes = commentsEntry ? commentsEntry.afterBytes : comments.bytes;
    const records = await historyRecords(context, found);
    let sequence = records.reduce((maximum, item) => Math.max(maximum, item.sequence ?? 0), 0);
    if (before.bytes && !records.some((item) => item.revision === before.revision && item.commentsRevision === comments.revision)) {
      const previous = records.find((item) => item.revision === before.revision);
      const kept = await initialHistory(context, entry, before.bytes, comments.bytes, 'conflict', { sequence: ++sequence,
        by: previous?.by ?? 'root:master', source: previous?.source ?? { kind: 'external', id: context.paths.machine, unitId: null } });
      entries.push(...kept);
      events.unshift(historyEvent(parseJson(kept[0].afterBytes)));
    }
    if (!documentEntry) entries.push(record(file, before.revision, before.bytes));
    if (!commentsEntry) entries.push(comments.bytes ? record(comments.file, comments.revision, comments.bytes) : byteEntry(comments.file, null, null));
    const operation = historyOperation(edits.filter((event) => event.resourceId === resourceId), before.bytes, documentBytes, entry.kind);
    const libraryEntry = entries.find((item) => item.recordPath === inside(project.localPath, 'docs/flows/library.json'));
    const titleChanged = before.bytes && parseJson(before.bytes).title !== parseJson(documentBytes).title;
    const library = libraryEntry ? parseJson(libraryEntry.afterBytes) : (await loadLibrary(context, entry.project)).value;
    const title = titleChanged && operation !== 'restore' ? parseJson(documentBytes).title : library.items[resourceId]?.title ?? parseJson(documentBytes).title;
    const external = edits.some((event) => event.resourceId === resourceId && event.data?.operation === 'import');
    const snapshots = await initialHistory(context, entry, documentBytes, commentBytes, operation, { sequence: ++sequence, ...(title ? { title } : {}),
      ...(external ? { source: { kind: 'external', id: context.paths.machine, unitId: null } } : {}) });
    entries.push(...snapshots);
    events.unshift(historyEvent(parseJson(snapshots[0].afterBytes)));
  }
}

export async function listHistory(context, id, query = {}) {
  await requireAttachment(context, id);
  const found = await resourceOf(context, id), records = await historyRecords(context, found);
  const document = await loadBytes(inside(found.project.localPath, found.entry.path), context.store), comments = await loadComments(found);
  let marked = false;
  const items = records.map((item) => {
    const current = !marked && item.source?.kind !== 'draft' && item.revision === document.revision && item.commentsRevision === comments.revision;
    marked ||= current;
    return { id: item.id, resourceId: id, at: item.at, by: item.by, operation: item.operation, revision: item.revision, commentsRevision: item.commentsRevision, current, ...(item.source ? { source: item.source } : {}) };
  });
  return paginate(items, { ...query, filters: { resourceId: id }, snapshot: hashText(`${document.revision}\n${comments.revision}\n${records.map((item) => item.id).join('\n')}`) });
}

async function historySnapshot(context, found, historyId) {
  if (!isUuid(historyId)) fail(404, 'history_not_found', 'The history version does not exist.');
  const item = (await historyRecords(context, found)).find((record) => record.id === historyId);
  if (!item) fail(404, 'history_not_found', 'The history version does not exist.');
  const root = inside(found.project.localPath, `docs/flows/history/${found.entry.id}/${historyId}`);
  const document = await loadBytes(`${root}.document.json`, context.store), comments = await loadBytes(`${root}.comments.json`, context.store);
  for (const loaded of [document, comments]) if (loaded.bytes?.length > TEXT_LIMIT) fail(413, 'resource_too_large', 'A history object exceeds 16 MB.');
  if (!document.bytes || document.revision !== item.revision || comments.revision !== item.commentsRevision) fail(409, 'corrupt_resource', 'The history bytes do not match their revisions.');
  const value = (found.entry.kind === 'void' ? validateText : validateBoard)(parseJson(document.bytes));
  if (comments.bytes && !Array.isArray(parseJson(comments.bytes).threads)) fail(409, 'corrupt_resource', 'The history comments are not valid.');
  return { item, document, comments, value };
}

async function restoreDocument(context, found, document, commentBytes, operation, extraEntries = []) {
  const current = parseJson(found.loaded.bytes);
  preserveUnknown(current, document, KNOWN_OPTIONAL);
  if (document.id !== current.id) fail(422, 'invalid_document', 'The document identity cannot change.');
  const entries = [...extraEntries];
  if (found.entry.kind === 'void') {
    document.rev = (current.rev || 0) + 1;
    const changes = textChanges(current, document), at = clock(context);
    if (changes.length) {
      const lines = `${changes.map((change) => JSON.stringify({ at, rev: document.rev, ...change, operation })).join('\n')}\n`;
      entries.push((await historyEntry(found.file, null, lines)).entry);
    }
    const original = await loadBytes(`${stemOf(found.file)}.orig.json`);
    if (!original.bytes) entries.push(record(`${stemOf(found.file)}.orig.json`, null, found.loaded.bytes));
  } else {
    const index = await loadBytes(indexFile(found.project));
    entries.push(record(indexFile(found.project), index.revision, jsonBytes(mergeIndex(index.bytes ? parseJson(index.bytes) : null, document))));
  }
  const comments = await loadComments(found), bytes = jsonBytes(document);
  if (comments.bytes && commentBytes) preserveUnknown(parseJson(comments.bytes), parseJson(commentBytes));
  entries.push(record(found.file, found.loaded.revision, bytes));
  if (commentBytes === null) entries.push(byteEntry(comments.file, comments.bytes, null));
  else if (commentBytes) entries.push(record(comments.file, comments.revision, commentBytes));
  const events = found.entry.kind === 'void' ? [voidEvent(found.entry.id, hashBytes(bytes), document.rev, operation)] : boardEvents(context, found.entry.id, hashBytes(bytes), operation);
  const editor = await shown(context, found.entry, document, hashBytes(bytes));
  editor.commentsRevision = revisionOf(commentBytes);
  editor.threads = projectComments(commentBytes ? parseJson(commentBytes) : { threads: [] }, found.entry.id).threads;
  editor.openThreads = editor.threads.filter((thread) => thread.status !== 'resolved').length;
  await commit(context, entries, events, { status: 200, body: editor });
  if (found.entry.kind === 'void') rememberExternal(context, found.entry.id, hashBytes(bytes), document);
  return editor;
}

export async function restoreHistory(context, id, historyId, input) {
  desktopLibrary(context);
  return withLocalChanges(context.store, async () => {
    const resource = await resourceOf(context, id);
    const found = await (resource.entry.kind === 'void' ? textBundle(context, id) : boardFile(context, id));
    checkRevision(found.loaded.bytes, input.expectedRevision);
    checkRevision((await loadComments(found)).bytes, input.expectedCommentsRevision);
    const snapshot = await historySnapshot(context, found, historyId);
    const library = await loadLibrary(context, found.entry.project);
    const title = snapshot.item.title ?? snapshot.value.title;
    if (title) library.value.items[id] = { ...library.value.items[id], title };
    return restoreDocument(context, found, snapshot.value, snapshot.comments.bytes, 'restore', [record(library.file, library.revision, jsonBytes(library.value))]);
  });
}

export async function resolveConflict(context, id, input) {
  desktopLibrary(context);
  if (!['keep-mine', 'reload'].includes(input.decision)) fail(422, 'invalid_body', 'The conflict answer must be keep-mine or reload.');
  return withLocalChanges(context.store, async () => {
    const resource = await resourceOf(context, id);
    const found = await (resource.entry.kind === 'void' ? textBundle(context, id) : boardFile(context, id));
    checkRevision(found.loaded.bytes, input.expectedRevision);
    const comments = await loadComments(found);
    checkRevision(comments.bytes, input.expectedCommentsRevision);
    const draft = (found.entry.kind === 'void' ? validateText : validateBoard)(input.document);
    if (draft.id !== found.document.id) fail(422, 'invalid_document', 'The document identity cannot change.');
    const records = await historyRecords(context, found), sequence = records.reduce((maximum, item) => Math.max(maximum, item.sequence ?? 0), 0);
    const entries = await initialHistory(context, found.entry, jsonBytes(draft), comments.bytes, 'conflict', { sequence: sequence + 1,
      source: { kind: 'draft', id: context.paths.machine, unitId: actor(context).authorId } });
    if (!records.some((item) => item.revision === found.loaded.revision && item.commentsRevision === comments.revision)) {
      const previous = records.find((item) => item.revision === found.loaded.revision);
      entries.push(...await initialHistory(context, found.entry, found.loaded.bytes, comments.bytes, 'conflict', { sequence: sequence + 2,
        by: previous?.by ?? 'root:master', source: previous?.source ?? { kind: 'external', id: context.paths.machine, unitId: null } }));
    }
    const document = input.decision === 'keep-mine' ? draft : found.document;
    const next = await initialHistory(context, found.entry, found.entry.kind === 'void' ? jsonBytes({ ...document, rev: (found.document.rev || 0) + 1 }) : jsonBytes(document), comments.bytes, 'conflict', { sequence: sequence + 3 });
    entries.push(...next);
    return restoreDocument(context, found, document, comments.bytes, 'conflict', entries);
  });
}

function createdEditor(context, entry, document, bytes, comments, library) {
  return { id: entry.id, kind: entry.kind, project: entry.project, title: document.title, path: entry.path, legacyId: entry.legacyId,
    readOnly: false, revision: hashBytes(bytes), attached: entry.attached, openThreads: 0, activity: currentActivity(context, entry.id),
    document, legacy: null, attachmentRevision: null, commentsRevision: revisionOf(comments), threads: [],
    folderId: library.value.items[entry.id].folderId, updatedAt: library.value.items[entry.id].updatedAt, libraryRevision: hashBytes(jsonBytes(library.value)) };
}

export async function listFolders(context, query = {}) {
  if (!['blueprint', 'void'].includes(query.kind)) fail(422, 'invalid_query', 'The editor kind is required.');
  const items = [], issues = [];
  if (query.kind === 'blueprint') await registerFound(context, query.project ? [query.project] : (context.projects ?? []).map((item) => item.name)).catch(() => 0);
  for (const name of query.project ? [query.project] : (context.projects ?? []).map((item) => item.name)) {
    try {
      const library = await loadLibrary(context, name);
      const catalog = await readCatalog(context);
      for (const folder of library.value.folders.filter((item) => item.kind === query.kind)) {
        const descendants = folderTree(library, folder.id);
        const count = catalog.value.resources.filter((entry) => entry.project === name && entry.kind === folder.kind && descendants.has(library.value.items[entry.id]?.folderId)).length;
        items.push({ ...folder, project: name, count, revision: library.revision });
      }
    } catch (error) { issues.push({ project: name, code: error.code ?? 'project_unavailable', message: 'The project library is not available.' }); }
  }
  items.sort((left, right) => `${left.project}:${left.id}`.localeCompare(`${right.project}:${right.id}`));
  const needle = String(query.q ?? '').toLowerCase();
  return { ...paginate(items.filter((item) => item.title.toLowerCase().includes(needle)), { limit: query.limit, cursor: query.cursor,
    filters: { project: query.project ?? null, kind: query.kind, q: query.q ?? null }, snapshot: hashText(canonicalJson(items)) }), issues };
}

export async function createFolder(context, input) {
  desktopLibrary(context);
  return withLocalChanges(context.store, async () => {
    const library = await loadLibrary(context, input.project);
    checkRevision(library.bytes, input.expectedRevision);
    if (!['blueprint', 'void'].includes(input.kind)) fail(422, 'invalid_body', 'The editor kind is not valid.');
    const folder = { id: randomUUID(), title: libraryTitle(input.title), kind: input.kind, parentId: input.parentId };
    validateParent([...library.value.folders, folder], folder);
    library.value.folders.push(folder);
    const bytes = jsonBytes(library.value);
    const response = { folder: { ...folder, project: input.project, count: 0, revision: hashBytes(bytes) }, revision: hashBytes(bytes) };
    await libraryCommit(context, [record(library.file, library.revision, bytes)], [libraryEvent(library, folder.kind, bytes)], { status: 201, body: response });
    return response;
  });
}

export async function patchFolder(context, id, input) {
  desktopLibrary(context);
  return withLocalChanges(context.store, async () => {
    const library = await loadLibrary(context, input.project);
    checkRevision(library.bytes, input.expectedRevision);
    const folder = library.value.folders.find((item) => item.id === id);
    if (!folder) fail(404, 'folder_not_found', 'The library folder does not exist.');
    if (!Object.hasOwn(input, 'title') && !Object.hasOwn(input, 'parentId')) fail(422, 'invalid_body', 'A folder patch needs a title or parent.');
    if (Object.hasOwn(input, 'title')) folder.title = libraryTitle(input.title);
    if (Object.hasOwn(input, 'parentId')) folder.parentId = input.parentId;
    validateParent(library.value.folders, folder);
    const bytes = jsonBytes(library.value);
    const response = { folder: { ...folder, project: input.project, revision: hashBytes(bytes) }, revision: hashBytes(bytes) };
    await libraryCommit(context, [record(library.file, library.revision, bytes)], [libraryEvent(library, folder.kind, bytes)], { status: 200, body: response });
    return response;
  });
}

async function libraryCommit(context, entries, events, response, id = randomUUID()) {
  bindProjects(context.store, context.projects ?? []);
  return commitChange(context, { id, entries: entries.map((entry) => rewriteEntry(context, entry)), events, response });
}

function folderTree(library, id) {
  const ids = new Set([id]);
  let size;
  do {
    size = ids.size;
    for (const folder of library.value.folders) if (ids.has(folder.parentId)) ids.add(folder.id);
  } while (size !== ids.size);
  return ids;
}

async function managementBundle(context, id, input = null) {
  const found = await resourceOf(context, id);
  const library = await loadLibrary(context, found.entry.project);
  const file = inside(found.project.localPath, found.entry.path);
  const loaded = await loadBytes(file);
  if (!loaded.bytes) fail(409, 'corrupt_resource', 'The document is not available.');
  const comments = await loadComments(found);
  const binding = await loadBytes(bindingFile(context, id));
  if (input) {
    checkRevision(loaded.bytes, input.expectedRevision);
    checkRevision(comments.bytes, input.expectedCommentsRevision);
    checkRevision(binding.bytes, input.expectedAttachmentRevision);
    checkRevision(library.bytes, input.expectedLibraryRevision);
  }
  const files = new Map([[file, loaded], [comments.file, comments], [bindingFile(context, id), binding]]);
  if (found.entry.kind === 'void') for (const suffix of ['.orig.json', '.versions.jsonl']) files.set(`${stemOf(file)}${suffix}`, await loadBytes(`${stemOf(file)}${suffix}`));
  const registry = assetRegistryFile(context, id);
  files.set(registry, await loadBytes(registry));
  const directory = inside(found.project.localPath, `docs/flows/history/${id}`);
  await assertNoLinks(directory);
  for (const name of await readdir(directory).catch((error) => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (!/^[0-9a-f-]{36}\.(json|document\.json|comments\.json)$/.test(name)) fail(409, 'corrupt_resource', 'An editor history entry is not valid.');
    files.set(path.join(directory, name), await loadBytes(path.join(directory, name)));
  }
  return { ...found, file, loaded, comments, binding, library, files };
}

function byteEntry(file, beforeBytes, afterBytes) {
  return { ...record(file, revisionOf(beforeBytes), afterBytes), beforeBytes, ...(afterBytes === null ? { operation: 'delete' } : {}) };
}

function assetNames(bytes) {
  const names = new Set();
  const visit = (value) => {
    if (typeof value === 'string' && /^(?:(?:docs\/flows\/)?assets\/)?[0-9a-f-]{36}\.(png|jpg|webp)$/.test(value)) names.add(value.split('/').at(-1));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  if (bytes) { try { visit(JSON.parse(bytes)); } catch { /* Legacy module content is not JSON. */ } }
  return names;
}

async function ownedAssets(context, bundles, entries) {
  const removed = new Set(bundles.map((bundle) => bundle.entry.id));
  const owned = new Set();
  const first = bundles[0];
  for (const bundle of bundles) {
    for (const name of assetNames(bundle.loaded.bytes)) owned.add(name);
    for (const name of assetNames(bundle.files.get(assetRegistryFile(context, bundle.entry.id))?.bytes)) owned.add(name);
  }
  const shared = new Set();
  for (const resource of first.catalog.value.resources.filter((entry) => entry.project === first.project.name && !removed.has(entry.id))) {
    for (const file of [inside(first.project.localPath, resource.path), assetRegistryFile(context, resource.id)]) {
      const loaded = await loadBytes(file);
      if (!loaded.bytes) continue;
      for (const name of assetNames(loaded.bytes)) shared.add(name);
      entries.push(byteEntry(file, loaded.bytes, loaded.bytes));
    }
  }
  const assets = [];
  for (const name of owned) {
    const file = inside(first.project.localPath, `docs/flows/assets/${name}`);
    const loaded = await loadBytes(file);
    if (!loaded.bytes) fail(409, 'corrupt_resource', 'A referenced editor asset is not available.');
    assets.push({ name, file, ...loaded, shared: shared.has(name) });
  }
  return assets;
}

function removeIndex(value, ids) {
  if (Array.isArray(value)) return value.filter((entry) => !ids.has(entry.id));
  return { ...value, boards: (value?.boards ?? []).filter((entry) => !ids.has(entry.id)) };
}

async function removeBundlePlan(context, bundles, entries) {
  const first = bundles[0];
  if (!first) return;
  for (const bundle of bundles) for (const [file, loaded] of bundle.files) if (loaded.bytes) entries.push(byteEntry(file, loaded.bytes, null));
  for (const asset of await ownedAssets(context, bundles, entries)) if (!asset.shared) entries.push(byteEntry(asset.file, asset.bytes, null));
  const ids = new Set(bundles.filter((bundle) => bundle.entry.kind === 'blueprint').map((bundle) => bundle.entry.legacyId));
  if (ids.size) {
    const file = indexFile(first.project), loaded = await loadBytes(file);
    if (loaded.bytes) entries.push(byteEntry(file, loaded.bytes, jsonBytes(removeIndex(parseJson(loaded.bytes), ids))));
  }
}

function invalidateEditor(context, id) {
  if (context.watch) {
    clearResource(context.watch, id);
    context.watch.handles.get(id)?.close?.();
    context.watch.handles.delete(id);
  }
  const state = context.store.editorExternal;
  state?.hashes.delete(id);
  state?.snapshots.delete(id);
  state?.issues.delete(id);
}

async function finishRemoval(context, bundles, library, entries, resourceIds, kinds) {
  const id = randomUUID();
  const undoEvents = [...kinds].map((kind) => libraryEvent(library, kind, library.bytes ?? jsonBytes({ format: 'hivem1nd-library-v1', folders: [], items: {} })));
  const unique = uniqueEntries(entries);
  const undo = await prepareChangeUndo(context, { id, permission: 'editor.write', resourceIds, entries: unique, events: [...undoEvents,
    { name: 'view.changed', data: { collections: ['editors'], revision: id } }] });
  const events = [...kinds].map((kind) => libraryEvent(library, kind));
  for (const bundle of bundles) {
    events.push({ name: 'editor.removed', resourceId: bundle.entry.id, data: { resourceId: bundle.entry.id, changeId: id, undoUntil: undo.undoUntil } });
    const attached = (await readAttachments(context, bundle.entry.id)).attached;
    const notices = await noticePlan(context, uuidV8(['editor-deletion', id, bundle.entry.id]), bundle.entry.id, attached);
    unique.push(...notices.entries);
    events.push(...notices.events);
  }
  const response = resourceIds.length === 1 && bundles.length === 1 ? { resourceId: resourceIds[0], changeId: id, undoUntil: undo.undoUntil }
    : { changeId: id, undoUntil: undo.undoUntil, removedResourceIds: resourceIds };
  await libraryCommit(context, [...unique, undo.entry], events, { status: 200, body: response }, id);
  for (const bundle of bundles) invalidateEditor(context, bundle.entry.id);
  return response;
}

function uniqueEntries(entries) {
  const files = new Map();
  for (const entry of entries) {
    const previous = files.get(entry.recordPath);
    if (previous && (previous.beforeRevision !== entry.beforeRevision || revisionOf(previous.afterBytes) !== revisionOf(entry.afterBytes))) fail(409, 'revision_conflict', 'The bundle changed while it was prepared.');
    files.set(entry.recordPath, entry);
  }
  return [...files.values()];
}

export async function removeEditor(context, id, input) {
  desktopLibrary(context);
  if (input.confirmed !== true) fail(422, 'confirmation_required', 'Deleting an editor requires confirmation.');
  return withLocalChanges(context.store, async () => {
    const bundle = await managementBundle(context, id, input);
    const entries = [];
    await removeBundlePlan(context, [bundle], entries);
    const catalog = { ...bundle.catalog.value, resources: bundle.catalog.value.resources.filter((entry) => entry.id !== id) };
    const library = bundle.library;
    delete library.value.items[id];
    entries.push(byteEntry(catalogFile(context), bundle.catalog.bytes, jsonBytes(catalog)), byteEntry(library.file, library.bytes, jsonBytes(library.value)));
    return finishRemoval(context, [bundle], library, entries, [id], new Set([bundle.entry.kind]));
  });
}

export async function removeFolder(context, id, input) {
  desktopLibrary(context);
  if (input.confirmed !== true) fail(422, 'confirmation_required', 'Deleting a folder requires confirmation.');
  return withLocalChanges(context.store, async () => {
    const library = await loadLibrary(context, input.project);
    checkRevision(library.bytes, input.expectedRevision);
    const folder = library.value.folders.find((entry) => entry.id === id);
    if (!folder) fail(404, 'folder_not_found', 'The library folder does not exist.');
    const descendants = folderTree(library, id);
    const catalog = await readCatalog(context);
    const resources = catalog.value.resources.filter((entry) => entry.project === input.project && descendants.has(library.value.items[entry.id]?.folderId));
    const bundles = [];
    for (const entry of resources) bundles.push(await managementBundle(context, entry.id));
    const entries = [];
    await removeBundlePlan(context, bundles, entries);
    const ids = resources.map((entry) => entry.id);
    for (const resourceId of ids) delete library.value.items[resourceId];
    library.value.folders = library.value.folders.filter((entry) => !descendants.has(entry.id));
    entries.push(byteEntry(library.file, library.bytes, jsonBytes(library.value)),
      byteEntry(catalogFile(context), catalog.bytes, jsonBytes({ ...catalog.value, resources: catalog.value.resources.filter((entry) => !ids.includes(entry.id)) })));
    const response = await finishRemoval(context, bundles, library, entries, ids, new Set([folder.kind]));
    return { changeId: response.changeId, undoUntil: response.undoUntil, removedResourceIds: ids };
  });
}

export async function patchEditorLibrary(context, id, input) {
  desktopLibrary(context);
  return withLocalChanges(context.store, async () => {
    if (!Object.hasOwn(input, 'title') && !Object.hasOwn(input, 'folderId')) fail(422, 'invalid_body', 'A library patch needs a title or folder.');
    const bundle = await managementBundle(context, id);
    checkRevision(bundle.loaded.bytes, input.expectedRevision);
    checkRevision(bundle.library.bytes, input.expectedLibraryRevision);
    const item = bundle.library.value.items[id] ?? { title: parseJson(bundle.loaded.bytes).title ?? bundle.entry.legacyId, folderId: null };
    if (Object.hasOwn(input, 'title')) item.title = libraryTitle(input.title);
    if (Object.hasOwn(input, 'folderId')) { validateFolder(bundle.library, input.folderId, bundle.entry.kind); item.folderId = input.folderId; }
    item.updatedAt = clock(context);
    bundle.library.value.items[id] = item;
    const document = bundle.entry.readOnly ? null : parseJson(bundle.loaded.bytes);
    const bytes = bundle.loaded.bytes;
    const entries = [byteEntry(bundle.library.file, bundle.library.bytes, jsonBytes(bundle.library.value)), byteEntry(bundle.file, bundle.loaded.bytes, bytes)];
    const editor = { ...await readEditor(context, id), ...item, document: bundle.entry.readOnly ? null : document, revision: hashBytes(bytes), libraryRevision: hashBytes(jsonBytes(bundle.library.value)) };
    const events = [libraryEvent(bundle.library, bundle.entry.kind)];
    if (Object.hasOwn(input, 'title') && !bundle.entry.readOnly) events.push(bundle.entry.kind === 'void' ? voidEvent(id, hashBytes(bytes), document.rev, 'rename') : boardEvents(context, id, hashBytes(bytes), 'rename')[0]);
    await commit(context, entries, events, { status: 200, body: editor });
    return editor;
  });
}

export async function duplicateEditor(context, id, input) {
  desktopLibrary(context);
  return withLocalChanges(context.store, async () => {
    const bundle = await managementBundle(context, id);
    checkRevision(bundle.loaded.bytes, input.expectedRevision);
    if (bundle.entry.readOnly) fail(409, 'read_only_resource', 'Export the module board before duplicating it.');
    const document = parseJson(bundle.loaded.bytes);
    document.id = randomUUID();
    document.title = libraryTitle(input.title);
    const library = await loadLibrary(context, input.project);
    validateFolder(library, input.folderId, bundle.entry.kind);
    const assets = [];
    for (const name of assetNames(bundle.loaded.bytes)) {
      const source = await loadBytes(inside(bundle.project.localPath, `docs/flows/assets/${name}`));
      if (!source.bytes) fail(409, 'corrupt_resource', 'A referenced editor asset is not available.');
      const file = inside(library.project.localPath, `docs/flows/assets/${name}`), loaded = await loadBytes(file);
      if (loaded.bytes && !loaded.bytes.equals(source.bytes)) fail(409, 'resource_exists', 'A destination asset already exists.');
      if (!loaded.bytes) assets.push(byteEntry(file, null, source.bytes));
    }
    return createManagedCopy({ ...context, createGuards: [byteEntry(bundle.file, bundle.loaded.bytes, bundle.loaded.bytes)] }, bundle.entry.kind, { ...input, document, attached: [] }, assets);
  });
}

async function createManagedCopy(context, kind, input, assets) {
  return (kind === 'blueprint' ? createBoard : createText)({ ...context, initialAssets: assets }, input);
}

function remapResource(value, before, after) {
  if (Array.isArray(value)) return value.map((item) => remapResource(item, before, after));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'resourceId' && item === before ? after : remapResource(item, before, after)]));
}

export async function moveEditor(context, id, input) {
  desktopLibrary(context);
  return withLocalChanges(context.store, async () => {
    const bundle = await managementBundle(context, id, input);
    if (input.project === bundle.project.name) {
      validateFolder(bundle.library, input.folderId, bundle.entry.kind);
      const editor = await readEditor(context, id);
      const item = { ...bundle.library.value.items[id], title: editor.title, folderId: input.folderId, updatedAt: clock(context) };
      bundle.library.value.items[id] = item;
      const changeId = randomUUID();
      const entries = [byteEntry(bundle.library.file, bundle.library.bytes, jsonBytes(bundle.library.value)),
        ...[...bundle.files].filter(([, loaded]) => loaded.bytes).map(([file, loaded]) => byteEntry(file, loaded.bytes, loaded.bytes))];
      const undo = await prepareChangeUndo(context, { id: changeId, permission: 'editor.write', resourceIds: [id], entries,
        events: [libraryEvent(bundle.library, bundle.entry.kind, bundle.library.bytes)] });
      const response = { editor: { ...editor, ...item, libraryRevision: hashBytes(jsonBytes(bundle.library.value)) }, previousId: id, changeId, undoUntil: undo.undoUntil };
      await libraryCommit(context, [...entries, undo.entry], [libraryEvent(bundle.library, bundle.entry.kind)], { status: 200, body: response }, changeId);
      return response;
    }
    if (input.confirmedRepositoryChange !== true) fail(422, 'confirmation_required', 'Moving the file to another repository requires confirmation.');
    const destination = await loadLibrary(context, input.project);
    validateFolder(destination, input.folderId, bundle.entry.kind);
    const file = inside(destination.project.localPath, input.path);
    const newId = editorId(bundle.entry.kind, input.project, input.path);
    if (bundle.catalog.value.resources.some((entry) => entry.id === newId || entry.project === input.project && (entry.path === input.path || bundle.entry.kind === 'blueprint' && entry.legacyId === bundle.entry.legacyId))) fail(409, 'resource_exists', 'The destination resource already exists.');
    const entry = { ...bundle.entry, id: newId, project: input.project, path: input.path, attached: await canonicalAttachments(context, (await readAttachments(context, id)).attached) };
    const targetFound = { project: destination.project, entry };
    const entries = [];
    for (const [source, loaded] of bundle.files) {
      if (!loaded.bytes) continue;
      let target;
      if (source === bundle.file) target = file;
      else if (source === bundle.comments.file) target = commentsPath(targetFound);
      else if (source === bindingFile(context, id)) target = bindingFile(context, newId);
      else if (source === assetRegistryFile(context, id)) target = assetRegistryFile(context, newId);
      else if (source.startsWith(`${stemOf(bundle.file)}.`)) target = `${stemOf(file)}${source.slice(stemOf(bundle.file).length)}`;
      else target = inside(destination.project.localPath, `docs/flows/history/${newId}/${path.basename(source)}`);
      const existing = await loadBytes(target);
      if (existing.bytes) fail(409, 'resource_exists', 'A destination bundle file already exists.');
      let bytes = loaded.bytes;
      if (source === bundle.comments.file || source === bindingFile(context, id) || source === assetRegistryFile(context, id)
        || source.includes(`${path.sep}history${path.sep}`) && !source.endsWith('.document.json') && !source.endsWith('.comments.json')) {
        const value = remapResource(parseJson(bytes), id, newId);
        if (source === bundle.comments.file && entry.kind === 'void') value.path = path.basename(input.path);
        if (value.format === 'hivem1nd-editor-history-v1') {
          value.documentPath = input.path;
          value.commentsPath = path.relative(destination.project.localPath, commentsPath(targetFound)).replaceAll('\\', '/');
        }
        bytes = jsonBytes(value);
      }
      entries.push(byteEntry(source, loaded.bytes, null), byteEntry(target, null, bytes));
    }
    for (const asset of await ownedAssets(context, [bundle], entries)) {
      const target = inside(destination.project.localPath, `docs/flows/assets/${asset.name}`), loaded = await loadBytes(target);
      if (loaded.bytes && !loaded.bytes.equals(asset.bytes)) fail(409, 'resource_exists', 'A destination asset already exists.');
      entries.push(byteEntry(target, loaded.bytes, asset.bytes));
      if (!asset.shared) entries.push(byteEntry(asset.file, asset.bytes, null));
    }
    if (entry.kind === 'blueprint') {
      const sourceIndex = await loadBytes(indexFile(bundle.project)), targetIndex = await loadBytes(indexFile(destination.project));
      if (sourceIndex.bytes) entries.push(byteEntry(indexFile(bundle.project), sourceIndex.bytes, jsonBytes(removeIndex(parseJson(sourceIndex.bytes), new Set([entry.legacyId])))));
      entries.push(byteEntry(indexFile(destination.project), targetIndex.bytes, jsonBytes(mergeIndex(targetIndex.bytes ? parseJson(targetIndex.bytes) : null, parseJson(bundle.loaded.bytes)))));
    }
    const sourceLibrary = bundle.library;
    const item = sourceLibrary.value.items[id] ?? { folderId: null, title: entry.legacyId };
    delete sourceLibrary.value.items[id];
    destination.value.items[newId] = { ...item, folderId: input.folderId, updatedAt: clock(context) };
    const catalog = { ...bundle.catalog.value, resources: bundle.catalog.value.resources.map((resource) => resource.id === id ? entry : resource) };
    entries.push(byteEntry(sourceLibrary.file, sourceLibrary.bytes, jsonBytes(sourceLibrary.value)), byteEntry(destination.file, destination.bytes, jsonBytes(destination.value)),
      byteEntry(catalogFile(context), bundle.catalog.bytes, jsonBytes(catalog)));
    const changeId = randomUUID();
    const unique = uniqueEntries(entries);
    const undo = await prepareChangeUndo(context, { id: changeId, permission: 'editor.write', resourceIds: [id, newId], entries: unique,
      events: [libraryEvent(sourceLibrary, entry.kind, sourceLibrary.bytes ?? jsonBytes(sourceLibrary.value)), libraryEvent(destination, entry.kind, destination.bytes ?? jsonBytes(destination.value)),
        { name: 'editor.removed', resourceId: newId, data: { resourceId: newId, changeId, undoUntil: null } }, { name: 'view.changed', data: { collections: ['editors'], revision: changeId } }] });
    const response = { editor: { ...await projectEditor(context, bundle.entry, bundle.entry.readOnly ? null : parseJson(bundle.loaded.bytes), bundle.loaded.revision),
      id: newId, project: entry.project, path: entry.path, folderId: input.folderId, updatedAt: destination.value.items[newId].updatedAt,
      attachmentRevision: revisionOf(unique.find((item) => item.recordPath === bindingFile(context, newId))?.afterBytes),
      commentsRevision: revisionOf(unique.find((item) => item.recordPath === commentsPath(targetFound))?.afterBytes), libraryRevision: hashBytes(jsonBytes(destination.value)) }, previousId: id, changeId, undoUntil: undo.undoUntil };
    await libraryCommit(context, [...unique, undo.entry], [libraryEvent(sourceLibrary, entry.kind), libraryEvent(destination, entry.kind),
      { name: 'editor.removed', resourceId: id, data: { resourceId: id, changeId, undoUntil: undo.undoUntil } }, { name: 'view.changed', data: { collections: ['editors'], revision: changeId } }], { status: 200, body: response }, changeId);
    invalidateEditor(context, id);
    return response;
  });
}

