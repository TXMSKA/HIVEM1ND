import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverLyra, lyraToolDefinitions, openLyraAdapter, registerLyraTools, resolveLyraChoice, streamLyraTurn } from '../engine/service/lyra.mjs';
import { createAppTokenStore } from '../engine/service/security.mjs';
import { connectedClients } from '../engine/service/settings.mjs';
import { bindLocalTools } from '../engine/service/bridge.mjs';
import { consumeStart, readStartRequest, recoverStarts, stopSession } from '../engine/service/adapters.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { request } from '../engine/service/client.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { hashBytes } from '../engine/service/identity.mjs';

const choice = (model = 'lyra-base', mode = 'normal') => ({ client: 'lyra', model, mode, effort: null });
const models = (thinking = false) => ({ ollama: { running: true }, installed: [{ name: 'lyra-base:latest' }, ...(thinking ? [{ name: 'lyra-thinking' }] : [])],
  modes: { fast: { model: 'lyra-base' }, normal: { model: 'lyra-base' }, thinking: { model: 'lyra-thinking' } } });
const start = (mode = 'normal', model = 'lyra-base', fellBack = false) => ({ type: 'start', mode, model, fellBack, provider: 'local' });
const stream = events => new Response(events.map(event => typeof event === 'string' ? event : JSON.stringify(event)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });

function transport() {
  const state = { calls: [], app: { id: 'hivem1nd', name: 'ONEM1ND', kind: 'app', status: 'granted', scopes: ['chat', 'models', 'tools'] }, // Compatibility: Lyra app grants retain their registered identity.
    status: models(), port: 8171, token: undefined, reads: 0, stream: () => stream([start(), { type: 'text', text: 'Ready' }, { type: 'done' }]) };
  state.options = {
    discover: async () => { state.reads++; return state.offline ? null : { home: 'fixture-lyra-' + state.id, port: state.port, pid: 7777, startedAt: '2026-10-14T00:00:00Z' }; },
    bootstrap: async () => state.bootstrap,
    tokens: { get: async () => state.token, set: async value => { state.token = value; } },
    fetch: async (url, init) => {
      const route = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
      state.calls.push({ route, method: init.method, body, port: new URL(url).port, signal: init.signal });
      if (route === '/v1/apps/register') {
        assert.equal(init.headers.Authorization === `Bootstrap ${state.bootstrap}`, true);
        state.token = randomBytes(32).toString('base64url');
        return Response.json({ app: state.app, token: state.token });
      }
      if (state.unauthenticated) { state.unauthenticated = false; return Response.json({ error: { code: 'unauthenticated' } }, { status: 401 }); }
      assert.equal(init.headers.Authorization === `Bearer ${state.token}`, true);
      if (route === '/v1/apps/current') return Response.json(state.app);
      if (route === '/v1/models') return Response.json(state.status);
      if (route === '/v1/tools') return Response.json(body.tools);
      if (route === '/v1/chat') return state.stream(init);
      if (/^\/v1\/tool-calls\/[a-f0-9-]+\/result$/.test(route)) return new Response(null, { status: 204 });
      throw new Error('Unexpected supported API route');
    },
  };
  state.id = randomUUID(); state.bootstrap = randomBytes(32).toString('base64url');
  return state;
}

test('application registration is exact and pending, revoked, missing scopes and offline never advertise a connection', async t => {
  const state = transport(), adapter = openLyraAdapter(state.options); t.after(() => adapter.close());
  state.app.status = 'pending';
  assert.equal((await adapter.describe()).availability, 'lyra_pending');
  assert.deepEqual(state.calls[0].body, { id: 'hivem1nd', name: 'ONEM1ND', kind: 'app' }); // Compatibility: Lyra app grants retain their registered identity.
  state.app.status = 'revoked'; assert.equal((await adapter.describe()).availability, 'lyra_revoked');
  state.app.status = 'granted'; state.app.scopes = ['chat', 'models'];
  assert.equal((await adapter.describe()).availability, 'lyra_scopes_required');
  assert.deepEqual(await connectedClients({ adapters: { lyra: adapter } }), []);
  state.app.scopes.push('tools');
  const report = (await connectedClients({ adapters: { lyra: adapter } }))[0];
  assert.deepEqual(report.models, [{ id: 'lyra-base', title: 'Lyra base', efforts: [], modes: ['fast', 'normal', 'thinking'] }]);
  assert.deepEqual(report.quota, { known: false, remainingPercent: null, period: null });
  assert.equal(JSON.stringify(report).includes(state.token), false);
  assert.equal(JSON.stringify(report).includes(state.bootstrap), false);
  state.unauthenticated = true; await adapter.describe();
  assert.equal(state.calls.filter(call => call.route === '/v1/apps/register').length, 2);
  state.offline = true; assert.equal((await adapter.describe()).availability, 'lyra_offline');
  assert.equal(state.calls.some(call => /install|ollama|settings|shared|channel/.test(call.route)), false);
});

