import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { createApi, createOperation, request, retryOperation } from "../gui/app/api.mjs";
import { answerApproval, changeTaskStatus, startSession } from "../gui/app/actions.mjs";
import { textDraft } from "../gui/app/void.mjs";
import { markMailboxRead } from "../gui/app/chats.mjs";
import { dispose as disposeEmbed, handleParentMessage, publishDirty, publishReady, startEmbedChannel } from "../gui/app/embed.mjs";
import { DICTIONARIES, dictionaryKeys, text } from "../gui/app/i18n.mjs";
import { encodeHomeQr } from "../gui/app/qr.mjs";
import { canPerform, exchangeCode, exchangeHomeFragment, logout, renderCodeEntry, renderPhone } from "../gui/app/phone.mjs";
import { applySettingsRead, clearGrant, closeHome, noteHomeChange, openHome, saveSettings, takeGrant, updateExpiry } from "../gui/app/settings.mjs";
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup } from "../gui/app/hierarchy.mjs";
import { collectPages, createPagedList, loadAll, moveFocus, renderWindow, setQuery } from "../gui/app/lists.mjs";
import { flushLayout, queueLayoutPatch } from "../gui/app/map.mjs";
import { setAttachments, startWatch } from "../gui/app/editors.mjs";
import { dispose, mount, navigate, presentation, renderShell, shellLayout } from "../gui/app/main.mjs";
import { applyReset, createStore, startCollection, writeCollection } from "../gui/app/state.mjs";
import { ApiError } from "../gui/app/api.mjs";
import { FIXTURE_HOME_CODE, FIXTURE_HOME_KEY, deterministicUuid } from "./gui-data.mjs";
import { createGuiFixture } from "./gui-fixture.mjs";

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
  assert.equal(shellLayout(DESKTOP, "phone"), "phone");
  assert.equal(shellLayout(PHONE, "desktop"), "phone");
  for (const action of ["read", "chat.post", "master.read", "approval.answer", "task.accept", "task.send-back"]) {
    assert.equal(canPerform(PHONE, action), true, action);
  }
  for (const action of ["chat.manage", "mailbox.read", "unit.create", "unit.connect", "session.start", "session.stop", "layout.write", "settings.write", "home.manage", "grant.revoke", "task.undo", "task.status", "editor.write", "comment.write", "proposal.answer", "asset.write", "watch", "viewer.write"]) {
    assert.equal(canPerform(PHONE, action), false, action);
    assert.equal(canPerform(DESKTOP, action), true, action);
  }
});

test("the shell has no remote assets, token storage, or inline code", async () => {
  const files = ["gui/app/index.html", "gui/app/main.mjs", "gui/app/i18n.mjs", "gui/app/styles.css", "gui/app/components.mjs", "gui/app/lists.mjs", "gui/app/hierarchy.mjs", "gui/app/map.mjs", "gui/app/map-geometry.mjs", "gui/app/actions.mjs", "gui/app/chats.mjs", "gui/app/inspector.mjs", "gui/app/editors.mjs", "gui/app/blueprint.mjs", "gui/app/markup.mjs", "gui/app/void.mjs", "gui/app/settings.mjs", "gui/app/qr.mjs", "gui/app/qr-render.mjs", "gui/app/phone.mjs", "gui/app/embed.mjs"];
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
  assert.deepEqual(imports, ["./actions.mjs", "./api.mjs", "./blueprint.mjs", "./chats.mjs", "./components.mjs", "./editors.mjs", "./embed.mjs", "./hierarchy.mjs", "./i18n.mjs", "./inspector.mjs", "./lists.mjs", "./map.mjs", "./phone.mjs", "./settings.mjs", "./state.mjs", "./stream.mjs", "./void.mjs"]);
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

test("later collection pages stay available and compact windows stay under 100 rows", async () => {
  const seen = [];
  const page = await collectPages({}, "/chats", {
    limit: 50,
    query: { unitId: "project:shop:executor-shop", listed: "true" },
    request: async (_api, _method, _path, options) => {
      seen.push(options.query.cursor ?? "");
      if (!options.query.cursor) {
        return { data: { items: [{ id: "page-1" }], total: 2, issues: [{ code: "malformed_record", message: "The record could not be read." }], nextCursor: "more" } };
      }
      return { data: { items: [{ id: "page-2" }], total: 2, issues: [], nextCursor: null } };
    },
  });
  assert.deepEqual(seen, ["", "more"]);
  assert.deepEqual(page.items.map((item) => item.id), ["page-1", "page-2"]);
  assert.equal(page.total, 2);
  assert.equal(page.nextCursor, null);
  assert.equal(page.issues[0].code, "malformed_record");

  const host = createTestDocument(1440).document.createElement("div");
  host.clientHeight = 900;
  const list = { scrollTop: 0, rowHeight: 36, height: 900, focusId: null };
  const rows = Array.from({ length: 1200 }, (_, index) => ({ id: `row-${index}`, kind: "editor", text: `Row ${index}`, pos: index + 1, setsize: 1200 }));
  renderWindow(host.ownerDocument, host, list, rows, {});
  const mounted = host.querySelectorAll("[data-row]").length;
  assert.equal(mounted < 100, true);
  assert.equal(mounted > 0, true);

  await assert.rejects(setAttachments({}, { current: { resourceId: "board", attachmentRevision: null, attached: [] } }, Array.from({ length: 257 }, (_, index) => `unit-${index}`)), (error) => error.code === "invalid_body");
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

test("the bounded home QR matches its golden matrices", () => {
  const payload = "http://192.168.1.23:43123/#home=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  assert.equal(qrDigest(encodeHomeQr(payload)), "83549c0a12eb68c8716657575309cb4255bb529bfd795aebb1570b256ec34549");
  assert.equal(qrDigest(encodeHomeQr("x".repeat(106))), "28571cbdad17176449c375be5ff4484c96ab69a72384c1fbe30595e2a902a1f5");
  assert.throws(() => encodeHomeQr("x".repeat(107)), RangeError);
  assert.throws(() => encodeHomeQr("café"), RangeError);
  const expiry = updateExpiry({ enabled: true, expiresAt: "2026-10-10T12:00:01.000Z" }, Date.parse("2026-10-10T12:00:00.000Z"));
  assert.equal(expiry.remainingSeconds, 1);
  assert.equal(expiry.expired, false);
  assert.equal(updateExpiry({ enabled: true, expiresAt: "2026-10-10T12:00:00.000Z" }, Date.parse("2026-10-10T12:00:00.000Z")).expired, true);
});

test("home grants are replaced, expired and kept out of settings storage", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const settingsFile = join(fixture.root, "Cosmic", "hivem1nd", "user", "gui", "settings.json");
  const before = await readFile(settingsFile);
  const current = await request(api, "GET", "/settings");
  assert.equal(Object.hasOwn(current.data.home, "key"), false);
  assert.equal(JSON.stringify(current.data).includes(FIXTURE_HOME_KEY), false);
  await assert.rejects(saveSettings(api, "0".repeat(64), { look: "high-contrast" }), (error) => error.code === "revision_conflict");
  assert.deepEqual(await readFile(settingsFile), before);
  const phoneToken = await exchangeHome(fixture, FIXTURE_HOME_KEY);
  const phone = apiFrom(`${fixture.origin}/#session=${phoneToken}`);
  await assert.rejects(saveSettings(phone, current.data.revision, { language: "es" }), (error) => error.code === "phone_read_only");
  await assert.rejects(openHome(phone), (error) => error.code === "phone_read_only");
  await assert.rejects(openHome(api, ["8.8.8.8"]), (error) => error.code === "invalid_home_address");
  await assert.rejects(openHome(api, ["192.168.1.23", "192.168.1.23"]), (error) => error.code === "invalid_home_address");
  assert.equal((await exchangeRaw(fixture, FIXTURE_HOME_KEY)).status, 200);
  const operation = createOperation({
    method: "POST",
    path: "/settings/home-network",
    body: { enabled: true, addresses: ["192.168.1.23", "192.168.1.24"] },
  });
  const opened = await request(api, "POST", "/settings/home-network", { operation });
  const repeated = await retryOperation(api, operation);
  assert.equal(opened.status, 201);
  assert.equal(repeated.data.key, opened.data.key);
  assert.deepEqual(opened.data.qrPayloads, opened.data.links);
  assert.equal(opened.data.links[0].startsWith("http://192.168.1.23:"), true);
  assert.equal(opened.data.links[1].startsWith("http://192.168.1.24:"), true);
  assert.equal((await exchangeRaw(fixture, FIXTURE_HOME_KEY)).status, 401);
  assert.equal((await exchangeRaw(fixture, opened.data.key)).status, 200);
  assert.equal(JSON.stringify((await request(api, "GET", "/settings")).data).includes(opened.data.key), false);
  await assertAbsent(fixture.root, opened.data.key);
  const state = { grant: null, home: null, expectGrant: true, selected: 0 };
  takeGrant(state, opened.data);
  noteHomeChange(state, { reason: "replaced", home: { enabled: true, openedAt: opened.data.openedAt, expiresAt: opened.data.expiresAt, addresses: opened.data.addresses, remainingSeconds: 1 } });
  assert.equal(state.grant.key, opened.data.key);
  noteHomeChange(state, { reason: "replaced", home: { enabled: true, openedAt: "2026-10-10T13:00:00.000Z", expiresAt: "2026-10-11T01:00:00.000Z", addresses: [], remainingSeconds: 1 } });
  assert.equal(state.grant, null);
  applySettingsRead(state, { settings: { look: "modern" }, revision: "a".repeat(64), service: {}, home: { enabled: true, key: opened.data.key, expiresAt: opened.data.expiresAt } });
  assert.equal(state.grant, null);
  const closed = await closeHome(api);
  assert.equal(closed.data.enabled, false);
  assert.equal((await exchangeRaw(fixture, opened.data.key)).status, 410);
  clearGrant(state);
  const saved = await saveSettings(api, current.data.revision, { language: "es" });
  assert.equal(saved.data.settings.language, "es");
  assert.equal(saved.data.settings.look, "modern");
});

test("a failed home binding leaves no active grant", async (t) => {
  const fixture = await createGuiFixture({ scenario: "home-bind-failure" });
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  await assert.rejects(openHome(api, ["192.168.1.23"]), (error) => error.code === "listener_unavailable");
  const settings = await request(api, "GET", "/settings");
  assert.equal(settings.data.home.enabled, false);
  assert.equal((await exchangeRaw(fixture, FIXTURE_HOME_KEY)).status, 410);
});

test("a home code is cleared before it is sent and a bad code keeps no secret", async (t) => {
  const document = createTestDocument().document;
  let submitted = null;
  const form = renderCodeEntry(document, (key) => text("en", key), (code) => { submitted = code; });
  const input = form.querySelector("[data-home-code]");
  input.value = "ab23cd";
  form.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(submitted, "ab23cd");
  assert.equal(input.value, "");
  const nav = renderPhone(document, (key) => text("en", key), ["hierarchy", "chats", "waiting"], "hierarchy", () => undefined, () => null);
  assert.deepEqual([...nav.querySelectorAll("[data-phone-mode]")].map((node) => node.getAttribute("data-phone-mode")), ["hierarchy", "chats", "waiting"]);

  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const home = new URL(fixture.phoneUrl);
  let sent = null;
  const api = createApi({
    location: { origin: home.origin, pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
    fetch: async (url, init) => {
      sent = JSON.parse(init.body);
      return jsonEnvelope(200, { token: "phone-token", audience: "phone", capabilities: PHONE, expiresAt: "2026-10-11T00:00:00.000Z" });
    },
  });
  const credential = await exchangeCode(api, "ab23cd");
  assert.deepEqual(sent, { code: "AB23CD" });
  assert.equal(credential.audience, "phone");
  assert.equal(api.homeKey, null);
  assert.equal(api.token, "phone-token");

  const invalid = apiFrom(`${home.origin}/`);
  await assert.rejects(exchangeCode(invalid, "abcdef"), (error) => error.code === "invalid_home_key" && error.status === 401);
  assert.equal(invalid.token, null);
  assert.equal(invalid.homeKey, null);
  const parsedHome = new URL(fixture.phoneUrl);
  let cleared = "";
  const fragment = createApi({
    location: { origin: parsedHome.origin, pathname: parsedHome.pathname, search: parsedHome.search, hash: parsedHome.hash },
    history: { replaceState(_state, _title, next) { cleared = String(next); } },
    fetch: globalThis.fetch.bind(globalThis),
  });
  assert.equal(fragment.homeKey, FIXTURE_HOME_KEY);
  assert.equal(cleared.includes("home="), false);
  assert.equal(cleared.includes(FIXTURE_HOME_KEY), false);
  const exchanged = await exchangeHomeFragment(fragment);
  assert.equal(exchanged.audience, "phone");
  assert.equal(fragment.homeKey, null);
  assert.equal(fragment.token, exchanged.token);
  const again = await exchangeCode(apiFrom(`${home.origin}/`), FIXTURE_HOME_CODE);
  assert.equal(again.expiresAt, exchanged.expiresAt);
});

test("replaced and expired home codes are rejected and attempts are rate limited", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = apiFrom(fixture.desktopUrl);
  const opened = await openHome(desktop, ["192.168.1.23"]);
  const home = new URL(fixture.phoneUrl).origin;
  await assert.rejects(exchangeCode(apiFrom(`${home}/`), FIXTURE_HOME_CODE), (error) => error.code === "invalid_home_key");
  const lowered = await exchangeCode(apiFrom(`${home}/`), opened.data.shortCode.toLowerCase());
  assert.equal(lowered.expiresAt, opened.data.expiresAt);
  assert.equal((await exchangeCode(apiFrom(`${home}/`), opened.data.shortCode)).expiresAt, lowered.expiresAt);
  await fixture.control.advance(12 * 60 * 60 * 1000);
  await assert.rejects(exchangeCode(apiFrom(`${home}/`), opened.data.shortCode), (error) => error.code === "home_expired" && error.status === 410);

  const limited = await createGuiFixture();
  t.after(() => limited.close());
  const limitedHome = new URL(limited.phoneUrl).origin;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(exchangeCode(apiFrom(`${limitedHome}/`), "ABCDEF"), (error) => error.code === "invalid_home_key");
  }
  await assert.rejects(exchangeCode(apiFrom(`${limitedHome}/`), "ABCDEF"), (error) => error.code === "auth_rate_limited" && error.retryAfter === 60_000);
});

test("a mounted map persists a drag with the loaded revision and keeps a later in-flight drag", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  let release = null;
  let held = false;
  const patches = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (_input, init) => {
    if (init?.method !== "PATCH" || !String(init.body ?? "").includes("expectedRevision")) return;
    const body = JSON.parse(init.body);
    if (!body.nodes) return;
    const headers = init.headers ?? {};
    patches.push({ id: headers["Idempotency-Key"], body });
    if (!held) {
      held = true;
      await new Promise((resolve) => { release = resolve; });
    }
  });
  t.after(() => dispose(desktop.app));
  await until(() => desktop.app.mapState?.authoritative?.revision);
  const revision = desktop.app.mapState.authoritative.revision;
  const loaded = await request(desktop.app.api, "GET", "/layout");
  assert.equal(revision, loaded.data.revision);
  const map = desktop.app.mapState;
  const id = "root:master";
  const origin = map.positions[id];
  queueLayoutPatch(map, id, { x: origin.x + 20, y: origin.y });
  const saving = flushLayout(map);
  await until(() => patches.length === 1);
  queueLayoutPatch(map, id, { x: origin.x + 40, y: origin.y });
  release();
  await saving;
  await until(() => patches.length === 2);
  assert.equal(patches[0].body.expectedRevision, revision);
  assert.equal(patches[0].body.nodes[id].x, origin.x + 20);
  assert.notEqual(patches[0].id, patches[1].id);
  assert.equal(patches[1].body.nodes[id].x, origin.x + 40);
  const stored = await request(desktop.app.api, "GET", "/layout");
  assert.equal(stored.data.layout.nodes[id].x, origin.x + 40);
  assert.notEqual(stored.data.revision, revision);
  assert.notEqual(patches[1].body.expectedRevision, null);
  assert.notEqual(patches[1].body.expectedRevision, revision);
});

