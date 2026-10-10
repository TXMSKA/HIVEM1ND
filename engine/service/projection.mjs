import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, hashText, parseTaskId, parseUnitId, uuidV8, validateRole } from './identity.mjs';

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
  const loaded = await loadMind(context);
  const view = assemble(loaded, query);
  const bytes = Buffer.byteLength(canonicalJson(view));
  if (bytes > VIEW_LIMIT) {
    throw new CoreError(413, 'view_too_large', 'The view exceeds 16 MB. Request the individual lists.');
  }
  return view;
}

export async function readCollection(context, name, query = {}) {
  const view = await readProjection(context, query);
  const items = collectionItems(view, name, query);
  const filtered = items.filter((item) => matchesQuery(item, name, query));
  if (name === 'messages') {
    const snapshot = hashText(canonicalJson(filtered.map(messageIdentity)));
    return {
      ...paginateMessages(filtered, { ...query, snapshot, filters: normalizeFilters(query) }),
      issues: view.issues,
    };
  }
  const snapshot = hashText(canonicalJson(filtered.map(identityOf)));
  return { ...paginate(filtered, { ...query, snapshot, filters: normalizeFilters(query) }), issues: view.issues };
}

export async function readDetail(context, name, id, scope = {}) {
  const view = await readProjection(context);
  if (name === 'layout') return { layout: view.layout, revision: view.layoutRevision };
  if (name === 'settings') return { settings: view.settings, revision: view.settingsRevision };
  if (name === 'messages') {
    const foundMessage = view.messages.find((item) => item.id === id && messageInScope(item, scope));
    if (!foundMessage) throw new CoreError(404, 'message_not_found', 'The record does not exist.');
    return foundMessage;
  }
  const found = collectionItems(view, name, {}).find((item) => item.id === id);
  if (!found) throw new CoreError(404, `${name.replace(/s$/, '')}_not_found`, 'The record does not exist.');
  return found;
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
  if (!mind) throw new CoreError(503, 'mind_unavailable', 'The mind is not available.');
  try {
    const stats = await lstat(mind);
    if (!stats.isDirectory()) throw new CoreError(503, 'mind_unavailable', 'The mind is not available.');
  } catch (error) {
    if (error instanceof CoreError) throw error;
    throw new CoreError(503, 'mind_unavailable', 'The mind is not available.');
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
  const receipts = (await readReceipts(mind, issues)).get(context.principal?.unitId || 'root:master') ?? new Set();
  const messages = [];
  for (const scope of scopes) {
    for (const bucket of [scope.inbox, scope.archive]) {
      for (const relative of await filesUnder(mind, bucket)) {
        if (!relative.endsWith('.md') || relative.includes('/read/') || relative.includes('.conflict-')) continue;
        const message = readMessageFile(await readSafe(mind, relative), relative, issues, receipts);
        if (message) messages.push(message);
      }
    }
  }
  for (const relative of await filesUnder(mind, 'user/relay/chats')) {
    if (!relative.endsWith('.md') || relative.endsWith('/chat.md') || relative.includes('/read/') || relative.includes('.conflict-')) continue;
    const message = readMessageFile(await readSafe(mind, relative), relative, issues, receipts);
    if (message) messages.push(message);
  }
  const tasks = [];
  for (const scope of scopes) {
    for (const relative of await filesUnder(mind, scope.tasks)) {
      if (!relative.endsWith('.md') || relative.includes('.conflict-')) continue;
      const task = readTask(await readSafe(mind, relative), relative, units, issues);
      if (task) tasks.push(task);
    }
  }
  const undone = await readUndo(mind, issues);
  for (const task of tasks) {
    if (undone.get(task.id) === task.revision) task.undoAvailable = true;
  }
  await readApprovals(mind, issues);
  const approvals = await readPendingApprovals(mind, issues);
  const catalog = await readJsonRecord(mind, 'user/gui/resources.json', 'hivem1nd-resources-v1', issues);
  const chats = await readChats(mind, messages, issues);
  const machines = await readMachines(context, now, issues);
  const layout = await readJsonRecord(mind, 'user/gui/layout.json', 'hivem1nd-layout-v1', issues);
  const settings = await readJsonRecord(mind, 'user/gui/settings.json', 'hivem1nd-settings-v1', issues);
  const projects = [];
  for (const name of await childNames(mind, 'user/projects')) {
    const product = await readJsonRecord(mind, `user/projects/${name}/product.json`, 'hivem1nd-product-v1', issues);
    projects.push({ id: `project:${name}`, name, title: product?.value?.title ?? name, path: `user/projects/${name}` });
  }
  projects.sort((left, right) => left.name.localeCompare(right.name));
  return { units, sessions, messages, tasks, chats, machines, layout, settings, projects, catalog, approvals, issues: collectIssues(issues) };
}

function assemble(loaded, query) {
  const waiting = waitingFor([
    ...loaded.tasks.filter((task) => task.reviewable).map((task) => ({
      id: `review:${task.id}`, kind: 'review', unitId: task.toId, title: task.title, since: task.date ?? '', chatId: null, approvalId: null, taskId: task.id, messageId: null, blocking: true,
    })),
    ...loaded.messages.filter((message) => message.replyRequested && isMaster(message.toId)).map((message) => ({
      id: `message:${message.id}`, kind: 'message', unitId: message.toId, title: message.subject || message.body, since: message.timestamp ?? message.date ?? '', chatId: null, approvalId: null, taskId: null, messageId: message.id, blocking: false,
    })),
    ...personQuestions(loaded.units),
    ...(loaded.approvals ?? []),
  ]);
  const waitingUnits = new Set(waiting.map((item) => item.unitId).filter(Boolean));
  const units = loaded.units.map((unit) => ({
    ...unit,
    status: statusFor({
      malformed: unit.malformed,
      state: unit.state,
      quota: quotaFor(loaded.sessions, unit.id),
      waiting: waitingUnits.has(unit.id),
      activity: activityFor(loaded.sessions, unit.id),
    }),
  }));
  const overseers = units.filter((unit) => unit.role === 'overseer' && !unit.malformed);
  const canonical = overseers.find((unit) => unit.id === 'root:overseer') ?? overseers[0] ?? null;
  const issues = [...loaded.issues];
  for (const extra of overseers) {
    if (canonical && extra.id !== canonical.id) issues.push({ path: extra.path, code: 'duplicate_overseer', message: 'Only one Overseer is canonical.' });
  }
  const leads = [...new Set([canonical?.id, ...units.map((unit) => unit.leadId)].filter(Boolean))];
  const squads = buildSquads(units);
  const listedChats = loaded.chats.filter((chat) => query.listed === false ? true : chat.listed !== false);
  const project = query.project ?? null;
  const visibleUnits = project ? units.filter((unit) => inProjectChain(unit, project, units)) : units;
  visibleUnits.sort(unitOrder);
  const view = {
    mind: { version: '3.0.0', machine: query.machine ?? null, project },
    units: visibleUnits,
    leads,
    squads,
    projects: loaded.projects,
    machines: loaded.machines,
    sessions: [...loaded.sessions].sort((left, right) => String(right.registeredAt ?? '').localeCompare(String(left.registeredAt ?? '')) || String(left.id).localeCompare(String(right.id))),
    chats: listedChats,
    tasks: loaded.tasks,
    waiting,
    counts: countsOf(visibleUnits, leads, squads, loaded, listedChats, waiting, issues),
    issues: collectIssues(issues),
    layout: loaded.layout?.value ?? { format: 'hivem1nd-layout-v1', nodes: {}, groups: {} },
    layoutRevision: loaded.layout?.revision ?? null,
    settings: loaded.settings?.value ?? { format: 'hivem1nd-settings-v1', look: 'modern', language: 'en' },
    settingsRevision: loaded.settings?.revision ?? null,
    messages: loaded.messages,
    editors: editorSummaries(loaded.catalog),
  };
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
    waiting: waiting.length,
    open: tasks.filter((task) => task.status === 'open').length,
    review: tasks.filter((task) => task.status === 'review').length,
    done: tasks.filter((task) => task.status === 'done').length,
    closed: tasks.filter((task) => task.status === 'closed').length,
    unread: loaded.messages.filter((message) => message.read === false).length,
    issues: issues.length,
  };
}

