// Review: pan, zoom and comment on a board of screen flows.
//
// Two SVG layers share the stage. The world holds the screens and is moved by
// one transform, so they stay vector at any zoom. While the view moves, the
// world travels as one picture, and once it rests it is drawn sharp again. The
// overlay is redrawn in screen space after every move and holds what must keep
// its size: the screen titles, the links, the pins and the selection.
//
// One server serves every project of the machine. A board opens from
// /p/<project>/boards/<id>.mjs, and its comments go to the same server, which
// writes docs/flows/comments/<board>.json in that project's repository. That
// file is what an agent reads; a reply written into it by hand shows up here
// the next time the window takes focus.

// The page carries an import map, served with it, that points "blueprint/" at
// the shared kit. The kit a board is drawn with is its repository's: the
// server answers /p/<project>/kit/<file> from the repository's own
// docs/flows/kit, and from the shared kit for a file the repository lacks, so
// the theme (skins.mjs) and the fonts are the repository's. See kitOf().

const $ = (selector) => document.querySelector(selector);

const stage = $("#stage");
const world = $("#world");
const overlay = $("#overlay");
const composer = $("#composer");
const composerText = $("#composer-text");
const threadCard = $("#thread");
const replyForm = $("#thread-reply");
const replyText = $("#reply-text");
const rail = $("#rail");
const tip = $("#tip");
const bubble = $("#comments-open");

const MIN_ZOOM = 0.03;
const MAX_ZOOM = 40;
const SCREEN_RADIUS = 24;
// The strip above a screen its title takes, in page pixels at any zoom.
const TITLE_BAND = 28;
// The ground's mesh: flat hexagons repainted for the screen's pixel density.
// Their side comes from --bp-mesh-side; `ground` holds the tile's size in CSS
// pixels.
const MESH_SIDE = 17;
const ground = { w: 1, h: 1, dpr: 1 };
// How long the view stays still before the world is drawn sharp again, in ms.
const REST_MS = 180;

const store = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Nothing to keep: the page works the same. */
    }
  },
};

const state = {
  index: [],
  // The index entry of the open board: its project and its id.
  entry: null,
  board: null,
  // The layer a board is drawn in: always the repository's design layer.
  layer: "design",
  // The kit of the open board's repository: draw, layout, GAP_Y and its skins.
  kit: null,
  mode: "move",
  view: { k: 0.2, x: 0, y: 0 },
  screens: new Map(),
  doc: { threads: [] },
  draft: null,
  open: null,
  hover: null,
  hot: null,
  showResolved: false,
  space: false,
  comments: "loading",
  // The last screen clicked on the board, where Present starts.
  touched: null,
};

// ---- helpers -------------------------------------------------------------

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stageSize() {
  const box = stage.getBoundingClientRect();
  return { w: box.width, h: box.height, left: box.left, top: box.top };
}

function local(event) {
  const { left, top } = stageSize();
  return [event.clientX - left, event.clientY - top];
}

const toScreen = (x, y) => [x * state.view.k + state.view.x, y * state.view.k + state.view.y];
const toWorld = (x, y) => [(x - state.view.x) / state.view.k, (y - state.view.y) / state.view.k];

function ago(iso) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// The live region stays in the page; a message is its text, gone after six
// seconds unless the pointer is resting on it.
let statusTimer;
function status(message, kind = "info") {
  const el = $("#status");
  el.textContent = message;
  el.dataset.kind = kind;
  clearTimeout(statusTimer);
  const clear = () => {
    if (el.matches(":hover")) statusTimer = setTimeout(clear, 1000);
    else el.textContent = "";
  };
  statusTimer = setTimeout(clear, 6000);
}

// Waits for the faces a skin names, so the layout measures the real fonts.
async function fontsReady(skin) {
  const families = new Set();
  for (const face of ["body", "mono", "display"]) {
    try {
      families.add(skin.face(face));
    } catch {
      /* A skin without that face has nothing to wait for. */
    }
  }
  const faces = [...families].flatMap((family) => [400, 500, 600, 700, 800].map((weight) => `${weight} 14px ${family}`));
  try {
    await Promise.all(faces.map((face) => document.fonts.load(face)));
    await document.fonts.ready;
  } catch {
    /* A missing face falls back; the layout measures whatever loaded. */
  }
}

// The kit of a repository, loaded once: its engine, its skins and its board
// constants, all from the same /p/<project>/kit/ folder the boards import.
const kits = new Map();

function kitOf(entry) {
  if (!kits.has(entry.kit)) {
    kits.set(
      entry.kit,
      Promise.all([
        import(`${entry.kit}kit.mjs`),
        import(`${entry.kit}skins.mjs`),
        import(`${entry.kit}board.mjs`),
        entry.icons ? import(entry.icons) : {},
        entry.nodes ? import(entry.nodes) : {},
      ]).then(([engine, themes, frame, moreIcons, moreNodes]) => {
        // The repository's own icons (docs/flows/kit/extra-icons.mjs) go over the shared set. The engine is
        // one module for every repository that keeps none of its own, so each repository's icons and node types (or none) are set before each layout and draw.
        const icons = moreIcons.default ?? moreIcons.ICONS;
        const nodes = moreNodes.default ?? moreNodes.NODES;
        const activate = () => {
          engine.useIcons?.(icons);
          engine.useNodes?.(nodes);
        };
        const draw = (...args) => (activate(), engine.draw(...args));
        const layout = (...args) => (activate(), engine.layout(...args));
        return { activate, draw, layout, useSkin: engine.useSkin, skins: themes.skins, skinDefs: themes.skinDefs, GAP_Y: frame.GAP_Y };
      }),
    );
  }
  return kits.get(entry.kit);
}

// The repository's design layer, or its only layer when it names it otherwise.
function pickLayer(kit) {
  return kit.skins.design ? "design" : Object.keys(kit.skins)[0];
}

// ---- boards --------------------------------------------------------------

// One button names the open project and board and opens the boards panel:
// a search, the boards starred and the ones opened most, then every project
// folded to its name, so the bar stays as long as its content however many
// projects there are. The server fills in each entry's project.

const sameBoard = (entry, other) => Boolean(entry && other) && entry.project === other.project && entry.id === other.id;

function projects() {
  const groups = new Map();
  for (const entry of state.index) {
    const name = entry.project;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(entry);
  }
  return [...groups].map(([name, boards]) => ({ name, boards }));
}

const initials = (name) => name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();

const CHEVRON = `<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>`;
const SEARCH = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;

// Stars, visits and the projects left open are this browser's own.
const boardKey = (entry) => `${entry.project}/${entry.id}`;

function readList(key, fallback) {
  try {
    return JSON.parse(store.get(key, "")) ?? fallback;
  } catch {
    return fallback;
  }
}

function countVisit(entry) {
  const visits = readList("review.visits", {});
  visits[boardKey(entry)] = { n: (visits[boardKey(entry)]?.n ?? 0) + 1, at: Date.now() };
  store.set("review.visits", JSON.stringify(visits));
}

function frequent() {
  const visits = readList("review.visits", {});
  return state.index
    .filter((entry) => visits[boardKey(entry)])
    .sort((a, b) => visits[boardKey(b)].n - visits[boardKey(a)].n || visits[boardKey(b)].at - visits[boardKey(a)].at)
    .slice(0, 4);
}

function renderTabs() {
  const open = state.entry;
  $("#boards").innerHTML = `<button type="button" class="board-tab project-tab" aria-haspopup="dialog" aria-expanded="false" aria-current="true" aria-label="Project ${esc(open.project)}, board ${esc(open.short ?? open.title)}"><span class="letter">${esc(initials(open.project))}</span><span class="tab-name">${esc(open.project)}</span><span class="tab-board">${esc(open.short ?? open.title)}</span>${CHEVRON}</button>`;
}

// The panel lives on the body, clear of the bar's own clipping.
const boardMenu = document.createElement("div");
boardMenu.className = "board-menu";
boardMenu.setAttribute("role", "dialog");
boardMenu.setAttribute("aria-label", "Boards");
boardMenu.hidden = true;
boardMenu.innerHTML = `<label class="menu-search">${SEARCH}<input type="search" id="board-search" placeholder="Search boards" aria-label="Search boards" autocomplete="off" spellcheck="false" /></label><div class="menu-list" id="board-list"></div>`;
document.body.append(boardMenu);
const boardSearch = $("#board-search");
const boardList = $("#board-list");
let menuTab = null;

function boardRow(entry, section, sub) {
  const key = boardKey(entry);
  const starred = readList("review.favorites", []).includes(key);
  const name = entry.short ?? entry.title;
  return `<div class="board-row"><button type="button" class="board-item" data-project="${esc(entry.project)}" data-board="${esc(entry.id)}" aria-current="${sameBoard(entry, state.entry)}"><span class="letter">${esc(entry.letter ?? "")}</span><span class="board-item-text"><span>${esc(name)}</span><span class="board-item-title">${esc(sub)}</span></span></button><button type="button" class="board-star" data-star="${esc(key)}" data-section="${esc(section)}" aria-pressed="${starred}" aria-label="Favorite ${esc(name)}, ${esc(entry.project)}">${STAR}</button></div>`;
}

function renderBoardList() {
  const words = boardSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (entry) => words.every((word) => `${entry.project} ${entry.short ?? ""} ${entry.title}`.toLowerCase().includes(word));
  const expanded = new Set(readList("review.expanded", []));
  expanded.add(state.entry.project);
  let html = "";
  if (words.length === 0) {
    const favorites = readList("review.favorites", []);
    const starred = state.index.filter((entry) => favorites.includes(boardKey(entry)));
    const often = frequent();
    // Favorites and Frequent start open and fold like a project.
    const folded = new Set(readList("review.folded", []));
    const section = (id, title, entries) =>
      `<div class="menu-section"><button type="button" class="board-group-toggle section-toggle" data-section-toggle="${id}" aria-expanded="${!folded.has(id)}"><span class="group-name">${title}</span><span class="group-count">${entries.length}</span>${CHEVRON}</button><div class="board-group-items"${folded.has(id) ? " hidden" : ""}>${entries.map((entry) => boardRow(entry, id, entry.project)).join("")}</div></div>`;
    if (starred.length) html += section("favorites", "Favorites", starred);
    if (often.length) html += section("frequent", "Frequent", often);
  }
  for (const { name, boards } of projects()) {
    const shown = boards.filter(matches);
    if (shown.length === 0) continue;
    // A search opens every project it finds something in.
    const open = words.length > 0 || expanded.has(name);
    html += `<div class="board-group"><button type="button" class="board-group-toggle" data-group="${esc(name)}" aria-expanded="${open}"><span class="letter">${esc(initials(name))}</span><span class="group-name">${esc(name)}</span><span class="group-count">${shown.length}</span>${CHEVRON}</button><div class="board-group-items"${open ? "" : " hidden"}>${shown.map((entry) => boardRow(entry, name, entry.title)).join("")}</div></div>`;
  }
  boardList.innerHTML = html || `<p class="menu-empty">No board matches “${esc(boardSearch.value.trim())}”.</p>`;
}

