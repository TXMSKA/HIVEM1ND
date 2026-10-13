// HIVEM1ND 3.0: the one board of the version. Every step of the GUI, drawn from the approved screens of
// 2026-10-10, the GUI plan (docs/3.0/plan-gui.md) and the review comments of 2026-10-13, in Modern, the
// default look. One row per part, read left to right: setup, the Map with its groups, chats and what waits
// on the person, Blueprint, Void, settings and the service, and the phone. Blueprint and Void share one
// library (search, filters, folders, and create, rename, duplicate, move and delete) and one comment
// composer with Send to agent. Every press answers at once: a pressed control shows a spinner, a sent
// line appears at once with its state, an agent at work shows that it is working, and every wait ends in
// a clear state with Retry. The sample is invented: its units, machines, tasks, paths and times are examples.

import { board } from "blueprint/board.mjs";
import { box, col, row, stack, vector, space, fill, ELLIPSE } from "blueprint/kit.mjs";
import {
  LOOKS, FAMILY, t, mono, ic, mark, dot, circle, centered, ibtn, avatar, button, bar, statusLine, panel, tabs, search, heading,
  unitRow, side, NODES, LINKS, GROUPS, mapField, inspectorHead, facts, message, code, ask, buildAsk, reviewAsk,
  composer, conversation, library, editorGround, toolbar, chip, watch, pin, wire, wireLine, artboard, avatars,
  comment, commentsPanel, editorBody, DOC, phoneTop, phoneNav, phone, phoneHierarchy, phoneChat, focus, tick,
} from "../kit/h3.mjs";

const L = LOOKS[0];
const ERR = "#e58e7c";
const ERR_SOFT = "rgba(229,142,124,0.12)";
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const M1ND_PATH = "C:\\Users\\you\\AppData\\Local\\Cosmic\\.m1nd";

// ---- feedback: spinners, work in progress, notices ------------------------------------------------

const ARC = "M50 4 A46 46 0 1 1 4 50";
const spinner = (s = 14, color = "acc") =>
  stack({ w: s, h: s }, vector({ w: s, h: s, d: ELLIPSE, stroke: "line2", strokeWidth: 2 }), vector({ w: s, h: s, d: ARC, stroke: color, strokeWidth: 2 }));

/** A pressed button: the label says what is happening and a spinner turns in place of the icon. */
const busy = (label, kind = "pri") =>
  row(
    { name: `busy-${slug(label)}`, label, gap: 7, pad: [7, 12], radius: 10, fill: kind === "pri" ? "acc" : "card2", opacity: 0.88 },
    spinner(13, kind === "pri" ? "accInk" : "acc"),
    t(label, 12.5, { weight: 600, color: kind === "pri" ? "accInk" : "text" }),
  );

const danger = (label, name) =>
  row({ name, label, gap: 6, pad: [7, 12], radius: 10, fill: ERR }, t(label, 12.5, { weight: 700, color: "#1d0b08" }));

/** An agent at work: three dots, who, and for how long. */
const working = (who, detail = null, stop = false) =>
  row(
    { name: "agent-working", label: "Agent working", gap: 10, pad: [10, 14], radius: 18, fill: "card", self: "start" },
    row({ gap: 4 }, ...[1, 0.6, 0.3].map((o) => box({ w: 7, h: 7, radius: "pill", fill: "acc", opacity: o }))),
    t(`${who} is working on it`, 13.5, { color: "body" }),
    detail ? t(detail, 12, { color: "mute" }) : null,
    stop ? button(L, "Stop", "ghost", "stop", "stop-work") : null,
  );

const youLine = (when = "now") => row({ gap: 8 }, mono("You", 12, { weight: 700 }), t(when, 12, { color: "mute" }));

/** A line of the person's, shown the moment it is sent, with its state under it. */
function mine(body, state, { failed = false, sending = false } = {}) {
  return col(
    { name: failed ? "unsent-line" : "sent-line", label: "Your message", gap: 4, align: "end", pad: [0, 0, 0, 28] },
    youLine(sending ? "now" : "23:45"),
    col({ pad: [10, 14], radius: 18, fill: "me", stroke: failed ? ERR : undefined, opacity: sending ? 0.85 : undefined }, t(body, 14.5, { color: "meText" })),
    failed
      ? row({ gap: 8 }, ic("alert", 13, ERR), t(state, 12, { color: ERR }), t("Retry", 12, { weight: 700, color: "acc" }))
      : row({ gap: 6 }, sending ? spinner(12) : ic("check", 12, "mute"), t(state, 12, { color: "mute" })),
  );
}

const scrim = () => box({ w: 1440, h: 900, fill: "rgba(4,2,6,0.62)", place: { x: 0, y: 0 } });

function dialog({ title, sub = null, kids = [], actions = [], w = 480, name = "dialog" }) {
  return col(
    { name, label: title, w, pad: 24, gap: 18, radius: 22, fill: "panel", stroke: "line2", place: "center" },
    col({ gap: 6 }, t(title, 18, { weight: 700 }), sub ? t(sub, 13.5, { color: "mute" }) : null),
    ...kids,
    row({ gap: 8, justify: "end" }, ...actions),
  );
}

function field(label, value, { placeholder = false, select = false, error = null, hint = null, disabled = false, glyph = null } = {}) {
  return col(
    { name: `field-${slug(label)}`, label, gap: 6, opacity: disabled ? 0.6 : undefined },
    t(label, 12.5, { weight: 600, color: "mute" }),
    row(
      { gap: 8, pad: [10, 12], radius: 12, fill: "card", stroke: error ? ERR : "line2" },
      glyph ? ic(glyph, 15, "mute") : null,
      t(value, 14, { color: placeholder ? "mute" : "text", lines: 1 }),
      fill(),
      select ? ic("chevron", 15, "mute") : null,
    ),
    error ? row({ gap: 6 }, ic("alert", 13, ERR), t(error, 12.5, { color: ERR })) : hint ? t(hint, 12, { color: "mute" }) : null,
  );
}

const pairOf = (a, b) => row({ gap: 14, align: "start" }, col({ grow: 1 }, a), col({ grow: 1 }, b));

function option(title, desc, { sel = false, glyph = null, badge = null, disabled = false, compact = false } = {}) {
  return row(
    { name: `option-${slug(title)}`, label: title, gap: 14, pad: compact ? [10, 14] : [14, 16], radius: 16, fill: sel ? "card2" : "card", stroke: sel ? "acc" : "line", opacity: disabled ? 0.55 : undefined },
    stack({ w: 18, h: 18 }, circle(18, { stroke: sel ? "acc" : "line2", strokeWidth: 2 }), sel ? circle(8, { fill: "acc" }) : null),
    glyph ? ic(glyph, 18, sel ? "acc" : "body") : null,
    col({ grow: 1, gap: 2 }, t(title, 14.5, { weight: 700 }), t(desc, 12.5, { color: "mute" })),
    badge ? row({ pad: [2, 8], radius: "pill", fill: "card2" }, t(badge, 11, { weight: 700, color: "mute" })) : null,
  );
}

function toast(msg, action = null, glyph = "check") {
  return row(
    { name: "toast", label: "Notice", gap: 10, pad: [11, 16], radius: 14, fill: "text", place: "bottom-center", dy: -46 },
    ic(glyph, 15, "bg"),
    t(msg, 13, { weight: 700, color: "bg" }),
    action ? row({ pad: [0, 0, 0, 6] }, t(action, 13, { weight: 700, color: "#56631c" })) : null,
  );
}

/** A notice across the top of the stage: a wait, a problem or work in progress, always with a way out. */
function banner(kind, msg, actions = []) {
  const error = kind === "error";
  return row(
    { name: "banner", label: msg, gap: 10, pad: [10, 12, 10, 14], radius: 14, fill: error ? ERR_SOFT : kind === "busy" ? "panel" : "waitSoft", stroke: error ? ERR : "line2", place: "top-center", dy: 40 },
    kind === "busy" ? spinner(15) : ic("alert", 15, error ? ERR : "wait"),
    t(msg, 13, { color: "text" }),
    ...actions,
  );
}

/** The steps of something that takes time, each with its own state. */
function steps(list) {
  return col(
    { name: "progress", label: "Progress", gap: 11, pad: [14, 16], radius: 14, fill: "card" },
    ...list.map(([label, state, when = null]) =>
      row(
        { gap: 10 },
        state === "done"
          ? stack({ w: 18, h: 18 }, circle(18, { fill: "acc" }), centered(ic("check", 12, "accInk")))
          : state === "busy"
            ? spinner(18)
            : state === "fail"
              ? stack({ w: 18, h: 18 }, circle(18, { fill: ERR }), centered(ic("x", 11, "#1d0b08")))
              : box({ w: 18, h: 18, radius: "pill", stroke: "line2", strokeWidth: 2 }),
        t(label, 13.5, { color: state === "todo" ? "mute" : "text" }),
        fill(),
        when ? t(when, 12, { color: state === "fail" ? ERR : "mute" }) : null,
      ),
    ),
  );
}

/** A floating menu: rows of icon and label, an optional danger row last. */
function menu(name, label, items, place, w = 220) {
  return col(
    { name, label, w, pad: 6, gap: 2, radius: 14, fill: "card2", stroke: "line2", place },
    ...items.map(([glyph, text, kind = null]) =>
      kind === "rule"
        ? box({ h: 1, fill: "line2" })
        : row(
            { name: `menu-${slug(text)}`, label: text, gap: 10, pad: [8, 10], radius: 10, fill: kind === "hover" ? "card" : undefined },
            glyph ? ic(glyph, 15, kind === "danger" ? ERR : "body") : null,
            t(text, 13.5, { color: kind === "danger" ? ERR : "text" }),
            fill(),
            kind === "more" ? ic("right", 14, "mute") : kind === "on" ? ic("check", 14, "acc") : null,
          ),
    ),
  );
}

const skeleton = (w, h = 10) => box({ w, h, radius: 6, fill: "card2" });

// ---- the window ------------------------------------------------------------------------------------

const body3 = (...kids) => row({ h: 818, gap: 12, pad: [0, 12], align: "stretch" }, ...kids);

/** The desktop window with optional layers on top (a scrim, a dialog, a notice). */
const shell = (mode, body, { waiting = 2, footer = {}, over = [] } = {}) =>
  stack(
    { w: 1440, h: 900, fill: "bg", theme: L.theme },
    col({ w: 1440, h: 900, place: { x: 0, y: 0 } }, bar(L, mode, waiting, { gear: true }), body, statusLine(L, footer)),
    ...over,
  );

const FACTS = [
  ["Machine", row({ gap: 6 }, ic("desk", 14, "text"), t("DESKTOP", 13, { color: "text" }))],
  ["Runs in", t("Claude Code, command line", 13, { color: "text" })],
  ["Model", t("Sonnet 5.5, high", 13, { color: "text" })],
  ["Reports to", t("overlord-web", 13, { color: "text" })],
];

const HISTORY = [
  message(L, { who: "You", when: "21:05", body: "Add the empty state to the cart page, as drawn on the Cart board.", me: true }),
  message(L, { who: "executor-shop", when: "23:31", body: "Done on feat/cart-empty. The page and its test pass; the board has my notes." }),
];

/** The inspector of one unit. An alias shows as the title, with the real id under it. */
function unitPanel({ glyph = "term", title = "executor-shop", alias = null, status = "work", statusText = "Working on task 029", factsList = FACTS, convo = HISTORY, place = ["Message executor-shop", "The session is notified at once", "bell"], composerNode = null, right = null }) {
  return panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, {
      glyph,
      title: alias ?? title,
      monoTitle: !alias,
      sub: row({ gap: 6 }, status === "busy" ? spinner(10) : dot(status), alias ? mono(title, 11.5, { color: "mute" }) : null, t(statusText, 12.5, { color: "mute" })),
      right: right ?? [row({ gap: 6 }, ibtn(L, "pin", "pin", "Pin"), ibtn(L, "dots", "more", "More"))],
    }),
    factsList ? facts(L, factsList) : null,
    conversation(L, ...convo),
    composerNode ?? composer(L, ...place),
  );
}

function emptyInspector({ title = "Nothing selected", body = "Select a unit or a group on the Map or in Hierarchy to see its chat, its work and what it asks of you.", summary = true, groups = 1, action = button(L, "New unit", "pri", "plus", "new-unit") } = {}) {
  return panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    col(
      { grow: 1, align: "center", justify: "center", gap: 14, pad: 32 },
      stack({ w: 56, h: 56, radius: "pill", fill: "card" }, centered(ic("map", 24, "mute"))),
      t(title, 16, { weight: 700 }),
      t(body, 13.5, { color: "mute", align: "center" }),
      summary
        ? col(
            { gap: 8, pad: [6, 0] },
            row({ gap: 8 }, dot("work"), t("5 units working", 13, { color: "body" })),
            row({ gap: 8 }, dot("wait"), t("2 asks wait on you", 13, { color: "body" })),
            row({ gap: 8 }, dot("idle"), t("3 unread messages", 13, { color: "body" })),
            row({ gap: 8 }, ic("folder", 13, "mute"), t(groups === 1 ? "1 group of yours" : `${groups} groups of yours`, 13, { color: "body" })),
          )
        : null,
      action,
    ),
  );
}

// The flow builds the Checkout launch group on the Map row and renames executor-blog to Blog. Screens
// before that step pass `before`; every later screen shows the group and the alias.
const API_WORK = GROUPS.filter((g) => g.id === "api-work");
const ALIAS = { "executor-blog": "Blog" };
const NODES_AFTER = NODES.map((n) => (ALIAS[n.id] ? { ...n, lab: ALIAS[n.id] } : n));

const mapScreen = ({ tab = "h", sel = null, sideOpts = {}, field: options = {}, inspector, sideNode = null, before = false, renamed = !before, ...rest }) => {
  const groups = before ? API_WORK : GROUPS;
  const alias = renamed ? ALIAS : {};
  const nodes = options.nodes ?? (renamed ? NODES_AFTER : NODES);
  return shell(
    "Map",
    body3(sideNode ?? side(L, tab, sel, { groups, alias, ...sideOpts }), mapField(L, { mode: "none", groups, ...options, nodes }), inspector),
    rest,
  );
};

// A unit created in the flow, placed where the Map has room.
const MOBILE = { id: "executor-mobile", glyph: "term", x: 612, y: 566, sz: 46, status: "idle" };
const NODES_PLUS = [...NODES_AFTER, MOBILE];

const pill = (kids, at) => row({ gap: 7, pad: [6, 10], radius: "pill", fill: "panel", stroke: "line2", place: at }, ...kids);

// ---- setup ------------------------------------------------------------------------------------------

const SETUP_STEPS = 4;

