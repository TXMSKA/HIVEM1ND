import {
  answerApproval,
  canAccept,
  canSendBack,
  changeTaskStatus,
  connectUnits,
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
  authoredMessages,
  canMarkMailbox,
  createThread,
  incomingMessage,
  loadMailboxMessage,
  loadMessages,
  manageChat,
  markMailboxRead,
  measureVisible,
  messageWindow,
  MESSAGE_WINDOW,
  findDirectChat,
  openDirectChat,
  openGroupChat,
  postMessage,
  retryMessage,
  sentLineState,
  postVisibleReads,
  updateNearBottom,
  uploadChatImage,
} from "./chats.mjs";
import { IMAGE_MAX_BYTES, IMAGE_TYPES, galleryState, messageParts, renderActions, renderAttachDialog, renderGallery, renderPendingParts } from "./chat-media.mjs";
import { addNode, addBoardFrame, appendBoardNode, boardBounds, boardColors, boardCommentAnchor, boardDocument, dragNodeGeometry, editedBoard, hitBoardNode, indexNodes, loadAssets, parentPoint, patchNode, releaseAssets, removeNode, renderBoard, replaceBoard, setBoardDraft, sketchStroke, touchedStrokes, uploadAsset } from "./blueprint.mjs";
import { ApiError, clearCredentials, createApi, createOperation, dispose as disposeApi, fetchAsset, operationId, perform, request } from "./api.mjs";
import { clusterGlyph, element, icon, labelDialog, labeledField, pathIcon, progressMark, runAction, setBusy, showDialog, showError } from "./components.mjs";
import {
  applyWatch,
  createComment,
  commentChoice,
  createEditors,
  createResource,
  libraryState,
  renderEditorHistory,
  renderLibrary,
  libraryChange,
  duplicateEditor,
  moveEditor,
  deleteEditor,
  handleActivity,
  loadCatalog,
  loadComments,
  loadHistory,
  restoreEditorHistory,
  resolveEditorConflict,
  editorDraftDocument,
  noteComment,
  noteRemote,
  openEditor,
  refreshRemoteEditor,
  registerResource,
  replyComment,
  resolveComment,
  setAttachments,
  expandAttachments,
  startWatch,
  stopWatch,
} from "./editors.mjs";
import { activateUnit, buildHierarchy, collapseNewClusters, flattenVisibleHierarchy, hierarchyDisclosure, hierarchyIcon, listedWorktrees, openContextMenu, pathFolder, readableIdentity, revealGroup, toggleGroup, unitDisplayName, unitRoleName, unitsForTree } from "./hierarchy.mjs";
import { checkoutFacts, openTaskDetail, renderApproval, renderGrants, renderMachine, renderSession, renderTask, renderUnit, renderWaiting } from "./inspector.mjs";
import { cardinal, formatClock, formatNumber, formatShortTime, text } from "./i18n.mjs";
import { collectPages, createPagedList, loadAll, loadNext, reloadList, renderWindow, setQuery } from "./lists.mjs";
import { adoptInitialLayout, applyRemoteLayout, centerUnit, createMap, keepLocalPosition, renderMap, retrySavedLayout, settlePositions, useIncomingPosition } from "./map.mjs";
import { dispose as disposeEmbed, publishDirty, publishReady, startEmbedChannel } from "./embed.mjs";
import { PHONE_NAV, exchangeCode, exchangeHomeFragment, logout, renderCodeEntry, renderPhone } from "./phone.mjs";
import { applyIssueChange, applyServiceBeat, applySettingsRead, applySyncSnapshot, armExpiry, clearGrant, closeHome, LOOK_IDS, noteHomeChange, openHome, renderClientReview, renderSettings, saveSettings, takeGrant } from "./settings.mjs";
import { acceptStreamEvent, createStore, loadSnapshot } from "./state.mjs";
import { answerProposal, captureTextSelection, createTextFinder, documentSaver, draftSnapshot, editProposal, enterFocus, formatSelection, highlightFind, leaveFocus, loadProposals, moveFocus, noteProposal, proposalComment, proposalPassage, proposalStale, rememberTextDraft, renderDocument, renderProposal, replaceMatches, undoReplace, replaceVisible, restoreTextSelection, selectedPlainRange, showTools, TEXT_FORMATS, textAnchor, textDraft, textDraftKey } from "./void.mjs";
import { assetIdentity, plainCaretFromSource, plainOffsets, plainText, sourceBoundary, tokenizeMarkup, validUtf16Boundary } from "./markup.mjs";
import { close as closeStream, resetCredentials, synchronize } from "./stream.mjs";
import * as startApi from './start-api.mjs';
import { startText } from './start-copy.mjs';
import { acceptedRepositoryCluster, clientLabel, clusterLead, customRoleProblems, initialRunsIn, repositorySelection, renderAgentForm, renderClusterForm, renderRepositoryOffer, renderRunsInPicker, runsInLabel, startDialog, supervisedClient } from './clusters.mjs';
import { renderAgentHeader, renderCluster, renderClusterChanges } from './inspector.mjs';
import { fitMap, flyToCluster, isCollapsed, toggleCollapsed } from './map.mjs';
import { changeContext, createSessionView, loadSessionView, loadTranscriptPage, renderContext, renderSessionTabs, renderSessionWork, renderStartedWith } from './session-work.mjs';
import { PLAN_TASK_LIMIT, controlPlan, createPlanController, loadChatPlans, planBranch, refreshPlan, renderControlledPlan, runPlan, savePlanDraft, tasksFromVoidText } from './plan-controller.mjs';
import { createAddController, openAdd, disposeAdd } from './add-controller.mjs';
import { addButton, addText } from './add-view.mjs';
import { getAdditions, removeAddition } from './add-api.mjs';

const DESKTOP_MODES = ["map", "blueprint", "document", "focus"];
const BAR_MODES = ["map", "blueprint", "document"];
const PHONE_MODES = PHONE_NAV;
const RECOVERY_COPY = {
  reconnecting: ['Reconnecting to the service. What you do is kept and sent when it answers.', 'Reconectando con el servicio. Las acciones se conservan y se envían cuando responde.'],
  retry: ['Retry now', 'Reintentar ahora'],
  stopped: ['The Relay service stopped on {machine}.', 'El servicio Relay se detuvo en {machine}.'],
  details: ['Details', 'Detalles'],
  restart: ['Restart service', 'Reiniciar el servicio'],
  instructions: ['Reopen HIVEM1ND on this machine, or run: {command}', 'Volver a abrir HIVEM1ND en esta máquina o ejecutar: {command}'],
  unavailable: ['The service connection could not be restored. Your work is kept.', 'No se pudo restablecer la conexión con el servicio. El trabajo se conserva.'],
};

function recoveryText(app, key, variables = {}) {
  return RECOVERY_COPY[key][app.language === 'es' ? 1 : 0].replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? ''));
}

async function loadRecoveryBridge(app) {
  if (app.recovery || app.store.audience === 'phone') return;
  try {
    const result = await request(app.api, 'GET', '/viewer/recovery');
    if (!result.data.origin || !result.data.token) return;
    const origin = new URL(result.data.origin);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.href !== `${origin.origin}/`) return;
    const token = result.data.token;
    const call = async (path, method = 'GET') => {
      const response = await app.api.fetch(`${origin.origin}${path}`, { method, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          ...(typeof document === 'undefined' ? { Origin: app.api.location.origin } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });
      const body = await response.json();
      if (!response.ok) throw new ApiError(response.status, body.error?.code ?? 'service_unavailable', recoveryText(app, 'unavailable'));
      return body;
    };
    app.recovery = { serviceStatus: () => call('/status'), recoverService: () => call('/recover', 'POST') };
  } catch { /* Hosts without a recovery bridge keep the existing launcher instructions. */ }
}

function startServiceStream(app) {
  return synchronize(app.api, app.store, {
    cursor: () => app.store.cursor,
    onEvent: event => onStream(app, event),
    reauthenticate: () => app.layout !== 'phone' && app.recovery ? recoverSession(app) : false,
    onState: state => {
      if (state.state === 'reconnecting' || state.error === 'reconnect_exhausted') verifyServiceStatus(app);
      if (!app.disposed && !app.bootFailed && app.layout !== 'unknown') renderShell(app);
    },
  });
}

async function verifyServiceStatus(app) {
  if (!app.recovery || app.checkingService || app.recoveryPending || app.disposed) return;
  app.checkingService = true;
  try {
    const result = await app.recovery.serviceStatus();
    if (app.disposed) return;
    app.serviceStopped = result.state === 'stopped';
    if (app.serviceStopped) closeStream(app.api.live);
  } catch (error) { app.recoveryError = error; }
  finally { app.checkingService = false; if (!app.disposed) renderShell(app); }
}

async function recoverSession(app) {
  if (!app.recovery || app.layout === 'phone' || app.disposed) return false;
  if (app.recoveryPending) return app.recoveryPending;
  app.recoveryPending = (async () => {
    captureInputs(app);
    try {
      const session = await app.recovery.recoverService();
      if (app.disposed) return false;
      resetCredentials(app.api, app.store, session);
      app.serviceStopped = false;
      app.recoveryError = null;
      app.bootFailed = false;
      app.bootReading = false;
      disposeEmbed(app.embed); app.embed = null;
      clearGrant(homeState(app));
      await loadSnapshot(app.store, app.api);
      await loadPresentation(app, { keepShell: true });
      startOwnEmbed(app);
      startServiceStream(app);
      return true;
    } catch (error) {
      app.recoveryError = error;
      if (!app.disposed) renderShell(app);
      return false;
    }
  })().finally(() => { app.recoveryPending = null; if (!app.disposed) renderShell(app); });
  return app.recoveryPending;
}

const OPENING_COPY = {
  reading: ["Reading the M1ND", "Leyendo la M1ND"],
  failure: ["The M1ND cannot be read", "No se puede leer la M1ND"],
  chooseFolder: ["Choose another folder", "Elegir otra carpeta"],
  noUnits: ["No units yet", "Todavía no hay unidades"],
  first: ["The Overseer comes first; create it from the inspector.", "Crear primero el Overseer desde el inspector."],
  empty: ["Your M1ND is empty", "La M1ND está vacía"],
  coordinates: ["The Overseer coordinates every other unit. Create it first; then add Overlords and Executors from the Map.", "El Overseer coordina las demás unidades. Crearlo primero y agregar después Overlords y Executors desde el Mapa."],
  create: ["Create the Overseer", "Crear el Overseer"],
  timeout: ["{path} did not answer in 30 s. The drive may be offline, or another program may hold the folder.", "{path} no respondió en 30 s. La unidad puede estar desconectada o la carpeta puede estar bloqueada por otro programa."],
  counts: ["{units} units, {groups} groups, {chats} chats, {boards} boards", "{units} unidades, {groups} grupos, {chats} chats, {boards} tableros"],
  connecting: ["Connecting to the service", "Conectando con el servicio"],
  read: ["Reading", "Leyendo"],
  notRead: ["M1ND not read", "M1ND sin leer"],
};

function openingText(app, key, variables = {}) {
  return OPENING_COPY[key][app.language === "es" ? 1 : 0].replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? ""));
}

const SEND_COPY = {
  sending: ["Sending", "Enviando"],
  deliveredReceipt: ["Delivered {time}", "Entregado {time}"],
  readReceipt: ["Read {time}", "Leído {time}"],
  storedReceipt: ["Sent, awaiting delivery", "Enviado, pendiente de entrega"],
  notConfirmed: ["Not confirmed: the service did not answer in 10 s.", "Sin confirmar: el servicio no respondió en 10 s."],
  retryHint: ["Retry sends the same message once; it is never sent twice", "Reintentar envía el mismo mensaje una sola vez, sin duplicarlo"],
  takingLonger: ["Taking longer than usual", "Está tardando más de lo habitual"],
  waiting: ["The service has not answered for {seconds} s. It stops waiting at 30 s and offers Retry.", "El servicio no respondió durante {seconds} s. La espera termina a los 30 s y permite reintentar."],
};

function sendText(app, key, variables = {}) {
  return SEND_COPY[key][app.language === "es" ? 1 : 0].replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? ""));
}

export function presentation(viewer, settings) {
  return {
    look: viewer?.look ?? settings?.look ?? "modern",
    language: viewer?.language ?? settings?.language ?? "en",
  };
}

// The opening and pairing frames render before /settings and /viewer answer. A language this viewer
// already kept is used; otherwise the browser's first language, Spanish when that is es-*.
export function knownLanguage(storage, languages) {
  let stored = null;
  try { stored = storage?.getItem?.("hivem1nd:language") ?? null; } catch { stored = null; }
  if (stored === "es" || stored === "en") return stored;
  const first = String(Array.isArray(languages) ? languages[0] ?? "" : "").toLowerCase();
  return first.startsWith("es") ? "es" : "en";
}

function browserLanguages(env, document) {
  const languages = env?.navigator?.languages ?? document?.defaultView?.navigator?.languages;
  return Array.isArray(languages) ? languages : [];
}

