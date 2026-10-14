import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { createApi, createOperation, request, retryOperation } from "../gui/app/api.mjs";
import { answerApproval, changeTaskStatus, createGroup, setUnitAlias, startSession } from "../gui/app/actions.mjs";
import { documentSaver, findTextMatches, textDraft } from "../gui/app/void.mjs";
import { markMailboxRead } from "../gui/app/chats.mjs";
import { dispose as disposeEmbed, handleParentMessage, publishDirty, publishReady, startEmbedChannel } from "../gui/app/embed.mjs";
import { DICTIONARIES, cardinal, dictionaryKeys, formatClock, formatWhen, limitsUsage, text } from "../gui/app/i18n.mjs";
import { encodeHomeQr } from "../gui/app/qr.mjs";
import { canPerform, exchangeCode, exchangeHomeFragment, logout, renderCodeEntry, renderPhone } from "../gui/app/phone.mjs";
import { applyIssueChange, applyServiceBeat, applySettingsRead, applySyncSnapshot, armExpiry, clearGrant, closeHome, limitsLabel, noteHomeChange, openHome, saveSettings, takeGrant, updateExpiry } from "../gui/app/settings.mjs";
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup } from "../gui/app/hierarchy.mjs";
import { collectPages, createPagedList, loadAll, moveFocus, renderWindow, setQuery } from "../gui/app/lists.mjs";
import { flushLayout, queueLayoutPatch } from "../gui/app/map.mjs";
import { setAttachments, startWatch, libraryState, createResource } from "../gui/app/editors.mjs";
import { composeCore } from "../engine/service/service.mjs";
import { renderSession, renderUnit } from "../gui/app/inspector.mjs";
import { dispose, mount, navigate, presentation, renderShell, shellLayout } from "../gui/app/main.mjs";
import { applyReset, createStore, startCollection, writeCollection } from "../gui/app/state.mjs";
import { ApiError } from "../gui/app/api.mjs";
import { FIXTURE_HOME_CODE, FIXTURE_HOME_KEY, deterministicUuid } from "./gui-data.mjs";
import { createGuiFixture } from "./gui-fixture.mjs";
import { closeGuiHost, createFolderReopen, startGui } from "../gui/index.mjs";
import { dispose as disposeCoreFixture, makeCoreFixture } from "./core-fixture.mjs";
import { assertVisibleCopy } from "./spanish-register.test.mjs";

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
  assert.equal(text("es", "approveAlways"), "Siempre para esta unidad");
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
  const files = ["gui/app/index.html", "gui/app/favicon.svg", "gui/app/main.mjs", "gui/app/i18n.mjs", "gui/app/styles.css", "gui/app/components.mjs", "gui/app/lists.mjs", "gui/app/hierarchy.mjs", "gui/app/map.mjs", "gui/app/map-geometry.mjs", "gui/app/actions.mjs", "gui/app/chats.mjs", "gui/app/inspector.mjs", "gui/app/editors.mjs", "gui/app/blueprint.mjs", "gui/app/markup.mjs", "gui/app/void.mjs", "gui/app/settings.mjs", "gui/app/qr.mjs", "gui/app/qr-render.mjs", "gui/app/phone.mjs", "gui/app/embed.mjs"];
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
  assert.match(html, /rel="icon" href="\/app\/favicon\.svg"/);
  assert.equal(html.includes("data:image"), false);
  const icon = sources[1][1];
  assert.equal(icon.includes("#bdcd79"), true);
  assert.ok(Buffer.byteLength(icon) < 2048);
  await assert.rejects(readFile("gui/app/mark.svg"), (error) => error.code === "ENOENT");
  assert.match(html, /src="\/app\/main\.mjs"/);
  assert.equal(/<script(?![^>]*\ssrc=)/.test(html), false);
  assert.equal(html.includes("<style"), false);
  assert.equal(html.includes("session="), false);
  const main = sources[2][1];
  const imports = [...new Set([...main.matchAll(/from "([^"]+)"/g)].map((match) => match[1]))].sort();
  assert.deepEqual(imports, ["./actions.mjs", "./api.mjs", "./blueprint.mjs", "./chats.mjs", "./components.mjs", "./editors.mjs", "./embed.mjs", "./hierarchy.mjs", "./i18n.mjs", "./inspector.mjs", "./lists.mjs", "./map.mjs", "./markup.mjs", "./phone.mjs", "./settings.mjs", "./state.mjs", "./stream.mjs", "./void.mjs"]);
  const css = sources[4][1];
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

for (const reason of ["closed", "expired"]) test(`a ${reason} home event clears the phone session without closing the desktop viewer`, async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const phone = await bootApp(fixture.phoneUrl, 390, []);
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(phone.app));
  t.after(() => dispose(desktop.app));
  await waitFor(() => phone.root.querySelector(".shell") && desktop.root.querySelector(".shell"), "The viewers did not open.");
  const desktopToken = desktop.app.api.token;
  await fixture.control.emit("home.changed", { reason, home: { enabled: false } });
  await waitFor(() => phone.root.querySelector("[data-home-code]"), "The closed phone session did not show reopening guidance.");
  assert.equal(phone.app.api.token, null);
  assert.equal(phone.app.api.homeKey, null);
  assert.equal(phone.app.api.live.stopped, true);
  assert.equal(phone.root.querySelector(".shell"), null);
  assert.equal(phone.root.querySelector(".gate")?.querySelector("p")?.textContent, text(phone.app.language, reason === "expired" ? "homeExpired" : "homeClosed"));
  renderShell(phone.app);
  assert.equal(phone.root.querySelector(".shell"), null);
  assert.equal(desktop.app.api.token, desktopToken);
  assert.ok(desktop.root.querySelector(".shell"));
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
  const started = await startSession(desktop.app.api, overseer, "cursor", null, null, { runMode: "chat" });
  await waitFor(() => desktop.app.sessionRequestId === started.data.requestId && noteText(desktop) === "The session is queued.", "The session request event did not arrive.");
  await fixture.control.patchSession(started.data.requestId, "failed", "launch_ambiguous");
  const beforeReset = urls.length;
  const firstMark = desktop.app.trackedAt ?? 0;
  await fixture.control.emit("stream.reset", { reason: "service_restarted", cursor: "0" });
  await waitFor(() => (desktop.app.trackedAt ?? 0) > firstMark && noteText(desktop) === text('en', 'launchAmbiguous') && urls.slice(beforeReset).some((url) => url.includes(`/session-requests/${started.data.requestId}`)), "The session request was not reread.");

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

test("waiting task acceptance and undo work without opening the unit inspector", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.waitingList?.items?.some(item => item.taskId === "project:shop:029"), "The review task did not load.");
  assert.equal(desktop.app.inspectorData ?? null, null);
  click(desktop.root.querySelector("[data-action='waiting']"));
  click(desktop.root.querySelector("[data-waiting-surface]").querySelector("[data-task='project:shop:029']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-record='review']")?.querySelector("[data-action='accept']"), "The review did not open.");
  click(desktop.root.querySelector("[data-waiting-record='review']").querySelector("[data-action='accept']"));
  await waitFor(() => desktop.app.activity.get("task:project:shop:029")?.phase === "success", "Task acceptance did not settle.");
  assert.equal(desktop.app.waitingRecord.task.status, "done");
  assert.equal((await request(desktop.app.api, "GET", "/tasks/project%3Ashop%3A029")).data.status, "done");
  click(desktop.root.querySelector("[data-waiting-record='review']").querySelector("[data-action='undo']"));
  await waitFor(() => desktop.app.activity.get("undo:project:shop:029")?.phase === "success", "Undo did not settle.");
  assert.equal(desktop.app.waitingRecord.task.status, "review");
  assert.equal(desktop.app.inspectorData ?? null, null);
  assert.equal(desktop.app.store.indexes.tasks.get("project:shop:029").status, "review");
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

  for (const mode of ["settings", "blueprint", "document", "focus"]) {
    navigate(desktop.app, mode);
    assert.equal(desktop.root.querySelector("[data-action='waiting']").getAttribute("aria-pressed"), "false");
    click(desktop.root.querySelector("[data-action='waiting']"));
    await waitFor(() => desktop.root.querySelector("[data-waiting-surface]"), `Waiting did not open from ${mode}.`);
    assert.equal(desktop.app.mode, "map");
    assert.equal(desktop.root.querySelector("[data-action='waiting']").getAttribute("aria-pressed"), "true");
  }

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
  await writeFile(legacyFile, 'import { board } from "blueprint/board.mjs";\nimport { col, text } from "blueprint/kit.mjs";\nexport default board({ id: "legacy-cart", title: "Legacy cart", screens: [{ id: "cart", title: "Cart", root: col({ w: 300, h: 560 }, text("Actual legacy cart")) }] });\n');
  const indexFile = join(fixture.root, "repositories", "shop", "docs", "flows", "boards", "index.json");
  const index = JSON.parse(await readFile(indexFile, "utf8")); index.push({ id: "legacy-cart", title: "Legacy cart" });
  await writeFile(indexFile, JSON.stringify(index));
  await fixture.control.refresh();
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
  await waitFor(() => desktop.app.editors.error || desktop.root.querySelector("[data-action='resize-screen']"), "The copy returned no result.");
  assert.equal(desktop.app.editors.error?.code ?? null, null, desktop.app.editors.error?.message);
  await waitFor(() => desktop.app.editors.current?.authoritative?.legacy == null && desktop.root.querySelector("[data-action='resize-screen']"), "The JSON copy did not open.");
  assert.deepEqual(await readFile(legacyFile), legacyBytes);
  const copied = writes.find((item) => item.method === "POST" && item.body?.document?.id === "legacy-cart");
  assert.equal(copied.body.path, "docs/flows/boards/legacy-cart.json");
  const copyFile = join(fixture.root, "repositories", "shop", "docs", "flows", "boards", "legacy-cart.json");
  assert.equal(JSON.parse((await readFile(copyFile)).toString("utf8")).id, "legacy-cart");
  assert.equal((await readFile(copyFile)).includes(Buffer.from("export const board")), false);

  await waitFor(() => desktop.app.editors.catalog.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
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
  typeInput(desktop.document.querySelector("[data-field='create-title']"), "Sample board", 0, 12);
  desktop.document.querySelector("[data-field='create-project']").value = "shop";
  click(desktop.document.querySelector("[data-action='create-resource']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.id === "sample-board" && desktop.root.querySelector("[data-editor-title]")?.getAttribute("data-editor-title") === "Sample board", "The new board did not open.");
  assert.equal(desktop.root.querySelector("[data-structure]").children.some(child => child.textContent === "null"), false);
  assert.equal(desktop.app.editors.current.authoritative.document.screens.length, 1);
  assert.equal(desktop.app.editors.current.authoritative.document.pages.length, 1);
  assert.equal(desktop.root.querySelector("[data-action='move-page']").getAttribute("disabled"), "");
  assert.equal(desktop.root.querySelector("[data-action='move-screen']").getAttribute("disabled"), "");
  assert.equal(desktop.root.querySelector("[data-action='add-link']").getAttribute("disabled"), "");
  assert.deepEqual(await readFile(legacyFile), legacyBytes);

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors.catalog.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === notes.id && desktop.root.querySelector("[data-void-title]"), "The text did not open.");
  const textRevision = desktop.app.editors.current.revision;
  const textRev = desktop.app.editors.current.authoritative.document.rev;
  const title = desktop.root.querySelector("[data-void-title]");
  title.textContent = "Revised notes";
  for (const handler of title.listeners.get("input") ?? []) handler();
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
  await desktop.app.editors.current.voidSaver.flush();
  const ranged = writes.filter((item) => item.method === "PUT" && item.url.includes("/void/texts/")).at(-1).body;
  assert.equal(ranged.document.pages.find((page) => page.k === "Intro.Welcome").en, broken);
  assert.equal(ranged.document.pages.find((page) => page.k === "Intro.Welcome").es, desktop.app.editors.current.authoritative.document.pages[0].es);
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.pages?.find((page) => page.k === "Intro.Welcome")?.en === broken
    && desktop.root.querySelector("[data-source]")?.value === broken, "The saved text was not shown.");
  await delay(150);

  const kept = `${broken} kept`;
  fixture.control.setFault({ method: "PUT", path: `/api/v1/void/texts/${notes.id}`, status: 409, code: "revision_conflict" });
  typeInput(desktop.root.querySelector("[data-source]"), kept, 0, 4);
  await assert.rejects(desktop.app.editors.current.voidSaver.flush());
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
  typeInput(desktop.document.querySelector("[data-field='create-title']"), "Fresh note", 0, 10);
  desktop.document.querySelector("[data-field='create-project']").value = "shop";
  click(desktop.document.querySelector("[data-action='create-resource']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.id === "fresh-note" && desktop.app.voidState?.page === "Intro.Welcome", "The new text did not open on its first page.");
  assert.equal(desktop.app.voidState.page, "Intro.Welcome");
  assert.notEqual(desktop.root.querySelector("[data-source]").value, "LOCAL DRAFT");
  assert.notEqual(desktop.root.querySelector("[data-source]").value, "Next page.");
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

// This is the current mounted inventory, not a sweep over arbitrary DOM data.
// Record content and technical commands are exceptions at their owning elements;
// buttons, hints, accessible names and live regions still enter the copy gate.
function mountedVisibleCopy(booted) {
  const { document, app } = booted;
  const ownData = new Set();
  const prefixes = new Set();
  const own = (selector) => { for (const node of document.querySelectorAll(selector)) ownData.add(node); };
  own("[data-message], [data-mailbox-message], [data-mailbox-detail], .comment-text, .comment-author, .bubble-meta, .chat-members, [data-grant-action], [data-grant-pattern], [data-chip], [data-board-target], [data-lead-choice], [data-mailbox-unit]");
  own(".row-unit, .row-chat, .row-group, .row-issue, .row-editor, .unit-card h3");
  // The fixture selector implements single element selectors, so relational
  // exceptions are resolved from each actual record container.
  for (const card of document.querySelectorAll(".unit-card")) {
    for (const node of card.children) {
      if (node.tag === "h3") ownData.add(node);
      if (node.tag === "p") prefixes.add(node);
    }
  }
  for (const facts of document.querySelectorAll("[data-unit-facts]")) {
    facts.children.forEach((node, index) => (index < 6 ? prefixes : ownData).add(node));
  }
  for (const card of document.querySelectorAll("[data-approval], [data-task], [data-task-detail]")) {
    for (const node of card.children) {
      if (node.tag === "h3" || node.tag === "p" && !node.getAttribute("data-requirements") && !node.getAttribute("data-approved-by")) ownData.add(node);
    }
  }
  for (const node of document.querySelectorAll("[data-requirements], [data-approved-by]")) prefixes.add(node);
  for (const node of document.querySelectorAll(".map-label")) {
    if (!String(node.parent?.className).includes("empty-master")) ownData.add(node);
  }
  const entries = [];
  const visit = (node, identity, recordText = false) => {
    if (node.getAttribute?.("aria-hidden") === "true" || node.getAttribute?.("hidden") != null) return;
    if (node.getAttribute?.("data-secret") != null || node.getAttribute?.("data-void") != null || node.getAttribute?.("data-screen") != null) return;
    const action = node.getAttribute?.("data-action");
    const where = action ? `${identity}[data-action=${action}]` : identity;
    let value = node.textContent ?? "";
    if (ownData.has(node) || recordText && node.tag === "#text") value = "";
    if (prefixes.has(node)) value = value.split(": ")[0];
    if (node.getAttribute?.("data-opening-cause") != null && app?.selectedFolder) value = value.replace(app.selectedFolder, "");
    const title = node.getAttribute?.("data-editor-title");
    if (title) value = value.replace(title, "");
    if (value.trim()) entries.push([`${where}.text`, value]);
    for (const name of ["aria-label", "title", "placeholder", "alt"]) {
      const label = node.getAttribute?.(name);
      if (label) entries.push([`${where}.${name}`, label]);
    }
    (node.children ?? []).forEach((child, index) => visit(child, `${where}/${child.tag}[${index}]`, ownData.has(node)));
  };
  visit(document.body, "body");
  return entries;
}

test("mounted copy exceptions belong to records and never hide nearby product labels", () => {
  const { document, root } = createTestDocument(1440);
  const command = document.createElement("p");
  command.setAttribute("data-grant-pattern", "true");
  command.textContent = "printf 'tu mente' --mind-path C:/fixtures/mind/keep";
  root.append(command);
  const content = document.createElement("div");
  content.setAttribute("data-void", "true");
  content.textContent = "Tu mente: vos podés escribir esto.";
  root.append(content);
  const booted = { document, app: {} };
  assertVisibleCopy("es", mountedVisibleCopy(booted));
  const button = document.createElement("button");
  button.setAttribute("data-action", "retry");
  button.textContent = "Revisá tu mente";
  root.append(button);
  assert.throws(() => assertVisibleCopy("es", mountedVisibleCopy(booted)), /data-action=retry/);
  assert.equal(command.textContent, "printf 'tu mente' --mind-path C:/fixtures/mind/keep");
  assert.equal(content.textContent, "Tu mente: vos podés escribir esto.");
});

for (const language of ["en", "es"]) test(`current mounted ${language} states use M1ND and neutral product copy`, async (t) => {
  const fixture = await createGuiFixture({ scenario: language === "es" ? "spanish" : "standard" });
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  const inventory = new Map();
  const capture = (state, booted = desktop) => {
    booted.app.language = language;
    renderShell(booted.app);
    const entries = mountedVisibleCopy(booted);
    assert.ok(entries.length > 3, `${state}: the mounted copy inventory was empty`);
    assertVisibleCopy(language, entries.map(([where, value]) => [`${state} ${where}`, value]));
    inventory.set(state, entries.length);
  };
  capture("Map and Hierarchy");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === executor.id && desktop.app.thread?.messages?.length, "The copy inventory did not open the unit and its chat.");
  const message = desktop.app.thread.messages[0];
  const userContent = "Tu mente: vos podés usar mind y --mind-path C:/fixtures/mind/keep.";
  message.body = userContent;
  capture("Chat, unit, session, approvals and task review");
  assert.equal(message.body, userContent);
  const always = desktop.root.querySelector("[data-action='approve-always']");
  assert.ok(always);
  assert.equal(always.textContent, text(language, "approveAlways"));
  click(desktop.root.querySelector("[data-action='waiting']"));
  capture("Waiting");
  click(desktop.root.querySelector("[data-action='new-unit']"));
  await waitFor(() => desktop.document.querySelector("[data-form='unit']"), "The copy inventory did not open the unit form.");
  capture("New unit form");
  desktop.document.querySelector("dialog[open]").close();
  click(desktop.root.querySelector("[data-action='start-session']"));
  await waitFor(() => desktop.document.querySelector("[data-form='session']"), "The copy inventory did not open the session form.");
  capture("Session form");
  desktop.document.querySelector("dialog[open]").close();
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-settings]"), "The copy inventory did not open Settings.");
  capture("Settings and service");
  for (const [mode, kind] of [["blueprint", "blueprint"], ["document", "void"]]) {
    navigate(desktop.app, mode);
    await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.kind === kind && item.title === (kind === "blueprint" ? "Cart" : "Release notes")), "The copy inventory did not load the library.");
    capture(`${mode} library`);
    const item = desktop.app.editors.catalog.find((item) => item.kind === kind && item.title === (kind === "blueprint" ? "Cart" : "Release notes"));
    renderShell(desktop.app);
    click(desktop.root.querySelector(`[data-id='${item.id}']`));
    await waitFor(() => desktop.app.editors.current?.resourceId === item.id && desktop.root.querySelector(kind === "blueprint" ? ".board-host" : "[data-void]"), "The copy inventory did not open the resource.");
    capture(`${mode} content and comments`);
  }
  navigate(desktop.app, "focus");
  capture("Focus");
  desktop.root.listeners.get("pointermove")[0]();
  capture("Focus tools");
  const phone = await bootApp(fixture.phoneUrl, 390, []);
  t.after(() => dispose(phone.app));
  capture("Phone Hierarchy", phone);
  const phoneUnit = phone.app.unitList.catalog.find((unit) => unit.id === executor.id);
  phone.app.activeHandlers.onActivate({ id: phoneUnit.id, kind: "unit", unit: phoneUnit }, "double");
  await waitFor(() => phone.app.thread?.messages?.length, "The copy inventory did not open the phone chat.");
  capture("Phone chat", phone);
  navigate(phone.app, "waiting");
  capture("Phone Waiting", phone);
  await fixture.control.emit("home.changed", { reason: "expired", home: { enabled: false } });
  await waitFor(() => phone.root.querySelector("[data-home-code]"), "The copy inventory did not end phone access.");
  capture("Phone access ended and pairing", phone);
  const first = await createGuiFixture({ scenario: "first-run" });
  t.after(() => first.close());
  const empty = await bootApp(first.desktopUrl, 1440, []);
  t.after(() => dispose(empty.app));
  capture("Empty M1ND", empty);
  empty.app.bootReading = true;
  capture("Reading M1ND", empty);
  empty.app.bootReading = false;
  empty.app.bootFailed = true;
  empty.app.selectedFolder = "C:/fixtures/mind/keep";
  empty.app.bootError = new ApiError(0, "timeout", text(language, "requestTimeout"));
  capture("Unreadable M1ND", empty);
  assert.equal(inventory.size, 19);
});

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
  assert.deepEqual(Object.keys(started.body).sort(), ["client", "expectedRevision", "prompt", "runMode", "taskId"]);
  assert.equal(started.body.runMode, 'chat');
  assert.equal(started.body.taskId, null);
  assert.equal(started.body.prompt, "Check the build");
  assert.equal(noteText(desktop), "The session is queued.");

  const blog = desktop.app.unitList.catalog.find((unit) => unit.id === "project:blog:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: blog.id, kind: "unit", unit: blog }, "double");
  await waitFor(() => desktop.root.querySelector("[data-machine='OFFLINE']")?.getAttribute("data-answers") === "false", "The silent machine was not shown.");
  click(desktop.root.querySelector("[data-action='start-session']"));
  await waitFor(() => desktop.document.querySelector("[data-form='session']")?.querySelector("[data-client-unavailable]"), "The unavailable client was still offered.");
  const silentForm = desktop.document.querySelector("[data-form='session']");
  assert.equal([...silentForm.querySelector("[name='client']").children].every((option) => option.disabled), true);
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
  const cancel = sessionForm.querySelector('[data-action="cancel-form"]');
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
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-node-name]"), "The node name field did not open.");
  typeInput(desktop.root.querySelector("[data-node-name]"), "Label 2", 0, 7);
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
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
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-node-name]")?.value === "Label 2", `The node draft was not restored. value=${desktop.root.querySelector("[data-node-name]")?.value ?? "missing"} stored=${desktop.app.inputDrafts.nodes?.get(cart.id) ?? "missing"}`);
  typeInput(desktop.root.querySelector("[data-node-name]"), "", 0, 0);
  assert.equal(dirtyPatches().some((item) => item.body.dirty === false), false);
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.id === notes.id), "The text catalog did not return.");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.endsWith("!"), "The source draft was discarded with the other forms.");
  await desktop.app.editors.current.voidSaver?.flush();
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
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector(".board-host"), "The board did not open.");
  const resource = desktop.root.querySelector("[data-editor-column='resource']");
  const comments = desktop.root.querySelector("[data-editor-column='comments']");
  const tools = resource.querySelector("[data-editor-tools]");
  assert.equal(tools.querySelector("[data-watch]")?.getAttribute("data-watch"), "off");
  assert.equal(resource.querySelector("[data-toolbar='board']").querySelector("[data-action='attach']") != null, true);
  assert.equal(resource.querySelector("[data-toolbar='board']").querySelector("[data-action='watch']") != null, true);
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
  assert.equal(textResource.querySelector("[data-action='save-range']"), null);
  assert.equal(textResource.querySelector("[data-action='replace-document']"), null);
  assert.equal(textResource.querySelector("[data-void-body]").getAttribute("contenteditable"), "true");
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
  assert.equal(comment.closest("label").querySelector(".field-label").textContent, "Reply on the board");
  assert.equal(comment.closest("label").querySelector(".field-hint").textContent, "Choose a screen or node, then write the comment.");

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]"), "The source field did not open.");
  assert.equal(desktop.root.querySelector("[data-source]").closest("label").querySelector(".field-label").textContent, "Source");
  assert.equal(desktop.root.querySelector("[data-source]").closest("[data-source-edit]") != null, true);
  click(desktop.root.querySelector("[data-action='open-create']"));
  assert.equal(desktop.document.querySelector("[data-field='create-project']").closest("label").querySelector(".field-hint").textContent, "The text's file lives in this repository");

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
  assert.equal(desktop.document.activeElement === fresh, true);
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

