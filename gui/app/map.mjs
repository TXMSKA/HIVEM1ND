import {
  edgeEndpoints,
  groupKeyForUnit,
  groupOutline,
  hitNode,
  marqueeIds,
  placeUnits,
  scopeCollapsed,
  toScreen,
  toWorld,
} from "./map-geometry.mjs";

export const NODE_RADIUS = 28;

export function createMap({ units = [], saved = { nodes: {}, groups: {} }, api = null } = {}) {
  const layout = saved.layout ?? saved;
  const placed = placeUnits(units, layout);
  return {
    api,
    units,
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
  };
}

export function renderMap(document, host, map, labels = {}) {
  map.document = document;
  map.host = host;
  const rect = hostRect(host);
  const nodes = visibleNodes(map);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "map-edges");
  for (const outline of outlines(map, nodes)) {
    const screen = toScreen(outline, rect, map.view);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(screen.x - rect.left));
    circle.setAttribute("cy", String(screen.y - rect.top));
    circle.setAttribute("r", String(outline.radius * map.view.zoom));
    circle.setAttribute("class", "map-outline");
    svg.append(circle);
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
  for (const node of nodes) {
    const screen = toScreen(node, rect, map.view);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-node";
    button.dataset.unitId = node.id;
    button.setAttribute("data-unit-id", node.id);
    button.style.left = `${screen.x - rect.left}px`;
    button.style.top = `${screen.y - rect.top}px`;
    button.setAttribute("aria-pressed", String(map.selection.has(node.id)));
    button.textContent = node.label;
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "map-handle";
    handle.dataset.unitId = node.id;
    handle.dataset.handle = "connect";
    handle.setAttribute("data-unit-id", node.id);
    handle.setAttribute("data-handle", "connect");
    handle.setAttribute("aria-label", "Connect");
    button.append(handle);
    layer.append(button);
  }
  const actions = document.createElement("div");
  actions.className = "map-actions";
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
  host.replaceChildren(svg, layer, actions);
  bindMap(host, map);
  return nodes.map((node) => node.id);
}

export function pointerDown(map, event) {
  const rect = event.rect ?? hostRect(map.host);
  const target = readTarget(event);
  const world = toWorld({ x: event.clientX, y: event.clientY }, rect, map.view);
  event.currentTarget?.setPointerCapture?.(event.pointerId);
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
  const world = toWorld({ x: event.clientX, y: event.clientY }, gesture.rect, map.view);
  if (gesture.kind === "connect") {
    const target = hitNode(world, paintNodes(map), map.view.zoom)?.id ?? null;
    map.pendingConnect = { source: gesture.source, target: target === gesture.source ? null : target };
    map.gesture = null;
    refresh(map);
    return;
  }
  if (!gesture.dragging) {
    if (gesture.kind === "move") selectOne(map, gesture.id, gesture.shift);
    map.gesture = null;
    refresh(map);
    return;
  }
  if (gesture.kind === "marquee") {
    gesture.current = world;
    const ids = marqueeIds(gesture.start, gesture.current, paintNodes(map));
    map.selection = gesture.shift ? new Set([...gesture.previous, ...ids]) : new Set(ids);
  }
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
  map.gesture = null;
  refresh(map);
}

export function centerUnit(map, id, rect) {
  const point = map.positions[id];
  if (!point) return false;
  map.selection = new Set([id]);
  map.focusId = id;
  map.centered = id;
  map.view.x = rect.width / 2 - point.x * map.view.zoom;
  map.view.y = rect.height / 2 - point.y * map.view.zoom;
  return true;
}

export function keyDown(map, event) {
  if (event.key === "Escape") {
    cancelGesture(map);
    return;
  }
  const id = map.focusId ?? [...map.selection][0] ?? null;
  if (event.key === "Enter" && id) {
    map.inspectorId = id;
    map.selection = new Set([id]);
    return;
  }
  if (event.key === " " && id) {
    selectOne(map, id, true);
    return;
  }
  if (!id || !map.positions[id]) return;
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
}

export function requestGroupMessage(map) {
  map.pendingMessage = [...map.selection];
}

export function paintNodes(map) {
  return visibleNodes(map).map((node) => ({ ...node, radius: map.radius }));
}

function visibleNodes(map) {
  const indexed = new Map(map.units.map((unit) => [unit.id, unit]));
  return [...map.units].sort(byId).flatMap((unit) => {
    const key = groupKeyForUnit(unit, indexed);
    if (key && scopeCollapsed(map.saved, key)) return [];
    if (!map.positions[unit.id]) return [];
    if (unit.role === "overseer" && !(unit.unit === "overseer" && unit.scope?.kind === "root")) return [];
    return [{
      id: unit.id,
      x: map.positions[unit.id].x,
      y: map.positions[unit.id].y,
      radius: map.radius,
      label: unit.unit,
      leadId: unit.leadId ?? null,
    }];
  });
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
  host.addEventListener("pointerdown", (event) => pointerDown(map, event));
  host.addEventListener("pointermove", (event) => pointerMove(map, event));
  host.addEventListener("pointerup", (event) => pointerUp(map, event));
  host.addEventListener("pointercancel", () => cancelGesture(map));
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
  if (map.document && map.host) renderMap(map.document, map.host, map, map.labels ?? {});
}

function selectOne(map, id, shift) {
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
