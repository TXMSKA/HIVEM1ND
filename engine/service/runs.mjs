import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { readdir, readFile, open as openFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, isUuid, parseUnitId, uuidV8 } from './identity.mjs';
import { PLAN_ROLES, exactPlanObject, planBytes, planError, planFile, planRevision, publicPlan, readPlanRecord, requirePlanDesktop, resolvePlan } from './plans.mjs';
import { commitChange, readBytes, revisionOf, withLocalChanges, withLocks, withReceipt } from './store.mjs';
import { normalizeRunSignal } from './run-signals.mjs';
import { runTaskEndState } from './run-policy.mjs';
import { createRunBudget, projectRunBudget, applyRunBudget } from './run-budget.mjs';
import { paginate } from './projection.mjs';
import { cleanupRunAttempt, liveRunProcess, ownRunProcess, retireRunProcess, stopRunStep, verifiedProcessWitness, verifyRunProcess } from './run-processes.mjs';
import { snapshotPlanGit, preparePlanBranch, commitPlanTask } from './cluster-git.mjs';
import { launchPlanSession } from './adapters.mjs';
import { readUnitState } from './state.mjs';
import { loadTask } from './tasks.mjs';
import { authoredPlanEntry } from './chats.mjs';
import { queueRunAction, deliverRunActions } from './run-supervision.mjs';
import { requestPlanExtensionApproval, readApproval } from './approvals.mjs';
import { renewPlanWakeLease, maintainPlanActorWake } from './bridge.mjs';
import { queueRunPointer } from '../relay/store.mjs';

const nativeWitnesses = new WeakSet();
const actors = new WeakMap();
const actorTable = context => { if (!actors.has(context.store)) actors.set(context.store, new Map()); return actors.get(context.store); };
export const runFile = (context, id) => path.join(context.paths.mind, 'user', 'gui', 'runs', id, 'run.json');
export const runPrivateFile = (context, id, name) => path.join(context.paths.localDirectory, 'runs', id, name);
const stamp = context => new Date(context.now()).toISOString();
function runError(code, status = 409) { throw new CoreError(status, code, 'The run operation could not be verified.'); }
export async function runIds(context) {
  try { return (await readdir(path.dirname(path.dirname(runFile(context, 'unused'))))).filter(isUuid).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export async function readRunRecord(context, id) {
  if (!isUuid(id)) runError('run_not_found', 404);
  const bytes = await readBytes(context.store, runFile(context, id));
  if (!bytes) runError('run_not_found', 404);
  const record = JSON.parse(bytes);
  if (record.id !== id || record.format !== 'hivem1nd-run-v1' || planRevision(record).revision !== record.revision) runError('corrupt_resource');
  return { record, bytes };
}
export function publicRun(record) { const { format, sequence, ...run } = record; return structuredClone(run); }
export async function readRun(context, id) { requirePlanDesktop(context); return publicRun((await readRunRecord(context, id)).record); }
async function readPrivate(context, runId, name) {
  const bytes = await readBytes(context.store, runPrivateFile(context, runId, name));
  return { bytes, record: bytes ? JSON.parse(bytes) : null };
}
function entry(file, before, record, privateRecord = false) { return { resource: file, recordPath: file, beforeRevision: revisionOf(before), afterBytes: planBytes(record), private: privateRecord }; }
function owner(context, run) { if (run.machine !== context.paths.machine || (context.settingsOwner ?? context).active === false) runError('machine_unavailable'); }
function open(run) { if (!['open', 'stopping'].includes(run.state)) runError('run_closed'); }
function revision(run, expected) { if (run.revision !== expected) runError('plan_changed'); }

export async function readRunLog(context, id, query = {}) {
  requirePlanDesktop(context); const { record } = await readRunRecord(context, id);
  const root = path.join(path.dirname(runFile(context, id)), 'log');
  let names; try { names = (await readdir(root)).filter(name => /^\d{12}\.json$/.test(name)).sort(); }
  catch (error) { if (error.code === 'ENOENT') names = []; else throw error; }
  const page = paginate(names.map(name => ({ id: name, name })), { ...query, filters: { runId: id }, snapshot: `${id}:${record.sequence}` });
  return { ...page, items: await Promise.all(page.items.map(async item => JSON.parse(await readBytes(context.store, path.join(root, item.name))))) };
}
export async function readSessionWork(context, sessionId, query = {}) {
  requirePlanDesktop(context);
  if (!isUuid(sessionId)) runError('session_not_found', 404);
  let found = null;
  for (const id of await runIds(context)) {
    const { record } = await readRunRecord(context, id);
    if (record.machine !== context.paths.machine) continue;
    for (const file of await readdir(runPrivateFile(context, id, 'intents')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      const intent = (await readPrivate(context, id, `intents/${file}`)).record;
      if (intent.sessionId === sessionId) { found = { run: record, attempt: intent.attemptId }; break; }
    }
    if (found) break;
  }
  if (!found) runError('session_not_found', 404);
  const page = await readRunLog(context, found.run.id, query);
  // Session IDs and native handles stay private; Work contains only typed milestones from this attempt.
  const rows = [];
  for (const log of page.items) {
    const evidence = (await readPrivate(context, found.run.id, `work/${String(log.sequence).padStart(12, '0')}.json`)).record;
    if (evidence?.attemptId === found.attempt) rows.push(log);
  }
  return { ...page, items: rows };
}

export async function createRunIntent(context, planId, input) {
  return withLocalChanges(context.store, async () => {
    const plan = await readPlanRecord(context, planId);
    if (plan.record.revision !== input.expectedRevision) runError('plan_changed');
    for (const id of await runIds(context)) {
      const run = (await readRunRecord(context, id)).record;
      if (run.clusterId === plan.record.clusterId && ['open', 'stopping'].includes(run.state)) runError('plan_already_open');
    }
    const resolved = await resolvePlan(context, { ...plan.record, tasks: plan.record.tasks.map(({ id, title, assignment }) => ({ id, title, assignment })) }, planId);
    const git = plan.record.mode === 'execution' ? await snapshotPlanGit(context, plan.record, resolved.witnesses) : null;
    const approved = planRevision({ ...plan.record, approved: true });
    const runId = randomUUID(), attemptId = randomUUID(), requestId = context.receipt?.requestId ?? randomUUID();
    const attempt = { id: attemptId, role: 'coordinator', taskId: null, sentAt: stamp(context), confirmedAt: null, resolved: false, sessionId: null, notifications: [] };
    const ledger = createRunBudget(approved.tasks.length);
    const run = planRevision({ format: 'hivem1nd-run-v1', id: runId, planId, clusterId: approved.clusterId, machine: approved.machine, mode: approved.mode,
      state: 'open', startedAt: stamp(context), closedAt: null, taskIndex: 0, lastCheckedAt: null, summarySlot: 0, budget: projectRunBudget(ledger),
      attempts: [attempt], watches: [], messages: [], alerts: [], sequence: 0 });
    const approval = { format: 'hivem1nd-plan-approval-v1', runId, plan: publicPlan(approved), sourceRevision: plan.record.revision,
      clusterRevision: resolved.cluster.revision, taskWitnesses: resolved.witnesses, unitRevisions: resolved.unitRevisions, git,
      commits: approved.mode === 'execution', push: false, messageBase: ledger.base, confirmedBy: 'root:master', confirmedAt: stamp(context) };
    const intent = { requestId, runId, attemptId, assignment: approved.roles.coordinator, role: 'coordinator', taskId: null, state: 'prepared', sessionId: null };
    const body = { runId, requestId };
    await commitChange(context, { id: randomUUID(), entries: [entry(planFile(context, planId), plan.bytes, approved), entry(runFile(context, runId), null, run),
      entry(runPrivateFile(context, runId, 'approval.json'), null, approval, true), entry(runPrivateFile(context, runId, `intents/${attemptId}.json`), null, intent, true),
      entry(runPrivateFile(context, runId, 'budget.json'), null, ledger, true)],
      events: [{ name: 'plan.changed', chatId: approved.chatId, data: { planId, revision: approved.revision } }, { name: 'run.changed', chatId: approved.chatId, data: { runId, revision: run.revision } }],
      response: { status: 202, body } });
    queueLaunch(context, runId, attemptId);
    return body;
  });
}
function queueLaunch(context, runId, attemptId) {
  context.store.planLaunches ??= new Map();
  const key = `${runId}:${attemptId}`;
  if (context.store.planLaunches.has(key)) return context.store.planLaunches.get(key);
  const work = new Promise(resolve => setImmediate(resolve)).then(() => consumeRunIntent(context, runId, attemptId))
    .catch(async error => {
      if (error.code === 'injected_crash') return;
      await withLocalChanges(context.store, async () => {
        const { record } = await readRunRecord(context, runId);
        if (!record.alerts.some(alert => alert.id === `launch:${attemptId}`)) {
          record.alerts.push({ id: `launch:${attemptId}`, kind: 'cleanup', attemptId, messageId: null, recipientId: null, at: stamp(context), resolved: false, told: [], next: [], extensionId: null });
          await appendRun(context, record, { eventId: `launch-failed:${attemptId}`, kind: 'launch_failed', role: null, taskId: null, source: 'service', values: { code: error.code ?? 'launch_ambiguous' } });
        }
      });
    }).finally(() => context.store.planLaunches.delete(key));
  context.store.planLaunches.set(key, work); return work;
}
export async function drainRunLaunches(context) { await Promise.allSettled([...(context.store.planLaunches?.values() ?? [])]); }
export async function recordPlanTranscript(context, runId, attemptId, value) {
  return withLocalChanges(context.store, async () => {
    const counter = await readPrivate(context, runId, `transcripts/${attemptId}/counter.json`);
    const state = counter.record ?? { sequence: 0, bytes: 0, truncated: false };
    const encoded = Buffer.from(canonicalJson(value));
    if (state.truncated) return;
    if (encoded.length > 65536 || state.bytes + encoded.length > 16000000 || state.sequence >= 10000) {
      state.truncated = true;
      await commitChange({ ...context, receipt: null }, { id: randomUUID(), entries: [entry(runPrivateFile(context, runId, `transcripts/${attemptId}/counter.json`), counter.bytes, state, true)], events: [], response: { status: 200, body: null } });
      return;
    }
    state.sequence++; state.bytes += encoded.length;
    const record = { id: randomUUID(), sequence: state.sequence, at: stamp(context), value };
    await commitChange({ ...context, receipt: null }, { id: randomUUID(), entries: [entry(runPrivateFile(context, runId, `transcripts/${attemptId}/${String(state.sequence).padStart(12, '0')}.json`), null, record, true),
      entry(runPrivateFile(context, runId, `transcripts/${attemptId}/counter.json`), counter.bytes, state, true)], events: [], response: { status: 200, body: null } });
  });
}
export async function readSessionTranscript(context, sessionId, query = {}) {
  requirePlanDesktop(context);
  if (!isUuid(sessionId)) runError('session_not_found', 404);
  let found;
  for (const id of await runIds(context)) {
    const run = (await readRunRecord(context, id)).record;
    if (run.machine !== context.paths.machine) continue;
    for (const name of await readdir(runPrivateFile(context, id, 'intents')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      const intent = (await readPrivate(context, id, `intents/${name}`)).record;
      if (intent?.sessionId === sessionId) { found = { runId: id, attemptId: intent.attemptId }; break; }
    }
    if (found) break;
  }
  if (!found) runError('session_not_found', 404);
  const prefix = `transcripts/${found.attemptId}`, state = (await readPrivate(context, found.runId, `${prefix}/counter.json`)).record ?? { sequence: 0, truncated: false };
  const page = paginate(Array.from({ length: state.sequence }, (_, index) => ({ id: String(index + 1).padStart(12, '0') })), { ...query, filters: { sessionId }, snapshot: `${sessionId}:${state.sequence}` });
  const sanitize = value => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:id|pid|threadId|sessionId|nativeSessionId|executionId|toolCallId|request_id|session_id|environment|env|token|credential|secret|password|authorization)$/i.test(key)).map(([key, child]) => [key, sanitize(child)]));
    if (typeof value === 'string') return value.replace(/\b(?:Bearer|Bootstrap)\s+\S+/gi, '[redacted]').replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,}\n]+)/gi, '$1[redacted]');
    return value;
  };
  return { ...page, truncated: state.truncated, items: await Promise.all(page.items.map(async item => {
    const record = (await readPrivate(context, found.runId, `${prefix}/${item.id}.json`)).record;
    return { id: record.id, sequence: record.sequence, at: record.at, text: canonicalJson(sanitize(record.value)) };
  })) };
}

