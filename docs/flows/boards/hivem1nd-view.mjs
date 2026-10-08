// The HIVEM1ND view: the mind as a living graph of chats. Every chat is a node, chats work in
// squads around a lead, and the person sits at the top. Work goes down from a lead to its
// builders and comes back up through the lead, so what reaches the person has been reviewed
// once already. The graph is the home: zoom, pan, right-click to create, a left menu and a
// right inspector that both hide. Gold means one thing only, waiting on the person, and every
// gold ring on the graph is one item of the Waiting tray.
// The kit owns the contract hivem1nd-view-v1 and its reader, `hivem1nd view --json`; each host
// application draws these screens in its own stack and maps its tokens onto the roles used here.
// The view never writes a file itself: every action is an intent the host applies after the
// person confirms it. Sample data is invented: projects myapp, shop and mygame.

import { board } from "blueprint/board.mjs";
import { box, col, row, stack, text, icon, space, fill, vector } from "blueprint/kit.mjs";
import { dot } from "blueprint/ui.mjs";

const W = 1440;
const H = 900;
const TOP = 52;
const LEFT = 248;
const RIGHT = 368;

// Model tiers from the model table; their hues live only in the avatar, so a squad reads at a
// glance without colouring the UI. A host shows the real model names from the person's table.
const MODEL = {
  strong: { hue: "#b49cf5", wash: "#1d1730", initial: "S", name: "strong model" },
  mid: { hue: "#82aaff", wash: "#141b2c", initial: "M", name: "mid model" },
  light: { hue: "#9fd28a", wash: "#152015", initial: "L", name: "light model" },
  tool: { hue: "#6fd4c4", wash: "#11201e", initial: "T", name: "another tool" },
};

const INK = "#e6e3dc";
const SOFT = "#cfccc4";
const MUTE = "#8a877f";
const EDGE = "#4a4a4a";
const LIT = "#cfccc4";
const GOLD = "#d4b06a";
const GOLD_WASH = "#241d0f";
const AMBER = "#d08a4a";
const RED = "#c07f7f";
const GREEN = "#7fb08a";
const GREY = "#a9a69e";
const OUT = "#6a675f";

const STATE = {
  working: { color: GREEN, label: "Working" },
  waiting: { color: GOLD, label: "Waiting on you" },
  idle: { color: GREY, label: "Idle" },
  out: { color: OUT, label: "Out" },
  lost: { color: AMBER, label: "Lost" },
  unreachable: { color: AMBER, label: "Unreachable" },
  quota: { color: AMBER, label: "Out of quota" },
  unknown: { color: RED, label: "Status unknown" },
};

// ---- small pieces ----------------------------------------------------------------

const label = (value, props = {}) => text(value, { size: 11, color: MUTE, ...props });

const chip = (value, { color = MUTE, tone = "#161616", mono = false, glyph, stroke } = {}) =>
  row(
    { h: 24, pad: [0, 9], gap: 6, radius: "pill", fill: tone, stroke },
    glyph ? icon(glyph, { size: 12, color }) : null,
    text(value, { size: 11, color, face: mono ? "mono" : undefined }),
  );

// Primary is light ink on dark, so gold stays free for what waits on the person.
function button(value, { kind = "secondary", glyph, h = 32, ref } = {}) {
  const look = {
    primary: { fill: INK, ink: "#000000" },
    secondary: { fill: "#1c1c1c", ink: INK, stroke: "#2e2e2e" },
    quiet: { ink: MUTE },
    gold: { fill: GOLD, ink: "#000000" },
  }[kind];
  return row(
    { h, pad: [0, 12], gap: 7, radius: 9, fill: look.fill, stroke: look.stroke, justify: "center", name: ref, label: value },
    glyph ? icon(glyph, { size: 14, color: look.ink }) : null,
    text(value, { size: 12, weight: 700, color: look.ink }),
  );
}

const iconBtn = (glyph, { name, label: title, active = false, size = 32 } = {}) =>
  stack({ w: size, h: size, radius: 8, fill: active ? "#1c1c1c" : undefined, name, label: title }, icon(glyph, { size: 16, color: active ? INK : MUTE, place: "center" }));

const avatar = (model, size = 34) =>
  stack(
    { w: size, h: size, radius: "pill", fill: MODEL[model].wash, stroke: MODEL[model].hue, strokeWidth: 1.5 },
    text(MODEL[model].initial, { size: Math.round(size * 0.42), weight: 700, color: MODEL[model].hue, place: "center" }),
  );

const kbd = (value) => row({ h: 20, pad: [0, 6], radius: 5, fill: "#1c1c1c" }, text(value, { size: 10, color: MUTE }));

const toggle = (on) =>
  stack({ w: 30, h: 18, radius: "pill", fill: on ? INK : "#2a2a2a" }, box({ w: 14, h: 14, radius: "pill", fill: on ? "#000000" : MUTE, place: { x: on ? 14 : 2, y: 2 } }));

// A dot grid in one vector: dashed lines whose dashes are the dots.
function grid(w, h, step = 24) {
  const lines = [];
  for (let y = step / 2; y < h; y += step) lines.push(`M 0 ${((y / h) * 100).toFixed(3)} H 100`);
  return vector({ w, h, place: { x: 0, y: 0 }, d: lines.join(" "), stroke: "#1c1c1c", strokeWidth: 2, dash: `0.01 ${step}` });
}

// A curved connector drawn between two canvas points, leaving and arriving vertically.
function curve(x1, y1, x2, y2, { tone = EDGE, width = 1.5, dash } = {}) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.max(Math.abs(x2 - x1), 2);
  const h = Math.max(Math.abs(y2 - y1), 2);
  const upperX = y1 <= y2 ? x1 : x2;
  const sx = upperX === x ? 0 : 100;
  const ex = 100 - sx;
  const d = Math.abs(x2 - x1) < 2 ? "M 50 0 V 100" : `M ${sx} 0 C ${sx} 55, ${ex} 45, ${ex} 100`;
  return vector({ w, h, place: { x, y }, d, stroke: tone, strokeWidth: width, dash });
}

// Work in flight: a lit arrow from (x1, y1) to (x2, y2) carrying its task.
function flow(x1, y1, x2, y2, tag, { tone = LIT } = {}) {
  const down = y2 > y1;
  const head = down
    ? vector({ w: 10, h: 8, place: { x: x2 - 5, y: y2 - 8 }, d: "M 0 0 L 100 0 L 50 100 Z", fill: tone })
    : vector({ w: 10, h: 8, place: { x: x2 - 5, y: y2 }, d: "M 0 100 L 100 100 L 50 0 Z", fill: tone });
  const mx = Math.round((x1 + x2) / 2);
  const my = Math.round((y1 + y2) / 2);
  return [
    curve(x1, y1, x2, down ? y2 - 7 : y2 + 7, { tone, width: 1.75 }),
    head,
    row({ h: 20, pad: [0, 7], gap: 4, radius: "pill", fill: "#0d0d0d", stroke: tone, place: { x: mx - 26, y: my - 10 } }, icon(down ? "arrowDown" : "arrowUp", { size: 10, color: tone }), text(tag, { size: 10, weight: 700, color: tone })),
  ];
}

