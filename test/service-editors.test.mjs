import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { mkdir, readFile, readdir, rename, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addScreen, newSketch, rectangleNode } from '../features/blueprint/review/sketch-format.mjs';
import { addNode, answerProposal, createAsset, createBoard, commentRecipients, createComment, createText, discoverResources, editorSearchText, list, notifyAttached, observeExternal, preserveUnknown, readAsset, readAttachments, readComments, readEditor, registerResource, removeNode, replaceBoard, replaceRange, replaceText, replyComment, updateNode, validateBoard, validateText, writeAttachments } from '../engine/service/editors.mjs';
import { createFolder, duplicateEditor, importBoard, listFolders, moveEditor, patchEditorLibrary, patchFolder, readLegacyExport, removeEditor, removeFolder } from '../engine/service/editors.mjs';
import { listHistory, restoreHistory, resolveConflict, setCommentStatus } from '../engine/service/editors.mjs';
import { replaceTextMatches, undoTextReplace } from '../engine/service/editors.mjs';
import { legacyModuleUrls } from '../gui/app/main.mjs';
import { undoChange } from '../engine/service/store.mjs';
import { atomicWrite, commitTransaction, recoverTransactions, withReceipt } from '../engine/service/store.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { clearUnit, createWatch, disposeViewer, recordActivity, resolveActivity, start as startWatch, stop as stopWatch } from '../engine/service/watch.mjs';
import { plain } from '../features/void/text.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { applyPack } from '../engine/sync/apply.mjs';
import { openOrigin, readHead, readOriginPack } from '../engine/sync/origin.mjs';
import { createPulse } from '../engine/sync/pulse.mjs';
import { openSync } from '../engine/sync/store.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { createStore, revisionOf } from '../engine/service/store.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { WEBP } from './media-fixture.mjs';

function replaceMatch(editor, k, lang, start, end, replacement) {
  return { resourceId: editor.id, k, lang, start, end, expectedText: editor.document.pages.find((page) => page.k === k)[lang].slice(start, end), replacement, expectedRevision: editor.revision };
}

test('replace validates every text and comments revision before one batch and one non-expiring Undo retains History', async (t) => {
  const { context, fixture, localPath } = await shop(t);
  const document = { title: 'Batch', future: { kept: true }, rev: 0, pages: [{ k: 'One', en: '**cat** cat 😀', es: 'gato gato', future: { kept: true } }, { k: 'Two', en: 'cat' }] };
  const first = await createText(context, { project: 'shop', path: 'docs/first.json', document });
  const second = await createText(context, { project: 'shop', path: 'docs/second.json', document });
  const before = await Promise.all([first, second].map((editor) => readFile(path.join(localPath, editor.path))));
  const body = { items: [replaceMatch(first, 'One', 'en', 2, 5, 'dog'), replaceMatch(first, 'One', 'en', 8, 11, 'dog'), replaceMatch(first, 'Two', 'en', 0, 3, 'dog'), replaceMatch(second, 'One', 'es', 5, 9, 'perro')],
    expectedCommentsRevisions: { [first.id]: first.commentsRevision, [second.id]: second.commentsRevision } };
  const saved = await replaceTextMatches(context, body);
  assert.equal(saved.matches, 4); assert.equal(saved.editors.length, 2);
  assert.equal(saved.editors[0].document.pages[0].en, '**dog** dog 😀');
  assert.equal(saved.editors[1].document.pages[0].es, 'gato perro');
  assert.deepEqual(saved.editors[0].document.future, document.future);
  assert.deepEqual(saved.editors[0].document.pages[0].future, document.pages[0].future);
  assert.equal(new Set(context.lastEditorChanges.map((change) => change.transactionId)).size, 1);
  fixture.clock.now += 60000;
  const undone = await undoTextReplace(context, saved.changeId);
  assert.equal(undone.undoOf, saved.changeId);
  for (let index = 0; index < 2; index++) {
    const editor = [first, second][index];
    assert.deepEqual(await readFile(path.join(localPath, editor.path)), before[index]);
    const history = await listHistory(context, editor.id);
    assert.ok(history.items.length >= 3); assert.equal(history.items.filter((item) => item.current).length, 1);
  }
  const writes = fixture.store.writes.length;
  await assert.rejects(() => undoTextReplace(context, saved.changeId), { code: 'undo_conflict' });
  assert.equal(fixture.store.writes.length, writes);
});

test('one stale target, changed range, overlap, split character or comments conflict writes none of the replacement batch', async (t) => {
  const { context, fixture, localPath } = await shop(t);
  const document = { title: 'Batch', pages: [{ k: 'One', en: 'cat cat 😀' }] };
  const first = await createText(context, { project: 'shop', path: 'docs/first.json', document });
  const second = await createText(context, { project: 'shop', path: 'docs/second.json', document });
  const body = { items: [replaceMatch(first, 'One', 'en', 0, 3, 'dog'), replaceMatch(second, 'One', 'en', 4, 7, 'dog')], expectedCommentsRevisions: { [first.id]: first.commentsRevision, [second.id]: second.commentsRevision } };
  for (const [edit, code] of [
    [(value) => { value.items[1].expectedRevision = '0'.repeat(64); }, 'revision_conflict'],
    [(value) => { value.items[1].expectedText = 'stale'; }, 'range_changed'],
    [(value) => { value.expectedCommentsRevisions[second.id] = null; }, 'revision_conflict'],
    [(value) => { value.items.push({ ...value.items[0], start: 2, end: 5, expectedText: 't c' }); }, 'invalid_range'],
    [(value) => { value.items[1] = replaceMatch(second, 'One', 'en', 8, 9, 'dog'); }, 'invalid_range'],
    [(value) => { value.items[1].extra = true; }, 'unknown_field'],
  ]) {
    const invalid = structuredClone(body); edit(invalid); const writes = fixture.store.writes.length;
    await assert.rejects(() => replaceTextMatches(context, invalid), { code });
    assert.equal(fixture.store.writes.length, writes);
    for (const editor of [first, second]) assert.deepEqual(JSON.parse(await readFile(path.join(localPath, editor.path))), { ...document, rev: 0 });
  }
  const saved = await replaceTextMatches(context, body);
  await replaceRange(context, second.id, { ...replaceMatch(saved.editors[1], 'One', 'en', 0, 3, 'later') });
  const before = await readFile(path.join(localPath, first.path)), writes = fixture.store.writes.length;
  await assert.rejects(() => undoTextReplace(context, saved.changeId), { code: 'undo_conflict' });
  assert.deepEqual(await readFile(path.join(localPath, first.path)), before); assert.equal(fixture.store.writes.length, writes);
});

test('whole replace Undo also conflicts on later comments and a same-value replace remains one operation', async (t) => {
  const { context, fixture, localPath } = await shop(t);
  const first = await createText(context, { project: 'shop', path: 'docs/same.json', document: release() });
  const body = { items: [replaceMatch(first, 'Intro.Welcome', 'en', 3, 10, 'Welcome')], expectedCommentsRevisions: { [first.id]: first.commentsRevision } };
  const saved = await replaceTextMatches(context, body);
  assert.equal(saved.matches, 1); assert.equal(saved.editors[0].document.pages[0].en, first.document.pages[0].en);
  await writeFile(path.join(localPath, 'docs/same.comments.json'), JSON.stringify({ threads: [], later: true }));
  const writes = fixture.store.writes.length;
  await assert.rejects(() => undoTextReplace(context, saved.changeId), { code: 'undo_conflict' });
  assert.equal(fixture.store.writes.length, writes);
});

test('replace and Undo recover the entire multi-text journal and replay one receipt after every crash boundary', async (t) => {
  for (const fault of [{ afterPrepared: true }, { afterRenames: 1 }, { beforeReceipt: true }, { afterReceipt: true }]) await t.test(JSON.stringify(fault), async (t) => {
    const { context, fixture, localPath } = await shop(t);
    const document = { title: 'Batch', pages: [{ k: 'One', en: 'cat' }] };
    const texts = [];
    for (const name of ['first', 'second']) texts.push(await createText(context, { project: 'shop', path: `docs/${name}.json`, document }));
    const body = { items: texts.map((editor) => replaceMatch(editor, 'One', 'en', 0, 3, 'dog')), expectedCommentsRevisions: Object.fromEntries(texts.map((editor) => [editor.id, editor.commentsRevision])) };
    const request = { principal: 'replace-fixture', key: randomUUID(), requestId: randomUUID(), method: 'POST', path: '/void/replace', body };
    const run = (receipt) => replaceTextMatches({ ...context, receipt }, body);
    fixture.store.fault = fault;
    await assert.rejects(() => withReceipt(fixture.store, request, run), { code: 'injected_crash' });
    const store = createStore({ root: fixture.root, confineRoot: fixture.root, mindPath: fixture.paths.mind, localDirectory: fixture.paths.localDirectory, projects: context.projects, now: context.now });
    await recoverTransactions(store);
    const restarted = { ...context, store }, replay = await withReceipt(store, request, () => assert.fail('Replace was executed twice.'));
    const changeId = replay.body.changeId;
    for (const editor of texts) assert.equal((await readEditor(restarted, editor.id)).document.pages[0].en, 'dog');
    const undoRequest = { ...request, key: randomUUID(), requestId: randomUUID(), path: `/void/replace/${changeId}/undo`, body: {} };
    store.fault = fault;
    await assert.rejects(() => withReceipt(store, undoRequest, (receipt) => undoTextReplace({ ...restarted, receipt }, changeId)), { code: 'injected_crash' });
    await recoverTransactions(store);
    const undone = await withReceipt(store, undoRequest, () => assert.fail('Undo was executed twice.'));
    assert.equal(undone.body.undoOf, changeId);
    for (const editor of texts) assert.deepEqual(JSON.parse(await readFile(path.join(localPath, editor.path))), { ...document, rev: 0 });
  });
});

test('HTTP whole replace and Undo bind desktop permission exact bodies bounded matches receipts and the same-origin worker', async (t) => {
  const { context, fixture, cleanups } = await shop(t);
  const first = await createText(context, { project: 'shop', path: 'docs/http.json', document: release() });
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: context.now, projects: context.projects }); cleanups.push(() => core.http.close());
  const auth = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } });
  const token = auth.json.data.token, body = { items: [replaceMatch(first, 'Intro.Welcome', 'en', 3, 10, 'Hello')], expectedCommentsRevisions: { [first.id]: first.commentsRevision } }, key = randomUUID();
  for (const audience of ['phone', 'agent']) {
    const credential = core.credentials.issue({ audience, unitId: audience === 'agent' ? 'root:builder' : 'root:master', capabilities: ['editor.write'], expiresAt: '2027-01-01T00:00:00.000Z' });
    const denied = await call(core.http.port, 'POST', '/api/v1/void/replace', { token: credential.token, body, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(denied.status, 403);
    const undoDenied = await call(core.http.port, 'POST', `/api/v1/void/replace/${randomUUID()}/undo`, { token: credential.token, body: {}, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(undoDenied.status, 403);
  }
  for (const invalid of [{ ...body, pattern: 'cat' }, { ...body, items: [{ ...body.items[0], unknown: true }] }, { items: body.items }, { ...body, items: Array(10001).fill(body.items[0]) }]) {
    const result = await call(core.http.port, 'POST', '/api/v1/void/replace', { token, body: invalid, headers: { 'idempotency-key': randomUUID() } });
    assert.ok([400, 422].includes(result.status));
  }
  const saved = await call(core.http.port, 'POST', '/api/v1/void/replace', { token, body, headers: { 'idempotency-key': key } });
  assert.equal(saved.status, 200); assert.equal(saved.json.data.matches, 1);
  const replay = await call(core.http.port, 'POST', '/api/v1/void/replace', { token, body, headers: { 'idempotency-key': key } });
  assert.deepEqual(replay.json.data, saved.json.data);
  const undo = await call(core.http.port, 'POST', `/api/v1/void/replace/${saved.json.data.changeId}/undo`, { token, body: {}, headers: { 'idempotency-key': randomUUID() } });
  assert.equal(undo.status, 200); assert.equal(undo.json.data.editors[0].document.pages[0].en, first.document.pages[0].en);
  const worker = await call(core.http.port, 'GET', '/app/find-worker.mjs');
  assert.equal(worker.status, 200); assert.match(worker.headers['content-security-policy'], /worker-src 'self'/);
});

function legacyModule(id = 'legacy') {
  return `import { board } from "blueprint/board.mjs";
import { col, row, text } from "blueprint/kit.mjs";
export default board({id: ${JSON.stringify(id)}, title: "Real legacy", future: {kept: true},
  pages: [{id: "first-page", title: "First page", objects: [], order: ["first"]}, {id: "second-page", title: "Second page", objects: [], order: ["second"]}],
  screens: [{id: "first", title: "First", pageId: "first-page", w: 400, h: 300, root: () => col({pad: 12, fill: "surface", radius: "lg", future: {node: true}}, row({name: "continue", gap: 8}, text("Actual nested text", {size: 22, weight: 700, color: "accent"})))},
    {id: "second", title: "Second", pageId: "second-page", col: 1, root: col({}, text("Actual second page"))}],
  links: [{from: "first", to: "second", at: "continue", label: "Continue", future: true}]});`;
}

async function evaluateExport(manifest) {
  const before = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ measureText: (value) => ({ width: value.length * 8 }) }) }) };
  try {
    const urls = legacyModuleUrls(manifest, (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const [source, kit, skins, exporter, schema] = await Promise.all([urls.module, urls.kit, urls.skins, urls.exporter, urls.schema].map((url) => import(url)));
    kit.useSkin(skins.skins.design);
    const document = exporter.exportBoard(source.default, { layout: kit.layout, normalize: schema.normalizeBoard, skin: skins.skins.design, sketch: manifest.sketch });
    document.legacySource = manifest.sourceRevisions;
    return document;
  } finally { if (before === undefined) delete globalThis.document; else globalThis.document = before; }
}

async function registeredLegacy(context, localPath, id = 'legacy', source = legacyModule(id)) {
  const relative = `docs/flows/boards/${id}.mjs`, file = path.join(localPath, relative);
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, source);
  await writeFile(path.join(path.dirname(file), 'index.json'), JSON.stringify([{ id, title: 'Legacy', futureIndex: true }]));
  const editor = await registerResource(context, { project: 'shop', path: relative, kind: 'blueprint' });
  return { editor, file, relative };
}

