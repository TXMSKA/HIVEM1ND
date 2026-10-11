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
import { DICTIONARIES, cardinal, dictionaryKeys, formatClock, formatWhen, limitsUsage, text } from "../gui/app/i18n.mjs";
import { encodeHomeQr } from "../gui/app/qr.mjs";
import { canPerform, exchangeCode, exchangeHomeFragment, logout, renderCodeEntry, renderPhone } from "../gui/app/phone.mjs";
import { applyIssueChange, applyServiceBeat, applySettingsRead, applySyncSnapshot, armExpiry, clearGrant, closeHome, limitsLabel, noteHomeChange, openHome, saveSettings, takeGrant, updateExpiry } from "../gui/app/settings.mjs";
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup } from "../gui/app/hierarchy.mjs";
import { collectPages, createPagedList, loadAll, moveFocus, renderWindow, setQuery } from "../gui/app/lists.mjs";
import { flushLayout, queueLayoutPatch } from "../gui/app/map.mjs";
import { setAttachments, startWatch } from "../gui/app/editors.mjs";
import { renderSession, renderUnit } from "../gui/app/inspector.mjs";
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
  assert.equal(text("en", "boards"), "Boards");
  assert.equal(text("es", "boards"), "Tableros");
  assert.equal(text("en", "texts"), "Texts");
  assert.equal(text("es", "texts"), "Textos");
  assert.equal(text("en", "comments"), "Comments");
  assert.equal(text("es", "comments"), "Comentarios");
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
  assert.equal(html.includes("mark.svg"), false);
  assert.match(html, /rel="icon" href="data:image\/svg\+xml/);
  assert.equal(html.includes("%23bdcd79"), true);
  await assert.rejects(readFile("gui/app/mark.svg"), (error) => error.code === "ENOENT");
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
  list.scrollTop = 4000;
  const first = setQuery(list, "alpha");
  assert.equal(list.scrollTop, 0);
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
  list.scrollTop = 4000;
  const short = rows.slice(0, 6);
  short[5].text = "unit-1200 Out";
  renderWindow(host.ownerDocument, host, list, short, {});
  assert.equal(list.scrollTop, 0);
  assert.match([...host.querySelectorAll("[data-row]")].map((row) => row.textContent).join("\n"), /unit-1200/);

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
  list.height = 581;
  host.clientHeight = 293;
  host.getBoundingClientRect = () => ({ top: 0, bottom: host.clientHeight });
  const Node = host.constructor;
  Node.prototype.getBoundingClientRect = function rect() {
    if (this.getAttribute?.("data-id") === "project:bulk:unit-1200") return { top: 864, bottom: 900 };
    return { top: 0, bottom: 36 };
  };
  const endEvent = { key: "End", target: { getAttribute: () => null }, preventDefault() {} };
  for (const fn of host.listeners.get("keydown")) fn(endEvent);
  assert.equal(list.focusId, "project:bulk:unit-1200");
  assert.ok(list.scrollTop >= (1200 * list.rowHeight) - host.clientHeight);
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

test("sync snapshots, service beats, and local expiry do not extend a grant", () => {
  const synced = applySyncSnapshot({ incoming: [{ machine: "LAPTOP" }] }, {
    state: "paused",
    pendingChanges: 4,
    limits: { state: "slowing", retryAt: "2099-01-01T00:00:10.000Z", messages: { used: 40, max: 60 }, syncBytes: { used: 8, max: 50 } },
    retryAt: "2099-01-01T00:00:10.000Z",
    error: null,
  });
  assert.equal(synced.state, "paused");
  assert.equal(synced.pendingChanges, 4);
  assert.equal(synced.limits.state, "slowing");
  assert.equal(synced.incoming[0].machine, "LAPTOP");
  assert.equal(limitsLabel("slowing"), "limitsSlowing");
  assert.equal(limitsLabel("paused"), "limitsPaused");
  assert.equal(limitsLabel("normal"), "limitsNormal");
  const service = applyServiceBeat({ machine: "DESKTOP", originKind: "folder" }, { id: "LAPTOP", version: "3.0.1", state: "running", answers: true });
  assert.equal(service.machine, "LAPTOP");
  assert.equal(service.originKind, "folder");
  assert.equal(applyServiceBeat({ machine: "DESKTOP", originKind: "folder" }, "DESKTOP").originKind, "folder");
  const issues = applyIssueChange([], { issue: { path: "a", code: "bad_record", message: "Unreadable" }, resolved: false });
  assert.equal(issues.length, 1);
  assert.equal(applyIssueChange(issues, { issue: issues[0], resolved: true }).length, 0);
  const expiresAt = "2099-01-01T00:00:10.000Z";
  const now = Date.parse("2099-01-01T00:00:00.000Z");
  const state = { home: { enabled: true, expiresAt }, grant: { key: "secret", shortCode: "1234", links: [], qrPayloads: ["payload"] }, tickMs: null };
  let scheduled = null;
  armExpiry(state, now, (fn, ms) => { scheduled = { fn, ms }; return 7; }, () => {});
  assert.equal(scheduled.ms, 10000);
  assert.equal(state.grant.key, "secret");
  state.tickMs = 1000;
  armExpiry(state, now, (fn, ms) => { scheduled = { fn, ms }; return 8; }, () => {});
  assert.equal(scheduled.ms, 1000);
  assert.equal(scheduled.ms <= 10000, true);
  const expired = { home: { enabled: true, expiresAt: "2020-01-01T00:00:00.000Z" }, grant: { key: "secret", shortCode: "1", links: ["http://127.0.0.1"], qrPayloads: ["payload"] } };
  let called = false;
  armExpiry(expired, Date.parse("2020-01-01T00:00:05.000Z"), () => { called = true; return 1; }, () => {});
  assert.equal(called, false);
  assert.equal(expired.grant, null);
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
  assert.equal(phone.root.querySelector(".stage"), null);
  assert.equal((phone.root.textContent ?? "").includes("This screen is not ready yet."), false);
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
  navigate(desktop.app, "settings");
  assert.equal(desktop.root.querySelector("[data-settings]") != null, true);
  assert.equal(desktop.root.querySelector("[data-waiting-surface]"), null);
  navigate(desktop.app, "map");
  assert.equal(desktop.root.querySelector("[data-waiting-surface]") != null, true);

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
  await waitFor(() => desktop.root.querySelector("[data-action='open-register']")?.getAttribute("data-kind") === "blueprint", "The registration form was not shown.");
  click(desktop.root.querySelector("[data-action='open-register']"));
  typeInput(desktop.document.querySelector("[data-field='register-path']"), "docs/flows/boards/legacy-cart.mjs", 0, 0);
  click(desktop.document.querySelector("[data-action='register-resource']"));
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

  click(desktop.root.querySelector("[data-action='open-create']"));
  typeInput(desktop.document.querySelector("[data-field='create-id']"), "sample-board", 0, 12);
  typeInput(desktop.document.querySelector("[data-field='create-title']"), "Sample", 0, 6);
  click(desktop.document.querySelector("[data-action='create-resource']"));
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
  assert.equal(phone.root.querySelector("[data-action='open-register']"), null);
  assert.equal(phone.root.querySelector("[data-action='create-resource']"), null);
  assert.equal(phone.root.querySelector("[data-action='open-create']"), null);
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
  click(desktop.root.querySelector("[data-action='open-create']"));
  typeInput(desktop.document.querySelector("[data-field='create-id']"), "fresh-note", 0, 10);
  typeInput(desktop.document.querySelector("[data-field='create-title']"), "Fresh", 0, 5);
  click(desktop.document.querySelector("[data-action='create-resource']"));
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
  assert.equal(unitForm.querySelectorAll("[name='scopeKind']").length, 3);
  assert.equal([...unitForm.querySelectorAll("[name='scopeKind']")].find((node) => node.checked)?.value, "project");
  assert.equal(unitForm.querySelector("[name='positionX']").getAttribute("inputmode"), "numeric");
  assert.equal(unitForm.querySelector("[id='position-hint']")?.textContent.includes("minus"), true);
  const leadChoices = unitForm.querySelectorAll("[data-lead-choice]").length;
  typeInput(unitForm.querySelector("[name='leadId']"), "overlord-web", 0, 12);
  assert.equal(unitForm.querySelectorAll("[data-lead-choice]").length < leadChoices, true);
  assert.equal(unitForm.querySelector("[data-lead-choice='env:web:overlord-web']") != null, true);
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

test("an invalid unit form stays open and a rejected unit keeps its draft", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method === "POST" || init?.method === "PUT") writes.push({ method: init.method, url: String(input), body: init.body ? JSON.parse(init.body) : null });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  const unitPosts = () => writes.filter((item) => item.method === "POST" && item.url.endsWith("/units"));
  click(desktop.root.querySelector("[data-action='new-unit']"));
  await waitFor(() => desktop.document.querySelector("[data-form='unit']"), "The unit form did not open.");
  const form = () => desktop.document.querySelector("[data-form='unit']");
  typeInput(form().querySelector("[name='unit']"), "Retain this draft", 0, 17);
  typeInput(form().querySelector("[name='job']"), "Retain this draft", 0, 17);
  click(form().querySelector("[data-action='confirm-form']"));
  const unitField = form().querySelector("[name='unit']");
  const nameError = form().querySelector("[data-field-error='unit']");
  assert.equal(unitPosts().length, 0);
  assert.equal(unitField.getAttribute("aria-invalid"), "true");
  assert.equal(unitField.getAttribute("aria-describedby"), nameError.getAttribute("id"));
  assert.equal(nameError.closest("label"), unitField.closest("label"));
  assert.equal(nameError.textContent, "Use a lowercase name made of letters, digits, dots, underscores, or hyphens.");
  assert.equal(desktop.document.activeElement, unitField);
  assert.equal(unitField.value, "Retain this draft");
  assert.equal(form().querySelector("[name='job']").value, "Retain this draft");

  typeInput(unitField, "executor-kept", 0, 13);
  const openDialog = form();
  const pick = (attribute, value = null) => {
    const seen = new Set();
    const visit = (node) => {
      if (!node || seen.has(node)) return null;
      seen.add(node);
      const actual = node.getAttribute?.(attribute);
      if (value == null ? actual != null : actual === value) return node;
      for (const child of node.children ?? []) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(openDialog);
  };
  pick("name", "leadId").value = "not-a-real-lead";
  click(pick("data-action", "confirm-form"));
  await waitFor(() => pick("data-dialog-error")?.textContent === "That connection is not valid.", "The rejected unit did not stay in the form.");
  assert.equal(pick("name", "unit").value, "executor-kept");
  assert.equal(pick("name", "job").value, "Retain this draft");
  assert.equal(pick("data-action", "confirm-form").textContent, "Retry");
  assert.equal(openDialog.parent == null, false);

  pick("name", "leadId").value = "";
  click(pick("data-action", "confirm-form"));
  assert.equal(pick("data-action", "confirm-form").getAttribute("aria-busy"), "true");
  assert.equal(pick("name", "unit").value, "executor-kept");
  assert.equal(pick("name", "job").value, "Retain this draft");
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-kept"), "The corrected unit was not created.");
  await waitFor(() => openDialog.parent == null, "The unit dialog stayed open after it was created.");
  assert.equal(desktop.document.activeElement === desktop.root.querySelector("[data-action='new-unit']"), true);
  const created = unitPosts().find((item) => item.body?.unit === "executor-kept");
  assert.equal(created.body.job, "Retain this draft");

  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-action='start-session']"), "The session control did not appear.");
  click(desktop.root.querySelector("[data-action='start-session']"));
  await waitFor(() => desktop.document.querySelector("[data-form='session']"), "The session form did not open.");
  const sessionForm = desktop.document.querySelector("[data-form='session']");
  sessionForm.querySelector("[name='client']").value = "";
  const beforeSession = writes.length;
  click(sessionForm.querySelector("[data-action='confirm-form']"));
  const client = sessionForm.querySelector("[name='client']");
  assert.equal(client.getAttribute("aria-describedby"), sessionForm.querySelector("[data-field-error='client']").getAttribute("id"));
  assert.equal(desktop.document.activeElement, client);
  assert.equal(writes.slice(beforeSession).some((item) => item.url.includes("/session")), false);
  const cancel = [...sessionForm.querySelectorAll("button")].find((button) => button.getAttribute("data-action") !== "confirm-form");
  click(cancel);
  assert.equal(desktop.document.querySelector("[data-form='session']"), null);
  assert.equal(desktop.document.activeElement === desktop.root.querySelector("[data-action='start-session']"), true);
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
  assert.equal(dirtyPatches().filter((item) => item.body.dirty === true).length, 1);
  assert.equal(dirtyMessages().filter((item) => item.value === true).length, 1);
  assert.equal(dirtyPatches().some((item) => item.body.dirty === false), false);
  assert.equal(desktop.app.inputDrafts.chats.get(chat.id).value, "Hold!");
  assert.equal(desktop.app.inputDrafts.notes.get("project:shop:030").value, "Fix");

  navigate(desktop.app, "map");
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

test("Blueprint and Document place the catalog beside the comments", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const layout = desktop.root.querySelector("[data-editor-layout]");
  assert.equal(layout?.getAttribute("data-editor-layout"), "blueprint");
  assert.equal(layout.className.includes("workspace-editor"), true);
  assert.deepEqual([...layout.children].map((node) => node.getAttribute("data-editor-column")), ["catalog", "resource", "comments"]);
  assert.equal(layout.querySelector("[data-editor-column='catalog']").querySelector("h2").textContent, "Boards");
  assert.equal(layout.querySelector("[data-editor-column='comments']").querySelector("h2").textContent, "Comments");
  assert.equal(desktop.root.querySelector("[role='tab']"), null);
  assert.equal(desktop.root.querySelector(".side"), null);
  assert.equal(desktop.root.querySelector(".inspector"), null);
  assert.equal(layout.querySelector("[data-editor-column='catalog']").querySelector("[data-action='open-register']")?.getAttribute("data-kind"), "blueprint");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-editor-column='catalog']").querySelector("h2").textContent, "Tableros");
  assert.equal(desktop.root.querySelector("[data-editor-column='comments']").querySelector("h2").textContent, "Comentarios");
  desktop.app.language = "en";
  renderShell(desktop.app);
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector(".board-host"), "The board did not open.");
  const resource = desktop.root.querySelector("[data-editor-column='resource']");
  const comments = desktop.root.querySelector("[data-editor-column='comments']");
  const tools = resource.querySelector("[data-editor-tools]");
  assert.equal(tools.querySelector("[data-watch]")?.getAttribute("data-watch"), "off");
  assert.equal(tools.querySelector("[data-action='attach']") != null, true);
  assert.equal(tools.querySelector("[data-action='watch']") != null, true);
  assert.equal(columnIndex(resource, tools) < columnIndex(resource, resource.querySelector(".board-host")), true);
  assert.equal(resource.querySelector("[data-node-name]") != null, true);
  assert.equal(resource.querySelector("[data-comment]"), null);
  assert.equal(comments.querySelector("[data-comment]") != null, true);
  assert.equal(comments.querySelector(".board-host"), null);

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const documentLayout = desktop.root.querySelector("[data-editor-layout]");
  assert.equal(documentLayout.getAttribute("data-editor-layout"), "document");
  assert.equal(documentLayout.querySelector("[data-editor-column='catalog']").querySelector("h2").textContent, "Texts");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.includes("<b>Welcome</b>"), "The release text did not open.");
  const textResource = desktop.root.querySelector("[data-editor-column='resource']");
  const textComments = desktop.root.querySelector("[data-editor-column='comments']");
  const textTools = textResource.querySelector("[data-editor-tools]");
  assert.equal(columnIndex(textResource, textTools) < columnIndex(textResource, textResource.querySelector("[data-source]")), true);
  assert.equal(textTools.querySelector("[data-action='watch']") != null, true);
  assert.equal(textResource.querySelector("[data-source]") != null, true);
  assert.equal(textResource.querySelector("[data-draft]"), null);
  assert.equal(textResource.querySelector("[data-action='save-range']") != null, true);
  assert.equal(textComments.querySelector("[data-comment]") != null, true);
  assert.equal(textComments.querySelector("[data-source]"), null);

  const css = await readFile("gui/app/styles.css", "utf8");
  const modern = css.split('[data-look="high-contrast"]')[0];
  const contrast = css.split('[data-look="high-contrast"]')[1];
  assert.match(modern, /--editor-side:\s*228px/);
  assert.match(modern, /--editor-comments:\s*368px/);
  assert.match(contrast, /--editor-side:\s*240px/);
  assert.match(contrast, /--editor-comments:\s*380px/);
  assert.match(css, /\.workspace-editor\s*\{[^}]*grid-template-columns:\s*var\(--editor-side\)\s+minmax\(0,\s*1fr\)\s+var\(--editor-comments\)/);
});

