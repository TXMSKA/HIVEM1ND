import { createOperation, request as apiRequest, retryOperation } from "./api.mjs";
import { icon } from "./components.mjs";
import { unitDisplayName } from "./hierarchy.mjs";
import {
  edgeEndpoints,
  groupKeyForUnit,
  groupOutline,
  hitNode,
  marqueeIds,
  placeUnits,
  personalGroupBounds,
  scopeCollapsed,
  toScreen,
  toWorld,
} from "./map-geometry.mjs";
import { isAfterCursor } from "./state.mjs";

export const NODE_RADIUS = 28;

function layoutRecord(saved) {
  if (saved?.layout) return { layout: saved.layout, revision: saved.revision ?? null };
  return { layout: saved ?? { nodes: {}, groups: {} }, revision: null };
}

export function createMap({ units = [], groups = [], saved = { nodes: {}, groups: {} }, api = null } = {}) {
  const wrapped = layoutRecord(saved);
  const layout = wrapped.layout ?? { nodes: {}, groups: {} };
  const placed = placeUnits(units, layout);
  return {
    api,
    units,
    groups,
    selectedGroupId: null,
    labelSizes: new Map(),
    saved: layout,
    positions: placed.positions,
    origins: placed.origins,
    view: { x: 40, y: 40, zoom: 1 },
    selection: new Set(),
    focusId: null,
    gesture: null,
    radius: NODE_RADIUS,
    inspectorId: null,
    pendingConnect: null,
    pendingMessage: null,
    centered: null,
    host: null,
    document: null,
    calls: [],
    revision: wrapped.revision ?? null,
    authoritative: { layout: structuredClone(layout), revision: wrapped.revision ?? null },
    pending: new Map(),
    pendingGroups: new Map(),
    editGeneration: 0,
    inFlight: null,
    layoutObservationGeneration: 0,
    layoutConflict: null,
    retryOperation: null,
    layoutCursor: null,
    serviceId: null,
    refreshTicket: 0,
    refreshing: false,
    layoutBuffer: [],
    persist: false,
  };
}

export function adoptInitialLayout(map, saved) {
  if (!map || map.authoritative?.revision != null || map.pending.size || map.pendingGroups.size || map.inFlight) return false;
  const wrapped = layoutRecord(saved);
  if (wrapped.revision == null) return false;
  const layout = wrapped.layout ?? { nodes: {}, groups: {} };
  const placed = placeUnits(map.units, layout);
  map.saved = layout;
  map.positions = placed.positions;
  map.origins = placed.origins;
  map.revision = wrapped.revision;
  map.authoritative = { layout: structuredClone(layout), revision: wrapped.revision };
  return true;
}

