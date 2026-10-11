// HIVEM1ND 3.0, every step of the GUI: the screen flow drawn from the approved screens (board hivem1nd-3)
// and the GUI plan (docs/3.0/plan-gui.md), in Modern, the default look. One row per part of the app, read
// left to right: setup, the Map, chats and what waits on the person, Blueprint, Void, settings and the
// service, and the phone. Every press answers at once: a pressed control shows a spinner, a sent line
// appears at once with its state, an agent at work shows that it is working, and every wait ends in a
// clear state with Retry. Where the plan leaves a choice open, the screen's note says what is proposed.
// The sample is invented: its units, machines, tasks, paths and times are examples.

import { board } from "blueprint/board.mjs";
import { box, col, row, stack, vector, space, fill, ELLIPSE } from "blueprint/kit.mjs";
import {
  LOOKS, t, mono, ic, mark, dot, circle, centered, ibtn, avatar, button, bar, statusLine, panel, tabs, search, heading,
  unitRow, chatRow, side, NODES, LINKS, mapField, inspectorHead, facts, message, code, ask, buildAsk, reviewAsk,
  composer, conversation, groupInspector, listSide, editorGround, toolbar, chip, watch, pin, wire, wireLine, artboard,
  comment, commentsPanel, editorBody, blueprintCanvas, voidCanvas, DOC, phoneTop, phoneNav, phone, phoneHierarchy,
  phoneChat, focus,
} from "../kit/h3.mjs";

const L = LOOKS[0];
const ERR = "#e58e7c";
const ERR_SOFT = "rgba(229,142,124,0.12)";
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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
const working = (who, detail = null) =>
  row(
    { name: "agent-working", label: "Agent working", gap: 10, pad: [10, 14], radius: 18, fill: "card", self: "start" },
    row({ gap: 4 }, ...[1, 0.6, 0.3].map((o) => box({ w: 7, h: 7, radius: "pill", fill: "acc", opacity: o }))),
    t(`${who} is working on it`, 13.5, { color: "body" }),
    detail ? t(detail, 12, { color: "mute" }) : null,
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

function option(title, desc, { sel = false, glyph = null, badge = null, disabled = false } = {}) {
  return row(
    { name: `option-${slug(title)}`, label: title, gap: 14, pad: [14, 16], radius: 16, fill: sel ? "card2" : "card", stroke: sel ? "acc" : "line", opacity: disabled ? 0.55 : undefined },
    stack({ w: 18, h: 18 }, circle(18, { stroke: sel ? "acc" : "line2", strokeWidth: 2 }), sel ? circle(8, { fill: "acc" }) : null),
    glyph ? ic(glyph, 18, sel ? "acc" : "body") : null,
    col({ grow: 1, gap: 2 }, t(title, 14.5, { weight: 700 }), t(desc, 12.5, { color: "mute" })),
    badge ? row({ pad: [2, 8], radius: "pill", fill: "card2" }, t(badge, 11, { weight: 700, color: "mute" })) : null,
  );
}

const check = (on) =>
  stack({ w: 18, h: 18 }, box({ w: 18, h: 18, radius: 5, fill: on ? "acc" : undefined, stroke: on ? undefined : "line2", strokeWidth: 2, place: "center" }), on ? centered(ic("check", 13, "accInk")) : null);

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
  ["Client", t("Claude Code", 13, { color: "text" })],
  ["Model", t("Sonnet 5.5, high", 13, { color: "text" })],
  ["Reports to", t("overlord-web", 13, { color: "text" })],
];

const HISTORY = [
  message(L, { who: "You", when: "21:05", body: "Add the empty state to the cart page, as drawn on the Cart board.", me: true }),
  message(L, { who: "executor-shop", when: "23:31", body: "Done on feat/cart-empty. The page and its test pass; the board has my notes." }),
];

function unitPanel({ glyph = "term", title = "executor-shop", status = "work", statusText = "Working on task 029", factsList = FACTS, convo = HISTORY, place = ["Message executor-shop", "The session is notified at once", "bell"], composerNode = null, right = null }) {
  return panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, {
      glyph, title,
      sub: row({ gap: 6 }, status === "busy" ? spinner(10) : dot(status), t(statusText, 12.5, { color: "mute" })),
      right: right ?? [row({ gap: 6 }, ibtn(L, "pin", "pin", "Pin"), ibtn(L, "dots", "more", "More"))],
    }),
    factsList ? facts(L, factsList) : null,
    conversation(L, ...convo),
    composerNode ?? composer(L, ...place),
  );
}

function emptyInspector({ title = "Nothing selected", body = "Select a unit on the Map or in Hierarchy to see its chat, its work and what it asks of you.", summary = true, action = button(L, "New unit", "pri", "plus", "new-unit") } = {}) {
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
            row({ gap: 8 }, dot("idle"), t("3 unread chats", 13, { color: "body" })),
          )
        : null,
      action,
    ),
  );
}

const mapScreen = ({ tab = "h", sel = null, field: options = {}, inspector, sideNode = null, ...rest }) =>
  shell("Map", body3(sideNode ?? side(L, tab, sel), mapField(L, { mode: "none", ...options }), inspector), rest);

// A unit created in the flow, placed where the Map has room.
const MOBILE = { id: "executor-mobile", glyph: "term", x: 612, y: 566, sz: 46, status: "idle" };
const NODES_PLUS = [...NODES, MOBILE];

const pill = (kids, at) => row({ gap: 7, pad: [6, 10], radius: "pill", fill: "panel", stroke: "line2", place: at }, ...kids);

