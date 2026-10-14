// HIVEM1ND 3.0, start working, drawn from the owner's sketch in words (2026-10-14): the person sits at the
// center of the Map, which moves in X and Y. The M1ND starts empty. Repositories found on the machine are
// offered, never imported on their own; each one accepted becomes a cluster. A cluster is a group that may be
// linked to a repository, to a folder or to nothing, drawn as a rounded dashed frame, and agents (Overlords
// and Executors) are created inside it. The first prompt creates the Overseer, which starts fresh in each
// session unless the person keeps its context, and says when its context is filling. A separate board from
// the 3.0 screen flow. The sample is invented.

import { board } from "blueprint/board.mjs";
import { box, col, row, stack, vector, fill, ELLIPSE } from "blueprint/kit.mjs";
import {
  LOOKS, t, mono, ic, dot, centered, ibtn, button, bar, statusLine, panel, tabs, search,
  unitRow, inspectorHead, message, conversation, composer, tick, lines, segment, unitNode, zoom, services, MID_W,
} from "../kit/h3.mjs";

const L = LOOKS[0];
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- shared parts -----------------------------------------------------------------------------------

const ARC = "M50 4 A46 46 0 1 1 4 50";
const spinner = (s = 14, color = "acc") =>
  stack({ w: s, h: s }, vector({ w: s, h: s, d: ELLIPSE, stroke: "line2", strokeWidth: 2 }), vector({ w: s, h: s, d: ARC, stroke: color, strokeWidth: 2 }));

const scrim = () => box({ w: 1440, h: 900, fill: "rgba(4,2,6,0.62)", place: { x: 0, y: 0 } });

function dialog({ title, sub = null, kids = [], actions = [], w = 540 }) {
  return col(
    { name: "dialog", label: title, w, pad: 24, gap: 16, radius: 22, fill: "panel", stroke: "line2", place: "center" },
    col({ gap: 6 }, t(title, 18, { weight: 700 }), sub ? t(sub, 13.5, { color: "mute" }) : null),
    ...kids,
    row({ gap: 8, justify: "end" }, ...actions),
  );
}

function toast(msg, action = null) {
  return row(
    { name: "toast", label: "Notice", gap: 10, pad: [11, 16], radius: 14, fill: "text", place: "bottom-center", dy: -46 },
    ic("check", 15, "bg"),
    t(msg, 13, { weight: 700, color: "bg" }),
    action ? row({ pad: [0, 0, 0, 6] }, t(action, 13, { weight: 700, color: "#56631c" })) : null,
  );
}

const segmented = (items, name) =>
  row({ name, label: name, gap: 4, pad: 4, radius: 12, fill: "card" }, ...items.map(([value, on, glyph = null]) => row({ grow: 1, justify: "center", gap: 6, pad: [7, 12], radius: 9, fill: on ? "card2" : undefined }, glyph ? ic(glyph, 14, on ? "text" : "mute") : null, t(value, 13, { weight: 600, color: on ? "text" : "mute" }))));

const field = (label, value, { glyph = null, select = true } = {}) =>
  col(
    { name: `field-${slug(label)}`, label, gap: 6 },
    t(label, 12, { weight: 600, color: "mute" }),
    row({ gap: 8, pad: [9, 11], radius: 11, fill: "card", stroke: "line2" }, glyph ? ic(glyph, 14, "mute") : null, t(value, 13.5, { color: "text", lines: 1 }), fill(), select ? ic("chevron", 14, "mute") : null),
  );

/** One of two kinds to choose from, side by side: an icon, a name and what it means. */
const kind = (on, glyph, title, note) =>
  col(
    { name: `kind-${slug(title)}`, label: title, grow: 1, gap: 8, pad: [14, 14], radius: 16, fill: on ? "card2" : "card", stroke: on ? "acc" : "line" },
    row({ gap: 10 }, stack({ w: 34, h: 34, radius: 10, fill: on ? "accSoft" : "card2" }, centered(ic(glyph, 17, on ? "acc" : "body"))), t(title, 14.5, { weight: 700, color: on ? "text" : "body" }), fill(), on ? ic("check", 15, "acc") : null),
    t(note, 12, { color: "mute" }),
  );

/** One answer of a choice, with its consequence under it and an optional action. */
const choice = (on, value, note, action = null) =>
  row(
    { name: `choice-${slug(value)}`, label: value, gap: 12, pad: [12, 14], radius: 14, fill: on ? "card2" : "card", stroke: on ? "acc" : "line", align: "start" },
    stack({ w: 18, h: 18 }, box({ w: 18, h: 18, radius: "pill", stroke: on ? "acc" : "line2", strokeWidth: 2, place: { x: 0, y: 0 } }), on ? box({ w: 8, h: 8, radius: "pill", fill: "acc", place: { x: 5, y: 5 } }) : null),
    col({ grow: 1, gap: 2 }, t(value, 14, { weight: 700 }), t(note, 12, { color: "mute" })),
    action ? t(action, 12.5, { weight: 700, color: "acc" }) : null,
  );

const check = (on, value, note = null) =>
  row({ gap: 10, pad: [8, 10], radius: 10, fill: "card", align: "start" }, tick(on), col({ grow: 1, gap: 2 }, t(value, 13.5, { color: "text" }), note ? t(note, 12, { color: "mute" }) : null));

const branch = (name) => row({ gap: 4, pad: [2, 7], radius: "pill", fill: "card2" }, ic("graph", 11, "mute"), mono(name, 11, { color: "body" }));

// ---- the Map: the person at the center, clusters around, free to move in X and Y ---------------------------

const OVERSEER = { id: "overseer", glyph: "crown", x: 380, y: 409, sz: 60, status: "idle", boss: true };