test("a narrow desktop keeps the main column and dismisses the side panels", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 320, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  assert.equal(desktop.root.querySelector(".shell").getAttribute("data-layout"), "desktop");
  assert.equal(desktop.root.querySelector(".side").className.includes("is-open"), false);
  assert.equal(desktop.root.querySelector("[data-editor-column='resource']"), null);
  click(desktop.root.querySelector("[data-action='toggle-catalog']"));
  assert.equal(desktop.root.querySelector(".side").className.includes("is-open"), true);
  click(desktop.root.querySelector("[data-action='toggle-catalog']"));
  assert.equal(desktop.root.querySelector(".side").className.includes("is-open"), false);
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.root.querySelector("[data-editor-column='resource']"), "The board column did not stay available.");
  assert.equal(desktop.root.querySelector("[data-editor-column='catalog']").className.includes("is-open"), false);
  assert.equal(desktop.root.querySelector("[data-editor-column='comments']").className.includes("is-open"), false);
  click(desktop.root.querySelector("[data-action='toggle-comments']"));
  assert.equal(desktop.root.querySelector("[data-editor-column='comments']").className.includes("is-open"), true);
  click(desktop.root.querySelector("[data-action='toggle-catalog']"));
  assert.equal(desktop.root.querySelector("[data-editor-column='catalog']").className.includes("is-open"), true);
  desktop.app.language = "es";
  desktop.app.look = "high-contrast";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector(".shell").getAttribute("data-layout"), "desktop");
  assert.equal(desktop.root.querySelector("[data-action='toggle-catalog']").textContent, text("es", "hideCatalog"));
  assert.equal(desktop.root.querySelector("[data-action='toggle-comments']").textContent, text("es", "hideComments"));
  const css = await readFile("gui/app/styles.css", "utf8");
  const start = css.indexOf("@media (max-width: 987px)");
  const narrow = css.slice(start, css.indexOf("@media", start + 10));
  assert.match(narrow, /\.workspace\.workspace-editor\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.equal(narrow.includes("var(--editor-side)"), false);
  assert.equal(narrow.includes("var(--editor-comments)"), false);
  assert.equal(narrow.includes("minmax(180px"), false);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /\.shell \* \{\s*min-width:\s*0;\s*\}/);
  assert.match(css, /\.modes\s*\{[^}]*flex-wrap:\s*wrap/);
});

