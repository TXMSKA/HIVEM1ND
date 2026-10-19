import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerApproval, approvalRevision, consumeAnswers, consumeRevocations, listGrants, normalizeAction, readApproval, recoverApprovals, requestApproval, revokeGrant } from '../engine/service/approvals.mjs';
import { openSync } from '../engine/sync/store.mjs';
import { canonicalJson } from '../engine/service/identity.mjs';
import { revisionOf } from '../engine/service/store.mjs';
import { createNativeAdapter, enqueueStart } from '../engine/service/adapters.mjs';
import { dispatch } from '../engine/service/mcp.mjs';
import { validateToolArguments } from '../engine/relay/mcp.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { readProjection } from '../engine/service/projection.mjs';

const UNIT = 'project:shop:executor-shop';

function stateText(machine, grants = null) {
  const line = grants ? `\napprovals: ${canonicalJson(grants)}` : '';
  return `unit: executor-shop\nunit-id: ${UNIT}\nrole: executor\nstate: in\nmachine: ${machine}${line}\nruns-in: {"client":"codex","model":"strong","effort":"high","mode":null}\n\nReady.\n`;
}

async function service(t, machine = 'DESKTOP') {
  const fixture = await makeCoreFixture({ machine });
  t.after(() => dispose(fixture));
  const sessionId = randomUUID();
  await mkdir(path.join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await mkdir(path.join(fixture.paths.mind, 'user', 'relay', 'sessions'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md'), stateText(machine));
  await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'sessions', 'session.json'), JSON.stringify({
    kind: 'registration', sessionId, unitId: UNIT, state: 'running',
  }));
  const delays = [];
  const context = {
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    projects: ['project:shop'],
    principal: { unitId: UNIT, sessionId, audience: 'agent' },
    schedule: (_run, delay) => delays.push(delay),
    notify: async () => {},
  };
  const master = { ...context, principal: { unitId: 'root:master', audience: 'desktop', sessionId } };
  return { fixture, context, master, delays, sessionId };
}

function pattern() {
  return { command: 'npm run build', cwd: 'project:shop' };
}

function liveNative(sessionId) {
  const calls = [];
  return {
    calls,
    connected: async (id) => id === sessionId,
    resolve: async (input) => {
      calls.push(input);
      return { acknowledged: true };
    },
  };
}

async function requestBytes(fixture, id) {
  return readFile(path.join(fixture.paths.mind, 'user', 'relay', 'approvals', id, 'request.json'));
}

async function grants(fixture) {
  const text = await readFile(path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md'), 'utf8');
  const line = text.split(/\r?\n/).find((item) => item.startsWith('approvals:'));
  return line ? JSON.parse(line.slice('approvals:'.length).trim()) : [];
}

test('normalization is exact and unsupported actions stay unsupported', () => {
  const exact = normalizeAction('process.run', { command: 'npm run build', cwd: 'project:shop/' }, { projects: ['project:shop'] });
  assert.deepEqual(exact.pattern, { command: 'npm run build', cwd: 'project:shop' });
  assert.equal(exact.exact, true);
  const other = normalizeAction('process.run', { command: 'npm', cwd: 'project:shop' }, { projects: ['project:shop'] });
  assert.notEqual(canonicalJson(other.pattern), canonicalJson(exact.pattern));
  const glob = normalizeAction('process.run', { command: 'npm *', cwd: 'project:shop' }, { projects: ['project:shop'] });
  assert.equal(glob.exact, false);
  assert.equal(glob.alwaysAllowed, false);
  const file = normalizeAction('file.write', { resource: 'board', path: '..\\secret.json' });
  assert.equal(file.exact, false);
  const network = normalizeAction('network.request', { method: 'get', origin: 'https://example.com', path: '/hook' });
  assert.deepEqual(network.pattern, { method: 'GET', origin: 'https://example.com', path: '/hook' });
  assert.throws(() => normalizeAction('shell.glob', { command: '*' }), (error) => error.code === 'unsupported_action');
  const registered = normalizeAction('process.run', { command: 'npm run build', cwd: 'project:shop' }, { projects: [{ name: 'shop', localPath: 'C:/shop' }] });
  assert.equal(registered.exact, true);
  const elsewhere = normalizeAction('process.run', { command: 'npm run build', cwd: 'C:/other' }, { projects: [{ name: 'shop', localPath: 'C:/shop' }] });
  assert.equal(elsewhere.exact, false);
});

test('the owner applies one local decision and a stale dialog cannot replace it', async (t) => {
  const { fixture, context, master, sessionId } = await service(t);
  const native = liveNative(sessionId);
  context.native = native;
  master.native = native;
  await assert.rejects(() => requestApproval(context, {
    action: 'shell.glob', pattern: { command: '*' }, display: 'Nope', alwaysAllowed: false, unitId: 'env:web:overlord-web',
  }), (error) => error.code === 'unsupported_action');
  const created = await requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'Run the project build', alwaysAllowed: true });
  assert.equal(created.approval.unitId, UNIT);
  assert.equal(created.prompted, true);
  const revision = approvalRevision({ request: await requestBytes(fixture, created.approval.id), answers: [] });
  await assert.rejects(() => answerApproval(context, created.approval.id, { decision: 'approve', expectedRevision: revision }), (error) => error.status === 403);
  const resolved = await answerApproval(master, created.approval.id, { decision: 'approve-always', expectedRevision: revision });
  assert.equal(resolved.allow, true);
  assert.equal(resolved.resumed, true);
  assert.equal(native.calls.length, 1);
  assert.equal(resolved.state, 'approved');
  const saved = await grants(fixture);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, resolved.grantId);
  await assert.rejects(() => answerApproval(master, created.approval.id, { decision: 'deny', expectedRevision: revision }), (error) => error.code === 'approval_resolved');
  const current = approvalRevision({
    request: await requestBytes(fixture, created.approval.id),
    answers: [await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'answers', `${resolved.answerId}.json`))],
    result: await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'result.json')),
  });
  await assert.rejects(() => answerApproval(master, created.approval.id, { decision: 'deny', expectedRevision: current }), (error) => error.code === 'approval_resolved');
  const replay = await consumeAnswers(context, created.approval.id);
  assert.equal(replay[0].replayed, true);
  assert.equal(replay[0].allow, false);
  assert.equal((await grants(fixture)).length, 1);
  const rejected = await readdir(path.join(fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'answer-results'));
  assert.equal(rejected.length, 3);
});

