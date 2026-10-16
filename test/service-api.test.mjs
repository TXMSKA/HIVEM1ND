import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addScreen, newSketch, rectangleNode } from '../features/blueprint/review/sketch-format.mjs';
import { approvalRevision } from '../engine/service/approvals.mjs';
import { createNativeAdapter } from '../engine/service/adapters.mjs';
import { eligibleAddresses } from '../engine/service/home.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { writeBeat } from '../engine/service/service.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { readContent, readMachineSettings } from '../engine/service/settings.mjs';
import { routeTable, serveEvents } from '../engine/service/http.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { withLocalChanges } from '../engine/service/store.mjs';
import { drainRunLaunches, callPlanTool } from '../engine/service/runs.mjs';

describe('service api', { concurrency: false }, () => {
async function boot(t, { assetDir = null, missingAssets = false } = {}) {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  const paths = { ...fixture.paths, origin };
  const core = await composeCore({
    store: fixture.store,
    paths,
    now: () => fixture.clock.now,
    assetDir: missingAssets ? path.join(fixture.root, 'absent-browser-shell') : assetDir,
    projects: [],
  });
  const cores = [core];
  t.after(async () => {
    for (const opened of cores.toReversed()) await opened.http.close();
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  assert.equal(local.status, 201);
  assert.equal(local.json.meta.sync, 'local');
  assert.equal(local.json.token, undefined);
  return { fixture, core, cores, paths, token: local.json.data.token, viewerId: local.json.data.viewerId };
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
  assert.equal(view.json.meta.sync, 'local');
  const settings = await call(core.http.port, 'GET', '/api/v1/settings', { token });
  assert.equal(settings.status, 200);
  assert.equal(settings.json.meta.sync, 'local');
  const viewer = await call(core.http.port, 'GET', '/api/v1/viewer', { token });
  assert.equal(viewer.status, 200);
  assert.equal(viewer.json.meta.sync, 'local');
  await writeBeat({ store: fixture.store, paths, now: () => fixture.clock.now }, 'running');
  const created = await call(core.http.port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.id, 'root:builder');
  assert.equal(created.json.data.unit, 'builder');
  assert.equal(created.json.data.role, 'executor');
  assert.equal(created.json.data.machine, fixture.machine);
  assert.equal(typeof created.json.data.revision, 'string');
  assert.equal(created.json.data.status, 'idle');
  assert.equal(created.json.meta.sync, 'pending');
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
  assert.equal(repeated.status, 400);
  assert.equal(repeated.json.error.code, 'invalid_query');
  assert.deepEqual(repeated.json.error.details, {});
  const collided = await call(core.http.port, 'GET', '/api/v1/units?limit=1&%6cimit=2', { token });
  assert.equal(collided.status, 400);
  assert.equal(collided.json.error.code, 'invalid_query');
  const unknown = await call(core.http.port, 'GET', '/api/v1/units?extra=1', { token });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error.code, 'invalid_query');
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
  assert.equal(plain.json.error.code, 'unsupported_media_type');
  const missingKey = await call(core.http.port, 'PATCH', '/api/v1/settings', { token, body: { language: 'es' } });
  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.json.error.code, 'idempotency_required');
  const extra = await call(core.http.port, 'PATCH', '/api/v1/settings', {
    token,
    body: { language: 'es', token: 'super-secret-token' },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(extra.status, 400);
  assert.equal(extra.json.error.code, 'unknown_field');
  assert.equal(extra.raw.includes('super-secret-token'), false);
  const malformed = await new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: core.http.port,
      method: 'PATCH',
      path: '/api/v1/settings',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        'content-length': '1',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end('{');
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.json.error.code, 'invalid_json');
  const anonymous = await call(core.http.port, 'GET', '/api/v1/units');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.json.error.code, 'invalid_session');
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
  assert.equal(again.json.meta.sync, first.json.meta.sync);
  assert.equal(first.json.meta.sync, 'pending');
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
  const { fixture, core, cores, token } = await boot(t, { missingAssets: true });
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
  const icon = await call(core.http.port, 'GET', '/mark.svg');
  assert.equal(icon.status, 200);
  assert.match(icon.headers['content-type'], /image\/svg\+xml/);
  assert.match(icon.raw, /<svg/);
  const appIcon = await call(core.http.port, 'GET', '/app/mark.svg');
  assert.equal(appIcon.status, 200);
  assert.match(appIcon.raw, /<svg/);
  const favicon = await call(core.http.port, 'GET', '/app/favicon.svg');
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers['content-type'], /image\/svg\+xml/);
  assert.match(favicon.raw, /<svg/);
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
  cores.push(hosted);
  const page = await call(hosted.http.port, 'GET', '/');
  assert.equal(page.status, 200);
  assert.equal(page.raw.includes('HIVEM1ND'), true);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['x-frame-options'], 'DENY');
  const style = await call(hosted.http.port, 'GET', '/app/styles.css');
  assert.equal(style.status, 503);
  const owned = '<svg xmlns="http://www.w3.org/2000/svg" id="owned-favicon"></svg>\n';
  await writeFile(path.join(assetDir, 'favicon.svg'), owned);
  const served = await call(hosted.http.port, 'GET', '/app/favicon.svg');
  assert.equal(served.status, 200);
  assert.match(served.headers['content-type'], /image\/svg\+xml/);
  assert.equal(served.raw, owned);
});

