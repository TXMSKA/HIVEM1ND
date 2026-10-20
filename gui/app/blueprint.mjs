import { fetchAsset, perform } from "./api.mjs";
import { text } from "./i18n.mjs";

const SVG = "http://www.w3.org/2000/svg";

export function editedBoard(authoritative, edit) {
  const document = structuredClone(authoritative.document);
  edit(document);
  return { document, expectedRevision: authoritative.revision };
}

export function updateNodeOperation(editor, nodeId, fields) {
  const changes = structuredClone(fields);
  for (const key of ["id", "t", "kids"]) {
    if (key in changes) throw new Error("Structural fields require a structural operation.");
  }
  return { changes, expectedRevision: editor.revision, nodeId };
}

export function boardCommentAnchor(board, target) {
  if (!board || !target) return null;
  const point = integerPoint(target.x, target.y);
  if (!point) return null;
  if (target.kind === "canvas") {
    return { screen: null, screenTitle: null, element: null, label: "Board", path: ["Board"], point };
  }
  if (target.kind === "screen") {
    const screen = (board.screens ?? []).find((item) => item.id === target.screenId);
    if (!screen) return null;
    const title = typeof screen.title === "string" ? screen.title : screen.id;
    return { screen: screen.id, screenTitle: title, element: null, label: title, path: [title], point };
  }
  if (target.kind === "node") {
    const indexed = indexNodes(board).get(target.nodeId);
    if (!indexed) return null;
    const title = typeof indexed.screen.title === "string" ? indexed.screen.title : indexed.screen.id;
    const label = indexed.node.name || indexed.node.id;
    const path = [title, ...indexed.ancestors.map((item) => item.name || item.id), label].slice(0, 10);
    return { screen: indexed.screen.id, screenTitle: title, element: indexed.node.id, label, path, point };
  }
  return null;
}

function integerPoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

export function indexNodes(document) {
  const nodes = new Map();
  for (const screen of document?.screens ?? []) walk(screen?.root, screen, [], number(screen.x), number(screen.y));
  return nodes;

  function walk(node, screen, ancestors, parentX, parentY) {
    if (!node?.id) return;
    const x = parentX + number(node.place?.x), y = parentY + number(node.place?.y);
    nodes.set(node.id, { node, screen, ancestors, parentX, parentY, x, y });
    for (const child of node.kids ?? []) walk(child, screen, [...ancestors, node], x, y);
  }
}

export function boardDocument(editor) {
  return editor.boardDraft ?? editor.authoritative?.document ?? editor.document;
}

export function parentPoint(board, nodeId, point) {
  const item = indexNodes(board).get(nodeId);
  return item ? { x: point.x - item.parentX, y: point.y - item.parentY } : null;
}

export function setBoardDraft(editor, document) {
  if (!editor.boardDraft) editor.baseRevision = editor.revision;
  editor.boardDraft = document;
  editor.editGeneration = (editor.editGeneration ?? 0) + 1;
  editor.dirty = true;
}

export function hitBoardNode(document, point) {
  const screens = document?.screens ?? [];
  for (let index = screens.length - 1; index >= 0; index -= 1) {
    const screen = screens[index];
    const local = { x: point.x - screen.x, y: point.y - screen.y };
    if (local.x < 0 || local.y < 0 || local.x > screen.w || local.y > screen.h) continue;
    const hit = hitNode(screen.root, local);
    if (hit) return { screenId: screen.id, nodeId: hit };
  }
  return null;
}