function setup(step, title, sub, kids, { back = true, next = "Continue", nextBusy = false } = {}) {
  return () =>
    stack(
      { w: 1440, h: 900, fill: "bg", theme: L.theme },
      row({ gap: 10, place: { x: 32, y: 26 } }, mark(28), t("HIVEM1ND", 16, { weight: 700, track: 0.06 })),
      col(
        { name: "setup", label: title, w: 640, pad: 32, gap: 22, radius: 24, fill: "panel", stroke: "line", place: "center" },
        row(
          { gap: 6 },
          ...Array.from({ length: SETUP_STEPS }, (_, i) => i + 1).map((i) => box({ w: i === step ? 28 : 8, h: 8, radius: "pill", fill: i <= step ? "acc" : "card2" })),
          space(10),
          t(`Step ${step} of ${SETUP_STEPS}`, 12.5, { color: "mute" }),
        ),
        col({ gap: 8 }, t(title, 24, { weight: 700 }), t(sub, 14.5, { color: "body" })),
        ...kids,
        row({ gap: 10 }, back ? button(L, "Back", "ghost", "back", "back") : null, fill(), nextBusy ? busy(next) : button(L, next, "pri", null, "continue")),
      ),
    );
}

const bullet = (glyph, value) => row({ gap: 12 }, stack({ w: 34, h: 34, radius: 10, fill: "card" }, centered(ic(glyph, 17, "acc"))), t(value, 14, { color: "body" }));
const pathRow = (value, name = "path") =>
  row({ name, label: "Folder", gap: 10, pad: [10, 10, 10, 14], radius: 12, fill: "card", stroke: "line2" }, ic("folder", 16, "mute"), mono(value, 13, { color: "text" }), fill(), button(L, "Change", "plain", null, "change-folder"));
const label = (value) => t(value, 12.5, { weight: 600, color: "mute" });

/** A choice offered in setup as a banner with its box: migrating a 2.x M1ND, or Relay+ when it arrives. */
const offer = (name, title, body, { on = false, soon = false } = {}) =>
  row(
    { name, label: title, gap: 12, pad: [12, 14], radius: 14, fill: soon ? "card" : "waitSoft", stroke: soon ? "line" : undefined, align: "start", opacity: soon ? 0.8 : undefined },
    row({ pad: [1, 0, 0] }, soon ? box({ w: 18, h: 18, radius: 4, stroke: "line2", strokeWidth: 2 }) : tick(on, 18)),
    col(
      { grow: 1, gap: 3 },
      row({ gap: 8 }, t(title, 14, { weight: 700 }), soon ? row({ pad: [2, 8], radius: "pill", fill: "card2" }, t("Coming soon", 11, { weight: 700, color: "mute" })) : null),
      t(body, 12.5, { color: "body" }),
    ),
  );

const setupWelcome = setup(1, "Install HIVEM1ND", "Setup takes about a minute.", [
  col(
    { gap: 12 },
    bullet("graph", "Control the Swarm from the Map"),
    bullet("net", "Organize agents to reach objectives faster and better"),
    bullet("zap", "Relay is used for inter-session communication"),
  ),
], { back: false, next: "Start setup" });

const setupMind = setup(2, "Where the M1ND lives", "The M1ND holds your units, chats, boards and texts. Relay is optimized to run in cloud storage services for free syncing of your preferences.", [
  col({ gap: 8 }, label("Folder"), pathRow(M1ND_PATH)),
  offer("legacy", "Migrate legacy M1ND", "A HIVEM1ND 2.x M1ND was found in C:\\Users\\you\\OneDrive\\HIVEM1ND. It is copied and upgraded; the original stays untouched.", { on: true }),
  offer("relay-plus", "Use Relay+", "Sync your preferences on any device, phones included, through the same service as Nebula+.", { soon: true }),
]);

/** The folder chosen already holds a 3.0 M1ND: this machine joins it instead of making a new one. */
const setupJoin = setup(2, "Where the M1ND lives", "The M1ND holds your units, chats, boards and texts. Relay is optimized to run in cloud storage services for free syncing of your preferences.", [
  col({ gap: 8 }, label("Folder"), pathRow("C:\\Users\\you\\OneDrive\\.m1nd")),
  offer("join", "Join this M1ND", "A HIVEM1ND 3.0 M1ND is already in this folder: 16 units, last used on LAPTOP at 23:40. This machine joins it; nothing in it is replaced.", { on: true }),
  offer("relay-plus", "Use Relay+", "Sync your preferences on any device, phones included, through the same service as Nebula+.", { soon: true }),
], { next: "Join" });

/** Migrating a 2.x M1ND while its sessions run would let two services wake them: they are closed first. */
const setupClose2x = () =>
  stack(
    { w: 1440, h: 900, fill: "bg", theme: L.theme },
    setupMind(),
    scrim(),
    dialog({
      title: "Close HIVEM1ND 2.x first",
      sub: "These 2.x sessions still use the old M1ND. They are closed before the copy, so only the 3.0 service wakes sessions from now on. Their work is saved.",
      kids: [
        col(
          { gap: 6 },
          ...[["overseer", "Claude Code", "DESKTOP"], ["executor-shop", "Codex", "DESKTOP"], ["executor-blog", "Codex app", "LAPTOP, offline"]].map(([unit, client, machine]) =>
            row({ gap: 10, pad: [9, 12], radius: 12, fill: "card" }, ic("term", 15), mono(unit, 12.5, { weight: 700 }), t(client, 12.5, { color: "body" }), fill(), t(machine, 12, { color: "mute" })),
          ),
          t("A session on an offline machine closes the next time that machine starts HIVEM1ND.", 12, { color: "mute" }),
        ),
      ],
      actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Close them and migrate", "pri", null, "close-2x")],
      w: 560,
    }),
  );

const setupService = setup(3, "Starting the Relay service", "One service per machine wakes your sessions and carries messages. It runs while HIVEM1ND needs it and uses nothing while idle.", [
  steps([
    ["M1ND folder created and protected", "done", "2 s"],
    ["Legacy M1ND copied and upgraded", "done", "6 s"],
    ["Service registered for this user", "done", "1 s"],
    ["Starting the service", "busy", "3 s"],
    ["Opening the Map", "todo"],
  ]),
], { back: false, next: "Installing", nextBusy: true });

const setupFailed = setup(3, "Starting the Relay service", "One service per machine wakes your sessions and carries messages. It runs while HIVEM1ND needs it and uses nothing while idle.", [
  steps([
    ["M1ND folder created and protected", "done", "2 s"],
    ["Legacy M1ND copied and upgraded", "done", "6 s"],
    ["Service registered for this user", "done", "1 s"],
    ["Starting the service", "fail", "30 s"],
    ["Opening the Map", "todo"],
  ]),
  col(
    { gap: 8, pad: [12, 14], radius: 14, fill: ERR_SOFT, stroke: ERR },
    t("The service did not start: port 43123 is used by another program.", 13.5, { weight: 700 }),
    t("Nothing outside the M1ND folder was changed. Close that program and retry, or exit; setup resumes from this step when it is opened again.", 13, { color: "body" }),
  ),
], { back: false, next: "Retry" });

const setupDone = setup(4, "HIVEM1ND is running", "The service is running on DESKTOP. To add another machine, install HIVEM1ND there and choose the same M1ND folder.", [
  col(
    { gap: 8, pad: 14, radius: 14, fill: "card" },
    row({ gap: 10 }, ic("folder", 15, "mute"), t("M1ND", 13, { color: "mute" }), fill(), mono(M1ND_PATH, 12.5, { color: "text" })),
    row({ gap: 10 }, ic("retry", 15, "mute"), t("Legacy M1ND", 13, { color: "mute" }), fill(), t("Migrated from 2.x, original untouched", 13, { color: "text" })),
    row({ gap: 10 }, ic("power", 15, "mute"), t("Service", 13, { color: "mute" }), fill(), row({ gap: 6 }, dot("work"), t("Running", 13, { color: "text" }))),
    row({ gap: 10 }, ic("term", 15, "mute"), t("Agents", 13, { color: "mute" }), fill(), t("Claude Code, Codex, Cursor, OpenCode", 13, { color: "text" })),
    row({ gap: 10 }, ic("folder", 15, "mute"), t("Projects", 13, { color: "mute" }), fill(), t("7 repositories in 3 folders", 13, { color: "text" })),
  ),
  t("Agents, projects and content were detected with their defaults; Settings changes any of them.", 12.5, { color: "mute" }),
], { back: false, next: "Open the Map" });

const loading = () =>
  shell(
    "Map",
    body3(
      panel(L, "right", { name: "side", label: "Side panel", w: 266 }, col({ gap: 14, pad: 18 }, skeleton(200, 30), skeleton(230, 34), ...[150, 190, 120, 170, 140, 180, 110].map((w) => skeleton(w)))),
      stack(
        { name: "map", label: "Map", w: 760, fill: "ground", radius: 20, stroke: "line" },
        col({ gap: 12, align: "center", place: "center" }, spinner(28), t("Reading the M1ND", 14, { weight: 600 }), t("16 units, 2 groups, 5 chats, 5 boards", 12.5, { color: "mute" })),
      ),
      panel(L, "left", { name: "inspector", label: "Inspector", w: 366 }, col({ gap: 14, pad: 18 }, skeleton(220, 38), skeleton(300, 70), ...[260, 200, 240].map((w) => skeleton(w, 44)))),
    ),
    { footer: { service: "wait", serviceText: "Connecting to the service", read: "Reading" } },
  );

const loadFailed = () =>
  shell(
    "Map",
    body3(
      panel(L, "right", { name: "side", label: "Side panel", w: 266 }, col({ gap: 14, pad: 18 }, skeleton(200, 30), skeleton(230, 34))),
      stack(
        { name: "map", label: "Map", w: 760, fill: "ground", radius: 20, stroke: "line" },
        col(
          { w: 420, gap: 12, align: "center", place: "center" },
          stack({ w: 52, h: 52, radius: "pill", fill: ERR_SOFT }, centered(ic("alert", 24, ERR))),
          t("The M1ND cannot be read", 16, { weight: 700 }),
          t("C:\\Users\\you\\AppData\\Local\\Cosmic\\.m1nd did not answer in 30 s. The drive may be offline, or another program may hold the folder.", 13, { color: "body", align: "center" }),
          row({ gap: 8 }, button(L, "Retry", "pri", "retry", "retry"), button(L, "Choose another folder", "plain", "folder", "choose-folder")),
        ),
      ),
      panel(L, "left", { name: "inspector", label: "Inspector", w: 366 }, col({ gap: 14, pad: 18 }, skeleton(220, 38))),
    ),
    { footer: { service: "wait", serviceText: "Relay service running on DESKTOP", read: "M1ND not read" } },
  );

const emptyMind = () =>
  mapScreen({
    before: true,
    sideNode: panel(
      L, "right", { name: "side", label: "Side panel", w: 266 },
      tabs(L, [["Hierarchy", "net", true, "tab-hierarchy"], ["Chats", "users", false, "tab-chats"]]),
      search(L),
      col({ pad: [24, 20], gap: 8 }, t("No units yet", 14, { weight: 700 }), t("The Overseer comes first; create it from the inspector.", 13, { color: "mute" })),
    ),
    field: {
      nodes: [{ ...NODES[0] }],
      links: [],
      zones: false,
      groups: [],
      extra: [
        circle(64, { stroke: "acc", strokeWidth: 2, dash: "6 5", place: { x: 340, y: 146 } }),
        col({ w: 200, align: "center", place: { x: 272, y: 220 } }, t("The Overseer goes here", 12.5, { color: "mute" })),
      ],
    },
    inspector: emptyInspector({
      title: "Your M1ND is empty",
      body: "The Overseer coordinates every other unit. Create it first; then add Overlords and Executors from the Map.",
      summary: false,
      action: button(L, "Create the Overseer", "pri", "plus", "create-overseer"),
    }),
    waiting: 0,
  });

// ---- the Map ------------------------------------------------------------------------------------------

const mapIdle = () => mapScreen({ before: true, inspector: emptyInspector() });

const mapSelected = () => mapScreen({ before: true, sel: "executor-shop", field: { sel: "executor-shop" }, inspector: unitPanel({ convo: [...HISTORY, buildAsk(L), reviewAsk(L)] }) });

const BLOG_FACTS = [["Machine", row({ gap: 6 }, ic("lap", 14, "text"), t("LAPTOP", 13, { color: "text" }))], ["Runs in", t("Codex app, started by hand", 13, { color: "text" })], ["Mailbox", t("2 unread", 13, { color: "text" })], ["Reports to", t("overlord-web", 13, { color: "text" })]];
const BLOG_CONVO = [message(L, { who: "overlord-web", when: "22:44", body: "When you start, announce the empty cart on the blog." })];

/** Renaming in place: the field holds the alias, the id stays written under it. */
const renameField = (value) =>
  col(
    { name: "rename", label: "Alias", gap: 4, pad: [4, 8, 4, 24] },
    row({ gap: 8, pad: [6, 10], radius: 9, fill: "card", stroke: "acc" }, ic("term", 15, "body"), t(value, 13.5, { weight: 700, color: "text" }), box({ w: 2, h: 16, fill: "acc" }), fill(), ic("check", 14, "acc")),
    t("Alias only. The id stays executor-blog; Enter saves, Esc cancels.", 11.5, { color: "mute" }),
  );

const mapRename = () =>
  mapScreen({
    before: true,
    renamed: false,
    sel: "executor-blog",
    sideOpts: { renaming: { id: "executor-blog", node: renameField("Blog") } },
    field: { sel: "executor-blog" },
    inspector: unitPanel({ title: "executor-blog", status: "idle", statusText: "No session", factsList: BLOG_FACTS, convo: BLOG_CONVO, place: ["Message executor-blog", "It waits in the mailbox until a session starts", "mail"] }),
  });

const mapRenamed = () =>
  mapScreen({
    before: true, renamed: true,
    sel: "executor-blog",
    field: { sel: "executor-blog" },
    inspector: unitPanel({ title: "executor-blog", alias: "Blog", status: "idle", statusText: "No session", factsList: BLOG_FACTS, convo: BLOG_CONVO, place: ["Message Blog", "It waits in the mailbox until a session starts", "mail"] }),
    over: [toast("executor-blog shows as Blog", "Undo")],
  });

const connectRow = (from, to) =>
  row({ gap: 12, pad: 14, radius: 14, fill: "card", justify: "center" }, avatar(L, "term", 34, 16), mono(from, 13, { weight: 700 }), t("reports to", 13, { color: "mute" }), avatar(L, "net", 34, 16), mono(to, 13, { weight: 700 }));

const mapConnect = () =>
  mapScreen({
    before: true, renamed: true,
    field: { mode: "connect" },
    inspector: emptyInspector(),
    over: [
      scrim(),
      dialog({
        title: "Connect executor-site",
        sub: "executor-site will report to overlord-web. Groups and chats do not change.",
        kids: [connectRow("executor-site", "overlord-web")],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Connect", "pri", null, "connect")],
      }),
    ],
  });

