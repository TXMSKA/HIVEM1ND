// The parts the HIVEM1ND GUI board is drawn with: the sample mind, the small pieces and the window frame.
// The look is the one of hivem1nd-view.mjs on the Void skin of this repository: black ground, warm grey
// ink, gold only for what waits on the person, and the model tiers as the hue of an avatar.
// The sample keeps the shapes of the mind: unit names, machines and clients are invented, statuses are
// the ones of hivem1nd-view-v1, times are local `HH:MM`. Values are examples, never measurements.

import { box, col, row, stack, text, icon, fill, vector } from "blueprint/kit.mjs";
import { dot } from "blueprint/ui.mjs";

export const W = 1440;
export const H = 900;
export const BAR = 48;
export const FOOT = 28;
export const LEFT = 248;
export const RIGHT = 360;

// Attention (quota, a machine out of reach) and the washes come from hivem1nd-view.mjs.
export const AMBER = "#d08a4a";
export const GOLD_WASH = "#241d0f";
export const AMBER_WASH = "#1f160d";
export const AMBER_EDGE = "#4a3420";
// The border of a field or a group, the lowest step of the grey that reaches 3:1 on the panel.
export const EDGE = "#65625a";

const TIER = {
  strong: { hue: "#b49cf5", wash: "#1d1730" },
  mid: { hue: "#82aaff", wash: "#141b2c" },
  light: { hue: "#9fd28a", wash: "#152015" },
  tool: { hue: "#6fd4c4", wash: "#11201e" },
  none: { hue: "mute", wash: "field" },
};

// The models of user/models.md and the tier each one draws as. `none` is a unit whose state writes no model.
export const MODELS = {
  opus: { name: "Opus 5.5", tier: "strong", initial: "O" },
  sonnet: { name: "Sonnet 5.5", tier: "mid", initial: "S" },
  haiku: { name: "Haiku 5.5", tier: "light", initial: "H" },
  gpt: { name: "GPT-6.1-Sol", tier: "tool", initial: "G" },
  grok: { name: "Grok 4.7", tier: "tool", initial: "G" },
  none: { name: "Model not recorded", tier: "none", initial: "?" },
};

export const CLIENTS = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", opencode: "OpenCode" };
// One glyph for every machine, at every scale: a machine is told apart by its name, never by its icon.
export const MACHINE_GLYPH = "monitor";

// Units of the sample, named the way a mind names its units. `lead` and `job` are state headers.
export const UNITS = {
  overseer: { machine: "DESKTOP", client: "claude", model: "opus", status: "idle", wake: true, scope: "root" },
  adjutant: { machine: "LAPTOP", client: "claude", model: "none", status: "working", wake: true, scope: "root" },
  incubator: { machine: "LAPTOP", client: "claude", model: "opus", status: "idle", wake: true, scope: "root" },
  "builder-cursor": { machine: "DESKTOP", client: "cursor", model: "grok", status: "idle", wake: true, scope: "root", job: "builder" },
  "overlord-api": { machine: "LAPTOP", client: "claude", model: "opus", status: "waiting", wake: true, scope: "api" },
  "builder-codex": { machine: "DESKTOP", client: "codex", model: "gpt", status: "working", wake: true, scope: "api", lead: "overlord-api", job: "builder" },
  "builder-codex-2": { machine: "LAPTOP", client: "codex", model: "gpt", status: "idle", wake: false, scope: "api", lead: "overlord-api", job: "builder" },
  "overlord-web": { machine: "DESKTOP", client: "claude", model: "opus", status: "waiting", wake: true, scope: "Web" },
  "executor-shop": { machine: "DESKTOP", client: "claude", model: "sonnet", status: "working", wake: true, scope: "Web", lead: "overlord-web", branch: "feat/029-ask" },
  "executor-blog": { machine: "DESKTOP", client: "claude", model: "none", status: "idle", wake: true, scope: "Web", lead: "overlord-web", branch: "master" },
  "executor-docs": { machine: "LAPTOP", client: "cursor", model: "grok", status: "idle", wake: true, scope: "docs" },
  "executor-mobile": { machine: "LAPTOP", client: "claude", model: "none", status: "idle", wake: true, scope: "mobile" },
  "executor-data": { machine: "DESKTOP", client: "claude", model: "none", status: "idle", wake: true, scope: "data" },
  "executor-site": { machine: "DESKTOP", client: "claude", model: "none", status: "idle", wake: false, scope: "site" },
};

