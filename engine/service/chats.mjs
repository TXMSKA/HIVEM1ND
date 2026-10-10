import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CoreError, canonicalJson, hashBytes, inboxDirectory, parseUnitId, uuidV8 } from './identity.mjs';
import { publishDomainEvents } from './events.mjs';
import { admitMessage } from '../sync/limits.mjs';
import { commitTransaction, readBytes, revisionOf } from './store.mjs';
import { openSync, stageTransaction } from '../sync/store.mjs';

const RECORD_MAX = 1000000;
const MEMBER_MAX = 256;

export async function createChat(context, input) {
  const selected = uniqueIds(input?.members ?? []);
  if (selected.length < 1 || selected.length > MEMBER_MAX) throw new CoreError(422, 'invalid_members', 'A chat needs from 1 to 256 units.');
  const members = [...new Set(['root:master', ...selected])].sort();
  if (members.length > MEMBER_MAX) throw new CoreError(422, 'invalid_members', 'A chat can include at most 256 members.');
  for (const id of selected) {
    if (!(await unitExists(context, id))) throw new CoreError(422, 'invalid_members', 'A chat member does not exist.');
  }
  const direct = selected.length === 1;
  const id = direct ? uuidV8(['direct-chat', members]) : randomUUID();
  const existing = await readBytes(context.store, chatPath(context, id));
  if (existing) return { status: 200, chat: parseChat(existing, id), created: false };
  const title = input.title ?? (direct ? parseUnitId(selected[0]).unit : members.filter((item) => item !== 'root:master').join(', ').slice(0, 240));
  const bytes = Buffer.from(`id: ${id}\ntitle: ${title}\nmembers: ${canonicalJson(members)}\npinned: false\nlisted: true\ncreated: ${stamp(context)}\ncreated-by: ${author(context)}\nkind: ${direct ? 'direct' : 'group'}\n\n`);
  await commitOne(context, `user/relay/chats/${id}/chat.md`, null, bytes, [
    { name: 'chat.changed', data: { chat: parseChat(bytes, id) } },
    { name: 'view.changed', data: { revision: hashBytes(bytes), collections: ['chats'] } },
  ]);
  return { status: 201, chat: parseChat(bytes, id), created: true };
}

export async function patchChat(context, chatId, input) {
  const hasPinned = Object.prototype.hasOwnProperty.call(input ?? {}, 'pinned');
  const hasListed = Object.prototype.hasOwnProperty.call(input ?? {}, 'listed');
  if (!hasPinned && !hasListed) throw new CoreError(422, 'invalid_body', 'A chat patch needs pinned or listed.');
  const relative = `user/relay/chats/${chatId}/chat.md`;
  const current = await readBytes(context.store, absolute(context, relative));
  if (!current) throw new CoreError(404, 'chat_not_found', 'The chat does not exist.');
  let next = current;
  if (hasPinned) next = replaceLine(next, 'pinned', input.pinned === true ? 'true' : 'false');
  if (hasListed) next = replaceLine(next, 'listed', input.listed === true ? 'true' : 'false');
  await commitOne(context, relative, input.expectedRevision, next, [
    { name: 'chat.changed', data: { chat: parseChat(next, chatId) } },
  ]);
  return { chat: parseChat(next, chatId) };
}