// Each cluster: its frame on the Map (left, top, width, height) and what it is linked to.
const CLUSTERS = {
  shop: { at: [40, 470, 290, 230], link: "repo", path: "github.com/you/shop", branch: "main" },
  blog: { at: [500, 480, 220, 170], link: "repo", path: "github.com/you/blog", branch: "main" },
  "api-gateway": { at: [500, 150, 220, 160], link: "repo", path: "github.com/you/api-gateway", branch: "feat/auth" },
  nova: { at: [40, 150, 220, 160], link: "repo", path: "github.com/you/nova", branch: "main" },
  ideas: { at: [290, 720, 180, 70], link: "none" },
};

/** A cluster on the Map: a rounded dashed frame, named on its top edge with what it is linked to. */
function area(id, { sel = false } = {}) {
  const [x, y, w, h] = CLUSTERS[id].at;
  const glyph = CLUSTERS[id].link === "repo" ? "graph" : CLUSTERS[id].link === "folder" ? "folder" : "users";
  return [
    box({ name: `cluster-area-${id}`, label: id, w, h, radius: 14, stroke: sel ? "acc" : "ring", strokeWidth: sel ? 2 : 1.4, dash: "7 5", fill: sel ? "accSoft" : "ringSoft", place: { x, y } }),
    row(
      { gap: 5, pad: [2, 8], radius: 7, fill: "zoneLab", place: { x: x + 14, y: y - 11 } },
      ic(glyph, 12, sel ? "acc" : "ring"),
      t(id, 11.5, { weight: 700, color: sel ? "acc" : "body" }),
    ),
  ];
}

// Many repositories: the folders that hold them become clusters, with each repository a cluster inside.
const FOLDERS = [
  { id: "Web", path: "C:\\Users\\you\\Web", repos: ["shop", "blog", "api-gateway", "nova", "atlas", "beacon", "cobalt", "delta", "ember", "fjord", "garnet", "harbor", "iris", "juniper", "kestrel", "lumen", "meridian", "nimbus", "orbit"] },
  { id: "Unity", path: "C:\\Users\\you\\Unity", repos: ["e-garden", "ghost-run", "quarry", "sentinel", "sky-paint", "the-trip"] },
  { id: "Tools", path: "C:\\Users\\you\\Tools", repos: ["v-cash"] },
];

/** A repository inside a folder cluster, drawn small: a rounded dashed frame with its name. */
const mini = (name, x, y, { w = 112, h = 40, sel = false } = {}) =>
  stack(
    { name: `cluster-area-${name}`, label: name, w, h, place: { x, y } },
    box({ w, h, radius: 10, stroke: sel ? "acc" : "ring", strokeWidth: sel ? 2 : 1.2, dash: "5 4", fill: sel ? "accSoft" : "ringSoft", place: { x: 0, y: 0 } }),
    w < 100
      ? row({ pad: [0, 6], h, place: { x: 0, y: 0 } }, t(name, 9.5, { weight: 600, color: sel ? "acc" : "body", lines: 1 }))
      : row({ gap: 5, pad: [0, 10], h, place: { x: 0, y: 0 } }, ic("graph", 11, sel ? "acc" : "ring"), t(name, 11.5, { weight: 600, color: sel ? "acc" : "body", lines: 1 })),
  );

/** A folder cluster zoomed out: its frame, its name and count, and every repository in it, small. */
function folderArea(folder, [x, y, w, h], shown = folder.repos.length) {
  const cols = Math.max(1, Math.floor((w - 24) / 72));
  const kids = folder.repos.slice(0, shown).map((name, i) => mini(name, x + 14 + (i % cols) * 72, y + 20 + Math.floor(i / cols) * 30, { w: 66, h: 24 }));
  const more = folder.repos.length - shown;
  return [
    box({ name: `cluster-area-${folder.id}`, label: folder.id, w, h, radius: 16, stroke: "ring", strokeWidth: 1.4, dash: "7 5", fill: "ringSoft", place: { x, y } }),
    row({ gap: 5, pad: [2, 8], radius: 7, fill: "zoneLab", place: { x: x + 14, y: y - 11 } }, ic("folder", 12, "ring"), t(`${folder.id}, ${folder.repos.length}`, 11.5, { weight: 700, color: "body" })),
    ...kids,
    more > 0 ? row({ pad: [3, 9], radius: "pill", fill: "card2", place: { x: x + w - 64, y: y + h - 30 } }, t(`+${more}`, 11.5, { weight: 700, color: "mute" })) : null,
  ];
}

const FRAMES = { Web: [8, 320, 318, 186], Unity: [444, 260, 300, 90], Tools: [444, 470, 300, 60] };

function overviewMap({ overseer = true } = {}) {
  const nodes = overseer ? [OVERSEER] : [];
  return stack(
    { name: "map", label: "Map", w: MID_W, fill: "bg", clip: true },
    row({ gap: 14, place: { x: 14, y: 12 } }, t("Zoomed out: every cluster at once. Double click one to fly to it", 12, { color: "mute" })),
    ...FOLDERS.flatMap((f) => folderArea(f, FRAMES[f.id])),
    ...nodes.flatMap((n) => unitNode(L, n, { sel: null, group: [] })),
    zoom(L),
    services(L),
  );
}

/** Inside one folder cluster: every repository of it as a cluster, with the way back. */
function insideMap(sel = "shop") {
  const web = FOLDERS[0];
  return stack(
    { name: "map", label: "Map", w: MID_W, fill: "bg", clip: true },
    row({ gap: 14, place: { x: 14, y: 12 } }, t("Zoomed in on Web, 19 repositories; zoom out to see every cluster again", 12, { color: "mute" })),
    box({ name: "cluster-area-Web", label: "Web", w: 720, h: 690, radius: 18, stroke: "ring", strokeWidth: 1.4, dash: "7 5", fill: "ringSoft", place: { x: 20, y: 48 } }),
    ...web.repos.map((name, i) => mini(name, 44 + (i % 4) * 172, 76 + Math.floor(i / 4) * 92, { w: 156, h: 62, sel: name === sel })),
    zoom(L),
    services(L),
  );
}

