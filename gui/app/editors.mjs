import { createOperation, perform, request } from "./api.mjs";
import { boardDocument, loadAssets, releaseAssets } from "./blueprint.mjs";
import { collectPages } from "./lists.mjs";
import { loadProposals } from "./void.mjs";
import { element, icon } from "./components.mjs";

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
    libraries: new Map(),
  };
}

export function libraryState(editors, kind) {
  if (!editors.libraries.has(kind)) editors.libraries.set(kind, {
    query: "", filters: {}, collapsed: new Set(), matchingCollapsed: new Set(), folders: [], projects: [], menu: null, rename: null, scrollTop: 0,
  });
  return editors.libraries.get(kind);
}

export function groupCatalog(items, folders = [], projects = []) {
  const groups = [];
  for (const project of projects) groups.push({ project: project.id ?? project.name, items: [], folders: [] });
  for (const folder of folders) {
    let group = groups.find((entry) => entry.project === folder.project);
    if (!group) { group = { project: folder.project, items: [], folders: [] }; groups.push(group); }
    group.folders.push(folder);
  }
  for (const item of items) {
    let group = groups.find((entry) => entry.project === item.project);
    if (!group) {
      group = { project: item.project, items: [], folders: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export async function loadCatalog(api, editors, kind, query = libraryState(editors, kind).query) {
  const state = libraryState(editors, kind);
  state.query = query;
  const ticket = editors.catalogTicket + 1;
  editors.catalogTicket = ticket;
  const route = kind === "void" ? "/void/texts" : "/blueprint/boards";
  const filters = { ...state.filters, ...(query ? { q: query } : {}) };
  const filterKey = JSON.stringify(filters);
  if (state.filterKey !== filterKey) { state.matchingCollapsed.clear(); state.filterKey = filterKey; }
  const [page, folders, projects] = await Promise.all([
    collectPages(api, route, { query: filters, limit: 50 }),
    collectPages(api, "/library/folders", { query: { kind }, limit: 50 }),
    collectPages(api, "/projects", { limit: 50 }),
  ]);
  if (editors.catalogTicket !== ticket) return editors.catalog;
  editors.catalog = page.items;
  editors.catalogTotal = page.total;
  editors.catalogIssues = [...page.issues, ...folders.issues].filter((issue, index, issues) => issues.findIndex((entry) => entry.project === issue.project && entry.code === issue.code) === index);
  editors.catalogNext = page.nextCursor;
  editors.catalogKind = kind;
  editors.loadedKind = kind;
  state.folders = folders.items;
  state.projects = projects.items;
  return page.items;
}

export function renderLibrary(document, { kind, project = null, data, actions, t }) {
  const state = libraryState(data, kind);
  const items = data.catalog.filter((item) => item.kind === kind);
  const filtered = Boolean(state.query || Object.keys(state.filters).length);
  const panel = element(document, "aside", { class: "panel editor-catalog shared-library", "data-editor-column": "catalog", "data-library": kind, "data-project": project });
  const button = (action, label, handler, attributes = {}, glyph = null) => element(document, "button", {
    type: "button", class: "library-control", "data-action": action.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), "aria-label": label, title: label, onclick: handler, ...attributes,
  }, glyph ? libraryIcon(document, glyph) : label);
  const header = element(document, "header", { class: "library-header" }, element(document, "h2", { text: t(kind === "blueprint" ? "boards" : "texts") }));
  header.append(button("library-filters", t("filters"), (event) => actions.menu("filters", null, event.currentTarget ?? event.target.closest("button")), { "aria-expanded": String(state.menu?.type === "filters") }, "filters"));
  if (actions.create) header.append(
    button("new-folder", t("newFolder"), actions.folder, {}, "folder-plus"),
    button("open-create", t(kind === "blueprint" ? "newBoard" : "newText"), () => actions.create(), { "data-kind": kind }, "plus"),
  );
  panel.append(header);
  const search = element(document, "input", { type: "search", placeholder: t(kind === "blueprint" ? "searchBoards" : "searchTexts"), "aria-label": t(kind === "blueprint" ? "searchBoards" : "searchTexts"), "data-library-search": kind, "data-keep": `library|${kind}|search` });
  search.value = state.query;
  search.addEventListener("input", () => actions.query(search.value));
  const searchBox = element(document, "div", { class: `library-search${state.query ? " has-query" : ""}` }, libraryIcon(document, "search"), search);
  if (state.query) searchBox.append(button("clear-library-search", t("clearSearch"), () => actions.query(""), {}, "close"));
  panel.append(searchBox);
  const chips = element(document, "div", { class: "library-chips" });
  for (const [key, value] of Object.entries(state.filters)) {
    const label = key === "project" ? t("projectFilter", { project: value }) : t(key);
    chips.append(button(`remove-${key}`, t("removeFilter", { filter: label }), () => actions.filter(key, null), { class: "library-chip", "data-filter-chip": key }, null));
    chips.children[chips.children.length - 1].replaceChildren(element(document, "span", { text: label }), libraryIcon(document, "close"));
  }
  panel.append(chips);
  const list = element(document, "div", { class: "library-list", "data-editor-total": String(data.catalogTotal ?? data.catalog.length) });
  list.scrollTop = state.scrollTop;
  list.addEventListener("scroll", () => { state.scrollTop = list.scrollTop; });
  const rename = (entry, type) => {
    const editing = state.rename;
    const input = element(document, "input", { "data-library-rename": entry.id, "data-keep": `library|${kind}|rename|${entry.id}`, "aria-label": t("rename"), maxlength: "240", disabled: editing.busy ? "" : null });
    input.value = editing.title;
    input.addEventListener("input", () => { editing.title = input.value; editing.operation = null; });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault?.(); actions.saveRename(); }
      if (event.key === "Escape") { event.preventDefault?.(); actions.cancelRename(); }
    });
    return element(document, "div", { class: `library-rename library-rename-${type}` }, input,
      button("save-library-name", t(editing.busy ? "working" : "save"), actions.saveRename, { disabled: editing.busy ? "" : null }, "check"),
      editing.error ? element(document, "p", { role: "alert", text: editing.error }) : null);
  };
  const itemRow = (item, depth) => {
    if (state.rename?.id === item.id && state.rename.type === "item") return rename(item, "item");
    const row = element(document, "div", { class: "library-item", "data-library-item": item.id });
    row.style?.setProperty?.("--folder-depth", String(depth));
    row.append(button("select-editor", item.title, () => actions.select(item), { class: "library-item-select", "data-id": item.id, "data-keep": `library|${kind}|item|${item.id}`, "aria-pressed": String(data.current?.resourceId === item.id) }, kind === "blueprint" ? "board" : "text"));
    row.children[0].append(element(document, "span", { class: "library-item-title", text: item.title }));
    if (item.openThreads) row.append(element(document, "span", { class: "library-count", text: item.openThreads }));
    if (actions.manage) row.append(button(`more-item-${item.id}`, t("finalMore"), (event) => actions.menu("item", item, event.currentTarget ?? event.target.closest("button")), { "data-library-more": item.id, "aria-haspopup": "menu", "aria-expanded": String(state.menu?.entry?.id === item.id) }, "more"));
    return row;
  };
  for (const group of groupCatalog(items, state.folders, state.projects).filter((entry) => !state.filters.project || entry.project === state.filters.project || state.rename?.project === entry.project)) {
    if (filtered && !group.items.length && state.rename?.project !== group.project) continue;
    const rootKey = `project:${group.project}`;
    const open = !(filtered ? state.matchingCollapsed : state.collapsed).has(rootKey);
    const heading = button(`folder-${rootKey}`, group.project, () => actions.toggle(rootKey), { class: "library-folder", "aria-expanded": String(open), "data-library-project": group.project, "data-keep": `library|${kind}|project|${encodeURIComponent(group.project)}` }, "folder");
    heading.append(element(document, "span", { "aria-hidden": "true", text: open ? "⌄" : "›" }), element(document, "span", { text: group.project }), element(document, "span", { class: "library-count", text: group.items.length }));
    list.append(heading);
    if (!open) continue;
    const branch = (parentId, depth) => {
      for (const folder of group.folders.filter((entry) => entry.parentId === parentId)) {
        const descendants = new Set([folder.id]);
        for (let index = 0; index < group.folders.length; index += 1) for (const entry of group.folders) if (descendants.has(entry.parentId)) descendants.add(entry.id);
        const count = group.items.filter((entry) => descendants.has(entry.folderId)).length;
        if (filtered && !count && !descendants.has(state.rename?.id)) continue;
        const key = `${group.project}:${folder.id}`;
        const expanded = !(filtered ? state.matchingCollapsed : state.collapsed).has(key);
        const row = element(document, "div", { class: "library-folder-row", "data-library-folder": folder.id });
        row.style?.setProperty?.("--folder-depth", String(depth));
        if (state.rename?.id === folder.id && state.rename.type === "folder") row.append(rename(folder, "folder"));
        else {
          const control = button(`folder-${folder.id}`, folder.title, () => actions.toggle(key), { class: "library-folder", "aria-expanded": String(expanded) }, "folder");
          control.append(element(document, "span", { "aria-hidden": "true", text: expanded ? "⌄" : "›" }), element(document, "span", { text: folder.title }), element(document, "span", { class: "library-count", text: filtered ? count : folder.count }));
          row.append(control);
          if (actions.manage) row.append(button(`more-folder-${folder.id}`, t("finalMore"), (event) => actions.menu("folder", folder, event.currentTarget ?? event.target.closest("button")), { "data-library-more": folder.id, "aria-haspopup": "menu" }, "more"));
        }
        list.append(row);
        if (expanded) branch(folder.id, depth + 1);
      }
      for (const item of group.items.filter((entry) => (entry.folderId ?? null) === parentId)) list.append(itemRow(item, depth));
    };
    branch(null, 0);
  }
  if (!items.length && !data.catalogLoading) list.append(element(document, "p", { "data-empty": filtered ? "search" : kind, text: t(filtered ? "emptySearch" : kind === "blueprint" ? actions.create ? "emptyBoards" : "emptyBoardsRead" : actions.create ? "emptyTexts" : "emptyTextsRead") }));
  panel.append(list);
  for (const issue of data.catalogIssues ?? []) panel.append(element(document, "p", { class: "library-issue", "data-library-issue": issue.project, role: "status", text: t("libraryUnavailable", { project: issue.project }) }));
  if (data.catalogLoading) panel.append(element(document, "p", { role: "status", "data-catalog-progress": "true", text: t("loadingList") }));
  panel.append(button("refresh-catalog", t("refreshList"), actions.refresh, { class: "btn library-refresh" }));
  if (state.menu) {
    const menu = element(document, "div", { class: `library-menu${state.menu.type === "filters" ? " library-filter-menu" : ""}`, role: "menu", "data-library-menu": state.menu.type });
    if (menu.style) { menu.style.left = `${state.menu.x}px`; menu.style.top = `${state.menu.y}px`; }
    const add = (key, label, callback, selected = null, glyph = key) => {
      const row = button(`library-${key}`, label, callback, { role: selected === null ? "menuitem" : "menuitemcheckbox", "aria-checked": selected === null ? null : String(selected), class: `library-control library-menu-row${key === "delete" ? " is-danger" : ""}` }, glyph);
      row.append(element(document, "span", { text: label }));
      if (key === "move") row.append(element(document, "span", { class: "library-count", "aria-hidden": "true", text: "›" }));
      menu.append(row);
    };
    if (state.menu.type === "filters") {
      for (const key of ["openComments", "attachedAgents", "changedThisWeek"]) add(key, t(key), () => actions.filter(key, state.filters[key] ? null : true), Boolean(state.filters[key]), state.filters[key] ? "check" : key);
      menu.append(element(document, "div", { role: "separator" }));
      const select = element(document, "select", { "aria-label": t("registerProject"), "data-project-filter": "true", onchange: (event) => actions.filter("project", event.target.value || null) }, element(document, "option", { value: "", text: t("projectAll") }));
      for (const entry of state.projects) select.append(element(document, "option", { value: entry.id ?? entry.name, text: entry.name ?? entry.id }));
      select.value = state.filters.project ?? "";
      menu.append(select);
    } else {
      add("rename", t("rename"), () => actions.manage("rename", state.menu.entry, state.menu.type));
      if (state.menu.type === "item") {
        add("duplicate", t("duplicate"), () => actions.manage("duplicate", state.menu.entry, "item"));
        add("move", t("moveToFolder"), () => actions.manage("move", state.menu.entry, "item"));
      }
      menu.append(element(document, "div", { role: "separator" }));
      add("delete", t("delete"), () => actions.manage("delete", state.menu.entry, state.menu.type));
    }
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault?.(); actions.closeMenu(); }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const controls = [...menu.querySelectorAll("button, select")];
      const index = controls.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
      event.preventDefault?.(); controls[next]?.focus?.();
    });
    panel.append(menu);
  }
  return panel;
}