// ---- chat node --------------------------------------------------------------------

const SIZE = { lead: [216, 92], builder: [176, 84] };

function node(x, y, { id, title, kind = "builder", tag = kind === "lead" ? "lead" : "", model, state, status, selected = false, ref }) {
  const [w, h] = SIZE[kind];
  const s = STATE[state];
  const waiting = state === "waiting";
  const faded = state === "out";
  const alert = ["lost", "unreachable", "quota", "unknown"].includes(state);
  return stack(
    { w: w + 12, h: h + 12, place: { x: x - 6, y: y - 6 }, name: ref ?? `node-${id}`, label: title },
    waiting || selected ? box({ w: w + 12, h: h + 12, radius: 18, stroke: waiting ? GOLD : INK, strokeWidth: 2, place: { x: 0, y: 0 } }) : null,
    col(
      {
        w, h, pad: [11, 12], gap: 7, radius: 13, place: { x: 6, y: 6 },
        fill: faded ? "#0a0a0a" : "#111111", stroke: alert ? s.color : "#2c2c2c",
        opacity: faded ? 0.75 : undefined,
      },
      row(
        { gap: 9 },
        avatar(model, kind === "lead" ? 32 : 28),
        col(
          { grow: 1, gap: 2 },
          text(title, { size: kind === "lead" ? 13 : 12, weight: 700, color: INK }),
          text(tag ? `${id} · ${tag}` : id, { size: 10, color: MUTE, face: "mono" }),
        ),
      ),
      row({ gap: 7 }, dot(s.color, 7), text(status ?? s.label, { size: 11, color: waiting ? GOLD : alert ? s.color : SOFT })),
    ),
    waiting ? row({ h: 20, pad: [0, 8], radius: "pill", fill: GOLD, place: { x: w - 92, y: -4 } }, text("Waiting on you", { size: 10, weight: 700, color: "#000000" })) : null,
  );
}

const roll = (n, what, color) => row({ gap: 5 }, dot(color, 6), text(`${n} ${what}`, { size: 11, color: color === GOLD ? GOLD : SOFT }));

function squadBox(x, y, w, h, title, rollup, { ref } = {}) {
  return col(
    { w, h, place: { x, y }, radius: 20, fill: "#0a0a0a", stroke: "#5f5c55", pad: [12, 16], name: ref, label: title },
    row(
      { gap: 8 },
      icon("chevronDown", { size: 14, color: MUTE }),
      text(title, { size: 13, weight: 700, color: INK }),
      text("squad", { size: 11, color: MUTE }),
      fill(),
      row({ gap: 12 }, ...rollup),
    ),
  );
}

// A folded squad: one pill with its people and what they are doing.
function squadPill(x, y, w, title, models, rollup, { waiting = false, ref, solo = false } = {}) {
  return stack(
    { w: w + 12, h: 76, place: { x: x - 6, y: y - 6 }, name: ref, label: title },
    waiting ? box({ w: w + 12, h: 76, radius: 22, stroke: GOLD, strokeWidth: 2, place: { x: 0, y: 0 } }) : null,
    col(
      { w, h: 64, pad: [10, 14], gap: 6, radius: 17, fill: "#0e0e0e", stroke: "#5f5c55", place: { x: 6, y: 6 } },
      row({ gap: 8 }, icon("chevronRight", { size: 13, color: MUTE }), text(title, { size: 13, weight: 700, color: INK }), text(solo ? "solo" : "squad", { size: 11, color: MUTE }), fill(), row({ gap: 3 }, ...models.map((m) => avatar(m, 18)))),
      row({ gap: 10 }, ...rollup),
    ),
  );
}

const youNode = (x, y) =>
  row(
    { h: 36, pad: [0, 14], gap: 8, radius: "pill", place: { x, y }, fill: "#151515", stroke: "#4a4a4a", name: "node-you", label: "You" },
    icon("circleUser", { size: 16, color: INK }),
    text("You", { size: 13, weight: 700, color: INK }),
  );

// ---- the sample swarm, fitted to the canvas -------------------------------------------

const field = (title, value, { h = 34, mono = false, hint } = {}) =>
  col(
    { gap: 5 },
    label(title, { size: 10, weight: 700, track: 0.06 }),
    col({ h, pad: [0, 10], radius: 8, fill: "#151515", stroke: "#2e2e2e", justify: "center" }, text(value, { size: 12, lh: 1.45, color: INK, face: mono ? "mono" : undefined })),
    hint ? label(hint, { size: 10 }) : null,
  );

const pick = (options, active) =>
  row({ gap: 4 }, ...options.map((option) => row({ h: 26, pad: [0, 10], gap: 6, radius: "pill", fill: option === active ? INK : "#1a1a1a" }, text(option, { size: 11, weight: option === active ? 700 : 400, color: option === active ? "#000000" : SOFT }))));

// A chat made in one step, like a custom agent: a name, what it always does, and its model.
function newAgentCard(x, y) {
  return col(
    { w: 356, pad: [16, 16], gap: 12, radius: 16, fill: "#0f0f0f", stroke: "#3a3a3a", place: { x, y }, shadow: true, name: "new-agent", label: "New chat" },
    row({ gap: 8 }, text("New chat in myapp", { size: 14, weight: 700, color: INK, grow: 1 }), row({ gap: 6 }, label("reports to"), avatar("strong", 16), text("overlord-myapp", { size: 11, color: INK, face: "mono" }))),
    field("NAME", "Archiver"),
    field("WHAT IT DOES", "Reads every delivered task, checks its tests and archives the logs of finished work.", { h: 54 }),
    col({ gap: 6 }, label("JOB", { size: 10, weight: 700, track: 0.06 }), pick(["Builder", "Reader", "Reviewer", "Custom"], "Reader")),
    col({ gap: 6 }, label("MODEL", { size: 10, weight: 700, track: 0.06 }), row({ gap: 10 }, pick(["strong", "mid", "light"], "light"), text("effort low", { size: 11, color: MUTE }))),
    row({ gap: 8 }, box({ w: 16, h: 16, radius: 4, fill: INK }), text("Save as an agent to reuse", { size: 12, color: INK, grow: 1 })),
    row({ gap: 8 }, kbd("Enter"), label("starts it", { grow: 1 }), button("Cancel", { kind: "quiet", h: 30 }), button("Start chat", { kind: "primary", h: 30, ref: "start-chat" })),
  );
}