export function renderBoard(document, host, editor) {
  const board = boardDocument(editor);
  host.replaceChildren();
  if (!board) return;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "board-svg");
  svg.setAttribute("role", "tree");
  svg.setAttribute("aria-label", typeof board.title === "string" && board.title ? board.title : "Board");
  const bounds = editor.boardView ?? boardBounds(board);
  editor.boardView = bounds;
  svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
  const focus = editor.focus?.screenId ?? "";
  if (editor.panned && editor.focus?.nodeId) {
    svg.setAttribute("viewBox", `${number(editor.viewport?.x) - 80} ${number(editor.viewport?.y) - 60} 320 240`);
  }
  for (const link of board.links ?? []) svg.append(renderLink(document, board, link));
  for (const screen of board.screens ?? []) {
    const group = document.createElementNS(SVG, "g");
    group.setAttribute("data-screen", screen.id);
    group.setAttribute("transform", `translate(${number(screen.x)} ${number(screen.y)})`);
    if (screen.id === focus) group.setAttribute("data-focus", "true");
    const background = document.createElementNS(SVG, "rect");
    background.setAttribute("class", "board-screen-background");
    background.setAttribute("width", String(number(screen.w))); background.setAttribute("height", String(number(screen.h)));
    background.setAttribute("rx", String(number(screen.root?.radius)));
    const title = document.createElementNS(SVG, "text");
    title.setAttribute("class", "board-screen-title"); title.setAttribute("x", "2"); title.setAttribute("y", "-18");
    title.textContent = screen.title ?? screen.id;
    group.append(background, title);
    group.append(renderNode(document, screen.root, editor));
    svg.append(group);
  }
  host.append(svg);
}

export function renderNode(document, node, editor) {
  const group = document.createElementNS(SVG, "g");
  if (!node) return group;
  group.setAttribute("data-node", node.id);
  group.setAttribute("role", "treeitem");
  group.setAttribute("tabindex", "0");
  group.setAttribute("aria-label", String(node.name || node.id));
  if (editor.focus?.nodeId && node.id === editor.focus.nodeId) group.setAttribute("data-highlight", "true");
  if (node.name) group.setAttribute("data-name", String(node.name));
  group.setAttribute("transform", `translate(${number(node.place?.x)} ${number(node.place?.y)})`);
  if (Number.isFinite(node.opacity) && node.opacity >= 0 && node.opacity <= 1) group.setAttribute("opacity", String(node.opacity));
  const body = node.clip === true ? clippedGroup(document, group, node) : group;
  body.append(drawNode(document, node, editor));
  for (const child of node.kids ?? []) body.append(renderNode(document, child, editor));
  return group;
}

export async function patchNode(api, editor, nodeId, fields, retained = null) {
  const change = retained ? null : updateNodeOperation(editor, nodeId, fields);
  const result = await perform(api, {
    method: "PATCH",
    path: "/blueprint/boards/:resourceId/nodes/:nodeId",
    params: { resourceId: editor.resourceId, nodeId },
    body: retained ? undefined : { changes: change.changes, expectedRevision: change.expectedRevision },
  }, retained);
  acceptBoard(editor, result.data);
  return result;
}

export async function addNode(api, editor, body, retained = null) {
  const result = await perform(api, {
    method: "POST",
    path: "/blueprint/boards/:resourceId/nodes",
    params: { resourceId: editor.resourceId },
    body: { ...body, expectedRevision: editor.revision },
  }, retained);
  acceptBoard(editor, result.data.editor);
  return result;
}

export async function removeNode(api, editor, nodeId, retained = null) {
  const result = await perform(api, {
    method: "DELETE",
    path: "/blueprint/boards/:resourceId/nodes/:nodeId",
    params: { resourceId: editor.resourceId, nodeId },
    body: { expectedRevision: editor.revision },
  }, retained);
  acceptBoard(editor, result.data);
  return result;
}

export async function replaceBoard(api, editor, document, retained = null) {
  const generation = editor.editGeneration ?? 0;
  const submitted = retained?.body?.document ?? document;
  editor.boardSaving = { document: structuredClone(submitted), generation };
  let result;
  try { result = await perform(api, {
    method: "PUT",
    path: "/blueprint/boards/:resourceId",
    params: { resourceId: editor.resourceId },
    body: { document, expectedRevision: editor.revision },
  }, retained); } finally {
    const saved = result?.data?.revision;
    if (saved) { editor.savedRevisions ??= new Set(); editor.savedRevisions.add(saved); }
    editor.boardSaving = null;
  }
  if (editor.conflict?.remote && editor.conflict.remote.revision !== result.data.revision) return result;
  acceptBoard(editor, result.data);
  editor.baseRevision = result.data.revision;
  if ((editor.editGeneration ?? 0) === generation && (!editor.boardDraft || JSON.stringify(editor.boardDraft) === JSON.stringify(submitted))) {
    editor.boardDraft = null;
    editor.dirty = false;
    editor.conflict = null;
  }
  return result;
}

