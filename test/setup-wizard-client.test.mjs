import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const failedStep = {
  id: "service",
  number: 4,
  language: "en",
  title: "Starting the local service",
  description: "The service did not start.",
  action: "Retry",
  back: true,
  busy: false,
  failure: { headline: "The service did not start", body: "The port is in use." },
  progress: [{ id: "service", state: "fail", label: "Service", elapsedSeconds: 1 }],
  ui: {
    documentTitle: "HIVEM1ND setup",
    stepOfFour: "Step {step} of 4",
    step1Title: "Install",
    step2Title: "Location",
    step3Title: "Service",
    step4Title: "Ready",
    back: "Back",
    progressFail: "Failed",
    progressDone: "Done",
    progressTodo: "Waiting",
    progressActive: "Working",
  },
};

test("a failed setup install clears the Retry spinner", async () => {
  const document = createWizardDocument();
  const session = new Map([["hivem1nd.session", "test-token"]]);
  const source = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const start = new AsyncFunction("document", "location", "sessionStorage", "history", "fetch", "window", "CSS", "setTimeout", source);
  await start(
    document,
    { hash: "#session=test-token", assign() {} },
    { getItem: (key) => session.get(key) ?? null, setItem: (key, value) => session.set(key, String(value)) },
    { replaceState() {} },
    async (url) => {
      if (String(url).endsWith("/install")) return { ok: false, status: 500, json: async () => ({ error: { message: "The service did not start." } }) };
      return { ok: true, status: 200, json: async () => ({ data: failedStep }) };
    },
    {},
    { escape: (value) => String(value) },
    (fn) => setTimeout(fn, 0),
  );
  const button = document.getElementById("continue-button");
  assert.equal(button.textContent, "Retry");
  await document.getElementById("step-form").listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(button.textContent, "Retry");
  assert.equal(button.querySelector(".button-spinner"), null);
  assert.equal(button.disabled, false);
  assert.equal(document.getElementById("step-form").getAttribute("aria-busy"), "false");
  // The step's own failure notice explains the stop; the raw request error is not shown above it.
  assert.equal(document.getElementById("status-message").hidden, true);
  assert.equal(document.getElementById("status-message").textContent, "");
});

test("the 2.x sessions to close start folded under their count", async () => {
  const document = createWizardDocument();
  const session = new Map([["hivem1nd.session", "test-token"]]);
  const sessions = Array.from({ length: 30 }, (_, index) => ({ unit: `executor-${index}`, client: "codex", machine: "MOTHERSHIP", local: true }));
  const step = { ...failedStep, id: "location", number: 2, failure: null, progress: [], fields: [{ id: "mindPath", type: "text", label: "Folder", required: true }],
    values: { mindPath: "C:/M1ND" }, languages: [{ value: "en", label: "English" }], relayPlus: { title: "Relay+", badge: "Soon", body: "", disabled: true },
    legacy: { confirmation: true, closeTitle: "Close HIVEM1ND 2.x first", closeCopy: "Close them.", action: "Sessions closed, migrate", offline: "", sessions },
    ui: { ...failedStep.ui, onMachine: "{client} on {machine}", legacySessionsOne: "1 open 2.x session", legacySessionsOther: "{count} open 2.x sessions", cancel: "Cancel" } };
  const source = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const start = new AsyncFunction("document", "location", "sessionStorage", "history", "fetch", "window", "CSS", "setTimeout", source);
  await start(document, { hash: "#session=test-token", assign() {} },
    { getItem: (key) => session.get(key) ?? null, setItem: (key, value) => session.set(key, String(value)) }, { replaceState() {} },
    async () => ({ ok: true, status: 200, json: async () => ({ data: step }) }), {}, { escape: (value) => String(value) }, (fn) => setTimeout(fn, 0));
  const fold = document.getElementById("legacy-sessions");
  assert.ok(fold, `dialog ${document.getElementById("mode-dialog").open}, message ${document.getElementById("status-message").textContent}`);
  assert.equal(fold.tag, "details");
  assert.equal(fold.open, false);
  assert.equal(fold.querySelector("summary").textContent, "30 open 2.x sessions");
  assert.equal(fold.querySelectorAll(".legacy-session").length, 30);
});

