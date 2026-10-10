import {
  answerApproval,
  changeTaskStatus,
  connectUnits,
  createUnit,
  revokeGrant,
  startSession,
  stopSession,
  undoTask,
} from "./actions.mjs";
import {
  createThread,
  incomingMessage,
  loadMessages,
  manageChat,
  openDirectChat,
  openGroupChat,
  openMailbox,
  postMessage,
} from "./chats.mjs";
import { addNode, hitBoardNode, patchNode, releaseAssets, removeNode, renderBoard, uploadAsset } from "./blueprint.mjs";
import { createApi, dispose as disposeApi, request } from "./api.mjs";
import { announce, element, icon, showDialog, showError } from "./components.mjs";
import {
  applyWatch,
  createComment,
  createEditors,
  groupCatalog,
  handleActivity,
  loadCatalog,
  loadComments,
  markDirty,
  noteComment,
  noteRemote,
  openEditor,
  replyComment,
  resolveComment,
  setAttachments,
  startWatch,
  stopWatch,
} from "./editors.mjs";
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup, unitsForTree } from "./hierarchy.mjs";
import { openTaskDetail, renderApproval, renderGrants, renderTask, renderUnit, renderWaiting } from "./inspector.mjs";
import { text } from "./i18n.mjs";
import { createPagedList, loadAll, reloadList, renderWindow, setQuery } from "./lists.mjs";
import { applyRemoteLayout, centerUnit, createMap, keepLocalPosition, renderMap, useIncomingPosition } from "./map.mjs";
import { acceptStreamEvent, createStore, loadSnapshot } from "./state.mjs";
import { synchronize } from "./stream.mjs";

const DESKTOP_MODES = ["map", "blueprint", "document", "focus"];
const PHONE_MODES = ["hierarchy", "chats", "waiting", "map"];

export function presentation(viewer, settings) {
  return {
    look: viewer?.look ?? settings?.look ?? "modern",
    language: viewer?.language ?? settings?.language ?? "en",
  };
}

export function shellLayout(capabilities) {
  if (!capabilities?.length) return "unknown";
  const names = new Set(capabilities);
  return names.has("viewer.write") || names.has("layout.write") ? "desktop" : "phone";
}

export async function mount(root, env = globalThis) {
  const document = root.ownerDocument;
  const api = createApi({
    location: env.location ?? globalThis.location,
    history: env.history ?? globalThis.history,
    fetch: env.fetch,
    clock: env.clock,
  });
  const store = createStore();
  const app = {
    root,
    api,
    store,
    mode: "map",
    tab: "hierarchy",
    look: "modern",
    language: "en",
    layout: "unknown",
    inspectorOpen: false,
    readAt: null,
    sync: "local",
    disposed: false,
    hierarchy: { shown: new Map(), collapsed: new Set() },
    restoreSearch: false,
  };
  renderStatus(app, "loading");
  if (!api.token) {
    renderSignedOut(app);
    return app;
  }
  synchronize(api, store, {
    cursor: () => store.cursor,
    onEvent: (event) => onStream(app, event),
  });
  try {
    await loadSnapshot(store, api);
    await loadPresentation(app);
    await loadLists(app);
  } catch (error) {
    renderFailure(app, error);
  }
  return app;
}

export function navigate(app, mode) {
  const allowed = app.layout === "phone" ? PHONE_MODES : [...DESKTOP_MODES, "settings", "hierarchy", "chats"];
  if (!allowed.includes(mode)) return;
  if (mode === "hierarchy" || mode === "chats") app.tab = mode;
  else app.mode = mode;
  renderShell(app);
}

export function renderShell(app) {
  const document = app.root.ownerDocument;
  const t = (key, variables) => text(app.language, key, variables);
  const view = app.store.view;
  const counts = view?.counts ?? {};
  const shell = element(document, "div", { class: "shell", "data-layout": app.layout === "phone" ? "phone" : "desktop" });
  shell.append(renderBar(app, t, counts), renderWorkspace(app, t, view, counts), renderFooter(app, t));
  if (app.layout === "phone") shell.append(renderPhoneNav(app, t));
  app.root.replaceChildren(shell);
  finishList(app);
  finishMap(app);
}

export function dispose(app) {
  if (!app || app.disposed) return;
  app.disposed = true;
  app.api.live && (app.api.live.stopped = true);
  releaseAssets(app.editors?.current);
  disposeApi(app.api);
}

async function onStream(app, event) {
  if (app.disposed) return;
  await acceptStreamEvent(app.store, app.api, event);
  if (event?.name === "stream.ready" || event?.name === "settings.changed" || event?.name === "viewer.changed") {
    await loadPresentation(app);
    return;
  }
  if (event?.name === "unit.changed" || event?.name === "view.changed") {
    if (app.unitList) await reloadList(app.unitList);
  }
  if (event?.name === "chat.changed") {
    if (app.chatList) await reloadList(app.chatList);
  }
  if (event?.name === "layout.changed" && app.mapState) applyRemoteLayout(app.mapState, event);
  if (event?.name === "session.changed") noteSession(app, event.envelope?.data ?? {});
  if (event?.name === "approval.changed") noteApproval(app, event.envelope?.data ?? {});
  if (event?.name === "message.created" && app.thread?.chat?.id === event.envelope?.data?.chatId) {
    incomingMessage(app.thread, event.envelope.data.message);
  }
  const editors = app.editors;
  const data = event?.envelope?.data ?? {};
  if (editors && event?.name === "comment.changed") noteComment(editors, data);
  if (editors && (event?.name === "blueprint.changed" || event?.name === "void.changed")) noteRemote(editors, data);
  if (editors && event?.name === "editor.activity") handleActivity(editors, data);
  if (editors && event?.name === "watch.changed") {
    const nextId = applyWatch(editors, data);
    const summary = nextId ? editors.catalog.find((item) => item.id === nextId) : null;
    if (summary) await openEditor(app.api, editors, summary);
  }
  if (editors?.current?.commentsStale) {
    try {
      await loadComments(app.api, editors);
    } catch (error) {
      editors.error = error;
    }
  }
  if (app.layout !== "unknown") renderShell(app);
}