export async function uploadAsset(api, editor, file, retained = null) {
  let spec = { method: "POST", path: "/editors/:resourceId/assets", params: { resourceId: editor.resourceId }, body: {} };
  if (!retained) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > 10 * 1024 * 1024) throw Object.assign(new Error("The asset is too large."), { code: "asset_too_large" });
    spec = {
      method: "POST",
      path: "/editors/:resourceId/assets",
      params: { resourceId: editor.resourceId },
      body: { contentType: file.type, bytesBase64: encodeBytes(bytes) },
    };
  }
  const result = await perform(api, spec, retained);
  const image = await fetchAsset(api, result.data);
  if (!editor.assets) editor.assets = new Map();
  editor.assets.set(result.data.src, image);
  return { ...result.data, objectUrl: image.url, revoke: image.revoke };
}

export function releaseAssets(editor) {
  // A failed download is kept as null, so a missing image is skipped.
  for (const image of editor?.assets?.values?.() ?? []) image?.revoke?.();
  editor?.assets?.clear?.();
}

const ASSET_SRC = /^assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp))$/;

export function collectAssetRefs(document) {
  const allowed = [];
  const rejected = [];
  const seen = new Set();
  for (const screen of document?.screens ?? []) walk(screen?.root);
  return { allowed, rejected };

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.t === "image" && node.src) {
      const src = String(node.src);
      if (!seen.has(src)) {
        seen.add(src);
        const match = ASSET_SRC.exec(src);
        if (match) allowed.push({ src, id: match[1] });
        else rejected.push(src.slice(0, 200));
      }
    }
    for (const child of node.kids ?? []) walk(child);
  }
}

export async function loadAssets(api, editor) {
  const { allowed, rejected } = collectAssetRefs(editor?.authoritative?.document ?? editor?.document);
  const previous = editor.assets ?? new Map();
  const next = new Map();
  const issues = rejected.map((src) => ({ src, code: "invalid_asset" }));
  for (const ref of allowed) {
    const kept = previous.get(ref.src);
    if (kept?.url?.startsWith("blob:")) {
      next.set(ref.src, kept);
      continue;
    }
    try {
      const image = await fetchAsset(api, {
        url: `/api/v1/editors/${encodeURIComponent(editor.resourceId)}/assets/${encodeURIComponent(ref.id)}`,
      });
      next.set(ref.src, image);
    } catch (error) {
      issues.push({ src: ref.src, code: error.code || "invalid_asset" });
    }
  }
  for (const [src, image] of previous) if (next.get(src) !== image) image.revoke?.();
  editor.assets = next;
  editor.assetIssues = issues;
  return next;
}

function acceptBoard(editor, data) {
  if (!data) return;
  editor.revision = data.revision;
  editor.baseRevision = editor.dirty ? editor.baseRevision : data.revision;
  editor.authoritative = { ...editor.authoritative, ...data, document: data.document };
}

function hitNode(node, point) {
  if (!node) return null;
  const rect = hitRect(node);
  const clip = node.clip ? rect : null;
  if (node.kids?.length) {
    for (let index = node.kids.length - 1; index >= 0; index -= 1) {
      const childPoint = { x: point.x - rect.x, y: point.y - rect.y };
      if (clip && !inRoundedRect(clip, point, node.radius)) continue;
      const found = hitNode(node.kids[index], childPoint);
      if (found) return found;
    }
  }
  if (!inRoundedRect(rect, point, node.radius)) return null;
  if (node.kind === "circle" && !inEllipse(rect, point)) return null;
  return node.id;
}

function inside(rect, point) {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.w && point.y <= rect.y + rect.h;
}

function inRoundedRect(rect, point, radius = 0) {
  if (!inside(rect, point)) return false;
  const r = Math.min(number(radius), rect.w / 2, rect.h / 2);
  const cx = Math.max(rect.x + r, Math.min(point.x, rect.x + rect.w - r));
  const cy = Math.max(rect.y + r, Math.min(point.y, rect.y + rect.h - r));
  return (point.x - cx) ** 2 + (point.y - cy) ** 2 <= r ** 2;
}

