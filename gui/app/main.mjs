import {
  answerApproval,
  canAccept,
  canSendBack,
  changeTaskStatus,
  connectUnits,
  createUnit,
  createGroup,
  patchGroup,
  removeGroup,
  removeUnit,
  setUnitAlias,
  undoChange,
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
import { ApiError, clearCredentials, createApi, createOperation, dispose as disposeApi, fetchAsset, operationId, request } from "./api.mjs";
import { element, icon, labelDialog, labeledField, progressMark, runAction, setBusy, showDialog, showError } from "./components.mjs";
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
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup, unitDisplayName, unitsForTree } from "./hierarchy.mjs";
import { openTaskDetail, renderApproval, renderGrants, renderMachine, renderSession, renderTask, renderUnit, renderWaiting } from "./inspector.mjs";
import { cardinal, formatClock, formatNumber, formatWhen, text } from "./i18n.mjs";
import { collectPages, createPagedList, loadAll, reloadList, renderWindow, setQuery, windowRange } from "./lists.mjs";
import { adoptInitialLayout, applyRemoteLayout, centerUnit, createMap, keepLocalPosition, renderMap, retrySavedLayout, useIncomingPosition } from "./map.mjs";
import { dispose as disposeEmbed, publishDirty, publishReady, startEmbedChannel } from "./embed.mjs";
import { PHONE_NAV, exchangeCode, exchangeHomeFragment, logout, renderCodeEntry, renderPhone } from "./phone.mjs";
import { applyIssueChange, applyServiceBeat, applySettingsRead, applySyncSnapshot, armExpiry, clearGrant, closeHome, noteHomeChange, openHome, renderSettings, saveSettings, takeGrant } from "./settings.mjs";
import { acceptStreamEvent, createStore, loadSnapshot } from "./state.mjs";
import { answerProposal, enterFocus, leaveFocus, loadProposals, moveFocus, noteProposal, rememberTextDraft, renderDocument, renderProposal, replaceDocument, saveRange, selectedPlainRange, showTools, sourceReplacement, textAnchor, textDraft, textDraftKey } from "./void.mjs";
import { close as closeStream, synchronize } from "./stream.mjs";

const DESKTOP_MODES = ["map", "blueprint", "document", "focus"];
const PHONE_MODES = PHONE_NAV;

const OPENING_COPY = {
  reading: ["Reading the M1ND", "Leyendo el M1ND"],
  failure: ["The M1ND cannot be read", "No se puede leer el M1ND"],
  chooseFolder: ["Choose another folder", "Elegir otra carpeta"],
  noUnits: ["No units yet", "Todavía no hay unidades"],
  first: ["The Overseer comes first; create it from the inspector.", "Crear primero el Overseer desde el inspector."],
  empty: ["Your M1ND is empty", "El M1ND está vacío"],
  coordinates: ["The Overseer coordinates every other unit. Create it first; then add Overlords and Executors from the Map.", "El Overseer coordina las demás unidades. Crearlo primero y agregar después Overlords y Executors desde el Mapa."],
  create: ["Create the Overseer", "Crear el Overseer"],
  goesHere: ["The Overseer goes here", "El Overseer se coloca aquí"],
  timeout: ["{path} did not answer in 30 s. The drive may be offline, or another program may hold the folder.", "{path} no respondió en 30 s. La unidad puede estar desconectada o la carpeta puede estar bloqueada por otro programa."],
  counts: ["{units} units, {groups} groups, {chats} chats, {boards} boards", "{units} unidades, {groups} grupos, {chats} chats, {boards} tableros"],
  connecting: ["Connecting to the service", "Conectando con el servicio"],
  read: ["Reading", "Leyendo"],
  notRead: ["M1ND not read", "M1ND sin leer"],
};