test("phone boot never calls viewer routes and a narrow desktop token stays desktop", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const phone = await bootApp(fixture.phoneUrl, 390, urls);
  t.after(() => dispose(phone.app));
  await until(() => phone.root.querySelector(".shell")?.getAttribute("data-layout") === "phone");
  const beforeReset = urls.length;
  await applyReset(phone.app.store, phone.app.api);
  assert.equal(phone.app.store.paused, false);
  assert.equal(phone.app.store.failure, null);
  assert.equal(urls.slice(beforeReset).some((url) => url.includes("/viewer")), false);
  assert.equal(phone.app.embed ?? null, null);
  assert.equal(phone.view.innerWidth, 390);
  navigate(phone.app, "map");
  navigate(phone.app, "blueprint");
  navigate(phone.app, "settings");
  assert.equal(phone.app.mode, "hierarchy");
  assert.equal(phone.root.querySelector(".mode"), null);
  assert.equal(phone.root.querySelector("[data-action='new-unit']"), null);
  assert.equal(phone.root.querySelector("[aria-label='Settings']"), null);
  const overseer = phone.app.unitList.catalog.find((unit) => unit.id === "root:overseer");
  phone.app.activeHandlers.onActivate({ id: overseer.id, kind: "unit", unit: overseer }, "double");
  await until(() => phone.app.phoneChatNote === true);
  assert.equal(phone.root.querySelector("[data-phone-chat='required']")?.textContent, "A desktop conversation is required.");
  const executor = phone.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  phone.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await until(() => phone.root.querySelector("[data-composer]") && phone.app.thread?.chat?.members?.includes(executor.id));
  assert.equal(phone.root.querySelector("[data-action='pin']"), null);
  await until(() => phone.app.inspectorData?.unitId === executor.id);
  phone.app.waitingList.height = 20000;
  navigate(phone.app, "waiting");
  await until(() => phone.root.querySelector("[data-waiting-surface]")?.querySelector("[data-task='project:shop:029']"));
  click(phone.root.querySelector("[data-waiting-surface]").querySelector("[data-task='project:shop:029']"));
  await until(() => phone.root.querySelector("[data-waiting-record='review']")?.querySelector("[data-action='accept']"));
  const review = phone.root.querySelector("[data-waiting-record='review']");
  assert.equal(review?.querySelector("[data-action='accept']")?.disabled, false);
  assert.equal(review?.querySelector("[data-action='send-back']")?.disabled, false);
  assert.equal(phone.root.querySelector("[data-task='project:shop:030']"), null);
  assert.equal(phone.root.querySelector("[data-action='undo']"), null);
  assert.equal(phone.root.querySelector("[data-action='revoke-grant']"), null);
  phone.view.innerWidth = 1440;
  renderShell(phone.app);
  assert.equal(phone.root.querySelector(".shell").getAttribute("data-layout"), "phone");

  const directId = deterministicUuid(["direct-chat", ["project:shop:executor-shop", "root:master"].sort()]);
  const message = createOperation({
    method: "POST",
    path: "/chats/:chatId/messages",
    params: { chatId: directId },
    body: { body: "On my way", subject: "", replyTo: null, attachments: [], priority: "normal" },
  });
  await request(phone.app.api, "POST", message.path, { operation: message });
  await retryOperation(phone.app.api, message);
  const returning = (await request(phone.app.api, "GET", "/tasks/:taskId", { params: { taskId: "project:shop:030" } })).data;
  await assert.rejects(changeTaskStatus(phone.app.api, returning, "open", "Needs another pass"), (error) => error.code === "phone_read_only");
  await changeTaskStatus(phone.app.api, (await request(phone.app.api, "GET", "/tasks/:taskId", { params: { taskId: "project:shop:029" } })).data, "done");
  const mailboxOperation = createOperation({
    method: "POST",
    path: "/mailboxes/:unitId/messages",
    params: { unitId: "root:master" },
    body: { body: "Seen from the phone", subject: "", replyTo: null, attachments: [], priority: "normal" },
  });
  const mailbox = await request(phone.app.api, "POST", mailboxOperation.path, { operation: mailboxOperation });
  await markMailboxRead(phone.app.api, "root:master", [mailbox.data.id]);
  const agentMail = createOperation({
    method: "POST",
    path: "/mailboxes/:unitId/messages",
    params: { unitId: "project:shop:executor-shop" },
    body: { body: "From the phone", subject: "", replyTo: null, attachments: [], priority: "normal" },
  });
  const agentMessage = await request(phone.app.api, "POST", agentMail.path, { operation: agentMail });
  assert.equal(agentMessage.data.body, "From the phone");
  await assert.rejects(markMailboxRead(phone.app.api, "project:shop:executor-shop", [agentMessage.data.id]), (error) => error.code === "phone_read_only");
  const approval = (await request(phone.app.api, "GET", "/approvals/e80a0bf9-8fb4-4d64-9527-04524c9a2ecf")).data;
  await answerApproval(phone.app.api, approval, "approve");
  await delay(200);
  assert.equal(urls.some((url) => url.includes("/viewer")), false);

  const denied = [
    ["POST", "/units", {}],
    ["PUT", "/units/:unitId/lead", { unitId: "root:overseer" }],
    ["POST", "/units/:unitId/session", { unitId: "root:overseer" }],
    ["POST", "/sessions/:sessionId/stop", { sessionId: "00000000-0000-4000-8000-000000000000" }],
    ["PATCH", "/layout", {}],
    ["POST", "/chats", {}],
    ["PATCH", "/chats/:chatId", { chatId: directId }],
    ["PATCH", "/settings", {}],
    ["POST", "/settings/home-network", {}],
    ["DELETE", "/units/:unitId/approval-grants/:grantId", { unitId: "project:shop:executor-shop", grantId: "f605f169-8686-4a88-a213-7ca19703fd41" }],
    ["POST", "/tasks/:taskId/undo", { taskId: "project:shop:027" }],
    ["POST", "/editors/register", {}],
    ["POST", "/editors/:resourceId/comments", { resourceId: "missing" }],
    ["POST", "/void/texts/:resourceId/proposals/:proposalId/answer", { resourceId: "missing", proposalId: "missing" }],
    ["POST", "/watch", {}],
    ["PATCH", "/viewer", {}],
    ["POST", "/blueprint/boards", {}],
    ["POST", "/editors/:resourceId/assets", { resourceId: "missing" }],
  ];
  for (const [method, path, params] of denied) {
    const operation = createOperation({ method, path, params, body: {} });
    await assert.rejects(request(phone.app.api, method, operation.path, { operation }), (error) => error.status === 403 && error.code === "phone_read_only", `${method} ${path}`);
  }
  await assert.rejects(request(phone.app.api, "GET", "/viewer"), (error) => error.status === 403 && error.code === "phone_read_only");
  const closed = (await request(phone.app.api, "GET", "/tasks/:taskId", { params: { taskId: "project:shop:026" } })).data;
  await assert.rejects(changeTaskStatus(phone.app.api, closed, "closed"), (error) => error.code === "phone_read_only");

  const desktopUrls = [];
  const desktop = await bootApp(fixture.desktopUrl, 390, desktopUrls);
  t.after(() => dispose(desktop.app));
  await until(() => desktop.root.querySelector(".shell")?.getAttribute("data-layout") === "desktop");
  assert.equal(desktop.view.innerWidth, 390);
  assert.equal(shellLayout(desktop.app.store.capabilities), "desktop");
});

