import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPlan, readPlan, editPlan, startPlan, listPlans } from '../engine/service/plans.mjs';
import { createCluster } from '../engine/service/clusters.mjs';
import { createNativeAdapter } from '../engine/service/adapters.mjs';
import { createUnit } from '../engine/service/units.mjs';
import { readDetail } from '../engine/service/projection.mjs';
import { drainRunLaunches, readRun, callPlanTool } from '../engine/service/runs.mjs';
import { closeRunProcesses } from '../engine/service/run-processes.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { request } from '../engine/service/client.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

export const runsIn = { client: 'codex', model: 'observed', effort: 'high', mode: null };
export async function makePlanFixture(t, { count = 1, role = 'executor' } = {}) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const options = { fixture: true, models: ['observed', 'alternate'], transcript: [] };
  const adapter = createNativeAdapter('codex', options), create = adapter.create.bind(adapter), launches = [];
  adapter.create = async input => { launches.push(input); options.transcript = [JSON.stringify({ id: 1, result: { thread: { id: randomUUID() } } })]; return create(input); };
  const paths = { ...fixture.paths, origin: path.join(fixture.root, 'origin') };
  await mkdir(path.join(paths.origin, 'machines', fixture.machine), { recursive: true });
  await writeFile(path.join(paths.origin, 'machines', fixture.machine, 'service.json'), JSON.stringify({ state: 'running', heartbeatAt: new Date(fixture.clock.now).toISOString() }));
  const context = { paths, store: fixture.store, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' },
    projects: [], adapters: { codex: adapter }, ownedPids: new Set(), homeDir: fixture.home, env: fixture.env, platform: fixture.platform };
  let cluster = await createCluster(context, { title: 'Planning', parentId: null, link: { kind: 'none' }, members: [], machine: fixture.machine, confirmed: true });
  const units = [];
  for (let i = 0; i < count; i++) {
    const unit = (await createUnit(context, { clusterId: cluster.id, role: i === 0 ? role : 'executor', machine: fixture.machine, runsIn,
      useAsDefault: false, expectedRevision: cluster.revision })).unit;
    units.push(unit); cluster = await readDetail(context, 'groups', cluster.id);
  }
  const taskId = 'root:001';
  await mkdir(path.join(context.paths.mind, 'user', 'tasks'), { recursive: true });
  await writeFile(path.join(context.paths.mind, 'user', 'tasks', '001.md'), `id: ${taskId}\ntitle: Actual task\nstatus: open\nfrom-id: root:master\nto-id: ${units[0].id}\nfiles: ["result.txt"]\n\n## Request\nKeep the accepted draft.\n`);
  const assignment = { kind: 'unit', unitId: units[0].id, runsIn };
  const input = { clusterId: cluster.id, chatId: cluster.chatId, machine: fixture.machine, title: 'Actual plan', branch: 'actual-plan', mode: 'planning',
    tasks: [{ id: taskId, title: 'Actual task', assignment }], roles: { coordinator: assignment, planner: assignment, builder: assignment, reviewer: assignment },
    expectedChatRevision: (await readDetail(context, 'chats', cluster.chatId)).revision };
  t.after(async () => { await drainRunLaunches(context); await closeRunProcesses(context).catch(() => {}); await adapter.close(); await dispose(fixture); });
  return { ...fixture, context, cluster, units, taskId, input, launches, nativeOptions: options };
}

