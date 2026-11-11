// HIVEM1ND 3.0: the one board of the version, one branched screen flow. It starts from one screen, the
// installer, and goes one screen at a time to the Map; from the Map each part of the app opens on its own
// row, and the options of a step drop below it and then run right. The first run, the clusters, the
// Overseer and the agents' chats are the owner's start-working sketch (kit/h3-start.mjs), which wins where it
// differs from the earlier flow; the other parts are the screens of the earlier flow, corrected where the
// sketch changes them: the Map has clusters and agents and no node for the person. Blueprint and Void share
// one library and one comment composer. Every press answers at once and every wait ends in a clear state
// with Retry. The sample is invented: its agents, machines, tasks, paths and times are examples.

import { board, SCREEN_W, SCREEN_H, GAP_X, GAP_Y } from "blueprint/board.mjs";
import { box, col, row, stack, vector, space, fill, ELLIPSE } from "blueprint/kit.mjs";
import {
  LOOKS, FAMILY, t, mono, ic, mark, dot, circle, centered, ibtn, avatar, button, bar, statusLine, panel, tabs, search, heading,
  unitRow, chatRow, inspectorHead, facts, message, code, ask, buildAsk, reviewAsk,
  composer, conversation, library, editorGround, toolbar, chip, watch, pin, wire, wireLine, artboard,
  comment, commentsPanel, editorBody, DOC, phoneTop, phoneNav, phone, phoneChat, focus, tick,
  unitNode, lines, segment as pathOf, tip, zoom, services, MID_W,
} from "../kit/h3.mjs";
import * as S from "../kit/h3-start.mjs";

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
    t(`${who} is working`, 13.5, { color: "body" }),
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

const FACTS = () => [
  ["Machine", row({ gap: 6 }, ic("desk", 14, "text"), t("DESKTOP", 13, { color: "text" }))],
  ["Runs in", t("Claude Code, command line", 13, { color: "text" })],
  ["Model", t("Sonnet 5.5, high", 13, { color: "text" })],
  ["Reports to", t("overlord-shop", 13, { color: "text" })],
];

const HISTORY = () => [
  message(L, { who: "You", when: "21:05", body: "Add the empty state to the cart page, as drawn on the Cart board.", me: true }),
  message(L, { who: "executor-shop", when: "23:31", body: "Done on feat/cart-empty. The page and its test pass; the board has my notes." }),
];

/** The inspector of one agent. An alias shows as the title, with the real id under it. `tabsRow` adds the Chat and Work tabs. */
function unitPanel({ glyph = "term", title = "executor-shop", alias = null, status = "work", statusText = "Working on task 029", factsList = FACTS(), convo = HISTORY(), place = ["Message executor-shop", "The session is notified at once", "bell"], composerNode = null, right = null, tabsRow = null }) {
  return panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, {
      glyph,
      title: alias ?? title,
      monoTitle: !alias,
      sub: row({ gap: 6 }, status === "busy" ? spinner(10) : dot(status), alias ? mono(title, 11.5, { color: "mute" }) : null, t(statusText, 12.5, { color: "mute" })),
      right: right ?? [row({ gap: 6 }, ibtn(L, "pin", "pin", "Pin"), ibtn(L, "dots", "more", "More"))],
    }),
    tabsRow,
    factsList ? facts(L, factsList) : null,
    conversation(L, ...convo),
    composerNode ?? composer(L, ...place),
  );
}

/** Nothing selected: the start board's empty inspector. */
const nothing = () => S.emptyInspector("Nothing selected", "Select a cluster or an agent.");

// ---- the Map and the side panel of the start board ---------------------------------------------------
//
// Every screen of the Map is drawn with the parts of the start board (kit/h3-start.mjs): the clusters as
// rounded dashed frames, the Overseer at the center and no node for the person, and a side panel with the
// Overseer and the clusters. `agentsMap` is the start board's `theMap` with the agents of the sample given as
// data, so a screen can show an agent that the start board's team does not have; for the same agents and
// the same selection it draws exactly what `theMap` draws.

const SIDE_W = S.sidePanel().w;
const LEAD = S.TEAM[0];
const TEAM_LINKS = [["overseer", "overlord-shop"], ["overlord-shop", "executor-shop"], ["overlord-shop", "executor-shop-2"]];
const TEAM_WORLD = { nodes: [S.OVERSEER, ...S.TEAM], links: TEAM_LINKS };

// The executor of the blog cluster runs by hand in the Codex app on LAPTOP, which is offline, and has no Overlord.
const BLOG = { id: "executor-blog", glyph: "term", x: 610, y: 580, sz: 42, status: "idle" };
// The first agent of the shop cluster, as 3.5 creates it, before the team of 3.7 forms around it.
const FIRST = { id: "executor-shop", glyph: "term", x: 185, y: 590, sz: 46, status: "idle" };

// An added repository becomes one more cluster, linked to it (7.2a): the start board's table gains an entry.
S.CLUSTERS["landing-site"] = { at: [290, 150, 190, 130], link: "repo", path: "github.com/acme/landing-site", branch: "main" };

/** The Map: clusters as frames, then `under` (lines drawn beneath the nodes), the nodes and their lines, then `extras`. */
function agentsMap({ clusters = S.FOUR, nodes = [S.OVERSEER], links = [], sel = null, clusterSel = null, group = [], under = [], extras = [] } = {}) {
  const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return stack(
    { name: "map", label: "Map", w: MID_W, fill: "bg", clip: true },
    row({ gap: 14, place: { x: 14, y: 12 } }, t("Drag the empty space to move around; Shift and drag to select", 12, { color: "mute" })),
    ...clusters.flatMap((id) => S.area(id, { sel: id === clusterSel && !sel })),
    lines(links.map(([a, b]) => pathOf(at[a], at[b])), { stroke: "edge", strokeWidth: 1.5 }),
    ...under,
    ...nodes.flatMap((n) => unitNode(L, n, { sel, group })),
    ...extras,
    zoom(L),
    services(L),
  );
}

/** The first node called `name` in a tree, with the list that holds it and its place there. */
function holder(node, name) {
  for (const [at, kid] of (node.kids ?? []).entries()) {
    if (kid.name === name) return [node.kids, at];
    const found = holder(kid, name);
    if (found) return found;
  }
  return null;
}

/** Puts nodes in a tree right after the first node called `name`. */
function insertAfter(tree, name, ...nodes) {
  const found = holder(tree, name);
  if (!found) throw new Error(`No node called ${name}`);
  found[0].splice(found[1] + 1, 0, ...nodes.filter(Boolean));
}

/** One screen of the Map: the window with its side panel, the Map and the inspector. */
const mapScreen = ({ side, map, inspector, ...rest }) => shell("Map", body3(side, map, inspector), rest);

/** The shop cluster with its team, open in Hierarchy and framed on the Map. */
const teamSide = ({ sel = null, clusterSel = "shop" } = {}) => S.sidePanel({ clusters: S.FOUR, overseer: true, team: true, sel, clusterSel });
const teamMap = ({ sel = null, clusterSel = "shop", extras = [], under = [] } = {}) => agentsMap({ ...TEAM_WORLD, sel, clusterSel, extras, under });

/** The number of messages not read yet, beside an agent. */
const unreadPill = (id, n) =>
  row({ name: `unread-${id}`, label: `${n} unread`, pad: [1, 7], radius: "pill", fill: "acc" }, t(String(n), 11, { weight: 700, color: "accInk" }));

/** The row of executor-blog under its cluster in Hierarchy, with its alias or the messages it has not read. */
const blogRow = ({ sel = true, alias = null, unread = null } = {}) => {
  const line = unitRow(L, { id: "executor-blog", glyph: "term", level: 1, status: unread ? null : "idle", sel, alias });
  if (unread) line.kids.push(unreadPill("executor-blog", unread));
  return line;
};

/** Hierarchy with the blog cluster open and `rows` under it. */
const blogSide = (...rows) => {
  const side = S.sidePanel({ clusters: S.FOUR, overseer: true, team: true, clusterSel: "blog", sel: "executor-blog" });
  insertAfter(side, "cluster-blog", ...rows);
  return side;
};

/** The Map with the executor of the blog cluster next to the shop team. */
const blogMap = ({ sel = null, alias = null, unread = null, clusterSel = null, extras = [], under = [] } = {}) =>
  agentsMap({
    nodes: [...TEAM_WORLD.nodes, alias ? { ...BLOG, lab: alias } : BLOG],
    links: TEAM_LINKS,
    sel,
    clusterSel,
    under,
    extras: [
      unread ? row({ name: "map-unread-executor-blog", label: `${unread} unread`, pad: [1, 7], radius: "pill", fill: "acc", place: { x: BLOG.x + 12, y: BLOG.y - 36 } }, t(String(unread), 11, { weight: 700, color: "accInk" })) : null,
      ...extras,
    ],
  });

/** The first agent of the shop cluster on its own: no team yet. */
const firstSide = ({ status = "idle" } = {}) => {
  const side = S.sidePanel({ clusters: S.FOUR, overseer: true, clusterSel: "shop", sel: "executor-shop" });
  insertAfter(side, "cluster-shop", unitRow(L, { id: "executor-shop", glyph: "term", level: 1, status, sel: true }));
  return side;
};
const firstMap = ({ status = "idle", extras = [] } = {}) =>
  agentsMap({ nodes: [S.OVERSEER, { ...FIRST, status }], sel: "executor-shop", clusterSel: "shop", extras });

const pill = (kids, at) => row({ gap: 7, pad: [6, 10], radius: "pill", fill: "panel", stroke: "line2", place: at }, ...kids);

// ---- setup ------------------------------------------------------------------------------------------

const SETUP_STEPS = 4;

/** A setup window. `kids` is a function that builds the body, so every drawing of the screen builds new nodes. */
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
        ...kids(),
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

const setupWelcome = setup(1, "Install HIVEM1ND", "Setup takes about a minute.", () => [
  col(
    { gap: 12 },
    bullet("graph", "Control the Swarm from the Map"),
    bullet("net", "Organize agents to reach objectives faster and better"),
    bullet("zap", "Relay is used for inter-session communication"),
  ),
], { back: false, next: "Start setup" });

const setupMind = setup(2, "Where the M1ND lives", "The M1ND holds your agents, chats, boards and texts. Relay is optimized to run in cloud storage services for free syncing of your preferences.", () => [
  col({ gap: 8 }, label("Folder"), pathRow(M1ND_PATH)),
  offer("legacy", "Migrate legacy M1ND", "A HIVEM1ND 2.x M1ND was found in C:\\Users\\you\\OneDrive\\HIVEM1ND. It is copied and upgraded; the original stays untouched.", { on: true }),
  offer("relay-plus", "Use Relay+", "Sync your preferences on any device, phones included, through the same service as Nebula+.", { soon: true }),
]);