export function renderMap(document, host, map, labels = {}) {
  map.document = document;
  map.host = host;
  const rect = hostRect(host);
  const nodes = visibleNodes(map);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "map-edges");
  if (map.gesture?.kind === "marquee" && map.gesture.dragging) {
    const { start, current } = map.gesture;
    const from = toScreen({ x: Math.min(start.x, current.x), y: Math.min(start.y, current.y) }, rect, map.view);
    const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [key, value] of Object.entries({ x: from.x - rect.left, y: from.y - rect.top, width: Math.abs(start.x - current.x) * map.view.zoom, height: Math.abs(start.y - current.y) * map.view.zoom })) box.setAttribute(key, String(value));
    box.setAttribute("class", "map-marquee");
    svg.append(box);
  }
  const zones = personalZones(map);
  for (const zone of zones) {
    const screen = toScreen(zone.bounds, rect, map.view);
    const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [key, value] of Object.entries({ x: screen.x - rect.left, y: screen.y - rect.top, width: zone.bounds.w * map.view.zoom, height: zone.bounds.h * map.view.zoom })) box.setAttribute(key, String(value));
    box.setAttribute("class", `map-personal-zone${map.selectedGroupId === zone.group.id ? " is-selected" : ""}`);
    box.setAttribute("data-group-zone", zone.group.id);
    svg.append(box);
  }
  for (const outline of outlines(map, nodes)) {
    const screen = toScreen(outline, rect, map.view);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(screen.x - rect.left));
    circle.setAttribute("cy", String(screen.y - rect.top));
    circle.setAttribute("r", String(outline.radius * map.view.zoom));
    circle.setAttribute("class", "map-outline");
    svg.append(circle);
  }
  if (map.pendingConnect?.target) {
    const source = nodes.find((node) => node.id === map.pendingConnect.source);
    const target = nodes.find((node) => node.id === map.pendingConnect.target);
    if (source && target) {
      const edge = edgeEndpoints(source, target);
      const start = toScreen({ x: edge.x1, y: edge.y1 }, rect, map.view);
      const end = toScreen({ x: edge.x2, y: edge.y2 }, rect, map.view);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      for (const [key, value] of Object.entries({ x1: start.x - rect.left, y1: start.y - rect.top, x2: end.x - rect.left, y2: end.y - rect.top })) line.setAttribute(key, String(value));
      line.setAttribute("class", "map-edge map-pending-edge");
      line.setAttribute("data-pending-edge", `${source.id}:${target.id}`);
      svg.append(line);
    }
  }
  for (const edge of edges(map, nodes)) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const start = toScreen({ x: edge.x1, y: edge.y1 }, rect, map.view);
    const end = toScreen({ x: edge.x2, y: edge.y2 }, rect, map.view);
    line.setAttribute("x1", String(start.x - rect.left));
    line.setAttribute("y1", String(start.y - rect.top));
    line.setAttribute("x2", String(end.x - rect.left));
    line.setAttribute("y2", String(end.y - rect.top));
    line.setAttribute("class", "map-edge");
    line.setAttribute("data-edge", `${edge.source}:${edge.target}`);
    svg.append(line);
  }
  const layer = document.createElement("div");
  layer.className = "map-nodes";
  for (const zone of zones) {
    const screen = toScreen({ x: zone.bounds.x + 14, y: zone.bounds.y - 11 }, rect, map.view);
    const label = document.createElement("button");
    label.type = "button";
    label.className = "map-group-label";
    label.setAttribute("data-group-id", zone.group.id);
    label.setAttribute("aria-pressed", String(map.selectedGroupId === zone.group.id));
    label.style.left = `${screen.x - rect.left}px`;
    label.style.top = `${screen.y - rect.top}px`;
    const folder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    folder.setAttribute("viewBox", "0 0 24 24");
    folder.setAttribute("class", "icon");
    folder.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3 7V4h7l2 3h9v13H3z");
    folder.append(path);
    const title = document.createElement("span");
    title.textContent = zone.group.title;
    const caption = document.createElement("span");
    caption.className = "map-group-caption";
    caption.append(folder, title);
    label.append(caption);
    label.setAttribute("aria-label", zone.group.title);
    label.addEventListener("click", () => selectPersonalGroup(map, zone.group.id));
    layer.append(label);
  }
  for (const node of nodes) {
    const screen = toScreen(node, rect, map.view);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.unitId = node.id;
    button.setAttribute("data-unit-id", node.id);
    button.style.left = `${screen.x - rect.left}px`;
    button.style.top = `${screen.y - rect.top}px`;
    button.style.width = button.style.height = `${node.radius * 2}px`;
    button.style.marginLeft = button.style.marginTop = `${-node.radius}px`;
    button.setAttribute("aria-label", node.label);
    const selected = map.selection.has(node.id);
    button.className = ["map-node", node.person ? "is-person" : "", node.overseer ? "is-overseer" : "", node.lead ? "is-lead" : "", selected ? "is-selected" : ""].filter(Boolean).join(" ");
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("data-role", node.role);
    button.setAttribute("data-ring", node.overseer ? "overseer" : node.lead ? "lead" : node.person ? "person" : "unit");
    if (selected) button.setAttribute("data-selected", "true");
    const mark = icon(document, roleIcon(node.role));
    mark.setAttribute("data-role-icon", roleIcon(node.role));
    const marker = document.createElement("i");
    marker.className = "map-status";
    marker.setAttribute("data-status", node.status);
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", markerLabel(labels, node.status));
    const name = document.createElement("span");
    name.className = "map-label";
    name.setAttribute("data-map-label", node.label);
    if (node.alias) {
      const alias = document.createElement("strong");
      alias.className = "unit-alias";
      alias.textContent = node.alias;
      const original = document.createElement("small");
      original.className = "unit-original";
      original.textContent = node.original;
      name.append(alias, original);
    } else name.textContent = node.label;
    button.append(mark, marker, name);
    layer.append(button);
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "map-handle";
    handle.dataset.unitId = node.id;
    handle.dataset.handle = "connect";
    handle.setAttribute("data-unit-id", node.id);
    handle.setAttribute("data-handle", "connect");
    handle.setAttribute("aria-label", `${labels.connect ?? "Connect"} ${node.label}`);
    handle.style.left = `${screen.x - rect.left + node.radius + 20}px`;
    handle.style.top = `${screen.y - rect.top}px`;
    layer.append(handle);
  }
  const actions = document.createElement("div");
  actions.className = "map-actions";
  const pan = document.createElement("button");
  pan.type = "button";
  pan.className = "map-action";
  pan.dataset.action = "pan";
  pan.setAttribute("data-action", "pan");
  pan.setAttribute("aria-pressed", String(Boolean(map.panning)));
  pan.textContent = labels.pan ?? "Pan";
  pan.addEventListener("click", () => {
    map.panning = !map.panning;
    refresh(map);
  });
  actions.append(pan);
  if (map.selection.size > 1) {
    const message = document.createElement("button");
    message.type = "button";
    message.className = "map-action";
    message.dataset.action = "message-group";
    message.setAttribute("data-action", "message-group");
    message.textContent = labels.messageGroup ?? "Message as group";
    message.addEventListener("click", () => requestGroupMessage(map));
    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "map-action";
    connect.dataset.action = "connect";
    connect.setAttribute("data-action", "connect");
    connect.textContent = labels.connect ?? "Connect";
    connect.addEventListener("click", () => requestConnect(map));
    actions.append(message, connect);
  }
  const children = [svg, layer, actions];
  if (map.persistState === "saving" || map.persistState === "error") {
    const status = document.createElement("p");
    status.className = "map-save";
    status.setAttribute("data-layout-state", map.persistState);
    status.setAttribute("aria-busy", map.persistState === "saving" ? "true" : "false");
    status.textContent = map.persistState === "saving" ? (labels.savingLayout ?? "Saving the map.") : (labels.layoutError ?? "The map was not saved.");
    if (map.persistState === "error") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn";
      retry.setAttribute("data-action", "retry-layout");
      retry.textContent = labels.retry ?? "Retry";
      retry.addEventListener("click", () => map.onRetryLayout?.());
      status.append(retry);
    }
    children.push(status);
  }
  host.replaceChildren(...children);
  for (const node of nodes) {
    const label = host.querySelector(`[data-unit-id="${node.id}"]`)?.querySelector?.(".map-label");
    const size = label?.getBoundingClientRect?.();
    if (size?.width) map.labelSizes.set(node.id, { width: size.width, height: size.height });
  }
  for (const zone of personalZones(map)) {
    const box = svg.querySelector(`[data-group-zone="${zone.group.id}"]`);
    const screen = toScreen(zone.bounds, rect, map.view);
    for (const [key, value] of Object.entries({ x: screen.x - rect.left, y: screen.y - rect.top, width: zone.bounds.w * map.view.zoom, height: zone.bounds.h * map.view.zoom })) box?.setAttribute(key, String(value));
    const label = layer.querySelector(`[data-group-id="${zone.group.id}"]`);
    if (label) { label.style.left = `${screen.x - rect.left + 14 * map.view.zoom}px`; label.style.top = `${screen.y - rect.top - 11 * map.view.zoom}px`; }
  }
  bindMap(host, map);
  return nodes.map((node) => node.id);
}

