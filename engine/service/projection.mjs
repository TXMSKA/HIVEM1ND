import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CLIENTS, CoreError, canonicalJson, canonicalTaskId, hashBytes, hashText, isUuid, parseTaskId, parseUnitId, resolvePerson, resolveUnit, uuidV8, validateRole } from './identity.mjs';
import { leadApproved } from './tasks.mjs';
import { stateRunsIn, stateUnitId } from './state.mjs';
import { projectGroup } from './groups.mjs';
import { readBytes, withLocalChanges } from './store.mjs';
import { MESSAGE_BYTES_MAX, MESSAGE_MAX, MESSAGE_WINDOW_MS, SYNC_BYTES_MAX, SYNC_WINDOW_MS } from '../sync/limits.mjs';
import { classifyApprovalAction } from './adapters.mjs';

const VIEW_LIMIT = 16000000;
const OBSERVATION_MS = 15 * 60 * 1000;
const BEAT_MS = 180000;
const FUTURE_MS = 30000;
const STATUS_ORDER = ['unknown', 'out', 'quota', 'waiting', 'working', 'idle'];
const TASK_ORDER = ['review', 'open', 'done', 'closed'];

export function statusFor({ malformed = false, state = 'in', quota = null, waiting = false, activity = null } = {}) {
  if (malformed || !STATUS_ORDER.includes(state) && state !== 'in' && state !== 'out') return 'unknown';
  if (malformed) return 'unknown';
  if (state === 'out') return 'out';
  if (quota && (quota.exhausted === true || (typeof quota.remaining === 'number' && quota.remaining <= 0))) return 'quota';
  if (waiting) return 'waiting';
  if (activity === 'busy' || activity === 'active') return 'working';
  return 'idle';
}

export function answersFor(beat, now) {
  if (!beat || beat.state !== 'running') return false;
  const at = Date.parse(beat.heartbeatAt ?? '');
  if (!Number.isFinite(at)) return false;
  if (at > now + FUTURE_MS) return false;
  if (now - at > BEAT_MS) return false;
  return true;
}

export function observationFresh(at, now) {
  const parsed = Date.parse(at ?? '');
  return Number.isFinite(parsed) && parsed <= now + FUTURE_MS && now - parsed <= OBSERVATION_MS;
}

export function waitingFor(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  unique.sort((left, right) => Number(right.blocking) - Number(left.blocking) || String(right.since).localeCompare(String(left.since)) || left.id.localeCompare(right.id));
  return unique;
}

export function paginate(items, { limit = 50, cursor = null, filters = {}, snapshot = '' } = {}) {
  const bounded = boundLimit(limit);
  const filterHash = hashText(canonicalJson(filters));
  const snapshotHash = typeof snapshot === 'string' ? snapshot : hashText(canonicalJson(snapshot));
  let position = 0;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded.filters !== filterHash) throw new CoreError(400, 'invalid_cursor', 'The page cursor does not match these filters.');
    if (decoded.snapshot !== snapshotHash) throw new CoreError(409, 'cursor_expired', 'The page cursor expired.');
    if (!Number.isSafeInteger(decoded.position) || decoded.position < 0 || decoded.position > items.length) {
      throw new CoreError(400, 'invalid_cursor', 'The page cursor position is not valid.');
    }
    position = decoded.position;
  }
  const slice = items.slice(position, position + bounded);
  const next = position + bounded < items.length ? encodeCursor({ contract: 'hivem1nd-gui-v3', filters: filterHash, snapshot: snapshotHash, position: position + bounded }) : null;
  return { items: slice, total: items.length, nextCursor: next, issues: [] };
}

export function paginateMessages(messages, { limit = 50, cursor = null, before = null, filters = {}, snapshot = '' } = {}) {
  if (cursor && before) throw new CoreError(400, 'invalid_cursor', 'A message page cannot use before and a cursor together.');
  const ordered = [...messages].sort(messageOrder);
  const filterHash = hashText(canonicalJson({ ...filters, before: before ?? null }));
  const snapshotHash = typeof snapshot === 'string' ? snapshot : hashText(canonicalJson(snapshot));
  let end = ordered.length;
  if (before) {
    const index = ordered.findIndex((message) => message.id === before);
    if (index < 0) throw new CoreError(404, 'message_not_found', 'The message is not in this chat.');
    end = index;
  }
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded.filters !== filterHash) throw new CoreError(400, 'invalid_cursor', 'The page cursor does not match these filters.');
    if (decoded.snapshot !== snapshotHash) throw new CoreError(409, 'cursor_expired', 'The page cursor expired.');
    if (!Number.isSafeInteger(decoded.position) || decoded.position < 0 || decoded.position > ordered.length) {
      throw new CoreError(400, 'invalid_cursor', 'The page cursor position is not valid.');
    }
    end = decoded.position;
  }
  const bounded = boundLimit(limit);
  const start = Math.max(0, end - bounded);
  const next = start > 0 ? encodeCursor({ contract: 'hivem1nd-gui-v3', filters: filterHash, snapshot: snapshotHash, position: start }) : null;
  return { items: ordered.slice(start, end), total: ordered.length, nextCursor: next, issues: [] };
}

export async function readProjection(context, query = {}) {
  const view = await projectRecords(context, query);
  const envelope = {
    contract: 'hivem1nd-gui-v3',
    data: view,
    meta: { requestId: null, readAt: null, eventCursor: null, sync: 'local', replayed: false },
  };
  if (Buffer.byteLength(JSON.stringify(envelope)) > VIEW_LIMIT) {
    throw new CoreError(413, 'view_too_large', 'The view exceeds 16 MB. Request the individual lists.');
  }
  return view;
}

export async function readCollection(context, name, query = {}) {
  const view = await projectRecords(context, query);
  const items = visibleToPrincipal(collectionItems(view, name, query), name, view, context.principal);
  const filtered = items.filter((item) => matchesQuery(item, name, query));
  const snapshot = hashText(canonicalJson(filtered));
  if (name === 'messages') {
    return {
      ...paginateMessages(filtered, { ...query, snapshot, filters: normalizeFilters(query) }),
      issues: view.issues,
    };
  }
  return { ...paginate(filtered, { ...query, snapshot, filters: normalizeFilters(query) }), issues: view.issues };
}

async function projectRecords(context, query) {
  return projectionRead(context, async () => {
    const aliases = await resolveAliases(context);
    const scoped = { ...context, aliases };
    const loaded = await loadMind(scoped);
    const editors = await completeEditorSummaries(scoped, loaded.catalog);
    return assemble(loaded, query, aliases, scoped.paths?.machine ?? null, editors);
  });
}

export async function projectChat(context, id) {
  return projectionRead(context, async () => {
    const aliases = await resolveAliases(context);
    const loaded = await loadMind({ ...context, aliases });
    const chat = loaded.chats.find((item) => item.id === id);
    if (!chat) throw new CoreError(404, 'chat_not_found', 'The chat does not exist.');
    return chat;
  });
}

async function projectionRead(context, operation) {
  if (!context.store) return operation();
  return withLocalChanges(context.store, async () => {
    await readBytes(context.store, path.join(context.paths.mind, 'user', 'gui', 'layout.json'));
    return operation();
  });
}