function toggleFavorite(star) {
  const { star: key, section } = star.dataset;
  const favorites = readList("review.favorites", []);
  store.set("review.favorites", JSON.stringify(favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key]));
  renderBoardList();
  // The list is drawn again: the focus goes back to the same star in the same place.
  boardList.querySelector(`.board-star[data-star="${CSS.escape(key)}"][data-section="${CSS.escape(section)}"]`)?.focus();
}

function toggleGroup(toggle) {
  const id = toggle.dataset.sectionToggle;
  if (id) {
    const folded = new Set(readList("review.folded", []));
    if (folded.has(id)) folded.delete(id);
    else folded.add(id);
    store.set("review.folded", JSON.stringify([...folded]));
    renderBoardList();
    boardList.querySelector(`[data-section-toggle="${id}"]`)?.focus();
    return;
  }
  const name = toggle.dataset.group;
  const expanded = new Set(readList("review.expanded", []));
  expanded.add(state.entry.project);
  if (toggle.getAttribute("aria-expanded") === "true") expanded.delete(name);
  else expanded.add(name);
  store.set("review.expanded", JSON.stringify([...expanded]));
  renderBoardList();
  boardList.querySelector(`.board-group-toggle[data-group="${CSS.escape(name)}"]`)?.focus();
}

function closeBoardMenu({ focus = false } = {}) {
  if (!menuTab) return;
  const tab = menuTab;
  menuTab = null;
  boardMenu.hidden = true;
  tab.setAttribute("aria-expanded", "false");
  if (focus) tab.focus();
}

function openBoardMenu(tab) {
  if (menuTab === tab) return closeBoardMenu();
  closeBoardMenu();
  menuTab = tab;
  tab.setAttribute("aria-expanded", "true");
  boardSearch.value = "";
  renderBoardList();
  boardMenu.hidden = false;
  const box = tab.getBoundingClientRect();
  boardMenu.style.left = `${Math.round(clamp(box.left, 8, innerWidth - boardMenu.offsetWidth - 8))}px`;
  boardMenu.style.top = `${Math.round(box.bottom + 6)}px`;
  // A finger gets the list, not a keyboard over half the screen.
  if (matchMedia("(pointer: fine)").matches) boardSearch.focus();
  else boardList.querySelector('.board-group .board-item[aria-current="true"]')?.focus();
}

boardSearch.addEventListener("input", renderBoardList);

boardMenu.addEventListener("keydown", (event) => {
  const stops = [...boardMenu.querySelectorAll("#board-search, .board-item, .board-group-toggle")].filter((el) => el.offsetParent);
  const at = stops.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    stops[(at + step + stops.length) % stops.length]?.focus();
  } else if (event.key === "Enter" && event.target === boardSearch) {
    event.preventDefault();
    boardList.querySelector(".board-item")?.click();
  } else if (event.key === "Escape") {
    event.stopPropagation();
    closeBoardMenu({ focus: true });
  }
});

boardMenu.addEventListener("focusout", (event) => {
  if (event.relatedTarget && !boardMenu.contains(event.relatedTarget) && event.relatedTarget !== menuTab) closeBoardMenu();
});

function writeHash() {
  const params = new URLSearchParams({ project: state.entry.project, board: state.entry.id });
  history.replaceState(null, "", `#${params}`);
}

// The last tab asked for wins: a board that finishes loading after another
// was asked for is dropped.
let opening = 0;

async function openBoard(project, id) {
  // A link that names only the project opens its first board.
  const entry =
    state.index.find((item) => item.project === project && item.id === id) ??
    state.index.find((item) => item.project === project) ??
    state.index[0];
  const ticket = ++opening;
  assetsOf = entry.project;
  // Built apart from what is on the stage, so a board that fails to build
  // leaves the one shown whole: the screens and the titles, links and pins
  // over them always come from the same board.
  let board;
  let kit;
  const screens = new Map();
  try {
    kit = await kitOf(entry);
    await fontsReady(kit.skins[pickLayer(kit)]);
    // A repository engine older than useSkin measures in its own faces.
    kit.useSkin?.(kit.skins[pickLayer(kit)]);
    kit.activate();
    board = (await import(`${entry.url}?v=${Date.now()}`)).default;
    for (const def of board.screens) {
      const node = def.root();
      kit.layout(node, def.w, def.h);
      screens.set(def.id, { def, node, rects: new Map() });
    }
  } catch (error) {
    console.error(error);
    // A page left open while the boards change keeps their old modules.
    if (ticket === opening) status(`Could not open ${entry.short ?? entry.id}. If the boards changed on disk, reload the page.`, "error");
    return;
  }
  if (ticket !== opening) return;
  closeComposer();
  closeThread();
  state.hot = null;
  state.entry = entry;
  countVisit(entry);
  state.kit = kit;
  state.layer = pickLayer(kit);
  state.board = board;
  state.touched = null;
  state.screens.clear();
  for (const [key, screen] of screens) state.screens.set(key, screen);
  // The last board's comments are not this one's.
  state.doc = { threads: [] };
  state.comments = "loading";
  drawWorld();
  renderTabs();
  showNote(null);
  $("#board-note").hidden = false;
  $("#present").disabled = board.screens.length === 0;
  $("#view-title").textContent = `Review: ${state.board.title}`;
  document.title = `${state.board.title} · Review`;
  $("#panel-foot").innerHTML = `<span>Saved to</span> <code>${esc(entry.project)}/docs/flows/comments/${esc(entry.id)}.json</code>`;
  writeHash();
  await loadComments();
  if (ticket === opening) fit(false);
}

// A screen with a note of its own explains itself in the note card while it is
// the one clicked; the canvas, or a screen without a note, shows the board's.
function showNote(id) {
  const def = state.screens.get(id)?.def;
  const own = def?.note ? def : null;
  $("#board-note-title").textContent = own ? (own.title ?? own.id) : state.board.title;
  $("#board-note-text").textContent = own ? own.note : (state.board.note ?? "");
}

// A repository's own viewer serves docs/flows as the site root, so its boards
// name files as "/assets/x.png". Here the repository's files live under
// /p/<project>/, and a file named from the root is taken from the project of
// the board being opened: in the drawing, and in a board that looks for a file
// itself (fetch) while it builds.
let assetsOf = null;
const plainFetch = window.fetch.bind(window);
window.fetch = (input, init) =>
  typeof input === "string" && input.startsWith("/assets/") && assetsOf
    ? plainFetch(`/p/${encodeURIComponent(assetsOf)}${input}`, init)
    : plainFetch(input, init);