const SITE = NODES.find((n) => n.id === "executor-site");
const mapConnectSaving = () =>
  mapScreen({
    before: true, renamed: true,
    sel: "executor-site",
    field: {
      sel: "executor-site",
      links: [...LINKS, ["overlord-web", "executor-site"]],
      extra: [pill([spinner(12), t("Saving", 12, { color: "body" })], { x: SITE.x + 34, y: SITE.y - 14 })],
    },
    inspector: unitPanel({
      title: "executor-site", status: "idle", statusText: "No session",
      factsList: [["Machine", t("LAPTOP", 13, { color: "text" })], ["Runs in", t("Codex, command line", 13, { color: "text" })], ["Model", t("GPT 6.1 Sol, high", 13, { color: "text" })], ["Reports to", row({ gap: 6 }, spinner(11), t("overlord-web", 13, { color: "text" }))]],
      convo: [message(L, { who: "executor-site", when: "Yesterday", body: "The landing hero is live on staging." })],
      place: ["Message executor-site", "No session: the message waits in its mailbox", "mail"],
    }),
    over: [toast("executor-site now reports to overlord-web", "Undo")],
  });

const SELECTED = [["executor-shop", "term", "work"], ["overlord-web", "net", "work"], ["executor-blog", "term", "idle"]];

const selectionPanel = () =>
  panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, { glyph: "users", title: "3 selected", monoTitle: false, sub: t("A drag on empty space selects; Shift adds", 12.5, { color: "mute" }) }),
    col({ gap: 2, pad: [8, 12] }, ...SELECTED.map(([id, glyph, status]) => unitRow(L, { id, glyph, status, alias: ALIAS[id] ?? null }))),
    col(
      { gap: 10, pad: [8, 18] },
      button(L, "Save as group", "pri", "folder-plus", "save-group"),
      button(L, "Message all 3", "plain", "send", "message-all"),
      button(L, "Connect to a lead", "plain", "net", "connect-lead"),
      button(L, "Clear selection", "ghost", null, "clear"),
    ),
    col({ pad: [6, 18] }, t("A group keeps these units together: a folder in Hierarchy, a zone on the Map and one group chat.", 12.5, { color: "mute" })),
  );

const mapSelection = () => mapScreen({ before: true, renamed: true, field: { mode: "select", group: SELECTED.map(([id]) => id) }, inspector: selectionPanel() });

const memberChip = (id) => row({ gap: 6, pad: [5, 10], radius: "pill", fill: "card2" }, ic("term", 13), t(ALIAS[id] ?? id, 12.5, { weight: 600, color: "text" }), ic("x", 12, "mute"));

const mapNewGroup = () =>
  mapScreen({
    before: true, renamed: true,
    field: { group: SELECTED.map(([id]) => id) },
    inspector: selectionPanel(),
    over: [
      scrim(),
      dialog({
        title: "New group",
        sub: "A folder in Hierarchy, a zone on the Map and one group chat. Who reports to whom does not change.",
        kids: [
          field("Name", "Checkout launch"),
          col({ gap: 8 }, label("Members"), row({ gap: 8 }, ...SELECTED.map(([id]) => memberChip(id)), row({ gap: 5, pad: [5, 10], radius: "pill", stroke: "line2" }, ic("plus", 13, "mute"), t("Add", 12.5, { color: "mute" })))),
        ],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Create group", "pri", null, "create-group")],
        w: 520,
      }),
    ],
  });

const groupPanel = () =>
  panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, {
      glyph: "folder",
      title: "Checkout launch",
      monoTitle: false,
      sub: t("Group, 3 units", 12.5, { color: "mute" }),
      right: [row({ gap: 6 }, avatars(L), ibtn(L, "dots", "more", "Rename, members, delete"))],
    }),
    facts(L, [
      ["Members", t("executor-shop, overlord-web, Blog", 12.5, { color: "text" })],
      ["Created", t("Today 22:40", 13, { color: "text" })],
    ]),
    conversation(
      L,
      message(L, { who: "You", when: "22:40", body: "Checkout launch tonight: shop finishes the empty state, Blog announces it, web reviews.", me: true }),
      message(L, { who: "overlord-web", when: "22:44", body: "Understood. I review task 029 when it lands." }),
      message(L, { who: "executor-shop", when: "23:31", body: "Empty state done, task 029 delivered." }),
      message(L, { who: "Blog", when: "23:38", body: "The announcement post is drafted and waits for the merge." }),
    ),
    composer(L, "Message the group", "Every member sees every reply", "users"),
  );

const mapGroup = () =>
  mapScreen({
    sideOpts: { open: "checkout-launch", groupSel: "checkout-launch" },
    field: { groupSel: "checkout-launch" },
    inspector: groupPanel(),
    over: [toast("Checkout launch created", "Undo")],
  });

const mapDeleteGroup = () =>
  mapScreen({
    sideOpts: { open: "checkout-launch", groupSel: "checkout-launch" },
    field: { groupSel: "checkout-launch" },
    inspector: groupPanel(),
    over: [
      scrim(),
      dialog({
        title: "Delete the group Checkout launch?",
        sub: "Its folder and its zone go. Its chat moves to Archived in Chats. The three units, their chats and who they report to do not change.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Delete group", "delete-group")],
      }),
    ],
  });

function newUnitDialog({ creating = false, open = false } = {}) {
  const kids = [
    pairOf(field("Name", "executor-mobile", { disabled: creating }), field("Role", "Executor", { select: true, disabled: creating })),
    pairOf(field("Project", "mobile", { select: true, disabled: creating }), field("Machine", "DESKTOP, this machine", { select: true, glyph: "desk", disabled: creating })),
    pairOf(field("Reports to", "No Overlord", { select: true, disabled: creating }), field("Group", "None", { select: true, glyph: "folder", disabled: creating })),
  ];
  const actions = creating ? [button(L, "Cancel", "ghost", null, "cancel"), busy("Creating")] : [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Create unit", "pri", null, "create-unit")];
  const over = [scrim(), dialog({ title: "New unit", sub: "It appears on the Map at once; start its session when you need it.", kids, actions, w: 560 })];
  if (open) {
    over.push(
      col(
        { name: "machine-menu", label: "Machines", w: 262, pad: 6, gap: 2, radius: 14, fill: "card2", stroke: "line2", place: { x: 727, y: 500 } },
        row({ gap: 10, pad: [9, 10], radius: 10, fill: "card" }, ic("desk", 15), t("DESKTOP, this machine", 13.5), fill(), ic("check", 14, "acc")),
        row({ gap: 10, pad: [9, 10], opacity: 0.55 }, ic("lap", 15), col({ gap: 1 }, t("LAPTOP", 13.5), t("Offline since 23:40", 11.5, { color: "mute" }))),
      ),
    );
  }
  return mapScreen({ inspector: emptyInspector({ groups: 2 }), over });
}

const mapNewUnit = () => newUnitDialog({ open: true });
const mapCreating = () => newUnitDialog({ creating: true });

const mobilePanel = (extra = {}) =>
  unitPanel({
    title: "executor-mobile", status: "idle", statusText: "No session",
    factsList: [["Machine", row({ gap: 6 }, ic("desk", 14, "text"), t("DESKTOP", 13, { color: "text" }))], ["Runs in", t("Not started", 13, { color: "mute" })], ["Model", t("The client's default", 13, { color: "text" })], ["Reports to", t("No Overlord", 13, { color: "text" })]],
    convo: [col({ gap: 12, pad: [24, 8], align: "center" }, t("No messages yet", 14, { weight: 700 }), t("Messages wait in its mailbox until a session starts.", 13, { color: "mute", align: "center" }), button(L, "Start session", "pri", "play", "start-session"))],
    place: ["Message executor-mobile", "No session: the message waits in its mailbox", "mail"],
    ...extra,
  });

const MOBILE_COUNT = { sideOpts: { projects: { site: "1", data: "2", mobile: "5" } } };
const mapCreated = () =>
  mapScreen({ ...MOBILE_COUNT, sel: "executor-mobile", field: { nodes: NODES_PLUS, sel: "executor-mobile" }, inspector: mobilePanel(), over: [toast("executor-mobile created", "Start a session")] });

const mapStartSession = () =>
  mapScreen({
    ...MOBILE_COUNT,
    field: { nodes: NODES_PLUS, sel: "executor-mobile" },
    inspector: mobilePanel(),
    over: [
      scrim(),
      dialog({
        title: "Start a session",
        sub: "executor-mobile on DESKTOP. The session runs in an agent CLI; only CLIs connected on that machine are offered.",
        kids: [
          col(
            { gap: 10 },
            option("Claude Code", "CLI connected.", { sel: true, glyph: "term", compact: true }),
            option("Codex", "CLI connected.", { glyph: "term", compact: true }),
            option("Cursor", "Its CLI needs 2 changes first: Settings, Agents.", { glyph: "term", badge: "Changes needed", disabled: true, compact: true }),
          ),
          col(
            { gap: 8 },
            label("Runs as"),
            segment([["One task, then it closes", true], ["Chat, kept open", false]], "runs-as"),
            t("An Executor applies one feature: by default it runs its task and closes. Opened on its own it is a chat, and from there it can open the CLIs it needs.", 12, { color: "mute" }),
          ),
          field("Task or first message", "Add the empty state to the cart page", {}),
          t("To run it by hand instead, open an agent's app and run /executor mobile.", 12, { color: "mute" }),
        ],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Start session", "pri", "play", "start")],
        w: 520,
      }),
    ],
  });

const startingNode = { x: MOBILE.x - 30, y: MOBILE.y - 30 };
const mapStarting = () =>
  mapScreen({
    ...MOBILE_COUNT,
    field: { nodes: NODES_PLUS, sel: "executor-mobile", extra: [{ ...spinner(60), place: startingNode }] },
    inspector: mobilePanel({
      status: "busy",
      statusText: "Starting a session",
      convo: [
        steps([["Request sent", "done", "23:44:02"], ["Starting Claude Code on DESKTOP", "busy", "6 s"], ["Session connected", "todo"]]),
        row({ gap: 8, justify: "end" }, button(L, "Cancel start", "ghost", null, "cancel-start")),
      ],
      place: ["Message executor-mobile", "Sent now, it is delivered when the session connects", "mail"],
    }),
  });

const mapStartFailed = () =>
  mapScreen({
    ...MOBILE_COUNT,
    field: { nodes: NODES_PLUS, sel: "executor-mobile" },
    inspector: mobilePanel({
      convo: [
        steps([["Request sent", "done", "23:44:02"], ["Starting Claude Code on DESKTOP", "fail", "30 s"], ["Session connected", "todo"]]),
        col(
          { gap: 8, pad: [12, 14], radius: 14, fill: ERR_SOFT, stroke: ERR },
          t("Claude Code did not answer in 30 seconds.", 13.5, { weight: 700 }),
          t("Nothing was started. It may still be updating; try again, or choose another client.", 13, { color: "body" }),
          row({ gap: 8 }, button(L, "Retry", "pri", "retry", "retry"), button(L, "Choose another client", "plain", null, "other-client")),
        ),
      ],
    }),
  });

const mapStop = () =>
  mapScreen({
    sel: "executor-shop",
    field: { sel: "executor-shop" },
    inspector: unitPanel({}),
    over: [
      scrim(),
      dialog({
        title: "Stop the session of executor-shop?",
        sub: "Its work in progress stops. The unit keeps its chat, mailbox, tasks and groups, and a new session can start later.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Stop session", "stop")],
      }),
    ],
  });

const mapRemoveUnit = () =>
  mapScreen({
    ...MOBILE_COUNT,
    sel: "executor-mobile",
    field: { nodes: NODES_PLUS, sel: "executor-mobile" },
    inspector: mobilePanel(),
    over: [
      scrim(),
      dialog({
        title: "Remove executor-mobile?",
        sub: "It leaves the Map and Hierarchy. Its chat and mailbox move to Archived and its tasks stay in the project. A session running now is stopped first.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Remove unit", "remove-unit")],
      }),
    ],
  });

// ---- chats and what waits on the person ------------------------------------------------------------

const chatScreen = (convo, rest = {}) =>
  mapScreen({ tab: "c", sel: "shop", field: { sel: "executor-shop" }, inspector: unitPanel({ convo, ...rest }) });

const chatList = () => chatScreen([...HISTORY, buildAsk(L), reviewAsk(L)]);
const chatSending = () => chatScreen([...HISTORY, mine("Add a Continue shopping button to the empty state too.", "Sending", { sending: true })]);
const chatWorking = () => chatScreen([...HISTORY, mine("Add a Continue shopping button to the empty state too.", "Delivered 23:45"), working("executor-shop", "38 s", true)]);
const chatOpenCli = () =>
  mapScreen({
    tab: "c", sel: "shop", field: { sel: "executor-shop" }, waiting: 3,
    inspector: unitPanel({
      convo: [
        HISTORY[1],
        working("executor-shop", "4 min", true),
        ask(L, [ic("term", 15, "text"), t("Asks to open a session", 13, { color: "text" }), code("Codex CLI on DESKTOP")], [button(L, "Approve", "pri", "check", "approve-cli"), button(L, "Deny", "ghost", null, "deny-cli")]),
      ],
    }),
  });
const chatReply = () =>
  chatScreen([
    HISTORY[1],
    mine("Add a Continue shopping button to the empty state too.", "Read 23:45"),
    message(L, { who: "executor-shop", when: "23:47", body: "Added. The button goes back to the catalog; the board shows it on the empty cart." }),
  ]);
const chatFailed = () =>
  chatScreen([...HISTORY, mine("Add a Continue shopping button to the empty state too.", "Not confirmed: the service did not answer in 10 s.", { failed: true })], {
    composerNode: composer(L, "Message executor-shop", "Retry sends the same message once; it is never sent twice", "retry"),
  });

const mailbox = () =>
  mapScreen({
    sel: "executor-blog",
    field: { sel: "executor-blog" },
    inspector: unitPanel({
      title: "executor-blog", alias: "Blog", status: "idle", statusText: "No session",
      factsList: BLOG_FACTS,
      convo: [
        col(
          { gap: 8, pad: [12, 14], radius: 14, fill: "waitSoft" },
          row({ gap: 8 }, ic("mail", 15, "wait"), t("Blog is not running", 13.5, { weight: 700 })),
          t("LAPTOP has been offline since 23:40. Messages wait in the mailbox and are delivered when Blog starts again there.", 13, { color: "body" }),
          row({ gap: 8 }, row({ opacity: 0.5 }, button(L, "Start session", "plain", "play", "start-session")), t("Needs LAPTOP online", 12, { color: "mute" })),
        ),
        ...BLOG_CONVO,
        message(L, { who: "You", when: "23:12", body: "Draft the post tonight; publish after the merge.", me: true }),
      ],
      place: ["Message Blog", "It waits in the mailbox until a session starts", "mail"],
    }),
  });

