import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRelay } from '../engine/relay/store.mjs';
import { serveRelayMcp } from '../engine/relay/mcp.mjs';
import { decidePermission } from '../engine/relay/hooks.mjs';
import { WAKE_ADAPTERS } from '../engine/relay/wake-adapters.mjs';
import { bindNative, closeAttachedServices, openRelayOperations } from '../engine/service/client.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { runCli } from '../cli/index.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
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
  const operations = await openRelayOperations({ mindPath, hostname: 'RELAYTEST', client, sessionId: 'instance-a' });
  const server = serveRelayMcp({ mindPath, client, sessionId: 'instance-a', operations, env: {}, stdin, stdout, stderr });
  for (const request of requests) stdin.write(`${typeof request === 'string' ? request : JSON.stringify(request)}\n`);
  stdin.end();
  await server;
  return { lines: Buffer.concat(chunks).toString('utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)), stderr: '' };
}

test('stdio MCP negotiates supported version and binds explicit native identity via register tool', async (context) => {
  const mindPath = await fixture(context);
  const { lines } = await run(mindPath, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'future-version' } },
    { jsonrpc: '2.0', id: 6, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'register', arguments: { unit: 'overseer', nativeSessionId: 'native-1', client: 'codex' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'reminder', arguments: { nativeSessionId: 'native-1', client: 'codex' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'reminder', arguments: {} } },
  ]);
  assert.equal(lines[0].error.code, -32602);
  assert.equal(lines[1].result.protocolVersion, '2025-03-26');
  assert.ok(lines[2].result.tools.some((tool) => tool.name === 'register'));
  assert.equal(lines[3].result.structuredContent.unit, 'overseer');
  assert.deepEqual(lines[4].result.structuredContent, { unit: 'overseer', unread: 0, from: [], text: '', registered: true });
  assert.deepEqual(lines[5].result.structuredContent, { unit: 'overseer', unread: 0, from: [], text: '', registered: true });
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
  const operations = await openRelayOperations({ mindPath, hostname: 'RELAYTEST', client: 'codex', sessionId: 'instance-a' });
  await serveRelayMcp({ mindPath, client: 'codex', sessionId: 'instance-a', operations, env: {}, stdin, stdout, stderr: new PassThrough() });
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

test('stdio advertises protocol 3.0.0 and editor tools, and a caller flag is not native proof', async (context) => {
  const mindPath = await fixture(context);
  const { lines } = await run(mindPath, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'blueprint_open', arguments: { resourceId: 'board-1' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'blueprint_open', arguments: { resourceId: 'board-1' } } },
  ]);
  assert.equal(lines[0].result.serverInfo.version, '3.0.0');
  assert.equal(lines[0].result.protocolVersion, '2025-03-26');
  const names = lines[1].result.tools.map((tool) => tool.name);
  for (const name of ['register', 'send_message', 'link', 'blueprint_open', 'blueprint_add_node', 'blueprint_update_node', 'blueprint_remove_node', 'blueprint_reply_comment', 'void_open', 'void_replace_range', 'void_reply_comment']) {
    assert.equal(names.includes(name), true, name);
  }
  assert.equal(lines[2].result.isError, true);
  assert.match(lines[2].result.structuredContent.requestId, /^[0-9a-f-]{36}$/);
  assert.notEqual(lines[2].result.structuredContent.requestId, lines[3].result.structuredContent.requestId);
  assert.equal(bindNative({}, { verifiedLogin: true }).nativeSupport, false);
  const proof = { unitId: 'project:shop:executor', nativeSessionId: 'native-1', machine: 'DESKTOP', client: 'cursor' };
  const bridge = { adapters: { cursor: { confirm: () => true } } };
  assert.equal(bindNative({}, { bridge, proof, verifiedLogin: true }).nativeSupport, true);
  assert.deepEqual(await decidePermission({ correlationId: 'corr-1' }), { decision: 'ask', reason: 'native_fallback' });
  assert.deepEqual(await decidePermission({
    correlationId: 'corr-1',
    waitForOwner: async () => ({ correlationId: 'corr-1', decision: 'deny' }),
  }), { decision: 'deny', correlationId: 'corr-1' });
});

