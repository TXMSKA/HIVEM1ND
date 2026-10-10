import {
  answerApproval,
  canAccept,
  canSendBack,
  changeTaskStatus,
  connectUnits,
  createUnit,
  revokeGrant,
  startSession,
  stopSession,
  undoTask,
} from "./actions.mjs";
import {
  applyMessageRead,
  canMarkMailbox,
  createThread,
  incomingMessage,
  loadMailboxMessage,
  loadMailboxes,
  loadMessages,
  manageChat,
  markMailboxRead,
  measureVisible,
  messageWindow,
  openDirectChat,
  openGroupChat,
  openMailbox,
  postMailbox,
  postMessage,
  postVisibleReads,
  updateNearBottom,
} from "./chats.mjs";
import { addNode, hitBoardNode, patchNode, releaseAssets, removeNode, renderBoard, uploadAsset } from "./blueprint.mjs";
import { createApi, createOperation, dispose as disposeApi, request } from "./api.mjs";
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
  discardEditorDraft,
  noteComment,
  noteRemote,
  openEditor,
  reapplyEditorDraft,
  refreshRemoteEditor,
  replyComment,
  resolveComment,
  setAttachments,
  startWatch,
  stopWatch,
} from "./editors.mjs";
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup, unitsForTree } from "./hierarchy.mjs";
import { openTaskDetail, renderApproval, renderGrants, renderTask, renderUnit, renderWaiting } from "./inspector.mjs";
import { text } from "./i18n.mjs";
import { createPagedList, loadAll, reloadList, renderWindow, setQuery, windowRange } from "./lists.mjs";
import { adoptInitialLayout, applyRemoteLayout, centerUnit, createMap, keepLocalPosition, renderMap, useIncomingPosition } from "./map.mjs";
import { dispose as disposeEmbed, publishDirty, publishReady, startEmbedChannel } from "./embed.mjs";
import { PHONE_NAV, exchangeCode, exchangeHomeFragment, logout, renderCodeEntry, renderPhone } from "./phone.mjs";
import { applySettingsRead, clearGrant, closeHome, noteHomeChange, openHome, renderSettings, saveSettings, takeGrant } from "./settings.mjs";
import { acceptStreamEvent, createStore, loadSnapshot } from "./state.mjs";
import { answerProposal, beginTextEdit, enterFocus, leaveFocus, loadProposals, moveFocus, noteProposal, renderDocument, renderProposal, saveRange, showTools, textAnchor } from "./void.mjs";
import { synchronize } from "./stream.mjs";

const DESKTOP_MODES = ["map", "blueprint", "document", "focus"];
const PHONE_MODES = PHONE_NAV;

export function presentation(viewer, settings) {
  return {
    look: viewer?.look ?? settings?.look ?? "modern",
    language: viewer?.language ?? settings?.language ?? "en",
  };
}

export function shellLayout(capabilities, audience) {
  if (audience === "phone") return "phone";
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
  const view = root.ownerDocument.defaultView;
  view?.addEventListener?.("keydown", (event) => onFocusKey(app, event));
  root.addEventListener?.("pointermove", () => {
    if (app.mode !== "focus" || !app.voidState || app.voidState.tools) return;
    showTools(app.voidState);
    renderShell(app);
  });
  renderStatus(app, "loading");
  if (!api.token && api.homeKey) {
    try {
      const credential = await exchangeHomeFragment(api);
      return bootSession(app, credential);
    } catch (error) {
      renderPhoneError(app, error);
      return app;
    }
  }
  if (!api.token) {
    renderSignedOut(app);
    return app;
  }
  return bootSession(app, null);
}

async function bootSession(app, credential) {
  if (credential) {
    app.api.token = credential.token;
    app.store.capabilities = credential.capabilities ?? [];
    app.store.audience = credential.audience ?? null;
    app.store.expiresAt = credential.expiresAt ?? null;
  }
  if (app.store.audience === "phone") {
    app.mode = "hierarchy";
    app.tab = "hierarchy";
  }
  synchronize(app.api, app.store, {
    cursor: () => app.store.cursor,
    onEvent: (event) => onStream(app, event),
  });
  try {
    await loadSnapshot(app.store, app.api);
    await loadPresentation(app);
    await loadLists(app);
    startOwnEmbed(app);
  } catch (error) {
    renderFailure(app, error);
  }
  return app;
}

function startOwnEmbed(app) {
  if (app.embed || app.disposed) return;
  const viewer = app.store.viewer;
  if (app.store.audience === "phone" || !viewer?.embedded || !viewer.hostOrigin) return;
  if (!app.store.capabilities.includes("viewer.write")) return;
  const transport = app.root.ownerDocument.defaultView;
  app.embed = startEmbedChannel({
    ...viewer,
    capabilities: app.store.capabilities,
  }, {
    patchViewer: (body) => patchOwnViewer(app, body),
    logout: () => logoutOwnViewer(app),
  }, transport);
  publishReady(app.embed);
}

async function patchOwnViewer(app, body) {
  const operation = createOperation({ method: "PATCH", path: "/viewer", body });
  const result = await request(app.api, "PATCH", "/viewer", { operation });
  app.store.viewer = { ...app.store.viewer, ...result.data };
  const choice = presentation(app.store.viewer, app.store.settings?.settings);
  app.look = choice.look === "high-contrast" ? "high-contrast" : "modern";
  app.language = choice.language === "es" ? "es" : "en";
  if (!app.disposed) renderShell(app);
  return result;
}

async function logoutOwnViewer(app) {
  disposeEmbed(app.embed);
  app.embed = null;
  if (app.editors) {
    app.editors.drafts?.clear?.();
    app.editors.watch = null;
    app.editors.current = null;
  }
  if (app.homeState) clearGrant(app.homeState);
  await logout(app.api);
  app.disposed = true;
  renderSignedOut(app);
}

export function navigate(app, mode) {
  if (app.layout === "phone") {
    if (!PHONE_MODES.includes(mode)) return;
    if (mode === "waiting") {
      app.mode = "waiting";
      if (app.waitingList) reloadList(app.waitingList);
    }
    else {
      app.tab = mode;
      app.mode = "hierarchy";
    }
    renderShell(app);
    return;
  }
  const allowed = [...DESKTOP_MODES, "settings", "hierarchy", "chats"];
  if (!allowed.includes(mode)) return;
  if (mode === "hierarchy" || mode === "chats") app.tab = mode;
  else app.mode = mode;
  renderShell(app);
}