function panGesture(map, event, rect) {
  return {
    kind: "pan",
    pointerId: event.pointerId,
    rect,
    originClient: { x: event.clientX, y: event.clientY },
    originView: { x: map.view.x, y: map.view.y, zoom: map.view.zoom },
    dragging: false,
  };
}

function focusedUnitId(event) {
  const node = event.target?.closest?.("[data-unit-id]") ?? event.target;
  return node?.getAttribute?.("data-unit-id") ?? node?.dataset?.unitId ?? null;
}

export function pointerDown(map, event) {
  if (event.target?.closest?.("[data-action], [data-group-id]") || event.target?.closest?.("input")) return;
  const rect = event.rect ?? hostRect(map.host);
  const target = readTarget(event);
  const world = toWorld({ x: event.clientX, y: event.clientY }, rect, map.view);
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  if (event.button === 1 || event.altKey) {
    map.gesture = panGesture(map, event, rect);
    return;
  }
  if (target.handle === "connect" && target.unitId) {
    map.gesture = {
      kind: "connect",
      source: target.unitId,
      pointerId: event.pointerId,
      rect,
      originClient: { x: event.clientX, y: event.clientY },
    };
    map.pendingConnect = { source: target.unitId, target: null };
    return;
  }
  const node = target.unitId ? nodeById(map, target.unitId) : hitNode(world, paintNodes(map), map.view.zoom);
  if (!node) {
    if (map.panning) {
      map.gesture = panGesture(map, event, rect);
      return;
    }
    map.gesture = {
      kind: "marquee",
      start: world,
      current: world,
      originClient: { x: event.clientX, y: event.clientY },
      dragging: false,
      shift: Boolean(event.shiftKey),
      pointerId: event.pointerId,
      rect,
      previous: new Set(map.selection),
      groupId: hitPersonalGroup(map, world)?.id ?? null,
    };
    return;
  }
  const ids = map.selection.has(node.id) ? [...map.selection] : [node.id];
  const baselines = {};
  for (const id of ids) baselines[id] = { ...map.positions[id] };
  map.gesture = {
    kind: "move",
    id: node.id,
    ids,
    baselines,
    start: world,
    originClient: { x: event.clientX, y: event.clientY },
    dragging: false,
    shift: Boolean(event.shiftKey),
    pointerId: event.pointerId,
    rect,
  };
}

