import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createPlan, readPlan, editPlan, startPlan, listPlans, resolvePlan } from '../engine/service/plans.mjs';
import { createCluster } from '../engine/service/clusters.mjs';
import { createNativeAdapter } from '../engine/service/adapters.mjs';
import { createUnit } from '../engine/service/units.mjs';
import { readDetail } from '../engine/service/projection.mjs';
import { drainRunLaunches, readRun, callPlanTool } from '../engine/service/runs.mjs';
import { closeRunProcesses } from '../engine/service/run-processes.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { request } from '../engine/service/client.mjs';
import { callTool, dispatch, toolSchemas } from '../engine/service/mcp.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

export const runsIn = { client: 'codex', model: 'observed', effort: 'high', mode: null };
export async function makePlanFixture(t, { count = 1, role = 'executor', task = true } = {}) {
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
  if (task) {
    await mkdir(path.join(context.paths.mind, 'user', 'tasks'), { recursive: true });
    await writeFile(path.join(context.paths.mind, 'user', 'tasks', '001.md'), `id: ${taskId}\ntitle: Actual task\nstatus: open\nfrom-id: root:master\nto-id: ${units[0].id}\nfiles: ["result.txt"]\n\n## Request\nKeep the accepted draft.\n`);
  }
  const assignment = { kind: 'unit', unitId: units[0].id, runsIn };
  const input = { clusterId: cluster.id, chatId: cluster.chatId, machine: fixture.machine, title: 'Actual plan', branch: 'actual-plan', mode: 'planning',
    tasks: task ? [{ id: taskId, title: 'Actual task', assignment }] : [], roles: { coordinator: assignment, planner: assignment, builder: assignment, reviewer: assignment },
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

const taskNames = async state => (await readdir(path.join(state.paths.mind, 'user', 'tasks')).catch(() => [])).sort();
const newTask = (title, assignment, body) => ({ title, assignment, ...(body === undefined ? {} : { body }) });

test('a plan on a cluster without any task creates its new tasks with the plan, numbered and written like the task command', async t => {
  const state = await makePlanFixture(t, { task: false }), assignment = state.input.roles.builder;
  assert.deepEqual(await taskNames(state), []);
  const plan = await createPlan(state.context, { ...state.input, tasks: [newTask('Build the cart', assignment, 'Add the cart page.\nKeep the totals.'), newTask('Ñandú: pagar!', assignment)] });
  assert.deepEqual(plan.tasks.map(task => [task.id, task.title, task.actorId]), [['root:001', 'Build the cart', state.units[0].id], ['root:002', 'Ñandú: pagar!', state.units[0].id]]);
  assert.deepEqual(await taskNames(state), ['001-build-the-cart.md', '002-nandu-pagar.md']);
  const text = await readFile(path.join(state.paths.mind, 'user', 'tasks', '001-build-the-cart.md'), 'utf8');
  assert.match(text, /^id: 001\ntask-id: root:001\ntitle: Build the cart\nstatus: open\nfrom: master\nfrom-id: root:master\nto: .+\nto-id: root:.+\ndate: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\ncluster-id: .+\nplan-id: /);
  assert.ok(text.includes(`cluster-id: ${state.cluster.id}\nplan-id: ${plan.id}\n\n## Request\nAdd the cart page.\nKeep the totals.\n\n## Report\n`));
  const first = await readDetail(state.context, 'tasks', 'root:001'), second = await readDetail(state.context, 'tasks', 'root:002');
  assert.deepEqual([first.status, first.fromId, first.toId, first.title], ['open', 'root:master', state.units[0].id, 'Build the cart']);
  assert.deepEqual([second.status, second.toId, second.request.trim()], ['open', state.units[0].id, 'Ñandú: pagar!']);
  assert.equal(state.launches.length, 0); assert.equal((await readdir(path.join(state.paths.mind, 'user', 'gui')).catch(() => [])).includes('runs'), false);
  assert.equal((await readDetail(state.context, 'chats', state.cluster.chatId)).plans[0].id, plan.id);
});
test('a rejected plan leaves no new task behind', async t => {
  const state = await makePlanFixture(t, { task: false }), assignment = state.input.roles.builder, input = { ...state.input, tasks: [newTask('One', assignment), newTask('Two', assignment)] };
  await assert.rejects(createPlan(state.context, { ...input, expectedChatRevision: 'a'.repeat(64) }), { code: 'plan_changed' });
  await assert.rejects(createPlan(state.context, { ...input, tasks: [newTask('One', assignment), newTask('Two', { ...assignment, unitId: 'root:ghost' })] }), { code: 'invalid_plan' });
  await assert.rejects(createPlan(state.context, { ...input, tasks: [newTask('One', assignment), { id: 'root:999', title: 'Two', assignment }] }), { code: 'task_not_found' });
  for (const bad of [newTask('', assignment), newTask('   ', assignment), newTask('x'.repeat(201), assignment), newTask('Two\nlines', assignment), newTask('Body', assignment, 'x'.repeat(20001)),
    newTask('Body', assignment, 'Text\n## Report\nforged'), { title: 'Extra', assignment, status: 'done' }, { ...newTask('Both', assignment), body: 7 }]) {
    await assert.rejects(createPlan(state.context, { ...input, tasks: [newTask('One', assignment), bad] }), { code: 'invalid_plan' });
  }
  await assert.rejects(createPlan(state.context, { ...input, tasks: Array.from({ length: 51 }, (_, index) => newTask(`Task ${index}`, assignment)) }), { code: 'invalid_plan' });
  assert.deepEqual(await taskNames(state), []); assert.deepEqual((await listPlans(state.context)).items, []);
  const plan = await createPlan(state.context, { ...input, tasks: Array.from({ length: 50 }, (_, index) => newTask(`Task ${index}`, assignment, 'x'.repeat(20000))) });
  assert.equal(plan.tasks.length, 50); assert.equal((await taskNames(state)).length, 50);
  const before = await taskNames(state);
  await assert.rejects(editPlan(state.context, plan.id, { expectedRevision: 'b'.repeat(64), tasks: [newTask('Late', assignment)] }), { code: 'plan_changed' });
  await assert.rejects(editPlan(state.context, plan.id, { expectedRevision: plan.revision, tasks: [{ id: plan.tasks[0].id, title: 'Kept', assignment }, newTask('Late', { ...assignment, unitId: 'root:ghost' })] }), { code: 'invalid_plan' });
  assert.deepEqual(await taskNames(state), before);
});
test('plans created back to back and concurrent edits number new tasks consecutively without collision', async t => {
  const state = await makePlanFixture(t), assignment = state.input.roles.builder;
  const revision = async () => (await readDetail(state.context, 'chats', state.cluster.chatId)).revision;
  const first = await createPlan(state.context, { ...state.input, tasks: [...state.input.tasks, newTask('Second task', assignment), newTask('Third task', assignment)] });
  const second = await createPlan(state.context, { ...state.input, title: 'Another plan', branch: 'another-plan', expectedChatRevision: await revision(), tasks: [newTask('Fourth task', assignment), newTask('Fifth task', assignment)] });
  assert.deepEqual(first.tasks.map(task => task.id), ['root:001', 'root:002', 'root:003']);
  assert.deepEqual(second.tasks.map(task => task.id), ['root:004', 'root:005']);
  const [one, two] = await Promise.all([
    editPlan(state.context, first.id, { expectedRevision: first.revision, tasks: [...first.tasks.map(({ id, title, assignment }) => ({ id, title, assignment })), newTask('Sixth task', assignment)] }),
    editPlan(state.context, second.id, { expectedRevision: second.revision, tasks: [...second.tasks.map(({ id, title, assignment }) => ({ id, title, assignment })), newTask('Seventh task', assignment)] })]);
  assert.deepEqual([one.tasks.at(-1).id, two.tasks.at(-1).id].sort(), ['root:006', 'root:007']);
  assert.deepEqual(await taskNames(state), ['001.md', '002-second-task.md', '003-third-task.md', '004-fourth-task.md', '005-fifth-task.md', '006-sixth-task.md', '007-seventh-task.md'].sort());
});
test('a new task goes to the assigned unit, or to the lead when a client is assigned, and nothing builds before Run', async t => {
  const state = await makePlanFixture(t, { count: 2, role: 'overlord', task: false }), [lead, member] = state.units;
  const direct = { kind: 'client', client: 'codex', runsIn, reuseRole: null };
  const plan = await createPlan(state.context, { ...state.input, tasks: [newTask('For the member', { kind: 'unit', unitId: member.id, runsIn }), newTask('For whoever builds', direct)] });
  assert.deepEqual([(await readDetail(state.context, 'tasks', 'root:001')).toId, (await readDetail(state.context, 'tasks', 'root:002')).toId], [member.id, lead.id]);
  assert.deepEqual(plan.tasks.map(task => task.actorId), [member.id, `plan:${plan.id}:builder`]);
  assert.equal(state.launches.length, 0);
  const started = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); assert.equal(state.launches.length, 0);
  await drainRunLaunches(state.context); assert.equal(state.launches.length, 1);
  assert.equal(JSON.parse(state.launches[0].bootstrap).plan.tasks[0].id, 'root:001'); assert.ok(started.runId);
});
test('with several Executors and no lead a client assignment cannot address a new task', async t => {
  const state = await makePlanFixture(t, { count: 2, task: false }), direct = { kind: 'client', client: 'codex', runsIn, reuseRole: null };
  await assert.rejects(createPlan(state.context, { ...state.input, tasks: [newTask('Nobody', direct)] }), { code: 'invalid_plan' });
  assert.deepEqual(await taskNames(state), []);
});
test('new tasks of an execution plan create no branch before Run', async t => {
  const state = await makePlanFixture(t, { task: false }), directory = path.join(state.root, 'plan-repository'); await mkdir(directory);
  const env = { ...state.env, PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
  state.context.env = env; state.context.probeAgents = async () => ({}); state.context.kitPath = state.root;
  const git = async (...args) => (await promisify(execFile)('git', args, { cwd: directory, env, windowsHide: true, timeout: 15000 })).stdout;
  await git('init', '--initial-branch=main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.test');
  await git('config', 'commit.gpgSign', 'false'); await git('config', 'core.hooksPath', path.join(directory, 'no-hooks'));
  await writeFile(path.join(directory, 'result.txt'), 'Before\n'); await git('add', '.'); await git('commit', '-m', 'Initial fixture');
  const { createClusterLink, readMachineSettings } = await import('../engine/service/settings.mjs'), { patchCluster } = await import('../engine/service/clusters.mjs');
  const report = await readMachineSettings(state.context, state.machine, 'projects');
  const mapping = await createClusterLink(state.context, { machine: state.machine, kind: 'repository', path: directory, expectedReportRevision: report.revision });
  const cluster = await patchCluster(state.context, state.cluster.id, { machine: state.machine, link: mapping.link, expectedRevision: state.cluster.revision });
  await writeFile(path.join(state.paths.localDirectory, 'client-permissions.json'), JSON.stringify({ permissions: [{ id: randomUUID(), machine: state.machine, client: 'codex', actions: ['git.commit', 'git.push'], scope: 'hivem1nd-started-sessions', grantedAt: new Date(state.clock.now).toISOString(), grantedBy: 'root:master' }] }));
  const input = { ...state.input, mode: 'execution', expectedChatRevision: (await readDetail(state.context, 'chats', cluster.chatId)).revision,
    tasks: [newTask('Change the result', state.input.roles.builder, 'files: ["result.txt"]')] };
  const plan = await createPlan(state.context, input);
  assert.equal((await git('branch', '--list', 'actual-plan')).trim(), ''); assert.equal((await git('rev-parse', '--abbrev-ref', 'HEAD')).trim(), 'main');
  assert.equal(state.launches.length, 0); assert.deepEqual(await taskNames(state), ['001-change-the-result.md']);
  await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); await drainRunLaunches(state.context);
  assert.equal((await git('rev-parse', '--abbrev-ref', 'HEAD')).trim(), 'actual-plan'); assert.equal(state.launches.length, 1);
});
test('new task items reach the plan routes only through the desktop', async t => {
  const state = await makePlanFixture(t, { task: false }), credentials = createCredentialStore({ now: state.context.now });
  const desktop = credentials.issue({ audience: 'desktop' }).token, phone = credentials.issue({ audience: 'phone' }).token;
  const agent = credentials.issue({ audience: 'agent', unitId: state.units[0].id, sessionId: randomUUID() }).token;
  const http = await createHttpServer({ ...state.context, credentials }); t.after(() => http.close());
  const call = (token, url, body, method = 'POST') => request({ origin: new URL(`http://127.0.0.1:${http.port}`), token },
    { path: `/api/v1${url}`, method, body, headers: { 'idempotency-key': randomUUID() }, timeoutMs: 3000 });
  const input = { ...state.input, tasks: [newTask('Over HTTP', state.input.roles.builder, 'The body.')] };
  for (const token of [phone, agent]) assert.equal((await call(token, '/plans', input)).status, 403);
  assert.deepEqual(await taskNames(state), []);
  assert.equal((await call(desktop, '/plans', { ...input, tasks: [{ ...input.tasks[0], id: 'root:001' }] })).status, 422);
  const created = await call(desktop, '/plans', input); assert.equal(created.status, 201, created.raw);
  assert.deepEqual(created.json.data.tasks.map(task => task.id), ['root:001']); assert.deepEqual(await taskNames(state), ['001-over-http.md']);
  const more = [...created.json.data.tasks.map(({ id, title, assignment }) => ({ id, title, assignment })), newTask('More', state.input.roles.builder)];
  for (const token of [phone, agent]) assert.equal((await call(token, `/plans/${created.json.data.id}`, { expectedRevision: created.json.data.revision, tasks: more }, 'PATCH')).status, 403);
  assert.deepEqual(await taskNames(state), ['001-over-http.md']);
  const edited = await call(desktop, `/plans/${created.json.data.id}`, { expectedRevision: created.json.data.revision, tasks: more }, 'PATCH');
  assert.equal(edited.status, 200, edited.raw); assert.deepEqual(edited.json.data.tasks.map(task => task.id), ['root:001', 'root:002']);
});

test('before Run the card can hand a task the plan created to any member and the task file is re-addressed in the same transaction', async t => {
  const state = await makePlanFixture(t, { count: 2, role: 'overlord', task: false }), [lead, member] = state.units;
  const toMember = { kind: 'unit', unitId: member.id, runsIn }, toLead = { kind: 'unit', unitId: lead.id, runsIn }, direct = { kind: 'client', client: 'codex', runsIn, reuseRole: null };
  const plan = await createPlan(state.context, { ...state.input, tasks: [newTask('Build the cart', toLead, 'Add the page.'), newTask('Test the cart', toLead)] });
  const file = id => path.join(state.paths.mind, 'user', 'tasks', id === 'root:001' ? '001-build-the-cart.md' : '002-test-the-cart.md');
  assert.match(await readFile(file('root:001'), 'utf8'), new RegExp(`\\nplan-id: ${plan.id}\\n`));
  const items = (...assignments) => plan.tasks.map(({ id, title }, index) => ({ id, title, assignment: assignments[index] }));
  const before = await readFile(file('root:002'), 'utf8');
  const edited = await editPlan(state.context, plan.id, { expectedRevision: plan.revision, tasks: items(toMember, toLead) });
  assert.deepEqual(edited.tasks.map(task => task.actorId), [member.id, lead.id]);
  const first = await readFile(file('root:001'), 'utf8');
  assert.match(first, new RegExp(`\\nto: ${member.id.split(':').at(-1)}\\nto-id: ${member.id}\\n`)); assert.equal(await readFile(file('root:002'), 'utf8'), before);
  assert.equal(first.includes('plan-id'), true); assert.equal(first.includes('## Request\nAdd the page.\n\n## Report\n'), true);
  assert.deepEqual([(await readDetail(state.context, 'tasks', 'root:001')).toId, (await readDetail(state.context, 'tasks', 'root:002')).toId], [member.id, lead.id]);
  const back = await editPlan(state.context, edited.id, { expectedRevision: edited.revision, tasks: items(direct, toMember) });
  assert.deepEqual(back.tasks.map(task => task.actorId), [`plan:${plan.id}:builder`, member.id]);
  assert.deepEqual([(await readDetail(state.context, 'tasks', 'root:001')).toId, (await readDetail(state.context, 'tasks', 'root:002')).toId], [lead.id, member.id]);
  const stale = await readFile(file('root:002'), 'utf8');
  await assert.rejects(editPlan(state.context, back.id, { expectedRevision: plan.revision, tasks: items(toLead, toLead) }), { code: 'plan_changed' });
  await assert.rejects(editPlan(state.context, back.id, { expectedRevision: back.revision, tasks: items(toLead, { ...toLead, unitId: 'root:ghost' }) }), { code: 'invalid_plan' });
  assert.equal(await readFile(file('root:002'), 'utf8'), stale);
  assert.equal((await readDetail(state.context, 'tasks', 'root:001')).toId, lead.id); assert.equal(state.launches.length, 0);
});
test('after Run the plan tasks cannot be re-addressed and an existing task keeps its addressee rule', async t => {
  const state = await makePlanFixture(t, { count: 2, role: 'overlord' }), [lead, member] = state.units, toMember = { kind: 'unit', unitId: member.id, runsIn }, toLead = { kind: 'unit', unitId: lead.id, runsIn };
  const created = await createPlan(state.context, { ...state.input, tasks: [state.input.tasks[0], newTask('Made by the plan', toLead)] });
  const existing = created.tasks[0], fresh = created.tasks[1], freshFile = path.join(state.paths.mind, 'user', 'tasks', '002-made-by-the-plan.md');
  await assert.rejects(editPlan(state.context, created.id, { expectedRevision: created.revision, tasks: [{ id: existing.id, title: existing.title, assignment: toMember }, { id: fresh.id, title: fresh.title, assignment: toLead }] }), { code: 'invalid_plan' });
  assert.equal((await readDetail(state.context, 'tasks', existing.id)).toId, lead.id);
  const started = await startPlan(state.context, created.id, { confirmed: true, expectedRevision: created.revision }); await drainRunLaunches(state.context);
  const approved = await readPlan(state.context, created.id), bytes = await readFile(freshFile, 'utf8');
  await assert.rejects(editPlan(state.context, approved.id, { expectedRevision: approved.revision, tasks: approved.tasks.map(({ id, title }) => ({ id, title, assignment: toMember })) }), { code: 'plan_changed' });
  await assert.rejects(resolvePlan(state.context, { ...approved, tasks: [{ id: fresh.id, title: fresh.title, assignment: toMember }] }, approved.id), { code: 'invalid_plan' });
  await resolvePlan(state.context, { ...approved, tasks: [{ id: fresh.id, title: fresh.title, assignment: toLead }] }, approved.id);
  assert.equal(await readFile(freshFile, 'utf8'), bytes); assert.equal((await readDetail(state.context, 'tasks', fresh.id)).toId, lead.id); assert.ok(started.runId);
});

async function agentSession(state, unit) {
  const sessionId = randomUUID(), registrationId = randomUUID(), directory = path.join(state.paths.mind, 'user', 'relay', 'sessions');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${registrationId}.json`), JSON.stringify({ kind: 'registration', registrationId, instanceId: `service-${state.machine}`, sessionId,
    unit: unit.id.split(':').at(-1), unitId: unit.id, scopeId: 'root', nativeSessionId: `native-${sessionId}`, client: 'codex', machine: state.machine,
    registeredAt: new Date(state.clock.now).toISOString() }));
  const actor = { audience: 'agent', unitId: unit.id, sessionId, client: 'codex' };
  return { ...state.context, principal: actor, credential: actor };
}
const propose = (clusterId, extra = {}) => ({ clusterId, title: 'Cart plan', tasks: [{ title: 'Build the cart', body: 'Add the page.' }, { title: 'Test the cart' }], requestId: randomUUID(), ...extra });

test('only the lead of a cluster can propose a plan, which waits as an unapproved card with its new tasks assigned to the lead', async t => {
  const state = await makePlanFixture(t, { count: 2, role: 'overlord', task: false }), [lead, member] = state.units;
  const chatDirectory = path.join(state.paths.mind, 'user', 'relay', 'chats', state.cluster.chatId), before = await readdir(chatDirectory);
  const leadSession = await agentSession(state, lead), memberSession = await agentSession(state, member);
  const input = propose(state.cluster.id), proposed = await callTool(leadSession, 'plan_propose', input);
  assert.deepEqual(proposed.tasks.map(task => [task.id, task.title]), [['root:001', 'Build the cart'], ['root:002', 'Test the cart']]);
  assert.equal(proposed.chatId, state.cluster.chatId); assert.equal(proposed.branch, 'plan-cart-plan');
  const plan = await readPlan(state.context, proposed.planId);
  assert.equal(plan.approved, false); assert.equal(plan.mode, 'planning'); assert.equal(plan.chatId, state.cluster.chatId);
  assert.deepEqual(plan.tasks.map(task => [task.actorId, task.state]), [[lead.id, 'todo'], [lead.id, 'todo']]);
  for (const role of ['coordinator', 'planner', 'builder', 'reviewer']) assert.deepEqual([plan.roles[role].kind, plan.roles[role].unitId], ['unit', lead.id]);
  assert.deepEqual((await readDetail(state.context, 'chats', state.cluster.chatId)).plans.map(card => card.id), [plan.id]);
  assert.deepEqual([(await readDetail(state.context, 'tasks', 'root:001')).toId, (await readDetail(state.context, 'tasks', 'root:002')).toId], [lead.id, lead.id]);
  assert.deepEqual((await readdir(chatDirectory)).filter(name => !before.includes(name)), []);
  assert.equal(state.launches.length, 0);
  const replay = await callTool(leadSession, 'plan_propose', input);
  assert.equal(replay.planId, proposed.planId); assert.equal((await listPlans(state.context)).items.length, 1); assert.deepEqual(await taskNames(state), ['001-build-the-cart.md', '002-test-the-cart.md']);
  await assert.rejects(callTool(leadSession, 'plan_propose', propose(state.cluster.id, { requestId: input.requestId, title: 'Another title' })), { code: 'idempotency_conflict' });
  await assert.rejects(callTool(memberSession, 'plan_propose', propose(state.cluster.id)), { code: 'forbidden' });
  await assert.rejects(callTool(leadSession, 'plan_propose', propose(randomUUID())), { code: 'forbidden' });
  await assert.rejects(callTool({ ...state.context, principal: { audience: 'desktop', unitId: 'root:master' }, credential: undefined }, 'plan_propose', propose(state.cluster.id)), { code: 'forbidden' });
  await assert.rejects(callTool({ ...leadSession, principal: { ...leadSession.principal, sessionId: randomUUID() }, credential: { ...leadSession.credential, sessionId: randomUUID() } }, 'plan_propose', propose(state.cluster.id)), { code: 'forbidden' });
  assert.equal((await listPlans(state.context)).items.length, 1); assert.equal((await taskNames(state)).length, 2);
  const edited = await editPlan(state.context, plan.id, { expectedRevision: plan.revision, tasks: plan.tasks.map(({ id, title }) => ({ id, title, assignment: { kind: 'unit', unitId: member.id, runsIn } })) });
  assert.deepEqual(edited.tasks.map(task => task.actorId), [member.id, member.id]);
  assert.deepEqual([(await readDetail(state.context, 'tasks', 'root:001')).toId, (await readDetail(state.context, 'tasks', 'root:002')).toId], [member.id, member.id]);
});
test('a proposal keeps the same limits as a drafted plan and a sole Executor leads its own cluster', async t => {
  const state = await makePlanFixture(t, { task: false }), session = await agentSession(state, state.units[0]);
  for (const bad of [propose(state.cluster.id, { tasks: [] }), propose(state.cluster.id, { tasks: [{ title: '' }] }), propose(state.cluster.id, { tasks: [{ title: 'Role', role: 'builder' }] }),
    propose(state.cluster.id, { tasks: [{ title: 'Body', body: 'x'.repeat(20001) }] }), propose(state.cluster.id, { branch: '../outside' }), propose(state.cluster.id, { title: '' })]) {
    await assert.rejects(callTool(session, 'plan_propose', bad), { code: 'invalid_plan' });
  }
  await assert.rejects(callTool(session, 'plan_propose', { ...propose(state.cluster.id), assignment: {} }), { code: 'invalid_plan' });
  assert.deepEqual((await listPlans(state.context)).items, []); assert.deepEqual(await taskNames(state), []);
  const proposed = await callTool(session, 'plan_propose', { clusterId: state.cluster.id, title: 'Solo', branch: 'solo-plan', tasks: [{ title: 'Only task' }] });
  assert.deepEqual([proposed.branch, proposed.tasks.length], ['solo-plan', 1]); assert.equal(state.launches.length, 0);
});
test('plan_propose is listed with a strict schema and reaches only a bound lead session over MCP', async t => {
  const state = await makePlanFixture(t, { task: false }), credentials = createCredentialStore({ now: state.context.now });
  const tool = toolSchemas().find(item => item.name === 'plan_propose');
  assert.deepEqual(tool.inputSchema.required, ['clusterId', 'title', 'tasks']); assert.equal(tool.inputSchema.additionalProperties, false);
  const session = await agentSession(state, state.units[0]), phone = credentials.issue({ audience: 'phone' }).token;
  const message = (id, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'plan_propose', arguments: args } });
  const refused = await dispatch(session, message(1, { clusterId: state.cluster.id, title: 'x', tasks: [{ title: 'x' }], extra: true }));
  assert.equal(refused.error.code, -32602);
  assert.equal((await dispatch(session, message(2, { clusterId: state.cluster.id, title: 'x' }))).error.code, -32602);
  const done = await dispatch(session, message(3, { clusterId: state.cluster.id, title: 'Over MCP', tasks: [{ title: 'Task one' }] }));
  assert.equal(done.result.isError, false); assert.equal(JSON.parse(done.result.content[0].text).data.tasks[0].id, 'root:001');
  const http = await createHttpServer({ ...state.context, credentials }); t.after(() => http.close());
  const call = (token, url, body, method = 'POST') => request({ origin: new URL(`http://127.0.0.1:${http.port}`), token },
    { path: `/api/v1${url}`, method, body, headers: { 'idempotency-key': randomUUID() }, timeoutMs: 3000 });
  const agent = credentials.issue({ audience: 'agent', unitId: state.units[0].id, sessionId: session.principal.sessionId }).token;
  const plans = (await listPlans(state.context)).items;
  assert.equal(plans.length, 1);
  for (const token of [phone, agent]) {
    assert.equal((await call(token, '/plans', { ...state.input, tasks: [newTask('Forbidden', state.input.roles.builder)] })).status, 403);
    assert.equal((await call(token, `/plans/${plans[0].id}`, { expectedRevision: plans[0].revision, title: 'Forbidden' }, 'PATCH')).status, 403);
    assert.equal((await call(token, `/plans/${plans[0].id}/run`, { confirmed: true, expectedRevision: plans[0].revision })).status, 403);
  }
  assert.equal((await readPlan(state.context, plans[0].id)).title, 'Over MCP'); assert.deepEqual(await taskNames(state), ['001-task-one.md']); assert.equal(state.launches.length, 0);
});