test("embedded viewers accept only their parent and logout is idempotent", async (t) => {
  const parent = fakeParent();
  const other = fakeParent();
  const calls = [];
  const channel = startEmbedChannel({
    embedded: true,
    hostOrigin: "http://127.0.0.1:9",
    viewerId: "viewer-a",
    capabilities: DESKTOP,
  }, {
    patchViewer: async (body) => { calls.push(body); },
    logout: async () => { calls.push("logout"); },
  }, parent.transport);
  const sibling = startEmbedChannel({
    embedded: true,
    hostOrigin: "http://127.0.0.1:9",
    viewerId: "viewer-b",
    capabilities: DESKTOP,
  }, {
    patchViewer: async (body) => { calls.push(["b", body]); },
    logout: async () => { calls.push("logout-b"); },
  }, other.transport);
  publishReady(channel);
  publishDirty(channel, 1);
  assert.deepEqual(parent.parent.sent.data, {
    contract: "hivem1nd-embed-v1",
    viewerId: "viewer-a",
    type: "dirty",
    value: true,
  });
  assert.equal(parent.parent.sent.origin, "http://127.0.0.1:9");
  publishReady(sibling);
  assert.equal(other.parent.sent.data.viewerId, "viewer-b");
  assert.equal(parent.parent.sent.data.viewerId, "viewer-a");
  const forged = [
    { source: other.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-look", value: "modern" } },
    { source: parent.parent, origin: "https://evil.example", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-look", value: "modern" } },
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-b", type: "set-look", value: "modern" } },
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "other", viewerId: "viewer-a", type: "set-look", value: "modern" } },
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-look", value: "neon" } },
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "close", value: false } },
  ];
  for (const event of forged) await handleParentMessage(channel, event);
  assert.deepEqual(calls, []);
  await handleParentMessage(channel, { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-language", value: "es" } });
  await handleParentMessage(sibling, { source: other.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-b", type: "set-look", value: "high-contrast" } });
  assert.deepEqual(calls[0], { language: "es" });
  assert.deepEqual(calls[1], ["b", { look: "high-contrast" }]);
  await handleParentMessage(channel, { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "close", value: null } });
  assert.equal(calls.at(-1), "logout");
  disposeEmbed(channel);
  publishDirty(channel, false);
  assert.equal(parent.parent.sent.data.type, "dirty");
  assert.equal(parent.parent.sent.data.value, true);

  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const secret = await bootstrapSecret(fixture.root);
  const first = await localViewer(fixture, secret, { look: null, language: null });
  const second = await localViewer(fixture, secret, { look: "modern", language: "en" });
  const left = apiFrom(first.url);
  const right = apiFrom(second.url);
  await request(left, "POST", "/watch", { operation: createOperation({ method: "POST", path: "/watch", body: { unitId: "root:master" } }) });
  assert.equal(fixture.control.watchCount(), 1);
  const patched = await request(left, "PATCH", "/viewer", {
    operation: createOperation({ method: "PATCH", path: "/viewer", body: { look: "high-contrast", language: "es", dirty: true } }),
  });
  assert.equal(patched.data.look, "high-contrast");
  assert.equal(patched.data.dirty, true);
  const untouched = await request(right, "GET", "/viewer");
  assert.equal(untouched.data.viewerId, second.viewerId);
  assert.equal(untouched.data.look, "modern");
  assert.equal(untouched.data.dirty, false);
  const settings = await request(apiFrom(fixture.desktopUrl), "GET", "/settings");
  assert.equal(settings.data.settings.look, "modern");
  assert.equal(settings.data.settings.language, "en");
  const gone = await logout(left);
  assert.equal(gone.status, 204);
  assert.equal(left.token, null);
  assert.equal(fixture.control.watchCount(), 0);
  let fetched = false;
  left.fetch = async () => { fetched = true; throw new Error("logout fetched twice"); };
  assert.equal((await logout(left)).status, 204);
  assert.equal(fetched, false);
  assert.equal((await request(right, "GET", "/viewer")).data.viewerId, second.viewerId);
  await assert.rejects(request(apiFrom(first.url), "POST", "/sessions/none/stop", {
    operation: createOperation({ method: "POST", path: "/sessions/none/stop", body: {} }),
  }), (error) => error.status === 401);
});

test("session, approval and grant outcomes use the contract events", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, urls);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === executor.id, "The inspector did not open.");
  const overseer = (await request(desktop.app.api, "GET", "/units/:unitId", { params: { unitId: "root:overseer" } })).data;
  const started = await startSession(desktop.app.api, overseer, "cursor", null);
  await waitFor(() => desktop.app.sessionRequestId === started.data.requestId && noteText(desktop) === "The session is queued.", "The session request event did not arrive.");
  await fixture.control.patchSession(started.data.requestId, "failed", "launch_ambiguous");
  const beforeReset = urls.length;
  const firstMark = desktop.app.trackedAt ?? 0;
  await fixture.control.emit("stream.reset", { reason: "service_restarted", cursor: "0" });
  await waitFor(() => (desktop.app.trackedAt ?? 0) > firstMark && noteText(desktop) === "The session failed. Nothing was launched." && urls.slice(beforeReset).some((url) => url.includes(`/session-requests/${started.data.requestId}`)), "The session request was not reread.");

  const pendingId = "e80a0bf9-8fb4-4d64-9527-04524c9a2ecf";
  const pending = desktop.root.querySelector(`[data-approval="${pendingId}"]`);
  click(pending?.querySelector("[data-action='deny']"));
  await waitFor(() => desktop.app.answerId && noteText(desktop) === "Answer queued.", "The queued denial was not shown.");
  assert.notEqual(noteText(desktop), "Approved");
  assert.equal(desktop.root.querySelector(`[data-approval="${pendingId}"]`)?.getAttribute("data-approval-state"), "answering");
  const beforeAnswer = urls.length;
  const answerMark = desktop.app.trackedAt ?? 0;
  await fixture.control.emit("stream.reset", { reason: "cursor_expired", cursor: "0" });
  await waitFor(() => (desktop.app.trackedAt ?? 0) > answerMark && urls.slice(beforeAnswer).some((url) => url.includes(`/approvals/${pendingId}/answers/${desktop.app.answerId}`)), "The answer was not reread.");
  await fixture.control.settleAnswer(desktop.app.answerId, "applied");
  await waitFor(() => noteText(desktop) === "Denied" && desktop.root.querySelector(`[data-approval="${pendingId}"]`)?.getAttribute("data-approval-state") === "denied", "The denial was labeled as an approval.");
  assert.equal(urls.some((url) => url.includes("/waiting")), true);
  assert.equal(urls.some((url) => url.includes("/approval-grants")), true);

  const grantId = "f605f169-8686-4a88-a213-7ca19703fd41";
  click(desktop.root.querySelector(`[data-grant="${grantId}"]`));
  await waitFor(() => desktop.app.revocationRequestId, "The revocation was not tracked.");
  await fixture.control.settleRevocation(desktop.app.revocationRequestId);
  await waitFor(() => desktop.root.querySelector(`[data-grant="${grantId}"]`) == null && noteText(desktop) === "The grant was revoked.", "The revoked grant stayed in the inspector.");

  const extraId = "11111111-1111-4111-8111-111111111111";
  const sample = desktop.app.inspectorData.approvals[0];
  await fixture.control.emit("approval.requested", { approval: { ...sample, id: extraId, display: "Extra request", state: "pending" } });
  await waitFor(() => desktop.root.querySelector(`[data-approval="${extraId}"]`), "The requested approval did not appear.");
});