export async function postChat(context, chatId, input) {
  const chat = await loadChat(context, chatId);
  const fromId = author(context);
  if (!chat.members.includes(fromId) && context.principal?.audience !== 'desktop') {
    throw new CoreError(403, 'not_chat_member', 'The author is not a member of this chat.');
  }
  const message = await buildMessage(context, input, { toId: `chat:${chatId}`, threadId: chatId, destination: 'chat' });
  if (input?.replyTo) {
    const reply = await readBytes(context.store, absolute(context, `user/relay/chats/${chatId}/${input.replyTo}.md`));
    if (!reply) throw new CoreError(422, 'invalid_reply', 'The reply target is not in this chat.');
  }
  const notices = fanoutFor(message, chat.members, fromId);
  const relative = `user/relay/chats/${chatId}/${message.id}.md`;
  const fanout = `user/relay/fanout/${message.id}.json`;
  const fanoutBytes = Buffer.from(`${canonicalJson({ format: 'hivem1nd-fanout-v1', messageId: message.id, notices })}\n`);
  await charge(context, message.id, message.bytes);
  await commitMany(context, [
    { relative, before: null, bytes: message.bytes },
    { relative: fanout, before: null, bytes: fanoutBytes },
  ], [
    { name: 'message.created', data: { chatId, mailboxId: null, message: message.projected } },
    ...notices.map((notice) => ({ name: 'notification.changed', data: { noticeKey: notice.key, unitId: notice.unitId, resourceId: message.id, state: 'pending', error: null } })),
    { name: 'chat.changed', data: { chat } },
  ]);
  const delivered = await deliverNotifications(context);
  const mine = delivered.filter((notice) => notice.key?.startsWith(`${message.id}:`));
  return { message: message.projected, notifications: mine.map((notice) => ({ unitId: notice.unitId, state: notice.state, error: notice.error ?? null })) };
}

export async function postMailbox(context, unitId, input) {
  parseUnitId(unitId);
  const message = await buildMessage(context, input, { toId: unitId, threadId: input?.replyTo ?? null, destination: 'mailbox' });
  const file = `${inboxDirectory(parseUnitId(unitId))}/${fileStamp(context)}-${context.paths.machine}-${message.id}.md`;
  await charge(context, message.id, message.bytes);
  await commitOne(context, file, null, message.bytes, [
    { name: 'message.created', data: { chatId: null, mailboxId: unitId, message: message.projected } },
  ]);
  return { message: message.projected };
}

export async function readChat(context, chatId, input) {
  const chat = await loadChat(context, chatId);
  const reader = author(context);
  if (!chat.members.includes(reader) && context.principal?.audience !== 'desktop') {
    throw new CoreError(403, 'not_chat_member', 'The reader is not a member of this chat.');
  }
  const ids = requireIds(input?.messageIds);
  for (const id of ids) {
    if (!(await readBytes(context.store, absolute(context, `user/relay/chats/${chatId}/${id}.md`)))) {
      throw new CoreError(404, 'message_not_found', 'A message in the receipt does not exist.');
    }
  }
  const receiptId = randomUUID();
  const record = { format: 'hivem1nd-chat-read-v1', chatId, unitId: reader, machine: context.paths.machine, messageIds: ids, at: stamp(context) };
  const relative = `user/relay/chats/${chatId}/read/${Buffer.from(reader).toString('base64url')}/${context.paths.machine}/${receiptId}.json`;
  await commitOne(context, relative, null, Buffer.from(`${canonicalJson(record)}\n`), [
    { name: 'message.read', data: { chatId, mailboxId: null, readerId: reader, messageIds: ids, unread: await unreadChat(context, chatId, reader, ids) } },
  ]);
  return { chatId, readIds: ids, unread: await unreadChat(context, chatId, reader, ids) };
}

export async function readMailbox(context, unitId, input) {
  const parsed = parseUnitId(unitId);
  if (context.principal?.audience === 'agent' && author(context) !== parsed.id) throw new CoreError(403, 'forbidden', 'An agent reads only its own mailbox.');
  if (context.principal?.audience === 'phone' && parsed.id !== 'root:master') throw new CoreError(403, 'forbidden', 'Phone reads only the master mailbox.');
  const ids = requireIds(input?.messageIds);
  const found = [];
  for (const id of ids) {
    const match = await findInbox(context, parsed, id);
    if (!match) throw new CoreError(404, 'message_not_found', 'A mailbox message does not exist.');
    found.push(match);
  }
  const alreadyReadIds = [];
  const moving = [];
  for (const item of found) {
    const archive = archivePath(context, parsed.id, item.name);
    const current = await readBytes(context.store, absolute(context, archive));
    if (current && !current.equals(item.bytes)) throw new CoreError(409, 'archive_collision', 'The archived message does not match the inbox copy.');
    if (current && current.equals(item.bytes)) alreadyReadIds.push(item.id);
    else moving.push(item);
  }
  if (moving.length === 0) return { unitId: parsed.id, readIds: [], alreadyReadIds };
  const batchId = randomUUID();
  const entries = moving.map((item) => ({
    relative: archivePath(context, parsed.id, item.name),
    before: null,
    bytes: item.bytes,
  }));
  const journal = {
    format: 'hivem1nd-mailbox-read-v1',
    id: batchId,
    unitId: parsed.id,
    sources: moving.map((item) => item.relative),
    archives: entries.map((item) => item.relative),
  };
  entries.push({ relative: `user/relay/mailbox-reads/${batchId}.json`, before: null, bytes: Buffer.from(`${canonicalJson(journal)}\n`) });
  await commitMany(context, entries, [
    { name: 'message.read', data: { chatId: null, mailboxId: parsed.id, readerId: author(context), messageIds: moving.map((item) => item.id), unread: 0 } },
  ]);
  await removeSources(context, moving.map((item) => item.relative));
  return { unitId: parsed.id, readIds: moving.map((item) => item.id), alreadyReadIds };
}

