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
import { ApiError, clearCredentials, createApi, createOperation, dispose as disposeApi, fetchAsset, forgetSession, operationId, request } from "./api.mjs";
import { clusterGlyph, element, icon, labelDialog, labeledField, pathIcon, progressMark, restoreRunning, runAction, showDialog, showError, skeletonMark } from "./components.mjs";
import { activateUnit, buildHierarchy, collapseNewClusters, displayName, flattenVisibleHierarchy, hierarchyDisclosure, hierarchyIcon, listedWorktrees, openContextMenu, pathFolder, readableIdentity, revealGroup, toggleGroup, unitDisplayName, unitRoleName, unitsForTree, upperFirst } from "./hierarchy.mjs";
import { checkoutFacts, openTaskDetail, renderApproval, renderGrants, renderMachine, renderSession, renderTask, renderUnit, renderWaiting, requestBrief, waitingSections } from "./inspector.mjs";
import { cardinal, formatClock, formatNumber, formatRecent, formatShortDate, formatShortTime, text } from "./i18n.mjs";
import { collectPages, createPagedList, loadAll, loadNext, reloadList, renderWindow, setQuery } from "./lists.mjs";
import { adoptInitialLayout, applyRemoteLayout, centerUnit, createMap, keepLocalPosition, renderMap, retrySavedLayout, settlePositions, useIncomingPosition } from "./map.mjs";
import { dispose as disposeEmbed, publishDirty, publishReady, startEmbedChannel } from "./embed.mjs";
import { disposeEmbeddedApps, embeddedName, embeddedOpenMode, forwardEmbeddedEvent, openBrowserApp, renderEmbeddedApp, startEmbeddedApps, syncEmbeddedApp } from "./embedded-apps.mjs";
import { PHONE_NAV, exchangeCode, exchangeHomeFragment, logout, renderCodeEntry, renderPhone } from "./phone.mjs";
import { applyAgent, applyIssueChange, applyServiceBeat, applySettingsRead, applySyncSnapshot, armExpiry, clearGrant, closeHome, LOOK_IDS, noteHomeChange, openHome, previewAgent, renderClientReview, renderReviewAll, renderSettings, saveSettings, takeGrant } from "./settings.mjs";
import { acceptStreamEvent, createStore, loadSnapshot } from "./state.mjs";
import { close as closeStream, resetCredentials, synchronize } from "./stream.mjs";
import * as startApi from './start-api.mjs';
import { roleLabel, startText } from './start-copy.mjs';
import { acceptedRepositoryCluster, catalogLabel, clientLabel, clusterLead, customRoleProblems, initialRunsIn, repositorySelection, renderAccountOffer, renderAgentForm, renderClusterForm, renderRepositoryOffer, renderRunsInPicker, runsInLabel, startDialog, supervisedClient } from './clusters.mjs';
import { renderAgentHeader, renderCluster, renderClusterChanges, renderClusterDetails } from './inspector.mjs';
import { fitMap, flyToCluster, isCollapsed, toggleCollapsed } from './map.mjs';
import { changeContext, createSessionView, loadSessionView, loadTranscriptPage, renderContext, renderSessionTabs, renderSessionWork, renderStartedWith } from './session-work.mjs';
import { PLAN_TASK_LIMIT, controlPlan, createPlanController, loadChatPlans, planBranch, refreshPlan, renderControlledPlan, runPlan, savePlanDraft, tasksFromVoidText } from './plan-controller.mjs';
import { createAddController, openAdd, disposeAdd } from './add-controller.mjs';
import { addButton, addText } from './add-view.mjs';
import { getAdditions, removeAddition } from './add-api.mjs';
import { createQueue } from './queue.mjs';
import { encodeHomeQr } from './qr.mjs';
import { renderQr } from './qr-render.mjs';
import { updateExpiry } from './settings.mjs';

const DESKTOP_MODES = ["map", "blueprint", "document"];
const BAR_MODES = ["map", "blueprint", "document"];
const PHONE_MODES = PHONE_NAV;
const RECOVERY_COPY = {
  reconnecting: ['Reconnecting to the service. What you do is kept and sent when it answers.', 'Reconectando con el servicio. Las acciones se conservan y se envían cuando responde.'],
  retry: ['Retry now', 'Reintentar ahora'],
  stopped: ['The Relay service stopped on {machine}.', 'El servicio Relay se detuvo en {machine}.'],
  details: ['Details', 'Detalles'],
  restart: ['Restart service', 'Reiniciar el servicio'],
  instructions: ['Reopen ONEM1ND on this machine, or run: {command}', 'Volver a abrir ONEM1ND en esta máquina o ejecutar: {command}'],
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
  stoppedTitle: ["The service stopped", "El servicio se detuvo"],
  stopped: ["ONEM1ND is not answering on this machine. Reopen ONEM1ND, or run: {command}", "ONEM1ND no responde en esta máquina. Volver a abrir ONEM1ND o ejecutar: {command}"],
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
  try { stored = storage?.getItem?.("hivem1nd:language") ?? null; } catch { stored = null; } // Compatibility: retain persisted viewer preferences and the preload bridge identity.
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
  try { app.startStorage?.setItem("hivem1nd:language", app.language); } catch { /* Storage can be unavailable in a private viewer. */ } // Compatibility: retain persisted viewer preferences and the preload bridge identity.
}

export function shellLayout(capabilities, audience) {
  if (audience === "phone") return "phone";
  if (!capabilities?.length) return "unknown";
  const names = new Set(capabilities);
  return names.has("viewer.write") || names.has("layout.write") ? "desktop" : "phone";
}

// The tab's own storage, when the browser allows it.
function tabStorage(env) {
  try { return env.sessionStorage ?? null; } catch { return null; }
}

