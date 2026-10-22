import assert from 'node:assert/strict';
import test from 'node:test';
import { CELL_CENTER, CELL_H, CELL_W, FRAME_HEAD, FRAME_PAD, clusterFrames, fitLabel, frameHolds, hitNode, layoutClusters, placeUnits } from '../gui/app/map-geometry.mjs';
import {
  canConnect, createMap, flushLayout, hitClusterHeader, isCollapsed, keyDown, paintNodes, personalZones, pointerDown, pointerMove, pointerUp,
  queueLayoutPatch, renderMap, retrySavedLayout, toggleCollapsed,
} from '../gui/app/map.mjs';
import { buildHierarchy, flattenVisibleHierarchy, openContextMenu } from '../gui/app/hierarchy.mjs';
import { toScreen } from '../gui/app/map-geometry.mjs';

const unit = (id, name, role = 'executor', clusterId = null, leadId = null) => ({ id, unit: name, role, scope: { kind: 'root' }, clusterId, leadId, status: 'idle' });
const cluster = (id, title, parentId = null, members = [], kind = 'repository') => ({ id, title, parentId, members, link: kind === 'folder' ? { kind, folderId: id } : { kind, projectId: id } });
const rect = { left: 0, top: 0, width: 1200, height: 800 };
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const cellOf = point => ({ x: point.x - CELL_W / 2, y: point.y - CELL_CENTER, w: CELL_W, h: CELL_H });

// One repository box with the given number of executors.
function box(count) {
  const members = Array.from({ length: count }, (_, index) => unit(`u${index}`, `executor-${index + 1}`, 'executor', 'repo'));
  return { units: members, groups: [cluster('repo', 'shop', null, members.map(item => item.id))] };
}

// The user's real mind in numbers: 92 units, 26 groups. Two folders (Web with Nebula's 39 members, Unity), three loose repositories,
// seventy clustered agents, twenty-one agents that belong to no group and the Overseer.
function realMind() {
  const web = { Nebula: 39, HIVEM1ND: 6, MyOS: 2, Blueprint: 2, 'coffee-cat-page': 2, Horizon: 1, Lyra: 1, Void: 1, TXMSKA: 1, NTK: 1, AtomOS: 1, Nova: 1, Quantum: 1, Vault: 1, atom: 0, 'atom-epoch': 0 };
  const games = { Quark: 3, vigilum: 3, 'guest-or-ghost': 2, 'vr-painter': 1, 'e-pet': 0 };
  const loose = { 'ntk.solutions': 1, 'The-Tour': 0, Cosmic: 0 };
  const groups = [cluster('folder-web', 'Web', null, [], 'folder'), cluster('folder-unity', 'Unity', null, [], 'folder')], units = [];
  const add = (parent, table) => {
    for (const [title, count] of Object.entries(table)) {
      const id = `repo-${title}`, members = [];
      for (let index = 0; index < count; index += 1) {
        const role = title === 'Nebula' && index === 0 ? 'overlord' : 'executor';
        const item = unit(`project:${title}:${role}-${title}-${index + 1}`, `${role}-${title}${title === 'Nebula' ? '-parity-market' : ''}-${index + 1}`, role, id, role === 'executor' && title === 'Nebula' && index < 20 ? `project:${title}:overlord-${title}-1` : null);
        members.push(item.id); units.push(item);
      }
      groups.push(cluster(id, title, parent, members));
    }
  };
  add('folder-web', web); add('folder-unity', games); add(null, loose);
  for (let index = 0; index < 21; index += 1) units.push(unit(`root:free-${index}`, `builder-${index}`, 'agent'));
  units.push(unit('root:overseer', 'overseer', 'overseer'));
  return { units, groups };
}

function host() {
  function Node(document, tag) {
    this.ownerDocument = document; this.tagName = tag; this.children = []; this.attributes = new Map(); this.dataset = {}; this.style = {}; this.className = ''; this.textContent = ''; this.listeners = new Map();
  }
  Node.prototype.setAttribute = function setAttribute(name, value) { this.attributes.set(name, String(value)); };
  Node.prototype.getAttribute = function getAttribute(name) { return this.attributes.get(name) ?? null; };
  Node.prototype.addEventListener = function addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); };
  Node.prototype.append = function append(...nodes) { this.children.push(...nodes); };
  Node.prototype.replaceChildren = function replaceChildren(...nodes) { this.children = [...nodes]; };
  Node.prototype.querySelectorAll = function querySelectorAll(selector) { return find(this, selector); };
  Node.prototype.querySelector = function querySelector(selector) { return find(this, selector)[0] ?? null; };
  const document = { createElement: tag => new Node(document, tag), createElementNS: (_ns, tag) => new Node(document, tag) };
  const node = new Node(document, 'div');
  node.getBoundingClientRect = () => ({ ...rect });
  return node;
}

