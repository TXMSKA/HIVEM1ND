import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DICTIONARIES, dictionaryKeys, text } from "../gui/app/i18n.mjs";
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup } from "../gui/app/hierarchy.mjs";
import { createPagedList, loadAll, moveFocus, renderWindow, setQuery } from "../gui/app/lists.mjs";
import { presentation, shellLayout } from "../gui/app/main.mjs";
import { createStore, startCollection, writeCollection } from "../gui/app/state.mjs";
import { ApiError } from "../gui/app/api.mjs";

const PHONE = ["read", "chat.post", "master.read", "approval.answer", "task.accept", "task.send-back"];
const DESKTOP = ["read", "chat.post", "chat.manage", "mailbox.read", "approval.answer", "grant.revoke", "task.status", "task.undo", "unit.create", "unit.connect", "session.start", "session.stop", "layout.write", "settings.write", "home.manage", "editor.read", "editor.write", "comment.write", "proposal.answer", "asset.write", "watch", "viewer.write"];

test("English and Spanish use the same copy keys", () => {
  assert.deepEqual(Object.keys(DICTIONARIES.en).sort(), Object.keys(DICTIONARIES.es).sort());
  assert.deepEqual(dictionaryKeys().sort(), Object.keys(DICTIONARIES.es).sort());
  assert.equal(text("en", "map"), "Map");
  assert.equal(text("es", "map"), "Mapa");
  assert.equal(text("es", "hierarchy"), "Jerarquía");
  assert.equal(text("en", "chats"), "Chats");
  assert.equal(text("es", "chats"), "Chats");
  assert.equal(text("es", "waiting"), "Pendientes");
  assert.equal(text("es", "approveAlways"), "Aprobar siempre");
  assert.equal(text("es", "sendBack"), "Devolver");
  assert.equal(text("es", "watch"), "Seguir");
  assert.equal(text("es", "document"), "Documento");
  assert.equal(text("es", "focus"), "Concentración");
  assert.equal(text("es", "highContrast"), "Alto contraste");
  assert.equal(text("es", "settings"), "Configuración");
  assert.equal(text("en", "showMore", { count: 4 }), "Show 4 more");
  assert.equal(text("es", "queued").includes("respuesta registrada"), true);
  assert.equal(text("en", "submitted").includes("has not been recorded"), true);
  assert.throws(() => text("en", "missing-key"), /Unknown copy key: missing-key/);
  assert.throws(() => text("es", "missing-key"), /Unknown copy key: missing-key/);
});

test("presentation prefers a viewer override and otherwise uses settings", () => {
  assert.deepEqual(presentation({ look: "high-contrast", language: "es" }, { look: "modern", language: "en" }), {
    look: "high-contrast",
    language: "es",
  });
  assert.deepEqual(presentation({ look: null, language: null }, { look: "high-contrast", language: "es" }), {
    look: "high-contrast",
    language: "es",
  });
  assert.deepEqual(presentation(null, null), { look: "modern", language: "en" });
  assert.deepEqual(presentation({ look: null, language: "en" }, { look: "modern", language: "es" }), {
    look: "modern",
    language: "en",
  });
});

test("phone capabilities select the phone shell and desktop capabilities stay desktop", () => {
  assert.equal(shellLayout(PHONE), "phone");
  assert.equal(shellLayout(DESKTOP), "desktop");
  assert.equal(shellLayout(["viewer.write"]), "desktop");
  assert.equal(shellLayout([]), "unknown");
  assert.equal(shellLayout(DESKTOP), "desktop");
});