export function renderShell(app) {
  captureInputs(app);
  const document = app.root.ownerDocument;
  document.documentElement.lang = app.language;
  document.documentElement.dataset.look = app.look;
  document.documentElement.dataset.mode = app.mode;
  const t = (key, variables) => text(app.language, key, variables);
  const view = app.store.view;
  const counts = view?.counts ?? {};
  const shell = element(document, "div", { class: "shell", "data-layout": app.layout === "phone" ? "phone" : "desktop", "data-mode": app.mode, "data-tab": app.tab });
  shell.append(renderBar(app, t, counts), renderWorkspace(app, t, view, counts), renderFooter(app, t));
  if (app.layout === "phone") shell.append(renderPhoneNav(app, t));
  app.root.replaceChildren(shell);
  restoreInputFocus(app);
  finishList(app);
  finishMap(app);
  syncChatReads(app);
}

function inputDrafts(app) {
  if (!app.inputDrafts) app.inputDrafts = { chats: new Map(), notes: new Map(), focus: null, cleared: new Set() };
  return app.inputDrafts;
}

function fieldDraft(node) {
  const value = node?.value ?? "";
  const start = Number.isInteger(node?.selectionStart) ? node.selectionStart : value.length;
  const end = Number.isInteger(node?.selectionEnd) ? node.selectionEnd : value.length;
  return { value, start, end };
}

function captureInputs(app) {
  const drafts = inputDrafts(app);
  const composer = app.root.querySelector?.("[data-composer]");
  const chatId = composer?.getAttribute?.("data-chat") ?? app.thread?.chat?.id;
  if (composer && chatId && !drafts.cleared.has(`chat:${chatId}`)) {
    const draft = fieldDraft(composer);
    drafts.chats.set(chatId, draft);
    if (app.thread?.chat?.id === chatId) app.thread.composer = draft.value;
  }
  if (chatId) drafts.cleared.delete(`chat:${chatId}`);
  for (const note of app.root.querySelectorAll?.("[data-note]") ?? []) {
    const taskId = note.getAttribute?.("data-note");
    if (!taskId || drafts.cleared.has(`note:${taskId}`)) continue;
    drafts.notes.set(taskId, fieldDraft(note));
  }
  for (const taskId of [...drafts.notes.keys()]) drafts.cleared.delete(`note:${taskId}`);
  const active = app.root.ownerDocument?.activeElement;
  if (active?.getAttribute?.("data-composer") && chatId) drafts.focus = { kind: "chat", id: chatId };
  else if (active?.getAttribute?.("data-note")) drafts.focus = { kind: "note", id: active.getAttribute("data-note") };
  else if (active && app.root.contains?.(active)) drafts.focus = null;
}

function clearInputDraft(app, kind, id) {
  const drafts = inputDrafts(app);
  const bucket = kind === "chat" ? drafts.chats : drafts.notes;
  bucket.delete(id);
  drafts.cleared.add(`${kind}:${id}`);
  if (drafts.focus?.kind === kind && drafts.focus.id === id) drafts.focus = null;
}

function restoreInputFocus(app) {
  const focus = inputDrafts(app).focus;
  if (!focus) return;
  const node = focus.kind === "chat"
    ? app.root.querySelector?.("[data-composer]")
    : app.root.querySelector?.(`[data-note="${focus.id}"]`);
  if (!node) return;
  const draft = focus.kind === "chat" ? inputDrafts(app).chats.get(focus.id) : inputDrafts(app).notes.get(focus.id);
  node.focus?.();
  if (typeof node.setSelectionRange === "function" && draft) node.setSelectionRange(draft.start, draft.end);
}

export function dispose(app) {
  if (!app || app.disposed) return;
  app.disposed = true;
  app.api.live && (app.api.live.stopped = true);
  for (const list of [app.unitList, app.chatList, app.waitingList]) {
    if (!list) continue;
    list.controller?.abort();
    if (list.timer) clearTimeout(list.timer);
    list.timer = null;
  }
  if (app.homeState) clearGrant(app.homeState);
  disposeEmbed(app.embed);
  releaseAssets(app.editors?.current);
  disposeApi(app.api);
}