function waitingSide() {
  const item = (glyph, title, who, when, kind) =>
    row(
      { name: `waiting-${slug(title)}`, label: title, gap: 10, pad: [10, 10], radius: 10, fill: kind === "sel" ? "card2" : undefined },
      avatar(L, glyph),
      col({ grow: 1, gap: 2 }, t(title, 13.5, { weight: 700, lines: 1 }), row({ gap: 6 }, mono(who, 11.5, { color: "mute" }), t(when, 11.5, { color: "mute" }))),
      kind === "expired" ? t("Expired", 11.5, { color: "mute" }) : dot("wait"),
    );
  return panel(
    L, "right", { name: "side", label: "Waiting on you", w: 266 },
    row({ gap: 8, pad: [16, 14, 6] }, ibtn(L, "back", "back", "Back to Hierarchy"), t("Waiting on you", 15, { weight: 700 }), fill(), t("2", 13, { weight: 700, color: "wait" })),
    search(L),
    col(
      { gap: 2, pad: [0, 6] },
      heading(L, "Asks"),
      item("hand", "Run npm run build", "executor-shop", "23:32", "sel"),
      heading(L, "Reviews"),
      item("task", "Task 029: cart empty state", "executor-shop", "23:31"),
      heading(L, "Ended without an answer"),
      item("hand", "Push to the remote", "executor-api", "Yesterday", "expired"),
    ),
  );
}

const waiting = () =>
  mapScreen({ sel: "executor-shop", sideNode: waitingSide(), field: { sel: "executor-shop" }, inspector: unitPanel({ convo: [HISTORY[1], buildAsk(L), reviewAsk(L)] }) });

const answered = (value) =>
  row({ gap: 8, pad: [10, 12], radius: 14, fill: "card" }, stack({ w: 18, h: 18 }, circle(18, { fill: "acc" }), centered(ic("check", 12, "accInk"))), t(value, 13, { color: "body" }));

const approvalSent = () =>
  mapScreen({
    sel: "executor-shop",
    sideNode: waitingSide(),
    field: { sel: "executor-shop" },
    inspector: unitPanel({
      convo: [
        HISTORY[1],
        ask(L, [ic("hand", 15, "text"), t("Asks to run", 13, { color: "text" }), code("npm run build")], [busy("Answer sent"), t("waiting for executor-shop to confirm", 12, { color: "mute" })]),
        reviewAsk(L),
      ],
    }),
  });

const sendBack = () =>
  mapScreen({
    sel: "executor-shop",
    field: { sel: "executor-shop" },
    inspector: unitPanel({ convo: [HISTORY[1], answered("Approved 23:46: npm run build"), reviewAsk(L)] }),
    over: [
      scrim(),
      dialog({
        title: "Send task 029 back",
        sub: "executor-shop reads your note and the task goes back to open.",
        kids: [field("What needs to change", "The empty state needs the Continue shopping button from the board.")],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Send back", "pri", null, "send-back")],
      }),
    ],
  });

const accepted = () =>
  mapScreen({
    sel: "executor-shop",
    field: { sel: "executor-shop" },
    inspector: unitPanel({ statusText: "Idle, task 029 done", status: "idle", convo: [HISTORY[1], answered("Approved 23:46: npm run build"), answered("Accepted 23:48: task 029")] }),
    waiting: 0,
    over: [toast("Task 029 accepted", "Undo")],
  });

// ---- Blueprint ----------------------------------------------------------------------------------------

const BOARD_FOLDERS = (cart = "sel", flow = null) => [
  { name: "shop", open: true, items: [["Cart page", "1", cart], ["Checkout flow", null, flow]] },
  { name: "api", open: false, count: 2, items: [] },
  { name: "site", open: false, count: 1, items: [] },
];
const boards = (opts = {}) => library(L, { title: "Boards", glyph: "grid", folders: BOARD_FOLDERS(), ...opts });

/** The board's tools: select, frame, text, draw and comment, in the same bar as the attached agents. */
const tools = (on = "select") =>
  row(
    { name: "tools", label: "Tools", gap: 2, pad: 2, radius: 10, fill: "card" },
    ...[["cursor", "select", "Select"], ["square", "frame", "Frame"], ["type", "text", "Text"], ["brush", "draw", "Draw"], ["comment", "comment", "Comment"]].map(([glyph, name, value]) =>
      stack({ name: `tool-${name}`, label: value, w: 32, h: 32, radius: 8, fill: on === name ? "acc" : undefined }, centered(ic(glyph, 15, on === name ? "accInk" : "body"))),
    ),
  );

const divider = () => box({ w: 1, h: 22, fill: "line2" });
const attachButton = (value = "Attach agents") => button(L, value, "plain", "plus", "attach");
const attachedBar = (watching = false) => [t("Attached", 13, { color: "body" }), chip(L, "term", "executor-shop"), chip(L, "net", "overlord-web"), watch(L, watching ? "Watching" : "Watch", watching, "eye", "watch")];

function bpCanvas(barKids, extra = [], { tool = "select" } = {}) {
  return editorGround(
    L, "board-canvas", "Board",
    toolbar(L, tools(tool), divider(), ...barKids),
    ...artboard(L, 70, "Cart, empty", "art-empty", [wireLine(20, 22, 120), wire(20, 56, 260, 150), wireLine(60, 236, 180), wireLine(80, 256, 140), wire(70, 300, 160, 40, true)]),
    ...artboard(L, 420, "Cart, with items", "art-items", [wireLine(20, 22, 120), wire(20, 56, 260, 64), wire(20, 130, 260, 64)]),
    ...extra,
  );
}

const noComments = (agent = { on: true, who: "Notifies 2 attached agents" }) =>
  panel(
    L, "left", { name: "comments", label: "Comments", w: 368 },
    inspectorHead(L, { glyph: "grid", title: "Comments", monoTitle: false, sub: t("Cart page", 12.5, { color: "mute" }) }),
    col({ grow: 1, gap: 8, pad: 32, align: "center", justify: "center" }, t("No comments yet", 14, { weight: 700 }), t("Select an element on the board and press C to comment on it.", 13, { color: "mute", align: "center" })),
    composer(L, "Comment on the board", null, null, false, agent),
  );

const bpScreen = (lib, canvas, comments, rest = {}) => shell("Blueprint", editorBody(L, lib, canvas, comments), { waiting: 2, ...rest });

const bpBoard = () => bpScreen(boards(), bpCanvas([t("No agents attached", 13, { color: "mute" }), attachButton()]), noComments({ none: true }));

const bpLibraryMenu = () =>
  bpScreen(
    boards({ folders: BOARD_FOLDERS("sel", "menu") }),
    bpCanvas(attachedBar()),
    noComments(),
    {
      over: [
        menu("item-menu", "Board menu", [["pen", "Rename"], ["copy", "Duplicate"], ["folder", "Move to folder", "more"], [null, "", "rule"], ["trash", "Delete", "danger"]], { x: 130, y: 246 }),
      ],
    },
  );

const bpNewBoard = () =>
  bpScreen(boards(), bpCanvas(attachedBar()), noComments(), {
    over: [
      scrim(),
      dialog({
        title: "New board",
        sub: "A board lives in a project's repository, in one of your folders.",
        kids: [
          pairOf(field("Name", "Checkout errors"), field("Project", "shop", { select: true, glyph: "grid", hint: "The board's file lives in this repository" })),
          field("Folder", "shop", { select: true, glyph: "folder" }),
          col(
            { gap: 10 },
            option("Empty board", "Start with one frame and draw.", { sel: true, glyph: "square", compact: true }),
            option("Duplicate a board", "Copy the screens of a board you choose; comments stay behind.", { glyph: "copy", compact: true }),
            option("Import a Blueprint Lite 2.x board", "A JSON copy is made next to the module and opened here; the module stays untouched.", { glyph: "grid", compact: true }),
          ),
        ],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Create board", "pri", null, "create-board")],
        w: 560,
      }),
    ],
  });

const bpMove = () =>
  bpScreen(boards({ folders: BOARD_FOLDERS("sel", "menu") }), bpCanvas(attachedBar()), noComments(), {
    over: [
      scrim(),
      dialog({
        title: "Move Checkout flow to api?",
        sub: "The folder api belongs to another project. The board's file moves from the shop repository to the api repository, and both repositories show the change.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Move to api", "pri", null, "move")],
      }),
    ],
  });

const bpSearch = () =>
  bpScreen(
    library(L, {
      title: "Boards", glyph: "grid", query: "cart", filters: ["Open comments"],
      folders: [
        { name: "shop", open: true, items: [["Cart page", "1", "sel"]] },
        { name: "site", open: true, items: [["Cart promo", "2"]] },
      ],
    }),
    bpCanvas(attachedBar()),
    noComments(),
    {
      over: [
        menu("filter-menu", "Filters", [["comment", "Open comments", "on"], ["users", "Attached agents"], ["retry", "Changed this week"], [null, "", "rule"], ["folder", "Project: all", "more"]], { x: 168, y: 112 }, 230),
      ],
    },
  );

const bpDelete = () =>
  bpScreen(boards({ folders: BOARD_FOLDERS("sel", "menu") }), bpCanvas(attachedBar()), noComments(), {
    over: [
      scrim(),
      dialog({
        title: "Delete Checkout flow?",
        sub: "Its screens, sketches and comments go with it, and attached agents are told. A copy committed before stays in the repository's history.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Delete board", "delete")],
      }),
    ],
  });

/** A selected element: its frame, the handles at its corners and a bar with what can change. */
function selection(x, y, w, h) {
  const handle = (hx, hy) => box({ w: 9, h: 9, radius: 2, fill: "panel", stroke: "acc", strokeWidth: 2, place: { x: hx - 4, y: hy - 4 } });
  return [
    box({ name: "selected", label: "Selected element", w, h, stroke: "acc", strokeWidth: 2, radius: 4, place: { x, y } }),
    handle(x, y), handle(x + w, y), handle(x, y + h), handle(x + w, y + h),
    row(
      { name: "element-bar", label: "Element", gap: 10, pad: [7, 10], radius: 12, fill: "panel", stroke: "line2", place: { x: x - 30, y: y + h + 16 } },
      t("Button", 12.5, { weight: 700 }),
      mono("160 × 40", 12, { color: "mute" }),
      divider(),
      row({ gap: 6 }, box({ w: 14, h: 14, radius: 4, fill: "acc" }), t("Fill", 12.5, { color: "body" })),
      row({ gap: 6 }, ic("type", 13), t("Continue shopping", 12.5, { color: "text" })),
      ic("dots", 15),
    ),
  ];
}

const bpEdit = () =>
  bpScreen(
    boards(),
    bpCanvas(attachedBar(), selection(140, 420, 160, 40)),
    noComments(),
  );

// A hand sketch: strokes drawn on the board itself, beside the screens.
const STROKES = [
  "M8 10 C 20 7, 34 12, 50 9 S 78 7, 92 12",
  "M11 23 C 30 21, 60 24, 88 22 C 89 34, 87 46, 89 57 C 62 59, 34 56, 10 58 C 11 46, 9 34, 12 24",
  "M20 32 L 78 50 M 78 31 L 22 49",
  "M14 66 C 26 64, 40 67, 54 65 S 66 66, 72 65",
  "M14 74 C 24 73, 36 76, 46 74 S 54 75, 58 74",
  "M30 84 C 44 83, 58 85, 70 84 C 71 87, 69 90, 70 92 C 56 93, 42 91, 30 92 C 29 89, 31 86, 30 85",
];
const SKETCH_X = 420;
const sketchFrame = () => [
  t("Sketch: cart error", 12, { color: "mute", place: { x: SKETCH_X + 2, y: 98 } }),
  stack(
    { name: "sketch", label: "Hand sketch", w: 300, h: 560, radius: 18, fill: "card", stroke: "acc", dash: "6 5", place: { x: SKETCH_X, y: 120 } },
    vector({ w: 270, h: 500, d: STROKES.join(" "), stroke: "text", strokeWidth: 2.2, place: { x: 15, y: 24 } }),
    row({ gap: 4, align: "start", place: { x: 232, y: 480 } }, ic("brush", 18, "acc")),
  ),
];

const bpSketch = () =>
  bpScreen(
    boards(),
    editorGround(
      L, "board-canvas", "Board",
      toolbar(
        L, tools("draw"), divider(),
        row({ gap: 6 }, ...["text", "acc", "wait"].map((c, i) => stack({ w: 22, h: 22, radius: "pill", stroke: i === 0 ? "acc" : undefined, strokeWidth: 2 }, centered(box({ w: 14, h: 14, radius: "pill", fill: c }))))),
        divider(),
        row({ gap: 10 }, t("Pen", 12.5, { weight: 700, color: "text" }), t("Marker", 12.5, { color: "mute" }), t("Eraser", 12.5, { color: "mute" })),
        divider(),
        ...attachedBar().slice(1, 3),
      ),
      ...artboard(L, 70, "Cart, empty", "art-empty", [wireLine(20, 22, 120), wire(20, 56, 260, 150), wireLine(60, 236, 180), wireLine(80, 256, 140), wire(70, 300, 160, 40, true)]),
      ...sketchFrame(),
    ),
    noComments(),
  );

const bpAttach = () =>
  bpScreen(
    boards(),
    bpCanvas(
      [t("No agents attached", 13, { color: "mute" }), attachButton()],
      [
        col(
          { name: "attach-picker", label: "Attach agents", w: 300, pad: 12, gap: 8, radius: 16, fill: "panel", stroke: "line2", place: "top-center", dy: 64 },
          row({ gap: 8, pad: [8, 10], radius: 10, fill: "card" }, ic("search", 14, "mute"), t("Search units and groups", 13, { color: "mute" })),
          ...[["executor-shop", "term", true], ["overlord-web", "net", true], ["Blog", "term", false], ["Checkout launch", "folder", false]].map(([id, glyph, on]) =>
            row({ gap: 10, pad: [7, 8] }, tick(on, 18), ic(glyph, 15), t(id, 12.5, { color: "text" })),
          ),
          row({ gap: 8, justify: "end" }, button(L, "Cancel", "ghost", null, "cancel"), button(L, "Attach 2", "pri", null, "attach-save")),
        ),
      ],
    ),
    noComments({ none: true }),
  );

