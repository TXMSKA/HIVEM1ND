// Sketch format: the document a person draws in Review and an agent reads.
//
// A sketch is Blueprint JSON v1 (see blueprint.md, Sketches), so it is data an
// agent can read and the full Blueprint can open: screens with a tree of
// nodes, and links between screens. This module is the one place that knows
// the shape. The server checks every save with validateSketch, and the page
// draws and edits with the same functions, so a file that was saved is a file
// the page can draw. It uses no browser or Node API, so both import it.

export const SKETCH_PAGE = "sketch";
export const MAX_SKETCH_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_SCREEN = { w: 1440, h: 900 };
export const STROKE_WIDTH = 3;
export const PAPER = "#ffffff";
export const INKS = ["#1c1c1c", "#d93636", "#2563eb", "#1f9d55", "#7c3aed"];
export const FILLS = ["none", "#ffffff", "#e5e7eb", "#fde68a", "#bfdbfe"];

// v1 allows 500 screens and 10,000 nodes in 30 levels; a file past them is
// refused rather than drawn slowly.
const MAX_SCREENS = 500;
const MAX_NODES = 10000;
const MAX_DEPTH = 30;
const MAX_LINKS = 2000;

// v1 ids are letters, digits and hyphens. A sketch also keeps them lowercase,
// because a comment names a screen or an element by the same id and the
// comment file only accepts lowercase names.
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR = /^(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?|none)$/;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]*$/;
const ASSET = /^assets\/[0-9a-f-]{36}\.(png|jpg|webp)$/;
const FONT = /^[\p{L}\p{N} _-]+$/u;

const KINDS = ["rectangle", "circle", "polygon", "line", "arrow", "pen"];
const TYPES = ["box", "text", "vector", "image", "icon"];
const NODE_KEYS = new Set(["id", "name", "t", "dir", "place", "w", "h", "fill", "stroke", "strokeWidth", "radius", "corners", "clip", "opacity", "kind", "sides", "d", "value", "size", "weight", "font", "color", "align", "icon", "src", "kids"]);
const DOC_KEYS = ["formatVersion", "id", "title", "note", "pages", "screens", "links", "components", "fonts", "threads"];
const SCREEN_KEYS = new Set(["id", "title", "pageId", "x", "y", "w", "h", "root"]);
const PAGE_KEYS = new Set(["id", "title", "objects", "order", "start"]);
const LINK_KEYS = new Set(["id", "from", "to", "element", "transition", "direction", "duration", "easing"]);

/** The path v1 gives a circle: a vector node scaled to its box is an ellipse. */
export const CIRCLE = "M50 0 A50 50 0 1 1 49.99 0 Z";

export class SketchError extends Error {
  constructor(message) {
    super(message);
    this.name = "SketchError";
  }
}

// ---- ids -------------------------------------------------------------------