// ---- setup ------------------------------------------------------------------------------------------

function setup(step, title, sub, kids, { back = true, next = "Continue", nextBusy = false } = {}) {
  return () =>
    stack(
      { w: 1440, h: 900, fill: "bg", theme: L.theme },
      row({ gap: 10, place: { x: 32, y: 26 } }, mark(28), t("HIVEM1ND", 16, { weight: 700, track: 0.06 })),
      col(
        { name: "setup", label: title, w: 640, pad: 32, gap: 22, radius: 24, fill: "panel", stroke: "line", place: "center" },
        row(
          { gap: 6 },
          ...[1, 2, 3, 4, 5].map((i) => box({ w: i === step ? 28 : 8, h: 8, radius: "pill", fill: i <= step ? "acc" : "card2" })),
          space(10),
          t(`Step ${step} of 5`, 12.5, { color: "mute" }),
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

const setupWelcome = setup(1, "Install HIVEM1ND", "HIVEM1ND runs your agents from one Map. Setup takes about a minute and changes nothing outside the folders it names.", [
  col({ gap: 12 }, bullet("folder", "Creates your mind in the Cosmic folder"), bullet("power", "Starts one Relay service that runs when you sign in"), bullet("map", "Opens the Map in your browser")),
], { back: false, next: "Start setup" });

const setupMind = setup(2, "Where your mind lives", "The mind holds your units, chats, boards and texts. Keep the suggested folder unless you have a reason to move it.", [
  pathRow("C:\\Users\\you\\Cosmic\\HIVEM1ND"),
  col({ gap: 10 }, option("New mind", "Start with you and the Overseer.", { sel: true, glyph: "plus" }), option("Existing mind", "Bring a mind from HIVEM1ND 2.x: it is copied and upgraded, and the original stays untouched.", { glyph: "folder" })),
]);

const setupSync = setup(3, "Sync between your machines", "Changes are kept on this machine first, then sent to the place you choose. Your other machines read from the same place.", [
  col(
    { gap: 10 },
    option("Only this machine", "Nothing leaves this computer.", { glyph: "desk" }),
    option("OneDrive folder", "Found: OneDrive Personal. Your other machines choose the same folder.", { sel: true, glyph: "cloud" }),
    option("Local or network folder", "A shared drive, or any folder you sync yourself.", { glyph: "folder" }),
    option("Cosmic account", "Encrypted sync through Quantum, with Relay+. Arrives with the Cosmic account.", { glyph: "link", badge: "Later", disabled: true }),
  ),
]);

const setupService = setup(4, "Starting the Relay service", "One service per machine wakes your sessions and carries messages. It starts when you sign in to Windows and uses nothing while idle.", [
  steps([["Mind folder created and protected", "done", "2 s"], ["Service registered for this Windows user", "done", "1 s"], ["Starting the service", "busy", "3 s"], ["Opening the Map", "todo"]]),
], { next: "Installing", nextBusy: true });

const setupDone = setup(5, "HIVEM1ND is running", "The service is running on DESKTOP. To add another machine, install HIVEM1ND there and choose the same OneDrive folder.", [
  col(
    { gap: 8, pad: 14, radius: 14, fill: "card" },
    row({ gap: 10 }, ic("folder", 15, "mute"), t("Mind", 13, { color: "mute" }), fill(), mono("C:\\Users\\you\\Cosmic\\HIVEM1ND", 12.5, { color: "text" })),
    row({ gap: 10 }, ic("cloud", 15, "mute"), t("Sync", 13, { color: "mute" }), fill(), t("OneDrive folder", 13, { color: "text" })),
    row({ gap: 10 }, ic("power", 15, "mute"), t("Service", 13, { color: "mute" }), fill(), row({ gap: 6 }, dot("work"), t("Running", 13, { color: "text" }))),
  ),
], { back: false, next: "Open the Map" });

const loading = () =>
  shell(
    "Map",
    body3(
      panel(L, "right", { name: "side", label: "Side panel", w: 266 }, col({ gap: 14, pad: 18 }, skeleton(200, 30), skeleton(230, 34), ...[150, 190, 120, 170, 140, 180, 110].map((w) => skeleton(w)))),
      stack(
        { name: "map", label: "Map", w: 760, fill: "ground", radius: 20, stroke: "line" },
        col({ gap: 12, align: "center", place: "center" }, spinner(28), t("Reading the mind", 14, { weight: 600 }), t("11 units, 6 chats, 4 boards", 12.5, { color: "mute" })),
      ),
      panel(L, "left", { name: "inspector", label: "Inspector", w: 366 }, col({ gap: 14, pad: 18 }, skeleton(220, 38), skeleton(300, 70), ...[260, 200, 240].map((w) => skeleton(w, 44)))),
    ),
    { footer: { service: "wait", serviceText: "Connecting to the service", read: "Reading" } },
  );

const emptyMind = () =>
  mapScreen({
    sideNode: panel(
      L, "right", { name: "side", label: "Side panel", w: 266 },
      tabs(L, [["Hierarchy", "net", true, "tab-hierarchy"], ["Chats", "users", false, "tab-chats"]]),
      search(L),
      col({ pad: [24, 20], gap: 8 }, t("No units yet", 14, { weight: 700 }), t("Every mind starts with you and the Overseer.", 13, { color: "mute" })),
    ),
    field: {
      nodes: [{ ...NODES[0] }],
      links: [],
      zones: false,
      extra: [
        circle(64, { stroke: "acc", strokeWidth: 2, dash: "6 5", place: { x: 340, y: 146 } }),
        col({ w: 200, align: "center", place: { x: 272, y: 220 } }, t("The Overseer goes here", 12.5, { color: "mute" })),
      ],
    },
    inspector: emptyInspector({
      title: "Your mind is empty",
      body: "The Overseer coordinates every other unit. Create it first; then add Overlords and Executors from the Map.",
      summary: false,
      action: button(L, "Create the Overseer", "pri", "plus", "create-overseer"),
    }),
    waiting: 0,
  });

// ---- the Map ------------------------------------------------------------------------------------------

const mapIdle = () => mapScreen({ inspector: emptyInspector() });

const mapSelected = () => mapScreen({ sel: "executor-shop", field: { sel: "executor-shop" }, inspector: unitPanel({ convo: [...HISTORY, buildAsk(L), reviewAsk(L)] }) });

const connectRow = (from, to) =>
  row({ gap: 12, pad: 14, radius: 14, fill: "card", justify: "center" }, avatar(L, "term", 34, 16), mono(from, 13, { weight: 700 }), t("reports to", 13, { color: "mute" }), avatar(L, "net", 34, 16), mono(to, 13, { weight: 700 }));

const mapConnect = () =>
  mapScreen({
    field: { mode: "connect" },
    inspector: emptyInspector(),
    over: [
      scrim(),
      dialog({
        title: "Connect executor-site",
        sub: "executor-site will report to overlord-web. Chats and group chats do not change.",
        kids: [connectRow("executor-site", "overlord-web")],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Connect", "pri", null, "connect")],
      }),
    ],
  });

const SITE = NODES.find((n) => n.id === "executor-site");
const mapConnectSaving = () =>
  mapScreen({
    sel: "executor-site",
    field: {
      sel: "executor-site",
      links: [...LINKS, ["overlord-web", "executor-site"]],
      extra: [pill([spinner(12), t("Saving", 12, { color: "body" })], { x: SITE.x + 34, y: SITE.y - 14 })],
    },
    inspector: unitPanel({
      title: "executor-site", status: "idle", statusText: "No session",
      factsList: [["Machine", t("LAPTOP", 13, { color: "text" })], ["Client", t("Codex", 13, { color: "text" })], ["Model", t("GPT 6.1 Sol, high", 13, { color: "text" })], ["Reports to", row({ gap: 6 }, spinner(11), t("overlord-web", 13, { color: "text" }))]],
      convo: [message(L, { who: "executor-site", when: "Yesterday", body: "The landing hero is live on staging." })],
      place: ["Message executor-site", "No session: the message waits in its mailbox", "mail"],
    }),
    over: [toast("executor-site now reports to overlord-web", "Undo")],
  });

const selectionPanel = () =>
  panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, { glyph: "users", title: "3 selected", monoTitle: false, sub: t("A drag on empty space selects; Shift adds", 12.5, { color: "mute" }) }),
    col(
      { gap: 2, pad: [8, 12] },
      ...[["executor-shop", "term", "work"], ["overlord-web", "net", "wait"], ["executor-blog", "term", "idle"]].map(([id, glyph, status]) => unitRow(L, { id, glyph, status })),
    ),
    col(
      { gap: 10, pad: [8, 18] },
      button(L, "Message as group", "pri", "users", "message-group"),
      button(L, "Connect to a lead", "plain", "net", "connect-lead"),
      button(L, "Clear selection", "ghost", null, "clear"),
    ),
  );

const mapGroup = () => mapScreen({ field: { mode: "select", group: ["executor-shop", "executor-blog", "overlord-web"] }, inspector: selectionPanel() });

function newUnitDialog({ creating = false, menu = false } = {}) {
  const kids = [
    pairOf(field("Name", "executor-mobile", { disabled: creating }), field("Role", "Executor", { select: true, disabled: creating })),
    pairOf(field("Project", "mobile", { select: true, disabled: creating }), field("Machine", "DESKTOP, this machine", { select: true, glyph: "desk", disabled: creating })),
    pairOf(field("Reports to", "No Overlord", { select: true, disabled: creating }), field("Model", "The client's default", { select: true, disabled: creating })),
  ];
  const actions = creating ? [button(L, "Cancel", "ghost", null, "cancel"), busy("Creating")] : [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Create unit", "pri", null, "create-unit")];
  const over = [scrim(), dialog({ title: "New unit", sub: "It appears on the Map at once; start its session when you need it.", kids, actions, w: 560 })];
  if (menu) {
    over.push(
      col(
        { name: "machine-menu", label: "Machines", w: 262, pad: 6, gap: 2, radius: 14, fill: "card2", stroke: "line2", place: { x: 727, y: 500 } },
        row({ gap: 10, pad: [9, 10], radius: 10, fill: "card" }, ic("desk", 15), t("DESKTOP, this machine", 13.5), fill(), ic("check", 14, "acc")),
        row({ gap: 10, pad: [9, 10], opacity: 0.55 }, ic("lap", 15), col({ gap: 1 }, t("LAPTOP", 13.5), t("Offline since 21:40", 11.5, { color: "mute" }))),
      ),
    );
  }
  return mapScreen({ inspector: emptyInspector(), over });
}

const mapNewUnit = () => newUnitDialog({ menu: true });
const mapCreating = () => newUnitDialog({ creating: true });

const mobilePanel = (extra = {}) =>
  unitPanel({
    title: "executor-mobile", status: "idle", statusText: "No session",
    factsList: [["Machine", row({ gap: 6 }, ic("desk", 14, "text"), t("DESKTOP", 13, { color: "text" }))], ["Client", t("Not started", 13, { color: "mute" })], ["Model", t("The client's default", 13, { color: "text" })], ["Reports to", t("No Overlord", 13, { color: "text" })]],
    convo: [col({ gap: 12, pad: [24, 8], align: "center" }, t("No messages yet", 14, { weight: 700 }), t("Messages wait in its mailbox until a session starts.", 13, { color: "mute", align: "center" }), button(L, "Start session", "pri", "play", "start-session"))],
    place: ["Message executor-mobile", "No session: the message waits in its mailbox", "mail"],
    ...extra,
  });

const mapCreated = () =>
  mapScreen({ sel: "executor-mobile", field: { nodes: NODES_PLUS, sel: "executor-mobile" }, inspector: mobilePanel(), over: [toast("executor-mobile created", "Start a session")] });

const mapStartSession = () =>
  mapScreen({
    field: { nodes: NODES_PLUS, sel: "executor-mobile" },
    inspector: mobilePanel(),
    over: [
      scrim(),
      dialog({
        title: "Start a session",
        sub: "executor-mobile on DESKTOP. Only clients installed on that machine are offered.",
        kids: [
          col(
            { gap: 10 },
            option("Claude Code", "Installed and signed in.", { sel: true, glyph: "term" }),
            option("Codex", "Installed. Sign in once in a terminal with codex login.", { glyph: "term", badge: "Sign-in needed" }),
            option("Cursor", "Not installed on DESKTOP.", { glyph: "term", disabled: true }),
          ),
          field("First message (optional)", "What the session reads first", { placeholder: true }),
        ],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Start session", "pri", "play", "start")],
        w: 520,
      }),
    ],
  });

const startingNode = { x: MOBILE.x - 30, y: MOBILE.y - 30 };
const mapStarting = () =>
  mapScreen({
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
        sub: "Its work in progress stops. The unit keeps its chat, mailbox and tasks, and a new session can start later.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), danger("Stop session", "stop")],
      }),
    ],
  });

