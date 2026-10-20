const LIMIT = 100000;
const CLEARANCE = 64;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function groupKeyForUnit(unit, byIdMap = new Map()) {
  if (!unit || duplicateOverseer(unit, byIdMap)) return null;
  if (unit.role === "genesis" || unit.role === "incubator") return "services";
  if (lineUnit(unit)) return null;
  const overlord = overlordAncestor(unit, byIdMap);
  if (overlord) return `lead:${overlord.id}`;
  if (unit.scope?.kind === "project") return `project:${unit.scope.name}`;
  if (unit.scope?.kind === "environment") return `env:${unit.scope.name}`;
  return "root";
}

export function groupOriginsFor(units, saved) {
  const layout = saved.layout ?? saved ?? {};
  const nodes = layout.nodes ?? {};
  const groups = layout.groups ?? {};
  const indexed = new Map(units.map((unit) => [unit.id, unit]));
  const keys = new Set();
  for (const unit of units) {
    if (nodes[unit.id] || lineUnit(unit)) continue;
    const key = groupKeyForUnit(unit, indexed);
    if (key) keys.add(key);
  }
  const origins = {};
  const reserved = [];
  for (const group of Object.values(groups)) {
    if (Number.isFinite(group?.x) && Number.isFinite(group?.y)) reserved.push({ x: group.x, y: group.y });
  }
  const fallback = [];
  for (const key of [...keys].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    const persisted = groups[key];
    if (persisted && Number.isFinite(persisted.x) && Number.isFinite(persisted.y) && scopeKey(key)) {
      origins[key] = { x: persisted.x, y: persisted.y };
      continue;
    }
    if (key.startsWith("lead:")) {
      const lead = nodes[key.slice(5)];
      if (lead && Number.isFinite(lead.x) && Number.isFinite(lead.y)) {
        origins[key] = { x: lead.x, y: lead.y };
        reserved.push(origins[key]);
        continue;
      }
    }
    fallback.push(key);
  }
  let slot = 0;
  for (const key of fallback) {
    let point = gridOrigin(slot);
    while (tooClose(point, reserved, CLEARANCE) && slot < 300) {
      slot += 1;
      point = gridOrigin(slot);
    }
    origins[key] = point;
    reserved.push(point);
    slot += 1;
  }
  return origins;
}

export function initialPositions(units, saved, groupOrigins) {
  const positions = structuredClone(saved.nodes ?? {});
  pinLine(units, positions);
  const buckets = new Map();
  const indexed = new Map(units.map((unit) => [unit.id, unit]));
  for (const unit of [...units].sort(byId)) {
    if (positions[unit.id]) continue;
    const key = groupKeyForUnit(unit, indexed);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(unit);
  }
  const reserved = Object.values(positions).filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  for (const [key, members] of [...buckets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const origin = groupOrigins[key];
    for (const unit of members) {
      let index = 0;
      let point = ringPoint(origin, index);
      while (tooClose(point, reserved, CLEARANCE) && index < 64) {
        index += 1;
        point = ringPoint(origin, index);
      }
      positions[unit.id] = point;
      reserved.push(point);
    }
  }
  return positions;
}

const NODE_RADIUS = { overseer: 30, overlord: 25 };
const nodeRadius = unit => Object.hasOwn(NODE_RADIUS, unit.role) ? NODE_RADIUS[unit.role] : 21;
const canonicalOverseer = unit => unit.role === 'overseer' && unit.unit === 'overseer' && unit.scope?.kind === 'root';
// A brand-new unit is stored at the origin. That point is not a chosen place on the Map.
const chosenPoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y) && !(point.x === 0 && point.y === 0);

export function frameHolds(point, radius, bounds) {
  return point.x - radius >= bounds.x + 8 && point.x + radius <= bounds.x + bounds.w - 8
    && point.y - radius >= bounds.y + 8 && point.y + radius + 22 <= bounds.y + bounds.h - 4;
}

const insideFrame = frameHolds;

// The circle, its ring and its name need this much room around a unit. A saved Overseer is kept only where it clears every frame.
function clearsFrames(point, radius, frames, pad = 12) {
  const box = { x: point.x - radius - pad, y: point.y - radius - pad, w: radius * 2 + pad * 2, h: radius * 2 + pad * 2 + 52 };
  return !frames.some(frame => rectsOverlap(box, frame.bounds));
}

