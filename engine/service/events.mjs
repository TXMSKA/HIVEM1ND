import { randomUUID } from 'node:crypto';
import { CoreError } from './identity.mjs';

export const EVENT_NAMES = [
  'stream.ready', 'stream.reset', 'service.changed', 'unit.changed', 'view.changed',
  'session.changed', 'session.request.changed', 'chat.changed', 'message.created', 'message.read',
  'notification.changed', 'approval.requested', 'approval.answered', 'approval.grant.changed',
  'task.changed', 'layout.changed', 'settings.changed', 'home.changed', 'blueprint.changed',
  'void.changed', 'editor.attachments.changed', 'comment.changed', 'void.proposal.changed',
  'editor.asset.created', 'viewer.changed', 'editor.activity', 'watch.changed', 'sync.changed',
  'sync.conflict', 'issue.changed',
];

const GLOBAL_EVENTS = new Set(['service.changed', 'settings.changed', 'sync.changed', 'sync.conflict', 'stream.reset', 'stream.ready']);
const VIEWER_EVENTS = new Set(['viewer.changed', 'watch.changed']);
const SECRET_KEYS = new Set(['endpoint', 'token', 'key', 'code', 'nativeSessionId', 'authorization', 'secret', 'pipe']);
const RETAIN_MS = 600000;
const RETAIN_COUNT = 1000;

export function revisionRelation(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length === 0 || right.length === 0) return 'different';
  return left === right ? 'equal' : 'different';
}

