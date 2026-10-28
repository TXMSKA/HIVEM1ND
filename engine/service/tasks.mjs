import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CoreError, canonicalTaskId, hashBytes, isPersonAlias, parseTaskId, parseUnitId, replaceHeader, taskDirectory, uuidV8 } from './identity.mjs';
import { publishDomainEvents } from './events.mjs';
import { canonicalJson } from './identity.mjs';
import { createChat } from './chats.mjs';
import { readUnitState, readUnitStates, stateHeader } from './state.mjs';
import { resolveUnit } from './identity.mjs';
import { atomicWrite, commitTransaction, readBytes, recoverTransactions, revisionOf, withLocalChanges, withLocks, withReceipt } from './store.mjs';
import { noteSync, openSync, stageTransaction } from '../sync/store.mjs';

const EDGES = new Set(['open>review', 'review>done', 'review>open', 'done>closed', 'closed>open']);

async function aliasesFor(context) {
  if (Array.isArray(context?.aliases)) return context.aliases;
  const { loadPersonAliases } = await import('./projection.mjs');
  return loadPersonAliases(context?.paths?.mind);
}

export async function loadTask(context, taskId) {
  const parsed = parseTaskId(taskId);
  const directories = [taskDirectory(parsed.scope)];
  if (directories[0] !== 'user/tasks') directories.push('user/tasks');
  let aliases;
  for (const relativeDir of directories) {
    const directory = path.join(context.paths.mind, ...relativeDir.split('/'));
    let names = [];
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith('.md') && !name.includes('.conflict-')).sort();
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const name of names) {
      const relative = `${relativeDir}/${name}`;
      const bytes = await readBytes(context.store, absolute(context, relative));
      if (!bytes) continue;
      const task = describe(bytes, relative, parsed.id, aliases ??= await aliasesFor(context));
      if (task?.id === parsed.id) {
        if (!task.toId && task.to) {
          const units = (await readUnitStates(context)).map(({ id }) => ({ unit: parseUnitId(id).unit, unitId: id, scope: parseUnitId(id).scope }));
          try { task.toId = resolveUnit(task.to, { units, scope: parsed.scope, aliases: task.aliases }).unitId; }
          catch (error) { if (!['unit_not_found', 'ambiguous_unit', 'invalid_unit', 'invalid_name'].includes(error?.code)) throw error; }
        }
        return { ...task, ...(await assigneeLead(context, task.toId)) };
      }
    }
  }
  throw new CoreError(404, 'task_not_found', 'The task does not exist.');
}

// Prepares new task files the way the /task command writes them (files.md): the next three-digit id of the
// assignee's scope folder, a slug from the first words, status open and the text as the Request section.
// Nothing is written here: the caller commits each entry inside its own transaction, so a rejected owner
// operation leaves no task behind. One allocator numbers every task of one operation without collision.
export function taskAllocator(context) {
  const counters = new Map();
  return async function prepare({ title, body = '', toId, clusterId = null, planId = null }) {
    const unit = parseUnitId(toId), directory = taskDirectory(unit.scope);
    if (!counters.has(directory)) {
      let names = [];
      try { names = await readdir(absolute(context, directory)); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      counters.set(directory, names.reduce((high, name) => Math.max(high, Number(name.match(/^(\d+)/)?.[1] ?? 0)), 0) + 1);
    }
    const number = counters.get(directory); counters.set(directory, number + 1);
    const digits = String(number).padStart(3, '0'), id = `${unit.scope.id}:${digits}`, text = String(title).trim();
    const slug = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6).join('-').slice(0, 48).replace(/-+$/, '') || 'task';
    const relative = `${directory}/${digits}-${slug}.md`;
    const headers = [`id: ${digits}`, `task-id: ${id}`, `title: ${text}`, 'status: open', 'from: master', 'from-id: root:master', `to: ${unit.unit}`, `to-id: ${toId}`,
      `date: ${localStamp(context)}`, ...(clusterId ? [`cluster-id: ${clusterId}`] : []), ...(planId ? [`plan-id: ${planId}`] : [])];
    const bytes = Buffer.from(`${headers.join('\n')}\n\n## Request\n${String(body).trim() || text}\n\n## Report\n`, 'utf8');
    const parsed = parseTaskId(id);
    const record = describe(bytes, relative, parsed.id, await aliasesFor(context));
    return { record: { ...record, ...(await assigneeLead(context, toId)) },
      entry: { resource: relative, recordPath: absolute(context, relative), beforeRevision: null, afterBytes: bytes } };
  };
}

