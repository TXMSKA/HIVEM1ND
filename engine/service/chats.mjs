import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CoreError, canonicalJson, hashBytes, inboxDirectory, parseUnitId, uuidV8 } from './identity.mjs';
import { publishDomainEvents } from './events.mjs';
import { readUnitState } from './state.mjs';
import { admitMessage } from '../sync/limits.mjs';
import { commitTransaction, readBytes, revisionOf, withLocalChanges } from './store.mjs';
import { noteSync, openSync, stageTransaction } from '../sync/store.mjs';

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
  if (existing) {
    const current = parseChat(existing, id);
    if (direct && current.listed === false) {
      const next = replaceLine(existing, 'listed', 'true');
      let chat;
      await commitOne(context, `user/relay/chats/${id}/chat.md`, hashBytes(existing), next, async () => {
        chat = await storedChat(context, id);
        return [{ name: 'chat.changed', data: { chat } }];
      });
      return { status: 200, chat, created: false };
    }
    return { status: 200, chat: await storedChat(context, id), created: false };
  }
  const title = input.title ?? (direct ? parseUnitId(selected[0]).unit : members.filter((item) => item !== 'root:master').join(', ').slice(0, 240));
  const bytes = Buffer.from(`id: ${id}\ntitle: ${title}\nmembers: ${canonicalJson(members)}\npinned: false\nlisted: true\ncreated: ${stamp(context)}\ncreated-by: ${author(context)}\nkind: ${direct ? 'direct' : 'group'}\n\n`);
  let chat;
  await commitOne(context, `user/relay/chats/${id}/chat.md`, null, bytes, async () => {
    chat = await storedChat(context, id);
    return [
      { name: 'chat.changed', data: { chat } },
      { name: 'view.changed', data: { revision: hashBytes(bytes), collections: ['chats'] } },
    ];
  });
  return { status: 201, chat, created: true };
}

export async function patchChat(context, chatId, input) {
  if (await readBytes(context.store, absolute(context, `user/gui/groups/${chatId}.json`))) {
    const { patchGroupChat } = await import('./groups.mjs');
    return patchGroupChat(context, chatId, input);
  }
  const hasPinned = Object.prototype.hasOwnProperty.call(input ?? {}, 'pinned');
  const hasListed = Object.prototype.hasOwnProperty.call(input ?? {}, 'listed');
  if (!hasPinned && !hasListed) throw new CoreError(422, 'invalid_body', 'A chat patch needs pinned or listed.');
  const relative = `user/relay/chats/${chatId}/chat.md`;
  const current = await readBytes(context.store, absolute(context, relative));
  if (!current) throw new CoreError(404, 'chat_not_found', 'The chat does not exist.');
  let next = current;
  if (hasPinned && typeof input.pinned !== 'boolean') throw new CoreError(422, 'invalid_body', 'Pinned must be a boolean.');
  if (hasListed && typeof input.listed !== 'boolean') throw new CoreError(422, 'invalid_body', 'Listed must be a boolean.');
  if (hasPinned) next = replaceLine(next, 'pinned', input.pinned ? 'true' : 'false');
  if (hasListed) next = replaceLine(next, 'listed', input.listed ? 'true' : 'false');
  let chat;
  await commitOne(context, relative, input.expectedRevision, next, async () => {
    chat = await storedChat(context, chatId);
    return [{ name: 'chat.changed', data: { chat } }];
  });
  return { chat };
}

