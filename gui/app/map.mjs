import { createOperation, request as apiRequest } from "./api.mjs";
import { clusterGlyph, icon } from "./components.mjs";
import { PRESET_ICON, unitDisplayName } from "./hierarchy.mjs";
import {
  FRAME_HEAD,
  CELL_W,
  LABEL_TEXT_WIDTH,
  edgeEndpoints,
  fitLabel,
  frameHolds,
  groupKeyForUnit,
  hitNode,
  layoutClusters,
  marqueeIds,
  placeUnits,
  scopeCollapsed,
  toScreen,
  toWorld,
} from "./map-geometry.mjs";
import { isAfterCursor } from "./state.mjs";
import { clusterCamera, interpolateCamera } from './cluster-geometry.mjs';

export const NODE_RADIUS = 28;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// The width of a name in the size the Map draws it at a scale of one, so a name is shortened the same way at every zoom.
function labelMeasure(map, document, host) {
  if (map.measureLabel) return map.measureLabel;
  let context = null;
  try { context = document.createElement("canvas").getContext?.("2d") ?? null; } catch { context = null; }
  if (context) {
    const family = document.defaultView?.getComputedStyle?.(host)?.fontFamily;
    context.font = `700 11.5px ${family || "sans-serif"}`;
    map.measureLabel = (text) => context.measureText(text).width;
  } else map.measureLabel = (text) => text.length * 6.6;
  return map.measureLabel;
}

function layoutRecord(saved) {
  if (saved?.layout) return { layout: saved.layout, revision: saved.revision ?? null };
  return { layout: saved ?? { nodes: {}, groups: {} }, revision: null };
}

// Below these scales a name, a badge or a mark would be smaller than it can be read, so it is not drawn.
const LABEL_ZOOM = 0.4, DETAIL_ZOOM = 0.3;
const QUIET_RETRIES = [900, 2500];