function fromProject(markup) {
  const base = `/p/${encodeURIComponent(assetsOf)}/assets/`;
  return markup.replace(/((?:xlink:)?href=["'])\/assets\//g, (_, head) => head + base);
}

function drawWorld() {
  const { draw, skinDefs, skins } = state.kit;
  const skin = skins[state.layer];
  const { ids, svg: defs } = skinDefs("rv");
  const parts = [`<defs>${fromProject(defs)}</defs><g id="camera">`];
  for (const [id, screen] of state.screens) {
    const { def } = screen;
    const drawn = draw(screen.node, skin, { ...ids, prefix: `rv-${id}` });
    // A -motion.svg layer is drawn without its file, so nothing on a board
    // moves by itself: playing, thirty of them kept the whole board
    // repainting. The screen's play button gives the file back (togglePlay),
    // and meanwhile the still ground drawn under it shows.
    const svg = fromProject(drawn.svg).replace(/(<image\b[^>]*?)\shref="([^"]+-motion\.svg)"/g, '$1 data-motion="$2"');
    const { rects } = drawn;
    screen.rects = rects;
    const r = SCREEN_RADIUS;
    parts.push(
      // Each screen in a slot of its own, which bake() leaves out of the
      // drawing while the screen lies outside the drawn area.
      `<g class="slot" data-slot="${esc(id)}">` +
      // Two soft plates for a shadow and a hairline round the edge, so a dark
      // screen still stands off the dark ground. Plates, not a blur: a filter
      // is redrawn at every zoom step.
      `<rect class="screen-shadow" x="${def.x - 6}" y="${def.y + 18}" width="${def.w + 12}" height="${def.h + 6}" rx="${r + 6}" opacity="0.3"/>` +
        `<rect class="screen-shadow" x="${def.x - 18}" y="${def.y + 34}" width="${def.w + 36}" height="${def.h + 18}" rx="${r + 18}" opacity="0.14"/>` +
        `<svg class="screen" data-screen="${esc(id)}" x="${def.x}" y="${def.y}" width="${def.w}" height="${def.h}" viewBox="0 0 ${def.w} ${def.h}">` +
        `<clipPath id="clip-${esc(id)}"><rect width="${def.w}" height="${def.h}" rx="${r}"/></clipPath>` +
        `<g clip-path="url(#clip-${esc(id)})"><rect width="${def.w}" height="${def.h}" fill="${skin.color("canvas")}"/>${svg}</g></svg>` +
        // A screen the board is about, rather than one shown for context, is edged in the accent.
        `<rect class="screen-edge${def.feature ? " is-feature" : ""}" x="${def.x}" y="${def.y}" width="${def.w}" height="${def.h}" rx="${r}"/>` +
        `</g>`,
    );
  }
  parts.push("</g>");
  world.innerHTML = parts.join("");
  slots.clear();
  for (const slot of world.querySelectorAll("g.slot")) slots.set(slot.dataset.slot, slot);
  motion.clear();
  playing = null;
  for (const image of world.querySelectorAll("image[data-motion]")) {
    const id = image.closest("svg.screen")?.dataset.screen;
    if (!id) continue;
    if (!motion.has(id)) motion.set(id, []);
    motion.get(id).push(image);
  }
  // A new world has no camera yet: the next placement writes it whole.
  baked = null;
  // Now, not on the next frame: a new world is never shown without its camera.
  renderOverlay();
}

// ---- motion --------------------------------------------------------------

// Each screen's -motion.svg images, and the screen playing them, if any. A
// screen plays only from its own button, and stops when the board moves.
const motion = new Map();
let playing = null;

function setMotion(id, on) {
  for (const image of motion.get(id) ?? []) {
    if (on) image.setAttribute("href", image.dataset.motion);
    else image.removeAttribute("href");
  }
}

/** Plays a screen's animation, or stops it when that screen is the one playing. */
function togglePlay(id) {
  const next = playing === id ? null : id;
  setMotion(playing, false);
  setMotion(next, true);
  playing = next;
  renderOverlay();
}

function stopMotion() {
  if (!playing) return;
  setMotion(playing, false);
  playing = null;
}

// ---- camera --------------------------------------------------------------

// The screens and the overlay over them (titles, links, pins) are moved in one
// place, from one view, in the same frame. Moved apart, the screens went with
// the pointer at once and the overlay a frame later, or never when a frame was
// held back, and a pan left titles, links and pins off their screens.
function applyCamera() {
  scheduleOverlay();
}

/**
 * The world is drawn at one view, `baked`, written as the camera's transform
 * inside the SVG. A view that differs moves the drawn world as one picture, a
 * CSS transform the compositor applies without repainting a screen: on a large
 * board a repaint took most of a second, and every step of a pan waited for it.
 * The world is half a stage wider than the stage on each side, so a pan
 * uncovers screens already drawn rather than bare ground.
 */
let baked = null;
let restTimer = 0;
let placedTransform = "";
// Each screen's slot in the world, by screen id.
const slots = new Map();
// Below this zoom the screens are thumbnails, and a picture scaled a little
// reads the same as one drawn again: the whole board is not redrawn for it.
const THUMB_ZOOM = 0.12;
// Below this zoom a line of text is under a pixel tall, a grey smear at most,
// so the world is drawn without its text (review.css, .world[data-far]).
const TEXT_ZOOM = 0.06;

function worldMargin() {
  return { mx: stage.clientWidth / 2, my: stage.clientHeight / 2 };
}

/**
 * Draws the world at the current view: vector-sharp, and nothing left for the
 * picture to move. Only the screens inside the drawn area are drawn: close in,
 * the one on the stage and its neighbours rather than all thirty.
 */
function bake() {
  const camera = world.querySelector("#camera");
  if (!camera) return;
  const { mx, my } = worldMargin();
  const { k, x, y } = state.view;
  camera.setAttribute("transform", `translate(${(x + mx).toFixed(2)} ${(y + my).toFixed(2)}) scale(${k.toFixed(5)})`);
  const left = (-mx - x) / k;
  const top = (-my - y) / k;
  const right = (stage.clientWidth + mx - x) / k;
  const bottom = (stage.clientHeight + my - y) / k;
  for (const [id, slot] of slots) {
    const { def } = state.screens.get(id);
    // The plates of the shadow reach 18 units out and 52 down.
    const inside = def.x - 18 < right && def.x + def.w + 18 > left && def.y < bottom && def.y + def.h + 52 > top;
    if (inside) slot.removeAttribute("display");
    else slot.setAttribute("display", "none");
  }
  world.dataset.far = String(k < TEXT_ZOOM);
  world.style.transform = "";
  placedTransform = "";
  baked = { ...state.view, mx, my };
}

/**
 * Once the view has rested, the world is drawn again when the picture no
 * longer covers the stage, or when it was zoomed in on screens big enough to
 * read, where a scaled picture blurs. Zoomed out, or among thumbnails, the
 * picture stays: drawing the whole board again took most of a second.
 */
function rest() {
  if (!baked) return;
  const { mx, my } = worldMargin();
  const s = state.view.k / baked.k;
  const blurred = s > 1.6 || (s > 1.02 && state.view.k >= THUMB_ZOOM);
  if (blurred || !covered(s, mx, my) || mx !== baked.mx || my !== baked.my) bake();
}

/** Whether every screen on the stage lies inside the picture, now that it is scaled by `s`. */
function covered(s, mx, my) {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  // The drawn area, in stage pixels, where the picture now lies.
  const left = state.view.x - s * baked.x - s * mx;
  const top = state.view.y - s * baked.y - s * my;
  const right = left + s * (w + 2 * mx);
  const bottom = top + s * (h + 2 * my);
  if (left <= 1 && top <= 1 && right >= w - 1 && bottom >= h - 1) return true;
  // Bare ground past the picture's edge needs no drawing: only the part of a
  // screen that is on the stage and outside the picture does.
  for (const { def } of state.screens.values()) {
    const [x1, y1] = toScreen(def.x, def.y);
    const [x2, y2] = toScreen(def.x + def.w, def.y + def.h);
    const [cx1, cy1, cx2, cy2] = [Math.max(x1, 0), Math.max(y1, 0), Math.min(x2, w), Math.min(y2, h)];
    if (cx1 >= cx2 || cy1 >= cy2) continue;
    if (cx1 < left - 1 || cy1 < top - 1 || cx2 > right + 1 || cy2 > bottom + 1) return false;
  }
  return true;
}

/**
 * The camera on the world, and the ground under it. Only what changed is
 * written: the overlay is redrawn on every hover, and a rewritten transform
 * would move the picture for nothing.
 */
let placedGround = "";
function placeWorld() {
  if (!baked) bake();
  const s = state.view.k / baked.k;
  const tx = state.view.x - s * (baked.x + baked.mx) + baked.mx;
  const ty = state.view.y - s * (baked.y + baked.my) + baked.my;
  const still = s === 1 && Math.abs(tx) < 0.005 && Math.abs(ty) < 0.005;
  const transform = still ? "" : `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(5)})`;
  if (transform !== placedTransform) {
    placedTransform = transform;
    world.style.transform = transform;
    // The board moving stops an animation: its frames would repaint the
    // picture that travels.
    stopMotion();
    clearTimeout(restTimer);
    restTimer = setTimeout(rest, REST_MS);
  }
  // The mesh follows the pan and does not scale; it moves by whole device
  // pixels, so the tile's pixels land on the screen's.
  const snap = (value, tile) => (Math.round((((value % tile) + tile) % tile) * ground.dpr) / ground.dpr).toFixed(3);
  const position = `${snap(state.view.x, ground.w)}px ${snap(state.view.y, ground.h)}px`;
  if (position !== placedGround) {
    placedGround = position;
    stage.style.backgroundPosition = position;
  }
}

/**
 * The part of the stage no floating chrome covers, in stage pixels: what is
 * left once the tools, the boards and an open comments card are taken off
 * their edges. Framing and the cards work inside it. A card wider than half
 * the stage lies over the board rather than beside it, and takes nothing.
 */
function freeArea() {
  const { w, h } = stageSize();
  let left = 0;
  let top = 0;
  let right = w;
  let bottom = h;
  const cover = [rail, $("#top")];
  if (document.body.dataset.panel === "open") cover.push($("#panel"));
  if (!$("#board-note").hidden) cover.push($("#board-note"));
  for (const el of cover) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const tall = r.height > r.width;
    if (tall && r.width > w / 2) continue;
    if (tall && r.left < w / 2) left = Math.max(left, r.right);
    else if (tall) right = Math.min(right, r.left);
    else if (r.top < h / 2) top = Math.max(top, r.bottom);
    else bottom = Math.min(bottom, r.top);
  }
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

/** The middle of the free area, where the zoom buttons and keys zoom. */
function freeCentre() {
  const area = freeArea();
  return [area.x + area.w / 2, area.y + area.h / 2];
}

/**
 * Paints one tile of the mesh at the screen's pixel density and sets it as
 * the stage's background. Its side, its line width and its two greys are
 * tokens in review.css. Everything is placed on device pixels: the side is a
 * whole number of them, a line is a whole number wide and runs where its
 * edges fall on pixel edges. Nothing is left for the browser to resample.
 */
function paintGround() {
  const dpr = window.devicePixelRatio || 1;
  const tokens = getComputedStyle(document.documentElement);
  const side = parseFloat(tokens.getPropertyValue("--bp-mesh-side")) || MESH_SIDE;
  const lineCss = parseFloat(tokens.getPropertyValue("--bp-mesh-width")) || 3;
  const a = Math.max(8, Math.round(side * dpr));
  const w = 3 * a;
  const h = 2 * Math.round((a * Math.sqrt(3)) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  // An odd width runs through pixel centres and an even one along pixel
  // edges, so a straight seam covers whole pixels either way.
  const width = Math.max(1, Math.round(lineCss * dpr));
  const px = width % 2 ? (v) => Math.floor(v) + 0.5 : (v) => Math.round(v);
  // One hexagon and the link to the next column; drawn again one tile away on
  // every side, so the lines that cross the tile's edges are whole.
  const edges = [
    [0, h / 2, a / 2, 0],
    [a / 2, 0, (3 * a) / 2, 0],
    [(3 * a) / 2, 0, 2 * a, h / 2],
    [2 * a, h / 2, (3 * a) / 2, h],
    [(3 * a) / 2, h, a / 2, h],
    [a / 2, h, 0, h / 2],
    [2 * a, h / 2, 3 * a, h / 2],
  ];
  const shifts = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => [i * w, j * h]));
  g.strokeStyle = tokens.getPropertyValue("--bp-mesh-line").trim();
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  for (const [ox, oy] of shifts) {
    for (const [x1, y1, x2, y2] of edges) {
      g.moveTo(px(x1 + ox), px(y1 + oy));
      g.lineTo(px(x2 + ox), px(y2 + oy));
    }
  }
  g.stroke();
  g.fillStyle = tokens.getPropertyValue("--bp-mesh-dot").trim();
  // A joint is a round point twice the seam's width, centred where three meet.
  const size = width * 2;
  const joints = [[0, h / 2], [a / 2, 0], [(3 * a) / 2, 0], [2 * a, h / 2], [(3 * a) / 2, h], [a / 2, h], [3 * a, h / 2]];
  for (const [ox, oy] of shifts) {
    for (const [x, y] of joints) {
      g.beginPath();
      g.arc(px(x + ox), px(y + oy), size / 2, 0, Math.PI * 2);
      g.fill();
    }
  }
  ground.w = w / dpr;
  ground.h = h / dpr;
  ground.dpr = dpr;
  stage.style.backgroundImage = `url(${canvas.toDataURL("image/png")})`;
  stage.style.backgroundSize = `${ground.w}px ${ground.h}px`;
  applyCamera();
}

// A move to a screen of another density repaints the tile for it.
let densityQuery = null;
function watchDensity() {
  densityQuery?.removeEventListener("change", onDensity);
  densityQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  densityQuery.addEventListener("change", onDensity);
}
function onDensity() {
  paintGround();
  watchDensity();
}

function zoomAt(factor, sx, sy) {
  const k = clamp(state.view.k * factor, MIN_ZOOM, MAX_ZOOM);
  const [wx, wy] = toWorld(sx, sy);
  state.view.k = k;
  state.view.x = sx - wx * k;
  state.view.y = sy - wy * k;
  applyCamera();
}

function bounds(rects) {
  const xs = rects.flatMap((r) => [r.x, r.x + r.w]);
  const ys = rects.flatMap((r) => [r.y, r.y + r.h]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

let tween = 0;
function frame(target, animate = true) {
  const area = freeArea();
  const margin = Math.min(56, area.w * 0.08, area.h * 0.08);
  const k = clamp(Math.min((area.w - margin * 2) / target.w, (area.h - margin * 2) / target.h), MIN_ZOOM, MAX_ZOOM);
  const to = {
    k,
    x: area.x + (area.w - target.w * k) / 2 - target.x * k,
    y: area.y + (area.h - target.h * k) / 2 - target.y * k,
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  cancelAnimationFrame(tween);
  if (!animate || reduce) {
    state.view = to;
    // A jump has nothing to travel: the world is drawn at once where it lands.
    baked = null;
    applyCamera();
    return;
  }
  const from = { ...state.view };
  const start = performance.now();
  const step = (time) => {
    // A move across the board, so the curve is symmetric, and under 300 ms.
    const t = clamp((time - start) / 280, 0, 1);
    const ease = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    state.view = {
      k: from.k + (to.k - from.k) * ease,
      x: from.x + (to.x - from.x) * ease,
      y: from.y + (to.y - from.y) * ease,
    };
    // Already inside a frame: drawn in this one rather than queued for the next.
    renderOverlay();
    if (t < 1) tween = requestAnimationFrame(step);
  };
  tween = requestAnimationFrame(step);
}

function fit(animate = true) {
  const rects = [...state.screens.values()].map(({ def }) => ({ x: def.x, y: def.y - 40, w: def.w, h: def.h + 40 }));
  if (rects.length) frame(bounds(rects), animate);
}

// ---- links ---------------------------------------------------------------

function rounded(points, radius) {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L${cx} ${cy}`;
      continue;
    }
    const ax = cx - ((cx - px) / inLen) * r;
    const ay = cy - ((cy - py) / inLen) * r;
    const bx = cx + ((nx - cx) / outLen) * r;
    const by = cy + ((ny - cy) / outLen) * r;
    d += ` L${ax} ${ay} Q${cx} ${cy} ${bx} ${by}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}

function linksSvg() {
  const incoming = new Map();
  const parts = [];
  const taken = screenBoxes();
  for (const link of state.board.links) {
    const list = incoming.get(link.to) ?? [];
    list.push(link);
    incoming.set(link.to, list);
  }

  state.board.links.forEach((link, index) => {
    const from = state.screens.get(link.from);
    const to = state.screens.get(link.to);
    // A link to a screen that is not drawn is left out rather than stopping the overlay.
    if (!from || !to) return;
    const a = from.def;
    const b = to.def;
    const rect = link.at ? from.rects.get(link.at) : null;
    const hot = rect ? [a.x + rect.x + rect.w, a.y + rect.y + rect.h / 2] : null;
    const siblings = incoming.get(link.to);
    // Links into one screen arrive apart: 64 units, or 18 pixels on screen
    // when the board is far out, so two arrowheads never meet in one point.
    const step = Math.min(Math.max(64, 18 / state.view.k), (b.h * 0.8) / Math.max(1, siblings.length - 1));
    const spread = (siblings.indexOf(link) - (siblings.length - 1) / 2) * step;

    // Routed in world units, so the shape of a flow is the same at any zoom.
    const sx = a.x + a.w;
    const sy = hot ? hot[1] : a.y + a.h / 2;
    const tx = b.x;
    const ty = b.y + b.h / 2 + spread;
    const gapX = tx - sx;
    const lead = 90;
    let route;
    const nextColumn = gapX > lead * 2 && gapX < 520;
    if (nextColumn) {
      // The neighbour: out, across, in, the way the sketch draws it, turning
      // close to the screen it leaves.
      const mid = sx + Math.min(lead, gapX / 2);
      route = [[sx, sy], [mid, sy], [mid, ty], [tx, ty]];
    } else {
      // Further away: drop into the gap between rows and travel there, so
      // the line never crosses a screen on its way. The lower row's titles
      // take a band of the gap that is fixed on screen, so the lane runs in
      // what is left above it.
      const below = b.y > a.y + a.h;
      const above = b.y + b.h < a.y;
      // The gap right under the upper of the two rows: a gap measured all the
      // way to a screen two rows down would put the lane through the row between.
      const top = below ? a.y + a.h : above ? b.y + b.h : Math.max(a.y + a.h, b.y + b.h);
      const gap = Math.min(state.kit.GAP_Y, below ? b.y - top : above ? a.y - top : state.kit.GAP_Y);
      const free = Math.max(gap - TITLE_BAND / state.view.k, gap * 0.3);
      const lane = top + free / 2 + ((index % 5) - 2) * Math.min(26, free / 8);
      route = [[sx, sy], [sx + lead, sy], [sx + lead, lane], [tx - lead, lane], [tx - lead, ty], [tx, ty]];
    }
    const points = route.map(([x, y]) => toScreen(x, y));
    const [px, py] = points[0];
    const [qx, qy] = points[points.length - 1];

    // The stretch from the control to the edge of its screen would run through
    // whatever sits to its right and read as struck-through text, so it is
    // drawn only while the control is hovered. At rest the dot and the line
    // leaving the edge at the same height say the same thing.
    const lit = state.hot === `${link.from}:${link.at}`;
    const cls = lit ? "wire lit" : "wire";
    if (hot) {
      const [hx, hy] = toScreen(hot[0], hot[1]);
      if (lit) {
        parts.push(outline({ x: a.x + rect.x, y: a.y + rect.y, w: rect.w, h: rect.h }, "source-box"));
        parts.push(`<path class="${cls} wire-inner" d="M${hx + 6} ${hy} L${px} ${py}"/>`);
      }
      // Just outside the control, so it never covers the last letter of a link.
      parts.push(`<circle class="hot${lit ? " lit" : ""}" cx="${hx + 6}" cy="${hy}" r="4"/>`);
    }
    parts.push(`<path class="${cls}" d="${rounded(points, 14)}"/>`);
    parts.push(`<path class="${cls}" d="M${qx - 9} ${qy - 6} L${qx} ${qy} L${qx - 9} ${qy + 6}"/>`);
    if (link.label) parts.push(labelSvg(link.label, points, taken));
  });
  return parts.join("");
}

/** Each screen with its title, in page pixels. */
function screenBoxes() {
  return [...state.screens.values()].map(({ def }) => {
    const [x1, y1] = toScreen(def.x, def.y);
    const [x2, y2] = toScreen(def.x + def.w, def.y + def.h);
    return { x1, y1: y1 - TITLE_BAND, x2, y2 };
  });
}

/**
 * A link's label sits on the middle of its longest stretch, and only where it
 * clears every screen and every label already placed: at a zoom where no
 * stretch has room, it waits for a closer look rather than covering a screen.
 */
function labelSvg(label, points, boxes) {
  const w = label.length * 6.4 + 16;
  const h = 22;
  const stretches = points
    .slice(1)
    .map((p, i) => ({ a: points[i], b: p, len: Math.hypot(p[0] - points[i][0], p[1] - points[i][1]) }))
    .sort((m, n) => n.len - m.len);
  for (const { a, b, len } of stretches) {
    if (len < 24) break;
    const mx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    // On an upright stretch the label may also sit beside the line.
    const upright = Math.abs(a[0] - b[0]) < 1;
    const centres = upright ? [mx, mx + w / 2 + 8, mx - w / 2 - 8] : [mx];
    for (const cx of centres) {
      const box = { x1: cx - w / 2 - 6, y1: cy - h / 2 - 6, x2: cx + w / 2 + 6, y2: cy + h / 2 + 6 };
      const clear = boxes.every((s) => box.x2 <= s.x1 || box.x1 >= s.x2 || box.y2 <= s.y1 || box.y1 >= s.y2);
      if (clear) {
        boxes.push(box);
        return `<g class="link-label" transform="translate(${(cx - w / 2).toFixed(1)} ${(cy - h / 2).toFixed(1)})"><rect width="${w}" height="${h}" rx="11"/><text x="8" y="11">${esc(label)}</text></g>`;
      }
    }
  }
  return "";
}

// ---- overlay -------------------------------------------------------------

// True while a redraw hands the focus back to the pin that had it.
let refocusing = false;

// One draw per frame however many moves arrive in it. Where the browser holds
// frames back, the timer draws anyway, so the board never stops following.
let overlayQueued = false;
function scheduleOverlay() {
  if (overlayQueued) return;
  overlayQueued = true;
  let frameId = 0;
  let timer = 0;
  const run = () => {
    cancelAnimationFrame(frameId);
    clearTimeout(timer);
    if (!overlayQueued) return;
    overlayQueued = false;
    renderOverlay();
  };
  frameId = requestAnimationFrame(run);
  timer = setTimeout(run, 100);
}

function anchorRect(anchor) {
  if (!anchor.screen) return null;
  const screen = state.screens.get(anchor.screen);
  if (!screen) return null;
  const rect = anchor.element ? screen.rects.get(anchor.element) : null;
  if (rect) return { x: screen.def.x + rect.x, y: screen.def.y + rect.y, w: rect.w, h: rect.h };
  return { x: screen.def.x, y: screen.def.y, w: screen.def.w, h: screen.def.h };
}

/** Where a thread's pin sits, in world units. */
function pinPoint(anchor) {
  const screen = anchor.screen ? state.screens.get(anchor.screen) : null;
  if (screen && anchor.element && screen.rects.get(anchor.element)) {
    const rect = screen.rects.get(anchor.element);
    return [screen.def.x + rect.x + rect.w, screen.def.y + rect.y];
  }
  if (screen) return [screen.def.x + anchor.point.x, screen.def.y + anchor.point.y];
  return [anchor.point.x, anchor.point.y];
}

function outline(rect, cls) {
  const [x1, y1] = toScreen(rect.x, rect.y);
  const [x2, y2] = toScreen(rect.x + rect.w, rect.y + rect.h);
  return `<rect class="${cls}" x="${x1 - 2}" y="${y1 - 2}" width="${x2 - x1 + 4}" height="${y2 - y1 + 4}" rx="4"/>`;
}

function visibleThreads() {
  return state.doc.threads
    .map((thread, i) => ({ thread, number: i + 1 }))
    .filter(({ thread }) => state.showResolved || thread.status !== "resolved");
}

function renderOverlay() {
  // In shot mode the viewer's own chrome is gone, so there is nothing to draw on.
  if (!state.board || state.shot) return;
  placeWorld();
  const parts = [];

  for (const [id, { def }] of state.screens) {
    const [x, y] = toScreen(def.x, def.y);
    if (state.view.k > 0.035) {
      const animated = motion.has(id);
      // Cut to the screen's own width so a long title never runs into the
      // title of the screen beside it, or into the screen's play button.
      const room = Math.floor((def.w * state.view.k - (animated ? 28 : 0)) / 7.2);
      const title = def.title.length > room ? `${def.title.slice(0, Math.max(1, room - 1)).trimEnd()}…` : def.title;
      parts.push(`<text class="screen-title" x="${x + 2}" y="${y - 10}">${esc(title)}</text>`);
      if (animated) {
        // At the end of the title: plays the screen's animation, stops it.
        const on = playing === id;
        const label = `${on ? "Stop" : "Play"} the animation of ${def.title}`;
        const cx = x + def.w * state.view.k - 10;
        parts.push(
          `<g class="play" data-play="${esc(id)}" data-on="${on}" transform="translate(${cx.toFixed(1)} ${(y - 15).toFixed(1)})" tabindex="0" role="button" aria-pressed="${on}" aria-label="${esc(label)}">` +
            `<title>${esc(label)}</title><circle class="play-hit" r="18"/><circle class="play-ring" r="14"/><circle class="play-face" r="10"/>` +
            (on ? `<rect x="-3.5" y="-3.5" width="7" height="7" rx="1"/>` : `<path d="M-2.5 -4.5 L4.5 0 L-2.5 4.5 Z"/>`) +
            `</g>`,
        );
      }
    }
  }

  parts.push(linksSvg());

  if (state.hover && state.mode === "comment") parts.push(outline(state.hover, "hover-box"));
  if (state.draft) {
    const rect = anchorRect(state.draft);
    if (rect && state.draft.element) parts.push(outline(rect, "select-box"));
  }
  if (state.open) {
    const thread = state.doc.threads.find((t) => t.id === state.open);
    const rect = thread && anchorRect(thread.anchor);
    if (rect && thread.anchor.element) parts.push(outline(rect, "select-box"));
  }

  for (const { thread, number } of visibleThreads()) {
    const [wx, wy] = pinPoint(thread.anchor);
    const [x, y] = toScreen(wx, wy);
    parts.push(
      `<g class="pin" data-thread="${esc(thread.id)}" data-status="${esc(thread.status)}" data-open="${state.open === thread.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" tabindex="0" role="button" aria-label="Comment ${number}">` +
        `<circle class="pin-hit" cx="15" cy="-15" r="22"/><path class="pin-ring" d="M-4 4 V-15 A19 19 0 1 1 15 4 Z"/><path d="M0 0 V-15 A15 15 0 1 1 15 0 Z"/><text x="15" y="-15">${number}</text></g>`,
    );
  }

  if (state.draft) {
    const [wx, wy] = pinPoint(state.draft);
    const [x, y] = toScreen(wx, wy);
    parts.push(`<g class="pin pin-draft" transform="translate(${x} ${y})"><path d="M0 0 V-15 A15 15 0 1 1 15 0 Z"/><text x="15" y="-15">+</text></g>`);
  }

  // The overlay is redrawn whole, so a focused pin or play button is found
  // again by its thread or screen and keeps the keyboard. That focus is the
  // redraw's, not a person moving to it, so it must not pull the board back:
  // every pan and zoom redraws, and the board snapped back to a focused pin on
  // each frame.
  const focusedPin = document.activeElement?.closest?.("#overlay .pin[data-thread]")?.dataset.thread;
  const focusedPlay = document.activeElement?.closest?.("#overlay .play[data-play]")?.dataset.play;
  overlay.innerHTML = parts.join("");
  if (focusedPin || focusedPlay) {
    refocusing = true;
    const again = focusedPin
      ? overlay.querySelector(`.pin[data-thread="${CSS.escape(focusedPin)}"]`)
      : overlay.querySelector(`.play[data-play="${CSS.escape(focusedPlay)}"]`);
    again?.focus({ preventScroll: true });
    refocusing = false;
  }
  placeCards();
}

/** Moves the board just enough to bring a point, in page pixels, out from under the chrome. */
function reveal(x, y, margin = 48) {
  const area = freeArea();
  const dx = x < area.x + margin ? area.x + margin - x : x > area.x + area.w - margin ? area.x + area.w - margin - x : 0;
  const dy = y < area.y + margin ? area.y + margin - y : y > area.y + area.h - margin ? area.y + area.h - margin - y : 0;
  if (!dx && !dy) return;
  state.view.x += dx;
  state.view.y += dy;
  applyCamera();
}

// ---- picking -------------------------------------------------------------

function chainOf(screenEl, el) {
  const chain = [];
  let node = el;
  while (node && screenEl.contains(node)) {
    if (node.dataset?.name) chain.unshift({ name: node.dataset.name, label: node.dataset.label });
    node = node.parentElement?.closest("[data-name]");
  }
  return chain;
}

function anchorFor(screenId, el, point) {
  const screen = state.screens.get(screenId);
  const screenEl = world.querySelector(`svg.screen[data-screen="${CSS.escape(screenId)}"]`);
  const chain = el ? chainOf(screenEl, el) : [];
  return {
    screen: screenId,
    screenTitle: screen.def.title,
    element: el ? el.dataset.name : null,
    label: el ? el.dataset.label : screen.def.title,
    path: [screen.def.title, ...chain.map((c) => c.label)],
    chain,
    point: { x: Math.round(point[0]), y: Math.round(point[1]) },
  };
}

function hit(event) {
  const target = event.target;
  const screenEl = target.closest?.("svg.screen");
  if (!screenEl) return null;
  const el = target.closest("[data-name]");
  return { screenEl, el: el && screenEl.contains(el) ? el : null };
}

function pick(event) {
  const [sx, sy] = local(event);
  const [wx, wy] = toWorld(sx, sy);
  const found = hit(event);
  closeThread();
  if (!found) {
    state.draft = {
      screen: null,
      screenTitle: null,
      element: null,
      label: "Board",
      path: ["Board"],
      chain: [],
      point: { x: Math.round(wx), y: Math.round(wy) },
    };
  } else {
    const screenId = found.screenEl.dataset.screen;
    const { def } = state.screens.get(screenId);
    let el = found.el;
    // A second click on what is already selected climbs to what holds it.
    if (el && state.draft?.screen === screenId && state.draft.element === el.dataset.name) {
      const parent = el.parentElement?.closest("[data-name]");
      el = parent && found.screenEl.contains(parent) ? parent : null;
    }
    state.draft = anchorFor(screenId, el, [wx - def.x, wy - def.y]);
  }
  openComposer();
}

/** The link source under the pointer, as "screen:element", in either mode. */
function sourceUnder(found) {
  if (!found?.el) return null;
  const screenId = found.screenEl.dataset.screen;
  const sources = new Set(state.board.links.filter((l) => l.from === screenId && l.at).map((l) => l.at));
  for (let el = found.el; el && found.screenEl.contains(el); el = el.parentElement?.closest("[data-name]")) {
    if (sources.has(el.dataset.name)) return `${screenId}:${el.dataset.name}`;
  }
  return null;
}

function hover(event) {
  if (panning) return;
  const found = hit(event);
  const hot = sourceUnder(found);
  let next = null;
  if (state.mode === "comment" && found?.el) {
    const screenId = found.screenEl.dataset.screen;
    const screen = state.screens.get(screenId);
    const rect = screen.rects.get(found.el.dataset.name);
    if (rect) next = { x: screen.def.x + rect.x, y: screen.def.y + rect.y, w: rect.w, h: rect.h };
  }
  const same = JSON.stringify(next) === JSON.stringify(state.hover) && hot === state.hot;
  if (!same) {
    state.hover = next;
    state.hot = hot;
    scheduleOverlay();
  }
}

// ---- cards ---------------------------------------------------------------

function crumbsHtml(anchor, interactive) {
  const levels = [{ name: null, label: anchor.screenTitle ?? "Board" }, ...(anchor.chain ?? [])];
  if (!anchor.chain && anchor.path) {
    return anchor.path.map((label, i) => `<li${i === anchor.path.length - 1 ? ' aria-current="true"' : ""}>${esc(label)}</li>`).join("");
  }
  return levels
    .map((level) => {
      const current = (level.name ?? null) === (anchor.element ?? null);
      const content = interactive && anchor.screen
        ? `<button type="button" data-level="${esc(level.name ?? "")}"${current ? ' aria-current="true"' : ""}>${esc(level.label)}</button>`
        : `<span${current ? ' aria-current="true"' : ""}>${esc(level.label)}</span>`;
      return `<li>${content}</li>`;
    })
    .join("");
}

function placeCard(card, anchor) {
  if (card.hidden) return;
  const [wx, wy] = pinPoint(anchor);
  const [x, y] = toScreen(wx, wy);
  // Beside the pin, kept inside the free area so no bar sits on top of it.
  const area = freeArea();
  // Never taller than the free area: on a short window the card scrolls inside.
  card.style.maxHeight = `${Math.max(120, area.h - 24)}px`;
  const width = card.offsetWidth || 320;
  const height = card.offsetHeight || 180;
  const left = area.x + 12;
  const top = area.y + 12;
  const right = area.x + area.w - 12;
  const bottom = area.y + area.h - 12;
  // What the card must leave in view: the element with its pin, or the pin alone.
  const rect = anchorRect(anchor);
  const [ex1, ey1] = rect && anchor.element ? toScreen(rect.x, rect.y) : [x, y];
  const [ex2, ey2] = rect && anchor.element ? toScreen(rect.x + rect.w, rect.y + rect.h) : [x, y];
  const keep = { x1: Math.min(ex1, x) - 8, y1: Math.min(ey1, y - 30) - 8, x2: Math.max(ex2, x + 30) + 8, y2: Math.max(ey2, y) + 8 };
  // Right of it, left of it, below it, above it: the first place that fits.
  const tries = [
    [keep.x2 + 8, y - 20],
    [keep.x1 - 8 - width, y - 20],
    [keep.x1, keep.y2 + 8],
    [keep.x1, keep.y1 - 8 - height],
  ];
  const fits = ([cx, cy]) => cx >= left && cx + width <= right && cy >= top && cy + height <= bottom;
  const clampTo = ([cx, cy]) => [Math.max(left, Math.min(cx, right - width)), Math.max(top, Math.min(cy, bottom - height))];
  const clear = ([cx, cy]) => cx >= keep.x2 || cx + width <= keep.x1 || cy >= keep.y2 || cy + height <= keep.y1;
  const spot = tries.map(clampTo).find((p) => fits(p) && clear(p)) ?? clampTo(tries[0]);
  card.style.left = `${spot[0]}px`;
  card.style.top = `${spot[1]}px`;
}

function placeCards() {
  if (state.draft) placeCard(composer, state.draft);
  if (state.open) {
    const thread = state.doc.threads.find((t) => t.id === state.open);
    if (thread) placeCard(threadCard, thread.anchor);
  }
}

function openComposer() {
  composer.hidden = false;
  $("#composer-crumbs").innerHTML = crumbsHtml(state.draft, true);
  composerText.value = composerText.value ?? "";
  renderOverlay();
  composerText.focus({ preventScroll: true });
  // Once more after the click has finished, whatever the browser did with it.
  setTimeout(() => {
    if (!composer.hidden && document.activeElement !== composerText) composerText.focus({ preventScroll: true });
  }, 0);
}

function closeComposer() {
  composer.hidden = true;
  state.draft = null;
  composerText.value = "";
}

/**
 * Opens a thread's card. `from` is what opened it, a pin or a panel row, so
 * that closing the card puts the focus back there; a card opened that way
 * takes the focus into its reply box. A redraw passes nothing and moves
 * nothing.
 */
function openThread(id, { from = null } = {}) {
  const thread = state.doc.threads.find((t) => t.id === id);
  if (!thread) return;
  closeComposer();
  if (from) state.returnFocus = { from, id };
  // A redraw of the same thread keeps a half-written reply.
  const fresh = state.open !== id;
  state.open = id;
  threadCard.hidden = false;
  $("#thread-crumbs").innerHTML = crumbsHtml(thread.anchor, false);
  $("#thread-messages").innerHTML = thread.messages
    .map(
      (message) =>
        `<li class="message"><div class="message-head"><span class="message-author" data-agent="${message.author !== "User" && message.author !== thread.messages[0].author}">${esc(message.author)}</span><span class="message-time">${esc(ago(message.at))}</span></div><p class="message-text">${esc(message.text)}</p></li>`,
    )
    .join("");
  $("#thread-status").textContent = thread.status === "resolved" ? "Reopen" : "Resolve";
  $("#thread-delete").textContent = "Delete";
  $("#thread-delete").dataset.armed = "false";
  if (fresh) replyText.value = "";
  renderOverlay();
  renderPanel();
  if (from) replyText.focus({ preventScroll: true });
}

function closeThread() {
  threadCard.hidden = true;
  state.open = null;
  state.returnFocus = null;
}

function closeCards() {
  const back = state.returnFocus;
  closeComposer();
  closeThread();
  renderOverlay();
  renderPanel();
  if (back) {
    const target =
      back.from === "pin"
        ? overlay.querySelector(`.pin[data-thread="${CSS.escape(back.id)}"]`)
        : $(`.thread-item[data-thread="${CSS.escape(back.id)}"]`);
    target?.focus({ preventScroll: true });
  }
}

function focusThread(id) {
  const thread = state.doc.threads.find((t) => t.id === id);
  if (!thread) return;
  const rect = anchorRect(thread.anchor);
  if (rect) {
    const pad = Math.max(rect.w, rect.h) * 0.6 + 80;
    frame({ x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 });
  } else {
    const [x, y] = pinPoint(thread.anchor);
    frame({ x: x - 700, y: y - 450, w: 1400, h: 900 });
  }
  openThread(id, { from: "item" });
}

// ---- comments ------------------------------------------------------------

async function loadComments() {
  if (!state.board) return;
  const entry = state.entry;
  let doc;
  let comments;
  try {
    const response = await fetch(commentsUrl(entry), { cache: "no-store" });
    if (!response.ok) throw new Error();
    doc = await response.json();
    comments = "ready";
  } catch {
    doc = { threads: [] };
    comments = "error";
  }
  // Another board was opened while these were on their way.
  if (!sameBoard(state.entry, entry)) return;
  state.doc = doc;
  state.comments = comments;
  if (state.open && !state.doc.threads.some((t) => t.id === state.open)) closeThread();
  if (state.open) openThread(state.open);
  renderPanel();
  renderOverlay();
}

const commentsUrl = (entry) => `/api/comments/${encodeURIComponent(entry.project)}/${encodeURIComponent(entry.id)}`;

async function send(op) {
  const response = await fetch(commentsUrl(state.entry), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(op),
  });
  const data = await response.json().catch(() => ({ error: "The server did not answer." }));
  if (!response.ok) throw new Error(data.error ?? "Could not save.");
  state.doc = data;
}

function renderPanel() {
  // In shot mode the panel is gone with the rest of the viewer's chrome.
  if (state.shot) return;
  const items = visibleThreads();
  const open = state.doc.threads.filter((t) => t.status !== "resolved").length;
  const count = $("#open-count");
  count.textContent = String(open);
  count.dataset.zero = String(open === 0);
  bubble.setAttribute("aria-label", `Comments, ${open} open`);
  // Loading, unreachable, all resolved or none yet: each says what it is and,
  // where there is one, offers the way forward.
  const empty = $("#panel-empty");
  const action = $("#panel-empty-action");
  empty.hidden = items.length > 0;
  empty.dataset.kind = state.comments === "error" ? "error" : "info";
  // Where the comments are saved means nothing while they cannot be reached.
  $("#panel-foot").hidden = state.comments === "error";
  action.hidden = state.comments !== "ready" || state.doc.threads.length > 0;
  $("#panel-empty-text").textContent =
    state.comments === "loading"
      ? "Loading comments."
      : state.comments === "error"
        ? "The comments did not load: the Review server is not answering. Start it with npm run flows, then reload."
        : state.doc.threads.length
          ? `No open comments. ${state.doc.threads.length - open} resolved.`
          : "No comments on this board yet.";
  $("#threads").innerHTML = items
    .map(({ thread, number }) => {
      const first = thread.messages[0];
      const replies = thread.messages.length - 1;
      // The end of the path names the thing; when the row is short, the start gives way.
      const path = thread.anchor.path?.length ? thread.anchor.path : [thread.anchor.label];
      const trail = path.slice(0, -1).map((step) => `${esc(step)} ›`).join(" ");
      const where = `<span class="where-trail">${trail}</span><span class="where-last">${esc(path.at(-1))}</span>`;
      const bits = [replies ? `${replies} ${replies === 1 ? "reply" : "replies"}` : null, ago(thread.messages.at(-1).at)];
      return `<li><button type="button" class="thread-item" data-thread="${esc(thread.id)}" data-status="${esc(thread.status)}" aria-current="${state.open === thread.id}"><span class="thread-number">${number}</span><span class="thread-body"><span class="thread-where" title="${esc(path.join(" › "))}">${where}</span><span class="thread-first">${esc(first.text)}</span><span class="thread-meta">${esc(bits.filter(Boolean).join(", "))}</span></span></button></li>`;
    })
    .join("");
}

// ---- floating chrome -----------------------------------------------------

/**
 * Opens the comments card or folds it into the round button. `focus` moves
 * the keyboard with it: into the card's heading when it opens, back to the
 * button when it folds.
 */
function setPanel(open, { focus = false } = {}) {
  document.body.dataset.panel = open ? "open" : "closed";
  bubble.setAttribute("aria-expanded", String(open));
  store.set("review.panel", open ? "open" : "closed");
  if (focus) (open ? $("#panel-title") : bubble).focus({ preventScroll: true });
  scheduleOverlay();
}

// The tools bar is one tab stop; the arrows move along it, as a toolbar does.
// A tool the layout hides is skipped.
const railItems = () => [...rail.querySelectorAll(".item")].filter((item) => item.offsetParent);

function rove(target) {
  for (const item of railItems()) item.tabIndex = item === target ? 0 : -1;
}

rail.addEventListener("focusin", (event) => {
  const item = event.target.closest(".item");
  if (item) rove(item);
});

rail.addEventListener("keydown", (event) => {
  const items = railItems();
  const at = items.indexOf(document.activeElement);
  if (at < 0) return;
  const across = getComputedStyle(rail).flexDirection === "row";
  const step = { [across ? "ArrowRight" : "ArrowDown"]: 1, [across ? "ArrowLeft" : "ArrowUp"]: -1 }[event.key];
  let next = null;
  if (step) next = (at + step + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  if (next === null) return;
  event.preventDefault();
  rove(items[next]);
  items[next].focus();
});

// A tool's name and key, beside the bar: after a moment on hover, at once on
// keyboard focus, gone on Escape or when the pointer leaves.
let tipTimer = 0;

function showTip(item, delay) {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    tip.innerHTML = `<span>${esc(item.dataset.tip)}</span>${item.dataset.key ? `<kbd>${esc(item.dataset.key)}</kbd>` : ""}`;
    tip.hidden = false;
    const box = item.getBoundingClientRect();
    const bar = rail.getBoundingClientRect();
    if (bar.width > bar.height) {
      const left = clamp(box.left + box.width / 2 - tip.offsetWidth / 2, 8, innerWidth - tip.offsetWidth - 8);
      tip.style.left = `${left}px`;
      tip.style.top = `${bar.top - tip.offsetHeight - 8}px`;
    } else {
      tip.style.left = `${bar.right + 8}px`;
      tip.style.top = `${box.top + box.height / 2 - tip.offsetHeight / 2}px`;
    }
  }, delay);
}

function hideTip() {
  clearTimeout(tipTimer);
  tip.hidden = true;
}

rail.addEventListener("pointerover", (event) => {
  const item = event.target.closest(".item");
  // Once one name is showing, the next follows the pointer without the wait.
  if (item) showTip(item, tip.hidden ? 500 : 0);
});
rail.addEventListener("pointerleave", hideTip);
rail.addEventListener("focusin", (event) => {
  const item = event.target.closest(".item");
  // A hidden bar is still sliding in: the name waits until it is in place.
  if (item?.matches(":focus-visible")) showTip(item, rail.hasAttribute("data-hidden") ? 220 : 0);
});
rail.addEventListener("focusout", hideTip);
rail.addEventListener("click", hideTip);

for (const item of rail.querySelectorAll(".item")) {
  if (/^[a-z0-9]$/i.test(item.dataset.key ?? "")) item.setAttribute("aria-keyshortcuts", item.dataset.key);
}

// The bar hides: it slides past the left edge and leaves a mark there,
// comes back when the pointer rests on that edge, a touch lands on it or the
// keyboard reaches a tool, and goes again a moment after it is left. On a
// phone the bar runs along the bottom and stays.
const EDGE = 8;
const TOUCH_EDGE = 24;
const REVEAL_MS = 150;
const HIDE_MS = 400;
const sideBar = matchMedia("(min-width: 701px)");
const railEdge = $("#rail-edge");
let railShown = false;
let railHovered = false;
let railRevealTimer = 0;
let railHideTimer = 0;
let lastX = Number.POSITIVE_INFINITY;

function placeRail(shown) {
  railShown = shown;
  const hide = sideBar.matches && !shown;
  rail.toggleAttribute("data-hidden", hide);
  railEdge.toggleAttribute("data-shown", hide);
}

function hideRailSoon() {
  clearTimeout(railHideTimer);
  const tick = () => {
    const keep = railHovered || lastX <= EDGE || Boolean(rail.querySelector(":focus-visible"));
    if (keep) railHideTimer = setTimeout(tick, HIDE_MS);
    else placeRail(false);
  };
  railHideTimer = setTimeout(tick, HIDE_MS);
}

function showRail() {
  placeRail(true);
  hideRailSoon();
}

window.addEventListener(
  "pointermove",
  (event) => {
    if (event.pointerType === "touch" || !sideBar.matches) return;
    const leftEdge = lastX <= EDGE && event.clientX > EDGE;
    lastX = event.clientX;
    if (leftEdge && !railHovered) hideRailSoon();
    if (event.clientX <= EDGE) {
      railRevealTimer ||= setTimeout(() => {
        railRevealTimer = 0;
        showRail();
      }, REVEAL_MS);
    } else if (railRevealTimer) {
      clearTimeout(railRevealTimer);
      railRevealTimer = 0;
    }
  },
  { passive: true },
);

window.addEventListener(
  "pointerdown",
  (event) => {
    if (!sideBar.matches || rail.contains(event.target)) return;
    if (event.pointerType !== "mouse" && event.clientX <= TOUCH_EDGE) showRail();
    else if (railShown) placeRail(false);
  },
  true,
);

rail.addEventListener("pointerenter", () => {
  railHovered = true;
  clearTimeout(railHideTimer);
});
rail.addEventListener("pointerleave", () => {
  railHovered = false;
  hideRailSoon();
});
rail.addEventListener("focusin", (event) => {
  if (event.target.matches(":focus-visible")) showRail();
});
rail.addEventListener("focusout", hideRailSoon);
sideBar.addEventListener("change", () => placeRail(railShown));
placeRail(false);

// ---- input ---------------------------------------------------------------

let panning = null;

function setMode(mode) {
  state.mode = mode;
  stage.dataset.mode = mode;
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  if (mode === "move") {
    state.hover = null;
    closeComposer();
  }
  renderOverlay();
}

// Two fingers pinch: the board zooms round the point between them and follows
// that point as they move. A finger left on the board after a pinch goes on
// panning from where it is. These listeners come before the pan's, so a pinch
// can keep the second finger from starting a pan or a comment of its own.
const touches = new Map();
let pinch = null;

function touchPair() {
  const [a, b] = [...touches.values()];
  return { d: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
}

stage.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || event.target.closest(".card, .note")) return;
  // The primary finger starts a new gesture: a finger lifted off the stage
  // without being seen leaves nothing behind.
  if (event.isPrimary) touches.clear();
  touches.set(event.pointerId, local(event));
  if (touches.size < 2) return;
  event.stopImmediatePropagation();
  event.preventDefault();
  stage.setPointerCapture(event.pointerId);
  if (touches.size > 2) return;
  // The first finger's pan, or the comment it opened, gives way to the pinch.
  cancelAnimationFrame(tween);
  panning = null;
  stage.dataset.panning = "false";
  if (state.mode === "comment") closeComposer();
  pinch = touchPair();
});

