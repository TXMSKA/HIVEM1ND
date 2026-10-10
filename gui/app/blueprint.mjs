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
  if (node.name) group.setAttribute("data-name", String(node.name));
  group.setAttribute("transform", `translate(${number(node.place?.x)} ${number(node.place?.y)})`);
  group.append(drawNode(document, node, editor));
  for (const child of node.kids ?? []) group.append(renderNode(document, child, editor));
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

function acceptBoard(editor, data) {
  if (!data) return;
  editor.revision = data.revision;
  editor.baseRevision = editor.dirty ? editor.baseRevision : data.revision;
  editor.authoritative = { ...editor.authoritative, ...data, document: data.document };
}

function hitNode(node, point) {
  if (!node) return null;
  const rect = { x: number(node.place?.x), y: number(node.place?.y), w: number(node.w), h: number(node.h) };
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

function drawNode(document, node, editor) {
  const width = number(node.w);
  const height = number(node.h);
  if (node.t === "text") {
    const text = document.createElementNS(SVG, "text");
    text.textContent = String(node.value ?? "");
    text.setAttribute("x", "0");
    text.setAttribute("y", String(Math.min(height, 16)));
    const color = paint(node.color);
    if (color) text.setAttribute("fill", color);
    const font = safeFont(node.font);
    if (font) text.setAttribute("font-family", font);
    return text;
  }
  if (node.t === "vector" && safePath(node.d)) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", node.d);
    const fill = paint(node.fill);
    if (fill) path.setAttribute("fill", fill);
    return path;
  }
  if (node.t === "image") {
    const image = document.createElementNS(SVG, "image");
    image.setAttribute("data-src", String(node.src ?? ""));
    image.setAttribute("width", String(width));
    image.setAttribute("height", String(height));
    const stored = editor.assets?.get(node.src);
    if (stored?.url?.startsWith("blob:")) image.setAttribute("href", stored.url);
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
  const fill = paint(node.fill) ?? paint(node.color);
  if (fill) shape.setAttribute("fill", fill);
  return shape;
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
