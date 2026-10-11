// HIVEM1ND 3.0: the screens approved on 2026-10-10, drawn as a board. One window in three modes (Map,
// Blueprint and Void), plus the simplified phone view on the home network. The top row wears Modern, the
// default look; the bottom row wears High contrast, the option in Settings. Both rows are the same screens:
// each look is a palette of roles handed to the screen root as its theme, plus the few shapes that differ
// (Modern floats its panels with larger radii; High contrast rules them with lines). The sample is
// invented: its units, machines, tasks and times are examples.

import { board } from "blueprint/board.mjs";
import { box, col, row, stack, text, icon, vector, space, fill, ELLIPSE } from "blueprint/kit.mjs";

// ---- looks ----------------------------------------------------------------------------------------

// Source: projects/HIVEM1ND/screens-3.0/index.html of the mind, the `.set-m` variables. The Modern face
// is Figtree there; the board draws it in Atkinson Hyperlegible, the face this repository ships.
const MODERN = {
  bg: "#0f0b13", panel: "#18121d", card: "#211a27", card2: "#2b2232",
  line: "rgba(236,230,218,0.08)", line2: "rgba(236,230,218,0.15)",
  text: "#f5f1f6", body: "#d4ccd8", mute: "#aa9fb1",
  acc: "#bdcd79", accInk: "#1b200b", accSoft: "rgba(189,205,121,0.14)",
  ring: "#a48aaf", ringSoft: "rgba(164,138,175,0.14)", edge: "rgba(164,138,175,0.45)",
  ok: "#8fd19e", wait: "#e6c06f", waitSoft: "rgba(230,192,111,0.12)", idle: "#8e8496", sel: "#2e3324",
  me: "#3a2c43", meText: "#f5f1f6", labBg: "rgba(15,11,19,0.75)",
  zone: "rgba(164,138,175,0.35)", zoneFill: "rgba(164,138,175,0.04)", zoneLab: "#120d16", ground: "#130e17",
};

// Source: the same file, the base `.scr` variables (the High contrast set).
const CONTRAST = {
  bg: "#050505", panel: "#0b0b0b", card: "#141414", card2: "#1b1b1b", line: "#2a2a2a", line2: "#3a3a3a",
  text: "#f1efe9", body: "#c9c6bf", mute: "#8f8b85",
  acc: "#d4b06a", accInk: "#1b1408", accSoft: "rgba(212,176,106,0.14)",
  ring: "#d4b06a", ringSoft: "rgba(212,176,106,0.45)", edge: "#3d3d3d",
  ok: "#8bc28a", wait: "#d4b06a", waitSoft: "rgba(212,176,106,0.12)", idle: "#7d7a75", sel: "#1f1a10",
  me: "#1b1b1b", meText: "#f1efe9", labBg: "rgba(5,5,5,0.8)",
  zone: "#3a3a3a", zoneFill: "rgba(0,0,0,0)", zoneLab: "#050505", ground: "#050505",
};

const LOOKS = [
  { id: "modern", m: true, name: "Modern", theme: MODERN },
  { id: "contrast", m: false, name: "High contrast", theme: CONTRAST },
];

// ---- parts ----------------------------------------------------------------------------------------

const t = (value, size = 14, props = {}) => text(value, { size, ...props });
const mono = (value, size = 12.5, props = {}) => text(value, { size, face: "mono", ...props });
const ic = (name, size = 16, color = "body") => icon(`h3-${name}`, { size, color, stroke: 1.7 });
const centered = (node) => ({ ...node, place: "center" });

/** The mark: two hexagons, drawn on the 0..100 grid of a vector from the 56 by 48 original. */
const hex = (points) => `M${points.map(([x, y]) => `${((x / 56) * 100).toFixed(2)} ${((y / 48) * 100).toFixed(2)}`).join(" L")} Z`;
const HEX_A = hex([[14, 2], [26, 9], [26, 23], [14, 30], [2, 23], [2, 9]]);
const HEX_B = hex([[30, 18], [42, 25], [42, 39], [30, 46], [18, 39], [18, 25]]);
function mark(w = 26) {
  const h = Math.round((w * 48) / 56);
  return stack({ w, h }, vector({ w, h, d: HEX_A, fill: "#81648c" }), vector({ w, h, d: HEX_B, fill: "#bdcd79" }));
}

/** A status dot: working is filled green, waiting on the person is a ring, idle is grey. */
function dot(status, size = 8) {
  if (status === "wait") return box({ w: size, h: size, radius: "pill", stroke: "wait", strokeWidth: 2 });
  return box({ w: size, h: size, radius: "pill", fill: status === "work" ? "ok" : "idle" });
}

const circle = (d, props = {}) => box({ w: d, h: d, radius: "pill", place: "center", ...props });

function ibtn(L, glyph, name, label) {
  const size = L.m ? 36 : 32;
  return stack({ name, label, w: size, h: size, radius: L.m ? 12 : 8, fill: L.m ? "panel" : "card", stroke: L.m ? undefined : "line" }, centered(ic(glyph)));
}

function avatar(L, glyph, size = 30, glyphSize = 15, props = {}) {
  return stack({ w: size, h: size, radius: L.m ? 10 : 8, fill: "card2", stroke: L.m ? undefined : "line", ...props }, centered(ic(glyph, glyphSize)));
}

/** A box with a coloured bar down its left side, clipped to its corners. */
const barred = (color, outer, inner, kids) =>
  row({ align: "stretch", clip: true, ...outer }, box({ w: 3, fill: color }), col({ grow: 1, ...inner }, ...kids));

function button(L, label, kind = "plain", glyph = null, name = undefined) {
  const primary = kind === "pri";
  return row(
    {
      name, label, gap: 6, pad: L.m ? [7, 12] : [6, 11], radius: L.m ? 10 : 8,
      fill: primary ? "acc" : kind === "ghost" ? undefined : "card2",
      stroke: L.m ? undefined : primary ? "acc" : "line2",
    },
    glyph ? ic(glyph, 14, primary ? "accInk" : "text") : null,
    t(label, 12.5, { weight: L.m ? 600 : 700, color: primary ? "accInk" : kind === "ghost" && L.m ? "body" : "text" }),
  );
}

function waitingPill(L, label, glyphSize = 15) {
  return row(
    { name: "waiting", label: "Waiting on you", gap: 7, pad: [6, 12], radius: "pill", fill: L.m ? "waitSoft" : undefined, stroke: L.m ? undefined : "wait" },
    ic("hand", glyphSize, "wait"),
    t(label, 13, { weight: L.m ? 600 : 700, color: "wait" }),
  );
}