export async function loadPersonAliases(mind) {
  if (!mind) return [];
  const directory = path.join(mind, 'user', 'machines');
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const aliases = [];
  for (const name of names) {
    if (!name.endsWith('.md') || name.endsWith('.report.md') || name.startsWith('.')) continue;
    let text = null;
    try {
      text = await readFile(path.join(directory, name), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const header = text.split(/\r?\n\r?\n/, 1)[0];
    for (const line of header.split(/\r?\n/)) {
      const match = /^person:\s*(.*)$/.exec(line);
      if (!match) continue;
      for (const alias of match[1].split(',').map((item) => item.trim()).filter(Boolean)) aliases.push(alias);
    }
  }
  return [...new Set(aliases)];
}

async function resolveAliases(context) {
  if (Array.isArray(context?.aliases)) return context.aliases;
  return loadPersonAliases(context?.paths?.mind);
}

async function completeEditorSummaries(context, catalog) {
  const resources = catalog?.value?.resources;
  if (!Array.isArray(resources) || resources.length === 0) return [];
  const { summarizeCatalog } = await import('./editors.mjs');
  const editors = await summarizeCatalog(context, resources);
  return editors.sort((left, right) => String(left.project ?? '').localeCompare(String(right.project ?? '')) || String(left.title).localeCompare(String(right.title)) || String(left.id).localeCompare(String(right.id)));
}

export async function readDetail(context, name, id, scope = {}) {
  if (name === 'chats') {
    const chat = await projectChat(context, id);
    if (context.principal?.audience === 'agent' && !chatMember(chat, context.principal.unitId)) throw new CoreError(404, 'chat_not_found', 'The record does not exist.');
    return chat;
  }
  const view = await readProjection(context);
  if (name === 'layout') return { layout: view.layout, revision: view.layoutRevision };
  if (name === 'settings') return { settings: view.settings, revision: view.settingsRevision };
  if (name === 'messages') {
    const foundMessage = visibleToPrincipal(view.messages, 'messages', view, context.principal).find((item) => item.id === id && messageInScope(item, scope));
    if (!foundMessage) throw new CoreError(404, 'message_not_found', 'The record does not exist.');
    return foundMessage;
  }
  const found = visibleToPrincipal(name === 'units' ? view.allUnits : collectionItems(view, name, {}), name, view, context.principal).find((item) => item.id === id);
  if (!found) throw new CoreError(404, `${name.replace(/s$/, '')}_not_found`, 'The record does not exist.');
  return found;
}

function visibleToPrincipal(items, name, view, principal) {
  if (principal?.audience !== 'agent') return items;
  const unitId = principal.unitId;
  if (name === 'chats') return items.filter((chat) => chatMember(chat, unitId));
  if (name === 'groups') return items.filter((group) => group.members.includes(unitId));
  if (name === 'messages') {
    const allowed = new Set((view.allChats ?? view.chats).filter((chat) => chatMember(chat, unitId)).map((chat) => chat.id));
    return items.filter((message) => {
      const chatId = chatIdFromPath(message.path);
      return chatId ? allowed.has(chatId) : true;
    });
  }
  return items;
}

function chatMember(chat, unitId) {
  return typeof unitId === 'string' && Array.isArray(chat?.members) && chat.members.includes(unitId);
}

function chatIdFromPath(messagePath) {
  const match = String(messagePath ?? '').match(/\/chats\/([^/]+)\//);
  return match ? match[1] : null;
}

export function collectIssues(issues) {
  const seen = new Set();
  const unique = [];
  for (const item of issues ?? []) {
    const key = `${item.path ?? ''}\0${item.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ path: item.path ?? null, code: item.code, message: item.message });
  }
  return unique;
}

async function loadMind(context) {
  const mind = context.paths?.mind;
  if (!mind) throw new CoreError(503, 'mind_unavailable', 'The M1ND is not available.');
  try {
    const stats = await lstat(mind);
    if (!stats.isDirectory()) throw new CoreError(503, 'mind_unavailable', 'The M1ND is not available.');
  } catch (error) {
    if (error instanceof CoreError) throw error;
    throw new CoreError(503, 'mind_unavailable', 'The M1ND is not available.');
  }
  const now = context.now();
  const issues = [];
  const scopes = await scopeRoots(mind);
  const units = [];
  for (const scope of scopes) {
    for (const relative of await filesUnder(mind, scope.state)) {
      if (!relative.endsWith('.md') || relative.includes('.conflict-')) continue;
      units.push(readUnit(await readSafe(mind, relative), relative, issues));
    }
  }
  const observed = [];
  for (const relative of await filesUnder(mind, 'user/relay/sessions')) {
    if (!relative.endsWith('.json') || relative.includes('.conflict-')) continue;
    observed.push(...readSession(await readSafe(mind, relative), relative, now, issues));
  }
  const sessions = mergeSessions(observed, await readStatuses(mind, issues), await readWake(mind, issues));
  for (const unit of units) {
    unit.sessionIds = sessions.filter((session) => session.unitId === unit.id && session.state !== 'stopped').map((session) => session.id);
  }
  const allReceipts = await readReceipts(mind, issues);
  const receipts = allReceipts.get(context.principal?.unitId || 'root:master') ?? new Map();
  const messages = [];
  for (const scope of scopes) {
    for (const bucket of [scope.inbox, scope.archive]) {
      for (const relative of await filesUnder(mind, bucket)) {
        if (!relative.endsWith('.md') || relative.includes('/read/') || relative.includes('.conflict-')) continue;
        const message = readMessageFile(await readSafe(mind, relative), relative, issues, receipts, units, context.aliases ?? []);
        if (message) messages.push(message);
      }
    }
  }
  for (const relative of await filesUnder(mind, 'user/relay/chats')) {
    if (!relative.endsWith('.md') || relative.endsWith('/chat.md') || relative.includes('/read/') || relative.includes('.conflict-')) continue;
    const message = readMessageFile(await readSafe(mind, relative), relative, issues, receipts, units, context.aliases ?? []);
    if (message) messages.push(message);
  }
  const tasks = [];
  for (const scope of scopes) {
    for (const relative of await filesUnder(mind, scope.tasks)) {
      if (!relative.endsWith('.md') || relative.includes('.conflict-')) continue;
      const task = readTask(await readSafe(mind, relative), relative, units, issues, context.aliases ?? []);
      if (task) tasks.push(task);
    }
  }
  const undone = await readUndo(mind, issues);
  const actor = context.principal?.unitId ?? null;
  for (const task of tasks) {
    task.undoAvailable = taskUndoAvailable(task, undone.get(task.id), actor);
  }
  await readApprovals(mind, issues);
  const approvals = await readPendingApprovals(mind, issues, now);
  const catalog = await readJsonRecord(mind, 'user/gui/resources.json', 'hivem1nd-resources-v1', issues);
  const chats = await readChats(mind, messages, issues);
  for (const message of messages) {
    const chatId = chatIdFromPath(message.path);
    const members = chatId ? chats.find((chat) => chat.id === chatId)?.members ?? [] : [message.toId];
    const recipients = message.recipientIds ?? members.filter((id) => id && id !== message.fromId);
    const relative = `user/relay/fanout/${message.id}.json`;
    let notices = [];
    try {
      const bytes = await readSafe(mind, relative);
      if (bytes) notices = JSON.parse(bytes.toString('utf8')).notices ?? [];
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The delivery receipt could not be projected.' });
    }
    const submitted = recipients.map((id) => notices.find((notice) => notice.unitId === id && notice.state === 'submitted')?.submittedAt);
    const read = recipients.map((id) => allReceipts.get(`${chatId ?? 'mailbox'}:${id}`)?.get(message.id));
    const deliveredAt = recipients.length && submitted.every(validReceiptTime) ? submitted.sort().at(-1) : null;
    const readAt = recipients.length && read.every(validReceiptTime) ? read.sort().at(-1) : null;
    message.delivery = { state: readAt ? 'read' : deliveredAt ? 'delivered' : 'stored', deliveredAt, readAt };
  }
  const groups = [];
  for (const relative of await filesUnder(mind, 'user/gui/groups')) {
    if (!relative.endsWith('.json') || relative.includes('.conflict-')) continue;
    try { groups.push(projectGroup(await readSafe(mind, relative), path.posix.basename(relative, '.json'))); }
    catch { issues.push({ path: relative, code: 'corrupt_resource', message: 'The group could not be projected.' }); }
  }
  groups.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  for (const unit of units) {
    const choices = groups.filter(group => !group.deleted && group.members.includes(unit.id)).map(group => group.id).sort();
    unit.clusterChoices = choices;
    if (!choices.includes(unit.clusterId)) unit.clusterId = choices.length === 1 ? choices[0] : null;
    unit.clusterAmbiguous = choices.length > 1 && unit.clusterId === null;
  }
  const machines = await readMachines(context, now, issues);
  const layout = await readJsonRecord(mind, 'user/gui/layout.json', 'hivem1nd-layout-v1', issues);
  const settings = await readJsonRecord(mind, 'user/gui/settings.json', 'hivem1nd-settings-v1', issues);
  const registered = new Set((context.projects ?? []).filter((item) => item?.localPath).map((item) => item.name));
  const projects = [];
  for (const name of [...new Set([...await childNames(mind, 'user/projects'), ...registered])]) {
    const product = await readJsonRecord(mind, `user/projects/${name}/product.json`, 'hivem1nd-product-v1', issues);
    if (!product?.value && !registered.has(name) && !units.some(unit => unit.scope?.kind === 'project' && unit.scope.name === name)) continue;
    if (!product?.value?.removed) projects.push(projectRecord(name, product?.value ?? null, units, registered.has(name)));
  }
  projects.sort((left, right) => left.id.localeCompare(right.id));
  const { planIds, readPlanRecord, publicPlan } = await import('./plans.mjs');
  const { runIds, readRunRecord, publicRun } = await import('./runs.mjs');
  const plans = [], runs = [];
  if (context.store && context.principal?.audience !== 'agent' && context.principal?.audience !== 'phone') {
    for (const id of await planIds(context)) plans.push(publicPlan((await readPlanRecord(context, id)).record));
    for (const id of await runIds(context)) runs.push(publicRun((await readRunRecord(context, id)).record));
  }
  for (const chat of chats) { chat.plans = plans.filter(plan => plan.chatId === chat.id); chat.runs = runs.filter(run => chat.plans.some(plan => plan.id === run.planId) && ['open', 'stopping'].includes(run.state)); }
  for (const run of runs.filter(run => ['open', 'stopping'].includes(run.state))) {
    const plan = plans.find(plan => plan.id === run.planId);
    if (!plan) continue;
    for (const attempt of run.attempts.filter(attempt => attempt.sessionId)) {
      const assignment = attempt.taskId ? plan.tasks.find(task => task.id === attempt.taskId)?.assignment : plan.roles[attempt.role];
      if (!assignment) continue;
      const evidenceBytes = run.machine === context.paths.machine ? await readBytes(context.store, path.join(context.paths.localDirectory, 'runs', run.id, 'evidence', `${attempt.id}.json`)) : null;
      const evidence = evidenceBytes ? JSON.parse(evidenceBytes) : null;
      const stopped = attempt.resolved || evidence?.processExited && evidence.cleanupVerified;
      sessions.push({ id: attempt.sessionId, unitId: assignment.kind === 'unit' ? assignment.unitId : null, client: assignment.runsIn.client, machine: run.machine,
        runMode: attempt.role === 'coordinator' ? 'chat' : 'task', taskId: attempt.taskId, launchKind: 'plan', runsIn: assignment.runsIn,
        state: stopped ? 'stopped' : 'running', activity: !stopped && attempt.role !== 'coordinator' ? 'busy' : 'idle', registeredAt: attempt.sentAt,
        activityObservedAt: attempt.confirmedAt, quota: null, quotaObservedAt: null, role: attempt.role, clusterId: run.clusterId, runId: run.id });
    }
  }
  for (const unit of units) {
    const live = sessions.filter(session => session.unitId === unit.id && session.state !== 'stopped' && session.launchKind === 'plan');
    if (live.length) { unit.state = 'in'; unit.sessionIds = [...new Set([...unit.sessionIds, ...live.map(session => session.id)])]; }
    unit.unread = messages.filter(message => message.toId === unit.id && !message.read && !message.archived).length
      + runs.reduce((count, run) => count + run.messages.filter(message => message.recipients.some(r => r.actorId === unit.id && r.readAt === null)).length, 0);
  }
  return { units, sessions, messages, tasks, chats, groups, machines, layout, settings, projects, catalog, approvals, plans, runs, issues: collectIssues(issues) };
}

function assemble(loaded, query, aliases = [], machine = null, editors = []) {
  const removed = new Set(loaded.units.filter((unit) => unit.removed).map((unit) => unit.id));
  const waiting = waitingFor([
    ...loaded.tasks.filter((task) => task.reviewable).map((task) => ({
      id: `review:${task.id}`, kind: 'review', state: 'pending', unitId: task.toId, title: task.title, since: task.date ?? '', chatId: null, approvalId: null, taskId: task.id, messageId: null, blocking: true,
    })),
    ...loaded.messages.filter((message) => message.replyRequested && isMaster(message.toId)).map((message) => ({
      id: `message:${message.id}`, kind: 'message', state: 'pending', unitId: message.toId, title: message.subject || message.body, since: message.timestamp ?? message.date ?? '', chatId: null, approvalId: null, taskId: null, messageId: message.id, blocking: false,
    })),
    ...personQuestions(loaded.units.filter((unit) => !unit.removed), aliases),
    ...(loaded.approvals ?? []).filter((approval) => !removed.has(approval.unitId) && !loaded.runs.some(run => ['open', 'stopping'].includes(run.state) && run.alerts.some(a => !a.resolved && a.approvalId === approval.approvalId))),
    ...loaded.runs.filter(run => ['open', 'stopping'].includes(run.state) && run.alerts.some(a => !a.resolved)).map(run => {
      const plan = loaded.plans.find(p => p.id === run.planId), alert = run.alerts.find(a => !a.resolved && a.kind === 'extension') ?? run.alerts.find(a => !a.resolved);
      return { id: `run:${run.id}`, kind: 'plan', state: 'pending', runId: run.id, planId: run.planId, unitId: plan?.roles.coordinator.unitId ?? null,
        title: plan?.title ?? '', since: alert.at, chatId: plan?.chatId ?? null, approvalId: alert.approvalId ?? null,
        taskId: null, messageId: alert.messageId, blocking: true, actions: ['stop_run', alert.kind === 'no_start' ? 'retry_start' : alert.kind === 'unread' ? 'resend' : 'retry_task'],
        alertId: alert.id, attemptId: alert.attemptId, recipientId: alert.recipientId, expectedRevision: run.revision };
    }),
  ]);
  const waitingUnits = new Set(waiting.filter((item) => item.state !== 'expired').map((item) => item.unitId).filter(Boolean));
  const allUnits = loaded.units.map((unit) => {
    const published = {
      ...unit,
      status: statusFor({
        malformed: unit.malformed,
        state: unit.state,
        quota: quotaFor(loaded.sessions, unit.id),
        waiting: waitingUnits.has(unit.id),
        activity: activityFor(loaded.sessions, unit.id),
      }),
    };
    delete published.path;
    return published;
  });
  const units = allUnits.filter((unit) => !unit.removed);
  const overseers = units.filter((unit) => unit.role === 'overseer' && !unit.malformed);
  const canonical = overseers.find((unit) => unit.id === 'root:overseer') ?? overseers[0] ?? null;
  const issues = [...loaded.issues];
  for (const extra of overseers) {
    if (canonical && extra.id !== canonical.id) issues.push({ path: extra.path, code: 'duplicate_overseer', message: 'Only one Overseer is canonical.' });
  }
  const leads = [...new Set([canonical?.id, ...units.map((unit) => unit.leadId)].filter(Boolean))];
  const squads = buildSquads(units);
  const listedChats = loaded.chats.filter((chat) => chatListed(chat, query));
  const project = query.project ?? null;
  const visibleUnits = project ? units.filter((unit) => inProjectChain(unit, project, units)) : units;
  visibleUnits.sort(unitOrder);
  const view = {
    mind: { version: '3.0.0', machine, project },
    units: visibleUnits,
    leads,
    squads,
    projects: loaded.projects,
    machines: loaded.machines,
    sessions: [...loaded.sessions].sort((left, right) => String(right.registeredAt ?? '').localeCompare(String(left.registeredAt ?? '')) || String(left.id).localeCompare(String(right.id))),
    chats: listedChats,
    groups: loaded.groups.filter((group) => !group.deleted),
    clusters: loaded.groups.filter((group) => !group.deleted),
    plans: loaded.plans,
    runs: loaded.runs.filter(run => ['open', 'stopping'].includes(run.state)),
    tasks: loaded.tasks,
    waiting,
    counts: countsOf(visibleUnits, leads, squads, loaded, listedChats, waiting, issues),
    issues: collectIssues(issues),
    layout: loaded.layout?.value ?? { format: 'hivem1nd-layout-v1', nodes: {}, groups: {} },
    layoutRevision: loaded.layout?.revision ?? null,
    settings: loaded.settings?.value ?? { format: 'hivem1nd-settings-v1', look: 'modern', language: 'en' },
    settingsRevision: loaded.settings?.revision ?? null,
    messages: loaded.messages,
    editors,
  };
  Object.defineProperty(view, 'allChats', { value: loaded.chats });
  Object.defineProperty(view, 'allUnits', { value: allUnits });
  return view;
}

function countsOf(units, leads, squads, loaded, chats, waiting, issues) {
  const tasks = loaded.tasks;
  return {
    units: units.length,
    leads: leads.length,
    squads: squads.length,
    projects: loaded.projects.length,
    machines: loaded.machines.length,
    sessions: loaded.sessions.length,
    chats: chats.length,
    groups: loaded.groups.filter((group) => !group.deleted).length,
    clusters: loaded.groups.filter((group) => !group.deleted).length,
    waiting: waiting.filter((item) => item.state !== 'expired').length,
    open: tasks.filter((task) => task.status === 'open').length,
    review: tasks.filter((task) => task.status === 'review').length,
    done: tasks.filter((task) => task.status === 'done').length,
    closed: tasks.filter((task) => task.status === 'closed').length,
    unread: loaded.messages.filter((message) => message.read === false && !loaded.units.some((unit) => unit.removed && unit.id === message.toId) && !loaded.chats.some((chat) => chat.archived && chatIdFromPath(message.path) === chat.id)).length,
    issues: issues.length,
  };
}

function projectRecord(name, product, units, available) {
  const stage = ['alpha', 'beta', 'release'].includes(product?.stage) ? product.stage : null;
  const requirements = product?.requirements;
  const shaped = requirements && ['alpha', 'beta', 'release'].every((key) => Number.isInteger(requirements[key]?.total) && Number.isInteger(requirements[key]?.met));
  return {
    id: name,
    environment: typeof product?.environment === 'string' ? product.environment : null,
    title: typeof product?.title === 'string' ? product.title : name,
    unitIds: units.filter((unit) => unit.scope?.kind === 'project' && unit.scope?.name === name && unit.id).map((unit) => unit.id).sort(),
    available,
    additionId: product?.additionId ?? null,
    origin: product?.origin ?? null,
    pin: product?.pin ?? null,
    product: shaped || stage || typeof product?.updated === 'string'
      ? {
          stage,
          updated: typeof product?.updated === 'string' ? product.updated : null,
          requirements: {
            alpha: counts(requirements?.alpha),
            beta: counts(requirements?.beta),
            release: counts(requirements?.release),
          },
        }
      : null,
  };
}

function counts(value) {
  return {
    total: Number.isInteger(value?.total) && value.total >= 0 ? value.total : 0,
    met: Number.isInteger(value?.met) && value.met >= 0 ? value.met : 0,
  };
}

export async function serviceRecord(context) {
  const sync = await readSync(context);
  return {
    machine: context?.paths?.machine ?? null,
    version: '3.0.0',
    originKind: context?.paths?.origin ? 'folder' : null,
    syncState: sync.state,
  };
}

export async function readSync(context) {
  const sync = context.sync ?? null;
  let pendingChanges = 0;
  if (sync) {
    const { listStaged } = await import('../sync/store.mjs');
    pendingChanges = (await listStaged(sync)).length;
  }
  let limits = idleLimits();
  if (context.ledger) {
    const { limitsFor } = await import('../sync/limits.mjs');
    limits = await limitsFor(context.ledger);
  }
  const incoming = await incomingStatus(context, sync);
  const storeApi = sync ? await import('../sync/store.mjs') : null;
  const publication = storeApi ? await storeApi.readSyncFailure(sync) : null;
  const inbound = storeApi ? await storeApi.readInboundFailure(sync) : null;
  const prepared = sync ? await publicationPrepared(sync) : false;
  const queued = sync ? await pendingPacks(sync) : 0;
  let state = 'idle';
  if (inbound) state = 'error';
  else if (limits.state === 'paused') state = 'paused';
  else if (prepared) state = 'publishing';
  else if (publication) state = 'error';
  else if (pendingChanges > 0 || queued > 0) state = 'pending';
  const failure = state === 'error' ? (inbound ?? publication) : null;
  return {
    state,
    pendingChanges,
    limits,
    incoming,
    retryAt: failure ? (failure.retryAt ?? limits.retryAt ?? null) : (limits.retryAt ?? null),
    error: failure ? { code: failure.code, message: failure.message } : null,
  };
}

async function incomingStatus(context, sync) {
  const names = new Set();
  if (context.ledger?.file && context.ledger.store) {
    const { readBytes } = await import('./store.mjs');
    const raw = await readBytes(context.ledger.store, context.ledger.file);
    if (raw) {
      try {
        const data = JSON.parse(raw.toString('utf8'));
        for (const machine of Object.keys(data.incoming ?? {})) names.add(machine);
      } catch {
        names.clear();
      }
    }
  }
  if (sync?.paths?.localDirectory) {
    const root = path.join(sync.paths.localDirectory, 'received', 'pending');
    let machines = [];
    try {
      machines = await readdir(root);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    for (const machine of machines) {
      let files = [];
      try {
        files = await readdir(path.join(root, machine));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        continue;
      }
      if (files.some((name) => name.endsWith('.json'))) names.add(machine);
    }
  }
  const limitsFor = context.ledger ? (await import('../sync/limits.mjs')).limitsFor : null;
  const incoming = [];
  for (const machine of [...names].filter((name) => typeof name === 'string' && name.length > 0).sort()) {
    incoming.push({ machine, limits: limitsFor ? await limitsFor(context.ledger, 'receipt', machine) : idleLimits() });
  }
  return incoming;
}

async function pendingPacks(sync) {
  const root = path.join(sync.paths.localDirectory, 'received', 'pending');
  let machines = [];
  try {
    machines = await readdir(root);
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
  let count = 0;
  for (const machine of machines) {
    let files = [];
    try {
      files = await readdir(path.join(root, machine));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    count += files.filter((name) => name.endsWith('.json')).length;
  }
  return count;
}

async function publicationPrepared(sync) {
  const file = path.join(sync.paths.localDirectory, 'outgoing', 'publication.json');
  let text = null;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  try {
    return JSON.parse(text)?.phase === 'prepared';
  } catch {
    return false;
  }
}

function idleLimits() {
  return {
    messages: { used: 0, max: MESSAGE_MAX, windowSeconds: MESSAGE_WINDOW_MS / 1000 },
    messageBytes: { max: MESSAGE_BYTES_MAX },
    syncBytes: { used: 0, max: SYNC_BYTES_MAX, windowSeconds: SYNC_WINDOW_MS / 1000 },
    state: 'normal',
    retryAt: null,
  };
}

function readUnit(bytes, relative, issues) {
  const blank = {
    id: null, unit: path.basename(relative, '.md'), alias: null, removed: false, role: null, scope: null, leadId: null, job: null, model: null, clusterId: null,
    machine: null, runsIn: null, fresh: null, state: 'in', status: 'unknown', context: '', date: null, branch: null, revision: null,
    sessionIds: [], approvalGrants: [], position: null, malformed: true, path: relative,
  };
  if (!bytes) {
    issues.push({ path: relative, code: 'corrupt_resource', message: 'The state could not be read.' });
    return blank;
  }
  try {
    const headers = headerMap(bytes);
    const id = parseUnitId(stateUnitId(bytes, relative));
    const role = validateRole(headers.get('role'));
    const state = headers.get('state');
    if (state !== 'in' && state !== 'out') throw new CoreError(422, 'corrupt_resource', 'The state is not valid.');
    return {
      ...blank,
      id: id.id,
      unit: headers.get('unit') || id.unit,
      alias: headers.get('alias')?.trim() || null,
      removed: headers.get('removed') === 'true',
      role,
      scope: id.scope,
      leadId: headers.get('lead-id') || null,
      job: headers.get('job') || null,
      model: headers.get('model') || null,
      runsIn: stateRunsIn(bytes),
      fresh: role === 'overseer' ? headers.get('fresh') !== 'false' : null,
      clusterId: isUuid(headers.get('cluster-id')) ? headers.get('cluster-id') : null,
      machine: headers.get('machine') || null,
      state,
      context: bodyText(bytes),
      date: headers.get('date') || null,
      branch: headers.get('branch') || null,
      revision: hashBytes(bytes),
      approvalGrants: parseGrants(headers.get('approvals')),
      malformed: false,
    };
  } catch {
    issues.push({ path: relative, code: 'corrupt_resource', message: 'The state could not be projected.' });
    return blank;
  }
}

function readSession(bytes, relative, now, issues) {
  if (!bytes) return [];
  try {
    const record = JSON.parse(bytes.toString('utf8'));
    const activity = observationFresh(record.activityObservedAt, now) ? record.activity ?? null : null;
    const quota = observationFresh(record.quotaObservedAt, now) ? record.quota ?? null : null;
    const id = record.sessionId || derivedSessionId(record);
    if (!id) {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The session could not be projected.' });
      return [];
    }
    return [{
      id,
      unitId: record.unitId ?? null,
      client: record.client ?? null,
      machine: record.machine ?? null,
      nativeSessionId: record.nativeSessionId ?? null,
      runMode: record.runMode ?? 'chat',
      taskId: record.taskId ?? null,
      launchKind: record.launchKind ?? 'manual-app',
      registeredAt: record.registeredAt ?? null,
      activity,
      quota,
      wake: { enabled: false, deadlineAt: null, pausedReason: null },
      state: 'registered',
    }];
  } catch {
    issues.push({ path: relative, code: 'corrupt_resource', message: 'The session could not be projected.' });
    return [];
  }
}

export function projectMessageBytes(bytes, relative, { units = [], aliases = [], receipts = new Set() } = {}) {
  return readMessageFile(bytes, relative, [], receipts, units, aliases);
}

function readMessageFile(bytes, relative, issues, receipts = new Set(), units = [], aliases = []) {
  if (!bytes) return null;
  try {
    const headers = headerMap(bytes);
    const fileId = path.basename(relative, '.md');
    const id = headers.get('id') || fileId;
    if (!id) throw new Error('missing id');
    const planMessage = isUuid(headers.get('plan-id'));
    if (headers.get('kind') === 'run-pointer') return null;
    return {
      id,
      fromId: personId(headers.get('from-id') || headers.get('from'), units, aliases),
      ...(planMessage ? { channel: 'message', authorId: headers.get('from-id'), recipientIds: JSON.parse(headers.get('recipient-ids') || '[]') } : {}),
      toId: messageToId(headers, relative, units, aliases),
      machine: headers.get('machine') || null,
      timestamp: headers.get('timestamp') || null,
      date: headers.get('date') || null,
      priority: headers.get('priority') === 'urgent' ? 'urgent' : 'normal',
      subject: headers.get('subject') || '',
      body: bodyText(bytes),
      threadId: headers.get('thread-id') || headers.get('thread') || id,
      replyTo: headers.get('reply-to') || null,
      replyRequested: headers.get('reply-requested') === 'true',
      attachments: parseList(headers.get('attachments'), relative, issues),
      kind: headers.get('kind') || 'message',
      operationId: headers.get('operation-id') || null,
      delivery: { state: 'stored', deliveredAt: null, readAt: null },
      read: headers.get('read') === 'true' || receipts.has(id),
      notice: headers.get('notice-key') ? { key: headers.get('notice-key'), resourceId: headers.get('resource-id') || null } : null,
      path: relative,
      archived: relative.includes('/archive/'),
      revision: hashBytes(bytes),
    };
  } catch {
    issues.push({ path: relative, code: 'corrupt_resource', message: 'The message could not be projected.' });
    return null;
  }
}

function readTask(bytes, relative, units, issues, aliases = []) {
  if (!bytes) return null;
  try {
    const headers = headerMap(bytes);
    const id = parseTaskId(canonicalTaskId(headers.get('id') || headers.get('task-id') || '', relative));
    const status = headers.get('status');
    if (!['open', 'review', 'done', 'closed'].includes(status)) throw new Error('status');
    const body = bodyText(bytes);
    const sections = taskSections(body);
    const toId = personId(headers.get('to-id') || headers.get('to'), units, aliases, id.scope);
    const fromId = personId(headers.get('from-id') || headers.get('from'), units, aliases, id.scope);
    const assignee = units.find((unit) => unit.id === toId);
    const lead = units.find((unit) => unit.id === assignee?.leadId);
    const leadLabel = lead?.unit ?? null;
    const dated = headers.get('date') || '';
    const approved = Boolean(assignee?.leadId) && leadApproved(body, leadLabel, dated);
    const reviewable = status === 'review' && isMaster(fromId) && (!assignee?.leadId || approved);
    return {
      id: id.id,
      number: id.number,
      scope: id.scope,
      title: headers.get('title') || '',
      status,
      fromId,
      toId,
      date: headers.get('date') || null,
      requirements: String(headers.get('requirements') || '').split(',').map((item) => item.trim()).filter(Boolean),
      approvedBy: approved ? assignee.leadId : null,
      reviewable,
      revision: hashBytes(bytes),
      request: sections.request,
      report: sections.report,
    };
  } catch {
    issues.push({ path: relative, code: 'corrupt_resource', message: 'The task could not be projected.' });
    return null;
  }
}

async function readChats(mind, messages, issues) {
  const chats = [];
  let entries = [];
  try {
    entries = await readdir(path.join(mind, 'user', 'relay', 'chats'), { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return chats;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relative = `user/relay/chats/${entry.name}/chat.md`;
    const bytes = await readSafe(mind, relative);
    if (!bytes) continue;
    try {
      const headers = headerMap(bytes);
      const id = headers.get('id') || entry.name;
      const members = parseList(headers.get('members'), relative, issues);
      const own = messages.filter((message) => message.path?.includes(`/chats/${entry.name}/`) && !message.path.endsWith('/chat.md')).sort(messageOrder);
      chats.push({
        id,
        title: headers.get('title') || '',
        kind: headers.get('kind') === 'group' ? 'group' : 'direct',
        members,
        pinned: headers.get('pinned') === 'true',
        listed: headers.get('listed') !== 'false',
        archived: headers.get('archived') === 'true',
        createdAt: headers.get('created') || headers.get('created-at') || null,
        revision: hashBytes(bytes),
        lastMessage: own[own.length - 1] ?? null,
        unread: own.filter((message) => !message.read).length,
      });
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The chat could not be projected.' });
    }
  }
  return chats;
}

async function readMachines(context, now, issues) {
  const machines = [];
  const origin = context.paths?.origin;
  let entries = [];
  try {
    if (origin) entries = await readdir(path.join(origin, 'machines'), { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relative = path.join(origin, 'machines', entry.name, 'service.json');
    try {
      const beat = JSON.parse(await readFile(relative, 'utf8'));
      machines.push({
        id: beat.machine ?? entry.name,
        state: beat.state === 'running' || beat.state === 'stopped' ? beat.state : 'unknown',
        version: beat.version ?? null,
        heartbeatAt: beat.heartbeatAt ?? null,
        answers: answersFor(beat, now),
        clients: sanitizeClients(beat.clients),
        issues: [],
      });
    } catch {
      issues.push({ path: `machines/${entry.name}/service.json`, code: 'corrupt_resource', message: 'The service beat could not be projected.' });
    }
  }
  const { readPublishedSettings } = await import('./settings.mjs');
  for (const machine of await childNames(context.paths.mind, 'user/machines')) {
    try {
      const report = await readPublishedSettings(context, machine);
      const existing = machines.find(item => item.id === machine);
      if (existing) { existing.connectedClients = report?.connectedClients ?? []; continue; }
      if (report) machines.push({ id: machine, state: report.service.state, version: report.service.version, heartbeatAt: null, answers: false,
        clients: report.agents.items.map(item => ({ id: item.id, enabled: item.cli.state === 'connected', installed: item.found })), connectedClients: report.connectedClients ?? [], issues: [] });
    } catch { issues.push({ path: `user/machines/${machine}/settings.json`, code: 'corrupt_resource', message: 'The machine Settings report could not be projected.' }); }
  }
  machines.sort((left, right) => left.id.localeCompare(right.id));
  return machines;
}

function sanitizeClients(value) {
  if (!Array.isArray(value)) return [];
  const records = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !CLIENTS.includes(item.id)) continue;
    if (typeof item.installed !== 'boolean') continue;
    const installed = item.installed === true;
    records.push({ id: item.id, enabled: installed && item.enabled === true, installed });
  }
  return records;
}

async function readJsonRecord(mind, relative, format, issues) {
  const bytes = await readSafe(mind, relative);
  if (!bytes) return null;
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (value.format !== format) throw new Error('format');
    return { value, revision: hashBytes(bytes) };
  } catch {
    issues.push({ path: relative, code: 'corrupt_resource', message: 'The record could not be projected.' });
    return { value: null, revision: null };
  }
}

function buildSquads(units) {
  const groups = new Map();
  for (const unit of units) {
    if (!unit.id || unit.malformed) continue;
    const key = unit.leadId ? `lead:${unit.leadId}` : `loose:${unit.scope?.kind ?? 'root'}:${unit.scope?.name ?? 'root'}`;
    const group = groups.get(key) ?? { id: key, leadId: unit.leadId ?? null, scope: unit.scope, members: [], rollup: { working: 0, idle: 0, waiting: 0, out: 0, attention: 0 } };
    group.members.push(unit.id);
    if (unit.status === 'quota' || unit.status === 'unknown') group.rollup.attention += 1;
    else if (group.rollup[unit.status] !== undefined) group.rollup[unit.status] += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function collectionItems(view, name, query = {}) {
  if (name === 'plans') return view.plans;
  if (name === 'runs') return view.runs;
  if (name === 'units') return query.archived != null ? view.allUnits.filter((unit) => unit.removed === queryFlag(query.archived)) : view.units;
  if (name === 'leads') return view.units.filter((unit) => view.leads.includes(unit.id));
  if (name === 'squads') return view.squads;
  if (name === 'machines') return view.machines;
  if (name === 'projects') return view.projects;
  if (name === 'sessions') return view.sessions;
  if (name === 'chats') return view.chats;
  if (name === 'groups' || name === 'clusters') return view.clusters;
  if (name === 'tasks') return view.tasks;
  if (name === 'waiting') return view.waiting;
  if (name === 'mailboxes') return mailboxSummaries(view.messages).map((box) => ({ ...box, archived: view.allUnits.some((unit) => unit.id === box.unitId && unit.removed) }))
    .filter((box) => box.archived === (query.archived != null ? queryFlag(query.archived) : false));
  if (name === 'messages') return selectMessages(view.messages, query);
  return [];
}

function matchesQuery(item, name, query) {
  if (query.q != null && String(query.q).length > 200) throw new CoreError(422, 'invalid_query', 'The search is longer than 200 characters.');
  if (query.q && !searchText(item, name).toLowerCase().includes(String(query.q).toLowerCase())) return false;
  if (name === 'tasks' && (query.status == null || query.status === '')) {
    if (item.status === 'closed') return false;
  } else if (query.status) {
    const allowed = String(query.status).split(',').map((part) => part.trim()).filter(Boolean);
    if (allowed.some((part) => !['open', 'review', 'done', 'closed', 'unknown', 'out', 'quota', 'waiting', 'working', 'idle'].includes(part))) {
      throw new CoreError(422, 'invalid_query', 'The status filter is not valid.');
    }
    if (!allowed.includes(item.status)) return false;
  }
  if (query.unitId && item.unitId !== query.unitId && item.id !== query.unitId && item.toId !== query.unitId && !(Array.isArray(item.members) && item.members.includes(query.unitId))) return false;
  if (query.machine && item.machine !== query.machine) return false;
  if (query.leadId && item.leadId !== query.leadId) return false;
  if (query.state && name !== 'messages' && item.state !== query.state) return false;
  if (query.kind && item.kind !== query.kind) return false;
  if (query.pinned != null && query.pinned !== '' && item.pinned !== queryFlag(query.pinned)) return false;
  if (name === 'chats' && query.listed != null && query.listed !== '' && item.listed !== queryFlag(query.listed)) return false;
  return true;
}

function queryFlag(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new CoreError(422, 'invalid_query', 'The boolean filter is not valid.');
}

function chatListed(chat, query) {
  if (query.archived != null && query.archived !== '') {
    if (chat.archived !== queryFlag(query.archived)) return false;
    if (queryFlag(query.archived)) return query.listed == null || query.listed === '' || chat.listed === queryFlag(query.listed);
  } else if (chat.archived) return false;
  if (query.listed == null || query.listed === '') return chat.listed !== false;
  return chat.listed === queryFlag(query.listed);
}

function searchText(item, name) {
  if (name === 'units' || name === 'leads') {
    return [item.unit, item.alias, item.job, item.context].filter((value) => typeof value === 'string').join(' ');
  }
  if (name === 'messages') return `${item.subject ?? ''} ${item.body ?? ''}`;
  if (name === 'tasks') return `${item.number ?? ''} ${item.title ?? ''} ${item.report ?? ''}`;
  return `${item.title ?? ''} ${item.id ?? ''} ${item.unit ?? ''}`;
}

function normalizeFilters(query) {
  const filters = {};
  for (const key of ['q', 'project', 'machine', 'leadId', 'status', 'unitId', 'listed', 'pinned', 'archived', 'state', 'kind', 'chatId', 'mailboxId', 'before']) {
    if (query[key] !== undefined) filters[key] = query[key];
  }
  return filters;
}

function messageToId(headers, relative, units, aliases) {
  const explicit = String(headers.get('to-id') ?? '').trim();
  const legacy = String(headers.get('to') ?? '').trim();
  const pathChat = chatMessageId(relative);
  const named = [chatDestination(explicit), chatDestination(legacy)].filter(Boolean);
  if (named.length > 0) return pathChat && named.every((id) => id === pathChat) ? `chat:${pathChat}` : null;
  if (pathChat && (explicit === 'chat' || legacy === 'chat')) return `chat:${pathChat}`;
  return personId(explicit || legacy, units, aliases);
}

function chatDestination(value) {
  const match = /^chat:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(value ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}

function chatMessageId(relative) {
  const match = /^user\/relay\/chats\/([^/]+)\/([^/]+)\.md$/.exec(String(relative ?? '').replaceAll('\\', '/'));
  if (!match || match[2] === 'chat' || !isUuid(match[1])) return null;
  return match[1];
}

function personId(value, units = [], aliases = [], scope = null) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (resolvePerson(text, { aliases }) || text === 'root:master') return 'root:master';
  if (scope) {
    try { return resolveUnit(text, { units: units.filter((unit) => !unit.malformed).map((unit) => ({ ...unit, unitId: unit.id })), scope, aliases }).unitId; }
    catch { return null; }
  }
  try {
    const parsed = parseUnitId(text);
    if (parsed.id === 'root:master') return 'root:master';
    return units.some((unit) => unit.id === parsed.id) ? parsed.id : null;
  } catch {
    const matches = units.filter((unit) => !unit.malformed && unit.unit?.toLowerCase() === text.toLowerCase());
    return matches.length === 1 ? matches[0].id : null;
  }
}

function personQuestions(units, aliases = []) {
  const labels = new Set(['user', 'master', ...aliases.map((alias) => String(alias).trim().toLowerCase()).filter(Boolean)]);
  const items = [];
  for (const unit of units) {
    if (unit.malformed || unit.scope?.kind === 'project') continue;
    for (const line of String(unit.context ?? '').split(/\r?\n/)) {
      const match = line.match(/^Waiting on (?:the )?([^:]+): (.+)$/i);
      if (!match || !labels.has(match[1].trim().toLowerCase().replace(/^person:/, ''))) continue;
      for (const title of match[2].split(';').map((part) => part.trim()).filter(Boolean)) {
        items.push({
          id: `question:${unit.id}:${hashText(title)}`,
          kind: 'question',
          state: 'pending',
          unitId: unit.id,
          title,
          since: unit.date ?? '',
          chatId: null,
          approvalId: null,
          taskId: null,
          messageId: null,
          blocking: true,
        });
      }
    }
  }
  return items;
}

function messageInScope(message, scope) {
  if (scope.chatId && !message.path?.includes(`/chats/${scope.chatId}/`)) return false;
  if (scope.mailboxId) {
    const encoded = Buffer.from(String(scope.mailboxId)).toString('base64url');
    if (message.toId !== scope.mailboxId && !message.path?.includes(`/archive/by-unit/${encoded}/`)) return false;
  }
  return true;
}

function selectMessages(messages, query) {
  let items = messages.filter((message) => !message.path?.endsWith('/chat.md'));
  if (query.chatId) items = items.filter((message) => message.path?.includes(`/chats/${query.chatId}/`));
  if (query.mailboxId) {
    const encoded = Buffer.from(String(query.mailboxId)).toString('base64url');
    items = items.filter((message) => message.toId === query.mailboxId || message.path?.includes(`/archive/by-unit/${encoded}/`));
    const state = query.state ?? 'unread';
    if (state === 'unread') items = items.filter((message) => !message.read && !message.archived);
    else if (state === 'read') items = items.filter((message) => message.read || message.archived);
    else if (state !== 'all') throw new CoreError(422, 'invalid_query', 'The message state is not valid.');
  }
  return items;
}

function mailboxSummaries(messages) {
  const groups = new Map();
  for (const message of messages) {
    if (!message.toId || message.path?.includes('/chats/')) continue;
    const group = groups.get(message.toId) ?? { id: message.toId, unitId: message.toId, unread: 0, total: 0 };
    group.total += 1;
    if (!message.read && !message.archived) group.unread += 1;
    groups.set(message.toId, group);
  }
  return [...groups.values()].sort((left, right) => left.unitId.localeCompare(right.unitId));
}

function inProjectChain(unit, project, units) {
  if (unit.scope?.id === `project:${project}`) return true;
  if (unit.scope?.kind === 'root' || unit.role === 'overseer' || unit.role === 'master') return true;
  if (unit.scope?.kind === 'environment') return units.some((item) => item.scope?.id === `project:${project}` && item.leadId === unit.id);
  return false;
}

function unitOrder(left, right) {
  const rank = (unit) => (unit.status === 'idle' || unit.status === 'out' ? 1 : 0);
  return rank(left) - rank(right) || String(left.unit).localeCompare(String(right.unit)) || String(left.id).localeCompare(String(right.id));
}

function messageOrder(left, right) {
  const a = left.timestamp || left.date || '';
  const b = right.timestamp || right.date || '';
  return a.localeCompare(b) || String(left.id).localeCompare(String(right.id));
}

function activityFor(sessions, unitId) {
  const session = sessions.find((item) => item.unitId === unitId);
  if (!session) return null;
  return session.activity ?? null;
}

function quotaFor(sessions, unitId) {
  return sessions.find((item) => item.unitId === unitId)?.quota ?? null;
}

function isMaster(id) {
  return id === 'root:master' || id === 'user' || id === 'master';
}

function parseGrants(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(({ id, action, pattern, grantedAt, grantedBy }) => {
      const fields = { 'process.run': ['command', 'cwd'], 'file.write': ['resource', 'path'], 'network.request': ['method', 'origin', 'path'] }[action];
      if (!fields || !pattern || typeof pattern !== 'object' || fields.some(key => typeof pattern[key] !== 'string')) return null;
      return { id, action, pattern: Object.fromEntries(fields.map(key => [key, pattern[key]])), grantedAt, grantedBy };
    }).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function headerMap(bytes) {
  const text = bytes.toString('utf8');
  const end = text.indexOf('\n\n') >= 0 ? text.indexOf('\n\n') : text.length;
  const headers = new Map();
  for (const line of text.slice(0, end).split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

function bodyText(bytes) {
  const text = bytes.toString('utf8');
  const split = text.split(/\r?\n\r?\n/);
  return split.length > 1 ? split.slice(1).join('\n\n') : '';
}

async function scopeRoots(mind) {
  const roots = [{ state: 'user/state', tasks: 'user/tasks', inbox: 'user/inbox', archive: 'user/relay/archive' }];
  for (const name of await childNames(mind, 'user/envs')) {
    roots.push({
      state: `user/envs/${name}/state`,
      tasks: `user/envs/${name}/tasks`,
      inbox: `user/envs/${name}/inbox`,
      archive: `user/envs/${name}/archive`,
    });
  }
  for (const name of await childNames(mind, 'user/projects')) {
    roots.push({
      state: `user/projects/${name}/state`,
      tasks: `user/projects/${name}/tasks`,
      inbox: `user/projects/${name}/inbox`,
      archive: `user/projects/${name}/archive`,
    });
  }
  return roots;
}

async function childNames(root, relative) {
  const directory = path.join(root, ...relative.split('/'));
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name).sort();
}

function derivedSessionId(record) {
  if (!record?.machine || !record.client || !record.nativeSessionId || !record.unitId) return '';
  return uuidV8(['session', record.machine, record.client, record.nativeSessionId, record.unitId]);
}

function mergeSessions(observed, statuses, wakes) {
  const byId = new Map();
  for (const session of observed) {
    if (!session?.id) continue;
    const previous = byId.get(session.id);
    if (!previous || String(session.registeredAt ?? '') >= String(previous.registeredAt ?? '')) byId.set(session.id, { ...session });
  }
  for (const status of statuses) {
    const session = byId.get(status.sessionId);
    if (!session) continue;
    if (!session.statusAt || String(status.at ?? '') >= String(session.statusAt)) {
      session.state = status.state;
      session.statusAt = status.at;
    }
  }
  for (const session of observed.filter((session) => session.launchKind === 'cli')) {
    const current = byId.get(session.id);
    if (current && current.unitId === session.unitId && current.nativeSessionId === session.nativeSessionId) {
      Object.assign(current, { launchKind: 'cli', runMode: session.runMode, taskId: session.taskId });
    }
  }
  for (const session of byId.values()) {
    const matches = wakes.filter((item) => item.unitId === session.unitId
      && item.nativeSessionId === session.nativeSessionId && item.client === session.client && item.machine === session.machine);
    if (matches.length) {
      const deadlineAt = matches.map((item) => item.deadlineAt).filter((value) => Number.isFinite(Date.parse(value)))
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
      session.wake = {
        enabled: matches.every((item) => item.enabled === true && !item.pausedReason && Number.isFinite(Date.parse(item.deadlineAt))),
        deadlineAt,
        pausedReason: matches.find((item) => item.pausedReason)?.pausedReason ?? null,
      };
    }
    delete session.statusAt;
  }
  return [...byId.values()];
}

async function readStatuses(mind, issues) {
  const statuses = [];
  for (const relative of await filesUnder(mind, 'user/relay/session-status')) {
    if (!relative.endsWith('.json')) continue;
    const bytes = await readSafe(mind, relative);
    if (!bytes) continue;
    try {
      const record = JSON.parse(bytes.toString('utf8'));
      if (!record.sessionId || !record.state) throw new Error('status');
      statuses.push({ sessionId: record.sessionId, state: record.state, at: record.at ?? '' });
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The session status could not be projected.' });
    }
  }
  return statuses;
}

async function readWake(mind, issues) {
  const policies = [];
  for (const relative of await filesUnder(mind, 'user/relay/wake/policies')) {
    if (!relative.endsWith('.json')) continue;
    const bytes = await readSafe(mind, relative);
    if (!bytes) continue;
    try {
      const record = JSON.parse(bytes.toString('utf8'));
      const binding = record.binding ?? {};
      policies.push({
        unitId: binding.unitId ?? null,
        nativeSessionId: binding.nativeSessionId ?? null,
        client: binding.client ?? null,
        machine: binding.machine ?? null,
        enabled: record.enabled === true,
        deadlineAt: record.deadlineAt ?? null,
        pausedReason: record.pausedReason ?? null,
      });
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The wake policy could not be projected.' });
    }
  }
  return policies;
}

async function readReceipts(mind, issues) {
  const byReader = new Map();
  for (const relative of await filesUnder(mind, 'user')) {
    if (!relative.includes('/read/') || !relative.endsWith('.json')) continue;
    const bytes = await readSafe(mind, relative);
    if (!bytes) continue;
    try {
      const record = JSON.parse(bytes.toString('utf8'));
      const reader = typeof record.unitId === 'string' ? record.unitId : 'root:master';
      const ids = byReader.get(reader) ?? new Map();
      if (typeof record.messageId === 'string') ids.set(record.messageId, record.at ?? null);
      if (Array.isArray(record.messageIds)) {
        for (const id of record.messageIds) {
          if (typeof id === 'string') ids.set(id, record.at ?? null);
        }
      }
      byReader.set(reader, ids);
      const scope = record.format === 'hivem1nd-chat-read-v1' && record.chatId && relative.startsWith(`user/relay/chats/${record.chatId}/read/${Buffer.from(reader).toString('base64url')}/`)
        ? record.chatId : record.format === 'hivem1nd-mailbox-receipt-v1' && record.mailboxId === reader ? 'mailbox' : null;
      if (scope && validReceiptTime(record.at)) {
        const times = byReader.get(`${scope}:${reader}`) ?? new Map();
        for (const id of record.messageIds ?? []) {
          if (typeof id === 'string' && (!times.has(id) || record.at < times.get(id))) times.set(id, record.at);
        }
        byReader.set(`${scope}:${reader}`, times);
      }
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The read receipt could not be projected.' });
    }
  }
  return byReader;
}

function validReceiptTime(at) {
  return typeof at === 'string' && Number.isFinite(Date.parse(at));
}

async function readPendingApprovals(mind, issues, now) {
  const items = [];
  for (const relative of await filesUnder(mind, 'user/relay/approvals')) {
    if (!relative.endsWith('/request.json')) continue;
    const bytes = await readSafe(mind, relative);
    if (!bytes) continue;
    try {
      const request = JSON.parse(bytes.toString('utf8'));
      const resultBytes = await readSafe(mind, relative.replace(/request\.json$/, 'result.json'));
      const result = resultBytes ? JSON.parse(resultBytes.toString('utf8')) : null;
      if (result?.state === 'approved' || result?.state === 'denied') continue;
      const expired = result?.state === 'expired' || Date.parse(request.expiresAt) <= now;
      const answers = await filesUnder(mind, relative.replace(/request\.json$/, 'answers'));
      const state = expired ? 'expired' : answers.some((file) => file.endsWith('.json')) ? 'answering' : 'pending';
      items.push({ id: 'approval:' + request.id, kind: 'approval', state,
        desktopOnly: request.action === 'plan.message.extend' || classifyApprovalAction(request.action, request.pattern).desktopOnly,
        unitId: request.unitId ?? null, title: request.display ?? request.action ?? '',
        since: request.requestedAt ?? '', chatId: request.chatId ?? null, approvalId: request.id ?? null,
        taskId: null, messageId: null, blocking: !expired });
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The approval could not be projected.' });
    }
  }
  return items;
}

async function readUndo(mind, issues) {
  const grouped = new Map();
  for (const relative of await filesUnder(mind, 'user/relay/task-undo')) {
    if (!relative.endsWith('.json')) continue;
    const bytes = await readSafe(mind, relative);
    if (!bytes) continue;
    try {
      const record = JSON.parse(bytes.toString('utf8'));
      if (!record?.taskId) continue;
      const list = grouped.get(record.taskId) ?? [];
      list.push(record);
      grouped.set(record.taskId, list);
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The undo record could not be projected.' });
    }
  }
  const latest = new Map();
  for (const [taskId, records] of grouped) {
    const reversed = new Set(records.filter((record) => record.kind === 'undo' && record.undoOf).map((record) => record.undoOf));
    const chosen = records
      .filter((record) => record.kind === 'status' && record.afterRevision && !reversed.has(record.id))
      .sort((left, right) => {
        const delta = Date.parse(left.at ?? '') - Date.parse(right.at ?? '');
        if (Number.isFinite(delta) && delta !== 0) return delta;
        return String(left.id).localeCompare(String(right.id));
      })
      .at(-1);
    if (chosen) latest.set(taskId, chosen);
  }
  return latest;
}

function taskUndoAvailable(task, record, actor) {
  if (!task || !record || !actor) return false;
  if (record.afterRevision !== task.revision) return false;
  return actor === record.actor || actor === task.fromId;
}

async function readApprovals(mind, issues) {
  for (const relative of await filesUnder(mind, 'user/relay/approvals')) {
    if (!relative.endsWith('.json')) continue;
    const bytes = await readSafe(mind, relative);
    if (!bytes) continue;
    try {
      JSON.parse(bytes.toString('utf8'));
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The approval could not be projected.' });
    }
  }
}

function taskSections(body) {
  const request = sectionText(body, 'Request');
  const report = sectionText(body, 'Report');
  if (request == null && report == null) return { request: body, report: body };
  return { request: request ?? '', report: report ?? '' };
}

function sectionText(body, name) {
  const match = body.match(new RegExp(`(?:^|\\n)## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match ? match[1].trim() : null;
}

function parseList(value, relative, issues) {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) throw new Error('list');
      return parsed.map((item) => (typeof item === 'string' || (item && typeof item === 'object') ? item : canonicalJson(item)));
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The list could not be projected.' });
      return [];
    }
  }
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
}

async function filesUnder(root, relative) {
  const found = [];
  await walk(path.join(root, ...relative.split('/')), relative, found);
  return found;
}

async function walk(directory, relative, found) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const next = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), next, found);
    else if (entry.isFile()) found.push(next);
  }
}

async function readSafe(root, relative) {
  try {
    return await readFile(path.join(root, ...relative.split('/')));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function boundLimit(limit) {
  const value = limit === undefined ? 50 : Number(limit);
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) throw new CoreError(422, 'invalid_query', 'The page limit must be from 1 to 200.');
  return value;
}

function encodeCursor(payload) {
  const encoded = Buffer.from(canonicalJson(payload)).toString('base64url');
  if (encoded.length > 1024) throw new CoreError(400, 'invalid_cursor', 'The page cursor is too large.');
  return encoded;
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new CoreError(400, 'invalid_cursor', 'The page cursor is not valid.');
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.contract !== 'hivem1nd-gui-v3' || typeof parsed.filters !== 'string' || typeof parsed.snapshot !== 'string') {
      throw new Error('shape');
    }
    return parsed;
  } catch (error) {
    if (error instanceof CoreError) throw error;
    throw new CoreError(400, 'invalid_cursor', 'The page cursor is not valid.');
  }
}