export async function consumeRunIntent(context, runId, attemptId) {
  return withLocks(context.store, [`run-launch:${runId}:${attemptId}`], async () => {
    const { record: run } = await readRunRecord(context, runId); owner(context, run); open(run);
    if (run.state !== 'open') runError('run_closed');
    const saved = await readPrivate(context, runId, `intents/${attemptId}.json`), approval = (await readPrivate(context, runId, 'approval.json')).record;
    const intent = saved.record;
    if (!intent || !approval || !run.attempts.some(attempt => attempt.id === attemptId && !attempt.resolved)) runError('invalid_binding', 403);
    if (intent.state === 'registered' && liveRunProcess(context, runId, attemptId)) return intent;
    if (intent.state !== 'prepared') runError('launch_ambiguous');
    const coordinator = approval.plan.roles.coordinator;
    if (intent.role !== 'coordinator' && intent.dispatcherRole !== 'coordinator') runError('plan_lead_required', 403);
    for (const [id, expected] of Object.entries(approval.unitRevisions)) {
      const unit = await readUnitState(context, parseUnitId(id));
      if (revisionOf(unit?.bytes) !== expected) runError('plan_changed');
    }
    if (approval.git) await preparePlanBranch(context, approval);
    if (intent.taskId) {
      const task = await loadTask(context, intent.taskId), witness = approval.taskWitnesses.find(item => item.id === task.id);
      if (!witness || task.revision !== witness.revision) runError('plan_changed');
    }
    await persistIntent(context, runId, { ...intent, state: 'launching' });
    if (context.runFault === 'launch_gap') throw new CoreError(500, 'injected_crash', 'Injected ambiguous role launch.');
    let binding = null; const early = [];
    const observer = event => {
      if (!binding) { if (early.length >= 100) runError('invalid_run_event', 422); early.push(event); return; }
      return acceptNative(context, binding, event);
    };
    const host = { ...intent, runId, machine: run.machine, unitId: intent.assignment.kind === 'unit' ? intent.assignment.unitId : null,
      actorId: intent.assignment.kind === 'unit' ? intent.assignment.unitId : `plan:${run.planId}:${intent.role}`,
      sessionId: randomUUID(), coordinator, approval, observer };
    host.transcript = value => recordPlanTranscript(context, runId, attemptId, value);
    if (intent.assignment.kind === 'client' && intent.assignment.reuseRole === 'planner') {
      const prior = (await readPrivate(context, runId, 'conversations/planner.json')).record;
      if (!prior || canonicalJson(prior.runsIn) !== canonicalJson(intent.assignment.runsIn)) runError('context_unavailable');
      host.reviewConversation = prior;
    }
    context.store.pendingPlanActors ??= new Map();
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    context.store.pendingPlanActors.set(host.sessionId, ready);
    let created;
    try { created = await launchPlanSession(context, host); }
    catch (error) { release(false); context.store.pendingPlanActors.delete(host.sessionId); throw error; }
    binding = Object.freeze({ runId, attemptId, role: intent.role, taskId: intent.taskId, sessionId: host.sessionId, actorId: host.actorId,
      unitId: host.unitId, client: intent.assignment.runsIn.client, nativeSessionId: created.nativeSessionId, machine: run.machine });
    actorTable(context).set(host.sessionId, { binding, adapter: context.adapters[binding.client], proof: created, active: true });
    const registered = { ...intent, state: 'registered', sessionId: host.sessionId, binding, native: { nativeSessionId: created.nativeSessionId, executionId: created.executionId ?? null } };
    await persistIntent(context, runId, registered);
    await withLocalChanges(context.store, async () => {
      const latest = (await readRunRecord(context, runId)).record;
      latest.attempts.find(attempt => attempt.id === attemptId).sessionId = host.sessionId;
      await appendRun(context, latest, { eventId: `bound:${attemptId}`, kind: 'bound', role: intent.role, taskId: intent.taskId, source: 'service', values: {} });
    });
    await ownRunProcess(context, binding, created.processHandle, witness => ingestPlanSignal(context, witness, witness));
    for (const event of early) await acceptNative(context, binding, event);
    release(true); context.store.pendingPlanActors.delete(host.sessionId);
    await created.registered?.(binding);
    return registered;
  });
}
async function persistIntent(context, runId, intent) {
  const file = runPrivateFile(context, runId, `intents/${intent.attemptId}.json`), bytes = await readBytes(context.store, file);
  await commitChange({ ...context, receipt: null }, { id: randomUUID(), entries: [entry(file, bytes, intent, true)], events: [], response: { status: 200, body: null } });
}
async function acceptNative(context, binding, event) {
  const witness = Object.freeze({ ...event, ...binding, source: 'native' }); nativeWitnesses.add(witness);
  return ingestPlanSignal(context, witness, witness);
}
export async function assertPlanActor(context, runId, attemptId = null, { report = false } = {}) {
  const actor = context.principal ?? context.credential, active = actorTable(context).get(actor?.sessionId);
  if (actor?.audience !== 'agent' || !active?.active || active.binding.runId !== runId || attemptId && active.binding.attemptId !== attemptId
    || actor.unitId !== active.binding.unitId || (report ? await verifyRunProcess(context, runId, active.binding.attemptId) !== true : await active.adapter.confirm({ ...active.binding, ...active.proof }) !== true)) runError('forbidden', 403);
  const run = (await readRunRecord(context, runId)).record; owner(context, run); open(run);
  if (active.binding.unitId) {
    const unit = await readUnitState(context, parseUnitId(active.binding.unitId));
    if (!unit || /^removed:\s*true$/m.test(unit.bytes.toString().split(/\r?\n\r?\n/)[0])) runError('forbidden', 403);
  }
  if (!run.attempts.some(item => item.id === active.binding.attemptId && !item.resolved)) runError('forbidden', 403);
  return active.binding;
}
export async function planBindingForSession(context, sessionId) { return actorTable(context).get(sessionId)?.binding ?? null; }
// The launch snapshot of one plan session. The run record is shared, so another machine's session is named without its private files.
export async function readPlanSessionScope(context, sessionId) {
  for (const id of await runIds(context)) {
    let run;
    try { run = (await readRunRecord(context, id)).record; } catch { continue; }
    const attempt = run.attempts.find(item => item.sessionId === sessionId);
    if (!attempt) continue;
    if (run.machine !== context.paths.machine) return { machine: run.machine, live: false, scope: null, directory: null };
    let scope = null;
    try { scope = JSON.parse(await readBytes(context.store, runPrivateFile(context, run.id, `scopes/${attempt.id}.json`))).scope; } catch { scope = null; }
    return { machine: run.machine, live: ['open', 'stopping'].includes(run.state) && !attempt.resolved,
      scope: scope?.sessionId === sessionId && scope.machine === context.paths.machine && Array.isArray(scope.writeRoots) ? scope : null,
      directory: runPrivateFile(context, run.id, path.join('sessions', sessionId)) };
  }
  return null;
}
export async function assertOrdinaryRunSend(context) {
  if (await planBindingForSession(context, context.principal?.sessionId ?? context.credential?.sessionId)) runError('plan_message_required', 403);
}
export async function readPlanInbox(context, query = {}) {
  const binding = await planBindingForSession(context, context.principal?.sessionId ?? context.credential?.sessionId);
  await assertPlanActor(context, binding?.runId);
  const run = (await readRunRecord(context, binding.runId)).record, plan = (await readPlanRecord(context, run.planId)).record;
  const rows = [];
  for (const tracked of run.messages) {
    const saved = (await readPrivate(context, run.id, `messages/${tracked.id}.json`)).record;
    const recipient = saved?.recipients.find(r => r.actorId === binding.actorId && r.role === binding.role);
    if (!recipient || query.unread !== false && recipient.readAt) continue;
    const bytes = await readBytes(context.store, path.join(context.paths.mind, 'user', 'relay', 'chats', plan.chatId, `${tracked.id}.md`));
    if (bytes) rows.push({ id: tracked.id, fromId: saved.authorId, body: bytes.toString('utf8').split(/\r?\n\r?\n/).slice(1).join('\n\n'), read: Boolean(recipient.readAt), timestamp: tracked.sentAt });
  }
  return paginate(rows, { limit: query.limit ?? 50, cursor: query.cursor ?? null, filters: { actor: binding.actorId, role: binding.role }, snapshot: run.revision });
}
export async function maintainRunLease(context, run) {
  const attempt = run.attempts.find(a => a.role === 'coordinator' && !a.resolved);
  const intent = attempt ? (await readPrivate(context, run.id, `intents/${attempt.id}.json`)).record : null;
  let status = intent?.binding?.unitId || !['open', 'stopping'].includes(run.state) ? await renewPlanWakeLease(context, run, intent?.binding ?? null) : null;
  if (!['open', 'stopping'].includes(run.state)) return status;
  for (const actor of run.attempts.filter(a => !a.resolved && a.sessionId)) {
    const saved = (await readPrivate(context, run.id, `intents/${actor.id}.json`)).record;
    const actual = await maintainPlanActorWake(context, run, saved?.binding);
    if (actor.role === 'coordinator' && actual) status = { ...status, ...actual, pausedReason: status?.pausedReason ?? actual.pausedReason,
      dailyResumesAt: status?.dailyResumesAt ?? actual.dailyResumesAt };
  }
  return status;
}
export async function deliverRunPointer(context, run, action) {
  let recipientId = action.recipientId;
  let binding = null;
  if (!recipientId && action.target === 'coordinator') {
    const attempt = run.attempts.find(a => a.role === 'coordinator' && !a.resolved);
    const actor = actorTable(context).get(attempt?.sessionId);
    binding = actor?.binding ?? (attempt ? (await readPrivate(context, run.id, `intents/${attempt.id}.json`)).record?.binding : null);
    if (!binding || await (actor?.adapter ?? context.adapters?.[binding.client])?.confirm({ ...binding, ...actor?.proof }) !== true) return { state: 'pending' };
    recipientId = binding.actorId;
  } else if (!recipientId) recipientId = action.target === 'overseer' ? 'root:overseer' : 'root:master';
  if (recipientId === 'root:master') return { state: 'submitted' }; // The durable alert is the person's Waiting item.
  if (recipientId === 'root:overseer' && !await readUnitState(context, parseUnitId(recipientId))) return { state: 'pending' };
  if (recipientId !== 'root:overseer') {
    const addressed = action.messageId ? (await readPrivate(context, run.id, `messages/${action.messageId}.json`)).record?.recipients.filter(r => r.actorId === recipientId) : [{ role: 'coordinator', actorId: recipientId }];
    if (!addressed?.length) return { state: 'pending' };
    const outcomes = [], delivered = [];
    for (const recipient of addressed) {
      const file = runPrivateFile(context, run.id, `inbox/${hashBytes(Buffer.from(`${recipientId}:${recipient.role}`))}/${action.deliveryId}.json`);
      const bytes = await readBytes(context.store, file);
      if (!bytes) await commitChange({ ...context, receipt: null }, { id: randomUUID(), entries: [entry(file, null, { runId: run.id, deliveryId: action.deliveryId,
        messageId: action.messageId ?? null, actionId: action.id, kind: action.kind, recipientId, role: recipient.role, state: 'pending',
        text: `Untrusted Relay context: plan ${run.id}, ${action.kind}${action.messageId ? `, original message ${action.messageId}. Read your plan inbox and acknowledge the original ID explicitly.` : '. Read the plan warning and report the next step.'}` }, true)], events: [], response: { status: 200, body: null } });
      outcomes.push(bytes ? JSON.parse(bytes).state : 'pending');
      if (bytes && JSON.parse(bytes).deliveredAt) delivered.push(JSON.parse(bytes).deliveredAt);
    }
    if (!(context.runWake ?? context.store.runWake)) return { state: 'pending' };
    return { state: outcomes.every(s => s === 'submitted') ? 'submitted' : outcomes.some(s => s === 'ambiguous') ? 'ambiguous' : 'pending', deliveredAt: delivered.sort().at(-1) ?? null };
  }
  const plan = (await readPlanRecord(context, run.planId)).record;
  return queueRunPointer(context, { runId: run.id, chatId: plan.chatId, recipientId, deliveryId: action.deliveryId, messageId: action.messageId ?? null,
    kind: action.kind, at: new Date(action.dueAt).toISOString(), role: binding?.role ?? null });
}
export async function settleRunExtension(context, approval) {
  if (approval.action !== 'plan.message.extend') return;
  return withLocalChanges(context.store, async () => {
    const { runId, extensionId, count } = approval.pattern, run = (await readRunRecord(context, runId)).record;
    owner(context, run);
    if (!['open', 'stopping'].includes(run.state)) return;
    const extension = await readPrivate(context, runId, `extensions/${extensionId}.json`);
    if (!extension.record || extension.record.approvalId !== approval.id || extension.record.count !== count || extension.record.state !== 'pending') return;
    const verified = await readApproval(context, approval.id);
    if (verified.state !== 'approved' && !['denied', 'expired'].includes(verified.state)) return;
    const budget = await readPrivate(context, run.id, 'budget.json'); let ledger = budget.record;
    if (verified.state === 'approved') ledger = applyRunBudget(ledger, { id: `person:${approval.id}`, kind: 'extend', extensionId, count,
      reason: extension.record.reason, requester: extension.record.requester, authority: 'person', approvalId: approval.id });
    ledger.events = [];
    run.budget = projectRunBudget(ledger);
    for (const alert of run.alerts.filter(a => a.extensionId === extensionId)) alert.resolved = true;
    await appendRun({ ...context, receipt: null }, run, { eventId: `extension:${approval.id}`, kind: 'budget_decision', values: { count, reason: extension.record.reason, decision: verified.state } },
      [entry(runPrivateFile(context, runId, `extensions/${extensionId}.json`), extension.bytes, { ...extension.record, state: verified.state }, true),
        entry(runPrivateFile(context, runId, 'budget.json'), budget.bytes, ledger, true)]);
  });
}
export async function reconcileRunExtensions(context, run) {
  for (const alert of run.alerts.filter(a => a.kind === 'extension' && !a.resolved && a.approvalId)) await settleRunExtension(context, await readApproval(context, alert.approvalId));
}
export async function stopPlanSession(context, binding, input) {
  requirePlanDesktop(context, 'session.stop');
  if (input.confirmed !== true || input.onAcknowledged) runError('stop_unavailable');
  await cleanupRunAttempt(context, binding.runId, binding.attemptId, { stop: true });
  return { sessionId: binding.sessionId, state: 'stopped', acknowledged: true };
}
export async function waitForPlanActor(context, sessionId) {
  const pending = context.store?.pendingPlanActors?.get(sessionId);
  if (!pending) return;
  let timer;
  try {
    if (!await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500); })])) runError('launch_ambiguous');
  } finally { clearTimeout(timer); }
}
export async function planFileTool(context, operation, input) {
  if (typeof input?.path !== 'string') runError('invalid_body', 422);
  const key = process.platform === 'win32' ? path.resolve(input.path).toLowerCase() : path.resolve(input.path);
  return withLocks(context.store, [`plan-file:${key}`], () => planFileOperation(context, operation, input));
}
async function planFileOperation(context, operation, input) {
  const binding = await planBindingForSession(context, context.principal?.sessionId);
  await assertPlanActor(context, binding?.runId, binding?.attemptId);
  const { verifiedFilePath } = await import('./file-access.mjs');
  const { directoryIdentity } = await import('./cluster-git.mjs');
  const { requestApproval, readApproval } = await import('./approvals.mjs');
  const owned = (await readPrivate(context, binding.runId, `scopes/${binding.attemptId}.json`)).record;
  const target = await verifiedFilePath(input.path), writing = operation === 'file_write';
  const inside = (root, file) => { const relative = path.relative(root, file); return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
  if (!owned || target.path.split(path.sep).some(part => part.toLowerCase() === '.git')
    || inside(context.paths.mind, target.path) || inside(context.paths.localDirectory, target.path)) runError('scope_unavailable');
  const approval = (await readPrivate(context, binding.runId, 'approval.json')).record;
  const root = owned.scope.writeRoots.find(root => inside(root.realPath, target.path));
  if (root && canonicalJson(await directoryIdentity(root.realPath)) !== canonicalJson(root.identity)) runError('scope_unavailable');
  const task = approval.taskWitnesses.find(task => task.id === binding.taskId);
  if (writing && (binding.role === 'reviewer' || !binding.taskId)) runError('forbidden', 403);
  if (writing && (typeof input.text !== 'string' || Buffer.byteLength(input.text) > 1048576
    || input.expectedRevision !== null && !/^[a-f0-9]{64}$/.test(input.expectedRevision ?? ''))) runError('invalid_body', 422);
  if (target.exists && (!target.state.isFile() || target.state.nlink !== 1n || target.state.size > 1048576n)) runError('scope_unavailable');
  const before = target.exists ? await readFile(target.path) : null;
  if (writing && revisionOf(before) !== input.expectedRevision) runError('revision_conflict');
  const ordinary = root && (!writing || task?.paths.includes(path.relative(root.realPath, target.path).replaceAll('\\', '/')));
  const pattern = { resource: owned.scope.id, path: target.path, operation: writing ? 'write' : 'read', snapshot: hashBytes(Buffer.from(canonicalJson({
    identity: target.identity, ancestor: target.ancestor, exists: target.exists, revision: revisionOf(before), textHash: writing ? hashBytes(Buffer.from(input.text)) : null }))) };
  if (!ordinary) {
    if (!input.approvalId) {
      const requested = await requestApproval(context, { action: 'file.write', pattern, display: writing ? 'Write this exact file outside the approved task paths' : 'Read this exact file outside the cluster', alwaysAllowed: false, operationId: input.requestId });
      throw new CoreError(409, 'outside_scope', 'This exact file needs person approval.', { approvalId: requested.approval.id });
    }
    const answer = await readApproval(context, input.approvalId);
    if (answer.sessionId !== binding.sessionId || answer.unitId !== binding.actorId || answer.state !== 'approved' || canonicalJson(answer.pattern) !== canonicalJson(pattern)) runError('outside_scope');
    const consumed = runPrivateFile(context, binding.runId, `file-approvals/${input.approvalId}.json`);
    if (await readBytes(context.store, consumed)) runError('outside_scope');
    await commitChange({ ...context, receipt: null }, { id: randomUUID(), entries: [entry(consumed, null, { attemptId: binding.attemptId }, true)], events: [], response: { status: 200, body: null } });
  }
  const checked = await verifiedFilePath(target.path);
  if (checked.identity !== target.identity || checked.exists !== target.exists || target.exists && !before.equals(await readFile(target.path))) runError('scope_unavailable');
  await assertPlanActor(context, binding.runId, binding.attemptId);
  if (!writing) {
    if (!before || before.includes(0)) runError('scope_unavailable');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(before);
    return { path: target.path, revision: revisionOf(before), text: /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|.*\.(?:key|pem|p12|pfx)|credentials(?:\..*)?)$/i.test(path.basename(target.path))
      ? text.split(/\r?\n/).map(line => line.match(/^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*[:=]/)?.[1]).filter(Boolean).join('\n') : text };
  }
  if (!target.exists && path.dirname(target.path) !== target.ancestor) runError('scope_unavailable');
  const handle = await openFile(target.path, constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0) | (target.exists ? 0 : constants.O_CREAT | constants.O_EXCL), 0o600);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.nlink !== 1n || target.exists && `${opened.dev}:${opened.ino}` !== target.identity) runError('scope_unavailable');
    const current = await verifiedFilePath(target.path);
    if (current.identity !== `${opened.dev}:${opened.ino}` || root && canonicalJson(await directoryIdentity(root.realPath)) !== canonicalJson(root.identity)) runError('scope_unavailable');
    const bytes = Buffer.from(input.text); await handle.writeFile(bytes); await handle.truncate(bytes.length); await handle.sync(); return { revision: revisionOf(bytes) };
  } finally { await handle.close(); }
}
export async function requestPlanNativeOperation(context, input, boundary) {
  const binding = await planBindingForSession(context, context.principal?.sessionId);
  await assertPlanActor(context, binding?.runId, binding?.attemptId);
  if (boundary?.verified !== true || typeof boundary.authorize !== 'function' || input.nativeSessionId !== binding.nativeSessionId) return false;
  const operation = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  if (operation.kind === 'process') {
    if (typeof operation.command !== 'string' || !operation.command || operation.command.length > 4096 || typeof operation.cwd !== 'string') return false;
    const executable = operation.command.match(/^\s*(?:"([^"]+)"|'([^']+)'|(\S+))/);
    if (executable && /^git(?:\.exe|\.cmd|\.bat)?$/i.test(path.win32.basename((executable[1] ?? executable[2] ?? executable[3]).replaceAll('/', '\\')))) return false;
  } else if (operation.kind !== 'write' || binding.role !== 'builder' || !Array.isArray(operation.paths) || !operation.paths.length || operation.paths.length > 256) return false;
  const { verifiedFilePath } = await import('./file-access.mjs');
  const owned = (await readPrivate(context, binding.runId, `scopes/${binding.attemptId}.json`)).record;
  const paths = operation.kind === 'process' ? [operation.cwd] : operation.paths, verified = [];
  const inside = (root, file) => { const relative = path.relative(root, file); return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
  for (const candidate of paths) {
    const target = await verifiedFilePath(candidate);
    if (inside(context.paths.mind, target.path) || inside(context.paths.localDirectory, target.path)
      || target.path.split(path.sep).some(part => part.toLowerCase() === '.git')
      || owned.scope.writeRoots.some(root => root.gitCommonDir && inside(root.gitCommonDir, target.path))) return false;
    verified.push({ path: target.path, identity: target.identity, ancestor: target.ancestor, exists: target.exists,
      modified: String(target.state.mtimeNs), changed: String(target.state.ctimeNs) });
  }
  const { requestApproval, readApproval } = await import('./approvals.mjs');
  const pattern = { resource: owned.scope.id, path: verified[0].path, operation: 'write', snapshot: hashBytes(Buffer.from(canonicalJson({ operation, verified }))) };
  const pending = await requestApproval(context, { action: 'file.write', pattern, display: operation.kind === 'process' ? 'Run this exact command in the plan sandbox' : 'Apply these exact plan file changes', alwaysAllowed: false, operationId: String(operation.id) });
  const deadline = Date.now() + Math.min(120000, context.nativeApprovalTimeoutMs ?? 120000);
  for (;;) {
    if (boundary.signal?.aborted || Date.now() >= deadline) return false;
    const approval = await readApproval(context, pending.approval.id);
    if (Date.parse(approval.expiresAt) <= context.now()) return false;
    if (!['pending', 'answering'].includes(approval.state)) {
      if (approval.state !== 'approved') return false;
      await assertPlanActor(context, binding.runId, binding.attemptId);
      for (const previous of verified) {
        const current = await verifiedFilePath(previous.path);
        if (current.identity !== previous.identity || current.ancestor !== previous.ancestor || current.exists !== previous.exists
          || String(current.state.mtimeNs) !== previous.modified || String(current.state.ctimeNs) !== previous.changed) return false;
      }
      const result = await boundary.authorize({ scopeId: owned.scope.id, sessionId: binding.sessionId, operation, role: binding.role,
        paths: verified.map(item => item.path), approvalId: approval.id, once: true });
      return result?.authorized === true;
    }
    await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); boundary.signal?.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, 50); boundary.signal?.addEventListener('abort', finish, { once: true });
    });
  }
}
export async function assertPlanLaunchAuthority(context, unitId = null) {
  const binding = await planBindingForSession(context, context.principal?.sessionId);
  if (!binding) {
    if (unitId || context.principal?.audience === 'agent') for (const id of await runIds(context)) {
      const run = (await readRunRecord(context, id)).record;
      if (!['open', 'stopping'].includes(run.state)) continue;
      const plan = (await readPlanRecord(context, run.planId)).record;
      if ([...Object.values(plan.roles), ...plan.tasks.map(task => task.assignment)].some(assignment => assignment.kind === 'unit'
        && (assignment.unitId === unitId || context.principal?.audience === 'agent' && assignment.unitId === context.principal.unitId))) runError('plan_lead_required', 403);
    }
    return;
  }
  await assertPlanActor(context, binding.runId);
  // All plan starts must use the frozen role intent, including existing child approvals.
  runError('plan_lead_required', 403);
}
export async function confirmPlanStart(context, input) {
  const binding = await assertPlanActor(context, input.runId, input.attemptId);
  const result = await ingestPlanSignal(context, { ...binding, id: `confirmed:${input.attemptId}`, kind: 'start', source: 'relay' });
  return { confirmed: true, at: result.at };
}
export async function reportPlanTask(context, input) {
  const binding = await assertPlanActor(context, input.runId, input.attemptId, { report: true });
  if (!['delivered', 'failed'].includes(input.outcome) || typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 1000000) runError('invalid_run_event', 422);
  const result = await ingestPlanSignal(context, { ...binding, id: `report:${input.attemptId}`, kind: 'report', source: 'relay', outcome: input.outcome, summary: input.summary });
  if (binding.role !== 'coordinator' && !['done', 'failed'].includes(result.taskState)) await actorTable(context).get(binding.sessionId)?.adapter.completePlanTask?.({ ...binding, outcome: input.outcome });
  return { accepted: true, taskState: result.taskState === 'awaiting_report' ? 'awaiting_exit' : result.taskState };
}

