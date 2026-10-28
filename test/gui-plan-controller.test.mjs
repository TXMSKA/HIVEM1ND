import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi, dispose } from '../gui/app/api.mjs';
import { createPlanController, controlPlan, planBranch, planCardModel, planTaskItem, runPlan, savePlanDraft, tasksFromVoidText } from '../gui/app/plan-controller.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { drainRunLaunches, readRun } from '../engine/service/runs.mjs';
import { makePlanFixture } from './service-plans.test.mjs';

test('actual-core draft edits and a lost Run response reuse one approval, branch and launch operation', async t => {
  const state = await makePlanFixture(t), credentials = createCredentialStore({ now: state.context.now });
  const server = await createHttpServer({ ...state.context, credentials }); t.after(() => server.close());
  const calls = []; let lost = true;
  const api = createApi({ location: { origin: `http://127.0.0.1:${server.port}`, hash: '' }, fetch: async (url, init) => {
    const response = await fetch(url, init);
    if (init.method === 'POST' && new URL(url).pathname.endsWith('/run')) {
      calls.push(init.headers['Idempotency-Key']); if (lost) { lost = false; await response.arrayBuffer(); throw new Error('Lost reply'); }
    }
    return response;
  } });
  api.token = credentials.issue({ audience: 'desktop' }).token; t.after(() => dispose(api));
  const controller = createPlanController(api);
  const created = await savePlanDraft(controller, state.input);
  const draft = structuredClone(created); draft.title = 'Reviewed inline'; draft.branch = 'reviewed-plan';
  draft.tasks[0].assignment.runsIn.model = 'alternate';
  const edited = await savePlanDraft(controller, draft, created);
  assert.equal(edited.tasks[0].runsIn.model, 'alternate'); assert.equal(edited.branch, 'reviewed-plan');
  await assert.rejects(runPlan(controller, edited));
  const retry = await runPlan(controller, edited); await drainRunLaunches(state.context);
  assert.deepEqual(calls, [calls[0], calls[0]]); assert.equal(state.launches.length, 1);
  const run = await readRun(state.context, retry.data.runId); assert.equal(run.planId, created.id);
  const model = planCardModel(controller, controller.plans.get(created.id), 'en');
  assert.equal(model.phase, 'running'); assert.equal(model.branch, 'reviewed-plan');
  await controlPlan(controller, run, 'stop_run');
});

test('warning controls bind the original attempt, episode and unread pointer without fabricating cleanup', async () => {
  const bodies = [];
  const plan = { id: 'p', title: 'Plan', branch: 'branch', roles: { coordinator: { kind: 'unit', unitId: 'lead' } }, tasks: [], approved: true };
  const run = { id: 'r', planId: 'p', revision: 'rev', state: 'open', budget: { base: 1, used: 0 }, attempts: [], watches: [],
    alerts: [{ id: 'episode', kind: 'unread', resolved: false, messageId: 'original', recipientId: 'agent', told: [{ target: 'coordinator' }] }] };
  const api = createApi({ location: { origin: 'http://127.0.0.1:9', hash: '' }, fetch: async (url, init) => {
    if (init.method === 'POST') bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data: new URL(url).pathname.includes('/plans/') ? plan : run, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      meta: { requestId: 'fixture', readAt: '2026-10-15T12:00:00Z', eventCursor: 'fixture:1', sync: 'local' } }));
  } }); api.token = 'fixture';
  const controller = createPlanController(api); controller.runs.set(run.id, run);
  assert.equal(planCardModel(controller, plan, 'en').problem.kind, 'unreadProblem');
  await controlPlan(controller, run, 'resend', run.alerts[0]);
  assert.deepEqual(bodies[0], { action: 'resend', expectedRevision: 'rev', messageId: 'original', recipientId: 'agent' });
  assert.equal(controller.runs.get('r').state, 'open');
});

