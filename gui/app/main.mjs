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
  retryMessage,
  postVisibleReads,
  updateNearBottom,
} from "./chats.mjs";
import { addNode, boardCommentAnchor, editedBoard, hitBoardNode, patchNode, releaseAssets, removeNode, renderBoard, replaceBoard, uploadAsset } from "./blueprint.mjs";
import { ApiError, REQUEST_DEADLINE_MS, createApi, createOperation, dispose as disposeApi, fetchAsset, request } from "./api.mjs";
import { element, icon, labelDialog, labeledField, progressMark, runAction, showDialog, showError } from "./components.mjs";
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
import { cardinal, formatClock, formatNumber, formatWhen, text } from "./i18n.mjs";
import { collectPages, createPagedList, loadAll, reloadList, renderWindow, setQuery, windowRange } from "./lists.mjs";
import { adoptInitialLayout, applyRemoteLayout, centerUnit, createMap, keepLocalPosition, renderMap, retrySavedLayout, useIncomingPosition } from "./map.mjs";
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
  const revealFocusTools = () => {
    if (app.mode !== "focus" || !app.voidState || app.voidState.tools) return;
    showTools(app.voidState);
    renderShell(app);
  };
  root.addEventListener?.("pointermove", revealFocusTools);
  root.addEventListener?.("pointerup", revealFocusTools);
  root.addEventListener?.("focusin", revealFocusTools);
  renderStatus(app, "loading");
  if (!api.token && api.homeKey) {
    try {
      const credential = await exchangeHomeFragment(api);
      return bootSession(app, credential, env);
    } catch (error) {
      renderPhoneError(app, error);
      return app;
    }
  }
  if (!api.token) {
    renderSignedOut(app);
    return app;
  }
  return bootSession(app, null, env);
}

async function bootSession(app, credential, env = {}) {
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
  if (Number.isFinite(env.readyBudgetMs)) app.readyBudgetMs = env.readyBudgetMs;
  return runBoot(app);
}

async function runBoot(app) {
  if (app.disposed || app.bootRetrying) return app;
  app.bootRetrying = true;
  app.bootFailed = false;
  app.bootSettled = false;
  synchronize(app.api, app.store, {
    cursor: () => app.store.cursor,
    onEvent: (event) => onStream(app, event),
    onState: () => {
      if (!app.disposed && !app.bootFailed && app.layout !== "unknown") renderShell(app);
    },
  });
  try {
    await loadSnapshot(app.store, app.api);
    if (!app.disposed && !app.store.capabilities?.length) armBootDeadline(app, app.readyBudgetMs);
    await loadPresentation(app);
    await loadLists(app);
    startOwnEmbed(app);
  } catch (error) {
    if (!app.disposed) {
      app.bootFailed = true;
      clearTimeout(app.readyTimer);
      renderFailure(app, error);
    }
  } finally {
    app.bootRetrying = false;
  }
  return app;
}

function resumeBoot(app) {
  if (app.disposed || app.bootRetrying || !app.api?.token || app.api.closed) return;
  renderStatus(app, "loading");
  return runBoot(app);
}

function armBootDeadline(app, budgetMs) {
  clearTimeout(app.readyTimer);
  const budget = Number.isFinite(budgetMs) ? budgetMs : REQUEST_DEADLINE_MS;
  const timer = setTimeout(() => {
    if (app.disposed || app.bootSettled || app.bootFailed || app.layout !== "unknown" || app.store.capabilities?.length) return;
    app.bootFailed = true;
    renderFailure(app, new ApiError(0, "timeout", "The event stream timed out."));
  }, budget);
  timer.unref?.();
  app.readyTimer = timer;
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
  if (mode === "focus" && app.voidState) enterFocus(app.voidState);
  renderShell(app);
}

export function renderShell(app) {
  app.rendering = true;
  try {
    paintShell(app);
  } finally {
    app.rendering = false;
  }
}

function paintShell(app) {
  captureInputs(app);
  const document = app.root.ownerDocument;
  document.documentElement.lang = app.language;
  document.documentElement.dataset.look = app.look;
  document.documentElement.dataset.mode = app.mode;
  const t = (key, variables) => text(app.language, key, variables);
  const view = app.store.view;
  const counts = view?.counts ?? {};
  const shell = element(document, "div", { class: "shell", "data-layout": app.layout === "phone" ? "phone" : "desktop", "data-mode": app.mode, "data-tab": app.tab });
  const heading = viewTitle(app, t);
  document.title = `${heading} · HIVEM1ND`;
  const workspace = renderWorkspace(app, t, view, counts);
  workspace.setAttribute("id", "workspace");
  shell.append(
    element(document, "a", { class: "skip", href: "#workspace", text: t("skipToContent") }),
    element(document, "h1", { class: "sr", text: heading }),
    renderBar(app, t, counts),
    workspace,
    renderFooter(app, t),
  );
  if (app.layout === "phone") shell.append(renderPhoneNav(app, t));
  app.root.replaceChildren(shell);
  syncLiveRegions(app);
  paintActivity(app, shell);
  restoreInputFocus(app);
  finishList(app);
  finishMap(app);
  syncChatReads(app);
  armHomeExpiry(app);
}

