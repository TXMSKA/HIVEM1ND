import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { createEventBus } from '../engine/service/events.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { atomicWrite, closeReceiptCleanup, commitTransaction, pruneReceipts, RECEIPT_TTL_MS, withReceipt } from '../engine/service/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function setup(t, beforeStart = async () => {}) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const project = path.join(fixture.root, 'shop');
  await mkdir(path.join(project, 'docs/flows/boards'), { recursive: true });
  await writeFile(path.join(project, 'docs/flows/boards/board.json'), '{"title":"Private document"}');
  await writeFile(path.join(project, 'article.md'), 'Private text body');
  const assetId = `${randomUUID()}.png`;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length);
    body.copy(bytes, 4);
    bytes.writeUInt32BE(crc32(body) >>> 0, data.length + 8);
    return bytes;
  };
  await mkdir(path.join(project, 'docs/flows/assets'));
  await writeFile(path.join(project, 'docs/flows/assets', assetId), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 20, 40, 60, 255]))), chunk('IEND', Buffer.alloc(0))]));
  await beforeStart(fixture);
  const credentials = createCredentialStore({ now: () => fixture.clock.now });
  const projects = [{ name: 'shop', localPath: project }];
  const http = await createHttpServer({ store: fixture.store, paths: fixture.paths, projects, credentials, now: () => fixture.clock.now });
  t.after(() => http.close());
  const token = credentials.issue({ audience: 'desktop', unitId: 'root:master', viewerId: randomUUID(), expiresAt: null }).token;
  const origin = `http://127.0.0.1:${http.port}`;
  function request(route, body, { key = randomUUID(), bearer = token, method = body === undefined ? 'GET' : 'POST' } = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(`${origin}/api/v1${route}`, { method, headers: { Authorization: `Bearer ${bearer}`, Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(Buffer.concat(chunks)) }));
      });
      outgoing.on('error', reject);
      outgoing.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const call = (method, params = {}, options = {}) => request('/app-bridge/call', { app: method.startsWith('blueprint.') ? 'blueprint' : 'void', method, params: { location: project, ...params }, clientId: 'receipt-review' }, options);
  const receiptFiles = async () => {
    const root = path.join(fixture.paths.localDirectory, 'receipts');
    const principals = await readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    return (await Promise.all(principals.map(async principal => (await readdir(path.join(root, principal))).map(name => path.join(root, principal, name))))).flat();
  };
  return { fixture, project, projects, assetId, http, credentials, call, request, receiptFiles };
}

test('review 2: bridge reads and open calls never persist bodies in receipts; writes retry with compact metadata', async t => {
  const { call, receiptFiles, project, assetId } = await setup(t);
  for (const [method, params] of [
    ['blueprint.locations', {}], ['blueprint.list', {}], ['blueprint.read', { id: 'board' }],
    ['blueprint.asset', { src: `assets/${assetId}` }],
    ['void.files.list', { path: '' }], ['void.files.read', { path: 'article.md' }], ['void.files.url', { path: 'article.md' }],
    ['void.files.asset', { path: 'article.md' }], ['void.files.attribution', { path: 'article.md' }],
    ['void.storage.load', { key: 'tabs' }], ['void.project', {}], ['agents.list', {}],
    ['void.open.pick', { path: 'article.md' }], ['void.open.switchTo', { path: 'article.md' }],
  ]) {
    assert.equal((await call(method, params)).status, 200, method);
    assert.deepEqual(await receiptFiles(), [], `${method} must not create a receipt`);
  }
  const options = { key: randomUUID() };
  const text = 'Document body excluded from receipts';
  const params = { path: 'created.md', base64: Buffer.from(text).toString('base64'), expected: '' };
  const first = await call('void.files.write', params, options);
  const retry = await call('void.files.write', params, options);
  assert.equal(first.status, 200);
  assert.equal(retry.json.meta.replayed, true);
  assert.deepEqual(retry.json.data, first.json.data);
  assert.equal(first.json.data.path, 'created.md');
  const files = await receiptFiles();
  assert.equal(files.length, 1);
  assert.equal((await readFile(files[0], 'utf8')).includes(params.base64), false);
  assert.equal((await readFile(files[0], 'utf8')).includes(text), false);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(files[0], 'utf8')).response).sort(), ['path', 'revision']);
});

