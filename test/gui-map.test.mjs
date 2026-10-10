import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  edgeEndpoints,
  fitBounds,
  groupOriginsFor,
  hitNode,
  initialPositions,
  marqueeIds,
  placeUnits,
  toScreen,
  toWorld,
} from "../gui/app/map-geometry.mjs";
import {
  cancelGesture,
  centerUnit,
  createMap,
  keyDown,
  pointerDown,
  pointerMove,
  pointerUp,
  renderMap,
  requestConnect,
  wheelZoom,
} from "../gui/app/map.mjs";

test("saved coordinates stay put and missing units fall into repeatable rings", () => {
  const units = [
    unit("root:master", "master", "master", "root"),
    unit("root:overseer", "overseer", "overseer", "root"),
    unit("root:adjutant", "adjutant", "adjutant", "root"),
    unit("root:executive", "executive", "executive", "root"),
    unit("root:genesis", "genesis", "genesis", "root"),
    unit("root:overseer-old", "overseer-old", "overseer", "root"),
    unit("env:web:overlord-web", "overlord-web", "overlord", "environment", "web"),
    unit("project:shop:executor-shop", "executor-shop", "executor", "project", "shop", "env:web:overlord-web"),
    unit("project:shop:missing", "missing", "executor", "project", "shop", "env:web:overlord-web"),
    unit("project:shop:loose", "loose", "executor", "project", "shop"),
  ];
  const saved = {
    nodes: {
      "root:master": { x: 380, y: 56 },
      "env:web:overlord-web": { x: 500, y: 80 },
      "project:shop:executor-shop": { x: 84, y: 246 },
    },
    groups: { "project:shop": { x: 214, y: 664, collapsed: false } },
  };
  const first = placeUnits(units, saved);
  const second = placeUnits(units, saved);
  assert.deepEqual(first, second);
  assert.deepEqual(first.positions["root:master"], { x: 380, y: 56 });
  assert.deepEqual(first.positions["project:shop:executor-shop"], { x: 84, y: 246 });
  assert.deepEqual(first.positions["root:overseer"], { x: 380, y: 160 });
  assert.deepEqual(first.positions["root:adjutant"], { x: 240, y: 160 });
  assert.equal(first.positions["root:overseer-old"], undefined);
  assert.deepEqual(first.origins["project:shop"], { x: 214, y: 664 });
  assert.deepEqual(first.positions["env:web:overlord-web"], { x: 500, y: 80 });
  assert.deepEqual(first.origins["lead:env:web:overlord-web"], { x: 500, y: 80 });
  assert.equal(first.positions["project:shop:missing"].y, 80 - 96);
  assert.equal(first.positions["project:shop:loose"].x <= 100000, true);
  const far = initialPositions(
    [unit("project:far:only", "only", "executor", "project", "far")],
    { nodes: {} },
    { "project:far": { x: 999999, y: -999999 } },
  );
  assert.deepEqual(far["project:far:only"], { x: 100000, y: -100000 });
  const origins = groupOriginsFor([
    unit("project:a:one", "one", "executor", "project", "a"),
    unit("project:b:two", "two", "executor", "project", "b"),
    unit("project:c:three", "three", "executor", "project", "c"),
    unit("project:d:four", "four", "executor", "project", "d"),
  ], { nodes: {}, groups: {} });
  assert.deepEqual(origins["project:a"], { x: 220, y: 360 });
  assert.deepEqual(origins["project:d"], { x: 220, y: 720 });
});