function inEllipse(rect, point) {
  const rx = rect.w / 2;
  const ry = rect.h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (point.x - (rect.x + rx)) / rx;
  const dy = (point.y - (rect.y + ry)) / ry;
  return dx * dx + dy * dy <= 1;
}

function clippedGroup(document, group, node) {
  const id = `clip-${String(node.id).replace(/[^a-z0-9-]/gi, "")}`;
  const clip = document.createElementNS(SVG, "clipPath");
  clip.setAttribute("id", id);
  const rect = document.createElementNS(SVG, "rect");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", String(Math.max(number(node.w), 0)));
  rect.setAttribute("height", String(Math.max(number(node.h), 0)));
  rect.setAttribute("rx", String(number(node.radius)));
  clip.append(rect);
  const inner = document.createElementNS(SVG, "g");
  inner.setAttribute("clip-path", `url(#${id})`);
  group.append(clip, inner);
  return inner;
}

function hitRect(node) {
  let w = number(node.w);
  let h = number(node.h);
  if ((node.t === "text" || node.t === "vector" || node.t === "icon") && (w < 1 || h < 1)) {
    w = Math.max(w, 8);
    h = Math.max(h, 8);
  }
  return { x: number(node.place?.x), y: number(node.place?.y), w, h };
}

function drawNode(document, node, editor) {
  const width = number(node.w);
  const height = number(node.h);
  if (node.t === "text") return drawText(document, node, height);
  if (node.t === "vector") return drawVector(document, node, width, height);
  if (node.t === "icon") return drawIcon(document, node, width, height);
  if (node.t === "image") {
    const image = document.createElementNS(SVG, "image");
    image.setAttribute("data-src", String(node.src ?? ""));
    image.setAttribute("width", String(width));
    image.setAttribute("height", String(height));
    const stored = editor.assets?.get(node.src);
    const issue = editor.assetIssues?.find((item) => item.src === node.src);
    if (stored?.url?.startsWith("blob:")) {
      image.setAttribute("href", stored.url);
      image.setAttribute("data-asset", "ready");
    } else image.setAttribute("data-asset", issue?.code ?? "missing");
    return image;
  }
  const shape = document.createElementNS(SVG, node.kind === "circle" ? "ellipse" : "rect");
  shape.setAttribute("fill", "none");
  if (node.kind === "circle") {
    shape.setAttribute("cx", String(width / 2));
    shape.setAttribute("cy", String(height / 2));
    shape.setAttribute("rx", String(width / 2));
    shape.setAttribute("ry", String(height / 2));
  } else {
    shape.setAttribute("x", "0");
    shape.setAttribute("y", "0");
    shape.setAttribute("width", String(width));
    shape.setAttribute("height", String(height));
    shape.setAttribute("rx", String(number(node.radius)));
  }
  applyPaint(shape, node);
  return shape;
}

function drawText(document, node, height) {
  const text = document.createElementNS(SVG, "text");
  text.textContent = String(node.value ?? "");
  const size = Number.isFinite(node.size) && node.size >= 1 && node.size <= 1000 ? node.size : 14;
  text.setAttribute("font-size", String(size));
  text.setAttribute("x", String(node.align === "center" ? number(node.w) / 2 : node.align === "right" ? number(node.w) : 0));
  text.setAttribute("y", String(size));
  const color = paint(node.color);
  if (color) text.setAttribute("fill", color);
  const font = safeFont(node.font);
  if (font) text.setAttribute("font-family", font);
  if (node.align === "left") text.setAttribute("text-anchor", "start");
  if (node.align === "center") text.setAttribute("text-anchor", "middle");
  if (node.align === "right") text.setAttribute("text-anchor", "end");
  if (Number.isInteger(node.weight) && node.weight >= 100 && node.weight <= 900) text.setAttribute("font-weight", String(node.weight));
  applyPaint(text, node);
  return text;
}