test("board nodes and named controls are available from the keyboard", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-node][tabindex='0']"), "The board node was not keyboard focusable.");
  const node = desktop.root.querySelector("[data-node][tabindex='0']");
  assert.equal(node.getAttribute("role"), "treeitem");
  assert.equal(node.getAttribute("aria-label").length > 0, true);
  const host = node.closest(".board-host");
  for (const handler of host.listeners.get("keydown") ?? []) handler({ key: "Enter", target: node, preventDefault() {} });
  assert.equal(desktop.app.editors.commentTarget.kind, "node");
  assert.equal(desktop.app.editors.commentTarget.nodeId, node.getAttribute("data-node"));
  const outline = desktop.root.querySelector(".board-outline");
  assert.equal(outline.getAttribute("aria-label"), "Screens and nodes");
  const item = outline.querySelector("[data-outline]");
  click(item);
  assert.equal(desktop.app.editors.selectedNodeId ?? desktop.app.editors.commentTarget.screenId, item.getAttribute("data-outline"));
  const asset = desktop.root.querySelector("[data-asset]");
  assert.equal(asset.closest("label").querySelector(".field-label").textContent, "Upload");
  assert.equal(asset.getAttribute("aria-describedby"), asset.closest("label").querySelector(".field-hint").getAttribute("id"));
  assert.equal(desktop.root.querySelector("[data-node-name]").closest("label").querySelector(".field-label").textContent, "Node name");
  assert.equal(desktop.root.querySelector("[data-draft]"), null);
  const comment = desktop.root.querySelector("[data-comment]");
  assert.equal(comment.closest("label").querySelector(".field-label").textContent, "Comment");
  assert.equal(comment.closest("label").querySelector(".field-hint").textContent, "Choose a screen or node, then write the comment.");

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]"), "The source field did not open.");
  assert.equal(desktop.root.querySelector("[data-source]").closest("label").querySelector(".field-label").textContent, "Source");
  assert.equal(desktop.root.querySelector("[data-source]").closest("[data-source-edit]") != null, true);
  click(desktop.root.querySelector("[data-action='open-create']"));
  assert.equal(desktop.document.querySelector("[data-field='create-title']").closest("label").querySelector(".field-hint").textContent, "The title people see.");

  navigate(desktop.app, "map");
  await waitFor(() => desktop.root.querySelector("[data-action='new-unit']"), "The unit control did not return.");
  click(desktop.root.querySelector("[data-action='new-unit']"));
  await waitFor(() => desktop.document.querySelector("[data-form='unit']"), "The unit dialog did not open.");
  const dialog = desktop.document.querySelector("[data-form='unit']");
  const heading = dialog.querySelector("h2");
  assert.equal(dialog.getAttribute("aria-labelledby"), heading.getAttribute("id"));
  assert.match(heading.getAttribute("id"), /^dialog-title-\d+$/);
  const firstId = heading.getAttribute("id");
  click(dialog.querySelector("[data-action='cancel-form']"));
  click(desktop.root.querySelector("[data-action='new-unit']"));
  await waitFor(() => desktop.document.querySelector("[data-form='unit']")?.querySelector("h2")?.getAttribute("id") !== firstId, "The second dialog reused the heading id.");

  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-addresses]"), "The address field did not open.");
  assert.equal(desktop.root.querySelector("[data-addresses]").closest("label").querySelector(".field-label").textContent, "Addresses");

  navigate(desktop.app, "chats");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-composer]"), "The composer did not open.");
  assert.equal(desktop.root.querySelector("[data-composer]").closest("label").querySelector(".field-label").textContent, "Message");

  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "single");
  await waitFor(() => desktop.root.querySelector("[data-note='project:shop:030']"), "The return note did not appear.");
  const note = desktop.root.querySelector("[data-note='project:shop:030']");
  assert.equal(note.closest("label").querySelector(".field-label").textContent, "Send back");
  assert.equal(note.getAttribute("aria-describedby"), note.closest("label").querySelector(".field-hint").getAttribute("id"));

  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-note='project:shop:030']").closest("label").querySelector(".field-label").textContent, "Devolver");
});