stage.addEventListener("pointermove", (event) => {
  if (!touches.has(event.pointerId)) return;
  touches.set(event.pointerId, local(event));
  if (!pinch) return;
  event.stopImmediatePropagation();
  const next = touchPair();
  const [wx, wy] = toWorld(...pinch.m);
  const k = clamp(state.view.k * (next.d / pinch.d), MIN_ZOOM, MAX_ZOOM);
  state.view = { k, x: next.m[0] - wx * k, y: next.m[1] - wy * k };
  pinch = next;
  applyCamera();
});

function endTouch(event) {
  if (!touches.delete(event.pointerId) || !pinch) return;
  event.stopImmediatePropagation();
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  if (touches.size >= 2) {
    pinch = touchPair();
    return;
  }
  pinch = null;
  const [rest] = touches.values();
  if (rest) {
    panning = { x: rest[0], y: rest[1], vx: state.view.x, vy: state.view.y, moved: true };
    stage.dataset.panning = "true";
  }
}

stage.addEventListener("pointerup", endTouch);
stage.addEventListener("pointercancel", endTouch);

stage.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".card, .note")) return;
  const pin = event.target.closest?.(".pin[data-thread]");
  if (pin) {
    event.preventDefault();
    openThread(pin.dataset.thread, { from: "pin" });
    return;
  }
  const play = event.target.closest?.(".play[data-play]");
  if (play) {
    event.preventDefault();
    togglePlay(play.dataset.play);
    return;
  }
  const wantsPan = event.button === 1 || state.space || (state.mode === "move" && event.button === 0);
  if (wantsPan) {
    event.preventDefault();
    const [x, y] = local(event);
    const screen = event.target.closest?.("svg.screen")?.dataset.screen ?? null;
    panning = { x, y, vx: state.view.x, vy: state.view.y, moved: false, screen };
    stage.setPointerCapture(event.pointerId);
    stage.dataset.panning = "true";
    return;
  }
  if (state.mode === "comment" && event.button === 0) {
    // The press would otherwise go on to focus the board itself and take the
    // focus back from the comment box that pick() just opened.
    event.preventDefault();
    pick(event);
  }
});