export async function ingestPlanSignal(context, value, witness = null) {
  let binding;
  const verified = nativeWitnesses.has(witness) || verifiedProcessWitness(witness);
  if (verified) {
    binding = witness;
    if (value !== witness || value.source === 'process' && !verifiedProcessWitness(witness)) runError('invalid_run_event', 422);
  } else {
    binding = await assertPlanActor(context, value.runId, value.attemptId, { report: value.kind === 'report' });
    if (!['relay', 'hook'].includes(value.source) || ['exit', 'cleanup'].includes(value.kind)) runError('invalid_run_event', 422);
  }
  const normalized = normalizeRunSignal({ id: value.id, kind: value.kind, source: value.source, role: binding.role, taskId: binding.taskId,
    at: context.now(), ...(value.step ? { step: value.step } : {}), ...(value.outcome ? { outcome: value.outcome } : {}) });
  return withLocalChanges(context.store, async () => {
    const { record: run } = await readRunRecord(context, binding.runId); owner(context, run); open(run);
    const attempt = run.attempts.find(item => item.id === binding.attemptId);
    if (!attempt || attempt.resolved || attempt.sessionId !== binding.sessionId) runError('invalid_run_event', 422);
    const name = `witnesses/${hashBytes(Buffer.from(`${binding.attemptId}:${normalized.eventId}`))}.json`;
    const prior = await readPrivate(context, run.id, name);
    const fingerprint = canonicalJson({ ...normalized, at: null, summary: value.summary ?? null, wireHash: value.wireHash ?? null });
    if (prior.record) {
      if (prior.record.fingerprint !== fingerprint) runError('invalid_run_event', 422);
      return prior.record.result;
    }
    const evidence = await readPrivate(context, run.id, `evidence/${attempt.id}.json`);
    const state = evidence.record ?? { report: null, processExited: false, cleanupVerified: false };
    if (normalized.kind === 'start') {
      if (attempt.confirmedAt === null) attempt.confirmedAt = normalized.at;
      for (const alert of run.alerts.filter(a => a.attemptId === attempt.id && a.kind === 'no_start')) alert.resolved = true;
      if (!run.watches.some(watch => watch.attemptId === attempt.id)) run.watches.push({ episodeId: randomUUID(), attemptId: attempt.id, role: attempt.role,
        phase: attempt.role === 'planner' ? 'planning' : run.mode, taskId: attempt.taskId, lastStepAt: normalized.at, resolved: false, notifications: [] });
    } else if (normalized.kind.startsWith('step_')) {
      if (attempt.confirmedAt === null) runError('invalid_run_event', 422);
      const watch = run.watches.find(watch => watch.attemptId === attempt.id && !watch.resolved);
      if (!watch) runError('invalid_run_event', 422);
      watch.lastStepAt = normalized.at; watch.episodeId = randomUUID(); watch.notifications = [];
      for (const alert of run.alerts.filter(a => a.attemptId === attempt.id && a.kind === 'stalled')) alert.resolved = true;
    } else if (normalized.kind === 'report') {
      if (state.report && state.report !== normalized.outcome) runError('invalid_run_event', 422);
      state.report = normalized.outcome; state.summary = value.summary ?? null;
    } else if (normalized.kind === 'exit') state.processExited = true;
    else if (normalized.kind === 'cleanup') state.cleanupVerified = true;
    let taskState = runTaskEndState(state);
    const plan = await readPlanRecord(context, run.planId), task = binding.role === 'builder' ? plan.record.tasks.find(task => task.id === attempt.taskId) : null;
    if (task && normalized.kind === 'start') task.state = 'busy';
    if (task && normalized.kind.startsWith('step_')) { task.step = normalized.step; task.stepAt = normalized.at; task.state = 'busy'; }
    if (['done', 'failed'].includes(taskState) && task) {
      const approval = (await readPrivate(context, run.id, 'approval.json')).record;
      if (taskState === 'done' && approval.commits) {
        try { await commitPlanTask(context, { ...approval, plan: publicPlan(plan.record) }, attempt.taskId); }
        catch (error) { taskState = 'cleanup_pending'; state.commitError = error.code ?? 'git_unavailable'; task.state = 'stuck'; }
      }
      if (taskState === 'done' || taskState === 'failed') {
        task.state = taskState;
        attempt.resolved = true; run.watches = run.watches.filter(watch => watch.attemptId !== attempt.id);
        actorTable(context).get(binding.sessionId) && (actorTable(context).get(binding.sessionId).active = false);
        if (taskState === 'done') run.taskIndex += 1;
        if (taskState === 'failed') run.state = 'stopping';
      }
    }
    const result = { sequence: run.sequence + 1, at: normalized.at, taskState };
    const entries = [entry(runPrivateFile(context, run.id, name), null, { fingerprint, result }, true),
      entry(runPrivateFile(context, run.id, `work/${String(result.sequence).padStart(12, '0')}.json`), null, { attemptId: attempt.id }, true),
      entry(runPrivateFile(context, run.id, `evidence/${attempt.id}.json`), evidence.bytes, state, true)];
    if (!task && binding.role !== 'coordinator' && ['done', 'failed'].includes(taskState)) {
      attempt.resolved = true; run.watches = run.watches.filter(watch => watch.attemptId !== attempt.id);
      if (binding.role === 'planner') {
        const active = actorTable(context).get(binding.sessionId);
        const checkpoint = await active?.adapter.checkpointContext?.({ ...binding, cached: true });
        if (checkpoint) {
          if (state.summary) checkpoint.messages = [...(checkpoint.messages ?? []), { role: 'assistant', content: state.summary }];
          const prior = await readPrivate(context, run.id, 'conversations/planner.json');
          entries.push(entry(runPrivateFile(context, run.id, 'conversations/planner.json'), prior.bytes, { runsIn: plan.record.roles.planner.runsIn, checkpoint }, true));
        }
      }
    }
    if (task) entries.push(entry(planFile(context, run.planId), plan.bytes, planRevision(plan.record)));
    if (run.taskIndex === plan.record.tasks.length || plan.record.tasks.some(task => task.state === 'failed')) {
      run.state = 'stopping';
    }
    if (normalized.kind === 'cleanup' && run.state === 'stopping' && run.attempts.every(item => item.id === attempt.id || item.resolved)) {
      run.state = plan.record.tasks.some(task => task.state === 'failed') ? 'failed' : run.taskIndex === plan.record.tasks.length ? 'completed' : 'stopped'; run.closedAt = normalized.at;
      attempt.resolved = true; run.watches = [];
    }
    await appendRun(context, run, { ...normalized, eventId: uuidV8(['run-evidence', binding.attemptId, normalized.eventId]),
      ...(state.commitError ? { state: 'fail' } : {}), values: { ...(normalized.step ? { step: normalized.step } : normalized.outcome ? { outcome: normalized.outcome } : {}), ...(state.commitError ? { code: state.commitError } : {}) } }, entries);
    if (normalized.kind === 'report') {
      // This is the actor's authored report, never a fabricated supervisor/model progress message.
      if (attempt.role === 'coordinator') await appendLeadReport(context, run, binding, state.summary);
    }
    if (attempt.resolved) {
      actorTable(context).delete(binding.sessionId);
      retireRunProcess(context, run.id, attempt.id);
    }
    if (run.state === 'stopping') queueStop(context, run.id);
    return result;
  });
}
async function appendLeadReport(context, run, binding, text) {
  if (!text) return;
  const plan = (await readPlanRecord(context, run.planId)).record, messageId = uuidV8(['plan-report', run.id, binding.attemptId]);
  const prepared = await authoredPlanEntry(context, plan, { id: messageId, authorId: binding.actorId, recipients: ['root:master'], text });
  if (prepared) await commitChange({ ...context, receipt: null }, { id: randomUUID(), entries: [prepared], events: [{ name: 'message.created', chatId: plan.chatId, data: { chatId: plan.chatId, messageId } }], response: { status: 201, body: null } });
}
export async function appendRun(context, record, event, extra = [], response = null) {
  const current = await readBytes(context.store, runFile(context, record.id));
  const run = planRevision({ ...record, sequence: record.sequence + 1 });
  const log = { format: 'hivem1nd-run-log-v1', runId: run.id, machine: run.machine, id: randomUUID(), sequence: run.sequence, eventId: event.eventId,
    at: event.at ?? stamp(context), role: event.role ?? null, taskId: event.taskId ?? null, kind: event.kind, key: `run.${event.kind}`,
    state: event.state ?? (event.kind.includes('failed') ? 'fail' : ['start', 'step_start'].includes(event.kind) ? 'busy'
      : ['bound', 'dispatch', 'stop_requested', 'launch_ambiguous'].includes(event.kind) ? 'wait' : 'done'), values: event.values ?? {}, source: event.source ?? 'service' };
  const logFile = path.join(path.dirname(runFile(context, run.id)), 'log', `${String(run.sequence).padStart(12, '0')}.json`);
  const events = [{ name: 'run.changed', data: { runId: run.id, revision: run.revision } }, { name: 'run.log', data: { runId: run.id, sequence: run.sequence } }];
  if (event.kind === 'queued' && run.alerts.some(a => !a.resolved)) events.push({ name: 'run.alert', data: { runId: run.id, alertId: run.alerts.find(a => !a.resolved).id } });
  if (!['open', 'stopping'].includes(run.state)) events.push({ name: 'run.closed', data: { runId: run.id, state: run.state } });
  await commitChange(context, { id: randomUUID(), entries: [entry(runFile(context, run.id), current, run), entry(logFile, null, log), ...extra],
    events, response: response ?? { status: 200, body: null } });
  Object.assign(record, run); return log;
}