const bpComment = () =>
  bpScreen(
    boards(),
    bpCanvas(attachedBar(), [
      box({ w: 160, h: 40, radius: 7, stroke: "acc", strokeWidth: 2, place: { x: 140, y: 420 } }),
      { ...pin(26, "1"), place: { x: 300, y: 404 } },
      col(
        { name: "comment-composer", label: "New comment", w: 320, pad: 14, gap: 10, radius: 16, fill: "panel", stroke: "line2", place: { x: 332, y: 400 } },
        row({ gap: 8 }, ic("grid", 14, "mute"), t("Cart, empty / Continue button", 12, { color: "mute" })),
        row({ pad: [10, 12], radius: 12, fill: "card", stroke: "line2" }, t("Add a button back to the shop under the message.", 13.5, { color: "text" })),
        row({ gap: 8 }, tick(true), t("Send to agent", 12.5, { weight: 600, color: "text" }), t("executor-shop, overlord-web", 12, { color: "mute" })),
        row({ gap: 8, justify: "end" }, button(L, "Cancel", "ghost", null, "cancel"), button(L, "Comment", "pri", null, "comment")),
      ),
    ], { tool: "comment" }),
    noComments(),
  );

const bpCommentSent = () =>
  bpScreen(
    boards(),
    bpCanvas(attachedBar(), [{ ...pin(26, "1"), place: { x: 300, y: 404 } }]),
    commentsPanel(L, {
      glyph: "grid",
      sub: "Cart page, 1 open thread",
      thread: [
        comment(L, { who: "You", when: "23:12", pinLabel: "1", body: "Add a button back to the shop under the message." }),
        row({ gap: 6, pad: [0, 0, 0, 4] }, ic("check", 12, "mute"), t("Sent to executor-shop and overlord-web", 12, { color: "mute" })),
        working("executor-shop", "reading the board"),
      ],
      reply: "Reply on the board",
    }),
  );

function bpWatchCanvas() {
  return bpCanvas(attachedBar(true), [
    box({ name: "drawing", label: "Shape being drawn", w: 260, h: 64, radius: 8, stroke: "acc", strokeWidth: 2, dash: "6 4", fill: "accSoft", place: { x: 440, y: 324 } }),
    row(
      { name: "agent-cursor", label: "The agent drawing", gap: 4, align: "start", place: { x: 640, y: 370 } },
      ic("cursor", 18, "text"),
      col({ pad: [14, 0, 0] }, row({ pad: [3, 8], radius: 6, fill: "acc" }, mono("executor-shop", 11.5, { weight: 700, color: "accInk" }))),
    ),
    { ...pin(26), name: "pin-1", label: "Comment 1", place: { x: 240, y: 300 } },
  ]);
}

const bpWatch = () =>
  bpScreen(
    boards(),
    bpWatchCanvas(),
    commentsPanel(L, {
      glyph: "grid",
      sub: "Cart page, 1 open thread",
      thread: [
        comment(L, { who: "You", when: "23:12", pinLabel: "1", body: "Add a button back to the shop under the message." }),
        comment(L, { who: "executor-shop", when: "23:13", reply: true, live: true, body: "Adding a button to Continue shopping, and drawing the row with an item now." }),
      ],
      reply: "Reply on the board",
    }),
  );

const bpConflict = () =>
  bpScreen(
    boards(),
    bpCanvas(attachedBar(), [{ ...banner("wait", "executor-shop changed this board.", [button(L, "Show changes", "plain", null, "show-changes"), button(L, "Keep mine", "ghost", null, "keep-mine"), button(L, "Reload", "pri", "retry", "reload")]), dy: 66 }]),
    noComments({ on: false }),
  );
// The conflict's two answers both keep a copy in History.

/** History: every change to a board, by the person or an agent, with Restore. */
const historyPanel = (glyph, sub, items) =>
  panel(
    L, "left", { name: "history", label: "History", w: 368 },
    inspectorHead(L, { glyph, title: "History", monoTitle: false, sub: t(sub, 12.5, { color: "mute" }) }),
    col(
      { name: "versions", label: "Versions", grow: 1, gap: 6, pad: [12, 14] },
      ...items.map(([when, who, what, current]) =>
        row(
          { gap: 10, pad: [10, 12], radius: 12, fill: current ? "card2" : "card" },
          col({ grow: 1, gap: 2 }, row({ gap: 8 }, mono(who, 12, { weight: 700 }), t(when, 12, { color: "mute" })), t(what, 13, { color: "body" })),
          current ? t("Current", 12, { weight: 700, color: "acc" }) : button(L, "Restore", "plain", "undo", `restore-${slug(when)}`),
        ),
      ),
    ),
    col({ pad: [8, 16, 16] }, t("Restoring keeps the current version in the list, so it can be restored back.", 12, { color: "mute" })),
  );

const bpHistory = () =>
  bpScreen(
    boards(),
    bpCanvas([...attachedBar(), stack({ name: "history", label: "History", w: 32, h: 32, radius: 8, fill: "acc" }, centered(ic("retry", 15, "accInk")))]),
    historyPanel("grid", "Cart page", [
      ["23:18", "You", "Kept your version after the conflict", true],
      ["23:17", "executor-shop", "Drew the row with an item on Cart, with items"],
      ["23:13", "executor-shop", "Added Continue shopping on Cart, empty"],
      ["23:12", "You", "Commented on Cart, empty / Continue button"],
      ["22:58", "You", "Created the board"],
    ]),
  );

// ---- Void ---------------------------------------------------------------------------------------------

const TEXT_FOLDERS = (notes = "sel", guide = null) => [
  { name: "Release", open: true, items: [["Release notes 3.0", "1", notes], ["Install guide", null, guide]] },
  { name: "Manuals", open: true, items: [["Relay manual"], ["Squad rules"]] },
  { name: "Drafts", open: false, count: 3, items: [] },
];
const texts = (opts = {}) => library(L, { title: "Texts", glyph: "pen", folders: TEXT_FOLDERS(), ...opts });

function docCard(kids, { dy = 70, h = 760 } = {}) {
  return col(
    { name: "document", label: "Document", w: 640, h, pad: [44, 56], radius: 20, fill: "panel", clip: true, place: "top-center", dy },
    t("HIVEM1ND 3.0", 26, { weight: 700, color: "text" }),
    space(6),
    t("Release notes, draft by adjutant", 13, { color: "mute" }),
    space(20),
    ...kids,
  );
}
const para = (value) => col({ pad: [0, 0, 12] }, t(value, 15.5, { color: "body", lh: 1.65 }));
const h3 = (value) => col({ pad: [10, 0, 6] }, t(value, 16, { weight: 700, color: "text" }));

/** Void's bar: the attached agent, Watch, then find, source and Focus, with the save state. */
const voidTool = ({ watching = false, find = false, source = false, saved = "Saved" } = {}) => [
  t("Attached", 13, { color: "body" }),
  chip(L, "adj", "adjutant"),
  watch(L, watching ? "Watching" : "Watch", watching, "eye", "watch"),
  divider(),
  stack({ name: "find", label: "Find and replace", w: 32, h: 32, radius: 8, fill: find ? "acc" : undefined }, centered(ic("search", 15, find ? "accInk" : "body"))),
  stack({ name: "source", label: "Source", w: 32, h: 32, radius: 8, fill: source ? "acc" : undefined }, centered(ic("source", 15, source ? "accInk" : "body"))),
  watch(L, "Focus", false, null, "focus"),
  divider(),
  row({ gap: 6 }, saved === "Saving" ? spinner(12) : saved === "Not saved" ? ic("alert", 13, ERR) : ic("check", 13, "mute"), t(saved, 12, { color: saved === "Not saved" ? ERR : "mute" })),
];

const textComments = (thread, agent = { on: true, who: "Notifies adjutant" }) =>
  commentsPanel(L, { glyph: "pen", sub: "Release notes 3.0", thread, reply: "Reply on the text", agent });

const voidScreen = (lib, canvasKids, comments) => shell("Void", editorBody(L, lib, editorGround(L, "text-canvas", "Text", ...canvasKids), comments), { waiting: 2 });

const emptyThread = () => [col({ gap: 8, pad: [24, 8], align: "center" }, t("No comments yet", 14, { weight: 700 }), t("Select a passage to comment on it or to ask the agent for a change.", 13, { color: "mute", align: "center" }))];

const voidDoc = () =>
  voidScreen(
    texts(),
    [toolbar(L, ...voidTool()), docCard([para(DOC.intro), h3("One service per machine"), para(DOC.service), h3("Chats and mailboxes"), para(DOC.mail), h3("Live editors"), para(DOC.live)])],
    textComments(emptyThread()),
  );

const voidLibrary = () =>
  voidScreen(
    texts({
      folders: [
        { name: "Release", open: true, items: [["Release notes 3.0", "1", "sel"], ["Install on Windows", null, row({ gap: 6, pad: [3, 8], radius: 8, fill: "card", stroke: "acc" }, t("Install on Windows", 12.5, { color: "text", lines: 1 }), box({ w: 2, h: 14, fill: "acc" }))]] },
        { name: "Manuals", open: false, count: 2, items: [] },
        { name: "Drafts", open: false, count: 3, items: [] },
        { name: "New folder", open: true, items: [] },
      ],
    }),
    [toolbar(L, ...voidTool()), docCard([para(DOC.intro), h3("One service per machine"), para(DOC.service), h3("Chats and mailboxes"), para(DOC.mail)])],
    textComments(emptyThread()),
  );

const voidDelete = () =>
  shell("Void", editorBody(L, texts({ folders: TEXT_FOLDERS("sel", "menu") }), editorGround(L, "text-canvas", "Text", toolbar(L, ...voidTool()), docCard([para(DOC.intro), h3("One service per machine"), para(DOC.service)])), textComments(emptyThread())), {
    waiting: 2,
    over: [
      scrim(),
      dialog({
        title: "Delete Install guide?",
        sub: "The text and its comments go. A folder is deleted the same way and names how many texts it holds. Undo brings it back for 10 seconds.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Delete text", "delete-text")],
      }),
    ],
  });

const voidNotSaved = () =>
  voidScreen(
    texts(),
    [
      toolbar(L, ...voidTool({ saved: "Not saved" })),
      { ...banner("error", "The change was not saved: the M1ND folder did not answer. The text stays here.", [button(L, "Retry", "pri", "retry", "retry-save")]), dy: 66 },
      docCard([para(DOC.intro), h3("One service per machine"), para(`${DOC.service} An idle machine makes no requests and sends nothing.`), h3("Chats and mailboxes"), para(DOC.mail)], { dy: 110, h: 720 }),
    ],
    textComments(emptyThread()),
  );

/** Void's format bar: it appears over a selection only. */
function formatBar(x, y) {
  const glyphs = [["B", "bold"], ["I", "italic"], ["S", "strike"]].map(([letter, name]) =>
    stack({ name: `format-${name}`, label: name, w: 32, h: 32, radius: 7, fill: name === "bold" ? "card" : undefined }, centered(t(letter, 13.5, { weight: 800, color: name === "bold" ? "acc" : "text" }))),
  );
  const heads = ["H1", "H2", "H3"].map((h) => stack({ name: `format-${h.toLowerCase()}`, label: h, w: 32, h: 32, radius: 7 }, centered(t(h, 12, { weight: 700, color: "body" }))));
  const icons = [["list", "List"], ["quote", "Quote"], ["code", "Code"], ["link", "Link"], ["table", "Table"], ["image", "Image"], ["comment", "Comment"]].map(([glyph, value]) =>
    stack({ name: `format-${glyph}`, label: value, w: 32, h: 32, radius: 7 }, centered(ic(glyph, 14))),
  );
  return row(
    { name: "format-bar", label: "Format", gap: 1, pad: 4, radius: 12, fill: "card2", stroke: "line2", place: { x, y } },
    ...glyphs, divider(), ...heads, divider(), ...icons,
  );
}

const voidEdit = () =>
  voidScreen(
    texts(),
    [
      toolbar(L, ...voidTool({ saved: "Saving" })),
      docCard([
        para(DOC.intro),
        h3("One service per machine"),
        col(
          { name: "editing", label: "Editing in place", pad: [0, 0, 60] },
          t("Each machine runs one Relay service, while HIVEM1ND needs it. It wakes the sessions on that machine and starts new ones from the Map.", 15.5, { color: "body", lh: 1.65 }),
          row(
            { gap: 0 },
            row({ name: "selected-text", label: "Selected text", fill: "accSoft" }, t("An idle machine makes no requests and sends nothing.", 15.5, { weight: 700, color: "text", lh: 1.65 })),
            box({ w: 2, h: 20, fill: "acc" }),
          ),
        ),
        h3("Chats and mailboxes"),
        para(DOC.mail),
      ]),
      formatBar(132, 388),
    ],
    textComments(emptyThread()),
  );

/** A match in the text: highlighted, the current one filled. */
const hit = (value, current = false) => row({ fill: current ? "acc" : "waitSoft" }, t(value, 15.5, { color: current ? "accInk" : "text", lh: 1.65, weight: current ? 700 : 400 }));

const voidFind = () =>
  voidScreen(
    texts(),
    [
      toolbar(L, ...voidTool({ find: true })),
      col(
        { name: "find-bar", label: "Find and replace", w: 640, gap: 8, pad: [12, 14], radius: 16, fill: "panel", stroke: "line2", place: "top-center", dy: 70 },
        row(
          { gap: 8 },
          row({ grow: 1, gap: 8, pad: [8, 10], radius: 10, fill: "card", stroke: "acc" }, ic("search", 14, "mute"), t("machine", 13.5, { color: "text" }), fill(), t("2 of 4", 12, { color: "mute" })),
          ...["Aa", "W", ".*"].map((o, i) => stack({ w: 30, h: 30, radius: 8, fill: i === 0 ? "card2" : undefined, stroke: "line2" }, centered(t(o, 12, { weight: 700, color: i === 0 ? "acc" : "body" })))),
        ),
        row(
          { gap: 8 },
          row({ grow: 1, gap: 8, pad: [8, 10], radius: 10, fill: "card", stroke: "line2" }, ic("retry", 14, "mute"), t("computer", 13.5, { color: "text" })),
          button(L, "Replace", "plain", null, "replace"),
          button(L, "Replace all 4", "pri", null, "replace-all"),
        ),
        row({ gap: 8 }, t("This document", 12, { weight: 700, color: "acc" }), t("All texts", 12, { color: "mute" }), fill(), t("Undo puts every replaced match back at once.", 12, { color: "mute" })),
      ),
      docCard(
        [
          para(DOC.intro),
          h3("One service per machine"),
          row({ gap: 4 }, t("Each", 15.5, { color: "body", lh: 1.65 }), hit("machine"), t("runs one Relay service while HIVEM1ND needs it.", 15.5, { color: "body", lh: 1.65 })),
          row({ gap: 4, pad: [0, 0, 12] }, t("It wakes the sessions on that", 15.5, { color: "body", lh: 1.65 }), hit("machine", true), t("and starts new ones.", 15.5, { color: "body", lh: 1.65 })),
          h3("Chats and mailboxes"),
          para(DOC.mail),
        ],
        { dy: 222, h: 600 },
      ),
    ],
    textComments(emptyThread()),
  );