test('plans resolve actual tasks and attach one revisioned card to the persistent lead chat', async t => {
  const state = await makePlanFixture(t);
  const plan = await createPlan(state.context, state.input);
  assert.equal(plan.approved, false); assert.equal(plan.tasks[0].id, state.taskId); assert.equal(state.launches.length, 0);
  assert.deepEqual((await listPlans(state.context)).items.map(item => item.id), [plan.id]);
  assert.equal((await readDetail(state.context, 'chats', state.cluster.chatId)).plans[0].id, plan.id);
  const edited = await editPlan(state.context, plan.id, { expectedRevision: plan.revision, tasks: [{ ...state.input.tasks[0], assignment: { ...state.input.tasks[0].assignment, runsIn: { ...runsIn, model: 'alternate' } } }] });
  assert.equal(edited.tasks[0].runsIn.model, 'alternate');
  assert.equal((await readDetail(state.context, 'units', state.units[0].id)).runsIn.model, 'observed');
  await assert.rejects(editPlan(state.context, plan.id, { expectedRevision: plan.revision, title: 'stale' }), { code: 'plan_changed' });
  await assert.rejects(createPlan(state.context, { ...state.input, tasks: [{ ...state.input.tasks[0], id: 'root:999' }], expectedChatRevision: (await readDetail(state.context, 'chats', state.cluster.chatId)).revision }), { code: 'task_not_found' });
});
test('sole Executor plans itself; Overlord lead and explicit no-lead selection never guess a coordinator', async t => {
  const state = await makePlanFixture(t, { count: 2, role: 'overlord' });
  const other = { kind: 'unit', unitId: state.units[1].id, runsIn };
  await assert.rejects(createPlan(state.context, { ...state.input, roles: { ...state.input.roles, coordinator: other } }), { code: 'plan_lead_required' });
  assert.equal((await createPlan(state.context, state.input)).roles.coordinator.unitId, state.units[0].id);
});
test('Run freezes the exact approval and lead intent, stays async and rejects stale edits or a second open run', async t => {
  const state = await makePlanFixture(t), plan = await createPlan(state.context, state.input);
  await assert.rejects(startPlan(state.context, plan.id, { confirmed: false, expectedRevision: plan.revision }), { code: 'invalid_plan' });
  const launched = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision });
  assert.equal(state.launches.length, 0); await drainRunLaunches(state.context);
  assert.equal(state.launches.length, 1); assert.equal(state.launches[0].runMode, 'chat');
  const bootstrap = JSON.parse(state.launches[0].bootstrap);
  assert.equal(bootstrap.plan.branch, plan.branch); assert.equal(bootstrap.plan.tasks[0].id, state.taskId);
  assert.deepEqual(bootstrap.assignment, plan.roles.coordinator);
  const run = await readRun(state.context, launched.runId);
  assert.ok(run.attempts[0].confirmedAt); assert.equal(run.watches.length, 1);
  await assert.rejects(startPlan(state.context, plan.id, { confirmed: true, expectedRevision: (await readPlan(state.context, plan.id)).revision }), { code: 'plan_already_open' });
  await assert.rejects(editPlan(state.context, plan.id, { expectedRevision: (await readPlan(state.context, plan.id)).revision, title: 'changed' }), { code: 'plan_changed' });
  const approval = JSON.parse(await readFile(path.join(state.paths.localDirectory, 'runs', run.id, 'approval.json')));
  assert.equal(approval.push, false); assert.equal(approval.messageBase, 1); assert.equal(approval.plan.branch, 'actual-plan');
});
test('strict HTTP plan bodies and phone/unbound authority reject before durable receipts', async t => {
  const state = await makePlanFixture(t), credentials = createCredentialStore({ now: state.context.now });
  const desktop = credentials.issue({ audience: 'desktop' }).token, phone = credentials.issue({ audience: 'phone' }).token;
  const agent = credentials.issue({ audience: 'agent', unitId: 'root:foreign', sessionId: randomUUID() }).token;
  const http = await createHttpServer({ ...state.context, credentials }); t.after(() => http.close());
  const call = (token, url, body, method = 'POST', key = randomUUID()) => request({ origin: new URL(`http://127.0.0.1:${http.port}`), token },
    { path: `/api/v1${url}`, method, body, headers: { 'idempotency-key': key }, timeoutMs: 3000 });
  for (const token of [phone, agent]) assert.equal((await call(token, '/plans', state.input)).status, 403);
  assert.equal((await call(desktop, '/plans', { ...state.input, authority: 'master' })).status, 400);
  const key = randomUUID(), first = await call(desktop, '/plans', state.input, 'POST', key);
  assert.equal(first.status, 201, first.raw);
  const replay = await call(desktop, '/plans', state.input, 'POST', key);
  assert.equal(replay.json.data.id, first.json.data.id); assert.equal(replay.json.meta.replayed, true);
  assert.equal((await call(phone, `/plans/${first.json.data.id}`, undefined, 'GET')).status, 403);
  assert.ok((await readdir(state.paths.localDirectory)).includes('receipts'));
});