async function loadPresentation(app) {
  const ticket = (app.presentationTicket ?? 0) + 1;
  app.presentationTicket = ticket;
  const settings = await request(app.api, "GET", "/settings");
  if (app.disposed || ticket !== app.presentationTicket) return;
  app.store.settings = settings.data;
  app.readAt = settings.meta.readAt;
  app.sync = settings.meta.sync;
  if (app.store.capabilities.includes("viewer.write")) {
    const viewer = await request(app.api, "GET", "/viewer");
    if (app.disposed || ticket !== app.presentationTicket) return;
    app.store.viewer = viewer.data;
    app.readAt = viewer.meta.readAt;
    app.sync = viewer.meta.sync;
  }
  if (ticket !== app.presentationTicket) return;
  const choice = presentation(app.store.viewer, app.store.settings?.settings);
  app.look = choice.look === "high-contrast" ? "high-contrast" : "modern";
  app.language = choice.language === "es" ? "es" : "en";
  app.layout = shellLayout(app.store.capabilities);
  publish(app);
}

function publish(app) {
  if (app.disposed || app.layout === "unknown") {
    renderStatus(app, "loadingView");
    return;
  }
  const document = app.root.ownerDocument;
  document.documentElement.lang = app.language;
  document.documentElement.dataset.look = app.look;
  renderShell(app);
  announce(app.root, text(app.language, "loadingView"));
}

function renderBar(app, t, counts) {
  const document = app.root.ownerDocument;
  const modes = element(document, "div", { class: "modes", role: "toolbar" });
  for (const mode of DESKTOP_MODES) {
    modes.append(element(document, "button", {
      type: "button",
      class: "mode",
      "aria-pressed": String(app.mode === mode),
      onclick: () => navigate(app, mode),
    }, icon(document, mode), t(mode)));
  }
  const waiting = element(document, "span", { class: "pill" }, icon(document, "waiting"), t("waitingCount", { count: counts.waiting ?? 0 }));
  const settings = element(document, "button", {
    type: "button",
    class: "icon-button",
    "aria-pressed": String(app.mode === "settings"),
    "aria-label": t("settings"),
    onclick: () => navigate(app, "settings"),
  }, icon(document, "settings"));
  const inspector = element(document, "button", {
    type: "button",
    class: "icon-button",
    "aria-label": t(app.inspectorOpen ? "closeInspector" : "openInspector"),
    onclick: () => {
      app.inspectorTouched = true;
      app.inspectorOpen = !app.inspectorOpen;
      renderShell(app);
    },
  }, icon(document, "waiting"));
  return element(document, "header", { class: "bar" }, brand(document), modes, waiting, inspector, settings);
}

function renderWorkspace(app, t, view, counts) {
  const document = app.root.ownerDocument;
  const tabs = element(document, "div", { class: "tabs", role: "tablist" });
  for (const tab of ["hierarchy", "chats"]) {
    tabs.append(element(document, "button", {
      type: "button",
      class: "tab",
      role: "tab",
      "aria-pressed": String(app.tab === tab),
      onclick: () => navigate(app, tab),
    }, icon(document, tab), t(tab)));
  }
  const summary = element(document, "section", { class: "summary" },
    element(document, "h2", { text: t("summaryTitle") }),
    element(document, "div", { class: "counts" },
      element(document, "span", { text: t("unitCount", { count: counts.units ?? app.unitList?.catalog?.length ?? 0 }) }),
      element(document, "span", { text: t("unreadCount", { count: counts.unread ?? 0 }) }),
      element(document, "span", { text: t("issueCount", { count: counts.issues ?? 0 }) }),
    ),
  );
  const issueItems = view?.issues ?? app.unitList?.issues ?? [];
  const issues = element(document, "section", { class: "summary" }, element(document, "h2", { text: t("issuesTitle") }));
  for (const issue of issueItems) issues.append(element(document, "p", { class: "issue", text: issue.message }));
  if (!issueItems.length) issues.append(element(document, "p", { text: t("emptyList") }));
  const collection = renderCollection(app, t);
  const side = element(document, "aside", { class: "panel side" }, tabs, summary, issues, collection);
  const stage = element(document, "section", { class: "panel stage" },
    element(document, "h2", { text: t(app.mode) }),
  );
  if (app.mode === "map") {
    ensureMap(app);
    stage.append(element(document, "div", { class: "map" }));
  } else if (app.mode === "blueprint" || app.mode === "document") {
    stage.append(renderEditor(app, t));
  } else {
    stage.append(element(document, "p", { text: app.store.mode === "paged" ? t("viewTooLarge") : t("later") }));
  }
  const selected = app.store.indexes.units.get(app.store.selected.unitId)
    ?? app.unitList?.catalog?.find((unit) => unit.id === app.store.selected.unitId)
    ?? null;
  const inspectorBody = element(document, "div", { class: "inspector-body" },
    element(document, "h2", { text: selected ? `${selected.unit} ${t(statusKey(selected.status))}` : t("emptyInspector") }),
  );
  if (app.actionNote) {
    inspectorBody.append(element(document, "p", {
      class: "action-note",
      "data-action-note": "true",
      "data-request": app.sessionRequestId ?? "",
      "data-answer": app.answerId ?? "",
      text: app.actionNote,
    }));
  }
  inspectorBody.append(actionControls(app, t, selected));
  inspectorBody.append(chatPanel(app, t));
  inspectorBody.append(renderInspector(app, t, selected));
  const inspector = element(document, "aside", {
    class: `panel inspector${app.inspectorOpen ? " is-open" : ""}`,
  }, inspectorBody);
  return element(document, "div", { class: "workspace" }, side, stage, inspector);
}