/** The folder chosen already holds a 3.0 M1ND: this machine joins it instead of making a new one. */
const setupJoin = setup(2, "Where the M1ND lives", "The M1ND holds your agents, chats, boards and texts. Relay is optimized to run in cloud storage services for free syncing of your preferences.", () => [
  col({ gap: 8 }, label("Folder"), pathRow("C:\\Users\\you\\OneDrive\\.m1nd")),
  offer("join", "Join this M1ND", "A HIVEM1ND 3.0 M1ND is already in this folder: 16 agents, last used on LAPTOP at 23:40. This machine joins it; nothing in it is replaced.", { on: true }),
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
          ...[["overseer", "Claude Code", "DESKTOP"], ["executor-shop", "Codex", "DESKTOP"], ["executor-blog", "Codex app", "LAPTOP, offline"]].map(([agent, client, machine]) =>
            row({ gap: 10, pad: [9, 12], radius: 12, fill: "card" }, ic("term", 15), mono(agent, 12.5, { weight: 700 }), t(client, 12.5, { color: "body" }), fill(), t(machine, 12, { color: "mute" })),
          ),
          t("A session on an offline machine closes the next time that machine starts HIVEM1ND.", 12, { color: "mute" }),
        ),
      ],
      actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Close them and migrate", "pri", null, "close-2x")],
      w: 560,
    }),
  );

const setupService = setup(3, "Starting the Relay service", "One service per machine wakes your sessions and carries messages. It runs while HIVEM1ND needs it and uses nothing while idle.", () => [
  steps([
    ["M1ND folder created and protected", "done", "2 s"],
    ["Legacy M1ND copied and upgraded", "done", "6 s"],
    ["Service registered for this user", "done", "1 s"],
    ["Starting the service", "busy", "3 s"],
    ["Opening the Map", "todo"],
  ]),
], { back: false, next: "Installing", nextBusy: true });

