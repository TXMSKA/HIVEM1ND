import { request } from "./api.mjs";
import { startCollection, writeCollection } from "./state.mjs";

export function windowRange(scrollTop, height, rowHeight, count, overscan = 8) {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}

export function createPagedList({ api, store, name, route, filters = {}, pageSize = 100, rowHeight = 36 } = {}) {
  const generation = startCollection(store, name);
  return {
    api,
    store,
    name,
    route,
    filters: { ...filters },
    pageSize,
    rowHeight,
    query: "",
    items: [],
    catalog: [],
    total: null,
    issues: [],
    nextCursor: null,
    generation,
    status: "idle",
    error: null,
    focusId: null,
    scrollTop: 0,
    height: 0,
    delay: 150,
    timer: null,
    controller: null,
    reloading: false,
    pendingResolve: null,
    onUpdate: null,
  };
}

export function setQuery(list, query) {
  list.pendingResolve?.({ stale: true });
  list.controller?.abort();
  if (list.timer) clearTimeout(list.timer);
  list.query = String(query ?? "");
  list.scrollTop = 0;
  const generation = startCollection(list.store, list.name);
  list.generation = generation;
  let resolve;
  const done = new Promise((settle) => {
    resolve = settle;
  });
  list.pendingResolve = resolve;
  list.timer = setTimeout(() => {
    list.timer = null;
    list.pendingResolve = null;
    list.items = [];
    list.nextCursor = null;
    list.status = "loading";
    list.error = null;
    resolve(loadAll(list, generation));
  }, list.delay);
  return done;
}

export async function loadNext(list, generation = list.generation) {
  if (generation !== list.generation) return { stale: true };
  list.controller?.abort();
  const controller = new AbortController();
  list.controller = controller;
  list.status = list.items.length ? list.status : "loading";
  const query = { ...list.filters, limit: list.pageSize };
  if (list.query) query.q = list.query;
  if (list.nextCursor) query.cursor = list.nextCursor;
  try {
    const send = list.request ?? request;
    const response = await send(list.api, "GET", list.route, { query, signal: controller.signal });
    if (generation !== list.generation) return { stale: true };
    const page = response.data ?? {};
    const items = Array.isArray(page.items) ? page.items : [];
    const committed = writeCollection(list.store, list.name, generation, {
      items: list.items.concat(items),
      total: page.total ?? list.items.length + items.length,
      issues: page.issues ?? [],
      nextCursor: page.nextCursor ?? null,
      status: "ready",
      query: list.query,
    });
    if (!committed) return { stale: true };
    list.items = list.items.concat(items);
    list.total = page.total ?? list.items.length;
    list.issues = page.issues ?? [];
    list.nextCursor = page.nextCursor ?? null;
    list.status = list.items.length ? "ready" : "empty";
    list.error = null;
    if (!list.query) rememberCatalog(list);
    return { stale: false };
  } catch (error) {
    if (generation !== list.generation || error?.name === "AbortError") return { stale: true };
    if (error?.code === "cursor_expired" && !list.reloading) return reloadFromStart(list, generation);
    list.status = "error";
    list.error = error;
    writeCollection(list.store, list.name, generation, { status: "error", query: list.query });
    return { stale: false, error };
  }
}

export function reloadList(list) {
  list.pendingResolve?.({ stale: true });
  list.pendingResolve = null;
  list.controller?.abort();
  if (list.timer) clearTimeout(list.timer);
  list.timer = null;
  const generation = startCollection(list.store, list.name);
  list.generation = generation;
  list.items = [];
  list.nextCursor = null;
  list.status = "loading";
  list.error = null;
  return loadAll(list, generation);
}

export async function collectPages(api, path, options = {}) {
  const items = [];
  let cursor = null;
  let total = 0;
  let issues = [];
  let commentsRevision = null;
  let guard = 0;
  do {
    const query = { ...(options.query ?? {}), limit: String(options.limit ?? options.query?.limit ?? 100) };
    if (cursor) query.cursor = cursor;
    const send = options.request ?? request;
    const result = await send(api, "GET", path, { params: options.params, query, signal: options.signal });
    const page = result.data ?? {};
    items.push(...(page.items ?? []));
    total = page.total ?? items.length;
    if (page.issues?.length) issues = page.issues;
    commentsRevision = page.commentsRevision ?? commentsRevision;
    cursor = page.nextCursor ?? null;
    guard += 1;
  } while (cursor && guard < 10000);
  return { items, total, issues, nextCursor: cursor, commentsRevision };
}

export async function loadAll(list, generation = list.generation) {
  let guard = 0;
  do {
    const result = await loadNext(list, generation);
    if (result?.stale) return result;
    if (list.status === "error") return result;
    guard += 1;
  } while (list.nextCursor && guard < 10000);
  if (generation === list.generation) list.onUpdate?.();
  return { stale: generation !== list.generation };
}

export function moveFocus(list, rows, direction) {
  if (!rows.length) return null;
  const current = rows.findIndex((row) => row.id === list.focusId);
  let next = current < 0 ? 0 : current;
  if (direction === "home") next = 0;
  else if (direction === "end") next = rows.length - 1;
  else next = Math.max(0, Math.min(rows.length - 1, next + direction));
  list.focusId = rows[next].id;
  const top = next * list.rowHeight;
  const bottom = top + list.rowHeight;
  const height = list.height || list.rowHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + height) list.scrollTop = Math.max(0, bottom - height);
  return list.focusId;
}

