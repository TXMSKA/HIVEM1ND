import { request } from "./api.mjs";

const CURSOR = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9]+)$/;

export function createStore() {
  return {
    indexes: { units: new Map(), chats: new Map(), tasks: new Map(), editors: new Map() },
    messages: new Map(),
    selected: { unitId: null, chatId: null, taskId: null, resourceId: null },
    viewport: { x: 0, y: 0, scale: 1 },
    drafts: new Map(),
    conflicts: new Map(),
    pages: new Map(),
    pending: new Map(),
    open: { editors: new Map(), comments: new Set(), attachments: new Set() },
    buffer: [],
    ticket: 0,
    cursor: null,
    liveCursor: null,
    capabilities: [],
    view: null,
    layout: null,
    settings: null,
    viewer: null,
    mode: "snapshot",
    snapshotReady: false,
    paused: false,
    signedOut: null,
    failure: null,
  };
}

export function isAfterCursor(eventId, cursor) {
  const left = CURSOR.exec(String(eventId ?? ""));
  const right = CURSOR.exec(String(cursor ?? ""));
  if (!left || !right || left[1] !== right[1]) return false;
  return Number(left[2]) > Number(right[2]);
}

export function setDraft(store, resourceId, draft) {
  if (draft == null) store.drafts.delete(resourceId);
  else store.drafts.set(resourceId, draft);
}

export function invalidateCollection(store, name) {
  store.pages.delete(name);
}

export async function loadSnapshot(store, api) {
  const ticket = ++store.ticket;
  store.pending.set("view", ticket);
  let response;
  try {
    response = await request(api, "GET", "/view");
  } catch (error) {
    if (error?.status === 413 && error.code === "view_too_large") {
      store.mode = "paged";
      store.view = null;
      store.snapshotReady = true;
      store.buffer.length = 0;
      store.pending.delete("view");
      return { paged: true };
    }
    throw error;
  }
  if (store.pending.get("view") !== ticket) return { stale: true };
  store.pending.clear();
  store.mode = "snapshot";
  store.view = response.data;
  indexView(store, response.data);
  store.cursor = response.meta.eventCursor;
  store.snapshotReady = true;
  store.paused = false;
  await drainBuffer(store, api);
  return { paged: false, cursor: store.cursor };
}

export async function loadResource(store, api, path, key) {
  const ticket = ++store.ticket;
  store.pending.set(key, ticket);
  const response = await request(api, "GET", path);
  if (store.pending.get(key) !== ticket) return { stale: true };
  store.pending.delete(key);
  commit(store, key, response.data);
  return { stale: false, data: response.data };
}

export async function applyEvent(store, api, event) {
  if (!event || event.error) {
    if (event?.error) store.failure = event.error;
    return { ignored: true };
  }
  if (event.name === "stream.ready") {
    store.liveCursor = event.envelope.data?.cursor ?? store.liveCursor;
    store.capabilities = event.envelope.data?.capabilities ?? store.capabilities;
    return { ready: true };
  }
  if (event.name === "stream.reset") return applyReset(store, api);
  const resource = resourceOf(event);
  if (!resource) return { ignored: true };
  const current = currentRevision(store, resource);
  if (current && resource.revision && current === resource.revision) return { duplicate: true };
  if (resource.conflict && store.drafts.has(resource.resourceId)) {
    store.conflicts.set(resource.resourceId, { revision: resource.revision });
  }
  if (current && resource.revision && current !== resource.revision) {
    return loadResource(store, api, resource.path, resource.key);
  }
  if (resource.invalidate) {
    for (const name of resource.invalidate) invalidateCollection(store, name);
  }
  if (resource.apply) resource.apply(store);
  else if (resource.path) return loadResource(store, api, resource.path, resource.key);
  return { applied: true };
}

export function acceptStreamEvent(store, api, event) {
  if (!event || event.error) {
    if (event?.error) store.failure = event.error;
    return null;
  }
  if (!store.snapshotReady || store.paused) {
    store.buffer.push(event);
    return null;
  }
  if (event.name !== "stream.ready" && event.name !== "stream.reset" && !isAfterCursor(event.id, store.cursor)) return { dropped: true };
  return applyEvent(store, api, event);
}

export async function applyReset(store, api) {
  store.paused = true;
  store.pages.clear();
  store.pending.clear();
  store.cursor = null;
  const snapshot = await loadSnapshot(store, api);
  if (store.mode === "paged") return snapshot;
  store.paused = true;
  await Promise.all(openPaths(store).map((path) => request(api, "GET", path).then((response) => {
    if (path === "/settings") store.settings = response.data;
    if (path === "/viewer") store.viewer = response.data;
    if (path.includes("/comments") || path.includes("/attachments") || path.includes("/boards/") || path.includes("/texts/")) {
      const editor = response.data?.id ? response.data : null;
      if (editor) commit(store, `editor:${editor.id}`, editor);
    }
  })));
  store.paused = false;
  await drainBuffer(store, api);
  return snapshot;
}