async function onStream(app, event) {
  if (app.disposed) return;
  await acceptStreamEvent(app.store, app.api, event);
  if (app.disposed) return;
  if (event?.name === "home.changed") noteHome(app, dataOf(event));
  if (event?.name === "stream.ready" || event?.name === "settings.changed" || event?.name === "viewer.changed") {
    await loadPresentation(app);
    if (event?.name === "stream.ready") await recheckTracked(app);
    return;
  }
  if (event?.name === "stream.reset") await recheckTracked(app);
  if (event?.name === "unit.changed" || event?.name === "view.changed") {
    if (app.unitList) await reloadList(app.unitList);
    if (event?.name === "view.changed" && app.waitingList) await reloadList(app.waitingList);
  }
  if (event?.name === "chat.changed") {
    if (app.chatList) await reloadList(app.chatList);
  }
  if (event?.name === "layout.changed" && app.mapState) applyRemoteLayout(app.mapState, event);
  if (event?.name === "session.request.changed") noteSessionRequest(app, dataOf(event));
  if (event?.name === "session.changed") noteSession(app, dataOf(event));
  if (event?.name === "approval.requested" || event?.name === "approval.answered") await noteApproval(app, dataOf(event));
  if (event?.name === "approval.grant.changed") await noteGrant(app, dataOf(event));
  if (event?.name === "message.read") {
    applyMessageRead(app.thread, dataOf(event));
    noteMailboxRead(app, dataOf(event));
  }
  if (event?.name === "message.created" && app.thread?.chat?.id === dataOf(event).chatId) {
    const host = app.root.querySelector?.(".transcript");
    if (host) updateNearBottom(app.thread, host);
    incomingMessage(app.thread, dataOf(event).message);
  }
  const editors = app.editors;
  const data = event?.envelope?.data ?? {};
  if (editors && event?.name === "comment.changed") noteComment(editors, data);
  if (editors && event?.name === "void.proposal.changed") {
    noteProposal(editors, data);
    if (editors.current?.resourceId === data.resourceId) {
      try {
        await loadProposals(app.api, editors);
        noteProposal(editors, data);
      } catch (error) {
        editors.error = error;
      }
    }
  }
  if (editors && (event?.name === "blueprint.changed" || event?.name === "void.changed")) {
    noteRemote(editors, data);
    if (data.resourceId) {
      try {
        await refreshRemoteEditor(app.api, editors, data.resourceId);
      } catch (error) {
        editors.error = error;
      }
    }
  }
  if (editors && event?.name === "editor.activity") {
    const followed = handleActivity(editors, data);
    if (followed.follow) await revealWatched(app, editors, data);
  }
  if (editors && event?.name === "watch.changed") {
    const nextId = applyWatch(editors, data);
    if (data.state === "watching") await revealWatched(app, editors, { ...data, resourceId: nextId ?? data.resourceId });
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
  app.layout = shellLayout(app.store.capabilities, app.store.audience);
  const home = homeState(app);
  applySettingsRead(home, app.store.settings);
  app.store.settings.home = home.home;
  startOwnEmbed(app);
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
  document.documentElement.dataset.mode = app.mode;
  renderShell(app);
  announce(app.root, text(app.language, "loadingView"));
}

function renderBar(app, t, counts) {
  const document = app.root.ownerDocument;
  const modes = element(document, "div", { class: "modes", role: "toolbar" });
  if (app.layout !== "phone") {
    for (const mode of DESKTOP_MODES) {
      modes.append(element(document, "button", {
        type: "button",
        class: "mode",
        "aria-pressed": String(app.mode === mode),
        onclick: () => navigate(app, mode),
      }, icon(document, mode), t(mode)));
    }
  }
  const waiting = element(document, "button", {
    type: "button",
    class: "pill",
    "data-action": "waiting",
    "aria-pressed": String(app.waitingOpen === true || app.mode === "waiting"),
    onclick: () => openWaiting(app),
  }, icon(document, "waiting"), t("waitingCount", { count: counts.waiting ?? 0 }));
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
  const bar = element(document, "header", { class: "bar" }, brand(document), modes, waiting);
  if (app.layout !== "phone") bar.append(inspector, settings);
  return bar;
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
  const selected = app.store.indexes.units.get(app.store.selected.unitId)
    ?? app.unitList?.catalog?.find((unit) => unit.id === app.store.selected.unitId)
    ?? null;
  const stage = element(document, "section", { class: "panel stage" },
    element(document, "h2", { text: t(app.mode) }),
  );
  if (app.layout !== "phone" && app.waitingOpen) {
    stage.append(renderWaitingSurface(app, t));
  } else if (app.mode === "map") {
    ensureMap(app);
    stage.append(element(document, "div", { class: "map" }));
  } else if (app.mode === "blueprint" || app.mode === "document" || app.mode === "focus") {
    stage.append(renderEditor(app, t));
  } else if (app.mode === "settings") {
    stage.append(settingsSurface(app, document, t));
  } else if (app.layout === "phone" && app.mode === "waiting") {
    stage.append(renderWaitingSurface(app, t));
  } else if (app.layout === "phone" && app.tab === "chats") {
    stage.append(chatPanel(app, t));
    if (app.phoneChatNote) stage.append(element(document, "p", { "data-phone-chat": "required", text: t("desktopChatRequired") }));
  } else {
    stage.append(element(document, "p", { text: app.store.mode === "paged" ? t("viewTooLarge") : t("later") }));
  }
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
  if (app.layout !== "phone") {
    inspectorBody.append(chatPanel(app, t));
    inspectorBody.append(renderInspector(app, t, selected));
  }
  const inspector = element(document, "aside", {
    class: `panel inspector${app.inspectorOpen ? " is-open" : ""}`,
  }, inspectorBody);
  return element(document, "div", { class: "workspace" }, side, stage, inspector);
}

async function loadLists(app) {
  app.unitList = createPagedList({ api: app.api, store: app.store, name: "units", route: "/units" });
  app.chatList = createPagedList({ api: app.api, store: app.store, name: "chats", route: "/chats", filters: { listed: "true" } });
  app.waitingList = createPagedList({ api: app.api, store: app.store, name: "waiting", route: "/waiting" });
  const refresh = () => {
    if (!app.disposed && app.layout !== "unknown") renderShell(app);
  };
  app.unitList.onUpdate = refresh;
  app.chatList.onUpdate = refresh;
  app.waitingList.onUpdate = refresh;
  try {
    const layout = await request(app.api, "GET", "/layout");
    if (!app.disposed) app.store.layout = layout.data;
  } catch {
    // Placement still runs when the layout route is unavailable.
  }
  await Promise.all([loadAll(app.unitList), loadAll(app.chatList), loadAll(app.waitingList)]);
}

function openWaiting(app) {
  if (app.layout === "phone") {
    navigate(app, "waiting");
    return;
  }
  app.waitingOpen = app.waitingOpen !== true;
  if (app.waitingOpen && app.waitingList) reloadList(app.waitingList);
  if (!app.disposed) renderShell(app);
}

function renderWaitingSurface(app, t) {
  const document = app.root.ownerDocument;
  const list = app.waitingList;
  const surface = element(document, "section", { class: "waiting-surface", "data-waiting-surface": "true" });
  const search = element(document, "input", {
    class: "search",
    type: "search",
    "data-waiting-search": "true",
    "aria-label": t("search"),
  });
  search.value = list?.query ?? "";
  search.addEventListener("input", () => {
    if (list) setQuery(list, search.value);
  });
  const total = list?.total ?? 0;
  surface.append(search, element(document, "p", {
    "data-waiting-total": String(total),
    text: t("waitingCount", { count: total }),
  }));
  if (!list || list.status === "loading") {
    surface.append(element(document, "p", { text: t("loadingList") }));
    return surface;
  }
  const items = list.items ?? [];
  const range = windowRange(list.scrollTop, list.height || 640, list.rowHeight || 36, items.length);
  surface.append(renderWaiting(document, items.slice(range.start, range.end), t, (item) => openWaitingItem(app, item)));
  surface.append(renderWaitingRecord(app, t));
  return surface;
}

function openWaitingItem(app, item) {
  if (!item) return;
  app.waitingItemId = item.id;
  const caps = app.store.capabilities ?? [];
  if (item.unitId) app.store.selected.unitId = item.unitId;
  if (item.approvalId) {
    request(app.api, "GET", "/approvals/:approvalId", { params: { approvalId: item.approvalId } }).then((result) => {
      app.waitingRecord = { kind: "approval", approval: result.data, item };
      if (!app.disposed) renderShell(app);
    }).catch((error) => noteAction(app, error));
    return;
  }
  if (item.taskId) {
    request(app.api, "GET", "/tasks/:taskId", { params: { taskId: item.taskId } }).then((result) => {
      app.waitingRecord = { kind: "review", task: result.data, item };
      if (!app.disposed) renderShell(app);
    }).catch((error) => noteAction(app, error));
    return;
  }
  if (item.chatId) {
    request(app.api, "GET", "/chats/:chatId", { params: { chatId: item.chatId } }).then((result) => {
      app.waitingRecord = { kind: "chat", chat: result.data, item };
      if (app.layout === "phone") app.mode = "hierarchy";
      app.tab = "chats";
      showChat(app, result.data);
    }).catch((error) => noteAction(app, error));
    return;
  }
  if (item.messageId) {
    loadMailboxMessage(app.api, "root:master", item.messageId).then((result) => {
      app.waitingRecord = { kind: "message", message: result.data, item };
      if (!app.disposed) renderShell(app);
    }).catch((error) => noteAction(app, error));
    return;
  }
  app.waitingRecord = { kind: "question", item };
  if (app.layout === "phone") app.mode = "hierarchy";
  if (item.unitId) openExistingDirect(app, item.unitId);
  else if (!app.disposed) renderShell(app);
}

function renderWaitingRecord(app, t) {
  const document = app.root.ownerDocument;
  const record = app.waitingRecord;
  const block = element(document, "div", { "data-waiting-record": record?.kind ?? "" });
  if (!record) return block;
  const caps = app.store.capabilities ?? [];
  if (record.kind === "approval" && record.approval && caps.includes("approval.answer")) {
    block.append(renderApproval(document, record.approval, t, (item, decision) => answerSelected(app, item, decision)));
    return block;
  }
  if (record.kind === "review" && record.task && (caps.includes("task.status") || caps.includes("task.accept") || caps.includes("task.send-back"))) {
    const phone = app.layout === "phone" || app.store.audience === "phone";
    const noteDraft = inputDrafts(app).notes.get(record.task.id);
    block.append(renderTask(document, record.task, t, (item, status, note) => setTaskStatus(app, item, status, note), caps.includes("task.undo") ? (item) => undoSelected(app, item) : null, noteDraft?.value ?? "", (value, start, end) => {
      inputDrafts(app).notes.set(record.task.id, { value, start: Number.isInteger(start) ? start : value.length, end: Number.isInteger(end) ? end : value.length });
    }, phone ? canAccept(record.task) : canSendBack(record.task)));
    return block;
  }
  if (record.kind === "message" && record.message) {
    block.append(element(document, "article", { "data-mailbox-detail": record.message.id, text: record.message.body || record.message.subject || "" }));
    if (canMarkMailbox(app.store.audience, caps, "root:master")) {
      block.append(element(document, "button", {
        type: "button",
        class: "btn",
        "data-action": "mark-read",
        text: t("markRead"),
        onclick: () => markMailboxRead(app.api, "root:master", [record.message.id]).then(() => refreshWaiting(app)).catch((error) => noteAction(app, error)),
      }));
    }
    return block;
  }
  block.append(element(document, "p", { text: record.item?.title || record.approval?.display || record.task?.title || "" }));
  return block;
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
      } else if (row.unit) {
        activateUnit(app, row.unit, kind);
        if (app.layout === "phone") takePendingChat(app);
        loadInspector(app, row.unit.id);
      }
      if (row.kind === "chat") {
        const chat = app.chatList?.catalog?.find((item) => item.id === row.id) ?? app.chatList?.items?.find((item) => item.id === row.id);
        if (chat) showChat(app, chat);
      }
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

async function revealWatched(app, editors, activity) {
  if (app.layout === "phone") return;
  const resourceId = activity?.resourceId ?? editors.watch?.resourceId ?? null;
  const summary = resourceId ? editors.catalog.find((item) => item.id === resourceId) : null;
  const kind = activity?.kind === "void" || summary?.kind === "void" ? "void" : "blueprint";
  app.mode = kind === "void" ? "document" : "blueprint";
  if (summary && editors.current?.resourceId !== resourceId) await openEditor(app.api, editors, summary);
  if (editors.focus?.k) {
    if (editors.current) editors.current.page = editors.focus.k;
    if (app.voidState) app.voidState.page = editors.focus.k;
  }
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
  editor.viewport = app.editors.viewport;
  editor.panned = app.editors.panned === true;
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

function voidSurface(app, document, editor, t) {
  editor.focus = app.editors.focus;
  if (!app.voidState) app.voidState = { mode: app.mode, tools: app.mode !== "focus", page: editor.page ?? editor.authoritative.document.pages?.[0]?.k, pages: editor.authoritative.document.pages };
  app.voidState.pages = editor.authoritative.document.pages;
  editor.page = app.voidState.page;
  editor.language = app.language;
  const host = element(document, "div", { class: "void-page", "data-void": "true" });
  renderDocument(document, host, editor);
  const tools = element(document, "div", { class: `void-tools${app.voidState.tools ? " is-visible" : ""}`, "data-tools": app.voidState.tools ? "visible" : "hidden" });
  const source = element(document, "textarea", { "data-source": "true" });
  source.value = editor.draftText || (editor.authoritative.document.pages.find((page) => page.k === editor.page)?.[app.language] ?? "");
  source.addEventListener("input", () => {
    editor.draftText = source.value;
    editor.dirty = true;
  });
  tools.append(source);
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "save-range",
    onclick: () => saveVoid(app, editor, source.value),
  }, t("send")));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "enter-focus",
    onclick: (event) => {
      app.focusReturn = event.currentTarget;
      enterFocus(app.voidState);
      app.mode = "focus";
      renderShell(app);
    },
  }, t("focus")));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "comment-quote",
    onclick: () => commentOnQuote(app, editor),
  }, t("comment")));
  const proposals = editor.proposals ?? [];
  const list = element(document, "div", { class: "editor-comments" });
  for (const proposal of proposals) {
    const block = renderProposal(document, proposal);
    if (proposal.state === "pending" && app.store.capabilities.includes("proposal.answer")) {
      block.append(element(document, "button", { type: "button", class: "btn", "data-action": "accept-change", "data-proposal-id": proposal.id, onclick: () => answerVoid(app, editor, proposal, "accept") }, t("acceptChange")));
      block.append(element(document, "button", { type: "button", class: "btn", "data-action": "discard", "data-proposal-id": proposal.id, onclick: () => answerVoid(app, editor, proposal, "discard") }, t("discard")));
    }
    list.append(block);
  }
  return element(document, "div", {}, host, tools, list);
}