export function pointerMove(map, event) {
  const gesture = map.gesture;
  if (!gesture) return;
  if (gesture.kind !== "connect") {
    const distance = Math.hypot(event.clientX - gesture.originClient.x, event.clientY - gesture.originClient.y);
    if (!gesture.dragging && distance < 4) return;
    gesture.dragging = true;
  }
  if (gesture.kind === "pan") {
    map.view.x = gesture.originView.x + (event.clientX - gesture.originClient.x);
    map.view.y = gesture.originView.y + (event.clientY - gesture.originClient.y);
    return;
  }
  const world = toWorld({ x: event.clientX, y: event.clientY }, gesture.rect, map.view);
  if (gesture.kind === "marquee") {
    gesture.current = world;
    return;
  }
  if (gesture.kind === "connect") {
    map.pendingConnect = { source: gesture.source, target: hitNode(world, paintNodes(map), map.view.zoom)?.id ?? null };
    return;
  }
  const delta = { x: world.x - gesture.start.x, y: world.y - gesture.start.y };
  for (const id of gesture.ids) {
    map.positions[id] = {
      x: gesture.baselines[id].x + delta.x,
      y: gesture.baselines[id].y + delta.y,
    };
  }
}

export function pointerUp(map, event) {
  const gesture = map.gesture;
  if (!gesture) return;
  if (gesture.kind === "pan") {
    map.gesture = null;
    refresh(map);
    return;
  }
  const world = toWorld({ x: event.clientX, y: event.clientY }, gesture.rect, map.view);
  if (gesture.kind === "connect") {
    const target = hitNode(world, paintNodes(map), map.view.zoom)?.id ?? null;
    map.pendingConnect = { source: gesture.source, target: target === gesture.source ? null : target };
    map.gesture = null;
    if (map.pendingConnect.target) map.onConnect?.(map.pendingConnect);
    refresh(map);
    return;
  }
  if (!gesture.dragging) {
    if (gesture.kind === "move") {
      selectOne(map, gesture.id, gesture.shift);
      map.onSelect?.(gesture.id);
    } else if (gesture.groupId) {
      selectPersonalGroup(map, gesture.groupId);
    } else {
      map.selection.clear();
      map.selectedGroupId = null;
      map.onSelection?.([]);
    }
    map.gesture = null;
    refresh(map);
    return;
  }
  if (gesture.kind === "marquee") {
    gesture.current = world;
    const ids = marqueeIds(gesture.start, gesture.current, paintNodes(map));
    map.selection = gesture.shift ? new Set([...gesture.previous, ...ids]) : new Set(ids);
    map.selectedGroupId = null;
    map.onSelection?.([...map.selection]);
  }
  if (gesture.kind === "move" && gesture.dragging && map.persist) {
    for (const id of gesture.ids) queueLayoutPatch(map, id, map.positions[id]);
    flushLayout(map);
  }
  if (gesture.kind === "connect" && map.pendingConnect?.target) map.onConnect?.(map.pendingConnect);
  map.gesture = null;
  refresh(map);
}

