import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lyraToolDefinitions, validateLyraInput } from '../engine/service/lyra.mjs';
import { bindLocalTools } from '../engine/service/bridge.mjs';
import { callLocalTool } from '../engine/service/mcp.mjs';
import { answerApproval, listApprovals, readApproval } from '../engine/service/approvals.mjs';
import { bindLaunchScope, prepareLaunchScope } from '../engine/service/file-access.mjs';
import { directoryIdentity } from '../engine/service/cluster-git.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { readCollection } from '../engine/service/projection.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function world(t, options = {}) {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const unitId = 'root:worker', nativeSessionId = randomUUID(), executionId = randomUUID(), sessionId = randomUUID();
  const registration = { unitId, unit: 'worker', machine: 'DESKTOP', client: 'lyra', nativeSessionId, executionId, sessionId };
  const actor = { audience: 'agent', unitId, sessionId, client: 'lyra' };
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, principal: actor, credential: actor,
    adapters: { lyra: { confirm: async proof => proof.unitId === unitId && proof.nativeSessionId === nativeSessionId && proof.client === 'lyra' } },
    ownedExecutions: new Set([executionId]), ownedPids: new Set(), projects: [] };
  context.ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: context.now, machine: 'DESKTOP' });
  const stateFile = path.join(context.paths.mind, 'user', 'state', 'worker.md'); await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `unit: worker\nunit-id: ${unitId}\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: {"client":"lyra","model":"lyra-base","effort":null,"mode":"normal"}\n`);
  const directory = path.join(fixture.root, 'work'); await mkdir(directory);
  const prepared = await prepareLaunchScope(context, { id: randomUUID(), unitId, client: 'lyra' });
  const scope = { ...prepared.scope, writeRoots: [{ realPath: directory, identity: await directoryIdentity(directory), gitCommonDir: null }] };
  await bindLaunchScope(context, scope, registration, null, executionId);
  const asks = [];
  context.decision = options.decision ?? 'approve';
  context.notify = async pending => {
    asks.push(pending);
    if (context.decision === 'wait') return;
    const approval = await readApproval(context, pending.id);
    await answerApproval({ ...context, principal: { audience: 'desktop', unitId: 'root:master' } }, pending.id,
      { decision: context.decision, expectedRevision: approval.revision });
  };
  return { fixture, context, registration, directory, asks, stateFile };
}

function event(name, input, permission = 'ask', id = randomUUID()) { return { type: 'tool_call', id, name, input, permission }; }
const call = (world, value, signal) => callLocalTool(world.context, world.registration, value, signal);

test('C15 catalog uses the actual strict ToolProperty subset and the thirteen fixed bilingual titles', () => {
  const tools = lyraToolDefinitions(); assert.equal(tools.length, 13); assert.equal(new Set(tools.map(tool => tool.name)).size, 13);
  for (const tool of tools) {
    assert.deepEqual(Object.keys(tool).sort(), ['description', 'effect', 'inputSchema', 'name', 'private', 'title']);
    assert.equal(tool.private, true); assert.equal(tool.description, tool.title.en);
    assert.equal(/^[a-z][a-z0-9_]{0,47}$/.test(tool.name), true);
    assert.equal(tool.title.en.length <= 60 && tool.title.es.length <= 60, true);
    assert.equal(Buffer.byteLength(JSON.stringify(tool.inputSchema)) <= 2048, true);
    strictProperty(tool.inputSchema);
  }
  for (const [name, optional] of [['file_write', 'expectedRevision'], ['plan_dispatch', 'taskId']]) {
    const schema = tools.find(tool => tool.name === name).inputSchema;
    assert.equal(schema.properties[optional].type, 'string'); assert.equal(schema.required.includes(optional), false);
  }
});

// Kept against Lyra packages/service/src/tools.ts's strict object/property schema.
function strictProperty(schema) {
  assert.equal(typeof schema.type, 'string');
  const keys = schema.type === 'object' ? ['type', 'properties', 'required', 'additionalProperties']
    : schema.type === 'array' ? ['type', 'items', 'maxItems']
      : schema.type === 'integer' ? ['type', 'minimum', 'maximum', 'enum'] : ['type', 'minLength', 'maxLength', 'enum'];
  assert.equal(Object.keys(schema).every(key => keys.includes(key)), true);
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false); assert.equal(Object.keys(schema.properties).length <= 16, true);
    assert.equal(schema.required.every(key => Object.hasOwn(schema.properties, key)), true);
    Object.values(schema.properties).forEach(strictProperty);
  } else if (schema.type === 'array') strictProperty(schema.items);
  else assert.equal(['integer', 'string'].includes(schema.type), true);
}