async function loadLists(app) {
  app.unitList = createPagedList({ api: app.api, store: app.store, name: "units", route: "/units" });
  app.chatList = createPagedList({ api: app.api, store: app.store, name: "chats", route: "/chats", filters: { listed: "true" } });
  const refresh = () => {
    if (!app.disposed && app.layout !== "unknown") renderShell(app);
  };
  app.unitList.onUpdate = refresh;
  app.chatList.onUpdate = refresh;
  try {
    const layout = await request(app.api, "GET", "/layout");
    if (!app.disposed) app.store.layout = layout.data;
  } catch {
    // Placement still runs when the layout route is unavailable.
  }
  await Promise.all([loadAll(app.unitList), loadAll(app.chatList)]);
}

function renderCollection(app, t) {
  const document = app.root.ownerDocument;
  const list = app.tab === "chats" ? app.chatList : app.unitList;
  const block = element(document, "div", { class: "list-block" });
  if (!list) {
    block.append(element(document, "p", { text: t("loadingList") }));
    return block;
  }
  if (app.layout === "phone") list.rowHeight = 44;
  const search = element(document, "input", {
    class: "search",
    type: "search",
    value: list.query,
    placeholder: t("search"),
    "aria-label": t("search"),
    oninput: (event) => {
      app.restoreSearch = true;
      setQuery(list, event.target.value);
    },
  });
  const status = list.status === "error" ? t("listError") : list.status === "loading" ? t("loadingList") : t("listTotal", { count: list.total ?? 0 });
  const total = element(document, "p", { class: "list-total", "data-total": String(list.total ?? ""), text: status });
  const host = element(document, "div", { class: "list", role: "listbox", "aria-label": t(app.tab) });
  const rows = collectionRows(app, t, list);
  const handlers = {
    selectedId: app.tab === "chats" ? app.store.selected.chatId : app.store.selected.unitId,
    onActivate: (row, kind) => {
      if (row.kind === "chat") {
        app.store.selected.chatId = row.id;
        app.activated = { id: row.id, kind };
      } else if (row.unit) activateUnit(app, row.unit, kind);
      renderShell(app);
    },
    onToggle: (groupId) => {
      toggleGroup(app.hierarchy, groupId);
      renderShell(app);
    },
    onReveal: (groupId, count) => {
      revealGroup(app.hierarchy, groupId, count);
      renderShell(app);
    },
  };
  app.activeList = list;
  app.activeRows = rows;
  app.activeHandlers = handlers;
  block.append(search, total, host);
  return block;
}

function editorsOf(app) {
  if (!app.editors) app.editors = createEditors();
  return app.editors;
}

function queueCatalog(app, kind) {
  const editors = editorsOf(app);
  if (editors.loadedKind === kind || editors.catalogLoading) return;
  editors.catalogLoading = true;
  loadCatalog(app.api, editors, kind, editors.query ?? "").then(() => {
    editors.catalogLoading = false;
    if (!app.disposed) renderShell(app);
  }).catch((error) => {
    editors.catalogLoading = false;
    editors.loadedKind = kind;
    editors.error = error;
    if (!app.disposed) renderShell(app);
  });
}

function boardSurface(app, document, editor, t) {
  const host = element(document, "div", { class: "board-host" });
  editor.focus = app.editors.focus;
  renderBoard(document, host, editor);
  host.addEventListener("click", (event) => {
    const marked = event.target?.closest?.("[data-node]");
    const svg = host.querySelector("svg");
    const point = boardPoint(svg, event);
    const hit = marked ? { nodeId: marked.getAttribute("data-node"), screenId: marked.closest("[data-screen]")?.getAttribute("data-screen") } : hitBoardNode(editor.authoritative.document, point);
    if (!hit?.nodeId) return;
    app.editors.selectedNodeId = hit.nodeId;
    app.editors.focus = { ...(app.editors.focus ?? {}), screenId: hit.screenId, resourceId: editor.resourceId };
    renderShell(app);
  });
  const nodes = editor.authoritative.document.screens?.[0];
  const tools = element(document, "div", { class: "editor-actions" });
  const name = element(document, "input", { "data-node-name": "true", "aria-label": t("nodeName") });
  tools.append(name);
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "patch-node",
    onclick: () => patchNode(app.api, editor, app.editors.selectedNodeId, { name: name.value, value: name.value }).then(() => renderShell(app)).catch((error) => noteEditor(app, error)),
  }, t("nodeName")));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "add-node",
    onclick: () => addBoardShape(app, editor, nodes),
  }, t("addShape")));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "remove-node",
    onclick: () => removeNode(app.api, editor, app.editors.selectedNodeId).then(() => renderShell(app)).catch((error) => noteEditor(app, error)),
  }, t("removeShape")));
  const file = element(document, "input", { type: "file", accept: "image/png,image/jpeg,image/webp", "data-asset": "true" });
  file.addEventListener("change", () => {
    const selected = file.files?.[0];
    if (!selected) return;
    uploadAsset(app.api, editor, selected).then((asset) => addImageNode(app, editor, nodes, asset)).catch((error) => noteEditor(app, error));
  });
  tools.append(file);
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "comment-node",
    onclick: () => commentOnNode(app, editor),
  }, t("comment")));
  return element(document, "div", {}, host, tools);
}

