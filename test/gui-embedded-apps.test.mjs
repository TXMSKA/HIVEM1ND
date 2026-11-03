import assert from "node:assert/strict";
import test from "node:test";
import { disposeEmbeddedApps, embeddedName, embeddedTokens, forwardEmbeddedEvent, openBrowserApp, startEmbeddedApps, syncEmbeddedApp } from "../gui/app/embedded-apps.mjs";
import { navigate } from "../gui/app/main.mjs";

function fixture() {
  const updates = [], forwarded = [], observers = [], listeners = new Map();
  let rect = { left: 12.2, top: 64.3, width: 1100.5, height: 700.5 };
  let covered = false, stageVisible = true, statusListener;
  const stage = { getBoundingClientRect: () => rect };
  const view = {
    getComputedStyle: () => ({ getPropertyValue: name => ({ "--bg": " #07040a ", "--panel": " #110a0e ", "--text": " #f3e6ea ", "--body": " #d9c4ca ", "--line2": " rgba(255, 45, 85, 0.22) " }[name] ?? "") }),
    addEventListener(name, listener) { listeners.set(name, listener); }, removeEventListener(name) { listeners.delete(name); },
    ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe(node) { this.node = node; } disconnect() { this.disconnected = true; } },
  };
  const document = { defaultView: view, documentElement: {}, hidden: false, querySelector: selector => covered && (covered === true || selector.includes(covered)) ? {} : null, addEventListener() {}, removeEventListener() {} };
  const app = { root: { ownerDocument: document, querySelector: () => stageVisible ? stage : null }, mode: "blueprint", layout: "desktop", language: "es", api: { token: "session" },
    store: { indexes: { groups: new Map() }, selected: {} }, embeddedHost: {
      embeddedUpdate: payload => updates.push(payload), embeddedEvent: event => forwarded.push(event),
      onEmbeddedStatus(listener) { statusListener = listener; return () => { statusListener = null; }; },
    } };
  return { app, updates, forwarded, observers, listeners, document, setRect: value => { rect = value; }, cover: value => { covered = value; }, stageVisible: value => { stageVisible = value; }, status: value => statusListener?.(value) };
}

test("browser and phone app entries open direct app tabs without changing ONEM1ND's mode", () => {
  for (const layout of ["desktop", "phone"]) {
    const opened = [];
    const app = { layout, mode: "map", root: { ownerDocument: { defaultView: { open(...args) { opened.push(args); } } } } };
    navigate(app, "blueprint"); navigate(app, "document");
    assert.deepEqual(opened, [["https://blueprint.txmska.com/files", "_blank", "noopener,noreferrer"], ["https://void.txmska.com/", "_blank", "noopener,noreferrer"]]);
    assert.equal(app.mode, "map");
    assert.equal(opened.some(([url]) => url.includes("host=") || url.includes("session=")), false);
  }
  const native = fixture();
  assert.equal(openBrowserApp(native.app, "blueprint"), false);
  assert.equal(embeddedName("document"), "void");
  assert.equal(embeddedName("settings"), null);
});

test("native bounds follow the stage, panels, resize, locale, colors and hidden modes", async () => {
  const f = fixture();
  startEmbeddedApps(f.app, () => {});
  syncEmbeddedApp(f.app);
  assert.equal(f.updates.at(-1).app, "blueprint");
  assert.deepEqual(f.updates.at(-1).bounds, { x: 13, y: 65, width: 1099, height: 699 });
  assert.equal(f.updates.at(-1).locale, "es");
  assert.equal(f.updates.at(-1).tokens.background, "#07040a");
  assert.equal(f.updates.at(-1).tokens.surface, "#110a0e");
  assert.equal(f.observers[0].node.getBoundingClientRect().width, 1100.5);
  const count = f.updates.length; syncEmbeddedApp(f.app); assert.equal(f.updates.length, count);
  f.setRect({ left: 12, top: 64, width: 744, height: 640 }); f.observers[0].callback();
  assert.equal(f.updates.at(-1).bounds.width, 744);
  f.app.mode = "document"; f.app.language = "en"; f.listeners.get("resize")();
  assert.equal(f.updates.at(-1).app, "void"); assert.equal(f.updates.at(-1).locale, "en");
  f.cover(true); syncEmbeddedApp(f.app); assert.equal(f.updates.at(-1).app, null);
  f.cover(false); syncEmbeddedApp(f.app); assert.equal(f.updates.at(-1).app, "void");
  for (const overlay of ["[data-service-banner]", '[data-overlay="true"]']) {
    f.cover(overlay); syncEmbeddedApp(f.app); assert.equal(f.updates.at(-1).app, null, overlay);
    f.cover(false); syncEmbeddedApp(f.app); assert.equal(f.updates.at(-1).app, "void");
  }
  f.document.hidden = true; syncEmbeddedApp(f.app); assert.equal(f.updates.at(-1).app, null);
  f.document.hidden = false; f.app.mode = "map"; syncEmbeddedApp(f.app); assert.equal(f.updates.at(-1).app, null);
  f.app.mode = "blueprint"; f.stageVisible(false); syncEmbeddedApp(f.app); assert.equal(f.updates.at(-1).app, null);
  f.stageVisible(true); f.app.disposed = true; disposeEmbeddedApps(f.app);
  assert.equal(f.updates.at(-1).app, null); assert.equal(f.listeners.size, 0);
  assert.ok(f.observers.every(observer => observer.disconnected));
});

test("native project selection follows repository clusters and the selected unit after its cluster selection clears", () => {
  const f = fixture();
  f.app.store.indexes.groups = new Map([
    ["shop", { id: "shop", link: { kind: "repository", projectId: "shop-project" }, members: ["shop-executor"] }],
    ["api", { id: "api", link: { kind: "repository", projectId: "api-project" }, members: ["api-executor"] }],
  ]);
  f.app.store.indexes.units = new Map([["api-executor", { id: "api-executor", clusterId: "api" }], ["shop-executor", { id: "shop-executor" }]]);
  f.app.store.selected = { groupId: "shop" }; syncEmbeddedApp(f.app);
  assert.equal(f.updates.at(-1).project, "shop-project");
  f.app.store.selected = { groupId: null, unitId: "api-executor" }; syncEmbeddedApp(f.app);
  assert.equal(f.updates.at(-1).project, "api-project");
  f.app.store.selected = { groupId: null, unitId: "shop-executor" }; syncEmbeddedApp(f.app);
  assert.equal(f.updates.at(-1).project, "shop-project");
  f.app.disposed = true; disposeEmbeddedApps(f.app);
});

test("only bridge stream events reach the native host and statuses stay app scoped", () => {
  const f = fixture(); let paints = 0;
  startEmbeddedApps(f.app, () => { paints++; });
  f.status({ app: "void", state: "ready" }); assert.equal(paints, 0);
  f.status({ app: "blueprint", state: "unavailable" }); assert.equal(paints, 1);
  f.status({ app: "unknown", state: "ready" }); assert.equal(paints, 1);
  f.status({ app: "blueprint", state: "unavailable" }); assert.equal(paints, 1);
  const event = { name: "app.bridge", envelope: { data: { app: "blueprint", name: "blueprint.changed", params: { location: "project", id: "board" } } } };
  forwardEmbeddedEvent(f.app, event); forwardEmbeddedEvent(f.app, { name: "view.changed" });
  assert.deepEqual(f.forwarded, [event]);
  assert.equal(embeddedTokens(f.document).border, "rgba(255, 45, 85, 0.22)");
  f.app.disposed = true; disposeEmbeddedApps(f.app);
});