test('installed aliases and documented Thinking fallback are proved, without guessing physical model labels', () => {
  for (const mode of ['fast', 'normal', 'thinking']) assert.deepEqual(resolveLyraChoice(choice('lyra-base:latest', mode), models()), choice('lyra-base', mode));
  assert.deepEqual(resolveLyraChoice(choice('lyra-thinking', 'thinking'), models(true)), choice('lyra-thinking', 'thinking'));
  for (const selected of [choice('Qwen 3.5 9B'), choice('lyra-base:other'), choice('lyra-thinking', 'fast'), choice('lyra-base', 'deep'), { ...choice(), profile: 'default' }]) {
    assert.throws(() => resolveLyraChoice(selected, models(true)), { code: 'unsupported_launch_choice' });
  }
  assert.throws(() => resolveLyraChoice(choice('lyra-base', 'thinking'), models(true)), { code: 'unsupported_launch_choice' });
  assert.throws(() => resolveLyraChoice(choice(), { ...models(), ollama: { running: false } }), { code: 'unsupported_launch_choice' });
  assert.throws(() => resolveLyraChoice(choice(), { ...models(), modes: { normal: { model: 'physical' } } }), { code: 'unsupported_launch_choice' });
});

test('stream requests contain only C15 keys, wait for actual start and handle every local event', async () => {
  let body, callback = 0, accepted = 0, started = 0;
  const toolId = randomUUID(), posts = [];
  const connection = { call: async (method, route, input) => { if (route === '/v1/models') return models(); posts.push({ method, route, input }); },
    chat: async input => { body = input; return stream([start(), { type: 'thinking' }, { type: 'text', text: 'Working' },
      { type: 'tool_call', id: toolId, name: 'm1nd_read', permission: 'allowed', input: { resourceId: 'inbox' } }, { type: 'done' }]); } };
  await streamLyraTurn(connection, { choice: choice(), messages: [{ role: 'user', content: 'Plan' }], context: '{}', language: 'en', model: 'ignored', system: 'ignored' },
    { tools: ['m1nd_read'], onAccepted: () => { accepted++; assert.equal(started, 0); }, onStarted: () => started++,
      onToolCall: () => { callback++; return { output: '{}' }; } });
  assert.deepEqual(Object.keys(body).sort(), ['cloud', 'context', 'language', 'memory', 'messages', 'mode', 'priority', 'speak', 'tools']);
  assert.equal(body.priority, 'background'); assert.equal(body.memory, false); assert.equal(body.cloud, false); assert.equal(body.speak, false);
  assert.equal(accepted, 1); assert.equal(started, 1); assert.equal(callback, 1);
  assert.deepEqual(posts, [{ method: 'POST', route: `/v1/tool-calls/${toolId}/result`, input: { output: '{}' } }]);
});

test('model changes, cloud output, malformed/truncated events and pre-start callbacks abort before effects', async () => {
  let callbacks = 0;
  const connection = events => ({ call: async () => models(), chat: async () => stream(events) });
  const input = { choice: choice(), messages: [{ role: 'user', content: 'Work' }], context: '', language: 'en' };
  const tool = { type: 'tool_call', id: randomUUID(), name: 'm1nd_read', permission: 'allowed', input: { resourceId: 'inbox' } };
  for (const events of [[{ ...start(), model: 'physical' }, tool], [{ ...start(), provider: 'paid' }, tool], [{ ...start(), mode: 'fast' }],
    [tool], [start(), { type: 'text', text: 'truncated' }], [start(), '{broken'], [start(), { type: 'done' }, { type: 'text', text: 'late' }],
    [start(), { type: 'error', code: 'timeout' }], [start(), { type: 'unknown' }]]) {
    await assert.rejects(streamLyraTurn(connection(events), input, { tools: ['m1nd_read'], onToolCall: () => { callbacks++; } }));
  }
  assert.equal(callbacks, 0);
  let posted = 0;
  await assert.rejects(streamLyraTurn({ call: async () => models(true), chat: async () => { posted++; } },
    { ...input, choice: choice('lyra-base', 'thinking') }), { code: 'unsupported_launch_choice' });
  assert.equal(posted, 0);
});