stage.addEventListener("pointermove", (event) => {
  if (!panning && event.target.closest(".card, .note")) return;
  if (panning) {
    const [x, y] = local(event);
    if (Math.abs(x - panning.x) + Math.abs(y - panning.y) > 3) panning.moved = true;
    state.view.x = panning.vx + (x - panning.x);
    state.view.y = panning.vy + (y - panning.y);
    applyCamera();
    return;
  }
  hover(event);
});

function endPan(event) {
  if (!panning) return;
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  const wasClick = !panning.moved;
  const { screen } = panning;
  panning = null;
  stage.dataset.panning = "false";
  if (wasClick && state.mode === "move") {
    closeCards();
    showNote(screen);
    if (screen) state.touched = screen;
  }
}

// A double click on a screen brings it to fill the stage. The pan holds the
// pointer, so the click lands on the stage and the screen is found by point.
stage.addEventListener("dblclick", (event) => {
  const screenEl = document.elementFromPoint(event.clientX, event.clientY)?.closest("svg.screen");
  if (!screenEl || state.mode !== "move") return;
  const { def } = state.screens.get(screenEl.dataset.screen);
  frame({ x: def.x, y: def.y, w: def.w, h: def.h });
});

stage.addEventListener("pointerup", endPan);
stage.addEventListener("pointercancel", endPan);
stage.addEventListener("pointerleave", () => {
  if (state.hover || state.hot) {
    state.hover = null;
    state.hot = null;
    scheduleOverlay();
  }
});