test("Find controls navigate source matches replace one or all texts and Undo the complete last batch", async (t) => {
  const desktop = await openedBoardDesktop(t), { app, root } = desktop;
  await openCommentEditor(desktop, 'void');
  const workers = [];
  app.createFindWorker = () => {
    const worker = { terminated: false, terminate() { this.terminated = true; }, postMessage(data) { queueMicrotask(() => {
      if (this.terminated || data.query === '(a+)+$') return;
      try { this.onmessage({ data: { id: data.id, matches: findTextMatches(data.text, data.query, data.options) } }); }
      catch (error) { this.onmessage({ data: { id: data.id, error: { code: error instanceof RangeError ? 'too_many_matches' : 'invalid_pattern', message: error.message } } }); }
    }); } };
    workers.push(worker); return worker;
  };
  const editor = app.editors.current;
  typeInput(root.querySelector('[data-source]'), '**cat** cat 😀', 0, 0);
  await editor.voidSaver.flush(); renderShell(app);
  await createResource(app.api, 'void', { project: 'shop', path: 'docs/find-second.json', document: { formatVersion: 1, id: 'find-second', title: 'Other text', pages: [{ k: 'One', en: 'cat cat' }, { k: 'Two', en: 'cat' }] } });
  click(root.querySelector('[data-action="toggle-find"]'));
  typeInput(root.querySelector('[data-find-field="query"]'), 'cat', 3, 3);
  await waitFor(() => !app.voidFind.pending && app.voidFind.matches.length === 2, 'Find did not return both matches.');
  assert.equal(root.querySelector('[data-find-count]').textContent, '1 of 2');
  assert.equal(root.querySelector('[data-find-hits]').getAttribute('data-find-hits'), '2');
  const toggles = root.querySelectorAll('.void-find-option');
  assert.deepEqual(toggles.map((node) => node.textContent), ['Aa', 'W', '.*']);
  assert.ok(toggles.every((node) => node.getAttribute('aria-label') && node.getAttribute('title')));
  const selection = { get isCollapsed() { return this.anchorNode === this.focusNode && this.anchorOffset === this.focusOffset; }, setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) { Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset }); } };
  desktop.document.getSelection = () => selection;
  const firstRun = textNodes(root.querySelector('[data-void-body]')).find((node) => node.textContent === 'cat');
  selection.setBaseAndExtent(firstRun, 0, firstRun, 0); root.querySelector('[data-void-body]').focus(); editor.captureSelection();
  click(root.querySelector('[data-action="find-next"]'));
  assert.equal(root.querySelector('[data-find-count]').textContent, '2 of 2');
  assert.deepEqual(editor.textSelections.get(`${editor.resourceId}\0${editor.page}\0en`), { start: 8, end: 11 });
  click(root.querySelector('[data-action="find-previous"]'));
  typeInput(root.querySelector('[data-find-field="replacement"]'), 'dog', 3, 3);
  click(root.querySelector('[data-action="replace-match"]'));
  await waitFor(() => !app.voidFind.pending && !app.voidFind.busy && app.voidFind.matches.length === 1, 'Replace did not update the current hit.');
  assert.equal(editor.authoritative.document.pages[0].en, '**dog** cat 😀');
  click(root.querySelector('[data-action="find-all"]'));
  await waitFor(() => !app.voidFind.pending && app.voidFind.matches.length === 4, 'All texts did not include every page.');
  assert.equal(root.querySelector('[data-action="replace-all"]').textContent, 'Replace all 4');
  click(root.querySelector('[data-action="find-next"]'));
  await waitFor(() => app.editors.current.authoritative.title === 'Other text', 'Next did not open the matching text.');
  assert.equal(app.voidFind.matches.length, 4);
  click(root.querySelector('[data-action="find-next"]')); click(root.querySelector('[data-action="find-next"]'));
  assert.equal(app.editors.current.page, 'Two');
  click(root.querySelector('[data-action="replace-all"]'));
  await waitFor(() => !app.voidFind.pending && !app.voidFind.busy && app.voidFind.matches.length === 0, 'Replace all did not commit.');
  assert.equal(editor.authoritative.document.pages[0].en, '**dog** dog 😀');
  click(root.querySelector('[data-action="undo-replace"]'));
  await waitFor(() => !app.voidFind.pending && !app.voidFind.busy && app.voidFind.matches.length === 4, 'Undo did not restore the whole replacement batch.');
  assert.equal(editor.authoritative.document.pages[0].en, '**dog** cat 😀');
  click(root.querySelector('[data-action="find-regularExpression"]'));
  typeInput(root.querySelector('[data-find-field="query"]'), '[', 1, 1);
  await waitFor(() => root.querySelector('[data-find-error="invalid_pattern"]'), 'Invalid regex did not show an error.');
  assert.equal(root.querySelector('[data-action="replace-all"]').getAttribute('disabled'), '');
  typeInput(root.querySelector('[data-find-field="query"]'), '(a+)+$', 6, 6);
  await waitFor(() => root.querySelector('[data-find-error="pattern_too_slow"]'), 'A slow regex did not terminate.');
  assert.equal(root.querySelector('[data-find-error]').textContent, text('en', 'findSlow'));
  assert.equal(root.querySelector('[data-action="replace-match"]').getAttribute('disabled'), '');
  click(root.querySelector('[data-action="toggle-find"]'));
  assert.equal(root.querySelector('[data-find-bar]'), null); assert.ok(workers.every((worker) => worker.terminated));
});

test("Void keeps the source selection and draft through formatting, Source, Focus and page arrows", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-void-body]"), "The document did not open.");
  const editor = desktop.app.editors.current;
  editor.voidSaver = documentSaver(desktop.app.api, editor, () => {}, 10000);
  const source = "# Title\r\n\r\n<b>A😀</b> **bold**\r\nSecond";
  typeInput(desktop.root.querySelector("[data-source]"), source, 0, 0);
  renderShell(desktop.app);
  const selection = {
    get isCollapsed() { return this.anchorNode === this.focusNode && this.anchorOffset === this.focusOffset; },
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) { Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset }); },
  };
  desktop.document.getSelection = () => selection;
  const body = desktop.root.querySelector("[data-void-body]");
  const emoji = textNodes(body).find((node) => node.textContent === "A😀");
  selection.setBaseAndExtent(emoji, 3, emoji, 1);
  body.focus();
  editor.captureSelection(); editor.updateFormats();
  const bar = desktop.root.querySelector("[data-format-bar]");
  assert.equal(bar.getAttribute("hidden"), null);
  assert.deepEqual(bar.querySelectorAll("[data-format]").map((node) => node.getAttribute("data-format")),
    ["bold", "italic", "strikethrough", "h1", "h2", "h3", "list", "quote", "code", "link", "table", "image", "comment"]);
  click(desktop.root.querySelector("[data-action='toggle-source']"));
  let input = desktop.root.querySelector("[data-source]");
  assert.equal(input.value, source);
  assert.equal(input.selectionStart, source.indexOf("😀"));
  assert.equal(input.selectionEnd, source.indexOf("😀") + 2);
  assert.equal(editor.textSelections.get(`${notes.id}\0Intro.Welcome\0en`).backward, true);
  click(desktop.root.querySelector("[data-action='toggle-source']"));
  assert.equal(selection.anchorOffset, 3); assert.equal(selection.focusOffset, 1);
  click(desktop.root.querySelector("[data-format='bold']"));
  const formatted = source.replace("😀", "**😀**");
  assert.equal(textDraft(editor, notes.id, "Intro.Welcome", "en"), formatted);
  const formattedEmoji = textNodes(desktop.root.querySelector("[data-void-body]")).find((node) => node.textContent === "😀");
  selection.setBaseAndExtent(formattedEmoji, 2, formattedEmoji, 2);
  editor.captureSelection(); editor.updateFormats();
  assert.equal(desktop.root.querySelector("[data-format-bar]").getAttribute("hidden"), "");
  const caret = { ...editor.textSelections.get(`${notes.id}\0Intro.Welcome\0en`) };
  click(desktop.root.querySelector("[data-action='enter-focus']"));
  assert.equal(desktop.app.editors.current === editor, true);
  assert.equal(editor.page, "Intro.Welcome");
  for (const handler of desktop.view.listeners.get("keydown") ?? []) handler({ key: "ArrowRight", target: desktop.root.querySelector("[data-void-body]"), preventDefault() {} });
  assert.equal(editor.page, "Notes.Next");
  for (const handler of desktop.view.listeners.get("keydown") ?? []) handler({ key: "ArrowLeft", target: desktop.root.querySelector("[data-void-body]"), preventDefault() {} });
  assert.equal(editor.page, "Intro.Welcome");
  assert.deepEqual(editor.textSelections.get(`${notes.id}\0Intro.Welcome\0en`), caret);
  for (const handler of desktop.root.listeners.get("pointermove") ?? []) handler();
  assert.equal(desktop.root.querySelector("[data-tools]").getAttribute("data-tools"), "visible");
  for (const handler of desktop.view.listeners.get("keydown") ?? []) handler({ key: "Escape", target: desktop.root.querySelector("[data-void-body]"), preventDefault() {} });
  assert.equal(desktop.app.mode, "document");
  assert.equal(desktop.app.editors.current.resourceId, notes.id);
  assert.equal(textDraft(editor, notes.id, "Intro.Welcome", "en"), formatted);
  assert.deepEqual(editor.textSelections.get(`${notes.id}\0Intro.Welcome\0en`), caret);
  assert.equal(desktop.root.querySelector("[data-action='save-range']"), null);
  assert.equal(desktop.root.querySelector("[data-action='replace-document']"), null);
  desktop.app.language = "es"; renderShell(desktop.app);
  assert.equal(editor.language, "es");
  desktop.app.language = "en"; renderShell(desktop.app);
  click(desktop.root.querySelector("[data-action='toggle-source']"));
  input = desktop.root.querySelector("[data-source]");
  assert.equal(input.value, formatted);
  assert.equal(input.selectionStart, caret.start); assert.equal(input.selectionEnd, caret.end);
});