function drawVector(document, node, width, height) {
  const kind = ["rectangle", "circle", "polygon", "line", "arrow", "pen"].includes(node.kind) ? node.kind : "";
  if (kind === "pen" || safePath(node.d)) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", safePath(node.d) ? node.d : `M0 0h${Math.max(width, 8)}v${Math.max(height, 8)}h-${Math.max(width, 8)}z`);
    path.setAttribute("data-kind", kind || "pen");
    path.setAttribute('transform', 'scale(' + width / 100 + ' ' + height / 100 + ')');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    applyPaint(path, node);
    return path;
  }
  if (kind === "circle") return painted(document, node, "ellipse", width, height);
  if (kind === "polygon") return polygon(document, node, width, height, Number.isInteger(node.sides) && node.sides >= 3 && node.sides <= 64 ? node.sides : 6);
  if (kind === "line" || kind === "arrow") return strokeLine(document, node, width, height, kind);
  return painted(document, node, "rect", width, height);
}

function drawIcon(document, node, width, height) {
  const name = typeof node.icon === "string" && /^[a-z0-9-]{1,40}$/.test(node.icon) ? node.icon : "unknown";
  const shape = polygon(document, node, Math.max(width, 8), Math.max(height, 8), 4);
  shape.setAttribute("data-icon", name);
  shape.setAttribute("data-kind", "icon");
  return shape;
}

function painted(document, node, tag, width, height) {
  const shape = document.createElementNS(SVG, tag);
  shape.setAttribute("fill", "none");
  shape.setAttribute("data-kind", node.kind || tag);
  if (tag === "ellipse") {
    shape.setAttribute("cx", String(width / 2));
    shape.setAttribute("cy", String(height / 2));
    shape.setAttribute("rx", String(Math.max(width, 8) / 2));
    shape.setAttribute("ry", String(Math.max(height, 8) / 2));
  } else {
    shape.setAttribute("x", "0");
    shape.setAttribute("y", "0");
    shape.setAttribute("width", String(Math.max(width, 8)));
    shape.setAttribute("height", String(Math.max(height, 8)));
    const radius = Number.isFinite(node.radius) && node.radius >= 0 && node.radius <= 8000 ? node.radius : null;
    if (radius != null) shape.setAttribute("rx", String(radius));
  }
  applyPaint(shape, node);
  return shape;
}

function polygon(document, node, width, height, sides) {
  const shape = document.createElementNS(SVG, "polygon");
  shape.setAttribute("data-kind", node.kind || "polygon");
  const points = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides;
    points.push(`${(width / 2 + (width / 2) * Math.cos(angle)).toFixed(2)},${(height / 2 + (height / 2) * Math.sin(angle)).toFixed(2)}`);
  }
  shape.setAttribute("points", points.join(" "));
  applyPaint(shape, node);
  return shape;
}

function strokeLine(document, node, width, height, kind) {
  const group = document.createElementNS(SVG, "g");
  group.setAttribute("data-kind", kind);
  const line = document.createElementNS(SVG, "line");
  line.setAttribute("x1", "0");
  line.setAttribute("y1", String(height / 2));
  line.setAttribute("x2", String(width));
  line.setAttribute("y2", String(height / 2));
  applyPaint(line, node);
  group.append(line);
  if (kind === "arrow") {
    const head = document.createElementNS(SVG, "polygon");
    head.setAttribute("points", `${width},${height / 2} ${Math.max(width - 8, 0)},${height / 2 - 4} ${Math.max(width - 8, 0)},${height / 2 + 4}`);
    applyPaint(head, node);
    group.append(head);
  }
  return group;
}

function applyPaint(shape, node) {
  const fill = paint(node.fill) ?? paint(node.color);
  if (fill) shape.setAttribute("fill", fill);
  const stroke = paint(node.stroke);
  if (stroke) shape.setAttribute("stroke", stroke);
  if (Number.isFinite(node.strokeWidth) && node.strokeWidth >= 0 && node.strokeWidth <= 100) shape.setAttribute("stroke-width", String(node.strokeWidth));
  if (typeof node.dash === "string" && /^[\d .]+$/.test(node.dash)) shape.setAttribute("stroke-dasharray", node.dash);
}