const voidSource = () =>
  voidScreen(
    texts(),
    [
      toolbar(L, ...voidTool({ source: true })),
      col(
        { name: "source-view", label: "Source", w: 640, h: 760, gap: 6, pad: [36, 40], radius: 20, fill: "panel", clip: true, place: "top-center", dy: 70 },
        ...[
          ["# HIVEM1ND 3.0", "text"],
          ["", null],
          ["_Release notes, draft by adjutant_", "mute"],
          ["", null],
          ["HIVEM1ND 3.0 brings every agent of the M1ND onto one Map. Units are", "body"],
          ["created where they run, and every conversation is kept.", "body"],
          ["", null],
          ["## One service per machine", "text"],
          ["", null],
          ["Each machine runs one Relay service while HIVEM1ND needs it. It wakes", "body"],
          ["the sessions on that machine and starts new ones from the Map.", "body"],
          ["**An idle machine makes no requests and sends nothing.**", "acc"],
        ].map(([line, color]) => mono(line || " ", 13, { color: color ?? "mute", lh: 1.6 })),
        fill(),
        t("The source view keeps the caret where it was in the Document view.", 12, { color: "mute" }),
      ),
    ],
    textComments(emptyThread()),
  );

const voidSuggestion = () =>
  voidScreen(
    texts(),
    [
      toolbar(L, ...voidTool()),
      docCard([
        para(DOC.intro),
        h3("One service per machine"),
        para(DOC.service),
        row({ pad: [0, 0, 12] }, row({ name: "changed", label: "Changed sentence", fill: "accSoft", edge: { side: "bottom", color: "acc", width: 2 } }, t("An idle machine makes no requests and sends nothing.", 15.5, { color: "body", lh: 1.65 }))),
        h3("Chats and mailboxes"),
        para(DOC.mail),
      ]),
    ],
    textComments([
      comment(L, { who: "You", when: "23:20", body: "Say what an idle machine costs: no requests, not only no traffic." }),
      comment(L, { who: "adjutant", when: "23:21", reply: true, body: "Changed to: an idle machine makes no requests and sends nothing.", buttons: [button(L, "Accept change", "pri", null, "accept-change"), button(L, "Edit", "plain", "pen", "edit-change"), button(L, "Discard", "ghost", null, "discard")] }),
    ]),
  );

const voidStale = () =>
  voidScreen(
    texts(),
    [toolbar(L, ...voidTool()), docCard([para(DOC.intro), h3("One service per machine"), para(`${DOC.service} Idle machines stay quiet.`), h3("Chats and mailboxes"), para(DOC.mail)])],
    textComments([
      comment(L, { who: "You", when: "23:20", body: "Say what an idle machine costs: no requests, not only no traffic." }),
      col(
        { pad: [0, 0, 0, 18] },
        col(
          { gap: 8, pad: [11, 12], radius: 16, fill: "waitSoft" },
          row({ gap: 8 }, ic("alert", 14, "wait"), t("The text changed after this suggestion", 13, { weight: 700 })),
          t("It was not applied. Edit the passage yourself, ask adjutant again on the current text, or discard it.", 13, { color: "body" }),
          row({ gap: 8 }, button(L, "Edit passage", "pri", "pen", "edit-passage"), button(L, "Ask again", "plain", "retry", "ask-again"), button(L, "Discard", "ghost", null, "discard")),
        ),
      ),
    ]),
  );

const focusTools = () =>
  stack(
    { w: 1440, h: 900, fill: "#000000", theme: L.theme },
    row(
      { name: "focus-tools", label: "Focus tools", gap: 10, pad: [8, 10], radius: 14, fill: "panel", stroke: "line", place: "top-center", dy: 18 },
      button(L, "Document", "ghost", "back", "to-document"),
      t("Page 1 of 3", 12.5, { color: "mute" }),
      chip(L, "adj", "adjutant"),
      watch(L, "Watch", false, "eye", "watch"),
    ),
    col(
      { name: "focus-text", label: "Text", w: 640, gap: 18, place: "top-center", dy: 120 },
      col({ pad: [0, 0, 10] }, t("HIVEM1ND 3.0", 28, { weight: 700, color: "#f1efe9" })),
      t(DOC.intro, 17, { color: "#d8d4cc", lh: 1.8 }),
      t(`${DOC.service} An idle machine makes no requests and sends nothing.`, 17, { color: "#d8d4cc", lh: 1.8 }),
    ),
    row({ gap: 8, place: "bottom-center", dy: -28 }, ...[1, 2, 3].map((i) => box({ w: i === 1 ? 22 : 8, h: 8, radius: "pill", fill: i === 1 ? "acc" : "card2" }))),
  );

// ---- settings, the phone link and the service -----------------------------------------------------

/** A look, drawn small in its own palette: the bar, the three panels and the accent. */
function lookPreview(look, sel) {
  const m = look.m;
  return col(
    { name: `look-${look.id}`, label: look.name, w: 166, gap: 8 },
    stack(
      { w: 166, h: 100, radius: 12, fill: "bg", stroke: sel ? "acc" : "line2", strokeWidth: sel ? 2 : 1, clip: true, theme: look.theme },
      row({ w: 166, h: 18, gap: 5, pad: [0, 8], fill: m ? undefined : "panel", place: { x: 0, y: 0 } }, box({ w: 8, h: 8, radius: 2, fill: "acc" }), fill(), box({ w: 44, h: 8, radius: 4, fill: "card2" }), fill()),
      row(
        { w: 166, h: 80, gap: m ? 4 : 0, pad: m ? [0, 5, 5] : 0, align: "stretch", place: { x: 0, y: 20 } },
        col({ w: 36, gap: 4, pad: 5, radius: m ? 7 : 0, fill: "panel", stroke: m ? "line" : undefined }, box({ w: 24, h: 5, radius: 3, fill: "card2" }), box({ w: 20, h: 5, radius: 3, fill: "card2" }), box({ w: 22, h: 5, radius: 3, fill: "acc" })),
        stack({ grow: 1, radius: m ? 7 : 0, fill: m ? "ground" : "bg", stroke: m ? "line" : undefined }, box({ w: 14, h: 14, radius: "pill", stroke: "acc", strokeWidth: 1.5, place: { x: 30, y: 26 } }), box({ w: 12, h: 12, radius: "pill", stroke: "ring", strokeWidth: 1.5, place: { x: 62, y: 50 } })),
        col({ w: 44, gap: 4, pad: 5, radius: m ? 7 : 0, fill: "panel", stroke: m ? "line" : undefined }, box({ w: 32, h: 10, radius: 4, fill: "card" }), box({ w: 26, h: 10, radius: 4, fill: "me" }), box({ w: 30, h: 7, radius: 4, fill: "acc" })),
      ),
    ),
    row({ gap: 8 }, stack({ w: 16, h: 16 }, circle(16, { stroke: sel ? "acc" : "line2", strokeWidth: 2 }), sel ? circle(7, { fill: "acc" }) : null), t(look.name, 13.5, { weight: sel ? 700 : 400, color: sel ? "text" : "body" })),
  );
}

const section = (title, kids, sub = null) =>
  col({ gap: 12, pad: 20, radius: 18, fill: "panel", stroke: "line" }, row({ gap: 10 }, t(title, 15, { weight: 700 }), fill(), sub), ...kids);
const kv = (k, v) => row({ gap: 10 }, t(k, 13, { color: "mute" }), fill(), v);
const segment = (items, name = null) =>
  row({ name, label: name ?? undefined, gap: 4, pad: 4, radius: 12, fill: "card" }, ...items.map(([value, on]) => row({ grow: 1, justify: "center", pad: [8, 12], radius: 9, fill: on ? "card2" : undefined }, t(value, 13.5, { weight: 600, color: on ? "text" : "mute" }))));

/** Settings: the title and its sections as tabs. What setup detects (agents, projects, content) is changed here. */
function settingsFrame(tab, ...kids) {
  const tabsRow = row(
    { name: "settings-tabs", label: "Settings sections", gap: 4, pad: 4, radius: 12, fill: "panel", stroke: "line" },
    ...[["general", "General", "settings"], ["agents", "Agents", "term"], ["permissions", "Permissions", "hand"], ["projects", "Projects", "folder"], ["content", "Content", "grid"]].map(([id, value, glyph]) =>
      row({ name: `settings-${id}`, label: value, gap: 7, pad: [7, 14], radius: 9, fill: tab === id ? "card2" : undefined }, ic(glyph, 15, tab === id ? "text" : "mute"), t(value, 13.5, { weight: 600, color: tab === id ? "text" : "mute" })),
    ),
  );
  const machine = row(
    { name: "settings-machine", label: "Machine", gap: 8, pad: [8, 12], radius: 12, fill: "panel", stroke: "line" },
    ic("desk", 15, "text"), t("DESKTOP, this machine", 13.5, { weight: 600 }), ic("chevron", 14, "mute"),
  );
  return col({ h: 818, gap: 16, pad: [8, 120] }, row({ gap: 18 }, t("Settings", 22, { weight: 700 }), tabsRow, fill(), machine), ...kids);
}

/** Agents, Permissions, Projects and Locations are per machine: the selector at the top right picks which. */
const settingsMachine = () =>
  shell("Settings", settingsFrame("agents", agentsSection()), {
    over: [
      col(
        { name: "machine-menu", label: "Machines", w: 320, pad: 6, gap: 2, radius: 14, fill: "card2", stroke: "line2", place: { x: 1000, y: 112 } },
        row({ gap: 10, pad: [9, 10], radius: 10, fill: "card" }, ic("desk", 15), t("DESKTOP, this machine", 13.5), fill(), ic("check", 14, "acc")),
        row({ gap: 10, pad: [9, 10] }, ic("lap", 15), col({ gap: 1 }, t("LAPTOP", 13.5), t("Offline since 23:40: its last report, read only", 11.5, { color: "mute" }))),
      ),
    ],
  });

const grantRow = (unit, action, since) =>
  row(
    { name: `grant-${slug(unit + " " + action)}`, label: `${unit}: ${action}`, gap: 12, pad: [10, 14], radius: 12, fill: "card" },
    ic("term", 15), mono(unit, 12.5, { weight: 700 }), code(action), fill(), t(since, 12, { color: "mute" }), button(L, "Revoke", "plain", "x", `revoke-${slug(unit + " " + action)}`),
  );

const settingsPermissions = () =>
  shell("Settings", settingsFrame(
    "permissions",
    section("Standing approvals", [
      grantRow("executor-shop", "npm run build", "Always since today 23:46"),
      grantRow("overlord-api", "npm test", "Always since yesterday"),
      t("Each one was given with Always for this unit in a chat. Revoke takes it back; the next request asks again.", 12.5, { color: "mute" }),
    ]),
    section("Agent permissions", [
      grantRow("Cursor CLI", "git commit, git push", "Given today 23:50"),
      t("Given in Connect an agent, only for sessions HIVEM1ND starts on this machine. Commits and pushes still run only when a person asks for them.", 12.5, { color: "mute" }),
    ]),
  ), {});

const projectsRemove = () =>
  shell("Settings", settingsFrame("projects", section("Project folders", [rootBlock("C:\\Users\\you\\Web", ["shop", "site", "api", "blog"], "web")])), {
    over: [
      scrim(),
      dialog({
        title: "Remove shop from the M1ND?",
        sub: "Its units, boards and texts stop showing here. The repository and its files stay on disk, untouched; adding the folder again brings them back.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Remove repository", "remove-repo")],
      }),
    ],
  });

/** A state with its dot: connected, changes needed, or nothing yet. */
const stateLine = (kind, value) =>
  row({ gap: 6 }, kind === "ok" ? dot("work") : kind === "wait" ? ic("alert", 13, "wait") : dot("idle"), t(value, 12.5, { color: kind === "wait" ? "wait" : kind === "ok" ? "body" : "mute" }));

/**
 * One agent found on the machine. The CLI comes first: HIVEM1ND starts and closes CLI sessions for the
 * units. An app connection is optional, for writing to an agent in its own app; it uses the wake of today.
 */
function agentRow(name, version, { cli = "ok", mode = "Auto", app = null, appName = null, missing = false } = {}) {
  const cliCell = cli === "ok"
    ? row({ gap: 10 }, stateLine("ok", "Connected"), row({ w: 196 }, segment([["Auto", mode === "Auto"], ["On demand", mode === "On demand"]], `mode-${slug(name)}`)))
    : row({ gap: 10 }, stateLine("wait", "2 changes needed"), button(L, "Review changes", "pri", null, `review-${slug(name)}`));
  const appCell = app === "ok"
    ? stateLine("ok", `${appName} connected`)
    : app === "none" ? stateLine("idle", "No app") : button(L, `Connect ${appName}`, "plain", "link", `app-${slug(name)}`);
  return row(
    { name: `agent-${slug(name)}`, label: name, h: 68, gap: 14, pad: [0, 14], radius: 14, fill: "card", opacity: missing ? 0.6 : undefined },
    avatar(L, "term", 34, 16),
    col({ w: 200, gap: 2 }, t(name, 14, { weight: 700 }), t(missing ? "Not found on this machine" : `CLI ${version}`, 12, { color: "mute" })),
    missing ? fill() : row({ grow: 1 }, cliCell),
    missing ? button(L, "Find manually", "plain", "search", `find-${slug(name)}`) : row({ w: 190 }, appCell),
    missing ? null : ic("dots", 15),
  );
}

const agentsHead = () =>
  row(
    { gap: 14, pad: [0, 14] },
    space(34),
    row({ w: 200 }, t("Agent", 12, { weight: 700, color: "mute" })),
    row({ grow: 1 }, t("Command line (CLI): runs your units", 12, { weight: 700, color: "mute" })),
    row({ w: 190 }, t("Desktop app: optional", 12, { weight: 700, color: "mute" })),
    space(15),
  );

const agentsSection = () =>
  section("Agents on DESKTOP", [
    agentsHead(),
    agentRow("Claude Code", "2.6.1", { app: "ok", appName: "Claude app" }),
    agentRow("Codex", "0.159.3", { appName: "Codex app" }),
    agentRow("Cursor", "2026.10.01", { cli: "wait", appName: "Cursor editor" }),
    agentRow("OpenCode", "1.4.0", { mode: "On demand", app: "none" }),
    agentRow("GitHub Copilot", null, { missing: true }),
  ], row({ gap: 10 }, t("Scanned 23:40", 12, { color: "mute" }), button(L, "Scan again", "plain", "retry", "scan")));