test("Void shows Not saved and retries the captured operation before saving later typing", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const attempts = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], (url, init) => {
    if (init.method === "PUT" && String(url).includes("/void/texts/")) attempts.push({ key: init.headers["Idempotency-Key"], body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]"), "The document did not open.");
  const editor = desktop.app.editors.current;
  fixture.control.setFault({ method: "PUT", path: `/api/v1/void/texts/${notes.id}`, dropAfterCommit: true });
  typeInput(desktop.root.querySelector("[data-source]"), "**First 😀**", 2, 2);
  await assert.rejects(editor.voidSaver.flush());
  assert.equal(desktop.root.querySelector("[data-void-save]").textContent, "Not saved");
  assert.equal(desktop.root.querySelector("[data-void-error]").querySelector("span").textContent, text("en", "voidSaveError"));
  assert.equal(textDraft(editor, notes.id, "Intro.Welcome", "en"), "**First 😀**");
  typeInput(desktop.root.querySelector("[data-source]"), "**Later 😀**", 2, 2);
  click(desktop.root.querySelector("[data-action='retry-void-save']"));
  await waitFor(() => editor.saveState === "saved", "The retained save and later typing did not finish.");
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.notEqual(attempts[2].key, attempts[1].key);
  assert.equal(attempts[2].body.document.pages[0].en, "**Later 😀**");
  assert.equal(editor.authoritative.document.pages[0].en, "**Later 😀**");
  assert.equal(editor.textDrafts.size, 0);
  assert.equal(editor.authoritative.document.sentinel, "void-sentinel");
  assert.equal(editor.authoritative.document.pages[0].sentinel, "void-page-sentinel");
  assert.equal(desktop.root.querySelector("[data-void-error]"), null);
  assert.equal(desktop.root.querySelector("[data-void-save]").textContent, "Saved");
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
  const token = desktop.app.api.token;
  desktop.app.store.stream = { state: "error", error: "reconnect_exhausted" };
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-stream='stopped']")?.textContent, "La conexión en vivo se detuvo.");
  assert.equal(desktop.root.querySelector("[data-action='retry-stream']")?.textContent, "Reintentar");
  assert.equal(desktop.app.api.token, token);
  assert.equal(desktop.root.querySelector("[data-settings]") != null, true);
  desktop.app.language = "en";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-stream='stopped']")?.textContent, "The live connection stopped.");
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
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]"), "The source field did not appear.");
  click(desktop.root.querySelector("[data-action='toggle-source']"));
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
    assert.equal(edit.getAttribute("hidden"), null);
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
  const group = desktop.app.chatList.catalog.find((item) => (item.members?.length ?? 0) > 2);
  desktop.app.activeHandlers.onActivate({ id: group.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-chat-members]")?.textContent.includes("executor-shop"), "The group members were not shown.");
  await waitFor(() => desktop.root.querySelector("[data-own='true']"), "An own message was not marked.");

  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='attach']"), "The attach control did not appear.");
  const toolbar = desktop.root.querySelector("[data-toolbar='board']");
  assert.equal(toolbar?.getAttribute("role"), "toolbar");
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
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-editor-column='comments']")?.querySelector(".comment-author")?.textContent === "master", "The comment author was not shown.");
  const source = desktop.root.querySelector("[data-source]");
  assert.equal(source?.closest("[data-source-edit]") != null, true);
  assert.equal(desktop.root.querySelector(".reading-card") != null, true);
  await waitFor(() => desktop.root.querySelector("[data-editor-column='comments']")?.querySelector("[data-action='accept-change']"), "The proposal action was not shown.");
  assert.equal(desktop.root.querySelector("[data-editor-column='resource']")?.querySelector("[data-action='accept-change']"), null);

  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  navigate(desktop.app, "hierarchy");
  navigate(desktop.app, "map");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector(".inspector-details")?.querySelector("summary")?.textContent === "Details", "The inspector details did not appear.");
  assert.equal(desktop.root.querySelector(".unit-card") != null, true);
  assert.equal(desktop.root.querySelector("[data-unit-facts]") != null, true);
  assert.equal(desktop.root.querySelector("[data-action-cards]")?.querySelector("[data-task]") != null, true);
  desktop.app.actionNote = "The task is done.";
  desktop.app.actionCode = "done";
  desktop.app.actionScope = "unit";
  navigate(desktop.app, "blueprint");
  assert.equal(desktop.root.querySelector("[data-editor-column='resource']")?.querySelector("[data-action-note]"), null);
  assert.equal(desktop.app.actionNote, "The task is done.");
  assert.equal(desktop.document.querySelector("[data-live='status']").textContent.includes("The task is done."), false);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The task is done."), false);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
  navigate(desktop.app, "map");
  assert.equal(desktop.root.querySelector(".inspector-body")?.querySelector("[data-action-note]")?.textContent, "The task is done.");
  desktop.app.actionScope = "editor";
  navigate(desktop.app, "blueprint");
  assert.equal(desktop.root.querySelector("[data-editor-column='resource']")?.querySelector("[data-action-note]")?.textContent, "The task is done.");
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
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === cart.id && desktop.root.querySelector("[data-comment]"), "The board did not open.");
  desktop.app.editors.selectedNodeId = "kept-node";
  desktop.app.editors.current.selectedNodeId = "kept-node";
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
  const group = phone.app.chatList.catalog.find((item) => (item.members?.length ?? 0) > 2);
  phone.app.activeHandlers.onActivate({ id: group.id, kind: "chat" }, "double");
  await waitFor(() => phone.root.querySelector("h1")?.textContent === (group.title || group.id), "The phone heading did not follow the group.");
  click(phone.root.querySelector("[data-phone-mode='waiting']"));
  await waitFor(() => phone.root.querySelector("h1")?.textContent === "Waiting", "Waiting kept the conversation title.");
  assert.equal(phone.document.title, "Waiting · HIVEM1ND");
  assert.equal(phone.root.querySelector("[data-stage-title]")?.textContent, "Waiting");
  assert.equal(phone.root.querySelector(".side"), null);
  assert.equal(phone.root.querySelector("[data-phone-mode='waiting']")?.getAttribute("aria-pressed"), "true");
  assert.equal(phone.root.querySelector("[data-phone-mode='chats']")?.getAttribute("aria-pressed"), "false");
  click(phone.root.querySelector("[data-phone-mode='chats']"));
  await waitFor(() => phone.root.querySelector("h1")?.textContent === (group.title || group.id), "The chat title did not return.");
  assert.equal(phone.root.querySelector("[data-phone-mode='chats']")?.getAttribute("aria-pressed"), "true");
  click(phone.root.querySelector("[data-phone-mode='hierarchy']"));
  await waitFor(() => phone.root.querySelector("h1")?.textContent === "Hierarchy", "Hierarchy did not restore its title.");
  assert.equal(phone.root.querySelector("[data-phone-mode='hierarchy']")?.getAttribute("aria-pressed"), "true");
  assert.equal(phone.document.title, "Hierarchy · HIVEM1ND");
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
  assert.equal(desktop.root.querySelector("[data-action='leave-focus']")?.textContent, "Document");
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
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='add-node']"), "The shape control did not appear.");
  click(desktop.root.querySelector("[data-action='add-node']"));
  await waitFor(() => nodePosts === 1, "The shape write did not start.");
  click(desktop.root.querySelector("[data-action='add-node']"));
  assert.equal(nodePosts, 1);
  releaseNodes();
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.screens?.some((screen) => screen.root.kids.some((node) => node.name === "Added")), "The shape was not saved.");

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
  assert.equal(limitsUsage("en", { used: 0, max: 0 }, { used: 0, max: 0 }), "0 of 0 messages and 0 of 0 sync bytes.");
  assert.equal(limitsUsage("en", { used: 1, max: 1 }, { used: 1, max: 1 }), "1 of 1 message and 1 of 1 sync byte.");
  assert.equal(limitsUsage("en", { used: 1, max: 2 }, { used: 1, max: 2 }), "1 of 2 messages and 1 of 2 sync bytes.");
  assert.equal(limitsUsage("en", { used: 12, max: 60 }, { used: 1, max: 50000000 }), "12 of 60 messages and 1 of 50,000,000 sync bytes.");
  assert.equal(limitsUsage("es", { used: 0, max: 0 }, { used: 0, max: 1 }), "0 de 0 mensajes y 0 de 1 byte de sincronización.");
  assert.equal(limitsUsage("es", { used: 1, max: 1 }, { used: 2, max: 60 }), "1 de 1 mensaje y 2 de 60 bytes de sincronización.");
  assert.equal(limitsUsage("es", { used: 2, max: 60 }, { used: 1, max: 1 }), "2 de 60 mensajes y 1 de 1 byte de sincronización.");
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
  await waitFor(() => booted.root.querySelector("[data-boot='failed']"), "Startup did not fail closed.");
  assert.equal(booted.root.querySelector("h2")?.textContent, "The M1ND cannot be read");
  assert.equal(booted.root.querySelector("[data-action='retry-boot']")?.textContent, "Retry");
  assert.equal(booted.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(booted.document.querySelectorAll("[data-live='error']").length, 1);
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Loading."), false);
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Reading the mind."), false);
  assert.equal(booted.document.querySelector("[data-live='error']").textContent, "The M1ND cannot be read");
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
  await waitFor(() => booted.root.querySelector("[data-boot='failed']"), "The failed startup did not stay recoverable.");
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Loading."), false);
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Reading the mind."), false);
  assert.equal(api.token, token);
  assert.equal(history.urls.length, 1);
  assert.equal(history.urls[0].includes(token), false);
  assert.equal(history.urls[0].includes("session="), false);
  click(booted.root.querySelector("[data-action='retry-boot']"));
  await waitFor(() => booted.root.querySelector("[data-boot='ready']"), "Retry did not open the desktop shell.");
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Loading."), false);
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Reading the mind."), false);
  assert.equal(booted.document.querySelector("[data-live='error']").textContent.includes("The service is unavailable."), false);
  assert.equal(booted.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(booted.document.querySelectorAll("[data-live='error']").length, 1);
  assert.equal(booted.app.api, api);
  assert.equal(booted.app.api.token, token);
  assert.equal(authorizations.length >= 2, true);
  assert.equal(authorizations.every((value) => value === `Bearer ${token}`), true);
  assert.equal(history.urls.length, 1);
});

test("a delayed initial read keeps the desktop frame and skeleton panels visible", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const { document, root } = createTestDocument(1440);
  const url = new URL(fixture.desktopUrl);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = mount(root, {
    location: url, history: { replaceState() {} }, mindPath: join(fixture.root, "Cosmic", "hivem1nd"),
    fetch: async (input, init) => {
      if (new URL(input).pathname === "/api/v1/view") await gate;
      return fetch(input, init);
    },
  });
  assert.equal(root.querySelector("[data-boot='reading']") != null, true);
  assert.equal(root.querySelector(".bar") != null, true);
  assert.equal(root.querySelector(".foot") != null, true);
  assert.equal(root.querySelectorAll(".opening-skeleton").length, 14);
  assert.equal(root.querySelector("h2").textContent, "Reading the M1ND");
  assert.equal(document.querySelector("[data-live='status']").textContent, "Reading the M1ND");
  await delay(50);
  assert.equal(root.querySelector("[data-boot='reading']") != null, true);
  release();
  const app = await pending;
  t.after(() => dispose(app));
  assert.equal(root.querySelector("[data-boot='ready']") != null, true);
  assert.equal(root.querySelector(".opening-skeleton"), null);
  assert.equal(document.querySelector("[data-live='status']").textContent, "");
});

test("the initial read ends at 30000 milliseconds with its selected folder and Retry", async (t) => {
  const { document, root } = createTestDocument(1440);
  const selected = "C:\\fixtures\\offline\\.m1nd";
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = mount(root, {
    location: { origin: "http://127.0.0.1:43123", pathname: "/gui/viewer", hash: "#session=fixture-credential" },
    history: { replaceState() {} }, mindPath: selected,
    fetch: async (input, init) => {
      if (new URL(input).pathname === "/api/v1/events") return new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/event-stream" } });
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    },
  });
  t.mock.timers.tick(29999);
  assert.equal(root.querySelector("[data-boot='reading']") != null, true);
  t.mock.timers.tick(1);
  const app = await pending;
  t.after(() => dispose(app));
  assert.equal(root.querySelector("[data-boot='failed']") != null, true);
  assert.equal(root.querySelector("[data-opening-cause]").textContent, `${selected} did not answer in 30 s. The drive may be offline, or another program may hold the folder.`);
  assert.equal(root.querySelector("[data-action='retry-boot']").textContent, "Retry");
  assert.equal(root.querySelector("[data-action='choose-folder']").textContent, "Choose another folder");
  assert.equal(root.querySelectorAll(".opening-skeleton").length, 14);
  assert.equal(document.querySelector("[data-live='error']").textContent, "The M1ND cannot be read");
  assert.equal(app.api.token != null, true);
  app.language = "es";
  renderShell(app);
  assert.equal(root.querySelector("h2").textContent, "No se puede leer el M1ND");
  assert.equal(root.querySelector("[data-action='choose-folder']").textContent, "Elegir otra carpeta");
  assert.equal(root.querySelector("[data-opening-cause]").textContent.includes("no respondió en 30 s"), true);
  t.mock.timers.reset();
});

test("an inaccessible-folder cause exposes no credential and choosing another folder retains drafts", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const selected = join(fixture.root, "Cosmic", "hivem1nd");
  let handoff = null;
  const booted = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    if (new URL(input).pathname === "/api/v1/view") return new Response(JSON.stringify({ error: { code: "folder_unreadable", message: `Access is denied. ${init.headers.Authorization}` } }), { status: 403, headers: { "content-type": "application/json" } });
    return fetch(input, init);
  }, { mindPath: selected, chooseFolder: async (input) => { handoff = input; } });
  t.after(() => dispose(booted.app));
  assert.equal(booted.root.querySelector("[data-opening-cause]").textContent.includes(selected), true);
  assert.equal(booted.root.querySelector("[data-opening-cause]").textContent.includes("Access is denied."), true);
  const token = booted.app.api.token;
  for (const node of booted.document.querySelectorAll("p, h2, [data-live]")) assert.equal(node.textContent.includes(token), false);
  const drafts = new Map([["document", { text: "Keep this draft." }]]);
  booted.app.store.drafts = drafts;
  const api = booted.app.api;
  click(booted.root.querySelector("[data-action='choose-folder']"));
  await delay(0);
  assert.deepEqual(handoff, { mindPath: selected });
  assert.equal(booted.app.api, api);
  assert.equal(api.token, token);
  assert.equal(booted.app.store.drafts, drafts);
  assert.equal(booted.app.disposed, false);
  assert.equal(booted.root.querySelector("[data-boot='failed']") != null, true);
});

test("folder reopening enters Location once without answering or replacing the existing host", async () => {
  const calls = [];
  const session = { currentStep: 8, answer() { throw new Error("The existing setup draft must not be written."); } };
  const wizard = { url: "http://127.0.0.1:43123/#session=fixture-credential" };
  const reopen = createFolderReopen({ mindPath: "C:\\fixtures\\.m1nd", kitPath: resolve(".") }, {
    createSetupSession: async (input) => { calls.push(input); return session; },
    createWizardServer: async (input) => { assert.equal(input.session, session); return wizard; },
  });
  const [first, second] = await Promise.all([reopen(), reopen()]);
  assert.equal(first, wizard);
  assert.equal(second, wizard);
  assert.equal(session.currentStep, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].resume, false);
  assert.equal(calls[0].serviceSetup, true);
});

test("the owned folder handoff protects its authority and preserves the host and checkpoint bytes", async (t) => {
  const fixture = await makeCoreFixture();
  let host;
  t.after(async () => { await host?.stop(); await closeGuiHost(); await disposeCoreFixture(fixture); });
  const origin = join(fixture.root, "gui-origin");
  await mkdir(origin, { recursive: true });
  await writeFile(fixture.paths.configFile, JSON.stringify({ format: "hivem1nd-service-config-v1", mindPath: fixture.paths.mind, machine: fixture.machine, origin: { kind: "folder", path: origin }, stagingPath: fixture.paths.staging, port: 0 }));
  const draft = join(fixture.paths.localDirectory, "setup-draft.json");
  const checkpoint = join(fixture.paths.localDirectory, "setup.json");
  const before = Buffer.from('{"sentinel":"retain the existing setup"}\n');
  await writeFile(draft, before);
  await writeFile(checkpoint, before);
  host = await startGui({ mindPath: fixture.paths.mind, env: fixture.env, home: fixture.home, platform: fixture.platform, machine: fixture.machine, now: () => fixture.clock.now, aclRunner: fixture.store.aclRunner });
  const headers = { Origin: host.origin, Authorization: `Bearer ${host.token}`, "Content-Type": "application/json" };
  const selected = await fetch(`${host.origin}/api/v1/viewer/folder`, { headers });
  assert.equal(selected.status, 200);
  assert.equal((await selected.json()).data.mindPath, fixture.paths.mind);
  const rejected = await fetch(`${host.origin}/api/v1/viewer/folder`, { method: "POST", headers: { ...headers, Origin: "http://127.0.0.1:1" }, body: "{}" });
  assert.equal(rejected.status, 403);
  await rejected.arrayBuffer();
  const opened = await fetch(`${host.origin}/api/v1/viewer/folder`, { method: "POST", headers, body: "{}" });
  assert.equal(opened.status, 200);
  const wizard = new URL((await opened.json()).data.url);
  const credential = new URLSearchParams(wizard.hash.slice(1)).get("session");
  const step = await fetch(`${wizard.origin}/api/v1/step`, { headers: { Origin: wizard.origin, Authorization: `Bearer ${credential}` } });
  assert.equal(step.status, 200);
  assert.equal((await step.json()).data.id, "location");
  assert.equal((await readFile(draft)).equals(before), true);
  assert.equal((await readFile(checkpoint)).equals(before), true);
  assert.equal(host.stopped, false);
  const viewer = await fetch(`${host.origin}/api/v1/viewer`, { headers });
  assert.equal(viewer.status, 200);
  await viewer.arrayBuffer();
});

test("first-run creates the Overseer once despite repeated clicks and selects the actual unit", async (t) => {
  const fixture = await createGuiFixture({ scenario: "first-run" });
  t.after(() => fixture.close());
  const writes = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const booted = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (new URL(input).pathname === "/api/v1/units" && init.method === "POST") { writes.push(JSON.parse(init.body)); await gate; }
  });
  t.after(() => dispose(booted.app));
  assert.equal(booted.root.querySelector(".workspace-empty") != null, true);
  assert.equal(booted.root.querySelector("[data-action='waiting']"), null);
  assert.equal(booted.root.querySelectorAll("[data-unit]").length, 1);
  assert.equal(booted.root.querySelector(".map-edge"), null);
  const create = booted.root.querySelector("[data-action='create-overseer']");
  click(create);
  click(create);
  await waitFor(() => writes.length === 1, "The Overseer create request was not sent.");
  click(booted.root.querySelector("[data-action='create-overseer']"));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { unit: "overseer", role: "overseer", scope: { kind: "root", name: null }, machine: "DESKTOP", leadId: null, job: null, model: null, position: { x: 372, y: 178 } });
  release();
  await waitFor(() => !booted.app.overseerCreating, "The creation did not settle.");
  assert.equal(booted.app.overseerError?.message ?? null, null);
  assert.equal(booted.app.store.selected.unitId, "root:overseer");
  assert.equal(booted.root.querySelector(".map-node.is-selected")?.getAttribute("data-unit-id"), "root:overseer");
  const units = (await request(apiFrom(fixture.desktopUrl), "GET", "/units")).data.items;
  assert.deepEqual(units.map((unit) => unit.id).sort(), ["root:master", "root:overseer"]);
  assert.equal(booted.root.querySelector(".workspace-empty"), null);
});

test("a failed first-run request keeps the empty state and its creation control", async (t) => {
  const fixture = await createGuiFixture({ scenario: "first-run" });
  t.after(() => fixture.close());
  const booted = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    if (new URL(input).pathname === "/api/v1/units" && init.method === "POST") return new Response(JSON.stringify({ error: { code: "machine_unavailable", message: "The machine is unavailable.", details: { machine: "DESKTOP" } } }), { status: 409, headers: { "content-type": "application/json" } });
    return fetch(input, init);
  });
  t.after(() => dispose(booted.app));
  booted.app.language = "es";
  renderShell(booted.app);
  assert.equal(booted.root.querySelector("[data-action='create-overseer']").textContent, "Crear el Overseer");
  click(booted.root.querySelector("[data-action='create-overseer']"));
  await waitFor(() => booted.app.overseerError && !booted.app.overseerCreating, "The failed creation did not settle.");
  assert.equal(booted.root.querySelector(".workspace-empty") != null, true);
  assert.equal(booted.root.querySelector("[data-action='create-overseer']").disabled, false);
  assert.equal(booted.app.store.selected.unitId, null);
  assert.equal(booted.root.querySelector("[role='alert']") != null, true);
  const units = (await request(apiFrom(fixture.desktopUrl), "GET", "/units")).data.items;
  assert.deepEqual(units.map((unit) => unit.id), ["root:master"]);
});