/** The home graph: `sel` names the selected chat; `ghost` adds a new chat being made. */
function swarm(cw, ch, { sel = "", ghost = false, states = false } = {}) {
  const cx = Math.round(cw / 2) - 108;
  const squadH = ghost ? 430 : 330;
  const b = (x, y, props) => node(x, y, { ...props, selected: sel === props.id });
  return [
    grid(cw, ch),
    // structure: the person, the manager and one quiet trunk to each squad
    youNode(cx + 74, 24),
    curve(cx + 108, 60, cx + 108, 92, { tone: EDGE }),
    curve(cx + 108, 184, 310, 232, { tone: EDGE }),
    curve(cx + 108, 184, 714, 264, { tone: EDGE }),
    b(cx, 92, { id: "manager", title: "Manager", kind: "lead", tag: "", model: "strong", state: states ? "working" : "waiting", status: states ? "Ordering the release" : "Asks: which ships first?" }),
    // the myapp squad, open
    squadBox(20, 232, 580, squadH, "myapp", states ? [roll(4, "need attention", AMBER)] : [roll(2, "working", GREEN), roll(1, "waiting", GOLD), roll(1, "idle", GREY)], { ref: "squad-myapp" }),
    b(202, 280, { id: "overlord-myapp", title: "Plans and reviews", kind: "lead", model: "strong", state: states ? "lost" : "waiting", status: states ? "Stopped answering 12 min ago" : "Approved 014 for you" }),
    ...(states ? [] : [...flow(282, 372, 126, 452, "015"), ...flow(338, 452, 330, 372, "014")]),
    b(38, 452, { id: "executor-myapp", title: "Offline drafts", model: "mid", state: states ? "unreachable" : "working", status: states ? "Offline · seen 14 min ago" : "Building 015 · 4 min" }),
    b(232, 452, { id: "executor-myapp-2", title: "Password reset", model: "mid", state: states ? "quota" : "working", status: states ? "Resets at 18:00" : "Reported 014 to its lead" }),
    b(426, 452, { id: "executor-myapp-3", title: "Markdown export", model: "tool", state: states ? "unknown" : "idle", status: states ? "State file unreadable" : "Idle since 10:40" }),
    ghost
      ? col(
          { w: 176, h: 84, pad: [10, 12], gap: 7, radius: 13, fill: "#111111", stroke: INK, dash: "4 4", place: { x: 38, y: 552 }, name: "ghost", label: "New chat" },
          row({ gap: 9 }, avatar("light", 28), col({ grow: 1, gap: 2 }, text("Archiver", { size: 12, weight: 700, color: INK }), text("reader · new", { size: 10, color: MUTE, face: "mono" }))),
          row({ gap: 7 }, dot(MUTE, 7), text("Starting…", { size: 11, color: SOFT })),
        )
      : null,
    // folded squads
    squadPill(620, 270, 188, "shop", ["strong", "mid"], [roll(1, "waiting", GOLD), roll(1, "out", OUT)], { waiting: true, ref: "squad-shop" }),
    squadPill(620, 382, 188, "mygame", ["light"], [roll(1, "out", OUT)], { ref: "squad-mygame", solo: true }),
  ];
}

// ---- frame -------------------------------------------------------------------------

function topBar({ crumb = ["Mind"], waiting = 3, trayOpen = false, left = true, right = true } = {}) {
  return row(
    { h: TOP, pad: [0, 14], gap: 10, fill: "#0b0b0b", name: "top-bar", label: "Top bar" },
    iconBtn("panelLeft", { name: "toggle-left", label: "Hide the menu", active: left }),
    space(4),
    ...crumb.flatMap((part, i) => [i ? icon("chevronRight", { size: 12, color: MUTE }) : null, text(part, { size: 13, weight: i === crumb.length - 1 ? 700 : 400, color: i === crumb.length - 1 ? INK : MUTE })]),
    fill(),
    waiting
      ? row(
          { h: 32, pad: [0, 12], gap: 8, radius: "pill", fill: trayOpen ? GOLD : GOLD_WASH, stroke: GOLD, name: "waiting-pill", label: "Waiting on you" },
          icon("hand", { size: 14, color: trayOpen ? "#000000" : GOLD }),
          text(`${waiting} waiting on you`, { size: 12, weight: 700, color: trayOpen ? "#000000" : GOLD }),
        )
      : row({ h: 32, pad: [0, 12], gap: 8, radius: "pill", stroke: "#2a2a2a" }, icon("circleCheck", { size: 14, color: MUTE }), text("Nothing waiting", { size: 12, color: MUTE })),
    row(
      { h: 32, radius: 9, fill: INK, name: "new", label: "New" },
      row({ h: 32, pad: [0, 10, 0, 12], gap: 7 }, icon("plus", { size: 14, color: "#000000" }), text("New chat", { size: 12, weight: 700, color: "#000000" })),
      box({ w: 1, h: 18, fill: "#9a978f" }),
      stack({ w: 28, h: 32 }, icon("chevronDown", { size: 13, color: "#000000", place: "center" })),
    ),
    iconBtn("panelRight", { name: "toggle-right", label: "Hide the inspector", active: right }),
  );
}