function treeSide({ open = "Web", sel = "shop" } = {}) {
  return panel(
    L, "right", { name: "side", label: "Side panel", w: 290 },
    tabs(L, [["Hierarchy", "net", true, "tab-hierarchy"], ["Chats", "users", false, "tab-chats"]]),
    search(L),
    col(
      { name: "hierarchy", label: "Hierarchy", pad: [0, 6, 10] },
      unitRow(L, { id: "overseer", glyph: "crown", status: "idle", sub: "Above every cluster" }),
      row({ pad: [12, 8, 6] }, t("Clusters", 11.5, { color: "mute", upper: true, track: 0.08 }), fill(), row({ name: "new-cluster", label: "New cluster", gap: 4 }, ic("plus", 14, "mute"))),
      ...FOLDERS.flatMap((f) => [
        row({ name: `cluster-${f.id}`, label: f.id, gap: 8, pad: [6, 8], radius: 7 }, ic(f.id === open ? "chevron" : "right", 13, "mute"), ic("folder", 15, "body"), t(f.id, 13.5, { weight: 600, color: "text" }), fill(), t(String(f.repos.length), 12, { color: "mute" })),
        ...(f.id === open
          ? [
              ...f.repos.slice(0, 6).map((name) => row({ name: `cluster-${name}`, label: name, gap: 8, pad: [5, 8, 5, 30], radius: 7, fill: name === sel ? "accSoft" : undefined }, ic("graph", 13, name === sel ? "acc" : "mute"), t(name, 13, { color: "text" }), fill(), mono("main", 11, { color: "mute" }))),
              row({ pad: [4, 8, 4, 30] }, t(`${f.repos.length - 6} more`, 12, { color: "mute" })),
            ]
          : []),
      ]),
    ),
  );
}

const TEAM = [
  { id: "overlord-shop", glyph: "net", x: 185, y: 545, sz: 50, status: "work", lead: true },
  { id: "executor-shop", glyph: "term", x: 110, y: 630, sz: 42, status: "work" },
  { id: "executor-shop-2", glyph: "term", x: 260, y: 630, sz: 42, status: "idle" },
];

function theMap({ clusters = [], overseer = false, team = false, sel = null, clusterSel = null } = {}) {
  const nodes = [...(overseer ? [OVERSEER] : []), ...(team ? TEAM : [])];
  const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const links = team ? [["overseer", "overlord-shop"], ["overlord-shop", "executor-shop"], ["overlord-shop", "executor-shop-2"]] : [];
  return stack(
    { name: "map", label: "Map", w: MID_W, fill: "bg", clip: true },
    row({ gap: 14, place: { x: 14, y: 12 } }, t("Drag the empty space to move around; Shift and drag to select", 12, { color: "mute" })),
    ...clusters.flatMap((id) => area(id, { sel: id === clusterSel && !sel })),
    lines(links.map(([a, b]) => segment(at[a], at[b])), { stroke: "edge", strokeWidth: 1.5 }),
    ...nodes.flatMap((n) => unitNode(L, n, { sel, group: [] })),
    zoom(L),
    services(L),
  );
}

// ---- the side panel: the Overseer and the clusters, each with what it is linked to ---------------------------

function clusterRow(id, { open = false, sel = false } = {}) {
  const c = CLUSTERS[id];
  return row(
    { name: `cluster-${id}`, label: id, gap: 8, pad: [6, 8], radius: 7, fill: sel ? "accSoft" : undefined, edge: sel ? { side: "left", color: "acc", width: 2 } : undefined },
    ic(open ? "chevron" : "right", 13, "mute"),
    ic("folder", 15, sel ? "acc" : "body"),
    t(id, 13.5, { weight: 600, color: "text" }),
    fill(),
    c.link === "repo" ? mono(c.branch, 11, { color: "mute" }) : t(c.link === "folder" ? "Folder" : "No link", 11, { color: "mute" }),
  );
}

function sidePanel({ clusters = [], overseer = false, team = false, sel = null, clusterSel = null } = {}) {
  return panel(
    L, "right", { name: "side", label: "Side panel", w: 290 },
    tabs(L, [["Hierarchy", "net", true, "tab-hierarchy"], ["Chats", "users", false, "tab-chats"]]),
    search(L),
    col(
      { name: "hierarchy", label: "Hierarchy", pad: [0, 6, 10] },
      overseer ? unitRow(L, { id: "overseer", glyph: "crown", status: "idle", sub: "Above every cluster", sel: sel === "overseer" }) : null,
      row({ pad: [12, 8, 6] }, t("Clusters", 11.5, { color: "mute", upper: true, track: 0.08 }), fill(), row({ name: "new-cluster", label: "New cluster", gap: 4 }, ic("plus", 14, "mute"))),
      ...(clusters.length
        ? clusters.flatMap((id) => [
            clusterRow(id, { open: id === clusterSel, sel: id === clusterSel && !sel }),
            ...(team && id === "shop" && clusterSel === "shop" ? TEAM.map((n, i) => unitRow(L, { id: n.id, glyph: n.glyph, level: i ? 2 : 1, status: "idle", sel: n.id === sel })) : []),
          ])
        : [col({ pad: [6, 10] }, t("No clusters yet. A cluster groups agents, and may be linked to a repository or a folder.", 12, { color: "mute" }))]),
    ),
  );
}

