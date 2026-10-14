import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addScreen, newSketch } from '../features/blueprint/review/sketch-format.mjs';
import { createBoard } from '../engine/service/editors.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { uuidV8 } from '../engine/service/identity.mjs';
import { dispatch, toolSchemas } from '../engine/service/mcp.mjs';
import { bindNative, close, connectService, request as serviceRequest } from '../engine/service/client.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function boot(t) {
  const fixture = await makeCoreFixture();
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: [] });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const local = await call(core.http.port, 'POST', '/api/v1/auth/local', { token: core.bootstrap.secret, body: { embedded: false, hostOrigin: null, look: null, language: null } });
  const agent = core.credentials.issue({
    audience: 'agent',
    unitId: 'project:shop:executor',
    sessionId: randomUUID(),
    attached: true,
    capabilities: ['own'],
  });
  return { core, token: agent.token, desktop: local.json.data.token, port: core.http.port };
}

test('HTTP MCP accepts only the pinned protocol and lists the editor tools', async (t) => {
  const { port, token, desktop } = await boot(t);
  // Eight editor tools, plus the two session tools of contract C03 for child launches and task completion.
  assert.equal(toolSchemas().length, 10);
  assert.equal(toolSchemas().filter((tool) => /^(blueprint|void)_/.test(tool.name)).length, 8);
  assert.deepEqual(Object.keys(toolSchemas().find((tool) => tool.name === 'session_open').inputSchema.properties), ['client', 'machine', 'unitId', 'runMode', 'taskId', 'requestId']);
  assert.deepEqual(Object.keys(toolSchemas().find((tool) => tool.name === 'session_complete').inputSchema.properties), ['outcome', 'taskId', 'requestId']);
  assert.equal(toolSchemas().find((tool) => tool.name === 'blueprint_open').inputSchema.required.includes('requestId'), false);
  const desktopDenied = await call(port, 'POST', '/mcp', {
    token: desktop,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    headers: { accept: 'application/json, text/event-stream' },
  });
  assert.equal(desktopDenied.status, 403);
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
  assert.equal(ready.json.result.serverInfo.name, 'hivem1nd-relay');
  assert.equal(ready.json.result.serverInfo.version, '3.0.0');
  const ping = await call(port, 'POST', '/mcp', {
    token,
    body: { jsonrpc: '2.0', id: 8, method: 'ping' },
    headers: { accept: 'application/json, text/event-stream' },
  });
  assert.deepEqual(ping.json.result, {});
  const listed = await call(port, 'POST', '/mcp', {
    token,
    body: { jsonrpc: '2.0', id: 9, method: 'tools/list' },
    headers: { accept: 'application/json, text/event-stream' },
  });
  assert.equal(listed.json.result.tools.some((tool) => tool.name === 'register'), true);
  assert.equal(listed.json.result.tools.some((tool) => tool.name === 'void_open'), true);
  const unknown = await call(port, 'POST', '/mcp', {
    token,
    body: { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'missing_tool', arguments: {} } },
    headers: { accept: 'application/json, text/event-stream' },
  });
  assert.equal(unknown.json.error.code, -32601);
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
  const opened = await serviceRequest({ origin: client.origin, token, closed: false }, {
    path: '/mcp',
    headers: { accept: 'application/json, text/event-stream' },
    body: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'void_open', arguments: { resourceId: randomUUID() } } },
  });
  assert.equal(opened.json.result.isError, true);
  const failure = JSON.parse(opened.json.result.content[0].text);
  assert.equal(typeof failure.error.code, 'string');
  assert.equal(failure.error.requestId, null);
  assert.equal(bindNative(client, { verifiedLogin: false }).nativeSupport, false);
  close(client);
});