test('task status obtains a master viewer and logs it out', async (context) => {
  const fixtureMind = await makeCoreFixture();
  context.after(async () => {
    await closeAttachedServices();
    await dispose(fixtureMind);
  });
  const originPath = path.join(fixtureMind.root, 'origin');
  await mkdir(originPath, { recursive: true });
  await mkdir(path.join(fixtureMind.paths.mind, 'user', 'tasks'), { recursive: true });
  await writeFile(fixtureMind.paths.configFile, `${JSON.stringify({
    format: 'hivem1nd-service-config-v1',
    mindPath: fixtureMind.paths.mind,
    machine: fixtureMind.machine,
    origin: { kind: 'folder', path: originPath },
    stagingPath: fixtureMind.paths.staging,
    port: 0,
  })}\n`);
  await writeFile(path.join(fixtureMind.paths.mind, 'user', 'tasks', '002.md'), 'id: project:shop:002\ntitle: Ship\nstatus: review\nfrom-id: root:master\nto-id: project:shop:executor\ndate: 2026-10-10\n\n## Request\nShip it.\n## Report\n\n');
  const dependencies = {
    platform: fixtureMind.platform,
    env: fixtureMind.env,
    aclRunner: stubAclRunner(),
    confineRoot: fixtureMind.root,
    now: () => fixtureMind.clock.now,
    userKey: 'S-1-5-21-1-2-3-1001',
    guardPort: 0,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
  const stdout = [];
  const stderr = [];
  dependencies.stdout.on('data', (chunk) => stdout.push(chunk));
  dependencies.stderr.on('data', (chunk) => stderr.push(chunk));
  const usage = await runCli(['task', 'status', 'shop'], dependencies);
  assert.equal(usage, 2);
  const changed = await runCli([
    'task', 'status', 'shop', '002', 'done', '--note', 'Ready',
    '--mind-path', fixtureMind.paths.mind,
    '--home-dir', fixtureMind.home,
    '--hostname', fixtureMind.machine,
  ], dependencies);
  assert.equal(changed, 0, Buffer.concat(stderr).toString('utf8'));
  const payload = JSON.parse(Buffer.concat(stdout).toString('utf8'));
  assert.equal(payload.task.status, 'done');
  stdout.length = 0;
  const conflict = await runCli([
    'task', 'status', 'shop', '002', 'done',
    '--mind-path', fixtureMind.paths.mind,
    '--home-dir', fixtureMind.home,
    '--hostname', fixtureMind.machine,
  ], dependencies);
  assert.equal(conflict, 3);
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

test('the link tool makes a code, a second session joins with it, and send_message reaches the whole link', async (context) => {
  const mindPath = await fixture(context);
  await writeFile(path.join(mindPath, 'user', 'state', 'executor-app.md'), 'unit: executor-app\nstate: in\nmachine: RELAYTEST\n\nWorking.\n');
  const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const first = await run(mindPath, [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    call(2, 'register', { unit: 'overseer', nativeSessionId: 'native-1', client: 'codex' }),
    call(3, 'link'),
    call(4, 'link', { code: 'A'.repeat(17) }),
    call(5, 'link', { code: 'ABCDE', extra: true }),
  ]);
  const tools = first.lines[0].result.tools;
  const link = tools.find((tool) => tool.name === 'link');
  assert.equal(link.inputSchema.properties.code.maxLength, 16);
  assert.deepEqual(link.inputSchema.required, []);
  assert.match(tools.find((tool) => tool.name === 'send_message').inputSchema.properties.to.description, /link:<linkId>/);
  const made = first.lines[2].result.structuredContent;
  assert.match(made.code, /^[2-9A-HJ-NP-Z]{5}$/);
  assert.deepEqual(made.members, ['overseer']);
  for (const line of first.lines.slice(3)) {
    assert.equal(line.result.isError, true);
    assert.equal(line.result.structuredContent.code, 'INVALID_ARGUMENTS');
  }

  const second = await run(mindPath, [
    call(1, 'register', { unit: 'executor-app', nativeSessionId: 'native-2', client: 'codex' }),
    call(2, 'link', { code: made.code.toLowerCase() }),
    call(3, 'send_message', { to: `link:${made.linkId}`, subject: 'Hello', body: 'From the second session' }),
    call(4, 'link', { code: 'AAAAA' }),
  ]);
  const joined = second.lines[1].result.structuredContent;
  assert.equal(joined.joined, true);
  assert.deepEqual(joined.members, ['overseer', 'executor-app']);
  const sent = second.lines[2].result.structuredContent;
  assert.deepEqual(sent.recipients, ['overseer']);
  assert.equal(sent.threadId, made.threadId);
  assert.equal(second.lines[3].result.isError, true);
  assert.equal(second.lines[3].result.structuredContent.code, 'LINK_NOT_FOUND');

  const overseer = await createRelay({ mindPath, hostname: 'RELAYTEST', sessionId: 'direct', client: 'codex' });
  await overseer.register({ unit: 'overseer', nativeSessionId: 'native-1' });
  const { messages } = await overseer.read();
  assert.deepEqual(messages.map((message) => message.subject).sort(), ['Hello', 'Linked']);
  assert.equal(messages.every((message) => message.threadId === made.threadId), true);
});
