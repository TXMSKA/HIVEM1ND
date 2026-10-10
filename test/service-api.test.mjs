import { mkdir, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeCore } from '../engine/service/service.mjs';
import { writeBeat } from '../engine/service/service.mjs';
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
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { body: {} });
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
  const future = await call(core.http.port, 'POST', '/api/v1/watch', {
    token,
    body: {},
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(future.status, 503);
  assert.equal(future.json.error.code, 'service_unavailable');
  const asset = await call(core.http.port, 'GET', '/api/v1/editors/board/assets/missing', { token });
  assert.equal(asset.status, 503);
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
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { body: {} });
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
