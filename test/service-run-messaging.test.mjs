import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { makePlanFixture, runsIn } from './service-plans.test.mjs';
import { createPlan, startPlan } from '../engine/service/plans.mjs';
import { callPlanTool, controlRun, drainRunLaunches, readRun, runPrivateFile } from '../engine/service/runs.mjs';
import { checkRuns, recoverOutbox } from '../engine/service/run-supervision.mjs';
import { answerApproval, readApproval, consumeAnswers } from '../engine/service/approvals.mjs';
import { postChat, postMailbox, readChat } from '../engine/service/chats.mjs';
import { readProjection } from '../engine/service/projection.mjs';
import { callTool } from '../engine/service/mcp.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { request } from '../engine/service/client.mjs';
import { createRelayWakeController } from '../engine/relay/wake.mjs';

async function fixture(t, { direct = false, nearMidnight = false } = {}) {
  const state = await makePlanFixture(t);
  if (nearMidnight) {
    const date = new Date(state.clock.now); state.clock.now = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 30).getTime();
    await writeFile(path.join(state.context.paths.origin, 'machines', state.machine, 'service.json'), JSON.stringify({ state: 'running', heartbeatAt: new Date(state.clock.now).toISOString() }));
  }
  await writeFile(path.join(state.paths.mind, 'user', 'tasks', '002.md'), `id: root:002\nstatus: open\nfrom-id: root:master\nto-id: ${state.units[0].id}\nfiles: ["second.txt"]\n\n## Request\nSecond task.\n`);
  state.input.tasks.push({ ...state.input.tasks[0], id: 'root:002', title: 'Second task' });
  if (direct) for (const role of ['planner', 'reviewer']) state.input.roles[role] = { kind: 'client', client: 'codex', runsIn, reuseRole: null };
  const plan = await createPlan(state.context, state.input), launch = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); await drainRunLaunches(state.context);
  state.id = launch.runId; state.at = state.clock.now;
  let run = await readRun(state.context, state.id);
  state.lead = { ...state.context, principal: { audience: 'agent', unitId: state.units[0].id, sessionId: run.attempts[0].sessionId } };
  for (const role of ['planner', 'reviewer']) {
    run = await readRun(state.context, state.id);
    await callPlanTool(state.lead, 'plan_dispatch', { runId: run.id, role, taskId: null, expectedRevision: run.revision, requestId: randomUUID() }); await drainRunLaunches(state.context);
    run = await readRun(state.context, state.id); const attempt = run.attempts.find(a => a.role === role);
    state[role] = { ...state.context, principal: { audience: 'agent', unitId: direct ? null : state.units[0].id, sessionId: attempt.sessionId } };
  }
  return state;
}
async function extend(state, count, reason = 'Clarify the accepted task.') {
  const run = await readRun(state.context, state.id);
  return callPlanTool(state.lead, 'plan_extend', { runId: run.id, count, reason, expectedRevision: run.revision, requestId: randomUUID() });
}

test('authored sends preserve original recipients, role-specific reads, deadlines and exactly one retry', async t => {
  const state = await fixture(t), input = { runId: state.id, recipientRoles: ['planner', 'reviewer'], text: 'Read this exact draft.', requestId: randomUUID() };
  const sent = await callPlanTool(state.lead, 'plan_send', input);
  assert.deepEqual(await callPlanTool(state.lead, 'plan_send', input), sent);
  await assert.rejects(callPlanTool(state.lead, 'plan_read', { runId: state.id, messageIds: [sent.messageId], requestId: randomUUID() }), { code: 'forbidden' });
  await readChat(state.context, state.cluster.chatId, { messageIds: [sent.messageId] });
  const before = await readRun(state.context, state.id); assert.equal(before.messages[0].recipients[0].readAt, null);
  const calls = []; state.context.runDelivery = async (_, __, action) => { calls.push(action); return { state: 'submitted' }; };
  state.clock.now = state.at + 299999; await checkRuns(state.context); assert.equal(calls.filter(a => a.kind === 'unread_retry').length, 0);
  state.clock.now++; await checkRuns(state.context); assert.equal(calls.filter(a => a.kind === 'unread_retry').length, 1);
  let run = await readRun(state.context, state.id);
  await controlRun(state.context, state.id, { action: 'resend', messageId: sent.messageId, recipientId: state.units[0].id, expectedRevision: run.revision });
  assert.equal(calls.filter(a => a.kind === 'unread_retry').length, 1);
  state.clock.now = state.at + 599999; await checkRuns(state.context); assert.equal(calls.some(a => a.kind === 'unread'), false);
  state.clock.now++; await checkRuns(state.context); assert.equal(calls.some(a => a.kind === 'unread'), true);
  await callPlanTool(state.planner, 'plan_read', { runId: state.id, messageIds: [sent.messageId], requestId: randomUUID() });
  run = await readRun(state.context, state.id); assert.equal(run.messages[0].recipients[0].readAt, null, 'another role on the same unit must acknowledge for itself');
  await callPlanTool(state.reviewer, 'plan_read', { runId: state.id, messageIds: [sent.messageId], requestId: randomUUID() });
  run = await readRun(state.context, state.id); assert.ok(run.messages[0].recipients[0].readAt); assert.equal(run.messages[0].sentAt, before.messages[0].sentAt);
  assert.equal(run.budget.used, 1); assert.equal((await readProjection(state.context)).messages.filter(m => m.id === sent.messageId).length, 1);
});