export async function postChat(context, chatId, input) {
  const chat = await loadChat(context, chatId);
  const fromId = author(context);
  if (!chat.members.includes(fromId) && context.principal?.audience !== 'desktop') {
    throw new CoreError(403, 'not_chat_member', 'The author is not a member of this chat.');
  }
  const message = await buildMessage(context, input, {
    toId: `chat:${chatId}`,
    threadId: chatId,
    destination: 'chat',
    legacyTo: 'chat',
    place: (id) => `user/relay/chats/${chatId}/${id}.md`,
  });
  if (input?.replyTo) {
    const reply = (await chatRecords(context, chatId)).find((item) => item.id === input.replyTo);
    if (!reply) throw new CoreError(422, 'invalid_reply', 'The reply target is not in this chat.');
  }
  const notices = fanoutFor(message, chat.members, fromId);
  const relative = `user/relay/chats/${chatId}/${message.id}.md`;
  const fanout = `user/relay/fanout/${message.id}.json`;
  const fanoutBytes = Buffer.from(`${canonicalJson({ format: 'hivem1nd-fanout-v1', messageId: message.id, notices })}\n`);
  await charge(context, message.id, message.bytes);
  context.receiptBody = { message: message.projected, notifications: notices.map(({ unitId, state }) => ({ unitId, state })) };
  context.receiptStatus = 201;
  await commitMany(context, [
    { relative, before: null, bytes: message.bytes },
    { relative: fanout, before: null, bytes: fanoutBytes },
  ], async () => [
    { name: 'message.created', data: { chatId, mailboxId: null, message: message.projected } },
    ...notices.map((notice) => ({ name: 'notification.changed', data: { noticeKey: notice.key, unitId: notice.unitId, resourceId: message.id, state: 'pending', error: null } })),
    { name: 'chat.changed', data: { chat: await storedChat(context, chatId) } },
  ]);
  const delivered = await deliverNotifications(context, message.id);
  const mine = delivered.filter((notice) => notice.key?.startsWith(`${message.id}:`));
  const { readDetail } = await import('./projection.mjs');
  return { message: await readDetail(context, 'messages', message.id, { chatId }), notifications: mine.map((notice) => ({ unitId: notice.unitId, state: notice.state, error: notice.error ?? null })) };
}

export async function postMailbox(context, unitId, input) {
  const recipient = parseUnitId(unitId);
  if (!(await unitExists(context, unitId))) throw new CoreError(422, 'unknown_unit', 'The recipient does not exist.');
  if (input?.replyTo) {
    const reply = await findInbox(context, recipient, input.replyTo);
    if (!reply) throw new CoreError(422, 'invalid_reply', 'The reply target is not in this mailbox.');
  }
  const message = await buildMessage(context, input, {
    toId: unitId,
    threadId: input?.replyTo ?? null,
    destination: 'mailbox',
    legacyTo: recipient.unit,
    units: [{ id: unitId, unit: recipient.unit, malformed: false }],
    place: (id) => `${inboxDirectory(recipient)}/${fileStamp(context)}-${context.paths.machine}-${id}.md`,
  });
  const file = message.relative;
  await charge(context, message.id, message.bytes);
  if (context.receipt) {
    context.receiptStatus = 201;
    context.receiptBody = message.projected;
  }
  const notices = fanoutFor(message, [unitId], author(context));
  await commitMany(context, [
    { relative: file, before: null, bytes: message.bytes },
    { relative: `user/relay/fanout/${message.id}.json`, before: null, bytes: Buffer.from(`${canonicalJson({ format: 'hivem1nd-fanout-v1', messageId: message.id, notices })}\n`) },
  ], [
    { name: 'message.created', data: { chatId: null, mailboxId: unitId, message: message.projected } },
  ]);
  if (notices.length) await deliverNotifications(context, message.id);
  const { readDetail } = await import('./projection.mjs');
  return { message: await readDetail(context, 'messages', message.id, { mailboxId: unitId }) };
}