const locationStep = {
  ...failedStep, id: "location", number: 2, failure: null, progress: [], action: "Continue",
  fields: [{ id: "mindPath", type: "text", label: "Folder", required: true }],
  values: { mindPath: "C:/M1ND", migrateLegacy: true },
  languages: [{ value: "en", label: "English" }],
  relayPlus: { title: "Use Relay+", badge: "Coming soon", body: "Sync your preferences.", disabled: true },
  legacy: { confirmation: false, title: "Migrate legacy M1ND", body: "Found.", sessions: [] },
  ui: { ...failedStep.ui, browse: "Browse", browseUnavailable: "No picker here." },
};

// Starts the wizard client on a step; each API path answers from `routes`, and a route may return a promise to hold the request.
async function openWizard(step, routes, hivem1nd) {
  const document = createWizardDocument();
  const session = new Map([["hivem1nd.session", "test-token"]]);
  const calls = [];
  const source = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const start = new AsyncFunction("document", "location", "sessionStorage", "history", "fetch", "window", "CSS", "setTimeout", source);
  await start(document, { hash: "#session=test-token", assign() {} },
    { getItem: (key) => session.get(key) ?? null, setItem: (key, value) => session.set(key, String(value)) }, { replaceState() {} },
    async (url, options = {}) => {
      const route = String(url).split("/api/v1/")[1];
      calls.push({ route, body: options.body ? JSON.parse(options.body) : undefined });
      const handler = routes[route];
      const reply = handler ? await handler(options) : { data: step };
      return { ok: reply.error === undefined, status: reply.error ? 501 : 200, json: async () => reply };
    }, { hivem1nd }, { escape: (value) => String(value) }, (fn) => setTimeout(fn, 0));
  return { document, calls };
}
const spinnerIn = (node) => node.querySelector(".button-spinner");

test("Browse replaces Change, asks the local server for a folder and shows a loader while it waits", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const { document, calls } = await openWizard(locationStep, {
    browse: async () => { await held; return { data: { path: "C:/chosen" } }; },
    answer: async () => ({ data: { ...locationStep, values: { ...locationStep.values, mindPath: "C:/chosen" } } }),
  });
  assert.equal(document.getElementById("change-folder"), null);
  const browse = document.getElementById("browse-folder");
  assert.equal(browse.textContent, "Browse");
  assert.equal(spinnerIn(browse), null);
  const click = browse.listeners.get("click")[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(spinnerIn(browse), "the Browse button shows a loader while the picker is open");
  assert.equal(browse.disabled, true);
  assert.equal(document.getElementById("continue-button").disabled, true);
  release();
  await click;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls.filter((call) => call.route === "browse").map((call) => call.body), [{}]);
  assert.deepEqual(calls.find((call) => call.route === "answer").body, { values: { mindPath: "C:/chosen", changeFolder: true } });
  assert.equal(document.getElementById("mind-path").value, "C:/chosen");
  assert.equal(spinnerIn(document.getElementById("browse-folder")), null);
  assert.equal(document.getElementById("browse-folder").disabled, false);
});

test("Browse uses the Electron dialog when the app provides one and keeps the path editable when no picker exists", async () => {
  const chosen = [];
  const electron = await openWizard(locationStep, { answer: async (options) => { chosen.push(JSON.parse(options.body).values.mindPath); return { data: locationStep }; } },
    { browseFolder: async () => "C:/native" });
  await electron.document.getElementById("browse-folder").listeners.get("click")[0]();
  assert.deepEqual(chosen, ["C:/native"]);
  assert.equal(electron.calls.some((call) => call.route === "browse"), false);

  const plain = await openWizard(locationStep, { browse: async () => ({ error: { message: "No picker here." } }) });
  await plain.document.getElementById("browse-folder").listeners.get("click")[0]();
  assert.equal(plain.document.getElementById("status-message").textContent, "No picker here.");
  assert.equal(plain.document.getElementById("mind-path").value, "C:/M1ND", "the typed path stays");
  assert.equal(spinnerIn(plain.document.getElementById("browse-folder")), null);
  assert.equal(plain.document.getElementById("mind-path").disabled, false);
});

