import { request } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeCore } from '../engine/service/service.mjs';
import { toolSchemas } from '../engine/service/mcp.mjs';
import { bindNative, close, connectService, request as serviceRequest } from '../engine/service/client.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function boot(t) {
  const fixture = await makeCoreFixture();
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: [] });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: {} });
  return { core, token: local.json.token, port: core.http.port };
}

test('HTTP MCP accepts only the pinned protocol and lists the editor tools', async (t) => {
  const { port, token } = await boot(t);
  assert.equal(toolSchemas().length, 8);
  const denied = await call(port, 'GET', '/mcp', { token });
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.allow, 'POST');
  const missing = await call(port, 'POST', '/mcp', {
    token,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
  });
  assert.equal(missing.status, 406);
  const unsupported = await call(port, 'POST', '/mcp', {
    token,
    body: { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: 'future-version' } },
    headers: { accept: 'application/json, text/event-stream' },
  });
  assert.equal(unsupported.json.error.code, -32602);
  const ready = await call(port, 'POST', '/mcp', {
    token,
    body: { jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    headers: { accept: 'application/json, text/event-stream' },
  });
  assert.equal(ready.json.result.capabilities.tools.listChanged, false);
  const noted = await call(port, 'POST', '/mcp', {
    token,
    body: { jsonrpc: '2.0', method: 'notifications/initialized' },
    headers: { accept: 'application/json, text/event-stream' },
  });
  assert.equal(noted.status, 202);
  const broken = await call(port, 'POST', '/mcp', {
    token,
    raw: '{',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
  });
  assert.equal(broken.json.error.code, -32700);
  const client = await connectService({ origin: `http://127.0.0.1:${port}`, token });
  const opened = await serviceRequest(client, { path: '/mcp', body: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'void_open', arguments: { resourceId: 'missing', requestId: 'req-1' } } } });
  assert.equal(opened.json.result.isError, true);
  assert.equal(bindNative(client, { verifiedLogin: false }).nativeSupport, false);
  close(client);
});

function call(port, method, target, { token = null, body = undefined, raw = null, headers = {} } = {}) {
  const payload = raw !== null ? Buffer.from(raw) : body === undefined ? null : Buffer.from(JSON.stringify(body));
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
        const text = Buffer.concat(chunks).toString('utf8');
        const json = text.length > 0 && String(res.headers['content-type'] ?? '').includes('json') ? JSON.parse(text) : null;
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}