function applyChoice(app, choice) {
  app.look = LOOK_IDS.includes(choice.look) ? choice.look : "modern";
  app.language = choice.language === "es" ? "es" : "en";
  try { app.startStorage?.setItem("hivem1nd:language", app.language); } catch { /* Storage can be unavailable in a private viewer. */ }
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
    startStorage: env.storage ?? viewStorage(document),
    recovery: env.recovery ?? ((env.hivem1nd ?? globalThis.hivem1nd)?.recoverService ? (env.hivem1nd ?? globalThis.hivem1nd) : null),
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
    if (app.rendering || app.mode !== "focus" || !app.voidState || app.voidState.tools) return;
    showTools(app.voidState);
    renderShell(app);
  };
  root.addEventListener?.("pointermove", revealFocusTools);
  root.addEventListener?.("pointerup", revealFocusTools);
  root.addEventListener?.("focusin", revealFocusTools);
  app.language = knownLanguage(app.startStorage, browserLanguages(env, document));
  restoreOpeningView(app);
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
    app.store.signedOut = null;
  }
  if (app.store.audience === "phone") {
    app.phoneEnded = false;
    clearTimeout(app.phoneExpiryTimer);
    const remaining = Date.parse(app.store.expiresAt) - (app.api.homeReadAt ?? app.api.now());
    if (Number.isFinite(remaining)) {
      app.phoneExpiryTimer = setTimeout(() => { endPhoneAccess(app); renderSignedOut(app); }, Math.max(0, remaining));
      app.phoneExpiryTimer.unref?.();
    }
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
  loadRecoveryBridge(app);
  startServiceStream(app);
  try {
    await loadSnapshot(app.store, { ...app.api, deadlineMs: 30000 });
    rememberOpeningView(app);
    if (!app.disposed && !app.bootFailed && app.bootReading && app.layout !== "phone") renderShell(app);
    if (app.disposed || app.bootFailed) return app;
    if (!app.disposed && !app.store.capabilities?.length) armBootDeadline(app, app.readyBudgetMs);
    await loadPresentation(app);
    if (app.disposed || app.bootFailed) return app;
    await loadLists(app);
    if (app.layout === 'desktop') { await loadStartReports(app); maybeStartDiscovery(app); }
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
  app.bootFailed = false;
  app.bootError = null;
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
  applyChoice(app, presentation(app.store.viewer, app.store.settings?.settings));
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
  if (mode === "hierarchy" || mode === "chats") {
    app.tab = mode;
    if (app.mode === "settings") app.mode = "map";
  }
  else app.mode = mode;
  if (mode !== "settings" && app.homeState?.grant) clearGrant(app.homeState);
  if (mode === "focus" && app.voidState) enterFocus(app.voidState);
  renderShell(app);
}

export function renderShell(app) {
  if (app.editors?.current?.boardGesture || app.editors?.current?.textComposing) return;
  if (app.voidFind?.open && (app.mode !== 'document' || app.editors.current?.kind !== 'void' || app.editors.current.sourceMode)) {
    clearTimeout(app.voidFind.timer); app.voidFind.finder.cancel(); app.voidFind.generation++;
    app.voidFind.open = false; app.voidFind.pending = false;
  }
  app.rendering = true;
  try {
    paintShell(app);
  } finally {
    app.rendering = false;
  }
}

function paintShell(app) {
  captureInputs(app);
  if (!app.api.token && (app.layout === 'phone' || !app.recovery)) {
    if (app.store.audience === 'phone') endPhoneAccess(app);
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
  workspace.setAttribute("tabindex", "-1");
  if (app.layout === 'phone') shell.append(element(document, 'div', { class: 'phone-status' }, element(document, 'span', { text: formatClock(app.language, app.api.now()) }), 'HIVEM1ND'));
  shell.append(
    element(document, "a", { class: "skip", href: "#workspace", text: t("skipToContent"), onclick: () => app.root.querySelector("[id='workspace']")?.focus() }),
    element(document, "h1", { class: "sr", text: heading }),
    renderBar(app, t, counts),
    workspace,
  );
  if (app.layout !== 'phone') shell.append(opening ? openingFooter(app) : renderFooter(app, t));
  else if (app.store.stream?.state === 'error') shell.append(element(document, 'button', { type: 'button', class: 'btn phone-retry', 'data-action': 'retry-stream', text: t('retry'), onclick: () => startServiceStream(app) }));
  if (app.layout === "phone") shell.append(renderPhoneNav(app, t));
  clearPhoneDialog(app);
  app.root.replaceChildren(shell);
  const conversation = app.root.querySelector('.transcript');
  if (conversation && app.thread) conversation.scrollTop = app.thread.nearBottom ? conversation.scrollHeight ?? 0 : app.thread.scrollTop ?? 0;
  const work = app.root.querySelector('[data-session-work]');
  if (work) work.scrollTop = app.store.sessionViews.get(work.getAttribute('data-session-work'))?.scrollTop ?? 0;
  if (app.startDialog?.model && app.startDialog.model.language !== app.language) {
    app.startDialog.model.language = app.language; app.startDialog.paint();
  }
  if (app.addController && app.addController.model.language !== app.language) {
    app.addController.model.language = app.language; app.addController.paint();
  }
  syncLiveRegions(app);
  paintActivity(app, shell);
  paintServiceBanner(app, shell);
  restoreInputFocus(app);
  app.editors?.current?.restoreSelection?.();
  finishList(app);
  finishMap(app);
  syncChatReads(app);
  armHomeExpiry(app);
  const phoneDialog = app.root.querySelector("[data-phone-dialog]");
  if (phoneDialog) {
    phoneDialog.showModal?.();
    if (!homeState(app).phoneDialogFocused) {
      phoneDialog.querySelector("[data-action='phone-done']")?.focus();
      homeState(app).phoneDialogFocused = true;
    }
  }
}

function inputDrafts(app) {
  if (!app.inputDrafts) {
    app.inputDrafts = { chats: new Map(), notes: new Map(), nodes: new Map(), resources: new Map(), fields: new Map(), disclosures: new Map(), focus: null };
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
  if (editor.titleDraft !== undefined && editor.titleDraft !== editor.authoritative?.document?.title) return true;
  if (editor.boardDraft) return true;
  if (editor.commentText) return true;
  if (editor.nodeDraft) return true;
  if (textDraftsDiffer(editor)) return true;
  const mirrored = editor.draftKey ? textDraft(editor, editor.resourceId, editor.draftKey.k, editor.draftKey.lang) : undefined;
  return Boolean(editor.draftText) && editor.draftText !== mirrored;
}

function aggregateDirty(app) {
  if ([...(app.chatThreads?.values() ?? [])].some((thread) => thread.pendingSends.size)) return true;
  const drafts = inputDrafts(app);
  for (const name of ["chats", "notes", "nodes", "resources"]) {
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
  app.editors?.current?.captureSelection?.();
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
    const action = app.root.contains(active) && active?.getAttribute?.("data-action");
    if (action) focused = { kind: "action", id: action };
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
    const control = [...app.root.querySelectorAll("[data-action]")].find(node => node.getAttribute("data-action") === focus.id && !node.disabled);
    (control ?? app.root.querySelector("[id='workspace']"))?.focus?.();
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
  if (app?.addController) disposeAdd(app.addController);
  if (app.mapState) { app.mapState.disposed = true; app.mapState.flight = null; }
  app.startDialog?.dialog?.close();
  if (!app || app.disposed) return;
  app.disposed = true;
  clearTimeout(app.workClock);
  clearTimeout(app.checkoutTimer);
  clearTimeout(app.readyTimer);
  clearTimeout(app.phoneExpiryTimer);
  clearTimeout(app.phoneLockTimer);
  clearTimeout(app.mapToastTimer);
  clearTimeout(app.libraryToastTimer);
  clearTimeout(app.voidFind?.timer);
  app.voidFind?.finder.cancel();
  for (const record of app.activity?.values() ?? []) record.cancel?.();
  app.root?.ownerDocument?.removeEventListener?.("selectionchange", app.onCommentSelection);
  app.root?.ownerDocument?.removeEventListener?.("selectionchange", app.onVoidSelection);
  for (const editor of app.editors?.drafts?.values() ?? []) editor.voidSaver?.dispose();
  closeStream(app.api.live);
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
  clearPhoneDialog(app);
  app.settingsState?.dialog?.close();
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
  if (app.layout !== 'phone' && ['plan.changed', 'run.changed', 'run.log', 'session.work', 'session.context', 'stream.reset'].includes(event?.name)) {
    const controller = plansForApp(app);
    for (const plan of app.store.indexes.plans.values()) controller.plans.set(plan.id, plan);
    for (const run of app.store.indexes.runs.values()) controller.runs.set(run.id, run);
    const data = dataOf(event);
    if (data.planId) await refreshPlan(controller, data.planId).catch(error => noteAction(app, error));
    if (data.runId) {
      const run = (await request(app.api, 'GET', `/runs/${encodeURIComponent(data.runId)}`)).data;
      controller.runs.set(run.id, run); await refreshPlan(controller, run.planId, run.id);
    }
    for (const view of app.store.sessionViews.values()) {
      if (view.workStale && view.tab === 'work') { view.workStale = false; await loadSessionView(app.api, view); }
      if (view.contextStale) { view.contextStale = false; await loadSessionView(app.api, view, { context: true }); }
    }
  }
  // The index holds the new task; the cards and the waiting record keep their own copies, so they take it too.
  if (event?.name === "task.changed") {
    const task = app.store.indexes.tasks.get(dataOf(event).task?.id);
    if (task) replaceTask(app, task);
    if (app.waitingList) reloadList(app.waitingList).catch(() => {});
    // The inspector keeps its own waiting items for its unit; a task change can add or remove one.
    refreshInspectorWaiting(app);
  }
  if (['unit.unread', 'message.read', 'message.created'].includes(event?.name) && app.unitList) {
    for (const unit of app.unitList.catalog ?? []) { const current = app.store.indexes.units.get(unit.id); if (current) unit.unread = current.unread; }
  }
  if (event?.name === "home.changed") {
    const data = dataOf(event);
    noteHome(app, data);
    if (app.store.audience === "phone" && data.home?.enabled === false) {
      result?.consume?.();
      endPhoneAccess(app);
      renderSignedOut(app);
      return;
    }
  }
  if (event?.name === "sync.changed") noteSync(app, dataOf(event));
  if (event?.name === "service.changed") noteService(app, dataOf(event));
  if (event?.name === "issue.changed") noteIssue(app, dataOf(event));
  if (event?.name === "machine.settings.changed" && dataOf(event).machine === app.settingsState?.machine
    || event?.name === "settings.content.changed" && app.settingsState) loadSettingsSections(app);
  if (app.layout === 'desktop' && ['cluster.changed', 'machine.settings.changed', 'additions.changed', 'stream.reset'].includes(event?.name)) {
    await loadStartReports(app);
    if (app.settingsState && event?.name === 'additions.changed') await loadSettingsSections(app);
    const cluster = app.store.indexes.groups.get(app.store.selected.groupId);
    if (cluster) await loadClusterFacts(app, cluster);
  }
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
    if (event?.name === "view.changed" && app.thread?.chat) await loadMessages(app.api, app.thread);
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
  if (["session.changed", "session.work", "session.context"].includes(event?.name)) refreshCheckout(app, app.store.selected.unitId, event.name === "session.changed");
  if (event?.name === "approval.requested" || event?.name === "approval.answered") await noteApproval(app, dataOf(event));
  if (event?.name === "approval.grant.changed") await noteGrant(app, dataOf(event));
  if (event?.name === "message.read") {
    const data = dataOf(event);
    applyMessageRead(app.chatThreads?.get(data.chatId) ?? app.thread, data);
    const thread = app.chatThreads?.get(data.chatId) ?? app.thread;
    if (thread?.chat?.id === data.chatId && data.readerId !== "root:master" && !data.deliveries) await loadMessages(app.api, thread);
  }
  if (event?.name === "message.created") {
    const data = dataOf(event);
    const thread = app.chatThreads?.get(data.chatId) ?? (app.thread?.chat?.id === data.chatId ? app.thread : null);
    const host = app.root.querySelector?.(".transcript");
    if (host && thread === app.thread) updateNearBottom(thread, host);
    if (thread) {
      if (data.message) incomingMessage(thread, data.message);
      else await loadMessages(app.api, thread);
    }
    if (data.message?.operationId) app.api.uncertain.delete(data.message.operationId);
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
  if (editors && ["library.changed", "editor.removed", "editor.changed"].includes(event?.name)) {
    if (event.name === "editor.removed" && editors.current?.resourceId === data.resourceId) {
      editors.current = null;
      app.store.selected.resourceId = null;
    }
    const kind = app.mode === "blueprint" ? "blueprint" : "void";
    if (["blueprint", "document"].includes(app.mode)) {
      try { await loadCatalog(app.api, editors, kind); } catch (error) { editors.error = error; }
    } else editors.loadedKind = null;
  }
  if (event?.name === "notification.changed") noteDelivery(app, editors, data);
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
  if (editors && event?.name === "editor.history.changed" && editors.current?.resourceId === data.resourceId) {
    editors.current.historyStale = true;
    if (editors.current.historyOpen) await loadHistory(app.api, editors).catch((error) => { editors.error = error; });
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
  const thread = app.chatThreads?.get(data?.chatId) ?? (app.thread?.chat?.id === data?.chatId ? app.thread : null);
  if (thread && data.message) incomingMessage(thread, data.message, true);
  const current = editors?.current;
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
  const viewerReadable = app.store.capabilities.includes("viewer.write");
  if (viewerReadable) {
    const viewer = await request(app.api, "GET", "/viewer");
    if (app.disposed || ticket !== app.presentationTicket) return;
    app.store.viewer = viewer.data;
    app.readAt = viewer.meta.readAt;
    app.sync = viewer.meta.sync;
  }
  if (ticket !== app.presentationTicket) return;
  // The viewer's language wins, and it is unknown until the snapshot says this session can read it.
  // Settings alone must not replace the language chosen before the read.
  if (viewerReadable || app.store.capabilities.length) applyChoice(app, presentation(app.store.viewer, app.store.settings?.settings));
  app.layout = shellLayout(app.store.capabilities, app.store.audience);
  app.store.audience ??= app.layout;
  const home = homeState(app);
  applySettingsRead(home, app.store.settings);
  editorsOf(app).sendToAgent = home.sendToAgentChoice ?? home.settings.sendToAgent;
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

export function renderBar(app, t, counts) {
  const document = app.root.ownerDocument;
  const modes = element(document, "div", { class: "modes", role: "toolbar" });
  if (app.layout !== "phone") {
    for (const mode of BAR_MODES) {
      modes.append(element(document, "button", {
        type: "button",
        class: "mode",
        "data-action": `mode-${mode}`,
        "aria-pressed": String(app.mode === mode),
        onclick: () => navigate(app, mode),
      }, icon(document, mode), t(mode === "document" ? "voidMode" : mode)));
    }
  }
  const waiting = element(document, "button", {
    type: "button",
    class: "pill",
    "data-action": "waiting",
    "aria-pressed": String(app.mode === "map" && app.waitingOpen === true || app.mode === "waiting"),
    onclick: () => openWaiting(app),
  }, icon(document, "waiting"), cardinal(app.language, "waitingOnYou", counts.waiting ?? 0));
  const settings = element(document, "button", {
    type: "button",
    class: "icon-button",
    "data-action": "open-settings",
    "aria-pressed": String(app.mode === "settings"),
    "aria-label": t("settings"),
    onclick: () => navigate(app, "settings"),
  }, icon(document, "settings"));
  const inspector = element(document, "button", {
    type: "button",
    class: "icon-button",
    "data-action": "toggle-inspector",
    "aria-label": t(app.inspectorOpen ? "closeInspector" : "openInspector"),
    onclick: () => {
      app.inspectorOpen = !app.inspectorOpen;
      renderShell(app);
    },
  }, icon(document, "hierarchy"));
  const phone = element(document, "button", {
    type: "button", class: "icon-button", "data-action": "open-phone",
    "aria-label": t("settingsOpenPhone"), onclick: () => openPhoneSettings(app),
  }, icon(document, "phone"));
  const notifications = element(document, "button", {
    type: "button", class: "icon-button", "data-action": "open-notifications",
    "aria-label": t("finalNotifications"), title: t("finalNotificationsUnavailable"), disabled: "",
  }, icon(document, "bell"));
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
  const bar = element(document, "header", { class: "bar" }, app.layout === 'phone' ? brand(document).querySelector('.mark') : brand(document), modes);
  if (app.layout === 'phone') bar.append(element(document, 'h2', { 'data-phone-title': 'true', text: viewTitle(app, t) }));
  if (app.layout !== 'phone' && !app.bootReading && !app.bootFailed && app.store.capabilities.includes('settings.write')) {
    bar.append(addButton(document, app.language, () => openSharedAdd(app)));
  }
  if (counts.waiting) bar.append(waiting);
  if (app.layout !== "phone") {
    bar.append(catalogToggle);
    if (app.mode === "blueprint" || app.mode === "document") bar.append(commentsToggle);
    bar.append(phone, notifications, inspector, settings);
  }
  return bar;
}

function renderWorkspace(app, t, view, counts) {
  if (app.layout !== "phone" && (app.bootReading || app.bootFailed)) return openingWorkspace(app, t);
  if (app.mode === "focus") return renderFocusWorkspace(app, t);
  if (app.layout !== "phone" && (app.mode === "blueprint" || app.mode === "document")) return renderEditorWorkspace(app, t);
  const document = app.root.ownerDocument;
  if (app.layout !== "phone" && app.mode === "settings") return element(document, "div", { class: "workspace workspace-settings" }, settingsSurface(app, document, t));
  const tabs = element(document, "div", { class: "tabs" });
  for (const tab of ["hierarchy", "chats"]) {
    tabs.append(element(document, "button", {
      type: "button",
      class: "tab",
      "data-action": `tab-${tab}`,
      "aria-pressed": String(app.tab === tab),
      onclick: () => navigate(app, tab),
    }, icon(document, tab), t(tab)));
  }
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
    // The issues line shows only when there is something to read.
    side = element(document, "aside", { class: "panel side" },
      element(document, "h2", { "data-phone-title": "true", text: phoneTitle }),
      issueItems.length ? issues : null,
      collection,
    );
  } else {
    const issues = element(document, "section", { class: "summary" }, element(document, "h2", { text: t("issuesTitle") }));
    for (const issue of issueItems) issues.append(element(document, "p", { class: "issue", text: issue.message }));
    if (!issueItems.length) issues.append(emptyIssues(app, document, t));
    side = element(document, "aside", { class: `panel side${app.catalogOpen ? " is-open" : ""}` }, tabs, collection);
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
    if (selected && app.inspectorData?.unitId === selected.id) {
      const host = element(document, "div", { class: "phone-cards", "data-phone-cards": "true" });
      for (const approval of app.inspectorData.approvals ?? []) {
        const card = renderWaitingRecord(app, t, { kind: 'approval', approval });
        card.setAttribute('data-phone-card', 'approval');
        host.append(card);
      }
      for (const task of (app.inspectorData.tasks ?? []).filter(task => task.status === 'review')) {
        const card = renderWaitingRecord(app, t, { kind: 'review', task });
        card.setAttribute('data-phone-card', 'review');
        host.append(card);
      }
      host.append(element(document, 'p', { class: 'field-hint', text: t('phoneComputerRequired') }));
      stage.querySelector('.transcript')?.append(host);
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
    inspectorBody.append(clusterInspector(app, group), clusterChatPanel(app, group));
  } else if (app.layout !== "phone" && selection.length > 1) {
    inspectorBody.append(selectionInspector(app, t, selection));
  } else {
    const agent = inspectorAgent(app);
    if (agent) {
      inspectorBody.className += ' agent-inspector';
      inspectorBody.append(renderAgentHeader(document, agent, sessionForUnit(app, agent.id), app.language, () => openAgentMore(app, agent)));
      const controls = trackDisclosure(app, element(document, 'details', { class: 'agent-controls' }, element(document, 'summary', { text: t('details') }), actionControls(app, t, agent)), `agent-controls:${agent.id}`);
      inspectorBody.append(controls);
      const review = renderInspector(app, t, agent);
      const facts = review.querySelector('[data-unit-facts]');
      // The facts sit inside Details with the controls; the board keeps the conversation in front.
      if (facts) {
        facts.remove();
        facts.className += ' agent-facts';
        controls.append(facts);
      }
      const progress = review.querySelector('[data-session-progress]');
      if (progress) {
        progress.remove();
        inspectorBody.append(progress);
      }
      const panel = chatPanel(app, t);
      const cards = review.querySelector('[data-action-cards]');
      if (cards) cards.remove();
      const scroll = panel.querySelector('.transcript') ?? panel.querySelector('[data-session-work]') ?? panel.querySelector('[data-unit-work]');
      // What is left of the unit card (its metadata, the machine, sessions, grants and waiting) belongs with the
      // controls in Details; the conversation keeps only messages, as the board draws it.
      for (const part of [...review.children]) {
        part.remove();
        // Nested disclosures open flat inside Details: one Details, not three.
        for (const inner of [part, ...(part.querySelectorAll?.('details') ?? [])]) if (inner.matches?.('details')) inner.setAttribute('open', '');
        controls.append(part);
      }
      // Asks and task cards belong to the conversation: they scroll with the messages, in one scroll area.
      if (cards) {
        const field = panel.querySelector('.field');
        if (scroll) scroll.append(cards);
        else if (!(field && placeBefore(field, cards))) panel.append(cards);
      }
      inspectorBody.append(panel);
    } else {
      const heading = element(document, "h2", { text: selected ? unitDisplayName(selected) : t("nothingSelected") });
      if (selected) heading.replaceChildren(unitNameNode(document, selected), element(document, "span", { class: "unit-state", text: t(statusKey(selected.status)) }));
      if (selected && app.layout !== 'phone') {
        inspectorBody.append(renderAgentHeader(document, selected, sessionForUnit(app, selected.id), app.language, () => openAgentMore(app, selected)));
        const actions = trackDisclosure(app, element(document, 'details', { class: 'agent-controls' }, element(document, 'summary', { text: t('details') }), actionControls(app, t, selected)), `agent-controls:${selected.id}`);
        inspectorBody.append(actions);
      } else inspectorBody.append(...(selected ? [heading] : []), actionControls(app, t, selected));
      if (app.layout !== "phone") {
        if (!selected && !app.thread?.chat) inspectorBody.append(emptySelection(app, t));
        inspectorBody.append(chatPanel(app, t), renderInspector(app, t, selected));
      }
    }
  }
  if (app.mapToast) inspectorBody.append(mapToast(app, t));
  if (app.startError) inspectorBody.append(element(document, 'p', { role: 'alert', text: startText(app.language, 'unavailable') }),
    mapButton(app, 'retry-start-reports', startText(app.language, 'retry'), async () => { await loadStartReports(app); maybeStartDiscovery(app); }));
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

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? Math.trunc(number) : null;
}

function openingViewRecord(view) {
  const units = finiteCount(view?.counts?.units);
  const chats = finiteCount(view?.counts?.chats);
  if (units == null || chats == null) return null;
  const groups = finiteCount(Number.isInteger(view.groupCount) ? view.groupCount : view.groups?.length ?? 0);
  const boards = finiteCount(Number.isInteger(view.boardCount) ? view.boardCount : (view.editors ?? []).filter((editor) => editor.kind === "blueprint").length);
  if (groups == null || boards == null) return null;
  return { counts: { units, chats }, groupCount: groups, boardCount: boards };
}

function rememberOpeningView(app) {
  const record = openingViewRecord(app.store.view);
  if (!record) return;
  try { app.startStorage?.setItem("hivem1nd:opening-view", JSON.stringify(record)); } catch { /* Storage can be unavailable in a private viewer. */ }
}

function restoreOpeningView(app) {
  if (app.store.view?.counts) return;
  let parsed = null;
  try { parsed = JSON.parse(app.startStorage?.getItem?.("hivem1nd:opening-view") ?? "null"); } catch { parsed = null; }
  const record = openingViewRecord(parsed);
  if (record) app.store.view = record;
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
    const record = openingViewRecord(app.store.view);
    if (record) content.append(element(document, "p", { class: "opening-counts", text: openingText(app, "counts", { units: record.counts.units, groups: record.groupCount, chats: record.counts.chats, boards: record.boardCount }) }));
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

async function loadLists(app) {
  app.unitList = createPagedList({ api: app.api, store: app.store, name: "units", route: "/units" });
  app.chatList = createPagedList({ api: app.api, store: app.store, name: "chats", route: "/chats", filters: { listed: "true" } });
  app.waitingList = createPagedList({ api: app.api, store: app.store, name: "waiting", route: "/waiting" });
  const refresh = () => {
    if (!app.disposed && app.layout !== "unknown") renderShell(app);
  };
  // An open Attach agents picker also lists agents that arrive after it opened.
  app.unitList.onUpdate = () => { refresh(); app.attachRepaint?.(); };
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

function openPhoneSettings(app) {
  settingsState(app).tab = 'general';
  navigate(app, 'settings');
  const section = app.root.querySelector('[data-home]');
  section?.scrollIntoView?.({ block: 'nearest' });
  (section?.querySelector('[data-action="open-home"], [data-action="replace-home"], [data-addresses]') ?? section)?.focus?.();
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
    placeholder: t("search"),
  });
  search.value = list?.query ?? "";
  search.addEventListener("input", () => {
    if (list) setQuery(list, search.value);
  });
  const total = list?.total ?? 0;
  // Waiting takes the stage for a while: a way back to the Map, then the search.
  if (app.layout !== "phone") surface.append(element(document, "div", { class: "waiting-head" },
    element(document, "button", { type: "button", class: "btn quiet", "data-action": "waiting-back", onclick: () => { app.waitingOpen = false; app.mode = "map"; renderShell(app); } },
      icon(document, "map"), t("showMap"))));
  surface.append(search, element(document, "p", {
    "data-waiting-total": String(total),
    text: cardinal(app.language, "waitingCount", total),
  }));
  if (!list) {
    surface.append(progressMark(document, t("loadingList")));
    return surface;
  }
  // A refresh under items already shown keeps them; the loading line is only for an empty list.
  if (list.status === "loading" && !(list.items ?? []).length) surface.append(progressMark(document, t("loadingList"), { "data-list-progress": "true" }));
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
  if (!items.length && list.status !== "loading") {
    const emptyText = (key) => t(app.layout === "phone" && key === "emptyWaitingNext" ? "phoneNavHint" : key);
    surface.append(renderWaiting(document, [], emptyText, (item) => openWaitingItem(app, item), showMapButton(app, document, t)));
  } else if (items.length) {
    // Every loaded item shows; the cards have no fixed height for a scroll window, so more come a page at a time.
    surface.append(renderWaiting(document, items, t, (item) => openWaitingItem(app, item)));
    if (list.nextCursor) surface.append(element(document, "button", { type: "button", class: "btn", "data-action": "waiting-more",
      text: t("showMore", { count: Math.max(0, total - items.length) }),
      onclick: () => loadNext(list).then(() => { if (!app.disposed) renderShell(app); }).catch((error) => noteAction(app, error)) }));
  }
  surface.append(renderWaitingRecord(app, t));
  return surface;
}

function openWaitingItem(app, item) {
  if (!item) return;
  if (item.kind === 'plan' && item.planId && app.layout !== 'phone') {
    const plan = app.store.indexes.plans.get(item.planId);
    app.waitingOpen = false; app.mode = 'map';
    if (plan) selectGroup(app, plan.clusterId);
    if (item.approvalId) settle(app, `waiting:${item.id}`, text(app.language, 'loadingList'), async () => {
      const result = await request(app.api, 'GET', `/approvals/${encodeURIComponent(item.approvalId)}`);
      app.waitingRecord = { kind: 'approval', approval: result.data, item };
    });
    return;
  }
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

function renderWaitingRecord(app, t, record = app.waitingRecord) {
  const document = app.root.ownerDocument;
  const block = element(document, "div", { "data-waiting-record": record?.kind ?? "" });
  if (!record) return block;
  const extension = record.item?.extension ?? app.waitingList?.items?.find(item => item.approvalId === record.approval?.id)?.extension;
  if (extension) block.append(element(document, 'p', { 'data-plan-extension': 'true', text: startText(app.language, 'extension', { count: extension.count, task: extension.taskId ?? '' }) }),
    element(document, 'p', { 'data-extension-reason': 'true', text: extension.reason }));
  const caps = app.store.capabilities ?? [];
  if (record.kind === "approval" && record.approval && caps.includes("approval.answer")) {
    block.append(renderApproval(document, record.approval, t, (item, decision) => answerSelected(app, item, decision), activityPending(app, `approval:${record.approval.id}`), app.store.audience !== 'phone'));
    return block;
  }
  if (record.kind === "review" && record.task && (caps.includes("task.status") || caps.includes("task.accept") || caps.includes("task.send-back"))) {
    const phone = app.store.audience === "phone";
    const noteDraft = inputDrafts(app).notes.get(record.task.id);
    const taskBusy = activityPending(app, `task:${record.task.id}`) || activityPending(app, `undo:${record.task.id}`);
    block.append(renderTask(document, record.task, t, (item, status, note) => status === "open" ? confirmSendBack(app, item, note) : setTaskStatus(app, item, status, note), !phone && caps.includes("task.undo") ? (item) => undoSelected(app, item) : null, noteDraft?.value ?? "", (value, start, end) => {
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
  const rows = collectionRows(app, t, list);
  // The list is only "loading" for the person while it has nothing to show. Rows already drawn stay, and a reload behind them says nothing.
  const showing = rows.some((row) => row.unit || row.kind === "cluster" || row.kind === "chat");
  const loading = list.status === "loading" || list.status === "idle", waiting = loading && !showing;
  const status = list.status === "error" ? t("listError") : waiting ? "" : list.status === "empty" ? (list.query ? t("emptySearch") : emptyCollectionText(t, list.name)) : t("listTotal", { count: formatNumber(app.language, list.total ?? rows.length) });
  // A list that shows rows says its count only to assistive technology; the board shows the rows, not a count.
  const total = element(document, "p", { class: `list-total${list.status === "ready" || (loading && showing) ? " visually-hidden" : ""}`, "data-total": String(list.total ?? ""), "data-list-status": list.status, text: status });
  // One mark carries the loading text, so the sentence is never written twice.
  if (waiting) total.append(progressMark(document, t("loadingList"), { "data-list-progress": "true" }));
  if (list.status === "error") {
    total.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "retry-list",
      text: t("retry"),
      onclick: () => reloadList(list),
    }));
  }
  const host = element(document, "div", { class: "list", role: "listbox", "aria-label": t(app.tab), "data-collection": "true", "aria-busy": list.status === "loading" ? "true" : null });
  if (app.tab === "hierarchy") {
    host.addEventListener("contextmenu", (event) => hierarchyMenu(app, event));
    host.addEventListener("keydown", (event) => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) hierarchyMenu(app, event); });
  }
  const handlers = {
    selectedId: app.tab === "chats" ? app.store.selected.chatId : app.store.selected.groupId ? `cluster:${app.store.selected.groupId}` : app.store.selected.unitId,
    onActivate: (row, kind) => {
      if (row.kind === "cluster") {
        if (kind === 'single' && app.lastClusterClick?.id === row.groupId && app.api.now() - app.lastClusterClick.at < 500) kind = 'double';
        app.lastClusterClick = kind === 'single' ? { id: row.groupId, at: app.api.now() } : null;
        if (kind === 'double') openCluster(app, row.groupId);
        selectGroup(app, row.groupId);
        if (kind === 'double') app.pendingClusterFlight = row.groupId;
        else toggleGroup(app.hierarchy, row.id);
      } else if (row.kind === 'worktree') {
        selectGroup(app, row.groupId);
        if (kind === 'double') app.pendingClusterFlight = row.groupId;
      } else if (row.kind === "chat") {
        app.store.selected.chatId = row.id;
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
    onReveal: (groupId, count) => {
      revealGroup(app.hierarchy, groupId, count);
      renderShell(app);
    },
  };
  app.activeList = list;
  app.activeRows = rows;
  app.activeHandlers = handlers;
  // With no cluster yet, the hint sits under the Clusters heading at the top, not at the foot of the panel.
  const noClusters = app.tab === 'hierarchy' && ![...app.store.indexes.groups.values()].some(group => !group.deleted)
    ? element(document, 'p', { class: 'start-hint empty-clusters', text: startText(app.language, 'noClusters') }) : null;
  block.append(search, total, host);
  if (noClusters) block.append(noClusters);
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
      await loadCatalog(app.api, editors, kind);
    } catch (error) {
      editors.loadedKind = kind;
      throw error;
    } finally {
      editors.catalogLoading = false;
    }
  }, (error) => noteEditor(app, error, `catalog:${kind}`));
}

function boardSurface(app, document, editor, t) {
  const host = element(document, "div", { class: "board-host", "data-board-tool": editor.boardTool ?? "select" });
  const canvas = element(document, "div", { class: "board-canvas" });
  app.editors.selectedNodeId = editor.selectedNodeId ?? null;
  editor.focus = app.editors.focus?.resourceId === editor.resourceId ? app.editors.focus : null;
  editor.viewport = app.editors.viewport;
  editor.panned = app.editors.panned === true && !editor.boardDraft;
  const repaint = () => { renderBoard(document, canvas, editor); paintBoardSelection(app, document, host, editor, t); };
  host.append(canvas, boardToolbar(app, document, editor, t), boardProperties(app, document, editor, t));
  const editable = canEditResources(app) && !editor.authoritative.readOnly;
  let gesture = null, suppressClick = false;
  const targetAt = (event) => {
    const point = boardPoint(canvas.querySelector("svg"), event);
    const screenId = event.target?.getAttribute?.("data-screen");
    if (screenId) return { kind: "screen", screenId, ...point };
    const hit = hitBoardNode(boardDocument(editor), point);
    return hit ? { kind: "node", ...hit, ...point } : { kind: "canvas", ...point };
  };
  const nativeStrokeHits = (event) => {
    const ids = [];
    for (const path of canvas.querySelectorAll("path[data-kind='pen']")) {
      if (!path.isPointInStroke || !path.getScreenCTM || !canvas.querySelector("svg").createSVGPoint) continue;
      const cursor = canvas.querySelector("svg").createSVGPoint(); cursor.x = event.clientX; cursor.y = event.clientY;
      if (path.isPointInStroke(cursor.matrixTransform(path.getScreenCTM().inverse()))) ids.push(path.closest("[data-node]").getAttribute("data-node"));
    }
    return ids;
  };
  const cancel = () => {
    if (!gesture) return;
    editor.boardDraft = gesture.previous && JSON.stringify(gesture.previous) !== JSON.stringify(editor.authoritative.document) ? gesture.previous : null;
    editor.dirty = Boolean(editor.boardDraft) || gesture.dirty && Boolean(editor.commentText || editor.nodeDraft);
    const pointerId = gesture.pointerId;
    gesture = null;
    editor.boardGesture = false;
    host.releasePointerCapture?.(pointerId);
    renderShell(app);
  };
  host.addEventListener("pointerdown", (event) => {
    if (gesture || event.button > 0) return;
    if (event.target?.closest?.("button, input, textarea, details, [data-toolbar]")) {
      if (!event.target?.closest?.("[data-resize]")) return;
    }
    const target = targetAt(event), board = boardDocument(editor), tool = editor.boardTool ?? "select";
    const corner = event.target?.closest?.("[data-resize]")?.getAttribute("data-resize") ?? null;
    if (tool === "comment") { chooseBoardTarget(app, editor, target); editor.commentPopover = true; renderShell(app); return; }
    if (tool === "text") { if (editable) insertBoardText(app, editor, target, document, host); return; }
    if (!editable || editor.conflict) return;
    if (tool === "select" && !corner) chooseBoardTarget(app, editor, target, false);
    const item = indexNodes(board).get(corner ? editor.selectedNodeId : target.nodeId);
    if (tool === "select" && !item) { renderShell(app); return; }
    const sketch = tool === "draw" ? [...(board.screens ?? [])].reverse().find((screen) => screen.root?.sketch && target.x >= screen.x && target.x <= screen.x + screen.w && target.y >= screen.y && target.y <= screen.y + screen.h) : null;
    if (tool === "draw" && !sketch && editor.drawTool !== "eraser") return;
    if (editor.boardErasing || (tool === "draw" && editor.drawTool === "eraser" && editor.boardDraft)) return;
    gesture = { pointerId: event.pointerId, tool, corner, item, sketch, start: target, points: [target], previous: editor.boardDraft,
      dirty: editor.dirty, base: structuredClone(board), removed: new Set(), moved: false };
    if (tool === "draw" && editor.drawTool === "eraser") {
      for (const id of [...touchedStrokes(board, target), ...nativeStrokeHits(event)]) gesture.removed.add(id);
      gesture.moved = gesture.removed.size > 0;
    }
    editor.boardGesture = true;
    suppressClick = true;
    host.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  });
  host.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const point = boardPoint(canvas.querySelector("svg"), event), current = gesture;
    const next = structuredClone(current.base);
    current.moved ||= Math.hypot(point.x - current.start.x, point.y - current.start.y) > 0.5;
    if (current.tool === "select") {
      const start = parentPoint(current.base, current.item.node.id, current.start), end = parentPoint(current.base, current.item.node.id, point);
      Object.assign(indexNodes(next).get(current.item.node.id).node, dragNodeGeometry(current.item.node, end.x - start.x, end.y - start.y, current.corner));
    } else if (current.tool === "frame") {
      addBoardFrame(next, "preview-frame", { x: Math.min(point.x, current.start.x), y: Math.min(point.y, current.start.y) },
        { w: Math.abs(point.x - current.start.x), h: Math.abs(point.y - current.start.y) }, boardColors(document, host));
    } else if (editor.drawTool === "eraser") {
      const last = current.points.at(-1);
      for (const id of touchedStrokes(current.base, last, point)) current.removed.add(id);
      // Native SVG geometry also covers retained curves from Lite boards.
      for (const id of nativeStrokeHits(event)) current.removed.add(id);
      current.points.push(point);
      for (const item of indexNodes(next).values()) if (item.node.kids) item.node.kids = item.node.kids.filter((node) => !current.removed.has(node.id));
    } else {
      if (current.points.length < 180) current.points.push(point); else current.points[current.points.length - 1] = point;
      sketchStroke(next, current.sketch, "preview-stroke", current.points, boardColors(document, host)[editor.drawColor ?? "text"], editor.drawTool === "marker");
    }
    editor.boardDraft = next;
    repaint();
  });
  host.addEventListener("pointerup", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const current = gesture;
    gesture = null;
    editor.boardGesture = false;
    host.releasePointerCapture?.(event.pointerId);
    if (!current.moved) { editor.boardDraft = current.previous && JSON.stringify(current.previous) !== JSON.stringify(editor.authoritative.document) ? current.previous : null; renderShell(app); return; }
    if (current.tool === "draw" && editor.drawTool === "eraser") {
      editor.boardDraft = current.previous;
      editor.boardErasing = true;
      editorAct(app, `erase:${editor.resourceId}`, t("eraser"), async (record) => {
        try {
        for (const id of current.removed) {
          if (!indexNodes(editor.authoritative.document).has(id)) continue;
          await removeNode(app.api, editor, id, record.operation);
          record.operation = null;
        }
        } finally { editor.boardErasing = false; }
      });
      return;
    }
    const next = editor.boardDraft;
    if (current.tool === "frame") {
      const frame = next.screens.at(-1), id = `frame-${operationId()}`;
      frame.id = id; frame.root.id = `${id}-root`;
      next.pages[0].order = next.pages[0].order.map((item) => item === "preview-frame" ? id : item);
      if (next.pages[0].start === "preview-frame") next.pages[0].start = id;
    } else if (current.tool === "draw") {
      const stroke = indexNodes(next).get("preview-stroke").node; stroke.id = `stroke-${operationId()}`;
    }
    editor.boardDraft = current.previous;
    setBoardDraft(editor, next);
    saveBoardDraft(app, editor);
  });
  host.addEventListener("pointercancel", cancel);
  host.addEventListener("lostpointercapture", cancel);
  host.addEventListener("click", (event) => {
    if (event.target?.closest?.("button, input, textarea, details, [data-toolbar]")) return;
    if (suppressClick) { suppressClick = false; return; }
    const target = targetAt(event);
    chooseBoardTarget(app, editor, target);
    if (editor.boardTool === "comment") { editor.commentPopover = true; renderShell(app); }
  });
  host.addEventListener("keydown", (event) => {
    if (event.target?.closest?.("input, textarea")) return;
    if (event.key === "Escape") { cancel(); editor.commentPopover = false; return; }
    const nodeId = event.target?.closest?.("[data-node]")?.getAttribute("data-node") ?? editor.selectedNodeId;
    const item = indexNodes(boardDocument(editor)).get(nodeId);
    if (["Enter", " ", "c", "C"].includes(event.key) && item) {
      event.preventDefault?.();
      chooseBoardTarget(app, editor, { kind: "node", nodeId, screenId: item.screen.id, x: item.x, y: item.y }, false);
      if (event.key.toLowerCase() === "c") editor.commentPopover = true;
      renderShell(app);
    } else if (editable && item && !editor.conflict && !editor.boardErasing && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault?.();
      const step = event.shiftKey ? 10 : 1, next = structuredClone(boardDocument(editor));
      Object.assign(indexNodes(next).get(nodeId).node, dragNodeGeometry(item.node,
        event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
      setBoardDraft(editor, next); saveBoardDraft(app, editor);
    }
  });
  repaint();
  document.defaultView?.requestAnimationFrame?.(() => { if (host.isConnected) paintBoardSelection(app, document, host, editor, t); });
  return host;
}

function boardProperties(app, document, editor, t) {
  const host = element(document, "details", { class: "board-properties" });
  host.append(element(document, "summary", { "aria-label": t("finalMore"), title: t("finalMore"), text: "⋯" }));
  const nodes = editor.authoritative.document.screens?.[0];
  const tools = element(document, "div", { class: "board-property-fields" });
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
  host.append(element(document, "div", { class: "board-property-menu" }, tools, boardOutline(app, document, editor, t)));
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

function chooseBoardTarget(app, editor, target, render = true) {
  const located = { resourceId: editor.resourceId, x: target.x ?? 0, y: target.y ?? 0 };
  if (target.kind === "node") {
    app.editors.selectedNodeId = target.nodeId;
    editor.selectedNodeId = target.nodeId;
    app.editors.focus = { screenId: target.screenId, nodeId: target.nodeId, resourceId: editor.resourceId };
    app.editors.commentTarget = { ...located, kind: "node", nodeId: target.nodeId, screenId: target.screenId };
  } else if (target.kind === "screen") {
    app.editors.selectedNodeId = null;
    editor.selectedNodeId = null;
    app.editors.focus = { screenId: target.screenId, nodeId: null, resourceId: editor.resourceId };
    app.editors.commentTarget = { ...located, kind: "screen", screenId: target.screenId };
  } else {
    app.editors.selectedNodeId = null;
    editor.selectedNodeId = null;
    app.editors.commentTarget = { ...located, kind: "canvas" };
  }
  if (render) renderShell(app);
}

function boardOutline(app, document, editor, t) {
  const board = boardDocument(editor);
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
    x: indexNodes(boardDocument(editor)).get(node.id)?.x ?? 0,
    y: indexNodes(boardDocument(editor)).get(node.id)?.y ?? 0,
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
  if (!svg?.createSVGPoint || !svg.getScreenCTM?.()) return { x: event.offsetX ?? 0, y: event.offsetY ?? 0 };
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(svg.getScreenCTM().inverse());
  return { x: local.x, y: local.y };
}

function boardToolbar(app, document, editor, t) {
  const bar = element(document, "div", { class: "toolbar board-toolbar", role: "toolbar", "aria-label": t("boards"), "data-toolbar": "board" });
  const tools = element(document, "div", { class: "board-tools" });
  const paths = { select: "M5 3v16l4-5 4 7 3-2-4-7h7z", frame: "M4 4h16v16H4z", text: "M4 5h16M12 5v15M8 20h8", draw: "M4 20l4-1L20 7l-4-4L4 15z", comment: "M4 5h16v12H9l-5 4z" };
  for (const tool of ["select", "frame", "text", "draw", "comment"]) {
    const label = t(`board${tool[0].toUpperCase()}${tool.slice(1)}`);
    const glyph = pathIcon(document, paths[tool]);
    tools.append(element(document, "button", { type: "button", class: "board-tool", "data-board-tool": tool, "aria-label": label, title: label,
      "aria-pressed": String((editor.boardTool ?? "select") === tool), disabled: tool !== "select" && (!canEditResources(app) || editor.authoritative.readOnly) ? "" : null,
      onclick: () => {
        editor.boardTool = tool; editor.commentPopover = false;
        if (tool === "draw" && !boardDocument(editor).screens?.some((screen) => screen.root?.sketch)) {
          const board = structuredClone(boardDocument(editor));
          const reference = board.screens.find((screen) => screen.id === app.editors.focus?.screenId) ?? board.screens.at(-1);
          addBoardFrame(board, `sketch-${operationId()}`, { x: (reference?.x ?? 0) + 350, y: (reference?.y ?? 0) + 120 }, { w: 300, h: 560 }, boardColors(document, app.root), true, app.language);
          editor.boardView = boardBounds(board); setBoardDraft(editor, board); saveBoardDraft(app, editor);
        }
        renderShell(app);
      } }, glyph));
  }
  bar.append(tools, element(document, "span", { class: "board-divider", "aria-hidden": "true" }));
  if (editor.boardTool === "draw") {
    for (const color of ["text", "accent", "wait"]) bar.append(element(document, "button", { type: "button", class: `board-swatch board-swatch-${color}`,
      "data-draw-color": color, "aria-label": t(`boardColor${color[0].toUpperCase()}${color.slice(1)}`), "aria-pressed": String((editor.drawColor ?? "text") === color),
      onclick: () => { editor.drawColor = color; renderShell(app); } }, element(document, "span", { "aria-hidden": "true" })));
    for (const tool of ["pen", "marker", "eraser"]) bar.append(element(document, "button", { type: "button", class: "board-draw-tool", "data-draw-tool": tool,
      "aria-pressed": String((editor.drawTool ?? "pen") === tool), text: t(tool), onclick: () => { editor.drawTool = tool; renderShell(app); } }));
    bar.append(element(document, "span", { class: "board-divider", "aria-hidden": "true" }));
  }
  return bar;
}

function saveBoardDraft(app, editor) {
  syncViewerDirty(app);
  if (editor.conflict || activityPending(app, `board:${editor.resourceId}`)) return;
  return editorAct(app, `board:${editor.resourceId}`, text(app.language, "savingDocument"), async (record) => {
    try {
      while (editor.boardDraft && !editor.boardGesture && !editor.conflict) {
        await replaceBoard(app.api, editor, structuredClone(editor.boardDraft), record.operation);
        record.operation = null;
      }
      syncViewerDirty(app);
    } catch (error) {
      if (error.code === "revision_conflict") {
        editor.remoteStale = true;
        await refreshRemoteEditor(app.api, app.editors, editor.resourceId);
      }
      throw error;
    }
  });
}

function insertBoardText(app, editor, target, document, host) {
  const board = structuredClone(boardDocument(editor));
  const hit = indexNodes(board).get(target.nodeId);
  const parent = hit?.node.t === "box" ? hit : hit?.ancestors.length ? indexNodes(board).get(hit.ancestors.at(-1).id) : null;
  if (!parent) return;
  const node = { id: `text-${operationId()}`, name: "Text", t: "text", value: "Text", size: 14, weight: 400, align: "left",
    color: boardColors(document, host).text, place: { x: target.x - parent.x, y: target.y - parent.y }, w: 160, h: 24 };
  appendBoardNode(board, parent.screen.id, parent.node.id, node);
  editor.selectedNodeId = node.id; app.editors.selectedNodeId = node.id; editor.boardTool = "select";
  setBoardDraft(editor, board); saveBoardDraft(app, editor);
}

function boardPixel(svg, host, point) {
  if (!svg?.createSVGPoint || !svg.getScreenCTM?.()) return point;
  const cursor = svg.createSVGPoint(); cursor.x = point.x; cursor.y = point.y;
  const projected = cursor.matrixTransform(svg.getScreenCTM()), bounds = host.getBoundingClientRect();
  return { x: projected.x - bounds.left + (host.scrollLeft ?? 0), y: projected.y - bounds.top + (host.scrollTop ?? 0) };
}

function paintBoardSelection(app, document, host, editor, t) {
  const properties = host.querySelector(".board-properties");
  if (properties) { properties.hidden = true; host.append(properties); }
  for (const node of host.querySelectorAll("[data-board-overlay]")) node.remove();
  const svg = host.querySelector(".board-svg"), board = boardDocument(editor);
  const point = (value) => boardPixel(svg, host, value);
  const position = (node, value) => { const pixel = point(value); node.style.left = `${pixel.x}px`; node.style.top = `${pixel.y}px`; return node; };
  const item = indexNodes(board).get(editor.selectedNodeId);
  if (item && ["select", "comment"].includes(editor.boardTool ?? "select")) {
    const start = point(item), end = point({ x: item.x + item.node.w, y: item.y + item.node.h });
    const outline = position(element(document, "div", { class: "board-selection", "data-board-overlay": "selection" }), item);
    outline.style.width = `${end.x - start.x}px`; outline.style.height = `${end.y - start.y}px`; host.append(outline);
    if ((editor.boardTool ?? "select") === "select" && canEditResources(app) && !editor.authoritative.readOnly && !editor.conflict) {
      for (const corner of ["nw", "ne", "sw", "se"]) host.append(position(element(document, "button", { type: "button", class: "board-resize",
        "data-board-overlay": "handle", "data-resize": corner, "aria-label": t("boardResize", { corner }),
        onkeydown: (event) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault?.(); event.stopPropagation?.();
          const next = structuredClone(boardDocument(editor));
          Object.assign(indexNodes(next).get(item.node.id).node, dragNodeGeometry(item.node, event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0,
            event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0, corner));
          setBoardDraft(editor, next); saveBoardDraft(app, editor);
        } }), { x: item.x + (corner.includes("e") ? item.node.w : 0), y: item.y + (corner.includes("s") ? item.node.h : 0) }));
      const bar = element(document, "div", { class: "board-element-bar", "data-board-overlay": "element", "aria-label": t("boardElement") },
        element(document, "strong", { text: item.node.name }), element(document, "span", { class: "board-dimensions", text: `${Math.round(item.node.w)} × ${Math.round(item.node.h)}` }));
      const fill = element(document, "input", { type: "color", "aria-label": t("boardFill"), "data-node-fill": item.node.id });
      fill.value = /^#[\da-f]{6}$/i.test(item.node.fill ?? item.node.color ?? "") ? item.node.fill ?? item.node.color : boardColors(document, app.root).card;
      fill.addEventListener("change", () => {
        const next = structuredClone(boardDocument(editor)), node = indexNodes(next).get(item.node.id).node;
        node[node.t === "text" && node.fill === undefined ? "color" : "fill"] = fill.value;
        setBoardDraft(editor, next); saveBoardDraft(app, editor);
      });
      bar.append(element(document, "label", {}, fill, t("boardFill")));
      if (item.node.t === "text") {
        const value = element(document, "input", { type: "text", maxlength: "20000", "data-node-text": item.node.id, "data-keep": keepId("board-text", editor.resourceId, item.node.id), "aria-label": t("boardText") });
        value.value = item.node.value;
        value.addEventListener("input", () => {
          const next = structuredClone(boardDocument(editor)); indexNodes(next).get(item.node.id).node.value = value.value;
          setBoardDraft(editor, next); saveBoardDraft(app, editor);
        });
        bar.append(value);
      }
      if (properties) { properties.hidden = false; bar.append(properties); }
      const pixel = point({ x: item.x, y: item.y + item.node.h }); bar.style.left = `${pixel.x - 30}px`; bar.style.top = `${pixel.y + 16}px`; host.append(bar);
    }
  }
  for (const [index, thread] of (editor.threads ?? []).filter((thread) => !thread.pending && thread.status !== "resolved").entries()) {
    const anchor = thread.anchor;
    if (!anchor?.point) continue;
    const pin = position(element(document, "button", { type: "button", class: "board-comment-pin", "data-board-overlay": "pin", "data-comment-pin": thread.id,
      "aria-label": t("boardCommentNumber", { count: index + 1 }), text: index + 1, onclick: () => {
        app.editors.commentTarget = { resourceId: editor.resourceId, kind: anchor.element ? "node" : anchor.screen ? "screen" : "canvas",
          nodeId: anchor.element, screenId: anchor.screen, ...anchor.point };
        editor.commentPopover = true; renderShell(app);
      } }), anchor.point); host.append(pin);
  }
  if (editor.commentPopover) {
    const anchor = currentCommentAnchor(app);
    if (!anchor) return;
    const popover = element(document, "div", { class: "board-comment-popover", "data-board-overlay": "comment", role: "dialog", "aria-label": t("boardComment") }, element(document, "p", { class: "board-breadcrumb", text: anchor.path.join(" / ") }));
    const field = element(document, "textarea", { "data-board-comment": "true", "data-keep": keepId("board-comment", editor.resourceId), "aria-label": t("boardComment") }); field.value = editor.commentText ?? "";
    const submit = element(document, "button", { type: "button", class: "btn primary", text: t("boardComment"), disabled: !field.value.trim() ? "" : null, onclick: () => {
      sendEditorComment(app, editor, anchor, field.value); editor.commentPopover = false;
    } });
    field.addEventListener("input", () => { editor.commentText = field.value; submit.disabled = !field.value.trim(); syncViewerDirty(app); });
    popover.append(field, commentPreferenceControl(app, document, editor, t), element(document, "div", { class: "board-comment-actions" }, element(document, "button", { type: "button", class: "btn", text: t("cancel"), onclick: () => { editor.commentPopover = false; renderShell(app); } }), submit));
    const pixel = point(anchor.point); popover.style.left = `${Math.max(0, Math.min(host.clientWidth - 320, pixel.x + 32))}px`; popover.style.top = `${pixel.y}px`; host.append(popover);
  }
  if (editor.conflict) host.append(boardConflict(app, document, editor, t));
}

function boardConflict(app, document, editor, t) {
  const banner = element(document, "div", { class: "board-conflict", "data-board-overlay": "conflict", "data-conflict": "true" }, element(document, "span", { text: t("outsideChange") }));
  const pending = app.activity.get(`board:${editor.resourceId}`);
  const unconfirmed = editor.boardSaving || app.api.uncertain.has(pending?.operation?.id);
  const uncertainDecision = editor.historyOperation?.body?.decision;
  for (const [key, action] of [["showChanges", "show-changes"], ["keepMine", "reapply-draft"], ["reloadBoard", "discard-draft"]]) banner.append(element(document, "button", { type: "button", class: "btn", "data-action": action, text: t(key), disabled: key !== "showChanges" && (unconfirmed || editor.historyPending || uncertainDecision && uncertainDecision !== (key === "keepMine" ? "keep-mine" : "reload")) ? "" : null, onclick: async () => {
    if (key === "showChanges") { editor.showChanges = !editor.showChanges; renderShell(app); return; }
    await answerEditorConflict(app, editor, key === "keepMine" ? "keep-mine" : "reload");
  } }));
  if (editor.showChanges) banner.append(element(document, "div", { class: "board-change-preview", "data-board-changes": "true" },
    element(document, "section", {}, element(document, "strong", { text: t("boardLocalVersion") }), element(document, "pre", { text: JSON.stringify(boardDocument(editor), null, 2) })),
    element(document, "section", {}, element(document, "strong", { text: t("boardIncomingVersion") }), element(document, "pre", { text: JSON.stringify(editor.conflict.remote?.document, null, 2) }))));
  return banner;
}

async function answerEditorConflict(app, editor, decision) {
  try {
    const pending = resolveEditorConflict(app.api, app.editors, decision, editor.historyOperation);
    renderShell(app);
    if (!await pending) return;
    app.activity.delete(`board:${editor.resourceId}`);
    editor.showChanges = false;
    if (editor.kind === "blueprint") await loadAssets(app.api, editor);
    if (editor.historyOpen) await loadHistory(app.api, app.editors);
    syncViewerDirty(app);
  } catch (error) { app.actionNote = actionText(app.language, error.code); }
  renderShell(app);
}

function voidSurface(app, document, editor, t) {
  editor.focus = app.editors.focus;
  if (app.voidFind?.open && app.voidFind.resourceId !== editor.resourceId) {
    app.voidFind.resourceId = editor.resourceId;
    scheduleVoidFind(app);
  }
  const pages = editor.authoritative.document.pages ?? [];
  if (!app.voidState || app.voidState.resourceId !== editor.resourceId) {
    const requested = editor.page ?? editor.focus?.k;
    app.voidState = { mode: app.mode, tools: app.mode !== "focus", page: pages.some((page) => page.k === requested) ? requested : pages[0]?.k, pages, resourceId: editor.resourceId };
  } else {
    app.voidState.pages = pages;
    if (!pages.some((page) => page.k === app.voidState.page)) app.voidState.page = pages[0]?.k;
  }
  const lang = editor.findLanguage ?? (app.language === "es" ? "es" : "en"), k = app.voidState.page;
  editor.page = k; editor.language = lang;
  editor.textSelections ??= new Map();
  const selectionEditor = { resourceId: editor.resourceId, page: k, language: lang, textSelections: editor.textSelections };
  if (editor.pendingFindSelection) {
    selectionEditor.textSelections.set(textDraftKey(editor.resourceId, k, lang), editor.pendingFindSelection);
    editor.pendingFindSelection = null;
    editor.restoreCaret = true;
  }
  const page = pages.find((item) => item.k === k);
  const value = () => textDraft(editor, editor.resourceId, k, lang) ?? page?.[lang] ?? "";
  const editable = canEditResources(app) && !editor.authoritative.readOnly && typeof page?.[lang] === "string";
  const focused = app.mode === "focus", sourceMode = Boolean(editor.sourceMode && !focused);
  const finding = !focused && !sourceMode && app.voidFind?.open;
  const surface = element(document, "div", { class: `void-surface${editor.saveState === "not-saved" ? " is-not-saved" : ""}${finding ? " is-finding" : ""}` });
  const host = element(document, "div", { class: "void-page reading-card", "data-void": "true", hidden: sourceMode ? "" : null });
  const title = element(document, "h2", { class: "void-title", "data-void-title": "true", text: editor.authoritative.document.title,
    contenteditable: editable && !focused ? "plaintext-only" : "false", role: "textbox", "aria-label": t("resourceTitle") });
  title.addEventListener("input", () => {
    editor.titleDraft = title.textContent;
    editor.editGeneration = (editor.editGeneration ?? 0) + 1;
    editor.dirty = true;
    queueVoid(app, editor);
  });
  if (editor.titleDraft !== undefined) title.textContent = editor.titleDraft;
  const body = element(document, "div", { class: "void-body", "data-void-body": "true", contenteditable: editable ? "true" : "false", role: "textbox", "aria-multiline": "true", "aria-label": t("document"), lang });
  renderDocument(document, body, editor);
  host.append(title, element(document, "p", { class: "void-subtitle", text: editor.authoritative.document.subtitle ?? k }), body);
  const source = element(document, "textarea", { class: "void-source-input", "data-source": "true", "aria-label": t("sourceLabel"), "data-keep": keepId("source", editor.resourceId, k, lang), readonly: editable ? null : "" });
  source.value = value();
  const sourceCard = element(document, "section", { class: "void-source", "data-source-edit": "true", hidden: sourceMode ? null : "" }, labeledField(document, t("sourceLabel"), t("sourceCaretHint"), source));
  const selectionHost = sourceMode ? source : body;
  editor.captureSelection = () => {
    if (!selectionHost.isConnected) return;
    const active = document.activeElement;
    const range = captureTextSelection(document, selectionHost, selectionEditor, value(), sourceMode);
    if (range && (active === selectionHost || selectionHost.contains?.(active))) editor.restoreCaret = true;
  };
  editor.restoreSelection = () => {
    if (!editor.restoreCaret) return;
    editor.restoreCaret = false;
    restoreTextSelection(document, selectionHost, selectionEditor, value(), sourceMode);
  };
  const apply = (change) => {
    if (!change || !editable) return;
    selectionEditor.textSelections.set(textDraftKey(editor.resourceId, k, lang), { start: change.start, end: change.end });
    rememberTextDraft(editor, editor.resourceId, k, lang, change.source);
    source.value = change.source;
    renderDocument(document, body, editor);
    restoreTextSelection(document, body, selectionEditor, change.source);
    updateFormats();
    queueVoid(app, editor);
  };
  let composing = false, composition = null;
  body.addEventListener("compositionstart", () => { composing = true; editor.textComposing = true; composition = { source: value(), text: plainText(value()) }; });
  body.addEventListener("compositionend", () => { composing = false; editor.textComposing = false; reconcileInput(); composition = null; });
  const renderedText = () => body.textContent ?? "";
  function reconcileInput() {
    if (composing || !editable) return;
    const before = composition?.text ?? plainText(value()), after = renderedText();
    let start = 0, end = before.length, nextEnd = after.length;
    while (start < end && start < nextEnd && before[start] === after[start]) start += 1;
    while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end -= 1; nextEnd -= 1; }
    while (!validUtf16Boundary(before, start) || !validUtf16Boundary(after, start)) start -= 1;
    while (!validUtf16Boundary(before, end)) end += 1;
    while (!validUtf16Boundary(after, nextEnd)) nextEnd += 1;
    if (before !== after) apply(replaceVisible(composition?.source ?? value(), { start, end }, after.slice(start, nextEnd)));
  }
  body.addEventListener("input", reconcileInput);
  body.addEventListener("beforeinput", (event) => {
    if (composing || event.isComposing || event.cancelable === false || !editable) return;
    const selection = document.getSelection?.() ?? document.defaultView?.getSelection?.();
    const target = event.getTargetRanges?.()[0];
    let range = target ? plainOffsets(target.startContainer, target.startOffset, target.endContainer, target.endOffset)
      : selection?.anchorNode && body.contains?.(selection.anchorNode) && body.contains?.(selection.focusNode) ? plainOffsets(selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset) : null;
    if (!range) range = { start: 0, end: 0 };
    const caret = captureTextSelection(document, body, selectionEditor, value());
    if (range.start === range.end && caret && caret.start === caret.end) range.sourceStart = caret.start;
    let inserted = event.data ?? "";
    const input = event.inputType ?? "insertText";
    if (input === "insertParagraph" || input === "insertLineBreak") inserted = "\n";
    else if (["insertFromPaste", "insertFromDrop"].includes(input)) inserted = event.dataTransfer?.getData("text/plain") ?? inserted;
    else if (input.startsWith("delete")) {
      inserted = "";
      if (range.start === range.end && !target) {
        const visible = plainText(value());
        if (input.endsWith("Backward")) { range.start = Math.max(0, range.start - 1); if (!validUtf16Boundary(visible, range.start)) range.start -= 1; }
        else { range.end = Math.min(visible.length, range.end + 1); if (!validUtf16Boundary(visible, range.end)) range.end += 1; }
      }
    } else if (input.startsWith("format")) {
      const format = { formatBold: "bold", formatItalic: "italic", formatStrikeThrough: "strikethrough" }[input];
      event.preventDefault(); if (format) apply(formatSelection(value(), range, format)); return;
    } else if (!input.startsWith("insert")) return;
    event.preventDefault();
    apply(replaceVisible(value(), range, inserted));
  });
  source.addEventListener("input", () => {
    if (!editable) return;
    rememberTextDraft(editor, editor.resourceId, k, lang, source.value);
    captureTextSelection(document, source, selectionEditor, source.value, true);
    queueVoid(app, editor);
  });
  const tools = element(document, "div", { class: `void-tools${app.voidState.tools ? " is-visible" : ""}`, "data-tools": app.voidState.tools ? "visible" : "hidden" });
  const button = (action, label, work, attributes = {}) => {
    const control = element(document, "button", { type: "button", class: "btn", "data-action": action, "aria-label": label, title: label, text: label, onclick: work, ...attributes });
    control.addEventListener("pointerdown", () => editor.captureSelection());
    return control;
  };
  const watchUnit = editor.attached?.[0];
  const attach = button("void-attach", t("finalAttached"), () => openEditorForm(app, "attach"));
  if (focused) {
    tools.append(button("leave-focus", t("document"), () => { editor.captureSelection(); editor.restoreCaret = true; editor.sourceMode = false; leaveFocus(app.voidState); app.mode = "document"; renderShell(app); }));
    tools.append(element(document, "span", { text: t("voidPage", { page: pages.findIndex((page) => page.k === k) + 1, pages: pages.length }) }));
  } else tools.append(attach);
  if (watchUnit) tools.append(element(document, "span", { class: "void-attached", text: unitDisplayName(unitById(app, watchUnit)) }));
  tools.append(button("void-watch", t(app.editors.watch?.state === "watching" ? "finalWatching" : "finalWatch"), () => app.editors.watch?.state === "watching" ? stopEditorWatch(app) : followEditor(app), { disabled: watchUnit ? null : "" }));
  if (!focused) {
    const findButton = button("toggle-find", t("findReplace"), () => {
      app.voidFind ??= { finder: createTextFinder({ createWorker: app.createFindWorker }), resourceId: editor.resourceId, query: '', replacement: '', scope: 'document', options: { caseSensitive: false, wholeWord: false, regularExpression: false }, matches: [], current: 0, generation: 0 };
      app.voidFind.open = !app.voidFind.open;
      if (!app.voidFind.open) { clearTimeout(app.voidFind.timer); app.voidFind.finder.cancel(); app.voidFind.generation++; app.voidFind.pending = false; }
      else { editor.sourceMode = false; scheduleVoidFind(app); }
      renderShell(app);
    }, { "aria-pressed": String(Boolean(app.voidFind?.open)), class: "btn void-find-toggle" });
    findButton.replaceChildren(pathIcon(document, 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6'));
    tools.append(findButton);
    tools.append(button("toggle-source", t("sourceLabel"), () => { editor.captureSelection(); editor.sourceMode = !editor.sourceMode; editor.restoreCaret = true; renderShell(app); }, { "aria-pressed": String(sourceMode) }));
    tools.append(button("enter-focus", t("focus"), () => { editor.captureSelection(); editor.restoreCaret = true; enterFocus(app.voidState); app.mode = "focus"; renderShell(app); }));
  }
  const status = element(document, "span", { class: "void-save-status", "data-void-save": editor.saveState ?? "saved", role: "status", "aria-live": "polite", text: t(editor.saveState === "saving" ? "voidSaving" : editor.saveState === "not-saved" ? "voidNotSaved" : "saved") });
  tools.append(status);
  const formatBar = element(document, "div", { class: "void-format-bar", "data-format-bar": "true", role: "toolbar", "aria-label": t("voidFormat"), hidden: "" });
  const formatCopy = { h1: "H1", h2: "H2", h3: "H3" };
  for (const format of TEXT_FORMATS) {
    if (format === "h1" || format === "list") formatBar.append(element(document, "span", { class: "void-format-divider", role: "separator" }));
    const label = formatCopy[format] ?? t(format === "comment" ? "comment" : `void${format[0].toUpperCase() + format.slice(1)}`);
    const control = button(format === "comment" ? "comment-quote" : `format-${format}`, label, async () => {
      const range = selectedPlainRange(document.getSelection?.() ?? document.defaultView?.getSelection?.()) ?? editor.visibleSelection;
      if (!range) return;
      if (format === "comment") { commentOnQuote(app, editor); return; }
      if (format === "link" || format === "image") { voidFormatTarget(app, editor, format, range, apply); return; }
      apply(formatSelection(value(), range, format));
    }, { "data-format": format });
    const glyph = { bold: "B", italic: "I", strikethrough: "S", list: "☷", quote: "❞", code: "<>", link: "↗", table: "⊞", image: "▧", comment: "◌" }[format] ?? label;
    control.textContent = glyph;
    control.addEventListener("pointerdown", (event) => { event.preventDefault(); editor.captureSelection(); });
    formatBar.append(control);
  }
  function updateFormats() {
    const selection = document.getSelection?.() ?? document.defaultView?.getSelection?.();
    const valid = !sourceMode && editable && selection?.anchorNode && body.contains?.(selection.anchorNode) && body.contains?.(selection.focusNode);
    editor.visibleSelection = valid ? selectedPlainRange(selection) : null;
    formatBar.hidden = !editor.visibleSelection;
    if (formatBar.hidden) { formatBar.setAttribute("hidden", ""); return; }
    formatBar.removeAttribute("hidden");
    const rect = selection?.rangeCount ? selection.getRangeAt?.(0)?.getBoundingClientRect?.() : null;
    const ground = surface.getBoundingClientRect?.();
    if (rect && ground && formatBar.style?.setProperty) {
      formatBar.style.setProperty("left", `${Math.max(4, Math.min(rect.left - ground.left, ground.width - 460))}px`);
      formatBar.style.setProperty("top", `${Math.max(44, rect.top - ground.top - 44)}px`);
    }
  }
  if (!app.onVoidSelection) {
    app.onVoidSelection = () => { app.editors?.current?.captureSelection?.(); app.editors?.current?.updateFormats?.(); };
    document.addEventListener?.("selectionchange", app.onVoidSelection);
  }
  editor.updateFormats = updateFormats;
  body.addEventListener("keyup", updateFormats); body.addEventListener("pointerup", updateFormats);
  surface.append(tools);
  if (finding) surface.append(voidFindBar(app, document, editor, t));
  if (editor.saveState === "not-saved") surface.append(element(document, "div", { class: "void-save-error", "data-void-error": "true", role: "alert" },
    icon(document, "alert"), element(document, "span", { text: t("voidSaveError") }), button("retry-void-save", t("retry"), () => editor.voidSaver?.retry().catch(() => {}))));
  surface.append(host, sourceCard, formatBar);
  const find = app.voidFind;
  const hits = finding ? find.matches.filter((match) => match.resourceId === editor.resourceId && match.k === k && match.lang === lang) : [];
  host.setAttribute('data-find-hits', String(hits.length));
  highlightFind(document, body, hits, find?.matches[find.current]);
  const suggestionTokens = tokenizeMarkup(value());
  const suggestions = (editor.proposals ?? []).filter((proposal) => proposal.state === "pending" && proposal.k === k && proposal.lang === lang && !proposalStale(editor, proposal))
    .map((proposal) => ({ start: plainCaretFromSource(suggestionTokens, proposal.start), end: plainCaretFromSource(suggestionTokens, proposal.end) }));
  highlightFind(document, body, suggestions, null, 'void-suggestion');
  if (focused) {
    surface.append(element(document, "p", { class: "void-focus-hint", "data-focus-hint": "true", text: t("focusHint") }));
    const dots = element(document, "div", { class: "void-page-dots" });
    for (const page of pages) dots.append(button("void-page", t("voidPage", { page: pages.indexOf(page) + 1, pages: pages.length }), () => { editor.captureSelection(); app.voidState.page = page.k; editor.restoreCaret = true; renderShell(app); }, { "data-page-dot": page.k, "aria-pressed": String(page.k === k) }));
    surface.append(dots);
  }
  updateFormats();
  void loadVoidAssets(app, editor, value());
  return surface;
}

function queueVoid(app, editor) {
  if (!editor.voidSaver) editor.voidSaver = documentSaver(app.api, editor, ({ state }) => {
    syncViewerDirty(app);
    if (app.disposed) return;
    const status = app.root.querySelector?.("[data-void-save]");
    if (status && app.editors.current === editor) {
      status.setAttribute("data-void-save", state);
      status.textContent = text(app.language, state === "saving" ? "voidSaving" : state === "not-saved" ? "voidNotSaved" : "saved");
      if (state === "not-saved" || app.root.querySelector?.("[data-void-error]")) renderShell(app);
    }
  });
  const snapshot = JSON.parse(draftSnapshot(editor));
  if (editor.titleDraft !== undefined) snapshot.document.title = editor.titleDraft;
  editor.voidSaver.queue(JSON.stringify(snapshot));
  if (app.voidFind?.open) scheduleVoidFind(app);
  syncViewerDirty(app);
}

function scheduleVoidFind(app) {
  const find = app.voidFind;
  clearTimeout(find.timer); find.finder.cancel(); find.generation++;
  find.matches = []; find.current = 0; find.error = null; find.pending = true;
  find.timer = setTimeout(() => { void runVoidFind(app); }, 120);
}

async function runVoidFind(app) {
  const find = app.voidFind, generation = find.generation, editor = app.editors.current;
  try {
    const drafts = find.scope === 'all' ? [...app.editors.drafts.values()].filter((item) => item.kind === 'void') : [editor];
    for (const draft of drafts) {
      await draft.voidSaver?.flush();
      if (draft.dirty) throw Object.assign(new Error('The draft must be saved first.'), { code: 'find_unsaved' });
    }
    if (find.generation !== generation || app.disposed || !find.open) return;
    const matches = await find.finder.find(app.api, editor, find.query, { ...find.options }, find.scope);
    if (find.generation !== generation || app.disposed) return;
    find.matches = matches;
    const index = matches.findIndex((match) => match.resourceId === editor.resourceId && match.k === editor.page && match.lang === editor.language);
    find.current = Math.max(0, index);
  } catch (error) {
    if (find.generation !== generation || app.disposed || error.code === 'canceled') return;
    find.error = error.code ?? 'find_unavailable';
  } finally {
    if (find.generation === generation && !app.disposed) { find.pending = false; renderShell(app); }
  }
}

function voidFindBar(app, document, editor, t) {
  const find = app.voidFind;
  const bar = element(document, 'section', { class: 'void-find-bar', 'data-find-bar': 'true', 'aria-label': t('findReplace') });
  const input = (name, label) => {
    const field = element(document, 'input', { type: 'text', 'aria-label': label, 'data-find-field': name, 'data-keep': `void-find|${name}`, disabled: find.busy ? '' : null });
    field.value = find[name];
    field.addEventListener('input', () => { find[name] = field.value; if (name === 'query') scheduleVoidFind(app); renderShell(app); });
    return field;
  };
  const button = (action, label, onclick, attributes = {}) => element(document, 'button', { type: 'button', class: 'btn', 'data-action': action, text: label, 'aria-label': label, title: label, onclick, ...attributes });
  const unavailable = find.pending || find.busy || find.error || !find.matches.length;
  const row = element(document, 'div', { class: 'void-find-row' }, element(document, 'div', { class: 'void-find-input' }, input('query', t('findReplace')),
    element(document, 'span', { 'data-find-count': 'true', role: 'status', 'aria-live': 'polite', text: t('findCount', { current: find.matches.length ? find.current + 1 : 0, total: find.matches.length }) })));
  for (const [key, glyph, label] of [['caseSensitive', 'Aa', 'findCase'], ['wholeWord', 'W', 'findWord'], ['regularExpression', '.*', 'findRegex']]) {
    const toggle = button(`find-${key}`, t(label), () => { find.options[key] = !find.options[key]; scheduleVoidFind(app); renderShell(app); }, { class: 'void-find-option', 'aria-pressed': String(find.options[key]), disabled: find.busy ? '' : null });
    toggle.textContent = glyph; row.append(toggle);
  }
  row.append(button('find-previous', t('findPrevious'), () => selectVoidMatch(app, -1), { class: 'void-find-nav', disabled: unavailable ? '' : null }), button('find-next', t('findNext'), () => selectVoidMatch(app, 1), { class: 'void-find-nav', disabled: unavailable ? '' : null }));
  row.children[row.children.length - 2].textContent = '↑'; row.children[row.children.length - 1].textContent = '↓';
  bar.append(row, element(document, 'div', { class: 'void-find-row' }, element(document, 'div', { class: 'void-replace-input' }, input('replacement', t('findReplacement'))),
    button('replace-match', t('findReplaceOne'), () => applyVoidReplace(app, false), { disabled: unavailable || !canEditResources(app) ? '' : null }),
    button('replace-all', t('findReplaceAll', { count: find.matches.length }), () => applyVoidReplace(app, true), { class: 'btn primary', disabled: unavailable || !canEditResources(app) ? '' : null })));
  const scopes = element(document, 'div', { class: 'void-find-scopes' });
  for (const [scope, label] of [['document', 'findDocument'], ['all', 'findAll']]) scopes.append(button(`find-${scope}`, t(label), () => { find.scope = scope; scheduleVoidFind(app); renderShell(app); }, { 'aria-pressed': String(find.scope === scope), disabled: find.busy ? '' : null }));
  scopes.append(element(document, 'span', { text: t('findUndoHint') }));
  bar.append(scopes);
  if (find.undoId) bar.append(button('undo-replace', t('undo'), () => applyVoidReplace(app, false, true), { disabled: find.busy ? '' : null }));
  if (find.error) bar.append(element(document, 'p', { 'data-find-error': find.error, role: 'alert', text: text(app.language, ({ pattern_too_slow: 'findSlow', invalid_pattern: 'findInvalid', too_many_matches: 'findTooMany', find_unsaved: 'findUnsaved', undo_conflict: 'findUndoConflict', range_changed: 'findChanged', revision_conflict: 'findChanged' })[find.error] ?? 'actionFailed') }));
  if (find.operation) bar.append(button('retry-replace', t('retry'), () => applyVoidReplace(app, false, find.undoPending)));
  return bar;
}

async function selectVoidMatch(app, direction) {
  const find = app.voidFind;
  find.current = (find.current + direction + find.matches.length) % find.matches.length;
  const match = find.matches[find.current];
  find.resourceId = match.resourceId;
  if (app.editors.current.resourceId !== match.resourceId) await openEditor(app.api, app.editors, { id: match.resourceId, kind: 'void' });
  const editor = app.editors.current;
  if (editor.resourceId !== match.resourceId) return;
  editor.page = match.k; editor.findLanguage = match.lang;
  if (app.voidState?.resourceId === match.resourceId) app.voidState.page = match.k;
  editor.pendingFindSelection = { start: sourceBoundary(match.source, match.start, 'end'), end: sourceBoundary(match.source, match.end, 'start') };
  renderShell(app);
}

async function applyVoidReplace(app, all, undo = false) {
  const find = app.voidFind;
  if (find.busy) return;
  const matches = all ? find.matches : [find.matches[find.current]].filter(Boolean);
  if (!undo && !matches.length && !find.operation) return;
  const drafts = [...app.editors.drafts.values()].filter((editor) => editor.dirty && (undo || matches.some((match) => match.resourceId === editor.resourceId)));
  if (drafts.length) { find.error = 'find_unsaved'; renderShell(app); return; }
  find.busy = true; find.error = null; find.undoPending = undo;
  clearTimeout(find.timer); find.finder.cancel(); find.generation++;
  renderShell(app);
  try {
    const result = undo ? await undoReplace(app.api, app.editors, find.undoId, find.operation)
      : await replaceMatches(app.api, app.editors, matches, find.replacement, find.options.regularExpression, find.operation);
    find.operation = null; find.undoId = undo ? null : result.data.changeId;
    find.busy = false;
    for (const editor of app.editors.drafts.values()) if (editor.kind === 'void' && editor.dirty && result.data.editors.some((value) => value.id === editor.resourceId)) queueVoid(app, editor);
    scheduleVoidFind(app);
  } catch (error) { find.error = error.code; find.operation = app.api.uncertain.has(error.operation?.id) ? error.operation : null; }
  finally { find.busy = false; if (!app.disposed) renderShell(app); }
}

async function loadVoidAssets(app, editor, source) {
  const references = [...new Set(tokenizeMarkup(source).map((token) => token.image).filter(Boolean))];
  editor.assets ??= new Map();
  editor.loadingAssets ??= new Set();
  for (const src of references) {
    if (!assetIdentity(src) || editor.assets.has(src) || editor.loadingAssets.has(src)) continue;
    editor.loadingAssets.add(src);
    try {
      const image = await fetchAsset(app.api, { url: `/api/v1/editors/${encodeURIComponent(editor.resourceId)}/assets/${assetIdentity(src)}` });
      // An editor dropped while its image loaded keeps nothing: the image is released at once.
      if (app.editors?.drafts?.get?.(editor.resourceId) !== editor) { image?.revoke?.(); continue; }
      editor.assets.set(src, image);
      if (!app.disposed && app.editors.current === editor) renderShell(app);
    } catch { editor.assets.set(src, null); }
    finally { editor.loadingAssets.delete(src); }
  }
}

function voidFormatTarget(app, editor, format, range, apply) {
  const document = app.root.ownerDocument, t = (key) => text(app.language, key);
  const dialog = element(document, "dialog", { class: "dialog", "data-void-format-dialog": format });
  const heading = element(document, "h2", { text: t(format === "link" ? "voidLink" : "voidImage") });
  labelDialog(dialog, heading);
  const input = element(document, "input", { type: "text", "data-format-target": "true" });
  const error = element(document, "p", { role: "alert", class: "field-error" });
  const original = textDraft(editor, editor.resourceId, editor.page, editor.language) ?? editor.authoritative.document.pages.find((page) => page.k === editor.page)[editor.language];
  dialog.append(heading, labeledField(document, t("voidTarget"), t(format === "link" ? "voidLinkHint" : "voidImageHint"), input), error,
    element(document, "button", { type: "button", class: "btn", text: t("cancel"), onclick: () => dialog.close() }),
    element(document, "button", { type: "button", class: "btn primary", text: t("apply"), "data-action": "apply-format-target", onclick: () => {
      try { apply(formatSelection(original, range, format, input.value)); dialog.close(); }
      catch { error.textContent = t("voidInvalidTarget"); }
    } }));
  dialog.addEventListener("close", () => { dialog.remove(); editor.restoreCaret = true; editor.restoreSelection?.(); });
  document.body.append(dialog); dialog.showModal(); input.focus();
}

function appendProposals(app, document, host, editor, t, proposalId = null, discussion = null) {
  for (const proposal of (editor.proposals ?? []).filter((item) => proposalId ? item.id === proposalId : !(editor.threads ?? []).some((thread) => thread.messages?.some((message) => message.proposal?.id === item.id)))) {
    const actions = { busy: activityPending(app, `proposal:${proposal.id}`) || activityPending(app, `proposal-ask:${proposal.id}`) };
    if (app.store.capabilities.includes("proposal.answer")) {
      actions["accept-change"] = () => answerVoid(app, editor, proposal, "accept");
      actions["discard"] = () => answerVoid(app, editor, proposal, "discard");
      actions["edit-change"] = () => { editProposal(editor, proposal, editor.proposalDrafts?.get(proposal.id) ?? proposal.replacement); renderShell(app); app.root.querySelector?.(`[data-proposal-draft='${proposal.id}']`)?.focus?.(); };
      if (canEditResources(app)) actions["edit-passage"] = () => editVoidPassage(app, editor, proposal);
      if (app.store.capabilities.includes("comment.write")) actions["ask-again"] = () => askVoidAgain(app, editor, proposal);
    }
    host.append(renderProposal(document, proposal, { editor, t, actions, discussion }));
  }
}


function commentOnQuote(app, editor) {
  const page = editor.authoritative.document.pages.find((item) => item.k === (editor.page ?? app.voidState.page));
  const lang = app.language === "es" ? "es" : "en";
  const host = app.root.querySelector?.("[data-void]");
  const document = app.root.ownerDocument;
  const selection = document.getSelection?.() ?? document.defaultView?.getSelection?.();
  if (host && selection?.anchorNode && !host.contains(selection.anchorNode)) return;
  const range = selectedPlainRange(selection) ?? editor.visibleSelection;
  if (!page || !range) {
    explain(app, "quoteNeedsSelection");
    return;
  }
  const anchor = textAnchor(editor, page.k, lang, range.start, range.end);
  sendEditorComment(app, editor, anchor, editor.commentText || anchor.quote);
}

function answerVoid(app, editor, proposal, decision) {
  if (activityPending(app, `proposal:${proposal.id}`)) return;
  if (decision === "accept" && editor.dirty) { explain(app, "suggestionUnsaved"); return; }
  const previous = app.activity.get(`proposal:${proposal.id}`);
  if (previous?.operation && (!app.api.uncertain.has(previous.operation.id) || previous.operation.body.decision !== decision)) previous.operation = null;
  return editorAct(app, `proposal:${proposal.id}`, text(app.language, "answering"), async (record) => {
    try {
      await answerProposal(app.api, editor, proposal, decision, record.operation);
      if (decision === "accept") { editor.voidSaver?.dispose(); editor.voidSaver = null; }
    } catch (error) {
      if (error.code === "proposal_stale") {
        editor.staleProposals ??= new Set(); editor.staleProposals.add(proposal.id);
        editor.remoteStale = true;
        await refreshRemoteEditor(app.api, app.editors, editor.resourceId);
      }
      throw error;
    }
  });
}

function editVoidPassage(app, editor, proposal) {
  if (editor.dirty) { explain(app, "suggestionUnsaved"); return; }
  return editorAct(app, `proposal-edit:${proposal.id}`, text(app.language, "editPassage"), async () => {
    editor.remoteStale = true;
    await refreshRemoteEditor(app.api, app.editors, editor.resourceId);
    const passage = proposalPassage(editor, proposal);
    if (!passage) { explain(app, "quoteNeedsSelection"); return; }
    editor.page = proposal.k; editor.findLanguage = proposal.lang; editor.sourceMode = true;
    editor.textSelections ??= new Map();
    editor.textSelections.set(textDraftKey(editor.resourceId, proposal.k, proposal.lang), { start: passage.start, end: passage.end });
    editor.restoreCaret = true;
    if (app.voidState) app.voidState.page = proposal.k;
    if (app.voidFind) app.voidFind.open = false;
    app.mode = "document";
  });
}

function askVoidAgain(app, editor, proposal) {
  if (editor.dirty) { explain(app, "suggestionUnsaved"); return; }
  const key = `proposal-ask:${proposal.id}`;
  if (activityPending(app, key)) return;
  const previous = app.activity.get(key);
  if (previous?.operation && !app.api.uncertain.has(previous.operation.id)) previous.operation = null;
  return editorAct(app, key, text(app.language, "sending"), async (record) => {
    if (!record.operation) {
      editor.remoteStale = true;
      await refreshRemoteEditor(app.api, app.editors, editor.resourceId);
      await loadComments(app.api, { ...app.editors, current: editor });
    }
    const comment = proposalComment(editor, proposal);
    if (!comment && !record.operation) { explain(app, "quoteNeedsSelection"); return; }
    await createComment(app.api, { ...app.editors, current: editor }, comment?.anchor, comment?.text, record.operation, commentChoice(app.editors, editor));
  });
}

function onFocusKey(app, event) {
  if (app.mode !== "focus" || !app.voidState) return;
  if (event.key === "Escape" && !app.root.ownerDocument.querySelector?.("dialog[open]")) {
    app.editors.current?.captureSelection?.();
    if (app.editors.current) { app.editors.current.restoreCaret = true; app.editors.current.sourceMode = false; }
    leaveFocus(app.voidState);
    app.mode = "document";
    renderShell(app);
    const editor = app.editors.current;
    if (!editor?.textSelections?.has(textDraftKey(editor.resourceId, editor.page, editor.language))) {
      app.root.querySelector?.("[data-action='enter-focus']")?.focus?.();
    }
    event.preventDefault();
    return;
  }
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  app.editors.current?.captureSelection?.();
  if (app.editors.current) app.editors.current.restoreCaret = true;
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
  const catalog = renderLibrary(document, { kind, project: current?.authoritative?.project, data: editors, t, actions: libraryActions(app, kind) });
  if (app.catalogOpen) catalog.className += " is-open";
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
    element(document, "h2", { text: t(current?.historyOpen ? "history" : "comments") }),
  );
  const tools = element(document, "div", { class: "editor-tools", "data-editor-tools": "true" },
    watchStatus,
  );
  resource.append(tools);
  if (app.libraryToast) resource.append(renderLibraryToast(app, t));
  if (current?.conflict && current.kind !== "blueprint") {
    resource.append(element(document, "p", { "data-conflict": "true", text: t("outsideChange") }));
    resource.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "discard-draft",
      text: t("discardDraft"),
      disabled: current.historyPending || current.historyOperation && current.historyOperation.body?.decision !== "reload" ? "" : null,
      onclick: () => answerEditorConflict(app, current, "reload"),
    }));
    resource.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "reapply-draft",
      text: t("reapplyDraft"),
      disabled: current.historyPending || current.historyOperation && current.historyOperation.body?.decision !== "keep-mine" ? "" : null,
      onclick: () => answerEditorConflict(app, current, "keep-mine"),
    }));
    resource.append(element(document, "button", { type: "button", class: "btn", "data-action": "show-changes", text: t("showChanges"), onclick: () => { current.showChanges = !current.showChanges; renderShell(app); } }));
    if (current.showChanges) resource.append(element(document, "div", { "data-editor-changes": "true" },
      element(document, "pre", { "aria-label": t("boardLocalVersion"), text: JSON.stringify(editorDraftDocument(current), null, 2) }),
      element(document, "pre", { "aria-label": t("boardIncomingVersion"), text: JSON.stringify(current.conflict.remote?.document, null, 2) })));
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
  const forms = resourceForms(app, document, t);
  if (forms) catalog.append(forms);
  const surfaces = { catalog, resource, comments: commentsColumn };
  if (!current) return surfaces;
  if (!current.authoritative.readOnly) {
    tools.append(element(document, "button", { type: "button", class: "btn", "data-action": "editor-history", text: t("history"), "aria-expanded": String(Boolean(current.historyOpen)), "aria-pressed": String(Boolean(current.historyOpen)), onclick: async () => {
      current.historyOpen = !current.historyOpen;
      if (current.historyOpen) await loadHistory(app.api, editors).catch((error) => { editors.error = error; });
      renderShell(app);
    } }));
    if (current.historyOpen) {
      const onRestore = async (item) => {
        try {
          const pending = restoreEditorHistory(app.api, editors, item, current.historyOperation); renderShell(app);
          await pending; await loadHistory(app.api, editors); syncViewerDirty(app);
        } catch (error) { app.actionNote = actionText(app.language, error.code); }
        renderShell(app);
      };
      const panel = renderEditorHistory(document, current.history ?? [], t, onRestore, {
        author: item => {
          const unit = unitById(app, item.by);
          return item.by === "root:master" || item.by === "root:person" ? text(app.language, "person")
            : unit ? unitDisplayName(unit) : readableIdentity(item.by, text(app.language, "person"));
        },
        time: item => formatShortTime(app.language, item.at),
      });
      for (const button of panel.querySelectorAll("button")) {
        const historyId = button.closest("[data-history-id]")?.getAttribute("data-history-id");
        button.disabled = !canEditResources(app) || current.dirty || Boolean(current.historyPending) || Boolean(current.historyOperation && !current.historyOperation.path.endsWith(`/${historyId}/restore`));
      }
      commentsColumn.append(panel);
      surfaces.comments = commentsColumn;
      return surfaces;
    }
  }
  if (current.attachmentResource !== current.resourceId) {
    current.attachmentChoice = new Set(current.attached ?? []);
    current.attachmentResource = current.resourceId;
  }
  const choice = current.attachmentChoice;
  const units = app.unitList?.catalog ?? [];
  const chips = element(document, "div", { class: "attach-chips", "data-attached": [...choice].join(" ") });
  for (const id of current.attached ?? []) {
    const unit = units.find((item) => item.id === id);
    chips.append(element(document, "span", { class: "chip", "data-chip": id, text: unit?.unit || id }));
  }
  const actions = element(document, "div", { class: "editor-actions" });
  actions.append(element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "attach",
    text: t(current.kind === "blueprint" ? "attachAgents" : "attach"),
    onclick: () => openAttachChooser(app),
  }));
  actions.append(element(document, "button", { type: "button", class: "btn", "data-action": "watch", onclick: () => followEditor(app) }, t("watch")));
  if (current.kind !== "blueprint" || watch?.watchId) actions.append(element(document, "button", { type: "button", class: "btn", "data-action": "stop-watch", onclick: () => editorAct(app, `watch-stop:${editors.current?.resourceId ?? "none"}`, text(app.language, "working"), async (record) => {
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
  if (current.kind === "blueprint") {
    if (!(current.attached?.length)) chips.append(element(document, "span", { class: "field-hint", text: t("noAgentsAttached") }));
    const toolbar = resource.querySelector("[data-toolbar='board']");
    toolbar?.append(chips);
    if (current.boardTool !== "draw") toolbar?.append(actions);
  } else tools.append(chips, actions);
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
      line.append(element(document, "span", { class: "comment-author", text: commentAuthor(app, message.author ?? message.authorId) }));
      if (message.at) line.append(element(document, "time", { datetime: message.at, text: formatShortTime(app.language, message.at) }));
      line.append(element(document, "span", { class: "comment-text", text: message.text ?? "" }));
      if (current.kind === "void" && message.proposal && current.proposals?.some((item) => item.id === message.proposal.id)) appendProposals(app, document, box, current, t, message.proposal.id, line);
      else box.append(line);
      if (message.sendToAgent === false && message.authorId === "root:master") box.append(element(document, "p", { class: "field-hint", "data-comment-note": message.id, text: t("keptAsNote") }));
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
  const composeLabel = t(current.threads?.length ? current.kind === "void" ? "replyOnText" : "replyOnBoard" : "comment");
  const compose = element(document, "textarea", { "data-comment": "true", "data-keep": keepId("comment", current.resourceId), "aria-label": composeLabel, placeholder: composeLabel });
  compose.value = current.commentText ?? "";
  const commentButton = element(document, "button", {
    type: "button",
    class: "btn primary comment-send",
    "data-action": "comment",
    "aria-label": t("send"),
    disabled: commentCanSubmit(app, compose.value) ? null : "",
    onclick: () => addEditorComment(app, compose),
  }, element(document, "span", { "aria-hidden": "true", text: "↑" }));
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
  const commentField = labeledField(document, composeLabel, t(commentHintKey(app)), compose);
  const composer = element(document, "div", { class: "comment-composer" }, element(document, "div", { class: "comment-input-row" }, commentField, commentButton), commentPreferenceControl(app, document, current, t));
  commentButton.setAttribute("aria-describedby", compose.getAttribute("aria-describedby"));
  if (!commentCanSubmit(app, compose.value)) {
    const reason = element(document, "p", {
      id: "reason-comment",
      class: "field-hint",
      "data-disabled-reason": "comment",
      text: currentCommentAnchor(app) ? t("commentNeedsText") : t(commentMissingKey(app)),
    });
    commentButton.setAttribute("aria-describedby", "reason-comment");
    composer.append(reason);
  }
  commentsColumn.append(comments, composer);
  const notices = current.notices ?? [];
  const submitted = notices.filter(notice => notice.state === "submitted");
  if (submitted.length) {
    const recipients = [...new Set(submitted.map(notice => {
      const unit = unitById(app, notice.unitId);
      return unit ? unitDisplayName(unit) : readableIdentity(notice.unitId, text(app.language, "person"));
    }))];
    const recipientText = recipients.length < 2 ? recipients[0] ?? "" : `${recipients.slice(0, -1).join(", ")} ${app.language === "es" ? "y" : "and"} ${recipients.at(-1)}`;
    commentsColumn.append(element(document, "p", { "data-notice": "submitted", text: t("sentTo", { recipients: recipientText }) }));
  }
  for (const notice of notices.filter(item => ["ambiguous", "failed"].includes(item.state))) {
    commentsColumn.append(element(document, "p", { "data-notice": notice.state, text: t(notice.state === "failed" ? "noticeFailed" : "noticeUnconfirmed") }));
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
    const units = app.unitList?.catalog ?? [...app.store.indexes.units.values()];
    const groups = [...app.store.indexes.groups.values()];
    await setAttachments(app.api, editors, expandAttachments(units, groups, [...(choice ?? [])]), record.operation);
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
  const board = editor?.kind === "blueprint" ? boardDocument(editor) : editor?.authoritative?.document ?? editor?.document;
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
  const current = editor;
  if (!current || !value.trim()) return;
  const key = `comment:${current.resourceId}`;
  if (activityPending(app, key)) return;
  const previous = app.activity.get(key);
  if (app.api.uncertain.has(previous?.operation?.id)) { previous.retry?.(); return; }
  let row = (current.threads ?? []).find((thread) => thread.pending);
  if (!row) {
    row = { id: "pending-comment", status: "open", pending: true, failed: false, messages: [{ text: value }] };
    current.threads = [...(current.threads ?? []), row];
  }
  row.failed = false;
  row.messages = [{ text: value }];
  const choice = commentChoice(editors, current);
  const target = { ...editors, current };
  let operation = null;
  editorAct(app, key, text(app.language, "sending"), async (record) => {
    record.operation = operation;
    record.commentChoice = choice;
    try {
      await createComment(app.api, target, anchor, value, operation, choice);
      record.operation = null;
      current.threads = (current.threads ?? []).filter((thread) => !thread.pending);
      syncViewerDirty(app);
    } catch (error) {
      operation = error.operation;
      const pending = (current.threads ?? []).find((thread) => thread.pending);
      if (pending) pending.failed = true;
      throw error;
    }
  });
}

function replyToThread(app, threadId) {
  const editors = editorsOf(app);
  const current = editors.current;
  const supplied = current?.commentText;
  if (typeof supplied !== "string" || !supplied.trim()) {
    explain(app, "commentNeedsText");
    return;
  }
  const choice = commentChoice(editors, current);
  const target = { ...editors, current };
  const key = `reply:${threadId}`;
  if (activityPending(app, key)) return;
  const previous = app.activity.get(key);
  if (app.api.uncertain.has(previous?.operation?.id)) { previous.retry?.(); return; }
  let operation = null;
  editorAct(app, key, text(app.language, "sending"), async (record) => {
    record.operation = operation;
    record.commentChoice = choice;
    try {
      await replyComment(app.api, target, threadId, supplied, operation, choice);
      record.operation = null;
    } catch (error) { operation = error.operation; throw error; }
  });
}

function commentPreferenceControl(app, document, current, t) {
  if (app.layout === "phone") return null;
  const choice = commentChoice(editorsOf(app), current);
  const none = choice.attached.length === 0;
  const disabled = none || !app.store.capabilities.includes("settings.write") || activityPending(app, "settings");
  const input = element(document, "input", { type: "checkbox", "data-send-to-agent": current.kind,
    "aria-label": t("sendToAgent"), "data-keep": keepId("send-to-agent", current.resourceId),
    disabled: disabled ? "" : null });
  input.disabled = disabled;
  input.checked = choice.sendToAgent;
  input.addEventListener("change", () => {
    homeState(app).sendToAgentChoice = input.checked;
    editorsOf(app).sendToAgent = input.checked;
    chooseSetting(app, { sendToAgent: input.checked });
  });
  return element(document, "div", { class: `comment-preference${none ? " no-agents" : ""}` },
    element(document, "label", { class: "comment-preference-label" }, element(document, "span", { class: "comment-checkbox-hit" }, input, element(document, "span", { class: "comment-checkbox", "aria-hidden": "true" })), t("sendToAgent")),
    element(document, "span", { class: "comment-preference-hint", text: t(none ? "noAgentsAttached" : choice.sendToAgent ? choice.attached.length === 1 ? "notifiesAttachedAgent" : "notifiesAttachedAgents" : "keptAsNote", { count: choice.attached.length }) }));
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
  );
  return box;
}

function openResourceForm(app, kind, mode) {
  if (mode === "create") return openLibraryCreate(app, kind);
  const document = app.root.ownerDocument;
  if (document.querySelector?.(`[data-form="${mode}"]`)) return;
  const t = (key) => text(app.language, key);
  const dialog = element(document, "dialog", { class: "dialog", "data-form": mode });
  const form = element(document, "form", { method: "dialog" });
  const heading = element(document, "h2", { text: t(mode === "register" ? "registerForm" : "createForm") });
  labelDialog(dialog, heading);
  form.append(heading);
  form.append(
    editorField(document, app, t, "project", "registerProject", "register-project"),
    editorField(document, app, t, "path", "registerPath", "register-path"),
  );
  form.append(element(document, "button", {
    type: "button",
    class: "btn primary",
    "data-action": mode === "register" ? "register-resource" : "create-resource",
    "data-kind": kind,
    text: t(mode === "register" ? "registerResource" : "createResource"),
    onclick: () => {
      dialog.close();
      if (mode === "register") submitRegister(app, kind);
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
  current.attachmentChoiceRevision = current.attachmentRevision;
  const dialog = element(document, "dialog", { class: "dialog", "data-form": "attach" });
  const form = element(document, "form", { method: "dialog" });
  const heading = element(document, "h2", { text: text(app.language, "attachAgents") });
  labelDialog(dialog, heading);
  const search = element(document, "input", {
    type: "search",
    "data-attach-search": "true",
    "aria-label": text(app.language, "searchUnitsGroups"),
    placeholder: text(app.language, "searchUnitsGroups"),
  });
  const list = element(document, "div", { class: "attach-choices", role: "listbox" });
  const paint = () => {
    const query = search.value.trim().toLowerCase();
    const units = (app.unitList?.catalog ?? []).map((unit) => ({ id: unit.id, label: unitDisplayName(unit), kind: "unit", search: `${unit.id} ${unit.unit} ${unit.alias ?? ""}` }));
    const groups = [...app.store.indexes.groups.values()].filter((group) => !group.deleted).map((group) => ({ id: `group:${group.id}`, label: group.title, kind: "group", search: group.title }));
    const entries = [...units, ...groups].filter((entry) => !query || entry.search.toLowerCase().includes(query));
    list.replaceChildren(...entries.map((unit) => element(document, "button", {
      type: "button",
      class: "attach-choice",
      [unit.kind === "unit" ? "data-attach-unit" : "data-attach-group"]: unit.id,
      "aria-pressed": choice.has(unit.id) ? "true" : "false",
      text: unit.label,
      onclick: () => {
        if (choice.has(unit.id)) choice.delete(unit.id);
        else if (choice.size >= 256) editors.error = { code: "invalid_body" };
        else choice.add(unit.id);
        paint();
      },
    })));
    try { confirm.textContent = text(app.language, "attachCount", { count: expandAttachments(app.unitList?.catalog ?? [], [...app.store.indexes.groups.values()], [...choice]).length }); }
    catch { confirm.textContent = text(app.language, "tooLarge"); }
  };
  search.addEventListener("input", paint);
  const confirm = element(document, "button", {
    type: "button",
    class: "btn primary",
    "data-action": "save-attachments",
    text: text(app.language, "attachCount", { count: choice.size }),
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
    onclick: () => { current.attachmentChoice = new Set(current.attached); delete current.attachmentChoiceRevision; dialog.close(); },
  }));
  dialog.append(form);
  dialog.addEventListener("close", () => {
    if (app.attachRepaint === paint) app.attachRepaint = null;
    dialog.remove();
    restoreInvoker(app, "attach");
  });
  document.body.append(dialog);
  app.attachRepaint = paint;
  paint();
  const bounds = app.root.querySelector(".board-host")?.getBoundingClientRect() ?? app.root.getBoundingClientRect();
  dialog.style.left = `${Math.max(12, Math.min(document.defaultView.innerWidth - 312, bounds.left + bounds.width / 2 - 150))}px`;
  dialog.style.top = `${bounds.top + 64}px`;
  if (dialog.show) dialog.show(); else dialog.setAttribute("open", "");
  search.focus?.();
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

function submitJsonCopy(app, current) {
  const legacy = current?.authoritative?.legacy;
  if (!legacy || !canEditResources(app)) return;
  editorAct(app, `copy:${current.resourceId}`, text(app.language, "working"), async (record) => {
    const result = await importLegacyBoard(app.api, current.authoritative, { title: current.authoritative.title, folderId: current.authoritative.folderId ?? null }, record.operation, (manifest) => exportLegacyDocument(app.root.ownerDocument, manifest));
    await openCreated(app, result.data, "blueprint");
  });
}

/** Resolve the verified, bounded module graph without fetching executable URLs. */
export function legacyModuleUrls(manifest, makeUrl) {
  const urls = new Map(), loading = new Set();
  let bytes = 0;
  const build = (key) => {
    if (urls.has(key)) return urls.get(key);
    const module = manifest.modules[key];
    if (!module || loading.has(key)) throw new ApiError(422, "import_unavailable", "The module cannot be exported.");
    loading.add(key);
    let source = module.source;
    for (const reference of [...module.imports].reverse()) {
      source = `${source.slice(0, reference.start)}${JSON.stringify(build(reference.key))}${source.slice(reference.end)}`;
      if (source.length > 16_000_000) throw new ApiError(422, "import_unavailable", "The module export exceeds its limit.");
    }
    if ((bytes += new TextEncoder().encode(source).length) > 16_000_000) throw new ApiError(422, "import_unavailable", "The module export exceeds its limit.");
    const url = makeUrl(source); loading.delete(key); urls.set(key, url); return url;
  };
  return Object.fromEntries(["module", "kit", "skins", "exporter", "schema", "icons", "nodes"].filter((key) => manifest[key]).map((key) => [key, build(manifest[key])]));
}

async function exportLegacyDocument(document, manifest) {
  const env = document.defaultView;
  const dataUrl = (source) => {
    const bytes = new TextEncoder().encode(source), chunks = [];
    for (let at = 0; at < bytes.length; at += 32768) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 32768)));
    return `data:text/javascript;base64,${env.btoa(chunks.join(""))}`;
  };
  const urls = legacyModuleUrls(manifest, dataUrl);
  const script = `try {
    const [source, kit, skins, exporter, schema] = await Promise.all(${JSON.stringify([urls.module, urls.kit, urls.skins, urls.exporter, urls.schema])}.map(url => import(url)));
    const skin = skins.skins?.design ?? Object.values(skins.skins ?? {})[0]; if (!skin) throw new Error();
    kit.useSkin?.(skin);
    ${urls.icons ? `const icons = await import(${JSON.stringify(urls.icons)}); kit.useIcons?.(icons.default ?? icons.ICONS);` : ""}
    ${urls.nodes ? `const nodes = await import(${JSON.stringify(urls.nodes)}); kit.useNodes?.(nodes.default ?? nodes.NODES);` : ""}
    const document = exporter.exportBoard(source.default, {layout: kit.layout, normalize: schema.normalizeBoard, skin, sketch: ${JSON.stringify(manifest.sketch)}});
    parent.postMessage({document}, "*");
  } catch { parent.postMessage({error: "import_unavailable"}, "*"); }`;
  const iframe = document.createElement("iframe");
  iframe.hidden = true; iframe.setAttribute("sandbox", "allow-scripts");
  const html = new Blob([`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'"><script type="module" src="${dataUrl(script)}"></script>`], { type: "text/html" });
  const url = env.URL.createObjectURL(html);
  try {
    return await new Promise((resolve, reject) => {
      const finish = (error, result) => { env.clearTimeout(timer); env.removeEventListener("message", receive); error ? reject(error) : resolve(result); };
      const receive = (event) => {
        if (event.source !== iframe.contentWindow) return;
        if (event.data?.error || !event.data?.document) finish(new ApiError(422, "import_unavailable", "The module cannot be exported."));
        else finish(null, event.data.document);
      };
      const timer = env.setTimeout(() => finish(new ApiError(422, "import_unavailable", "The module cannot be exported.")), 30_000);
      env.addEventListener("message", receive); iframe.src = url; document.body.append(iframe);
    });
  } finally { iframe.remove(); env.URL.revokeObjectURL(url); }
}

export async function importLegacyBoard(api, source, { title, folderId = null, project = source?.project } = {}, retained = null, exportDocument = (manifest) => exportLegacyDocument(globalThis.document, manifest)) {
  if (retained) return perform(api, null, retained);
  if (!source?.readOnly || project !== source.project) throw new ApiError(422, "import_unavailable", "Choose a registered module in the selected project.");
  const manifest = (await request(api, "GET", "/blueprint/boards/:resourceId/export", { params: { resourceId: source.id } })).data;
  let document;
  try {
    document = await exportDocument(manifest);
    if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error();
    document.legacySource = manifest.sourceRevisions;
  } catch { throw new ApiError(422, "import_unavailable", "The module cannot be exported."); }
  return perform(api, { method: "POST", path: "/blueprint/boards/import", body: { project, path: manifest.path, title, folderId, legacyResourceId: source.id, document, expectedRevision: manifest.expectedRevision } });
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
      { id: "main", title: "Main", objects: [], order: ["empty"], start: "empty" },
    ],
    screens: [
      screenBox("empty", "Empty", 0),
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
  const next = editedBoard({ document: boardDocument(editor), revision: editor.revision }, edit);
  setBoardDraft(editor, next.document);
  const saved = saveBoardDraft(app, editor);
  saved?.then(() => { if (!editor.boardDraft && !editor.conflict) { onSaved?.(); syncViewerDirty(app); } });
}


function viewStorage(document) {
  try { return document.defaultView?.localStorage ?? null; } catch { return null; }
}

function startMachine(app) { return app.store.settings?.service?.machine ?? app.store.view?.mind?.machine; }

async function openSharedAdd(app, update = null) {
  if (app.layout === 'phone' || app.startDialog || !app.store.capabilities.includes('settings.write')) return;
  if (update && !update.source) {
    try {
      const report = (await getAdditions(app.api, startMachine(app))).data;
      app.store.additions.report = report;
      const accepted = report.items.find(item => item.id === update.additionId);
      if (!accepted) throw new ApiError(404, 'addition_not_found', addText(app.language, 'error_addition_not_found'));
      update = accepted;
    } catch (error) { noteAction(app, error); renderShell(app); return; }
  }
  app.addController ??= createAddController(app.api, { state: app.store.additions, onAccepted: async result => {
    await loadStartReports(app);
    if (app.settingsState) await loadSettingsSections(app);
    const repository = result.items.find(item => item.kind === 'repository');
    if (repository) {
      const cluster = acceptedRepositoryCluster([...app.store.indexes.groups.values()], repository);
      if (cluster) { navigate(app, 'map'); selectGroup(app, cluster.id); revealAcceptedCluster(app, cluster); }
    }
    const item = result.items[0];
    showMapToast(app, repository ? addText(app.language, 'repoAdded', { project: repository.title }) : addText(app.language, item.unitCount === 1 ? 'addedOne' : 'addedMany', { name: item.title, count: item.unitCount }));
    renderShell(app);
  } });
  openAdd(app.addController, app.root.ownerDocument, { language: app.language, machine: startMachine(app), update });
}

function revealAcceptedCluster(app, cluster) {
  const seen = new Set(); let current = cluster;
  while (current && !seen.has(current.id)) {
    seen.add(current.id); app.hierarchy.collapsed.delete(`cluster:${current.id}`);
    const parent = app.store.indexes.groups.get(current.parentId);
    if (parent) revealGroup(app.hierarchy, `cluster:${parent.id}`, app.store.indexes.groups.size);
    current = parent;
  }
  app.pendingClusterFlight = cluster.id;
  renderShell(app);
}

function confirmRemoveAddition(app, item) {
  let retained = null;
  showDialog(app.root.ownerDocument, { title: addText(app.language, 'removeTitle', { name: item.title }),
    body: addText(app.language, 'removeContent'), confirm: addText(app.language, 'remove'), cancel: addText(app.language, 'cancel'), retry: addText(app.language, 'retry'),
    onConfirm: async () => {
      try {
        const result = await removeAddition(app.api, startMachine(app), item.additionId, item.revision, retained);
        await loadStartReports(app); await loadSettingsSections(app);
        showMapToast(app, addText(app.language, 'removeTitle', { name: item.title }), async record => {
          await undoChange(app.api, result.data.changeId, record.operation); await loadStartReports(app); await loadSettingsSections(app);
        }, result.data.undoUntil); renderShell(app);
      } catch (error) { retained = error.operation ?? retained; throw error; }
    } });
}

function unconfirmedStartOperation(error) { return !error.status || error.status >= 500 ? error.operation ?? null : null; }

function loadStartReports(app) {
  if (app.layout === 'phone' || app.disposed) return Promise.resolve();
  const machine = startMachine(app), ticket = (app.startReportTicket ?? 0) + 1;
  app.startReportTicket = ticket;
  const pending = readStartReports(app, machine, ticket);
  app.startReportPending = pending;
  return pending;
}

async function readStartReports(app, machine, ticket) {
  try {
    const [projects, agents, clusters, additions] = await Promise.all([
      request(app.api, 'GET', '/settings/projects', { query: { machine } }),
      request(app.api, 'GET', '/settings/agents', { query: { machine } }),
      collectPages(app.api, '/clusters', { limit: 200 }),
      app.store.capabilities.includes('settings.write') ? getAdditions(app.api, machine) : Promise.resolve({ data: { items: [] } }),
    ]);
    if (app.disposed) return;
    if (ticket !== app.startReportTicket) return app.startReportPending;
    app.startProjects = projects.data; app.startAgents = agents.data; app.startPermissionsStale = true;
    app.store.additions.report = additions.data;
    app.store.indexes.groups = new Map(clusters.items.map(cluster => [cluster.id, cluster]));
    app.startError = null;
    if (app.store.selected.groupId && !app.store.indexes.groups.has(app.store.selected.groupId)) app.store.selected.groupId = null;
    renderShell(app);
  } catch (error) {
    if (app.disposed) return;
    if (ticket !== app.startReportTicket) return app.startReportPending;
    app.startError = error;
  }
}

// The agent inspector says whether a Claude Code or Cursor agent asks first or works automatically. That needs the permissions report,
// which is read only when such an agent is shown, so the cluster reports above never wait for it.
function refreshPermissions(app) {
  if (app.permissionsLoading || app.layout === 'phone' || app.disposed) return;
  app.permissionsLoading = true; app.startPermissionsStale = false;
  request(app.api, 'GET', '/settings/permissions', { query: { machine: startMachine(app) } })
    .then(result => { app.startPermissions = result.data; app.permissionsFailedAt = 0; }, () => { app.permissionsFailedAt = Date.now(); })
    .finally(() => { app.permissionsLoading = false; if (!app.disposed) renderShell(app); });
}

function rememberOverseerOffer(app) {
  app.overseerOffered = true;
  try { app.startStorage?.setItem(`hivem1nd:overseer:${app.selectedFolder}`, 'dismissed'); } catch { /* Storage can be unavailable in a private viewer. */ }
}

function overseerListed(units) {
  return Array.isArray(units) && units.some(unit => unit && unit.removed !== true && (unit.id === 'root:overseer' || unit.role === 'overseer'));
}

function overseerExists(app) {
  const view = app.store.view;
  return overseerListed(view?.units) || overseerListed(view?.allUnits) || overseerListed(app.unitList?.catalog) || overseerListed([...(app.store.indexes?.units?.values?.() ?? [])]);
}

function mindHasClusters(app) {
  return [...(app.store.indexes?.groups?.values?.() ?? [])].some(group => group && group.deleted !== true);
}

export function maybeStartDiscovery(app) {
  if (app.disposed || app.startDialog || app.layout !== 'desktop' || !app.store.capabilities.includes('unit.create') || app.startError) return;
  const offer = app.startProjects?.discoveryOffer;
  // The import offer is the empty first run. A mind that already has a cluster keeps the map clear.
  if (!mindHasClusters(app) && offer && !offer.dismissed && !app.answeredOffers?.has(offer.id) && repositorySelection(offer).size) {
    const model = { language: app.language, offer, query: '', selected: repositorySelection(offer), expanded: new Set(offer.groups.slice(0, 1).map(group => group.id)) };
    let retained = null, flow;
    const answer = confirmed => flow.run(confirmed ? 'import-repositories' : 'dismiss-discovery', async () => {
      try {
        await startApi.answerRepositoryOffer(app.api, offer.id, { machine: startMachine(app), repositoryIds: confirmed ? [...model.selected] : [], confirmed, expectedRevision: offer.revision }, retained);
      } catch (error) { retained = unconfirmedStartOperation(error); throw error; }
      app.answeredOffers ??= new Set(); app.answeredOffers.add(offer.id);
      flow.dialog.close(); await loadStartReports(app); maybeStartDiscovery(app);
    });
    flow = startDialog(app.root.ownerDocument, { view: 'discovery', language: app.language, onCancel: () => answer(false),
      onClose: () => { if (app.startDialog === flow) app.startDialog = null; }, render: () => renderRepositoryOffer(app.root.ownerDocument, model, {
        onFilter: query => { model.query = query; flow.paint(); }, onExpand: id => { toggleGroup({ collapsed: model.expanded }, id); flow.paint(); },
        onRepository: (id, value) => { if (value) model.selected.add(id); else model.selected.delete(id); flow.paint(); },
        onFolder: (id, value) => { for (const repo of offer.groups.find(group => group.id === id).repositories) { if (value) model.selected.add(repo.id); else model.selected.delete(repo.id); } flow.paint(); },
        onDismiss: () => answer(false), onImport: () => answer(true),
      }) });
    flow.model = model; app.startDialog = flow; return;
  }
  const exists = overseerExists(app);
  let dismissed = app.overseerOffered;
  try { dismissed ||= app.startStorage?.getItem(`hivem1nd:overseer:${app.selectedFolder}`) === 'dismissed'; } catch { /* In-memory dismissal still applies. */ }
  if (!exists && !dismissed) openStartAgent(app, null, true);
}

function openRunsPicker(app, model, onChange, anchor = null) {
  let picker;
  picker = startDialog(app.root.ownerDocument, { view: 'picker', language: app.language, anchor,
    render: () => {
      const view = renderRunsInPicker(app.root.ownerDocument, model, {
        onChoice: choice => { model.choice = choice; onChange?.(); picker.paint(); },
        onDefault: value => { model.useAsDefault = value; }, onAutomatic: value => { model.automatic = value; }, onClose: () => picker.dialog.close(),
      });
      if (model.onSave) view.append(mapButton(app, 'save-runs-in', text(app.language, 'save'), () => model.onSave(picker)));
      return view;
    } });
  return picker;
}

async function openStartAgent(app, cluster, overseer = false) {
  if (app.startDialog || app.layout === 'phone') return;
  if (!app.startAgents) await loadStartReports(app);
  if (app.disposed || app.startDialog) return;
  const clients = app.startAgents?.connectedClients ?? [], preferred = app.startAgents?.defaultRunsIn;
  const model = { language: app.language, kind: overseer ? 'overseer' : 'agent', agentKind: preferred?.client === 'lyra' ? 'local' : 'external',
    cluster, role: 'executor', roleName: '', roleDescription: '', roleProblems: {}, clients, choice: initialRunsIn(clients, preferred, overseer ? preferred?.client === 'lyra' ? 'local' : 'external' : null), fresh: true, useAsDefault: false,
    automatic: false };
  const anchor = app.root.querySelector('[data-action="new-agent"]');
  let flow, retained = null, created = null, defaultOperation = null, granted = false, grantOperation = null;
  const cancel = () => { if (flow.busy || flow.uncertain) return; if (overseer) rememberOverseerOffer(app); flow.dialog.close(); };
  // A custom role is checked before anything is sent; the problems show under their fields and the first one takes focus.
  const roleReady = () => {
    if (overseer || model.role !== 'custom') return true;
    model.roleProblems = customRoleProblems(model.roleName, model.roleDescription);
    const first = Object.keys(model.roleProblems)[0];
    if (!first) return true;
    flow.paint(); flow.dialog.querySelector(`[data-start-field="${first}"]`)?.focus?.();
    return false;
  };
  flow = startDialog(app.root.ownerDocument, { view: overseer ? 'overseer' : 'agent', language: app.language, anchor: overseer ? null : anchor,
    onCancel: cancel, onClose: () => { if (app.startDialog === flow) app.startDialog = null; }, render: () => renderAgentForm(app.root.ownerDocument, model, {
      onKind: kind => { model.agentKind = kind; model.choice = initialRunsIn(clients, null, kind); flow.paint(); },
      onRole: role => {
        model.role = role; model.roleProblems = {}; flow.paint();
        // The Custom fields open below a long list; they are brought into view.
        if (role === 'custom') flow.dialog.querySelector('[data-custom-role]')?.scrollIntoView?.({ block: 'nearest' });
      },
      onFresh: value => { model.fresh = value; },
      onRoleName: value => { model.roleName = value; delete model.roleProblems.roleName; },
      onRoleDescription: value => { model.roleDescription = value; delete model.roleProblems.roleDescription; },
      onPicker: () => openRunsPicker(app, model, () => { model.agentKind = model.choice?.client === 'lyra' ? 'local' : 'external'; flow.paint(); }, flow.dialog.querySelector('[data-action="open-runs-picker"]')),
      onConnect: () => { flow.dialog.close(); settingsState(app).tab = 'agents'; navigate(app, 'settings'); },
      onCancel: cancel,
      onCreate: () => roleReady() && flow.run('create-agent', async () => {
        let result;
        try {
          result = created ?? (overseer ? await startApi.createOverseer(app.api, { machine: startMachine(app), runsIn: model.choice, fresh: model.fresh, expectedRevision: null }, retained)
            : await startApi.createClusterAgent(app.api, cluster.id, { machine: startMachine(app), role: model.role, roleName: model.roleName.trim(), roleDescription: model.roleDescription.trim(), runsIn: model.choice, useAsDefault: model.useAsDefault, expectedRevision: cluster.revision }, retained));
          created = result;
          if (overseer && model.useAsDefault) {
            try { result = await startApi.setRunsIn(app.api, result.data.id, { machine: startMachine(app), runsIn: result.data.runsIn, useAsDefault: true, expectedRevision: result.data.revision }, defaultOperation); }
            catch (error) { defaultOperation = unconfirmedStartOperation(error); throw error; }
          }
          // Work automatically is a grant for this agent, made only after the agent exists.
          if (model.automatic === true && !granted && supervisedClient(clients.find(client => client.id === result.data.runsIn?.client))) {
            try { await setAutomaticWork(app, result.data, true, grantOperation); granted = true; }
            catch (error) { grantOperation = unconfirmedStartOperation(error); throw error; }
          }
        } catch (error) { if (!created) retained = unconfirmedStartOperation(error); throw error; }
        const unit = result.data;
        if (overseer) rememberOverseerOffer(app);
        flow.dialog.close(); app.store.indexes.units.set(unit.id, unit); app.store.selected.unitId = unit.id; app.store.selected.groupId = null;
        if (app.unitList) await reloadList(app.unitList);
        await loadStartReports(app); ensureMap(app).selection = new Set([unit.id]); app.pendingCenter = unit.id;
        await loadInspector(app, unit.id); renderShell(app);
      }),
    }) });
  flow.model = model; app.startDialog = flow;
}

function automaticGrant(report, unit) {
  return (report?.agentPermissions ?? []).find(item => item.unitId === unit.id && item.client === unit.runsIn?.client && item.actions?.includes('native.automatic')) ?? null;
}

// Work automatically is one grant for one agent and its client. It is made, or taken back, through Settings, Permissions.
async function setAutomaticWork(app, unit, wanted, retained = null) {
  try { return await changeAutomaticWork(app, unit, wanted, retained); } finally { app.startPermissionsStale = true; }
}

async function changeAutomaticWork(app, unit, wanted, retained) {
  if (retained) return retained.method === 'DELETE' ? startApi.revokeAutomaticWork(app.api, null, null, retained) : startApi.grantAutomaticWork(app.api, null, retained);
  const machine = startMachine(app);
  const report = (await request(app.api, 'GET', '/settings/permissions', { query: { machine } })).data, present = automaticGrant(report, unit);
  if (wanted && !present) return startApi.grantAutomaticWork(app.api, { machine, unitId: unit.id, client: unit.runsIn.client, expectedRevision: report.revision });
  if (!wanted && present) return startApi.revokeAutomaticWork(app.api, present.id, { machine, expectedRevision: report.revision });
  return null;
}


async function openUnitRunsIn(app, unit) {
  const [report, permissions] = await Promise.all([request(app.api, 'GET', '/settings/agents', { query: { machine: unit.machine } }),
    request(app.api, 'GET', '/settings/permissions', { query: { machine: unit.machine } }).catch(() => null)]);
  if (app.disposed) return;
  const model = { language: app.language, clients: report.data.connectedClients ?? [], choice: unit.runsIn, useAsDefault: false, automatic: Boolean(automaticGrant(permissions?.data, unit)) };
  model.onSave = picker => picker.run('save-runs-in', async () => {
    let result = model.saved;
    try { result ??= await startApi.setRunsIn(app.api, unit.id, { machine: unit.machine, runsIn: model.choice, useAsDefault: model.useAsDefault, expectedRevision: unit.revision }, model.operation); }
    catch (error) { model.operation = unconfirmedStartOperation(error); throw error; }
    model.saved = result;
    if (supervisedClient(model.clients.find(client => client.id === result.data.runsIn?.client))) {
      try { await setAutomaticWork(app, result.data, model.automatic === true, model.grantOperation); model.grantOperation = null; }
      catch (error) { model.grantOperation = unconfirmedStartOperation(error); throw error; }
    }
    picker.dialog.close(); app.store.indexes.units.set(unit.id, result.data); await reloadList(app.unitList); await loadStartReports(app);
  });
  openRunsPicker(app, model, null, app.root.querySelector('[data-action="change-runs-in"]'));
}

function openStartCluster(app) {
  if (app.startDialog || app.layout === 'phone') return;
  const model = { language: app.language, title: '', path: '', linkKind: 'none' };
  let flow, linkOperation = null, operation = null, verifiedLink = null;
  flow = startDialog(app.root.ownerDocument, { view: 'cluster', language: app.language,
    onClose: () => { if (app.startDialog === flow) app.startDialog = null; }, render: () => renderClusterForm(app.root.ownerDocument, model, {
      onName: value => { model.title = value; }, onPath: value => { if (model.path !== value) verifiedLink = null; model.path = value; },
      onLinkKind: kind => { if (model.linkKind !== kind) verifiedLink = null; model.linkKind = kind; flow.paint(); }, onCancel: () => { if (!flow.busy) flow.dialog.close(); },
      onCreate: () => flow.run('create-cluster', async () => {
        const machine = startMachine(app);
        try {
          if (!model.title.trim()) throw new ApiError(422, 'invalid_title', startText(app.language, 'name'));
          if (model.linkKind !== 'none' && !verifiedLink) {
            const report = (await request(app.api, 'GET', '/settings/projects', { query: { machine } })).data;
            const result = await startApi.createClusterLink(app.api, { machine, kind: model.linkKind, path: model.path, expectedReportRevision: report.revision }, linkOperation);
            verifiedLink = result.data.link;
          }
          const result = await startApi.createCluster(app.api, { title: model.title.trim(), parentId: null, link: verifiedLink ?? { kind: 'none' }, machine }, operation);
          flow.dialog.close(); await loadStartReports(app); selectGroup(app, result.data.id);
          showMapToast(app, startText(app.language, 'clusterCreated', { name: result.data.title })); renderShell(app);
        } catch (error) { if (error.operation?.path === '/cluster-links') linkOperation = unconfirmedStartOperation(error); else operation = unconfirmedStartOperation(error); throw error; }
      }),
    }) });
  flow.model = model; app.startDialog = flow;
}

function openClusterLink(app, cluster, machine = startMachine(app)) {
  let operation = null, mapping = null, mapOperation = null;
  openChoiceForm(app, 'cluster-link', startText(app.language, 'linkFolder'), form => {
    appendInput(form.ownerDocument, form, 'path', startText(app.language, 'folder'), '');
  }, async form => {
    try {
      if (!mapping) {
        const report = (await request(app.api, 'GET', '/settings/projects', { query: { machine } })).data;
        mapping = (await startApi.createClusterLink(app.api, { machine, kind: 'folder', path: fieldValue(form, 'path'), expectedReportRevision: report.revision }, mapOperation)).data.link;
      }
      const input = cluster ? { machine, link: mapping, expectedRevision: cluster.revision }
        : { title: fieldValue(form, 'path').split(/[\\/]/).filter(Boolean).at(-1), parentId: null, link: mapping, machine, confirmed: true };
      operation ??= createOperation({ method: cluster ? 'PATCH' : 'POST', path: cluster ? '/clusters/:clusterId' : '/clusters', params: cluster ? { clusterId: cluster.id } : undefined, body: input });
      const result = await request(app.api, operation.method, operation.path, { operation });
      await loadStartReports(app); await loadSettingsSections(app); selectGroup(app, result.data.id); return true;
    } catch (error) { if (error.operation?.path === '/cluster-links') mapOperation = unconfirmedStartOperation(error); throw error; }
  }, 'link-folder');
}

function removeStartLink(app, link, machine) {
  const cluster = app.store.indexes.groups.get(link.clusterId);
  if (!cluster) return;
  let retained = null;
  showDialog(app.root.ownerDocument, { title: startText(app.language, 'removeLink') + ': ' + link.title,
    body: startText(app.language, 'removeHint'), confirm: startText(app.language, 'removeLink'), cancel: startText(app.language, 'cancel'), retry: startText(app.language, 'retry'),
    onConfirm: async () => {
      try {
        const result = await startApi.removeClusterLink(app.api, cluster.id, { machine, expectedRevision: cluster.revision }, retained);
        await loadStartReports(app); await loadSettingsSections(app);
        showMapToast(app, startText(app.language, 'removeLink'), async record => {
          await undoChange(app.api, result.data.changeId, record.operation); await loadStartReports(app); await loadSettingsSections(app);
        }, result.data.undoUntil); renderShell(app);
      } catch (error) { retained = error.operation ?? retained; throw error; }
    } });
}

async function loadClusterFacts(app, cluster) {
  const ticket = (app.clusterFactsTicket ?? 0) + 1; app.clusterFactsTicket = ticket;
  app.clusterFacts = { id: cluster.id, loading: true };
  try {
    const git = cluster.link?.kind === 'repository' ? (await startApi.getClusterGit(app.api, cluster.id, startMachine(app))).data : null;
    if (ticket === app.clusterFactsTicket) {
      app.clusterFacts = { id: cluster.id, git };
      app.clusterGit ??= new Map(); app.clusterGit.set(cluster.id, { revision: cluster.revision, git });
    }
  } catch (error) { if (ticket === app.clusterFactsTicket) app.clusterFacts = { id: cluster.id, error }; }
  if (!app.disposed) renderShell(app);
}

function clusterInspector(app, cluster) {
  const facts = app.clusterFacts?.id === cluster.id ? app.clusterFacts : {};
  return renderCluster(app.root.ownerDocument, { language: app.language, cluster, git: facts.git, error: facts.error?.message,
    units: app.unitList?.catalog ?? [], link: app.startProjects?.clusterLinks?.find(item => item.clusterId === cluster.id),
    addition: app.store.additions.report?.items.find(item => item.kind === 'repository' && item.projectId === cluster.link?.projectId) }, {
    onUpdate: item => openSharedAdd(app, item),
    onNewAgent: () => openStartAgent(app, cluster), onLink: () => openClusterLink(app, cluster),
    onMore: () => removeStartCluster(app, cluster), onChanges: () => showClusterChanges(app, cluster),
    onEditor: () => settle(app, `editor:${cluster.id}`, startText(app.language, 'openEditor'), async record => {
      const result = await startApi.openClusterEditor(app.api, cluster.id, startMachine(app), record.operation); return result;
    }),
  });
}

function removeStartCluster(app, cluster) {
  let operation = null;
  showDialog(app.root.ownerDocument, { title: text(app.language, 'delete') + ': ' + cluster.title,
    body: startText(app.language, 'removeHint'), confirm: text(app.language, 'delete'), cancel: startText(app.language, 'cancel'),
    onConfirm: async () => {
      operation ??= createOperation({ method: 'DELETE', path: '/clusters/:clusterId', params: { clusterId: cluster.id }, body: { machine: startMachine(app), confirmed: true, expectedRevision: cluster.revision } });
      const result = await request(app.api, 'DELETE', operation.path, { operation });
      await loadStartReports(app); app.store.selected.groupId = null;
      showMapToast(app, cluster.title, async record => { await undoChange(app.api, result.data.changeId, record.operation); await loadStartReports(app); selectGroup(app, cluster.id); }, result.data.undoUntil);
      renderShell(app);
    } });
}

function showClusterChanges(app, cluster) {
  settle(app, `changes:${cluster.id}`, startText(app.language, 'changes'), async () => {
    const changes = await collectPages(app.api, `/clusters/${encodeURIComponent(cluster.id)}/changes`, { query: { machine: startMachine(app) }, limit: 100 });
    const dialog = showDialog(app.root.ownerDocument, { title: startText(app.language, 'changes') + ': ' + cluster.title, cancel: startText(app.language, 'close') });
    dialog.append(renderClusterChanges(app.root.ownerDocument, changes.items));
  });
}

function clusterChatPanel(app, cluster) {
  const t = (key, values) => text(app.language, key, values);
  const panel = chatPanel(app, t);
  const composer = panel.querySelector('[data-composer]');
  if (composer) {
    composer.setAttribute('aria-label', startText(app.language, 'messageCluster', { name: cluster.title }));
    composer.setAttribute('placeholder', startText(app.language, 'messageCluster', { name: cluster.title }));
    const hint = panel.querySelector('.field-hint'); if (hint) hint.textContent = startText(app.language, 'goesToLead');
  }
  return panel;
}

function plansForApp(app) {
  if (!app.planController) {
    app.planController = createPlanController(app.api, () => { if (!app.disposed) renderShell(app); });
    for (const plan of app.store.indexes.plans.values()) app.planController.plans.set(plan.id, plan);
    for (const run of app.store.indexes.runs.values()) app.planController.runs.set(run.id, run);
  }
  return app.planController;
}

function sessionForUnit(app, unitId) {
  return (app.inspectorData?.unitId === unitId ? app.inspectorData.sessions : null)?.find(session => session.state !== 'stopped')
    ?? app.store.view?.sessions?.find(session => session.unitId === unitId && session.state !== 'stopped')
    ?? app.inspectorData?.sessions?.find(session => session.unitId === unitId)
    ?? app.store.view?.sessions?.find(session => session.unitId === unitId);
}

function sessionViewFor(app, session) {
  if (!session || app.layout === 'phone') return null;
  let view = app.store.sessionViews.get(session.id);
  if (!view) { view = createSessionView(session); app.store.sessionViews.set(session.id, view); }
  view.session = session; return view;
}

function inspectorAgent(app) {
  if (app.layout === 'phone') return null;
  const selected = app.store.indexes.units.get(app.store.selected.unitId)
    ?? app.unitList?.catalog?.find(unit => unit.id === app.store.selected.unitId)
    ?? null;
  if (selected && selected.role !== 'master' && !selected.removed) return selected;
  if (selected) return null;
  const chat = app.thread?.chat;
  if (chat?.kind !== 'direct') return null;
  const unit = unitById(app, (chat.members ?? []).find(id => id !== 'root:master'));
  return unit && unit.role !== 'master' && !unit.removed ? unit : null;
}

function unitConversation(app, unitId) {
  app.unitTabs ??= new Map();
  let view = app.unitTabs.get(unitId);
  if (!view) {
    view = { session: { id: unitId }, tab: 'chat', work: [], workLoaded: true, scrollTop: 0, startedOpen: false, unitOnly: true };
    app.unitTabs.set(unitId, view);
  }
  return view;
}

function unitWork(document, view, language, t) {
  return element(document, 'section', {
    class: 'session-work',
    'data-unit-work': view.session.id,
    id: `session-${view.session.id}-panel`,
    role: 'tabpanel',
    'aria-labelledby': `session-${view.session.id}-work`,
  }, element(document, 'p', { class: 'work-hint', text: startText(language, 'workHint') }),
    element(document, 'p', { text: t('finalNotStarted') }));
}

async function selectSessionTab(app, view, tab) {
  captureInputs(app); view.tab = tab;
  renderShell(app);
  app.root.querySelector(`[data-action="session-${tab}"]`)?.focus?.();
  if (view.unitOnly) return;
  if (tab === 'work' && (!view.workLoaded || view.workStale)) {
    await loadSessionView(app.api, view); view.workStale = false;
    if (!app.disposed) renderShell(app);
  }
  clearTimeout(app.workClock);
  const tick = () => { if (app.disposed || view.tab !== 'work') return; renderShell(app); app.workClock = setTimeout(tick, 60000); };
  if (tab === 'work') app.workClock = setTimeout(tick, 60000);
}

// Stops only the running step of a session: a plan attempt through its plan control, any other session through its own route.
// The session, its chat and its task stay. The button shows progress and the Work tab shows the outcome.
function stopWorkStep(app, view) {
  if (view.stopping) return;
  const controller = plansForApp(app), run = [...controller.runs.values()].find(run => run.attempts.some(attempt => attempt.sessionId === view.session.id));
  const attempt = run?.attempts.find(attempt => attempt.sessionId === view.session.id);
  view.stopping = true; view.stopOutcome = null; renderShell(app);
  const finish = (state, error = null) => {
    view.stopping = false; view.stopOutcome = { state, at: new Date(app.api.now()).toISOString() };
    if (error) noteAction(app, error);
    if (!app.disposed) renderShell(app);
  };
  if (run && attempt) {
    controlPlan(controller, run, 'stop_step', { attemptId: attempt.id }).then(() => finish('stopped'), error => finish('failed', error));
    return;
  }
  startApi.stopSessionStep(app.api, view.session.id, view.stopOperation).then(async result => {
    view.stopOperation = null; finish(result.data.idle === true ? 'idle' : 'stopped');
    await loadSessionView(app.api, view); if (!app.disposed) renderShell(app);
  }, error => { view.stopOperation = unconfirmedStartOperation(error); finish('failed', error); });
}

function openAgentMore(app, unit) {
  const document = app.root.ownerDocument, session = sessionForUnit(app, unit.id);
  const dialog = showDialog(document, { title: startText(app.language, 'moreMenu'), cancel: startText(app.language, 'close') });
  if (session) dialog.append(mapButton(app, 'full-transcript', startText(app.language, 'transcript'), () => { dialog.close(); openSessionTranscript(app, session); }));
  if (app.store.capabilities.includes('unit.create')) dialog.append(mapButton(app, 'agent-rename', text(app.language, 'rename'), () => { dialog.close(); beginAlias(app, unit.id); }));
}

function openSessionTranscript(app, session) {
  if (app.layout === 'phone') return;
  const document = app.root.ownerDocument, dialog = showDialog(document, { title: startText(app.language, 'transcript'), cancel: startText(app.language, 'close') });
  dialog.setAttribute('data-full-transcript', session.id);
  let cursor = null, busy = false;
  const body = element(document, 'div', { class: 'private-transcript' });
  const more = element(document, 'button', { type: 'button', class: 'btn', 'data-action': 'transcript-page', text: text(app.language, 'loadOlder'), onclick: () => load() });
  const load = async () => {
    if (busy) return; busy = true; more.disabled = true; more.setAttribute('aria-busy', 'true');
    try {
      const page = await loadTranscriptPage(app.api, session.id, cursor); body.replaceChildren();
      for (const row of page.items) body.append(element(document, 'pre', { text: row.text }));
      cursor = page.nextCursor; more.hidden = !cursor;
    } catch { body.replaceChildren(element(document, 'p', { role: 'alert', text: startText(app.language, 'unavailable') })); more.textContent = startText(app.language, 'retry'); }
    finally { busy = false; more.disabled = false; more.removeAttribute('aria-busy'); }
  };
  dialog.append(body, more); load();
}

function planCards(app, chat) {
  if (app.layout === 'phone') return [];
  const controller = plansForApp(app), document = app.root.ownerDocument;
  const plans = [...controller.plans.values()].filter(plan => plan.chatId === chat.id);
  return plans.map(plan => renderControlledPlan(document, controller, plan, { language: app.language,
    clients: app.startAgents?.connectedClients ?? [], now: app.api.now(), onRun: () => confirmPlanRun(app, plan),
    onEdit: () => { app.planDraft = { previous: plan, draft: structuredClone(plan) }; renderShell(app); },
    onAssignment: taskId => { app.planDraft = { previous: plan, draft: structuredClone(plan), taskId }; renderShell(app); },
    onError: error => noteAction(app, error) }));
}

function confirmPlanRun(app, plan) {
  const snapshot = structuredClone(plan);
  const dialog = showDialog(app.root.ownerDocument, { title: startText(app.language, 'run'),
    body: `${snapshot.branch}. ${startText(app.language, 'commitsHint', { branch: snapshot.branch })} ${snapshot.tasks.map(task => task.title + ': ' + readableIdentity(task.assignment.unitId ?? task.assignment.client, text(app.language, 'person')) + ', ' + runsInLabel(task.runsIn, app.startAgents?.connectedClients ?? [], app.language)).join('; ')}`,
    confirm: startText(app.language, 'run'), cancel: startText(app.language, 'cancel'),
    onConfirm: () => runPlan(plansForApp(app), snapshot) });
  dialog.setAttribute('data-confirm-plan', plan.id);
}

async function openPlanDraft(app, cluster) {
  if (app.layout === 'phone') return;
  const response = await collectPages(app.api, '/tasks', { query: { status: 'open,review' }, limit: 100 });
  const units = (app.unitList?.catalog ?? []).filter(unit => cluster.members.includes(unit.id));
  const tasks = response.items.filter(task => units.some(unit => unit.id === task.toId));
  if (!units.length) { noteAction(app, { code: 'invalid_plan' }); return; }
  const empty = !tasks.length;
  const clients = app.startAgents?.connectedClients ?? [], lead = clusterLead(cluster, units);
  const assignment = unit => ({ kind: 'unit', unitId: unit.id, runsIn: unit.runsIn ?? initialRunsIn(clients) });
  const roles = Object.fromEntries(['coordinator', 'planner', 'builder', 'reviewer'].map(role => [role,
    lead ? assignment(lead) : ['coordinator', 'planner'].includes(role) ? { kind: 'unit', unitId: '', runsIn: null } : assignment(units[0])]));
  // A cluster without any open task starts an empty draft: new tasks are written here and created by the service with the plan.
  const fallback = assignment(lead ?? units[0]);
  app.planDraft = { previous: null, empty, nextKey: 1, defaultAssignment: fallback, draft: { clusterId: cluster.id, chatId: cluster.chatId, machine: startMachine(app),
    title: empty ? cluster.title : tasks[0].title, branch: empty ? planBranch(cluster.title) : `plan-${tasks[0].number}`,
    mode: cluster.link?.kind === 'repository' ? 'execution' : 'planning', expectedChatRevision: app.thread.chat.revision, roles,
    tasks: empty ? [{ key: 'new-1', title: '', body: '', assignment: structuredClone(fallback) }]
      : tasks.map(task => ({ id: task.id, title: task.title, assignment: assignment(units.find(unit => unit.id === task.toId)) })) } };
  renderShell(app);
}

async function chooseVoidText(app, state) {
  const document = app.root.ownerDocument, editors = editorsOf(app);
  const texts = editors.catalogKind === 'void' && editors.catalog.length ? editors.catalog : (await collectPages(app.api, '/void/texts', { limit: 50 })).items;
  const dialog = showDialog(document, { title: startText(app.language, 'fromVoid'), body: texts.length ? '' : startText(app.language, 'noVoidTexts'), cancel: startText(app.language, 'cancel') });
  dialog.setAttribute('data-plan-void', 'true');
  const list = element(document, 'div', { class: 'plan-void-list' });
  for (const item of texts) list.append(mapButton(app, 'plan-void-text', item.title || item.path || item.id, async () => {
    try {
      const found = tasksFromVoidText((await request(app.api, 'GET', '/void/texts/:resourceId', { params: { resourceId: item.id } })).data.document, app.language);
      dialog.close();
      state.voidEmpty = !found.length;
      if (found.length) {
        state.draft.tasks = found.slice(0, PLAN_TASK_LIMIT).map(task => ({ key: `new-${state.nextKey += 1}`, ...task, assignment: structuredClone(state.defaultAssignment) }));
        state.truncated = found.length > PLAN_TASK_LIMIT;
      }
      renderShell(app);
    } catch (error) { noteAction(app, error); }
  }, { 'data-text-id': item.id }));
  const actions = dialog.querySelector?.('.dialog-actions');
  if (actions && typeof dialog.insertBefore === 'function') dialog.insertBefore(list, actions); else dialog.append(list);
}

function renderPlanDraft(app) {
  const state = app.planDraft, document = app.root.ownerDocument, draft = state.draft, empty = state.empty === true;
  const t = key => startText(app.language, key);
  let sync = () => {};
  const root = element(document, 'section', { class: 'plan-card plan-draft', 'data-plan-draft': draft.id ?? 'new' });
  const field = (label, value, changed) => {
    const input = element(document, 'input', { class: 'search', 'aria-label': label, oninput: () => { changed(input.value); sync(); } }); input.value = value;
    return element(document, 'label', {}, label, input);
  };
  root.append(field(t('name'), draft.title, value => { draft.title = value; }), field(text(app.language, 'branch'), draft.branch, value => { draft.branch = value; }));
  const cluster = app.store.indexes.groups.get(draft.clusterId), units = (app.unitList?.catalog ?? []).filter(unit => cluster?.members.includes(unit.id));
  const clients = app.startAgents?.connectedClients ?? [];
  const assignmentRow = (label, assignment, changed) => {
    const select = element(document, 'select', { 'aria-label': label });
    const choices = [...units.map(unit => ({ id: unit.id, label: unitDisplayName(unit), value: { kind: 'unit', unitId: unit.id, runsIn: unit.runsIn ?? initialRunsIn(clients) } })),
      ...clients.filter(client => client.connected).map(client => ({ id: client.id, label: client.title, value: { kind: 'client', client: client.id, runsIn: initialRunsIn([client]), reuseRole: null } }))];
    if (!assignment.unitId && !assignment.client) select.append(element(document, 'option', { value: '', text: t('choosePlanner') }));
    for (const choice of choices) select.append(element(document, 'option', { value: choice.id, text: choice.label }));
    select.value = assignment.unitId ?? assignment.client;
    select.addEventListener('change', () => { changed(structuredClone(choices.find(choice => choice.id === select.value).value)); renderShell(app); });
    const picker = mapButton(app, 'plan-runs-in', runsInLabel(assignment.runsIn, clients, app.language) || t('runsIn'), () => {
      const model = { language: app.language, clients, choice: assignment.runsIn, useAsDefault: false };
      openRunsPicker(app, model, () => { assignment.runsIn = model.choice; renderShell(app); }, picker);
    });
    return element(document, 'label', {}, label, select, picker);
  };
  const roleLabels = app.language === 'es' ? { coordinator: 'Coordina', planner: 'Planifica', builder: 'Implementa', reviewer: 'Revisa' }
    : { coordinator: 'Coordinates', planner: 'Plans', builder: 'Builds', reviewer: 'Reviews' };
  for (const role of ['coordinator', 'planner', 'builder', 'reviewer']) root.append(assignmentRow(roleLabels[role], draft.roles[role], value => { draft.roles[role] = value; }));
  if (empty && (state.voidEmpty || draft.tasks.every(task => !task.title.trim()))) root.append(element(document, 'p', { 'data-plan-empty': 'true', text: t('noTasksYet') }));
  draft.tasks.forEach((task, index) => {
    const row = element(document, 'div', { class: 'plan-task-body', 'data-edit-task': task.id ?? task.key },
      field(t('name'), task.title, value => { task.title = value; }), assignmentRow(task.id ?? String(index + 1), task.assignment, value => { task.assignment = value; }));
    if (empty && draft.tasks.length > 1) row.append(mapButton(app, 'remove-plan-task', text(app.language, 'removeFromList'), () => { draft.tasks.splice(index, 1); renderShell(app); }));
    root.append(row);
  });
  if (empty) {
    const add = mapButton(app, 'add-plan-task', t('addTask'), () => {
      draft.tasks.push({ key: `new-${state.nextKey += 1}`, title: '', body: '', assignment: structuredClone(state.defaultAssignment) }); renderShell(app);
    });
    add.disabled = draft.tasks.length >= PLAN_TASK_LIMIT;
    root.append(add, mapButton(app, 'plan-from-void', t('fromVoid'), () => chooseVoidText(app, state).catch(error => noteAction(app, error))));
    if (state.truncated) root.append(element(document, 'p', { role: 'status', text: t('tasksTruncated') }));
  }
  const save = mapButton(app, 'save-plan', text(app.language, 'save'), async () => {
    if (state.busy) return; state.busy = true; renderShell(app);
    try {
      const saved = await savePlanDraft(plansForApp(app), draft, state.previous);
      app.planDraft = null; await refreshPlan(plansForApp(app), saved.id);
      if (app.thread?.error?.code === 'plan_lead_required') app.thread.error = null;
    } catch (error) { state.error = error; state.locked = Boolean(error.operation && (!error.status || error.status >= 500)); }
    finally { state.busy = false; if (!app.disposed) renderShell(app); }
  });
  // An empty draft is saved only when the plan and every task it names have a title and the plan has a branch.
  const complete = () => !empty || draft.tasks.length > 0 && draft.tasks.length <= PLAN_TASK_LIMIT && draft.title.trim() !== '' && draft.branch.trim() !== '' && draft.tasks.every(task => task.title.trim() !== '');
  sync = () => { if (!state.busy) save.disabled = !complete(); };
  sync();
  if (state.busy) { save.disabled = true; save.setAttribute('aria-busy', 'true'); save.replaceChildren(progressMark(document, t('working'))); }
  root.append(save, mapButton(app, 'cancel-plan', t('cancel'), () => { if (!state.busy) { app.planDraft = null; renderShell(app); } }));
  if (state.error) root.append(element(document, 'p', { role: 'alert', text: t('unavailable') }));
  if (state.busy || state.locked) for (const control of root.querySelectorAll('input, select, button')) {
    if (control !== save || state.busy) control.disabled = true;
  }
  return root;
}

// ---- Context menus ---------------------------------------------------------------------------------------------
// The right-click menu of an agent or a cluster, on the Map and in the Hierarchy. Every entry runs an action the inspector already has,
// and an entry is listed only when the current state allows it. The first entry is the primary action.
function openItemMenu(app, target) {
  const t = (key, values) => startText(app.language, key, values), caps = app.store.capabilities ?? [], desktop = app.layout !== 'phone';
  const groups = [...app.store.indexes.groups.values()].filter(group => !group.deleted);
  const items = [];
  let name = '';
  if (target.kind === 'unit') {
    const unit = unitById(app, target.id);
    if (!unit || unit.role === 'master' || unit.removed) return;
    name = unitDisplayName(unit);
    const home = unitCluster(app, unit);
    items.push({ id: 'open', label: t('menuOpenChat'), primary: true, run: () => openUnitFromMenu(app, unit) });
    if (unit.sessionIds?.length) { if (caps.includes('session.stop')) items.push({ id: 'stop', label: text(app.language, 'stopSession'), run: () => confirmStop(app, unit.sessionIds[0], unit) }); }
    else if (caps.includes('session.start')) items.push({ id: 'start', label: text(app.language, 'startSession'), run: () => openSessionForm(app, unit) });
    if (desktop && caps.includes('unit.create') && unit.revision) items.push({ id: 'rename', label: t('menuRename'), run: () => beginAlias(app, unit.id) });
    if (desktop && caps.includes('unit.connect') && leadChoices(app).some(lead => lead.id !== unit.id)) items.push({ id: 'connect', label: t('menuConnect'), run: () => chooseSelectionLead(app, [unit.id]) });
    if (desktop && caps.includes('chat.manage') && groups.some(group => group.id !== home?.id)) items.push({ id: 'move', label: t('menuMove'), run: () => openMoveAgent(app, unit) });
    if (desktop) items.push({ id: 'details', label: text(app.language, 'details'), run: () => showUnitDetails(app, unit) });
    if (desktop && caps.includes('chat.manage') && home) items.push({ id: 'remove', label: t('menuRemove'), run: () => detachAgent(app, unit, home) });
    if (desktop && caps.includes('unit.create')) items.push({ id: 'delete', label: t('menuDelete'), danger: true, run: () => removeSelectedUnit(app, unit) });
  } else {
    const cluster = app.store.indexes.groups.get(target.id);
    if (!cluster || cluster.deleted) return;
    name = cluster.title;
    const children = groups.filter(group => group.parentId === cluster.id), link = app.startProjects?.clusterLinks?.find(item => item.clusterId === cluster.id);
    items.push({ id: 'open', label: t('menuOpen'), primary: true, run: () => openClusterFromMenu(app, cluster) });
    if (desktop && caps.includes('unit.create')) items.push({ id: 'new-agent', label: t('menuNewAgent'), run: () => openStartAgent(app, cluster) });
    if (desktop && caps.includes('chat.manage')) items.push({ id: 'rename', label: t('menuRename'), run: () => renameCluster(app, cluster) });
    if (children.length || cluster.members?.length) {
      const fromList = target.source === 'hierarchy';
      const collapsed = fromList ? app.hierarchy.collapsed.has(`cluster:${cluster.id}`) : isCollapsed(ensureMap(app), cluster.id);
      items.push({ id: 'collapse', label: collapsed ? t('menuExpand') : t('menuCollapse'), run: () => {
        if (fromList) { toggleGroup(app.hierarchy, `cluster:${cluster.id}`); renderShell(app); } else toggleCollapsed(ensureMap(app), cluster.id);
      } });
    }
    if (desktop && caps.includes('settings.write') && link && cluster.link?.kind !== 'none') items.push({ id: 'remove', label: t('menuRemoveLink'), run: () => removeStartLink(app, link, startMachine(app)) });
    if (desktop && caps.includes('chat.manage') && !children.length) items.push({ id: 'delete', label: t('menuDelete'), danger: true, run: () => removeStartCluster(app, cluster) });
  }
  openContextMenu(app.root.ownerDocument, { x: target.x, y: target.y, items, label: t('menuLabel', { name }) });
}

function unitCluster(app, unit) {
  const groups = [...app.store.indexes.groups.values()].filter(group => !group.deleted);
  return groups.find(group => group.id === unit.clusterId) ?? groups.find(group => group.members?.includes(unit.id)) ?? null;
}

function openUnitFromMenu(app, unit) {
  activateUnit(app, unit, 'double');
  if (app.layout !== 'phone') app.pendingChat = { unitId: unit.id, create: true };
  loadInspector(app, unit.id);
  if (app.layout === 'phone') takePendingChat(app);
  renderShell(app);
}

function openClusterFromMenu(app, cluster) {
  openCluster(app, cluster.id);
  selectGroup(app, cluster.id);
  app.pendingClusterFlight = cluster.id;
  renderShell(app);
}

// Selects the agent and opens the Details part of its inspector.
function showUnitDetails(app, unit) {
  app.store.selected.unitId = unit.id;
  app.store.selected.groupId = null;
  if (app.mapState) { app.mapState.selectedGroupId = null; app.mapState.selection = new Set([unit.id]); }
  loadInspector(app, unit.id);
  renderShell(app);
  // Drawn closed first, then opened, and remembered so the next drawing keeps it open.
  const key = `agent-controls:${unit.id}`, node = app.root.querySelector(`[data-disclosure="${key}"]`);
  inputDrafts(app).disclosures.set(key, true);
  if (node) { node.open = true; node.setAttribute('open', ''); }
}

function hierarchyMenu(app, event) {
  const node = event.target?.closest?.('[data-row]'), row = node && app.activeRows?.find(item => item.id === node.getAttribute('data-id'));
  const target = row?.unit ? { kind: 'unit', id: row.unit.id } : row && (row.kind === 'cluster' || row.kind === 'worktree') ? { kind: 'cluster', id: row.groupId } : null;
  if (!target || app.tab !== 'hierarchy') return;
  event.preventDefault?.();
  const box = node.getBoundingClientRect?.(), keyboard = event.type === 'keydown' || (!event.clientX && !event.clientY);
  openItemMenu(app, { ...target, source: 'hierarchy', x: keyboard && box ? box.left + 24 : event.clientX, y: keyboard && box ? box.bottom - 4 : event.clientY });
}

async function setClusterMembers(app, cluster, members) {
  const operation = createOperation({ method: 'PATCH', path: '/clusters/:clusterId', params: { clusterId: cluster.id }, body: { members, machine: startMachine(app), expectedRevision: cluster.revision } });
  return request(app.api, 'PATCH', operation.path, { operation });
}

async function refreshAfterMembership(app) {
  await loadStartReports(app);
  if (app.unitList) await reloadList(app.unitList);
}

function renameCluster(app, cluster) {
  openChoiceForm(app, 'cluster-rename', startText(app.language, 'renameCluster'), form => {
    appendInput(form.ownerDocument, form, 'title', startText(app.language, 'name'), cluster.title);
  }, async form => {
    const title = fieldValue(form, 'title').trim();
    if (!title || title === cluster.title) return true;
    const current = app.store.indexes.groups.get(cluster.id) ?? cluster;
    const operation = createOperation({ method: 'PATCH', path: '/clusters/:clusterId', params: { clusterId: cluster.id }, body: { title, machine: startMachine(app), expectedRevision: current.revision } });
    await request(app.api, 'PATCH', operation.path, { operation });
    await loadStartReports(app);
    return true;
  }, 'rename-cluster');
}

function openMoveAgent(app, unit) {
  const home = unitCluster(app, unit);
  const choices = [...app.store.indexes.groups.values()].filter(group => !group.deleted && group.id !== home?.id);
  openChoiceForm(app, 'move-agent', startText(app.language, 'moveTitle', { name: unitDisplayName(unit) }), form => {
    appendSelect(form.ownerDocument, form, 'clusterId', startText(app.language, 'moveTo'), choices.map(group => ({ value: group.id, label: group.title })), choices[0]?.id ?? '');
  }, async form => {
    const target = app.store.indexes.groups.get(fieldValue(form, 'clusterId'));
    if (!target) return false;
    if (!target.members.includes(unit.id)) await setClusterMembers(app, target, [...target.members, unit.id]);
    await loadStartReports(app);
    const old = home && app.store.indexes.groups.get(home.id);
    if (old?.members.includes(unit.id)) await setClusterMembers(app, old, old.members.filter(id => id !== unit.id));
    await refreshAfterMembership(app);
    return true;
  }, 'move-agent');
}

// The agent stays, with its chat; it only leaves the cluster, so the Map stops drawing it until it is moved to one.
function detachAgent(app, unit, cluster) {
  const t = (key, values) => startText(app.language, key, values), name = unitDisplayName(unit);
  const dialog = showDialog(app.root.ownerDocument, {
    title: t('detachTitle', { name, cluster: cluster.title }), body: t('detachBody'), confirm: t('detachConfirm'), cancel: text(app.language, 'cancel'), retry: text(app.language, 'retry'),
    onConfirm: async () => {
      const fresh = app.store.indexes.groups.get(cluster.id) ?? cluster;
      await setClusterMembers(app, fresh, fresh.members.filter(id => id !== unit.id));
      await refreshAfterMembership(app);
      showMapToast(app, t('detached', { name, cluster: cluster.title }), async () => {
        const current = app.store.indexes.groups.get(cluster.id);
        if (current && !current.members.includes(unit.id)) await setClusterMembers(app, current, [...current.members, unit.id]);
        await refreshAfterMembership(app);
      });
      renderShell(app);
    },
  });
  dialog.setAttribute('data-form', 'detach-agent');
}

function ensureMap(app) {
  const units = app.unitList?.catalog?.length ? app.unitList.catalog : [...(app.store.indexes.units?.values?.() ?? [])];
  const saved = app.store.layout ?? { layout: { nodes: {}, groups: {} }, revision: null };
  const groups = [...app.store.indexes.groups.values()];
  if (!app.mapState) app.mapState = createMap({ units, groups, saved, api: app.api });
  else {
    app.mapState.units = units;
    adoptInitialLayout(app.mapState, saved);
  }
  app.mapState.api = app.api;
  app.mapState.groups = groups;
  const clusterKey = groups.filter(group => !group.deleted).map(group => group.id).sort().join('\0');
  if (app.mapState.clusterKey !== clusterKey) {
    app.mapState.clusterKey = clusterKey;
    app.mapState.fitted = false;
  }
  settlePositions(app.mapState);
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
  app.mapState.onContextMenu = (target) => openItemMenu(app, { ...target, source: 'map' });
  app.mapState.onPersonalGroup = (id) => selectGroup(app, id);
  app.mapState.onOpenCluster = (id) => openCluster(app, id);
  app.mapState.onServices = () => { navigate(app, 'settings'); };
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
  if (!app.mapState.fitted && rect.width > 96 && rect.height > 96) { app.mapState.view = fitMap(app.mapState, rect); app.mapState.fitted = true; }
  if (app.pendingClusterFlight) { flyToCluster(app.mapState, app.pendingClusterFlight, rect); app.pendingClusterFlight = null; }
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
    fit: text(app.language, 'finalFit'), services: text(app.language, 'services'),
    zoomIn: text(app.language, 'finalZoomIn'), zoomOut: text(app.language, 'finalZoomOut'),
    zoom: text(app.language, 'finalZoom'), zoomReset: text(app.language, 'finalZoomReset'),
    incubator: text(app.language, 'finalIncubator'), genesis: text(app.language, 'finalGenesis'),
    drag: startText(app.language, 'drag'), unread: count => startText(app.language, 'unread', { count }),
    roleName: node => unitRoleName(node, app.language),
    inside: (name, count) => startText(app.language, 'inside', { name, count }),
  };
  renderMap(app.root.ownerDocument, host, app.mapState, app.mapState.labels);
  if (['queued', 'starting'].includes(app.sessionRequest?.state)) {
    const node = host.querySelector(`[data-unit-id="${app.sessionRequest.unitId}"]`);
    node?.append(element(app.root.ownerDocument, 'span', { class: 'spinner', 'data-starting-ring': app.sessionRequest.requestId, 'aria-hidden': 'true', style: 'position:absolute;left:50%;top:50%;width:60px;height:60px;margin-left:-30px;margin-top:-30px;pointer-events:none' }));
  }
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
  if (app.layout === 'desktop' && app.tab === 'hierarchy') loadVisibleClusterGit(app, host);
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

function loadVisibleClusterGit(app, host) {
  app.clusterGit ??= new Map(); app.clusterGitPending ??= new Set();
  const visible = new Set([...host.querySelectorAll('[data-cluster-row]')].map(node => node.getAttribute('data-cluster-row')));
  const work = (app.activeRows ?? []).filter(row => row.kind === 'cluster' && row.group.link.kind === 'repository' && visible.has(row.groupId)
    && app.clusterGit.get(row.groupId)?.revision !== row.group.revision && !app.clusterGitPending.has(row.groupId));
  if (!work.length) return;
  for (const row of work) app.clusterGitPending.add(row.groupId);
  Promise.allSettled(work.map(async row => {
    let git = null;
    try { git = (await startApi.getClusterGit(app.api, row.groupId, startMachine(app))).data; }
    finally { app.clusterGit.set(row.groupId, { revision: row.group.revision, git }); app.clusterGitPending.delete(row.groupId); }
  })).then(() => { if (!app.disposed) renderShell(app); });
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
        const when = formatShortTime(app.language, last?.timestamp || last?.date || "");
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
  const currentUnits = [...new Map([...(list.catalog ?? []), ...app.store.indexes.units.values()].map(unit => [unit.id, unit])).values()];
  const source = unitsForTree(list.query ? list.items : currentUnits, currentUnits);
  const tree = buildHierarchy(app.store.audience === 'phone' ? source.filter(unit => unit.role !== 'master') : source, list.issues, [...app.store.indexes.groups.values()]);
  if (app.layout === 'desktop') for (const cluster of tree.clusters) {
    const link = app.startProjects?.clusterLinks?.find(item => item.clusterId === cluster.id);
    const offered = app.startProjects?.discoveryOffer?.groups.flatMap(group => group.repositories).find(repo => repo.worktrees.some(worktree => worktree.path && worktree.path === link?.localPath));
    cluster.worktrees = listedWorktrees(link?.localPath, offered?.worktrees ?? []);
  }
  collapseNewClusters(app.hierarchy, tree.clusters);
  const rows = flattenVisibleHierarchy(tree, app.hierarchy, list.query);
  const labels = new Map();
  for (const row of rows) if (row.kind === "unit") labels.set(row.label, (labels.get(row.label) ?? 0) + 1);
  for (const row of rows) {
    if (row.kind === "unit") {
      const scope = row.unit.scope?.name;
      const name = labels.get(row.label) > 1 && scope ? `${row.label} · ${scope}` : row.label;
      const roleText = unitRoleName(row.unit, app.language);
      row.text = `${name}${roleText ? ` (${roleText})` : ''} ${t(statusKey(row.unit.status))}`;
    } else if (row.labelKey === 'clusters' || row.labelKey === 'more') row.text = startText(app.language, row.labelKey, { count: row.count });
    else if (row.labelKey === "showMore") row.text = t("showMore", { count: formatNumber(app.language, row.count) });
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
  const state = settingsState(app);
  if (!state.loaded && !state.loading && !state.error) loadSettingsSections(app);
  const info = state.info ?? (state.machine === state.localMachine ? app.store.settings ?? {} : { service: { machine: state.machine, state: "unknown" } });
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
  const panel = renderSettings(document, {
    tab: state.tab,
    machine: state.machine,
    localMachine: state.localMachine,
    machineMenu: state.machineMenu,
    machines: state.machines ?? app.store.view?.machines ?? [],
    readOnly: state.info?.readOnly ?? state.machine !== state.localMachine,
    reportedAt: info.reportedAt,
    loading: state.loading,
    error: state.error ? actionText(app.language, state.error.code) : null,
    locations: info.locations,
    agents: state.agents,
    permissions: state.permissions,
    pendingGrants: state.pendingGrants,
    projects: state.projects,
    content: state.content,
    contentDraft: state.contentDraft,
    contentDirty: state.contentDirty,
    contentConflict: state.contentConflict,
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
    canRevoke: app.store.capabilities.includes("grant.revoke"),
    now: Date.now(),
  }, t, {
    onTab: (tab) => {
      state.tab = tab; state.machineMenu = false;
      if (tab !== "general") clearGrant(home);
      renderShell(app);
      app.root.querySelector(`[data-settings-tab="${tab}"]`)?.focus();
    },
    onMachineMenu: (open) => {
      state.machineMenu = typeof open === "boolean" ? open : !state.machineMenu;
      renderShell(app);
      app.root.querySelector(state.machineMenu ? `[data-machine-choice="${state.machine}"]` : "[data-action='settings-machine']")?.focus();
    },
    onMachine: (machine) => {
      state.machine = machine; state.machineMenu = false;
      state.info = null; state.agents = null; state.permissions = null; state.projects = null;
      loadSettingsSections(app);
      renderShell(app);
      app.root.querySelector("[data-action='settings-machine']")?.focus();
    },
    onRetry: () => loadSettingsSections(app),
    onStartup: (startWithWindows) => settingsMutation(app, "PATCH", "/settings/service", { machine: state.machine, startWithWindows, expectedRevision: info.service?.revision ?? null }),
    onRestart: () => restartSelectedService(app, state.machine),
    onScan: () => settingsMutation(app, "POST", "/settings/agents/scan", { machine: state.machine }),
    onFind: (agent) => findSettingsAgent(app, agent),
    onReview: (agent, mode, target) => reviewSettingsAgent(app, agent, mode, target),
    onDisconnect: (agent) => disconnectSettingsAgent(app, agent),
    onRevokeGrant: (item) => revokeSettingsGrant(app, item),
    onRevokePermission: (item) => settingsMutation(app, "DELETE", `/settings/permissions/${encodeURIComponent(item.id)}`, { machine: state.machine, expectedRevision: state.permissions.revision }),
    onLinkFolder: () => openClusterLink(app, null, state.machine),
    onRemoveLink: link => removeStartLink(app, link, state.machine),
    onAdd: () => openSharedAdd(app),
    onUpdateAddition: item => openSharedAdd(app, item),
    onRemoveAddition: item => confirmRemoveAddition(app, item),
    onContentItem: (field, id, included) => {
      contentSettingsDraft(state)[field].find(item => item.id === id).included = included;
      state.contentGeneration = (state.contentGeneration ?? 0) + 1;
      state.contentDirty = true; renderShell(app);
    },
    onPreference: (key, value, paint = true) => {
      contentSettingsDraft(state).preferences[key] = value; state.contentDirty = true;
      state.contentGeneration = (state.contentGeneration ?? 0) + 1;
      if (paint) renderShell(app);
      else { const save = app.root.querySelector("[data-action='settings-save-content']"); if (save) save.disabled = false; }
    },
    onSaveContent: () => saveSettingsContent(app),
    onReloadContent: () => {
      state.contentDraft = null; state.contentDirty = false; state.contentConflict = false;
      inputDrafts(app).fields.delete("settings|instructions");
      const key = "settings:PATCH:/settings/content";
      app.activity?.delete(key); clearMatchedError(app, key);
      renderShell(app);
      app.root.querySelector("[data-preference-instructions]")?.focus();
    },
    onLook: (look) => chooseSetting(app, { look }),
    onLanguage: (language) => chooseSetting(app, { language }),
    onOpen: (raw, replacing) => beginHome(app, raw, replacing),
    onClose: () => endHome(app),
    onSelect: (index) => {
      home.selected = index;
      renderShell(app);
    },
    onDismissHome: () => {
      clearGrant(home); home.phoneDialogFocused = false; renderShell(app);
      app.root.querySelector("[data-action='replace-home']")?.focus();
    },
  });
  if (outcomeVisible(app) && app.actionScope === "settings") panel.append(element(document, "p", {
    class: "settings-toast", "data-settings-toast": "true", "data-action-note": "true", text: app.actionNote,
  }));
  if (app.mapToast) panel.append(mapToast(app, t));
  return panel;
}

function settingsState(app) {
  if (!app.settingsState) {
    const localMachine = app.store.settings?.selectedMachine ?? app.store.settings?.service?.machine ?? app.store.view?.mind?.machine ?? "";
    app.settingsState = { tab: "general", machine: localMachine, localMachine, loaded: false, loading: false, ticket: 0 };
  }
  return app.settingsState;
}

function loadSettingsSections(app) {
  const state = settingsState(app);
  const machine = state.machine;
  const ticket = ++state.ticket;
  state.loading = true; state.error = null;
  const pending = readSettingsSections(app, state, machine, ticket);
  state.pending = pending;
  return pending;
}

async function readSettingsSections(app, state, machine, ticket) {
  const query = `?machine=${encodeURIComponent(machine)}`;
  try {
    const results = await Promise.all([
      ...["/settings", "/settings/agents", "/settings/permissions", "/settings/projects", "/settings/content"]
        .map(path => request(app.api, "GET", path + (path === "/settings/content" ? "" : query))),
      collectPages(app.api, "/machines", { limit: 50 }).then(page => ({ data: page.items })),
    ]);
    if (app.disposed) return;
    if (ticket !== state.ticket) return state.pending;
    [state.info, state.agents, state.permissions, state.projects, state.content] = results.map(result => result.data);
    state.machines = results[5].data;
    for (const id of state.pendingGrants ?? []) if (!state.permissions.unitGrants.some(item => item.grant.id === id)) state.pendingGrants.delete(id);
    state.loaded = true;
    if (!state.contentDirty) state.contentDraft = null;
    else if (state.contentDraft) for (const field of ['features', 'knowledge']) {
      const draft = new Map(state.contentDraft[field].map(item => [item.id, item]));
      state.contentDraft[field] = state.content[field].map(item => ({ ...item, included: draft.get(item.id)?.included ?? item.included }));
    }
    if (state.info.home) {
      const home = homeState(app);
      applySettingsRead(home, { home: state.info.home });
      if (app.store.settings) app.store.settings.home = home.home;
    }
  } catch (error) {
    if (app.disposed) return;
    if (ticket !== state.ticket) return state.pending;
    state.error = error;
  } finally {
    if (!app.disposed && ticket === state.ticket) {
      state.loading = false;
      if (app.mode === "settings") renderShell(app);
    }
  }
}

async function commitSettingsMutation(app, record, method, path, body) {
  const retained = await reuseOrReconcile(app, record, method, path, operation => samePayload(operation.body, body));
  record.operation = retained ?? createOperation({ method, path, body });
  return request(app.api, method, path, { operation: record.operation });
}

function settingsMutation(app, method, path, body, onSuccess = null) {
  return settle(app, `settings:${method}:${path}`, text(app.language, "savingSetting"), async record => {
    try {
      const result = await commitSettingsMutation(app, record, method, path, body);
      onSuccess?.(result.data);
      await loadSettingsSections(app);
      showOutcome(app, text(app.language, path === "/settings/service/restart" ? "settingsRestartRequested" : "saved"), "settings_saved", "status", "settings");
      return result;
    } catch (error) {
      if (["revision_conflict", "configuration_changed", "machine_unavailable"].includes(error.code)) {
        if (path === "/settings/content") settingsState(app).contentConflict = true;
        await loadSettingsSections(app);
      }
      throw error;
    }
  });
}

function restartSelectedService(app, machine) {
  return settle(app, 'service-recovery', recoveryText(app, 'restart'), async record => {
    if (!app.recovery && machine === (app.store.settings?.service?.machine ?? app.store.view?.mind?.machine)) { showServiceDetails(app); return; }
    if (machine === (app.store.settings?.service?.machine ?? app.store.view?.mind?.machine) && app.serviceStopped) {
      if (!app.recovery) { showServiceDetails(app); return; }
    } else {
      await commitSettingsMutation(app, record, 'POST', '/settings/service/restart', { machine });
    }
    if (app.recovery && machine === (app.store.settings?.service?.machine ?? app.store.view?.mind?.machine)) {
      if (!await recoverSession(app)) throw app.recoveryError ?? new ApiError(0, 'service_unavailable', recoveryText(app, 'unavailable'));
    }
  });
}

function showServiceDetails(app) {
  const document = app.root.ownerDocument;
  const path = String(app.selectedFolder ?? '').replace(/[\r\n"\u0000]/g, '');
  const command = `hivem1nd service install${path ? ` --mind-path "${path}"` : ''}`;
  const dialog = showDialog(document, { title: recoveryText(app, 'details'), body: recoveryText(app, 'unavailable'), cancel: text(app.language, 'close') });
  dialog.setAttribute('data-service-details', 'true');
  dialog.append(element(document, 'p', { text: recoveryText(app, 'instructions', { command }) }));
  if (app.recoveryError) dialog.append(element(document, 'p', { text: String(app.recoveryError.code ?? 'service_unavailable').replace(/[^a-z0-9_]/gi, '') }));
}

function paintServiceBanner(app, shell) {
  if (app.layout === 'phone' || app.bootReading) return;
  const stream = app.store.stream;
  if (!app.serviceStopped && !app.recoveryError && !['connecting', 'reconnecting', 'error'].includes(stream?.state)) return;
  const document = app.root.ownerDocument;
  const stopped = app.serviceStopped === true;
  const error = stopped || stream?.state === 'error' || app.recoveryError;
  const banner = element(document, 'div', { role: error ? 'alert' : 'status', 'data-service-banner': stopped ? 'stopped' : error ? 'unavailable' : 'reconnecting' });
  // These scoped board dimensions avoid altering other task surfaces.
  Object.assign(banner.style, { position: 'absolute', top: '40px', left: 'calc(50% - 260px)', zIndex: '20', padding: '10px 12px 10px 14px',
    display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '14px', background: error ? 'var(--error-soft)' : 'var(--waiting-soft)', fontSize: '13px', maxWidth: 'calc(100% - 28px)' });
  if (!error) banner.append(element(document, 'span', { class: 'spinner', 'aria-hidden': 'true', style: 'width:15px;height:15px' }));
  banner.append(element(document, 'span', { 'data-service-copy': 'true', text: recoveryText(app, stopped ? 'stopped' : error ? 'unavailable' : 'reconnecting', {
    machine: app.store.settings?.service?.machine ?? app.store.view?.mind?.machine ?? '',
  }) }));
  const button = (action, key, handler) => element(document, 'button', { type: 'button', class: 'btn', 'data-action': action,
    style: 'min-height:32px;min-width:32px', text: recoveryText(app, key), disabled: app.recoveryPending ? '' : null, onclick: handler });
  if (error) banner.append(button('service-details', 'details', () => showServiceDetails(app)));
  if (stopped) banner.append(button('recover-service', 'restart', () => app.recovery ? recoverSession(app) : showServiceDetails(app)));
  else banner.append(button('retry-service', 'retry', () => app.recovery && !app.api.token ? recoverSession(app) : startServiceStream(app)));
  shell.append(banner);
}

function contentSettingsDraft(state) {
  state.contentDraft ??= structuredClone(state.content);
  return state.contentDraft;
}

function saveSettingsContent(app) {
  const state = settingsState(app);
  const draft = contentSettingsDraft(state);
  const generation = state.contentGeneration ?? 0;
  const body = { includedFeatures: draft.features.filter(item => item.included).map(item => item.id),
    includedKnowledge: draft.knowledge.filter(item => item.included).map(item => item.id),
    preferences: { ...draft.preferences }, expectedRevision: draft.revision };
  return settingsMutation(app, "PATCH", "/settings/content", body, data => {
    state.content = data;
    if (generation === (state.contentGeneration ?? 0)) { state.contentDirty = false; state.contentDraft = null; }
    else state.contentDraft.revision = data.revision;
    state.contentConflict = false;
  });
}

function mountSettingsDialog(app, dialog, opener) {
  const state = settingsState(app);
  state.dialog = dialog;
  dialog.setAttribute("data-look", app.look);
  dialog.addEventListener("close", () => {
    dialog.replaceChildren(); dialog.remove();
    if (state.dialog === dialog) state.dialog = null;
    restoreInvoker(app, opener);
  });
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); dialog.close(); return; }
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll("button, input, select, textarea, summary")].filter(node => !node.disabled && !node.closest("[hidden]")
      && node.getAttribute("tabindex") !== "-1" && node.getAttribute("type") !== "hidden"
      && (!node.closest("details") || node.tagName === "SUMMARY" || node.closest("details").getAttribute("open") !== null || node.closest("details").open));
    if (event.shiftKey && dialog.ownerDocument.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && dialog.ownerDocument.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  });
  dialog.ownerDocument.body.append(dialog);
  dialog.showModal();
  dialog.querySelector("input, button")?.focus();
  return dialog;
}

function reviewSettingsAgent(app, agent, mode, target) {
  const state = settingsState(app);
  const machine = state.machine;
  const opener = target === "app" ? `settings-app-${agent.id}` : agent.cli.state === "connected" ? `settings-mode-${agent.id}-${mode}` : `settings-review-${agent.id}`;
  return settle(app, `settings-preview:${agent.id}`, text(app.language, "settingsReview"), async record => {
    const path = `/settings/agents/${encodeURIComponent(agent.id)}/preview`;
    const result = await commitSettingsMutation(app, record, "POST", path, { machine, mode, target, allowGit: false });
    if (app.disposed || state.machine !== machine || app.mode !== "settings") return;
    const review = { agent, machine, target, opener, preview: result.data, selected: new Set(result.data.changes.filter(change => !change.optional && change.selected).map(change => change.id)) };
    const t = (key, variables) => text(app.language, key, variables);
    const dialog = renderClientReview(app.root.ownerDocument, review, t, {
      onCopy: async ids => {
        const value = review.preview.changes.filter(change => ids.includes(change.id)).map(change => `${change.path}\n${change.afterText}`).join("\n\n");
        try {
          const clipboard = dialog.ownerDocument.defaultView?.navigator?.clipboard;
          if (clipboard?.writeText) await clipboard.writeText(value);
          else {
            let field = dialog.querySelector("[data-copy-changes]");
            if (!field) { field = element(dialog.ownerDocument, "textarea", { "data-copy-changes": "true", readonly: "true", "aria-label": t("settingsCopy") }); dialog.append(field); }
            field.value = value; field.focus(); field.select?.();
          }
        } catch { settingsDialogError(dialog, t("settingsCopyFailed")); }
      },
      onApply: ids => applySettingsReview(app, dialog, review, ids),
    });
    state.dialog?.close();
    mountSettingsDialog(app, dialog, opener);
  });
}

function settingsDialogError(dialog, message) {
  dialog.querySelector("[data-settings-dialog-error]")?.remove();
  dialog.append(element(dialog.ownerDocument, "p", { role: "alert", "data-settings-dialog-error": "true", text: message }));
}

function applySettingsReview(app, dialog, review, ids) {
  const path = `/settings/agents/${encodeURIComponent(review.agent.id)}/apply`;
  const controls = [...dialog.querySelectorAll("button, input")];
  for (const control of controls) control.disabled = true;
  return track(app, `settings-apply:${review.preview.previewId}`, text(app.language, "savingSetting"), async record => {
    const result = await commitSettingsMutation(app, record, "POST", path, { machine: review.machine, previewId: review.preview.previewId, changeIds: ids, expectedRevision: review.preview.revision });
    dialog.close();
    await loadSettingsSections(app);
    const invoker = app.root.querySelector(`[data-action="${review.opener}"]`) ?? app.root.querySelector(`[data-agent="${review.agent.id}"] button`);
    invoker?.focus();
    showOutcome(app, text(app.language, "settingsConnected"), "settings_connected", "status", "settings");
    return result;
  }).catch(error => {
    const unconfirmed = Boolean(findUncertain(app.api, "POST", path));
    for (const control of controls) control.disabled = unconfirmed && control.tagName === "INPUT";
    if (dialog.getAttribute("open") !== null) settingsDialogError(dialog, actionText(app.language, error.code));
    noteAction(app, error, `settings-apply:${review.preview.previewId}`);
  });
}

function disconnectSettingsAgent(app, agent) {
  const state = settingsState(app);
  const machine = state.machine;
  const revision = state.agents.revision;
  const dialog = showDialog(app.root.ownerDocument, {
    title: text(app.language, "settingsDisconnectTitle", { client: agent.name }), body: text(app.language, "finalBackupExplanation"),
    confirm: text(app.language, "settingsDisconnect"), cancel: text(app.language, "cancel"), retry: text(app.language, "retry"),
    onConfirm: () => track(app, `settings-disconnect:${machine}:${agent.id}`, text(app.language, "working"), async record => {
      await commitSettingsMutation(app, record, "DELETE", `/settings/agents/${encodeURIComponent(agent.id)}`, { machine, confirmed: true, expectedRevision: revision });
      await loadSettingsSections(app);
    }),
  });
  dialog.className += " settings-review";
  dialog.setAttribute("data-settings-disconnect", agent.id);
  dialog.addEventListener("close", () => restoreInvoker(app, `settings-disconnect-${agent.id}`));
}

function findSettingsAgent(app, agent) {
  const machine = settingsState(app).machine;
  openChoiceForm(app, "settings-find", text(app.language, "settingsFind"), form => {
    form.append(labeledField(form.ownerDocument, text(app.language, "registerPath"), text(app.language, "settingsFindHint"),
      element(form.ownerDocument, "input", { name: "path", "aria-label": text(app.language, "registerPath") })));
  }, async form => {
    const path = form.querySelector("[name='path']").value;
    await track(app, `settings-find:${machine}:${agent.id}`, text(app.language, "working"), async record => {
      await commitSettingsMutation(app, record, "POST", "/settings/agents/find", { machine, client: agent.id, path });
      await loadSettingsSections(app);
    });
    return true;
  }, `settings-find-${agent.id}`);
}

function revokeSettingsGrant(app, item) {
  const state = settingsState(app);
  if (state.info?.readOnly) return;
  return settle(app, `settings-grant:${item.grant.id}`, text(app.language, "revoke"), async record => {
    const unit = await request(app.api, "GET", `/units/${encodeURIComponent(item.unitId)}`);
    const result = await commitSettingsMutation(app, record, "DELETE", `/units/${encodeURIComponent(item.unitId)}/approval-grants/${encodeURIComponent(item.grant.id)}`, { expectedRevision: unit.data.revision });
    if (result.data.state !== "revoked") {
      state.pendingGrants ??= new Set(); state.pendingGrants.add(item.grant.id);
      app.revocationRequestId = result.data.requestId ?? null; app.revocationUnitId = item.unitId;
    }
    await loadSettingsSections(app);
    showOutcome(app, text(app.language, result.data.state === "revoked" ? "grantRevoked" : "grantPending"), "grant_revoke", "status", "settings");
    return result;
  });
}

function homeState(app) {
  if (!app.homeState) app.homeState = { grant: null, home: app.store.settings?.home ?? null, expectGrant: false, selected: 0 };
  return app.homeState;
}

function clearPhoneDialog(app) {
  const dialog = app.root.querySelector("[data-phone-dialog]");
  if (!dialog) return;
  for (const node of dialog.querySelectorAll("[data-secret], [data-qr], [data-code]")) {
    node.removeAttribute("data-qr"); node.removeAttribute("data-code"); node.replaceChildren(); node.textContent = "";
  }
  dialog.replaceChildren(); dialog.remove();
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
  if (app.settingsState?.machine === app.settingsState?.localMachine && app.settingsState.info) app.settingsState.info.service = app.store.settings.service;
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
        if (Object.hasOwn(patch, "sendToAgent") && homeState(app).sendToAgentChoice === patch.sendToAgent) homeState(app).sendToAgentChoice = null;
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
  return ["look", "language", "sendToAgent"].every((key) => (key in patch) === (key in body) && (!(key in patch) || patch[key] === body[key]));
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
  const home = homeState(app);
  applySettingsRead(home, app.store.settings);
  editorsOf(app).sendToAgent = home.sendToAgentChoice ?? home.settings.sendToAgent;
  applyChoice(app, presentation(app.store.viewer, result.data.settings));
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
  const previous = app.activity.get(key);
  return runAction(app.activity, key, {
    label,
    work: (record) => waitForActivity(app, record, work, previous),
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

function waitForActivity(app, record, work, previous) {
  record.startedAt = app.api.now();
  record.elapsed = 0;
  const running = previous?.localPending ? previous.localWork : Promise.resolve().then(() => work(record));
  record.localWork = running;
  record.localPending = true;
  let deadline;
  let tick;
  const waiting = new Promise((_, reject) => {
    record.cancel = () => reject(new ApiError(0, "wait_canceled", "The local wait was canceled."));
    deadline = setTimeout(() => reject(new ApiError(0, "timeout", "The request timed out.")), 30000);
    const update = () => {
      record.elapsed = Math.max(0, Math.floor((app.api.now() - record.startedAt) / 1000));
      if (!app.disposed && record.phase === "pending") renderShell(app);
      tick = setTimeout(update, 1000);
      tick.unref?.();
    };
    tick = setTimeout(update, 1000);
    tick.unref?.();
    deadline.unref?.();
  });
  running.then((result) => {
    record.localPending = false;
    if (app.activity.get(record.key) === record && record.phase === "error" && ["wait_canceled", "timeout"].includes(record.error?.code)) {
      record.phase = "success";
      record.result = result;
      record.error = null;
      clearMatchedError(app, record.key);
      if (!app.disposed) renderShell(app);
    }
  }, (error) => {
    record.localPending = false;
    if (error?.operation) record.operation = error.operation;
  });
  return Promise.race([running, waiting]).finally(() => {
    clearTimeout(deadline);
    clearTimeout(tick);
    record.cancel = null;
  });
}

function libraryActions(app, kind) {
  const editors = editorsOf(app);
  const state = libraryState(editors, kind);
  const refresh = () => editorAct(app, `library:${kind}:${JSON.stringify([state.query, state.filters])}`, text(app.language, "loadingList"), async () => loadCatalog(app.api, editors, kind));
  return {
    select: (item) => selectEditor(app, item), refresh,
    query: (value) => { state.query = value; refresh(); },
    filter: (key, value) => {
      if (value == null) delete state.filters[key]; else state.filters[key] = value;
      refresh();
    },
    toggle: (key) => {
      const collapsed = state.query || Object.keys(state.filters).length ? state.matchingCollapsed : state.collapsed;
      if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
      renderShell(app);
    },
    menu: (type, entry, control) => {
      const box = control.getBoundingClientRect();
      const view = app.root.ownerDocument.defaultView;
      state.menu = state.menu?.type === type && state.menu.entry?.id === entry?.id ? null : {
        type, entry, opener: control.getAttribute("data-action"), x: Math.max(8, Math.min(box.left, (view?.innerWidth ?? 1440) - 238)),
        y: Math.max(8, Math.min(box.bottom ?? box.top + 32, (view?.innerHeight ?? 900) - 240)),
      };
      renderShell(app);
      app.root.querySelector("[data-library-menu]")?.querySelector("button")?.focus?.();
    },
    closeMenu: () => { const opener = state.menu?.opener; state.menu = null; renderShell(app); restoreInvoker(app, opener); },
    create: canEditResources(app) ? () => openResourceForm(app, kind, "create") : null,
    folder: () => newLibraryFolder(app, kind),
    manage: canEditResources(app) ? (action, entry, type) => {
      state.menu = null;
      if (action === "rename") beginLibraryRename(app, kind, entry, type);
      else if (action === "delete") deleteLibraryEntry(app, kind, entry, type);
      else if (action === "duplicate") openLibraryCreate(app, kind, entry);
      else openLibraryMove(app, kind, entry);
    } : null,
    saveRename: () => saveLibraryRename(app, kind),
    cancelRename: () => { const entry = state.rename; if (entry?.busy) return; state.rename = null; renderShell(app); focusLibraryEntry(app, entry); },
  };
}

function focusLibraryEntry(app, entry) {
  const selector = entry?.type === "folder" ? `[data-action="folder-${entry.id}"]` : `[data-id="${entry?.id}"]`;
  (app.root.querySelector(selector) ?? app.root.querySelector("[data-library-search]"))?.focus?.();
}

function beginLibraryRename(app, kind, entry, type) {
  const state = libraryState(editorsOf(app), kind);
  state.rename = { id: entry.id, type, project: entry.project, title: entry.title, entry, operation: null, busy: false, error: null };
  if (type === "item") {
    const editing = state.rename;
    editing.read = request(app.api, "GET", kind === "blueprint" ? "/blueprint/boards/:resourceId" : "/void/texts/:resourceId", { params: { resourceId: entry.id } })
      .then((result) => { editing.record = result.data; }).catch((error) => { editing.readError = error; });
  } else {
    state.collapsed.delete(`project:${entry.project}`);
    state.matchingCollapsed.delete(`project:${entry.project}`);
    let parentId = entry.parentId;
    const parents = new Set();
    while (parentId && !parents.has(parentId)) {
      parents.add(parentId);
      state.collapsed.delete(`${entry.project}:${parentId}`);
      state.matchingCollapsed.delete(`${entry.project}:${parentId}`);
      parentId = state.folders.find((folder) => folder.id === parentId && folder.project === entry.project)?.parentId;
    }
  }
  renderShell(app);
  const input = app.root.querySelector(`[data-library-rename="${entry.id}"]`);
  input?.focus?.(); input?.setSelectionRange?.(0, entry.title.length);
}

async function saveLibraryRename(app, kind) {
  const editors = editorsOf(app), state = libraryState(editors, kind), editing = state.rename;
  if (!editing || editing.busy) return;
  const title = editing.title.trim();
  if (!title || title.length > 240 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(title)) {
    editing.error = text(app.language, "groupNameRequired"); renderShell(app); return;
  }
  editing.busy = true; editing.error = null;
  renderShell(app);
  try {
    let result;
    if (editing.type === "folder") {
      const operation = editing.operation ?? createOperation({ method: "PATCH", path: "/library/folders/:folderId", params: { folderId: editing.id }, body: { project: editing.project, title, expectedRevision: editing.entry.revision } });
      editing.operation = operation;
      result = await request(app.api, "PATCH", operation.path, { operation });
    } else {
      await editing.read;
      if (editing.readError) throw editing.readError;
      result = await libraryChange(app.api, editing.record, title, editing.record.folderId, editing.record.libraryRevision, editing.operation);
      applyLibraryRecord(app, result.data, editing.id);
    }
    state.rename = null;
    await loadCatalog(app.api, editors, kind);
    if (!app.disposed) { renderShell(app); focusLibraryEntry(app, editing); }
  } catch (error) {
    editing.operation = error.operation ?? editing.operation;
    editing.error = actionText(app.language, error.code);
    editing.busy = false;
    if (!app.disposed) { renderShell(app); app.root.querySelector(`[data-library-rename="${editing.id}"]`)?.focus?.(); }
  }
}

function applyLibraryRecord(app, record, previousId = record.id) {
  const editors = editorsOf(app);
  const draft = editors.drafts.get(previousId) ?? (editors.current?.resourceId === previousId ? editors.current : null);
  if (!draft) return;
  if (previousId !== record.id) {
    editors.drafts.delete(previousId);
    if (app.store.open.editors.delete(previousId)) app.store.open.editors.set(record.id, record.kind);
    if (app.store.open.comments.delete(previousId)) app.store.open.comments.add(record.id);
    if (editors.focus?.resourceId === previousId) editors.focus.resourceId = record.id;
    if (draft.textDrafts?.size) draft.textDrafts = new Map([...draft.textDrafts].map(([key, value]) => {
      const [resourceId, k, language] = key.split("\0");
      return [resourceId === previousId ? textDraftKey(record.id, k, language) : key, value];
    }));
    const nodes = draftMap(app, "nodes");
    if (nodes.has(previousId)) { nodes.set(record.id, nodes.get(previousId)); nodes.delete(previousId); }
  }
  draft.resourceId = record.id;
  draft.authoritative = record;
  draft.revision = record.revision;
  draft.commentsRevision = record.commentsRevision;
  draft.attachmentRevision = record.attachmentRevision;
  editors.drafts.set(record.id, draft);
  if (app.store.selected.resourceId === previousId) app.store.selected.resourceId = record.id;
}

function libraryProjects(app, kind) {
  return libraryState(editorsOf(app), kind).projects.filter((entry) => entry.eligible !== false);
}

function libraryProjectField(app, form, kind, value = "") {
  const document = form.ownerDocument;
  const select = element(document, "select", { name: "project", "data-field": "create-project", required: "" }, element(document, "option", { value: "", text: text(app.language, "chooseProject") }));
  for (const project of libraryProjects(app, kind)) select.append(element(document, "option", { value: project.id ?? project.name, text: project.name ?? project.id }));
  select.value = value;
  form.append(labeledField(document, text(app.language, "registerProject"), text(app.language, kind === "blueprint" ? "boardRepositoryHint" : "textRepositoryHint"), select));
  return select;
}

function libraryFolderField(app, form, kind, project, folderId = null) {
  const document = form.ownerDocument;
  const select = element(document, "select", { name: "folderId", "data-field": "create-folder" });
  const paint = () => {
    select.replaceChildren(element(document, "option", { value: "", text: text(app.language, "projectRoot") }));
    const folders = libraryState(editorsOf(app), kind).folders.filter((folder) => folder.project === project.value);
    const title = (folder) => { const parent = folders.find((entry) => entry.id === folder.parentId); return parent ? `${title(parent)} / ${folder.title}` : folder.title; };
    for (const folder of folders) select.append(element(document, "option", { value: folder.id, text: title(folder) }));
    select.value = folders.some((folder) => folder.id === folderId) ? folderId : "";
    folderId = null;
  };
  project.addEventListener("change", paint); paint();
  form.append(element(document, "label", { class: "field" }, element(document, "span", { class: "field-label", text: text(app.language, "folder") }), select));
  return select;
}

function openLibraryCreate(app, kind, source = null) {
  const document = app.root.ownerDocument;
  if (document.querySelector('[data-form="library-create"]')) return;
  const state = libraryState(editorsOf(app), kind);
  state.menu = null;
  renderShell(app);
  let operation = null;
  openChoiceForm(app, "library-create", text(app.language, kind === "blueprint" ? "newBoard" : "newText"), (form, confirm) => {
    confirm.setAttribute("data-action", "create-resource");
    confirm.textContent = text(app.language, kind === "blueprint" ? "finalCreateBoard" : "createText");
    const heading = form.querySelector("h2"); heading.remove();
    form.append(element(document, "div", { class: "library-dialog-heading" }, heading, element(document, "p", { text: text(app.language, kind === "blueprint" ? "finalNewBoardHint" : "newTextHint") })));
    const pair = element(document, "div", { class: "library-field-pair" });
    const name = editorField(document, app, (key) => text(app.language, key), "title", "name", "create-title");
    name.querySelector(".field-hint")?.remove();
    name.querySelector("input").removeAttribute("aria-describedby");
    name.querySelector("input").value = source ? text(app.language, "duplicateTitle", { title: source.title }) : editorDraft(app).title;
    pair.append(name);
    const project = libraryProjectField(app, pair, kind, source?.project ?? "");
    form.append(pair);
    libraryFolderField(app, form, kind, project, source?.folderId);
    let method = source ? "duplicate" : "empty";
    let chosen = source?.id ?? "";
    const sources = element(document, "select", { name: "source", "aria-label": text(app.language, "sourceBoard"), "data-library-source": "true" });
    const paint = () => {
      sources.replaceChildren(element(document, "option", { value: "", text: text(app.language, "chooseBoard") }));
      for (const item of state.sources ?? editorsOf(app).catalog) if ((method === "import") === item.readOnly && (method !== "import" || item.project === project.value)) sources.append(element(document, "option", { value: item.id, text: `${item.project} / ${item.title}` }));
      sources.value = chosen;
      sources.hidden = method === "empty";
      confirm.disabled = false;
    };
    if (kind === "blueprint" || source) {
      const options = element(document, "div", { class: "library-create-options" });
      for (const [value, key, hint] of [["empty", "emptyBoard", "finalEmptyHint"], ["duplicate", kind === "blueprint" ? "duplicateBoard" : "duplicateText", "finalDuplicateHint"], ["import", "importBoard", "finalImportHint"]].filter(([value]) => kind === "blueprint" || value === "duplicate")) {
        const input = element(document, "input", { type: "radio", name: "creation", value }); input.checked = method === value;
        input.addEventListener("change", () => { method = value; chosen = ""; paint(); });
        options.append(element(document, "label", { class: "library-create-option" }, input, element(document, "span", {}, element(document, "strong", { text: text(app.language, key) }), element(document, "small", { text: text(app.language, hint) }))));
      }
      sources.addEventListener("change", () => { chosen = sources.value; });
      project.addEventListener("change", () => { chosen = ""; paint(); });
      form.append(options, sources); paint();
      collectPages(app.api, kind === "blueprint" ? "/blueprint/boards" : "/void/texts", { limit: 50 }).then((page) => { state.sources = page.items; if (document.querySelector('[data-form="library-create"]')) paint(); }).catch(() => {});
    }
    form.libraryCreation = () => ({ method, source: sources.value || chosen });
    form.problems = () => {
      const problems = [];
      const title = form.querySelector('[data-field="create-title"]').value.trim();
      if (!title || title.length > 240 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(title)) problems.push({ name: "title", message: text(app.language, "groupNameRequired") });
      if (!project.value) problems.push({ name: "project", message: text(app.language, "projectRequired") });
      if (method !== "empty" && !form.libraryCreation().source) problems.push({ name: "source", message: text(app.language, "chooseBoard") });
      return problems;
    };
    name.querySelector("input").setAttribute("name", "title");
  }, async (form) => {
    const title = form.querySelector('[name="title"]').value.trim();
    const project = fieldValue(form, "project"), folderId = fieldValue(form, "folderId") || null;
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || operationId();
    const path = kind === "blueprint" ? `docs/flows/boards/${id}.json` : `docs/${id}.json`;
    const choice = form.libraryCreation();
    try {
      let result;
      if (choice.method === "duplicate") {
        const selected = (state.sources ?? editorsOf(app).catalog).find((entry) => entry.id === choice.source);
        result = await duplicateEditor(app.api, selected, { project, folderId, title, path }, operation);
      } else if (choice.method === "import") {
        const selected = (state.sources ?? editorsOf(app).catalog).find((entry) => entry.id === choice.source);
        result = await importLegacyBoard(app.api, selected, { project, folderId, title }, operation, (manifest) => exportLegacyDocument(document, manifest));
      } else {
        result = await createResource(app.api, kind, { project, folderId, path, document: kind === "blueprint" ? starterBoard(id, title) : starterText(id, title) }, operation);
      }
      releaseFormDraft(app, "resources", "title", editorDraft(app).title);
      editorDraft(app).title = "";
      await openCreated(app, result.data, kind);
      return true;
    } catch (error) { operation = error.operation ?? operation; throw error; }
  }, "open-create");
}

async function libraryRevision(app, kind, project) {
  const state = libraryState(editorsOf(app), kind);
  const folder = state.folders.find((entry) => entry.project === project);
  if (folder) return folder.revision;
  const page = await collectPages(app.api, kind === "blueprint" ? "/blueprint/boards" : "/void/texts", { query: { project }, limit: 50 });
  if (page.items.length) return (await request(app.api, "GET", kind === "blueprint" ? "/blueprint/boards/:resourceId" : "/void/texts/:resourceId", { params: { resourceId: page.items[0].id } })).data.libraryRevision;
  const otherKind = kind === "blueprint" ? "void" : "blueprint";
  const folders = await collectPages(app.api, "/library/folders", { query: { kind: otherKind, project }, limit: 50 });
  if (folders.items.length) return folders.items[0].revision;
  const other = await collectPages(app.api, otherKind === "blueprint" ? "/blueprint/boards" : "/void/texts", { query: { project }, limit: 50 });
  return other.items.length ? (await request(app.api, "GET", otherKind === "blueprint" ? "/blueprint/boards/:resourceId" : "/void/texts/:resourceId", { params: { resourceId: other.items[0].id } })).data.libraryRevision : null;
}

function newLibraryFolder(app, kind) {
  const current = editorsOf(app).current?.authoritative;
  let operation = null;
  openChoiceForm(app, "library-folder", text(app.language, "newFolder"), (form, confirm) => {
    const project = libraryProjectField(app, form, kind, current?.project ?? libraryState(editorsOf(app), kind).filters.project ?? "");
    libraryFolderField(app, form, kind, project, current?.folderId);
    confirm.textContent = text(app.language, "newFolder");
    form.problems = () => project.value ? [] : [{ name: "project", message: text(app.language, "projectRequired") }];
  }, async (form) => {
    try {
      const project = fieldValue(form, "project");
      const retained = operation ?? createOperation({ method: "POST", path: "/library/folders", body: { project, kind, title: text(app.language, "newFolder"), parentId: fieldValue(form, "folderId") || null, expectedRevision: await libraryRevision(app, kind, project) } });
      operation = retained;
      const result = await request(app.api, "POST", retained.path, { operation: retained });
      await loadCatalog(app.api, editorsOf(app), kind);
      const state = libraryState(editorsOf(app), kind);
      if (!state.folders.some((folder) => folder.id === result.data.folder.id)) state.folders.push(result.data.folder);
      beginLibraryRename(app, kind, result.data.folder, "folder");
      return true;
    } catch (error) { operation = error.operation ?? operation; throw error; }
  }, "new-folder");
  app.root.ownerDocument.querySelector('[data-form="library-folder"]')?.addEventListener("close", () => {
    const editing = libraryState(editorsOf(app), kind).rename;
    if (editing) app.root.querySelector(`[data-library-rename="${editing.id}"]`)?.focus?.();
  });
}

function deleteLibraryEntry(app, kind, entry, type) {
  editorAct(app, `library-delete-form:${entry.id}`, text(app.language, "working"), async () => {
    const record = type === "item" ? (await request(app.api, "GET", kind === "blueprint" ? "/blueprint/boards/:resourceId" : "/void/texts/:resourceId", { params: { resourceId: entry.id } })).data : entry;
    const previous = editorsOf(app).current;
    let operation = null;
    const dialog = showDialog(app.root.ownerDocument, {
      title: text(app.language, "finalDeleteTitle", { title: record.title }),
      body: `${type === "folder" ? cardinal(app.language, kind === "blueprint" ? "deleteBoardFolderScope" : "deleteTextFolderScope", record.count) : text(app.language, kind === "blueprint" ? "finalDeleteBoardScope" : "deleteTextScope", { count: record.count })} ${text(app.language, "undoTenSeconds")}`,
      confirm: text(app.language, type === "folder" ? "deleteFolder" : kind === "blueprint" ? "deleteBoard" : "deleteText"), cancel: text(app.language, "cancel"), retry: text(app.language, "retry"),
      onConfirm: async () => {
        try {
          let result;
          if (type === "folder") {
            operation ??= createOperation({ method: "DELETE", path: "/library/folders/:folderId", params: { folderId: record.id }, body: { project: record.project, confirmed: true, expectedRevision: record.revision } });
            result = await request(app.api, "DELETE", operation.path, { operation });
          } else result = await deleteEditor(app.api, record, record.libraryRevision, operation);
          const removed = result.data.removedResourceIds ?? [record.id];
          const editors = editorsOf(app);
          for (const id of removed) { app.store.open.editors.delete(id); app.store.open.comments.delete(id); }
          if (removed.includes(editors.current?.resourceId)) { editors.current = null; app.store.selected.resourceId = null; }
          await loadCatalog(app.api, editors, kind);
          showLibraryUndo(app, kind, result, text(app.language, "libraryDeleted", { title: record.title }), async (retained) => {
            await undoChange(app.api, result.data.changeId, retained);
            await loadCatalog(app.api, editors, kind);
            if (previous && removed.includes(previous.resourceId)) {
              editors.current = previous; app.store.selected.resourceId = previous.resourceId;
              app.store.open.editors.set(previous.resourceId, previous.kind); app.store.open.comments.add(previous.resourceId);
            }
          });
          renderShell(app);
        } catch (error) { operation = error.operation ?? operation; throw Object.assign(new Error(actionText(app.language, error.code)), { code: error.code }); }
      },
    });
    dialog.className += " library-dialog";
    dialog.querySelector("button.primary").className += " library-danger";
    dialog.setAttribute("data-library-delete", type);
    dialog.addEventListener("close", () => focusLibraryEntry(app, { ...entry, type }));
  });
}

function openLibraryMove(app, kind, entry) {
  editorAct(app, `library-move-form:${entry.id}`, text(app.language, "working"), async () => {
    const record = (await request(app.api, "GET", kind === "blueprint" ? "/blueprint/boards/:resourceId" : "/void/texts/:resourceId", { params: { resourceId: entry.id } })).data;
    let operation = null;
    const commit = async (destination) => {
      try {
        const result = await moveEditor(app.api, record, destination, record.libraryRevision, operation);
        applyLibraryRecord(app, result.data.editor, record.id);
        await loadCatalog(app.api, editorsOf(app), kind);
        showLibraryUndo(app, kind, result, text(app.language, "libraryMoved", { title: record.title }), async (retained) => {
          await undoChange(app.api, result.data.changeId, retained);
          const restored = (await request(app.api, "GET", kind === "blueprint" ? "/blueprint/boards/:resourceId" : "/void/texts/:resourceId", { params: { resourceId: record.id } })).data;
          applyLibraryRecord(app, restored, result.data.editor.id);
          await loadCatalog(app.api, editorsOf(app), kind);
        });
        renderShell(app);
      } catch (error) { operation = error.operation ?? operation; throw Object.assign(new Error(actionText(app.language, error.code)), { code: error.code }); }
    };
    openChoiceForm(app, "library-move", text(app.language, "moveToFolder"), (form, confirm) => {
      const project = libraryProjectField(app, form, kind, record.project);
      libraryFolderField(app, form, kind, project, record.folderId);
      confirm.textContent = text(app.language, "moveToFolder");
      form.problems = () => project.value ? [] : [{ name: "project", message: text(app.language, "projectRequired") }];
    }, async (form) => {
      const project = fieldValue(form, "project"), folderId = fieldValue(form, "folderId") || null;
      const destination = { project, folderId, path: record.path, confirmedRepositoryChange: project !== record.project };
      if (project === record.project) { await commit(destination); return true; }
      const folder = libraryState(editorsOf(app), kind).folders.find((entry) => entry.id === folderId)?.title ?? project;
      form.closest("dialog").close();
      const dialog = showDialog(app.root.ownerDocument, {
        title: text(app.language, "finalMoveTitle", { title: record.title, folder }),
        body: text(app.language, kind === "blueprint" ? "finalMoveScope" : "moveTextScope", { folder, source: record.project, destination: project }),
        confirm: text(app.language, "finalMoveAction", { folder }), cancel: text(app.language, "cancel"), retry: text(app.language, "retry"),
        onConfirm: () => commit(destination),
      });
      dialog.className += " library-dialog"; dialog.setAttribute("data-library-repository-confirm", "true");
      dialog.addEventListener("close", () => focusLibraryEntry(app, { id: editorsOf(app).current?.resourceId ?? record.id }));
      return false;
    });
  });
}

function showLibraryUndo(app, kind, result, label, undo) {
  clearTimeout(app.libraryToastTimer);
  const until = app.api.now() + Math.min(10000, Math.max(0, Date.parse(result.data.undoUntil) - Date.parse(result.meta.readAt)));
  const toast = { kind, label, until, undo, operation: null, busy: false, error: null };
  app.libraryToast = toast;
  const tick = () => {
    if (app.disposed || app.libraryToast !== toast) return;
    if (app.api.now() >= until) app.libraryToast = null;
    else app.libraryToastTimer = setTimeout(tick, Math.min(1000, until - app.api.now()));
    renderShell(app);
  };
  app.libraryToastTimer = setTimeout(tick, Math.min(1000, Math.max(0, until - app.api.now())));
}

function renderLibraryToast(app, t) {
  const toast = app.libraryToast, document = app.root.ownerDocument;
  const node = element(document, "div", { class: "library-toast", role: "status", "data-library-toast": "true" }, element(document, "span", { text: toast.label }));
  if (app.api.now() < toast.until) node.append(element(document, "span", { "data-library-countdown": "true", text: t("undoRemaining", { seconds: Math.ceil((toast.until - app.api.now()) / 1000) }) }), element(document, "button", {
    type: "button", class: "btn", "data-action": "library-undo", text: t("undo"), disabled: toast.busy ? "" : null,
    onclick: async () => {
      if (toast.busy || app.api.now() >= toast.until) return;
      toast.busy = true; renderShell(app);
      try { await toast.undo(toast.operation); if (app.libraryToast === toast) app.libraryToast = null; }
      catch (error) { toast.operation = error.operation ?? toast.operation; toast.error = error.code === "undo_conflict" ? text(app.language, "libraryUndoConflict") : actionText(app.language, error.code); toast.busy = false; }
      if (!app.disposed) renderShell(app);
    },
  }));
  if (toast.error) node.append(element(document, "p", { role: "alert", text: toast.error }));
  return node;
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

function chatWrapper(key) {
  return key.startsWith('open-chat:') || key.startsWith('direct:') || key === 'group-chat' || key.startsWith('group-chat:');
}

function activityNotices(records) {
  const loadingChat = records.some(record => record.phase === 'pending' && record.key.startsWith('chat-load:'));
  if (!loadingChat) return records;
  return records.filter(record => record.phase !== 'pending' || !chatWrapper(record.key));
}

// Loads and answers that already have their own progress are not slow requests.
function quietActivity(key, records = []) {
  const name = String(key ?? '');
  if (name.startsWith('chat-load:') && records.some(record => record.phase === 'pending' && /^(?:open-chat:|direct:)/.test(record.key))) return false;
  return /^(?:chat-load:|inspector:|group-chat(?::|$)|catalog:|direct:|open-chat:|waiting:|read:|approval:|task:|grant:|undo:|cancel-start:|changes:|editor:|library:)/.test(name);
}

function activityAnnouncement(app, record) {
  const seconds = Number(record.elapsed) || 0;
  const waiting = seconds >= 1 ? `. ${sendText(app, 'waiting', { seconds })}` : '';
  return `${record.label}. ${sendText(app, 'takingLonger')}${waiting}`;
}

// The polite region announces a slow request once. A tick that only advances the seconds must not replace it,
// or a screen reader speaks every second. The first reading can precede one second and has no count; the first
// reading that includes a count is the one that stays. The visible notice keeps updating on its own.
function stableActivityAnnouncement(app, record) {
  const next = activityAnnouncement(app, record);
  const frozen = record.announced;
  if (typeof frozen === 'string' && (/\d+ s/.test(frozen) || !/\d+ s/.test(next))) return frozen;
  record.announced = next;
  return next;
}

function composerField(shell) {
  for (const panel of shell.querySelectorAll?.('.chat-panel') ?? []) {
    const field = [...(panel.children ?? [])].find(child => String(child.className ?? '').split(/\s+/).includes('field'));
    if (field) return field;
  }
  return null;
}

function placeBefore(anchor, node) {
  const parent = anchor?.parentNode ?? anchor?.parent;
  if (!parent?.children) return false;
  const kids = [...parent.children];
  const index = kids.indexOf(anchor);
  for (const kid of kids) kid.remove();
  parent.append(...(index < 0 ? [...kids, node] : [...kids.slice(0, index), node, ...kids.slice(index)]));
  return true;
}

function paintActivity(app, shell) {
  const here = noteScope(app);
  const scoped = [...(app.activity?.values() ?? [])].filter((record) => (record.scope ?? here) === here);
  const records = activityNotices(scoped);
  const pending = records.filter((record) => record.phase === "pending" && !quietActivity(record.key, scoped));
  const failed = records.filter((record) => record.phase === "error");
  if (!pending.length && !failed.length) return;
  const document = app.root.ownerDocument;
  const region = element(document, "div", { class: "activity", "data-activity-region": "true" });
  if (pending.length) shell.setAttribute("aria-busy", "true");
  for (const record of pending) {
    const copy = element(document, "div", {}, element(document, "strong", { text: sendText(app, "takingLonger") }));
    if ((Number(record.elapsed) || 0) >= 1) copy.append(element(document, "p", { text: sendText(app, "waiting", { seconds: record.elapsed }) }));
    const notice = element(document, "div", { class: "slow-notice", "data-activity": record.key });
    notice.append(element(document, "span", { class: "spinner", "aria-hidden": "true" }), copy, element(document, "button", {
      type: "button", class: "btn ghost", "data-action": "cancel-activity", "data-activity": record.key, text: text(app.language, "cancel"), onclick: () => record.cancel?.(),
    }));
    region.append(notice);
  }
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
  const field = here === "unit" ? composerField(shell) : null;
  if (field && placeBefore(field, region)) return;
  const inspector = here === "unit" ? shell.querySelector?.(".inspector") : null;
  if (inspector) { inspector.append(region); return; }
  region.className += " notice-area";
  region.setAttribute("data-overlay", "true");
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
      home.phoneDialogFocused = false;
      if (app.store.settings) app.store.settings.home = home.home;
      return { ...result, data: home.home };
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
  // Sync shows only when it is doing something or needs attention; a saved, idle M1ND says nothing extra.
  // A pending sync that already shows its count of waiting changes needs no second line.
  const quietSync = ['local', 'idle', 'published', undefined, null].includes(syncState) || syncKey === 'syncLocal'
    || (syncState === 'pending' && Number.isInteger(app.settingsSync?.pendingChanges));
  const serviceText = app.serviceStopped ? recoveryText(app, 'stopped', { machine }) : ['connecting', 'reconnecting'].includes(app.store.stream?.state) ? t('reconnecting') : t("serviceRunning", { machine });
  const serviceState = app.serviceStopped ? 'out' : ['connecting', 'reconnecting'].includes(app.store.stream?.state) ? 'waiting' : 'working';
  const machines = element(document, "span", { class: "foot-machines" });
  for (const item of app.store.view?.machines ?? []) {
    const seen = item.heartbeatAt ? formatClock(app.language, item.heartbeatAt) : '';
    machines.append(element(document, "span", { class: "foot-machine", "data-machine": item.id, "data-answers": String(item.answers !== false) },
      icon(document, item.id === machine ? "map" : "phone"),
      element(document, "span", { text: item.answers === false ? t("machineNotAnswering", { machine: item.id }) : t("machineSeen", { machine: item.id, time: seen }).trim() })));
  }
  const footer = element(document, "footer", { class: "foot" },
    element(document, "span", { class: "foot-service", "data-service-machine": machine },
      element(document, "span", { class: "status-dot", "data-status": serviceState, "aria-hidden": "true" }),
      element(document, "span", { text: serviceText })),
    quietSync ? null : element(document, "span", { "data-sync": syncState ?? "", "data-pending": String(app.settingsSync?.pendingChanges ?? ""), text: t(syncKey) }),
    element(document, "span", { text: t("lastRead", { time }) }),
    machines,
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
      onclick: () => app.recovery && !app.api.token ? recoverSession(app) : startServiceStream(app),
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

function endPhoneAccess(app) {
  if (app.phoneEnded) return;
  clearCredentials(app.api);
  closeStream(app.api.live);
  clearTimeout(app.phoneExpiryTimer);
  for (const list of [app.unitList, app.chatList, app.waitingList]) {
    list?.controller?.abort();
    clearTimeout(list?.timer);
  }
  for (const controller of app.api.controllers) controller.abort();
  app.api.uncertain.clear();
  app.inspectorTicket = (app.inspectorTicket ?? 0) + 1;
  app.presentationTicket = (app.presentationTicket ?? 0) + 1;
  app.chatThreads?.clear();
  for (const value of Object.values(app.inputDrafts ?? {})) value?.clear?.();
  app.activity?.clear();
  app.store = { ...createStore(), audience: 'phone', signedOut: 410 };
  for (const key of ['unitList', 'chatList', 'waitingList', 'activeList', 'activeRows', 'activeHandlers', 'thread', 'inputDrafts', 'inspectorData', 'waitingRecord', 'pendingChat', 'actionNote', 'phoneCode']) app[key] = null;
  app.bootReading = false;
  app.bootFailed = false;
  app.phoneEnded = true;
}

function renderSignedOut(app) {
  const document = app.root.ownerDocument;
  const t = (key, variables) => text(app.language, key, variables);
  document.documentElement.lang = app.language;
  document.documentElement.dataset.look = app.look;
  document.documentElement.dataset.mode = 'phone';
  const locked = app.phoneLockDeadline > app.api.now();
  const state = app.phoneEnded ? 'ended' : locked ? 'locked' : app.phoneError === 'phoneCodeMismatch' ? 'error' : 'pair';
  const gate = element(document, "section", { class: "gate phone-gate", "data-phone-state": state });
  gate.append(element(document, 'header', { class: 'phone-status' }, element(document, 'span', { text: formatClock(app.language, app.api.now()) }), 'HIVEM1ND'));
  const content = element(document, 'div', { class: 'phone-gate-content', id: 'phone-gate-workspace', tabindex: '-1' });
  gate.append(element(document, 'a', { class: 'skip', href: '#phone-gate-workspace', text: t('skipToContent'), onclick: () => content.focus() }));
  if (state === 'locked' || state === 'ended') {
    const title = state === 'locked' ? 'phonePairingLocked' : 'phoneAccessEnded';
    const stateIcon = icon(document, 'alert');
    if (state === 'ended') stateIcon.querySelector('path').setAttribute('d', 'M3 9a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 15a5 5 0 0 1 6 0M12 18h.01');
    document.title = `${t(title)} · HIVEM1ND`;
    content.append(element(document, 'div', { class: 'phone-state-icon' }, stateIcon),
      element(document, 'h1', { text: t(title) }), element(document, 'p', { text: t(`${title}Body`), role: 'status' }));
    if (locked) {
      content.setAttribute('data-locked-until', app.phoneLockedUntil);
      clearTimeout(app.phoneLockTimer);
      app.phoneLockTimer = setTimeout(() => { app.phoneError = null; renderSignedOut(app); }, app.phoneLockDeadline - app.api.now());
      app.phoneLockTimer.unref?.();
    } else content.append(element(document, 'button', { type: 'button', class: 'btn primary', 'data-action': 'phone-new-code', text: t('phoneNewCode'), onclick: () => {
      app.phoneEnded = false; app.phoneError = null; app.phoneLockedUntil = null; renderSignedOut(app); app.root.querySelector('[data-home-code]')?.focus();
    } }));
  } else {
    document.title = `${t('phoneOpenMind')} · HIVEM1ND`;
    content.append(brand(document).querySelector('.mark'), element(document, 'h1', { text: t('phoneOpenMind') }),
      element(document, 'p', { id: 'phone-code-guidance', text: t('phoneCodePrompt') }));
    const feedback = element(document, 'div', { class: 'phone-code-feedback', id: 'phone-code-error', role: app.phoneError ? 'alert' : null, 'aria-atomic': 'true' });
    if (app.phoneError) {
      feedback.append(element(document, 'p', { class: 'phone-code-error', text: t(app.phoneError) }));
      if (Number.isInteger(app.phoneTriesLeft)) feedback.append(element(document, 'p', { 'data-tries-left': String(app.phoneTriesLeft), text: t('phoneTriesLeft', { count: app.phoneTriesLeft }) }));
    } else feedback.append(element(document, 'p', { class: 'field-hint', text: t('phoneScanQr') }));
    content.append(renderCodeEntry(document, t, code => submitCode(app, code), { busy: Boolean(app.phoneBusy), invalid: app.phoneError === 'phoneCodeMismatch', feedback }));
  }
  gate.append(content);
  app.root.replaceChildren(gate);
  releaseBootstrapAnnouncement(app);
}

function renderPhoneError(app, error) {
  app.api.homeKey = null;
  app.api.token = null;
  app.phoneTriesLeft = Number.isInteger(error.details?.triesLeft) ? error.details.triesLeft : null;
  app.phoneLockedUntil = error?.code === 'pairing_locked' ? error.details?.lockedUntil : null;
  app.phoneLockDeadline = app.phoneLockedUntil ? app.api.now() + (error.retryAfter ?? Math.max(0, Date.parse(app.phoneLockedUntil) - app.api.now())) : null;
  if (error?.code === "home_expired") { app.phoneError = null; endPhoneAccess(app); }
  else if (error?.code === "auth_rate_limited") app.phoneError = "rateLimited";
  // Only a refused code says the code is wrong; a network, timeout or service failure says the phone could not connect.
  else if (error?.code === "invalid_home_key" || error?.code === "pairing_locked") app.phoneError = "phoneCodeMismatch";
  else app.phoneError = "phoneConnectionFailed";
  renderSignedOut(app);
  app.root.querySelector("[data-home-code]")?.focus();
}

async function submitCode(app, code) {
  if (app.phoneBusy || app.phoneLockDeadline > app.api.now()) return;
  app.phoneBusy = true;
  renderSignedOut(app);
  try {
    const credential = await exchangeCode(app.api, code);
    app.phoneBusy = false;
    app.phoneError = null;
    app.phoneLockedUntil = null;
    clearTimeout(app.phoneLockTimer);
    await bootSession(app, credential);
  } catch (error) {
    app.phoneBusy = false;
    renderPhoneError(app, error);
  }
}

function renderFailure(app, error) {
  if (app.layout === 'desktop' && app.store.snapshotReady && app.recovery) {
    app.recoveryError = error;
    verifyServiceStatus(app);
    renderShell(app);
    return;
  }
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

const BOOTSTRAP_ANNOUNCEMENTS = new Set(["Loading.", "Cargando.", "Reading the M1ND.", "Leyendo la M1ND."]);

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
    "aria-atomic": "true",
    "data-live": "status",
  });
  app.liveError = placeLive(document, body, app.liveError, {
    id: "live-error",
    class: "live",
    role: "alert",
    "aria-live": "assertive",
    "aria-atomic": "true",
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
}

function syncLiveRegions(app) {
  releaseSettledAction(app);
  ensureLive(app);
  const visible = outcomeVisible(app);
  const pending = activityNotices([...(app.activity?.values() ?? [])].filter(record => record.phase === "pending" && (record.scope ?? noteScope(app)) === noteScope(app)));
  const status = pending.length ? pending.map(record => stableActivityAnnouncement(app, record)).join(" ")
    : visible && app.actionTone !== "error" ? app.actionNote : "";
  const error = visible && app.actionTone === "error" ? app.actionNote : "";
  if (app.liveStatus.textContent !== status) app.liveStatus.textContent = status;
  if (app.liveError.textContent !== error) app.liveError.textContent = error;
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
  canceled: "startCanceled",
  canceling: "startCanceling",
};

const ACTION_COPY = {
  resource_exists: "libraryDestinationExists",
  project_unavailable: "libraryProjectUnavailable",
  invalid_folder: "libraryInvalidFolder",
  folder_not_found: "libraryInvalidFolder",
  read_only_resource: "libraryReadOnly",
  undo_expired: "libraryUndoExpired",
  invalid_lead: "invalidLead",
  machine_unavailable: "machineDown",
  note_required: "noteRequired",
  revision_conflict: "revisionConflict",
  configuration_changed: "settingsConfigurationChanged",
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
  if (caps.includes('unit.create') && !overseerExists(app)) row.append(mapButton(app, 'create-overseer', startText(app.language, 'createOverseer'), () => createOverseer(app), { class: 'btn primary' }));
  if (selected && caps.includes('unit.create')) row.append(mapButton(app, 'change-runs-in', startText(app.language, 'runsIn'), () => openUnitRunsIn(app, selected)));
  // Claude Code and Cursor are not confined: say whether this agent asks first or works automatically. Confined clients show nothing.
  if (selected && caps.includes('unit.create') && ['claude', 'cursor'].includes(selected.runsIn?.client) && (!app.startPermissions || app.startPermissionsStale) && !(Date.now() - (app.permissionsFailedAt ?? 0) < 30000)) refreshPermissions(app);
  if (selected && app.startPermissions && ['claude', 'cursor'].includes(selected.runsIn?.client)) {
    const automatic = Boolean(automaticGrant(app.startPermissions, selected));
    row.append(element(document, 'p', { class: 'native-mode', 'data-native-mode': automatic ? 'automatic' : 'supervised', text: startText(app.language, automatic ? 'automaticNotConfined' : 'asksFirst') }));
  }
  if (selected && caps.includes("session.start")) {
    const machine = (app.inspectorData?.unitId === selected.id ? app.inspectorData.machines?.find((item) => item.id === selected.machine) : null)
      ?? app.store.view?.machines?.find(item => item.id === selected.machine);
    const offline = machine?.answers === false;
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "start-session", text: t("startSession"), disabled: offline ? "" : null, "aria-describedby": offline ? "reason-session-machine" : null, onclick: () => openSessionForm(app, selected) }));
    if (offline) row.append(element(document, "p", { class: "field-hint", id: "reason-session-machine", "data-disabled-reason": "machine", text: t("finalNeedsOnline", { machine: selected.machine }) }));
  }
  if (selected && caps.includes("unit.create") && app.layout !== "phone") row.append(unitMenu(app, selected));
  const sessionId = selected?.sessionIds?.[0];
  if (sessionId && caps.includes("session.stop")) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "stop-session", "data-session": sessionId, text: t("stopSession"), onclick: () => confirmStop(app, sessionId, selected) }));
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
  return pathIcon(document, `M3 7V4h7l2 3h9v13H3z${plus ? "M12 11v6M9 14h6" : ""}`);
}

export function mapButton(app, action, label, onClick, attributes = {}) {
  return element(app.root.ownerDocument, "button", { type: "button", class: "btn secondary", "data-action": action, text: label, onclick: onClick, ...attributes });
}

function decorateHierarchy(app, host) {
  const document = host.ownerDocument;
  const t = (key, variables) => text(app.language, key, variables);
  const decorate = () => {
    for (const node of host.querySelectorAll("[data-row]")) {
      const row = app.activeRows?.find((item) => String(item.id) === node.getAttribute("data-id"));
      if (!row) continue;
      if (row.unit) {
        node.setAttribute("aria-label", row.text);
        const title = element(document, "span", { class: "group-title" });
        title.style.gridColumn = "3";
        title.style.paddingLeft = `${row.depth * 16}px`;
        title.append(unitNameNode(document, row.unit));
        if (row.unit.role === "overseer") title.append(element(document, "span", { class: "hierarchy-sub", text: startText(app.language, "above") }));
        // A role the icon does not tell apart is named under the unit.
        const roleText = unitRoleName(row.unit, app.language);
        if (roleText) title.append(element(document, "span", { class: "hierarchy-sub hierarchy-role", "data-unit-role": row.unit.role, text: roleText }));
        const glyph = icon(document, hierarchyIcon(row.unit));
        glyph.style.gridColumn = "2";
        const status = element(document, "i", { class: "map-status row-status", "data-status": row.unit.status, role: "img", "aria-label": t(statusKey(row.unit.status)) });
        const tail = element(document, "span", { class: "hierarchy-tail" });
        tail.style.gridColumn = "4";
        if (row.unit.unread > 0) tail.append(element(document, 'span', { class: 'hierarchy-unread', 'aria-label': startText(app.language, 'unread', { count: row.unit.unread }), text: row.unit.unread }));
        tail.append(status);
        node.replaceChildren(glyph, title, tail);
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
      } else if (row.kind === "cluster") {
        node.setAttribute("data-cluster-row", row.groupId);
        node.setAttribute("aria-expanded", String(row.expanded));
        const disclosure = hierarchyDisclosure(document, row.expanded);
        disclosure.style.gridColumn = "1";
        const mark = icon(document, clusterGlyph(row.group?.link?.kind));
        mark.style.gridColumn = "2";
        const title = element(document, "span", { class: "group-title", text: row.label });
        title.style.gridColumn = "3";
        title.style.paddingLeft = `${row.depth * 16}px`;
        const gitBranch = app.clusterGit?.get(row.groupId)?.git?.branch ?? "";
        const branchText = gitBranch || (row.group?.link?.kind === "none" && !row.count ? startText(app.language, "noLink") : "");
        const branch = element(document, "code", { class: "hierarchy-branch", text: branchText });
        branch.style.gridColumn = "4";
        const count = element(document, "span", { class: "group-count", text: row.count ? String(row.count) : "" });
        count.style.gridColumn = "5";
        node.replaceChildren(disclosure, mark, title, branch, count);
      } else if (row.kind === 'worktree') {
        node.setAttribute('data-cluster-worktree', row.worktree.id);
        const title = element(document, 'code', { class: 'hierarchy-worktree', text: row.label || pathFolder(row.worktree.path) });
        title.style.gridColumn = '3';
        title.style.paddingLeft = `${row.depth * 16}px`;
        const branch = element(document, 'code', { class: 'hierarchy-branch', text: row.worktree.branch ?? '' });
        branch.style.gridColumn = '4';
        // A worktree reads as a checkout of its repository: the branch glyph, its folder, its branch.
        const mark = icon(document, 'graph');
        mark.style.gridColumn = '2';
        node.replaceChildren(mark, title, branch);
      } else if (row.id === "section:clusters") {
        const heading = element(document, "div", { class: "my-groups-heading", "data-my-groups": "true" }, element(document, "span", { text: startText(app.language, "clusters") }));
        if (app.layout !== "phone" && app.store.capabilities.includes("chat.manage")) {
          const add = mapButton(app, 'new-cluster', startText(app.language, 'newCluster'), () => openStartCluster(app), { class: 'icon-button', 'aria-label': startText(app.language, 'newCluster'), title: startText(app.language, 'newCluster') });
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
    if (row?.kind === "cluster" && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
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
    title: ["Remove {unit}?", "¿Quitar {unit}?"],
    body: ["It leaves the Map and Hierarchy. Its chat and mailbox move to Archived and its tasks stay in the project. A session running now is stopped first.", "El agente deja de aparecer en el Mapa y la Jerarquía. El chat y el buzón pasan a Archivados; las tareas permanecen en el proyecto. Una sesión en ejecución se detiene primero."],
    confirm: ["Remove agent", "Quitar agente"],
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
  if (app.store.capabilities.includes("chat.manage")) actions.append(mapButton(app, "message-all", t("messageAll", { count: units.length }), () => app.mapState.onGroupMessage(units.map((unit) => unit.id))));
  if (app.store.capabilities.includes("unit.connect")) actions.append(mapButton(app, "connect-lead", t("connectToLead"), () => chooseSelectionLead(app)));
  actions.append(mapButton(app, "clear-selection", t("clearSelection"), () => { app.mapState.selection.clear(); app.store.selected.unitId = null; app.thread = null; renderShell(app); }));
  panel.append(actions, element(document, "p", { class: "field-hint", text: t("finalGroupHint") }));
  return panel;
}

function chooseSelectionLead(app, picked = null) {
  const ids = (picked ?? [...app.mapState.selection]).filter((id) => unitById(app, id)?.role !== "master");
  let leadId;
  openChoiceForm(app, "selection-lead", text(app.language, "connectToLead"), (form) => {
    appendSelect(form.ownerDocument, form, "leadId", text(app.language, "finalReportsTo"), leadChoices(app).filter((unit) => !ids.includes(unit.id)).map((unit) => ({ value: unit.id, label: unitDisplayName(unit) })), "");
  }, async (form) => { leadId = fieldValue(form, "leadId"); if (!leadId) return false; return true; }, "connect-lead");
  const dialog = app.root.ownerDocument.querySelector("[data-form='selection-lead']");
  dialog?.addEventListener("close", () => { if (leadId) confirmConnection(app, leadId, ids); });
}

function emptySelection(app, t) {
  const empty = !app.store.indexes.groups.size && !(app.unitList?.catalog ?? []).some(unit => unit.role !== 'master');
  const section = element(app.root.ownerDocument, 'section', { class: 'empty-selection' }, icon(app.root.ownerDocument, 'map'));
  if (empty) section.append(element(app.root.ownerDocument, 'h2', { text: startText(app.language, 'nothingHere') }));
  section.append(element(app.root.ownerDocument, 'p', { text: startText(app.language, empty ? 'emptyHint' : 'selectHint') }));
  return section;
}

function openCluster(app, id) {
  const seen = new Set();
  let current = app.store.indexes.groups.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    app.hierarchy.collapsed.delete(`cluster:${current.id}`);
    current = app.store.indexes.groups.get(current.parentId);
  }
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
  if (app.layout !== 'phone') loadClusterFacts(app, group);
  if (app.layout !== 'phone') loadChatPlans(plansForApp(app), group.id).then(() => { if (!app.disposed) renderShell(app); }).catch(() => {});
  const chat = app.store.indexes.chats.get(group.chatId) ?? app.chatList?.catalog?.find((item) => item.id === group.chatId);
  if (chat && app.thread?.chat?.id !== chat.id) showChat(app, chat);
  else if (!chat) settle(app, `group-chat:${id}`, text(app.language, "loadingConversation"), async () => {
    const result = await request(app.api, "GET", "/chats/:chatId", { params: { chatId: group.chatId } });
    await showChat(app, result.data);
  });
  renderShell(app);
}

async function refreshGroups(app) {
  const result = await collectPages(app.api, "/groups");
  app.store.indexes.groups = new Map(result.items.map((group) => [group.id, group]));
  if (app.store.view) app.store.view.groups = result.items;
  if (app.chatList) await reloadList(app.chatList);
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
  // A notice floats over the bottom of the window, as the board draws it, with its Undo beside the text.
  const node = element(app.root.ownerDocument, "div", { class: "map-toast", role: "status", "data-map-toast": "true", text: toast.label },
    icon(app.root.ownerDocument, "check"));
  if (toast.undo && app.api.now() < toast.until) node.append(element(app.root.ownerDocument, "button", { type: "button", class: "btn ghost", "data-action": "map-undo", text: t("undo"), onclick: () => settle(app, toast.key, t("working"), async (record) => {
    await toast.undo(record);
    if (app.mapToast === toast) app.mapToast = null;
    renderShell(app);
  }) }));
  return node;
}

function confirmConnection(app, sourceId, targetIds, retained = null, priorError = null) {
  const source = unitById(app, sourceId);
  const targets = targetIds.map((id) => unitById(app, id)).filter(Boolean);
  if (!source || !targets.length) return;
  const state = retained ?? {
    operations: new Map(),
    done: new Set(),
    previous: targets.map((target) => ({ id: target.id, leadId: target.leadId ?? null })),
  };
  const body = targets.map((target) => text(app.language, "finalConnectScope", { unit: unitDisplayName(target), lead: unitDisplayName(source) })).join(" ");
  const dialog = showDialog(app.root.ownerDocument, {
    title: text(app.language, "finalConnectTitle", { unit: targets.map(unitDisplayName).join(", ") }),
    body,
    confirm: text(app.language, priorError ? "retry" : "connect"),
    cancel: text(app.language, "cancel"),
    retry: text(app.language, "retry"),
    error: priorError,
    onConfirm: () => {
      const saveConnection = async () => {
        const pending = targets.filter((target) => !state.done.has(target.id));
        app.connectionSaving = { leadId: source.id, targets: targets.map((target) => target.id) };
        app.store.selected.unitId = targets[0].id;
        app.store.selected.groupId = null;
        app.mapState.selection = new Set([targets[0].id]);
        app.mapState.pendingConnect = { source: source.id, target: targets[0].id };
        renderShell(app);
        const results = await connectUnits(app.api, source, pending, state.operations);
        const failed = [];
        for (const result of results) {
          if (result.operation) state.operations.set(result.id, result.operation);
          if (result.error) failed.push(result);
          else state.done.add(result.id);
        }
        if (failed.length) {
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
          for (const before of state.previous) {
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
      };
      saveConnection().catch(async (error) => {
        app.connectionSaving = null;
        app.mapState.pendingConnect = null;
        if (app.unitList) await reloadList(app.unitList).catch(() => {});
        if (!app.disposed) {
          app.store.selected.unitId = targets[0].id;
          app.store.selected.groupId = null;
          app.mapState.selection = new Set([targets[0].id]);
          renderShell(app);
          confirmConnection(app, sourceId, targetIds, state, { code: error?.code ?? "request_failed", message: error?.message ?? actionText(app.language, "request_failed") });
        }
      });
      return true;
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
  else if (app.store.selected.groupId) app.root.querySelector(`[data-cluster-row="${app.store.selected.groupId}"]`)?.focus?.();
  else if (app.store.selected.unitId) focusUnitRow(app, app.store.selected.unitId);
}

function createOverseer(app) { return openStartAgent(app, null, true); }

function openSessionForm(app, unit) {
  openChoiceForm(app, 'session', text(app.language, 'startSession'), (form, confirm) => {
    form.append(element(form.ownerDocument, 'p', { class: 'start-hint', text: startText(app.language, 'runsIn') + ': ' + runsInLabel(unit.runsIn, app.startAgents?.connectedClients, app.language) }));
    if (!unit.runsIn) { confirm.disabled = true; form.append(element(form.ownerDocument, 'p', { text: startText(app.language, 'unavailable') })); }
    const segment = element(form.ownerDocument, 'fieldset', { class: 'start-segment' }, element(form.ownerDocument, 'legend', { text: text(app.language, 'runsAs') }));
    for (const [value, key] of [['task', 'runTask'], ['chat', 'runChat']]) {
      const input = element(form.ownerDocument, 'input', { type: 'radio', name: 'runMode', value });
      input.value = value; input.checked = value === (unit.role === 'executor' ? 'task' : 'chat');
      segment.append(element(form.ownerDocument, 'label', { class: 'segment' }, input, text(app.language, key)));
    }
    form.append(segment);
    appendInput(form.ownerDocument, form, 'prompt', text(app.language, 'taskOrMessage'), '');
    form.problems = () => fieldValue(form, 'runMode') === 'task' && !fieldValue(form, 'prompt').trim() ? [{ name: 'prompt', message: text(app.language, 'taskRequired') }] : [];
  }, async form => {
    const prompt = fieldValue(form, 'prompt').trim() || null, mode = { runMode: fieldValue(form, 'runMode'), taskId: null };
    const body = { prompt, ...mode, expectedRevision: unit.revision };
    app.sessionOperations ??= new Map();
    const operation = app.sessionOperations.get(unit.id) ?? createOperation({ method: 'POST', path: '/units/:unitId/session', params: { unitId: unit.id }, body });
    app.sessionOperations.set(unit.id, operation);
    let started;
    try { started = await startSession(app.api, unit, null, prompt, operation, mode); }
    catch (error) { showOutcome(app, actionText(app.language, error.code), error.code); if (!app.disposed) renderShell(app); throw error; }
    app.sessionOperations.delete(unit.id);
    app.sessionRequestId = started.data.requestId; app.sessionRequest = { ...started.data, unitId: unit.id };
    showOutcome(app, text(app.language, SESSION_COPY[started.data.state] ?? 'actionFailed'), started.data.state ?? null);
    if (['queued', 'starting'].includes(started.data.state)) await recheckTracked(app);
    if (!app.disposed) renderShell(app);
    return true;
  }, 'start-session');
}

function confirmStop(app, sessionId, unit) {
  showDialog(app.root.ownerDocument, {
    title: text(app.language, "stopSessionTitle", { name: unit ? unitDisplayName(unit) : "" }),
    body: text(app.language, "stopSessionBody"),
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

function openChoiceForm(app, kind, title, build, onConfirm, opener = null) {
  const document = app.root.ownerDocument;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.setAttribute("data-form", kind);
  if (kind === 'session' && dialog.style) dialog.style.cssText = 'width:520px;padding:24px;border-radius:22px';
  const form = element(document, "form", { method: "dialog" });
  if (kind === 'session' && form.style) form.style.cssText = 'display:flex;flex-direction:column;gap:18px';
  const heading = element(document, "h2", { text: title });
  labelDialog(dialog, heading);
  form.append(heading);
  const confirm = element(document, "button", { type: "button", class: "btn primary", "data-action": "confirm-form", text: title });
  build(form, confirm);
  const actions = element(document, "div", { class: "dialog-actions" });
  const cancel = element(document, "button", { type: "button", class: "btn", "data-action": "cancel-form", text: text(app.language, "cancel") });
  let sending = false;
  const inputs = [...form.querySelectorAll("input, select, textarea")];
  const enabled = inputs.filter((control) => !control.disabled);
  const setFieldsBusy = (busy) => {
    if (!["selection-lead", "library-create", "library-folder", "library-move", "settings-find"].includes(kind)) return;
    for (const control of enabled) control.disabled = busy;
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
    confirm.replaceChildren(progressMark(document, label));
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
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault?.(); dialog.close(); return; }
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll("button, input, select, textarea, summary")].filter((node) => !node.disabled && !node.closest("[hidden]")
      && node.getAttribute("tabindex") !== "-1" && node.getAttribute("type") !== "hidden"
      && (!node.closest("details") || node.tagName === "SUMMARY" || node.closest("details").getAttribute("open") !== null || node.closest("details").open));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault?.(); last?.focus?.(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault?.(); first?.focus?.(); }
  });
  form.addEventListener("submit", (event) => { event.preventDefault?.(); confirm.click?.(); });
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  (enabled.find(control => !control.closest("[hidden], details")) ?? cancel)?.focus?.();
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
  app.sessionRequest = data;
  showOutcome(app, text(app.language, data.error?.code === 'launch_ambiguous' ? 'launchAmbiguous' : SESSION_COPY[state]), state);
  if (state === 'started' && data.unitId && !app.disposed) loadInspector(app, data.unitId);
}

function cancelSessionStart(app) {
  const requestId = app.sessionRequestId;
  settle(app, `cancel-start:${requestId}`, text(app.language, 'startCanceling'), async (record) => {
    record.operation ??= createOperation({ method: 'POST', path: '/session-requests/:requestId/cancel', params: { requestId }, body: {} });
    const result = await request(app.api, 'POST', record.operation.path, { operation: record.operation });
    noteSessionRequest(app, { ...app.sessionRequest, ...result.data });
    return result;
  });
}

function messageSender(app, message) {
  if (!message?.fromId) return text(app.language, "unknown");
  const unit = unitById(app, message.fromId);
  return unit ? unitDisplayName(unit) : readableIdentity(message.fromId, text(app.language, 'person'));
}

function commentAuthor(app, authorId) {
  const unit = unitById(app, authorId);
  // The person signs as "You" ("Persona"), whether the record carries the root id or the root's name.
  if (["root:master", "root:person", "master"].includes(authorId) || unit?.role === "master") return text(app.language, "person");
  return unit ? unitDisplayName(unit) : readableIdentity(authorId, text(app.language, "person"));
}

function frameAgentTabs(app, panel, subject) {
  const document = app.root.ownerDocument;
  const sessionView = sessionViewFor(app, sessionForUnit(app, subject.id));
  const agentTabs = sessionView ?? unitConversation(app, subject.id);
  panel.className += ' agent-conversation';
  panel.setAttribute('data-agent-tab', agentTabs.tab);
  panel.append(renderSessionTabs(document, agentTabs, app.language, tab => selectSessionTab(app, agentTabs, tab)));
  return { sessionView, agentTabs };
}

function chatPanel(app, t) {
  const document = app.root.ownerDocument;
  const thread = app.thread;
  const panel = element(document, "section", { class: "chat-panel" });
  if (!thread?.chat) {
    const subject = inspectorAgent(app);
    if (!subject) return panel;
    const { sessionView, agentTabs } = frameAgentTabs(app, panel, subject);
    if (agentTabs.unitOnly && agentTabs.tab === 'work') panel.append(unitWork(document, agentTabs, app.language, t));
    else if (sessionView?.tab === 'work') panel.append(renderSessionWork(document, sessionView, app.language, {
      onRetry: async () => { await loadSessionView(app.api, sessionView); if (!app.disposed) renderShell(app); },
      onMore: async () => { await loadSessionView(app.api, sessionView, { older: true }); if (!app.disposed) renderShell(app); },
      onStop: () => stopWorkStep(app, sessionView),
    }, app.api.now()));
    else {
      panel.append(element(document, 'div', {
        class: 'transcript', id: `session-${agentTabs.session.id}-panel`, role: 'tabpanel', 'aria-labelledby': `session-${agentTabs.session.id}-chat`,
      }));
      // An agent with no conversation yet still gets the composer; the first message opens the conversation.
      if ((app.store.capabilities ?? []).includes("chat.post")) panel.append(firstMessageComposer(app, t, subject));
    }
    return panel;
  }
  const members = thread.chat.members ?? [];
  const heading = element(document, "header", { class: "chat-heading" },
    element(document, "h2", { class: "chat-title", "data-chat-title": thread.chat.id, text: thread.chat.title || thread.chat.id }),
  );
  const group = app.store.indexes.groups.get(thread.chat.id);
  const directUnit = thread.chat.kind === "direct" ? unitById(app, members.find((id) => id !== "root:master")) : null;
  const subject = inspectorAgent(app) ?? (directUnit && app.layout !== 'phone' ? directUnit : null);
  const sessionView = subject ? sessionViewFor(app, sessionForUnit(app, subject.id)) : null;
  const agentTabs = subject ? (sessionView ?? unitConversation(app, subject.id)) : null;
  let contextNotice = null;
  if (directUnit) heading.querySelector("h2").replaceChildren(unitNameNode(document, directUnit));
  if (members.length > 2) {
    const names = members.map((id) => unitById(app, id) ? unitDisplayName(unitById(app, id)) : readableIdentity(id, text(app.language, 'person'))).join(", ");
    heading.append(element(document, "p", { class: "chat-members", "data-chat-members": String(members.length), text: names }));
  }
  panel.append(heading);
  if (agentTabs) {
    panel.className += ' agent-conversation';
    panel.setAttribute('data-agent-tab', agentTabs.tab);
    panel.append(renderSessionTabs(document, agentTabs, app.language, tab => selectSessionTab(app, agentTabs, tab)));
    if (sessionView && directUnit?.role === 'overseer') {
      const context = renderContext(document, sessionView, app.language,
        action => sessionView.context ? changeContext(app.api, sessionView, action, () => { if (!app.disposed) renderShell(app); }).catch(() => {})
          : loadSessionView(app.api, sessionView, { context: true }).then(() => { if (!app.disposed) renderShell(app); }));
      contextNotice = context.querySelector('.context-notice'); contextNotice?.remove(); panel.append(context);
    }
  }
  const transcript = element(document, "div", {
    class: "transcript",
    "data-chat": thread.chat.id,
    "data-members": String(thread.chat.members?.length ?? 0),
    "data-total": String(thread.total ?? thread.messages.length),
    "data-pinned": String(Boolean(thread.chat.pinned)),
    "data-listed": String(thread.chat.listed !== false),
    ...(agentTabs ? { id: `session-${agentTabs.session.id}-panel`, role: 'tabpanel', 'aria-labelledby': `session-${agentTabs.session.id}-chat` } : {}),
  });
  const windowed = messageWindow(authoredMessages(thread.messages), {
    nearBottom: thread.nearBottom !== false,
    anchorId: thread.nearBottom === false ? thread.anchorId : null,
    start: thread.windowStart ?? 0,
  });
  thread.windowStart = windowed.start;
  if (sessionView?.session.startedWith) {
    const descriptor = sessionView.session.startedWith;
    transcript.append(renderStartedWith(document, descriptor, app.language, { open: sessionView.startedOpen,
      onToggle: open => { sessionView.startedOpen = open; }, cluster: app.store.indexes.groups.get(subject.clusterId)?.title ?? subject.scope?.name ?? '',
      task: app.store.indexes.tasks.get(descriptor.taskId)?.title ?? '', roleName: unitById(app, descriptor.unitId)?.roleName ?? null }));
  }
  const cards = planCards(app, thread.chat); let plansMounted = false;
  if (cards.length) panel.className += ' has-plans';
  if (!windowed.items.length) {
    const canPost = (app.store.capabilities ?? []).includes("chat.post");
    transcript.append(element(document, "p", { "data-empty": "chat", text: t(canPost ? "emptyChat" : "emptyChatRead") }));
  }
  for (const message of windowed.items) {
    const own = message.fromId === "root:master" || unitById(app, message.fromId)?.role === "master";
    const article = element(document, "article", { class: own ? "bubble own" : "bubble", "data-from": message.fromId ?? "", "data-own": own ? "true" : "false" });
    const when = formatShortTime(app.language, message.timestamp || message.date || "");
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
    const parts = messageParts(message.attachments);
    if (parts.images.length) {
      thread.galleries ??= new Map();
      article.append(renderGallery(document, { images: parts.images, t, state: galleryState(thread.galleries, message.id, parts.images.length),
        imageFor: (id) => message.pending ? null : chatImage(app, thread.chat.id, id), onChange: () => renderShell(app) }));
    }
    if (parts.actions.length) article.append(renderActions(document, parts.actions, { t, titleOf: (action) => chatActionTitle(app, action), onOpen: (action) => openChatAction(app, action) }));
    if (own) {
      Object.assign(article.style, { background: "transparent", color: "var(--text)", padding: "0 0 0 28px", gap: "4px" });
      // A message of pictures or buttons alone has no text, so it draws no empty bubble.
      if (row.textContent || message.failed) Object.assign(row.style, { background: "var(--me)", color: "var(--me-text)", padding: "10px 14px", borderRadius: "18px", fontSize: "14.5px", ...(message.failed ? { border: "1px solid var(--error)" } : {}) });
      const meta = article.querySelector(".bubble-meta");
      Object.assign(meta.style, { fontFamily: "var(--mono)", fontSize: "12px", fontWeight: "700", color: "var(--mute)" });
      const { key: state, at } = sentLineState(message);
      const label = sendText(app, state, { time: at ? formatClock(app.language, at) : "" });
      const status = message.pending && !message.failed ? progressMark(document, label) : element(document, "span", { text: label });
      status.setAttribute("data-send-state", state);
      Object.assign(status.style, { fontSize: "12px", color: message.failed ? "var(--error)" : "var(--mute)" });
      if (!message.pending && !message.failed) status.prepend?.(element(document, "span", { "aria-hidden": "true", text: "✓", style: "font-size:12px;margin-right:6px" }));
      article.append(status);
    }
    if (message.failed) {
      article.append(element(document, "button", {
        type: "button",
        class: "btn",
        "data-action": "retry-message",
        "data-operation": message.operationId,
        title: sendText(app, "retryHint"),
        style: "font-size:12px;font-weight:700;color:var(--accent);min-height:32px",
        text: t("retry"),
        onclick: () => {
          const task = retryMessage(app.api, thread, message.operationId);
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
    if (own && !plansMounted) { transcript.append(...cards); plansMounted = true; }
  }
  if (!plansMounted) transcript.append(...cards);
  if (contextNotice) transcript.append(contextNotice);
  if (app.planDraft?.draft.chatId === thread.chat.id && app.layout !== 'phone') transcript.append(renderPlanDraft(app));
  if (group && app.layout !== 'phone') {
    const lead = clusterLead(group, app.unitList?.catalog ?? []);
    transcript.append(mapButton(app, 'start-plan', startText(app.language, lead ? 'startPlan' : 'choosePlanner'), () => openPlanDraft(app, group).catch(error => noteAction(app, error))));
    if (app.waitingRecord?.item?.planId && app.waitingRecord.item.chatId === thread.chat.id) transcript.append(renderWaitingRecord(app, t));
  }
  if (thread.unseen) transcript.append(element(document, "p", { "data-new-messages": "true", text: t("newMessages") }));
  transcript.addEventListener("scroll", () => {
    thread.scrollTop = transcript.scrollTop;
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
  // Older messages may still be on the service, or loaded and waiting above the window.
  if (thread.nextCursor || (thread.windowStart ?? 0) > 0) row.append(element(document, "button", { type: "button", class: "btn", "data-action": "older", text: t("loadOlder"), onclick: () => loadOlder(app) }));
  if (agentTabs?.unitOnly && agentTabs.tab === 'work') panel.append(unitWork(document, agentTabs, app.language, t));
  else if (sessionView?.tab === 'work') {
    const work = renderSessionWork(document, sessionView, app.language, {
      onRetry: async () => { await loadSessionView(app.api, sessionView); if (!app.disposed) renderShell(app); },
      onMore: async () => { await loadSessionView(app.api, sessionView, { older: true }); if (!app.disposed) renderShell(app); },
      onStop: () => stopWorkStep(app, sessionView),
    }, app.api.now());
    work.scrollTop = sessionView.scrollTop; work.addEventListener('scroll', () => { sessionView.scrollTop = work.scrollTop; });
    panel.append(work);
  } else panel.append(transcript, row);
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
    // The board's composer: the field names who it goes to, with Send inside it and the hint below.
    const send = element(document, "button", {
      type: "button",
      class: "composer-send",
      "data-action": "send",
      "aria-label": t("send"),
      title: t("send"),
      onclick: () => submitComposer(app, composer),
    }, icon(document, "send"));
    const name = group ? t("messageTheGroup") : directUnit ? t("messageUnit", { unit: directUnit.alias || directUnit.unit }) : t("composerLabel");
    const hint = group ? startText(app.language, 'goesToLead') : directUnit ? startText(app.language, 'readsNext') : t("composerHint");
    composer.setAttribute("aria-label", name);
    composer.setAttribute("placeholder", name);
    const hintId = `composer-hint-${thread.chat.id}`;
    composer.setAttribute("aria-describedby", hintId);
    const attach = element(document, "button", { type: "button", class: "composer-attach", "data-action": "attach", "aria-label": t("attachToMessage"), title: t("attachToMessage"),
      onclick: () => openAttachDialog(app, thread) }, icon(document, "plus"));
    panel.append(element(document, "label", { class: "field composer-field" },
      element(document, "span", { class: "field-label visually-hidden", text: name }),
      thread.parts?.length ? renderPendingParts(document, thread.parts, { t, titleOf: (action) => chatActionTitle(app, action), onRemove: (part) => removePart(app, thread, part) }) : null,
      element(document, "div", { class: "composer-row" }, attach, composer, send),
      element(document, "p", { class: "field-hint", id: hintId, text: hint })));
  }
  return panel;
}

// A picture of a chat is fetched once with the credential and kept as a blob URL; the view asks again on every draw.
function chatImage(app, chatId, assetId) {
  app.chatImages ??= new Map();
  const key = `${chatId}/${assetId}`;
  const known = app.chatImages.get(key);
  if (known) return known.state === "ready" ? { url: known.image.url } : known.state === "failed" ? { failed: true } : null;
  const record = { state: "loading", image: null };
  app.chatImages.set(key, record);
  fetchAsset(app.api, { url: `/api/v1/chats/${encodeURIComponent(chatId)}/assets/${encodeURIComponent(assetId)}` }).then((image) => {
    if (app.disposed) return image.revoke();
    record.state = "ready";
    record.image = image;
    // The oldest pictures are let go once many are held, and fetched again if they are shown again.
    for (const [old, entry] of app.chatImages) {
      if (app.chatImages.size <= CHAT_IMAGES_HELD) break;
      if (entry.state !== "ready" || old === key) continue;
      entry.image.revoke();
      app.chatImages.delete(old);
    }
  }).catch(() => { record.state = "failed"; }).finally(() => { if (!app.disposed) renderShell(app); });
  return null;
}

const CHAT_IMAGES_HELD = 120;

function chatActionTitle(app, action) {
  if (action.kind === "task") return app.store.indexes.tasks.get(action.target)?.title ?? "";
  return app.editors?.catalog?.find((item) => item.id === action.target)?.title ?? "";
}

function openChatAction(app, action) {
  if (action.kind === "task") {
    openWaitingItem(app, { id: `chat-task:${action.target}`, taskId: action.target, title: action.label || action.target });
    if (app.layout === "phone") navigate(app, "waiting");
    else {
      app.waitingOpen = true;
      app.mode = "map";
      renderShell(app);
    }
    return;
  }
  if (app.layout === "phone" || !(app.store.capabilities ?? []).includes("editor.read")) {
    explain(app, "chatOpensOnComputer");
    return;
  }
  const kind = action.kind === "text" ? "void" : "blueprint";
  app.mode = kind === "void" ? "document" : "blueprint";
  selectEditor(app, { id: action.target, kind, title: action.label || chatActionTitle(app, action) });
}

async function openAttachDialog(app, thread) {
  const document = app.root.ownerDocument;
  if (document.querySelector?.("[data-attach-dialog]")) return;
  const t = (key, values) => text(app.language, key, values);
  const choices = { task: [...app.store.indexes.tasks.values()].filter((task) => task.status === "open" || task.status === "review")
    .map((task) => ({ id: task.id, title: `${task.number ?? ""} ${task.title ?? ""}`.trim() })) };
  // Boards and texts are offered where they can be opened: on the computer.
  if (app.layout !== "phone" && (app.store.capabilities ?? []).includes("editor.read")) {
    const [boards, texts] = await Promise.allSettled([collectPages(app.api, "/blueprint/boards", { limit: 50 }), collectPages(app.api, "/void/texts", { limit: 50 })]);
    choices.board = boards.status === "fulfilled" ? boards.value.items.map((item) => ({ id: item.id, title: item.title || item.path || item.id })) : [];
    choices.text = texts.status === "fulfilled" ? texts.value.items.map((item) => ({ id: item.id, title: item.title || item.path || item.id })) : [];
  }
  if (app.disposed || document.querySelector?.("[data-attach-dialog]")) return;
  const dialog = renderAttachDialog(document, { t, choices,
    onImages: (files) => addImages(app, thread, files),
    onAdd: (part) => { (thread.parts ??= []).push(part); renderShell(app); } });
  document.body.append(dialog);
  dialog.showModal();
}

// A picture the service would refuse is named at once, and so is one it did refuse; any other failure reads as usual.
function noteImage(app, error, key) {
  if (!["asset_too_large", "invalid_asset"].includes(error?.code)) return noteAction(app, error, key);
  showOutcome(app, text(app.language, "attachImageRejected"), error.code, "error", null, key);
  if (!app.disposed) renderShell(app);
}

function addImages(app, thread, files) {
  const chatId = thread.chat.id;
  for (const file of files) {
    if (!IMAGE_TYPES.includes(file.type) || file.size > IMAGE_MAX_BYTES) {
      noteImage(app, { code: IMAGE_TYPES.includes(file.type) ? "asset_too_large" : "invalid_asset" }, `chat:${chatId}`);
      continue;
    }
    const preview = app.api.createObjectURL?.(file) ?? null;
    if (preview) app.api.blobs.add(preview);
    const part = { kind: "image", path: null, uploading: true, preview };
    (thread.parts ??= []).push(part);
    uploadChatImage(app.api, chatId, file).then((result) => {
      part.path = result.data.id;
      part.uploading = false;
      clearMatchedError(app, `chat:${chatId}`);
    }).catch((error) => {
      removePart(app, thread, part, false);
      noteImage(app, error, `chat:${chatId}`);
    }).finally(() => { if (!app.disposed) renderShell(app); });
  }
  renderShell(app);
}

function removePart(app, thread, part, render = true) {
  thread.parts = (thread.parts ?? []).filter((item) => item !== part);
  releasePart(app, part);
  if (render && !app.disposed) renderShell(app);
}

function releasePart(app, part) {
  if (!part.preview) return;
  app.api.blobs.delete(part.preview);
  app.api.revokeObjectURL?.(part.preview);
  part.preview = null;
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

function takePendingChat(app) {
  const pending = app.pendingChat;
  if (!pending || app.chatOpening) return;
  app.pendingChat = null;
  app.chatOpening = true;
  const wanted = pending.unitId;
  const stillSelected = () => app.store.selected.unitId === wanted;
  const finish = () => {
    app.chatOpening = false;
    if (!app.disposed && app.pendingChat) takePendingChat(app);
  };
  if (!pending.create) {
    openExistingDirect(app, pending.unitId, stillSelected).finally(finish);
    return;
  }
  app.phoneChatNote = false;
  settle(app, `open-chat:${pending.unitId}`, text(app.language, "loadingConversation"), async (record) => {
    const result = await openDirectChat(app.api, [pending.unitId], record.operation);
    if (!stillSelected()) return;
    await showChat(app, result.data);
  }).finally(finish);
}

function openExistingDirect(app, unitId, accept = () => true) {
  return settle(app, `direct:${unitId}`, text(app.language, "loadingConversation"), async () => {
    const chat = await findDirectChat(app.api, unitId);
    if (!accept()) return;
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
  const directId = chat.kind === 'direct' ? chat.members?.find(id => id !== 'root:master') : null;
  const group = app.store.indexes.groups.get(chat.id);
  app.store.selected.chatId = chat.id;
  app.store.selected.groupId = group && !group.deleted ? group.id : null;
  if (group) app.store.selected.unitId = null;
  else if (directId && (app.store.audience === 'phone' || app.layout !== 'phone')) {
    app.store.selected.unitId = directId;
    if (app.inspectorData?.unitId !== directId && !activityPending(app, `inspector:${directId}`)) loadInspector(app, directId);
  } else if (app.store.audience === 'phone') app.store.selected.unitId = null;
  if (app.mapState) {
    app.mapState.selectedGroupId = app.store.selected.groupId;
    if (group) app.mapState.selection.clear();
    else if (app.store.selected.unitId && app.layout !== 'phone') app.mapState.selection = new Set([app.store.selected.unitId]);
  }
  app.chatThreads ??= new Map();
  app.thread = app.chatThreads.get(chat.id) ?? createThread(chat);
  app.thread.chat = chat;
  app.chatThreads.set(chat.id, app.thread);
  const thread = app.thread;
  const saved = inputDrafts(app).chats.get(chat.id);
  if (saved) app.thread.composer = saved.value;
  return settle(app, `chat-load:${chat.id}`, text(app.language, "loadingConversation"), async () => {
    await loadMessages(app.api, thread);
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
  }
  const keepInView = () => {
    if (app.disposed || !measuredId) return;
    revealAbove(app.thread, measuredId);
    renderShell(app);
    const next = app.root.querySelector?.(".transcript");
    const node = next?.querySelector?.(`[data-message="${measuredId}"]`);
    if (next && node) next.scrollTop += (node.offsetTop ?? 0) - measuredOffset;
  };
  // Messages already loaded above the window need no request: the window moves up to them.
  if (!app.thread.nextCursor) { keepInView(); return; }
  track(app, `older:${app.thread.chat.id}`, text(app.language, "loadingConversation"), async () => {
    await loadMessages(app.api, app.thread, true);
  }).then(keepInView).catch((error) => noteAction(app, error));
}

// The window opens above the message the person was reading, which stays in it near the bottom, so the older ones show.
function revealAbove(thread, messageId) {
  const list = authoredMessages(thread.messages);
  const index = list.findIndex((message) => message.id === messageId);
  if (index < 0) return;
  const start = Math.max(0, index - (MESSAGE_WINDOW - 10));
  thread.windowStart = start;
  thread.anchorId = list[start]?.id ?? null;
  thread.nearBottom = false;
}

function firstMessageComposer(app, t, unit) {
  const document = app.root.ownerDocument;
  const name = t("messageUnit", { unit: unit.alias || unit.unit });
  const hint = startText(app.language, 'readsNext');
  const key = `first:${unit.id}`;
  // Not data-composer: that marks an open conversation, which this agent does not have yet.
  const composer = element(document, "input", { class: "composer", "data-first-message": unit.id, "data-keep": keepId("chat", key), "aria-label": name, placeholder: name });
  composer.value = inputDrafts(app).chats.get(key)?.value ?? "";
  composer.addEventListener("input", () => { inputDrafts(app).chats.set(key, fieldDraft(composer)); syncViewerDirty(app); });
  const send = element(document, "button", { type: "button", class: "composer-send", "data-action": "send-first", "aria-label": t("send"), title: t("send"),
    onclick: () => sendFirstMessage(app, unit, composer) }, icon(document, "send"));
  const hintId = `composer-hint-${key}`;
  composer.setAttribute("aria-describedby", hintId);
  return element(document, "label", { class: "field composer-field" },
    element(document, "span", { class: "field-label visually-hidden", text: name }),
    element(document, "div", { class: "composer-row" }, composer, send),
    element(document, "p", { class: "field-hint", id: hintId, text: hint }));
}

// The first message opens the direct conversation with the agent, then goes out as any other message.
function sendFirstMessage(app, unit, composer) {
  const body = composer.value;
  if (!body.trim()) return;
  // Its own key: selecting the agent may already be opening its conversation under open-chat.
  settle(app, `first-message:${unit.id}`, text(app.language, "loadingConversation"), async (record) => {
    const result = await openDirectChat(app.api, [unit.id], record.operation);
    // showChat opens the thread before it loads; the person may switch chats while it loads, so the message keeps this thread.
    const loading = showChat(app, result.data);
    const thread = app.thread;
    await loading;
    clearInputDraft(app, "chat", `first:${unit.id}`);
    await postMessage(app.api, thread, { body });
    syncViewerDirty(app);
  }).finally(() => { if (!app.disposed) renderShell(app); });
}

function submitComposer(app, composer) {
  const thread = app.thread;
  const chatId = thread?.chat?.id;
  const draft = composer.value;
  const parts = thread?.parts ?? [];
  // A picture still uploading has no id yet, so the message waits for it.
  if (!chatId || (!draft.trim() && !parts.length) || parts.some((part) => part.uploading || !part.path)) return;
  const attachments = parts.map(({ kind, path, label }) => ({ kind, path, ...(label ? { label } : {}) }));
  const task = postMessage(app.api, thread, attachments.length ? { body: draft, attachments } : { body: draft });
  for (const part of parts) releasePart(app, part);
  thread.parts = [];
  composer.value = "";
  clearInputDraft(app, "chat", chatId);
  inputDrafts(app).focus = { kind: "field", id: keepId("chat", chatId), start: 0, end: 0 };
  if (!app.disposed) renderShell(app);
  task.then(() => {
    syncViewerDirty(app);
    clearMatchedError(app, chatId ? `chat:${chatId}` : null);
    if (!app.disposed) renderShell(app);
  }).catch((error) => noteAction(app, error, chatId ? `chat:${chatId}` : null));
}

function noteAction(app, error, key = null) {
  showOutcome(app, actionText(app.language, error?.code), error?.code ?? null, "error", null, key);
  if (!app.disposed) renderShell(app);
}

function namedStartStep(error) {
  const step = typeof error?.step === 'string' ? error.step.trim() : '';
  if (!step || step.length > 40 || /[.!?]/.test(step) || step.split(/\s+/).length > 3) return '';
  return step;
}

function sessionFailureText(language, client, error) {
  const step = namedStartStep(error);
  if (step) return text(language, 'startStepFailed', { client, step });
  return `${text(language, 'startUnanswered', { client })} ${text(language, 'nothingStarted')}`;
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
    const namedClient = clientLabel(session?.client, app.language);
    const runs = !selected.sessionIds?.length ? t("finalNotStarted") : session?.launchKind === "manual-app" ? t("runsApp", { client: namedClient }) : session?.launchKind === "cli" ? t("runsCli", { client: namedClient }) : namedClient || t("unknown");
    const facts = element(document, "div", { class: "unit-facts", "data-unit-facts": "true" });
    const checkout = checkoutSession(app, selected);
    const where = checkoutFacts(t, app.language, { session: checkout, local: startMachine(app), entry: checkout && app.checkouts?.get(checkout.id) });
    for (const [key, value, title] of [["machine", selected.machine], ["finalRunsIn", runs], ...where, ["model", selected.model ?? t("finalDefaultModel")], ["finalReportsTo", selected.leadId ? unitDisplayName(unitById(app, selected.leadId)) : t("finalNoLead")]]) facts.append(element(document, "p", { text: `${t(key)}: ${value ?? t("unknown")}`, ...(title ? { title } : {}) }));
    card.append(facts, extra);
    if (app.connectionSaving?.targets.includes(selected.id)) card.append(progressMark(document, `${t("savingLayout")} ${t("finalReportsTo")}: ${unitDisplayName(unitById(app, app.connectionSaving.leadId))}`));
    const folded = card.querySelector?.("details");
    if (folded) trackDisclosure(app, folded, keepId("unit", selected.id));
    panel.append(card);
    const tracked = app.sessionRequest;
    if (tracked?.unitId === selected.id && ['queued', 'starting', 'canceling', 'failed', 'expired'].includes(tracked.state)) {
      const progress = element(document, 'section', { 'data-session-progress': tracked.requestId });
      const failed = tracked.state === 'failed' || tracked.state === 'expired';
      const clientId = tracked.client || selected.runsIn?.client || text(app.language, 'unknown');
      const client = clientLabel(clientId, app.language);
      const machine = tracked.machine || selected.machine || text(app.language, 'unknown');
      const steps = [
        ['request', text(app.language, 'startStepSent'), 'done'],
        ['client', text(app.language, 'startStepStarting', { client, machine }), tracked.state === 'starting' || tracked.state === 'canceling' ? 'working' : failed ? 'failed' : 'todo'],
        ['connected', text(app.language, 'startStepConnected'), 'todo'],
      ];
      for (const [step, label, state] of steps) {
        const row = element(document, 'p', { class: `session-start-step is-${state}`, 'data-start-step': step, text: label });
        if (state === 'working') row.append(element(document, 'span', { class: 'spinner', 'aria-hidden': 'true' }));
        progress.append(row);
      }
      if (failed) progress.append(element(document, 'p', { role: 'alert', text: sessionFailureText(app.language, client, tracked.error) }));
      else progress.append(progressMark(document, t(SESSION_COPY[tracked.state])));
      if (['queued', 'starting', 'canceling'].includes(tracked.state)) progress.append(element(document, 'button', { type: 'button', class: 'btn ghost', 'data-action': 'cancel-start', text: t('cancelStart'), onclick: () => cancelSessionStart(app) }));
      if (failed) progress.append(element(document, 'button', { type: 'button', class: 'btn', 'data-action': 'retry-session', text: t('retry'), onclick: () => recheckTracked(app) }));
      if (tracked.state === 'failed' && tracked.error?.code !== 'launch_ambiguous') progress.append(element(document, 'button', { type: 'button', class: 'btn', 'data-action': 'choose-client', text: t('chooseClient'), onclick: () => openSessionForm(app, selected) }));
      panel.append(progress);
    }
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
      cards.append(renderApproval(document, approval, t, (item, decision) => answerSelected(app, item, decision), activityPending(app, `approval:${approval.id}`), app.store.audience !== 'phone'));
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
    const phone = app.store.audience === "phone";
    const taskBusy = activityPending(app, `task:${task.id}`) || activityPending(app, `undo:${task.id}`);
    cards.append(renderTask(document, task, t, (item, status, note) => status === "open" ? confirmSendBack(app, item, note) : setTaskStatus(app, item, status, note), !phone && caps.includes("task.undo") ? (item) => undoSelected(app, item) : null, noteDraft?.value ?? "", (value, start, end) => {
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

const CHECKOUT_MS = 15000;

// The session whose folder and branch the inspector names: the live one, else the last one that ran on this machine.
function checkoutSession(app, unit) {
  const sessions = app.inspectorData?.unitId === unit.id ? app.inspectorData.sessions ?? [] : (app.store.view?.sessions ?? []).filter((item) => item.unitId === unit.id);
  const live = sessions.find((item) => item.state !== "stopped");
  if (live) return live;
  return sessions.filter((item) => item.machine === startMachine(app)).sort((left, right) => String(right.registeredAt ?? "").localeCompare(String(left.registeredAt ?? "")))[0] ?? null;
}

// Only the desktop reads where a session runs.
const checkoutReadable = (app) => !app.disposed && app.layout !== "phone" && app.store.audience !== "phone";

function loadCheckout(app, session, force = false) {
  if (!checkoutReadable(app) || !session || session.machine !== startMachine(app)) return Promise.resolve();
  const entry = (app.checkouts ??= new Map()).get(session.id) ?? {};
  app.checkouts.set(session.id, entry);
  if (entry.pending) return entry.pending;
  const stopped = session.state === "stopped";
  if (!force && (stopped ? entry.data?.live === false || entry.data?.known === false : entry.at != null && app.api.now() - entry.at < CHECKOUT_MS)) return Promise.resolve();
  entry.pending = startApi.getSessionCheckout(app.api, session.id).then((result) => { entry.data = result.data; entry.error = null; }, (error) => { entry.error = error; }).then(() => {
    entry.at = app.api.now();
    entry.pending = null;
    if (!app.disposed) renderShell(app);
  });
  return entry.pending;
}

// A live session is read again at most every 15 seconds while its agent stays selected, and at once when it changes.
function refreshCheckout(app, unitId = app.store.selected.unitId, force = false) {
  const unit = unitId ? unitById(app, unitId) : null;
  if (!checkoutReadable(app) || !unit) return Promise.resolve();
  clearTimeout(app.checkoutTimer);
  const session = checkoutSession(app, unit);
  const job = loadCheckout(app, session, force);
  if (session && session.state !== "stopped" && session.machine === startMachine(app)) {
    app.checkoutTimer = setTimeout(() => { if (app.store.selected.unitId === unitId) refreshCheckout(app, unitId); }, CHECKOUT_MS);
    app.checkoutTimer.unref?.();
  }
  return job;
}

// Only the latest waiting request applies, so an older answer arriving last cannot bring back a finished task.
function refreshInspectorWaiting(app) {
  const unitId = app.inspectorData?.unitId;
  const ticket = app.inspectorWaitingTicket = (app.inspectorWaitingTicket ?? 0) + 1;
  if (unitId) collectPages(app.api, "/waiting", { query: { unitId }, limit: 50 }).then((waiting) => {
    if (app.disposed || ticket !== app.inspectorWaitingTicket || app.inspectorData?.unitId !== unitId) return;
    Object.assign(app.inspectorData, { waiting: waiting.items, waitingTotal: waiting.total, waitingIssues: waiting.issues });
    renderShell(app);
  }).catch(() => {});
}

function loadInspector(app, unitId) {
  const ticket = (app.inspectorTicket ?? 0) + 1;
  app.inspectorTicket = ticket;
  // A full load supersedes the waiting refreshes already in flight; a task change during the load supersedes the load's tasks and waiting items.
  const waitingTicket = app.inspectorWaitingTicket = (app.inspectorWaitingTicket ?? 0) + 1;
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
    const changed = waitingTicket !== app.inspectorWaitingTicket;
    app.inspectorData = {
      unitId,
      tasks: changed ? tasks.items.map((task) => app.store.indexes.tasks.get(task.id) ?? task) : tasks.items,
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
    if (changed) refreshInspectorWaiting(app);
    app.store.indexes.units.set(unitId, unit.data);
    refreshCheckout(app, unitId);
    if (app.layout !== 'phone') {
      const view = sessionViewFor(app, sessions.items.find(session => session.state !== 'stopped') ?? sessions.items[0]);
      if (view && unit.data.role === 'overseer') await loadSessionView(app.api, view, { context: true });
    }
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

function confirmSendBack(app, task, note) {
  showDialog(app.root.ownerDocument, {
    title: text(app.language, "sendBackTaskTitle"),
    body: text(app.language, "sendBackTaskBody"),
    confirm: text(app.language, "sendBack"),
    cancel: text(app.language, "cancel"),
    retry: text(app.language, "retry"),
    onConfirm: async () => { setTaskStatus(app, task, "open", note); return true; },
  });
}

function setTaskStatus(app, task, status, note) {
  settle(app, `task:${task.id}`, text(app.language, "working"), async (record) => {
    const result = await changeTaskStatus(app.api, task, status, note, record.operation);
    record.operation = result.operation ?? record.operation;
    if (status === "open") clearInputDraft(app, "note", task.id);
    if (status === "done") {
      showMapToast(app, text(app.language, "taskAccepted"), async (undoRecord) => {
        const undone = await undoTask(app.api, result.data.task, undoRecord.operation);
        undoRecord.operation = undone.operation ?? undoRecord.operation;
        replaceTask(app, undone.data.task);
        await refreshWaiting(app);
      });
    } else showOutcome(app, taskText(app.language, result.data.task.status), result.data.task.status);
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
  if (app.settingsState) await loadSettingsSections(app);
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
  for (const thread of app.chatThreads?.values() ?? []) {
    for (const entry of thread.pendingSends.values()) {
      if (entry.error && app.api.uncertain.has(entry.operation.id)) jobs.push(retryMessage(app.api, thread, entry.operation.id));
    }
  }
  for (const record of app.activity?.values() ?? []) {
    if (record.phase === "error" && record.error?.code !== "wait_canceled" && record.operation && app.api.uncertain.has(record.operation.id)) jobs.push(record.retry?.());
  }
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