function leftMenu({ active = "swarm", empty = false, waiting = 3, states = false } = {}) {
  const item = (id, glyph, title, n, gold = false) =>
    row(
      { h: 34, pad: [0, 10], gap: 10, radius: 9, fill: id === active ? "#1c1c1c" : undefined, name: `nav-${id}`, label: title },
      icon(glyph, { size: 16, color: id === active ? INK : MUTE }),
      text(title, { size: 13, weight: id === active ? 700 : 400, color: INK, grow: 1 }),
      n ? text(String(n), { size: 11, weight: 700, color: gold ? GOLD : MUTE }) : null,
    );
  const squadRow = (title, model, rollup) =>
    row({ h: 42, pad: [0, 10], gap: 9, radius: 9 }, avatar(model, 20), col({ grow: 1, gap: 3 }, text(title, { size: 12, weight: 700, color: INK }), rollup));
  return col(
    { w: LEFT, pad: [14, 12], gap: 3, fill: "#0b0b0b", name: "left-menu", label: "Menu" },
    row({ h: 30, pad: [0, 6], gap: 8 }, icon("network", { size: 16, color: INK }), text("HIVEM1ND", { size: 14, weight: 700, color: INK, track: 0.04 })),
    space(8),
    row({ h: 34, pad: [0, 10], gap: 8, radius: 9, fill: "#141414", stroke: "#262626", name: "search", label: "Search" }, icon("search", { size: 14, color: MUTE }), text("Search or jump", { size: 12, color: MUTE, grow: 1 }), kbd("Ctrl K")),
    space(8),
    item("swarm", "network", "Swarm"),
    item("waiting", "hand", "Waiting on you", empty ? 0 : waiting, true),
    space(14),
    empty ? null : label("SQUADS", { size: 10, weight: 700, track: 0.1 }),
    empty ? null : space(4),
    empty ? null : squadRow("myapp", "strong", states ? row({ gap: 8 }, roll(4, "need attention", AMBER)) : row({ gap: 8 }, roll(2, "working", GREEN), roll(1, "waiting", GOLD))),
    empty ? null : squadRow("shop", "strong", row({ gap: 8 }, roll(1, "waiting", GOLD), roll(1, "out", OUT))),
    empty ? null : squadRow("mygame", "light", row({ gap: 8 }, text("solo", { size: 11, color: MUTE }), roll(1, "out", OUT))),
    fill(),
    row({ h: 36, pad: [0, 8], gap: 8, radius: 9, name: "mind-strip", label: "Mind" }, dot(GREEN, 7), col({ gap: 1, grow: 1 }, text("Up to date · read 12 s ago", { size: 11, color: INK }), text("2.0.0 · LAPTOP, DESKTOP", { size: 10, color: MUTE }))),
  );
}

// ---- inspector ---------------------------------------------------------------------

const bubble = (who, body, { mine = false, model = "mid", time, extra } = {}) =>
  col(
    { gap: 5, align: mine ? "end" : "start" },
    row({ gap: 6 }, mine ? null : avatar(model, 18), text(who, { size: 11, weight: 700, color: INK }), time ? text(time, { size: 10, color: MUTE }) : null),
    col({ w: 300, pad: [9, 12], gap: 10, radius: 12, fill: mine ? "#1f1f1f" : "#131313", stroke: mine ? undefined : "#222222" }, text(body, { size: 12, lh: 1.5, color: INK }), extra ?? null),
  );

function inspectorHead({ id, title, model, role, where, state, reports }) {
  return col(
    { pad: [16, 18, 12], gap: 10 },
    row(
      { gap: 11 },
      avatar(model, 40),
      col({ grow: 1, gap: 3 }, text(title, { size: 15, weight: 700, color: INK }), text(`${id} · ${role} · ${MODEL[model].name} · ${where}`, { size: 11, color: MUTE })),
      iconBtn("ellipsis", { name: "node-menu", label: "More" }),
    ),
    row({ gap: 6 }, chip(STATE[state].label, { color: STATE[state].color, glyph: "circle" }), chip("Wakes when messaged", { glyph: "bell" })),
    reports ? row({ h: 30, pad: [0, 10], gap: 8, radius: 9, fill: "#141414" }, icon("arrowUp", { size: 13, color: MUTE }), text("Reports to", { size: 11, color: MUTE }), avatar("strong", 16), text(reports, { size: 11, weight: 700, color: INK, face: "mono" })) : null,
  );
}

const tabsRow = (active, names) =>
  row(
    { h: 38, pad: [0, 18], gap: 20, name: "inspector-tabs", label: "Tabs" },
    ...names.map((title) =>
      col(
        { h: 38, gap: 0, name: `tab-${title.toLowerCase()}`, label: title },
        fill(),
        text(title, { size: 12, weight: title === active ? 700 : 400, color: title === active ? INK : MUTE }),
        fill(),
        box({ h: 2, w: title.length * 7, fill: title === active ? INK : undefined }),
      ),
    ),
  );

const composer = (to, { copyLead } = {}) =>
  col(
    { pad: [10, 14, 14], gap: 8 },
    copyLead ? row({ gap: 8, pad: [0, 4] }, toggle(true), text(`Copy ${copyLead}`, { size: 11, color: INK }), text("so the plan stays one", { size: 11, color: MUTE })) : null,
    row(
      { h: 44, pad: [0, 8, 0, 14], gap: 8, radius: 12, fill: "#141414", stroke: "#2c2c2c", name: "composer", label: "Message" },
      text(`Message ${to}`, { size: 12, color: MUTE, grow: 1 }),
      stack({ w: 30, h: 30, radius: "pill", fill: INK }, icon("arrowUp", { size: 15, color: "#000000", place: "center" })),
    ),
  );

function managerInspector() {
  return col(
    { w: RIGHT, fill: "#0b0b0b", name: "inspector", label: "Inspector" },
    inspectorHead({ id: "manager", title: "Manager", model: "strong", role: "coordinates the mind", where: "LAPTOP", state: "waiting" }),
    tabsRow("Chat", ["Chat", "Tasks", "State"]),
    box({ h: 1, fill: "#1c1c1c" }),
    col(
      { grow: 1, pad: [14, 18], gap: 14 },
      bubble("manager", "overlord-myapp approved 014 and overlord-shop approved 007; both are in your tray.", { model: "strong", time: "10:58" }),
      bubble("manager", "Shop 007 and the mygame demo both want Friday. Which ships first?", {
        model: "strong",
        time: "11:04",
        extra: row({ gap: 6 }, button("shop first", { kind: "gold", h: 28 }), button("mygame first", { h: 28 })),
      }),
    ),
    composer("manager"),
  );
}

function builderInspector() {
  return col(
    { w: RIGHT, fill: "#0b0b0b", name: "inspector", label: "Inspector" },
    inspectorHead({ id: "executor-myapp", title: "Offline drafts", model: "mid", role: "builder", where: "LAPTOP", state: "working", reports: "overlord-myapp" }),
    tabsRow("Chat", ["Chat", "Tasks", "State"]),
    box({ h: 1, fill: "#1c1c1c" }),
    col(
      { grow: 1, pad: [14, 18], gap: 14 },
      bubble("overlord-myapp", "Take 015: drafts survive a lost connection. The plan is in the task.", { model: "strong", time: "10:52" }),
      bubble("executor-myapp", "On it, on feat/015-drafts. Tests first, then the store hook.", { time: "10:53" }),
      bubble("You", "Keep a draft for 7 days, not 30.", { mine: true, time: "11:02" }),
      bubble("executor-myapp", "Done in the plan; overlord-myapp got the same note.", { time: "11:02" }),
      row({ h: 30, pad: [0, 10], gap: 8, radius: 9, fill: "#141414" }, icon("activity", { size: 13, color: MUTE }), text("Last state 2 min ago: store hook, 3 of 7 tests", { size: 11, color: MUTE })),
    ),
    composer("executor-myapp", { copyLead: "overlord-myapp" }),
  );
}

// ---- canvas chrome -------------------------------------------------------------------

