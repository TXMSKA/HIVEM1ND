import { createOperation, request } from "./api.mjs";
import { loadAssets, releaseAssets } from "./blueprint.mjs";
import { collectPages } from "./lists.mjs";
import { loadProposals } from "./void.mjs";

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
  const page = await collectPages(api, route, { query: query ? { q: query } : {}, limit: 50 });
  if (editors.catalogTicket !== ticket) return editors.catalog;
  editors.catalog = page.items;
  editors.catalogTotal = page.total;
  editors.catalogIssues = page.issues;
  editors.catalogNext = page.nextCursor;
  editors.catalogKind = kind;
  editors.loadedKind = kind;
  return page.items;
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
    draftKey: saved?.draftKey ?? null,
    textDrafts: saved?.textDrafts ?? new Map(),
    commentText: saved?.commentText ?? "",
    baseRevision: saved?.dirty ? saved.baseRevision : result.data.revision,
    dirty: Boolean(saved?.dirty),
    conflict: saved?.conflict ?? null,
    notices: saved?.notices ?? [],
  };
  const previousAssets = saved?.assets;
  next.assets = new Map();
  next.assetIssues = [];
  editors.drafts.set(summary.id, next);
  editors.current = next;
  editors.error = null;
  if (next.kind === "void") await loadProposals(api, editors);
  await loadComments(api, editors);
  if (editors.openTicket !== ticket) {
    if (editors.current !== next) releaseAssets(next);
    return editors.current;
  }
  if (next.kind === "blueprint") await loadAssets(api, next);
  if (previousAssets) {
    for (const image of previousAssets.values()) {
      if (![...next.assets.values()].includes(image)) image.revoke?.();
    }
    if (saved) saved.assets = new Map();
  }
  if (editors.openTicket !== ticket && editors.current !== next) {
    releaseAssets(next);
    return editors.current;
  }
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
  const page = await collectPages(api, "/editors/:resourceId/comments", {
    params: { resourceId: current.resourceId },
    query: { status: "all" },
    limit: 50,
  });
  current.threads = page.items;
  current.commentsTotal = page.total;
  current.commentsIssues = page.issues;
  current.commentsNext = page.nextCursor;
  current.commentsRevision = page.commentsRevision ?? current.commentsRevision ?? null;
  current.commentWindow = current.commentWindow ?? 40;
  current.commentsStale = false;
  return page;
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
  if (!armed) return { follow: false, focus: editors.focus, viewport: editors.viewport, kind: activity?.kind ?? null };
  const focus = activity.focus;
  if (focus && (typeof focus.screenId === "string" || typeof focus.nodeId === "string")) {
    editors.focus = { resourceId: activity.resourceId, screenId: focus.screenId ?? null, nodeId: focus.nodeId ?? null };
    const point = focusPoint(editors, focus.nodeId);
    if (point) {
      editors.viewport = { ...editors.viewport, x: point.x, y: point.y };
      editors.panned = true;
    }
  } else if (focus && typeof focus.k === "string") {
    editors.focus = { resourceId: activity.resourceId, k: focus.k, lang: focus.lang ?? null, start: focus.start ?? null, end: focus.end ?? null };
    if (editors.current) editors.current.page = focus.k;
    editors.panned = false;
  }
  return { follow: true, focus: editors.focus, viewport: editors.viewport, kind: activity.kind ?? null };
}

function focusPoint(editors, nodeId) {
  const document = editors.current?.authoritative?.document ?? editors.current?.document;
  if (!document || typeof nodeId !== "string") return null;
  for (const screen of document.screens ?? []) {
    const point = nodePoint(screen.root, nodeId, finite(screen.x), finite(screen.y));
    if (point) return point;
  }
  return null;
}

function nodePoint(node, nodeId, x, y) {
  if (!node) return null;
  const nextX = x + finite(node.place?.x);
  const nextY = y + finite(node.place?.y);
  if (node.id === nodeId) return { x: nextX, y: nextY };
  for (const child of node.kids ?? []) {
    const found = nodePoint(child, nodeId, nextX, nextY);
    if (found) return found;
  }
  return null;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function applyWatch(editors, data) {
  if (!data?.watchId) return null;
  if (data.state === "stopped") {
    if (editors.watch?.watchId === data.watchId) editors.watch = null;
    editors.pendingStop = false;
    return null;
  }
  if (data.state !== "waiting" && data.state !== "watching") return null;
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
  const current = editors.drafts.get(change?.resourceId) ?? (editors.current?.resourceId === change?.resourceId ? editors.current : null);
  if (!current || !change?.revision || change.revision === current.revision) return;
  current.remoteStale = true;
  if (current.dirty && change.revision !== current.baseRevision) {
    current.conflict = { ...(current.conflict ?? {}), revision: change.revision };
  }
}

export async function refreshRemoteEditor(api, editors, resourceId) {
  const current = editors.drafts.get(resourceId) ?? (editors.current?.resourceId === resourceId ? editors.current : null);
  if (!current?.remoteStale) return false;
  const generation = (editors.openTicket ?? 0) + 1;
  editors.openTicket = generation;
  editors.tickets.set(resourceId, generation);
  const route = current.kind === "void" ? "/void/texts/:resourceId" : "/blueprint/boards/:resourceId";
  const result = await request(api, "GET", route, { params: { resourceId } });
  const changed = reconcileEditor(editors, result.data, generation);
  if (changed && current.kind === "blueprint" && current.resourceId === resourceId && !current.dirty) await loadAssets(api, current);
  return changed;
}

export function reconcileEditor(editors, record, generation) {
  const id = record?.id;
  if (!id || editors.tickets.get(id) !== generation) return false;
  const current = editors.drafts.get(id) ?? (editors.current?.resourceId === id ? editors.current : null);
  if (!current) return false;
  if (current.dirty) {
    current.conflict = { revision: record.revision, remote: record };
    current.remoteStale = false;
    editors.drafts.set(id, current);
    return true;
  }
  current.authoritative = record;
  current.revision = record.revision ?? current.revision;
  current.baseRevision = record.revision ?? current.baseRevision;
  current.commentsRevision = record.commentsRevision ?? current.commentsRevision;
  current.attached = record.attached ?? current.attached;
  current.threads = record.threads ?? current.threads;
  current.conflict = null;
  current.remoteStale = false;
  editors.drafts.set(id, current);
  if (editors.current?.resourceId === id) editors.current = current;
  return true;
}

export function discardEditorDraft(editors) {
  const current = editors.current;
  const remote = current?.conflict?.remote;
  if (!current || !remote) return false;
  current.dirty = false;
  current.draftText = "";
  current.draftKey = null;
  current.textDrafts = new Map();
  current.authoritative = remote;
  current.revision = remote.revision ?? current.revision;
  current.baseRevision = remote.revision ?? current.baseRevision;
  current.commentsRevision = remote.commentsRevision ?? current.commentsRevision;
  current.conflict = null;
  current.remoteStale = false;
  editors.drafts.set(current.resourceId, current);
  return true;
}

export function reapplyEditorDraft(editors) {
  const current = editors.current;
  const remote = current?.conflict?.remote;
  if (!current?.dirty || !remote?.revision) return false;
  current.baseRevision = remote.revision;
  current.revision = remote.revision;
  current.conflict = null;
  current.remoteStale = false;
  editors.drafts.set(current.resourceId, current);
  return true;
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
