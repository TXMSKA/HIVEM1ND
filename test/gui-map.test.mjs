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
  hitPersonalGroup,
  personalZones,
  keyDown,
  pointerDown,
  pointerMove,
  pointerUp,
  renderMap,
  requestConnect,
  wheelZoom,
} from "../gui/app/map.mjs";
import { buildHierarchy, flattenVisibleHierarchy, unitRoleName } from '../gui/app/hierarchy.mjs';

test('canonical unread counts stay on the same aliased agent in Hierarchy and Map without selection acknowledgments', () => {
  const agent = { ...unit('root:worker', 'worker', 'executor', 'root'), alias: 'Cart', unread: 2 };
  const clusters = [{ id: 'shop', title: 'Shop', members: [agent.id], link: { kind: 'none' } }];
  const rows = flattenVisibleHierarchy(buildHierarchy([agent], [], clusters), { shown: new Map(), collapsed: new Set() });
  assert.equal(rows.find(row => row.id === agent.id).unit.unread, 2);
  const map = createMap({ units: [agent], groups: clusters }), host = createHost();
  renderMap(host.ownerDocument, host, map);
  const node = host.querySelector("[data-unit-id='root:worker']");
  assert.equal(node.children.find(child => child.className === 'map-unread').textContent, '2');
  map.focusId = agent.id; keyDown(map, { key: 'Enter', preventDefault() {} });
  assert.equal(agent.unread, 2);
  agent.unread = 1; renderMap(host.ownerDocument, host, map);
  assert.equal(host.querySelector("[data-unit-id='root:worker']").children.find(child => child.className === 'map-unread').textContent, '1');
});

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
  assert.deepEqual(first.positions["root:overseer"], { x: 380, y: 409 });
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

