import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { callAppBridge } from '../engine/service/app-bridge.mjs';
import { listHistory, moveEditor, replaceBoard, resolveConflict, restoreHistory, validateBoard } from '../engine/service/editors.mjs';
import { dispatch } from '../engine/service/mcp.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function setup(t) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const localPath = path.join(fixture.paths.localDirectory, 'shop');
  await mkdir(localPath, { recursive: true });
  const statePath = path.join(fixture.paths.mind, 'user/projects/shop/state/executor.md');
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, 'unit: executor\nunit-id: project:shop:executor\nrole: executor\nscope: project:shop\nmachine: DESKTOP\n\n');
  const context = { store: fixture.store, paths: fixture.paths, projects: [{ name: 'shop', localPath }],
    now: () => fixture.clock.now,
    ledger: openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.paths.machine }),
    credential: { audience: 'agent', unitId: 'project:shop:executor', attached: true, token: 'format4-test' },
    principal: { audience: 'agent', unitId: 'project:shop:executor' } };
  let sequence = 0;
  const tool = async (name, args) => {
    const response = await dispatch(context, { jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name, arguments: args } });
    assert.ok(response.result, JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  };
  const success = async (name, args) => {
    const result = await tool(name, args);
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result.data;
  };
  const blueprint = (method, params) => callAppBridge({ ...context, principal: { audience: 'desktop', unitId: 'root:master' } },
    { app: 'blueprint', method: `blueprint.${method}`, params: { location: localPath, ...params }, clientId: 'format4-tests' });
  return { context, localPath, tool, success, blueprint };
}

const mutation = (editor, more = {}) => ({ resourceId: editor.id, expectedRevision: editor.revision, requestId: randomUUID(), ...more });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('format 4 optional fields can be removed by replacement and by restoring an earlier snapshot', async t => {
  const { context, localPath, success } = await setup(t);
  const original = await success('blueprint_create', { title: 'Optional fields', requestId: randomUUID() });
  const history = await listHistory(context, original.id);
  const snapshot = history.items.find(item => item.current);
  assert.ok(snapshot);
  const extended = structuredClone(original.document);
  extended.texts = [{ id: randomUUID(), name: 'Action', values: { en: { value: 'Continue' } } }];
  extended.screens[0].lang = 'es';
  let editor = await replaceBoard(context, original.id, { document: extended, expectedRevision: original.revision });
  assert.deepEqual(editor.document.texts, extended.texts);
  editor = await replaceBoard(context, editor.id, { document: original.document, expectedRevision: editor.revision });
  assert.deepEqual(editor.document, original.document);
  editor = await replaceBoard(context, editor.id, { document: extended, expectedRevision: editor.revision });
  const desktop = { ...context, principal: { audience: 'desktop', unitId: 'root:master' } };
  const restored = await restoreHistory(desktop, editor.id, snapshot.id, { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision });
  assert.deepEqual(restored.document, original.document);
  assert.equal(restored.commentsRevision, restored.revision);
  const stored = await readFile(path.join(localPath, restored.path));
  assert.equal(hash(stored), restored.revision);
  assert.deepEqual(JSON.parse(stored), original.document);
  const kept = await resolveConflict(desktop, editor.id, { decision: 'keep-mine', document: extended, expectedRevision: restored.revision, expectedCommentsRevision: restored.commentsRevision });
  const current = (await listHistory(desktop, editor.id)).items.find(item => item.current);
  assert.ok(current);
  assert.equal(current.revision, kept.revision);
  assert.equal(current.commentsRevision, kept.revision);
  const destination = path.join(path.dirname(localPath), 'other');
  await mkdir(destination, { recursive: true });
  context.projects.push({ name: 'other', localPath: destination });
  const beforeMove = await readFile(path.join(localPath, kept.path));
  for (const invalidPath of ['docs/flows/boards/wrong.mjs', 'docs/flows/boards/wrong.json']) {
    const writes = context.store.writes.length;
    await assert.rejects(moveEditor(desktop, kept.id, { project: 'other', folderId: null, path: invalidPath, confirmedRepositoryChange: true,
      expectedRevision: kept.revision, expectedCommentsRevision: kept.commentsRevision,
      expectedAttachmentRevision: kept.attachmentRevision, expectedLibraryRevision: kept.libraryRevision }), { code: 'invalid_path' });
    assert.equal(context.store.writes.length, writes);
    assert.deepEqual(await readFile(path.join(localPath, kept.path)), beforeMove);
  }
});