function find(root, selector) {
  const [name, raw] = selector.slice(1, -1).split('=');
  const wanted = raw?.replace(/['"]/g, ''), found = [];
  const walk = current => { if (current.getAttribute?.(name) === wanted) found.push(current); for (const child of current.children ?? []) walk(child); };
  walk(root);
  return found;
}

const layer = hostNode => hostNode.children.find(child => child.className === 'map-nodes');
const nodeButtons = hostNode => layer(hostNode).children.filter(child => child.className.split(' ').includes('map-node'));
const titleOf = (hostNode, id) => layer(hostNode).children.find(child => child.getAttribute('data-group-id') === id);

function pointer(x, y, extra = {}) {
  return { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', rect, currentTarget: { setPointerCapture() {} }, preventDefault() {}, ...extra };
}

function targetOf(node, attributes = {}) {
  const target = {
    dataset: { unitId: attributes['data-unit-id'] ?? '', handle: attributes['data-handle'] ?? '' },
    getAttribute: name => attributes[name] ?? null,
    closest: selector => selector === '[data-unit-id]' && attributes['data-unit-id'] ? target : selector === '[data-group-id]' && attributes['data-group-id'] ? target : null,
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 40, height: 40 }),
  };
  return node ? Object.assign(target, node) : target;
}

test('a repository box is sized to its members: its own grid cell per unit at 1, 2, 3, 6 and 30 units', () => {
  const heights = [];
  for (const count of [1, 2, 3, 6, 30]) {
    const { units, groups } = box(count);
    const placed = placeUnits(units, { nodes: {}, groups: {} }, groups), frame = clusterFrames(groups, {}, null, units)[0];
    const cells = units.map(item => cellOf(placed.positions[item.id]));
    for (const [index, cell] of cells.entries()) {
      assert.ok(frameHolds(placed.positions[units[index].id], 21, frame.bounds), `${count}: unit ${index} is inside the box`);
      assert.ok(cell.y >= frame.bounds.y + FRAME_HEAD && cell.x >= frame.bounds.x && cell.x + cell.w <= frame.bounds.x + frame.bounds.w, `${count}: the cell is below the title`);
      assert.ok(cell.y + cell.h <= frame.bounds.y + frame.bounds.h, `${count}: the cell is inside the box`);
      for (const other of cells.slice(index + 1)) assert.equal(overlaps(cell, other), false, `${count}: no two units share a cell`);
    }
    const rows = new Set(units.map(item => placed.positions[item.id].y)).size;
    assert.equal(frame.bounds.h, FRAME_HEAD + rows * CELL_H + FRAME_PAD, `${count}: the box height is what its rows need and nothing more`);
    if (count > 1) assert.ok(frame.bounds.w / frame.bounds.h > 0.6 && frame.bounds.w / frame.bounds.h < 2.4, `${count}: the box is a grid, not a column`);
    heights.push(frame.bounds.h);
  }
  assert.ok(heights.every((height, index) => index === 0 || height >= heights[index - 1]) && heights[4] > heights[3] && heights[3] > heights[0]);
  assert.ok(heights[4] < 30 * CELL_H / 3, 'thirty units are spread over columns instead of stacked');
});

test('a unit name has its own width and loses its middle, not its end, past it', () => {
  const measure = text => text.length * 6;
  assert.equal(fitLabel('executor', 120, measure), 'executor');
  const long = fitLabel('executor-Nebula-parity-market-9', 120, measure);
  assert.ok(measure(long) <= 120 && long.includes('…') && long.endsWith('market-9'.slice(-4)) && long.startsWith('executo'));
  assert.equal(fitLabel('', 120, measure), '');
  assert.equal(fitLabel('ab', 1, measure), '…');
});

test('the real mind of 92 units in 26 groups has no overlap between boxes, units or names at any zoom', () => {
  const { units, groups } = realMind();
  assert.equal(units.length, 92);
  assert.equal(groups.length, 26);
  const layout = layoutClusters(groups, {}, null, units), frames = layout.frames, byId = new Map(frames.map(frame => [frame.group.id, frame]));
  assert.equal(frames.length, 26);
  const siblings = new Map();
  for (const frame of frames) siblings.set(frame.group.parentId ?? '', [...(siblings.get(frame.group.parentId ?? '') ?? []), frame]);
  for (const [parent, list] of siblings) {
    for (const [index, frame] of list.entries()) {
      for (const other of list.slice(index + 1)) assert.equal(overlaps(frame.bounds, other.bounds), false, `${frame.group.title} and ${other.group.title} overlap`);
      if (parent) {
        const outer = byId.get(parent).bounds;
        assert.ok(frame.bounds.x >= outer.x && frame.bounds.y >= outer.y + FRAME_HEAD && frame.bounds.x + frame.bounds.w <= outer.x + outer.w && frame.bounds.y + frame.bounds.h <= outer.y + outer.h, `${frame.group.title} is inside its folder`);
      }
    }
  }
  const nebula = byId.get('repo-Nebula').bounds;
  assert.ok(nebula.h < 39 * CELL_H / 3 && nebula.w / nebula.h < 2.2, 'Nebula is a grid sized to its 39 units');
  const placed = placeUnits(units, { nodes: {}, groups: {} }, groups);
  const clustered = units.filter(item => item.clusterId);
  assert.equal(clustered.length, 70);
  assert.equal(Object.keys(placed.positions).length, 92, 'every unit has a place, the twenty-one outside any group beside the Overseer');
  const cells = units.filter(item => item.role !== 'overseer').map(item => cellOf(placed.positions[item.id]));
  for (const [index, cell] of cells.entries()) for (const other of cells.slice(index + 1)) assert.equal(overlaps(cell, other), false);
  const overseer = placed.positions['root:overseer'];
  assert.ok(frames.every(frame => !overlaps({ x: overseer.x - 30, y: overseer.y - 30, w: 60, h: 100 }, frame.bounds)), 'the Overseer is outside every box');

  const map = createMap({ units, groups, saved: { nodes: {}, groups: {} } });
  const surface = host();
  for (const zoom of [0.08, 0.15, 0.3, 0.45, 0.75, 1, 1.6, 2.5]) {
    map.view = { x: 0, y: 0, zoom };
    renderMap(surface.ownerDocument, surface, map, {});
    const shown = nodeButtons(surface).map(button => {
      const size = Number.parseFloat(button.style.width), name = button.children.find(child => child.className === 'map-label');
      const cx = Number.parseFloat(button.style.left), cy = Number.parseFloat(button.style.top), width = Number.parseFloat(name.style.maxWidth);
      assert.ok(Math.abs(size / 2 - 21 * zoom) < 0.01 || size / 2 > 21 * zoom, `a circle is drawn at the scale of the Map, zoom ${zoom}`);
      assert.ok(width <= (CELL_W - 8) * zoom + 0.001, `a name is never wider than its cell, zoom ${zoom}`);
      return { circle: { x: cx - size / 2, y: cy - size / 2, w: size, h: size }, name: { x: cx - width / 2, y: cy + size / 2, w: width, h: 16 * zoom } };
    });
    assert.equal(shown.length, 92);
    for (const [index, one] of shown.entries()) for (const other of shown.slice(index + 1)) {
      assert.equal(overlaps(one.circle, other.circle) || overlaps(one.name, other.name) || overlaps(one.circle, other.name) || overlaps(one.name, other.circle), false, `units overlap at zoom ${zoom}`);
    }
    assert.equal(layer(surface).getAttribute('data-detail'), zoom < 0.3 ? 'far' : zoom < 0.4 ? 'mid' : 'near');
  }
});

test('a cluster collapses to one chip that counts what the Hierarchy counts, and expands again', () => {
  const { units, groups } = realMind();
  const map = createMap({ units, groups, saved: { nodes: {}, groups: {} } });
  assert.equal(paintNodes(map).length, 92);
  assert.equal(toggleCollapsed(map, 'folder-web'), true);
  assert.equal(isCollapsed(map, 'folder-web'), true);
  const chip = personalZones(map).find(frame => frame.group.id === 'folder-web');
  assert.ok(chip.compact && chip.collapsed && chip.count === 16 && chip.bounds.h < 50, 'a folder says how many clusters it holds');
  assert.equal(personalZones(map).some(frame => frame.group.id === 'repo-Nebula'), false);
  assert.equal(paintNodes(map).length, 32, 'the Web agents are hidden; Unity, ntk.solutions, the Overseer and the agents outside any group stay');
  // A repository cluster says how many agents it holds; both numbers are the ones the Hierarchy shows.
  assert.equal(toggleCollapsed(map, 'repo-Quark'), true);
  const rows = flattenVisibleHierarchy(buildHierarchy(units, [], groups), { shown: new Map(), collapsed: new Set() });
  for (const id of ['folder-web', 'repo-Quark']) assert.equal(personalZones(map).find(frame => frame.group.id === id).count, rows.find(row => row.groupId === id).count, id);
  assert.equal(personalZones(map).find(frame => frame.group.id === 'repo-Quark').count, 3);
  assert.equal(toggleCollapsed(map, 'repo-Quark'), false);
  assert.equal(toggleCollapsed(map, 'folder-web'), false);
  assert.equal(paintNodes(map).length, 92);
});

test('a folded chip shows its glyph, its title, its count in a badge and a button that unfolds it', () => {
  const { units, groups } = realMind();
  const map = createMap({ units, groups, saved: { nodes: {}, groups: {} } }), surface = host();
  toggleCollapsed(map, 'folder-web');
  const labels = { expand: name => `Expand ${name}` };
  renderMap(surface.ownerDocument, surface, map, labels);
  const chips = layer(surface).children.filter(child => child.className === 'map-chip');
  assert.equal(chips.length, 1, 'only the folded cluster is a chip');
  const [title, badge, expand] = chips[0].children;
  assert.equal(title.getAttribute('data-group-id'), 'folder-web');
  assert.equal(title.children[0].children[1].textContent, 'Web', 'the title carries no count; the badge does');
  assert.ok(title.children[0].children[0].tagName, 'the glyph is drawn');
  assert.equal(badge.className, 'map-group-badge');
  assert.equal(badge.textContent, '16');
  assert.equal(expand.getAttribute('data-action'), 'expand-cluster');
  assert.equal(expand.getAttribute('aria-label'), 'Expand Web');
  const frame = personalZones(map).find(item => item.group.id === 'folder-web');
  assert.ok(frame.bounds.w >= 30 + 'Web'.length * 7.2 + 20 + 30, 'the chip is wide enough for the badge and the button');
  expand.listeners.get('click')[0]();
  assert.equal(isCollapsed(map, 'folder-web'), false, 'the button unfolds the cluster');
  assert.equal(layer(surface).children.some(child => child.className === 'map-chip'), false);
  assert.ok(titleOf(surface, 'folder-web'), 'the unfolded cluster has its title again');
  assert.equal(titleOf(surface, 'folder-web').children[0].children[1].textContent, 'Web, 16', 'an open frame keeps its label');
});

test('a name is never cut: at every zoom a folded chip, a compact box and a frame title hold their whole label', () => {
  const px = value => Number.parseFloat(value) || 0;
  const captionWidth = (label, measure) => {
    const caption = label.children[0], [glyph, title] = caption.children, across = caption.style.padding.split(' ')[1];
    return px(across) * 2 + (glyph.style.display === 'none' ? 0 : px(glyph.style.width) + px(caption.style.gap)) + measure(title.textContent) * px(label.style.fontSize) / 11.5;
  };
  const chipOf = (surface, id) => layer(surface).children.find(child => child.className === 'map-chip' && child.children[0].getAttribute('data-group-id') === id);
  // One measure close to the layout's own estimate, one for names made of wide letters.
  for (const measure of [text => text.length * 6.6, text => text.length * 10]) {
    const { units, groups } = realMind();
    const map = createMap({ units, groups, saved: { nodes: {}, groups: {} } }), surface = host();
    map.measureLabel = measure;
    toggleCollapsed(map, 'folder-web'); toggleCollapsed(map, 'repo-Quark');
    for (const zoom of [0.25, 0.66, 1, 2.5]) {
      map.view = { x: 0, y: 0, zoom };
      renderMap(surface.ownerDocument, surface, map, {});
      const near = layer(surface).getAttribute('data-detail') === 'near', seen = new Set();
      for (const zone of personalZones(map)) {
        const id = zone.group.id, name = `${zone.group.title} at ${zoom}`;
        const box = find(surface.children.find(child => child.getAttribute('class') === 'map-edges'), `[data-group-zone=${id}]`)[0];
        const width = px(box.getAttribute('width'));
        assert.ok(width >= zone.bounds.w * zoom - 0.001, `${name}: the box is never narrower than its frame`);
        // Every part scales with the name, so where the layout's own estimate holds the name it holds it at every readable zoom.
        if (zone.compact && zoom >= 0.66 && measure('x') === 6.6) assert.ok(Math.abs(width - zone.bounds.w * zoom) < 0.001, `${name}: the layout's box already holds the name`);
        if (zone.collapsed) {
          const chip = chipOf(surface, id), [label, ...rest] = chip.children, parts = [captionWidth(label, measure)];
          const badge = rest.find(child => child.className === 'map-group-badge'), expand = rest.find(child => child.className === 'map-chip-expand');
          if (near && badge) parts.push(measure(badge.textContent) * px(badge.style.fontSize) / 11.5 + px(badge.style.padding.split(' ')[1]) * 2);
          if (near) parts.push(px(expand.style.width));
          const content = parts.reduce((sum, part) => sum + part, 0) + px(chip.style.gap) * (parts.length - 1) + px(chip.style.paddingLeft) * 2;
          assert.ok(content <= px(chip.style.width) + 0.001, `${name}: the folded chip holds its glyph, name, count and button (${content} in ${chip.style.width})`);
          assert.equal(px(chip.style.width), width, `${name}: the chip and its box are one width`);
          seen.add('chip');
        } else {
          const label = titleOf(surface, id), caption = captionWidth(label, measure);
          if (zone.compact) {
            assert.ok(caption + 6 * zoom <= width + 0.001 && px(label.style.maxWidth) >= caption, `${name}: the compact box holds its name`);
            seen.add('compact');
          } else {
            assert.ok(px(label.style.maxWidth) >= caption, `${name}: the frame title is not cut`);
            seen.add('title');
          }
        }
      }
      assert.deepEqual([...seen].sort(), ['chip', 'compact', 'title'], `every kind of label is checked at ${zoom}`);
    }
    // Where the layout's own estimate is enough, the chip is the width the layout gave it.
    if (measure('x') === 6.6) {
      map.view = { x: 0, y: 0, zoom: 1 };
      renderMap(surface.ownerDocument, surface, map, {});
      assert.equal(px(chipOf(surface, 'folder-web').style.width), personalZones(map).find(zone => zone.group.id === 'folder-web').bounds.w);
    }
  }
});

test('dragging a cluster title moves the cluster, what is inside it and the places saved for its units, and saves them in one request', async () => {
  const groups = [cluster('web', 'Web', null, [], 'folder'), cluster('a', 'alpha', 'web', ['a1', 'a2']), cluster('b', 'beta', 'web', ['b1'])];
  const units = [unit('a1', 'a-one', 'executor', 'a'), unit('a2', 'a-two', 'executor', 'a'), unit('b1', 'b-one', 'executor', 'b')];
  const slots = placeUnits(units, { nodes: {}, groups: {} }, groups).positions;
  const calls = [], state = { nodes: {}, groups: {}, revision: 0 };
  const map = createMap({ units, groups, saved: { layout: { nodes: { a1: { x: slots.a1.x + 6, y: slots.a1.y } }, groups: {} }, revision: 'r0' } });
  map.persist = true;
  map.transport = async operation => {
    calls.push(operation);
    Object.assign(state.nodes, operation.body.nodes);
    for (const [key, patch] of Object.entries(operation.body.groups ?? {})) state.groups[key] = { ...state.groups[key], ...patch };
    state.revision += 1;
    return { data: { layout: { nodes: { ...state.nodes }, groups: structuredClone(state.groups) }, revision: `r${state.revision}` } };
  };
  const surface = host();
  renderMap(surface.ownerDocument, surface, map, {});
  const before = Object.fromEntries(personalZones(map).map(frame => [frame.group.id, { ...frame.bounds }]));
  const title = titleOf(surface, 'web');
  pointerDown(map, pointer(60, 30, { target: targetOf(title, { 'data-group-id': 'web' }) }));
  pointerMove(map, pointer(62, 31));
  assert.equal(map.drag, undefined, 'a small movement is a click, not a drag');
  pointerMove(map, pointer(260, 130));
  assert.equal(personalZones(map).find(frame => frame.group.id === 'a').bounds.x, before.a.x + 200, 'the frames inside follow the pointer');
  assert.equal(paintNodes(map).find(node => node.id === 'b1').x, slots.b1.x + 200, 'the units follow too');
  pointerUp(map, pointer(260, 130));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].body.groups).sort(), ['cluster:a', 'cluster:b', 'cluster:web']);
  assert.deepEqual(calls[0].body.groups['cluster:web'], { x: before.web.x + 200, y: before.web.y + 100 });
  assert.deepEqual(calls[0].body.nodes, { a1: { x: slots.a1.x + 6 + 200, y: slots.a1.y + 100 } }, 'only a place the person chose is saved');
  assert.equal(map.persistState, 'saved');
  const after = Object.fromEntries(personalZones(map).map(frame => [frame.group.id, frame.bounds]));
  for (const id of ['web', 'a', 'b']) assert.deepEqual(after[id], { ...before[id], x: before[id].x + 200, y: before[id].y + 100 }, id);
  assert.equal(map.positions.a2.x, slots.a2.x + 200);

  // Moving one cluster keeps its neighbours where they are.
  calls.length = 0;
  const alpha = titleOf(surface, 'a'), start = toScreen({ x: after.a.x + 30, y: after.a.y + 10 }, rect, map.view);
  renderMap(surface.ownerDocument, surface, map, {});
  pointerDown(map, pointer(start.x, start.y, { target: targetOf(titleOf(surface, 'a') ?? alpha, { 'data-group-id': 'a' }) }));
  pointerMove(map, pointer(start.x + 40, start.y + 300));
  pointerUp(map, pointer(start.x + 40, start.y + 300));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(personalZones(map).find(frame => frame.group.id === 'b').bounds, after.b, 'beta did not move');
  assert.equal(personalZones(map).find(frame => frame.group.id === 'a').bounds.y, after.a.y + 300);
});

