import { createOperation, request } from './api.mjs';
import { collectPages } from './lists.mjs';
import { runsInLabel } from './clusters.mjs';
import { renderPlanCard } from './plan-view.mjs';
import { element } from './components.mjs';
import { text } from './i18n.mjs';
import { readableIdentity } from './hierarchy.mjs';
import { startText } from './start-copy.mjs';

export function createPlanController(api, notify = () => {}) {
  return { api, notify, plans: new Map(), runs: new Map(), operations: new Map(), pending: new Map(), errors: new Map() };
}

export function retainedPlanAction(controller, key, spec) {
  if (controller.pending.has(key)) return controller.pending.get(key);
  const operation = controller.operations.get(key) ?? createOperation(spec);
  controller.operations.set(key, operation); controller.errors.delete(key);
  const promise = Promise.resolve().then(() => request(controller.api, operation.method, operation.path, { operation }))
    .catch(error => { controller.errors.set(key, error); if (error.status >= 400 && error.status < 500) controller.operations.delete(key); throw error; })
    .finally(() => { controller.pending.delete(key); controller.notify(); });
  controller.pending.set(key, promise); controller.notify(); return promise;
}

export async function loadChatPlans(controller, clusterId) {
  const result = await collectPages(controller.api, '/plans', { query: { clusterId }, limit: 50 });
  for (const plan of result.items) controller.plans.set(plan.id, plan);
  return result.items;
}

// A task that exists is sent by its id; a new one by title and body, and the service creates its file with the plan.
export function planTaskItem(task) {
  const { title, assignment } = task;
  return task.id ? { id: task.id, title, assignment } : { title, ...(task.body ? { body: task.body } : {}), assignment };
}

export const PLAN_TASK_LIMIT = 50;
export function planBranch(title) {
  const slug = String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '');
  return `plan-${slug || 'draft'}`;
}