const FILTERS = [["Waiting", 3, GOLD], ["Working", 2, GREEN], ["Idle", 1, GREY], ["Out", 2, OUT]];

function canvasChrome(cw, ch, { zoom = "Fit", filters = true, counts = FILTERS } = {}) {
  return [
    row(
      { h: 36, pad: [0, 6], gap: 2, radius: 10, fill: "#0e0e0e", stroke: "#262626", place: { x: 16, y: ch - 52 }, name: "zoom", label: "Zoom" },
      iconBtn("minus", { size: 28 }),
      text(zoom, { size: 11, color: MUTE, w: 44, align: "center" }),
      iconBtn("plus", { size: 28 }),
      box({ w: 1, h: 18, fill: "#2a2a2a" }),
      iconBtn("maximize", { size: 28, name: "fit", label: "Fit" }),
    ),
    filters
      ? row(
          { h: 36, pad: [0, 6], gap: 4, radius: 10, fill: "#0e0e0e", stroke: "#222222", place: { x: 176, y: ch - 52 }, name: "filters", label: "Filters" },
          chip("All 8", { tone: "#1f1f1f", color: INK }),
          ...counts.map(([name, n, color]) => chip(`${name} ${n}`, { color, glyph: "circle", tone: "#0e0e0e" })),
        )
      : null,
  ];
}

function shell({ top = {}, leftOn = true, inspector, canvas, overlay, menu = {} }) {
  const ch = H - TOP - 1;
  const cw = W - (leftOn ? LEFT + 1 : 0) - (inspector ? RIGHT + 1 : 0);
  return stack(
    { w: W, h: H, fill: "canvas", clip: true },
    col(
      { w: W, h: H, place: { x: 0, y: 0 } },
      topBar({ ...top, left: leftOn, right: Boolean(inspector) }),
      box({ h: 1, fill: "#1c1c1c" }),
      row(
        { h: ch, align: "stretch" },
        leftOn ? leftMenu({ waiting: top.waiting ?? 3, ...menu }) : null,
        leftOn ? box({ w: 1, fill: "#1c1c1c" }) : null,
        stack({ w: cw, h: ch, fill: "#030303", clip: true, name: "canvas", label: "Canvas" }, ...canvas(cw, ch)),
        inspector ? box({ w: 1, fill: "#1c1c1c" }) : null,
        inspector ?? null,
      ),
    ),
    overlay ?? null,
  );
}

// ---- 1. Swarm --------------------------------------------------------------------------

const home = () =>
  shell({
    inspector: managerInspector(),
    canvas: (cw, ch) => [...swarm(cw, ch, { sel: "manager" }), ...canvasChrome(cw, ch)],
  });

// ---- 2. A builder, with its lead in the loop ---------------------------------------------

const builder = () =>
  shell({
    top: { crumb: ["Mind", "myapp"] },
    inspector: builderInspector(),
    canvas: (cw, ch) => [...swarm(cw, ch, { sel: "executor-myapp" }), ...canvasChrome(cw, ch)],
  });

// ---- 3. Waiting on you tray --------------------------------------------------------------

const target = (model, id) => row({ gap: 6 }, avatar(model, 18), text(id, { size: 11, color: INK, face: "mono" }));

const trayItem = ({ glyph, title, from, report, actions, ref, first = false }) =>
  col(
    { pad: [12, 14], gap: 9, radius: 12, fill: first ? "#16130c" : "#121212", stroke: first ? "#4a3d22" : "#222222", name: ref, label: title },
    row({ gap: 9 }, icon(glyph, { size: 15, color: GOLD }), text(title, { size: 13, weight: 700, color: INK, grow: 1 }), iconBtn("target", { size: 24, name: `${ref}-locate`, label: "Show on the graph" })),
    from,
    report ? text(report, { size: 11, lh: 1.5, color: SOFT }) : null,
    row({ gap: 8 }, ...actions),
  );

const tray = () =>
  shell({
    top: { trayOpen: true },
    inspector: managerInspector(),
    canvas: (cw, ch) => [...swarm(cw, ch, { sel: "manager" }), ...canvasChrome(cw, ch)],
    overlay: stack(
      { w: W, h: H, place: { x: 0, y: 0 } },
      col(
        { w: 430, pad: [16, 16], gap: 10, radius: 16, fill: "#0d0d0d", stroke: "#333333", place: { x: W - 430 - 196, y: TOP + 8 }, shadow: true, name: "tray", label: "Waiting on you" },
        row({ gap: 8 }, text("Waiting on you", { size: 15, weight: 700, color: INK, grow: 1 }), text("blocking first", { size: 11, color: MUTE })),
        trayItem({
          glyph: "messageCircle", title: "Which ships first: shop or the mygame demo?", ref: "tray-question", first: true,
          from: row({ gap: 6 }, label("asked by"), target("strong", "manager"), label("· 10 min")),
          actions: [button("shop first", { kind: "gold", h: 28 }), button("mygame first", { h: 28 }), button("Open chat", { kind: "quiet", h: 28 })],
        }),
        trayItem({
          glyph: "checkCheck", title: "Review: password reset by mail", ref: "tray-review-014",
          from: row({ gap: 6 }, label("approved by"), target("strong", "overlord-myapp"), label("· built by executor-myapp-2")),
          report: "212 tests pass. The reset link expires on first use. 6 files changed.",
          actions: [button("Accept", { kind: "primary", glyph: "check", h: 28 }), button("Send back", { glyph: "cornerDownLeft", h: 28, ref: "tray-send-back" }), button("Diff", { kind: "quiet", h: 28 })],
        }),
        trayItem({
          glyph: "checkCheck", title: "Review: checkout with saved cards", ref: "tray-review-007",
          from: row({ gap: 6 }, label("approved by"), target("strong", "overlord-shop"), label("· built by executor-shop")),
          report: "98 tests pass. Cards are stored by the payment provider only.",
          actions: [button("Accept", { kind: "primary", glyph: "check", h: 28 }), button("Send back", { glyph: "cornerDownLeft", h: 28 }), button("Diff", { kind: "quiet", h: 28 })],
        }),
        row({ h: 30, pad: [0, 4], gap: 8 }, kbd("W"), text("jumps to the next one on the graph", { size: 11, color: MUTE, grow: 1 })),
        row({ h: 30, pad: [0, 4], gap: 8 }, icon("circleHelp", { size: 14, color: MUTE }), text("11 open questions stay in product documents until a seat asks.", { size: 11, color: MUTE, grow: 1 })),
      ),
      row(
        { h: 44, pad: [0, 8, 0, 16], gap: 12, radius: 12, fill: "#1c1c1c", stroke: "#333333", place: { x: 509, y: H - 76 }, shadow: true, name: "toast", label: "Undo" },
        icon("circleCheck", { size: 16, color: GREEN }),
        text("Accepted shop 006 · merged by overlord-shop", { size: 12, color: INK }),
        button("Undo", { h: 30 }),
      ),
    ),
  });