test("Continue and Back show a loader while their request runs, including Continue with the Migrate option", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const { document } = await openWizard(locationStep, { answer: async () => { await held; return { data: { ...locationStep, id: "service", number: 3, progress: [], failure: { headline: "x", body: "y" } } }; },
    back: async () => { await held; return { data: locationStep }; } });
  const continueButton = document.getElementById("continue-button");
  assert.equal(spinnerIn(continueButton), null);
  const submit = document.getElementById("step-form").listeners.get("submit")[0]({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(spinnerIn(continueButton), "Continue shows a loader on the step with the Migrate option");
  assert.equal(continueButton.textContent, "Continue");
  assert.equal(document.getElementById("back-button").disabled, true);
  release();
  await submit;
  assert.equal(spinnerIn(document.getElementById("continue-button")), null);

  let releaseBack;
  const heldBack = new Promise((resolve) => { releaseBack = resolve; });
  const back = await openWizard({ ...locationStep, back: true }, { back: async () => { await heldBack; return { data: locationStep }; } });
  const backButton = back.document.getElementById("back-button");
  assert.equal(spinnerIn(backButton), null);
  const pending = backButton.listeners.get("click")[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(spinnerIn(backButton), "Back shows a loader while it runs");
  releaseBack();
  await pending;
  assert.equal(spinnerIn(back.document.getElementById("back-button")), null);
});

test("the Relay+ offer reads as unavailable: disabled, marked Coming soon, and never checked", async () => {
  const { document } = await openWizard(locationStep, {});
  const offer = document.querySelectorAll(".relay-plus")[0];
  assert.ok(offer, "the Relay+ offer is marked");
  assert.equal(offer.getAttribute("aria-disabled"), "true");
  const checkbox = offer.querySelector("input");
  assert.equal(checkbox.disabled, true);
  assert.equal(checkbox.checked, false);
  assert.equal(offer.querySelector(".offer-badge").textContent, "Coming soon");
  const migrate = document.getElementById("migrate-legacy");
  assert.equal(migrate.disabled, false);
  assert.equal(migrate.parent.className.includes("relay-plus"), false);
});

test("on Windows the install step offers the desktop shortcut, ticked, and its value goes with the setup request", async () => {
  const shortcutStep = { ...locationStep, fields: [...locationStep.fields, { id: "desktopShortcut", type: "boolean", label: "Add a shortcut to the desktop", required: false }],
    values: { ...locationStep.values, desktopShortcut: true }, shortcut: { title: "Add a shortcut to the desktop" } };
  const answers = [];
  const { document, calls } = await openWizard(shortcutStep, { answer: async (options) => { answers.push(JSON.parse(options.body).values); return { data: shortcutStep }; },
    browse: async () => ({ data: { path: "C:/chosen" } }) });
  const checkbox = document.getElementById("desktop-shortcut");
  assert.ok(checkbox, "the box is on the step");
  assert.equal(checkbox.type, "checkbox");
  assert.equal(checkbox.checked, true, "ticked by default");
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.parent.className, "setup-offer", "it uses the markup of the other offers");
  assert.equal(checkbox.parent.querySelector("strong").textContent, "Add a shortcut to the desktop");
  assert.equal(checkbox.parent.querySelector(".offer-body"), null);
  const submit = () => document.getElementById("step-form").listeners.get("submit")[0]({ preventDefault() {} });
  await submit();
  document.getElementById("desktop-shortcut").checked = false;
  await submit();
  document.getElementById("desktop-shortcut").checked = false;
  // A new folder redraws the step, so the choice travels with that request too.
  await document.getElementById("browse-folder").listeners.get("click")[0]();
  assert.deepEqual(answers.map((values) => values.desktopShortcut), [true, false, false]);
  assert.equal(answers[2].changeFolder, true);
  assert.equal(calls.filter((call) => call.route === "answer").length, 3);

  const elsewhere = await openWizard(locationStep, { answer: async (options) => { answers.push(JSON.parse(options.body).values); return { data: locationStep }; } });
  assert.equal(elsewhere.document.getElementById("desktop-shortcut"), null, "the step offers no shortcut where setup makes none");
  await elsewhere.document.getElementById("step-form").listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(Object.hasOwn(answers.at(-1), "desktopShortcut"), false);
});

test("the starting step shows a progress bar and a sentence while the first sync runs", async () => {
  const service = { ...locationStep, id: "service", number: 3, preview: { conflicts: [] }, fields: [],
    failure: { headline: "Paused", body: "Retry." },
    progress: [{ id: "registration", state: "done", label: "Registered", elapsedSeconds: 1 },
      { id: "start", state: "busy", label: "Starting the service", elapsedSeconds: 42,
        sync: { phase: "staging", done: 5, total: 10, detail: "Preparing files for synchronization: 5 of about 10." } }] };
  const { document } = await openWizard(service, {});
  const [bar] = document.querySelectorAll(".sync-bar");
  assert.equal(bar.max, 10);
  assert.equal(bar.value, 5);
  assert.equal(document.querySelector(".sync-detail").textContent, "Preparing files for synchronization: 5 of about 10.");
  assert.equal(document.querySelectorAll(".sync-bar").length, 1, "only the running row has a bar");
  const unknown = await openWizard({ ...service, progress: [{ ...service.progress[1], sync: { phase: "preparing", done: 0, total: null, detail: "Getting the service ready." } }] }, {});
  assert.equal(unknown.document.querySelector(".sync-bar").value, undefined, "without a total the bar is indeterminate");
});

function createWizardDocument() {
  const nodes = new Map();
  const tags = {
    progress: "ol",
    "step-form": "form",
    fields: "div",
    preview: "div",
    "step-title": "h1",
    "step-description": "p",
    "status-message": "div",
    "live-status": "p",
    "back-button": "button",
    "continue-button": "button",
    "mode-dialog": "dialog",
    "mode-dialog-title": "h2",
    "mode-dialog-copy": "p",
    "mode-dialog-close": "button",
    "step-card": "section",
    "language-panel": "div",
  };
  function make(tag) {
    const node = {
      tag,
      className: "",
      textContent: "",
      hidden: false,
      disabled: false,
      open: false,
      children: [],
      parent: null,
      attributes: new Map(),
      dataset: {},
      listeners: new Map(),
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === "class") this.className = String(value);
        if (name === "id") { this.id = String(value); nodes.set(this.id, this); }
      },
      getAttribute(name) { return this.attributes.get(name) ?? null; },
      addEventListener(type, fn) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      },
      append(...kids) {
        for (const kid of kids) { if (kid) { kid.parent = this; this.children.push(kid); } }
      },
      prepend(...kids) {
        for (const kid of kids) { if (kid) { kid.parent = this; this.children.unshift(kid); } }
      },
      replaceChildren(...kids) { this.children = []; this.append(...kids); },
      after(kid) { const list = this.parent?.children; if (!list) return; kid.parent = this.parent; list.splice(list.indexOf(this) + 1, 0, kid); },
      focus() {},
      showModal() { this.open = true; },
      close() { this.open = false; },
      remove() {},
      querySelector(selector) { return find(this, selector)[0] ?? null; },
      querySelectorAll(selector) { return find(this, selector); },
    };
    Object.defineProperty(node, "textContent", {
      get() { return this.children.length ? this.children.map((child) => child.textContent ?? "").join("") : this.ownText ?? ""; },
      set(value) { this.ownText = String(value); this.children = []; },
    });
    Object.defineProperty(node, "id", {
      get() { return this.ownId ?? ""; },
      set(value) { this.ownId = String(value); if (value) nodes.set(this.ownId, this); },
    });
    Object.defineProperty(node, "firstElementChild", { get() { return this.children.find((child) => child.tag !== "#text") ?? null; } });
    return node;
  }
  function find(node, selector) {
    const found = [];
    const visit = (current) => {
      for (const child of current.children ?? []) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(node);
    return found;
  }
  function matches(node, selector) {
    return selector.split(",").some((part) => {
      const token = part.trim();
      if (token.startsWith(".")) return String(node.className).split(/\s+/).includes(token.slice(1));
      return node.tag === token;
    });
  }
  const document = {
    documentElement: null,
    title: "",
    body: null,
    createElement(tag) {
      if (tag !== "template") return make(tag);
      const node = make("template");
      const content = make("#fragment");
      Object.defineProperty(node, "innerHTML", { set() { content.replaceChildren(make("svg")); } });
      Object.defineProperty(node, "content", { get() { return content; } });
      return node;
    },
    createTextNode(value) {
      const node = make("#text");
      node.textContent = String(value);
      return node;
    },
    getElementById(id) { return nodes.get(id) ?? null; },
    querySelector(selector) { return find(document.documentElement, selector)[0] ?? null; },
    querySelectorAll(selector) { return find(document.documentElement, selector); },
  };
  document.documentElement = make("html");
  document.body = make("body");
  document.documentElement.append(document.body);
  for (const [id, tag] of Object.entries(tags)) {
    const node = make(tag);
    node.id = id;
    nodes.set(id, node);
    document.body.append(node);
  }
  const brand = make("div");
  brand.className = "brand-lockup";
  document.body.append(brand);
  nodes.get("step-form").reportValidity = () => true;
  return document;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