export async function queueNotice(context, notice) {
  const key = `${notice.messageId}:${notice.unitId}`;
  const relative = `user/relay/fanout/${notice.messageId}.json`;
  const current = await readBytes(context.store, absolute(context, relative));
  const parsed = current ? JSON.parse(current.toString('utf8')) : { format: 'hivem1nd-fanout-v1', messageId: notice.messageId, notices: [] };
  const existing = parsed.notices.find((item) => item.key === key);
  if (existing) return existing;
  parsed.notices.push({ key, unitId: notice.unitId, state: notice.state ?? 'pending', resourceId: notice.resourceId ?? notice.messageId });
  await commitOne(context, relative, current ? revisionOf(current) : null, Buffer.from(`${canonicalJson(parsed)}\n`), [
    { name: 'notification.changed', data: { noticeKey: key, unitId: notice.unitId, resourceId: notice.resourceId ?? notice.messageId, state: notice.state ?? 'pending', error: null } },
  ]);
  return parsed.notices.at(-1);
}

export async function recoverNotifications(context) {
  const directory = path.join(context.paths.mind, 'user', 'relay', 'fanout');
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const pending = [];
  for (const name of names) {
    const bytes = await readBytes(context.store, path.join(directory, name));
    if (!bytes) continue;
    const parsed = JSON.parse(bytes.toString('utf8'));
    for (const notice of parsed.notices ?? []) {
      if (notice.state === 'pending') pending.push(notice);
    }
  }
  return pending;
}

export async function deliverNotifications(context) {
  const directory = path.join(context.paths.mind, 'user', 'relay', 'fanout');
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const results = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const relative = `user/relay/fanout/${name}`;
    const bytes = await readBytes(context.store, absolute(context, relative));
    if (!bytes) continue;
    const parsed = JSON.parse(bytes.toString('utf8'));
    let changed = false;
    for (const notice of parsed.notices ?? []) {
      if (notice.state === 'submitted' || notice.state === 'ambiguous') {
        results.push(notice);
        continue;
      }
      const outcome = await attemptNotice(context, notice);
      if (outcome.state !== notice.state || outcome.error !== (notice.error ?? null)) {
        notice.state = outcome.state;
        notice.error = outcome.error;
        changed = true;
      }
      await rememberNotice(context, notice);
      results.push({ ...notice });
    }
    if (changed) {
      await commitOne(context, relative, revisionOf(bytes), Buffer.from(`${canonicalJson(parsed)}\n`), [
        { name: 'notification.changed', data: { messageId: parsed.messageId, state: 'updated' } },
      ]);
    }
  }
  return results;
}

async function attemptNotice(context, notice) {
  if (typeof context.wake?.notify !== 'function') return { state: 'pending', error: 'transport_unavailable' };
  try {
    const outcome = await context.wake.notify(notice);
    if (outcome?.state === 'submitted' || outcome?.state === 'ambiguous' || outcome?.state === 'failed' || outcome?.state === 'pending') {
      return { state: outcome.state, error: outcome.error ?? null };
    }
    return { state: 'failed', error: 'delivery_failed' };
  } catch (error) {
    return { state: 'failed', error: error?.code || 'delivery_failed' };
  }
}