test("hit testing uses paint order, marquees include centers, and edges stop at the radius", () => {
  const nodes = [
    { id: "a", x: 0, y: 0, radius: 10 },
    { id: "b", x: 0, y: 0, radius: 10 },
  ];
  assert.equal(hitNode({ x: 0, y: 0 }, nodes, 1).id, "b");
  assert.equal(hitNode({ x: 30, y: 0 }, nodes, 1), null);
  const placed = [
    { id: "one", x: 5, y: 5 },
    { id: "two", x: 6, y: 6 },
    { id: "three", x: 7, y: 7 },
    { id: "out", x: 20, y: 20 },
  ];
  assert.deepEqual(marqueeIds({ x: 10, y: 10 }, { x: 0, y: 0 }, placed), ["one", "two", "three"]);
  assert.deepEqual(edgeEndpoints({ x: 0, y: 0, radius: 10 }, { x: 100, y: 0, radius: 10 }), {
    x1: 10, y1: 0, x2: 90, y2: 0,
  });
  const rect = { left: 0, top: 0, width: 800, height: 600 };
  const view = { x: 20, y: 30, zoom: 2 };
  assert.deepEqual(toWorld({ x: 120, y: 230 }, rect, view), { x: 50, y: 100 });
  assert.deepEqual(toScreen({ x: 50, y: 100 }, rect, view), { x: 120, y: 230 });
  assert.deepEqual(toWorld({ x: 120, y: 230 }, rect, view), toWorld({ x: 120, y: 230 }, rect, { ...view, devicePixelRatio: 2 }));
  const fitted = fitBounds([{ x: 0, y: 0 }, { x: 100, y: 50 }], { width: 400, height: 300 });
  assert.equal(fitted.zoom <= 2.5 && fitted.zoom >= 0.25, true);
});

test("map gestures move a group once, cancel, marquee, zoom, and ignore the API", () => {
  const map = createMap({
    api: { request() { throw new Error("The map must not persist yet."); } },
    units: [
      unit("a", "a", "executor", "project", "shop"),
      unit("b", "b", "executor", "project", "shop"),
      unit("c", "c", "executor", "project", "shop"),
      unit("d", "d", "executor", "project", "other"),
    ],
    saved: { nodes: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 20, y: 0 }, d: { x: 400, y: 400 } }, groups: {} },
  });
  map.view = { x: 0, y: 0, zoom: 1 };
  map.selection = new Set(["a", "b"]);
  const rect = { left: 0, top: 0, width: 800, height: 600 };
  pointerDown(map, point(0, 0, { unitId: "a", rect }));
  pointerMove(map, point(3, 0, { rect }));
  assert.deepEqual(map.positions.a, { x: 0, y: 0 });
  pointerMove(map, point(30, 0, { rect }));
  pointerMove(map, point(40, 0, { rect }));
  assert.deepEqual(map.positions.a, { x: 40, y: 0 });
  assert.deepEqual(map.positions.b, { x: 50, y: 0 });
  assert.deepEqual(map.positions.c, { x: 20, y: 0 });
  cancelGesture(map);
  assert.deepEqual(map.positions.a, { x: 0, y: 0 });
  assert.deepEqual(map.positions.b, { x: 10, y: 0 });

  pointerDown(map, point(80, 80, { rect }));
  pointerMove(map, point(40, 40, { rect }));
  pointerUp(map, point(-10, -10, { rect }));
  assert.deepEqual([...map.selection], ["a", "b", "c"]);

  map.view.zoom = 2;
  map.selection = new Set(["d"]);
  pointerDown(map, point(400, 400, { unitId: "d", rect }));
  pointerMove(map, point(420, 400, { rect }));
  pointerUp(map, point(420, 400, { rect }));
  assert.deepEqual(map.positions.d, { x: 410, y: 400 });

  const before = { ...map.view };
  const world = toWorld({ x: 100, y: 80 }, rect, map.view);
  wheelZoom(map, { clientX: 100, clientY: 80, deltaY: -1, preventDefault() {} }, rect);
  assert.deepEqual(toWorld({ x: 100, y: 80 }, rect, map.view), world);
  assert.notEqual(map.view.zoom, before.zoom);
  assert.equal(map.view.zoom <= 2.5, true);

  map.focusId = "a";
  keyDown(map, { key: "ArrowRight" });
  assert.equal(map.positions.a.x, 10);
  keyDown(map, { key: "ArrowRight", shiftKey: true });
  assert.equal(map.positions.a.x, 11);
  keyDown(map, { key: "Enter" });
  assert.equal(map.inspectorId, "a");
  requestConnect(map);
  assert.equal(map.pendingConnect.source, "a");
  assert.equal(map.api.request, map.api.request);
});