function inputDrafts(app) {
  if (!app.inputDrafts) {
    app.inputDrafts = { chats: new Map(), notes: new Map(), nodes: new Map(), resources: new Map(), mail: new Map(), fields: new Map(), focus: null };
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
  for (const name of ["chats", "notes", "nodes", "resources", "mail"]) {
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

function keepId(...parts) {
  return parts.map((part) => encodeURIComponent(String(part))).join("|");
}

function keepParts(key) {
  return String(key).split("|").map((part) => decodeURIComponent(part));
}

function captureInputs(app) {
  const drafts = inputDrafts(app);
  if (!drafts.fields) drafts.fields = new Map();
  const active = app.root.ownerDocument?.activeElement;
  let focused = null;
  for (const node of app.root.querySelectorAll?.("[data-keep]") ?? []) {
    const key = node.getAttribute?.("data-keep");
    if (!key) continue;
    const draft = fieldDraft(node);
    if (keepParts(key)[0] === "home") drafts.fields.set(key, draft);
    if (node === active) focused = { kind: "field", id: key, start: draft.start, end: draft.end };
  }
  if (!focused) {
    const action = active?.getAttribute?.("data-action");
    if (action && /^[a-z0-9-]+$/.test(action)) focused = { kind: "action", id: action };
  }
  drafts.focus = focused;
}

function clearInputDraft(app, kind, id) {
  const drafts = inputDrafts(app);
  const key = keepId(kind, id);
  const bucket = kind === "chat" ? drafts.chats : kind === "note" ? drafts.notes : draftMap(app, kind);
  bucket.delete(id);
  drafts.fields?.delete(key);
  if (drafts.focus?.id === key) drafts.focus = null;
  syncViewerDirty(app);
}

function restoreInputFocus(app) {
  const drafts = inputDrafts(app);
  for (const [key, draft] of drafts.fields ?? []) {
    const node = app.root.querySelector?.(`[data-keep="${key}"]`);
    if (!node || !("value" in node)) continue;
    if (node.value !== draft.value) node.value = draft.value;
  }
  const focus = drafts.focus;
  if (!focus?.id) return;
  if (focus.kind === "action") {
    app.root.querySelector?.(`[data-action="${focus.id}"]`)?.focus?.();
    return;
  }
  const node = app.root.querySelector?.(`[data-keep="${focus.id}"]`);
  if (!node) return;
  node.focus?.();
  if (typeof node.setSelectionRange === "function") node.setSelectionRange(focus.start, focus.end);
}

export function dispose(app) {
  if (!app || app.disposed) return;
  app.disposed = true;
  clearTimeout(app.readyTimer);
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
  app.liveStatus?.remove?.();
  app.liveError?.remove?.();
  app.liveStatus = null;
  app.liveError = null;
  disposeApi(app.api);
}

async function onStream(app, event) {
  if (app.disposed || app.bootFailed) return;
  const result = await acceptStreamEvent(app.store, app.api, event);
  if (app.disposed || result?.dropped) return;
  if (event?.name === "home.changed") noteHome(app, dataOf(event));
  if (event?.name === "sync.changed") noteSync(app, dataOf(event));
  if (event?.name === "service.changed") noteService(app, dataOf(event));
  if (event?.name === "issue.changed") noteIssue(app, dataOf(event));
  if (event?.name === "viewer.changed") {
    await loadPresentation(app, { keepShell: true });
    result?.consume?.();
    return;
  }
  if (event?.name === "stream.ready" || event?.name === "settings.changed") {
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
  if (editors && event?.name === "editor.attachments.changed") noteAttachmentEvent(editors, data);
  if (editors && event?.name === "editor.asset.created") await noteAssetEvent(app, data);
  if (editors && event?.name === "notification.changed") noteDelivery(app, editors, data);
  if (event?.name === "sync.conflict") noteSyncConflict(app, data);
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

function sameIds(choice, ids) {
  if (!(choice instanceof Set) || choice.size !== ids.length) return false;
  return ids.every((id) => choice.has(id));
}

function noteAttachmentEvent(editors, data) {
  const current = editors.current;
  if (!current || data?.resourceId !== current.resourceId || !Array.isArray(data.attached)) return;
  const previous = current.attached ?? [];
  const dirty = current.attachmentChoice instanceof Set && !sameIds(current.attachmentChoice, previous);
  current.attached = data.attached;
  if (data.revision) current.attachmentRevision = data.revision;
  if (!dirty) {
    current.attachmentChoice = new Set(data.attached);
    current.attachmentConflict = null;
  } else {
    current.attachmentConflict = { revision: data.revision ?? null, attached: data.attached };
  }
}

async function noteAssetEvent(app, data) {
  const editors = app.editors;
  const current = editors?.current;
  if (!current || data?.resourceId !== current.resourceId || !data.asset?.id) return;
  const selected = editors.selectedNodeId ?? null;
  const records = current.assetRecords ?? [];
  const index = records.findIndex((item) => item.id === data.asset.id);
  current.assetRecords = index >= 0 ? records.map((item) => item.id === data.asset.id ? data.asset : item) : [...records, data.asset];
  if (data.asset.src && current.assets instanceof Map) {
    try {
      const image = await fetchAsset(app.api, {
        url: data.asset.url || `/api/v1/editors/${encodeURIComponent(current.resourceId)}/assets/${encodeURIComponent(data.asset.id)}`,
      });
      const previous = current.assets.get(data.asset.src);
      if (previous && previous !== image) previous.revoke?.();
      current.assets.set(data.asset.src, image);
    } catch (error) {
      current.assetIssues = [...(current.assetIssues ?? []).filter((item) => item.src !== data.asset.src), { src: data.asset.src, code: error.code || "invalid_asset" }];
    }
  }
  editors.selectedNodeId = selected;
}

function noteDelivery(app, editors, data) {
  const current = editors.current;
  if (!current || data?.resourceId !== current.resourceId || !data.state) return;
  const notices = [...(current.notices ?? [])];
  const index = notices.findIndex((item) => item.noticeKey === data.noticeKey && item.unitId === data.unitId);
  const next = { noticeKey: data.noticeKey ?? null, unitId: data.unitId ?? null, state: data.state, error: data.error ?? null };
  if (index >= 0) notices[index] = { ...notices[index], ...next };
  else notices.push(next);
  current.notices = notices;
  const copy = { pending: "queued", queued: "queued", submitted: "submitted", ambiguous: "ambiguous", failed: "failed" };
  const key = copy[data.state];
  if (!key) return;
  const failed = data.state === "failed" || data.state === "ambiguous";
  showOutcome(app, text(app.language, key), data.state, failed ? "error" : "status");
}

function noteSyncConflict(app, data) {
  app.syncConflict = {
    copyPath: String(data?.copyPath ?? ""),
    winnerMachine: String(data?.winnerMachine ?? ""),
  };
  showOutcome(app, text(app.language, "syncConflict", { path: app.syncConflict.copyPath || text(app.language, "unknown") }), "sync_conflict", "error");
}

async function loadPresentation(app, options = {}) {
  const ticket = (app.presentationTicket ?? 0) + 1;
  app.presentationTicket = ticket;
  const previousLook = app.look;
  const previousLanguage = app.language;
  const previousLayout = app.layout;
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
  if (app.layout !== "unknown") {
    app.bootSettled = true;
    clearTimeout(app.readyTimer);
    app.readyTimer = null;
  }
  if (app.disposed || app.bootFailed) return;
  startOwnEmbed(app);
  const samePresentation = app.look === previousLook && app.language === previousLanguage && app.layout === previousLayout;
  if (options.keepShell && samePresentation && app.layout !== "unknown") return;
  publish(app);
}

function publish(app) {
  if (app.disposed || app.bootFailed) return;
  if (app.layout === "unknown") {
    renderStatus(app, "loadingView");
    return;
  }
  const document = app.root.ownerDocument;
  document.documentElement.lang = app.language;
  document.documentElement.dataset.look = app.look;
  document.documentElement.dataset.mode = app.mode;
  renderShell(app);
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
  }, icon(document, "waiting"), cardinal(app.language, "waitingCount", counts.waiting ?? 0));
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
  const catalogToggle = element(document, "button", {
    type: "button",
    class: "btn panel-toggle",
    "data-action": "toggle-catalog",
    "aria-pressed": String(app.catalogOpen === true),
    text: t(app.catalogOpen ? "hideCatalog" : "showCatalog"),
    onclick: () => {
      app.catalogOpen = app.catalogOpen !== true;
      renderShell(app);
    },
  });
  const commentsToggle = element(document, "button", {
    type: "button",
    class: "btn panel-toggle",
    "data-action": "toggle-comments",
    "aria-pressed": String(app.commentsOpen === true),
    text: t(app.commentsOpen ? "hideComments" : "showComments"),
    onclick: () => {
      app.commentsOpen = app.commentsOpen !== true;
      renderShell(app);
    },
  });
  const bar = element(document, "header", { class: "bar" }, brand(document), modes, waiting);
  if (app.layout !== "phone") {
    bar.append(catalogToggle);
    if (app.mode === "blueprint" || app.mode === "document") bar.append(commentsToggle);
    bar.append(inspector, settings);
  }
  return bar;
}

function renderWorkspace(app, t, view, counts) {
  if (app.mode === "focus") return renderFocusWorkspace(app, t);
  if (app.layout !== "phone" && (app.mode === "blueprint" || app.mode === "document")) return renderEditorWorkspace(app, t);
  const document = app.root.ownerDocument;
  const tabs = element(document, "div", { class: "tabs" });
  for (const tab of ["hierarchy", "chats"]) {
    tabs.append(element(document, "button", {
      type: "button",
      class: "tab",
      "aria-pressed": String(app.tab === tab),
      onclick: () => navigate(app, tab),
    }, icon(document, tab), t(tab)));
  }
  const summary = element(document, "section", { class: "summary" },
    element(document, "h2", { text: t("summaryTitle") }),
    element(document, "div", { class: "counts" },
      element(document, "span", { text: cardinal(app.language, "unitCount", counts.units ?? app.unitList?.catalog?.length ?? 0) }),
      element(document, "span", { text: t("unreadCount", { count: formatNumber(app.language, counts.unread ?? 0) }) }),
      element(document, "span", { text: cardinal(app.language, "issueCount", counts.issues ?? 0) }),
    ),
  );
  const issueItems = view?.issues ?? app.unitList?.issues ?? [];
  const collection = renderCollection(app, t);
  const phoneTitle = app.tab === "chats"
    ? (app.thread?.chat?.title || t("chats"))
    : app.mode === "waiting" ? t("waiting") : t("hierarchy");
  let side;
  if (app.layout === "phone") {
    const issues = element(document, "details", { class: "phone-issues", "data-phone-issues": "true" });
    issues.append(element(document, "summary", { text: cardinal(app.language, "issueCount", issueItems.length) }));
    for (const issue of issueItems) issues.append(element(document, "p", { class: "issue", text: issue.message }));
    if (!issueItems.length) issues.append(element(document, "p", { text: t("emptyList") }));
    side = element(document, "aside", { class: "panel side" },
      element(document, "h2", { "data-phone-title": "true", text: phoneTitle }),
      issues,
      collection,
    );
  } else {
    const issues = element(document, "section", { class: "summary" }, element(document, "h2", { text: t("issuesTitle") }));
    for (const issue of issueItems) issues.append(element(document, "p", { class: "issue", text: issue.message }));
    if (!issueItems.length) issues.append(element(document, "p", { text: t("emptyList") }));
    side = element(document, "aside", { class: `panel side${app.catalogOpen ? " is-open" : ""}` }, tabs, summary, issues, collection);
  }
  const selected = app.store.indexes.units.get(app.store.selected.unitId)
    ?? app.unitList?.catalog?.find((unit) => unit.id === app.store.selected.unitId)
    ?? null;
  const stageTitle = app.layout === "phone" && app.tab === "chats" ? phoneTitle : t(app.mode);
  const stage = element(document, "section", { class: "panel stage" },
    element(document, "h2", { "data-stage-title": "true", text: stageTitle }),
  );
  if (app.mode === "settings") {
    stage.append(settingsSurface(app, document, t));
  } else if (app.layout !== "phone" && app.waitingOpen) {
    stage.append(renderWaitingSurface(app, t));
  } else if (app.mode === "map") {
    ensureMap(app);
    stage.append(element(document, "div", { class: "map" }));
  } else if (app.mode === "blueprint" || app.mode === "document" || app.mode === "focus") {
    stage.append(renderEditor(app, t));
  } else if (app.layout === "phone" && app.mode === "waiting") {
    stage.append(renderWaitingSurface(app, t));
  } else if (app.layout === "phone" && app.tab === "chats") {
    stage.append(chatPanel(app, t));
    if (app.phoneChatNote) stage.append(element(document, "p", { "data-phone-chat": "required", text: t("desktopChatRequired") }));
    const cards = (app.waitingList?.items ?? []).filter((item) => item.kind === "approval" || item.kind === "review");
    if (cards.length) {
      const host = element(document, "div", { class: "phone-cards", "data-phone-cards": "true" });
      for (const item of cards.slice(0, 3)) {
        host.append(element(document, "button", {
          type: "button",
          class: "btn",
          "data-phone-card": item.kind,
          text: item.title || item.kind,
          onclick: () => openWaitingItem(app, item),
        }));
      }
      stage.append(host);
    }
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
  if (app.syncConflict) {
    inspectorBody.append(element(document, "p", {
      class: "action-note",
      "data-sync-conflict": "true",
      text: t("syncConflict", { path: app.syncConflict.copyPath || t("unknown") }),
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
  const phoneHierarchy = app.layout === "phone" && app.mode !== "waiting" && app.tab !== "chats";
  return element(document, "div", { class: "workspace" }, side, phoneHierarchy ? null : stage, inspector);
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
    text: cardinal(app.language, "waitingCount", total),
  }));
  if (!list) {
    surface.append(progressMark(document, t("loadingList")));
    return surface;
  }
  if (list.status === "loading") surface.append(progressMark(document, t("loadingList"), { "data-list-progress": "true" }));
  if (list.status === "error") {
    surface.append(element(document, "p", { text: t("listError") }));
    surface.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "retry-list",
      text: t("retry"),
      onclick: () => reloadList(list),
    }));
  }
  const items = list.items ?? [];
  const range = windowRange(list.scrollTop, list.height || 640, list.rowHeight || 36, items.length);
  if (list.status !== "loading" || items.length) {
    surface.append(renderWaiting(document, items.slice(range.start, range.end), t, (item) => openWaitingItem(app, item)));
  }
  surface.append(renderWaitingRecord(app, t));
  return surface;
}

function openWaitingItem(app, item) {
  if (!item) return;
  app.waitingItemId = item.id;
  if (item.unitId) app.store.selected.unitId = item.unitId;
  const label = text(app.language, "loadingDetails", { name: item.title || item.id });
  if (item.approvalId) {
    settle(app, `waiting:${item.id}`, label, async () => {
      const result = await request(app.api, "GET", "/approvals/:approvalId", { params: { approvalId: item.approvalId } });
      app.waitingRecord = { kind: "approval", approval: result.data, item };
    });
    return;
  }
  if (item.taskId) {
    settle(app, `waiting:${item.id}`, label, async () => {
      const result = await request(app.api, "GET", "/tasks/:taskId", { params: { taskId: item.taskId } });
      app.waitingRecord = { kind: "review", task: result.data, item };
    });
    return;
  }
  if (item.chatId) {
    settle(app, `waiting:${item.id}`, label, async () => {
      const result = await request(app.api, "GET", "/chats/:chatId", { params: { chatId: item.chatId } });
      app.waitingRecord = { kind: "chat", chat: result.data, item };
      if (app.layout === "phone") app.mode = "hierarchy";
      app.tab = "chats";
      await showChat(app, result.data);
    });
    return;
  }
  if (item.messageId) {
    settle(app, `waiting:${item.id}`, label, async () => {
      const result = await loadMailboxMessage(app.api, "root:master", item.messageId);
      app.waitingRecord = { kind: "message", message: result.data, item };
    });
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
    block.append(renderApproval(document, record.approval, t, (item, decision) => answerSelected(app, item, decision), activityPending(app, `approval:${record.approval.id}`)));
    return block;
  }
  if (record.kind === "review" && record.task && (caps.includes("task.status") || caps.includes("task.accept") || caps.includes("task.send-back"))) {
    const phone = app.layout === "phone" || app.store.audience === "phone";
    const noteDraft = inputDrafts(app).notes.get(record.task.id);
    const taskBusy = activityPending(app, `task:${record.task.id}`) || activityPending(app, `undo:${record.task.id}`);
    block.append(renderTask(document, record.task, t, (item, status, note) => setTaskStatus(app, item, status, note), caps.includes("task.undo") ? (item) => undoSelected(app, item) : null, noteDraft?.value ?? "", (value, start, end) => {
      inputDrafts(app).notes.set(record.task.id, { value, start: Number.isInteger(start) ? start : value.length, end: Number.isInteger(end) ? end : value.length });
      syncViewerDirty(app);
    }, phone ? canAccept(record.task) : canSendBack(record.task), taskBusy));
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
        onclick: () => settle(app, `read:${record.message.id}`, text(app.language, "working"), async (action) => {
          await markMailboxRead(app.api, "root:master", [record.message.id], action.operation);
          await refreshWaiting(app);
        }),
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
  const status = list.status === "error" ? t("listError") : list.status === "loading" ? t("loadingList") : list.status === "empty" ? (list.query ? t("emptySearch") : t("emptyList")) : t("listTotal", { count: formatNumber(app.language, list.total ?? 0) });
  const total = element(document, "p", { class: "list-total", "data-total": String(list.total ?? ""), "data-list-status": list.status, text: status });
  if (list.status === "loading") total.append(progressMark(document, t("loadingList"), { "data-list-progress": "true" }));
  if (list.status === "error") {
    total.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "retry-list",
      text: t("retry"),
      onclick: () => reloadList(list),
    }));
  }
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
  settle(app, `catalog:${kind}`, text(app.language, "loadingList"), async () => {
    try {
      await loadCatalog(app.api, editors, kind, editors.query ?? "");
    } catch (error) {
      editors.loadedKind = kind;
      throw error;
    } finally {
      editors.catalogLoading = false;
    }
  }, (error) => noteEditor(app, error));
}