test("a persisted project origin and an unsaved lead group stay apart", () => {
  const units = [
    unit("env:web:overlord-web", "overlord-web", "overlord", "environment", "web"),
    unit("project:shop:partial", "partial", "executor", "project", "shop"),
  ];
  const saved = { nodes: {}, groups: { "project:shop": { x: 220, y: 360 } } };
  const placed = placeUnits(units, saved);
  assert.deepEqual(placed.origins["project:shop"], { x: 220, y: 360 });
  assert.equal(placed.origins["lead:env:web:overlord-web"].x === 220 && placed.origins["lead:env:web:overlord-web"].y === 360, false);
  const lead = placed.positions["env:web:overlord-web"];
  const partial = placed.positions["project:shop:partial"];
  assert.equal(Math.hypot(lead.x - partial.x, lead.y - partial.y) >= 56, true);
  const kept = placeUnits(units, { nodes: { "project:shop:partial": { x: 10, y: 12 } }, groups: saved.groups });
  assert.deepEqual(kept.positions["project:shop:partial"], { x: 10, y: 12 });
  assert.deepEqual(kept.positions["env:web:overlord-web"], lead);
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

  pointerDown(map, point(80, 80, { rect, shiftKey: true }));
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

test("Tab leaves a Connect handle forward and Enter or Space on it opens the connection dialog", () => {
  const map = createMap({
    units: [unit("a", "a", "executor", "project", "shop"), unit("b", "b", "executor", "project", "shop")],
    saved: { nodes: { a: { x: 0, y: 0 }, b: { x: 80, y: 0 } }, groups: {} },
  });
  const host = createHost();
  const document = host.ownerDocument;
  host.constructor.prototype.focus = function focus() { document.activeElement = this; };
  renderMap(document, host, map, { connect: "Connect" });
  const handleOf = (id) => host.querySelectorAll("[data-handle='connect']").find((item) => item.getAttribute("data-unit-id") === id);
  const keydown = (key, target) => host.listeners.get("keydown")[0]({ key, target, preventDefault() {} });
  handleOf("a").focus();
  host.listeners.get("focusin")[0]({ target: handleOf("a") });
  keydown("Tab", handleOf("a"));
  assert.equal(document.activeElement.getAttribute("data-handle"), "connect");
  assert.equal(document.activeElement.getAttribute("data-unit-id"), "a");
  keydown("x", handleOf("a"));
  assert.equal(document.activeElement, handleOf("a"));

  const connects = [];
  const selected = [];
  map.onGroupConnect = (pending) => connects.push(pending);
  map.onSelect = (id) => selected.push(id);
  host.listeners.get("focusin")[0]({ target: handleOf("b") });
  keydown("Enter", handleOf("b"));
  assert.deepEqual(connects, [{ source: "b", targets: [] }]);
  assert.deepEqual([...map.selection], ["b"]);
  keydown(" ", handleOf("a"));
  assert.deepEqual(connects.at(-1), { source: "a", targets: [] });
  assert.deepEqual(selected, []);
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
  const leadHandle = host.querySelectorAll("[data-handle='connect']").find((item) => item.getAttribute("data-unit-id") === "lead");
  assert.equal(leadHandle.getAttribute("aria-label"), "Connect lead");
  const leadNode = host.querySelectorAll("[data-unit-id='lead']").find((item) => item.getAttribute("data-role"));
  assert.equal(leadNode.querySelector("[data-handle='connect']"), null);
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
  const labels = { connect: "Conectar", statusIdle: "Inactivo", statusWaiting: "En espera", statusWorking: "Trabajando", statusUnknown: "Desconocido" };
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
  assert.equal(host.querySelector("[data-unit-id='master']"), null);

  map.selection = new Set(["lead"]);
  renderMap(host.ownerDocument, host, map, labels);
  assert.equal(host.querySelector("[data-unit-id='lead']").getAttribute("data-selected"), "true");
  assert.equal(host.querySelector("[data-unit-id='lead']").className.includes("is-selected"), true);
  assert.equal(host.querySelector("[data-action='pan']") != null, true);
  const overseerHandle = host.querySelectorAll("[data-handle='connect']").find((item) => item.getAttribute("data-unit-id") === "overseer");
  assert.equal(overseerHandle.getAttribute("aria-label"), "Conectar overseer");
  assert.equal(boss.querySelector("[data-handle='connect']"), null);
  const css = await readFile("gui/app/styles.css", "utf8");
  assert.match(css, /\.map-handle\s*\{[^}]*width:\s*44px/);
  assert.match(css, /\.map-handle\s*\{[^}]*height:\s*44px/);
  const modern = css.split('[data-look="high-contrast"]')[0];
  const contrast = css.split('[data-look="high-contrast"]')[1];
  assert.match(modern, /--radius-circle:\s*50%/);
  assert.match(contrast, /--radius-circle:\s*50%/);
  assert.match(css, /\.map-node\s*\{[^}]*border-radius:\s*var\(--radius-circle\)/);
});

test('saved cluster frames remain fixed while agents move and circles take priority', () => {
  const units = [unit('a', 'executor-a', 'executor', 'root'), { ...unit('b', 'executor-b', 'executor', 'root'), alias: 'Blog' }];
  const groups = [{ id: 'large', title: 'Large', members: ['a', 'b'], link: { kind: 'none' } }, { id: 'small', title: 'Small', members: ['a'], link: { kind: 'none' } }];
  const map = createMap({ units, groups, saved: { nodes: { a: { x: 100, y: 100 }, b: { x: 250, y: 300 } }, groups: { 'cluster:large': { x: 0, y: 0, width: 400, height: 400 }, 'cluster:small': { x: 20, y: 20, width: 180, height: 70 } } } });
  const host = createHost(); renderMap(host.ownerDocument, host, map);
  assert.equal(hitPersonalGroup(map, { x: 60, y: 60 }).id, 'small');
  const picked = []; map.onPersonalGroup = id => picked.push(id); map.onSelect = id => picked.push(id);
  const rect = { left: 0, top: 0, width: 760, height: 700 };
  pointerDown(map, point(100, 100, { rect, unitId: 'a' })); pointerUp(map, point(100, 100, { rect, unitId: 'a' }));
  assert.equal(picked.at(-1), 'a');
  pointerDown(map, point(60, 60, { rect })); pointerUp(map, point(60, 60, { rect }));
  assert.equal(picked.at(-1), 'small'); assert.equal(map.selection.size, 0);
  const before = personalZones(map); map.positions.a = { x: 700, y: 900 };
  assert.deepEqual(personalZones(map), before);
  assert.deepEqual(units.map(item => item.leadId), [null, null]);
  renderMap(host.ownerDocument, host, map);
  assert.equal(host.querySelector("[data-unit-id='b']").getAttribute('aria-label'), 'Blog (executor-b)');
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
    shiftKey: extra.shiftKey === true,
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
      const expected = raw?.replace(/['"]/g, "");
      if (current.getAttribute?.(name) === expected) found.push(current);
    }
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return found;
}

test("the Map draws each new role with its own mark, names a role the icon cannot tell in the tooltip and keeps an unknown role plain", () => {
  const roles = { a: "ux-designer", b: "ui-designer", c: "writer", d: "game-designer", e: "security-consultant", f: "qa", g: "code-reviewer", h: "product-manager",
    i: "custom", j: "constructor", k: "invented", l: "executor" };
  const marks = { a: "blueprint", b: "focus", c: "document", d: "move", e: "alert", f: "check", g: "graph", h: "map", i: "settings", j: "executor", k: "executor", l: "executor" };
  const units = Object.entries(roles).map(([id, role]) => ({ ...unit(id, `agent-${id}`, role, "root"), roleName: role === "custom" ? "Release captain" : null }));
  const saved = { nodes: Object.fromEntries(units.map((item, index) => [item.id, { x: 40 + index * 60, y: 40 }])), groups: {} };
  const map = createMap({ units, saved });
  const host = createHost();
  renderMap(host.ownerDocument, host, map, { roleName: (node) => unitRoleName(node, "en") });
  for (const [id, mark] of Object.entries(marks)) {
    const node = host.querySelector(`[data-unit-id='${id}']`);
    assert.equal(node.querySelector(`[data-role-icon='${mark}']`) != null, true, `${id} draws ${mark}`);
    assert.equal(node.getAttribute("data-role"), roles[id]);
  }
  const title = (id) => host.querySelector(`[data-unit-id='${id}']`).getAttribute("title");
  assert.equal(title("a"), "UX designer");
  assert.equal(title("f"), "QA");
  assert.equal(title("i"), "Release captain");
  for (const id of ["j", "k", "l"]) assert.equal(title(id), null, id);
  assert.equal(host.querySelector("[data-unit-id='j']").style.width, "42px");
  renderMap(host.ownerDocument, host, map);
  assert.equal(host.querySelector("[data-unit-id='i']").getAttribute("title"), null);
});