function renderLink(document, board, link) {
  const screens = new Map((board.screens ?? []).map((screen) => [screen.id, screen]));
  if (!screens.has(link.from) || !screens.has(link.to)) {
    const label = document.createElementNS(SVG, "text");
    label.textContent = link.id;
    label.setAttribute("data-link", link.id);
    label.setAttribute("data-unresolved", "true");
    return label;
  }
  const from = screens.get(link.from);
  const to = screens.get(link.to);
  const line = document.createElementNS(SVG, "line");
  line.setAttribute("data-link", link.id);
  line.setAttribute("x1", String(number(from.x) + number(from.w)));
  line.setAttribute("y1", String(number(from.y)));
  line.setAttribute("x2", String(number(to.x)));
  line.setAttribute("y2", String(number(to.y)));
  return line;
}

export function boardBounds(board) {
  const screens = board.screens ?? [];
  if (!screens.length) return { x: -70, y: -100, w: 900, h: 760 };
  const left = Math.min(...screens.map((screen) => number(screen.x)));
  const top = Math.min(...screens.map((screen) => number(screen.y)));
  const right = Math.max(...screens.map((screen) => number(screen.x) + number(screen.w)));
  const bottom = Math.max(...screens.map((screen) => number(screen.y) + number(screen.h)));
  return { x: left - 70, y: top - 140, w: Math.max(900, right - left + 140), h: Math.max(760, bottom - top + 200) };
}