stage.addEventListener(
  "wheel",
  (event) => {
    if (event.target.closest(".card")) return;
    event.preventDefault();
    const [x, y] = local(event);
    const speed = event.ctrlKey ? 0.01 : 0.0016;
    zoomAt(Math.exp(-event.deltaY * speed), x, y);
  },
  { passive: false },
);

overlay.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const pin = event.target.closest?.(".pin[data-thread]");
  const play = event.target.closest?.(".play[data-play]");
  if (pin) {
    event.preventDefault();
    openThread(pin.dataset.thread, { from: "pin" });
  } else if (play) {
    event.preventDefault();
    togglePlay(play.dataset.play);
  }
});

// A pin or a play button reached with Tab never stays under a bar or the comments card.
overlay.addEventListener("focusin", (event) => {
  const target = event.target.closest?.(".pin[data-thread], .play[data-play]");
  if (!target || refocusing) return;
  const box = target.getBoundingClientRect();
  reveal(box.left + box.width / 2, box.top + box.height / 2);
});

window.addEventListener("keydown", (event) => {
  if (!player.hidden) return playerKey(event);
  const typing = event.target.closest?.("textarea, input");
  if (event.key === "Escape") {
    hideTip();
    // A card closes first; with none open, Escape inside the comments folds them.
    if (!composer.hidden || !threadCard.hidden) closeCards();
    else if (event.target.closest?.("#panel")) setPanel(false, { focus: true });
    return;
  }
  if (typing) return;
  // Space pans the canvas, except on a control, where it presses it.
  if (event.key === " " && !event.target.closest?.("button, summary, a, [role='button']")) {
    state.space = true;
    stage.dataset.mode = "move";
    event.preventDefault();
    return;
  }
  // The browser's own shortcuts, Ctrl+C or Ctrl+0 among them, stay the browser's.
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const [cx, cy] = freeCentre();
  // The arrows are the keyboard's way to drag the board, from the board itself.
  const arrows = { arrowleft: [1, 0], arrowright: [-1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
  const onBoard = event.target === document.body || (event.target.closest?.("#stage") && !event.target.closest(".card, .note"));
  if (arrows[key] && onBoard) {
    event.preventDefault();
    const step = event.shiftKey ? 320 : 80;
    state.view.x += arrows[key][0] * step;
    state.view.y += arrows[key][1] * step;
    applyCamera();
    return;
  }
  if (key === "h" || key === "v") setMode("move");
  else if (key === "c") setMode("comment");
  else if (key === "n") toggleNote();
  // A shortcut never animates.
  else if (key === "0") fit(false);
  else if (key === "+" || key === "=") zoomAt(1.25, cx, cy);
  else if (key === "-" || key === "_") zoomAt(0.8, cx, cy);
});

window.addEventListener("keyup", (event) => {
  if (event.key === " ") {
    state.space = false;
    stage.dataset.mode = state.mode;
  }
});

document.addEventListener("click", async (event) => {
  const star = event.target.closest(".board-star");
  if (star) return toggleFavorite(star);
  const toggle = event.target.closest(".board-group-toggle");
  if (toggle) return toggleGroup(toggle);
  const boardItem = event.target.closest(".board-item");
  if (boardItem) {
    closeBoardMenu();
    return openBoard(boardItem.dataset.project, boardItem.dataset.board);
  }
  const tab = event.target.closest(".project-tab");
  if (tab) return openBoardMenu(tab);
  if (!event.target.closest(".board-menu")) closeBoardMenu();

  // The stage carries a data-mode of its own; only a tool button picks one.
  const mode = event.target.closest("button[data-mode]");
  if (mode) return setMode(mode.dataset.mode);
  if (event.target.closest("#note-toggle")) return toggleNote();

  if (event.target.closest("#panel-empty-action")) {
    setMode("comment");
    status("Click anything on a screen to comment on it.");
    return;
  }

  if (event.target.closest("#comments-open")) return setPanel(true, { focus: true });
  if (event.target.closest("#comments-close")) return setPanel(false, { focus: true });

  const item = event.target.closest(".thread-item");
  if (item) return focusThread(item.dataset.thread);

  const level = event.target.closest("#composer-crumbs [data-level]");
  if (level && state.draft?.screen) {
    const screenEl = world.querySelector(`svg.screen[data-screen="${CSS.escape(state.draft.screen)}"]`);
    const el = level.dataset.level ? screenEl.querySelector(`[data-name="${CSS.escape(level.dataset.level)}"]`) : null;
    state.draft = anchorFor(state.draft.screen, el, [state.draft.point.x, state.draft.point.y]);
    $("#composer-crumbs").innerHTML = crumbsHtml(state.draft, true);
    renderOverlay();
    composerText.focus();
    return;
  }

  if (event.target.closest("[data-close]")) closeCards();
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = composerText.value.trim();
  if (!text || !state.draft) return;
  // The chain only drives the crumbs on the page; the file keeps the path.
  const anchor = { ...state.draft };
  delete anchor.chain;
  try {
    await send({ op: "add", anchor, layer: state.layer, text });
    const created = state.doc.threads.at(-1);
    closeComposer();
    renderPanel();
    openThread(created.id, { from: "pin" });
    status("Comment saved");
  } catch (error) {
    status(error.message, "error");
  }
});

composerText.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) composer.requestSubmit();
});

replyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = replyText.value.trim();
  if (!text || !state.open) return;
  try {
    await send({ op: "reply", thread: state.open, text });
    // Sent: the box empties. A redraw of the same thread keeps what is in it,
    // which is right for a half-written reply and wrong for one just sent.
    // A phone keyboard still composing writes its last word back into a
    // focused box, so the box lets go of the focus first.
    replyText.blur();
    replyText.value = "";
    openThread(state.open);
  } catch (error) {
    status(error.message, "error");
  }
});

replyText.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) replyForm.requestSubmit();
});

$("#thread-status").addEventListener("click", async () => {
  const thread = state.doc.threads.find((t) => t.id === state.open);
  if (!thread) return;
  try {
    await send({ op: "status", thread: thread.id, status: thread.status === "resolved" ? "open" : "resolved" });
    const next = state.doc.threads.find((t) => t.id === thread.id);
    if (next.status === "resolved" && !state.showResolved) closeCards();
    else openThread(thread.id);
    renderPanel();
    renderOverlay();
    status(next.status === "resolved" ? "Resolved" : "Reopened");
  } catch (error) {
    status(error.message, "error");
  }
});

$("#thread-delete").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.dataset.armed !== "true") {
    button.dataset.armed = "true";
    button.textContent = "Delete the thread?";
    return;
  }
  try {
    await send({ op: "remove", thread: state.open });
    closeCards();
    status("Thread deleted");
  } catch (error) {
    status(error.message, "error");
  }
});