test("manual presentation choices replace only their viewer override and retry without another settings write", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  await request(api, "PATCH", "/viewer", { operation: createOperation({
    method: "PATCH", path: "/viewer", body: { look: "modern", language: "en" },
  }) });
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method === "PATCH") writes.push({ path: new URL(String(input)).pathname, key: headerValue(init.headers, "Idempotency-Key") });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-look='high-contrast']"), "Settings did not open.");
  const before = await countNamedEvents(fixture.root, "settings.changed");
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/viewer", dropAfterCommit: true });
  click(desktop.root.querySelector("[data-look='high-contrast']"));
  await waitFor(() => desktop.root.querySelector("[data-action='retry-activity']"), "The lost viewer response did not offer Retry.");
  click(desktop.root.querySelector("[data-action='retry-activity']"));
  await waitFor(() => desktop.app.activity.get("settings")?.phase === "success", "The viewer retry did not finish.");
  assert.equal(desktop.app.look, "high-contrast");
  assert.equal(desktop.app.language, "en");
  const viewerWrites = writes.filter(item => item.path === "/api/v1/viewer");
  assert.equal(viewerWrites.length, 2);
  assert.equal(viewerWrites[0].key, viewerWrites[1].key);
  assert.equal(writes.filter(item => item.path === "/api/v1/settings").length, 1);
  assert.equal(await countNamedEvents(fixture.root, "settings.changed"), before + 1);
  let viewer = (await request(api, "GET", "/viewer")).data;
  assert.equal(viewer.look, null);
  assert.equal(viewer.language, "en");
  click(desktop.root.querySelector("[data-language='es']"));
  await waitFor(() => desktop.app.language === "es" && desktop.app.activity.get("settings")?.phase === "success", "The language override was not replaced.");
  viewer = (await request(api, "GET", "/viewer")).data;
  assert.equal(viewer.language, null);
  assert.equal(desktop.document.documentElement.lang, "es");
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
  assert.equal(desktop.app.actionKey === "settings" && desktop.app.actionTone === "error", false);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The action failed."), false);
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
  assert.equal(desktop.app.actionKey === "home-open" && desktop.app.actionTone === "error", false);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The action failed."), false);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
  const homeWrites = writes.filter((item) => item.path === "/api/v1/settings/home-network");
  assert.equal(homeWrites.length, 2);
  assert.equal(homeWrites[0].key, homeWrites[1].key);
  assert.deepEqual(homeWrites[0].body, homeWrites[1].body);
  const home = await request(desktop.app.api, "GET", "/settings");
  assert.equal(home.data.home.enabled, true);
});

test("a resolved action clears only its own error and navigation drops stale announcements", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-task='project:shop:029']"), "The task list did not load.");
  fixture.control.setFault({ method: "POST", path: "/api/v1/tasks/project:shop:029/status", status: 503, code: "service_unavailable" });
  click(desktop.root.querySelector("[data-task='project:shop:029']").querySelector("[data-action='accept']"));
  await waitFor(() => desktop.app.activity.get("task:project:shop:029")?.phase === "error", "The task failure was not kept.");
  const taskFailure = desktop.app.activity.get("task:project:shop:029");

  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-look='high-contrast']"), "Settings did not open.");
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", status: 503, code: "service_unavailable" });
  click(desktop.root.querySelector("[data-look='high-contrast']"));
  await waitFor(() => desktop.app.activity.get("settings")?.phase === "error", "The settings failure was not shown.");
  assert.equal(taskFailure.phase, "error");
  navigate(desktop.app, "focus");
  assert.equal(desktop.root.querySelector("[data-activity='task:project:shop:029']"), null);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The action failed."), false);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
  navigate(desktop.app, "settings");
  click(desktop.root.querySelector("[data-action='retry-activity'][data-activity='settings']"));
  await waitFor(() => desktop.app.activity.get("settings")?.phase === "success", "The settings retry did not finish.");
  assert.equal(desktop.app.actionKey === "settings" && desktop.app.actionTone === "error", false);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The action failed."), false);
  assert.equal(desktop.app.activity.get("task:project:shop:029").phase, "error");

  navigate(desktop.app, "blueprint");
  assert.equal(desktop.root.querySelector("[data-activity='task:project:shop:029']"), null);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The action failed."), false);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
  assert.equal(desktop.app.activity.get("task:project:shop:029").phase, "error");
  navigate(desktop.app, "map");
  assert.equal(desktop.root.querySelector("[data-activity='task:project:shop:029']") != null, true);

  navigate(desktop.app, "chats");
  await waitFor(() => desktop.app.chatList?.catalog?.length, "The chat list did not load.");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === chat.id && desktop.root.querySelector("[data-composer]"), "The chat did not open.");
  fixture.control.setFault({ method: "POST", path: `/api/v1/chats/${chat.id}/messages`, status: 503, code: "timeout" });
  typeInput(desktop.root.querySelector("[data-composer]"), "Retry me", 0, 8);
  click(desktop.root.querySelector("[data-action='send']"));
  await waitFor(() => desktop.root.querySelector("[data-action-note]")?.getAttribute("data-code") === "timeout", "The chat failure was not announced.");
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.length > 0, true);
  click(desktop.root.querySelector("[data-action='retry-message']"));
  await waitFor(() => [...desktop.root.querySelectorAll("[data-message]")].some((node) => node.textContent === "Retry me" && node.getAttribute("data-pending") == null), "The retried chat was not delivered.");
  assert.notEqual(desktop.app.actionKey, `chat:${chat.id}`);
  assert.notEqual(desktop.root.querySelector("[data-action-note]")?.getAttribute("data-code"), "timeout");
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("timed out"), false);
  assert.equal(desktop.app.activity.get("task:project:shop:029").phase, "error");
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
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

test("personal folders, zones and chats select one group and deletion offers only ten seconds of Undo", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const members = ["project:shop:executor-shop", "env:web:overlord-web", "project:blog:executor-shop"];
  const before = (await request(api, "GET", "/units")).data.items.map((unit) => [unit.id, unit.leadId]);
  const direct = (await request(api, "GET", "/chats", { query: { listed: "true" } })).data.items.filter((chat) => chat.kind === "direct").map((chat) => chat.id);
  const group = (await createGroup(api, "Checkout launch", members)).data;
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  assert.equal(desktop.app.activeRows[0].id, "section:personal");
  const folder = desktop.root.querySelector(`[data-personal-folder="${group.id}"]`);
  assert.equal(folder.getAttribute("aria-expanded"), "true");
  assert.equal(desktop.root.querySelector("[data-action='new-group']").getAttribute("aria-label"), "New group");
  click(folder);
  await waitFor(() => desktop.app.thread?.chat?.id === group.chatId, "The folder did not select its linked chat.");
  assert.equal(desktop.app.store.selected.groupId, group.id);
  assert.equal(desktop.root.querySelector(`[data-group-inspector="${group.id}"]`) != null, true);
  assert.equal(desktop.root.querySelector("[data-composer]").getAttribute("aria-label"), "Message the group");
  assert.equal(desktop.root.querySelectorAll(".field-hint").some((node) => node.textContent.includes("Every member sees every reply")), true);
  assert.equal(desktop.app.activeRows.filter((row) => row.personalMember).length, 0);
  click(desktop.root.querySelector(`[data-group-id="${group.id}"]`));
  assert.equal(desktop.app.store.selected.groupId, group.id);
  navigate(desktop.app, "chats");
  desktop.app.activeHandlers.onActivate({ id: group.chatId, kind: "chat" }, "single");
  assert.equal(desktop.app.store.selected.groupId, group.id);
  clickAction(desktop.root, "delete-group");
  const dialog = desktop.document.querySelector("dialog");
  assert.match(dialog.querySelector("p").textContent, /chat moves to Archived/);
  click(dialog.querySelector("button.primary"));
  await waitFor(() => !desktop.app.store.indexes.groups.has(group.id) && desktop.root.querySelector("[data-action='map-undo']"), "The confirmed deletion did not offer Undo.");
  const archived = (await request(api, "GET", "/chats", { query: { archived: "true" } })).data.items;
  assert.equal(archived.some((chat) => chat.id === group.id && chat.archived), true);
  const undoKey = desktop.app.mapToast.key;
  clickAction(desktop.root, "map-undo");
  await waitFor(() => desktop.app.store.indexes.groups.has(group.id), "Undo did not restore the group.");
  await waitFor(() => desktop.app.activity.get(undoKey)?.phase === "success", "Undo did not finish.");
  clickAction(desktop.root, "delete-group");
  click(desktop.document.querySelector("dialog").querySelector("button.primary"));
  await waitFor(() => desktop.root.querySelector("[data-action='map-undo']"), "The second deletion did not offer Undo.");
  await fixture.control.advance(10001);
  const originalClock = desktop.app.api.now;
  desktop.app.api.now = () => originalClock() + 10001;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-action='map-undo']"), null);
  const remaining = (await request(api, "GET", "/chats", { query: { listed: "true" } })).data.items;
  assert.equal(direct.every((id) => remaining.some((chat) => chat.id === id)), true);
  assert.deepEqual((await request(api, "GET", "/units")).data.items.map((unit) => [unit.id, unit.leadId]), before);
});

test("the group dialog creates and edits one linked chat without changing reporting relationships", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  const before = desktop.app.unitList.catalog.map((unit) => [unit.id, unit.leadId]);
  const ids = ["project:shop:executor-shop", "env:web:overlord-web"];
  desktop.app.mapState.selection = new Set(ids);
  desktop.app.mapState.onSelection(ids);
  clickAction(desktop.root, "save-group");
  let dialog = desktop.document.querySelector("[data-form='group']");
  click(dialog.querySelector("[data-action='confirm-form']"));
  assert.equal(dialog.querySelector("[data-field-error='title']") != null, true);
  typeInput(dialog.querySelector("[name='title']"), "API work", 0, 8);
  click(dialog.querySelector("[data-action='confirm-form']"));
  await waitFor(() => desktop.app.store.selected.groupId && desktop.document.querySelector("[data-form='group']") == null, "The group dialog did not commit.");
  const id = desktop.app.store.selected.groupId;
  await waitFor(() => desktop.app.thread?.chat?.id === id, "The created group did not open its chat.");
  clickAction(desktop.root, "group-members");
  dialog = desktop.document.querySelector("[data-form='group']");
  typeInput(dialog.querySelector("[name='title']"), "API launch", 0, 10);
  click(dialog.querySelector(`[data-member="${ids[1]}"]`));
  click(dialog.querySelector("[data-action='confirm-form']"));
  await waitFor(() => desktop.app.store.indexes.groups.get(id)?.title === "API launch" && desktop.document.querySelector("[data-form='group']") == null, "The group edit did not finish.");
  const chat = (await request(apiFrom(fixture.desktopUrl), "GET", "/chats/:chatId", { params: { chatId: id } })).data;
  assert.equal(chat.title, "API launch");
  assert.equal(chat.kind, "group");
  assert.deepEqual(new Set(chat.members), new Set(["root:master", ids[0]]));
  assert.deepEqual(desktop.app.unitList.catalog.map((unit) => [unit.id, unit.leadId]), before);
  desktop.app.mapState.selection = new Set([ids[0]]);
  desktop.app.mapState.onSelection([ids[0]]);
  await waitFor(() => desktop.app.thread?.chat?.kind === "direct" && desktop.app.thread.chat.members.includes(ids[0]), "The single selection kept the previous group chat.");
});

test("connection direction waits for the authoritative commit and Undo restores the recorded lead", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method !== "PUT" || !String(input).endsWith("/lead")) return;
    writes.push(JSON.parse(init.body));
    if (writes.length === 1) await gate;
  });
  t.after(() => dispose(desktop.app));
  const target = desktop.app.unitList.catalog.find((unit) => unit.id === "project:blog:executor-shop");
  const source = desktop.app.unitList.catalog.find((unit) => unit.id === "env:web:overlord-web");
  const group = (await createGroup(apiFrom(fixture.desktopUrl), "Keep membership", [target.id])).data;
  desktop.app.mapState.onConnect({ source: source.id, target: target.id });
  let dialog = desktop.document.querySelector("dialog");
  assert.match(dialog.querySelector("p").textContent, /executor-shop will report to overlord-web/);
  click(dialog.querySelector("button"));
  assert.equal(writes.length, 0);
  assert.equal(desktop.app.unitList.catalog.find((unit) => unit.id === target.id).leadId, target.leadId);
  desktop.app.mapState.onConnect({ source: source.id, target: target.id });
  dialog = desktop.document.querySelector("dialog");
  click(dialog.querySelector("button.primary"));
  await waitFor(() => writes.length === 1, "The connection was not submitted.");
  assert.equal(writes[0].leadId, source.id);
  assert.equal(desktop.root.querySelector("[data-pending-edge]") != null, true);
  assert.equal(desktop.root.querySelector("[data-action='map-undo']"), null);
  assert.equal(desktop.app.unitList.catalog.find((unit) => unit.id === target.id).leadId, target.leadId);
  release();
  await waitFor(() => desktop.root.querySelector("[data-action='map-undo']") && desktop.document.querySelector("dialog") == null, "The committed connection did not offer Undo.");
  assert.equal(desktop.app.unitList.catalog.find((unit) => unit.id === target.id).leadId, source.id);
  const undoKey = desktop.app.mapToast.key;
  clickAction(desktop.root, "map-undo");
  await waitFor(() => ["success", "error"].includes(desktop.app.activity.get(undoKey)?.phase), "Undo did not settle.");
  assert.equal(desktop.app.activity.get(undoKey).error?.code ?? null, null);
  assert.equal(writes.length, 2);
  assert.equal(desktop.app.unitList.catalog.find((unit) => unit.id === target.id)?.leadId, target.leadId);
  assert.equal(writes[1].leadId, target.leadId);
  assert.deepEqual((await request(apiFrom(fixture.desktopUrl), "GET", "/groups")).data.items.find((item) => item.id === group.id).members, [target.id]);
});

test("alias keyboard, menu, cancel, conflicts and Undo preserve the recorded previous alias", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const id = "project:blog:executor-shop";
  const original = (await request(api, "GET", "/units/:unitId", { params: { unitId: id } })).data;
  await setUnitAlias(api, original, "Previous blog");
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method === "PATCH" && String(input).endsWith("/alias")) writes.push(JSON.parse(init.body));
  });
  t.after(() => dispose(desktop.app));
  const unit = desktop.app.unitList.catalog.find((item) => item.id === id);
  desktop.app.activeHandlers.onActivate({ id, kind: "unit", unit }, "double");
  await waitFor(() => desktop.app.thread?.chat?.members?.includes(id), "The unit chat did not open.");
  assert.equal(desktop.app.mapState.centered, id);
  assert.equal(desktop.root.querySelector("[data-alias-input]"), null);
  const row = desktop.root.querySelector(`[data-id="${id}"]`);
  for (const handler of desktop.root.listeners.get("keydown") ?? []) handler({ key: "F2", target: row, preventDefault() {} });
  let input = desktop.root.querySelector("[data-alias-input]");
  assert.equal(desktop.document.activeElement, input);
  typeInput(input, "Canceled", 0, 8);
  for (const handler of input.listeners.get("keydown")) handler({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.equal(desktop.app.aliasEdit, null);
  assert.equal(writes.length, 0);
  clickAction(desktop.root, "rename-unit");
  input = desktop.root.querySelector("[data-alias-input]");
  typeInput(input, "Blog", 0, 4);
  const current = (await request(api, "GET", "/units/:unitId", { params: { unitId: id } })).data;
  await setUnitAlias(api, current, "Elsewhere");
  for (const handler of input.listeners.get("keydown")) handler({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  await waitFor(() => desktop.app.aliasEdit?.error && !desktop.app.aliasEdit.saving, "The alias conflict did not retain the draft.");
  assert.equal(desktop.app.aliasEdit.value, "Blog");
  assert.equal(desktop.root.querySelector("[data-action='map-undo']"), null);
  input = desktop.root.querySelector("[data-alias-input]");
  desktop.app.aliasEdit.value = "An older input event";
  input.value = "Blog";
  for (const handler of input.listeners.get("keydown")) handler({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  await waitFor(() => !desktop.app.aliasEdit && desktop.root.querySelector("[data-action='map-undo']") && desktop.app.unitList.catalog.find((item) => item.id === id)?.alias === "Blog", "The alias retry did not commit.");
  const renamed = desktop.app.unitList.catalog.find((item) => item.id === id);
  assert.equal(renamed.alias, "Blog");
  assert.equal(renamed.id, id);
  assert.equal(renamed.leadId, original.leadId);
  for (const host of [desktop.root.querySelector(`[data-id="${id}"]`), desktop.root.querySelector(`[data-unit-id="${id}"]`), desktop.root.querySelector(".chat-title"), desktop.root.querySelector(".unit-card")]) {
    assert.equal(host.querySelector(".unit-alias").textContent, "Blog");
    assert.equal(host.querySelector(".unit-original").textContent, "executor-shop");
  }
  clickAction(desktop.root, "map-undo");
  await waitFor(() => desktop.app.unitList.catalog.find((item) => item.id === id)?.alias === "Elsewhere", "Undo did not restore the authoritative previous alias.");
  assert.equal(writes.at(-1).alias, "Elsewhere");
  assert.notEqual(writes.at(-1).expectedRevision, writes[0].expectedRevision);
});

test("selection actions count canonical recipients and Message all creates no personal group", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  const ids = ["project:shop:executor-shop", "env:web:overlord-web", "project:blog:executor-shop"];
  desktop.app.mapState.selection = new Set(["root:master", ...ids]);
  desktop.app.mapState.onSelection([...desktop.app.mapState.selection]);
  assert.equal(desktop.root.querySelector("[data-selection-count]").getAttribute("data-selection-count"), "3");
  assert.equal(desktop.root.querySelector("[data-action='message-all']").textContent, "Message all 3");
  clickAction(desktop.root, "save-group");
  let dialog = desktop.document.querySelector("[data-form='group']");
  assert.equal(dialog.querySelectorAll("[data-member]").length, 3);
  click(dialog.querySelector(`[data-member="${ids[2]}"]`));
  assert.equal(dialog.querySelectorAll("[data-member]").length, 2);
  click(dialog.querySelector("[data-action='add-group-member']"));
  click(dialog.querySelector(`[data-member-choice="${ids[2]}"]`));
  assert.equal(dialog.querySelectorAll("[data-member]").length, 3);
  for (const handler of dialog.listeners.get("keydown")) handler({ key: "Escape", preventDefault() {} });
  assert.equal(desktop.document.querySelector("[data-form='group']"), null);
  clickAction(desktop.root, "message-all");
  await waitFor(() => desktop.app.thread?.chat?.members?.length === 4, "Message all did not open all three recipients.");
  assert.deepEqual(new Set(desktop.app.thread.chat.members), new Set(["root:master", ...ids]));
  assert.equal((await request(apiFrom(fixture.desktopUrl), "GET", "/groups")).data.total, 0);
  desktop.app.mapState.selection = new Set(ids);
  desktop.app.mapState.onSelection(ids);
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-action='message-all']").textContent, "Enviar un mensaje a las 3 unidades");
  clickAction(desktop.root, "clear-selection");
  assert.equal(desktop.app.mapState.selection.size, 0);
  assert.equal(desktop.app.store.selected.unitId, null);
});

test("the optional group changes only after unit creation and a failed membership retries without another unit", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const group = (await createGroup(api, "New members", ["project:shop:executor-shop"])).data;
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.body && ["POST", "PATCH"].includes(init.method)) writes.push({ path: new URL(input).pathname, body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  clickAction(desktop.root, "new-unit");
  await waitFor(() => desktop.document.querySelector("[data-form='unit']"), "The unit form did not open.");
  const dialog = desktop.document.querySelector("[data-form='unit']");
  assert.equal(dialog.querySelectorAll(".unit-pair").length, 3);
  typeInput(dialog.querySelector("[name='unit']"), "executor-grouped", 0, 16);
  dialog.querySelector("[name='groupId']").value = group.id;
  const offline = dialog.querySelector("[name='machine']").querySelectorAll("option").find((item) => item.value === "OFFLINE");
  assert.equal(offline.disabled, true);
  assert.match(offline.textContent, /Offline since/);
  fixture.control.setFault({ method: "POST", path: "/api/v1/units", status: 409, code: "machine_unavailable" });
  click(dialog.querySelector("[data-action='confirm-form']"));
  await waitFor(() => dialog.querySelector("[data-dialog-error]"), "The failed create did not retain the form.");
  assert.equal(writes.some((write) => write.path.includes("/groups/")), false);
  assert.equal(dialog.querySelector("[name='unit']").value, "executor-grouped");
  fixture.control.setFault({ method: "PATCH", path: `/api/v1/groups/${group.id}`, status: 409, code: "chat_changed" });
  click(dialog.querySelector("[data-action='confirm-form']"));
  await waitFor(() => dialog.querySelector("[data-dialog-error]") && dialog.querySelector("form").created, "The membership failure did not retain the created unit.");
  click(dialog.querySelector("[data-action='confirm-form']"));
  await waitFor(() => desktop.document.querySelector("[data-form='unit']") == null, "The membership retry did not finish.");
  assert.equal(writes.filter((write) => write.path === "/api/v1/units").length, 2);
  const current = (await request(api, "GET", "/groups")).data.items.find((item) => item.id === group.id);
  assert.equal(current.members.includes("project:shop:executor-grouped"), true);
  assert.equal(desktop.app.store.selected.unitId, "project:shop:executor-grouped");
  assert.equal(desktop.root.querySelector("[data-unit-id='project:shop:executor-grouped']") != null, true);
});

test("a reopened board gives each added shape a distinct persisted identity", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const created = [];
  const mounts = [];
  t.after(() => { for (const desktop of mounts) dispose(desktop.app); });
  let expectedCount = null;
  for (let index = 0; index < 2; index += 1) {
    const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/nodes")) created.push(JSON.parse(init.body).node.id);
    });
    mounts.push(desktop);
    navigate(desktop.app, "blueprint");
    await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
    const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
    renderShell(desktop.app);
    click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
    await waitFor(() => desktop.root.querySelector("[data-action='add-node']"), "The board did not open.");
    const kids = () => desktop.app.editors.current.authoritative.document.screens[0].root.kids;
    if (expectedCount === null) expectedCount = kids().length;
    assert.equal(kids().length, expectedCount);
    click(desktop.root.querySelector("[data-action='add-node']"));
    expectedCount += 1;
    await waitFor(() => kids().length === expectedCount, "The new shape was not persisted after reopening.");
    assert.equal(kids().some((node) => node.id === created[index]), true);
    dispose(desktop.app);
  }
  assert.equal(created.length, 2);
  assert.notEqual(created[0], created[1]);
});