// ---- the window ---------------------------------------------------------------------------------------

const shell = (body, { waiting = 0, over = [] } = {}) =>
  stack(
    { w: 1440, h: 900, fill: "bg", theme: L.theme },
    col({ w: 1440, h: 900, place: { x: 0, y: 0 } }, bar(L, "Map", waiting, { gear: true }), body, statusLine(L, {})),
    ...over,
  );
const body3 = (...kids) => row({ h: 818, gap: 12, pad: [0, 12], align: "stretch" }, ...kids);
const screen = (state, inspector, opts = {}) => shell(body3(sidePanel(state), theMap(state), inspector), opts);

const emptyInspector = (title, body, action = null) =>
  panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    col({ grow: 1, align: "center", justify: "center", gap: 14, pad: 32 }, stack({ w: 56, h: 56, radius: "pill", fill: "card" }, centered(ic("map", 24, "mute"))), t(title, 16, { weight: 700 }), t(body, 13.5, { color: "mute", align: "center" }), action),
  );

function clusterPanel(id, { units = null, convo = [], note = null } = {}) {
  const c = CLUSTERS[id];
  return panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, { glyph: "folder", title: id, monoTitle: false, sub: t(c.link === "repo" ? "Cluster linked to a repository" : "Cluster with no link", 12.5, { color: "mute" }), right: [row({ gap: 6 }, ibtn(L, "plus", "new-agent", "New agent"), ibtn(L, "dots", "more", "More"))] }),
    c.link === "repo"
      ? col(
          { name: "git", label: "Git", gap: 8, pad: [12, 16], edge: { side: "bottom", color: "line" } },
          row({ gap: 8 }, ic("graph", 14, "mute"), mono(c.path, 12, { color: "text" }), fill(), branch(c.branch)),
          row({ gap: 8 }, t("2 files changed, not committed", 12.5, { color: "wait" }), fill(), t("Last commit 2 h ago", 12, { color: "mute" })),
          row({ gap: 6 }, button(L, "Changes", "plain", "list", "changes"), button(L, "Open in editor", "ghost", "code", "open-editor")),
        )
      : col({ gap: 6, pad: [12, 16], edge: { side: "bottom", color: "line" } }, t("No repository or folder: its agents can talk and plan, but have nowhere to write.", 12.5, { color: "mute" }), row({ gap: 6 }, button(L, "Link a folder", "plain", "folder", "link-folder"))),
    row({ gap: 8, pad: [10, 16], edge: { side: "bottom", color: "line" } }, ic("users", 13, "mute"), t(units ?? "No agents yet", 12.5, { color: "mute" })),
    conversation(L, ...convo),
    composer(L, `Message ${id}`, note ?? "Goes to the cluster's lead", "bell"),
  );
}

// ---- row 1: the first run ------------------------------------------------------------------------------

const FOUR = ["shop", "blog", "api-gateway", "nova"];

const folderGroup = (f, open) =>
  col(
    { gap: 2 },
    row({ gap: 10, pad: [8, 10], radius: 10, fill: "card" }, tick(true), ic(open ? "chevron" : "right", 13, "mute"), ic("folder", 15, "body"), t(f.id, 13.5, { weight: 700 }), mono(f.path, 11.5, { color: "mute" }), fill(), t(`${f.repos.length} ${f.repos.length === 1 ? "repository" : "repositories"}`, 12, { color: "mute" })),
    ...(open ? [...f.repos.slice(0, 4).map((name) => row({ gap: 10, pad: [5, 10, 5, 42] }, tick(true), ic("graph", 13, "mute"), t(name, 13, { color: "text" }))), row({ pad: [3, 10, 3, 42] }, t(`${f.repos.length - 4} more`, 12, { color: "mute" }))] : []),
  );

const reposFound = () =>
  screen({}, emptyInspector("Nothing here yet", "Everything starts empty. Clusters and agents are added when you need them."), {
    over: [
      scrim(),
      dialog({
        title: "26 repositories found on this machine",
        sub: "They sit in three folders. Each folder becomes a cluster, with its repositories as clusters inside it. Nothing is imported until you say so, and nothing in them changes.",
        w: 600,
        kids: [
          row({ gap: 8, pad: [8, 10], radius: 10, fill: "card", stroke: "line2" }, ic("search", 14, "mute"), t("Filter repositories", 13, { color: "mute" })),
          col({ gap: 6 }, ...FOLDERS.map((f) => folderGroup(f, f.id === "Web"))),
          t("Worktrees show inside their repository, not as repositories of their own.", 12, { color: "mute" }),
        ],
        actions: [button(L, "Not now", "ghost", null, "not-now"), button(L, "Import 26", "pri", null, "import")],
      }),
    ],
  });

const createOverseer = () =>
  shell(body3(treeSide({ open: null, sel: null }), overviewMap({ overseer: false }), emptyInspector("26 repositories imported", "Three folder clusters, with the repositories inside them.")), {
    over: [
      scrim(),
      dialog({
        title: "Create your Overseer",
        sub: "It watches over every cluster: it answers what is going on and hands work to each cluster's lead. It runs only when you write to it.",
        w: 600,
        kids: [
          row(
            { gap: 10 },
            kind(true, "term", "External agent", "Claude Code, Codex or Cursor, with your own account. The strongest answers; uses that account's quota."),
            kind(false, "bulb", "Local model", "Lyra on this machine. Free and private, with no quota; slower and less capable."),
          ),
          field("Runs in", "Claude Code, Sonnet 5.5, high", { glyph: "term" }),
          check(true, "Start fresh every session", "Recommended: it reads the M1ND again instead of carrying an old conversation. It tells you when its context is filling."),
        ],
        actions: [button(L, "Later", "ghost", null, "later"), button(L, "Create", "pri", null, "create-overseer")],
      }),
    ],
  });