test('optional revision and task map only omission to null; actual Core IDs and revisions remain strict', () => {
  assert.deepEqual(validateLyraInput('file_write', { path: 'fixture', text: 'new' }), { path: 'fixture', text: 'new', expectedRevision: null });
  const dispatch = { runId: randomUUID(), role: 'builder', expectedRevision: 'a'.repeat(64), requestId: randomUUID() };
  assert.equal(validateLyraInput('plan_dispatch', dispatch).taskId, null);
  assert.equal(validateLyraInput('plan_dispatch', { ...dispatch, taskId: 'project:shop:029' }).taskId, 'project:shop:029');
  for (const input of [{ ...dispatch, taskId: null }, { ...dispatch, taskId: '029' }, { ...dispatch, runId: 'foreign' },
    { ...dispatch, requestId: 'FOREIGN' }, { ...dispatch, expectedRevision: 'a'.repeat(63) }, { ...dispatch, unitId: 'root:foreign' }]) {
    assert.throws(() => validateLyraInput('plan_dispatch', input));
  }
  for (const expectedRevision of [null, '', 'A'.repeat(64), 'not a revision']) assert.throws(() => validateLyraInput('file_write', { path: 'fixture', text: 'new', expectedRevision }));
  assert.throws(() => validateLyraInput('message_read', { messageIds: ['invalid'] }));
});

test('owner-bound file callbacks create only missing files, enforce revisions and replay without another write or approval', async t => {
  const worldState = await world(t), file = path.join(worldState.directory, 'new.txt');
  const create = event('file_write', { path: file, text: 'New file' });
  const result = await call(worldState, create); assert.equal(result.decision, 'once'); assert.equal(result.error, undefined);
  assert.equal(await readFile(file, 'utf8'), 'New file'); assert.equal(worldState.asks.length, 1);
  assert.deepEqual(await call(worldState, create), result); assert.equal(worldState.asks.length, 1);
  const collision = await call(worldState, event('file_write', { path: file, text: 'Collision' }));
  assert.equal(collision.error, 'failed'); assert.equal(collision.decision, undefined); assert.equal(await readFile(file, 'utf8'), 'New file');
  const mismatch = await call(worldState, event('file_write', { path: file, text: 'Changed', expectedRevision: 'a'.repeat(64) }));
  assert.equal(mismatch.error, 'failed'); assert.equal(await readFile(file, 'utf8'), 'New file');
  const changed = await call(worldState, event('file_write', { path: file, text: 'Changed', expectedRevision: hashBytes(Buffer.from('New file')) }));
  assert.equal(changed.error, undefined); assert.equal(await readFile(file, 'utf8'), 'Changed');
  const read = await call(worldState, event('file_read', { path: file, start: 1, end: 5 }, 'allowed'));
  assert.equal(read.decision, undefined); assert.equal(JSON.parse(read.output).text, 'hang');
  assert.equal(worldState.asks.every(ask => ask.alwaysAllowed === false && ask.display.includes(' / ')), true);
});