// ---- the window: bar, panels, status line ---------------------------------------------------------

function bar(L, mode, waiting = 2) {
  const modes = [["Map", "map"], ["Blueprint", "grid"], ["Void", "pen"]].map(([label, glyph]) => {
    const on = label === mode;
    return row(
      {
        name: `mode-${label.toLowerCase()}`, label, gap: 7, pad: [7, L.m ? 16 : 13], radius: L.m ? 10 : 8,
        fill: on ? "card2" : undefined, stroke: on && !L.m ? "line2" : undefined,
      },
      ic(glyph, 16, on ? "text" : "body"),
      t(label, 14, { weight: on ? 700 : L.m ? 600 : 400, color: on ? "text" : "body" }),
    );
  });
  return row(
    { name: "bar", label: "Bar", h: 52, gap: 18, pad: [0, L.m ? 20 : 16], fill: L.m ? undefined : "panel", edge: L.m ? undefined : { side: "bottom", color: "line" } },
    row({ gap: 9 }, mark(), t("HIVEM1ND", 15, { weight: 700, track: 0.06 })),
    fill(),
    row({ name: "modes", label: "Modes", gap: 4, pad: L.m ? 4 : 0, radius: 14, fill: L.m ? "panel" : undefined, stroke: L.m ? "line" : undefined }, ...modes),
    fill(),
    row({ gap: 10 }, waitingPill(L, `${waiting} waiting on you`), ibtn(L, "phone", "phone", "Open on the phone"), ibtn(L, "bell", "notifications", "Notifications")),
  );
}

function statusLine(L) {
  const note = (value) => t(value, 12.5, { color: "mute" });
  return row(
    { name: "status", label: "Status line", h: 30, pad: [0, L.m ? 22 : 16], justify: "between", fill: L.m ? undefined : "panel", edge: L.m ? undefined : { side: "top", color: "line" } },
    row({ gap: 7 }, dot("work"), note("Relay service running on DESKTOP")),
    note("Mind read 4 s ago"),
    row({ gap: 7 }, ic("desk", 14, "mute"), note("DESKTOP 23:41"), space(6), ic("lap", 14, "mute"), note("LAPTOP 23:40")),
  );
}

/** A side panel: floating with large radii in Modern, ruled on one side in High contrast. */
const panel = (L, side, props, ...kids) =>
  col({ ...props, fill: "panel", clip: true, ...(L.m ? { radius: 20, stroke: "line" } : { edge: { side, color: "line" } }) }, ...kids);

function tabs(L, list) {
  if (L.m) {
    return col(
      { pad: [12, 12, 0] },
      row(
        { pad: 4, gap: 4, radius: 12, fill: "card" },
        ...list.map(([label, glyph, on, name]) =>
          row(
            { name, label, grow: 1, justify: "center", gap: 7, pad: [7, 10], radius: 9, fill: on ? "card2" : undefined },
            ic(glyph, 15, on ? "text" : "mute"),
            t(label, 14, { weight: 600, color: on ? "text" : "mute" }),
          ),
        ),
      ),
    );
  }
  return row(
    { pad: [10, 10, 0], gap: 2, edge: { side: "bottom", color: "line" } },
    ...list.map(([label, glyph, on, name]) =>
      row(
        { name, label, gap: 7, pad: [8, 12], edge: on ? { side: "bottom", color: "acc", width: 2 } : undefined },
        ic(glyph, 15, on ? "text" : "mute"),
        t(label, 14, { weight: 700, color: on ? "text" : "mute" }),
      ),
    ),
  );
}

const search = (L) =>
  col(
    { pad: L.m ? 12 : 10 },
    row(
      { name: "search", label: "Search", gap: 8, pad: L.m ? [10, 12] : [8, 10], radius: L.m ? 12 : 8, fill: "card", stroke: L.m ? undefined : "line" },
      ic("search", 15, "mute"),
      t("Search units, projects and chats", 13, { color: "mute" }),
    ),
  );

const heading = (L, label) =>
  col(
    { pad: [12, 8, 6] },
    L.m ? t(label, 12.5, { weight: 600, color: "mute", track: 0.04 }) : t(label, 11.5, { color: "mute", upper: true, track: 0.08 }),
  );

/** A row of the Hierarchy: the role icon, the unit, then what it waits for and its status. */
function unitRow(L, { id, glyph, level = 0, status, sub, sel = false, plain = false, phone = false, name = `row-${id}` }) {
  const v = phone ? 11 : 6;
  const h = phone ? 10 : 8;
  return row(
    {
      name, label: id, gap: 8, pad: [v, h, v, [h, 24, 42][level]], radius: L.m ? 10 : 7,
      fill: sel ? (L.m ? "card2" : "accSoft") : undefined,
      edge: sel && !L.m ? { side: "left", color: "acc", width: 2 } : undefined,
    },
    ic(glyph, 15, "body"),
    plain ? t(id, phone ? 14 : 13.5, { color: "body" }) : mono(id, phone ? 13.5 : 12.5, { color: sel && L.m ? "acc" : "text" }),
    fill(),
    sub ? t(sub, 12, { color: "mute" }) : null,
    status ? dot(status) : null,
  );
}

function hierarchy(L, sel) {
  const chain = [
    ["overseer", "crown", 0, "idle"], ["adjutant", "adj", 1, "work"], ["overlord-web", "net", 1, "wait"],
    ["executor-shop", "term", 2, "work"], ["executor-blog", "term", 2, "idle"], ["executor-docs", "term", 2, "idle"],
    ["overlord-api", "net", 1, "work"], ["builder-codex", "term", 2, "work"], ["builder-codex-2", "term", 2, "idle"],
  ];
  return col(
    { name: "hierarchy", label: "Hierarchy", pad: [0, 6, 10] },
    heading(L, "Chain of command"),
    ...chain.map(([id, glyph, level, status]) => unitRow(L, { id, glyph, level, status, sel: id === sel })),
    heading(L, "Without an Overlord"),
    ...[["site", "1"], ["data", "2"], ["mobile", "4"]].map(([id, n]) => unitRow(L, { id, glyph: "task", sub: n, plain: true })),
    heading(L, "Services"),
    unitRow(L, { id: "incubator", glyph: "bulb", status: "idle" }),
    unitRow(L, { id: "genesis", glyph: "sliders" }),
  );
}