function openingText(app, key, variables = {}) {
  return OPENING_COPY[key][app.language === "es" ? 1 : 0].replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? ""));
}

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
    bootReading: Boolean(api.token),
    selectedFolder: env.mindPath ?? new URLSearchParams(api.location.search ?? "").get("mind") ?? "",
    chooseFolder: env.chooseFolder ?? null,
  };
  const view = root.ownerDocument.defaultView;
  view?.addEventListener?.("keydown", (event) => onFocusKey(app, event));
  root.addEventListener("keydown", (event) => {
    if (event.key !== "F2" || app.layout === "phone" || event.target?.closest?.("input, textarea")) return;
    const row = app.activeRows?.find((item) => item.id === event.target?.closest?.("[data-id]")?.getAttribute("data-id"));
    const id = row?.unit?.id ?? app.store.selected.unitId;
    if (id && !app.aliasEdit) { event.preventDefault?.(); beginAlias(app, id, row?.id); }
  });
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
  app.bootReading = true;
  app.bootError = null;
  if (!app.selectedFolder && app.store.audience !== "phone") {
    request(app.api, "GET", "/viewer/folder", { deadlineMs: 30000 }).then((result) => {
      app.selectedFolder = result.data.mindPath;
      if (!app.disposed && app.bootFailed) renderShell(app);
    }).catch(() => {});
  }
  synchronize(app.api, app.store, {
    cursor: () => app.store.cursor,
    onEvent: (event) => onStream(app, event),
    onState: () => {
      if (!app.disposed && !app.bootFailed && app.layout !== "unknown") renderShell(app);
    },
  });
  try {
    await loadSnapshot(app.store, { ...app.api, deadlineMs: 30000 });
    if (app.disposed || app.bootFailed) return app;
    if (!app.disposed && !app.store.capabilities?.length) armBootDeadline(app, app.readyBudgetMs);
    await loadPresentation(app);
    if (app.disposed || app.bootFailed) return app;
    await loadLists(app);
    startOwnEmbed(app);
  } catch (error) {
    if (!app.disposed) {
      if (error?.status === 401) clearCredentials(app.api);
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
  const budget = Number.isFinite(budgetMs) ? budgetMs : 30000;
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

async function patchOwnViewer(app, body, retained = null) {
  const operation = retained ?? createOperation({ method: "PATCH", path: "/viewer", body });
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
  if (app.bootReading || app.bootFailed) return;
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
  if (!app.api.token) {
    renderSignedOut(app);
    return;
  }
  const document = app.root.ownerDocument;
  document.documentElement.lang = app.language;
  document.documentElement.dataset.look = app.look;
  document.documentElement.dataset.mode = app.mode;
  const t = (key, variables) => text(app.language, key, variables);
  const view = app.store.view;
  const counts = view?.counts ?? {};
  const opening = app.layout !== "phone" && (app.bootReading || app.bootFailed);
  const empty = !opening && emptyMind(app);
  const shell = element(document, "div", { class: `shell${opening ? " shell-opening" : empty ? " shell-empty" : ""}`, "data-layout": app.layout === "phone" ? "phone" : "desktop", "data-mode": app.mode, "data-tab": app.tab, "data-boot": opening ? app.bootFailed ? "failed" : "reading" : "ready" });
  const heading = viewTitle(app, t);
  document.title = `${heading} · HIVEM1ND`;
  const workspace = renderWorkspace(app, t, view, counts);
  workspace.setAttribute("id", "workspace");
  shell.append(
    element(document, "a", { class: "skip", href: "#workspace", text: t("skipToContent") }),
    element(document, "h1", { class: "sr", text: heading }),
    renderBar(app, t, counts),
    workspace,
    opening ? openingFooter(app) : renderFooter(app, t),
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
    app.inputDrafts = { chats: new Map(), notes: new Map(), nodes: new Map(), resources: new Map(), mail: new Map(), fields: new Map(), disclosures: new Map(), focus: null };
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
  if (!drafts.disclosures) drafts.disclosures = new Map();
  for (const node of app.root.querySelectorAll?.("[data-disclosure]") ?? []) {
    const key = node.getAttribute?.("data-disclosure");
    if (key) drafts.disclosures.set(key, node.getAttribute?.("open") != null || node.open === true);
  }
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
  revealAncestors(node);
  node.focus?.();
  if (typeof node.setSelectionRange === "function") node.setSelectionRange(focus.start, focus.end);
}

function revealAncestors(node) {
  let current = node?.parentNode ?? node?.parent ?? null;
  while (current) {
    if (String(current.tagName ?? current.tag ?? "").toLowerCase() === "details") {
      current.open = true;
      current.setAttribute?.("open", "");
    }
    current = current.parentNode ?? current.parent ?? null;
  }
}

function trackDisclosure(app, node, key) {
  node.setAttribute("data-disclosure", key);
  if (inputDrafts(app).disclosures?.get(key) === true) {
    node.open = true;
    node.setAttribute("open", "");
  }
  return node;
}

export function dispose(app) {
  if (!app || app.disposed) return;
  app.disposed = true;
  clearTimeout(app.readyTimer);
  clearTimeout(app.mapToastTimer);
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
  if (event?.name === "home.changed") {
    const data = dataOf(event);
    noteHome(app, data);
    if (app.store.audience === "phone" && data.home?.enabled === false) {
      closeStream(app.api.live);
      clearCredentials(app.api);
      app.store.signedOut = 410;
      app.phoneError = data.reason === "expired" ? "homeExpired" : "homeClosed";
      result?.consume?.();
      renderSignedOut(app);
      return;
    }
  }
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
    if (event?.name === "unit.changed" && dataOf(event).unit?.removed) {
      const id = dataOf(event).unit.id;
      if (app.pendingChat?.unitId === id) app.pendingChat = null;
      app.mapState?.selection.delete(id);
      if (app.store.selected.unitId === id) app.store.selected.unitId = null;
      if (app.thread?.chat?.kind === "direct" && app.thread.chat.members.includes(id)) app.thread = null;
    }
  }
  if (event?.name === "chat.changed") {
    if (app.chatList) await reloadList(app.chatList);
    const changed = dataOf(event).chat;
    if (changed?.id === app.thread?.chat?.id) app.thread.chat = app.store.indexes.chats.get(changed.id) ?? changed;
  }
  if (event?.name === "group.changed") {
    if (app.mapState) app.mapState.selectedGroupId = app.store.selected.groupId;
    if (dataOf(event).group?.deleted && app.thread?.chat?.id === dataOf(event).group.chatId) app.thread = null;
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
  app.selectedFolder = settings.data.locations?.mind ?? app.selectedFolder;
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
  if (app.layout !== "unknown" && app.store.snapshotReady) {
    app.bootReading = false;
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
    "aria-pressed": String(app.mode === "map" && app.waitingOpen === true || app.mode === "waiting"),
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
  const bar = element(document, "header", { class: "bar" }, brand(document), modes);
  if (counts.waiting || (!app.bootReading && !app.bootFailed && !emptyMind(app))) bar.append(waiting);
  if (app.layout !== "phone") {
    bar.append(catalogToggle);
    if (app.mode === "blueprint" || app.mode === "document") bar.append(commentsToggle);
    bar.append(inspector, settings);
  }
  return bar;
}

function renderWorkspace(app, t, view, counts) {
  if (app.layout !== "phone" && (app.bootReading || app.bootFailed)) return openingWorkspace(app, t);
  if (emptyMind(app) && app.mode === "map" && !app.waitingOpen) return emptyWorkspace(app, t);
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
      element(document, "span", { text: cardinal(app.language, "unitCount", app.unitList?.catalog?.length || counts.units || 0) }),
      element(document, "span", { text: t("unreadCount", { count: formatNumber(app.language, counts.unread ?? 0) }) }),
      element(document, "span", { text: cardinal(app.language, "issueCount", counts.issues ?? 0) }),
    ),
  );
  const issueItems = view?.issues ?? app.unitList?.issues ?? [];
  const collection = renderCollection(app, t);
  const phoneTitle = app.mode === "waiting"
    ? t("waiting")
    : app.tab === "chats"
      ? (app.thread?.chat?.title || t("chats"))
      : t("hierarchy");
  let side;
  if (app.layout === "phone") {
    const issues = trackDisclosure(app, element(document, "details", { class: "phone-issues", "data-phone-issues": "true" }), "phone-issues");
    issues.append(element(document, "summary", { text: cardinal(app.language, "issueCount", issueItems.length) }));
    for (const issue of issueItems) issues.append(element(document, "p", { class: "issue", text: issue.message }));
    if (!issueItems.length) issues.append(emptyIssues(app, document, t));
    side = element(document, "aside", { class: "panel side" },
      element(document, "h2", { "data-phone-title": "true", text: phoneTitle }),
      issues,
      collection,
    );
  } else {
    const issues = element(document, "section", { class: "summary" }, element(document, "h2", { text: t("issuesTitle") }));
    for (const issue of issueItems) issues.append(element(document, "p", { class: "issue", text: issue.message }));
    if (!issueItems.length) issues.append(emptyIssues(app, document, t));
    side = element(document, "aside", { class: `panel side${app.catalogOpen ? " is-open" : ""}` }, tabs, summary, issues, collection);
  }
  const selected = app.store.indexes.units.get(app.store.selected.unitId)
    ?? app.unitList?.catalog?.find((unit) => unit.id === app.store.selected.unitId)
    ?? null;
  const stageTitle = app.layout === "phone" ? phoneTitle : t(app.mode);
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
  const group = app.store.indexes.groups.get(app.store.selected.groupId);
  const selection = [...(app.mapState?.selection ?? [])].map((id) => unitById(app, id)).filter((unit) => unit && unit.role !== "master");
  const inspectorBody = element(document, "div", { class: "inspector-body" });
  if (outcomeVisible(app) && app.actionScope !== "editor") {
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
  if (app.layout !== "phone" && group && !group.deleted) {
    inspectorBody.append(groupInspector(app, t, group), chatPanel(app, t));
  } else if (app.layout !== "phone" && selection.length > 1) {
    inspectorBody.append(selectionInspector(app, t, selection));
  } else {
    const heading = element(document, "h2", { text: selected ? unitDisplayName(selected) : t("nothingSelected") });
    if (selected) heading.replaceChildren(unitNameNode(document, selected), element(document, "span", { class: "unit-state", text: t(statusKey(selected.status)) }));
    inspectorBody.append(heading, actionControls(app, t, selected));
    if (app.layout !== "phone") {
      if (!selected && !app.thread?.chat) inspectorBody.append(emptySelection(app, t));
      inspectorBody.append(chatPanel(app, t), renderInspector(app, t, selected));
    }
  }
  if (app.mapToast) inspectorBody.append(mapToast(app, t));
  const inspector = element(document, "aside", {
    class: `panel inspector${app.inspectorOpen ? " is-open" : ""}`,
  }, inspectorBody);
  const phoneHierarchy = app.layout === "phone" && app.mode !== "waiting" && app.tab !== "chats";
  const showSide = app.layout !== "phone" || app.mode !== "waiting";
  return element(document, "div", { class: "workspace" }, showSide ? side : null, phoneHierarchy ? null : stage, inspector);
}

function skeletonPanel(document, name, sizes) {
  const panel = element(document, "aside", { class: `panel ${name} opening-skeletons`, "aria-hidden": "true" });
  for (const [width, height = 14] of sizes) {
    const block = element(document, "div", { class: "opening-skeleton" });
    block.style.width = `${width}px`;
    block.style.height = `${height}px`;
    panel.append(block);
  }
  return panel;
}

function openingWorkspace(app, t) {
  const document = app.root.ownerDocument;
  const failed = app.bootFailed;
  const content = element(document, "div", { class: `opening-content${failed ? " opening-failure" : ""}` });
  if (failed) {
    content.append(element(document, "div", { class: "opening-error-icon" }, icon(document, "alert")));
    content.append(element(document, "h2", { text: openingText(app, "failure") }));
    const path = app.selectedFolder || "M1ND";
    const cause = app.bootError?.code === "timeout" ? openingText(app, "timeout", { path }) : `${path}: ${safeOpeningCause(app)}`;
    content.append(element(document, "p", { "data-opening-cause": "true", text: cause }));
    const actions = element(document, "div", { class: "opening-actions" },
      element(document, "button", { type: "button", class: "btn primary", "data-action": "retry-boot", text: t("retry"), onclick: () => resumeBoot(app) }),
      element(document, "button", { type: "button", class: "btn", "data-action": "choose-folder", text: openingText(app, "chooseFolder"), onclick: () => chooseOpeningFolder(app) }),
    );
    content.append(actions);
  } else {
    content.append(element(document, "span", { class: "spinner", "aria-hidden": "true" }));
    content.append(element(document, "h2", { text: openingText(app, "reading") }));
    const counts = app.store.view?.counts;
    if (counts) content.append(element(document, "p", { class: "opening-counts", text: openingText(app, "counts", { units: counts.units ?? 0, groups: app.store.view.groups?.length ?? 0, chats: counts.chats ?? 0, boards: app.store.view.editors?.filter((editor) => editor.kind === "blueprint").length ?? 0 }) }));
  }
  return element(document, "div", { class: "workspace workspace-opening" },
    skeletonPanel(document, "side", [[200, 30], [230, 34], ...[150, 190, 120, 170, 140, 180, 110].map((width) => [width])]),
    element(document, "section", { class: "panel stage opening-stage", "aria-busy": String(!failed) }, content),
    skeletonPanel(document, "inspector", [[220, 38], [300, 70], ...[260, 200, 240].map((width) => [width, 44])]),
  );
}

function safeOpeningCause(app) {
  let cause = String(app.bootError?.message || text(app.language, "unavailable"));
  for (const secret of [app.api.token, app.api.homeKey]) if (secret) cause = cause.split(secret).join("[redacted]");
  return cause.replace(/Bearer\s+\S+|(?:session|home|token|secret|password)=[^\s&]+/gi, "[redacted]");
}

function openingFooter(app) {
  const document = app.root.ownerDocument;
  const machine = app.store.settings?.service?.machine;
  return element(document, "footer", { class: "foot" },
    element(document, "span", { text: machine ? text(app.language, "serviceRunning", { machine }) : openingText(app, "connecting") }),
    element(document, "span", { text: openingText(app, app.bootFailed ? "notRead" : "read") }),
  );
}

async function chooseOpeningFolder(app) {
  if (app.folderChoosing) return;
  app.folderChoosing = true;
  try {
    if (app.chooseFolder) await app.chooseFolder({ mindPath: app.selectedFolder });
    else {
      // A second setup window keeps the current host, credential and drafts alive.
      const window = app.root.ownerDocument.defaultView?.open?.("", "_blank");
      if (!window) throw new ApiError(0, "folder_unavailable", text(app.language, "folderUnavailable"));
      try {
        window.opener = null;
        const result = await request(app.api, "POST", "/viewer/folder", { body: {} });
        const target = new URL(result.data.url);
        if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.pathname !== "/" || target.username || target.password || target.search) throw new ApiError(0, "invalid_url", text(app.language, "folderUnavailable"));
        window.location.replace(target.href);
      } catch (error) {
        window.close();
        throw error;
      }
    }
  } catch (error) {
    app.bootError = error;
    renderFailure(app, error);
  } finally {
    app.folderChoosing = false;
  }
}

function emptyMind(app) {
  if (app.layout !== "desktop" || !app.store.snapshotReady || !app.store.capabilities.includes("unit.create")) return false;
  const units = app.unitList?.catalog ?? [...app.store.indexes.units.values()];
  return units.length === 1 && units[0].id === "root:master";
}

function emptyWorkspace(app, t) {
  const document = app.root.ownerDocument;
  const tabs = element(document, "div", { class: "tabs" });
  for (const tab of ["hierarchy", "chats"]) tabs.append(element(document, "button", { type: "button", class: "tab", "aria-pressed": String(app.tab === tab), onclick: () => navigate(app, tab) }, icon(document, tab), t(tab)));
  const search = element(document, "input", { type: "search", class: "search", "aria-label": t("search"), placeholder: t("search") });
  const side = element(document, "aside", { class: "panel side" }, tabs, search,
    element(document, "div", { class: "empty-side" }, element(document, "h2", { text: openingText(app, "noUnits") }), element(document, "p", { text: openingText(app, "first") })),
  );
  const master = element(document, "div", { class: "empty-master", "data-unit": "root:master" }, icon(document, "person"), element(document, "span", { class: "map-label", text: t("person") }));
  const stage = element(document, "section", { class: "panel stage empty-stage" }, master,
    element(document, "div", { class: "empty-overseer", "aria-hidden": "true" }),
    element(document, "p", { class: "empty-placeholder", text: openingText(app, "goesHere") }),
  );
  const create = element(document, "button", { type: "button", class: "btn primary", "data-action": "create-overseer", text: openingText(app, "create"), onclick: () => openUnitForm(app, true) });
  create.disabled = Boolean(app.overseerCreating);
  if (app.overseerCreating) create.replaceChildren(progressMark(document, openingText(app, "create")));
  const inspector = element(document, "aside", { class: "panel inspector empty-inspector" }, icon(document, "crown"),
    element(document, "h2", { text: openingText(app, "empty") }),
    element(document, "p", { text: openingText(app, "coordinates") }), create,
  );
  if (app.overseerError) inspector.append(element(document, "p", { role: "alert", text: actionText(app.language, app.overseerError.code, { machine: app.overseerError.details?.machine ?? app.store.settings?.service?.machine ?? "" }) }));
  return element(document, "div", { class: "workspace workspace-empty" }, side, stage, inspector);
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
  app.waitingOpen = !(app.mode === "map" && app.waitingOpen === true);
  if (app.waitingOpen) app.mode = "map";
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
  if (!items.length && list.status !== "loading") {
    const emptyText = (key) => t(app.layout === "phone" && key === "emptyWaitingNext" ? "phoneNavHint" : key);
    surface.append(renderWaiting(document, [], emptyText, (item) => openWaitingItem(app, item), showMapButton(app, document, t)));
  } else if (items.length) {
    const visible = items.slice(range.start, range.end);
    if (visible.length) surface.append(renderWaiting(document, visible, t, (item) => openWaitingItem(app, item)));
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
  const status = list.status === "error" ? t("listError") : list.status === "loading" ? t("loadingList") : list.status === "empty" ? (list.query ? t("emptySearch") : emptyCollectionText(t, list.name)) : t("listTotal", { count: formatNumber(app.language, list.total ?? 0) });
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
    selectedId: app.tab === "chats" ? app.store.selected.chatId : app.store.selected.groupId ? `personal:${app.store.selected.groupId}` : app.store.selected.unitId,
    onActivate: (row, kind) => {
      if (row.kind === "personal") {
        selectGroup(app, row.groupId);
        if (kind !== "double") toggleGroup(app.hierarchy, row.id);
      } else if (row.kind === "chat") {
        app.store.selected.chatId = row.id;
        app.activated = { id: row.id, kind };
      } else if (row.unit) {
        if (app.layout !== "phone") {
          if (kind === "single" && app.lastUnitClick?.id === row.unit.id && app.api.now() - app.lastUnitClick.at < 500) kind = "double";
          app.lastUnitClick = kind === "single" ? { id: row.unit.id, at: app.api.now() } : null;
        }
        activateUnit(app, row.unit, kind);
        if (app.layout !== "phone" && app.tab === "hierarchy") app.pendingChat = { unitId: row.unit.id, create: true };
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
  if (app.tab === "chats" && app.layout !== "phone") {
    block.append(element(document, "button", { type: "button", class: "btn", "data-action": "archived-chats", "aria-pressed": String(Boolean(app.archivedChats)), text: t("finalArchived"), onclick: () => {
      app.archivedChats = !app.archivedChats;
      list.filters = app.archivedChats ? { archived: "true" } : { listed: "true" };
      reloadList(list);
    } }));
  }
  if (list.status === "empty" && list.query) block.append(clearSearchButton(document, t, list));
  if (list.status === "empty" && !list.query) {
    const next = emptyCollectionAction(app, document, t, list);
    if (next) block.append(next);
  }
  return block;
}

function emptyIssues(app, document, t) {
  const block = element(document, "div");
  block.append(element(document, "p", { "data-empty": "issues", text: t("emptyIssues") }));
  if (app.unitList) {
    block.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "refresh-issues",
      text: t("refreshList"),
      onclick: () => reloadList(app.unitList),
    }));
  }
  return block;
}

function showMapButton(app, document, t) {
  return element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "show-map",
    text: t(app.layout === "phone" ? "hierarchy" : "showMap"),
    onclick: () => navigate(app, "hierarchy"),
  });
}