test("failure causes and empty lists name the resource and its next step", async (t) => {
  assert.equal(text("en", "requestTimeout"), "The request timed out.");
  assert.equal(text("es", "requestTimeout"), "La solicitud agotó el tiempo.");
  assert.equal(text("en", "requestLimited"), "The request limit was reached.");
  assert.equal(text("es", "commentHintText"), "Seleccionar texto y escribir el comentario.");
  assert.throws(() => text("en", "emptyList"), /Unknown copy key: emptyList/);
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");

  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-look='high-contrast']"), "Settings did not open.");
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", status: 503, code: "timeout" });
  click(desktop.root.querySelector("[data-look='high-contrast']"));
  await waitFor(() => desktop.app.activity.get("settings")?.error?.code === "timeout", "The timeout was not recorded.");
  const timeoutText = desktop.root.querySelector("[data-activity='settings']")?.textContent ?? "";
  assert.equal(timeoutText.includes("The request timed out."), true);
  assert.equal(timeoutText.includes("Try again."), true);
  assert.equal(desktop.root.querySelector("[data-action='retry-activity']") != null, true);

  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", status: 503, code: "service_unavailable" });
  click(desktop.root.querySelector("[data-action='retry-activity']"));
  await waitFor(() => desktop.app.activity.get("settings")?.error?.code === "service_unavailable", "The unavailable cause was not recorded.");
  const unavailableText = desktop.root.querySelector("[data-activity='settings']")?.textContent ?? "";
  assert.equal(unavailableText.includes("The service is unavailable."), true);
  assert.equal(unavailableText.includes("Try again."), true);

  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", status: 429, code: "request_rate_limited" });
  click(desktop.root.querySelector("[data-action='retry-activity']"));
  await waitFor(() => desktop.app.activity.get("settings")?.error?.code === "request_rate_limited", "The limit cause was not recorded.");
  const limitedText = desktop.root.querySelector("[data-activity='settings']")?.textContent ?? "";
  assert.equal(limitedText.includes("The request limit was reached."), true);
  assert.equal(limitedText.includes("Try again."), true);
  assert.equal(limitedText.includes("Wait and try again."), false);

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-comment]"), "The comment field did not open.");
  assert.equal(desktop.root.querySelector("[data-comment]").closest("label").querySelector(".field-hint").textContent, "Select text, then write the comment.");
  assert.equal(desktop.root.querySelector("[data-disabled-reason='comment']")?.textContent, "Select text before commenting on it.");
  assert.equal([...desktop.root.querySelectorAll("p")].some((node) => node.textContent.includes("Choose a screen or node")), false);
  desktop.app.editors.current.threads = [];
  desktop.app.editors.current.commentsTotal = 0;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-empty='comments']")?.textContent, "No comments yet. Select text, then write one.");

  desktop.app.editors.catalog = [];
  desktop.app.editors.catalogTotal = 0;
  desktop.app.editors.loadedKind = "void";
  desktop.app.editors.catalogLoading = false;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-empty='void']")?.textContent, "No texts yet. Create or register one.");
  assert.equal(desktop.root.querySelector("[data-action='open-create']")?.getAttribute("aria-label"), "New text");
  assert.equal(desktop.root.querySelector("[data-action='refresh-catalog']")?.getAttribute("aria-label"), "Refresh");
  assert.equal([...desktop.root.querySelectorAll("p")].some((node) => node.textContent.includes("Nothing to show yet.")), false);

  navigate(desktop.app, "map");
  await waitFor(() => desktop.app.unitList && desktop.app.unitList.status !== "loading", "The unit list did not settle.");
  if (desktop.app.store.view) desktop.app.store.view.issues = [];
  desktop.app.unitList.issues = [];
  desktop.app.unitList.query = "zzzz-no-match";
  desktop.app.unitList.status = "empty";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-empty='issues']")?.textContent, "No issues to review. Refresh to check again.");
  assert.equal(desktop.root.querySelector("[data-action='refresh-issues']")?.textContent, "Refresh");
  assert.equal(desktop.root.querySelector("[data-action='clear-search']")?.textContent, "Clear search");

  click(desktop.root.querySelector("[data-action='waiting']"));
  await waitFor(() => desktop.app.waitingList && desktop.app.waitingList.status !== "loading" && desktop.root.querySelector("[data-waiting-surface]"), "Waiting did not open.");
  desktop.app.waitingList.items = [];
  desktop.app.waitingList.total = 0;
  desktop.app.waitingList.status = "empty";
  renderShell(desktop.app);
  const waiting = desktop.root.querySelector("[data-waiting-surface]");
  assert.equal(waiting.querySelector("[data-empty='waiting']")?.textContent, "Nothing is waiting.");
  assert.equal(waiting.querySelector("[data-empty-next='waiting']")?.textContent, "Open the map to find who is waiting.");
  assert.equal(waiting.querySelector("[data-action='show-map']")?.textContent, "Show the map");
  assert.equal([...desktop.root.querySelectorAll("p")].some((node) => node.textContent.includes("Nothing to show yet.")), false);

  desktop.app.waitingOpen = false;
  navigate(desktop.app, "chats");
  await waitFor(() => desktop.app.chatList?.catalog?.length, "The chat list did not load.");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-composer]"), "The composer did not open.");
  desktop.app.thread.messages = [];
  desktop.app.thread.total = 0;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-empty='chat']")?.textContent, "No messages yet. Write one below.");

  click(desktop.root.querySelector("[data-action='mailbox']"));
  await waitFor(() => desktop.root.querySelector("[data-mailbox-unit]"), "The mailbox list did not open.");
  const unitId = desktop.root.querySelector("[data-mailbox-unit]").getAttribute("data-mailbox-unit");
  click(desktop.root.querySelector(`[data-mailbox-unit="${unitId}"]`));
  await waitFor(() => desktop.root.querySelector(`[data-mailbox-history="${unitId}"]`), "The mailbox history did not open.");
  desktop.app.mailbox.items = [];
  desktop.app.mailbox.optimistic = null;
  desktop.app.mailbox.pending = false;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-empty='mailbox']")?.textContent, "No mailbox messages. Write one below.");
  assert.equal(desktop.root.querySelector("[data-mailbox-compose]") != null, true);
});

test("the board toolbar is one row on the canvas", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart") || desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-toolbar='board']"), "The board toolbar did not appear.");
  const resource = desktop.root.querySelector("[data-editor-column='resource']");
  const comments = desktop.root.querySelector("[data-editor-column='comments']");
  const host = resource.querySelector(".board-host");
  const toolbar = host.querySelector("[data-toolbar='board']");
  const editorTools = resource.querySelector("[data-editor-tools]");
  assert.equal(toolbar?.getAttribute("role"), "toolbar");
  assert.equal(toolbar.className.includes("board-toolbar"), true);
  assert.equal(host.querySelectorAll("[role='toolbar']").length, 1);
  assert.equal(columnIndex(resource, editorTools) < columnIndex(resource, host), true);
  assert.equal(toolbar.querySelector("[data-action='attach']") != null, true);
  assert.equal(toolbar.querySelector("[data-action='watch']") != null, true);
  assert.equal(comments.querySelector("[data-toolbar='board']"), null);
  assert.equal(comments.querySelector("[data-comment]") != null, true);
  const tools = [...toolbar.querySelectorAll("[data-board-tool]")];
  assert.deepEqual(tools.map((node) => node.getAttribute("data-board-tool")), ["select", "frame", "text", "draw", "comment"]);
  assert.deepEqual(tools.map((node) => node.getAttribute("aria-label")), ["Select", "Frame", "Text", "Draw", "Comment"]);
  assert.equal(tools[0].getAttribute("aria-pressed"), "true");
  assert.equal(host.querySelector(".board-properties").querySelector("[data-node-name]") != null, true);
  assert.equal(host.querySelector(".board-properties").querySelector("[data-asset]") != null, true);
  assert.equal(host.querySelector(".board-outline") != null, true);
  const css = await readFile("gui/app/styles.css", "utf8");
  const rule = css.match(/\.board-host > \.board-toolbar \{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(rule, /position:\s*absolute/);
  assert.match(rule, /flex-wrap:\s*nowrap/);
  assert.match(rule, /overflow-x:\s*auto/);
  assert.match(rule, /white-space:\s*nowrap/);
  assert.equal(rule.includes("flex-wrap: wrap"), false);
  assert.match(css, /\[data-mode="focus"\] \.board-toolbar,/);
  const narrowStart = css.indexOf("@media (max-width: 987px)");
  const narrowOpen = css.indexOf("{", narrowStart);
  let depth = 0;
  let narrowEnd = narrowOpen;
  for (let index = narrowOpen; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        narrowEnd = index;
        break;
      }
    }
  }
  assert.equal(css.slice(narrowStart, narrowEnd).includes("board-toolbar"), false);
  assert.match(css, /\.toolbar\s*\{[^}]*flex-wrap:\s*nowrap/);
});

