import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CoreError, hashBytes, isPersonAlias, parseTaskId, parseUnitId, replaceHeader } from './identity.mjs';
import { canonicalJson } from './identity.mjs';
import { createChat } from './chats.mjs';
import { commitTransaction, readBytes, recoverTransactions, revisionOf, withLocks, withReceipt } from './store.mjs';
import { openSync, stageTransaction } from '../sync/store.mjs';

const EDGES = new Set(['open>review', 'review>done', 'review>open', 'done>closed', 'closed>open']);

export async function loadTask(context, taskId) {
  const parsed = parseTaskId(taskId);
  const directory = path.join(context.paths.mind, 'user', 'tasks');
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.md') && !name.includes('.conflict-')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') throw new CoreError(404, 'task_not_found', 'The task does not exist.');
    throw error;
  }
  for (const name of names) {
    const relative = `user/tasks/${name}`;
    const bytes = await readBytes(context.store, absolute(context, relative));
    if (!bytes) continue;
    const task = describe(bytes, relative, parsed.id, context.aliases ?? []);
    if (task?.id === parsed.id) return { ...task, ...(await assigneeLead(context, task.toId)) };
  }
  throw new CoreError(404, 'task_not_found', 'The task does not exist.');
}

export function reviewAuthority(task) {
  const requesterId = requesterOf(task, task.aliases ?? []);
  const leadName = task.leadUnit || task.leadId || '';
  const reviewable = task.status === 'review' && requesterId === 'root:master' && (!task.leadId || task.body.includes(`Approved for review by ${leadName} on `));
  return { reviewable, requesterId, leadId: task.leadId ?? null };
}

export async function changeStatus(context, taskId, input, options = {}) {
  const run = () => withLocks(context.store, [`task:${taskId}`], () => writeChange(context, taskId, input, null));
  if (!options.receipt) return run();
  return withReceipt(context.store, options.receipt, (receipt) => withLocks(context.store, [`task:${taskId}`], () => writeChange(context, taskId, input, receipt)));
}

export async function undoStatus(context, taskId, input) {
  return withLocks(context.store, [`task:${taskId}`], async () => {
    const task = await loadTask(context, taskId);
    if (input?.expectedRevision !== task.revision) throw new CoreError(409, 'revision_conflict', 'The task changed since it was read.');
    const records = await changeRecords(context, task.id);
    const undone = new Set(records.filter((record) => record.kind === 'undo' && record.undoOf).map((record) => record.undoOf));
    const latest = records.filter((record) => record.kind === 'status' && !undone.has(record.id)).sort(byRecord).at(-1) ?? null;
    if (!latest) throw new CoreError(409, 'nothing_to_undo', 'There is no status change to undo.');
    if (latest.afterRevision !== task.revision) throw new CoreError(409, 'undo_conflict', 'A newer edit replaced the status change.');
    const actor = context.principal?.unitId;
    const authority = reviewAuthority(task);
    if (actor !== latest.actor && actor !== authority.requesterId) throw new CoreError(403, 'forbidden', 'Only the actor or requester can undo this task.');
    const next = appendAudit(replaceHeader(task.bytes, 'status', latest.previousStatus), auditLine(context, actor, 'Undone.'));
    return commitChange(context, task, {
      kind: 'undo',
      previousStatus: task.status,
      status: latest.previousStatus,
      note: 'Undone.',
      undoOf: latest.id,
      bytes: next,
      events: [{ name: 'task.changed', data: { task: { id: task.id, status: latest.previousStatus }, changeId: null, undoOf: latest.id } }],
    });
  });
}

export async function recoverTaskChanges(context) {
  return recoverTransactions(context.store);
}

