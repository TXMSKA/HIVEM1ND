import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { clearContext, compactContext, contextMeter, contextNotice, createContext, dismissContext, readContext, recoverContexts } from '../engine/service/context.mjs';
import { contextBootstrap, createChat, postChat } from '../engine/service/chats.mjs';
import { createNativeAdapter, enqueueStart, registerNative, stopSession } from '../engine/service/adapters.mjs';
import { createUnit } from '../engine/service/units.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { request } from '../engine/service/client.mjs';
import { measureLyraContext, openLyraAdapter } from '../engine/service/lyra.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { legacyTreeInventory } from '../engine/legacy-copy.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const choice = { client: 'codex', model: 'strong', effort: 'high', mode: null };
const localChoice = { client: 'lyra', model: 'lyra-base', effort: null, mode: 'normal' };

async function world(t) {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const context = { ...fixture, now: () => fixture.clock.now, ownedPids: new Set([5151]),
    principal: { audience: 'desktop', unitId: 'root:master' }, adapters: {},
    beat: { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() } };
  const file = path.join(fixture.paths.mind, 'user', 'state', 'overseer.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `unit: overseer\nunit-id: root:overseer\nrole: overseer\nstate: in\nmachine: DESKTOP\nruns-in: ${JSON.stringify(choice)}\n\nReady.\n`);
  await writeFile(path.join(fixture.paths.mind, 'rules.md'), 'Current rules.\n');
  const calls = { summary: 0, prepare: 0, commit: 0, meter: { used: 800, capacity: 1000, unit: 'tokens' }, replacements: new Map() };
  const adapter = { client: 'codex', capabilities: { create: true, stop: true }, confirm: async () => true,
    readContext: async () => calls.meter, checkpointContext: async () => ({ messages: [{ role: 'user', content: 'Keep this decision' }] }),
    contextBusy: async () => calls.busy ?? false,
    summarizeContext: async () => { calls.summary++; if (calls.failure) throw new Error('Unconfirmed'); return calls.summaryText ?? 'Keep the decision.'; },
    prepareContext: async input => { calls.prepare++; if (calls.ambiguous) throw new Error('Lost native answer'); const result = { acknowledged: true, id: input.requestId }; calls.replacements.set(input.requestId, result); return result; },
    commitContext: async input => { calls.commit++; calls.meter = { used: 20, capacity: 1000, unit: 'tokens' }; return calls.replacements.has(input.requestId); },
    stop: async () => ({ acknowledged: true }),
  };
  context.adapters.codex = adapter;
  const registration = await registerNative(context, { client: 'codex', unitId: 'root:overseer', nativeSessionId: 'native-overseer', launchKind: 'cli', runMode: 'chat' });
  const journal = path.join(fixture.paths.localDirectory, 'session-starts', `${randomUUID()}.json`);
  await mkdir(path.dirname(journal), { recursive: true });
  await writeFile(journal, JSON.stringify({ requestId: randomUUID(), sessionId: registration.sessionId, unitId: registration.unitId, client: 'codex', pid: 5151, phase: 'registered' }));
  context.ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: context.now, machine: fixture.machine });
  const chat = await createChat(context, { members: ['root:overseer'] });
  await postChat(context, chat.chat.id, { body: 'Authored history survives.', subject: 'Decision' });
  await createContext(context, registration, adapter);
  return { fixture, context, calls, registration, file };
}

async function settle(context, sessionId) { await context.store.contextJobs?.get(sessionId); return readContext(context, sessionId); }

test('actual telemetry, unknown capacity and the 79.9/80 notice boundary use no sample percentages', () => {
  assert.equal(contextNotice({ ...contextMeter({ used: 799, capacity: 1000, unit: 'tokens' }), dismissed: false }), false);
  assert.equal(contextNotice({ ...contextMeter({ used: 800, capacity: 1000, unit: 'tokens' }), dismissed: false }), true);
  for (const value of [null, { used: 18 }, { used: 82, capacity: null }, { used: -1, capacity: 100 }, { used: 1, capacity: 0 }]) assert.equal(contextMeter(value).percent, null);
  const meter = contextMeter(measureLyraContext({ messages: [{ role: 'user', content: 'x'.repeat(6392) }], context: 'y'.repeat(9600), language: 'en' }, localChoice));
  assert.equal(meter.percent, 80); assert.equal(meter.used, null); assert.equal(meter.capacity, null); assert.equal(meter.estimated, true);
  assert.deepEqual(meter.budgets, { message: { used: 6392, capacity: 8000 }, appContext: { used: 9600, capacity: 12000 }, history: { used: 6392, capacity: 16000 } });
});