$("#show-resolved").addEventListener("change", (event) => {
  state.showResolved = event.target.checked;
  renderPanel();
  renderOverlay();
});

// A new stage size is a new margin round the world: it is drawn again for it.
window.addEventListener("resize", () => {
  baked = null;
  scheduleOverlay();
});
window.addEventListener("focus", loadComments);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadComments();
});

// ---- present -------------------------------------------------------------

// Present plays the board as a prototype: one screen at a time, fitted to the
// window. A control a link leaves from opens the screen it leads to, and a
// link with no control is a button in the bar. A click that hits no link
// lights the ones the screen has for a moment.
const player = $("#player");
const playerScreen = $("#player-screen");
const play = { at: null, back: [], flashTimer: 0 };

function present() {
  if (!state.board?.screens.length) return;
  const start = state.screens.has(state.touched) ? state.touched : state.board.screens[0].id;
  closeCards();
  hideTip();
  play.back = [];
  player.hidden = false;
  showScreen(start);
  $("#player-exit").focus();
}

function leavePlayer() {
  player.hidden = true;
  playerScreen.innerHTML = "";
  delete player.dataset.flash;
  $("#present").focus();
}

/**
 * The screen as the board draws it, taken from the world with its ids made
 * its own, and over it a target for each control a link leaves from.
 */
function showScreen(id) {
  const screen = state.screens.get(id);
  const drawn = world.querySelector(`svg.screen[data-screen="${CSS.escape(id)}"]`);
  if (!screen || !drawn) return;
  const { def } = screen;
  const own = (markup) =>
    markup
      .replace(/\sid="([^"]+)"/g, ' id="pl-$1"')
      .replace(/url\(#([^)]+)\)/g, "url(#pl-$1)")
      .replace(/((?:xlink:)?href=")#/g, "$1#pl-");
  const links = state.board.links.filter((link) => link.from === id && state.screens.has(link.to));
  const spots = new Map();
  for (const link of links) {
    const rect = link.at ? screen.rects.get(link.at) : null;
    if (rect && !spots.has(link.at)) spots.set(link.at, { rect, to: link.to });
  }
  const targets = [...spots.values()]
    .map(({ rect, to }) => `<rect class="spot" data-to="${esc(to)}" x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" rx="6"/>`)
    .join("");
  playerScreen.setAttribute("viewBox", `0 0 ${def.w} ${def.h}`);
  playerScreen.setAttribute("aria-label", def.title ?? id);
  playerScreen.innerHTML = own(world.querySelector(":scope > defs").outerHTML + drawn.innerHTML) + targets;
  $("#player-title").textContent = def.title ?? id;
  $("#player-next").innerHTML = links
    .filter((link) => !link.at || !screen.rects.get(link.at))
    .map((link) => `<button type="button" class="btn" data-to="${esc(link.to)}">${esc(link.label ?? state.screens.get(link.to).def.title ?? link.to)}</button>`)
    .join("");
  $("#player-back").disabled = play.back.length === 0;
  play.at = id;
}

function goTo(id) {
  play.back.push(play.at);
  showScreen(id);
}

function goBack() {
  if (play.back.length) showScreen(play.back.pop());
}

function flashSpots() {
  clearTimeout(play.flashTimer);
  player.dataset.flash = "true";
  play.flashTimer = setTimeout(() => delete player.dataset.flash, 400);
}

function playerKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    leavePlayer();
  } else if (event.key === "Backspace") {
    event.preventDefault();
    goBack();
  }
}

$("#present").addEventListener("click", present);

player.addEventListener("click", (event) => {
  const to = event.target.closest("[data-to]");
  if (to) return goTo(to.dataset.to);
  if (event.target.closest("#player-back")) return goBack();
  if (event.target.closest("#player-exit")) return leavePlayer();
  if (!event.target.closest(".player-bar")) flashSpots();
});

function toggleNote() {
  $("#board-note").open = !$("#board-note").open;
}

// ---- boot ----------------------------------------------------------------

async function boot() {
  // On a phone the comments card covers the canvas, so it starts folded there.
  const panel = store.get("review.panel", matchMedia("(max-width: 700px)").matches ? "closed" : "open");
  setPanel(panel !== "closed");
  rove(rail.querySelector(".item"));
  paintGround();
  watchDensity();
  // The note sits over the canvas, so it folds to its title and stays folded.
  // On a phone it is shown and hidden from the tools bar, and starts hidden.
  const note = $("#board-note");
  note.open = store.get("review.note", sideBar.matches ? "open" : "closed") !== "closed";
  $("#note-toggle").setAttribute("aria-pressed", String(note.open));
  note.addEventListener("toggle", () => {
    store.set("review.note", note.open ? "open" : "closed");
    $("#note-toggle").setAttribute("aria-pressed", String(note.open));
  });
  state.index = await (await fetch("/api/boards", { cache: "no-store" })).json();
  if (state.index.length === 0) {
    showEmpty();
    return;
  }
  const params = new URLSearchParams(location.hash.slice(1));
  await openBoard(params.get("project"), params.get("board"));
  const shot = params.get("shot");
  if (shot) showShot(shot);
}

// No project on this machine has a board yet: say how to add one.
function showEmpty() {
  $("#panel-empty-text").textContent = "No project has a board yet. A project appears here once its repository has docs/flows/boards/index.json.";
  $("#panel-empty").hidden = false;
  status("No boards found.");
}

// One screen alone, full page, so a headless browser can capture it:
// `msedge --headless=new --screenshot=out.png --window-size=1440,900
// --virtual-time-budget=8000 "http://localhost:3300/#project=<name>&board=<id>&shot=<screen>"`.
// This is how an agent checks a board without a visible window.
function showShot(id) {
  const screen = document.querySelector(`svg.screen[data-screen="${CSS.escape(id)}"]`);
  if (!screen) return;
  state.shot = true;
  const defs = document.querySelector("#world > defs");
  const w = screen.getAttribute("width");
  const h = screen.getAttribute("height");
  const markup = (defs.outerHTML + screen.innerHTML)
    .replace(/id="([^"]+)"/g, 'id="shot-$1"')
    .replace(/url\(#([^)]+)\)/g, "url(#shot-$1)");
  // No style attribute in the markup: the server's policy blocks inline
  // styles, so the few that are needed are set through the DOM.
  document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${markup}</svg>`;
  document.body.firstElementChild.style.display = "block";
  document.body.style.margin = "0";
  document.body.style.background = "#000";
}

// For an agent inspecting the page from a browser tool.
window.__review = { state, openBoard, fit, frame, present };

boot().catch((error) => {
  console.error(error, error?.stack);
  status(`Could not open the board: ${error.message}`, "error");
});