function boardSurface(app, document, editor, t) {
  const host = element(document, "div", { class: "board-host" });
  editor.focus = app.editors.focus;
  editor.viewport = app.editors.viewport;
  editor.panned = app.editors.panned === true;
  renderBoard(document, host, editor);
  const choose = (target) => chooseBoardTarget(app, editor, target);
  host.addEventListener("click", (event) => {
    const marked = event.target?.closest?.("[data-node]");
    const screenMarked = event.target?.closest?.("[data-screen]");
    const svg = host.querySelector("svg");
    const point = boardPoint(svg, event);
    if (marked?.getAttribute?.("data-node")) {
      choose({
        kind: "node",
        nodeId: marked.getAttribute("data-node"),
        screenId: marked.closest?.("[data-screen]")?.getAttribute("data-screen") ?? null,
        x: point.x,
        y: point.y,
      });
    } else if (screenMarked?.getAttribute?.("data-screen")) {
      choose({ kind: "screen", screenId: screenMarked.getAttribute("data-screen"), x: point.x, y: point.y });
    } else {
      const hit = hitBoardNode(editor.authoritative.document, point);
      if (hit?.nodeId) choose({ kind: "node", nodeId: hit.nodeId, screenId: hit.screenId, x: point.x, y: point.y });
      else choose({ kind: "canvas", x: point.x, y: point.y });
    }
  });
  host.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const marked = event.target?.closest?.("[data-node]");
    const nodeId = marked?.getAttribute?.("data-node");
    if (!nodeId) return;
    event.preventDefault?.();
    choose({
      kind: "node",
      nodeId,
      screenId: marked.closest?.("[data-screen]")?.getAttribute("data-screen") ?? null,
      x: 0,
      y: 0,
    });
  });
  const nodes = editor.authoritative.document.screens?.[0];
  const tools = element(document, "div", { class: "editor-actions" });
  const name = element(document, "input", { "data-node-name": "true", "data-keep": keepId("node", editor.resourceId) });
  name.value = draftMap(app, "nodes").get(editor.resourceId) ?? "";
  name.addEventListener("input", () => {
    editor.nodeDraft = name.value;
    rememberFormDraft(app, "nodes", editor.resourceId, name.value);
  });
  tools.append(labeledField(document, t("nodeName"), t("nodeNameHint"), name));
  tools.append(boardOutline(app, document, editor, t));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "patch-node",
    onclick: () => {
      const saved = name.value;
      const nodeId = app.editors.selectedNodeId;
      if (!nodeId) return;
      editorAct(app, `node:${editor.resourceId}:${nodeId}`, text(app.language, "working"), async (record) => {
        await patchNode(app.api, editor, nodeId, { name: saved, value: saved }, record.operation);
        if (draftMap(app, "nodes").get(editor.resourceId) === saved) editor.nodeDraft = "";
        releaseFormDraft(app, "nodes", editor.resourceId, saved);
      });
    },
  }, t("nodeName")));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "add-node",
    onclick: () => addBoardShape(app, editor, nodes),
  }, t("addShape")));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "remove-node",
    onclick: () => {
      const nodeId = app.editors.selectedNodeId;
      if (!nodeId) return;
      editorAct(app, `node-remove:${editor.resourceId}:${nodeId}`, text(app.language, "working"), async (record) => {
        await removeNode(app.api, editor, nodeId, record.operation);
      });
    },
  }, t("removeShape")));
  const file = element(document, "input", { type: "file", accept: "image/png,image/jpeg,image/webp", "data-asset": "true" });
  file.addEventListener("change", () => {
    const selected = file.files?.[0];
    if (!selected) return;
    editorAct(app, `upload:${editor.resourceId}`, text(app.language, "uploading"), async (record) => {
      const asset = await uploadAsset(app.api, editor, selected, record.operation);
      await addImageNode(app, editor, nodes, asset);
    });
  });
  tools.append(labeledField(document, t("upload"), t("assetHint"), file));
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
  editorAct(app, `shape:${editor.resourceId}:${count}`, text(app.language, "working"), async (record) => {
    await addNode(app.api, editor, {
      screenId: screen.id,
      parentId: screen.root.id,
      node: { id: `added-${count}`, name: "Added", t: "box", place: { x: 16, y: 16 }, w: 40, h: 40, dir: "stack", kids: [] },
    }, record.operation);
  });
}

function addImageNode(app, editor, screen, asset) {
  const count = (app.editors.shapeCount ?? 0) + 1;
  app.editors.shapeCount = count;
  return editorAct(app, `image:${editor.resourceId}:${asset.src}`, text(app.language, "working"), async (record) => {
    await addNode(app.api, editor, {
      screenId: screen.id,
      parentId: screen.root.id,
      node: { id: `image-${count}`, name: "Image", t: "image", place: { x: 20, y: 48 }, w: 32, h: 32, src: asset.src },
    }, record.operation);
  });
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
  const supplied = typeof editor.commentText === "string" ? editor.commentText : "";
  if (!supplied.trim()) {
    explain(app, "commentNeedsText");
    return;
  }
  const anchor = {
    screen: screen.id,
    screenTitle: screen.title,
    element: node.id,
    label: node.name ?? node.id,
    path: [node.name ?? node.id],
    point: { x: Math.round(node.place?.x ?? 0), y: Math.round(node.place?.y ?? 0) },
  };
  sendEditorComment(app, editor, anchor, supplied);
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

function chooseBoardTarget(app, editor, target) {
  const located = { resourceId: editor.resourceId, x: target.x ?? 0, y: target.y ?? 0 };
  if (target.kind === "node") {
    app.editors.selectedNodeId = target.nodeId;
    app.editors.focus = { ...(app.editors.focus ?? {}), screenId: target.screenId, resourceId: editor.resourceId };
    app.editors.commentTarget = { ...located, kind: "node", nodeId: target.nodeId, screenId: target.screenId };
  } else if (target.kind === "screen") {
    app.editors.selectedNodeId = null;
    app.editors.focus = { ...(app.editors.focus ?? {}), screenId: target.screenId, resourceId: editor.resourceId };
    app.editors.commentTarget = { ...located, kind: "screen", screenId: target.screenId };
  } else {
    app.editors.commentTarget = { ...located, kind: "canvas" };
  }
  renderShell(app);
}

function boardOutline(app, document, editor, t) {
  const board = editor.authoritative?.document;
  const tree = element(document, "div", { class: "board-outline", role: "tree", "aria-label": t("boardOutline") });
  for (const screen of board?.screens ?? []) {
    const title = typeof screen.title === "string" && screen.title ? screen.title : screen.id;
    tree.append(outlineButton(app, document, editor, { kind: "screen", screenId: screen.id, x: Number(screen.x) || 0, y: Number(screen.y) || 0, label: title }));
    appendOutlineNodes(app, document, editor, tree, screen.root, screen);
  }
  return tree;
}

function appendOutlineNodes(app, document, editor, tree, node, screen) {
  if (!node?.id) return;
  tree.append(outlineButton(app, document, editor, {
    kind: "node",
    nodeId: node.id,
    screenId: screen.id,
    x: Number(node.place?.x) || 0,
    y: Number(node.place?.y) || 0,
    label: node.name || node.id,
  }));
  for (const child of node.kids ?? []) appendOutlineNodes(app, document, editor, tree, child, screen);
}

function outlineButton(app, document, editor, target) {
  return element(document, "button", {
    type: "button",
    class: "btn",
    role: "treeitem",
    "data-outline": target.kind === "node" ? target.nodeId : target.screenId,
    text: target.label,
    onclick: () => chooseBoardTarget(app, editor, target),
  });
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
  const host = element(document, "div", { class: "void-page reading-card", "data-void": "true" });
  renderDocument(document, host, editor);
  const tools = element(document, "div", { class: `void-tools${app.voidState.tools ? " is-visible" : ""}`, "data-tools": app.voidState.tools ? "visible" : "hidden" });
  const page = pages.find((item) => item.k === editor.page);
  const stored = textDraft(editor, editor.resourceId, editor.page, lang);
  const source = element(document, "textarea", { "data-source": "true", "data-draft-key": `${editor.resourceId}:${editor.page}:${lang}`, "data-keep": keepId("source", editor.resourceId, editor.page, lang) });
  source.value = stored === undefined ? (page?.[lang] ?? "") : stored;
  source.addEventListener("input", () => {
    rememberTextDraft(editor, editor.resourceId, editor.page, lang, source.value);
    syncViewerDirty(app);
  });
  const sourceEdit = element(document, "details", { class: "source-edit", "data-source-edit": "true" });
  sourceEdit.append(element(document, "summary", { text: t("editSource") }));
  sourceEdit.append(labeledField(document, t("sourceLabel"), t("sourceHint"), source));
  sourceEdit.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "save-range",
    text: t("send"),
    onclick: () => saveVoid(app, editor, source.value),
  }));
  tools.append(sourceEdit);
  if (app.mode === "focus") {
    tools.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "leave-focus",
      text: t("returnToDocument"),
      onclick: () => {
        leaveFocus(app.voidState);
        app.mode = "document";
        renderShell(app);
      },
    }));
    tools.append(element(document, "p", { class: "field-hint", "data-focus-hint": "true", text: t("focusHint") }));
  } else {
    tools.append(element(document, "button", {
      type: "button", class: "btn", "data-action": "enter-focus",
      text: t("focus"),
      onclick: () => {
        enterFocus(app.voidState);
        app.mode = "focus";
        renderShell(app);
      },
    }));
  }
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
  if (app.mode === "focus") return element(document, "div", { class: "focus-document" }, host, tools);
  return element(document, "div", {}, host, tools);
}

function appendProposals(app, document, host, editor, t) {
  for (const proposal of editor.proposals ?? []) {
    const block = renderProposal(document, proposal);
    if (proposal.state === "pending" && app.store.capabilities.includes("proposal.answer")) {
      block.append(element(document, "button", { type: "button", class: "btn", "data-action": "accept-change", "data-proposal-id": proposal.id, onclick: () => answerVoid(app, editor, proposal, "accept") }, t("acceptChange")));
      block.append(element(document, "button", { type: "button", class: "btn", "data-action": "discard", "data-proposal-id": proposal.id, onclick: () => answerVoid(app, editor, proposal, "discard") }, t("discard")));
    }
    host.append(block);
  }
}