test("Focus keeps only the readable document until the pointer reveals its tools", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='enter-focus']"), "The Focus control did not appear.");
  click(desktop.root.querySelector("[data-action='enter-focus']"));
  assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "focus");
  const reading = desktop.root.querySelector("[data-focus-layout]");
  assert.equal(reading?.getAttribute("data-focus-layout"), "document");
  assert.equal(desktop.root.querySelector(".workspace-focus")?.children.length, 1);
  assert.equal(textNodes(reading.querySelector(".void-page")).some((node) => node.textContent.includes("Welcome")), true);
  assert.equal(reading.querySelector("[data-tools]")?.getAttribute("data-tools"), "hidden");
  assert.equal(desktop.root.querySelector("[data-editor-column]"), null);
  assert.equal(desktop.root.querySelector("[data-editor-tools]"), null);
  assert.equal(desktop.root.querySelector("[data-comment]"), null);
  assert.equal(desktop.root.querySelector(".side"), null);
  assert.equal(desktop.root.querySelector(".inspector"), null);
  assert.equal(desktop.root.querySelector(".foot") != null, true);
  for (const look of ["high-contrast", "modern"]) {
    desktop.app.look = look;
    renderShell(desktop.app);
    assert.equal(desktop.app.look, look);
    assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "focus");
    assert.equal(desktop.root.querySelector("[data-editor-column]"), null);
    assert.equal(desktop.root.querySelector(".void-page") != null, true);
  }
  const stale = desktop.root.querySelector("[data-action='enter-focus']");
  for (const handler of desktop.root.listeners?.get("pointermove") ?? []) handler();
  assert.equal(desktop.root.querySelector("[data-tools]")?.getAttribute("data-tools"), "visible");
  assert.equal(desktop.root.querySelector(".void-tools")?.className.includes("is-visible"), true);
  for (const handler of desktop.view.listeners?.get("keydown") ?? []) {
    handler({ key: "Escape", target: { tagName: "BODY" }, preventDefault() {} });
  }
  const fresh = desktop.root.querySelector("[data-action='enter-focus']");
  assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "document");
  assert.equal(fresh != null && fresh !== stale, true);
  assert.equal(desktop.document.activeElement, fresh);
  assert.equal(fresh.closest("[data-editor-layout]")?.getAttribute("data-editor-layout"), "document");
  navigate(desktop.app, "focus");
  assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "focus");
  assert.equal(desktop.root.querySelector("[data-tools]")?.getAttribute("data-tools"), "hidden");
  const css = await readFile("gui/app/styles.css", "utf8");
  const focusCss = css.slice(css.indexOf('[data-mode="focus"]'));
  assert.match(focusCss, /background:\s*#000000/);
  assert.match(focusCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(focusCss, /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(focusCss, /\[data-mode="focus"\] \.foot[\s\S]*display:\s*none/);
  assert.match(focusCss, /box-shadow:\s*none/);
});

test("mounted map circles use translated status and keep pan", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector("[data-unit-id='root:overseer']"), "The map circles did not render.");
  const overseer = desktop.root.querySelector("[data-unit-id='root:overseer']");
  const lead = desktop.root.querySelector("[data-unit-id='env:web:overlord-web']");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  const shop = desktop.root.querySelector("[data-unit-id='project:shop:executor-shop']");
  assert.equal(overseer.getAttribute("data-ring"), "overseer");
  assert.equal(overseer.className.includes("is-overseer"), true);
  assert.equal(overseer.querySelector("[data-role-icon='crown']") != null, true);
  assert.equal(overseer.querySelector("[data-map-label]").textContent, "overseer");
  assert.equal(lead.getAttribute("data-ring"), "lead");
  assert.equal(lead.className.includes("is-lead"), true);
  assert.equal(shop.getAttribute("data-role"), executor.role);
  assert.equal(shop.querySelector("[data-map-label]").textContent, executor.unit);
  assert.equal(desktop.root.querySelector("[data-action='pan']") != null, true);
  desktop.app.language = "es";
  renderShell(desktop.app);
  const status = desktop.root.querySelector("[data-unit-id='project:shop:executor-shop']").querySelector("[data-status]");
  const key = { working: "statusWorking", waiting: "statusWaiting", idle: "statusIdle", out: "statusOut", quota: "statusQuota" }[status.getAttribute("data-status")] ?? "statusUnknown";
  assert.equal(status.getAttribute("aria-label"), text("es", key));
  desktop.app.mapState.selection = new Set(["root:overseer"]);
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-unit-id='root:overseer']").className.includes("is-selected"), true);
});

test("settings and the footer follow sync, service, and issue changes", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-settings]"), "Settings did not open.");
  const retryAt = "2099-01-01T00:00:10.000Z";
  await fixture.control.emit("sync.changed", {
    state: "paused",
    pendingChanges: 4,
    limits: {
      state: "paused",
      retryAt,
      messages: { used: 61, max: 60, windowSeconds: 60 },
      syncBytes: { used: 12, max: 50000000, windowSeconds: 3600 },
    },
    retryAt,
    error: null,
  });
  await waitFor(() => desktop.root.querySelector("[data-sync='paused']")?.textContent === "Sync is paused", "The paused sync state was not shown.");
  assert.equal(desktop.root.querySelector("[data-pending-changes]")?.textContent, "4 changes waiting");
  assert.equal(desktop.root.querySelector("[data-limits='paused']")?.getAttribute("data-retry-at"), retryAt);
  const limitText = desktop.root.querySelector("[data-limits='paused']").textContent;
  assert.equal(limitText.includes(retryAt), false);
  assert.equal(limitText.includes("2099"), true);
  assert.equal(limitText.includes("T"), false);
  const usage = desktop.root.querySelector("[data-limit-usage]")?.textContent ?? "";
  assert.equal(usage.includes("61 of 60"), true);
  assert.equal(usage.includes("50,000,000"), true);
  assert.equal(usage.includes("50000000"), false);
  await fixture.control.emit("service.changed", { machine: { id: "LAPTOP", version: "3.0.1", state: "running", answers: true } });
  await waitFor(() => desktop.root.querySelector("[data-service-machine]")?.getAttribute("data-service-machine") === "LAPTOP", "The service machine was not updated.");
  await fixture.control.emit("issue.changed", { issue: { path: "units/shop", code: "bad_record", message: "The unit file is unreadable." }, resolved: false });
  await waitFor(() => [...desktop.root.querySelector("[data-issues]").children].some((node) => node.textContent === "The unit file is unreadable."), "The issue was not shown.");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-sync='paused']")?.textContent, "La sincronización está en pausa");
  assert.equal(desktop.root.querySelector("[data-limits='paused']").textContent.includes("en pausa"), true);
  await fixture.control.emit("issue.changed", { issue: { path: "units/shop", code: "bad_record", message: "The unit file is unreadable." }, resolved: true });
  await waitFor(() => ![...desktop.root.querySelector("[data-issues]").children].some((node) => node.textContent === "The unit file is unreadable."), "The resolved issue remained.");
});

test("a replayed unit event is applied once and the cursor advances", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, urls);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "root:master"), "The unit list did not load.");
  const unitReads = () => urls.filter((url) => url.includes("/api/v1/units")).length;
  const before = unitReads();
  const current = desktop.app.store.indexes.units.get("root:master");
  const id = await fixture.control.emit("unit.changed", { unit: current });
  await waitFor(() => {
    const list = desktop.app.unitList;
    return unitReads() > before && (list?.status === "ready" || list?.status === "empty") && !list?.nextCursor && desktop.app.store.cursor === id;
  }, "The unit change was not consumed.");
  const after = unitReads();
  await fixture.control.replay(id);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assert.equal(unitReads(), after);
    assert.equal(desktop.app.store.cursor, id);
    await delay(25);
  }
});

test("action notes use bilingual outcomes and keep wire codes for diagnostics", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.mapState?.onConnect && desktop.app.unitList?.catalog?.some((unit) => unit.id === "root:master"), "The map did not load.");
  desktop.app.mapState.onConnect({ source: "env:web:overlord-web", target: "root:master" });
  click(desktop.document.querySelector("dialog").querySelector(".primary"));
  await waitFor(() => desktop.document.querySelector("[data-dialog-error]")?.textContent === "That connection is not valid.", "The connection note was not translated.");
  assert.equal(desktop.document.querySelector("[data-dialog-error]").getAttribute("data-code"), "invalid_lead");
  assert.equal(desktop.document.querySelector("[data-dialog-error]").textContent.includes("root:master"), false);
  click(desktop.document.querySelector("dialog").querySelector("button"));
  await waitFor(() => desktop.document.querySelector("dialog") == null, "Cancel did not close the connection dialog.");

  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-task='project:shop:030']"), "The task list did not load.");
  click(desktop.root.querySelector("[data-task='project:shop:030']").querySelector("[data-action='send-back']"));
  await waitFor(() => noteText(desktop) === "A note is required.", "The missing note was shown as a raw code.");
  assert.equal(desktop.root.querySelector("[data-action-note]").getAttribute("data-code"), "note_required");
  click(desktop.root.querySelector("[data-task='project:shop:029']").querySelector("[data-action='accept']"));
  await waitFor(() => noteText(desktop) === "The task is done.", "The task status was shown as a wire value.");
  assert.equal(desktop.root.querySelector("[data-action-note]").getAttribute("data-code"), "done");
  assert.notEqual(noteText(desktop), "Approved");

  desktop.app.language = "es";
  await waitFor(() => desktop.root.querySelector("[data-task='project:shop:029']")?.querySelector("[data-action='undo']"), "Undo did not appear.");
  click(desktop.root.querySelector("[data-task='project:shop:029']").querySelector("[data-action='undo']"));
  await waitFor(() => noteText(desktop) === "La tarea está en revisión.", "The Spanish task outcome was not shown.");

  fixture.control.setFault({ method: "POST", path: "/api/v1/units/root:adjutant/session", status: 422, code: "totally_unknown" });
  desktop.app.language = "en";
  const adjutant = desktop.app.unitList.catalog.find((unit) => unit.id === "root:adjutant");
  desktop.app.activeHandlers.onActivate({ id: adjutant.id, kind: "unit", unit: adjutant }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === "root:adjutant", "The adjutant inspector did not open.");
  click(desktop.root.querySelector("[data-action='start-session']"));
  await waitFor(() => desktop.document.querySelector("[data-form='session']"), "The session form did not open.");
  click(desktop.document.querySelector("[data-form='session']").querySelector("[data-action='confirm-form']"));
  await waitFor(() => noteText(desktop) === "The action failed. Try again.", "An unknown code was shown to the reader.");
  assert.equal(desktop.root.querySelector("[data-action-note]").getAttribute("data-code"), "totally_unknown");
});