test('remote answers stay queued until the owner chooses the earliest valid one', async (t) => {
  const owner = await service(t, 'LAPTOP');
  const desktop = await service(t, 'DESKTOP');
  const tablet = await service(t, 'TABLET');
  const created = await requestApproval(owner.context, { action: 'process.run', pattern: pattern(), display: 'Build', alwaysAllowed: true });
  const source = path.join(owner.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id);
  await cp(source, path.join(desktop.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id), { recursive: true });
  await cp(source, path.join(tablet.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id), { recursive: true });
  const revision = approvalRevision({ request: await requestBytes(owner.fixture, created.approval.id), answers: [] });
  const denied = await answerApproval(desktop.master, created.approval.id, { decision: 'deny', expectedRevision: revision });
  assert.equal(denied.status, 202);
  assert.equal(denied.approval.state, 'answering');
  assert.equal(denied.approval.answer.decision, 'deny');
  assert.deepEqual(denied.approval.answerOutcomes, []);
  tablet.fixture.clock.now += 5000;
  const later = await answerApproval(tablet.master, created.approval.id, { decision: 'approve-always', expectedRevision: revision });
  assert.equal(later.state, 'queued');
  await assert.rejects(() => answerApproval(desktop.master, created.approval.id, { decision: 'approve', expectedRevision: revision }), (error) => error.code === 'revision_conflict');
  const skipped = await consumeAnswers(desktop.context, created.approval.id);
  assert.equal(skipped[0].skipped, true);
  await assert.equal(await readFile(path.join(desktop.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'result.json')).then(() => true, () => false), false);
  const answers = path.join(owner.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'answers');
  await mkdir(answers, { recursive: true });
  await cp(path.join(desktop.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'answers', `${denied.answerId}.json`), path.join(answers, `${denied.answerId}.json`));
  await cp(path.join(tablet.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'answers', `${later.answerId}.json`), path.join(answers, `${later.answerId}.json`));
  const [outcome] = await consumeAnswers(owner.context, created.approval.id);
  assert.equal(outcome.state, 'denied');
  assert.equal(outcome.allow, false);
  assert.equal(outcome.grantId, null);
  assert.equal((await grants(owner.fixture)).length, 0);
  const applied = JSON.parse(await readFile(path.join(owner.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'answer-results', `${denied.answerId}.json`), 'utf8'));
  const rejected = JSON.parse(await readFile(path.join(owner.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'answer-results', `${later.answerId}.json`), 'utf8'));
  assert.equal(applied.state, 'applied');
  assert.equal(rejected.state, 'rejected');
});