function saveVoid(app, editor, value) {
  const page = editor.authoritative.document.pages.find((item) => item.k === (editor.page ?? app.voidState.page));
  const lang = app.language === "es" ? "es" : "en";
  const current = page?.[lang] ?? "";
  rememberTextDraft(editor, editor.resourceId, page.k, lang, value);
  const bounds = sourceReplacement(current, value);
  editorAct(app, `void-range:${editor.resourceId}:${page.k}:${lang}`, text(app.language, "savingDocument"), async (record) => {
    try {
      await saveRange(app.api, editor, page.k, lang, bounds.start, bounds.end, bounds.replacement, record.operation);
      editor.textDrafts?.delete(textDraftKey(editor.resourceId, page.k, lang));
      if (editor.draftKey?.k === page.k && editor.draftKey?.lang === lang) editor.draftText = "";
      syncViewerDirty(app);
    } catch (error) {
      editor.conflict = { ...(editor.conflict ?? {}), code: error.code, draftKey: { k: page.k, lang } };
      throw error;
    }
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
  if (!page || !range) {
    explain(app, "quoteNeedsSelection");
    return;
  }
  const anchor = textAnchor(editor, page.k, lang, range.start, range.end);
  sendEditorComment(app, editor, anchor, editor.commentText || anchor.quote);
}

function answerVoid(app, editor, proposal, decision) {
  editorAct(app, `proposal:${proposal.id}`, text(app.language, "answering"), async (record) => {
    try {
      await answerProposal(app.api, editor, proposal, decision, record.operation);
    } catch (error) {
      if (error.code === "proposal_stale") editor.conflict = { code: error.code };
      throw error;
    }
  });
}

function onFocusKey(app, event) {
  if (app.mode !== "focus" || !app.voidState) return;
  if (event.key === "Escape" && !app.root.ownerDocument.querySelector?.("dialog[open]")) {
    leaveFocus(app.voidState);
    app.mode = "document";
    renderShell(app);
    app.root.querySelector?.("[data-action='enter-focus']")?.focus?.();
    return;
  }
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
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
  const watchStatus = watch?.state === "waiting"
    ? progressMark(document, watchText, { "data-watch": "waiting" })
    : element(document, "p", { "data-watch": watch?.state ?? "off", text: watchText });
  const catalog = element(document, "aside", { class: `panel editor-catalog${app.catalogOpen ? " is-open" : ""}`, "data-editor-column": "catalog" },
    element(document, "h2", { text: t(kind === "blueprint" ? "boards" : "texts") }),
  );
  const resource = element(document, "section", { class: "panel editor-resource", "data-editor-column": "resource" },
    element(document, "h2", { "data-editor-title": title, "data-editor-kind": kind, text: `${t(app.mode)} ${title}` }),
  );
  if (app.syncConflict) {
    resource.append(element(document, "p", {
      class: "action-note",
      "data-sync-conflict": "true",
      text: t("syncConflict", { path: app.syncConflict.copyPath || t("unknown") }),
    }));
  }
  if (app.actionNote) {
    resource.append(element(document, "p", {
      class: "action-note",
      "data-action-note": "true",
      "data-code": app.actionCode ?? "",
      text: app.actionNote,
    }));
  }
  const commentsColumn = element(document, "aside", { class: `panel editor-comments-column${app.commentsOpen ? " is-open" : ""}`, "data-editor-column": "comments" },
    element(document, "h2", { text: t("comments") }),
  );
  const tools = element(document, "div", { class: "editor-tools", "data-editor-tools": "true" },
    watchStatus,
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
  if (editors.catalogLoading) catalog.append(progressMark(document, t("loadingList"), { "data-catalog-progress": "true" }));
  catalog.append(list);
  const forms = resourceForms(app, document, t);
  if (forms) catalog.append(forms);
  const surfaces = { catalog, resource, comments: commentsColumn };
  if (!current) return surfaces;
  if (current.attachmentResource !== current.resourceId) {
    current.attachmentChoice = new Set(current.attached ?? []);
    current.attachmentResource = current.resourceId;
  }
  const choice = current.attachmentChoice;
  const units = app.unitList?.catalog ?? [];
  const chips = element(document, "div", { class: "attach-chips", "data-attached": [...choice].join(" ") });
  for (const id of choice) {
    const unit = units.find((item) => item.id === id);
    chips.append(element(document, "span", { class: "chip", "data-chip": id, text: unit?.unit || id }));
  }
  const actions = element(document, "div", { class: "editor-actions" });
  actions.append(element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "attach",
    text: t("attach"),
    onclick: () => openAttachChooser(app),
  }));
  actions.append(element(document, "button", { type: "button", class: "btn", "data-action": "watch", onclick: () => followEditor(app) }, t("watch")));
  actions.append(element(document, "button", { type: "button", class: "btn", "data-action": "stop-watch", onclick: () => editorAct(app, `watch-stop:${editors.current?.resourceId ?? "none"}`, text(app.language, "working"), async (record) => {
    await stopWatch(app.api, editors, record.operation);
  }) }, t("stopWatch")));
  if (current.attachmentConflict) {
    actions.append(element(document, "p", { "data-attachment-conflict": "true", text: t("attachmentChanged") }));
    actions.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "use-attachments",
      text: t("useSavedAttachments"),
      onclick: () => {
        current.attachmentChoice = new Set(current.attached ?? []);
        current.attachmentConflict = null;
        renderShell(app);
      },
    }));
  }
  tools.append(chips, actions);
  const comments = element(document, "div", { class: "editor-comments", "data-comment-total": String(current.commentsTotal ?? current.threads?.length ?? 0) });
  const commentBound = Math.min(current.threads?.length ?? 0, current.commentWindow ?? 40);
  for (const thread of (current.threads ?? []).slice(0, commentBound)) {
    const box = element(document, "article", { class: "comment-box", "data-thread": thread.id, "data-status": thread.status ?? "open" });
    for (const message of thread.messages ?? []) {
      const line = element(document, "p", { class: "comment-line", "data-comment-message": message.id ?? "" });
      line.append(element(document, "span", { class: "comment-author", text: message.author || t("unknown") }));
      if (message.at) line.append(element(document, "time", { datetime: message.at, text: formatWhen(app.language, message.at) }));
      line.append(element(document, "span", { class: "comment-text", text: message.text ?? "" }));
      box.append(line);
    }
    box.append(element(document, "button", { type: "button", class: "btn", "data-action": "reply", onclick: () => replyToThread(app, thread.id) }, t("reply")));
    box.append(element(document, "button", { type: "button", class: "btn", "data-action": "resolve", onclick: () => resolveThread(app, thread.id) }, t("resolve")));
    comments.append(box);
  }
  if (current.kind === "void") appendProposals(app, document, comments, current, t);
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
  const compose = element(document, "textarea", { "data-comment": "true", "data-keep": keepId("comment", current.resourceId) });
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
  const commentField = labeledField(document, t("comment"), t("commentHint"), compose);
  commentButton.setAttribute("aria-describedby", compose.getAttribute("aria-describedby"));
  if (!commentCanSubmit(app, compose.value)) {
    const reason = element(document, "p", {
      id: "reason-comment",
      class: "field-hint",
      "data-disabled-reason": "comment",
      text: currentCommentAnchor(app) ? t("commentNeedsText") : t("commentNeedsTarget"),
    });
    commentButton.setAttribute("aria-describedby", "reason-comment");
    commentsColumn.append(comments, commentField, commentButton, reason);
  } else commentsColumn.append(comments, commentField, commentButton);
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
  const name = summary.title || summary.id;
  editorAct(app, `editor:${summary.id}`, text(app.language, "loadingDetails", { name }), async () => {
    const before = editors.error;
    await openEditor(app.api, editors, summary);
    if (editors.error && editors.error !== before) throw editors.error;
  });
}

function saveAttachments(app) {
  const editors = editorsOf(app);
  const choice = editors.current?.attachmentChoice;
  editorAct(app, `attach:${editors.current?.resourceId ?? "none"}`, text(app.language, "attaching"), async (record) => {
    await setAttachments(app.api, editors, [...(choice ?? [])], record.operation);
  });
}

function followEditor(app) {
  const editors = editorsOf(app);
  const unitId = [...(editors.current?.attachmentChoice ?? [])][0] ?? editors.current?.attached?.[0];
  if (!unitId || !editors.current) {
    showOutcome(app, text(app.language, "attachFirst"), "attach_required");
    if (!app.disposed) renderShell(app);
    return;
  }
  editorAct(app, `watch:${editors.current.resourceId}`, text(app.language, "working"), async (record) => {
    await startWatch(app.api, editors, { unitId, resourceId: editors.current.resourceId }, record.operation);
  });
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
  if (!anchor || !value.trim()) {
    explain(app, anchor ? "commentNeedsText" : "commentNeedsTarget");
    return;
  }
  sendEditorComment(app, current, anchor, value);
}

function sendEditorComment(app, editor, anchor, value) {
  const editors = editorsOf(app);
  const current = editors.current;
  if (!current || !value.trim()) return;
  const key = `comment:${current.resourceId}`;
  if (activityPending(app, key)) return;
  let row = (current.threads ?? []).find((thread) => thread.pending);
  if (!row) {
    row = { id: "pending-comment", status: "open", pending: true, failed: false, messages: [{ text: value }] };
    current.threads = [...(current.threads ?? []), row];
  }
  row.failed = false;
  row.messages = [{ text: value }];
  editorAct(app, key, text(app.language, "sending"), async (record) => {
    try {
      await createComment(app.api, editors, anchor, value, record.operation);
      current.threads = (current.threads ?? []).filter((thread) => !thread.pending);
      syncViewerDirty(app);
    } catch (error) {
      const pending = (current.threads ?? []).find((thread) => thread.pending);
      if (pending) pending.failed = true;
      throw error;
    }
  });
}

function replyToThread(app, threadId) {
  const editors = editorsOf(app);
  const supplied = editors.current?.commentText;
  if (typeof supplied !== "string" || !supplied.trim()) {
    explain(app, "commentNeedsText");
    return;
  }
  editorAct(app, `reply:${threadId}`, text(app.language, "sending"), async (record) => {
    await replyComment(app.api, editors, threadId, supplied, record.operation);
  });
}

function resolveThread(app, threadId) {
  const editors = editorsOf(app);
  editorAct(app, `resolve:${threadId}`, text(app.language, "working"), async (record) => {
    await resolveComment(app.api, editors, threadId, record.operation);
  });
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

const FIELD_HINTS = {
  "register-project": "projectHint",
  "register-path": "pathHint",
  "create-id": "idHint",
  "create-title": "titleHint",
  "create-path": "pathHint",
  "screen-width": "sizeHint",
  "screen-height": "sizeHint",
  "document-title": "titleHint",
};

function editorField(document, app, t, key, labelKey, field) {
  const input = element(document, "input", { "data-field": field, "data-keep": keepId("resource", key) });
  input.value = editorDraft(app)[key] ?? "";
  input.addEventListener("input", () => {
    editorDraft(app)[key] = input.value;
    rememberFormDraft(app, "resources", key, input.value);
  });
  return labeledField(document, t(labelKey), t(FIELD_HINTS[field] ?? "fieldHint"), input);
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
    element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "open-register",
      "data-kind": kind,
      text: t("registerResource"),
      onclick: () => openResourceForm(app, kind, "register"),
    }),
    element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "open-create",
      "data-kind": kind,
      text: t("createResource"),
      onclick: () => openResourceForm(app, kind, "create"),
    }),
  );
  return box;
}

function openResourceForm(app, kind, mode) {
  const document = app.root.ownerDocument;
  if (document.querySelector?.(`[data-form="${mode}"]`)) return;
  const t = (key) => text(app.language, key);
  const dialog = element(document, "dialog", { class: "dialog", "data-form": mode });
  const form = element(document, "form", { method: "dialog" });
  const heading = element(document, "h2", { text: t(mode === "register" ? "registerForm" : "createForm") });
  labelDialog(dialog, heading);
  form.append(heading);
  if (mode === "register") {
    form.append(
      editorField(document, app, t, "project", "registerProject", "register-project"),
      editorField(document, app, t, "path", "registerPath", "register-path"),
    );
  } else {
    form.append(
      editorField(document, app, t, "id", "resourceId", "create-id"),
      editorField(document, app, t, "title", "resourceTitle", "create-title"),
      editorField(document, app, t, "createPath", "registerPath", "create-path"),
    );
  }
  form.append(element(document, "button", {
    type: "button",
    class: "btn primary",
    "data-action": mode === "register" ? "register-resource" : "create-resource",
    "data-kind": kind,
    text: t(mode === "register" ? "registerResource" : "createResource"),
    onclick: () => {
      dialog.close();
      if (mode === "register") submitRegister(app, kind);
      else submitCreate(app, kind);
    },
  }), element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "cancel-form",
    text: t("cancel"),
    onclick: () => dialog.close(),
  }));
  dialog.append(form);
  dialog.addEventListener("close", () => {
    dialog.remove();
    restoreInvoker(app, mode === "register" ? "open-register" : "open-create");
  });
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
}

function openAttachChooser(app) {
  const document = app.root.ownerDocument;
  const editors = editorsOf(app);
  const current = editors.current;
  if (!current || document.querySelector?.("[data-form='attach']")) return;
  const choice = current.attachmentChoice ?? new Set();
  current.attachmentChoice = choice;
  const dialog = element(document, "dialog", { class: "dialog", "data-form": "attach" });
  const form = element(document, "form", { method: "dialog" });
  const heading = element(document, "h2", { text: text(app.language, "chooseUnits") });
  labelDialog(dialog, heading);
  const search = element(document, "input", {
    type: "search",
    "data-attach-search": "true",
    "aria-label": text(app.language, "search"),
  });
  const list = element(document, "div", { class: "attach-choices", role: "listbox" });
  const paint = () => {
    const query = search.value.trim().toLowerCase();
    const units = (app.unitList?.catalog ?? [])
      .filter((unit) => !query || String(unit.unit ?? "").toLowerCase().includes(query))
      .slice(0, 40);
    list.replaceChildren(...units.map((unit) => element(document, "button", {
      type: "button",
      class: "btn",
      "data-attach-unit": unit.id,
      "aria-pressed": choice.has(unit.id) ? "true" : "false",
      text: `${choice.has(unit.id) ? "* " : ""}${unit.unit}`,
      onclick: () => {
        if (choice.has(unit.id)) choice.delete(unit.id);
        else if (choice.size >= 256) editors.error = { code: "invalid_body" };
        else choice.add(unit.id);
        paint();
      },
    })));
  };
  search.addEventListener("input", paint);
  form.append(heading, search, list, element(document, "button", {
    type: "button",
    class: "btn primary",
    "data-action": "save-attachments",
    text: text(app.language, "attach"),
    onclick: () => {
      dialog.close();
      saveAttachments(app);
    },
  }), element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "cancel-form",
    text: text(app.language, "cancel"),
    onclick: () => dialog.close(),
  }));
  dialog.append(form);
  dialog.addEventListener("close", () => {
    dialog.remove();
    restoreInvoker(app, "attach");
  });
  document.body.append(dialog);
  paint();
  if (typeof dialog.showModal === "function") dialog.showModal();
}