export async function dispatchPlanRole(context, input) {
  const binding = await assertPlanActor(context, input.runId);
  if (binding.role !== 'coordinator') runError('plan_lead_required', 403);
  const lease = await maintainRunLease(context, (await readRunRecord(context, input.runId)).record);
  if (lease?.pausedReason) runError('wake_unavailable');
  if (!PLAN_ROLES.includes(input.role) || input.role === 'coordinator' || input.taskId !== null && typeof input.taskId !== 'string') runError('invalid_run_event', 422);
  const body = await withLocalChanges(context.store, async () => {
    const { record: run } = await readRunRecord(context, input.runId); revision(run, input.expectedRevision);
    if (run.state !== 'open' || run.attempts.some(attempt => !attempt.resolved && attempt.role === input.role)) runError('plan_already_open');
    const approval = (await readPrivate(context, run.id, 'approval.json')).record;
    const task = input.taskId ? approval.plan.tasks.find(task => task.id === input.taskId) : null;
    if (input.taskId && (!task || run.mode !== 'execution' || input.role === 'builder' && approval.plan.tasks[run.taskIndex]?.id !== input.taskId)) runError('invalid_run_event', 422);
    if (input.role === 'builder' && !task) runError('invalid_run_event', 422);
    const override = (await readPrivate(context, run.id, `assignments/${input.role === 'builder' ? hashBytes(Buffer.from(input.taskId)) : input.role}.json`)).record;
    const assignment = override?.assignment ?? (input.role === 'builder' ? task.assignment : approval.plan.roles[input.role]), attemptId = randomUUID();
    const intent = { requestId: input.requestId, runId: run.id, attemptId, role: input.role, taskId: input.taskId,
      assignment, dispatcherRole: binding.role, state: 'prepared', sessionId: null };
    run.attempts = run.attempts.filter(attempt => !attempt.resolved);
    run.attempts.push({ id: attemptId, role: input.role, taskId: input.taskId, sentAt: stamp(context), confirmedAt: null, resolved: false, sessionId: null, notifications: [] });
    const result = { attemptId, requestId: input.requestId };
    await appendRun(context, run, { eventId: input.requestId, kind: 'dispatch', role: input.role, taskId: input.taskId, values: {}, source: 'service' },
      [entry(runPrivateFile(context, run.id, `intents/${attemptId}.json`), null, intent, true)], { status: 202, body: result });
    return result;
  });
  queueLaunch(context, input.runId, body.attemptId); return body;
}
function queueStop(context, runId) {
  context.store.runStops ??= new Map();
  if (context.store.runStops.has(runId)) return context.store.runStops.get(runId);
  const work = new Promise(resolve => setImmediate(resolve)).then(async () => {
    const run = (await readRunRecord(context, runId)).record;
    for (const attempt of run.attempts.filter(attempt => !attempt.resolved)) await cleanupRunAttempt(context, runId, attempt.id, { stop: true });
    await withLocalChanges(context.store, async () => {
      const latest = (await readRunRecord(context, runId)).record;
      if (!['open', 'stopping'].includes(latest.state)) return;
      const plan = (await readPlanRecord(context, latest.planId)).record;
      latest.state = plan.tasks.some(task => task.state === 'failed') ? 'failed' : latest.taskIndex === plan.tasks.length ? 'completed' : 'stopped'; latest.closedAt = stamp(context);
      for (const attempt of latest.attempts) attempt.resolved = true;
      latest.watches = [];
      await appendRun(context, latest, { eventId: `closed:${runId}`, kind: 'closed', values: {} });
      for (const attempt of latest.attempts) {
        actorTable(context).delete(attempt.sessionId);
        if (liveRunProcess(context, runId, attempt.id)) retireRunProcess(context, runId, attempt.id);
      }
    });
  }).catch(() => {}).finally(() => context.store.runStops.delete(runId));
  context.store.runStops.set(runId, work); return work;
}
export async function controlRun(context, id, input) {
  requirePlanDesktop(context, 'session.stop');
  return withLocks(context.store, [`run-control:${id}`], () => controlRunOperation(context, id, input));
}
async function controlRunOperation(context, id, input) {
  const fields = { stop_step: ['attemptId'], retry_start: ['attemptId'], retry_task: ['attemptId'], replace_role: ['role', 'assignment'], resend: ['messageId', 'recipientId'], stop_run: [] };
  if (!fields[input?.action]) planError(); exactPlanObject(input, ['action', 'expectedRevision', ...fields[input.action]]);
  const { record: run } = await readRunRecord(context, id); owner(context, run); open(run); revision(run, input.expectedRevision);
  const requestId = context.receipt?.requestId ?? randomUUID();
  if (input.action === 'stop_step') { await stopRunStep(context, id, input.attemptId); return { runId: id, requestId }; }
  if (input.action === 'stop_run') {
    await withLocalChanges(context.store, async () => {
      const fresh = (await readRunRecord(context, id)).record; revision(fresh, input.expectedRevision); fresh.state = 'stopping';
      await appendRun(context, fresh, { eventId: requestId, kind: 'stop_requested', values: {} }, [], { status: 202, body: { runId: id, requestId } });
    });
    queueStop(context, id); return { runId: id, requestId };
  }
  if (input.action === 'resend') {
    await withLocalChanges(context.store, async () => {
      const fresh = (await readRunRecord(context, id)).record; revision(fresh, input.expectedRevision);
      const recipient = fresh.messages.find(m => m.id === input.messageId)?.recipients.find(r => r.actorId === input.recipientId && r.readAt === null);
      if (!recipient) runError('invalid_run_event', 422);
      // Manual and automatic resend share one retry identity and the original deadline.
      await queueRunAction(context, fresh, { id: `retry:${input.messageId}:${input.recipientId}`, kind: 'unread_retry', messageId: input.messageId,
        recipientId: input.recipientId, dueAt: context.now() });
      await appendRun(context, fresh, { eventId: requestId, kind: 'resend', values: { messageId: input.messageId } }, [], { status: 202, body: { runId: id, requestId } });
    });
    await deliverRunActions(context); return { runId: id, requestId };
  }
  const old = input.action === 'replace_role' ? run.attempts.find(attempt => attempt.role === input.role && !attempt.resolved)
    : run.attempts.find(attempt => attempt.id === input.attemptId);
  if (!old || old.resolved || run.state !== 'open') runError('invalid_run_event', 422);
  const previous = await readPrivate(context, id, `intents/${old.id}.json`);
  let assignment = previous.record.assignment, replacement = null;
  if (input.action === 'replace_role') {
    if (!PLAN_ROLES.includes(input.role)) planError();
    const plan = (await readPlanRecord(context, run.planId)).record;
    const roles = { ...plan.roles, [input.role]: input.assignment };
    const tasks = plan.tasks.map(task => ({ id: task.id, title: task.title,
      assignment: input.role === 'builder' && task.id === old.taskId ? input.assignment : task.assignment }));
    const resolved = await resolvePlan(context, { ...plan, roles, tasks }, plan.id);
    assignment = resolved.roles[input.role];
    replacement = { assignment, role: input.role, taskId: old.taskId, confirmedBy: 'root:master', requestId, sourceRevision: run.revision };
  }
  const evidence = (await readPrivate(context, id, `evidence/${old.id}.json`)).record;
  if (old.role === 'builder' && evidence?.report === 'delivered') runError('task_reconciliation_required');
  await cleanupRunAttempt(context, id, old.id, { stop: true });
  return withLocalChanges(context.store, async () => {
    const latest = (await readRunRecord(context, id)).record;
    if (latest.state !== 'open' || !latest.attempts.some(attempt => attempt.id === old.id && !attempt.resolved)) runError('plan_changed');
    const attemptId = randomUUID(), intent = { ...previous.record, attemptId, requestId, assignment, state: 'prepared', sessionId: null, dispatcherRole: 'coordinator' };
    delete intent.binding; delete intent.native;
    latest.attempts = latest.attempts.filter(attempt => attempt.id !== old.id);
    latest.watches = latest.watches.filter(watch => watch.attemptId !== old.id);
    latest.attempts.push({ ...old, id: attemptId, confirmedAt: null, sentAt: stamp(context), resolved: false, sessionId: null, notifications: [] });
    const entries = [entry(runPrivateFile(context, id, `intents/${attemptId}.json`), null, intent, true)];
    if (replacement) {
      const plan = await readPlanRecord(context, latest.planId);
      plan.record.roles[input.role] = assignment;
      const task = input.role === 'builder' ? plan.record.tasks.find(task => task.id === old.taskId) : null;
      if (task) Object.assign(task, { assignment, runsIn: assignment.runsIn, actorId: assignment.kind === 'unit' ? assignment.unitId : `plan:${plan.record.id}:builder` });
      const overrideFile = runPrivateFile(context, id, `assignments/${task ? hashBytes(Buffer.from(task.id)) : input.role}.json`);
      entries.push(entry(planFile(context, plan.record.id), plan.bytes, planRevision(plan.record)),
        entry(runPrivateFile(context, id, `replacements/${requestId}.json`), null, replacement, true),
        entry(overrideFile, await readBytes(context.store, overrideFile), replacement, true));
    }
    await appendRun(context, latest, { eventId: requestId, kind: 'retry', role: old.role, taskId: old.taskId, values: {} },
      entries, { status: 202, body: { runId: id, requestId } });
    actorTable(context).delete(old.sessionId); retireRunProcess(context, id, old.id);
    queueLaunch(context, id, attemptId); return { runId: id, requestId };
  });
}