function openPaths(store) {
  const paths = ["/settings", "/viewer"];
  for (const [id, kind] of store.open.editors) {
    paths.push(kind === "void" ? `/void/texts/${encodeURIComponent(id)}` : `/blueprint/boards/${encodeURIComponent(id)}`);
  }
  for (const id of store.open.comments) paths.push(`/editors/${encodeURIComponent(id)}/comments`);
  for (const id of store.open.attachments) paths.push(`/editors/${encodeURIComponent(id)}/attachments`);
  return paths;
}

async function drainBuffer(store, api) {
  const events = store.buffer.splice(0);
  for (const event of events) {
    if (!event || event.name === "stream.reset") continue;
    if (event.name !== "stream.ready" && !isAfterCursor(event.id, store.cursor)) continue;
    await applyEvent(store, api, event);
  }
}

function indexView(store, data) {
  store.indexes.units.clear();
  store.indexes.chats.clear();
  store.indexes.tasks.clear();
  for (const unit of data?.units ?? []) store.indexes.units.set(unit.id, unit);
  for (const chat of data?.chats ?? []) store.indexes.chats.set(chat.id, chat);
  for (const task of data?.tasks ?? []) store.indexes.tasks.set(task.id, task);
}

function commit(store, key, data) {
  if (key === "view") {
    store.view = data;
    indexView(store, data);
    return;
  }
  if (key === "layout") {
    store.layout = data;
    return;
  }
  if (key.startsWith("unit:") && data?.id) store.indexes.units.set(data.id, data);
  if (key.startsWith("chat:") && data?.id) store.indexes.chats.set(data.id, data);
  if (key.startsWith("task:") && data?.id) store.indexes.tasks.set(data.id, data);
  if (key.startsWith("editor:") && data?.id) {
    store.indexes.editors.set(data.id, data);
    if (store.drafts.has(data.id)) store.conflicts.set(data.id, { revision: data.revision ?? null });
  }
}

function currentRevision(store, resource) {
  if (resource.key === "layout") return store.layout?.revision ?? null;
  if (resource.key.startsWith("unit:")) return store.indexes.units.get(resource.id)?.revision ?? null;
  if (resource.key.startsWith("chat:")) return store.indexes.chats.get(resource.id)?.revision ?? null;
  if (resource.key.startsWith("task:")) return store.indexes.tasks.get(resource.id)?.revision ?? null;
  if (resource.key.startsWith("editor:")) return store.indexes.editors.get(resource.id)?.revision ?? null;
  if (resource.key === "settings") return store.settings?.revision ?? null;
  return null;
}

function resourceOf(event) {
  const data = event.envelope?.data ?? {};
  if (event.name === "unit.changed" && data.unit?.id) {
    return { key: `unit:${data.unit.id}`, id: data.unit.id, revision: data.unit.revision ?? null, path: `/units/${encodeURIComponent(data.unit.id)}`, apply: (store) => store.indexes.units.set(data.unit.id, data.unit) };
  }
  if (event.name === "chat.changed" && data.chat?.id) {
    return { key: `chat:${data.chat.id}`, id: data.chat.id, revision: data.chat.revision ?? null, path: `/chats/${encodeURIComponent(data.chat.id)}`, apply: (store) => store.indexes.chats.set(data.chat.id, data.chat) };
  }
  if (event.name === "task.changed" && data.task?.id) {
    return { key: `task:${data.task.id}`, id: data.task.id, revision: data.task.revision ?? null, path: `/tasks/${encodeURIComponent(data.task.id)}`, apply: (store) => store.indexes.tasks.set(data.task.id, data.task) };
  }
  if (event.name === "layout.changed") {
    return { key: "layout", revision: data.revision ?? null, path: "/layout", apply: (store) => { store.layout = data; } };
  }
  if (event.name === "settings.changed") {
    return { key: "settings", revision: data.revision ?? null, path: "/settings", apply: (store) => { store.settings = data; } };
  }
  if (event.name === "view.changed") {
    return { key: "view", revision: data.revision ?? null, path: "/view", invalidate: data.collections ?? [] };
  }
  if ((event.name === "blueprint.changed" || event.name === "void.changed") && data.resourceId) {
    const path = event.name === "void.changed" ? `/void/texts/${encodeURIComponent(data.resourceId)}` : `/blueprint/boards/${encodeURIComponent(data.resourceId)}`;
    return { key: `editor:${data.resourceId}`, id: data.resourceId, resourceId: data.resourceId, revision: data.revision ?? null, path, conflict: true };
  }
  if (event.name === "message.created" && data.message?.id) {
    return { key: `message:${data.message.id}`, revision: null, apply: (store) => store.messages.set(data.message.id, data.message) };
  }
  return null;
}