test("request expiry stays separate from reopening guidance and comments require text", async (t) => {
  assert.equal(text("en", "sessionExpired"), "This session ended. Open HIVEM1ND again.");
  assert.equal(text("es", "sessionExpired"), "Esta sesión terminó. Abrir HIVEM1ND de nuevo.");
  assert.equal(text("en", "sessionRequestExpired"), "The session request expired.");
  assert.equal(text("es", "sessionRequestExpired"), "La solicitud de sesión expiró.");

  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (!init?.body || init.method !== "POST") return;
    writes.push({ url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector("[data-handle='connect']"), "The connect handle did not appear.");
  const connectLabel = () => {
    const handle = desktop.root.querySelector("[data-handle='connect']");
    const unitId = handle.getAttribute("data-unit-id");
    const named = [...desktop.root.querySelectorAll("[data-map-label]")].find((item) => item.closest("[data-unit-id]")?.getAttribute("data-unit-id") === unitId);
    return { handle, name: named.getAttribute("data-map-label") };
  };
  assert.equal(connectLabel().handle.getAttribute("aria-label"), `Connect ${connectLabel().name}`);
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(connectLabel().handle.getAttribute("aria-label"), `Conectar ${connectLabel().name}`);
  desktop.app.language = "en";
  renderShell(desktop.app);

  await fixture.control.emit("session.request.changed", {
    requestId: "11111111-1111-4111-8111-111111111111",
    unitId: "root:overseer",
    machine: "DESKTOP",
    state: "expired",
    sessionId: null,
    error: null,
  });
  await waitFor(() => noteText(desktop) === "The session request expired.", "Request expiry reused the reopening sentence.");
  assert.notEqual(noteText(desktop), "This session ended. Open HIVEM1ND again.");

  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='comment-node']"), "The node comment control did not appear.");
  const commentBodies = () => writes.filter((item) => item.url.includes("/comments")).map((item) => item.body.text);
  click(desktop.root.querySelector("[data-action='comment-node']"));
  await delay(40);
  assert.equal(commentBodies().includes("On the node."), false);
  typeInput(desktop.root.querySelector("[data-comment]"), "   ", 0, 3);
  click(desktop.root.querySelector("[data-action='comment-node']"));
  await delay(40);
  assert.equal(commentBodies().includes("On the node."), false);
  assert.equal(commentBodies().some((item) => item?.trim?.() === ""), false);
  typeInput(desktop.root.querySelector("[data-comment]"), "Pinned here", 0, 11);
  click(desktop.root.querySelector("[data-action='comment-node']"));
  await waitFor(() => commentBodies().includes("Pinned here"), "The supplied node comment was not sent.");

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='reply']"), "The reply control did not appear.");
  const replies = () => writes.filter((item) => item.url.includes("/replies")).map((item) => item.body.text);
  click(desktop.root.querySelector("[data-action='reply']"));
  await delay(40);
  assert.equal(replies().includes("Noted."), false);
  typeInput(desktop.root.querySelector("[data-comment]"), "   ", 0, 3);
  click(desktop.root.querySelector("[data-action='reply']"));
  await delay(40);
  assert.equal(replies().includes("Noted."), false);
  typeInput(desktop.root.querySelector("[data-comment]"), "A reply", 0, 7);
  click(desktop.root.querySelector("[data-action='reply']"));
  await waitFor(() => replies().includes("A reply"), "The supplied reply was not sent.");
});

test("a shell refresh keeps the focused editor field and its caret", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]"), "The source field did not appear.");
  const sourceEdit = desktop.root.querySelector("[data-source-edit]");
  sourceEdit.setAttribute("open", "");
  sourceEdit.open = true;
  let typed = "";
  for (const letter of ["A", "B", "C"]) {
    const source = desktop.root.querySelector("[data-source]");
    typed += letter;
    source.focus();
    source.value = typed;
    source.selectionStart = typed.length;
    source.selectionEnd = typed.length;
    for (const handler of source.listeners.get("input") ?? []) handler();
    renderShell(desktop.app);
    const again = desktop.root.querySelector("[data-source]");
    const edit = desktop.root.querySelector("[data-source-edit]");
    assert.equal(edit.getAttribute("open") != null, true);
    assert.equal(again.value, typed);
    assert.equal(desktop.document.activeElement, again);
    assert.equal(again.selectionStart, typed.length);
  }
  click(desktop.root.querySelector("[data-action='open-create']"));
  const title = desktop.document.querySelector("[data-field='create-title']");
  title.focus();
  title.value = "Kept";
  title.selectionStart = 4;
  title.selectionEnd = 4;
  for (const handler of title.listeners.get("input") ?? []) handler();
  renderShell(desktop.app);
  const titleAgain = desktop.document.querySelector("[data-field='create-title']");
  assert.equal(titleAgain.value, "Kept");
  assert.equal(desktop.document.activeElement === titleAgain, true);
  assert.equal(titleAgain.selectionStart, 4);
});

test("editor forms, chats, and the inspector stay compact", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length > 0, "The chat list did not load.");
  navigate(desktop.app, "chats");
  desktop.app.chatList.height = 4000;
  renderShell(desktop.app);
  const rows = desktop.app.activeRows ?? [];
  assert.equal(rows.some((row) => row.kind === "heading"), true);
  const sample = rows.find((row) => row.kind === "chat");
  assert.equal(String(sample?.text ?? "").includes(sample?.chat?.title || sample?.chat?.id || ""), true);
  if (sample?.chat?.lastMessage) {
    const snippet = sample.chat.lastMessage.body || sample.chat.lastMessage.subject || "";
    if (snippet) assert.equal(sample.text.includes(snippet), true);
    const stamp = sample.chat.lastMessage.timestamp || sample.chat.lastMessage.date || "";
    if (stamp) assert.equal(sample.text.includes(stamp), false);
  }
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-chat-title]")?.textContent === (chat.title || chat.id), "The conversation title was not shown.");
  await waitFor(() => desktop.root.querySelector(".bubble-meta"), "The message sender was not shown.");
  assert.equal(desktop.root.querySelector(".bubble-meta").textContent.includes("master"), true);
  assert.equal(desktop.root.querySelector("[data-message]")?.closest(".bubble") != null, true);

  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='attach']"), "The attach control did not appear.");
  assert.equal(desktop.root.querySelector(".attach-list"), null);
  assert.equal(desktop.root.querySelector(".attach-chips") != null, true);
  click(desktop.root.querySelector("[data-action='attach']"));
  const chooser = desktop.document.querySelector("[data-form='attach']");
  assert.equal(chooser != null, true);
  assert.equal(chooser.querySelector("[data-attach-search]") != null, true);
  const offered = chooser.querySelectorAll("[data-attach-unit]").length;
  assert.equal(offered > 0 && offered <= 40, true);
  typeInput(chooser.querySelector("[data-attach-search]"), "zzzz", 0, 4);
  assert.equal(chooser.querySelectorAll("[data-attach-unit]").length, 0);
  chooser.close();

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-editor-column='comments']")?.querySelector(".comment-author")?.textContent === "master", "The comment author was not shown.");
  const source = desktop.root.querySelector("[data-source]");
  assert.equal(source?.closest("[data-source-edit]") != null, true);
  assert.equal(desktop.root.querySelector(".reading-card") != null, true);
  const comments = desktop.root.querySelector("[data-editor-column='comments']");
  assert.equal(comments.querySelector("[data-action='accept-change']") != null, true);
  assert.equal(desktop.root.querySelector("[data-editor-column='resource']")?.querySelector("[data-action='accept-change']"), null);

  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  navigate(desktop.app, "hierarchy");
  navigate(desktop.app, "map");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector(".inspector-details")?.querySelector("summary")?.textContent === "Details", "The inspector details did not appear.");
  assert.equal(desktop.root.querySelector(".unit-card") != null, true);
});