export function createMap({ units = [], groups = [], saved = { nodes: {}, groups: {} }, api = null } = {}) {
  const wrapped = layoutRecord(saved);
  const layout = structuredClone(wrapped.layout ?? { nodes: {}, groups: {} });
  layout.nodes ??= {}; layout.groups ??= {};
  const placed = placeUnits(units.filter(unit => unit.role !== 'master' && !unit.removed), layout, groups);
  return {
    api,
    units,
    groups,
    selectedGroupId: null,
    saved: layout,
    positions: placed.positions,
    origins: placed.origins,
    view: { x: 0, y: 0, zoom: 1 },
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
    revision: wrapped.revision ?? null,
    authoritative: { layout: structuredClone(layout), revision: wrapped.revision ?? null },
    pending: new Map(),
    pendingGroups: new Map(),
    quietRetries: 0,
    retryDelays: QUIET_RETRIES,
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
  if (!map || map.authoritative?.revision != null || map.pending.size || map.inFlight) return false;
  const wrapped = layoutRecord(saved);
  if (wrapped.revision == null) return false;
  const layout = structuredClone(wrapped.layout ?? { nodes: {}, groups: {} });
  layout.nodes ??= {}; layout.groups ??= {};
  const placed = placeUnits(map.units.filter(unit => unit.role !== 'master' && !unit.removed), layout, map.groups);
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
  const frameBoxes = new Map();
  for (const zone of zones) {
    const screen = toScreen(zone.bounds, rect, map.view);
    const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [key, value] of Object.entries({ x: screen.x - rect.left, y: screen.y - rect.top, width: zone.bounds.w * map.view.zoom, height: zone.bounds.h * map.view.zoom })) box.setAttribute(key, String(value));
    box.setAttribute("class", `map-personal-zone map-cluster-frame${zone.compact ? ' is-mini' : ''}${zone.folder ? ' is-folder' : ''}${map.selectedGroupId === zone.group.id ? " is-selected" : ""}`);
    box.setAttribute("data-group-zone", zone.group.id);
    frameBoxes.set(zone.group.id, box);
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
  // While a connection is dragged the line follows the pointer; over a valid unit it ends on that unit.
  if (map.pendingConnect?.source && (map.pendingConnect.target || map.pendingConnect.point)) {
    const source = nodes.find((node) => node.id === map.pendingConnect.source);
    const target = nodes.find((node) => node.id === map.pendingConnect.target);
    if (source && (target || map.pendingConnect.point)) {
      const edge = edgeEndpoints(source, target ?? { ...map.pendingConnect.point, radius: 0 });
      const start = toScreen({ x: edge.x1, y: edge.y1 }, rect, map.view);
      const end = toScreen({ x: edge.x2, y: edge.y2 }, rect, map.view);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      for (const [key, value] of Object.entries({ x1: start.x - rect.left, y1: start.y - rect.top, x2: end.x - rect.left, y2: end.y - rect.top })) line.setAttribute(key, String(value));
      line.setAttribute("class", `map-edge map-pending-edge${target ? " is-locked" : ""}`);
      line.setAttribute("data-pending-edge", `${source.id}:${target?.id ?? ""}`);
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
  const zoom = map.view.zoom;
  const measure = labelMeasure(map, document, host);
  const shorten = (text) => fitLabel(text, LABEL_TEXT_WIDTH, measure);
  const layer = document.createElement("div");
  layer.className = "map-nodes";
  layer.setAttribute("data-detail", zoom < DETAIL_ZOOM ? "far" : zoom < LABEL_ZOOM ? "mid" : "near");
  for (const zone of zones) {
    const screen = toScreen(zone.bounds, rect, map.view);
    const label = document.createElement("button");
    label.type = "button";
    label.className = `map-group-label${zone.compact ? ' is-mini' : ''}`;
    label.setAttribute("data-group-id", zone.group.id);
    label.setAttribute("aria-pressed", String(map.selectedGroupId === zone.group.id));
    // The title sits in the frame's own header, so it scales with the frame and never reaches into a neighbour.
    label.style.left = `${screen.x - rect.left + (zone.compact ? 3 : 10) * zoom}px`;
    label.style.top = `${screen.y - rect.top}px`;
    label.style.height = `${(zone.compact ? zone.bounds.h : FRAME_HEAD) * zoom}px`;
    label.style.maxWidth = `${Math.max(24, zone.bounds.w * zoom - (zone.compact ? 6 : 20) * zoom)}px`;
    label.style.fontSize = `${zone.compact ? clamp(11.5 * zoom, 6.5, 13) : clamp(12.5 * zoom, 7, 20)}px`;
    const folder = icon(document, clusterGlyph(zone.folder ? "folder" : zone.group.link?.kind));
    if (zone.compact || zoom < 0.5) folder.style.display = "none";
    const title = document.createElement("span");
    title.textContent = zone.group.title + (zone.count ? `, ${zone.count}` : '');
    const caption = document.createElement("span");
    caption.className = "map-group-caption";
    caption.append(folder, title);
    label.append(caption);
    label.setAttribute("aria-label", zone.group.title);
    label.addEventListener('click', () => {
      if (map.dragEndedAt && Date.now() - map.dragEndedAt < 250) return;
      const now = Date.now(), double = map.lastClusterClick?.id === zone.group.id && now - map.lastClusterClick.at < 500;
      map.lastClusterClick = double ? null : { id: zone.group.id, at: now };
      if (double) map.onOpenCluster?.(zone.group.id);
      selectPersonalGroup(map, zone.group.id);
      if (double) flyToCluster(map, zone.group.id);
    });
    label.addEventListener('dblclick', event => { event?.stopPropagation?.(); flyToCluster(map, zone.group.id); });
    // The frame lights up with its title, so it is clear which cluster a drag or a click will act on.
    const frameBox = frameBoxes.get(zone.group.id);
    for (const [type, on] of [['pointerenter', true], ['pointerleave', false], ['focus', true], ['blur', false]]) label.addEventListener(type, () => frameBox?.classList?.toggle?.('is-hover', on));
    layer.append(label);
  }
  for (const node of nodes) {
    const screen = toScreen(node, rect, map.view);
    const size = node.radius * 2 * zoom;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.unitId = node.id;
    button.setAttribute("data-unit-id", node.id);
    button.style.left = `${screen.x - rect.left}px`;
    button.style.top = `${screen.y - rect.top}px`;
    button.style.width = button.style.height = `${size}px`;
    button.style.marginLeft = button.style.marginTop = `${-size / 2}px`;
    button.setAttribute("aria-label", node.label);
    const selected = map.selection.has(node.id);
    const connecting = map.pendingConnect;
    button.className = ["map-node", node.person ? "is-person" : "", node.overseer ? "is-overseer" : "", node.lead ? "is-lead" : "", selected ? "is-selected" : "",
      connecting?.source === node.id ? "is-connecting" : "", connecting?.target === node.id ? "is-drop-target" : "", connecting?.invalid === node.id ? "is-drop-invalid" : ""].filter(Boolean).join(" ");
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("data-role", node.role);
    // A role the icon does not tell apart is named in the tooltip.
    const roleText = labels.roleName?.(node);
    const shown = node.alias ? [shorten(node.alias), shorten(node.original)] : [shorten(node.label)];
    // A name that was shortened is given in full in the tooltip.
    const cut = node.alias ? shown[0] !== node.alias || shown[1] !== node.original : shown[0] !== node.label;
    const tip = [cut ? node.label : "", roleText].filter(Boolean).join(", ");
    if (tip) button.setAttribute("title", tip);
    button.setAttribute("data-ring", node.overseer ? "overseer" : node.lead ? "lead" : node.person ? "person" : "unit");
    if (selected) button.setAttribute("data-selected", "true");
    const mark = icon(document, roleIcon(node.role));
    mark.setAttribute("data-role-icon", roleIcon(node.role));
    mark.style.width = mark.style.height = `${(node.overseer || node.lead ? 22 : 18) * zoom}px`;
    const marker = document.createElement("i");
    marker.className = "map-status";
    marker.setAttribute("data-status", node.status);
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", markerLabel(labels, node.status));
    marker.style.width = marker.style.height = `${clamp(11 * zoom, 5, 18)}px`;
    marker.style.borderWidth = `${clamp(2 * zoom, 1, 3)}px`;
    const name = document.createElement("span");
    name.className = "map-label";
    name.setAttribute("data-map-label", node.label);
    // Each name has its own cell's width and ends in an ellipsis only past it.
    name.style.maxWidth = `${(CELL_W - 12) * zoom}px`;
    name.style.fontSize = `${clamp(11.5 * zoom, 8, 30)}px`;
    name.style.top = `calc(100% + ${Math.max(2, 6 * zoom)}px)`;
    if (node.alias) {
      const alias = document.createElement("strong");
      alias.className = "unit-alias";
      alias.textContent = shown[0];
      const original = document.createElement("small");
      original.className = "unit-original";
      original.textContent = shown[1];
      name.append(alias, original);
    } else name.textContent = shown[0];
    button.append(mark, marker, name);
    const unread = map.units.find(unit => unit.id === node.id)?.unread;
    if (unread > 0) {
      const badge = document.createElement('span'); badge.className = 'map-unread';
      badge.textContent = String(unread); badge.setAttribute('aria-label', map.labels?.unread?.(unread) ?? String(unread));
      badge.style.fontSize = `${clamp(11 * zoom, 8, 16)}px`;
      badge.style.minWidth = `${clamp(20 * zoom, 12, 28)}px`;
      badge.style.padding = `1px ${clamp(7 * zoom, 3, 9)}px`;
      badge.style.right = badge.style.top = `${-clamp(10 * zoom, 4, 14)}px`;
      button.append(badge);
    }
    layer.append(button);
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "map-handle";
    handle.dataset.unitId = node.id;
    handle.dataset.handle = "connect";
    handle.setAttribute("data-unit-id", node.id);
    handle.setAttribute("data-handle", "connect");
    handle.setAttribute("aria-label", `${labels.connect ?? "Connect"} ${node.label}`);
    handle.style.left = `${screen.x - rect.left + node.radius * zoom + 20}px`;
    handle.style.top = `${screen.y - rect.top}px`;
    layer.append(handle);
  }
  const actions = document.createElement("div");
  actions.className = "map-actions";
  // Zoom controls as the board draws them: plus, minus, Fit and the current scale, which returns to 100%.
  const zoomGroup = document.createElement("div");
  zoomGroup.className = "map-zoom";
  zoomGroup.setAttribute("role", "group");
  zoomGroup.setAttribute("aria-label", labels.zoom ?? "Zoom");
  const center = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  const scale = Math.round((map.view?.zoom ?? 1) * 100);
  for (const [action, label, glyph, text, choose] of [
    ['zoom-in', labels.zoomIn ?? 'Zoom in', 'plus', null, () => { wheelZoom(map, { ...center, deltaY: -1 }, rect); refresh(map); }],
    ['zoom-out', labels.zoomOut ?? 'Zoom out', 'minus', null, () => { wheelZoom(map, { ...center, deltaY: 1 }, rect); refresh(map); }],
    ['fit-map', labels.fit ?? 'Fit', null, labels.fit ?? 'Fit', () => fitMap(map, rect)],
    ['zoom-reset', labels.zoomReset ?? 'Back to 100%', null, `${scale}%`, () => { resetZoom(map, center, rect); refresh(map); }],
  ]) {
    const control = document.createElement('button'); control.type = 'button'; control.className = 'map-zoom-button';
    control.setAttribute('data-action', action); control.setAttribute('aria-label', label); control.title = label;
    if (glyph) control.append(icon(document, glyph)); else control.textContent = text;
    control.addEventListener('click', choose); zoomGroup.append(control);
  }
  // Pan stays available for keyboard and touch; dragging the empty space also pans.
  const pan = document.createElement("button");
  pan.type = "button";
  pan.className = "map-zoom-button";
  pan.dataset.action = "pan";
  pan.setAttribute("data-action", "pan");
  pan.setAttribute("aria-pressed", String(Boolean(map.panning)));
  pan.setAttribute("aria-label", labels.pan ?? "Pan");
  pan.title = labels.pan ?? "Pan";
  pan.append(icon(document, "move"));
  pan.addEventListener("click", () => {
    map.panning = !map.panning;
    refresh(map);
  });
  zoomGroup.append(pan);
  let services = null;
  if (map.onServices) {
    services = document.createElement('div');
    services.className = 'map-services';
    services.setAttribute('role', 'group');
    services.setAttribute('aria-label', labels.services ?? 'Services');
    const caption = document.createElement('span'); caption.className = 'map-services-label'; caption.textContent = labels.services ?? 'Services';
    services.append(caption);
    for (const [action, label, glyph] of [['map-services', labels.incubator ?? 'Incubator', 'bulb'], ['map-genesis', labels.genesis ?? 'Genesis', 'genesis']]) {
      const pill = document.createElement('button'); pill.type = 'button'; pill.className = 'map-service';
      pill.setAttribute('data-action', action);
      pill.append(icon(document, glyph), document.createTextNode(label));
      pill.addEventListener('click', () => map.onServices()); services.append(pill);
    }
  }
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
  const focused = (map.groups ?? []).find(group => group.id === map.focusedFolder);
  const insideCount = focused ? (map.groups ?? []).filter(group => group.parentId === focused.id).length : 0;
  const hint = document.createElement('p'); hint.className = 'map-hint';
  hint.textContent = focused && labels.inside ? labels.inside(focused.title, insideCount) : (labels.drag ?? '');
  // The hint and the save notice each have their own slot in one row, so they can never be drawn over each other.
  const top = document.createElement('div'); top.className = 'map-top';
  top.append(hint);
  if (map.persistState === "saving" || map.persistState === "error") {
    const status = document.createElement("p");
    status.className = "map-save";
    status.setAttribute("data-layout-state", map.persistState);
    status.setAttribute("aria-busy", map.persistState === "saving" ? "true" : "false");
    const message = document.createElement("span");
    message.textContent = map.persistState === "saving" ? (labels.savingLayout ?? "Saving the map.") : (labels.layoutError ?? "The map was not saved.");
    status.append(message);
    if (map.persistState === "error") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn";
      retry.setAttribute("data-action", "retry-layout");
      retry.textContent = labels.retry ?? "Retry";
      retry.addEventListener("click", () => map.onRetryLayout?.());
      status.append(retry);
    }
    top.append(status);
  }
  host.replaceChildren(svg, layer, actions, zoomGroup, ...(services ? [services] : []), top);
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

// Capturing the pointer keeps a drag alive outside the Map. It can fail for a pointer that is already up, and a failure must not end the gesture.
function capturePointer(event) {
  try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch { /* the gesture goes on without capture */ }
}

function clusterGesture(map, id, event, rect, world, fromLabel) {
  return {
    kind: "cluster",
    id,
    fromLabel,
    pointerId: event.pointerId,
    rect,
    start: world,
    originClient: { x: event.clientX, y: event.clientY },
    dragging: false,
  };
}

export function pointerDown(map, event) {
  map.flight = null;
  // The right button only opens the context menu.
  if (event.button === 2) return;
  if (event.target?.closest?.("[data-action]") || event.target?.closest?.("input")) return;
  const rect = event.rect ?? hostRect(map.host);
  const world = toWorld({ x: event.clientX, y: event.clientY }, rect, map.view);
  // A cluster's title is its handle: dragging it moves the cluster. The pointer is captured once the drag starts, so a plain click still reaches the title.
  const titleId = event.target?.closest?.("[data-group-id]")?.getAttribute?.("data-group-id");
  if (titleId) {
    map.gesture = clusterGesture(map, titleId, event, rect, world, true);
    return;
  }
  const target = readTarget(event);
  capturePointer(event);
  if (event.button === 1 || event.altKey) {
    map.gesture = panGesture(map, event, rect);
    return;
  }
  if (target.handle === "connect" && target.unitId) {
    map.gesture = {
      kind: "connect",
      source: target.unitId,
      pointerId: event.pointerId,
      pointerType: event.pointerType ?? "mouse",
      rect,
      originClient: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    map.pendingConnect = { source: target.unitId, target: null, point: world };
    return;
  }
  const node = target.unitId ? nodeById(map, target.unitId) : hitNode(world, paintNodes(map), map.view.zoom);
  if (!node) {
    const header = event.shiftKey ? null : hitClusterHeader(map, world);
    if (header) {
      map.gesture = clusterGesture(map, header.id, event, rect, world, false);
      return;
    }
    if (!event.shiftKey) {
      map.gesture = panGesture(map, event, rect);
      map.gesture.groupId = hitPersonalGroup(map, world)?.id ?? null;
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
  if (gesture.kind === "cluster") {
    if (gesture.fromLabel && !gesture.captured) {
      gesture.captured = true;
      capturePointer(event);
    }
    map.drag ??= { id: gesture.id, ids: clusterSubtree(map, gesture.id), dx: 0, dy: 0 };
    map.drag.dx = world.x - gesture.start.x;
    map.drag.dy = world.y - gesture.start.y;
    return;
  }
  if (gesture.kind === "marquee") {
    gesture.current = world;
    return;
  }
  if (gesture.kind === "connect") {
    if (Math.hypot(event.clientX - gesture.originClient.x, event.clientY - gesture.originClient.y) >= 6) gesture.moved = true;
    map.pendingConnect = connectionAt(map, gesture, world);
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
    if (!gesture.dragging && gesture.groupId) selectPersonalGroup(map, gesture.groupId);
    else if (!gesture.dragging) { map.selection.clear(); map.selectedGroupId = null; map.onSelection?.([]); }
    map.gesture = null;
    refresh(map);
    return;
  }
  if (gesture.kind === "cluster") {
    map.gesture = null;
    if (gesture.dragging) {
      map.dragEndedAt = Date.now();
      commitClusterMove(map);
      map.drag = null;
      refresh(map);
    } else if (gesture.fromLabel) map.drag = null; // a plain click is the title's own: drawing the Map again here would replace the title under the click
    else selectPersonalGroup(map, gesture.id);
    return;
  }
  const world = toWorld({ x: event.clientX, y: event.clientY }, gesture.rect, map.view);
  if (gesture.kind === "connect") {
    const dropped = connectionAt(map, gesture, world);
    map.gesture = null;
    // A tap on the handle, with no drag, asks for the lead in the same dialog as the keyboard does.
    if (!gesture.moved) {
      map.pendingConnect = null;
      map.selectedGroupId = null;
      map.selection = new Set([gesture.source]);
      map.focusId = gesture.source;
      map.onSelection?.([...map.selection]);
      requestConnect(map);
    } else if (dropped.target) {
      map.pendingConnect = { source: dropped.source, target: dropped.target };
      map.onConnect?.(map.pendingConnect);
    } else map.pendingConnect = null;
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
  if (gesture.kind === "move" && gesture.dragging) commitNodeMoves(map, gesture.ids, gesture.baselines);
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
  if (gesture.kind === "cluster") map.drag = null;
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
  // The context menu key and Shift+F10 open the menu of the control that has the focus.
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    const unitId = focusedUnitId(event), titleId = event.target?.closest?.("[data-group-id]")?.getAttribute?.("data-group-id");
    const chosen = titleId ? { kind: "cluster", id: titleId } : unitId ? { kind: "unit", id: unitId } : map.focusId ? { kind: "unit", id: map.focusId } : null;
    if (chosen && map.onContextMenu) {
      event.preventDefault?.();
      const box = event.target?.getBoundingClientRect?.();
      map.onContextMenu({ ...chosen, x: box ? box.left + box.width / 2 : 0, y: box ? box.top + box.height / 2 : 0, keyboard: true });
      return;
    }
  }
  const id = map.focusId ?? [...map.selection][0] ?? null;
  if (event.key === "F2" && id) {
    event.preventDefault?.();
    map.onRename?.(id);
    return;
  }
  // Enter or Space on a Connect handle opens the connection dialog for that agent, so connecting does not need a pointer drag.
  const target = readTarget(event);
  if (target.handle === "connect" && target.unitId && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault?.();
    map.selectedGroupId = null;
    map.selection = new Set([target.unitId]);
    map.focusId = target.unitId;
    // The shell follows the map's selection, so the inspector shows the agent being connected.
    map.onSelection?.([...map.selection]);
    requestConnect(map);
    return;
  }
  const clusterId = event.target?.closest?.('[data-group-id]')?.getAttribute('data-group-id');
  if (clusterId && event.key === 'Enter') { event.preventDefault?.(); selectPersonalGroup(map, clusterId); flyToCluster(map, clusterId); return; }
  if (event.key === 'Home' || event.key.toLowerCase() === 'f') { event.preventDefault?.(); fitMap(map); return; }
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
  const moved = map.selection.has(id) ? [...map.selection].filter(selected => map.positions[selected]) : [id];
  const baselines = Object.fromEntries(moved.map(movedId => [movedId, { ...map.positions[movedId] }]));
  const delta = { x: next.x - map.positions[id].x, y: next.y - map.positions[id].y };
  for (const movedId of moved) map.positions[movedId] = { x: map.positions[movedId].x + delta.x, y: map.positions[movedId].y + delta.y };
  event.preventDefault?.();
  return commitNodeMoves(map, moved, baselines);
}

// Return to 100% around a point of the screen, keeping that point still.
export function resetZoom(map, client, rect) {
  map.flight = null;
  const world = toWorld({ x: client.clientX, y: client.clientY }, rect, map.view);
  map.view.zoom = 1;
  map.view.x = client.clientX - rect.left - world.x;
  map.view.y = client.clientY - rect.top - world.y;
}

export function wheelZoom(map, event, rect) {
  map.flight = null;
  const client = { x: event.clientX, y: event.clientY };
  const world = toWorld(client, rect, map.view);
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  map.view.zoom = Math.min(2.5, Math.max(Number.MIN_VALUE, map.view.zoom * factor));
  map.view.x = client.x - rect.left - world.x * map.view.zoom;
  map.view.y = client.y - rect.top - world.y * map.view.zoom;
  event.preventDefault?.();
}

// Whether a unit can lead another: not itself, not the lead it already has and not one that reports up to it.
export function canConnect(map, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const byId = new Map((map.units ?? []).map((unit) => [unit.id, unit]));
  const source = byId.get(sourceId), target = byId.get(targetId);
  if (!source || !target || source.role === "master" || target.role === "master" || target.leadId === sourceId) return false;
  const seen = new Set();
  for (let cursor = source; cursor?.leadId && !seen.has(cursor.id); cursor = byId.get(cursor.leadId)) {
    if (cursor.leadId === targetId) return false;
    seen.add(cursor.id);
  }
  return true;
}

// What the pointer is over while a connection is dragged: a unit that can be connected, a unit that cannot, or nothing.
function connectionAt(map, gesture, world) {
  const slop = gesture.pointerType === "touch" || gesture.pointerType === "pen" ? 16 : 8;
  const hit = hitNode(world, paintNodes(map), map.view.zoom, slop);
  const valid = hit && canConnect(map, gesture.source, hit.id);
  return { source: gesture.source, target: valid ? hit.id : null, invalid: hit && !valid && hit.id !== gesture.source ? hit.id : null, point: world };
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

// Everything that decides where a frame or a unit's cell is. The layout is computed again only when one of these changes.
function zoneKey(map) {
  const groups = (map.groups ?? []).map(group => [group.id, group.parentId ?? '', group.title, group.deleted ? 1 : 0, (group.members ?? []).join(','), group.link?.kind ?? ''].join('\u0001')).join('\u0002');
  const units = (map.units ?? []).filter(unit => unit.role !== 'master' && unit.role !== 'overseer' && !unit.removed)
    .map(unit => [unit.id, unit.role, unit.clusterId ?? '', unit.unit ?? ''].join('\u0001')).join('\u0002');
  const stored = Object.entries(map.saved?.groups ?? {}).filter(([key]) => key.startsWith('cluster:'))
    .map(([key, value]) => `${key}=${value?.x},${value?.y},${value?.width ?? value?.w ?? ''},${value?.height ?? value?.h ?? ''},${value?.collapsed === true ? 1 : 0}`).join(';');
  return [groups, units, stored, map.focusedFolder ?? ''].join('\u0003');
}

function zoneLayout(map) {
  const key = zoneKey(map);
  if (map.zoneCache?.key !== key) map.zoneCache = { key, layout: layoutClusters(map.groups ?? [], map.saved ?? {}, map.focusedFolder, map.units) };
  return map.zoneCache.layout;
}

export function personalZones(map) {
  const { frames } = zoneLayout(map), drag = map.drag;
  if (!drag) return frames;
  // While a cluster is dragged it, the clusters inside it and their units follow the pointer.
  return frames.map(frame => drag.ids.has(frame.group.id)
    ? { ...frame, anchor: { x: frame.anchor.x + drag.dx, y: frame.anchor.y + drag.dy }, bounds: { ...frame.bounds, x: frame.bounds.x + drag.dx, y: frame.bounds.y + drag.dy } } : frame);
}

// The cluster and every cluster inside it.
function clusterSubtree(map, id) {
  const ids = new Set([id]);
  for (let size = 0; size !== ids.size;) {
    size = ids.size;
    for (const cluster of map.groups ?? []) if (!cluster.deleted && ids.has(cluster.parentId)) ids.add(cluster.id);
  }
  return ids;
}

// The title strip of a frame, or a whole mini frame, is where a cluster is picked up.
export function hitClusterHeader(map, point) {
  return personalZones(map).filter(({ bounds: b, compact }) => point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + (compact ? b.h : FRAME_HEAD))
    .sort((a, b) => a.bounds.w * a.bounds.h - b.bounds.w * b.bounds.h || a.group.id.localeCompare(b.group.id))[0]?.group ?? null;
}

function homeFrame(map, unitId) {
  const id = zoneLayout(map).homes.get(unitId);
  return id ? zoneLayout(map).frames.find(frame => frame.group.id === id) ?? null : null;
}

// A unit stays inside its cluster. One dropped outside goes back where it was; the others are kept and saved.
function commitNodeMoves(map, ids, baselines) {
  let saved = false;
  for (const id of ids) {
    const point = map.positions[id], frame = homeFrame(map, id), radius = paintNodes(map).find(node => node.id === id)?.radius ?? 21;
    if (frame && point && !frameHolds(point, radius, frame.bounds)) { map.positions[id] = { ...baselines[id] }; continue; }
    if (!point) continue;
    map.saved.nodes[id] = { x: point.x, y: point.y };
    if (map.persist) { queueLayoutPatch(map, id, point); saved = true; }
  }
  return saved ? flushLayout(map) : undefined;
}

function commitClusterMove(map) {
  const drag = map.drag;
  if (!drag) return;
  const dx = Math.round(drag.dx), dy = Math.round(drag.dy);
  if (!dx && !dy) return;
  const { frames, homes } = zoneLayout(map);
  for (const id of drag.ids) {
    const frame = frames.find(item => item.group.id === id), key = `cluster:${id}`, stored = map.saved.groups[key];
    // A cluster inside a collapsed one has no frame now, but a place it was given still moves with it.
    const base = frame?.anchor ?? (Number.isFinite(stored?.x) && Number.isFinite(stored?.y) ? stored : null);
    if (!base) continue;
    const position = { x: Math.round(base.x) + dx, y: Math.round(base.y) + dy };
    map.saved.groups[key] = { ...stored, ...position };
    if (map.persist) queueGroupPatch(map, key, position);
  }
  // The clusters beside it stay where they are: each keeps the place it has now, so closing the gap it leaves moves nothing.
  const active = new Set(frames.map(frame => frame.group.id)), parentOf = frame => active.has(frame.group.parentId) ? frame.group.parentId : null;
  const dragged = frames.find(frame => frame.group.id === drag.id);
  for (const frame of dragged ? frames : []) {
    const key = `cluster:${frame.group.id}`;
    if (drag.ids.has(frame.group.id) || parentOf(frame) !== parentOf(dragged) || Number.isFinite(map.saved.groups[key]?.x)) continue;
    const position = { x: Math.round(frame.anchor.x), y: Math.round(frame.anchor.y) };
    map.saved.groups[key] = { ...map.saved.groups[key], ...position };
    if (map.persist) queueGroupPatch(map, key, position);
  }
  // A unit the person had placed moves with its cluster; the others follow because their cell does.
  for (const [unitId, clusterId] of homes) {
    const placed = map.saved.nodes[unitId];
    if (!drag.ids.has(clusterId) || !Number.isFinite(placed?.x)) continue;
    const next = { x: placed.x + dx, y: placed.y + dy };
    map.saved.nodes[unitId] = next;
    if (map.persist) queueLayoutPatch(map, unitId, next);
  }
  settlePositions(map);
  if (map.persist) flushLayout(map);
}

function nodeExtent(node) {
  const half = Math.max(node.radius, (CELL_W - 12) / 2);
  return { x: node.x - half, y: node.y - node.radius, width: half * 2, height: node.radius * 2 + 36 };
}

export function graphBounds(map) {
  return [...personalZones(map).map(({ bounds: b }) => ({ x: b.x, y: b.y, width: b.w, height: b.h })),
    ...paintNodes(map).map(nodeExtent)];
}

// The core stores a new unit at {0, 0}. Once clusters exist, that origin is not a place on the Map:
// agents move inside their frame and the Overseer moves outside every frame.
export function settlePositions(map) {
  if (!map?.groups?.some(group => !group.deleted)) return;
  // Only the places the person chose are kept; every other unit takes its cell again, so cells never go stale.
  const placed = placeUnits((map.units ?? []).filter(unit => unit.role !== 'master' && !unit.removed),
    { nodes: map.saved?.nodes ?? {}, groups: map.saved?.groups ?? {} }, map.groups);
  if (map.gesture?.kind === 'move' && map.gesture.dragging) for (const id of map.gesture.ids) if (map.positions[id]) placed.positions[id] = map.positions[id];
  map.positions = placed.positions;
  map.origins = placed.origins;
}

export function fitMap(map, rect = hostRect(map.host)) {
  map.flight = null;
  map.focusedFolder = null;
  map.view = clusterCamera(graphBounds(map), rect, 48, 1.15);
  refresh(map);
  return map.view;
}

export function flyToCluster(map, id, rect = hostRect(map.host)) {
  if ((map.groups ?? []).some(group => group.parentId === id)) map.focusedFolder = id;
  const focused = (map.groups ?? []).find(group => group.id === map.focusedFolder);
  const hint = map.host?.querySelector?.('.map-hint');
  if (focused && hint && map.labels?.inside) hint.textContent = map.labels.inside(focused.title, (map.groups ?? []).filter(group => group.parentId === focused.id).length);
  const frame = personalZones(map).find(item => item.group.id === id);
  if (!frame) return false;
  const ids = new Set([id]);
  for (let size = 0; size !== ids.size;) { size = ids.size; for (const cluster of map.groups) if (ids.has(cluster.parentId)) ids.add(cluster.id); }
  const frames = personalZones(map).filter(item => ids.has(item.group.id));
  const members = new Set(frames.flatMap(item => item.group.members));
  const bounds = [...frames.map(({ bounds: b }) => ({ x: b.x, y: b.y, width: b.w, height: b.h })),
    ...paintNodes(map).filter(node => members.has(node.id)).map(nodeExtent)];
  const to = clusterCamera(bounds, rect, 48, 1.6), from = { ...map.view }, view = map.document?.defaultView;
  const flight = {}; map.flight = flight;
  if (map.reducedMotion || view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !view?.requestAnimationFrame) { map.view = to; refresh(map); return true; }
  let started;
  const step = now => {
    if (map.flight !== flight || map.disposed) return;
    started ??= now;
    map.view = interpolateCamera(from, to, (now - started) / 220);
    refresh(map);
    if (now - started < 220) view.requestAnimationFrame(step);
    else map.flight = null;
  };
  view.requestAnimationFrame(step);
  return true;
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
  const drag = map.drag, homes = drag ? zoneLayout(map).homes : null;
  return [...map.units].sort(byId).flatMap((unit) => {
    if (unit.role === 'master' || unit.removed) return [];
    const key = groupKeyForUnit(unit, indexed);
    const clustered = unit.clusterId || (map.groups ?? []).some(group => !group.deleted && group.members.includes(unit.id));
    if (!clustered && key && scopeCollapsed(map.saved, key)) return [];
    if (!map.positions[unit.id]) return [];
    if (unit.role === "overseer" && !(unit.unit === "overseer" && unit.scope?.kind === "root")) return [];
    const follows = drag && drag.ids.has(homes.get(unit.id));
    return [{
      id: unit.id,
      x: map.positions[unit.id].x + (follows ? drag.dx : 0),
      y: map.positions[unit.id].y + (follows ? drag.dy : 0),
      radius: unit.role === "overseer" ? 30 : unit.role === "overlord" ? 25 : 21,
      label: unitDisplayName(unit),
      original: unit.unit,
      alias: unit.alias,
      leadId: unit.leadId ?? null,
      role: unit.role ?? "",
      roleName: unit.roleName ?? null,
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
  // A role the Map does not know keeps the plain agent mark.
  if (typeof role === "string" && Object.hasOwn(PRESET_ICON, role)) return PRESET_ICON[role];
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

function outlines() { return []; }

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
  host.addEventListener("contextmenu", (event) => {
    if (!map.onContextMenu) return;
    const unitId = focusedUnitId(event), titleId = event.target?.closest?.("[data-group-id]")?.getAttribute?.("data-group-id");
    const target = unitId ? { kind: "unit", id: unitId } : titleId ? { kind: "cluster", id: titleId } : null;
    const group = target ? null : hitPersonalGroup(map, toWorld({ x: event.clientX, y: event.clientY }, hostRect(host), map.view));
    const chosen = target ?? (group ? { kind: "cluster", id: group.id } : null);
    if (!chosen) return;
    event.preventDefault?.();
    // From the keyboard the event has no position, so the menu opens at the control itself.
    const box = !event.clientX && !event.clientY ? event.target?.getBoundingClientRect?.() : null;
    map.onContextMenu({ ...chosen, x: box ? box.left + box.width / 2 : event.clientX, y: box ? box.top + box.height / 2 : event.clientY });
  });
  host.addEventListener("dblclick", (event) => {
    const id = focusedUnitId(event);
    if (id) { centerUnit(map, id, hostRect(host)); map.onSelect?.(id); refresh(map); }
    else {
      const world = toWorld({ x: event.clientX, y: event.clientY }, hostRect(host), map.view);
      const group = hitPersonalGroup(map, world);
      if (group) { selectPersonalGroup(map, group.id); flyToCluster(map, group.id); }
    }
  });
  host.addEventListener("keydown", (event) => {
    // Tab changes nothing on the map; drawing again would move focus before the browser advances it.
    if (event.key === "Tab") return;
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
    const handle = active?.getAttribute?.("data-handle") ?? null;
    const groupId = active?.getAttribute?.("data-group-id");
    renderMap(map.document, map.host, map, map.labels ?? {});
    // A node and its Connect handle share the unit id, so focus returns to the same kind of control.
    if (id) [...map.host.querySelectorAll(`[data-unit-id="${id}"]`)].find((node) => (node.getAttribute?.("data-handle") ?? null) === handle)?.focus?.();
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

// A frame's place and whether it is collapsed travel together; edits to the same frame merge.
export function queueGroupPatch(map, key, patch) {
  map.editGeneration += 1;
  map.pendingGroups.set(key, { position: { ...map.pendingGroups.get(key)?.position, ...patch }, generation: map.editGeneration });
}

export function toggleCollapsed(map, id) {
  const key = `cluster:${id}`, collapsed = map.saved.groups[key]?.collapsed !== true;
  map.saved.groups[key] = { ...map.saved.groups[key], collapsed };
  if (map.persist) { queueGroupPatch(map, key, { collapsed }); flushLayout(map); }
  settlePositions(map);
  refresh(map);
  return collapsed;
}

export function isCollapsed(map, id) {
  return map.saved?.groups?.[`cluster:${id}`]?.collapsed === true;
}

// A failed save is tried again by itself, a little later, before the person is told about it.
function scheduleQuietRetry(map) {
  const delay = map.retryDelays?.[map.quietRetries];
  if (delay === undefined || map.disposed) return false;
  map.quietRetries += 1;
  clearTimeout(map.quietTimer);
  map.quietTimer = setTimeout(() => {
    map.quietTimer = null;
    if (map.disposed) return;
    flushLayout(map, true).catch(() => {});
  }, delay);
  map.quietTimer.unref?.();
  return true;
}

// A retry sends the very same operation again, so a save whose answer was lost is never applied twice.
export async function flushLayout(map, retry = false) {
  const again = retry && map.retryOperation && map.retryBatch ? map.retryBatch : null;
  if (map.inFlight || map.refreshing || (!again && map.pending.size === 0 && map.pendingGroups.size === 0)) return;
  const batch = again ? again.nodes : new Map(map.pending), groupBatch = again ? again.groups : new Map(map.pendingGroups);
  for (const edit of batch.values()) edit.needsRetry = false;
  let operation = map.retryOperation;
  if (!again) {
    const body = { expectedRevision: map.authoritative.revision };
    if (batch.size) body.nodes = Object.fromEntries([...batch].map(([id, edit]) => [id, edit.position]));
    if (groupBatch.size) body.groups = Object.fromEntries([...groupBatch].map(([key, edit]) => [key, edit.position]));
    operation = makeOperation(map, "PATCH", "/layout", body);
  }
  const observedAtDispatch = map.layoutObservationGeneration;
  let groupFollow = false;
  map.inFlight = operation;
  map.persistState = map.quietRetries > 0 ? "retrying" : "saving";
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
    for (const [key, edit] of groupBatch) {
      if (map.pendingGroups.get(key)?.generation === edit.generation) map.pendingGroups.delete(key);
    }
    renderPositions(map, overlay(map.authoritative.layout.nodes, map.pending));
    map.persistState = "saved";
    map.retryOperation = null;
    map.retryBatch = null;
    map.quietRetries = 0;
    map.groupRetried = false;
    groupFollow = map.pendingGroups.size > 0;
  } catch (error) {
    if (error?.code === "revision_conflict") {
      await reconcileLayoutConflict(map, batch);
      groupFollow = groupBatch.size > 0 && !map.groupRetried;
      map.groupRetried = true;
    } else { map.retryOperation = operation; map.retryBatch = { nodes: batch, groups: groupBatch }; }
    map.persistState = map.retryOperation ? (scheduleQuietRetry(map) ? "retrying" : "error") : "saved";
  } finally {
    map.inFlight = null;
    map.onPersist?.();
  }
  const followUp = !map.layoutConflict && !map.retryOperation
    && ([...map.pending.values()].some((edit) => edit.needsRetry || !edit.retried) || groupFollow);
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

// The button after the quiet tries are spent: send every edit that is still waiting. A failure shows at once.
export async function retrySavedLayout(map) {
  if (!map.retryOperation && map.pending.size === 0 && map.pendingGroups.size === 0) return null;
  clearTimeout(map.quietTimer);
  map.quietRetries = map.retryDelays?.length ?? 0;
  return flushLayout(map, true);
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
    if (incoming && incoming.x === edit.position.x && incoming.y === edit.position.y) {
      if (current?.generation === edit.generation) map.pending.delete(id);
      continue;
    }
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

function overlayGroups(groups, pending) {
  const next = { ...(groups ?? {}) };
  for (const [key, edit] of pending) next[key] = { ...next[key], ...edit.position };
  return next;
}

function renderPositions(map, nodes) {
  for (const [id, point] of Object.entries(nodes ?? {})) {
    if (map.pending.has(id)) map.positions[id] = { ...map.pending.get(id).position };
    else map.positions[id] = { x: point.x, y: point.y };
  }
  // The places and frames the person chose are what the layout is settled from.
  map.saved = { ...map.saved, nodes: { ...nodes }, groups: overlayGroups(map.authoritative?.layout?.groups ?? map.saved?.groups, map.pendingGroups) };
  settlePositions(map);
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