test('an identical MCP request id replays the original editor success', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const localPath = path.join(fixture.paths.localDirectory, 'shop');
  await mkdir(localPath, { recursive: true });
  const document = newSketch('cart', 'Cart');
  addScreen(document, { title: 'Bag', x: 0, y: 0 });
  const context = {
    store: fixture.store,
    paths: fixture.paths,
    projects: [{ name: 'shop', localPath }],
    now: () => fixture.clock.now,
    ledger: openLedger({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, machine: fixture.paths.machine }),
    credential: { audience: 'agent', unitId: 'project:shop:executor', attached: true, token: 'agent-token' },
    principal: { unitId: 'project:shop:executor', audience: 'agent' },
    bus: createEventBus({ now: () => fixture.clock.now, machine: fixture.paths.machine }),
  };
  const created = await createBoard(context, { project: 'shop', document });
  await bindUnit(fixture, created.id, 'project:shop:executor');
  const args = {
    resourceId: created.id,
    nodeId: document.screens[0].root.id,
    changes: { name: 'Tile' },
    expectedRevision: created.revision,
    requestId: randomUUID(),
  };
  const message = { jsonrpc: '2.0', method: 'tools/call', params: { name: 'blueprint_update_node', arguments: args } };
  const first = await dispatch(context, { ...message, id: 1 });
  assert.equal(first.result.isError, false);
  const activity = context.store.events.filter((event) => event.name === 'editor.activity').length;
  assert.equal(activity > 0, true);
  const second = await dispatch(context, { ...message, id: 2 });
  assert.equal(second.result.isError, false);
  assert.deepEqual(JSON.parse(second.result.content[0].text).data, JSON.parse(first.result.content[0].text).data);
  assert.equal(context.store.events.filter((event) => event.name === 'editor.activity').length, activity);
});

test('an agent attached to one editor cannot open another, and delivery follows the sidecar', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const localPath = path.join(fixture.paths.localDirectory, 'shop');
  await mkdir(localPath, { recursive: true });
  const context = {
    store: fixture.store,
    paths: fixture.paths,
    projects: [{ name: 'shop', localPath }],
    now: () => fixture.clock.now,
    credential: { audience: 'agent', unitId: 'project:shop:executor', attached: true, token: 'agent-token' },
    principal: { unitId: 'project:shop:executor', audience: 'agent', stableId: 'agent-1' },
  };
  const first = newSketch('one', 'Owned board');
  addScreen(first, { title: 'Owned', x: 0, y: 0 });
  const second = newSketch('two', 'Foreign board secret');
  addScreen(second, { title: 'Foreign', x: 0, y: 0 });
  const owned = await createBoard({ ...context, principal: { unitId: 'root:master', audience: 'desktop' } }, { project: 'shop', document: first });
  const foreign = await createBoard({ ...context, principal: { unitId: 'root:master', audience: 'desktop' } }, { project: 'shop', document: second });
  await bindUnit(fixture, owned.id, 'project:shop:executor');
  const opened = await dispatch(context, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'blueprint_open', arguments: { resourceId: owned.id } } });
  assert.equal(opened.result.isError, false);
  assert.equal(JSON.parse(opened.result.content[0].text).data.attached.includes('project:shop:executor'), true);
  const stolen = await dispatch(context, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'blueprint_open', arguments: { resourceId: foreign.id } } });
  assert.equal(stolen.result.isError, true);
  assert.equal(JSON.stringify(stolen).includes('Foreign board secret'), false);
  const desktop = await dispatch({ ...context, principal: { unitId: 'root:master', audience: 'desktop' }, credential: { audience: 'desktop', token: 'desktop' } }, {
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'blueprint_open', arguments: { resourceId: foreign.id } },
  });
  assert.equal(desktop.result.isError, false);
  const bus = createEventBus({ now: () => fixture.clock.now, machine: fixture.paths.machine, mind: fixture.paths.mind });
  const seen = [];
  const agent = { stableId: 'agent-1', audience: 'agent', unitId: 'project:shop:executor', resourceIds: [foreign.id, owned.id] };
  const subscriber = bus.subscribe(agent, {}, (frame) => seen.push(frame));
  bus.emit({ name: 'blueprint.changed', resourceId: foreign.id, data: { resourceId: foreign.id, revision: 'a'.repeat(64), title: 'Foreign board secret' } });
  bus.emit({ name: 'blueprint.changed', resourceId: owned.id, data: { resourceId: owned.id, revision: 'b'.repeat(64) } });
  assert.deepEqual(seen.map((frame) => frame.data.data.resourceId), [owned.id]);
  await bindUnit(fixture, owned.id, 'project:shop:other');
  bus.emit({ name: 'blueprint.changed', resourceId: owned.id, data: { resourceId: owned.id, revision: 'c'.repeat(64) } });
  assert.equal(seen.length, 1);
  const cursor = `${seen[0].id.slice(0, seen[0].id.lastIndexOf(':'))}:0`;
  const replay = bus.replay(subscriber, cursor);
  assert.equal(replay.events.length, 0);
  assert.equal(JSON.stringify(replay).includes('Foreign board secret'), false);
  bus.release(subscriber);
});

