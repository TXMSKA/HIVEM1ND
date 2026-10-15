import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { makePlanFixture } from './service-plans.test.mjs';
import { createPlan, startPlan } from '../engine/service/plans.mjs';
import { appendRun, callPlanTool, drainRunLaunches, readRun, readRunRecord, readRunLog, runPrivateFile } from '../engine/service/runs.mjs';
import { checkRuns, openRunSupervisor, recoverOutbox } from '../engine/service/run-supervision.mjs';
import { readProjection } from '../engine/service/projection.mjs';
import { drainRunProcesses } from '../engine/service/run-processes.mjs';

async function started(t) {
  const state = await makePlanFixture(t), plan = await createPlan(state.context, state.input);
  const launch = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); await drainRunLaunches(state.context);
  state.id = launch.runId; state.at = state.clock.now; return state;
}
async function change(state, update) {
  const run = (await readRunRecord(state.context, state.id)).record; update(run);
  await appendRun(state.context, run, { eventId: randomUUID(), kind: 'fixture', values: {} }); return run;
}

test('start deadline is independently armed at 180000 with no scan, agent or model launch', async t => {
  const state = await started(t), calls = [], timers = new Map(); let serial = 0;
  await change(state, r => { r.attempts[0].confirmedAt = null; r.watches = []; });
  state.context.runDelivery = async (_, __, action) => { calls.push(action); return { state: 'submitted' }; };
  state.context.schedule = (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: state.clock.now + delay }); return id; };
  state.context.cancelSchedule = id => timers.delete(id);
  const supervisor = await openRunSupervisor(state.context); t.after(() => supervisor.close());
  assert.deepEqual([...timers.values()].map(t => t.at - state.at).sort((a,b) => a-b), [180000, 300000]);
  state.clock.now = state.at + 179999; await supervisor.check(); assert.equal(calls.length, 0);
  state.clock.now++; await supervisor.check(); assert.equal(calls[0].kind, 'no_start'); assert.equal(calls[0].target, 'coordinator');
  assert.equal(state.launches.length, 1);
  assert.equal((await readProjection(state.context)).waiting.filter(w => w.runId === state.id).length, 1);
  await change(state, r => { r.state = 'stopped'; }); await supervisor.check();
  assert.equal(supervisor.timerCount, 0); await supervisor.close(); assert.equal(timers.size, 0);
});

test('execution and planning actors have independent boundaries and output never refreshes a watch', async t => {
  const state = await started(t), calls = [], builder = randomUUID(), planner = randomUUID();
  state.context.runDelivery = async (_, __, action) => { calls.push(action); return { state: 'submitted' }; };
  await change(state, r => { r.watches = [
    { episodeId: builder, attemptId: builder, role: 'builder', phase: 'execution', lastStepAt: new Date(state.at).toISOString(), notifications: [], resolved: false },
    { episodeId: planner, attemptId: planner, role: 'planner', phase: 'planning', lastStepAt: new Date(state.at).toISOString(), notifications: [], resolved: false }]; });
  state.clock.now = state.at + 599999; await checkRuns(state.context); assert.equal(calls.length, 0);
  state.clock.now++; await checkRuns(state.context); assert.equal(calls.filter(a => a.kind === 'stalled').length, 1);
  await change(state, r => { r.watches[0].lastStepAt = new Date(state.clock.now).toISOString(); r.watches[0].episodeId = randomUUID(); r.watches[0].notifications = []; });
  state.clock.now = state.at + 1799999; await checkRuns(state.context);
  assert.equal(calls.some(a => a.attemptId === planner), false);
  state.clock.now++; await checkRuns(state.context); assert.equal(calls.some(a => a.attemptId === planner && a.kind === 'stalled'), true);
  assert.equal(state.launches.length, 1);
});