function clearSearchButton(document, t, list) {
  return element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "clear-search",
    text: t("clearSearch"),
    onclick: () => setQuery(list, ""),
  });
}

function emptyCollectionText(t, name) {
  if (name === "chats") return t("emptyChats");
  if (name === "waiting") return t("emptyWaiting");
  if (name === "units") return t("emptyUnits");
  return t("emptyCollection");
}

function emptyCollectionAction(app, document, t, list) {
  if (list.name === "units" || (list.name !== "chats" && list.name !== "waiting")) {
    return element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "refresh-list",
      text: t("refreshList"),
      onclick: () => reloadList(list),
    });
  }
  return showMapButton(app, document, t);
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
  }, (error) => noteEditor(app, error, `catalog:${kind}`));
}

function boardSurface(app, document, editor, t) {
  const host = element(document, "div", { class: "board-host" });
  editor.focus = app.editors.focus;
  editor.viewport = app.editors.viewport;
  editor.panned = app.editors.panned === true;
  renderBoard(document, host, editor);
  const choose = (target) => chooseBoardTarget(app, editor, target);
  host.addEventListener("click", (event) => {
    if (event.target?.closest?.("[data-toolbar='board']")) return;
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
  const tools = element(document, "div", { class: "toolbar board-toolbar", role: "toolbar", "aria-label": t("boards"), "data-toolbar": "board" });
  const name = element(document, "input", { "data-node-name": "true", "data-keep": keepId("node", editor.resourceId) });
  name.value = draftMap(app, "nodes").get(editor.resourceId) ?? "";
  name.addEventListener("input", () => {
    editor.nodeDraft = name.value;
    rememberFormDraft(app, "nodes", editor.resourceId, name.value);
  });
  const selectedNode = app.editors.selectedNodeId;
  tools.append(element(document, "button", {
    type: "button", class: "btn primary", "data-action": "add-node",
    onclick: () => addBoardShape(app, editor, nodes),
  }, t("addShape")));
  tools.append(labeledField(document, t("nodeName"), t("nodeNameHint"), name));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "patch-node",
    disabled: selectedNode ? null : "",
    "aria-describedby": selectedNode ? null : "reason-node",
    onclick: () => {
      const saved = name.value;
      const nodeId = app.editors.selectedNodeId;
      if (!nodeId) return;
      editorAct(app, `node:${editor.resourceId}:${nodeId}`, text(app.language, "nodeName"), async (record) => {
        await patchNode(app.api, editor, nodeId, { name: saved, value: saved }, record.operation);
        if (draftMap(app, "nodes").get(editor.resourceId) === saved) editor.nodeDraft = "";
        releaseFormDraft(app, "nodes", editor.resourceId, saved);
      });
    },
  }, t("nodeName")));
  tools.append(element(document, "button", {
    type: "button", class: "btn", "data-action": "remove-node",
    disabled: selectedNode ? null : "",
    "aria-describedby": selectedNode ? null : "reason-node",
    onclick: () => {
      const nodeId = app.editors.selectedNodeId;
      if (!nodeId) return;
      editorAct(app, `node-remove:${editor.resourceId}:${nodeId}`, text(app.language, "removeShape"), async (record) => {
        await removeNode(app.api, editor, nodeId, record.operation);
      });
    },
  }, t("removeShape")));
  if (!selectedNode) tools.append(element(document, "p", { id: "reason-node", class: "field-hint", "data-disabled-reason": "node", text: t("selectNode") }));
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
  if (canEditResources(app)) appendStructureTools(app, document, editor, t, tools);
  host.append(tools, boardOutline(app, document, editor, t));
  for (const issue of editor.assetIssues ?? []) {
    host.append(element(document, "p", { "data-asset-issue": issue.code, text: t("assetMissing") }));
  }
  return host;
}

function addBoardShape(app, editor, screen) {
  const key = `shape:${editor.resourceId}`;
  if (activityPending(app, key)) return app.activity.get(key).promise;
  const node = { id: `added-${operationId()}`, name: "Added", t: "box", place: { x: 16, y: 16 }, w: 40, h: 40, dir: "stack", kids: [] };
  return editorAct(app, key, text(app.language, "addShape"), async (record) => {
    await addNode(app.api, editor, {
      screenId: screen.id,
      parentId: screen.root.id,
      node,
    }, record.operation);
  });
}