test('legacy import retains real screens nested text two pages links sketches unknown fields and read-only source history', async (t) => {
  const { context, localPath, fixture } = await shop(t);
  const { editor: legacy, file } = await registeredLegacy(context, localPath);
  const sketchDocument = sketch('legacy'); sketchDocument.future = { drawing: true };
  sketchDocument.screens[0].root.kids.push({ id: 'hand-pen', name: 'Hand pen', t: 'vector', kind: 'pen', place: { x: 2, y: 3 }, w: 60, h: 30, d: 'M0 0 L100 100', stroke: '#112233', strokeWidth: 4, opacity: 0.4, futureStroke: true });
  const sketchFile = path.join(localPath, 'docs/flows/sketches/legacy.json'); await mkdir(path.dirname(sketchFile), { recursive: true }); await writeFile(sketchFile, JSON.stringify(sketchDocument));
  const oldHistory = path.join(localPath, `docs/flows/history/${legacy.id}/prior.json`); await mkdir(path.dirname(oldHistory), { recursive: true }); await writeFile(oldHistory, '{"readOnly":true}');
  const original = await readFile(file), originalStat = await stat(file), oldSketch = await readFile(sketchFile), history = await readFile(oldHistory);
  const exported = await readLegacyExport(context, legacy.id), document = await evaluateExport(exported);
  const imported = await importBoard(context, { project: 'shop', path: exported.path, title: 'Imported real board', folderId: null, legacyResourceId: legacy.id, document, expectedRevision: legacy.revision });
  assert.equal(imported.path, file.slice(localPath.length + 1).replaceAll('\\', '/').replace(/\.mjs$/, '.json'));
  assert.notEqual(imported.id, legacy.id); assert.equal(imported.readOnly, false);
  assert.equal(imported.document.screens.length, 2 + sketchDocument.screens.length); assert.equal(imported.document.pages.length, 3);
  assert.equal(imported.document.screens[0].root.kids[0].kids[0].value, 'Actual nested text');
  assert.equal(imported.document.screens[0].root.radius, 14); assert.equal(imported.document.screens[0].root.future.node, true);
  assert.equal(imported.document.links[0].element, imported.document.screens[0].root.kids[0].id);
  assert.equal(imported.document.legacySketch.future.drawing, true); assert.deepEqual(imported.document.screens.at(-1), sketchDocument.screens[0]);
  assert.deepEqual(await readFile(file), original); assert.equal((await stat(file)).mtimeMs, originalStat.mtimeMs);
  assert.deepEqual(await readFile(sketchFile), oldSketch); assert.deepEqual(await readFile(oldHistory), history);
  assert.equal(fixture.store.writes.includes(file), false);
  const catalog = JSON.parse(await readFile(path.join(context.paths.mind, 'user/gui/resources.json')));
  assert.equal(catalog.resources.find((entry) => entry.id === legacy.id).convertedTo, imported.id);
  assert.equal(catalog.resources.find((entry) => entry.id === imported.id).importedFrom, legacy.id);
  const index = JSON.parse(await readFile(path.join(localPath, 'docs/flows/boards/index.json')));
  assert.equal(index[0].path, imported.path); assert.equal(index[0].futureIndex, true); assert.equal(index[0].legacyPath, legacy.path);
  assert.equal((await readEditor(context, legacy.id)).readOnly, true);
  const saved = await replaceBoard(context, imported.id, { document: { ...imported.document, note: 'Retained after saving' }, expectedRevision: imported.revision });
  assert.equal(saved.document.future.kept, true);
  await assert.rejects(() => importBoard(context, { project: 'shop', path: exported.path, title: 'Again', folderId: null, legacyResourceId: legacy.id, document, expectedRevision: legacy.revision }), { code: 'revision_conflict' });
});

test('legacy exporter refuses unregistered outside linked unavailable and changed sources without creating a substitute', async (t) => {
  const { context, localPath, fixture } = await shop(t);
  const { editor, file } = await registeredLegacy(context, localPath);
  await assert.rejects(() => readLegacyExport(context, randomUUID()), { code: 'not_found' });
  await writeFile(path.join(localPath, 'outside.mjs'), legacyModule());
  const outside = await registerResource(context, { project: 'shop', path: 'outside.mjs', kind: 'blueprint' });
  await assert.rejects(() => readLegacyExport(context, outside.id), { code: 'import_unavailable' });
  const exported = await readLegacyExport(context, editor.id), document = await evaluateExport(exported);
  const input = { project: 'shop', path: exported.path, title: 'Import', folderId: null, legacyResourceId: editor.id, document, expectedRevision: exported.expectedRevision };
  const before = fixture.store.writes.length;
  await assert.rejects(() => importBoard(context, { ...input, path: '../outside.json' }), { code: 'invalid_path' });
  await writeFile(file, `${legacyModule()}\nthrow new Error("exporter error");`);
  const failed = await readLegacyExport(context, editor.id);
  await assert.rejects(() => evaluateExport(failed), /exporter error/);
  await assert.rejects(() => importBoard(context, input), { code: 'revision_conflict' });
  assert.equal(fixture.store.writes.length, before);
  await assert.rejects(() => readFile(path.join(localPath, exported.path)), { code: 'ENOENT' });
  const kit = path.join(localPath, 'docs/flows/kit'), target = path.join(localPath, 'linked-kit');
  await mkdir(target); await writeFile(path.join(target, 'kit.mjs'), 'export const forbidden = true;');
  await symlink(target, kit, 'junction');
  await assert.rejects(() => readLegacyExport(context, editor.id), { code: 'unsafe_path' });
  const boards = path.dirname(file), keptBoards = path.join(localPath, 'kept-boards');
  await rename(boards, keptBoards); await symlink(keptBoards, boards, 'junction');
  await assert.rejects(() => readLegacyExport(context, editor.id), { code: 'unsafe_path' });
});

test('HTTP legacy export and import require exact desktop bodies and never evaluate uploaded or registered code on the service', async (t) => {
  const fixture = await makeCoreFixture(), localPath = path.join(fixture.paths.localDirectory, 'shop'); await mkdir(localPath, { recursive: true });
  const projects = [{ name: 'shop', localPath }];
  const context = { paths: fixture.paths, store: fixture.store, projects, now: () => fixture.clock.now };
  const { editor, file } = await registeredLegacy(context, localPath, 'legacy', `${legacyModule()}\nglobalThis.legacyExecutionMarker = true;`);
  const original = await readFile(file);
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects });
  t.after(async () => { await core.http.close(); await dispose(fixture); delete globalThis.legacyExecutionMarker; });
  const auth = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } });
  const token = auth.json.data.token;
  const manifest = await call(core.http.port, 'GET', `/api/v1/blueprint/boards/${editor.id}/export`, { token });
  assert.equal(manifest.status, 200); assert.equal(globalThis.legacyExecutionMarker, undefined);
  const data = manifest.json.data, document = await evaluateExport(data); delete globalThis.legacyExecutionMarker;
  document.uploadedCode = 'globalThis.uploadedExecutionMarker = true';
  const body = { project: 'shop', path: data.path, title: 'HTTP real board', folderId: null, legacyResourceId: editor.id, document, expectedRevision: data.expectedRevision };
  for (const invalid of [{ ...body, module: 'globalThis.uploadedExecutionMarker = true' }, { ...body, expectedRevision: undefined }, { ...body, document: 'export default {}' }]) {
    const response = await call(core.http.port, 'POST', '/api/v1/blueprint/boards/import', { token, body: invalid, headers: { 'idempotency-key': randomUUID() } });
    assert.ok([400, 422].includes(response.status));
  }
  const key = randomUUID();
  const imported = await call(core.http.port, 'POST', '/api/v1/blueprint/boards/import', { token, body, headers: { 'idempotency-key': key } });
  assert.equal(imported.status, 201, JSON.stringify(imported.json));
  const replay = await call(core.http.port, 'POST', '/api/v1/blueprint/boards/import', { token, body, headers: { 'idempotency-key': key } });
  assert.equal(replay.status, 201); assert.equal(replay.json.data.id, imported.json.data.id);
  assert.equal(globalThis.legacyExecutionMarker, undefined); assert.equal(globalThis.uploadedExecutionMarker, undefined);
  assert.equal(imported.json.data.document.screens.length, 2); assert.equal(imported.json.data.document.uploadedCode, document.uploadedCode);
  assert.deepEqual(await readFile(file), original);
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body) >>> 0, 8 + data.length);
  return chunk;
}

function framedWebp() { return Buffer.from(WEBP); }

function headerOnlyWebp() {
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0);
  webp.writeUInt32LE(22, 4);
  webp.write('WEBP', 8);
  webp.write('VP8X', 12);
  webp.writeUInt32LE(10, 16);
  return webp;
}

function pngWithoutImage() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function sketch(id = 'cart') {
  const document = newSketch(id, 'Cart');
  addScreen(document, { title: 'Bag', x: 0, y: 0 });
  return document;
}

async function shop(t) {
  const fixture = await makeCoreFixture();
  const cleanups = [];
  const localPath = path.join(fixture.paths.localDirectory, 'shop');
  await mkdir(localPath, { recursive: true });
  const ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.paths.machine });
  const context = { store: fixture.store, paths: fixture.paths, projects: [{ name: 'shop', localPath }], now: () => fixture.clock.now, ledger };
  t.after(async () => { for (const cleanup of cleanups.toReversed()) await cleanup(); await dispose(fixture); });
  return { fixture, context, localPath, cleanups };
}

async function seedAttachedUnits(context, ids) {
  for (const id of ids) {
    const parts = id.split(':');
    const relative = parts[0] === 'root' ? `user/state/${parts[1]}.md` : `user/projects/${parts[1]}/state/${parts[2]}.md`;
    const file = path.join(context.paths.mind, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `unit: ${parts.at(-1)}\nunit-id: ${id}\nrole: executor\nscope: ${parts[0] === 'root' ? 'root' : `project:${parts[1]}`}\nmachine: DESKTOP\n\n`);
  }
}

function managementRevisions(editor) {
  return { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision,
    expectedAttachmentRevision: editor.attachmentRevision, expectedLibraryRevision: editor.libraryRevision };
}

async function savedHistoryBytes(localPath, resourceId, item) {
  const root = path.join(localPath, 'docs/flows/history', resourceId, item.id);
  return { document: await readFile(`${root}.document.json`), comments: await readFile(`${root}.comments.json`).catch((error) => { if (error.code === 'ENOENT') return null; throw error; }),
    metadata: JSON.parse(await readFile(`${root}.json`, 'utf8')) };
}