function saveVoid(app, editor, value) {
  const page = editor.authoritative.document.pages.find((item) => item.k === (editor.page ?? app.voidState.page));
  const lang = app.language === "es" ? "es" : "en";
  const current = page[lang];
  beginTextEdit(editor, page.k, lang);
  editor.draftText = value;
  editor.dirty = true;
  let start = 0;
  while (start < current.length && start < value.length && current[start] === value[start]) start += 1;
  let end = current.length;
  let valueEnd = value.length;
  while (end > start && valueEnd > start && current[end - 1] === value[valueEnd - 1]) {
    end -= 1;
    valueEnd -= 1;
  }
  saveRange(app.api, editor, page.k, lang, start, end, value.slice(start, valueEnd)).then(() => renderShell(app)).catch((error) => {
    editor.conflict = { code: error.code };
    noteEditor(app, error);
  });
}

function commentOnQuote(app, editor) {
  const page = editor.authoritative.document.pages.find((item) => item.k === (editor.page ?? app.voidState.page));
  const lang = app.language === "es" ? "es" : "en";
  const anchor = textAnchor(editor, page.k, lang, 0, 7);
  createComment(app.api, app.editors, anchor, editor.commentText || anchor.quote).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function answerVoid(app, editor, proposal, decision) {
  answerProposal(app.api, editor, proposal, decision).then(() => renderShell(app)).catch((error) => {
    if (error.code === "proposal_stale") editor.conflict = { code: error.code };
    noteEditor(app, error);
  });
}

function onFocusKey(app, event) {
  if (app.mode !== "focus" || !app.voidState) return;
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  if (event.key === "Escape") {
    leaveFocus(app.voidState);
    app.mode = "document";
    renderShell(app);
    app.focusReturn?.focus?.();
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  moveFocus(app.voidState, event.key);
  event.preventDefault();
  renderShell(app);
}

function renderEditor(app, t) {
  const document = app.root.ownerDocument;
  const editors = editorsOf(app);
  const kind = app.mode === "blueprint" ? "blueprint" : "void";
  queueCatalog(app, kind);
  const current = editors.current?.kind === kind ? editors.current : null;
  const title = current?.authoritative?.title ?? current?.authoritative?.legacy?.id ?? t(app.mode);
  const watch = editors.watch;
  const watchText = !watch || watch.state === "off" ? t("watchOff") : watch.state === "watching" ? t("watching", { unit: watch.unitId }) : t("watchWaiting", { unit: watch.unitId });
  const panel = element(document, "div", { class: "editor-panel" });
  panel.append(element(document, "h2", { "data-editor-title": title, "data-editor-kind": kind, text: `${t(app.mode)} ${title}` }));
  panel.append(element(document, "p", { "data-watch": watch?.state ?? "off", text: watchText }));
  if (current?.conflict) {
    panel.append(element(document, "p", { "data-conflict": "true", text: t("outsideChange") }));
    panel.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "discard-draft",
      text: t("discardDraft"),
      onclick: () => {
        discardEditorDraft(editors);
        renderShell(app);
      },
    }));
    panel.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "reapply-draft",
      text: t("reapplyDraft"),
      onclick: () => {
        reapplyEditorDraft(editors);
        renderShell(app);
      },
    }));
  }
  if (current?.kind === "blueprint" && current.authoritative?.document) panel.append(boardSurface(app, document, current, t));
  if (current?.kind === "void" && current.authoritative?.document) panel.append(voidSurface(app, document, current, t));
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
      if (app.embed) publishDirty(app.embed, true);
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
  const saved = app.store.layout ?? { layout: { nodes: {}, groups: {} }, revision: null };
  if (!app.mapState) app.mapState = createMap({ units, saved, api: app.api });
  else {
    app.mapState.units = units;
    adoptInitialLayout(app.mapState, saved);
  }
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