test('expiry, delivery failure, and inexact always never become an allow', async (t) => {
  const { fixture, context, master, delays } = await service(t);
  context.notify = async () => { throw new Error('adapter down'); };
  await assert.rejects(() => requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'Build', alwaysAllowed: true }), (error) => error.code === 'delivery_failed');
  const failed = await readdir(path.join(fixture.paths.mind, 'user', 'relay', 'approvals'));
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'approvals', failed[0], 'result.json')).then(() => true, () => false), false);
  context.notify = async () => {};
  const inexact = await requestApproval(context, { action: 'process.run', pattern: { command: 'npm *', cwd: 'project:shop' }, display: 'Glob', alwaysAllowed: true });
  assert.equal(inexact.approval.alwaysAllowed, false);
  const revision = approvalRevision({ request: await requestBytes(fixture, inexact.approval.id), answers: [] });
  await assert.rejects(() => answerApproval(master, inexact.approval.id, { decision: 'approve-always', expectedRevision: revision }), (error) => error.code === 'always_unavailable');
  const native = liveNative(context.principal.sessionId);
  context.native = native;
  master.native = native;
  const once = await answerApproval(master, inexact.approval.id, { decision: 'approve', expectedRevision: revision });
  assert.equal(once.grantId, null);
  assert.equal(once.allow, true);
  const expiring = await requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'Wait', alwaysAllowed: true });
  assert.equal(delays.at(-1), 120000);
  const restarted = [];
  const recovered = { ...context, schedule: (_run, delay) => restarted.push(delay) };
  fixture.clock.now += 30000;
  await recoverApprovals(recovered);
  assert.equal(restarted.length, 2);
  assert.ok(restarted.every((delay) => delay === 90000));
  const before = await requestBytes(fixture, expiring.approval.id);
  fixture.clock.now = Date.parse(expiring.approval.expiresAt);
  restarted.length = 0;
  await recoverApprovals(recovered);
  assert.deepEqual(restarted, []);
  const after = await requestBytes(fixture, expiring.approval.id);
  assert.equal(before.toString('utf8'), after.toString('utf8'));
  const result = JSON.parse(await readFile(path.join(fixture.paths.mind, 'user', 'relay', 'approvals', expiring.approval.id, 'result.json'), 'utf8'));
  assert.equal(result.state, 'expired');
  assert.equal(result.grantId, null);
});

test('revoked grants stay buried and a later grant gets a new id', async (t) => {
  const { fixture, context, master } = await service(t);
  const created = await requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'Build', alwaysAllowed: true });
  const revision = approvalRevision({ request: await requestBytes(fixture, created.approval.id), answers: [] });
  const resolved = await answerApproval(master, created.approval.id, { decision: 'approve-always', expectedRevision: revision });
  const keep = { id: randomUUID(), action: 'file.write', pattern: { resource: 'note', path: 'docs/note.md' }, grantedAt: '2026-10-10T12:00:00.000Z', grantedBy: 'root:master' };
  const current = await grants(fixture);
  const statePath = path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  const withKeep = (await readFile(statePath)).toString('utf8').replace(current[0].id, current[0].id);
  const text = (await readFile(statePath, 'utf8')).replace(
    `approvals: ${canonicalJson(current)}`,
    `approvals: ${canonicalJson([...current, keep])}`,
  );
  await writeFile(statePath, text);
  const revoked = await revokeGrant(master, UNIT, resolved.grantId, { expectedRevision: revisionOf(await readFile(statePath)) });
  assert.equal(revoked.state, 'revoked');
  const remaining = await grants(fixture);
  assert.deepEqual(remaining.map((grant) => grant.id), [keep.id]);
  const tombstone = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'grant-tombstones.json'), 'utf8'));
  assert.deepEqual(tombstone.ids, [resolved.grantId]);
  await writeFile(statePath, text);
  await consumeRevocations(context);
  assert.deepEqual((await grants(fixture)).map((grant) => grant.id), [keep.id]);
  fixture.clock.now += 1000;
  const again = await requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'Build again', alwaysAllowed: true });
  const againRevision = approvalRevision({ request: await requestBytes(fixture, again.approval.id), answers: [] });
  const second = await answerApproval(master, again.approval.id, { decision: 'approve-always', expectedRevision: againRevision });
  assert.notEqual(second.grantId, resolved.grantId);
  assert.equal((await grants(fixture)).some((grant) => grant.id === resolved.grantId), false);
  assert.equal((await grants(fixture)).some((grant) => grant.id === second.grantId), true);
});

