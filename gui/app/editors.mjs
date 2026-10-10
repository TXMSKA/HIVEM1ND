import { createOperation, request } from "./api.mjs";

export function createEditors() {
  return {
    catalog: [],
    catalogKind: null,
    loadedKind: null,
    catalogTicket: 0,
    openTicket: 0,
    current: null,
    drafts: new Map(),
    tickets: new Map(),
    watch: null,
    pendingStop: false,
    activity: null,
    focus: null,
    viewport: { x: 0, y: 0, scale: 1 },
    viewerDirty: null,
    viewerPatch: null,
    error: null,
  };
}

export function groupCatalog(items) {
  const groups = [];
  for (const item of items) {
    let group = groups.find((entry) => entry.project === item.project);
    if (!group) {
      group = { project: item.project, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export async function loadCatalog(api, editors, kind, query = "") {
  const ticket = editors.catalogTicket + 1;
  editors.catalogTicket = ticket;
  const route = kind === "void" ? "/void/texts" : "/blueprint/boards";
  const items = [];
  let cursor = null;
  do {
    const result = await request(api, "GET", route, {
      query: { limit: "50", ...(query ? { q: query } : {}), ...(cursor ? { cursor } : {}) },
    });
    if (editors.catalogTicket !== ticket) return editors.catalog;
    items.push(...(result.data.items ?? []));
    cursor = result.data.nextCursor ?? null;
  } while (cursor);
  if (editors.catalogTicket !== ticket) return editors.catalog;
  editors.catalog = items;
  editors.catalogKind = kind;
  editors.loadedKind = kind;
  return items;
}

export async function openEditor(api, editors, summary) {
  const ticket = editors.openTicket + 1;
  editors.openTicket = ticket;
  editors.tickets.set(summary.id, ticket);
  const route = summary.kind === "void" ? "/void/texts/:resourceId" : "/blueprint/boards/:resourceId";
  let result;
  try {
    result = await request(api, "GET", route, { params: { resourceId: summary.id } });
  } catch (error) {
    if (editors.openTicket !== ticket) return editors.current;
    editors.error = error;
    if (editors.current?.resourceId === summary.id) editors.current.conflict = { code: error.code ?? "request_failed" };
    return editors.current;
  }
  if (editors.openTicket !== ticket) return editors.current;
  const saved = editors.drafts.get(summary.id);
  const next = {
    resourceId: summary.id,
    kind: summary.kind,
    authoritative: result.data,
    revision: result.data.revision,
    commentsRevision: result.data.commentsRevision ?? null,
    attachmentRevision: result.data.attachmentRevision ?? null,
    attached: result.data.attached ?? [],
    threads: result.data.threads ?? [],
    draftText: saved?.draftText ?? "",
    commentText: saved?.commentText ?? "",
    baseRevision: saved?.dirty ? saved.baseRevision : result.data.revision,
    dirty: Boolean(saved?.dirty),
    conflict: saved?.conflict ?? null,
    notices: saved?.notices ?? [],
  };
  editors.drafts.set(summary.id, next);
  editors.current = next;
  editors.error = null;
  return next;
}

export async function registerResource(api, input) {
  const operation = createOperation({ method: "POST", path: "/editors/register", body: input });
  return request(api, "POST", "/editors/register", { operation });
}

export async function createResource(api, kind, input) {
  const path = kind === "void" ? "/void/texts" : "/blueprint/boards";
  const operation = createOperation({ method: "POST", path, body: input });
  return request(api, "POST", path, { operation });
}

export async function setAttachments(api, editors, attached) {
  const current = editors.current;
  if (!current) throw Object.assign(new Error("No editor is open."), { code: "invalid_body" });
  const unique = [];
  for (const id of attached) if (!unique.includes(id)) unique.push(id);
  if (unique.length > 256) throw Object.assign(new Error("Too many attached units."), { code: "invalid_body" });
  const operation = createOperation({
    method: "PUT",
    path: "/editors/:resourceId/attachments",
    params: { resourceId: current.resourceId },
    body: { attached: unique, expectedRevision: current.attachmentRevision },
  });
  const result = await request(api, "PUT", operation.path, { operation });
  current.attached = result.data.attached;
  current.attachmentRevision = result.data.revision;
  current.notices = result.data.notifications ?? [];
  return result;
}

export async function loadComments(api, editors) {
  const current = editors.current;
  const result = await request(api, "GET", "/editors/:resourceId/comments", {
    params: { resourceId: current.resourceId },
    query: { status: "all", limit: "200" },
  });
  current.threads = result.data.items ?? [];
  current.commentsRevision = result.data.commentsRevision ?? null;
  current.commentsStale = false;
  return result;
}

export async function createComment(api, editors, anchor, text) {
  const current = editors.current;
  const operation = createOperation({
    method: "POST",
    path: "/editors/:resourceId/comments",
    params: { resourceId: current.resourceId },
    body: {
      anchor,
      text,
      expectedRevision: current.revision,
      expectedCommentsRevision: current.commentsRevision,
    },
  });
  const result = await request(api, "POST", operation.path, { operation });
  current.commentsRevision = result.data.commentsRevision;
  current.threads = [...(current.threads ?? []), result.data.thread];
  current.notices = result.data.notifications ?? [];
  current.commentText = "";
  return result;
}

export async function replyComment(api, editors, threadId, text) {
  const current = editors.current;
  const operation = createOperation({
    method: "POST",
    path: "/editors/:resourceId/comments/:threadId/replies",
    params: { resourceId: current.resourceId, threadId },
    body: { text, expectedCommentsRevision: current.commentsRevision },
  });
  const result = await request(api, "POST", operation.path, { operation });
  current.commentsRevision = result.data.commentsRevision;
  current.threads = (current.threads ?? []).map((thread) => thread.id === result.data.thread.id ? result.data.thread : thread);
  current.notices = result.data.notifications ?? [];
  return result;
}

export async function resolveComment(api, editors, threadId) {
  const current = editors.current;
  const operation = createOperation({
    method: "PATCH",
    path: "/editors/:resourceId/comments/:threadId",
    params: { resourceId: current.resourceId, threadId },
    body: { status: "resolved", expectedCommentsRevision: current.commentsRevision },
  });
  const result = await request(api, "PATCH", operation.path, { operation });
  current.commentsRevision = result.data.commentsRevision;
  current.threads = (current.threads ?? []).map((thread) => thread.id === result.data.thread.id ? result.data.thread : thread);
  return result;
}

export async function startWatch(api, editors, input) {
  const operation = createOperation({ method: "POST", path: "/watch", body: input });
  const result = await request(api, "POST", "/watch", { operation });
  editors.pendingStop = false;
  editors.watch = result.data;
  return result;
}

export function stopWatch(api, editors) {
  const watch = editors.watch;
  if (!watch?.watchId) return Promise.resolve(null);
  editors.pendingStop = true;
  const operation = createOperation({ method: "DELETE", path: "/watch/:watchId", params: { watchId: watch.watchId }, body: {} });
  const pending = request(api, "DELETE", operation.path, { operation }).then((result) => {
    if (editors.watch?.watchId === watch.watchId) editors.watch = null;
    editors.pendingStop = false;
    return result;
  }).catch((error) => {
    editors.pendingStop = false;
    throw error;
  });
  return pending;
}

export function handleActivity(editors, activity) {
  editors.activity = activity ?? null;
  const watch = editors.watch;
  const armed = !editors.pendingStop && watch?.state === "watching" && activity?.unitId === watch.unitId && activity?.resourceId === watch.resourceId;
  if (!armed) return { follow: false, focus: editors.focus, viewport: editors.viewport };
  editors.focus = { resourceId: activity.resourceId, screenId: activity.screenId ?? null, range: activity.range ?? null };
  if (activity.viewport) editors.viewport = { ...editors.viewport, ...activity.viewport };
  return { follow: true, focus: editors.focus, viewport: editors.viewport };
}

export function applyWatch(editors, data) {
  if (!data?.watchId) return null;
  if (data.state === "off") {
    if (editors.watch?.watchId === data.watchId) editors.watch = null;
    editors.pendingStop = false;
    return null;
  }
  if (editors.pendingStop) return null;
  const blocked = editors.current?.dirty && data.resourceId && data.resourceId !== editors.current.resourceId;
  editors.watch = { ...data, held: Boolean(blocked) };
  if (blocked) return null;
  if (data.state === "watching" && data.resourceId && data.resourceId !== editors.current?.resourceId) return data.resourceId;
  return null;
}

export function noteComment(editors, data) {
  const current = editors.current;
  if (!current || data.resourceId !== current.resourceId) return;
  if (!data.thread) {
    current.commentsStale = true;
    return;
  }
  const threads = current.threads ?? [];
  const index = threads.findIndex((thread) => thread.id === data.thread.id);
  current.threads = index >= 0 ? threads.map((thread) => thread.id === data.thread.id ? data.thread : thread) : [...threads, data.thread];
  if (data.commentsRevision) current.commentsRevision = data.commentsRevision;
}

export function noteRemote(editors, change) {
  const current = editors.drafts.get(change.resourceId) ?? (editors.current?.resourceId === change.resourceId ? editors.current : null);
  if (!current) return;
  if (current.dirty && change.revision && change.revision !== current.baseRevision) {
    current.conflict = { revision: change.revision };
    return;
  }
  if (!current.dirty && change.revision) {
    current.revision = change.revision;
    current.baseRevision = change.revision;
  }
}

export function markDirty(api, editors, capabilities, dirty) {
  const current = editors.current;
  if (!current) return null;
  current.dirty = dirty;
  editors.drafts.set(current.resourceId, current);
  if (!capabilities?.includes("viewer.write")) return null;
  if (editors.viewerDirty === dirty) return editors.viewerPatch ?? null;
  editors.viewerDirty = dirty;
  const operation = createOperation({ method: "PATCH", path: "/viewer", body: { dirty } });
  editors.viewerPatch = request(api, "PATCH", "/viewer", { operation });
  return editors.viewerPatch;
}
