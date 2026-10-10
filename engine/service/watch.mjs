import { randomUUID } from 'node:crypto';
import { watch as watchFile } from 'node:fs';
import path from 'node:path';
import { CoreError } from './identity.mjs';
import { readBytes } from './store.mjs';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function fail(status, code, message) {
  throw new CoreError(status, code, message);
}

export function createWatch({ bus = null, now = () => Date.now(), watchImpl = watchFile } = {}) {
  return { bus, now, watchImpl, viewers: new Map(), byToken: new Map(), activity: [], handles: new Map() };
}

export function recordActivity(watch, event) {
  if (!event?.unitId || !event?.resourceId) return null;
  watch.activity.push({ at: event.at ?? new Date(watch.now()).toISOString(), resourceId: event.resourceId, unitId: event.unitId, focus: event.focus ?? null });
  for (const record of watch.viewers.values()) {
    if (!record.enabled || record.unitId !== event.unitId) continue;
    if (record.resourceId && record.resourceId !== event.resourceId) continue;
    const next = { at: event.at, resourceId: event.resourceId };
    const current = record.follow;
    if (current && (next.at < current.at || (next.at === current.at && next.resourceId <= current.resourceId))) continue;
    record.follow = next;
    emitWatch(watch, record, 'watching');
  }
  return event;
}

export function resolveActivity(watch, unitId, now = watch.now()) {
  const fresh = watch.activity.filter((item) => item.unitId === unitId && now - Date.parse(item.at) <= FIFTEEN_MINUTES);
  fresh.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : left.resourceId < right.resourceId ? -1 : left.resourceId > right.resourceId ? 1 : 0));
  return fresh.at(-1) ?? null;
}

export async function start(watch, input) {
  if (!input?.viewerId || !input?.unitId) fail(422, 'invalid_body', 'Watch needs a viewer and a unit.');
  if (input.resourceId && input.attached === false) fail(403, 'not_attached', 'That unit is not attached to the resource.');
  if (input.chatId && input.chatMember === false) fail(422, 'invalid_chat_member', 'That unit is not in the chat.');
  const watchId = randomUUID();
  const record = {
    watchId, viewerId: input.viewerId, token: input.token ?? null, unitId: input.unitId,
    resourceId: input.resourceId ?? null, chatId: input.chatId ?? null, enabled: true, follow: null,
  };
  watch.viewers.set(watchId, record);
  if (record.token) watch.byToken.set(record.token, watchId);
  const latest = resolveActivity(watch, input.unitId, watch.now());
  const matched = latest && (!record.resourceId || latest.resourceId === record.resourceId);
  if (matched) record.follow = { at: latest.at, resourceId: latest.resourceId };
  emitWatch(watch, record, matched ? 'watching' : 'waiting');
  return { watchId, state: matched ? 'watching' : 'waiting', unitId: input.unitId, resourceId: matched ? latest.resourceId : (input.resourceId ?? null) };
}

export function stop(watch, watchId) {
  const record = watch.viewers.get(watchId);
  if (!record) return false;
  record.enabled = false;
  record.follow = null;
  emitWatch(watch, record, 'waiting');
  return true;
}

export function clearUnit(watch, unitId) {
  watch.activity = watch.activity.filter((item) => item.unitId !== unitId);
  for (const record of watch.viewers.values()) {
    if (record.unitId !== unitId) continue;
    record.follow = null;
    emitWatch(watch, record, 'waiting');
  }
}

export function clearResource(watch, resourceId) {
  watch.activity = watch.activity.filter((item) => item.resourceId !== resourceId);
  for (const record of watch.viewers.values()) {
    if (record.resourceId !== resourceId && record.follow?.resourceId !== resourceId) continue;
    record.follow = null;
    emitWatch(watch, record, 'waiting');
  }
}

export function disposeViewer(watch, token) {
  const watchId = watch.byToken.get(token);
  if (!watchId) return false;
  watch.viewers.delete(watchId);
  watch.byToken.delete(token);
  return true;
}

export function startResourceWatch(watch, id, file) {
  if (watch.handles.has(id)) return watch.handles.get(id);
  const handle = watch.watchImpl(file, { persistent: false }, () => {
    watch.pending?.(id);
  });
  handle.unref?.();
  watch.handles.set(id, handle);
  return handle;
}

export function dispose(watch) {
  for (const handle of watch.handles.values()) handle.close?.();
  watch.handles.clear();
  watch.viewers.clear();
  watch.activity = [];
}

function emitWatch(watch, record, state) {
  watch.bus?.emit({
    name: 'watch.changed',
    viewerId: record.viewerId,
    resourceId: record.follow?.resourceId ?? record.resourceId ?? null,
    data: {
      viewerId: record.viewerId,
      state,
      unitId: record.unitId,
      resourceId: record.follow?.resourceId ?? record.resourceId ?? null,
      focus: record.follow ?? null,
    },
  });
}

export async function chatContains(context, chatId, unitId) {
  if (!context.paths?.mind) return false;
  const bytes = await readBytes(context.store, path.join(context.paths.mind, 'user', 'relay', 'chats', chatId, 'chat.md'));
  if (!bytes) return false;
  return bytes.toString('utf8').includes(unitId);
}