const setupFailed = setup(3, "Starting the Relay service", "One service per machine wakes your sessions and carries messages. It runs while HIVEM1ND needs it and uses nothing while idle.", () => [
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

const setupDone = setup(4, "HIVEM1ND is running", "The service is running on DESKTOP. To add another machine, install HIVEM1ND there and choose the same M1ND folder.", () => [
  col(
    { gap: 8, pad: 14, radius: 14, fill: "card" },
    row({ gap: 10 }, ic("folder", 15, "mute"), t("M1ND", 13, { color: "mute" }), fill(), mono(M1ND_PATH, 12.5, { color: "text" })),
    row({ gap: 10 }, ic("retry", 15, "mute"), t("Legacy M1ND", 13, { color: "mute" }), fill(), t("Migrated from 2.x, original untouched", 13, { color: "text" })),
    row({ gap: 10 }, ic("power", 15, "mute"), t("Service", 13, { color: "mute" }), fill(), row({ gap: 6 }, dot("work"), t("Running", 13, { color: "text" }))),
    row({ gap: 10 }, ic("term", 15, "mute"), t("Agents", 13, { color: "mute" }), fill(), t("Claude Code, Codex, Cursor, OpenCode", 13, { color: "text" })),
    row({ gap: 10 }, ic("folder", 15, "mute"), t("Projects", 13, { color: "mute" }), fill(), t("26 repositories in 3 folders", 13, { color: "text" })),
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
        col({ gap: 12, align: "center", place: "center" }, spinner(28), t("Reading the M1ND", 14, { weight: 600 }), t("16 agents, 4 clusters, 5 chats, 5 boards", 12.5, { color: "mute" })),
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

/** The first run with no repository on the machine: the Map opens empty and the first prompt creates the Overseer. */
const emptyMind = () =>
  mapScreen({
    side: S.sidePanel(),
    map: agentsMap({
      clusters: [],
      nodes: [],
      extras: [
        circle(64, { stroke: "acc", strokeWidth: 2, dash: "6 5", place: { x: S.OVERSEER.x - 32, y: S.OVERSEER.y - 32 } }),
        col({ w: 200, align: "center", place: { x: S.OVERSEER.x - 100, y: S.OVERSEER.y + 44 } }, t("The Overseer goes here", 12.5, { color: "mute" })),
      ],
    }),
    inspector: S.emptyInspector(
      "Your M1ND is empty",
      "The Overseer coordinates every other agent. Create it first; then add clusters and agents from the Map.",
      button(L, "Create the Overseer", "pri", "plus", "create-overseer"),
    ),
    waiting: 0,
  });

/** The window of 1.7 with Local model chosen: Runs in lists what Lyra installed and its modes in place of effort. */
const overseerLocal = () => {
  const picker = S.runsInPicker(true);
  delete picker.place;
  picker.w = 552;
  return S.shell(
    S.body3(S.treeSide({ open: null, sel: null }), S.overviewMap({ overseer: false }), S.emptyInspector("26 repositories imported", "Three folder clusters, with the repositories inside them.")),
    {
      over: [
        S.scrim(),
        S.dialog({
          title: "Create your Overseer",
          sub: "It watches over every cluster: it answers what is going on and hands work to each cluster's lead. It runs only when you write to it.",
          w: 600,
          kids: [
            row(
              { gap: 10 },
              S.kind(false, "term", "External agent", "Claude Code, Codex or Cursor, with your own account. The strongest answers; uses that account's quota."),
              S.kind(true, "bulb", "Local model", "Lyra on this machine. Free and private, with no quota; slower and less capable."),
            ),
            S.field("Runs in", "Lyra, Qwen 3.5 9B, Thinking", { glyph: "term" }),
            picker,
            S.check(true, "Start fresh every session", "Recommended: it reads the M1ND again instead of carrying an old conversation. It tells you when its context is filling."),
          ],
          actions: [button(L, "Later", "ghost", null, "later"), button(L, "Create", "pri", null, "create-overseer")],
        }),
      ],
    },
  );
};

// ---- the Map ------------------------------------------------------------------------------------------

const mapSelected = () =>
  mapScreen({ side: teamSide({ sel: "executor-shop" }), map: teamMap({ sel: "executor-shop" }), inspector: unitPanel({ convo: [...HISTORY(), buildAsk(L), reviewAsk(L)] }) });

const BLOG_FACTS = (reportsTo = t("No Overlord", 13, { color: "text" })) => [
  ["Machine", row({ gap: 6 }, ic("lap", 14, "text"), t("LAPTOP", 13, { color: "text" }))],
  ["Runs in", t("Codex app, started by hand", 13, { color: "text" })],
  ["Inbox", t("2 unread", 13, { color: "text" })],
  ["Reports to", reportsTo],
];
const BLOG_CONVO = () => [message(L, { who: "overseer", when: "22:44", body: "When you start, announce the empty cart on the blog." })];

/** The inspector of executor-blog: no session, on LAPTOP. */
const blogPanel = ({ alias = null, reportsTo = undefined, place = null } = {}) =>
  unitPanel({
    title: "executor-blog", alias, status: "idle", statusText: "No session",
    factsList: BLOG_FACTS(reportsTo), convo: BLOG_CONVO(),
    place: place ?? [`Message ${alias ?? "executor-blog"}`, "It waits in the inbox until a session starts", "mail"],
  });

/** Renaming in place: the field holds the alias, the id stays written under it. */
const renameField = (value) =>
  col(
    { name: "rename", label: "Alias", gap: 4, pad: [4, 8, 4, 24] },
    row({ gap: 8, pad: [6, 10], radius: 9, fill: "card", stroke: "acc" }, ic("term", 15, "body"), t(value, 13.5, { weight: 700, color: "text" }), box({ w: 2, h: 16, fill: "acc" }), fill(), ic("check", 14, "acc")),
    t("Alias only. The id stays executor-blog; Enter saves, Esc cancels.", 11.5, { color: "mute" }),
  );

const mapRename = () => mapScreen({ side: blogSide(renameField("Blog")), map: blogMap({ sel: "executor-blog" }), inspector: blogPanel() });

const mapRenamed = () =>
  mapScreen({
    side: blogSide(blogRow({ alias: "Blog" })),
    map: blogMap({ sel: "executor-blog", alias: "Blog" }),
    inspector: blogPanel({ alias: "Blog" }),
    over: [toast("executor-blog shows as Blog", "Undo")],
  });

const connectRow = (from, to) =>
  row({ gap: 12, pad: 14, radius: 14, fill: "card", justify: "center" }, avatar(L, "term", 34, 16), mono(from, 13, { weight: 700 }), t("reports to", 13, { color: "mute" }), avatar(L, "net", 34, 16), mono(to, 13, { weight: 700 }));

const mapConnect = () =>
  mapScreen({
    side: S.sidePanel({ clusters: S.FOUR, overseer: true, team: true }),
    map: blogMap({
      under: [lines([pathOf(LEAD, { x: BLOG.x, y: BLOG.y - 32 })], { stroke: "acc", strokeWidth: 2, dash: "6 5" })],
      extras: [
        circle(62, { stroke: "acc", strokeWidth: 2, dash: "6 5", place: { x: BLOG.x - 31, y: BLOG.y - 31 } }),
        tip(L, "net", "executor-blog will report to overlord-shop", { x: 390, y: 662 }),
      ],
    }),
    inspector: nothing(),
    over: [
      scrim(),
      dialog({
        title: "Connect executor-blog",
        sub: "executor-blog will report to overlord-shop. Clusters and chats do not change.",
        kids: [connectRow("executor-blog", "overlord-shop")],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Connect", "pri", null, "connect")],
      }),
    ],
  });

const mapConnectSaving = () =>
  mapScreen({
    side: blogSide(blogRow()),
    map: blogMap({
      sel: "executor-blog",
      under: [lines([pathOf(LEAD, BLOG)], { stroke: "acc", strokeWidth: 2 })],
      extras: [pill([spinner(12), t("Saving", 12, { color: "body" })], { x: BLOG.x + 34, y: BLOG.y - 14 })],
    }),
    inspector: blogPanel({
      reportsTo: row({ gap: 6 }, spinner(11), t("overlord-shop", 13, { color: "text" })),
      place: ["Message executor-blog", "No session: the message waits in its inbox", "mail"],
    }),
    over: [toast("executor-blog now reports to overlord-shop", "Undo")],
  });

const mapRemoveUnit = () =>
  mapScreen({
    side: teamSide({ sel: "executor-shop" }),
    map: teamMap({ sel: "executor-shop" }),
    inspector: unitPanel({ convo: [...HISTORY(), buildAsk(L), reviewAsk(L)] }),
    over: [
      scrim(),
      dialog({
        title: "Remove executor-shop?",
        sub: "It leaves the Map and Hierarchy. Its chat and inbox move to Archived and its tasks stay in the cluster shop. A session running now is stopped first.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Remove agent", "remove-agent")],
      }),
    ],
  });

const SELECTED = [["overlord-shop", "net", "work"], ["executor-shop", "term", "work"], ["executor-shop-2", "term", "idle"]];

const selectionPanel = () =>
  panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, { glyph: "users", title: "3 selected", monoTitle: false, sub: t("A drag on empty space selects; Shift adds", 12.5, { color: "mute" }) }),
    col({ gap: 2, pad: [8, 12] }, ...SELECTED.map(([id, glyph, status]) => unitRow(L, { id, glyph, status }))),
    col(
      { gap: 10, pad: [8, 18] },
      button(L, "New cluster", "pri", "folder-plus", "new-cluster-selection"),
      button(L, "Message all 3", "plain", "send", "message-all"),
      button(L, "Connect to a lead", "plain", "net", "connect-lead"),
      button(L, "Clear selection", "ghost", null, "clear"),
    ),
    col({ pad: [6, 18] }, t("A cluster keeps these agents together: a folder in Hierarchy, a frame on the Map and one chat.", 12.5, { color: "mute" })),
  );

const mapSelection = () => {
  // Hierarchy shows the team with the three selected rows lit; no single selection.
  const side = teamSide({ sel: "selection" });
  for (const [id] of SELECTED) {
    const [list, at] = holder(side, `row-${id}`);
    list[at].fill = "card2";
  }
  return mapScreen({
    side,
    map: agentsMap({
      ...TEAM_WORLD,
      group: SELECTED.map(([id]) => id),
      extras: [
        box({ name: "selection", label: "Selection", w: 262, h: 190, radius: 14, stroke: "acc", strokeWidth: 1.5, dash: "6 5", fill: "accSoft", place: { x: 54, y: 500 } }),
        tip(L, null, "3 selected: New cluster, Message all 3, Connect", { x: 54, y: 414 }),
      ],
    }),
    inspector: selectionPanel(),
  });
};

// ---- clusters and agents ------------------------------------------------------------------------------

const noMessages = () => t("No messages yet. What you write here goes to the cluster's lead once it has one.", 12.5, { color: "mute" });

/** The shop cluster in three places: its row in Hierarchy, its frame on the Map and its chat in the inspector. */
const shopClusterScreen = (over = [], waiting = 0) =>
  mapScreen({
    side: S.sidePanel({ clusters: S.FOUR, overseer: true, clusterSel: "shop" }),
    map: agentsMap({ clusterSel: "shop" }),
    inspector: S.clusterPanel("shop", { convo: [noMessages()] }),
    waiting,
    over,
  });

const mapGroup = () => shopClusterScreen([toast("Cluster shop created", "Undo")]);

const mapDeleteGroup = () =>
  shopClusterScreen([
    scrim(),
    dialog({
      title: "Delete the cluster shop?",
      sub: "Its frame on the Map and its row in Hierarchy go. Its chat moves to Archived in Chats. The linked repository, github.com/you/shop, and its files are never touched.",
      actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Delete cluster", "delete-cluster")],
    }),
  ]);

/** The New agent window while the agent is created: it stays open, its choices dimmed, and the button turns into a spinner. */
const mapCreating = () =>
  mapScreen({
    side: S.sidePanel({ clusters: S.FOUR, overseer: true, clusterSel: "shop" }),
    map: agentsMap({ clusterSel: "shop" }),
    inspector: S.clusterPanel("shop"),
    waiting: 0,
    over: [
      col(
        { name: "new-agent", label: "New agent", w: 320, gap: 12, pad: 16, radius: 16, fill: "card2", stroke: "line2", place: { x: 1098, y: 96 } },
        t("New agent in shop", 14.5, { weight: 700 }),
        col({ gap: 12, opacity: 0.6 }, S.segmented([["Executor", true, "term"], ["Overlord", false, "net"]], "role"), S.field("Runs in", "Claude Code, Sonnet 5.5, high", { glyph: "term" })),
        t("It stays open while the agent is created. If it fails, it keeps these choices and says why.", 12, { color: "mute" }),
        row({ gap: 8, justify: "end" }, button(L, "Cancel", "ghost", null, "cancel"), busy("Creating")),
      ),
    ],
  });

const CREATED_FACTS = () => [
  ["Machine", row({ gap: 6 }, ic("desk", 14, "text"), t("DESKTOP", 13, { color: "text" }))],
  ["Runs in", t("Claude Code, Sonnet 5.5, high", 13, { color: "text" })],
  ["Cluster", t("shop", 13, { color: "text" })],
  ["Reports to", t("No Overlord", 13, { color: "text" })],
];

/** The inspector of executor-shop as 3.5 creates it, before and while it runs. */
const createdPanel = ({ status = "idle", statusText = "No session", convo, place = ["Message executor-shop", "No session: the message waits in its inbox", "mail"] }) =>
  unitPanel({ title: "executor-shop", status, statusText, factsList: CREATED_FACTS(), convo, place });

const NO_SESSION = () => [
  col(
    { gap: 12, pad: [24, 8], align: "center" },
    t("No messages yet", 14, { weight: 700 }),
    t("Messages wait in its inbox until a session starts.", 13, { color: "mute", align: "center" }),
    button(L, "Start session", "pri", "play", "start-session"),
  ),
];

/** The first agent of the shop cluster on the Map: its window, Hierarchy and Map. */
const firstScreen = ({ status = "idle", mapExtras = [], inspector, over = [] }) =>
  mapScreen({ side: firstSide({ status }), map: firstMap({ status, extras: mapExtras }), inspector, waiting: 0, over });

const mapCreated = () => firstScreen({ inspector: createdPanel({ convo: NO_SESSION() }), over: [toast("executor-shop created", "Start a session")] });

const mapStartSession = () =>
  firstScreen({
    inspector: createdPanel({ convo: NO_SESSION() }),
    over: [
      scrim(),
      dialog({
        title: "Start a session",
        sub: "executor-shop on DESKTOP. It runs in the agent, model and effort stored on it; Change opens the Runs in picker.",
        kids: [
          col(
            { gap: 6 },
            label("Runs in"),
            row({ name: "runs-in-stored", label: "Runs in", gap: 10, pad: [8, 8, 8, 12], radius: 12, fill: "card", stroke: "line2" }, ic("term", 15, "mute"), t("Claude Code, Sonnet 5.5, high", 14, { color: "text" }), fill(), button(L, "Change", "plain", null, "change-runs-in")),
          ),
          col(
            { gap: 8 },
            label("Runs as"),
            segment([["One task, then it closes", true], ["Chat, kept open", false]], "runs-as"),
            t("An Executor applies one feature: by default it runs its task and closes. Opened on its own it is a chat, and from there it can open the CLIs it needs.", 12, { color: "mute" }),
          ),
          field("Task or first message", "Add the empty state to the cart page", {}),
          t("To run it by hand instead, open an agent's app and run /executor shop.", 12, { color: "mute" }),
        ],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Start session", "pri", "play", "start")],
        w: 520,
      }),
    ],
  });

const mapStarting = () =>
  firstScreen({
    mapExtras: [{ ...spinner(60), place: { x: FIRST.x - 30, y: FIRST.y - 30 } }],
    inspector: createdPanel({
      status: "busy",
      statusText: "Starting a session",
      convo: [
        steps([["Request sent", "done", "23:44:02"], ["Starting Claude Code on DESKTOP", "busy", "6 s"], ["Session connected", "todo"]]),
        row({ gap: 8, justify: "end" }, button(L, "Cancel start", "ghost", null, "cancel-start")),
      ],
      place: ["Message executor-shop", "Sent now, it is delivered when the session connects", "mail"],
    }),
  });

const mapStartFailed = () =>
  firstScreen({
    inspector: createdPanel({
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
  firstScreen({
    status: "work",
    inspector: createdPanel({ status: "work", statusText: "Working on task 029", convo: HISTORY(), place: ["Message executor-shop", "The session is notified at once", "bell"] }),
    over: [
      scrim(),
      dialog({
        title: "Stop the session of executor-shop?",
        sub: "Its work in progress stops. The agent keeps its chat, inbox, tasks and cluster, and a new session can start later.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Stop session", "stop")],
      }),
    ],
  });

// ---- Add to M1ND: one + in the bar brings in skills, repositories and docs -----------------------------

const foundRow = (name, what, kind, on) =>
  row({ name: `found-${name}`, label: name, gap: 12, pad: [10, 12], radius: 12, fill: on ? "card2" : "card", stroke: on ? "acc" : undefined },
    tick(on, 18), t(name, 14, { weight: 700 }), t(what, 13, { color: "mute", lines: 1 }), fill(), row({ pad: [2, 9], radius: "pill", fill: "card2" }, t(kind, 12, { color: "body" })));

/** The Map as it is while the Add to M1ND window is open over it. */
const addScreen = (over) =>
  mapScreen({ side: S.sidePanel({ clusters: S.FOUR, overseer: true }), map: agentsMap(TEAM_WORLD), inspector: nothing(), over });

const mapAddWindow = () =>
  addScreen([
    scrim(),
    dialog({
      title: "Add to M1ND",
      sub: "Paste a link to a repository or a registry, or drop a folder.",
      kids: [
        row({ name: "add-link", label: "Link", pad: [11, 13], radius: 12, fill: "card", stroke: "acc" }, mono("https://github.com/acme/agent-skills", 13, { color: "text" })),
        col(
          { gap: 6 },
          label("Found in acme/agent-skills, commit 4f2c9e1"),
          foundRow("pdf", "Reads, fills and merges PDF files", "Skill", true),
          foundRow("docx", "Word documents", "Skill", false),
          foundRow("acme-files", "Reads and writes cloud files", "Tool server", false),
        ),
      ],
      actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Continue", "pri", null, "add-continue")],
      w: 600,
    }),
  ]);

const checkLine = (ok, value, note = null) =>
  row({ gap: 10 }, ok ? box({ w: 12, h: 12, radius: "pill", fill: "acc" }) : box({ w: 12, h: 12, radius: "pill", stroke: "wait", strokeWidth: 2 }), t(value, 13.5, { color: "text" }), fill(), note ? t(note, 12, { color: "mute" }) : null);

const mapAddCheck = () =>
  addScreen([
    scrim(),
    dialog({
      title: "Add pdf",
      sub: "Skill from acme/agent-skills. Nothing is copied until you press Add pdf.",
      kids: [
        col({ name: "add-check", label: "Check", gap: 8, pad: [12, 14], radius: 14, fill: "card" },
          checkLine(true, "Pinned to commit 4f2c9e1", "updates wait for your yes"),
          checkLine(true, "MIT license"),
          checkLine(true, "Older than 7 days, no install scripts"),
          checkLine(false, "Its scripts run Python", "only in the agents below"),
        ),
        col(
          { gap: 6 },
          label("Who can use it"),
          row({ gap: 12, pad: [10, 12], radius: 12, fill: "card" }, tick(false, 18), t("Every agent", 13.5)),
          row({ gap: 12, pad: [10, 12], radius: 12, fill: "card2", stroke: "acc" }, tick(true, 18), t("shop", 13.5, { weight: 700 }), fill(), row({ pad: [2, 9], radius: "pill", fill: "card2" }, t("Cluster, 3 agents", 12, { color: "body" }))),
          row({ gap: 12, pad: [10, 12], radius: 12, fill: "card2", stroke: "acc" }, tick(true, 18), mono("adjutant", 13, { weight: 700 })),
        ),
      ],
      actions: [button(L, "Back", "ghost", "back", "back"), button(L, "Add pdf", "pri", null, "add-confirm")],
      w: 600,
    }),
  ]);

/** The cluster an added repository becomes: linked to it, ready for its first agent. */
const landingPanel = () =>
  panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, {
      glyph: "folder",
      title: "landing-site",
      monoTitle: false,
      sub: t("Cluster linked to a repository", 12.5, { color: "mute" }),
      right: [row({ gap: 6 }, ibtn(L, "plus", "new-agent", "New agent"), ibtn(L, "dots", "more", "More"))],
    }),
    col(
      { name: "git", label: "Git", gap: 8, pad: [12, 16], edge: { side: "bottom", color: "line" } },
      row({ gap: 8 }, ic("graph", 14, "mute"), mono("github.com/acme/landing-site", 12, { color: "text" }), fill(), S.branch("main")),
      row({ gap: 8 }, t("Nothing to commit", 12.5, { color: "mute" }), fill(), t("Pinned at commit 91be0c2", 12, { color: "mute" })),
    ),
    col(
      { grow: 1, align: "center", justify: "center", gap: 12, pad: 32 },
      t("No agents yet", 16, { weight: 700 }),
      t("The repository is pinned at commit 91be0c2. Add its first agent to start working on it.", 13.5, { color: "mute", align: "center" }),
      button(L, "New agent in landing-site", "pri", "plus", "new-agent-landing"),
    ),
  );

const mapRepoAdded = () => {
  const clusters = [...S.FOUR, "landing-site"];
  return mapScreen({
    side: S.sidePanel({ clusters, overseer: true, clusterSel: "landing-site" }),
    map: agentsMap({ ...TEAM_WORLD, clusters, clusterSel: "landing-site" }),
    inspector: landingPanel(),
    over: [toast("landing-site added", "New agent")],
  });
};

// ---- chats and what waits on the person ------------------------------------------------------------

/** The side panel on its Chats tab: pinned and recent conversations, the clusters' chats among them. */
const chatsSide = () =>
  panel(
    L, "right", { name: "side", label: "Side panel", w: SIDE_W },
    tabs(L, [["Hierarchy", "net", false, "tab-hierarchy"], ["Chats", "users", true, "tab-chats"]]),
    search(L),
    col(
      { name: "chats", label: "Chats", pad: [6, 6, 10] },
      heading(L, "Pinned"),
      chatRow(L, { name: "chat-executor-shop", title: "executor-shop", glyph: "term", when: "23:40", preview: "Task 029 is ready for review.", sel: true }),
      heading(L, "Recent"),
      chatRow(L, { name: "chat-shop", title: "shop", glyph: "folder", badge: "3", preview: "executor-shop-2: The cart API answers an empty cart." }),
      chatRow(L, { name: "chat-overlord-shop", title: "overlord-shop", glyph: "net", when: "22:15", preview: "Plan ready: executor-shop builds the page." }),
      chatRow(L, { name: "chat-blog", title: "blog", glyph: "folder", when: "21:02", preview: "executor-blog: The announcement post is drafted." }),
      chatRow(L, { name: "chat-overseer", title: "overseer", glyph: "crown", when: "Yesterday", preview: "Two agents are waiting on you." }),
    ),
  );

const chatScreen = (convo, rest = {}, extra = {}) =>
  mapScreen({ side: chatsSide(), map: teamMap({ sel: "executor-shop" }), inspector: unitPanel({ convo, ...rest }), ...extra });

const chatList = () => chatScreen([...HISTORY(), buildAsk(L), reviewAsk(L)]);
const chatSending = () => chatScreen([...HISTORY(), mine("Add a Continue shopping button to the empty state too.", "Sending", { sending: true })]);

/** The Chat and Work tabs of an agent's inspector: the chat holds messages, the work holds the steps. */
const chatWorkTabs = () => tabs(L, [["Chat", "comment", true, "tab-chat"], ["Work", "list", false, "tab-work"]]);

const chatWorking = () =>
  chatScreen([...HISTORY(), mine("Add a Continue shopping button to the empty state too.", "Delivered 23:45"), working("executor-shop", "38 s", true)], { tabsRow: chatWorkTabs() });

const chatOpenCli = () =>
  chatScreen(
    [
      HISTORY()[1],
      working("executor-shop", "4 min", true),
      ask(L, [ic("term", 15, "text"), t("Asks to open a session", 13, { color: "text" }), code("Codex CLI on DESKTOP")], [button(L, "Approve", "pri", "check", "approve-cli"), button(L, "Deny", "ghost", null, "deny-cli")]),
    ],
    {},
    { waiting: 3 },
  );

const chatReply = () =>
  chatScreen([
    HISTORY()[1],
    mine("Add a Continue shopping button to the empty state too.", "Read 23:45"),
    message(L, { who: "executor-shop", when: "23:47", body: "Added. The button goes back to the catalog; the board shows it on the empty cart." }),
  ]);

const chatFailed = () =>
  chatScreen([...HISTORY(), mine("Add a Continue shopping button to the empty state too.", "Not confirmed: the service did not answer in 10 s.", { failed: true })], {
    composerNode: composer(L, "Message executor-shop", "Retry sends the same message once; it is never sent twice", "retry"),
  });

/** An agent with no session keeps its inbox: the messages it has not read, counted beside it in Hierarchy and on the Map. */
const inbox = () =>
  mapScreen({
    side: blogSide(blogRow({ alias: "Blog", unread: 2 })),
    map: blogMap({ sel: "executor-blog", alias: "Blog", unread: 2 }),
    inspector: unitPanel({
      title: "executor-blog", alias: "Blog", status: "idle", statusText: "No session",
      factsList: BLOG_FACTS(),
      convo: [
        col(
          { gap: 8, pad: [12, 14], radius: 14, fill: "waitSoft" },
          row({ gap: 8 }, ic("mail", 15, "wait"), t("Blog is not running", 13.5, { weight: 700 })),
          t("LAPTOP has been offline since 23:40. Messages wait in the inbox and are delivered when Blog starts again there.", 13, { color: "body" }),
          row({ gap: 8 }, row({ opacity: 0.5 }, button(L, "Start session", "plain", "play", "start-session")), t("Needs LAPTOP online", 12, { color: "mute" })),
        ),
        ...BLOG_CONVO(),
        message(L, { who: "You", when: "23:12", body: "Draft the post tonight; publish after the merge.", me: true }),
      ],
      place: ["Message Blog", "It waits in the inbox until a session starts", "mail"],
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
    L, "right", { name: "side", label: "Waiting on you", w: SIDE_W },
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
  mapScreen({ side: waitingSide(), map: teamMap({ sel: "executor-shop" }), inspector: unitPanel({ convo: [HISTORY()[1], buildAsk(L), reviewAsk(L)] }) });

const answered = (value) =>
  row({ gap: 8, pad: [10, 12], radius: 14, fill: "card" }, stack({ w: 18, h: 18 }, circle(18, { fill: "acc" }), centered(ic("check", 12, "accInk"))), t(value, 13, { color: "body" }));

const approvalSent = () =>
  mapScreen({
    side: waitingSide(),
    map: teamMap({ sel: "executor-shop" }),
    inspector: unitPanel({
      convo: [
        HISTORY()[1],
        ask(L, [ic("hand", 15, "text"), t("Asks to run", 13, { color: "text" }), code("npm run build")], [busy("Answer sent"), t("waiting for executor-shop to confirm", 12, { color: "mute" })]),
        reviewAsk(L),
      ],
    }),
  });

const sendBack = () =>
  mapScreen({
    side: teamSide({ sel: "executor-shop" }),
    map: teamMap({ sel: "executor-shop" }),
    inspector: unitPanel({ convo: [HISTORY()[1], answered("Approved 23:46: npm run build"), reviewAsk(L)] }),
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
    side: teamSide({ sel: "executor-shop" }),
    map: teamMap({ sel: "executor-shop" }),
    inspector: unitPanel({ statusText: "Idle, task 029 done", status: "idle", convo: [HISTORY()[1], answered("Approved 23:46: npm run build"), answered("Accepted 23:48: task 029")] }),
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
          row({ gap: 8, pad: [8, 10], radius: 10, fill: "card" }, ic("search", 14, "mute"), t("Search agents and clusters", 13, { color: "mute" })),
          ...[["executor-shop", "term", true], ["overlord-web", "net", true], ["Blog", "term", false], ["shop", "folder", false]].map(([id, glyph, on]) =>
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
    [toolbar(L, ...voidTool()), docCard([para(DOC.intro), h3("One service per machine"), para(DOC.service), h3("Chats and inboxes"), para(DOC.mail), h3("Live editors"), para(DOC.live)])],
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
    [toolbar(L, ...voidTool()), docCard([para(DOC.intro), h3("One service per machine"), para(DOC.service), h3("Chats and inboxes"), para(DOC.mail)])],
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
      docCard([para(DOC.intro), h3("One service per machine"), para(`${DOC.service} An idle machine makes no requests and sends nothing.`), h3("Chats and inboxes"), para(DOC.mail)], { dy: 110, h: 720 }),
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
        h3("Chats and inboxes"),
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
          h3("Chats and inboxes"),
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
          ["HIVEM1ND 3.0 brings every agent of the M1ND onto one Map. Agents are", "body"],
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
        h3("Chats and inboxes"),
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
    [toolbar(L, ...voidTool()), docCard([para(DOC.intro), h3("One service per machine"), para(`${DOC.service} Idle machines stay quiet.`), h3("Chats and inboxes"), para(DOC.mail)])],
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

const grantRow = (agent, action, since) =>
  row(
    { name: `grant-${slug(agent + " " + action)}`, label: `${agent}: ${action}`, gap: 12, pad: [10, 14], radius: 12, fill: "card" },
    ic("term", 15), mono(agent, 12.5, { weight: 700 }), code(action), fill(), t(since, 12, { color: "mute" }), button(L, "Revoke", "plain", "x", `revoke-${slug(agent + " " + action)}`),
  );

const settingsPermissions = () =>
  shell("Settings", settingsFrame(
    "permissions",
    section("Standing approvals", [
      grantRow("executor-shop", "npm run build", "Always since today 23:46"),
      grantRow("overlord-api", "npm test", "Always since yesterday"),
      t("Each one was given with Always for this agent in a chat. Revoke takes it back; the next request asks again.", 12.5, { color: "mute" }),
    ]),
    section("Agent permissions", [
      grantRow("Cursor CLI", "git commit, git push", "Given today 23:50"),
      t("Given in Connect an agent, only for sessions HIVEM1ND starts on this machine. Commits and pushes still run only when a person asks for them.", 12.5, { color: "mute" }),
    ]),
  ), {});

const projectsRemove = () =>
  shell("Settings", settingsFrame("projects", linksSection()), {
    over: [
      scrim(),
      dialog({
        title: "Remove the link of shop?",
        sub: "The files on disk are never touched. The cluster shop stays on the Map and in Hierarchy, linked to nothing: its agents can talk and plan, but have nowhere to write until a folder is linked.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Remove link", "remove-link")],
      }),
    ],
  });

/** A state with its dot: connected, changes needed, or nothing yet. */
const stateLine = (kind, value) =>
  row({ gap: 6 }, kind === "ok" ? dot("work") : kind === "wait" ? ic("alert", 13, "wait") : dot("idle"), t(value, 12.5, { color: kind === "wait" ? "wait" : kind === "ok" ? "body" : "mute" }));

/**
 * One agent found on the machine. The CLI comes first: HIVEM1ND starts and closes CLI sessions for the
 * agents. An app connection is optional, for writing to an agent in its own app; it uses the wake of today.
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
    row({ grow: 1 }, t("Command line (CLI): runs your agents", 12, { weight: 700, color: "mute" })),
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
    t("The command line is how HIVEM1ND runs your agents: it opens a session for each task and closes it. Auto loads the M1ND rules in every session; On demand only when a HIVEM1ND command runs.", 12.5, { color: "mute" }),
    t("The desktop app is separate and optional: connecting it lets you write to an agent in its own window, and the M1ND wakes it when a message arrives.", 12.5, { color: "mute" }),
    t("An agent can also be run by hand in an agent's app with its command, for example /executor shop. It joins the M1ND, keeps its place in the hierarchy and shows on the Map like any other.", 12.5, { color: "mute" }),
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

/** A folder cluster linked to a folder on disk, with each repository inside it a cluster linked to that repository. */
function linkBlock(name, path, repos, more = 0) {
  return col(
    { name: `links-${slug(name)}`, label: `${name}, linked to ${path}`, gap: 10, pad: [12, 14], radius: 14, fill: "card" },
    row(
      { gap: 10 },
      ic("folder", 15, "body"),
      t(name, 13.5, { weight: 700 }),
      mono(path, 13, { color: "text" }),
      fill(),
      t(repos.length + more === 1 ? "1 repository, a cluster" : `${repos.length + more} repositories, each a cluster`, 12, { color: "mute" }),
      ic("dots", 15),
    ),
    row(
      { gap: 8, pad: [0, 0, 0, 25] },
      ...repos.map((r) => row({ name: `link-${slug(r)}`, label: `${r}, linked`, gap: 6, pad: [4, 10], radius: "pill", fill: "card2" }, ic("graph", 12), t(r, 12.5, { color: "text" }), ic("x", 11, "mute"))),
      more ? t(`+${more} more`, 12, { color: "mute" }) : null,
    ),
  );
}

/** Projects: the clusters' links, each cluster with the repository or folder it is linked to, or no link. */
const linksSection = () =>
  section("Clusters and their links", [
    linkBlock("Web", "C:\\Users\\you\\Web", ["shop", "blog", "api-gateway", "nova"], 15),
    linkBlock("Unity", "C:\\Users\\you\\Unity", ["e-garden", "ghost-run", "quarry", "sentinel", "sky-paint", "the-trip"]),
    linkBlock("Tools", "C:\\Users\\you\\Tools", ["v-cash"]),
    row({ name: "links-ideas", label: "ideas, no link", gap: 10, pad: [12, 14], radius: 14, fill: "card" }, ic("folder", 15, "body"), t("ideas", 13.5, { weight: 700 }), t("No link", 13, { color: "mute" }), fill(), button(L, "Link a folder", "plain", "folder", "link-folder")),
    row({ gap: 10 }, button(L, "Add link", "plain", "folder-plus", "add-link"), t("A cluster is linked to a repository or a folder, and its agents may write only there. Remove takes a link away; the files on disk are never touched.", 12.5, { color: "mute" })),
  ], t("3 folders, 26 repositories, 1 cluster with no link", 12, { color: "mute" }));

const settingsProjects = () => shell("Settings", settingsFrame("projects", linksSection()), {});

function contentGroup(title, items) {
  return col(
    { grow: 1, gap: 8 },
    t(title, 12.5, { weight: 700, color: "mute" }),
    ...items.map(([value, on]) => row({ name: `content-${slug(value)}`, label: value, gap: 10, pad: [8, 10], radius: 10, fill: "card" }, tick(on), t(value, 13, { color: on ? "text" : "body" }))),
  );
}

const settingsContent = (added = false) => () =>
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
          ...(added ? [row({ name: "content-pdf", label: "pdf", gap: 10, pad: [9, 12], radius: 10, fill: "card2", stroke: "acc" }, tick(true), t("pdf", 13, { weight: 700 }), fill(), t("from acme/agent-skills, 4 agents", 12.5, { color: "acc" }), button(L, "Remove", "ghost", null, "remove-pdf"))] : []),
        ], button(L, "Add", "pri", "plus", "add-content")),
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
  ), added ? { over: [toast("pdf added for 4 agents", "Undo")] } : {});

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
    side: teamSide({ sel: "executor-shop" }),
    map: teamMap({ sel: "executor-shop", extras: [banner("busy", "Reconnecting to the service. What you do is kept and sent when it answers.", [button(L, "Retry now", "plain", "retry", "retry")])] }),
    inspector: unitPanel({ convo: [...HISTORY(), mine("Run the checkout tests too.", "Waiting for the service", { sending: true })] }),
    footer: { service: "wait", serviceText: "Reconnecting to the Relay service", read: "Last read 23:41" },
  });