test('a click on a cluster title is left to the title, which is not drawn again under the click', () => {
  const groups = [cluster('a', 'alpha', null, ['a1'])], units = [unit('a1', 'a-one', 'executor', 'a')];
  const map = createMap({ units, groups, saved: { nodes: {}, groups: {} } }), surface = host(), picked = [];
  map.onPersonalGroup = id => picked.push(id);
  renderMap(surface.ownerDocument, surface, map, {});
  const title = titleOf(surface, 'a'), before = surface.children.at(1);
  pointerDown(map, pointer(60, 30, { target: targetOf(title, { 'data-group-id': 'a' }) }));
  pointerUp(map, pointer(60, 30));
  assert.equal(surface.children.at(1), before, 'the title the click lands on is still the one on the page');
  assert.equal(map.gesture, null);
  title.listeners.get('click')[0]();
  assert.deepEqual(picked, ['a']);
});

test('a cluster is also picked up by its header strip, and a unit dropped outside its box goes back', async () => {
  const groups = [cluster('a', 'alpha', null, ['a1', 'a2'])], units = [unit('a1', 'a-one', 'executor', 'a'), unit('a2', 'a-two', 'executor', 'a')];
  const calls = [], map = createMap({ units, groups, saved: { layout: { nodes: {}, groups: {} }, revision: 'r0' } });
  map.persist = true;
  map.transport = async operation => { calls.push(operation); return { data: { layout: { nodes: operation.body.nodes ?? {}, groups: {} }, revision: 'r1' } }; };
  const surface = host();
  renderMap(surface.ownerDocument, surface, map, {});
  const frame = personalZones(map)[0], strip = { x: frame.bounds.x + frame.bounds.w - 12, y: frame.bounds.y + 10 };
  assert.equal(hitClusterHeader(map, strip)?.id, 'a');
  assert.equal(hitClusterHeader(map, { x: frame.bounds.x + 20, y: frame.bounds.y + FRAME_HEAD + 20 }), null);
  pointerDown(map, pointer(strip.x, strip.y, { target: targetOf(null) }));
  pointerMove(map, pointer(strip.x + 90, strip.y + 50));
  pointerUp(map, pointer(strip.x + 90, strip.y + 50));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[0].body.groups['cluster:a'], { x: Math.round(frame.bounds.x) + 90, y: Math.round(frame.bounds.y) + 50 });

  calls.length = 0;
  const home = map.positions.a1, at = { ...home };
  pointerDown(map, pointer(at.x, at.y, { target: targetOf(null, { 'data-unit-id': 'a1' }) }));
  pointerMove(map, pointer(at.x + 3000, at.y + 3000));
  pointerUp(map, pointer(at.x + 3000, at.y + 3000));
  assert.deepEqual(map.positions.a1, at, 'a unit stays in its box');
  assert.equal(calls.length, 0);
  pointerDown(map, pointer(at.x, at.y, { target: targetOf(null, { 'data-unit-id': 'a1' }) }));
  pointerMove(map, pointer(at.x + 20, at.y + 5));
  pointerUp(map, pointer(at.x + 20, at.y + 5));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[0].body.nodes.a1, { x: at.x + 20, y: at.y + 5 });
});