test("editor events refresh attachments, assets, delivery and conflicts", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === cart.id && desktop.root.querySelector("[data-comment]"), "The board did not open.");
  desktop.app.editors.selectedNodeId = "kept-node";
  typeInput(desktop.root.querySelector("[data-comment]"), "Keep this draft", 0, 4);

  await fixture.control.emit("editor.attachments.changed", {
    resourceId: cart.id,
    attached: ["env:web:overlord-web"],
    revision: "a".repeat(64),
  });
  await waitFor(() => desktop.root.querySelector("[data-chip='env:web:overlord-web']"), "The attachment chip did not refresh.");

  desktop.app.editors.current.attachmentChoice = new Set(["project:shop:executor-shop"]);
  await fixture.control.emit("editor.attachments.changed", {
    resourceId: cart.id,
    attached: ["root:master"],
    revision: "b".repeat(64),
  });
  await waitFor(() => desktop.root.querySelector("[data-attachment-conflict]"), "The attachment draft was not kept.");
  assert.equal(desktop.app.editors.current.attachmentChoice.has("project:shop:executor-shop"), true);
  assert.equal(desktop.app.editors.current.attachmentChoice.has("root:master"), false);

  await fixture.control.emit("editor.asset.created", {
    resourceId: cart.id,
    asset: {
      id: "mark",
      src: "assets/mark.png",
      contentType: "image/png",
      bytes: 8,
      revision: "c".repeat(64),
      url: "/api/v1/missing-asset",
    },
  });
  await waitFor(() => desktop.app.editors.current.assetRecords?.some((item) => item.id === "mark"), "The asset was not recorded.");
  assert.equal(desktop.app.editors.selectedNodeId, "kept-node");

  await fixture.control.emit("notification.changed", {
    noticeKey: "watch",
    unitId: "env:web:overlord-web",
    resourceId: cart.id,
    state: "failed",
    error: { code: "not_attached", message: "The unit is not attached." },
  });
  await waitFor(() => desktop.root.querySelector("[data-notice='failed']"), "The delivery failure was not shown.");
  assert.equal(desktop.document.querySelector("[data-live='error']")?.textContent, "The notice failed. Nothing was delivered.");

  await fixture.control.emit("sync.conflict", {
    target: { kind: "mind", path: "units/shop.md" },
    winnerMachine: "OTHER",
    copyPath: "conflicts/shop.md",
    at: "2026-10-10T12:00:00.000Z",
  });
  await waitFor(() => desktop.root.querySelector("[data-sync-conflict]")?.textContent.includes("conflicts/shop.md"), "The sync conflict was not shown.");
  assert.equal(desktop.document.querySelector("[data-live='error']")?.textContent.includes("conflicts/shop.md"), true);
  assert.equal(desktop.root.querySelector("[data-comment]").value, "Keep this draft");
  assert.equal(desktop.app.editors.selectedNodeId, "kept-node");
});

test("phone navigation stays compact and focus can leave the source", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const phone = await bootApp(fixture.phoneUrl, 390, []);
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.root.querySelector(".shell")?.getAttribute("data-layout") === "phone", "The phone shell did not appear.");
  assert.equal([...phone.root.querySelectorAll("h2")].some((node) => node.textContent === "Snapshot"), false);
  assert.equal(phone.root.querySelector("[data-phone-issues]")?.querySelector("summary")?.textContent.includes("issues"), true);
  assert.equal(phone.root.querySelector("[data-phone-title]")?.textContent, "Hierarchy");
  assert.equal(phone.root.querySelector("[data-phone-hint]")?.textContent, "Use the bottom buttons to switch views.");
  assert.equal(phone.root.querySelector("[data-phone-mode='hierarchy']")?.getAttribute("aria-pressed"), "true");
  await waitFor(() => phone.app.chatList?.catalog?.length, "The phone chat list did not load.");
  click(phone.root.querySelector("[data-phone-mode='chats']"));
  const chat = phone.app.chatList.catalog[0];
  phone.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => phone.root.querySelector("[data-stage-title]")?.textContent === (chat.title || chat.id), "The phone conversation title was not shown.");
  assert.equal(phone.root.querySelector("[data-stage-title]").textContent === "Hierarchy", false);
  await waitFor(() => phone.root.querySelector(".bubble-meta"), "The phone message sender was not shown.");
  await waitFor(() => {
    const wanted = (phone.app.waitingList?.items ?? []).some((item) => item.kind === "approval" || item.kind === "review");
    return !wanted || phone.root.querySelector("[data-phone-card]");
  }, "The phone approval card did not appear.");
  const css = await readFile("gui/app/styles.css", "utf8");
  assert.match(css, /\.shell\[data-layout="phone"\] \.phone-nav button\[aria-pressed="true"\]/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /border-radius:\s*var\(--radius-pill\)/);

  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='enter-focus']"), "The Focus control did not appear.");
  click(desktop.root.querySelector("[data-action='enter-focus']"));
  const source = desktop.root.querySelector("[data-source]");
  source.focus();
  for (const handler of desktop.view.listeners?.get("keydown") ?? []) {
    handler({ key: "Escape", target: source, preventDefault() {} });
  }
  assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "document");
  click(desktop.root.querySelector("[data-action='enter-focus']"));
  for (const handler of desktop.root.listeners?.get("focusin") ?? []) handler();
  assert.equal(desktop.root.querySelector("[data-tools]")?.getAttribute("data-tools"), "visible");
  assert.equal(desktop.root.querySelector("[data-action='leave-focus']")?.textContent, "Return to document");
  assert.equal(desktop.root.querySelector("[data-focus-hint]") != null, true);
  click(desktop.root.querySelector("[data-action='leave-focus']"));
  assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "document");
});

test("disabled controls explain how to continue", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-task='project:shop:030']")?.querySelector("[data-disabled-reason='accept']")?.textContent === "Accept is available when the task is in review.", "The accept reason was not shown.");
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-look='modern']")?.getAttribute("aria-pressed") === "true", "The current look was not marked.");
  assert.equal(desktop.root.querySelector("[data-look='high-contrast']")?.getAttribute("aria-pressed"), "false");
  assert.equal(desktop.root.querySelector("[data-language='en']")?.getAttribute("aria-pressed"), "true");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='resize-screen']"), "The resize control did not appear.");
  assert.equal(desktop.root.querySelector("[data-action='patch-node']")?.getAttribute("disabled"), "");
  assert.equal(desktop.root.querySelector("[data-action='remove-node']")?.getAttribute("disabled"), "");
  assert.equal(desktop.root.querySelector("[data-disabled-reason='node']")?.textContent, "Select a shape on the board first.");
  assert.equal(desktop.root.querySelector("[data-disabled-reason='add-link']")?.textContent, "A link needs two screens.");
  typeInput(desktop.root.querySelector("[data-field='screen-width']"), "no", 0, 2);
  click(desktop.root.querySelector("[data-action='resize-screen']"));
  await waitFor(() => noteText(desktop) === "Enter a whole width and height before resizing.", "The resize reason was not shown.");
});

test("an editor action names its failure and waits inside its dialog", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  let nodePosts = 0;
  let releaseNodes = () => {};
  const nodeHold = new Promise((resolve) => { releaseNodes = resolve; });
  let attachPosts = 0;
  let releaseAttach = () => {};
  const attachHold = new Promise((resolve) => { releaseAttach = resolve; });
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    const target = String(input);
    if (init?.method === "POST" && target.includes("/nodes")) {
      nodePosts += 1;
      if (nodePosts === 1) await nodeHold;
    }
    if (init?.method === "PUT" && target.includes("/attachments")) {
      attachPosts += 1;
      if (attachPosts === 1) await attachHold;
    }
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  desktop.app.editors.catalogWindow.height = 4000;
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='add-node']"), "The shape control did not appear.");
  click(desktop.root.querySelector("[data-action='add-node']"));
  await waitFor(() => nodePosts === 1, "The shape write did not start.");
  click(desktop.root.querySelector("[data-action='add-node']"));
  assert.equal(nodePosts, 1);
  releaseNodes();
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.screens?.some((screen) => JSON.stringify(screen).includes("added-1")), "The shape was not saved.");

  desktop.app.mode = "map";
  desktop.app.chatList.status = "empty";
  desktop.app.chatList.query = "";
  desktop.app.tab = "chats";
  renderShell(desktop.app);
  const listed = desktop.root.querySelector(".list-total");
  assert.equal(listed?.getAttribute("data-list-status"), "empty");
  assert.equal(listed?.textContent, "No conversations yet.");
  assert.equal(desktop.root.querySelector("[data-action='show-map']")?.textContent, "Show the map");

  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.root.querySelector("[data-action='attach']"), "The attach control did not return.");
  click(desktop.root.querySelector("[data-action='attach']"));
  const chooser = desktop.document.querySelector("[data-form='attach']");
  click(chooser.querySelector("[data-attach-unit]"));
  click(chooser.querySelector("[data-action='save-attachments']"));
  await waitFor(() => chooser.querySelector("[data-attach-progress]") && chooser.getAttribute("open") != null, "The attach dialog closed before the save finished.");
  releaseAttach();
  await waitFor(() => desktop.document.querySelector("[data-form='attach']") == null, "The saved attach dialog stayed open.");
  assert.equal(attachPosts, 1);

  const resourceId = desktop.app.editors.current.resourceId;
  fixture.control.setFault({ method: "PUT", path: `/api/v1/editors/${resourceId}/attachments`, status: 422, code: "invalid_body" });
  click(desktop.root.querySelector("[data-action='attach']"));
  const failedChooser = desktop.document.querySelector("[data-form='attach']");
  click(failedChooser.querySelector("[data-action='save-attachments']"));
  await waitFor(() => failedChooser.querySelector("[data-dialog-error]")?.textContent.includes("Attach failed."), "The failed attach did not stay in the dialog.");
  assert.equal(failedChooser.getAttribute("open") != null, true);
  const retry = failedChooser.querySelector("[data-action='save-attachments']");
  assert.equal(retry.children.some((child) => child.textContent === "Retry"), true);
  click(retry);
  await waitFor(() => desktop.document.querySelector("[data-form='attach']") == null, "Retry did not finish the attach save.");
});