export async function readChat(context, chatId, input) {
  const chat = await loadChat(context, chatId);
  const reader = author(context);
  if (!chat.members.includes(reader) && context.principal?.audience !== 'desktop') {
    throw new CoreError(403, 'not_chat_member', 'The reader is not a member of this chat.');
  }
  const ids = requireIds(input?.messageIds);
  const records = await chatRecords(context, chatId);
  for (const id of ids) {
    if (!records.some((item) => item.id === id)) {
      throw new CoreError(404, 'message_not_found', 'A message in the receipt does not exist.');
    }
  }
  const receiptId = randomUUID();
  const record = { format: 'hivem1nd-chat-read-v1', chatId, unitId: reader, machine: context.paths.machine, messageIds: ids, at: stamp(context) };
  const relative = `user/relay/chats/${chatId}/read/${Buffer.from(reader).toString('base64url')}/${context.paths.machine}/${receiptId}.json`;
  let deliveries;
  const unread = await unreadChat(context, chatId, reader, ids);
  await commitOne(context, relative, null, Buffer.from(`${canonicalJson(record)}\n`), async () => {
    const { readProjection } = await import('./projection.mjs');
    const messages = (await readProjection(context)).messages;
    deliveries = ids.map((messageId) => ({ messageId, delivery: messages.find((message) => message.id === messageId).delivery }));
    return [{ name: 'message.read', data: { chatId, mailboxId: null, readerId: reader, messageIds: ids, unread, deliveries } }];
  });
  return { chatId, readIds: ids, unread, deliveries };
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
    machine: context.paths.machine,
    sources: moving.map((item) => item.relative),
    archives: entries.map((item) => item.relative),
  };
  entries.push({ relative: `user/relay/mailbox-reads/${batchId}.json`, before: null, bytes: Buffer.from(`${canonicalJson(journal)}\n`) });
  const receipt = { format: 'hivem1nd-mailbox-receipt-v1', unitId: author(context), mailboxId: parsed.id, messageIds: moving.map((item) => item.id), at: stamp(context) };
  entries.push({ relative: `user/relay/archive/by-unit/${Buffer.from(parsed.id).toString('base64url')}/read/${batchId}.json`, before: null, bytes: Buffer.from(`${canonicalJson(receipt)}\n`) });
  for (const item of moving) {
    entries.push({
      relative: `user/relay/tombstones/${item.id}.json`,
      before: null,
      bytes: Buffer.from(`${canonicalJson({ format: 'hivem1nd-tombstone-v1', id: item.id, unitId: parsed.id, machine: context.paths.machine, source: item.relative })}\n`),
    });
  }
  const unread = Math.max(0, (await inboxCount(context, parsed)) - moving.length);
  await commitMany(context, entries, [
    { name: 'message.read', data: { chatId: null, mailboxId: parsed.id, readerId: author(context), messageIds: moving.map((item) => item.id), unread } },
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

export async function deliverNotifications(context, messageId = null) {
  return withLocalChanges(context.store, () => deliverNotificationsLocked(context, messageId));
}

async function deliverNotificationsLocked(context, messageId) {
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
    if (messageId && name !== `${messageId}.json`) continue;
    const relative = `user/relay/fanout/${name}`;
    const bytes = await readBytes(context.store, absolute(context, relative));
    if (!bytes) continue;
    const parsed = JSON.parse(bytes.toString('utf8'));
    let changed = false;
    for (const notice of parsed.notices ?? []) {
      const priorBytes = await readBytes(context.store, absolute(context, noticePath(notice)));
      const prior = priorBytes ? JSON.parse(priorBytes.toString('utf8')) : null;
      if (prior?.key === notice.key && ['submitted', 'ambiguous'].includes(prior.state) && prior.state !== notice.state) {
        Object.assign(notice, { state: prior.state, error: prior.error ?? null, submittedAt: prior.submittedAt ?? null });
        changed = true;
      }
      if (notice.state === 'submitted' || notice.state === 'ambiguous') {
        results.push(notice);
        continue;
      }
      if (typeof context.wake?.notify === 'function') await rememberNotice(context, { ...notice, state: 'ambiguous', error: 'submission_unconfirmed' });
      const outcome = await attemptNotice(context, notice);
      if (outcome.state !== notice.state || outcome.error !== (notice.error ?? null)) {
        notice.state = outcome.state;
        notice.error = outcome.error;
        if (outcome.state === 'submitted') notice.submittedAt = stamp(context);
        changed = true;
      }
      await rememberNotice(context, notice);
      results.push({ ...notice });
    }
    if (changed) {
      await commitOne(context, relative, revisionOf(bytes), Buffer.from(`${canonicalJson(parsed)}\n`), async () => {
        const { readDetail } = await import('./projection.mjs');
        const message = await readDetail(context, 'messages', parsed.messageId).catch((error) => {
          if (error.code !== 'resource_not_found' && error.code !== 'message_not_found') throw error;
          return null;
        });
        const chatId = message?.toId?.startsWith('chat:') ? message.toId.slice(5) : null;
        return [{ name: 'notification.changed', data: { messageId: parsed.messageId, state: 'updated', ...(message ? { chatId, message } : {}) } }];
      });
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
    return { state: 'ambiguous', error: 'delivery_failed' };
  } catch (error) {
    return { state: 'ambiguous', error: error?.code || 'delivery_failed' };
  }
}

async function rememberNotice(context, notice) {
  const relative = noticePath(notice);
  const current = await readBytes(context.store, absolute(context, relative));
  const record = {
    ...(current ? JSON.parse(current.toString('utf8')) : {}),
    format: 'hivem1nd-notice-v1',
    key: notice.key,
    messageId: notice.resourceId ?? notice.key.split(':')[0],
    recipientId: notice.unitId,
    state: notice.state,
    error: notice.error ?? null,
    submittedAt: notice.submittedAt ?? null,
  };
  const bytes = Buffer.from(`${canonicalJson(record)}\n`);
  if (current?.equals(bytes)) return;
  await commitOne(context, relative, revisionOf(current), bytes, [
    { name: 'notification.changed', unitId: notice.unitId, data: { noticeKey: notice.key, unitId: notice.unitId, state: notice.state, error: notice.error ?? null } },
  ]);
}

function noticePath(notice) {
  return `user/relay/notices/${Buffer.from(notice.key).toString('base64url')}.json`;
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
  const body = textField(input, 'body');
  const subject = headerField(input, 'subject', 240);
  if (input?.replyTo != null && (typeof input.replyTo !== 'string' || /[\u0000-\u001f]/.test(input.replyTo))) {
    throw new CoreError(422, 'invalid_reply', 'The reply target is not a message id.');
  }
  const attachments = attachmentList(input?.attachments);
  if (!body && !subject && attachments.length === 0) throw new CoreError(422, 'invalid_body', 'A message needs a body, subject, or attachment.');
  const priority = enumField(input, 'priority', ['normal', 'urgent'], 'normal');
  const replyRequested = booleanField(input, 'replyRequested', false);
  const id = randomUUID();
  const fromId = author(context);
  const lines = [
    `id: ${id}`,
    `from: ${parseUnitId(fromId).unit}`,
    `from-id: ${fromId}`,
    `to: ${target.destination === 'chat' ? target.toId : (target.legacyTo ?? target.toId)}`,
    `to-id: ${target.toId}`,
    `machine: ${context.paths.machine}`,
    `timestamp: ${stamp(context)}`,
    `priority: ${priority}`,
    `subject: ${subject}`,
    `thread-id: ${target.threadId ?? id}`,
    `reply-to: ${input?.replyTo ?? ''}`,
    `reply-requested: ${replyRequested ? 'true' : 'false'}`,
    `attachments: ${canonicalJson(attachments)}`,
    'kind: message',
    ...(context.receipt ? [`operation-id: ${context.receipt.key}`] : []),
  ];
  const bytes = Buffer.from(`${lines.join('\n')}\n\n${body}`);
  if (bytes.length > RECORD_MAX) throw new CoreError(413, 'message_too_large', 'The message exceeds 1000000 bytes.');
  const relative = target.place(id);
  const { projectMessageBytes } = await import('./projection.mjs');
  const projected = projectMessageBytes(bytes, relative, { units: target.units ?? [] });
  if (!projected) throw new CoreError(500, 'corrupt_resource', 'The message could not be projected.');
  return { id, bytes, relative, projected };
}

function textField(input, name) {
  if (input == null || !Object.hasOwn(input, name) || input[name] == null) return '';
  if (typeof input[name] !== 'string') throw new CoreError(422, 'invalid_body', `The ${name} must be text.`);
  return input[name];
}

function headerField(input, name, max) {
  const value = textField(input, name);
  if (value.length > max) throw new CoreError(422, 'invalid_body', `The ${name} must be at most ${max} characters.`);
  if (/[\u0000-\u001f]/.test(value)) throw new CoreError(422, 'invalid_body', `The ${name} cannot contain a control character.`);
  return value;
}

function enumField(input, name, allowed, fallback) {
  if (input == null || !Object.hasOwn(input, name) || input[name] == null) return fallback;
  if (!allowed.includes(input[name])) throw new CoreError(422, 'invalid_body', `The ${name} is not one of the allowed values.`);
  return input[name];
}

function booleanField(input, name, fallback) {
  if (input == null || !Object.hasOwn(input, name) || input[name] == null) return fallback;
  if (typeof input[name] !== 'boolean') throw new CoreError(422, 'invalid_body', `The ${name} must be a boolean.`);
  return input[name];
}

function attachmentList(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 64) throw new CoreError(422, 'invalid_body', 'A message can include at most 64 attachments.');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.path !== 'string' || item.path.length < 1 || item.path.length > 2048 || /[\u0000-\u001f]/.test(item.path)) {
      throw new CoreError(422, 'invalid_body', 'An attachment needs a path of at most 2048 characters.');
    }
    if (item.kind != null && typeof item.kind !== 'string') throw new CoreError(422, 'invalid_body', 'An attachment kind must be text.');
    return { path: item.path, kind: item.kind ?? null };
  });
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
  return withLocalChanges(context.store, () => commitManyLocked(context, entries, events));
}

