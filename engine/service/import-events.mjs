import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalTaskId, parseTaskId } from './identity.mjs';
import { assertNoLinks } from './paths.mjs';
import { projectChat, readCollection, readDetail } from './projection.mjs';
import { readApproval } from './approvals.mjs';
import { projectSessionRequest, readStartRequest } from './adapters.mjs';
import { readAsset, readAttachments, readComments } from './editors.mjs';

const PRIVATE_FIELDS = new Set(['nativeSessionId', 'endpoint', 'endpoints', 'token', 'authorization', 'secret', 'secrets', 'pipe', 'password', 'credential', 'credentials', 'pid', 'lease', 'bootstrap']);

export async function importedSidecarEvents(context, change) {
  const file = String(change.target?.path ?? '').replaceAll('\\', '/');
  if (!file || file.includes('.conflict-')) return null;
  if (change.target?.kind === 'project') return projectSidecar(context, change, file);
  const event = (name, data, extra = {}) => ({ name, data, ...extra });
  const changed = (events, collections) => ({ events, collections });
  if (/^user\/(?:inbox|(?:envs|projects)\/[^/]+\/inbox)\/[^/]+\.md$/.test(file)) {
    if (change.operation === 'delete') return changed([], ['mailboxes', 'messages', 'waiting']);
    const bytes = await bytesAt(context.paths.mind, file);
    const message = await readDetail(context, 'messages', header(bytes, 'id'));
    return changed([event('message.created', { chatId: null, mailboxId: message.toId, message }, { unitId: message.toId })], ['mailboxes', 'messages', 'waiting']);
  }
  if (/^user\/(?:tasks|(?:envs|projects)\/[^/]+\/tasks)\/[^/]+\.md$/.test(file) || /^user\/relay\/task-undo\/[^/]+\/[^/]+\.json$/.test(file)) {
    if (change.operation === 'delete') return changed([], ['tasks', 'waiting', 'units']);
    const bytes = await bytesAt(context.paths.mind, file);
    const record = file.endsWith('.json') ? JSON.parse(bytes) : null;
    const rawId = record?.taskId ?? header(bytes, 'id') ?? header(bytes, 'task-id');
    const id = parseTaskId(canonicalTaskId(rawId, file)).id;
    const task = await readDetail(context, 'tasks', id);
    return changed([event('task.changed', { task, changeId: record?.id ?? null, undoOf: record?.undoOf ?? null })], ['tasks', 'waiting', 'units', 'leads', 'squads']);
  }
  const approval = /^user\/relay\/approvals\/([^/]+)\/(request|result|binding|answers\/[^/]+|answer-results\/[^/]+)\.json$/.exec(file);
  if (approval) {
    const collections = ['approvals', 'waiting', 'units', 'leads', 'squads'];
    if (change.operation === 'delete' || approval[2] === 'binding') return changed([], collections);
    const projected = await readApproval(context, approval[1]);
    return changed([event(approval[2] === 'request' ? 'approval.requested' : 'approval.answered', { approval: projected }, { unitId: projected.unitId })], collections);
  }
  if (file === 'user/gui/layout.json' || file === 'user/gui/settings.json') {
    const name = file.includes('layout') ? 'layout' : 'settings';
    const value = await readDetail(context, name);
    return changed([event(`${name}.changed`, value)], name === 'layout' ? ['units'] : []);
  }
  if (file === 'user/gui/resources.json') return changed([], ['editors']);
  const binding = /^user\/relay\/editors\/([^/.]+)\.json$/.exec(file);
  if (binding) {
    const value = await readAttachments(context, binding[1]);
    return changed([event('editor.attachments.changed', { resourceId: binding[1], ...value }, { resourceId: binding[1] })], ['editors']);
  }
  const receipt = /^user\/relay\/chats\/([^/]+)\/read\/.+\.json$/.exec(file);
  if (receipt && change.operation !== 'delete') {
    const value = await jsonAt(context.paths.mind, file);
    if (value.format !== 'hivem1nd-chat-read-v1' || value.chatId !== receipt[1] || !Array.isArray(value.messageIds)) return null;
    const chat = await projectChat({ ...context, principal: { ...context.principal, unitId: value.unitId } }, receipt[1]);
    return changed([event('message.read', { chatId: receipt[1], mailboxId: null, readerId: value.unitId, messageIds: value.messageIds, unread: chat.unread }, { chatId: receipt[1] })], ['chats', 'waiting']);
  }
  if (/^user\/relay\/(fanout|notices)\/[^/]+\.json$/.test(file) && change.operation !== 'delete') {
    const value = await jsonAt(context.paths.mind, file);
    const notices = Array.isArray(value.notices) ? value.notices : [{ key: value.key, unitId: value.recipientId, state: value.state, resourceId: value.messageId, error: value.error }];
    return changed(notices.filter(item => item.key && item.unitId).map(item => event('notification.changed', { noticeKey: item.key, unitId: item.unitId, resourceId: item.resourceId ?? value.messageId, state: item.state ?? 'pending', error: typeof item.error === 'string' ? item.error : null }, { unitId: item.unitId })), ['chats', 'waiting']);
  }
  if (/^user\/relay\/(sessions|session-status)\/.+\.json$/.test(file)) {
    if (change.operation === 'delete') return changed([], ['sessions', 'units', 'waiting']);
    const value = await jsonAt(context.paths.mind, file);
    const id = value.sessionId;
    if (!id) return changed([], ['sessions', 'units', 'waiting']);
    const session = clean(await readDetail(context, 'sessions', id));
    return changed([event('session.changed', { session }, { unitId: session.unitId })], ['sessions', 'units', 'waiting', 'leads', 'squads']);
  }
  const request = /^user\/relay\/requests\/[^/]+\/([^/]+)\.json$/.exec(file);
  const result = /^user\/relay\/request-results\/([^/]+)\/[^/]+\.json$/.exec(file);
  if (request || result) {
    const id = (request || result)[1];
    if (change.operation === 'delete') return changed([], ['sessions', 'units']);
    const value = projectSessionRequest(await readStartRequest(context, id, { readOnly: true }));
    return changed([event('session.request.changed', value, { unitId: value.unitId })], ['sessions', 'units', 'waiting']);
  }
  if (/^user\/relay\/(mailbox-reads|tombstones)\/[^/]+\.json$/.test(file) && change.operation !== 'delete') {
    const value = await jsonAt(context.paths.mind, file);
    const mailboxes = await readCollection(context, 'mailboxes', { unitId: value.unitId });
    const unread = mailboxes.items.find(item => item.id === value.unitId)?.unread ?? 0;
    return changed([event('message.read', { chatId: null, mailboxId: value.unitId, readerId: value.unitId, messageIds: value.id && !value.sources ? [value.id] : [], unread }, { unitId: value.unitId })], ['mailboxes', 'messages', 'waiting']);
  }
  if (/^user\/relay\/wake\/policies\/[^/]+\.json$/.test(file)) return changed([], ['sessions', 'units', 'waiting', 'leads', 'squads']);
  if (/^user\/relay\/grant-revocation-results\/[^/]+\.json$/.test(file) && change.operation !== 'delete') {
    const value = await jsonAt(context.paths.mind, file);
    return changed([event('approval.grant.changed', { unitId: value.unitId, grantId: value.grantId, requestId: value.requestId, operation: 'revoked', revision: value.revision }, { unitId: value.unitId })], ['units', 'approvals', 'waiting']);
  }
  return null;
}