async function writeChange(context, taskId, input, receipt) {
  const task = await loadTask(context, taskId);
  if (input?.expectedRevision !== task.revision) throw new CoreError(409, 'revision_conflict', 'The task changed since it was read.');
  const actor = context.principal?.unitId;
  if (!actor) throw new CoreError(403, 'forbidden', 'The actor is not bound.');
  const authority = reviewAuthority(task);
  const leadApproval = input?.leadApproval === true;
  let nextStatus = input?.status;
  if (leadApproval) {
    if (actor !== task.leadId || task.status !== 'review') throw new CoreError(403, 'forbidden', 'Only the current lead can approve this review.');
    nextStatus = 'review';
  } else if (nextStatus === task.status) {
    throw new CoreError(409, 'status_unchanged', 'The task is already in that status.');
  } else if (!EDGES.has(`${task.status}>${nextStatus}`)) {
    throw new CoreError(422, 'invalid_transition', 'That status transition is not allowed.');
  } else if (!permitted(task, authority, actor, nextStatus)) {
    throw new CoreError(403, 'forbidden', 'The actor cannot make that transition.');
  }
  const note = typeof input?.note === 'string' ? input.note : '';
  if (/[\r\n\u0000]/.test(note) || note.length > 4000) throw new CoreError(422, 'invalid_body', 'The note must be a single line.');
  if (task.status === 'review' && nextStatus === 'open' && note.trim() === '') throw new CoreError(422, 'note_required', 'Sending a task back needs a note.');
  const line = leadApproval ? `Approved for review by ${task.leadUnit} on ${localDate(context)}` : auditLine(context, actor, note || nextStatus);
  const next = appendAudit(replaceHeader(task.bytes, 'status', nextStatus), line);
  const delivery = task.status === 'open' && nextStatus === 'review';
  return commitChange(context, task, {
    kind: 'status',
    previousStatus: task.status,
    status: nextStatus,
    note: leadApproval ? line : note,
    undoOf: null,
    bytes: next,
    delivery,
    receipt,
    events: [{ name: 'task.changed', data: { task: { id: task.id, status: nextStatus, reviewable: reviewAuthority({ ...task, status: nextStatus, bytes: next, body: next.toString('utf8') }).reviewable }, changeId: null, undoOf: null } }],
  });
}

function permitted(task, authority, actor, next) {
  const edge = `${task.status}>${next}`;
  const assignee = actor === task.toId;
  const lead = Boolean(task.leadId) && actor === task.leadId;
  const master = actor === 'root:master';
  const requester = actor === authority.requesterId;
  if (edge === 'open>review') return assignee || lead || (master && requester);
  if (edge === 'review>done') return master && authority.reviewable && !assignee;
  if (edge === 'review>open') return lead || (master && requester);
  if (edge === 'done>closed') return requester || lead || (master && requester);
  if (edge === 'closed>open') return requester || assignee || lead || (master && requester);
  return false;
}

async function commitChange(context, task, change) {
  const id = randomUUID();
  const after = change.bytes;
  const record = {
    format: 'hivem1nd-task-change-v1',
    id,
    kind: change.kind,
    taskId: task.id,
    actor: context.principal.unitId,
    machine: context.paths.machine,
    at: new Date(nextInstant(context)).toISOString(),
    previousStatus: change.previousStatus,
    status: change.status,
    beforeRevision: task.revision,
    afterRevision: hashBytes(after),
    note: change.note ?? '',
    undoOf: change.undoOf,
  };
  const relative = `user/relay/task-undo/${Buffer.from(task.id).toString('base64url')}/${id}.json`;
  const entries = [
    { resource: task.relative, recordPath: absolute(context, task.relative), beforeRevision: task.revision, afterBytes: after },
    { resource: relative, recordPath: absolute(context, relative), beforeRevision: null, afterBytes: jsonBytes(record) },
  ];
  const stage = [
    { target: { kind: 'mind', path: task.relative }, bytes: after },
    { target: { kind: 'mind', path: relative }, bytes: jsonBytes(record) },
  ];
  if (change.delivery) {
    const chat = await createChat(context, { members: [task.toId] });
    const notice = `user/relay/chats/${chat.chat.id}/notices/${Buffer.from(`${task.id}:${record.afterRevision}`).toString('base64url')}.md`;
    const body = Buffer.from(`id: ${id}\nkind: task-notice\ntask-id: ${task.id}\nstatus: ${change.status}\nreviewable: ${reviewAuthority({ ...task, status: change.status, body: after.toString('utf8'), bytes: after }).reviewable}\nrevision: ${record.afterRevision}\n\n${task.id}\n`);
    if (!(await readBytes(context.store, absolute(context, notice)))) {
      entries.push({ resource: notice, recordPath: absolute(context, notice), beforeRevision: null, afterBytes: body });
      stage.push({ target: { kind: 'mind', path: notice }, bytes: body });
    }
  }
  const events = change.events.map((event) => ({ ...event, data: { ...event.data, changeId: event.data.undoOf ? id : id, undoOf: change.undoOf } }));
  const transaction = {
    id: randomUUID(),
    entries,
    events: [],
    receipt: change.receipt ?? null,
    response: { status: 200, body: { taskId: task.id, status: change.status, changeId: id, revision: record.afterRevision, undoOf: change.undoOf } },
  };
  const result = await commitTransaction(context.store, transaction);
  const sync = openSync({ store: context.store, paths: context.paths, now: () => context.now() });
  await stageTransaction(sync, stage);
  for (const event of events) context.store.events.push(event);
  return { ...result, replayed: false, body: transaction.response.body };
}

