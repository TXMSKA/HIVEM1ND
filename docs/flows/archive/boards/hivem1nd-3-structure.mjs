// HIVEM1ND 3.0, building a structure from zero: how an Overlord and its Executors are created, what each one
// is given (its project, the folders it may write in, the agent and model it runs in, who it reports to), and
// how the structure then works: the plan is made and run inside the chat, by whoever leads there. A separate
// board from the 3.0 screen flow, so this one question reads on its own. The sample is invented.

import { board } from "blueprint/board.mjs";
import { box, col, row, stack, vector, fill, ELLIPSE } from "blueprint/kit.mjs";
import {
  LOOKS, t, mono, ic, dot, circle, centered, ibtn, button, bar, statusLine, panel, tabs, search, heading,
  unitRow, mapField, inspectorHead, facts, message, conversation, composer,
} from "../kit/h3.mjs";

const L = LOOKS[0];
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- shared parts -----------------------------------------------------------------------------------

const ARC = "M50 4 A46 46 0 1 1 4 50";
const spinner = (s = 14, color = "acc") =>
  stack({ w: s, h: s }, vector({ w: s, h: s, d: ELLIPSE, stroke: "line2", strokeWidth: 2 }), vector({ w: s, h: s, d: ARC, stroke: color, strokeWidth: 2 }));

const scrim = () => box({ w: 1440, h: 900, fill: "rgba(4,2,6,0.62)", place: { x: 0, y: 0 } });

function dialog({ title, sub = null, kids = [], actions = [], w = 600 }) {
  return col(
    { name: "dialog", label: title, w, pad: 24, gap: 16, radius: 22, fill: "panel", stroke: "line2", place: "center" },
    col({ gap: 6 }, t(title, 18, { weight: 700 }), sub ? t(sub, 13.5, { color: "mute" }) : null),
    ...kids,
    row({ gap: 8, justify: "end" }, ...actions),
  );
}

function field(label, value, { select = false, glyph = null, hint = null } = {}) {
  return col(
    { name: `field-${slug(label)}`, label, gap: 6 },
    t(label, 12.5, { weight: 600, color: "mute" }),
    row(
      { gap: 8, pad: [10, 12], radius: 12, fill: "card", stroke: "line2" },
      glyph ? ic(glyph, 15, "mute") : null,
      t(value, 14, { color: "text", lines: 1 }),
      fill(),
      select ? ic("chevron", 15, "mute") : null,
    ),
    hint ? t(hint, 12, { color: "mute" }) : null,
  );
}

const pairOf = (a, b) => row({ gap: 14, align: "start" }, col({ grow: 1 }, a), col({ grow: 1 }, b));

/** The two roles a person creates: an Overlord leads a project, an Executor does the work. */
function roleCard(title, desc, glyph, sel) {
  return row(
    { name: `role-${slug(title)}`, label: title, grow: 1, gap: 12, pad: [12, 14], radius: 14, fill: sel ? "card2" : "card", stroke: sel ? "acc" : "line" },
    stack({ w: 18, h: 18 }, circle(18, { stroke: sel ? "acc" : "line2", strokeWidth: 2 }), sel ? circle(8, { fill: "acc" }) : null),
    ic(glyph, 18, sel ? "acc" : "body"),
    col({ grow: 1, gap: 2 }, t(title, 14.5, { weight: 700 }), t(desc, 12, { color: "mute" })),
  );
}

/** The folders a unit may write in: its project's repository unless narrowed; anything else asks first. */
const folders = (list) =>
  col(
    { name: "field-can-write-in", label: "Can write in", gap: 6 },
    t("Can write in", 12.5, { weight: 600, color: "mute" }),
    row(
      { gap: 6, pad: [8, 10], radius: 12, fill: "card", stroke: "line2" },
      ...list.map((value) => row({ gap: 6, pad: [4, 9], radius: "pill", fill: "card2" }, ic("folder", 13, "body"), mono(value, 12, { color: "text" }))),
      fill(),
      row({ gap: 4 }, ic("plus", 13, "acc"), t("Folder", 12.5, { weight: 600, color: "acc" })),
    ),
    t("Anything outside these folders asks you first.", 12, { color: "mute" }),
  );

// ---- the window ---------------------------------------------------------------------------------------

const shell = (body, { waiting = 0, over = [] } = {}) =>
  stack(
    { w: 1440, h: 900, fill: "bg", theme: L.theme },
    col({ w: 1440, h: 900, place: { x: 0, y: 0 } }, bar(L, "Map", waiting, { gear: true }), body, statusLine(L, {})),
    ...over,
  );