const serviceDown = () =>
  mapScreen({
    side: S.sidePanel({ clusters: S.FOUR, overseer: true }),
    map: agentsMap({ ...TEAM_WORLD, extras: [banner("error", "The Relay service stopped on DESKTOP.", [button(L, "Details", "ghost", null, "details"), button(L, "Restart service", "pri", "power", "restart")])] }),
    inspector: nothing(),
    footer: { service: "wait", serviceText: "Relay service stopped", read: "Last read 23:41" },
  });

const slow = () =>
  chatScreen([...HISTORY(), mine("Summarize what changed today.", "Sending")], {
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

// The phone's Hierarchy shows the Overseer and the clusters, with the team of the open one.
const phoneCluster = (id, { open = false, sub = null } = {}) =>
  row(
    { name: `cluster-${id}`, label: id, gap: 8, pad: [11, 10], radius: 10 },
    ic(open ? "chevron" : "right", 14, "mute"),
    ic("folder", 15, "body"),
    t(id, 14, { weight: 600, color: "text" }),
    fill(),
    sub ? t(sub, 12, { color: "mute" }) : null,
  );

const phoneHierarchy = () =>
  phone(
    L,
    ...phoneTop(L, "Hierarchy", 2),
    col(
      { name: "hierarchy", label: "Hierarchy", grow: 1, pad: [6, 10], clip: true },
      unitRow(L, { id: "overseer", glyph: "crown", status: "idle", sub: "Above every cluster", phone: true }),
      heading(L, "Clusters"),
      phoneCluster("shop", { open: true }),
      unitRow(L, { id: "overlord-shop", glyph: "net", level: 1, status: "work", phone: true }),
      unitRow(L, { id: "executor-shop", glyph: "term", level: 2, sub: "2 asks", status: "work", sel: true, phone: true }),
      unitRow(L, { id: "executor-shop-2", glyph: "term", level: 2, status: "idle", phone: true }),
      phoneCluster("blog", { sub: "main" }),
      phoneCluster("api-gateway", { sub: "feat/auth" }),
      phoneCluster("nova", { sub: "main" }),
      heading(L, "Home network"),
      unitRow(L, { id: "Access closes in 11 h 58 min", name: "row-access", glyph: "phone", plain: true, phone: true }),
    ),
    phoneNav(L, "Hierarchy"),
  );

// ---- the screens: title, picture and note, by id --------------------------------------------------

const SCREEN = {
  // 1 Setup and first run
  "setup-welcome": ["Install", setupWelcome, "The installer opens setup in the browser. Under one line on how long it takes, three lines say what HIVEM1ND is for: the Swarm on the Map, agents organized toward their objectives, and Relay between sessions."],
  "setup-mind": ["Where the M1ND lives", setupMind, "The folder defaults to the Cosmic root and can be changed; a folder inside a cloud storage service syncs through that service, so there is no sync choice. When a 2.x M1ND is found, a banner offers Migrate legacy M1ND, ticked: it is copied and upgraded and the original is never changed. Relay+ is announced as coming soon."],
  "setup-service": ["Relay service", setupService, "Each step shows its own state while it runs, so setup never looks frozen. There is no Back here: going back while the service installs could break the installation."],
  "setup-done": ["Ready", setupDone, "What was set up, and how to add another machine."],
  "setup-loading": ["Opening", loading, "The window shows at once with its frame; the panels fill as the M1ND is read, with a loader in the middle."],
  "first-repos-found": ["Repositories found", S.reposFound, "The Map starts empty and moves in X and Y. Repositories found on the machine are offered, never imported on their own, grouped by the folder that holds them, with a filter. Each folder becomes a cluster linked to it, with its repositories as clusters inside; worktrees stay inside their repository."],
  "first-overseer": ["Create your Overseer", S.createOverseer, "The first prompt creates the Overseer, the agent above every cluster. It runs in an external agent, Claude Code, Codex or Cursor with the person's own account, or in a local model through Lyra when its service runs on the machine: free, private and without quota. Runs in opens the picker of 3.4, or of 3.4a for Lyra. By default it starts fresh in each session; the person can keep its context instead."],
  "first-overview": ["All clusters", S.overview, "Zoomed out, the whole Map fits: the Overseer at the center, each folder cluster with every repository in it. However large the graph grows, zooming out shows all of it. Hierarchy holds the same tree, and a double click on a cluster there or on the Map flies to it. The person's own preferences live in Settings, not on the Map. From here each part of the app opens on its own row, to the right."],
  "first-overseer-local": ["Create your Overseer: a local model", overseerLocal, "With Local model chosen, Runs in lists the models Lyra installed and its modes, Fast, Normal and Thinking, in place of effort. Lyra runs on this machine through its local service: free, private and without quota, slower and less capable than the cloud models."],
  "setup-load-failed": ["The M1ND cannot be read", loadFailed, "Reading stops at 30 s and says why, with Retry and Choose another folder."],
  "setup-empty": ["No repositories found", emptyMind, "With no repository on the machine, the Map opens empty and the first prompt creates the Overseer."],
  "setup-failed": ["A step failed", setupFailed, "A failed step says why and what was not changed; Retry runs it again. Closing the page resumes setup from this step."],
  "setup-join": ["Join an existing M1ND", setupJoin, "When the folder chosen already holds a 3.0 M1ND, as on a second machine, setup joins it: nothing in it is replaced, and this machine's record is added."],
  "setup-close-2x": ["Close 2.x sessions", setupClose2x, "Before a legacy M1ND is copied, its running 2.x sessions are closed, so only the 3.0 service wakes sessions. Their work is saved."],

  // 2 The Map
  "first-inside": ["Zoomed in on a cluster", S.inside, "The same Map, zoomed in on Web: its repositories at full size, shop selected with its branch and changes. Zooming out goes back to the whole graph. Agents can sit in a folder cluster, as an Overlord over its repositories, or in one repository."],
  "map-selected": ["An agent selected", mapSelected, "A click selects an agent: its facts, its chat and what it asks of you. A double click in Hierarchy centers it on the Map."],
  "map-rename": ["Rename", mapRename, "F2, or Rename in the More menu, renames in place. The name is an alias: the id stays the same and stays written beside it."],
  "map-renamed": ["Renamed", mapRenamed, "The alias shows in Hierarchy, on the Map and in the inspector, with the id beside it; the notice offers Undo."],
  "map-connect": ["Connect", mapConnect, "A drag from overlord-shop to executor-blog asks first, in words, who will report to whom."],
  "map-connect-saving": ["Connected", mapConnectSaving, "The line is drawn at once and saved in the background; the notice confirms it and offers Undo."],
  "map-remove-unit": ["Remove an agent", mapRemoveUnit, "Removing an agent asks first and archives its chat and inbox; the notice offers Undo."],
  "map-selection": ["A selection", mapSelection, "A drag on empty space selects; the inspector offers New cluster, Message all 3 and Connect to a lead."],

  // 3 Clusters and agents
  "clusters-new-cluster": ["New cluster", S.newCluster, "A cluster is the one way to group agents. Linked to a repository or a folder, that is where its agents may write; linked to nothing, it is only a grouping."],
  "map-group": ["A cluster", mapGroup, "One cluster, three places: its folder in Hierarchy, its frame on the Map and its chat in the inspector. A click on any of them selects the cluster."],
  "clusters-new-agent": ["New agent", S.newAgent, "Inside a cluster: Executor or Overlord, and what it runs in, agent, model and effort in one list. It writes only where its cluster is linked; name and machine are set for it."],
  "clusters-runs-in": ["Agent, model and effort", S.pickRunsIn(false), "Runs in opens one picker with three columns: the agents connected on this machine, each with the quota it has left, the models of the chosen agent, and the effort. Only connected agents are listed; Lyra appears when its service runs on the machine. The choice can become the default for new agents."],
  "map-creating": ["Creating", mapCreating, "The New agent window stays open while the agent is created; if it fails, it keeps the choices and says why."],
  "map-created": ["Created", mapCreated, "The agent appears selected inside its cluster, without a session. Messages wait in its inbox."],
  "clusters-team": ["A team in a cluster", S.team, "With an Overlord, the cluster's chat goes to it: it makes the plan in the chat and gives each task to an Executor."],
  "clusters-plan": ["The plan in the chat", S.planReady, "The lead answers with a plan inside the chat, as Cursor does: each task says who does it and in what agent, model and effort, all changeable in place. Run starts it on its own branch. With no Overlord, the Executor plans for itself; agents of a cluster with no lead ask the person who plans. Only the lead opens the others' sessions; no agent opens another."],
  "clusters-running": ["The plan runs", S.planRuns, "The same plan shows each task's state and time; each task is committed on the plan's branch. Every agent confirms that it started within 3 minutes and reports each step, which the Work tab shows."],
  "clusters-stuck": ["The plan needs you", S.planStuck, "No start within 3 minutes, no progress for 10 (30 while planning), or a message unread for 10 turn the plan into a warning with Stop and Retry; it also waits in Waiting. The lead is told first, then the Overseer, then the person. The plan sets the message budget, one per task, with extensions agreed and logged up to half the plan; past that the person is asked."],
  "map-start-session": ["Start a session", mapStartSession, "A session runs in an agent CLI connected on that machine, in the agent, model and effort stored on the agent; Change opens the Runs in picker. An Executor runs one task and closes by default; as a chat it stays open and can open other CLIs itself."],
  "map-starting": ["Starting", mapStarting, "Each step shows its state; a message sent now is delivered once the session connects."],
  "map-stop": ["Stop a session", mapStop, "Stopping asks first and says what stops and what stays."],
  "map-start-failed": ["It did not start", mapStartFailed, "Every wait has a limit: after 30 s it says what happened and offers Retry."],
  "clusters-runs-in-lyra": ["Lyra as the agent", S.pickRunsIn(true), "Lyra is one more agent for any role, Overseer, Overlord or Executor, through its local service, the same one its command line uses. Its models are the ones Lyra installed, and its modes, Fast, Normal and Thinking, take the place of effort. Free, private and without quota; slower and less capable than the cloud models."],
  "map-delete-group": ["Delete a cluster", mapDeleteGroup, "Deleting a cluster asks first and names what goes and what stays: its chat is archived, and the linked folder and its files are never touched. The notice offers Undo."],
  "clusters-no-link": ["A cluster with no link", S.noLink, "Its agents can talk and plan, but have nowhere to write until a folder is linked."],

  // 4 The Overseer
  "overseer-chat": ["Across every cluster", S.overseerChat, "The Overseer answers across clusters and hands work to each cluster's lead. Its context bar shows how full its conversation is."],
  "overseer-full": ["Its context is filling", S.overseerFull, "Before the context runs out it says so: Compact keeps a summary of the conversation, Clear starts empty and reads the M1ND again, and X closes the notice."],

  // 5 Chats and messages
  "chat-chat": ["A chat", chatList, "Chats lists pinned and recent conversations, the clusters' chats among them; the chat opens in the inspector."],
  "chat-sending": ["Sending", chatSending, "The line appears at once, marked Sending, and the box is free for the next one."],
  "chat-working": ["The agent is working", chatWorking, "Delivered, then the chat says the agent is working and for how long, with Stop. Its steps show in Work, not in the chat."],
  "chat-reply": ["The reply", chatReply, "The reply arrives in place; a Read mark replaces Delivered."],
  "messages-work": ["The work is apart", S.workTab, "What the session does, reading, editing, running, committing, opens in Work, step by step, never in the chat. The full transcript opens from More."],
  "chat-open-cli": ["Asks to open a session", chatOpenCli, "A chat Executor opens another CLI only with the person's approval; the ask waits with the others."],
  "chat-failed": ["Not confirmed", chatFailed, "A send waits 10 s for the service; a request waits 30 s (11.1a). Without an answer the line says Not confirmed; Retry sends the same message once, never twice."],
  "messages-chat": ["The chat is messages", S.chatTab, "What an agent starts with, its role, the M1ND and its task, is one folded line at the top, not a message. The chat holds only messages: what the person and the agents write to each other, kept even when the session closes. The inbox is not another place: it is the messages not read yet, counted beside the agent in Hierarchy and on the Map."],
  "chat-mailbox": ["The inbox", inbox, "The agent with no session keeps its inbox: the messages not read yet, counted beside it in Hierarchy and on the Map. Blog runs by hand in the Codex app on LAPTOP, which is offline, so Start session waits for that machine."],

  // 6 Waiting on you
  "chat-waiting": ["Waiting on you", waiting, "The pill in the bar opens what waits on you: asks, reviews, and what ended without an answer."],
  "chat-approval-sent": ["Answer sent", approvalSent, "Approve answers at once; the card shows the answer is on its way until the agent confirms it."],
  "chat-accepted": ["Accepted", accepted, "Accepting closes the review; the notice offers Undo."],
  "chat-send-back": ["Send back", sendBack, "Sending a task back needs a note: the agent reads it."],

  // 7 Add to M1ND
  "map-add": ["Add to M1ND", mapAddWindow, "+ Add sits in the bar of every mode, before Waiting. It takes a link to a repository or a registry, or a dropped folder, reads the files behind it and lists what it found; a repository with several parts offers each one."],
  "map-add-check": ["Check and who uses it", mapAddCheck, "Nothing is copied before this window: the pinned version, the license, its age, what it needs to run, then the agents or clusters that may use it. Updates later go through the same check and wait for a yes."],
  "map-add-skill": ["A skill in Content", settingsContent(true), "An added skill sits in Settings, Content, next to the ones the kit ships, with its origin and Remove. Content has its own Add, which opens the same window."],
  "map-add-repo": ["A repository becomes a cluster", mapRepoAdded, "An added repository becomes a cluster linked to it, on the Map and in Hierarchy, ready for its first agent."],

  // 8 Blueprint
  "blueprint-board": ["A board", bpBoard, "The library on the left, the board in the middle, comments on the right. The library is the one Void uses: search, filters, folders, and New board and New folder at the top."],
  "blueprint-edit": ["Edit the board", bpEdit, "The board is edited in place with the same tools agents use: select, move and resize, change text and fill. No separate editor."],
  "blueprint-sketch": ["Sketch by hand", bpSketch, "Sketches are drawn by hand on the same board, beside the screens. Attached agents read a sketch and can turn it into a screen."],
  "blueprint-attach": ["Attach agents", bpAttach, "Attached agents, or a whole cluster, are sent comments and can draw on the board."],
  "blueprint-comment": ["Comment", bpComment, "A comment pins to an element. Send to agent is on by default and keeps the value it was left at."],
  "blueprint-comment-sent": ["Comment sent", bpCommentSent, "Sent at once; the agent's work shows in the thread."],
  "blueprint-watch": ["Watch", bpWatch, "With Watch on, the board follows the agent as it draws."],
  "blueprint-conflict": ["Changed while editing", bpConflict, "The person chooses what stays: Show changes compares both, Keep mine replaces the agent's change, Reload takes it. Here Send to agent was turned off, and it stays off until turned on again."],
  "blueprint-history": ["History", bpHistory, "Every change to a board, by the person or an agent, is kept with who made it; Restore brings a version back and keeps the current one. Void keeps the same history for texts."],
  "blueprint-search": ["Search and filters", bpSearch, "Search runs over names, screens and comments across every folder; matching folders open. Filters stay on as chips until removed."],
  "blueprint-new-board": ["New board", bpNewBoard, "A new board starts empty, as a copy of another, or imported from a Blueprint Lite 2.x module, which stays untouched."],
  "blueprint-library": ["Board menu", bpLibraryMenu, "Each board has its menu: Rename, Duplicate, Move to folder and Delete. Folders collapse and are renamed and deleted the same way."],
  "blueprint-move": ["Move to another project", bpMove, "Moving a board to a folder of another project says that its file changes repository."],
  "blueprint-delete": ["Delete a board", bpDelete, "Deleting asks first and says what goes with the board."],

  // 9 Void
  "void-document": ["Document", voidDoc, "The default view: the library, the text, its attached agent and its comments. The library is Blueprint's: search, filters, collapsible folders, and create, rename and delete."],
  "void-edit": ["Editing", voidEdit, "The text is edited in place with Void's editor. The format bar appears over a selection only: bold, italic, strikethrough, headings, list, quote, code, link, table, image and comment. Saving is continuous."],
  "void-suggestion": ["A suggested change", voidSuggestion, "An agent's change waits as a suggestion until it is accepted, edited or discarded."],
  "void-stale": ["An old suggestion", voidStale, "A suggestion made on older text is never applied by itself; the passage can be edited directly."],
  "void-not-saved": ["Not saved", voidNotSaved, "A save that fails says so at once; the text stays on screen and Retry saves it."],
  "void-find": ["Find and replace", voidFind, "In this document or in all texts, with case, whole word and regular expressions. Undo puts every replaced match back at once."],
  "void-source": ["Source", voidSource, "The Markdown source, with the caret where it was."],
  "void-library": ["Rename and folders", voidLibrary, "A text is renamed in place; a new folder appears named and ready to type."],
  "void-delete": ["Delete a text", voidDelete, "Deleting a text or a folder asks first and names what goes; Undo brings it back for 10 seconds."],
  "void-focus": ["Focus", focus(L), "Pure black, only the text; the arrows move through the pages."],
  "void-focus-tools": ["Focus, tools shown", focusTools, "Moving the mouse brings the tools back; Esc returns to the Document view."],

  // 10 Settings
  "settings-settings": ["Settings", settings, "Settings opens from the gear at the right of the bar, on General. Looks: Modern (default), Nocturne, Nebula, Waves, Toxic and Kinetic, each previewed in its own palette. Start with Windows is optional and off by default."],
  "settings-agents": ["Agents", settingsAgents, "Changing Auto or On demand, or connecting an app, opens Connect an agent first. Each agent found on the machine, in two columns. Command line (CLI): how HIVEM1ND runs the agents, a session per task. Desktop app: optional, the agent's own window (Claude app, Codex app, Cursor editor) hooked to the chat of its agents. Agents can also be run fully by hand in an app with their commands, as in 2.x; they join the same hierarchy and show on the Map. Scan again finds an agent installed later."],
  "settings-connect": ["Connect an agent", settingsConnect, "Every change to an agent's configuration is listed before it is made: Apply makes them, Copy changes gives them to make by hand. Nothing is written without that answer."],
  "settings-machine": ["Another machine", settingsMachine, "Agents, Permissions, Projects and Locations belong to one machine; the selector shows another machine's last report, read only while it is offline."],
  "settings-permissions": ["Permissions", settingsPermissions, "Every standing approval and agent permission, with Revoke. Nothing here is given without the person's answer in a chat or in Connect an agent."],
  "settings-projects": ["Projects", settingsProjects, "Projects is the list of the clusters' links: each cluster with the repository or folder it is linked to, or no link. A link is added or removed here."],
  "settings-remove-repo": ["Remove a link", projectsRemove, "Removing a cluster's link asks first; the files on disk are never touched. The cluster stays, linked to nothing."],
  "settings-content": ["Content", settingsContent(false), "The features and knowledge packs included in the M1ND, and the preferences every agent reads."],

  // 11 The service
  "settings-reconnecting": ["Reconnecting", reconnecting, "If the service stops answering, work is kept and sent when it answers again."],
  "settings-service-down": ["Service stopped", serviceDown, "A stopped service is said plainly, with a way to restart it."],
  "settings-slow": ["Taking longer", slow, "A slow request says so at once and never waits without end."],

  // 12 The phone
  "settings-home": ["Open on the phone", homeQr, "A QR code and a short code for 12 hours; a new code replaces the old one."],
  "phone-pair": ["Pair", phonePair(false), "The phone opens the link or types the code; it never stores a password."],
  "phone-hierarchy": ["Hierarchy", phoneHierarchy, "See the whole M1ND: the Overseer and the clusters; no editing on the phone."],
  "phone-chat": ["A chat", phoneChat(L), "Chat and answer asks in place."],
  "phone-waiting": ["Waiting", phoneWaiting(), "Everything that waits on you, answered in place. Standing approvals and pushes are answered on the computer."],
  "phone-closed": ["Access ended", phoneClosed, "After 12 hours the access ends; a new code opens it again."],
  "phone-pair-error": ["Wrong code", phonePair(true), "A wrong code says so and how many tries are left."],
  "phone-locked": ["Pairing locked", phoneLocked, "After five wrong codes pairing locks for 10 minutes; a new code from the computer unlocks it."],
};

// The phone's screens are 390 by 844, centered in their cell of the grid.
const PHONE = new Set(["phone-pair", "phone-hierarchy", "phone-chat", "phone-waiting", "phone-closed", "phone-pair-error", "phone-locked"]);

const SECTION = {
  1: "Setup and first run", 2: "The Map", 3: "Clusters and agents", 4: "The Overseer", 5: "Chats and messages", 6: "Waiting on you",
  7: "Add to M1ND", 8: "Blueprint", 9: "Void", 10: "Settings", 11: "The service", 12: "The phone",
};

// ---- the tree -------------------------------------------------------------------------------------
//
// One row per screen: its number, its id, the number of the step it leaves from, how it follows that step
// (`main` continues to the right on the same row, `branch` drops below it, `band` opens a part of the app
// from the hub), the label of the link into it and the element of the step it leaves from that starts it.
// Children are listed in the order they are placed; a main step comes before the branches of its parent.

const HUB = "1.8";

const STEPS = [
  // 1 Setup and first run: the trunk, along the top to the hub
  ["1.1", "setup-welcome"],
  ["1.2", "setup-mind", "1.1", "main", "Set up", "continue"],
  ["1.3", "setup-service", "1.2", "main", "Continue", "continue"],
  ["1.4", "setup-done", "1.3", "main", "Ready"],
  ["1.5", "setup-loading", "1.4", "main", "Open HIVEM1ND", "continue"],
  ["1.6", "first-repos-found", "1.5", "main", "Repositories found"],
  ["1.7", "first-overseer", "1.6", "main", "Import", "import"],
  ["1.8", "first-overview", "1.7", "main", "Create", "create-overseer"],
  ["1.7a", "first-overseer-local", "1.7", "branch", "Use a local model", "kind-local-model"],
  ["1.5a", "setup-load-failed", "1.5", "branch", "Not read in 30 s"],
  ["1.5b", "setup-empty", "1.5", "branch", "No repositories found"],
  ["1.3a", "setup-failed", "1.3", "branch", "A step failed"],
  ["1.2a", "setup-join", "1.2", "branch", "A 3.0 M1ND is there"],
  ["1.2b", "setup-close-2x", "1.2", "branch", "Migrate legacy M1ND", "legacy"],

  // 2 The Map
  ["2.1", "first-inside", HUB, "band", "Double click a cluster", "cluster-area-Web"],
  ["2.2", "map-selected", "2.1", "main", "Select an agent"],
  ["2.3", "map-rename", "2.2", "main", "F2"],
  ["2.4", "map-renamed", "2.3", "main", "Save", "rename"],
  ["2.2a", "map-connect", "2.2", "branch", "Drag to another agent", "node-overlord-shop"],
  ["2.2b", "map-connect-saving", "2.2a", "main", "Connect", "connect"],
  ["2.2c", "map-remove-unit", "2.2", "branch", "Remove", "more"],
  ["2.1a", "map-selection", "2.1", "branch", "Drag on empty space"],

  // 3 Clusters and agents
  ["3.1", "clusters-new-cluster", HUB, "band", "New cluster", "new-cluster"],
  ["3.2", "map-group", "3.1", "main", "Create", "create-cluster"],
  ["3.3", "clusters-new-agent", "3.2", "main", "New agent", "new-agent"],
  ["3.4", "clusters-runs-in", "3.3", "main", "Runs in", "field-runs-in"],
  ["3.5", "map-creating", "3.4", "main", "Create", "create-agent"],
  ["3.6", "map-created", "3.5", "main", "Created"],
  ["3.7", "clusters-team", "3.6", "main", "Add an Overlord"],
  ["3.8", "clusters-plan", "3.7", "main", "Ask for a plan"],
  ["3.9", "clusters-running", "3.8", "main", "Run", "run-plan"],
  ["3.9a", "clusters-stuck", "3.9", "branch", "No start in 3 minutes"],
  ["3.6a", "map-start-session", "3.6", "branch", "Start a session", "start-session"],
  ["3.6b", "map-starting", "3.6a", "main", "Start", "start"],
  ["3.6c", "map-stop", "3.6b", "main", "Stop"],
  ["3.6d", "map-start-failed", "3.6b", "branch", "No answer in 30 s"],
  ["3.4a", "clusters-runs-in-lyra", "3.4", "branch", "Lyra", "pick-lyra"],
  ["3.2a", "map-delete-group", "3.2", "branch", "Delete"],
  ["3.1a", "clusters-no-link", "3.1", "branch", "Linked to nothing", "linked-to"],

  // 4 The Overseer
  ["4.1", "overseer-chat", HUB, "band", "The Overseer", "node-overseer"],
  ["4.2", "overseer-full", "4.1", "main", "Context nearly full"],

  // 5 Chats and messages
  ["5.1", "chat-chat", HUB, "band", "Chats", "tab-chats"],
  ["5.2", "chat-sending", "5.1", "main", "Send", "send"],
  ["5.3", "chat-working", "5.2", "main", "Delivered"],
  ["5.4", "chat-reply", "5.3", "main", "Reply"],
  ["5.3a", "messages-work", "5.3", "branch", "Work", "tab-work"],
  ["5.3b", "chat-open-cli", "5.3", "branch", "Asks for a session"],
  ["5.2a", "chat-failed", "5.2", "branch", "No answer in 10 s"],
  ["5.1a", "messages-chat", "5.1", "branch", "Open an agent", "chat-executor-shop"],
  ["5.1b", "chat-mailbox", "5.1", "branch", "An agent with no session"],

  // 6 Waiting on you
  ["6.1", "chat-waiting", HUB, "band", "Waiting"],
  ["6.2", "chat-approval-sent", "6.1", "main", "Approve", "approve"],
  ["6.1a", "chat-accepted", "6.1", "branch", "Accept", "accept"],
  ["6.1b", "chat-send-back", "6.1", "branch", "Send back", "send-back"],

  // 7 Add to M1ND
  ["7.1", "map-add", HUB, "band", "Add", "add"],
  ["7.2", "map-add-check", "7.1", "main", "Read", "add-continue"],
  ["7.3", "map-add-skill", "7.2", "main", "Add", "add-confirm"],
  ["7.2a", "map-add-repo", "7.2", "branch", "A repository"],

  // 8 Blueprint
  ["8.1", "blueprint-board", HUB, "band", "Blueprint", "mode-blueprint"],
  ["8.2", "blueprint-edit", "8.1", "main", "Edit", "tools"],
  ["8.3", "blueprint-sketch", "8.2", "main", "Draw", "tool-draw"],
  ["8.4", "blueprint-attach", "8.3", "main", "Attach agents"],
  ["8.5", "blueprint-comment", "8.4", "main", "Comment", "tool-comment"],
  ["8.6", "blueprint-comment-sent", "8.5", "main", "Send", "comment"],
  ["8.7", "blueprint-watch", "8.6", "main", "Watch", "watch"],
  ["8.7a", "blueprint-conflict", "8.7", "branch", "Changed while editing"],
  ["8.2a", "blueprint-history", "8.2", "branch", "History"],
  ["8.1a", "blueprint-search", "8.1", "branch", "Search", "filter"],
  ["8.1b", "blueprint-new-board", "8.1", "branch", "New board", "new-item"],
  ["8.1c", "blueprint-library", "8.1", "branch", "More", "item-checkout-flow"],
  ["8.1d", "blueprint-move", "8.1c", "main", "Move to folder", "menu-move-to-folder"],
  ["8.1e", "blueprint-delete", "8.1c", "branch", "Delete", "menu-delete"],

  // 9 Void
  ["9.1", "void-document", HUB, "band", "Void", "mode-void"],
  ["9.2", "void-edit", "9.1", "main", "Edit", "document"],
  ["9.3", "void-suggestion", "9.2", "main", "An agent's change"],
  ["9.3a", "void-stale", "9.3", "branch", "Made on older text"],
  ["9.2a", "void-not-saved", "9.2", "branch", "Save failed"],
  ["9.2b", "void-find", "9.2", "branch", "Find", "find"],
  ["9.2c", "void-source", "9.2", "branch", "Source", "source"],
  ["9.1a", "void-library", "9.1", "branch", "Rename"],
  ["9.1b", "void-delete", "9.1a", "main", "Delete"],
  ["9.1c", "void-focus", "9.1", "branch", "Focus", "focus"],
  ["9.1d", "void-focus-tools", "9.1c", "main", "Move the mouse"],

  // 10 Settings
  ["10.1", "settings-settings", HUB, "band", "Settings", "settings"],
  ["10.2", "settings-agents", "10.1", "main", "Agents", "settings-agents"],
  ["10.3", "settings-connect", "10.2", "main", "Connect", "review-cursor"],
  ["10.2a", "settings-machine", "10.2", "branch", "Another machine", "settings-machine"],
  ["10.1a", "settings-permissions", "10.1", "branch", "Permissions", "settings-permissions"],
  ["10.1b", "settings-projects", "10.1", "branch", "Projects", "settings-projects"],
  ["10.1c", "settings-remove-repo", "10.1b", "main", "Remove", "link-shop"],
  ["10.1d", "settings-content", "10.1", "branch", "Content", "settings-content"],

  // 11 The service
  ["11.1", "settings-reconnecting", HUB, "band", "The service stops answering"],
  ["11.2", "settings-service-down", "11.1", "main", "Still no answer"],
  ["11.1a", "settings-slow", "11.1", "branch", "A slow request"],

  // 12 The phone
  ["12.1", "settings-home", HUB, "band", "Open on the phone", "phone"],
  ["12.2", "phone-pair", "12.1", "main", "Scan or type the code", "qr"],
  ["12.3", "phone-hierarchy", "12.2", "main", "Paired"],
  ["12.4", "phone-chat", "12.3", "main", "Open a chat"],
  ["12.5", "phone-waiting", "12.4", "main", "Waiting"],
  ["12.6", "phone-closed", "12.5", "main", "After 12 hours"],
  ["12.2a", "phone-pair-error", "12.2", "branch", "Wrong code"],
  ["12.2b", "phone-locked", "12.2a", "main", "Five wrong codes"],
];

// Links that place nothing: a retry, a rejoin of the trunk, a crossing from one part to another.
const ALSO = [
  ["1.7a", "1.8", "Create", "create-overseer"],
  ["1.5a", "1.5", "Retry", "retry"],
  ["1.5a", "1.2", "Choose another folder", "choose-folder"],
  ["1.5b", "1.7", "Create your Overseer", "create-overseer"],
  ["1.3a", "1.3", "Retry", "continue"],
  ["1.2a", "1.3", "Join", "continue"],
  ["1.2b", "1.3", "Continue", "close-2x"],
  ["2.1a", "3.1", "New cluster", "new-cluster-selection"],
  ["3.6d", "3.6b", "Retry", "retry"],
  ["3.4a", "3.5", "Create", "create-agent"],
  ["3.1a", "3.3", "New agent", "new-agent"],
  ["10.1d", "7.1", "Add", "add-content"],
];

/**
 * Where every step sits on the grid of the board. The trunk starts at column 0, row 0 and runs right to
 * the hub. Every part of the app that opens from the hub is a band: its first screen sits one column right
 * of the hub, the bands stacked from row 0 down, each starting on the first row below the lowest screen of
 * the one before. Inside the trunk and inside a band a branch drops below the step it leaves from, in the
 * same column, on the first row where it and everything that hangs from it fit without touching a screen
 * already placed, and then runs right. Several branches of a step stack in the order they are listed.
 */
function arrange(steps) {
  const step = new Map(steps.map(([num, id, parent, how, label, at]) => [num, { num, id, parent, how, label, at, main: null, branches: [] }]));
  if (step.size !== steps.length) throw new Error("A step number is used twice");
  if (new Set(steps.map(([, id]) => id)).size !== steps.length) throw new Error("A screen id is used twice");
  const bands = [];
  for (const s of step.values()) {
    if (!s.parent) continue;
    const from = step.get(s.parent);
    if (!from) throw new Error(`Step ${s.num} leaves from ${s.parent}, which is not on the board`);
    if (s.how === "band") bands.push(s);
    else if (s.how === "branch") from.branches.push(s);
    else if (s.how === "main") {
      if (from.main) throw new Error(`Step ${s.parent} has two main steps`);
      from.main = s;
    } else throw new Error(`Step ${s.num} does not say how it follows step ${s.parent}`);
  }
  const roots = [...step.values()].filter((s) => !s.parent);
  if (roots.length !== 1) throw new Error("The board needs exactly one first screen");
  if (bands.some((band) => band.parent !== HUB)) throw new Error("Every band opens from the hub");

  // A step and everything that hangs from it, as cells relative to the step.
  const shape = (s) => {
    const cells = [[s, 0, 0]];
    const taken = new Set(["0,0"]);
    const add = (list, dc, dr) =>
      list.forEach(([who, c, r]) => {
        cells.push([who, c + dc, r + dr]);
        taken.add(`${c + dc},${r + dr}`);
      });
    if (s.main) add(shape(s.main), 1, 0);
    for (const b of s.branches) {
      const sub = shape(b);
      let dr = 1;
      while (sub.some(([, c, r]) => taken.has(`${c},${r + dr}`))) dr += 1;
      add(sub, 0, dr);
    }
    return cells;
  };

  const at = new Map();
  const grid = new Set();
  /** Puts a step and what hangs from it on the grid with the step at (c0, r0); returns the lowest row used. */
  const put = (s, c0, r0) => {
    let lowest = r0;
    for (const [who, c, r] of shape(s)) {
      const cell = `${c0 + c},${r0 + r}`;
      if (grid.has(cell)) throw new Error(`Two screens share the cell ${cell}: ${who.num}`);
      grid.add(cell);
      at.set(who.num, { col: c0 + c, row: r0 + r });
      lowest = Math.max(lowest, r0 + r);
    }
    return lowest;
  };

  put(roots[0], 0, 0);
  const hub = at.get(HUB);
  if (!hub || hub.row !== 0) throw new Error("The trunk runs along row 0 to the hub");
  let top = 0;
  for (const band of bands) top = put(band, hub.col + 1, top) + 1;
  return at;
}

const PLACE = arrange(STEPS);
const IDS = new Map(STEPS.map(([num, id]) => [num, id]));
const idOf = (num) => {
  const id = IDS.get(num);
  if (!id) throw new Error(`No screen is numbered ${num}`);
  return id;
};

const screens = STEPS.map(([num, id]) => {
  const entry = SCREEN[id];
  if (!entry) throw new Error(`No picture for ${id}`);
  const [title, root, note] = entry;
  const cell = PLACE.get(num);
  const screen = { id, title: `${num} ${SECTION[Number.parseInt(num, 10)]}: ${title}`, col: cell.col, row: cell.row, root, note };
  if (PHONE.has(id)) {
    screen.w = 390;
    screen.h = 844;
    screen.x = cell.col * (SCREEN_W + GAP_X) + (SCREEN_W - screen.w) / 2;
    screen.y = cell.row * (SCREEN_H + GAP_Y) + (SCREEN_H - screen.h) / 2;
  }
  return screen;
});

const link = (from, to, label, at) => ({ from, to, label, ...(at ? { at } : {}) });

export default board({
  id: "hivem1nd-3-flow",
  title: "HIVEM1ND 3.0",
  note:
    "HIVEM1ND 3.0, the one board of the version, in Modern. Setup and the first run go along the top to the Map; from the Map each part of the app opens on its own row, and each option drops below the step it leaves from. " +
    "Where the owner's start-working sketch and the earlier flow differed, the sketch won: clusters in place of groups, agents created inside clusters, the Overseer first and the plan in the lead's chat. The sample is invented.",
  screens,
  links: [
    ...STEPS.filter(([, , parent]) => parent).map(([, id, parent, , label, at]) => link(idOf(parent), id, label, at)),
    ...ALSO.map(([from, to, label, at]) => link(idOf(from), idOf(to), label, at)),
  ],
});