test('service startup removes previously expired receipts without waiting for another write', async t => {
  const { receiptFiles } = await setup(t, async fixture => {
    const directory = path.join(fixture.paths.localDirectory, 'receipts', 'c'.repeat(64));
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${randomUUID()}.json`), JSON.stringify({ expiresAt: new Date(fixture.clock.now - 1).toISOString() }));
  });
  for (let attempt = 0; attempt < 50 && (await receiptFiles()).length; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await receiptFiles(), []);
});

test('review 2: transaction receipts project response metadata and expired unrelated receipts leave disk', async t => {
  const { fixture, receiptFiles } = await setup(t);
  const input = { principal: 'receipt-review', key: randomUUID(), method: 'POST', path: '/message', body: {}, requestId: randomUUID(), responseFields: ['id', 'to'] };
  const target = path.join(fixture.paths.mind, 'user', 'receipt-review.txt');
  await withReceipt(fixture.store, input, receipt => commitTransaction(fixture.store, {
    id: receipt.requestId, receipt,
    entries: [{ resource: 'receipt-review', recordPath: target, beforeRevision: null, afterBytes: Buffer.from('metadata') }],
    response: { status: 201, body: { id: 'message-id', to: 'executor', body: 'Sensitive document excerpt' } },
  }));
  const [expired] = await receiptFiles();
  assert.deepEqual(JSON.parse(await readFile(expired, 'utf8')).response, { id: 'message-id', to: 'executor' });
  const journal = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'transactions', `${input.requestId}.json`), 'utf8'));
  assert.deepEqual(journal.receipt.response, { id: 'message-id', to: 'executor' });
  fixture.clock.now += RECEIPT_TTL_MS + 1;
  await withReceipt(fixture.store, { ...input, key: randomUUID(), requestId: randomUUID() }, async receipt => {
    await atomicWrite(fixture.store, path.join(fixture.paths.localDirectory, 'receipts', receipt.principalHash, `${receipt.key}.json`), Buffer.from(JSON.stringify({ ...receipt, response: {}, status: 200 })));
    return { status: 200, body: {} };
  });
  assert.equal((await receiptFiles()).includes(expired), false, 'activity on another key must remove the expired receipt');
});

test('review 2: expiration removes an unrelated receipt even when its original key is never retried', async t => {
  const { fixture, receiptFiles } = await setup(t);
  const input = { principal: 'expiry-review', key: randomUUID(), method: 'POST', path: '/metadata', body: {}, requestId: randomUUID() };
  const operation = async receipt => {
    await atomicWrite(fixture.store, path.join(fixture.paths.localDirectory, 'receipts', receipt.principalHash, `${receipt.key}.json`), Buffer.from(JSON.stringify({ ...receipt, response: {}, status: 200 })));
    return { status: 200, body: {} };
  };
  await withReceipt(fixture.store, input, operation);
  const [expired] = await receiptFiles();
  fixture.clock.now += RECEIPT_TTL_MS + 1;
  await withReceipt(fixture.store, { ...input, key: randomUUID(), requestId: randomUUID() }, operation);
  assert.equal((await receiptFiles()).includes(expired), false);
});

test('receipt cleanup has a bounded pass, advances across principals, and keeps unexpired receipts', async t => {
  const { fixture, receiptFiles } = await setup(t);
  const root = path.join(fixture.paths.localDirectory, 'receipts');
  const principals = ['a'.repeat(64), 'b'.repeat(64)];
  for (const principal of principals) {
    await mkdir(path.join(root, principal), { recursive: true });
    await Promise.all(Array.from({ length: 70 }, () => writeFile(path.join(root, principal, `${randomUUID()}.json`), JSON.stringify({ expiresAt: new Date(fixture.clock.now - 1).toISOString() }))));
  }
  const live = path.join(root, principals[1], `${randomUUID()}.json`);
  await writeFile(live, JSON.stringify({ expiresAt: new Date(fixture.clock.now + RECEIPT_TTL_MS).toISOString() }));
  const first = await pruneReceipts(fixture.store, { limit: 8 });
  assert.ok(first.removed > 0 && first.removed <= 8);
  for (let pass = 0; pass < 20; pass++) await pruneReceipts(fixture.store, { limit: 8 });
  await closeReceiptCleanup(fixture.store);
  assert.deepEqual(await receiptFiles(), [live]);
});

test('receipt cleanup waits for the same-key writer and never removes its renewed receipt', async t => {
  const { fixture, receiptFiles } = await setup(t);
  const input = { principal: 'receipt-race', key: randomUUID(), method: 'POST', path: '/metadata', body: {}, requestId: randomUUID() };
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const writing = withReceipt(fixture.store, input, async receipt => {
    const file = path.join(fixture.paths.localDirectory, 'receipts', receipt.principalHash, `${receipt.key}.json`);
    await atomicWrite(fixture.store, file, Buffer.from(JSON.stringify({ ...receipt, expiresAt: new Date(fixture.clock.now - 1).toISOString(), response: {}, status: 200 })));
    entered.resolve();
    await release.promise;
    await atomicWrite(fixture.store, file, Buffer.from(JSON.stringify({ ...receipt, response: { id: 'new' }, status: 200 })));
    return { status: 200, body: {} };
  });
  await entered.promise;
  const pruning = pruneReceipts(fixture.store);
  release.resolve();
  await Promise.all([writing, pruning]);
  const files = await receiptFiles();
  assert.equal(files.length, 1);
  assert.equal(JSON.parse(await readFile(files[0], 'utf8')).response.id, 'new');
});

test('the service periodically removes expired receipts without another mutation', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { fixture, call, receiptFiles } = await setup(t);
  assert.equal((await call('void.files.write', { path: 'timer.md', base64: Buffer.from('written once').toString('base64'), expected: '' })).status, 200);
  assert.equal((await receiptFiles()).length, 1);
  fixture.clock.now += RECEIPT_TTL_MS + 1;
  t.mock.timers.tick(60_000);
  for (let attempt = 0; attempt < 50 && (await receiptFiles()).length; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await receiptFiles(), []);
});

test('review 4: app events never consume replay sequence or evict GUI history and only reach desktops', () => {
  const bus = createEventBus();
  const frames = { desktop: [], phone: [], cli: [] };
  for (const audience of Object.keys(frames)) bus.subscribe({ stableId: randomUUID(), audience }, {}, frame => frames[audience].push(frame));
  const cursor = bus.captureCursor();
  bus.emit({ name: 'unit.changed', data: { unitId: 'executor' } });
  const durableCursor = bus.captureCursor();
  for (let index = 0; index < 1100; index++) bus.emit({ name: 'app.bridge', data: { app: 'void', name: 'void.files.changed', params: [{ path: 'C:\\private\\article.md', kind: 'changed' }] } });
  assert.equal(bus.captureCursor(), durableCursor, 'ephemeral app frames must not advance the durable cursor');
  assert.equal(frames.desktop.filter(frame => frame.name === 'app.bridge').length, 1100);
  assert.equal(frames.phone.some(frame => frame.name === 'app.bridge'), false);
  assert.equal(frames.cli.some(frame => frame.name === 'app.bridge'), false);
  const subscriber = bus.subscribe({ stableId: randomUUID(), audience: 'desktop' });
  const replay = bus.replay(subscriber, cursor);
  assert.equal(replay.reset, false);
  assert.deepEqual(replay.events.map(event => event.name), ['unit.changed']);
  bus.emit({ name: 'session.changed', data: { unitId: 'executor' } });
  const afterFlood = bus.replay(subscriber, durableCursor);
  assert.equal(afterFlood.reset, false);
  assert.deepEqual(afterFlood.events.map(event => event.name), ['session.changed']);
});

test('review 5: malformed app calls have a small isolated budget and cannot starve desktop reads', async t => {
  const { call, request } = await setup(t);
  let limited = false;
  for (let index = 0; index < 1250; index++) {
    const result = await call('void.invalid');
    if (index < 240 && result.status === 429) limited = true;
  }
  assert.equal((await request('/units')).status, 200, 'a looping app must not consume the desktop request budget');
  assert.equal(limited, true, 'the app has its own budget below the desktop budget');
  const activity = await request('/app-bridge/activity', { clientId: 'receipt-review', apps: ['blueprint', 'void'] });
  assert.equal(activity.status, 200, 'activity heartbeats remain admitted after the app request budget is exhausted');
});

test('agents.changed debounces unit and session frames and scopes their project', async t => {
  const { fixture, project, projects, http } = await setup(t);
  projects.push({ name: 'other', localPath: path.join(fixture.root, 'other') });
  const frames = [];
  const subscriber = http.bus.subscribe({ stableId: randomUUID(), audience: 'desktop' }, {}, frame => { if (frame.name === 'app.bridge') frames.push(frame.data.data); });
  t.after(() => http.bus.release(subscriber));
  const unitId = 'project:shop:executor';
  http.bus.emit({ name: 'unit.changed', data: { unit: { id: unitId } } });
  await new Promise(resolve => setImmediate(resolve));
  http.bus.emit({ name: 'session.changed', data: { session: { unitId } } });
  await new Promise(resolve => setImmediate(resolve));
  http.bus.emit({ name: 'session.request.changed', data: { unitId } });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(frames, [{ app: null, name: 'agents.changed', params: { location: project } }]);
});

test('app activity requires a desktop session, creates no receipt, and validates its exact body', async t => {
  const { credentials, request, receiptFiles } = await setup(t);
  for (const audience of ['phone', 'agent']) {
    const bearer = credentials.issue({ audience, unitId: 'root:master', capabilities: ['editor.write'], expiresAt: null }).token;
    const result = await request('/app-bridge/activity', { clientId: 'activity-review', apps: ['void'] }, { bearer });
    assert.equal(result.status, 403);
  }
  assert.equal((await request('/app-bridge/activity', { clientId: 'activity-review', apps: ['void'] })).status, 200);
  assert.equal((await request('/app-bridge/activity', { clientId: 'activity-review', apps: [] })).status, 200);
  assert.equal((await request('/app-bridge/activity', { clientId: 'activity-review', apps: ['unknown'] })).status, 422);
  assert.equal((await request('/app-bridge/activity', { clientId: 'activity-review', apps: [], unknown: true })).status, 400);
  assert.deepEqual(await receiptFiles(), []);
});