export function cancelGesture(map) {
  const gesture = map.gesture;
  if (!gesture) return;
  if (gesture.kind === "move") {
    for (const [id, point] of Object.entries(gesture.baselines)) map.positions[id] = { ...point };
  }
  if (gesture.kind === "marquee") map.selection = gesture.previous;
  if (gesture.kind === "connect") map.pendingConnect = null;
  if (gesture.kind === "pan") {
    map.view.x = gesture.originView.x;
    map.view.y = gesture.originView.y;
  }
  map.gesture = null;
  refresh(map);
}

export function centerUnit(map, id, rect) {
  const point = map.positions[id];
  if (!point) return false;
  map.selection = new Set([id]);
  map.selectedGroupId = null;
  map.focusId = id;
  map.centered = id;
  map.view.x = rect.width / 2 - point.x * map.view.zoom;
  map.view.y = rect.height / 2 - point.y * map.view.zoom;
  return true;
}

export function keyDown(map, event) {
  if (event.target?.closest?.("input")) return;
  if (event.key === "Escape") {
    cancelGesture(map);
    return;
  }
  const id = map.focusId ?? [...map.selection][0] ?? null;
  if (event.key === "F2" && id) {
    event.preventDefault?.();
    map.onRename?.(id);
    return;
  }
  if (event.key === "Enter" && id) {
    map.inspectorId = id;
    map.selection = new Set([id]);
    map.focusId = id;
    map.onSelect?.(id);
    event.preventDefault?.();
    return;
  }
  if (event.key === " " && id) {
    selectOne(map, id, true);
    map.onSelection?.([...map.selection]);
    event.preventDefault?.();
    return;
  }
  if (!id || !map.positions[id]) return;
  map.focusId = id;
  const step = event.shiftKey ? 1 : 10;
  const next = { ...map.positions[id] };
  if (event.key === "ArrowRight") next.x += step;
  else if (event.key === "ArrowLeft") next.x -= step;
  else if (event.key === "ArrowDown") next.y += step;
  else if (event.key === "ArrowUp") next.y -= step;
  else return;
  if (map.selection.has(id)) {
    const delta = { x: next.x - map.positions[id].x, y: next.y - map.positions[id].y };
    for (const selected of map.selection) {
      map.positions[selected] = {
        x: map.positions[selected].x + delta.x,
        y: map.positions[selected].y + delta.y,
      };
    }
  } else map.positions[id] = next;
  event.preventDefault?.();
  if (!map.persist) return;
  const moved = map.selection.has(id) ? [...map.selection] : [id];
  for (const movedId of moved) queueLayoutPatch(map, movedId, map.positions[movedId]);
  return flushLayout(map);
}

export function wheelZoom(map, event, rect) {
  const client = { x: event.clientX, y: event.clientY };
  const world = toWorld(client, rect, map.view);
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  map.view.zoom = Math.min(2.5, Math.max(0.25, map.view.zoom * factor));
  map.view.x = client.x - rect.left - world.x * map.view.zoom;
  map.view.y = client.y - rect.top - world.y * map.view.zoom;
  event.preventDefault?.();
}

export function requestConnect(map) {
  const ids = [...map.selection];
  map.pendingConnect = { source: ids[0] ?? null, targets: ids.slice(1) };
  map.onGroupConnect?.(map.pendingConnect);
}

export function requestGroupMessage(map) {
  map.pendingMessage = [...map.selection];
  map.onGroupMessage?.(map.pendingMessage);
}

export function paintNodes(map) {
  return visibleNodes(map);
}

export function personalZones(map) {
  const nodes = paintNodes(map);
  return (map.groups ?? []).filter((group) => !group.deleted).flatMap((group) => {
    const bounds = personalGroupBounds(group.members, nodes);
    if (bounds) {
      let right = bounds.x + bounds.w;
      let bottom = bounds.y + bounds.h;
      for (const node of nodes.filter((node) => group.members.includes(node.id))) {
        const label = map.labelSizes.get(node.id);
        if (!label) continue;
        bounds.x = Math.min(bounds.x, node.x - label.width / (2 * map.view.zoom) - 24);
        right = Math.max(right, node.x + label.width / (2 * map.view.zoom) + 24);
        bottom = Math.max(bottom, node.y + (node.radius + 6 + label.height) / map.view.zoom + 24);
      }
      bounds.w = right - bounds.x;
      bounds.h = bottom - bounds.y;
    }
    return bounds ? [{ group, bounds }] : [];
  });
}

