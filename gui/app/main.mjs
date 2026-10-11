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
  findDirectChat,
  openDirectChat,
  openGroupChat,
  openMailbox,
  postMailbox,
  postMessage,
  postVisibleReads,
  updateNearBottom,
} from "./chats.mjs";
import { addNode, boardCommentAnchor, editedBoard, hitBoardNode, patchNode, releaseAssets, removeNode, renderBoard, replaceBoard, uploadAsset } from "./blueprint.mjs";
import { createApi, createOperation, dispose as disposeApi, request } from "./api.mjs";
import { announce, element, icon, showDialog, showError } from "./components.mjs";
import {
  applyWatch,
  createComment,
  createEditors,
  createResource,
  groupCatalog,
  handleActivity,
  loadCatalog,
  loadComments,
  discardEditorDraft,
  noteComment,
  noteRemote,
  openEditor,
  reapplyEditorDraft,
  refreshRemoteEditor,
  registerResource,
  replyComment,
  resolveComment,
  setAttachments,
  startWatch,
  stopWatch,
} from "./editors.mjs";
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup, unitsForTree } from "./hierarchy.mjs";
import { openTaskDetail, renderApproval, renderGrants, renderMachine, renderSession, renderTask, renderUnit, renderWaiting } from "./inspector.mjs";
import { text } from "./i18n.mjs";
import { collectPages, createPagedList, loadAll, reloadList, renderWindow, setQuery, windowRange } from "./lists.mjs";
import { adoptInitialLayout, applyRemoteLayout, centerUnit, createMap, keepLocalPosition, renderMap, useIncomingPosition } from "./map.mjs";
import { dispose as disposeEmbed, publishDirty, publishReady, startEmbedChannel } from "./embed.mjs";
import { PHONE_NAV, exchangeCode, exchangeHomeFragment, logout, renderCodeEntry, renderPhone } from "./phone.mjs";
import { applyIssueChange, applyServiceBeat, applySettingsRead, applySyncSnapshot, armExpiry, clearGrant, closeHome, noteHomeChange, openHome, renderSettings, saveSettings, takeGrant } from "./settings.mjs";
import { acceptStreamEvent, createStore, loadSnapshot } from "./state.mjs";
import { answerProposal, enterFocus, leaveFocus, loadProposals, moveFocus, noteProposal, rememberTextDraft, renderDocument, renderProposal, replaceDocument, saveRange, selectedPlainRange, showTools, sourceReplacement, textAnchor, textDraft, textDraftKey } from "./void.mjs";
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
  if (app.homeState?.expiryTimer != null) clearTimeout(app.homeState.expiryTimer);
  if (app.homeState) {
    app.homeState.expiryTimer = null;
    clearGrant(app.homeState);
  }
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
  armHomeExpiry(app);
}

function inputDrafts(app) {
  if (!app.inputDrafts) {
    app.inputDrafts = { chats: new Map(), notes: new Map(), nodes: new Map(), resources: new Map(), mail: new Map(), focus: null, cleared: new Set() };
  }
  return app.inputDrafts;
}

function draftMap(app, name) {
  const drafts = inputDrafts(app);
  if (!drafts[name]) drafts[name] = new Map();
  return drafts[name];
}

function textDraftsDiffer(editor) {
  if (!editor?.textDrafts?.size) return false;
  const pages = editor.authoritative?.document?.pages ?? editor.document?.pages ?? [];
  for (const [key, value] of editor.textDrafts) {
    const parts = String(key).split("\0");
    const page = pages.find((item) => item.k === parts[1]);
    if (!page || page[parts[2]] !== value) return true;
  }
  return false;
}

function editorFormsDirty(editor) {
  if (!editor) return false;
  if (editor.commentText) return true;
  if (editor.nodeDraft) return true;
  if (textDraftsDiffer(editor)) return true;
  const mirrored = editor.draftKey ? textDraft(editor, editor.resourceId, editor.draftKey.k, editor.draftKey.lang) : undefined;
  return Boolean(editor.draftText) && editor.draftText !== mirrored;
}

function aggregateDirty(app) {
  const drafts = inputDrafts(app);
  for (const name of ["chats", "notes", "nodes", "resources", "mail", "auxiliary"]) {
    for (const value of drafts[name]?.values() ?? []) {
      const text = typeof value === "string" ? value : value?.value;
      if (text) return true;
    }
  }
  const seen = new Set();
  const editors = [];
  if (app.editors?.current) editors.push(app.editors.current);
  for (const editor of app.editors?.drafts?.values() ?? []) editors.push(editor);
  for (const editor of editors) {
    if (!editor || seen.has(editor)) continue;
    seen.add(editor);
    if (editorFormsDirty(editor)) return true;
  }
  return false;
}

function syncViewerDirty(app) {
  const editor = app.editors?.current;
  if (editor) editor.dirty = editorFormsDirty(editor);
  if (!(app.store.capabilities ?? []).includes("viewer.write")) return null;
  const dirty = aggregateDirty(app);
  if (app.embed && app.embedDirty !== dirty) {
    app.embedDirty = dirty;
    publishDirty(app.embed, dirty);
  }
  if (app.viewerDirty === dirty) return app.viewerPatch ?? null;
  app.viewerDirty = dirty;
  if (app.editors) app.editors.viewerDirty = dirty;
  const operation = createOperation({ method: "PATCH", path: "/viewer", body: { dirty } });
  app.viewerPatch = request(app.api, "PATCH", "/viewer", { operation }).catch((error) => {
    if (!app.disposed) noteAction(app, error);
  });
  if (app.editors) app.editors.viewerPatch = app.viewerPatch;
  return app.viewerPatch;
}

function rememberFormDraft(app, name, id, value) {
  const map = draftMap(app, name);
  if (value) map.set(id, value);
  else map.delete(id);
  syncViewerDirty(app);
}

function releaseFormDraft(app, name, id, saved) {
  const map = draftMap(app, name);
  if (saved === undefined || map.get(id) === saved || map.get(id)?.value === saved) map.delete(id);
  syncViewerDirty(app);
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
  const bucket = kind === "chat" ? drafts.chats : kind === "note" ? drafts.notes : draftMap(app, kind);
  bucket.delete(id);
  drafts.cleared.add(`${kind}:${id}`);
  if (drafts.focus?.kind === kind && drafts.focus.id === id) drafts.focus = null;
  syncViewerDirty(app);
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
  app.root?.ownerDocument?.removeEventListener?.("selectionchange", app.onCommentSelection);
  app.api.live && (app.api.live.stopped = true);
  for (const list of [app.unitList, app.chatList, app.waitingList]) {
    if (!list) continue;
    list.controller?.abort();
    if (list.timer) clearTimeout(list.timer);
    list.timer = null;
  }
  if (app.homeState?.expiryTimer != null) clearTimeout(app.homeState.expiryTimer);
  if (app.homeState) {
    app.homeState.expiryTimer = null;
    clearGrant(app.homeState);
  }
  disposeEmbed(app.embed);
  releaseAssets(app.editors?.current);
  disposeApi(app.api);
}