test("keyboard movement is saved and panning changes only the viewport", async () => {
  const calls = [];
  const map = createMap({
    units: [unit("a", "a", "executor", "project", "shop")],
    saved: { layout: { nodes: { a: { x: 0, y: 0 } }, groups: {} }, revision: "a".repeat(64) },
  });
  map.persist = true;
  map.transport = async (operation) => {
    calls.push(operation);
    return { data: { layout: { nodes: operation.body.nodes, groups: {} }, revision: "b".repeat(64) } };
  };
  const host = createHost();
  renderMap(host.ownerDocument, host, map, { pan: "Pan" });
  assert.equal(map.focusId, null);
  const node = host.querySelector("[data-unit-id='a']");
  host.listeners.get("focusin")[0]({ target: node });
  assert.equal(map.focusId, "a");
  const selected = [];
  map.onSelect = (id) => selected.push(id);
  keyDown(map, { key: "Enter", preventDefault() {} });
  assert.deepEqual(selected, ["a"]);
  assert.equal(map.inspectorId, "a");
  await keyDown(map, { key: "ArrowRight", preventDefault() {} });
  assert.deepEqual(map.positions.a, { x: 10, y: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].path, "/layout");
  assert.deepEqual(calls[0].body.nodes.a, { x: 10, y: 0 });
  assert.equal(calls[0].body.expectedRevision, "a".repeat(64));

  const rect = { left: 0, top: 0, width: 800, height: 600 };
  map.view = { x: 40, y: 40, zoom: 1 };
  pointerDown(map, { ...point(10, 10, { rect }), altKey: true });
  pointerMove(map, point(40, 25, { rect }));
  pointerUp(map, point(40, 25, { rect }));
  assert.deepEqual(map.view, { x: 70, y: 55, zoom: 1 });
  assert.deepEqual(map.positions.a, { x: 10, y: 0 });
  assert.equal(calls.length, 1);

  map.view = { x: 0, y: 0, zoom: 1 };
  host.querySelector("[data-action='pan']").listeners.get("click")[0]();
  assert.equal(map.panning, true);
  pointerDown(map, point(200, 200, { rect }));
  pointerMove(map, point(230, 210, { rect }));
  cancelGesture(map);
  assert.deepEqual(map.view, { x: 0, y: 0, zoom: 1 });
  pointerDown(map, point(200, 200, { rect }));
  pointerMove(map, point(230, 210, { rect }));
  pointerUp(map, point(230, 210, { rect }));
  assert.deepEqual(map.view, { x: 30, y: 10, zoom: 1 });
  assert.deepEqual(map.positions.a, { x: 10, y: 0 });
  assert.equal(calls.length, 1);
});

test("collapsed scope groups hide their members and rendered nodes keep paint order", () => {
  const map = createMap({
    units: [
      unit("b-node", "b", "executor", "project", "shop"),
      unit("a-node", "a", "executor", "project", "shop"),
      unit("lead", "lead", "overlord", "environment", "web"),
      unit("child", "child", "executor", "project", "shop", "lead"),
    ],
    saved: {
      nodes: {
        "a-node": { x: 1, y: 1 },
        "b-node": { x: 2, y: 2 },
        lead: { x: 50, y: 50 },
        child: { x: 80, y: 50 },
      },
      groups: { "project:shop": { x: 0, y: 0, collapsed: true } },
    },
  });
  const host = createHost();
  const order = renderMap(host.ownerDocument, host, map);
  assert.deepEqual(order, ["child", "lead"]);
  assert.equal(host.querySelector("[data-unit-id='a-node']"), null);
  assert.equal(host.querySelector("[data-edge='lead:child']") != null, true);
  map.selection = new Set(["lead", "child"]);
  renderMap(host.ownerDocument, host, map);
  assert.equal(host.querySelector("[data-action='connect']").textContent, "Connect");
  const centered = centerUnit(map, "lead", { width: 200, height: 100, left: 0, top: 0 });
  assert.equal(centered, true);
  assert.equal(map.centered, "lead");
  assert.deepEqual([...map.selection], ["lead"]);
});