const overview = () =>
  shell(body3(treeSide({ open: null, sel: null }), overviewMap(), emptyInspector("Your clusters", "Web, Unity and Tools hold 26 repositories. Double click one to fly to it.")));

const inside = () => shell(body3(treeSide({ open: "Web", sel: "shop" }), insideMap("shop"), clusterPanel("shop", { units: "No agents yet: New agent adds one." })));

// ---- row 2: clusters and agents ----------------------------------------------------------------------------

const newCluster = () =>
  screen({ clusters: FOUR, overseer: true }, emptyInspector("Nothing selected", "Select a cluster or an agent."), {
    over: [
      scrim(),
      dialog({
        title: "New cluster",
        sub: "A cluster groups agents. It can be linked to a repository or a folder, which is where its agents may write, or to nothing.",
        kids: [
          field("Name", "ideas", { select: false }),
          col({ gap: 6 }, t("Linked to", 12, { weight: 600, color: "mute" }), segmented([["Repository", false, "graph"], ["Folder", false, "folder"], ["Nothing", true, "x"]], "linked-to")),
          t("With nothing linked, its agents can talk and plan but cannot write files. A folder can be linked later.", 12, { color: "mute" }),
        ],
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Create", "pri", null, "create-cluster")],
      }),
    ],
  });

const noLink = () => screen({ clusters: [...FOUR, "ideas"], overseer: true, clusterSel: "ideas" }, clusterPanel("ideas"), { over: [toast("Cluster ideas created", "Undo")] });

const newAgent = () =>
  screen({ clusters: FOUR, overseer: true, clusterSel: "shop" }, clusterPanel("shop"), {
    over: [
      col(
        { name: "new-agent", label: "New agent", w: 320, gap: 12, pad: 16, radius: 16, fill: "card2", stroke: "line2", place: { x: 1098, y: 96 } },
        t("New agent in shop", 14.5, { weight: 700 }),
        segmented([["Executor", false, "term"], ["Overlord", true, "net"]], "role"),
        field("Runs in", "Claude Code, Sonnet 5.5, high", { glyph: "term" }),
        t("It writes only in shop's repository. Its name and machine are set for you and can be changed later.", 12, { color: "mute" }),
        row({ gap: 8, justify: "end" }, button(L, "Cancel", "ghost", null, "cancel"), button(L, "Create", "pri", null, "create-agent")),
      ),
    ],
  });

/** One column of the Runs in picker: a heading and its options, the chosen one marked. */
const pickCol = (title, items, w) =>
  col(
    { name: `pick-${slug(title)}`, label: title, w, gap: 2, pad: [10, 8] },
    t(title, 11, { color: "mute", upper: true, track: 0.08 }),
    ...items.map(([value, on, note = null, off = false]) =>
      row(
        { name: `pick-${slug(value)}`, label: value, gap: 8, pad: [8, 10], radius: 9, fill: on ? "accSoft" : undefined, opacity: off ? 0.5 : undefined },
        col({ grow: 1, gap: 1 }, t(value, 13, { weight: on ? 700 : 500, color: on ? "acc" : "text" }), note ? t(note, 11, { color: "mute" }) : null),
        on ? ic("check", 13, "acc") : null,
      ),
    ),
  );

/** The Runs in picker opened from New agent: agent, model and effort side by side, with each agent's quota. */
const runsInPicker = (lyra = false) =>
  col(
    { name: "runs-in", label: "Runs in", w: 560, radius: 16, fill: "card2", stroke: "line2", place: { x: 858, y: 250 } },
    row(
      { gap: 0, align: "start" },
      pickCol("Agent", [["Claude Code", !lyra, "62% of the week left"], ["Codex", false, "79% of the week left"], ["Cursor", false, "Grok quota: 40% left"], ["Lyra", lyra, "On this machine, no quota"]], 200),
      box({ w: 1, h: 230, fill: "line" }),
      lyra
        ? pickCol("Model", [["Qwen 3.5 4B", false, "Light, runs on 16 GB"], ["Qwen 3.5 9B", true, "Complete, more capable"]], 180)
        : pickCol("Model", [["Opus 5.5", false, "Deepest, slowest"], ["Sonnet 5.5", true, "Balanced"], ["Haiku 5.5", false, "Fastest"]], 180),
      box({ w: 1, h: 230, fill: "line" }),
      lyra
        ? pickCol("Mode", [["Fast", false, "Brief, no thinking"], ["Normal", false, "Fuller, no thinking"], ["Thinking", true, "Thinks and checks"]], 170)
        : pickCol("Effort", [["Low", false], ["Medium", false], ["High", true], ["Max", false]], 170),
    ),
    row(
      { gap: 10, pad: [10, 14], edge: { side: "top", color: "line" } },
      tick(false),
      t("Use for new agents from now on", 12.5, { color: "body" }),
      fill(),
      t(lyra ? "Lyra, Qwen 3.5 9B, Thinking" : "Claude Code, Sonnet 5.5, high", 12, { weight: 700, color: "acc" }),
    ),
  );

const pickRunsIn = (lyra = false) => () =>
  screen({ clusters: FOUR, overseer: true, clusterSel: "shop" }, clusterPanel("shop"), {
    over: [
      col(
        { name: "new-agent", label: "New agent", w: 320, gap: 12, pad: 16, radius: 16, fill: "card2", stroke: "line2", place: { x: 1098, y: 96 } },
        t("New agent in shop", 14.5, { weight: 700 }),
        segmented([["Executor", true, "term"], ["Overlord", false, "net"]], "role"),
        field("Runs in", lyra ? "Lyra, Qwen 3.5 9B, Thinking" : "Claude Code, Sonnet 5.5, high", { glyph: "term" }),
        t("It writes only in shop's repository. Its name and machine are set for you and can be changed later.", 12, { color: "mute" }),
        row({ gap: 8, justify: "end" }, button(L, "Cancel", "ghost", null, "cancel"), button(L, "Create", "pri", null, "create-agent")),
      ),
      runsInPicker(lyra),
    ],
  });