const settingsAgents = () =>
  shell("Settings", settingsFrame(
    "agents",
    agentsSection(),
    t("The command line is how HIVEM1ND runs your units: it opens a session for each task and closes it. Auto loads the M1ND rules in every session; On demand only when a HIVEM1ND command runs.", 12.5, { color: "mute" }),
    t("The desktop app is separate and optional: connecting it lets you write to an agent in its own window, and the M1ND wakes it when a message arrives.", 12.5, { color: "mute" }),
    t("A unit can also be run by hand in an agent's app with its command, for example /executor shop. It joins the M1ND, keeps its place in the hierarchy and shows on the Map like any other.", 12.5, { color: "mute" }),
  ), {});

/** One change HIVEM1ND needs in an agent's configuration, shown before anything is written. */
const changeRow = (file, what, on = true) =>
  row(
    { name: `change-${slug(file)}`, label: what, gap: 12, pad: [10, 12], radius: 12, fill: "card", align: "start" },
    row({ pad: [1, 0, 0] }, tick(on, 18)),
    col({ grow: 1, gap: 3 }, t(what, 13.5, { weight: 600 }), mono(file, 12, { color: "mute" })),
  );

const settingsConnect = () =>
  shell("Settings", settingsFrame("agents", agentsSection()), {
    over: [
      scrim(),
      dialog({
        title: "Connect the Cursor CLI",
        sub: "HIVEM1ND needs these changes on DESKTOP. Nothing is written until you apply them; Copy changes gives them to make by hand.",
        kids: [
          col(
            { gap: 8 },
            changeRow("%USERPROFILE%\\.cursor\\mcp.json", "Add the Relay server, so sessions read and send messages"),
            changeRow("%USERPROFILE%\\.cursor\\hooks.json", "Add the Relay hooks, so a session wakes when a message arrives"),
          ),
          col(
            { gap: 8 },
            label("Optional permission"),
            changeRow("%USERPROFILE%\\.cursor\\cli-config.json", "Allow git commit and git push in Cursor sessions started by HIVEM1ND on this machine", false),
            t("Commits and pushes still run only when a person asks for them. Permissions lists it and takes it back.", 12, { color: "mute" }),
          ),
          row({ gap: 8 }, ic("undo", 14, "mute"), t("A copy of each file is kept; Disconnect puts it back.", 12.5, { color: "body" })),
          row({ gap: 8 }, ic("alert", 14, "wait"), t("Cursor is restarted after the changes to load them.", 12.5, { color: "body" })),
        ],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Copy changes", "plain", "copy", "copy-changes"), button(L, "Apply 2 changes", "pri", null, "apply-changes")],
        w: 600,
      }),
    ],
  });

function rootBlock(path, repos, env = null) {
  return col(
    { gap: 10, pad: [12, 14], radius: 14, fill: "card" },
    row(
      { gap: 10 },
      ic("folder", 15, "body"),
      mono(path, 13, { color: "text" }),
      fill(),
      env ? row({ gap: 6, pad: [3, 9], radius: "pill", fill: "card2" }, t(`Environment: ${env}`, 12, { color: "body" })) : t("No environment", 12, { color: "mute" }),
      ic("dots", 15),
    ),
    row({ gap: 8, pad: [0, 0, 0, 25] }, ...repos.map((r) => row({ gap: 6, pad: [4, 10], radius: "pill", fill: "card2" }, ic("grid", 12), t(r, 12.5, { color: "text" }), ic("x", 11, "mute")))),
  );
}

const settingsProjects = () =>
  shell("Settings", settingsFrame(
    "projects",
    section("Project folders", [
      rootBlock("C:\\Users\\you\\Web", ["shop", "site", "api", "blog"], "web"),
      rootBlock("C:\\Users\\you\\Data", ["data", "reader"]),
      rootBlock("D:\\Mobile", ["mobile"]),
      row({ gap: 10 }, button(L, "Add folder", "plain", "folder-plus", "add-root"), t("Repositories inside a folder are found by themselves; each can be removed.", 12.5, { color: "mute" })),
    ], t("Found by setup: 3 folders, 7 repositories", 12, { color: "mute" })),
  ), {});

function contentGroup(title, items) {
  return col(
    { grow: 1, gap: 8 },
    t(title, 12.5, { weight: 700, color: "mute" }),
    ...items.map(([value, on]) => row({ name: `content-${slug(value)}`, label: value, gap: 10, pad: [8, 10], radius: 10, fill: "card" }, tick(on), t(value, 13, { color: on ? "text" : "body" }))),
  );
}

const settingsContent = () =>
  shell("Settings", settingsFrame(
    "content",
    row(
      { gap: 16, align: "start" },
      col(
        { grow: 1, gap: 16 },
        section("Features", [
          row(
            { gap: 12, align: "start" },
            contentGroup("Planning", [["Plan", true], ["Brainstorm", true], ["Task", true]]),
            contentGroup("Quality", [["QA", true], ["Tribunal", false], ["Cyberattack", true]]),
            contentGroup("Continuity", [["Relay", true], ["Catchup", true], ["Docs", false]]),
          ),
        ]),
        section("Knowledge packs", [row({ gap: 12 }, ...[["Security", true], ["Design", true], ["Copy", true], ["Coding", false]].map(([value, on]) => row({ grow: 1, gap: 10, pad: [8, 10], radius: 10, fill: "card" }, tick(on), t(value, 13, { color: on ? "text" : "body" }))))]),
      ),
      col(
        { w: 420, gap: 16 },
        section("Preferences", [
          t("Address style", 12.5, { weight: 700, color: "mute" }),
          segment([["Impersonal", true], ["Formal", false], ["Explanatory", false]], "address-style"),
          field("Additional instructions", "What every agent should know about how you work", { placeholder: true }),
          kv("Keep existing preferences first", row({ gap: 6 }, tick(true), t("On", 13))),
          kv("Check for updates", row({ gap: 6 }, tick(true), t("Daily", 13))),
        ]),
      ),
    ),
  ), {});

function settingsBody() {
  return settingsFrame(
    "general",
    row(
      { gap: 16, align: "start" },
      col(
        { grow: 1, gap: 16 },
        section("Look", [
          row({ gap: 12 }, lookPreview(LOOKS[0], true), lookPreview(LOOKS[1], false), lookPreview(FAMILY[0], false)),
          row({ gap: 12 }, ...FAMILY.slice(1).map((look) => lookPreview(look, false))),
          t("Each preview is drawn in the look's own palette; a choice applies at once.", 12.5, { color: "mute" }),
        ]),
        section("Language", [segment([["English", true], ["Español", false]])]),
        section("Phone on the home network", [
          t("See, chat and approve from your phone while it is on the same network. Access closes after 12 hours.", 13, { color: "body" }),
          row({ gap: 10, pad: [10, 12], radius: 12, fill: "card" }, ic("wifi", 15, "acc"), t("Open until 11:58, 1 phone signed in", 13, { color: "text" }), fill(), button(L, "Close access", "ghost", null, "close-access")),
          row({}, button(L, "Open on the phone", "pri", "qr", "open-phone")),
        ]),
      ),
      col(
        { grow: 1, gap: 16 },
        section("Relay service", [kv("State", row({ gap: 6 }, dot("work"), t("Running on DESKTOP", 13))), kv("Version", t("3.0.0", 13)), kv("Started", t("Today 08:12", 13)), kv("Start with Windows", row({ gap: 6 }, tick(false), t("Off", 13, { color: "mute" }))), row({ gap: 8 }, button(L, "Restart service", "plain", "retry", "restart"))]),
        section("Relay+", [t("Sync your preferences on any device, phones included, through the same service as Nebula+.", 13, { color: "body" })], row({ pad: [2, 8], radius: "pill", fill: "card2" }, t("Coming soon", 11, { weight: 700, color: "mute" }))),
        section("Locations", [kv("M1ND", mono(M1ND_PATH, 12.5)), kv("Staging", mono("C:\\Users\\you\\AppData\\Local\\HIVEM1ND", 12.5))]),
      ),
    ),
  );
}

const settings = () => shell("Settings", settingsBody(), {});

/** A sample QR drawn from a fixed seed: only its look; the product draws the real code. */
function sampleQr(size = 220) {
  const n = 29;
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const finder = (x, y) => {
    const r = Math.max(Math.abs(x), Math.abs(y));
    return r !== 2 && r <= 3;
  };
  let d = "";
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const corner = [[3, 3], [n - 4, 3], [3, n - 4]].find(([cx, cy]) => Math.abs(x - cx) <= 4 && Math.abs(y - cy) <= 4);
      const dark = corner ? finder(x - corner[0], y - corner[1]) : rand() < 0.48;
      if (dark) d += `M${((x / n) * 100).toFixed(3)} ${((y / n) * 100).toFixed(3)}h${(100 / n).toFixed(3)}v${(100 / n).toFixed(3)}h-${(100 / n).toFixed(3)}z`;
    }
  }
  return stack({ name: "qr", label: "QR code", w: size + 24, h: size + 24, radius: 12, fill: "#ffffff" }, vector({ w: size, h: size, d, fill: "#000000", place: "center" }));
}

const homeQr = () =>
  shell("Settings", settingsBody(), {
    over: [
      scrim(),
      dialog({
        title: "Open on your phone",
        sub: "Scan with the phone's camera while it is on the same network as DESKTOP.",
        kids: [
          row(
            { gap: 22, align: "start" },
            sampleQr(),
            col(
              { grow: 1, gap: 12 },
              col({ gap: 4 }, t("Or type this code", 12.5, { color: "mute" }), mono("K7P 4QX", 26, { weight: 700, track: 0.08 })),
              col({ gap: 4 }, t("At", 12.5, { color: "mute" }), mono("http://192.168.1.23:43123", 13, { color: "text" })),
              row({ gap: 8 }, ic("wifi", 15, "acc"), t("Access closes in 11 h 58 min", 13, { color: "body" })),
              t("A new code replaces this one; closing access signs the phone out.", 12, { color: "mute" }),
            ),
          ),
        ],
        actions: [button(L, "Close access", "ghost", null, "close-access"), button(L, "Done", "pri", null, "done")],
        w: 600,
      }),
    ],
  });

const reconnecting = () =>
  mapScreen({
    sel: "executor-shop",
    field: { sel: "executor-shop", extra: [banner("busy", "Reconnecting to the service. What you do is kept and sent when it answers.", [button(L, "Retry now", "plain", "retry", "retry")])] },
    inspector: unitPanel({ convo: [...HISTORY, mine("Run the checkout tests too.", "Waiting for the service", { sending: true })] }),
    footer: { service: "wait", serviceText: "Reconnecting to the Relay service", read: "Last read 23:41" },
  });

const serviceDown = () =>
  mapScreen({
    field: { extra: [banner("error", "The Relay service stopped on DESKTOP.", [button(L, "Details", "ghost", null, "details"), button(L, "Restart service", "pri", "power", "restart")])] },
    inspector: emptyInspector({ groups: 2 }),
    footer: { service: "wait", serviceText: "Relay service stopped", read: "Last read 23:41" },
  });

const slow = () =>
  chatScreen([...HISTORY, mine("Summarize what changed today.", "Sending")], {
    composerNode: col(
      { gap: 8, pad: [12, 14, 16] },
      row(
        { gap: 10, pad: [10, 12], radius: 14, fill: "waitSoft" },
        spinner(15, "wait"),
        col({ grow: 1, gap: 2 }, t("Taking longer than usual", 13, { weight: 700 }), t("The service has not answered for 12 s. It stops waiting at 30 s and offers Retry.", 12, { color: "body" })),
        button(L, "Cancel", "ghost", null, "cancel"),
      ),
      composer(L, "Message executor-shop", null, null),
    ),
  });

// ---- the phone ----------------------------------------------------------------------------------------

function codeBoxes(value, error = false) {
  return row({ gap: 8, justify: "center" }, ...value.split("").map((c) => stack({ w: 40, h: 50, radius: 12, fill: "card", stroke: error ? ERR : c.trim() ? "acc" : "line2" }, centered(mono(c, 20, { weight: 700 })))));
}

const phonePair = (error = false) => () =>
  phone(
    L,
    row({ h: 44, pad: [0, 22], justify: "between" }, t("23:42", 13, { weight: 700 }), t("HIVEM1ND", 13, { weight: 700 })),
    col(
      { grow: 1, gap: 18, pad: [60, 24, 24], align: "center" },
      mark(56),
      t("Open your M1ND", 22, { weight: 700 }),
      t("Type the code shown on your computer, in Settings, Open on the phone.", 14, { color: "body", align: "center" }),
      codeBoxes(error ? "K7P4QZ" : "K7P4Q ", error),
      error
        ? col({ gap: 6, align: "center" }, row({ gap: 6 }, ic("alert", 14, ERR), t("That code does not match.", 13.5, { color: ERR })), t("Check it on the computer and try again; 4 tries left.", 12.5, { color: "mute" }))
        : t("Or scan the QR code with the camera.", 12.5, { color: "mute" }),
      space(8),
      error ? button(L, "Try again", "pri", "retry", "retry") : busy("Opening"),
    ),
  );

const phoneLocked = () =>
  phone(
    L,
    row({ h: 44, pad: [0, 22], justify: "between" }, t("23:44", 13, { weight: 700 }), t("HIVEM1ND", 13, { weight: 700 })),
    col(
      { grow: 1, gap: 16, pad: [120, 28, 24], align: "center" },
      stack({ w: 64, h: 64, radius: "pill", fill: ERR_SOFT }, centered(ic("alert", 28, ERR))),
      t("Pairing locked", 22, { weight: 700 }),
      t("Five codes did not match. Pairing stays locked for 10 minutes; a new code from the computer unlocks it at once.", 14, { color: "body", align: "center" }),
    ),
  );

function phoneWaiting() {
  return () =>
    phone(
      L,
      ...phoneTop(L, "Waiting", 2),
      col(
        { name: "waiting", label: "Waiting on you", grow: 1, gap: 12, pad: 14, clip: true },
        heading(L, "Asks"),
        col({ gap: 4 }, row({ gap: 8 }, mono("executor-shop", 12, { weight: 700 }), t("23:32", 12, { color: "mute" })), buildAsk(L, null)),
        heading(L, "Reviews"),
        col({ gap: 4 }, row({ gap: 8 }, mono("executor-shop", 12, { weight: 700 }), t("23:31", 12, { color: "mute" })), reviewAsk(L, false)),
      ),
      phoneNav(L, "Waiting"),
    );
}

const phoneClosed = () =>
  phone(
    L,
    row({ h: 44, pad: [0, 22], justify: "between" }, t("11:42", 13, { weight: 700 }), t("HIVEM1ND", 13, { weight: 700 })),
    col(
      { grow: 1, gap: 16, pad: [120, 28, 24], align: "center" },
      stack({ w: 64, h: 64, radius: "pill", fill: "card" }, centered(ic("wifi", 28, "mute"))),
      t("Access ended", 22, { weight: 700 }),
      t("Phone access lasts 12 hours. Open it again from the computer: Settings, Open on the phone.", 14, { color: "body", align: "center" }),
      button(L, "Type a new code", "pri", null, "new-code"),
    ),
  );

