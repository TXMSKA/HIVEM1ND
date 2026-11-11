// The HIVEM1ND GUI: one local server whose window holds every tool of the kit as a mode.
// The window is the docked frame of the Blueprint web app (a bar on top, the stage, a detail panel) with
// five modes in the bar: Overview, Blueprint Lite, Void Lite, Relay and Sessions. The bar can be hidden;
// its handle keeps the mark of what waits on the person. Each screen answers one question at a glance and
// keeps the rest one step away, in a selection or in the detail panel. Nothing here writes a file: every
// action is an intent the server applies after the person confirms it. The sample is invented:
// its units, machines, clients, statuses and times are examples.

import { board } from "blueprint/board.mjs";
import { box, col, row, stack, text, icon, space, fill, vector, locate } from "blueprint/kit.mjs";
import { dot } from "blueprint/ui.mjs";
import {
  W, H, BAR, FOOT, AMBER, AMBER_WASH, AMBER_EDGE, EDGE, MODELS, CLIENTS, MACHINE_GLYPH, UNITS, NODE, ROLES, COMMANDS,
  label, copy, ident, hair, button, iconBtn, check, toggle, field, select, choice,
  avatar, statusMark, statusDot, wakeMark, machineMark, rollup, roleOf, roleTile,
  curve, youNode, windowFrame, facts, groupHeader, moreRow, scrollbar, highlight, searchField,
} from "../kit/gui.mjs";

// ---- Overview: the chain of command ---------------------------------------------------------------
//
// The Overview is the chain of command of the mind and nothing more: each unit is a name and a role. The
// Overseer is at the top and coordinates the whole mind. Adjutants hang beside its line: second in rank,
// they serve the person and the Overseer and lead nobody. Each Overlord heads a column with its Executors
// below it, so who answers to whom reads at a glance; Executors with no Overlord answer to the Overseer and
// share the last column. The Incubator and Genesis are services outside the chain, in a corner. Machine,
// client, model, task and the conversation are one selection away, in the unit panel, which is the same in
// Overview and Sessions.

const TEAM = {
  overseer: "overseer",
  adjutants: ["adjutant"],
  services: ["incubator"],
  groups: [
    { id: "web", kind: "Environment", lead: "overlord-web", members: ["executor-shop", "executor-blog"] },
    { id: "api", kind: "Project", lead: "overlord-api", members: ["builder-codex", "builder-codex-2"] },
    { id: "docs", kind: "Project", members: ["executor-docs"] },
    { id: "mobile", kind: "Project", members: ["executor-mobile"] },
    { id: "data", kind: "Project", members: ["executor-data"] },
    { id: "site", kind: "Project", members: ["executor-site"] },
    { id: "Other units", kind: "No lead", members: ["builder-cursor"] },
  ],
};

const COL_W = 280;
const COL_GAP = 40;
const EXEC_SHOWN = 4;
const STEP = 60;
// Heights on the chart, from its top: the Overseer, the line that joins the columns, the Overlords and the
// first Executor. Every column shares them, so a rank is one height across the whole map.
const TOP_Y = 52;
const BUS = 200;
const TIER = 224;
const FIRST = 300;

const plural = (n, noun) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;

const vline = (x, y, h) => box({ w: 2, h: Math.max(1, Math.round(h)), fill: "dim", place: { x: Math.round(x) - 1, y: Math.round(y) } });
const hline = (x, y, w) => box({ w: Math.max(1, Math.round(w)), h: 2, fill: "dim", place: { x: Math.round(x), y: Math.round(y) - 1 } });

/** The columns of a team: one per Overlord, then one for the Executors that answer to the Overseer. */
function columnsOf(team) {
  const columns = team.groups.filter((g) => g.lead).map((g) => ({ id: g.id, lead: g.lead, members: g.members }));
  const direct = team.groups.filter((g) => !g.lead).flatMap((g) => g.members);
  if (direct.length) columns.push({ id: "direct", members: direct });
  return columns;
}