test('Compact/Clear retain authored chat and M1ND bytes, reread bootstrap, and dismiss only one generation', async t => {
  const { context, fixture, calls, registration } = await world(t), id = registration.sessionId;
  const original = await legacyTreeInventory(fixture.paths.mind);
  const first = await readContext(context, id);
  await dismissContext(context, id, { expectedRevision: first.revision });
  const dismissed = await settle(context, id);
  assert.equal(dismissed.generationId, first.generationId); assert.equal(dismissed.dismissed, true);
  assert.equal(contextNotice(dismissed), false); assert.equal(calls.prepare, 0); assert.equal(calls.summary, 0);
  const compacted = await compactContext(context, id, { expectedRevision: dismissed.revision });
  assert.equal(compacted.state, 'pending');
  const after = await settle(context, id);
  assert.equal(after.operation.state, 'applied'); assert.notEqual(after.generationId, first.generationId); assert.equal(after.dismissed, false);
  assert.equal(calls.summary, 1); assert.equal(calls.prepare, 1);
  const checkpoint = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'contexts', id, `${compacted.requestId}.json`)));
  assert.ok(checkpoint.history.some(record => Buffer.from(record.bytes, 'base64').toString().includes('Authored history survives.')));
  await clearContext(context, id, { expectedRevision: after.revision });
  const cleared = await settle(context, id);
  assert.notEqual(cleared.generationId, after.generationId); assert.equal(calls.summary, 1);
  assert.deepEqual(await legacyTreeInventory(fixture.paths.mind), original);
  assert.ok(context.events.filter(event => event.name === 'session.context').every(event => Object.keys(event.data).sort().join(',') === 'revision,sessionId'));
});

test('failed, oversized and ambiguous summaries keep generation and original operation identity without replay', async t => {
  for (const failure of ['failure', 'summaryText', 'ambiguous']) {
    const { fixture, context, calls, registration } = await world(t), id = registration.sessionId;
    calls[failure] = failure === 'summaryText' ? 'x'.repeat(8001) : true;
    const original = await legacyTreeInventory(fixture.paths.mind), initial = await readContext(context, id);
    const pending = await compactContext(context, id, { expectedRevision: initial.revision });
    const failed = await settle(context, id);
    assert.equal(failed.operation.state, 'failed'); assert.equal(failed.generationId, initial.generationId); assert.equal(calls.commit, 0);
    const retry = await compactContext(context, id, { expectedRevision: initial.revision });
    assert.equal(retry.requestId, pending.requestId);
    await settle(context, id); await recoverContexts(context);
    assert.equal(calls.summary, 1); assert.deepEqual(await legacyTreeInventory(fixture.paths.mind), original);
  }
});

test('context routes authorize before private reads and receipt replay changes only one generation', async t => {
  const { context, fixture, registration, calls } = await world(t);
  const credentials = createCredentialStore({ now: context.now });
  const desktop = credentials.issue({ audience: 'desktop' }).token, phone = credentials.issue({ audience: 'phone' }).token;
  const agent = credentials.issue({ audience: 'agent', unitId: 'root:overseer', sessionId: registration.sessionId }).token;
  const http = await createHttpServer({ ...context, credentials }); t.after(() => http.close());
  const route = `/api/v1/sessions/${registration.sessionId}/context`, origin = new URL(`http://127.0.0.1:${http.port}`);
  const call = spec => request({ origin, token: spec.token }, { ...spec, headers: { 'idempotency-key': spec.idempotencyKey ?? randomUUID() }, timeoutMs: 10000 });
  for (const token of [phone, agent]) {
    const before = fixture.store.writes.length;
    assert.equal((await call({ token, method: 'GET', path: route })).status, 403);
    assert.equal((await call({ token, method: 'POST', path: route, body: { action: 'clear', expectedRevision: (await readContext(context, registration.sessionId)).revision }, idempotencyKey: randomUUID() })).status, 403);
    assert.equal(fixture.store.writes.length, before);
  }
  const initial = await readContext(context, registration.sessionId), key = randomUUID();
  const spec = { origin, token: desktop, method: 'POST', path: route, body: { action: 'clear', expectedRevision: initial.revision }, idempotencyKey: key };
  const first = await call(spec); assert.equal(first.status, 202);
  await settle(context, registration.sessionId);
  const second = await call(spec); assert.equal(second.status, 202); assert.equal(second.json.requestId, first.json.requestId); assert.equal(calls.prepare, 1);
});

