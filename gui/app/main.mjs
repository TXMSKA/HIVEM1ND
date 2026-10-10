import { connectUnits, createUnit, startSession, stopSession } from "./actions.mjs";
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
import { createApi, dispose as disposeApi, request } from "./api.mjs";
import { announce, element, icon, showDialog, showError } from "./components.mjs";
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup, unitsForTree } from "./hierarchy.mjs";
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
  if (event?.name === "message.created" && app.thread?.chat?.id === event.envelope?.data?.chatId) {
    incomingMessage(app.thread, event.envelope.data.message);
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
      text: app.actionNote,
    }));
  }
  inspectorBody.append(actionControls(app, t, selected));
  inspectorBody.append(chatPanel(app, t));
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

function ensureMap(app) {
  const units = app.unitList?.catalog?.length ? app.unitList.catalog : [...(app.store.indexes.units?.values?.() ?? [])];
  const saved = app.store.layout?.layout ?? { nodes: {}, groups: {} };
  if (!app.mapState) app.mapState = createMap({ units, saved, api: app.api });
  else app.mapState.units = units;
  app.mapState.api = app.api;
  app.mapState.persist = Boolean(app.store.capabilities?.includes("layout.write"));
  app.mapState.onSelect = (id) => {
    app.store.selected.unitId = id;
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