/** The counts of a column by status, for the data given. */
function countsOf(column, U, gone) {
  const counts = {};
  for (const unit of [column.lead, ...column.members].filter(Boolean)) {
    const kind = gone(unit) ? "silent" : U(unit).status;
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

// What needs the person first, then what is working; the Executors without an Overlord stay last.
const attention = (counts) => (counts.waiting ?? 0) * 1000 + (counts.working ?? 0);

/** A dashed place held for a role that does not exist yet, with the action that creates it. */
const slot = (x, y, w, h, title, hint, ref) =>
  col(
    { w, h, pad: [10, 12], gap: 6, radius: 12, stroke: "name", dash: "5 4", place: { x, y }, name: ref, label: title },
    text(title, { size: 13, weight: 700, color: "title" }),
    text(hint, { size: 12, color: "mute", lines: 2 }),
  );

/** A unit on the map: its role tile, its name and its role. The status is a mark; the rest is in the unit panel. */
function chartNode(x, y, unit, { role, sub, w = COL_W, h = 56, data, selected = false, silent = false } = {}) {
  const kind = silent ? "silent" : data.status;
  const ring = kind === "waiting" ? "warm" : selected ? "text" : null;
  return stack(
    { w: w + 12, h: h + 12, place: { x: x - 6, y: y - 6 }, name: `node-${unit}`, label: unit },
    ring ? box({ w: w + 12, h: h + 12, radius: 17, stroke: ring, strokeWidth: 2, place: { x: 0, y: 0 } }) : null,
    row(
      { w, h, pad: [0, 14, 0, 10], gap: 10, radius: 12, fill: "panel", stroke: silent ? AMBER : "line", place: { x: 6, y: 6 }, opacity: silent ? 0.78 : undefined },
      roleTile(role, h >= 56 ? 32 : 28),
      col({ grow: 1, gap: 2 }, text(unit, { size: 13, weight: 700, face: "mono", color: "title", lines: 1 }), text(sub ?? ROLES[role].name, { size: 12, color: "mute", lines: 1 })),
      statusDot(kind),
    ),
  );
}

/** A column: an Overlord over its Executors, or the Executors that answer to the Overseer, on one rail. */
function chartColumn(x, dy, column, node, U) {
  const items = [];
  const rail = x + 26;
  const shown = column.members.slice(0, EXEC_SHOWN);
  const more = column.members.length - shown.length;
  const y = (i) => FIRST + dy + i * STEP;
  if (column.lead) items.push(node(x, TIER + dy, column.lead, "overlord", { sub: `Overlord of ${column.id}` }));
  else items.push(text("Without an Overlord", { size: 12, weight: 700, color: "mute", place: { x: x + 40, y: TIER + dy + 20 } }));
  const start = column.lead ? TIER + dy + 56 : BUS + dy;
  const end = more > 0 ? y(shown.length) + 16 : y(shown.length - 1) + 24;
  items.push(vline(rail, start, end - start));
  shown.forEach((unit, i) => {
    const job = U(unit).job;
    items.push(hline(rail, y(i) + 24, 18), node(x + 44, y(i), unit, "executor", { w: COL_W - 44, h: 48, sub: job ? `Executor, ${job}` : undefined }));
  });
  if (more > 0) {
    items.push(
      hline(rail, y(shown.length) + 16, 18),
      row({ h: 32, pad: [0, 10], gap: 8, radius: 9, place: { x: x + 44, y: y(shown.length) }, name: `more-${column.id}`, label: `${more} more Executors` }, icon("plus", { size: 12, color: "soft" }), text(`Show ${more.toLocaleString("en-US")} more`, { size: 12, weight: 700, color: "soft" })),
    );
  }
  return items;
}

/** The columns that do not fit: one card that names each with its most urgent count, and the way to all of them. */
function foldedColumns(x, columns, U, gone) {
  const words = { waiting: "waiting", working: "working", silent: "out of reach", idle: "idle", out: "out" };
  const overlords = columns.filter((c) => c.lead).length;
  const rows = columns.slice(0, 6).map((column) => {
    const counts = countsOf(column, U, gone);
    const lead = counts.waiting ? "waiting" : counts.working ? "working" : counts.silent ? "silent" : "idle";
    return row(
      { h: 40, pad: [0, 10], gap: 9, radius: 9, name: `column-${column.id}`, label: column.lead ?? "Without an Overlord" },
      roleTile(column.lead ? "overlord" : "executor", 24),
      text(column.lead ?? "Without an Overlord", { size: 12, weight: 700, face: column.lead ? "mono" : undefined, color: "title", lines: 1, grow: 1 }),
      statusMark(lead, { word: `${(counts[lead] ?? 0).toLocaleString("en-US")} ${words[lead]}` }),
    );
  });
  return col(
    { w: COL_W, pad: 6, gap: 1, radius: 14, fill: "panel", stroke: EDGE, place: { x, y: TIER }, name: "more-columns", label: "More columns" },
    row({ h: 34, pad: [0, 10] }, text(overlords ? `${plural(overlords, "more Overlord")}` : "More", { size: 12, weight: 700, color: "mute" })),
    ...rows,
    hair({ w: undefined }),
    row({ h: 36, pad: [0, 10], gap: 8, radius: 9, name: "all-in-sessions", label: "Show all in Sessions" }, icon("squareTerminal", { size: 13, color: "soft" }), text("Show all in Sessions", { size: 12, weight: 700, color: "soft" })),
  );
}

const serviceChip = (glyph, title, mark, ref) =>
  row({ h: 32, pad: [0, 12], gap: 8, radius: "pill", fill: "panel", stroke: "line", name: ref, label: title }, icon(glyph, { size: 14, color: "soft" }), text(title, { size: 12, weight: 700, color: "title" }), mark);

/**
 * The map: the person, the Overseer and its Adjutants above, one column per Overlord below, and the
 * services in the corner. Columns that do not fit the width fold into one card; the full list is Sessions.
 */
function orgChart(cw, ch, { team = TEAM, data = {}, sel = "", offline = false, top = 64, drag } = {}) {
  const U = (unit) => data[unit] ?? UNITS[unit];
  const gone = (unit) => offline && U(unit).machine === "LAPTOP";
  const node = (x, y, unit, role, extra = {}) => chartNode(x, y, unit, { role, data: U(unit), selected: sel === unit, silent: gone(unit), ...extra });
  const cx = Math.round(cw / 2);
  const items = [youNode(cx - 36, 0), vline(cx, 36, TOP_Y - 36)];
  items.push(team.overseer ? node(cx - COL_W / 2, TOP_Y, team.overseer, "overseer", { sub: "Overseer of the mind" }) : slot(cx - COL_W / 2, TOP_Y, COL_W, 56, "No Overseer yet", "Coordinates the whole mind.", "slot-overseer"));

  // Adjutants hang beside the line under the Overseer: second in rank, leading nobody.
  const ay = TOP_Y + 80;
  if (team.adjutants.length) {
    items.push(hline(cx, ay + 24, 44), node(cx + 44, ay, team.adjutants[0], "adjutant", { w: 210, h: 48 }));
    if (team.adjutants.length > 1) {
      items.push(row({ h: 32, pad: [0, 10], gap: 8, radius: 9, place: { x: cx + 268, y: ay + 8 }, name: "more-adjutants", label: "More Adjutants" }, icon("plus", { size: 12, color: "soft" }), text(`${plural(team.adjutants.length - 1, "more Adjutant")}`, { size: 12, weight: 700, color: "soft" })));
    }
  }

  const columns = columnsOf(team);
  const leads = columns.filter((c) => c.lead).sort((a, b) => attention(countsOf(b, U, gone)) - attention(countsOf(a, U, gone)));
  const ordered = [...leads, ...columns.filter((c) => !c.lead)];
  const fit = Math.max(1, Math.floor((cw - 32 + COL_GAP) / (COL_W + COL_GAP)));
  const shown = ordered.length > fit ? ordered.slice(0, fit - 1) : ordered;
  const folded = ordered.slice(shown.length);
  const slots = shown.length + (folded.length ? 1 : 0);
  if (slots) {
    const left = Math.round(cx - (slots * COL_W + (slots - 1) * COL_GAP) / 2);
    const xs = Array.from({ length: slots }, (_, i) => left + i * (COL_W + COL_GAP));
    const drops = xs.map((x, i) => (i < shown.length && !shown[i].lead ? x + 26 : x + COL_W / 2));
    const minX = Math.min(cx, ...drops);
    const maxX = Math.max(cx, ...drops);
    items.push(vline(cx, TOP_Y + 56, BUS - TOP_Y - 56), hline(minX, BUS, maxX - minX + 1));
    xs.forEach((x, i) => {
      if (i >= shown.length || shown[i].lead) items.push(vline(drops[i], BUS, TIER - BUS));
    });
    shown.forEach((column, i) => {
      const moved = drag && drag.id === column.id;
      if (moved) {
        const h = FIRST - TIER + Math.min(column.members.length, EXEC_SHOWN) * STEP + (column.members.length > EXEC_SHOWN ? 40 : 0);
        items.push(box({ w: COL_W + 12, h: h + 12, radius: 18, stroke: "name", dash: "6 4", place: { x: xs[i] - 6, y: TIER - 6 } }));
      }
      items.push(...chartColumn(xs[i] + (moved ? drag.dx : 0), moved ? drag.dy : 0, column, node, U));
      if (moved) items.push(row({ h: 26, pad: [0, 10], radius: 8, fill: "text", place: { x: xs[i] + drag.dx + 20, y: TIER + drag.dy - 34 } }, text(`Moving ${column.id}`, { size: 12, weight: 700, color: "canvas" })));
    });
    if (folded.length) items.push(foldedColumns(xs[slots - 1], folded, U, gone));
  }

  if (team.services.length || team.overseer) {
    items.push(
      row(
        { gap: 8, place: { x: 16, y: ch - top - 48 } },
        text("Services", { size: 12, color: "mute" }),
        ...team.services.map((unit) => serviceChip(ROLES.incubator.glyph, ROLES.incubator.name, statusDot(gone(unit) ? "silent" : U(unit).status), `node-${unit}`)),
        serviceChip(ROLES.genesis.glyph, ROLES.genesis.name, text("2 machines", { size: 12, color: "mute" }), "node-genesis"),
      ),
    );
  }
  return [stack({ w: cw, h: ch - top, place: { x: 0, y: top } }, ...items)];
}

/** The tools of the stage: create, the palette, and the arrangement once the person has moved something. */
const mapToolbar = (cw, { arranged = false } = {}) =>
  row(
    { w: cw - 32, place: { x: 16, y: 12 }, gap: 8 },
    button("New", { kind: "primary", glyph: "plus", ref: "new-menu" }),
    button("Commands", { glyph: "command", ref: "open-palette" }),
    fill(),
    arranged ? row({ gap: 6 }, icon("check", { size: 12, color: "mute" }), text("Arrangement saved", { size: 12, color: "mute" })) : null,
    arranged ? button("Tidy", { kind: "quiet", glyph: "layoutGrid", h: 30, ref: "tidy" }) : null,
  );

const notice = (cw, value) =>
  row({ h: 34, pad: [0, 12], gap: 8, radius: 10, fill: AMBER_WASH, stroke: AMBER_EDGE, place: { x: cw - 316, y: 56 }, name: "machine-notice", label: "Machine notice" }, icon("triangleAlert", { size: 14, color: AMBER }), text(value, { size: 12, color: "text" }));

// ---- the unit panel: who the unit is, where it runs, and the conversation with it, in one place
//
// Selecting a unit in Overview or a session in Sessions opens this same panel. Its facts are the session's;
// its middle is the Relay conversation of the person with that unit; its composer takes a message or, after
// a slash, a command of the kit. Opening the client, a new task, clearing and ending are its actions.

// The conversation of the person with each unit of the sample, newest last.
const CHATS = {
  "executor-shop": [
    { mine: true, time: "Yesterday 21:30", body: "Start task 029 on feat/029-ask. Keep the ask panel behind its flag." },
    { time: "08:50", body: "Task 029 is complete. The review is with overlord-web." },
    { time: "09:02", body: "Merged main into the branch. The checks pass." },
  ],
  "overlord-web": [
    { mine: true, time: "08:30", body: "Review task 029 before it comes to me." },
    { time: "08:50", body: "Task 029 is ready for review." },
  ],
  "executor-blog": [
    { mine: true, time: "Yesterday 21:05", body: "Merge task 005 once the checks pass." },
    { time: "Yesterday 22:35", body: "Task 005 is merged on master. Nothing is pending." },
  ],
  "overlord-api": [
    { mine: true, time: "08:20", body: "Where should squad rules be stored, so that the Overlord can read them without asking?" },
    { time: "08:41", body: "Proposal: optional work and effort headers in the state of an Executor. The change touches files.md and needs approval." },
  ],
  adjutant: [
    { mine: true, time: "07:30", body: "Write the release note of the kit." },
    { time: "08:12", body: "The note is ready to read." },
  ],
};

// What each running session is for and when it started; `done` marks a session whose task is complete.
const SESSION = {
  "executor-shop": { why: "Task 029, branch feat/029-ask", since: "Today 07:40" },
  "builder-codex": { why: "Task 033", since: "Today 08:55" },
  "overlord-web": { why: "Review of task 029", since: "Today 08:45" },
  "executor-blog": { why: "Task 005, merged on master", since: "Yesterday 22:35", done: true },
  "builder-cursor": { why: "Task 024", since: "Yesterday 21:10" },
  overseer: { why: "Coordination of the mind", since: "Yesterday 14:07" },
  "overlord-api": { why: "Squad rules, waiting for an answer", since: "Today 06:20" },
  adjutant: { why: "Release note of the kit", since: "Today 07:30" },
  "builder-codex-2": { why: "Task 024", since: "Yesterday 21:44" },
  "executor-docs": { why: "Branch main", since: "Yesterday 18:02" },
  "executor-data": { why: "No open task", since: "Yesterday 20:15" },
  "executor-site": { why: "Task 011, waiting for quota", since: "Yesterday 18:10" },
  "executor-mobile": { why: "Branch main", since: "Today 06:45" },
  incubator: { why: "Idea review", since: "Today 06:55" },
};

const bubble = ({ mine = false, time, body }, unit) =>
  col(
    { gap: 4, align: mine ? "end" : "start" },
    row({ gap: 8 }, mine ? text("You", { size: 12, weight: 700, color: "title" }) : ident(unit, { size: 12 }), text(time, { size: 12, color: "mute" })),
    col({ w: 300, pad: [8, 12], radius: 12, fill: mine ? "on" : "field" }, text(body, { size: 13, lh: 1.5, color: "text" })),
  );

const cell = (term, value) => col({ grow: 1, gap: 3 }, text(term, { size: 12, color: "mute" }), typeof value === "string" ? text(value, { size: 13, color: "text", lines: 1 }) : value);
const pair = (a, b) => row({ gap: 16, align: "start" }, col({ w: 178 }, cell(...a)), col({ grow: 1 }, cell(...b)));

/** Who a unit answers to: its Overlord, the Overseer, or the person for the Overseer itself. */
const reportsTo = (unit, u) => (unit === "overseer" ? "You" : u.lead ?? "overseer");

function unitPanel(unit, { data = {}, offline = false, chat, manage = false, sub } = {}) {
  const u = data[unit] ?? UNITS[unit];
  const role = roleOf(unit);
  const silent = offline && u.machine === "LAPTOP";
  const kind = silent ? "silent" : SESSION[unit]?.done ? "done" : u.status;
  const s = SESSION[unit] ?? {};
  const messages = chat ?? CHATS[unit] ?? [];
  const boss = reportsTo(unit, u);
  return col(
    { grow: 1 },
    row(
      { pad: [16, 12, 14, 18], gap: 12 },
      roleTile(role, 40),
      col({ grow: 1, gap: 3 }, text(unit, { size: 15, weight: 700, face: "mono", color: "title", lines: 1 }), row({ gap: 12 }, text(sub ?? ROLES[role].name, { size: 12, color: "soft" }), statusMark(kind))),
      iconBtn("ellipsis", { name: "unit-menu", label: "More actions" }),
      iconBtn("x", { name: "close-unit", label: "Close" }),
    ),
    hair(),
    col(
      { pad: [14, 18, 16], gap: 12 },
      pair(["Machine", machineMark(u.machine, { size: 13, color: "text" })], ["Client", CLIENTS[u.client]]),
      pair(["Model", u.model === "none" ? text("Not recorded", { size: 13, color: "mute" }) : MODELS[u.model].name], ["Wake", wakeMark(u.wake, { size: 13 })]),
      pair(["Reports to", boss === "You" ? text("You", { size: 13, color: "text" }) : ident(boss, { size: 13 })], ["Started", u.since ?? s.since ?? "Today"]),
      cell("Task", u.why ?? s.why ?? "No open task"),
      row({ gap: 8 }, button(`Open in ${CLIENTS[u.client]}`, { glyph: "externalLink", h: 30, disabled: silent }), button("New task", { kind: "quiet", glyph: "listTodo", h: 30, ref: "new-task" })),
    ),
    hair(),
    col({ grow: 1, pad: [16, 18], gap: 14, name: "unit-conversation", label: "Conversation" }, ...(messages.length ? messages.map((m) => bubble(m, unit)) : [text(`No messages with ${unit} yet.`, { size: 12, color: "mute" })])),
    hair(),
    col(
      { pad: [12, 18, 14], gap: 8 },
      row(
        { h: 42, pad: [0, 6, 0, 12], gap: 8, radius: 11, fill: "field", stroke: EDGE, name: "unit-composer", label: `Message ${unit}` },
        text(`Message ${unit}, or / for a command`, { size: 13, color: "mute", grow: 1, lines: 1 }),
        stack({ w: 30, h: 30, radius: 8, fill: "text", name: "send-message", label: "Send" }, icon("send", { size: 14, color: "canvas", place: "center" })),
      ),
      row({ gap: 6 }, icon(u.wake && !silent ? "bell" : "bellOff", { size: 12, color: u.wake && !silent ? "name" : "mute" }), text(silent ? "Out of reach: the message waits in the inbox" : u.wake ? "Wake on: the session is notified" : "Wake off: the message waits in the inbox", { size: 12, color: u.wake && !silent ? "name" : "mute" })),
    ),
    manage
      ? [hair(), row({ pad: [10, 12, 12], gap: 4 }, button("Clear context", { kind: "quiet", glyph: "rotateCcw", h: 30, ref: "clear-context", disabled: silent }), button("End session", { kind: "quiet", glyph: "circleStop", h: 30, ref: "end-session", disabled: silent }))]
      : null,
  );
}

// What waits on the person: the `waiting` list of the view contract, blocking items first. It opens from the
// gold mark of the bar.
function waitingPanel({ waiting = 2, review = null } = {}) {
  return col(
    { grow: 1 },
    row({ h: 58, pad: [0, 12, 0, 18], gap: 10 }, icon("hand", { size: 15, color: "warm" }), text("Waiting on you", { size: 15, weight: 700, color: "title" }), text(String(waiting), { size: 13, weight: 700, color: "warm" }), fill(), iconBtn("x", { name: "close-waiting", label: "Close" })),
    hair(),
    review
      ? review
      : col(
          { pad: [16, 18], gap: 10 },
          row({ gap: 9 }, icon("messageCircle", { size: 15, color: "warm" }), text("Reply requested", { size: 13, weight: 700, color: "title", grow: 1 }), text("08:41", { size: 12, color: "mute" })),
          ident("overlord-api", { size: 12 }),
          text("Where are the rules of a squad connection stored?", { size: 13, lh: 1.5, color: "text" }),
          row({ gap: 8 }, button("Reply", { kind: "primary", glyph: "reply", h: 30, ref: "waiting-reply" }), button("Open thread", { kind: "quiet", h: 30 })),
        ),
    review ? null : hair(),
    review
      ? null
      : col(
          { pad: [16, 18], gap: 10 },
          row({ gap: 9 }, icon("checkCheck", { size: 15, color: "warm" }), text("Review task 029", { size: 13, weight: 700, color: "title", grow: 1 }), text("08:50", { size: 12, color: "mute" })),
          row({ gap: 6 }, ident("executor-shop", { size: 12 }), copy("approved by"), ident("overlord-web", { size: 12 })),
          row({ gap: 8 }, button("Accept task", { glyph: "check", h: 30 }), button("Send back", { glyph: "cornerDownLeft", h: 30 }), button("Open task", { kind: "quiet", h: 30 })),
        ),
  );
}

// ---- the menus: create a role, and every command

const menuItem = (glyph, title, what, { ref, disabled = false } = {}) =>
  row(
    { pad: [8, 10], gap: 12, radius: 9, align: "start", name: ref, label: title },
    icon(glyph, { size: 16, color: disabled ? "mute" : "soft" }),
    col({ grow: 1, gap: 2 }, text(title, { size: 13, weight: 700, color: disabled ? "mute" : "title" }), text(what, { size: 12, color: "mute", lines: 2 })),
  );

// The roles in their order of rank, each with what it does: this menu is where the roles are explained.
const newMenu = () =>
  col(
    { w: 340, pad: 6, gap: 1, radius: 14, fill: "panel", stroke: EDGE, place: { x: 16, y: BAR + 54 }, name: "new-menu-open", label: "New" },
    menuItem(ROLES.overseer.glyph, "Overseer", "Already running: overseer. A mind has one.", { ref: "menu-overseer", disabled: true }),
    menuItem(ROLES.adjutant.glyph, "Adjutant", "Second in rank. Finishes requests: documents, research, reports.", { ref: "menu-adjutant" }),
    menuItem(ROLES.overlord.glyph, "Overlord with Executors", "Leads a group of Executors for an environment or a project.", { ref: "menu-overlord" }),
    menuItem(ROLES.executor.glyph, "Executor", "Carries out tasks in one repository, under an Overlord or the Overseer.", { ref: "menu-executor" }),
    hair({ w: undefined }),
    menuItem("folderPlus", "Environment", "A group of projects of one kind, such as web.", { ref: "menu-environment" }),
  );

const paletteRow = (glyph, title, what, slash, { selected = false } = {}) =>
  row(
    { h: 40, pad: [0, 12], gap: 12, radius: 9, fill: selected ? "on" : undefined, stroke: selected ? EDGE : undefined, name: `palette-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label: title },
    icon(glyph, { size: 15, color: "soft" }),
    text(title, { size: 13, weight: 700, color: "title" }),
    text(what, { size: 12, color: "mute", lines: 1, grow: 1 }),
    slash ? text(slash, { size: 12, face: "mono", color: "mute" }) : null,
  );

/** The command palette: every command and feature, the creation of every role and, while typing, the units. */
function palette({ unit = "executor-shop" } = {}) {
  const total = COMMANDS.length + 6;
  const w = 640;
  const rows = [
    ["On " + unit, [["listTodo", "New task", "Create a task for this unit", "/task", true], ["messageSquare", "Message", "Write a message to this unit", "/msg"], ["history", "Catch up", "Summarize what changed", "/catchup"]]],
    ["Create", [["userCheck", "Adjutant", "Finishes requests for the person", ""], ["boxes", "Overlord with Executors", "A group of Executors under one lead", ""], ["folderPlus", "Environment", "A group of projects of one kind", ""]]],
    ["Commands and features", COMMANDS.slice(0, 4).map(([name, what, slash]) => ["command", name, what, slash])],
  ];
  return stack(
    { w: W, h: H, place: { x: 0, y: 0 } },
    box({ w: W, h: H, fill: "overlay", place: { x: 0, y: 0 } }),
    col(
      { w, pad: 12, gap: 6, radius: 18, fill: "panel", stroke: EDGE, place: { x: Math.round((W - w) / 2), y: 96 }, name: "palette", label: "Commands" },
      searchField("", { placeholder: "Type a command, a role or a unit", ref: "palette-search" }),
      stack(
        { w: w - 24, h: 540, clip: true },
        col({ w: w - 38, gap: 2, place: { x: 0, y: 0 } }, ...rows.flatMap(([title, items]) => [row({ h: 32, pad: [8, 12, 0] }, text(title, { size: 12, weight: 700, color: "mute" })), ...items.map(([glyph, name, what, slash, selected]) => paletteRow(glyph, name, what, slash, { selected }))])),
        ...scrollbar(w - 30, 0, 540, 280, 0),
      ),
      row({ pad: [4, 12, 0], gap: 8 }, text(`${total} results. Type to narrow them.`, { size: 12, color: "mute", grow: 1 }), text("Enter runs, Escape closes", { size: 12, color: "mute" })),
    ),
  );
}

// ---- screens of Overview ---------------------------------------------------------------------------

const PANEL_W = 420;

const overviewFrame = ({ team = TEAM, data, sel = "", right, rightW = PANEL_W, overlay, drag, offline = false, waiting = 2, note, top = 64, silent, foot, stageFn, machines, fleet, arranged = false }) =>
  windowFrame({
    mode: "overview",
    waiting,
    silent,
    foot,
    machines,
    fleet,
    stage: stageFn ?? ((cw, ch) => [...orgChart(cw, ch, { team, data, sel, offline, drag, top }), mapToolbar(cw, { arranged }), ...(note ? [notice(cw, note)] : [])]),
    right,
    rightW,
    overlay,
  });

const overview = () => overviewFrame({});
const overviewSelected = () => overviewFrame({ sel: "executor-shop", right: unitPanel("executor-shop") });
const overviewWaiting = () => overviewFrame({ right: waitingPanel(), rightW: 380 });
const overviewCreate = () => overviewFrame({ overlay: stack({ w: W, h: H, place: { x: 0, y: 0 } }, newMenu()) });
const overviewPalette = () => overviewFrame({ sel: "executor-shop", right: unitPanel("executor-shop"), overlay: palette() });

/** A column lifted by the pointer: its place is held by a dashed outline and the map keeps the arrangement. */
const overviewArrange = () => overviewFrame({ drag: { id: "api", dx: 0, dy: 150 }, arranged: true });

const overviewMany = () => overviewFrame({ team: BIG.team, data: BIG.data, ...FLEET_FRAME_BAR });

// ---- screens: shell and the states of Overview ------------------------------------------------------

/** A named region of the frame, outlined and tagged: how the shell reads, drawn over a live screen. */
function region(x, y, w, h, title, tagX, tagY) {
  return [
    box({ w, h, place: { x, y }, radius: 6, stroke: "name", strokeWidth: 1.5, dash: "6 4" }),
    row({ pad: [4, 10], radius: 7, fill: "field", stroke: "name", place: { x: tagX, y: tagY } }, text(title, { size: 12, weight: 700, color: "title" })),
  ];
}

const shell = () =>
  overviewFrame({
    sel: "executor-shop",
    right: unitPanel("executor-shop"),
    overlay: stack(
      { w: W, h: H, place: { x: 0, y: 0 } },
      ...region(0, 0, W, BAR, "Mode bar", 1010, 15),
      ...region(0, BAR + 1, W - PANEL_W - 1, H - BAR - FOOT - 2, "Stage", 40, 790),
      ...region(W - PANEL_W, BAR + 1, PANEL_W, H - BAR - FOOT - 2, "Detail", 1290, 740),
      ...region(0, H - FOOT, W, FOOT, "Status line", 640, H - FOOT + 2),
    ),
  });

const shellHidden = () =>
  windowFrame({
    mode: "overview",
    bar: false,
    waiting: 2,
    stage: (cw, ch) => [...orgChart(cw, ch, { sel: "builder-codex-2", top: 90 }), mapToolbar(cw)],
  });

const offline = () =>
  overviewFrame({
    offline: true,
    sel: "overlord-api",
    silent: ["LAPTOP"],
    foot: { read: "Mind read 12 s ago", newest: "Newest record: DESKTOP 09:10, LAPTOP 08:41", warn: true },
    note: "LAPTOP is out of reach since 08:41",
    right: unitPanel("overlord-api", { offline: true, sub: "Overlord of api" }),
  });

const clientRow = (client, found, configured) =>
  row(
    { h: 32, gap: 10 },
    icon(found ? "circleCheck" : "circleDashed", { size: 14, color: found ? "add" : "mute" }),
    text(CLIENTS[client], { size: 13, color: "text", w: 120 }),
    text(found ? "Found" : "Not found", { size: 13, color: found ? "soft" : "mute", w: 100 }),
    text(configured ? "Relay configured" : found ? "Relay not configured" : "", { size: 13, color: configured ? "soft" : "text", grow: 1 }),
    found && !configured ? button("Configure Relay", { h: 28, ref: `setup-${client}` }) : null,
  );

/** One rank of the chain, not created yet: its role, and what it does, in a dashed outline. */
const ghost = (x, y, w, role, what) =>
  row(
    { w, h: 60, pad: [0, 12], gap: 10, radius: 12, stroke: "name", dash: "5 4", place: { x, y } },
    roleTile(role, 30),
    col({ grow: 1, gap: 2 }, text(ROLES[role].name, { size: 13, weight: 700, color: "title" }), text(what, { size: 12, color: "mute", lines: 1 })),
  );

/** The chain of command a mind grows into, drawn empty, so the order of rank is learnt before anything exists. */
function ghostChain(x, y) {
  const cx = x + 150;
  return [
    ghost(x + 30, y, 240, "overseer", "Coordinates the whole mind"),
    vline(cx, y + 60, 160),
    hline(cx, y + 110, 40),
    ghost(cx + 40, y + 80, 220, "adjutant", "Second in rank, serves you"),
    ghost(x + 30, y + 220, 240, "overlord", "Leads a group of Executors"),
    vline(x + 56, y + 280, 110),
    hline(x + 56, y + 320, 18),
    ghost(x + 74, y + 290, 240, "executor", "Does the work in a repository"),
    hline(x + 56, y + 390, 18),
    ghost(x + 74, y + 360, 240, "executor", "Any number of them"),
  ];
}

/** A mind with no unit, on two machines: the only thing to do is to create the Overseer. */
const emptyFrame = ({ overlay } = {}) =>
  windowFrame({
    mode: "overview",
    waiting: 0,
    foot: { read: "Mind read 3 s ago", newest: "No records yet" },
    stage: (cw) => [
      col(
        { w: 600, gap: 0, place: { x: 96, y: 96 }, name: "empty-mind", label: "Empty mind" },
        text("No units yet", { size: 24, weight: 700, color: "title" }),
        space(8),
        text("A mind starts with the Overseer, the one unit that coordinates all the others. Adjutants, Overlords and Executors come after it, in that order of rank. Create the Overseer first, on the machine that stays on.", { size: 14, lh: 1.5, color: "soft" }),
        space(18),
        row({}, button("Create Overseer", { kind: "primary", glyph: "crown", h: 36, ref: "create-overseer" })),
        space(36),
        hair(),
        space(16),
        text("Clients on this machine", { size: 14, weight: 700, color: "title" }),
        space(8),
        clientRow("claude", true, true),
        clientRow("codex", true, true),
        clientRow("cursor", true, false),
        clientRow("opencode", false, false),
      ),
      stack({ w: 420, h: 440, place: { x: cw - 520, y: 110 }, name: "empty-chain", label: "The chain of command" }, ...ghostChain(0, 0)),
    ],
    overlay,
  });

const empty = () => emptyFrame();

// ---- screens: squad creation -----------------------------------------------------------------

// A unit that does not exist yet: dashed, started with the squad. With `count` it stands for a group of Executors
// that share one rule.
function draftNode(x, y, { unit, model, client, machine, job, ref, selected = false, count = 1, name }) {
  const w = NODE.w;
  const h = 104;
  const extra = count > 1 ? 14 : 0;
  return stack(
    { w: w + 12 + extra, h: h + 12 + extra, place: { x: x - 6, y: y - 6 }, name: ref, label: unit },
    count > 1 ? box({ w, h, radius: 13, stroke: EDGE, dash: "5 4", place: { x: 6 + extra, y: 6 + extra } }) : null,
    count > 1 ? box({ w, h, radius: 13, stroke: EDGE, dash: "5 4", place: { x: 6 + extra / 2, y: 6 + extra / 2 } }) : null,
    selected ? box({ w: w + 12, h: h + 12, radius: 18, stroke: "text", strokeWidth: 2, place: { x: 0, y: 0 } }) : null,
    col(
      { w, h, pad: [10, 12], gap: 6, radius: 13, fill: "panel", stroke: "name", dash: "5 4", place: { x: 6, y: 6 } },
      row({ gap: 9 }, avatar(model, 30), col({ grow: 1, gap: 1 }, text(name ?? unit, { size: 12, weight: 700, face: "mono", color: "title", lines: 1 }), text(count > 1 ? `${count} Executors, ${job}` : `${job}, ${MODELS[model].name}`, { size: 12, color: "mute", lines: 1 }))),
      row({ gap: 6 }, icon(MACHINE_GLYPH, { size: 12, color: "mute" }), text(count > 1 ? `${MODELS[model].name} on ${machine}` : `${CLIENTS[client]} on ${machine}`, { size: 12, color: "soft", lines: 1 })),
      row({ gap: 6 }, row({ gap: 6 }, box({ w: 9, h: 9, radius: "pill", stroke: "mute", strokeWidth: 1.5 }), text("Starts with the squad", { size: 12, color: "soft" })), fill(), wakeMark(true)),
    ),
  );
}

const MEMBERS = [
  { key: "sonnet", unit: "executor-shop-2", model: "sonnet", client: "claude", machine: "DESKTOP", job: "builder" },
  { key: "haiku", unit: "executor-shop-3", model: "haiku", client: "claude", machine: "DESKTOP", job: "reader" },
  { key: "opus", unit: "executor-shop-4", model: "opus", client: "claude", machine: "DESKTOP", job: "planner" },
];

// The rules of each connection. Each cites the row of user/models.md it comes from; `differs` says where the
// squad's rule is not in that row, which stays as it is.
const RULES = {
  sonnet: {
    title: "Clear tasks",
    lines: [["Model", "Sonnet 5.5"], ["Effort", "high, medium when possible"]],
    source: "models.md: Build from an approved plan, high",
    differs: "Medium is not in models.md",
  },
  haiku: {
    title: "Research only",
    lines: [["Model", "Haiku 5.5"], ["Effort", "low"], ["Takes", "research, inventories, status rounds"]],
    source: "models.md: Read-only gathering, low",
  },
  opus: {
    title: "Planning and answers",
    lines: [["Model", "Opus 5.5"], ["Plans", "high"], ["Answers", "medium"]],
    source: "models.md: Plan, scope, deep review, max",
    differs: "High and medium are not in models.md",
  },
};

function ruleCard(x, y, member, { selected = false } = {}) {
  const rule = RULES[member.key];
  return col(
    { w: 250, h: 204, pad: [12, 14], gap: 8, radius: 14, fill: "panel", stroke: selected ? "text" : EDGE, strokeWidth: selected ? 2 : 1, place: { x, y }, name: `rule-${member.key}`, label: `Rule: ${rule.title}` },
    row({ gap: 8 }, icon("route", { size: 14, color: "soft" }), text(rule.title, { size: 13, weight: 700, color: "title" })),
    col({ gap: 4 }, ...rule.lines.map(([term, value]) => row({ gap: 8, align: "start" }, text(term, { size: 12, color: "mute", w: 56 }), text(value, { size: 12, color: "text", grow: 1 })))),
    hair(),
    row({ gap: 6, align: "start" }, icon("fileText", { size: 12, color: "mute" }), text(rule.source, { size: 12, color: "mute", grow: 1 })),
    rule.differs ? row({ gap: 6 }, icon("info", { size: 12, color: "name" }), text(rule.differs, { size: 12, color: "name", grow: 1 })) : null,
  );
}

const SHOP_OVERLORD = { unit: "overlord-shop", model: "opus", client: "claude", machine: "DESKTOP", job: "lead", ref: "node-overlord-shop" };

/** The Overlord on top, one connection with its rule for each kind of Executor, and the Executors below. */
function squadDiagram(sw, { selected = "", members = MEMBERS, overlord = SHOP_OVERLORD } = {}) {
  const cx = Math.round(sw / 2);
  const centers = members.map((_, i) => Math.round(cx + (i - (members.length - 1) / 2) * 290));
  return [
    draftNode(cx - 116, 56, overlord),
    ...members.flatMap((member, i) => [
      curve(cx, 160, centers[i], 288),
      curve(centers[i], 492, centers[i], 532),
      ruleCard(centers[i] - 125, 288, member, { selected: selected === member.key }),
      draftNode(centers[i] - 116, 532, { ...member, ref: `node-${member.unit.toLowerCase()}`, selected: selected === member.key }),
    ]),
    row({ gap: 8, align: "start", w: 760, place: { x: cx - 380, y: 700 } }, icon("info", { size: 14, color: "mute" }), text("A task that matches no rule returns to the Overlord. These rules apply to this squad only; a row of models.md changes only when a test changes it.", { size: 12, lh: 1.5, color: "mute", grow: 1 })),
  ];
}

const stepper = (n) =>
  row({ gap: 2, radius: 9, fill: "on", pad: 3 }, iconBtn("minus", { size: 26, label: "Remove one" }), text(String(n), { size: 13, weight: 700, color: "title", w: 26, align: "center" }), iconBtn("plus", { size: 26, label: "Add one" }));

function memberRow(member, selected) {
  const rule = RULES[member.key];
  return row(
    { h: 58, pad: [0, 12], gap: 12, radius: 12, fill: selected ? "on" : "field", stroke: selected ? "text" : "line", name: `member-${member.key}`, label: member.unit },
    avatar(member.model, 30),
    col({ grow: 1, gap: 2 }, text(member.unit, { size: 12, weight: 700, face: "mono", color: "title", lines: 1 }), text(`${member.job}, ${MODELS[member.model].name}`, { size: 12, color: "mute", lines: 1 })),
    member.count ? stepper(member.count) : text(rule.title, { size: 12, color: "soft" }),
    member.count ? null : icon("chevronRight", { size: 16, color: "mute" }),
  );
}

function squadForm({ selected = "", members = MEMBERS, project = "shop", overlord = SHOP_OVERLORD, machine = "DESKTOP", scope } = {}) {
  const executors = members.reduce((n, member) => n + (member.count ?? 1), 0);
  return col(
    { grow: 1, pad: [18, 20], gap: 12 },
    row({ gap: 8 }, iconBtn("arrowLeft", { size: 28, name: "back-overview", label: "Back to the overview" }), text("New squad", { size: 18, weight: 700, color: "title" })),
    select(scope ? "Environment" : "Project", scope ?? project, { ref: "squad-project" }),
    hair(),
    text("Overlord", { size: 14, weight: 700, color: "title" }),
    field("Unit", overlord.unit, { mono: true }),
    row({ gap: 10 }, col({ grow: 1 }, select("Model", "Opus 5.5")), col({ grow: 1 }, select("Effort", "high"))),
    row({ gap: 10 }, col({ grow: 1 }, select("Machine", machine)), col({ grow: 1 }, select("Client", "Claude Code"))),
    copy("From models.md: Seat work, Opus 5.5 at high."),
    hair(),
    row({ gap: 8 }, text(`Executors, ${executors}`, { size: 14, weight: 700, color: "title", grow: 1 }), button("Add executor", { kind: "quiet", glyph: "plus", h: 28, ref: "add-executor" })),
    ...members.map((member) => memberRow(member, selected === member.key)),
    members.some((member) => member.count) ? groupHeader(`Show the ${executors} Executors`, { open: false, h: 36, ref: "show-executors" }) : null,
    fill(),
    copy(`Starts ${executors + 1} sessions: the Overlord and ${executors} Executors.`),
    row({ gap: 8 }, button("Cancel", { kind: "quiet" }), fill(), button("Create squad", { kind: "primary", glyph: "boxes", ref: "create-squad" })),
  );
}

const squad = () =>
  windowFrame({
    mode: "overview",
    waiting: 2,
    left: squadForm(),
    leftW: 400,
    stage: (sw) => squadDiagram(sw),
  });

function ruleEditor() {
  return col(
    { grow: 1 },
    row(
      { pad: [14, 18], gap: 11 },
      avatar("sonnet", 34),
      col({ grow: 1, gap: 2 }, text("Rules for executor-shop-2", { size: 14, weight: 700, color: "title" }), text("Connection from overlord-shop", { size: 12, color: "mute" })),
      iconBtn("x", { name: "close-rules", label: "Close the rules" }),
    ),
    hair(),
    col(
      { pad: [16, 18], gap: 14 },
      select("Kind of work", "Build from an approved plan", { ref: "rule-work" }),
      select("Model", "Sonnet 5.5"),
      col({ gap: 6 }, label("Effort"), choice(["low", "medium", "high", "xhigh"], "high", { ref: "rule-effort" })),
      row({ gap: 10 }, toggle(true), col({ grow: 1, gap: 2 }, text("Use medium effort when the task allows", { size: 13, color: "text" }), copy("The Overlord names the effort in each task. Without it, high."))),
    ),
    hair(),
    col(
      { pad: [16, 18], gap: 10 },
      label("Source row in models.md"),
      facts([
        ["Work", "Build from an approved plan"],
        ["Model", "Sonnet 5.5, subagent"],
        ["Effort", "high; xhigh for hard pieces"],
        ["Status", "active, tested 2026-10-07"],
      ]),
      row({ gap: 8, align: "start" }, icon("info", { size: 14, color: "name" }), text("Medium effort is a rule of this squad and is not in the row. The row is unchanged.", { size: 12, lh: 1.5, color: "name", grow: 1 })),
    ),
    fill(),
    row({ pad: [12, 18, 16], gap: 8 }, button("Add a rule", { kind: "quiet", glyph: "plus" }), fill(), button("Done", { kind: "primary", ref: "rules-done" })),
  );
}

// Seventeen Executors: the rule is set once for a kind of Executor, and the count is a number, not a node each.
const MANY_MEMBERS = [
  { ...MEMBERS[0], count: 12, name: "executor-shop-2 to 13" },
  { ...MEMBERS[1], count: 4, name: "executor-shop-14 to 17" },
  { ...MEMBERS[2], count: 1 },
];

const squadMany = () =>
  windowFrame({
    mode: "overview",
    waiting: 2,
    left: squadForm({ members: MANY_MEMBERS }),
    leftW: 400,
    stage: (sw) => squadDiagram(sw, { members: MANY_MEMBERS }),
  });

const squadRule = () =>
  windowFrame({
    mode: "overview",
    waiting: 2,
    stage: (sw) => [...squadDiagram(sw, { selected: "sonnet" }), row({ place: { x: 14, y: 14 } }, iconBtn("panelLeft", { name: "show-form", label: "Show the form" }))],
    right: ruleEditor(),
    rightW: 380,
  });

// ---- screens: sessions -------------------------------------------------------------------------
//
// Sessions lists every running session in the chain of command: the Overseer at the root, its Adjutants,
// then each Overlord as a card with its Executors inside, then the Executors that answer to the Overseer,
// and the services last, outside the chain. Rails join each unit to the one it answers to. Inside a rank,
// what waits on the person comes first, then what is working; a card with nothing active stays closed with
// its counts, and the list shows eight cards before Show more. The same rows grouped by machine are one
// switch away. A row is a role tile, a name and a role, then the task, the machine or the lead, the client
// and the status, in fixed columns, so the middle of the list carries the task instead of empty space.

const ROW_H = 50;
const INDENT = 28;
const COLS = { unit: 340, third: 140, client: 104, status: 132 };
const ORDER = { waiting: 0, working: 1, done: 2, idle: 3, out: 4, silent: 5 };
const RANK = { overseer: 0, adjutant: 1, overlord: 2, executor: 3, incubator: 4 };
const PER_CARD = 6;
const CARDS_SHOWN = 8;
const OPEN_CARDS = 3;

/** One session as the lists draw it, from the data of its unit. */
function sessionOf(unit, U) {
  const u = U(unit);
  return { unit, client: u.client, model: u.model, machine: u.machine, lead: u.lead, job: u.job, kind: SESSION[unit]?.done ? "done" : u.status, why: u.why ?? SESSION[unit]?.why ?? "No open task" };
}

const byKind = (sessions) => {
  const counts = {};
  for (const s of sessions) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  return counts;
};
const byStatus = (a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9) || a.unit.localeCompare(b.unit);

// The x of each column, for a list of width w. The unit column is fixed, the task takes the rest.
const columnsX = (w) => {
  const third = w - COLS.third - COLS.client - COLS.status;
  return { task: COLS.unit, taskW: third - COLS.unit - 16, third, client: third + COLS.third, status: third + COLS.third + COLS.client };
};

const tileOf = (glyph, { dashed = false } = {}) =>
  stack({ w: 28, h: 28, radius: 7, fill: dashed ? undefined : "field", stroke: dashed ? "mute" : "line", dash: dashed ? "3 3" : undefined }, icon(glyph, { size: 14, color: "soft", place: "center" }));

/** One session: its role tile, name and role, then its task, its machine or its lead, its client and its status. */
function sessionRow(s, w, { level = 0, selected = false, query = "", third = "machine", sub, chevron, summary } = {}) {
  const x = 12 + level * INDENT;
  const c = columnsX(w);
  const role = roleOf(s.unit);
  const pick = level ? x - 8 : 0;
  const lead = s.unit === "overseer" ? text("You", { size: 12, color: "soft" }) : ident(s.lead ?? "overseer", { size: 12, lines: 1 });
  return stack(
    { w, h: ROW_H, name: `session-${s.unit}`, label: s.unit },
    selected ? box({ w: w - pick - (level ? 6 : 0), h: ROW_H - 4, radius: 10, fill: "on", stroke: EDGE, place: { x: pick, y: 2 } }) : null,
    row(
      { w: COLS.unit - x - 12, h: ROW_H, gap: 10, place: { x, y: 0 } },
      roleTile(role, 28),
      col({ grow: 1, gap: 2 }, highlight(s.unit, query, { size: 13, weight: 700, face: "mono", color: "title", lines: 1 }), text(sub ?? (s.job ? `${ROLES[role].name}, ${s.job}` : ROLES[role].name), { size: 12, color: "mute", lines: 1 })),
      chevron ? icon(chevron, { size: 14, color: "mute" }) : null,
    ),
    row({ w: c.taskW, h: ROW_H, place: { x: c.task, y: 0 } }, summary ?? highlight(s.why, query, { size: 13, color: "soft", lines: 1, grow: 1 })),
    row({ w: COLS.third - 12, h: ROW_H, place: { x: c.third, y: 0 } }, third === "machine" ? machineMark(s.machine, { size: 12, color: "soft" }) : lead),
    row({ w: COLS.client, h: ROW_H, place: { x: c.client, y: 0 } }, highlight(CLIENTS[s.client], query, { size: 12, color: "soft" })),
    row({ w: COLS.status, h: ROW_H, place: { x: c.status, y: 0 } }, statusMark(s.kind)),
  );
}

/** A row that heads a group but is no session: the Executors with no Overlord, or a machine. */
function headRow(title, sub, w, { level = 0, tile, chevron, summary, ref } = {}) {
  const x = 12 + level * INDENT;
  return stack(
    { w, h: ROW_H, name: ref, label: title },
    row({ w: COLS.unit - x - 12, h: ROW_H, gap: 10, place: { x, y: 0 } }, tile, col({ grow: 1, gap: 2 }, text(title, { size: 13, weight: 700, color: "title", lines: 1 }), text(sub, { size: 12, color: "mute", lines: 1 })), chevron ? icon(chevron, { size: 14, color: "mute" }) : null),
    summary ? row({ w: columnsX(w).taskW, h: ROW_H, place: { x: COLS.unit, y: 0 } }, summary) : null,
  );
}

const columnHeader = (w, third) => {
  const c = columnsX(w);
  const head = (value, x) => text(value, { size: 12, weight: 700, color: "mute", place: { x, y: 8 } });
  return stack({ w, h: 30, name: "column-header", label: "Columns" }, head("Unit", 12), head("Task", c.task), head(third === "machine" ? "Machine" : "Reports to", c.third), head("Client", c.client), head("Status", c.status));
};

/**
 * The chain of command as rows: positions, the cards behind each Overlord and its Executors, and the rails
 * that join each unit to the one it answers to.
 */
function teamItems(team, U, w, { query = "", selected = "" } = {}) {
  const q = query.trim().toLowerCase();
  const hit = (s) => q === "" || [s.unit, CLIENTS[s.client], s.machine, s.why].some((v) => v.toLowerCase().includes(q));
  const S = (unit) => sessionOf(unit, U);
  const items = [];
  const lines = [];
  const cards = [];
  let y = 0;
  const put = (h, node) => {
    items.push({ y, h, node });
    y += h;
    return y - h / 2;
  };
  const rail = (level) => 12 + level * INDENT + 14;
  const branch = (level, mids, from) => {
    if (!mids.length) return;
    lines.push(vline(rail(level), from, mids[mids.length - 1] - from));
    for (const mid of mids) lines.push(hline(rail(level), mid, INDENT - 14));
  };
  const more = (n, noun, level, ref, summary) =>
    stack({ w, h: 40, name: ref, label: `Show ${n} more` }, row({ h: 40, gap: 8, place: { x: 12 + level * INDENT + 7, y: 0 } }, icon("plus", { size: 12, color: "soft" }), text(`Show ${plural(n, noun)}`, { size: 12, weight: 700, color: "soft" })), summary ? row({ h: 40, place: { x: COLS.unit, y: 0 } }, summary) : null);
  let opened = 0;
  // A small mind opens every card: closing the only few units it has would hide the whole team.
  const few = [team.overseer, ...team.adjutants, ...team.groups.flatMap((g) => [g.lead, ...g.members]).filter(Boolean)].length <= 12;
  const card = (head, members, { open, perCard = PER_CARD, ref }) => {
    y += 8;
    const top = y;
    const mid = put(ROW_H, head(open));
    if (open) {
      const mids = members.slice(0, perCard).map((s) => put(ROW_H, sessionRow(s, w, { level: 2, selected: selected === s.unit, query })));
      if (members.length > perCard) mids.push(put(40, more(members.length - perCard, "more Executor", 2, `more-${ref}`)));
      branch(1, mids, mid + 14);
    }
    cards.push({ x: 12 + INDENT - 6, y: top, h: y - top });
    y += 8;
    return mid;
  };

  const root = S(team.overseer);
  const rootMid = put(ROW_H, sessionRow(root, w, { selected: selected === root.unit, query, sub: "Overseer of the mind" }));
  const children = [];

  const adjutants = team.adjutants.map(S).filter(hit).sort(byStatus);
  adjutants.slice(0, 3).forEach((s) => children.push(put(ROW_H, sessionRow(s, w, { level: 1, selected: selected === s.unit, query }))));
  if (adjutants.length > 3) children.push(put(40, more(adjutants.length - 3, "more Adjutant", 1, "more-adjutants")));

  const groups = columnsOf(team)
    .filter((c) => c.lead)
    .map((c) => {
      const lead = S(c.lead);
      const all = c.members.map(S);
      const members = (q ? all.filter(hit) : all).sort(byStatus);
      return { c, lead, all, members, counts: byKind([lead, ...all]), match: hit(lead) || members.length > 0 };
    })
    .filter((g) => g.match)
    .sort((a, b) => attention(b.counts) - attention(a.counts));
  for (const g of groups.slice(0, CARDS_SHOWN)) {
    const active = attention(g.counts) > 0;
    const open = q ? g.members.length > 0 : few || (active && opened < OPEN_CARDS);
    if (open) opened += 1;
    children.push(
      card(
        (isOpen) =>
          sessionRow(g.lead, w, {
            level: 1,
            selected: selected === g.lead.unit,
            query,
            sub: `Overlord of ${g.c.id}, ${plural(g.all.length, "Executor")}`,
            chevron: isOpen ? "chevronDown" : "chevronRight",
            summary: isOpen ? undefined : rollup(byKind(g.all), { quiet: true }),
          }),
        g.members,
        { open, ref: g.c.id },
      ),
    );
  }
  if (groups.length > CARDS_SHOWN) {
    const rest = groups.slice(CARDS_SHOWN);
    children.push(put(40, more(rest.length, "more Overlord", 1, "more-overlords", rollup(byKind(rest.flatMap((g) => [g.lead, ...g.all])), { quiet: true }))));
  }

  const direct = columnsOf(team).filter((c) => !c.lead).flatMap((c) => c.members).map(S);
  const directShown = (q ? direct.filter(hit) : direct).sort(byStatus);
  if (directShown.length) {
    const counts = byKind(direct);
    const open = q ? true : few || (attention(counts) > 0 && opened < OPEN_CARDS);
    if (open) opened += 1;
    children.push(
      card(
        (isOpen) =>
          headRow("Without an Overlord", `${plural(direct.length, "Executor")}, answering to the Overseer`, w, {
            level: 1,
            tile: tileOf("users", { dashed: true }),
            chevron: isOpen ? "chevronDown" : "chevronRight",
            summary: isOpen ? null : rollup(counts, { quiet: true }),
            ref: "group-direct",
          }),
        directShown,
        { open, ref: "direct" },
      ),
    );
  }
  branch(0, children, rootMid + 14);

  const services = team.services.map(S).filter(hit);
  if (services.length) {
    y += 12;
    put(30, row({ h: 30, pad: [0, 12] }, text("Services, outside the chain", { size: 12, weight: 700, color: "mute" })));
    services.forEach((s) => put(ROW_H, sessionRow(s, w, { selected: selected === s.unit, query })));
  }
  return { items, lines, cards, total: y };
}

// ---- the same sessions by machine
//
// A machine is `{ name, up, since?, local?, sessions }`. The list is one card per machine. Machines with
// something working or waiting come first and open, as far as about twenty rows; idle machines and machines
// out of reach follow, closed, each with its counts. Inside a machine the rows keep the order of rank, and
// the third column says whom each one reports to. A card shows eight sessions and opens the rest on request.

const RUNNING = {
  DESKTOP: ["overseer", "overlord-web", "executor-shop", "executor-blog", "builder-codex", "builder-cursor", "executor-data", "executor-site"],
  LAPTOP: ["adjutant", "overlord-api", "builder-codex-2", "executor-docs", "executor-mobile", "incubator"],
};

const REAL_MACHINES = [
  { name: "DESKTOP", up: true, sessions: RUNNING.DESKTOP.map((unit) => sessionOf(unit, (u) => UNITS[u])) },
  { name: "LAPTOP", up: true, local: true, sessions: RUNNING.LAPTOP.map((unit) => sessionOf(unit, (u) => UNITS[u])) },
];

const PROJECTS = ["Atlas", "Borealis", "Cinder", "Delta", "Ember", "Fjord", "Garnet", "Halo", "Iris", "Juno", "Kestrel", "Lumen"];
const AREAS = ["web", "api", "app", "docs", "data"];

const MODEL_OF = { claude: ["opus", "sonnet", "none"], codex: ["gpt"], cursor: ["grok"], opencode: ["none"] };

/** `count` machines: the two of the sample, then generated ones, so a list can be drawn at any size. */
function fleet(count) {
  let seed = 11;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const machines = REAL_MACHINES.slice(0, Math.min(count, 2));
  for (let i = machines.length; i < count; i += 1) {
    const up = rand() > 0.14;
    const name = `NODE-${String(i - 1).padStart(3, "0")}`;
    const sessions = [];
    const n = Math.floor(rand() * rand() * 14);
    for (let k = 0; k < n; k += 1) {
      const client = ["claude", "claude", "codex", "cursor", "opencode"][Math.floor(rand() * 5)];
      const models = MODEL_OF[client];
      const r = rand();
      sessions.push({
        unit: `executor-${PROJECTS[(i + k) % PROJECTS.length]}-${i}`,
        client,
        model: models[Math.floor(rand() * models.length)],
        machine: name,
        kind: up ? (r < 0.04 ? "waiting" : r < 0.35 ? "working" : "idle") : "silent",
        why: `Task ${100 + Math.floor(rand() * 400)}`,
      });
    }
    machines.push({ name, up, since: `0${1 + Math.floor(rand() * 8)}:${["05", "18", "27", "41", "52"][Math.floor(rand() * 5)]}`, sessions });
  }
  return machines;
}

/**
 * The chain of command of a fleet: each generated session joins the Overlord of its project and area, the
 * first of each becoming that Overlord; every ninth answers to the Overseer, and two serve as Adjutants. The
 * units of the sample keep their places.
 */
function bigTeam(machines) {
  const data = { ...UNITS };
  const groups = new Map();
  const direct = columnsOf(TEAM).filter((c) => !c.lead).flatMap((c) => c.members);
  const adjutants = [...TEAM.adjutants];
  let n = 0;
  machines.forEach((m, i) =>
    m.sessions.forEach((s, k) => {
      if (i < 2) return;
      n += 1;
      const id = `${PROJECTS[(i + k) % PROJECTS.length]}-${AREAS[i % AREAS.length]}`;
      const record = () => (data[s.unit] = { machine: m.name, client: s.client, model: s.model, status: s.kind, why: s.why, lead: s.lead, wake: true });
      if (n === 40 || n === 300) {
        s.unit = `adjutant-${adjutants.length + 1}`;
        adjutants.push(s.unit);
      } else if (n % 9 === 0) {
        direct.push(s.unit);
      } else if (groups.has(id)) {
        s.lead = groups.get(id).lead;
        groups.get(id).members.push(s.unit);
      } else {
        s.unit = `overlord-${id}`;
        s.client = "claude";
        s.model = "opus";
        groups.set(id, { id, kind: "Project", lead: s.unit, members: [] });
      }
      record();
    }),
  );
  return { team: { overseer: "overseer", adjutants, services: ["incubator"], groups: [...TEAM.groups.filter((g) => g.lead), ...groups.values(), { id: "direct", members: direct }] }, data };
}

const RANK_WORD = ["Active now", "Idle", "Out of reach"];
const OPEN_BUDGET = 20;
const PER_MACHINE = 8;

/** The machines of the list, in order, with the sessions each one shows and whether it is open. */
function plan(machines, query) {
  const q = query.trim().toLowerCase();
  const hit = (s) => [s.unit, CLIENTS[s.client], MODELS[s.model].name, s.why ?? ""].some((value) => value.toLowerCase().includes(q));
  const groups = [];
  for (const m of machines) {
    const named = q !== "" && m.name.toLowerCase().includes(q);
    const rows = q === "" || named ? m.sessions : m.sessions.filter(hit);
    if (q !== "" && !named && rows.length === 0) continue;
    const counts = byKind(m.sessions);
    const waiting = counts.waiting ?? 0;
    const working = counts.working ?? 0;
    const sorted = [...rows].sort((a, b) => RANK[roleOf(a.unit)] - RANK[roleOf(b.unit)] || byStatus(a, b));
    groups.push({ m, rows: sorted, rank: !m.up ? 2 : waiting + working > 0 ? 0 : 1, waiting, working });
  }
  groups.sort((a, b) => a.rank - b.rank || b.waiting - a.waiting || b.working - a.working || a.m.name.localeCompare(b.m.name));
  let used = 0;
  for (const g of groups) {
    const shown = Math.min(g.rows.length, PER_MACHINE);
    g.open = (g.rank === 0 || q !== "") && shown > 0 && (used === 0 || used + shown <= OPEN_BUDGET);
    if (g.open) used += shown;
  }
  return groups;
}

function machineSummary(g, query) {
  const n = g.m.sessions.length;
  if (!g.m.up) return statusMark("silent", { word: `Out of reach since ${g.m.since}` });
  return row(
    { gap: 14 },
    g.waiting ? statusMark("waiting", { word: `${g.waiting} waiting` }) : null,
    g.working ? statusMark("working", { word: `${g.working} working` }) : null,
    !g.waiting && !g.working ? text(n ? "All idle" : "No sessions", { size: 12, color: "soft" }) : null,
    query ? text(`${g.rows.length} of ${n} match`, { size: 12, color: "mute" }) : null,
  );
}

/** The rows of the machine list, with their positions and the card behind each machine. */
function machineItems(groups, w, { query, selected }) {
  const items = [];
  const cards = [];
  const counts = [0, 0, 0];
  for (const g of groups) counts[g.rank] += 1;
  const sectioned = counts.filter(Boolean).length > 1;
  let y = 0;
  let rank = -1;
  for (const g of groups) {
    if (sectioned && g.rank !== rank) {
      rank = g.rank;
      const title = `${RANK_WORD[rank]}, ${plural(counts[rank], "machine")}`;
      items.push({ y, h: 38, section: rank, node: row({ h: 38, pad: [0, 12] }, text(title, { size: 12, weight: 700, color: "mute" })) });
      y += 38;
    }
    const m = g.m;
    const top = y;
    items.push({
      y,
      h: ROW_H,
      node: headRow(m.name, m.local ? `This window, ${plural(m.sessions.length, "session")}` : plural(m.sessions.length, "session"), w, { tile: tileOf(MACHINE_GLYPH), chevron: g.open ? "chevronDown" : "chevronRight", summary: machineSummary(g, query), ref: `group-${m.name}` }),
    });
    y += ROW_H;
    if (g.open) {
      for (const s of g.rows.slice(0, PER_MACHINE)) {
        items.push({ y, h: ROW_H, node: sessionRow(s, w, { level: 1, third: "lead", selected: s.unit === selected, query }) });
        y += ROW_H;
      }
      if (g.rows.length > PER_MACHINE) {
        items.push({ y, h: 40, node: moreRow(`Show ${plural(g.rows.length - PER_MACHINE, "more session")}`, { ref: `more-${m.name}`, indent: 12 + INDENT + 7 }) });
        y += 40;
      }
    }
    cards.push({ y: top, h: y - top });
    y += 8;
  }
  return { items, cards, total: y };
}

const noResults = (query) =>
  col(
    { w: 520, gap: 10, pad: [20, 12], place: { x: 0, y: 0 }, name: "no-results", label: "No results" },
    text(`No session matches "${query}"`, { size: 16, weight: 700, color: "title" }),
    text("The search covers units, machines, clients and tasks.", { size: 13, color: "soft" }),
    row({}, button("Clear search", { ref: "clear-search" })),
  );

/** A list as a window onto its rows: `top` is how far it has scrolled. Only what is in view is drawn. */
function listWindow({ x, y, w, h, items, cards = [], lines = [], total, top = 0, empty, pinned }) {
  const at = Math.min(top, Math.max(0, total - h));
  const shift = (node, dy) => ({ ...node, place: { ...(node.place ?? { x: 0 }), y: (node.place?.y ?? 0) - dy } });
  const thumb = Math.max(28, Math.round((h * h) / Math.max(total, 1)));
  return stack(
    { w, h, place: { x, y }, clip: true, name: "session-list", label: "Sessions" },
    empty ?? null,
    ...cards.filter((c) => c.y + c.h > at && c.y < at + h).map((c) => box({ w: w - 14 - (c.x ?? 0), h: c.h, radius: 12, fill: "panel", stroke: "line", place: { x: c.x ?? 0, y: c.y - at } })),
    ...items.filter((item) => item.y + item.h > at && item.y < at + h).map((item) => col({ w: w - 14, h: item.h, place: { x: 0, y: item.y - at } }, item.node)),
    ...lines.map((line) => shift(line, at)),
    pinned ? col({ w: w - 14, h: pinned.h + 1, fill: "canvas", place: { x: 0, y: 0 } }, pinned.node, hair()) : null,
    ...(total > h ? scrollbar(w - 6, 0, h, thumb, Math.round(((h - thumb) * at) / (total - h))) : []),
  );
}

const sessionsStage = ({ view, team, data, machines, query, selected, offset }) => (sw, sh) => {
  const w = sw - 48;
  const U = (unit) => data[unit] ?? UNITS[unit];
  const listY = 158;
  const listH = sh - listY - 12;
  let list;
  let summary;
  let result;
  if (view === "team") {
    const all = [team.overseer, ...team.adjutants, ...team.groups.flatMap((g) => [g.lead, ...g.members]).filter(Boolean), ...team.services];
    const out = all.filter((unit) => U(unit).status === "silent").length;
    summary = `${plural(all.length, "session")}${out ? `, ${out.toLocaleString("en-US")} out of reach` : ""}`;
    const built = teamItems(team, U, w - 14, { query, selected });
    const found = query ? all.filter((unit) => [unit, CLIENTS[U(unit).client], U(unit).machine, SESSION[unit]?.why ?? U(unit).why ?? ""].some((v) => v.toLowerCase().includes(query.toLowerCase()))).length : 0;
    result = query ? (found ? `${plural(found, "session")} match` : "No matches") : undefined;
    list = listWindow({ x: 24, y: listY, w, h: listH, items: built.items, cards: built.cards, lines: built.lines, total: built.total, empty: found === 0 && query ? noResults(query) : null });
  } else {
    const down = machines.filter((m) => !m.up).length;
    const running = machines.reduce((n, m) => n + m.sessions.length, 0);
    summary = `${plural(running, "session")} on ${plural(machines.length, "machine")}${down ? `, ${down.toLocaleString("en-US")} out of reach` : ""}`;
    const groups = plan(machines, query);
    const built = machineItems(groups, w - 14, { query, selected });
    const top = typeof offset === "number" ? offset : Math.max(0, built.items.find((item) => item.section === offset.section).y - offset.before);
    const pinned = built.items.filter((item) => item.section !== undefined && item.y < top).pop();
    const found = groups.reduce((n, g) => n + g.rows.length, 0);
    result = query ? (found ? `${plural(found, "session")} on ${plural(groups.length, "machine")}` : "No matches") : undefined;
    list = listWindow({ x: 24, y: listY, w, h: listH, items: built.items, cards: built.cards, total: built.total, top, pinned, empty: groups.length === 0 ? noResults(query) : null });
  }
  return [
    col(
      { w, place: { x: 24, y: 22 }, gap: 14 },
      row({ gap: 12 }, text("Sessions", { size: 20, weight: 700, color: "title" }), text(summary, { size: 13, color: "mute" }), fill(), choice(["Team", "Machines"], view === "team" ? "Team" : "Machines", { ref: "sessions-view" }), button("Open session", { glyph: "plus", ref: "open-session" })),
      searchField(query, { placeholder: "Search units, machines, clients and tasks", ref: "session-search", result }),
    ),
    col({ w: w - 14, place: { x: 24, y: 124 } }, columnHeader(w - 14, view === "team" ? "machine" : "lead"), hair()),
    list,
  ];
};

/** The form to open a session. Up to three machines are a choice; more are a select with a search. */
function openForm({ many = false } = {}) {
  return col(
    { grow: 1 },
    row({ pad: [16, 18, 12], gap: 8 }, text("Open session", { size: 15, weight: 700, color: "title", grow: 1 }), iconBtn("x", { name: "close-open", label: "Close the form" })),
    hair(),
    col(
      { grow: 1, pad: [16, 18], gap: 14 },
      select("Unit", "executor-shop", { mono: true, ref: "open-unit" }),
      select("Task", "Task 030", { ref: "open-task" }),
      col({ gap: 6 }, label("Client"), choice(["Claude Code", "Codex", "Cursor", "OpenCode"], "Claude Code", { ref: "open-client" })),
      many
        ? select("Machine", "LAPTOP (this window)", { ref: "open-machine-select" })
        : col({ gap: 6 }, label("Machine"), choice(["DESKTOP", "LAPTOP"], "DESKTOP", { ref: "open-machine", stretch: true, marks: { DESKTOP: dot("add", 7), LAPTOP: dot("add", 7) } })),
      row({ gap: 10 }, col({ grow: 1 }, select("Model", "Sonnet 5.5")), col({ grow: 1 }, select("Effort", "high"))),
      copy("Source: models.md, build from an approved plan."),
      row({ gap: 10, h: 28 }, toggle(true), text("Enable wake for 4 hours", { size: 13, color: "text" })),
      fill(),
      button(many ? "Open on LAPTOP" : "Open on DESKTOP", { kind: "primary", glyph: "squareTerminal", ref: "open-session-go" }),
    ),
  );
}

/** The machine select, open: a search, then machines with something running first. */
function machinePicker(machines, at) {
  const groups = plan(machines, "");
  const counts = [0, 0, 0];
  for (const g of groups) counts[g.rank] += 1;
  const shown = groups.slice(0, 8);
  return col(
    { w: at.w, pad: 8, gap: 2, radius: 14, fill: "panel", stroke: EDGE, place: { x: at.x, y: at.y + at.h + 4 }, name: "machine-picker", label: "Machines" },
    searchField("", { placeholder: "Search machines", ref: "machine-search" }),
    row({ h: 34, pad: [0, 10] }, text(`${RANK_WORD[0]}, ${plural(counts[0], "machine")}`, { size: 12, weight: 700, color: "mute" })),
    ...shown.map((g) =>
      row(
        { h: 34, pad: [0, 10], gap: 8, radius: 8, fill: g.m.local ? "on" : undefined },
        icon(MACHINE_GLYPH, { size: 14, color: "mute" }),
        text(g.m.local ? `${g.m.name} (this window)` : g.m.name, { size: 13, color: "text", grow: 1 }),
        g.waiting ? statusMark("waiting", { word: String(g.waiting) }) : null,
        text(`${g.working} working`, { size: 12, color: "mute" }),
      ),
    ),
    moreRow(`Show ${plural(machines.length - shown.length, "more machine")}`, { ref: "more-machines", indent: 10 }),
  );
}

const FLEET = fleet(500);
const BIG = bigTeam(FLEET);
const FLEET_DOWN = FLEET.filter((m) => !m.up).length;
const FLEET_WAITING = FLEET.reduce((n, m) => n + (m.up ? m.sessions.filter((s) => s.kind === "waiting").length : 0), 0);
const FLEET_FRAME_BAR = {
  waiting: FLEET_WAITING,
  fleet: { total: FLEET.length, out: FLEET_DOWN },
  foot: { read: "Mind read 12 s ago", newest: `Newest record: NODE-017 09:12. ${plural(FLEET_DOWN, "machine")} out of reach.`, warn: true },
};

/** The first unit that waits on the person in the busiest card: what a person opens first in a long list. */
const firstWaiting = ({ team, data }) => {
  const U = (unit) => data[unit] ?? UNITS[unit];
  const busiest = columnsOf(team).filter((c) => c.lead).sort((a, b) => attention(countsOf(b, U, () => false)) - attention(countsOf(a, U, () => false)))[0];
  return [busiest.lead, ...busiest.members].find((unit) => U(unit).status === "waiting") ?? busiest.lead;
};

const sessionsFrame = ({ view = "team", team = TEAM, data = {}, machines = REAL_MACHINES, query = "", selected = "executor-blog", offset = 0, right, overlay, waiting = 2, fleetBar, foot, barMachines }) =>
  windowFrame({
    mode: "sessions",
    waiting,
    machines: barMachines,
    fleet: fleetBar,
    foot,
    stage: sessionsStage({ view, team, data, machines, query, selected, offset }),
    right: right ?? (selected ? unitPanel(selected, { data, manage: true }) : null),
    rightW: PANEL_W,
    overlay,
  });

const BIG_FRAME = { team: BIG.team, data: BIG.data, waiting: FLEET_FRAME_BAR.waiting, fleetBar: FLEET_FRAME_BAR.fleet, foot: FLEET_FRAME_BAR.foot };

// One machine: the whole mind runs on LAPTOP.
const ONE_TEAM = { overseer: "overseer", adjutants: ["adjutant"], services: [], groups: [{ id: "mobile", kind: "Project", members: ["executor-mobile"] }] };
const ONE_DATA = { overseer: { ...UNITS.overseer, machine: "LAPTOP" }, adjutant: UNITS.adjutant, "executor-mobile": UNITS["executor-mobile"] };

const sessions = () => sessionsFrame({});
const sessionsMachines = () => sessionsFrame({ view: "machines" });
const sessionsOne = () => sessionsFrame({ team: ONE_TEAM, data: ONE_DATA, barMachines: ["LAPTOP"], waiting: 0, selected: "adjutant" });
const sessionsMany = () => sessionsFrame({ ...BIG_FRAME, selected: firstWaiting(BIG) });
const sessionsMachinesMany = () => sessionsFrame({ view: "machines", machines: FLEET, waiting: FLEET_FRAME_BAR.waiting, fleetBar: FLEET_FRAME_BAR.fleet, foot: FLEET_FRAME_BAR.foot, offset: { section: 1, before: 330 }, selected: "" });
const sessionsSearch = () => sessionsFrame({ ...BIG_FRAME, query: "codex", selected: "executor-Garnet-25" });
const sessionsNone = () => sessionsFrame({ ...BIG_FRAME, query: "zeta", selected: "" });
const sessionOpen = () => sessionsFrame({ selected: "", right: openForm() });

function sessionOpenMany() {
  const window = sessionsFrame({ ...BIG_FRAME, selected: "", right: openForm({ many: true }) });
  const at = locate(window, W, "open-machine-select", H);
  return stack({ w: W, h: H }, window, machinePicker(FLEET, at));
}

function dialog(title, kids, { w = 540 } = {}) {
  return stack(
    { w: W, h: H, place: { x: 0, y: 0 } },
    box({ w: W, h: H, fill: "overlay", place: { x: 0, y: 0 } }),
    col({ w, pad: 24, gap: 14, radius: 20, fill: "panel", stroke: EDGE, place: { x: Math.round((W - w) / 2), y: 200 }, name: "dialog", label: title }, text(title, { size: 18, weight: 700, color: "title" }), ...kids),
  );
}

const listing = (title, rows) =>
  col({ gap: 6, grow: 1 }, label(title), ...rows.map(([glyph, value, tone]) => row({ gap: 8, align: "start" }, icon(glyph, { size: 14, color: tone ?? "soft" }), text(value, { size: 13, lh: 1.4, color: "text", grow: 1 }))));

const sessionClear = () =>
  sessionsFrame({
    selected: "executor-blog",
    overlay: dialog("Clear the context of executor-blog?", [
      text("The session restarts from the recorded state of the unit. The conversation is discarded.", { size: 13, lh: 1.5, color: "soft" }),
      row(
        { gap: 20, align: "start" },
        listing("Kept", [["fileText", "State written 2026-10-08 22:35"], ["circleCheck", "Task 005, merged", "add"], ["inbox", "Inbox, 0 unread"]]),
        listing("Discarded", [["messagesSquare", "The open conversation"]]),
      ),
      row({ gap: 10, align: "start" }, check(true), col({ grow: 1, gap: 2 }, text("Write the state before clearing", { size: 13, color: "text" }), copy("The session records its progress. Nothing is committed or pushed."))),
      row({ gap: 8, pad: [6, 0, 0] }, fill(), button("Cancel", { kind: "quiet", ref: "cancel-clear" }), button("Clear context", { kind: "primary", glyph: "rotateCcw", ref: "confirm-clear" })),
    ]),
  });

const sessionEnd = () =>
  sessionsFrame({
    selected: "executor-blog",
    overlay: dialog("End executor-blog?", [
      text("Ending runs the exit of /relay in the session. It commits and pushes uncommitted changes, writes the state, releases the claims and closes the session.", { size: 13, lh: 1.5, color: "soft" }),
      col(
        { gap: 8, pad: [12, 14], radius: 10, fill: "field" },
        label("Uncommitted on master"),
        ident("?? AGENTS.md", { size: 13 }),
        copy("The state records this file as not belonging to the unit. master is the default branch, so the exit uses a new branch."),
      ),
      row({ gap: 8, pad: [6, 0, 0] }, button("Close without exit", { kind: "danger", ref: "close-without-exit" }), fill(), button("Cancel", { kind: "quiet", ref: "cancel-end" }), button("End session", { kind: "primary", glyph: "circleStop", ref: "confirm-end" })),
      copy("Close without exit stops the process and writes nothing."),
    ]),
  });

// ---- screens: relay -------------------------------------------------------------------------------

// The conversations of the person: one per unit, and one per thread. The status next to a unit is its wake
// and its unread count; everything else is one step away.
const CONVERSATIONS = [
  { unit: "executor-shop", preview: "Merged main into the branch. The checks pass.", time: "09:02", unread: 2 },
  { unit: "overlord-web", preview: "Task 029 is ready for review.", time: "08:50", unread: 1 },
  { thread: "rules", subject: "Where are the rules of a squad connection stored?", people: "overlord-api", time: "08:41", waiting: true },
  { unit: "executor-site", preview: "You: Resume task 011 when the quota resets.", time: "06:12" },
  { unit: "overseer", preview: "The release order is confirmed.", time: "Yesterday" },
  { unit: "builder-codex-2", preview: "Task 024 is complete.", time: "Yesterday" },
];

const conversationKey = (c) => c.unit ?? `thread-${c.thread}`;

function conversationRow(c, selected) {
  const lead = c.unit
    ? roleTile(roleOf(c.unit), 32)
    : stack({ w: 32, h: 32, radius: "pill", fill: "field", stroke: "mute" }, icon("messagesSquare", { size: 15, color: "soft", place: "center" }));
  const name = c.unit ? text(c.unit, { size: 12, weight: 700, face: "mono", color: "title", lines: 1, grow: 1 }) : text(c.subject, { size: 13, weight: 700, color: "title", lines: 1, grow: 1 });
  const second = c.unit ? c.preview : c.people;
  return row(
    { h: 60, pad: [0, 12], gap: 10, radius: 10, fill: selected ? "on" : undefined, stroke: selected ? EDGE : undefined, name: `relay-${conversationKey(c)}`, label: c.unit ?? c.subject },
    lead,
    col(
      { grow: 1, gap: 4 },
      row({ gap: 8 }, name, text(c.time, { size: 12, color: "mute" })),
      row(
        { gap: 8 },
        text(second, { size: 12, color: "mute", lines: 1, grow: 1 }),
        c.unit ? icon(unitInfo(c.unit).wake ? "bell" : "bellOff", { size: 12, color: unitInfo(c.unit).wake ? "name" : "mute" }) : null,
        c.waiting ? statusMark("waiting", { word: "" }) : null,
        c.unread ? text(String(c.unread), { size: 12, weight: 700, color: "title", w: 14, align: "right" }) : null,
      ),
    ),
  );
}

function conversationList(selected) {
  return col(
    { grow: 1, pad: [16, 12], gap: 10 },
    row({ gap: 8, pad: [0, 6] }, text("Conversations", { size: 15, weight: 700, color: "title", grow: 1 }), button("New message", { kind: "quiet", glyph: "plus", h: 28, ref: "new-message" })),
    choice(["All", "Units", "Threads"], "All", { ref: "relay-filter" }),
    col({ gap: 2 }, ...CONVERSATIONS.map((c) => conversationRow(c, conversationKey(c) === selected))),
  );
}

const wakeStatus = (on) =>
  row(
    { h: 30, pad: [0, 10], gap: 6, radius: 8, fill: "field", stroke: EDGE, name: "wake-status", label: "Wake" },
    icon(on ? "bell" : "bellOff", { size: 13, color: on ? "name" : "mute" }),
    text(on ? "Wake on" : "Wake off", { size: 12, color: on ? "name" : "mute" }),
    icon("chevronDown", { size: 12, color: "soft" }),
  );

const unitInfo = (unit) => CASE[unit] ?? UNITS[unit];

const unitHeader = (unit) => {
  const u = unitInfo(unit);
  return row(
    { h: 68, pad: [0, 24], gap: 12 },
    roleTile(roleOf(unit), 36),
    col({ grow: 1, gap: 3 }, text(unit, { size: 16, weight: 700, face: "mono", color: "title" }), row({ gap: 14 }, machineMark(u.machine), text(CLIENTS[u.client], { size: 12, color: "soft" }), statusMark(u.status))),
    wakeStatus(u.wake),
  );
};

const message = ({ mine = false, who, to, time, body, files = [], note }) =>
  row(
    { justify: mine ? "end" : "start" },
    col(
      { w: 560, gap: 4, align: mine ? "end" : "start" },
      row({ gap: 8 }, mine ? text("You", { size: 12, weight: 700, color: "title" }) : ident(who, { size: 12 }), to ? copy(`to ${to}`) : null, text(time, { size: 12, color: "mute" })),
      col(
        { pad: [10, 14], gap: 6, radius: 12, fill: mine ? "on" : "field" },
        text(body, { size: 13, lh: 1.5, color: "text" }),
        ...files.map((file) => row({ gap: 6 }, icon("paperclip", { size: 13, color: "mute" }), ident(file, { size: 12 }))),
      ),
      note ?? null,
    ),
  );

const divider = (value) => text(value, { size: 12, color: "mute", align: "center" });

const chatComposer = (placeholder, wake) =>
  col(
    { pad: [12, 24, 16], gap: 10 },
    row(
      { h: 46, pad: [0, 8, 0, 14], gap: 8, radius: 12, fill: "field", stroke: EDGE, name: "chat-composer", label: "Message" },
      text(placeholder, { size: 13, color: "mute", grow: 1 }),
      button("Send", { kind: "primary", glyph: "send", h: 30, ref: "send-message" }),
    ),
    row(
      { gap: 18 },
      row({ gap: 6, h: 24 }, check(false), text("Urgent", { size: 12, color: "soft" })),
      row({ gap: 6, h: 24 }, check(false), text("Ask for a reply", { size: 12, color: "soft" })),
      fill(),
      row({ gap: 6 }, icon(wake ? "bell" : "bellOff", { size: 12, color: wake ? "name" : "mute" }), text(wake ? "Wake on: the session is notified" : "Wake off: the message waits in the inbox", { size: 12, color: wake ? "name" : "mute" })),
    ),
  );

const chatStage = (header, messages, composer) => (sw, sh) => [
  col({ w: sw, h: sh, place: { x: 0, y: 0 } }, header, hair(), col({ grow: 1, pad: [18, 24], gap: 14 }, ...messages), hair(), composer),
];

const relay = () =>
  windowFrame({
    mode: "relay",
    waiting: 2,
    left: conversationList("executor-shop"),
    leftW: 320,
    stage: chatStage(
      unitHeader("executor-shop"),
      [
        divider("Yesterday"),
        message({ mine: true, time: "21:30", body: "Start task 029 on feat/029-ask. Keep the ask panel behind its flag." }),
        message({ who: "executor-shop", time: "21:48", body: "Started on feat/029-ask. The panel is behind its flag." }),
        divider("Today, 2 unread"),
        message({ who: "executor-shop", time: "08:50", body: "Task 029 is complete. The review is with overlord-web." }),
        message({ who: "executor-shop", time: "09:02", body: "Merged main into the branch. The checks pass." }),
      ],
      chatComposer("Message executor-shop", true),
    ),
  });

// Many conversations: what needs the person first, then the days, with only the first groups open.
const WAITING_THREADS = [
  CONVERSATIONS[2],
  { thread: "nightly", subject: "Which model runs the nightly build?", people: "overseer", time: "08:10", waiting: true },
  { thread: "release", subject: "Approve the release order", people: "overseer", time: "Yesterday", waiting: true },
];
const TODAY = [
  CONVERSATIONS[0],
  CONVERSATIONS[1],
  { unit: "builder-codex", preview: "Task 033 is in review.", time: "08:31", unread: 1 },
  { unit: "adjutant", preview: "The note is ready to read.", time: "08:12" },
];

function conversationListMany(selected) {
  const groupRow = (title, open, summary) => groupHeader(title, { open, h: 40, summary: text(summary, { size: 12, color: "mute" }), ref: `relay-group-${title.toLowerCase().replace(/[^a-z]+/g, "-")}` });
  return col(
    { grow: 1, pad: [16, 12], gap: 10 },
    row({ gap: 8, pad: [0, 6] }, text("Conversations", { size: 15, weight: 700, color: "title", grow: 1 }), button("New message", { kind: "quiet", glyph: "plus", h: 28, ref: "new-message" })),
    searchField("", { placeholder: "Search conversations, units, messages", ref: "relay-search" }),
    choice(["All", "Units", "Threads", "Unread"], "All", { ref: "relay-filter" }),
    col(
      { gap: 2 },
      groupRow("Waiting on you", true, "3"),
      ...WAITING_THREADS.map((c) => conversationRow(c, conversationKey(c) === selected)),
      groupRow("Today", true, "11 conversations, 3 unread"),
      ...TODAY.map((c) => conversationRow(c, conversationKey(c) === selected)),
      moreRow("Show 7 more conversations", { ref: "more-today", indent: 12 }),
      groupRow("Yesterday", false, "23 conversations, 4 unread"),
      groupRow("Earlier", false, "412 conversations"),
    ),
  );
}

const earlier = () =>
  col({ gap: 6, align: "center" }, text("1,284 earlier messages since 2026-08-02", { size: 12, color: "mute", align: "center" }), row({ justify: "center" }, button("Load earlier messages", { kind: "quiet", glyph: "arrowUp", h: 28, ref: "load-earlier" })));

const relayMany = () =>
  windowFrame({
    mode: "relay",
    ...FLEET_FRAME_BAR,
    left: conversationListMany("executor-shop"),
    leftW: 320,
    stage: chatStage(
      unitHeader("executor-shop"),
      [
        earlier(),
        divider("Today, 2 unread"),
        message({ who: "executor-shop", time: "08:50", body: "Task 029 is complete. The review is with overlord-web." }),
        message({ who: "executor-shop", time: "09:02", body: "Merged main into the branch. The checks pass." }),
      ],
      chatComposer("Message executor-shop", true),
    ),
  });

const relayThread = () =>
  windowFrame({
    mode: "relay",
    waiting: 2,
    left: conversationList("thread-rules"),
    leftW: 320,
    stage: chatStage(
      row(
        { h: 68, pad: [0, 24], gap: 12 },
        stack({ w: 36, h: 36, radius: "pill", fill: "field", stroke: "mute" }, icon("messagesSquare", { size: 17, color: "soft", place: "center" })),
        col({ grow: 1, gap: 3 }, text("Where are the rules of a squad connection stored?", { size: 15, weight: 700, color: "title", lines: 1 }), row({ gap: 8 }, copy("With"), ident("overlord-api", { size: 12 }))),
        statusMark("waiting", { word: "Reply requested" }),
      ),
      [
        divider("Today"),
        message({ mine: true, time: "08:20", body: "Where should squad rules be stored, so that the Overlord can read them without asking?" }),
        message({
          who: "overlord-api",
          time: "08:41",
          body: "Proposal: optional work and effort headers in the state of an Executor, next to lead, job and model. The change touches files.md and needs approval.",
          files: ["docs/flows/boards/hivem1nd-gui.mjs"],
        }),
      ],
      chatComposer("Reply to overlord-api", true),
    ),
  });

// A unit with no wake: what it means and the two ways to enable it.
function enableWake(unit) {
  return col(
    { grow: 1 },
    row({ pad: [16, 18, 12], gap: 10 }, text("Enable wake", { size: 15, weight: 700, color: "title", grow: 1 }), iconBtn("x", { name: "close-wake", label: "Close" })),
    hair(),
    col(
      { pad: [16, 18], gap: 14 },
      text("A message waits in the inbox until the session reads it. Wake notifies the session when a message arrives.", { size: 13, lh: 1.5, color: "text" }),
      col(
        { gap: 8 },
        label("From the session"),
        copy("A Claude Code session attaches wake from its own shell."),
        col({ pad: [10, 12], radius: 8, fill: "field", stroke: "line" }, text(`node <kit>\\cli\\index.mjs relay wake attach --mind-path <mind> --unit ${unit}`, { size: 12, face: "mono", lh: 1.5, color: "name" })),
        row({ gap: 8 }, button("Copy command", { glyph: "copy", h: 30, ref: "copy-attach" })),
      ),
      hair(),
      col({ gap: 8 }, label("From this window"), copy("A session opened in Sessions attaches wake itself."), row({}, button(`Open a session for ${unit}`, { glyph: "squareTerminal", h: 30, ref: "open-for-unit" }))),
      hair(),
      col({ gap: 8 }, label("Window"), choice(["4 hours", "8 hours", "24 hours"], "4 hours", { ref: "wake-window" }), copy("A 24 hour window is extended and needs confirmation. At most 20 handoffs.")),
    ),
  );
}

const noWake = () =>
  windowFrame({
    mode: "relay",
    waiting: 2,
    left: conversationList("executor-site"),
    leftW: 320,
    stage: chatStage(
      unitHeader("executor-site"),
      [
        divider("Yesterday"),
        message({ who: "executor-site", time: "18:10", body: "Out of quota. Task 011 resumes after the reset." }),
        divider("Today"),
        message({
          mine: true,
          time: "06:12",
          body: "Resume task 011 when the quota resets.",
          note: row({ gap: 6 }, icon("bellOff", { size: 12, color: "mute" }), text("Waiting in the inbox since 06:12", { size: 12, color: "mute" })),
        }),
      ],
      chatComposer("Message executor-site", false),
    ),
    right: enableWake("executor-site"),
  });

// ---- screens: Blueprint and Void in the window ---------------------------------------------------------

const searchBox = (placeholder) =>
  row({ h: 34, pad: [0, 10], gap: 8, radius: 9, fill: "field", stroke: EDGE, name: "search", label: placeholder }, icon("search", { size: 14, color: "mute" }), text(placeholder, { size: 12, color: "mute", grow: 1, lines: 1 }));

const boardRow = (title, selected = false) =>
  row({ h: 34, pad: [0, 10], gap: 9, radius: 9, fill: selected ? "on" : undefined, name: selected ? "board-current" : undefined, label: title }, icon("frame", { size: 14, color: selected ? "title" : "mute" }), text(title, { size: 13, weight: selected ? 700 : 400, color: selected ? "title" : "soft" }));

function boardList() {
  return col(
    { grow: 1, pad: [14, 12], gap: 3 },
    searchBox("Search boards"),
    space(12),
    groupHeader("HIVEM1ND", { open: true, h: 32, summary: text("3", { size: 12, color: "mute" }), ref: "project-hivem1nd" }),
    boardRow("Void"),
    boardRow("View"),
    boardRow("GUI", true),
    groupHeader("shop", { open: false, h: 32, summary: text("2", { size: 12, color: "mute" }), ref: "project-shop" }),
    moreRow("Show 12 more projects", { ref: "more-projects", indent: 12 }),
  );
}

const toolRail = () =>
  col(
    { pad: 4, gap: 2, radius: 14, fill: "panel", stroke: "line", place: { x: 14, y: 70 }, name: "tool-rail", label: "Tools" },
    iconBtn("hand", { active: true, size: 34, label: "Move" }),
    iconBtn("messageCircle", { size: 34, label: "Comment" }),
    iconBtn("shapes", { size: 34, label: "Sketch" }),
    iconBtn("fileText", { size: 34, label: "Note" }),
  );

const screenFrame = (x, y, title, note, ref) =>
  stack(
    { w: 200, h: 176, place: { x, y }, name: ref, label: title },
    text(title, { size: 13, weight: 700, color: "title", place: { x: 0, y: 0 } }),
    col({ w: 200, h: 150, pad: 14, radius: 12, fill: "panel", stroke: EDGE, place: { x: 0, y: 26 } }, text(note, { size: 12, lh: 1.5, color: "soft", lines: 6 })),
  );

const thread = () =>
  col(
    { w: 318, pad: 14, gap: 10, radius: 14, fill: "panel", stroke: EDGE, name: "thread-card", label: "Open thread" },
    row({ gap: 6 }, text("Shell", { size: 12, color: "mute" }), icon("chevronRight", { size: 12, color: "mute" }), text("Mode bar", { size: 12, weight: 700, color: "title", grow: 1 }), iconBtn("x", { size: 24, label: "Close the thread" })),
    col({ gap: 2 }, row({ gap: 8 }, text("User", { size: 12, weight: 700, color: "title" }), text("09:05", { size: 12, color: "mute" })), text("Should Sessions come before Relay in the bar?", { size: 13, lh: 1.5, color: "text" })),
    col({ gap: 2 }, row({ gap: 8 }, ident("overlord-api", { size: 12 }), text("09:08", { size: 12, color: "mute" })), text("The order is unchanged. Relay is the channel every mode uses.", { size: 13, lh: 1.5, color: "text" })),
    row({ h: 54, pad: 10, radius: 10, fill: "field", stroke: EDGE, align: "start" }, text("Reply", { size: 13, color: "mute" })),
    hair(),
    row({ gap: 8 }, check(true), text("Send to agent", { size: 12, color: "text" }), fill(), dot("add", 7), ident("overlord-api", { size: 12 })),
    row({ gap: 6 }, fill(), button("Resolve", { h: 28 }), button("Reply and send", { kind: "primary", h: 28, ref: "reply-send" })),
  );

// An arrow of the flow, from one frame to the next, with the name of the link above it.
const flowArrow = (x1, x2, y, tag) => [
  curve(x1, y, x2 - 6, y),
  vector({ w: 8, h: 10, place: { x: x2 - 8, y: y - 5 }, d: "M 0 0 L 100 50 L 0 100 Z", fill: "name" }),
  text(tag, { size: 12, color: "soft", w: x2 - x1, align: "center", place: { x: x1, y: y - 22 } }),
];

const FRAMES = [
  ["Shell", "The window as it opens: a mode bar, a list, the stage of the mode, a detail panel and a status line.", "frame-shell"],
  ["Overview", "The chain of command of the mind: a name and a role per unit, the rest one selection away.", "frame-overview"],
  ["New squad", "An Overlord and the Executors it leads, with the rules of each connection.", "frame-squad"],
];

function blueprintStage(sw) {
  const y = 120;
  const x = (i) => 76 + i * 270;
  return [
    row({ w: sw, h: 52, pad: [0, 16, 0, 70], gap: 12, place: { x: 0, y: 0 } }, text("HIVEM1ND GUI", { size: 14, weight: 700, color: "title" }), text(`${SCREENS.length} screens`, { size: 12, color: "mute" }), fill(), button("Present", { kind: "primary", glyph: "play", h: 30, ref: "present" })),
    toolRail(),
    ...FRAMES.map(([title, note, ref], i) => screenFrame(x(i), y, title, note, ref)),
    ...flowArrow(x(0) + 200, x(1), y + 101, "Overview"),
    ...flowArrow(x(1) + 200, x(2), y + 101, "New squad"),
    box({ w: 20, h: 20, radius: "pill", stroke: "text", strokeWidth: 2, fill: "canvas", place: { x: x(0) + 186, y: y + 16 }, name: "pin-open", label: "Open thread" }),
    stack({ w: 318, place: { x: x(0), y: 330 } }, thread()),
  ];
}

const boardInfo = () =>
  col(
    { grow: 1 },
    row({ pad: [16, 18, 12] }, text("Board", { size: 15, weight: 700, color: "title" })),
    hair(),
    col(
      { pad: [16, 18], gap: 14 },
      facts([["Project", "HIVEM1ND"], ["Screens", `${SCREENS.length}`], ["Open threads", "1"], ["Sketch", "None yet"]]),
      copy("Comments sent from this board go to overlord-api, whose wake is on."),
    ),
  );

const blueprint = (bar = true) =>
  windowFrame({
    mode: "blueprint",
    bar,
    waiting: 2,
    left: boardList(),
    stage: blueprintStage,
    right: boardInfo(),
    stageFill: "canvas",
  });

// Void's base sits in the stage with its own rails; the detail panel is its host-context slot.
const railBtn = (glyph, { on = false, label: title, name } = {}) =>
  stack({ w: 36, h: 36, radius: "pill", fill: on ? "hover" : undefined, name, label: title }, icon(glyph, { size: 18, color: on ? "title" : "mute", place: "center" }));

const spaceChip = (initials, cur) =>
  stack({ w: 30, h: 30, radius: "pill", fill: cur ? "text" : "field" }, text(initials, { size: 12, weight: 700, color: cur ? "canvas" : "mute", place: "center" }));

const SCOPE_DOC = {
  path: "user/projects/api/brief.md",
  file: "brief.md",
  by: "overlord-api",
  title: "The api project",
  paras: ["The api project serves the shop and the blog. Its Overlord leads two builders, one on each machine.", "Every change lands on its own branch and waits for a review before it merges."],
};

const DARK_DOC = {
  path: "user/adjutant/dark-theme-note.md",
  file: "dark-theme-note.md",
  by: "adjutant",
  title: "Dark theme of the landing page",
  paras: ["The landing page follows the colour scheme of the visitor. The colours come from the tokens found in task 001, and the work is on the branch feat/002-dark-theme.", "The change is complete and accepted. Merging the branch stays with the person."],
};

const voidStageOf = (doc) => (sw, sh) => {
  const mid = Math.round(sw / 2);
  return [
    col(
      { w: 580, place: { x: mid - 290, y: 120 }, gap: 14, name: "void-text", label: "Page text" },
      text(doc.path, { size: 12, color: "mute", align: "center" }),
      space(8),
      text(doc.title, { size: 23, weight: 700, color: "title", align: "center" }),
      space(4),
      ...doc.paras.map((para) => text(para, { size: 19, lh: 1.7, color: "text" })),
    ),
    col({ place: { x: 8, y: 8 }, w: 56, h: sh - 16, pad: [10, 0], gap: 6, align: "center", radius: 28, fill: "panel", name: "void-left-rail", label: "Void left rail" }, railBtn("search", { label: "Search" }), space(4), spaceChip("SC", true), spaceChip("PR", false), spaceChip("BR", false)),
    col(
      { place: { x: sw - 64, y: 8 }, w: 56, h: sh - 16, pad: [14, 0], gap: 3, align: "center", radius: 28, fill: "panel", name: "void-right-rail", label: "Void right rail" },
      text("1", { size: 19, weight: 700, color: "text", align: "center" }),
      text("of 1", { size: 12, color: "mute", align: "center" }),
      railBtn("bookmark", { label: "Bookmark" }),
      railBtn("history", { label: "Changes against the original" }),
      fill(),
      text("100%", { size: 12, color: "soft", align: "center" }),
    ),
  ];
};

const docRow = (path, who, selected = false) =>
  col({ pad: [8, 10], gap: 3, radius: 9, fill: selected ? "on" : undefined }, ident(path, { size: 12 }), copy(who, { size: 12 }));

function voidContext(doc = SCOPE_DOC) {
  return col(
    { grow: 1 },
    row({ pad: [16, 18, 12] }, text("Document", { size: 15, weight: 700, color: "title" })),
    hair(),
    col(
      { pad: [16, 18], gap: 14 },
      facts([["File", ident(doc.file, { size: 13 })], ["Saved", "On disk after every edit"], ["Last written by", doc.by]]),
      row({ gap: 10, align: "start" }, check(true), col({ grow: 1, gap: 3 }, text("Send edits to the agent", { size: 13, color: "text" }), row({ gap: 8 }, dot("add", 7), ident(doc.by, { size: 12 }), wakeMark(true, { size: 12 })))),
    ),
    hair(),
    col(
      { pad: [14, 12], gap: 3 },
      row({ pad: [0, 10, 6] }, label("Open a document")),
      row({ h: 34, pad: [0, 10], gap: 8, radius: 9, fill: "field", stroke: EDGE, name: "void-search", label: "Search documents" }, icon("search", { size: 14, color: "mute" }), text("Search the documents of the mind", { size: 12, color: "mute", grow: 1, lines: 1 })),
      docRow("projects/api/product.md", "Product document"),
      docRow("projects/api/brief.md", "Brief"),
      docRow("overseer/plan.md", "Plan of the Overseer"),
      moreRow("Show 211 more documents", { ref: "more-documents", indent: 10 }),
    ),
  );
}

const voidMode = (bar = true, doc = SCOPE_DOC) =>
  windowFrame({ mode: "void", bar, waiting: 2, stage: voidStageOf(doc), right: voidContext(doc), stageFill: "canvas" });

// ---- a case from zero: the flow ----------------------------------------------------------------
//
// An empty mind on two machines, DESKTOP and LAPTOP, becomes a working team and delivers a task. Every
// screen is the window at that step, with a mark on what the person selects, and a strip below it that
// says what the person does and what the mind writes. The files are the ones of files.md.

const CASE = {
  overseer: { machine: "DESKTOP", client: "claude", model: "opus", status: "idle", wake: true, why: "Coordination of the mind", since: "Today 09:20" },
  "overlord-web": { machine: "DESKTOP", client: "claude", model: "opus", status: "idle", wake: true, why: "No open task", since: "Today 09:24" },
  "executor-landing": { machine: "LAPTOP", client: "claude", model: "sonnet", status: "idle", wake: true, lead: "overlord-web", why: "No open task", since: "Today 09:24" },
  "executor-landing-2": { machine: "DESKTOP", client: "claude", model: "haiku", status: "idle", wake: true, lead: "overlord-web", why: "No open task", since: "Today 09:24" },
  adjutant: { machine: "LAPTOP", client: "claude", model: "opus", status: "idle", wake: true, why: "Note on the dark theme", since: "Today 10:12" },
};
const caseData = (over = {}) => Object.fromEntries(Object.entries(CASE).map(([unit, u]) => [unit, { ...u, ...(over[unit] ?? {}) }]));
const CASE_GROUP = { id: "web", kind: "Environment", lead: "overlord-web", members: ["executor-landing", "executor-landing-2"], open: true };
const caseTeam = ({ squad = false, adjutant = false } = {}) => ({ overseer: "overseer", adjutants: adjutant ? ["adjutant"] : [], services: [], groups: squad ? [CASE_GROUP] : [] });

const CASE_MEMBERS = [
  { key: "sonnet", unit: "executor-landing", model: "sonnet", client: "claude", machine: "LAPTOP", job: "builder" },
  { key: "haiku", unit: "executor-landing-2", model: "haiku", client: "claude", machine: "DESKTOP", job: "reader" },
];
const CASE_OVERLORD = { unit: "overlord-web", model: "opus", client: "claude", machine: "DESKTOP", job: "lead", ref: "node-overlord-web" };

const STRIP = 320;

/** A line of the strip: the file that is written and what is in it. */
const wrote = (path, what) => col({ gap: 2 }, ident(path, { size: 13 }), text(what, { size: 12, lh: 1.4, color: "soft" }));

function storyStrip({ step, title, clicks, writes }) {
  return col(
    { w: W, h: STRIP, fill: "panel", pad: [20, 40, 16], gap: 14, name: "story", label: `Step: ${title}` },
    row({ gap: 14 }, text(step, { size: 13, weight: 700, color: "soft" }), text(title, { size: 20, weight: 700, color: "title" })),
    row(
      { gap: 56, align: "start" },
      col({ w: 520, gap: 8 }, label("The person"), ...clicks.map((line) => row({ gap: 8, align: "start" }, icon("mousePointer2", { size: 13, color: "soft" }), text(line, { size: 13, lh: 1.45, color: "text", grow: 1 })))),
      col({ grow: 1, gap: 8 }, label("The mind writes"), ...writes.map(([path, what]) => wrote(path, what))),
    ),
  );
}

/** The mark on what the person selects at this step: a dashed ring and its name. */
function clickMark(rect, name, below = false) {
  const pad = 6;
  return [
    box({ w: rect.w + 2 * pad, h: rect.h + 2 * pad, radius: 12, stroke: "title", strokeWidth: 2, dash: "6 4", place: { x: Math.round(rect.x - pad), y: Math.round(rect.y - pad) } }),
    row({ h: 24, pad: [0, 10], gap: 6, radius: 8, fill: "text", place: { x: Math.max(2, Math.round(rect.x + rect.w + pad - (name.length * 6.8 + 46))), y: below ? Math.round(rect.y + rect.h + pad + 6) : Math.max(2, Math.round(rect.y - pad - 30)) } }, icon("mousePointer2", { size: 12, color: "canvas" }), text(name, { size: 12, weight: 700, color: "canvas" })),
  ];
}

/** A window with its strip. `target` is the name of the element the person selects. */
function flowScreen(window, { target, mark, below, step, title, clicks, writes }) {
  const rect = target ? locate(window, W, target, H) : null;
  return col(
    { w: W, h: H + STRIP },
    stack({ w: W, h: H }, window, ...(rect ? clickMark(rect, mark, below) : [])),
    storyStrip({ step, title, clicks, writes }),
  );
}

const formDialog = (title, intro, fields, { confirm, ref, w = 580 }) =>
  dialog(title, [text(intro, { size: 13, lh: 1.5, color: "soft" }), ...fields, row({ gap: 8, pad: [6, 0, 0] }, fill(), button("Cancel", { kind: "quiet" }), button(confirm, { kind: "primary", ref }))], { w });

const textArea = (title, value) =>
  col({ gap: 5 }, label(title), row({ h: 76, pad: [10, 12], radius: 8, fill: "field", stroke: EDGE, align: "start" }, text(value, { size: 13, lh: 1.5, color: "text", grow: 1 })));

const flowStart = () =>
  flowScreen(emptyFrame(), {
    target: "create-overseer",
    mark: "Create Overseer",
    step: "Start",
    title: "An empty mind on two machines",
    clicks: ["Open HIVEM1ND on LAPTOP. The bar shows DESKTOP and LAPTOP, both joined, and the map is empty.", "Select Create Overseer."],
    writes: [
      ["user/machines/DESKTOP.md, user/machines/LAPTOP.md", "Written by Genesis when the kit was installed on each machine. Nothing else exists in the mind yet."],
      ["Nothing is written by this screen", "The list, the map and the roles panel only read the mind."],
    ],
  });

const flowOverseer = () =>
  flowScreen(
    emptyFrame({
      overlay: formDialog(
        "Create the Overseer",
        "One Overseer coordinates the whole mind, on any number of machines.",
        [
          field("Unit", "overseer", { mono: true }),
          row({ gap: 10 }, col({ grow: 1 }, select("Machine", "DESKTOP")), col({ grow: 1 }, select("Client", "Claude Code"))),
          row({ gap: 10 }, col({ grow: 1 }, select("Model", "Opus 5.5")), col({ grow: 1 }, select("Effort", "high"))),
          copy("Source: models.md, seat work."),
          row({ gap: 10, h: 28 }, toggle(true), text("Enable wake for 4 hours", { size: 13, color: "text" })),
        ],
        { confirm: "Create Overseer", ref: "confirm-create-overseer" },
      ),
    }),
    {
      target: "confirm-create-overseer",
      mark: "Create Overseer",
      step: "Step 1 of 9",
      title: "Create the Overseer",
      clicks: ["Choose DESKTOP, because it stays on.", "Keep Claude Code, Opus 5.5 and high effort, the row of models.md for seat work.", "Select Create Overseer."],
      writes: [
        ["user/state/overseer.md", "unit: overseer, state: out, machine: DESKTOP, model: Opus 5.5, date: 2026-10-09 09:20."],
        ["A Claude Code session on DESKTOP", "The window opens it with /overseer. The entry of /relay registers it under user/relay/sessions/ and sets state: in."],
        ["Wake for four hours", "The session attaches it with relay wake attach; the window shows its state."],
      ],
    },
  );

const flowEnvironment = () =>
  flowScreen(
    overviewFrame({
      team: caseTeam(),
      data: caseData(),
      waiting: 0,
      overlay: formDialog(
        "Create an environment",
        "An environment groups the projects of one kind. Each machine keeps its own folder for a project.",
        [
          field("Environment", "web"),
          col(
            { gap: 8 },
            label("Project"),
            field("Name", "landing"),
            row({ gap: 10 }, col({ grow: 1 }, field("DESKTOP folder", "D:\\Projects\\landing", { mono: true })), col({ grow: 1 }, field("LAPTOP folder", "D:\\Projects\\landing", { mono: true }))),
            row({ gap: 14 }, statusMark("working", { word: "Found on DESKTOP" }), statusMark("working", { word: "Found on LAPTOP" })),
          ),
        ],
        { confirm: "Create environment", ref: "confirm-create-environment" },
      ),
    }),
    {
      target: "confirm-create-environment",
      mark: "Create environment",
      step: "Step 2 of 9",
      title: "Create the environment web with the project landing",
      clicks: ["Select New, then Environment.", "Name it web, add the project landing and give its folder on each machine.", "Select Create environment."],
      writes: [
        ["user/routes.md", "Environments: web: landing. Projects: landing (web)."],
        ["user/machines/DESKTOP.md, user/machines/LAPTOP.md", "Paths: web: D:\\Projects and landing: D:\\Projects\\landing, one line each on each machine."],
        ["user/projects/landing/brief.md", "project: landing, env: web. The first unit that enters adds stack, run and build from its audit."],
      ],
    },
  );

const flowSquad = () =>
  flowScreen(
    windowFrame({
      mode: "overview",
      waiting: 0,
      left: squadForm({ members: CASE_MEMBERS, overlord: CASE_OVERLORD, scope: "web", machine: "DESKTOP" }),
      leftW: 400,
      stage: (sw) => squadDiagram(sw, { members: CASE_MEMBERS, overlord: CASE_OVERLORD }),
    }),
    {
      target: "create-squad",
      mark: "Create squad",
      step: "Step 3 of 9",
      title: "Create an Overlord with two Executors",
      clicks: ["Select New, then Overlord with Executors, and choose the environment web.", "Add two Executors on different machines: Sonnet 5.5 on LAPTOP builds, Haiku 5.5 on DESKTOP researches. The rules on the connections come from models.md.", "Select Create squad."],
      writes: [
        ["user/envs/web/state/overlord-web.md", "unit: overlord-web, state: out, machine: DESKTOP, model: Opus 5.5."],
        ["user/projects/landing/state/executor-landing.md", "unit: executor-landing, state: out, machine: LAPTOP, lead: overlord-web, job: builder, model: Sonnet 5.5."],
        ["user/projects/landing/state/executor-landing-2.md", "unit: executor-landing-2, state: out, machine: DESKTOP, lead: overlord-web, job: reader, model: Haiku 5.5."],
        ["Three sessions", "Claude Code opens on DESKTOP for the Overlord and the Haiku Executor, and on LAPTOP for the Sonnet Executor, which LAPTOP starts when it reads the request. The rules have no header yet: the proposal is optional work and effort headers."],
      ],
    },
  );

const flowTask = () =>
  flowScreen(
    overviewFrame({
      team: caseTeam({ squad: true }),
      data: caseData(),
      sel: "overlord-web",
      waiting: 0,
      right: unitPanel("overlord-web", { data: caseData(), chat: [], sub: "Overlord of web, 2 Executors" }),
      overlay: formDialog(
        "New task",
        "A task is a file the unit reads. The message that follows tells it the task is ready.",
        [select("To", "overlord-web", { mono: true }), select("Project", "landing"), textArea("Request", "Add a dark theme to the landing page of the project landing.")],
        { confirm: "Create task", ref: "confirm-create-task" },
      ),
    }),
    {
      target: "confirm-create-task",
      mark: "Create task",
      step: "Step 4 of 9",
      title: "Give the squad a task",
      clicks: ["Select overlord-web on the map. Its panel opens with its session and the conversation, empty so far.", "Choose New task and write the request.", "Select Create task."],
      writes: [
        ["user/envs/web/tasks/001-add-a-dark-theme-to-the.md", "id: 001, status: open, from: user, to: overlord-web, date: 2026-10-09 09:31. Request: Add a dark theme to the landing page of the project landing."],
        ["user/envs/web/inbox/overlord-web/20261009-0931-user.md", "from: user, to: overlord-web, subject: task 001 is ready. It waits until the session reads it; wake sends a pointer."],
      ],
    },
  );

const flowRelay = () => {
  const list = [
    { thread: "dark", subject: "Add a dark theme to the landing page", people: "overlord-web, 2 Executors", time: "09:43" },
    { unit: "overlord-web", preview: "Task 002 is ready for executor-landing.", time: "09:43" },
    { unit: "executor-landing-2", preview: "Task 001 is complete.", time: "09:41" },
    { unit: "executor-landing", preview: "Task 002 is ready.", time: "09:43" },
    { unit: "overseer", preview: "User decisions: landing.", time: "09:35" },
  ];
  return flowScreen(
    windowFrame({
      mode: "relay",
      waiting: 0,
      left: col(
        { grow: 1, pad: [16, 12], gap: 10 },
        row({ gap: 8, pad: [0, 6] }, text("Conversations", { size: 15, weight: 700, color: "title", grow: 1 }), button("New message", { kind: "quiet", glyph: "plus", h: 28 })),
        searchField("", { placeholder: "Search conversations, units, messages" }),
        col({ gap: 2 }, ...list.map((c, i) => conversationRow(c, i === 0))),
      ),
      leftW: 320,
      stage: chatStage(
        row(
          { h: 68, pad: [0, 24], gap: 12 },
          stack({ w: 36, h: 36, radius: "pill", fill: "field", stroke: "mute" }, icon("messagesSquare", { size: 17, color: "soft", place: "center" })),
          col({ grow: 1, gap: 3 }, text("Add a dark theme to the landing page", { size: 15, weight: 700, color: "title" }), row({ gap: 8 }, copy("With"), ident("overlord-web", { size: 12 }), ident("executor-landing", { size: 12 }), ident("executor-landing-2", { size: 12 }))),
        ),
        [
          divider("Today"),
          message({ mine: true, to: "overlord-web", time: "09:31", body: "Add a dark theme to the landing page of the project landing.", note: sentNote("Pointer submitted 09:31, read 09:32") }),
          message({ who: "overlord-web", to: "executor-landing-2", time: "09:33", body: "Task 001, a hand-off: research the existing colour and type tokens of landing. Read only.", files: ["user/projects/landing/tasks/001-research-brand-tokens.md"], note: sentNote("Pointer submitted 09:33, read 09:34") }),
          message({ who: "executor-landing-2", to: "overlord-web", time: "09:41", body: "Task 001 is complete. The report lists the tokens of the brand.", files: ["user/projects/landing/tasks/001-research-brand-tokens.md"] }),
          message({ who: "overlord-web", to: "executor-landing", time: "09:43", body: "Task 002, a hand-off: build the dark theme from the tokens in the report of task 001.", files: ["user/projects/landing/tasks/002-build-dark-theme.md"], note: sentNote("Pointer submitted 09:43, waiting for LAPTOP") }),
        ],
        chatComposer("Reply to the thread", true),
      ),
    }),
    {
      target: "relay-thread-dark",
      mark: "Open the thread",
      step: "Step 5 of 9",
      title: "The hand-off travels through Relay",
      clicks: ["Select Relay, then the thread of the task.", "Read the messages in order. The person writes only the first one; the Overlord and the Executors write the others.", "Read the status under each message: a pointer submitted is not a pointer read."],
      writes: [
        ["user/projects/landing/tasks/001-research-brand-tokens.md, 002-build-dark-theme.md", "Written by overlord-web. The second has depends: 001 and work: build from an approved plan."],
        ["user/projects/landing/inbox/executor-landing-2/, user/projects/landing/inbox/executor-landing/", "One message file per hand-off, with the task path as the attachment."],
        ["user/relay/archive/, user/relay/events/", "A message read is archived with its original bytes. Each wake is recorded as submitted, never as delivered."],
      ],
    },
  );
};

const sentNote = (value) => row({ gap: 6 }, icon("check", { size: 12, color: "mute" }), text(value, { size: 12, color: "mute" }));

const flowWorking = () => {
  const data = caseData({ "executor-landing": { status: "working", why: "Task 002, branch feat/002-dark-theme", since: "Today 09:44" }, "executor-landing-2": { status: "done" } });
  return flowScreen(
    overviewFrame({
      team: caseTeam({ squad: true }),
      data,
      sel: "executor-landing",
      waiting: 0,
      right: unitPanel("executor-landing", { data, chat: [] }),
    }),
    {
      step: "Step 6 of 9",
      title: "The work runs and finishes",
      clicks: ["No selection is needed: the map follows the state files. Task 001 is done and task 002 is running.", "Select executor-landing to see its task, its machine and whom it reports to."],
      writes: [
        ["user/projects/landing/state/executor-landing.md", "state: in, branch: feat/002-dark-theme. The Executor works on its own branch and never on master."],
        ["user/projects/landing/tasks/001-research-brand-tokens.md", "The Report holds the tokens found. status: review, then done once overlord-web checks it."],
        ["user/projects/landing/tasks/002-build-dark-theme.md", "The Report holds what was built and how it was verified. status: review."],
      ],
    },
  );
};

const flowReview = () => {
  const data = caseData({ "overlord-web": { status: "waiting" }, "executor-landing-2": { status: "done" } });
  const review = col(
    { pad: [16, 18], gap: 12 },
    row({ gap: 9 }, icon("checkCheck", { size: 15, color: "warm" }), text("Review task 002", { size: 14, weight: 700, color: "title", grow: 1 }), text("10:05", { size: 12, color: "mute" })),
    row({ gap: 6 }, ident("executor-landing", { size: 12 }), copy("approved by"), ident("overlord-web", { size: 12 })),
    col(
      { gap: 6, pad: [12, 14], radius: 10, fill: "field" },
      label("Report"),
      ...["The landing page follows the colour scheme of the visitor.", "The colours come from the tokens of task 001.", "The build and the tests pass.", "Branch feat/002-dark-theme, 5 files changed."].map((line) => row({ gap: 8, align: "start" }, icon("check", { size: 12, color: "add" }), text(line, { size: 13, lh: 1.45, color: "text", grow: 1 }))),
    ),
    row({ gap: 8 }, button("Accept task", { kind: "primary", glyph: "check", ref: "accept-task" }), button("Send back", { glyph: "cornerDownLeft" }), button("Open diff", { kind: "quiet" })),
    copy("Accepting does not merge. The branch stays for the person to merge."),
  );
  return flowScreen(
    overviewFrame({ team: caseTeam({ squad: true }), data, waiting: 1, right: waitingPanel({ waiting: 1, review }), rightW: 380 }),
    {
      target: "accept-task",
      mark: "Accept task",
      below: true,
      step: "Step 7 of 9",
      title: "The result comes back to the person",
      clicks: ["Select the gold mark in the bar, or the gold ring of overlord-web on the map.", "Read the report: what changed, what was checked and on which branch.", "Select Accept task."],
      writes: [
        ["user/projects/landing/tasks/002-build-dark-theme.md", "The Report ends with Approved for review by overlord-web on 2026-10-09. On Accept, status: done."],
        ["user/projects/landing/inbox/executor-landing/", "A message that task 002 was accepted."],
        ["No merge, no push", "The branch feat/002-dark-theme waits. The window shows the diff and runs no merge."],
      ],
    },
  );
};

const flowAdjutant = () => {
  const data = caseData({ "executor-landing-2": { status: "done" }, "executor-landing": { status: "done" } });
  return flowScreen(
    overviewFrame({
      team: caseTeam({ squad: true }),
      data,
      waiting: 0,
      overlay: formDialog(
        "Create an Adjutant",
        "An Adjutant finishes a request from start to end. It writes and researches; it does not coordinate projects or change code.",
        [
          field("Unit", "adjutant", { mono: true }),
          row({ gap: 10 }, col({ grow: 1 }, select("Machine", "LAPTOP")), col({ grow: 1 }, select("Client", "Claude Code"))),
          row({ gap: 10 }, col({ grow: 1 }, select("Model", "Opus 5.5")), col({ grow: 1 }, select("Effort", "high"))),
          textArea("First request", "Write a one-page note that explains the dark theme of landing for its product document."),
        ],
        { confirm: "Create Adjutant", ref: "confirm-create-adjutant" },
      ),
    }),
    {
      target: "confirm-create-adjutant",
      mark: "Create Adjutant",
      step: "Step 8 of 9",
      title: "Add an Adjutant and give it a document to write",
      clicks: ["Select New, then Adjutant.", "Choose LAPTOP and write the first request.", "Select Create Adjutant."],
      writes: [
        ["user/state/adjutant.md", "unit: adjutant, state: out, machine: LAPTOP, model: Opus 5.5."],
        ["user/inbox/adjutant/20261009-1012-user.md", "from: user, to: adjutant, subject: Write a note on the dark theme. The request is the body."],
        ["A Claude Code session on LAPTOP", "Started with /adjutant. It reads the brief of landing and the closed tasks, then writes the note."],
      ],
    },
  );
};

const flowDocument = () =>
  flowScreen(voidMode(true, DARK_DOC), {
    target: "mode-void",
    mark: "Void",
    step: "Step 9 of 9",
    title: "The document comes back",
    clicks: ["Read the message of adjutant in Relay: the note is ready.", "Select Void to read it in place. A correction is saved to the file and sent to the Adjutant when Send edits to the agent is on."],
    writes: [
      ["user/adjutant/dark-theme-note.md", "The finished text, saved before the session exits, as the role requires."],
      ["user/state/adjutant.md", "state: in. The context names the file and what is pending."],
      ["user/inbox/overseer/", "One note, landing: dark theme note, with one line saying where it is. No reply is requested."],
    ],
  });

// ---- the board ------------------------------------------------------------------------------------------

const FLOW_H = H + STRIP;

const NOTES = {
  overview: "The chain of command of the mind, and nothing more: a name and a role per unit. The Overseer is at the top. Adjutants hang beside its line, second in rank, because they serve the person and the Overseer and lead nobody. Each Overlord heads a column with its Executors below it on one rail, so who answers to whom reads at a glance; the Executors with no Overlord answer to the Overseer and share the last column. Every rank sits at one height across the map. The services stay in a corner, outside the chain. Machine, client, model, task and conversation are one selection away.",
  selected: "A selected unit opens its panel, the same in Overview and in Sessions: who it is and whom it reports to, where it runs, its task, then the conversation of the person with it and a composer that takes a message or, after a slash, a command of the kit. Open in the client and New task are its actions; clearing and ending are in the menu here and at the foot of the panel in Sessions.",
  waiting: "What waits on the person opens from the gold mark of the bar, over the map: replies requested first, then reviews. Gold marks this and nothing else.",
  sessions: "Every running session in the chain of command. The Overseer is the root, its Adjutants come next, then each Overlord as a card with its Executors inside, then the Executors that answer to the Overseer, and the services last, outside the chain. Rails join each unit to the one it answers to. A card with something working or waiting opens; the others stay closed with their counts. The columns are fixed, so the task fills the middle of the list. The panel is the unit panel with Clear context and End session at its foot.",
  sessionsMachines: "The same sessions grouped by machine, one switch away. Each machine is a card with the same glyph at any scale; inside it the rows keep the order of rank, and the third column says whom each session reports to. Machines with something active come first.",
  sessionsMany: "Twelve hundred sessions under sixty Overlords. Inside each rank, what waits on the person comes first; three cards with activity open, eight cards show before Show more, and the rest of the Overlords count their sessions on one row. The Executors that answer to the Overseer stay in their own card, closed with their counts. The panel opens on the first unit that waits.",
  overviewMany: "Sixty Overlords and a hundred Executors that answer to the Overseer. The columns that fit the width are the ones that need the person; the rest fold into one card that names each with its most urgent count and leads to the full list in Sessions. A column shows four Executors and then Show more.",
  empty: "No unit has registered. The stage names the first action, which is to create the Overseer, and draws the chain of command the mind grows into, empty, so the order of rank is learnt before anything exists. The clients found on this machine come from the Relay diagnosis, with an action to configure the ones that lack Relay.",
};

const SCREENS = [
  { id: "changed-overview", title: "Changed 1: Overview", col: 0, row: 0, root: overview, note: NOTES.overview },
  { id: "changed-selected", title: "Changed 2: A unit, its session and its conversation", col: 1, row: 0, root: overviewSelected, note: NOTES.selected },
  { id: "new-waiting", title: "New 3: Waiting on you", col: 2, row: 0, root: overviewWaiting, note: NOTES.waiting },
  { id: "changed-sessions", title: "Changed 4: Sessions", col: 3, row: 0, root: sessions, note: NOTES.sessions },
  { id: "new-sessions-machines", title: "New 5: Sessions by machine", col: 4, row: 0, root: sessionsMachines, note: NOTES.sessionsMachines },
  { id: "changed-sessions-many", title: "Changed 6: Sessions, many units", col: 5, row: 0, root: sessionsMany, note: NOTES.sessionsMany },
  { id: "changed-overview-many", title: "Changed 7: Overview, many Overlords", col: 6, row: 0, root: overviewMany, note: NOTES.overviewMany },
  { id: "changed-empty", title: "Changed 8: An empty mind", col: 7, row: 0, root: empty, note: NOTES.empty },

  { id: "shell", title: "Shell", col: 0, row: 1, root: shell, note: "The window as it opens on a selected unit: the mode bar, the stage of the mode, the detail panel and the status line, after the docked frame of the Blueprint web app. The dashed outlines name the regions and are not part of the screen. The bar holds the five modes, the machines with their state, the count of what waits on the person and the control that hides it. The tab order follows the reading order: bar, stage, detail. Escape closes a panel or a dialog and returns focus to the control that opened it." },
  { id: "overview", title: "Overview", col: 1, row: 1, root: overview, note: NOTES.overview },
  { id: "overview-selected", title: "A selected unit", col: 2, row: 1, root: overviewSelected, note: NOTES.selected },
  { id: "overview-waiting", title: "Waiting on you", col: 3, row: 1, root: overviewWaiting, note: NOTES.waiting },
  { id: "overview-create", title: "Create a role", col: 4, row: 1, root: overviewCreate, note: "The New menu creates every role, in the order of rank, each with what it does: this menu is where the roles are explained. The Overseer is disabled while one exists, with the reason written, because a mind has one. An Overlord is created together with its Executors, which is the squad screen." },
  { id: "overview-palette", title: "Command palette", col: 5, row: 1, root: overviewPalette, note: "The command palette lists every command and feature of the kit, the creation of every role and, while typing, the units. The commands of the selected unit come first. The list is filtered as the person types and scrolls, so it holds any amount. The same commands run from the composer of the unit panel after a slash." },

  { id: "shell-hidden", title: "Shell, bar hidden", col: 0, row: 2, root: shellHidden, note: "The bar and the status line are hidden and the stage uses the full height. A handle on the top edge restores the bar and keeps the gold mark and the count of what waits on the person. The bar returns over the content without moving it, and under reduced motion the change is immediate." },
  { id: "overview-arrange", title: "Arranging the map", col: 1, row: 2, root: overviewArrange, note: "A drag changes a position only, and the arrangement is kept and shown as saved. A column lifted by the pointer leaves its place held by a dashed outline. The lead of a unit changes from its panel, never by a drag, so the rails always tell the truth. Tidy returns to the default arrangement." },
  { id: "overview-many", title: "Overview, many Overlords", col: 2, row: 2, root: overviewMany, note: NOTES.overviewMany },
  { id: "offline", title: "A machine out of reach", col: 3, row: 2, root: offline, note: "LAPTOP has written no record since 08:41. The server cannot probe a machine, so the state comes from the newest record: its units show Out of reach on the map, in the panel and in the status line. Actions that need LAPTOP are disabled and the reason is written. Messages to its units wait in their inboxes." },
  { id: "empty", title: "An empty mind", col: 4, row: 2, root: empty, note: NOTES.empty },

  { id: "squad", title: "New squad", col: 1, row: 3, root: squad, note: "A new squad: one Overlord and three Executors. Each connection carries the rule for its Executor, taken from models.md: Sonnet 5.5 for clear tasks at high effort, medium when possible; Haiku 5.5 for research only; Opus 5.5 for planning at high effort and answers at medium. A rule cites its row and states where it differs from the row." },
  { id: "squad-rule", title: "Rules of a connection", col: 2, row: 3, root: squadRule, note: "One connection selected: the kind of work, the model and the effort, and the row of models.md the rule comes from. The row is never changed from here; a rule that differs belongs to the squad." },
  { id: "squad-many", title: "New squad, many Executors", col: 3, row: 3, root: squadMany, note: "Seventeen Executors in one squad. The rule belongs to a kind of Executor, so the diagram keeps one connection per rule and the count is a stepper; the Executors of a rule are one step away in the list. A squad of five hundred Executors has the same three connections." },

  { id: "sessions", title: "Sessions", col: 1, row: 4, root: sessions, note: NOTES.sessions },
  { id: "sessions-machines", title: "Sessions by machine", col: 2, row: 4, root: sessionsMachines, note: NOTES.sessionsMachines },
  { id: "session-open", title: "Open a session", col: 3, row: 4, root: sessionOpen, note: "The form to open a session: unit, task, client, machine, model, effort and wake. Model and effort start from the row of models.md for the kind of work. A session on the other machine is requested through the mind and started by that machine." },
  { id: "session-clear", title: "Clear context", col: 4, row: 4, root: sessionClear, note: "Clearing restarts the session from the recorded state of the unit. The conversation is discarded; the state, the tasks and the inbox are kept. The session can write its state first. Nothing is committed or pushed. Focus is held in the dialog and Escape cancels." },
  { id: "session-end", title: "End a session", col: 5, row: 4, root: sessionEnd, note: "Ending runs the exit of /relay, which commits and pushes, so the dialog lists what is uncommitted before the confirmation. Close without exit stops the process and writes nothing. Focus is held in the dialog and Escape cancels." },

  { id: "sessions-one", title: "Sessions, one machine", col: 1, row: 5, root: sessionsOne, note: "The whole mind on one machine: the same chain with fewer rows, so nothing changes when a second machine joins. The bar shows only this machine." },
  { id: "sessions-many", title: "Sessions, many units", col: 2, row: 5, root: sessionsMany, note: NOTES.sessionsMany },
  { id: "sessions-machines-many", title: "Sessions by machine, many machines", col: 3, row: 5, root: sessionsMachinesMany, note: "Five hundred machines, scrolled to the end of the active ones. Active machines come first and open until about twenty rows are showing; the rest are closed cards with their counts. Idle machines and machines out of reach follow in their own sections, and the section in view stays pinned at the top. A machine lists eight sessions before Show more." },
  { id: "sessions-search", title: "Sessions, search with results", col: 4, row: 5, root: sessionsSearch, note: "A search filters units, machines, clients and tasks together and keeps the chain: a matching Executor stays inside the card of its Overlord, which opens. The match is marked in each row." },
  { id: "sessions-none", title: "Sessions, search with no match", col: 5, row: 5, root: sessionsNone, note: "A search with no match names the query, says what the search covers and offers one action." },
  { id: "session-open-many", title: "Open a session, many machines", col: 6, row: 5, root: sessionOpenMany, note: "Above three machines the machine choice becomes a select with a search. Machines with something running come first; the rest are one step away." },

  { id: "relay", title: "Relay", col: 1, row: 6, root: relay, note: "Relay as a conversation: a list of units and threads, and one conversation with its messages and a composer. The person writes as the unit user. Each conversation shows only its wake status and its unread count; the wake window and the other details are one step away." },
  { id: "relay-thread", title: "A thread", col: 2, row: 6, root: relayThread, note: "A thread groups the messages of one subject. A message that requests a reply keeps the thread in Waiting on you until the person answers." },
  { id: "no-wake", title: "A unit with wake off", col: 3, row: 6, root: noWake, note: "Wake is off, so a sent message waits in the inbox, and the conversation says so under the message. Wake can be attached only from inside the session or by a session this window opened, so the panel offers the command to copy and the way to open a new session." },
  { id: "relay-many", title: "Relay, many conversations", col: 4, row: 6, root: relayMany, note: "Four hundred and eighty conversations. What needs the person comes first, then today; yesterday and earlier are collapsed with their counts, and a search covers conversations, units and messages. Inside a conversation the history loads on request, so a long conversation opens at its latest message." },
  { id: "blueprint", title: "Blueprint", col: 1, row: 7, root: () => blueprint(true), note: "Blueprint Lite in the window: its boards become the list, its canvas the stage, and a comment can be sent to the agent of the project. The tool is the existing viewer, drawn as it sits in the frame." },
  { id: "blueprint-hidden", title: "Blueprint, bar hidden", col: 2, row: 7, root: () => blueprint(false), note: "The same board with the bar hidden: the canvas gains its height and the handle keeps what waits on the person in sight." },
  { id: "void", title: "Void", col: 1, row: 8, root: () => voidMode(true), note: "Void Lite in the window, opened on a document of the mind. The Void base keeps its own rails; the detail panel is its host-context slot, with the file, who last wrote it and where the edits are sent." },
  { id: "void-hidden", title: "Void, bar hidden", col: 2, row: 8, root: () => voidMode(false), note: "The same document with the bar hidden." },
  { id: "flow-start", title: "Flow, start", col: 0, row: 9, h: FLOW_H, root: flowStart, note: "The case from zero, step by step: an empty mind on two machines becomes a working team and delivers a task. Each screen is the window at that step, with a mark on what the person selects, and the strip below says what the person does and what the mind writes." },
  { id: "flow-overseer", title: "Flow, 1 Create the Overseer", col: 1, row: 9, h: FLOW_H, root: flowOverseer, note: "One Overseer for the whole mind, on the machine that stays on." },
  { id: "flow-environment", title: "Flow, 2 Create the environment", col: 2, row: 9, h: FLOW_H, root: flowEnvironment, note: "An environment with its first project; each machine keeps its own folder for the project." },
  { id: "flow-squad", title: "Flow, 3 Create the Overlord and Executors", col: 3, row: 9, h: FLOW_H, root: flowSquad, note: "An Overlord with two Executors on different machines and models. The rules on the connections are the ones of the squad screen." },
  { id: "flow-task", title: "Flow, 4 Give a task", col: 4, row: 9, h: FLOW_H, root: flowTask, note: "The request is a task file for the Overlord and a message that tells it the task is ready." },
  { id: "flow-relay", title: "Flow, 5 The hand-off in Relay", col: 0, row: 10, h: FLOW_H, root: flowRelay, note: "The messages of the task in order, with the state of each pointer. A pointer submitted is not a pointer read." },
  { id: "flow-working", title: "Flow, 6 The work", col: 1, row: 10, h: FLOW_H, root: flowWorking, note: "Task 001 is done and task 002 is running on its own branch." },
  { id: "flow-review", title: "Flow, 7 The result", col: 2, row: 10, h: FLOW_H, root: flowReview, note: "The review waits on the person once the Overlord has approved it. Accepting marks the task done and merges nothing." },
  { id: "flow-adjutant", title: "Flow, 8 An Adjutant", col: 3, row: 10, h: FLOW_H, root: flowAdjutant, note: "An Adjutant is created with its first request, a document." },
  { id: "flow-document", title: "Flow, 9 The document", col: 4, row: 10, h: FLOW_H, root: flowDocument, note: "The finished note, read in Void. A correction is saved to the file and sent to the Adjutant." },
];

export default board({
  id: "hivem1nd-gui",
  title: "HIVEM1ND GUI: one window for the whole kit",
  note: "One local server and one window. The docked frame of the Blueprint web app holds the tools of the kit as modes: Overview, Blueprint, Void, Relay and Sessions. The Overview is the chain of command of the mind, a name and a role per unit; selecting a unit opens one panel with its session and its conversation, the same in Sessions, which lists every session in the same chain. The top row holds the screens changed in this round. The case from zero at the bottom of the board follows one request from an empty mind to a delivered task. The bar can be hidden; a handle keeps the mark of what waits on the person. Gold marks that and nothing else. The sample is invented: units, machines, clients, statuses and times are examples. Nothing here writes a file by itself: every action is an intent the server applies after the person confirms it.",
  screens: SCREENS,
  links: [
    { from: "shell", to: "overview", at: "mode-overview", label: "Overview" },
    { from: "shell", to: "blueprint", at: "mode-blueprint", label: "Blueprint" },
    { from: "shell", to: "void", at: "mode-void", label: "Void" },
    { from: "shell", to: "relay", at: "mode-relay", label: "Relay" },
    { from: "shell", to: "sessions", at: "mode-sessions", label: "Sessions" },
    { from: "shell", to: "shell-hidden", at: "hide-bar", label: "Hide the bar" },
    { from: "shell-hidden", to: "shell", at: "bar-handle", label: "Show the bar" },
    { from: "overview", to: "overview-selected", at: "node-executor-shop", label: "Select a unit" },
    { from: "overview", to: "overview-waiting", at: "waiting-pill", label: "Waiting on you" },
    { from: "overview", to: "overview-create", at: "new-menu", label: "New" },
    { from: "overview", to: "overview-palette", at: "open-palette", label: "Commands" },
    { from: "overview", to: "overview-arrange", at: "node-overlord-api", label: "Drag a column" },
    { from: "overview", to: "overview-many", label: "Many Overlords" },
    { from: "overview", to: "offline", label: "A machine out of reach" },
    { from: "overview", to: "empty", label: "An empty mind" },
    { from: "overview-create", to: "squad", at: "menu-overlord", label: "Overlord with Executors" },
    { from: "overview-selected", to: "relay", at: "unit-conversation", label: "The whole conversation" },
    { from: "overview-selected", to: "sessions", at: "unit-menu", label: "Clear or end" },
    { from: "overview-many", to: "sessions-many", at: "all-in-sessions", label: "Show all in Sessions" },
    { from: "squad", to: "squad-rule", at: "rule-sonnet", label: "Rules of a connection" },
    { from: "squad", to: "squad-many", label: "Many Executors" },
    { from: "sessions", to: "sessions-machines", at: "sessions-view-machines", label: "By machine" },
    { from: "sessions", to: "session-open", at: "open-session", label: "Open session" },
    { from: "sessions", to: "session-clear", at: "clear-context", label: "Clear context" },
    { from: "sessions", to: "session-end", at: "end-session", label: "End session" },
    { from: "sessions", to: "sessions-one", label: "One machine" },
    { from: "sessions", to: "sessions-many", label: "Many units" },
    { from: "sessions-machines", to: "sessions-machines-many", label: "Many machines" },
    { from: "sessions-many", to: "sessions-search", at: "session-search", label: "Search" },
    { from: "sessions-search", to: "sessions-none", label: "No match" },
    { from: "session-open", to: "session-open-many", at: "open-machine", label: "Many machines" },
    { from: "relay", to: "relay-thread", at: "relay-thread-rules", label: "A thread" },
    { from: "relay", to: "no-wake", at: "relay-executor-site", label: "Wake off" },
    { from: "relay", to: "relay-many", label: "Many conversations" },
    { from: "no-wake", to: "session-open", at: "open-for-unit", label: "Open a session" },
    { from: "blueprint", to: "blueprint-hidden", at: "hide-bar", label: "Hide the bar" },
    { from: "void", to: "void-hidden", at: "hide-bar", label: "Hide the bar" },
    { from: "flow-start", to: "flow-overseer", at: "create-overseer", label: "Create Overseer" },
    { from: "flow-overseer", to: "flow-environment", at: "confirm-create-overseer", label: "Create Overseer" },
    { from: "flow-environment", to: "flow-squad", at: "confirm-create-environment", label: "Create environment" },
    { from: "flow-squad", to: "flow-task", at: "create-squad", label: "Create squad" },
    { from: "flow-task", to: "flow-relay", at: "confirm-create-task", label: "Create task" },
    { from: "flow-relay", to: "flow-working", label: "The work runs" },
    { from: "flow-working", to: "flow-review", label: "The task finishes" },
    { from: "flow-review", to: "flow-adjutant", at: "accept-task", label: "Accept task" },
    { from: "flow-adjutant", to: "flow-document", at: "confirm-create-adjutant", label: "Create Adjutant" },
  ],
});