test("counts, clocks, and session facts follow the active language", () => {
  assert.equal(cardinal("en", "unitCount", 1), "1 unit");
  assert.equal(cardinal("en", "unitCount", 0), "0 units");
  assert.equal(cardinal("es", "unitCount", 1), "1 unidad");
  assert.equal(cardinal("es", "issueCount", 1), "1 incidencia");
  assert.equal(cardinal("en", "pendingChanges", 1), "1 change waiting");
  assert.equal(text("en", "nothingToUndo"), "No task change to undo.");
  assert.equal(text("es", "nothingToUndo"), "No hay un cambio de tarea para deshacer.");
  const stamp = "2026-10-10T12:00:00.000Z";
  const clock = formatClock("en", stamp);
  assert.equal(clock.includes("12:00"), true);
  assert.equal(clock.includes(stamp), false);
  assert.equal(formatWhen("en", stamp).includes(stamp), false);
  assert.equal(formatWhen("en", "not-a-date"), "not-a-date");
  const one = limitsUsage("en", { used: 1, max: 2 }, { used: 1, max: 2 });
  assert.equal(one.includes("1 of 2 message"), true);
  assert.equal(one.includes("messages"), false);
  assert.equal(limitsUsage("en", { used: 12, max: 60 }, { used: 50000000, max: 50000000 }).includes("50,000,000"), true);
  const { document } = createTestDocument();
  const t = (key, variables) => text("en", key, variables);
  const idle = renderSession(document, {
    id: "s1",
    activity: "idle",
    quota: null,
    wake: { enabled: true, pausedReason: "handoff-budget-exhausted" },
  }, t);
  assert.equal(idle.querySelector("[data-session-activity]").textContent, "The session is idle.");
  assert.equal(idle.querySelector("[data-session-wake]").textContent.includes("handoff-budget"), false);
  assert.equal(idle.querySelector("[data-session-wake]").textContent.includes("handoff"), true);
  const busy = renderSession(document, {
    id: "s2",
    activity: "busy",
    wake: { enabled: true, pausedReason: "not-a-known-reason" },
  }, t);
  const mark = busy.querySelector("[data-session-activity]");
  assert.equal(mark.getAttribute("aria-label"), "The session is working.");
  assert.equal(mark.children.some((child) => child.textContent === "The session is working."), true);
  assert.equal(mark.getAttribute("aria-label").includes("busy"), false);
  assert.equal(busy.querySelector("[data-session-wake]").textContent, "Wake is paused.");
  const unit = renderUnit(document, { unit: "shop", date: stamp, context: "Keep this sentence." }, t, "en");
  const dateLine = unit.querySelectorAll("p").find((node) => node.textContent.startsWith("Date"));
  assert.equal(dateLine.textContent.includes(stamp), false);
  assert.equal(unit.querySelectorAll("p").some((node) => node.textContent === "Keep this sentence."), true);
});

test("the shell has one heading, a skip link, and stable live regions", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  const headings = desktop.root.querySelectorAll("h1");
  assert.equal(headings.length, 1);
  assert.equal(headings[0].textContent, "Map");
  assert.equal(desktop.document.title, "Map · HIVEM1ND");
  assert.equal(desktop.document.title.includes("\u2014"), false);
  const skip = desktop.root.querySelector("a.skip");
  assert.equal(skip?.getAttribute("href"), "#workspace");
  assert.equal(skip.textContent, "Skip to the workspace");
  assert.equal(desktop.root.querySelector("[id='workspace']") != null, true);
  assert.equal(desktop.root.querySelector("[role='tab']"), null);
  assert.equal(desktop.root.querySelector("[role='tablist']"), null);
  const status = desktop.document.querySelector("[data-live='status']");
  const error = desktop.document.querySelector("[data-live='error']");
  assert.equal(status?.parentNode === desktop.document.body, true);
  assert.equal(error?.parentNode === desktop.document.body, true);
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(error.getAttribute("role"), "alert");
  assert.equal(status.textContent, "");
  assert.equal(status.textContent.includes("Reading the mind."), false);
  status.parent = null;
  error.parent = null;
  for (let pass = 0; pass < 12; pass += 1) renderShell(desktop.app);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
  assert.equal(desktop.document.querySelector("[data-live='status']").parentNode === desktop.document.body, true);
  assert.equal(desktop.document.querySelector("[data-live='status']").textContent, "");
  assert.equal(desktop.document.querySelector("[data-live='status']").textContent.includes("Reading the mind."), false);
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("h1").textContent, "Mapa");
  assert.equal(desktop.document.title, "Mapa · HIVEM1ND");
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  dispose(desktop.app);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 0);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 0);
});

test("same-cursor reset and ready open the desktop shell and read the viewer", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  let shared = null;
  let releaseEvents = () => {};
  const eventsReady = new Promise((resolve) => {
    releaseEvents = resolve;
  });
  const booted = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    const target = String(input);
    urls.push(target);
    const pathname = new URL(target).pathname;
    if (pathname === "/api/v1/events") return sameCursorStream(eventsReady, () => shared);
    const response = await fetch(input, init);
    if (pathname !== "/api/v1/view") return response;
    const json = await response.json();
    if (!shared) {
      shared = json.meta.eventCursor;
      releaseEvents();
    }
    return new Response(JSON.stringify(json), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  });
  t.after(() => dispose(booted.app));
  await waitFor(() => booted.root.querySelector(".shell"), "The desktop shell did not appear.");
  assert.equal(booted.root.querySelector(".shell").getAttribute("data-layout"), "desktop");
  assert.equal(booted.app.store.capabilities.includes("viewer.write"), true);
  assert.equal(urls.some((url) => new URL(url).pathname === "/api/v1/viewer"), true);
});

test("startup shows Retry when stream.ready never arrives", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const booted = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    const target = String(input);
    urls.push(target);
    if (new URL(target).pathname === "/api/v1/events") {
      return new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return fetch(input, init);
  }, { readyBudgetMs: 200 });
  t.after(() => dispose(booted.app));
  await waitFor(() => booted.root.querySelector("h2")?.textContent === "The service is unavailable.", "Startup did not fail closed.");
  assert.equal(booted.root.querySelector("button")?.textContent, "Retry");
  assert.equal(urls.some((url) => new URL(url).pathname === "/api/v1/settings"), true);
  assert.equal(urls.some((url) => new URL(url).pathname === "/api/v1/viewer"), false);
});