test("Watch opens the focused board and clears a stopped watch", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const board = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  const opened = await request(desktop.app.api, "GET", "/blueprint/boards/:resourceId", { params: { resourceId: board.id } });
  const screen = opened.data.document.screens[0];
  const nodeId = screen.root?.id;
  assert.ok(screen?.id);
  assert.ok(nodeId);
  await startWatch(desktop.app.api, desktop.app.editors, { unitId: "project:shop:executor-shop", resourceId: board.id });
  await fixture.control.noteActivity({
    unitId: "project:shop:executor-shop",
    resourceId: board.id,
    focus: { screenId: screen.id, nodeId },
  });
  await waitFor(() => desktop.root.querySelector(".shell")?.getAttribute("data-mode") === "blueprint"
    && desktop.root.querySelector(`[data-screen="${screen.id}"]`)?.getAttribute("data-focus") === "true"
    && desktop.root.querySelector(`[data-node="${nodeId}"]`)?.getAttribute("data-highlight") === "true", "Watch did not open the focused board.");
  const watchId = desktop.app.editors.watch?.watchId;
  assert.ok(watchId);
  await fixture.control.emit("watch.changed", { watchId, unitId: "project:shop:executor-shop", resourceId: board.id, state: "stopped" });
  await waitFor(() => desktop.app.editors.watch == null, "The stopped watch remained.");
});

test("an incoming render keeps unsent chat text and return notes", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length > 1, "The chat list did not load.");
  navigate(desktop.app, "chats");
  const [first, second] = desktop.app.chatList.catalog;
  desktop.app.activeHandlers.onActivate({ id: first.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === first.id && desktop.root.querySelector("[data-composer]"), "The first chat did not open.");
  typeInput(desktop.root.querySelector("[data-composer]"), "Unsent hello", 6, 11);
  await fixture.control.emit("service.changed", { machine: "DESKTOP" });
  await waitFor(() => desktop.root.querySelector("[data-composer]")?.value === "Unsent hello", "The unsent chat text was erased.");
  const restored = desktop.root.querySelector("[data-composer]");
  assert.equal(desktop.document.activeElement, restored);
  assert.equal(restored.selectionStart, 6);
  assert.equal(restored.selectionEnd, 11);
  desktop.app.activeHandlers.onActivate({ id: second.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === second.id && desktop.root.querySelector("[data-composer]")?.value === "", "The second chat reused the first draft.");
  typeInput(desktop.root.querySelector("[data-composer]"), "Second draft", 0, 6);
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-composer]").value, "Second draft");
  desktop.app.activeHandlers.onActivate({ id: first.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === first.id && desktop.root.querySelector("[data-composer]")?.value === "Unsent hello", "The first draft was lost while switching chats.");
  click(desktop.root.querySelector("[data-action='send']"));
  await waitFor(() => desktop.app.thread?.chat?.id === first.id && desktop.root.querySelector("[data-composer]")?.value === "", "The sent chat draft remained.");

  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-note='project:shop:030']"), "The return note did not appear.");
  typeInput(desktop.root.querySelector("[data-note='project:shop:030']"), "Needs another pass", 6, 13);
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-note='project:shop:030']").value, "Needs another pass");
  assert.equal(desktop.root.querySelector("[data-note='project:shop:030']").selectionStart, 6);
  click(desktop.root.querySelector("[data-task='project:shop:030']")?.querySelector("[data-action='send-back']"));
  await waitFor(() => desktop.root.querySelector("[data-note='project:shop:030']")?.value === "", "The sent return note remained.");
});

test("visible chat lines are marked read and mailbox inspection stays closed", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, urls);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, "The chat list did not load.");
  navigate(desktop.app, "chats");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === chat.id && desktop.root.querySelector("[data-composer]"), "The chat did not open.");
  typeInput(desktop.root.querySelector("[data-composer]"), "Visible line", 0, 12);
  click(desktop.root.querySelector("[data-action='send']"));
  await waitFor(() => [...desktop.root.querySelectorAll("[data-message]")].some((node) => node.textContent === "Visible line" && node.getAttribute("data-read") === "true"), "The visible line was not acknowledged.");
  assert.equal(urls.some((url) => url.includes(`/chats/${encodeURIComponent(chat.id)}/read`) || url.includes(`/chats/${chat.id}/read`)), true);

  const transcript = desktop.root.querySelector(".transcript");
  transcript._scrollHeight = transcript.clientHeight + 80;
  transcript.scrollTop = 0;
  desktop.app.thread.nearBottom = false;
  for (const handler of transcript.listeners.get("scroll") ?? []) handler();
  assert.equal(desktop.app.thread.nearBottom, false);
  await fixture.control.emit("message.created", {
    chatId: chat.id,
    mailboxId: null,
    message: { id: "away-from-bottom", body: "Away from the bottom", timestamp: "2099-01-01T00:00:00.000Z", read: false },
  });
  await waitFor(() => desktop.root.querySelector("[data-new-messages]")?.textContent === "New messages", "A message away from the bottom was treated as visible.");

  const mailboxReads = () => urls.filter((url) => /\/mailboxes\/[^ ?]+\/read/.test(url)).length;
  const beforeReads = mailboxReads();
  click(desktop.root.querySelector("[data-action='mailbox']"));
  await waitFor(() => desktop.root.querySelector("[data-mailbox-unit]"), "The mailbox list did not open.");
  const mailboxIds = [...desktop.root.querySelectorAll("[data-mailbox-unit]")].map((node) => node.getAttribute("data-mailbox-unit"));
  let opened = false;
  for (const unitId of mailboxIds) {
    click(desktop.root.querySelector(`[data-mailbox-unit="${unitId}"]`));
    await waitFor(() => desktop.root.querySelector(`[data-mailbox-history="${unitId}"]`), "The mailbox history did not open.");
    const message = desktop.root.querySelector(`[data-mailbox-history="${unitId}"]`).querySelector("[data-mailbox-message]");
    if (!message) continue;
    click(message);
    await waitFor(() => desktop.root.querySelector("[data-mailbox-detail]"), "The mailbox message did not open.");
    opened = true;
    break;
  }
  assert.equal(opened, true);
  assert.equal(mailboxReads(), beforeReads);
  const compose = desktop.root.querySelector("[data-mailbox-compose]");
  assert.ok(compose);
  typeInput(compose, "Mailbox note", 0, 12);
  click(desktop.root.querySelector("[data-action='send-mailbox']"));
  await waitFor(() => [...desktop.root.querySelectorAll("[data-mailbox-message]")].some((node) => node.textContent === "Mailbox note"), "The mailbox message was not posted.");
  assert.equal(mailboxReads(), beforeReads);
  click(desktop.root.querySelector("[data-action='mark-read']"));
  await waitFor(() => mailboxReads() > beforeReads, "Mark read did not call the mailbox route.");

  const phoneUrls = [];
  const phone = await bootApp(fixture.phoneUrl, 390, phoneUrls);
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.app.chatList?.catalog?.length, "The phone chat list did not load.");
  click(phone.root.querySelector("[data-phone-mode='chats']"));
  const phoneChat = phone.app.chatList.catalog[0];
  phone.app.activeHandlers.onActivate({ id: phoneChat.id, kind: "chat" }, "double");
  await waitFor(() => phone.root.querySelector("[data-action='mailbox']"), "The phone mailbox control did not appear.");
  click(phone.root.querySelector("[data-action='mailbox']"));
  await waitFor(() => phone.root.querySelector("[data-mailbox-unit]"), "The phone mailbox list did not open.");
  const agent = [...phone.root.querySelectorAll("[data-mailbox-unit]")].find((node) => node.getAttribute("data-mailbox-unit") !== "root:master");
  assert.ok(agent);
  click(agent);
  const agentId = agent.getAttribute("data-mailbox-unit");
  await waitFor(() => phone.root.querySelector(`[data-mailbox-history="${agentId}"]`), "The phone mailbox history did not open.");
  const agentMessage = phone.root.querySelector(`[data-mailbox-history="${agentId}"]`).querySelector("[data-mailbox-message]");
  if (agentMessage) {
    click(agentMessage);
    await waitFor(() => phone.root.querySelector("[data-mailbox-detail]"), "The phone mailbox detail did not open.");
  }
  assert.equal(phone.root.querySelector("[data-action='mark-read']"), null);
  assert.equal(phoneUrls.some((url) => /\/mailboxes\/[^ ?]+\/read/.test(url)), false);
});