test('a save that fails is tried again quietly before the person is told, and has its own slot at the top', async () => {
  const groups = [cluster('a', 'alpha', null, ['a1'])], units = [unit('a1', 'a-one', 'executor', 'a')];
  const map = createMap({ units, groups, saved: { layout: { nodes: {}, groups: {} }, revision: 'r0' } });
  map.persist = true;
  map.retryDelays = [0, 0];
  let failures = 3;
  const states = [];
  map.transport = async operation => {
    if (failures > 0) { failures -= 1; throw Object.assign(new Error('The service did not answer.'), { code: 'service_unavailable' }); }
    return { data: { layout: { nodes: operation.body.nodes, groups: {} }, revision: 'r1' } };
  };
  map.onPersist = () => states.push(map.persistState);
  queueLayoutPatch(map, 'a1', { x: 50, y: 60 });
  await flushLayout(map);
  assert.equal(map.persistState, 'retrying', 'the first failure shows nothing');
  for (let wait = 0; wait < 100 && map.persistState !== 'error'; wait += 1) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(map.persistState, 'error', 'after the quiet tries the failure is shown');
  assert.equal(states.filter(state => state === 'error').length, 1);
  const shown = states.filter(state => state !== 'saving');
  assert.equal(shown.at(-1), 'error');
  assert.ok(shown.slice(0, -1).every(state => state === 'retrying'), 'until then the person is told nothing');

  const surface = host(), retries = [];
  map.onRetryLayout = () => retries.push(true);
  const labels = { drag: 'Drag the map', inside: (name, count) => `Zoomed in on ${name}, ${count}`, layoutError: 'The map was not saved.', retry: 'Retry' };
  renderMap(surface.ownerDocument, surface, map, labels);
  const top = surface.children.at(-1);
  assert.equal(top.className, 'map-top');
  assert.deepEqual(top.children.map(child => child.className), ['map-save'], 'the general hint is not drawn at the top; it is behind the help button');
  const [message, retry] = top.children[0].children;
  assert.equal(message.textContent, 'The map was not saved.');
  retry.listeners.get('click')[0]();
  assert.equal(retries.length, 1);
  // Zoomed into a folder, the hint that says so and the notice are separate siblings.
  map.focusedFolder = 'a';
  renderMap(surface.ownerDocument, surface, map, labels);
  assert.deepEqual(surface.children.at(-1).children.map(child => child.className), ['map-hint', 'map-save'], 'the hint and the notice are separate siblings');
  assert.equal(surface.children.at(-1).children[0].textContent, 'Zoomed in on Alpha, 0');
  map.focusedFolder = null;
  failures = 0;
  await retrySavedLayout(map);
  assert.equal(map.persistState, 'saved');
  assert.equal(map.pending.size, 0);
  map.persistState = 'retrying';
  renderMap(surface.ownerDocument, surface, map, {});
  assert.deepEqual(surface.children.at(-1).children.map(child => child.className), [], 'a quiet retry draws nothing');
});