test('input dimensions and byte bound fail before inference and cancel/deadline disconnect owned streams', async () => {
  const input = { choice: choice(), messages: [{ role: 'user', content: 'Work' }], context: '', language: 'en' };
  const connection = { call: async () => models(), chat: async () => { throw new Error('Inference must not start'); } };
  for (const override of [{ messages: [{ role: 'system', content: 'No' }] }, { messages: [{ role: 'user', content: 'x'.repeat(8001) }] },
    { context: 'x'.repeat(12001) }, { messages: Array.from({ length: 31 }, () => ({ role: 'user', content: 'x' })) },
    { messages: [{ role: 'user', content: 'x'.repeat(8000) }, { role: 'user', content: 'x'.repeat(8000) }, { role: 'user', content: 'x' }] },
    { messages: [{ role: 'user', content: '\0'.repeat(8000) }, { role: 'user', content: '\0'.repeat(8000) }], context: '\0'.repeat(12000) }]) {
    await assert.rejects(streamLyraTurn(connection, { ...input, ...override }), { code: 'lyra_input_limit' });
  }
  for (const cancel of [false, true]) {
    const controller = new AbortController(); let aborted = false;
    const hanging = { call: async () => models(), chat: async (_, signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('Disconnected')); }, { once: true });
    }) };
    const work = streamLyraTurn(hanging, input, { signal: controller.signal, deadlineMs: 20 });
    if (cancel) setTimeout(() => controller.abort(), 5);
    await assert.rejects(work, { code: cancel ? 'lyra_cancelled' : 'lyra_timeout' });
    assert.equal(aborted, true);
  }
});

test('the fixed private catalog registers once despite concurrent role connections', async () => {
  let writes = 0;
  const connection = { home: randomUUID(), pid: 7777, startedAt: 'fixture', call: async (method, route, body) => {
    assert.equal(method, 'PUT'); assert.equal(route, '/v1/tools'); writes++; assert.deepEqual(body.tools, lyraToolDefinitions());
  } };
  await Promise.all(Array.from({ length: 8 }, () => registerLyraTools(connection)));
  assert.equal(writes, 1);
});

test('concurrent app connections share one private registration and do not replace each other token', async t => {
  const state = transport(), first = openLyraAdapter(state.options), second = openLyraAdapter(state.options);
  t.after(async () => { await first.close(); await second.close(); });
  const reports = await Promise.all([first.describe(), second.describe()]);
  assert.equal(reports.every(report => report.connected), true);
  assert.equal(state.calls.filter(call => call.route === '/v1/apps/register').length, 1);
});

test('discovery verifies the private same-user record and health without modifying Lyra bytes', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const home = path.join(fixture.root, 'lyra'), file = path.join(home, 'run', 'service.json');
  await mkdir(path.dirname(file), { recursive: true });
  const record = { version: 1, pid: 9090, port: 8181, serviceVersion: 'fixture', startedAt: '2026-10-14T00:00:00Z' };
  await writeFile(file, JSON.stringify(record), { mode: 0o600 });
  const options = { env: { LYRA_HOME: home }, store: fixture.store, verifyOwner: async () => true,
    fetch: async (url, init) => { assert.equal(url, 'http://127.0.0.1:8181/v1/health'); assert.equal(init.redirect, 'error'); return Response.json({ ok: true, serviceVersion: 'fixture' }); } };
  const before = await readFile(file);
  assert.equal((await discoverLyra(options)).port, 8181);
  assert.deepEqual(await readFile(file), before);
  assert.equal(await discoverLyra({ ...options, verifyOwner: async () => false }), null);
  assert.equal(await discoverLyra({ ...options, fetch: async () => Response.json({ ok: true, serviceVersion: 'foreign' }) }), null);
  await writeFile(file, JSON.stringify({ ...record, port: 65536 })); assert.equal(await discoverLyra(options), null);
});

test('app credentials are protected locally and never enter published records or the home folder', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const store = createAppTokenStore({ paths: fixture.paths, store: fixture.store });
  assert.equal(await store.get(), undefined);
  const token = randomBytes(32).toString('base64url'); await store.set(token);
  assert.equal(await store.get() === token, true);
  assert.equal(fixture.store.aclRunner.calls.some(call => call.op === 'protect' && call.target.endsWith('lyra.token')), true);
  await assert.rejects(store.set('invalid'), { code: 'lyra_unavailable' });
});