test('format 4 MCP tools create, open, add, update and remove with exact-byte revisions and bridge interoperability', async t => {
  const { localPath, tool, success, blueprint } = await setup(t);
  let editor = await success('blueprint_create', { title: 'Checkout', requestId: randomUUID() });
  assert.equal(editor.document.formatVersion, 4);
  assert.match(editor.path, /^docs\/flows\/boards\/[^/]+\.json$/);
  const file = path.join(localPath, editor.path);
  assert.equal(editor.revision, hash(await readFile(file)));
  assert.equal(editor.commentsRevision, editor.revision);
  const opened = await success('blueprint_open', { resourceId: editor.id });
  assert.deepEqual(opened.document, editor.document);
  const bridge = await blueprint('read', { id: editor.document.id });
  assert.deepEqual(bridge.board, editor.document);
  assert.equal(bridge.revision, editor.revision);
  assert.ok((await blueprint('list')).boards.some(board => board.id === editor.document.id));
  const screen = editor.document.screens[0];
  const node = { id: randomUUID(), name: 'Continue', t: 'text', value: 'Continue', place: { x: 20, y: 20 }, w: 160, h: 40 };
  const added = await success('blueprint_add_node', mutation(editor, { screenId: screen.id, parentId: screen.root.id, node }));
  assert.equal(added.nodeId, node.id);
  const stale = await tool('blueprint_update_node', mutation(editor, { nodeId: node.id, changes: { value: 'Stale' } }));
  assert.equal(stale.error.code, 'conflict');
  editor = added.editor;
  const before = await readFile(file);
  const invalid = await tool('blueprint_update_node', mutation(editor, { nodeId: node.id, changes: { w: -1 } }));
  assert.equal(invalid.error.code, 'invalid_document');
  assert.deepEqual(await readFile(file), before);
  editor = await success('blueprint_update_node', mutation(editor, { nodeId: node.id, changes: { value: 'Pay now', textRef: randomUUID() } }));
  assert.equal(editor.document.screens[0].root.kids[0].value, 'Pay now');
  const appDocument = structuredClone(editor.document);
  appDocument.note = 'Saved by the embedded app';
  const appSaved = await blueprint('save', { board: appDocument, revision: editor.revision });
  editor = await success('blueprint_open', { resourceId: editor.id });
  assert.equal(editor.revision, appSaved.revision);
  assert.deepEqual(editor.document, appDocument);
  editor = await success('blueprint_remove_node', mutation(editor, { nodeId: node.id }));
  assert.deepEqual(editor.document.screens[0].root.kids, []);
  assert.equal(editor.document.note, appDocument.note);
  assert.equal(editor.revision, hash(await readFile(file)));
  assert.deepEqual(validateBoard(editor.document), editor.document);
  assert.ok(!(await readdir(path.dirname(file))).some(name => name.endsWith('.mjs')));
  await assert.rejects(readFile(path.join(localPath, 'docs/flows/comments', `${editor.document.id}.json`)), { code: 'ENOENT' });
});

test('format 4 replies use board threads, preserve resolved and other replies, and reject stale whole-board revisions', async t => {
  const { localPath, tool, success, blueprint } = await setup(t);
  let editor = await success('blueprint_create', { title: 'Review', requestId: randomUUID() });
  const screen = editor.document.screens[0];
  const original = { id: randomUUID(), author: 'Tom', text: 'Keep the total visible.', createdAt: '2026-10-31T12:00:00.000Z' };
  const thread = { id: randomUUID(), screen: screen.id, path: [screen.id, screen.root.id], resolved: true, replies: [original] };
  const file = path.join(localPath, editor.path);
  await writeFile(file, JSON.stringify({ ...editor.document, threads: [thread] }));
  const stale = await tool('blueprint_reply_comment', { resourceId: editor.id, threadId: thread.id, text: 'Stale reply', expectedCommentsRevision: editor.commentsRevision, requestId: randomUUID() });
  assert.equal(stale.error.code, 'conflict');
  editor = await success('blueprint_open', { resourceId: editor.id });
  assert.equal(editor.commentsRevision, editor.revision);
  const args = { resourceId: editor.id, threadId: thread.id, text: 'The total stays visible.', expectedCommentsRevision: editor.commentsRevision, requestId: randomUUID() };
  const replied = await success('blueprint_reply_comment', args);
  assert.equal(replied.thread.resolved, true);
  assert.deepEqual(replied.thread.replies[0], original);
  assert.equal(replied.thread.replies[1].author, 'project:shop:executor');
  assert.equal(replied.thread.replies[1].text, args.text);
  assert.match(replied.thread.replies[1].createdAt, /^\d{4}-\d\d-\d\dT/);
  const replay = await success('blueprint_reply_comment', args);
  assert.deepEqual(replay, replied);
  const app = await blueprint('read', { id: editor.document.id });
  assert.equal(app.board.threads[0].replies.length, 2);
  assert.equal(app.board.threads[0].resolved, true);
  assert.equal(app.revision, replied.commentsRevision);
  const staleDesign = await tool('blueprint_update_node', mutation(editor, { nodeId: screen.root.id, changes: { name: 'Stale design' } }));
  assert.equal(staleDesign.error.code, 'conflict');
});
