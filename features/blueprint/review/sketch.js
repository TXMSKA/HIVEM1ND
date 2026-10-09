// Sketch: the part of Review where a person draws screens for an agent to read.
//
// The drawing is a Blueprint JSON v1 document (sketch-format.mjs) held in
// memory, changed by the tools below and saved to
// docs/flows/sketches/<board>.json a moment after every change. The viewer
// draws it among the other screens of the board; this module owns the
// document, the tools, the undo history and the saving, and asks review.js,
// through `host`, for what only the viewer knows: where the camera is, which
// screens are on the board and how to redraw one.

import {
  DEFAULT_SCREEN,
  FILLS,
  INKS,
  MAX_IMAGE_BYTES,
  addLink,
  addScreen,
  boxOf,
  diffSketch,
  dragHandle,
  ellipseNode,
  findNode,
  findScreen,
  freeSpot,
  imageNode,
  lineNode,
  penNode,
  placeNode,
  placeScreen,
  rectangleNode,
  removeLink,
  removeNode,
  removeScreen,
  renderScreen,
  textBox,
  textNode,
} from "./sketch-format.mjs";

const SAVE_MS = 600;
const HISTORY_STEPS = 100;
const HISTORY_BYTES = 30 * 1024 * 1024;
// A press that moves less than this is a click.
const CLICK = 3;
// The reach of a handle or a line, in page pixels: 24 square at the least.
const GRAB = 12;
const NUDGE_MS = 800;
const PICTURES = ["image/png", "image/jpeg", "image/webp"];
const REFERENCE_MAX = { w: 1440, h: 2400 };
const SHAPE = { w: 240, h: 160 };
const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CORNERS = ["nw", "ne", "se", "sw"];