const team = () =>
  screen(
    { clusters: FOUR, overseer: true, team: true, clusterSel: "shop" },
    clusterPanel("shop", {
      units: "overlord-shop leads executor-shop and executor-shop-2",
      convo: [message(L, { who: "You", when: "11:02", body: "The cart needs an empty state, as drawn on the Cart board.", me: true }), message(L, { who: "overlord-shop", when: "11:03", body: "Plan ready: executor-shop builds the page, executor-shop-2 the API, I review. Run it?" })],
    }),
  );

/** A plan inside the chat, as Cursor shows one: each task says who does it and in what, edited in place, run from here. */
function planBlock({ states = null, problem = null } = {}) {
  const tasks = [
    ["Empty state on the cart page", "executor-shop", "Cursor, Grok 4.7, xhigh"],
    ["The cart API answers an empty cart", "executor-shop-2", "Codex, GPT-5.5, high"],
    ["Review both against the board", "overlord-shop", "Claude Code, Sonnet 5.5, high"],
  ];
  const icon = (st) =>
    st === "done" ? stack({ w: 18, h: 18 }, box({ w: 18, h: 18, radius: "pill", fill: "acc", place: { x: 0, y: 0 } }), centered(ic("check", 12, "accInk")))
      : st === "busy" ? spinner(18)
        : st === "stuck" ? ic("alert", 17, "wait")
          : box({ w: 18, h: 18, radius: "pill", stroke: "line2", strokeWidth: 2 });
  return col(
    { name: "plan", label: "Plan", gap: 10, pad: [12, 14], radius: 14, fill: problem ? "waitSoft" : "card", stroke: problem ? "wait" : "line" },
    row({ gap: 8 }, ic("list", 15, problem ? "wait" : "acc"), t("Plan: cart empty state", 13.5, { weight: 700 }), fill(), branch("cart-empty")),
    ...tasks.map(([title, who, agent], i) =>
      row(
        { name: `task-${i + 1}`, label: title, gap: 10, align: "start" },
        states ? icon(states[i][0]) : t(`${i + 1}`, 12.5, { weight: 700, color: "mute" }),
        col({ grow: 1, gap: 3 }, t(title, 13, { color: "text" }), row({ gap: 6 }, mono(who, 11, { color: "mute" }), t(agent, 11, { color: "mute" }), states ? null : ic("chevron", 12, "mute"))),
        states && states[i][1] ? t(states[i][1], 11.5, { color: states[i][0] === "stuck" ? "wait" : "mute" }) : null,
      ),
    ),
    problem ? t(problem, 12.5, { color: "body" }) : null,
    !states
      ? row({ gap: 6 }, button(L, "Run", "pri", "play", "run-plan"), button(L, "Edit", "plain", "pen", "edit-plan"), t("Who does each task can be changed", 11.5, { color: "mute" }))
      : problem
        ? row({ gap: 6 }, button(L, "Stop the step", "pri", "stop", "stop-step"), button(L, "Retry the task", "plain", "retry", "retry-task"))
        : row({ gap: 6 }, button(L, "Stop", "ghost", "stop", "stop-plan"), t("Each task is committed on cart-empty", 11.5, { color: "mute" })),
  );
}

const ASK_CART = () => message(L, { who: "You", when: "11:02", body: "The cart needs an empty state, as drawn on the Cart board.", me: true });
const teamScreen = (convo, waiting = 0) =>
  screen({ clusters: FOUR, overseer: true, team: true, clusterSel: "shop" }, clusterPanel("shop", { units: "overlord-shop leads executor-shop and executor-shop-2", convo }), { waiting });

const planReady = () => teamScreen([ASK_CART(), planBlock()]);
const planRuns = () => teamScreen([ASK_CART(), planBlock({ states: [["done", "11:09"], ["busy", "4 min"], ["todo"]] }), message(L, { who: "overlord-shop", when: "11:09", body: "Task 1 done and committed. executor-shop-2 is on task 2." })]);
const planStuck = () =>
  teamScreen([ASK_CART(), planBlock({ states: [["done", "11:09"], ["stuck", "14 min"], ["todo"]], problem: "executor-shop-2 has shown no progress for 10 minutes. Its changes are kept; overlord-shop was told first." })], 1);

// ---- row 3: the Overseer and its context -------------------------------------------------------------------