function chatRow(L, { name, title, glyph, when, badge, preview, sel = false }) {
  return row(
    { name, label: title, gap: 10, pad: [9, 10], radius: 9, fill: sel ? (L.m ? "card2" : "accSoft") : undefined },
    avatar(L, glyph),
    col(
      { grow: 1, gap: 2 },
      row(
        { gap: 8 },
        t(title, 14, { weight: 700, lines: 1 }),
        fill(),
        badge ? row({ pad: [1, 7], radius: "pill", fill: "acc" }, t(badge, 11, { weight: 700, color: "accInk" })) : t(when, 12, { color: "mute" }),
      ),
      t(preview, 12.5, { color: "mute", lines: 1 }),
    ),
  );
}

const chats = (L, sel) =>
  col(
    { name: "chats", label: "Chats", pad: [6, 6, 10] },
    heading(L, "Pinned"),
    chatRow(L, { name: "chat-executor-shop", title: "executor-shop", glyph: "term", when: "23:40", preview: "Task 029 is ready for review.", sel: sel === "shop" }),
    heading(L, "Recent"),
    chatRow(L, { name: "chat-cart-release", title: "Cart release", glyph: "users", badge: "3", preview: "executor-blog: The announcement post is drafted.", sel: sel === "cart" }),
    chatRow(L, { name: "chat-overlord-api", title: "overlord-api", glyph: "net", when: "22:15", preview: "Squad rules applied to builder-codex-2." }),
    chatRow(L, { name: "chat-adjutant", title: "adjutant", glyph: "adj", when: "21:02", preview: "The release notes draft is in Void." }),
    chatRow(L, { name: "chat-overseer", title: "overseer", glyph: "crown", when: "Yesterday", preview: "Two seats are waiting on you." }),
  );

const side = (L, tab, sel) =>
  panel(
    L, "right", { name: "side", label: "Side panel", w: L.m ? 266 : 290 },
    tabs(L, [["Hierarchy", "net", tab === "h", "tab-hierarchy"], ["Chats", "users", tab === "c", "tab-chats"]]),
    search(L),
    tab === "h" ? hierarchy(L, sel) : chats(L, sel),
  );

// ---- the Map: free circles on an open field --------------------------------------------------------
//
// Units are circles placed freely in X and Y, with the role icon inside, the status dot on the rim and the
// name below. Lines join who answers to whom; a dashed line is a unit that reports without leading. A
// drag on a node moves it, a drag from one node to another connects them, and a drag on empty space
// selects a group, which can be messaged at once.

const MID_W = 760;
const MID_H = 818;

const NODES = [
  { id: "master", glyph: "person", x: 380, y: 56, sz: 40, person: true, lab: "You" },
  { id: "overseer", glyph: "crown", x: 372, y: 178, sz: 64, status: "idle", boss: true },
  { id: "adjutant", glyph: "adj", x: 548, y: 118, sz: 46, status: "work" },
  { id: "overlord-web", glyph: "net", x: 196, y: 330, sz: 56, status: "wait", lead: true },
  { id: "executor-shop", glyph: "term", x: 84, y: 246, sz: 46, status: "work" },
  { id: "executor-blog", glyph: "term", x: 96, y: 430, sz: 46, status: "idle" },
  { id: "executor-docs", glyph: "term", x: 262, y: 470, sz: 46, status: "idle" },
  { id: "overlord-api", glyph: "net", x: 566, y: 352, sz: 56, status: "work", lead: true },
  { id: "builder-codex", glyph: "term", x: 676, y: 262, sz: 46, status: "work" },
  { id: "builder-codex-2", glyph: "term", x: 664, y: 470, sz: 46, status: "idle" },
  { id: "executor-site", glyph: "term", x: 214, y: 664, sz: 46, status: "idle" },
  { id: "executor-data", glyph: "term", x: 446, y: 602, sz: 46, status: "work" },
  { id: "reader-data", glyph: "term", x: 530, y: 690, sz: 46, status: "idle" },
  { id: "mobile", count: "4", x: 676, y: 640, sz: 52 },
];

const LINKS = [
  ["master", "overseer"], ["overseer", "adjutant", "dash"], ["overseer", "overlord-web"], ["overseer", "overlord-api"],
  ["overlord-web", "executor-shop"], ["overlord-web", "executor-blog"], ["overlord-web", "executor-docs"],
  ["overlord-api", "builder-codex"], ["overlord-api", "builder-codex-2"], ["overseer", "executor-data", "dash"],
  ["executor-data", "reader-data", "dash"],
];

const AT = Object.fromEntries(NODES.map((n) => [n.id, n]));
const gx = (x) => ((x / MID_W) * 100).toFixed(2);
const gy = (y) => ((y / MID_H) * 100).toFixed(2);
const segment = (a, b) => `M${gx(a.x)} ${gy(a.y)} L${gx(b.x)} ${gy(b.y)}`;
const lines = (list, props) => (list.length ? vector({ w: MID_W, h: MID_H, place: { x: 0, y: 0 }, d: list.join(" "), ...props }) : null);

/** The dot on a node's rim: a ring of the ground colour around the status colour. */
function rimDot(status) {
  const inner = status === "wait"
    ? box({ w: 11, h: 11, radius: "pill", place: "center", stroke: "wait", strokeWidth: 2.5 })
    : box({ w: 11, h: 11, radius: "pill", place: "center", fill: status === "work" ? "ok" : "idle" });
  return stack({ w: 15, h: 15, radius: "pill", fill: "bg" }, inner);
}

