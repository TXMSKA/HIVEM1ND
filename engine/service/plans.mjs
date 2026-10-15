import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, isUuid, parseTaskId, parseUnitId, replaceHeader } from './identity.mjs';
import { readCluster, rawClusters, clusterOwner } from './clusters.mjs';
import { readDetail, paginate } from './projection.mjs';
import { readUnitState } from './state.mjs';
import { connectedClients } from './settings.mjs';
import { launchBoundary, launchChoice, validateRunsIn } from './runs-in.mjs';
import { loadTask, taskAllocator } from './tasks.mjs';
import { commitChange, readBytes, revisionOf, withLocalChanges, withReceipt } from './store.mjs';

export const PLAN_ROLES = Object.freeze(['coordinator', 'planner', 'builder', 'reviewer']);
export const planFile = (context, id) => path.join(context.paths.mind, 'user', 'gui', 'plans', id, 'plan.json');
export const planBytes = value => Buffer.from(`${canonicalJson(value)}\n`);
export function planRevision(record) { const { revision, ...fields } = record; return { ...fields, revision: hashBytes(planBytes(fields)) }; }
export function planError(code = 'invalid_plan', status = 422) { throw new CoreError(status, code, 'The exact plan and its authority could not be verified.'); }
export function requirePlanDesktop(context, capability = 'read') {
  const actor = context.principal ?? context.credential;
  if (actor?.audience !== 'desktop' || actor.capabilities && !actor.capabilities.includes(capability)) planError('forbidden', 403);
}
export function exactPlanObject(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => ![...required, ...optional].includes(key))) planError();
}