// The roles of the kit in plain words. `one` marks a role the mind has once, however many machines it runs on.
export const ROLES = {
  overseer: { name: "Overseer", glyph: "crown", one: true, meaning: "Coordinates the whole mind. One for the whole mind, on any number of machines." },
  overlord: { name: "Overlord", glyph: "boxes", meaning: "Leads a group of Executors for an environment or a project." },
  executor: { name: "Executor", glyph: "squareTerminal", meaning: "Carries out tasks in one repository, one at a time. Any number." },
  adjutant: { name: "Adjutant", glyph: "userCheck", meaning: "Takes requests from the person and the Overseer and finishes them: documents, research, reports." },
  incubator: { name: "Incubator", glyph: "lightbulb", one: true, meaning: "Develops ideas into products in one folder." },
  genesis: { name: "Genesis", glyph: "settings2", one: true, meaning: "Installs the mind on a machine and keeps it up to date." },
};

/** The role of a unit from its name, the way the mind names its units. A unit that leads others is an Overlord. */
export const roleOf = (unit) =>
  unit === "overseer" ? "overseer" : unit.startsWith("adjutant") ? "adjutant" : unit === "incubator" ? "incubator" : unit.startsWith("overlord-") ? "overlord" : "executor";

/** The tile of a role: the one icon a unit has, the same in the map, the lists, the menus and the panels. */
export const roleTile = (role, size = 30) =>
  stack({ w: size, h: size, radius: Math.round(size / 4), fill: "field", stroke: "line" }, icon(ROLES[role].glyph, { size: Math.round(size * 0.5), color: role === "overseer" ? "title" : "soft", place: "center" }));

// The commands and features of the kit: [name, what it does, where it is written]. The first seven are commands.
export const COMMANDS = [
  ["relay", "Start or end a session and read the inbox", "/relay"],
  ["task", "Create a task for a unit", "/task"],
  ["msg", "Write a message to a unit", "/msg"],
  ["swarm", "List every unit, task and unread message", "/swarm"],
  ["evolve", "Update the kit and reinstall its commands", "/evolve"],
  ["absorb", "Store a correction as a preference", "/absorb"],
  ["protocol", "Run, create or list a protocol", "/protocol"],
  ["plan", "Split a request into tasks for the owning units", "/plan"],
  ["qa", "Run every open task and verify the results", "/qa"],
  ["report", "Investigate a defect and write a task for it", "/report"],
  ["brainstorm", "Develop a topic one decision at a time", "/brainstorm"],
  ["docs", "Update the documentation a change affects", "/docs"],
  ["tribunal", "Judge a change with three judges", "/tribunal"],
  ["corpo", "Stress-test delivered work", "/corpo"],
  ["catchup", "Summarize what changed since the last state", "/catchup"],
  ["release", "Prepare a local release", "/release"],
  ["observer", "Test a project under adverse conditions", "/observer"],
  ["conflicts", "Resolve merge conflicts", "/conflicts"],
  ["cleaner", "Measure and clean up the mind", "/cleaner"],
];

// ---- text and lines -----------------------------------------------------------------

export const label = (value, props = {}) => text(value, { size: 12, weight: 700, color: "mute", ...props });
export const copy = (value, props = {}) => text(value, { size: 12, lh: 1.5, color: "mute", ...props });
export const ident = (value, props = {}) => text(value, { size: 12, face: "mono", color: "name", ...props });
export const hair = (props = {}) => box({ h: 1, fill: "line", ...props });
export const vhair = (props = {}) => box({ w: 1, fill: "line", ...props });

// ---- controls ------------------------------------------------------------------------