// The Overseer coordinates every cluster, so it sits centred above the clusters the layout placed.
function overseerPoint(frames) {
  if (!frames.length) return { x: 380, y: 409 };
  const left = Math.min(...frames.map(frame => frame.bounds.x)), right = Math.max(...frames.map(frame => frame.bounds.x + frame.bounds.w));
  return { x: Math.round((left + right) / 2), y: Math.round(Math.min(...frames.map(frame => frame.bounds.y)) - 110) };
}

const LOOSE_PER_ROW = 8;
const looseSlot = (overseer, index) => ({ x: overseer.x + CELL_W * (index % LOOSE_PER_ROW + 1), y: overseer.y - CELL_H * Math.floor(index / LOOSE_PER_ROW) });

export function placeUnits(units, saved, clusters = []) {
  const layout = saved.layout ?? saved ?? {};
  if (clusters.length) {
    const { frames, slots, homes, hidden, overseer } = layoutClusters(clusters, layout, null, units);
    const positions = structuredClone(layout.nodes ?? {});
    delete positions['root:master'];
    for (const id of hidden) delete positions[id];
    const origins = Object.fromEntries(frames.map(frame => [`cluster:${frame.group.id}`, { x: frame.bounds.x, y: frame.bounds.y }]));
    const byFrame = new Map(frames.map(frame => [frame.group.id, frame]));
    for (const unit of units) {
      if (unit.role === 'master' || unit.removed || !homes.has(unit.id)) continue;
      const frame = byFrame.get(homes.get(unit.id)), current = layout.nodes?.[unit.id];
      // A place the person chose stays while it is inside the frame; every other unit takes its own cell of the grid.
      positions[unit.id] = chosenPoint(current) && insideFrame(current, nodeRadius(unit), frame.bounds) ? { x: current.x, y: current.y } : { ...slots.get(unit.id) };
    }
    for (const unit of units) {
      if (unit.role === 'master' || unit.removed || homes.has(unit.id) || !canonicalOverseer(unit)) continue;
      const current = layout.nodes?.[unit.id];
      positions[unit.id] = chosenPoint(current) && clearsFrames(current, nodeRadius(unit), frames) ? { x: current.x, y: current.y } : { ...overseer };
    }
    // A unit that belongs to no cluster, such as a new root agent, stands beside the Overseer instead of being left out;
    // the row wraps upward, away from the boxes below the Overseer.
    let next = 0;
    for (const unit of units) {
      if (unit.role === 'master' || unit.removed || homes.has(unit.id) || canonicalOverseer(unit) || hidden.has(unit.id)) continue;
      const current = layout.nodes?.[unit.id];
      positions[unit.id] = chosenPoint(current) && clearsFrames(current, nodeRadius(unit), frames) ? { x: current.x, y: current.y } : looseSlot(overseer, next++);
    }
    return { origins, positions };
  }
  const origins = groupOriginsFor(units, layout);
  return { origins, positions: initialPositions(units, layout, origins) };
}

export const toWorld = (client, rect, view) => ({
  x: (client.x - rect.left - view.x) / view.zoom,
  y: (client.y - rect.top - view.y) / view.zoom,
});

export function toScreen(world, rect, view) {
  return {
    x: world.x * view.zoom + view.x + rect.left,
    y: world.y * view.zoom + view.y + rect.top,
  };
}

// The slop is in screen pixels: a fingertip needs more of it than a mouse pointer.
export function hitNode(point, nodes, zoom, slop = 6) {
  return [...nodes].reverse().find((node) =>
    Math.hypot(point.x - node.x, point.y - node.y) <= node.radius + slop / zoom) ?? null;
}

export function marqueeIds(a, b, nodes) {
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  return nodes.filter((n) => n.x >= left && n.x <= right && n.y >= top && n.y <= bottom)
    .map((n) => n.id);
}

export function edgeEndpoints(source, target) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy) || 1;
  return {
    x1: source.x + (dx / distance) * source.radius,
    y1: source.y + (dy / distance) * source.radius,
    x2: target.x - (dx / distance) * target.radius,
    y2: target.y - (dy / distance) * target.radius,
  };
}