export function hitPersonalGroup(map, point) {
  // Prefer the smallest enclosing zone; equal overlaps use stable IDs. Circles win before zones.
  return personalZones(map).filter(({ bounds: b }) => point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h)
    .sort((a, b) => a.bounds.w * a.bounds.h - b.bounds.w * b.bounds.h || a.group.id.localeCompare(b.group.id))[0]?.group ?? null;
}

export function selectPersonalGroup(map, id) {
  map.selectedGroupId = id;
  map.selection.clear();
  map.focusId = null;
  map.onPersonalGroup?.(id);
  refresh(map);
}

function visibleNodes(map) {
  const indexed = new Map(map.units.map((unit) => [unit.id, unit]));
  const leads = new Set();
  for (const unit of map.units) {
    if (unit.leadId) leads.add(unit.leadId);
    if (unit.role === "overlord") leads.add(unit.id);
  }
  return [...map.units].sort(byId).flatMap((unit) => {
    const key = groupKeyForUnit(unit, indexed);
    if (key && scopeCollapsed(map.saved, key)) return [];
    if (!map.positions[unit.id]) return [];
    if (unit.role === "overseer" && !(unit.unit === "overseer" && unit.scope?.kind === "root")) return [];
    return [{
      id: unit.id,
      x: map.positions[unit.id].x,
      y: map.positions[unit.id].y,
      radius: unit.role === "master" ? 20 : unit.role === "overseer" ? 32 : unit.role === "overlord" ? 28 : 23,
      label: unitDisplayName(unit),
      original: unit.unit,
      alias: unit.alias,
      leadId: unit.leadId ?? null,
      role: unit.role ?? "",
      status: unit.status ?? "unknown",
      lead: unit.role !== "overseer" && leads.has(unit.id),
      overseer: unit.role === "overseer",
      person: unit.role === "master",
    }];
  });
}

function roleIcon(role) {
  if (role === "master") return "person";
  if (role === "overseer") return "crown";
  if (role === "overlord") return "hierarchy";
  if (role === "adjutant") return "adjutant";
  if (role === "executive") return "executive";
  if (role === "genesis" || role === "incubator") return "genesis";
  return "executor";
}

function markerLabel(labels, status) {
  const names = {
    working: labels.statusWorking,
    waiting: labels.statusWaiting,
    idle: labels.statusIdle,
    out: labels.statusOut,
    quota: labels.statusQuota,
  };
  return names[status] || labels.statusUnknown || "Unknown";
}