test("the GUI import graph stays inside its ownership table", async () => {
  const plan = await readFile("docs/3.0/plan-gui.md", "utf8");
  const section = plan.split("## File ownership")[1].split("\n## ")[0];
  const owned = new Set([...section.matchAll(/`((?:gui\/app|test)\/[^`]+)`/g)].map((match) => match[1]));
  const integration = await readFile('docs/3.0/integration.md', 'utf8');
  assert.match(integration.split('#### T046.')[1].split('#### T047.')[0], /`gui\/app\/find-worker\.mjs`, new isolated regex worker/);
  owned.add('gui/app/find-worker.mjs');
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
    const audited = rel === "gui/app/main.mjs" ? source.slice(0, source.indexOf("async function exportLegacyDocument")) + source.slice(source.indexOf("export async function importLegacyBoard")) : source;
    assert.equal(audited.includes("import("), false, rel);
    if (rel === "gui/app/main.mjs") {
      assert.match(source, /iframe\.setAttribute\("sandbox", "allow-scripts"\)/);
      assert.match(source, /connect-src 'none'/);
    }
    const specifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (rel === "test/gui-fixture.mjs" && ["../features/blueprint/server.mjs", "../features/blueprint/review/sketch-format.mjs"].includes(specifier)) continue;
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
  await walk(resolve('gui/app/find-worker.mjs'));
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
    getComputedStyle() { return { getPropertyValue: (name) => ({ "--text": "#f5f1f6", "--accent": "#bdcd79", "--waiting": "#e6c06f", "--card": "#211a27" })[name] ?? "" }; },
    btoa, URL, setTimeout, clearTimeout,
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
      contentWindow: tag === "iframe" ? {} : null,
      getContext() { return { measureText: (value) => ({ width: String(value).length * 8 }) }; },
      set src(url) {
        this._src = url;
        if (tag !== "iframe") return;
        const frame = this;
        Promise.resolve().then(async () => {
          const html = await (await fetch(url)).text();
          const scriptUrl = html.match(/<script type="module" src="([^"]+)"/)[1];
          const script = await (await fetch(scriptUrl)).text();
          const prior = globalThis.document;
          globalThis.document = document;
          try {
            const parent = { postMessage(data) { for (const handler of view.listeners.get("message") ?? []) handler({ source: frame.contentWindow, data }); } };
            await new Function("parent", `return (async () => { ${script} })()`)(parent);
          } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
        });
      },
      ownerDocument: document,
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === "class") this.className = String(value);
        if (name.startsWith("data-")) {
          const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          this.dataset[key] = String(value);
        }
      },
      getAttribute(name) { return this.attributes.get(name) ?? null; },
      append(...kids) { for (const kid of kids) this.appendChild(kid && typeof kid === "object" ? kid : document.createTextNode(String(kid))); },
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
      setSelectionRange(start, end, direction = "none") {
        this.selectionStart = start;
        this.selectionEnd = end;
        this.selectionDirection = direction;
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

test("unit removal confirms scope, cancels safely, retries the same write and restores visibility with Undo", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const id = "project:blog:executor-shop";
  const group = (await createGroup(api, "Shared work", [id, "project:shop:executor-shop"])).data;
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], (input, init) => {
    if (init?.method === "DELETE" && String(input).includes("/units/")) writes.push({ key: init.headers["Idempotency-Key"], body: init.body });
  });
  t.after(() => dispose(desktop.app));
  const choose = () => { desktop.app.mapState.selection = new Set([id]); desktop.app.mapState.onSelection([id]); };
  choose();
  clickAction(desktop.root, "remove-unit");
  let dialog = desktop.document.querySelector("[data-remove-unit]");
  assert.equal(dialog.querySelector("h2").textContent, "Remove executor-shop?");
  assert.match(dialog.querySelector("p").textContent, /tasks stay in the project/);
  assert.equal(dialog.style.width, "480px");
  assert.equal(dialog.style.borderRadius, "22px");
  assert.equal(dialog.querySelectorAll("button")[1].style.background, "var(--error)");
  click(dialog.querySelector("button"));
  assert.equal(writes.length, 0);
  assert.equal((await request(api, "GET", "/units")).data.items.some((unit) => unit.id === id), true);
  choose();
  clickAction(desktop.root, "remove-unit");
  dialog = desktop.document.querySelector("[data-remove-unit]");
  fixture.control.setFault({ method: "DELETE", path: `/api/v1/units/${id}`, dropAfterCommit: true });
  click(dialog.querySelector("button.primary"));
  await waitFor(() => dialog.querySelector("[data-dialog-error]"), "The unconfirmed removal did not retain its dialog.");
  click(dialog.querySelector("button.primary"));
  await waitFor(() => desktop.document.querySelector("[data-remove-unit]") == null && desktop.root.querySelector("[data-action='map-undo']"), "The replayed removal did not offer Undo.");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].key, writes[1].key);
  assert.equal(writes[0].body, writes[1].body);
  assert.equal(desktop.app.unitList.catalog.some((unit) => unit.id === id), false);
  assert.match(desktop.root.querySelector("[data-map-toast]").textContent, /Archived/);
  assert.deepEqual(desktop.app.store.indexes.groups.get(group.id).members, ["project:shop:executor-shop"]);
  assert.equal((await request(api, "GET", "/units", { query: { archived: "true" } })).data.items[0].id, id);
  const undoKey = desktop.app.mapToast.key;
  clickAction(desktop.root, "map-undo");
  await waitFor(() => ["success", "error"].includes(desktop.app.activity.get(undoKey)?.phase), "Undo did not finish.");
  assert.equal(desktop.app.activity.get(undoKey)?.phase, "success", `${desktop.app.activity.get(undoKey)?.error?.message} ${desktop.app.activity.get(undoKey)?.error?.details?.path}`);
  await waitFor(() => desktop.app.unitList.catalog.some((unit) => unit.id === id), "Undo did not restore the unit.");
  await waitFor(() => desktop.app.store.indexes.groups.get(group.id)?.members.includes(id), "Undo did not restore group membership.");
  assert.equal((await request(api, "GET", "/units/:unitId", { params: { unitId: id } })).data.sessionIds.length, 0);
  desktop.app.language = "es";
  choose();
  clickAction(desktop.root, "remove-unit");
  dialog = desktop.document.querySelector("[data-remove-unit]");
  assert.equal(dialog.querySelector("h2").textContent, "Quitar executor-shop?");
  assert.match(dialog.querySelector("p").textContent, /El chat y el buzón pasan a Archivados/);
  assertVisibleCopy("es", [["Removal dialog", dialog.textContent]]);
  click(dialog.querySelector("button"));
});

test("a unit remains visible while stop acknowledgment is pending and Undo does not restart its session", async (t) => {
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const fixture = await createGuiFixture({ stopNative: () => { entered(); return new Promise((resolve) => { release = resolve; }); } });
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  const id = "project:shop:executor-shop";
  const unit = desktop.app.unitList.catalog.find((unit) => unit.id === id);
  desktop.app.mapState.selection = new Set([id]);
  desktop.app.mapState.onSelection([id]);
  clickAction(desktop.root, "remove-unit");
  const dialog = desktop.document.querySelector("[data-remove-unit]");
  click(dialog.querySelector("button.primary"));
  await waitFor(() => dialog.querySelector("button.primary").getAttribute("aria-busy") === "true", "Removal did not wait for native shutdown.");
  assert.equal(desktop.app.unitList.catalog.some((unit) => unit.id === id), true);
  const api = apiFrom(fixture.desktopUrl);
  await waiting;
  assert.equal((await request(api, "GET", "/units/:unitId", { params: { unitId: id } })).data.removed, false);
  release({ acknowledged: true });
  await waitFor(() => desktop.root.querySelector("[data-action='map-undo']"), "Acknowledged removal did not commit.");
  assert.equal(desktop.app.unitList.catalog.some((unit) => unit.id === id), false);
  clickAction(desktop.root, "map-undo");
  await waitFor(() => desktop.app.unitList.catalog.some((unit) => unit.id === id), "Undo did not restore the stopped unit.");
  assert.equal((await request(api, "GET", "/units/:unitId", { params: { unitId: id } })).data.sessionIds.length, 0);
});

test('the Executor form defaults to one task, rejects an empty task, and cancels a kept-open chat start', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method === 'POST' && init.body) writes.push({ url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length, 'The units did not load.');
  const operation = createOperation({ method: 'POST', path: '/units', body: { unit: 'executor-session', role: 'executor', scope: { kind: 'project', name: 'shop' }, machine: 'DESKTOP', leadId: null, job: null, model: null } });
  const unit = (await request(desktop.app.api, 'POST', '/units', { operation })).data;
  await waitFor(() => desktop.app.unitList?.catalog?.some((item) => item.id === unit.id), 'The new unit did not load.');
  desktop.app.activeHandlers.onActivate({ id: unit.id, kind: 'unit', unit }, 'double');
  await waitFor(() => desktop.app.inspectorData?.unitId === unit.id, 'The unit inspector did not load.');
  click(desktop.root.querySelector('[data-action="start-session"]'));
  await waitFor(() => desktop.document.querySelector('[data-form="session"]'), 'The session form did not open.');
  const form = desktop.document.querySelector('[data-form="session"]');
  const modes = form.querySelectorAll('[name="runMode"]');
  assert.equal(modes.find((item) => item.checked).value, 'task');
  click(form.querySelector('[data-action="confirm-form"]'));
  assert.equal(form.querySelector('[data-field-error="prompt"]').textContent, text('en', 'taskRequired'));
  assert.equal(writes.some((item) => item.url.endsWith('/session')), false);
  for (const mode of modes) mode.checked = mode.value === 'chat';
  click(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => desktop.app.sessionRequestId && desktop.root.querySelector('[data-action="cancel-start"]'), 'The start did not stay tracked.');
  const started = writes.find((item) => item.url.endsWith('/session'));
  assert.equal(started.body.runMode, 'chat');
  assert.equal(started.body.taskId, null);
  assert.equal(started.body.prompt, null);
  const requestId = desktop.app.sessionRequestId;
  click(desktop.root.querySelector('[data-action="cancel-start"]'));
  await waitFor(() => desktop.app.sessionRequest?.state === 'canceled', 'The canceled start was not acknowledged.');
  assert.equal(desktop.app.sessionRequestId, requestId);
  assert.equal(writes.filter((item) => item.url.endsWith('/session')).length, 1);
});

test('a working chat offers the confirmed Stop boundary and preserves the thread', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length, 'The units did not load.');
  const unit = desktop.app.unitList.catalog.find((item) => item.id === 'project:shop:executor-shop');
  desktop.app.activeHandlers.onActivate({ id: unit.id, kind: 'unit', unit }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-action="stop-work"]'), 'The working chat had no Stop.');
  const chatId = desktop.app.thread.chat.id;
  click(desktop.root.querySelector('[data-action="stop-work"]'));
  const dialog = desktop.document.querySelector('dialog');
  assert.equal(dialog != null, true);
  assert.equal(desktop.app.thread.chat.id, chatId);
  dialog.close();
  assert.equal(desktop.app.thread.chat.id, chatId);
});

test('two optimistic sends leave the composer free and preserve text typed while either settles', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const calls = [];
  const gates = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method !== 'POST' || !new URL(input).pathname.endsWith('/messages') || !String(input).includes('/chats/')) return;
    calls.push({ body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] });
    await new Promise((resolve) => gates.push(resolve));
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, 'The chats did not load.');
  navigate(desktop.app, 'chats');
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: 'chat' }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-composer]'), 'The composer did not open.');
  for (const body of ['First draft', 'Second draft']) {
    typeInput(desktop.root.querySelector('[data-composer]'), body, 0, body.length);
    click(desktop.root.querySelector('[data-action="send"]'));
    assert.equal(desktop.root.querySelector('[data-composer]').value, '');
    assert.equal(Boolean(desktop.root.querySelector('[data-action="send"]').disabled), false);
  }
  await waitFor(() => calls.length === 2, 'The independent sends did not start.');
  assert.notEqual(calls[0].key, calls[1].key);
  assert.equal(desktop.root.querySelectorAll('[data-send-state="sending"]').length, 2);
  assert.equal(desktop.app.thread.pendingSends.size, 2);
  typeInput(desktop.root.querySelector('[data-composer]'), 'Third draft', 2, 5);
  gates[1]();
  await waitFor(() => desktop.app.thread.pendingSends.size === 1, 'The second send did not settle.');
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Third draft');
  gates[0]();
  await waitFor(() => desktop.app.thread.pendingSends.size === 0, 'The first send did not settle.');
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Third draft');
  assert.equal(desktop.root.querySelector('[data-composer]').selectionStart, 2);
  const own = desktop.app.thread.messages.filter((message) => calls.some((call) => call.key === message.operationId));
  assert.equal(own.length, 2);
  assert.equal(new Set(own.map((message) => message.id)).size, 2);
  const message = own[0];
  const members = chat.members.filter((id) => id !== 'root:master');
  assert.equal(message.delivery.state, 'stored');
  assert.ok(desktop.root.querySelector('[data-send-state="storedReceipt"]'));
  for (const unitId of members) await fixture.control.acknowledgeChat(chat.id, message.id, unitId);
  await waitFor(() => message.delivery.state === 'delivered', 'The recipient submissions did not update delivery.');
  assert.ok(desktop.root.querySelector('[data-send-state="deliveredReceipt"]').textContent.includes('Delivered'));
  for (const unitId of members) await fixture.control.acknowledgeChat(chat.id, message.id, unitId, { read: true });
  await waitFor(() => message.delivery.state === 'read', 'The recipient reads did not update delivery.');
  desktop.app.language = 'es';
  renderShell(desktop.app);
  assert.ok(desktop.root.querySelector('[data-send-state="readReceipt"]').textContent.includes('Leído'));
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Third draft');
});

test('an unconfirmed row retries its own payload once while preserving the next composer draft', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const calls = [];
  let release;
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method !== 'POST' || !new URL(input).pathname.endsWith('/messages') || !String(input).includes('/chats/')) return;
    calls.push({ body: init.body, key: init.headers['Idempotency-Key'] });
    if (calls.length > 1) await new Promise((resolve) => { release = resolve; });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, 'The chats did not load.');
  navigate(desktop.app, 'chats');
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: 'chat' }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-composer]'), 'The composer did not open.');
  fixture.control.setFault({ method: 'POST', path: `/api/v1/chats/${chat.id}/messages`, status: 503, code: 'timeout' });
  typeInput(desktop.root.querySelector('[data-composer]'), 'Original message', 0, 16);
  click(desktop.root.querySelector('[data-action="send"]'));
  await waitFor(() => desktop.root.querySelector('[data-send-state="notConfirmed"]'), 'The unconfirmed line did not appear.');
  assert.equal(desktop.root.querySelector('[data-send-state="notConfirmed"]').textContent, 'Not confirmed: the service did not answer in 10 s.');
  typeInput(desktop.root.querySelector('[data-composer]'), 'Next draft', 0, 10);
  const retry = desktop.root.querySelector('[data-action="retry-message"]');
  assert.equal(retry.getAttribute('title'), 'Retry sends the same message once; it is never sent twice');
  click(retry);
  click(retry);
  await waitFor(() => calls.length === 2, 'Retry did not start.');
  assert.deepEqual(calls[1], calls[0]);
  release();
  await waitFor(() => desktop.app.thread.pendingSends.size === 0, 'The retry did not settle.');
  assert.equal(calls.length, 2);
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Next draft');
  assert.equal(desktop.app.thread.messages.filter((message) => message.operationId === calls[0].key).length, 1);
});

test('reconnection resumes an uncertain send under its original identity and retains the next draft', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const calls = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method !== 'POST' || !new URL(input).pathname.endsWith('/messages') || !String(input).includes('/chats/')) return;
    calls.push({ body: init.body, key: init.headers['Idempotency-Key'] });
    if (calls.length === 1) throw new Error('Connection lost');
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, 'The chats did not load.');
  navigate(desktop.app, 'chats');
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: 'chat' }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-composer]'), 'The composer did not open.');
  typeInput(desktop.root.querySelector('[data-composer]'), 'Resume once', 0, 11);
  click(desktop.root.querySelector('[data-action="send"]'));
  await waitFor(() => desktop.app.api.uncertain.has(calls[0]?.key), 'The uncertain send was not retained.');
  typeInput(desktop.root.querySelector('[data-composer]'), 'Unsent draft', 0, 12);
  await fixture.control.emit('stream.ready', { capabilities: desktop.app.store.capabilities, readAt: '2026-10-13T00:00:00.000Z' });
  await waitFor(() => desktop.app.thread.pendingSends.size === 0, 'Reconnection did not reconcile the send.');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Unsent draft');
  assert.equal(desktop.app.thread.chat.id, chat.id);
  assert.equal(desktop.app.api.uncertain.has(calls[0].key), false);
  assert.equal(desktop.app.thread.messages.filter((message) => message.operationId === calls[0].key).length, 1);
});

for (const end of ['Cancel', 'timeout']) test(`ordinary waiting reports elapsed time and ${end} preserves a committed operation and drafts`, async (t) => {
  t.after(() => t.mock.timers.reset());
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, 'The chats did not load.');
  navigate(desktop.app, 'chats');
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: 'chat' }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-composer]'), 'The composer did not open.');
  typeInput(desktop.root.querySelector('[data-composer]'), 'Unsent text', 0, 11);
  navigate(desktop.app, 'settings');
  await waitFor(() => desktop.root.querySelector('[data-look="high-contrast"]'), 'Settings did not open.');
  const fetchRequest = desktop.app.api.fetch;
  const commits = new Map();
  const requests = [];
  let finish;
  let now = 1000;
  desktop.app.api.now = () => now;
  desktop.app.api.fetch = async (input, init) => {
    if (init.method !== 'PATCH' || !new URL(input).pathname.endsWith('/settings')) return fetchRequest(input, init);
    const key = init.headers['Idempotency-Key'];
    requests.push(key);
    const data = commits.get(key) ?? { settings: { ...desktop.app.store.settings.settings, look: 'high-contrast' }, revision: 'b'.repeat(64) };
    commits.set(key, data);
    const payload = JSON.stringify({ contract: 'hivem1nd-gui-v3', data, meta: { requestId: key, readAt: '2026-10-13T00:00:00.000Z', eventCursor: 'fixture:1', sync: 'local' } });
    if (requests.length > 1) return new Response(payload, { status: 200 });
    return new Response(new ReadableStream({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); }; } }), { status: 200 });
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  click(desktop.root.querySelector('[data-look="high-contrast"]'));
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  assert.match(desktop.root.querySelector('[data-activity="settings"]').querySelector('strong').textContent, /Taking longer than usual/);
  now += 12000;
  t.mock.timers.tick(12000);
  assert.match(desktop.root.querySelector('[data-activity="settings"]').querySelector('p').textContent, /12 s/);
  assert.ok(desktop.root.querySelector('[data-action="cancel-activity"]'));
  if (end === 'Cancel') click(desktop.root.querySelector('[data-action="cancel-activity"]'));
  else {
    now += 18000;
    t.mock.timers.tick(18000);
  }
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
  assert.equal(desktop.app.activity.get('settings').phase, 'error');
  assert.equal(desktop.root.querySelector('[data-action="cancel-activity"]'), null);
  assert.ok(desktop.root.querySelector('[data-action="retry-activity"]'));
  assert.equal(commits.size, 1);
  assert.equal(desktop.app.inputDrafts.chats.get(chat.id).value, 'Unsent text');
  if (end === 'Cancel') {
    click(desktop.root.querySelector('[data-action="retry-activity"]'));
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    assert.equal(requests.length, 1);
    finish();
  } else click(desktop.root.querySelector('[data-action="retry-activity"]'));
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
  assert.equal(desktop.app.activity.get('settings').phase, 'success');
  assert.equal(commits.size, 1);
  if (end === 'timeout') {
    assert.equal(requests.length, 2);
    assert.equal(requests[0], requests[1]);
  }
  t.mock.timers.reset();
});

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

async function libraryDesktop(t, kind = "blueprint", options = {}) {
  const fixture = await createGuiFixture(options); t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []); t.after(() => dispose(desktop.app));
  navigate(desktop.app, kind === "blueprint" ? "blueprint" : "document");
  await waitFor(() => desktop.app.editors?.loadedKind === kind && !desktop.app.editors.catalogLoading, "The shared library did not load.");
  return { ...desktop, fixture, state: libraryState(desktop.app.editors, kind) };
}

function changeSelect(node, value) {
  node.value = value;
  for (const handler of node.listeners.get("change") ?? []) handler({ target: node, currentTarget: node });
}

function toggleCommentPreference(root, value) {
  const input = root.querySelector("[data-send-to-agent]");
  assert.ok(input); assert.equal(input.disabled, false);
  input.checked = value;
  for (const handler of input.listeners.get("change") ?? []) handler({ target: input });
}

async function openCommentEditor(desktop, kind) {
  navigate(desktop.app, kind === "blueprint" ? "blueprint" : "document");
  await waitFor(() => desktop.app.editors?.loadedKind === kind && !desktop.app.editors.catalogLoading, "The editor library did not load.");
  const item = desktop.app.editors.catalog.find((entry) => entry.title === (kind === "blueprint" ? "Cart" : "Release notes"));
  renderShell(desktop.app); click(desktop.root.querySelector(`[data-id="${item.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === item.id && desktop.root.querySelector("[data-send-to-agent]"), "The comment composer did not open.");
  return desktop.app.editors.current;
}

test("Blueprint and Void share the default checkbox, persisted false, machine changes and reopen without overwriting an unattached preference", async (t) => {
  const desktop = await openedBoardDesktop(t), { app, root, fixture } = desktop;
  assert.equal(root.querySelector("[data-send-to-agent]").checked, true);
  click(root.querySelector("button[data-board-tool='comment']"));
  const host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  assert.equal(root.querySelectorAll("[data-send-to-agent]").length, 2);
  toggleCommentPreference(root, false);
  await waitFor(() => app.activity.get("settings")?.phase === "success", "The preference did not save.");
  assert.ok(root.querySelectorAll("[data-send-to-agent]").every((input) => input.checked === false));
  assert.ok(root.querySelectorAll(".comment-preference-hint").every((hint) => hint.textContent === "Kept as a note, not sent"));
  const current = await openCommentEditor(desktop, "void");
  assert.equal(root.querySelector("[data-send-to-agent]").checked, false);
  assert.equal(root.querySelector("[data-comment]").getAttribute("aria-label"), "Reply on the text");
  await setAttachments(app.api, app.editors, []); renderShell(app);
  assert.equal(root.querySelector("[data-send-to-agent]").checked, false);
  assert.equal(root.querySelector("[data-send-to-agent]").disabled, true);
  assert.equal(root.querySelector(".comment-preference-hint").textContent, "No agents attached");
  assert.equal((await request(app.api, "GET", "/settings")).data.settings.sendToAgent, false);
  const reopened = await bootApp(fixture.desktopUrl, 1440, []); t.after(() => dispose(reopened.app));
  await openCommentEditor(reopened, "blueprint");
  assert.equal(reopened.root.querySelector("[data-send-to-agent]").checked, false);
  const settings = (await request(app.api, "GET", "/settings")).data;
  await saveSettings(app.api, settings.revision, { sendToAgent: true });
  await waitFor(() => app.editors.sendToAgent && reopened.root.querySelector("[data-send-to-agent]")?.checked, "The shared setting did not synchronize to both viewers.");
  assert.equal(root.querySelector("[data-send-to-agent]").checked, false);
  assert.equal((await request(app.api, "GET", "/settings")).data.settings.sendToAgent, true);
  await setAttachments(app.api, app.editors, ["project:shop:executor-shop"]); renderShell(app);
  assert.equal(root.querySelector("[data-send-to-agent]").checked, true);
  assert.equal(current.kind, "void");
  app.language = "es"; renderShell(app);
  assert.equal(root.querySelector("[data-send-to-agent]").getAttribute("aria-label"), "Enviar al agente");
  const phone = await bootApp(fixture.phoneUrl, 390, []); t.after(() => dispose(phone.app));
  assert.equal(phone.root.querySelector("[data-send-to-agent]"), null);
  const css = await readFile("gui/app/styles.css", "utf8");
  assert.match(css, /\.comment-composer[^}]*padding: 12px 14px 16px;[^}]*gap: 7px/);
  assert.match(css, /\.comment-checkbox-hit[^}]*width: 32px; height: 32px/);
  assert.match(css, /\.comment-checkbox \{[^}]*width: 16px; height: 16px;[^}]*border-radius: 4px/);
});

test("false remains shared after the fixture service restarts and both composers reopen", async (t) => {
  const desktop = await openedBoardDesktop(t), { app, root, fixture } = desktop;
  toggleCommentPreference(root, false);
  await waitFor(() => app.activity.get("settings")?.phase === "success", "The preference did not save before restart.");
  dispose(app); await fixture.control.restart();
  const restarted = await bootApp(fixture.desktopUrl, 1440, []); t.after(() => dispose(restarted.app));
  for (const kind of ["blueprint", "void"]) {
    await openCommentEditor(restarted, kind);
    assert.equal(restarted.root.querySelector("[data-send-to-agent]").checked, false);
    assert.equal(restarted.app.editors.sendToAgent, false);
  }
  assert.equal((await request(restarted.app.api, "GET", "/settings")).data.settings.sendToAgent, false);
});