async function commitManyLocked(context, entries, events) {
  const receipt = context.receipt && context.receiptBody !== undefined ? context.receipt : null;
  const id = randomUUID();
  await commitTransaction(context.store, {
    id,
    entries: entries.map((entry) => ({
      resource: entry.relative,
      recordPath: absolute(context, entry.relative),
      beforeRevision: entry.before,
      afterBytes: entry.bytes,
    })),
    events: [],
    ...(receipt ? { receipt, response: { status: context.receiptStatus ?? 201, body: context.receiptBody } } : {}),
  });
  context.receiptBody = undefined;
  context.receiptStatus = undefined;
  const sync = context.sync ?? openSync({ store: context.store, paths: context.paths, now: () => context.now() });
  const changes = await stageTransaction(sync, entries.map((entry) => ({
    target: { kind: 'mind', path: entry.relative },
    bytes: entry.bytes,
    id: uuidV8(['chat-change', id, entry.relative, hashBytes(entry.bytes)]),
  })), { transactionId: id });
  noteSync(context, changes.length ? 'pending' : 'local');
  if (context.pulse) {
    const result = await context.pulse.changed(changes.map((change) => change.id));
    if (result?.published === true) noteSync(context, 'published');
  }
  const ready = typeof events === 'function' ? await events() : events;
  publishDomainEvents(context, ready);
}