const body3 = (...kids) => row({ h: 818, gap: 12, pad: [0, 12], align: "stretch" }, ...kids);

// The structure grows screen by screen: each stage adds units to the Map and to Hierarchy.
const BASE = [
  { id: "master", glyph: "person", x: 380, y: 70, sz: 40, person: true, lab: "You" },
  { id: "overseer", glyph: "crown", x: 380, y: 200, sz: 64, status: "idle", boss: true },
];
const OVERLORD = { id: "overlord-shop", glyph: "net", x: 240, y: 370, sz: 56, status: "idle", lead: true };
const CART = { id: "executor-cart", glyph: "term", x: 120, y: 530, sz: 46, status: "idle" };
const API = { id: "executor-api", glyph: "term", x: 330, y: 560, sz: 46, status: "idle" };
const BLOG = { id: "executor-blog", glyph: "term", x: 590, y: 400, sz: 46, status: "idle" };

const STAGES = {
  empty: { nodes: BASE, links: [["master", "overseer"]] },
  overlord: { nodes: [...BASE, OVERLORD], links: [["master", "overseer"], ["overseer", "overlord-shop"]] },
  team: { nodes: [...BASE, OVERLORD, CART, API], links: [["master", "overseer"], ["overseer", "overlord-shop"], ["overlord-shop", "executor-cart"], ["overlord-shop", "executor-api"]] },
  full: {
    nodes: [...BASE, OVERLORD, CART, API, BLOG],
    links: [["master", "overseer"], ["overseer", "overlord-shop"], ["overlord-shop", "executor-cart"], ["overlord-shop", "executor-api"], ["overseer", "executor-blog", "dash"]],
  },
};

const ROWS_OF = {
  empty: { chain: [["overseer", "crown", 0]], free: [] },
  overlord: { chain: [["overseer", "crown", 0], ["overlord-shop", "net", 1]], free: [] },
  team: { chain: [["overseer", "crown", 0], ["overlord-shop", "net", 1], ["executor-cart", "term", 2], ["executor-api", "term", 2]], free: [] },
  full: { chain: [["overseer", "crown", 0], ["overlord-shop", "net", 1], ["executor-cart", "term", 2], ["executor-api", "term", 2]], free: [["executor-blog", "term"]] },
};

function sidePanel(stage, sel) {
  const { chain, free } = ROWS_OF[stage];
  return panel(
    L, "right", { name: "side", label: "Side panel", w: 290 },
    tabs(L, [["Hierarchy", "net", true, "tab-hierarchy"], ["Chats", "users", false, "tab-chats"]]),
    search(L),
    col(
      { name: "hierarchy", label: "Hierarchy", pad: [0, 6, 10] },
      heading(L, "Chain of command"),
      ...chain.map(([id, glyph, level]) => unitRow(L, { id, glyph, level, status: "idle", sel: id === sel })),
      free.length ? heading(L, "Without an Overlord") : null,
      ...free.map(([id, glyph]) => unitRow(L, { id, glyph, status: "idle", sel: id === sel })),
    ),
  );
}

const mapScreen = (stage, inspector, { sel = null, over = [], waiting = 0 } = {}) =>
  shell(body3(sidePanel(stage, sel), mapField(L, { mode: "none", zones: false, groups: [], nodes: STAGES[stage].nodes, links: STAGES[stage].links, sel }), inspector), { over, waiting });

function unitPanel({ glyph, id, statusText, factsList, convo, place, status = "idle" }) {
  return panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, {
      glyph,
      title: id,
      sub: row({ gap: 6 }, status === "busy" ? spinner(10) : dot(status), t(statusText, 12.5, { color: "mute" })),
      right: [row({ gap: 6 }, ibtn(L, "pin", "pin", "Pin"), ibtn(L, "dots", "more", "More"))],
    }),
    facts(L, factsList),
    conversation(L, ...convo),
    composer(L, ...place),
  );
}

const OVERLORD_FACTS = () => [
  ["Project", t("shop", 13, { color: "text" })],
  ["Runs in", t("Claude Code, Sonnet 5.5", 13, { color: "text" })],
  ["Can write in", mono("shop", 12.5, { color: "text" })],
  ["Leads", t("executor-cart, executor-api", 12.5, { color: "text" })],
];

// ---- row 1: build the structure --------------------------------------------------------------------------

const emptyInspector = () =>
  panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    col(
      { grow: 1, align: "center", justify: "center", gap: 14, pad: 32 },
      stack({ w: 56, h: 56, radius: "pill", fill: "card" }, centered(ic("map", 24, "mute"))),
      t("Only you and the Overseer", 16, { weight: 700 }),
      t("A structure starts with New unit: first an Overlord for a project, then the Executors that work for it.", 13.5, { color: "mute", align: "center" }),
      button(L, "New unit", "pri", "plus", "new-unit"),
    ),
  );