test('dragging from one unit to another connects them, with a line, a marked drop target and the same dialog as the keyboard, at every zoom and with touch', () => {
  const units = [unit('a', 'alpha', 'overlord', 'c'), unit('b', 'beta', 'executor', 'c', 'a'), unit('d', 'delta', 'executor', 'c'), unit('e', 'echo', 'executor', 'c', 'd')];
  const groups = [cluster('c', 'crew', null, units.map(item => item.id))];
  assert.equal(canConnect({ units }, 'a', 'd'), true);
  assert.equal(canConnect({ units }, 'a', 'a'), false);
  assert.equal(canConnect({ units }, 'a', 'b'), false, 'b already reports to a');
  assert.equal(canConnect({ units }, 'e', 'd'), false, 'd leads e, so e cannot lead d');
  for (const [zoom, pointerType, slop] of [[0.12, 'mouse', 0], [0.3, 'mouse', 0], [0.6, 'touch', 12], [1, 'mouse', 0], [2.5, 'touch', 12]]) {
    const map = createMap({ units, groups, saved: { nodes: {}, groups: {} } }), surface = host(), connected = [], asked = [];
    map.view = { x: 30, y: 40, zoom };
    map.onConnect = pending => connected.push(pending);
    map.onGroupConnect = pending => asked.push(pending);
    renderMap(surface.ownerDocument, surface, map, {});
    const screen = id => toScreen(paintNodes(map).find(node => node.id === id), rect, map.view);
    const handle = layer(surface).children.find(child => child.getAttribute('data-handle') === 'connect' && child.getAttribute('data-unit-id') === 'a');
    const from = screen('a'), onto = screen('d'), edge = 21 * zoom + slop;
    pointerDown(map, pointer(from.x + edge, from.y, { pointerType, target: targetOf(handle, { 'data-unit-id': 'a', 'data-handle': 'connect' }) }));
    assert.equal(map.gesture.kind, 'connect');
    pointerMove(map, pointer(from.x + 200, from.y + 160, { pointerType }));
    renderMap(surface.ownerDocument, surface, map, {});
    const line = surface.children[0].children.find(child => child.getAttribute('class')?.includes('map-pending-edge'));
    assert.ok(line, `a line follows the pointer, zoom ${zoom}`);
    assert.equal(line.getAttribute('data-pending-edge'), 'a:');
    assert.equal(Number.parseFloat(line.getAttribute('x2')), from.x + 200 - rect.left, 'it ends at the pointer');
    pointerMove(map, pointer(onto.x + (pointerType === 'touch' ? 21 * zoom + 8 : 0), onto.y, { pointerType }));
    renderMap(surface.ownerDocument, surface, map, {});
    assert.ok(nodeButtons(surface).find(button => button.getAttribute('data-unit-id') === 'd').className.includes('is-drop-target'), `the target is marked, zoom ${zoom}`);
    assert.equal(surface.children[0].children.find(child => child.getAttribute('class')?.includes('map-pending-edge')).getAttribute('data-pending-edge'), 'a:d');
    pointerUp(map, pointer(onto.x, onto.y, { pointerType }));
    assert.deepEqual(connected, [{ source: 'a', target: 'd' }], `dropping on a unit connects, zoom ${zoom}`);
    assert.deepEqual(asked, []);

    // A unit that cannot be connected is marked and nothing is asked.
    const toE = screen('e');
    pointerDown(map, pointer(from.x + edge, from.y, { pointerType, target: targetOf(handle, { 'data-unit-id': 'a', 'data-handle': 'connect' }) }));
    pointerMove(map, pointer(screen('b').x, screen('b').y, { pointerType }));
    renderMap(surface.ownerDocument, surface, map, {});
    assert.ok(nodeButtons(surface).find(button => button.getAttribute('data-unit-id') === 'b').className.includes('is-drop-invalid'));
    pointerUp(map, pointer(screen('b').x, screen('b').y, { pointerType }));
    assert.equal(connected.length, 1);
    assert.equal(map.pendingConnect, null);
    void toE;

    // A tap on the handle asks for the lead the way the keyboard does.
    pointerDown(map, pointer(from.x + edge, from.y, { pointerType, target: targetOf(handle, { 'data-unit-id': 'a', 'data-handle': 'connect' }) }));
    pointerUp(map, pointer(from.x + edge, from.y, { pointerType }));
    assert.deepEqual(asked, [{ source: 'a', targets: [] }]);
    assert.deepEqual([...map.selection], ['a']);
  }
  const wide = hitNode({ x: 40, y: 0 }, [{ id: 'n', x: 0, y: 0, radius: 21 }], 1, 6);
  assert.equal(wide, null);
  assert.equal(hitNode({ x: 40, y: 0 }, [{ id: 'n', x: 0, y: 0, radius: 21 }], 1, 20)?.id, 'n');
});

