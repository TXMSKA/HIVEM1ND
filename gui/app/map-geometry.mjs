const LIMIT = 100000;
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
        continue;
      }
    }
    fallback.push(key);
  }
  fallback.forEach((key, index) => {
    origins[key] = { x: 220 + (index % 3) * 360, y: 360 + Math.floor(index / 3) * 360 };
  });
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
  for (const [key, members] of [...buckets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const origin = groupOrigins[key];
    members.forEach((unit, index) => {
      const ring = Math.floor(index / 8) + 1;
      const angle = (index % 8) * Math.PI / 4 - Math.PI / 2;
      positions[unit.id] = clampPoint({
        x: origin.x + Math.cos(angle) * ring * 96,
        y: origin.y + Math.sin(angle) * ring * 96,
      });
    });
  }
  return positions;
}

export function placeUnits(units, saved) {
  const layout = saved.layout ?? saved ?? {};
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
  const zoom = Math.min(2.5, Math.max(0.25, Math.min((rect.width - padding * 2) / width, (rect.height - padding * 2) / height)));
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
  if (overseer && !positions[overseer.id]) positions[overseer.id] = { x: 380, y: 160 };
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

function scopeKey(key) {
  return key.startsWith("project:") || key.startsWith("env:");
}

function clampPoint(point) {
  return {
    x: Math.min(LIMIT, Math.max(-LIMIT, point.x)),
    y: Math.min(LIMIT, Math.max(-LIMIT, point.y)),
  };
}