export async function mount(root, env = globalThis) {
  const document = root.ownerDocument;
  const api = createApi({
    location: env.location ?? globalThis.location,
    history: env.history ?? globalThis.history,
    fetch: env.fetch,
    clock: env.clock,
    storage: tabStorage(env),
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
    embeddedHost: env.hivem1nd ?? globalThis.hivem1nd ?? null,
    openExternalApp: env.openExternalApp ?? null,
    startStorage: env.storage ?? viewStorage(document),
    recovery: env.recovery ?? ((env.hivem1nd ?? globalThis.hivem1nd)?.recoverService ? (env.hivem1nd ?? globalThis.hivem1nd) : null), // Compatibility: retain persisted viewer preferences and the preload bridge identity.
  };
  startEmbeddedApps(app, () => renderShell(app));
  // Slow actions run here in the background, one after another; their notices and the bell's list draw from it.
  app.queue = createQueue({ now: () => api.now(), onChange: () => {
    // While deletions run, the lists are read once at the end instead of after every change they announce: each read
    // rebuilt the whole view and made the next deletion wait for it.
    store.deferViewRefresh = deletionRunning(app);
    if (app.disposed || app.layout === 'unknown') return;
    if (app.rendering) queueMicrotask(() => { if (!app.disposed) renderShell(app); }); else renderShell(app);
  } });
  const view = root.ownerDocument.defaultView;
  view?.addEventListener?.("keydown", (event) => onEscapeKey(app, event));
  view?.addEventListener?.("keydown", (event) => onPickKey(app, event));
  root.addEventListener("click", (event) => closeBarPanels(app, event));
  root.addEventListener("keydown", (event) => {
    if (event.key !== "F2" || app.layout === "phone" || event.target?.closest?.("input, textarea")) return;
    const row = app.activeRows?.find((item) => item.id === event.target?.closest?.("[data-id]")?.getAttribute("data-id"));
    const id = row?.unit?.id ?? app.store.selected.unitId;
    if (id && !app.aliasEdit) { event.preventDefault?.(); beginAlias(app, id, row?.id); }
  });
  // A wheel, a touch drag or a scroll the shell did not cause itself marks the person as scrolling. A redraw sets the
  // scroll positions back, which fires scroll events of its own just after it.
  const scrolling = (event) => {
    if (document.hidden || (event.type === "scroll" && scrollClock() - (app.paintedAt ?? 0) < 150)) return;
    app.scrollingUntil = scrollClock() + SCROLL_QUIET_MS;
  };
  for (const type of ["wheel", "touchmove", "scroll"]) root.addEventListener?.(type, scrolling, { capture: true, passive: true });
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
  app.bootStopped = false;
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
    // The first view is enough to draw the shell, the Map and the lists. Settings, the viewer, the lists and the folder
    // reports then arrive in parallel and each fills its own part; a slow or failed one never takes the screen back.
    const early = shellLayout(app.store.capabilities, app.store.audience) === "desktop";
    if (early) {
      app.layout = "desktop";
      app.store.audience ??= app.layout;
      createLists(app);
      app.bootReading = false;
      app.bootSettled = true;
      clearTimeout(app.readyTimer);
      app.readyTimer = null;
      publish(app);
    }
    const presentation = loadPresentation(app).catch((error) => {
      if (!early || error?.status === 401) throw error;
      app.presentationError = error;
      retryPresentation(app, 1);
    });
    if (!early) await presentation;
    if (app.disposed || app.bootFailed) return app;
    const lists = early ? loadListData(app) : loadLists(app);
    const reports = app.layout === 'desktop' ? loadStartReports(app) : Promise.resolve();
    await Promise.all([presentation, lists, reports]);
    if (app.disposed || app.bootFailed) return app;
    // The accounts are asked about first, so the first agent can already be given one; the repository offer follows.
    if (app.layout === 'desktop' && !await maybeOfferAccounts(app)) maybeStartDiscovery(app);
    startOwnEmbed(app);
  } catch (error) {
    if (!app.disposed) {
      if (error?.status === 401) forgetSession(app.api);
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
  if (app.homeState?.expiryTimer != null) clearTimeout(app.homeState.expiryTimer);
  if (app.homeState) {
    app.homeState.expiryTimer = null;
    clearGrant(app.homeState);
  }
  await logout(app.api);
  app.disposed = true;
  disposeEmbeddedApps(app);
  renderSignedOut(app);
}

export function navigate(app, mode) {
  if (app.bootReading || app.bootFailed) return;
  if (openBrowserApp(app, mode)) return;
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
  else {
    app.mode = mode;
    // Waiting lives beside the Map, so any mode, the Map included, takes its panel away.
    app.waitingOpen = false;
  }
  if (mode !== "settings" && app.homeState?.grant) clearGrant(app.homeState);
  renderShell(app);
}

// Drawing the shell replaces the lists and the conversation, which stops a scroll in progress. While the person scrolls,
// a redraw waits until the scrolling has been still for a moment, and only one waits.
const SCROLL_QUIET_MS = 250;
// Time as the screen lives it, which keeps running when the app's clock is held still.
const scrollClock = () => globalThis.performance?.now?.() ?? Date.now();

export function renderShell(app) {
  const wait = (app.scrollingUntil ?? 0) - scrollClock();
  if (wait > 0) {
    if (!app.scrollRedraw) app.scrollRedraw = setTimeout(() => { app.scrollRedraw = null; if (!app.disposed) renderShell(app); }, wait + 10);
    return;
  }
  app.rendering = true;
  try {
    paintShell(app);
  } finally {
    app.rendering = false;
    // A long redraw still counts from its end, so the scroll positions it sets back are not taken for the person's.
    app.paintedAt = scrollClock();
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
  document.title = `${heading} · ONEM1ND`;
  const workspace = renderWorkspace(app, t, view, counts);
  workspace.setAttribute("id", "workspace");
  workspace.setAttribute("tabindex", "-1");
  if (app.layout === 'phone') shell.append(element(document, 'div', { class: 'phone-status' }, element(document, 'span', { text: formatClock(app.language, app.api.now()) }), 'ONEM1ND'));
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
  const scrolled = captureScrolls(app.root);
  app.root.replaceChildren(shell);
  restoreScrolls(app.root, scrolled);
  restoreRunning(app.root);
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
  paintQueue(app, shell);
  paintPhonePanel(app, shell);
  paintServiceBanner(app, shell);
  restoreInputFocus(app);
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
  syncEmbeddedApp(app);
}

// Every drawing replaces the whole shell. The panels that scroll keep where they were, so reading a long panel is not
// interrupted by a retry, a refresh or a message arriving.
const SCROLLING = ['.panel.side', '.panel.stage', '.panel.inspector', '.inspector-body', '.agent-controls', '.agent-details', '.chat-panel', '.settings-panel', '.transcript', '.session-work'];

function captureScrolls(root) {
  const saved = [];
  for (const selector of SCROLLING) {
    const node = root.querySelector?.(selector);
    if (node && node.scrollTop > 0) saved.push([selector, node.scrollTop]);
  }
  return saved;
}

function restoreScrolls(root, saved) {
  for (const [selector, top] of saved) {
    const node = root.querySelector?.(selector);
    if (node) node.scrollTop = top;
  }
}

function inputDrafts(app) {
  if (!app.inputDrafts) {
    app.inputDrafts = { chats: new Map(), notes: new Map(), fields: new Map(), disclosures: new Map(), focus: null };
  }
  return app.inputDrafts;
}

function aggregateDirty(app) {
  if ([...(app.chatThreads?.values() ?? [])].some((thread) => thread.pendingSends.size)) return true;
  const drafts = inputDrafts(app);
  for (const name of ["chats", "notes"]) {
    for (const value of drafts[name]?.values() ?? []) {
      const text = typeof value === "string" ? value : value?.value;
      if (text) return true;
    }
  }
  return false;
}

function syncViewerDirty(app) {
  if (!(app.store.capabilities ?? []).includes("viewer.write")) return null;
  const dirty = aggregateDirty(app);
  if (app.embed && app.embedDirty !== dirty) {
    app.embedDirty = dirty;
    publishDirty(app.embed, dirty);
  }
  if (app.viewerDirty === dirty) return app.viewerPatch ?? null;
  app.viewerDirty = dirty;
  const operation = createOperation({ method: "PATCH", path: "/viewer", body: { dirty } });
  app.viewerPatch = request(app.api, "PATCH", "/viewer", { operation }).catch((error) => {
    if (!app.disposed) noteAction(app, error);
  });
  return app.viewerPatch;
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
  const bucket = kind === "chat" ? drafts.chats : drafts.notes;
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
  stopWatchingMap(app);
  app.startDialog?.dialog?.close();
  if (!app || app.disposed) return;
  app.disposed = true;
  disposeEmbeddedApps(app);
  clearTimeout(app.workClock);
  clearTimeout(app.checkoutTimer);
  clearTimeout(app.readyTimer);
  clearTimeout(app.phoneExpiryTimer);
  clearTimeout(app.phoneLockTimer);
  clearTimeout(app.mapToastTimer);
  clearTimeout(app.scrollRedraw);
  for (const record of app.activity?.values() ?? []) record.cancel?.();
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
  app.liveStatus?.remove?.();
  app.liveError?.remove?.();
  app.liveStatus = null;
  app.liveError = null;
  disposeApi(app.api);
}

async function onStream(app, event) {
  if (app.disposed || app.bootFailed) return;
  if (event?.name === 'app.bridge') {
    const mode = embeddedOpenMode(app, event);
    if (mode) navigate(app, mode);
    forwardEmbeddedEvent(app, event);
    return;
  }
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
  if (app.layout === 'desktop' && ['cluster.changed', 'machine.settings.changed', 'additions.changed', 'stream.reset'].includes(event?.name) && !deletionRunning(app)) {
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
    if (event?.name === "stream.ready") { await recheckTracked(app); retryTransient(app); }
    result?.consume?.();
    return;
  }
  if (event?.name === "stream.reset") await recheckTracked(app);
  if (event?.name === "unit.changed" || event?.name === "view.changed") {
    if (!deletionRunning(app)) {
      if (app.unitList) await reloadList(app.unitList);
      if (event?.name === "view.changed" && app.waitingList) await reloadList(app.waitingList);
      if (event?.name === "view.changed" && app.thread?.chat) await loadMessages(app.api, app.thread);
    }
    if (event?.name === "unit.changed" && dataOf(event).unit?.removed) {
      const id = dataOf(event).unit.id;
      if (app.pendingChat?.unitId === id) app.pendingChat = null;
      app.mapState?.selection.delete(id);
      if (app.store.selected.unitId === id) app.store.selected.unitId = null;
      if (app.thread?.chat?.kind === "direct" && app.thread.chat.members.includes(id)) app.thread = null;
    }
  }
  if (event?.name === "chat.changed") {
    if (app.chatList && !deletionRunning(app)) await reloadList(app.chatList);
    const changed = dataOf(event).chat;
    if (changed?.id === app.thread?.chat?.id) app.thread.chat = app.store.indexes.chats.get(changed.id) ?? changed;
  }
  if (event?.name === "group.changed") {
    if (app.mapState) app.mapState.selectedGroupId = app.store.selected.groupId;
    if (dataOf(event).group?.deleted && app.thread?.chat?.id === dataOf(event).group.chatId) app.thread = null;
    if (app.chatList && !deletionRunning(app)) await reloadList(app.chatList);
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
  if (event?.name === "notification.changed") {
    const data = dataOf(event);
    const thread = app.chatThreads?.get(data.chatId) ?? (app.thread?.chat?.id === data.chatId ? app.thread : null);
    if (thread && data.message) incomingMessage(thread, data.message, true);
  }
  if (event?.name === "sync.conflict") noteSyncConflict(app, dataOf(event));
  if (app.layout !== "unknown") renderShell(app);
  result?.consume?.();
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
  {
    for (const mode of BAR_MODES.filter(mode => app.layout !== "phone" || mode !== "map")) {
      modes.append(element(document, "button", {
        type: "button",
        class: "mode",
        "data-action": `mode-${mode}`,
        "aria-pressed": String(app.mode === mode),
        onclick: () => navigate(app, mode),
        "aria-label": t(mode === "document" ? "voidMode" : mode),
      }, icon(document, mode), element(document, "span", { class: app.layout === "phone" ? "sr" : "", text: t(mode === "document" ? "voidMode" : mode) })));
    }
  }
  const waiting = element(document, "button", {
    type: "button",
    class: "pill",
    "data-action": "waiting",
    "aria-pressed": String(app.mode === "map" && app.waitingOpen === true || app.mode === "waiting"),
    "aria-label": cardinal(app.language, "waitingOnYou", counts.waiting ?? 0),
    onclick: () => openWaiting(app),
  }, icon(document, "waiting"), element(document, "span", { class: "pill-count", "aria-hidden": "true", text: formatNumber(app.language, counts.waiting ?? 0) }),
  element(document, "span", { class: "pill-label", text: cardinal(app.language, "waitingOnYou", counts.waiting ?? 0) }));
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
    onclick: () => toggleInspector(app),
  }, icon(document, "inspector"));
  const phone = element(document, "button", {
    type: "button", class: "icon-button", "data-action": "open-phone", "aria-pressed": String(app.phonePanelOpen === true),
    "aria-label": t("settingsOpenPhone"), onclick: () => openPhonePanel(app),
  }, icon(document, "phone"));
  // Below 1180 px Activity, the phone and Settings leave the bar for this menu, and below 987 px so does Details.
  const more = element(document, "button", {
    type: "button", class: "icon-button bar-more", "data-action": "bar-more", "aria-haspopup": "menu",
    "aria-label": t("finalMore"), title: t("finalMore"), onclick: (event) => openBarMenu(app, event.currentTarget ?? event.target?.closest?.("button")),
  }, icon(document, "more"));
  // The bell lists the background work: what waits, what runs, what failed and what finished.
  const openJobs = app.queue?.open.length ?? 0;
  const notifications = element(document, "button", {
    type: "button", class: "icon-button queue-bell", "data-action": "open-notifications", "aria-pressed": String(app.queuePanelOpen === true),
    "aria-label": openJobs ? t("queueOpen", { count: openJobs }) : t("queueTitle"), title: t("queueTitle"),
    onclick: () => { app.queuePanelOpen = app.queuePanelOpen !== true; renderShell(app); },
  }, icon(document, "bell"));
  if (openJobs) notifications.append(element(document, "span", { class: "queue-badge", "aria-hidden": "true", text: String(openJobs) }));
  const bar = element(document, "header", { class: "bar" }, app.layout === 'phone' ? brand(document).querySelector('.mark') : brand(document), modes);
  if (app.layout === 'phone') bar.append(element(document, 'h2', { 'data-phone-title': 'true', text: viewTitle(app, t) }));
  if (app.layout !== 'phone' && !app.bootReading && !app.bootFailed && app.store.capabilities.includes('settings.write')) {
    bar.append(addButton(document, app.language, () => openSharedAdd(app)));
  }
  if (counts.waiting) bar.append(waiting);
  if (app.layout !== "phone") {
    bar.append(phone, notifications, inspector, settings, more);
  }
  return bar;
}

// The side panel opens as a drawer from a button on the stage, which each mode draws in its own stage.
function catalogToggle(app, t, name) {
  const document = app.root.ownerDocument;
  return element(document, "button", {
    type: "button",
    class: "btn panel-toggle stage-toggle",
    "data-action": "toggle-catalog",
    "aria-pressed": String(app.catalogOpen === true),
    onclick: () => {
      app.catalogOpen = app.catalogOpen !== true;
      renderShell(app);
    },
  }, icon(document, { hierarchy: "hierarchy", boards: "blueprint", texts: "pen" }[name]), t(name));
}

function openBarMenu(app, anchor) {
  const t = (key) => text(app.language, key);
  const box = anchor?.getBoundingClientRect?.() ?? { right: 0, bottom: 0 };
  const items = [
    { id: "details", glyph: "inspector", label: t("details"), show: windowAtMost(app, SIDE_DRAWER_WIDTH), run: () => toggleInspector(app, true) },
    { id: "activity", glyph: "bell", label: t("queueTitle"), run: () => { app.phonePanelOpen = false; app.queuePanelOpen = true; renderShell(app); } },
    { id: "phone", glyph: "phone", label: t("settingsOpenPhone"), run: () => openPhonePanel(app, true) },
    { id: "settings", glyph: "settings", label: t("settings"), run: () => navigate(app, "settings") },
  ].filter((item) => item.show !== false);
  openContextMenu(app.root.ownerDocument, { x: box.right - 220, y: box.bottom + 6, items, label: t("finalMore") });
}

function toggleInspector(app, open = !app.inspectorOpen) {
  app.inspectorOpen = open;
  renderShell(app);
  refitBesideDrawer(app);
}

// A drawer over the Map covers part of it. While the view is still the fitted one, the graph is fitted again to what stays in sight.
function refitBesideDrawer(app) {
  const map = app.mapState, host = app.root.querySelector?.(".map");
  if (app.mode !== "map" || !map?.autoFit || !host || !windowAtMost(app, INSPECTOR_DRAWER_WIDTH)) return;
  const rect = host.getBoundingClientRect();
  const covered = app.inspectorOpen ? app.root.querySelector(".inspector")?.getBoundingClientRect().width ?? 0 : 0;
  // A drawer that covers the whole Map leaves nothing to fit to.
  if (rect.width - covered > 96 && rect.height > 96) fitMap(map, { left: rect.left, top: rect.top, width: rect.width - covered, height: rect.height });
}

function renderWorkspace(app, t, view, counts) {
  if (app.layout !== "phone" && (app.bootReading || app.bootFailed)) return openingWorkspace(app, t);
  const document = app.root.ownerDocument;
  const embedded = embeddedName(app.mode);
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
  if (embedded) {
    stage.setAttribute("data-embedded-stage", embedded);
    stage.querySelector("[data-stage-title]")?.setAttribute("class", "sr");
  }
  if (app.mode === "settings") {
    stage.append(settingsSurface(app, document, t));
  } else if (app.mode === "map") {
    ensureMap(app);
    stage.append(element(document, "div", { class: "map" }), catalogToggle(app, t, "hierarchy"));
  } else if (embeddedName(app.mode)) {
    stage.append(renderEmbeddedApp(app, t));
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
  if (outcomeVisible(app) && app.actionScope !== "editor" && !noticeSaysNote(app)) {
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
  // Rows picked in the Hierarchy are the inspector's subject, instead of the agent or cluster that was open before the pick.
  const pick = app.layout !== "phone" ? pickedTargets(app) : null;
  if (app.layout !== "phone" && app.waitingOpen) {
    inspectorBody.append(renderWaitingPanel(app, t));
  } else if (pick && pick.units.length + pick.clusters.length > 1) {
    inspectorBody.append(pickInspector(app, t, pick));
  } else if (app.layout !== "phone" && group && !group.deleted) {
    inspectorBody.className += ' agent-inspector';
    inspectorBody.append(clusterInspector(app, group), clusterPanel(app, t, group));
  } else if (app.layout !== "phone" && selection.length > 1) {
    inspectorBody.append(selectionInspector(app, t, selection));
  } else {
    const agent = inspectorAgent(app);
    if (agent) {
      inspectorBody.className += ' agent-inspector';
      inspectorBody.append(renderAgentHeader(document, agent, sessionForUnit(app, agent.id), app.language, () => openAgentMore(app, agent)));
      const review = renderInspector(app, t, agent);
      const progress = review.querySelector('[data-session-progress]');
      if (progress) {
        progress.remove();
        inspectorBody.append(progress);
      }
      const panel = chatPanel(app, t);
      const details = agentDetails(app, t, agent, review, panel);
      const tab = panel.getAttribute('data-agent-tab');
      // Details is the third tab: while it is open the conversation is hidden, not removed, so a draft and the scroll stay.
      if (tab === 'details') {
        for (const part of [...panel.children]) if (!part.matches?.('.session-tabs')) part.setAttribute('hidden', '');
      } else details.setAttribute('hidden', '');
      const tabs = panel.querySelector('.session-tabs');
      if (tabs && typeof panel.insertBefore === 'function' && tabs.nextSibling) panel.insertBefore(details, tabs.nextSibling); else panel.append(details);
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
  if (app.startError && !failedCauses(app).has(String(app.startError.code ?? 'unknown')) && !(serviceDown(app) && transientFailure(app.startError))) inspectorBody.append(element(document, 'div', { class: 'notice notice-error', role: 'alert', 'data-start-error': 'true' },
    element(document, 'p', { text: startErrorText(app) }),
    mapButton(app, 'retry-start-reports', startText(app.language, 'retry'), async () => { await loadStartReports(app); maybeStartDiscovery(app); })));
  dropRepeatedNotices(inspectorBody);
  // As a drawer the inspector has a header of its own with the way to close it; beside the Map the stylesheet hides that header.
  const inspector = element(document, "aside", {
    class: `panel inspector${app.inspectorOpen ? " is-open" : ""}`,
  }, app.layout === "phone" ? null : element(document, "header", { class: "inspector-drawer-head" },
    element(document, "h2", { text: t(app.waitingOpen ? "waiting" : "details") }),
    element(document, "button", { type: "button", class: "icon-button", "data-action": "close-inspector", "aria-label": t("closeInspector"), title: t("closeInspector"), onclick: () => toggleInspector(app, false) }, icon(document, "close"))), inspectorBody);
  const phoneHierarchy = app.layout === "phone" && app.mode !== "waiting" && app.tab !== "chats";
  const showSide = app.layout !== "phone" || app.mode !== "waiting";
  return element(document, "div", { class: embedded ? `workspace workspace-embedded${app.inspectorOpen ? " has-inspector" : ""}` : "workspace" },
    !embedded && showSide ? side : null, phoneHierarchy ? null : stage, !embedded || app.inspectorOpen ? inspector : null);
}

// The failed requests this panel shows as notices, by cause.
function failedCauses(app) {
  const here = noteScope(app);
  const causes = new Set();
  for (const record of app.activity?.values() ?? []) if (record.phase === "error" && (record.scope ?? here) === here) causes.add(String(record.error?.code ?? "unknown"));
  return causes;
}

// The note of the last failure is not said again when the notice of that same request is already on screen.
function noticeSaysNote(app) {
  if (app.actionTone !== "error" || !app.actionKey) return false;
  const record = app.activity?.get(app.actionKey);
  return record?.phase === "error" && (record.scope ?? noteScope(app)) === noteScope(app);
}

// The cause the person can act on: a slow service says so; any other failure keeps the connection sentence.
function startErrorText(app) {
  const code = app.startError?.code;
  return code && Object.hasOwn(ACTION_COPY, code) && code !== 'service_unavailable' ? actionText(app.language, code) : startText(app.language, 'unavailable');
}

// The same sentence is never said twice in one panel: the later note with the same words goes.
function dropRepeatedNotices(container) {
  const seen = new Set();
  for (const node of [...(container.children ?? [])]) {
    const mark = String(node.className ?? '');
    if (!/(?:action-note|notice)/.test(mark) && node.getAttribute?.('role') !== 'alert') continue;
    const words = String(node.querySelector?.('p')?.textContent ?? node.textContent ?? '').trim();
    if (!words) continue;
    if (seen.has(words)) node.remove(); else seen.add(words);
  }
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
  try { app.startStorage?.setItem("hivem1nd:opening-view", JSON.stringify(record)); } catch { /* Storage can be unavailable in a private viewer. */ } // Compatibility: retain persisted viewer preferences and the preload bridge identity.
}

function restoreOpeningView(app) {
  if (app.store.view?.counts) return;
  let parsed = null;
  try { parsed = JSON.parse(app.startStorage?.getItem?.("hivem1nd:opening-view") ?? "null"); } catch { parsed = null; } // Compatibility: retain persisted viewer preferences and the preload bridge identity.
  const record = openingViewRecord(parsed);
  if (record) app.store.view = record;
}

function openingWorkspace(app, t) {
  const document = app.root.ownerDocument;
  const failed = app.bootFailed;
  const content = element(document, "div", { class: `opening-content${failed ? " opening-failure" : ""}` });
  if (failed) {
    content.append(element(document, "div", { class: "opening-error-icon" }, icon(document, "alert")));
    const path = app.selectedFolder || "M1ND";
    // A stopped service is said to be stopped, with how to open it again; only a service that is up but slow reads as a slow drive.
    content.append(element(document, "h2", { text: openingText(app, app.bootStopped ? "stoppedTitle" : "failure") }));
    const command = `onem1nd service install${app.selectedFolder ? ` --mind-path "${String(app.selectedFolder).replace(/[\p{Cc}"]/gu, "")}"` : ""}`;
    const cause = app.bootStopped ? openingText(app, "stopped", { command })
      : app.bootError?.code === "timeout" ? openingText(app, "timeout", { path }) : `${path}: ${safeOpeningCause(app)}`;
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

// Settings and the viewer are not needed to show the shell; when they are slow or fail they are asked again a few times.
function retryPresentation(app, attempt) {
  if (attempt > 4) return;
  const timer = setTimeout(() => {
    if (app.disposed || !app.presentationError) return;
    loadPresentation(app, { keepShell: true }).then(() => { app.presentationError = null; }, (error) => {
      if (error?.status !== 401) retryPresentation(app, attempt + 1);
    });
  }, 3000 * attempt);
  timer.unref?.();
}

function createLists(app) {
  app.unitList = createPagedList({ api: app.api, store: app.store, name: "units", route: "/units" });
  app.chatList = createPagedList({ api: app.api, store: app.store, name: "chats", route: "/chats", filters: { listed: "true" }, rowHeight: 48 });
  app.waitingList = createPagedList({ api: app.api, store: app.store, name: "waiting", route: "/waiting" });
  const refresh = () => {
    if (!app.disposed && app.layout !== "unknown") renderShell(app);
  };
  // An open Attach agents picker also lists agents that arrive after it opened.
  app.unitList.onUpdate = () => { refresh(); app.attachRepaint?.(); };
  app.chatList.onUpdate = refresh;
  app.waitingList.onUpdate = refresh;
}

// Each list fills as its pages arrive; the three load side by side and a failed one only marks itself.
async function loadListData(app) {
  const unitList = app.unitList, chatList = app.chatList, waitingList = app.waitingList;
  const placement = request(app.api, "GET", "/layout").then((layout) => {
    if (app.disposed) return;
    app.store.layout = layout.data;
    if (app.layout !== "unknown") renderShell(app);
  }, () => {
    // Placement still runs when the layout route is unavailable.
  });
  await Promise.all([placement, loadAll(unitList), loadAll(chatList), loadAll(waitingList)]);
}

async function loadLists(app) {
  createLists(app);
  await loadListData(app);
}

function openWaiting(app) {
  if (app.layout === "phone") {
    navigate(app, "waiting");
    return;
  }
  app.waitingOpen = !(app.mode === "map" && app.waitingOpen === true);
  if (app.waitingOpen) { app.mode = "map"; app.waitingRecord = null; }
  if (app.waitingOpen && app.waitingList) reloadList(app.waitingList);
  // Where the inspector is a drawer, Waiting lives in it, so it opens with it.
  if (app.waitingOpen && windowAtMost(app, INSPECTOR_DRAWER_WIDTH)) app.inspectorOpen = true;
  if (!app.disposed) renderShell(app);
}

function openPhonePanel(app, open = app.phonePanelOpen !== true) {
  app.phonePanelOpen = open;
  if (open) app.queuePanelOpen = false;
  renderShell(app);
  if (open) app.root.querySelector("[data-phone-panel] button")?.focus?.();
}

// The panel under the bar's phone button: the code to scan while home access is open, how long it stays open, and the switch for it.
function paintPhonePanel(app, shell) {
  if (!app.phonePanelOpen || app.layout === "phone") return;
  const document = app.root.ownerDocument, t = (key, values) => text(app.language, key, values);
  const home = homeState(app);
  const open = Boolean(home.home?.enabled) && !updateExpiry(home.home, Date.now()).expired;
  const grant = open ? home.grant : null;
  const index = home.selected ?? 0;
  const panel = element(document, "section", { class: "phone-panel", "data-phone-panel": "true", role: "dialog", "aria-label": t("settingsOpenPhone") },
    element(document, "header", { class: "phone-panel-head" }, element(document, "h2", { text: t("settingsOpenPhone") }), element(document, "span", { class: "phone-panel-esc", text: t("escCloses") })));
  if (grant?.qrPayloads?.[index]) {
    const link = grant.links?.[index];
    const copy = element(document, "button", { type: "button", class: "btn ghost", "data-action": "phone-copy-link", text: t("phoneCopyLink") });
    copy.addEventListener("click", async () => {
      const clipboard = document.defaultView?.navigator?.clipboard;
      if (!link || !clipboard?.writeText) return;
      try { await clipboard.writeText(link); copy.textContent = t("phoneLinkCopied"); } catch { /* The link stays on the Settings page when the browser refuses the clipboard. */ }
    });
    panel.append(element(document, "div", { class: "phone-panel-grant", "data-secret": "true" },
      element(document, "div", { class: "phone-panel-code" }, renderQr(document, encodeHomeQr(grant.qrPayloads[index]), t("qrTitle")),
        element(document, "p", { "data-code": grant.shortCode, text: grant.shortCode })),
      element(document, "div", { class: "phone-panel-scan" }, element(document, "p", { text: t("phoneScan") }), element(document, "p", { class: "phone-panel-fine", text: t("phoneAccessCloses") }), copy)));
  } else panel.append(element(document, "p", { class: "phone-panel-note", text: t(open ? "noGrantSecret" : "finalPhoneHint") }));
  const foot = element(document, "div", { class: "phone-panel-foot" },
    element(document, "span", { class: "status-dot", "data-status": open ? "working" : "idle", "aria-hidden": "true" }),
    element(document, "span", { class: "phone-panel-state", "data-phone-state": open ? "open" : "closed", text: open ? t("phoneOpenUntil", { time: formatShortTime(app.language, home.home.expiresAt) }) : t("phoneAccessClosed") }));
  if (app.store.capabilities.includes("home.manage")) {
    foot.append(open
      ? element(document, "button", { type: "button", class: "btn ghost", "data-action": "phone-close-home", text: t("settingsCloseAccess"), onclick: () => endHome(app) })
      : element(document, "button", { type: "button", class: "btn primary", "data-action": "phone-open-home", text: t("phoneOpenTwelve"), onclick: () => beginHome(app, "", false) }));
  }
  panel.append(foot);
  shell.append(panel);
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
  surface.append(search, element(document, "p", {
    "data-waiting-total": String(total),
    text: cardinal(app.language, "waitingCount", total),
  }));
  if (!list) {
    surface.append(skeletonMark(document, t("loadingList")));
    return surface;
  }
  // A refresh under items already shown keeps them; the loading rows are only for an empty list.
  if (list.status === "loading" && !(list.items ?? []).length) surface.append(skeletonMark(document, t("loadingList"), "rows", { "data-list-progress": "true" }));
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

// Waiting opens in the inspector's column, so the Map stays in view. Each row is one thing that waits on the person, and one row opens in place.
const WAITING_GLYPH = { review: "document", approval: "waiting", message: "send", question: "chats", plan: "blueprint" };

// The project an item belongs to, named as the Hierarchy names its cluster.
function waitingProject(app, item) {
  const [kind, name] = String(item.taskId ?? "").split(":");
  const scope = unitById(app, item.unitId)?.scope;
  const project = kind === "project" || kind === "env" ? name : scope?.kind === "project" || scope?.kind === "environment" ? scope.name : "";
  if (!project) return "";
  const cluster = [...app.store.indexes.groups.values()].find((group) => !group.deleted && group.link?.projectId === project);
  return displayName(cluster?.title ?? project);
}

function waitingTitle(t, item) {
  return item.title || (item.taskId ? upperFirst(t("waitingTask", { number: String(item.taskId).split(":").at(-1) })) : t("unknown"));
}

// "Project, task 027, Oct 19" for a review, "Agent, Oct 19" for anything else. An open review also says who delivered it.
function waitingMeta(app, t, item, delivered = false) {
  const date = formatShortDate(app.language, item.since);
  const unit = unitById(app, item.unitId);
  const who = unit ? unitDisplayName(unit) : item.unitId ? readableIdentity(item.unitId, t("person")) : "";
  const when = delivered && date && who ? t("waitingDelivered", { date, unit: who }) : date;
  const parts = item.taskId ? [waitingProject(app, item), t("waitingTask", { number: String(item.taskId).split(":").at(-1) }), when] : [who, when];
  if (item.state === "expired") parts.push(t("expiredAsk"));
  return upperFirst(parts.filter(Boolean).join(", "));
}

// The projects behind what waits, three at most: "Reviews from Coffee cat page, TXMSKA and Guest or ghost".
function waitingSub(app, t, items) {
  const names = [...new Set(items.map((item) => waitingProject(app, item)).filter(Boolean))];
  if (!names.length) return "";
  const list = names.length > 3 ? t("listMore", { head: names.slice(0, 3).join(", "), count: names.length - 3 })
    : names.length > 1 ? t("listAnd", { head: names.slice(0, -1).join(", "), last: names.at(-1) }) : names[0];
  return t(items.every((item) => item.kind === "review") ? "waitingReviewsFrom" : "waitingFrom", { names: list });
}

function renderWaitingRow(app, t, item, open) {
  const document = app.root.ownerDocument;
  const row = element(document, "button", {
    type: "button",
    class: "waiting-row",
    "aria-expanded": String(open),
    "data-waiting-item": item.id,
    "data-kind": item.kind ?? "",
    "data-state": item.state ?? "pending",
    "data-approval": item.approvalId ?? "",
    "data-task": item.taskId ?? "",
    "data-chat": item.chatId ?? "",
    "data-message": item.messageId ?? "",
    "data-unit": item.unitId ?? "",
    onclick: () => {
      if (!open) { openWaitingItem(app, item); return; }
      app.waitingRecord = null;
      renderShell(app);
    },
  }, icon(document, WAITING_GLYPH[item.kind] ?? "waiting"),
  element(document, "span", { class: "waiting-row-text" },
    element(document, "span", { class: "waiting-row-title", text: waitingTitle(t, item) }),
    element(document, "span", { class: "waiting-row-meta", text: waitingMeta(app, t, item, open) })),
  icon(document, open ? "chevron" : "chevronRight"));
  if (!open) return row;
  return element(document, "div", { class: "waiting-open", "data-waiting-open": item.id }, row,
    element(document, "div", { class: "waiting-open-body" }, renderWaitingRecord(app, t, app.waitingRecord, true)));
}

function renderWaitingPanel(app, t) {
  const document = app.root.ownerDocument;
  const list = app.waitingList;
  const items = list?.items ?? [];
  const count = app.store.view?.counts?.waiting ?? list?.total ?? 0;
  const title = cardinal(app.language, "waitingOnYou", count);
  const sub = waitingSub(app, t, items.filter((item) => item.state !== "expired"));
  const panel = element(document, "section", { class: "waiting-panel", "data-waiting-panel": "true", "aria-label": title });
  panel.append(element(document, "header", { class: "cluster-heading" },
    element(document, "span", { class: "cluster-avatar", "aria-hidden": "true" }, icon(document, "waiting")),
    element(document, "div", {}, element(document, "h2", { text: title }), sub ? element(document, "p", { text: sub }) : null),
    element(document, "button", { type: "button", class: "icon-button", "data-action": "waiting-close", "aria-label": t("close"), title: t("close"),
      onclick: () => { app.waitingOpen = false; renderShell(app); } }, icon(document, "close"))));
  const body = element(document, "div", { class: "waiting-panel-list" });
  panel.append(body);
  if (!list) {
    body.append(skeletonMark(document, t("loadingList")));
    return panel;
  }
  // A refresh under items already shown keeps them; the loading rows are only for an empty list.
  if (list.status === "loading" && !items.length) body.append(skeletonMark(document, t("loadingList"), "rows", { "data-list-progress": "true" }));
  if (list.status === "error") body.append(element(document, "p", { text: t("listError") }),
    element(document, "button", { type: "button", class: "btn", "data-action": "retry-list", text: t("retry"), onclick: () => reloadList(list) }));
  if (!items.length && list.status !== "loading" && list.status !== "error") {
    body.append(element(document, "div", { class: "waiting-empty" },
      element(document, "p", { "data-empty": "waiting", text: t("emptyWaiting") }),
      element(document, "p", { class: "field-hint", "data-empty-next": "waiting", text: t("emptyWaitingNext") })));
    return panel;
  }
  const openId = app.waitingRecord?.item?.id;
  for (const section of waitingSections(items)) {
    if (!section.items.length) continue;
    body.append(element(document, "div", { class: "waiting-section" },
      element(document, "h3", { class: "waiting-section-title", text: t(section.key) }),
      element(document, "span", { text: String(section.items.length) })));
    for (const item of section.items) body.append(renderWaitingRow(app, t, item, item.id === openId));
  }
  if (list.nextCursor) body.append(element(document, "button", { type: "button", class: "waiting-more", "data-action": "waiting-more",
    text: startText(app.language, "more", { count: Math.max(0, (list.total ?? 0) - items.length) }),
    onclick: () => loadNext(list).then(() => { if (!app.disposed) renderShell(app); }).catch((error) => noteAction(app, error)) }));
  return panel;
}

// Open task: Waiting makes way for the agent the task belongs to, with the task in its inspector.
function openWaitingTask(app, record) {
  const unit = unitById(app, record.item?.unitId ?? record.task.toId);
  app.waitingOpen = false;
  app.waitingRecord = null;
  app.openTaskId = record.task.id;
  if (unit) openUnitFromMenu(app, unit);
  else renderShell(app);
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
  if (item.unitId) {
    app.store.selected.unitId = item.unitId;
    // A cluster left selected would keep its own inspector over the agent.
    app.store.selected.groupId = null;
  }
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
    // These open a conversation, which the inspector shows once Waiting is out of its way.
    if (app.layout !== "phone") app.waitingOpen = false;
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
  else app.waitingOpen = false;
  if (item.unitId) openExistingDirect(app, item.unitId);
  else if (!app.disposed) renderShell(app);
}

// `compact` is the record opened in the Waiting panel: a review there is the short card with Open task.
function renderWaitingRecord(app, t, record = app.waitingRecord, compact = false) {
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
    }, phone ? canAccept(record.task) : canSendBack(record.task), taskBusy, compact ? { request: requestBrief(record.task.request), onOpen: () => openWaitingTask(app, record),
      noteShown: noteDraft != null, onReveal: () => inputDrafts(app).notes.set(record.task.id, { value: "", start: 0, end: 0 }) } : null));
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
    block.append(skeletonMark(document, t("loadingList")));
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
  // One mark carries the loading text, so the sentence is never written twice; it shows the rows to come.
  const skeleton = waiting ? skeletonMark(document, t("loadingList"), "rows", { "data-list-progress": "true" }) : null;
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
    host.addEventListener("keydown", (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) hierarchyMenu(app, event);
      else if (app.layout !== "phone" && (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "a") { event.preventDefault?.(); pickEverything(app); }
      else if (app.layout !== "phone" && (event.key === "Delete" || event.key === "Backspace")) { event.preventDefault?.(); deletePicked(app, event.target?.closest?.("[data-id]")?.getAttribute?.("data-id")); }
      else if (event.key === "Escape" && app.hierarchySelection?.size) { app.hierarchySelection.clear(); renderShell(app); }
    });
  }
  const handlers = {
    selectedId: app.tab === "chats" ? app.store.selected.chatId : app.store.selected.groupId ? `cluster:${app.store.selected.groupId}` : app.store.selected.unitId,
    ...(app.tab === "hierarchy" && app.layout !== "phone" ? {
      isSelected: (row) => app.hierarchySelection?.size ? app.hierarchySelection.has(row.id) : row.id === (app.store.selected.groupId ? `cluster:${app.store.selected.groupId}` : app.store.selected.unitId),
      onPick: (row, how) => pickRow(app, row, how),
    } : {}),
    onActivate: (row, kind) => {
      // A plain click ends a multiple pick, and what it opens takes the inspector from Waiting.
      if (app.hierarchySelection?.size) app.hierarchySelection.clear();
      if (row.kind !== "heading" && row.kind !== "service" && row.kind !== "quiet") app.waitingOpen = false;
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
      } else if (row.kind === 'service') {
        if (serviceSetupAllowed(app)) openStartAgent(app, null, false, { service: row.role, anchor: null });
      } else if (row.kind === "quiet") {
        app.quietChatsOpen = app.quietChatsOpen !== true;
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
  // The bar floats over the foot of the list, so the rows do not move under the pointer when it appears.
  const bar = app.tab === "hierarchy" && app.layout !== "phone" ? pickBar(app) : null;
  if (bar) host.setAttribute("class", "list has-pick-bar");
  block.append(search, total, ...(skeleton ? [skeleton] : []), host, ...(bar ? [bar] : []));
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

function onEscapeKey(app, event) {
  if (event.key !== 'Escape' || app.layout === 'phone' || event.defaultPrevented) return;
  if (event.target?.closest?.('[data-context-menu]') || app.root.ownerDocument.querySelector?.('dialog[open]')) return;
  let opener = null;
  if (app.phonePanelOpen) { app.phonePanelOpen = false; opener = 'open-phone'; }
  else if (app.queuePanelOpen) { app.queuePanelOpen = false; opener = 'open-notifications'; }
  else if (app.waitingOpen) app.waitingOpen = false;
  else if (app.inspectorOpen && app.mode === 'map' && windowAtMost(app, INSPECTOR_DRAWER_WIDTH)) { app.inspectorOpen = false; opener = 'toggle-inspector'; }
  else if (app.catalogOpen && windowAtMost(app, SIDE_DRAWER_WIDTH)) { app.catalogOpen = false; opener = 'toggle-catalog'; }
  else return;
  event.preventDefault?.();
  renderShell(app);
  if (opener === 'toggle-inspector') refitBesideDrawer(app);
  restoreInvoker(app, opener);
}

// A click anywhere but on a panel and the button that opens it closes the phone and Activity panels.
function closeBarPanels(app, event) {
  if (app.layout === 'phone') return;
  const inside = selector => Boolean(event.target?.closest?.(selector));
  const phone = app.phonePanelOpen && !inside("[data-phone-panel], [data-action='open-phone']");
  const queue = app.queuePanelOpen && !inside("[data-queue-panel], [data-action='open-notifications'], [data-action='open-queue']");
  if (phone) app.phonePanelOpen = false;
  if (queue) app.queuePanelOpen = false;
  if (phone || queue) renderShell(app);
}

// The stylesheet turns the inspector into a drawer below this width, and the side panels below the next one.
const INSPECTOR_DRAWER_WIDTH = 1180;
const SIDE_DRAWER_WIDTH = 987;

function windowAtMost(app, width) {
  const view = app.root.ownerDocument.defaultView;
  if (typeof view?.matchMedia === 'function') return view.matchMedia(`(max-width: ${width}px)`).matches;
  return (view?.innerWidth ?? Infinity) <= width;
}

// Ctrl or Cmd+A, Delete and Escape (which ends a pick) work on the Map screen wherever the focus is, unless it is in a field or a dialog:
// the rows are drawn again after a click, so the focus does not stay on the list.
function onPickKey(app, event) {
  if (app.layout === 'phone' || app.mode !== 'map' || event.defaultPrevented) return;
  const target = event.target;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"], dialog, [data-context-menu]') || app.root.ownerDocument.querySelector?.('dialog[open]')) return;
  if (target?.closest?.('.map-host, [data-map-host], .map') ) return;
  if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'a' && app.tab === 'hierarchy') {
    event.preventDefault?.();
    pickEverything(app);
  } else if (event.key === 'Escape' && app.hierarchySelection?.size) {
    app.hierarchySelection.clear();
    renderShell(app);
  } else if (event.key === 'Delete') {
    if (app.hierarchySelection?.size) { event.preventDefault?.(); deletePicked(app); return; }
    const units = [...(app.mapState?.selection ?? [])];
    if (units.length || app.store.selected.groupId) { event.preventDefault?.(); app.mapState?.onDelete?.({ units, cluster: units.length ? null : app.store.selected.groupId }); }
  }
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

// The four reports are heavy to build. Calls that arrive while they load are folded into one more load after it, instead of
// each starting its own set: a deletion and the change it announces used to read everything twice at the same time.
function loadStartReports(app) {
  if (app.layout === 'phone' || app.disposed) return Promise.resolve();
  if (app.startReportFlight) { app.startReportFlight.again = true; return app.startReportFlight.promise; }
  const flight = { again: false, promise: null };
  flight.promise = (async () => {
    try {
      do {
        flight.again = false;
        const machine = startMachine(app), ticket = (app.startReportTicket ?? 0) + 1;
        app.startReportTicket = ticket;
        await readStartReports(app, machine, ticket);
      } while (flight.again && !app.disposed);
    } finally { if (app.startReportFlight === flight) app.startReportFlight = null; }
  })();
  app.startReportFlight = flight;
  app.startReportPending = flight.promise;
  return flight.promise;
}

async function readStartReports(app, machine, ticket) {
  try {
    const [projects, agents, clusters, additions] = await Promise.all([
      request(app.api, 'GET', '/settings/projects', { query: { machine } }),
      request(app.api, 'GET', '/settings/agents', { query: { machine } }),
      collectPages(app.api, '/clusters', { limit: 200 }),
      app.store.capabilities.includes('settings.write') ? getAdditions(app.api, machine) : Promise.resolve({ data: { items: [] } }),
    ]);
    if (app.disposed || ticket !== app.startReportTicket) return;
    app.startProjects = projects.data; app.startAgents = agents.data; app.startPermissionsStale = true;
    app.store.additions.report = additions.data;
    app.store.indexes.groups = new Map(clusters.items.map(cluster => [cluster.id, cluster]));
    app.startError = null;
    if (app.store.selected.groupId && !app.store.indexes.groups.has(app.store.selected.groupId)) app.store.selected.groupId = null;
    renderShell(app);
  } catch (error) {
    if (app.disposed || ticket !== app.startReportTicket) return;
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
  try { app.startStorage?.setItem(`hivem1nd:overseer:${app.selectedFolder}`, 'dismissed'); } catch { /* Storage can be unavailable in a private viewer. */ } // Compatibility: retain persisted viewer preferences and the preload bridge identity.
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

// The first start asks about each extra account home found on this machine, one at a time. Nothing is added without the person's answer.
export async function maybeOfferAccounts(app) {
  if (app.disposed || app.startDialog || app.layout !== 'desktop' || app.accountOfferBusy || !app.store.capabilities.includes('settings.write')) return false;
  app.accountOfferBusy = true;
  try {
    let data;
    try { data = (await request(app.api, 'GET', '/settings/accounts')).data; } catch { return false; }
    if (app.disposed || app.startDialog || !data?.pending?.length) return false;
    const offer = data.pending[0];
    const model = { language: app.language, offer, folder: String(offer.home).split(/[\\/]/).pop(), label: offer.label };
    let flow;
    const answer = (action, body) => flow.run(`${action}-account`, async () => {
      const path = `/settings/accounts/${action}`;
      await request(app.api, 'POST', path, { operation: createOperation({ method: 'POST', path, body }) });
      flow.dialog.close(); if (app.startDialog === flow) app.startDialog = null;
      await loadStartReports(app);
      app.accountOfferBusy = false; if (!await maybeOfferAccounts(app)) maybeStartDiscovery(app);
    });
    flow = startDialog(app.root.ownerDocument, { view: 'account-offer', language: app.language, onCancel: () => { if (!flow.busy) flow.dialog.close(); },
      onClose: () => { if (app.startDialog === flow) app.startDialog = null; }, render: () => renderAccountOffer(app.root.ownerDocument, model, {
        onLabel: value => { model.label = value; }, onSkip: () => answer('skip', { client: offer.client, home: offer.home }),
        onConfirm: () => answer('confirm', { client: offer.client, home: offer.home, label: model.label.trim() || offer.label }),
      }) });
    flow.model = model; app.startDialog = flow;
    return true;
  } finally { app.accountOfferBusy = false; }
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
  try { dismissed ||= app.startStorage?.getItem(`hivem1nd:overseer:${app.selectedFolder}`) === 'dismissed'; } catch { /* In-memory dismissal still applies. */ } // Compatibility: retain persisted viewer preferences and the preload bridge identity.
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

// From the Map a new agent can come with its role chosen, the lead it reports to, and, when no cluster is implied, the
// clusters to choose from.
async function openStartAgent(app, cluster, overseer = false, options = {}) {
  if (app.startDialog || app.layout === 'phone') return;
  // The form needs only the connected agents. They are read on their own, so a folder report that is slow or failed
  // never keeps a new agent from being created; the rest of the reports load beside it.
  if (!app.startAgents) {
    try { app.startAgents = (await request(app.api, 'GET', '/settings/agents', { query: { machine: startMachine(app) } })).data; }
    catch (error) { noteAction(app, error, 'start-agents'); return; }
    loadStartReports(app);
  }
  if (app.disposed || app.startDialog) return;
  const clients = app.startAgents?.connectedClients ?? [], preferred = app.startAgents?.defaultRunsIn;
  const model = { language: app.language, kind: overseer ? 'overseer' : 'agent', agentKind: preferred?.client === 'lyra' ? 'local' : 'external',
    cluster, service: options.service ?? null, role: options.service ?? options.role ?? 'executor', roleName: '', roleDescription: '', roleProblems: {}, clients,
    clusterChoices: options.clusterChoices ?? null, leadId: options.leadId ?? null, leadName: options.leadId ? unitDisplayName(unitById(app, options.leadId) ?? { unit: options.leadId }) : '', choice: initialRunsIn(clients, preferred, overseer ? preferred?.client === 'lyra' ? 'local' : 'external' : null), fresh: true, useAsDefault: false,
    automatic: false };
  const anchor = options.anchor === undefined ? app.root.querySelector('[data-action="new-agent"]') : options.anchor;
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
      onCluster: id => { const next = model.clusterChoices?.find(group => group.id === id); if (next) { model.cluster = next; retained = null; flow.paint(); } },
      onRoleName: value => { model.roleName = value; delete model.roleProblems.roleName; },
      onRoleDescription: value => { model.roleDescription = value; delete model.roleProblems.roleDescription; },
      onPicker: () => openRunsPicker(app, model, () => { model.agentKind = model.choice?.client === 'lyra' ? 'local' : 'external'; flow.paint(); }, flow.dialog.querySelector('[data-action="open-runs-picker"]')),
      onConnect: () => { flow.dialog.close(); settingsState(app).tab = 'agents'; navigate(app, 'settings'); },
      onCancel: cancel,
      onCreate: () => roleReady() && flow.run('create-agent', async () => {
        let result;
        try {
          result = created ?? (overseer ? await startApi.createOverseer(app.api, { machine: startMachine(app), runsIn: model.choice, fresh: model.fresh, expectedRevision: null }, retained)
            : model.service ? await startApi.createService(app.api, { machine: startMachine(app), role: model.service }, retained)
            : await startApi.createClusterAgent(app.api, model.cluster.id, { machine: startMachine(app), role: model.role, roleName: model.roleName.trim(), roleDescription: model.roleDescription.trim(), runsIn: model.choice, useAsDefault: model.useAsDefault, leadId: model.leadId, expectedRevision: model.cluster.revision }, retained));
          created = result;
          // The service is created first and told where it runs right after, as the unit write takes no choice of runtime.
          if (model.service) {
            try { result = await startApi.setRunsIn(app.api, result.data.id, { machine: startMachine(app), runsIn: model.choice, useAsDefault: model.useAsDefault, expectedRevision: result.data.revision }, defaultOperation); }
            catch (error) { defaultOperation = unconfirmedStartOperation(error); throw error; }
          }
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
  showDialog(app.root.ownerDocument, { title: startText(app.language, 'removeLink') + ': ' + displayName(link.title),
    body: startText(app.language, 'removeHint'), confirm: startText(app.language, 'removeLink'), cancel: startText(app.language, 'cancel'), retry: startText(app.language, 'retry'),
    // The dialog closes at once; removing the link runs in the background, in Activity.
    onConfirm: () => {
      app.queue.add({ label: text(app.language, 'jobRemoveLink', { name: displayName(link.title) }), kind: 'unlink',
        run: async () => {
          try { return await startApi.removeClusterLink(app.api, cluster.id, { machine, expectedRevision: cluster.revision }, retained); }
          catch (error) { retained = error.operation ?? retained; throw error; }
        },
        onDone: async (result) => {
          // Undo is offered as soon as the service confirms; the reports catch up behind it.
          showMapToast(app, startText(app.language, 'removeLink'), () => { enqueueUndo(app, displayName(link.title), [result.data.changeId], () => loadSettingsSections(app)); });
          renderShell(app);
          await loadStartReports(app); await loadSettingsSections(app);
        } });
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

function clusterModel(app, cluster) {
  const facts = app.clusterFacts?.id === cluster.id ? app.clusterFacts : {};
  return { language: app.language, cluster, git: facts.git ?? app.clusterGit?.get(cluster.id)?.git, error: facts.error?.message,
    units: app.unitList?.catalog ?? [], children: [...app.store.indexes.groups.values()].filter(group => !group.deleted && group.parentId === cluster.id),
    link: app.startProjects?.clusterLinks?.find(item => item.clusterId === cluster.id),
    loading: !app.startProjects && !app.startError, unreadable: Boolean(app.startError),
    addition: app.store.additions.report?.items.find(item => item.kind === 'repository' && item.projectId === cluster.link?.projectId) };
}

function clusterActions(app, cluster) {
  return {
    onUpdate: item => openSharedAdd(app, item),
    onNewAgent: () => openStartAgent(app, cluster), onLink: () => openClusterLink(app, cluster),
    onMore: () => removeStartCluster(app, cluster), onChanges: () => showClusterChanges(app, cluster),
    // The plan draft opens in the chat, so the chat tab comes forward with it.
    onChoosePlanner: () => { unitConversation(app, cluster.id).tab = 'chat'; openPlanDraft(app, cluster).catch(error => noteAction(app, error)); },
    onEditor: () => settle(app, `editor:${cluster.id}`, startText(app.language, 'openEditor'), async record => {
      const result = await startApi.openClusterEditor(app.api, cluster.id, startMachine(app), record.operation); return result;
    }),
  };
}

function clusterInspector(app, cluster) {
  return renderCluster(app.root.ownerDocument, clusterModel(app, cluster), clusterActions(app, cluster));
}

// ---- Picking several rows and deleting them -------------------------------------------------------------------
// The Hierarchy keeps the picked rows by their row ids: an agent's id, or cluster:<id>. Ctrl or Cmd toggles a row, Shift picks
// the range from the last picked row, Ctrl+A picks every agent and cluster, and Delete deletes what is picked.
function pickable(row) { return Boolean(row && (row.unit && row.unit.role !== 'master' || row.kind === 'cluster')); }

function pickRow(app, row, { toggle = false, range = false } = {}) {
  if (!pickable(row)) return false;
  const picked = app.hierarchySelection ??= new Set();
  // A pick starts empty. The row that is open is only where the first Shift range begins; it is not picked by that.
  if (!picked.size) app.hierarchyAnchor = null;
  const open = app.store.selected.groupId ? `cluster:${app.store.selected.groupId}` : app.store.selected.unitId;
  const anchor = app.hierarchyAnchor ?? (open && app.activeRows?.some(item => item.id === open && pickable(item)) ? open : null);
  if (range && anchor) {
    const rows = (app.activeRows ?? []).filter(pickable), from = rows.findIndex(item => item.id === anchor), to = rows.findIndex(item => item.id === row.id);
    if (from >= 0 && to >= 0) for (const item of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) picked.add(item.id);
    else picked.add(row.id);
  } else if (picked.has(row.id) && toggle) picked.delete(row.id);
  else picked.add(row.id);
  app.hierarchyAnchor = range ? anchor ?? row.id : row.id;
  renderShell(app);
  return true;
}

function pickEverything(app) {
  const picked = app.hierarchySelection ??= new Set();
  for (const group of app.store.indexes.groups.values()) if (!group.deleted) picked.add(`cluster:${group.id}`);
  for (const unit of app.unitList?.catalog ?? []) if (!unit.removed && unit.role !== 'master') picked.add(unit.id);
  renderShell(app);
}

function pickedTargets(app) {
  const units = [], clusters = [];
  for (const id of app.hierarchySelection ?? []) {
    if (id.startsWith('cluster:')) { if (app.store.indexes.groups.get(id.slice(8))) clusters.push(id.slice(8)); }
    else if (unitById(app, id)) units.push(id);
  }
  return { units, clusters };
}

// Delete with several rows picked asks once for all of them; with one row, it opens that row's own Delete.
function deletePicked(app, focusedId = null) {
  if (!app.store.capabilities?.includes('unit.create') && !app.store.capabilities?.includes('chat.manage')) return;
  const { units, clusters } = pickedTargets(app);
  if (units.length + clusters.length > 1) return confirmDeleteMany(app, units, clusters);
  const only = units[0] ?? (clusters[0] ? `cluster:${clusters[0]}` : focusedId);
  if (!only) return;
  if (only.startsWith('cluster:')) { const cluster = app.store.indexes.groups.get(only.slice(8)); if (cluster) removeStartCluster(app, cluster); }
  else { const unit = unitById(app, only); if (unit && unit.role !== 'master') removeSelectedUnit(app, unit); }
}

function confirmDeleteMany(app, units, clusters) {
  const inside = new Set(clusters.flatMap(id => clusterSubtree(app, id)));
  const count = units.length + inside.size;
  const dialog = showDialog(app.root.ownerDocument, { title: text(app.language, 'deleteManyTitle', { count }),
    body: text(app.language, 'deleteManyBody', { what: deletionSummary(app, units.length, inside.size) }),
    confirm: text(app.language, 'delete'), cancel: text(app.language, 'cancel'),
    onConfirm: () => { enqueueDeletion(app, { units, clusters }); } });
  dialog.setAttribute('data-delete-many', String(count));
}

function deletionSummary(app, units, clusters) {
  const parts = [units ? text(app.language, units === 1 ? 'deleteManyAgent' : 'deleteManyAgents', { count: units }) : '',
    clusters ? text(app.language, clusters === 1 ? 'deleteManyCluster' : 'deleteManyClusters', { count: clusters }) : ''].filter(Boolean);
  const joined = parts.length === 2 ? text(app.language, 'deleteManyAnd', { first: parts[0], second: parts[1] }) : parts[0] ?? '';
  return joined.charAt(0).toLocaleUpperCase() + joined.slice(1);
}

// A bar over the Hierarchy says how many rows are picked and deletes them.
function pickBar(app) {
  const document = app.root.ownerDocument, { units, clusters } = pickedTargets(app), count = units.length + clusters.length;
  if (count < 2) return null;
  return element(document, 'div', { class: 'pick-bar', 'data-pick-bar': String(count) },
    element(document, 'span', { text: text(app.language, 'finalSelection', { count }) }),
    element(document, 'button', { type: 'button', class: 'btn danger', 'data-action': 'delete-picked', text: text(app.language, 'delete'), 'aria-label': text(app.language, 'menuDeleteSelected', { count }), onclick: () => confirmDeleteMany(app, units, clusters) }),
    element(document, 'button', { type: 'button', class: 'btn quiet', 'data-action': 'clear-picked', 'aria-label': text(app.language, 'clearSelection'), text: '×', onclick: () => { app.hierarchySelection.clear(); renderShell(app); } }));
}

function removeStartCluster(app, cluster) {
  const tree = clusterSubtree(app, cluster.id), inside = tree.length - 1;
  showDialog(app.root.ownerDocument, { title: text(app.language, 'delete') + ': ' + displayName(cluster.title),
    body: inside ? text(app.language, inside === 1 ? 'deleteTreeBodyOne' : 'deleteTreeBody', { count: inside }) : startText(app.language, 'removeHint'),
    confirm: text(app.language, 'delete'), cancel: startText(app.language, 'cancel'),
    // The dialog closes at once; the deletion runs in the background, in Activity.
    onConfirm: () => { enqueueDeletion(app, { units: [], clusters: [cluster.id] }); } });
}

// A cluster and every cluster inside it, the innermost first, so each one is empty when it is deleted.
function clusterSubtree(app, id) {
  const groups = [...app.store.indexes.groups.values()].filter(group => !group.deleted);
  const order = [], seen = new Set();
  const visit = (current) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const child of groups.filter(group => group.parentId === current)) visit(child.id);
    order.push(current);
  };
  visit(id);
  return order;
}

// Agents first, then the clusters with the ones inside them, innermost first. Each step keeps its own operation, so a retry
// replays a write the service may already have applied instead of sending a second one.
function enqueueDeletion(app, { units = [], clusters = [] }) {
  const clusterIds = [], seen = new Set();
  for (const id of clusters) for (const inner of clusterSubtree(app, id)) if (!seen.has(inner)) { seen.add(inner); clusterIds.push(inner); }
  // An outer cluster waits for every cluster inside it, wherever it was picked.
  clusterIds.sort((left, right) => clusterDepth(app, right) - clusterDepth(app, left));
  // An agent goes before its lead, so a lead is never left with reports when its turn comes.
  const leadDepth = (id) => { let depth = 0, current = unitById(app, id); const seen = new Set(); while (current?.leadId && !seen.has(current.id)) { seen.add(current.id); depth += 1; current = unitById(app, current.leadId); } return depth; };
  const unitIds = units.filter(id => unitById(app, id) && unitById(app, id).role !== 'master').sort((left, right) => leadDepth(right) - leadDepth(left));
  const total = unitIds.length + clusterIds.length;
  if (!total) return null;
  const names = { units: unitIds.map(id => unitDisplayName(unitById(app, id))), clusters: clusterIds.map(id => displayName(app.store.indexes.groups.get(id)?.title ?? id)) };
  const label = total === 1 ? (unitIds.length ? text(app.language, 'jobRemoveAgent', { name: names.units[0] }) : text(app.language, 'jobDeleteCluster', { name: names.clusters[0] }))
    : clusters.length === 1 && !unitIds.length ? text(app.language, 'jobDeleteTree', { name: displayName(app.store.indexes.groups.get(clusters[0])?.title ?? ''), count: clusterIds.length - 1 })
      : text(app.language, 'jobDeleteMany', { count: total });
  // What is being deleted leaves the screen now; a failure brings it back from the service.
  hideDeleted(app, unitIds, clusterIds);
  const steps = [...unitIds.map(id => ({ kind: 'unit', id })), ...clusterIds.map(id => ({ kind: 'cluster', id }))];
  const changes = [];
  return app.queue.add({ label, steps: total > 1 ? total : null, kind: 'delete',
    run: async (report) => {
      // One item that cannot be deleted does not stop the others; the job fails at the end with the first reason, and
      // Retry asks again only for what is left.
      let failure = null;
      for (const step of steps) {
        if (step.done) continue;
        try {
          step.result = step.kind === 'unit' ? await deleteUnitStep(app, step) : await deleteClusterStep(app, step);
          step.done = true;
          if (step.result?.data?.changeId) changes.push(step.result.data.changeId);
        } catch (error) { failure ??= error; }
        report(steps.filter(item => item.done).length, total);
      }
      if (failure) {
        // What could not be deleted comes back on screen as the service has it.
        afterDeletion(app).catch(() => {});
        throw failure;
      }
      return { changes };
    },
    onDone: async () => {
      // Undo is offered as soon as the service confirms; the lists catch up behind it. Undoing one item selects it again.
      const undoName = total === 1 ? (names.units[0] ?? names.clusters[0]) : text(app.language, 'deletedMany', { count: total });
      const reselect = total !== 1 ? null : unitIds.length ? () => { app.store.selected.unitId = unitIds[0]; app.mapState?.onSelection([unitIds[0]]); focusUnitRow(app, unitIds[0]); }
        : () => selectGroup(app, clusterIds[0]);
      showMapToast(app, total === 1 && unitIds.length ? `${names.units[0]} · ${removalText(app, 'archived')}` : undoName,
        () => { enqueueUndo(app, undoName, [...changes].reverse(), reselect); });
      renderShell(app);
      await afterDeletion(app);
    } });
}

function clusterDepth(app, id) {
  let depth = 0, current = app.store.indexes.groups.get(id);
  const seen = new Set();
  while (current?.parentId && !seen.has(current.id)) { seen.add(current.id); depth += 1; current = app.store.indexes.groups.get(current.parentId); }
  return depth;
}

function hideDeleted(app, unitIds, clusterIds) {
  for (const id of unitIds) {
    for (const shown of [app.unitList?.catalog?.find(item => item.id === id), app.store.indexes.units.get(id)]) if (shown) shown.removed = true;
    app.mapState?.selection.delete(id);
    if (app.pendingChat?.unitId === id) app.pendingChat = null;
    if (app.store.selected.unitId === id) app.store.selected.unitId = null;
    if (app.thread?.chat?.kind === 'direct' && app.thread.chat.members.includes(id)) app.thread = null;
  }
  for (const id of clusterIds) {
    const shown = app.store.indexes.groups.get(id);
    if (shown) app.store.indexes.groups.set(id, { ...shown, deleted: true, deleting: true });
    if (app.store.selected.groupId === id) app.store.selected.groupId = null;
  }
  app.hierarchySelection?.clear();
  renderShell(app);
}

async function deleteUnitStep(app, step) {
  const unit = unitById(app, step.id) ?? { id: step.id, revision: step.revision };
  step.revision ??= unit.revision;
  try { return await removeUnit(app.api, { id: step.id, revision: step.revision }, step.operation); }
  catch (error) { step.operation = error.operation ?? step.operation; throw error; }
}

async function deleteClusterStep(app, step) {
  const machine = startMachine(app);
  if (!step.operation) {
    const current = app.store.indexes.groups.get(step.id);
    step.operation = createOperation({ method: 'DELETE', path: '/clusters/:clusterId', params: { clusterId: step.id }, body: { machine, confirmed: true, expectedRevision: current?.revision ?? null } });
  }
  try { return await request(app.api, 'DELETE', step.operation.path, { operation: step.operation }); }
  catch (error) {
    // The cluster changed since it was listed (the one inside it was just deleted, for one): read it again and ask once more.
    if (['cluster_changed', 'revision_conflict'].includes(error?.code) && !step.reread) {
      step.reread = true;
      const fresh = (await request(app.api, 'GET', '/clusters/:clusterId', { params: { clusterId: step.id }, query: { machine } })).data;
      step.operation = createOperation({ method: 'DELETE', path: '/clusters/:clusterId', params: { clusterId: step.id }, body: { machine, confirmed: true, expectedRevision: fresh.revision } });
      return request(app.api, 'DELETE', step.operation.path, { operation: step.operation });
    }
    if (error?.code === 'cluster_not_found') return null;
    throw error;
  }
}

async function afterDeletion(app) {
  await loadSnapshot(app.store, app.api).catch(() => {});
  if (app.unitList) await reloadList(app.unitList).catch(() => {});
  if (app.chatList) await reloadList(app.chatList).catch(() => {});
  await loadStartReports(app);
  if (!app.disposed) renderShell(app);
}

function enqueueUndo(app, name, changeIds, after = null) {
  if (!changeIds.length) return;
  const operations = new Map();
  app.queue.add({ label: text(app.language, 'jobUndo', { name }), steps: changeIds.length > 1 ? changeIds.length : null, kind: 'undo',
    run: async (report) => {
      for (const [index, changeId] of changeIds.entries()) {
        if (operations.get(changeId) === 'done') continue;
        try { await undoChange(app.api, changeId, operations.get(changeId) ?? null); }
        catch (error) { if (error.operation) operations.set(changeId, error.operation); throw error; }
        operations.set(changeId, 'done');
        report(index + 1, changeIds.length);
      }
    },
    onDone: async () => { await afterDeletion(app); await after?.(); } });
}

function showClusterChanges(app, cluster) {
  settle(app, `changes:${cluster.id}`, startText(app.language, 'changes'), async () => {
    const changes = await collectPages(app.api, `/clusters/${encodeURIComponent(cluster.id)}/changes`, { query: { machine: startMachine(app) }, limit: 100 });
    const dialog = showDialog(app.root.ownerDocument, { title: startText(app.language, 'changes') + ': ' + displayName(cluster.title), cancel: startText(app.language, 'close') });
    dialog.append(renderClusterChanges(app.root.ownerDocument, changes.items));
  });
}

function clusterChatPanel(app, cluster) {
  const t = (key, values) => text(app.language, key, values);
  const panel = chatPanel(app, t);
  const composer = panel.querySelector('[data-composer]');
  if (composer) {
    composer.setAttribute('aria-label', startText(app.language, 'messageCluster', { name: displayName(cluster.title) }));
    composer.setAttribute('placeholder', startText(app.language, 'messageCluster', { name: displayName(cluster.title) }));
    const hint = panel.querySelector('.field-hint'); if (hint) hint.textContent = startText(app.language, 'goesToLead');
  }
  return panel;
}

// Under its header a cluster has the tabs an agent has: its chat, the work of the one who leads it, and its details.
function clusterPanel(app, t, cluster) {
  const document = app.root.ownerDocument;
  const tabs = unitConversation(app, cluster.id);
  tabs.detailsTab = true;
  const lead = clusterLead(cluster, app.unitList?.catalog ?? []);
  const leadView = lead ? sessionViewFor(app, sessionForUnit(app, lead.id)) : null;
  const panel = element(document, 'section', { class: 'chat-panel agent-conversation', 'data-agent-tab': tabs.tab, 'data-cluster-panel': cluster.id });
  panel.append(renderSessionTabs(document, tabs, app.language, tab => selectSessionTab(app, tabs, tab, leadView ?? tabs)));
  if (tabs.tab === 'details') panel.append(renderClusterDetails(document, clusterModel(app, cluster), clusterActions(app, cluster)));
  else if (tabs.tab === 'work' && leadView) {
    const work = renderSessionWork(document, leadView, app.language, {
      onRetry: async () => { await loadSessionView(app.api, leadView); if (!app.disposed) renderShell(app); },
      onMore: async () => { await loadSessionView(app.api, leadView, { older: true }); if (!app.disposed) renderShell(app); },
      onStop: () => stopWorkStep(app, leadView),
    }, app.api.now());
    work.setAttribute('id', `session-${cluster.id}-panel`); work.setAttribute('aria-labelledby', `session-${cluster.id}-work`);
    work.scrollTop = leadView.scrollTop; work.addEventListener('scroll', () => { leadView.scrollTop = work.scrollTop; });
    panel.append(work);
  } else if (tabs.tab === 'work') panel.append(unitWork(document, tabs, app.language, t));
  else {
    const chat = clusterChatPanel(app, cluster);
    const transcript = chat.querySelector('.transcript');
    if (transcript) { transcript.setAttribute('id', `session-${cluster.id}-panel`); transcript.setAttribute('role', 'tabpanel'); transcript.setAttribute('aria-labelledby', `session-${cluster.id}-chat`); }
    panel.append(...chat.children);
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

// `source` is the session whose work the Work tab shows when it is not the view's own: a cluster shows the work of its lead.
async function selectSessionTab(app, view, tab, source = view) {
  captureInputs(app); view.tab = tab;
  renderShell(app);
  app.root.querySelector(`[data-action="session-${tab}"]`)?.focus?.();
  if (source.unitOnly) return;
  if (tab === 'work' && (!source.workLoaded || source.workStale)) {
    await loadSessionView(app.api, source); source.workStale = false;
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

// The ··· of an agent opens a menu under it, as the right-click menu does, not a dialog: the full transcript, rename,
// pin or remove its chat from the list, and remove the agent.
function openAgentMore(app, unit) {
  const document = app.root.ownerDocument, session = sessionForUnit(app, unit.id), caps = app.store.capabilities ?? [];
  const chat = app.thread?.chat?.kind === 'direct' && app.thread.chat.members?.includes(unit.id) ? app.thread.chat : null;
  const items = [];
  if (session) items.push({ id: 'full-transcript', label: startText(app.language, 'transcript'), run: () => openSessionTranscript(app, session) });
  if (caps.includes('unit.create')) items.push({ id: 'agent-rename', label: text(app.language, 'rename'), run: () => beginAlias(app, unit.id) });
  if (chat && caps.includes('chat.manage')) {
    if (chat.pinned !== true) items.push({ id: 'pin', label: text(app.language, 'pin'), run: () => changeChat(app, { pinned: true }) });
    if (chat.listed !== false) items.push({ id: 'unlist', label: text(app.language, 'removeFromList'), run: () => changeChat(app, { listed: false }) });
    else items.push({ id: 'reopen', label: text(app.language, 'reopenChat'), run: () => changeChat(app, { listed: true }) });
  }
  // Removing an agent starts here, in the inspector, without first opening Details.
  if (caps.includes('unit.create') && typeof unit.id === 'string' && unit.id !== 'root:master' && unit.role !== 'master') {
    items.push({ id: 'agent-remove', label: removalText(app, 'confirm'), danger: true, run: () => removeSelectedUnit(app, unit) });
  }
  if (!items.length) return;
  const box = app.root.querySelector('[data-action="agent-more"]')?.getBoundingClientRect?.();
  openContextMenu(document, { x: box ? box.right - 220 : 0, y: box ? box.bottom + 6 : 0, items, label: startText(app.language, 'moreMenu') });
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
  const document = app.root.ownerDocument;
  const texts = (await collectPages(app.api, '/void/texts', { limit: 50 })).items;
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
  // With several rows picked, the menu of one of them acts on all of them.
  const rowId = target.kind === 'cluster' ? `cluster:${target.id}` : target.id;
  if (desktop && target.kind !== 'map' && app.hierarchySelection?.size > 1 && app.hierarchySelection.has(rowId)) {
    const { units, clusters } = pickedTargets(app), count = units.length + clusters.length;
    openContextMenu(app.root.ownerDocument, { x: target.x, y: target.y, label: text(app.language, 'finalSelection', { count }), items: [
      { id: 'delete-picked', label: text(app.language, 'menuDeleteSelected', { count }), danger: true, primary: true, run: () => confirmDeleteMany(app, units, clusters) },
      { id: 'clear-picked', label: text(app.language, 'clearSelection'), run: () => { app.hierarchySelection.clear(); renderShell(app); } },
    ] });
    return;
  }
  const groups = [...app.store.indexes.groups.values()].filter(group => !group.deleted);
  const items = [];
  let name = '';
  if (target.kind === 'map') {
    if (!desktop) return;
    const place = newAgentPlace(app, target.groupId ?? null, null);
    if (caps.includes('unit.create')) {
      if (!overseerExists(app)) items.push({ id: 'create-overseer', label: startText(app.language, 'createOverseer'), primary: true, run: () => createOverseer(app) });
      items.push({ id: 'new-agent', label: place ? t('menuNewAgentMap') : t('menuNeedsCluster'), disabled: !place, primary: overseerExists(app),
        run: () => place && openStartAgent(app, place.cluster, false, { clusterChoices: place.choices, anchor: null }) });
    }
    if (caps.includes('chat.manage')) items.push({ id: 'new-cluster', label: t('menuNewCluster'), run: () => openStartCluster(app) });
    items.push({ id: 'fit', label: t('menuFit'), run: () => fitMapView(app) });
    openContextMenu(app.root.ownerDocument, { x: target.x, y: target.y, items, label: t('mapMenuLabel') });
    return;
  }
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
    if (desktop && caps.includes('unit.create')) items.push({ id: 'new-report', label: t('menuNewReport'), run: () => openReportMenu(app, { source: unit.id, x: target.x, y: target.y, groupId: null }) });
    if (desktop && caps.includes('chat.manage') && groups.some(group => group.id !== home?.id)) items.push({ id: 'move', label: t('menuMove'), run: () => openMoveAgent(app, unit) });
    if (desktop) items.push({ id: 'details', label: text(app.language, 'details'), run: () => showUnitDetails(app, unit) });
    if (desktop && caps.includes('chat.manage') && home) items.push({ id: 'remove', label: t('menuRemove'), run: () => detachAgent(app, unit, home) });
    if (desktop && caps.includes('unit.create')) items.push({ id: 'delete', label: t('menuDelete'), danger: true, run: () => removeSelectedUnit(app, unit) });
  } else {
    const cluster = app.store.indexes.groups.get(target.id);
    if (!cluster || cluster.deleted) return;
    name = displayName(cluster.title);
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
    // A cluster with clusters inside it is deleted with them; the dialog says how many.
    if (desktop && caps.includes('chat.manage')) items.push({ id: 'delete', label: t('menuDelete'), danger: true, run: () => removeStartCluster(app, cluster) });
  }
  openContextMenu(app.root.ownerDocument, { x: target.x, y: target.y, items, label: t('menuLabel', { name }) });
}

// The cluster a new agent made from the Map goes to: the one under the pointer, else the lead's own. With neither, every
// cluster is offered in the form, the first one chosen; with no cluster at all there is nothing to create it in.
function newAgentPlace(app, groupId, leadId) {
  const groups = [...app.store.indexes.groups.values()].filter(group => !group.deleted);
  const under = groupId ? groups.find(group => group.id === groupId) : null;
  if (under) return { cluster: under, choices: null };
  const lead = leadId ? unitById(app, leadId) : null, home = lead ? unitCluster(app, lead) : null;
  if (home) return { cluster: home, choices: null };
  if (!groups.length) return null;
  // The top clusters come first, as the Hierarchy lists them; the ones inside them follow.
  const sorted = groups.sort((left, right) => Number(Boolean(left.parentId)) - Number(Boolean(right.parentId))
    || String(left.title).localeCompare(String(right.title), app.language));
  return { cluster: sorted[0], choices: sorted.length > 1 ? sorted : null };
}

// A connection dropped on empty space, or the source's own menu, offers a new agent that reports to the source.
function openReportMenu(app, { source, x, y, groupId }) {
  const t = (key, values) => startText(app.language, key, values), lead = unitById(app, source);
  if (!lead || app.layout === 'phone' || !app.store.capabilities?.includes('unit.create')) return;
  const place = newAgentPlace(app, groupId, source);
  const create = role => () => place && openStartAgent(app, place.cluster, false, { role, leadId: source, clusterChoices: place.choices, anchor: null });
  const items = place ? [
    { id: 'new-overlord', label: t('menuNewOverlord'), primary: true, run: create('overlord') },
    { id: 'new-executor', label: t('menuNewExecutor'), run: create('executor') },
    { id: 'new-custom', label: t('menuNewCustom'), run: create('custom') },
  ] : [{ id: 'new-cluster', label: t('menuNeedsCluster'), primary: true, run: () => openStartCluster(app) }];
  openContextMenu(app.root.ownerDocument, { x, y, items, label: t('dropMenuLabel', { name: unitDisplayName(lead) }), title: t('dropMenuLabel', { name: unitDisplayName(lead) }) });
}

function fitMapView(app) {
  const map = ensureMap(app);
  if (!map.host) return;
  // A stage too small to fit leaves the view as it is.
  try { fitMap(map); } catch (error) { if (!(error instanceof RangeError)) throw error; }
}

// An agent's Details tab, in separate sections: how it runs, the agent itself, its session, its tasks and what waits.
// Only asks and tasks in review stay in the conversation; every other task is listed here.
function agentDetails(app, t, agent, review, panel) {
  const document = app.root.ownerDocument;
  const tabId = panel.querySelector?.('[data-action="session-details"]')?.getAttribute?.('id');
  const root = element(document, 'section', { class: 'agent-details', 'data-agent-details': agent.id, role: 'tabpanel', ...(tabId ? { 'aria-labelledby': tabId } : {}) });
  const section = (key, ...parts) => {
    const shown = parts.filter(Boolean);
    if (!shown.length) return;
    root.append(element(document, 'section', { class: 'details-section', 'data-details-section': key },
      element(document, 'h3', { class: 'details-section-title', text: startText(app.language, key) }), ...shown));
  };
  section('detailsRun', actionControls(app, t, agent));
  const facts = review.querySelector('[data-unit-facts]');
  facts?.remove();
  if (facts) facts.className += ' agent-facts';
  // The card's own lines repeat the facts; only what the facts do not say is kept.
  const shownLabels = new Set([...(facts?.children ?? [])].map(line => String(line.textContent).split(':')[0]));
  const extra = [...(review.querySelector('.unit-metadata')?.querySelectorAll?.('p') ?? [])]
    .filter(line => !shownLabels.has(String(line.textContent).split(':')[0]) && !String(line.textContent).endsWith(`: ${t('unknown')}`));
  for (const line of extra) line.remove();
  const more = extra.length ? element(document, 'div', { class: 'unit-facts agent-extra' }, ...extra) : null;
  // Each fact reads as a muted label and its value; the text stays "Label: value".
  for (const line of [...(facts?.children ?? []), ...extra]) {
    const textValue = String(line.textContent ?? ''), cut = textValue.indexOf(': ');
    if (cut < 0 || line.children?.length) continue;
    line.className = `${line.className ?? ''} fact`.trim();
    line.replaceChildren(element(document, 'span', { class: 'fact-label', text: textValue.slice(0, cut + 2) }), element(document, 'span', { class: 'fact-value', text: textValue.slice(cut + 2) }));
  }
  section('detailsAgent', facts, more);
  const inspector = review.querySelector('.inspector-details');
  const waiting = inspector?.querySelector('.waiting-list');
  waiting?.remove();
  const sessionParts = inspector ? [...inspector.children].filter(part => !part.matches?.('summary')) : [];
  for (const part of sessionParts) part.remove();
  const sessionShown = sessionParts.filter(part => part.children?.length || part.textContent);
  if (sessionShown.length) {
    const state = agentMachine(app, agent)?.answers === false ? startText(app.language, 'sessionUnavailable') : agent.sessionIds?.length ? startText(app.language, 'sessionRunning') : t('finalNotStarted');
    root.append(trackDisclosure(app, element(document, 'details', { class: 'details-section session-disclosure', 'data-details-section': 'detailsSession' },
      element(document, 'summary', {}, icon(document, 'chevronRight'),
        element(document, 'span', { class: 'session-disclosure-title', text: startText(app.language, 'sessionOn', { machine: agent.machine || t('unknown') }) }),
        element(document, 'span', { class: 'session-disclosure-state', text: state })), ...sessionShown), `agent-session:${agent.id}`));
  }
  const cards = review.querySelector('[data-action-cards]');
  cards?.remove();
  const later = [];
  if (cards) {
    for (const card of [...cards.children]) {
      const id = card.getAttribute?.('data-task') ?? card.getAttribute?.('data-task-detail');
      if (!id) continue;
      const status = card.getAttribute?.('data-task-status') ?? cards.querySelector?.(`[data-task='${id}']`)?.getAttribute?.('data-task-status')
        ?? later.find(item => item.getAttribute?.('data-task') === id)?.getAttribute?.('data-task-status');
      if (status !== 'review') { card.remove(); later.push(card); }
    }
    const scroll = panel.querySelector('.transcript') ?? panel.querySelector('[data-session-work]') ?? panel.querySelector('[data-unit-work]');
    const field = panel.querySelector('.field');
    if (cards.children.length) {
      if (scroll) scroll.append(cards);
      else if (!(field && placeBefore(field, cards))) panel.append(cards);
    }
  }
  // A task that waits for nothing is one line; its card, with what can be done and why not, opens under it.
  const rows = [];
  for (const card of later) {
    const id = card.getAttribute?.('data-task');
    if (id) rows.push(element(document, 'details', { class: 'task-row', 'data-task-row': id },
      element(document, 'summary', { text: String(card.children?.[0]?.textContent ?? id).trim() }), card));
    else {
      const row = rows.at(-1);
      if (!row) continue;
      row.append(card);
      // A task with no title is named by the start of its request.
      const summary = row.querySelector('summary'), request = String(card.querySelector?.('h3')?.textContent || card.querySelector?.('p')?.textContent || '').trim();
      if (summary && request && !/\s/.test(summary.textContent.trim())) summary.textContent = `${summary.textContent.trim()} · ${request.length > 64 ? `${request.slice(0, 63)}…` : request}`;
    }
  }
  section('detailsTasks', rows.length ? element(document, 'div', { class: 'later-cards', 'data-later-cards': 'true' }, ...rows) : null);
  section('detailsWaiting', waiting);
  return root;
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
  // Details is the agent's third tab.
  const tabs = sessionViewFor(app, sessionForUnit(app, unit.id)) ?? unitConversation(app, unit.id);
  tabs.tab = 'details';
  renderShell(app);
}

function hierarchyMenu(app, event) {
  const node = event.target?.closest?.('[data-row]'), row = node && app.activeRows?.find(item => item.id === node.getAttribute('data-id'));
  const target = row?.unit ? { kind: 'unit', id: row.unit.id } : row && (row.kind === 'cluster' || row.kind === 'worktree') ? { kind: 'cluster', id: row.groupId } : null;
  if (!target || app.tab !== 'hierarchy') return;
  event.preventDefault?.();
  const box = node.getBoundingClientRect?.(), keyboard = event.type === 'keydown' || (!event.clientX && !event.clientY);
  openItemMenu(app, { ...target, source: 'hierarchy', x: keyboard && box ? box.left + 24 : event.clientX, y: keyboard && box ? box.bottom - 4 : event.clientY });
}

// The members of a cluster are changed through its group route; the cluster route takes no members.
async function setClusterMembers(app, cluster, members) {
  const operation = createOperation({ method: 'PATCH', path: '/groups/:groupId', params: { groupId: cluster.id }, body: { members, expectedRevision: cluster.revision } });
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
  openMoveAgents(app, [unit]);
}

// One destination for every agent, and one background job to move them. A cluster that already holds all of them is not offered.
function openMoveAgents(app, units) {
  const homes = units.map(unit => unitCluster(app, unit)?.id ?? null), shared = new Set(homes).size === 1 ? homes[0] : null;
  const choices = [...app.store.indexes.groups.values()].filter(group => !group.deleted && group.id !== shared);
  const ids = units.map(unit => unit.id), one = units.length === 1, name = unitDisplayName(units[0]);
  openChoiceForm(app, 'move-agent', one ? startText(app.language, 'moveTitle', { name }) : text(app.language, 'moveManyTitle', { count: ids.length }), form => {
    appendSelect(form.ownerDocument, form, 'clusterId', startText(app.language, 'moveTo'), choices.map(group => ({ value: group.id, label: displayName(group.title) })), choices[0]?.id ?? '');
  }, async form => {
    const target = app.store.indexes.groups.get(fieldValue(form, 'clusterId'));
    if (!target) return false;
    const cluster = displayName(target.title);
    // The form closes at once; the move runs in the background, in Activity.
    app.queue.add({ label: one ? text(app.language, 'jobMove', { name, cluster }) : text(app.language, 'jobMoveMany', { count: ids.length, cluster }), kind: 'move',
      run: async () => {
        const into = app.store.indexes.groups.get(target.id) ?? target, arriving = ids.filter(id => !into.members.includes(id));
        if (arriving.length) await setClusterMembers(app, into, [...into.members, ...arriving]);
        await loadStartReports(app);
        // Each cluster the agents leave is written once, with all of the agents that were in it.
        const leaving = new Map();
        homes.forEach((home, index) => { if (home && home !== target.id) leaving.set(home, [...(leaving.get(home) ?? []), ids[index]]); });
        for (const [home, gone] of leaving) {
          const old = app.store.indexes.groups.get(home);
          if (old?.members.some(id => gone.includes(id))) await setClusterMembers(app, old, old.members.filter(id => !gone.includes(id)));
        }
      },
      onDone: () => refreshAfterMembership(app) });
    return true;
  }, 'move-agent');
}

// The agent stays, with its chat; it only leaves the cluster, so the Map stops drawing it until it is moved to one.
function detachAgent(app, unit, cluster) {
  const t = (key, values) => startText(app.language, key, values), name = unitDisplayName(unit);
  const dialog = showDialog(app.root.ownerDocument, {
    title: t('detachTitle', { name, cluster: displayName(cluster.title) }), body: t('detachBody'), confirm: t('detachConfirm'), cancel: text(app.language, 'cancel'), retry: text(app.language, 'retry'),
    // The dialog closes at once; the change runs in the background, in Activity.
    onConfirm: () => { app.queue.add({ label: text(app.language, 'jobDetach', { name, cluster: displayName(cluster.title) }), kind: 'detach',
      run: async () => {
        const fresh = app.store.indexes.groups.get(cluster.id) ?? cluster;
        await setClusterMembers(app, fresh, fresh.members.filter(id => id !== unit.id));
      },
      onDone: async () => {
        await refreshAfterMembership(app);
        showMapToast(app, t('detached', { name, cluster: displayName(cluster.title) }), async () => {
          const current = app.store.indexes.groups.get(cluster.id);
          if (current && !current.members.includes(unit.id)) await setClusterMembers(app, current, [...current.members, unit.id]);
          await refreshAfterMembership(app);
        });
      } }); },
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
  // The Map marks the rows picked in the Hierarchy, by the Hierarchy's own set, so every drawing shows the pick as it is.
  app.mapState.picked = app.hierarchySelection ??= new Set();
  app.mapState.persist = Boolean(app.store.capabilities?.includes("layout.write"));
  // Choosing something on the Map ends a pick made in the Hierarchy.
  app.mapState.onSelect = (id) => {
    app.hierarchySelection?.clear();
    app.waitingOpen = false;
    app.store.selected.groupId = null;
    app.store.selected.unitId = app.mapState.selection.size === 1 ? id : null;
    if (app.store.selected.unitId) {
      loadInspector(app, id);
      app.pendingChat = { unitId: id, create: true };
    }
    if (!app.disposed) renderShell(app);
  };
  app.mapState.onSelection = (ids) => {
    app.hierarchySelection?.clear();
    app.waitingOpen = false;
    app.store.selected.groupId = null;
    app.store.selected.unitId = ids.length === 1 ? ids[0] : null;
    if (ids.length === 1) {
      app.pendingChat = { unitId: ids[0], create: true };
      loadInspector(app, ids[0]);
    } else app.thread = null;
    renderShell(app);
  };
  app.mapState.layerAbove = () => Boolean(app.phonePanelOpen || app.queuePanelOpen);
  app.mapState.onContextMenu = (target) => openItemMenu(app, { ...target, source: 'map' });
  app.mapState.onPersonalGroup = (id) => { app.hierarchySelection?.clear(); selectGroup(app, id); };
  app.mapState.onOpenCluster = (id) => openCluster(app, id);
  app.mapState.onRename = (id) => beginAlias(app, id);
  app.mapState.onConnect = (pending) => confirmConnection(app, pending.source, [pending.target]);
  app.mapState.onConnectDrop = (drop) => openReportMenu(app, drop);
  app.mapState.onDelete = ({ units, cluster }) => {
    if (units.length > 1) return confirmDeleteMany(app, units, []);
    const unit = units[0] ? unitById(app, units[0]) : null;
    if (unit && unit.role !== 'master') return removeSelectedUnit(app, unit);
    const group = cluster ? app.store.indexes.groups.get(cluster) : null;
    if (group && !group.deleted) removeStartCluster(app, group);
  };
  app.mapState.onGroupConnect = (pending, point) => chooseSelectionLead(app, null, point);
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

// While the Map shows the whole graph it follows its stage: when the stage changes size the graph is fitted again, so it stays centred.
function watchMapSize(app, host) {
  if (app.mapWatch?.host === host) return;
  stopWatchingMap(app);
  const Observer = host.ownerDocument?.defaultView?.ResizeObserver;
  if (typeof Observer !== 'function') return;
  const sizeOf = () => { const { width, height } = host.getBoundingClientRect(); return { width, height }; };
  // Every drawing of the shell brings a new stage, so the size is kept across them: a stage that starts at another size than the one it replaces is a change too.
  app.mapSize ??= sizeOf();
  const observer = new Observer(() => {
    const now = sizeOf(), before = app.mapSize;
    // The observer also reports the size a stage starts with, and a redraw of the Map never changes the size of its stage.
    if (now.width === before.width && now.height === before.height) return;
    app.mapSize = now;
    const map = app.mapState;
    if (app.disposed || !map?.autoFit || now.width <= 96 || now.height <= 96) return;
    fitMap(map, host.getBoundingClientRect());
  });
  observer.observe(host);
  app.mapWatch = { host, observer };
}

function stopWatchingMap(app) {
  app.mapWatch?.observer.disconnect();
  app.mapWatch = null;
}

function finishMap(app) {
  const host = app.root.querySelector?.(".map");
  if (!host || !app.mapState) { stopWatchingMap(app); return; }
  watchMapSize(app, host);
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
    statusWorking: text(app.language, "statusWorking"),
    statusWaiting: text(app.language, "statusWaiting"),
    statusIdle: text(app.language, "statusIdle"),
    statusOut: text(app.language, "statusOut"),
    statusQuota: text(app.language, "statusQuota"),
    statusUnknown: text(app.language, "statusUnknown"),
    savingLayout: text(app.language, "savingLayout"),
    layoutError: text(app.language, "layoutError"),
    retry: text(app.language, "retry"),
    fit: text(app.language, 'finalFit'),
    zoomIn: text(app.language, 'finalZoomIn'), zoomOut: text(app.language, 'finalZoomOut'),
    zoom: text(app.language, 'finalZoom'), zoomReset: text(app.language, 'finalZoomReset'),
    help: text(app.language, 'mapControls'), expand: name => text(app.language, 'expandCluster', { name }),
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
  // Three repositories are read at a time, so the readings of a long list never crowd out what the person is doing.
  const queue = [...work];
  const reader = async () => {
    while (queue.length && !app.disposed) {
      const row = queue.shift();
      let git = null;
      try { git = (await startApi.getClusterGit(app.api, row.groupId, startMachine(app))).data; }
      catch { /* The row shows no branch until the next reading. */ }
      finally { app.clusterGit.set(row.groupId, { revision: row.group.revision, git }); app.clusterGitPending.delete(row.groupId); }
      if (!app.disposed) renderShell(app);
    }
  };
  Promise.allSettled([reader(), reader(), reader()]);
}

function collectionRows(app, t, list) {
  if (app.tab === "chats") {
    const sent = (chat) => Date.parse(chat.lastMessage?.timestamp || chat.lastMessage?.date || "") || 0;
    const pinned = list.items.filter((chat) => chat.pinned === true);
    const unpinned = list.items.filter((chat) => chat.pinned !== true);
    // The newest conversation comes first; the chats nobody has written in wait together under one folded line.
    const recent = unpinned.filter((chat) => chat.lastMessage).sort((left, right) => sent(right) - sent(left));
    const quiet = unpinned.filter((chat) => !chat.lastMessage);
    const rows = [];
    const heading = (labelKey) => rows.push({ id: `heading:${labelKey}`, kind: "heading", depth: 0, text: t(labelKey), pos: rows.length + 1, setsize: list.items.length });
    const chatRow = (chat) => {
      const last = chat.lastMessage;
      const body = String(last?.body || last?.subject || "").replace(/\s+/g, " ").trim();
      const preview = !last ? t("noMessagesTitle") : body ? `${messageSender(app, last)}: ${body}` : "";
      const when = formatRecent(app.language, last?.timestamp || last?.date || "", app.api.now());
      const unread = Number(chat.unread) > 0 ? formatNumber(app.language, chat.unread) : "";
      const title = displayName(chat.title) || chat.id;
      rows.push({ id: chat.id, kind: "chat", chat, depth: 0, title, preview, when, unread,
        text: [title, preview, unread ? t("unreadCount", { count: unread }) : when].filter(Boolean).join(", "), pos: rows.length + 1, setsize: list.items.length });
    };
    if (pinned.length) { heading("pinnedChats"); pinned.forEach(chatRow); }
    if (recent.length) { heading("recentChats"); recent.forEach(chatRow); }
    if (quiet.length) {
      heading("quietChats");
      const expanded = app.quietChatsOpen === true || Boolean(list.query);
      const names = quiet.slice(0, 3).map((chat) => displayName(chat.title) || chat.id).join(", ");
      const count = cardinal(app.language, "chatsCount", quiet.length);
      const preview = quiet.length > 3 ? t("chatsAndMore", { names }) : names;
      rows.push({ id: "group:quiet", kind: "quiet", depth: 0, expanded, count, preview, text: `${count}, ${preview}`, pos: rows.length + 1, setsize: list.items.length });
      if (expanded) quiet.forEach(chatRow);
    }
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
  // Until the units have arrived, a service that is missing from the list may just not be loaded yet.
  const rows = flattenVisibleHierarchy(tree, app.hierarchy, list.query, { loaded: Boolean(list.catalog?.length) || list.status === "ready" || list.status === "empty" });
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
  // Permissions is no tab: a saved or requested one opens Agents with that disclosure open.
  if (state.tab === "permissions") { state.tab = "agents"; (inputDrafts(app).disclosures ??= new Map()).set("settings-permissions", true); }
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
  const issues = (app.store.view?.issues ?? app.unitList?.issues ?? []).map((issue) => ({ code: issue.code, path: issue.path, message: issue.message }));
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
    accounts: state.accounts,
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
    issuesOpen: state.issuesOpen === true,
    projectQuery: state.projectQuery ?? "",
    projectOrder: state.projectOrder ?? "ascending",
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
    onReviewAll: (agents) => reviewAllSettingsAgents(app, agents),
    onDisconnect: (agent) => disconnectSettingsAgent(app, agent),
    onAddAccount: (client, name) => addSettingsAccount(app, client, name),
    onRemoveAccount: (client, account) => removeSettingsAccount(app, client, account),
    onReviewAccount: (client, account) => reviewSettingsAgent(app, state.agents.items.find(item => item.id === client), state.agents.items.find(item => item.id === client).mode, 'cli', account),
    onRevokeGrant: (item) => revokeSettingsGrant(app, item),
    onRevokePermission: (item) => settingsMutation(app, "DELETE", `/settings/permissions/${encodeURIComponent(item.id)}`, { machine: state.machine, expectedRevision: state.permissions.revision }),
    onLinkFolder: () => openClusterLink(app, null, state.machine),
    onRemoveLink: link => removeStartLink(app, link, state.machine),
    onOpenEditor: link => openLinkEditor(app, link, state.machine),
    onCopyPath: link => copyLinkPath(app, link),
    onProjectView: ({ query, order }) => { state.projectQuery = query; state.projectOrder = order; },
    onIssuesOpen: open => { state.issuesOpen = open; },
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
  for (const node of panel.querySelectorAll("[data-disclosure]")) trackDisclosure(app, node, node.getAttribute("data-disclosure"));
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
      // The accounts belong to this machine; a service without them leaves the section out.
      request(app.api, "GET", "/settings/accounts").catch(() => ({ data: null })),
    ]);
    if (app.disposed) return;
    if (ticket !== state.ticket) return state.pending;
    [state.info, state.agents, state.permissions, state.projects, state.content] = results.map(result => result.data);
    state.machines = results[5].data;
    state.accounts = results[6].data;
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
  const command = `onem1nd service install${path ? ` --mind-path "${path}"` : ''}`;
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

function reviewSettingsAgent(app, agent, mode, target, account = null) {
  const state = settingsState(app);
  const machine = state.machine;
  // An extra account is reviewed on its own: its home gets the same entry, hooks, rule line and skills as the default one.
  const extra = account && !account.default ? account : null;
  const opener = extra ? `settings-account-review-${agent.id}-${extra.id}` : target === "app" ? `settings-app-${agent.id}` : agent.cli.state === "connected" ? `settings-mode-${agent.id}-${mode}` : `settings-review-${agent.id}`;
  return settle(app, `settings-preview:${agent.id}${extra ? `:${extra.id}` : ""}`, text(app.language, "settingsReview"), async record => {
    const path = `/settings/agents/${encodeURIComponent(agent.id)}/preview`;
    const result = await commitSettingsMutation(app, record, "POST", path, { machine, mode, target, allowGit: false, ...(extra ? { account: extra.id } : {}) });
    if (app.disposed || state.machine !== machine || app.mode !== "settings") return;
    const review = { agent: extra ? { ...agent, name: `${agent.name} (${extra.label})` } : agent, machine, target, opener, preview: result.data, selected: new Set(result.data.changes.filter(change => !change.optional && change.selected).map(change => change.id)) };
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

// Review all: every agent that is behind is previewed, the changes are read together, and applying them runs in Activity.
function reviewAllSettingsAgents(app, agents) {
  const state = settingsState(app);
  const machine = state.machine;
  return settle(app, "settings-preview-all", text(app.language, "settingsReviewAll"), async () => {
    const items = [];
    for (const agent of agents) items.push({ agent, preview: (await previewAgent(app.api, agent.id, { machine, mode: agent.mode, target: "cli", allowGit: false })).data });
    if (app.disposed || state.machine !== machine || app.mode !== "settings") return;
    const review = { machine, language: app.language, items };
    const dialog = renderReviewAll(app.root.ownerDocument, review, (key, variables) => text(app.language, key, variables), {
      onApplyAll: () => { dialog.close(); enqueueApplyAll(app, review); },
    });
    state.dialog?.close();
    mountSettingsDialog(app, dialog, "settings-review-all");
  });
}

const reviewedChanges = preview => preview.changes.filter(change => !change.optional).map(({ id, path, afterText }) => ({ id, path, afterText }));

// An agent that fails is kept for its own result line and does not stop the others; Retry asks again only for what is left.
function enqueueApplyAll(app, review) {
  const { machine, items } = review;
  const steps = items.map(({ agent, preview }, index) => ({ agent, preview, reviewed: JSON.stringify(reviewedChanges(preview)), fresh: index > 0, done: false, retained: null }));
  const results = steps.map(step => ({ name: step.agent.name, state: "waiting" }));
  return app.queue.add({ label: cardinal(app.language, "jobApplyAll", steps.length), steps: steps.length > 1 ? steps.length : null, kind: "agents",
    run: async (report, job) => {
      job.results = results;
      let failure = null;
      for (const [index, step] of steps.entries()) {
        if (step.done) continue;
        try {
          await applyAgentStep(app, machine, step);
          step.done = true;
          results[index] = { name: step.agent.name, state: "done" };
        } catch (error) {
          failure ??= error;
          results[index] = { name: step.agent.name, state: "failed", code: error?.code };
        }
        report(steps.filter(item => item.done).length, steps.length);
      }
      await loadSettingsSections(app);
      if (failure) throw failure;
    } });
}

// Applying one agent changes what the next one's preview was read against, so each after the first is read again just before it is applied.
async function applyAgentStep(app, machine, step) {
  const { agent } = step;
  if (step.fresh && !step.retained) {
    step.preview = (await previewAgent(app.api, agent.id, { machine, mode: agent.mode, target: "cli", allowGit: false })).data;
    // Nothing left to write means an earlier attempt already did it.
    if (!reviewedChanges(step.preview).length) return;
    if (JSON.stringify(reviewedChanges(step.preview)) !== step.reviewed) throw new ApiError(409, "configuration_changed", "The reviewed configuration selection changed.");
  }
  const { preview } = step;
  try {
    await applyAgent(app.api, agent.id, { machine, previewId: preview.previewId, changeIds: preview.changes.filter(change => !change.optional).map(change => change.id), expectedRevision: preview.revision }, step.retained);
    step.retained = null;
  } catch (error) {
    // A write whose answer was lost is asked again with the same preview and key; a refusal reads the configuration again.
    step.retained = app.api.uncertain.has(error?.operation?.id) ? error.operation : null;
    if (!step.retained) step.fresh = true;
    throw error;
  }
}

function openLinkEditor(app, link, machine) {
  return settle(app, `editor:${link.clusterId}`, startText(app.language, "openEditor"), async record => {
    const result = await startApi.openClusterEditor(app.api, link.clusterId, machine, record.operation); return result;
  });
}

async function copyLinkPath(app, link) {
  try {
    await app.root.ownerDocument.defaultView.navigator.clipboard.writeText(link.localPath);
    showMapToast(app, text(app.language, "settingsPathCopied"), null, app.api.now() + 3000);
  } catch {
    showOutcome(app, text(app.language, "settingsPathNotCopied"), "settings_path_not_copied", "error", "settings");
  }
  renderShell(app);
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

// A new account: the person names it, ONEM1ND opens a terminal for that account's own sign-in and lists it.
function addSettingsAccount(app, client, name) {
  openChoiceForm(app, "settings-account", text(app.language, "accountAddTitle", { client: name }), form => {
    form.append(labeledField(form.ownerDocument, text(app.language, "accountName"), text(app.language, "accountAddHint"),
      element(form.ownerDocument, "input", { name: "label", maxlength: 40, autocomplete: "off", "aria-label": text(app.language, "accountName") })));
    form.problems = () => form.querySelector("[name='label']").value.trim() ? [] : [{ name: "label", message: text(app.language, "accountName") }];
  }, async form => {
    const label = form.querySelector("[name='label']").value.trim();
    await track(app, `settings-account-add:${client}`, text(app.language, "working"), async record => {
      await commitSettingsMutation(app, record, "POST", "/settings/accounts", { client, label });
      await loadSettingsSections(app); await loadStartReports(app);
    });
    return true;
  }, `settings-account-add-${client}`);
}

// Removing an account takes out ONEM1ND's entry only: the folder, the sign-in and the setup written there stay.
function removeSettingsAccount(app, client, account) {
  const dialog = showDialog(app.root.ownerDocument, {
    title: text(app.language, "accountRemoveTitle", { name: account.label }), body: text(app.language, "accountRemoveBody"),
    confirm: text(app.language, "accountRemove"), cancel: text(app.language, "cancel"), retry: text(app.language, "retry"),
    onConfirm: () => track(app, `settings-account-remove:${client}:${account.id}`, text(app.language, "working"), async record => {
      await commitSettingsMutation(app, record, "POST", "/settings/accounts/remove", { client, accountId: account.id, confirmed: true });
      await loadSettingsSections(app); await loadStartReports(app);
    }),
  });
  dialog.className += " settings-review";
  dialog.setAttribute("data-settings-account-remove", `${client}:${account.id}`);
  dialog.addEventListener("close", () => restoreInvoker(app, `settings-account-remove-${client}-${account.id}`));
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

function activityMessage(app, records) {
  const list = Array.isArray(records) ? records : [records];
  const record = list[0];
  const code = record?.error?.code;
  const known = Boolean(code && Object.hasOwn(ACTION_COPY, code));
  const cause = known ? `${actionText(app.language, code, { machine: record.error?.details?.machine ?? "" })} ` : "";
  if (list.length > 1) return text(app.language, "activityFailedMany", { count: list.length, cause });
  const action = String(record?.action || record?.label || "").replace(/[.\s]+$/, "");
  if (!action) return `${cause}${text(app.language, "actionFailed")}`.trim();
  return text(app.language, "activityFailed", { action, cause });
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

// A finished item stays in the corner this long, then only in the bell's list.
const QUEUE_DONE_SHOWN_MS = 4000;

function queueStateText(app, item) {
  if (item.state === 'running' && item.progress?.total) return text(app.language, 'queueProgress', { done: item.progress.done, total: item.progress.total });
  return text(app.language, { waiting: 'queueWaiting', running: 'queueRunning', done: 'queueDone', failed: 'queueFailed' }[item.state]);
}

function queueCard(app, item) {
  const document = app.root.ownerDocument;
  const card = element(document, 'div', { class: `queue-item is-${item.state}`, 'data-queue-item': item.id, 'data-queue-state': item.state, role: item.state === 'failed' ? 'alert' : 'status' },
    element(document, 'div', { class: 'queue-head' }, element(document, 'strong', { class: 'queue-label', text: item.label }), element(document, 'span', { class: 'queue-state', text: queueStateText(app, item) })));
  if (item.state === 'running' || item.state === 'waiting') {
    const total = item.progress?.total, done = item.progress?.done ?? 0;
    const fill = element(document, 'span', { class: 'queue-fill' });
    if (total) fill.style.width = `${Math.max(4, Math.round((done / total) * 100))}%`;
    card.append(element(document, 'div', { class: `queue-bar${total && item.state === 'running' ? '' : ' is-indeterminate'}${item.state === 'waiting' ? ' is-waiting' : ''}`, role: 'progressbar', 'aria-label': item.label,
      ...(total ? { 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) } : {}) }, fill));
  }
  // A job over several things says how each one went.
  if (item.results?.length) {
    card.append(element(document, 'ul', { class: 'queue-results' }, item.results.map(result => element(document, 'li', { class: `is-${result.state}`, 'data-queue-result': result.state },
      element(document, 'span', { text: result.name }),
      element(document, 'span', { text: result.state === 'failed' ? `${text(app.language, 'queueFailed')}: ${actionText(app.language, result.code)}`
        : text(app.language, result.state === 'done' ? 'queueDone' : 'queueWaiting') })))));
  }
  if (item.state === 'failed') {
    const partial = item.progress?.total > 1 ? `${text(app.language, 'queueProgress', { done: item.progress.done, total: item.progress.total })}. ` : '';
    card.append(element(document, 'p', { class: 'queue-error', text: partial + actionText(app.language, item.error?.code) }),
      element(document, 'div', { class: 'queue-actions' },
        element(document, 'button', { type: 'button', class: 'btn primary', 'data-action': 'queue-retry', text: text(app.language, 'retry'), onclick: () => app.queue.retry(item.id) }),
        element(document, 'button', { type: 'button', class: 'btn quiet', 'data-action': 'queue-dismiss', text: text(app.language, 'close'), onclick: () => app.queue.dismiss(item.id) })));
  }
  return card;
}

// The corner shows what runs, waits or failed, and what just finished; the bell opens the whole list.
function paintQueue(app, shell) {
  if (!app.queue || app.layout === 'phone') return;
  const document = app.root.ownerDocument, now = app.api.now();
  const items = app.queue.items;
  if (app.queuePanelOpen) {
    const panel = element(document, 'section', { class: 'queue-panel', 'data-queue-panel': 'true', role: 'dialog', 'aria-label': text(app.language, 'queueTitle') },
      element(document, 'header', { class: 'queue-panel-head' }, element(document, 'h2', { text: text(app.language, 'queueTitle') }),
        element(document, 'button', { type: 'button', class: 'btn quiet', 'data-action': 'close-queue', text: text(app.language, 'close'), onclick: () => { app.queuePanelOpen = false; renderShell(app); } })));
    if (!items.length) panel.append(element(document, 'p', { class: 'queue-empty', text: text(app.language, 'queueEmpty') }));
    for (const item of [...items].reverse()) panel.append(queueCard(app, item));
    if (items.some(item => ['done', 'failed'].includes(item.state))) panel.append(element(document, 'button', { type: 'button', class: 'btn ghost', 'data-action': 'queue-clear', text: text(app.language, 'queueClear'), onclick: () => app.queue.clearFinished() }));
    shell.append(panel);
    return;
  }
  const shown = items.filter(item => item.state !== 'done' || now - (item.endedAt ?? now) < QUEUE_DONE_SHOWN_MS);
  if (!shown.length) return;
  // A finished item leaves the corner on its own.
  const leaving = shown.filter(item => item.state === 'done').map(item => (item.endedAt ?? now) + QUEUE_DONE_SHOWN_MS - now);
  if (leaving.length) {
    clearTimeout(app.queueTimer);
    app.queueTimer = setTimeout(() => { if (!app.disposed) renderShell(app); }, Math.max(50, Math.min(...leaving) + 20));
    app.queueTimer.unref?.();
  }
  const stack = element(document, 'div', { class: 'queue-stack', 'data-queue-stack': 'true' });
  const visible = shown.slice(-3);
  for (const item of visible) stack.append(queueCard(app, item));
  if (shown.length > visible.length) stack.prepend(element(document, 'button', { type: 'button', class: 'btn quiet queue-more', 'data-action': 'open-queue',
    text: text(app.language, 'queueMore', { count: shown.length - visible.length }), onclick: () => { app.queuePanelOpen = true; renderShell(app); } }));
  shell.append(stack);
}

const SLOW_NOTICE_S = 5;

function deletionRunning(app) {
  return Boolean(app.queue?.items.some(item => item.state === 'running' && ['delete', 'undo'].includes(item.kind)));
}

const TRANSIENT_CODES = new Set(['timeout', 'service_unavailable', 'request_rate_limited', 'closed']);
function transientFailure(error) {
  return Boolean(error) && (TRANSIENT_CODES.has(String(error.code)) || error.name === 'TypeError' || (error.status === 0 && !error.code));
}
function serviceDown(app) {
  return Boolean(app.serviceStopped || app.recoveryError || ['connecting', 'reconnecting', 'error'].includes(app.store.stream?.state));
}
// When the live connection comes back, what failed because the service did not answer is asked again by itself.
function retryTransient(app) {
  // Only reads are asked again here; a write the service may have applied is replayed under its own identity by recheckTracked.
  for (const record of [...(app.activity?.values() ?? [])]) if (record.phase === 'error' && transientFailure(record.error) && !record.operation && !record.error?.operation) record.retry?.();
  if (app.startError && transientFailure(app.startError)) loadStartReports(app);
}

function paintActivity(app, shell) {
  const here = noteScope(app);
  const scoped = [...(app.activity?.values() ?? [])].filter((record) => (record.scope ?? here) === here);
  const records = activityNotices(scoped);
  // A request is only "taking longer than usual" once it really is: before SLOW_NOTICE_S the button's own loader says it is working.
  const pending = records.filter((record) => record.phase === "pending" && !quietActivity(record.key, scoped) && (Number(record.elapsed) || 0) >= (app.slowNoticeAfterS ?? SLOW_NOTICE_S));
  // While the service is unreachable its banner speaks for every request that failed for that reason; they are retried by
  // themselves when it answers again, instead of each asking for its own Retry.
  const failed = records.filter((record) => record.phase === "error" && !(serviceDown(app) && transientFailure(record.error)));
  if (!pending.length && !failed.length) return;
  const document = app.root.ownerDocument;
  const region = element(document, "div", { class: "activity", "data-activity-region": "true" });
  if (pending.length) shell.setAttribute("aria-busy", "true");
  // Several slow requests are one notice: it counts from the one waiting longest and Cancel stops them all.
  if (pending.length) {
    const lead = pending.reduce((first, record) => ((Number(record.elapsed) || 0) > (Number(first.elapsed) || 0) ? record : first), pending[0]);
    const copy = element(document, "div", {}, element(document, "strong", { text: sendText(app, "takingLonger") }));
    if ((Number(lead.elapsed) || 0) >= 1) copy.append(element(document, "p", { text: sendText(app, "waiting", { seconds: lead.elapsed }) }));
    const notice = element(document, "div", { class: "slow-notice", "data-activity": pending[0].key, "data-pending-count": String(pending.length) });
    notice.append(element(document, "span", { class: "spinner", "aria-hidden": "true" }), copy, element(document, "button", {
      type: "button", class: "btn ghost", "data-action": "cancel-activity", "data-activity": pending[0].key, text: text(app.language, "cancel"), onclick: () => { for (const record of pending) record.cancel?.(); },
    }));
    region.append(notice);
  }
  // One failure is one notice per cause with one Retry, however many requests failed the same way.
  const causes = new Map();
  for (const record of failed) {
    const cause = String(record.error?.code ?? "unknown");
    causes.set(cause, [...(causes.get(cause) ?? []), record]);
  }
  for (const group of causes.values()) {
    const notice = element(document, "div", { class: "notice notice-error", role: "alert", "data-activity-count": String(group.length) },
      element(document, "p", { "data-activity": group[0].key, text: activityMessage(app, group) }));
    notice.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "retry-activity",
      "data-activity": group[0].key,
      text: text(app.language, "retry"),
      onclick: () => Promise.all([...group.map((record) => record.retry?.()), ...(app.startError && String(app.startError.code ?? "unknown") === String(group[0].error?.code ?? "unknown") ? [loadStartReports(app)] : [])]),
    }));
    // A failure the person has seen can be closed; it never stays on screen over what is behind it.
    notice.append(element(document, "button", {
      type: "button",
      class: "btn quiet notice-close",
      "data-action": "dismiss-activity",
      "data-activity": group[0].key,
      "aria-label": text(app.language, "close"),
      title: text(app.language, "close"),
      text: "×",
      onclick: () => {
        for (const record of group) app.activity?.delete(record.key);
        if (!app.disposed) renderShell(app);
      },
    }));
    region.append(notice);
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
    element(document, "span", { class: "foot-read", text: t("lastRead", { time }) }),
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
  // A desktop window opened from the desktop icon that lost its session (a reload, for one) is not a phone: it is told how to
  // open the app again instead of being asked for a phone code.
  if (/^\/gui\/[^/]+/.test(String(app.api.location?.pathname ?? '')) && !app.api.homeKey) {
    const gate = element(document, 'section', { class: 'gate desktop-gate', 'data-desktop-signed-out': 'true' });
    document.title = `${t('desktopReopenTitle')} · ONEM1ND`;
    gate.append(element(document, 'div', { class: 'phone-gate-content' }, brand(document).querySelector('.mark'),
      element(document, 'h1', { text: t('desktopReopenTitle') }), element(document, 'p', { role: 'status', text: t('desktopReopenBody') })));
    app.root.replaceChildren(gate);
    releaseBootstrapAnnouncement(app);
    return;
  }
  const locked = app.phoneLockDeadline > app.api.now();
  const state = app.phoneEnded ? 'ended' : locked ? 'locked' : app.phoneError === 'phoneCodeMismatch' ? 'error' : 'pair';
  const gate = element(document, "section", { class: "gate phone-gate", "data-phone-state": state });
  gate.append(element(document, 'header', { class: 'phone-status' }, element(document, 'span', { text: formatClock(app.language, app.api.now()) }), 'ONEM1ND'));
  const content = element(document, 'div', { class: 'phone-gate-content', id: 'phone-gate-workspace', tabindex: '-1' });
  gate.append(element(document, 'a', { class: 'skip', href: '#phone-gate-workspace', text: t('skipToContent'), onclick: () => content.focus() }));
  if (state === 'locked' || state === 'ended') {
    const title = state === 'locked' ? 'phonePairingLocked' : 'phoneAccessEnded';
    const stateIcon = icon(document, 'alert');
    if (state === 'ended') stateIcon.querySelector('path').setAttribute('d', 'M3 9a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 15a5 5 0 0 1 6 0M12 18h.01');
    document.title = `${t(title)} · ONEM1ND`;
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
    document.title = `${t('phoneOpenMind')} · ONEM1ND`;
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

// Nothing listening answers at once with a refused connection; a service that is up answers anything, slowly or not.
async function probeServiceStopped(app, error) {
  if (error instanceof ApiError && error.code !== "timeout") return false;
  if (!(error instanceof ApiError)) return true;
  try {
    await app.api.fetch(`${app.api.location.origin}/`, { method: "HEAD", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(3000) });
    return false;
  } catch (probe) {
    return probe?.name !== "AbortError" && probe?.name !== "TimeoutError";
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
    app.bootStopped = false;
    probeServiceStopped(app, error).then((stopped) => {
      if (stopped && !app.disposed && app.bootFailed && app.bootError === error) { app.bootStopped = true; renderShell(app); }
    });
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
  return t(app.mode === "document" ? "voidMode" : app.mode);
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
  return element(document, "div", { class: "brand" }, svg, element(document, "span", { class: "brand-name", text: "ONEM1ND" }));
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
  import_unavailable: "moduleUnreadable",
  undo_expired: "libraryUndoExpired",
  invalid_lead: "invalidLead",
  machine_unavailable: "machineDown",
  note_required: "noteRequired",
  account_label_taken: "accountLabelTaken",
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
  stop_unavailable: "stopUnavailable",
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
  if (embeddedName(app.mode)) return "embedded";
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

// The machine an agent runs on, as the inspector last read it.
function agentMachine(app, agent) {
  return (app.inspectorData?.unitId === agent.id ? app.inspectorData.machines?.find((item) => item.id === agent.machine) : null)
    ?? app.store.view?.machines?.find((item) => item.id === agent.machine);
}

function actionControls(app, t, selected) {
  const document = app.root.ownerDocument;
  const row = element(document, "div", { class: "action-row" });
  const caps = app.store.capabilities ?? [];
  if (caps.includes('unit.create') && !overseerExists(app)) row.append(mapButton(app, 'create-overseer', startText(app.language, 'createOverseer'), () => createOverseer(app), { class: 'btn primary' }));
  // Where it runs is a choice that shows its current value; Start beside it is the action, so the two never read alike.
  if (selected && caps.includes('unit.create')) {
    const choice = runsInLabel(selected.runsIn, app.startAgents?.connectedClients, app.language, { brief: true }) || startText(app.language, 'runsInNone');
    row.append(mapButton(app, 'change-runs-in', choice, () => openUnitRunsIn(app, selected),
      { class: 'btn ghost runs-in-choice', title: startText(app.language, 'runsIn'), 'aria-label': `${startText(app.language, 'runsIn')}: ${choice}` }));
  }
  // Claude Code and Cursor are not confined: say whether this agent asks first or works automatically. Confined clients show nothing.
  if (selected && caps.includes('unit.create') && ['claude', 'cursor'].includes(selected.runsIn?.client) && (!app.startPermissions || app.startPermissionsStale) && !(Date.now() - (app.permissionsFailedAt ?? 0) < 30000)) refreshPermissions(app);
  if (selected && app.startPermissions && ['claude', 'cursor'].includes(selected.runsIn?.client)) {
    const automatic = Boolean(automaticGrant(app.startPermissions, selected));
    row.append(element(document, 'p', { class: 'native-mode', 'data-native-mode': automatic ? 'automatic' : 'supervised', text: startText(app.language, automatic ? 'automaticNotConfined' : 'asksFirst') }));
  }
  // Only the action that can happen shows: Start, Stop while a session runs, or a notice while the machine does not answer.
  const sessionId = selected?.sessionIds?.[0];
  if (selected && agentMachine(app, selected)?.answers === false) {
    row.append(element(document, "div", { class: "machine-notice", role: "status", "data-machine-notice": selected.machine }, icon(document, "alert"),
      element(document, "div", {}, element(document, "strong", { text: startText(app.language, "notAnswering", { machine: selected.machine }) }),
        element(document, "p", { text: startText(app.language, "notAnsweringBody", { agent: unitDisplayName(selected), machine: selected.machine }) }))));
  } else if (selected && sessionId && caps.includes("session.stop")) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "stop-session", "data-session": sessionId, text: t("stopSession"), onclick: () => confirmStop(app, sessionId, selected) }));
  } else if (selected && !sessionId && caps.includes("session.start")) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "start-session", text: t("startSession"), onclick: () => openSessionForm(app, selected) }));
  }
  if (selected && caps.includes("unit.create") && app.layout !== "phone") row.append(unitMenu(app, selected));
  for (const id of app.mapState?.layoutConflict?.ids ?? []) {
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "keep-local", text: t("keepLocal"), onclick: () => keepLocalPosition(app.mapState, id) }));
    row.append(element(document, "button", { type: "button", class: "btn", "data-action": "use-incoming", text: t("useIncoming"), onclick: () => useIncomingPosition(app.mapState, id) }));
  }
  return row;
}

function unitNameNode(document, unit) {
  const name = element(document, "span", { class: "unit-name" });
  if (unit.alias) name.append(element(document, "strong", { class: "unit-alias", text: unit.alias }));
  name.append(element(document, "span", { class: "unit-original", text: displayName(unit.unit) }));
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
      } else if (row.kind === "chat") {
        // The avatar, the name with the last message under it, and at the right the unread count or the time of that message.
        node.setAttribute("aria-label", row.text);
        const tail = row.unread
          ? element(document, "span", { class: "chat-unread", "aria-label": t("unreadCount", { count: row.unread }), text: row.unread })
          : element(document, "span", { class: "chat-when", text: row.when });
        node.replaceChildren(element(document, "span", { class: "chat-avatar", "aria-hidden": "true" }, icon(document, chatGlyph(app, row.chat))),
          element(document, "span", { class: "chat-text" }, element(document, "span", { class: "chat-title", text: row.title }), element(document, "span", { class: "chat-preview", text: row.preview })), tail);
      } else if (row.kind === "quiet") {
        node.setAttribute("aria-expanded", String(row.expanded));
        node.setAttribute("aria-label", row.text);
        node.replaceChildren(hierarchyDisclosure(document, row.expanded), element(document, "span", { class: "chat-title", text: row.count }), element(document, "span", { class: "chat-preview", text: row.preview }));
      } else if (row.kind === 'service') {
        // A service nobody set up yet reads like an agent row with a muted line under its name; the row sets it up.
        node.setAttribute('data-service-row', row.role);
        node.setAttribute('aria-label', `${row.text}, ${t('notSetUp')}`);
        if (!serviceSetupAllowed(app)) node.setAttribute('aria-disabled', 'true');
        const glyph = icon(document, row.glyph);
        glyph.style.gridColumn = '2';
        const title = element(document, 'span', { class: 'group-title' }, element(document, 'span', { class: 'unit-name' }, element(document, 'span', { class: 'unit-original', text: row.text })),
          element(document, 'span', { class: 'hierarchy-sub', text: t('notSetUp') }));
        title.style.gridColumn = '3';
        node.replaceChildren(glyph, title);
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
      } else if (row.kind === "heading") {
        // Every section heading of the Hierarchy and of Chats is this one element, so Clusters, Services, Pinned and Recent read alike.
        // It keeps the row's id and its place in the keyboard order, and the list's row height so the window still adds up.
        const heading = element(document, "div", { class: "my-groups-heading", "data-id": row.id, tabindex: app.activeList.focusId === row.id ? "0" : "-1" }, element(document, "span", { text: row.text }));
        heading.style.height = `${app.activeList.rowHeight}px`;
        if (row.id === "section:clusters") {
          heading.setAttribute("data-my-groups", "true");
          if (app.layout !== "phone" && app.store.capabilities.includes("chat.manage")) {
            const add = mapButton(app, 'new-cluster', startText(app.language, 'newCluster'), () => openStartCluster(app), { class: 'icon-button', 'aria-label': startText(app.language, 'newCluster'), title: startText(app.language, 'newCluster') });
            add.replaceChildren(folderIcon(document, true));
            heading.append(add);
          }
        }
        const focused = document.activeElement === node;
        if (host.insertBefore) host.insertBefore(heading, node);
        else { heading.parent = host; heading.parentNode = host; host.children.splice(host.children.indexOf(node), 0, heading); }
        node.remove();
        if (focused) heading.focus?.();
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

// A chat wears the glyph of what it talks to: an agent's, a cluster's, or the group's.
function chatGlyph(app, chat) {
  const group = app.store.indexes.groups.get(chat.id);
  if (group) return clusterGlyph(group.link?.kind);
  const unit = chat.kind === "direct" ? unitById(app, (chat.members ?? []).find((id) => id !== "root:master")) : null;
  return unit ? hierarchyIcon(unit) : "users";
}

// The Incubator and Genesis are set up with the same form as any new agent, so they need the same rights and a desktop window.
function serviceSetupAllowed(app) {
  return app.layout !== 'phone' && Boolean(app.store.capabilities?.includes('unit.create'));
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
    showMapToast(app, text(app.language, "aliasSaved", { unit: displayName(result.data.unit), alias: result.data.alias || displayName(result.data.unit) }), async (record) => {
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
  const dialog = showDialog(app.root.ownerDocument, {
    title: removalText(app, "title", unitDisplayName(unit)), body: removalText(app, "body"),
    confirm: removalText(app, "confirm"), cancel: text(app.language, "cancel"), retry: text(app.language, "retry"),
    // The dialog closes at once; the removal, with any session it has to stop first, runs in the background, in Activity.
    onConfirm: () => { enqueueDeletion(app, { units: [unit.id] }); },
  });
  dialog.setAttribute("data-remove-unit", unit.id);
  Object.assign(dialog.style, { width: "480px", maxWidth: "calc(100vw - 32px)", padding: "24px", borderRadius: "22px", background: "var(--panel)", border: "1px solid var(--line2)" });
  Object.assign(dialog.querySelector("h2").style, { fontSize: "18px", fontWeight: "700", margin: "0 0 18px" });
  Object.assign(dialog.querySelector("p").style, { fontSize: "13.5px", color: "var(--mute)", margin: "0 0 18px" });
  const buttons = dialog.querySelectorAll("button");
  for (const button of buttons) Object.assign(button.style, { minWidth: "32px", minHeight: "32px" });
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
  if (app.store.capabilities.includes("unit.create")) actions.append(mapButton(app, "delete-selection", text(app.language, "menuDeleteSelected", { count: units.length }), () => confirmDeleteMany(app, units.map((unit) => unit.id), []), { class: "btn danger" }));
  actions.append(mapButton(app, "clear-selection", t("clearSelection"), () => { app.mapState.selection.clear(); app.store.selected.unitId = null; app.thread = null; renderShell(app); }));
  panel.append(actions, element(document, "p", { class: "field-hint", text: t("finalGroupHint") }));
  return panel;
}

// The inspector of a pick: what was picked, and what can be done with all of it at once.
function pickInspector(app, t, { units, clusters }) {
  const document = app.root.ownerDocument, caps = app.store.capabilities ?? [], count = units.length + clusters.length;
  const agents = units.map(id => unitById(app, id)), groups = clusters.map(id => app.store.indexes.groups.get(id));
  const agentsIn = group => {
    const held = (app.unitList?.catalog ?? []).filter(unit => !unit.removed && unit.role !== 'master' && (unit.clusterId === group.id || !unit.clusterId && group.members.includes(unit.id))).length;
    return held === 0 ? t('pickNoAgents') : held === 1 ? t('deleteManyAgent') : t('deleteManyAgents', { count: held });
  };
  const parents = new Set(groups.map(group => group.parentId ?? null)), parent = parents.size === 1 ? app.store.indexes.groups.get([...parents][0]) : null;
  const kind = !groups.length ? t('pickKindAgents') : agents.length ? t('pickKindMixed')
    : groups.every(group => group.link?.kind === 'repository') ? parent ? t('pickKindRepositoriesIn', { name: displayName(parent.title) }) : t('pickKindRepositories') : t('pickKindClusters');
  const clear = () => { app.hierarchySelection.clear(); renderShell(app); };
  const item = (glyph, name, note) => element(document, 'div', { class: 'pick-item', 'data-pick-item': name },
    icon(document, glyph), element(document, 'strong', { text: name }), element(document, 'span', { class: 'pick-note', text: note }));
  const card = element(document, 'div', { class: 'pick-card' },
    ...groups.map(group => item(clusterGlyph(group.link?.kind), displayName(group.title), agentsIn(group))),
    ...agents.map(unit => item(hierarchyIcon(unit), unitDisplayName(unit), roleLabel(app.language, unit.role, unit.roleName))));
  const actions = element(document, 'div', { class: 'pick-actions' });
  if (agents.length && caps.includes('chat.manage')) actions.append(element(document, 'button', { type: 'button', class: 'btn primary', 'data-action': 'pick-message',
    onclick: () => { const ids = agents.map(unit => unit.id); app.hierarchySelection.clear(); ensureMap(app).onGroupMessage(ids); } }, icon(document, 'users'), t('pickMessageGroup')));
  if (!groups.length && caps.includes('chat.manage')) actions.append(element(document, 'button', { type: 'button', class: 'btn', 'data-action': 'pick-move',
    onclick: () => openMoveAgents(app, agents) }, icon(document, 'folder'), t('pickMove')));
  actions.append(element(document, 'button', { type: 'button', class: 'btn danger', 'data-action': 'pick-delete', text: t('pickDelete', { count }),
    onclick: () => confirmDeleteMany(app, units, clusters) }));
  return element(document, 'section', { class: 'pick-inspector', 'data-pick-inspector': String(count) },
    element(document, 'header', { class: 'agent-heading' }, element(document, 'span', { class: 'agent-avatar', 'aria-hidden': 'true' }, icon(document, 'users')),
      element(document, 'div', {}, element(document, 'h2', { text: t('finalSelection', { count }) }), element(document, 'p', { class: 'agent-status', text: kind })),
      element(document, 'button', { type: 'button', class: 'icon-button', 'data-action': 'clear-pick', 'aria-label': t('clearSelection'), title: t('clearSelection'), onclick: clear }, icon(document, 'close'))),
    card, actions);
}

function chooseSelectionLead(app, picked = null, point = null) {
  const ids = (picked ?? [...app.mapState.selection]).filter((id) => unitById(app, id)?.role !== "master");
  const choices = leadChoices(app).filter((unit) => !ids.includes(unit.id) && unit.role !== "master");
  if (!ids.length) return;
  // With nothing to connect to, an empty list is never shown: one agent gets the menu that creates a report for it, and a
  // selection is told why there is no lead.
  if (!choices.length) {
    if (ids.length === 1 && app.store.capabilities?.includes("unit.create")) {
      const box = app.root.ownerDocument.querySelector?.(`[data-unit-id="${ids[0]}"]`)?.getBoundingClientRect?.();
      openReportMenu(app, { source: ids[0], x: point?.x ?? (box ? box.left + box.width / 2 : 0), y: point?.y ?? (box ? box.bottom : 0), groupId: null });
      return;
    }
    const names = ids.map((id) => unitDisplayName(unitById(app, id) ?? { unit: id })).join(", ");
    const dialog = showDialog(app.root.ownerDocument, { title: startText(app.language, "noLeadTitle"), body: startText(app.language, "noLeadBody", { name: names }), cancel: text(app.language, "close") });
    dialog.setAttribute("data-form", "no-lead");
    return;
  }
  let leadId;
  openChoiceForm(app, "selection-lead", text(app.language, "connectToLead"), (form) => {
    appendSelect(form.ownerDocument, form, "leadId", text(app.language, "finalReportsTo"), choices.map((unit) => ({ value: unit.id, label: unitDisplayName(unit) })), choices[0].id);
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
  app.waitingOpen = false;
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
    const document = form.ownerDocument, label = runsInLabel(unit.runsIn, app.startAgents?.connectedClients, app.language);
    // Where it runs is a row of its own: the choice made so far, or the plain fact that none is made, with the way to make it.
    const where = element(document, 'div', { class: 'start-where', 'data-start-where': label ? 'chosen' : 'none' },
      element(document, 'span', { class: 'start-where-label', text: startText(app.language, 'runsIn') }),
      element(document, 'strong', { class: 'start-where-value', text: label || startText(app.language, 'runsInNone') }));
    form.append(where);
    if (!unit.runsIn) {
      const reason = element(document, 'p', { id: 'reason-start-runs-in', class: 'field-hint', 'data-disabled-reason': 'runs-in', text: startText(app.language, 'startNeedsRunsIn') });
      where.append(reason, mapButton(app, 'choose-runs-in', startText(app.language, 'chooseRunsIn'), () => { form.closest('dialog')?.close(); return openUnitRunsIn(app, unit); }));
      confirm.disabled = true; confirm.setAttribute('aria-describedby', 'reason-start-runs-in'); confirm.title = startText(app.language, 'startNeedsRunsIn');
    }
    const modes = element(document, 'fieldset', { class: 'start-modes' }, element(document, 'legend', { text: text(app.language, 'runsAs') }));
    for (const [value, key] of [['task', 'runTask'], ['chat', 'runChat']]) {
      const input = element(document, 'input', { type: 'radio', name: 'runMode', value });
      input.value = value; input.checked = value === (unit.role === 'executor' ? 'task' : 'chat');
      modes.append(element(document, 'label', { class: 'start-mode' }, input, element(document, 'span', { text: text(app.language, key) })));
    }
    form.append(modes);
    appendInput(document, form, 'prompt', text(app.language, 'taskOrMessage'), '');
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
    if (!["selection-lead", "library-create", "library-folder", "library-move", "settings-find", "settings-account"].includes(kind)) return;
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
  // Loading the inspector checks the tracked request again; acting only on a change keeps that check from reloading the
  // inspector, which checked again, without end.
  const previous = app.sessionRequest && app.sessionRequest.requestId === data.requestId ? app.sessionRequest.state : null;
  if (data.requestId) app.sessionRequestId = data.requestId;
  app.sessionRequest = data;
  if (previous === state) return;
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

function frameAgentTabs(app, panel, subject) {
  const document = app.root.ownerDocument;
  const sessionView = sessionViewFor(app, sessionForUnit(app, subject.id));
  const agentTabs = sessionView ?? unitConversation(app, subject.id);
  agentTabs.detailsTab = app.layout !== 'phone';
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
    element(document, "h2", { class: "chat-title", "data-chat-title": thread.chat.id, text: displayName(thread.chat.title) || thread.chat.id }),
  );
  const group = app.store.indexes.groups.get(thread.chat.id);
  const directUnit = thread.chat.kind === "direct" ? unitById(app, members.find((id) => id !== "root:master")) : null;
  const subject = inspectorAgent(app) ?? (directUnit && app.layout !== 'phone' ? directUnit : null);
  const sessionView = subject ? sessionViewFor(app, sessionForUnit(app, subject.id)) : null;
  const agentTabs = subject ? (sessionView ?? unitConversation(app, subject.id)) : null;
  if (agentTabs) agentTabs.detailsTab = app.layout !== 'phone';
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
    // An empty list is only "no messages" once the messages were read; while they load, or when reading failed, it says so.
    const reading = app.activity?.get(`chat-load:${thread.chat.id}`);
    if (reading?.phase === "pending") transcript.append(skeletonMark(document, t("loadingConversation"), "chat", { "data-loading": "chat" }));
    else if (reading?.phase === "error") transcript.append(element(document, "p", { "data-empty": "unread", text: t("chatNotRead") }));
    else {
      const canPost = (app.store.capabilities ?? []).includes("chat.post");
      // An agent's empty chat says what happens to a first message; a cluster or a group keeps its own line.
      if (canPost && agentTabs) transcript.append(element(document, "div", { class: "empty-chat", "data-empty": "chat" }, icon(document, "chats"),
        element(document, "strong", { text: t("noMessagesTitle") }), element(document, "p", { text: t("noMessagesHint") })));
      else transcript.append(element(document, "p", { "data-empty": "chat", text: t(canPost ? "emptyChat" : "emptyChatRead") }));
    }
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
        style: "font-size:12px;font-weight:700;min-height:32px",
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
  // An agent's conversation keeps Pin and Remove from the list in its ··· menu, not between the messages and the composer.
  if (caps.includes("chat.manage") && !group && !agentTabs) {
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
    // Enter sends, as in any chat; a composition in progress (an accent or an IME) is left to finish first.
    composer.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault?.();
      submitComposer(app, composer);
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
    const name = group ? t("messageTheGroup") : directUnit ? t("messageUnit", { unit: directUnit.alias || displayName(directUnit.unit) }) : t("composerLabel");
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
  return "";
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
  navigate(app, action.kind === "text" ? "document" : "blueprint");
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
  const name = t("messageUnit", { unit: unit.alias || displayName(unit.unit) });
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
    const where = checkoutFacts(t, app.language, { session: checkout, local: startMachine(app), entry: checkout && app.checkouts?.get(checkout.id), root: selected.scope?.kind === "root" });
    const catalog = (app.startAgents?.connectedClients ?? []).find((item) => item.id === selected.runsIn?.client);
    const model = selected.model ? catalogLabel(catalog?.models?.find((item) => item.id === selected.model)?.title, selected.model, app.language) : t("finalDefaultModel");
    // The Overseer reports to no one, so its facts carry no such line.
    const reportsTo = selected.role === "overseer" ? [] : [["finalReportsTo", selected.leadId ? unitDisplayName(unitById(app, selected.leadId)) : t("finalNoLead")]];
    for (const [key, value, title] of [["machine", selected.machine], ["finalRunsIn", runs], ...where, ["model", model], ...reportsTo]) facts.append(element(document, "p", { text: `${t(key)}: ${value ?? t("unknown")}`, ...(title ? { title } : {}) }));
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
      panel.append(skeletonMark(document, t("loadingDetails", { name: displayName(selected.unit || selected.id) }), "details", { "data-inspector-progress": selected.id }));
    }
    return panel;
  }
  const details = trackDisclosure(app, element(document, "details", { class: "inspector-details" }), keepId("inspector", selected?.id));
  details.append(element(document, "summary", { text: t("details") }));
  const machine = (data.machines ?? []).find((item) => item.id === selected?.machine);
  if (machine) details.append(renderMachine(document, machine, t));
  // Only the latest session is listed, the running one first, so old sessions do not pile up here.
  const latest = (list) => list.slice().sort((left, right) => String(right.registeredAt ?? "").localeCompare(String(left.registeredAt ?? ""))).slice(0, 1);
  const running = (data.sessions ?? []).filter((session) => session.state !== "stopped");
  const listed = latest(running.length ? running : data.sessions ?? []);
  for (const session of listed) details.append(renderSession(document, session, t));
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