const empty = () => mapScreen("empty", emptyInspector());

const newUnit = (role) => () => {
  const overlord = role === "Overlord";
  return mapScreen(overlord ? "empty" : "overlord", overlord ? emptyInspector() : unitPanel({ glyph: "net", id: "overlord-shop", statusText: "No session", factsList: OVERLORD_FACTS().slice(0, 3), convo: [], place: ["Message overlord-shop", "Its session starts when it has work", "bell"] }), {
    sel: overlord ? null : "overlord-shop",
    over: [
      scrim(),
      dialog({
        title: overlord ? "New unit: an Overlord" : "New unit: an Executor",
        sub: overlord
          ? "It leads one project: it makes the plan, gives each task to an Executor and reviews the work."
          : "It does the work it is given. Under an Overlord it works on that Overlord's plan; alone, it plans for itself.",
        kids: [
          row({ gap: 10 }, roleCard("Overlord", "Leads a project", "net", overlord), roleCard("Executor", "Does the work", "term", !overlord)),
          pairOf(field("Name", overlord ? "overlord-shop" : "executor-cart"), field("Project", "shop", { select: true, glyph: "folder" })),
          pairOf(field("Runs in", overlord ? "Claude Code" : "Cursor", { select: true, glyph: "term" }), field("Model", overlord ? "Sonnet 5.5" : "Grok 4.7", { select: true })),
          overlord ? folders(["shop"]) : folders(["shop/src/cart", "shop/test/cart"]),
          pairOf(field("Reports to", overlord ? "overseer" : "overlord-shop", { select: true }), field("Machine", "DESKTOP, this machine", { select: true, glyph: "desk" })),
        ],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Create", "pri", null, "create-unit")],
      }),
    ],
  });
};

const overlordCreated = () =>
  mapScreen(
    "overlord",
    unitPanel({
      glyph: "net",
      id: "overlord-shop",
      statusText: "No session",
      factsList: OVERLORD_FACTS().slice(0, 3),
      convo: [col({ gap: 8, pad: [12, 14], radius: 14, fill: "card" }, t("overlord-shop leads shop", 13.5, { weight: 700 }), t("It has no Executors yet. Add one with New unit and choose overlord-shop in Reports to.", 12.5, { color: "body" }))],
      place: ["Message overlord-shop", "Its session starts when it has work", "bell"],
    }),
    { sel: "overlord-shop" },
  );

const team = () =>
  mapScreen(
    "team",
    unitPanel({
      glyph: "net",
      id: "overlord-shop",
      statusText: "No session",
      factsList: OVERLORD_FACTS(),
      convo: [col({ gap: 8, pad: [12, 14], radius: 14, fill: "card" }, t("A team of three", 13.5, { weight: 700 }), t("executor-cart runs in Cursor and may write in the cart folders; executor-api runs in Codex and may write in shop/api. Both work on overlord-shop's plans.", 12.5, { color: "body" }))],
      place: ["Message overlord-shop", "Its session starts when it has work", "bell"],
    }),
    { sel: "overlord-shop" },
  );

const alone = () =>
  mapScreen(
    "full",
    unitPanel({
      glyph: "term",
      id: "executor-blog",
      statusText: "No session",
      factsList: [
        ["Project", t("blog", 13, { color: "text" })],
        ["Runs in", t("Codex, GPT-5.5", 13, { color: "text" })],
        ["Can write in", mono("blog", 12.5, { color: "text" })],
        ["Reports to", t("You, no Overlord", 13, { color: "text" })],
      ],
      convo: [col({ gap: 8, pad: [12, 14], radius: 14, fill: "card" }, t("An Executor on its own", 13.5, { weight: 700 }), t("With no Overlord it answers to you: it plans its own work and asks you what it cannot decide.", 12.5, { color: "body" }))],
      place: ["Message executor-blog", "Its session starts when it has work", "bell"],
    }),
    { sel: "executor-blog" },
  );

// ---- row 2: work with it; the plan lives in the chat -------------------------------------------------------

const you = (body, when = "10:02") => message(L, { who: "You", when, body, me: true });