// ---- the board ------------------------------------------------------------------------------------

const ROWS = [
  ["setup", "Setup and first run"],
  ["map", "The Map"],
  ["chat", "Chats and what waits on you"],
  ["blueprint", "Blueprint"],
  ["void", "Void"],
  ["settings", "Settings, the phone link and the service"],
  ["phone", "The phone"],
];
const STEP_X = 1440 + 160;
const STEP_Y = 900 + 360;

const DESK = {
  setup: [
    ["welcome", "Install", setupWelcome, "The installer opens setup in the browser. Under one line on how long it takes, three lines say what HIVEM1ND is for: the Swarm on the Map, agents organized toward their objectives, and Relay between sessions."],
    ["mind", "Where the M1ND lives", setupMind, "The folder defaults to the Cosmic root and can be changed; a folder inside a cloud storage service syncs through that service, so there is no sync choice. When a 2.x M1ND is found, a banner offers Migrate legacy M1ND, ticked: it is copied and upgraded and the original is never changed. Relay+ is announced as coming soon."],
    ["join", "Join an existing M1ND", setupJoin, "When the folder chosen already holds a 3.0 M1ND, as on a second machine, setup joins it: nothing in it is replaced, and this machine's record is added."],
    ["close-2x", "Close 2.x sessions", setupClose2x, "Before a legacy M1ND is copied, its running 2.x sessions are closed, so only the 3.0 service wakes sessions. Their work is saved."],
    ["service", "Relay service", setupService, "Each step shows its own state while it runs, so setup never looks frozen. There is no Back here: going back while the service installs could break the installation."],
    ["failed", "A step failed", setupFailed, "A failed step says why and what was not changed; Retry runs it again. Closing the page resumes setup from this step."],
    ["done", "Ready", setupDone, "What was set up, and how to add another machine."],
    ["loading", "Opening", loading, "The window shows at once with its frame; the panels fill as the M1ND is read, with a loader in the middle."],
    ["load-failed", "The M1ND cannot be read", loadFailed, "Reading stops at 30 s and says why, with Retry and Choose another folder."],
    ["empty", "An empty M1ND", emptyMind, "The first run: only you. The Overseer is created first."],
  ],
  map: [
    ["idle", "Map", mapIdle, "Nothing selected: the inspector sums up the M1ND and offers New unit. Hierarchy opens with My groups, the person's own groups, above the chain of command."],
    ["selected", "A unit selected", mapSelected, "A click selects a unit: its facts, its chat and what it asks of you. A double click in Hierarchy centers it on the Map."],
    ["rename", "Rename", mapRename, "F2, or Rename in the More menu, renames in place. The name is an alias: the id stays the same and stays written beside it."],
    ["renamed", "Renamed", mapRenamed, "The alias shows in Hierarchy, on the Map and in the inspector, with the id beside it; the notice offers Undo."],
    ["connect", "Connect", mapConnect, "A drag from overlord-web to executor-site asks first, in words, who will report to whom."],
    ["connect-saving", "Connected", mapConnectSaving, "The line is drawn at once and saved in the background; the notice confirms it and offers Undo."],
    ["selection", "A selection", mapSelection, "A drag on empty space selects; the inspector offers Save as group, Message all 3 and Connect to a lead."],
    ["new-group", "New group", mapNewGroup, "A group needs a name; its members can change later. It does not change who reports to whom."],
    ["group", "A group", mapGroup, "One group, three places: the folder in Hierarchy, the zone on the Map and its group chat in the inspector. A click on any of them selects the group."],
    ["delete-group", "Delete a group", mapDeleteGroup, "Deleting a group asks first and says what goes and what stays; the notice offers Undo."],
    ["new-unit", "New unit", mapNewUnit, "Machines that cannot take the unit stay in the list, disabled, with the reason. A unit can join a group as it is created."],
    ["creating", "Creating", mapCreating, "The form stays open while the unit is created; if it fails, the form keeps what was typed and says why."],
    ["created", "Created", mapCreated, "The unit appears selected, without a session. Messages wait in its mailbox."],
    ["start-session", "Start a session", mapStartSession, "A session runs in an agent CLI connected on that machine. An Executor runs one task and closes by default; as a chat it stays open and can open other CLIs itself."],
    ["starting", "Starting", mapStarting, "Each step shows its state; a message sent now is delivered once the session connects."],
    ["start-failed", "It did not start", mapStartFailed, "Every wait has a limit: after 30 s it says what happened and offers Retry."],
    ["stop", "Stop a session", mapStop, "Stopping asks first and says what stops and what stays."],
    ["remove-unit", "Remove a unit", mapRemoveUnit, "Removing a unit asks first and archives its chat and mailbox; the notice offers Undo."],
  ],
  chat: [
    ["chat", "A chat", chatList, "Chats lists pinned and recent conversations, the groups' chats among them; the chat opens in the inspector."],
    ["sending", "Sending", chatSending, "The line appears at once, marked Sending, and the box is free for the next one."],
    ["working", "The agent is working", chatWorking, "Delivered, then the agent's work shows with how long it has been at it, and Stop ends it."],
    ["open-cli", "Asks to open a session", chatOpenCli, "A chat Executor opens another CLI only with the person's approval; the ask waits with the others."],
    ["reply", "The reply", chatReply, "The reply arrives in place; a Read mark replaces Delivered."],
    ["failed", "Not confirmed", chatFailed, "A send waits 10 s for the service; a request waits 30 s (6.12). Without an answer the line says Not confirmed; Retry sends the same message once, never twice."],
    ["mailbox", "Mailbox", mailbox, "A unit with no session keeps a mailbox; the inspector says so. Blog runs by hand in the Codex app on LAPTOP, which is offline, so Start session waits for that machine."],
    ["waiting", "Waiting on you", waiting, "The pill in the bar opens what waits on you: asks, reviews, and what ended without an answer."],
    ["approval-sent", "Answer sent", approvalSent, "Approve answers at once; the card shows the answer is on its way until the unit confirms it."],
    ["send-back", "Send back", sendBack, "Sending a task back needs a note: the unit reads it."],
    ["accepted", "Accepted", accepted, "Accepting closes the review; the notice offers Undo."],
  ],
  blueprint: [
    ["board", "A board", bpBoard, "The library on the left, the board in the middle, comments on the right. The library is the one Void uses: search, filters, folders, and New board and New folder at the top."],
    ["library", "Board menu", bpLibraryMenu, "Each board has its menu: Rename, Duplicate, Move to folder and Delete. Folders collapse and are renamed and deleted the same way."],
    ["new-board", "New board", bpNewBoard, "A new board starts empty, as a copy of another, or imported from a Blueprint Lite 2.x module, which stays untouched."],
    ["search", "Search and filters", bpSearch, "Search runs over names, screens and comments across every folder; matching folders open. Filters stay on as chips until removed."],
    ["move", "Move to another project", bpMove, "Moving a board to a folder of another project says that its file changes repository."],
    ["delete", "Delete a board", bpDelete, "Deleting asks first and says what goes with the board."],
    ["edit", "Edit the board", bpEdit, "The board is edited in place with the same tools agents use: select, move and resize, change text and fill. No separate editor."],
    ["sketch", "Sketch by hand", bpSketch, "Sketches are drawn by hand on the same board, beside the screens. Attached agents read a sketch and can turn it into a screen."],
    ["attach", "Attach agents", bpAttach, "Attached agents, or a whole group, are sent comments and can draw on the board."],
    ["comment", "Comment", bpComment, "A comment pins to an element. Send to agent is on by default and keeps the value it was left at."],
    ["comment-sent", "Comment sent", bpCommentSent, "Sent at once; the agent's work shows in the thread."],
    ["watch", "Watch", bpWatch, "With Watch on, the board follows the agent as it draws."],
    ["conflict", "Changed while editing", bpConflict, "The person chooses what stays: Show changes compares both, Keep mine replaces the agent's change, Reload takes it. Here Send to agent was turned off, and it stays off until turned on again."],
    ["history", "History", bpHistory, "Every change to a board, by the person or an agent, is kept with who made it; Restore brings a version back and keeps the current one. Void keeps the same history for texts."],
  ],
  void: [
    ["document", "Document", voidDoc, "The default view: the library, the text, its attached agent and its comments. The library is Blueprint's: search, filters, collapsible folders, and create, rename and delete."],
    ["library", "Rename and folders", voidLibrary, "A text is renamed in place; a new folder appears named and ready to type."],
    ["delete", "Delete a text", voidDelete, "Deleting a text or a folder asks first and names what goes; Undo brings it back for 10 seconds."],
    ["edit", "Editing", voidEdit, "The text is edited in place with Void's editor. The format bar appears over a selection only: bold, italic, strikethrough, headings, list, quote, code, link, table, image and comment. Saving is continuous."],
    ["not-saved", "Not saved", voidNotSaved, "A save that fails says so at once; the text stays on screen and Retry saves it."],
    ["find", "Find and replace", voidFind, "In this document or in all texts, with case, whole word and regular expressions. Undo puts every replaced match back at once."],
    ["source", "Source", voidSource, "The Markdown source, with the caret where it was."],
    ["suggestion", "A suggested change", voidSuggestion, "An agent's change waits as a suggestion until it is accepted, edited or discarded."],
    ["stale", "An old suggestion", voidStale, "A suggestion made on older text is never applied by itself; the passage can be edited directly."],
    ["focus", "Focus", focus(L), "Pure black, only the text; the arrows move through the pages."],
    ["focus-tools", "Focus, tools shown", focusTools, "Moving the mouse brings the tools back; Esc returns to the Document view."],
  ],
  settings: [
    ["settings", "Settings", settings, "Settings opens from the gear at the right of the bar, on General. Looks: Modern (default), Nocturne, Nebula, Waves, Toxic and Kinetic, each previewed in its own palette. Start with Windows is optional and off by default."],
    ["agents", "Agents", settingsAgents, "Changing Auto or On demand, or connecting an app, opens Connect an agent first. Each agent found on the machine, in two columns. Command line (CLI): how HIVEM1ND runs the units, a session per task. Desktop app: optional, the agent's own window (Claude app, Codex app, Cursor editor) hooked to its unit's chat. Units can also be run fully by hand in an app with their commands, as in 2.x; they join the same hierarchy and show on the Map. Scan again finds an agent installed later."],
    ["connect", "Connect an agent", settingsConnect, "Every change to an agent's configuration is listed before it is made: Apply makes them, Copy changes gives them to make by hand. Nothing is written without that answer."],
    ["machine", "Another machine", settingsMachine, "Agents, Permissions, Projects and Locations belong to one machine; the selector shows another machine's last report, read only while it is offline."],
    ["permissions", "Permissions", settingsPermissions, "Every standing approval and agent permission, with Revoke. Nothing here is given without the person's answer in a chat or in Connect an agent."],
    ["projects", "Projects", settingsProjects, "The project folders setup found, each with its optional environment and its repositories; a folder is added or a repository removed here."],
    ["remove-repo", "Remove a repository", projectsRemove, "Removing a repository asks first; the files on disk are never touched."],
    ["content", "Content", settingsContent, "The features and knowledge packs included in the M1ND, and the preferences every agent reads."],
    ["home", "Open on the phone", homeQr, "A QR code and a short code for 12 hours; a new code replaces the old one."],
    ["reconnecting", "Reconnecting", reconnecting, "If the service stops answering, work is kept and sent when it answers again."],
    ["service-down", "Service stopped", serviceDown, "A stopped service is said plainly, with a way to restart it."],
    ["slow", "Taking longer", slow, "A slow request says so at once and never waits without end."],
  ],
};

const PHONE = [
  ["pair", "Pair", phonePair(false), "The phone opens the link or types the code; it never stores a password."],
  ["pair-error", "Wrong code", phonePair(true), "A wrong code says so and how many tries are left."],
  ["locked", "Pairing locked", phoneLocked, "After five wrong codes pairing locks for 10 minutes; a new code from the computer unlocks it."],
  ["hierarchy", "Hierarchy", phoneHierarchy(L), "See the whole M1ND; no editing on the phone."],
  ["chat", "A chat", phoneChat(L), "Chat and answer asks in place."],
  ["waiting", "Waiting", phoneWaiting(), "Everything that waits on you, answered in place. Standing approvals and pushes are answered on the computer."],
  ["closed", "Access ended", phoneClosed, "After 12 hours the access ends; a new code opens it again."],
];

// Each screen's title starts with its reference, row and place in the row (2.4 is the fourth screen of the
// Map), so a screen can be named in a comment or a chat. Ids of screens that were already on the board stay
// the same, so the comments left on them keep their screen.
const screens = [];
ROWS.forEach(([key, part], r) => {
  const y = r * STEP_Y;
  if (key === "phone") {
    PHONE.forEach(([id, title, root, note], i) => screens.push({ id: `phone-${id}`, title: `${r + 1}.${i + 1} ${part}: ${title}`, x: i * (390 + 160), y, w: 390, h: 844, root, note }));
    return;
  }
  DESK[key].forEach(([id, title, root, note], i) => screens.push({ id: `${key}-${id}`, title: `${r + 1}.${i + 1} ${part}: ${title}`, x: i * STEP_X, y, root, note }));
});

const chain = (key, at = {}) =>
  DESK[key].slice(1).map(([id, title], i) => ({ from: `${key}-${DESK[key][i][0]}`, to: `${key}-${id}`, label: title, ...(at[id] ? { at: at[id] } : {}) }));

export default board({
  id: "hivem1nd-3-flow",
  title: "HIVEM1ND 3.0",
  note:
    "HIVEM1ND 3.0, the one board of the version, in Modern: setup, the Map with its groups, chats and what waits on you, Blueprint, Void, settings and the service, the phone. " +
    "Blueprint and Void share one library and one comment composer. Every press answers at once and every wait ends with a clear state. Present plays each row in order. The sample is invented.",
  screens,
  links: [
    ...chain("setup", { mind: "continue", service: "continue", loading: "continue" }),
    ...chain("map", { selected: "node-executor-shop", connect: "node-overlord-web", "new-group": "save-group", group: "create-group", "start-session": "start-session" }),
    ...chain("chat"),
    ...chain("blueprint", { "new-board": "new-item", search: "filter", attach: "attach", watch: "watch" }),
    ...chain("void", { find: "find", source: "source", focus: "focus" }),
    ...chain("settings", { agents: "settings-agents", projects: "settings-projects", content: "settings-content" }),
    ...PHONE.slice(1).map(([id, title], i) => ({ from: `phone-${PHONE[i][0]}`, to: `phone-${id}`, label: title })),
  ],
});