// Lucide icons, as the rest of Review draws them.
const ICONS = {
  select: `<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>`,
  screen: `<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8m-4-4v4"/>`,
  rectangle: `<rect width="18" height="18" x="3" y="3" rx="2"/>`,
  ellipse: `<circle cx="12" cy="12" r="10"/>`,
  line: `<path d="M5 12h14"/>`,
  pen: `<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4"/>`,
  text: `<path d="M12 4v16M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2M9 20h6"/>`,
  arrow: `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>`,
  image: `<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`,
  reference: `<path d="m22 11l-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"/><path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><circle cx="13" cy="7" r="1"/><rect width="14" height="14" x="8" y="2" rx="2"/>`,
  previous: `<path d="m15 18l-6-6l6-6"/>`,
  next: `<path d="m9 18l6-6l-6-6"/>`,
  undo: `<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>`,
  redo: `<path d="m15 14l5-5l-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>`,
  remove: `<path d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
};

const TOOLS = [
  { id: "select", name: "Select", key: "V" },
  { id: "screen", name: "Screen", key: "F" },
  { id: "rectangle", name: "Rectangle", key: "R" },
  { id: "ellipse", name: "Ellipse", key: "O" },
  { id: "line", name: "Line", key: "L" },
  { id: "pen", name: "Pen", key: "P" },
  { id: "text", name: "Text", key: "T" },
  { id: "arrow", name: "Arrow between screens", key: "A" },
];
const INK_NAMES = ["Ink", "Red", "Blue", "Green", "Violet"];
const FILL_NAMES = ["No fill", "White", "Grey", "Yellow", "Blue"];

const hint = {
  select: "Click a shape to select it. Drag it to move it, or a handle to resize it.",
  screen: "Drag on the board to draw a screen, or click for a standard one.",
  rectangle: "Drag on a sketch screen to draw a rectangle.",
  ellipse: "Drag on a sketch screen to draw an ellipse.",
  line: "Drag on a sketch screen to draw a line.",
  pen: "Draw freehand on a sketch screen.",
  text: "Click on a sketch screen, then type.",
  arrow: "Press on a screen and drag to another to join them.",
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from a point to the segment `a` to `b`. */
function away(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : clamp(((p.x - a[0]) * dx + (p.y - a[1]) * dy) / length, 0, 1);
  return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy));
}

export function createSketch(host) {
  const { $, stage, status, esc } = host;
  const bar = $("#sketchbar");
  const editor = $("#sketch-text");
  const picker = $("#sketch-file");
  const card = $("#reference");
  const family = getComputedStyle(document.documentElement).getPropertyValue("--bp-font").trim();
  const canvas = document.createElement("canvas").getContext("2d");
  const measure = (line, size) => {
    canvas.font = `500 ${size}px ${family}`;
    return canvas.measureText(line).width;
  };

  // The open board's sketch. `doc` is null when the file cannot be used, and
  // `problem` says why; nothing is drawn or saved then.
  let entry = null;
  let doc = null;
  let problem = "";
  let revision = "";
  let tool = "select";
  const style = { stroke: INKS[0], fill: "none" };
  let selection = null;
  let drag = null;
  let draft = null;
  // An arrow being aimed with the keyboard: the screen it leaves and the one it points at.
  let aiming = null;
  let editing = null;
  let dirty = false;
  let writing = null;
  let saveTimer = 0;
  let nudged = 0;
  let queued = new Set();
  let queueFrame = 0;
  const history = { undo: [], redo: [], bytes: 0 };

  const url = (route) => `/api/${route}/${encodeURIComponent(entry.project)}`;
  const sketchUrl = (target) => `/api/sketch/${encodeURIComponent(target.project)}/${encodeURIComponent(target.id)}`;
  const ready = () => doc !== null;
  const screens = () => doc?.screens ?? [];
  const same = (target) => Boolean(entry && target) && entry.project === target.project && entry.id === target.id;

  // ---- the document in the viewer -------------------------------------------

  /** One entry for each screen of the sketch, in the shape the viewer keeps its screens in. */
  function entries() {
    return screens().map((screen) => ({
      def: { id: screen.id, title: screen.title, x: screen.x, y: screen.y, w: screen.w, h: screen.h, sketch: true },
      node: null,
      sketch: true,
      rects: new Map(),
    }));
  }

  const render = (id) => renderScreen(findScreen(doc, id), { assets: `/p/${encodeURIComponent(entry.project)}/assets`, prefix: "rv" });

  const links = () => (doc?.links ?? []).map((link) => ({ id: link.id, from: link.from, to: link.to, at: link.element, sketch: true }));

  function sync(changed) {
    host.sync(entries(), changed);
    host.overlay();
  }

  const syncAll = () => sync(screens().map((screen) => screen.id));

  // A drag changes the document at the pace of the pointer; the screen is
  // drawn once a frame.
  function queue(id) {
    queued.add(id);
    queueFrame ||= requestAnimationFrame(() => {
      queueFrame = 0;
      const ids = [...queued];
      queued = new Set();
      sync(ids);
    });
  }

  // ---- history and saving ---------------------------------------------------

  function record(before) {
    history.undo.push(before);
    history.bytes += before.length;
    while (history.undo.length > HISTORY_STEPS || history.bytes > HISTORY_BYTES) history.bytes -= history.undo.shift().length;
    history.redo.length = 0;
    markDirty();
    renderBar();
  }

  /** Runs a change to the document as one step of the history; false when it changed nothing. */
  function edit(change, changed) {
    const before = JSON.stringify(doc);
    change();
    if (JSON.stringify(doc) === before) return false;
    record(before);
    sync(changed ?? screens().map((screen) => screen.id));
    return true;
  }

  function markDirty() {
    dirty = true;
    stateText("Not saved");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_MS);
  }

  function stateText(text) {
    $("#sketch-state").textContent = text;
  }

  async function save() {
    clearTimeout(saveTimer);
    while (writing) await writing;
    if (!dirty || !doc || !entry) return true;
    writing = put().finally(() => {
      writing = null;
    });
    return writing;
  }

  async function put() {
    const target = entry;
    dirty = false;
    stateText("Saving");
    try {
      const response = await fetch(sketchUrl(target), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base: revision, sketch: doc }),
      });
      const data = await response.json().catch(() => ({}));
      if (!same(target)) return true;
      if (response.ok) {
        revision = data.revision;
        stateText(dirty ? "Not saved" : "Saved");
        if (dirty) saveTimer = setTimeout(save, SAVE_MS);
        return true;
      }
      if (response.status === 409) {
        adopt(data);
        status("The sketch changed on disk, so your last change was not saved. The newer sketch is shown.", "error");
        return false;
      }
      dirty = true;
      stateText("Not saved");
      status(`The sketch was not saved: ${data.error ?? "the server refused it."}`, "error");
      return false;
    } catch {
      dirty = true;
      stateText("Not saved");
      status("The sketch was not saved: the server did not answer.", "error");
      return false;
    }
  }

  /** Takes a sketch that came from the disk in place of the one in memory, and tells the page what it changed. */
  function adopt(loaded) {
    const before = doc;
    doc = loaded.sketch;
    revision = loaded.revision;
    problem = loaded.problem ?? "";
    history.undo.length = 0;
    history.redo.length = 0;
    history.bytes = 0;
    dirty = false;
    if (!doc) selection = null;
    fixSelection();
    syncAll();
    renderBar();
    stateText(doc ? "Saved" : "");
    host.stale(false);
    if (doc) host.changed(before ? diffSketch(before, doc) : []);
  }

  async function read(target) {
    try {
      const response = await fetch(sketchUrl(target), { cache: "no-store" });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      return { revision: "", sketch: null, problem: "The sketch could not be loaded." };
    }
  }

  // Changes of this page that the file on disk would overwrite.
  const held = () => dirty || Boolean(writing) || Boolean(drag) || Boolean(editing);

  /**
   * A sketch written by someone else shows up, unless this page has changes of
   * its own. The window taking focus asks quietly. The server telling of a
   * change (`notify`) waits for a save in flight to settle, and when the page
   * still holds changes, keeps them and has the page show the notice.
   */
  async function refresh({ notify = false } = {}) {
    if (!entry || (!notify && held())) return;
    const target = entry;
    while (notify && writing) await writing;
    const loaded = await read(target);
    if (!same(target) || loaded.revision === revision) return;
    if (held()) {
      if (notify) host.stale(true);
      return;
    }
    adopt(loaded);
  }

  /** The file on disk over whatever this page holds, as the notice asks. */
  async function reload() {
    if (!entry) return;
    const target = entry;
    while (writing) await writing;
    const loaded = await read(target);
    if (!same(target)) return;
    clearTimeout(saveTimer);
    drag = null;
    draft = null;
    aiming = null;
    dropEditor();
    adopt(loaded);
  }

  window.addEventListener("focus", () => refresh());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
    else save();
  });

  /** Makes the sketch of a board the open one. The page reads it first, so a board that fails to open leaves the last one whole. */
  function use(target, loaded) {
    entry = target;
    doc = loaded.sketch;
    revision = loaded.revision;
    problem = loaded.problem ?? "";
    history.undo.length = 0;
    history.redo.length = 0;
    history.bytes = 0;
    selection = null;
    drag = null;
    draft = null;
    aiming = null;
    dirty = false;
    clearTimeout(saveTimer);
    dropEditor();
    stateText(doc ? "Saved" : "");
    renderBar();
    host.stale(false);
  }

  // ---- the bar --------------------------------------------------------------

  const svg = (icon) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
  const item = (attrs, label, icon, tip, keys) =>
    `<button type="button" class="item" ${attrs} aria-label="${esc(label)}" data-tip="${esc(tip)}"${keys ? ` data-key="${esc(keys)}"` : ""}>${svg(icon)}</button>`;
  const swatch = (kind, color, name, i) =>
    `<button type="button" class="swatch" data-${kind}="${i}" data-color="${color}" aria-pressed="false" aria-label="${kind === "ink" ? "Line colour" : "Fill"}: ${name}" data-tip="${kind === "ink" ? "Line" : "Fill"}: ${name}"><span class="swatch-chip"></span></button>`;

  bar.innerHTML = [
    `<div class="group" role="group" aria-label="Tools">${TOOLS.map((t) => item(`data-tool="${t.id}" aria-pressed="false"`, t.name, ICONS[t.id], t.name, t.key)).join("")}</div>`,
    `<div class="group" role="group" aria-label="Pictures">${item('data-action="image"', "Add a picture", ICONS.image, "Add a picture", "I")}${item('data-action="reference" aria-haspopup="dialog"', "Add a reference image", ICONS.reference, "Reference image")}</div>`,
    `<div class="group" role="group" aria-label="Line colour">${INKS.map((c, i) => swatch("ink", c, INK_NAMES[i], i)).join("")}</div>`,
    `<div class="group" role="group" aria-label="Fill">${FILLS.map((c, i) => swatch("fill", c, FILL_NAMES[i], i)).join("")}</div>`,
    `<div class="group" role="group" aria-label="Selection and history">${item('data-action="previous"', "Select the previous item", ICONS.previous, "Previous item", "[")}${item('data-action="next"', "Select the next item", ICONS.next, "Next item", "]")}${item('data-action="undo"', "Undo", ICONS.undo, "Undo", "Ctrl Z")}${item('data-action="redo"', "Redo", ICONS.redo, "Redo", "Ctrl Shift Z")}${item('data-action="remove"', "Delete the selection", ICONS.remove, "Delete", "Del")}</div>`,
    `<span class="sketch-state" id="sketch-state" role="status"></span>`,
    `<p class="sketch-problem" id="sketch-problem" role="alert" hidden></p>`,
  ].join("");

  for (const button of bar.querySelectorAll("[data-key]")) {
    if (/^[a-z[\]]$/i.test(button.dataset.key)) button.setAttribute("aria-keyshortcuts", button.dataset.key);
  }
  for (const chip of bar.querySelectorAll(".swatch-chip")) {
    const color = chip.parentElement.dataset.color;
    if (color === "none") chip.dataset.none = "true";
    else chip.style.setProperty("--chip", color);
  }

  const buttons = () => [...bar.querySelectorAll("button")].filter((button) => button.offsetParent);

  // The bar wraps on a narrow window; the note over it rises by the height it has.
  new ResizeObserver(() => document.documentElement.style.setProperty("--sketch-bar-height", `${bar.offsetHeight}px`)).observe(bar);
  const act = (name) => bar.querySelector(`[data-action="${name}"]`);

  function renderBar() {
    const on = ready();
    for (const button of bar.querySelectorAll("[data-tool]")) button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
    for (const button of bar.querySelectorAll("[data-ink]")) button.setAttribute("aria-pressed", String(INKS[Number(button.dataset.ink)] === style.stroke));
    for (const button of bar.querySelectorAll("[data-fill]")) button.setAttribute("aria-pressed", String(FILLS[Number(button.dataset.fill)] === style.fill));
    // Not disabled: a button that disables itself under the keyboard drops the focus.
    const blocked = { undo: !history.undo.length, redo: !history.redo.length, remove: !selection, previous: !items().length, next: !items().length };
    for (const button of bar.querySelectorAll("button")) button.setAttribute("aria-disabled", String(!on || blocked[button.dataset.action] === true));
    const warning = $("#sketch-problem");
    warning.hidden = on;
    warning.textContent = on ? "" : problem ? `The sketch file cannot be used: ${problem}` : "Sketching is not available for this board.";
    stage.dataset.tool = tool;
  }

  function setTool(next) {
    if (!ready()) return;
    commitEditor();
    cancel();
    tool = next;
    aiming = null;
    // A tool other than Select keeps the screen that was selected, which is where the next shape goes and what an arrow leaves; the rest of the selection is let go.
    if (next !== "select") select(selection?.link || !selection ? null : { screen: selection.screen }, false);
    renderBar();
    host.overlay();
    status(hint[next]);
  }

  bar.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !ready() || button.getAttribute("aria-disabled") === "true") return;
    if (button.dataset.tool) return setTool(button.dataset.tool);
    if (button.dataset.ink) {
      style.stroke = INKS[Number(button.dataset.ink)];
      return restyle();
    }
    if (button.dataset.fill) {
      style.fill = FILLS[Number(button.dataset.fill)];
      return restyle();
    }
    const action = { image: pickPicture, reference: openReference, previous: () => step(-1), next: () => step(1), undo, redo, remove }[button.dataset.action];
    action?.();
  });

  // The colours chosen go to the selection too.
  function restyle() {
    renderBar();
    const node = selection?.node && findNode(findScreen(doc, selection.screen), selection.node);
    if (!node) return;
    edit(
      () => {
        if (node.t === "text") node.color = style.stroke;
        else if (node.t === "box" || node.t === "vector") {
          node.stroke = style.stroke;
          if (node.kind !== "line" && node.kind !== "pen") node.fill = style.fill;
        }
      },
      [selection.screen],
    );
  }

  // The bar is one tab stop; the arrows move along it.
  const rove = (target) => {
    for (const button of bar.querySelectorAll("button")) button.tabIndex = button === target ? 0 : -1;
  };
  rove(bar.querySelector("button"));
  bar.addEventListener("focusin", (event) => {
    const button = event.target.closest("button");
    if (button) rove(button);
  });
  bar.addEventListener("keydown", (event) => {
    const list = buttons();
    const at = list.indexOf(document.activeElement);
    if (at < 0) return;
    const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    let next = null;
    if (move) next = (at + move + list.length) % list.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    rove(list[next]);
    list[next].focus();
  });

  // ---- selection ------------------------------------------------------------

  const titleOf = (id) => host.screens().get(id)?.def.title ?? id;

  // The next free number, so a title is not repeated after a screen was deleted.
  const nextTitle = () => `Screen ${1 + Math.max(0, ...doc.screens.map((screen) => Number(screen.title.match(/^Screen (\d+)$/)?.[1] ?? 0)))}`;

  function describe(sel) {
    if (sel.link) {
      const link = doc.links.find((l) => l.id === sel.link);
      return link ? `Arrow from ${titleOf(link.from)} to ${titleOf(link.to)} selected. Delete removes it.` : "";
    }
    const screen = findScreen(doc, sel.screen);
    if (!screen) return "";
    if (!sel.node) return `${screen.title} selected, ${screen.w} by ${screen.h}. Enter renames it.`;
    const node = findNode(screen, sel.node);
    return `${node.name} selected, ${Math.round(node.w)} by ${Math.round(node.h)}, in ${screen.title}.${node.t === "text" ? " Enter edits it." : ""}`;
  }

  function select(next, announce = true) {
    selection = next;
    if (next && announce) status(describe(next));
    host.overlay();
    renderBar();
  }

  function fixSelection() {
    if (!selection) return;
    if (selection.link) {
      if (!doc?.links.some((link) => link.id === selection.link)) selection = null;
      return;
    }
    const screen = doc && findScreen(doc, selection.screen);
    if (!screen || (selection.node && !findNode(screen, selection.node))) selection = null;
  }

  /** Everything that can be selected, in the order `[` and `]` walk it: each screen and the shapes on it, then the arrows. */
  function items() {
    if (!doc) return [];
    const list = [];
    for (const screen of doc.screens) {
      list.push({ screen: screen.id });
      for (const node of screen.root.kids) list.push({ screen: screen.id, node: node.id });
    }
    for (const link of doc.links) list.push({ link: link.id });
    return list;
  }

  const sameItem = (a, b) => Boolean(a && b) && a.screen === b.screen && a.node === b.node && a.link === b.link;

  function step(direction) {
    const list = items();
    if (!list.length) return;
    const at = list.findIndex((candidate) => sameItem(candidate, selection));
    const next = list[(at + direction + list.length) % list.length];
    tool = "select";
    select(next);
    reveal(next);
  }

  /** Brings a selected shape into view when it is out of it. */
  function reveal(sel) {
    const box = worldBox(sel);
    if (!box) return;
    const [x, y] = host.toScreen(box.x + box.w / 2, box.y + box.h / 2);
    host.reveal(x, y);
  }

  /** The box of a selection on the board. */
  function worldBox(sel) {
    if (!sel || sel.link || !doc) return null;
    const screen = findScreen(doc, sel.screen);
    if (!screen) return null;
    if (!sel.node) return { x: screen.x, y: screen.y, w: screen.w, h: screen.h };
    const node = findNode(screen, sel.node);
    if (!node) return null;
    const rect = host.screens().get(screen.id)?.rects.get(sel.node) ?? boxOf(node);
    return { x: screen.x + rect.x, y: screen.y + rect.y, w: rect.w, h: rect.h };
  }

  const stageBox = (box) => {
    const [x1, y1] = host.toScreen(box.x, box.y);
    const [x2, y2] = host.toScreen(box.x + box.w, box.y + box.h);
    return { x1, y1, x2, y2 };
  };

  function handleNames() {
    const node = selection?.node && findNode(findScreen(doc, selection.screen), selection.node);
    return node?.t === "text" ? CORNERS : Object.keys(HANDLES);
  }

  function handleAt(p) {
    const box = selection && worldBox(selection);
    if (!box) return null;
    const { x1, y1, x2, y2 } = stageBox(box);
    // The last handle drawn is on top, and a corner wins over an edge.
    for (const name of [...handleNames()].sort((a, b) => (b.length === 2 ? 1 : 0) - (a.length === 2 ? 1 : 0))) {
      const [fx, fy] = HANDLES[name];
      if (Math.abs(p.sx - (x1 + (x2 - x1) * fx)) <= GRAB && Math.abs(p.sy - (y1 + (y2 - y1) * fy)) <= GRAB) return name;
    }
    return null;
  }

  // ---- what the pointer is over ----------------------------------------------

  function pointer(event) {
    const [sx, sy] = host.local(event);
    const [wx, wy] = host.toWorld(sx, sy);
    return { sx, sy, wx, wy };
  }

  /** The topmost sketch screen under a point of the board. */
  function sketchScreenAt(wx, wy) {
    return [...screens()].reverse().find((s) => wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) ?? null;
  }

  /** The topmost screen of the board, a sketch screen or not. */
  function anyScreenAt(wx, wy) {
    return [...host.screens().values()].reverse().find(({ def }) => wx >= def.x && wx <= def.x + def.w && wy >= def.y && wy <= def.y + def.h)?.def ?? null;
  }

  function titleAt(p) {
    return (
      [...screens()].reverse().find((s) => {
        const { x1, y1, x2 } = stageBox(s);
        return p.sx >= x1 && p.sx <= x2 && p.sy >= y1 - host.titleBand && p.sy <= y1;
      }) ?? null
    );
  }

  function linkAt(p) {
    for (const [id, points] of host.linkShapes()) {
      if (!doc.links.some((link) => link.id === id)) continue;
      for (let i = 1; i < points.length; i += 1) if (away({ x: p.sx, y: p.sy }, points[i - 1], points[i]) <= GRAB / 1.5) return id;
    }
    return null;
  }

  /** The shape under the pointer, as the outermost one on the screen: the sketch moves a shape with what it holds. */
  function shapeAt(event) {
    const screenEl = event.target.closest?.("svg.screen");
    if (!screenEl) return null;
    let el = event.target.closest("[data-name]");
    if (!el || !screenEl.contains(el)) return { screen: screenEl.dataset.screen, node: null };
    for (let up = el.parentElement?.closest("[data-name]"); up && screenEl.contains(up); up = el.parentElement?.closest("[data-name]")) el = up;
    return { screen: screenEl.dataset.screen, node: el.dataset.name };
  }

  // ---- the pointer ------------------------------------------------------------

  function pointerDown(event) {
    if (!ready()) return false;
    const p = pointer(event);
    if (editing) commitEditor();
    if (tool === "select") return selectDown(event, p);
    if (tool === "arrow") return arrowDown(event, p);
    if (tool === "text") return textDown(event, p);
    return drawDown(event, p);
  }

  function grab(event, details) {
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    drag = { moved: false, before: JSON.stringify(doc), ...details };
    return true;
  }

  function selectDown(event, p) {
    const handle = handleAt(p);
    if (handle) {
      const screen = findScreen(doc, selection.screen);
      const target = selection.node ? findNode(screen, selection.node) : screen;
      return grab(event, { kind: "resize", handle, p, screen: screen.id, target: structuredClone(target), box: selection.node ? boxOf(target) : { x: screen.x, y: screen.y, w: screen.w, h: screen.h }, node: selection.node ?? null });
    }
    const shape = shapeAt(event);
    if (shape && findScreen(doc, shape.screen)) {
      const screen = findScreen(doc, shape.screen);
      if (shape.node) {
        const node = findNode(screen, shape.node);
        select({ screen: screen.id, node: node.id });
        return grab(event, { kind: "move", p, screen: screen.id, node: node.id, from: { ...node.place } });
      }
      select({ screen: screen.id });
      return false;
    }
    const band = titleAt(p);
    if (band) {
      select({ screen: band.id });
      return grab(event, { kind: "move", p, screen: band.id, node: null, from: { x: band.x, y: band.y } });
    }
    const link = linkAt(p);
    if (link) {
      select({ link });
      event.preventDefault();
      return true;
    }
    select(null, false);
    return false;
  }

  function drawDown(event, p) {
    if (tool === "screen") {
      if (event.target.closest?.("svg.screen")) {
        status("A screen goes on empty board. Move off the screens, or use Enter to add one beside the others.");
        return false;
      }
      draft = { tool, a: { x: p.wx, y: p.wy }, b: { x: p.wx, y: p.wy } };
      return grab(event, { kind: "draw", p });
    }
    const screen = sketchScreenAt(p.wx, p.wy);
    if (!screen) {
      status("Draw on a sketch screen. Add one with the Screen tool.");
      return false;
    }
    const at = { x: Math.round(p.wx - screen.x), y: Math.round(p.wy - screen.y) };
    draft = { tool, screen: screen.id, a: at, b: at, points: [at], last: p };
    return grab(event, { kind: "draw", p });
  }

  function textDown(event, p) {
    const screen = sketchScreenAt(p.wx, p.wy);
    if (!screen) {
      status("Click on a sketch screen to add text.");
      return false;
    }
    event.preventDefault();
    openEditor({ kind: "new", screen: screen.id, at: { x: Math.round(p.wx - screen.x), y: Math.round(p.wy - screen.y) } });
    return true;
  }

  function arrowDown(event, p) {
    const from = anyScreenAt(p.wx, p.wy);
    if (!from) return false;
    draft = { tool: "arrow", from: from.id, to: null, at: p };
    return grab(event, { kind: "arrow", p });
  }

  stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const p = pointer(event);
    if (!drag.moved && near({ x: p.sx, y: p.sy }, { x: drag.p.sx, y: drag.p.sy }) < CLICK) return;
    drag.moved = true;
    if (drag.kind === "move") moveTo(p);
    else if (drag.kind === "resize") resizeTo(p);
    else if (drag.kind === "arrow") {
      const to = anyScreenAt(p.wx, p.wy);
      draft.to = to && to.id !== draft.from ? to.id : null;
      draft.at = p;
      host.overlay();
    } else if (drag.kind === "draw") drawTo(p);
  });

  function finish(event) {
    if (!drag) return;
    const done = drag;
    drag = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (done.kind === "draw") commitDraft(done);
    else if (done.kind === "arrow") joinDraft();
    else if (done.moved && JSON.stringify(doc) !== done.before) record(done.before);
    draft = null;
    host.overlay();
  }
  stage.addEventListener("pointerup", finish);
  stage.addEventListener("pointercancel", (event) => {
    cancel();
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  });

  /** Gives up what the pointer was doing, as a second finger on the board does: the document goes back to how it was. */
  function cancel() {
    if (!drag && !draft) return false;
    if (drag && (drag.kind === "move" || drag.kind === "resize")) {
      doc = JSON.parse(drag.before);
      syncAll();
    }
    drag = null;
    draft = null;
    host.overlay();
    return true;
  }

  function moveTo(p) {
    const dx = Math.round(p.wx - drag.p.wx);
    const dy = Math.round(p.wy - drag.p.wy);
    const screen = findScreen(doc, drag.screen);
    if (drag.node) findNode(screen, drag.node).place = { x: drag.from.x + dx, y: drag.from.y + dy };
    else {
      screen.x = drag.from.x + dx;
      screen.y = drag.from.y + dy;
    }
    queue(drag.screen);
  }

  function resizeTo(p) {
    const screen = findScreen(doc, drag.screen);
    const result = dragHandle(drag.box, drag.handle, p.wx - drag.p.wx, p.wy - drag.p.wy, 8);
    if (!drag.node) placeScreen(screen, result);
    else {
      const node = findNode(screen, drag.node);
      Object.assign(node, structuredClone(drag.target));
      if (node.t === "image" && drag.handle.length === 2) keepShape(result, drag);
      if (node.t === "text") {
        node.size = clamp(Math.round(drag.target.size * (Math.hypot(result.w, result.h) / Math.hypot(drag.box.w, drag.box.h))), 6, 400);
        Object.assign(node, textBox(node.value, node.size, measure));
        const right = drag.box.x + drag.box.w;
        const bottom = drag.box.y + drag.box.h;
        node.place = { x: Math.round(drag.handle.includes("w") ? right - node.w : drag.box.x), y: Math.round(drag.handle.includes("n") ? bottom - node.h : drag.box.y) };
      } else placeNode(node, result);
    }
    queue(drag.screen);
  }

  /** A picture dragged by a corner keeps its proportions. */
  function keepShape(result, from) {
    const ratio = from.box.h / from.box.w;
    const bottom = result.y + result.h;
    result.h = Math.max(1, result.w * ratio);
    if (from.handle.includes("n")) result.y = bottom - result.h;
  }

  function drawTo(p) {
    if (draft.tool === "screen") draft.b = { x: p.wx, y: p.wy };
    else {
      const screen = findScreen(doc, draft.screen);
      draft.b = { x: p.wx - screen.x, y: p.wy - screen.y };
      if (draft.tool === "pen" && near({ x: p.sx, y: p.sy }, { x: draft.last.sx, y: draft.last.sy }) >= 2) {
        draft.points.push({ x: Math.round(draft.b.x * 10) / 10, y: Math.round(draft.b.y * 10) / 10 });
        draft.last = p;
      }
    }
    host.overlay();
  }

  const spanOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  function commitDraft(done) {
    const made = draft;
    if (!made) return;
    const clicked = !done.moved;
    let created = null;
    const changed = edit(() => {
      if (made.tool === "screen") {
        const span = spanOf(made.a, made.b);
        const size = clicked || span.w < 40 || span.h < 40 ? DEFAULT_SCREEN : span;
        const screen = addScreen(doc, { title: nextTitle(), x: span.x, y: span.y, w: size.w, h: size.h });
        created = { screen: screen.id };
        return;
      }
      const screen = findScreen(doc, made.screen);
      const span = spanOf(made.a, made.b);
      const box = clicked || (span.w < 4 && span.h < 4) ? { x: made.a.x, y: made.a.y, w: 160, h: 100 } : span;
      const whole = { x: Math.round(box.x), y: Math.round(box.y), w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) };
      const round = (point) => ({ x: Math.round(point.x), y: Math.round(point.y) });
      let node = null;
      if (made.tool === "rectangle") node = rectangleNode(doc, whole, style);
      else if (made.tool === "ellipse") node = ellipseNode(doc, whole, style);
      else if (made.tool === "line" && near(made.a, made.b) >= 4) node = lineNode(doc, round(made.a), round(made.b), style);
      else if (made.tool === "pen") node = penNode(doc, made.points.slice(0, 20000), style);
      if (!node) return;
      screen.root.kids.push(node);
      created = { screen: screen.id, node: node.id };
    }, made.tool === "screen" ? undefined : [made.screen]);
    if (!changed || !created) return;
    if (made.tool !== "pen") tool = "select";
    select(created);
    renderBar();
  }

  function joinDraft() {
    const made = draft;
    if (!made?.to) return;
    let link = null;
    const changed = edit(() => {
      link = addLink(doc, made.from, made.to);
    }, []);
    if (changed) select({ link: link.id });
    else status("Those screens are already joined.");
  }

  // ---- text ---------------------------------------------------------------------

  /** Opens the editor over a text, a new one or an existing one, or over the title of a screen. */
  function openEditor(target) {
    commitEditor();
    const screen = findScreen(doc, target.screen);
    if (!screen) return;
    const k = host.view().k;
    let box;
    let value = "";
    if (target.kind === "title") {
      const { x1, y1, x2 } = stageBox(screen);
      box = { left: x1, top: y1 - host.titleBand, width: Math.max(160, x2 - x1), size: 14 };
      value = screen.title;
    } else {
      const node = target.kind === "edit" ? findNode(screen, target.node) : null;
      const at = node ? node.place : target.at;
      const [x, y] = host.toScreen(screen.x + at.x, screen.y + at.y);
      const size = node?.size ?? 24;
      box = { left: x, top: y, width: Math.max(120, (node?.w ?? 160) * k + 24), size: Math.max(12, size * k) };
      value = node?.value ?? "";
      editor.style.color = node?.color ?? style.stroke;
    }
    editor.hidden = false;
    editor.rows = target.kind === "title" ? 1 : 2;
    editor.value = value;
    editor.setAttribute("aria-label", target.kind === "title" ? "Screen title" : "Text");
    editor.style.left = `${Math.round(box.left)}px`;
    editor.style.top = `${Math.round(box.top)}px`;
    editor.style.width = `${Math.round(box.width)}px`;
    editor.style.fontSize = `${box.size}px`;
    editing = target;
    editor.focus({ preventScroll: true });
    editor.select();
    // After the press that opened it has finished, whatever the browser did with the focus.
    setTimeout(() => editing && document.activeElement !== editor && editor.focus({ preventScroll: true }), 0);
  }

  function dropEditor() {
    editing = null;
    editor.hidden = true;
  }

  function commitEditor() {
    if (!editing) return;
    const target = editing;
    editing = null;
    const value = editor.value.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
    editor.hidden = true;
    const screen = findScreen(doc, target.screen);
    if (!screen) return;
    if (target.kind === "title") {
      if (value.trim()) edit(() => {
        screen.title = value.trim().replace(/\s+/g, " ").slice(0, 200);
        screen.root.name = screen.title;
      }, [screen.id]);
      return;
    }
    if (target.kind === "new") {
      if (!value.trim()) return;
      let node = null;
      edit(() => {
        node = textNode(doc, target.at, value, style, 24, measure);
        screen.root.kids.push(node);
      }, [screen.id]);
      tool = "select";
      select({ screen: screen.id, node: node.id });
      return;
    }
    const node = findNode(screen, target.node);
    if (!node) return;
    if (!value.trim()) {
      edit(() => removeNode(doc, screen, node.id), [screen.id]);
      fixSelection();
      host.overlay();
      renderBar();
      return;
    }
    edit(() => {
      node.value = value;
      Object.assign(node, textBox(value, node.size ?? 24, measure));
    }, [screen.id]);
  }

  editor.addEventListener("keydown", (event) => {
    const title = editing?.kind === "title";
    if (event.key === "Escape") {
      event.stopPropagation();
      dropEditor();
      stage.focus({ preventScroll: true });
    } else if (event.key === "Enter" && (title || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      commitEditor();
      stage.focus({ preventScroll: true });
    }
  });
  editor.addEventListener("blur", () => commitEditor());
  stage.addEventListener("wheel", () => commitEditor(), { passive: true });

  stage.addEventListener("dblclick", (event) => {
    if (!ready() || host.mode() !== "sketch") return;
    const shape = shapeAt(event);
    const screen = shape && findScreen(doc, shape.screen);
    const node = shape?.node && findNode(screen, shape.node);
    if (node?.t === "text") openEditor({ kind: "edit", screen: screen.id, node: node.id });
  });

  // ---- deleting and undoing -----------------------------------------------------

  function remove() {
    if (!selection || !ready()) return;
    const gone = selection;
    if (gone.link) edit(() => removeLink(doc, gone.link), []);
    else if (gone.node) edit(() => removeNode(doc, findScreen(doc, gone.screen), gone.node), [gone.screen]);
    else {
      edit(() => removeScreen(doc, gone.screen), []);
      status("Screen deleted. Ctrl Z brings it back.");
    }
    selection = null;
    host.overlay();
    renderBar();
  }

  function restore(json) {
    doc = JSON.parse(json);
    fixSelection();
    markDirty();
    syncAll();
    renderBar();
  }

  function undo() {
    if (!history.undo.length) return;
    const now = JSON.stringify(doc);
    history.redo.push(now);
    const before = history.undo.pop();
    history.bytes -= before.length;
    restore(before);
    status("Undone");
  }

  function redo() {
    if (!history.redo.length) return;
    const now = JSON.stringify(doc);
    history.undo.push(now);
    history.bytes += now.length;
    restore(history.redo.pop());
    status("Redone");
  }

  // ---- pictures -------------------------------------------------------------------

  async function upload(file) {
    if (!PICTURES.includes(file.type)) throw new Error("Only PNG, JPEG and WebP pictures can be added.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("The picture is over 8 MB.");
    const response = await fetch(url("images"), { method: "POST", headers: { "Content-Type": file.type }, body: file });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "The picture was not saved.");
    return data;
  }

  /** The natural size of a picture, read without showing it. */
  async function sizeOf(file) {
    const bitmap = await createImageBitmap(file);
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return size;
  }

  /** The screen a new shape goes on: the one selected, else the one the most of which is in view. */
  function targetScreen() {
    if (selection && !selection.link) return findScreen(doc, selection.screen);
    const area = host.freeArea();
    let best = null;
    let most = 0;
    for (const screen of doc.screens) {
      const { x1, y1, x2, y2 } = stageBox(screen);
      const seen = Math.max(0, Math.min(x2, area.x + area.w) - Math.max(x1, area.x)) * Math.max(0, Math.min(y2, area.y + area.h) - Math.max(y1, area.y));
      if (seen > most) [best, most] = [screen, seen];
    }
    return best;
  }

  function pickPicture() {
    if (!ready()) return;
    if (!targetScreen()) {
      status("No sketch screen is in view. Select one, or bring one into view, then add the picture.");
      return;
    }
    picker.value = "";
    picker.click();
  }

  async function addPicture(file) {
    const screen = targetScreen();
    if (!screen) {
      status("No sketch screen is in view. Select one, or bring one into view, then add the picture.", "error");
      return;
    }
    try {
      status("Adding the picture");
      const [picture, size] = await Promise.all([upload(file), sizeOf(file)]);
      const fit = Math.min(1, (screen.w * 0.6) / size.w, (screen.h * 0.6) / size.h);
      const w = Math.max(1, Math.round(size.w * fit));
      const h = Math.max(1, Math.round(size.h * fit));
      let node = null;
      edit(() => {
        node = imageNode(doc, { x: Math.round((screen.w - w) / 2), y: Math.round((screen.h - h) / 2), w, h }, picture.src);
        screen.root.kids.push(node);
      }, [screen.id]);
      select({ screen: screen.id, node: node.id });
    } catch (error) {
      status(error.message, "error");
    }
  }

  picker.addEventListener("change", () => {
    const [file] = picker.files;
    if (file) addPicture(file);
  });

  window.addEventListener("paste", (event) => {
    if (host.mode() !== "sketch" || !ready() || event.target.closest?.("textarea, input")) return;
    const file = [...(event.clipboardData?.files ?? [])].find((candidate) => candidate.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    addPicture(file);
  });

  // ---- a reference image -------------------------------------------------------------

  let referenceFile = null;
  const chosen = $("#reference-name");
  const referenceError = $("#reference-error");

  function openReference() {
    if (!ready()) return;
    commitEditor();
    host.closeCards();
    referenceFile = null;
    // So the same file can be chosen again.
    $("#reference-file").value = "";
    chosen.textContent = "No picture chosen";
    referenceError.textContent = "";
    $("#reference-text").value = "";
    card.hidden = false;
    host.renderSend();
    const area = host.freeArea();
    const width = card.offsetWidth || 320;
    card.style.left = `${Math.round(area.x + (area.w - width) / 2)}px`;
    card.style.top = `${Math.round(area.y + Math.min(80, area.h / 6))}px`;
    $("#reference-choose").focus({ preventScroll: true });
  }

  function closeReference({ focus = false } = {}) {
    if (card.hidden) return;
    card.hidden = true;
    if (focus) act("reference").focus();
  }

  $("#reference-choose").addEventListener("click", () => $("#reference-file").click());
  $("#reference-file").addEventListener("change", (event) => {
    referenceFile = event.target.files[0] ?? null;
    chosen.textContent = referenceFile ? referenceFile.name : "No picture chosen";
    referenceError.textContent = "";
  });
  card.querySelector("[data-close]").addEventListener("click", () => closeReference({ focus: true }));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeReference({ focus: true });
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) card.requestSubmit();
  });

  card.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!referenceFile) {
      referenceError.textContent = "Choose a picture first.";
      return;
    }
    const submit = card.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const file = referenceFile;
      const [picture, size] = await Promise.all([upload(file), sizeOf(file)]);
      const fit = Math.min(1, REFERENCE_MAX.w / size.w, REFERENCE_MAX.h / size.h);
      const w = Math.max(1, Math.round(size.w * fit));
      const h = Math.max(1, Math.round(size.h * fit));
      const spot = freeSpot(doc, [...host.screens().values()].filter((s) => !s.sketch).map((s) => s.def));
      let screen = null;
      edit(() => {
        screen = addScreen(doc, { title: `Reference: ${file.name.replace(/\.[^.]+$/, "").slice(0, 60)}`, x: spot.x, y: spot.y, w, h });
        screen.root.kids.push(imageNode(doc, { x: 0, y: 0, w, h }, picture.src, "Reference"));
      });
      select({ screen: screen.id }, false);
      host.frame({ x: screen.x, y: screen.y - 40, w, h: h + 40 });
      // The server reads the sketch from the disk to find the picture, so it is saved before the agent is asked.
      if (!(await save())) throw new Error("The sketch could not be saved, so the agent was not asked.");
      if (host.sendOn()) await host.askReference(screen.id, $("#reference-text").value.trim());
      else status("Reference image added");
      closeReference();
    } catch (error) {
      referenceError.textContent = error.message;
      status(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  });

  // ---- the keyboard ---------------------------------------------------------------------

  /** Puts a shape of a standard size in the middle of the screen the keyboard is on. */
  function place(kind) {
    if (kind === "screen") {
      const spot = freeSpot(doc, [...host.screens().values()].filter((s) => !s.sketch).map((s) => s.def));
      let screen = null;
      edit(() => {
        screen = addScreen(doc, { title: nextTitle(), x: spot.x, y: spot.y });
      });
      tool = "select";
      select({ screen: screen.id });
      host.frame({ x: screen.x, y: screen.y - 40, w: screen.w, h: screen.h + 40 });
      return;
    }
    const screen = targetScreen();
    if (!screen) {
      status("No sketch screen is in view. Select one, or bring one into view.");
      return;
    }
    const middle = { x: Math.round((screen.w - SHAPE.w) / 2), y: Math.round((screen.h - SHAPE.h) / 2) };
    if (kind === "text") {
      openEditor({ kind: "new", screen: screen.id, at: { x: middle.x, y: Math.round(screen.h / 2 - 15) } });
      return;
    }
    if (kind === "pen") {
      status("Drawing freehand needs a pointer. A rectangle, an ellipse or a line can be placed with Enter.");
      return;
    }
    let node = null;
    edit(() => {
      if (kind === "rectangle") node = rectangleNode(doc, { ...middle, ...SHAPE }, style);
      else if (kind === "ellipse") node = ellipseNode(doc, { ...middle, ...SHAPE }, style);
      else node = lineNode(doc, { x: middle.x, y: Math.round(screen.h / 2) }, { x: middle.x + SHAPE.w, y: Math.round(screen.h / 2) }, style);
      screen.root.kids.push(node);
    }, [screen.id]);
    tool = "select";
    select({ screen: screen.id, node: node.id });
  }

  /** The keyboard's way to join two screens: Enter picks the one the arrow leaves, [ and ] choose where it points, Enter joins. */
  function aim(direction) {
    const all = [...host.screens().keys()].filter((id) => id !== aiming.from);
    if (!all.length) return;
    const at = all.indexOf(aiming.to);
    aiming.to = all[(at + direction + all.length) % all.length];
    draft = { tool: "arrow", from: aiming.from, to: aiming.to, at: null };
    status(`Arrow from ${titleOf(aiming.from)} to ${titleOf(aiming.to)}. Enter joins them, Escape stops.`);
    const target = host.screens().get(aiming.to).def;
    host.reveal(...host.toScreen(target.x + target.w / 2, target.y + target.h / 2));
    host.overlay();
  }

  function nudge(key, event) {
    const unit = event.shiftKey ? 10 : 1;
    const dx = { ArrowLeft: -unit, ArrowRight: unit }[key] ?? 0;
    const dy = { ArrowUp: -unit, ArrowDown: unit }[key] ?? 0;
    const resize = event.ctrlKey || event.metaKey;
    const screen = findScreen(doc, selection.screen);
    // Keys pressed one after another are one step of the history.
    const fresh = Date.now() - nudged > NUDGE_MS;
    nudged = Date.now();
    const before = JSON.stringify(doc);
    if (selection.node) {
      const node = findNode(screen, selection.node);
      if (resize && node.t !== "text") placeNode(node, { x: node.place.x, y: node.place.y, w: node.w + dx, h: node.h + dy });
      else if (!resize) node.place = { x: node.place.x + dx, y: node.place.y + dy };
    } else if (resize) placeScreen(screen, { x: screen.x, y: screen.y, w: screen.w + dx, h: screen.h + dy });
    else {
      screen.x += dx;
      screen.y += dy;
    }
    if (fresh && JSON.stringify(doc) !== before) record(before);
    else markDirty();
    sync([screen.id]);
  }

  /** Handles a key while sketching; true when the sketch took it. `onBoard` is whether the keyboard is on the board and not on a control. */
  function key(event, { onBoard, onControl }) {
    if (!ready()) return false;
    const mod = event.ctrlKey || event.metaKey;
    const lower = event.key.toLowerCase();
    if (mod && !event.altKey) {
      if (lower === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return true;
      }
      if (lower === "y") {
        event.preventDefault();
        redo();
        return true;
      }
      if (event.key.startsWith("Arrow") && selection && !selection.link && onBoard) {
        event.preventDefault();
        nudge(event.key, event);
        return true;
      }
      return false;
    }
    if (event.altKey) return false;
    if (aiming) {
      if (event.key === "[" || event.key === "]") {
        aim(event.key === "]" ? 1 : -1);
        return true;
      }
      if (event.key === "Enter" && !onControl) {
        const made = aiming;
        aiming = null;
        draft = null;
        let link = null;
        if (edit(() => (link = addLink(doc, made.from, made.to)), [])) select({ link: link.id });
        else status("Those screens are already joined.");
        return true;
      }
    }
    if (event.key === "[" || event.key === "]") {
      step(event.key === "]" ? 1 : -1);
      return true;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selection) {
      event.preventDefault();
      remove();
      return true;
    }
    const picked = TOOLS.find((candidate) => candidate.key.toLowerCase() === lower);
    if (picked) {
      setTool(picked.id);
      return true;
    }
    if (lower === "i") {
      pickPicture();
      return true;
    }
    if (event.key.startsWith("Arrow") && selection && !selection.link && onBoard) {
      event.preventDefault();
      nudge(event.key, event);
      return true;
    }
    if ((event.key === "Enter" && !onControl) || event.key === "F2") {
      if (selection && !selection.link && tool === "select") {
        const screen = findScreen(doc, selection.screen);
        const node = selection.node && findNode(screen, selection.node);
        if (node?.t === "text") openEditor({ kind: "edit", screen: screen.id, node: node.id });
        else if (!selection.node) openEditor({ kind: "title", screen: screen.id });
        else return false;
        event.preventDefault();
        return true;
      }
      if (event.key === "Enter" && tool === "arrow" && selection && !selection.link) {
        aiming = { from: selection.screen, to: null };
        aim(1);
        event.preventDefault();
        return true;
      }
      if (event.key === "Enter" && tool !== "select" && tool !== "arrow") {
        event.preventDefault();
        place(tool);
        return true;
      }
    }
    return false;
  }

  /** Escape steps back: an arrow being aimed, then a tool, then the selection. True when it did. */
  function escape() {
    if (!ready()) return false;
    if (aiming) {
      aiming = null;
      draft = null;
      host.overlay();
      return true;
    }
    if (cancel()) return true;
    if (tool !== "select") {
      tool = "select";
      renderBar();
      return true;
    }
    if (selection) {
      select(null, false);
      return true;
    }
    return false;
  }

  // ---- what the overlay draws -------------------------------------------------------------

  function overlay() {
    if (!ready() || (!selection && !draft)) return "";
    const parts = [];
    const box = selection && !selection.link ? worldBox(selection) : null;
    if (box) {
      const { x1, y1, x2, y2 } = stageBox(box);
      parts.push(`<rect class="sk-select" x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}"/>`);
      if (tool === "select") {
        for (const name of handleNames()) {
          const [fx, fy] = HANDLES[name];
          parts.push(`<rect class="sk-handle" x="${x1 + (x2 - x1) * fx - 5}" y="${y1 + (y2 - y1) * fy - 5}" width="10" height="10" rx="2"/>`);
        }
      }
    }
    if (draft) parts.push(draftSvg());
    return parts.join("");
  }

  function draftSvg() {
    const k = host.view().k;
    if (draft.tool === "arrow") {
      const target = draft.to && host.screens().get(draft.to)?.def;
      const out = [];
      if (target) {
        const { x1, y1, x2, y2 } = stageBox(target);
        out.push(`<rect class="sk-select" x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}"/>`);
      }
      const from = host.screens().get(draft.from)?.def;
      if (from && draft.at) {
        const { x1, y1, x2, y2 } = stageBox(from);
        out.push(`<path class="sk-draft" d="M${(x1 + x2) / 2} ${(y1 + y2) / 2} L${draft.at.sx} ${draft.at.sy}"/>`);
      }
      return out.join("");
    }
    const origin = draft.tool === "screen" ? { x: 0, y: 0 } : findScreen(doc, draft.screen);
    const at = (point) => host.toScreen(origin.x + point.x, origin.y + point.y);
    const [ax, ay] = at(draft.a);
    const [bx, by] = at(draft.b);
    if (draft.tool === "pen") {
      const d = draft.points.map((point, i) => `${i ? "L" : "M"}${at(point).join(" ")}`).join(" ");
      return `<path class="sk-pen" d="${d}" stroke="${style.stroke}" stroke-width="${Math.max(1, 3 * k)}"/>`;
    }
    if (draft.tool === "line") return `<path class="sk-draft" d="M${ax} ${ay} L${bx} ${by}"/>`;
    if (draft.tool === "ellipse") return `<ellipse class="sk-draft" cx="${(ax + bx) / 2}" cy="${(ay + by) / 2}" rx="${Math.abs(bx - ax) / 2}" ry="${Math.abs(by - ay) / 2}"/>`;
    return `<rect class="sk-draft" x="${Math.min(ax, bx)}" y="${Math.min(ay, by)}" width="${Math.abs(bx - ax)}" height="${Math.abs(by - ay)}"/>`;
  }

  // ---- entering and leaving -------------------------------------------------------------------

  // What the board says about its keys to a screen reader, while sketching.
  const keys = $("#stage-keys");
  const boardKeys = keys.textContent;
  const sketchKeys = "Sketching: [ and ] select the previous or next item, the arrow keys move it, Control with an arrow resizes it, Enter edits it, Delete removes it, Escape steps back. Plus and minus zoom, 0 fits the board.";

  function enter() {
    bar.hidden = false;
    document.body.dataset.sketch = "on";
    keys.textContent = sketchKeys;
    renderBar();
    if (!ready()) return;
    status(doc.screens.length ? hint.select : "No sketch screens yet. Press F, then drag on the board to draw one.");
  }

  function leave() {
    commitEditor();
    cancel();
    closeReference();
    aiming = null;
    selection = null;
    bar.hidden = true;
    delete document.body.dataset.sketch;
    keys.textContent = boardKeys;
    save();
    host.overlay();
  }

  return {
    read,
    refresh,
    reload,
    use,
    enter,
    leave,
    pointerDown,
    key,
    escape,
    cancel,
    overlay,
    entries,
    render,
    links,
    selectedLink: () => selection?.link ?? null,
    save,
    closeReference,
    isOpen: () => !card.hidden,
  };
}