// ---- chats and what waits on the person ------------------------------------------------------------

const chatScreen = (convo, rest = {}) =>
  mapScreen({ tab: "c", sel: "shop", field: { sel: "executor-shop" }, inspector: unitPanel({ convo, ...rest }) });

const chatList = () => chatScreen([...HISTORY, buildAsk(L), reviewAsk(L)]);
const chatSending = () => chatScreen([...HISTORY, mine("Add a Continue shopping button to the empty state too.", "Sending", { sending: true })]);
const chatWorking = () => chatScreen([...HISTORY, mine("Add a Continue shopping button to the empty state too.", "Delivered 23:45"), working("executor-shop", "38 s")]);
const chatReply = () =>
  chatScreen([
    HISTORY[1],
    mine("Add a Continue shopping button to the empty state too.", "Read 23:45"),
    message(L, { who: "executor-shop", when: "23:47", body: "Added. The button goes back to the catalog; the board shows it on the empty cart." }),
  ]);
const chatFailed = () =>
  chatScreen([...HISTORY, mine("Add a Continue shopping button to the empty state too.", "Not sent: the service did not answer in 10 s.", { failed: true })], {
    composerNode: composer(L, "Message executor-shop", "Your text is kept; Retry sends it again", "retry"),
  });

const groupChat = () => mapScreen({ tab: "c", sel: "cart", field: { mode: "select", group: ["executor-shop", "executor-blog", "overlord-web"] }, inspector: groupInspector(L) });