test('legacy MCP tools cannot cross the credential unit', async (t) => {
  const fixture = await makeCoreFixture();
  const sessionId = uuidV8(['session', fixture.machine, 'cursor', 'native-one', 'root:one']);
  const registrationId = randomUUID();
  const ownedPids = new Set([4242]);
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'one.md'), 'unit: one\nunit-id: root:one\nstate: in\nmachine: DESKTOP\n\nReady.\n');
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'two.md'), 'unit: two\nunit-id: root:two\nstate: in\nmachine: DESKTOP\n\nReady.\n');
  await mkdir(path.join(fixture.paths.mind, 'user', 'inbox', 'one'), { recursive: true });
  await mkdir(path.join(fixture.paths.mind, 'user', 'inbox', 'two'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'inbox', 'one', '20261011-120000-DESKTOP-abcdef0123456789.md'), 'id: msg-one\nfrom: master\nto: one\nmachine: DESKTOP\ntimestamp: 2026-10-11T12:00:00.000Z\nsubject: Visible one\nthread-id: thread-one\n\nvisible to one\n');
  await writeFile(path.join(fixture.paths.mind, 'user', 'inbox', 'two', '20261011-120001-DESKTOP-abcdef0123456780.md'), 'id: msg-two\nfrom: master\nto: two\nmachine: DESKTOP\ntimestamp: 2026-10-11T12:00:01.000Z\nsubject: Private two\nthread-id: thread-two\n\nsecret body of two\n');
  await mkdir(path.join(fixture.paths.mind, 'user', 'relay', 'sessions'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'sessions', `${registrationId}.json`), `${JSON.stringify({
    kind: 'registration',
    registrationId,
    instanceId: `service-${fixture.machine}`,
    sessionId,
    unit: 'one',
    unitId: 'root:one',
    scopeId: 'root',
    nativeSessionId: 'native-one',
    client: 'cursor',
    machine: fixture.machine,
    registeredAt: '2026-10-11T12:00:00.000Z',
    activity: 'idle',
    activityObservedAt: '2026-10-11T12:00:00.000Z',
    quota: null,
    quotaObservedAt: null,
  })}\n`);
  await mkdir(path.join(fixture.paths.localDirectory, 'session-starts'), { recursive: true });
  await writeFile(path.join(fixture.paths.localDirectory, 'session-starts', `${randomUUID()}.json`), `${JSON.stringify({ sessionId, pid: 4242 })}\n`);
  const core = await composeCore({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    projects: [],
    ownedPids,
    adapters: {
      cursor: {
        confirm(proof) {
          return proof.unitId === 'root:one' && proof.nativeSessionId === 'native-one' && proof.client === 'cursor' && proof.machine === fixture.machine;
        },
      },
    },
  });
  t.after(async () => {
    await core.http.close();
    await dispose(fixture);
  });
  const token = core.credentials.issue({
    audience: 'agent',
    unitId: 'root:one',
    sessionId,
    attached: true,
    capabilities: ['own'],
  }).token;
  const unbound = core.credentials.issue({
    audience: 'agent',
    unitId: 'root:one',
    sessionId: randomUUID(),
    attached: true,
    capabilities: ['own'],
  }).token;
  const headers = { accept: 'application/json, text/event-stream' };
  const foreign = await call(core.http.port, 'POST', '/mcp', {
    token,
    headers,
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'history', arguments: { unit: 'two' } } },
  });
  assert.equal(foreign.json.result.isError, true);
  assert.equal(JSON.stringify(foreign.json).includes('secret body of two'), false);
  assert.equal(JSON.stringify(foreign.json).includes('Private two'), false);
  const inbox = await call(core.http.port, 'POST', '/mcp', {
    token,
    headers,
    body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_inbox', arguments: { unit: 'two' } } },
  });
  assert.equal(inbox.json.result.isError, true);
  assert.equal(JSON.stringify(inbox.json).includes('Private two'), false);
  const threads = await call(core.http.port, 'POST', '/mcp', {
    token,
    headers,
    body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'threads', arguments: { unit: 'two' } } },
  });
  assert.equal(threads.json.result.isError, true);
  assert.equal(JSON.stringify(threads.json).includes('thread-two'), false);
  const forged = await call(core.http.port, 'POST', '/mcp', {
    token,
    headers,
    body: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'register', arguments: { unit: 'two', nativeSessionId: 'qa040-forged-native', client: 'cursor' } } },
  });
  assert.equal(forged.json.result.isError, true);
  const retarget = await call(core.http.port, 'POST', '/mcp', {
    token,
    headers,
    body: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'register', arguments: { unit: 'one', nativeSessionId: 'qa040-forged-native', client: 'cursor' } } },
  });
  assert.equal(retarget.json.result.isError, true);
  const stray = await call(core.http.port, 'POST', '/mcp', {
    token: unbound,
    headers,
    body: { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'history', arguments: {} } },
  });
  assert.equal(stray.json.result.isError, true);
  assert.equal(JSON.stringify(stray.json).includes('secret body of two'), false);
  const own = await call(core.http.port, 'POST', '/mcp', {
    token,
    headers,
    body: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'history', arguments: {} } },
  });
  assert.equal(own.json.result.isError, false);
  const ownHistory = JSON.parse(own.json.result.content[0].text).data;
  assert.equal(ownHistory.messages.some((message) => message.body === 'visible to one\n' || message.body === 'visible to one'), true);
  assert.equal(JSON.stringify(ownHistory).includes('secret body of two'), false);
  const registered = await call(core.http.port, 'POST', '/mcp', {
    token,
    headers,
    body: { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'register', arguments: { unit: 'one', nativeSessionId: 'native-one', client: 'cursor' } } },
  });
  assert.equal(registered.json.result.isError, false);
  const registeredBody = JSON.parse(registered.json.result.content[0].text).data;
  assert.equal(registeredBody.unitId, 'root:one');
  assert.equal(registeredBody.nativeSessionId, 'native-one');
  const requestId = randomUUID();
  const sent = await call(core.http.port, 'POST', '/mcp', {
    token,
    headers,
    body: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'send_message', arguments: { to: 'two', subject: 'Note', body: 'hello from one', requestId } } },
  });
  assert.equal(sent.json.result.isError, false);
  const replay = await call(core.http.port, 'POST', '/mcp', {
    token,
    headers,
    body: { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'send_message', arguments: { to: 'two', subject: 'Note', body: 'hello from one', requestId } } },
  });
  assert.equal(replay.json.result.isError, false);
  assert.equal(JSON.parse(replay.json.result.content[0].text).data.id, JSON.parse(sent.json.result.content[0].text).data.id);
  const sessions = await readdir(path.join(fixture.paths.mind, 'user', 'relay', 'sessions'));
  const sessionText = [];
  for (const name of sessions) sessionText.push(await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'sessions', name), 'utf8'));
  assert.equal(sessionText.some((text) => text.includes('qa040-forged-native')), false);
  assert.equal(sessionText.some((text) => text.includes('"unitId":"root:two"') || text.includes('"unit":"two"')), false);
  const inboxNames = await readdir(path.join(fixture.paths.mind, 'user', 'inbox', 'two'));
  assert.equal(inboxNames.length, 2);
  const receipts = await readdir(path.join(fixture.paths.localDirectory, 'receipts'), { recursive: true });
  assert.equal(receipts.some((name) => String(name).endsWith('.json')), true);
  const changes = await readdir(path.join(fixture.paths.localDirectory, 'staging', 'changes'));
  assert.equal(changes.length > 0, true);
  const audit = await readFile(path.join(fixture.paths.localDirectory, 'security-events.jsonl'), 'utf8');
  assert.equal(audit.includes('auth.success'), true);
  assert.equal(audit.includes('secret body of two'), false);
  assert.equal(audit.includes(token), false);
});

async function bindUnit(fixture, resourceId, unitId) {
  const directory = path.join(fixture.paths.mind, 'user', 'relay', 'editors');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${resourceId}.json`), `${JSON.stringify({
    format: 'hivem1nd-editor-binding-v1',
    resourceId,
    attached: [unitId],
  })}\n`);
}

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