test("a settings conflict retains the visible checkbox and Retry saves that choice while a lost response reuses its receipt", async (t) => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl), writes = []; let conflict = true;
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (url, init) => {
    if (init?.method !== "PATCH" || !String(url).endsWith("/settings")) return;
    writes.push({ key: headerValue(init.headers, "Idempotency-Key"), body: JSON.parse(init.body) });
    if (conflict) {
      conflict = false;
      const current = (await request(api, "GET", "/settings")).data;
      await saveSettings(api, current.revision, { look: "high-contrast" });
    }
  });
  t.after(() => dispose(desktop.app)); await openCommentEditor(desktop, "blueprint");
  toggleCommentPreference(desktop.root, false);
  await waitFor(() => desktop.app.activity.get("settings")?.error?.code === "revision_conflict", "The setting conflict was not shown.");
  assert.equal(desktop.root.querySelector("[data-send-to-agent]").checked, false);
  assert.equal((await request(api, "GET", "/settings")).data.settings.sendToAgent, true);
  await openCommentEditor(desktop, "void");
  assert.equal(desktop.root.querySelector("[data-send-to-agent]").checked, false);
  await desktop.app.activity.get("settings").retry();
  assert.equal((await request(api, "GET", "/settings")).data.settings.sendToAgent, false);
  assert.equal(writes[0].body.sendToAgent, false); assert.equal(writes[1].body.sendToAgent, false);
  assert.notEqual(writes[0].key, writes[1].key);
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", dropAfterCommit: true });
  toggleCommentPreference(desktop.root, true);
  await waitFor(() => desktop.app.activity.get("settings")?.phase === "error", "The lost setting response did not offer Retry.");
  assert.equal(desktop.root.querySelector("[data-send-to-agent]").checked, true);
  await desktop.app.activity.get("settings").retry();
  assert.deepEqual(writes[3], writes[2]);
  assert.equal((await request(api, "GET", "/settings")).data.settings.sendToAgent, true);
});

test("a pending note retries its captured choice and original board after navigation and a later toggle", async (t) => {
  const writes = [], desktop = await openedBoardDesktop(t, (url, init) => {
    if (init?.method === "POST" && String(url).includes("/comments")) writes.push({ url: String(url), key: headerValue(init.headers, "Idempotency-Key"), body: JSON.parse(init.body) });
  });
  const { app, root, fixture } = desktop, current = app.editors.current;
  toggleCommentPreference(root, false);
  await waitFor(() => app.activity.get("settings")?.phase === "success", "The note preference did not save.");
  const host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  typeInput(root.querySelector("[data-comment]"), "Keep the original note", 0, 0);
  fixture.control.setFault({ method: "POST", path: `/api/v1/editors/${current.resourceId}/comments`, dropAfterCommit: true });
  click(root.querySelector("[data-action='comment']"));
  const key = `comment:${current.resourceId}`;
  await waitFor(() => app.activity.get(key)?.phase === "error", "The lost comment did not offer Retry.");
  const captured = app.activity.get(key).commentChoice;
  assert.equal(captured.sendToAgent, false);
  assert.deepEqual(captured.attached, current.attached);
  await openCommentEditor(desktop, "void");
  toggleCommentPreference(root, true);
  await waitFor(() => app.activity.get("settings")?.phase === "success", "The later preference did not save.");
  await app.activity.get(key).retry();
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(writes[1].body.sendToAgent, false);
  assert.equal(app.editors.current.kind, "void");
  await openCommentEditor(desktop, "blueprint");
  const note = app.editors.current.threads.filter((thread) => thread.messages?.some((message) => message.text === "Keep the original note"));
  assert.equal(note.length, 1); assert.equal(note[0].anchor.element, "label");
  assert.equal(note[0].messages[0].sendToAgent, false);
  assert.equal(root.querySelector("[data-comment-note]").textContent, "Kept as a note, not sent");
  assert.equal(root.querySelector("[data-send-to-agent]").checked, true);
});

async function openedBoardDesktop(t, onFetch) {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], onFetch); t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell") && desktop.app.layout === "desktop", "The desktop shell did not open.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board library did not load.");
  const board = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app); click(desktop.root.querySelector(`[data-id="${board.id}"]`));
  await waitFor(() => desktop.root.querySelector(".board-svg"), "The board did not open.");
  return { ...desktop, fixture, board };
}

function boardEvent(host, type, target, x, y, more = {}) {
  for (const handler of host.listeners.get(type) ?? []) handler({ target, pointerId: 1, button: 0, offsetX: x, offsetY: y, clientX: x, clientY: y, preventDefault() {}, ...more });
}

test("board drag and resize use parent coordinates at zoom, cancel without writes, and move by keyboard", async (t) => {
  const writes = [];
  const desktop = await openedBoardDesktop(t, (url, init) => { if (init?.method === "PUT" && String(url).includes("/blueprint/boards/")) writes.push(JSON.parse(init.body)); });
  const { app, root } = desktop, editor = app.editors.current;
  const board = structuredClone(editor.authoritative.document);
  board.screens[0].x = 100; board.screens[0].y = 200;
  board.screens[0].root.kids.push({ id: "nested", name: "Nested", t: "box", dir: "stack", place: { x: 30, y: 40 }, w: 180, h: 120, kids: [
    { id: "nested-text", name: "Text", t: "text", value: "Editable", size: 24, color: "#f5f1f6", place: { x: 10, y: 12, future: "kept" }, w: 80, h: 30, future: "node kept" },
  ] });
  const { replaceBoard, indexNodes } = await import("../gui/app/blueprint.mjs");
  await replaceBoard(app.api, editor, board); renderShell(app); writes.length = 0;
  const zoom = (host) => {
    const svg = host.querySelector(".board-svg");
    svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform(matrix) { return matrix.convert(this); } });
    svg.getScreenCTM = () => ({ convert: (point) => ({ x: point.x * 2, y: point.y * 2 }), inverse: () => ({ convert: (point) => ({ x: point.x / 2, y: point.y / 2 }) }) });
  };
  let host = root.querySelector(".board-host"); zoom(host);
  boardEvent(host, "pointerdown", host.querySelector("[data-node='nested-text']"), 300, 510);
  boardEvent(host, "pointermove", host, 320, 520);
  boardEvent(host, "pointercancel", host, 320, 520);
  assert.equal(editor.boardDraft, null); assert.equal(writes.length, 0);
  host = root.querySelector(".board-host");
  zoom(host); boardEvent(host, "pointerdown", host.querySelector("[data-node='nested-text']"), 300, 510);
  boardEvent(host, "pointermove", host, 320, 520); boardEvent(host, "pointerup", host, 320, 520);
  await waitFor(() => !editor.boardDraft && writes.length === 1, "The nested drag did not save.");
  let node = indexNodes(editor.authoritative.document).get("nested-text").node;
  assert.deepEqual(node.place, { x: 20, y: 17, future: "kept" }); assert.equal(node.future, "node kept");
  host = root.querySelector(".board-host"); zoom(host);
  const handle = host.querySelector("[data-resize='nw']"); assert.ok(handle);
  boardEvent(host, "pointerdown", handle, 300, 514); boardEvent(host, "pointermove", host, 320, 524); boardEvent(host, "pointerup", host, 320, 524);
  await waitFor(() => !editor.boardDraft && writes.length === 2, "The resize did not save.");
  node = indexNodes(editor.authoritative.document).get("nested-text").node;
  assert.deepEqual(node.place, { x: 30, y: 22, future: "kept" }); assert.equal(node.w, 70); assert.equal(node.h, 25);
  host = root.querySelector(".board-host"); boardEvent(host, "keydown", host.querySelector("[data-node='nested-text']"), 0, 0, { key: "ArrowRight", shiftKey: true });
  await waitFor(() => !editor.boardDraft && writes.length === 3, "Keyboard movement did not save.");
  assert.equal(indexNodes(editor.authoritative.document).get("nested-text").node.place.x, 40);
  assert.equal(editor.authoritative.document.sentinel, board.sentinel);
});

test("Draw stores pen and marker strokes, cancels previews and erases through node removals", async (t) => {
  const deletes = [];
  const desktop = await openedBoardDesktop(t, (url, init) => { if (init?.method === "DELETE" && String(url).includes("/nodes/")) deletes.push(String(url)); });
  const { app, root } = desktop, editor = app.editors.current;
  click(root.querySelector("button[data-board-tool='draw']"));
  await waitFor(() => !editor.boardDraft && editor.authoritative.document.screens.some((screen) => screen.root.sketch), "The hand frame did not save.");
  const frame = editor.authoritative.document.screens.find((screen) => screen.root.sketch);
  assert.deepEqual([frame.x, frame.y, frame.w, frame.h, frame.root.radius, frame.root.dash], [350, 120, 300, 560, 18, "6 5"]);
  const stroke = async (tool, end) => {
    click(root.querySelector(`[data-draw-tool='${tool}']`));
    const host = root.querySelector(".board-host");
    boardEvent(host, "pointerdown", host.querySelector(`[data-screen='${frame.id}']`), 370, 150);
    boardEvent(host, "pointermove", host, ...end); boardEvent(host, "pointerup", host, ...end);
    await waitFor(() => !editor.boardDraft && app.activity.get(`board:${editor.resourceId}`)?.phase !== "pending", "The stroke did not save.");
  };
  await stroke("pen", [430, 230]); await stroke("marker", [400, 190]);
  let strokes = editor.authoritative.document.screens.find((screen) => screen.id === frame.id).root.kids;
  assert.equal(strokes.length, 2); assert.equal(strokes[0].strokeWidth, 2.2); assert.equal(strokes[1].opacity, 0.4);
  let host = root.querySelector(".board-host");
  boardEvent(host, "pointerdown", host.querySelector(`[data-screen='${frame.id}']`), 380, 180); boardEvent(host, "pointermove", host, 460, 250);
  boardEvent(host, "keydown", host, 0, 0, { key: "Escape" });
  assert.equal(editor.boardDraft, null);
  await stroke("eraser", [410, 205]);
  await waitFor(() => app.activity.get(`erase:${editor.resourceId}`)?.phase === "success", "The eraser did not finish.");
  strokes = editor.authoritative.document.screens.find((screen) => screen.id === frame.id).root.kids;
  assert.equal(strokes.length, 0); assert.equal(deletes.length, 2);
  const read = (await request(app.api, "GET", "/blueprint/boards/:resourceId", { params: { resourceId: editor.resourceId } })).data.document;
  assert.equal(read.screens.find((screen) => screen.id === frame.id).root.kids.length, 0);
  const { addNode } = await import("../gui/app/blueprint.mjs");
  await addNode(app.api, editor, { screenId: "empty", parentId: editor.authoritative.document.screens[0].root.id,
    node: { id: "lite-stroke", name: "Retained Lite stroke", t: "vector", kind: "pen", place: { x: 40, y: 100 }, w: 80, h: 80,
      d: "M0 0 L100 100", fill: "none", stroke: "#f5f1f6", strokeWidth: 2.2, future: "Lite metadata" } });
  renderShell(app); host = root.querySelector(".board-host");
  boardEvent(host, "pointerdown", host.querySelector("[data-screen='empty']"), 80, 140);
  boardEvent(host, "pointerup", host, 80, 140);
  await waitFor(() => app.activity.get(`erase:${editor.resourceId}`)?.phase === "success" && deletes.length === 3, "The eraser ignored a retained Lite stroke outside the hand frame.");
  assert.equal(editor.authoritative.document.screens[0].root.kids.some((node) => node.id === "lite-stroke"), false);
});

test("the board attach picker searches groups and aliases and commits canonical unique members", async (t) => {
  const desktop = await openedBoardDesktop(t), { app, root, document } = desktop;
  await waitFor(() => app.unitList?.catalog?.length, "Units did not load.");
  const members = ["project:shop:executor-shop", "env:web:overlord-web"];
  const group = await createGroup(app.api, "Checkout launch", members);
  app.store.indexes.groups.set(group.data.id, group.data);
  app.editors.current.attachmentChoice = new Set();
  click(root.querySelector("[data-action='attach']"));
  const chooser = document.querySelector("[data-form='attach']");
  assert.equal(chooser.querySelector("[data-attach-search]").getAttribute("aria-label"), "Search units and groups");
  typeInput(chooser.querySelector("[data-attach-search]"), "Checkout", 0, 0);
  assert.equal(chooser.querySelectorAll("[data-attach-unit]").length, 0);
  click(chooser.querySelector("[data-attach-group]"));
  typeInput(chooser.querySelector("[data-attach-search]"), "executor-shop", 0, 0);
  click(chooser.querySelector("[data-attach-unit='project:shop:executor-shop']"));
  assert.equal(chooser.querySelector("[data-action='save-attachments']").textContent, "Attach 2");
  click(chooser.querySelector("[data-action='save-attachments']"));
  await waitFor(() => document.querySelector("[data-form='attach']") == null, "The picker did not save.");
  assert.deepEqual([...app.editors.current.attached].sort(), [...members].sort());
});

test("board text saves later typing, comments pin full anchors, and conflict controls retain both versions", async (t) => {
  let release, held = false; const hold = new Promise((resolve) => { release = resolve; }); t.after(() => release());
  const desktop = await openedBoardDesktop(t, async (url, init) => {
    if (init?.method === "PUT" && String(url).includes("/blueprint/boards/") && !held) { held = true; await hold; }
  });
  const { app, root } = desktop, editor = app.editors.current;
  let host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  typeInput(root.querySelector("[data-node-text='label']"), "First typing", 0, 0);
  await waitFor(() => held, "The first save did not start.");
  typeInput(root.querySelector("[data-node-text='label']"), "Later typing", 0, 0); release();
  await waitFor(() => !editor.boardDraft && editor.authoritative.document.screens[0].root.kids[0].value === "Later typing", "An older acknowledgment replaced later typing.");
  click(root.querySelector("button[data-board-tool='comment']")); host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  assert.equal(root.querySelector(".board-breadcrumb").textContent, "Empty cart / Root / Label");
  typeInput(root.querySelector("[data-board-comment]"), "Anchored note", 0, 0);
  click(root.querySelector(".board-comment-actions").querySelector(".primary"));
  await waitFor(() => editor.threads.some((thread) => !thread.pending && thread.messages?.some((message) => message.text === "Anchored note")), "The comment did not save.");
  const thread = editor.threads.find((thread) => thread.messages?.some((message) => message.text === "Anchored note"));
  assert.ok(root.querySelector(`[data-comment-pin='${thread.id}']`));
  assert.equal(thread.anchor.element, "label");
  const { setBoardDraft } = await import("../gui/app/blueprint.mjs");
  const local = structuredClone(editor.authoritative.document); local.title = "Local draft"; setBoardDraft(editor, local);
  const incoming = await request(app.api, "PUT", "/blueprint/boards/:resourceId", { operation: createOperation({ method: "PUT", path: "/blueprint/boards/:resourceId", params: { resourceId: editor.resourceId },
    body: { document: { ...editor.authoritative.document, title: "Incoming board" }, expectedRevision: editor.revision } }) });
  const remote = { ...incoming.data, by: "project:shop:executor-shop" };
  editor.conflict = { remote, revision: remote.revision }; renderShell(app);
  click(root.querySelector("[data-action='show-changes']"));
  assert.equal(root.querySelector("[data-board-changes]").querySelectorAll("pre").length, 2);
  click(root.querySelector("[data-action='discard-draft']"));
  await waitFor(() => editor.authoritative.document.title === "Incoming board" && !editor.historyPending, "Reload did not persist its conflict answer.");
  assert.equal(editor.authoritative.document.title, "Incoming board");
  assert.equal(editor.conflictCopies.at(-1).local.document.title, "Local draft");
  assert.equal(editor.conflictCopies.at(-1).remote.by, "project:shop:executor-shop");
});

test("a preceding save never commits a pointer preview that is later canceled", async (t) => {
  let release; const hold = new Promise((resolve) => { release = resolve; }); t.after(() => release());
  let count = 0;
  const { app, root } = await openedBoardDesktop(t, async (url, init) => {
    if (init?.method === "PUT" && String(url).includes("/blueprint/boards/")) { count++; if (count === 1) await hold; }
  });
  const editor = app.editors.current;
  let host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  typeInput(root.querySelector("[data-node-text='label']"), "Committed text", 0, 0);
  await waitFor(() => count === 1, "The preceding save did not start.");
  host = root.querySelector(".board-host");
  boardEvent(host, "pointerdown", host.querySelector("[data-node='label']"), 20, 24);
  boardEvent(host, "pointermove", host, 60, 64); release();
  await waitFor(() => app.activity.get(`board:${editor.resourceId}`)?.phase === "success", "The preceding save did not finish.");
  assert.equal(root.querySelector(".board-host"), host);
  boardEvent(host, "pointercancel", host, 60, 64);
  assert.equal(count, 1); assert.equal(editor.boardDraft, null);
  assert.equal(editor.authoritative.document.screens[0].root.kids[0].place.x, 12);
  assert.equal(editor.authoritative.document.screens[0].root.kids[0].value, "Committed text");
});

test("Frame and Text create normal nodes and Fill edits the selection in place", async (t) => {
  const { app, root } = await openedBoardDesktop(t), editor = app.editors.current;
  click(root.querySelector("button[data-board-tool='frame']"));
  let host = root.querySelector(".board-host");
  boardEvent(host, "pointerdown", host, 500, 120); boardEvent(host, "pointermove", host, 800, 680); boardEvent(host, "pointerup", host, 800, 680);
  await waitFor(() => !editor.boardDraft && editor.authoritative.document.screens.length === 2, "The new frame did not save.");
  const frame = editor.authoritative.document.screens.at(-1);
  assert.deepEqual([frame.x, frame.y, frame.w, frame.h], [500, 120, 300, 560]);
  click(root.querySelector("button[data-board-tool='text']")); host = root.querySelector(".board-host");
  boardEvent(host, "pointerdown", host, 520, 150);
  await waitFor(() => !editor.boardDraft && root.querySelector("[data-node-text]"), "The new text did not save.");
  let node = editor.authoritative.document.screens.at(-1).root.kids.at(-1);
  assert.deepEqual(node.place, { x: 20, y: 30 }); assert.equal(node.t, "text");
  const fill = root.querySelector("[data-node-fill]"); changeSelect(fill, "#bdcd79");
  await waitFor(() => !editor.boardDraft && editor.authoritative.document.screens.at(-1).root.kids.at(-1).color === "#bdcd79", "Fill did not save.");
  assert.equal(editor.authoritative.document.sentinel, "document-sentinel");
});