async function storedChat(context, id) {
  const { projectChat } = await import('./projection.mjs');
  return projectChat(context, id);
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
    archived: headers.get('archived') === 'true',
    createdAt: headers.get('created') || null,
    revision: hashBytes(bytes),
  };
}

async function unreadChat(context, chatId, reader, extra = []) {
  const directory = path.join(context.paths.mind, 'user', 'relay', 'chats', chatId);
  const read = new Set(extra);
  const receiptRoot = path.join(directory, 'read', Buffer.from(reader).toString('base64url'));
  await collectReceipts(receiptRoot, read);
  return (await chatRecords(context, chatId)).filter((item) => !read.has(item.id)).length;
}

async function chatRecords(context, chatId) {
  const records = [];
  for (const suffix of ['', '/notices']) {
    const relativeDir = `user/relay/chats/${chatId}${suffix}`;
    let names;
    try { names = await readdir(absolute(context, relativeDir)); }
    catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
    for (const name of names) {
      if (!name.endsWith('.md') || name === 'chat.md' || name.includes('.conflict-')) continue;
      const relative = `${relativeDir}/${name}`;
      const bytes = await readBytes(context.store, absolute(context, relative));
      if (!bytes || bytes.length > RECORD_MAX) continue;
      const id = headerMap(bytes).get('id');
      if (id) records.push({ id, relative, bytes });
    }
  }
  return records;
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

async function inboxCount(context, parsed) {
  const relativeDir = inboxDirectory(parsed);
  const directory = path.join(context.paths.mind, ...relativeDir.split('/'));
  try {
    const names = await readdir(directory);
    return names.filter((name) => name.endsWith('.md')).length;
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
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
  return Boolean(await readUnitState(context, parsed));
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
  const pattern = new RegExp(`^${name}:.*$`, 'm');
  const next = pattern.test(text) ? text.replace(pattern, () => `${name}: ${value}`) : `${name}: ${value}\n${text}`;
  return Buffer.from(next);
}

export function groupChatBytes(context, { id, title, members, createdAt }) {
  return Buffer.from(`id: ${id}\ntitle: ${title}\nmembers: ${canonicalJson(['root:master', ...members].sort())}\npinned: false\nlisted: true\narchived: false\ncreated: ${createdAt}\ncreated-by: ${author(context)}\nkind: group\n\n`);
}

export function editChatMetadata(bytes, changes) {
  for (const [name, value] of Object.entries(changes)) bytes = replaceLine(bytes, name, name === 'members' ? canonicalJson(value) : String(value));
  return bytes;
}

export function projectChatBytes(bytes, id, previous = {}) {
  return { lastMessage: previous.lastMessage ?? null, unread: previous.unread ?? 0, ...parseChat(bytes, id), plans: previous.plans ?? [], runs: previous.runs ?? [] };
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

// Bootstrap is private model input; it is never an authored message or a read receipt.
export async function contextBootstrap(context, unitId) {
  const state = await readUnitState(context, parseUnitId(unitId));
  if (!state) throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  const role = headerMap(state.bytes).get('role');
  const records = [];
  for (const relative of ['rules.md', `roles/${role}.md`, state.relative]) {
    const bytes = await readBytes(context.store, absolute(context, relative));
    records.push({ resource: relative, revision: revisionOf(bytes), text: bytes?.toString('utf8') ?? '' });
  }
  const result = canonicalJson({ unitId, role, resources: ['inbox', 'tasks', 'content'], records });
  if (result.length > 12000) throw new CoreError(409, 'context_unavailable', 'The current M1ND bootstrap exceeds the supported input budget.');
  return result;
}

export async function contextHistory(context, unitId) {
  const root = absolute(context, 'user/relay/chats');
  let names;
  try { names = await readdir(root); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const history = []; let size = 0;
  for (const id of names) {
    const bytes = await readBytes(context.store, chatPath(context, id));
    if (!bytes || !parseChat(bytes, id).members.includes(unitId)) continue;
    for (const record of [{ relative: `user/relay/chats/${id}/chat.md`, bytes }, ...await chatRecords(context, id)]) {
      size += record.bytes.length;
      if (size > 16000000) throw new CoreError(409, 'context_unavailable', 'The chat checkpoint exceeds its supported bound.');
      history.push({ path: record.relative, revision: revisionOf(record.bytes), bytes: record.bytes.toString('base64') });
    }
  }
  return history;
}

export async function authoredPlanEntry(context, plan, { id, authorId, recipients, text }) {
  const relative = `user/relay/chats/${plan.chatId}/${id}.md`, recordPath = absolute(context, relative);
  if (await readBytes(context.store, recordPath)) return null;
  const body = text.replace(/\b(?:Bearer|Bootstrap)\s+[^\s]+/gi, '[redacted]')
    .replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,}\n]+)/gi, '$1[redacted]');
  const bytes = Buffer.from(`id: ${id}\nfrom: ${authorId}\nfrom-id: ${authorId}\nto-id: chat:${plan.chatId}\nmachine: ${plan.machine}\ntimestamp: ${stamp(context)}\nsubject: ${plan.title}\nthread-id: ${plan.chatId}\nkind: message\nplan-id: ${plan.id}\nrecipient-ids: ${canonicalJson(recipients)}\n\n${body}`);
  if (bytes.length > RECORD_MAX) throw new CoreError(413, 'message_too_large', 'The authored plan message exceeds its bound.');
  return { resource: relative, recordPath, beforeRevision: null, afterBytes: bytes };
}