test('new task rows are sent without an id, with a body only when it has one, and existing tasks keep their id', async t => {
  const state = await makePlanFixture(t, { task: false }), credentials = createCredentialStore({ now: state.context.now });
  const server = await createHttpServer({ ...state.context, credentials }); t.after(() => server.close());
  const sent = [], api = createApi({ location: { origin: `http://127.0.0.1:${server.port}`, hash: '' }, fetch: async (url, init) => {
    if (init.method !== 'GET') sent.push({ method: init.method, body: JSON.parse(init.body) });
    return fetch(url, init);
  } });
  api.token = credentials.issue({ audience: 'desktop' }).token; t.after(() => dispose(api));
  const controller = createPlanController(api), assignment = state.input.roles.builder;
  assert.deepEqual(planTaskItem({ key: 'new-1', title: 'A', body: '', assignment, state: 'todo' }), { title: 'A', assignment });
  assert.deepEqual(planTaskItem({ key: 'new-2', title: 'B', body: 'Details', assignment }), { title: 'B', body: 'Details', assignment });
  assert.deepEqual(planTaskItem({ id: 'root:001', title: 'C', body: 'ignored', actorId: 'x', assignment }), { id: 'root:001', title: 'C', assignment });
  const created = await savePlanDraft(controller, { ...state.input, tasks: [{ key: 'new-1', title: 'First', body: '', assignment }, { key: 'new-2', title: 'Second', body: 'Details.', assignment }] });
  assert.deepEqual(created.tasks.map(task => task.id), ['root:001', 'root:002']);
  assert.deepEqual(sent[0].body.tasks, [{ title: 'First', assignment }, { title: 'Second', body: 'Details.', assignment }]);
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['branch', 'chatId', 'clusterId', 'expectedChatRevision', 'machine', 'mode', 'roles', 'tasks', 'title']);
  const draft = structuredClone(created); draft.tasks.push({ key: 'new-3', title: 'Third', body: '', assignment });
  const edited = await savePlanDraft(controller, draft, created);
  assert.deepEqual(edited.tasks.map(task => task.id), ['root:001', 'root:002', 'root:003']);
  assert.deepEqual(sent[1].body.tasks.map(task => Object.keys(task)), [['id', 'title', 'assignment'], ['id', 'title', 'assignment'], ['title', 'assignment']]);
});

test('a Void text gives one task for each top-level list item and level-two heading, with the paragraphs after it as the body', () => {
  const pages = (...sources) => ({ pages: sources.map((en, index) => ({ k: `p${index}`, en })) });
  assert.deepEqual(tasksFromVoidText(pages('- One\n- Two\n  more\n\n  Detail.'), 'en'), [{ title: 'One', body: '' }, { title: 'Two', body: 'more\n\nDetail.' }]);
  assert.deepEqual(tasksFromVoidText(pages('# Title\n\nPreface\n\n## First\n\nBody one.\n\nBody two.\n\n### Not a task\n\nStays in First.\n\n## Second ##\n\n* Third\n+ Fourth\n1) Fifth\n2. Sixth'), 'en'),
    [{ title: 'First', body: 'Body one.\n\nBody two.\n\n### Not a task\n\nStays in First.' }, { title: 'Second', body: '' }, { title: 'Third', body: '' }, { title: 'Fourth', body: '' }, { title: 'Fifth', body: '' }, { title: 'Sixth', body: '' }]);
  assert.deepEqual(tasksFromVoidText(pages('- [ ] Open box\n- [x] Done box'), 'en'), [{ title: 'Open box', body: '' }, { title: 'Done box', body: '' }]);
  assert.deepEqual(tasksFromVoidText(pages('Intro\n\n```\n- fenced\n## fenced\n```\n\n- Real\n\n```\n- inside\n```'), 'en'), [{ title: 'Real', body: '```\n- inside\n```' }]);
  assert.deepEqual(tasksFromVoidText({ pages: [{ k: 'a', en: '- English one' }, { k: 'b', es: '- Spanish only', en: '' }, { k: 'c', es: '- Solo español', en: '- English three' }] }, 'es'),
    [{ title: 'English one', body: '' }, { title: 'Spanish only', body: '' }, { title: 'Solo español', body: '' }]);
  assert.deepEqual(tasksFromVoidText(pages('- Windows\r\n\r\n  body\r\n- Next'), 'en'), [{ title: 'Windows', body: 'body' }, { title: 'Next', body: '' }]);
  const long = 'x'.repeat(250), [only] = tasksFromVoidText(pages(`- ${long}\n\nAfter.`), 'en');
  assert.equal(only.title, 'x'.repeat(200)); assert.equal(only.body, `${long}\n\nAfter.`);
  assert.equal(tasksFromVoidText(pages(`- Big\n\n${'y'.repeat(30000)}`), 'en')[0].body.length, 20000);
  for (const empty of [null, {}, { pages: [] }, { pages: [{ k: 'a', en: 'Only prose.' }] }, pages('')]) assert.deepEqual(tasksFromVoidText(empty, 'en'), []);
  assert.equal(planBranch('Cart plan: ¡Ñandú!'), 'plan-cart-plan-nandu'); assert.equal(planBranch('???'), 'plan-draft'); assert.equal(planBranch('x'.repeat(100)).length, 45);
});