test('nulls, unknown or foreign actor fields fail before receipts and effects; stopped bindings cannot read or write', async t => {
  const state = await world(t), file = path.join(state.directory, 'none.txt');
  for (const input of [{ path: file, text: 'No', expectedRevision: null }, { path: file, text: 'No', expectedRevision: 'invalid' },
    { path: file, text: 'No', unitId: 'root:foreign' }, { path: file, text: 'No', sessionId: randomUUID() }, { path: file, text: 'No', executable: 'shell' }]) {
    await assert.rejects(call(state, event('file_write', input)));
  }
  assert.equal(state.asks.length, 0); assert.deepEqual(await readdir(state.directory), []);
  assert.deepEqual(await readdir(path.join(state.context.paths.localDirectory, 'receipts')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
  const bound = await bindLocalTools(state.context, state.registration);
  state.context.ownedExecutions.clear();
  await assert.rejects(bound.call(event('m1nd_read', { resourceId: 'inbox' }, 'allowed')), { code: 'scope_unavailable' });
});

test('one-session denial and expiration cause zero effects and never persist always or global never', async t => {
  const state = await world(t, { decision: 'deny' }), file = path.join(state.directory, 'denied.txt');
  const denied = event('file_write', { path: file, text: 'No' });
  assert.deepEqual(await call(state, denied), { error: 'denied', decision: 'once' });
  assert.deepEqual(await call(state, denied), { error: 'denied', decision: 'once' }); assert.equal(state.asks.length, 1);
  state.context.decision = 'approve'; assert.equal((await call(state, event('file_write', { path: file, text: 'Yes' }))).error, undefined);
  assert.equal(await readFile(file, 'utf8'), 'Yes');
  assert.equal((await readFile(state.stateFile, 'utf8')).includes('approvals:'), false);
  state.context.decision = 'wait'; state.context.nativeApprovalTimeoutMs = 10;
  const expired = await call(state, event('file_write', { path: file, expectedRevision: hashBytes(Buffer.from('Yes')), text: 'Expired' }));
  assert.deepEqual(expired, { error: 'denied', decision: 'once' }); assert.equal(await readFile(file, 'utf8'), 'Yes');
});

test('read tools bound excerpts, protect environment/key values and refuse service/private/Git resources', async t => {
  const state = await world(t), value = randomBytes(32).toString('base64url');
  const file = path.join(state.directory, '.env'); await writeFile(file, `API_KEY=${value}\nPORT=8080\n`);
  const read = await call(state, event('file_read', { path: file, start: 0, end: 8000 }, 'allowed'));
  assert.equal(read.output.includes(value), false); assert.equal(JSON.parse(read.output).text, 'API_KEY\nPORT');
  const key = path.join(state.directory, 'private.key'); await writeFile(key, value);
  assert.equal((await call(state, event('file_read', { path: key, start: 0, end: 8000 }, 'allowed'))).output.includes(value), false);
  await assert.rejects(call(state, event('file_read', { path: file, start: 0, end: 8001 }, 'allowed')));
  const own = await call(state, event('m1nd_read', { resourceId: 'unit:root:worker' }, 'allowed'));
  assert.equal(JSON.parse(own.output).id, 'root:worker'); assert.equal(own.decision, undefined);
  assert.equal((await call(state, event('m1nd_read', { resourceId: 'unit:root:foreign' }, 'allowed'))).error, 'failed');
  assert.equal((await call(state, event('file_read', { path: state.stateFile, start: 0, end: 8000 }, 'allowed'))).error, 'failed');
  const git = path.join(state.directory, '.git'); await mkdir(git); await writeFile(path.join(git, 'config'), value);
  assert.equal((await call(state, event('file_read', { path: path.join(git, 'config'), start: 0, end: 8000 }, 'allowed'))).error, 'failed');
});

test('outside-scope approval is separate, exact and consumed once, without widening the next callback', async t => {
  const state = await world(t), file = path.join(state.fixture.root, 'outside.txt');
  const first = await call(state, event('file_write', { path: file, text: 'Outside' }));
  assert.equal(first.error, undefined); assert.equal(state.asks.length, 2);
  assert.equal(state.asks[1].pattern.operation, 'write');
  assert.equal(await readFile(file, 'utf8'), 'Outside');
  state.context.decision = 'deny';
  assert.deepEqual(await call(state, event('file_write', { path: file, expectedRevision: hashBytes(Buffer.from('Outside')), text: 'No' })), { error: 'denied', decision: 'once' });
  assert.equal(await readFile(file, 'utf8'), 'Outside');
});

test('the fixed catalog is shared while selected plan tools capture role/session ownership and only a lead can dispatch', async t => {
  const state = await world(t), runId = randomUUID(), attemptId = randomUUID(); let dispatches = 0;
  state.context.localPlanBinding = { runId, attemptId, unitId: state.registration.unitId, sessionId: state.registration.sessionId, lead: false,
    tools: { plan_dispatch: async input => { dispatches++; assert.equal(input.taskId, null); return { attemptId: randomUUID(), requestId: input.requestId }; } } };
  const builder = await bindLocalTools(state.context, state.registration);
  assert.equal(builder.names.includes('plan_dispatch'), false); assert.equal(builder.names.length <= 16, true);
  const args = { runId, role: 'builder', expectedRevision: 'a'.repeat(64), requestId: randomUUID() };
  await assert.rejects(builder.call(event('plan_dispatch', args)), { code: 'forbidden' });
  state.context.localPlanBinding = { ...state.context.localPlanBinding, lead: true };
  const lead = await bindLocalTools(state.context, state.registration);
  assert.equal(lead.names.includes('plan_dispatch'), true);
  await assert.rejects(lead.call(event('plan_dispatch', { ...args, runId: randomUUID() })), { code: 'forbidden' });
  assert.equal(dispatches, 0);
  assert.equal((await lead.call(event('plan_dispatch', args))).error, undefined); assert.equal(dispatches, 1);
  const foreign = { ...state.registration, unitId: 'root:foreign' };
  await assert.rejects(bindLocalTools(state.context, foreign), { code: 'scope_unavailable' });
});

test('abort during an app ask leaves file bytes unchanged and settles only the owned callback', async t => {
  const state = await world(t, { decision: 'wait' }), controller = new AbortController(), file = path.join(state.directory, 'cancel.txt');
  const work = call(state, event('file_write', { path: file, text: 'No' }), controller.signal);
  const end = Date.now() + 3000;
  while (!state.asks.length && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(state.asks.length, 1); controller.abort();
  assert.deepEqual(await work, { error: 'failed' }); assert.deepEqual(await readdir(state.directory), []);
  assert.equal((await listApprovals(state.context)).items[0].alwaysAllowed, false);
});

test('authored sends and read acknowledgments need person consent and retain their durable identities on replay', async t => {
  const state = await world(t), recipient = 'root:recipient';
  await writeFile(path.join(state.context.paths.mind, 'user', 'state', 'recipient.md'), 'unit: recipient\nunit-id: root:recipient\nrole: executor\nstate: in\nmachine: DESKTOP\n');
  const send = event('message_send', { recipientIds: [recipient], text: 'Authored instruction' });
  const sent = await call(state, send); assert.equal(sent.error, undefined); assert.equal(sent.decision, 'once');
  const messageId = JSON.parse(sent.output).messages[0].messageId;
  assert.deepEqual(await call(state, send), sent); assert.equal(state.asks.length, 1);
  const messages = await readCollection(state.context, 'messages', { mailboxId: recipient });
  assert.equal(messages.items.filter(message => message.id === messageId).length, 1);
  assert.equal(messages.items.find(message => message.id === messageId).fromId, state.registration.unitId);
  state.context.decision = 'deny';
  assert.deepEqual(await call(state, event('message_send', { recipientIds: [recipient], text: 'Denied' })), { error: 'denied', decision: 'once' });
  assert.equal((await readCollection(state.context, 'messages', { mailboxId: recipient })).total, 1);
  state.context.decision = 'approve';
  const own = await call(state, event('message_send', { recipientIds: [state.registration.unitId], text: 'Own message' }));
  const ownId = JSON.parse(own.output).messages[0].messageId;
  const read = event('message_read', { messageIds: [ownId] });
  const acknowledged = await call(state, read); assert.equal(acknowledged.error, undefined); assert.equal(acknowledged.decision, 'once');
  assert.deepEqual(await call(state, read), acknowledged);
  assert.equal((await call(state, event('message_read', { messageIds: [messageId] }))).error, 'failed');
});

test('revoked app grants are checked again after an ask and cannot be turned into model consent', async t => {
  const state = await world(t), file = path.join(state.directory, 'revoked.txt'); let granted = true;
  state.context.localAppLive = async () => granted;
  const notify = state.context.notify;
  state.context.notify = async pending => { await notify(pending); granted = false; };
  const result = await call(state, event('file_write', { path: file, text: 'No' }));
  assert.equal(result.error, 'denied'); assert.deepEqual(await readdir(state.directory), []);
  await assert.rejects(call(state, event('file_write', { path: file, text: 'No', consent: true })), { code: 'lyra_revoked' });
});

test('M1ND resources and file excerpts remain scoped, valid and bounded even with escaped text', async t => {
  const state = await world(t), role = path.join(state.context.paths.mind, 'roles', 'executor.md');
  await mkdir(path.dirname(role), { recursive: true }); await writeFile(role, 'Task instructions\n'.repeat(800));
  await writeFile(path.join(state.context.paths.mind, 'rules.md'), 'Shared M1ND rules');
  for (const resourceId of ['role', 'rules', 'tasks', 'content']) {
    const result = await call(state, event('m1nd_read', { resourceId }, 'allowed'));
    assert.equal(result.error, undefined); assert.equal(result.output.length <= 8000, true); JSON.parse(result.output);
  }
  const file = path.join(state.directory, 'escaped.txt'); await writeFile(file, '\n'.repeat(8000));
  const result = await call(state, event('file_read', { path: file, start: 0, end: 8000 }, 'allowed'));
  assert.equal(result.output.length <= 8000, true); const excerpt = JSON.parse(result.output);
  assert.equal(excerpt.end, excerpt.text.length); assert.equal(excerpt.end < 8000, true);
});