function addImageNode(app, editor, screen, asset) {
  const nodeId = `image-${operationId()}`;
  return editorAct(app, `image:${editor.resourceId}:${asset.src}`, text(app.language, "working"), async (record) => {
    await addNode(app.api, editor, {
      screenId: screen.id,
      parentId: screen.root.id,
      node: { id: nodeId, name: "Image", t: "image", place: { x: 20, y: 48 }, w: 32, h: 32, src: asset.src },
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
  const sourceEdit = trackDisclosure(app, element(document, "details", { class: "source-edit", "data-source-edit": "true" }), keepId("source-edit", editor.resourceId, editor.page, lang));
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
  if (outcomeVisible(app) && app.actionScope === "editor") {
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
  else if (editors.loadedKind === kind && (editors.catalog?.length ?? 0) === 0) {
    const editable = canEditResources(app);
    const emptyKey = kind === "blueprint"
      ? (editable ? "emptyBoards" : "emptyBoardsRead")
      : (editable ? "emptyTexts" : "emptyTextsRead");
    catalog.append(element(document, "p", { "data-empty": kind, text: t(emptyKey) }));
    catalog.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "refresh-catalog",
      text: t("refreshList"),
      onclick: () => {
        editors.loadedKind = null;
        queueCatalog(app, kind);
      },
    }));
  }
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
  if (!(current.threads?.length)) {
    comments.append(element(document, "p", {
      "data-empty": "comments",
      text: t(current.kind === "void" ? "emptyCommentsText" : "emptyCommentsBoard"),
    }));
  }
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
  const commentField = labeledField(document, t("comment"), t(commentHintKey(app)), compose);
  commentButton.setAttribute("aria-describedby", compose.getAttribute("aria-describedby"));
  if (!commentCanSubmit(app, compose.value)) {
    const reason = element(document, "p", {
      id: "reason-comment",
      class: "field-hint",
      "data-disabled-reason": "comment",
      text: currentCommentAnchor(app) ? t("commentNeedsText") : t(commentMissingKey(app)),
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
  return editorAct(app, `attach:${editors.current?.resourceId ?? "none"}`, text(app.language, "attach"), async (record) => {
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

function commentHintKey(app) {
  return app.editors?.current?.kind === "void" ? "commentHintText" : "commentHint";
}

function commentMissingKey(app) {
  return app.editors?.current?.kind === "void" ? "quoteNeedsSelection" : "commentNeedsTarget";
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
    explain(app, anchor ? "commentNeedsText" : commentMissingKey(app));
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

function noteEditor(app, error, key = null) {
  if (app.editors) app.editors.error = error;
  noteAction(app, error, key);
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
  const confirm = element(document, "button", {
    type: "button",
    class: "btn primary",
    "data-action": "save-attachments",
    text: text(app.language, "attach"),
  });
  confirm.addEventListener("click", async () => {
    if (confirm.getAttribute("aria-busy") === "true") return;
    setBusy(confirm, true);
    form.querySelector("[data-dialog-error]")?.remove();
    form.querySelector("[data-attach-progress]")?.remove();
    form.append(progressMark(document, text(app.language, "attaching"), { "data-attach-progress": "true" }));
    const resourceId = current.resourceId;
    await saveAttachments(app);
    form.querySelector("[data-attach-progress]")?.remove();
    const record = app.activity?.get(`attach:${resourceId}`);
    if (record?.phase === "error") {
      setBusy(confirm, false);
      confirm.replaceChildren();
      confirm.append(document.createTextNode(text(app.language, "retry")));
      const note = element(document, "p", {
        class: "action-note",
        "data-dialog-error": "true",
        role: "alert",
        text: activityMessage(app, record),
      });
      if (record.error?.code) note.setAttribute("data-code", record.error.code);
      form.append(note);
      return;
    }
    dialog.close();
  });
  form.append(heading, search, list, confirm, element(document, "button", {
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

function appendStructureTools(app, document, editor, t, tools) {
  syncStructureDraft(app, editor);
  const board = editor.authoritative?.document;
  if (!board || editor.authoritative.readOnly) return;
  tools.setAttribute("data-structure", "true");
  const canMovePage = (board.pages?.length ?? 0) >= 2;
  const canMoveScreen = (board.pages ?? []).some((page) => (page.order?.length ?? 0) >= 2);
  const canLink = (board.screens?.length ?? 0) >= 2;
  tools.append(...[
    editorField(document, app, t, "width", "screenWidth", "screen-width"),
    editorField(document, app, t, "height", "screenHeight", "screen-height"),
    element(document, "button", { type: "button", class: "btn", "data-action": "resize-screen", onclick: () => resizeBoard(app, editor) }, t("resizeScreen")),
    element(document, "button", { type: "button", class: "btn", "data-action": "move-page", disabled: canMovePage ? null : "", "aria-describedby": canMovePage ? null : "reason-move-page", onclick: () => moveBoardPage(app, editor) }, t("movePage")),
    canMovePage ? null : element(document, "p", { id: "reason-move-page", class: "field-hint", "data-disabled-reason": "move-page", text: t("needTwoPages") }),
    element(document, "button", { type: "button", class: "btn", "data-action": "move-screen", disabled: canMoveScreen ? null : "", "aria-describedby": canMoveScreen ? null : "reason-move-screen", onclick: () => moveBoardScreen(app, editor) }, t("moveScreen")),
    canMoveScreen ? null : element(document, "p", { id: "reason-move-screen", class: "field-hint", "data-disabled-reason": "move-screen", text: t("needTwoScreens") }),
    element(document, "button", { type: "button", class: "btn", "data-action": "add-link", disabled: canLink ? null : "", "aria-describedby": canLink ? null : "reason-add-link", onclick: () => addBoardLink(app, editor) }, t("addLink")),
    canLink ? null : element(document, "p", { id: "reason-add-link", class: "field-hint", "data-disabled-reason": "add-link", text: t("needLinkScreens") }),
  ].filter(child => child != null));
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
    const placed = createMap({ units, saved: { nodes: app.mapState.positions, groups: app.mapState.saved.groups } });
    for (const unit of units) if (!app.mapState.positions[unit.id]) app.mapState.positions[unit.id] = placed.positions[unit.id];
  }
  app.mapState.api = app.api;
  app.mapState.groups = [...app.store.indexes.groups.values()];
  app.mapState.selectedGroupId = app.store.selected.groupId;
  app.mapState.persist = Boolean(app.store.capabilities?.includes("layout.write"));
  app.mapState.onSelect = (id) => {
    app.store.selected.groupId = null;
    app.store.selected.unitId = app.mapState.selection.size === 1 ? id : null;
    if (app.store.selected.unitId) {
      loadInspector(app, id);
      app.pendingChat = { unitId: id, create: true };
    }
    if (!app.disposed) renderShell(app);
  };
  app.mapState.onSelection = (ids) => {
    app.store.selected.groupId = null;
    app.store.selected.unitId = ids.length === 1 ? ids[0] : null;
    if (ids.length === 1) {
      app.pendingChat = { unitId: ids[0], create: true };
      loadInspector(app, ids[0]);
    } else app.thread = null;
    renderShell(app);
  };
  app.mapState.onPersonalGroup = (id) => selectGroup(app, id);
  app.mapState.onRename = (id) => beginAlias(app, id);
  app.mapState.onConnect = (pending) => confirmConnection(app, pending.source, [pending.target]);
  app.mapState.onGroupConnect = () => chooseSelectionLead(app);
  app.mapState.onGroupMessage = (ids) => {
    settle(app, "group-chat", text(app.language, "loadingConversation"), async (record) => {
      const result = await openGroupChat(app.api, ids, undefined, record.operation);
      app.mapState.selection.clear();
      app.store.selected.unitId = null;
      app.store.selected.groupId = null;
      app.store.selected.chatId = result.data.id;
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
  decorateHierarchy(app, host);
  const view = app.root.ownerDocument.defaultView;
  if (!host.clientHeight && view?.requestAnimationFrame) {
    view.requestAnimationFrame(() => {
      if (app.disposed || !host.isConnected) return;
      renderWindow(app.root.ownerDocument, host, app.activeList, app.activeRows ?? [], app.activeHandlers ?? {});
      decorateHierarchy(app, host);
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
  const tree = buildHierarchy(source, list.issues, [...app.store.indexes.groups.values()]);
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
  let saved = null;
  let viewerOperation = null;
  return track(app, "settings", text(app.language, "savingSetting"), async (record) => {
    try {
      if (!saved) {
        const retained = await reuseOrReconcile(app, record, "PATCH", "/settings", (operation) => sameSettingsChoice(operation, patch));
        const revision = app.store.settings?.revision ?? null;
        saved = await saveSettings(app.api, revision, patch, retained);
        record.operation = saved.operation;
        applySettingsResult(app, saved);
      }
      const overrides = Object.fromEntries(Object.keys(patch)
        .filter(key => app.store.viewer?.[key] != null)
        .map(key => [key, null]));
      if (viewerOperation || Object.keys(overrides).length > 0) {
        viewerOperation ??= createOperation({ method: "PATCH", path: "/viewer", body: overrides });
        await patchOwnViewer(app, overrides, viewerOperation);
      }
      return saved;
    } catch (error) {
      if (saved && viewerOperation) error.operation = saved.operation;
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
  }).catch((error) => noteAction(app, error, "settings"));
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
  return track(app, key, label, work, onError).catch((error) => {
    if (onError) onError(error);
    else noteAction(app, error, key);
  });
}

function track(app, key, label, work, onError = null) {
  if (!app.activity) app.activity = new Map();
  return runAction(app.activity, key, {
    label,
    work,
    render(record) {
      record.action = label;
      if (!record.scope) record.scope = noteScope(app);
      if (record.phase === "success") clearMatchedError(app, key);
      record.retry = () => track(app, key, label, work, onError).catch((error) => {
        if (onError) onError(error);
        else noteAction(app, error, key);
      });
      const paint = () => {
        if (!app.disposed && app.layout !== "unknown") renderShell(app);
      };
      if (app.rendering) queueMicrotask(paint);
      else paint();
    },
  });
}

function activityMessage(app, record) {
  const action = record?.action || record?.label || text(app.language, "actionFailed");
  const code = record?.error?.code;
  const known = Boolean(code && Object.hasOwn(ACTION_COPY, code));
  const cause = known ? `${actionText(app.language, code, { machine: record.error?.details?.machine ?? "" })} ` : "";
  return text(app.language, "activityFailed", { action, cause });
}

function editorAct(app, key, label, work) {
  return settle(app, key, label, work, (error) => noteEditor(app, error, key));
}

function activityPending(app, key) {
  return app.activity?.get(key)?.phase === "pending";
}

function paintActivity(app, shell) {
  const here = noteScope(app);
  const records = [...(app.activity?.values() ?? [])].filter((record) => (record.scope ?? here) === here);
  const pending = records.filter((record) => record.phase === "pending");
  const failed = records.filter((record) => record.phase === "error");
  if (!pending.length && !failed.length) return;
  const document = app.root.ownerDocument;
  const region = element(document, "div", { class: "activity", "aria-live": "polite", "data-activity-region": "true" });
  if (pending.length) shell.setAttribute("aria-busy", "true");
  for (const record of pending) region.append(progressMark(document, record.label, { "data-activity": record.key }));
  for (const record of failed) {
    region.append(element(document, "p", { "data-activity": record.key, text: activityMessage(app, record) }));
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
    if (stream.error === "reconnect_exhausted") footer.append(element(document, "p", { "data-stream": "stopped", text: t("streamStopped") }));
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
  releaseBootstrapAnnouncement(app);
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
  if (app.layout !== "phone" && app.api.token) {
    app.bootFailed = true;
    app.bootError = error;
    renderShell(app);
    releaseBootstrapAnnouncement(app, openingText(app, "failure"));
    return;
  }
  const document = app.root.ownerDocument;
  const key = error?.status === 401 || error?.status === 410 ? "sessionExpired" : "unavailable";
  const message = text(app.language, key);
  app.root.replaceChildren(element(document, "section", { class: "gate" },
    element(document, "h2", { text: message }),
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
  releaseBootstrapAnnouncement(app, message);
}

const BOOTSTRAP_ANNOUNCEMENTS = new Set(["Loading.", "Cargando.", "Reading the M1ND.", "Leyendo el M1ND."]);

function renderStatus(app, key) {
  if (app.api.token && app.layout !== "phone") {
    app.bootReading = true;
    app.bootstrapAnnouncement = openingText(app, "reading");
    renderShell(app);
    ensureLive(app);
    app.liveStatus.textContent = app.bootstrapAnnouncement;
    app.liveError.textContent = "";
    return;
  }
  const document = app.root.ownerDocument;
  const label = text(app.language, key);
  app.bootstrapAnnouncement = label;
  app.root.replaceChildren(element(document, "p", { id: "status", role: "status" }, progressMark(document, label)));
  ensureLive(app);
  app.liveStatus.textContent = label;
  app.liveError.textContent = "";
}

function releaseBootstrapAnnouncement(app, failureText = null) {
  ensureLive(app);
  const status = app.liveStatus?.textContent ?? "";
  if (BOOTSTRAP_ANNOUNCEMENTS.has(status) || (app.bootstrapAnnouncement && status === app.bootstrapAnnouncement)) {
    app.liveStatus.textContent = "";
  }
  app.bootstrapAnnouncement = null;
  if (failureText != null && app.liveError) app.liveError.textContent = failureText;
}

function viewTitle(app, t) {
  if (app.mode === "waiting") return t("waiting");
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

function outcomeVisible(app) {
  if (!app.actionNote) return false;
  return (app.actionScope ?? noteScope(app)) === noteScope(app);
}

function releaseSettledAction(app) {
  const chatId = app.thread?.chat?.id;
  const chatFailed = (app.thread?.messages ?? []).some((message) => message.failed);
  if (chatId && app.thread.error == null && !chatFailed && app.actionKey === `chat:${chatId}`) {
    clearMatchedError(app, `chat:${chatId}`);
  }
  const mailboxId = app.mailbox?.unitId;
  if (mailboxId && !app.mailbox.pending && app.mailbox.optimistic?.failed !== true && app.actionKey === `mailbox:${mailboxId}`) {
    clearMatchedError(app, `mailbox:${mailboxId}`);
  }
}

function syncLiveRegions(app) {
  releaseSettledAction(app);
  ensureLive(app);
  app.liveStatus.textContent = "";
  app.liveError.textContent = "";
  if (!outcomeVisible(app)) return;
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
  timeout: "requestTimeout",
  service_unavailable: "unavailable",
  mind_unavailable: "mindUnavailable",
  internal_error: "internalError",
  request_rate_limited: "requestLimited",
  message_rate_limited: "requestLimited",
  sync_rate_limited: "requestLimited",
  auth_rate_limited: "requestLimited",
  not_found: "missingRecord",
  invalid_body: "rejectedRequest",
  invalid_json: "rejectedRequest",
  unknown_field: "rejectedRequest",
  invalid_query: "rejectedRequest",
  invalid_cursor: "rejectedRequest",
  invalid_host: "rejectedRequest",
  invalid_path: "rejectedRequest",
  invalid_response: "rejectedRequest",
  method_not_allowed: "rejectedRequest",
  unsupported_media_type: "rejectedRequest",
  uri_too_long: "rejectedRequest",
  invalid_session: "sessionInvalid",
  invalid_origin: "actionForbidden",
  loopback_only: "actionForbidden",
  peer_not_allowed: "actionForbidden",
  not_attached: "actionForbidden",
  home_expired: "homeExpired",
  approval_expired: "approvalExpired",
  body_too_large: "tooLarge",
  message_too_large: "tooLarge",
  view_too_large: "tooLarge",
  resource_too_large: "tooLarge",
  pack_too_large: "tooLarge",
};

const TASK_COPY = {
  open: "taskOpen",
  review: "taskReview",
  done: "taskDone",
  closed: "taskClosed",
};

function showOutcome(app, note, code = null, tone = "status", scope = null, key = null) {
  app.actionNote = note;
  app.actionCode = code;
  app.actionTone = tone;
  app.actionScope = scope ?? noteScope(app);
  app.actionKey = key;
}

function clearMatchedError(app, key) {
  if (!key || app.actionTone !== "error" || app.actionKey !== key) return;
  app.actionNote = null;
  app.actionCode = null;
  app.actionTone = null;
  app.actionScope = null;
  app.actionKey = null;
}

function noteScope(app) {
  if (app.mode === "blueprint" || app.mode === "document" || app.mode === "focus") return "editor";
  if (app.mode === "settings") return "settings";
  return "unit";
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
    const machine = app.inspectorData?.unitId === selected.id ? app.inspectorData.machines?.find((item) => item.id === selected.machine) : null;
    const offline = machine?.answers === false;
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "start-session", text: t("startSession"), disabled: offline ? "" : null, "aria-describedby": offline ? "reason-session-machine" : null, onclick: () => openSessionForm(app, selected) }));
    if (offline) row.append(element(document, "p", { class: "field-hint", id: "reason-session-machine", "data-disabled-reason": "machine", text: t("finalNeedsOnline", { machine: selected.machine }) }));
  }
  if (selected && caps.includes("unit.create") && app.layout !== "phone") row.append(unitMenu(app, selected));
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

function unitNameNode(document, unit) {
  const name = element(document, "span", { class: "unit-name" });
  if (unit.alias) name.append(element(document, "strong", { class: "unit-alias", text: unit.alias }));
  name.append(element(document, "span", { class: "unit-original", text: unit.unit }));
  return name;
}

function folderIcon(document, plus = false) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", `M3 7V4h7l2 3h9v13H3z${plus ? "M12 11v6M9 14h6" : ""}`);
  svg.append(path);
  return svg;
}

function mapButton(app, action, label, onClick, attributes = {}) {
  return element(app.root.ownerDocument, "button", { type: "button", class: "btn", "data-action": action, text: label, onclick: onClick, ...attributes });
}

function decorateHierarchy(app, host) {
  const document = host.ownerDocument;
  const t = (key, variables) => text(app.language, key, variables);
  const decorate = () => {
    for (const node of host.querySelectorAll("[data-row]")) {
      const row = app.activeRows?.find((item) => item.id === node.getAttribute("data-id"));
      if (!row) continue;
      if (row.unit) {
        node.setAttribute("aria-label", row.text);
        node.style.paddingLeft = `${8 + (row.personalMember ? 24 : row.depth * 14)}px`;
        node.replaceChildren(unitNameNode(document, row.unit), element(document, "i", { class: "map-status row-status", "data-status": row.unit.status, role: "img", "aria-label": t(statusKey(row.unit.status)) }));
        if (app.aliasEdit?.rowId === row.id) {
          const editor = aliasField(app, row.unit);
          if (host.insertBefore) host.insertBefore(editor, node);
          else {
            editor.parent = host;
            editor.parentNode = host;
            host.children.splice(host.children.indexOf(node), 0, editor);
          }
          node.remove();
        }
      } else if (row.kind === "personal") {
        node.setAttribute("data-personal-folder", row.groupId);
        node.setAttribute("aria-expanded", String(row.expanded));
        node.replaceChildren(element(document, "span", { "aria-hidden": "true", text: row.expanded ? "⌄" : "›" }), folderIcon(document), element(document, "span", { class: "group-title", text: row.label }), element(document, "span", { class: "group-count", text: row.count }));
      } else if (row.id === "section:personal") {
        const heading = element(document, "div", { class: "my-groups-heading", "data-my-groups": "true" }, element(document, "span", { text: t("myGroups") }));
        if (app.layout !== "phone" && app.store.capabilities.includes("chat.manage")) {
          const add = mapButton(app, "new-group", t("newGroup"), () => openGroupForm(app), { class: "icon-button", "aria-label": t("newGroup"), title: t("newGroup") });
          add.replaceChildren(folderIcon(document, true));
          heading.append(add);
        }
        if (host.insertBefore) host.insertBefore(heading, node);
        else { heading.parent = host; heading.parentNode = host; host.children.splice(host.children.indexOf(node), 0, heading); }
        node.remove();
      }
    }
  };
  decorate();
  // The shared virtual list replaces rows when it scrolls or moves focus.
  host.addEventListener("scroll", decorate);
  host.addEventListener("keydown", (event) => {
    decorate();
    const row = app.activeRows?.find((item) => item.id === app.activeList.focusId);
    if (row?.kind === "personal" && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      if (event.key === "ArrowLeft") app.hierarchy.collapsed.add(row.id);
      else app.hierarchy.collapsed.delete(row.id);
      event.preventDefault?.();
      renderShell(app);
    }
  });
  if (app.aliasEdit?.focus) {
    const input = host.querySelector("[data-alias-input]");
    input?.focus?.();
    input?.setSelectionRange?.(input.value.length, input.value.length);
    app.aliasEdit.focus = false;
  }
}

function beginAlias(app, id, rowId = null) {
  if (app.layout === "phone" || !app.store.capabilities.includes("unit.create")) return;
  const unit = unitById(app, id);
  if (!unit?.revision) return;
  app.tab = "hierarchy";
  app.store.selected.unitId = id;
  app.store.selected.groupId = null;
  ensureMap(app).selection = new Set([id]);
  if (unit.leadId) app.hierarchy.collapsed.delete(`lead:${unit.leadId}`);
  if (unit.scope.kind === "project") app.hierarchy.collapsed.delete(`project:${unit.scope.name}`);
  if (unit.scope.kind === "environment") app.hierarchy.collapsed.delete(`env:${unit.scope.name}`);
  const rows = collectionRows(app, (key, values) => text(app.language, key, values), app.unitList);
  const index = rows.findIndex((row) => rowId ? row.id === rowId : row.unit?.id === id);
  app.aliasEdit = { id, rowId: rows[index]?.id ?? id, value: unit.alias ?? "", previous: unit.alias ?? null, revision: unit.revision, focus: true };
  if (index >= 0) app.unitList.scrollTop = index * app.unitList.rowHeight;
  renderShell(app);
}

function aliasField(app, unit) {
  const edit = app.aliasEdit;
  const document = app.root.ownerDocument;
  const t = (key, variables) => text(app.language, key, variables);
  const field = element(document, "div", { class: "alias-edit", "data-alias-edit": unit.id });
  const input = element(document, "input", { "data-alias-input": unit.id, "data-keep": keepId("alias", unit.id), "aria-label": t("alias"), "aria-describedby": "alias-hint", maxlength: "128", disabled: edit.saving ? "" : null });
  input.value = edit.value;
  input.addEventListener("input", () => { edit.value = input.value; });
  input.addEventListener("keydown", (event) => {
    if (!["Enter", "Escape"].includes(event.key)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (event.key === "Escape" && !edit.saving) {
      app.aliasEdit = null;
      renderShell(app);
      focusUnitRow(app, unit.id);
    } else if (event.key === "Enter") saveAlias(app, edit);
  });
  field.append(input, mapButton(app, "save-alias", t("save"), () => saveAlias(app, edit), { disabled: edit.saving ? "" : null }), element(document, "small", { class: "unit-original", text: unit.unit }), element(document, "p", { id: "alias-hint", class: "field-hint", text: t("aliasHint", { unit: unit.unit }) }));
  if (edit.error) field.append(element(document, "p", { role: "alert", text: edit.error }));
  return field;
}

function focusUnitRow(app, id) {
  const row = app.activeRows?.find((item) => item.unit?.id === id);
  if (row) app.root.querySelector(`[data-id="${row.id}"]`)?.focus?.();
}

async function saveAlias(app, edit) {
  if (edit.saving || app.aliasEdit !== edit) return;
  const input = app.root.querySelector(`[data-alias-input="${edit.id}"]`);
  if (input) edit.value = input.value;
  if (edit.value.length > 128 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(edit.value)) {
    edit.error = text(app.language, "invalidAlias");
    edit.focus = true;
    renderShell(app);
    return;
  }
  edit.saving = true;
  edit.error = null;
  renderShell(app);
  try {
    const result = await setUnitAlias(app.api, { id: edit.id, revision: edit.revision }, edit.value.trim() || null, edit.operation);
    app.store.indexes.units.set(edit.id, result.data);
    app.aliasEdit = null;
    await reloadList(app.unitList);
    showMapToast(app, text(app.language, "aliasSaved", { unit: result.data.unit, alias: result.data.alias || result.data.unit }), async (record) => {
      const current = (await request(app.api, "GET", "/units/:unitId", { params: { unitId: edit.id } })).data;
      await setUnitAlias(app.api, current, edit.previous, record.operation);
      await reloadList(app.unitList);
    });
    renderShell(app);
    focusUnitRow(app, edit.id);
  } catch (error) {
    edit.operation = error.operation;
    edit.error = actionText(app.language, error.code);
    if (error.code === "revision_conflict") {
      try {
        const current = (await request(app.api, "GET", "/units/:unitId", { params: { unitId: edit.id } })).data;
        edit.revision = current.revision;
        edit.previous = current.alias ?? null;
        edit.operation = null;
        await reloadList(app.unitList);
      } catch (refreshError) { edit.error = actionText(app.language, refreshError.code); }
    }
    edit.saving = false;
    edit.focus = true;
    renderShell(app);
  }
}

function unitMenu(app, unit) {
  const document = app.root.ownerDocument;
  const menu = trackDisclosure(app, element(document, "details", { class: "map-menu", "data-unit-menu": unit.id }), keepId("unit-menu", unit.id));
  menu.append(element(document, "summary", { "aria-label": text(app.language, "finalMore"), title: text(app.language, "finalMore"), text: text(app.language, "finalMore") }), mapButton(app, "rename-unit", text(app.language, "rename"), () => beginAlias(app, unit.id)));
  if (unit.id !== "root:master" && unit.role !== "master") menu.append(mapButton(app, "remove-unit", removalText(app, "confirm"), () => removeSelectedUnit(app, unit)));
  return menu;
}

function removalText(app, key, unit = "") {
  const copy = {
    title: ["Remove {unit}?", "Quitar {unit}?"],
    body: ["It leaves the Map and Hierarchy. Its chat and mailbox move to Archived and its tasks stay in the project. A session running now is stopped first.", "La unidad deja de aparecer en el Mapa y la Jerarquía. El chat y el buzón pasan a Archivados; las tareas permanecen en el proyecto. Una sesión en ejecución se detiene primero."],
    confirm: ["Remove unit", "Quitar unidad"],
    archived: ["Archived", "Archivados"],
  };
  return copy[key][app.language === "es" ? 1 : 0].replace("{unit}", unit);
}

function removeSelectedUnit(app, unit) {
  if (app.pendingChat?.unitId === unit.id) app.pendingChat = null;
  let operation = null;
  const refresh = async () => {
    await loadSnapshot(app.store, app.api);
    if (app.unitList) await reloadList(app.unitList);
    if (app.chatList) await reloadList(app.chatList);
    await refreshGroups(app);
  };
  const dialog = showDialog(app.root.ownerDocument, {
    title: removalText(app, "title", unitDisplayName(unit)), body: removalText(app, "body"),
    confirm: removalText(app, "confirm"), cancel: text(app.language, "cancel"), retry: text(app.language, "retry"),
    onConfirm: async () => {
      try {
        const result = await removeUnit(app.api, unit, operation);
        if (app.pendingChat?.unitId === unit.id) app.pendingChat = null;
        app.mapState?.selection.delete(unit.id);
        app.store.selected.unitId = null;
        if (app.thread?.chat?.kind === "direct" && app.thread.chat.members.includes(unit.id)) app.thread = null;
        await refresh();
        showMapToast(app, `${unitDisplayName(unit)} · ${removalText(app, "archived")}`, async (record) => {
          await undoChange(app.api, result.data.changeId, record.operation);
          await refresh();
          app.store.selected.unitId = unit.id;
          app.mapState?.onSelection([unit.id]);
          focusUnitRow(app, unit.id);
        }, app.api.now() + Math.max(0, Date.parse(result.data.undoUntil) - Date.parse(result.meta.readAt)));
        renderShell(app);
      } catch (error) { operation = error.operation ?? operation; throw error; }
    },
  });
  dialog.setAttribute("data-remove-unit", unit.id);
  Object.assign(dialog.style, { width: "480px", maxWidth: "calc(100vw - 32px)", padding: "24px", borderRadius: "22px", background: "var(--panel)", border: "1px solid var(--line2)" });
  Object.assign(dialog.querySelector("h2").style, { fontSize: "18px", fontWeight: "700", margin: "0 0 18px" });
  Object.assign(dialog.querySelector("p").style, { fontSize: "13.5px", color: "var(--mute)", margin: "0 0 18px" });
  const buttons = dialog.querySelectorAll("button");
  for (const button of buttons) Object.assign(button.style, { minWidth: "32px", minHeight: "32px" });
  Object.assign(buttons[0].style, { background: "transparent", border: "0" });
  Object.assign(buttons[1].style, { background: "var(--error)", color: "var(--error-ink)" });
}

function selectionInspector(app, t, units) {
  const document = app.root.ownerDocument;
  const panel = element(document, "section", { class: "selection-inspector", "data-selection-count": units.length });
  panel.append(element(document, "header", { class: "selection-heading" }, element(document, "span", { class: "selection-avatar" }, icon(document, "hierarchy")), element(document, "h2", { text: t("finalSelection", { count: units.length }) }), element(document, "p", { class: "field-hint", text: t("finalSelectionHint") })));
  for (const unit of units) panel.append(element(document, "div", { class: "selection-member" }, unitNameNode(document, unit), element(document, "span", { text: t(statusKey(unit.status)) })));
  const actions = element(document, "div", { class: "selection-actions" });
  if (app.store.capabilities.includes("chat.manage")) actions.append(mapButton(app, "save-group", t("saveAsGroup"), () => openGroupForm(app, null, units.map((unit) => unit.id)), { class: "btn primary" }), mapButton(app, "message-all", t("messageAll", { count: units.length }), () => app.mapState.onGroupMessage(units.map((unit) => unit.id))));
  if (app.store.capabilities.includes("unit.connect")) actions.append(mapButton(app, "connect-lead", t("connectToLead"), () => chooseSelectionLead(app)));
  actions.append(mapButton(app, "clear-selection", t("clearSelection"), () => { app.mapState.selection.clear(); app.store.selected.unitId = null; app.thread = null; renderShell(app); }));
  panel.append(actions, element(document, "p", { class: "field-hint", text: t("finalGroupHint") }));
  return panel;
}

function chooseSelectionLead(app) {
  const ids = [...app.mapState.selection].filter((id) => unitById(app, id)?.role !== "master");
  let leadId;
  openChoiceForm(app, "selection-lead", text(app.language, "connectToLead"), (form) => {
    appendSelect(form.ownerDocument, form, "leadId", text(app.language, "finalReportsTo"), leadChoices(app).filter((unit) => !ids.includes(unit.id)).map((unit) => ({ value: unit.id, label: unitDisplayName(unit) })), "");
  }, async (form) => { leadId = fieldValue(form, "leadId"); if (!leadId) return false; return true; }, "connect-lead");
  const dialog = app.root.ownerDocument.querySelector("[data-form='selection-lead']");
  dialog?.addEventListener("close", () => { if (leadId) confirmConnection(app, leadId, ids); });
}

function emptySelection(app, t) {
  const document = app.root.ownerDocument;
  const counts = { ...app.store.view?.counts, working: [...app.store.indexes.units.values()].filter((unit) => unit.status === "working").length };
  return element(document, "section", { class: "empty-selection" }, icon(document, "map"), element(document, "p", { text: t("selectionHelp") }), ...["working", "waiting", "unread", "groups"].map((key) => element(document, "p", { text: t("mapSummary", { label: t(key === "working" ? "statusWorking" : key === "groups" ? "myGroups" : key), count: key === "groups" ? [...app.store.indexes.groups.values()].filter((group) => !group.deleted).length : counts[key] ?? 0 }) })));
}

function selectGroup(app, id) {
  const group = app.store.indexes.groups.get(id);
  if (!group || group.deleted) return;
  app.store.selected.groupId = id;
  app.store.selected.unitId = null;
  app.store.selected.chatId = group.chatId;
  const map = ensureMap(app);
  map.selectedGroupId = id;
  map.selection.clear();
  const chat = app.store.indexes.chats.get(group.chatId) ?? app.chatList?.catalog?.find((item) => item.id === group.chatId);
  if (chat && app.thread?.chat?.id !== chat.id) showChat(app, chat);
  else if (!chat) settle(app, `group-chat:${id}`, text(app.language, "loadingConversation"), async () => {
    const result = await request(app.api, "GET", "/chats/:chatId", { params: { chatId: group.chatId } });
    await showChat(app, result.data);
  });
  renderShell(app);
}

function groupInspector(app, t, group) {
  const document = app.root.ownerDocument;
  const panel = element(document, "section", { class: "group-inspector", "data-group-inspector": group.id });
  const avatars = element(document, "div", { class: "group-avatars" });
  for (const id of group.members.slice(0, 3)) avatars.append(element(document, "span", { class: "group-avatar", title: unitDisplayName(unitById(app, id)) }, icon(document, unitById(app, id)?.role === "overlord" ? "hierarchy" : "executor")));
  panel.append(element(document, "header", { class: "group-heading" }, folderIcon(document), element(document, "h2", { text: group.title }), avatars), element(document, "p", { text: t("finalGroupSummary", { count: group.members.length }) }));
  if (app.store.capabilities.includes("chat.manage")) {
    const menu = trackDisclosure(app, element(document, "details", { class: "map-menu" }, element(document, "summary", { "aria-label": t("finalMore"), title: t("finalMore"), text: t("finalMore") })), keepId("group-menu", group.id));
    menu.append(mapButton(app, "rename-group", t("rename"), () => openGroupForm(app, group)), mapButton(app, "group-members", t("members"), () => openGroupForm(app, group)), mapButton(app, "delete-group", t("deleteGroup"), () => deletePersonalGroup(app, group)));
    panel.append(menu);
  }
  panel.append(element(document, "p", { text: `${t("members")}: ${group.members.map((id) => unitDisplayName(unitById(app, id))).join(", ")}` }), element(document, "p", { text: `${t("created")}: ${formatWhen(app.language, group.createdAt)}` }));
  return panel;
}

async function refreshGroups(app) {
  const result = await collectPages(app.api, "/groups");
  app.store.indexes.groups = new Map(result.items.map((group) => [group.id, group]));
  if (app.store.view) app.store.view.groups = result.items;
  if (app.chatList) await reloadList(app.chatList);
}

function openGroupForm(app, group = null, ids = []) {
  if (app.root.ownerDocument.querySelector("[data-form='group']")) return;
  const members = new Set(group?.members ?? ids);
  let operation = null;
  openChoiceForm(app, "group", text(app.language, group ? "rename" : "newGroup"), (form, confirm) => {
    const document = form.ownerDocument;
    confirm.textContent = text(app.language, group ? "save" : "createGroup");
    form.append(element(document, "p", { class: "field-hint", text: text(app.language, "finalNewGroupHint") }));
    appendInput(document, form, "title", text(app.language, "name"), group?.title ?? "");
    const chips = element(document, "div", { class: "group-chips", "data-group-chips": "true" });
    const choices = element(document, "div", { class: "group-choices", "data-member-choices": "true" });
    const paint = () => {
      chips.replaceChildren(...[...members].map((id) => {
        const chip = mapButton(app, "remove-member", unitDisplayName(unitById(app, id)), () => { members.delete(id); paint(); (chips.querySelector("button") ?? form.querySelector("[data-action='add-group-member']"))?.focus?.(); }, { class: "member-chip", "data-member": id, "aria-label": text(app.language, "removeMember", { unit: unitDisplayName(unitById(app, id)) }) });
        chip.replaceChildren(icon(document, "executor"), element(document, "span", { text: unitDisplayName(unitById(app, id)) }), icon(document, "close"));
        return chip;
      }));
      choices.replaceChildren(...leadChoices(app).filter((unit) => unit.role !== "master" && !members.has(unit.id)).map((unit) => mapButton(app, "add-member", unitDisplayName(unit), () => { members.add(unit.id); paint(); chips.querySelector(`[data-member="${unit.id}"]`)?.focus?.(); }, { "data-member-choice": unit.id })));
    };
    choices.hidden = true;
    form.append(element(document, "h3", { text: text(app.language, "members") }), chips, mapButton(app, "add-group-member", text(app.language, "add"), () => { choices.hidden = !choices.hidden; }), choices);
    paint();
    form.problems = () => {
      const problems = [];
      const title = fieldValue(form, "title");
      if (!title.trim() || title.trim().length > 240 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(title)) problems.push({ name: "title", message: text(app.language, "groupNameRequired") });
      if (!members.size || members.size > 255) problems.push({ name: "title", message: text(app.language, "groupMembersRequired") });
      return problems;
    };
  }, async (form) => {
    try {
      const result = group ? await patchGroup(app.api, group, { title: fieldValue(form, "title").trim(), members: [...members] }, operation) : await createGroup(app.api, fieldValue(form, "title").trim(), [...members], operation);
      operation = null;
      app.store.indexes.groups.set(result.data.id, result.data);
      await refreshGroups(app);
      app.hierarchy.collapsed.delete(`personal:${result.data.id}`);
      selectGroup(app, result.data.id);
      showMapToast(app, text(app.language, group ? "saved" : "groupCreated", { title: result.data.title }), group ? null : async (record) => {
        const current = app.store.indexes.groups.get(result.data.id);
        await removeGroup(app.api, current, record.operation);
        app.store.selected.groupId = null;
        app.thread = null;
        await refreshGroups(app);
      });
      return true;
    } catch (error) {
      operation = error.operation ?? operation;
      if (group && error.code === "revision_conflict") {
        await refreshGroups(app);
        group = app.store.indexes.groups.get(group.id) ?? group;
        operation = null;
      }
      throw error;
    }
  }, group ? "group-members" : "new-group");
}

function deletePersonalGroup(app, group) {
  let operation = null;
  const dialog = showDialog(app.root.ownerDocument, {
    title: text(app.language, "finalDeleteGroupTitle", { title: group.title }),
    body: text(app.language, "finalDeleteGroupScope", { count: group.members.length }),
    confirm: text(app.language, "deleteGroup"), cancel: text(app.language, "cancel"), retry: text(app.language, "retry"),
    onConfirm: async () => {
      try {
        const result = await removeGroup(app.api, group, operation);
        operation = null;
        app.store.selected.groupId = null;
        if (app.thread?.chat?.id === group.chatId) app.thread = null;
        await refreshGroups(app);
        showMapToast(app, text(app.language, "groupDeleted", { title: group.title }), async (record) => {
          await undoChange(app.api, result.data.changeId, record.operation);
          await refreshGroups(app);
          selectGroup(app, group.id);
        }, app.api.now() + Math.max(0, Date.parse(result.data.undoUntil) - Date.parse(result.meta.readAt)));
        renderShell(app);
      } catch (error) { operation = error.operation ?? operation; throw error; }
    },
  });
  dialog.className += " connection-dialog";
}

function showMapToast(app, label, undo, until = null) {
  clearTimeout(app.mapToastTimer);
  const toast = { key: `map-undo:${operationId()}`, label, undo, until: typeof until === "number" ? until : app.api.now() + 10000 };
  app.mapToast = toast;
  app.mapToastTimer = setTimeout(() => {
    if (app.mapToast === toast) { app.mapToast = null; if (!app.disposed) renderShell(app); }
  }, Math.max(0, toast.until - app.api.now()));
}

function mapToast(app, t) {
  const toast = app.mapToast;
  const node = element(app.root.ownerDocument, "div", { class: "map-toast", role: "status", "data-map-toast": "true", text: toast.label });
  if (toast.undo && app.api.now() < toast.until) node.append(mapButton(app, "map-undo", t("undo"), () => settle(app, toast.key, t("working"), async (record) => {
    await toast.undo(record);
    if (app.mapToast === toast) app.mapToast = null;
    renderShell(app);
  })));
  return node;
}

function confirmConnection(app, sourceId, targetIds) {
  const source = unitById(app, sourceId);
  const targets = targetIds.map((id) => unitById(app, id)).filter(Boolean);
  if (!source || !targets.length) return;
  const operations = new Map();
  const done = new Set();
  const previous = targets.map((target) => ({ id: target.id, leadId: target.leadId ?? null }));
  const body = targets.map((target) => text(app.language, "finalConnectScope", { unit: unitDisplayName(target), lead: unitDisplayName(source) })).join(" ");
  const dialog = showDialog(app.root.ownerDocument, {
    title: text(app.language, "finalConnectTitle", { unit: targets.map(unitDisplayName).join(", ") }),
    body,
    confirm: text(app.language, "connect"),
    cancel: text(app.language, "cancel"),
    retry: text(app.language, "retry"),
    onConfirm: async () => {
      const pending = targets.filter((target) => !done.has(target.id));
      app.connectionSaving = { leadId: source.id, targets: targets.map((target) => target.id) };
      app.store.selected.unitId = targets[0].id;
      app.store.selected.groupId = null;
      app.mapState.selection = new Set([targets[0].id]);
      app.mapState.pendingConnect = { source: source.id, target: targets[0].id };
      renderShell(app);
      const results = await connectUnits(app.api, source, pending, operations);
      const failed = [];
      for (const result of results) {
        if (result.operation) operations.set(result.id, result.operation);
        if (result.error) failed.push(result);
        else done.add(result.id);
      }
      if (failed.length) {
        app.connectionSaving = null;
        app.mapState.pendingConnect = null;
        if (app.unitList) await reloadList(app.unitList);
        renderShell(app);
        const error = new Error(failed.map((result) => connectCause(app, targets.find((item) => item.id === result.id), result)).join(" "));
        error.code = failed.some((result) => result.uncertain) ? "unknown_result" : (failed[0].error?.code ?? "request_failed");
        throw error;
      }
      showOutcome(app, targets.map((target) => text(app.language, "unitConnected", { unit: target.unit, lead: source.unit })).join(" "), "connected");
      app.connectionSaving = null;
      app.mapState.pendingConnect = null;
      const undoOperations = new Map();
      const undone = new Set();
      showMapToast(app, text(app.language, "saved"), async () => {
        for (const before of previous) {
          if (undone.has(before.id)) continue;
          let operation = undoOperations.get(before.id);
          if (!operation) {
            const current = (await request(app.api, "GET", "/units/:unitId", { params: { unitId: before.id } })).data;
            if (current.leadId !== source.id) throw new ApiError(409, "revision_conflict", text(app.language, "revisionConflict"));
            operation = createOperation({ method: "PUT", path: "/units/:unitId/lead", params: { unitId: before.id }, body: { leadId: before.leadId, confirmed: true, expectedRevision: current.revision } });
            undoOperations.set(before.id, operation);
          }
          await request(app.api, operation.method, operation.path, { operation });
          undone.add(before.id);
        }
        await reloadList(app.unitList);
      });
      if (app.unitList) await reloadList(app.unitList);
      if (!app.disposed) renderShell(app);
    },
  });
  dialog.className += " connection-dialog";
  dialog.addEventListener("close", () => {
    if (!app.connectionSaving && app.mapState) { app.mapState.pendingConnect = null; if (!app.disposed) renderShell(app); }
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
    const described = String(field.getAttribute?.("aria-describedby") ?? "");
    const kept = described.split(/\s+/).filter((item) => item && !item.startsWith("field-error-")).join(" ");
    if (kept) field.setAttribute("aria-describedby", kept);
    else field.removeAttribute?.("aria-describedby");
  }
}

function markChoiceError(form, name, message) {
  const field = form.querySelector?.(`[name="${name}"]`);
  if (!field) return null;
  const id = `field-error-${name}`;
  field.setAttribute("aria-invalid", "true");
  const described = String(field.getAttribute?.("aria-describedby") ?? "");
  const ids = described.split(/\s+/).filter((item) => item && item !== id);
  ids.push(id);
  field.setAttribute("aria-describedby", ids.join(" "));
  const note = element(form.ownerDocument, "p", {
    id,
    class: "field-error",
    role: "alert",
    "data-field-error": name,
    text: message,
  });
  const label = field.closest?.("label") ?? field.parentElement ?? null;
  (label ?? form).append(note);
  return field;
}

function restoreInvoker(app, opener) {
  if (!opener || app.disposed) return;
  const live = app.root.querySelector?.(`[data-action="${opener}"]`);
  if (live) live.focus?.();
  else if (app.store.selected.groupId) app.root.querySelector(`[data-personal-folder="${app.store.selected.groupId}"]`)?.focus?.();
  else if (app.store.selected.unitId) focusUnitRow(app, app.store.selected.unitId);
}

function openUnitForm(app, firstRun = false) {
  if (firstRun) return createOverseer(app);
  settle(app, "unit-form", text(app.language, "loadingClients"), async () => {
    const machines = (await collectPages(app.api, "/machines", { limit: 50 })).items;
    if (app.disposed || app.root.ownerDocument.querySelector?.("[data-form='unit']")) return;
    const leads = leadChoices(app);
  openChoiceForm(app, "unit", text(app.language, "newUnit"), (form, confirm) => {
    const document = form.ownerDocument;
    appendInput(document, form, "unit", text(app.language, "unitName"), "");
    appendSelect(document, form, "role", text(app.language, "role"), UNIT_ROLES.map((role) => ({ value: role, label: role })), "executor");
    appendScope(document, form, text(app.language, "scopeKind"), "project");
    appendInput(document, form, "scopeName", text(app.language, "scopeProject"), "shop");
    appendSelect(document, form, "machine", text(app.language, "machine"), machines.map((machine) => ({
      value: machine.id,
      label: `${machine.id}: ${machine.answers ? text(app.language, "machineAnswers") : text(app.language, "finalMachineOffline", { time: formatWhen(app.language, machine.heartbeatAt) || text(app.language, "unknown") })}`,
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
    appendLeadSearch(document, form, text(app.language, "finalReportsTo"), leads);
    appendSelect(document, form, "groupId", text(app.language, "group"), [{ value: "", label: text(app.language, "none") }, ...[...app.store.indexes.groups.values()].filter((group) => !group.deleted).map((group) => ({ value: group.id, label: group.title }))], "");
    appendInput(document, form, "job", text(app.language, "job"), "");
    appendInput(document, form, "model", text(app.language, "model"), "");
    appendInput(document, form, "positionX", text(app.language, "positionX"), "", { inputMode: "numeric", describedBy: "position-hint" });
    appendInput(document, form, "positionY", text(app.language, "positionY"), "", { inputMode: "numeric", describedBy: "position-hint" });
    form.append(element(document, "p", { id: "position-hint", class: "field-hint", text: text(app.language, "positionHint") }));
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
      const created = form.created ?? await createUnit(app.api, input, retainedOperation(app.unitOperation, "POST", "/units", body));
      form.created = created;
      app.unitOperation = null;
      const createdUnit = created.data?.unit?.id ? created.data.unit : created.data;
      const groupId = fieldValue(form, "groupId");
      if (groupId) {
        const group = app.store.indexes.groups.get(groupId);
        if (!group || group.deleted) throw new ApiError(404, "group_not_found", text(app.language, "missingRecord"));
        if (!group.members.includes(createdUnit.id)) {
          const retained = form.groupOperation?.path === `/groups/${group.id}` ? form.groupOperation : null;
          const result = await patchGroup(app.api, group, { members: [...group.members, createdUnit.id] }, retained);
          app.store.indexes.groups.set(groupId, result.data);
          form.groupOperation = null;
        }
      }
      const unit = createdUnit.unit ?? fieldValue(form, "unit").trim();
      app.store.indexes.units.set(createdUnit.id, createdUnit);
      app.store.selected.unitId = createdUnit.id;
      app.store.selected.groupId = null;
      showOutcome(app, text(app.language, "unitCreated", { unit }));
      if (app.unitList) await reloadList(app.unitList);
      const map = ensureMap(app);
      map.selection = new Set([createdUnit.id]);
      app.pendingChat = { unitId: createdUnit.id, create: true };
      await loadInspector(app, createdUnit.id);
      if (!app.disposed) renderShell(app);
      return true;
    } catch (error) {
      if (error?.operation?.path === "/groups/:groupId") form.groupOperation = error.operation;
      else app.unitOperation = error?.operation ?? app.unitOperation ?? null;
      showOutcome(app, error?.code === "machine_unavailable"
        ? text(app.language, "machineUnavailable", { machine: error.details?.machine ?? machineId })
        : actionText(app.language, error?.code), error?.code ?? null);
      if (!app.disposed) renderShell(app);
      throw error;
    }
  }, "new-unit");
  });
}

async function createOverseer(app) {
  if (app.overseerCreating || !emptyMind(app)) return;
  app.overseerCreating = true;
  app.overseerError = null;
  renderShell(app);
  try {
    const machineId = app.store.settings?.service?.machine ?? app.store.view?.mind?.machine;
    const machines = (await collectPages(app.api, "/machines", { limit: 50 })).items;
    if (!machines.some((machine) => machine.id === machineId && machine.answers)) throw new ApiError(409, "machine_unavailable", text(app.language, "machineUnavailable", { machine: machineId }));
    const input = { unit: "overseer", role: "overseer", scope: { kind: "root", name: null }, machine: machineId, position: { x: 372, y: 178 } };
    const created = await createUnit(app.api, input, app.overseerOperation);
    app.overseerOperation = null;
    const unit = created.data.unit?.id ? created.data.unit : created.data;
    app.store.indexes.units.set(unit.id, unit);
    app.store.selected.unitId = unit.id;
    if (app.unitList) await reloadList(app.unitList);
    const map = ensureMap(app);
    map.selection = new Set([unit.id]);
    map.focusId = unit.id;
    if (!app.disposed) await loadInspector(app, unit.id);
  } catch (error) {
    app.overseerOperation = error.operation ?? app.overseerOperation ?? null;
    app.overseerError = error;
  } finally {
    app.overseerCreating = false;
    if (!app.disposed) renderShell(app);
  }
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
  if (kind === "unit") {
    confirm.textContent = text(app.language, "createUnit");
    const pairs = [["unit", "role"], ["scopeName", "machine"], ["leadId", "groupId"]];
    const fields = new Set(pairs.flat());
    const extra = element(document, "details", { class: "unit-options" }, element(document, "summary", { text: text(app.language, "details") }));
    for (const child of [...form.children].slice(1)) {
      if ([...child.querySelectorAll("input, select")].some((node) => fields.has(node.getAttribute("name")))) continue;
      child.remove();
      extra.append(child);
    }
    for (const pair of pairs) {
      const row = element(document, "div", { class: "unit-pair" });
      for (const name of pair) {
        const field = form.querySelector(`[name="${name}"]`)?.closest("label");
        if (field) { field.remove(); row.append(field); }
      }
      form.append(row);
    }
    form.append(extra);
  }
  const actions = element(document, "div", { class: "dialog-actions" });
  const cancel = element(document, "button", { type: "button", class: "btn", "data-action": "cancel-form", text: text(app.language, "cancel") });
  let sending = false;
  const inputs = [...form.querySelectorAll("input, select, textarea")];
  const enabled = inputs.filter((control) => !control.disabled);
  const setFieldsBusy = (busy) => {
    if (!["unit", "group", "selection-lead"].includes(kind)) return;
    for (const control of enabled) {
      const immutable = kind === "unit" && form.created && control.getAttribute("name") !== "groupId";
      control.disabled = busy || Boolean(immutable);
    }
  };
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
    setFieldsBusy(true);
    confirm.setAttribute("aria-busy", "true");
    const label = confirm.textContent;
    confirm.replaceChildren(progressMark(document, kind === "unit" ? text(app.language, "creatingUnit") : label));
    try {
      const accepted = await onConfirm(form);
      if (accepted !== true) {
        sending = false;
        setFieldsBusy(false);
        confirm.removeAttribute("aria-busy");
        confirm.textContent = label;
        confirm.replaceChildren(document.createTextNode(label));
        return;
      }
      dialog.close();
    } catch (error) {
      sending = false;
      setFieldsBusy(false);
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
  if (["group", "unit", "selection-lead"].includes(kind)) {
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault?.(); dialog.close(); return; }
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll("button, input, select, textarea, summary")].filter((node) => !node.disabled && !node.closest("[hidden]"));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault?.(); last?.focus?.(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault?.(); first?.focus?.(); }
    });
    form.addEventListener("submit", (event) => { event.preventDefault?.(); confirm.click?.(); });
  }
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  if (["group", "unit", "selection-lead"].includes(kind)) enabled[0]?.focus?.();
}

function appendInput(document, form, name, label, value, options = {}) {
  const input = document.createElement("input");
  input.setAttribute("name", name);
  input.setAttribute("aria-label", label);
  if (options.inputMode) input.setAttribute("inputmode", options.inputMode);
  if (options.describedBy) input.setAttribute("aria-describedby", options.describedBy);
  input.value = value;
  form.append(element(document, "label", { class: "field", text: label }, input));
  return input;
}

function appendScope(document, form, label, selected) {
  const group = element(document, "fieldset", { class: "segmented", "data-scope": "true" });
  group.append(element(document, "legend", { text: label }));
  for (const [value, key] of SCOPE_KINDS) {
    const input = document.createElement("input");
    input.setAttribute("type", "radio");
    input.setAttribute("name", "scopeKind");
    input.setAttribute("value", value);
    input.value = value;
    input.checked = value === selected;
    const choice = element(document, "label", { class: "segment" });
    choice.append(input, document.createTextNode(textFrom(document, key)));
    group.append(choice);
  }
  form.append(group);
  return group;
}

function textFrom(document, key) {
  const language = document.documentElement?.lang === "es" ? "es" : "en";
  return text(language, key);
}

function appendLeadSearch(document, form, label, leads) {
  const input = document.createElement("input");
  input.setAttribute("type", "search");
  input.setAttribute("name", "leadId");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", label);
  input.setAttribute("aria-expanded", "false");
  const list = element(document, "div", { class: "lead-choices", role: "listbox", "data-lead-list": "true" });
  const paint = () => {
    const query = input.value.trim().toLowerCase();
    const matches = leads.filter((unit) => {
      const name = String(unit.unit ?? "").toLowerCase();
      return !query || name.includes(query) || String(unit.id).toLowerCase().includes(query);
    }).slice(0, 40);
    input.setAttribute("aria-expanded", matches.length ? "true" : "false");
    list.replaceChildren(...matches.map((unit) => element(document, "button", {
      type: "button",
      class: "btn",
      "data-lead-choice": unit.id,
      text: `${unit.unit} · ${unit.id}`,
      onclick: () => {
        input.value = unit.id;
        input.focus?.();
        input.setAttribute("aria-expanded", "false");
        list.hidden = true;
      },
    })));
  };
  input.addEventListener("input", () => { list.hidden = false; paint(); });
  input.addEventListener("focus", () => { list.hidden = false; paint(); });
  paint();
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
  const field = element(document, "label", { class: "field lead-field", text: label }, input, list);
  field.addEventListener("focusout", () => queueMicrotask(() => {
    if (!field.contains(document.activeElement)) { list.hidden = true; input.setAttribute("aria-expanded", "false"); }
  }));
  form.append(field);
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
  const nodes = [...(form.querySelectorAll?.(`[name="${name}"]`) ?? [])];
  const picked = nodes.find((node) => node.checked);
  return (picked ?? nodes[0])?.value ?? "";
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
  const unit = unitById(app, message.fromId);
  return unit ? unitDisplayName(unit) : message.fromId;
}

function chatPanel(app, t) {
  const document = app.root.ownerDocument;
  const thread = app.thread;
  const panel = element(document, "section", { class: "chat-panel" });
  if (!thread?.chat) return panel;
  const members = thread.chat.members ?? [];
  const heading = element(document, "header", { class: "chat-heading" },
    element(document, "h2", { class: "chat-title", "data-chat-title": thread.chat.id, text: thread.chat.title || thread.chat.id }),
  );
  const group = app.store.indexes.groups.get(thread.chat.id);
  const directUnit = thread.chat.kind === "direct" ? unitById(app, members.find((id) => id !== "root:master")) : null;
  if (directUnit) heading.querySelector("h2").replaceChildren(unitNameNode(document, directUnit));
  if (members.length > 2) {
    const names = members.map((id) => unitById(app, id) ? unitDisplayName(unitById(app, id)) : id).join(", ");
    heading.append(element(document, "p", { class: "chat-members", "data-chat-members": String(members.length), text: names }));
  }
  panel.append(heading);
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
  if (!windowed.items.length) {
    const canPost = (app.store.capabilities ?? []).includes("chat.post");
    transcript.append(element(document, "p", { "data-empty": "chat", text: t(canPost ? "emptyChat" : "emptyChatRead") }));
  }
  for (const message of windowed.items) {
    const own = unitById(app, message.fromId)?.role === "master";
    const article = element(document, "article", { class: own ? "bubble own" : "bubble", "data-from": message.fromId ?? "", "data-own": own ? "true" : "false" });
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
          const chatKey = `chat:${thread.chat.id}`;
          if (!app.disposed) renderShell(app);
          task?.then(() => {
            clearMatchedError(app, chatKey);
            if (!app.disposed) renderShell(app);
          }).catch((error) => noteAction(app, error, chatKey));
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
    dropPendingReads(thread);
    if (thread.nearBottom !== before) {
      renderShell(app);
      return;
    }
    postVisibleReads(app.api, thread).then((result) => {
      if (result) clearMatchedError(app, `read:${thread.chat.id}`);
      if (result && !app.disposed) renderShell(app);
    }).catch((error) => {
      thread.readPause = true;
      noteAction(app, error, `read:${thread.chat.id}`);
    });
  });
  const row = element(document, "div", { class: "action-row" });
  const caps = app.store.capabilities ?? [];
  if (caps.includes("chat.manage") && !group) {
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
    const name = group ? t("messageTheGroup") : directUnit ? t("messageUnit", { unit: directUnit.alias || directUnit.unit }) : t("composerLabel");
    const hint = group ? t("everyReply") : directUnit && !directUnit.sessionIds?.length ? t("finalComposerWait") : t("composerHint");
    composer.setAttribute("aria-label", name);
    panel.append(labeledField(document, name, hint, composer), send);
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

function dropPendingReads(thread) {
  const visible = thread?.visibleIds;
  if (!visible?.size) return;
  for (const message of thread.messages ?? []) {
    if (message.pending) visible.delete(message.id);
  }
}

function syncChatReads(app) {
  const transcript = app.root.querySelector?.(".transcript");
  const thread = app.thread;
  if (!transcript || !thread?.chat || thread.readPause) return;
  measureVisible(thread, transcript);
  dropPendingReads(thread);
  postVisibleReads(app.api, thread).then((result) => {
    if (result) clearMatchedError(app, `read:${thread.chat.id}`);
    if (result && !app.disposed) renderShell(app);
  }).catch((error) => {
    if (app.disposed) return;
    thread.readPause = true;
    noteAction(app, error, `read:${thread.chat.id}`);
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
    if (!visibleMail.length && !box.pending) {
      const canPost = (app.store.capabilities ?? []).includes("chat.post");
      history.append(element(document, "p", { "data-empty": "mailbox", text: t(canPost ? "mailboxEmpty" : "mailboxEmptyRead") }));
    }
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
  const group = app.store.indexes.groups.get(chat.id);
  app.store.selected.chatId = chat.id;
  app.store.selected.groupId = group && !group.deleted ? group.id : null;
  if (group) app.store.selected.unitId = null;
  if (app.mapState) {
    app.mapState.selectedGroupId = app.store.selected.groupId;
    if (group) app.mapState.selection.clear();
  }
  app.thread = createThread(chat);
  const saved = inputDrafts(app).chats.get(chat.id);
  if (saved) app.thread.composer = saved.value;
  return settle(app, `chat-load:${chat.id}`, text(app.language, "loadingConversation"), async () => {
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
    clearMatchedError(app, `mailbox:${box.unitId}`);
    if (!app.disposed) renderShell(app);
  }).catch((error) => {
    box.pending = false;
    if (box.optimistic) box.optimistic.failed = true;
    box.operation = error?.operation ?? box.operation;
    noteAction(app, error, `mailbox:${box.unitId}`);
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
    clearMatchedError(app, chatId ? `chat:${chatId}` : null);
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error, chatId ? `chat:${chatId}` : null));
}

function noteAction(app, error, key = null) {
  showOutcome(app, actionText(app.language, error?.code), error?.code ?? null, "error", null, key);
  if (!app.disposed) renderShell(app);
}

function renderInspector(app, t, selected) {
  const document = app.root.ownerDocument;
  const panel = element(document, "div", { class: "review-panel" });
  const data = app.inspectorData;
  if (selected) {
    const card = renderUnit(document, selected, t, app.language);
    card.querySelector("h3")?.replaceChildren(unitNameNode(document, selected));
    const extra = trackDisclosure(app, element(document, "details", { class: "unit-metadata" }, element(document, "summary", { text: t("details") })), keepId("unit-metadata", selected.id));
    for (const child of [...card.children].slice(1)) { child.remove(); extra.append(child); }
    const session = data?.unitId === selected.id ? data.sessions?.find((item) => item.state !== "stopped") : app.store.view?.sessions?.find((item) => item.unitId === selected.id && item.state !== "stopped");
    const runs = !selected.sessionIds?.length ? t("finalNotStarted") : session?.launchKind === "manual-app" ? t("runsApp", { client: session.client }) : session?.launchKind === "cli" ? t("runsCli", { client: session.client }) : session?.client ?? t("unknown");
    const facts = element(document, "div", { class: "unit-facts", "data-unit-facts": "true" });
    for (const [key, value] of [["machine", selected.machine], ["finalRunsIn", runs], ["model", selected.model ?? t("finalDefaultModel")], ["finalReportsTo", selected.leadId ? unitDisplayName(unitById(app, selected.leadId)) : t("finalNoLead")]]) facts.append(element(document, "p", { text: `${t(key)}: ${value ?? t("unknown")}` }));
    card.append(facts, extra);
    if (app.connectionSaving?.targets.includes(selected.id)) card.append(progressMark(document, `${t("savingLayout")} ${t("finalReportsTo")}: ${unitDisplayName(unitById(app, app.connectionSaving.leadId))}`));
    const folded = card.querySelector?.("details");
    if (folded) trackDisclosure(app, folded, keepId("unit", selected.id));
    panel.append(card);
  }
  if (!data || data.unitId !== selected?.id) {
    if (selected && activityPending(app, `inspector:${selected.id}`)) {
      panel.append(progressMark(document, t("loadingDetails", { name: selected.unit || selected.id }), { "data-inspector-progress": selected.id }));
    }
    return panel;
  }
  const details = trackDisclosure(app, element(document, "details", { class: "inspector-details" }), keepId("inspector", selected?.id));
  details.append(element(document, "summary", { text: t("details") }));
  const machine = (data.machines ?? []).find((item) => item.id === selected?.machine);
  if (machine) details.append(renderMachine(document, machine, t));
  for (const session of data.sessions ?? []) details.append(renderSession(document, session, t));
  const caps = app.store.capabilities ?? [];
  if (caps.includes("grant.revoke")) {
    const busyGrant = [...(app.activity?.entries() ?? [])].find(([key, record]) => key.startsWith("grant:") && record.phase === "pending")?.[0]?.slice(6) ?? null;
    details.append(renderGrants(document, data.grants, t, (grant) => revokeSelectedGrant(app, selected, grant), busyGrant));
  }
  const cards = element(document, "div", { class: "action-cards", "data-action-cards": "true" });
  if (caps.includes("approval.answer")) {
    for (const approval of data.approvals ?? []) {
      cards.append(renderApproval(document, approval, t, (item, decision) => answerSelected(app, item, decision), activityPending(app, `approval:${approval.id}`)));
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
    cards.append(taskHost);
  }
  const visibleTasks = tasks.length >= 100 ? tasks.filter((task) => task.id === app.openTaskId).slice(0, 1) : tasks;
  for (const task of visibleTasks) {
    const noteDraft = inputDrafts(app).notes.get(task.id);
    const phone = app.layout === "phone" || app.store.audience === "phone";
    const taskBusy = activityPending(app, `task:${task.id}`) || activityPending(app, `undo:${task.id}`);
    cards.append(renderTask(document, task, t, (item, status, note) => setTaskStatus(app, item, status, note), caps.includes("task.undo") ? (item) => undoSelected(app, item) : null, noteDraft?.value ?? "", (value, start, end) => {
      inputDrafts(app).notes.set(task.id, { value, start: Number.isInteger(start) ? start : value.length, end: Number.isInteger(end) ? end : value.length });
      syncViewerDirty(app);
    }, phone ? canAccept(task) : canSendBack(task), taskBusy));
    cards.append(openTaskDetail(document, task, t));
  }
  if (cards.children?.length) panel.append(cards);
  details.append(renderWaiting(document, data.waiting, t, (item) => openWaitingItem(app, item), data.waiting?.length ? null : showMapButton(app, document, t)));
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
    replaceTask(app, result.data.task);
    await refreshWaiting(app);
    return result;
  });
}

function undoSelected(app, task) {
  settle(app, `undo:${task.id}`, text(app.language, "working"), async (record) => {
    const result = await undoTask(app.api, task, record.operation);
    record.operation = result.operation ?? record.operation;
    showOutcome(app, taskText(app.language, result.data.task.status), result.data.task.status);
    replaceTask(app, result.data.task);
    await refreshWaiting(app);
    return result;
  });
}

function replaceTask(app, task) {
  if (app.inspectorData?.tasks) {
    app.inspectorData.tasks = app.inspectorData.tasks.map(item => item.id === task.id ? task : item);
  }
  if (app.waitingRecord?.task?.id === task.id) app.waitingRecord.task = task;
  app.store.indexes.tasks.set(task.id, task);
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