export function createEventBus({ now = () => Date.now(), machine = 'DESKTOP', startupId = randomUUID() } = {}) {
  let sequence = 0;
  const ring = [];
  const operations = new Set();
  const subscribers = new Set();
  const revoked = new Set();

  function captureCursor() {
    return `${startupId}:${sequence}`;
  }

  function emit(event) {
    if (!event || !EVENT_NAMES.includes(event.name)) throw new CoreError(422, 'invalid_body', 'The event name is not part of the contract.');
    if (event.operationId) {
      if (operations.has(event.operationId)) return { emitted: false, duplicate: true, id: null };
      operations.add(event.operationId);
    }
    const resourceId = event.resourceId ?? event.data?.resourceId ?? event.data?.unit?.id ?? null;
    const revision = event.revision ?? event.data?.revision ?? null;
    if (resourceId && revision && revisionRelation(latestRevision(event.name, resourceId), revision) === 'equal') {
      return { emitted: false, duplicate: true, id: null };
    }
    sequence += 1;
    const record = {
      id: `${startupId}:${sequence}`,
      name: event.name,
      at: new Date(now()).toISOString(),
      atMs: now(),
      machine,
      source: event.source ?? { kind: 'local' },
      data: event.data ?? {},
      resourceId,
      unitId: event.unitId ?? event.data?.unitId ?? event.data?.unit?.id ?? null,
      chatId: event.chatId ?? event.data?.chatId ?? event.data?.chat?.id ?? null,
      viewerId: event.viewerId ?? event.data?.viewerId ?? null,
      revision,
      operationId: event.operationId ?? null,
    };
    ring.push(record);
    prune();
    for (const subscriber of subscribers) deliver(subscriber, record);
    return { emitted: true, duplicate: false, id: record.id };
  }

  function subscribe(principal, filters = {}, listener = () => {}) {
    if (!principal?.stableId) throw new CoreError(401, 'unauthorized', 'The event stream needs a principal.');
    if (revoked.has(principal.stableId)) throw new CoreError(401, 'unauthorized', 'The credential is revoked.');
    const subscriber = { principal, filters, listener, closed: false, buffer: [] };
    subscribers.add(subscriber);
    return subscriber;
  }

  function replay(subscriber, cursor) {
    if (subscriber.closed || revoked.has(subscriber.principal.stableId)) {
      throw new CoreError(401, 'unauthorized', 'The credential is revoked.');
    }
    const parsed = parseCursor(cursor);
    const frames = [];
    const push = (name, data) => {
      const frame = {
        name,
        data: present(subscriber.principal, {
          id: name === 'stream.ready' || name === 'stream.reset' ? captureCursor() : null,
          name,
          at: new Date(now()).toISOString(),
          machine,
          source: { kind: 'local' },
          data,
          resourceId: null,
          unitId: null,
          chatId: null,
          viewerId: subscriber.principal.viewerId ?? null,
          revision: null,
        }),
      };
      frames.push(frame);
      subscriber.listener(frame);
    };
    if (!parsed || parsed.startupId !== startupId || parsed.sequence > sequence || gap(parsed.sequence)) {
      const reason = parsed && parsed.startupId !== startupId ? 'service_restarted' : 'cursor_expired';
      push('stream.reset', { reason, cursor: captureCursor() });
      push('stream.ready', { cursor: captureCursor(), readAt: new Date(now()).toISOString(), capabilities: capabilitiesFor(subscriber.principal) });
      return { reset: true, events: [], ready: true, frames };
    }
    const events = ring.filter((record) => sequenceOf(record.id) > parsed.sequence && allowed(subscriber, record));
    for (const record of events) {
      const frame = { name: record.name, data: present(subscriber.principal, record) };
      frames.push(frame);
      subscriber.listener(frame);
    }
    push('stream.ready', { cursor: captureCursor(), readAt: new Date(now()).toISOString(), capabilities: capabilitiesFor(subscriber.principal) });
    return { reset: false, events, ready: true, frames };
  }

  function release(subscriber) {
    if (!subscriber) return;
    subscriber.closed = true;
    subscribers.delete(subscriber);
  }

  function closePrincipal(stableId) {
    revoked.add(stableId);
    for (const subscriber of [...subscribers]) {
      if (subscriber.principal.stableId !== stableId) continue;
      subscriber.closed = true;
      subscribers.delete(subscriber);
      subscriber.listener({ name: 'closed', data: null });
    }
  }

  function prune() {
    const cutoff = now() - RETAIN_MS;
    while (ring.length > RETAIN_COUNT || (ring.length > 0 && ring[0].atMs <= cutoff)) ring.shift();
  }

  function gap(cursorSequence) {
    if (ring.length === 0) return cursorSequence < sequence;
    const oldest = sequenceOf(ring[0].id);
    return cursorSequence < oldest - 1;
  }

  function latestRevision(name, resourceId) {
    for (let index = ring.length - 1; index >= 0; index -= 1) {
      if (ring[index].name === name && ring[index].resourceId === resourceId) return ring[index].revision;
    }
    return null;
  }

  function deliver(subscriber, record) {
    if (!allowed(subscriber, record)) return;
    const frame = { name: record.name, data: present(subscriber.principal, record) };
    subscriber.buffer.push(frame);
    subscriber.listener(frame);
  }

  function allowed(subscriber, record) {
    if (subscriber.closed) return false;
    if (VIEWER_EVENTS.has(record.name)) return Boolean(subscriber.principal.viewerId) && subscriber.principal.viewerId === record.viewerId;
    if (!matches(subscriber.filters ?? {}, record)) return false;
    return true;
  }

  return { captureCursor, emit, subscribe, replay, release, closePrincipal, startupId };
}

export function matches(filters, record) {
  if (GLOBAL_EVENTS.has(record.name)) return true;
  if (filters.unitId && record.unitId && filters.unitId !== record.unitId) return false;
  if (filters.chatId && record.chatId && filters.chatId !== record.chatId) return false;
  if (filters.resourceId && record.resourceId && filters.resourceId !== record.resourceId) return false;
  return true;
}

function present(principal, record) {
  const data = principal.audience === 'phone' ? stripSecrets(record.data) : record.data;
  return {
    contract: 'hivem1nd-events-v3',
    at: record.at,
    machine: record.machine,
    source: record.source,
    data,
  };
}

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    next[key] = stripSecrets(item);
  }
  return next;
}

function capabilitiesFor(principal) {
  if (principal.audience === 'phone') return ['read', 'chat.post', 'master.read', 'approval.answer', 'task.accept', 'task.send-back'];
  if (principal.audience === 'agent') return ['own'];
  return ['desktop'];
}

function parseCursor(cursor) {
  if (typeof cursor !== 'string') return null;
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d+)$/i.exec(cursor);
  if (!match) return null;
  return { startupId: match[1], sequence: Number(match[2]) };
}

function sequenceOf(id) {
  return Number(id.slice(id.lastIndexOf(':') + 1));
}