test("waiting opens from either navigation surface and refreshes without a selected unit", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.waitingList?.status === "ready" || desktop.app.waitingList?.status === "empty", "Waiting did not load.");
  assert.equal(desktop.app.store.selected.unitId, null);
  const pending = desktop.app.waitingList.items.find((item) => item.approvalId === "e80a0bf9-8fb4-4d64-9527-04524c9a2ecf");
  assert.ok(pending);
  click(desktop.root.querySelector("[data-action='waiting']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-surface]")?.querySelector("[data-approval='e80a0bf9-8fb4-4d64-9527-04524c9a2ecf']"), "The waiting list did not open.");
  const search = desktop.root.querySelector("[data-waiting-search]");
  typeInput(search, "zzzz-no-such-waiting", 0, 20);
  await waitFor(() => desktop.root.querySelector("[data-waiting-total]")?.getAttribute("data-waiting-total") === "0", "Waiting search did not filter.");
  typeInput(search, "", 0, 0);
  await waitFor(() => desktop.root.querySelector("[data-waiting-surface]")?.querySelector("[data-approval='e80a0bf9-8fb4-4d64-9527-04524c9a2ecf']"), "Waiting search did not restore the list.");
  click(desktop.root.querySelector("[data-waiting-surface]").querySelector("[data-approval='e80a0bf9-8fb4-4d64-9527-04524c9a2ecf']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-record='approval']")?.querySelector("[data-action='approve']"), "The approval action was not offered.");
  assert.equal(desktop.root.querySelector("[data-waiting-record]")?.querySelector("[data-action='revoke-grant']"), null);

  const phone = await bootApp(fixture.phoneUrl, 390, []);
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.app.waitingList?.items?.some((item) => item.approvalId === pending.approvalId), "The phone waiting list did not load.");
  assert.equal(phone.app.store.selected.unitId, null);
  const before = phone.app.store.view?.counts?.waiting ?? 0;
  const approval = (await request(phone.app.api, "GET", "/approvals/:approvalId", { params: { approvalId: pending.approvalId } })).data;
  const answered = await answerApproval(phone.app.api, approval, "approve");
  await fixture.control.settleAnswer(answered.data.answerId, "applied");
  await waitFor(() => phone.app.store.selected.unitId === null && (phone.app.store.view?.counts?.waiting ?? before) < before, "The waiting total did not refresh without a selected unit.");
  phone.app.waitingList.height = 20000;
  click(phone.root.querySelector("[data-phone-mode='waiting']"));
  await waitFor(() => phone.root.querySelector("[data-waiting-surface]")?.querySelector("[data-kind='review']"), "Phone Waiting did not open its own list.");
  assert.equal(phone.app.store.selected.unitId, null);
  click(phone.root.querySelector("[data-waiting-surface]").querySelector("[data-kind='review']"));
  await waitFor(() => phone.root.querySelector("[data-waiting-record='review']")?.querySelector("[data-action='accept']"), "The phone review action was hidden.");
  assert.equal(phone.root.querySelector("[data-waiting-record]")?.querySelector("[data-action='undo']"), null);
});