export function fitBounds(points, rect, padding = 48) {
  if (!points.length) return { x: 0, y: 0, zoom: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const zoom = Math.min(2.5, Math.min((rect.width - padding * 2) / width, (rect.height - padding * 2) / height));
  return {
    x: (rect.width - width * zoom) / 2 - minX * zoom,
    y: (rect.height - height * zoom) / 2 - minY * zoom,
    zoom,
  };
}

export function scopeCollapsed(saved, key) {
  if (!scopeKey(key)) return false;
  return Boolean(saved?.groups?.[key]?.collapsed);
}

function pinLine(units, positions) {
  const master = units.find((unit) => unit.role === "master" && unit.scope?.kind === "root");
  const overseer = units.find((unit) => unit.role === "overseer" && unit.unit === "overseer" && unit.scope?.kind === "root");
  const beside = units.filter((unit) => unit.role === "adjutant" || unit.role === "executive").sort(byId);
  if (master && !positions[master.id]) positions[master.id] = { x: 380, y: 56 };
  if (overseer && !positions[overseer.id]) positions[overseer.id] = { x: 380, y: 409 };
  beside.forEach((unit, index) => {
    if (!positions[unit.id]) positions[unit.id] = { x: 380 + (index % 2 === 0 ? -140 : 140), y: 160 };
  });
}

function lineUnit(unit) {
  if (unit.role === "master" && unit.scope?.kind === "root") return true;
  if (unit.role === "overseer" && unit.unit === "overseer" && unit.scope?.kind === "root") return true;
  return unit.role === "adjutant" || unit.role === "executive";
}

function duplicateOverseer(unit, byIdMap) {
  if (unit.role !== "overseer") return false;
  if (unit.unit === "overseer" && unit.scope?.kind === "root") {
    const first = [...byIdMap.values()].find((item) => item.role === "overseer" && item.unit === "overseer" && item.scope?.kind === "root");
    return first ? first.id !== unit.id : false;
  }
  return true;
}

function overlordAncestor(unit, byIdMap) {
  if (unit.role === "overlord") return unit;
  const seen = new Set();
  let current = unit;
  while (current?.leadId) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    const lead = byIdMap.get(current.leadId);
    if (!lead || seen.has(lead.id)) return null;
    if (lead.role === "overlord") return lead;
    current = lead;
  }
  return null;
}

function gridOrigin(slot) {
  return { x: 220 + (slot % 3) * 360, y: 360 + Math.floor(slot / 3) * 360 };
}

function ringPoint(origin, index) {
  const ring = Math.floor(index / 8) + 1;
  const angle = (index % 8) * Math.PI / 4 - Math.PI / 2;
  return clampPoint({
    x: origin.x + Math.cos(angle) * ring * 96,
    y: origin.y + Math.sin(angle) * ring * 96,
  });
}

function tooClose(point, reserved, gap) {
  return reserved.some((item) => Math.hypot(item.x - point.x, item.y - point.y) < gap);
}

function scopeKey(key) {
  return key.startsWith("project:") || key.startsWith("env:");
}

function clampPoint(point) {
  return {
    x: Math.min(LIMIT, Math.max(-LIMIT, point.x)),
    y: Math.min(LIMIT, Math.max(-LIMIT, point.y)),
  };
}

export function personalGroupBounds(memberIds, nodes, padding = 24) {
  const members = new Set(memberIds);
  const selected = nodes.filter((node) => members.has(node.id));
  if (!selected.length) return null;
  const left = Math.min(...selected.map((node) => node.x - node.radius));
  const right = Math.max(...selected.map((node) => node.x + node.radius));
  const top = Math.min(...selected.map((node) => node.y - node.radius));
  const bottom = Math.max(...selected.map((node) => node.y + node.radius + 24));
  return { x: left - padding, y: top - padding,
    w: right - left + padding * 2, h: bottom - top + padding * 2 };
}