/** A plan inside the chat, as a reply: each task says who does it and in what; it is edited in place and run from here. */
function planBlock({ by = "overlord-shop", tasks, state = "draft", problem = null }) {
  const icon = (s) =>
    s === "done"
      ? stack({ w: 18, h: 18 }, circle(18, { fill: "acc" }), centered(ic("check", 12, "accInk")))
      : s === "busy"
        ? spinner(18)
        : s === "stuck"
          ? ic("alert", 17, "wait")
          : box({ w: 18, h: 18, radius: "pill", stroke: "line2", strokeWidth: 2 });
  return col(
    { name: "plan", label: "Plan", gap: 10, pad: [12, 14], radius: 14, fill: problem ? "waitSoft" : "card", stroke: problem ? "wait" : "line" },
    row({ gap: 8 }, ic("list", 15, problem ? "wait" : "acc"), t("Plan: cart empty state", 13.5, { weight: 700 }), fill(), mono(by, 11, { color: "mute" })),
    ...tasks.map(([title, who, agent, s = "todo", since = null], i) =>
      row(
        { name: `task-${i + 1}`, label: title, gap: 10, align: "start" },
        state === "draft" ? t(`${i + 1}`, 12.5, { weight: 700, color: "mute" }) : icon(s),
        col({ grow: 1, gap: 3 }, t(title, 13, { color: "text" }), row({ gap: 6 }, mono(who, 11, { color: "mute" }), t(agent, 11, { color: "mute" }), state === "draft" ? ic("chevron", 12, "mute") : null)),
        since ? t(since, 11.5, { color: s === "stuck" ? "wait" : "mute" }) : null,
      ),
    ),
    problem ? t(problem, 12.5, { color: "body" }) : null,
    state === "draft"
      ? row({ gap: 6 }, button(L, "Run", "pri", "play", "run-plan"), button(L, "Edit", "plain", "pen", "edit-plan"), t("Each task's unit and agent can be changed", 11.5, { color: "mute" }))
      : problem
        ? row({ gap: 6 }, button(L, "Stop the step", "pri", "stop", "stop-step"), button(L, "Retry the task", "plain", "retry", "retry-task"))
        : row({ gap: 6 }, button(L, "Stop", "ghost", "stop", "stop-plan"), t("Tasks run in order; each one reports as it goes", 11.5, { color: "mute" })),
  );
}

const TASKS = [
  ["Empty state on the cart page", "executor-cart", "Cursor, Grok 4.7"],
  ["The cart API answers an empty cart", "executor-api", "Codex, GPT-5.5"],
  ["Review both against the board", "overlord-shop", "Claude Code, Sonnet 5.5"],
];
const withStates = (states) => TASKS.map((task, i) => [...task, ...states[i]]);

const overlordChat = (convo, { status = "idle", statusText = "No session", waiting = 0 } = {}) =>
  mapScreen("team", unitPanel({ glyph: "net", id: "overlord-shop", status, statusText, factsList: OVERLORD_FACTS(), convo, place: ["Message overlord-shop", "Its Executors wait for its plan", "bell"] }), { sel: "overlord-shop", waiting });

const ASK = () => you("The cart needs an empty state, as drawn on the Cart board.");

const askOverlord = () =>
  overlordChat([ASK(), row({ gap: 10, pad: [10, 14], radius: 18, fill: "card", self: "start" }, spinner(13), t("overlord-shop is making the plan", 13.5, { color: "body" }), t("40 s", 12, { color: "mute" }))], { status: "busy", statusText: "Planning" });

const planReady = () =>
  overlordChat([ASK(), message(L, { who: "overlord-shop", when: "10:03", body: "Three tasks. executor-cart and executor-api build, I review." }), planBlock({ tasks: TASKS })], { statusText: "Plan ready" });

const planRuns = () =>
  overlordChat(
    [ASK(), planBlock({ state: "run", tasks: withStates([["done", "10:09"], ["busy", "4 min"], ["todo"]]) }), message(L, { who: "overlord-shop", when: "10:09", body: "Task 1 done and committed. executor-api is on task 2." })],
    { status: "busy", statusText: "Running the plan" },
  );

const planStuck = () =>
  overlordChat(
    [ASK(), planBlock({ state: "run", tasks: withStates([["done", "10:09"], ["stuck", "14 min"], ["todo"]]), problem: "executor-api has shown no progress for 10 minutes. Its changes are kept; overlord-shop was told." })],
    { status: "wait", statusText: "Needs you", waiting: 1 },
  );

const executorAlone = () =>
  mapScreen(
    "full",
    unitPanel({
      glyph: "term",
      id: "executor-blog",
      status: "idle",
      statusText: "Plan ready",
      factsList: [["Project", t("blog", 13, { color: "text" })], ["Reports to", t("You, no Overlord", 13, { color: "text" })]],
      convo: [
        you("Write the post that announces the empty cart."),
        planBlock({ by: "executor-blog", tasks: [["Draft the post", "executor-blog", "Codex, GPT-5.5"], ["Add the screenshot from the Cart board", "executor-blog", "Codex, GPT-5.5"]] }),
      ],
      place: ["Message executor-blog", "It plans and works on its own", "bell"],
    }),
    { sel: "executor-blog" },
  );