function localStamp(context) {
  const date = new Date(context.now()), two = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function reportSection(body) {
  const text = String(body ?? '');
  const at = text.indexOf('## Report');
  if (at < 0) return '';
  const rest = text.slice(at + '## Report'.length);
  const next = rest.search(/\r?\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

export function leadApproved(body, leadName, date) {
  if (!leadName || !/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/.test(date || '')) return false;
  return reportSection(body).includes(`Approved for review by ${leadName} on ${date}`);
}

export function reviewAuthority(task) {
  const requesterId = requesterOf(task, task.aliases ?? []);
  // The person accepts a delivery whoever wrote the task, the Overseer for them included; a lead approves first.
  const reviewable = Boolean(task.toId) && task.status === 'review' && (!task.leadId || leadApproved(task.body, task.leadUnit || '', task.date));
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
    const prior = { ...task, status: latest.previousStatus };
    if (!permitted(prior, reviewAuthority(prior), latest.actor, task.status)) throw new CoreError(403, 'forbidden', 'That status change cannot be undone.');
    const next = appendAudit(replaceHeader(task.bytes, 'status', latest.previousStatus), auditLine(context, actor, 'Undone.'));
    return commitChange(context, task, {
      kind: 'undo',
      previousStatus: task.status,
      status: latest.previousStatus,
      note: 'Undone.',
      undoOf: latest.id,
      bytes: next,
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
  } else if (!permitted(task, authority, actor, nextStatus, await actorRole(context, actor, `${task.status}>${nextStatus}`))) {
    throw new CoreError(403, 'forbidden', 'The actor cannot make that transition.');
  }
  const note = typeof input?.note === 'string' ? input.note : '';
  if (/[\r\n\u0000]/.test(note) || note.length > 4000) throw new CoreError(422, 'invalid_body', 'The note must be a single line.');
  if (task.status === 'review' && nextStatus === 'open' && note.trim() === '') throw new CoreError(422, 'note_required', 'Sending a task back needs a note.');
  const line = leadApproval ? `Approved for review by ${task.leadUnit} on ${task.date}` : auditLine(context, actor, note || nextStatus);
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
  });
}

// Who may change a status, as the transitions table of files.md says.
function permitted(task, authority, actor, next, role = null) {
  const edge = `${task.status}>${next}`;
  const assignee = actor === task.toId;
  const lead = Boolean(task.leadId) && actor === task.leadId;
  const master = actor === 'root:master';
  const requester = actor === authority.requesterId;
  if (edge === 'open>review') return assignee || lead || master;
  if (edge === 'review>done') return master && authority.reviewable && !assignee;
  // The person sends back once the lead has approved, as with acceptance, so the lead's review comes first.
  if (edge === 'review>open') return lead || (master ? authority.reviewable : requester) || role === 'qa' && sameScope(actor, task.id);
  if (edge === 'done>closed') return requester;
  if (edge === 'closed>open') return requester;
  return false;
}

// Only sending a delivery back needs the role of the unit asking: the QA unit of the task's project may.
async function actorRole(context, actor, edge) {
  if (edge !== 'review>open' || actor === 'root:master') return null;
  try {
    const state = await readUnitState(context, parseUnitId(actor));
    return state ? stateHeader(state.bytes, 'role') : null;
  } catch { return null; }
}

function sameScope(actor, taskId) {
  try { return parseUnitId(actor).scope?.id === parseTaskId(taskId).scope.id; } catch { return false; }
}

async function commitChange(context, task, change) {
  return withLocalChanges(context.store, () => commitChangeLocked(context, task, change));
}

async function commitChangeLocked(context, task, change) {
  const id = randomUUID();
  const after = change.bytes;
  const record = {
    format: 'hivem1nd-task-change-v1', // Compatibility: persisted format and contract identifiers keep existing records and peers readable.
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
    const notice = `user/relay/chats/${chat.chat.id}/${Buffer.from(`${task.id}:${record.afterRevision}`).toString('base64url')}.md`;
    const reviewable = reviewAuthority({ ...task, status: change.status, body: after.toString('utf8'), bytes: after, date: task.date }).reviewable;
    const body = Buffer.from(`id: ${id}\nfrom: master\nfrom-id: root:master\nto: ${parseUnitId(task.toId).unit}\nto-id: ${task.toId}\nmachine: ${context.paths.machine}\ntimestamp: ${record.at}\npriority: normal\nsubject: ${task.id}\nthread-id: ${chat.chat.id}\nreply-to: \nreply-requested: false\nattachments: []\nkind: task-notice\ntask-id: ${task.id}\nstatus: ${change.status}\nreviewable: ${reviewable}\nrevision: ${record.afterRevision}\n\n${task.id}\n`);
    if (!(await readBytes(context.store, absolute(context, notice)))) {
      entries.push({ resource: notice, recordPath: absolute(context, notice), beforeRevision: null, afterBytes: body });
      stage.push({ target: { kind: 'mind', path: notice }, bytes: body });
    }
  }
  const transaction = {
    id: randomUUID(),
    entries,
    events: [],
    receipt: change.receipt ?? null,
    response: { status: 200, body: null },
  };
  await commitTransaction(context.store, transaction);
  const sync = context.sync ?? openSync({
    store: context.store,
    paths: context.paths,
    now: () => context.now?.() ?? Date.now(),
    projects: context.projects ?? [],
  });
  const changes = await stageTransaction(sync, stage.map((entry) => ({
    ...entry,
    id: uuidV8(['task-change', transaction.id, entry.target.kind, entry.target.path, hashBytes(entry.bytes)]),
  })), { transactionId: transaction.id });
  noteSync(context, changes.length ? 'pending' : 'local');
  if (context.pulse) {
    const published = await context.pulse.changed(changes.map((item) => item.id));
    if (published?.published === true) noteSync(context, 'published');
  }
  const { readDetail } = await import('./projection.mjs');
  const projected = await readDetail(context, 'tasks', task.id);
  const documented = { task: projected, changeId: id };
  publishDomainEvents(context, [{ name: 'task.changed', data: { task: projected, changeId: id, undoOf: change.undoOf } }]);
  if (change.kind === 'undo') documented.undoOf = change.undoOf;
  if (change.receipt?.principalHash && change.receipt.key) {
    change.receipt.status = 200;
    change.receipt.response = documented;
    await atomicWrite(context.store, path.join(context.store.localDirectory, 'receipts', change.receipt.principalHash, `${change.receipt.key}.json`), Buffer.from(`${canonicalJson({ ...change.receipt, status: 200, response: documented })}\n`));
  }
  return documented;
}

function describe(bytes, relative, expectedId, aliases) {
  const headers = headerMap(bytes);
  const rawId = headers.get('id') || headers.get('task-id') || '';
  let parsed;
  try {
    parsed = parseTaskId(canonicalTaskId(rawId, relative));
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
    to: headers.get('to') || '',
    date: headers.get('date') || '',
    planId: headers.get('plan-id') || null,
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
  const bytes = (await readUnitState(context, parsed))?.bytes;
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