function addBoardShape(app, editor, screen) {
  const count = (app.editors.shapeCount ?? 0) + 1;
  app.editors.shapeCount = count;
  addNode(app.api, editor, {
    screenId: screen.id,
    parentId: screen.root.id,
    node: { id: `added-${count}`, name: "Added", t: "box", place: { x: 16, y: 16 }, w: 40, h: 40, dir: "stack", kids: [] },
  }).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function addImageNode(app, editor, screen, asset) {
  const count = (app.editors.shapeCount ?? 0) + 1;
  app.editors.shapeCount = count;
  addNode(app.api, editor, {
    screenId: screen.id,
    parentId: screen.root.id,
    node: { id: `image-${count}`, name: "Image", t: "image", place: { x: 20, y: 48 }, w: 32, h: 32, src: asset.src },
  }).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function commentOnNode(app, editor) {
  const board = editor.authoritative.document;
  const selected = app.editors.selectedNodeId;
  let screen = board.screens?.[0];
  let node = screen?.root;
  for (const item of board.screens ?? []) {
    const found = findBoardNode(item.root, selected);
    if (found) {
      screen = item;
      node = found;
    }
  }
  const text = editor.commentText || "On the node.";
  createComment(app.api, app.editors, {
    screen: screen.id,
    screenTitle: screen.title,
    element: node.id,
    label: node.name ?? node.id,
    path: [node.name ?? node.id],
    point: { x: Math.round(node.place?.x ?? 0), y: Math.round(node.place?.y ?? 0) },
  }, text).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function findBoardNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.kids ?? []) {
    const found = findBoardNode(child, id);
    if (found) return found;
  }
  return null;
}

function boardPoint(svg, event) {
  if (!svg?.createSVGPoint || !svg.getScreenCTM) return { x: event.offsetX ?? 0, y: event.offsetY ?? 0 };
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(svg.getScreenCTM().inverse());
  return { x: local.x, y: local.y };
}

function renderEditor(app, t) {
  const document = app.root.ownerDocument;
  const editors = editorsOf(app);
  const kind = app.mode === "document" ? "void" : "blueprint";
  queueCatalog(app, kind);
  const current = editors.current?.kind === kind ? editors.current : null;
  const title = current?.authoritative?.title ?? current?.authoritative?.legacy?.id ?? t(app.mode);
  const watch = editors.watch;
  const watchText = !watch || watch.state === "off" ? t("watchOff") : watch.state === "watching" ? t("watching", { unit: watch.unitId }) : t("watchWaiting", { unit: watch.unitId });
  const panel = element(document, "div", { class: "editor-panel" });
  panel.append(element(document, "h2", { "data-editor-title": title, "data-editor-kind": kind, text: `${t(app.mode)} ${title}` }));
  panel.append(element(document, "p", { "data-watch": watch?.state ?? "off", text: watchText }));
  if (current?.conflict) panel.append(element(document, "p", { "data-conflict": "true", text: t("outsideChange") }));
  if (current?.kind === "blueprint" && current.authoritative?.document) panel.append(boardSurface(app, document, current, t));
  if (current?.authoritative?.legacy?.reason === "conversion_required") {
    panel.append(element(document, "p", { "data-legacy": current.authoritative.legacy.path ?? "", text: t("conversionRequired") }));
  }
  if (editors.error?.code === "corrupt_resource") panel.append(element(document, "p", { text: t("corruptResource") }));
  const list = element(document, "div", { class: "editor-list" });
  for (const group of groupCatalog(editors.catalog)) {
    for (const item of group.items) {
      list.append(element(document, "button", {
        type: "button",
        class: "btn",
        "data-resource": item.id,
        "aria-pressed": String(current?.resourceId === item.id),
        onclick: () => selectEditor(app, item),
      }, `${group.project} ${item.title}`));
    }
  }
  panel.append(list);
  if (!current) return panel;
  const draft = element(document, "textarea", {
    class: "editor-compose",
    "data-draft": current.resourceId,
    oninput: (event) => {
      current.draftText = event.target.value;
      markDirty(app.api, editors, app.store.capabilities, true);
    },
  });
  draft.value = current.draftText ?? "";
  panel.append(draft);
  const attached = new Set(current.attached ?? []);
  const picker = element(document, "div", { class: "attach-list", "data-attached": [...attached].join(" ") });
  for (const unit of app.unitList?.catalog ?? []) {
    const box = element(document, "label", {},
      element(document, "input", { type: "checkbox", "data-unit": unit.id, ...(attached.has(unit.id) ? { checked: "true" } : {}) }),
      ` ${unit.unit}`,
    );
    picker.append(box);
  }
  const actions = element(document, "div", { class: "editor-actions" });
  actions.append(element(document, "button", { type: "button", class: "btn", "data-action": "attach", onclick: () => saveAttachments(app, picker) }, t("attach")));
  actions.append(element(document, "button", { type: "button", class: "btn", "data-action": "watch", onclick: () => followEditor(app, picker) }, t("watch")));
  actions.append(element(document, "button", { type: "button", class: "btn", "data-action": "stop-watch", onclick: () => stopWatch(app.api, editors).then(() => renderShell(app)).catch((error) => noteEditor(app, error)) }, t("stopWatch")));
  panel.append(picker, actions);
  const comments = element(document, "div", { class: "editor-comments" });
  for (const thread of current.threads ?? []) {
    const box = element(document, "article", { class: "comment-box", "data-thread": thread.id, "data-status": thread.status ?? "open" });
    box.append(element(document, "p", { text: (thread.messages ?? []).map((message) => message.text).join(" ") }));
    box.append(element(document, "button", { type: "button", class: "btn", "data-action": "reply", onclick: () => replyToThread(app, thread.id) }, t("reply")));
    box.append(element(document, "button", { type: "button", class: "btn", "data-action": "resolve", onclick: () => resolveThread(app, thread.id) }, t("resolve")));
    comments.append(box);
  }
  const compose = element(document, "textarea", {
    "data-comment": "true",
    oninput: (event) => { current.commentText = event.target.value; },
  });
  compose.value = current.commentText ?? "";
  panel.append(comments, compose, element(document, "button", {
    type: "button",
    class: "btn primary",
    "data-action": "comment",
    onclick: () => addEditorComment(app, compose),
  }, t("addComment")));
  const noticeCopy = { pending: "queued", queued: "queued", submitted: "submitted", ambiguous: "ambiguous", failed: "failed" };
  for (const notice of current.notices ?? []) {
    const key = noticeCopy[notice.state];
    if (!key) continue;
    panel.append(element(document, "p", { "data-notice": notice.state, text: t(key) }));
  }
  return panel;
}

function selectEditor(app, summary) {
  const editors = editorsOf(app);
  app.store.selected.resourceId = summary.id;
  app.store.open.editors.set(summary.id, summary.kind);
  app.store.open.comments.add(summary.id);
  openEditor(app.api, editors, summary).then(() => {
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteEditor(app, error));
}

function checkedUnits(picker) {
  return [...picker.querySelectorAll("input[data-unit]")].filter((input) => input.checked).map((input) => input.getAttribute("data-unit"));
}

function saveAttachments(app, picker) {
  setAttachments(app.api, editorsOf(app), checkedUnits(picker)).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function followEditor(app, picker) {
  const editors = editorsOf(app);
  const unitId = checkedUnits(picker)[0] ?? editors.current?.attached?.[0];
  if (!unitId || !editors.current) return;
  startWatch(app.api, editors, { unitId, resourceId: editors.current.resourceId }).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function addEditorComment(app, compose) {
  const editors = editorsOf(app);
  const current = editors.current;
  if (!current) return;
  current.commentText = compose.value;
  createComment(app.api, editors, { quote: compose.value }, compose.value).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function replyToThread(app, threadId) {
  const editors = editorsOf(app);
  const text = editors.current?.commentText || "Noted.";
  replyComment(app.api, editors, threadId, text).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function resolveThread(app, threadId) {
  resolveComment(app.api, editorsOf(app), threadId).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function noteEditor(app, error) {
  if (app.editors) app.editors.error = error;
  noteAction(app, error);
}

function ensureMap(app) {
  const units = app.unitList?.catalog?.length ? app.unitList.catalog : [...(app.store.indexes.units?.values?.() ?? [])];
  const saved = app.store.layout?.layout ?? { nodes: {}, groups: {} };
  if (!app.mapState) app.mapState = createMap({ units, saved, api: app.api });
  else app.mapState.units = units;
  app.mapState.api = app.api;
  app.mapState.persist = Boolean(app.store.capabilities?.includes("layout.write"));
  app.mapState.onSelect = (id) => {
    app.store.selected.unitId = id;
    loadInspector(app, id);
    if (!app.disposed) renderShell(app);
  };
  app.mapState.onConnect = (pending) => confirmConnection(app, pending.source, [pending.target]);
  app.mapState.onGroupConnect = (pending) => confirmConnection(app, pending.source, pending.targets ?? []);
  app.mapState.onGroupMessage = (ids) => {
    openGroupChat(app.api, ids).then((result) => showChat(app, result.data)).catch((error) => noteAction(app, error));
  };
  return app.mapState;
}

function finishMap(app) {
  const host = app.root.querySelector?.(".map");
  if (!host || !app.mapState) return;
  const rect = host.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 760, height: 700 };
  if (app.pendingCenter) {
    centerUnit(app.mapState, app.pendingCenter, rect);
    app.pendingCenter = null;
  }
  app.mapState.labels = {
    messageGroup: text(app.language, "messageGroup"),
    connect: text(app.language, "connect"),
  };
  renderMap(app.root.ownerDocument, host, app.mapState, app.mapState.labels);
  takePendingChat(app);
  const view = app.root.ownerDocument.defaultView;
  if (!host.clientWidth && view?.requestAnimationFrame && !app.mapFramed) {
    app.mapFramed = true;
    view.requestAnimationFrame(() => {
      app.mapFramed = false;
      if (!app.disposed && host.isConnected) finishMap(app);
    });
  }
}

function finishList(app) {
  const host = app.root.querySelector?.(".list");
  if (!host || !app.activeList) return;
  renderWindow(app.root.ownerDocument, host, app.activeList, app.activeRows ?? [], app.activeHandlers ?? {});
  const view = app.root.ownerDocument.defaultView;
  if (!host.clientHeight && view?.requestAnimationFrame) {
    view.requestAnimationFrame(() => {
      if (app.disposed || !host.isConnected) return;
      renderWindow(app.root.ownerDocument, host, app.activeList, app.activeRows ?? [], app.activeHandlers ?? {});
    });
  }
  if (app.restoreSearch) app.root.querySelector?.(".search")?.focus?.();
}

function collectionRows(app, t, list) {
  if (app.tab === "chats") {
    return list.items.map((chat, index) => ({
      id: chat.id,
      kind: "chat",
      chat,
      depth: 0,
      text: chat.title || chat.id,
      pos: index + 1,
      setsize: list.items.length,
    }));
  }
  const source = unitsForTree(list.query ? list.items : list.catalog, list.catalog);
  const tree = buildHierarchy(source, list.issues);
  const rows = flattenVisibleHierarchy(tree, app.hierarchy, list.query);
  const labels = new Map();
  for (const row of rows) if (row.kind === "unit") labels.set(row.label, (labels.get(row.label) ?? 0) + 1);
  for (const row of rows) {
    if (row.kind === "unit") {
      const scope = row.unit.scope?.name;
      const name = labels.get(row.label) > 1 && scope ? `${row.label} · ${scope}` : row.label;
      row.text = `${name} ${t(statusKey(row.unit.status))}`;
    } else if (row.labelKey === "showMore") row.text = t("showMore", { count: row.count });
    else if (row.labelKey) row.text = t(row.labelKey);
    else row.text = row.label ?? "";
  }
  return rows;
}

function statusKey(status) {
  if (status === "out") return "statusOut";
  if (status === "quota") return "statusQuota";
  if (status === "waiting") return "statusWaiting";
  if (status === "working") return "statusWorking";
  if (status === "idle") return "statusIdle";
  return "statusUnknown";
}

function renderFooter(app, t) {
  const document = app.root.ownerDocument;
  const machine = app.store.settings?.service?.machine ?? app.store.view?.mind?.machine ?? "";
  const syncKey = app.store.settings?.service?.syncState === "error" ? "syncError" : syncCopy(app.sync);
  const time = clockText(app.readAt);
  return element(document, "footer", { class: "foot" },
    element(document, "span", { text: t("serviceRunning", { machine }) }),
    element(document, "span", { text: t(syncKey) }),
    element(document, "span", { text: t("lastRead", { time }) }),
  );
}

function renderPhoneNav(app, t) {
  const document = app.root.ownerDocument;
  const nav = element(document, "nav", { class: "phone-nav" });
  for (const mode of PHONE_MODES) {
    nav.append(element(document, "button", {
      type: "button",
      "aria-pressed": String(app.mode === mode || app.tab === mode),
      onclick: () => navigate(app, mode),
    }, icon(document, mode === "waiting" ? "waiting" : mode), t(mode)));
  }
  return nav;
}

function renderSignedOut(app) {
  const document = app.root.ownerDocument;
  const t = (key) => text(app.language, key);
  app.root.replaceChildren(element(document, "section", { class: "gate" },
    element(document, "h2", { text: t("reopenTitle") }),
    element(document, "p", { text: app.api.homeKey ? t("homePrompt") : t("reopenBody") }),
  ));
}

function renderFailure(app, error) {
  const document = app.root.ownerDocument;
  const key = error?.status === 401 || error?.status === 410 ? "sessionExpired" : "unavailable";
  app.root.replaceChildren(element(document, "section", { class: "gate" },
    element(document, "h2", { text: text(app.language, key) }),
    element(document, "button", {
        type: "button",
        class: "btn",
        text: text(app.language, "retry"),
        onclick: () => {
          dispose(app);
          mount(app.root);
        },
    }),
  ));
  if (document.body?.append) {
    try {
      showError(document, { title: text(app.language, "unavailable"), message: text(app.language, key), close: text(app.language, "close") });
    } catch {
      // The status region already reports the failure when a dialog cannot open.
    }
  }
}

function renderStatus(app, key) {
  const document = app.root.ownerDocument;
  app.root.replaceChildren(element(document, "p", { id: "status", role: "status", text: text(app.language, key) }));
}

function brand(document) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "mark");
  svg.setAttribute("viewBox", "0 0 56 48");
  svg.setAttribute("aria-hidden", "true");
  const one = document.createElementNS("http://www.w3.org/2000/svg", "path");
  one.setAttribute("class", "one");
  one.setAttribute("d", "M14 2 26 9 26 23 14 30 2 23 2 9 Z");
  const two = document.createElementNS("http://www.w3.org/2000/svg", "path");
  two.setAttribute("class", "two");
  two.setAttribute("d", "M30 18 42 25 42 39 30 46 18 39 18 25 Z");
  svg.append(one, two);
  return element(document, "div", { class: "brand" }, svg, "HIVEM1ND");
}

function syncCopy(sync) {
  if (sync === "pending") return "syncPending";
  if (sync === "published") return "syncPublished";
  if (sync === "error") return "syncError";
  return "syncLocal";
}

function clockText(value) {
  const match = String(value ?? "").match(/T(\d{2}:\d{2})/);
  return match ? `${match[1]} UTC` : "";
}

const SESSION_COPY = {
  queued: "sessionQueued",
  starting: "sessionStarting",
  started: "sessionStarted",
  failed: "sessionFailed",
  expired: "sessionExpired",
  stopping: "sessionStopping",
  stopped: "sessionStopped",
};

function actionControls(app, t, selected) {
  const document = app.root.ownerDocument;
  const row = element(document, "div", { class: "action-row" });
  const caps = app.store.capabilities ?? [];
  if (caps.includes("unit.create")) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "new-unit", text: t("newUnit"), onclick: () => openUnitForm(app) }));
  }
  if (selected && caps.includes("session.start")) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "start-session", text: t("startSession"), onclick: () => openSessionForm(app, selected) }));
  }
  const sessionId = selected?.sessionIds?.[0];
  if (sessionId && caps.includes("session.stop")) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "stop-session", "data-session": sessionId, text: t("stopSession"), onclick: () => confirmStop(app, sessionId) }));
  }
  for (const id of app.mapState?.layoutConflict?.ids ?? []) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "keep-local", text: t("keepLocal"), onclick: () => keepLocalPosition(app.mapState, id) }));
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "use-incoming", text: t("useIncoming"), onclick: () => useIncomingPosition(app.mapState, id) }));
  }
  return row;
}