export async function recoverRuns(context) {
  await drainRunLaunches(context); const result = [];
  for (const id of await runIds(context)) {
    const run = (await readRunRecord(context, id)).record;
    if (run.machine !== context.paths.machine || !['open', 'stopping'].includes(run.state)) continue;
    for (const attempt of run.attempts.filter(attempt => !attempt.resolved)) {
      const evidence = (await readPrivate(context, id, `evidence/${attempt.id}.json`)).record;
      const ownedProcess = (await readPrivate(context, id, `processes/${attempt.id}.json`)).record;
      if (attempt.role === 'builder' && evidence?.report === 'delivered' && evidence.processExited && evidence.cleanupVerified && ownedProcess?.exited && ownedProcess.cleaned
        && ownedProcess.runId === id && ownedProcess.attemptId === attempt.id && ownedProcess.sessionId === attempt.sessionId) {
        try {
          const approval = (await readPrivate(context, id, 'approval.json')).record, plan = await readPlanRecord(context, run.planId);
          await commitPlanTask(context, { ...approval, plan: publicPlan(plan.record) }, attempt.taskId);
          await withLocalChanges(context.store, async () => {
            const latest = (await readRunRecord(context, id)).record, currentPlan = await readPlanRecord(context, run.planId);
            const pending = latest.attempts.find(item => item.id === attempt.id && !item.resolved);
            if (!pending || currentPlan.record.tasks[latest.taskIndex]?.id !== attempt.taskId) runError('plan_changed');
            pending.resolved = true; latest.taskIndex++; latest.watches = latest.watches.filter(watch => watch.attemptId !== attempt.id);
            currentPlan.record.tasks.find(task => task.id === attempt.taskId).state = 'done';
            if (latest.taskIndex === currentPlan.record.tasks.length) latest.state = 'stopping';
            await appendRun(context, latest, { eventId: uuidV8(['run-task-reconciled', id, attempt.id]), kind: 'task_reconciled', role: 'builder', taskId: attempt.taskId, values: {} },
              [entry(planFile(context, run.planId), currentPlan.bytes, planRevision(currentPlan.record))]);
            actorTable(context).delete(attempt.sessionId);
            if (liveRunProcess(context, id, attempt.id)) retireRunProcess(context, id, attempt.id);
            if (latest.state === 'stopping') queueStop(context, id);
          });
          continue;
        } catch { /* Commit uncertainty retains the open task and its original approval. */ }
      }
      const intent = (await readPrivate(context, id, `intents/${attempt.id}.json`)).record;
      if (run.state === 'open' && intent?.state === 'prepared') queueLaunch(context, id, attempt.id);
      else if (!liveRunProcess(context, id, attempt.id)) {
        result.push({ runId: id, attemptId: attempt.id, code: 'launch_ambiguous' });
        await withLocalChanges(context.store, async () => {
          const latest = (await readRunRecord(context, id)).record;
          if (!latest.alerts.some(alert => alert.id === `recovery:${attempt.id}`)) {
            latest.alerts.push({ id: `recovery:${attempt.id}`, kind: 'cleanup', attemptId: attempt.id, messageId: null, recipientId: null, at: stamp(context), resolved: false, told: [], next: [], extensionId: null });
            await appendRun(context, latest, { eventId: `recovery:${attempt.id}`, kind: 'launch_ambiguous', values: {} });
          }
        });
      }
    }
    if (run.state === 'stopping') queueStop(context, id);
  }
  return result;
}