const mailbox = () =>
  mapScreen({
    sel: "executor-blog",
    field: { sel: "executor-blog" },
    inspector: unitPanel({
      title: "executor-blog", status: "idle", statusText: "No session",
      factsList: [["Machine", row({ gap: 6 }, ic("lap", 14, "text"), t("LAPTOP", 13, { color: "text" }))], ["Client", t("Codex", 13, { color: "text" })], ["Mailbox", t("2 unread", 13, { color: "text" })], ["Reports to", t("overlord-web", 13, { color: "text" })]],
      convo: [
        col(
          { gap: 8, pad: [12, 14], radius: 14, fill: "waitSoft" },
          row({ gap: 8 }, ic("mail", 15, "wait"), t("executor-blog is not running", 13.5, { weight: 700 })),
          t("Messages wait in its mailbox and are delivered when a session starts.", 13, { color: "body" }),
          row({ gap: 8 }, button(L, "Start session", "pri", "play", "start-session"), button(L, "Mark mailbox read", "ghost", null, "mark-read")),
        ),
        message(L, { who: "overlord-web", when: "22:44", body: "When you start, announce the empty cart on the blog." }),
        message(L, { who: "You", when: "23:12", body: "Draft the post tonight; publish after the merge.", me: true }),
      ],
      place: ["Message executor-blog", "It waits in the mailbox until a session starts", "mail"],
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
      item("hand", "Push to the remote", "builder-codex", "Yesterday", "expired"),
    ),
  );
}

const waiting = () =>
  mapScreen({ sel: "executor-shop", sideNode: waitingSide(), field: { sel: "executor-shop" }, inspector: unitPanel({ convo: [HISTORY[1], buildAsk(L), reviewAsk(L)] }) });

const answered = (label) =>
  row({ gap: 8, pad: [10, 12], radius: 14, fill: "card" }, stack({ w: 18, h: 18 }, circle(18, { fill: "acc" }), centered(ic("check", 12, "accInk"))), t(label, 13, { color: "body" }));

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

const BOARDS = [["Cart page", "shop", true], ["Checkout flow", "shop"], ["API console", "api"], ["Landing hero", "site"]];

function bpCanvas(toolbarKids, extra = []) {
  return editorGround(
    L, "board-canvas", "Board",
    toolbar(L, ...toolbarKids),
    ...artboard(L, 70, "Cart, empty", "art-empty", [wireLine(20, 22, 120), wire(20, 56, 260, 150), wireLine(60, 236, 180), wireLine(80, 256, 140), wire(70, 300, 160, 40, true)]),
    ...artboard(L, 420, "Cart, with items", "art-items", [wireLine(20, 22, 120), wire(20, 56, 260, 64), wire(20, 130, 260, 64)]),
    ...extra,
  );
}

const noComments = (L2 = L) =>
  panel(
    L2, "left", { name: "comments", label: "Comments", w: 368 },
    inspectorHead(L2, { glyph: "grid", title: "Comments", monoTitle: false, sub: t("Cart page", 12.5, { color: "mute" }) }),
    col({ grow: 1, gap: 8, pad: 32, align: "center", justify: "center" }, t("No comments yet", 14, { weight: 700 }), t("Select an element on the board and press C to comment on it.", 13, { color: "mute", align: "center" })),
    composer(L2, "Comment on the board", "Attached agents are notified", "bell"),
  );

const attachButton = (label = "Attach agents") => button(L, label, "plain", "plus", "attach");
const bpScreen = (canvas, comments, rest = {}) => shell("Blueprint", editorBody(L, listSide(L, "Boards", "grid", BOARDS), canvas, comments), { waiting: 1, ...rest });

const bpBoard = () => bpScreen(bpCanvas([t("No agents attached", 13, { color: "mute" }), attachButton()]), noComments());

const bpAttach = () =>
  bpScreen(
    bpCanvas(
      [t("No agents attached", 13, { color: "mute" }), attachButton()],
      [
        col(
          { name: "attach-picker", label: "Attach agents", w: 300, pad: 12, gap: 8, radius: 16, fill: "panel", stroke: "line2", place: "top-center", dy: 64 },
          row({ gap: 8, pad: [8, 10], radius: 10, fill: "card" }, ic("search", 14, "mute"), t("Search units", 13, { color: "mute" })),
          ...[["executor-shop", "term", true], ["overlord-web", "net", true], ["executor-blog", "term", false], ["adjutant", "adj", false]].map(([id, glyph, on]) =>
            row({ gap: 10, pad: [7, 8] }, check(on), ic(glyph, 15), mono(id, 12.5, { color: "text" })),
          ),
          row({ gap: 8, justify: "end" }, button(L, "Cancel", "ghost", null, "cancel"), button(L, "Attach 2", "pri", null, "attach-save")),
        ),
      ],
    ),
    noComments(),
  );

const attachedBar = (watching = false) => [t("Attached", 13, { color: "body" }), chip(L, "term", "executor-shop"), chip(L, "net", "overlord-web"), watch(L, watching ? "Watching executor-shop" : "Watch", watching, "eye", "watch")];

const bpComment = () =>
  bpScreen(
    bpCanvas(attachedBar(), [
      box({ w: 160, h: 40, radius: 7, stroke: "acc", strokeWidth: 2, place: { x: 140, y: 420 } }),
      { ...pin(26, "1"), place: { x: 300, y: 404 } },
      col(
        { name: "comment-composer", label: "New comment", w: 320, pad: 14, gap: 10, radius: 16, fill: "panel", stroke: "line2", place: { x: 332, y: 400 } },
        row({ gap: 8 }, ic("grid", 14, "mute"), t("Cart, empty / Continue button", 12, { color: "mute" })),
        row({ pad: [10, 12], radius: 12, fill: "card", stroke: "line2" }, t("Add a button back to the shop under the message.", 13.5, { color: "text" })),
        row({ gap: 8 }, check(true), t("Notify executor-shop and overlord-web", 12.5, { color: "body" })),
        row({ gap: 8, justify: "end" }, button(L, "Cancel", "ghost", null, "cancel"), button(L, "Comment", "pri", null, "comment")),
      ),
    ]),
    noComments(),
  );

const bpCommentSent = () =>
  bpScreen(
    bpCanvas(attachedBar(), [{ ...pin(26, "1"), place: { x: 300, y: 404 } }]),
    commentsPanel(L, {
      glyph: "grid",
      sub: "Cart page, 1 open thread",
      thread: [
        comment(L, { who: "You", when: "23:12", pinLabel: "1", body: "Add a button back to the shop under the message." }),
        row({ gap: 6, pad: [0, 0, 0, 4] }, ic("check", 12, "mute"), t("Notified executor-shop and overlord-web", 12, { color: "mute" })),
        working("executor-shop", "reading the board"),
      ],
      reply: "Reply on the board",
      note: "Turn on Watch to see the agent draw",
      noteGlyph: "eye",
    }),
  );

const bpWatch = () => shell("Blueprint", editorBody(L, listSide(L, "Boards", "grid", BOARDS), blueprintCanvas(L), commentsPanel(L, {
  glyph: "grid",
  sub: "Cart page, 1 open thread",
  thread: [
    comment(L, { who: "You", when: "23:12", pinLabel: "1", body: "Add a button back to the shop under the message." }),
    comment(L, { who: "executor-shop", when: "23:13", reply: true, live: true, body: "Adding a button to Continue shopping, and drawing the row with an item now." }),
  ],
  reply: "Reply on the board",
  note: "Attached agents answer at once",
  noteGlyph: "bell",
})), { waiting: 1 });

const bpConflict = () =>
  bpScreen(
    bpCanvas(attachedBar(), [banner("wait", "executor-shop changed this board while you were editing.", [button(L, "Show changes", "plain", null, "show-changes"), button(L, "Keep mine", "ghost", null, "keep-mine"), button(L, "Reload", "pri", "retry", "reload")])]),
    noComments(),
  );

const bpRegister = () =>
  bpScreen(bpCanvas([t("No agents attached", 13, { color: "mute" }), attachButton()]), noComments(), {
    over: [
      scrim(),
      dialog({
        title: "Add a board",
        sub: "Boards live in a project's repository. Add one that exists, or start a new one.",
        kids: [
          pairOf(field("Project", "shop", { select: true }), field("Board", "docs/flows/boards/cart.mjs", { glyph: "grid" })),
          col(
            { gap: 6, pad: [12, 14], radius: 14, fill: "waitSoft" },
            t("This board is a Blueprint Lite 2.x module.", 13.5, { weight: 700 }),
            t("A JSON copy is made next to it and opened here; the module stays untouched.", 13, { color: "body" }),
          ),
        ],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Make a copy and open", "pri", null, "add-board")],
        w: 560,
      }),
    ],
  });

// ---- Void ---------------------------------------------------------------------------------------------

const TEXTS = [["Release notes 3.0", null, true], ["Relay manual"], ["Install guide"], ["Squad rules"]];

function docCard(kids) {
  return col(
    { name: "document", label: "Document", w: 640, h: 760, pad: [44, 56], radius: 20, fill: "panel", clip: true, place: "top-center", dy: 70 },
    t("HIVEM1ND 3.0", 26, { weight: 700, color: "text" }),
    space(6),
    t("Release notes, draft by adjutant", 13, { color: "mute" }),
    space(20),
    ...kids,
  );
}
const para = (value) => col({ pad: [0, 0, 12] }, t(value, 15.5, { color: "body", lh: 1.65 }));
const h3 = (value) => col({ pad: [10, 0, 6] }, t(value, 16, { weight: 700, color: "text" }));

const voidTool = (watching = false) => [t("Attached", 13, { color: "body" }), chip(L, "adj", "adjutant"), watch(L, watching ? "Watching adjutant" : "Watch", watching, "eye", "watch"), watch(L, "Focus", true, null, "focus")];
const voidScreen = (canvasKids, comments) => shell("Void", editorBody(L, listSide(L, "Texts", "pen", TEXTS), editorGround(L, "text-canvas", "Text", ...canvasKids), comments), { waiting: 1 });
const textComments = (thread, note = "Watch is off: the agent works off screen") =>
  commentsPanel(L, { glyph: "pen", sub: "Release notes 3.0", thread, reply: "Reply on the text", note, noteGlyph: "eye" });

const voidDoc = () =>
  voidScreen(
    [toolbar(L, ...voidTool()), docCard([para(DOC.intro), h3("One service per machine"), para(DOC.service), h3("Chats and mailboxes"), para(DOC.mail), h3("Live editors"), para(DOC.live)])],
    textComments([col({ gap: 8, pad: [24, 8], align: "center" }, t("No comments yet", 14, { weight: 700 }), t("Select a passage to comment on it or to ask the agent for a change.", 13, { color: "mute", align: "center" }))]),
  );

const voidEdit = () =>
  voidScreen(
    [
      toolbar(L, ...voidTool()),
      docCard([
        para(DOC.intro),
        h3("One service per machine"),
        col(
          { name: "editing", label: "Editing a passage", gap: 10, pad: 12, radius: 12, fill: "card", stroke: "acc" },
          t(`${DOC.service} An idle machine makes no requests and sends nothing.`, 15.5, { color: "text", lh: 1.65 }),
          row({ gap: 8, justify: "end" }, t("Ctrl Enter saves, Esc cancels", 12, { color: "mute" }), fill(), button(L, "Cancel", "ghost", null, "cancel"), busy("Saving")),
        ),
        h3("Chats and mailboxes"),
        para(DOC.mail),
      ]),
    ],
    textComments([]),
  );

const voidSuggestion = () => shell("Void", editorBody(L, listSide(L, "Texts", "pen", TEXTS), voidCanvas(L), textComments([
  comment(L, { who: "You", when: "23:20", body: "Say what an idle machine costs: no requests, not only no traffic." }),
  comment(L, { who: "adjutant", when: "23:21", reply: true, body: "Changed to: an idle machine makes no requests and sends nothing.", buttons: [button(L, "Accept change", "pri", null, "accept-change"), button(L, "Discard", "ghost", null, "discard")] }),
])), { waiting: 1 });

const voidStale = () =>
  voidScreen(
    [toolbar(L, ...voidTool()), docCard([para(DOC.intro), h3("One service per machine"), para(`${DOC.service} Idle machines stay quiet.`), h3("Chats and mailboxes"), para(DOC.mail)])],
    textComments([
      comment(L, { who: "You", when: "23:20", body: "Say what an idle machine costs: no requests, not only no traffic." }),
      col(
        { pad: [0, 0, 0, 18] },
        col(
          { gap: 8, pad: [11, 12], radius: 16, fill: "waitSoft" },
          row({ gap: 8 }, ic("alert", 14, "wait"), t("The text changed after this suggestion", 13, { weight: 700 })),
          t("It was not applied. Ask adjutant again on the current text, or discard it.", 13, { color: "body" }),
          row({ gap: 8 }, button(L, "Ask again", "pri", "retry", "ask-again"), button(L, "Discard", "ghost", null, "discard")),
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

function settingsBody() {
  const section = (title, kids) => col({ gap: 12, pad: 20, radius: 18, fill: "panel", stroke: "line" }, t(title, 15, { weight: 700 }), ...kids);
  const kv = (k, v) => row({ gap: 10 }, t(k, 13, { color: "mute" }), fill(), v);
  const segment = (items) =>
    row({ gap: 4, pad: 4, radius: 12, fill: "card" }, ...items.map(([label, on]) => row({ grow: 1, justify: "center", pad: [8, 12], radius: 9, fill: on ? "card2" : undefined }, t(label, 13.5, { weight: 600, color: on ? "text" : "mute" }))));
  return col(
    { h: 818, gap: 16, pad: [8, 120] },
    t("Settings", 22, { weight: 700 }),
    row(
    { gap: 16, align: "start" },
    col(
      { grow: 1, gap: 16 },
      section("Look", [segment([["Modern", true], ["High contrast", false]]), t("High contrast uses black surfaces, strong lines and a gold accent.", 12.5, { color: "mute" })]),
      section("Language", [segment([["English", true], ["Español", false]])]),
      section("Phone on the home network", [t("See, chat and approve from your phone while it is on the same network. Access closes after 12 hours.", 13, { color: "body" }), row({}, button(L, "Open on the phone", "pri", "qr", "open-phone"))]),
    ),
    col(
      { grow: 1, gap: 16 },
      section("Relay service", [kv("State", row({ gap: 6 }, dot("work"), t("Running on DESKTOP", 13))), kv("Version", t("3.0.0", 13)), kv("Started", t("Today 08:12", 13)), row({ gap: 8 }, button(L, "Restart service", "plain", "retry", "restart"))]),
      section("Sync", [kv("Origin", t("OneDrive folder", 13)), kv("Last sent", t("23:41", 13)), kv("Last received", t("23:40 from LAPTOP", 13)), kv("State", row({ gap: 6 }, dot("work"), t("Up to date", 13))), row({ gap: 8 }, button(L, "Change origin", "plain", null, "change-origin"))]),
      section("Locations", [kv("Mind", mono("C:\\Users\\you\\Cosmic\\HIVEM1ND", 12.5)), kv("Staging", mono("C:\\Users\\you\\AppData\\Local\\HIVEM1ND", 12.5))]),
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
    inspector: emptyInspector(),
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
      t("Open your mind", 22, { weight: 700 }),
      t("Type the code shown on your computer, in Settings, Open on the phone.", 14, { color: "body", align: "center" }),
      codeBoxes(error ? "K7P4QZ" : "K7P4Q ", error),
      error
        ? col({ gap: 6, align: "center" }, row({ gap: 6 }, ic("alert", 14, ERR), t("That code does not match.", 13.5, { color: ERR })), t("Check it on the computer and try again; 4 tries left.", 12.5, { color: "mute" }))
        : t("Or scan the QR code with the camera.", 12.5, { color: "mute" }),
      space(8),
      error ? button(L, "Try again", "pri", "retry", "retry") : busy("Opening"),
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
        col({ gap: 4 }, row({ gap: 8 }, mono("executor-shop", 12, { weight: 700 }), t("23:32", 12, { color: "mute" })), buildAsk(L, "Always")),
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
    ["welcome", "Install", setupWelcome, "The installer opens setup in the browser. It names every folder it will touch before it touches any."],
    ["mind", "Where the mind lives", setupMind, "The Cosmic folder by default. A 2.x mind is copied and upgraded; the original is never changed."],
    ["sync", "Sync", setupSync, "The origin the machines share. Proposed: the Cosmic account (Quantum, Relay+) shows as Later until that backend exists."],
    ["service", "Relay service", setupService, "Each step shows its own state while it runs, so the setup never looks frozen."],
    ["done", "Ready", setupDone, "What was set up, and how to add another machine."],
    ["loading", "Opening", loading, "The window shows at once with its frame; the panels fill as the mind is read, with a loader in the middle."],
    ["empty", "An empty mind", emptyMind, "The first run: only you. The Overseer is created first."],
  ],
  map: [
    ["idle", "Map", mapIdle, "Nothing selected: the inspector sums up the mind and offers New unit."],
    ["selected", "A unit selected", mapSelected, "A click selects a unit: its facts, its chat and what it asks of you. A double click in Hierarchy centers it on the Map."],
    ["connect", "Connect", mapConnect, "A drag from overlord-web to executor-site asks first, in words, who will report to whom."],
    ["connect-saving", "Connected", mapConnectSaving, "The line is drawn at once and saved in the background; the notice confirms it and offers Undo."],
    ["group", "A group selected", mapGroup, "A drag on empty space selects; the inspector offers Message as group and Connect."],
    ["new-unit", "New unit", mapNewUnit, "Machines that cannot take the unit stay in the list, disabled, with the reason."],
    ["creating", "Creating", mapCreating, "The form stays open while the unit is created; if it fails, the form keeps what was typed and says why."],
    ["created", "Created", mapCreated, "The unit appears selected, without a session. Messages wait in its mailbox."],
    ["start-session", "Start a session", mapStartSession, "Only clients installed on that machine are offered, each with its state."],
    ["starting", "Starting", mapStarting, "Each step shows its state; a message sent now is delivered once the session connects."],
    ["start-failed", "It did not start", mapStartFailed, "Every wait has a limit: after 30 s it says what happened and offers Retry."],
    ["stop", "Stop a session", mapStop, "Stopping asks first and says what stops and what stays."],
  ],
  chat: [
    ["chat", "A chat", chatList, "Chats lists pinned and recent conversations; the chat opens in the inspector."],
    ["sending", "Sending", chatSending, "The line appears at once, marked Sending, and the box is free for the next one."],
    ["working", "The agent is working", chatWorking, "Delivered, then the agent's work shows with how long it has been at it."],
    ["reply", "The reply", chatReply, "The reply arrives in place; a Read mark replaces Delivered."],
    ["failed", "Not sent", chatFailed, "After 10 s without an answer the line says so; the text is kept and Retry sends it again."],
    ["group", "Group chat", groupChat, "Writing to several selected units opens one saved group chat."],
    ["mailbox", "Mailbox", mailbox, "A unit with no session keeps a mailbox; the inspector says so and offers Start session."],
    ["waiting", "Waiting on you", waiting, "The pill in the bar opens what waits on you: asks, reviews, and what ended without an answer."],
    ["approval-sent", "Answer sent", approvalSent, "Approve answers at once; the card shows the answer is on its way until the unit confirms it."],
    ["send-back", "Send back", sendBack, "Sending a task back needs a note: the unit reads it."],
    ["accepted", "Accepted", accepted, "Accepting closes the review; the notice offers Undo."],
  ],
  blueprint: [
    ["board", "A board", bpBoard, "Boards on the left, the board in the middle, comments on the right."],
    ["attach", "Attach agents", bpAttach, "Attached agents are notified of comments and can draw on the board."],
    ["comment", "Comment", bpComment, "A comment pins to an element; the box says who will be notified."],
    ["comment-sent", "Comment sent", bpCommentSent, "Notified at once; the agent's work shows in the thread."],
    ["watch", "Watch", bpWatch, "With Watch on, the board follows the agent as it draws."],
    ["conflict", "Changed while editing", bpConflict, "Nothing is overwritten: the person chooses what stays."],
    ["register", "Add a board", bpRegister, "A 2.x module board opens as a JSON copy; the module stays untouched."],
  ],
  void: [
    ["document", "Document", voidDoc, "The default view: the text, its attached agent and its comments."],
    ["edit", "Editing", voidEdit, "Editing a passage in place; Save shows its state and the text stays editable if it fails."],
    ["suggestion", "A suggested change", voidSuggestion, "An agent's change waits as a suggestion until it is accepted."],
    ["stale", "An old suggestion", voidStale, "A suggestion made on older text is never applied by itself."],
    ["focus", "Focus", focus(L), "Pure black, only the text; the arrows move through the pages."],
    ["focus-tools", "Focus, tools shown", focusTools, "Moving the mouse brings the tools back; Esc returns to the Document view."],
  ],
  settings: [
    ["settings", "Settings", settings, "Proposed: Settings opens from a gear at the right of the bar."],
    ["home", "Open on the phone", homeQr, "A QR code and a short code for 12 hours; a new code replaces the old one."],
    ["reconnecting", "Reconnecting", reconnecting, "If the service stops answering, work is kept and sent when it answers again."],
    ["service-down", "Service stopped", serviceDown, "A stopped service is said plainly, with a way to restart it."],
    ["slow", "Taking longer", slow, "A slow request says so at once and never waits without end."],
  ],
};

const PHONE = [
  ["pair", "Pair", phonePair(false), "The phone opens the link or types the code; it never stores a password."],
  ["pair-error", "Wrong code", phonePair(true), "A wrong code says so and how many tries are left."],
  ["hierarchy", "Hierarchy", phoneHierarchy(L), "See the whole mind; no editing on the phone."],
  ["chat", "A chat", phoneChat(L), "Chat and answer asks in place."],
  ["waiting", "Waiting", phoneWaiting(), "Everything that waits on you, answered in place."],
  ["closed", "Access ended", phoneClosed, "After 12 hours the access ends; a new code opens it again."],
];

const screens = [];
ROWS.forEach(([key, part], r) => {
  const y = r * STEP_Y;
  if (key === "phone") {
    PHONE.forEach(([id, title, root, note], i) => screens.push({ id: `phone-${id}`, title: `${part}: ${title}`, x: i * (390 + 160), y, w: 390, h: 844, root, note }));
    return;
  }
  DESK[key].forEach(([id, title, root, note], i) => screens.push({ id: `${key}-${id}`, title: `${part}: ${title}`, x: i * STEP_X, y, root, note }));
});

const chain = (key, at = {}) =>
  DESK[key].slice(1).map(([id, title], i) => ({ from: `${key}-${DESK[key][i][0]}`, to: `${key}-${id}`, label: title, ...(at[id] ? { at: at[id] } : {}) }));

export default board({
  id: "hivem1nd-3-flow",
  title: "HIVEM1ND 3.0: every step of the GUI",
  note:
    "Every step of HIVEM1ND 3.0 in Modern, one row per part: setup, the Map, chats and what waits on you, Blueprint, Void, settings and the service, the phone. " +
    "Every press answers at once and every wait ends with a clear state. Comment on any screen; Present plays each row in order. The sample is invented.",
  screens,
  links: [
    ...chain("setup", { mind: "continue", sync: "continue", service: "continue", loading: "continue" }),
    ...chain("map", { selected: "node-executor-shop", connect: "node-overlord-web", "start-session": "start-session" }),
    ...chain("chat"),
    ...chain("blueprint", { attach: "attach", watch: "watch" }),
    ...chain("void", { focus: "focus" }),
    ...chain("settings", { home: "open-phone" }),
    ...PHONE.slice(1).map(([id, title], i) => ({ from: `phone-${PHONE[i][0]}`, to: `phone-${id}`, label: title })),
  ],
});