test("startup Retry repeats the failed read with the same authorized API", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const token = new URL(fixture.desktopUrl).hash.replace(/^#/, "").split("&").find((part) => part.startsWith("session=")).slice("session=".length);
  const history = { state: null, urls: [], replaceState(_state, _title, url) { this.urls.push(String(url)); } };
  const authorizations = [];
  let views = 0;
  const booted = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    const target = String(input);
    if (new URL(target).pathname === "/api/v1/view") {
      views += 1;
      authorizations.push(init?.headers?.Authorization ?? null);
      if (views === 1) {
        return new Response(JSON.stringify({
          error: { code: "unavailable", message: "The service is unavailable.", requestId: "req-boot", details: {}, retryAt: null },
        }), { status: 503, headers: { "content-type": "application/json" } });
      }
    }
    return fetch(input, init);
  }, { history });
  t.after(() => dispose(booted.app));
  const api = booted.app.api;
  await waitFor(() => booted.root.querySelector("h2")?.textContent === "The service is unavailable.", "The failed startup did not stay recoverable.");
  assert.equal(api.token, token);
  assert.equal(history.urls.length, 1);
  assert.equal(history.urls[0].includes(token), false);
  assert.equal(history.urls[0].includes("session="), false);
  click(booted.root.querySelector("button"));
  await waitFor(() => booted.root.querySelector(".shell")?.getAttribute("data-layout") === "desktop", "Retry did not open the desktop shell.");
  assert.equal(booted.app.api, api);
  assert.equal(booted.app.api.token, token);
  assert.equal(authorizations.length >= 2, true);
  assert.equal(authorizations.every((value) => value === `Bearer ${token}`), true);
  assert.equal(history.urls.length, 1);
});

test("a lost settings or home response retries the same mutation", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    const target = String(input);
    if (!init?.body || (init.method !== "PATCH" && init.method !== "POST")) return;
    if (!target.includes("/settings")) return;
    writes.push({
      method: init.method,
      path: new URL(target).pathname,
      key: headerValue(init.headers, "Idempotency-Key"),
      body: JSON.parse(init.body),
    });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-look='high-contrast']"), "Settings did not open.");
  const settingsBefore = await countNamedEvents(fixture.root, "settings.changed");
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", dropAfterCommit: true });
  click(desktop.root.querySelector("[data-look='high-contrast']"));
  await waitFor(() => desktop.root.querySelector("[data-action='retry-activity']"), "The lost settings response did not offer Retry.");
  click(desktop.root.querySelector("[data-language='es']"));
  await waitFor(() => desktop.root.querySelector("[data-language='es']")?.getAttribute("aria-pressed") === "true", "The later language choice did not settle.");
  const settingsWrites = writes.filter((item) => item.path === "/api/v1/settings");
  assert.equal(settingsWrites.length, 3);
  assert.equal(settingsWrites[0].key, settingsWrites[1].key);
  assert.equal(settingsWrites[0].body.look, "high-contrast");
  assert.equal(settingsWrites[0].body.expectedRevision, settingsWrites[1].body.expectedRevision);
  assert.equal(settingsWrites[2].key === settingsWrites[0].key, false);
  assert.equal(settingsWrites[2].body.language, "es");
  assert.equal(settingsWrites[2].body.expectedRevision === settingsWrites[0].body.expectedRevision, false);
  assert.equal(await countNamedEvents(fixture.root, "settings.changed"), settingsBefore + 2);

  fixture.control.setFault({ method: "POST", path: "/api/v1/settings/home-network", dropAfterCommit: true });
  clickAction(desktop.root, "open-home");
  await waitFor(() => desktop.root.querySelector("[data-action='retry-activity']"), "The lost home response did not offer Retry.");
  click(desktop.root.querySelector("[data-action='retry-activity']"));
  await waitFor(() => desktop.app.activity.get("home-open")?.phase === "success", "Home retry did not resolve.");
  const homeWrites = writes.filter((item) => item.path === "/api/v1/settings/home-network");
  assert.equal(homeWrites.length, 2);
  assert.equal(homeWrites[0].key, homeWrites[1].key);
  assert.deepEqual(homeWrites[0].body, homeWrites[1].body);
  const home = await request(desktop.app.api, "GET", "/settings");
  assert.equal(home.data.home.enabled, true);
});

test("a failed connection stays open and retries the same targets", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    const target = String(input);
    if (init?.method !== "PUT" || !target.includes("/lead")) return;
    writes.push({
      path: decodeURIComponent(new URL(target).pathname),
      key: headerValue(init.headers, "Idempotency-Key"),
      body: JSON.parse(init.body),
    });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.mapState?.onConnect && desktop.app.unitList?.catalog?.length, "The map did not offer a connection.");
  const units = desktop.app.unitList.catalog;
  const master = units.find((unit) => unit.role === "master");
  const target = units.find((unit) => unit.role !== "master" && unit.leadId && unit.revision);
  const source = units.find((unit) => unit.id === target.leadId);
  desktop.app.mapState.onConnect({ source: source.id, target: master.id });
  await waitFor(() => desktop.document.querySelector("dialog")?.getAttribute("open") != null, "The connection dialog did not open.");
  click(desktop.document.querySelector("button.primary"));
  await waitFor(() => desktop.document.querySelector("[data-dialog-error]")?.textContent.includes("not valid"), "A rejected connection did not stay in the dialog.");
  assert.equal(desktop.document.querySelector("dialog").getAttribute("open") != null, true);
  assert.equal(writes.length, 0);
  click(desktop.document.querySelector("dialog").querySelector("button"));
  await waitFor(() => desktop.document.querySelector("dialog") == null, "Cancel did not close the dialog.");

  desktop.app.mapState.onConnect({ source: source.id, target: target.id });
  await waitFor(() => desktop.document.querySelector("button.primary"), "The connection dialog did not return.");
  fixture.control.setFault({ method: "PUT", path: `/api/v1/units/${target.id}/lead`, dropAfterCommit: true });
  click(desktop.document.querySelector("button.primary"));
  await waitFor(() => desktop.document.querySelector("[data-dialog-error]")?.textContent.includes("not known yet"), "An unknown connection result did not stay open.");
  assert.equal(desktop.document.querySelector("dialog").getAttribute("open") != null, true);
  const retry = desktop.document.querySelector("dialog").querySelector("button.primary");
  assert.equal(retry.children.some((child) => child.textContent === "Retry"), true);
  click(retry);
  await waitFor(() => desktop.document.querySelector("dialog") == null, "A resolved connection did not close.");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].key, writes[1].key);
  assert.deepEqual(writes[0].body, writes[1].body);
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

function clickAction(root, action) {
  const node = root.querySelector(`[data-action='${action}']`);
  const event = { target: node, preventDefault() {} };
  let current = node;
  while (current) {
    for (const handler of current.listeners?.get("click") ?? []) handler(event);
    current = current.parent;
  }
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name) ?? headers.get(name.toLowerCase());
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

async function countNamedEvents(root, name) {
  const entries = await readdir(root, { recursive: true });
  const hit = entries.find((entry) => String(entry).endsWith("event-ledger.json"));
  if (!hit) return 0;
  const ledger = JSON.parse(await readFile(join(root, String(hit)), "utf8"));
  return ledger.records.filter((record) => record.name === name).length;
}

function columnIndex(column, node) {
  let current = node;
  while (current && current.parent !== column) current = current.parent;
  return column.children.indexOf(current);
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

function sseFrame(name, id, data) {
  const envelope = {
    contract: "hivem1nd-events-v3",
    at: "2026-10-11T12:00:00.000Z",
    machine: "QA",
    source: { kind: "service", id: "fixture", unitId: "root:master" },
    data,
  };
  return `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

function sameCursorStream(eventsReady, cursor) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      await eventsReady;
      const id = cursor();
      const reset = sseFrame("stream.reset", id, { reason: "service_restarted", cursor: id });
      const ready = sseFrame("stream.ready", id, {
        cursor: id,
        readAt: "2026-10-11T12:00:00.000Z",
        capabilities: DESKTOP,
      });
      controller.enqueue(encoder.encode(reset + ready));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}

async function bootWithFetch(url, width, fetchImpl, extras = {}) {
  const { document, root, view } = createTestDocument(width);
  const parsed = new URL(url);
  const app = await mount(root, {
    location: { origin: parsed.origin, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { replaceState() {} },
    fetch: fetchImpl,
    ...extras,
  });
  return { app, root, view, document };
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
  const view = {
    parent: null,
    innerWidth: width,
    innerHeight: 844,
    listeners: new Map(),
    addEventListener(type, handler) {
      const list = this.listeners.get(type) ?? [];
      list.push(handler);
      this.listeners.set(type, list);
    },
    removeEventListener() {},
    requestAnimationFrame() { return 0; },
    postMessage() {},
  };
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
        kid.parentNode = this;
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
        const parent = this.parentNode ?? this.parent;
        if (!parent?.children) return;
        parent.children = parent.children.filter((child) => child !== this);
        this.parent = null;
        this.parentNode = null;
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