function confirmConnection(app, sourceId, targetIds) {
  const source = unitById(app, sourceId);
  const targets = targetIds.map((id) => unitById(app, id)).filter(Boolean);
  if (!source || !targets.length) return;
  const body = targets.map((target) => text(app.language, "confirmConnect", { member: target.unit, lead: source.unit })).join(" ");
  showDialog(app.root.ownerDocument, {
    title: text(app.language, "connect"),
    body,
    confirm: text(app.language, "connect"),
    cancel: text(app.language, "cancel"),
    onConfirm: async () => {
      const results = await connectUnits(app.api, source, targets);
      app.actionNote = results.map((result) => result.error ? `${result.id ?? "unit"} ${result.error.code}` : `${result.id} ${result.data?.leadId ?? ""}`).join(" ");
      if (app.unitList) await reloadList(app.unitList);
      if (!app.disposed) renderShell(app);
    },
  });
}

function openUnitForm(app) {
  openFields(app, text(app.language, "newUnit"), [
    ["unit", "unitName", "executor-made"],
    ["role", "role", "executor"],
    ["scopeKind", "scopeKind", "project"],
    ["scopeName", "scopeName", "shop"],
    ["machine", "machine", "DESKTOP"],
  ], async (values) => {
    try {
      await createUnit(app.api, {
        unit: values.unit,
        role: values.role,
        scope: { kind: values.scopeKind, name: values.scopeName || null },
        machine: values.machine,
        leadId: null,
        job: null,
        model: null,
      });
      app.actionNote = values.unit;
      if (app.unitList) await reloadList(app.unitList);
    } catch (error) {
      app.actionNote = error?.code === "machine_unavailable"
        ? text(app.language, "machineUnavailable", { machine: error.details?.machine ?? values.machine })
        : `${error?.code ?? "request_failed"}`;
    }
    if (!app.disposed) renderShell(app);
  });
}

