import { request } from 'node:http';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addScreen, newSketch, rectangleNode } from '../features/blueprint/review/sketch-format.mjs';
import { addNode, answerProposal, createAsset, createBoard, createComment, createText, discoverResources, notifyAttached, observeExternal, preserveUnknown, readAsset, readAttachments, readComments, readEditor, registerResource, removeNode, replaceBoard, replaceRange, replaceText, replyComment, updateNode, validateBoard, writeAttachments } from '../engine/service/editors.mjs';
import { atomicWrite, commitTransaction, recoverTransactions } from '../engine/service/store.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { clearUnit, createWatch, disposeViewer, recordActivity, resolveActivity, start as startWatch, stop as stopWatch } from '../engine/service/watch.mjs';
import { plain } from '../features/void/text.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function sketch(id = 'cart') {
  const document = newSketch(id, 'Cart');
  addScreen(document, { title: 'Bag', x: 0, y: 0 });
  return document;
}

async function shop(t) {
  const fixture = await makeCoreFixture();
  const localPath = path.join(fixture.paths.localDirectory, 'shop');
  await mkdir(localPath, { recursive: true });
  const ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.paths.machine });
  const context = { store: fixture.store, paths: fixture.paths, projects: [{ name: 'shop', localPath }], now: () => fixture.clock.now, ledger };
  t.after(() => dispose(fixture));
  return { fixture, context, localPath };
}

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
  const found = await discoverResources(context, 'shop');
  assert.equal(found.some((item) => item.legacyId === 'legacy' && item.readOnly === true), true);
});

test('an absent project is unavailable', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  await assert.rejects(() => createBoard({ store: fixture.store, projects: [] }, { project: 'shop', document: sketch() }), { status: 503, code: 'project_unavailable' });
});

test('attachments can be replaced and a removed node comment stays readable', async (t) => {
  const { context, localPath } = await shop(t);
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
  const asset = await createAsset(context, created.id, { data: PNG.toString('base64') });
  assert.match(asset.src, /^assets\/[0-9a-f-]{36}\.png$/);
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
  await assert.rejects(() => createAsset(context, created.id, { data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64') }), { status: 422, code: 'invalid_asset' });
  await assert.rejects(() => createAsset(context, created.id, { data: Buffer.alloc(10000001, 1).toString('base64') }), { status: 413, code: 'request_too_large' });
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
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: {} });
  const token = local.json.token;
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
  const quiet = await observeExternal(context, created.id);
  assert.equal(quiet.changed, false);
  assert.equal((await readFile(path.join(localPath, 'docs', 'release.versions.jsonl'), 'utf8')).trim().split('\n').length, 1);
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
    anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 1, quote: plain(removed.editor.document.pages[0].en).slice(0, 1) },
  });
  const proposed = await replaceRange(context, created.id, {
    k: 'Intro.Welcome', lang: 'en', start: 0, end: 2, expectedText: removed.editor.document.pages[0].en.slice(0, 2), replacement: 'Hi',
    expectedRevision: removed.editor.revision, mode: 'propose', threadId: commented.thread.id, expectedCommentsRevision: commented.commentsRevision,
  });
  assert.equal(proposed.proposal.state, 'pending');
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
  await assert.rejects(() => answerProposal(context, created.id, stale.proposal.id, { decision: 'accept', expectedRevision: edited.revision, expectedCommentsRevision: stale.proposal.commentsRevision }), { status: 409, code: 'proposal_stale' });
  await assert.rejects(() => answerProposal({ ...context, principal: { audience: 'agent', unitId: 'project:shop:executor' } }, created.id, stale.proposal.id, { decision: 'accept', expectedRevision: edited.revision, expectedCommentsRevision: stale.proposal.commentsRevision }), { status: 403, code: 'forbidden' });
});

test('comments keep a corrupt sidecar, relocate anchors and notify once', async (t) => {
  const { context, fixture, localPath } = await shop(t);
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
  const before = owner.buffer.length;
  recordActivity(watch, { unitId: 'root:builder', resourceId: 'c', at: '2026-10-10T12:00:00.000Z' });
  assert.equal(owner.buffer.length, before);
  const created = await createText(context, { project: 'shop', path: 'docs/release.json', document: release() });
  assert.equal(created.document.title, 'Release notes');
  clearUnit(watch, 'root:builder');
  assert.equal(resolveActivity(watch, 'root:builder', now), null);
  recordActivity(watch, { unitId: 'root:builder', resourceId: 'old', at: '2026-10-10T11:40:00.000Z' });
  assert.equal(resolveActivity(watch, 'root:builder', now), null);
  assert.equal(disposeViewer(watch, 'owner-token'), true);
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
        resolve({ status: res.statusCode, raw, json });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}
