import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addScreen, newSketch } from '../features/blueprint/review/sketch-format.mjs';
import { createNativeAdapter, probeClients } from '../engine/service/adapters.mjs';
import { exchange, openHome } from '../engine/service/home.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { routeTable } from '../engine/service/http.mjs';
import { createStore, recoverTransactions } from '../engine/service/store.mjs';
import { composeCore, startService, stopService, writeBeat } from '../engine/service/service.mjs';
import { serveRelayMcp } from '../engine/relay/mcp.mjs';
import { applyPack } from '../engine/sync/apply.mjs';
import { limitsFor, openLedger, reservePublication } from '../engine/sync/limits.mjs';
import { openOrigin, publishPack } from '../engine/sync/origin.mjs';
import { encodePack } from '../engine/sync/pack.mjs';
import { openSync } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { makeRelayMind } from './relay-test-fixture.mjs';

const AT = '2026-10-10T12:00:00.000Z';
const LATER = '2026-10-10T12:00:05.000Z';

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
        let json = null;
        if (raw.length > 0 && String(res.headers['content-type'] ?? '').includes('json')) json = JSON.parse(raw);
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

function key() {
  return { 'idempotency-key': randomUUID() };
}

async function boot(t) {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  fixture.paths.origin = origin;
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
  assert.equal(local.status, 200);
  return { fixture, core, localPath, token: local.json.token, port: core.http.port };
}

