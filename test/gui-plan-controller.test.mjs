import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi, dispose } from '../gui/app/api.mjs';
import { createPlanController, controlPlan, planCardModel, runPlan, savePlanDraft } from '../gui/app/plan-controller.mjs';
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
    return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data: new URL(url).pathname.includes('/plans/') ? plan : run,
      meta: { requestId: 'fixture', readAt: '2026-10-15T12:00:00Z', eventCursor: 'fixture:1', sync: 'local' } }));
  } }); api.token = 'fixture';
  const controller = createPlanController(api); controller.runs.set(run.id, run);
  assert.equal(planCardModel(controller, plan, 'en').problem.kind, 'unreadProblem');
  await controlPlan(controller, run, 'resend', run.alerts[0]);
  assert.deepEqual(bodies[0], { action: 'resend', expectedRevision: 'rev', messageId: 'original', recipientId: 'agent' });
  assert.equal(controller.runs.get('r').state, 'open');
});