async function onStream(app, event) {
  if (app.disposed) return;
  const result = await acceptStreamEvent(app.store, app.api, event);
  if (app.disposed || result?.dropped) return;
  if (event?.name === "home.changed") noteHome(app, dataOf(event));
  if (event?.name === "sync.changed") noteSync(app, dataOf(event));
  if (event?.name === "service.changed") noteService(app, dataOf(event));
  if (event?.name === "issue.changed") noteIssue(app, dataOf(event));
  if (event?.name === "stream.ready" || event?.name === "settings.changed" || event?.name === "viewer.changed") {
    await loadPresentation(app);
    if (event?.name === "stream.ready") await recheckTracked(app);
    result?.consume?.();
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
  result?.consume?.();
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
  if (app.mode === "focus") return renderFocusWorkspace(app, t);
  if (app.layout !== "phone" && (app.mode === "blueprint" || app.mode === "document")) return renderEditorWorkspace(app, t);
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
      "data-code": app.actionCode ?? "",
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
      syncViewerDirty(app);
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
  const host = element(document, "div", { class: "list", role: "listbox", "aria-label": t(app.tab), "data-collection": "true" });
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
    const screenMarked = event.target?.closest?.("[data-screen]");
    const svg = host.querySelector("svg");
    const point = boardPoint(svg, event);
    const located = { resourceId: editor.resourceId, x: point.x, y: point.y };
    if (marked?.getAttribute?.("data-node")) {
      const nodeId = marked.getAttribute("data-node");
      const screenId = marked.closest?.("[data-screen]")?.getAttribute("data-screen") ?? null;
      app.editors.selectedNodeId = nodeId;
      app.editors.focus = { ...(app.editors.focus ?? {}), screenId, resourceId: editor.resourceId };
      app.editors.commentTarget = { ...located, kind: "node", nodeId, screenId };
    } else if (screenMarked?.getAttribute?.("data-screen")) {
      const screenId = screenMarked.getAttribute("data-screen");
      app.editors.selectedNodeId = null;
      app.editors.focus = { ...(app.editors.focus ?? {}), screenId, resourceId: editor.resourceId };
      app.editors.commentTarget = { ...located, kind: "screen", screenId };
    } else {
      const hit = hitBoardNode(editor.authoritative.document, point);
      if (hit?.nodeId) {
        app.editors.selectedNodeId = hit.nodeId;
        app.editors.focus = { ...(app.editors.focus ?? {}), screenId: hit.screenId, resourceId: editor.resourceId };
        app.editors.commentTarget = { ...located, kind: "node", nodeId: hit.nodeId, screenId: hit.screenId };
      } else {
        app.editors.commentTarget = { ...located, kind: "canvas" };
      }
    }
    renderShell(app);
  });
  const nodes = editor.authoritative.document.screens?.[0];
  const tools = element(document, "div", { class: "editor-actions" });
  const name = element(document, "input", { "data-node-name": "true", "aria-label": t("nodeName") });
  name.value = draftMap(app, "nodes").get(editor.resourceId) ?? "";
  name.addEventListener("input", () => {
    editor.nodeDraft = name.value;
    rememberFormDraft(app, "nodes", editor.resourceId, name.value);
  });
  tools.append(name);
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "patch-node",
    onclick: () => {
      const saved = name.value;
      patchNode(app.api, editor, app.editors.selectedNodeId, { name: saved, value: saved }).then(() => {
        if (draftMap(app, "nodes").get(editor.resourceId) === saved) editor.nodeDraft = "";
        releaseFormDraft(app, "nodes", editor.resourceId, saved);
        if (!app.disposed) renderShell(app);
      }).catch((error) => noteEditor(app, error));
    },
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
  if (canEditResources(app)) tools.append(structureTools(app, document, editor, t));
  for (const issue of editor.assetIssues ?? []) {
    tools.append(element(document, "p", { "data-asset-issue": issue.code, text: t("assetMissing") }));
  }
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
  }, text).then(() => {
    syncViewerDirty(app);
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteEditor(app, error));
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
  const pages = editor.authoritative.document.pages ?? [];
  const lang = app.language === "es" ? "es" : "en";
  if (!app.voidState || app.voidState.resourceId !== editor.resourceId) {
    const requested = editor.page ?? editor.focus?.k;
    app.voidState = {
      mode: app.mode,
      tools: app.mode !== "focus",
      page: pages.some((page) => page.k === requested) ? requested : pages[0]?.k,
      pages,
      resourceId: editor.resourceId,
    };
  } else {
    app.voidState.pages = pages;
    if (!pages.some((page) => page.k === app.voidState.page)) app.voidState.page = pages[0]?.k;
  }
  editor.page = app.voidState.page;
  editor.language = lang;
  const host = element(document, "div", { class: "void-page", "data-void": "true" });
  renderDocument(document, host, editor);
  const tools = element(document, "div", { class: `void-tools${app.voidState.tools ? " is-visible" : ""}`, "data-tools": app.voidState.tools ? "visible" : "hidden" });
  const page = pages.find((item) => item.k === editor.page);
  const stored = textDraft(editor, editor.resourceId, editor.page, lang);
  const source = element(document, "textarea", { "data-source": "true", "data-draft-key": `${editor.resourceId}:${editor.page}:${lang}` });
  source.value = stored === undefined ? (page?.[lang] ?? "") : stored;
  source.addEventListener("input", () => {
    rememberTextDraft(editor, editor.resourceId, editor.page, lang, source.value);
    syncViewerDirty(app);
  });
  tools.append(source);
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "save-range",
    onclick: () => saveVoid(app, editor, source.value),
  }, t("send")));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "enter-focus",
    onclick: () => {
      enterFocus(app.voidState);
      app.mode = "focus";
      renderShell(app);
    },
  }, t("focus")));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "comment-quote",
    onclick: () => commentOnQuote(app, editor),
  }, t("comment")));
  if (canEditResources(app) && app.mode === "document") {
    syncStructureDraft(app, editor);
    const title = editorField(document, app, t, "documentTitle", "resourceTitle", "document-title");
    tools.append(title, element(document, "button", {
      type: "button", class: "btn", "data-action": "replace-document",
      onclick: () => replaceVoidDocument(app, editor),
    }, t("replaceDocument")));
  }
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
  if (app.mode === "focus") return element(document, "div", { class: "focus-document" }, host, tools);
  return element(document, "div", {}, host, tools, list);
}

function saveVoid(app, editor, value) {
  const page = editor.authoritative.document.pages.find((item) => item.k === (editor.page ?? app.voidState.page));
  const lang = app.language === "es" ? "es" : "en";
  const current = page?.[lang] ?? "";
  rememberTextDraft(editor, editor.resourceId, page.k, lang, value);
  const bounds = sourceReplacement(current, value);
  saveRange(app.api, editor, page.k, lang, bounds.start, bounds.end, bounds.replacement).then(() => {
    editor.textDrafts?.delete(textDraftKey(editor.resourceId, page.k, lang));
    if (editor.draftKey?.k === page.k && editor.draftKey?.lang === lang) editor.draftText = "";
    syncViewerDirty(app);
    if (!app.disposed) renderShell(app);
  }).catch((error) => {
    editor.conflict = { ...(editor.conflict ?? {}), code: error.code, draftKey: { k: page.k, lang } };
    noteEditor(app, error);
  });
}