function libraryIcon(document, name) {
  if (["close", "board", "text", "attachedAgents", "openComments"].includes(name)) return icon(document, { board: "blueprint", text: "document", attachedAgents: "person", openComments: "chats", close: "close" }[name]);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "icon"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const paths = { filters: "M4 6h16M7 12h10M10 18h4", "folder-plus": "M3 7V5h7l2 3h9v12H3zM12 11v6M9 14h6", folder: "M3 7V5h7l2 3h9v12H3z", plus: "M12 5v14M5 12h14", search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6", more: "M5 12h.1M12 12h.1M19 12h.1", check: "M5 12l4 4L19 6", rename: "M4 16 16 4l4 4L8 20H4z", duplicate: "M8 8h12v12H8zM16 8V4H4v12h4", move: "M3 7V5h7l2 3h9v12H3zM9 14h8M14 11l3 3-3 3", delete: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7", changedThisWeek: "M5 5v5h5M5 10a8 8 0 1 1 0 5M12 8v5h4" };
  path.setAttribute("d", paths[name]); svg.append(path); return svg;
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
    boardDraft: saved?.boardDraft ?? null,
    editGeneration: saved?.editGeneration ?? 0,
    boardTool: saved?.boardTool ?? "select",
    drawTool: saved?.drawTool ?? "pen",
    drawColor: saved?.drawColor ?? "text",
    selectedNodeId: saved?.selectedNodeId ?? null,
    conflictCopies: saved?.conflictCopies ?? [],
    draftKey: saved?.draftKey ?? null,
    textDrafts: saved?.textDrafts ?? new Map(),
    commentText: saved?.commentText ?? "",
    baseRevision: saved?.dirty ? saved.baseRevision : result.data.revision,
    dirty: Boolean(saved?.dirty),
    conflict: saved?.conflict ?? null,
    notices: saved?.notices ?? [],
  };
  if (next.boardDraft && next.baseRevision !== result.data.revision) next.conflict = { revision: result.data.revision, remote: result.data };
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