function settingsSurface(app, document, t) {
  const home = homeState(app);
  const info = app.store.settings ?? {};
  if (info.home) home.home = { enabled: Boolean(info.home.enabled), openedAt: info.home.openedAt ?? null, expiresAt: info.home.expiresAt ?? null, addresses: info.home.addresses ?? [], remainingSeconds: info.home.remainingSeconds ?? 0 };
  if (!app.settingsSync && !app.settingsSyncLoading) {
    app.settingsSyncLoading = true;
    request(app.api, "GET", "/sync").then((result) => {
      app.settingsSync = result.data;
      app.settingsSyncLoading = false;
      if (!app.disposed && app.mode === "settings") renderShell(app);
    }).catch(() => {
      app.settingsSyncLoading = false;
    });
  }
  const issues = (app.store.view?.issues ?? app.unitList?.issues ?? []).map((issue) => ({ message: issue.message }));
  return renderSettings(document, {
    settings: info.settings,
    revision: info.revision,
    service: info.service,
    home: home.home,
    grant: home.grant,
    selected: home.selected ?? 0,
    issues,
    limits: app.settingsSync?.limits,
    syncLabel: t(info.service?.syncState === "error" ? "syncError" : syncCopy(app.sync)),
    canWrite: app.store.capabilities.includes("settings.write"),
    canManage: app.store.capabilities.includes("home.manage"),
    now: Date.now(),
  }, t, {
    onLook: (look) => chooseSetting(app, { look }),
    onLanguage: (language) => chooseSetting(app, { language }),
    onOpen: (raw, replacing) => beginHome(app, raw, replacing),
    onClose: () => endHome(app),
    onSelect: (index) => {
      home.selected = index;
      renderShell(app);
    },
  });
}

function homeState(app) {
  if (!app.homeState) app.homeState = { grant: null, home: app.store.settings?.home ?? null, expectGrant: false, selected: 0 };
  return app.homeState;
}

function noteHome(app, data) {
  const home = homeState(app);
  noteHomeChange(home, data);
  if (data?.home && app.store.settings) app.store.settings.home = home.home;
}

function dataOf(event) {
  return event?.envelope?.data ?? {};
}

async function chooseSetting(app, patch) {
  try {
    const result = await saveSettings(app.api, app.store.settings?.revision ?? null, patch);
    app.store.settings.settings = result.data.settings;
    app.store.settings.revision = result.data.revision;
    const choice = presentation(app.store.viewer, result.data.settings);
    app.look = choice.look === "high-contrast" ? "high-contrast" : "modern";
    app.language = choice.language === "es" ? "es" : "en";
    if (!app.disposed) renderShell(app);
  } catch (error) {
    if (error.code === "revision_conflict") {
      try {
        const latest = await request(app.api, "GET", "/settings");
        applySettingsRead(homeState(app), latest.data);
        app.store.settings = latest.data;
      } catch {
        // The visible error remains the conflict.
      }
    }
    noteAction(app, error);
  }
}

function beginHome(app, raw, replacing) {
  const run = () => enableHome(app, raw);
  if (!replacing) {
    run();
    return;
  }
  const t = (key) => text(app.language, key);
  showDialog(app.root.ownerDocument, {
    title: t("homeReplace"),
    body: t("homeReplaceBody"),
    confirm: t("homeReplace"),
    cancel: t("cancel"),
    onConfirm: run,
  });
}

