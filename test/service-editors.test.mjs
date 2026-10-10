import { request } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addScreen, newSketch, rectangleNode } from '../features/blueprint/review/sketch-format.mjs';
import { addNode, createAsset, createBoard, discoverResources, preserveUnknown, readAsset, readAttachments, readComments, readEditor, registerResource, removeNode, replaceBoard, updateNode, validateBoard, writeAttachments } from '../engine/service/editors.mjs';
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
  const context = { store: fixture.store, projects: [{ name: 'shop', localPath }], now: () => fixture.clock.now };
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
  const { context } = await shop(t);
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
  const read = await readAsset(context, created.id, asset.src.slice('assets/'.length));
  assert.equal(read.bytes[0], 0x89);
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
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { body: {} });
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
  const editor = await readEditor({ store: fixture.store, projects: [{ name: 'shop', localPath }] }, created.json.data.id);
  assert.equal(editor.document.script, 'from http');
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