function outlines(map, nodes) {
  const indexed = new Map(map.units.map((unit) => [unit.id, unit]));
  const groups = new Map();
  for (const node of nodes) {
    const unit = indexed.get(node.id);
    const key = groupKeyForUnit(unit, indexed);
    if (!key || key === "services" || key === "root") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  return [...groups.values()].map((points) => groupOutline(points)).filter(Boolean);
}

function edges(map, nodes) {
  const byNode = new Map(nodes.map((node) => [node.id, node]));
  const lines = [];
  for (const node of nodes) {
    const lead = byNode.get(node.leadId);
    if (!lead) continue;
    const trimmed = edgeEndpoints(lead, node);
    lines.push({ ...trimmed, source: lead.id, target: node.id });
  }
  return lines;
}

function bindMap(host, map) {
  if (host.boundMap) return;
  host.boundMap = true;
  host.tabIndex = 0;
  host.addEventListener("focusin", (event) => {
    const id = focusedUnitId(event);
    if (id) map.focusId = id;
  });
  host.addEventListener("pointerdown", (event) => pointerDown(map, event));
  host.addEventListener("pointermove", (event) => { pointerMove(map, event); if (map.gesture?.dragging || map.gesture?.kind === "connect") refresh(map); });
  host.addEventListener("pointerup", (event) => pointerUp(map, event));
  host.addEventListener("pointercancel", () => cancelGesture(map));
  host.addEventListener("dblclick", (event) => {
    const id = focusedUnitId(event);
    if (id) { centerUnit(map, id, hostRect(host)); map.onSelect?.(id); refresh(map); }
  });
  host.addEventListener("keydown", (event) => {
    keyDown(map, event);
    refresh(map);
  });
  host.addEventListener("wheel", (event) => {
    wheelZoom(map, event, hostRect(host));
    refresh(map);
  });
}

function refresh(map) {
  if (map.document && map.host) {
    const active = map.document.activeElement;
    const id = active?.getAttribute?.("data-unit-id");
    const groupId = active?.getAttribute?.("data-group-id");
    renderMap(map.document, map.host, map, map.labels ?? {});
    if (id) map.host.querySelector(`[data-unit-id="${id}"]`)?.focus?.();
    if (groupId) map.host.querySelector(`[data-group-id="${groupId}"]`)?.focus?.();
  }
}

function selectOne(map, id, shift) {
  map.selectedGroupId = null;
  if (shift) {
    if (map.selection.has(id)) map.selection.delete(id);
    else map.selection.add(id);
  } else map.selection = new Set([id]);
  map.focusId = id;
}

function nodeById(map, id) {
  return paintNodes(map).find((node) => node.id === id) ?? null;
}

function readTarget(event) {
  const node = event.target?.closest?.("[data-unit-id]") ?? event.target;
  return {
    unitId: node?.dataset?.unitId ?? node?.getAttribute?.("data-unit-id") ?? null,
    handle: node?.dataset?.handle ?? node?.getAttribute?.("data-handle") ?? null,
  };
}

function hostRect(host) {
  if (!host?.getBoundingClientRect) return { left: 0, top: 0, width: 760, height: 700 };
  const rect = host.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function queueLayoutPatch(map, id, position) {
  const previous = map.pending.get(id);
  map.editGeneration += 1;
  const saved = map.authoritative?.layout?.nodes?.[id] ?? map.positions[id] ?? position;
  map.pending.set(id, {
    position: { x: position.x, y: position.y },
    generation: map.editGeneration,
    base: previous?.base ?? { x: saved.x, y: saved.y },
  });
}

export function queueGroupPatch(map, id, group) {
  const previous = map.pendingGroups.get(id);
  map.editGeneration += 1;
  map.pendingGroups.set(id, { group: { ...group }, generation: map.editGeneration, base: previous?.base ?? null });
}

export async function flushLayout(map) {
  if (map.inFlight || map.refreshing || map.pending.size + map.pendingGroups.size === 0) return;
  const batch = new Map(map.pending);
  const groups = new Map(map.pendingGroups);
  for (const edit of batch.values()) edit.needsRetry = false;
  for (const edit of groups.values()) edit.needsRetry = false;
  const body = { expectedRevision: map.authoritative.revision };
  if (batch.size) body.nodes = Object.fromEntries([...batch].map(([id, edit]) => [id, edit.position]));
  if (groups.size) body.groups = Object.fromEntries([...groups].map(([id, edit]) => [id, edit.group]));
  const operation = makeOperation(map, "PATCH", "/layout", body);
  const observedAtDispatch = map.layoutObservationGeneration;
  map.inFlight = operation;
  map.persistState = "saving";
  map.onPersist?.();
  try {
    const result = await callApi(map, operation);
    if (map.layoutObservationGeneration === observedAtDispatch) {
      map.authoritative = result.data;
      map.layoutObservationGeneration += 1;
    } else {
      const refreshed = await refreshCurrentLayout(map);
      if (!refreshed) return;
    }
    for (const [id, edit] of batch) {
      if (map.pending.get(id)?.generation === edit.generation) map.pending.delete(id);
    }
    for (const [id, edit] of groups) {
      if (map.pendingGroups.get(id)?.generation === edit.generation) map.pendingGroups.delete(id);
    }
    renderPositions(map, overlay(map.authoritative.layout.nodes, map.pending));
    map.persistState = "saved";
    map.retryOperation = null;
  } catch (error) {
    if (error?.code === "revision_conflict") await reconcileLayoutConflict(map, batch);
    else map.retryOperation = operation;
    map.persistState = map.retryOperation ? "error" : "saved";
  } finally {
    map.inFlight = null;
    map.onPersist?.();
  }
  const followUp = !map.layoutConflict && !map.retryOperation && (
    [...map.pending.values()].some((edit) => edit.needsRetry || !edit.retried)
    || [...map.pendingGroups.values()].some((edit) => !edit.retried)
  );
  if (followUp) await flushLayout(map);
}

export function applyRemoteLayout(map, event) {
  const cursor = String(event?.id ?? "");
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9]+)$/.exec(cursor);
  if (!match || !event?.envelope?.data?.layout) return false;
  if (map.serviceId && map.serviceId !== match[1]) return false;
  if (map.layoutCursor && !isAfterCursor(cursor, map.layoutCursor)) return false;
  map.serviceId = match[1];
  map.layoutCursor = cursor;
  map.layoutObservationGeneration += 1;
  if (map.refreshing || map.inFlight) {
    map.layoutBuffer.push(event);
    return true;
  }
  map.authoritative = event.envelope.data;
  renderPositions(map, overlay(map.authoritative.layout.nodes, map.pending));
  return true;
}