test("desktop registers a path, copies a legacy module, and edits structure without rewriting read-only bytes", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const legacyFile = join(fixture.root, "repositories", "shop", "docs", "flows", "boards", "legacy-cart.mjs");
  const originalFile = join(fixture.root, "repositories", "shop", "docs", "release.orig.json");
  const legacyBytes = await readFile(legacyFile);
  const originalBytes = await readFile(originalFile);
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (_input, init) => {
    if (!init?.body || (init.method !== "POST" && init.method !== "PUT")) return;
    writes.push({ method: init.method, url: String(_input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell")?.getAttribute("data-layout") === "desktop", "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.root.querySelector("[data-action='register-resource']")?.getAttribute("data-kind") === "blueprint", "The registration form was not shown.");
  typeInput(desktop.root.querySelector("[data-field='register-path']"), "docs/flows/boards/legacy-cart.mjs", 0, 0);
  click(desktop.root.querySelector("[data-action='register-resource']"));
  await waitFor(() => desktop.root.querySelector("[data-legacy]")?.textContent === "docs/flows/boards/legacy-cart.mjs", "The original module path was not shown.");
  assert.equal(desktop.root.querySelector("[data-action='resize-screen']"), null);
  click(desktop.root.querySelector("[data-action='copy-json']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.legacy == null && desktop.root.querySelector("[data-action='resize-screen']"), "The JSON copy did not open.");
  assert.deepEqual(await readFile(legacyFile), legacyBytes);
  const copied = writes.find((item) => item.method === "POST" && item.body?.document?.id === "legacy-cart");
  assert.equal(copied.body.path, "docs/flows/boards/legacy-cart.json");
  const copyFile = join(fixture.root, "repositories", "shop", "docs", "flows", "boards", "legacy-cart.json");
  assert.equal(JSON.parse((await readFile(copyFile)).toString("utf8")).id, "legacy-cart");
  assert.equal((await readFile(copyFile)).includes(Buffer.from("export const board")), false);

  await waitFor(() => desktop.app.editors.catalog.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === cart.id && desktop.root.querySelector("[data-field='screen-width']"), "The Cart board did not open.");
  assert.equal(desktop.root.querySelector("[data-action='move-page']")?.getAttribute("disabled"), "");
  assert.equal(desktop.root.querySelector("[data-action='add-link']")?.getAttribute("disabled"), "");
  const cartRevision = desktop.app.editors.current.revision;
  typeInput(desktop.root.querySelector("[data-field='screen-width']"), "400", 0, 3);
  typeInput(desktop.root.querySelector("[data-field='screen-height']"), "844", 0, 3);
  click(desktop.root.querySelector("[data-action='resize-screen']"));
  await waitFor(() => desktop.app.editors.current?.revision !== cartRevision, "The screen resize was not saved.");
  const resized = writes.filter((item) => item.method === "PUT" && item.body?.document?.screens).at(-1);
  assert.equal(resized.body.expectedRevision, cartRevision);
  assert.equal(resized.body.document.sentinel, "document-sentinel");
  assert.equal(resized.body.document.screens[0].sentinel, "screen-sentinel");
  assert.equal(resized.body.document.screens[0].w, 400);
  assert.equal(resized.body.document.screens[0].root.w, 400);
  assert.equal(resized.body.document.screens[0].root.sentinel, "node-sentinel");
  assert.equal(resized.body.document.links[0].to, "missing-screen");
  assert.equal(resized.body.document.links[0].sentinel, "link-sentinel");
  assert.equal(resized.body.document.pages[0].sentinel, "page-sentinel");

  typeInput(desktop.root.querySelector("[data-field='create-id']"), "sample-board", 0, 12);
  typeInput(desktop.root.querySelector("[data-field='create-title']"), "Sample", 0, 6);
  click(desktop.root.querySelector("[data-action='create-resource']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.id === "sample-board", "The new board did not open.");
  const createdRevision = desktop.app.editors.current.revision;
  click(desktop.root.querySelector("[data-action='move-page']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.pages?.[0]?.id === "more", "The page order was not saved.");
  assert.equal(writes.filter((item) => item.method === "PUT" && item.body?.document?.id === "sample-board").at(-1).body.expectedRevision, createdRevision);
  const screenRevision = desktop.app.editors.current.revision;
  click(desktop.root.querySelector("[data-action='move-screen']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.pages?.find((page) => page.id === "main")?.order?.[0] === "next", "The screen order was not saved.");
  assert.equal(writes.filter((item) => item.method === "PUT" && item.body?.document?.id === "sample-board").at(-1).body.expectedRevision, screenRevision);
  const linkRevision = desktop.app.editors.current.revision;
  click(desktop.root.querySelector("[data-action='add-link']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.links?.some((link) => link.from === "empty" && link.to === "next"), "The internal link was not saved.");
  const linked = writes.filter((item) => item.method === "PUT" && item.body?.document?.id === "sample-board").at(-1);
  assert.equal(linked.body.expectedRevision, linkRevision);
  assert.equal(linked.body.document.links[0].transition, "cut");
  assert.equal(linked.body.document.pages[1].id, "main");
  assert.deepEqual(await readFile(legacyFile), legacyBytes);

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors.catalog.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === notes.id && desktop.root.querySelector("[data-action='replace-document']"), "The text did not open.");
  const textRevision = desktop.app.editors.current.revision;
  const textRev = desktop.app.editors.current.authoritative.document.rev;
  typeInput(desktop.root.querySelector("[data-field='document-title']"), "Revised notes", 0, 13);
  click(desktop.root.querySelector("[data-action='replace-document']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.title === "Revised notes", "The document replacement was not saved.");
  const replaced = writes.filter((item) => item.method === "PUT" && item.body?.document?.pages && !item.body.document.screens).at(-1);
  assert.equal(replaced.body.expectedRevision, textRevision);
  assert.equal(Object.hasOwn(replaced.body.document, "rev"), false);
  assert.equal(replaced.body.document.sentinel, "void-sentinel");
  assert.equal(desktop.app.editors.current.authoritative.document.rev, textRev + 1);
  assert.equal(desktop.app.editors.current.authoritative.document.pages[0].sentinel, "void-page-sentinel");
  assert.deepEqual(await readFile(originalFile), originalBytes);
  assert.deepEqual(await readFile(legacyFile), legacyBytes);

  const phone = await bootApp(fixture.phoneUrl, 390, []);
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.root.querySelector(".shell")?.getAttribute("data-layout") === "phone", "The phone shell did not appear.");
  phone.app.mode = "blueprint";
  renderShell(phone.app);
  assert.equal(phone.root.querySelector("[data-action='register-resource']"), null);
  assert.equal(phone.root.querySelector("[data-action='create-resource']"), null);
  assert.equal(phone.root.querySelector("[data-action='copy-json']"), null);
  assert.equal(phone.root.querySelector("[data-action='resize-screen']"), null);
  phone.app.mode = "document";
  renderShell(phone.app);
  assert.equal(phone.root.querySelector("[data-action='replace-document']"), null);
});

test("void drafts stay with their page and comments use the rendered selection", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (!init?.body || (init.method !== "POST" && init.method !== "PUT")) return;
    writes.push({ method: init.method, url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.includes("<b>Welcome</b>"), "The release text did not open.");
  const commentsBefore = () => writes.filter((item) => item.method === "POST" && item.url.includes("/comments"));
  click(desktop.root.querySelector("[data-action='comment-quote']"));
  await delay(40);
  assert.equal(commentsBefore().length, 0);
  const quote = textNodes(desktop.root.querySelector("[data-void]")).find((node) => node.textContent.includes("first"));
  const offset = quote.textContent.indexOf("first");
  desktop.document.getSelection = () => ({
    anchorNode: quote,
    anchorOffset: offset,
    focusNode: quote,
    focusOffset: offset + "first".length,
    isCollapsed: false,
  });
  click(desktop.root.querySelector("[data-action='comment-quote']"));
  await waitFor(() => commentsBefore().some((item) => item.body.anchor?.quote === "first"), "The comment did not use the rendered selection.");
  const anchor = commentsBefore().find((item) => item.body.anchor?.quote === "first").body.anchor;
  assert.equal(anchor.k, "Intro.Welcome");
  assert.equal(anchor.lang, "en");
  assert.equal(anchor.start, 10);
  assert.equal(anchor.end, 15);
  assert.equal(anchor.prefix, "Welcome\nA ");
  assert.equal(anchor.suffix, " paragraph.");

  const source = desktop.root.querySelector("[data-source]");
  const original = source.value;
  const broken = original.replace("<b>", "<");
  typeInput(source, broken, 0, 1);
  click(desktop.root.querySelector("[data-action='save-range']"));
  await waitFor(() => writes.some((item) => item.method === "POST" && item.url.includes("/ranges") && item.body.replacement === broken), "The unsafe range was not saved.");
  const ranged = writes.filter((item) => item.method === "POST" && item.url.includes("/ranges")).at(-1).body;
  assert.equal(ranged.start, 0);
  assert.equal(ranged.end, original.length);
  assert.equal(ranged.expectedText, original);
  assert.equal(ranged.k, "Intro.Welcome");
  assert.equal(ranged.lang, "en");
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.pages?.find((page) => page.k === "Intro.Welcome")?.en === broken
    && desktop.root.querySelector("[data-source]")?.value === broken, "The saved text was not shown.");
  await delay(150);

  const kept = `${broken} kept`;
  desktop.app.editors.current.revision = "a".repeat(64);
  typeInput(desktop.root.querySelector("[data-source]"), kept, 0, 4);
  click(desktop.root.querySelector("[data-action='save-range']"));
  await waitFor(() => desktop.app.editors.current?.conflict?.code === "revision_conflict", "The conflict draft was discarded.");
  assert.equal(desktop.root.querySelector("[data-source]").value, kept);
  assert.equal(textDraft(desktop.app.editors.current, notes.id, "Intro.Welcome", "en"), kept);

  typeInput(desktop.root.querySelector("[data-source]"), "", 0, 0);
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-source]").value, "");
  desktop.app.voidState.page = "Notes.Next";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-source]").value, "Next page.");
  desktop.app.voidState.page = "Intro.Welcome";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-source]").value, "");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-source]").value.includes("Bienvenida"), true);
  desktop.app.language = "en";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-source]").value, "");
  typeInput(desktop.root.querySelector("[data-source]"), "LOCAL DRAFT", 0, 5);
  desktop.app.voidState.page = "Notes.Next";
  renderShell(desktop.app);
  typeInput(desktop.root.querySelector("[data-field='create-id']"), "fresh-note", 0, 10);
  typeInput(desktop.root.querySelector("[data-field='create-title']"), "Fresh", 0, 5);
  click(desktop.root.querySelector("[data-action='create-resource']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.id === "fresh-note" && desktop.app.voidState?.page === "Intro.Welcome", "The new text did not open on its first page.");
  assert.equal(desktop.app.voidState.page, "Intro.Welcome");
  assert.notEqual(desktop.root.querySelector("[data-source]").value, "LOCAL DRAFT");
  assert.notEqual(desktop.root.querySelector("[data-source]").value, "Next page.");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === notes.id && desktop.root.querySelector("[data-source]")?.value === "LOCAL DRAFT", "The page draft was lost while switching texts.");
});

test("comments use a complete anchor and stay disabled until one exists", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (!init?.body || init.method !== "POST") return;
    writes.push({ url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='comment']") && desktop.root.querySelector("[data-node='label']"), "The board comment control did not appear.");
  const commentPosts = () => writes.filter((item) => item.url.includes("/comments") && item.body.anchor);
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), "");
  typeInput(desktop.root.querySelector("[data-comment]"), "Place the label", 0, 3);
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), "");
  click(desktop.root.querySelector("[data-action='comment']"));
  await delay(40);
  assert.equal(commentPosts().length, 0);
  const host = desktop.root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), null);
  click(desktop.root.querySelector("[data-action='comment']"));
  await waitFor(() => commentPosts().some((item) => item.body.text === "Place the label"), "The node comment was not sent.");
  const nodeAnchor = commentPosts().find((item) => item.body.text === "Place the label").body.anchor;
  assert.equal(nodeAnchor.screen, "empty");
  assert.equal(nodeAnchor.screenTitle, "Empty cart");
  assert.equal(nodeAnchor.element, "label");
  assert.equal(nodeAnchor.label, "Label");
  assert.deepEqual(nodeAnchor.path, ["Empty cart", "Root", "Label"]);
  assert.deepEqual(nodeAnchor.point, { x: 20, y: 24 });
  await waitFor(() => desktop.root.querySelector("[data-comment]")?.value === "", "The sent node comment remained.");

  clickEvent(desktop.root.querySelector(".board-host"), { target: desktop.root.querySelector("[data-screen='empty']"), offsetX: 8, offsetY: 9 });
  typeInput(desktop.root.querySelector("[data-comment]"), "Whole screen", 0, 5);
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), null);
  click(desktop.root.querySelector("[data-action='comment']"));
  await waitFor(() => commentPosts().some((item) => item.body.text === "Whole screen"), "The screen comment was not sent.");
  const screenAnchor = commentPosts().find((item) => item.body.text === "Whole screen").body.anchor;
  assert.equal(screenAnchor.screen, "empty");
  assert.equal(screenAnchor.screenTitle, "Empty cart");
  assert.equal(screenAnchor.element, null);
  assert.equal(screenAnchor.label, "Empty cart");
  assert.deepEqual(screenAnchor.path, ["Empty cart"]);
  assert.deepEqual(screenAnchor.point, { x: 8, y: 9 });
  await waitFor(() => desktop.root.querySelector("[data-comment]")?.value === "", "The sent screen comment remained.");

  clickEvent(desktop.root.querySelector(".board-host"), { target: desktop.root.querySelector(".board-host"), offsetX: -40, offsetY: -15 });
  typeInput(desktop.root.querySelector("[data-comment]"), "   ", 0, 3);
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), "");
  typeInput(desktop.root.querySelector("[data-comment]"), "On the canvas", 0, 3);
  click(desktop.root.querySelector("[data-action='comment']"));
  await waitFor(() => commentPosts().some((item) => item.body.text === "On the canvas"), "The canvas comment was not sent.");
  const canvas = commentPosts().find((item) => item.body.text === "On the canvas").body.anchor;
  assert.equal(canvas.screen, null);
  assert.equal(canvas.screenTitle, null);
  assert.equal(canvas.element, null);
  assert.equal(canvas.label, "Board");
  assert.deepEqual(canvas.path, ["Board"]);
  assert.deepEqual(canvas.point, { x: -40, y: -15 });
  await waitFor(() => desktop.root.querySelector("[data-comment]")?.value === "", "The sent canvas comment remained.");

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.includes("<b>Welcome</b>"), "The release text did not open.");
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), "");
  typeInput(desktop.root.querySelector("[data-comment]"), "Use the rendered words", 0, 3);
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), "");
  const quote = textNodes(desktop.root.querySelector("[data-void]")).find((node) => node.textContent.includes("first"));
  const offset = quote.textContent.indexOf("first");
  desktop.document.getSelection = () => ({
    anchorNode: quote,
    anchorOffset: offset,
    focusNode: quote,
    focusOffset: offset + "first".length,
    isCollapsed: false,
  });
  desktop.app.onCommentSelection();
  assert.equal(desktop.root.querySelector("[data-comment]").value, "Use the rendered words");
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), null);
  click(desktop.root.querySelector("[data-action='comment']"));
  await waitFor(() => commentPosts().some((item) => item.body.text === "Use the rendered words"), "The text comment was not sent.");
  const textAnchorBody = commentPosts().find((item) => item.body.text === "Use the rendered words").body.anchor;
  assert.equal(textAnchorBody.k, "Intro.Welcome");
  assert.equal(textAnchorBody.lang, "en");
  assert.equal(textAnchorBody.start, 10);
  assert.equal(textAnchorBody.end, 15);
  assert.equal(textAnchorBody.quote, "first");
  assert.equal(textAnchorBody.prefix, "Welcome\nA ");
  assert.equal(textAnchorBody.suffix, " paragraph.");
});

function clickEvent(node, event) {
  const payload = { preventDefault() {}, target: event.target ?? node, offsetX: event.offsetX ?? 0, offsetY: event.offsetY ?? 0 };
  for (const handler of node?.listeners?.get("click") ?? []) handler(payload);
}

function textNodes(node, found = []) {
  if (node?.tag === "#text") found.push(node);
  for (const child of node?.children ?? []) textNodes(child, found);
  return found;
}

