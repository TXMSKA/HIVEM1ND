import { element, icon } from "./components.mjs";

const APP_URLS = { blueprint: "https://blueprint.txmska.com/files", void: "https://void.txmska.com/" };
const COLOR_ROLES = ["bg", "ground", "panel", "card", "card2", "text", "body", "mute", "accent", "accent-ink", "ring", "working", "waiting", "error", "error-soft", "idle", "line", "line2", "edge"];

export function embeddedName(mode) {
  return mode === "blueprint" ? "blueprint" : mode === "document" ? "void" : null;
}

function hostOf(app) {
  return app.embeddedHost ?? app.root.ownerDocument.defaultView?.hivem1nd;
}

export function openBrowserApp(app, mode) {
  const name = embeddedName(mode);
  if (!name || app.layout !== "phone" && typeof hostOf(app)?.embeddedUpdate === "function") return false;
  (app.openExternalApp ?? ((url) => app.root.ownerDocument.defaultView?.open?.(url, "_blank", "noopener,noreferrer")))(APP_URLS[name]);
  return true;
}

export function renderEmbeddedApp(app, t) {
  const name = embeddedName(app.mode);
  const state = app.embeddedStatus?.[name] ?? "loading";
  const message = element(app.root.ownerDocument, "div", { class: "embedded-message", "data-embedded-app": name, "data-embedded-state": state, role: "status" },
    icon(app.root.ownerDocument, name === "void" ? "document" : "blueprint"),
    element(app.root.ownerDocument, "h2", { text: name === "void" ? "Void" : "Blueprint" }),
    element(app.root.ownerDocument, "p", { text: t(state === "unavailable" ? "embeddedAppUnavailable" : "embeddedAppLoading", { app: name === "void" ? "Void" : "Blueprint" }) }));
  if (state === "unavailable") message.append(element(app.root.ownerDocument, "button", { type: "button", class: "btn", "data-action": "retry-embedded-app", text: t("retry"),
    onclick: () => { if (app.embeddedView) app.embeddedView.signature = null; syncEmbeddedApp(app); } }));
  return message;
}

export function embeddedTokens(document) {
  const style = document.defaultView?.getComputedStyle?.(document.documentElement);
  const roles = Object.fromEntries(COLOR_ROLES.map(name => [name, style?.getPropertyValue(`--${name}`).trim() ?? ""]).filter(([, value]) => value));
  return { ...roles, background: roles.bg, surface: roles.panel, surfaceRaised: roles.card, textSecondary: roles.body,
    muted: roles.mute, border: roles.line2, accentForeground: roles["accent-ink"], danger: roles.error };
}

export function syncEmbeddedApp(app) {
  const host = hostOf(app);
  if (typeof host?.embeddedUpdate !== "function") return;
  const document = app.root.ownerDocument;
  const view = document.defaultView;
  const stage = app.disposed ? null : app.root.querySelector?.("[data-embedded-stage]");
  const state = app.embeddedView ??= {};
  if (state.stage !== stage) {
    state.resize?.disconnect();
    state.stage = stage;
    if (stage && typeof view?.ResizeObserver === "function") {
      state.resize = new view.ResizeObserver(() => syncEmbeddedApp(app));
      state.resize.observe(stage);
    }
  }
  const covered = document.querySelector?.("dialog[open], [data-context-menu], [data-phone-panel], [data-queue-panel], [data-service-banner], [data-overlay=\"true\"]");
  const rect = stage?.getBoundingClientRect?.();
  const visible = !app.disposed && !app.bootReading && !app.bootFailed && app.layout !== "phone" && app.api.token && !document.hidden && !covered && rect?.width > 0 && rect?.height > 0;
  const bounds = rect ? { x: Math.ceil(rect.left), y: Math.ceil(rect.top), width: Math.max(0, Math.floor(rect.right ?? rect.left + rect.width) - Math.ceil(rect.left)),
    height: Math.max(0, Math.floor(rect.bottom ?? rect.top + rect.height) - Math.ceil(rect.top)) } : { x: 0, y: 0, width: 0, height: 0 };
  const groups = [...(app.store.indexes?.groups?.values() ?? [])].filter(group => !group.deleted);
  const unitId = app.store.selected?.unitId;
  const unit = app.store.indexes?.units?.get(unitId) ?? app.unitList?.catalog?.find(item => item.id === unitId);
  const group = groups.find(item => item.id === app.store.selected?.groupId)
    ?? (unit ? groups.find(item => item.id === unit.clusterId) ?? groups.find(item => item.members?.includes(unit.id)) : null);
  const project = group?.link?.kind === "repository" ? group.link.projectId : null;
  const payload = { app: visible ? embeddedName(app.mode) : null, bounds, locale: app.language, tokens: embeddedTokens(document), token: app.api.token,
    ...(project ? { project } : {}) };
  const signature = JSON.stringify(payload);
  if (signature === state.signature) return;
  state.signature = signature;
  Promise.resolve(host.embeddedUpdate(payload)).catch(() => { state.signature = null; });
}

export function startEmbeddedApps(app, repaint) {
  const host = hostOf(app);
  if (typeof host?.embeddedUpdate !== "function") return;
  const document = app.root.ownerDocument;
  const view = document.defaultView;
  const state = app.embeddedView ??= {};
  state.update = () => syncEmbeddedApp(app);
  view?.addEventListener?.("resize", state.update);
  document.addEventListener?.("visibilitychange", state.update);
  if (typeof view?.MutationObserver === "function") {
    state.mutations = new view.MutationObserver(state.update);
    state.mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "hidden"] });
  }
  state.unsubscribe = host.onEmbeddedStatus?.(status => {
    if (app.disposed || !Object.hasOwn(APP_URLS, status?.app) || !["loading", "ready", "unavailable"].includes(status.state)) return;
    app.embeddedStatus ??= {};
    if (app.embeddedStatus[status.app] === status.state) return;
    app.embeddedStatus[status.app] = status.state;
    if (embeddedName(app.mode) === status.app) repaint();
  });
}

export function forwardEmbeddedEvent(app, event) {
  if (event?.name === "app.bridge") hostOf(app)?.embeddedEvent?.(event);
}

export function disposeEmbeddedApps(app) {
  const state = app.embeddedView;
  state?.resize?.disconnect();
  state?.mutations?.disconnect();
  state?.unsubscribe?.();
  const document = app.root.ownerDocument;
  document.defaultView?.removeEventListener?.("resize", state?.update);
  document.removeEventListener?.("visibilitychange", state?.update);
  syncEmbeddedApp(app);
}
