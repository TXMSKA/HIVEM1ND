import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { serveRelayMcp } from '../engine/relay/mcp.mjs';
import { createRelay } from '../engine/relay/store.mjs';
import { WAKE_ADAPTERS } from '../engine/relay/wake-adapters.mjs';
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

test('the register tool offers every wake adapter client, Antigravity included', async (context) => {
  const mindPath = await fixture(context);
  const { lines } = await run(mindPath, [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'antigravity-session-1', client: 'antigravity' } } },
  ], 'antigravity');
  const offered = lines[0].result.tools.find((tool) => tool.name === 'register').inputSchema.properties.client.enum;
  for (const client of Object.keys(WAKE_ADAPTERS)) assert.ok(offered.includes(client), client);
  assert.equal(lines[1].result.structuredContent.client, 'antigravity');
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

test('delivery_status answers for messages the registered unit sent and rejects arguments it does not take', async (context) => {
  const mindPath = await fixture(context);
  const first = await run(mindPath, [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'native-1', client: 'codex' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'send_message', arguments: { to: 'overseer', subject: 'Self', body: 'note' } } },
  ]);
  const { id } = first.lines[1].result.structuredContent;
  const { lines } = await run(mindPath, [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'delivery_status', arguments: { ids: [id, 'someone-elses'] } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delivery_status', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delivery_status', arguments: { ids: Array.from({ length: 101 }, (_, index) => `id-${index}`) } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'delivery_status', arguments: { ids: [id], limit: 5 } } },
  ]);
  const definition = lines[0].result.tools.find((tool) => tool.name === 'delivery_status');
  assert.deepEqual(definition.inputSchema.required, ['ids']);
  assert.equal(definition.inputSchema.properties.ids.maxItems, 100);
  const answer = lines[1].result.structuredContent;
  assert.equal(answer.deliveries[0].id, id);
  assert.equal(answer.deliveries[0].stage, 'published');
  assert.deepEqual(answer.unknown, ['someone-elses']);
  for (const line of lines.slice(2)) {
    assert.equal(line.result.isError, true);
    assert.equal(line.result.structuredContent.code, 'INVALID_ARGUMENTS');
  }
});

test('status answers with counts, the caller and the units waiting by default, and lists every unit only in pages on request', async (context) => {
  const mindPath = await fixture(context);
  for (const unit of ['executor-app', 'executor-web', 'executor-db']) {
    await writeFile(path.join(mindPath, 'user', 'state', `${unit}.md`), `unit: ${unit}\nstate: in\nmachine: RELAYTEST\n\nWorking.\n`);
  }
  const elsewhere = await createRelay({ mindPath, hostname: 'OTHERBOX', sessionId: 'other-box', client: 'codex' });
  await elsewhere.register({ unit: 'executor-web', nativeSessionId: 'web-native' });
  const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const { lines } = await run(mindPath, [
    call(1, 'register', { unit: 'overseer', nativeSessionId: 'native-1', client: 'codex' }),
    call(2, 'send_message', { to: 'executor-app', subject: 'Question', body: 'Answer this.', replyRequested: true }),
    call(3, 'send_message', { to: 'executor-db', subject: 'Note', body: 'For the record.' }),
    call(4, 'status'),
    call(5, 'status', { detail: true, limit: 2 }),
    call(6, 'status', { detail: true, limit: 2, offset: 2 }),
    call(7, 'status', { machine: 'OTHERBOX', detail: true }),
    call(8, 'status', { unit: 'executor-app' }),
    call(9, 'status', { limit: 0 }),
  ]);
  const summary = lines[3].result.structuredContent;
  assert.equal(summary.units, undefined, 'the default answer lists no unit entries');
  assert.deepEqual(summary.counts, { units: 4, registeredUnits: 2, registrations: 2, machines: { OTHERBOX: 1, RELAYTEST: 1 }, unread: 2, waiting: 1 });
  assert.equal(summary.self.unit, 'overseer');
  assert.equal(summary.self.registration.nativeSessionId, 'native-1');
  assert.deepEqual(summary.attention.map((item) => [item.unit, item.unread, item.waiting]), [['executor-app', 1, 1], ['executor-db', 1, 0]]);
  assert.equal(summary.total, 2);
  const first = lines[4].result.structuredContent;
  assert.deepEqual(first.units.map((item) => item.unit), ['executor-app', 'executor-db']);
  assert.deepEqual([first.total, first.nextOffset], [4, 2]);
  const second = lines[5].result.structuredContent;
  assert.deepEqual(second.units.map((item) => item.unit), ['executor-web', 'overseer']);
  assert.equal(second.nextOffset, null);
  const other = lines[6].result.structuredContent;
  assert.deepEqual(other.units.map((item) => [item.unit, item.registeredSessions.map((record) => record.machine)]), [['executor-web', ['OTHERBOX']]]);
  assert.deepEqual(lines[7].result.structuredContent.attention.map((item) => item.unit), ['executor-app']);
  assert.equal(lines[7].result.structuredContent.self, null, 'the caller is shown only when its unit is selected');
  assert.equal(lines[8].result.isError, true);
});