export async function planIds(context) {
  try { return (await readdir(path.dirname(path.dirname(planFile(context, 'unused'))))).filter(isUuid).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export async function readPlanRecord(context, id) {
  if (!isUuid(id)) planError('plan_not_found', 404);
  const bytes = await readBytes(context.store, planFile(context, id));
  if (!bytes) planError('plan_not_found', 404);
  const record = JSON.parse(bytes);
  if (record.format !== 'hivem1nd-plan-v1' || record.id !== id || planRevision(record).revision !== record.revision) planError('corrupt_resource', 409);
  return { record, bytes };
}
export function publicPlan(record) { const { format, ...plan } = record; return structuredClone(plan); }
export async function readPlan(context, id) { requirePlanDesktop(context); return publicPlan((await readPlanRecord(context, id)).record); }
export async function listPlans(context, query = {}) {
  requirePlanDesktop(context);
  if (query.clusterId && !isUuid(query.clusterId)) planError();
  const items = [];
  for (const id of await planIds(context)) {
    const plan = publicPlan((await readPlanRecord(context, id)).record);
    if ((!query.clusterId || plan.clusterId === query.clusterId) && (!query.q || plan.title.toLowerCase().includes(query.q.toLowerCase()))) items.push(plan);
  }
  return paginate(items, { ...query, filters: { clusterId: query.clusterId ?? null, q: query.q ?? null }, snapshot: canonicalJson(items.map(item => item.revision)) });
}

async function membersOf(context, cluster) {
  const all = (await rawClusters(context)).map(item => item.cluster);
  const ids = new Set([cluster.id]);
  let changed = true;
  while (changed) { changed = false; for (const item of all) if (!item.deleted && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; } }
  const members = new Set(cluster.members);
  for (const item of all) if (ids.has(item.id) && !item.deleted) for (const id of item.members) members.add(id);
  const units = [];
  for (const id of members) {
    const unit = await readDetail(context, 'units', id);
    if (!unit.removed && unit.role !== 'master' && unit.machine === context.paths.machine) units.push(unit);
  }
  return units;
}
export async function validatePlanAssignment(context, value, units, clients, role) {
  if (value?.kind === 'unit') {
    exactPlanObject(value, ['kind', 'unitId', 'runsIn']); parseUnitId(value.unitId);
    if (!units.some(unit => unit.id === value.unitId)) planError();
  } else if (value?.kind === 'client') {
    exactPlanObject(value, ['kind', 'client', 'runsIn', 'reuseRole']);
    if (value.client !== value.runsIn?.client || value.reuseRole !== null && (role !== 'reviewer' || value.reuseRole !== 'planner')) planError();
  } else planError();
  const runsIn = validateRunsIn(value.runsIn, clients);
  if (!launchBoundary(clients.find(client => client.id === runsIn.client))) planError('scope_unavailable', 409);
  return { ...value, runsIn: { ...runsIn } };
}

// The cluster lead is the one Overlord nobody above it leads, or the only Executor when there is no Overlord.
export function planLeadOf(units) {
  const leads = units.filter(unit => unit.role === 'overlord' && !units.some(candidate => candidate.id === unit.leadId));
  return leads.length === 1 ? leads[0] : units.length === 1 && units[0].role === 'executor' ? units[0] : null;
}
export const NEW_TASK_LIMIT = 50;
function newTaskItem(task) {
  exactPlanObject(task, ['title', 'assignment'], ['body']);
  if (typeof task.title !== 'string' || !task.title.trim() || task.title.length > 200 || /[\x00-\x1f\x7f]/.test(task.title)
    || task.body !== undefined && (typeof task.body !== 'string' || task.body.length > 20000 || /\x00/.test(task.body) || /^## (?:Request|Report)\b/m.test(task.body))) planError();
}

export async function resolvePlan(context, input, id, options = {}) {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 240 || /[\x00-\x1f\x7f]/.test(input.title)
    || typeof input.branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(input.branch) || /\.\.|\/\/|@\{|\.lock(?:\/|$)|[/.]$/.test(input.branch)
    || !['planning', 'execution'].includes(input.mode) || !isUuid(input.clusterId) || !isUuid(input.chatId)) planError();
  clusterOwner(context, input.machine, { write: true });
  const cluster = await readCluster(context, input.clusterId, { machine: input.machine });
  if (cluster.deleted || cluster.chatId !== input.chatId) planError();
  const chat = await readDetail(context, 'chats', input.chatId);
  if (chat.archived || input.expectedChatRevision !== undefined && input.expectedChatRevision !== chat.revision) planError('plan_changed', 409);
  const units = await membersOf(context, cluster), clients = await connectedClients(context);
  exactPlanObject(input.roles, PLAN_ROLES);
  const roles = {};
  for (const role of PLAN_ROLES) roles[role] = await validatePlanAssignment(context, input.roles[role], units, clients, role);
  const lead = planLeadOf(units);
  if (lead && (roles.coordinator.kind !== 'unit' || roles.coordinator.unitId !== lead.id)) planError('plan_lead_required', 403);
  if (roles.reviewer.kind === 'client' && roles.reviewer.reuseRole === 'planner'
    && canonicalJson(roles.reviewer.runsIn) !== canonicalJson(roles.planner.runsIn)) planError();
  if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 10000) planError();
  const named = input.tasks.filter(task => task && typeof task === 'object' && Object.hasOwn(task, 'id'));
  if (new Set(named.map(task => task.id)).size !== named.length || input.tasks.length - named.length > NEW_TASK_LIMIT) planError();
  const tasks = [], witnesses = [], unitRevisions = {}, created = [], rewritten = [], prepare = taskAllocator(context);
  for (const task of input.tasks) {
    let record, assignment;
    if (!task || typeof task !== 'object' || Array.isArray(task) || !Object.hasOwn(task, 'id')) {
      // A new task: its file is prepared in memory and committed with the plan, never before it.
      newTaskItem(task);
      assignment = await validatePlanAssignment(context, task.assignment, units, clients, 'builder');
      const toId = assignment.kind === 'unit' ? assignment.unitId : lead?.id;
      if (!toId) planError();
      const made = await prepare({ title: task.title, body: task.body ?? '', toId, clusterId: input.clusterId, planId: id });
      created.push(made.entry); record = made.record;
    } else {
      exactPlanObject(task, ['id', 'title', 'assignment']); parseTaskId(task.id);
      if (typeof task.title !== 'string' || !task.title.trim() || task.title.length > 240 || /[\x00-\x1f\x7f]/.test(task.title)) planError();
      record = await loadTask(context, task.id);
      if (!units.some(unit => unit.id === record.toId) || !['open', 'review'].includes(record.status)) planError();
      assignment = await validatePlanAssignment(context, task.assignment, units, clients, 'builder');
      // Editing a draft: a task this plan created, still open, may go to any member and is then re-addressed in the same transaction so the
      // file always names who does it. Any other task, and every task Run or a role replacement resolves, only goes to its addressee or the addressee's lead.
      const owned = options.readdress === true && record.planId === id && record.status === 'open';
      if (assignment.kind === 'unit' && assignment.unitId !== record.toId && assignment.unitId !== record.leadId && !owned) planError();
      const toId = assignment.kind === 'unit' ? assignment.unitId : lead?.id ?? record.toId;
      if (owned && toId !== record.toId) {
        const bytes = replaceHeader(replaceHeader(record.bytes, 'to', parseUnitId(toId).unit), 'to-id', toId);
        rewritten.push({ resource: record.relative, recordPath: path.join(context.paths.mind, ...record.relative.split('/')), beforeRevision: record.revision, afterBytes: bytes });
        record = { ...record, toId, bytes, body: bytes.toString('utf8'), revision: hashBytes(bytes) };
      }
    }
    const paths = reviewedTaskPaths(record.body);
    witnesses.push({ id: record.id, revision: record.revision, paths, relative: record.relative });
    tasks.push({ id: record.id, title: task.title, actorId: assignment.kind === 'unit' ? assignment.unitId : `plan:${id}:builder`,
      assignment, runsIn: assignment.runsIn, state: 'todo', step: null, stepAt: null });
  }
  for (const unit of units) unitRevisions[unit.id] = revisionOf((await readUnitState(context, parseUnitId(unit.id))).bytes);
  return { cluster, chat, tasks, roles, witnesses, unitRevisions, created, rewritten };
}
function reviewedTaskPaths(body) {
  const line = String(body).match(/^(?:files|paths):\s*(.+)$/mi)?.[1];
  if (!line) return [];
  let paths; try { paths = JSON.parse(line); } catch { planError(); }
  if (!Array.isArray(paths) || paths.length > 256 || new Set(paths).size !== paths.length
    || paths.some(file => typeof file !== 'string' || !file || file.length > 4096 || /[\\\x00-\x1f]/.test(file)
      || file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.split('/').some(part => !part || part === '..' || part === '.git'))) planError();
  return paths;
}

const createdEvents = (resolved, revision) => resolved.created.length || resolved.rewritten.length ? [{ name: 'view.changed', data: { revision, collections: ['tasks'] } }] : [];

export async function createPlan(context, input) {
  requirePlanDesktop(context, 'chat.post');
  exactPlanObject(input, ['clusterId', 'chatId', 'machine', 'title', 'branch', 'mode', 'tasks', 'roles', 'expectedChatRevision']);
  if (!/^[a-f0-9]{64}$/.test(input.expectedChatRevision ?? '')) planError();
  return withLocalChanges(context.store, () => draftPlan(context, input));
}
// The owner write of a new draft: the plan, its chat and cluster records and the new task files in one transaction.
async function draftPlan(context, input) {
  const id = randomUUID(), resolved = await resolvePlan(context, input, id);
  const record = planRevision({ format: 'hivem1nd-plan-v1', id, clusterId: input.clusterId, chatId: input.chatId, machine: input.machine,
    title: input.title, branch: input.branch, mode: input.mode, tasks: resolved.tasks, roles: resolved.roles, approved: false });
  const chatPath = path.join(context.paths.mind, 'user', 'relay', 'chats', record.chatId, 'chat.md');
  const chatBytes = await readBytes(context.store, chatPath);
  const attached = JSON.parse(chatBytes.toString().match(/^plans:\s*(.*)$/m)?.[1] ?? '[]');
  const afterChat = replaceHeader(chatBytes, 'plans', canonicalJson([...attached, id]));
  const cluster = (await rawClusters(context)).find(item => item.cluster.id === record.clusterId);
  return commitChange(context, { id: randomUUID(), entries: [
    { resource: `plan:${id}`, recordPath: planFile(context, id), beforeRevision: null, afterBytes: planBytes(record) },
    { resource: `chat:${record.chatId}`, recordPath: chatPath, beforeRevision: resolved.chat.revision, afterBytes: afterChat },
    { resource: cluster.relative, recordPath: path.join(context.paths.mind, cluster.relative), beforeRevision: revisionOf(cluster.bytes), afterBytes: planBytes({ ...cluster.record, chatRevision: revisionOf(afterChat) }) },
    ...resolved.created,
  ], events: [{ name: 'plan.changed', chatId: record.chatId, data: { planId: id, revision: record.revision } },
    { name: 'chat.changed', chatId: record.chatId, data: { chatId: record.chatId } }, ...createdEvents(resolved, record.revision)], response: { status: 201, body: publicPlan(record) } });
}
export async function editPlan(context, id, input) {
  requirePlanDesktop(context, 'chat.post'); exactPlanObject(input, ['expectedRevision'], ['title', 'branch', 'mode', 'tasks', 'roles']);
  if (!/^[a-f0-9]{64}$/.test(input.expectedRevision ?? '')) planError();
  return withLocalChanges(context.store, async () => {
    const { record, bytes } = await readPlanRecord(context, id);
    if (record.revision !== input.expectedRevision || record.approved) planError('plan_changed', 409);
    const resolved = await resolvePlan(context, { ...record, ...input, tasks: input.tasks ?? record.tasks.map(({ id, title, assignment }) => ({ id, title, assignment })) }, id, { readdress: true });
    const next = planRevision({ ...record, ...input, tasks: resolved.tasks, roles: resolved.roles }); delete next.expectedRevision;
    const updated = planRevision(next);
    return commitChange(context, { id: randomUUID(), entries: [{ resource: `plan:${id}`, recordPath: planFile(context, id), beforeRevision: revisionOf(bytes), afterBytes: planBytes(updated) }, ...resolved.created, ...resolved.rewritten],
      events: [{ name: 'plan.changed', chatId: record.chatId, data: { planId: id, revision: updated.revision } }, ...createdEvents(resolved, updated.revision)], response: { status: 200, body: publicPlan(updated) } });
  });
}
const branchFrom = title => `plan-${title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '') || 'draft'}`;
const summary = plan => ({ planId: plan.id, revision: plan.revision, chatId: plan.chatId, title: plan.title, branch: plan.branch,
  tasks: plan.tasks.map(task => ({ id: task.id, title: task.title })) });
// The clusters whose lead is this unit: the Overlord nobody above it leads, or the only Executor of a cluster without an Overlord.
export async function leadClusterIds(context, unitId) {
  const owner = { ...context, principal: { audience: 'desktop', unitId }, credential: null }, ids = [];
  for (const { cluster } of await rawClusters(owner)) {
    if (!cluster.deleted && planLeadOf(await membersOf(owner, cluster))?.id === unitId) ids.push(cluster.id);
  }
  return ids;
}
// A lead's own proposal: the draft a person would create, bound to the cluster chat, with every new task assigned to the lead
// until the person changes it in the plan card. It posts no message and builds nothing; Run stays the person's confirmation.
export async function proposePlan(context, input) {
  const actor = context.principal ?? context.credential;
  if (actor?.audience !== 'agent' || !actor.unitId) planError('forbidden', 403);
  exactPlanObject(input, ['clusterId', 'title', 'tasks'], ['branch', 'requestId']);
  const { requestId, ...proposal } = input;
  if (!isUuid(proposal.clusterId) || !Array.isArray(proposal.tasks)) planError();
  const draft = receipt => withLocalChanges(context.store, async () => {
    const owner = { ...context, principal: { audience: 'desktop', unitId: actor.unitId }, credential: null, ...(receipt ? { receipt } : {}) };
    const machine = context.paths.machine;
    const cluster = await readCluster(owner, proposal.clusterId, { machine }).catch(error => { if (error?.code === 'cluster_not_found') planError('forbidden', 403); throw error; });
    const units = await membersOf(owner, cluster), lead = planLeadOf(units);
    if (cluster.deleted || lead?.id !== actor.unitId) planError('forbidden', 403);
    const assignment = { kind: 'unit', unitId: lead.id, runsIn: { ...launchChoice(lead, await connectedClients(owner)) } };
    for (const task of proposal.tasks) exactPlanObject(task, ['title'], ['body']);
    const plan = await draftPlan(owner, { clusterId: cluster.id, chatId: cluster.chatId, machine, title: proposal.title,
      branch: proposal.branch ?? (typeof proposal.title === 'string' ? branchFrom(proposal.title) : undefined),
      mode: cluster.link?.kind === 'repository' ? 'execution' : 'planning', expectedChatRevision: (await readDetail(owner, 'chats', cluster.chatId)).revision,
      roles: { coordinator: assignment, planner: assignment, builder: assignment, reviewer: assignment },
      tasks: proposal.tasks.map(task => ({ ...task, assignment })) });
    return summary(plan);
  });
  if (requestId === undefined) return draft(null);
  const saved = await withReceipt(context.store, { principal: actor.sessionId ?? actor.unitId, key: requestId, requestId, method: 'POST', path: '/mcp/plan_propose', body: proposal }, draft);
  return saved?.replayed ? summary(saved.body) : saved;
}
export async function startPlan(context, id, input) {
  requirePlanDesktop(context, 'session.start'); exactPlanObject(input, ['confirmed', 'expectedRevision']);
  if (input.confirmed !== true || !/^[a-f0-9]{64}$/.test(input.expectedRevision ?? '')) planError();
  const { createRunIntent } = await import('./runs.mjs');
  return createRunIntent(context, id, input);
}