test('History versions every board title comment node and sketch with trusted author source and complete pagination', async (t) => {
  const { context, localPath } = await shop(t);
  await seedAttachedUnits(context, ['project:shop:executor']);
  let editor = await createBoard(context, { project: 'shop', document: sketch('history-board'), attached: ['project:shop:executor'] });
  const initial = editor;
  editor = await patchEditorLibrary(context, editor.id, { title: 'Renamed board', expectedRevision: editor.revision, expectedLibraryRevision: editor.libraryRevision });
  const comment = await createComment(context, editor.id, { text: 'Keep this note', anchor: { label: 'Canvas' }, expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  await replyComment(context, editor.id, comment.thread.id, { text: 'Reply', expectedCommentsRevision: comment.commentsRevision });
  editor = await readEditor(context, editor.id);
  await setCommentStatus(context, editor.id, comment.thread.id, { status: 'resolved', expectedCommentsRevision: editor.commentsRevision });
  editor = await readEditor(context, editor.id);
  const screen = editor.document.screens[0];
  const agent = { ...context, principal: { audience: 'agent', unitId: 'project:shop:executor' } };
  const box = rectangleNode(structuredClone(editor.document), { x: 20, y: 20, w: 100, h: 80 }, { stroke: '#123456', strokeWidth: 2 });
  box.id = 'history-box';
  editor = (await addNode(agent, editor.id, { screenId: screen.id, parentId: screen.root.id, node: box, expectedRevision: editor.revision })).editor;
  editor = await updateNode(agent, editor.id, 'history-box', { changes: { w: 120 }, expectedRevision: editor.revision });
  editor = await removeNode(agent, editor.id, 'history-box', { expectedRevision: editor.revision });
  const drawn = structuredClone(editor.document);
  drawn.screens[0].root.kids.push({ id: 'history-pen', name: 'Stroke', t: 'vector', kind: 'pen', place: { x: 0, y: 0 }, w: 100, h: 100, d: 'M0 0 L100 100', stroke: '#123456', strokeWidth: 2, opacity: 1 });
  editor = await replaceBoard(agent, editor.id, { document: drawn, expectedRevision: editor.revision });
  const history = await listHistory(context, editor.id, { limit: 100 });
  assert.deepEqual(history.items.map((item) => item.operation), ['sketch', 'board-edit', 'board-edit', 'board-edit', 'comment', 'comment', 'comment', 'rename', 'create']);
  assert.equal(history.items[0].current, true); assert.equal(history.items.filter((item) => item.current).length, 1);
  assert.equal(history.items[0].by, 'project:shop:executor'); assert.equal(history.items[0].source.kind, 'mcp');
  assert.equal(history.items.at(-1).by, 'root:master');
  const first = await listHistory(context, editor.id, { limit: 2 });
  const second = await listHistory(context, editor.id, { limit: 2, cursor: first.nextCursor });
  assert.deepEqual([...first.items, ...second.items].map((item) => item.id), history.items.slice(0, 4).map((item) => item.id));
  for (const item of history.items) {
    const saved = await savedHistoryBytes(localPath, editor.id, item);
    assert.equal(revisionOf(saved.document), item.revision); assert.equal(revisionOf(saved.comments), item.commentsRevision);
    assert.equal(saved.metadata.source.unitId, item.by);
  }
  const renamed = history.items.find((item) => item.operation === 'rename');
  assert.equal((await savedHistoryBytes(localPath, editor.id, renamed)).metadata.title, 'Renamed board');
  editor = await restoreHistory(context, editor.id, history.items.at(-1).id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  assert.equal(editor.title, initial.title); assert.equal(editor.threads.length, 0);
  const restored = await restoreHistory(context, editor.id, history.items[0].id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  assert.equal(restored.title, 'Renamed board'); assert.equal(restored.threads[0].status, 'resolved');
  assert.equal(restored.document.screens[0].root.kids.at(-1).kind, 'pen');
});

test('Void History retains range proposal and comment bytes through Restore and restore-back with monotonic rev and original deltas', async (t) => {
  const { context, localPath, fixture } = await shop(t);
  let editor = await createText(context, { project: 'shop', path: 'docs/history-text.json', document: release() });
  const original = await readFile(path.join(localPath, 'docs/history-text.orig.json'));
  const initial = (await listHistory(context, editor.id)).items[0];
  const comment = await createComment(context, editor.id, { text: 'Suggestion', anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 7, quote: 'Welcome' }, expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  const proposal = await replaceRange(context, editor.id, { k: 'Intro.Welcome', lang: 'en', start: 3, end: 10, expectedText: 'Welcome', replacement: 'Hello', expectedRevision: editor.revision, expectedCommentsRevision: comment.commentsRevision, threadId: comment.thread.id, mode: 'propose' });
  editor = (await answerProposal(context, editor.id, proposal.proposal.id, { decision: 'accept', expectedRevision: editor.revision, expectedCommentsRevision: proposal.editor.commentsRevision })).editor;
  editor = (await replaceRange(context, editor.id, { k: 'Intro.Welcome', lang: 'en', start: 3, end: 8, expectedText: 'Hello', replacement: 'Updated', expectedRevision: editor.revision })).editor;
  const bytes = await readFile(path.join(localPath, editor.path)), comments = await readFile(path.join(localPath, 'docs/history-text.comments.json'));
  const current = (await listHistory(context, editor.id)).items[0];
  const operations = (await listHistory(context, editor.id)).items.map((item) => item.operation);
  assert.deepEqual(operations, ['text-edit', 'proposal', 'proposal', 'comment', 'create']);
  const writes = fixture.store.writes.length;
  await assert.rejects(() => restoreHistory(context, editor.id, initial.id, { expectedRevision: editor.revision, expectedCommentsRevision: null }), { code: 'revision_conflict' });
  assert.equal(fixture.store.writes.length, writes);
  editor = await restoreHistory(context, editor.id, initial.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  assert.equal(editor.document.rev, 3); assert.deepEqual(editor.document.pages, release().pages); assert.equal(editor.threads.length, 0);
  editor = await restoreHistory(context, editor.id, current.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  assert.equal(editor.document.rev, 4); assert.deepEqual(editor.document.pages, JSON.parse(bytes).pages); assert.equal(editor.document.note, 'keep');
  assert.deepEqual(await readFile(path.join(localPath, 'docs/history-text.comments.json')), comments);
  assert.deepEqual(await readFile(path.join(localPath, 'docs/history-text.orig.json')), original);
  assert.equal((await readFile(path.join(localPath, 'docs/history-text.versions.jsonl'), 'utf8')).trim().split('\n').length, 4);
  const restoredHistory = await listHistory(context, editor.id);
  assert.equal(restoredHistory.items[0].operation, 'restore'); assert.equal(restoredHistory.items[0].current, true);
});

test('both conflict answers keep exact incoming bytes and the person draft and their authors for both editor kinds', async (t) => {
  for (const kind of ['blueprint', 'void']) for (const decision of ['keep-mine', 'reload']) await t.test(`${kind} ${decision}`, async (t) => {
    const { context, localPath } = await shop(t);
    await seedAttachedUnits(context, ['project:shop:executor']);
    let editor = kind === 'void' ? await createText(context, { project: 'shop', path: 'docs/conflict.json', document: release(), attached: ['project:shop:executor'] }) : await createBoard(context, { project: 'shop', document: sketch('conflict'), attached: ['project:shop:executor'] });
    const draft = structuredClone(editor.document), incoming = structuredClone(editor.document);
    draft.title = 'Person draft'; incoming.title = 'Agent version';
    const agent = { ...context, principal: { audience: 'agent', unitId: 'project:shop:executor' } };
    editor = await (kind === 'void' ? replaceText : replaceBoard)(agent, editor.id, { document: incoming, expectedRevision: editor.revision });
    const incomingBytes = await readFile(path.join(localPath, editor.path)), draftBytes = Buffer.from(`${JSON.stringify(draft, null, 2)}\n`);
    editor = await resolveConflict(context, editor.id, { decision, document: draft, expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
    const history = (await listHistory(context, editor.id, { limit: 100 })).items;
    const incomingCopy = history.find((item) => item.revision === revisionOf(incomingBytes) && item.by === 'project:shop:executor');
    const draftCopy = history.find((item) => item.revision === revisionOf(draftBytes) && item.source?.kind === 'draft');
    assert.ok(incomingCopy); assert.ok(draftCopy); assert.equal(draftCopy.by, 'root:master');
    assert.deepEqual((await savedHistoryBytes(localPath, editor.id, incomingCopy)).document, incomingBytes);
    assert.deepEqual((await savedHistoryBytes(localPath, editor.id, draftCopy)).document, draftBytes);
    assert.equal(editor.document.title, decision === 'keep-mine' ? 'Person draft' : 'Agent version');
    editor = await restoreHistory(context, editor.id, draftCopy.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
    assert.equal(editor.document.title, 'Person draft');
    editor = await restoreHistory(context, editor.id, incomingCopy.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
    assert.equal(editor.document.title, 'Agent version');
  });
});

test('History refuses malformed snapshots missing bytes unknown-field loss and oversized objects before any write', async (t) => {
  const { context, localPath, fixture } = await shop(t);
  let editor = await createText(context, { project: 'shop', path: 'docs/invalid-history.json', document: release() });
  const original = (await listHistory(context, editor.id)).items[0];
  const root = path.join(localPath, 'docs/flows/history', editor.id, original.id), saved = await readFile(`${root}.document.json`);
  let writes = fixture.store.writes.length;
  await writeFile(`${root}.document.json`, '{invalid');
  await assert.rejects(() => restoreHistory(context, editor.id, original.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision }), { code: 'corrupt_resource' });
  assert.equal(fixture.store.writes.length, writes); await writeFile(`${root}.document.json`, saved);
  const next = { ...editor.document, extension: { retained: true } };
  editor = await replaceText(context, editor.id, { document: next, expectedRevision: editor.revision });
  writes = fixture.store.writes.length;
  await assert.rejects(() => restoreHistory(context, editor.id, original.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision }), { code: 'unsupported_fields_lost' });
  await assert.rejects(() => resolveConflict(context, editor.id, { decision: 'reload', document: { ...editor.document, huge: 'x'.repeat(16_000_000) }, expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision }), { code: 'resource_too_large' });
  assert.equal(fixture.store.writes.length, writes);
  const names = await readdir(path.dirname(root)); assert.equal(names.length, 6);
  await assert.rejects(() => restoreHistory({ ...context, principal: { audience: 'phone' } }, editor.id, original.id, {}), { code: 'forbidden' });
});

test('editor edit and Restore recover with their complete History after every journal interruption', async (t) => {
  for (const fault of [{ afterPrepared: true }, { afterRenames: 1 }, { afterRenames: 4 }, { beforeReceipt: true }, { afterStage: true }, { afterReceipt: true }]) await t.test(JSON.stringify(fault), async (t) => {
    const { context, fixture } = await shop(t);
    let editor = await createText(context, { project: 'shop', path: 'docs/recovered-history.json', document: release() });
    const original = (await listHistory(context, editor.id)).items[0];
    fixture.store.fault = { ...fault };
    await assert.rejects(() => replaceText(context, editor.id, { document: { ...editor.document, title: 'Recovered' }, expectedRevision: editor.revision }), { code: 'injected_crash' });
    await recoverTransactions(fixture.store); editor = await readEditor(context, editor.id);
    const current = (await listHistory(context, editor.id)).items[0]; assert.equal(current.current, true); assert.equal(current.operation, 'rename');
    fixture.store.fault = { ...fault };
    await assert.rejects(() => restoreHistory(context, editor.id, original.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision }), { code: 'injected_crash' });
    await recoverTransactions(fixture.store); editor = await readEditor(context, editor.id);
    assert.equal(editor.title, release().title); assert.equal((await listHistory(context, editor.id)).items.length, 3);
    editor = await restoreHistory(context, editor.id, current.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
    assert.equal(editor.title, 'Recovered');
  });
});

test('conflict and Restore receipt recovery replays the saved editor once without losing a version', async (t) => {
  for (const operation of ['conflict', 'restore']) await t.test(operation, async (t) => {
    const { context, fixture } = await shop(t);
    let editor = await createText(context, { project: 'shop', path: 'docs/receipt-history.json', document: release() });
    const initial = (await listHistory(context, editor.id)).items[0];
    editor = await replaceText(context, editor.id, { document: { ...editor.document, title: 'Incoming' }, expectedRevision: editor.revision });
    const body = { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision,
      ...(operation === 'conflict' ? { decision: 'reload', document: { ...editor.document, title: 'Draft' } } : {}) };
    const input = { principal: 'fixture-history', key: randomUUID(), requestId: randomUUID(), method: 'POST', path: `/history/${operation}`, body };
    const run = (receipt) => operation === 'conflict' ? resolveConflict({ ...context, receipt }, editor.id, body) : restoreHistory({ ...context, receipt }, editor.id, initial.id, body);
    fixture.store.fault = { beforeReceipt: true };
    await assert.rejects(() => withReceipt(fixture.store, input, run), { code: 'injected_crash' });
    await recoverTransactions(fixture.store);
    const count = (await listHistory(context, editor.id)).total;
    const result = await withReceipt(fixture.store, input, run);
    assert.equal(result.replayed, true); assert.equal(result.body.id, editor.id);
    assert.equal(result.body.document.title, operation === 'conflict' ? 'Incoming' : release().title);
    assert.deepEqual(result.body, await readEditor(context, editor.id));
    assert.equal((await listHistory(context, editor.id)).total, count);
  });
});

test('History HTTP uses exact revision bodies paginated reads desktop-only writes and stable receipt replay', async (t) => {
  const fixture = await makeCoreFixture(), localPath = path.join(fixture.root, 'history-http');
  await mkdir(localPath, { recursive: true });
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: [{ name: 'shop', localPath }] });
  t.after(async () => { await core.http.close(); await dispose(fixture); });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } });
  const token = local.json.data.token;
  const created = await call(core.http.port, 'POST', '/api/v1/void/texts', { token, headers: { 'idempotency-key': randomUUID() }, body: { project: 'shop', path: 'docs/history.json', document: release() } });
  const editor = created.json.data, url = `/api/v1/editors/${editor.id}/history`;
  const history = await call(core.http.port, 'GET', `${url}?limit=1`, { token });
  assert.equal(history.status, 200); assert.equal(history.json.data.items[0].operation, 'create');
  assert.equal((await call(core.http.port, 'GET', `${url}?unknown=true`, { token })).status, 400);
  assert.equal((await call(core.http.port, 'GET', url)).status, 401);
  const restore = `${url}/${history.json.data.items[0].id}/restore`, body = { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision };
  const missing = await call(core.http.port, 'POST', restore, { token, headers: { 'idempotency-key': randomUUID() }, body: { expectedRevision: editor.revision } });
  assert.equal(missing.status, 422);
  const extra = await call(core.http.port, 'POST', restore, { token, headers: { 'idempotency-key': randomUUID() }, body: { ...body, extra: true } });
  assert.equal(extra.status, 400); assert.equal(extra.json.error.code, 'unknown_field');
  const headers = { 'idempotency-key': randomUUID() }, restored = await call(core.http.port, 'POST', restore, { token, headers, body });
  assert.equal(restored.status, 200); assert.equal(restored.json.data.document.rev, 1);
  const replay = await call(core.http.port, 'POST', restore, { token, headers, body });
  assert.equal(replay.status, 200); assert.deepEqual(replay.json.data, restored.json.data); assert.equal(replay.json.meta.replayed, true);
  assert.equal((await call(core.http.port, 'GET', url, { token })).json.data.total, 2);
});

test('initial History written by earlier tasks remains readable and restores its title without added provenance fields', async (t) => {
  const { context, localPath } = await shop(t);
  let editor = await createBoard(context, { project: 'shop', document: sketch('earlier-history') });
  const initial = (await listHistory(context, editor.id)).items[0], file = path.join(localPath, 'docs/flows/history', editor.id, `${initial.id}.json`);
  const metadata = JSON.parse(await readFile(file, 'utf8'));
  delete metadata.title; delete metadata.source; delete metadata.sequence;
  await writeFile(file, JSON.stringify(metadata));
  editor = await patchEditorLibrary(context, editor.id, { title: 'Later title', expectedRevision: editor.revision, expectedLibraryRevision: editor.libraryRevision });
  assert.equal((await listHistory(context, editor.id)).total, 2);
  editor = await restoreHistory(context, editor.id, initial.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  assert.equal(editor.title, 'Cart');
});

test('library folders validate ancestry and create resources atomically in the selected kind', async (t) => {
  const { context, fixture, localPath } = await shop(t);
  const parent = await createFolder(context, { project: 'shop', kind: 'blueprint', title: 'Parent', parentId: null, expectedRevision: null });
  const child = await createFolder(context, { project: 'shop', kind: 'blueprint', title: 'Child', parentId: parent.folder.id, expectedRevision: parent.revision });
  const before = fixture.store.writes.length;
  await assert.rejects(() => patchFolder(context, parent.folder.id, { project: 'shop', parentId: child.folder.id, expectedRevision: child.revision }), { code: 'invalid_parent' });
  await assert.rejects(() => createText(context, { project: 'shop', path: 'docs/wrong.json', folderId: child.folder.id, document: release() }), { code: 'invalid_folder' });
  assert.equal(fixture.store.writes.length, before);
  await assert.rejects(() => readFile(path.join(localPath, 'docs/wrong.json')), { code: 'ENOENT' });
  const board = await createBoard(context, { project: 'shop', document: sketch('folder-board'), folderId: child.folder.id });
  assert.equal(board.folderId, child.folder.id);
  assert.equal((await listFolders(context, { project: 'shop', kind: 'blueprint' })).items.find((item) => item.id === parent.folder.id).count, 1);
  const oldBytes = await readFile(path.join(localPath, board.path));
  const renamed = await patchEditorLibrary(context, board.id, { title: 'Logical title', folderId: null, expectedRevision: board.revision, expectedLibraryRevision: board.libraryRevision });
  assert.equal(renamed.title, 'Logical title');
  assert.equal(renamed.id, board.id);
  assert.deepEqual(await readFile(path.join(localPath, board.path)), oldBytes);
  const moved = await moveEditor(context, board.id, { project: 'shop', folderId: child.folder.id, path: 'docs/ignored.json', confirmedRepositoryChange: false, ...managementRevisions(renamed) });
  assert.equal(moved.editor.path, board.path);
  await undoChange({ ...context, principal: { audience: 'desktop' } }, moved.changeId);
  assert.equal((await readEditor(context, board.id)).folderId, null);
});

test('library search filters AND over every folder and report one offline project', async (t) => {
  const { context, fixture } = await shop(t);
  await seedAttachedUnits(context, ['root:worker']);
  const folder = await createFolder(context, { project: 'shop', kind: 'void', title: 'Notes', parentId: null, expectedRevision: null });
  const text = await createText(context, { project: 'shop', path: 'docs/filter.json', folderId: folder.folder.id, document: release(), attached: ['root:worker'] });
  await createComment(context, text.id, { text: 'Search inside folded folders', expectedRevision: text.revision, expectedCommentsRevision: text.commentsRevision,
    anchor: { k: text.document.pages[0].k, lang: 'en', start: 0, end: 4, quote: plain(text.document.pages[0].en).slice(0, 4) } });
  context.projects.push({ name: 'offline' });
  const found = await list(context, { kind: 'void', q: 'folded folders', openComments: true, attachedAgents: true, changedThisWeek: true, folderId: folder.folder.id });
  assert.deepEqual(found.items.map((item) => item.id), [text.id]);
  assert.equal(found.issues[0].code, 'project_unavailable');
  fixture.clock.now += 7 * 86400000;
  assert.equal((await list(context, { changedThisWeek: true })).items.length, 0);
  await assert.rejects(() => list(context, { openComments: 'yes' }), { code: 'invalid_query' });
});

test('duplicate preserves real unknown content and starts fresh comments original and history', async (t) => {
  const { context, localPath } = await shop(t);
  const original = await createText(context, { project: 'shop', path: 'docs/source.json', document: release() });
  const duplicate = await duplicateEditor(context, original.id, { project: 'shop', folderId: null, title: 'Duplicate', path: 'docs/copy.json', expectedRevision: original.revision });
  assert.notEqual(duplicate.document.id, original.document.id);
  assert.deepEqual(duplicate.document.pages, original.document.pages);
  assert.equal(duplicate.document.note, 'keep');
  assert.deepEqual(duplicate.attached, []);
  assert.deepEqual(duplicate.threads, []);
  assert.deepEqual(await readFile(path.join(localPath, 'docs/copy.orig.json')), await readFile(path.join(localPath, 'docs/copy.json')));
  assert.equal((await readdir(path.join(localPath, 'docs/flows/history', duplicate.id))).length, 3);
});

test('cross repository move preserves comments binding history original and shared assets then Undo restores exact bytes', async (t) => {
  const { context, fixture, localPath } = await shop(t);
  const api = path.join(fixture.root, 'api');
  await mkdir(api, { recursive: true });
  context.projects.push({ name: 'api', localPath: api });
  await seedAttachedUnits(context, ['root:worker']);
  const document = release();
  const asset = `${randomUUID()}.png`;
  document.cover = `assets/${asset}`;
  await mkdir(path.join(localPath, 'docs/flows/assets'), { recursive: true });
  await writeFile(path.join(localPath, 'docs/flows/assets', asset), PNG);
  const original = await createText(context, { project: 'shop', path: 'docs/source.json', document, attached: ['root:worker'] });
  await createText(context, { project: 'shop', path: 'docs/shared.json', document: { ...release(), cover: document.cover } });
  await writeAttachments(context, original.id, { attached: ['root:worker'], expectedRevision: null });
  const commentsFile = path.join(localPath, 'docs/source.comments.json');
  const comments = { path: 'source.json', foreign: { value: ['kept'] }, threads: [{ id: 't1', anchor: { resourceId: original.id, k: 'A' }, messages: [{ author: 'old-agent', at: '2020-01-01T00:00:00.000Z', text: 'Historical author', foreign: 4 }] }] };
  await writeFile(commentsFile, JSON.stringify(comments));
  const current = await readEditor(context, original.id);
  const source = await readFile(path.join(localPath, current.path));
  const beforeWrites = fixture.store.writes.length;
  await assert.rejects(() => moveEditor(context, current.id, { project: 'api', path: 'docs/moved.json', folderId: null, confirmedRepositoryChange: false, ...managementRevisions(current) }), { code: 'confirmation_required' });
  await assert.rejects(() => moveEditor(context, current.id, { project: 'api', path: 'docs/moved.json', folderId: null, confirmedRepositoryChange: true, ...managementRevisions(current), expectedCommentsRevision: '0'.repeat(64) }), { code: 'revision_conflict' });
  assert.equal(fixture.store.writes.length, beforeWrites);
  const moved = await moveEditor(context, current.id, { project: 'api', path: 'docs/moved.json', folderId: null, confirmedRepositoryChange: true, ...managementRevisions(current) });
  assert.notEqual(moved.editor.id, current.id);
  await assert.rejects(() => readFile(path.join(localPath, current.path)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(api, 'docs/moved.json')), source);
  assert.deepEqual(await readFile(path.join(api, 'docs/moved.orig.json')), source);
  assert.deepEqual(await readFile(path.join(api, 'docs/flows/assets', asset)), PNG);
  assert.deepEqual(await readFile(path.join(localPath, 'docs/flows/assets', asset)), PNG);
  const movedComments = JSON.parse(await readFile(path.join(api, 'docs/moved.comments.json')));
  assert.deepEqual(movedComments.foreign, comments.foreign);
  assert.equal(movedComments.threads[0].messages[0].author, 'old-agent');
  assert.equal(movedComments.threads[0].anchor.resourceId, moved.editor.id);
  assert.deepEqual((await readAttachments(context, moved.editor.id)).attached, ['root:worker']);
  assert.equal((await readdir(path.join(api, 'docs/flows/history', moved.editor.id))).length, 3);
  await undoChange({ ...context, principal: { audience: 'desktop' } }, moved.changeId);
  assert.deepEqual(await readFile(path.join(localPath, current.path)), source);
  assert.deepEqual(JSON.parse(await readFile(commentsFile)), comments);
  await assert.rejects(() => readFile(path.join(api, 'docs/moved.json')), { code: 'ENOENT' });
});

test('folder deletion removes complete nested bundles gives one notice per attached agent and supports conflict and expiry', async (t) => {
  const { context, fixture, localPath } = await shop(t);
  await seedAttachedUnits(context, ['root:worker']);
  const folder = await createFolder(context, { project: 'shop', kind: 'void', title: 'Texts', parentId: null, expectedRevision: null });
  const text = await createText(context, { project: 'shop', path: 'docs/deleted.json', folderId: folder.folder.id, document: release(), attached: ['root:worker'] });
  const removed = await removeFolder(context, folder.folder.id, { project: 'shop', confirmed: true, expectedRevision: text.libraryRevision });
  assert.deepEqual(removed.removedResourceIds, [text.id]);
  for (const suffix of ['.json', '.orig.json', '.comments.json']) await assert.rejects(() => readFile(path.join(localPath, `docs/deleted${suffix}`)), { code: 'ENOENT' });
  assert.equal(fixture.store.events.filter((event) => event.name === 'notification.changed' && event.resourceId === text.id).length, 1);
  await writeFile(path.join(localPath, 'docs/deleted.json'), 'foreign file');
  await assert.rejects(() => undoChange({ ...context, principal: { audience: 'desktop' } }, removed.changeId), { code: 'undo_conflict' });
  assert.equal(await readFile(path.join(localPath, 'docs/deleted.json'), 'utf8'), 'foreign file');
  fixture.clock.now += 10000;
  await assert.rejects(() => undoChange({ ...context, principal: { audience: 'desktop' } }, removed.changeId), { code: 'undo_expired' });
});

test('deletion interruption at every journal phase recovers a true tombstone and its durable Undo copy', async (t) => {
  for (const fault of [{ afterPrepared: true }, { afterRenames: 1 }, { afterRenames: 4 }, { beforeReceipt: true }, { afterStage: true }, { afterReceipt: true }]) {
    await t.test(JSON.stringify(fault), async (sub) => {
      const { context, fixture, localPath } = await shop(sub);
      const text = await createText(context, { project: 'shop', path: 'docs/crash.json', document: release() });
      fixture.store.fault = fault;
      await assert.rejects(() => removeEditor(context, text.id, { confirmed: true, ...managementRevisions(text) }), { code: 'injected_crash' });
      const restarted = createStore({ root: fixture.root, confineRoot: fixture.root, mindPath: fixture.paths.mind,
        localDirectory: fixture.paths.localDirectory, projects: context.projects, now: context.now });
      await recoverTransactions(restarted);
      await assert.rejects(() => readFile(path.join(localPath, text.path)), { code: 'ENOENT' });
      const undoNames = await readdir(path.join(fixture.paths.localDirectory, 'change-undo'));
      const undone = await undoChange({ ...context, store: restarted, principal: { audience: 'desktop' } }, undoNames[0].slice(0, -5));
      assert.deepEqual(undone.resourceIds, [text.id]);
      assert.equal(JSON.parse(await readFile(path.join(localPath, text.path))).title, text.title);
    });
  }
});

test('board moves recover each journal phase and preserve index history comments and owned assets', async (t) => {
  for (const fault of [{ afterPrepared: true }, { afterRenames: 1 }, { afterRenames: 5 }, { beforeReceipt: true }, { afterStage: true }, { afterReceipt: true }]) {
    await t.test(JSON.stringify(fault), async (sub) => {
      const { context, fixture, localPath } = await shop(sub);
      const api = path.join(fixture.root, 'api');
      await mkdir(api, { recursive: true });
      context.projects.push({ name: 'api', localPath: api });
      const document = sketch('move-crash');
      document.foreign = { nested: ['preserved'] };
      const board = await createBoard(context, { project: 'shop', document });
      const asset = await createAsset({ ...context, converter: null }, board.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') });
      const current = await readEditor(context, board.id);
      const original = await readFile(path.join(localPath, board.path));
      fixture.store.fault = fault;
      await assert.rejects(() => moveEditor(context, board.id, { project: 'api', path: 'docs/flows/boards/moved.json', folderId: null,
        confirmedRepositoryChange: true, ...managementRevisions(current) }), { code: 'injected_crash' });
      const restarted = createStore({ root: fixture.root, confineRoot: fixture.root, mindPath: fixture.paths.mind,
        localDirectory: fixture.paths.localDirectory, projects: context.projects, now: context.now });
      await recoverTransactions(restarted);
      await assert.rejects(() => readFile(path.join(localPath, board.path)), { code: 'ENOENT' });
      assert.deepEqual(await readFile(path.join(api, 'docs/flows/boards/moved.json')), original);
      assert.equal(JSON.parse(await readFile(path.join(api, 'docs/flows/boards/index.json')))[0].id, document.id);
      assert.deepEqual(JSON.parse(await readFile(path.join(localPath, 'docs/flows/boards/index.json'))), []);
      assert.deepEqual(await readFile(path.join(api, 'docs/flows/assets', asset.id)), PNG);
      await assert.rejects(() => readFile(path.join(localPath, 'docs/flows/assets', asset.id)), { code: 'ENOENT' });
      const undoNames = await readdir(path.join(fixture.paths.localDirectory, 'change-undo'));
      await undoChange({ ...context, store: restarted, principal: { audience: 'desktop' } }, undoNames[0].slice(0, -5));
      assert.deepEqual(await readFile(path.join(localPath, board.path)), original);
      assert.deepEqual(await readFile(path.join(localPath, 'docs/flows/assets', asset.id)), PNG);
    });
  }
});

test('a stale bundle entry rejects every write and destination collisions and removed attachments block moves', async (t) => {
  const { context, fixture, localPath } = await shop(t);
  const api = path.join(fixture.root, 'api');
  await mkdir(path.join(api, 'docs'), { recursive: true });
  context.projects.push({ name: 'api', localPath: api });
  await seedAttachedUnits(context, ['root:worker']);
  const text = await createText(context, { project: 'shop', path: 'docs/stale.json', document: release(), attached: ['root:worker'] });
  const original = await readFile(path.join(localPath, text.path));
  const before = fixture.store.writes.length;
  await assert.rejects(() => commitTransaction(fixture.store, { id: randomUUID(), entries: [
    { resource: 'project:shop:docs/stale.json', target: { kind: 'project', project: 'shop', path: text.path }, operation: 'delete', beforeRevision: text.revision },
    { resource: 'stale-library', target: { kind: 'project', project: 'shop', path: 'docs/flows/library.json' }, beforeRevision: '0'.repeat(64), afterBytes: Buffer.from('{}') },
  ] }), { code: 'revision_conflict' });
  assert.equal(fixture.store.writes.length, before);
  assert.deepEqual(await readFile(path.join(localPath, text.path)), original);
  await writeFile(path.join(api, 'docs/moved.json'), 'Collision');
  await assert.rejects(() => moveEditor(context, text.id, { project: 'api', path: 'docs/moved.json', folderId: null, confirmedRepositoryChange: true, ...managementRevisions(text) }), { code: 'resource_exists' });
  await writeFile(path.join(context.paths.mind, 'user/state/worker.md'), 'unit: worker\nunit-id: root:worker\nremoved: true\n\n');
  await assert.rejects(() => moveEditor(context, text.id, { project: 'api', path: 'docs/free.json', folderId: null, confirmedRepositoryChange: true, ...managementRevisions(text) }), { code: 'unknown_unit' });
  assert.deepEqual(await readFile(path.join(localPath, text.path)), original);
});

test('unknown fields survive a full save and a dropped field is refused', async (t) => {
  const { context } = await shop(t);
  const document = sketch();
  document.script = 'keep';
  document.screens[0].root.kids.push(rectangleNode(document, { x: 8, y: 8, w: 40, h: 20 }, { stroke: '#111111', fill: 'none' }));
  document.screens[0].root.kids[0].note = 'box note';
  const created = await createBoard(context, { project: 'shop', document });
  assert.equal(created.document.script, 'keep');
  assert.equal(created.document.screens[0].root.kids[0].note, 'box note');
  const dropped = structuredClone(created.document);
  delete dropped.script;
  await assert.rejects(() => replaceBoard(context, created.id, { document: dropped, expectedRevision: created.revision }), { status: 409, code: 'unsupported_fields_lost' });
  const saved = await replaceBoard(context, created.id, { document: created.document, expectedRevision: created.revision });
  assert.equal(saved.document.script, 'keep');
  assert.equal(preserveUnknown(created.document, saved.document), true);
});

test('duplicate ids, a bad link, a bad root and a bad order are refused', async () => {
  const duplicate = sketch();
  const box = rectangleNode(duplicate, { x: 1, y: 1, w: 10, h: 10 }, { stroke: '#111111', fill: 'none' });
  duplicate.screens[0].root.kids.push(box, { ...box });
  await assert.rejects(async () => validateBoard(duplicate), { status: 422, code: 'invalid_document' });
  const linked = sketch();
  linked.links.push({ id: 'l-bad', from: linked.screens[0].id, to: 'other-screen', transition: 'spin' });
  await assert.rejects(async () => validateBoard(linked), { status: 422, code: 'invalid_document' });
  const root = sketch();
  root.screens[0].root.t = 'vector';
  await assert.rejects(async () => validateBoard(root), { status: 422, code: 'invalid_document' });
  const order = sketch();
  order.pages[0].order = ['missing'];
  await assert.rejects(async () => validateBoard(order), { status: 422, code: 'invalid_document' });
});

test('a module stays read-only and a board id cannot be registered twice', async (t) => {
  const { context, localPath } = await shop(t);
  const modulePath = path.join(localPath, 'docs', 'flows', 'boards', 'legacy.mjs');
  await mkdir(path.dirname(modulePath), { recursive: true });
  await writeFile(modulePath, 'export const board = {}\n');
  const registered = await registerResource(context, { project: 'shop', path: 'docs/flows/boards/legacy.mjs', kind: 'blueprint' });
  assert.equal(registered.readOnly, true);
  assert.equal(registered.document, null);
  await assert.rejects(() => replaceBoard(context, registered.id, { document: sketch('legacy'), expectedRevision: registered.revision }), { status: 409, code: 'read_only_resource' });
  const created = await createBoard(context, { project: 'shop', document: sketch('cart') });
  await assert.rejects(() => createBoard(context, { project: 'shop', path: 'docs/flows/boards/other.json', document: sketch('cart') }), { status: 409, code: 'board_id_exists' });
  await assert.rejects(() => createBoard(context, { project: 'shop', path: created.path, document: sketch('other') }), { status: 409, code: 'resource_exists' });
  const sidecar = path.join(localPath, 'docs', 'notes.orig.json');
  await writeFile(sidecar, '{}\n');
  const found = await discoverResources(context, 'shop');
  assert.equal(found.some((item) => item.legacyId === 'legacy' && item.readOnly === true), true);
  assert.equal(found.some((item) => item.path.endsWith('.orig.json')), false);
  const again = await registerResource(context, { project: 'shop', path: 'docs/flows/boards/legacy.mjs', kind: 'blueprint' });
  assert.equal(again.httpStatus, 200);
  assert.equal(again.id, registered.id);
  const notes = path.join(localPath, 'docs', 'notes.json');
  await writeFile(notes, `${JSON.stringify({ title: 'Notes', rev: 0, pages: [{ k: 'A', en: 'Hi' }] })}\n`);
  const voided = await registerResource(context, { project: 'shop', path: 'docs/notes.json', kind: 'void' });
  assert.equal(voided.kind, 'void');
  assert.equal(voided.httpStatus, 201);
  const repeated = await registerResource(context, { project: 'shop', path: 'docs/notes.json', kind: 'void' });
  assert.equal(repeated.httpStatus, 200);
  assert.equal(repeated.id, voided.id);
  await assert.rejects(() => writeAttachments(context, created.id, { attached: ['root:builder', 'root:builder'], expectedRevision: null }), { code: 'invalid_body' });
  await assert.rejects(() => writeAttachments(context, created.id, { attached: ['not a unit'], expectedRevision: null }), { code: 'invalid_unit' });
  await assert.rejects(() => writeAttachments(context, created.id, { attached: ['root:builder'], expectedRevision: null }), { code: 'unknown_unit' });
});

test('a project that already holds boards lists them without a manual registration', async (t) => {
  const { context, localPath } = await shop(t);
  const boards = path.join(localPath, 'docs', 'flows', 'boards');
  await mkdir(boards, { recursive: true });
  await writeFile(path.join(boards, 'app.mjs'), 'export const board = {}\n');
  await writeFile(path.join(boards, 'broken.json'), '{ not json');
  await writeFile(path.join(boards, 'index.json'), '[]\n');
  const first = await list(context, { kind: 'blueprint' });
  assert.deepEqual(first.items.map((item) => item.path), ['docs/flows/boards/app.mjs']);
  assert.equal(first.items[0].readOnly, true);
  assert.deepEqual(first.issues, []);
  // The register is written once: a second read lists the same board and writes nothing more.
  const writes = context.store.writes?.length ?? 0;
  const second = await list(context, { kind: 'blueprint' });
  assert.deepEqual(second.items.map((item) => item.id), first.items.map((item) => item.id));
  assert.equal(context.store.writes?.length ?? 0, writes);
  const folders = await listFolders(context, { kind: 'blueprint' });
  assert.equal(folders.issues.length, 0);
});

test('an absent project is unavailable', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  await assert.rejects(() => createBoard({ store: fixture.store, projects: [] }, { project: 'shop', document: sketch() }), { status: 409, code: 'project_unavailable' });
});

test('attachments can be replaced and a removed node comment stays readable', async (t) => {
  const { context, localPath } = await shop(t);
  await seedAttachedUnits(context, ['root:builder']);
  const document = sketch();
  const box = rectangleNode(document, { x: 4, y: 4, w: 30, h: 20 }, { stroke: '#111111', fill: 'none' });
  document.screens[0].root.kids.push(box);
  const created = await createBoard(context, { project: 'shop', document, attached: ['root:builder'] });
  const attachments = await readAttachments(context, created.id);
  assert.deepEqual(attachments.attached, ['root:builder']);
  const detached = await writeAttachments(context, created.id, { attached: [], expectedRevision: attachments.revision });
  assert.deepEqual(detached.attached, []);
  const commentsPath = path.join(localPath, 'docs', 'flows', 'comments', 'cart.json');
  await writeFile(commentsPath, `${JSON.stringify({ board: 'cart', threads: [{ id: 'thread-1', nodeId: box.id, text: 'still here' }] })}\n`);
  const removed = await removeNode(context, created.id, box.id, { expectedRevision: created.revision });
  assert.equal(removed.document.screens[0].root.kids.some((kid) => kid.id === box.id), false);
  const comments = await readComments(context, created.id);
  assert.equal(comments.threads[0].text, 'still here');
  assert.equal(comments.threads[0].nodeId, box.id);
});

test('a stale revision conflicts and assets reject traversal, markup and oversized files', async (t) => {
  const { context, localPath, fixture } = await shop(t);
  const created = await createBoard(context, { project: 'shop', document: sketch() });
  const next = structuredClone(created.document);
  next.title = 'Cart two';
  const saved = await replaceBoard(context, created.id, { document: next, expectedRevision: created.revision });
  await assert.rejects(() => replaceBoard(context, created.id, { document: created.document, expectedRevision: created.revision }), { status: 409, code: 'revision_conflict' });
  const added = await addNode(context, created.id, {
    screenId: saved.document.screens[0].id,
    parentId: saved.document.screens[0].root.id,
    node: rectangleNode(saved.document, { x: 2, y: 2, w: 12, h: 12 }, { stroke: '#111111', fill: 'none' }),
    expectedRevision: saved.revision,
  });
  const renamed = await updateNode(context, created.id, added.nodeId, { changes: { name: 'Tile' }, expectedRevision: added.editor.revision });
  assert.equal(renamed.document.screens[0].root.kids[0].name, 'Tile');
  await assert.rejects(() => updateNode(context, created.id, added.nodeId, { changes: { t: 'vector' }, expectedRevision: renamed.revision }), { status: 422, code: 'invalid_node' });
  context.converter = null;
  const asset = await createAsset(context, created.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') });
  assert.match(asset.src, /^assets\/[0-9a-f-]{36}\.png$/);
  assert.equal(asset.contentType, 'image/png');
  assert.equal(asset.bytes, PNG.length);
  const registered = await readAsset(context, created.id, asset.id);
  assert.equal(registered.revision, asset.revision);
  assert.equal(registered.type, 'image/png');
  const referenced = structuredClone(renamed.document);
  referenced.note = asset.src;
  const stored = await replaceBoard(context, created.id, { document: referenced, expectedRevision: renamed.revision });
  const read = await readAsset(context, created.id, asset.src.slice('assets/'.length));
  assert.equal(read.bytes[0], 0x89);
  assert.equal(stored.revision.length > 0, true);
  const stray = `${randomUUID()}.png`;
  await writeFile(path.join(localPath, 'docs', 'flows', 'assets', stray), PNG);
  await assert.rejects(() => readAsset(context, created.id, stray), { status: 404, code: 'not_found' });
  const outside = path.join(fixture.root, 'outside-asset');
  await mkdir(outside, { recursive: true });
  const linked = `${randomUUID()}.png`;
  await symlink(outside, path.join(localPath, 'docs', 'flows', 'assets', linked), 'junction');
  const linkedDocument = structuredClone(referenced);
  linkedDocument.note = `assets/${linked}`;
  const linkedBoard = await replaceBoard(context, created.id, { document: linkedDocument, expectedRevision: stored.revision });
  assert.equal(linkedBoard.revision.length > 0, true);
  await assert.rejects(() => readAsset(context, created.id, linked), (error) => error.code === 'unsafe_path');
  await assert.rejects(() => readAsset(context, created.id, '../secret.png'), { status: 404, code: 'not_found' });
  const broken = Buffer.from(PNG);
  broken[4] = 0x00;
  await assert.rejects(() => createAsset(context, created.id, { contentType: 'image/png', bytesBase64: broken.toString('base64') }), { status: 422, code: 'invalid_asset' });
  await writeFile(path.join(localPath, 'docs', 'flows', 'assets', asset.id), broken);
  await assert.rejects(() => readAsset(context, created.id, asset.id), { status: 422, code: 'invalid_asset' });
  const bare = pngWithoutImage();
  assert.equal(bare.length, 45);
  await assert.rejects(() => createAsset(context, created.id, { contentType: 'image/png', bytesBase64: bare.toString('base64') }), { status: 422, code: 'invalid_asset' });
  await writeFile(path.join(localPath, 'docs', 'flows', 'assets', asset.id), bare);
  await assert.rejects(() => readAsset(context, created.id, asset.id), { status: 422, code: 'invalid_asset' });
  await writeFile(path.join(localPath, 'docs', 'flows', 'assets', asset.id), PNG);
  await assert.rejects(() => createAsset(context, created.id, { contentType: 'image/png', bytesBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64') }), { status: 422, code: 'invalid_asset' });
  await assert.rejects(() => createAsset(context, created.id, { contentType: 'image/png', bytesBase64: Buffer.alloc(10000001, 1).toString('base64') }), { status: 413, code: 'asset_too_large' });
  const seen = [];
  context.bus = { emit(event) { seen.push(event); } };
  const screenId = linkedBoard.document.screens[0].id;
  const parentId = linkedBoard.document.screens[0].root.id;
  const elsewhere = addScreen(structuredClone(linkedBoard.document), { title: 'Other', x: 400, y: 0 });
  const tile = rectangleNode(linkedBoard.document, { x: 2, y: 2, w: 12, h: 12 }, { stroke: '#111111', fill: 'none' });
  tile.mark = { keep: true, note: 'stay' };
  await assert.rejects(() => addNode(context, created.id, {
    screenId: elsewhere.id,
    parentId,
    node: tile,
    expectedRevision: linkedBoard.revision,
  }), { status: 422, code: 'invalid_parent' });
  const placed = await addNode(context, created.id, { screenId, parentId, node: tile, expectedRevision: linkedBoard.revision });
  assert.equal(seen.at(-2).data.operation, 'add-node');
  assert.equal(seen.at(-2).data.nodeId, placed.nodeId);
  assert.equal(seen.at(-1).data.focus.screenId, screenId);
  assert.equal(seen.at(-1).data.focus.nodeId, placed.nodeId);
  await assert.rejects(() => updateNode(context, created.id, placed.nodeId, { changes: { kids: [] }, expectedRevision: placed.editor.revision }), { status: 422, code: 'invalid_node' });
  const merged = await updateNode(context, created.id, placed.nodeId, { changes: { mark: { note: 'next' } }, expectedRevision: placed.editor.revision });
  const kept = merged.document.screens[0].root.kids.find((item) => item.id === placed.nodeId);
  assert.equal(kept.mark.keep, true);
  assert.equal(kept.mark.note, 'next');
  const joined = structuredClone(merged.document);
  const second = addScreen(joined, { title: 'Other', x: 400, y: 0 });
  joined.links.push({ id: 'to-other', from: joined.screens[0].id, to: second.id, element: placed.nodeId, transition: 'cut' });
  const withLink = await replaceBoard(context, created.id, { document: joined, expectedRevision: merged.revision });
  const indexPath = path.join(localPath, 'docs', 'flows', 'boards', 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  index.find((item) => item.id === 'cart').badge = 'kept';
  await writeFile(indexPath, `${JSON.stringify(index)}\n`);
  const titled = structuredClone(withLink.document);
  titled.title = 'Cart renamed';
  const renamedTitle = await replaceBoard(context, created.id, { document: titled, expectedRevision: withLink.revision });
  const savedIndex = JSON.parse(await readFile(indexPath, 'utf8'));
  const row = savedIndex.find((item) => item.id === 'cart');
  assert.equal(row.badge, 'kept');
  assert.equal(row.title, 'Cart renamed');
  const dropped = await removeNode(context, created.id, placed.nodeId, { expectedRevision: renamedTitle.revision });
  assert.equal(dropped.document.links.some((link) => link.element === placed.nodeId), false);
  assert.equal(seen.some((event) => event.name === 'blueprint.changed' && event.data.operation === 'remove-node' && event.data.nodeId === placed.nodeId), true);
});

test('a present converter stores WebP and a missing converter keeps the original', async (t) => {
  const { context } = await shop(t);
  const created = await createBoard(context, { project: 'shop', document: sketch('bag') });
  const webp = framedWebp();
  let calls = 0;
  const converted = await createAsset({
    ...context,
    converter: 'ffmpeg',
    spawn(command, args) {
      calls += 1;
      writeFileSync(args.at(-1), webp);
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  }, created.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') });
  assert.equal(calls, 1);
  assert.match(converted.src, /\.webp$/);
  assert.equal(converted.contentType, 'image/webp');
  const kept = await createAsset({ ...context, converter: null, spawn() { throw new Error('converter'); } }, created.id, {
    contentType: 'image/png',
    bytesBase64: PNG.toString('base64'),
  });
  assert.match(kept.src, /\.png$/);
  const historical = await createAsset({
    ...context,
    converter: 'ffmpeg',
    spawn() { throw new Error('converter'); },
  }, created.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64'), immutable: true });
  assert.match(historical.src, /\.png$/);
  await assert.rejects(() => createAsset({
    ...context,
    converter: 'ffmpeg',
    spawn() {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit('close', 1));
      return child;
    },
  }, created.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') }), { status: 422, code: 'invalid_asset' });
  await assert.rejects(() => createAsset({
    ...context,
    converter: 'ffmpeg',
    spawn(command, args) {
      writeFileSync(args.at(-1), headerOnlyWebp());
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  }, created.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') }), { status: 422, code: 'invalid_asset' });
});

test('a header-only WebP is rejected on upload, immutable skip, and authenticated read', async (t) => {
  const { context, localPath } = await shop(t);
  const created = await createBoard(context, { project: 'shop', document: sketch('webp') });
  const header = headerOnlyWebp();
  await assert.rejects(() => createAsset({ ...context, converter: null }, created.id, {
    contentType: 'image/webp',
    bytesBase64: header.toString('base64'),
  }), { status: 422, code: 'invalid_asset' });
  await assert.rejects(() => createAsset({ ...context, converter: 'ffmpeg', spawn() { throw new Error('converter'); } }, created.id, {
    contentType: 'image/webp',
    bytesBase64: header.toString('base64'),
    immutable: true,
  }), { status: 422, code: 'invalid_asset' });
  await assert.rejects(() => createAsset({ ...context, converter: null }, created.id, {
    contentType: 'image/webp',
    bytesBase64: header.toString('base64'),
    historical: true,
  }), { status: 422, code: 'invalid_asset' });
  const stored = await createAsset({ ...context, converter: null }, created.id, {
    contentType: 'image/webp',
    bytesBase64: framedWebp().toString('base64'),
  });
  assert.match(stored.src, /\.webp$/);
  assert.equal(stored.contentType, 'image/webp');
  const read = await readAsset(context, created.id, stored.id);
  assert.equal(read.type, 'image/webp');
  await writeFile(path.join(localPath, 'docs', 'flows', 'assets', stored.id), header);
  await assert.rejects(() => readAsset(context, created.id, stored.id), { status: 422, code: 'invalid_asset' });
  const jpeg = Buffer.from('/9j//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAE0AAQEAAAAAAAAAAAAAAAAAAAAGAQEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAABAAEDARIAAhIAAxIA/9oADAMBAAIRAxEAPwCLEmN/H//Z', 'base64');
  const photo = await createAsset({ ...context, converter: null }, created.id, {
    contentType: 'image/jpeg',
    bytesBase64: jpeg.toString('base64'),
    immutable: true,
  });
  assert.match(photo.src, /\.jpg$/);
  await assert.rejects(() => createAsset({ ...context, converter: null }, created.id, {
    contentType: 'image/jpeg',
    bytesBase64: jpeg.subarray(0, jpeg.length - 2).toString('base64'),
    immutable: true,
  }), { status: 422, code: 'invalid_asset' });
});

test('a project asset quota is reserved before conversion and released on failure', async (t) => {
  const { context } = await shop(t);
  const created = await createBoard(context, { project: 'shop', document: sketch('quota') });
  await assert.rejects(() => createAsset({ ...context, converter: null, assetByteLimit: PNG.length - 1 }, created.id, {
    contentType: 'image/png',
    bytesBase64: PNG.toString('base64'),
  }), { status: 413, code: 'asset_quota' });
  const failing = {
    ...context,
    converter: 'ffmpeg',
    assetCountLimit: 1,
    spawn() {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit('close', 1));
      return child;
    },
  };
  await assert.rejects(() => createAsset(failing, created.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') }), { status: 422, code: 'invalid_asset' });
  const released = await createAsset({ ...context, converter: null, assetCountLimit: 1 }, created.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') });
  assert.equal(released.bytes, PNG.length);
  await assert.rejects(() => createAsset({ ...context, converter: null, assetCountLimit: 1 }, created.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') }), { status: 413, code: 'asset_quota' });
});

test('the board routes keep an unknown field through HTTP', async (t) => {
  const fixture = await makeCoreFixture();
  const localPath = path.join(fixture.paths.localDirectory, 'shop');
  await mkdir(localPath, { recursive: true });
  const core = await composeCore({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    projects: [{ name: 'shop', localPath }],
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  const token = local.json.data.token;
  const document = sketch();
  document.script = 'from http';
  const created = await call(core.http.port, 'POST', '/api/v1/blueprint/boards', {
    token,
    body: { project: 'shop', document },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.document.script, 'from http');
  const read = await call(core.http.port, 'GET', `/api/v1/blueprint/boards/${created.json.data.id}`, { token });
  assert.equal(read.status, 200);
  assert.equal(read.json.data.document.script, 'from http');
  const unauthenticated = await call(core.http.port, 'POST', `/api/v1/editors/${created.json.data.id}/assets`, {
    body: { contentType: 'image/png', bytesBase64: 'qq' },
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(unauthenticated.status, 401);
  const missing = await call(core.http.port, 'POST', `/api/v1/editors/${randomUUID()}/assets`, {
    token,
    body: { contentType: 'image/png', bytesBase64: 'qq' },
    headers: { 'content-type': 'text/plain', 'idempotency-key': randomUUID() },
  });
  assert.equal(missing.status, 404);
  const uploaded = await call(core.http.port, 'POST', `/api/v1/editors/${created.json.data.id}/assets`, {
    token,
    body: { contentType: 'image/png', bytesBase64: PNG.toString('base64') },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.json.data.contentType === 'image/png' || uploaded.json.data.contentType === 'image/webp', true);
  const fetched = await call(core.http.port, 'GET', uploaded.json.data.url, { token });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.etag, `"${uploaded.json.data.revision}"`);
  assert.equal(fetched.headers['cache-control'], 'no-store');
  assert.equal(fetched.headers['content-type'], uploaded.json.data.contentType);
  const bulky = await call(core.http.port, 'POST', `/api/v1/editors/${created.json.data.id}/assets`, {
    token,
    body: { contentType: 'image/png', bytesBase64: 'A'.repeat(3_000_000) },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(bulky.status, 422);
  assert.equal(bulky.json.error.code, 'invalid_asset');
  const agent = core.credentials.issue({ audience: 'agent', unitId: 'root:builder', capabilities: ['editor.write'], attached: false, expiresAt: '2027-01-01T00:00:00.000Z' });
  const denied = await call(core.http.port, 'PUT', `/api/v1/blueprint/boards/${created.json.data.id}`, {
    token: agent.token,
    body: { document, expectedRevision: created.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(denied.status, 403);
  const editor = await readEditor({ store: fixture.store, paths: fixture.paths, projects: [{ name: 'shop', localPath }] }, created.json.data.id);
  assert.equal(editor.document.script, 'from http');
});

function release() {
  return {
    title: 'Release notes',
    rev: 0,
    note: 'keep',
    pages: [{ k: 'Intro.Welcome', en: '<b>Welcome</b>\nA first paragraph.', es: '<b>Bienvenida</b>\nUn primer párrafo.' }],
  };
}

test('a Void document keeps orig, one history step and unknown fields', async (t) => {
  const { context, localPath } = await shop(t);
  await seedAttachedUnits(context, ['project:shop:executor']);
  const created = await createText(context, { project: 'shop', path: 'docs/release.json', document: release(), attached: ['project:shop:executor'] });
  assert.equal(created.document.note, 'keep');
  const orig = await readFile(path.join(localPath, 'docs', 'release.orig.json'), 'utf8');
  const current = await readFile(path.join(localPath, 'docs', 'release.json'), 'utf8');
  assert.equal(orig, current);
  const next = structuredClone(created.document);
  next.pages[0].es = '<b>Bienvenida</b>\nUn segundo párrafo.';
  const saved = await replaceText(context, created.id, { document: next, expectedRevision: created.revision });
  assert.equal(saved.document.rev, 1);
  assert.equal(saved.document.pages[0].en, created.document.pages[0].en);
  assert.equal(await readFile(path.join(localPath, 'docs', 'release.orig.json'), 'utf8'), orig);
  const history = (await readFile(path.join(localPath, 'docs', 'release.versions.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(history.length, 1);
  assert.equal(JSON.parse(history[0]).lang, 'es');
  assert.equal(JSON.parse(history[0]).by, undefined);
  const titled = structuredClone(saved.document);
  titled.title = 'Release notes revised';
  titled.pages[0].margin = { keep: true };
  const renamed = await replaceText(context, created.id, { document: titled, expectedRevision: saved.revision });
  assert.equal(renamed.document.title, 'Release notes revised');
  assert.equal(renamed.document.rev, 1);
  assert.equal(renamed.document.pages[0].margin.keep, true);
  assert.equal((await readFile(path.join(localPath, 'docs', 'release.versions.jsonl'), 'utf8')).trim().split('\n').length, 1);
  const droppedPage = structuredClone(renamed.document);
  delete droppedPage.pages[0].margin;
  await assert.rejects(() => replaceText(context, created.id, { document: droppedPage, expectedRevision: renamed.revision }), { status: 409, code: 'unsupported_fields_lost' });
  const numeric = structuredClone(renamed.document);
  numeric.pages[0].en = 1;
  await assert.rejects(() => replaceText(context, created.id, { document: numeric, expectedRevision: renamed.revision }), { status: 422, code: 'invalid_document' });
  const many = structuredClone(renamed.document);
  many.pages = Array.from({ length: 2001 }, (_, index) => ({ k: `p-${index}`, en: 'x' }));
  await assert.rejects(async () => validateText(many), { status: 422, code: 'invalid_document' });
  const quiet = await observeExternal(context, created.id);
  assert.equal(quiet.changed, false);
  assert.equal((await readFile(path.join(localPath, 'docs', 'release.versions.jsonl'), 'utf8')).trim().split('\n').length, 1);
});

test('Markdown ranges and anchors reject split syntax and characters without writing', async (t) => {
  const { context, fixture } = await shop(t);
  const source = '# Title\r\n\r\n<b>A😀</b> **passage**\r\n';
  const document = { ...release(), future: { keep: true }, pages: [{ k: 'One', en: source, es: '_Texto_', future: 7 }] };
  const created = await createText(context, { project: 'shop', path: 'docs/markdown.json', document });
  const commentsRevision = (await readComments(context, created.id)).commentsRevision;
  const before = fixture.store.writes.length, rendered = plain(source), start = rendered.indexOf('😀');
  const comment = { text: 'Keep this character', sendToAgent: false, expectedRevision: created.revision, expectedCommentsRevision: commentsRevision };
  await assert.rejects(() => createComment(context, created.id, { ...comment, anchor: { k: 'One', lang: 'en', start: start + 1, end: start + 2, quote: rendered.slice(start + 1, start + 2) } }), { status: 422, code: 'invalid_range' });
  const syntax = source.indexOf('**') + 1;
  await assert.rejects(() => replaceRange(context, created.id, { k: 'One', lang: 'en', start: syntax, end: syntax + 1, expectedText: '*', replacement: '', expectedRevision: created.revision }), { status: 422, code: 'invalid_range' });
  assert.equal(fixture.store.writes.length, before);
  const noted = await createComment(context, created.id, { ...comment, anchor: { k: 'One', lang: 'en', start, end: start + 2, quote: '😀' } });
  assert.equal(source.slice(noted.thread.place.sourceStart, noted.thread.place.sourceEnd), '😀');
  const changed = structuredClone(created.document);
  changed.pages[0].en = `Before\r\n${source}`;
  const saved = await replaceText(context, created.id, { document: changed, expectedRevision: created.revision });
  assert.equal(saved.document.pages[0].es, '_Texto_');
  assert.deepEqual(saved.document.future, { keep: true });
  assert.equal(saved.document.pages[0].future, 7);
});

test('ranges reject split characters and tags, and a proposal accepts once', async (t) => {
  const { context } = await shop(t);
  const created = await createText(context, { project: 'shop', path: 'docs/release.json', document: release() });
  const source = created.document.pages[0].en;
  await assert.rejects(() => replaceRange(context, created.id, { k: 'Intro.Welcome', lang: 'en', start: 1, end: 2, expectedText: source.slice(1, 2), replacement: 'x', expectedRevision: created.revision }), { status: 422, code: 'invalid_range' });
  const emoji = structuredClone(created.document);
  emoji.pages[0].en = 'A\u{1F600}B';
  const withEmoji = await replaceText(context, created.id, { document: emoji, expectedRevision: created.revision });
  await assert.rejects(() => replaceRange(context, created.id, { k: 'Intro.Welcome', lang: 'en', start: 2, end: 3, expectedText: withEmoji.document.pages[0].en.slice(2, 3), replacement: '', expectedRevision: withEmoji.revision }), { status: 422, code: 'invalid_range' });
  const removed = await replaceRange(context, created.id, { k: 'Intro.Welcome', lang: 'en', start: 0, end: 1, expectedText: 'A', replacement: '', expectedRevision: withEmoji.revision });
  assert.equal(removed.editor.document.pages[0].en.startsWith('\u{1F600}'), true);
  const commented = await createComment(context, created.id, {
    text: 'Clarify',
    expectedRevision: removed.editor.revision,
    expectedCommentsRevision: (await readComments(context, created.id)).commentsRevision,
    anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 2, quote: plain(removed.editor.document.pages[0].en).slice(0, 2) },
  });
  const proposed = await replaceRange(context, created.id, {
    k: 'Intro.Welcome', lang: 'en', start: 0, end: 2, expectedText: removed.editor.document.pages[0].en.slice(0, 2), replacement: 'Hi',
    expectedRevision: removed.editor.revision, mode: 'propose', threadId: commented.thread.id, expectedCommentsRevision: commented.commentsRevision,
  });
  assert.equal(proposed.proposal.state, 'pending');
  await assert.rejects(() => answerProposal(context, created.id, proposed.proposal.id, { decision: 'approve', expectedRevision: removed.editor.revision, expectedCommentsRevision: proposed.proposal.commentsRevision }), { status: 422, code: 'invalid_body' });
  assert.equal((await readEditor(context, created.id)).document.pages[0].en, removed.editor.document.pages[0].en);
  const accepted = await answerProposal(context, created.id, proposed.proposal.id, { decision: 'accept', expectedRevision: removed.editor.revision, expectedCommentsRevision: proposed.proposal.commentsRevision });
  assert.equal(accepted.proposal.state, 'accepted');
  assert.equal(accepted.editor.document.pages[0].en.startsWith('Hi'), true);
  await assert.rejects(() => answerProposal(context, created.id, proposed.proposal.id, { decision: 'accept', expectedRevision: accepted.editor.revision, expectedCommentsRevision: accepted.proposal.commentsRevision }), { status: 409, code: 'proposal_resolved' });
  const again = await createComment(context, created.id, {
    text: 'Another',
    expectedRevision: accepted.editor.revision,
    expectedCommentsRevision: accepted.proposal.commentsRevision,
    anchor: { k: 'Intro.Welcome', lang: 'es', start: 0, end: 10, quote: plain(accepted.editor.document.pages[0].es).slice(0, 10) },
  });
  const stale = await replaceRange(context, created.id, {
    k: 'Intro.Welcome', lang: 'es', start: 0, end: 11, expectedText: accepted.editor.document.pages[0].es.slice(0, 11), replacement: 'Hola',
    expectedRevision: accepted.editor.revision, mode: 'propose', threadId: again.thread.id, expectedCommentsRevision: again.commentsRevision,
  });
  const moved = structuredClone(accepted.editor.document);
  moved.pages[0].en = `${moved.pages[0].en} more`;
  const edited = await replaceText(context, created.id, { document: moved, expectedRevision: accepted.editor.revision });
  await assert.rejects(() => answerProposal(context, created.id, stale.proposal.id, { decision: 'accept', expectedRevision: stale.proposal.baseRevision, expectedCommentsRevision: stale.proposal.commentsRevision }), { status: 409, code: 'proposal_stale' });
  await assert.rejects(() => answerProposal({ ...context, principal: { audience: 'agent', unitId: 'project:shop:executor' } }, created.id, stale.proposal.id, { decision: 'accept', expectedRevision: edited.revision, expectedCommentsRevision: stale.proposal.commentsRevision }), { status: 403, code: 'forbidden' });
});

test('an edited suggestion keeps its base expected text identity discussion and unknown fields', async (t) => {
  const { context, localPath } = await shop(t);
  const document = { ...release(), rev: 7, future: { retained: true } };
  document.pages[0].future = { retained: true };
  const editor = await createText(context, { project: 'shop', path: 'docs/edited-suggestion.json', document });
  const comment = await createComment(context, editor.id, { text: 'Improve the greeting', sendToAgent: false,
    expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision,
    anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 7, quote: 'Welcome' } });
  const suggested = await replaceRange(context, editor.id, { k: 'Intro.Welcome', lang: 'en', start: 3, end: 10, expectedText: 'Welcome', replacement: 'Hello',
    expectedRevision: editor.revision, expectedCommentsRevision: comment.commentsRevision, threadId: comment.thread.id, mode: 'propose' });
  const file = path.join(localPath, 'docs/edited-suggestion.comments.json');
  const comments = JSON.parse(await readFile(file));
  comments.future = { retained: true }; comments.threads[0].future = { retained: true };
  const message = comments.threads[0].messages.at(-1);
  message.future = { retained: true }; message.proposal.future = { retained: true };
  await writeFile(file, JSON.stringify(comments));
  const body = { decision: 'accept', replacement: 'Greetings 😀', expectedRevision: editor.revision, expectedCommentsRevision: (await readComments(context, editor.id)).commentsRevision };
  const accepted = await answerProposal(context, editor.id, suggested.proposal.id, body);
  assert.equal(accepted.editor.document.pages[0].en, '<b>Greetings 😀</b>\nA first paragraph.');
  assert.equal(accepted.editor.document.pages[0].es, editor.document.pages[0].es);
  assert.equal(accepted.editor.document.rev, editor.document.rev + 1);
  assert.deepEqual(accepted.editor.document.future, document.future);
  assert.deepEqual(accepted.editor.document.pages[0].future, document.pages[0].future);
  assert.equal(accepted.proposal.id, suggested.proposal.id); assert.equal(accepted.proposal.threadId, comment.thread.id);
  assert.equal(accepted.proposal.expectedText, 'Welcome'); assert.equal(accepted.proposal.baseRevision, editor.revision);
  assert.equal(accepted.proposal.replacement, body.replacement); assert.equal(accepted.proposal.state, 'accepted');
  const saved = JSON.parse(await readFile(file));
  assert.deepEqual(saved.future, comments.future); assert.deepEqual(saved.threads[0].future, comments.threads[0].future);
  assert.deepEqual(saved.threads[0].messages[0], comments.threads[0].messages[0]);
  assert.equal(saved.threads[0].messages.at(-1).text, message.text);
  assert.deepEqual(saved.threads[0].messages.at(-1).future, message.future);
  assert.deepEqual(accepted.proposal.future, message.proposal.future);
  const versions = (await readFile(path.join(localPath, 'docs/edited-suggestion.versions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(versions.at(-1).after, accepted.editor.document.pages[0].en);
});

test('stale edited suggestions write nothing and discard keeps every discussion message', async (t) => {
  for (const drift of ['revision', 'expected-text']) await t.test(drift, async (t) => {
    const { context, localPath } = await shop(t);
    let editor = await createText(context, { project: 'shop', path: 'docs/stale-suggestion.json', document: release() });
    const comment = await createComment(context, editor.id, { text: 'Improve the greeting', sendToAgent: false,
      expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision,
      anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 7, quote: 'Welcome' } });
    const suggested = await replaceRange(context, editor.id, { k: 'Intro.Welcome', lang: 'en', start: 3, end: 10, expectedText: 'Welcome', replacement: 'Hello',
      expectedRevision: editor.revision, expectedCommentsRevision: comment.commentsRevision, threadId: comment.thread.id, mode: 'propose' });
    const commentFile = path.join(localPath, 'docs/stale-suggestion.comments.json');
    if (drift === 'revision') editor = await replaceText(context, editor.id, { document: { ...editor.document, title: 'Changed title' }, expectedRevision: editor.revision });
    else {
      const comments = JSON.parse(await readFile(commentFile)); comments.threads[0].messages.at(-1).proposal.expectedText = 'Changed';
      await writeFile(commentFile, JSON.stringify(comments));
    }
    const comments = await readComments(context, editor.id), before = await readFile(commentFile), textBefore = await readFile(path.join(localPath, editor.path));
    const historyBefore = await listHistory(context, editor.id);
    const originalBefore = await readFile(path.join(localPath, 'docs/stale-suggestion.orig.json'));
    const versionsBefore = await readFile(path.join(localPath, 'docs/stale-suggestion.versions.jsonl')).catch(() => null);
    await assert.rejects(() => answerProposal(context, editor.id, suggested.proposal.id, { decision: 'accept', replacement: 'Edited replacement',
      expectedRevision: editor.revision, expectedCommentsRevision: comments.commentsRevision }), { status: 409, code: 'proposal_stale' });
    assert.deepEqual(await readFile(commentFile), before); assert.deepEqual(await readFile(path.join(localPath, editor.path)), textBefore);
    assert.deepEqual(await listHistory(context, editor.id), historyBefore);
    assert.deepEqual(await readFile(path.join(localPath, 'docs/stale-suggestion.orig.json')), originalBefore);
    assert.deepEqual(await readFile(path.join(localPath, 'docs/stale-suggestion.versions.jsonl')).catch(() => null), versionsBefore);
    const discarded = await answerProposal(context, editor.id, suggested.proposal.id, { decision: 'discard', expectedRevision: editor.revision, expectedCommentsRevision: comments.commentsRevision });
    assert.equal(discarded.proposal.state, 'discarded'); assert.equal(discarded.editor.revision, editor.revision);
    const messages = JSON.parse(await readFile(commentFile)).threads[0].messages;
    const prior = JSON.parse(before).threads[0].messages;
    assert.deepEqual(messages[0], prior[0]); assert.equal(messages.length, prior.length);
    assert.equal(messages.at(-1).text, prior.at(-1).text); assert.equal(messages.at(-1).proposal.replacement, 'Hello');
  });
});

test('edited acceptance recovers text comments and one History entry with the same receipt', async (t) => {
  for (const fault of [{ afterPrepared: true }, { afterRenames: 1 }, { beforeReceipt: true }, { afterReceipt: true }]) await t.test(JSON.stringify(fault), async (t) => {
    const { context, fixture, localPath } = await shop(t);
    const editor = await createText(context, { project: 'shop', path: 'docs/retry-suggestion.json', document: release() });
    const comment = await createComment(context, editor.id, { text: 'Improve the greeting', sendToAgent: false,
      expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision,
      anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 7, quote: 'Welcome' } });
    const suggested = await replaceRange(context, editor.id, { k: 'Intro.Welcome', lang: 'en', start: 3, end: 10, expectedText: 'Welcome', replacement: 'Hello',
      expectedRevision: editor.revision, expectedCommentsRevision: comment.commentsRevision, threadId: comment.thread.id, mode: 'propose' });
    const count = (await listHistory(context, editor.id)).total;
    const body = { decision: 'accept', replacement: '', expectedRevision: editor.revision, expectedCommentsRevision: suggested.editor.commentsRevision };
    const input = { principal: 'suggestion-fixture', key: randomUUID(), requestId: randomUUID(), method: 'POST', path: `/void/texts/${editor.id}/proposals/${suggested.proposal.id}/answer`, body };
    fixture.store.fault = fault;
    await assert.rejects(() => withReceipt(fixture.store, input, (receipt) => answerProposal({ ...context, receipt }, editor.id, suggested.proposal.id, body)), { code: 'injected_crash' });
    await recoverTransactions(fixture.store);
    const replay = await withReceipt(fixture.store, input, () => assert.fail('Acceptance was executed twice.'));
    assert.equal(replay.replayed, true); assert.equal(replay.body.proposal.state, 'accepted'); assert.equal(replay.body.proposal.replacement, '');
    assert.equal((await readEditor(context, editor.id)).document.pages[0].en, '<b></b>\nA first paragraph.');
    assert.equal((await readComments(context, editor.id)).threads[0].messages.at(-1).proposal.state, 'accepted');
    assert.equal((await listHistory(context, editor.id)).total, count + 1);
    assert.equal((await readFile(path.join(localPath, 'docs/retry-suggestion.versions.jsonl'), 'utf8')).trim().split('\n').length, 1);
  });
});

test('HTTP suggestion answers allow only a string accept override and replay one edited acceptance', async (t) => {
  const { context, fixture, cleanups } = await shop(t);
  const editor = await createText(context, { project: 'shop', path: 'docs/http-suggestion.json', document: release() });
  const comment = await createComment(context, editor.id, { text: 'Improve the greeting', sendToAgent: false,
    expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision,
    anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 7, quote: 'Welcome' } });
  const suggested = await replaceRange(context, editor.id, { k: 'Intro.Welcome', lang: 'en', start: 3, end: 10, expectedText: 'Welcome', replacement: 'Hello',
    expectedRevision: editor.revision, expectedCommentsRevision: comment.commentsRevision, threadId: comment.thread.id, mode: 'propose' });
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: context.now, projects: context.projects }); cleanups.push(() => core.http.close());
  const auth = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } });
  const token = auth.json.data.token, url = `/api/v1/void/texts/${editor.id}/proposals/${suggested.proposal.id}/answer`;
  const body = { decision: 'accept', expectedRevision: editor.revision, expectedCommentsRevision: suggested.editor.commentsRevision };
  const historyBefore = (await listHistory(context, editor.id)).total;
  for (const [extra, status] of [[{ replacement: null }, 422], [{ replacement: 1 }, 422], [{ decision: 'discard', replacement: 'No' }, 422], [{ replacement: 'Hi', baseRevision: editor.revision }, 400], [{ replacement: 'Hi', expectedText: 'Changed' }, 400]]) {
    const result = await call(core.http.port, 'POST', url, { token, body: { ...body, ...extra }, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(result.status, status); assert.equal((await readEditor(context, editor.id)).revision, editor.revision);
    assert.equal((await listHistory(context, editor.id)).total, historyBefore);
  }
  const headers = { 'idempotency-key': randomUUID() }, acceptedBody = { ...body, replacement: 'Edited' };
  const accepted = await call(core.http.port, 'POST', url, { token, body: acceptedBody, headers });
  assert.equal(accepted.status, 200); assert.equal(accepted.json.data.proposal.baseRevision, editor.revision);
  const replay = await call(core.http.port, 'POST', url, { token, body: acceptedBody, headers });
  assert.equal(replay.status, 200); assert.deepEqual(replay.json.data, accepted.json.data);
  assert.equal((await listHistory(context, editor.id)).total, historyBefore + 1);
});

test('comments keep a corrupt sidecar, relocate anchors and notify once', async (t) => {
  const { context, fixture, localPath } = await shop(t);
  await seedAttachedUnits(context, ['project:shop:executor', 'project:shop:other']);
  context.paths = fixture.paths;
  const created = await createText(context, { project: 'shop', path: 'docs/release.json', document: release(), attached: ['project:shop:executor', 'project:shop:other'] });
  const commentsFile = path.join(localPath, 'docs', 'release.comments.json');
  const broken = '{';
  await writeFile(commentsFile, broken);
  await assert.rejects(() => readComments(context, created.id), { status: 409, code: 'corrupt_resource' });
  assert.equal(await readFile(commentsFile, 'utf8'), broken);
  await writeFile(commentsFile, `${JSON.stringify({ path: 'release.json', threads: [] })}\n`);
  const comments = await readComments(context, created.id);
  const rendered = plain(created.document.pages[0].en);
  const thread = await createComment(context, created.id, {
    text: 'Clarify the introduction.',
    expectedRevision: created.revision,
    expectedCommentsRevision: comments.commentsRevision,
    anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 7, quote: rendered.slice(0, 7) },
  });
  assert.equal(thread.thread.messages[0].author, 'master');
  const fanout = path.join(fixture.paths.mind, 'user', 'relay', 'fanout', `${thread.thread.messages[0].id}.json`);
  const notices = JSON.parse(await readFile(fanout, 'utf8')).notices;
  assert.deepEqual(notices.map((item) => item.unitId).sort(), ['project:shop:executor', 'project:shop:other']);
  const again = await notifyAttached(context, { messageId: thread.thread.messages[0].id, resourceId: created.id, recipients: ['project:shop:executor'] });
  assert.deepEqual(again, []);
  const agentContext = { ...context, principal: { audience: 'agent', unitId: 'project:shop:executor' } };
  const reply = await replyComment(agentContext, created.id, thread.thread.id, { text: 'Done', expectedCommentsRevision: thread.commentsRevision });
  const agentNotices = JSON.parse(await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'fanout', `${reply.thread.messages.at(-1).id}.json`), 'utf8')).notices.map((item) => item.unitId).sort();
  assert.deepEqual(agentNotices, ['project:shop:other', 'root:master']);
  await assert.rejects(() => replyComment({ ...context, principal: { audience: 'agent', unitId: 'project:shop:stranger' } }, created.id, thread.thread.id, { text: 'No', expectedCommentsRevision: reply.commentsRevision }), { status: 403, code: 'forbidden' });
  const changed = structuredClone(created.document);
  changed.pages[0].en = `Note. ${changed.pages[0].en}`;
  await replaceText(context, created.id, { document: changed, expectedRevision: created.revision });
  const placed = (await readComments(context, created.id)).threads[0];
  assert.equal(placed.anchor.quote, 'Welcome');
  const { place } = await import('../features/void/comments.mjs');
  assert.equal(place((await readEditor(context, created.id)).document.pages, placed).exact, true);
});

test('an external edit is journaled once and a crash still finishes the text files', async (t) => {
  const { context, fixture, localPath } = await shop(t);
  const created = await createText(context, { project: 'shop', path: 'docs/release.json', document: release() });
  const file = path.join(localPath, 'docs', 'release.json');
  const outside = structuredClone(created.document);
  outside.pages[0].en = `${outside.pages[0].en} outside`;
  await writeFile(file, `${JSON.stringify(outside, null, 2)}\n`);
  assert.equal((await observeExternal(context, created.id)).changed, true);
  assert.equal((await observeExternal(context, created.id)).changed, false);
  const lines = (await readFile(path.join(localPath, 'docs', 'release.versions.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).by, 'outside');
  await writeFile(file, '{');
  assert.equal((await observeExternal(context, created.id)).issue, true);
  assert.equal(await readFile(file, 'utf8'), '{');
  fixture.store.fault = { afterRenames: 1 };
  await assert.rejects(() => createText(context, { project: 'shop', path: 'docs/other.json', document: release() }), { code: 'injected_crash' });
  await recoverTransactions(fixture.store);
  const recovered = await readFile(path.join(localPath, 'docs', 'other.json'), 'utf8');
  assert.equal(await readFile(path.join(localPath, 'docs', 'other.orig.json'), 'utf8'), recovered);
});

test('Watch follows only its owner and expires after fifteen minutes', async (t) => {
  const { context } = await shop(t);
  const now = Date.parse('2026-10-10T12:00:00.000Z');
  const bus = createEventBus({ now: () => now });
  const watch = createWatch({ bus, now: () => now });
  const owner = bus.subscribe({ stableId: 'owner', viewerId: 'viewer-owner', audience: 'desktop' });
  const other = bus.subscribe({ stableId: 'other', viewerId: 'viewer-other', audience: 'desktop' });
  const opened = await startWatch(watch, { viewerId: 'viewer-owner', token: 'owner-token', unitId: 'root:builder' });
  assert.equal(opened.state, 'waiting');
  recordActivity(watch, { unitId: 'root:builder', resourceId: 'a', at: '2026-10-10T12:00:00.000Z' });
  recordActivity(watch, { unitId: 'root:builder', resourceId: 'b', at: '2026-10-10T12:00:00.000Z' });
  assert.equal(resolveActivity(watch, 'root:builder', now).resourceId, 'b');
  assert.equal(owner.buffer.some((frame) => frame.name === 'watch.changed'), true);
  assert.equal(other.buffer.some((frame) => frame.name === 'watch.changed'), false);
  stopWatch(watch, opened.watchId);
  assert.equal(owner.buffer.at(-1).data.data.state, 'stopped');
  assert.equal(owner.buffer.at(-1).data.data.watchId, opened.watchId);
  const before = owner.buffer.length;
  recordActivity(watch, { unitId: 'root:builder', resourceId: 'c', at: '2026-10-10T12:00:00.000Z' });
  assert.equal(owner.buffer.length, before);
  const created = await createText(context, { project: 'shop', path: 'docs/release.json', document: release() });
  assert.equal(created.document.title, 'Release notes');
  clearUnit(watch, 'root:builder');
  assert.equal(resolveActivity(watch, 'root:builder', now), null);
  recordActivity(watch, { unitId: 'root:builder', resourceId: 'old', at: '2026-10-10T11:40:00.000Z' });
  assert.equal(resolveActivity(watch, 'root:builder', now), null);
  const firstWatch = await startWatch(watch, { viewerId: 'viewer-owner', token: 'owner-token', unitId: 'root:builder' });
  const secondWatch = await startWatch(watch, { viewerId: 'viewer-owner', token: 'owner-token', unitId: 'root:other' });
  assert.throws(() => stopWatch(watch, firstWatch.watchId, 'viewer-other'), { code: 'forbidden' });
  assert.equal(disposeViewer(watch, 'owner-token'), true);
  assert.equal(watch.viewers.has(firstWatch.watchId), false);
  assert.equal(watch.viewers.has(secondWatch.watchId), false);
  t.after(() => {});
});

test('a registered repository outside the mind and local directory accepts board and void writes', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const localPath = path.join(fixture.root, 'external-project');
  const sibling = path.join(fixture.root, 'sibling');
  await mkdir(localPath, { recursive: true });
  await mkdir(sibling, { recursive: true });
  const ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.paths.machine });
  const context = {
    store: fixture.store,
    paths: fixture.paths,
    projects: [{ name: 'shop', localPath, eligible: true }],
    now: () => fixture.clock.now,
    ledger,
  };
  const board = await createBoard(context, { project: 'shop', document: sketch('probe') });
  const boardFile = path.join(localPath, 'docs', 'flows', 'boards', 'probe.json');
  assert.equal(JSON.parse(await readFile(boardFile, 'utf8')).id, 'probe');
  assert.equal(board.project, 'shop');
  assert.equal(path.relative(fixture.paths.mind, boardFile).startsWith('..'), true);
  assert.equal(path.relative(fixture.paths.localDirectory, boardFile).startsWith('..'), true);
  const text = await createText(context, { project: 'shop', path: 'docs/probe.json', document: release() });
  assert.equal(text.document.title, 'Release notes');
  assert.equal(JSON.parse(await readFile(path.join(localPath, 'docs', 'probe.json'), 'utf8')).title, 'Release notes');
  await assert.rejects(atomicWrite(fixture.store, path.join(sibling, 'probe.json'), Buffer.from('no')), { code: 'unsafe_path' });
  await assert.rejects(commitTransaction(fixture.store, {
    id: randomUUID(),
    entries: [{
      resource: 'project:shop:../sibling/probe.json',
      target: { kind: 'project', project: 'shop', path: '../sibling/probe.json' },
      beforeRevision: null,
      afterBytes: Buffer.from('no'),
    }],
  }), { code: 'unsafe_path' });
  await assert.rejects(commitTransaction(fixture.store, {
    id: randomUUID(),
    entries: [{
      resource: 'project:shop:README.md',
      target: { kind: 'project', project: 'shop', path: 'README.md' },
      beforeRevision: null,
      afterBytes: Buffer.from('no'),
    }],
  }), { code: 'unsafe_path' });
  await symlink(sibling, path.join(localPath, 'docs', 'flows', 'assets'), 'junction');
  await assert.rejects(commitTransaction(fixture.store, {
    id: randomUUID(),
    entries: [{
      resource: 'project:shop:docs/flows/assets/link.png',
      target: { kind: 'project', project: 'shop', path: 'docs/flows/assets/link.png' },
      beforeRevision: null,
      afterBytes: PNG,
    }],
  }), { code: 'unsafe_path' });
  await assert.rejects(readFile(path.join(sibling, 'link.png')));
  await assert.rejects(readFile(path.join(sibling, 'probe.json')));
});

test('editor create, edit, attach, comment and asset publish to another service', async (t) => {
  const { fixture, context } = await shop(t);
  const originPath = path.join(fixture.root, 'origin');
  await mkdir(originPath, { recursive: true });
  fixture.paths.origin = originPath;
  const sync = openSync({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    projects: context.projects,
  });
  const origin = openOrigin({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    machine: fixture.machine,
  });
  const timers = new Set();
  const pulse = createPulse({
    sync,
    origin,
    ledger: context.ledger,
    now: () => fixture.clock.now,
    setTimeout(fn) {
      const timer = { cleared: false, fn };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  });
  t.after(() => pulse.close());
  const notified = [];
  const notify = pulse.changed.bind(pulse);
  pulse.changed = (ids) => {
    notified.push(...ids);
    return notify(ids);
  };
  context.sync = sync;
  context.pulse = pulse;
  const board = await createBoard(context, { project: 'shop', document: sketch('shop') });
  fixture.clock.now += 1000;
  const revised = structuredClone(board.document);
  revised.title = 'Shop floor';
  const edited = await replaceBoard(context, board.id, { document: revised, expectedRevision: board.revision });
  assert.equal(edited.document.title, 'Shop floor');
  fixture.clock.now += 1000;
  const attachment = await readAttachments(context, board.id);
  const attached = await writeAttachments(context, board.id, { expectedRevision: attachment.revision, attached: ['root:master'] });
  assert.deepEqual(attached.attached, ['root:master']);
  fixture.clock.now += 1000;
  const asset = await createAsset(context, board.id, { contentType: 'image/png', bytesBase64: PNG.toString('base64') });
  assert.equal(asset.src.startsWith('assets/'), true);
  fixture.clock.now += 1000;
  const text = await createText(context, { project: 'shop', path: 'docs/release.json', document: release() });
  fixture.clock.now += 1000;
  const comment = await createComment(context, text.id, {
    text: 'Keep the welcome line.',
    expectedRevision: text.revision,
    expectedCommentsRevision: (await readComments(context, text.id)).commentsRevision,
    anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 1, quote: plain(text.document.pages[0].en).slice(0, 1) },
  });
  assert.equal(comment.thread.messages[0].text, 'Keep the welcome line.');
  const staged = await readdir(path.join(fixture.paths.localDirectory, 'staging', 'changes'));
  const targets = [];
  for (const name of staged) {
    const record = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'staging', 'changes', name), 'utf8'));
    targets.push(record.target.path);
  }
  assert.ok(targets.includes('user/gui/resources.json'));
  assert.ok(targets.includes('docs/flows/boards/shop.json'));
  assert.ok(targets.includes(`user/relay/editors/${board.id}.json`));
  assert.ok(targets.includes('docs/release.comments.json'));
  assert.ok(targets.some((item) => item.startsWith('docs/flows/assets/')));
  assert.equal(targets.some((item) => item.includes('/receipts/') || item.includes('/leases/')), false);
  assert.ok(notified.length >= 5);
  const published = [];
  for (let guard = 0; guard < 8; guard += 1) {
    const result = await pulse.flush();
    assert.equal(result.error, undefined);
    published.push(...(result.ids ?? []));
    if (!result.ids?.length) break;
  }
  assert.ok(published.length >= 5);
  const head = await readHead(origin, fixture.machine);
  assert.ok(head.sequence >= 1);
  const laptopMind = path.join(fixture.root, 'localappdata', 'Cosmic', 'laptop-mind');
  const laptopShop = path.join(fixture.root, 'laptop-shop');
  await mkdir(path.join(laptopMind, 'user'), { recursive: true });
  await mkdir(laptopShop, { recursive: true });
  const laptopPaths = servicePaths({
    platform: 'win32',
    env: fixture.env,
    home: fixture.home,
    machine: 'LAPTOP',
    mindPath: laptopMind,
    originPath: originPath,
  });
  await mkdir(laptopPaths.localDirectory, { recursive: true });
  const laptopStore = createStore({
    root: fixture.root,
    confineRoot: fixture.root,
    mindPath: laptopMind,
    localDirectory: laptopPaths.localDirectory,
    now: () => fixture.clock.now,
    events: [],
  });
  const laptop = openSync({
    store: laptopStore,
    paths: laptopPaths,
    now: () => fixture.clock.now,
    projects: [{ name: 'shop', localPath: laptopShop }],
  });
  for (let sequence = 1; sequence <= head.sequence; sequence += 1) {
    const packed = await readOriginPack(origin, fixture.machine, sequence);
    const result = await applyPack(laptop, packed, { projects: laptop.projects });
    assert.equal(result.status, 'applied');
  }
  const remoteBoard = JSON.parse(await readFile(path.join(laptopShop, 'docs', 'flows', 'boards', 'shop.json'), 'utf8'));
  assert.equal(remoteBoard.title, 'Shop floor');
  const remoteAssets = await readdir(path.join(laptopShop, 'docs', 'flows', 'assets'));
  assert.equal(remoteAssets.length, 1);
  const remoteCatalog = JSON.parse(await readFile(path.join(laptopPaths.mind, 'user', 'gui', 'resources.json'), 'utf8'));
  assert.ok(remoteCatalog.resources.some((item) => item.id === board.id));
  assert.ok(remoteCatalog.resources.some((item) => item.id === text.id));
  const binding = JSON.parse(await readFile(path.join(laptopPaths.mind, 'user', 'relay', 'editors', `${board.id}.json`), 'utf8'));
  assert.deepEqual(binding.attached, ['root:master']);
  const remoteComments = JSON.parse(await readFile(path.join(laptopShop, 'docs', 'release.comments.json'), 'utf8'));
  assert.equal(remoteComments.threads[0].messages[0].text, 'Keep the welcome line.');
});

test('editor lists and detail project live sidecars and pages', async (t) => {
  const { context } = await shop(t);
  context.watch = createWatch({ now: () => context.now() });
  const first = await createBoard(context, { project: 'shop', document: sketch('alpha') });
  const second = await createBoard(context, { project: 'shop', document: sketch('beta') });
  assert.equal(first.openThreads, 0);
  assert.equal(first.attachmentRevision, null);
  assert.equal(typeof first.commentsRevision, 'string');
  assert.deepEqual(first.threads, []);
  const attached = await writeAttachments(context, first.id, { attached: ['root:master'], expectedRevision: null });
  const commented = await createComment(context, first.id, {
    text: 'Check the bag.',
    expectedRevision: first.revision,
    expectedCommentsRevision: first.commentsRevision,
    anchor: { screen: first.document.screens[0].id, label: 'Bag' },
  });
  recordActivity(context.watch, { unitId: 'root:master', resourceId: first.id, at: new Date(context.now()).toISOString() });
  const detail = await readEditor(context, first.id);
  assert.equal(detail.title, 'Cart');
  assert.equal(detail.readOnly, false);
  assert.equal(detail.attachmentRevision, attached.revision);
  assert.equal(detail.commentsRevision, commented.commentsRevision);
  assert.equal(detail.openThreads, 1);
  assert.equal(detail.threads[0].messages[0].text, 'Check the bag.');
  assert.deepEqual(detail.attached, ['root:master']);
  assert.deepEqual(detail.activity, { unitId: 'root:master', at: new Date(context.now()).toISOString() });
  const page = await list(context, { kind: 'blueprint', limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.issues.length, 0);
  assert.equal(typeof page.nextCursor, 'string');
  const summary = page.items.find((item) => item.id === first.id) ?? (await list(context, { kind: 'blueprint', limit: 1, cursor: page.nextCursor })).items.find((item) => item.id === first.id);
  assert.equal(summary.title, 'Cart');
  assert.equal(summary.openThreads, 1);
  assert.deepEqual(summary.attached, ['root:master']);
  assert.equal(summary.activity.unitId, 'root:master');
  assert.equal(summary.readOnly, false);
  assert.equal(typeof summary.revision, 'string');
  assert.equal(summary.document, undefined);
  const rest = await list(context, { kind: 'blueprint', limit: 1, cursor: page.nextCursor });
  assert.equal(rest.items.length, 1);
  assert.equal(rest.nextCursor, null);
  assert.notEqual(rest.items[0].id, page.items[0].id);
  assert.ok([first.id, second.id].includes(rest.items[0].id));
  const found = await list(context, { kind: 'blueprint', q: 'docs/flows/boards/alpha.json' });
  assert.equal(found.total, 1);
  assert.equal(found.items[0].id, first.id);
});

function call(port, method, target, { token = null, body = undefined, headers = {} } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      method,
      path: target,
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const json = raw.length > 0 && String(res.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : null;
        resolve({ status: res.statusCode, raw, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

test('editor search includes screen labels nested text pages and comments', () => {
  const value = editorSearchText({ title: 'Cart page', path: 'docs/cart.json', document: {
    screens: [{ title: 'Empty cart', root: { name: 'Root', kids: [{ name: 'Continue button', value: 'Return to shop', kids: [] }] } }],
    pages: [{ k: 'intro', en: 'Relay manual', es: 'Manual de Relay' }],
  }, threads: [{ messages: [{ text: 'Add checkout errors' }] }] });
  for (const query of ['cart page', 'empty cart', 'continue button', 'return to shop', 'relay manual', 'manual de relay', 'checkout errors']) assert.ok(value.includes(query));
  assert.equal(editorSearchText({ document: { screens: [{ root: { kids: [] } }], pages: [] } }), '');
});

test('Send to agent keeps local notes and only the person receives a suppressed agent reply', () => {
  const desktop = { principal: { audience: 'desktop', unitId: 'root:master' } };
  const attached = ['root:executor-shop', 'root:executor-shop', 'root:master'];
  assert.deepEqual(commentRecipients(desktop, {}, attached, 'root:master'), ['root:executor-shop']);
  assert.deepEqual(commentRecipients(desktop, { sendToAgent: false }, attached, 'root:master'), []);
  const agent = { principal: { audience: 'agent', unitId: 'root:executor-shop' } };
  assert.deepEqual(commentRecipients(agent, { sendToAgent: false }, attached, 'root:executor-shop'), ['root:master']);
  assert.throws(() => commentRecipients(desktop, { sendToAgent: 'false' }, attached, 'root:master'), { status: 422, code: 'invalid_body' });
});

test('a person note and its reply persist without message admission or fanout', async (t) => {
  const { fixture, context } = await shop(t);
  context.principal = { audience: 'desktop', unitId: 'root:master' };
  const board = await createBoard(context, { project: 'shop', document: sketch() });
  context.ledger = null;
  const note = await createComment(context, board.id, {
    text: 'Keep this as a note.', sendToAgent: false,
    expectedRevision: board.revision,
    expectedCommentsRevision: (await readComments(context, board.id)).commentsRevision,
    anchor: { screen: board.document.screens[0].id, label: 'Bag' },
  });
  assert.equal(note.thread.messages[0].sendToAgent, false);
  const replied = await replyComment(context, board.id, note.thread.id, {
    text: 'The note remains local.', sendToAgent: false,
    expectedCommentsRevision: note.commentsRevision,
  });
  assert.equal(replied.thread.messages.at(-1).sendToAgent, false);
  const stored = await readComments(context, board.id);
  assert.equal(stored.threads[0].messages.length, 2);
  for (const message of stored.threads[0].messages) {
    const fanout = path.join(fixture.paths.mind, 'user', 'relay', 'fanout', message.id + '.json');
    await assert.rejects(readFile(fanout), { code: 'ENOENT' });
  }
});

test('Void replacement accepts omitted server fields and ignores forged revisions', async (t) => {
  const { context, localPath } = await shop(t);
  const created = await createText(context, { project: 'shop', path: 'docs/server-fields.json', document: {
    title: 'Notes', rev: 7, marker: { kept: true }, pages: [{ k: 'intro', en: 'Before', es: 'Antes' }],
  } });
  const originalPath = path.join(localPath, 'docs', 'server-fields.orig.json');
  const original = await readFile(originalPath);
  const first = await replaceText(context, created.id, { expectedRevision: created.revision, document: {
    title: 'Notes', marker: { kept: true }, pages: [{ k: 'intro', en: 'After', es: 'Antes' }],
  } });
  assert.equal(first.document.rev, 8);
  assert.deepEqual(first.document.marker, { kept: true });
  const second = await replaceText(context, created.id, { expectedRevision: first.revision, document: {
    ...structuredClone(first.document), rev: 9999, history: [{ forged: true }], pages: [{ k: 'intro', en: 'After again', es: 'Antes' }],
  } });
  assert.equal(second.document.rev, 9);
  assert.equal(Object.hasOwn(second.document, 'history'), false);
  assert.deepEqual(second.document.marker, { kept: true });
  assert.deepEqual(await readFile(originalPath), original);
});

test('History restores an earlier board version even after an edit added a known field', async (t) => {
  const { context } = await shop(t);
  let editor = await createBoard(context, { project: 'shop', document: sketch('restore-after-frame') });
  const initial = (await listHistory(context, editor.id)).items[0];
  // A frame added through the editor writes the page's start, which the first version never had.
  const framed = structuredClone(editor.document);
  framed.pages[0].start = framed.screens[0].id;
  editor = await replaceBoard(context, editor.id, { document: framed, expectedRevision: editor.revision });
  assert.equal(editor.document.pages[0].start, framed.screens[0].id);
  const restored = await restoreHistory(context, editor.id, initial.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  assert.equal(Object.hasOwn(restored.document.pages[0], 'start'), false);
});