function openSessionForm(app, unit) {
  openFields(app, text(app.language, "startSession"), [
    ["client", "client", "cursor"],
    ["prompt", "prompt", ""],
  ], async (values) => {
    try {
      const started = await startSession(app.api, unit, values.client, values.prompt || null);
      app.sessionRequestId = started.data.requestId;
      app.actionNote = text(app.language, SESSION_COPY[started.data.state] ?? "actionFailed");
    } catch (error) {
      app.actionNote = error?.code ?? "request_failed";
    }
    if (!app.disposed) renderShell(app);
  });
}

function confirmStop(app, sessionId) {
  showDialog(app.root.ownerDocument, {
    title: text(app.language, "stopSession"),
    body: text(app.language, "sessionStopping"),
    confirm: text(app.language, "stopSession"),
    cancel: text(app.language, "cancel"),
    onConfirm: async () => {
      try {
        const stopped = await stopSession(app.api, sessionId);
        app.actionNote = text(app.language, SESSION_COPY[stopped.data.state] ?? "sessionStopping");
      } catch (error) {
        app.actionNote = error?.code ?? "request_failed";
      }
      if (!app.disposed) renderShell(app);
    },
  });
}

function openFields(app, title, fields, onConfirm) {
  const document = app.root.ownerDocument;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  const form = element(document, "form", { method: "dialog" });
  form.append(element(document, "h2", { text: title }));
  for (const [name, label, value] of fields) {
    const input = element(document, "input", { name, value, "aria-label": text(app.language, label) });
    form.append(element(document, "label", { text: text(app.language, label) }, input));
  }
  const actions = element(document, "div", { class: "dialog-actions" });
  const cancel = element(document, "button", { type: "button", class: "btn", text: text(app.language, "cancel") });
  const confirm = element(document, "button", { type: "submit", class: "btn primary", text: title });
  cancel.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(fields.map(([name]) => [name, form.elements[name].value]));
    dialog.close();
    await onConfirm(values);
  });
  actions.append(cancel, confirm);
  form.append(actions);
  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function noteSession(app, data) {
  const state = data.request?.state ?? data.session?.state;
  if (!state || !SESSION_COPY[state]) return;
  if (data.request?.requestId) app.sessionRequestId = data.request.requestId;
  app.actionNote = text(app.language, SESSION_COPY[state]);
}