// ---- 4. Send back, through the lead ---------------------------------------------------------

function sendBackInspector() {
  return col(
    { w: RIGHT, fill: "#0b0b0b", name: "inspector", label: "Inspector" },
    row({ h: 52, pad: [0, 14], gap: 8 }, iconBtn("arrowLeft", { size: 28 }), text("myapp 014", { size: 12, face: "mono", color: MUTE }), chip("review", { color: GOLD, stroke: "#4a3d22" }), fill()),
    col(
      { grow: 1, pad: [4, 18], gap: 12 },
      text("Password reset by mail", { size: 17, weight: 700, color: INK }),
      row({ gap: 6 }, label("approved by"), target("strong", "overlord-myapp")),
      col(
        { pad: [10, 12], gap: 6, radius: 10, fill: "#131313", stroke: "#222222" },
        label("APP-B-04 IS MET WHEN", { size: 10, weight: 700, track: 0.08 }),
        text("A reset request sends one mail, its link opens the form once, and the new password logs in.", { size: 12, lh: 1.5, color: INK }),
      ),
      row({ gap: 6 }, chip("212 tests pass", { color: GREEN, glyph: "circleCheck" }), chip("6 files", { glyph: "fileCode" }), chip("feat/014-reset", { mono: true })),
      text("What is missing", { size: 12, weight: 700, color: INK }),
      col({ h: 96, pad: [10, 12], radius: 10, fill: "#141414", stroke: INK }, text("A forwarded mail opens the form twice. Expire the link on first use.", { size: 12, lh: 1.5, color: INK })),
      row({ gap: 8, align: "start" }, icon("cornerDownRight", { size: 13, color: MUTE }), text("Goes to overlord-myapp, who hands it back to its builder. The task returns to open.", { size: 11, lh: 1.5, color: MUTE, grow: 1 })),
    ),
    row({ pad: [10, 14, 14], gap: 8 }, button("Back", { kind: "quiet" }), fill(), button("Accept instead", { glyph: "check" }), button("Send back", { kind: "primary", glyph: "cornerDownLeft", ref: "confirm-back" })),
  );
}

const sendBack = () =>
  shell({
    inspector: sendBackInspector(),
    canvas: (cw, ch) => [...swarm(cw, ch, { sel: "overlord-myapp" }), ...canvasChrome(cw, ch)],
  });

// ---- 5. Right-click -------------------------------------------------------------------------------

const menuItem = (glyph, title, { hint, active = false, ref, tone = INK } = {}) =>
  row(
    { h: 32, pad: [0, 10], gap: 10, radius: 7, fill: active ? "#202020" : undefined, name: ref, label: title },
    icon(glyph, { size: 14, color: tone === INK ? MUTE : tone }),
    text(title, { size: 12, color: tone, grow: 1 }),
    hint ? text(hint, { size: 10, color: MUTE }) : null,
  );

const menuBox = (x, y, w, items, { ref, title } = {}) =>
  col({ w, pad: 6, gap: 1, radius: 12, fill: "#121212", stroke: "#333333", place: { x, y }, shadow: true, name: ref, label: title }, ...items);

const rightClick = () =>
  shell({
    inspector: managerInspector(),
    canvas: (cw, ch) => [
      ...swarm(cw, ch, { sel: "manager" }),
      ...canvasChrome(cw, ch),
      box({ w: 5, h: 5, radius: "pill", fill: INK, place: { x: 118, y: 562 } }),
      menuBox(124, 568, 250, [
        row({ h: 26, pad: [0, 10] }, label("Canvas · nearest squad: myapp")),
        menuItem("plus", "New chat here", { hint: "N", active: true, ref: "menu-new-builder" }),
        menuItem("bookmark", "From your agents: Archiver, Reviewer", { hint: "G" }),
        menuItem("link", "Attach an open chat", { hint: "A" }),
        box({ h: 1, fill: "#262626" }),
        menuItem("boxes", "Squad for a solo repository", { ref: "menu-new-squad" }),
        menuItem("maximize", "Fit to screen", { hint: "F" }),
      ], { ref: "context-menu", title: "Canvas menu" }),
      box({ w: 5, h: 5, radius: "pill", fill: INK, place: { x: 536, y: 506 } }),
      menuBox(542, 512, 236, [
        row({ h: 26, pad: [0, 10] }, label("Chat: executor-myapp-3")),
        menuItem("messageSquare", "Open chat", { hint: "Enter" }),
        menuItem("listPlus", "Give it a task", { hint: "T" }),
        menuItem("bell", "Wake now"),
        box({ h: 1, fill: "#262626" }),
        menuItem("circleStop", "Stop this chat", { tone: RED }),
      ], { ref: "node-menu", title: "Chat menu" }),
    ],
  });

// ---- 6. A new builder, named in place -------------------------------------------------------------

const ghost = () =>
  shell({
    top: { crumb: ["Mind", "myapp"] },
    inspector: managerInspector(),
    canvas: (cw, ch) => [...swarm(cw, ch, { ghost: true }), ...canvasChrome(cw, ch), newAgentCard(450, 214)],
  });

// ---- 7. A squad for a solo chat ---------------------------------------------------------------------

const memberRow = (role, model, effort, n, ref) =>
  row(
    { h: 52, pad: [0, 12], gap: 12, radius: 12, fill: "#131313", stroke: "#262626", name: ref, label: role },
    avatar(model, 30),
    col({ grow: 1, gap: 2 }, text(role, { size: 13, weight: 700, color: INK }), text(`${MODEL[model].name} · ${effort}`, { size: 11, color: MUTE })),
    n === undefined
      ? chip("1")
      : row({ gap: 4, radius: 9, fill: "#1c1c1c", pad: [3, 3] }, iconBtn("minus", { size: 26 }), text(String(n), { size: 13, weight: 700, color: INK, w: 22, align: "center" }), iconBtn("plus", { size: 26 })),
  );

