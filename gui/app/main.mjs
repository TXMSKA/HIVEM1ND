import { createApi, dispose as disposeApi, request } from "./api.mjs";
import { announce, element, icon, showError } from "./components.mjs";
import { text } from "./i18n.mjs";
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
      element(document, "span", { text: t("unitCount", { count: counts.units ?? 0 }) }),
      element(document, "span", { text: t("unreadCount", { count: counts.unread ?? 0 }) }),
      element(document, "span", { text: t("issueCount", { count: counts.issues ?? 0 }) }),
    ),
    element(document, "p", { text: t("later") }),
  );
  const issues = element(document, "section", { class: "summary" }, element(document, "h2", { text: t("issuesTitle") }));
  for (const issue of view?.issues ?? []) issues.append(element(document, "p", { class: "issue", text: issue.message }));
  if (!view?.issues?.length) issues.append(element(document, "p", { text: t("emptyList") }));
  const side = element(document, "aside", { class: "panel side" }, tabs, summary, issues);
  const stage = element(document, "section", { class: "panel stage" },
    element(document, "h2", { text: t(app.mode) }),
    element(document, "p", { text: app.store.mode === "paged" ? t("viewTooLarge") : t("later") }),
  );
  const inspector = element(document, "aside", {
    class: `panel inspector${app.inspectorOpen ? " is-open" : ""}`,
  }, element(document, "div", { class: "inspector-body" },
    element(document, "h2", { text: t("emptyInspector") }),
  ));
  return element(document, "div", { class: "workspace" }, side, stage, inspector);
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

if (typeof document !== "undefined") {
  const root = document.querySelector("#app");
  if (root) {
    const appPromise = mount(root);
    window.addEventListener("pagehide", async () => dispose(await appPromise));
  }
}