test('manual retry before the automatic deadline uses its one receipt and direct-client inboxes keep the same authored identity', async t => {
  const state = await fixture(t, { direct: true }), sent = await callPlanTool(state.lead, 'plan_send', { runId: state.id, recipientRoles: ['planner'], text: 'Review the draft.', requestId: randomUUID() });
  let run = await readRun(state.context, state.id); const recipientId = run.messages[0].recipients[0].actorId;
  await checkRuns(state.context);
  await controlRun(state.context, state.id, { action: 'resend', messageId: sent.messageId, recipientId, expectedRevision: (await readRun(state.context, state.id)).revision });
  state.clock.now += 300000; await checkRuns(state.context); await recoverOutbox(state.context);
  const outbox = await readdir(runPrivateFile(state.context, state.id, 'outbox'));
  const rows = await Promise.all(outbox.map(name => readFile(runPrivateFile(state.context, state.id, `outbox/${name}`)).then(JSON.parse)));
  assert.equal(rows.filter(a => a.kind === 'unread_retry').length, 1);
  assert.equal(rows.filter(a => a.kind === 'unread_retry')[0].state, 'pending');
  await assert.rejects(callPlanTool(state.reviewer, 'plan_read', { runId: state.id, messageIds: [sent.messageId], requestId: randomUUID() }), { code: 'forbidden' });
  assert.equal((await callTool(state.planner, 'list_inbox', {})).messages[0].id, sent.messageId);
  assert.equal((await callTool(state.reviewer, 'list_inbox', {})).messages.length, 0);
  await callPlanTool(state.planner, 'plan_read', { runId: state.id, messageIds: [sent.messageId], requestId: randomUUID() });
  assert.equal((await readRun(state.context, state.id)).budget.used, 1);
});

test('ordinary chat, mailbox and Relay sends cannot bypass a bound actor budget or impersonate free supervision', async t => {
  const state = await fixture(t);
  await assert.rejects(postChat(state.lead, state.cluster.chatId, { body: 'Bypass' }), { code: 'plan_message_required' });
  await assert.rejects(postMailbox(state.lead, state.units[0].id, { body: 'Bypass' }), { code: 'plan_message_required' });
  await assert.rejects(callTool(state.lead, 'send_message', { body: 'Bypass', requestId: randomUUID() }), { code: 'plan_message_required' });
  await assert.rejects(callPlanTool(state.lead, 'plan_send', { runId: state.id, recipientRoles: ['planner'], text: 'Forged free message', channel: 'work', requestId: randomUUID() }), { code: 'invalid_plan' });
  for (let i = 0; i < 2; i++) await callPlanTool(state.lead, 'plan_send', { runId: state.id, recipientRoles: ['planner'], text: `Draft ${i}`, requestId: randomUUID() });
  await assert.rejects(callPlanTool(state.lead, 'plan_send', { runId: state.id, recipientRoles: ['planner'], text: 'Over budget', requestId: randomUUID() }), { code: 'budget_exhausted' });
  state.clock.now += 600000; state.context.runDelivery = async () => ({ state: 'submitted' }); await checkRuns(state.context);
  assert.ok((await readRun(state.context, state.id)).alerts.some(a => a.kind === 'unread'));
  assert.equal((await readRun(state.context, state.id)).budget.used, 2);
});

test('two authenticated roles log half-plan credit once; crossing half creates one desktop-only person approval', async t => {
  const state = await fixture(t), first = await extend(state, 1);
  let run = await readRun(state.context, state.id);
  await assert.rejects(callPlanTool(state.lead, 'plan_agree', { runId: run.id, extensionId: first.extensionId, expectedRevision: run.revision, requestId: randomUUID() }), { code: 'invalid_extension' });
  const agreement = { runId: run.id, extensionId: first.extensionId, expectedRevision: run.revision, requestId: randomUUID() };
  await callPlanTool(state.planner, 'plan_agree', agreement); await callPlanTool(state.planner, 'plan_agree', agreement);
  assert.equal((await readRun(state.context, state.id)).budget.extra, 1);
  const second = await extend(state, 1); assert.ok(second.approvalId);
  await checkRuns(state.context);
  assert.equal((await readProjection(state.context)).waiting.filter(w => w.runId === state.id || w.approvalId === second.approvalId).length, 1);
  const approval = await readApproval(state.context, second.approvalId); assert.equal(approval.desktopOnly, true); assert.equal(approval.alwaysAllowed, false);
  await assert.rejects(answerApproval({ ...state.context, principal: { audience: 'phone', unitId: 'root:master' } }, approval.id, { decision: 'approve', expectedRevision: approval.revision }), { code: 'phone_read_only' });
  await assert.rejects(answerApproval(state.context, approval.id, { decision: 'approve-always', expectedRevision: approval.revision }), { code: 'always_unavailable' });
  await assert.rejects(answerApproval(state.context, approval.id, { decision: 'approve', expectedRevision: 'stale' }), { code: 'revision_conflict' });
  await answerApproval(state.context, approval.id, { decision: 'approve', expectedRevision: approval.revision }); await consumeAnswers(state.context);
  assert.equal((await readRun(state.context, state.id)).budget.extra, 2);
  await consumeAnswers(state.context); assert.equal((await readRun(state.context, state.id)).budget.extra, 2);
  const denied = await extend(state, 2), ask = await readApproval(state.context, denied.approvalId);
  await answerApproval(state.context, ask.id, { decision: 'deny', expectedRevision: ask.revision }); await consumeAnswers(state.context);
  assert.equal((await readRun(state.context, state.id)).budget.extra, 2);
});