test('desktop HTTP covers chat, task, editor, watch, phone denial, receipts and logout', async (t) => {
  const { fixture, core, localPath, token, port } = await boot(t);
  await writeBeat({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now }, 'running');
  const unitKey = randomUUID();
  const created = await call(port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': unitKey },
  });
  assert.equal(created.status, 201);
  const replay = await call(port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': unitKey },
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.json.meta.replayed, true);
  const units = await call(port, 'GET', '/api/v1/units', { token });
  assert.equal(units.json.data.items.some((item) => item.unit === 'builder'), true);

  const builder = units.json.data.items.find((item) => item.unit === 'builder');
  const chat = await call(port, 'POST', '/api/v1/chats', {
    token,
    body: { members: [builder.id], title: 'Release' },
    headers: key(),
  });
  assert.equal(chat.status, 201);
  const posted = await call(port, 'POST', `/api/v1/chats/${chat.json.data.chat.id}/messages`, {
    token,
    body: { body: 'Ship the notes.' },
    headers: key(),
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.json.data.message.body, 'Ship the notes.');

  const taskId = 'project:shop:029';
  const taskPath = path.join(fixture.paths.mind, 'user', 'tasks', '029.md');
  await mkdir(path.dirname(taskPath), { recursive: true });
  await writeFile(taskPath, `id: ${taskId}\r\ntitle: Review me\r\nstatus: open\r\nfrom: user\r\nto-id: ${builder.id}\r\ndate: 2026-10-10\r\n\r\n## Request\r\nKeep this request.\r\n\r\n## Report\r\nExisting report.\r\n`);
  const task = await call(port, 'GET', `/api/v1/tasks/${taskId}`, { token });
  assert.equal(task.status, 200);
  const reviewed = await call(port, 'POST', `/api/v1/tasks/${taskId}/status`, {
    token,
    body: { status: 'review', expectedRevision: task.json.data.revision },
    headers: key(),
  });
  assert.equal(reviewed.status, 200);
  const accepted = await call(port, 'POST', `/api/v1/tasks/${taskId}/status`, {
    token,
    body: { status: 'done', expectedRevision: reviewed.json.data.body.revision },
    headers: key(),
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.data.body.status, 'done');
  const undone = await call(port, 'POST', `/api/v1/tasks/${taskId}/undo`, {
    token,
    body: { expectedRevision: accepted.json.data.body.revision },
    headers: key(),
  });
  assert.equal(undone.status, 200);
  assert.equal(undone.json.data.body.status, 'review');
  assert.match(await readFile(taskPath, 'utf8'), /## Report/);

  const document = newSketch('cart', 'Cart');
  addScreen(document, { title: 'Bag', x: 0, y: 0 });
  document.script = 'kept';
  const board = await call(port, 'POST', '/api/v1/blueprint/boards', {
    token,
    body: { project: 'shop', document },
    headers: key(),
  });
  assert.equal(board.status, 201);
  assert.equal(board.json.data.document.script, 'kept');
  const text = await call(port, 'POST', '/api/v1/void/texts', {
    token,
    body: {
      project: 'shop',
      path: 'docs/release.json',
      document: { title: 'Release notes', rev: 0, pages: [{ k: 'Intro.Welcome', en: 'Hello there', es: 'Hola' }] },
    },
    headers: key(),
  });
  assert.equal(text.status, 201);
  const attachmentList = await call(port, 'GET', `/api/v1/editors/${text.json.data.id}/attachments`, { token });
  assert.equal(attachmentList.status, 200);
  const attached = await call(port, 'PUT', `/api/v1/editors/${text.json.data.id}/attachments`, {
    token,
    body: { attached: [builder.id], expectedRevision: attachmentList.json.data.revision },
    headers: key(),
  });
  assert.equal(attached.status, 200);
  const existingComments = await call(port, 'GET', `/api/v1/editors/${text.json.data.id}/comments`, { token });
  assert.equal(existingComments.status, 200);
  const commented = await call(port, 'POST', `/api/v1/editors/${text.json.data.id}/comments`, {
    token,
    body: {
      text: 'Clarify',
      expectedRevision: text.json.data.revision,
      expectedCommentsRevision: existingComments.json.data.commentsRevision,
      anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 5, quote: 'Hello' },
    },
    headers: key(),
  });
  assert.equal(commented.status, 201);
  const fanout = await readdir(path.join(fixture.paths.mind, 'user', 'relay', 'fanout'));
  assert.equal(fanout.some((name) => name.endsWith('.json')), true);
  const proposed = await call(port, 'POST', `/api/v1/void/texts/${text.json.data.id}/ranges`, {
    token,
    body: {
      k: 'Intro.Welcome',
      lang: 'en',
      start: 0,
      end: 5,
      expectedText: 'Hello',
      replacement: 'Hi',
      expectedRevision: text.json.data.revision,
      mode: 'propose',
      threadId: commented.json.data.thread.id,
      expectedCommentsRevision: commented.json.data.commentsRevision,
    },
    headers: key(),
  });
  assert.equal(proposed.status, 200);
  assert.equal(proposed.json.data.proposal.state, 'pending');
  const answer = await call(port, 'POST', `/api/v1/void/texts/${text.json.data.id}/proposals/${proposed.json.data.proposal.id}/answer`, {
    token,
    body: {
      decision: 'accept',
      expectedRevision: text.json.data.revision,
      expectedCommentsRevision: proposed.json.data.proposal.commentsRevision,
    },
    headers: key(),
  });
  assert.equal(answer.status, 200);
  assert.equal(answer.json.data.editor.document.pages[0].en.startsWith('Hi'), true);
  assert.match(await readFile(path.join(localPath, 'docs', 'release.versions.jsonl'), 'utf8'), /Hello/);

  const watch = await call(port, 'POST', '/api/v1/watch', {
    token,
    body: { unitId: 'root:master' },
    headers: key(),
  });
  assert.equal(watch.status, 200);
  const stopped = await call(port, 'DELETE', `/api/v1/watch/${watch.json.data.watchId}`, { token, body: {}, headers: key() });
  assert.equal(stopped.status, 204);

  const phone = core.credentials.issue({ audience: 'phone', unitId: 'root:master', expiresAt: '2027-01-01T00:00:00.000Z' });
  const denied = await call(port, 'PATCH', '/api/v1/settings', {
    token: phone.token,
    body: { language: 'es', expectedRevision: null },
    headers: key(),
  });
  assert.equal(denied.status, 403);

  const opened = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('event stream timed out')), 2000);
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: '/api/v1/events',
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk.toString('utf8');
        if (raw.includes('event: stream.ready')) {
          clearTimeout(timer);
          resolve({ req, raw });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(opened.raw.includes(token), false);
  opened.req.destroy();
  const loggedOut = await call(port, 'POST', '/api/v1/auth/logout', { token });
  assert.equal(loggedOut.status, 204);
  assert.equal((await call(port, 'GET', '/api/v1/units', { token })).status, 401);
  const recovered = await recoverTransactions(fixture.store);
  assert.equal(Array.isArray(recovered), true);
  const receiptGroups = await readdir(path.join(fixture.paths.localDirectory, 'receipts'));
  const receiptFiles = await readdir(path.join(fixture.paths.localDirectory, 'receipts', receiptGroups[0]));
  const receipt = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'receipts', receiptGroups[0], receiptFiles[0]), 'utf8'));
  assert.equal(typeof receipt.requestId, 'string');
  assert.equal(receipt.response == null, false);
});

