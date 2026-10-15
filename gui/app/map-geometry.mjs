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

export function placeUnits(units, saved, clusters = []) {
  const layout = saved.layout ?? saved ?? {};
  if (clusters.length) {
    const frames = clusterFrames(clusters, layout);
    const positions = structuredClone(layout.nodes ?? {});
    delete positions['root:master'];
    const origins = Object.fromEntries(frames.map(frame => [`cluster:${frame.group.id}`, { x: frame.bounds.x, y: frame.bounds.y }]));
    const placed = new Set();
    for (const frame of frames) {
      const members = units.filter(unit => unit.role !== 'master' && !placed.has(unit.id) && (unit.clusterId === frame.group.id || !unit.clusterId && frame.group.members.includes(unit.id)));
      members.sort((a, b) => (b.role === 'overlord') - (a.role === 'overlord') || byId(a, b));
      let executorIndex = 0;
      members.forEach((unit, index) => {
        placed.add(unit.id);
        if (positions[unit.id]) return;
        const lead = unit.role === 'overlord';
        const slot = lead ? index : executorIndex++;
        positions[unit.id] = { x: frame.bounds.x + (lead ? frame.bounds.w / 2 : 70 + (slot % 2) * 150),
          y: frame.bounds.y + (lead ? 75 + index * 84 : 160 + Math.floor(slot / 2) * 84) };
      });
    }
    for (const [index, unit] of units.filter(unit => unit.role !== 'master' && !placed.has(unit.id)).entries()) {
      positions[unit.id] ??= unit.role === 'overseer' ? { x: 380, y: 409 } : { x: 380 + (index % 4) * 84, y: 810 + Math.floor(index / 4) * 84 };
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

export function groupOutline(points, pad = 48) {
  if (!points.length) return null;
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
  const x = (minX + maxX) / 2;
  const y = (minY + maxY) / 2;
  const radius = Math.max(...points.map((point) => Math.hypot(point.x - x, point.y - y))) + pad;
  return { x, y, radius };
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

export function clusterFrames(clusters, saved = {}, focusedId = null) {
  const active = clusters.filter(cluster => !cluster.deleted), frames = [], visited = new Set();
  const defaults = [[40, 470, 290, 230], [500, 480, 220, 170], [500, 150, 220, 160], [40, 150, 220, 160]];
  const append = (group, index, parent = null) => {
    if (visited.has(group.id)) return;
    visited.add(group.id);
    const children = active.filter(item => item.parentId === group.id);
    const stored = saved.groups?.[`cluster:${group.id}`];
    const linked = group.link?.kind ?? 'none';
    const compact = Boolean(parent && !children.length && !group.members.length && !stored);
    let fallback;
    if (parent) {
      const focused = parent.group.id === focusedId;
      const columns = focused ? 4 : Math.max(1, Math.floor((parent.bounds.w - 24) / 72));
      fallback = focused ? [parent.bounds.x + 24 + (index % 4) * 172, parent.bounds.y + 28 + Math.floor(index / 4) * 92, compact ? 156 : 290, compact ? 62 : 230]
        : [parent.bounds.x + 14 + (index % columns) * 72, parent.bounds.y + 20 + Math.floor(index / columns) * 30, compact ? 66 : 290, compact ? 24 : 230];
    } else if (children.length) {
      const width = index === 0 ? 318 : 300, columns = Math.floor((width - 24) / 72);
      fallback = [index === 0 ? 8 : 444 + Math.floor((index - 1) / 3) * 340, index === 0 ? 320 : 260 + ((index - 1) % 3) * 210,
        width, Math.max(60, 36 + Math.ceil(children.length / columns) * 30)];
    } else fallback = linked === 'none' ? [290 + Math.floor(index / 4) * 240, 720 + (index % 4) * 110, 180, 70]
      : defaults[index] ?? [40 + (index % 3) * 330, 850 + Math.floor(index / 3) * 300, 290, 230];
    if (group.id === focusedId) fallback = [20, 48, 720, Math.max(690, 56 + Math.ceil(children.length / 4) * 92)];
    const [x, y, w, h] = fallback;
    const bounds = { x: stored?.x ?? x, y: stored?.y ?? y, w: stored?.width ?? stored?.w ?? (group.members.length ? Math.max(290, w) : w),
      h: stored?.height ?? stored?.h ?? (group.members.length ? Math.max(230, h, 202 + Math.max(0, Math.ceil((group.members.length - 1) / 2) - 1) * 84) : h) };
    const frame = { group, bounds, compact, folder: children.length > 0 || linked === 'folder', count: children.length };
    frames.push(frame);
    children.forEach((child, childIndex) => append(child, childIndex, frame));
  };
  active.filter(group => !active.some(parent => parent.id === group.parentId)).forEach((group, index) => append(group, index));
  for (const group of active) if (!visited.has(group.id)) append(group, frames.length);
  // A parent always contains all descendant frames, including persisted full-size repository frames.
  for (const frame of [...frames].reverse()) {
    for (const child of frames.filter(item => item.group.parentId === frame.group.id)) {
      const right = Math.max(frame.bounds.x + frame.bounds.w, child.bounds.x + child.bounds.w + 14);
      const bottom = Math.max(frame.bounds.y + frame.bounds.h, child.bounds.y + child.bounds.h + 14);
      frame.bounds.x = Math.min(frame.bounds.x, child.bounds.x - 14);
      frame.bounds.y = Math.min(frame.bounds.y, child.bounds.y - 20);
      frame.bounds.w = right - frame.bounds.x; frame.bounds.h = bottom - frame.bounds.y;
    }
  }
  return frames;
}
