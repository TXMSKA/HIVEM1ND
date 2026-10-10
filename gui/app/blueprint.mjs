import { createOperation, fetchAsset, request } from "./api.mjs";

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

export function indexNodes(document) {
  const nodes = new Map();
  for (const screen of document?.screens ?? []) walk(screen?.root, screen, []);
  return nodes;

  function walk(node, screen, ancestors) {
    if (!node?.id) return;
    nodes.set(node.id, { node, screen, ancestors });
    for (const child of node.kids ?? []) walk(child, screen, [...ancestors, node]);
  }
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
  const board = editor.authoritative?.document ?? editor.document;
  host.replaceChildren();
  if (!board) return;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "board-svg");
  const bounds = boardBounds(board);
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
    group.append(renderNode(document, screen.root, editor));
    svg.append(group);
  }
  host.append(svg);
}

export function renderNode(document, node, editor) {
  const group = document.createElementNS(SVG, "g");
  if (!node) return group;
  group.setAttribute("data-node", node.id);
  if (editor.focus?.nodeId && node.id === editor.focus.nodeId) group.setAttribute("data-highlight", "true");
  if (node.name) group.setAttribute("data-name", String(node.name));
  group.setAttribute("transform", `translate(${number(node.place?.x)} ${number(node.place?.y)})`);
  const body = node.clip === true ? clippedGroup(document, group, node) : group;
  body.append(drawNode(document, node, editor));
  for (const child of node.kids ?? []) body.append(renderNode(document, child, editor));
  return group;
}

export async function patchNode(api, editor, nodeId, fields) {
  const change = updateNodeOperation(editor, nodeId, fields);
  const operation = createOperation({
    method: "PATCH",
    path: "/blueprint/boards/:resourceId/nodes/:nodeId",
    params: { resourceId: editor.resourceId, nodeId },
    body: { changes: change.changes, expectedRevision: change.expectedRevision },
  });
  const result = await request(api, "PATCH", operation.path, { operation });
  acceptBoard(editor, result.data);
  return result;
}

export async function addNode(api, editor, body) {
  const operation = createOperation({
    method: "POST",
    path: "/blueprint/boards/:resourceId/nodes",
    params: { resourceId: editor.resourceId },
    body: { ...body, expectedRevision: editor.revision },
  });
  const result = await request(api, "POST", operation.path, { operation });
  acceptBoard(editor, result.data.editor);
  return result;
}

export async function removeNode(api, editor, nodeId) {
  const operation = createOperation({
    method: "DELETE",
    path: "/blueprint/boards/:resourceId/nodes/:nodeId",
    params: { resourceId: editor.resourceId, nodeId },
    body: { expectedRevision: editor.revision },
  });
  const result = await request(api, "DELETE", operation.path, { operation });
  acceptBoard(editor, result.data);
  return result;
}

export async function replaceBoard(api, editor, document) {
  const operation = createOperation({
    method: "PUT",
    path: "/blueprint/boards/:resourceId",
    params: { resourceId: editor.resourceId },
    body: { document, expectedRevision: editor.revision },
  });
  const result = await request(api, "PUT", operation.path, { operation });
  acceptBoard(editor, result.data);
  editor.dirty = false;
  editor.conflict = null;
  return result;
}

export async function uploadAsset(api, editor, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > 10 * 1024 * 1024) throw Object.assign(new Error("The asset is too large."), { code: "asset_too_large" });
  const operation = createOperation({
    method: "POST",
    path: "/editors/:resourceId/assets",
    params: { resourceId: editor.resourceId },
    body: { contentType: file.type, bytesBase64: encodeBytes(bytes) },
  });
  const result = await request(api, "POST", operation.path, { operation });
  const image = await fetchAsset(api, result.data);
  if (!editor.assets) editor.assets = new Map();
  editor.assets.set(result.data.src, image);
  return { ...result.data, objectUrl: image.url, revoke: image.revoke };
}

export function releaseAssets(editor) {
  for (const image of editor?.assets?.values?.() ?? []) image.revoke?.();
  editor?.assets?.clear?.();
}

const ASSET_SRC = /^docs\/flows\/assets\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.(?:png|jpe?g|webp)$/;

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
      if (clip && !inside(clip, point)) continue;
      const found = hitNode(node.kids[index], childPoint);
      if (found) return found;
    }
  }
  if (!inside(rect, point)) return null;
  if (node.kind === "circle" && !inEllipse(rect, point)) return null;
  return node.id;
}

function inside(rect, point) {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.w && point.y <= rect.y + rect.h;
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
  }
  applyPaint(shape, node);
  return shape;
}

function drawText(document, node, height) {
  const text = document.createElementNS(SVG, "text");
  text.textContent = String(node.value ?? "");
  text.setAttribute("x", "0");
  text.setAttribute("y", String(Math.min(Math.max(height, 8), 16)));
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
  if (Number.isFinite(node.opacity) && node.opacity >= 0 && node.opacity <= 1) shape.setAttribute("opacity", String(node.opacity));
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

function boardBounds(board) {
  const screens = board.screens ?? [];
  if (!screens.length) return { x: 0, y: 0, w: 1, h: 1 };
  const left = Math.min(...screens.map((screen) => number(screen.x)));
  const top = Math.min(...screens.map((screen) => number(screen.y)));
  const right = Math.max(...screens.map((screen) => number(screen.x) + number(screen.w)));
  const bottom = Math.max(...screens.map((screen) => number(screen.y) + number(screen.h)));
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
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
  return typeof value === "string" && value.length <= 4000 && /^[MmLlHhVvCcSsQqTtAaZz0-9eE ,.-]+$/.test(value);
}

function number(value) {
  return Number.isFinite(value) ? value : 0;
}

function encodeBytes(bytes) {
  let text = "";
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return btoa(text);
}