test("Keep mine rebases a rejected board write under a new operation and retains the remote version", async (t) => {
  let release, puts = 0; const hold = new Promise((resolve) => { release = resolve; }); t.after(() => release());
  const { app, root } = await openedBoardDesktop(t, async (url, init) => {
    if (init?.method === "PUT" && String(url).includes("/blueprint/boards/")) { puts++; if (puts === 1) await hold; }
  });
  const editor = app.editors.current, original = structuredClone(editor.authoritative.document);
  const host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  typeInput(root.querySelector("[data-node-text='label']"), "Keep local typing", 0, 0);
  await waitFor(() => puts === 1, "The local write did not start.");
  const remote = { ...original, title: "Committed remotely" };
  const operation = createOperation({ method: "PUT", path: `/blueprint/boards/${editor.resourceId}`, body: { document: remote, expectedRevision: editor.revision } });
  await request(app.api, operation.method, operation.path, { operation }); release();
  await waitFor(() => app.activity.get(`board:${editor.resourceId}`)?.phase === "error" && editor.conflict?.remote, "The stale write did not retain a conflict.");
  const failedId = app.activity.get(`board:${editor.resourceId}`).operation.id;
  click(root.querySelector("[data-action='reapply-draft']"));
  await waitFor(() => !editor.boardDraft && !editor.historyPending && !app.activity.has(`board:${editor.resourceId}`), "Keep mine did not commit its conflict answer.");
  assert.equal(puts, 2); assert.notEqual(app.activity.get(`board:${editor.resourceId}`)?.operation?.id, failedId);
  assert.equal(editor.authoritative.document.screens[0].root.kids[0].value, "Keep local typing");
  assert.deepEqual(editor.conflictCopies.at(-1).remote.document, remote);
});

function libraryMenu(desktop, entry, action) {
  click(desktop.root.querySelector(`[data-library-more="${entry.id}"]`));
  click(desktop.root.querySelector(`[data-action="library-${action}"]`));
}

for (const kind of ["blueprint", "void"]) test(`the ${kind} library shares header, filters, menus and inline rename without losing a draft`, async (t) => {
  const desktop = await libraryDesktop(t, kind);
  const { app, root, document, fixture, state } = desktop;
  const header = root.querySelector(".library-header");
  assert.deepEqual(header.children.slice(1).map((node) => node.getAttribute("data-action")), ["library-filters", "new-folder", "open-create"]);
  assert.equal(root.querySelector("[data-library]").getAttribute("data-library"), kind);
  const entry = app.editors.catalog.find((item) => !item.readOnly);
  click(root.querySelector(`[data-library-more="${entry.id}"]`));
  assert.deepEqual(root.querySelector('[data-library-menu="item"]').querySelectorAll("button").map((node) => node.querySelector("span").textContent), ["Rename", "Duplicate", "Move to folder", "Delete"]);
  click(root.querySelector('[data-action="library-filters"]'));
  const menu = root.querySelector('[data-library-menu="filters"]');
  for (const handler of menu.listeners.get("keydown") ?? []) handler({ key: "Escape", preventDefault() {} });
  click(root.querySelector(`[data-id="${entry.id}"]`));
  await waitFor(() => app.editors.current?.resourceId === entry.id && root.querySelector("[data-comment]"), "The selected editor did not open.");
  typeInput(root.querySelector("[data-comment]"), "Kept comment draft", 3, 8);
  const current = app.editors.current;
  libraryMenu(desktop, entry, "rename");
  let input = root.querySelector(`[data-library-rename="${entry.id}"]`);
  typeInput(input, "Renamed library item", 2, 8);
  await fixture.control.emit("service.changed", { machine: "DESKTOP" });
  await waitFor(() => root.querySelector(`[data-library-rename="${entry.id}"]`) !== input, "The rename did not survive a live render.");
  input = root.querySelector(`[data-library-rename="${entry.id}"]`);
  assert.equal(document.activeElement, input); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 8);
  assert.equal(input.value, "Renamed library item"); assert.equal(app.editors.current, current);
  for (const handler of input.listeners.get("keydown")) handler({ key: "Escape", preventDefault() {} });
  assert.equal(state.rename, null); assert.equal(document.activeElement.getAttribute("data-id"), entry.id);
  libraryMenu(desktop, entry, "rename");
  input = root.querySelector(`[data-library-rename="${entry.id}"]`);
  typeInput(input, "Renamed library item", 0, 20);
  fixture.control.setFault({ method: "PATCH", path: `/api/v1/editors/${entry.id}/library`, status: 503, code: "service_unavailable" });
  for (const handler of input.listeners.get("keydown")) handler({ key: "Enter", preventDefault() {} });
  await waitFor(() => state.rename?.error, "A failed inline rename did not keep its draft.");
  assert.equal(state.rename.title, "Renamed library item"); assert.equal(app.editors.current, current);
  click(root.querySelector('[data-action="save-library-name"]'));
  await waitFor(() => !state.rename && app.editors.catalog.some((item) => item.title === "Renamed library item"), "The rename retry did not commit.");
  assert.equal(app.editors.current.commentText, "Kept comment draft");
  assert.equal(app.editors.current, current);
  click(root.querySelector('[data-action="library-filters"]'));
  assert.equal(root.querySelector('[data-library-menu="filters"]').querySelectorAll("button").length, 3);
  click(root.querySelector('[data-action="library-open-comments"]'));
  await waitFor(() => root.querySelector('[data-filter-chip="openComments"]'), "The filter chip did not appear.");
  assert.equal(state.filters.openComments, true);
  click(root.querySelector('[data-action="remove-open-comments"]'));
  await waitFor(() => !root.querySelector('[data-filter-chip="openComments"]'), "The removed filter stayed active.");
  assert.equal(state.filters.openComments, undefined);
});

test("new board requires a project, Empty has one frame and duplication uses actual content", async (t) => {
  const desktop = await libraryDesktop(t);
  click(desktop.root.querySelector('[data-action="open-create"]'));
  let form = desktop.document.querySelector('[data-form="library-create"]');
  assert.equal(form.querySelector("h2").textContent, "New board");
  assert.equal(form.querySelectorAll('[name="creation"]').length, 3);
  typeInput(form.querySelector('[data-field="create-title"]'), "One frame", 0, 9);
  click(form.querySelector('[data-action="create-resource"]'));
  assert.equal(form.querySelector('[data-field-error="project"]').textContent, text("en", "projectRequired"));
  assert.equal(desktop.app.editors.current, null);
  changeSelect(form.querySelector('[name="project"]'), "shop");
  click(form.querySelector('[data-action="create-resource"]'));
  await waitFor(() => desktop.app.editors.current?.authoritative?.title === "One frame", "The empty board did not open.");
  assert.equal(desktop.app.editors.current.authoritative.document.screens.length, 1);
  assert.equal(desktop.app.editors.current.authoritative.document.pages.length, 1);
  const entry = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  const source = (await request(desktop.app.api, "GET", "/blueprint/boards/:resourceId", { params: { resourceId: entry.id } })).data;
  libraryMenu(desktop, entry, "duplicate");
  form = desktop.document.querySelector('[data-form="library-create"]');
  assert.equal(form.querySelector('[data-field="create-title"]').value, "Cart copy");
  click(form.querySelector('[data-action="create-resource"]'));
  await waitFor(() => desktop.app.editors.current?.authoritative?.title === "Cart copy", "The duplicate did not open.");
  assert.deepEqual(desktop.app.editors.current.authoritative.document.screens, source.document.screens);
  assert.deepEqual(desktop.app.editors.current.authoritative.document.pages, source.document.pages);
  assert.equal(desktop.app.editors.current.authoritative.document.sentinel, source.document.sentinel);
  assert.deepEqual(desktop.app.editors.current.attached, []);
  assert.deepEqual(desktop.app.editors.current.threads, []);
});

test("new folders open inline, nested contents keep counts and folder deletion names its scope", { timeout: 15000 }, async (t) => {
  const desktop = await libraryDesktop(t, "void");
  const { app, root, document, state } = desktop;
  click(root.querySelector('[data-action="new-folder"]'));
  const form = document.querySelector('[data-form="library-folder"]');
  changeSelect(form.querySelector('[name="project"]'), "shop");
  click(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => root.querySelector("[data-library-rename]") && !document.querySelector('[data-form="library-folder"]'), "The new folder did not enter inline rename.");
  let input = root.querySelector("[data-library-rename]");
  assert.equal(document.activeElement === input, true);
  typeInput(input, "Release", 0, 7);
  click(root.querySelector('[data-action="save-library-name"]'));
  await waitFor(() => !state.rename && state.folders.some((item) => item.title === "Release"), "The folder name did not commit.");
  const folder = state.folders.find((item) => item.title === "Release");
  assert.equal(root.querySelector(`[data-library-folder="${folder.id}"]`).querySelector(".library-count").textContent, "0");
  const entry = app.editors.catalog.find((item) => item.title === "Release notes");
  libraryMenu(desktop, entry, "move");
  await waitFor(() => document.querySelector('[data-form="library-move"]'), "The move chooser did not open.");
  const move = document.querySelector('[data-form="library-move"]');
  changeSelect(move.querySelector('[name="folderId"]'), folder.id);
  click(move.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => app.editors.catalog.find((item) => item.id === entry.id)?.folderId === folder.id, "The same-project move did not commit.");
  assert.equal(document.querySelector('[data-library-repository-confirm]'), null);
  assert.equal(root.querySelector(`[data-library-folder="${folder.id}"]`).querySelector(".library-count").textContent, "1");
  libraryMenu(desktop, state.folders.find((item) => item.id === folder.id), "delete");
  await waitFor(() => document.querySelector('[data-library-delete="folder"]'), "The folder delete confirmation did not open.");
  const dialog = document.querySelector('[data-library-delete="folder"]');
  assert.match(dialog.querySelector("p").textContent, /1 texts/);
  assert.match(dialog.querySelector("p").textContent, /subfolders/);
  assert.match(dialog.querySelector("p").textContent, /10 seconds/);
  dialog.close();
  assert.equal(app.editors.catalog.some((item) => item.id === entry.id), true);
  assert.equal(document.activeElement.getAttribute("data-action"), `folder-${folder.id}`);
});

test("text deletion retries one operation and restores the selected draft with ten-second Undo", async (t) => {
  const desktop = await libraryDesktop(t, "void");
  const { app, root, document, fixture } = desktop;
  const entry = app.editors.catalog.find((item) => item.title === "Release notes");
  click(root.querySelector(`[data-id="${entry.id}"]`));
  await waitFor(() => root.querySelector("[data-source]"), "The text did not open.");
  app.editors.current.voidSaver = documentSaver(app.api, app.editors.current, () => {}, 10000);
  typeInput(root.querySelector("[data-source]"), "Unsent source", 2, 5);
  const current = app.editors.current;
  libraryMenu(desktop, entry, "delete");
  await waitFor(() => document.querySelector('[data-library-delete="item"]'), "The delete confirmation did not open.");
  let dialog = document.querySelector('[data-library-delete="item"]');
  assert.match(dialog.querySelector("p").textContent, /text and its comments/);
  dialog.close(); assert.equal(app.editors.current, current);
  libraryMenu(desktop, entry, "delete");
  await waitFor(() => document.querySelector('[data-library-delete="item"]'), "The delete confirmation did not reopen.");
  dialog = document.querySelector('[data-library-delete="item"]');
  fixture.control.setFault({ method: "DELETE", path: `/api/v1/editors/${entry.id}`, status: 503, code: "service_unavailable" });
  click(dialog.querySelector("button.primary"));
  await waitFor(() => dialog.querySelector("[data-dialog-error]"), "The failed delete did not stay open.");
  assert.equal(app.editors.catalog.some((item) => item.id === entry.id), true);
  click(dialog.querySelector("button.primary"));
  await waitFor(() => root.querySelector('[data-action="library-undo"]'), "The committed delete did not offer Undo.");
  assert.equal(root.querySelector('[data-library-countdown]').textContent, "10 s");
  assert.equal(app.editors.current, null);
  click(root.querySelector('[data-action="library-undo"]'));
  await waitFor(() => app.editors.current === current && app.editors.catalog.some((item) => item.id === entry.id), "Undo did not restore the text and selected draft.");
  assert.equal(root.querySelector("[data-source]").value, "Unsent source");
  libraryMenu(desktop, app.editors.catalog.find((item) => item.id === entry.id), "delete");
  await waitFor(() => document.querySelector('[data-library-delete="item"]'), "The second confirmation did not open.");
  click(document.querySelector('[data-library-delete="item"]').querySelector("button.primary"));
  await waitFor(() => root.querySelector('[data-action="library-undo"]'), "The second Undo did not appear.");
  const end = app.libraryToast.until; app.api.now = () => end;
  renderShell(app);
  assert.equal(root.querySelector('[data-action="library-undo"]'), null);
});

test("cross-project GUI movement confirms both repositories and moves real-core bytes with Undo", async (t) => {
  const fixture = await makeCoreFixture(); t.after(() => disposeCoreFixture(fixture));
  const projects = [];
  for (const name of ["shop", "api"]) {
    const localPath = join(fixture.root, name); await mkdir(localPath);
    await mkdir(join(fixture.paths.mind, "user", "projects", name), { recursive: true });
    projects.push({ name, localPath });
  }
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, projects, now: () => fixture.clock.now });
  t.after(() => core.http.close());
  const origin = `http://127.0.0.1:${core.http.port}`;
  const login = await fetch(`${origin}/api/v1/auth/local`, { method: "POST", headers: { Origin: origin, Authorization: `Bearer ${core.bootstrap.secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ embedded: false, hostOrigin: null, look: null, language: null }) });
  assert.equal(login.status, 201);
  const token = (await login.json()).data.token;
  const api = apiFrom(`${origin}/#session=${token}`);
  await request(api, "POST", "/units", { operation: createOperation({ method: "POST", path: "/units", body: { unit: "overseer", role: "overseer", scope: "root", machine: fixture.machine } }) });
  const source = await createResource(api, "blueprint", { project: "shop", document: { formatVersion: 1, id: "physical", title: "Physical board", note: "", pages: [{ id: "main", title: "Main", objects: [], order: ["frame"], start: "frame" }], screens: [{ id: "frame", title: "Frame", pageId: "main", x: 0, y: 0, w: 100, h: 100, root: { id: "root", name: "Frame", t: "box", place: { x: 0, y: 0 }, dir: "stack", w: 100, h: 100, kids: [] } }], links: [], components: [], fonts: [], threads: [], sentinel: "actual-core" } });
  const before = await readFile(join(projects[0].localPath, source.data.path));
  const desktop = await bootApp(`${origin}/#session=${token}`, 1440, []); t.after(() => dispose(desktop.app));
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.id === source.data.id), "The actual core library did not load.");
  assert.deepEqual(libraryState(desktop.app.editors, "blueprint").projects.map((project) => project.id), ["api", "shop"]);
  const entry = desktop.app.editors.catalog.find((item) => item.id === source.data.id);
  click(desktop.root.querySelector(`[data-id="${entry.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === entry.id, "The real board did not open.");
  libraryMenu(desktop, entry, "move");
  await waitFor(() => desktop.document.querySelector('[data-form="library-move"]'), "The destination chooser did not open.");
  let form = desktop.document.querySelector('[data-form="library-move"]');
  changeSelect(form.querySelector('[name="project"]'), "api");
  click(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => desktop.document.querySelector('[data-library-repository-confirm]'), "The distinct repository confirmation did not open.");
  let dialog = desktop.document.querySelector('[data-library-repository-confirm]');
  assert.match(dialog.querySelector("p").textContent, /shop repository to the api repository/);
  assert.deepEqual(await readFile(join(projects[0].localPath, source.data.path)), before);
  dialog.close();
  assert.equal(desktop.app.editors.current.resourceId, source.data.id);
  libraryMenu(desktop, entry, "move");
  await waitFor(() => desktop.document.querySelector('[data-form="library-move"]'), "The move chooser did not reopen.");
  form = desktop.document.querySelector('[data-form="library-move"]');
  changeSelect(form.querySelector('[name="project"]'), "api"); click(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => desktop.document.querySelector('[data-library-repository-confirm]'), "The repository confirmation did not reopen.");
  dialog = desktop.document.querySelector('[data-library-repository-confirm]'); click(dialog.querySelector("button.primary"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.project === "api" && desktop.root.querySelector('[data-action="library-undo"]'), "The physical move did not commit.");
  await assert.rejects(readFile(join(projects[0].localPath, source.data.path)), (error) => error.code === "ENOENT");
  assert.deepEqual(await readFile(join(projects[1].localPath, source.data.path)), before);
  assert.notEqual(desktop.app.editors.current.resourceId, source.data.id);
  click(desktop.root.querySelector('[data-action="library-undo"]'));
  await waitFor(() => desktop.app.editors.current?.resourceId === source.data.id, "Undo did not restore the original resource identity.");
  assert.deepEqual(await readFile(join(projects[0].localPath, source.data.path)), before);
  await assert.rejects(readFile(join(projects[1].localPath, source.data.path)), (error) => error.code === "ENOENT");
  const sourceText = await createResource(api, "void", { project: "shop", path: "docs/physical-text.json", document: { formatVersion: 1, id: "physical-text", title: "Physical text", pages: [{ k: "Intro.Welcome", en: "Original text", es: "Texto original" }] } });
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors.catalog.some((item) => item.id === sourceText.data.id), "The real text did not appear in the library.");
  const textEntry = desktop.app.editors.catalog.find((item) => item.id === sourceText.data.id);
  click(desktop.root.querySelector(`[data-id="${textEntry.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]"), "The real text did not open.");
  desktop.app.editors.current.voidSaver = documentSaver(desktop.app.api, desktop.app.editors.current, () => {}, 10000);
  typeInput(desktop.root.querySelector("[data-source]"), "Unsaved text", 2, 6);
  libraryMenu(desktop, textEntry, "move");
  await waitFor(() => desktop.document.querySelector('[data-form="library-move"]'), "The text destination chooser did not open.");
  form = desktop.document.querySelector('[data-form="library-move"]');
  changeSelect(form.querySelector('[name="project"]'), "api"); click(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => desktop.document.querySelector('[data-library-repository-confirm]'), "The text repository confirmation did not open.");
  click(desktop.document.querySelector('[data-library-repository-confirm]').querySelector("button.primary"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.project === "api" && desktop.root.querySelector('[data-action="library-undo"]'), "The physical text move did not commit.");
  const movedTextId = desktop.app.editors.current.resourceId;
  assert.equal(desktop.root.querySelector("[data-source]").value, "Unsaved text");
  assert.equal(textDraft(desktop.app.editors.current, movedTextId, "Intro.Welcome", "en"), "Unsaved text");
  assert.equal(desktop.app.store.open.editors.has(textEntry.id), false);
  assert.equal(desktop.app.store.open.editors.has(movedTextId), true);
  click(desktop.root.querySelector('[data-action="library-undo"]'));
  await waitFor(() => desktop.app.editors.current?.resourceId === textEntry.id, "Undo did not restore the text's original identity.");
  assert.equal(textDraft(desktop.app.editors.current, textEntry.id, "Intro.Welcome", "en"), "Unsaved text");
  assert.equal(desktop.root.querySelector("[data-source]").value, "Unsaved text");
});
