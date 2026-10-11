import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addScreen, newSketch, rectangleNode } from '../features/blueprint/review/sketch-format.mjs';
import { approvalRevision } from '../engine/service/approvals.mjs';
import { createNativeAdapter } from '../engine/service/adapters.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { writeBeat } from '../engine/service/service.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { routeTable } from '../engine/service/http.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function boot(t, { assetDir = null } = {}) {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  const paths = { ...fixture.paths, origin };
  const core = await composeCore({
    store: fixture.store,
    paths,
    now: () => fixture.clock.now,
    assetDir,
    projects: [],
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: {} });
  assert.equal(local.status, 200);
  return { fixture, core, paths, token: local.json.token, viewerId: local.json.viewerId };
}

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

test('implemented routes succeed and future routes stay unavailable', async (t) => {
  const { fixture, core, paths, token } = await boot(t);
  const units = await call(core.http.port, 'GET', '/api/v1/units', { token });
  assert.equal(units.status, 200);
  assert.deepEqual(units.json.data.items, []);
  assert.ok(Array.isArray(units.json.data.issues));
  const view = await call(core.http.port, 'GET', '/api/v1/view', { token });
  assert.equal(view.status, 200);
  assert.equal(view.json.meta.requestId.length > 0, true);
  assert.equal(view.json.contract, 'hivem1nd-gui-v3');
  assert.equal(typeof view.json.meta.readAt, 'string');
  assert.equal(typeof view.json.meta.eventCursor, 'string');
  assert.equal(view.json.meta.sync, null);
  await writeBeat({ store: fixture.store, paths, now: () => fixture.clock.now }, 'running');
  const created = await call(core.http.port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.unit, 'builder');
  const listed = await call(core.http.port, 'GET', '/api/v1/units', { token });
  assert.equal(listed.json.data.items.some((item) => item.unit === 'builder'), true);
  const future = await call(core.http.port, 'POST', '/mcp', {
    token,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    headers: { accept: 'application/json, text/event-stream' },
  });
  assert.equal(future.status, 403);
  assert.equal(future.json.error.code, 'forbidden');
  const asset = await call(core.http.port, 'GET', '/api/v1/editors/board/assets/missing', { token });
  assert.equal(asset.status, 404);
  assert.equal(asset.json.error.code, 'not_found');
  assert.equal(asset.raw.includes('board'), false);
});

test('method, query, path and body boundaries fail closed', async (t) => {
  const { core, token } = await boot(t);
  const method = await call(core.http.port, 'PUT', '/api/v1/units', { token, body: {} });
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, 'GET, POST');
  const repeated = await call(core.http.port, 'GET', '/api/v1/units?limit=1&limit=2', { token });
  assert.equal(repeated.status, 422);
  assert.equal(repeated.json.error.code, 'invalid_query');
  const unknown = await call(core.http.port, 'GET', '/api/v1/units?extra=1', { token });
  assert.equal(unknown.status, 422);
  const encoded = await call(core.http.port, 'GET', '/api/v1/units/%2e%2e', { token });
  assert.equal(encoded.status, 422);
  assert.equal(encoded.json.error.code, 'invalid_path');
  const plain = await new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: core.http.port,
      method: 'PATCH',
      path: '/api/v1/settings',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        authorization: `Bearer ${token}`,
        'content-type': 'text/plain',
        'idempotency-key': randomUUID(),
        'content-length': '4',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end('nope');
  });
  assert.equal(plain.status, 415);
  const missingKey = await call(core.http.port, 'PATCH', '/api/v1/settings', { token, body: { language: 'es' } });
  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.json.error.code, 'idempotency_required');
  const extra = await call(core.http.port, 'PATCH', '/api/v1/settings', {
    token,
    body: { language: 'es', token: 'super-secret-token' },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(extra.status, 422);
  assert.equal(extra.raw.includes('super-secret-token'), false);
  const bodied = await new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: core.http.port,
      method: 'GET',
      path: '/api/v1/units',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-length': '2',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(bodied, 422);
  const mcp = await call(core.http.port, 'GET', '/mcp');
  assert.equal(mcp.status, 405);
  assert.equal(mcp.headers.allow, 'POST');
});

