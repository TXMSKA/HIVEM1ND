import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerApproval, approvalRevision, consumeAnswers, consumeRevocations, normalizeAction, recoverApprovals, requestApproval, revokeGrant } from '../engine/service/approvals.mjs';
import { canonicalJson } from '../engine/service/identity.mjs';
import { revisionOf } from '../engine/service/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const UNIT = 'project:shop:executor-shop';

function stateText(machine, grants = null) {
  const line = grants ? `\napprovals: ${canonicalJson(grants)}` : '';
  return `unit: executor-shop\nunit-id: ${UNIT}\nrole: executor\nstate: in\nmachine: ${machine}${line}\n\nReady.\n`;
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
});

test('the owner applies one local decision and a stale dialog cannot replace it', async (t) => {
  const { fixture, context, master } = await service(t);
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
  const { fixture, context, master } = await service(t);
  const grant = { id: randomUUID(), action: 'process.run', pattern: { command: 'npm run build', cwd: 'project:shop' }, grantedAt: '2026-10-10T11:00:00.000Z', grantedBy: 'root:master' };
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md'), stateText('DESKTOP', [grant]));
  const matched = await requestApproval(context, { action: 'process.run', pattern: { command: 'npm run build', cwd: 'project:shop/' }, display: 'Build', alwaysAllowed: true });
  assert.equal(matched.prompted, false);
  assert.equal(matched.allow, true);
  assert.equal(matched.approval.grantId, grant.id);
  assert.equal((await grants(fixture)).length, 1);
  const quiet = { ...context, principal: { ...context.principal, sessionId: randomUUID() } };
  const created = await requestApproval(quiet, { action: 'network.request', pattern: { method: 'post', origin: 'https://example.com', path: '/hook' }, display: 'Call', alwaysAllowed: false });
  const revision = approvalRevision({ request: await requestBytes(fixture, created.approval.id), answers: [] });
  const resolved = await answerApproval(master, created.approval.id, { decision: 'approve', expectedRevision: revision });
  assert.equal(resolved.state, 'approved');
  assert.equal(resolved.allow, false);
  assert.equal(resolved.resumed, false);
});