test('app serves the exact four local Atkinson fonts as WOFF2 and rejects other font paths', async t => {
  const { core } = await boot(t, { assetDir: path.resolve('gui/app') });
  const names = ['atkinson-400.woff2', 'atkinson-400-italic.woff2', 'atkinson-700.woff2', 'atkinson-700-italic.woff2'];
  for (const name of names) {
    const response = await fetch(`http://127.0.0.1:${core.http.port}/app/${name}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'font/woff2');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, await readFile(new URL(`../docs/flows/assets/${name}`, import.meta.url)));
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'wOF2');
  }
  for (const name of ['other.woff2', 'atkinson-500.woff2', 'atkinson-400.woff', 'OFL-atkinson.txt', '%252e%252e/atkinson-400.woff2', 'nested/atkinson-400.woff2']) {
    const response = await call(core.http.port, 'GET', `/app/${name}`);
    assert.equal(response.status, 404, name);
  }
  const { core: unpackaged } = await boot(t, { missingAssets: true });
  assert.equal((await call(unpackaged.http.port, 'GET', '/app/atkinson-400.woff2')).status, 503);
});

test('the start workflow serves its complete local module graph through the static allowlist', async t => {
  const { core } = await boot(t, { assetDir: path.resolve('gui/app') });
  for (const name of ['start-api.mjs', 'start-copy.mjs', 'cluster-geometry.mjs', 'clusters.mjs', 'add-api.mjs', 'add-view.mjs', 'add-controller.mjs']) {
    const response = await call(core.http.port, 'GET', `/app/${name}`);
    assert.equal(response.status, 200); assert.match(response.headers['content-type'], /javascript/);
    assert.equal(response.raw, await readFile(path.join('gui/app', name), 'utf8'));
  }
  assert.equal((await call(core.http.port, 'GET', '/app/cluster-links.json')).status, 404);
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

test('event streams release the cap on disconnect and keep a viewer watch', async (t) => {
  const { fixture, core, token } = await boot(t);
  const created = await call(core.http.port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(created.status, 201);
  const watched = await call(core.http.port, 'POST', '/api/v1/watch', {
    token,
    body: { unitId: 'root:builder' },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(watched.status, 200);
  const watchId = watched.json.data.watchId;
  const openStream = () => new Promise((resolve, reject) => {
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
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.resume();
        resolve({ req, status: res.statusCode });
        return;
      }
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk.toString('utf8');
        if (raw.includes('event: stream.ready')) {
          clearTimeout(timer);
          resolve({ req, status: res.statusCode });
        }
      });
    });
    req.on('error', (error) => {
      if (error.code === 'ECONNRESET') return;
      reject(error);
    });
    req.end();
  });
  const closeStream = (opened) => new Promise((resolve) => {
    opened.req.once('close', () => setImmediate(resolve));
    opened.req.destroy();
  });
  const held = [];
  for (let index = 0; index < 4; index += 1) {
    const opened = await openStream();
    assert.equal(opened.status, 200);
    held.push(opened);
  }
  const blocked = await call(core.http.port, 'GET', '/api/v1/events', { token });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error.code, 'request_rate_limited');
  for (const opened of held) await closeStream(opened);
  const again = await openStream();
  assert.equal(again.status, 200);
  const still = await call(core.http.port, 'DELETE', `/api/v1/watch/${watchId}`, {
    token,
    body: {},
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(still.status, 204);
  await closeStream(again);
});

test('unit, lead, layout and settings changes reach the running pulse', async (t) => {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  const paths = { ...fixture.paths, origin };
  const core = await composeCore({
    store: fixture.store,
    paths,
    now: () => fixture.clock.now,
    projects: [],
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const notified = [];
  const original = core.runtime.pulse.changed.bind(core.runtime.pulse);
  core.runtime.pulse.changed = async (ids) => {
    notified.push(...ids);
    return original(ids);
  };
  await writeBeat({ store: fixture.store, paths, now: () => fixture.clock.now }, 'running');
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  const token = local.json.data.token;
  const created = await call(core.http.port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'builder', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(created.status, 201);
  const detail = await call(core.http.port, 'GET', '/api/v1/units/root:builder', { token });
  const lead = await call(core.http.port, 'POST', '/api/v1/units', {
    token,
    body: { unit: 'lead', role: 'executor', scope: 'root', machine: fixture.machine },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(lead.status, 201);
  const connected = await call(core.http.port, 'PUT', '/api/v1/units/root:builder/lead', {
    token,
    body: { confirmed: true, leadId: 'root:lead', expectedRevision: detail.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(connected.status, 200);
  const layout = await call(core.http.port, 'GET', '/api/v1/layout', { token });
  const moved = await call(core.http.port, 'PATCH', '/api/v1/layout', {
    token,
    body: { nodes: { 'root:builder': { x: 1, y: 2 } }, expectedRevision: layout.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(moved.status, 200);
  const settings = await call(core.http.port, 'PATCH', '/api/v1/settings', {
    token,
    body: { language: 'es' },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(settings.status, 200);
  assert.equal(notified.length >= 4, true);
  assert.equal(notified.every((id) => typeof id === 'string' && id.length > 0), true);
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
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  const key = randomUUID();
  const opened = await call(core.http.port, 'POST', '/api/v1/settings/home-network', {
    token: local.json.data.token,
    body: { enabled: true },
    headers: { 'idempotency-key': key },
  });
  assert.equal(opened.status, 201);
  assert.equal(typeof opened.json.data.key, 'string');
  const again = await call(core.http.port, 'POST', '/api/v1/settings/home-network', {
    token: local.json.data.token,
    body: { enabled: true },
    headers: { 'idempotency-key': key },
  });
  assert.equal(again.json.meta.replayed, true);
  assert.equal(again.json.data.key, opened.json.data.key);
  const exchanged = await call(core.http.port, 'POST', '/api/v1/auth/home', { body: { key: opened.json.data.key } });
  assert.equal(exchanged.status, 403);
  assert.equal(JSON.stringify(opened.json.error ?? {}).includes(opened.json.data.key), false);
});

test('a home listener keeps denial status, headers and the body deadline', async (t) => {
  const address = eligibleAddresses()[0];
  assert.ok(address, 'a private interface is required');
  const fixture = await makeCoreFixture();
  const core = await composeCore({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    interfaces: () => [address],
    bodyTimeoutMs: 300,
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  const opened = await call(core.http.port, 'POST', '/api/v1/settings/home-network', {
    token: local.json.data.token,
    body: { enabled: true },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(opened.status, 201);
  const origin = new URL(opened.json.data.addresses[0].origin);
  const denied = await lanCall(origin, 'POST', '/api/v1/auth/home', { code: '000000' });
  assert.equal(denied.status, 401);
  assert.equal(denied.json.error.code, 'invalid_home_key');
  assert.equal(denied.json.error.details.triesLeft, 4);
  assert.equal(denied.raw.length > 0, true);
  assert.equal(denied.headers['cache-control'], 'no-store');
  assert.equal(denied.headers['x-content-type-options'], 'nosniff');
  assert.equal(denied.headers['referrer-policy'], 'no-referrer');
  const desktop = await lanCall(origin, 'PATCH', '/api/v1/settings', { language: 'es' }, {
    authorization: `Bearer ${local.json.data.token}`,
    'idempotency-key': randomUUID(),
  });
  assert.equal(desktop.status, 403);
  assert.equal(desktop.json.error.code, 'forbidden');
  assert.equal(desktop.headers['cache-control'], 'no-store');
  assert.equal(desktop.raw.length > 0, true);
  for (let count = 3; count >= 1; count -= 1) {
    const failure = await lanCall(origin, 'POST', '/api/v1/auth/home', { code: '000000' });
    assert.equal(failure.status, 401);
    assert.equal(failure.json.error.details.triesLeft, count);
  }
  const locked = await lanCall(origin, 'POST', '/api/v1/auth/home', { code: '000000' });
  assert.equal(locked.status, 429);
  assert.equal(locked.json.error.code, 'pairing_locked');
  assert.equal(locked.headers['retry-after'], '600');
  assert.equal(Date.parse(locked.json.error.details.lockedUntil), fixture.clock.now + 600000);
  const serialized = JSON.stringify(locked.json);
  for (const secret of ['000000', opened.json.data.key, opened.json.data.shortCode]) assert.equal(serialized.includes(secret), false);
  fixture.clock.now += 599999;
  assert.equal((await lanCall(origin, 'POST', '/api/v1/auth/home', { code: opened.json.data.shortCode })).status, 429);
  fixture.clock.now += 1;
  assert.equal((await lanCall(origin, 'POST', '/api/v1/auth/home', { code: opened.json.data.shortCode })).status, 200);
  for (let attempt = 0; attempt < 5; attempt++) await lanCall(origin, 'POST', '/api/v1/auth/home', { code: '000000' });
  const replacement = await call(core.http.port, 'POST', '/api/v1/settings/home-network', {
    token: local.json.data.token, body: { enabled: true }, headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(replacement.status, 201);
  assert.equal((await lanCall(new URL(replacement.json.data.addresses[0].origin), 'POST', '/api/v1/auth/home', { code: replacement.json.data.shortCode })).status, 200);
  const stalledOrigin = new URL(replacement.json.data.addresses[0].origin);
  const stalled = await new Promise((resolve) => {
    const req = request({
      host: stalledOrigin.hostname,
      port: stalledOrigin.port,
      method: 'POST',
      path: '/api/v1/auth/home',
      headers: {
        host: stalledOrigin.host,
        'content-type': 'application/json',
        'content-length': '64',
      },
    }, (res) => resolve({ status: res.statusCode }));
    req.on('error', () => resolve({ closed: true }));
    req.flushHeaders();
    req.write('{');
    setTimeout(() => resolve({ hung: true }), 1000);
  });
  assert.equal(stalled.hung, undefined);
  assert.notEqual(stalled.status, 500);
});

test('an unfinished body ends as request_timeout', async (t) => {
  const fixture = await makeCoreFixture();
  const core = await composeCore({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    projects: [],
    bodyTimeoutMs: 200,
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  const stalled = await new Promise((resolve) => {
    const req = request({
      host: '127.0.0.1',
      port: core.http.port,
      method: 'POST',
      path: '/api/v1/units',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        authorization: `Bearer ${local.json.data.token}`,
        'content-type': 'application/json',
        'content-length': '64',
        'idempotency-key': randomUUID(),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : null });
      });
    });
    req.on('error', () => resolve({ closed: true }));
    req.flushHeaders();
    req.write('{');
    setTimeout(() => resolve({ hung: true }), 1000);
  });
  assert.equal(stalled.hung, undefined);
  assert.equal(stalled.status, 408);
  assert.equal(stalled.json.error.code, 'request_timeout');
});

function lanCall(origin, method, target, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request({
      host: origin.hostname,
      port: origin.port,
      method,
      path: target,
      headers: {
        host: origin.host,
        origin: origin.origin,
        'content-type': 'application/json',
        'content-length': String(payload.length),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const json = raw.length > 0 ? JSON.parse(raw) : null;
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function expectStatus(response, status, label) {
  assert.equal(response.status, status, `${label} ${JSON.stringify(response.json ?? response.raw)}`);
}

function sketch(id, title) {
  const document = newSketch(id, title);
  addScreen(document, { title: 'Bag', x: 0, y: 0 });
  return document;
}

test('comment notes consume no admission or recipient notices, true replays once and a suppressed agent reply informs only master', async (t) => {
  const fixture = await makeCoreFixture(), localPath = path.join(fixture.root, 'shop'), origin = path.join(fixture.root, 'origin');
  await mkdir(localPath, { recursive: true }); await mkdir(origin, { recursive: true });
  const core = await composeCore({ store: fixture.store, paths: { ...fixture.paths, origin }, projects: [{ name: 'shop', localPath }], now: () => fixture.clock.now });
  t.after(async () => { await core.http.close(); await dispose(fixture); });
  const port = core.http.port;
  const login = await call(port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } });
  assert.equal(login.status, 201);
  const token = login.json.data.token;
  const mutate = (method, target, body, as = token, key = randomUUID()) => call(port, method, `/api/v1${target}`, { token: as, body, headers: { 'idempotency-key': key } });
  for (const unit of ['one', 'two']) assert.equal((await mutate('POST', '/units', { unit, role: 'executor', scope: 'root', machine: fixture.machine })).status, 201);
  const created = await mutate('POST', '/blueprint/boards', { project: 'shop', document: sketch('notes', 'Notes'), attached: ['root:one', 'root:two'] });
  assert.equal(created.status, 201);
  const editor = created.json.data, target = `/editors/${editor.id}/comments`;
  const admitted = async () => {
    try { return JSON.parse(await readFile(core.runtime.ledger.file, 'utf8')).admitted.map((item) => item.id); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const fanout = (message) => path.join(fixture.paths.mind, 'user', 'relay', 'fanout', `${message.id}.json`);
  const before = await admitted();
  const body = { text: 'Keep as a note', sendToAgent: false, anchor: { screen: editor.document.screens[0].id, label: 'Bag' }, expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision };
  const note = await mutate('POST', target, body);
  assert.equal(note.status, 201);
  const saved = note.json.data;
  assert.equal(saved.thread.messages[0].sendToAgent, false);
  assert.deepEqual(saved.thread.anchor, body.anchor);
  assert.deepEqual(saved.thread.notifications, []);
  await assert.rejects(readFile(fanout(saved.thread.messages[0])), { code: 'ENOENT' });
  const reply = await mutate('POST', `${target}/${saved.thread.id}/replies`, { text: 'Local reply', sendToAgent: false, expectedCommentsRevision: saved.commentsRevision });
  assert.equal(reply.status, 200);
  const replied = reply.json.data;
  await assert.rejects(readFile(fanout(replied.thread.messages.at(-1))), { code: 'ENOENT' });
  assert.deepEqual(await admitted(), before);
  const history = await call(port, 'GET', `/api/v1/editors/${editor.id}/history`, { token });
  assert.equal(history.status, 200);
  assert.ok(history.json.data.items.filter((item) => item.operation === 'comment').length >= 2);
  const attach = await mutate('PUT', `/editors/${editor.id}/attachments`, { attached: ['root:one'], expectedRevision: editor.attachmentRevision });
  assert.equal(attach.status, 200);
  const sentBody = { ...body, text: 'Send once', sendToAgent: true, expectedCommentsRevision: replied.commentsRevision }, key = randomUUID();
  const sent = await mutate('POST', target, sentBody, token, key);
  assert.equal(sent.status, 201);
  const once = sent.json.data, message = once.thread.messages[0];
  const notices = JSON.parse(await readFile(fanout(message), 'utf8')).notices;
  assert.deepEqual(notices.map((item) => item.unitId), ['root:one']);
  const replay = await mutate('POST', target, sentBody, token, key);
  assert.equal(replay.status, 201); assert.equal(replay.json.data.thread.id, once.thread.id);
  assert.equal((await admitted()).filter((id) => id === message.id).length, 1);
  assert.equal(JSON.parse(await readFile(fanout(message), 'utf8')).notices.length, 1);
  const agent = core.credentials.issue({ audience: 'agent', unitId: 'root:one', capabilities: ['read', 'comment.write'], resourceIds: [editor.id], expiresAt: '2027-01-01T00:00:00.000Z' });
  const agentReply = await mutate('POST', `${target}/${once.thread.id}/replies`, { text: 'Inform the person', sendToAgent: false, expectedCommentsRevision: once.commentsRevision }, agent.token);
  assert.equal(agentReply.status, 200);
  const answer = agentReply.json.data.thread.messages.at(-1);
  assert.equal(answer.sendToAgent, false); assert.equal(answer.authorId, 'root:one');
  assert.deepEqual(JSON.parse(await readFile(fanout(answer), 'utf8')).notices.map((item) => item.unitId), ['root:master']);
  assert.ok((await admitted()).includes(answer.id));
  const settings = await mutate('PATCH', '/settings', { sendToAgent: false, expectedRevision: null });
  assert.equal(settings.status, 200);
  assert.equal((await call(port, 'GET', '/api/v1/settings', { token })).json.data.settings.sendToAgent, false);
  assert.equal((await mutate('PATCH', '/settings', { sendToAgent: true, expectedRevision: settings.json.data.revision }, agent.token)).status, 403);
});

test('library routes reject exact schema violations and foreign writes then replay a recovered deletion once', async (t) => {
  const fixture = await makeCoreFixture();
  const projects = [];
  for (const name of ['shop', 'api']) {
    const localPath = path.join(fixture.root, name);
    await mkdir(localPath, { recursive: true });
    projects.push({ name, localPath });
  }
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  const core = await composeCore({ store: fixture.store, paths: { ...fixture.paths, origin }, projects, now: () => fixture.clock.now });
  t.after(async () => { await core.http.close(); await dispose(fixture); });
  const login = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } });
  const token = login.json.data.token, port = core.http.port;
  const folder = await call(port, 'POST', '/api/v1/library/folders', { token,
    body: { project: 'shop', kind: 'void', title: 'Texts', parentId: null, expectedRevision: null }, headers: { 'idempotency-key': randomUUID() } });
  assert.equal(folder.status, 201);
  const created = await call(port, 'POST', '/api/v1/void/texts', { token,
    body: { project: 'shop', path: 'docs/test.json', folderId: folder.json.data.folder.id, document: { title: 'Exact content', pages: [{ k: 'A', en: 'Preserved' }] } }, headers: { 'idempotency-key': randomUUID() } });
  assert.equal(created.status, 201);
  const editor = created.json.data;
  const revisions = { expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision, expectedAttachmentRevision: editor.attachmentRevision, expectedLibraryRevision: editor.libraryRevision };
  const routes = [
    ['POST', '/library/folders', { project: 'shop', kind: 'void', title: 'Folder', parentId: null, expectedRevision: editor.libraryRevision }],
    ['PATCH', `/library/folders/${folder.json.data.folder.id}`, { project: 'shop', title: 'Renamed', expectedRevision: editor.libraryRevision }],
    ['DELETE', `/library/folders/${folder.json.data.folder.id}`, { project: 'shop', confirmed: true, expectedRevision: editor.libraryRevision }],
    ['PATCH', `/editors/${editor.id}/library`, { title: 'Title', expectedRevision: editor.revision, expectedLibraryRevision: editor.libraryRevision }],
    ['POST', `/editors/${editor.id}/duplicate`, { project: 'api', folderId: null, path: 'docs/copy.json', title: 'Copy', expectedRevision: editor.revision }],
    ['POST', `/editors/${editor.id}/move`, { project: 'api', folderId: null, path: 'docs/moved.json', confirmedRepositoryChange: true, ...revisions }],
    ['DELETE', `/editors/${editor.id}`, { confirmed: true, ...revisions }],
  ];
  const denied = ['phone', 'agent'].map((audience) => core.credentials.issue({ audience, unitId: 'root:master', sessionId: randomUUID(), viewerId: randomUUID(), expiresAt: new Date(fixture.clock.now + 60000).toISOString() }));
  for (const [method, route, body] of routes) {
    const unknown = await call(port, method, `/api/v1${route}`, { token, body: { ...body, unknown: true }, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(unknown.status, 400, route);
    assert.equal(unknown.json.error.code, 'unknown_field');
    for (const credential of denied) assert.equal((await call(port, method, `/api/v1${route}`, { token: credential.token, body, headers: { 'idempotency-key': randomUUID() } })).status, 403, route);
  }
  for (const route of ['/library/folders?kind=void&unknown=true', '/void/texts?unknown=true', '/blueprint/boards?unknown=true']) assert.equal((await call(port, 'GET', `/api/v1${route}`, { token })).status, 400);
  assert.equal((await call(port, 'GET', '/api/v1/void/texts?openComments=yes', { token })).status, 422);
  const key = randomUUID(), body = { confirmed: true, ...revisions };
  fixture.store.fault = { afterRenames: 2 };
  assert.equal((await call(port, 'DELETE', `/api/v1/editors/${editor.id}`, { token, body, headers: { 'idempotency-key': key } })).status, 500);
  const recovered = await call(port, 'DELETE', `/api/v1/editors/${editor.id}`, { token, body, headers: { 'idempotency-key': key } });
  assert.equal(recovered.status, 200);
  const replayed = await call(port, 'DELETE', `/api/v1/editors/${editor.id}`, { token, body, headers: { 'idempotency-key': key } });
  assert.deepEqual(replayed.json.data, recovered.json.data);
  assert.equal(fixture.store.events.filter((event) => event.name === 'editor.removed' && event.resourceId === editor.id).length, 1);
  assert.equal((await call(port, 'POST', `/api/v1/changes/${recovered.json.data.changeId}/undo`, { token, body: {}, headers: { 'idempotency-key': randomUUID() } })).status, 200);
  assert.equal((await call(port, 'GET', `/api/v1/void/texts/${editor.id}`, { token })).status, 200);
});

test('every contract route has a success result and an authority or boundary failure', async (t) => {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  const localPath = path.join(fixture.paths.localDirectory, 'shop');
  await mkdir(origin, { recursive: true });
  await mkdir(localPath, { recursive: true });
  await mkdir(path.join(localPath, '.git'));
  const paths = { ...fixture.paths, origin };
  const permissionId = randomUUID();
  await writeFile(path.join(paths.localDirectory, 'client-permissions.json'), JSON.stringify({ permissions: [{
    id: permissionId, machine: fixture.machine, client: 'codex', actions: ['git.commit', 'git.push'],
    scope: 'hivem1nd-started-sessions', grantedAt: new Date(fixture.clock.now).toISOString(), grantedBy: 'root:master',
  }] }));
  const transcript = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"hivem1nd","title":"HIVEM1ND","version":"3.0.0"}}}',
    '{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"C:/work","model":"strong"}}',
    '{"jsonrpc":"2.0","id":2,"result":{"thread":{"id":"thread-1"}}}',
  ];
  const contextReplacements = new Map();
  const core = await composeCore({
    store: fixture.store,
    paths,
    now: () => fixture.clock.now,
    projects: [{ name: 'shop', localPath }],
    gitRunner: async (_exe, args, settings) => {
      assert.equal(settings.shell, false); assert.equal(settings.windowsHide, true);
      if (args.includes('rev-parse')) return { stdout: args.includes('--show-toplevel') ? `${settings.cwd}\n` : args.includes('--git-common-dir') ? `${path.join(settings.cwd, '.git')}\n` : `${'a'.repeat(40)}\n` };
      if (args.includes('worktree')) return { stdout: `worktree ${settings.cwd}\0HEAD ${'a'.repeat(40)}\0branch refs/heads/main\0\0` };
      if (args.includes('config')) return { stdout: '', code: 1 };
      if (args.includes('status')) return { stdout: '' };
      if (args.includes('symbolic-ref')) return { stdout: 'main\n' };
      if (args.includes('log')) return { stdout: `${'a'.repeat(40)}\0Fixture\0${'2026-10-01T00:00:00.000Z'}\n` };
      throw new Error('Unexpected Git operation');
    },
    editorLauncher: { reviewed: true, open: async () => ({ requestId: randomUUID() }) },
    adapters: { claude: createNativeAdapter('claude', { fixture: true, models: ['strong'] }), codex: {
      ...createNativeAdapter('codex', { fixture: true, transcript, models: ['strong'] }),
      prepareContext: async input => {
        assert.equal(input.summary, null);
        const replacement = { acknowledged: true, generationId: randomUUID() };
        contextReplacements.set(input.requestId, replacement);
        return replacement;
      },
      commitContext: async input => contextReplacements.get(input.requestId)?.generationId === input.replacement.generationId,
    } },
    // Configuration review uses its injected owner handlers.
    settingsHandlers: {
      preview: async ({ context }) => ({ previewId: randomUUID(), revision: (await readMachineSettings(context, fixture.machine, 'agents')).revision, expiresAt: new Date(fixture.clock.now + 30000).toISOString(), changes: [], restartRequired: false }),
      apply: async ({ context, id }) => ({ machine: fixture.machine, client: id, state: 'connected', revision: (await readMachineSettings(context, fixture.machine, 'agents')).revision, keptCopies: 0 }),
      disconnect: async ({ context, id }) => ({ machine: fixture.machine, client: id, state: 'disconnected', revision: (await readMachineSettings(context, fixture.machine, 'agents')).revision }),
      folder: async ({ context }) => readMachineSettings(context, fixture.machine, 'projects'),
      removeProject: async ({ context, id }) => ({ projectId: id, changeId: randomUUID(), undoUntil: new Date(fixture.clock.now + 10000).toISOString(), revision: (await readMachineSettings(context, fixture.machine, 'projects')).revision }),
      service: async ({ context, input }) => ({ ...(await readMachineSettings(context)).service, startWithWindows: input.startWithWindows }),
      restart: async () => ({ machine: fixture.machine, state: 'restarting' }),
    },
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const port = core.http.port;
  const local = await call(port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  expectStatus(local, 201, 'auth local');
  assert.equal(local.json.meta.sync, 'local');
  assert.equal(local.json.token, undefined);
  const token = local.json.data.token;
  const seen = new Set(['POST /auth/local']);
  const hit = (method, template) => seen.add(`${method} ${template}`);
  await writeBeat({ store: fixture.store, paths, now: () => fixture.clock.now }, 'running');

  for (const template of ['/view', '/units', '/leads', '/squads', '/projects', '/machines', '/sync', '/sessions', '/layout', '/settings', '/chats', '/mailboxes', '/approvals', '/tasks', '/waiting']) {
    const response = await call(port, 'GET', `/api/v1${template}`, { token });
    expectStatus(response, 200, template);
    if (template === '/projects') assert.equal(Array.isArray(response.json.data.items), true);
    if (template === '/sync') {
      // A startup publish can still be in flight. Read again until the route is settled. The ceiling only covers a loaded suite.
      let sync = response;
      const deadline = Date.now() + 30000;
      while (!['idle', 'pending'].includes(sync.json.data.state) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        sync = await call(port, 'GET', `/api/v1${template}`, { token });
        expectStatus(sync, 200, template);
      }
      assert.ok(['idle', 'pending'].includes(sync.json.data.state), JSON.stringify(sync.json.data));
      assert.equal(typeof sync.json.data.pendingChanges, 'number');
      assert.equal(sync.json.data.items, undefined);
    }
    if (template === '/settings') {
      assert.equal(response.json.data.service.machine, fixture.machine);
      assert.equal(response.json.data.service.version, '3.0.0');
      assert.equal(response.json.data.service.state, 'running');
      assert.equal(response.json.data.service.startWithWindows, false);
    }
    hit('GET', template);
  }
  for (const section of ['agents', 'permissions', 'projects', 'content']) {
    const template = `/settings/${section}`;
    expectStatus(await call(port, 'GET', `/api/v1${template}`, { token }), 200, template);
    expectStatus(await call(port, 'GET', `/api/v1${template}?unknown=true`, { token }), 400, 'Settings unknown query');
    hit('GET', template);
  }
  const knownBinary = path.join(fixture.root, 'codex.cmd');
  await writeFile(knownBinary, 'Fixture binary; never executed.\n');
  const agentsReport = await call(port, 'GET', '/api/v1/settings/agents', { token });
  const permissionsReport = await call(port, 'GET', '/api/v1/settings/permissions', { token });
  const projectsReport = await call(port, 'GET', '/api/v1/settings/projects', { token });
  const contentReport = await readContent(core.runtime.settingsOwner);
  const previewId = randomUUID();
  assert.deepEqual(permissionsReport.json.data.agentPermissions.map(item => item.id), [permissionId]);
  const settingsRoutes = [
    ['POST', '/settings/agents/scan', '/settings/agents/scan', { machine: fixture.machine }],
    ['POST', '/settings/agents/find', '/settings/agents/find', { machine: fixture.machine, client: 'codex', path: knownBinary }],
    ['POST', '/settings/agents/:client/preview', '/settings/agents/codex/preview', { machine: fixture.machine, mode: 'on-demand', target: 'cli', allowGit: false }],
    ['POST', '/settings/agents/:client/apply', '/settings/agents/codex/apply', { machine: fixture.machine, previewId, changeIds: [], expectedRevision: agentsReport.json.data.revision }],
    ['DELETE', '/settings/agents/:client', '/settings/agents/codex', { machine: fixture.machine, confirmed: true, expectedRevision: agentsReport.json.data.revision }],
    ['DELETE', '/settings/permissions/:permissionId', `/settings/permissions/${permissionId}`, { machine: fixture.machine, expectedRevision: permissionsReport.json.data.revision }],
    ['POST', '/settings/projects/folders', '/settings/projects/folders', { machine: fixture.machine, path: localPath, environment: null, expectedRevision: projectsReport.json.data.revision }],
    ['DELETE', '/settings/projects/:projectId', '/settings/projects/shop', { machine: fixture.machine, confirmed: true, expectedRevision: projectsReport.json.data.revision }],
    ['PATCH', '/settings/service', '/settings/service', { machine: fixture.machine, startWithWindows: false, expectedRevision: null }],
    ['POST', '/settings/service/restart', '/settings/service/restart', { machine: fixture.machine }],
    ['PATCH', '/settings/content', '/settings/content', { includedFeatures: contentReport.features.filter(item => item.included).map(item => item.id), includedKnowledge: contentReport.knowledge.filter(item => item.included).map(item => item.id), preferences: contentReport.preferences, expectedRevision: contentReport.revision }],
  ];
  const phoneCredential = core.credentials.issue({ audience: 'phone' });
  const settingsAgent = core.credentials.issue({ audience: 'agent', unitId: 'root:executor', capabilities: ['read'] });
  for (const [method, template, target, initialBody] of settingsRoutes) {
    const body = { ...initialBody };
    if (template === '/settings/agents/:client/apply' || template === '/settings/agents/:client') body.expectedRevision = (await call(port, 'GET', '/api/v1/settings/agents', { token })).json.data.revision;
    const key = randomUUID();
    const result = await call(port, method, `/api/v1${target}`, { token, body, headers: { 'idempotency-key': key } });
    expectStatus(result, template === '/settings/service/restart' ? 202 : 200, template);
    const replay = await call(port, method, `/api/v1${target}`, { token, body, headers: { 'idempotency-key': key } });
    assert.deepEqual(replay.json.data, result.json.data);
    if (template === '/settings/permissions/:permissionId') {
      assert.equal(result.json.data.permissionId, permissionId);
      assert.equal(result.json.data.state, 'revoked');
      const report = await call(port, 'GET', '/api/v1/settings/permissions', { token });
      assert.deepEqual(report.json.data.agentPermissions, []);
      assert.equal(report.json.data.revision, result.json.data.revision);
      const missing = await call(port, method, `/api/v1${target}`, { token, body: { ...body, expectedRevision: report.json.data.revision }, headers: { 'idempotency-key': randomUUID() } });
      expectStatus(missing, 404, 'Settings missing permission');
      assert.equal(missing.json.error.code, 'permission_not_found');
    }
    expectStatus(await call(port, method, `/api/v1${target}`, { token, body: { ...body, unknown: true }, headers: { 'idempotency-key': randomUUID() } }), 400, 'Settings unknown body');
    assert.equal(routeTable().find(route => route.method === method && route.template === template).operation, 'settings.write');
    for (const denied of [phoneCredential.token, settingsAgent.token]) expectStatus(await call(port, method, `/api/v1${target}`, { token: denied, body, headers: { 'idempotency-key': randomUUID() } }), 403, 'Settings authority');
    if (Object.hasOwn(body, 'machine')) {
      const offline = await call(port, method, `/api/v1${target}`, { token, body: { ...body, machine: 'OFFLINE' }, headers: { 'idempotency-key': randomUUID() } });
      expectStatus(offline, 409, 'Settings offline owner');
      assert.equal(offline.json.error.code, 'machine_unavailable');
    }
    hit(method, template);
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
  const runsIn = { client: 'codex', model: 'strong', effort: 'high', mode: null };
  const chosen = await call(port, 'PATCH', '/api/v1/units/root:executor/runs-in', {
    token, body: { machine: fixture.machine, runsIn, useAsDefault: false, expectedRevision: led.json.data.revision }, headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(chosen, 200, 'stored runtime'); hit('PATCH', '/units/:unitId/runs-in');
  // Automatic native work is one grant for one agent and its client, created only by the desktop.
  const builder = await call(port, 'GET', '/api/v1/units/root:builder', { token });
  const claudeChoice = { client: 'claude', model: 'strong', effort: 'high', mode: null };
  expectStatus(await call(port, 'PATCH', '/api/v1/units/root:builder/runs-in', { token, body: { machine: fixture.machine, runsIn: claudeChoice, useAsDefault: false, expectedRevision: builder.json.data.revision },
    headers: { 'idempotency-key': randomUUID() } }), 200, 'Claude Code runtime');
  const grantsBefore = (await call(port, 'GET', '/api/v1/settings/permissions', { token })).json.data;
  const grant = { machine: fixture.machine, unitId: 'root:builder', client: 'claude', action: 'native.automatic', expectedRevision: grantsBefore.revision }, grantKey = randomUUID();
  for (const denied of [phoneCredential.token, settingsAgent.token]) expectStatus(await call(port, 'POST', '/api/v1/settings/permissions', { token: denied, body: grant, headers: { 'idempotency-key': randomUUID() } }), 403, 'grant authority');
  expectStatus(await call(port, 'POST', '/api/v1/settings/permissions', { token, body: { ...grant, unknown: true }, headers: { 'idempotency-key': randomUUID() } }), 400, 'grant unknown body');
  for (const [override, status, code] of [[{ action: 'git.commit' }, 422, 'invalid_body'], [{ client: 'codex' }, 422, 'invalid_body'], [{ expectedRevision: null }, 422, 'invalid_body'],
    [{ unitId: 'root:missing' }, 404, 'unit_not_found'], [{ client: 'cursor' }, 409, 'scope_unresolved'], [{ machine: 'OFFLINE' }, 409, 'machine_unavailable'],
    [{ expectedRevision: 'f'.repeat(64) }, 409, 'revision_conflict']]) {
    const refused = await call(port, 'POST', '/api/v1/settings/permissions', { token, body: { ...grant, ...override }, headers: { 'idempotency-key': randomUUID() } });
    expectStatus(refused, status, `grant ${JSON.stringify(override)}`); assert.equal(refused.json.error.code, code);
  }
  assert.deepEqual((await call(port, 'GET', '/api/v1/settings/permissions', { token })).json.data.agentPermissions, grantsBefore.agentPermissions, 'a refused grant changes nothing');
  const granted = await call(port, 'POST', '/api/v1/settings/permissions', { token, body: grant, headers: { 'idempotency-key': grantKey } });
  expectStatus(granted, 201, 'grant automatic work');
  assert.equal(routeTable().find(route => route.method === 'POST' && route.template === '/settings/permissions').operation, 'settings.write');
  assert.deepEqual(granted.json.data.permission.actions, ['native.automatic']);
  assert.equal(granted.json.data.permission.unitId, 'root:builder'); assert.equal(granted.json.data.permission.client, 'claude');
  assert.deepEqual((await call(port, 'POST', '/api/v1/settings/permissions', { token, body: grant, headers: { 'idempotency-key': grantKey } })).json.data, granted.json.data);
  const listedGrants = (await call(port, 'GET', '/api/v1/settings/permissions', { token })).json.data;
  assert.deepEqual(listedGrants.agentPermissions.map((item) => item.id).sort(), [granted.json.data.permission.id, ...grantsBefore.agentPermissions.map((item) => item.id)].sort());
  assert.equal(listedGrants.revision, granted.json.data.revision);
  hit('POST', '/settings/permissions');
  const revokedGrant = await call(port, 'DELETE', `/api/v1/settings/permissions/${granted.json.data.permission.id}`, { token, body: { machine: fixture.machine, expectedRevision: listedGrants.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(revokedGrant, 200, 'revoke automatic work');
  assert.deepEqual((await call(port, 'GET', '/api/v1/settings/permissions', { token })).json.data.agentPermissions, grantsBefore.agentPermissions);
  const overseer = await call(port, 'POST', '/api/v1/overseer', { token, body: { machine: fixture.machine, runsIn, fresh: true, expectedRevision: null }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(overseer, 201, 'create Overseer'); hit('POST', '/overseer');
  for (const denied of [phoneCredential.token, settingsAgent.token]) {
    expectStatus(await call(port, 'POST', '/api/v1/overseer', { token: denied, body: { machine: fixture.machine, runsIn, fresh: true, expectedRevision: null }, headers: { 'idempotency-key': randomUUID() } }), 403, 'Overseer authority');
    expectStatus(await call(port, 'PATCH', '/api/v1/units/root:executor/runs-in', { token: denied, body: { machine: fixture.machine, runsIn, useAsDefault: false, expectedRevision: chosen.json.data.revision }, headers: { 'idempotency-key': randomUUID() } }), 403, 'Runs in authority');
  }
  let started = await call(port, 'POST', '/api/v1/units/root:executor/session', {
    token,
    body: { expectedRevision: chosen.json.data.revision, prompt: 'Say ok.' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(started, 202, 'start session');
  await fixture.store.sessionLaunches?.get(started.json.data.requestId);
  started = await call(port, 'GET', `/api/v1/session-requests/${started.json.data.requestId}`, { token });
  assert.equal(started.json.data.state, 'started');
  assert.equal(started.json.data.request, undefined);
  hit('POST', '/units/:unitId/session');
  const requestId = started.json.data.requestId;
  const sessionId = started.json.data.sessionId;
  const requestDetail = await call(port, 'GET', `/api/v1/session-requests/${requestId}`, { token });
  expectStatus(requestDetail, 200, 'session request');
  assert.equal(requestDetail.json.data.requestId, requestId);
  assert.equal(requestDetail.json.data.unitId, 'root:executor');
  assert.equal(requestDetail.json.data.state, 'started');
  assert.equal(requestDetail.json.data.sessionId, sessionId);
  hit('GET', '/session-requests/:requestId');
  const sessions = await call(port, 'GET', '/api/v1/sessions', { token });
  assert.equal(sessions.json.data.items.some((item) => item.id === sessionId), true);
  for (const suffix of ['work', 'transcript']) {
    const target = `/api/v1/sessions/${sessionId}/${suffix}`;
    const page = await call(port, 'GET', target + '?limit=1', { token });
    expectStatus(page, 200, 'owned regular session ' + suffix); hit('GET', `/sessions/:sessionId/${suffix}`);
    assert.ok(page.json.data.items.length <= 1);
    const beforeDenied = fixture.store.writes.length;
    expectStatus(await call(port, 'GET', target, { token: phoneCredential.token }), 403, 'private session ' + suffix); hit('GET', `/sessions/:sessionId/${suffix}`);
    assert.equal(fixture.store.writes.length, beforeDenied);
  }
  const contextTarget = `/api/v1/sessions/${sessionId}/context`;
  const sessionContext = await call(port, 'GET', contextTarget, { token });
  expectStatus(sessionContext, 200, 'session context');
  assert.equal(sessionContext.json.data.sessionId, sessionId);
  hit('GET', '/sessions/:sessionId/context');
  const checkoutTarget = `/api/v1/sessions/${sessionId}/checkout`;
  const sessionCheckout = await call(port, 'GET', checkoutTarget, { token });
  expectStatus(sessionCheckout, 200, 'session checkout');
  assert.deepEqual([sessionCheckout.json.data.sessionId, sessionCheckout.json.data.kind, sessionCheckout.json.data.branch, sessionCheckout.json.data.live],
    [sessionId, 'private', null, true]);
  assert.equal(sessionCheckout.json.data.path, path.join(paths.localDirectory, 'sessions', requestId));
  hit('GET', '/sessions/:sessionId/checkout');
  for (const denied of [phoneCredential.token, settingsAgent.token]) expectStatus(await call(port, 'GET', checkoutTarget, { token: denied }), 403, 'session checkout authority');
  expectStatus(await call(port, 'GET', `${checkoutTarget}?branch=main`, { token }), 400, 'session checkout takes no query');
  expectStatus(await call(port, 'GET', `/api/v1/sessions/${randomUUID()}/checkout`, { token }), 404, 'session checkout of an unknown session');
  const contextBody = { action: 'clear', expectedRevision: sessionContext.json.data.revision };
  const contextWrites = fixture.store.writes.length;
  for (const denied of [phoneCredential.token, settingsAgent.token]) {
    expectStatus(await call(port, 'GET', contextTarget, { token: denied }), 403, 'session context authority');
    expectStatus(await call(port, 'POST', contextTarget, { token: denied, body: contextBody, headers: { 'idempotency-key': randomUUID() } }), 403, 'renew context authority');
  }
  assert.equal(fixture.store.writes.length, contextWrites);
  assert.equal(contextReplacements.size, 0);
  const renewedContext = await call(port, 'POST', contextTarget, {
    token,
    body: contextBody,
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(renewedContext, 202, 'clear context');
  assert.equal(renewedContext.json.data.state, 'pending');
  assert.equal(renewedContext.json.data.context.sessionId, sessionId);
  hit('POST', '/sessions/:sessionId/context');
  await fixture.store.contextJobs?.get(sessionId);
  const clearedContext = await call(port, 'GET', contextTarget, { token });
  expectStatus(clearedContext, 200, 'cleared context');
  assert.equal(clearedContext.json.data.operation.requestId, renewedContext.json.data.requestId);
  assert.equal(clearedContext.json.data.operation.state, 'applied');
  assert.notEqual(clearedContext.json.data.generationId, sessionContext.json.data.generationId);
  assert.equal(contextReplacements.size, 1);
  // Stopping the step ends only the running turn; the session stays open. Only the desktop may ask.
  const stepTarget = `/api/v1/sessions/${sessionId}/stop-step`, stepKey = randomUUID();
  // Wait for prior local observation and hold it while proving these rejected requests write nothing.
  await withLocalChanges(fixture.store, async () => {
    const stepWrites = fixture.store.writes.length;
    for (const denied of [phoneCredential.token, settingsAgent.token]) {
      expectStatus(await call(port, 'POST', stepTarget, { token: denied, body: {}, headers: { 'idempotency-key': randomUUID() } }), 403, 'stop step authority');
    }
    expectStatus(await call(port, 'POST', stepTarget, { token, body: { unknown: true }, headers: { 'idempotency-key': randomUUID() } }), 400, 'stop step unknown body');
    expectStatus(await call(port, 'POST', `/api/v1/sessions/${randomUUID()}/stop-step`, { token, body: {}, headers: { 'idempotency-key': randomUUID() } }), 404, 'stop step unknown session');
    assert.equal(fixture.store.writes.length, stepWrites, 'a refused stop changes nothing');
  });
  assert.equal(routeTable().find(route => route.method === 'POST' && route.template === '/sessions/:sessionId/stop-step').operation, 'session.stop');
  const stepStopped = await call(port, 'POST', stepTarget, { token, body: {}, headers: { 'idempotency-key': stepKey } });
  expectStatus(stepStopped, 200, 'stop step');
  assert.deepEqual(stepStopped.json.data, { sessionId, acknowledged: true, idle: true });
  assert.deepEqual((await call(port, 'POST', stepTarget, { token, body: {}, headers: { 'idempotency-key': stepKey } })).json.data, stepStopped.json.data);
  assert.notEqual((await call(port, 'GET', '/api/v1/sessions', { token })).json.data.items.find((item) => item.id === sessionId).state, 'stopped', 'the session stays after its step stops');
  hit('POST', '/sessions/:sessionId/stop-step');
  const stopped = await call(port, 'POST', `/api/v1/sessions/${sessionId}/stop`, {
    token,
    body: { confirmed: true },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(stopped, 202, 'stop session');
  assert.equal(stopped.json.data.sessionId, sessionId);
  assert.equal(stopped.json.data.state, 'stopping');
  hit('POST', '/sessions/:sessionId/stop');
  const stoppedCheckout = await call(port, 'GET', checkoutTarget, { token });
  expectStatus(stoppedCheckout, 200, 'stopped session checkout');
  assert.deepEqual([stoppedCheckout.json.data.live, stoppedCheckout.json.data.path, stoppedCheckout.json.data.observedAt],
    [false, sessionCheckout.json.data.path, sessionCheckout.json.data.observedAt]);
  const canceledStart = await call(port, 'POST', `/api/v1/session-requests/${requestId}/cancel`, { token, body: {}, headers: { 'idempotency-key': randomUUID() } });
  assert.ok([200, 202].includes(canceledStart.status));
  hit('POST', '/session-requests/:requestId/cancel');

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
  const chatId = chat.json.data.id;
  assert.equal(chat.json.data.kind, 'direct');
  const reused = await call(port, 'POST', '/api/v1/chats', {
    token,
    body: { members: ['root:builder'], title: 'Release' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(reused, 200, 'reused direct chat');
  assert.equal(reused.json.data.id, chatId);
  const chatDetail = await call(port, 'GET', `/api/v1/chats/${chatId}`, { token });
  expectStatus(chatDetail, 200, 'chat detail');
  hit('GET', '/chats/:chatId');
  const posted = await call(port, 'POST', `/api/v1/chats/${chatId}/messages`, {
    token,
    body: { body: 'Ship the notes.' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(posted, 201, 'chat message');
  assert.equal(posted.json.data.message.body, 'Ship the notes.');
  assert.deepEqual(posted.json.data.notifications, [{ unitId: 'root:builder', state: 'pending' }]);
  const forgedSender = await call(port, 'POST', `/api/v1/chats/${chatId}/messages`, {
    token,
    body: { body: 'Stolen', fromId: 'root:two', role: 'master' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(forgedSender, 400, 'forged sender');
  assert.equal(forgedSender.json.error.code, 'unknown_field');
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
  assert.equal(pinned.json.data.pinned, true);
  assert.equal(pinned.json.data.chat, undefined);
  hit('PATCH', '/chats/:chatId');

  const mailed = await call(port, 'POST', '/api/v1/mailboxes/root:master/messages', {
    token,
    body: { body: 'A note for master.' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(mailed, 201, 'mailbox post');
  assert.equal(mailed.json.data.body, 'A note for master.');
  assert.equal(mailed.json.data.message, undefined);
  hit('POST', '/mailboxes/:unitId/messages');
  const mailbox = await call(port, 'GET', '/api/v1/mailboxes/root:master/messages', { token });
  expectStatus(mailbox, 200, 'mailbox list');
  hit('GET', '/mailboxes/:unitId/messages');
  const messageId = mailed.json.data.id;
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
  assert.equal(typeof answered.json.data.approval.grantId, 'string');
  hit('POST', '/approvals/:approvalId/answer');
  const answer = await call(port, 'GET', `/api/v1/approvals/${approvalId}/answers/${answered.json.data.answerId}`, { token });
  expectStatus(answer, 200, 'answer detail');
  assert.equal(answer.json.data.state, 'applied');
  hit('GET', '/approvals/:approvalId/answers/:answerId');
  const grants = await call(port, 'GET', '/api/v1/units/root:executor/approval-grants', { token });
  expectStatus(grants, 200, 'grants');
  assert.equal(grants.json.data.items.some((item) => item.id === answered.json.data.approval.grantId), true);
  hit('GET', '/units/:unitId/approval-grants');
  const grantedUnit = await call(port, 'GET', '/api/v1/units/root:executor', { token });
  const revoked = await call(port, 'DELETE', `/api/v1/units/root:executor/approval-grants/${answered.json.data.approval.grantId}`, {
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
    body: { expectedRevision: reviewed.json.data.task.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(undone, 200, 'task undo');
  assert.equal(undone.json.data.task.status, 'open');
  assert.equal(typeof undone.json.data.changeId, 'string');
  assert.equal(typeof undone.json.data.undoOf, 'string');
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
      screenId: screen.id,
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
    body: { contentType: 'image/png', bytesBase64: PNG.toString('base64') },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(asset, 201, 'asset');
  assert.equal(['image/png', 'image/webp'].includes(asset.json.data.contentType), true);
  assert.equal(typeof asset.json.data.revision, 'string');
  assert.equal(asset.json.data.url, `/api/v1/editors/${boardId}/assets/${asset.json.data.id}`);
  hit('POST', '/editors/:resourceId/assets');
  const currentBoard = await call(port, 'GET', `/api/v1/blueprint/boards/${boardId}`, { token });
  expectStatus(currentBoard, 200, 'board before asset reference');
  const noted = structuredClone(currentBoard.json.data.document);
  noted.note = asset.json.data.src;
  const savedBoard = await call(port, 'PUT', `/api/v1/blueprint/boards/${boardId}`, {
    token,
    body: { document: noted, expectedRevision: currentBoard.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(savedBoard, 200, 'board references the asset');
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
  const replaceSource = (await call(port, 'GET', `/api/v1/void/texts/${textId}`, { token })).json.data;
  const replaceBody = { items: [{ resourceId: textId, k: 'Intro.Welcome', lang: 'en', start: 0, end: 5, expectedText: replaceSource.document.pages[0].en.slice(0, 5),
    replacement: 'Howdy', expectedRevision: replaceSource.revision }], expectedCommentsRevisions: { [textId]: replaceSource.commentsRevision } };
  const replaceDenied = await call(port, 'POST', '/api/v1/void/replace', { token, body: { ...replaceBody, pattern: 'Hello' }, headers: { 'idempotency-key': randomUUID() } });
  assert.ok([400, 422].includes(replaceDenied.status), `replace boundary ${replaceDenied.status}`);
  const replacedMatches = await call(port, 'POST', '/api/v1/void/replace', { token, body: replaceBody, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(replacedMatches, 200, 'replace matches');
  assert.equal(replacedMatches.json.data.matches, 1);
  hit('POST', '/void/replace');
  const replaceUndoMissing = await call(port, 'POST', `/api/v1/void/replace/${randomUUID()}/undo`, { token, body: {}, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(replaceUndoMissing, 404, 'undo unknown replace');
  const replaceUndone = await call(port, 'POST', `/api/v1/void/replace/${replacedMatches.json.data.changeId}/undo`, { token, body: {}, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(replaceUndone, 200, 'undo replace');
  assert.equal(replaceUndone.json.data.undoOf, replacedMatches.json.data.changeId);
  assert.equal((await call(port, 'GET', `/api/v1/void/texts/${textId}`, { token })).json.data.document.pages[0].en, replaceSource.document.pages[0].en);
  hit('POST', '/void/replace/:changeId/undo');

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
    body: { look: 'high-contrast', dirty: true },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(patchedViewer, 200, 'patch viewer');
  assert.equal(patchedViewer.json.data.look, 'high-contrast');
  assert.equal(patchedViewer.json.data.dirty, true);
  assert.equal(patchedViewer.json.data.viewerId, viewer.json.data.viewerId);
  const unchecked = await call(port, 'PATCH', '/api/v1/viewer', {
    token,
    body: { presentation: 'focus' },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(unchecked.status, 400);
  assert.equal(unchecked.json.error.code, 'unknown_field');
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
  const aliasTarget = await call(port, 'GET', '/api/v1/units/root:executor', { token });
  expectStatus(aliasTarget, 200, 'alias unit');
  const aliased = await call(port, 'PATCH', '/api/v1/units/root:executor/alias', {
    token,
    body: { alias: 'Blog', expectedRevision: aliasTarget.json.data.revision },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(aliased, 200, 'alias');
  assert.equal(aliased.json.data.alias, 'Blog');
  assert.equal(aliased.json.data.id, 'root:executor');
  const aliasUnknown = await call(port, 'PATCH', '/api/v1/units/root:executor/alias', {
    token,
    body: { alias: 'Blog', expectedRevision: aliased.json.data.revision, name: 'changed-id' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expectStatus(aliasUnknown, 400, 'alias unknown field');
  assert.equal(aliasUnknown.json.error.code, 'unknown_field');
  hit('PATCH', '/units/:unitId/alias');
  const groupCreated = await call(port, 'POST', '/api/v1/groups', { token,
    body: { title: 'Route group', members: ['root:executor'] }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(groupCreated, 201, 'create group');
  hit('POST', '/groups');
  const groupList = await call(port, 'GET', '/api/v1/groups', { token });
  expectStatus(groupList, 200, 'group list');
  assert.equal(groupList.json.data.items.some((item) => item.id === groupCreated.json.data.id), true);
  expectStatus(await call(port, 'GET', '/api/v1/groups?unknown=true', { token }), 400, 'group query');
  hit('GET', '/groups');
  const groupPath = `/api/v1/groups/${groupCreated.json.data.id}`;
  const groupPatched = await call(port, 'PATCH', groupPath, { token,
    body: { title: 'Route group renamed', expectedRevision: groupCreated.json.data.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(groupPatched, 200, 'patch group');
  hit('PATCH', '/groups/:groupId');
  const groupRemoved = await call(port, 'DELETE', groupPath, { token,
    body: { confirmed: true, expectedRevision: groupPatched.json.data.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(groupRemoved, 200, 'delete group');
  hit('DELETE', '/groups/:groupId');
  const groupUndone = await call(port, 'POST', `/api/v1/changes/${groupRemoved.json.data.changeId}/undo`, {
    token, body: {}, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(groupUndone, 200, 'undo group deletion');
  hit('POST', '/changes/:changeId/undo');
  const removable = (await call(port, 'GET', '/api/v1/units/root:reviewer', { token })).json.data;
  const removalBody = { confirmed: true, expectedRevision: removable.revision };
  expectStatus(await call(port, 'DELETE', '/api/v1/units/root:reviewer', { token,
    body: { ...removalBody, confirmed: false }, headers: { 'idempotency-key': randomUUID() } }), 422, 'unconfirmed unit removal');
  expectStatus(await call(port, 'DELETE', '/api/v1/units/root:reviewer', { token,
    body: removalBody, headers: { 'idempotency-key': randomUUID() } }), 200, 'unit removal');
  hit('DELETE', '/units/:unitId');
  const folderCreated = await call(port, 'POST', '/api/v1/library/folders', { token,
    body: { project: 'shop', kind: 'void', title: 'Route folder', parentId: null, expectedRevision: (await call(port, 'GET', `/api/v1/void/texts/${textId}`, { token })).json.data.libraryRevision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(folderCreated, 201, 'create library folder');
  hit('POST', '/library/folders');
  expectStatus(await call(port, 'GET', '/api/v1/library/folders?project=shop&kind=void', { token }), 200, 'list library folders');
  expectStatus(await call(port, 'GET', '/api/v1/library/folders?kind=void&unknown=true', { token }), 400, 'folder query boundary');
  hit('GET', '/library/folders');
  const folderPath = `/api/v1/library/folders/${folderCreated.json.data.folder.id}`;
  const folderPatched = await call(port, 'PATCH', folderPath, { token,
    body: { project: 'shop', title: 'Renamed folder', expectedRevision: folderCreated.json.data.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(folderPatched, 200, 'patch library folder');
  hit('PATCH', '/library/folders/:folderId');
  const librarySource = (await call(port, 'GET', `/api/v1/void/texts/${textId}`, { token })).json.data;
  const libraryRenamed = await call(port, 'PATCH', `/api/v1/editors/${textId}/library`, { token,
    body: { title: 'Library title', expectedRevision: librarySource.revision, expectedLibraryRevision: librarySource.libraryRevision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(libraryRenamed, 200, 'rename library item');
  hit('PATCH', '/editors/:resourceId/library');
  const copied = await call(port, 'POST', `/api/v1/editors/${textId}/duplicate`, { token,
    body: { project: 'shop', folderId: null, title: 'Copy', path: 'docs/route-copy.json', expectedRevision: librarySource.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(copied, 201, 'duplicate editor');
  hit('POST', '/editors/:resourceId/duplicate');
  const copyId = copied.json.data.id;
  const movedCopy = await call(port, 'POST', `/api/v1/editors/${copyId}/move`, { token,
    body: { project: 'shop', folderId: folderCreated.json.data.folder.id, path: 'docs/ignored-logical-path.json', confirmedRepositoryChange: false,
      expectedRevision: copied.json.data.revision, expectedCommentsRevision: copied.json.data.commentsRevision,
      expectedAttachmentRevision: copied.json.data.attachmentRevision, expectedLibraryRevision: copied.json.data.libraryRevision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(movedCopy, 200, 'move editor to folder');
  assert.equal(movedCopy.json.data.editor.path, 'docs/route-copy.json');
  hit('POST', '/editors/:resourceId/move');
  const copy = movedCopy.json.data.editor;
  const deleteCopy = await call(port, 'DELETE', `/api/v1/editors/${copyId}`, { token,
    body: { confirmed: true, expectedRevision: copy.revision, expectedCommentsRevision: copy.commentsRevision,
      expectedAttachmentRevision: copy.attachmentRevision, expectedLibraryRevision: copy.libraryRevision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(deleteCopy, 200, 'delete editor');
  hit('DELETE', '/editors/:resourceId');
  const latestFolder = (await call(port, 'GET', '/api/v1/library/folders?kind=void&project=shop', { token })).json.data.items.find((item) => item.id === folderCreated.json.data.folder.id);
  expectStatus(await call(port, 'DELETE', folderPath, { token,
    body: { project: 'shop', confirmed: true, expectedRevision: latestFolder.revision }, headers: { 'idempotency-key': randomUUID() } }), 200, 'delete library folder');
  hit('DELETE', '/library/folders/:folderId');
  const legacyDocument = sketch('route-import', 'Route import'), legacyPath = 'docs/flows/boards/route-import.mjs';
  await writeFile(path.join(localPath, legacyPath), `export default ${JSON.stringify(legacyDocument)};\n`);
  const indexFile = path.join(localPath, 'docs/flows/boards/index.json'), index = JSON.parse(await readFile(indexFile, 'utf8'));
  (Array.isArray(index) ? index : index.boards).push({ id: legacyDocument.id, title: legacyDocument.title });
  await writeFile(indexFile, JSON.stringify(index));
  const legacy = await call(port, 'POST', '/api/v1/editors/register', { token, body: { project: 'shop', path: legacyPath, kind: 'blueprint' }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(legacy, 201, 'register legacy route board');
  const exported = await call(port, 'GET', `/api/v1/blueprint/boards/${legacy.json.data.id}/export`, { token });
  expectStatus(exported, 200, 'export legacy board'); hit('GET', '/blueprint/boards/:resourceId/export');
  const imported = await call(port, 'POST', '/api/v1/blueprint/boards/import', { token,
    body: { project: 'shop', path: exported.json.data.path, title: 'Imported route board', folderId: null, legacyResourceId: legacy.json.data.id,
      document: { ...legacyDocument, legacySource: exported.json.data.sourceRevisions }, expectedRevision: exported.json.data.expectedRevision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(imported, 201, 'import legacy board'); hit('POST', '/blueprint/boards/import');
  const historyTarget = `/api/v1/editors/${imported.json.data.id}`;
  const historyList = await call(port, 'GET', `${historyTarget}/history`, { token });
  expectStatus(historyList, 200, 'editor history'); hit('GET', '/editors/:resourceId/history');
  const historyBody = { expectedRevision: imported.json.data.revision, expectedCommentsRevision: imported.json.data.commentsRevision };
  const restored = await call(port, 'POST', `${historyTarget}/history/${historyList.json.data.items.find((item) => item.current).id}/restore`, { token, body: historyBody, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(restored, 200, 'restore history'); hit('POST', '/editors/:resourceId/history/:historyId/restore');
  const conflictAnswer = await call(port, 'POST', `${historyTarget}/conflict`, { token, body: { decision: 'keep-mine', document: restored.json.data.document,
    expectedRevision: restored.json.data.revision, expectedCommentsRevision: restored.json.data.commentsRevision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(conflictAnswer, 200, 'editor conflict'); hit('POST', '/editors/:resourceId/conflict');
  const additionUpload = await call(port, 'POST', '/api/v1/additions/uploads', { token,
    body: { machine: fixture.machine, name: 'folder' }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(additionUpload, 201, 'addition upload'); hit('POST', '/additions/uploads');
  const uploadId = additionUpload.json.data.uploadId;
  const additionChunk = await call(port, 'PUT', `/api/v1/additions/uploads/${uploadId}/chunks`, { token,
    body: { path: 'SKILL.md', index: 0, total: 1, base64: Buffer.from('---\nname: pdf\nruntime: none\n---\n').toString('base64') }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(additionChunk, 200, 'addition chunk'); hit('PUT', '/additions/uploads/:uploadId/chunks');
  const additionPreview = await call(port, 'POST', '/api/v1/additions/previews', { token,
    body: { machine: fixture.machine, source: { kind: 'folder', uploadId }, updateOf: null }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(additionPreview, 202, 'addition preview'); hit('POST', '/additions/previews');
  const previewTarget = `/api/v1/additions/previews/${additionPreview.json.data.id}`;
  expectStatus(await call(port, 'GET', previewTarget, { token }), 200, 'read addition preview'); hit('GET', '/additions/previews/:previewId');
  expectStatus(await call(port, 'POST', `${previewTarget}/retry`, { token, body: {}, headers: { 'idempotency-key': randomUUID() } }), 202, 'retry addition preview'); hit('POST', '/additions/previews/:previewId/retry');
  await core.runtime.settingsOwner.additionJobs.get(additionPreview.json.data.id)?.promise;
  expectStatus(await call(port, 'DELETE', previewTarget, { token, body: {}, headers: { 'idempotency-key': randomUUID() } }), 204, 'cancel addition preview'); hit('DELETE', '/additions/previews/:previewId');
  const disposableUpload = await call(port, 'POST', '/api/v1/additions/uploads', { token, body: { machine: fixture.machine, name: 'other' }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(await call(port, 'DELETE', `/api/v1/additions/uploads/${disposableUpload.json.data.uploadId}`, { token, body: {}, headers: { 'idempotency-key': randomUUID() } }), 204, 'cancel addition upload'); hit('DELETE', '/additions/uploads/:uploadId');
  const archiveChunks = [];
  for (const [relative, content] of [['LICENSE', 'MIT License\n'], ['SKILL.md', '---\nname: pdf\nruntime: none\n---\n# PDF\n']]) {
    const data = Buffer.from(content), header = Buffer.alloc(512);
    header.write(`package/${relative}`, 0, 100); header.write('0000644\0', 100);
    header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257);
    header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    archiveChunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  const archive = gzipSync(Buffer.concat([...archiveChunks, Buffer.alloc(1024)]));
  const additionOwner = core.runtime.settingsOwner;
  additionOwner.additionLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  additionOwner.additionTransport = async url => ({ status: 200, bytes: url.pathname.includes('/commits/')
    ? Buffer.from(JSON.stringify({ sha: 'a'.repeat(40), commit: { committer: { date: '2026-10-01T00:00:00.000Z' } } })) : archive });
  additionOwner.additionRunner = async (command, args, options, input) => {
    assert.equal(command, 'git'); assert.ok(args.includes('hash-object')); assert.equal(options.shell, false);
    return Buffer.from(createHash('sha1').update(`blob ${input.length}\0`).update(input).digest('hex') + '\n');
  };
  const acceptancePreview = await call(port, 'POST', '/api/v1/additions/previews', { token,
    body: { machine: fixture.machine, source: { kind: 'git', url: 'https://github.com/acme/example' }, updateOf: null }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(acceptancePreview, 202, 'inspect accepted addition');
  await additionOwner.additionJobs.get(acceptancePreview.json.data.id)?.promise;
  const reviewedAddition = await call(port, 'GET', `/api/v1/additions/previews/${acceptancePreview.json.data.id}`, { token });
  expectStatus(reviewedAddition, 200, 'review accepted addition');
  const readyAddition = reviewedAddition.json.data;
  assert.equal(readyAddition.state, 'ready');
  const candidate = readyAddition.candidates.find(item => item.kind === 'skill');
  assert.equal(candidate.check.eligible, true);
  const acceptanceBody = { machine: fixture.machine, previewId: readyAddition.id,
    selections: [{ candidateId: candidate.id, scope: { everyUnit: false, units: ['root:executor'], groups: [] } },
      { candidateId: readyAddition.candidates.find(item => item.kind === 'repository').id, scope: { everyUnit: false, units: [], groups: [] } }],
    expectedContentRevision: readyAddition.contentRevision, expectedProjectRevision: readyAddition.projectRevision, confirmed: true };
  for (const denied of [phone.token, agent.token]) {
    const response = await call(port, 'POST', '/api/v1/additions', { token: denied, body: acceptanceBody, headers: { 'idempotency-key': randomUUID() } });
    expectStatus(response, 403, 'addition acceptance authority'); assert.equal(response.json.error.code, 'forbidden');
  }
  const acceptedAddition = await call(port, 'POST', '/api/v1/additions', { token, body: acceptanceBody, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(acceptedAddition, 201, 'accept addition'); hit('POST', '/additions');
  assert.equal(acceptedAddition.json.data.items.length, 2);
  const addition = acceptedAddition.json.data.items[0];
  const additionList = await call(port, 'GET', '/api/v1/additions', { token });
  expectStatus(additionList, 200, 'read additions'); hit('GET', '/additions');
  assert.deepEqual(additionList.json.data.items.map(item => item.id).sort(), acceptedAddition.json.data.items.map(item => item.id).sort());
  const additionTarget = `/api/v1/additions/${addition.id}`;
  const removalInput = { machine: fixture.machine, confirmed: true, expectedRevision: addition.revision };
  for (const denied of [phone.token, agent.token]) {
    const read = await call(port, 'GET', '/api/v1/additions', { token: denied });
    expectStatus(read, 403, 'addition list authority'); assert.equal(read.json.error.code, 'forbidden');
    const remove = await call(port, 'DELETE', additionTarget, { token: denied, body: removalInput, headers: { 'idempotency-key': randomUUID() } });
    expectStatus(remove, 403, 'addition removal authority'); assert.equal(remove.json.error.code, 'forbidden');
  }
  const removedAddition = await call(port, 'DELETE', additionTarget, { token, body: removalInput, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(removedAddition, 200, 'remove addition'); hit('DELETE', '/additions/:additionId');
  assert.equal(removedAddition.json.data.additionId, addition.id);
  const remainingAdditions = await call(port, 'GET', '/api/v1/additions', { token });
  expectStatus(remainingAdditions, 200, 'read additions after removal');
  const repositoryAddition = acceptedAddition.json.data.items.find(item => item.kind === 'repository');
  assert.deepEqual(remainingAdditions.json.data.items, [repositoryAddition]);
  const acceptedClusters = await call(port, 'GET', '/api/v1/clusters', { token });
  const acceptedCluster = acceptedClusters.json.data.items.find(item => item.link.projectId === repositoryAddition.projectId);
  assert.ok(acceptedCluster); assert.deepEqual(acceptedCluster.members, []);
  const repositoryRemoval = { machine: fixture.machine, confirmed: true, expectedRevision: repositoryAddition.revision };
  expectStatus(await call(port, 'DELETE', `/api/v1/additions/${repositoryAddition.id}`, { token: phone.token, body: repositoryRemoval,
    headers: { 'idempotency-key': randomUUID() } }), 403, 'repository addition authority'); hit('DELETE', '/additions/:additionId');
  const detachedAddition = await call(port, 'DELETE', `/api/v1/additions/${repositoryAddition.id}`, { token, body: repositoryRemoval, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(detachedAddition, 200, 'detach accepted repository'); hit('DELETE', '/additions/:additionId');
  const retainedCluster = await call(port, 'GET', `/api/v1/clusters/${acceptedCluster.id}?machine=${fixture.machine}`, { token });
  expectStatus(retainedCluster, 200, 'keep accepted cluster'); assert.deepEqual(retainedCluster.json.data.link, { kind: 'none' });
  assert.deepEqual(retainedCluster.json.data.members, []);
  fixture.clock.now += 60000;
  await writeBeat({ store: fixture.store, paths, now: () => fixture.clock.now }, 'running');
  const clusterList = await call(port, 'GET', '/api/v1/clusters', { token });
  expectStatus(clusterList, 200, 'list clusters'); hit('GET', '/clusters');
  const repositoryCluster = clusterList.json.data.items.find(cluster => cluster.link.kind === 'repository' && cluster.link.projectId === 'shop');
  for (const [suffix, template] of [['', '/clusters/:clusterId'], ['/git', '/clusters/:clusterId/git'], ['/changes', '/clusters/:clusterId/changes']]) {
    const target = `/api/v1/clusters/${repositoryCluster.id}${suffix}`;
    expectStatus(await call(port, 'GET', `${target}?machine=${fixture.machine}`, { token }), 200, template); hit('GET', template);
    expectStatus(await call(port, 'GET', `${target}?machine=OFFLINE`, { token }), 409, 'cluster selected owner');
  }
  const linkDirectory = path.join(fixture.root, 'linked-folder'); await mkdir(linkDirectory);
  const linkReport = await call(port, 'GET', '/api/v1/settings/projects', { token });
  const linked = await call(port, 'POST', '/api/v1/cluster-links', { token, body: { machine: fixture.machine, kind: 'folder', path: linkDirectory, expectedReportRevision: linkReport.json.data.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(linked, 201, 'reviewed cluster link'); hit('POST', '/cluster-links');
  const createdCluster = await call(port, 'POST', '/api/v1/clusters', { token, body: { title: 'Linked folder', parentId: null, link: linked.json.data.link, machine: fixture.machine, confirmed: true }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(createdCluster, 201, 'create cluster'); hit('POST', '/clusters');
  const agentBody = { role: 'executor', machine: fixture.machine, runsIn, useAsDefault: false, expectedRevision: createdCluster.json.data.revision };
  for (const denied of [phoneCredential.token, settingsAgent.token]) expectStatus(await call(port, 'POST', `/api/v1/clusters/${createdCluster.json.data.id}/agents`, { token: denied, body: agentBody, headers: { 'idempotency-key': randomUUID() } }), 403, 'cluster agent authority');
  const clusterAgent = await call(port, 'POST', `/api/v1/clusters/${createdCluster.json.data.id}/agents`, { token, body: agentBody, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(clusterAgent, 201, 'cluster agent'); hit('POST', '/clusters/:clusterId/agents');
  const afterAgent = await call(port, 'GET', `/api/v1/clusters/${createdCluster.json.data.id}?machine=${fixture.machine}`, { token });
  const clusterTarget = `/api/v1/clusters/${createdCluster.json.data.id}`;
  const patchedCluster = await call(port, 'PATCH', clusterTarget, { token, body: { title: 'Renamed folder', machine: fixture.machine, expectedRevision: afterAgent.json.data.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(patchedCluster, 200, 'patch cluster'); hit('PATCH', '/clusters/:clusterId');
  const unlinked = await call(port, 'DELETE', `/api/v1/cluster-links/${createdCluster.json.data.id}`, { token, body: { machine: fixture.machine, confirmed: true, expectedRevision: patchedCluster.json.data.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(unlinked, 200, 'detach cluster link'); hit('DELETE', '/cluster-links/:clusterId');
  const detached = await call(port, 'GET', `${clusterTarget}?machine=${fixture.machine}`, { token });
  expectStatus(await call(port, 'DELETE', clusterTarget, { token, body: { machine: fixture.machine, confirmed: true, expectedRevision: detached.json.data.revision }, headers: { 'idempotency-key': randomUUID() } }), 200, 'remove cluster'); hit('DELETE', '/clusters/:clusterId');
  expectStatus(await call(port, 'POST', `/api/v1/clusters/${repositoryCluster.id}/open-editor`, { token, body: { machine: fixture.machine }, headers: { 'idempotency-key': randomUUID() } }), 202, 'reviewed editor'); hit('POST', '/clusters/:clusterId/open-editor');
  const discovery = (await call(port, 'GET', '/api/v1/settings/projects', { token })).json.data.discoveryOffer;
  expectStatus(await call(port, 'POST', `/api/v1/discovery/offers/${discovery.id}/answer`, { token, body: { machine: fixture.machine, repositoryIds: [], confirmed: false, expectedRevision: discovery.revision }, headers: { 'idempotency-key': randomUUID() } }), 200, 'dismiss discovery'); hit('POST', '/discovery/offers/:offerId/answer');
  for (const route of routeTable().filter(route => route.handler === 'cluster')) {
    const target = route.template.replace(':clusterId', repositoryCluster.id).replace(':offerId', discovery.id);
    expectStatus(await call(port, route.method, `/api/v1${target}`, { token: phone.token, ...(route.method === 'GET' ? {} : { body: { machine: fixture.machine }, headers: { 'idempotency-key': randomUUID() } }) }), 403, 'cluster phone authority');
  }
  fixture.clock.now += 60000;
  await writeBeat({ store: fixture.store, paths, now: () => fixture.clock.now }, 'running');
  const clusterResult = await call(port, 'POST', '/api/v1/clusters', { token, body: { title: 'Plan scope', machine: fixture.machine, parentId: null, link: { kind: 'none' }, confirmed: true }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(clusterResult, 201, 'plan cluster'); const planCluster = clusterResult.json.data;
  const unitResult = await call(port, 'POST', `/api/v1/clusters/${planCluster.id}/agents`, { token, body: { role: 'executor', machine: fixture.machine, runsIn, useAsDefault: false, expectedRevision: planCluster.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(unitResult, 201, 'plan unit'); const planUnit = unitResult.json.data;
  await mkdir(path.join(paths.mind, 'user', 'tasks'), { recursive: true });
  await writeFile(path.join(paths.mind, 'user', 'tasks', '085.md'), `id: root:085\nstatus: open\nfrom-id: root:master\nto-id: ${planUnit.id}\nfiles: ["result.txt"]\n\n## Request\nDraft for review.\n`);
  const assignment = { kind: 'unit', unitId: planUnit.id, runsIn };
  const planInput = { clusterId: planCluster.id, chatId: planCluster.chatId, machine: fixture.machine, title: 'Approved draft', branch: 'approved-draft', mode: 'planning',
    tasks: [{ id: 'root:085', title: 'Draft task', assignment }], roles: { coordinator: assignment, planner: assignment, builder: assignment, reviewer: assignment },
    expectedChatRevision: (await call(port, 'GET', `/api/v1/chats/${planCluster.chatId}`, { token })).json.data.revision };
  const planCreated = await call(port, 'POST', '/api/v1/plans', { token, body: planInput, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(planCreated, 201, 'create actual plan'); hit('POST', '/plans');
  const planId = planCreated.json.data.id;
  expectStatus(await call(port, 'GET', '/api/v1/plans', { token }), 200, 'list actual plans'); hit('GET', '/plans');
  expectStatus(await call(port, 'GET', `/api/v1/plans/${planId}`, { token }), 200, 'read actual plan'); hit('GET', '/plans/:planId');
  const planEdited = await call(port, 'PATCH', `/api/v1/plans/${planId}`, { token, body: { title: 'Reviewed draft', expectedRevision: planCreated.json.data.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(planEdited, 200, 'edit actual plan'); hit('PATCH', '/plans/:planId');
  const runStarted = await call(port, 'POST', `/api/v1/plans/${planId}/run`, { token, body: { confirmed: true, expectedRevision: planEdited.json.data.revision }, headers: { 'idempotency-key': randomUUID() } });
  expectStatus(runStarted, 202, 'freeze plan approval'); hit('POST', '/plans/:planId/run');
  await drainRunLaunches({ store: fixture.store });
  const runId = runStarted.json.data.runId;
  const running = await call(port, 'GET', `/api/v1/runs/${runId}`, { token });
  expectStatus(running, 200, 'read run'); hit('GET', '/runs/:runId');
  expectStatus(await call(port, 'GET', `/api/v1/runs/${runId}/log`, { token }), 200, 'read bounded log'); hit('GET', '/runs/:runId/log');
  const planSessionId = running.json.data.attempts[0].sessionId;
  const planCheckout = await call(port, 'GET', `/api/v1/sessions/${planSessionId}/checkout`, { token });
  expectStatus(planCheckout, 200, 'plan session checkout'); hit('GET', '/sessions/:sessionId/checkout');
  assert.deepEqual([planCheckout.json.data.kind, planCheckout.json.data.live, planCheckout.json.data.path],
    ['private', true, path.join(paths.localDirectory, 'runs', runId, 'sessions', planSessionId)]);
  expectStatus(await call(port, 'GET', `/api/v1/sessions/${planSessionId}/checkout`, { token: phone.token }), 403, 'private plan checkout'); hit('GET', '/sessions/:sessionId/checkout');
  for (const suffix of ['work', 'transcript']) {
    expectStatus(await call(port, 'GET', `/api/v1/sessions/${planSessionId}/${suffix}`, { token }), 200, suffix); hit('GET', `/sessions/:sessionId/${suffix}`);
    expectStatus(await call(port, 'GET', `/api/v1/sessions/${planSessionId}/${suffix}`, { token: phone.token }), 403, 'private plan ' + suffix); hit('GET', `/sessions/:sessionId/${suffix}`);
  }
  for (const route of routeTable().filter(route => ['plan', 'run', 'planWork', 'sessionCheckout'].includes(route.handler))) {
    const target = route.template.replace(':planId', planId).replace(':runId', runId).replace(':sessionId', planSessionId);
    expectStatus(await call(port, route.method, `/api/v1${target}`, { token: phone.token, ...(route.method === 'GET' ? {} : { body: {}, headers: { 'idempotency-key': randomUUID() } }) }), 403, 'plan phone authority');
  }
  const planActor = { store: fixture.store, paths, now: () => fixture.clock.now, bus: core.bus,
    principal: { audience: 'agent', unitId: planUnit.id, sessionId: planSessionId } };
  const extension = await callPlanTool(planActor, 'plan_extend', { runId, count: 2, reason: 'Clarify the accepted draft.', expectedRevision: running.json.data.revision, requestId: randomUUID() });
  const extensionAsk = await call(port, 'GET', `/api/v1/approvals/${extension.approvalId}`, { token });
  expectStatus(extensionAsk, 200, 'bound extension approval');
  const extensionTarget = `/api/v1/approvals/${extension.approvalId}/answer`, extensionBody = { decision: 'approve', expectedRevision: extensionAsk.json.data.revision };
  const beforePhone = fixture.store.writes.length;
  expectStatus(await call(port, 'POST', extensionTarget, { token: phone.token, body: extensionBody, headers: { 'idempotency-key': randomUUID() } }), 403, 'phone cannot extend a plan');
  assert.equal(fixture.store.writes.length, beforePhone); hit('POST', '/approvals/:approvalId/answer');
  expectStatus(await call(port, 'POST', extensionTarget, { token, body: extensionBody, headers: { 'idempotency-key': randomUUID() } }), 200, 'person extends one bound plan'); hit('POST', '/approvals/:approvalId/answer');
  const sentPlanMessage = await callPlanTool(planActor, 'plan_send', { runId, recipientRoles: ['planner'], text: 'Read the preserved draft.', requestId: randomUUID() });
  const currentRun = await call(port, 'GET', `/api/v1/runs/${runId}`, { token });
  expectStatus(await call(port, 'POST', `/api/v1/runs/${runId}/control`, { token, body: { action: 'resend', messageId: sentPlanMessage.messageId, recipientId: 'root:foreign', expectedRevision: currentRun.json.data.revision }, headers: { 'idempotency-key': randomUUID() } }), 422, 'resend recipient boundary');
  expectStatus(await call(port, 'POST', `/api/v1/runs/${runId}/control`, { token, body: { action: 'resend', messageId: sentPlanMessage.messageId, recipientId: planUnit.id, expectedRevision: currentRun.json.data.revision }, headers: { 'idempotency-key': randomUUID() } }), 202, 'resend original run pointer'); hit('POST', '/runs/:runId/control');
  const boundToken = core.credentials.issue({ audience: 'agent', unitId: planUnit.id, sessionId: planSessionId, capabilities: ['own'], attached: true }).token;
  expectStatus(await call(port, 'POST', `/api/v1/chats/${planCluster.chatId}/messages`, { token: boundToken, body: { body: 'Bypass' }, headers: { 'idempotency-key': randomUUID() } }), 403, 'run-bound chat budget boundary'); hit('POST', '/chats/:chatId/messages');
  expectStatus(await call(port, 'POST', `/api/v1/mailboxes/${planUnit.id}/messages`, { token: boundToken, body: { body: 'Bypass' }, headers: { 'idempotency-key': randomUUID() } }), 403, 'run-bound mailbox budget boundary'); hit('POST', '/mailboxes/:unitId/messages');
  const finalRun = await call(port, 'GET', `/api/v1/runs/${runId}`, { token });
  expectStatus(await call(port, 'POST', `/api/v1/runs/${runId}/control`, { token, body: { action: 'stop_run', expectedRevision: finalRun.json.data.revision }, headers: { 'idempotency-key': randomUUID() } }), 202, 'stop owned run'); hit('POST', '/runs/:runId/control');
  const loggedOut = await call(port, 'POST', '/api/v1/auth/logout', { token });
  expectStatus(loggedOut, 204, 'logout');
  hit('POST', '/auth/logout');
  expectStatus(await call(port, 'GET', '/api/v1/units', { token }), 401, 'logged out');

  const required = routeTable().map((route) => `${route.method} ${route.template}`);
  const absent = required.filter((route) => !seen.has(route));
  assert.deepEqual(absent, []);
});

test('caller listener options cannot relabel the loopback socket', async (t) => {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  const core = await composeCore({
    store: fixture.store,
    paths: { ...fixture.paths, origin },
    now: () => fixture.clock.now,
    projects: [],
    listenerKind: 'lan',
    bindAddress: '10.0.0.8',
    netmask: '255.255.255.0',
  });
  const cores = [core];
  t.after(async () => {
    for (const opened of cores.toReversed()) await opened.http.close();
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', {
    token: core.bootstrap.secret,
    body: { embedded: false, hostOrigin: null, look: null, language: null },
  });
  assert.equal(local.status, 201);
  const desktop = core.credentials.issue({ audience: 'desktop', capabilities: ['read', 'unit.create'], expiresAt: '2027-01-01T00:00:00.000Z' });
  const phone = core.credentials.issue({ audience: 'phone', expiresAt: '2027-01-01T00:00:00.000Z' });
  const allowed = await call(core.http.port, 'GET', '/api/v1/units', { token: desktop.token });
  assert.equal(allowed.status, 200);
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
  cores.push(loop);
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

test('a stalled event stream closes when the queue or drain deadline is exceeded', async () => {
  const bus = createEventBus({ now: () => Date.now(), machine: 'DESKTOP' });
  const principal = { stableId: 'desktop', audience: 'desktop', viewerId: 'viewer-a' };
  const stalled = fakeStream();
  serveEvents(stalled.res, bus, principal, null, { drainMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(stalled.ended, true);
  const flooded = fakeStream();
  const before = flooded.writes;
  serveEvents(flooded.res, bus, principal, null, { drainMs: 15_000 });
  bus.emit({ name: 'issue.changed', data: { issue: { path: null, code: 'x', message: 'x'.repeat(1_000_001) }, resolved: false } });
  assert.equal(flooded.ended, true);
  assert.equal(flooded.writes > before, true);
});

function fakeStream() {
  const state = { writes: 0, ended: false };
  state.res = {
    writableEnded: false,
    writeHead() {},
    flushHeaders() {},
    write() {
      state.writes += 1;
      return false;
    },
    end() {
      state.ended = true;
      state.res.writableEnded = true;
    },
    on() {},
    once() {},
  };
  return state;
}

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

test('an agent cannot read another unit chat or session request', async (t) => {
  const { fixture, core, paths, token } = await boot(t);
  const port = core.http.port;
  await writeBeat({ store: fixture.store, paths, now: () => fixture.clock.now }, 'running');
  for (const unit of ['one', 'two']) {
    const created = await call(port, 'POST', '/api/v1/units', {
      token,
      body: { unit, role: 'executor', scope: 'root', machine: fixture.machine },
      headers: { 'idempotency-key': randomUUID() },
    });
    assert.equal(created.status, 201, created.raw);
  }
  const foreign = await call(port, 'POST', '/api/v1/chats', {
    token,
    body: { members: ['root:two'], title: 'private notes for root:one' },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(foreign.status, 201, foreign.raw);
  const foreignId = foreign.json.data.id;
  const posted = await call(port, 'POST', `/api/v1/chats/${foreignId}/messages`, {
    token,
    body: { body: 'foreign-chat-secret' },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(posted.status, 201, posted.raw);
  const own = await call(port, 'POST', '/api/v1/chats', {
    token,
    body: { members: ['root:one'], title: 'one-room' },
    headers: { 'idempotency-key': randomUUID() },
  });
  assert.equal(own.status, 201, own.raw);
  const ownId = own.json.data.id;
  const requestId = randomUUID();
  const ownRequestId = randomUUID();
  const requestDir = path.join(fixture.paths.mind, 'user', 'relay', 'requests', fixture.machine);
  await mkdir(requestDir, { recursive: true });
  await writeFile(path.join(requestDir, `${requestId}.json`), `${JSON.stringify({
    format: 'hivem1nd-session-request-v1',
    id: requestId,
    unitId: 'root:two',
    owner: 'root:one',
    prompt: 'foreign-session-secret',
  })}\n`);
  await writeFile(path.join(requestDir, `${ownRequestId}.json`), `${JSON.stringify({
    format: 'hivem1nd-session-request-v1',
    id: ownRequestId,
    unitId: 'root:one',
    prompt: 'own-session',
  })}\n`);
  const agent = core.credentials.issue({
    audience: 'agent',
    unitId: 'root:one',
    capabilities: ['read'],
    expiresAt: '2027-01-01T00:00:00.000Z',
  });
  const searched = await call(port, 'GET', '/api/v1/chats?q=private', { token: agent.token });
  assert.equal(searched.status, 200, searched.raw);
  assert.equal(searched.json.data.items.length, 0);
  assert.equal(searched.raw.includes('foreign-chat-secret'), false);
  const widened = await call(port, 'GET', '/api/v1/chats?unitId=root:two', { token: agent.token });
  assert.equal(widened.status, 200, widened.raw);
  assert.equal(widened.json.data.items.some((item) => item.id === foreignId), false);
  assert.equal(widened.raw.includes('foreign-chat-secret'), false);
  const member = await call(port, 'GET', '/api/v1/chats', { token: agent.token });
  assert.equal(member.status, 200, member.raw);
  assert.deepEqual(member.json.data.items.map((item) => item.id), [ownId]);
  assert.equal(member.raw.includes('foreign-chat-secret'), false);
  const detail = await call(port, 'GET', `/api/v1/chats/${foreignId}`, { token: agent.token });
  assert.equal(detail.status, 403);
  assert.equal(detail.raw.includes('foreign-chat-secret'), false);
  const messages = await call(port, 'GET', `/api/v1/chats/${foreignId}/messages`, { token: agent.token });
  assert.equal(messages.status, 403);
  assert.equal(messages.raw.includes('foreign-chat-secret'), false);
  const ownDetail = await call(port, 'GET', `/api/v1/chats/${ownId}`, { token: agent.token });
  assert.equal(ownDetail.status, 200, ownDetail.raw);
  const stolen = await call(port, 'GET', `/api/v1/session-requests/${requestId}?unitId=root:one`, { token: agent.token });
  assert.equal(stolen.status, 403);
  assert.equal(stolen.raw.includes('foreign-session-secret'), false);
  const allowed = await call(port, 'GET', `/api/v1/session-requests/${ownRequestId}`, { token: agent.token });
  assert.equal(allowed.status, 200, allowed.raw);
  assert.equal(allowed.json.data.unitId, 'root:one');
  const missing = await call(port, 'GET', `/api/v1/session-requests/${randomUUID()}`, { token: agent.token });
  assert.equal(missing.status, 404);
  const desktop = await call(port, 'GET', '/api/v1/chats', { token });
  assert.equal(desktop.json.data.items.some((item) => item.id === foreignId), true);
});

test('alias HTTP writes return a complete unit and replay the same receipt', async (t) => {
  const { core, paths, fixture, token } = await boot(t);
  await writeBeat({ store: fixture.store, paths, now: () => fixture.clock.now }, 'running');
  const created = await call(core.http.port, 'POST', '/api/v1/units', {
    token, headers: { 'idempotency-key': randomUUID() },
    body: { unit: 'executor-blog', role: 'executor', scope: 'root', machine: fixture.machine },
  });
  assert.equal(created.status, 201);
  const key = randomUUID();
  const body = { alias: 'Blog', expectedRevision: created.json.data.revision };
  const target = '/api/v1/units/root%3Aexecutor-blog/alias';
  const first = await call(core.http.port, 'PATCH', target, { token, body, headers: { 'idempotency-key': key } });
  assert.equal(first.status, 200);
  assert.equal(first.json.data.alias, 'Blog');
  const repeated = await call(core.http.port, 'PATCH', target, { token, body, headers: { 'idempotency-key': key } });
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.json.data, first.json.data);
  const unknown = await call(core.http.port, 'PATCH', target, { token,
    body: { ...body, name: 'changed-id' }, headers: { 'idempotency-key': randomUUID() } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error.code, 'unknown_field');
});

test('group HTTP receipts survive a partial write and enforce desktop authority and exact bodies', async (t) => {
  const { core, paths, fixture, token } = await boot(t);
  await mkdir(path.join(paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(paths.mind, 'user', 'state', 'one.md'), 'unit: one\nunit-id: root:one\nrole: executor\nstate: out\nlead-id: root:overseer\n\n');
  const port = core.http.port;
  const body = { title: 'Recovered group', members: ['root:one'] };
  const key = randomUUID();
  fixture.store.fault = { afterRenames: 1 };
  const failed = await call(port, 'POST', '/api/v1/groups', { token, body, headers: { 'idempotency-key': key } });
  assert.equal(failed.status, 500);
  const recovered = await call(port, 'POST', '/api/v1/groups', { token, body, headers: { 'idempotency-key': key } });
  assert.equal(recovered.status, 201);
  assert.equal(recovered.json.meta.replayed, true);
  const group = recovered.json.data;
  const groupFile = path.join(paths.mind, 'user', 'gui', 'groups', `${group.id}.json`);
  const { revisionOf } = await import('../engine/service/store.mjs');
  assert.equal(group.revision, revisionOf(await readFile(groupFile)));
  const again = await call(port, 'POST', '/api/v1/groups', { token, body, headers: { 'idempotency-key': key } });
  assert.deepEqual(again.json.data, group);
  assert.equal((await call(port, 'GET', '/api/v1/groups', { token })).json.data.total, 1);
  assert.equal((await call(port, 'GET', '/api/v1/chats', { token })).json.data.total, 1);
  const target = `/api/v1/groups/${group.id}`;
  const patchBody = { title: 'Current group', expectedRevision: group.revision };
  const patchKey = randomUUID();
  const patched = await call(port, 'PATCH', target, { token, body: patchBody, headers: { 'idempotency-key': patchKey } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.data.revision, revisionOf(await readFile(groupFile)));
  assert.deepEqual((await call(port, 'PATCH', target, { token, body: patchBody, headers: { 'idempotency-key': patchKey } })).json.data, patched.json.data);
  const removeBody = { confirmed: true, expectedRevision: patched.json.data.revision };
  const removeKey = randomUUID();
  const removed = await call(port, 'DELETE', target, { token, body: removeBody, headers: { 'idempotency-key': removeKey } });
  assert.equal(removed.status, 200);
  assert.deepEqual((await call(port, 'DELETE', target, { token, body: removeBody, headers: { 'idempotency-key': removeKey } })).json.data, removed.json.data);
  const archives = await call(port, 'GET', '/api/v1/chats?archived=true', { token });
  assert.deepEqual(archives.json.data.items.map((item) => item.id), [group.id]);
  assert.equal((await call(port, 'GET', `/api/v1/chats/${group.id}`, { token })).status, 200);
  assert.equal((await call(port, 'GET', '/api/v1/chats?archived=wrong', { token })).status, 422);
  const undoTarget = `/api/v1/changes/${removed.json.data.changeId}/undo`;
  const phone = core.credentials.issue({ audience: 'phone', expiresAt: '2027-01-01T00:00:00.000Z' });
  const agent = core.credentials.issue({ audience: 'agent', unitId: 'root:one', capabilities: ['read', 'chat.manage'], expiresAt: '2027-01-01T00:00:00.000Z' });
  for (const denied of [phone, agent]) {
    for (const [method, route, requestBody] of [['POST', '/api/v1/groups', body], ['PATCH', target, patchBody], ['DELETE', target, removeBody], ['POST', undoTarget, {}]]) {
      const response = await call(port, method, route, { token: denied.token, body: requestBody, headers: { 'idempotency-key': randomUUID() } });
      assert.equal(response.status, 403);
    }
  }
  for (const [method, route, requestBody] of [['POST', '/api/v1/groups', body], ['PATCH', target, patchBody], ['DELETE', target, removeBody], ['POST', undoTarget, {}]]) {
    const response = await call(port, method, route, { token, body: { ...requestBody, unknown: true }, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'unknown_field');
  }
  const undoKey = randomUUID();
  const restored = await call(port, 'POST', undoTarget, { token, body: {}, headers: { 'idempotency-key': undoKey } });
  assert.equal(restored.status, 200);
  assert.deepEqual((await call(port, 'POST', undoTarget, { token, body: {}, headers: { 'idempotency-key': undoKey } })).json.data, restored.json.data);
  assert.equal((await call(port, 'GET', '/api/v1/groups', { token })).json.data.items[0].revision, patched.json.data.revision);
});

test('unit removal archives with one receipt, keeps archived reads and requires desktop authority', async (t) => {
  const { core, paths, fixture, token } = await boot(t);
  await mkdir(path.join(paths.mind, 'user', 'state'), { recursive: true });
  const file = path.join(paths.mind, 'user', 'state', 'one.md');
  await writeFile(file, 'unit: one\nunit-id: root:one\nrole: executor\nstate: out\n\nRetained context.\n');
  const port = core.http.port;
  const unit = (await call(port, 'GET', '/api/v1/units/root:one', { token })).json.data;
  const target = '/api/v1/units/root:one';
  const body = { confirmed: true, expectedRevision: unit.revision };
  const phone = core.credentials.issue({ audience: 'phone', expiresAt: '2027-01-01T00:00:00.000Z' });
  const agent = core.credentials.issue({ audience: 'agent', unitId: 'root:one', capabilities: ['read', 'unit.create'], expiresAt: '2027-01-01T00:00:00.000Z' });
  for (const denied of [phone, agent]) assert.equal((await call(port, 'DELETE', target, { token: denied.token, body, headers: { 'idempotency-key': randomUUID() } })).status, 403);
  assert.equal((await call(port, 'DELETE', target, { token, body: { ...body, unknown: true }, headers: { 'idempotency-key': randomUUID() } })).status, 400);
  const key = randomUUID();
  fixture.store.fault = { afterRenames: 1 };
  assert.equal((await call(port, 'DELETE', target, { token, body, headers: { 'idempotency-key': key } })).status, 500);
  const removed = await call(port, 'DELETE', target, { token, body, headers: { 'idempotency-key': key } });
  assert.equal(removed.status, 200);
  assert.deepEqual((await call(port, 'DELETE', target, { token, body, headers: { 'idempotency-key': key } })).json.data, removed.json.data);
  assert.equal((await call(port, 'GET', '/api/v1/units', { token })).json.data.total, 0);
  const archived = await call(port, 'GET', '/api/v1/units?archived=true', { token });
  assert.equal(archived.status, 200);
  assert.equal(archived.json.data.items[0].removed, true);
  assert.equal((await call(port, 'GET', '/api/v1/units?archived=wrong', { token })).status, 422);
  const restored = await call(port, 'POST', `/api/v1/changes/${removed.json.data.changeId}/undo`, { token, body: {}, headers: { 'idempotency-key': randomUUID() } });
  assert.equal(restored.status, 200);
  assert.equal((await call(port, 'GET', '/api/v1/units', { token })).json.data.items[0].revision, unit.revision);
});

test('C12 rejects phone and agent callers before upload staging or receipt lookup and binds desktop previews', async t => {
  const { core, token, fixture } = await boot(t);
  const port = core.http.port, owner = core.runtime.settingsOwner;
  async function inventory(root) {
    const files = {};
    async function visit(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        else files[path.relative(root, target)] = hashBytes(await readFile(target));
      }
    }
    await visit(root); return files;
  }
  const client = path.join(fixture.home, 'foreign-client.json'), source = path.join(fixture.root, 'dropped');
  await mkdir(source); await writeFile(client, 'Preserved client'); await writeFile(path.join(source, 'original.txt'), 'Preserved source');
  const unchanged = async () => ({ mind: await inventory(fixture.paths.mind), client: hashBytes(await readFile(client)), source: await inventory(source) });
  for (let attempt = 0; attempt < 100; attempt++) {
    const initialized = await readFile(path.join(fixture.paths.mind, 'machines', fixture.machine, 'service.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (initialized) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const before = await unchanged();
  const selected = { machine: fixture.machine, name: 'folder' }, key = randomUUID();
  const audienceTokens = [core.credentials.issue({ audience: 'phone' }).token, core.credentials.issue({ audience: 'agent', unitId: 'root:one', capabilities: ['settings.write'] }).token];
  for (const denied of audienceTokens) {
    for (const [method, target, body] of [['POST', '/additions/uploads', selected], ['POST', '/additions/previews', { machine: fixture.machine, source: { kind: 'link', url: 'https://github.com/acme/example' }, updateOf: null }],
      ['PUT', `/additions/uploads/${randomUUID()}/chunks`, { path: 'a.txt', index: 0, total: 1, base64: '' }],
      ['GET', `/additions/previews/${randomUUID()}`, undefined], ['DELETE', `/additions/previews/${randomUUID()}`, {}], ['POST', `/additions/previews/${randomUUID()}/retry`, {}]]) {
      const response = await call(port, method, `/api/v1${target}`, { token: denied, body, headers: { 'idempotency-key': key } });
      assert.equal(response.status, 403); assert.equal(response.json.error.code, 'forbidden');
    }
  }
  await assert.rejects(readFile(path.join(fixture.paths.localDirectory, 'additions', 'uploads', `${key}.json`)), { code: 'ENOENT' });
  const localBefore = await inventory(fixture.paths.localDirectory);
  assert.equal(Object.keys(localBefore).some(file => file.includes('receipts') || file.includes('additions')), false);
  assert.equal((await call(port, 'POST', '/api/v1/additions/uploads', { token, body: { ...selected, path: source }, headers: { 'idempotency-key': randomUUID() } })).status, 400);
  assert.equal((await call(port, 'POST', '/api/v1/additions/uploads', { token, body: { ...selected, machine: 'OFFLINE' }, headers: { 'idempotency-key': randomUUID() } })).json.error.code, 'machine_unavailable');
  const upload = await call(port, 'POST', '/api/v1/additions/uploads', { token, body: selected, headers: { 'idempotency-key': key } });
  assert.equal(upload.status, 201);
  assert.deepEqual((await call(port, 'POST', '/api/v1/additions/uploads', { token, body: selected, headers: { 'idempotency-key': key } })).json.data, upload.json.data);
  const uploadId = upload.json.data.uploadId, chunk = { path: 'SKILL.md', index: 0, total: 1, base64: Buffer.from('---\nname: pdf\nruntime: none\n---\n').toString('base64') };
  assert.equal((await call(port, 'PUT', `/api/v1/additions/uploads/${uploadId}/chunks`, { token, body: chunk, headers: { 'idempotency-key': randomUUID() } })).status, 200);
  const input = { machine: fixture.machine, source: { kind: 'folder', uploadId }, updateOf: null };
  assert.equal((await call(port, 'POST', '/api/v1/additions/previews', { token, body: { ...input, source: { ...input.source, path: source } }, headers: { 'idempotency-key': randomUUID() } })).status, 400);
  const previewKey = randomUUID(), preview = await call(port, 'POST', '/api/v1/additions/previews', { token, body: input, headers: { 'idempotency-key': previewKey } });
  assert.equal(preview.status, 202); assert.equal(preview.json.data.state, 'inspecting');
  await owner.additionJobs.get(preview.json.data.id)?.promise;
  const target = `/api/v1/additions/previews/${preview.json.data.id}`;
  const ready = await call(port, 'GET', target, { token }); assert.equal(ready.json.data.state, 'ready');
  const replay = await call(port, 'POST', '/api/v1/additions/previews', { token, body: input, headers: { 'idempotency-key': previewKey } });
  assert.equal(replay.json.data.id, ready.json.data.id); assert.equal(replay.json.data.state, 'ready');
  const second = await call(port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } });
  for (const [method, suffix, body] of [['GET', '', undefined], ['POST', '/retry', {}], ['DELETE', '', {}]]) {
    const response = await call(port, method, target + suffix, { token: second.json.data.token, body, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(response.status, 403); assert.equal(response.json.error.code, 'forbidden');
  }
  assert.equal((await call(port, 'POST', target + '/retry', { token, body: { extra: true }, headers: { 'idempotency-key': randomUUID() } })).status, 400);
  assert.equal((await call(port, 'DELETE', target, { token, body: {}, headers: { 'idempotency-key': randomUUID() } })).status, 204);
  assert.deepEqual(await unchanged(), before);
});

test('C12 timeout retry remains on the same preview and safe errors omit private transport output', async t => {
  const { core, token, fixture } = await boot(t), owner = core.runtime.settingsOwner;
  let requests = 0, tick, signal;
  const privateDiagnostic = randomUUID();
  owner.additionLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  owner.additionSchedule = (callback, ms) => { assert.equal(ms, 30000); tick = callback; return 9; };
  owner.additionClearTimeout = () => {};
  owner.additionTransport = async (_url, options) => { requests++; signal = options.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error(privateDiagnostic)), { once: true })); };
  const input = { machine: fixture.machine, source: { kind: 'link', url: 'https://github.com/acme/example' }, updateOf: null }, key = randomUUID();
  const initial = await call(core.http.port, 'POST', '/api/v1/additions/previews', { token, body: input, headers: { 'idempotency-key': key } });
  assert.equal(initial.status, 202);
  while (!signal) await new Promise(resolve => setImmediate(resolve)); tick();
  await owner.additionJobs.get(initial.json.data.id)?.promise;
  const target = `/api/v1/additions/previews/${initial.json.data.id}`;
  const failed = await call(core.http.port, 'GET', target, { token });
  assert.equal(failed.json.data.state, 'failed'); assert.equal(failed.json.data.error.code, 'source_timeout');
  assert.equal(failed.raw.includes(privateDiagnostic), false); assert.equal(signal.aborted, true);
  const replay = await call(core.http.port, 'POST', '/api/v1/additions/previews', { token, body: input, headers: { 'idempotency-key': key } });
  assert.equal(replay.json.data.state, 'failed'); assert.equal(requests, 1);
  owner.additionTransport = async () => { requests++; throw new Error(privateDiagnostic); };
  const retryKey = randomUUID();
  const retry = await call(core.http.port, 'POST', target + '/retry', { token, body: {}, headers: { 'idempotency-key': retryKey } });
  assert.equal(retry.status, 202); assert.equal(retry.json.data.id, initial.json.data.id);
  await owner.additionJobs.get(initial.json.data.id)?.promise;
  const duplicate = await call(core.http.port, 'POST', target + '/retry', { token, body: {}, headers: { 'idempotency-key': retryKey } });
  assert.equal(duplicate.json.data.error.code, 'source_unavailable'); assert.equal(requests, 2);
  assert.equal(JSON.stringify(core.http.security.diagnostics).includes(privateDiagnostic), false);
  fixture.clock.now += 900000;
  assert.equal((await call(core.http.port, 'GET', target, { token })).json.error.code, 'preview_expired');
});
});