test('service HTTP returns 202 while queued; start, restart discovery, end and Stop preserve separate ownership', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const state = transport(), adapter = openLyraAdapter({ ...state.options, store: fixture.store }); t.after(() => adapter.close());
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now,
    principal: { audience: 'desktop', unitId: 'root:master' }, adapters: { lyra: adapter }, ownedPids: new Set(), ownedExecutions: new Set(),
    beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() }, projects: [] };
  context.store.ownedExecutions = context.ownedExecutions;
  context.paths = { ...context.paths, origin: path.join(fixture.root, 'origin') };
  await mkdir(path.join(context.paths.origin, 'machines', 'DESKTOP'), { recursive: true });
  await writeFile(path.join(context.paths.origin, 'machines', 'DESKTOP', 'service.json'), JSON.stringify(context.beat));
  const unitId = 'root:worker', file = path.join(context.paths.mind, 'user', 'state', 'worker.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `unit: worker\nunit-id: ${unitId}\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: ${JSON.stringify(choice())}\n`);
  let release, canceled = false;
  state.stream = init => new Response(new ReadableStream({ start(controller) { release = events => { for (const event of events) controller.enqueue(Buffer.from(JSON.stringify(event) + '\n')); controller.close(); }; }, cancel() { canceled = true; } }), { headers: { 'content-type': 'application/x-ndjson' } });
  const credentials = createCredentialStore({ now: context.now }), token = credentials.issue({ audience: 'desktop' }).token;
  const http = await createHttpServer({ ...context, credentials }); t.after(() => http.close());
  const result = await request({ origin: new URL(`http://127.0.0.1:${http.port}`), token }, { method: 'POST', path: `/api/v1/units/${unitId}/session`,
    headers: { 'idempotency-key': randomUUID() }, body: { runMode: 'chat', prompt: 'Prepare', expectedRevision: hashBytes(await readFile(file)) }, timeoutMs: 3000 });
  assert.equal(result.status, 202, result.json.error?.code);
  const requestId = result.json.data.requestId;
  await until(async () => Boolean(release));
  assert.equal((await readStartRequest(context, requestId, { readOnly: true })).result, null);
  release([start(), { type: 'text', text: 'Ready' }, { type: 'done' }]);
  await until(async () => (await readStartRequest(context, requestId, { readOnly: true })).result?.state === 'started');
  const started = await readStartRequest(context, requestId, { readOnly: true });
  assert.equal(context.ownedPids.size, 0); assert.equal(context.ownedExecutions.size, 1);
  const journal = started.current; assert.equal(journal.pid, null); assert.equal(journal.executionId.length, 36);
  const proof = { unitId, client: 'lyra', nativeSessionId: journal.nativeSessionId, sessionId: started.result.sessionId, machine: 'DESKTOP' };
  await until(async () => (await adapter.observe(proof)).activity === 'idle');
  assert.equal(await adapter.confirm(proof), true);
  assert.equal((await consumeStart(context, requestId)).replayed, true);
  assert.equal(state.calls.filter(call => call.route === '/v1/chat').length, 1);
  state.port = 8182; state.unauthenticated = true;
  state.stream = () => stream([start(), { type: 'done' }]);
  assert.equal((await adapter.send({ ...proof, text: 'Next', messageIds: [randomUUID()] })).submitted, true);
  await until(async () => (await adapter.observe(proof)).activity === 'idle');
  assert.equal(state.calls.filter(call => call.route === '/v1/chat').at(-1).port, '8182');
  assert.equal(state.calls.filter(call => call.route === '/v1/tools').length, 1);
  const local = await bindLocalTools(context, proof); await local.verify();
  state.stream = () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'content-type': 'application/x-ndjson' } });
  assert.equal((await adapter.send({ ...proof, text: 'Queued turn' })).submitted, true);
  await stopSession(context, proof.sessionId, { confirmed: true });
  assert.equal(await adapter.confirm(proof), false); assert.equal(context.ownedExecutions.size, 0);
  await assert.rejects(local.verify(), { code: 'scope_unavailable' });
  assert.equal(canceled, true);
  assert.equal(state.calls.some(call => /settings|ollama|install/.test(call.route)), false);
  const recovered = await recoverStarts({ ...context, ownedExecutions: new Set() });
  assert.equal(recovered[0].state, 'stopped');
});

async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Local execution did not settle within the fixture deadline');
}