async function projectSidecar(context, change, file) {
  const project = (context.projects ?? []).find(item => item.name === change.target.project && item.localPath);
  if (!project) return null;
  const isComments = file.endsWith('.comments.json') || /^docs\/flows\/comments\/[^/]+\.json$/.test(file);
  const isAsset = /^docs\/flows\/assets\/[^/]+\.(png|jpg|webp)$/.test(file);
  if (file === 'docs/flows/boards/index.json') return { events: [], collections: ['editors'] };
  if (!isComments && !isAsset) return null;
  if (change.operation === 'delete') return { events: [], collections: ['editors'] };
  const catalog = await jsonAt(context.paths.mind, 'user/gui/resources.json');
  const entries = (catalog.resources ?? []).filter(item => item.project === project.name);
  const events = [];
  for (const entry of entries) {
    if (isComments) {
      const expected = entry.kind === 'blueprint' ? `docs/flows/comments/${entry.legacyId}.json` : `${entry.path.replace(/\.(json|mjs)$/, '')}.comments.json`;
      if (file !== expected) continue;
      const comments = await readComments(context, entry.id);
      for (const thread of comments.threads ?? []) {
        events.push({ name: 'comment.changed', resourceId: entry.id, data: { resourceId: entry.id, thread, commentsRevision: comments.commentsRevision, operation: 'import' } });
        for (const message of thread.messages ?? []) if (message.proposal) events.push({ name: 'void.proposal.changed', resourceId: entry.id, data: { resourceId: entry.id, proposal: { ...message.proposal, resourceId: entry.id, threadId: thread.id, commentsRevision: comments.commentsRevision }, commentsRevision: comments.commentsRevision } });
      }
    } else {
      const id = path.posix.basename(file);
      try {
        const asset = await readAsset(context, entry.id, id);
        events.push({ name: 'editor.asset.created', resourceId: entry.id, data: { resourceId: entry.id, asset: { id, src: `assets/${id}`, bytes: asset.bytes.length, contentType: asset.type, revision: asset.revision, url: `/api/v1/editors/${entry.id}/assets/${id}` } } });
      } catch (error) { if (error?.code !== 'not_found') throw error; }
    }
  }
  return { events, collections: ['editors'] };
}

export async function bytesAt(root, relative) {
  const file = path.join(root, ...relative.split('/'));
  await assertNoLinks(file, { root });
  const stats = await lstat(file);
  if (!stats.isFile() || stats.size > 16_000_000) throw new Error('Imported record exceeds its read limit.');
  return readFile(file);
}

async function jsonAt(root, relative) { return JSON.parse(await bytesAt(root, relative)); }

function header(bytes, name) {
  const text = bytes.toString('utf8').split(/\r?\n\r?\n/, 1)[0];
  const line = text.split(/\r?\n/).find(item => item.startsWith(`${name}:`));
  return line ? line.slice(name.length + 1).trim() : null;
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_FIELDS.has(key)).map(([key, item]) => [key, clean(item)]));
}