const overseerPanel = (full) =>
  panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, { glyph: "crown", title: "overseer", sub: row({ gap: 6 }, dot("idle"), t("Starts fresh every session", 12.5, { color: "mute" })), right: [ibtn(L, "dots", "more", "More")] }),
    col(
      { name: "context", label: "Context", gap: 6, pad: [12, 16], edge: { side: "bottom", color: "line" } },
      row({ gap: 8 }, t("Context", 12, { color: "mute" }), fill(), t(full ? "82% full" : "18% full", 12, { color: full ? "wait" : "mute" })),
      stack({ w: 334, h: 6 }, box({ w: 334, h: 6, radius: "pill", fill: "card2", place: { x: 0, y: 0 } }), box({ w: full ? 274 : 60, h: 6, radius: "pill", fill: full ? "wait" : "acc", place: { x: 0, y: 0 } })),
    ),
    conversation(
      L,
      message(L, { who: "You", when: "12:10", body: "Where are we with the launch?", me: true }),
      message(L, { who: "overseer", when: "12:10", body: "shop: the cart is half done. blog: the post waits for your review. api-gateway: 1 commit to push on feat/auth." }),
      full
        ? col(
            { name: "context-full", label: "Context filling", gap: 8, pad: [12, 14], radius: 14, fill: "waitSoft", stroke: "wait" },
            row({ gap: 8 }, ic("alert", 15, "wait"), t("My context is 82% full", 13.5, { weight: 700 }), fill(), ibtn(L, "x", "close-notice", "Close")),
            t("Answers get slower and less precise from here. Compact keeps a summary of this conversation; Clear starts empty and reads the M1ND again.", 12.5, { color: "body" }),
            row({ gap: 6 }, button(L, "Compact", "pri", null, "compact"), button(L, "Clear", "plain", null, "clear")),
          )
        : null,
    ),
    composer(L, "Message the Overseer", "Across every cluster", "bell"),
  );

const overseerChat = () => screen({ clusters: FOUR, overseer: true, team: true, sel: "overseer" }, overseerPanel(false));
const overseerFull = () => screen({ clusters: FOUR, overseer: true, team: true, sel: "overseer" }, overseerPanel(true), { waiting: 1 });

// ---- row 4: messages, the inbox and the work ------------------------------------------------------------------

/** An agent's inspector with two tabs: Chat holds the messages, Work holds what the session does. */
function agentPanel(tab) {
  const work = tab === "work";
  const step = (when, value, state = "done", detail = null) =>
    row(
      { name: `step-${slug(value)}`, label: value, gap: 10, pad: [6, 2], align: "start" },
      mono(when, 11.5, { color: "mute" }),
      state === "busy" ? spinner(13) : ic("check", 13, "mute"),
      col({ grow: 1, gap: 2 }, t(value, 12.5, { color: "text" }), detail ? t(detail, 11.5, { color: "mute" }) : null),
    );
  return panel(
    L, "left", { name: "inspector", label: "Inspector", w: 366 },
    inspectorHead(L, { glyph: "term", title: "executor-shop", sub: row({ gap: 6 }, spinner(10), t("Working on the cart", 12.5, { color: "mute" })), right: [ibtn(L, "dots", "more", "More")] }),
    tabs(L, [["Chat", "comment", !work, "tab-chat"], ["Work", "list", work, "tab-work"]]),
    work
      ? conversation(
          L,
          t("What the session is doing, step by step. Nothing here is a message.", 12, { color: "mute" }),
          col(
            { gap: 0 },
            step("11:04", "Read the Cart board and the cart page"),
            step("11:06", "Edited 3 files", "done", "web/cart.tsx, web/cart.css, api/cart.ts"),
            step("11:09", "Committed a41c2e0 on cart-empty"),
            step("11:10", "Running npm test", "busy", "2 min"),
          ),
          row({ gap: 6 }, button(L, "Stop the step", "ghost", "stop", "stop-step"), t("The full transcript opens from More", 11.5, { color: "mute" })),
        )
      : conversation(
          L,
          row(
            { name: "started-with", label: "Started with", gap: 8, pad: [8, 12], radius: 12, fill: "card" },
            ic("task", 14, "mute"),
            col({ grow: 1, gap: 2 }, t("Started with", 12, { weight: 700, color: "body" }), t("Executor of shop, the M1ND, and the task Cart empty state", 12, { color: "mute" })),
            ic("chevron", 13, "mute"),
          ),
          message(L, { who: "overlord-shop", when: "11:03", body: "Task 1 is yours: the empty state on the cart page, as on the Cart board." }),
          message(L, { who: "You", when: "11:05", body: "Use the illustration from the board, not an icon.", me: true }),
          message(L, { who: "executor-shop", when: "11:06", body: "Understood, the board's illustration. Working on it." }),
        ),
    composer(L, "Message executor-shop", "It reads your message at its next step", "bell"),
  );
}

const unreadSide = () =>
  panel(
    L, "right", { name: "side", label: "Side panel", w: 290 },
    tabs(L, [["Hierarchy", "net", true, "tab-hierarchy"], ["Chats", "users", false, "tab-chats"]]),
    search(L),
    col(
      { name: "hierarchy", label: "Hierarchy", pad: [0, 6, 10] },
      unitRow(L, { id: "overseer", glyph: "crown", status: "idle", sub: "Above every cluster" }),
      row({ pad: [12, 8, 6] }, t("Clusters", 11.5, { color: "mute", upper: true, track: 0.08 }), fill()),
      row({ gap: 8, pad: [6, 8] }, ic("chevron", 13, "mute"), ic("folder", 15, "body"), t("shop", 13.5, { weight: 600 }), fill(), mono("main", 11, { color: "mute" })),
      ...[["overlord-shop", "net", 1, null], ["executor-shop", "term", 2, null], ["executor-shop-2", "term", 2, "2"]].map(([id, glyph, level, unread]) =>
        row(
          { name: `row-${id}`, label: id, gap: 8, pad: [6, 8, 6, level === 1 ? 24 : 42], radius: 7, fill: id === "executor-shop" ? "accSoft" : undefined },
          ic(glyph, 15, "body"),
          mono(id, 12.5, { color: "text" }),
          fill(),
          unread ? row({ name: `unread-${id}`, label: `${unread} unread`, pad: [1, 7], radius: "pill", fill: "acc" }, t(unread, 11, { weight: 700, color: "accInk" })) : null,
        ),
      ),
    ),
  );