test('a remote owner applies revocation and the requester does not invent the result', async (t) => {
  const desktop = await service(t, 'DESKTOP');
  const laptop = await service(t, 'LAPTOP');
  const grant = { id: randomUUID(), action: 'process.run', pattern: pattern(), grantedAt: '2026-10-10T12:00:00.000Z', grantedBy: 'root:master' };
  const desktopState = path.join(desktop.fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  const laptopState = path.join(laptop.fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  await writeFile(desktopState, stateText('LAPTOP', [grant]));
  await writeFile(laptopState, stateText('LAPTOP', [grant]));
  const pending = await revokeGrant(desktop.master, UNIT, grant.id, { expectedRevision: revisionOf(await readFile(desktopState)) });
  assert.equal(pending.status, 202);
  assert.equal(pending.state, 'pending');
  assert.equal(await readFile(path.join(desktop.fixture.paths.mind, 'user', 'relay', 'grant-revocation-results', `${pending.requestId}.json`)).then(() => true, () => false), false);
  await consumeRevocations(desktop.context);
  assert.equal(await readFile(path.join(desktop.fixture.paths.mind, 'user', 'relay', 'grant-revocation-results', `${pending.requestId}.json`)).then(() => true, () => false), false);
  const requestPath = path.join(desktop.fixture.paths.mind, 'user', 'relay', 'grant-revocations', 'LAPTOP', `${pending.requestId}.json`);
  const target = path.join(laptop.fixture.paths.mind, 'user', 'relay', 'grant-revocations', 'LAPTOP', `${pending.requestId}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(requestPath, target);
  const [applied] = await consumeRevocations(laptop.context);
  assert.equal(applied.state, 'revoked');
  assert.equal((await grants(laptop.fixture)).length, 0);
  const result = JSON.parse(await readFile(path.join(laptop.fixture.paths.mind, 'user', 'relay', 'grant-revocation-results', `${pending.requestId}.json`), 'utf8'));
  assert.equal(result.state, 'revoked');
});

test('an existing exact grant resolves without a prompt and a dead session does not resume', async (t) => {
  const { fixture, context, master, sessionId } = await service(t);
  const grant = { id: randomUUID(), action: 'process.run', pattern: { command: 'npm run build', cwd: 'project:shop' }, grantedAt: '2026-10-10T11:00:00.000Z', grantedBy: 'root:master' };
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md'), stateText('DESKTOP', [grant]));
  const matched = await requestApproval(context, { action: 'process.run', pattern: { command: 'npm run build', cwd: 'project:shop/' }, display: 'Build', alwaysAllowed: true });
  assert.equal(matched.prompted, false);
  assert.equal(matched.allow, false);
  assert.equal(matched.resumed, false);
  assert.equal(matched.approval.grantId, grant.id);
  const native = liveNative(sessionId);
  context.native = native;
  const resumed = await requestApproval(context, { action: 'process.run', pattern: { command: 'npm run build', cwd: 'project:shop/' }, display: 'Build', alwaysAllowed: true, operationId: 'op-1' });
  assert.equal(resumed.allow, true);
  assert.equal(resumed.resumed, true);
  assert.equal(native.calls.length, 1);
  assert.equal(native.calls[0].operationId, 'op-1');
  assert.equal((await grants(fixture)).length, 1);
  const quiet = { ...context, principal: { ...context.principal, sessionId: randomUUID() } };
  const created = await requestApproval(quiet, { action: 'network.request', pattern: { method: 'post', origin: 'https://example.com', path: '/hook' }, display: 'Call', alwaysAllowed: false });
  const revision = approvalRevision({ request: await requestBytes(fixture, created.approval.id), answers: [] });
  const resolved = await answerApproval(master, created.approval.id, { decision: 'approve', expectedRevision: revision });
  assert.equal(resolved.state, 'approved');
  assert.equal(resolved.allow, false);
  assert.equal(resolved.resumed, false);
});

test('approval detail supplies the revision, selected answer and target owner', async (t) => {
  const { fixture, context, master } = await service(t);
  const created = await requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'Build', alwaysAllowed: true });
  const pending = await readApproval(context, created.approval.id);
  const revision = approvalRevision({ request: await requestBytes(fixture, created.approval.id), answers: [] });
  assert.equal(pending.revision, revision);
  assert.equal(pending.state, 'pending');
  assert.equal(pending.answer, null);
  assert.deepEqual(pending.answerOutcomes, []);
  const resolved = await answerApproval(master, created.approval.id, { decision: 'deny', expectedRevision: pending.revision });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.approval.state, 'denied');
  assert.equal(resolved.approval.answer.decision, 'deny');
  assert.equal(resolved.approval.answer.id, resolved.answerId);
  assert.equal(resolved.approval.answerOutcomes[0].state, 'applied');
  assert.equal(resolved.approval.answerOutcomes[0].resultAnswerId, resolved.answerId);
  const detail = await readApproval(context, created.approval.id);
  assert.equal(detail.revision, resolved.approval.revision);
  assert.equal(detail.answer.decision, 'deny');
  const event = fixture.store.events.filter((item) => item.name === 'approval.answered').at(-1);
  assert.equal(event.unitId, UNIT);
  assert.equal(event.source.kind, 'gui');
  assert.equal(event.source.id, fixture.machine);
  assert.notEqual(event.unitId, 'root:master');
});

test('approval commits notify the running pulse with the staged transaction', async (t) => {
  const { fixture, context, master, sessionId } = await service(t);
  const native = liveNative(sessionId);
  context.native = native;
  master.native = native;
  const shop = path.join(fixture.root, 'shop');
  await mkdir(shop);
  const sync = openSync({
    store: fixture.store,
    paths: fixture.paths,
    now: () => fixture.clock.now,
    projects: [{ name: 'shop', localPath: shop }],
  });
  sync.machine = 'SYNCBOX';
  const pulsed = [];
  const pulse = { changed: async (ids) => { pulsed.push([...ids]); return { scheduled: true }; } };
  context.sync = sync;
  context.pulse = pulse;
  context.projects = [{ name: 'shop', localPath: shop }];
  master.sync = sync;
  master.pulse = pulse;
  master.projects = context.projects;
  const created = await requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'Build', alwaysAllowed: true });
  assert.equal(pulsed.length > 0, true);
  assert.equal(context.syncOutcome, 'pending');
  const requested = pulsed.at(-1);
  const staged = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'staging', 'changes', `${requested[0]}.json`), 'utf8'));
  assert.equal(staged.machine, 'SYNCBOX');
  assert.match(staged.transactionId, /^[0-9a-f-]{36}$/);
  const beforeAnswer = pulsed.length;
  const waiting = await consumeAnswers(context, created.approval.id);
  assert.equal(waiting[0].state, 'pending');
  assert.equal(pulsed.length, beforeAnswer);
  const revision = approvalRevision({ request: await requestBytes(fixture, created.approval.id), answers: [] });
  const resolved = await answerApproval(master, created.approval.id, { decision: 'approve-always', expectedRevision: revision });
  assert.equal(pulsed.length > beforeAnswer, true);
  const afterAnswer = pulsed.length;
  const again = await consumeAnswers(context, created.approval.id);
  assert.equal(again[0].replayed, true);
  assert.equal(pulsed.length, afterAnswer);
  const state = await readFile(path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md'));
  await revokeGrant(master, UNIT, resolved.grantId, { expectedRevision: revisionOf(state) });
  assert.equal(pulsed.length > afterAnswer, true);
});

async function childWorld(t) {
  const { fixture, context, master } = await service(t);
  const native = createNativeAdapter('codex', { fixture: true, models: ['strong'], transcript: ['{"jsonrpc":"2.0","id":1,"result":{"thread":{"id":"parent-thread"}}}'] });
  const child = createNativeAdapter('cursor', { fixture: true, models: ['strong'], transcript: ['{"jsonrpc":"2.0","id":1,"result":{"sessionId":"child-session"}}'] });
  let creates = 0;
  const create = child.create.bind(child);
  child.create = async (request) => { creates += 1; return create(request); };
  context.adapters = master.adapters = { codex: native, cursor: child };
  context.projects = master.projects = [{ name: 'shop', localPath: fixture.root }];
  context.beat = master.beat = { state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() };
  context.ownedPids = master.ownedPids = new Set();
  const state = await readFile(path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md'));
  const parent = await enqueueStart(context, { unitId: UNIT, client: 'codex', runMode: 'chat', stateRevision: revisionOf(state) });
  context.principal.sessionId = parent.result.sessionId;
  context.credential = { audience: 'agent', unitId: UNIT, sessionId: parent.result.sessionId };
  const unitId = 'project:shop:executor-child';
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'executor-child.md'), `unit: executor-child\nunit-id: ${unitId}\nrole: executor\nstate: in\nmachine: DESKTOP\nruns-in: {"client":"cursor","model":"strong","effort":"high","mode":null}\n\nReady.\n`);
  return { fixture, context, master, parent, pattern: { client: 'cursor', machine: 'DESKTOP', unitId, runMode: 'chat', taskId: null }, creates: () => creates };
}

test('session.open has an exact bounded shape and never permits standing authority or shell input', async () => {
  const pattern = { client: 'codex', machine: 'DESKTOP', unitId: UNIT, runMode: 'chat', taskId: null };
  assert.equal(normalizeAction('session.open', pattern).alwaysAllowed, false);
  assert.deepEqual(normalizeAction('session.open', pattern).pattern, pattern);
  for (const extra of ['executable', 'cwd', 'environment', 'shell']) assert.throws(() => normalizeAction('session.open', { ...pattern, [extra]: 'foreign' }), { code: 'invalid_body' });
  assert.throws(() => normalizeAction('session.open', { ...pattern, runMode: 'task' }), { code: 'task_required' });
  assert.deepEqual(await validateToolArguments('session_open', pattern), pattern);
  await assert.rejects(validateToolArguments('session_open', { ...pattern, executable: 'foreign' }), { code: 'INVALID_ARGUMENTS' });
});

test('one approved session.open launches one child and replayed or synced answers cannot launch another', async (t) => {
  const world = await childWorld(t);
  const { context, master, pattern } = world;
  const requested = await requestApproval(context, { action: 'session.open', pattern, display: 'Open another CLI', alwaysAllowed: true });
  assert.equal(requested.approval.alwaysAllowed, false);
  assert.equal(world.creates(), 0);
  await assert.rejects(() => answerApproval(master, requested.approval.id, { decision: 'approve-always', expectedRevision: requested.approval.revision }), { code: 'always_unavailable' });
  const remote = { ...master, paths: { ...master.paths, machine: 'LAPTOP' } };
  const queued = await answerApproval(remote, requested.approval.id, { decision: 'approve', expectedRevision: requested.approval.revision });
  assert.equal(queued.approval.state, 'answering');
  assert.equal(world.creates(), 0);
  const consumed = await consumeAnswers(master, requested.approval.id);
  assert.equal(consumed[0].child.result.state, 'started');
  assert.equal(consumed[0].child.request.approvalId, requested.approval.id);
  assert.equal(world.creates(), 1);
  await consumeAnswers(master, requested.approval.id);
  await assert.rejects(() => answerApproval(master, requested.approval.id, { decision: 'approve', expectedRevision: queued.approval.revision }), { code: 'approval_resolved' });
  assert.equal(world.creates(), 1);
});

test('denied expired offline and unbound session requests never open a child', async (t) => {
  const world = await childWorld(t);
  const { context, master, pattern, fixture } = world;
  const denied = await requestApproval(context, { action: 'session.open', pattern, display: 'Open another CLI' });
  await answerApproval(master, denied.approval.id, { decision: 'deny', expectedRevision: denied.approval.revision });
  const expired = await requestApproval(context, { action: 'session.open', pattern, display: 'Open another CLI' });
  fixture.clock.now += 120001;
  await recoverApprovals(master);
  await assert.rejects(() => answerApproval(master, expired.approval.id, { decision: 'approve', expectedRevision: expired.approval.revision }), { code: 'approval_expired' });
  await assert.rejects(() => requestApproval(context, { action: 'session.open', pattern: { ...pattern, machine: 'LAPTOP' }, display: 'Open another CLI' }), { code: 'machine_unavailable' });
  await assert.rejects(() => requestApproval({ ...context, principal: { ...context.principal, sessionId: 'foreign' } }, { action: 'session.open', pattern, display: 'Open another CLI' }), { code: 'invalid_binding' });
  assert.equal(world.creates(), 0);
});

test('the bound MCP forwards one session approval and rejects arbitrary launch fields', async (t) => {
  const world = await childWorld(t);
  const args = { ...world.pattern, requestId: randomUUID() };
  const call = (input) => dispatch(world.context, { jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name: 'session_open', arguments: input } });
  const first = await call(args);
  assert.equal(first.result.isError, false);
  const request = JSON.parse(first.result.content[0].text).data;
  const repeated = JSON.parse((await call(args)).result.content[0].text).data;
  assert.equal(request.approval.id, repeated.approval.id);
  assert.equal(request.approval.action, 'session.open');
  assert.equal(world.creates(), 0);
  const invalid = await call({ ...args, cwd: 'foreign' });
  assert.equal(invalid.error.code, -32602);
});

test('Git classification uses literal operations, refuses ambiguity and ignores display or false overrides', async t => {
  const { fixture, context } = await service(t);
  for (const command of ['git push origin main', 'git.exe --no-pager push', '"C:\\Program Files\\Git\\bin\\git.exe" -C "C:\\work" push origin']) {
    const normalized = normalizeAction('process.run', { command, cwd: 'project:shop' }, { projects: context.projects });
    assert.equal(normalized.desktopOnly, true);
    assert.equal(normalized.alwaysAllowed, false);
    const created = await requestApproval(context, { action: 'process.run', pattern: { command, cwd: 'project:shop' }, display: 'Ordinary build', desktopOnly: false });
    assert.equal(created.approval.desktopOnly, true);
    const file = path.join(fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'request.json');
    const record = JSON.parse(await readFile(file));
    record.desktopOnly = false;
    await writeFile(file, JSON.stringify(record));
    assert.equal((await readApproval(context, created.approval.id)).desktopOnly, true);
    assert.equal((await readProjection(context)).waiting.find(item => item.approvalId === created.approval.id).desktopOnly, true);
  }
  for (const command of ['npm run build', "printf 'git push'", 'git commit -m "git push"', 'git status']) {
    assert.equal(normalizeAction('process.run', { command, cwd: 'project:shop' }, { projects: context.projects }).desktopOnly, false);
  }
  for (const command of ['git status; git push', 'git -c alias.publish=push publish', 'git publish', 'cmd /c git push', 'bash -c "git push"', 'env git push', 'call git push', 'command git push', 'git $(printf push)', 'git pu"sh"', 'git push\nnpm test', 'git push > log', "echo '& git push'", 'git.cmd push']) {
    assert.throws(() => normalizeAction('process.run', { command, cwd: 'project:shop' }, { projects: context.projects }), { code: 'unsupported_capability' });
  }
  const spoof = await requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'git push', desktopOnly: true, alwaysAllowed: false });
  assert.equal(spoof.approval.desktopOnly, false);
  assert.equal(spoof.approval.alwaysAllowed, false);
  const direct = normalizeAction('git.push', { repository: 'project:shop', args: ['origin', 'main'] }, { projects: context.projects });
  assert.equal(direct.desktopOnly, true);
  assert.equal(direct.alwaysAllowed, false);
  assert.throws(() => normalizeAction('git.push', { repository: '*', args: [] }, { projects: context.projects }), { code: 'unsupported_capability' });
});

test('phone cannot grant standing authority or answer pushes, while build and one-time commit answers work', async t => {
  const { fixture, context, master, sessionId } = await service(t);
  context.native = master.native = liveNative(sessionId);
  const phone = { ...master, principal: { ...master.principal, audience: 'phone' } };
  for (const input of [
    { action: 'git.push', pattern: { repository: 'project:shop', args: ['origin', 'main'] } },
    { action: 'process.run', pattern: { command: 'git push origin main', cwd: 'project:shop' } },
  ]) {
    const created = await requestApproval(context, { ...input, display: 'Build', alwaysAllowed: true });
    for (const decision of ['approve', 'deny', 'approve-always']) {
      await assert.rejects(answerApproval(phone, created.approval.id, { decision, expectedRevision: created.approval.revision }), { code: 'phone_read_only' });
    }
    assert.equal((await readApproval(context, created.approval.id)).state, 'pending');
    await assert.rejects(readFile(path.join(fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'result.json')), { code: 'ENOENT' });
    const desktop = await answerApproval(master, created.approval.id, { decision: 'approve', expectedRevision: created.approval.revision });
    assert.equal(desktop.allow, true);
  }
  const build = await requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'Build', alwaysAllowed: true });
  await assert.rejects(answerApproval(phone, build.approval.id, { decision: 'approve-always', expectedRevision: build.approval.revision }), { code: 'phone_read_only' });
  for (const decision of ['approve', 'deny']) for (const input of [
    { action: 'process.run', pattern: pattern() },
    { action: 'git.commit', pattern: { repository: 'project:shop', args: ['-m', 'Reviewed task'] } },
    { action: 'process.run', pattern: { command: 'git commit -m "Reviewed task"', cwd: 'project:shop' } },
  ]) {
    const created = await requestApproval(context, { ...input, display: 'git push', alwaysAllowed: false });
    assert.equal(created.approval.desktopOnly, false);
    const resolved = await answerApproval(phone, created.approval.id, { decision, expectedRevision: created.approval.revision });
    assert.equal(resolved.state, decision === 'approve' ? 'approved' : 'denied');
    assert.equal(resolved.grantId, null);
  }
  assert.deepEqual(await grants(fixture), []);
});

test('phone session.open remains a one-time approval and synced phone standing answers never create grants', async t => {
  const world = await childWorld(t);
  const phone = { ...world.master, principal: { ...world.master.principal, audience: 'phone' } };
  const child = await requestApproval(world.context, { action: 'session.open', pattern: world.pattern, display: 'Open another CLI' });
  const resolved = await answerApproval(phone, child.approval.id, { decision: 'approve', expectedRevision: child.approval.revision });
  assert.equal(resolved.child.result.state, 'started');
  assert.equal(world.creates(), 1);
  const build = await requestApproval(world.context, { action: 'process.run', pattern: pattern(), display: 'Build', alwaysAllowed: true });
  const id = randomUUID(), directory = path.join(world.fixture.paths.mind, 'user', 'relay', 'approvals', build.approval.id, 'answers');
  await mkdir(directory);
  await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ id, approvalId: build.approval.id, decision: 'approve-always', answeredBy: 'root:master', audience: 'phone', machine: 'PHONE', at: new Date(world.fixture.clock.now).toISOString() }));
  const [outcome] = await consumeAnswers(world.context, build.approval.id);
  assert.equal(outcome.state, 'pending');
  assert.deepEqual(await grants(world.fixture), []);
});

test('a revoked unit grant cannot resume the next request or leak private fields in its projection', async t => {
  const { fixture, context, master, sessionId } = await service(t);
  const grant = { id: randomUUID(), action: 'process.run', pattern: { ...pattern(), token: 'synthetic-private-field' }, grantedAt: '2026-10-10T11:00:00.000Z', grantedBy: 'root:master', endpoint: 'synthetic-private-endpoint' };
  const stateFile = path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  await writeFile(stateFile, stateText('DESKTOP', [grant]));
  const projected = await listGrants(master, UNIT);
  assert.equal(JSON.stringify(projected).includes('synthetic-private-field'), false);
  assert.equal(JSON.stringify(projected).includes('synthetic-private-endpoint'), false);
  delete grant.pattern.token;
  delete grant.endpoint;
  await writeFile(stateFile, stateText('DESKTOP', [grant]));
  let resolves = 0;
  context.native = { connected: async id => {
    assert.equal(id, sessionId);
    await revokeGrant(master, UNIT, grant.id, { expectedRevision: revisionOf(await readFile(stateFile)) });
    return true;
  }, resolve: async () => { resolves += 1; } };
  const result = await requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'Build' });
  assert.equal(result.allow, false);
  assert.equal(resolves, 0);
  const next = await requestApproval(context, { action: 'process.run', pattern: pattern(), display: 'Build again' });
  assert.equal(next.prompted, true);
  assert.equal(next.allow, false);
  assert.deepEqual((await listGrants(master, UNIT)).items, []);
});

test('the owner applies an answer and a revocation queued by another machine when its service starts', async (t) => {
  const { startService, stopService } = await import('../engine/service/service.mjs');
  const { createServer } = await import('node:net');
  const owner = await service(t, 'LAPTOP');
  const desktop = await service(t, 'DESKTOP');
  const created = await requestApproval(owner.context, { action: 'process.run', pattern: pattern(), display: 'Build', alwaysAllowed: true });
  const source = path.join(owner.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id);
  await cp(source, path.join(desktop.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id), { recursive: true });
  const revision = approvalRevision({ request: await requestBytes(owner.fixture, created.approval.id), answers: [] });
  const denied = await answerApproval(desktop.master, created.approval.id, { decision: 'deny', expectedRevision: revision });
  assert.equal(denied.status, 202);
  const answers = path.join(source, 'answers');
  await mkdir(answers, { recursive: true });
  await cp(path.join(desktop.fixture.paths.mind, 'user', 'relay', 'approvals', created.approval.id, 'answers', `${denied.answerId}.json`), path.join(answers, `${denied.answerId}.json`));
  const grant = { id: randomUUID(), action: 'process.run', pattern: pattern(), grantedAt: '2026-10-10T12:00:00.000Z', grantedBy: 'root:master' };
  const desktopState = path.join(desktop.fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  await writeFile(desktopState, stateText('LAPTOP', [grant]));
  await writeFile(path.join(owner.fixture.paths.mind, 'user', 'state', 'executor-shop.md'), stateText('LAPTOP', [grant]));
  const pending = await revokeGrant(desktop.master, UNIT, grant.id, { expectedRevision: revisionOf(await readFile(desktopState)) });
  assert.equal(pending.status, 202);
  const request = path.join(owner.fixture.paths.mind, 'user', 'relay', 'grant-revocations', 'LAPTOP', `${pending.requestId}.json`);
  await mkdir(path.dirname(request), { recursive: true });
  await cp(path.join(desktop.fixture.paths.mind, 'user', 'relay', 'grant-revocations', 'LAPTOP', `${pending.requestId}.json`), request);
  const origin = path.join(owner.fixture.root, 'origin');
  await mkdir(origin, { recursive: true });
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const guardPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const started = await startService({
    store: owner.fixture.store,
    paths: { ...owner.fixture.paths, origin },
    now: () => owner.fixture.clock.now,
    userKey: 'approvals-user',
    guardPort,
    env: owner.fixture.env,
    homeDir: owner.fixture.home,
    clients: [],
    listener: async () => ({ close: async () => {} }),
  });
  t.after(() => stopService(started, { force: true }));
  const result = JSON.parse(await readFile(path.join(source, 'result.json'), 'utf8'));
  assert.equal(result.state, 'denied');
  const revoked = JSON.parse(await readFile(path.join(owner.fixture.paths.mind, 'user', 'relay', 'grant-revocation-results', `${pending.requestId}.json`), 'utf8'));
  assert.equal(revoked.state, 'revoked');
});