export function planToolSchemas() {
  const uuid = { type: 'string', format: 'uuid', maxLength: 36 }, rev = { type: 'string', format: 'hash', maxLength: 64 };
  const role = { type: 'string', enum: PLAN_ROLES }, text = { type: 'string', maxLength: 1000000 };
  const common = { runId: uuid }, attempt = { ...common, attemptId: uuid }, request = { requestId: uuid };
  const definitions = {
    plan_confirm_start: { ...attempt, ...request },
    plan_step: { ...attempt, eventId: { type: 'string', maxLength: 128 }, step: { type: 'string', enum: ['tests', 'build', 'edit', 'plan', 'review', 'work'] }, state: { type: 'string', enum: ['started', 'completed'] }, ...request },
    plan_report: { ...attempt, outcome: { type: 'string', enum: ['delivered', 'failed'] }, summary: text, ...request },
    plan_dispatch: { ...common, role, taskId: { type: ['string', 'null'], maxLength: 256 }, expectedRevision: rev, ...request },
    plan_send: { ...common, recipientRoles: { type: 'array', minItems: 1, maxItems: 4, items: role }, text, ...request },
    plan_read: { ...common, messageIds: { type: 'array', maxItems: 200, items: uuid }, ...request },
    plan_extend: { ...common, count: { type: 'integer', minimum: 1, maximum: 10000 }, reason: { type: 'string', maxLength: 1000 }, expectedRevision: rev, ...request },
    plan_agree: { ...common, extensionId: uuid, expectedRevision: rev, ...request },
  };
  return Object.entries(definitions).map(([name, properties]) => ({ name, description: name.replaceAll('_', ' '), inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } }));
}
export async function callPlanTool(context, name, input) {
  const definition = planToolSchemas().find(tool => tool.name === name);
  if (!definition) planError(); exactPlanObject(input, definition.inputSchema.required);
  await assertPlanActor(context, input.runId, input.attemptId, { report: name === 'plan_report' });
  // Authenticate before looking up receipts, so revoked/replaced sessions cannot replay authority.
  return withReceipt(context.store, { principal: context.principal.sessionId, key: input.requestId, requestId: input.requestId, method: 'POST', path: `/mcp/${name}`, body: input }, async receipt => {
    const bound = { ...context, receipt };
    let result;
    if (name === 'plan_confirm_start') result = await confirmPlanStart(bound, input);
    else if (name === 'plan_report') result = await reportPlanTask(bound, input);
    else if (name === 'plan_dispatch') result = await dispatchPlanRole(bound, input);
    else if (name === 'plan_step') {
      const binding = await assertPlanActor(bound, input.runId, input.attemptId);
      const observed = await ingestPlanSignal(bound, { ...binding, id: input.eventId, kind: input.state === 'started' ? 'step_start' : 'step_end', step: input.step, source: 'relay' });
      result = { sequence: observed.sequence };
    } else result = await budgetTool(bound, name, input);
    const file = path.join(context.store.localDirectory, 'receipts', receipt.principalHash, `${receipt.key}.json`), before = await readBytes(context.store, file);
    await commitChange(bound, { id: randomUUID(), entries: [entry(file, before, { ...receipt, status: name === 'plan_report' || name === 'plan_dispatch' || name === 'plan_extend' ? 202 : name === 'plan_send' ? 201 : 200, response: result }, true)],
      events: [], response: { status: name === 'plan_report' || name === 'plan_dispatch' || name === 'plan_extend' ? 202 : name === 'plan_send' ? 201 : 200, body: result } });
    return result;
  }).then(result => result?.replayed ? result.body : result);
}