test("map circles keep role, status, and the name below the icon", async () => {
  const overseer = unit("overseer", "overseer", "overseer", "root");
  overseer.status = "idle";
  const lead = unit("lead", "web", "overlord", "environment", "web");
  lead.status = "waiting";
  const child = unit("child", "shop", "executor", "project", "shop", "lead");
  child.status = "working";
  const master = unit("master", "master", "master", "root");
  const map = createMap({
    units: [overseer, lead, child, master],
    saved: {
      nodes: {
        overseer: { x: 10, y: 10 },
        lead: { x: 40, y: 40 },
        child: { x: 80, y: 40 },
        master: { x: 10, y: 80 },
      },
      groups: {},
    },
  });
  const labels = { statusIdle: "Inactivo", statusWaiting: "En espera", statusWorking: "Trabajando", statusUnknown: "Desconocido" };
  const host = createHost();
  renderMap(host.ownerDocument, host, map, labels);
  const boss = host.querySelector("[data-unit-id='overseer']");
  assert.equal(boss.getAttribute("data-role"), "overseer");
  assert.equal(boss.getAttribute("data-ring"), "overseer");
  assert.equal(boss.className.includes("is-overseer"), true);
  assert.equal(boss.querySelector("[data-role-icon='crown']") != null, true);
  assert.equal(boss.querySelector("[data-status='idle']").getAttribute("aria-label"), "Inactivo");
  assert.equal(boss.querySelector("[data-map-label='overseer']").textContent, "overseer");
  const web = host.querySelector("[data-unit-id='lead']");
  assert.equal(web.getAttribute("data-role"), "overlord");
  assert.equal(web.getAttribute("data-ring"), "lead");
  assert.equal(web.className.includes("is-lead"), true);
  assert.equal(web.querySelector("[data-role-icon='hierarchy']") != null, true);
  assert.equal(host.querySelector("[data-unit-id='child']").querySelector("[data-status='working']").getAttribute("aria-label"), "Trabajando");
  assert.equal(host.querySelector("[data-unit-id='master']").getAttribute("data-ring"), "person");
  assert.equal(host.querySelector("[data-unit-id='master']").querySelector("[data-role-icon='person']") != null, true);
  map.selection = new Set(["lead"]);
  renderMap(host.ownerDocument, host, map, labels);
  assert.equal(host.querySelector("[data-unit-id='lead']").getAttribute("data-selected"), "true");
  assert.equal(host.querySelector("[data-unit-id='lead']").className.includes("is-selected"), true);
  assert.equal(host.querySelector("[data-action='pan']") != null, true);
  assert.equal(host.querySelector("[data-handle='connect']") != null, true);
  const css = await readFile("gui/app/styles.css", "utf8");
  const modern = css.split('[data-look="high-contrast"]')[0];
  const contrast = css.split('[data-look="high-contrast"]')[1];
  assert.match(modern, /--radius-circle:\s*50%/);
  assert.match(contrast, /--radius-circle:\s*50%/);
  assert.match(css, /\.map-node\s*\{[^}]*border-radius:\s*var\(--radius-circle\)/);
});

function unit(id, name, role, kind, scopeName = null, leadId = null) {
  return {
    id,
    unit: name,
    role,
    scope: kind === "root" ? { kind, name: null } : { kind, name: scopeName },
    leadId,
  };
}

function point(x, y, extra) {
  return {
    clientX: x,
    clientY: y,
    pointerId: 1,
    shiftKey: false,
    rect: extra.rect,
    target: extra.unitId ? { dataset: { unitId: extra.unitId, handle: extra.handle ?? "" }, getAttribute: (name) => name === "data-unit-id" ? extra.unitId : extra.handle ?? null } : { getAttribute: () => null },
    currentTarget: { setPointerCapture() {} },
    preventDefault() {},
  };
}

function createHost() {
  function Node(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.listeners = new Map();
  }
  Node.prototype.setAttribute = function setAttribute(name, value) { this.attributes.set(name, String(value)); };
  Node.prototype.getAttribute = function getAttribute(name) { return this.attributes.get(name) ?? null; };
  Node.prototype.addEventListener = function addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  };
  Node.prototype.append = function append(...nodes) { this.children.push(...nodes); };
  Node.prototype.replaceChildren = function replaceChildren(...nodes) { this.children = [...nodes]; };
  Node.prototype.querySelector = function querySelector(selector) { return query(this, selector)[0] ?? null; };
  Node.prototype.querySelectorAll = function querySelectorAll(selector) { return query(this, selector); };
  const document = {};
  document.createElement = (tag) => new Node(document, tag);
  document.createElementNS = (_ns, tag) => new Node(document, tag);
  const host = new Node(document, "div");
  host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 760, height: 700 });
  return host;
}

function query(node, selector) {
  const found = [];
  const attribute = selector.startsWith("[") ? selector.slice(1, -1).split("=") : null;
  const walk = (current) => {
    if (attribute) {
      const [name, raw] = attribute;
      const expected = raw?.replaceAll("'", "");
      if (current.getAttribute?.(name) === expected) found.push(current);
    }
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return found;
}