const chatTab = () => shell(body3(unreadSide(), theMap({ clusters: FOUR, overseer: true, team: true, clusterSel: "shop", sel: "executor-shop" }), agentPanel("chat")));
const workTab = () => shell(body3(unreadSide(), theMap({ clusters: FOUR, overseer: true, team: true, clusterSel: "shop", sel: "executor-shop" }), agentPanel("work")));

// ---- the board ---------------------------------------------------------------------------------------------

const ROWS = [
  ["first", "First run", [
    ["repos-found", "Repositories found", reposFound, "The Map starts empty and moves in X and Y. Repositories found on the machine are offered, never imported on their own, grouped by the folder that holds them, with a filter. Each folder becomes a cluster linked to it, with its repositories as clusters inside; worktrees stay inside their repository."],
    ["overseer", "Create your Overseer", createOverseer, "The first prompt creates the Overseer, the agent above every cluster. It runs in an external agent, Claude Code, Codex or Cursor with the person's own account, or in a local model through Lyra when its service runs on the machine: free, private and without quota. Runs in opens the picker of 2.4, or of 2.5 for Lyra. By default it starts fresh in each session; the person can keep its context instead."],
    ["overview", "All clusters", overview, "Zoomed out, the whole Map fits: the Overseer at the center, each folder cluster with every repository in it. However large the graph grows, zooming out shows all of it. Hierarchy holds the same tree, and a double click on a cluster there or on the Map flies to it. The person's own preferences live in Settings, not on the Map."],
    ["inside", "Zoomed in on a cluster", inside, "The same Map, zoomed in on Web: its repositories at full size, shop selected with its branch and changes. Zooming out goes back to the whole graph. Agents can sit in a folder cluster, as an Overlord over its repositories, or in one repository."],
  ]],
  ["clusters", "Clusters and agents", [
    ["new-cluster", "New cluster", newCluster, "A cluster is the one way to group agents. Linked to a repository or a folder, that is where its agents may write; linked to nothing, it is only a grouping."],
    ["no-link", "A cluster with no link", noLink, "Its agents can talk and plan, but have nowhere to write until a folder is linked."],
    ["new-agent", "New agent", newAgent, "Inside a cluster: Executor or Overlord, and what it runs in, agent, model and effort in one list. It writes only where its cluster is linked; name and machine are set for it."],
    ["runs-in", "Agent, model and effort", pickRunsIn(false), "Runs in opens one picker with three columns: the agents connected on this machine, each with the quota it has left, the models of the chosen agent, and the effort. Only connected agents are listed; Lyra appears when its service runs on the machine. The choice can become the default for new agents."],
    ["runs-in-lyra", "Lyra as the agent", pickRunsIn(true), "Lyra is one more agent for any role, Overseer, Overlord or Executor, through its local service, the same one its command line uses. Its models are the ones Lyra installed, and its modes, Fast, Normal and Thinking, take the place of effort. Free, private and without quota; slower and less capable than the cloud models."],
    ["team", "A team in a cluster", team, "With an Overlord, the cluster's chat goes to it: it makes the plan in the chat and gives each task to an Executor."],
    ["plan", "The plan in the chat", planReady, "The lead answers with a plan inside the chat, as Cursor does: each task says who does it and in what agent, model and effort, all changeable in place. Run starts it on its own branch. With no Overlord, the Executor plans for itself; agents of a cluster with no lead ask the person who plans. Only the lead opens the others' sessions; no agent opens another."],
    ["running", "The plan runs", planRuns, "The same plan shows each task's state and time; each task is committed on the plan's branch. Every agent confirms that it started within 3 minutes and reports each step, which the Work tab shows."],
    ["stuck", "The plan needs you", planStuck, "No start within 3 minutes, no progress for 10 (30 while planning), or a message unread for 10 turn the plan into a warning with Stop and Retry; it also waits in Waiting. The lead is told first, then the Overseer, then the person. The plan sets the message budget, one per task, with extensions agreed and logged up to half the plan; past that the person is asked."],
  ]],
  ["overseer", "The Overseer", [
    ["chat", "Across every cluster", overseerChat, "The Overseer answers across clusters and hands work to each cluster's lead. Its context bar shows how full its conversation is."],
    ["full", "Its context is filling", overseerFull, "Before the context runs out it says so, with Start fresh, which keeps a summary and reads the M1ND again, or Keep going."],
  ]],
  ["messages", "Messages, the inbox and the work", [
    ["chat", "The chat is messages", chatTab, "What an agent starts with, its role, the M1ND and its task, is one folded line at the top, not a message. The chat holds only messages: what the person and the agents write to each other, kept even when the session closes. The inbox is not another place: it is the messages not read yet, counted beside the agent in Hierarchy and on the Map."],
    ["work", "The work is apart", workTab, "What the session does, reading, editing, running, committing, opens in Work, step by step, never in the chat. The full transcript opens from More."],
  ]],
];

const STEP_X = 1440 + 160;
const STEP_Y = 900 + 360;

const screens = [];
ROWS.forEach(([key, part, list], r) => {
  list.forEach(([id, title, root, note], i) => screens.push({ id: `${key}-${id}`, title: `${r + 1}.${i + 1} ${part}: ${title}`, x: i * STEP_X, y: r * STEP_Y, root, note }));
});

export default board({
  id: "hivem1nd-3-start",
  title: "HIVEM1ND 3.0: start working",
  note:
    "From the owner's sketch: the person at the center of the Map, everything empty at first, repositories offered and imported as clusters, a cluster linked to a repository, a folder or nothing, " +
    "agents created inside clusters, and the Overseer created first, fresh in each session. A separate board from the 3.0 screen flow. The sample is invented.",
  screens,
  links: ROWS.flatMap(([key, , list]) => list.slice(1).map(([id, title], i) => ({ from: `${key}-${list[i][0]}`, to: `${key}-${id}`, label: title }))),
});