test("unit and session forms use machines and clients, and the inspector shows the contract facts", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, urls, async (input, init) => {
    if (!init?.body || (init.method !== "POST" && init.method !== "PUT")) return;
    writes.push({ method: init.method, url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-session-activity]")?.getAttribute("data-session-activity") === "busy", "The session facts did not load.");
  const session = desktop.root.querySelectorAll("[data-session='20c58b80-4d93-88cd-83b3-39d78f1d9d5d']").find((node) => node.querySelector("[data-session-activity]"));
  assert.equal(session.querySelector("[data-session-quota]").getAttribute("data-session-quota"), "unknown");
  assert.equal(session.querySelector("[data-session-wake]").getAttribute("data-session-wake"), "enabled");
  assert.equal(desktop.root.querySelector("[data-machine='DESKTOP']").getAttribute("data-answers"), "true");
  const grant = desktop.root.querySelector("[data-grant-action='process.run']").parent;
  assert.equal(grant.querySelector("[data-grant-action]").getAttribute("data-grant-action"), "process.run");
  assert.equal(grant.querySelector("[data-grant-pattern]").textContent, "command: npm run build, cwd: project:shop");
  assert.equal(grant.querySelector("[data-action='revoke-grant']") == null, false);
  const reviewable = desktop.root.querySelector("[data-task='project:shop:029']");
  assert.equal(reviewable.getAttribute("data-reviewable"), "true");
  assert.equal(reviewable.querySelector("[data-action='accept']").disabled, false);
  assert.equal(desktop.root.querySelector("[data-task-detail='project:shop:029']").querySelector("[data-requirements]").getAttribute("data-requirements"), "SHOP-1");
  assert.equal(desktop.root.querySelector("[data-task-detail='project:shop:029']").querySelector("[data-approved-by]").getAttribute("data-approved-by"), "env:web:overlord-web");
  const gated = desktop.root.querySelector("[data-task='project:shop:030']");
  assert.equal(gated.getAttribute("data-reviewable"), "false");
  assert.equal(gated.querySelector("[data-action='accept']").disabled, true);
  assert.equal(desktop.root.querySelector("[data-task-detail='project:shop:030']").querySelector("[data-approved-by]").getAttribute("data-approved-by"), "");

  click(desktop.root.querySelector("[data-action='new-unit']"));
  await waitFor(() => desktop.document.querySelector("[data-form='unit']"), "The unit form did not open.");
  const unitForm = desktop.document.querySelector("[data-form='unit']");
  const machine = unitForm.querySelector("[name='machine']");
  const machineOptions = machine.querySelectorAll("option");
  assert.equal(machineOptions.find((option) => option.getAttribute("value") === "OFFLINE").getAttribute("disabled"), "");
  assert.equal(machineOptions.find((option) => option.getAttribute("value") === "DESKTOP").getAttribute("disabled"), null);
  assert.equal(unitForm.querySelector("[data-machine-issue='OFFLINE']") == null, false);
  typeInput(unitForm.querySelector("[name='unit']"), "executor-made", 0, 13);
  unitForm.querySelector("[name='leadId']").value = "env:web:overlord-web";
  typeInput(unitForm.querySelector("[name='job']"), "builder", 0, 7);
  typeInput(unitForm.querySelector("[name='model']"), "strong", 0, 6);
  typeInput(unitForm.querySelector("[name='positionX']"), "12", 0, 2);
  typeInput(unitForm.querySelector("[name='positionY']"), "24", 0, 2);
  click(unitForm.querySelector("[data-action='confirm-form']"));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-made"), "The new unit did not appear.");
  const created = writes.find((item) => item.body?.unit === "executor-made");
  assert.equal(created.body.role, "executor");
  assert.deepEqual(created.body.scope, { kind: "project", name: "shop" });
  assert.equal(created.body.machine, "DESKTOP");
  assert.equal(created.body.leadId, "env:web:overlord-web");
  assert.equal(created.body.job, "builder");
  assert.equal(created.body.model, "strong");
  assert.deepEqual(created.body.position, { x: 12, y: 24 });

  const adjutant = desktop.app.unitList.catalog.find((unit) => unit.id === "root:adjutant");
  desktop.app.activeHandlers.onActivate({ id: adjutant.id, kind: "unit", unit: adjutant }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === "root:adjutant", "The adjutant inspector did not open.");
  const beforeSession = urls.length;
  click(desktop.root.querySelector("[data-action='start-session']"));
  await waitFor(() => desktop.document.querySelector("[data-form='session']"), "The session form did not open.");
  const sessionForm = desktop.document.querySelector("[data-form='session']");
  const clients = sessionForm.querySelector("[name='client']").querySelectorAll("option").map((option) => option.getAttribute("value"));
  assert.deepEqual(clients, ["claude", "codex", "cursor"]);
  sessionForm.querySelector("[name='client']").value = "codex";
  typeInput(sessionForm.querySelector("[name='prompt']"), "Check the build", 0, 15);
  click(sessionForm.querySelector("[data-action='confirm-form']"));
  await waitFor(() => urls.slice(beforeSession).some((url) => url.includes("/session-requests/")), "The queued session was not read back.");
  const started = writes.find((item) => item.body?.client === "codex");
  assert.deepEqual(Object.keys(started.body).sort(), ["client", "expectedRevision", "prompt"]);
  assert.equal(started.body.prompt, "Check the build");
  assert.equal(noteText(desktop), "The session is queued.");

  const blog = desktop.app.unitList.catalog.find((unit) => unit.id === "project:blog:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: blog.id, kind: "unit", unit: blog }, "double");
  await waitFor(() => desktop.root.querySelector("[data-machine='OFFLINE']")?.getAttribute("data-answers") === "false", "The silent machine was not shown.");
  click(desktop.root.querySelector("[data-action='start-session']"));
  await waitFor(() => desktop.document.querySelector("[data-form='session']")?.querySelector("[data-client-unavailable]"), "The unavailable client was still offered.");
  const silentForm = desktop.document.querySelector("[data-form='session']");
  assert.equal(silentForm.querySelector("[name='client']"), null);
  assert.equal(silentForm.querySelector("[data-action='confirm-form']").disabled, true);
  assert.equal(silentForm.querySelector("[data-machine-issue='OFFLINE']") == null, false);
});

test("unsaved forms share one dirty flag and only a saved draft clears it", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method !== "PATCH" || !init.body) return;
    writes.push({ url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  const embedMessages = [];
  await waitFor(() => desktop.app.chatList?.catalog?.length > 0 && desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The desktop lists did not load.");
  desktop.app.embed = {
    disposed: false,
    viewer: { embedded: true, hostOrigin: "http://127.0.0.1:9", viewerId: "viewer-dirty", capabilities: DESKTOP },
    transport: { parent: { postMessage(data) { embedMessages.push(data); } } },
  };
  const dirtyPatches = () => writes.filter((item) => item.url.includes("/viewer") && Object.prototype.hasOwnProperty.call(item.body ?? {}, "dirty"));
  const dirtyMessages = () => embedMessages.filter((item) => item.type === "dirty");
  navigate(desktop.app, "chats");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-composer]"), "The chat composer did not open.");
  typeInput(desktop.root.querySelector("[data-composer]"), "Hold", 0, 4);
  await waitFor(() => dirtyPatches().some((item) => item.body.dirty === true), "Chat text did not mark the viewer dirty.");
  typeInput(desktop.root.querySelector("[data-composer]"), "Hold!", 0, 5);
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "single");
  await waitFor(() => desktop.root.querySelector("[data-note='project:shop:030']"), "The return note did not appear.");
  typeInput(desktop.root.querySelector("[data-note='project:shop:030']"), "Fix", 0, 3);
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-node-name]"), "The node name field did not open.");
  typeInput(desktop.root.querySelector("[data-node-name]"), "Label 2", 0, 7);
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.includes("<b>Welcome</b>"), "The release text did not open.");
  const source = desktop.root.querySelector("[data-source]");
  typeInput(source, `${source.value}!`, 0, 1);
  typeInput(desktop.root.querySelector("[data-draft]"), "Auxiliary", 0, 9);
  assert.equal(dirtyPatches().filter((item) => item.body.dirty === true).length, 1);
  assert.equal(dirtyMessages().filter((item) => item.value === true).length, 1);
  assert.equal(dirtyPatches().some((item) => item.body.dirty === false), false);
  assert.equal(desktop.app.inputDrafts.chats.get(chat.id).value, "Hold!");
  assert.equal(desktop.app.inputDrafts.notes.get("project:shop:030").value, "Fix");

  navigate(desktop.app, "chats");
  await waitFor(() => desktop.root.querySelector("[data-composer]")?.value === "Hold!", "The chat draft was not restored.");
  typeInput(desktop.root.querySelector("[data-composer]"), "", 0, 0);
  typeInput(desktop.root.querySelector("[data-note='project:shop:030']"), "", 0, 0);
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.id === cart.id), "The board catalog did not return.");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-node-name]")?.value === "Label 2", `The node draft was not restored. value=${desktop.root.querySelector("[data-node-name]")?.value ?? "missing"} stored=${desktop.app.inputDrafts.nodes?.get(cart.id) ?? "missing"}`);
  typeInput(desktop.root.querySelector("[data-node-name]"), "", 0, 0);
  assert.equal(dirtyPatches().some((item) => item.body.dirty === false), false);
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.id === notes.id), "The text catalog did not return.");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.endsWith("!"), "The source draft was discarded with the other forms.");
  click(desktop.root.querySelector("[data-action='save-range']"));
  await waitFor(() => !(desktop.app.editors.current?.textDrafts?.size), "The source draft was not saved.");
  assert.equal(dirtyPatches().some((item) => item.body.dirty === false), false);
  typeInput(desktop.root.querySelector("[data-draft]"), "", 0, 0);
  await waitFor(() => dirtyPatches().some((item) => item.body.dirty === false) && dirtyMessages().some((item) => item.value === false), "Saving the last draft did not clear the dirty flag.");
  assert.equal(dirtyPatches().filter((item) => item.body.dirty === true).length, 1);
  assert.equal(desktop.app.inputDrafts.chats.get(chat.id).value, "");
  assert.equal(desktop.app.inputDrafts.notes.get("project:shop:030").value, "");
  assert.equal(desktop.app.viewerDirty, false);

  const phoneUrls = [];
  const phone = await bootApp(fixture.phoneUrl, 390, phoneUrls);
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.app.chatList?.catalog?.length, "The phone chat list did not load.");
  click(phone.root.querySelector("[data-phone-mode='chats']"));
  const phoneChat = phone.app.chatList.catalog[0];
  phone.app.activeHandlers.onActivate({ id: phoneChat.id, kind: "chat" }, "double");
  await waitFor(() => phone.root.querySelector("[data-composer]"), "The phone composer did not open.");
  typeInput(phone.root.querySelector("[data-composer]"), "Local only", 0, 10);
  await delay(40);
  assert.equal(phoneUrls.some((url) => url.includes("/viewer")), false);
  assert.equal(phone.app.inputDrafts.chats.get(phoneChat.id).value, "Local only");
});