async function rememberNotice(context, notice) {
  const relative = `user/relay/notices/${Buffer.from(notice.key).toString('base64url')}.json`;
  if (await readBytes(context.store, absolute(context, relative))) return;
  const record = {
    format: 'hivem1nd-notice-v1',
    key: notice.key,
    messageId: notice.resourceId ?? notice.key.split(':')[0],
    recipientId: notice.unitId,
    state: notice.state,
    error: notice.error ?? null,
  };
  await commitOne(context, relative, null, Buffer.from(`${canonicalJson(record)}\n`), [
    { name: 'notification.changed', unitId: notice.unitId, data: { noticeKey: notice.key, unitId: notice.unitId, state: notice.state, error: notice.error ?? null } },
  ]);
}

export async function recoverMailboxReads(context) {
  const directory = path.join(context.paths.mind, 'user', 'relay', 'mailbox-reads');
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const done = [];
  for (const name of names) {
    const bytes = await readBytes(context.store, path.join(directory, name));
    if (!bytes) continue;
    const journal = JSON.parse(bytes.toString('utf8'));
    await removeSources(context, journal.sources ?? []);
    done.push(journal.id);
  }
  return done;
}

async function buildMessage(context, input, target) {
  const body = typeof input?.body === 'string' ? input.body : '';
  const subject = typeof input?.subject === 'string' ? input.subject : '';
  const attachments = Array.isArray(input?.attachments) ? input.attachments : [];
  if (attachments.length > 64) throw new CoreError(422, 'invalid_body', 'A message can include at most 64 attachments.');
  if (!body && !subject && attachments.length === 0) throw new CoreError(422, 'invalid_body', 'A message needs a body, subject, or attachment.');
  if (body.length > 100000) throw new CoreError(413, 'message_too_large', 'The message exceeds 1000000 bytes.');
  const id = randomUUID();
  const fromId = author(context);
  const lines = [
    `id: ${id}`,
    `from: ${parseUnitId(fromId).unit}`,
    `from-id: ${fromId}`,
    `to-id: ${target.toId}`,
    `machine: ${context.paths.machine}`,
    `timestamp: ${stamp(context)}`,
    `priority: ${input?.priority === 'urgent' ? 'urgent' : 'normal'}`,
    `subject: ${subject}`,
    `thread-id: ${target.threadId ?? id}`,
    `reply-to: ${input?.replyTo ?? ''}`,
    `reply-requested: ${input?.replyRequested === true ? 'true' : 'false'}`,
    `attachments: ${canonicalJson(attachments)}`,
    'kind: message',
  ];
  const bytes = Buffer.from(`${lines.join('\n')}\n\n${body}`);
  if (bytes.length > RECORD_MAX) throw new CoreError(413, 'message_too_large', 'The message exceeds 1000000 bytes.');
  return {
    id,
    bytes,
    projected: {
      id, fromId, toId: target.toId, machine: context.paths.machine, timestamp: stamp(context), date: null,
      priority: input?.priority === 'urgent' ? 'urgent' : 'normal', subject, body, threadId: target.threadId ?? id,
      replyTo: input?.replyTo ?? null, replyRequested: input?.replyRequested === true, attachments, kind: 'message', read: false, notice: null,
    },
  };
}

function fanoutFor(message, members, fromId) {
  return members.filter((id) => id !== fromId).map((unitId) => ({
    key: `${message.id}:${unitId}`,
    unitId,
    state: 'pending',
    resourceId: message.id,
  }));
}

async function charge(context, id, bytes) {
  if (!context.ledger) throw new CoreError(503, 'service_unavailable', 'Message admission is not composed.');
  await admitMessage(context.ledger, { id, record: bytes });
}

async function commitOne(context, relative, before, bytes, events) {
  await commitMany(context, [{ relative, before, bytes }], events);
}