test('receipts replay the same response and reject a different route', async (t) => {
  const { core, token } = await boot(t);
  const key = randomUUID();
  const first = await call(core.http.port, 'PATCH', '/api/v1/settings', {
    token,
    body: { language: 'es' },
    headers: { 'idempotency-key': key },
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.data.settings.language, 'es');
  const again = await call(core.http.port, 'PATCH', '/api/v1/settings', {
    token,
    body: { language: 'es' },
    headers: { 'idempotency-key': key },
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.meta.replayed, true);
  assert.equal(again.json.data.settings.language, 'es');
  const other = await call(core.http.port, 'PATCH', '/api/v1/layout', {
    token,
    body: { groups: { 'env:shop': { x: 0, y: 0 } } },
    headers: { 'idempotency-key': key },
  });
  assert.equal(other.status, 409);
  assert.equal(other.json.error.code, 'idempotency_conflict');
});

test('phone writes are rejected and static absence leaves the API usable', async (t) => {
  const { fixture, core, token } = await boot(t);
  const phone = core.credentials.issue({
    audience: 'phone',
    expiresAt: new Date(fixture.clock.now + 60_000).toISOString(),
  });
  const denied = await call(core.http.port, 'POST', '/api/v1/units', {
    token: phone.token,
    body: { unit: 'phone', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(denied.status, 403);
  const missing = await call(core.http.port, 'GET', '/');
  assert.equal(missing.status, 503);
  const still = await call(core.http.port, 'GET', '/api/v1/tasks', { token });
  assert.equal(still.status, 200);
  const traversal = await call(core.http.port, 'GET', '/app/../package.json');
  assert.equal(traversal.status, 404);
  const assetDir = path.join(fixture.root, 'shell');
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, 'index.html'), '<!doctype html><title>HIVEM1ND</title>');
  const hosted = await composeCore({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    assetDir,
  });
  t.after(() => hosted.http.close());
  const page = await call(hosted.http.port, 'GET', '/');
  assert.equal(page.status, 200);
  assert.equal(page.raw.includes('HIVEM1ND'), true);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['x-frame-options'], 'DENY');
  const style = await call(hosted.http.port, 'GET', '/app/styles.css');
  assert.equal(style.status, 503);
});

test('event streams replay from a cursor without leaking credentials', async (t) => {
  const { core, token } = await boot(t);
  const opened = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('event stream timed out')), 2000);
    const req = request({
      host: '127.0.0.1',
      port: core.http.port,
      method: 'GET',
      path: '/api/v1/events',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let raw = '';
      const finish = () => {
        clearTimeout(timer);
        resolve({ req, status: res.statusCode, raw });
      };
      res.on('data', (chunk) => {
        raw += chunk.toString('utf8');
        if (raw.includes('event: stream.ready')) finish();
      });
      res.on('end', finish);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(opened.raw.includes(token), false);
  const cursor = /"cursor":"([^"]+)"/.exec(opened.raw)?.[1];
  assert.equal(typeof cursor, 'string');
  core.bus.emit({ name: 'service.changed', data: { state: 'running' } });
  const replay = await new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: core.http.port,
      method: 'GET',
      path: '/api/v1/events',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        authorization: `Bearer ${token}`,
        'last-event-id': cursor,
      },
    }, (res) => {
      let raw = '';
      const finish = () => resolve(raw || `status ${res.statusCode}`);
      res.on('data', (chunk) => {
        raw += chunk.toString('utf8');
        if (raw.includes('event: stream.ready')) finish();
      });
      res.on('end', finish);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(replay.includes('event: service.changed'), true);
  opened.req.destroy();
  const loggedOut = await call(core.http.port, 'POST', '/api/v1/auth/logout', { token });
  assert.equal(loggedOut.status, 204);
  const after = await call(core.http.port, 'GET', '/api/v1/units', { token });
  assert.equal(after.status, 401);
});