test("the shell has no remote assets, token storage, or inline code", async () => {
  const files = ["gui/app/index.html", "gui/app/main.mjs", "gui/app/i18n.mjs", "gui/app/styles.css", "gui/app/components.mjs", "gui/app/lists.mjs", "gui/app/hierarchy.mjs", "gui/app/map.mjs", "gui/app/map-geometry.mjs", "gui/app/actions.mjs", "gui/app/chats.mjs", "gui/app/inspector.mjs", "gui/app/editors.mjs", "gui/app/blueprint.mjs"];
  const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));
  for (const [file, source] of sources) {
    assert.equal(source.includes("localStorage"), false, file);
    assert.equal(source.includes("sessionStorage"), false, file);
    assert.equal(source.includes("fonts.googleapis"), false, file);
    assert.equal(source.includes("\u2014"), false, file);
    const remote = source.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
    assert.deepEqual(remote.filter((url) => url !== "http://www.w3.org/2000/svg"), [], file);
  }
  const html = sources[0][1];
  assert.match(html, /lang="en"/);
  assert.match(html, /href="\/app\/styles\.css"/);
  assert.match(html, /src="\/app\/main\.mjs"/);
  assert.equal(/<script(?![^>]*\ssrc=)/.test(html), false);
  assert.equal(html.includes("<style"), false);
  assert.equal(html.includes("session="), false);
  const main = sources[1][1];
  const imports = [...main.matchAll(/from "([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(imports, ["./actions.mjs", "./api.mjs", "./blueprint.mjs", "./chats.mjs", "./components.mjs", "./editors.mjs", "./hierarchy.mjs", "./i18n.mjs", "./inspector.mjs", "./lists.mjs", "./map.mjs", "./state.mjs", "./stream.mjs"]);
  const css = sources[3][1];
  assert.match(css, /--bg:\s*#0f0b13/);
  assert.match(css, /--bg:\s*#050505/);
  assert.match(css, /--accent:\s*#bdcd79/);
  assert.match(css, /--accent:\s*#d4b06a/);
  assert.match(css, /--bar:\s*52px/);
  assert.match(css, /--footer:\s*30px/);
  assert.match(css, /--side:\s*266px/);
  assert.match(css, /--inspector:\s*366px/);
  assert.match(css, /--radius-panel:\s*20px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height:\s*0/);
  assert.match(css, /--target:\s*44px/);
});

test("collections page 1, 4, 40, 400 and 1200 rows without stopping early", async () => {
  for (const count of [1, 4, 40, 400, 1200]) {
    const items = numberedUnits(count);
    const { list, calls } = pagedList(items);
    const result = await loadAll(list);
    assert.equal(result.stale, false);
    assert.equal(list.items.length, count);
    assert.equal(list.total, count);
    assert.equal(list.nextCursor, null);
    assert.equal(calls.length, Math.ceil(count / 100));
    assert.equal(list.store.pages.get("units").generation, list.generation);
  }
});

test("a newer query wins while an older fetch is still running", async () => {
  const pending = [];
  const store = createStore();
  const list = createPagedList({ api: {}, store, name: "units", route: "/units" });
  list.delay = 0;
  list.request = (_api, _method, _path, options) => new Promise((resolve, reject) => {
    const entry = { query: options.query.q, resolve, reject };
    options.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    pending.push(entry);
  });
  const first = setQuery(list, "alpha");
  await delay(0);
  const second = setQuery(list, "beta");
  await delay(0);
  assert.equal(pending.at(-1).query, "beta");
  pending[0].resolve(page([{ id: "alpha", unit: "alpha" }]));
  pending.at(-1).resolve(page([{ id: "beta", unit: "beta" }]));
  await first;
  await second;
  assert.deepEqual(list.items.map((item) => item.id), ["beta"]);
  assert.equal(list.store.pages.get("units").query, "beta");
});

test("an expired cursor reloads once and an invalid cursor does not retry", async () => {
  const expired = faultList(numberedUnits(150), "cursor_expired");
  expired.list.focusId = "unit-0001";
  await loadAll(expired.list);
  assert.equal(expired.list.items.length, 150);
  assert.equal(expired.list.focusId, "unit-0001");
  assert.equal(expired.calls.filter((query) => query.cursor).length, 2);

  const invalid = faultList(numberedUnits(150), "invalid_cursor");
  await loadAll(invalid.list);
  assert.equal(invalid.list.status, "error");
  assert.equal(invalid.list.error.code, "invalid_cursor");
  assert.equal(invalid.calls.filter((query) => query.cursor).length, 1);
});

test("a stale collection generation cannot overwrite a newer page", () => {
  const store = createStore();
  const first = startCollection(store, "units");
  assert.equal(writeCollection(store, "units", first, { total: 4, status: "ready" }), true);
  const second = startCollection(store, "units");
  assert.equal(writeCollection(store, "units", first, { total: 9 }), false);
  assert.equal(store.pages.get("units").generation, second);
  assert.equal(store.pages.get("units").total, null);
});

test("hierarchy keeps duplicate labels, folds large groups, and reveals a searched row", () => {
  const units = [
    sample("root:overseer", "overseer", "overseer", "root", null),
    sample("root:overseer-old", "overseer-old", "overseer", "root", null),
    sample("root:adjutant", "adjutant", "adjutant", "root", null),
    sample("env:web:overlord-web", "overlord-web", "overlord", "environment", "web"),
    sample("project:shop:executor-shop", "executor-shop", "executor", "project", "shop", "env:web:overlord-web", "working"),
    sample("project:blog:executor-shop", "executor-shop", "executor", "project", "blog", null, "out"),
    ...numberedUnits(20),
  ];
  const state = { shown: new Map(), collapsed: new Set() };
  const tree = buildHierarchy(units);
  assert.equal(tree.hidden.includes("root:overseer-old"), true);
  const folded = flattenVisibleHierarchy(tree, state, "");
  assert.equal(folded.some((row) => row.id === "root:overseer-old"), false);
  assert.equal(folded.some((row) => row.id === "project:shop:executor-shop"), true);
  assert.equal(folded.some((row) => row.id === "project:blog:executor-shop"), true);
  assert.equal(folded.filter((row) => row.id.startsWith("project:bulk:")).length, 8);
  const before = `${[...state.shown.entries()]}|${[...state.collapsed]}`;
  const searched = flattenVisibleHierarchy(tree, state, "unit-0020");
  assert.equal(`${[...state.shown.entries()]}|${[...state.collapsed]}`, before);
  assert.equal(searched.some((row) => row.id === "project:bulk:unit-0020"), true);
  assert.ok(searched.filter((row) => row.id.startsWith("project:bulk:")).length < 20);
  toggleGroup(state, "project:bulk");
  const collapsed = flattenVisibleHierarchy(tree, state, "");
  assert.equal(collapsed.some((row) => row.id.startsWith("project:bulk:")), false);
  revealGroup(state, "project:bulk", 12);
  const opened = flattenVisibleHierarchy(tree, state, "");
  assert.equal(opened.filter((row) => row.id.startsWith("project:bulk:")).length, 20);
});

test("a reporting cycle is shown and keyboard focus reaches the final row", () => {
  const cycled = [
    sample("project:loop:a", "a", "executor", "project", "loop", "project:loop:b"),
    sample("project:loop:b", "b", "executor", "project", "loop", "project:loop:a"),
  ];
  const tree = buildHierarchy(cycled);
  assert.ok(tree.cycles.length > 0);
  const rows = flattenVisibleHierarchy(tree, { shown: new Map(), collapsed: new Set() }, "");
  assert.equal(rows.some((row) => row.kind === "issue"), true);

  const list = createPagedList({ api: {}, store: createStore(), name: "units", route: "/units" });
  list.height = 900;
  const many = numberedUnits(1200).map((unit, index) => ({ id: unit.id, kind: "unit", text: unit.unit, depth: 0, pos: index + 1, setsize: 1200 }));
  const host = createHost(900);
  renderWindow(host.ownerDocument, host, list, many, {});
  assert.ok(mounted(host).length < 100);
  moveFocus(list, many, "end");
  renderWindow(host.ownerDocument, host, list, many, {});
  assert.equal(list.focusId, "project:bulk:unit-1200");
  assert.equal(mounted(host).some((node) => node.getAttribute("data-id") === list.focusId), true);
  const app = { store: createStore(), layout: "desktop" };
  activateUnit(app, { id: "project:bulk:unit-1200" }, "keyboard");
  assert.equal(app.store.selected.unitId, "project:bulk:unit-1200");
  assert.equal(app.pendingChat, undefined);
  activateUnit(app, { id: "project:shop:executor-shop" }, "double");
  assert.equal(app.pendingCenter, "project:shop:executor-shop");
  assert.equal(app.pendingChat.create, true);
  app.layout = "phone";
  activateUnit(app, { id: "root:master" }, "double");
  assert.equal(app.pendingChat.create, false);
});

function numberedUnits(count) {
  return Array.from({ length: count }, (_item, index) => sample(
    `project:bulk:unit-${String(index + 1).padStart(4, "0")}`,
    `unit-${String(index + 1).padStart(4, "0")}`,
    "executor",
    "project",
    "bulk",
    null,
    "out",
  ));
}

function sample(id, name, role, kind, scopeName, leadId = null, status = "idle") {
  return {
    id,
    unit: name,
    role,
    scope: kind === "root" ? { kind: "root", name: null } : { kind, name: scopeName },
    leadId,
    job: null,
    context: name,
    status,
  };
}

function page(items, total = items.length, nextCursor = null) {
  return { data: { items, total, nextCursor, issues: [] } };
}

function pagedList(items) {
  const calls = [];
  const list = createPagedList({ api: {}, store: createStore(), name: "units", route: "/units" });
  list.request = async (_api, _method, _path, options) => {
    calls.push({ ...options.query });
    const start = Number(options.query.cursor ?? 0);
    const limit = Number(options.query.limit);
    const slice = items.slice(start, start + limit);
    const next = start + limit < items.length ? String(start + limit) : null;
    return page(slice, items.length, next);
  };
  return { list, calls };
}

function faultList(items, code) {
  const calls = [];
  let failed = false;
  const list = createPagedList({ api: {}, store: createStore(), name: "units", route: "/units" });
  list.request = async (_api, _method, _path, options) => {
    calls.push({ ...options.query });
    if (options.query.cursor && !failed) {
      failed = true;
      const status = code === "invalid_cursor" ? 400 : 409;
      throw new ApiError(status, code, "The page cursor failed.");
    }
    const start = Number(options.query.cursor ?? 0);
    const limit = Number(options.query.limit);
    const slice = items.slice(start, start + limit);
    const next = start + limit < items.length ? String(start + limit) : null;
    return page(slice, items.length, next);
  };
  return { list, calls };
}

function createHost(height) {
  function Node(document) {
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.clientHeight = 0;
    this.scrollTop = 0;
    this.isConnected = true;
    this.className = "";
    this.textContent = "";
    this.tabIndex = 0;
  }
  Node.prototype.setAttribute = function setAttribute(name, value) { this.attributes.set(name, String(value)); };
  Node.prototype.getAttribute = function getAttribute(name) { return this.attributes.get(name) ?? null; };
  Node.prototype.addEventListener = function addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  };
  Node.prototype.replaceChildren = function replaceChildren(...nodes) {
    this.children = [];
    for (const node of nodes) this.children.push(node);
  };
  Node.prototype.focus = function focus() { this.ownerDocument.activeElement = this; };
  const document = { activeElement: null };
  document.createElement = () => new Node(document);
  const host = new Node(document);
  host.clientHeight = height;
  host.ownerDocument = document;
  return host;
}

function mounted(host) {
  return [...host.children].filter((node) => node.getAttribute?.("data-row") === "true");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