export function renderWindow(document, host, list, rows, handlers = {}) {
  host.currentRows = rows;
  host.listHandlers = handlers;
  const height = host.clientHeight || list.height || 0;
  if (height) list.height = height;
  let range = windowRange(list.scrollTop, list.height || height, list.rowHeight, rows.length);
  if (rows.length && range.start >= rows.length) {
    list.scrollTop = 0;
    range = windowRange(0, list.height || height, list.rowHeight, rows.length);
  }
  const before = document.createElement("div");
  before.setAttribute("style", `height:${range.before}px`);
  const after = document.createElement("div");
  after.setAttribute("style", `height:${range.after}px`);
  const visible = rows.slice(range.start, range.end).map((row) => renderRow(document, list, row, handlers));
  host.replaceChildren(before, ...visible, after);
  if (host.scrollTop !== list.scrollTop) host.scrollTop = list.scrollTop;
  bindWindow(host, list);
  const focused = [...host.children].find((node) => node.getAttribute?.("data-id") === list.focusId);
  if (focused && host.ownerDocument?.activeElement !== focused && host.wantsFocus) focused.focus?.();
  return range;
}

function renderRow(document, list, row, handlers) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `row row-${row.kind}`;
  node.setAttribute("data-row", "true");
  node.setAttribute("data-id", row.id);
  node.setAttribute("role", row.kind === "heading" || row.kind === "issue" ? "presentation" : "option");
  node.setAttribute("aria-posinset", String(row.pos ?? 1));
  node.setAttribute("aria-setsize", String(row.setsize ?? 1));
  node.setAttribute("aria-selected", String(Boolean(handlers.selectedId && handlers.selectedId === row.id)));
  node.tabIndex = list.focusId === row.id ? 0 : -1;
  node.style.height = `${list.rowHeight}px`;
  node.style.paddingLeft = `${8 + (row.depth ?? 0) * 14}px`;
  node.textContent = row.text ?? row.label ?? "";
  node.addEventListener("click", (event) => {
    list.focusId = row.id;
    if (row.kind === "group") handlers.onToggle?.(row.groupId);
    else if (row.kind === "more") handlers.onReveal?.(row.groupId, row.count);
    else if (event.detail > 1) handlers.onActivate?.(row, "double");
    else handlers.onActivate?.(row, "single");
  });
  node.addEventListener("focus", () => {
    list.focusId = row.id;
  });
  return node;
}

function bindWindow(host, list) {
  if (host.boundList) return;
  host.boundList = true;
  host.tabIndex = 0;
  host.addEventListener("scroll", () => {
    if (host.rendering) return;
    if (host.scrollTop === list.scrollTop) return;
    list.scrollTop = host.scrollTop;
    host.rendering = true;
    renderWindow(host.ownerDocument, host, list, host.currentRows ?? [], host.listHandlers ?? {});
    host.rendering = false;
  });
  host.addEventListener("keydown", (event) => {
    const rows = host.currentRows ?? [];
    const targetId = event.target?.getAttribute?.("data-id");
    if (targetId) list.focusId = targetId;
    if (host.clientHeight) list.height = host.clientHeight;
    if (event.key === "ArrowDown") moveFocus(list, rows, 1);
    else if (event.key === "ArrowUp") moveFocus(list, rows, -1);
    else if (event.key === "Home") moveFocus(list, rows, "home");
    else if (event.key === "End") moveFocus(list, rows, "end");
    else if (event.key === "Enter") {
      const row = rows.find((item) => item.id === list.focusId);
      if (!row) return;
      if (row.kind === "group") host.listHandlers?.onToggle?.(row.groupId);
      else if (row.kind === "more") host.listHandlers?.onReveal?.(row.groupId, row.count);
      else host.listHandlers?.onActivate?.(row, "keyboard");
    } else return;
    event.preventDefault?.();
    placeFocus(host, list);
    host.ownerDocument.defaultView?.requestAnimationFrame?.(() => {
      if (!host.isConnected || list.focusId == null) return;
      placeFocus(host, list);
    });
  });
}

function placeFocus(host, list) {
  const rows = host.currentRows ?? [];
  if (host.clientHeight) list.height = host.clientHeight;
  const index = rows.findIndex((row) => row.id === list.focusId);
  if (index >= 0) {
    const top = index * list.rowHeight;
    const bottom = top + list.rowHeight;
    const height = list.height || list.rowHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + height) list.scrollTop = Math.max(0, bottom - height);
  }
  host.wantsFocus = true;
  host.rendering = true;
  renderWindow(host.ownerDocument, host, list, rows, host.listHandlers ?? {});
  revealFocused(host, list);
  host.rendering = false;
  host.wantsFocus = false;
}

function revealFocused(host, list) {
  const focused = [...host.children].find((node) => node.getAttribute?.("data-id") === list.focusId);
  if (!focused?.getBoundingClientRect || !host.getBoundingClientRect) return;
  const rowBox = focused.getBoundingClientRect();
  const listBox = host.getBoundingClientRect();
  let delta = 0;
  if (rowBox.top < listBox.top) delta = rowBox.top - listBox.top;
  else if (rowBox.bottom > listBox.bottom + 1) delta = rowBox.bottom - listBox.bottom;
  if (!delta) return;
  list.scrollTop = Math.max(0, list.scrollTop + delta);
  host.scrollTop = list.scrollTop;
}

function rememberCatalog(list) {
  list.catalog = list.items.slice();
  const index = list.name === "chats" ? list.store.indexes.chats : list.store.indexes.units;
  if (list.name === "units" || list.name === "chats") {
    index.clear();
    for (const item of list.items) if (item?.id) index.set(item.id, item);
  }
}

async function reloadFromStart(list, generation) {
  list.reloading = true;
  const focus = list.focusId;
  list.items = [];
  list.nextCursor = null;
  const result = await loadNext(list, generation);
  list.reloading = false;
  if (focus && list.items.some((item) => item.id === focus)) list.focusId = focus;
  return result;
}