test('Overseer creation with several projects never invokes a model, is unique and defaults fresh', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  fixture.paths.origin = path.join(fixture.root, 'origin');
  const beat = path.join(fixture.paths.origin, 'machines', fixture.machine, 'service.json');
  await mkdir(path.dirname(beat), { recursive: true }); await writeFile(beat, JSON.stringify({ state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() }));
  let inference = 0;
  const adapter = { describe: async () => ({ id: 'codex', connected: true, models: [{ id: 'strong', title: 'Strong', efforts: ['high'], modes: [] }], scopeEnforced: true }), create: () => inference++ };
  const context = { ...fixture, now: () => fixture.clock.now, principal: { audience: 'desktop' }, adapters: { codex: adapter }, projects: [{ name: 'one', localPath: fixture.root }, { name: 'two', localPath: fixture.root }] };
  const input = { unit: 'overseer', role: 'overseer', scope: { kind: 'root' }, machine: fixture.machine, runsIn: choice };
  assert.equal((await createUnit(context, input)).unit.fresh, true);
  await assert.rejects(createUnit(context, { ...input, unit: 'another-overseer' }), { code: 'overseer_exists' });
  assert.equal(inference, 0);
});

test('Lyra measures three distinct bounds and rejects total UTF-8 overflow independently', () => {
  const input = { messages: [{ role: 'assistant', content: 'a'.repeat(8000) }, { role: 'user', content: 'b'.repeat(8000) }], context: 'c'.repeat(12000), language: 'en' };
  assert.equal(contextMeter(measureLyraContext(input, localChoice)).percent, 100);
  for (const changed of [{ ...input, context: 'c'.repeat(12001) }, { ...input, messages: [{ role: 'user', content: 'b'.repeat(8001) }] },
    { ...input, messages: [...input.messages, { role: 'user', content: 'more' }] },
    { ...input, messages: input.messages.map(item => ({ ...item, content: '\u0001'.repeat(8000) })), context: '\u0001'.repeat(12000) }]) assert.throws(() => measureLyraContext(changed, localChoice), { code: 'lyra_input_limit' });
});

function nativeChild(onMessage) {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.pid = 5151; child.exitCode = null; child.writes = [];
  child.stdin = { write(line) { const message = JSON.parse(line); child.writes.push(message);
    queueMicrotask(() => onMessage(message, value => child.stdout.emit('data', JSON.stringify(value) + '\n'))); }, end() {} };
  child.kill = () => { child.killed = true; child.exitCode = 0; child.emit('exit', 0); };
  return child;
}