function chatPanel(app, t) {
  const document = app.root.ownerDocument;
  const thread = app.thread;
  const panel = element(document, "section", { class: "chat-panel" });
  if (!thread?.chat) return panel;
  const transcript = element(document, "div", {
    class: "transcript",
    "data-chat": thread.chat.id,
    "data-members": String(thread.chat.members?.length ?? 0),
    "data-total": String(thread.total ?? thread.messages.length),
    "data-pinned": String(Boolean(thread.chat.pinned)),
    "data-listed": String(thread.chat.listed !== false),
  });
  if (!thread.messages.length) transcript.append(element(document, "p", { "data-empty": "true", text: t("emptyChat") }));
  for (const message of thread.messages) {
    transcript.append(element(document, "p", { "data-message": message.id, text: message.body || message.subject || "" }));
  }
  if (thread.unseen) transcript.append(element(document, "p", { "data-new-messages": "true", text: t("newMessages") }));
  const row = element(document, "div", { class: "action-row" });
  row.append(element(document, "button", { type: "button", class: "btn", "data-action": "pin", text: t("pin"), onclick: () => changeChat(app, { pinned: true }) }));
  row.append(element(document, "button", { type: "button", class: "btn", "data-action": "unlist", text: t("removeFromList"), onclick: () => changeChat(app, { listed: false }) }));
  row.append(element(document, "button", { type: "button", class: "btn", "data-action": "reopen", text: t("reopenChat"), onclick: () => changeChat(app, { listed: true }) }));
  row.append(element(document, "button", { type: "button", class: "btn", "data-action": "older", text: t("loadOlder"), onclick: () => loadOlder(app) }));
  row.append(element(document, "button", { type: "button", class: "btn", "data-action": "mailbox", text: t("mailbox"), onclick: () => inspectMailbox(app) }));
  const composer = element(document, "input", { class: "composer", "data-composer": "true", value: thread.composer, "aria-label": t("send") });
  const send = element(document, "button", { type: "button", class: "btn primary", "data-action": "send", text: t("send"), onclick: () => submitComposer(app, composer) });
  panel.append(transcript, row, composer, send);
  if (app.mailboxNote) panel.append(element(document, "p", { class: "action-note", "data-mailbox": "true", text: app.mailboxNote }));
  return panel;
}