// Each top-level list item and each level-two heading of a Void text becomes a task title; the paragraphs that follow it are its body.
export function tasksFromVoidText(document, language = 'en') {
  const other = language === 'es' ? 'en' : 'es';
  const source = (Array.isArray(document?.pages) ? document.pages : []).map(page => [language, other, ...Object.keys(page ?? {})]
    .map(key => key !== 'k' && typeof page?.[key] === 'string' ? page[key] : '').find(value => value) ?? '').join('\n\n');
  const tasks = []; let current = null, paragraph = [], fence = false;
  const flush = () => { if (current && paragraph.length) current.paragraphs.push(paragraph.join('\n').trim()); paragraph = []; };
  const start = raw => {
    const title = raw.replace(/^\[[ xX]\]\s+/, '').replace(/\s+/g, ' ').trim();
    flush(); current = title ? { title, paragraphs: [] } : null;
    if (current) tasks.push(current);
  };
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^ {0,3}(?:```|~~~)/.test(line)) { fence = !fence; if (current) paragraph.push(line); continue; }
    if (fence) { if (current) paragraph.push(line); continue; }
    const heading = /^ {0,3}##(?!#)\s+(.+?)(?:\s+#+)?$/.exec(line), item = /^(?:[-*+]|\d{1,9}[.)])\s+(.+)$/.exec(line);
    if (heading) start(heading[1]);
    else if (item) start(item[1]);
    else if (!line.trim()) flush();
    else if (current) paragraph.push(line);
  }
  flush();
  return tasks.map(({ title, paragraphs }) => {
    const long = title.length > 200, body = [...(long ? [title] : []), ...paragraphs].join('\n\n');
    return { title: long ? title.slice(0, 200).trimEnd() : title, body: body.slice(0, 20000) };
  });
}

export async function savePlanDraft(controller, draft, previous = null) {
  const body = previous ? { title: draft.title, branch: draft.branch, tasks: draft.tasks.map(planTaskItem), roles: draft.roles, expectedRevision: previous.revision } : { ...draft, tasks: draft.tasks.map(planTaskItem) };
  const key = previous ? `edit:${previous.id}:${previous.revision}` : `create:${draft.chatId}:${draft.expectedChatRevision}`;
  const result = await retainedPlanAction(controller, key, { method: previous ? 'PATCH' : 'POST', path: previous ? '/plans/:planId' : '/plans',
    ...(previous ? { params: { planId: previous.id } } : {}), body });
  controller.plans.set(result.data.id, result.data); return result.data;
}

export async function runPlan(controller, plan) {
  const result = await retainedPlanAction(controller, `run:${plan.id}:${plan.revision}`, { method: 'POST', path: '/plans/:planId/run',
    params: { planId: plan.id }, body: { confirmed: true, expectedRevision: plan.revision } });
  await refreshPlan(controller, plan.id, result.data.runId); return result;
}

export async function refreshPlan(controller, planId, runId = null) {
  const plan = (await request(controller.api, 'GET', `/plans/${encodeURIComponent(planId)}`)).data;
  controller.plans.set(plan.id, plan);
  runId ??= [...controller.runs.values()].find(run => run.planId === planId)?.id;
  if (runId) { const run = (await request(controller.api, 'GET', `/runs/${encodeURIComponent(runId)}`)).data; controller.runs.set(run.id, run); }
  controller.notify(); return plan;
}

export function controlPlan(controller, run, action, alert = null) {
  const body = { action, expectedRevision: run.revision };
  if (['stop_step', 'retry_task', 'retry_start'].includes(action)) body.attemptId = alert?.attemptId;
  if (action === 'resend') Object.assign(body, { messageId: alert?.messageId, recipientId: alert?.recipientId });
  return retainedPlanAction(controller, `control:${run.id}:${run.revision}:${action}:${alert?.id ?? ''}`, {
    method: 'POST', path: '/runs/:runId/control', params: { runId: run.id }, body,
  }).then(async result => { await refreshPlan(controller, run.planId, run.id); return result; });
}

export function planCardModel(controller, plan, language, clients = [], now = Date.now()) {
  const run = [...controller.runs.values()].find(run => run.planId === plan.id);
  const alert = run?.alerts?.find(alert => !alert.resolved && ['stalled', 'no_start', 'unread'].includes(alert.kind));
  const attempt = run?.attempts?.find(attempt => attempt.id === alert?.attemptId);
  const lead = plan.roles.coordinator.kind === 'unit' ? plan.roles.coordinator.unitId : plan.roles.coordinator.client;
  const notified = alert?.told?.[0]?.target;
  const person = text(language, 'person');
  const agent = alert?.recipientId ?? (attempt?.taskId ? plan.tasks.find(task => task.id === attempt.taskId)?.actorId : null)
    ?? (attempt ? plan.roles[attempt.role]?.unitId ?? plan.roles[attempt.role]?.client : null) ?? '';
  const watch = run?.watches?.find(watch => watch.attemptId === attempt?.id);
  return { language, title: plan.title, branch: plan.branch, phase: alert ? 'warning' : plan.approved ? 'running' : 'ready',
    busy: run?.state === 'stopping' || [...controller.pending.keys()].some(key => key.includes(plan.id) || run && key.includes(run.id)),
    problem: alert && { kind: alert.kind === 'no_start' ? 'noStart' : alert.kind === 'unread' ? 'unreadProblem' : 'stalled',
      agent: readableIdentity(agent, person), lead: notified === 'coordinator' ? readableIdentity(lead, person) : notified === 'overseer' ? 'Overseer' : notified === 'person' ? readableIdentity('root:person', person) : '',
      minutes: watch?.phase === 'planning' ? 30 : 10 },
    budget: run?.budget, extensions: [], tasks: plan.tasks.map(task => ({ ...task,
      actor: readableIdentity(task.assignment.kind === 'unit' ? task.assignment.unitId : task.assignment.client, person),
      runsInLabel: runsInLabel(task.assignment.runsIn, clients, language),
      state: task.id === attempt?.taskId && alert.kind === 'stalled' ? 'stuck' : task.state,
      elapsedMinutes: task.state === 'busy' && Number.isFinite(Date.parse(task.stepAt)) ? Math.max(0, Math.floor((now - Date.parse(task.stepAt)) / 60000)) : null,
    })) };
}

export function renderControlledPlan(document, controller, plan, { language, clients, now, onRun, onEdit, onAssignment, onError = () => {} }) {
  const run = [...controller.runs.values()].find(run => run.planId === plan.id);
  const alert = run?.alerts?.find(alert => !alert.resolved && ['stalled', 'no_start', 'unread'].includes(alert.kind));
  const control = action => controlPlan(controller, run, action, alert).catch(onError);
  const card = renderPlanCard(document, planCardModel(controller, plan, language, clients, now), {
    onRun, onEdit, onAssignment, onStopStep: () => control('stop_step'), onRetryTask: () => control('retry_task'),
    onStop: () => control('stop_run'), onRetryStart: () => control('retry_start'), onResend: () => control('resend'),
  });
  const error = [...controller.errors].find(([key]) => key.includes(plan.id) || run && key.includes(run.id));
  if (error) card.append(element(document, 'p', { role: 'alert', text: startText(language, 'unavailable') }));
  card.setAttribute('data-plan-id', plan.id);
  if (run && !['open', 'stopping'].includes(run.state)) {
    card.querySelector?.('.plan-actions')?.remove();
    card.append(element(document, 'p', { role: 'status', text: startText(language, run.state === 'failed' ? 'failed' : run.state === 'completed' ? 'done' : 'stop') }));
  }
  if (alert && !alert.told.length) {
    const problem = card.querySelector?.('.plan-problem');
    if (problem) problem.textContent = problem.textContent.split(';')[0] + '.';
  }
  return card;
}