test('native Codex telemetry and bounded normal summary replace a thread only after completed output', async t => {
  const { context, calls, registration, fixture } = await world(t);
  let counter = 0;
  const child = nativeChild((message, send) => {
    if (message.id === undefined) return;
    let result = {};
    if (message.method === 'account/read') result = { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
    if (message.method === 'thread/start' || message.method === 'thread/fork') result = { thread: { id: `thread-${++counter}` }, model: 'strong', reasoningEffort: 'high', sandbox: { type: 'readOnly' } };
    if (message.method === 'thread/read') result = { thread: { id: message.params.threadId, turns: [{ id: 'original', items: [{ type: 'agentMessage', text: 'Keep this native decision.' }] }] } };
    if (message.method === 'turn/start') {
      result = { turn: { id: 'summary' } };
      send({ id: message.id, result });
      send({ method: 'item/completed', params: { threadId: message.params.threadId, item: { type: 'agentMessage', text: 'Native decision retained.' } } });
      send({ method: 'turn/completed', params: { threadId: message.params.threadId, turn: { id: 'summary', status: 'completed' } } });
      return;
    }
    send({ id: message.id, result });
  });
  const adapter = createNativeAdapter('codex', { command: 'fixture-native', spawn: () => child, timeoutMs: 1000,
    describe: async () => ({ id: 'codex', connected: true, scopeEnforced: true, models: [{ id: 'strong', title: 'Strong', efforts: ['high'], modes: [] }] }) });
  t.after(() => adapter.close());
  const created = await adapter.create({ unitId: 'root:overseer', cwd: fixture.root, model: 'strong', effort: 'high', runsIn: choice, bootstrap: await contextBootstrap(context, 'root:overseer') });
  const proof = { ...registration, nativeSessionId: created.nativeSessionId };
  await adapter.registered({}, proof, context);
  child.stdout.emit('data', JSON.stringify({ method: 'thread/tokenUsage/updated', params: { threadId: created.nativeSessionId, tokenUsage: { last: { totalTokens: 800 }, total: { totalTokens: 99999 }, modelContextWindow: 1000 } } }) + '\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await adapter.readContext(proof), { used: 800, capacity: 1000, unit: 'tokens', estimated: false });
  const requestId = randomUUID(), checkpoint = await adapter.checkpointContext(proof);
  const summary = await adapter.summarizeContext({ ...proof, requestId, checkpoint });
  assert.equal(summary, 'Native decision retained.');
  const replacement = await adapter.prepareContext({ ...proof, requestId, summary, bootstrap: 'Current M1ND rules' });
  assert.equal((await adapter.checkpointContext(proof)).threadId, created.nativeSessionId);
  assert.equal(await adapter.commitContext({ ...proof, requestId, replacement }), true);
  assert.equal((await adapter.checkpointContext(proof)).threadId, replacement.threadId);
  assert.ok(child.writes.filter(message => message.method === 'thread/start').at(-1).params.config.developer_instructions.includes('Current M1ND rules'));
  assert.equal(child.writes.some(message => /compact|shell|exec|git|delete|interrupt/.test(message.method ?? '')), false);
  assert.equal(calls.summary, 0);
});

async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('The fixture did not settle within its deadline.');
}

test('Lyra Compact uses normal chat with bounded exact inputs and Clear keeps messages without inference', async t => {
  const { context, fixture, file, registration } = await world(t);
  await stopSession(context, registration.sessionId, { confirmed: true });
  context.paths = { ...context.paths, origin: path.join(fixture.root, 'origin') };
  context.ownedExecutions = new Set(); context.store.ownedExecutions = context.ownedExecutions;
  await writeFile(file, `unit: overseer\nunit-id: root:overseer\nrole: overseer\nstate: in\nmachine: DESKTOP\nruns-in: ${JSON.stringify(localChoice)}\n\nReady.\n`);
  const calls = [], adapter = openLyraAdapter({ store: fixture.store, deadlineMs: 2000,
    discover: async () => ({ home: `fixture-${randomUUID()}`, port: 8123, pid: 7777, startedAt: '2026-10-14T00:00:00Z' }),
    tokens: { get: async () => 'a'.repeat(43) }, fetch: async (url, init) => {
      const route = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null; calls.push({ route, body });
      if (route === '/v1/apps/current') return Response.json({ id: 'hivem1nd', kind: 'app', status: 'granted', scopes: ['chat', 'models', 'tools'] });
      if (route === '/v1/models') return Response.json({ ollama: { running: true }, installed: [{ name: 'lyra-base' }], modes: { fast: { model: 'lyra-base' }, normal: { model: 'lyra-base' }, thinking: { model: 'lyra-thinking' } } });
      if (route === '/v1/tools') return Response.json(body.tools);
      if (route !== '/v1/chat') throw new Error('An unsupported Lyra endpoint was used.');
      const events = [{ type: 'start', mode: 'normal', model: 'lyra-base', provider: 'local', fellBack: false }, { type: 'text', text: body.tools.length ? 'Ready.' : 'Keep the local decision.' }, { type: 'done' }];
      return new Response(events.map(event => JSON.stringify(event)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
    } });
  context.adapters.lyra = adapter; t.after(() => adapter.close());
  const launched = await enqueueStart(context, { unitId: 'root:overseer', runMode: 'chat', prompt: 'Read current rules.', stateRevision: hashBytes(await readFile(file)) });
  const { readStartRequest } = await import('../engine/service/adapters.mjs');
  let result;
  await until(async () => { result = await readStartRequest(context, launched.request.id, { readOnly: true }); return result.result?.state === 'started'; });
  const sessionId = result.result.sessionId, proof = { nativeSessionId: result.current.nativeSessionId };
  await until(async () => (await adapter.observe(proof)).activity === 'idle');
  const original = await legacyTreeInventory(fixture.paths.mind), initial = await readContext(context, sessionId);
  assert.equal(initial.unit, 'characters'); assert.equal(initial.estimated, true); assert.equal(initial.used, null);
  const compacted = await compactContext(context, sessionId, { expectedRevision: initial.revision });
  const after = await settle(context, sessionId); assert.equal(after.operation.state, 'applied');
  const summaryBody = calls.filter(call => call.route === '/v1/chat').at(-1).body;
  assert.deepEqual(summaryBody.tools, []); assert.ok(summaryBody.messages.at(-1).content.includes('Read current rules.'));
  const beforeClear = calls.filter(call => call.route === '/v1/chat').length;
  await clearContext(context, sessionId, { expectedRevision: after.revision });
  const clear = await settle(context, sessionId); assert.equal(clear.operation.state, 'applied');
  assert.equal(calls.filter(call => call.route === '/v1/chat').length, beforeClear);
  assert.deepEqual((await adapter.checkpointContext(proof)).messages, []);
  assert.deepEqual(await legacyTreeInventory(fixture.paths.mind), original);
  assert.equal(calls.some(call => /compact|clear|shared|install|settings/.test(call.route)), false);
  assert.notEqual(clear.generationId, compacted.context.generationId);
});

test('new Overseer sessions default fresh, explicit keep reuses native context, and bootstrap stays outside authored messages', async t => {
  const { context, fixture, registration, file } = await world(t);
  await stopSession(context, registration.sessionId, { confirmed: true });
  const captured = [], transcript = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"hivem1nd"}}}',
    '{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"C:/fixture"}}',
    '{"jsonrpc":"2.0","id":2,"result":{"thread":{"id":"fixture-thread-1"}}}',
  ];
  const adapter = createNativeAdapter('codex', { fixture: true, models: ['strong'], transcript }); t.after(() => adapter.close());
  const create = adapter.create.bind(adapter);
  adapter.create = request => { captured.push(request); transcript[2] = JSON.stringify({ id: 2, result: { thread: { id: `fixture-thread-${captured.length}` } } }); return create(request); };
  context.adapters.codex = adapter;
  const start = () => enqueueStart(context, { unitId: 'root:overseer', prompt: 'Authored launch prompt.', stateRevision: hashBytes(readFileSyncFixture) });
  let readFileSyncFixture = await readFile(file);
  const first = await start(); assert.equal(captured[0].fresh, true); assert.equal(captured[0].retainedContext, null);
  assert.ok(captured[0].cwd.startsWith(fixture.paths.localDirectory));
  await stopSession(context, first.result.sessionId, { confirmed: true });
  const second = await start(); assert.equal(captured[1].retainedContext, null);
  await stopSession(context, second.result.sessionId, { confirmed: true });
  await writeFile(file, (await readFile(file, 'utf8')).replace('state: in', 'fresh: false\nstate: in'));
  readFileSyncFixture = await readFile(file);
  await start(); assert.equal(captured[2].fresh, false); assert.ok(captured[2].retainedContext.threadId.startsWith('fixture-thread-'));
  const inbox = path.join(fixture.paths.mind, 'user', 'inbox', 'overseer');
  const { readdir } = await import('node:fs/promises');
  for (const name of await readdir(inbox)) {
    const text = await readFile(path.join(inbox, name), 'utf8');
    assert.equal(text.includes('Current rules.'), false); assert.equal(text.includes('This chat remains open'), false);
  }
});