export async function refreshCurrentLayout(map) {
  const ticket = ++map.refreshTicket;
  const observed = map.layoutObservationGeneration;
  map.refreshing = true;
  try {
    const result = await callApi(map, makeOperation(map, "GET", "/layout"));
    if (map.refreshTicket !== ticket || map.layoutObservationGeneration !== observed) {
      const newer = map.layoutBuffer.shift();
      if (newer) map.authoritative = newer.envelope.data;
      if (map.layoutBuffer.length && map.refreshTicket === ticket) queueMicrotask(() => refreshCurrentLayout(map));
      return false;
    }
    map.authoritative = result.data;
    return true;
  } finally {
    if (map.refreshTicket === ticket) map.refreshing = false;
  }
}

export async function retrySavedLayout(map) {
  const operation = map.retryOperation;
  if (!operation) return null;
  map.retryOperation = null;
  map.inFlight = operation;
  try {
    const result = map.transport ? await map.transport(operation) : await retryOperation(map.api, operation);
    map.authoritative = result.data;
    return result;
  } finally {
    map.inFlight = null;
  }
}

export function keepLocalPosition(map, id) {
  const edit = map.pending.get(id);
  if (!edit) return;
  map.editGeneration += 1;
  map.pending.set(id, { ...edit, generation: map.editGeneration });
  if (map.layoutConflict?.ids) map.layoutConflict.ids = map.layoutConflict.ids.filter((item) => item !== id);
  if (!map.layoutConflict?.ids?.length) map.layoutConflict = null;
  return flushLayout(map);
}

export function useIncomingPosition(map, id) {
  const incoming = map.authoritative?.layout?.nodes?.[id];
  if (incoming) map.positions[id] = { x: incoming.x, y: incoming.y };
  map.pending.delete(id);
  if (map.layoutConflict?.ids) map.layoutConflict.ids = map.layoutConflict.ids.filter((item) => item !== id);
  if (!map.layoutConflict?.ids?.length) map.layoutConflict = null;
  refresh(map);
}

async function reconcileLayoutConflict(map, batch) {
  const observed = map.layoutObservationGeneration;
  const result = await callApi(map, makeOperation(map, "GET", "/layout"));
  if (map.layoutObservationGeneration !== observed) {
    await refreshCurrentLayout(map);
    return;
  }
  const remote = result.data;
  map.authoritative = remote;
  const conflicts = [];
  for (const [id, edit] of batch) {
    const incoming = remote.layout?.nodes?.[id];
    const same = incoming && incoming.x === edit.base.x && incoming.y === edit.base.y;
    const current = map.pending.get(id);
    const unchanged = !incoming || same;
    if (unchanged && !edit.retried && !(current && current.generation > edit.generation)) {
      map.pending.set(id, {
        position: { ...edit.position },
        generation: edit.generation,
        base: edit.base,
        retried: true,
        needsRetry: true,
      });
    } else if (!unchanged) conflicts.push(id);
  }
  renderPositions(map, overlay(remote.layout.nodes, map.pending));
  map.layoutConflict = conflicts.length ? { ids: conflicts, remote } : null;
}

function overlay(nodes, pending) {
  const next = { ...(nodes ?? {}) };
  for (const [id, edit] of pending) next[id] = { ...edit.position };
  return next;
}

function renderPositions(map, nodes) {
  for (const [id, point] of Object.entries(nodes ?? {})) {
    if (map.pending.has(id)) map.positions[id] = { ...map.pending.get(id).position };
    else map.positions[id] = { x: point.x, y: point.y };
  }
  refresh(map);
}

function makeOperation(map, method, path, body) {
  if (map.api?.createOperation) return map.api.createOperation(method, path, body);
  return createOperation({ method, path, body });
}

function callApi(map, operation) {
  if (map.transport) return map.transport(operation);
  return apiRequest(map.api, operation.method, operation.path, { operation });
}