async function enableHome(app, raw) {
  const addresses = String(raw ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const home = homeState(app);
  home.expectGrant = true;
  try {
    const result = await openHome(app.api, addresses);
    takeGrant(home, result.data);
    if (app.store.settings) app.store.settings.home = home.home;
    if (!app.disposed) renderShell(app);
  } catch (error) {
    home.expectGrant = false;
    if (error.code === "listener_unavailable") clearGrant(home);
    noteAction(app, error);
  }
}

async function endHome(app) {
  try {
    const result = await closeHome(app.api);
    const home = homeState(app);
    clearGrant(home);
    home.home = result.data;
    if (app.store.settings) app.store.settings.home = result.data;
    if (!app.disposed) renderShell(app);
  } catch (error) {
    noteAction(app, error);
  }
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
  const current = app.mode === "waiting" ? "waiting" : app.tab;
  return renderPhone(app.root.ownerDocument, t, PHONE_MODES, current, (mode) => navigate(app, mode), icon);
}

function renderSignedOut(app) {
  const document = app.root.ownerDocument;
  const t = (key) => text(app.language, key);
  const gate = element(document, "section", { class: "gate" },
    element(document, "h2", { text: t("reopenTitle") }),
    element(document, "p", { text: app.phoneError ? t(app.phoneError) : t("reopenBody") }),
  );
  if (app.phoneRetryAfter) gate.setAttribute("data-retry-after", String(app.phoneRetryAfter));
  gate.append(renderCodeEntry(document, t, (code) => submitCode(app, code)));
  app.root.replaceChildren(gate);
}

function renderPhoneError(app, error) {
  app.api.homeKey = null;
  app.api.token = null;
  if (error?.code === "home_expired") app.phoneError = "homeExpired";
  else if (error?.code === "auth_rate_limited") app.phoneError = "rateLimited";
  else app.phoneError = "homeKeyInvalid";
  app.phoneRetryAfter = error?.retryAfter ?? null;
  renderSignedOut(app);
}

async function submitCode(app, code) {
  try {
    const credential = await exchangeCode(app.api, code);
    app.phoneError = null;
    await bootSession(app, credential);
  } catch (error) {
    renderPhoneError(app, error);
  }
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
  const state = data.session?.state;
  if (!state || !SESSION_COPY[state]) return;
  app.actionNote = text(app.language, SESSION_COPY[state]);
}

function noteSessionRequest(app, data) {
  const state = data?.state;
  if (!state || !SESSION_COPY[state]) return;
  if (data.requestId) app.sessionRequestId = data.requestId;
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
  const windowed = messageWindow(thread.messages, {
    nearBottom: thread.nearBottom !== false,
    anchorId: thread.nearBottom === false ? thread.anchorId : null,
    start: thread.windowStart ?? 0,
  });
  thread.windowStart = windowed.start;
  if (!windowed.items.length) transcript.append(element(document, "p", { "data-empty": "true", text: t("emptyChat") }));
  for (const message of windowed.items) {
    transcript.append(element(document, "p", {
      "data-message": message.id,
      "data-read": message.read ? "true" : "false",
      text: message.body || message.subject || "",
    }));
  }
  if (thread.unseen) transcript.append(element(document, "p", { "data-new-messages": "true", text: t("newMessages") }));
  transcript.addEventListener("scroll", () => {
    const before = thread.nearBottom;
    thread.readPause = false;
    updateNearBottom(thread, transcript);
    if (thread.nearBottom) thread.unseen = 0;
    measureVisible(thread, transcript);
    if (thread.nearBottom !== before) {
      renderShell(app);
      return;
    }
    postVisibleReads(app.api, thread).then((result) => {
      if (result && !app.disposed) renderShell(app);
    }).catch((error) => {
      thread.readPause = true;
      noteAction(app, error);
    });
  });
  const row = element(document, "div", { class: "action-row" });
  const caps = app.store.capabilities ?? [];
  if (caps.includes("chat.manage")) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "pin", text: t("pin"), onclick: () => changeChat(app, { pinned: true }) }));
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "unlist", text: t("removeFromList"), onclick: () => changeChat(app, { listed: false }) }));
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "reopen", text: t("reopenChat"), onclick: () => changeChat(app, { listed: true }) }));
  }
  row.append(element(document, "button", { type: "button", class: "btn", "data-action": "older", text: t("loadOlder"), onclick: () => loadOlder(app) }));
  if (caps.includes("mailbox.read") || caps.includes("master.read")) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "mailbox", text: t("mailbox"), onclick: () => inspectMailbox(app) }));
  }
  panel.append(transcript, row);
  if (caps.includes("chat.post")) {
    const composer = element(document, "input", { class: "composer", "data-composer": "true", "data-chat": thread.chat.id, "aria-label": t("send") });
    const savedChat = inputDrafts(app).chats.get(thread.chat.id);
    composer.value = savedChat?.value ?? thread.composer ?? "";
    composer.addEventListener("input", () => {
      const draft = fieldDraft(composer);
      inputDrafts(app).chats.set(thread.chat.id, draft);
      thread.composer = draft.value;
    });
    const send = element(document, "button", { type: "button", class: "btn primary", "data-action": "send", text: t("send"), onclick: () => submitComposer(app, composer) });
    panel.append(composer, send);
  }
  if (app.mailbox) panel.append(renderMailbox(app, t));
  else if (app.mailboxNote) panel.append(element(document, "p", { class: "action-note", "data-mailbox": "true", text: app.mailboxNote }));
  return panel;
}

function noteMailboxRead(app, data) {
  const box = app.mailbox;
  if (!box?.unitId || data?.mailboxId !== box.unitId) return;
  if (data.readerId && data.readerId !== "root:master") return;
  const ids = new Set(data.messageIds ?? []);
  for (const item of box.items ?? []) if (ids.has(item.id)) item.read = true;
  if (box.detail && ids.has(box.detail.id)) box.detail = { ...box.detail, read: true };
}

function syncChatReads(app) {
  const transcript = app.root.querySelector?.(".transcript");
  const thread = app.thread;
  if (!transcript || !thread?.chat || thread.readPause) return;
  measureVisible(thread, transcript);
  postVisibleReads(app.api, thread).then((result) => {
    if (result && !app.disposed) renderShell(app);
  }).catch((error) => {
    if (app.disposed) return;
    thread.readPause = true;
    noteAction(app, error);
  });
}