test('home enable is memory-only and loopback cannot exchange it', async (t) => {
  const fixture = await makeCoreFixture();
  const listeners = [];
  const core = await composeCore({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    interfaces: () => [{ name: 'Ethernet', address: '10.0.0.8', netmask: '255.255.255.0', internal: false }],
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
  });
  t.after(async () => {
    await core.http.close();
    await Promise.all(listeners.map((server) => new Promise((resolve) => server.close(() => resolve()))));
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: {} });
  const key = randomUUID();
  const opened = await call(core.http.port, 'POST', '/api/v1/settings/home-network', {
    token: local.json.token,
    body: { enabled: true },
    headers: { 'idempotency-key': key },
  });
  assert.equal(opened.status, 201);
  assert.equal(typeof opened.json.data.key, 'string');
  const again = await call(core.http.port, 'POST', '/api/v1/settings/home-network', {
    token: local.json.token,
    body: { enabled: true },
    headers: { 'idempotency-key': key },
  });
  assert.equal(again.json.meta.replayed, true);
  assert.equal(again.json.data.key, opened.json.data.key);
  const exchanged = await call(core.http.port, 'POST', '/api/v1/auth/home', { body: { key: opened.json.data.key } });
  assert.equal(exchanged.status, 403);
  assert.equal(JSON.stringify(opened.json.error ?? {}).includes(opened.json.data.key), false);
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function expectStatus(response, status, label) {
  assert.equal(response.status, status, `${label} ${JSON.stringify(response.json ?? response.raw)}`);
}

function sketch(id, title) {
  const document = newSketch(id, title);
  addScreen(document, { title: 'Bag', x: 0, y: 0 });
  return document;
}

test('every contract route has a success result and an authority or boundary failure', async (t) => {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  const localPath = path.join(fixture.paths.localDirectory, 'shop');
  await mkdir(origin, { recursive: true });
  await mkdir(localPath, { recursive: true });
  const paths = { ...fixture.paths, origin };
  const transcript = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"hivem1nd","title":"HIVEM1ND","version":"3.0.0"}}}',
    '{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"C:/work","model":"strong"}}',
    '{"jsonrpc":"2.0","id":2,"result":{"thread":{"id":"thread-1"}}}',
  ];
  const core = await composeCore({
    store: fixture.store,
    paths,
    now: () => fixture.clock.now,
    projects: [{ name: 'shop', localPath }],
    adapters: { codex: createNativeAdapter('codex', { fixture: true, transcript, models: ['strong'] }) },
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const port = core.http.port;
  const local = await call(port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: {} });
  expectStatus(local, 200, 'auth local');
  const token = local.json.token;
  const seen = new Set(['POST /auth/local']);
  const hit = (method, template) => seen.add(`${method} ${template}`);
  await writeBeat({ store: fixture.store, paths, now: () => fixture.clock.now }, 'running');

  for (const template of ['/view', '/units', '/leads', '/squads', '/projects', '/machines', '/sync', '/sessions', '/layout', '/settings', '/chats', '/mailboxes', '/approvals', '/tasks', '/waiting']) {
    const response = await call(port, 'GET', `/api/v1${template}`, { token });
    expectStatus(response, 200, template);
    hit('GET', template);
  }
  const homeDenied = await call(port, 'POST', '/api/v1/auth/home', { body: { key: 'not-a-grant' } });
  expectStatus(homeDenied, 403, 'auth home');
  hit('POST', '/auth/home');

  const created = await call(port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(created, 201, 'create builder');
  hit('POST', '/units');
  const executor = await call(port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'executor', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(executor, 201, 'create executor');
  const missing = await call(port, 'GET', '/api/v1/units/root:missing', { token });
  expectStatus(missing, 404, 'missing unit');
  const executorDetail = await call(port, 'GET', '/api/v1/units/root:executor', { token });
  expectStatus(executorDetail, 200, 'unit detail');
  hit('GET', '/units/:unitId');
  const page = await call(port, 'GET', '/api/v1/units?limit=1', { token });
  expectStatus(page, 200, 'unit page');
  const third = await call(port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'reviewer', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(third, 201, 'create reviewer');
  const raced = await call(port, 'GET', `/api/v1/units?limit=1&cursor=${encodeURIComponent(page.json.data.nextCursor)}`, { token });
  expectStatus(raced, 409, 'cursor');
  assert.equal(raced.json.error.code, 'cursor_expired');

  const connected = await call(port, 'PUT', '/api/v1/units/root:executor/lead', {
    token,
    body: { confirmed: true, leadId: 'root:builder', expectedRevision: executorDetail.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(connected, 200, 'connect lead');
  hit('PUT', '/units/:unitId/lead');
  const led = await call(port, 'GET', '/api/v1/units/root:executor', { token });
  const started = await call(port, 'POST', '/api/v1/units/root:executor/session', {
    token,
    body: { client: 'codex', model: 'strong', expectedRevision: led.json.data.revision, prompt: 'Say ok.' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(started, 202, 'start session');
  assert.equal(started.json.data.result.state, 'started');
  hit('POST', '/units/:unitId/session');
  const requestId = started.json.data.request.id;
  const sessionId = started.json.data.result.sessionId;
  const requestDetail = await call(port, 'GET', `/api/v1/session-requests/${requestId}`, { token });
  expectStatus(requestDetail, 200, 'session request');
  assert.equal(requestDetail.json.data.request.id, requestId);
  hit('GET', '/session-requests/:requestId');
  const sessions = await call(port, 'GET', '/api/v1/sessions', { token });
  assert.equal(sessions.json.data.items.some((item) => item.id === sessionId), true);
  const stopped = await call(port, 'POST', `/api/v1/sessions/${sessionId}/stop`, {
    token,
    body: { confirmed: true },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(stopped, 200, 'stop session');
  assert.equal(stopped.json.data.state, 'stopped');
  hit('POST', '/sessions/:sessionId/stop');

  const currentLayout = await call(port, 'GET', '/api/v1/layout', { token });
  const layout = await call(port, 'PATCH', '/api/v1/layout', {
    token,
    body: { groups: { 'project:shop': { x: 1, y: 2 } }, expectedRevision: currentLayout.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(layout, 200, 'layout');
  hit('PATCH', '/layout');
  const chat = await call(port, 'POST', '/api/v1/chats', {
    token,
    body: { members: ['root:builder'], title: 'Release' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(chat, 201, 'chat');
  hit('POST', '/chats');
  const chatId = chat.json.data.chat.id;
  const chatDetail = await call(port, 'GET', `/api/v1/chats/${chatId}`, { token });
  expectStatus(chatDetail, 200, 'chat detail');
  hit('GET', '/chats/:chatId');
  const posted = await call(port, 'POST', `/api/v1/chats/${chatId}/messages`, {
    token,
    body: { body: 'Ship the notes.' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(posted, 201, 'chat message');
  hit('POST', '/chats/:chatId/messages');
  const messages = await call(port, 'GET', `/api/v1/chats/${chatId}/messages`, { token });
  expectStatus(messages, 200, 'chat messages');
  hit('GET', '/chats/:chatId/messages');
  const read = await call(port, 'POST', `/api/v1/chats/${chatId}/read`, {
    token,
    body: { messageIds: [posted.json.data.message.id] },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(read, 200, 'chat read');
  hit('POST', '/chats/:chatId/read');
  const chatNow = await call(port, 'GET', `/api/v1/chats/${chatId}`, { token });
  const pinned = await call(port, 'PATCH', `/api/v1/chats/${chatId}`, {
    token,
    body: { pinned: true, expectedRevision: chatNow.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(pinned, 200, 'patch chat');
  hit('PATCH', '/chats/:chatId');

  const mailed = await call(port, 'POST', '/api/v1/mailboxes/root:master/messages', {
    token,
    body: { body: 'A note for master.' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(mailed, 201, 'mailbox post');
  hit('POST', '/mailboxes/:unitId/messages');
  const mailbox = await call(port, 'GET', '/api/v1/mailboxes/root:master/messages', { token });
  expectStatus(mailbox, 200, 'mailbox list');
  hit('GET', '/mailboxes/:unitId/messages');
  const messageId = mailed.json.data.message.id;
  const message = await call(port, 'GET', `/api/v1/mailboxes/root:master/messages/${messageId}`, { token });
  expectStatus(message, 200, 'mailbox detail');
  hit('GET', '/mailboxes/:unitId/messages/:messageId');
  const mailboxRead = await call(port, 'POST', '/api/v1/mailboxes/root:master/read', {
    token,
    body: { messageIds: [messageId] },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(mailboxRead, 200, 'mailbox read');
  hit('POST', '/mailboxes/:unitId/read');

  const agent = core.credentials.issue({
    audience: 'agent',
    unitId: 'root:executor',
    sessionId: randomUUID(),
    capabilities: ['approval.request', 'read', 'chat.post'],
    expiresAt: '2027-01-01T00:00:00.000Z',
  });
  const requested = await call(port, 'POST', '/api/v1/approvals/request', {
    token: agent.token,
    body: {
      action: 'file.write',
      pattern: { resource: 'notes', path: 'docs/notes.txt' },
      display: 'Write the notes',
      alwaysAllowed: true,
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(requested, 202, 'approval request');
  hit('POST', '/approvals/request');
  const approvalId = requested.json.data.approval.id;
  const pending = await call(port, 'GET', '/api/v1/approvals?unitId=root:executor', { token });
  assert.equal(pending.json.data.items.some((item) => item.id === approvalId), true);
  const approval = await call(port, 'GET', `/api/v1/approvals/${approvalId}`, { token });
  expectStatus(approval, 200, 'approval detail');
  hit('GET', '/approvals/:approvalId');
  const requestBytes = await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'approvals', approvalId, 'request.json'));
  const answered = await call(port, 'POST', `/api/v1/approvals/${approvalId}/answer`, {
    token,
    body: { decision: 'approve-always', expectedRevision: approvalRevision({ request: requestBytes, answers: [] }) },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(answered, 200, 'approval answer');
  assert.equal(typeof answered.json.data.grantId, 'string');
  hit('POST', '/approvals/:approvalId/answer');
  const answer = await call(port, 'GET', `/api/v1/approvals/${approvalId}/answers/${answered.json.data.answerId}`, { token });
  expectStatus(answer, 200, 'answer detail');
  assert.equal(answer.json.data.state, 'applied');
  hit('GET', '/approvals/:approvalId/answers/:answerId');
  const grants = await call(port, 'GET', '/api/v1/units/root:executor/approval-grants', { token });
  expectStatus(grants, 200, 'grants');
  assert.equal(grants.json.data.items.some((item) => item.id === answered.json.data.grantId), true);
  hit('GET', '/units/:unitId/approval-grants');
  const grantedUnit = await call(port, 'GET', '/api/v1/units/root:executor', { token });
  const revoked = await call(port, 'DELETE', `/api/v1/units/root:executor/approval-grants/${answered.json.data.grantId}`, {
    token,
    body: { expectedRevision: grantedUnit.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(revoked, 200, 'revoke');
  assert.equal(revoked.json.data.state, 'revoked');
  hit('DELETE', '/units/:unitId/approval-grants/:grantId');
  const revocation = await call(port, 'GET', `/api/v1/grant-revocations/${revoked.json.data.requestId}`, { token });
  expectStatus(revocation, 200, 'revocation');
  assert.equal(revocation.json.data.state, 'revoked');
  hit('GET', '/grant-revocations/:requestId');

  const taskId = 'project:shop:029';
  await mkdir(path.join(fixture.paths.mind, 'user', 'tasks'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'tasks', '029.md'), `id: ${taskId}\r\ntitle: Review me\r\nstatus: open\r\nfrom: user\r\nto-id: root:builder\r\ndate: 2026-10-10\r\n\r\n## Request\r\nKeep this request.\r\n\r\n## Report\r\nExisting report.\r\n`);
  const task = await call(port, 'GET', `/api/v1/tasks/${taskId}`, { token });
  expectStatus(task, 200, 'task');
  hit('GET', '/tasks/:taskId');
  const reviewed = await call(port, 'POST', `/api/v1/tasks/${taskId}/status`, {
    token,
    body: { status: 'review', expectedRevision: task.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(reviewed, 200, 'task review');
  hit('POST', '/tasks/:taskId/status');
  const undone = await call(port, 'POST', `/api/v1/tasks/${taskId}/undo`, {
    token,
    body: { expectedRevision: reviewed.json.data.body.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(undone, 200, 'task undo');
  assert.equal(undone.json.data.body.status, 'open');
  hit('POST', '/tasks/:taskId/undo');

  const settings = await call(port, 'PATCH', '/api/v1/settings', {
    token,
    body: { language: 'es' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(settings, 200, 'settings');
  hit('PATCH', '/settings');
  const home = await call(port, 'POST', '/api/v1/settings/home-network', {
    token,
    body: { enabled: false },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(home, 200, 'home');
  hit('POST', '/settings/home-network');

  const staleDocument = sketch('stale', 'Stale');
  const staleBoard = await call(port, 'POST', '/api/v1/blueprint/boards', {
    token,
    body: { project: 'shop', document: staleDocument },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(staleBoard, 201, 'stale board');
  const staleFile = path.join(localPath, 'docs', 'flows', 'boards', 'stale.json');
  const external = Buffer.from((await readFile(staleFile, 'utf8')).replace('Stale', 'External'));
  await writeFile(staleFile, external);
  const conflict = await call(port, 'PUT', `/api/v1/blueprint/boards/${staleBoard.json.data.id}`, {
    token,
    body: { document: staleDocument, expectedRevision: staleBoard.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(conflict, 409, 'stale board write');
  assert.equal(await readFile(staleFile, 'utf8'), external.toString('utf8'));

  const document = sketch('cart', 'Cart');
  const board = await call(port, 'POST', '/api/v1/blueprint/boards', {
    token,
    body: { project: 'shop', document },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(board, 201, 'board');
  hit('POST', '/blueprint/boards');
  const boardId = board.json.data.id;
  const listedBoards = await call(port, 'GET', '/api/v1/blueprint/boards', { token });
  expectStatus(listedBoards, 200, 'boards');
  hit('GET', '/blueprint/boards');
  const boardDetail = await call(port, 'GET', `/api/v1/blueprint/boards/${boardId}`, { token });
  expectStatus(boardDetail, 200, 'board detail');
  hit('GET', '/blueprint/boards/:resourceId');
  const renamed = structuredClone(board.json.data.document);
  renamed.title = 'Cart two';
  const replaced = await call(port, 'PUT', `/api/v1/blueprint/boards/${boardId}`, {
    token,
    body: { document: renamed, expectedRevision: board.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(replaced, 200, 'replace board');
  hit('PUT', '/blueprint/boards/:resourceId');
  const screen = replaced.json.data.document.screens[0];
  const added = await call(port, 'POST', `/api/v1/blueprint/boards/${boardId}/nodes`, {
    token,
    body: {
      parentId: screen.root.id,
      node: rectangleNode(replaced.json.data.document, { x: 2, y: 2, w: 12, h: 12 }, { stroke: '#111111', fill: 'none' }),
      expectedRevision: replaced.json.data.revision,
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(added, 201, 'add node');
  hit('POST', '/blueprint/boards/:resourceId/nodes');
  const updated = await call(port, 'PATCH', `/api/v1/blueprint/boards/${boardId}/nodes/${added.json.data.nodeId}`, {
    token,
    body: { changes: { name: 'Tile' }, expectedRevision: added.json.data.editor.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(updated, 200, 'update node');
  hit('PATCH', '/blueprint/boards/:resourceId/nodes/:nodeId');
  const removed = await call(port, 'DELETE', `/api/v1/blueprint/boards/${boardId}/nodes/${added.json.data.nodeId}`, {
    token,
    body: { expectedRevision: updated.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(removed, 200, 'remove node');
  hit('DELETE', '/blueprint/boards/:resourceId/nodes/:nodeId');
  const extra = sketch('extra', 'Extra');
  const extraFile = path.join(localPath, 'docs', 'flows', 'boards', 'extra.json');
  await mkdir(path.dirname(extraFile), { recursive: true });
  await writeFile(extraFile, `${JSON.stringify(extra)}\n`);
  const registered = await call(port, 'POST', '/api/v1/editors/register', {
    token,
    body: { project: 'shop', path: 'docs/flows/boards/extra.json', kind: 'blueprint' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(registered, 201, 'register');
  hit('POST', '/editors/register');
  const attachments = await call(port, 'GET', `/api/v1/editors/${boardId}/attachments`, { token });
  expectStatus(attachments, 200, 'attachments');
  hit('GET', '/editors/:resourceId/attachments');
  const attached = await call(port, 'PUT', `/api/v1/editors/${boardId}/attachments`, {
    token,
    body: { attached: ['root:builder'], expectedRevision: attachments.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(attached, 200, 'write attachments');
  hit('PUT', '/editors/:resourceId/attachments');
  const freshBoard = await call(port, 'GET', `/api/v1/blueprint/boards/${boardId}`, { token });
  const boardComments = await call(port, 'GET', `/api/v1/editors/${boardId}/comments`, { token });
  const commented = await call(port, 'POST', `/api/v1/editors/${boardId}/comments`, {
    token,
    body: {
      text: 'Check the bag',
      expectedRevision: freshBoard.json.data.revision,
      expectedCommentsRevision: boardComments.json.data.commentsRevision,
      anchor: { screen: freshBoard.json.data.document.screens[0].id, label: 'Bag' },
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(commented, 201, 'comment');
  hit('POST', '/editors/:resourceId/comments');
  const commentList = await call(port, 'GET', `/api/v1/editors/${boardId}/comments`, { token });
  expectStatus(commentList, 200, 'comments');
  hit('GET', '/editors/:resourceId/comments');
  const replied = await call(port, 'POST', `/api/v1/editors/${boardId}/comments/${commented.json.data.thread.id}/replies`, {
    token,
    body: { text: 'Checked', expectedCommentsRevision: commented.json.data.commentsRevision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(replied, 200, 'reply');
  hit('POST', '/editors/:resourceId/comments/:threadId/replies');
  const resolved = await call(port, 'PATCH', `/api/v1/editors/${boardId}/comments/${commented.json.data.thread.id}`, {
    token,
    body: { status: 'resolved', expectedCommentsRevision: replied.json.data.commentsRevision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(resolved, 200, 'resolve');
  hit('PATCH', '/editors/:resourceId/comments/:threadId');
  const asset = await call(port, 'POST', `/api/v1/editors/${boardId}/assets`, {
    token,
    body: { data: PNG.toString('base64') },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(asset, 201, 'asset');
  hit('POST', '/editors/:resourceId/assets');
  const assetId = asset.json.data.src.slice('assets/'.length);
  const assetRead = await call(port, 'GET', `/api/v1/editors/${boardId}/assets/${assetId}`, { token });
  expectStatus(assetRead, 200, 'asset read');
  assert.equal(assetRead.raw.includes('secret'), false);
  hit('GET', '/editors/:resourceId/assets/:assetId');

  const text = await call(port, 'POST', '/api/v1/void/texts', {
    token,
    body: {
      project: 'shop',
      path: 'docs/release.json',
      document: { title: 'Release notes', rev: 0, pages: [{ k: 'Intro.Welcome', en: 'Hello there', es: 'Hola' }] },
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(text, 201, 'text');
  hit('POST', '/void/texts');
  const texts = await call(port, 'GET', '/api/v1/void/texts', { token });
  expectStatus(texts, 200, 'texts');
  hit('GET', '/void/texts');
  const textId = text.json.data.id;
  const textDetail = await call(port, 'GET', `/api/v1/void/texts/${textId}`, { token });
  expectStatus(textDetail, 200, 'text detail');
  hit('GET', '/void/texts/:resourceId');
  const textComments = await call(port, 'GET', `/api/v1/editors/${textId}/comments`, { token });
  const textComment = await call(port, 'POST', `/api/v1/editors/${textId}/comments`, {
    token,
    body: {
      text: 'Clarify',
      expectedRevision: text.json.data.revision,
      expectedCommentsRevision: textComments.json.data.commentsRevision,
      anchor: { k: 'Intro.Welcome', lang: 'en', start: 0, end: 5, quote: 'Hello' },
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(textComment, 201, 'text comment');
  const proposed = await call(port, 'POST', `/api/v1/void/texts/${textId}/ranges`, {
    token,
    body: {
      k: 'Intro.Welcome', lang: 'en', start: 0, end: 5, expectedText: 'Hello', replacement: 'Hi',
      expectedRevision: text.json.data.revision, mode: 'propose', threadId: textComment.json.data.thread.id,
      expectedCommentsRevision: textComment.json.data.commentsRevision,
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(proposed, 200, 'propose');
  hit('POST', '/void/texts/:resourceId/ranges');
  const proposals = await call(port, 'GET', `/api/v1/void/texts/${textId}/proposals`, { token });
  expectStatus(proposals, 200, 'proposals');
  hit('GET', '/void/texts/:resourceId/proposals');
  const accepted = await call(port, 'POST', `/api/v1/void/texts/${textId}/proposals/${proposed.json.data.proposal.id}/answer`, {
    token,
    body: { decision: 'accept', expectedRevision: text.json.data.revision, expectedCommentsRevision: proposed.json.data.proposal.commentsRevision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(accepted, 200, 'accept proposal');
  hit('POST', '/void/texts/:resourceId/proposals/:proposalId/answer');
  const rewritten = structuredClone(accepted.json.data.editor.document);
  rewritten.title = 'Notes';
  const savedText = await call(port, 'PUT', `/api/v1/void/texts/${textId}`, {
    token,
    body: { document: rewritten, expectedRevision: accepted.json.data.editor.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(savedText, 200, 'replace text');
  hit('PUT', '/void/texts/:resourceId');

  const watch = await call(port, 'POST', '/api/v1/watch', {
    token,
    body: { unitId: 'root:master' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(watch, 200, 'watch');
  hit('POST', '/watch');
  const unwatch = await call(port, 'DELETE', `/api/v1/watch/${watch.json.data.watchId}`, { token, body: {}, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(unwatch, 204, 'unwatch');
  hit('DELETE', '/watch/:watchId');
  const viewer = await call(port, 'GET', '/api/v1/viewer', { token });
  expectStatus(viewer, 200, 'viewer');
  hit('GET', '/viewer');
  const patchedViewer = await call(port, 'PATCH', '/api/v1/viewer', {
    token,
    body: { presentation: 'focus' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(patchedViewer, 200, 'patch viewer');
  hit('PATCH', '/viewer');
  const mcp = await call(port, 'POST', '/mcp', {
    token: agent.token,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    headers: { accept: 'application/json, text/event-stream' },
  });
  expectStatus(mcp, 200, 'mcp');
  const mcpDenied = await call(port, 'GET', '/mcp');
  expectStatus(mcpDenied, 405, 'mcp method');

  const phone = core.credentials.issue({ audience: 'phone', unitId: 'root:master', expiresAt: '2027-01-01T00:00:00.000Z' });
  const phoneDenied = await call(port, 'POST', '/api/v1/units', {
    token: phone.token,
    body: { unit: 'phone', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(phoneDenied, 403, 'phone unit');
  const agentDenied = await call(port, 'POST', '/api/v1/watch', {
    token: agent.token,
    body: { unitId: 'root:executor' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(agentDenied, 403, 'agent watch');
  const agentSettings = await call(port, 'PATCH', '/api/v1/settings', {
    token: agent.token,
    body: { language: 'en' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(agentSettings, 403, 'agent settings');

  const opened = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('event stream timed out')), 2000);
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: '/api/v1/events',
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, authorization: `Bearer ${token}` },
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
  hit('GET', '/events');
  const loggedOut = await call(port, 'POST', '/api/v1/auth/logout', { token });
  expectStatus(loggedOut, 204, 'logout');
  hit('POST', '/auth/logout');
  expectStatus(await call(port, 'GET', '/api/v1/units', { token }), 401, 'logged out');

  const required = routeTable().map((route) => `${route.method} ${route.template}`);
  const absent = required.filter((route) => !seen.has(route));
  assert.deepEqual(absent, []);
});

test('lan rejects desktop tokens and an agent cannot read the general mind', async (t) => {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  const core = await composeCore({
    store: fixture.store,
    paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now,
    projects: [],
    listenerKind: 'lan',
    bindAddress: '127.0.0.1',
    netmask: '255.255.255.255',
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: {} });
  assert.equal(local.status, 403);
  const desktop = core.credentials.issue({ audience: 'desktop', capabilities: ['read', 'unit.create'], expiresAt: '2027-01-01T00:00:00.000Z' });
  const phone = core.credentials.issue({ audience: 'phone', expiresAt: '2027-01-01T00:00:00.000Z' });
  const denied = await call(core.http.port, 'GET', '/api/v1/units', { token: desktop.token });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error.code, 'forbidden');
  const listed = await call(core.http.port, 'GET', '/api/v1/units', { token: phone.token });
  assert.equal(listed.status, 200);
  const write = await call(core.http.port, 'POST', '/api/v1/units', {
    token: phone.token,
    body: { unit: 'phone', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(write.status, 403);
  assert.equal(write.json.error.code, 'phone_read_only');
  await core.http.close();
  const loop = await composeCore({
    store: fixture.store,
    paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now,
    projects: [],
  });
  t.after(async () => loop.http.close());
  const agent = loop.credentials.issue({ audience: 'agent', unitId: 'root:executor', capabilities: ['read'], expiresAt: '2027-01-01T00:00:00.000Z' });
  const general = await call(loop.http.port, 'GET', '/api/v1/units', { token: agent.token });
  assert.equal(general.status, 403);
  assert.equal(general.json.error.code, 'forbidden');
  const foreign = await call(loop.http.port, 'GET', '/api/v1/mailboxes/root:master/messages', { token: agent.token });
  assert.equal(foreign.status, 403);
});

test('agent streams hide other units and event frames carry ids', async (t) => {
  const { core, token } = await boot(t);
  const bus = createEventBus({ now: () => Date.now(), machine: 'DESKTOP' });
  const seen = [];
  const agent = { stableId: 'agent-1', audience: 'agent', unitId: 'root:executor', capabilities: ['read'], chatIds: [], resourceIds: [] };
  const subscriber = bus.subscribe(agent, {}, (frame) => seen.push(frame.name));
  bus.emit({ name: 'settings.changed', data: {} });
  bus.emit({ name: 'unit.changed', unitId: 'root:other', data: { unitId: 'root:other' } });
  bus.emit({ name: 'unit.changed', unitId: 'root:executor', data: { unitId: 'root:executor' } });
  bus.release(subscriber);
  assert.deepEqual(seen, ['unit.changed']);
  const opened = await new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: core.http.port,
      path: '/api/v1/events',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk.toString('utf8');
        if (raw.includes('event: stream.ready')) {
          req.destroy();
          resolve(raw);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
  assert.match(opened, /^id: [0-9a-f-]+:\d+$/im);
  assert.match(opened, /"cursor":/);
  assert.match(opened, /"capabilities":\[/);
});

test('the package exports the GUI host from the root and from ./gui', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '3.0.0');
  assert.equal(pkg.main, 'gui/index.mjs');
  assert.equal(pkg.exports['.'], './gui/index.mjs');
  assert.equal(pkg.exports['./gui'], './gui/index.mjs');
  const root = await import('../gui/index.mjs');
  assert.equal(typeof root.startGui, 'function');
  assert.equal(typeof root.closeGuiHost, 'function');
});

test('an oversized body returns body_too_large and the service keeps answering', async (t) => {
  const { core, token } = await boot(t);
  const port = core.http.port;
  const modest = await call(port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: 'DESKTOP', note: 'x'.repeat(1_100_000) },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.notEqual(modest.status, 413);
  const oversized = await call(port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: 'DESKTOP', note: 'x'.repeat(2_100_000) },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json.error.code, 'body_too_large');
  const board = await call(port, 'PUT', `/api/v1/blueprint/boards/${randomUUID()}`, {
    token,
    body: { expectedRevision: 'a'.repeat(64), document: { note: 'x'.repeat(2_100_000) } },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.notEqual(board.status, 413);
  const alive = await call(port, 'GET', '/api/v1/units', { token });
  assert.equal(alive.status, 200);
  assert.deepEqual(alive.json.data.items, []);
});