test('offline lead cannot suppress scheduled Overseer and person escalation; recovery logs real times and coalesces summaries', async t => {
  const state = await started(t), calls = [];
  await change(state, r => { r.attempts[0].confirmedAt = null; r.watches = []; });
  state.context.runDelivery = async (_, __, action) => { calls.push(action); return { state: action.target === 'coordinator' ? 'pending' : 'submitted' }; };
  state.clock.now = state.at + 180000; await checkRuns(state.context);
  state.clock.now = state.at + 480000; await checkRuns(state.context);
  state.clock.now = state.at + 780000; await checkRuns(state.context);
  let run = await readRun(state.context, state.id);
  assert.deepEqual(run.alerts[0].told.map(t => t.target), ['overseer', 'person']);
  assert.equal(run.alerts[0].told[0].at, new Date(state.at + 480000).toISOString());
  state.context.runDelivery = async (_, __, action) => { calls.push(action); return { state: 'submitted' }; };
  state.clock.now = state.at + 7200000; await checkRuns(state.context); await recoverOutbox(state.context);
  run = await readRun(state.context, state.id); assert.equal(run.summarySlot, 4);
  assert.equal(calls.filter(a => a.kind === 'summary').length, 1);
  assert.equal(run.alerts[0].told.find(t => t.target === 'coordinator').at, new Date(state.clock.now).toISOString());
  assert.equal(state.launches.length, 1);
});

test('ambiguous and interrupted submissions reconcile the same durable delivery, never a second pointer', async t => {
  const state = await started(t), delivered = new Set(), calls = [];
  await change(state, r => { r.attempts[0].confirmedAt = null; r.watches = []; });
  state.clock.now += 180000;
  state.context.runDelivery = async (_, __, action) => {
    calls.push(action); delivered.add(action.deliveryId);
    return { state: action.reconcile ? 'submitted' : 'ambiguous' };
  };
  await checkRuns(state.context); assert.equal((await readRun(state.context, state.id)).alerts[0].told.length, 0);
  await recoverOutbox(state.context);
  assert.equal(delivered.size, 1); assert.equal(calls[1].reconcile, true);
  assert.equal((await readRun(state.context, state.id)).alerts[0].told.length, 1);
  await recoverOutbox(state.context); assert.equal(calls.length, 2);
});

test('a reported parent with an unclosed owned descendant remains supervised until verified cleanup', async t => {
  const state = await started(t), parent = new EventEmitter(), identity = randomUUID(); let exited = false, closed = false;
  state.nativeOptions.planProcessHandle = { identity, verify: async () => true, onExit: listener => { parent.on('exit', listener); return () => parent.off('exit', listener); },
    cleanup: async () => ({ closed, identity }), stop: async () => { exited = true; parent.emit('exit'); return { acknowledged: true }; } };
  let run = await readRun(state.context, state.id), lead = { ...state.context, principal: { audience: 'agent', unitId: state.units[0].id, sessionId: run.attempts[0].sessionId } };
  await callPlanTool(lead, 'plan_dispatch', { runId: run.id, role: 'planner', taskId: null, expectedRevision: run.revision, requestId: randomUUID() }); await drainRunLaunches(state.context);
  run = await readRun(state.context, state.id); const attempt = run.attempts.find(a => a.role === 'planner');
  await callPlanTool({ ...lead, principal: { ...lead.principal, sessionId: attempt.sessionId } }, 'plan_report', { runId: run.id, attemptId: attempt.id, outcome: 'delivered', summary: 'The draft is kept.', requestId: randomUUID() });
  parent.emit('exit'); exited = true; await drainRunProcesses(state.context);
  state.clock.now += 1800000; state.context.runDelivery = async () => ({ state: 'submitted' }); await checkRuns(state.context);
  run = await readRun(state.context, state.id); assert.equal(exited, true); assert.equal(run.attempts.find(a => a.id === attempt.id).resolved, false);
  assert.ok(run.alerts.some(a => a.attemptId === attempt.id && a.kind === 'stalled'));
  const evidence = JSON.parse(await readFile(runPrivateFile(state.context, run.id, `evidence/${attempt.id}.json`)));
  assert.equal(evidence.report, 'delivered'); assert.equal(evidence.processExited, true); assert.equal(evidence.cleanupVerified, false);
  assert.ok((await readRunLog(state.context, run.id, { limit: 100 })).items.some(e => e.kind === 'queued'));
  closed = true;
});