function renderMailbox(app, t) {
  const document = app.root.ownerDocument;
  const box = app.mailbox;
  const section = element(document, "section", { class: "mailbox", "data-mailbox-view": "true" });
  const list = element(document, "div", { class: "mailbox-list", "data-mailbox-list": "true" });
  for (const item of box.list ?? []) {
    list.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-mailbox-unit": item.unitId,
      text: `${item.unitId} ${item.unread ?? 0}`,
      onclick: () => openMailboxUnit(app, item.unitId),
    }));
  }
  section.append(list);
  if (box.unitId) {
    const history = element(document, "div", { class: "mailbox-history", "data-mailbox-history": box.unitId });
    history.append(element(document, "p", { text: t("mailboxHistory") }));
    if (!box.items?.length) history.append(element(document, "p", { "data-empty": "true", text: t("mailboxEmpty") }));
    for (const message of box.items ?? []) {
      history.append(element(document, "button", {
        type: "button",
        class: "btn",
        "data-mailbox-message": message.id,
        "data-read": message.read ? "true" : "false",
        text: message.body || message.subject || message.id,
        onclick: () => openMailboxDetail(app, message.id),
      }));
    }
    if (box.nextCursor) {
      history.append(element(document, "button", {
        type: "button",
        class: "btn",
        "data-action": "mailbox-older",
        text: t("loadOlder"),
        onclick: () => openMailboxUnit(app, box.unitId, box.nextCursor),
      }));
    }
    section.append(history);
  }
  if (box.detail) {
    section.append(element(document, "article", {
      "data-mailbox-detail": box.detail.id,
      text: box.detail.body || box.detail.subject || "",
    }));
    if (canMarkMailbox(app.store.audience, app.store.capabilities, box.unitId)) {
      section.append(element(document, "button", {
        type: "button",
        class: "btn",
        "data-action": "mark-read",
        text: t("markRead"),
        onclick: () => markOpenMailbox(app),
      }));
    }
  }
  if (box.unitId && (app.store.capabilities ?? []).includes("chat.post")) {
    const compose = element(document, "input", { class: "composer", "data-mailbox-compose": "true", "aria-label": t("mailboxCompose") });
    compose.value = box.composer ?? "";
    compose.addEventListener("input", () => { box.composer = compose.value; });
    section.append(compose, element(document, "button", {
      type: "button",
      class: "btn primary",
      "data-action": "send-mailbox",
      text: t("send"),
      onclick: () => sendMailbox(app, compose),
    }));
  }
  if (box.note) section.append(element(document, "p", { class: "action-note", "data-mailbox": "true", text: box.note }));
  return section;
}

function takePendingChat(app) {
  const pending = app.pendingChat;
  if (!pending || app.chatOpening) return;
  app.pendingChat = null;
  if (!pending.create) {
    openExistingDirect(app, pending.unitId);
    return;
  }
  app.phoneChatNote = false;
  app.chatOpening = true;
  openDirectChat(app.api, [pending.unitId]).then((result) => showChat(app, result.data)).catch((error) => noteAction(app, error)).finally(() => { app.chatOpening = false; });
}