function takePendingChat(app) {
  const pending = app.pendingChat;
  if (!pending || app.chatOpening) return;
  app.pendingChat = null;
  if (!pending.create) return;
  app.chatOpening = true;
  openDirectChat(app.api, [pending.unitId]).then((result) => showChat(app, result.data)).catch((error) => noteAction(app, error)).finally(() => { app.chatOpening = false; });
}

function showChat(app, chat) {
  app.thread = createThread(chat);
  return loadMessages(app.api, app.thread).then(() => {
    if (!app.disposed) renderShell(app);
  });
}

function changeChat(app, change) {
  const chat = app.thread?.chat;
  if (!chat) return;
  manageChat(app.api, chat, change).then((result) => {
    app.thread.chat = result.data;
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function loadOlder(app) {
  const host = app.root.querySelector?.(".transcript");
  const anchor = host?.querySelector?.("[data-message]");
  if (app.thread) app.thread.anchorOffset = anchor?.offsetTop ?? 0;
  const older = Boolean(app.thread.nextCursor);
  loadMessages(app.api, app.thread, older).then(() => {
    if (app.disposed) return;
    renderShell(app);
    const next = app.root.querySelector?.(".transcript");
    const node = next?.querySelector?.(`[data-message="${app.thread.anchorId}"]`);
    if (next && node) next.scrollTop += node.offsetTop - (app.thread.anchorOffset ?? 0);
  }).catch((error) => noteAction(app, error));
}

function inspectMailbox(app) {
  const unitId = app.store.selected.unitId;
  if (!unitId) return;
  openMailbox(app.api, unitId, "all").then((result) => {
    const first = result.data.items?.[0];
    app.mailboxNote = first ? `${result.data.total} read:${first.read}` : `${result.data.total ?? 0} mailbox`;
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function submitComposer(app, composer) {
  app.thread.composer = composer.value;
  postMessage(app.api, app.thread, { body: composer.value }).then(() => {
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function noteAction(app, error) {
  app.actionNote = error?.code ?? "request_failed";
  if (!app.disposed) renderShell(app);
}

function renderInspector(app, t, selected) {
  const document = app.root.ownerDocument;
  const panel = element(document, "div", { class: "review-panel" });
  if (selected) panel.append(renderUnit(document, selected, t));
  const data = app.inspectorData;
  if (!data || data.unitId !== selected?.id) return panel;
  panel.append(renderGrants(document, data.grants, t, (grant) => revokeSelectedGrant(app, selected, grant)));
  for (const approval of data.approvals ?? []) panel.append(renderApproval(document, approval, t, (item, decision) => answerSelected(app, item, decision)));
  for (const task of data.tasks ?? []) {
    panel.append(renderTask(document, task, t, (item, status, note) => setTaskStatus(app, item, status, note), (item) => undoSelected(app, item)));
    panel.append(openTaskDetail(document, task, t));
  }
  panel.append(renderWaiting(document, data.waiting, t));
  return panel;
}

function loadInspector(app, unitId) {
  const ticket = (app.inspectorTicket ?? 0) + 1;
  app.inspectorTicket = ticket;
  Promise.all([
    request(app.api, "GET", "/tasks", { query: { unitId, status: "open,review,done,closed", limit: "50" } }),
    request(app.api, "GET", "/approvals", { query: { unitId, state: "pending", limit: "50" } }),
    request(app.api, "GET", "/approvals", { query: { unitId, state: "expired", limit: "20" } }),
    request(app.api, "GET", `/units/${encodeURIComponent(unitId)}`),
    request(app.api, "GET", "/waiting", { query: { limit: "50" } }),
  ]).then(([tasks, approvals, expired, unit, waiting]) => {
    if (app.disposed || ticket !== app.inspectorTicket) return;
    app.inspectorData = {
      unitId,
      tasks: tasks.data.items ?? [],
      approvals: [...(approvals.data.items ?? []), ...(expired.data.items ?? [])],
      grants: unit.data.approvalGrants ?? [],
      waiting: waiting.data.items ?? [],
    };
    renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function answerSelected(app, approval, decision) {
  answerApproval(app.api, approval, decision).then((result) => {
    app.actionNote = text(app.language, "answerQueued");
    app.answerId = result.data.answerId;
    app.answerApprovalId = approval.id;
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function revokeSelectedGrant(app, unit, grant) {
  revokeGrant(app.api, unit, grant.id).then((result) => {
    app.actionNote = result.data.state;
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function setTaskStatus(app, task, status, note) {
  changeTaskStatus(app.api, task, status, note).then((result) => {
    app.actionNote = result.data.task.status;
    app.inspectorData.tasks = app.inspectorData.tasks.map((item) => item.id === result.data.task.id ? result.data.task : item);
    refreshWaiting(app);
  }).catch((error) => noteAction(app, error));
}

function undoSelected(app, task) {
  undoTask(app.api, task).then((result) => {
    app.actionNote = result.data.task.status;
    app.inspectorData.tasks = app.inspectorData.tasks.map((item) => item.id === result.data.task.id ? result.data.task : item);
    refreshWaiting(app);
  }).catch((error) => noteAction(app, error));
}

function refreshWaiting(app) {
  request(app.api, "GET", "/waiting", { query: { limit: "50" } }).then((waiting) => {
    if (app.inspectorData) app.inspectorData.waiting = waiting.data.items ?? [];
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function noteApproval(app, data) {
  const state = data.answer?.state;
  if (state === "applied") app.actionNote = text(app.language, "approved");
  else if (state) app.actionNote = state;
}

function unitById(app, id) {
  return app.unitList?.catalog?.find((unit) => unit.id === id) ?? app.store.indexes.units.get(id) ?? null;
}

if (typeof document !== "undefined") {
  const root = document.querySelector("#app");
  if (root) {
    const appPromise = mount(root);
    window.addEventListener("pagehide", async () => dispose(await appPromise));
  }
}