function submitRegister(app, kind) {
  const draft = editorDraft(app);
  const savedPath = draft.path;
  editorAct(app, `register:${kind}`, text(app.language, "working"), async (record) => {
    const result = await registerResource(app.api, { kind, project: draft.project.trim(), path: draft.path.trim() }, record.operation);
    releaseFormDraft(app, "resources", "path", savedPath);
    await openCreated(app, result.data, kind);
  });
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
  editorAct(app, `create:${kind}`, text(app.language, "working"), async (record) => {
    const result = await createResource(app.api, kind, { project: draft.project.trim(), path, document }, record.operation);
    releaseFormDraft(app, "resources", "id", savedId);
    releaseFormDraft(app, "resources", "title", savedTitle);
    releaseFormDraft(app, "resources", "createPath", savedCreatePath);
    await openCreated(app, result.data, kind);
  });
}

function submitJsonCopy(app, current) {
  const legacy = current?.authoritative?.legacy;
  const id = jsonCopyId(legacy?.path ?? "");
  if (!id || !canEditResources(app)) return;
  const project = current.authoritative.project || editorDraft(app).project;
  const path = `docs/flows/boards/${id}.json`;
  if (path === legacy.path) return;
  editorAct(app, `copy:${id}`, text(app.language, "working"), async (record) => {
    const result = await createResource(app.api, "blueprint", { project, path, document: starterBoard(id, legacy.id || id) }, record.operation);
    await openCreated(app, result.data, "blueprint");
  });
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
    element(document, "button", { type: "button", class: "btn", "data-action": "move-page", disabled: canMovePage ? null : "", "aria-describedby": canMovePage ? null : "reason-move-page", onclick: () => moveBoardPage(app, editor) }, t("movePage")),
    canMovePage ? null : element(document, "p", { id: "reason-move-page", class: "field-hint", "data-disabled-reason": "move-page", text: t("needTwoPages") }),
    element(document, "button", { type: "button", class: "btn", "data-action": "move-screen", disabled: canMoveScreen ? null : "", "aria-describedby": canMoveScreen ? null : "reason-move-screen", onclick: () => moveBoardScreen(app, editor) }, t("moveScreen")),
    canMoveScreen ? null : element(document, "p", { id: "reason-move-screen", class: "field-hint", "data-disabled-reason": "move-screen", text: t("needTwoScreens") }),
    element(document, "button", { type: "button", class: "btn", "data-action": "add-link", disabled: canLink ? null : "", onclick: () => addBoardLink(app, editor) }, t("addLink")),
  );
  return tools;
}

function resizeBoard(app, editor) {
  const draft = editorDraft(app);
  const width = Number(draft.width);
  const height = Number(draft.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16000 || height > 16000) {
    explain(app, "resizeNeedsSize");
    return;
  }
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
  if ((editor.authoritative.document.links ?? []).some((link) => link.id === id)) {
    explain(app, "linkExists");
    return;
  }
  saveBoardStructure(app, editor, (document) => {
    document.links = [...(document.links ?? []), { id, from, to, transition: "cut" }];
  });
}

function saveBoardStructure(app, editor, edit, onSaved) {
  if (!canEditResources(app) || !editor?.authoritative?.document || editor.authoritative.readOnly) return;
  const next = editedBoard(editor.authoritative, edit);
  editorAct(app, `structure:${editor.resourceId}`, text(app.language, "working"), async (record) => {
    await replaceBoard(app.api, editor, next.document, record.operation);
    onSaved?.();
  });
}

function replaceVoidDocument(app, editor) {
  if (!canEditResources(app) || !editor?.authoritative?.document || editor.authoritative.readOnly) return;
  const title = editorDraft(app).documentTitle.trim();
  if (!title) {
    explain(app, "titleRequired");
    return;
  }
  const savedTitle = editorDraft(app).documentTitle;
  const next = structuredClone(editor.authoritative.document);
  next.title = title;
  editorAct(app, `void-doc:${editor.resourceId}`, text(app.language, "savingDocument"), async (record) => {
    await replaceDocument(app.api, editor, next, record.operation);
    releaseFormDraft(app, "resources", "documentTitle", savedTitle);
  });
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
    settle(app, "group-chat", text(app.language, "loadingConversation"), async (record) => {
      const result = await openGroupChat(app.api, ids, undefined, record.operation);
      await showChat(app, result.data);
    });
  };
  return app.mapState;
}

function finishMap(app) {
  const host = app.root.querySelector?.(".map");
  if (!host || !app.mapState) return;
  const rect = host.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 760, height: 700 };
  app.mapState.onPersist = () => {
    if (!app.disposed) renderShell(app);
  };
  app.mapState.onRetryLayout = () => retrySavedLayout(app.mapState);
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
    savingLayout: text(app.language, "savingLayout"),
    layoutError: text(app.language, "layoutError"),
    retry: text(app.language, "retry"),
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
    const pinned = list.items.filter((chat) => chat.pinned === true);
    const recent = list.items.filter((chat) => chat.pinned !== true);
    const rows = [];
    const pushGroup = (labelKey, chats) => {
      if (!chats.length) return;
      rows.push({
        id: `heading:${labelKey}`,
        kind: "heading",
        depth: 0,
        text: t(labelKey),
        pos: rows.length + 1,
        setsize: list.items.length,
      });
      for (const chat of chats) {
        const last = chat.lastMessage;
        const snippet = last?.body || last?.subject || "";
        const when = formatWhen(app.language, last?.timestamp || last?.date || "");
        const unread = Number(chat.unread) > 0 ? t("unreadCount", { count: formatNumber(app.language, chat.unread) }) : "";
        rows.push({
          id: chat.id,
          kind: "chat",
          chat,
          depth: 0,
          text: [chat.title || chat.id, snippet, when, unread].filter(Boolean).join(" · "),
          pos: rows.length + 1,
          setsize: list.items.length,
        });
      }
    };
    pushGroup("pinnedChats", pinned);
    pushGroup("recentChats", recent);
    return rows;
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
    } else if (row.labelKey === "showMore") row.text = t("showMore", { count: formatNumber(app.language, row.count) });
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
    look: app.look,
    language: app.language,
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

function chooseSetting(app, patch) {
  return track(app, "settings", text(app.language, "savingSetting"), async (record) => {
    try {
      const retained = await reuseOrReconcile(app, record, "PATCH", "/settings", (operation) => sameSettingsChoice(operation, patch));
      const revision = app.store.settings?.revision ?? null;
      const result = await saveSettings(app.api, revision, patch, retained);
      record.operation = result.operation;
      applySettingsResult(app, result);
      return result;
    } catch (error) {
      if (error?.operation) record.operation = error.operation;
      if (error.code === "revision_conflict") {
        try {
          const latest = await request(app.api, "GET", "/settings");
          applySettingsRead(homeState(app), latest.data);
          app.store.settings = latest.data;
        } catch {
          // The visible error remains the conflict.
        }
      }
      throw error;
    }
  }).catch((error) => noteAction(app, error));
}

function sameSettingsChoice(operation, patch) {
  const body = operation?.body ?? {};
  return ["look", "language"].every((key) => (key in patch) === (key in body) && (!(key in patch) || patch[key] === body[key]));
}

function homeRequestBody(enabled, addresses) {
  const body = { enabled };
  if (addresses?.length) body.addresses = addresses;
  return body;
}

async function reuseOrReconcile(app, record, method, path, sameAttempt) {
  const pending = app.api.uncertain.has(record.operation?.id) ? record.operation : findUncertain(app.api, method, path);
  if (!pending || pending.method !== method || pending.path !== path || !app.api.uncertain.has(pending.id)) return null;
  if (sameAttempt(pending)) return pending;
  try {
    const result = await request(app.api, pending.method, pending.path, { operation: pending });
    result.operation = pending;
    applyMutationResult(app, pending, result);
  } catch (error) {
    if (error && typeof error === "object" && error.operation == null) error.operation = pending;
    throw error;
  }
  if (record.operation === pending) record.operation = null;
  return null;
}

function findUncertain(api, method, path) {
  for (const entry of api.uncertain?.values?.() ?? []) {
    const operation = entry?.operation;
    if (operation?.method === method && operation.path === path) return operation;
  }
  return null;
}

function samePayload(left, right) {
  return JSON.stringify(canonicalPayload(left ?? null)) === JSON.stringify(canonicalPayload(right ?? null));
}

function canonicalPayload(value) {
  if (Array.isArray(value)) return value.map(canonicalPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalPayload(value[key])]));
  }
  return value;
}

function applySettingsResult(app, result) {
  app.store.settings.settings = result.data.settings;
  app.store.settings.revision = result.data.revision;
  const choice = presentation(app.store.viewer, result.data.settings);
  app.look = choice.look === "high-contrast" ? "high-contrast" : "modern";
  app.language = choice.language === "es" ? "es" : "en";
}

function applyMutationResult(app, operation, result) {
  if (operation.path === "/settings") {
    applySettingsResult(app, result);
    return;
  }
  if (operation.path !== "/settings/home-network") return;
  const home = homeState(app);
  if (result.data?.key) takeGrant(home, result.data);
  else {
    clearGrant(home);
    home.home = result.data;
  }
  if (app.store.settings) app.store.settings.home = home.home;
}

function settle(app, key, label, work, onError = null) {
  return track(app, key, label, work).catch((error) => {
    if (onError) onError(error);
    else noteAction(app, error);
  });
}

function track(app, key, label, work) {
  if (!app.activity) app.activity = new Map();
  return runAction(app.activity, key, {
    label,
    work,
    render(record) {
      record.retry = () => track(app, key, label, work);
      const paint = () => {
        if (!app.disposed && app.layout !== "unknown") renderShell(app);
      };
      if (app.rendering) queueMicrotask(paint);
      else paint();
    },
  });
}

function editorAct(app, key, label, work) {
  return settle(app, key, label, work, (error) => noteEditor(app, error));
}

function activityPending(app, key) {
  return app.activity?.get(key)?.phase === "pending";
}

function paintActivity(app, shell) {
  const records = [...(app.activity?.values() ?? [])];
  const pending = records.filter((record) => record.phase === "pending");
  const failed = records.filter((record) => record.phase === "error");
  if (!pending.length && !failed.length) return;
  const document = app.root.ownerDocument;
  const region = element(document, "div", { class: "activity", "aria-live": "polite", "data-activity-region": "true" });
  if (pending.length) shell.setAttribute("aria-busy", "true");
  for (const record of pending) region.append(progressMark(document, record.label, { "data-activity": record.key }));
  for (const record of failed) {
    region.append(element(document, "p", { "data-activity": record.key, text: record.label }));
    region.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "retry-activity",
      "data-activity": record.key,
      text: text(app.language, "retry"),
      onclick: () => record.retry?.(),
    }));
  }
  shell.append(region);
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
    retry: t("retry"),
    onConfirm: run,
  });
}