function unitNode(L, n, { sel, group }) {
  const room = n.sz + 24;
  const selected = n.id === sel;
  const grouped = group.includes(n.id);
  const kids = [];
  if (selected) kids.push(circle(n.sz + 14, { fill: "accSoft" }));
  else if (grouped) kids.push(circle(n.sz + (L.m ? 12 : 10), { fill: "accSoft" }));
  else if (n.lead) kids.push(L.m ? circle(n.sz + 10, { fill: "ringSoft" }) : circle(n.sz + 11, { stroke: "ringSoft", strokeWidth: 1.5 }));
  const accent = selected || grouped;
  const strokeColor = accent ? "acc" : n.lead ? "ring" : n.boss ? "text" : "line2";
  const width = accent || n.lead || n.boss ? 2 : L.m ? 1 : 1.5;
  kids.push(
    n.person
      ? circle(n.sz, { fill: "text" })
      : circle(n.sz, { fill: selected ? "sel" : "card", stroke: strokeColor, strokeWidth: width, dash: n.count ? "4 4" : undefined }),
  );
  kids.push(
    n.count
      ? centered(t(n.count, 13, { weight: 700, color: "body" }))
      : centered(ic(n.glyph, n.sz > 50 ? 22 : 18, n.person ? "bg" : accent ? "acc" : "body")),
  );
  if (n.status) {
    const at = (room - n.sz) / 2 + n.sz - 16;
    kids.push({ ...rimDot(n.status), place: { x: at, y: at } });
  }
  const label = n.lab ?? n.id;
  return [
    stack({ name: `node-${n.id}`, label, w: room, h: room, place: { x: n.x - room / 2, y: n.y - room / 2 } }, ...kids),
    col(
      { w: 200, align: "center", place: { x: n.x - 100, y: n.y + n.sz / 2 + 6 } },
      row({ pad: [1, 6], radius: 6, fill: "labBg" }, mono(label, 11.5, { weight: 700, color: "text" })),
    ),
  ];
}

/** A project without an Overlord: a dashed ring around its units, named on its top edge. */
function zone(cx, cy, w, h, label) {
  return [
    vector({ w, h, d: ELLIPSE, stroke: "zone", fill: "zoneFill", strokeWidth: 1, dash: "4 4", place: { x: cx - w / 2, y: cy - h / 2 } }),
    col(
      { w: 160, align: "center", place: { x: cx - 80, y: cy - h / 2 - 10 } },
      row({ pad: [2, 6], radius: 6, fill: "zoneLab" }, t(label, 11.5, { color: "mute", track: 0.04 })),
    ),
  ];
}

const tip = (L, glyph, label, at) =>
  row(
    { gap: 6, pad: [6, 10], radius: L.m ? 12 : 8, fill: "text", place: at },
    glyph ? ic(glyph, 13, "bg") : null,
    t(label, 12, { weight: 700, color: "bg" }),
  );

const zoom = (L) =>
  row(
    { name: "zoom", label: "Zoom", gap: 4, pad: 4, radius: L.m ? 14 : 10, fill: L.m ? "panel" : "card", stroke: "line", place: "bottom-left", dx: 14, dy: -14 },
    ...[ic("plus", 14), t("−", 12.5, { color: "body" }), t("Fit", 12.5, { color: "body" }), t("100%", 12.5, { color: "body" })].map((kid) =>
      row({ h: 28, pad: [0, 7] }, kid),
    ),
  );

function services(L) {
  const pill = (...kids) => row({ gap: 7, pad: [6, 12], radius: "pill", fill: L.m ? "panel" : "card", stroke: L.m ? "line" : "line2" }, ...kids);
  return row(
    { name: "services", label: "Services", gap: 6, place: "bottom-right", dx: -14, dy: -14 },
    t("Services", 12, { color: "mute" }),
    pill(ic("bulb", 14), t("Incubator", 13, { color: "body" }), dot("idle")),
    pill(ic("sliders", 14), t("Genesis", 13, { color: "body" })),
  );
}

function mapField(L, { sel = null, group = [], mode = "connect" }) {
  const hot = ([a, b]) => (sel && (a === sel || b === sel)) || (group.includes(a) && group.includes(b));
  const seg = ([a, b]) => segment(AT[a], AT[b]);
  const width = L.m ? 1.6 : 1.5;
  const site = AT["executor-site"];
  const web = AT["overlord-web"];
  const hints = ["Drag a node to move it", "Drag from one node to another to connect", "Drag on empty space to select"];
  const action = mode === "connect"
    ? [
        circle(62, { stroke: "acc", strokeWidth: 2, dash: "6 5", place: { x: site.x - 31, y: site.y - 31 } }),
        tip(L, "net", "executor-site will report to overlord-web", { x: 252, y: 566 }),
      ]
    : [
        box({ name: "selection", label: "Selection", w: 206, h: 252, radius: L.m ? 14 : 6, stroke: "acc", strokeWidth: 1.5, dash: "6 5", fill: "accSoft", place: { x: 40, y: 206 } }),
        tip(L, null, "3 selected: Message, Group chat, Connect", { x: 256, y: 214 }),
      ];
  return stack(
    { name: "map", label: "Map", w: MID_W, fill: L.m ? "ground" : "bg", clip: true, ...(L.m ? { radius: 20, stroke: "line" } : {}) },
    row({ gap: 14, place: { x: 14, y: 12 } }, ...hints.map((hint) => t(hint, 12, { color: "mute" }))),
    ...zone(214, 664, 120, 120, "site"),
    ...zone(488, 646, 220, 200, "data"),
    lines(LINKS.filter((e) => !e[2] && !hot(e)).map(seg), { stroke: "edge", strokeWidth: width }),
    lines(LINKS.filter((e) => e[2] && !hot(e)).map(seg), { stroke: "edge", strokeWidth: width, dash: "4 5" }),
    lines(LINKS.filter(hot).map(seg), { stroke: "acc", strokeWidth: 2 }),
    mode === "connect" ? lines([segment(web, { x: site.x, y: site.y - 32 })], { stroke: "acc", strokeWidth: 2, dash: "6 5" }) : null,
    ...NODES.flatMap((n) => unitNode(L, n, { sel, group })),
    ...action,
    zoom(L),
    services(L),
  );
}

// ---- the inspector: the selection, its facts and its conversation --------------------------------

function inspectorHead(L, { glyph, title, sub, monoTitle = true, right = [] }) {
  return row(
    { gap: 11, pad: L.m ? [18, 18, 10] : [14, 16], edge: L.m ? undefined : { side: "bottom", color: "line" } },
    avatar(L, glyph, 38, 18),
    col({ gap: 2 }, monoTitle ? mono(title, 15, { weight: 700 }) : t(title, 15, { weight: 700 }), sub),
    fill(),
    ...right,
  );
}

function facts(L, pairs) {
  const cells = pairs.map(([k, v]) => col({ grow: 1, gap: 2 }, t(k, 11.5, { color: "mute" }), v));
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(row({ gap: 16, align: "start" }, cells[i], cells[i + 1] ?? null));
  if (L.m) return col({ pad: [0, 12] }, col({ gap: 8, pad: 12, radius: 14, fill: "card" }, ...rows));
  return col({ gap: 8, pad: [12, 16], edge: { side: "bottom", color: "line" } }, ...rows);
}