function rectsOverlap(left, right) {
  return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

// ---- Cluster layout ---------------------------------------------------------------------------------------
// Sizes are world units. A unit owns one cell: its circle on top, its own name under it. A frame is sized from what it
// holds, its title sits in a header inside the frame, and child frames are packed in rows below that header.
export const CELL_W = 160;
export const CELL_H = 104;
export const CELL_CENTER = 44;
export const FRAME_PAD = 20;
export const FRAME_HEAD = 44;
const FRAME_GAP = 24;
const ROOT_GAP = 56;
const CHIP_H = 34;
const MAX_COLUMNS = 8;
const FRAME_ASPECT = 1.35;
const ROOT_ASPECT = 1.6;

const names = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const byName = (a, b) => names.compare(String(a.unit ?? a.id), String(b.unit ?? b.id)) || byId(a, b);
const byTitle = (a, b) => names.compare(String(a.title ?? ''), String(b.title ?? '')) || byId(a, b);
const agentUnit = unit => unit.role !== 'master' && unit.role !== 'overseer' && !unit.removed;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// The text of a name has its cell's width, less the plate around it.
export const LABEL_TEXT_WIDTH = CELL_W - 24;

// A name that does not fit loses its middle, so the end that tells similar names apart stays visible.
export function fitLabel(text, width, measure) {
  const value = String(text ?? '');
  if (value.length < 2 || measure(value) <= width) return value;
  let low = 1, high = value.length - 1, best = '\u2026';
  while (low <= high) {
    const keep = Math.floor((low + high) / 2), head = Math.ceil(keep * 0.55), tail = keep - head;
    const candidate = value.slice(0, head) + '\u2026' + (tail ? value.slice(value.length - tail) : '');
    if (measure(candidate) <= width) { best = candidate; low = keep + 1; } else high = keep - 1;
  }
  return best;
}

function storedFrame(saved, id) {
  const stored = saved?.groups?.[`cluster:${id}`];
  if (!Number.isFinite(stored?.x) || !Number.isFinite(stored?.y)) return null;
  const w = stored.width ?? stored.w, h = stored.height ?? stored.h;
  return { x: stored.x, y: stored.y, ...(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : {}) };
}

// The width a frame needs so its title is not cut: the glyph, the name and the count of folders inside.
function titleWidth(group, count) {
  return Math.ceil(30 + (String(group.title ?? '').length + (count ? String(count).length + 2 : 0)) * 7.2);
}

// One grid per frame: Overlords in a row of their own on top, every other agent below in columns sized to the member count.
function unitGrid(members, ghosts = 0) {
  const leads = members.filter(unit => unit.role === 'overlord').sort(byName);
  const rest = members.filter(unit => unit.role !== 'overlord').sort(byName);
  const lead = leads.length, count = rest.length + ghosts;
  if (!lead && !count) return { w: 0, h: 0, slots: [] };
  let best = null;
  for (let columns = 1; columns <= MAX_COLUMNS; columns += 1) {
    if (columns > Math.max(lead, count, 1) && columns > 1) break;
    const leadColumns = Math.min(lead, columns), restColumns = Math.min(count, columns);
    const leadRows = lead ? Math.ceil(lead / leadColumns) : 0, restRows = count ? Math.ceil(count / restColumns) : 0;
    const w = Math.max(leadColumns, restColumns) * CELL_W, h = (leadRows + restRows) * CELL_H;
    const score = Math.abs(Math.log((w + FRAME_PAD * 2) / (FRAME_HEAD + h + FRAME_PAD) / FRAME_ASPECT));
    if (!best || score < best.score - 1e-9) best = { columns, leadColumns, restColumns, leadRows, restRows, w, h, score };
  }
  const slots = [];
  leads.forEach((unit, index) => {
    const row = Math.floor(index / best.leadColumns), inRow = Math.min(best.leadColumns, lead - row * best.leadColumns);
    slots.push({ unit, x: (best.w - inRow * CELL_W) / 2 + (index % best.leadColumns) * CELL_W + CELL_W / 2, y: row * CELL_H + CELL_CENTER });
  });
  rest.forEach((unit, index) => {
    slots.push({ unit, x: (best.w - best.restColumns * CELL_W) / 2 + (index % best.restColumns) * CELL_W + CELL_W / 2,
      y: (best.leadRows + Math.floor(index / best.restColumns)) * CELL_H + CELL_CENTER });
  });
  return { w: best.w, h: best.h, slots };
}

function shelves(items, width, gap) {
  const placed = [];
  let x = 0, y = 0, rowHeight = 0, right = 0;
  for (const node of items) {
    if (x > 0 && x + node.w > width) { y += rowHeight + gap; x = 0; rowHeight = 0; }
    placed.push({ node, x, y });
    right = Math.max(right, x + node.w);
    x += node.w + gap;
    rowHeight = Math.max(rowHeight, node.h);
  }
  return { placed, w: right, h: y + rowHeight };
}

// Rows of frames, tallest first, in the width that gives the roundest block with the least empty space.
function packFrames(nodes, gap, aspect) {
  if (!nodes.length) return { placed: [], w: 0, h: 0 };
  const items = [...nodes].sort((a, b) => b.h - a.h || b.w - a.w || byTitle(a.group, b.group));
  const widest = Math.max(...items.map(node => node.w)), total = items.reduce((sum, node) => sum + node.w, 0) + gap * (items.length - 1);
  const area = items.reduce((sum, node) => sum + node.w * node.h, 0);
  const widths = new Set([widest, total]);
  for (let step = 1; step < 32; step += 1) widths.add(Math.round(widest + (total - widest) * step / 32));
  let best = null;
  for (const width of [...widths].sort((a, b) => a - b)) {
    const result = shelves(items, width, gap);
    const score = Math.abs(Math.log(result.w / Math.max(1, result.h) / aspect)) + (1 - area / Math.max(1, result.w * result.h));
    if (!best || score < best.score - 1e-9) best = { ...result, score };
  }
  return best;
}

// A collapsed cluster is one chip with the number of agents inside; what it holds is not drawn.
function collapseFrame(group, context) {
  const all = [group];
  for (let index = 0; index < all.length; index += 1) all.push(...(context.children.get(all[index].id) ?? []));
  const units = all.flatMap(item => context.members.get(item.id) ?? []);
  for (const unit of units) context.hidden.add(unit.id);
  return { group, compact: true, collapsed: true, inside: units.length, w: clamp(titleWidth(group, units.length) + 8, 76, 320), h: CHIP_H, kids: [], placed: [], slots: [] };
}

function measureFrame(group, context) {
  if (context.saved?.groups?.[`cluster:${group.id}`]?.collapsed === true) return collapseFrame(group, context);
  const kids = (context.children.get(group.id) ?? []).map(child => measureFrame(child, context));
  const members = context.members.get(group.id) ?? [];
  const ghosts = context.known ? 0 : Math.max(0, (group.members ?? []).length - members.length);
  const title = titleWidth(group, kids.length);
  if (!members.length && !ghosts && !kids.length) return { group, compact: true, w: clamp(title + 8, 76, 280), h: CHIP_H, kids: [], placed: [], slots: [] };
  const grid = unitGrid(members, ghosts), packed = packFrames(kids, FRAME_GAP, FRAME_ASPECT);
  const w = Math.max(Math.max(grid.w, packed.w) + FRAME_PAD * 2, title + FRAME_PAD);
  const between = grid.h && packed.h ? FRAME_GAP : 0;
  const slots = grid.slots.map(slot => ({ unit: slot.unit, x: (w - grid.w) / 2 + slot.x, y: FRAME_HEAD + slot.y }));
  const left = Math.max(FRAME_PAD, (w - packed.w) / 2), top = FRAME_HEAD + grid.h + between;
  return { group, compact: false, w, h: top + packed.h + FRAME_PAD, kids, slots,
    placed: packed.placed.map(item => ({ node: item.node, x: left + item.x, y: top + item.y })) };
}

function resolveFrame(node, origin, context) {
  const stored = storedFrame(context.saved, node.group.id);
  const anchor = stored ? { x: stored.x, y: stored.y } : origin;
  const frame = { group: node.group, anchor, bounds: { x: anchor.x, y: anchor.y, w: stored?.w ?? node.w, h: stored?.h ?? node.h },
    compact: node.compact, collapsed: node.collapsed === true, folder: node.kids.length > 0 || node.group.link?.kind === 'folder' || (context.children.get(node.group.id)?.length ?? 0) > 0,
    count: node.collapsed ? node.inside : node.kids.length, focused: node.group.id === context.focusedId };
  context.frames.push(frame);
  for (const slot of node.slots) {
    context.slots.set(slot.unit.id, { x: anchor.x + slot.x, y: anchor.y + slot.y });
    context.homes.set(slot.unit.id, node.group.id);
  }
  const inside = node.placed.map(item => resolveFrame(item.node, { x: anchor.x + item.x, y: anchor.y + item.y }, context));
  // A child dragged out of its folder stretches the folder, so the folder still holds it.
  if (stored?.w === undefined) for (const child of inside) {
    const box = frame.bounds, left = Math.min(box.x, child.bounds.x - FRAME_PAD), top = Math.min(box.y, child.bounds.y - FRAME_HEAD);
    const right = Math.max(box.x + box.w, child.bounds.x + child.bounds.w + FRAME_PAD), bottom = Math.max(box.y + box.h, child.bounds.y + child.bounds.h + FRAME_PAD);
    frame.bounds = { x: left, y: top, w: right - left, h: bottom - top };
  }
  return frame;
}

// Each unit belongs to one cluster: the one it names, otherwise the first that lists it.
function assignMembers(active, units) {
  const ids = new Set(active.map(cluster => cluster.id)), members = new Map(active.map(cluster => [cluster.id, []]));
  for (const unit of [...units].filter(agentUnit).sort(byId)) {
    const home = ids.has(unit.clusterId) ? unit.clusterId : active.find(cluster => cluster.members?.includes(unit.id))?.id;
    if (home) members.get(home).push(unit);
  }
  return members;
}

// Units not loaded yet (undefined) keep room for a cluster's declared members; a loaded list, even an empty one, is the truth,
// so a cluster whose agents were archived shrinks to what it holds.
export function layoutClusters(clusters, saved = {}, focusedId = null, units = undefined) {
  const known = Array.isArray(units);
  units = units ?? [];
  const active = clusters.filter(cluster => !cluster.deleted);
  const ids = new Set(active.map(cluster => cluster.id)), children = new Map(active.map(cluster => [cluster.id, []])), roots = [];
  for (const cluster of [...active].sort(byTitle)) (ids.has(cluster.parentId) && cluster.parentId !== cluster.id ? children.get(cluster.parentId) : roots).push(cluster);
  const context = { saved, focusedId, children, members: assignMembers(active, units), known, frames: [], slots: new Map(), homes: new Map(), hidden: new Set() };
  const nodes = roots.map(root => measureFrame(root, context));
  const loose = nodes.filter(node => !storedFrame(saved, node.group.id)), fixed = nodes.filter(node => storedFrame(saved, node.group.id));
  const packed = packFrames(loose, ROOT_GAP, ROOT_ASPECT);
  const origins = new Map(packed.placed.map(item => [item.node.group.id, { x: item.x, y: item.y }]));
  // A frame the person placed stays put; a frame the layout placed moves clear of it.
  const boxes = new Map([...fixed.map(node => { const stored = storedFrame(saved, node.group.id); return [node.group.id, { x: stored.x, y: stored.y, w: stored.w ?? node.w, h: stored.h ?? node.h }]; }),
    ...packed.placed.map(item => [item.node.group.id, { x: item.x, y: item.y, w: item.node.w, h: item.node.h }])]);
  for (const item of packed.placed) {
    const box = boxes.get(item.node.group.id);
    for (let guard = 0; guard < 64; guard += 1) {
      const other = [...boxes].find(([id, rect]) => id !== item.node.group.id && rectsOverlap({ x: box.x - ROOT_GAP / 2, y: box.y - ROOT_GAP / 2, w: box.w + ROOT_GAP, h: box.h + ROOT_GAP }, rect))?.[1];
      if (!other) break;
      box.y = other.y + other.h + ROOT_GAP;
    }
    origins.set(item.node.group.id, { x: box.x, y: box.y });
  }
  const rootFrames = nodes.map(node => resolveFrame(node, origins.get(node.group.id) ?? { x: 0, y: 0 }, context));
  const placedByLayout = rootFrames.filter(frame => !storedFrame(saved, frame.group.id));
  return { frames: context.frames, slots: context.slots, homes: context.homes, hidden: context.hidden, overseer: overseerPoint(placedByLayout.length ? placedByLayout : rootFrames) };
}

// Flying the camera into a folder must not move that folder: a larger frame would cover the clusters beside it.
export function clusterFrames(clusters, saved = {}, focusedId = null, units = undefined) {
  return layoutClusters(clusters, saved, focusedId, units).frames;
}