const groupNoLead = () =>
  mapScreen(
    "full",
    panel(
      L, "left", { name: "inspector", label: "Inspector", w: 366 },
      inspectorHead(L, { glyph: "folder", title: "Launch", monoTitle: false, sub: t("Group: executor-cart, executor-blog", 12.5, { color: "mute" }), right: [ibtn(L, "dots", "more", "More")] }),
      conversation(
        L,
        you("Get the launch of the empty cart ready."),
        message(L, { who: "executor-blog", when: "10:21", body: "Neither of us leads the other. Who makes the plan?" }),
        col(
          { name: "who-plans", label: "Who plans", gap: 8, pad: [11, 12], radius: 12, fill: "card", stroke: "wait" },
          row({ gap: 8 }, ic("hand", 15, "text"), t("Who makes the plan?", 13, { color: "text" })),
          row({ gap: 6 }, button(L, "executor-blog", "plain", null, "plan-blog"), button(L, "executor-cart", "plain", null, "plan-cart"), button(L, "I write it", "ghost", null, "plan-me")),
        ),
      ),
      composer(L, "Message the group", "Every member sees every reply", "users"),
    ),
    { waiting: 1 },
  );

// ---- the board ---------------------------------------------------------------------------------------------

const ROWS = [
  ["build", "Build the structure", [
    ["empty", "From zero", empty, "The first run has only the person and the Overseer. Every structure starts with New unit."],
    ["new-overlord", "New Overlord", newUnit("Overlord"), "An Overlord leads one project: it plans, gives each task to an Executor and reviews. It is given a name, its project, the agent and model it runs in, the folders it may write in (its project's repository unless narrowed), who it reports to and its machine."],
    ["overlord-created", "The Overlord on the Map", overlordCreated, "It appears under the Overseer with no session; a session starts when it has work."],
    ["new-executor", "New Executor", newUnit("Executor"), "An Executor is given the same fields. Reports to overlord-shop puts it in that Overlord's team; its folders can be narrowed to part of the repository."],
    ["team", "A team", team, "Two Executors under overlord-shop, each in its own agent and model. Units in a team work only on their Overlord's plan."],
    ["alone", "An Executor on its own", alone, "Reports to: no Overlord. It answers to the person directly and plans its own work."],
  ]],
  ["work", "Work with it: the plan lives in the chat", [
    ["ask", "Ask the Overlord", askOverlord, "The person writes to the Overlord as to anyone. Its Executors do nothing until the plan gives them a task."],
    ["plan", "The plan in the chat", planReady, "The Overlord answers with a plan inside the chat, as Cursor does: each task says who does it and in what agent and model, and can be changed in place. Run starts it."],
    ["running", "The plan runs", planRuns, "The same plan shows each task's state and time. The Overlord opens each Executor's session; no Executor opens another."],
    ["stuck", "The plan needs you", planStuck, "A task with no progress for 10 minutes, or an Executor that does not start within 3, turns the plan into a warning with Stop and Retry; it also waits in Waiting."],
    ["executor-alone", "Ask an Executor on its own", executorAlone, "An Executor without an Overlord makes its own plan, in the same form, and runs it itself."],
    ["no-lead", "A group with no lead", groupNoLead, "Executors that do not report to each other take the person as their lead: before planning they ask who makes the plan."],
  ]],
];

const STEP_X = 1440 + 160;
const STEP_Y = 900 + 360;

const screens = [];
ROWS.forEach(([key, part, list], r) => {
  list.forEach(([id, title, root, note], i) => screens.push({ id: `${key}-${id}`, title: `${r + 1}.${i + 1} ${part}: ${title}`, x: i * STEP_X, y: r * STEP_Y, root, note }));
});

export default board({
  id: "hivem1nd-3-structure",
  title: "HIVEM1ND 3.0: a structure from zero",
  note:
    "How a structure is built in HIVEM1ND 3.0 and how it works: an Overlord for a project, its Executors, an Executor on its own, and the plan made and run inside the chat by whoever leads there. " +
    "A separate board from the 3.0 screen flow. The sample is invented.",
  screens,
  links: ROWS.flatMap(([key, , list]) => list.slice(1).map(([id, title], i) => ({ from: `${key}-${list[i][0]}`, to: `${key}-${id}`, label: title }))),
});