const squadSheet = () =>
  shell({
    inspector: managerInspector(),
    canvas: (cw, ch) => [...swarm(cw, ch), ...canvasChrome(cw, ch)],
    overlay: stack(
      { w: W, h: H, place: { x: 0, y: 0 } },
      box({ w: W, h: H, fill: "rgba(0, 0, 0, 0.66)", place: { x: 0, y: 0 } }),
      row(
        { w: 820, h: 540, radius: 20, fill: "#0d0d0d", place: { x: 310, y: 180 }, clip: true, name: "squad-sheet", label: "Give mygame a squad" },
        col(
          { w: 470, h: 540, pad: [24, 26], gap: 14 },
          text("Give mygame a squad", { size: 20, weight: 700, color: INK }),
          text("Its builder stays; a lead plans and reviews, and new builders take its tasks.", { size: 12, lh: 1.5, color: MUTE }),
          memberRow("Lead", "strong", "max", undefined, "squad-lead"),
          memberRow("New members, any model", "mid", "high", 2, "squad-builders"),
          col(
            { gap: 6 },
            label("First goal, from mygame's open requirements"),
            row({ h: 38, pad: [0, 12], gap: 8, radius: 10, fill: "#141414", stroke: "#2c2c2c" }, text("GAM-A-03", { size: 11, face: "mono", color: MUTE }), text("Save slots on the title screen", { size: 12, color: INK, grow: 1 }), icon("chevronDown", { size: 14, color: MUTE })),
          ),
          row({ h: 40, pad: [0, 12], gap: 10, radius: 10, fill: "#141414" }, icon("gauge", { size: 14, color: MUTE }), text("Starts 3 sessions. A lead at max effort uses the most quota.", { size: 11, color: MUTE })),
          fill(),
          row({ gap: 8 }, text("Defaults from your model table", { size: 11, color: MUTE, grow: 1 }), button("Cancel", { kind: "quiet" }), button("Start squad", { kind: "primary", glyph: "boxes", ref: "create-squad" })),
        ),
        box({ w: 1, h: 540, fill: "#222222" }),
        stack(
          { w: 349, h: 540, fill: "#050505" },
          grid(349, 540, 20),
          label("PREVIEW", { size: 10, weight: 700, track: 0.1, place: { x: 20, y: 20 } }),
          curve(174, 156, 70, 250, { tone: EDGE }),
          curve(174, 156, 174, 250, { tone: EDGE }),
          curve(174, 156, 278, 250, { tone: EDGE }),
          stack({ w: 48, h: 48, place: { x: 150, y: 108 } }, avatar("strong", 48)),
          stack({ w: 40, h: 40, place: { x: 50, y: 250 } }, avatar("light", 40)),
          stack({ w: 40, h: 40, place: { x: 154, y: 250 } }, avatar("mid", 40)),
          stack({ w: 40, h: 40, place: { x: 258, y: 250 } }, avatar("mid", 40)),
          label("existing", { size: 10, place: { x: 46, y: 298 } }),
          label("new", { size: 10, place: { x: 164, y: 298 } }),
          label("new", { size: 10, place: { x: 268, y: 298 } }),
        ),
      ),
      box({ w: 820, h: 540, radius: 20, stroke: "#333333", place: { x: 310, y: 180 } }),
    ),
  });

// ---- 8. Focus: panels hidden, many squads -----------------------------------------------------------

const focus = () =>
  shell({
    leftOn: false,
    canvas: (cw, ch) => {
      const mid = Math.round(cw / 2);
      const pills = [
        ["myapp", ["strong", "mid", "mid", "tool"], [roll(2, "working", GREEN), roll(1, "waiting", GOLD)], true],
        ["shop", ["strong", "mid"], [roll(1, "waiting", GOLD), roll(1, "out", OUT)], true],
        ["site", ["strong", "mid", "mid"], [roll(3, "working", GREEN)], false],
        ["api", ["strong", "tool", "tool"], [roll(2, "idle", GREY), roll(1, "working", GREEN)], false],
        ["mobile", ["strong", "mid", "mid", "mid"], [roll(4, "working", GREEN)], false],
        ["docs", ["light"], [roll(1, "out", OUT)], false],
        ["mygame", ["light"], [roll(1, "out", OUT)], false],
      ];
      const across = 4;
      const pw = 236;
      const gap = 28;
      const left = mid - Math.round((across * pw + (across - 1) * gap) / 2);
      const px = (i) => left + (i % across) * (pw + gap);
      const py = (i) => 300 + Math.floor(i / across) * 116;
      return [
        grid(cw, ch),
        youNode(mid - 34, 40),
        curve(mid, 76, mid, 112, { tone: EDGE }),
        node(mid - 108, 112, { id: "manager", title: "Manager", kind: "lead", tag: "", model: "strong", state: "waiting", status: "Asks: which ships first?" }),
        ...pills.slice(0, across).map((_, i) => curve(mid, 204, px(i) + Math.round(pw / 2), py(i) - 6, { tone: EDGE })),
        ...pills.map(([title, models, rollup, waiting], i) => squadPill(px(i), py(i), pw, title, models, rollup, { waiting, solo: models.length === 1 })),
        row(
          { h: 32, pad: [0, 4], gap: 2, radius: 10, fill: "#0e0e0e", stroke: "#222222", place: { x: 16, y: 14 }, name: "view-switch", label: "Graph or list" },
          chip("Graph", { tone: "#1f1f1f", color: INK, glyph: "network" }),
          chip("List", { tone: "#0e0e0e", glyph: "list" }),
        ),
        text("21 chats in 7 squads. Zoomed out, squads fold into pills and keep their gold ring when they wait on you.", { size: 11, color: MUTE, place: { x: mid - 320, y: ch - 44 }, w: 640, align: "center" }),
        ...canvasChrome(cw, ch, { zoom: "48%", filters: false }),
      ];
    },
  });

// ---- 9. States that need attention ------------------------------------------------------------------

function lostInspector() {
  return col(
    { w: RIGHT, fill: "#0b0b0b", name: "inspector", label: "Inspector" },
    inspectorHead({ id: "overlord-myapp", title: "Plans and reviews", model: "strong", role: "lead", where: "LAPTOP", state: "lost" }),
    tabsRow("State", ["Chat", "Tasks", "State"]),
    box({ h: 1, fill: "#1c1c1c" }),
    col(
      { pad: [14, 18], gap: 12 },
      row(
        { pad: [12, 12], gap: 10, radius: 10, fill: "#1f160d", stroke: "#4a3420", align: "start" },
        icon("triangleAlert", { size: 15, color: AMBER }),
        col({ grow: 1, gap: 4 }, text("Stopped answering 12 minutes ago", { size: 12, weight: 700, color: INK }), text("Its session is registered but has taken no message since 10:58. Three builders report to it.", { size: 11, lh: 1.5, color: SOFT })),
      ),
      row({ gap: 8 }, button("Wake", { kind: "primary", glyph: "bell" }), button("Open in its tool", { glyph: "externalLink" }), button("Stop", { kind: "quiet" })),
      space(6),
      label("OTHER STATES ON THE GRAPH", { size: 10, weight: 700, track: 0.08 }),
      row({ gap: 8, align: "start" }, dot(AMBER, 7), text("Unreachable: its machine is offline; the node keeps when it was last seen.", { size: 11, lh: 1.5, color: SOFT, grow: 1 })),
      row({ gap: 8, align: "start" }, dot(AMBER, 7), text("Out of quota: shows when the plan resets; its messages wait.", { size: 11, lh: 1.5, color: SOFT, grow: 1 })),
      row({ gap: 8, align: "start" }, dot(RED, 7), text("Status unknown: its file could not be read; nothing on the node is guessed.", { size: 11, lh: 1.5, color: SOFT, grow: 1 })),
    ),
  );
}