test('two machines share an origin and limits pause at the hard window', async (t) => {
  const fixture = await makeCoreFixture({ machine: 'DESKTOP' });
  t.after(() => dispose(fixture));
  const origin = path.join(fixture.root, 'origin');
  await mkdir(path.join(origin, 'machines'), { recursive: true });
  fixture.paths.origin = origin;
  const laptopMind = path.join(fixture.root, 'localappdata', 'Cosmic', 'laptop-mind');
  await mkdir(path.join(laptopMind, 'user'), { recursive: true });
  const laptopPaths = servicePaths({
    platform: 'win32',
    env: fixture.env,
    home: fixture.home,
    machine: 'LAPTOP',
    mindPath: laptopMind,
    originPath: origin,
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
  const desktop = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const laptopOrigin = openOrigin({ store: laptopStore, paths: laptopPaths, now: () => fixture.clock.now, machine: 'LAPTOP' });
  const target = { kind: 'mind', path: 'user/doc.txt' };
  const newer = Buffer.from('newer text');
  const first = encodePack({
    machine: 'LAPTOP',
    sequence: 1,
    changes: [{
      format: 'hivem1nd-change-v1', id: '11111111-1111-4111-8111-111111111111', machine: 'LAPTOP', at: LATER, target,
      operation: 'put', hash: hashBytes(newer), size: newer.length, baseHash: null, messageId: null, transactionId: null,
    }],
    objects: [{ hash: hashBytes(newer), raw: newer }],
    dependencies: [],
    transactions: [],
  });
  await publishPack(laptopOrigin, first);
  await applyPack(desktop, first, { ledger: null });
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'doc.txt'), 'utf8'), 'newer text');
  const older = Buffer.from('older text');
  const second = encodePack({
    machine: 'LAPTOP',
    sequence: 2,
    changes: [{
      format: 'hivem1nd-change-v1', id: '22222222-2222-4222-8222-222222222222', machine: 'LAPTOP', at: AT, target,
      operation: 'put', hash: hashBytes(older), size: older.length, baseHash: null, messageId: null, transactionId: null,
    }],
    objects: [{ hash: hashBytes(older), raw: older }],
    dependencies: [],
    transactions: [],
  });
  await publishPack(laptopOrigin, second);
  await applyPack(desktop, second);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'doc.txt'), 'utf8'), 'newer text');
  const removal = encodePack({
    machine: 'LAPTOP',
    sequence: 3,
    changes: [{
      format: 'hivem1nd-change-v1', id: '33333333-3333-4333-8333-333333333333', machine: 'LAPTOP', at: '2026-10-10T12:00:06.000Z', target,
      operation: 'delete', hash: null, size: 0, baseHash: hashBytes(newer), messageId: null, transactionId: null,
    }],
    objects: [],
    dependencies: [],
    transactions: [],
  });
  await applyPack(desktop, removal);
  await assert.rejects(() => readFile(path.join(fixture.paths.mind, 'user', 'doc.txt')), { code: 'ENOENT' });
  const ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: 'DESKTOP' });
  const raw = Buffer.from('shared');
  const base = encodePack({
    machine: 'LAPTOP', sequence: 1, changes: [], objects: [{ hash: hashBytes(raw), raw }], dependencies: [], transactions: [],
  });
  const later = encodePack({
    machine: 'LAPTOP',
    sequence: 9,
    changes: [{
      format: 'hivem1nd-change-v1', id: '44444444-4444-4444-8444-444444444444', machine: 'LAPTOP', at: LATER,
      target: { kind: 'mind', path: 'user/later.txt' }, operation: 'put', hash: hashBytes(raw), size: raw.length,
      baseHash: null, messageId: null, transactionId: null,
    }],
    objects: [],
    dependencies: [{ hash: hashBytes(raw), machine: 'LAPTOP', sequence: 1, packHash: hashBytes(base) }],
    transactions: [],
  });
  const pending = await applyPack(desktop, later, {
    ledger,
    provider: {
      async readHead() {
        return { format: 'hivem1nd-head-v1', machine: 'LAPTOP', sequence: 1, updatedAt: AT, packs: [{ sequence: 1, file: '000000000001.pack', hash: hashBytes(base), bytes: base.length }] };
      },
      async readPack() { return null; },
    },
  });
  assert.equal(pending.status, 'pending');
  await reservePublication(ledger, { id: 'window', messages: 0, bytes: 50000000 });
  assert.equal((await limitsFor(ledger, 'publication')).state, 'paused');
  await assert.rejects(reservePublication(ledger, { id: 'more', messages: 0, bytes: 1 }), (error) => error.status === 429);
});