function enableHome(app, raw) {
  const addresses = String(raw ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const home = homeState(app);
  home.expectGrant = true;
  return settle(app, "home-open", text(app.language, "openingHome"), async (record) => {
    try {
      const retained = await reuseOrReconcile(app, record, "POST", "/settings/home-network", (operation) => samePayload(operation.body, homeRequestBody(true, addresses)));
      const result = await openHome(app.api, addresses, retained);
      record.operation = result.operation;
      takeGrant(home, result.data);
      if (app.store.settings) app.store.settings.home = home.home;
      return result;
    } catch (error) {
      home.expectGrant = false;
      if (error?.operation) record.operation = error.operation;
      if (error.code === "listener_unavailable") clearGrant(home);
      throw error;
    }
  });
}

function endHome(app) {
  return settle(app, "home-close", text(app.language, "closingHome"), async (record) => {
    const retained = await reuseOrReconcile(app, record, "POST", "/settings/home-network", (operation) => samePayload(operation.body, homeRequestBody(false)));
    const result = await closeHome(app.api, retained);
    record.operation = result.operation;
    const home = homeState(app);
    clearGrant(home);
    home.home = result.data;
    if (app.store.settings) app.store.settings.home = result.data;
    return result;
  });
}

function renderFooter(app, t) {
  const document = app.root.ownerDocument;
  const machine = app.store.settings?.service?.machine ?? app.store.view?.mind?.machine ?? "";
  const syncState = app.settingsSync?.state ?? (app.store.settings?.service?.syncState === "error" ? "error" : app.sync);
  const syncKey = syncCopy(syncState);
  const time = formatClock(app.language, app.readAt);
  const footer = element(document, "footer", { class: "foot" },
    element(document, "span", { "data-service-machine": machine, text: t("serviceRunning", { machine }) }),
    element(document, "span", { "data-sync": syncState ?? "", "data-pending": String(app.settingsSync?.pendingChanges ?? ""), text: t(syncKey) }),
    element(document, "span", { text: t("lastRead", { time }) }),
  );
  if (Number.isInteger(app.settingsSync?.pendingChanges)) {
    footer.append(element(document, "span", { "data-pending-changes": String(app.settingsSync.pendingChanges), text: cardinal(app.language, "pendingChanges", app.settingsSync.pendingChanges) }));
  }
  const stream = app.store.stream;
  if (stream?.state === "connecting" || stream?.state === "reconnecting") footer.append(progressMark(document, t("reconnecting"), { "data-stream": stream.state }));
  if (stream?.state === "error") {
    footer.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "retry-stream",
      "data-stream": "error",
      text: t("retry"),
      onclick: () => synchronize(app.api, app.store, {
        cursor: () => app.store.cursor,
        onEvent: (event) => onStream(app, event),
        onState: () => { if (!app.disposed && app.layout !== "unknown") renderShell(app); },
      }),
    }));
  }
  return footer;
}

function renderPhoneNav(app, t) {
  const current = app.mode === "waiting" ? "waiting" : app.tab;
  const document = app.root.ownerDocument;
  const nav = renderPhone(document, t, PHONE_MODES, current, (mode) => navigate(app, mode), icon);
  const hintId = "phone-nav-hint";
  nav.setAttribute("aria-describedby", hintId);
  return element(document, "div", { class: "phone-dock" },
    element(document, "p", { id: hintId, class: "field-hint", "data-phone-hint": "true", text: t("phoneNavHint") }),
    nav,
  );
}

function renderSignedOut(app) {
  const document = app.root.ownerDocument;
  const t = (key, variables) => text(app.language, key, variables);
  const gate = element(document, "section", { class: "gate" },
    element(document, "h2", { text: t("reopenTitle") }),
    element(document, "p", { text: app.phoneError ? t(app.phoneError) : t("reopenBody") }),
  );
  if (app.phoneRetryAfter != null && app.phoneRetryAfter !== "" && Number.isFinite(Number(app.phoneRetryAfter))) {
    gate.append(element(document, "p", { "data-retry-after": String(app.phoneRetryAfter), text: cardinal(app.language, "retryWait", app.phoneRetryAfter) }));
  }
  if (app.phoneBusy) gate.append(progressMark(document, t("checkingCode")));
  gate.append(renderCodeEntry(document, t, (code) => submitCode(app, code), { value: app.phoneCode ?? "", busy: Boolean(app.phoneBusy) }));
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
  if (app.phoneBusy) return;
  app.phoneCode = code;
  app.phoneBusy = true;
  renderSignedOut(app);
  try {
    const credential = await exchangeCode(app.api, code);
    app.phoneBusy = false;
    app.phoneCode = "";
    app.phoneError = null;
    await bootSession(app, credential);
  } catch (error) {
    app.phoneBusy = false;
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
          if (app.api?.token && !app.api.closed) resumeBoot(app);
          else {
            dispose(app);
            mount(app.root);
          }
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
  const label = text(app.language, key);
  app.root.replaceChildren(element(document, "p", { id: "status", role: "status" }, progressMark(document, label)));
  ensureLive(app);
  app.liveStatus.textContent = label;
  app.liveError.textContent = "";
}

function viewTitle(app, t) {
  if (app.layout === "phone" && app.tab === "chats") return app.thread?.chat?.title || t("chats");
  return t(app.mode);
}

function attached(node) {
  return Boolean(node) && node.isConnected !== false && node.parentNode != null;
}

function placeLive(document, body, current, attributes) {
  if (attached(current)) return current;
  const found = body.querySelector?.(`[data-live='${attributes["data-live"]}']`);
  if (attached(found)) return found;
  const node = element(document, "div", attributes);
  body.append(node);
  return node;
}

function ensureLive(app) {
  const document = app.root.ownerDocument;
  const body = document.body;
  app.liveStatus = placeLive(document, body, app.liveStatus, {
    id: "live-status",
    class: "live",
    role: "status",
    "aria-live": "polite",
    "data-live": "status",
  });
  app.liveError = placeLive(document, body, app.liveError, {
    id: "live-error",
    class: "live",
    role: "alert",
    "aria-live": "assertive",
    "data-live": "error",
  });
}

function syncLiveRegions(app) {
  ensureLive(app);
  app.liveStatus.textContent = "";
  app.liveError.textContent = "";
  if (!app.actionNote) return;
  const region = app.actionTone === "error" ? app.liveError : app.liveStatus;
  region.textContent = app.actionNote;
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


const SESSION_COPY = {
  queued: "sessionQueued",
  starting: "sessionStarting",
  started: "sessionStarted",
  failed: "sessionFailed",
  expired: "sessionRequestExpired",
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

function showOutcome(app, note, code = null, tone = "status") {
  app.actionNote = note;
  app.actionCode = code;
  app.actionTone = tone;
}

function explain(app, key) {
  showOutcome(app, text(app.language, key), key);
  if (!app.disposed && app.layout !== "unknown") renderShell(app);
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
  const operations = new Map();
  const done = new Set();
  const body = targets.map((target) => text(app.language, "confirmConnect", { member: target.unit, lead: source.unit })).join(" ");
  showDialog(app.root.ownerDocument, {
    title: text(app.language, "connect"),
    body,
    confirm: text(app.language, "connect"),
    cancel: text(app.language, "cancel"),
    retry: text(app.language, "retry"),
    onConfirm: async () => {
      const pending = targets.filter((target) => !done.has(target.id));
      const results = await connectUnits(app.api, source, pending, operations);
      const failed = [];
      for (const result of results) {
        if (result.operation) operations.set(result.id, result.operation);
        if (result.error) failed.push(result);
        else done.add(result.id);
      }
      if (failed.length) {
        const error = new Error(failed.map((result) => connectCause(app, targets.find((item) => item.id === result.id), result)).join(" "));
        error.code = failed.some((result) => result.uncertain) ? "unknown_result" : (failed[0].error?.code ?? "request_failed");
        throw error;
      }
      showOutcome(app, targets.map((target) => text(app.language, "unitConnected", { unit: target.unit, lead: source.unit })).join(" "), "connected");
      if (app.unitList) await reloadList(app.unitList);
      if (!app.disposed) renderShell(app);
    },
  });
}

function connectCause(app, target, result) {
  const unit = target?.unit || text(app.language, "unknown");
  if (result.uncertain) return text(app.language, "unknownResult", { unit });
  return actionText(app.language, result.error?.code, { unit });
}

const UNIT_ROLES = ["adjutant", "executive", "executor", "genesis", "incubator", "master", "overlord", "overseer"];
const SCOPE_KINDS = [
  ["root", "scopeRoot"],
  ["environment", "scopeEnvironment"],
  ["project", "scopeProject"],
];

const RESERVED_BASENAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

function validResourceName(value, max = 80) {
  const name = String(value ?? "").trim();
  if (!name || name.length > max || name !== name.toLowerCase()) return false;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name.endsWith(".")) return false;
  return !RESERVED_BASENAMES.has(name.split(".")[0]);
}

function retainedOperation(operation, method, path, body) {
  if (!operation || operation.method !== method || operation.path !== path) return null;
  return JSON.stringify(operation.body) === JSON.stringify(body) ? operation : null;
}

function clearChoiceErrors(form) {
  for (const note of [...(form.querySelectorAll?.("[data-field-error]") ?? [])]) note.remove?.();
  for (const field of [...(form.querySelectorAll?.("[aria-invalid='true']") ?? [])]) {
    field.removeAttribute?.("aria-invalid");
    field.removeAttribute?.("aria-describedby");
  }
}

function markChoiceError(form, name, message) {
  const field = form.querySelector?.(`[name="${name}"]`);
  if (!field) return null;
  const id = `field-error-${name}`;
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", id);
  const note = element(form.ownerDocument, "p", {
    id,
    class: "field-error",
    role: "alert",
    "data-field-error": name,
    text: message,
  });
  (field.parent ?? form).append(note);
  return field;
}

function restoreInvoker(app, opener) {
  if (!opener || app.disposed) return;
  const live = app.root.querySelector?.(`[data-action="${opener}"]`);
  live?.focus?.();
}

function openUnitForm(app) {
  settle(app, "unit-form", text(app.language, "loadingClients"), async () => {
    const machines = (await collectPages(app.api, "/machines", { limit: 50 })).items;
    if (app.disposed || app.root.ownerDocument.querySelector?.("[data-form='unit']")) return;
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
    form.problems = () => unitProblems(app, form);
  }, async (form) => {
    const machineId = fieldValue(form, "machine");
    const machine = machines.find((item) => item.id === machineId);
    if (!machine?.answers) {
      showOutcome(app, text(app.language, "machineUnavailable", { machine: machineId }), "machine_unavailable");
      if (!app.disposed) renderShell(app);
      return false;
    }
    const kind = fieldValue(form, "scopeKind");
    const name = fieldValue(form, "scopeName").trim();
    const leadId = fieldValue(form, "leadId");
    const input = {
      unit: fieldValue(form, "unit").trim(),
      role: fieldValue(form, "role"),
      scope: { kind, name: kind === "root" ? null : name },
      machine: machineId,
      leadId: leadId || null,
      job: fieldValue(form, "job").trim() || null,
      model: fieldValue(form, "model").trim() || null,
      position: readPosition(form),
    };
    const body = {
      unit: input.unit,
      role: input.role,
      scope: input.scope,
      machine: input.machine,
      leadId: input.leadId,
      job: input.job,
      model: input.model,
      ...(input.position ? { position: input.position } : {}),
    };
    try {
      const created = await createUnit(app.api, input, retainedOperation(app.unitOperation, "POST", "/units", body));
      app.unitOperation = null;
      const unit = created.data?.unit?.unit ?? fieldValue(form, "unit").trim();
      showOutcome(app, text(app.language, "unitCreated", { unit }));
      if (app.unitList) await reloadList(app.unitList);
      if (!app.disposed) renderShell(app);
      return true;
    } catch (error) {
      app.unitOperation = error?.operation ?? app.unitOperation ?? null;
      showOutcome(app, error?.code === "machine_unavailable"
        ? text(app.language, "machineUnavailable", { machine: error.details?.machine ?? machineId })
        : actionText(app.language, error?.code), error?.code ?? null);
      if (!app.disposed) renderShell(app);
      throw error;
    }
  }, "new-unit");
  });
}