test('a Relay tool call keeps the wake window of its session open, and the first call after the window ended carries the notice once', async (context) => {
  const mindPath = await fixture(context);
  const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  await run(mindPath, [call(1, 'register', { unit: 'overseer', nativeSessionId: 'native-1', client: 'codex' })]);
  const { createRelayWakeController } = await import('../engine/relay/wake.mjs');
  const controller = await createRelayWakeController({ mindPath, hostname: 'RELAYTEST', sink: async () => ({ status: 'submitted' }) });
  const binding = { unit: 'overseer', nativeSessionId: 'native-1', client: 'codex', machine: 'RELAYTEST' };
  await controller.enable(binding);
  const policies = path.join(mindPath, 'user', 'relay', 'wake', 'policies');
  const [file] = await readdir(policies);
  const shift = async (startedAt) => {
    const policy = JSON.parse(await readFile(path.join(policies, file), 'utf8'));
    await writeFile(path.join(policies, file), JSON.stringify({ ...policy, startedAt: new Date(startedAt).toISOString(), deadlineAt: new Date(startedAt + 4 * 3600_000).toISOString() }));
  };
  await shift(Date.now() - 3600_000);
  const before = Date.now();
  const used = await run(mindPath, [call(1, 'list_inbox')]);
  assert.equal(used.lines[0].result.structuredContent.wakeNotice, undefined);
  assert.ok(Date.parse((await controller.status(binding)).deadlineAt) >= before + 4 * 3600_000, 'the window starts again from the call');

  await shift(Date.now() - 5 * 3600_000);
  const { lines } = await run(mindPath, [call(1, 'list_inbox'), call(2, 'list_inbox')]);
  assert.match(lines[0].result.structuredContent.wakeNotice, /^Relay wake for overseer ended at .+ relay wake attach .+--client codex --unit overseer --native-session-id native-1$/);
  assert.equal(lines[0].result.structuredContent.unit, 'overseer');
  assert.equal(lines[1].result.structuredContent.wakeNotice, undefined, 'the notice is given once');
});

test('the MCP server of a chat holds its session, so a later registration of the unit keeps it while an abandoned one is retired', async (context) => {
  const mindPath = await fixture(context);
  const sessions = path.join(mindPath, 'user', 'relay', 'sessions');
  await mkdir(sessions, { recursive: true });
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
  const old = async (index, nativeSessionId) => {
    const registrationId = `00000000-0000-4000-8000-00000000000${index}`;
    await writeFile(path.join(sessions, `${registrationId}.json`), JSON.stringify({ kind: 'registration', registrationId, instanceId: `old-${index}`,
      unit: 'overseer', scopeId: 'user', nativeSessionId, client: 'codex', machine: 'RELAYTEST', registeredAt: twoHoursAgo,
      activity: null, activityObservedAt: null, quota: null, quotaObservedAt: null }));
    return `${registrationId}.json`;
  };
  const open = await old(1, 'open-native');
  const abandoned = await old(2, 'abandoned-native');
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const server = serveRelayMcp({ mindPath, hostname: 'RELAYTEST', client: 'codex', sessionId: 'open-server', nativeSessionId: 'open-native', stdin, stdout, stderr: new PassThrough() });
  stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_inbox', arguments: {} } })}\n`);
  await server;
  const relay = await createRelay({ mindPath, hostname: 'RELAYTEST', sessionId: 'new-server', client: 'codex' });
  await relay.register({ unit: 'overseer', nativeSessionId: 'new-native', activity: 'active' });
  const left = await readdir(sessions);
  assert.equal(left.includes(open), true, 'a session whose server still runs is kept');
  assert.equal(left.includes(abandoned), false);
  assert.deepEqual(await readdir(path.join(sessions, 'retired')), [abandoned]);
});