// Primary is ink on black, so gold stays free for what waits on the person.
export function button(value, { kind = "secondary", glyph, h = 32, ref, grow, disabled = false } = {}) {
  const look = {
    primary: { fill: "text", ink: "canvas" },
    secondary: { fill: "on", ink: "text", stroke: "line" },
    quiet: { ink: "soft" },
    danger: { ink: "del" },
  }[kind];
  const tone = disabled ? "mute" : look.ink;
  return row(
    { h, grow, pad: [0, 12], gap: 7, radius: 9, fill: disabled ? "field" : look.fill, stroke: disabled ? "line" : look.stroke, justify: "center", name: ref, label: value },
    glyph ? icon(glyph, { size: 14, color: tone }) : null,
    text(value, { size: 12, weight: 700, color: tone }),
  );
}

export const iconBtn = (glyph, { name, label: title, active = false, size = 32, tone } = {}) =>
  stack({ w: size, h: size, radius: 8, fill: active ? "on" : undefined, name, label: title }, icon(glyph, { size: 16, color: tone ?? (active ? "title" : "soft"), place: "center" }));

export const check = (on) =>
  stack({ w: 16, h: 16, radius: 4, fill: on ? "text" : undefined, stroke: on ? undefined : "mute", strokeWidth: 1.5 }, on ? icon("check", { size: 12, color: "canvas", stroke: 3, place: "center" }) : null);

export const toggle = (on) =>
  stack({ w: 32, h: 18, radius: "pill", fill: on ? "text" : "on", stroke: on ? undefined : "mute" }, box({ w: 12, h: 12, radius: "pill", fill: on ? "canvas" : "mute", place: { x: on ? 17 : 3, y: 3 } }));

/** A labelled input row. `trail` is anything drawn at its end. */
export function field(title, value, { h = 34, mono = false, glyph, trail, hint, ref } = {}) {
  return col(
    { gap: 5 },
    label(title),
    row(
      { h, pad: [0, 10], gap: 8, radius: 8, fill: "field", stroke: EDGE, name: ref, label: title },
      glyph ? icon(glyph, { size: 14, color: "mute" }) : null,
      text(value, { size: 13, color: "text", face: mono ? "mono" : undefined, lines: 1, grow: 1 }),
      trail ?? null,
    ),
    hint ? copy(hint) : null,
  );
}

export const select = (title, value, props = {}) => field(title, value, { ...props, trail: icon("chevronDown", { size: 14, color: "soft" }) });