const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** An id shaped like a thread id: a prefix, a base 36 timestamp and six hex digits. */
export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${hex(crypto.getRandomValues(new Uint8Array(3)))}`;
}

function eachNode(nodes, visit) {
  for (const node of nodes ?? []) {
    visit(node);
    eachNode(node.kids, visit);
  }
}

/** Every id the document uses, since v1 wants them unique across pages, screens, nodes and links. */
export function idsOf(doc) {
  const ids = new Set();
  for (const page of doc.pages) ids.add(page.id);
  for (const screen of doc.screens) {
    ids.add(screen.id);
    eachNode([screen.root], (node) => ids.add(node.id));
  }
  for (const link of doc.links) ids.add(link.id);
  return ids;
}

function freshId(doc, prefix) {
  const taken = idsOf(doc);
  let id = newId(prefix);
  while (taken.has(id)) id = newId(prefix);
  return id;
}

// ---- validation ------------------------------------------------------------

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value, low, high) => typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

function fail(path, rule) {
  throw new SketchError(`${path} ${rule}`);
}

function only(object, keys, path) {
  for (const key of Object.keys(object)) if (!keys.has(key)) fail(`${path}.${key}`, "is not part of a Lite sketch.");
}

function checkNode(node, path, depth, seen, count) {
  if (!plain(node)) fail(path, "must be an object.");
  if (depth > MAX_DEPTH) fail(path, `is nested deeper than ${MAX_DEPTH} levels.`);
  if (++count.nodes > MAX_NODES) fail(path, `is past the ${MAX_NODES} nodes a sketch may hold.`);
  void NODE_KEYS;
  if (typeof node.id !== "string" || node.id.length > 80 || !ID.test(node.id)) fail(`${path}.id`, "must be lowercase letters and digits joined by hyphens, at most 80 characters.");
  if (seen.has(node.id)) fail(`${path}.id`, "is used twice in the sketch.");
  seen.add(node.id);
  if (typeof node.name !== "string" || !node.name || node.name.length > 240) fail(`${path}.name`, "must be 1 to 240 characters.");
  if (!TYPES.includes(node.t)) fail(`${path}.t`, `must be one of ${TYPES.join(", ")}.`);
  if (!plain(node.place) || !Number.isFinite(node.place.x) || !Number.isFinite(node.place.y)) fail(`${path}.place`, "must be { x, y } with finite numbers.");
  if (!number(node.w, 1, 16000)) fail(`${path}.w`, "must be a number from 1 to 16000.");
  if (!number(node.h, 1, 16000)) fail(`${path}.h`, "must be a number from 1 to 16000.");
  for (const key of ["fill", "stroke", "color"]) {
    if (node[key] !== undefined && (typeof node[key] !== "string" || !COLOR.test(node[key]))) fail(`${path}.${key}`, "must be #rrggbb, #rrggbbaa or none.");
  }
  if (node.strokeWidth !== undefined && !number(node.strokeWidth, 0, 100)) fail(`${path}.strokeWidth`, "must be a number from 0 to 100.");
  if (node.radius !== undefined && !number(node.radius, 0, 8000)) fail(`${path}.radius`, "must be a number from 0 to 8000.");
  if (node.corners !== undefined && !(Array.isArray(node.corners) && node.corners.length === 4 && node.corners.every((value) => number(value, 0, 8000)))) fail(`${path}.corners`, "must be four numbers from 0 to 8000.");
  if (node.clip !== undefined && typeof node.clip !== "boolean") fail(`${path}.clip`, "must be true or false.");
  if (node.opacity !== undefined && !number(node.opacity, 0, 1)) fail(`${path}.opacity`, "must be a number from 0 to 1.");
  if (node.kind !== undefined && !KINDS.includes(node.kind)) fail(`${path}.kind`, `must be one of ${KINDS.join(", ")}.`);
  if (node.sides !== undefined && !(Number.isInteger(node.sides) && node.sides >= 3 && node.sides <= 64)) fail(`${path}.sides`, "must be a whole number from 3 to 64.");
  if (node.d !== undefined && (typeof node.d !== "string" || node.d.length > 100000)) fail(`${path}.d`, "must be an SVG path of at most 100000 characters.");
  if (node.value !== undefined && (typeof node.value !== "string" || node.value.length > 20000)) fail(`${path}.value`, "must be text of at most 20000 characters.");
  if (node.size !== undefined && !number(node.size, 1, 1000)) fail(`${path}.size`, "must be a number from 1 to 1000.");
  if (node.weight !== undefined && !(Number.isInteger(node.weight) && node.weight >= 100 && node.weight <= 900)) fail(`${path}.weight`, "must be a whole number from 100 to 900.");
  if (node.font !== undefined && (typeof node.font !== "string" || node.font.length > 240)) fail(`${path}.font`, "must be a font family name.");
  if (node.align !== undefined && !["left", "center", "right"].includes(node.align)) fail(`${path}.align`, "must be left, center or right.");
  if (node.icon !== undefined && (typeof node.icon !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(node.icon))) fail(`${path}.icon`, "must be an icon name.");
  if (node.src !== undefined && (typeof node.src !== "string" || !ASSET.test(node.src))) fail(`${path}.src`, "must be assets/<uuid>.png, .jpg or .webp.");
  if (node.t === "box") {
    if (node.dir !== "stack") fail(`${path}.dir`, 'must be "stack" on a box.');
    if (!Array.isArray(node.kids)) fail(`${path}.kids`, "must be a list on a box.");
  } else if (node.dir !== undefined) {
    fail(`${path}.dir`, "belongs to a box.");
  }
  if (node.kids !== undefined) {
    if (node.t !== "box" || !Array.isArray(node.kids)) fail(`${path}.kids`, "must be a list of nodes, on a box.");
    node.kids.forEach((kid, index) => checkNode(kid, `${path}.kids[${index}]`, depth + 1, seen, count));
  }
  if (node.t === "vector" && !node.d) fail(`${path}.d`, "is required on a vector.");
  if (node.t === "image" && !node.src) fail(`${path}.src`, "is required on an image.");
  if (node.t === "text" && typeof node.value !== "string") fail(`${path}.value`, "is required on text.");
}

/**
 * Checks a sketch against Blueprint JSON v1 as Lite uses it: the v1 shape and
 * limits, with the subset of node fields Lite draws, lowercase ids, one empty
 * list each for components, fonts and threads (comments live in
 * comments/<board>.json), and no objects outside screens. A link may join
 * screens of the sketch and screens of the board module; the page ignores a
 * link whose end it cannot find, so only the shape is checked here. Returns a
 * copy; throws SketchError naming the first field that is wrong.
 */
export function validateSketch(value) {
  if (!plain(value)) fail("The sketch", "must be an object.");
  for (const key of DOC_KEYS) if (!(key in value)) fail(key, "is missing.");
  if (value.formatVersion !== 1) fail("formatVersion", "must be 1.");
  if (typeof value.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id)) fail("id", "must be letters, digits and hyphens, at most 80 characters.");
  if (typeof value.title !== "string" || !value.title || value.title.length > 240) fail("title", "must be 1 to 240 characters.");
  if (typeof value.note !== "string" || value.note.length > 100000) fail("note", "must be text of at most 100000 characters.");
  for (const key of ["components", "fonts", "threads"]) {
    if (!Array.isArray(value[key])) fail(key, "must be a list.");
  }
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 100) fail("pages", "must be a list of 1 to 100 pages.");
  if (!Array.isArray(value.screens) || value.screens.length > MAX_SCREENS) fail("screens", `must be a list of at most ${MAX_SCREENS} screens.`);
  if (!Array.isArray(value.links) || value.links.length > MAX_LINKS) fail("links", `must be a list of at most ${MAX_LINKS} links.`);

  const seen = new Set();
  const count = { nodes: 0 };
  const take = (id, path) => {
    if (typeof id !== "string" || id.length > 80 || !ID.test(id)) fail(path, "must be lowercase letters and digits joined by hyphens, at most 80 characters.");
    if (seen.has(id)) fail(path, "is used twice in the sketch.");
    seen.add(id);
  };

  value.pages.forEach((page, index) => {
    const path = `pages[${index}]`;
    if (!plain(page)) fail(path, "must be an object.");
    void PAGE_KEYS;
    take(page.id, `${path}.id`);
    if (typeof page.title !== "string" || !page.title || page.title.length > 240) fail(`${path}.title`, "must be 1 to 240 characters.");
    if (!Array.isArray(page.objects)) fail(`${path}.objects`, "must be a list.");
    if (!Array.isArray(page.order) || page.order.length > 500 || new Set(page.order).size !== page.order.length) fail(`${path}.order`, "must list each screen once.");
    if (page.start !== undefined && typeof page.start !== "string") fail(`${path}.start`, "must be a screen id.");
  });

  const members = new Map();
  value.screens.forEach((screen, index) => {
    const path = `screens[${index}]`;
    if (!plain(screen)) fail(path, "must be an object.");
    void SCREEN_KEYS;
    take(screen.id, `${path}.id`);
    if (typeof screen.title !== "string" || !screen.title || screen.title.length > 240) fail(`${path}.title`, "must be 1 to 240 characters.");
    if (!value.pages.some((page) => page.id === screen.pageId)) fail(`${path}.pageId`, "must name a page of the sketch.");
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) fail(`${path}.x`, "and y must be finite numbers.");
    if (!number(screen.w, 1, 16000) || !number(screen.h, 1, 16000)) fail(`${path}.w`, "and h must be numbers from 1 to 16000.");
    checkNode(screen.root, `${path}.root`, 1, seen, count);
    if (screen.root.t !== "box") fail(`${path}.root.t`, "must be a box.");
    if (screen.root.place.x !== 0 || screen.root.place.y !== 0) fail(`${path}.root.place`, "must be { x: 0, y: 0 }.");
    if (screen.root.w !== screen.w || screen.root.h !== screen.h) fail(`${path}.root`, "must be as wide and tall as its screen.");
    const own = new Set();
    eachNode([screen.root], (item) => own.add(item.id));
    members.set(screen.id, own);
  });

  for (const [index, page] of value.pages.entries()) {
    const own = value.screens.filter((screen) => screen.pageId === page.id).map((screen) => screen.id);
    if (page.order.some((id) => !own.includes(id))) fail(`pages[${index}].order`, "names a screen that is not on the page.");
    if (page.start !== undefined && !own.includes(page.start)) fail(`pages[${index}].start`, "names a screen that is not on the page.");
  }

  value.links.forEach((link, index) => {
    const path = `links[${index}]`;
    if (!plain(link)) fail(path, "must be an object.");
    void LINK_KEYS;
    take(link.id, `${path}.id`);
    for (const end of ["from", "to"]) {
      if (typeof link[end] !== "string" || !ID.test(link[end]) || link[end].length > 80) fail(`${path}.${end}`, "must be a screen id.");
    }
    if (link.from === link.to) fail(path, "must join two different screens.");
    // A link that leaves a screen of the board module has no element to check here.
    if (link.element !== undefined && !members.get(link.from)?.has(link.element)) fail(`${path}.element`, "must name a node of the sketch screen the link leaves.");
    if (!["cut", "fade", "slide"].includes(link.transition)) fail(`${path}.transition`, "must be cut, fade or slide.");
    if (link.direction !== undefined && !["left", "right", "up", "down"].includes(link.direction)) fail(`${path}.direction`, "must be left, right, up or down.");
    if (link.duration !== undefined && !(Number.isInteger(link.duration) && link.duration >= 0 && link.duration <= 10000)) fail(`${path}.duration`, "must be a whole number from 0 to 10000.");
    if (link.easing !== undefined && !["ease-out", "ease-in-out", "linear"].includes(link.easing)) fail(`${path}.easing`, "must be ease-out, ease-in-out or linear.");
  });

  return JSON.parse(JSON.stringify(value));
}

// ---- building --------------------------------------------------------------

export function newSketch(board, title) {
  return {
    formatVersion: 1,
    id: board,
    title: title || board,
    note: "",
    pages: [{ id: SKETCH_PAGE, title: "Sketch", objects: [], order: [] }],
    screens: [],
    links: [],
    components: [],
    fonts: [],
    threads: [],
  };
}

const find = (doc, id) => doc.screens.find((screen) => screen.id === id);
export const findScreen = find;

export function findNode(screen, id) {
  let found = null;
  eachNode([screen.root], (node) => {
    if (node.id === id) found = node;
  });
  return found;
}

/** A screen is a frame on the board: the paper is its root box, and the shapes drawn on it are the kids of that box. */
export function addScreen(doc, { title, x, y, w = DEFAULT_SCREEN.w, h = DEFAULT_SCREEN.h, fill = PAPER, id = freshId(doc, "s") }) {
  const screen = {
    id,
    title,
    pageId: SKETCH_PAGE,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    root: {
      id: freshId(doc, "n"),
      name: title,
      t: "box",
      dir: "stack",
      place: { x: 0, y: 0 },
      w: Math.round(w),
      h: Math.round(h),
      fill,
      kids: [],
    },
  };
  doc.screens.push(screen);
  doc.pages.find((page) => page.id === SKETCH_PAGE).order.push(id);
  return screen;
}

export function removeScreen(doc, id) {
  doc.screens = doc.screens.filter((screen) => screen.id !== id);
  doc.links = doc.links.filter((link) => link.from !== id && link.to !== id);
  for (const page of doc.pages) {
    page.order = page.order.filter((entry) => entry !== id);
    if (page.start === id) delete page.start;
  }
}

/** The nodes of a screen whose id is in the list go; a link that left one of them goes with it. */
export function removeNode(doc, screen, id) {
  const gone = new Set();
  const drop = (parent) => {
    parent.kids = parent.kids.filter((kid) => {
      if (kid.id === id) {
        eachNode([kid], (node) => gone.add(node.id));
        return false;
      }
      if (kid.kids) drop(kid);
      return true;
    });
  };
  drop(screen.root);
  doc.links = doc.links.filter((link) => !(link.from === screen.id && gone.has(link.element)));
  return gone.size > 0;
}

/** An arrow from one screen to another; the same pair twice is one arrow. */
export function addLink(doc, from, to) {
  if (!from || !to || from === to) return null;
  if (doc.links.some((link) => link.from === from && link.to === to && link.element === undefined)) return null;
  const link = { id: freshId(doc, "l"), from, to, transition: "cut" };
  doc.links.push(link);
  return link;
}

export function removeLink(doc, id) {
  const before = doc.links.length;
  doc.links = doc.links.filter((link) => link.id !== id);
  return doc.links.length < before;
}

function node(doc, fields) {
  return { id: freshId(doc, "n"), ...fields };
}

const stroked = (style) => ({ stroke: style.stroke, strokeWidth: STROKE_WIDTH, fill: style.fill });

export function rectangleNode(doc, box, style) {
  return node(doc, { name: "Rectangle", t: "box", dir: "stack", kind: "rectangle", place: { x: box.x, y: box.y }, w: box.w, h: box.h, ...stroked(style), radius: 0, kids: [] });
}

export function ellipseNode(doc, box, style) {
  return node(doc, { name: "Ellipse", t: "vector", kind: "circle", place: { x: box.x, y: box.y }, w: box.w, h: box.h, d: CIRCLE, ...stroked(style) });
}

/** A line from `a` to `b`, which are points in the screen. The path runs from corner to corner of the box, so a line that rises is a mirrored path. */
export function lineNode(doc, a, b, style) {
  const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(1, Math.abs(a.x - b.x)), h: Math.max(1, Math.abs(a.y - b.y)) };
  const unit = (point, from, size) => (size > 1 ? Math.round(((point - from) / size) * 10000) / 100 : 50);
  const d = `M${unit(a.x, box.x, box.w)} ${unit(a.y, box.y, box.h)} L${unit(b.x, box.x, box.w)} ${unit(b.y, box.y, box.h)}`;
  return node(doc, { name: "Line", t: "vector", kind: "line", place: { x: box.x, y: box.y }, w: box.w, h: box.h, d, stroke: style.stroke, strokeWidth: STROKE_WIDTH, fill: "none" });
}

/** Drops the points that add under `tolerance` pixels of detail (Ramer-Douglas-Peucker), so a long stroke stays a short path. */
export function simplify(points, tolerance = 1.2) {
  if (points.length < 3) return points;
  const [first, last] = [points[0], points.at(-1)];
  const span = Math.hypot(last.x - first.x, last.y - first.y);
  let far = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    const away = span === 0 ? Math.hypot(p.x - first.x, p.y - first.y) : Math.abs((last.x - first.x) * (first.y - p.y) - (first.x - p.x) * (last.y - first.y)) / span;
    if (away > far) [far, at] = [away, i];
  }
  if (far <= tolerance) return [first, last];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

/** A freehand stroke through `points` (screen coordinates), as a v1 vector of kind pen. A stroke that never left its starting point is not one. */
export function penNode(doc, points, style) {
  if (points.length < 2) return null;
  const kept = simplify(points);
  const xs = kept.map((p) => p.x);
  const ys = kept.map((p) => p.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys) };
  box.w = Math.max(...xs) - box.x;
  box.h = Math.max(...ys) - box.y;
  if (box.w < 2 && box.h < 2) return null;
  const unit = (point, from, size) => (size > 0 ? Math.round(((point - from) / size) * 10000) / 100 : 50);
  const d = kept.map((p, i) => `${i ? "L" : "M"}${unit(p.x, box.x, box.w)} ${unit(p.y, box.y, box.h)}`).join(" ");
  const tenth = (value) => Math.round(value * 10) / 10;
  return node(doc, { name: "Pen stroke", t: "vector", kind: "pen", place: { x: tenth(box.x), y: tenth(box.y) }, w: Math.max(1, tenth(box.w)), h: Math.max(1, tenth(box.h)), d, stroke: style.stroke, strokeWidth: STROKE_WIDTH, fill: "none" });
}

const widthOf = (line, size) => line.length * size * 0.56;

/** The box text takes at a size. `measure(line, size)` is the page's real measure; the default is a rough one for a caller without a canvas. */
export function textBox(value, size, measure = widthOf) {
  const lines = String(value).split("\n");
  return { w: Math.max(1, Math.ceil(Math.max(...lines.map((line) => measure(line, size))) + 2)), h: Math.ceil(lines.length * size * 1.3) };
}

export function textNode(doc, at, value, style, size = 24, measure) {
  const box = textBox(value, size, measure);
  return node(doc, { name: "Text", t: "text", place: { x: at.x, y: at.y }, ...box, value, size, weight: 500, color: style.stroke, align: "left" });
}

export function imageNode(doc, box, src, name = "Image") {
  return node(doc, { name, t: "image", place: { x: box.x, y: box.y }, w: box.w, h: box.h, src });
}

// ---- geometry --------------------------------------------------------------

/** The box of a node in its parent. */
export const boxOf = (item) => ({ x: item.place.x, y: item.place.y, w: item.w, h: item.h });

/**
 * The box a drag of `handle` (n, ne, e, se, s, sw, w, nw) gives, by `dx` and
 * `dy` from the box it started on. Dragged past the opposite side, the box
 * flips: `flipX` or `flipY` says so, and a drawn path is mirrored to match.
 */
export function dragHandle(box, handle, dx, dy, min = 1) {
  let x1 = box.x;
  let y1 = box.y;
  let x2 = box.x + box.w;
  let y2 = box.y + box.h;
  if (handle.includes("w")) x1 += dx;
  if (handle.includes("e")) x2 += dx;
  if (handle.includes("n")) y1 += dy;
  if (handle.includes("s")) y2 += dy;
  const flipX = x2 < x1;
  const flipY = y2 < y1;
  const [left, right] = flipX ? [x2, x1] : [x1, x2];
  const [top, bottom] = flipY ? [y2, y1] : [y1, y2];
  return { x: left, y: top, w: Math.max(min, right - left), h: Math.max(min, bottom - top), flipX, flipY };
}

/** Mirrors a path made of M, L and Z in the 100 by 100 box; any other path is returned as it is. */
export function mirrorPath(d, flipX, flipY) {
  if (/[^MLZ0-9.,\s-]/.test(d)) return d;
  let at = 0;
  return d.replace(/-?\d*\.?\d+/g, (token) => {
    const axis = at % 2;
    at += 1;
    const v = Number(token);
    return String(Math.round(((axis === 0 ? flipX : flipY) ? 100 - v : v) * 100) / 100);
  });
}

/** Puts a node in a box; a flip mirrors its path. Text is not resized here: the page changes its font size and measures it. */
export function placeNode(item, box) {
  item.place = { x: Math.round(box.x), y: Math.round(box.y) };
  item.w = Math.max(1, Math.round(box.w));
  item.h = Math.max(1, Math.round(box.h));
  if (item.t === "vector" && item.d !== CIRCLE && (box.flipX || box.flipY)) item.d = mirrorPath(item.d, box.flipX, box.flipY);
}

/** A screen takes the same box; the paper follows it. */
export function placeScreen(screen, box) {
  screen.x = Math.round(box.x);
  screen.y = Math.round(box.y);
  screen.w = Math.max(1, Math.round(box.w));
  screen.h = Math.max(1, Math.round(box.h));
  screen.root.w = screen.w;
  screen.root.h = screen.h;
}

/** The point on the board where the next screen goes: under every screen when there is none of the sketch yet, otherwise right of the last one. */
export function freeSpot(doc, boardScreens, size = DEFAULT_SCREEN, gap = { x: 360, y: 420 }) {
  if (doc.screens.length) {
    const last = doc.screens.at(-1);
    return { x: last.x + last.w + gap.x, y: last.y };
  }
  const all = boardScreens.map((screen) => ({ x: screen.x, y: screen.y, w: screen.w, h: screen.h }));
  if (!all.length) return { x: 0, y: 0 };
  return { x: Math.min(...all.map((box) => box.x)), y: Math.max(...all.map((box) => box.y + box.h)) + gap.y };
}

/**
 * What an outside edit changed, by screen of `after`: its id and title, the ids
 * of the shapes that are new or differ, and `whole` when the screen itself is
 * new, was moved, resized or renamed, or lost a shape, so there is no shape to
 * point at. A shape is compared with what it holds, so a change inside a group
 * is a change of the group. An arrow is not a screen and is not listed.
 */
export function diffSketch(before, after) {
  const was = new Map(before.screens.map((screen) => [screen.id, screen]));
  const changed = [];
  for (const screen of after.screens) {
    const old = was.get(screen.id);
    if (!old) {
      changed.push({ id: screen.id, title: screen.title, nodes: [], whole: true });
      continue;
    }
    const kept = new Map(old.root.kids.map((kid) => [kid.id, JSON.stringify(kid)]));
    const nodes = screen.root.kids.filter((kid) => kept.get(kid.id) !== JSON.stringify(kid)).map((kid) => kid.id);
    const ids = new Set(screen.root.kids.map((kid) => kid.id));
    const frame = (item) => [item.title, item.x, item.y, item.w, item.h].join("|");
    const whole = frame(old) !== frame(screen) || old.root.kids.some((kid) => !ids.has(kid.id));
    if (whole || nodes.length) changed.push({ id: screen.id, title: screen.title, nodes, whole });
  }
  return changed;
}

// ---- drawing ---------------------------------------------------------------

const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (value) => String(Math.round(value * 100) / 100);

/** A path of M, L and Z scaled from the 100 by 100 box to w by h, so a stroke keeps its width however the shape is stretched. */
function scaledPath(d, w, h) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  const out = [];
  let at = 0;
  for (const token of tokens) {
    if (/[A-Za-z]/.test(token)) {
      if (!/[MLZ]/.test(token)) return null;
      out.push(token);
      at = 0;
    } else {
      out.push(num(Number(token) * (at % 2 === 0 ? w / 100 : h / 100)));
      at += 1;
    }
  }
  return out.join(" ").replace(/([MLZ]) /g, "$1");
}

function paint(item, filled) {
  const stroke = item.stroke && item.stroke !== "none" ? item.stroke : null;
  return [
    `fill="${item.fill && filled !== false ? item.fill : "none"}"`,
    stroke ? `stroke="${stroke}" stroke-width="${item.strokeWidth ?? STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function drawNode(item, at, out, rects, assets, prefix) {
  const x = at.x + item.place.x;
  const y = at.y + item.place.y;
  const label = esc(item.name);
  const opacity = item.opacity !== undefined && item.opacity < 1 ? ` opacity="${item.opacity}"` : "";
  rects.set(item.id, { x, y, w: item.w, h: item.h });
  const open = `<g class="sk-node" data-name="${item.id}" data-label="${label}"${opacity}>`;
  if (item.t === "box") {
    const radius = item.corners ? item.corners[0] : (item.radius ?? 0);
    // An outline is picked by its edge, which a wide invisible stroke makes easy to find; the inside is left to what lies under it.
    out.push(`${open}<rect x="${num(x)}" y="${num(y)}" width="${num(item.w)}" height="${num(item.h)}" rx="${num(radius)}" ${paint(item)}/><rect class="sk-grab" x="${num(x)}" y="${num(y)}" width="${num(item.w)}" height="${num(item.h)}" rx="${num(radius)}"/>`);
    let clip = "";
    if (item.clip) {
      const id = `${prefix}-clip-${item.id}`;
      out.push(`<clipPath id="${id}"><rect x="${num(x)}" y="${num(y)}" width="${num(item.w)}" height="${num(item.h)}" rx="${num(radius)}"/></clipPath>`);
      clip = ` clip-path="url(#${id})"`;
    }
    out.push(`<g${clip}>`);
    for (const kid of item.kids ?? []) drawNode(kid, { x, y }, out, rects, assets, prefix);
    out.push("</g></g>");
  } else if (item.t === "vector") {
    if (item.d === CIRCLE) {
      const shape = `cx="${num(x + item.w / 2)}" cy="${num(y + item.h / 2)}" rx="${num(item.w / 2)}" ry="${num(item.h / 2)}"`;
      out.push(`${open}<ellipse ${shape} ${paint(item)}/><ellipse class="sk-grab" ${shape}/></g>`);
    } else {
      const closed = item.kind !== "line" && item.kind !== "pen" && item.kind !== "arrow";
      const scaled = scaledPath(item.d, item.w, item.h);
      const move = `translate(${num(x)} ${num(y)})`;
      // A path with curves is stretched whole, and its stroke is evened out so the stretch hardly shows.
      const geometry = scaled
        ? `d="${esc(scaled)}" transform="${move}"`
        : `d="${esc(item.d)}" transform="${move} scale(${num(item.w / 100)} ${num(item.h / 100)})"`;
      const width = scaled ? (item.strokeWidth ?? STROKE_WIDTH) : (item.strokeWidth ?? STROKE_WIDTH) / Math.sqrt((item.w / 100) * (item.h / 100) || 1);
      const attrs = paint({ ...item, strokeWidth: num(width) }, closed);
      out.push(`${open}<path ${geometry} ${attrs}/><path class="sk-grab" ${geometry}/></g>`);
    }
  } else if (item.t === "text") {
    const size = item.size ?? 24;
    const anchor = { left: "start", center: "middle", right: "end" }[item.align ?? "left"];
    const from = (item.align === "center" ? item.w / 2 : item.align === "right" ? item.w : 0) + x;
    const lines = String(item.value).split("\n");
    const spans = lines.map((line, i) => `<tspan x="${num(from)}" y="${num(y + size * (1.05 + i * 1.3))}">${esc(line) || "&#160;"}</tspan>`).join("");
    const family = item.font ? ` font-family="${esc(item.font)}"` : "";
    out.push(`${open}<rect class="sk-hit" x="${num(x)}" y="${num(y)}" width="${num(item.w)}" height="${num(item.h)}"/><text class="sk-text"${family} font-size="${num(size)}" font-weight="${item.weight ?? 500}" fill="${item.color ?? "#1c1c1c"}" text-anchor="${anchor}">${spans}</text></g>`);
  } else if (item.t === "image") {
    const file = item.src.slice("assets/".length);
    out.push(`${open}<image href="${assets}/${file}" x="${num(x)}" y="${num(y)}" width="${num(item.w)}" height="${num(item.h)}" preserveAspectRatio="none"/></g>`);
  } else {
    out.push(`${open}<rect x="${num(x)}" y="${num(y)}" width="${num(item.w)}" height="${num(item.h)}" fill="none" stroke="#6e6e6e" stroke-dasharray="4 3"/></g>`);
  }
}

/**
 * A sketch screen as SVG, to sit inside the screen's own <svg>. `rects` maps
 * each node id to its box in the screen, which is what comments and links pin
 * to. `assets` is where the page serves docs/flows/assets/ from.
 */
export function renderScreen(screen, { assets = "/assets", prefix = "sk" } = {}) {
  const out = [];
  const rects = new Map();
  const root = screen.root;
  out.push(`<rect width="${num(screen.w)}" height="${num(screen.h)}" fill="${root.fill && root.fill !== "none" ? root.fill : PAPER}"/>`);
  for (const kid of root.kids) drawNode(kid, { x: 0, y: 0 }, out, rects, assets, `${prefix}-${screen.id}`);
  return { svg: out.join(""), rects };
}