export async function validatePlanRunBundle(context, entries, machine) {
  const selected = entries.filter(item => item.target?.kind === 'mind' && /^user\/gui\/(?:plans|runs)\//.test(item.target.path));
  const incoming = new Map(selected.map(item => [item.target.path, item.bytes]));
  for (const item of selected) {
    const match = /^user\/gui\/(plans|runs)\/([a-f0-9-]{36})\/(plan\.json|run\.json|log\/\d{12}\.json)$/.exec(item.target.path);
    if (!match || item.deleted || !item.bytes || item.bytes.length > 16000000) runError('invalid_pack', 422);
    const record = JSON.parse(item.bytes);
    const currentBytes = await readBytes(context.store, path.join(context.paths.mind, item.target.path));
    const current = currentBytes ? JSON.parse(currentBytes) : null;
    if (record.machine !== machine || current && current.machine !== machine) runError('invalid_record_owner', 422);
    const forbidden = value => value && typeof value === 'object' && Object.entries(value).some(([key, child]) =>
      /^(?:pid|nativeSessionId|executionId|credential|credentials|token|environment|rawOutput|native|lease|bootstrap|secret)$/i.test(key) || forbidden(child));
    if (forbidden(record)) runError('invalid_pack', 422);
    if (match[3].startsWith('log/')) {
      if (record.format !== 'hivem1nd-run-log-v1' || record.runId !== match[2] || !Number.isSafeInteger(record.sequence)
        || match[3] !== `log/${String(record.sequence).padStart(12, '0')}.json` || currentBytes && !currentBytes.equals(item.bytes)) runError('corrupt_resource', 422);
      const runPath = `user/gui/runs/${match[2]}/run.json`, runBytes = incoming.get(runPath) ?? await readBytes(context.store, path.join(context.paths.mind, runPath));
      if (!runBytes || JSON.parse(runBytes).machine !== machine) runError('invalid_record_owner', 422);
    } else {
      if (record.id !== match[2] || planRevision(record).revision !== record.revision || !['hivem1nd-plan-v1', 'hivem1nd-run-v1'].includes(record.format)) runError('invalid_pack', 422);
      if (record.format === 'hivem1nd-plan-v1') {
        if (!Array.isArray(record.tasks) || record.tasks.length < 1 || record.tasks.length > 10000 || !isUuid(record.chatId) || !isUuid(record.clusterId)) runError('invalid_pack', 422);
      } else if (!Array.isArray(record.attempts) || record.attempts.length > 4 || record.watches.length > 4) runError('invalid_pack', 422);
    }
  }
}
async function budgetTool(context, name, input) {
  const binding = await assertPlanActor(context, input.runId);
  return withLocalChanges(context.store, async () => {
    const { record: run } = await readRunRecord(context, input.runId), budget = await readPrivate(context, run.id, 'budget.json');
    let ledger = budget.record, result, entries = [], budgetDecision = null;
    if (name === 'plan_send') {
      if (!Array.isArray(input.recipientRoles) || !input.recipientRoles.length || input.recipientRoles.length > 4 || new Set(input.recipientRoles).size !== input.recipientRoles.length
        || input.recipientRoles.some(role => !PLAN_ROLES.includes(role)) || typeof input.text !== 'string' || !input.text.trim() || Buffer.byteLength(input.text) > 1000000) planError();
      const messageId = uuidV8(['plan-message', run.id, input.requestId]);
      const messageRecord = await readPrivate(context, run.id, `messages/${messageId}.json`);
      if (messageRecord.record) {
        if (messageRecord.record.authorId !== binding.actorId || messageRecord.record.textHash !== hashBytes(Buffer.from(input.text))) runError('invalid_run_event', 422);
        return { messageId };
      }
      ledger = applyRunBudget(ledger, { id: input.requestId, kind: 'spend', messageId }); ledger.events = [];
      const approval = (await readPrivate(context, run.id, 'approval.json')).record;
      const addressed = [];
      for (const role of input.recipientRoles) {
        const attempt = run.attempts.find(attempt => attempt.role === role && !attempt.resolved);
        const intent = attempt ? (await readPrivate(context, run.id, `intents/${attempt.id}.json`)).record : null;
        const assignment = intent?.assignment ?? (role === 'builder' ? approval.plan.tasks[run.taskIndex]?.assignment : null) ?? approval.plan.roles[role];
        addressed.push({ role, actorId: assignment.kind === 'unit' ? assignment.unitId : `plan:${run.planId}:${role}`, readAt: null });
      }
      const recipients = addressed.map(recipient => recipient.actorId);
      entries.push(entry(runPrivateFile(context, run.id, `messages/${messageId}.json`), null, { authorId: binding.actorId, authorRole: binding.role,
        textHash: hashBytes(Buffer.from(input.text)), recipients: addressed }, true));
      const prepared = await authoredPlanEntry(context, approval.plan, { id: messageId, authorId: binding.actorId, recipients, text: input.text });
      if (prepared) entries.push(prepared);
      run.messages.push({ id: messageId, sentAt: stamp(context), recipients: [...new Set(recipients)].map(actorId => ({ actorId, readAt: null, retriedAt: null, notifications: [] })) });
      for (const actorId of new Set(recipients)) {
        const action = { id: `message:${messageId}:${actorId}`, kind: 'message', runId: run.id, messageId, recipientId: actorId, dueAt: context.now(),
          deliveryId: uuidV8(['run-delivery', run.id, `message:${messageId}:${actorId}`]), state: 'pending', queuedAt: stamp(context), deliveredAt: null };
        entries.push(entry(runPrivateFile(context, run.id, `outbox/${hashBytes(Buffer.from(action.id))}.json`), null, action, true));
      }
      result = { messageId };
    } else if (name === 'plan_read') {
      if (!Array.isArray(input.messageIds) || input.messageIds.length > 200 || new Set(input.messageIds).size !== input.messageIds.length || input.messageIds.some(id => !isUuid(id))) planError();
      for (const id of input.messageIds) {
        const loaded = await readPrivate(context, run.id, `messages/${id}.json`), message = loaded.record;
        if (!message?.recipients.some(recipient => recipient.role === binding.role && recipient.actorId === binding.actorId)) runError('forbidden', 403);
        const recipient = run.messages.find(message => message.id === id)?.recipients.find(recipient => recipient.actorId === binding.actorId);
        if (!recipient) runError('forbidden', 403);
        message.recipients.find(r => r.role === binding.role && r.actorId === binding.actorId).readAt ??= stamp(context);
        if (message.recipients.filter(r => r.actorId === binding.actorId).every(r => r.readAt)) recipient.readAt ??= stamp(context);
        entries.push(entry(runPrivateFile(context, run.id, `messages/${id}.json`), loaded.bytes, message, true));
        for (const alert of run.alerts.filter(a => a.messageId === id && a.recipientId === binding.actorId)) alert.resolved = recipient.readAt !== null;
      }
      const plan = (await readPlanRecord(context, run.planId)).record;
      const receiptFile = path.join(context.paths.mind, 'user', 'relay', 'chats', plan.chatId, 'read', Buffer.from(binding.actorId).toString('base64url'), run.machine, `${input.requestId}.json`);
      const acknowledged = input.messageIds.filter(id => run.messages.find(m => m.id === id)?.recipients.find(r => r.actorId === binding.actorId)?.readAt);
      entries.push(entry(receiptFile, null, { format: 'hivem1nd-chat-read-v1', chatId: plan.chatId, unitId: binding.actorId, machine: run.machine, messageIds: acknowledged, at: stamp(context) }));
      result = { messageIds: input.messageIds };
    } else if (name === 'plan_extend') {
      revision(run, input.expectedRevision);
      if (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > 10000 || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000 || /[\x00-\x1f\x7f]/.test(input.reason)) runError('invalid_extension', 422);
      const extensionId = uuidV8(['plan-extension', run.id, input.requestId]);
      const crosses = projectRunBudget(ledger).roleExtra + input.count > Math.floor(ledger.base / 2);
      const approvalId = crosses ? await requestPlanExtensionApproval(context, run, binding, { extensionId, count: input.count, reason: input.reason }) : null;
      entries.push(entry(runPrivateFile(context, run.id, `extensions/${extensionId}.json`), null, { extensionId, requester: binding.role,
        requesterSession: binding.sessionId, count: input.count, reason: input.reason, state: 'pending', approvalId }, true));
      if (approvalId) run.alerts.push({ id: `extension:${extensionId}`, kind: 'extension', extensionId, approvalId, at: stamp(context), resolved: false, told: [], next: [], attemptId: null, messageId: null, recipientId: null });
      result = { extensionId, state: 'pending', approvalId };
    } else {
      revision(run, input.expectedRevision);
      const extension = await readPrivate(context, run.id, `extensions/${input.extensionId}.json`);
      if (!extension.record || extension.record.requester === binding.role || extension.record.state !== 'pending') runError('invalid_extension', 422);
      if (extension.record.requesterSession === binding.sessionId) runError('invalid_extension', 422);
      budgetDecision = { count: extension.record.count, reason: extension.record.reason, requester: extension.record.requester, approver: binding.role };
      if (extension.record.approvalId || projectRunBudget(ledger).roleExtra + extension.record.count > Math.floor(ledger.base / 2)) {
        const approvalId = extension.record.approvalId ?? await requestPlanExtensionApproval(context, run, binding, extension.record);
        entries.push(entry(runPrivateFile(context, run.id, `extensions/${input.extensionId}.json`), extension.bytes, { ...extension.record, approvalId }, true));
        if (!run.alerts.some(a => a.extensionId === input.extensionId)) run.alerts.push({ id: `extension:${input.extensionId}`, kind: 'extension', extensionId: input.extensionId, approvalId, at: stamp(context), resolved: false, told: [], next: [], attemptId: null, messageId: null, recipientId: null });
        result = { extensionId: input.extensionId, state: 'pending', budget: projectRunBudget(ledger) };
      } else {
        ledger = applyRunBudget(ledger, { id: input.requestId, kind: 'extend', extensionId: input.extensionId, count: extension.record.count, reason: extension.record.reason,
          requester: extension.record.requester, approver: binding.role, authority: 'roles' }); ledger.events = [];
        entries.push(entry(runPrivateFile(context, run.id, `extensions/${input.extensionId}.json`), extension.bytes, { ...extension.record, state: 'approved', approver: binding.role }, true));
        result = { extensionId: input.extensionId, state: 'approved', budget: projectRunBudget(ledger) };
      }
    }
    run.budget = projectRunBudget(ledger);
    entries.push(entry(runPrivateFile(context, run.id, 'budget.json'), budget.bytes, ledger, true));
    await appendRun(context, run, { eventId: input.requestId, kind: name.slice(5), role: binding.role, taskId: binding.taskId,
      values: budgetDecision ?? (name === 'plan_extend' ? { count: input.count, reason: input.reason } : {}), source: 'relay' }, entries,
      { status: name === 'plan_send' ? 201 : name === 'plan_extend' ? 202 : 200, body: result });
    return result;
  });
}