/** Two to five choices side by side, each as wide as its name unless `stretch`; `marks` may add a node before a name. */
export function choice(options, active, { ref, h = 32, marks = {}, stretch = false } = {}) {
  return row(
    { h, pad: 3, gap: 2, radius: 9, fill: "canvas", stroke: EDGE, name: ref, label: ref },
    ...options.map((option) => {
      const on = option === active;
      return row(
        { h: h - 6, grow: stretch ? 1 : undefined, pad: [0, 10], gap: 6, radius: 7, justify: "center", fill: on ? "on" : undefined, name: ref ? `${ref}-${option.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined, label: option },
        marks[option] ?? null,
        text(option, { size: 12, weight: on ? 700 : 400, color: on ? "title" : "soft" }),
      );
    }),
  );
}

// ---- model, status, wake --------------------------------------------------------------

export function avatar(model, size = 30) {
  const m = MODELS[model];
  const tone = TIER[m.tier];
  return stack(
    { w: size, h: size, radius: "pill", fill: tone.wash, stroke: tone.hue, strokeWidth: 1.5 },
    text(m.initial, { size: Math.round(size * 0.42), weight: 700, color: tone.hue, place: "center" }),
  );
}

const KINDS = {
  working: { word: "Working", color: "add" },
  idle: { word: "Idle", color: "soft" },
  done: { word: "Task done", color: "soft", shape: "check" },
  waiting: { word: "Waiting on you", color: "warm", shape: "ring" },
  out: { word: "Out", color: "mute", shape: "ring" },
  quota: { word: "Out of quota", color: AMBER, shape: "alert" },
  silent: { word: "Out of reach", color: AMBER, shape: "alert" },
  unknown: { word: "Status unknown", color: "del", shape: "alert" },
};

/** A status as a mark and its word: filled, hollow or a triangle, so colour is never the only cue. */
export function statusMark(kind, { size = 12, word } = {}) {
  const k = KINDS[kind];
  const mark = k.shape === "alert" ? icon("triangleAlert", { size: 12, color: k.color }) : k.shape === "check" ? icon("circleCheck", { size: 12, color: k.color }) : k.shape === "ring" ? box({ w: 9, h: 9, radius: "pill", stroke: k.color, strokeWidth: 1.5 }) : dot(k.color, 8);
  return row({ gap: 6 }, mark, text(word ?? k.word, { size, color: k.color }));
}

/** The mark of a status alone, where the word is one step away. */
export function statusDot(kind) {
  const k = KINDS[kind];
  return k.shape === "alert" ? icon("triangleAlert", { size: 12, color: k.color }) : k.shape === "check" ? icon("circleCheck", { size: 12, color: k.color }) : k.shape === "ring" ? box({ w: 9, h: 9, radius: "pill", stroke: k.color, strokeWidth: 1.5 }) : dot(k.color, 8);
}

export const wakeMark = (on, { size = 12 } = {}) =>
  row({ gap: 5 }, icon(on ? "bell" : "bellOff", { size: 12, color: on ? "name" : "mute" }), text(on ? "Wake on" : "Wake off", { size, color: on ? "name" : "mute" }));

export const machineMark = (machine, { size = 12, color = "soft", tail } = {}) =>
  row({ gap: 6 }, icon(MACHINE_GLYPH, { size: 12, color: "mute" }), text(tail ? `${machine} ${tail}` : machine, { size, color }));

/** The roll-up of a squad: one mark and word per status that has units; `quiet` leaves idle out when anything else is there. */
export function rollup(counts, { quiet = false } = {}) {
  const words = { working: "working", idle: "idle", waiting: "waiting", out: "out", silent: "out of reach" };
  const kept = Object.keys(words).filter((kind) => counts[kind]);
  const shown = quiet && kept.length > 1 ? kept.filter((kind) => kind !== "idle") : kept;
  return row({ gap: 12 }, ...shown.map((kind) => statusMark(kind, { word: `${counts[kind]} ${words[kind]}` })));
}

// ---- graph -------------------------------------------------------------------------------

/** A curved connector between two points, leaving and arriving vertically. */
export function curve(x1, y1, x2, y2, { tone = "dim", width = 1.5, dash } = {}) {
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

export const NODE = { w: 232, h: 78 };

export const youNode = (x, y) =>
  row({ h: 36, pad: [0, 14], gap: 8, radius: "pill", place: { x, y }, fill: "panel", stroke: EDGE, name: "node-you", label: "You" }, icon("circleUser", { size: 16, color: "title" }), text("You", { size: 13, weight: 700, color: "title" }));

// ---- window frame --------------------------------------------------------------------------

export const MODES = [
  ["overview", "Overview", "network"],
  ["blueprint", "Blueprint", "frame"],
  ["void", "Void", "penLine"],
  ["relay", "Relay", "messagesSquare"],
  ["sessions", "Sessions", "squareTerminal"],
];

/** The machines of the strip: a machine out of reach shows the triangle, the local one says so. */
function machineStrip(machines, silent, local, fleet) {
  if (fleet) {
    return row(
      { gap: 16 },
      row({ gap: 6 }, icon(MACHINE_GLYPH, { size: 14, color: "mute" }), text(local, { size: 12, weight: 700, color: "title" }), dot("add", 7)),
      row(
        { h: 28, pad: [0, 8], gap: 8, radius: 8, name: "machine-summary", label: "Machines" },
        text(`${fleet.total.toLocaleString("en-US")} machines`, { size: 12, color: "soft" }),
        fleet.out ? statusMark("silent", { word: `${fleet.out.toLocaleString("en-US")} out of reach` }) : null,
        icon("chevronDown", { size: 12, color: "mute" }),
      ),
    );
  }
  return row(
    { gap: 16 },
    ...machines.map((machine) =>
      row(
        { gap: 6 },
        icon(MACHINE_GLYPH, { size: 14, color: "mute" }),
        text(machine, { size: 12, weight: machine === local ? 700 : 400, color: machine === local ? "title" : "soft" }),
        machine === local ? text("(this window)", { size: 12, color: "mute" }) : null,
        silent.includes(machine) ? icon("triangleAlert", { size: 12, color: AMBER }) : dot("add", 7),
      ),
    ),
  );
}

export function modeBar({ mode, waiting = 1, silent = [], local = "LAPTOP", machines = ["DESKTOP", "LAPTOP"], fleet }) {
  const item = ([key, title, glyph]) =>
    row(
      { h: 32, pad: [0, 12], gap: 7, radius: 9, fill: key === mode ? "on" : undefined, name: `mode-${key}`, label: title },
      icon(glyph, { size: 15, color: key === mode ? "title" : "soft" }),
      text(title, { size: 13, weight: key === mode ? 700 : 400, color: key === mode ? "title" : "soft" }),
    );
  return row(
    { h: BAR, pad: [0, 14], gap: 10, fill: "panel", name: "mode-bar", label: "Mode bar" },
    row({ w: 450, gap: 24 }, row({ gap: 8 }, icon("network", { size: 18, color: "title" }), text("HIVEM1ND", { size: 14, weight: 700, color: "title" })), machineStrip(machines, silent, local, fleet)),
    fill(),
    row({ gap: 2 }, ...MODES.map(item)),
    fill(),
    row(
      { w: 450, gap: 10, justify: "end" },
      waiting
        ? row({ h: 30, pad: [0, 12], gap: 8, radius: "pill", fill: GOLD_WASH, stroke: "warm", name: "waiting-pill", label: "Waiting on you" }, icon("hand", { size: 14, color: "warm" }), text(`${waiting} waiting on you`, { size: 12, weight: 700, color: "warm" }))
        : null,
      iconBtn("chevronUp", { name: "hide-bar", label: "Hide the bar" }),
    ),
  );
}

export function footBar({ read = "Mind read 12 s ago", newest = "Newest record: DESKTOP 09:10, LAPTOP 09:12", warn = false } = {}) {
  return row(
    { h: FOOT, pad: [0, 14], gap: 8, fill: "panel", name: "status-line", label: "Status line" },
    warn ? icon("triangleAlert", { size: 12, color: AMBER }) : dot("add", 7),
    text(read, { size: 12, color: "soft" }),
    fill(),
    text(newest, { size: 12, color: warn ? AMBER : "mute" }),
  );
}

/** The tab that brings a hidden bar back; it keeps the gold mark so a hidden bar never hides what waits. */
const barHandle = (waiting) =>
  row(
    { w: waiting ? 96 : 68, h: 40, pad: [12, 0, 0], gap: 6, justify: "center", radius: 12, fill: "panel", stroke: "line", place: { x: Math.round((W - (waiting ? 96 : 68)) / 2), y: -12 }, name: "bar-handle", label: "Show the bar" },
    icon("chevronDown", { size: 16, color: "soft" }),
    waiting ? dot("warm", 7) : null,
    waiting ? text(String(waiting), { size: 12, weight: 700, color: "warm" }) : null,
  );

/**
 * The docked window of the GUI: a mode bar on top, a list, the stage of the mode, a detail panel and a
 * status line, after the docked frame of the Blueprint web app. `stage(w, h)` returns the nodes placed on
 * the stage; `left` and `right` are one node each. Without `bar` the window is all body and a handle hangs
 * from the top edge.
 */
export function windowFrame({ mode, bar = true, waiting = 1, silent = [], machines, fleet, left, leftW = LEFT, stage, right, rightW = RIGHT, foot = {}, overlay, stageFill = "canvas" }) {
  const bodyH = bar ? H - BAR - FOOT - 2 : H;
  const stageW = W - (left ? leftW + 1 : 0) - (right ? rightW + 1 : 0);
  return stack(
    { w: W, h: H, fill: "canvas", clip: true },
    col(
      { w: W, h: H, place: { x: 0, y: 0 } },
      bar ? [modeBar({ mode, waiting, silent, machines, fleet }), hair()] : null,
      row(
        { h: bodyH, align: "stretch" },
        left ? [col({ w: leftW, h: bodyH, fill: "panel", name: "list-panel", label: "List" }, left), vhair()] : null,
        stack({ w: stageW, h: bodyH, fill: stageFill, clip: true, name: "stage", label: "Stage" }, ...stage(stageW, bodyH)),
        right ? [vhair(), col({ w: rightW, h: bodyH, fill: "panel", name: "detail-panel", label: "Detail" }, right)] : null,
      ),
      bar ? [hair(), footBar(foot)] : null,
    ),
    bar ? null : barHandle(waiting),
    overlay ?? null,
  );
}

// ---- panels --------------------------------------------------------------------------------

/** A definition list: the term in mute, the value beside it. */
export function facts(rows, { termW = 92 } = {}) {
  return col({ gap: 9 }, ...rows.map(([term, value]) => row({ gap: 10, align: "start" }, text(term, { size: 12, color: "mute", w: termW }), typeof value === "string" ? text(value, { size: 13, color: "text", grow: 1 }) : value)));
}

// ---- lists that hold any amount -----------------------------------------------------------------

/** The header of a collapsible group: chevron, title, and a summary at the end that stays readable when collapsed. */
export const groupHeader = (title, { open = true, lead, summary, ref, h = 44 } = {}) =>
  row(
    { h, pad: [0, 12], gap: 10, radius: 10, name: ref, label: title },
    icon(open ? "chevronDown" : "chevronRight", { size: 14, color: "mute" }),
    lead ?? null,
    text(title, { size: 13, weight: 700, color: "title" }),
    fill(),
    summary ?? null,
  );

/** The row that opens the rest of a long group. */
export const moreRow = (value, { ref, indent = 36 } = {}) =>
  row({ h: 36, pad: [0, 12, 0, indent], gap: 8, radius: 10, name: ref, label: value }, icon("plus", { size: 12, color: "soft" }), text(value, { size: 12, weight: 700, color: "soft" }));

/** The thumb of a list that scrolls: its size is the share of the list that is in view. */
export const scrollbar = (x, y, h, thumbH, thumbY) => [
  box({ w: 6, h, radius: "pill", fill: "on", place: { x, y } }),
  box({ w: 6, h: thumbH, radius: "pill", fill: "mute", place: { x, y: y + thumbY } }),
];

/** A value with the part that matches the search shown heavier. */
export function highlight(value, query, props = {}) {
  const at = query ? value.toLowerCase().indexOf(query.toLowerCase()) : -1;
  const { grow, w, lines, ...style } = props;
  if (at < 0) return text(value, props);
  const run = (part, extra = {}) => (part ? text(part, { ...style, ...extra }) : null);
  return row({ grow, w }, run(value.slice(0, at)), row({ pad: [0, 2], radius: 3, fill: "done" }, run(value.slice(at, at + query.length), { color: "title", weight: 700 })), run(value.slice(at + query.length)));
}

/** A search field: the query or the prompt, the size of the result, and a way to clear it. */
export const searchField = (value, { placeholder, result, ref = "search" } = {}) =>
  row(
    { h: 38, pad: [0, 8, 0, 12], gap: 8, radius: 10, fill: "field", stroke: EDGE, name: ref, label: placeholder },
    icon("search", { size: 15, color: "mute" }),
    text(value || placeholder, { size: 13, color: value ? "title" : "mute", lines: 1, grow: 1 }),
    result ? text(result, { size: 12, color: "mute" }) : null,
    value ? iconBtn("x", { size: 26, label: "Clear search" }) : null,
  );