test("the GUI import graph stays inside its ownership table", async () => {
  const plan = await readFile("docs/3.0/plan-gui.md", "utf8");
  const section = plan.split("## File ownership")[1].split("\n## ")[0];
  const owned = new Set([...section.matchAll(/`((?:gui\/app|test)\/[^`]+)`/g)].map((match) => match[1]));
  assert.equal(owned.has("gui/app/phone.mjs"), true);
  assert.equal(owned.has("gui/app/embed.mjs"), true);
  assert.equal(owned.has("test/gui-fixture.mjs"), true);
  const seen = new Set();
  async function walk(file) {
    const rel = relative(process.cwd(), file).replaceAll("\\", "/");
    if (seen.has(rel)) return;
    seen.add(rel);
    assert.equal(owned.has(rel), true, rel);
    const source = await readFile(file, "utf8");
    assert.equal(source.includes("import("), false, rel);
    const specifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.equal(specifier.startsWith(".") || specifier.startsWith("node:"), true, specifier);
      assert.equal(/engine|cli|features|https?:|node_modules/.test(specifier), false, specifier);
      if (specifier.startsWith("node:")) {
        assert.equal(rel.startsWith("gui/"), false, specifier);
        continue;
      }
      await walk(resolve(file, "..", specifier));
    }
  }
  await walk(resolve("gui/app/main.mjs"));
  await walk(resolve("test/gui-fixture.mjs"));
  await walk(resolve("test/gui-data.mjs"));
});

function qrDigest(matrix) {
  const text = matrix.map((row) => row.map((cell) => (cell ? "1" : "0")).join("")).join("\n");
  return createHash("sha256").update(text).digest("hex");
}

function apiFrom(url) {
  const parsed = new URL(url);
  return createApi({
    location: { origin: parsed.origin, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { replaceState() {} },
    fetch: globalThis.fetch.bind(globalThis),
  });
}

async function exchangeHome(fixture, key) {
  const response = await exchangeRaw(fixture, key);
  assert.equal(response.status, 200);
  return response.json.data.token;
}

async function exchangeRaw(fixture, key) {
  const home = new URL(fixture.phoneUrl);
  const response = await fetch(`${home.origin}/api/v1/auth/home`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: home.origin },
    body: JSON.stringify({ key }),
  });
  return { status: response.status, json: await response.json() };
}

function jsonEnvelope(status, data) {
  const body = JSON.stringify({
    contract: "hivem1nd-gui-v3",
    data,
    meta: { requestId: "req", readAt: "2026-10-10T12:00:00.000Z", eventCursor: "0", sync: "local" },
  });
  return { status, ok: status >= 200 && status < 300, headers: { get() { return null; } }, text: async () => body };
}

function noteText(booted) {
  return booted.root.querySelector("[data-action-note]")?.textContent ?? "";
}

function typeInput(node, value, start, end) {
  node.value = value;
  node.selectionStart = start;
  node.selectionEnd = end;
  node.focus();
  for (const handler of node.listeners?.get("input") ?? []) handler();
}

function click(node) {
  for (const handler of node?.listeners?.get("click") ?? []) handler({ preventDefault() {}, target: node });
}

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (check()) return;
    await delay(25);
  }
  throw new Error(label);
}

async function until(check) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await delay(20);
  }
  throw new Error("The phone shell did not reach the expected state.");
}

async function bootApp(url, width, urls, onFetch) {
  const { document, root, view } = createTestDocument(width);
  const parsed = new URL(url);
  const app = await mount(root, {
    location: { origin: parsed.origin, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { replaceState() {} },
    fetch: async (input, init) => {
      urls.push(String(input));
      if (onFetch) await onFetch(input, init);
      return fetch(input, init);
    },
  });
  return { app, root, view, document };
}

function fakeParent() {
  const parent = { sent: null, postMessage(data, origin) { this.sent = { data, origin }; } };
  return { parent, transport: { parent, addEventListener() {}, removeEventListener() {} } };
}

async function bootstrapSecret(root) {
  const entries = await readdir(root, { recursive: true });
  const hit = entries.find((entry) => String(entry).endsWith("bootstrap.json"));
  return JSON.parse(await readFile(join(root, hit), "utf8")).secret;
}

async function localViewer(fixture, secret, viewer) {
  const response = await fetch(`${fixture.origin}/api/v1/auth/local`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.origin, Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ embedded: true, hostOrigin: "http://127.0.0.1:9", look: viewer.look, language: viewer.language }),
  });
  const json = await response.json();
  assert.equal(response.status, 201);
  return json.data;
}

function createTestDocument(width = 390) {
  const document = {
    documentElement: null,
    body: null,
    activeElement: null,
    defaultView: null,
    createElement(tag) { return make(tag, null); },
    createElementNS(namespace, tag) { return make(tag, namespace); },
    createTextNode(value) { return make("#text", null, String(value)); },
    createDocumentFragment() { return make("#fragment", null); },
  };
  const view = { parent: null, innerWidth: width, innerHeight: 844, addEventListener() {}, removeEventListener() {}, requestAnimationFrame() { return 0; }, postMessage() {} };
  document.defaultView = view;
  function make(tag, namespace, text = "") {
    const node = {
      tag,
      tagName: tag.startsWith("#") ? "" : String(tag).toUpperCase(),
      namespace,
      children: [],
      attributes: new Map(),
      listeners: new Map(),
      className: "",
      textContent: text,
      value: "",
      disabled: false,
      tabIndex: 0,
      scrollTop: 0,
      clientWidth: width,
      clientHeight: 640,
      get offsetHeight() {
        if (Number.isFinite(this._offsetHeight)) return this._offsetHeight;
        if (this.getAttribute?.("data-message")) return 48;
        return 0;
      },
      get offsetTop() {
        if (Number.isFinite(this._offsetTop)) return this._offsetTop;
        const parent = this.parent;
        if (!parent?.children) return 0;
        let top = 0;
        for (const child of parent.children) {
          if (child === this) return top;
          top += child.offsetHeight || 0;
        }
        return 0;
      },
      get scrollHeight() {
        if (Number.isFinite(this._scrollHeight)) return this._scrollHeight;
        return (this.children ?? []).reduce((sum, child) => sum + (child.offsetHeight || 0), 0);
      },
      isConnected: true,
      style: {},
      dataset: {},
      ownerDocument: document,
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name.startsWith("data-")) {
          const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          this.dataset[key] = String(value);
        }
      },
      getAttribute(name) { return this.attributes.get(name) ?? null; },
      append(...kids) { for (const kid of kids) this.appendChild(kid); },
      appendChild(kid) {
        if (kid == null) return;
        kid.parent = this;
        this.children.push(kid);
      },
      replaceChildren(...kids) {
        this.children = [];
        this.append(...kids);
      },
      addEventListener(type, handler) {
        const list = this.listeners.get(type) ?? [];
        list.push(handler);
        this.listeners.set(type, list);
      },
      removeEventListener() {},
      querySelector(selector) { return find(this, selector, false); },
      querySelectorAll(selector) { return find(this, selector, true); },
      focus() { this.ownerDocument.activeElement = this; },
      setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
      contains(node) {
        let current = node;
        while (current) {
          if (current === this) return true;
          current = current.parent;
        }
        return false;
      },
      showModal() { this.setAttribute("open", ""); },
      close() {
        this.removeAttribute("open");
        for (const handler of this.listeners.get("close") ?? []) handler();
      },
      remove() {
        const parent = this.parent;
        if (!parent?.children) return;
        parent.children = parent.children.filter((child) => child !== this);
        this.parent = null;
      },
      removeAttribute(name) {
        this.attributes.delete(name);
        if (name.startsWith("data-")) {
          const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          delete this.dataset[key];
        }
      },
      closest(selector) {
        let current = this;
        while (current) {
          if (selectorMatches(current, selector)) return current;
          current = current.parent;
        }
        return null;
      },
      getBoundingClientRect() { return { left: 0, top: 0, width, height: 700 }; },
    };
    return node;
  }
  function find(node, selector, all) {
    const found = [];
    const visit = (current) => {
      for (const child of current.children ?? []) {
        if (selectorMatches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(node);
    return all ? found : (found[0] ?? null);
  }
  document.documentElement = make("html");
  document.body = make("body");
  document.documentElement.append(document.body);
  const root = make("div");
  document.body.append(root);
  document.querySelector = (selector) => find(document.documentElement, selector, false);
  document.querySelectorAll = (selector) => find(document.documentElement, selector, true);
  return { document, root, view };
}

function selectorMatches(node, selector) {
  return selector.split(",").some((part) => selectorPart(node, part.trim()));
}

function selectorPart(node, selector) {
  if (!node || node.tag === "#text") return false;
  let rest = selector;
  if (/^[A-Za-z]/.test(rest)) {
    const tag = /^[A-Za-z][\w-]*/.exec(rest)[0];
    if (node.tag !== tag) return false;
    rest = rest.slice(tag.length);
  }
  while (rest.startsWith(".")) {
    const name = /^[\w-]+/.exec(rest.slice(1))?.[0];
    if (!name || !String(node.className ?? "").split(/\s+/).includes(name)) return false;
    rest = rest.slice(1 + name.length);
  }
  while (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0) return false;
    const body = rest.slice(1, end);
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);
    const expected = eq === -1 ? null : body.slice(eq + 1).replace(/^["']|["']$/g, "");
    const actual = node.getAttribute?.(name);
    if (actual == null || (expected != null && actual !== expected)) return false;
    rest = rest.slice(end + 1);
  }
  return rest.length === 0;
}

async function assertAbsent(root, secret) {
  const entries = await readdir(root, { recursive: true });
  for (const entry of entries) {
    const file = join(root, entry);
    let body = "";
    try {
      body = await readFile(file, "utf8");
    } catch {
      continue;
    }
    assert.equal(body.includes(secret), false, String(entry));
  }
}