function commentOnQuote(app, editor) {
  const page = editor.authoritative.document.pages.find((item) => item.k === (editor.page ?? app.voidState.page));
  const lang = app.language === "es" ? "es" : "en";
  const host = app.root.querySelector?.("[data-void]");
  const document = app.root.ownerDocument;
  const selection = document.getSelection?.() ?? document.defaultView?.getSelection?.();
  if (host && selection?.anchorNode && !host.contains(selection.anchorNode)) return;
  const range = selectedPlainRange(selection);
  if (!page || !range) return;
  const anchor = textAnchor(editor, page.k, lang, range.start, range.end);
  createComment(app.api, app.editors, anchor, editor.commentText || anchor.quote).then(() => {
    syncViewerDirty(app);
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteEditor(app, error));
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
    app.root.querySelector?.("[data-action='enter-focus']")?.focus?.();
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  moveFocus(app.voidState, event.key);
  event.preventDefault();
  renderShell(app);
}

function renderFocusWorkspace(app, t) {
  const document = app.root.ownerDocument;
  const current = editorsOf(app).current;
  const reading = element(document, "div", { class: "focus-reading", "data-focus-layout": "document" });
  if (current?.kind === "void" && current.authoritative?.document) reading.append(voidSurface(app, document, current, t));
  return element(document, "div", { class: "workspace workspace-focus" }, reading);
}

function renderEditorWorkspace(app, t) {
  const document = app.root.ownerDocument;
  const surfaces = renderEditorSurfaces(app, t);
  return element(document, "div", {
    class: "workspace workspace-editor",
    "data-editor-layout": app.mode,
  }, surfaces.catalog, surfaces.resource, surfaces.comments);
}

function renderEditor(app, t) {
  const document = app.root.ownerDocument;
  const surfaces = renderEditorSurfaces(app, t);
  return element(document, "div", { class: "editor-panel" }, surfaces.catalog, surfaces.resource, surfaces.comments);
}

function renderEditorSurfaces(app, t) {
  const document = app.root.ownerDocument;
  const editors = editorsOf(app);
  const kind = app.mode === "blueprint" ? "blueprint" : "void";
  queueCatalog(app, kind);
  const current = editors.current?.kind === kind ? editors.current : null;
  const title = current?.authoritative?.title ?? current?.authoritative?.legacy?.id ?? t(app.mode);
  const watch = editors.watch;
  const watchText = !watch || watch.state === "off" ? t("watchOff") : watch.state === "watching" ? t("watching", { unit: watch.unitId }) : t("watchWaiting", { unit: watch.unitId });
  const catalog = element(document, "aside", { class: "panel editor-catalog", "data-editor-column": "catalog" },
    element(document, "h2", { text: t(kind === "blueprint" ? "boards" : "texts") }),
  );
  const resource = element(document, "section", { class: "panel editor-resource", "data-editor-column": "resource" },
    element(document, "h2", { "data-editor-title": title, "data-editor-kind": kind, text: `${t(app.mode)} ${title}` }),
  );
  const commentsColumn = element(document, "aside", { class: "panel editor-comments-column", "data-editor-column": "comments" },
    element(document, "h2", { text: t("comments") }),
  );
  const tools = element(document, "div", { class: "editor-tools", "data-editor-tools": "true" },
    element(document, "p", { "data-watch": watch?.state ?? "off", text: watchText }),
  );
  resource.append(tools);
  if (current?.conflict) {
    resource.append(element(document, "p", { "data-conflict": "true", text: t("outsideChange") }));
    resource.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "discard-draft",
      text: t("discardDraft"),
      onclick: () => {
        const resourceId = editors.current?.resourceId;
        discardEditorDraft(editors);
        if (resourceId) {
          draftMap(app, "nodes").delete(resourceId);
          if (editors.current) editors.current.nodeDraft = "";
        }
        syncViewerDirty(app);
        renderShell(app);
      },
    }));
    resource.append(element(document, "button", {
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
  if (current?.kind === "blueprint" && current.authoritative?.document) resource.append(boardSurface(app, document, current, t));
  if (current?.kind === "void" && current.authoritative?.document) resource.append(voidSurface(app, document, current, t));
  if (current?.authoritative?.legacy?.reason === "conversion_required") {
    const path = current.authoritative.legacy.path ?? "";
    resource.append(element(document, "p", { "data-legacy": path, text: path }));
    resource.append(element(document, "p", { text: t("conversionRequired") }));
    if (canEditResources(app)) {
      resource.append(element(document, "button", {
        type: "button", class: "btn", "data-action": "copy-json",
        onclick: () => submitJsonCopy(app, current),
      }, t("copyJson")));
    }
  }
  if (editors.error?.code === "corrupt_resource") resource.append(element(document, "p", { text: t("corruptResource") }));
  const catalogRows = [];
  for (const group of groupCatalog(editors.catalog)) {
    for (const item of group.items) {
      catalogRows.push({
        id: item.id,
        kind: "editor",
        text: `${group.project} ${item.title}`,
        pos: catalogRows.length + 1,
        setsize: editors.catalogTotal ?? editors.catalog.length,
        item,
      });
    }
  }
  const list = element(document, "div", { class: "editor-list list", "data-editor-total": String(editors.catalogTotal ?? editors.catalog.length) });
  const catalogWindow = editors.catalogWindow ?? { scrollTop: 0, rowHeight: 36, height: 0, focusId: current?.resourceId ?? null };
  editors.catalogWindow = catalogWindow;
  renderWindow(document, list, catalogWindow, catalogRows, {
    selectedId: current?.resourceId,
    onActivate: (row) => selectEditor(app, row.item),
  });
  catalog.append(list);
  const forms = resourceForms(app, document, t);
  if (forms) catalog.append(forms);
  const surfaces = { catalog, resource, comments: commentsColumn };
  if (!current) return surfaces;
  const draft = element(document, "textarea", {
    class: "editor-compose",
    "data-draft": current.resourceId,
    oninput: () => {
      rememberFormDraft(app, "auxiliary", current.resourceId, draft.value);
    },
  });
  draft.value = draftMap(app, "auxiliary").get(current.resourceId) ?? "";
  resource.append(draft);
  if (current.attachmentResource !== current.resourceId) {
    current.attachmentChoice = new Set(current.attached ?? []);
    current.attachmentResource = current.resourceId;
  }
  const choice = current.attachmentChoice;
  const units = app.unitList?.catalog ?? [];
  const picker = element(document, "div", { class: "attach-list list", "data-attached": [...choice].join(" "), "data-attach-total": String(units.length) });
  const attachWindow = editors.attachWindow ?? { scrollTop: 0, rowHeight: 36, height: 0, focusId: null };
  editors.attachWindow = attachWindow;
  renderWindow(document, picker, attachWindow, units.map((unit, index) => ({
    id: unit.id,
    kind: "unit",
    text: `${choice.has(unit.id) ? "* " : ""}${unit.unit}`,
    pos: index + 1,
    setsize: units.length,
    unit,
  })), {
    onActivate: (row) => {
      if (choice.has(row.id)) choice.delete(row.id);
      else if (choice.size >= 256) editors.error = { code: "invalid_body" };
      else choice.add(row.id);
      renderShell(app);
    },
  });
  const actions = element(document, "div", { class: "editor-actions" });
  actions.append(element(document, "button", { type: "button", class: "btn", "data-action": "attach", onclick: () => saveAttachments(app) }, t("attach")));
  actions.append(element(document, "button", { type: "button", class: "btn", "data-action": "watch", onclick: () => followEditor(app) }, t("watch")));
  actions.append(element(document, "button", { type: "button", class: "btn", "data-action": "stop-watch", onclick: () => stopWatch(app.api, editors).then(() => renderShell(app)).catch((error) => noteEditor(app, error)) }, t("stopWatch")));
  tools.append(picker, actions);
  const comments = element(document, "div", { class: "editor-comments", "data-comment-total": String(current.commentsTotal ?? current.threads?.length ?? 0) });
  const commentBound = Math.min(current.threads?.length ?? 0, current.commentWindow ?? 40);
  for (const thread of (current.threads ?? []).slice(0, commentBound)) {
    const box = element(document, "article", { class: "comment-box", "data-thread": thread.id, "data-status": thread.status ?? "open" });
    box.append(element(document, "p", { text: (thread.messages ?? []).map((message) => message.text).join(" ") }));
    box.append(element(document, "button", { type: "button", class: "btn", "data-action": "reply", onclick: () => replyToThread(app, thread.id) }, t("reply")));
    box.append(element(document, "button", { type: "button", class: "btn", "data-action": "resolve", onclick: () => resolveThread(app, thread.id) }, t("resolve")));
    comments.append(box);
  }
  if ((current.threads?.length ?? 0) > commentBound) {
    comments.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "more-comments",
      text: t("loadOlder"),
      onclick: () => {
        current.commentWindow = commentBound + 40;
        renderShell(app);
      },
    }));
  }
  const compose = element(document, "textarea", { "data-comment": "true" });
  compose.value = current.commentText ?? "";
  const commentButton = element(document, "button", {
    type: "button",
    class: "btn primary",
    "data-action": "comment",
    disabled: commentCanSubmit(app, compose.value) ? null : "",
    onclick: () => addEditorComment(app, compose),
  }, t("addComment"));
  commentButton.disabled = !commentCanSubmit(app, compose.value);
  compose.addEventListener("input", () => {
    current.commentText = compose.value;
    setCommentEnabled(commentButton, commentCanSubmit(app, compose.value));
    syncViewerDirty(app);
  });
  const owner = document;
  if (app.onCommentSelection) owner.removeEventListener?.("selectionchange", app.onCommentSelection);
  app.onCommentSelection = () => {
    const field = app.root.querySelector?.("[data-comment]");
    const button = app.root.querySelector?.("[data-action='comment']");
    if (!field || !button) return;
    setCommentEnabled(button, commentCanSubmit(app, field.value));
  };
  owner.addEventListener?.("selectionchange", app.onCommentSelection);
  commentsColumn.append(comments, compose, commentButton);
  const noticeCopy = { pending: "queued", queued: "queued", submitted: "submitted", ambiguous: "ambiguous", failed: "failed" };
  for (const notice of current.notices ?? []) {
    const key = noticeCopy[notice.state];
    if (!key) continue;
    commentsColumn.append(element(document, "p", { "data-notice": notice.state, text: t(key) }));
  }
  return surfaces;
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