test('home access expires, native login stays unverified, and stdio rejects an unknown protocol', async (t) => {
  const clock = { now: Date.parse(AT) };
  const listeners = [];
  const context = {
    now: () => clock.now,
    interfaces: () => [{ name: 'Ethernet', address: '10.8.0.8', netmask: '255.255.255.0', internal: false }],
    listen: (address) => new Promise((resolve, reject) => {
      const server = createServer((socket) => socket.destroy());
      listeners.push(server);
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve({
        address: address.address,
        netmask: address.netmask,
        port: server.address().port,
        close: () => new Promise((done) => server.close(() => done())),
      }));
    }),
    credentials: createCredentialStore({ now: () => clock.now }),
    schedule: (fn) => ({ fn, cleared: false }),
    bus: { emit() {} },
  };
  t.after(() => Promise.all(listeners.map((server) => new Promise((resolve) => server.close(() => resolve())))));
  const opened = await openHome(context);
  clock.now += 43200000;
  await assert.rejects(() => exchange(context, { key: opened.key }, '10.8.0.9'), { code: 'home_expired' });
  const reports = await probeClients({ env: { PATH: '' }, platform: 'win32' });
  assert.equal(reports.claude.nativeSupport, false);
  assert.equal(reports.codex.nativeSupport, false);
  assert.equal(reports.cursor.nativeSupport, false);
  const adapter = createNativeAdapter('claude', { verifiedLogin: false });
  await assert.rejects(() => adapter.create({}), { code: 'client_unavailable' });
  const relay = await makeCoreFixture();
  t.after(() => dispose(relay));
  const mindPath = await makeRelayMind(relay.root);
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  const server = serveRelayMcp({ mindPath, hostname: 'RELAYTEST', client: 'codex', sessionId: 'instance-a', stdin, stdout, stderr: new PassThrough() });
  stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'future-version' } })}\n`);
  await server;
  const line = JSON.parse(Buffer.concat(chunks).toString('utf8').trim().split('\n')[0]);
  assert.equal(line.error.code, -32602);
  const fixtureService = await makeCoreFixture();
  t.after(() => dispose(fixtureService));
  const serviceOrigin = path.join(fixtureService.root, 'origin');
  await mkdir(serviceOrigin, { recursive: true });
  const guard = createServer();
  const guardPort = await new Promise((resolve) => guard.listen(0, '127.0.0.1', () => resolve(guard.address().port)));
  await new Promise((resolve) => guard.close(() => resolve()));
  const handle = await startService({
    store: fixtureService.store,
    paths: { ...fixtureService.paths, origin: serviceOrigin },
    now: () => fixtureService.clock.now,
    userKey: 'integration-user',
    guardPort,
    listener: async () => ({ close: async () => {} }),
  });
  assert.equal(handle.beat.state, 'running');
  assert.equal(handle.attached ?? false, false);
  const stopped = await stopService(handle);
  assert.equal(stopped.stopped, true);
  assert.deepEqual(stopped.signaled, []);
  const routes = routeTable();
  assert.equal(routes.some((route) => route.handler === 'unavailable'), false);
  for (const required of ['/view', '/units', '/chats', '/tasks', '/approvals', '/blueprint/boards', '/void/texts', '/watch', '/settings', '/auth/local', '/events']) {
    assert.equal(routes.some((route) => route.template === required), true);
  }
});