const states = () =>
  shell({
    inspector: lostInspector(),
    top: { crumb: ["Mind", "myapp"], waiting: 1 },
    menu: { states: true },
    canvas: (cw, ch) => [
      ...swarm(cw, ch, { sel: "overlord-myapp", states: true }),
      ...canvasChrome(cw, ch, { counts: [["Attention", 4, AMBER], ["Waiting", 1, GOLD], ["Working", 1, GREEN], ["Out", 2, OUT]] }),
      row({ h: 32, pad: [0, 12], gap: 8, radius: 10, fill: "#1f1414", stroke: "#4a2a2a", place: { x: cw - 236, y: 14 }, name: "issues-pill", label: "Read issues" }, icon("triangleAlert", { size: 14, color: RED }), text("1 file could not be read", { size: 12, color: INK }), text("Show", { size: 12, weight: 700, color: RED })),
    ],
  });

// ---- 10. First run --------------------------------------------------------------------------------

const template = (title, body, models, ref, primary = false) =>
  col(
    { w: 220, pad: [16, 16], gap: 10, radius: 14, fill: "#111111", stroke: primary ? INK : "#2c2c2c", name: ref, label: title },
    row({ gap: 4 }, ...models.map((m) => avatar(m, 22))),
    text(title, { size: 14, weight: 700, color: INK }),
    text(body, { size: 11, lh: 1.5, color: MUTE }),
  );

const firstRun = () =>
  shell({
    top: { waiting: 0 },
    menu: { empty: true },
    canvas: (cw, ch) => [
      grid(cw, ch),
      col(
        { w: 720, gap: 18, align: "center", place: { x: Math.round(cw / 2) - 360, y: 220 }, name: "first-run", label: "Empty swarm" },
        text("Start your swarm", { size: 24, weight: 700, color: INK }),
        text("Every chat you open lives here, grouped by repository. Start with one, or with a squad.", { size: 13, color: MUTE }),
        space(6),
        row(
          { gap: 14 },
          template("One chat", "A builder in one repository. The simplest start.", ["mid"], "tpl-one", true),
          template("A squad", "A lead that plans and reviews, and builders that take its tasks.", ["strong", "mid", "mid", "mid"], "tpl-squad"),
          template("Attach a chat", "A chat already open in another tool, reached through Relay.", ["tool"], "tpl-attach"),
        ),
        space(6),
        text("Or right-click anywhere on the canvas.", { size: 11, color: MUTE }),
      ),
    ],
  });

export default board({
  id: "hivem1nd-view",
  title: "HIVEM1ND view: the swarm",
  note: "The mind as a graph of chats: the person at the top, the manager below, squads of a lead and its builders under it. Work goes down from a lead and comes back up through it, so what reaches the person has been reviewed once. Gold means waiting on the person and nothing else; every gold ring is one item of the tray. Zoom and pan, right-click to create, open any chat in the inspector.",
  screens: [
    { id: "home", title: "Swarm", col: 0, row: 0, root: home, note: "The home, fitted with both panels open. The manager's chat is in the inspector because it is the person's main conversation. Arrows show work in flight with its task: 015 going down to a builder, 014 coming back up to the lead. Other lines are quiet structure. Shop and mygame are folded into pills with their roll-up." },
    { id: "builder", title: "A builder, its lead in the loop", col: 1, row: 0, root: builder, note: "Selecting a builder: its chat, who it reports to, and a Copy-the-lead switch on by default so a message to a builder never splits the plan. The last state replaces asking for status." },
    { id: "tray", title: "Waiting on you", col: 2, row: 0, root: tray, note: "Blocking questions first, then reviews a lead already approved, each with its report line, tests and one action. The target button frames the node; W walks the gold rings. Accept is one click with an undo toast." },
    { id: "send-back", title: "Send back, through the lead", col: 3, row: 0, root: sendBack, note: "The review in the inspector: the criterion, tests, files and branch. What is missing goes to the lead, who hands it to its builder." },
    { id: "right-click", title: "Right-click", col: 0, row: 1, root: rightClick, note: "On the canvas: a new builder where the click was, attach a chat, a squad for a solo repository. On a chat: open, give it a task, wake, stop." },
    { id: "ghost", title: "A new chat in one step", col: 1, row: 1, root: ghost, note: "A chat made like a custom agent: its name, what it always does, its job and its model, any tier. It reports to the squad's lead. Saved as an agent, it comes back from the right-click menu and the New chat button. The node appears in place and starts with Enter." },
    { id: "squad", title: "Give a solo chat a squad", col: 2, row: 1, root: squadSheet, note: "A solo repository gains a lead and builders in one step; the first goal comes from its open requirements, and the cost in sessions is said before starting." },
    { id: "focus", title: "Focus and scale", col: 3, row: 1, root: focus, note: "Both panels hidden and zoomed out: squads fold into pills with their roll-up, the ones waiting on the person keep their gold ring. A list view shows the same hierarchy for the keyboard and the phone." },
    { id: "states", title: "States that need attention", col: 4, row: 0, root: states, note: "Lost, unreachable, out of quota and unknown each say what happened and what to do; nothing on a node is guessed." },
    { id: "first-run", title: "First run", col: 4, row: 1, root: firstRun, note: "An empty mind: no squads in the menu, nothing waiting, three ways to start." },
  ],
  links: [
    { from: "home", to: "builder", at: "node-executor-myapp", label: "Select a builder" },
    { from: "home", to: "tray", at: "waiting-pill", label: "Waiting on you" },
    { from: "tray", to: "send-back", at: "tray-send-back", label: "Send back" },
    { from: "home", to: "right-click", at: "canvas", label: "Right-click" },
    { from: "right-click", to: "ghost", at: "menu-new-builder", label: "New chat here" },
    { from: "right-click", to: "squad", at: "menu-new-squad", label: "Squad for a solo repository" },
    { from: "home", to: "focus", at: "toggle-left", label: "Hide panels, zoom out" },
    { from: "send-back", to: "states", label: "A chat stops answering" },
    { from: "focus", to: "first-run", label: "An empty mind" },
  ],
});