function paint(value) {
  if (value === "none") return "none";
  if (typeof value === "string" && /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return value;
  return null;
}

function safeFont(value) {
  if (typeof value !== "string" || value.length > 80 || /[{}<>;]|url\(|expression|javascript/i.test(value)) return null;
  if (!/^[A-Za-z0-9 ,."-]+$/.test(value)) return null;
  return value;
}

function safePath(value) {
  return typeof value === "string" && value.length <= 100000 && /^[MmLlHhVvCcSsQqTtAaZz0-9eE ,.+-]+$/.test(value);
}

function number(value) {
  return Number.isFinite(value) ? value : 0;
}

function encodeBytes(bytes) {
  let text = "";
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return btoa(text);
}
export function dragNodeGeometry(node, dx, dy, corner = null) {
  const result = { place: { ...node.place }, w: node.w, h: node.h };
  if (corner === null) {
    result.place.x += dx;
    result.place.y += dy;
    return result;
  }
  if (!['nw', 'ne', 'sw', 'se'].includes(corner)) throw new RangeError('Invalid resize corner.');
  const west = corner.includes('w');
  const north = corner.includes('n');
  result.w = Math.min(16000, Math.max(1, node.w + (west ? -dx : dx)));
  result.h = Math.min(16000, Math.max(1, node.h + (north ? -dy : dy)));
  if (west) result.place.x += node.w - result.w;
  if (north) result.place.y += node.h - result.h;
  return result;
}
export function handStrokeNode(id, points, color, marker = false) {
  if (!Array.isArray(points) || points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new RangeError('A stroke needs at least two finite points.');
  }
  if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) throw new RangeError('Invalid stroke color.');
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const width = Math.max(1, Math.max(...points.map((point) => point.x)) - minX);
  const height = Math.max(1, Math.max(...points.map((point) => point.y)) - minY);
  const d = points.map((point, index) => (index === 0 ? 'M' : 'L')
    + ((point.x - minX) * 100 / width).toFixed(3) + ' ' + ((point.y - minY) * 100 / height).toFixed(3)).join(' ');
  return { id, name: marker ? 'Marker stroke' : 'Pen stroke', t: 'vector', kind: 'pen',
    place: { x: minX, y: minY }, w: width, h: height, d, fill: 'none', stroke: color,
    strokeWidth: 2.2, opacity: 1 };
}

export function addBoardFrame(board, id, point, size, colors, sketch = false, language = 'en') {
  if ((board.screens?.length ?? 0) >= 500 || indexNodes(board).size >= 10000) throw new RangeError("The board is full.");
  if (![point.x, point.y, size.w, size.h].every(Number.isFinite)) throw new RangeError("Invalid frame geometry.");
  const label = sketch ? text(language, 'handSketch') : text(language, 'boardFrame');
  const screen = { id, title: label, pageId: board.pages?.[0]?.id ?? "main",
    x: point.x, y: point.y, w: Math.min(16000, Math.max(1, size.w)), h: Math.min(16000, Math.max(1, size.h)),
    root: { id: `${id}-root`, name: label, t: "box", dir: "stack",
      place: { x: 0, y: 0 }, w: Math.min(16000, Math.max(1, size.w)), h: Math.min(16000, Math.max(1, size.h)),
      radius: sketch ? 18 : 0, clip: true, fill: colors.card, stroke: colors.accent, strokeWidth: 2.2, kids: [],
      ...(sketch ? { sketch: true, dash: "6 5" } : {}) } };
  board.screens ??= [];
  board.pages ??= [];
  if (!board.pages.length) board.pages.push({ id: "main", title: "Main", objects: [], order: [], start: null });
  board.screens.push(screen);
  board.pages[0].order ??= [];
  board.pages[0].order.push(id);
  board.pages[0].start ??= id;
  return screen;
}

export function appendBoardNode(board, screenId, parentId, node) {
  const item = indexNodes(board).get(parentId);
  if (!item || item.screen.id !== screenId || item.node.t !== "box" || item.ancestors.length + 1 > 30 || indexNodes(board).size >= 10000) {
    throw new RangeError("The board cannot hold this node.");
  }
  item.node.kids.push(node);
}

export function sketchStroke(board, screen, id, points, color, marker = false) {
  const bounded = points.slice(0, 180).map((point) => ({
    x: Math.max(15, Math.min(285, point.x - screen.x)),
    y: Math.max(24, Math.min(524, point.y - screen.y)),
  }));
  const node = handStrokeNode(id, bounded, color, marker);
  if (marker) node.opacity = 0.4;
  appendBoardNode(board, screen.id, screen.root.id, node);
  return node;
}

export function touchedStrokes(board, from, to = from, tolerance = 4) {
  const found = [];
  for (const item of indexNodes(board).values()) {
    const node = item.node;
    if (node.t !== "vector" || node.kind !== "pen") continue;
    const values = /^\s*M[-\d.eE ,]+(?:\s*L[-\d.eE ,]+)+\s*$/.test(node.d ?? "")
      ? node.d.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)?.map(Number) : null;
    if (!values) continue;
    const points = [];
    for (let i = 0; i < values.length; i += 2) points.push({ x: item.x + values[i] * node.w / 100, y: item.y + values[i + 1] * node.h / 100 });
    for (let i = 1; i < points.length; i += 1) {
      if (segmentsTouch(from, to, points[i - 1], points[i], tolerance + (node.strokeWidth ?? 2.2) / 2)) { found.push(node.id); break; }
    }
  }
  return found;
}

function segmentsTouch(a, b, c, d, radius) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const distance = (p, q, r) => {
    const length = (r.x - q.x) ** 2 + (r.y - q.y) ** 2;
    const t = length ? Math.max(0, Math.min(1, ((p.x - q.x) * (r.x - q.x) + (p.y - q.y) * (r.y - q.y)) / length)) : 0;
    return Math.hypot(p.x - q.x - t * (r.x - q.x), p.y - q.y - t * (r.y - q.y));
  };
  const intersects = cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
    && Math.max(a.x, b.x) >= Math.min(c.x, d.x) && Math.max(c.x, d.x) >= Math.min(a.x, b.x)
    && Math.max(a.y, b.y) >= Math.min(c.y, d.y) && Math.max(c.y, d.y) >= Math.min(a.y, b.y);
  return intersects || Math.min(distance(a, c, d), distance(b, c, d), distance(c, a, b), distance(d, a, b)) <= radius;
}

export function boardColors(document, host) {
  const computed = document.defaultView?.getComputedStyle?.(host);
  const colors = {};
  for (const [name, token] of Object.entries({ text: "--text", accent: "--accent", wait: "--waiting", card: "--card" })) {
    const value = computed?.getPropertyValue(token).trim();
    if (!paint(value) || value === "none") throw new RangeError("The board color is unavailable.");
    colors[name] = value;
  }
  return colors;
}
