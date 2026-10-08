import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { serveRelayMcp } from '../engine/relay/mcp.mjs';
import { makeRelayMind } from './relay-test-fixture.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-mcp-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return makeRelayMind(root);
}

async function run(mindPath, requests, client = 'codex') {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  const server = serveRelayMcp({ mindPath, hostname: 'RELAYTEST', client, sessionId: 'instance-a', stdin, stdout, stderr });
  for (const request of requests) stdin.write(`${typeof request === 'string' ? request : JSON.stringify(request)}\n`);
  stdin.end();
  await server;
  return { lines: Buffer.concat(chunks).toString('utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)), stderr: '' };
}

test('stdio MCP negotiates supported version and binds explicit native identity via register tool', async (context) => {
  const mindPath = await fixture(context);
  const { lines } = await run(mindPath, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'future-version' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'native-1', client: 'codex' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'reminder', arguments: { nativeSessionId: 'native-1', client: 'codex' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'reminder', arguments: {} } },
  ]);
  assert.equal(lines[0].result.protocolVersion, '2025-11-25');
  assert.ok(lines[1].result.tools.some((tool) => tool.name === 'register'));
  assert.equal(lines[2].result.structuredContent.unit, 'overseer');
  assert.deepEqual(lines[3].result.structuredContent, { unit: 'overseer', unread: 0, from: [], text: '', registered: true });
  assert.deepEqual(lines[4].result.structuredContent, { unit: 'overseer', unread: 0, from: [], text: '', registered: true });
});

test('OpenCode identifies itself as a supported Relay MCP registration client', async (context) => {
  const mindPath = await fixture(context);
  const { lines } = await run(mindPath, [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'opencode-session-1', client: 'opencode' } } },
  ], 'opencode');
  assert.equal(lines[0].result.structuredContent.client, 'opencode');
  assert.equal(lines[0].result.structuredContent.nativeSessionId, 'opencode-session-1');
});

test('Copilot identifies itself as a supported Relay MCP registration client', async (context) => {
  const mindPath = await fixture(context);
  const { lines } = await run(mindPath, [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'copilot-session-1', client: 'copilot' } } },
  ], 'copilot');
  assert.equal(lines[0].result.structuredContent.client, 'copilot');
  assert.equal(lines[0].result.structuredContent.nativeSessionId, 'copilot-session-1');
});

test('invalid MCP JSON, primitives, extra fields, unknown tools and oversized lines return errors and keep serving', async (context) => {
  const mindPath = await fixture(context);
  const requests = [
    '{bad json',
    42,
    { jsonrpc: '2.0', id: 'primitive', method: 'tools/call', params: { name: 'register', arguments: 'overseer' } },
    { jsonrpc: '2.0', id: 'extra', method: 'tools/call', params: { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'x', extra: 'bypass' } } },
    { jsonrpc: '2.0', id: 'unknown', method: 'tools/call', params: { name: 'unknown_tool', arguments: {} } },
    'x'.repeat(1_048_577),
    { jsonrpc: '2.0', id: 'after', method: 'ping' },
  ];
  const { lines } = await run(mindPath, requests);
  assert.equal(lines[0].error.code, -32700);
  assert.equal(lines[1].error.code, -32600);
  assert.equal(lines[2].result.isError, true);
  assert.equal(lines[2].result.structuredContent.code, 'INVALID_ARGUMENTS');
  assert.equal(lines[3].result.isError, true);
  assert.equal(lines[4].result.isError, true);
  assert.equal(lines[5].error.code, -32700);
  assert.deepEqual(lines[6].result, {});
});

test('unbound MCP server does not register itself from its correlation ID', async (context) => {
  const mindPath = await fixture(context);
  const { lines } = await run(mindPath, [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reminder', arguments: { nativeSessionId: 'instance-a', client: 'codex' } } },
  ]);
  assert.equal(lines[0].result.structuredContent.registered, false);
});

test('stdio UTF-8 decoder preserves a code point split across stream chunks', async (context) => {
  const mindPath = await fixture(context);
  const request = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'native-雪', client: 'codex' } } })}\n`);
  const split = request.indexOf(Buffer.from('雪')) + 1;
  const stdin = Readable.from([request.subarray(0, split), request.subarray(split)]);
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(chunk));
  await serveRelayMcp({ mindPath, hostname: 'RELAYTEST', client: 'codex', sessionId: 'instance-a', stdin, stdout, stderr: new PassThrough() });
  const response = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(response.result.structuredContent.nativeSessionId, 'native-雪');
});