test('the context menu key and Shift+F10 open the menu of the focused unit or title, the right button never starts a gesture', () => {
  const units = [unit('a', 'alpha', 'executor', 'c')], groups = [cluster('c', 'crew', null, ['a'])];
  const map = createMap({ units, groups, saved: { nodes: {}, groups: {} } }), surface = host(), seen = [];
  map.onContextMenu = target => seen.push(target);
  renderMap(surface.ownerDocument, surface, map, {});
  const send = (type, event) => surface.listeners.get(type)[0](event);
  const prevented = [];
  const unitNode = nodeButtons(surface)[0];
  send('contextmenu', { clientX: 90, clientY: 70, target: targetOf(unitNode, { 'data-unit-id': 'a' }), preventDefault: () => prevented.push(true) });
  assert.deepEqual(seen.at(-1), { kind: 'unit', id: 'a', x: 90, y: 70 });
  send('contextmenu', { clientX: 12, clientY: 14, target: targetOf(titleOf(surface, 'c'), { 'data-group-id': 'c' }), preventDefault: () => prevented.push(true) });
  assert.deepEqual(seen.at(-1), { kind: 'cluster', id: 'c', x: 12, y: 14 });
  const frame = personalZones(map)[0], inside = toScreen({ x: frame.bounds.x + 5, y: frame.bounds.y + frame.bounds.h - 5 }, rect, map.view);
  send('contextmenu', { clientX: inside.x, clientY: inside.y, target: targetOf(null), preventDefault: () => prevented.push(true) });
  assert.equal(seen.at(-1).kind, 'cluster');
  // Empty space has the Map's own menu, so the browser's never opens there.
  send('contextmenu', { clientX: 5000, clientY: 5000, target: targetOf(null), preventDefault: () => prevented.push(true) });
  assert.equal(seen.at(-1).kind, 'map');
  assert.deepEqual([seen.at(-1).x, seen.at(-1).y], [5000, 5000]);
  assert.equal(prevented.length, 4);
  keyDown(map, { key: 'ContextMenu', target: targetOf(unitNode, { 'data-unit-id': 'a' }), preventDefault: () => prevented.push(true) });
  assert.deepEqual(seen.at(-1), { kind: 'unit', id: 'a', x: 120, y: 120, keyboard: true });
  keyDown(map, { key: 'F10', shiftKey: true, target: targetOf(titleOf(surface, 'c'), { 'data-group-id': 'c' }), preventDefault: () => prevented.push(true) });
  assert.deepEqual(seen.at(-1), { kind: 'cluster', id: 'c', x: 120, y: 120, keyboard: true });
  pointerDown(map, pointer(50, 50, { button: 2, target: targetOf(unitNode, { 'data-unit-id': 'a' }) }));
  assert.equal(map.gesture, null, 'the right button starts no drag and selects nothing');
});

function menuDocument() {
  const listeners = new Map(), document = { activeElement: null, listeners };
  function Node(tag) { this.tagName = tag; this.children = []; this.attributes = new Map(); this.style = {}; this.className = ''; this.textContent = ''; this.parent = null; this.handlers = new Map(); }
  Node.prototype.setAttribute = function setAttribute(name, value) { this.attributes.set(name, String(value)); };
  Node.prototype.getAttribute = function getAttribute(name) { return this.attributes.get(name) ?? null; };
  Node.prototype.addEventListener = function addEventListener(type, fn) { this.handlers.set(type, fn); };
  Node.prototype.append = function append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } };
  Node.prototype.remove = function remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; };
  Node.prototype.contains = function contains(node) { return node === this || this.children.some(child => child.contains(node)); };
  Node.prototype.focus = function focus() { document.activeElement = this; };
  Node.prototype.getBoundingClientRect = function getBoundingClientRect() { return { width: 200, height: 150, left: 0, top: 0 }; };
  Object.defineProperty(Node.prototype, 'disabled', { get() { return this.attributes.has('disabled'); } });
  document.createElement = tag => new Node(tag);
  document.body = new Node('body');
  document.live = new Map();
  document.querySelector = selector => selector.includes('data-context-menu') ? document.body.children.find(child => child.getAttribute('data-context-menu')) ?? null : document.live.get(selector) ?? null;
  document.addEventListener = (type, fn) => listeners.set(type, fn);
  document.removeEventListener = type => listeners.delete(type);
  document.defaultView = { innerWidth: 400, innerHeight: 300 };
  return document;
}