function openExistingDirect(app, unitId) {
  Promise.all([
    request(app.api, "GET", "/chats", { query: { unitId, listed: "true", limit: "50" } }),
    request(app.api, "GET", "/chats", { query: { unitId, listed: "false", limit: "50" } }),
  ]).then(([listed, hidden]) => {
    const chats = [...(listed.data.items ?? []), ...(hidden.data.items ?? [])];
    const chat = chats.find((item) => item.members?.length === 2 && item.members.includes(unitId) && item.members.includes("root:master"));
    app.tab = "chats";
    if (chat) {
      app.phoneChatNote = false;
      showChat(app, chat);
      return;
    }
    app.phoneChatNote = true;
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function showChat(app, chat) {
  captureInputs(app);
  app.thread = createThread(chat);
  const saved = inputDrafts(app).chats.get(chat.id);
  if (saved) app.thread.composer = saved.value;
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
  const measuredId = anchor?.getAttribute?.("data-message") ?? null;
  const measuredOffset = anchor?.offsetTop ?? 0;
  if (app.thread) {
    app.thread.nearBottom = false;
    if (measuredId) app.thread.anchorId = measuredId;
    app.thread.anchorOffset = measuredOffset;
  }
  const older = Boolean(app.thread.nextCursor);
  loadMessages(app.api, app.thread, older).then(() => {
    if (app.disposed) return;
    if (measuredId) app.thread.anchorId = measuredId;
    app.thread.anchorOffset = measuredOffset;
    app.thread.nearBottom = false;
    renderShell(app);
    const next = app.root.querySelector?.(".transcript");
    const node = next?.querySelector?.(`[data-message="${app.thread.anchorId}"]`);
    if (next && node) next.scrollTop += (node.offsetTop ?? 0) - (app.thread.anchorOffset ?? 0);
  }).catch((error) => noteAction(app, error));
}

function inspectMailbox(app) {
  loadMailboxes(app.api).then((result) => {
    app.mailbox = {
      list: result.data.items ?? [],
      unitId: null,
      items: [],
      nextCursor: null,
      detail: null,
      composer: "",
      note: "",
    };
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function openMailboxUnit(app, unitId, cursor = null) {
  openMailbox(app.api, unitId, "all", cursor).then((result) => {
    const incoming = result.data.items ?? [];
    app.mailbox.unitId = unitId;
    app.mailbox.items = cursor ? [...(app.mailbox.items ?? []), ...incoming] : incoming;
    app.mailbox.nextCursor = result.data.nextCursor ?? null;
    if (!cursor) app.mailbox.detail = null;
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function openMailboxDetail(app, messageId) {
  const unitId = app.mailbox?.unitId;
  if (!unitId) return;
  loadMailboxMessage(app.api, unitId, messageId).then((result) => {
    app.mailbox.detail = result.data;
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function markOpenMailbox(app) {
  const box = app.mailbox;
  if (!box?.detail || !canMarkMailbox(app.store.audience, app.store.capabilities, box.unitId)) return;
  markMailboxRead(app.api, box.unitId, [box.detail.id]).then((result) => {
    const read = new Set(result.data.readIds ?? []);
    for (const item of box.items ?? []) if (read.has(item.id)) item.read = true;
    if (read.has(box.detail.id)) box.detail = { ...box.detail, read: true };
    box.note = text(app.language, "markedRead");
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function sendMailbox(app, compose) {
  const box = app.mailbox;
  if (!box?.unitId) return;
  box.composer = compose.value;
  postMailbox(app.api, box.unitId, { body: compose.value }).then((result) => {
    box.composer = "";
    box.items = [result.data, ...(box.items ?? [])];
    box.detail = result.data;
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function submitComposer(app, composer) {
  const chatId = app.thread?.chat?.id;
  app.thread.composer = composer.value;
  if (chatId) inputDrafts(app).chats.set(chatId, fieldDraft(composer));
  postMessage(app.api, app.thread, { body: composer.value }).then(() => {
    if (chatId) clearInputDraft(app, "chat", chatId);
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
  const caps = app.store.capabilities ?? [];
  if (caps.includes("grant.revoke")) panel.append(renderGrants(document, data.grants, t, (grant) => revokeSelectedGrant(app, selected, grant)));
  if (caps.includes("approval.answer")) {
    for (const approval of data.approvals ?? []) panel.append(renderApproval(document, approval, t, (item, decision) => answerSelected(app, item, decision)));
  }
  for (const task of data.tasks ?? []) {
    const noteDraft = inputDrafts(app).notes.get(task.id);
    const phone = app.layout === "phone" || app.store.audience === "phone";
    panel.append(renderTask(document, task, t, (item, status, note) => setTaskStatus(app, item, status, note), caps.includes("task.undo") ? (item) => undoSelected(app, item) : null, noteDraft?.value ?? "", (value, start, end) => {
      inputDrafts(app).notes.set(task.id, { value, start: Number.isInteger(start) ? start : value.length, end: Number.isInteger(end) ? end : value.length });
    }, phone ? canAccept(task) : canSendBack(task)));
    panel.append(openTaskDetail(document, task, t));
  }
  panel.append(renderWaiting(document, data.waiting, t, (item) => openWaitingItem(app, item)));
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
    const next = result.data?.approval ?? null;
    app.answerId = result.data.answerId ?? null;
    app.answerApprovalId = next?.id ?? approval.id;
    if (next) replaceApproval(app, next);
    const label = next ? approvalLabel(app, next) : text(app.language, "answerQueued");
    if (label) app.actionNote = label;
    if (finalApprovalState(next?.state)) refreshOwnerSurface(app, next.unitId ?? approval.unitId);
    else if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function revokeSelectedGrant(app, unit, grant) {
  revokeGrant(app.api, unit, grant.id).then((result) => {
    app.revocationRequestId = result.data.requestId ?? null;
    app.revocationUnitId = result.data.unitId ?? unit.id;
    if (result.data.state === "revoked") {
      app.actionNote = text(app.language, "grantRevoked");
      refreshOwnerSurface(app, app.revocationUnitId);
      return;
    }
    app.actionNote = text(app.language, "grantPending");
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function setTaskStatus(app, task, status, note) {
  changeTaskStatus(app.api, task, status, note).then((result) => {
    if (status === "open") clearInputDraft(app, "note", task.id);
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
  const jobs = [];
  if (app.waitingList) jobs.push(reloadList(app.waitingList));
  jobs.push(request(app.api, "GET", "/view").then((result) => {
    app.store.view = result.data;
  }).catch(() => {}));
  return Promise.all(jobs).then(() => {
    if (app.inspectorData && app.waitingList) app.inspectorData.waiting = app.waitingList.items ?? [];
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function replaceApproval(app, approval) {
  if (!approval?.id || !app.inspectorData) return;
  const items = app.inspectorData.approvals ?? [];
  const index = items.findIndex((item) => item.id === approval.id);
  if (index >= 0) items[index] = approval;
  else items.push(approval);
  app.inspectorData.approvals = items;
}

function finalApprovalState(state) {
  return state === "approved" || state === "denied" || state === "expired";
}

function approvalLabel(app, approval) {
  if (approval?.state === "approved") return text(app.language, "approved");
  if (approval?.state === "denied") return text(app.language, "denied");
  if (approval?.state === "expired") return text(app.language, "approvalExpired");
  if (approval?.state === "answering") return text(app.language, "answerQueued");
  return null;
}

async function noteApproval(app, data) {
  const approval = data?.approval;
  if (!approval?.id) return;
  replaceApproval(app, approval);
  const label = approvalLabel(app, approval);
  if (label) app.actionNote = label;
  if (finalApprovalState(approval.state)) await refreshOwnerSurface(app, approval.unitId);
}

async function noteGrant(app, data) {
  if (!data?.unitId || (data.operation !== "granted" && data.operation !== "revoked")) return;
  if (data.operation === "revoked") app.actionNote = text(app.language, "grantRevoked");
  await refreshOwnerSurface(app, data.unitId);
}

async function refreshOwnerSurface(app, unitId) {
  const jobs = [];
  if (app.waitingList) jobs.push(reloadList(app.waitingList));
  jobs.push(request(app.api, "GET", "/view").then((result) => {
    app.store.view = result.data;
  }).catch(() => {}));
  if (unitId) {
    jobs.push(request(app.api, "GET", "/units/:unitId/approval-grants", {
      params: { unitId },
      query: { limit: "50" },
    }).then((grants) => {
      if (app.inspectorData && (!unitId || app.inspectorData.unitId === unitId)) app.inspectorData.grants = grants.data.items ?? [];
    }));
  }
  await Promise.all(jobs);
  if (app.inspectorData && app.waitingList) app.inspectorData.waiting = app.waitingList.items ?? [];
  if (!app.disposed) renderShell(app);
}

async function recheckTracked(app) {
  const jobs = [];
  if (app.sessionRequestId) {
    jobs.push(request(app.api, "GET", "/session-requests/:requestId", {
      params: { requestId: app.sessionRequestId },
    }).then((result) => noteSessionRequest(app, result.data)));
  }
  if (app.answerId && app.answerApprovalId) {
    jobs.push((async () => {
      const answer = await request(app.api, "GET", "/approvals/:approvalId/answers/:answerId", {
        params: { approvalId: app.answerApprovalId, answerId: app.answerId },
      });
      app.answerState = answer.data.state ?? null;
      const approval = await request(app.api, "GET", "/approvals/:approvalId", {
        params: { approvalId: app.answerApprovalId },
      });
      replaceApproval(app, approval.data);
      const label = approvalLabel(app, approval.data);
      if (label) app.actionNote = label;
      if (finalApprovalState(approval.data.state)) await refreshOwnerSurface(app, approval.data.unitId);
    })());
  }
  if (app.revocationRequestId) {
    jobs.push(request(app.api, "GET", "/grant-revocations/:requestId", {
      params: { requestId: app.revocationRequestId },
    }).then((result) => {
      if (result.data.state === "revoked") return refreshOwnerSurface(app, result.data.unitId);
    }));
  }
  if (!jobs.length) return;
  await Promise.all(jobs.map((job) => job.catch((error) => noteAction(app, error))));
  app.trackedAt = (app.trackedAt ?? 0) + 1;
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