function readUnit(bytes, relative, issues) {
  const blank = {
    id: null, unit: path.basename(relative, '.md'), role: null, scope: null, leadId: null, job: null, model: null,
    machine: null, state: 'in', status: 'unknown', context: '', date: null, branch: null, revision: null,
    sessionIds: [], approvalGrants: [], position: null, malformed: true, path: relative,
  };
  if (!bytes) {
    issues.push({ path: relative, code: 'corrupt_resource', message: 'The state could not be read.' });
    return blank;
  }
  try {
    const headers = headerMap(bytes);
    const id = parseUnitId(headers.get('unit-id') || derivedUnitId(relative, headers));
    const role = validateRole(headers.get('role'));
    const state = headers.get('state');
    if (state !== 'in' && state !== 'out') throw new CoreError(422, 'corrupt_resource', 'The state is not valid.');
    return {
      ...blank,
      id: id.id,
      unit: headers.get('unit') || id.unit,
      role,
      scope: id.scope,
      leadId: headers.get('lead-id') || null,
      job: headers.get('job') || null,
      model: headers.get('model') || null,
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

function readMessageFile(bytes, relative, issues, receipts = new Set()) {
  if (!bytes) return null;
  try {
    const headers = headerMap(bytes);
    const fileId = path.basename(relative, '.md');
    const id = headers.get('id') || fileId;
    if (!id) throw new Error('missing id');
    return {
      id,
      fromId: personId(headers.get('from-id') || headers.get('from')),
      toId: personId(headers.get('to-id') || headers.get('to')),
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

function readTask(bytes, relative, units, issues) {
  if (!bytes) return null;
  try {
    const headers = headerMap(bytes);
    const id = parseTaskId(canonicalTaskId(headers.get('id') || headers.get('task-id') || '', relative));
    const status = headers.get('status');
    if (!['open', 'review', 'done', 'closed'].includes(status)) throw new Error('status');
    const body = bodyText(bytes);
    const sections = taskSections(body);
    const toId = personId(headers.get('to-id') || headers.get('to'));
    const fromId = personId(headers.get('from-id') || headers.get('from'));
    const assignee = units.find((unit) => unit.id === toId);
    const lead = units.find((unit) => unit.id === assignee?.leadId);
    const leadLabel = lead?.unit ?? null;
    const dated = headers.get('date') || '';
    const reviewable = status === 'review' && isMaster(fromId) && (!assignee?.leadId || Boolean(leadLabel && body.includes(`Approved for review by ${leadLabel} on ${dated}`)));
    return {
      id: id.id,
      number: id.number,
      scope: id.scope,
      title: headers.get('title') || '',
      status,
      fromId,
      toId,
      date: headers.get('date') || null,
      requirements: [],
      approvedBy: reviewable && leadLabel ? leadLabel : null,
      reviewable,
      revision: hashBytes(bytes),
      request: sections.request,
      report: sections.report,
      undoAvailable: false,
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
  if (!origin) return machines;
  let entries = [];
  try {
    entries = await readdir(path.join(origin, 'machines'), { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return machines;
    throw error;
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
        clients: [],
        issues: [],
      });
    } catch {
      issues.push({ path: `machines/${entry.name}/service.json`, code: 'corrupt_resource', message: 'The service beat could not be projected.' });
    }
  }
  machines.sort((left, right) => left.id.localeCompare(right.id));
  return machines;
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
  if (name === 'units' || name === 'leads') return name === 'leads' ? view.units.filter((unit) => view.leads.includes(unit.id)) : view.units;
  if (name === 'squads') return view.squads;
  if (name === 'machines') return view.machines;
  if (name === 'sessions') return view.sessions;
  if (name === 'chats') return view.chats;
  if (name === 'tasks') return view.tasks;
  if (name === 'waiting') return view.waiting;
  if (name === 'mailboxes') return mailboxSummaries(view.messages);
  if (name === 'messages') return selectMessages(view.messages, query);
  return [];
}

function matchesQuery(item, name, query) {
  if (query.q && !searchText(item, name).toLowerCase().includes(String(query.q).toLowerCase())) return false;
  if (query.status && item.status !== query.status) return false;
  if (query.unitId && item.unitId !== query.unitId && item.id !== query.unitId && item.toId !== query.unitId) return false;
  return true;
}

function searchText(item, name) {
  if (name === 'units' || name === 'leads') return `${item.unit ?? ''} ${item.job ?? ''} ${item.context ?? ''}`;
  if (name === 'messages') return `${item.subject ?? ''} ${item.body ?? ''}`;
  if (name === 'tasks') return `${item.number ?? ''} ${item.title ?? ''} ${item.report ?? ''}`;
  return `${item.title ?? ''} ${item.id ?? ''} ${item.unit ?? ''}`;
}

function normalizeFilters(query) {
  const filters = {};
  for (const key of ['q', 'project', 'machine', 'leadId', 'status', 'unitId', 'listed', 'pinned', 'state', 'kind', 'chatId', 'mailboxId', 'before']) {
    if (query[key] !== undefined) filters[key] = query[key];
  }
  return filters;
}

function identityOf(item) {
  return item.id ?? item.path ?? '';
}

function messageIdentity(item) {
  return { id: item.id, revision: item.revision ?? null, read: item.read === true, archived: item.archived === true };
}

function personId(value) {
  if (!value) return null;
  if (value === 'user' || value === 'master') return 'root:master';
  return value;
}

function personQuestions(units) {
  const items = [];
  for (const unit of units) {
    if (unit.malformed || unit.scope?.kind === 'project') continue;
    for (const line of String(unit.context ?? '').split(/\r?\n/)) {
      const match = line.match(/^Waiting on (?:the )?(user|master): (.+)$/i);
      if (!match) continue;
      for (const title of match[2].split(';').map((part) => part.trim()).filter(Boolean)) {
        items.push({
          id: `question:${unit.id}:${title}`,
          kind: 'question',
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

function editorSummaries(catalog) {
  const resources = catalog?.value?.resources;
  if (!Array.isArray(resources)) return [];
  return resources.map((resource) => ({
    id: resource.id,
    kind: resource.kind ?? null,
    project: resource.project ?? null,
    path: resource.path ?? null,
    title: resource.title ?? resource.legacyId ?? resource.path ?? '',
  })).sort((left, right) => String(left.project ?? '').localeCompare(String(right.project ?? '')) || String(left.title).localeCompare(String(right.title)) || String(left.id).localeCompare(String(right.id)));
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
    return Array.isArray(parsed) ? parsed : [];
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
  for (const name of await childNames(mind, 'user/environments')) {
    roots.push({
      state: `user/environments/${name}/state`,
      tasks: `user/environments/${name}/tasks`,
      inbox: `user/environments/${name}/inbox`,
      archive: `user/environments/${name}/archive`,
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

function derivedUnitId(relative, headers) {
  const name = String(headers.get('unit') || path.basename(relative, '.md')).toLowerCase();
  const parts = relative.split('/');
  if (parts[1] === 'projects' && parts[3] === 'state') return `project:${parts[2]}:${name}`;
  if (parts[1] === 'environments' && parts[3] === 'state') return `env:${parts[2]}:${name}`;
  return `root:${name}`;
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
  for (const session of byId.values()) {
    const wake = wakes.find((item) => item.unitId === session.unitId && item.nativeSessionId === session.nativeSessionId);
    if (wake) session.wake = { enabled: wake.enabled === true, deadlineAt: wake.deadlineAt ?? null, pausedReason: wake.pausedReason ?? null };
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
      const ids = byReader.get(reader) ?? new Set();
      if (typeof record.messageId === 'string') ids.add(record.messageId);
      if (Array.isArray(record.messageIds)) {
        for (const id of record.messageIds) {
          if (typeof id === 'string') ids.add(id);
        }
      }
      byReader.set(reader, ids);
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The read receipt could not be projected.' });
    }
  }
  return byReader;
}

async function readPendingApprovals(mind, issues) {
  const pending = [];
  for (const relative of await filesUnder(mind, 'user/relay/approvals')) {
    if (!relative.endsWith('/request.json')) continue;
    const bytes = await readSafe(mind, relative);
    if (!bytes) continue;
    try {
      const request = JSON.parse(bytes.toString('utf8'));
      const result = await readSafe(mind, relative.replace(/request\.json$/, 'result.json'));
      if (result) {
        const parsed = JSON.parse(result.toString('utf8'));
        if (parsed.state && parsed.state !== 'pending') continue;
      }
      pending.push({
        id: `approval:${request.id}`,
        kind: 'approval',
        unitId: request.unitId ?? null,
        title: request.display ?? request.action ?? '',
        since: request.requestedAt ?? '',
        chatId: request.chatId ?? null,
        approvalId: request.id ?? null,
        taskId: null,
        messageId: null,
        blocking: true,
      });
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The approval could not be projected.' });
    }
  }
  return pending;
}

async function readUndo(mind, issues) {
  const latest = new Map();
  for (const relative of await filesUnder(mind, 'user/relay/task-undo')) {
    if (!relative.endsWith('.json')) continue;
    const bytes = await readSafe(mind, relative);
    if (!bytes) continue;
    try {
      const record = JSON.parse(bytes.toString('utf8'));
      if (record.kind === 'undo' || !record.taskId || !record.afterRevision) continue;
      latest.set(record.taskId, record.afterRevision);
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The undo record could not be projected.' });
    }
  }
  return latest;
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

function canonicalTaskId(value, relative) {
  const digits = /^\d{1,12}$/.test(value) ? value.padStart(3, '0') : '';
  const fromName = path.basename(relative, '.md').match(/^(\d+)/);
  const number = digits || (fromName ? fromName[1].padStart(3, '0') : '');
  if (!number || value.includes(':')) return value;
  const parts = relative.split('/');
  if (parts[1] === 'projects' && parts[3] === 'tasks') return `project:${parts[2]}:${number}`;
  if (parts[1] === 'environments' && parts[3] === 'tasks') return `env:${parts[2]}:${number}`;
  return `root:${number}`;
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
      return parsed.map((item) => (typeof item === 'string' ? item : canonicalJson(item)));
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
  if (typeof cursor !== 'string' || cursor.length > 1024) throw new CoreError(400, 'invalid_cursor', 'The page cursor is not valid.');
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