function message(L, { who, when, body, me = false }) {
  return col(
    { gap: 4, align: me ? "end" : "start", pad: me ? [0, 0, 0, 28] : [0, 28, 0, 0] },
    row({ gap: 8 }, mono(who, 12, { weight: 700 }), t(when, 12, { color: "mute" })),
    col(
      { pad: L.m ? [10, 14] : [9, 12], radius: L.m ? 18 : 12, fill: me ? "me" : "card", stroke: L.m ? undefined : "line" },
      t(body, L.m ? 14.5 : 13.5, { color: me ? "meText" : "body" }),
    ),
  );
}

const code = (value) => row({ pad: [2, 6], radius: 5, fill: "card2" }, mono(value, 12.5, { weight: 500, color: "text" }));

/** Something the agent asks of the person: a permission or a task delivered for review. */
function ask(L, question, buttons) {
  const kids = [row({ gap: 8 }, ...question), row({ gap: 6 }, ...buttons)];
  if (L.m) return barred("wait", { name: "ask", label: "Ask", radius: 16, fill: "card" }, { gap: 8, pad: [11, 12] }, kids);
  return col({ name: "ask", label: "Ask", gap: 8, pad: [11, 12], radius: 12, fill: "card", stroke: "wait" }, ...kids);
}

const buildAsk = (L, always = "Approve always", deny = true) =>
  ask(
    L,
    [ic("hand", 15, "text"), t("Asks to run", 13, { color: "text" }), code("npm run build")],
    [button(L, "Approve", "pri", "check", "approve"), button(L, always, "plain", null, "approve-always"), deny ? button(L, "Deny", "ghost", null, "deny") : null],
  );

const reviewAsk = (L, open = true) =>
  ask(
    L,
    [ic("task", 15, "text"), t("Task 029 delivered for review", 13, { color: "text" })],
    [button(L, "Accept", "pri", null, "accept"), button(L, "Send back", "plain", null, "send-back"), open ? button(L, "Open task", "ghost", null, "open-task") : null],
  );

function composer(L, placeholder, note = null, noteGlyph = null, ruled = false) {
  const send = L.m ? 34 : 30;
  return col(
    { name: "composer", label: "Composer", gap: 7, pad: L.m ? [12, 14, 16] : [12, 16, 14], edge: !L.m || ruled ? { side: "top", color: "line" } : undefined },
    row(
      { gap: 8, pad: L.m ? [8, 8, 8, 16] : [10, 10, 10, 13], radius: L.m ? 22 : 11, fill: "card", stroke: "line2" },
      t(placeholder, 14, { color: "mute" }),
      fill(),
      stack({ name: "send", label: "Send", w: send, h: send, radius: L.m ? "pill" : 8, fill: "acc" }, centered(ic("send", 15, "accInk"))),
    ),
    note ? row({ gap: 6 }, ic(noteGlyph, 13, "mute"), t(note, 12, { color: "mute" })) : null,
  );
}

const conversation = (L, ...kids) =>
  col({ name: "conversation", label: "Conversation", grow: 1, gap: L.m ? 14 : 12, pad: L.m ? [16, 18] : [14, 16], clip: true }, ...kids);

const unitInspector = (L) =>
  panel(
    L, "left", { name: "inspector", label: "Inspector", w: L.m ? 366 : 390 },
    inspectorHead(L, {
      glyph: "term",
      title: "executor-shop",
      sub: row({ gap: 6 }, dot("work"), t("Working on task 029", 12.5, { color: "mute" })),
      right: [row({ gap: 6 }, ibtn(L, "pin", "pin", "Pin"), ibtn(L, "dots", "more", "More"))],
    }),
    facts(L, [
      ["Machine", row({ gap: 6 }, ic("desk", 14, "text"), t("DESKTOP", 13, { color: "text" }))],
      ["Client", t("Claude Code", 13, { color: "text" })],
      ["Model", t("Sonnet 5.5, high", 13, { color: "text" })],
      ["Reports to", t("overlord-web", 13, { color: "text" })],
    ]),
    conversation(
      L,
      message(L, { who: "You", when: "21:05", body: "Add the empty state to the cart page, as drawn on the Cart board.", me: true }),
      message(L, { who: "executor-shop", when: "23:31", body: "Done on feat/cart-empty. The page and its test pass; the board has my notes." }),
      buildAsk(L),
      reviewAsk(L),
    ),
    composer(L, "Message executor-shop", "The session is notified at once", "bell"),
  );

function avatars(L) {
  return stack(
    { w: 66, h: 26 },
    ...["term", "term", "net"].map((glyph, i) => avatar(L, glyph, 26, 13, { place: { x: i * 20, y: 0 }, stroke: "panel", strokeWidth: 2 })),
  );
}

const groupInspector = (L) =>
  panel(
    L, "left", { name: "inspector", label: "Inspector", w: L.m ? 366 : 390 },
    inspectorHead(L, {
      glyph: "users",
      title: "Cart release",
      monoTitle: false,
      sub: t("Group chat, 3 units", 12.5, { color: "mute" }),
      right: [row({ gap: 6 }, avatars(L), ibtn(L, "dots", "more", "More"))],
    }),
    facts(L, [
      ["Members", mono("executor-shop, executor-blog, overlord-web", 12, { color: "text" })],
      ["Started", t("Today 22:40", 13, { color: "text" })],
    ]),
    conversation(
      L,
      message(L, { who: "You", when: "22:40", body: "Cart release tonight: shop finishes the empty state, blog announces it, web reviews.", me: true }),
      message(L, { who: "overlord-web", when: "22:44", body: "Understood. I review task 029 when it lands." }),
      message(L, { who: "executor-shop", when: "23:31", body: "Empty state done, task 029 delivered." }),
      message(L, { who: "executor-blog", when: "23:38", body: "The announcement post is drafted and waits for the merge." }),
    ),
    composer(L, "Message the group", "Every member sees every reply", "users"),
  );

// ---- Blueprint and Void: the editors with their attached agents ------------------------------------

const EDITOR_W = (L) => (L.m ? 796 : 820);