function openSessionForm(app, unit) {
  settle(app, `session-form:${unit.id}`, text(app.language, "loadingClients"), async () => {
    const machines = (await collectPages(app.api, "/machines", { limit: 50 })).items;
    if (app.disposed || app.root.ownerDocument.querySelector?.("[data-form='session']")) return;
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
    form.problems = () => {
      const client = fieldValue(form, "client");
      return clients.some((item) => item.id === client) ? [] : [{ name: "client", message: text(app.language, "clientInvalid") }];
    };
  }, async (form) => {
    const client = fieldValue(form, "client");
    if (!clients.some((item) => item.id === client)) {
      showOutcome(app, text(app.language, "clientUnavailable"), "client_unavailable");
      if (!app.disposed) renderShell(app);
      return false;
    }
    const prompt = fieldValue(form, "prompt").trim() || null;
    const body = { client, prompt, expectedRevision: unit.revision };
    try {
      const started = await startSession(app.api, unit, client, prompt, retainedOperation(app.sessionOperation, "POST", "/units/:unitId/session", body));
      app.sessionOperation = null;
      app.sessionRequestId = started.data.requestId;
      showOutcome(app, text(app.language, SESSION_COPY[started.data.state] ?? "actionFailed"), started.data.state ?? null);
      if (started.data.state === "queued" || started.data.state === "starting") await recheckTracked(app);
      if (!app.disposed) renderShell(app);
      return true;
    } catch (error) {
      app.sessionOperation = error?.operation ?? app.sessionOperation ?? null;
      showOutcome(app, error?.code === "machine_unavailable"
        ? text(app.language, "machineUnavailable", { machine: error.details?.machine ?? unit.machine })
        : actionText(app.language, error?.code), error?.code ?? null);
      if (!app.disposed) renderShell(app);
      throw error;
    }
  }, "start-session");
  });
}

function confirmStop(app, sessionId) {
  showDialog(app.root.ownerDocument, {
    title: text(app.language, "stopSession"),
    body: text(app.language, "sessionStopping"),
    confirm: text(app.language, "stopSession"),
    cancel: text(app.language, "cancel"),
    retry: text(app.language, "retry"),
    onConfirm: async () => {
      try {
        const stopped = await stopSession(app.api, sessionId, app.stopOperation ?? null);
        app.stopOperation = null;
        showOutcome(app, text(app.language, SESSION_COPY[stopped.data.state] ?? "sessionStopping"), stopped.data.state ?? null);
        if (!app.disposed) renderShell(app);
      } catch (error) {
        app.stopOperation = error?.operation ?? app.stopOperation ?? null;
        showOutcome(app, actionText(app.language, error?.code), error?.code ?? null);
        if (!app.disposed) renderShell(app);
        throw error;
      }
    },
  });
}

function unitProblems(app, form) {
  const problems = [];
  if (!validResourceName(fieldValue(form, "unit"))) problems.push({ name: "unit", message: text(app.language, "nameInvalid") });
  if (fieldValue(form, "scopeKind") !== "root" && !validResourceName(fieldValue(form, "scopeName"))) {
    problems.push({ name: "scopeName", message: text(app.language, "nameInvalid") });
  }
  const x = fieldValue(form, "positionX").trim();
  const y = fieldValue(form, "positionY").trim();
  if ((x !== "" || y !== "") && (!/^-?\d+$/.test(x) || !/^-?\d+$/.test(y))) {
    problems.push({ name: /^-?\d+$/.test(x) ? "positionY" : "positionX", message: text(app.language, "positionInvalid") });
  }
  return problems;
}

function openChoiceForm(app, kind, title, build, onConfirm, opener = null) {
  const document = app.root.ownerDocument;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.setAttribute("data-form", kind);
  const form = element(document, "form", { method: "dialog" });
  const heading = element(document, "h2", { text: title });
  labelDialog(dialog, heading);
  form.append(heading);
  const confirm = element(document, "button", { type: "button", class: "btn primary", "data-action": "confirm-form", text: title });
  build(form, confirm);
  const actions = element(document, "div", { class: "dialog-actions" });
  const cancel = element(document, "button", { type: "button", class: "btn", text: text(app.language, "cancel") });
  let sending = false;
  cancel.addEventListener("click", () => dialog.close());
  confirm.addEventListener("click", async () => {
    if (sending || confirm.disabled) return;
    clearChoiceErrors(form);
    dialog.querySelector("[data-dialog-error]")?.remove();
    const problems = typeof form.problems === "function" ? form.problems() : [];
    if (problems.length) {
      let first = null;
      for (const problem of problems) {
        const field = markChoiceError(form, problem.name, problem.message);
        if (!first && field) first = field;
      }
      first?.focus?.();
      return;
    }
    sending = true;
    confirm.setAttribute("aria-busy", "true");
    const label = confirm.textContent;
    confirm.replaceChildren(progressMark(document, label));
    try {
      const accepted = await onConfirm(form);
      if (accepted !== true) {
        sending = false;
        confirm.removeAttribute("aria-busy");
        confirm.textContent = label;
        confirm.replaceChildren(document.createTextNode(label));
        return;
      }
      dialog.close();
    } catch (error) {
      sending = false;
      confirm.removeAttribute("aria-busy");
      const retry = text(app.language, "retry");
      confirm.textContent = retry;
      confirm.replaceChildren(document.createTextNode(retry));
      const note = element(document, "p", {
        class: "action-note",
        "data-dialog-error": "true",
        role: "alert",
        text: actionText(app.language, error?.code),
      });
      if (typeof form.insertBefore === "function") form.insertBefore(note, actions);
      else form.append(note);
    }
  });
  actions.append(cancel, confirm);
  form.append(actions);
  dialog.append(form);
  dialog.addEventListener("close", () => {
    dialog.remove();
    restoreInvoker(app, opener);
  });
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

function messageSender(app, message) {
  if (!message?.fromId) return text(app.language, "unknown");
  return unitById(app, message.fromId)?.unit || message.fromId;
}

function chatPanel(app, t) {
  const document = app.root.ownerDocument;
  const thread = app.thread;
  const panel = element(document, "section", { class: "chat-panel" });
  if (!thread?.chat) return panel;
  panel.append(element(document, "header", { class: "chat-heading" },
    element(document, "h2", { class: "chat-title", "data-chat-title": thread.chat.id, text: thread.chat.title || thread.chat.id }),
  ));
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
    const article = element(document, "article", { class: "bubble", "data-from": message.fromId ?? "" });
    const when = formatWhen(app.language, message.timestamp || message.date || "");
    article.append(element(document, "p", {
      class: "bubble-meta",
      text: `${messageSender(app, message)}${when ? ` ${when}` : ""}`,
    }));
    const row = element(document, "p", {
      "data-message": message.id,
      "data-read": message.read ? "true" : "false",
      "data-pending": message.pending ? (message.failed ? "failed" : "true") : null,
      text: message.body || message.subject || "",
    });
    article.append(row);
    if (message.pending && !message.failed) article.append(progressMark(document, t("sending")));
    if (message.failed) {
      article.append(element(document, "button", {
        type: "button",
        class: "btn",
        "data-action": "retry-message",
        text: t("retry"),
        onclick: () => {
          const task = retryMessage(app.api, thread);
          if (!app.disposed) renderShell(app);
          task?.then(() => {
            if (!app.disposed) renderShell(app);
          }).catch((error) => noteAction(app, error));
        },
      }));
    }
    transcript.append(article);
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
    const managing = activityPending(app, `chat-manage:${thread.chat.id}`);
    const manageButton = (action, label, change) => element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": action,
      "aria-busy": managing ? "true" : "false",
      disabled: managing ? "" : null,
      onclick: () => changeChat(app, change),
    }, managing ? progressMark(document, t("working")) : label);
    if (thread.chat.pinned !== true) row.append(manageButton("pin", t("pin"), { pinned: true }));
    if (thread.chat.listed !== false) row.append(manageButton("unlist", t("removeFromList"), { listed: false }));
    if (thread.chat.listed === false) row.append(manageButton("reopen", t("reopenChat"), { listed: true }));
  }
  row.append(element(document, "button", { type: "button", class: "btn", "data-action": "older", text: t("loadOlder"), onclick: () => loadOlder(app) }));
  if (caps.includes("mailbox.read") || caps.includes("master.read")) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "mailbox", text: t("mailbox"), onclick: () => inspectMailbox(app) }));
  }
  panel.append(transcript, row);
  if (caps.includes("chat.post")) {
    const composer = element(document, "input", { class: "composer", "data-composer": "true", "data-chat": thread.chat.id, "data-keep": keepId("chat", thread.chat.id), "aria-label": t("send") });
    const savedChat = inputDrafts(app).chats.get(thread.chat.id);
    composer.value = savedChat?.value ?? thread.composer ?? "";
    composer.addEventListener("input", () => {
      const draft = fieldDraft(composer);
      inputDrafts(app).chats.set(thread.chat.id, draft);
      thread.composer = draft.value;
      syncViewerDirty(app);
    });
    const sending = Boolean(thread.pending);
    const send = element(document, "button", {
      type: "button",
      class: "btn primary",
      "data-action": "send",
      "aria-busy": sending ? "true" : "false",
      disabled: sending ? "" : null,
      onclick: () => submitComposer(app, composer),
    }, sending ? progressMark(document, t("sending")) : t("send"));
    if (sending) send.disabled = true;
    panel.append(labeledField(document, t("composerLabel"), t("composerHint"), composer), send);
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
    const visibleMail = [...(box.items ?? [])];
    if (box.optimistic) visibleMail.unshift(box.optimistic);
    if (!visibleMail.length && !box.pending) history.append(element(document, "p", { "data-empty": "true", text: t("mailboxEmpty") }));
    for (const message of visibleMail) {
      if (message.pending) {
        const row = element(document, "p", {
          "data-mailbox-message": message.id,
          "data-pending": message.failed ? "failed" : "true",
          text: message.body || "",
        });
        if (!message.failed) row.append(progressMark(document, t("sending")));
        else row.append(element(document, "button", {
          type: "button",
          class: "btn",
          "data-action": "retry-mailbox",
          text: t("retry"),
          onclick: () => sendMailbox(app, { value: message.body }),
        }));
        history.append(row);
        continue;
      }
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
    const compose = element(document, "input", { class: "composer", "data-mailbox-compose": "true", "data-keep": keepId("mail", box.unitId), "aria-label": t("mailboxCompose") });
    compose.value = box.composer ?? "";
    compose.addEventListener("input", () => {
      box.composer = compose.value;
      rememberFormDraft(app, "mail", box.unitId, compose.value);
    });
    const sending = Boolean(box.pending);
    section.append(compose, element(document, "button", {
      type: "button",
      class: "btn primary",
      "data-action": "send-mailbox",
      "aria-busy": sending ? "true" : "false",
      disabled: sending ? "" : null,
      onclick: () => sendMailbox(app, compose),
    }, sending ? progressMark(document, t("sending")) : t("send")));
  }
  if (box.note) section.append(element(document, "p", { class: "action-note", "data-mailbox": "true", text: box.note }));
  return section;
}

function takePendingChat(app) {
  const pending = app.pendingChat;
  if (!pending || app.chatOpening) return;
  app.pendingChat = null;
  app.chatOpening = true;
  const finish = () => { app.chatOpening = false; };
  if (!pending.create) {
    openExistingDirect(app, pending.unitId).finally(finish);
    return;
  }
  app.phoneChatNote = false;
  settle(app, `open-chat:${pending.unitId}`, text(app.language, "loadingConversation"), async (record) => {
    const result = await openDirectChat(app.api, [pending.unitId], record.operation);
    await showChat(app, result.data);
  }).finally(finish);
}