test('the session start of the longest role the kit ships fits its budget', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const kit = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(fixture.paths.mind, 'roles'), { recursive: true });
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'rules.md'), await readFile(path.join(kit, 'rules.md')));
  await writeFile(path.join(fixture.paths.mind, 'roles', 'genesis.md'), await readFile(path.join(kit, 'roles', 'genesis.md')));
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'genesis.md'), `unit: genesis\nunit-id: root:genesis\nrole: genesis\nstate: in\nmachine: ${fixture.machine}\n\nReady.\n`);
  const bootstrap = JSON.parse(await contextBootstrap({ ...fixture, now: () => fixture.clock.now }, 'root:genesis'));
  assert.equal(bootstrap.role, 'genesis');
  assert.ok(bootstrap.records[1].text.length > 12000, 'the role text alone is longer than the old budget');
});

test('a custom role starts with the text the person wrote and the brief of its project, and no role file', async t => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const state = path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'state');
  await mkdir(state, { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'rules.md'), '# Rules\n');
  await writeFile(path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'brief.md'), '# Shop\n\nA small online shop.\n');
  const description = 'Helps the person decide.\nLists the options and recommends one.';
  await writeFile(path.join(state, 'consultant-shop.md'), `unit: consultant-shop\nunit-id: project:shop:consultant-shop\nrole: custom\nrole-name: Consultant\nrole-description: ${JSON.stringify(description)}\nstate: in\nmachine: ${fixture.machine}\n\nReady.\n`);
  const bootstrap = JSON.parse(await contextBootstrap({ ...fixture, now: () => fixture.clock.now }, 'project:shop:consultant-shop'));
  assert.deepEqual(bootstrap.records.map(record => record.resource), ['rules.md', 'role', 'user/projects/shop/state/consultant-shop.md', 'user/projects/shop/brief.md']);
  assert.match(bootstrap.records[1].text, /^# Consultant\n/);
  assert.ok(bootstrap.records[1].text.includes(description));
  assert.match(bootstrap.records[3].text, /A small online shop/);
});