function listSide(L, tab, glyph, items) {
  return panel(
    L, "right", { name: "side", label: tab, w: L.m ? 228 : 240 },
    tabs(L, [[tab, glyph, true, `tab-${tab.toLowerCase()}`]]),
    col(
      { pad: 8, gap: 2 },
      ...items.map(([label, sub, sel]) =>
        row(
          {
            name: `item-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label, gap: 8, pad: [8, 10], radius: L.m ? 10 : 7,
            fill: sel ? (L.m ? "card2" : "accSoft") : undefined,
            edge: sel && !L.m ? { side: "left", color: "acc", width: 2 } : undefined,
          },
          ic(glyph, 15),
          t(label, 13.5, { color: "body" }),
          fill(),
          sub ? t(sub, 12, { color: "mute" }) : null,
        ),
      ),
    ),
  );
}

const editorGround = (L, name, label, ...kids) =>
  stack({ name, label, w: EDITOR_W(L), fill: L.m ? "ground" : "bg", clip: true, ...(L.m ? { radius: 20, stroke: "line" } : {}) }, ...kids);

const toolbar = (L, ...kids) =>
  row(
    { name: "toolbar", label: "Toolbar", gap: 10, pad: [6, 8, 6, 12], radius: L.m ? 14 : 12, fill: L.m ? "panel" : "card", stroke: "line", place: "top-center", dy: 14 },
    ...kids,
  );

const chip = (L, glyph, label) =>
  row({ gap: 6, pad: [4, 9], radius: "pill", fill: "card2", stroke: L.m ? undefined : "line" }, ic(glyph, 13), mono(label, 12, { weight: 500, color: "text" }));

const watch = (L, label, on, glyph, name) =>
  row(
    { name, label, gap: 6, pad: [6, 10], radius: L.m ? 10 : 8, fill: on ? "acc" : L.m ? "card2" : undefined, stroke: on || L.m ? undefined : "line2" },
    glyph ? ic(glyph, 14, on ? "accInk" : "body") : null,
    t(label, 12.5, { weight: 700, color: on ? "accInk" : "body" }),
  );

/** A comment pin: a teardrop with a square corner, numbered. */
function pin(size = 26, label = "1") {
  return stack(
    { w: size, h: size },
    box({ w: size, h: size, radius: "pill", fill: "wait", place: { x: 0, y: 0 } }),
    box({ w: size / 2, h: size / 2, radius: 4, fill: "wait", place: { x: 0, y: size / 2 } }),
    centered(t(label, size > 22 ? 12 : 11, { weight: 700, color: "#1b1408" })),
  );
}

const wire = (x, y, w, h, accent = false) =>
  box({ w, h, radius: 7, fill: accent ? "accSoft" : "card2", stroke: accent ? "acc" : undefined, place: { x, y } });
const wireLine = (x, y, w) => box({ w, h: 9, radius: 5, fill: "card2", place: { x, y } });

const artboard = (L, x, title, name, kids) => [
  t(title, 12, { color: "mute", place: { x: x + 2, y: 98 } }),
  stack({ name, label: title, w: 300, h: 560, radius: L.m ? 18 : 12, fill: "card", stroke: L.m ? undefined : "line2", clip: true, place: { x, y: 120 } }, ...kids),
];

function comment(L, { who, when, body, reply = false, pinLabel = null, live = false, buttons = null }) {
  const kids = [
    row(
      { gap: 8 },
      pinLabel ? pin(20, pinLabel) : null,
      mono(who, 12, { weight: 700 }),
      t(when, 12, { color: "mute" }),
      live ? fill() : null,
      live ? row({ gap: 5 }, dot("work"), t("Live", 11, { weight: 700, color: "acc" })) : null,
    ),
    t(body, 13.5, { color: "body" }),
    buttons ? row({ gap: 6 }, ...buttons) : null,
  ];
  const card = reply && L.m
    ? barred("acc", { radius: 16, fill: "card" }, { gap: 6, pad: [11, 12] }, kids)
    : col({ gap: 6, pad: [11, 12], radius: L.m ? 16 : 12, fill: "card", stroke: L.m ? undefined : reply ? "acc" : "line" }, ...kids);
  return reply ? col({ pad: [0, 0, 0, 18] }, card) : card;
}

const commentsPanel = (L, { glyph, sub, thread, reply, note, noteGlyph }) =>
  panel(
    L, "left", { name: "comments", label: "Comments", w: L.m ? 368 : 380 },
    inspectorHead(L, { glyph, title: "Comments", monoTitle: false, sub: t(sub, 12.5, { color: "mute" }) }),
    col({ name: "thread", label: "Thread", grow: 1, gap: 10, pad: [14, 16], clip: true }, ...thread),
    composer(L, reply, note, noteGlyph),
  );

const editorBody = (L, ...kids) => row({ h: 818, gap: L.m ? 12 : 0, pad: L.m ? [0, 12] : 0, align: "stretch" }, ...kids);

function blueprintCanvas(L) {
  return editorGround(
    L, "board-canvas", "Board",
    toolbar(L, t("Attached", 13, { color: "body" }), chip(L, "term", "executor-shop"), chip(L, "net", "overlord-web"), watch(L, "Watching executor-shop", true, "eye", "watch")),
    ...artboard(L, 70, "Cart, empty", "art-empty", [
      wireLine(20, 22, 120), wire(20, 56, 260, 150), wireLine(60, 236, 180), wireLine(80, 256, 140), wire(70, 300, 160, 40, true),
    ]),
    ...artboard(L, 420, "Cart, with items", "art-items", [
      wireLine(20, 22, 120), wire(20, 56, 260, 64), wire(20, 130, 260, 64),
      box({ name: "drawing", label: "Shape being drawn", w: 260, h: 64, radius: 8, stroke: "acc", strokeWidth: 2, dash: "6 4", fill: "accSoft", place: { x: 20, y: 204 } }),
    ]),
    row(
      { name: "agent-cursor", label: "The agent drawing", gap: 4, align: "start", place: { x: 640, y: 370 } },
      ic("cursor", 18, "text"),
      col({ pad: [14, 0, 0] }, row({ pad: [3, 8], radius: 6, fill: "acc" }, mono("executor-shop", 11.5, { weight: 700, color: "accInk" }))),
    ),
    { ...pin(26), name: "pin-1", label: "Comment 1", place: { x: 240, y: 300 } },
  );
}

const DOC = {
  intro: "HIVEM1ND 3.0 brings every agent of the mind onto one Map. Units are created where they run, and every conversation is kept.",
  service: "Each machine runs one Relay service, started at login. It wakes the sessions on that machine and starts new ones from the Map.",
  mail: "Every unit has a mailbox for messages left while it is not running. A chat opens its own inbox, so a conversation with one unit or a group stays in one place.",
  live: "Agents draw in Blueprint and write in Void through the service. The person watches a step at a time, or lets the work run off screen.",
};

function voidCanvas(L) {
  const size = L.m ? 15.5 : 15;
  const para = (value) => col({ pad: [0, 0, 12] }, t(value, size, { color: "body", lh: 1.65 }));
  const h3 = (value) => col({ pad: [10, 0, 6] }, t(value, 16, { weight: 700, color: "text" }));
  return editorGround(
    L, "text-canvas", "Text",
    toolbar(L, t("Attached", 13, { color: "body" }), chip(L, "adj", "adjutant"), watch(L, "Watch", false, "eye", "watch"), watch(L, "Focus", true, null, "focus")),
    col(
      { name: "document", label: "Document", w: 640, h: 760, pad: [44, 56], radius: L.m ? 20 : 12, fill: L.m ? "panel" : "card", stroke: L.m ? undefined : "line", clip: true, place: "top-center", dy: 70 },
      t("HIVEM1ND 3.0", 26, { weight: 700, color: "text" }),
      space(6),
      t("Release notes, draft by adjutant", 13, { color: "mute" }),
      space(20),
      para(DOC.intro),
      h3("One service per machine"),
      para(DOC.service),
      row(
        { pad: [0, 0, 12] },
        row({ name: "changed", label: "Changed sentence", fill: "accSoft", edge: { side: "bottom", color: "acc", width: 2 } }, t("An idle machine sends nothing and spends nothing.", size, { color: "body", lh: 1.65 })),
      ),
      h3("Chats and mailboxes"),
      para(DOC.mail),
      h3("Live editors"),
      para(DOC.live),
    ),
  );
}

// ---- screens --------------------------------------------------------------------------------------

const windowOf = (L, mode, waiting, body) => () =>
  col({ w: 1440, h: 900, fill: "bg", theme: L.theme }, bar(L, mode, waiting), body(L), statusLine(L));

const mapBody = (L) => row({ h: 818, gap: L.m ? 12 : 0, pad: L.m ? [0, 12] : 0, align: "stretch" }, side(L, "h", "executor-shop"), mapField(L, { sel: "executor-shop" }), unitInspector(L));

const chatsBody = (L) =>
  row(
    { h: 818, gap: L.m ? 12 : 0, pad: L.m ? [0, 12] : 0, align: "stretch" },
    side(L, "c", "cart"),
    mapField(L, { group: ["executor-shop", "executor-blog", "overlord-web"], mode: "select" }),
    groupInspector(L),
  );

const blueprintBody = (L) =>
  editorBody(
    L,
    listSide(L, "Boards", "grid", [["Cart page", "shop", true], ["Checkout flow", "shop"], ["API console", "api"], ["Landing hero", "site"]]),
    blueprintCanvas(L),
    commentsPanel(L, {
      glyph: "grid",
      sub: "Cart page, 1 open thread",
      thread: [
        comment(L, { who: "You", when: "23:12", pinLabel: "1", body: "The empty state needs a clear way back to the shop. Add a second row with an item." }),
        comment(L, { who: "executor-shop", when: "23:13", reply: true, live: true, body: "Adding a button to Continue shopping, and drawing the row with an item now." }),
      ],
      reply: "Reply on the board",
      note: "Attached agents answer at once",
      noteGlyph: "bell",
    }),
  );

const voidBody = (L) =>
  editorBody(
    L,
    listSide(L, "Texts", "pen", [["Release notes 3.0", null, true], ["Relay manual"], ["Install guide"], ["Squad rules"]]),
    voidCanvas(L),
    commentsPanel(L, {
      glyph: "pen",
      sub: "Release notes 3.0",
      thread: [
        comment(L, { who: "You", when: "23:20", body: "Say what an idle machine costs: no requests, not only no traffic." }),
        comment(L, {
          who: "adjutant", when: "23:21", reply: true,
          body: "Changed to: an idle machine makes no requests and sends nothing.",
          buttons: [button(L, "Accept change", "pri", null, "accept-change"), button(L, "Discard", "ghost", null, "discard")],
        }),
      ],
      reply: "Reply on the text",
      note: "Watch is off: the agent works off screen",
      noteGlyph: "eye",
    }),
  );

/** Void, Focus: pure black, the interface hidden, only the text and its caret. */
const focus = (L) => () =>
  stack(
    { w: 1440, h: 900, fill: "#000000", theme: L.theme },
    row(
      { gap: 16, place: "top-right", dx: -22, dy: 16 },
      ...["Arrows move through the text", "Move the mouse to show the tools", "Esc returns to the Document view"].map((hint) => t(hint, 12.5, { color: "#5f5a57" })),
    ),
    col(
      { name: "focus-text", label: "Text", w: 640, gap: 18, place: "top-center", dy: 120 },
      col({ pad: [0, 0, 10] }, t("HIVEM1ND 3.0", 28, { weight: 700, color: "#f1efe9" })),
      t(DOC.intro, 17, { color: "#d8d4cc", lh: 1.8 }),
      t(`${DOC.service} An idle machine makes no requests and sends nothing.`, 17, { color: "#d8d4cc", lh: 1.8 }),
      // The caret ends the last line, so the paragraph is given in its two lines.
      col(
        {},
        t("Every unit has a mailbox for messages left while it is not running. A chat opens its", 17, { color: "#d8d4cc", lh: 1.8, lines: 1 }),
        row({ gap: 2 }, t("own inbox, so a conversation with one unit or a group stays in one place.", 17, { color: "#d8d4cc", lh: 1.8 }), box({ name: "caret", label: "Caret", w: 2, h: 22, fill: "#bdcd79" })),
      ),
    ),
  );

// ---- the phone: see, chat and approve on the home network ------------------------------------------

function phoneTop(L, title, waiting = null) {
  return [
    row({ h: 44, pad: [0, 22], justify: "between" }, t("23:42", 13, { weight: 700 }), t("HIVEM1ND", 13, { weight: 700 })),
    row(
      { h: 52, gap: 10, pad: [0, 14], fill: L.m ? undefined : "panel", edge: L.m ? undefined : { side: "bottom", color: "line" } },
      mark(),
      t(title, 16, { weight: 700 }),
      fill(),
      waiting ? waitingPill(L, String(waiting), 14) : null,
    ),
  ];
}

function phoneNav(L, on) {
  const items = [["Hierarchy", "net"], ["Chats", "users"], ["Waiting", "hand"]].map(([label, glyph]) =>
    col(
      { name: `nav-${label.toLowerCase()}`, label, grow: 1, align: "center", gap: 2 },
      ic(glyph, 18, label === on ? "acc" : "mute"),
      t(label, 11.5, { weight: label === on ? 700 : 400, color: label === on ? "acc" : "mute" }),
    ),
  );
  if (L.m) return col({ h: 64, pad: [0, 14, 12] }, row({ name: "nav", label: "Navigation", grow: 1, radius: "pill", fill: "panel", stroke: "line" }, ...items));
  return row({ name: "nav", label: "Navigation", h: 64, fill: "panel", edge: { side: "top", color: "line" } }, ...items);
}

const phone = (L, ...kids) => col({ w: 390, h: 844, radius: 28, fill: "bg", clip: true, theme: L.theme }, ...kids);

const phoneHierarchy = (L) => () =>
  phone(
    L,
    ...phoneTop(L, "Hierarchy", 2),
    col(
      { name: "hierarchy", label: "Hierarchy", grow: 1, pad: [6, 10], clip: true },
      heading(L, "Chain of command"),
      unitRow(L, { id: "overseer", glyph: "crown", status: "idle", phone: true }),
      unitRow(L, { id: "overlord-web", glyph: "net", level: 1, sub: "waiting", status: "wait", phone: true }),
      unitRow(L, { id: "executor-shop", glyph: "term", level: 2, sub: "2 asks", status: "work", sel: true, phone: true }),
      unitRow(L, { id: "executor-blog", glyph: "term", level: 2, status: "idle", phone: true }),
      unitRow(L, { id: "overlord-api", glyph: "net", level: 1, status: "work", phone: true }),
      unitRow(L, { id: "builder-codex", glyph: "term", level: 2, status: "work", phone: true }),
      heading(L, "Without an Overlord"),
      unitRow(L, { id: "data", glyph: "task", sub: "2", plain: true, phone: true }),
      unitRow(L, { id: "mobile", glyph: "task", sub: "4", plain: true, phone: true }),
      heading(L, "Home network"),
      unitRow(L, { id: "Access closes in 11 h 58 min", name: "row-access", glyph: "phone", plain: true, phone: true }),
    ),
    phoneNav(L, "Hierarchy"),
  );

const phoneChat = (L) => () =>
  phone(
    L,
    ...phoneTop(L, "executor-shop"),
    col(
      { name: "conversation", label: "Conversation", grow: 1, gap: 12, pad: 14, clip: true },
      message(L, { who: "executor-shop", when: "23:31", body: "Done on feat/cart-empty. The page and its test pass." }),
      buildAsk(L, "Always"),
      reviewAsk(L, false),
      message(L, { who: "You", when: "23:42", body: "Approved. Merge after overlord-web reviews.", me: true }),
    ),
    composer(L, "Message executor-shop", null, null, true),
  );

// ---- the board ------------------------------------------------------------------------------------

const NOTES = {
  map: "Free circles on an open field; a selected Executor with its chat on the right, and a drag connecting executor-site to overlord-web.",
  chats: "A drag on empty space selects three units; their group chat opens on the right. Chats keeps every conversation, pinned first.",
  blueprint: "A board with its attached agents. Watch is on, so the agent draws live and its cursor shows; comments sit on the right.",
  void: "The Document view, the default. Watch is off: the agent works off screen and its change waits in the comment. Focus opens the real Void.",
  focus: "Pure black, the interface hidden; the arrows move through the text and the mouse brings the tools back. Esc returns to the Document view.",
  phoneHierarchy: "The phone on the home network: see, chat and approve, no editing. The access closes after 12 hours.",
  phoneChat: "A unit's chat on the phone, with its asks answered in place.",
};

const STEP = 1440 + 200;
const ROW = 900 + 320;

const screens = LOOKS.flatMap((L, r) => {
  const y = r * ROW;
  const suffix = L.m ? "" : ", High contrast";
  return [
    { id: `${L.id}-map`, title: `1. Map${suffix}`, x: 0, y, root: windowOf(L, "Map", 2, mapBody), note: NOTES.map },
    { id: `${L.id}-chats`, title: `2. Chats${suffix}`, x: STEP, y, root: windowOf(L, "Map", 2, chatsBody), note: NOTES.chats },
    { id: `${L.id}-blueprint`, title: `3. Blueprint${suffix}`, x: STEP * 2, y, root: windowOf(L, "Blueprint", 1, blueprintBody), note: NOTES.blueprint },
    { id: `${L.id}-void`, title: `4. Void, Document view${suffix}`, x: STEP * 3, y, root: windowOf(L, "Void", 1, voidBody), note: NOTES.void },
    { id: `${L.id}-focus`, title: `5. Void, Focus${suffix}`, x: STEP * 4, y, root: focus(L), note: NOTES.focus },
    { id: `${L.id}-phone-hierarchy`, title: `6. Phone, Hierarchy${suffix}`, x: STEP * 5, y, w: 390, h: 844, root: phoneHierarchy(L), note: NOTES.phoneHierarchy },
    { id: `${L.id}-phone-chat`, title: `7. Phone, a chat${suffix}`, x: STEP * 5 + 390 + 120, y, w: 390, h: 844, root: phoneChat(L), note: NOTES.phoneChat },
  ];
});

export default board({
  id: "hivem1nd-3",
  title: "HIVEM1ND 3.0: the approved screens",
  note:
    "HIVEM1ND 3.0 as approved on 2026-10-10. Top row: Modern, the default look. Bottom row: High contrast, the option in Settings. " +
    "Present plays the Modern row: Chats from the Map, the modes in the bar, Focus from Void and the phone. The sample is invented.",
  screens,
  links: [
    { from: "modern-map", to: "modern-chats", at: "tab-chats", label: "Chats" },
    { from: "modern-map", to: "modern-blueprint", at: "mode-blueprint", label: "Blueprint" },
    { from: "modern-blueprint", to: "modern-void", at: "mode-void", label: "Void" },
    { from: "modern-void", to: "modern-focus", at: "focus", label: "Focus" },
    { from: "modern-focus", to: "modern-void", label: "Esc" },
    { from: "modern-map", to: "modern-phone-hierarchy", at: "phone", label: "Open on the phone" },
    { from: "modern-phone-hierarchy", to: "modern-phone-chat", at: "row-executor-shop", label: "executor-shop" },
  ],
});