function saveAttachments(app) {
  const choice = editorsOf(app).current?.attachmentChoice;
  setAttachments(app.api, editorsOf(app), [...(choice ?? [])]).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function followEditor(app) {
  const editors = editorsOf(app);
  const unitId = [...(editors.current?.attachmentChoice ?? [])][0] ?? editors.current?.attached?.[0];
  if (!unitId || !editors.current) return;
  startWatch(app.api, editors, { unitId, resourceId: editors.current.resourceId }).then(() => renderShell(app)).catch((error) => noteEditor(app, error));
}

function commentCanSubmit(app, value) {
  return Boolean(currentCommentAnchor(app)) && typeof value === "string" && value.trim().length > 0;
}

function setCommentEnabled(button, enabled) {
  button.disabled = !enabled;
  if (enabled) button.removeAttribute("disabled");
  else button.setAttribute("disabled", "");
}

function currentCommentAnchor(app) {
  const editor = app.editors?.current;
  const board = editor?.authoritative?.document ?? editor?.document;
  if (!editor || !board) return null;
  if (editor.kind === "void") {
    const host = app.root.querySelector?.("[data-void]");
    const document = app.root.ownerDocument;
    const selection = document?.getSelection?.() ?? document?.defaultView?.getSelection?.();
    if (!host || !selection?.anchorNode || !host.contains(selection.anchorNode)) return null;
    const range = selectedPlainRange(selection);
    const k = editor.page ?? app.voidState?.page;
    const lang = app.language === "es" ? "es" : "en";
    const page = board.pages?.find((item) => item.k === k);
    if (!range || !page || typeof page[lang] !== "string") return null;
    return textAnchor(editor, k, lang, range.start, range.end);
  }
  const target = app.editors.commentTarget;
  if (!target || target.resourceId !== editor.resourceId) return null;
  return boardCommentAnchor(board, target);
}

function addEditorComment(app, compose) {
  const editors = editorsOf(app);
  const current = editors.current;
  if (!current) return;
  const value = compose.value;
  current.commentText = value;
  const anchor = currentCommentAnchor(app);
  if (!anchor || !value.trim()) return;
  createComment(app.api, editors, anchor, value).then(() => {
    syncViewerDirty(app);
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteEditor(app, error));
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

function canEditResources(app) {
  return (app.store.capabilities ?? []).includes("editor.write");
}

function editorDraft(app) {
  if (!app.editorDraft) app.editorDraft = { project: "shop", path: "", createPath: "", id: "", title: "", width: "", height: "", documentTitle: "" };
  return app.editorDraft;
}

function editorField(document, app, t, key, labelKey, field) {
  const input = element(document, "input", { "data-field": field, "aria-label": t(labelKey) });
  input.value = editorDraft(app)[key] ?? "";
  input.addEventListener("input", () => {
    editorDraft(app)[key] = input.value;
    rememberFormDraft(app, "resources", key, input.value);
  });
  return input;
}

function syncStructureDraft(app, current) {
  if (!current || app.structureResource === current.resourceId) return;
  app.structureResource = current.resourceId;
  const draft = editorDraft(app);
  const screen = current.authoritative?.document?.screens?.[0];
  draft.width = screen ? String(screen.w ?? "") : "";
  draft.height = screen ? String(screen.h ?? "") : "";
  draft.documentTitle = current.authoritative?.document?.title ?? current.authoritative?.title ?? "";
}

function resourceForms(app, document, t) {
  if (!canEditResources(app)) return null;
  const kind = app.mode === "blueprint" ? "blueprint" : "void";
  const box = element(document, "div", { class: "editor-actions", "data-editor-forms": kind });
  box.append(
    editorField(document, app, t, "project", "registerProject", "register-project"),
    editorField(document, app, t, "path", "registerPath", "register-path"),
    element(document, "button", {
      type: "button", class: "btn", "data-action": "register-resource", "data-kind": kind,
      onclick: () => submitRegister(app, kind),
    }, t("registerResource")),
    editorField(document, app, t, "id", "resourceId", "create-id"),
    editorField(document, app, t, "title", "resourceTitle", "create-title"),
    editorField(document, app, t, "createPath", "registerPath", "create-path"),
    element(document, "button", {
      type: "button", class: "btn", "data-action": "create-resource", "data-kind": kind,
      onclick: () => submitCreate(app, kind),
    }, t("createResource")),
  );
  return box;
}

function submitRegister(app, kind) {
  const draft = editorDraft(app);
  const savedPath = draft.path;
  registerResource(app.api, { kind, project: draft.project.trim(), path: draft.path.trim() })
    .then((result) => {
      releaseFormDraft(app, "resources", "path", savedPath);
      return openCreated(app, result.data, kind);
    })
    .catch((error) => noteEditor(app, error));
}

function submitCreate(app, kind) {
  const draft = editorDraft(app);
  const id = draft.id.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) {
    noteEditor(app, { code: "invalid_document" });
    return;
  }
  const title = draft.title.trim() || id;
  const path = draft.createPath.trim() || (kind === "blueprint" ? `docs/flows/boards/${id}.json` : `docs/${id}.json`);
  const document = kind === "blueprint" ? starterBoard(id, title) : starterText(id, title);
  const savedId = draft.id;
  const savedTitle = draft.title;
  const savedCreatePath = draft.createPath;
  createResource(app.api, kind, { project: draft.project.trim(), path, document })
    .then((result) => {
      releaseFormDraft(app, "resources", "id", savedId);
      releaseFormDraft(app, "resources", "title", savedTitle);
      releaseFormDraft(app, "resources", "createPath", savedCreatePath);
      return openCreated(app, result.data, kind);
    })
    .catch((error) => noteEditor(app, error));
}

function submitJsonCopy(app, current) {
  const legacy = current?.authoritative?.legacy;
  const id = jsonCopyId(legacy?.path ?? "");
  if (!id || !canEditResources(app)) return;
  const project = current.authoritative.project || editorDraft(app).project;
  const path = `docs/flows/boards/${id}.json`;
  if (path === legacy.path) return;
  createResource(app.api, "blueprint", { project, path, document: starterBoard(id, legacy.id || id) })
    .then((result) => openCreated(app, result.data, "blueprint"))
    .catch((error) => noteEditor(app, error));
}

function jsonCopyId(path) {
  const base = String(path).split("/").pop()?.replace(/\.mjs$/i, "") ?? "";
  return /^[a-z0-9][a-z0-9-]{0,40}$/.test(base) ? base : "";
}

function openCreated(app, data, kind) {
  const editors = editorsOf(app);
  const summary = { id: data.id, kind: data.kind ?? kind, title: data.title ?? data.id };
  editors.loadedKind = null;
  editors.catalogLoading = false;
  app.store.selected.resourceId = summary.id;
  return openEditor(app.api, editors, summary).then(() => {
    queueCatalog(app, summary.kind === "void" ? "void" : "blueprint");
    if (!app.disposed) renderShell(app);
  });
}

function starterBoard(id, title) {
  return {
    formatVersion: 1,
    id,
    title,
    note: "",
    pages: [
      { id: "main", title: "Main", objects: [], order: ["empty", "next"], start: "empty" },
      { id: "more", title: "More", objects: [], order: [] },
    ],
    screens: [
      screenBox("empty", "Empty", 0),
      screenBox("next", "Next", 420),
    ],
    links: [],
    components: [],
    fonts: [],
    threads: [],
  };
}

function screenBox(id, title, x) {
  return {
    id,
    title,
    pageId: "main",
    x,
    y: 0,
    w: 390,
    h: 844,
    root: { id: `${id}-root`, name: "Root", t: "box", place: { x: 0, y: 0 }, w: 390, h: 844, dir: "stack", kids: [] },
  };
}

function starterText(id, title) {
  return { formatVersion: 1, id, title, pages: [{ k: "Intro.Welcome", en: "", es: "" }] };
}

function structureTools(app, document, editor, t) {
  syncStructureDraft(app, editor);
  const board = editor.authoritative?.document;
  const tools = element(document, "div", { class: "editor-actions", "data-structure": "true" });
  if (!board || editor.authoritative.readOnly) return tools;
  const canMovePage = (board.pages?.length ?? 0) >= 2;
  const canMoveScreen = (board.pages ?? []).some((page) => (page.order?.length ?? 0) >= 2);
  const canLink = (board.screens?.length ?? 0) >= 2;
  tools.append(
    editorField(document, app, t, "width", "screenWidth", "screen-width"),
    editorField(document, app, t, "height", "screenHeight", "screen-height"),
    element(document, "button", { type: "button", class: "btn", "data-action": "resize-screen", onclick: () => resizeBoard(app, editor) }, t("resizeScreen")),
    element(document, "button", { type: "button", class: "btn", "data-action": "move-page", disabled: canMovePage ? null : "", onclick: () => moveBoardPage(app, editor) }, t("movePage")),
    element(document, "button", { type: "button", class: "btn", "data-action": "move-screen", disabled: canMoveScreen ? null : "", onclick: () => moveBoardScreen(app, editor) }, t("moveScreen")),
    element(document, "button", { type: "button", class: "btn", "data-action": "add-link", disabled: canLink ? null : "", onclick: () => addBoardLink(app, editor) }, t("addLink")),
  );
  return tools;
}

function resizeBoard(app, editor) {
  const draft = editorDraft(app);
  const width = Number(draft.width);
  const height = Number(draft.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16000 || height > 16000) return;
  const selected = app.editors?.focus?.screenId;
  const savedWidth = draft.width;
  const savedHeight = draft.height;
  saveBoardStructure(app, editor, (document) => {
    const screen = document.screens?.find((item) => item.id === selected) ?? document.screens?.[0];
    if (!screen) return;
    screen.w = width;
    screen.h = height;
    if (screen.root?.t === "box") {
      screen.root.w = width;
      screen.root.h = height;
    }
  }, () => {
    releaseFormDraft(app, "resources", "width", savedWidth);
    releaseFormDraft(app, "resources", "height", savedHeight);
  });
}

function moveBoardPage(app, editor) {
  if ((editor.authoritative?.document?.pages?.length ?? 0) < 2) return;
  saveBoardStructure(app, editor, (document) => {
    const [first, second] = document.pages;
    document.pages.splice(0, 2, second, first);
  });
}

function moveBoardScreen(app, editor) {
  if (!(editor.authoritative?.document?.pages ?? []).some((page) => (page.order?.length ?? 0) >= 2)) return;
  saveBoardStructure(app, editor, (document) => {
    const page = document.pages.find((item) => (item.order?.length ?? 0) >= 2);
    const [first, second, ...rest] = page.order;
    page.order = [second, first, ...rest];
  });
}

function addBoardLink(app, editor) {
  const screens = editor.authoritative?.document?.screens ?? [];
  if (screens.length < 2) return;
  const from = screens[0].id;
  const to = screens[1].id;
  const id = `link-${from}-${to}`;
  if ((editor.authoritative.document.links ?? []).some((link) => link.id === id)) return;
  saveBoardStructure(app, editor, (document) => {
    document.links = [...(document.links ?? []), { id, from, to, transition: "cut" }];
  });
}

function saveBoardStructure(app, editor, edit, onSaved) {
  if (!canEditResources(app) || !editor?.authoritative?.document || editor.authoritative.readOnly) return;
  const next = editedBoard(editor.authoritative, edit);
  replaceBoard(app.api, editor, next.document).then(() => {
    onSaved?.();
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteEditor(app, error));
}

function replaceVoidDocument(app, editor) {
  if (!canEditResources(app) || !editor?.authoritative?.document || editor.authoritative.readOnly) return;
  const title = editorDraft(app).documentTitle.trim();
  if (!title) return;
  const savedTitle = editorDraft(app).documentTitle;
  const next = structuredClone(editor.authoritative.document);
  next.title = title;
  replaceDocument(app.api, editor, next).then(() => {
    releaseFormDraft(app, "resources", "documentTitle", savedTitle);
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteEditor(app, error));
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
    pan: text(app.language, "pan"),
    statusWorking: text(app.language, "statusWorking"),
    statusWaiting: text(app.language, "statusWaiting"),
    statusIdle: text(app.language, "statusIdle"),
    statusOut: text(app.language, "statusOut"),
    statusQuota: text(app.language, "statusQuota"),
    statusUnknown: text(app.language, "statusUnknown"),
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
  const host = app.root.querySelector?.("[data-collection]");
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
    const ticket = app.settingsSyncTicket ?? 0;
    request(app.api, "GET", "/sync").then((result) => {
      if (app.disposed || ticket !== (app.settingsSyncTicket ?? 0)) return;
      app.settingsSync = applySyncSnapshot(app.settingsSync, result.data);
      app.settingsSyncLoading = false;
      if (app.mode === "settings") renderShell(app);
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
    syncState: app.settingsSync?.state ?? info.service?.syncState ?? app.sync ?? "",
    pendingChanges: app.settingsSync?.pendingChanges,
    syncLabel: t(syncCopy(app.settingsSync?.state ?? (info.service?.syncState === "error" ? "error" : app.sync))),
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
  home.expiredLocally = false;
  noteHomeChange(home, data);
  if (data?.home && app.store.settings) app.store.settings.home = home.home;
}

function noteSync(app, data) {
  app.settingsSyncTicket = (app.settingsSyncTicket ?? 0) + 1;
  app.settingsSync = applySyncSnapshot(app.settingsSync, data);
  app.settingsSyncLoading = false;
}

function noteService(app, data) {
  if (!app.store.settings) app.store.settings = {};
  app.store.settings.service = applyServiceBeat(app.store.settings.service, data?.machine ?? data);
}

function noteIssue(app, data) {
  const view = app.store.view ?? {};
  view.issues = applyIssueChange(view.issues ?? app.unitList?.issues ?? [], data);
  app.store.view = view;
}

function armHomeExpiry(app) {
  const home = homeState(app);
  home.tickMs = app.mode === "settings" ? 1000 : null;
  home.onExpiry = () => {
    if (!app.disposed) renderShell(app);
  };
  const timer = armExpiry(home, Date.now(), (fn, ms) => {
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return handle;
  }, (handle) => clearTimeout(handle));
  if (timer && typeof timer === "object") timer.unref?.();
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
  const syncState = app.settingsSync?.state ?? (app.store.settings?.service?.syncState === "error" ? "error" : app.sync);
  const syncKey = syncCopy(syncState);
  const time = clockText(app.readAt);
  const footer = element(document, "footer", { class: "foot" },
    element(document, "span", { "data-service-machine": machine, text: t("serviceRunning", { machine }) }),
    element(document, "span", { "data-sync": syncState ?? "", "data-pending": String(app.settingsSync?.pendingChanges ?? ""), text: t(syncKey) }),
    element(document, "span", { text: t("lastRead", { time }) }),
  );
  if (Number.isInteger(app.settingsSync?.pendingChanges)) {
    footer.append(element(document, "span", { "data-pending-changes": String(app.settingsSync.pendingChanges), text: t("pendingChanges", { count: app.settingsSync.pendingChanges }) }));
  }
  return footer;
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
  if (sync === "publishing") return "syncPublishing";
  if (sync === "published") return "syncPublished";
  if (sync === "paused") return "syncPaused";
  if (sync === "idle") return "syncIdle";
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

const ACTION_COPY = {
  invalid_lead: "invalidLead",
  machine_unavailable: "machineDown",
  note_required: "noteRequired",
  revision_conflict: "revisionConflict",
  phone_read_only: "phoneReadOnly",
  forbidden: "actionForbidden",
  always_unavailable: "alwaysUnavailable",
  approval_resolved: "approvalResolved",
  status_unchanged: "statusUnchanged",
  review_not_ready: "reviewNotReady",
  nothing_to_undo: "nothingToUndo",
  undo_conflict: "undoConflict",
  request_failed: "actionFailed",
};

const TASK_COPY = {
  open: "taskOpen",
  review: "taskReview",
  done: "taskDone",
  closed: "taskClosed",
};

function showOutcome(app, note, code = null) {
  app.actionNote = note;
  app.actionCode = code;
}

function actionText(language, code, values) {
  return text(language, ACTION_COPY[code] ?? "actionFailed", values);
}

function taskText(language, status) {
  return text(language, TASK_COPY[status] ?? "actionFailed");
}

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
      showOutcome(app, results.map((result) => {
        const target = targets.find((item) => item.id === result.id);
        const unit = target?.unit || text(app.language, "unknown");
        if (result.error) return actionText(app.language, result.error.code, { unit });
        return text(app.language, "unitConnected", { unit, lead: source.unit });
      }).join(" "), results.map((result) => result.error?.code ?? "connected").join(","));
      if (app.unitList) await reloadList(app.unitList);
      if (!app.disposed) renderShell(app);
    },
  });
}

const UNIT_ROLES = ["adjutant", "executive", "executor", "genesis", "incubator", "master", "overlord", "overseer"];
const SCOPE_KINDS = [
  ["root", "scopeRoot"],
  ["environment", "scopeEnvironment"],
  ["project", "scopeProject"],
];

async function openUnitForm(app) {
  let machines = [];
  try {
    machines = (await collectPages(app.api, "/machines", { limit: 50 })).items;
  } catch (error) {
    noteAction(app, error);
    return;
  }
  const leads = leadChoices(app);
  openChoiceForm(app, "unit", text(app.language, "newUnit"), (form, confirm) => {
    const document = form.ownerDocument;
    appendInput(document, form, "unit", text(app.language, "unitName"), "");
    appendSelect(document, form, "role", text(app.language, "role"), UNIT_ROLES.map((role) => ({ value: role, label: role })), "executor");
    appendSelect(document, form, "scopeKind", text(app.language, "scopeKind"), SCOPE_KINDS.map(([value, label]) => ({
      value,
      label: text(app.language, label),
    })), "project");
    appendInput(document, form, "scopeName", text(app.language, "scopeName"), "shop");
    appendSelect(document, form, "machine", text(app.language, "machine"), machines.map((machine) => ({
      value: machine.id,
      label: `${machine.id}: ${machine.answers ? text(app.language, "machineAnswers") : text(app.language, "machineSilent")}`,
      disabled: !machine.answers,
    })), machines.find((machine) => machine.answers)?.id ?? "");
    for (const machine of machines) {
      for (const issue of machine.issues ?? []) {
        form.append(element(document, "p", {
          "data-machine-issue": machine.id,
          text: issue.message || text(app.language, "machineUnavailable", { machine: machine.id }),
        }));
      }
    }
    appendSelect(document, form, "leadId", text(app.language, "lead"), [
      { value: "", label: text(app.language, "unknown") },
      ...leads.map((unit) => ({ value: unit.id, label: unit.unit })),
    ], "");
    appendInput(document, form, "job", text(app.language, "job"), "");
    appendInput(document, form, "model", text(app.language, "model"), "");
    appendInput(document, form, "positionX", text(app.language, "positionX"), "");
    appendInput(document, form, "positionY", text(app.language, "positionY"), "");
    if (!machines.some((machine) => machine.answers)) confirm.disabled = true;
  }, async (form) => {
    const machineId = fieldValue(form, "machine");
    const machine = machines.find((item) => item.id === machineId);
    if (!machine?.answers) {
      showOutcome(app, text(app.language, "machineUnavailable", { machine: machineId }), "machine_unavailable");
      if (!app.disposed) renderShell(app);
      return;
    }
    const kind = fieldValue(form, "scopeKind");
    const name = fieldValue(form, "scopeName").trim();
    const leadId = fieldValue(form, "leadId");
    try {
      const created = await createUnit(app.api, {
        unit: fieldValue(form, "unit").trim(),
        role: fieldValue(form, "role"),
        scope: { kind, name: kind === "root" ? null : name },
        machine: machineId,
        leadId: leadId || null,
        job: fieldValue(form, "job").trim() || null,
        model: fieldValue(form, "model").trim() || null,
        position: readPosition(form),
      });
      const unit = created.data?.unit?.unit ?? fieldValue(form, "unit").trim();
      showOutcome(app, text(app.language, "unitCreated", { unit }));
      if (app.unitList) await reloadList(app.unitList);
    } catch (error) {
      showOutcome(app, error?.code === "machine_unavailable"
        ? text(app.language, "machineUnavailable", { machine: error.details?.machine ?? machineId })
        : actionText(app.language, error?.code), error?.code ?? null);
    }
    if (!app.disposed) renderShell(app);
  });
}

async function openSessionForm(app, unit) {
  let machines = [];
  try {
    machines = (await collectPages(app.api, "/machines", { limit: 50 })).items;
  } catch (error) {
    noteAction(app, error);
    return;
  }
  const machine = machines.find((item) => item.id === unit.machine) ?? null;
  const clients = (machine?.clients ?? []).filter((item) => item.enabled === true && item.installed === true);
  openChoiceForm(app, "session", text(app.language, "startSession"), (form, confirm) => {
    const document = form.ownerDocument;
    if (machine) form.append(renderMachine(document, machine, (key, values) => text(app.language, key, values)));
    if (!clients.length) {
      form.append(element(document, "p", { "data-client-unavailable": "true", text: text(app.language, "clientUnavailable") }));
      confirm.disabled = true;
      return;
    }
    appendSelect(document, form, "client", text(app.language, "client"), clients.map((item) => ({
      value: item.id,
      label: item.id,
    })), clients[0].id);
    appendInput(document, form, "prompt", text(app.language, "prompt"), "");
  }, async (form) => {
    const client = fieldValue(form, "client");
    if (!clients.some((item) => item.id === client)) {
      showOutcome(app, text(app.language, "clientUnavailable"), "client_unavailable");
      if (!app.disposed) renderShell(app);
      return;
    }
    try {
      const started = await startSession(app.api, unit, client, fieldValue(form, "prompt").trim() || null);
      app.sessionRequestId = started.data.requestId;
      showOutcome(app, text(app.language, SESSION_COPY[started.data.state] ?? "actionFailed"), started.data.state ?? null);
      if (started.data.state === "queued" || started.data.state === "starting") await recheckTracked(app);
    } catch (error) {
      showOutcome(app, error?.code === "machine_unavailable"
        ? text(app.language, "machineUnavailable", { machine: error.details?.machine ?? unit.machine })
        : actionText(app.language, error?.code), error?.code ?? null);
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
        showOutcome(app, text(app.language, SESSION_COPY[stopped.data.state] ?? "sessionStopping"), stopped.data.state ?? null);
      } catch (error) {
        showOutcome(app, actionText(app.language, error?.code), error?.code ?? null);
      }
      if (!app.disposed) renderShell(app);
    },
  });
}

function openChoiceForm(app, kind, title, build, onConfirm) {
  const document = app.root.ownerDocument;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.setAttribute("data-form", kind);
  const form = element(document, "form", { method: "dialog" });
  form.append(element(document, "h2", { text: title }));
  const confirm = element(document, "button", { type: "button", class: "btn primary", "data-action": "confirm-form", text: title });
  build(form, confirm);
  const actions = element(document, "div", { class: "dialog-actions" });
  const cancel = element(document, "button", { type: "button", class: "btn", text: text(app.language, "cancel") });
  let sending = false;
  cancel.addEventListener("click", () => dialog.close());
  confirm.addEventListener("click", async () => {
    if (sending || confirm.disabled) return;
    sending = true;
    dialog.close();
    try {
      await onConfirm(form);
    } finally {
      sending = false;
    }
  });
  actions.append(cancel, confirm);
  form.append(actions);
  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
}

function appendInput(document, form, name, label, value) {
  const input = document.createElement("input");
  input.setAttribute("name", name);
  input.setAttribute("aria-label", label);
  input.value = value;
  form.append(element(document, "label", { text: label }, input));
  return input;
}

function appendSelect(document, form, name, label, choices, value) {
  const select = document.createElement("select");
  select.setAttribute("name", name);
  select.setAttribute("aria-label", label);
  for (const choice of choices) {
    const option = element(document, "option", {
      value: choice.value,
      text: choice.label,
      disabled: choice.disabled ? "" : null,
    });
    option.value = choice.value;
    if (choice.disabled) option.disabled = true;
    select.append(option);
  }
  select.value = value ?? "";
  form.append(element(document, "label", { text: label }, select));
  return select;
}

function fieldValue(form, name) {
  return form.querySelector(`[name="${name}"]`)?.value ?? "";
}

function readPosition(form) {
  const x = fieldValue(form, "positionX").trim();
  const y = fieldValue(form, "positionY").trim();
  if (x === "" && y === "") return undefined;
  if (!/^-?\d+$/.test(x) || !/^-?\d+$/.test(y)) return undefined;
  return { x: Number(x), y: Number(y) };
}

function leadChoices(app) {
  const byId = new Map();
  for (const unit of [...(app.unitList?.catalog ?? []), ...(app.store.indexes?.units?.values() ?? [])]) {
    if (unit?.id && unit.revision) byId.set(unit.id, unit);
  }
  return [...byId.values()].sort((left, right) => String(left.unit).localeCompare(String(right.unit), "en"));
}

function noteSession(app, data) {
  const state = data.session?.state;
  if (!state || !SESSION_COPY[state]) return;
  showOutcome(app, text(app.language, SESSION_COPY[state]), state);
}

function noteSessionRequest(app, data) {
  const state = data?.state;
  if (!state || !SESSION_COPY[state]) return;
  if (data.requestId) app.sessionRequestId = data.requestId;
  showOutcome(app, text(app.language, SESSION_COPY[state]), state);
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
      syncViewerDirty(app);
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
    compose.addEventListener("input", () => {
      box.composer = compose.value;
      rememberFormDraft(app, "mail", box.unitId, compose.value);
    });
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
  findDirectChat(app.api, unitId).then((chat) => {
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
  const saved = compose.value;
  postMailbox(app.api, box.unitId, { body: saved }).then((result) => {
    box.composer = box.composer === saved ? "" : box.composer;
    releaseFormDraft(app, "mail", box.unitId, saved);
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
  showOutcome(app, actionText(app.language, error?.code), error?.code ?? null);
  if (!app.disposed) renderShell(app);
}

function renderInspector(app, t, selected) {
  const document = app.root.ownerDocument;
  const panel = element(document, "div", { class: "review-panel" });
  const data = app.inspectorData;
  if (selected) panel.append(renderUnit(document, selected, t));
  const machines = data?.unitId && data.unitId === selected?.id ? data.machines ?? [] : [];
  const machine = machines.find((item) => item.id === selected?.machine);
  if (machine) panel.append(renderMachine(document, machine, t));
  if (!data || data.unitId !== selected?.id) return panel;
  for (const session of data.sessions ?? []) panel.append(renderSession(document, session, t));
  const caps = app.store.capabilities ?? [];
  if (caps.includes("grant.revoke")) panel.append(renderGrants(document, data.grants, t, (grant) => revokeSelectedGrant(app, selected, grant)));
  if (caps.includes("approval.answer")) {
    for (const approval of data.approvals ?? []) panel.append(renderApproval(document, approval, t, (item, decision) => answerSelected(app, item, decision)));
  }
  const tasks = data.tasks ?? [];
  const taskHost = element(document, "div", { class: "task-window list", "data-task-total": String(data.taskTotal ?? tasks.length) });
  const taskList = app.taskWindow ?? { scrollTop: 0, rowHeight: 36, height: 0, focusId: app.openTaskId ?? null };
  app.taskWindow = taskList;
  if (tasks.length >= 100) {
    renderWindow(document, taskHost, taskList, tasks.map((task, index) => ({
      id: task.id,
      kind: "task",
      text: `${task.number ?? ""} ${task.title ?? ""}`.trim(),
      pos: index + 1,
      setsize: data.taskTotal ?? tasks.length,
      task,
    })), { onActivate: (row) => { app.openTaskId = row.id; renderShell(app); } });
    panel.append(taskHost);
  }
  const visibleTasks = tasks.length >= 100 ? tasks.filter((task) => task.id === app.openTaskId).slice(0, 1) : tasks;
  for (const task of visibleTasks) {
    const noteDraft = inputDrafts(app).notes.get(task.id);
    const phone = app.layout === "phone" || app.store.audience === "phone";
    panel.append(renderTask(document, task, t, (item, status, note) => setTaskStatus(app, item, status, note), caps.includes("task.undo") ? (item) => undoSelected(app, item) : null, noteDraft?.value ?? "", (value, start, end) => {
      inputDrafts(app).notes.set(task.id, { value, start: Number.isInteger(start) ? start : value.length, end: Number.isInteger(end) ? end : value.length });
      syncViewerDirty(app);
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
    collectPages(app.api, "/tasks", { query: { unitId, status: "open,review,done,closed" }, limit: 50 }),
    collectPages(app.api, "/approvals", { query: { unitId, state: "pending" }, limit: 50 }),
    collectPages(app.api, "/approvals", { query: { unitId, state: "expired" }, limit: 20 }),
    request(app.api, "GET", `/units/${encodeURIComponent(unitId)}`),
    collectPages(app.api, "/waiting", { query: { unitId }, limit: 50 }),
    collectPages(app.api, "/machines", { limit: 50 }),
    collectPages(app.api, "/sessions", { query: { unitId }, limit: 50 }),
  ]).then(([tasks, approvals, expired, unit, waiting, machines, sessions]) => {
    if (app.disposed || ticket !== app.inspectorTicket) return;
    app.inspectorData = {
      unitId,
      tasks: tasks.items,
      taskTotal: tasks.total,
      taskIssues: tasks.issues,
      taskNext: tasks.nextCursor,
      approvals: [...approvals.items, ...expired.items],
      approvalTotal: approvals.total + expired.total,
      approvalIssues: [...approvals.issues, ...expired.issues],
      grants: unit.data.approvalGrants ?? [],
      waiting: waiting.items,
      waitingTotal: waiting.total,
      waitingIssues: waiting.issues,
      waitingNext: waiting.nextCursor,
      machines: machines.items,
      sessions: sessions.items,
    };
    if (!app.disposed) renderShell(app);
    if (app.sessionRequestId || (app.answerId && app.answerApprovalId) || app.revocationRequestId) recheckTracked(app);
  }).catch((error) => noteAction(app, error));
}

function answerSelected(app, approval, decision) {
  answerApproval(app.api, approval, decision).then((result) => {
    const next = result.data?.approval ?? null;
    app.answerId = result.data.answerId ?? null;
    app.answerApprovalId = next?.id ?? approval.id;
    if (next) replaceApproval(app, next);
    const label = next ? approvalLabel(app, next) : text(app.language, "answerQueued");
    if (label) showOutcome(app, label, next?.state ?? "answering");
    if (finalApprovalState(next?.state)) refreshOwnerSurface(app, next.unitId ?? approval.unitId);
    else if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function revokeSelectedGrant(app, unit, grant) {
  revokeGrant(app.api, unit, grant.id).then((result) => {
    app.revocationRequestId = result.data.requestId ?? null;
    app.revocationUnitId = result.data.unitId ?? unit.id;
    if (result.data.state === "revoked") {
      showOutcome(app, text(app.language, "grantRevoked"), "revoked");
      refreshOwnerSurface(app, app.revocationUnitId);
      return;
    }
    showOutcome(app, text(app.language, "grantPending"), result.data.state ?? "pending");
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function setTaskStatus(app, task, status, note) {
  changeTaskStatus(app.api, task, status, note).then((result) => {
    if (status === "open") clearInputDraft(app, "note", task.id);
    showOutcome(app, taskText(app.language, result.data.task.status), result.data.task.status);
    app.inspectorData.tasks = app.inspectorData.tasks.map((item) => item.id === result.data.task.id ? result.data.task : item);
    refreshWaiting(app);
  }).catch((error) => noteAction(app, error));
}

function undoSelected(app, task) {
  undoTask(app.api, task).then((result) => {
    showOutcome(app, taskText(app.language, result.data.task.status), result.data.task.status);
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
  if (label) showOutcome(app, label, approval.state);
  if (finalApprovalState(approval.state)) await refreshOwnerSurface(app, approval.unitId);
}

async function noteGrant(app, data) {
  if (!data?.unitId || (data.operation !== "granted" && data.operation !== "revoked")) return;
  if (data.operation === "revoked") showOutcome(app, text(app.language, "grantRevoked"), "revoked");
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
      if (label) showOutcome(app, label, approval.data.state);
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