function openExistingDirect(app, unitId) {
  return settle(app, `direct:${unitId}`, text(app.language, "loadingConversation"), async () => {
    const chat = await findDirectChat(app.api, unitId);
    app.tab = "chats";
    if (chat) {
      app.phoneChatNote = false;
      await showChat(app, chat);
      return;
    }
    app.phoneChatNote = true;
  });
}

function showChat(app, chat) {
  captureInputs(app);
  app.thread = createThread(chat);
  const saved = inputDrafts(app).chats.get(chat.id);
  if (saved) app.thread.composer = saved.value;
  return settle(app, `chat:${chat.id}`, text(app.language, "loadingConversation"), async () => {
    await loadMessages(app.api, app.thread);
  });
}

function changeChat(app, change) {
  const chat = app.thread?.chat;
  if (!chat) return;
  settle(app, `chat-manage:${chat.id}`, text(app.language, "working"), async (record) => {
    const result = await manageChat(app.api, chat, change, record.operation);
    app.thread.chat = result.data;
  });
}

function loadOlder(app) {
  const host = app.root.querySelector?.(".transcript");
  const anchor = host?.querySelector?.("[data-message]");
  const measuredId = anchor?.getAttribute?.("data-message") ?? null;
  const measuredOffset = anchor?.offsetTop ?? 0;
  if (!app.thread?.chat) return;
  if (app.thread) {
    app.thread.nearBottom = false;
    if (measuredId) app.thread.anchorId = measuredId;
    app.thread.anchorOffset = measuredOffset;
  }
  const older = Boolean(app.thread.nextCursor);
  track(app, `older:${app.thread.chat.id}`, text(app.language, "loadingConversation"), async () => {
    await loadMessages(app.api, app.thread, older);
  }).then(() => {
    if (app.disposed || !measuredId) return;
    app.thread.anchorId = measuredId;
    app.thread.anchorOffset = measuredOffset;
    app.thread.nearBottom = false;
    const next = app.root.querySelector?.(".transcript");
    const node = next?.querySelector?.(`[data-message="${measuredId}"]`);
    if (next && node) next.scrollTop += (node.offsetTop ?? 0) - measuredOffset;
  }).catch((error) => noteAction(app, error));
}

function inspectMailbox(app) {
  settle(app, "mailboxes", text(app.language, "loadingList"), async () => {
    const result = await loadMailboxes(app.api);
    const composer = app.mailbox?.composer ?? "";
    app.mailbox = {
      list: result.data.items ?? [],
      unitId: null,
      items: [],
      nextCursor: null,
      detail: null,
      composer,
      note: "",
    };
  });
}

function openMailboxUnit(app, unitId, cursor = null) {
  settle(app, `mailbox:${unitId}`, text(app.language, "loadingList"), async () => {
    const result = await openMailbox(app.api, unitId, "all", cursor);
    const incoming = result.data.items ?? [];
    app.mailbox.unitId = unitId;
    app.mailbox.items = cursor ? [...(app.mailbox.items ?? []), ...incoming] : incoming;
    app.mailbox.nextCursor = result.data.nextCursor ?? null;
    if (!cursor) app.mailbox.detail = null;
  });
}

function openMailboxDetail(app, messageId) {
  const unitId = app.mailbox?.unitId;
  if (!unitId) return;
  settle(app, `mailbox-message:${messageId}`, text(app.language, "loadingDetails", { name: messageId }), async () => {
    const result = await loadMailboxMessage(app.api, unitId, messageId);
    app.mailbox.detail = result.data;
  });
}

function markOpenMailbox(app) {
  const box = app.mailbox;
  if (!box?.detail || !canMarkMailbox(app.store.audience, app.store.capabilities, box.unitId)) return;
  const messageId = box.detail.id;
  settle(app, `read:${messageId}`, text(app.language, "working"), async (record) => {
    const result = await markMailboxRead(app.api, box.unitId, [messageId], record.operation);
    const read = new Set(result.data.readIds ?? []);
    for (const item of box.items ?? []) if (read.has(item.id)) item.read = true;
    if (box.detail && read.has(box.detail.id)) box.detail = { ...box.detail, read: true };
    box.note = text(app.language, "markedRead");
  });
}

function sendMailbox(app, compose) {
  const box = app.mailbox;
  if (!box?.unitId || box.pending) return;
  const saved = box.optimistic?.failed ? box.optimistic.body : compose.value;
  box.composer = saved;
  const task = postMailbox(app.api, box.unitId, { body: saved }, box.operation);
  box.operation = task.operation;
  box.pending = true;
  if (!box.optimistic || box.optimistic.id !== `pending:${task.operation.id}`) {
    box.optimistic = { id: `pending:${task.operation.id}`, body: saved, pending: true, failed: false };
  } else {
    box.optimistic.pending = true;
    box.optimistic.failed = false;
  }
  if (!app.disposed) renderShell(app);
  task.then((result) => {
    box.pending = false;
    box.operation = null;
    box.optimistic = null;
    if (box.composer === saved) box.composer = "";
    releaseFormDraft(app, "mail", box.unitId, saved);
    box.items = [result.data, ...(box.items ?? [])];
    box.detail = result.data;
    if (!app.disposed) renderShell(app);
  }).catch((error) => {
    box.pending = false;
    if (box.optimistic) box.optimistic.failed = true;
    box.operation = error?.operation ?? box.operation;
    noteAction(app, error);
  });
}

function submitComposer(app, composer) {
  const chatId = app.thread?.chat?.id;
  const draft = composer.value;
  app.thread.composer = draft;
  if (chatId) inputDrafts(app).chats.set(chatId, fieldDraft(composer));
  const task = postMessage(app.api, app.thread, { body: draft });
  if (!app.disposed) renderShell(app);
  task.then(() => {
    if (chatId) clearInputDraft(app, "chat", chatId);
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error));
}

function noteAction(app, error) {
  showOutcome(app, actionText(app.language, error?.code), error?.code ?? null, "error");
  if (!app.disposed) renderShell(app);
}

function renderInspector(app, t, selected) {
  const document = app.root.ownerDocument;
  const panel = element(document, "div", { class: "review-panel" });
  const data = app.inspectorData;
  if (selected) panel.append(renderUnit(document, selected, t, app.language));
  if (!data || data.unitId !== selected?.id) {
    if (selected && activityPending(app, `inspector:${selected.id}`)) {
      panel.append(progressMark(document, t("loadingDetails", { name: selected.unit || selected.id }), { "data-inspector-progress": selected.id }));
    }
    return panel;
  }
  const details = element(document, "details", { class: "inspector-details" });
  details.append(element(document, "summary", { text: t("details") }));
  const machine = (data.machines ?? []).find((item) => item.id === selected?.machine);
  if (machine) details.append(renderMachine(document, machine, t));
  for (const session of data.sessions ?? []) details.append(renderSession(document, session, t));
  const caps = app.store.capabilities ?? [];
  if (caps.includes("grant.revoke")) {
    const busyGrant = [...(app.activity?.entries() ?? [])].find(([key, record]) => key.startsWith("grant:") && record.phase === "pending")?.[0]?.slice(6) ?? null;
    details.append(renderGrants(document, data.grants, t, (grant) => revokeSelectedGrant(app, selected, grant), busyGrant));
  }
  if (caps.includes("approval.answer")) {
    for (const approval of data.approvals ?? []) {
      details.append(renderApproval(document, approval, t, (item, decision) => answerSelected(app, item, decision), activityPending(app, `approval:${approval.id}`)));
    }
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
    details.append(taskHost);
  }
  const visibleTasks = tasks.length >= 100 ? tasks.filter((task) => task.id === app.openTaskId).slice(0, 1) : tasks;
  for (const task of visibleTasks) {
    const noteDraft = inputDrafts(app).notes.get(task.id);
    const phone = app.layout === "phone" || app.store.audience === "phone";
    const taskBusy = activityPending(app, `task:${task.id}`) || activityPending(app, `undo:${task.id}`);
    details.append(renderTask(document, task, t, (item, status, note) => setTaskStatus(app, item, status, note), caps.includes("task.undo") ? (item) => undoSelected(app, item) : null, noteDraft?.value ?? "", (value, start, end) => {
      inputDrafts(app).notes.set(task.id, { value, start: Number.isInteger(start) ? start : value.length, end: Number.isInteger(end) ? end : value.length });
      syncViewerDirty(app);
    }, phone ? canAccept(task) : canSendBack(task), taskBusy));
    details.append(openTaskDetail(document, task, t));
  }
  details.append(renderWaiting(document, data.waiting, t, (item) => openWaitingItem(app, item)));
  panel.append(details);
  return panel;
}

function loadInspector(app, unitId) {
  const ticket = (app.inspectorTicket ?? 0) + 1;
  app.inspectorTicket = ticket;
  const name = unitById(app, unitId)?.unit || unitId;
  return settle(app, `inspector:${unitId}`, text(app.language, "loadingDetails", { name }), async () => {
    const [tasks, approvals, expired, unit, waiting, machines, sessions] = await Promise.all([
      collectPages(app.api, "/tasks", { query: { unitId, status: "open,review,done,closed" }, limit: 50 }),
      collectPages(app.api, "/approvals", { query: { unitId, state: "pending" }, limit: 50 }),
      collectPages(app.api, "/approvals", { query: { unitId, state: "expired" }, limit: 20 }),
      request(app.api, "GET", `/units/${encodeURIComponent(unitId)}`),
      collectPages(app.api, "/waiting", { query: { unitId }, limit: 50 }),
      collectPages(app.api, "/machines", { limit: 50 }),
      collectPages(app.api, "/sessions", { query: { unitId }, limit: 50 }),
    ]);
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
  });
}

function answerSelected(app, approval, decision) {
  settle(app, `approval:${approval.id}`, text(app.language, "answering"), async (record) => {
    const result = await answerApproval(app.api, approval, decision, record.operation);
    record.operation = result.operation;
    const next = result.data?.approval ?? null;
    app.answerId = result.data.answerId ?? null;
    app.answerApprovalId = next?.id ?? approval.id;
    if (next) replaceApproval(app, next);
    const label = next ? approvalLabel(app, next) : text(app.language, "answerQueued");
    if (label) showOutcome(app, label, next?.state ?? "answering");
    if (finalApprovalState(next?.state)) refreshOwnerSurface(app, next.unitId ?? approval.unitId);
    else if (!app.disposed) renderShell(app);
    return result;
  });
}

function revokeSelectedGrant(app, unit, grant) {
  settle(app, `grant:${grant.id}`, text(app.language, "working"), async (record) => {
    const result = await revokeGrant(app.api, unit, grant.id, record.operation);
    record.operation = result.operation;
    app.revocationRequestId = result.data.requestId ?? null;
    app.revocationUnitId = result.data.unitId ?? unit.id;
    if (result.data.state === "revoked") {
      showOutcome(app, text(app.language, "grantRevoked"), "revoked");
      refreshOwnerSurface(app, app.revocationUnitId);
      return;
    }
    showOutcome(app, text(app.language, "grantPending"), result.data.state ?? "pending");
    if (!app.disposed) renderShell(app);
    return result;
  });
}

function setTaskStatus(app, task, status, note) {
  settle(app, `task:${task.id}`, text(app.language, "working"), async (record) => {
    const result = await changeTaskStatus(app.api, task, status, note, record.operation);
    record.operation = result.operation ?? record.operation;
    if (status === "open") clearInputDraft(app, "note", task.id);
    showOutcome(app, taskText(app.language, result.data.task.status), result.data.task.status);
    app.inspectorData.tasks = app.inspectorData.tasks.map((item) => item.id === result.data.task.id ? result.data.task : item);
    refreshWaiting(app);
    return result;
  });
}

function undoSelected(app, task) {
  settle(app, `undo:${task.id}`, text(app.language, "working"), async (record) => {
    const result = await undoTask(app.api, task, record.operation);
    record.operation = result.operation ?? record.operation;
    showOutcome(app, taskText(app.language, result.data.task.status), result.data.task.status);
    app.inspectorData.tasks = app.inspectorData.tasks.map((item) => item.id === result.data.task.id ? result.data.task : item);
    refreshWaiting(app);
    return result;
  });
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