function describe(bytes, relative, expectedId, aliases) {
  const headers = headerMap(bytes);
  const rawId = headers.get('id') || headers.get('task-id');
  if (!rawId) return null;
  let parsed;
  try {
    parsed = parseTaskId(rawId);
  } catch {
    return null;
  }
  if (expectedId && parsed.id !== expectedId) return null;
  return {
    id: parsed.id,
    status: headers.get('status'),
    from: headers.get('from') || '',
    fromId: headers.get('from-id') || '',
    toId: headers.get('to-id') || null,
    aliases,
    bytes,
    body: bytes.toString('utf8'),
    relative,
    revision: hashBytes(bytes),
  };
}

async function assigneeLead(context, unitId) {
  if (!unitId) return { leadId: null, leadUnit: null };
  let parsed;
  try {
    parsed = parseUnitId(unitId);
  } catch {
    return { leadId: null, leadUnit: null };
  }
  const bytes = await readBytes(context.store, path.join(context.paths.mind, 'user', 'state', `${parsed.unit}.md`));
  if (!bytes) return { leadId: null, leadUnit: null };
  const headers = headerMap(bytes);
  const leadId = headers.get('lead-id') || null;
  let leadUnit = headers.get('lead') || null;
  if (!leadUnit && leadId) {
    try {
      leadUnit = parseUnitId(leadId).unit;
    } catch {
      leadUnit = leadId;
    }
  }
  return { leadId, leadUnit };
}

async function changeRecords(context, taskId) {
  const directory = absolute(context, `user/relay/task-undo/${Buffer.from(taskId).toString('base64url')}`);
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const name of names) {
    const bytes = await readBytes(context.store, path.join(directory, name));
    if (bytes) records.push(JSON.parse(bytes.toString('utf8')));
  }
  return records;
}

function requesterOf(task, aliases) {
  const candidates = [task.fromId, task.from].filter(Boolean);
  for (const value of candidates) {
    if (value === 'root:master' || isPersonAlias(value, aliases)) return 'root:master';
  }
  return task.fromId || null;
}

function appendAudit(bytes, line) {
  const ending = bytes.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const text = bytes.toString('utf8');
  const at = text.indexOf('## Report');
  if (at < 0) {
    const lead = text.endsWith('\n') ? '' : ending;
    return Buffer.from(`${text}${lead}## Report${ending}${line}${ending}`, 'utf8');
  }
  const relative = text.slice(at + '## Report'.length).search(/\r?\n## /);
  if (relative < 0) {
    const lead = text.endsWith('\n') ? '' : ending;
    return Buffer.from(`${text}${lead}${line}${ending}`, 'utf8');
  }
  const insert = at + '## Report'.length + relative;
  return Buffer.from(`${text.slice(0, insert)}${ending}${line}${text.slice(insert)}`, 'utf8');
}

function auditLine(context, actor, note) {
  let name = 'master';
  try {
    name = parseUnitId(actor).unit;
  } catch {
    name = actor;
  }
  return `${name} on ${localDate(context)}: ${note}`;
}

function localDate(context) {
  return new Date(context.now()).toISOString().slice(0, 10);
}

function nextInstant(context) {
  const now = context.now();
  context.store.taskInstant = Math.max(now, (context.store.taskInstant ?? now) + 1);
  return context.store.taskInstant;
}

function headerMap(bytes) {
  const text = bytes.toString('utf8');
  const end = text.search(/\r?\n\r?\n/);
  const headers = new Map();
  for (const line of text.slice(0, end < 0 ? text.length : end).split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return headers;
}

function byRecord(left, right) {
  const delta = Date.parse(left.at) - Date.parse(right.at);
  if (delta !== 0) return delta;
  return left.id < right.id ? -1 : 1;
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`);
}

function absolute(context, relative) {
  return path.join(context.paths.mind, ...relative.split('/'));
}