test('HTTP phone refusal precedes receipts and resend keeps the frozen message revision', async t => {
  const state = await fixture(t), extension = await extend(state, 2), credentials = createCredentialStore({ now: state.context.now });
  const phone = credentials.issue({ audience: 'phone' }).token, approval = await readApproval(state.context, extension.approvalId);
  const http = await createHttpServer({ ...state.context, credentials }); t.after(() => http.close());
  const key = randomUUID(), response = await request({ origin: new URL(`http://127.0.0.1:${http.port}`), token: phone },
    { path: `/api/v1/approvals/${approval.id}/answer`, body: { decision: 'approve', expectedRevision: approval.revision }, headers: { 'idempotency-key': key }, timeoutMs: 3000 });
  assert.equal(response.status, 403);
  const receipts = async dir => (await readdir(dir, { withFileTypes: true }).catch(() => [])).flatMap(e => e.isDirectory() ? [] : [e.name]);
  assert.equal((await receipts(path.join(state.paths.localDirectory, 'receipts'))).includes(`${key}.json`), false);
  assert.equal((await readRun(state.context, state.id)).budget.extra, 0);
});

test('owned role wake drivers keep canonical and direct-client inboxes separate, obey the source cap and do not run in scans', async t => {
  for (const direct of [false, true]) await t.test(direct ? 'direct-client roles' : 'one unit in distinct roles', async t => {
    const state = await fixture(t, { direct, nearMidnight: true }), calls = [], sleepers = [];
    const clock = { now: state.context.now, sleep: (_ms, signal) => new Promise(resolve => {
      const finish = () => { signal?.removeEventListener('abort', finish); resolve(); };
      sleepers.push(finish); signal?.addEventListener('abort', finish, { once: true });
    }) };
    const wake = await createRelayWakeController({ mindPath: state.paths.mind, hostname: state.machine, clock,
      sink: async notice => { calls.push(notice); return { status: 'submitted' }; } });
    state.context.runWake = wake; t.after(() => wake.stopAll());
    const sent = await callPlanTool(state.lead, 'plan_send', { runId: state.id, recipientRoles: ['planner', 'reviewer'], text: 'Keep the original message.', requestId: randomUUID() });
    await checkRuns(state.context); assert.equal(calls.length, 0, 'a scan renews leases and queues pointers without calling a model');
    let source;
    if (!direct) {
      const run = await readRun(state.context, state.id), intent = JSON.parse(await readFile(runPrivateFile(state.context, run.id, `intents/${run.attempts[0].id}.json`)));
      source = { unit: state.units[0].unit, unitId: state.units[0].id, nativeSessionId: intent.binding.nativeSessionId, client: 'codex', machine: state.machine };
      await wake.enable({ ...source, maxDailyHandoffs: 1 });
    }
    const tick = () => sleepers.splice(0).forEach(finish => finish());
    const until = async predicate => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('Owned pointer acknowledgment did not arrive.'); };
    tick(); await until(() => calls.length === (direct ? 2 : 1));
    if (!direct) {
      await until(async () => (await wake.status(source)).dailyCount === 1);
      await checkRuns(state.context); assert.ok((await readRun(state.context, state.id)).alerts.some(a => a.kind === 'wake_capped'));
      state.clock.now = Date.parse((await wake.status(source)).dailyResumesAt);
      await checkRuns(state.context); tick(); await until(() => calls.length === 2);
    }
    assert.deepEqual(calls.map(c => c.binding.role).sort(), ['planner', 'reviewer']);
    assert.ok(calls.every(c => c.messageIds[0] === sent.messageId));
    assert.equal(new Set(calls.map(c => c.binding.sessionId)).size, 2);
    await until(async () => { await checkRuns(state.context); return (await readRun(state.context, state.id)).messages[0].recipients.every(r => r.readAt === null); });
    tick(); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(calls.length, 2);
    assert.equal((await readRun(state.context, state.id)).budget.used, 1);
    await wake.stopAll();
    // A fresh owner reconstructs leases and delivery state without replaying submitted pointers.
    const recovered = await createRelayWakeController({ mindPath: state.paths.mind, hostname: state.machine, clock,
      sink: async notice => { calls.push(notice); return { status: 'submitted' }; } });
    state.context.runWake = recovered; t.after(() => recovered.stopAll());
    await checkRuns(state.context); tick(); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(calls.length, 2);
  });
});