test('the context menu opens at the pointer inside the window, moves with the arrows, runs a choice and closes on Escape or a click elsewhere', () => {
  const document = menuDocument(), ran = [], invoker = document.createElement('button');
  invoker.focus();
  const { menu } = openContextMenu(document, { x: 390, y: 290, label: 'Actions for alpha', items: [
    { id: 'open', label: 'Open', primary: true, run: () => ran.push('open') }, { id: 'rename', label: 'Rename', run: () => ran.push('rename') },
    { id: 'gone', label: 'Gone', disabled: true }, { id: 'delete', label: 'Delete', danger: true, run: () => ran.push('delete') }] });
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(menu.getAttribute('aria-label'), 'Actions for alpha');
  assert.equal(menu.style.left, '192px');
  assert.equal(menu.style.top, '142px');
  const [open, rename, gone, remove] = menu.children;
  assert.equal(document.activeElement, open, 'the first action has the focus');
  assert.ok(open.className.includes('is-primary') && !rename.className.includes('is-primary') && remove.className.includes('is-danger'), 'the first action is the accent fill and delete is marked');
  const press = key => document.listeners.get('keydown')({ key, preventDefault() {} });
  press('ArrowDown'); assert.equal(document.activeElement, rename);
  press('ArrowDown'); assert.equal(document.activeElement, remove, 'a disabled entry is skipped');
  press('ArrowDown'); assert.equal(document.activeElement, open);
  press('End'); assert.equal(document.activeElement, remove);
  press('Home'); assert.equal(document.activeElement, open);
  press('Escape');
  assert.equal(document.body.children.length, 0);
  assert.equal(document.activeElement, invoker, 'Escape gives the focus back');
  assert.equal(document.listeners.size, 0, 'nothing is left listening');

  // The Map draws itself again while the menu is open, so the focus goes back to the control that now stands where the old one did.
  const old = document.createElement('button'), fresh = document.createElement('button');
  old.setAttribute('data-unit-id', 'a:b'); old.isConnected = false; fresh.setAttribute('data-unit-id', 'a:b');
  document.live.set('[data-unit-id="a:b"]', fresh);
  old.focus();
  openContextMenu(document, { x: 1, y: 1, label: 'r', items: [{ id: 'open', label: 'Open', run: () => {} }] });
  document.listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
  assert.equal(document.activeElement, fresh);
  invoker.focus();
  const second = openContextMenu(document, { x: 1, y: 1, label: 'x', items: [{ id: 'rename', label: 'Rename', run: () => ran.push('rename') }] });
  openContextMenu(document, { x: 1, y: 1, label: 'y', items: [{ id: 'open', label: 'Open', run: () => ran.push('open') }] });
  assert.equal(document.body.children.length, 1, 'one menu at a time');
  assert.equal(second.menu.parent, null);
  document.body.children[0].children[0].handlers.get('click')();
  assert.deepEqual(ran, ['open']);
  assert.equal(document.body.children.length, 0, 'a choice closes the menu');
  const third = openContextMenu(document, { x: 1, y: 1, label: 'z', items: [{ id: 'open', label: 'Open', run: () => ran.push('again') }] });
  document.listeners.get('pointerdown')({ target: document.body });
  assert.equal(document.body.children.length, 0, 'a click elsewhere closes it');
  void third;
  assert.deepEqual(ran, ['open']);
});

test('agents that belong to no cluster stand in the Overseer row and never on a box', () => {
  const { units, groups } = box(3);
  const overseer = { ...unit('root:overseer', 'overseer', 'overseer'), scope: { kind: 'root' } };
  const adjutant = unit('root:adjutant', 'adjutant', 'adjutant');
  const helper = unit('root:helper', 'helper', 'helper');
  const all = [...units, overseer, adjutant, helper];
  const { positions } = placeUnits(all, {}, groups);
  for (const id of [overseer.id, adjutant.id, helper.id]) assert.ok(positions[id], `${id} is placed`);
  assert.equal(positions[adjutant.id].y, positions[overseer.id].y);
  assert.notEqual(positions[adjutant.id].x, positions[helper.id].x);
  const frames = clusterFrames(groups, {}, null, all);
  for (const id of [adjutant.id, helper.id]) {
    const cell = cellOf(positions[id]);
    for (const frame of frames) assert.equal(overlaps(cell, frame.bounds), false, `${id} clears ${frame.group.title}`);
  }
});

test('a cluster whose agents are gone shrinks to its empty size once the unit list is known', () => {
  const declared = Array.from({ length: 39 }, (_, index) => `project:Nebula:executor-${index}`);
  const groups = [cluster('repo-Nebula', 'Nebula', null, declared)];
  const waiting = clusterFrames(groups, {}, null, undefined)[0].bounds;
  const known = clusterFrames(groups, {}, null, [])[0].bounds;
  assert.ok(known.h < waiting.h && known.w <= waiting.w, 'an empty loaded list does not keep room for the 39 archived agents');
  assert.ok(known.h < CELL_H * 2, 'the empty box is a small chip-sized frame');
});

const apart = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);