export async function registerResource(api, input, retained = null) {
  return perform(api, { method: "POST", path: "/editors/register", body: input }, retained);
}

export async function createResource(api, kind, input, retained = null) {
  const path = kind === "void" ? "/void/texts" : "/blueprint/boards";
  return perform(api, { method: "POST", path, body: input }, retained);
}

export function expandAttachments(units, groups, selected) {
  const valid = new Set(units.map((unit) => unit.id));
  const expanded = new Set();
  for (const id of selected) {
    const group = groups.find((item) => `group:${item.id}` === id && !item.deleted);
    for (const member of group ? group.members : [id]) if (valid.has(member)) expanded.add(member);
  }
  if (expanded.size > 256) throw Object.assign(new Error("Too many attached units."), { code: "invalid_body" });
  return [...expanded];
}

export async function setAttachments(api, editors, attached, retained = null) {
  const current = editors.current;
  if (!current) throw Object.assign(new Error("No editor is open."), { code: "invalid_body" });
  const unique = [];
  for (const id of attached) if (!unique.includes(id)) unique.push(id);
  if (unique.length > 256) throw Object.assign(new Error("Too many attached units."), { code: "invalid_body" });
  const result = await perform(api, {
    method: "PUT",
    path: "/editors/:resourceId/attachments",
    params: { resourceId: current.resourceId },
    body: { attached: unique, expectedRevision: Object.hasOwn(current, "attachmentChoiceRevision") ? current.attachmentChoiceRevision : current.attachmentRevision },
  }, retained);
  current.attached = result.data.attached;
  current.attachmentRevision = result.data.revision;
  delete current.attachmentChoiceRevision;
  current.attachmentChoice = new Set(result.data.attached);
  current.attachmentConflict = null;
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

export async function createComment(api, editors, anchor, text, retained = null) {
  const current = editors.current;
  const result = await perform(api, {
    method: "POST",
    path: "/editors/:resourceId/comments",
    params: { resourceId: current.resourceId },
    body: {
      anchor,
      text,
      expectedRevision: current.revision,
      expectedCommentsRevision: current.commentsRevision,
    },
  }, retained);
  applyCommentThread(current, result.data.thread, result.data.commentsRevision);
  current.notices = result.data.notifications ?? [];
  current.commentText = "";
  return result;
}

export async function replyComment(api, editors, threadId, text, retained = null) {
  const current = editors.current;
  const result = await perform(api, {
    method: "POST",
    path: "/editors/:resourceId/comments/:threadId/replies",
    params: { resourceId: current.resourceId, threadId },
    body: { text, expectedCommentsRevision: current.commentsRevision },
  }, retained);
  applyCommentThread(current, result.data.thread, result.data.commentsRevision);
  current.notices = result.data.notifications ?? [];
  return result;
}

export async function resolveComment(api, editors, threadId, retained = null) {
  const current = editors.current;
  const result = await perform(api, {
    method: "PATCH",
    path: "/editors/:resourceId/comments/:threadId",
    params: { resourceId: current.resourceId, threadId },
    body: { status: "resolved", expectedCommentsRevision: current.commentsRevision },
  }, retained);
  applyCommentThread(current, result.data.thread, result.data.commentsRevision);
  return result;
}

export async function startWatch(api, editors, input, retained = null) {
  const result = await perform(api, { method: "POST", path: "/watch", body: input }, retained);
  editors.pendingStop = false;
  editors.watch = result.data;
  return result;
}

export function stopWatch(api, editors, retained = null) {
  const watch = editors.watch;
  if (!watch?.watchId && !retained) return Promise.resolve(null);
  editors.pendingStop = true;
  const pending = perform(api, {
    method: "DELETE",
    path: "/watch/:watchId",
    params: { watchId: watch?.watchId },
    body: {},
  }, retained).then((result) => {
    if (editors.watch?.watchId === watch?.watchId) editors.watch = null;
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
  const armed = !editors.pendingStop && !editors.current?.boardDraft && !editors.current?.boardGesture && watch?.state === "watching" && activity?.unitId === watch.unitId && activity?.resourceId === watch.resourceId;
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
  applyCommentThread(current, data.thread, data.commentsRevision);
}

function applyCommentThread(current, thread, commentsRevision) {
  if (!current) return;
  if (!current.priorCommentsRevisions) current.priorCommentsRevisions = new Set();
  const stale = Boolean(commentsRevision && current.priorCommentsRevisions.has(commentsRevision));
  if (thread?.id) {
    let threads = [...(current.threads ?? [])];
    if (!stale) threads = threads.filter((item) => !item.pending);
    const index = threads.findIndex((item) => item.id === thread.id);
    if (index >= 0) {
      if (!stale) threads[index] = thread;
    } else {
      threads.push(thread);
    }
    current.threads = threads;
  }
  if (!stale && commentsRevision && commentsRevision !== current.commentsRevision) {
    if (current.commentsRevision) current.priorCommentsRevisions.add(current.commentsRevision);
    current.commentsRevision = commentsRevision;
  }
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
  if (current.boardSaving && JSON.stringify(record.document) === JSON.stringify(current.boardSaving.document)) {
    current.authoritative = record;
    current.revision = record.revision;
    current.baseRevision = record.revision;
    current.remoteStale = false;
    if (!current.conflict?.remote || current.conflict.remote.revision === record.revision) current.conflict = null;
    return true;
  }
  if (current.dirty || current.boardDraft || current.boardGesture) {
    current.conflict = { revision: record.revision, remote: record };
    current.remoteStale = false;
    editors.drafts.set(id, current);
    return true;
  }
  current.authoritative = record;
  if (current.kind === "blueprint") current.boardView = null;
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
  keepConflictCopies(current, remote);
  current.boardDraft = null;
  current.editGeneration = (current.editGeneration ?? 0) + 1;
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
  keepConflictCopies(current, remote);
  if (current.kind === "blueprint") {
    current.boardDraft ??= structuredClone(current.authoritative.document);
    current.authoritative = remote;
  }
  current.baseRevision = remote.revision;
  current.revision = remote.revision;
  current.conflict = null;
  current.remoteStale = false;
  editors.drafts.set(current.resourceId, current);
  return true;
}

function keepConflictCopies(current, remote) {
  if (current.kind !== "blueprint") return;
  current.conflictCopies ??= [];
  current.conflictCopies.push({ local: { document: structuredClone(boardDocument(current)), revision: current.baseRevision, author: "root:master" },
    remote: structuredClone(remote) });
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

export function libraryChange(api, editor, title, folderId, libraryRevision, retained = null) {
  return perform(api, { method: 'PATCH', path: '/editors/:resourceId/library', params: { resourceId: editor.id ?? editor.resourceId },
    body: { title, folderId, expectedRevision: editor.revision, expectedLibraryRevision: libraryRevision } }, retained);
}
export function duplicateEditor(api, editor, destination, retained = null) {
  return perform(api, { method: 'POST', path: '/editors/:resourceId/duplicate', params: { resourceId: editor.id ?? editor.resourceId },
    body: { project: destination.project, folderId: destination.folderId, title: destination.title,
      path: destination.path, expectedRevision: editor.revision } }, retained);
}
export function moveEditor(api, editor, destination, libraryRevision, retained = null) {
  return perform(api, { method: 'POST', path: '/editors/:resourceId/move', params: { resourceId: editor.id ?? editor.resourceId },
    body: { project: destination.project, folderId: destination.folderId, path: destination.path,
      confirmedRepositoryChange: destination.confirmedRepositoryChange === true, expectedRevision: editor.revision,
      expectedCommentsRevision: editor.commentsRevision ?? null, expectedAttachmentRevision: editor.attachmentRevision ?? null,
      expectedLibraryRevision: libraryRevision } }, retained);
}
export function deleteEditor(api, editor, libraryRevision, retained = null) {
  return perform(api, { method: 'DELETE', path: '/editors/:resourceId', params: { resourceId: editor.id ?? editor.resourceId },
    body: { confirmed: true, expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision ?? null,
      expectedAttachmentRevision: editor.attachmentRevision ?? null, expectedLibraryRevision: libraryRevision } }, retained);
}
