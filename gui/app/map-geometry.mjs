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

function circleHits(point, radius, bounds, pad = 8) {
  const left = bounds.x - pad, right = bounds.x + bounds.w + pad, top = bounds.y - pad, bottom = bounds.y + bounds.h + pad;
  const x = Math.max(left, Math.min(point.x, right)), y = Math.max(top, Math.min(point.y, bottom));
  return (point.x - x) ** 2 + (point.y - y) ** 2 < radius ** 2;
}

function insideFrame(point, radius, bounds) {
  return point.x - radius >= bounds.x + 8 && point.x + radius <= bounds.x + bounds.w - 8
    && point.y - radius >= bounds.y + 8 && point.y + radius + 22 <= bounds.y + bounds.h - 4;
}

function overseerPoint(frames) {
  const preferred = { x: 380, y: 409 };
  const radius = NODE_RADIUS.overseer;
  if (!frames.some(frame => circleHits(preferred, radius, frame.bounds))) return preferred;
  let point = { x: Math.max(0, ...frames.map(frame => frame.bounds.x + frame.bounds.w)) + radius + 48, y: preferred.y };
  while (frames.some(frame => circleHits(point, radius, frame.bounds))) point = { x: point.x + 48, y: point.y };
  return point;
}

function memberPoint(bounds, executorIndex, taken, radius) {
  const inset = Math.min(90, Math.max(radius + 8, bounds.w / 2 - 8));
  for (let row = Math.floor(executorIndex / 2); row < 8; row += 1) {
    const point = { x: bounds.x + (executorIndex % 2 ? bounds.w - inset : inset), y: bounds.y + Math.min(160, bounds.h * 0.62) + row * 72 };
    if (insideFrame(point, radius, bounds) && taken.every(other => Math.hypot(point.x - other.x, point.y - other.y) >= radius + other.radius + 8)) return point;
  }
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

export function placeUnits(units, saved, clusters = []) {
  const layout = saved.layout ?? saved ?? {};
  if (clusters.length) {
    const frames = clusterFrames(clusters, layout, null, units);
    const positions = structuredClone(layout.nodes ?? {});
    delete positions['root:master'];
    const origins = Object.fromEntries(frames.map(frame => [`cluster:${frame.group.id}`, { x: frame.bounds.x, y: frame.bounds.y }]));
    const placed = new Set();
    for (const frame of frames) {
      const members = units.filter(unit => unit.role !== 'master' && unit.role !== 'overseer' && !unit.removed && !placed.has(unit.id)
        && (unit.clusterId === frame.group.id || !unit.clusterId && frame.group.members?.includes(unit.id)));
      members.sort((a, b) => (b.role === 'overlord') - (a.role === 'overlord') || byId(a, b));
      const taken = [];
      let executorIndex = 0;
      for (const unit of members) {
        placed.add(unit.id);
        const radius = nodeRadius(unit);
        const current = positions[unit.id];
        if (chosenPoint(current) && insideFrame(current, radius, frame.bounds)) { taken.push({ ...current, radius }); continue; }
        const lead = unit.role === 'overlord';
        const point = lead
          ? { x: frame.bounds.x + frame.bounds.w / 2, y: frame.bounds.y + Math.min(75, Math.max(radius + 8, frame.bounds.h * 0.32)) }
          : memberPoint(frame.bounds, executorIndex++, taken, radius);
        positions[unit.id] = point;
        taken.push({ ...point, radius });
      }
    }
    for (const unit of units) {
      if (unit.role === 'master' || unit.removed || placed.has(unit.id)) continue;
      if (!canonicalOverseer(unit)) continue;
      const current = positions[unit.id];
      if (!chosenPoint(current) || frames.some(frame => circleHits(current, nodeRadius(unit), frame.bounds))) positions[unit.id] = overseerPoint(frames);
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

export function hitNode(point, nodes, zoom) {
  return [...nodes].reverse().find((node) =>
    Math.hypot(point.x - node.x, point.y - node.y) <= node.radius + 6 / zoom) ?? null;
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

function storedBox(saved, id) {
  const stored = saved.groups?.[`cluster:${id}`];
  const w = stored?.width ?? stored?.w, h = stored?.height ?? stored?.h;
  if (![stored?.x, stored?.y, w, h].every(Number.isFinite)) return null;
  return { x: stored.x, y: stored.y, w, h };
}

function rectsOverlap(left, right) {
  return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

function shiftFrame(frame, dx, dy, frames, saved) {
  frame.bounds.x += dx;
  frame.bounds.y += dy;
  for (const child of frames) {
    if (child.group.parentId !== frame.group.id || storedBox(saved, child.group.id)) continue;
    shiftFrame(child, dx, dy, frames, saved);
  }
}

// Saved frames stay where they were put. An unsaved frame moves clear of the one it covers.
function separateRoots(roots, frames, saved) {
  const gap = 28;
  for (let pass = 0; pass < roots.length + 2; pass += 1) {
    let moved = false;
    for (let i = 0; i < roots.length; i += 1) for (let j = i + 1; j < roots.length; j += 1) {
      const earlier = roots[i], later = roots[j];
      if (!rectsOverlap(earlier.bounds, later.bounds)) continue;
      const lockEarlier = Boolean(storedBox(saved, earlier.group.id)), lockLater = Boolean(storedBox(saved, later.group.id));
      if (lockEarlier && lockLater) continue;
      const mover = lockEarlier ? later : lockLater ? earlier : later;
      const other = mover === earlier ? later : earlier;
      const dy = other.bounds.y + other.bounds.h + gap - mover.bounds.y;
      if (dy > 0) { shiftFrame(mover, 0, dy, frames, saved); moved = true; }
    }
    if (!moved) break;
  }
}

// Flying the camera into a folder must not move that folder: a larger frame would cover the clusters beside it.
export function clusterFrames(clusters, saved = {}, focusedId = null, units = []) {
  const active = clusters.filter(cluster => !cluster.deleted);
  const childrenOf = id => active.filter(group => group.parentId === id && active.some(parent => parent.id === id));
  const measure = group => {
    const agents = Math.max(group.members?.length ?? 0, units.filter(unit => unit.role !== 'master' && unit.role !== 'overseer' && !unit.removed
      && (unit.clusterId === group.id || group.members?.includes(unit.id))).length);
    if (!agents) return { w: 66, h: 24, compact: true };
    const rows = Math.max(1, Math.ceil(Math.max(0, agents - 1) / 2));
    return { w: 290, h: Math.max(230, 96 + rows * 84), compact: false };
  };
  const frames = [], packed = new Set();
  const pack = parent => {
    if (packed.has(parent.group.id)) return;
    packed.add(parent.group.id);
    const children = childrenOf(parent.group.id);
    let x = parent.bounds.x + 14, y = parent.bounds.y + 20, rowH = 0;
    const startX = x, limit = parent.bounds.x + parent.bounds.w - 14;
    for (const child of children) {
      const stored = storedBox(saved, child.id);
      const size = stored ? { w: stored.w, h: stored.h, compact: stored.w <= 80 && stored.h <= 40 } : measure(child);
      if (!stored && x > startX && x + size.w > limit) {
        x = startX;
        y += rowH + (rowH <= 24 ? 6 : 8);
        rowH = 0;
      }
      const frame = { group: child, bounds: stored ? { ...stored } : { x, y, w: size.w, h: size.h }, compact: Boolean(size.compact && !childrenOf(child.id).length),
        folder: childrenOf(child.id).length > 0 || child.link?.kind === 'folder', count: childrenOf(child.id).length, focused: child.id === focusedId };
      frames.push(frame);
      if (!stored) { rowH = Math.max(rowH, size.h); x += size.compact ? 72 : size.w + 14; }
      pack(frame);
    }
    if (!storedBox(saved, parent.group.id) && children.length) {
      const kids = frames.filter(frame => frame.group.parentId === parent.group.id);
      const right = Math.max(parent.bounds.x + parent.bounds.w, ...kids.map(frame => frame.bounds.x + frame.bounds.w + 14));
      const bottom = Math.max(parent.bounds.y + parent.bounds.h, ...kids.map(frame => frame.bounds.y + frame.bounds.h + 16));
      parent.bounds.w = right - parent.bounds.x;
      parent.bounds.h = bottom - parent.bounds.y;
    }
  };
  const roots = active.filter(group => !active.some(parent => parent.id === group.parentId));
  const folders = roots.filter(group => group.link?.kind === 'folder' || childrenOf(group.id).length);
  const loose = roots.filter(group => !folders.includes(group));
  let stackY = 260;
  for (const [index, group] of folders.entries()) {
    const stored = storedBox(saved, group.id);
    const width = index === 0 ? 318 : 300;
    const children = childrenOf(group.id);
    const columns = Math.max(1, Math.floor((width - 24) / 72));
    const minis = children.every(child => !storedBox(saved, child.id) && measure(child).compact);
    const height = minis ? Math.max(60, 36 + Math.ceil(children.length / columns) * 30) : 90;
    const frame = { group, bounds: stored ? { ...stored } : { x: index === 0 ? 8 : 444, y: index === 0 ? 320 : stackY, w: width, h: height },
      compact: false, folder: true, count: children.length, focused: group.id === focusedId };
    frames.push(frame);
    pack(frame);
    if (index > 0) stackY = frame.bounds.y + frame.bounds.h + 36;
  }
  separateRoots(folders.map(group => frames.find(frame => frame.group.id === group.id)), frames, saved);
  let looseY = Math.max(720, ...frames.filter(frame => folders.some(group => group.id === frame.group.id)).map(frame => frame.bounds.y + frame.bounds.h + 40), 0);
  for (const group of loose) {
    const stored = storedBox(saved, group.id);
    const size = measure(group);
    const unlinked = (group.link?.kind ?? 'none') === 'none' && size.compact;
    const bounds = stored ?? (unlinked ? { x: 290, y: looseY, w: 180, h: 70 } : { x: 40, y: looseY, w: Math.max(290, size.w), h: Math.max(230, size.h) });
    const frame = { group, bounds: { ...bounds }, compact: false, folder: group.link?.kind === 'folder', count: childrenOf(group.id).length, focused: group.id === focusedId };
    frames.push(frame);
    pack(frame);
    if (!stored) looseY = frame.bounds.y + frame.bounds.h + 40;
  }
  separateRoots(roots.map(group => frames.find(frame => frame.group.id === group.id)).filter(Boolean), frames, saved);
  return frames;
}