async function commitMany(context, entries, events) {
  await commitTransaction(context.store, {
    id: randomUUID(),
    entries: entries.map((entry) => ({
      resource: entry.relative,
      recordPath: absolute(context, entry.relative),
      beforeRevision: entry.before,
      afterBytes: entry.bytes,
    })),
    events: [],
  });
  const sync = context.sync ?? openSync({ store: context.store, paths: context.paths, now: () => context.now() });
  const changes = await stageTransaction(sync, entries.map((entry) => ({ target: { kind: 'mind', path: entry.relative }, bytes: entry.bytes })));
  if (context.pulse) await context.pulse.changed(changes.map((change) => change.id));
  publishDomainEvents(context, events);
}

async function loadChat(context, chatId) {
  const bytes = await readBytes(context.store, chatPath(context, chatId));
  if (!bytes) throw new CoreError(404, 'chat_not_found', 'The chat does not exist.');
  return parseChat(bytes, chatId);
}

function parseChat(bytes, id) {
  const headers = headerMap(bytes);
  return {
    id: headers.get('id') || id,
    title: headers.get('title') || '',
    kind: headers.get('kind') === 'group' ? 'group' : 'direct',
    members: JSON.parse(headers.get('members') || '[]'),
    pinned: headers.get('pinned') === 'true',
    listed: headers.get('listed') !== 'false',
    createdAt: headers.get('created') || null,
    revision: hashBytes(bytes),
  };
}

async function unreadChat(context, chatId, reader, extra = []) {
  const directory = path.join(context.paths.mind, 'user', 'relay', 'chats', chatId);
  const names = await readdir(directory);
  const read = new Set(extra);
  const receiptRoot = path.join(directory, 'read', Buffer.from(reader).toString('base64url'));
  await collectReceipts(receiptRoot, read);
  return names.filter((name) => name.endsWith('.md') && name !== 'chat.md' && !read.has(name.slice(0, -3))).length;
}

async function collectReceipts(directory, read) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectReceipts(full, read);
    else if (entry.name.endsWith('.json')) {
      const parsed = JSON.parse(await readFile(full, 'utf8'));
      for (const id of parsed.messageIds ?? []) read.add(id);
    }
  }
}

async function findInbox(context, parsed, id) {
  const dirs = [inboxDirectory(parsed), `user/inbox/${parsed.unit}`];
  for (const relativeDir of dirs) {
    const directory = path.join(context.paths.mind, ...relativeDir.split('/'));
    let names = [];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const relative = `${relativeDir}/${name}`;
      const bytes = await readBytes(context.store, absolute(context, relative));
      if (!bytes) continue;
      if (headerMap(bytes).get('id') === id) return { id, name, relative, bytes };
    }
  }
  return null;
}

async function removeSources(context, relatives) {
  for (const relative of relatives) {
    await unlink(absolute(context, relative)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}

async function unitExists(context, id) {
  if (id === 'root:master') return true;
  const parsed = parseUnitId(id);
  const bytes = await readBytes(context.store, path.join(context.paths.mind, 'user', 'state', `${parsed.unit}.md`));
  return Boolean(bytes && headerMap(bytes).get('unit-id') === parsed.id);
}

function author(context) {
  return context.principal?.unitId ?? 'root:master';
}

function uniqueIds(values) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) throw new CoreError(422, 'invalid_members', 'Chat members must be unique.');
  return values.map((id) => parseUnitId(id).id);
}

function requireIds(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 200) throw new CoreError(422, 'invalid_body', 'A read needs from 1 to 200 message ids.');
  return values;
}

function archivePath(context, unitId, name) {
  return `user/relay/archive/by-unit/${Buffer.from(unitId).toString('base64url')}/${name}`;
}

function chatPath(context, id) {
  return absolute(context, `user/relay/chats/${id}/chat.md`);
}

function absolute(context, relative) {
  return path.join(context.paths.mind, ...relative.split('/'));
}

function stamp(context) {
  return new Date(context.now()).toISOString();
}

function fileStamp(context) {
  return stamp(context).replace(/[-:]/g, '').replace('.000Z', '').replace('T', '-');
}

function replaceLine(bytes, name, value) {
  const text = bytes.toString('utf8');
  const next = text.replace(new RegExp(`^${name}:.*$`, 'm'), `${name}: ${value}`);
  return Buffer.from(next);
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

export async function ensureChatDir(context, id) {
  await mkdir(path.dirname(chatPath(context, id)), { recursive: true });
}