test('no agent outside a box stands under another; a saved place that is clear stays and one that is not moves to a free cell', () => {
  const { units: members, groups } = box(2);
  const overseer = unit('root:overseer', 'overseer', 'overseer');
  const free = ['p', 'q', 'r', 's'].map(name => unit(`root:${name}`, name, 'agent'));
  const all = [...members, overseer, ...free];
  const frames = clusterFrames(groups, {}, null, all);
  const outside = ids => ids.map(id => placed.positions[id]);
  const stand = { x: 9000, y: -9000 };
  // Two agents saved at the same point: the first keeps it, the second moves; a third saved clear of both stays.
  let placed = placeUnits(all, { nodes: { 'root:p': stand, 'root:q': stand, 'root:r': { x: 9400, y: -9000 } }, groups: {} }, groups);
  assert.deepEqual(placed.positions['root:p'], stand);
  assert.deepEqual(placed.positions['root:r'], { x: 9400, y: -9000 });
  const ids = [overseer.id, ...free.map(item => item.id)];
  for (const [index, point] of outside(ids).entries()) for (const other of outside(ids).slice(index + 1)) assert.ok(apart(point, other) >= 96, 'every pair outside a box is at least 96 apart');
  assert.ok(apart(placed.positions['root:q'], stand) >= 96);
  for (const id of ids) for (const frame of frames) assert.equal(overlaps(cellOf(placed.positions[id]), frame.bounds), false, `${id} clears ${frame.group.title}`);
  // A saved place equal to the Overseer's moves.
  const home = placeUnits(all, { nodes: {}, groups: {} }, groups).positions[overseer.id];
  placed = placeUnits(all, { nodes: { 'root:p': { ...home } }, groups: {} }, groups);
  assert.deepEqual(placed.positions[overseer.id], home);
  assert.ok(apart(placed.positions['root:p'], home) >= 96, 'a saved agent on the Overseer moves off it');
  // The row is anchored on the Overseer where it stands, and no new cell is one a kept place already holds.
  const kept = { x: 5000, y: 5000 };
  placed = placeUnits(all, { nodes: { [overseer.id]: kept, 'root:s': { x: kept.x + CELL_W, y: kept.y } }, groups: {} }, groups);
  assert.deepEqual(placed.positions[overseer.id], kept, 'a saved Overseer that clears every box is kept');
  assert.deepEqual(placed.positions['root:s'], { x: kept.x + CELL_W, y: kept.y }, 'a saved place that is clear stays');
  assert.deepEqual(placed.positions['root:p'], { x: kept.x + CELL_W * 2, y: kept.y }, 'the row starts beside the kept Overseer and skips the cell a kept place holds');
  for (const [index, point] of outside(ids).entries()) for (const other of outside(ids).slice(index + 1)) assert.ok(apart(point, other) >= 96);
});

test('the Map marks what is picked in the Hierarchy: a frame or chip, a tick in place of the glyph, the ring of a selected unit', () => {
  const groups = [cluster('a', 'alpha', null, ['a1']), cluster('b', 'beta', null, ['b1']), cluster('empty', 'empty')];
  const units = [unit('a1', 'a-one', 'executor', 'a'), unit('b1', 'b-one', 'executor', 'b')];
  const map = createMap({ units, groups, saved: { nodes: {}, groups: {} } }), surface = host();
  const zone = id => surface.children[0].children.find(child => child.getAttribute('data-group-zone') === id).getAttribute('class');
  const glyph = id => titleOf(surface, id).children[0].children[0].children[0].getAttribute('d');
  const node = id => nodeButtons(surface).find(button => button.getAttribute('data-unit-id') === id).className;
  renderMap(surface.ownerDocument, surface, map, {});
  const plain = glyph('a');
  assert.ok(!zone('a').includes('is-picked') && !node('a1').includes('is-picked'), 'nothing is picked by default');
  map.picked = new Set(['cluster:a', 'cluster:empty', 'a1']);
  renderMap(surface.ownerDocument, surface, map, {});
  assert.ok(zone('a').includes('is-picked') && zone('empty').includes('is-picked') && zone('empty').includes('is-mini'), 'a frame and a chip are marked');
  assert.ok(!zone('b').includes('is-picked'));
  assert.equal(glyph('a'), 'M5 12.5l4.5 4.5L19 7', 'a picked cluster shows a tick in place of its glyph');
  assert.equal(glyph('empty'), 'M5 12.5l4.5 4.5L19 7');
  assert.equal(glyph('b'), plain);
  assert.ok(node('a1').includes('is-picked') && !node('a1').includes('is-selected'), 'a picked unit has its own mark');
  assert.ok(!node('b1').includes('is-picked'));
  map.picked = new Set();
  renderMap(surface.ownerDocument, surface, map, {});
  assert.ok(!zone('a').includes('is-picked') && glyph('a') === plain);
});

test('a frame the person placed on top of another is drawn clear of it, with what it holds; its stored place is not rewritten', () => {
  const a = cluster('a', 'alpha', null, ['a1']), b = cluster('b', 'beta', null, ['b1']), inner = cluster('bb', 'beta-inner', 'b', ['b2']);
  const units = [unit('a1', 'a-one', 'executor', 'a'), unit('b1', 'b-one', 'executor', 'b'), unit('b2', 'b-two', 'executor', 'bb')];
  const frameOf = (frames, id) => frames.find(frame => frame.group.id === id);
  const grow = rect => ({ x: rect.x - 28, y: rect.y - 28, w: rect.w + 56, h: rect.h + 56 });
  const stored = { nodes: {}, groups: { 'cluster:a': { x: 100, y: 100 }, 'cluster:b': { x: 140, y: 150 }, 'cluster:bb': { x: 170, y: 260 } } };
  const before = structuredClone(stored);
  const frames = layoutClusters([a, b, inner], stored, null, units).frames;
  const first = frameOf(frames, 'a'), second = frameOf(frames, 'b'), child = frameOf(frames, 'bb');
  assert.deepEqual(first.anchor, { x: 100, y: 100 }, 'the first frame in the order keeps its stored place');
  assert.equal(overlaps(grow(first.bounds), second.bounds), false, 'the later frame is drawn clear of it');
  assert.equal(second.anchor.x, 140, 'it is pushed down, not sideways');
  assert.deepEqual(stored, before, 'the stored places are not rewritten');
  assert.deepEqual({ x: child.anchor.x - second.anchor.x, y: child.anchor.y - second.anchor.y }, { x: 30, y: 110 }, 'a frame stored inside it keeps its place inside it');
  const placed = placeUnits(units, stored, [a, b, inner]);
  assert.ok(frameHolds(placed.positions.b2, 21, child.bounds), 'what the frame holds is drawn with it');
  // A frame that does not stand on another keeps its stored place.
  const apartFrames = layoutClusters([a, b, inner], { nodes: {}, groups: { ...stored.groups, 'cluster:b': { x: 5000, y: 150 }, 'cluster:bb': { x: 5030, y: 260 } } }, null, units).frames;
  assert.deepEqual(frameOf(apartFrames, 'b').anchor, { x: 5000, y: 150 });
  assert.deepEqual(frameOf(apartFrames, 'bb').anchor, { x: 5030, y: 260 });
});
