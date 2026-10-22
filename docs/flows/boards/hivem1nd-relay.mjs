// HIVEM1ND 3.0, Relay LAN and Relay+: the setup and Settings screens of the two transports 3.0.0 adds, drawn
// from the design of 2026-10-22 for the owner to approve before any GUI code is written. Each machine keeps its
// own copy of the M1ND in a local folder and works offline; a transport only carries the changes. ReLAN carries
// them over the local network with no account: machines find each other, any of them hosts, hosting moves on by
// itself when the host leaves, and Host here moves it on demand. Relay+ carries them through the Cosmic account,
// for Dawn members first. Both can run at once. Setup and Settings are the ones of the 3.0 screen flow
// (hivem1nd-3-flow.mjs), in Modern. A separate board from that flow. The sample is invented.

import { board } from "blueprint/board.mjs";
import { box, col, row, stack, icon, vector, space, fill, ELLIPSE } from "blueprint/kit.mjs";
import { LOOKS, FAMILY, t, mono, ic, mark, dot, circle, centered, avatar, button, bar, code, tick } from "../kit/h3.mjs";

const L = LOOKS[0];
const ERR = "#e58e7c";
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// A glyph of the shared kit set, for the few the 3.0 set lacks; drawn with the same stroke as `ic`.
const glyph = (name, size = 16, color = "body") => icon(name, { size, color, stroke: 1.7 });

const LOCAL = "C:\\Users\\you\\Cosmic\\M1ND";
const RELAY_PLUS = "Sync this M1ND between computers anywhere through your Cosmic account. Included with Dawn.";
const MIND_SUB = "The M1ND holds the units, chats, boards and texts. Each machine keeps its own copy in a local folder and works offline; Relay keeps the copies in sync.";

// The machines of the sample network. DESKTOP is this machine.
const MACHINES = { DESKTOP: "desk", LAPTOP: "lap", OFFICE: "desk" };

// ---- feedback: spinners, notices, dialogs ---------------------------------------------------------

const ARC = "M50 4 A46 46 0 1 1 4 50";
const spinner = (s = 14, color = "acc") =>
  stack({ w: s, h: s }, vector({ w: s, h: s, d: ELLIPSE, stroke: "line2", strokeWidth: 2 }), vector({ w: s, h: s, d: ARC, stroke: color, strokeWidth: 2 }));

/** A pressed button: the label says what is happening and a spinner turns in place of the icon. */
const busy = (label) =>
  row(
    { name: `busy-${slug(label)}`, label, gap: 7, pad: [7, 12], radius: 10, fill: "acc", opacity: 0.88 },
    spinner(13, "accInk"),
    t(label, 12.5, { weight: 600, color: "accInk" }),
  );

const scrim = () => box({ w: 1440, h: 900, fill: "rgba(4,2,6,0.62)", place: { x: 0, y: 0 } });

function dialog({ title, sub = null, kids = [], actions = [], w = 480, name = "dialog" }) {
  return col(
    { name, label: title, w, pad: 24, gap: 18, radius: 22, fill: "panel", stroke: "line2", place: "center" },
    col({ gap: 6 }, t(title, 18, { weight: 700 }), sub ? t(sub, 13.5, { color: "mute" }) : null),
    ...kids,
    row({ gap: 8, justify: "end" }, ...actions),
  );
}

function toast(msg, glyphName = "check") {
  return row(
    { name: "toast", label: "Notice", gap: 10, pad: [11, 16], radius: 14, fill: "text", place: "bottom-center", dy: -46 },
    ic(glyphName, 15, "bg"),
    t(msg, 13, { weight: 700, color: "bg" }),
  );
}

/** A bar that fills as work goes on, at a fixed width so the share it shows is exact. */
const progress = (share, w, h = 8) =>
  stack({ w, h }, box({ w, h, radius: "pill", fill: "card2", place: { x: 0, y: 0 } }), box({ w: Math.max(h / 2, Math.round(w * share)), h, radius: "pill", fill: "acc", place: { x: 0, y: 0 } }));

/** The pairing code typed in six boxes. The first empty box holds the caret; a wrong code edges every box. */
function codeBoxes(value, error = false) {
  const caret = value.indexOf(" ");
  return row(
    { name: "code", label: "Pairing code", gap: 8, justify: "center" },
    ...value.split("").map((c, i) =>
      stack(
        { w: 44, h: 54, radius: 12, fill: "card", stroke: error ? ERR : c.trim() ? "acc" : "line2" },
        c.trim() ? centered(mono(c, 22, { weight: 700 })) : i === caret ? centered(box({ w: 2, h: 24, fill: "acc" })) : null,
      ),
    ),
  );
}

// ---- setup ----------------------------------------------------------------------------------------

const SETUP_STEPS = 4;

function setup(step, title, sub, kids, { back = true, cancel = false, next = "Continue", nextBusy = false } = {}) {
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
        row(
          { gap: 10 },
          cancel ? button(L, "Cancel", "ghost", null, "cancel") : back ? button(L, "Back", "ghost", "back", "back") : null,
          fill(),
          nextBusy ? busy(next) : button(L, next, "pri", null, "continue"),
        ),
      ),
    );
}

const pathRow = (value) =>
  row({ name: "path", label: "Folder", gap: 10, pad: [10, 10, 10, 14], radius: 12, fill: "card", stroke: "line2" }, ic("folder", 16, "mute"), mono(value, 13, { color: "text" }), fill(), button(L, "Change", "plain", null, "change-folder"));
const label = (value) => t(value, 12.5, { weight: 600, color: "mute" });
const folder = () => col({ gap: 8 }, label("Folder"), pathRow(LOCAL));
const tile = (name, color = "acc", ground = "panel") => stack({ w: 30, h: 30, radius: 9, fill: ground }, centered(ic(name, 16, color)));

/** The M1ND heard on the network. It leads the step, since joining it takes the place of making a new one. */
const found = () =>
  row(
    { name: "relan-found", label: "M1ND found on this network", gap: 12, pad: [12, 14], radius: 14, fill: "accSoft", stroke: "acc" },
    tile("wifi"),
    col({ grow: 1, gap: 3 }, t("M1ND found on this network", 14, { weight: 700 }), t("Hosted by LAPTOP. Joining copies it here over the LAN and keeps both in sync.", 12.5, { color: "body" })),
    button(L, "Join", "pri", null, "join"),
  );

/** A choice offered in setup: ticked when setup does it by itself, or with the action that starts it. */
const offer = (name, title, body, { on = false, glyphName = null, action = null, badge = null } = {}) =>
  row(
    { name, label: title, gap: 12, pad: [12, 14], radius: 14, fill: glyphName ? "card" : "waitSoft", stroke: glyphName ? "line2" : undefined, align: "start" },
    glyphName ? tile(glyphName, "body") : row({ pad: [1, 0, 0] }, tick(on, 18)),
    col(
      { grow: 1, gap: 3 },
      row({ gap: 8 }, t(title, 14, { weight: 700 }), badge),
      t(body, 12.5, { color: "body" }),
      action ? row({ pad: [6, 0, 0] }, action) : null,
    ),
  );

const legacy = () =>
  offer("legacy", "Migrate legacy M1ND", "A HIVEM1ND 2.x M1ND was found in C:\\Users\\you\\OneDrive\\HIVEM1ND. It is copied and upgraded; the original stays untouched.", { on: true });

const setupMind = setup(2, "Where the M1ND lives", MIND_SUB, [
  folder(),
  found(),
  legacy(),
  offer("relay-plus", "Use Relay+", RELAY_PLUS, { glyphName: "cloud", action: button(L, "Sign in with Cosmic account", "plain", null, "sign-in-cosmic") }),
]);

/** A dialog over step 2, which stays visible under the scrim so the person knows where it returns. */
const overMind = (node) => () => stack({ w: 1440, h: 900, fill: "bg", theme: L.theme }, setupMind(), scrim(), node);

// Join stays off until the six characters are typed: a short code cannot be right, and a try costs an attempt.
const setupJoin = (error) =>
  overMind(
    dialog({
      title: "Join the M1ND hosted by LAPTOP",
      sub: "Type the 6-character code shown on LAPTOP. It pairs this machine once; after that it joins by itself.",
      kids: [
        row({ gap: 10, pad: [10, 12], radius: 12, fill: "card" }, ic("lap", 15, "acc"), t("Open HIVEM1ND on LAPTOP: Settings, General, Relay network, Add a machine.", 13, { color: "body" })),
        codeBoxes(error ? "7KX4QN" : "7KX4  ", error),
        error
          ? row({ gap: 6, justify: "center" }, ic("alert", 13, ERR), t("The code is not valid or has expired. 4 attempts left.", 12.5, { color: ERR }))
          : row({ justify: "center" }, t("Letters and digits; the code lasts 10 minutes.", 12, { color: "mute" })),
      ],
      actions: [button(L, "Cancel", "ghost", null, "cancel"), error ? button(L, "Join", "pri", null, "join-code") : { ...button(L, "Join", "pri", null, "join-code"), opacity: 0.45 }],
      w: 520,
    }),
  );

const COPIED = 1240;
const FILES = 3900;

// No Back while the copy runs: going back would leave a half copy. Cancel stops it and says what stays.
const setupCopying = setup(2, "Where the M1ND lives", `This machine joins the M1ND hosted by LAPTOP. Its own copy is made in ${LOCAL}, so it keeps working offline.`, [
  col(
    { name: "copy-progress", label: "Copying", gap: 12, pad: [16, 18], radius: 14, fill: "card" },
    row({ gap: 10 }, spinner(16), t("Copying the M1ND from LAPTOP over the LAN", 14, { weight: 700 }), fill(), t(`${Math.round((COPIED / FILES) * 100)}%`, 12.5, { color: "mute" })),
    progress(COPIED / FILES, 540),
    t(`${COPIED.toLocaleString("en-US")} of ${FILES.toLocaleString("en-US")} files`, 12.5, { color: "body" }),
  ),
  row({ gap: 10, pad: [0, 4] }, glyph("lock", 15, "acc"), t("Every change from now on travels over the LAN, encrypted with this network's key.", 13, { color: "body" })),
], { back: false, cancel: true, next: "Copying", nextBusy: true });

const setupSignIn = overMind(
  dialog({
    title: "Finish signing in in the browser",
    sub: "The Cosmic account page opened in the browser. Setup goes on by itself once the sign-in is done.",
    kids: [
      row(
        { name: "waiting-browser", label: "Waiting for the browser", gap: 12, pad: [14, 16], radius: 14, fill: "card" },
        spinner(18),
        col({ grow: 1, gap: 2 }, t("Waiting for the browser", 13.5, { weight: 700 }), t("The sign-in stays on this machine, never in the M1ND.", 12, { color: "mute" })),
      ),
    ],
    actions: [button(L, "Cancel", "ghost", null, "cancel")],
  }),
);

// The sign-in dialog closes by itself; the offer it came from turns ticked, so the step reads as before.
const setupSignedIn = setup(2, "Where the M1ND lives", MIND_SUB, [
  folder(),
  found(),
  legacy(),
  row(
    { name: "relay-plus", label: "Use Relay+", gap: 12, pad: [12, 14], radius: 14, fill: "accSoft", stroke: "acc", align: "start" },
    row({ pad: [1, 0, 0] }, tick(true, 18)),
    col(
      { grow: 1, gap: 3 },
      row({ gap: 8 }, t("Use Relay+", 14, { weight: 700 }), row({ gap: 5, pad: [2, 8], radius: "pill", fill: "panel" }, dot("work", 7), t("Signed in", 11, { weight: 700, color: "body" }))),
      t("Signed in as alex. Plan Dawn, Relay+ included.", 12.5, { color: "body" }),
    ),
    avatar(L, "person", 30, 15),
  ),
]);

// ---- the window -----------------------------------------------------------------------------------

/** The status line, with the machines of the Relay network on its right, each online or offline. */
function statusLine(offline = ["OFFICE"]) {
  const note = (value) => t(value, 12.5, { color: "mute" });
  return row(
    { name: "status", label: "Status line", h: 30, pad: [0, 22], justify: "between" },
    row({ gap: 7 }, dot("work"), note("Relay service running on DESKTOP")),
    note("M1ND synced 4 s ago"),
    row(
      { gap: 14 },
      ...Object.entries(MACHINES).map(([name, g]) => {
        const off = offline.includes(name);
        return row({ gap: 6, opacity: off ? 0.6 : undefined }, ic(g, 14, "mute"), note(name), dot(off ? "idle" : "work", 7));
      }),
    ),
  );
}

const shell = (body, { offline, over = [] } = {}) =>
  stack(
    { w: 1440, h: 900, fill: "bg", theme: L.theme },
    col({ w: 1440, h: 900, place: { x: 0, y: 0 } }, bar(L, "Settings", 0, { gear: true }), body, statusLine(offline)),
    ...over,
  );

// ---- settings -------------------------------------------------------------------------------------

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

const section = (title, kids, sub = null, name = undefined) =>
  col({ name, label: name ? title : undefined, gap: 12, pad: 20, radius: 18, fill: "panel", stroke: "line" }, row({ gap: 10 }, t(title, 15, { weight: 700 }), fill(), sub), ...kids);
const kv = (k, v) => row({ gap: 10 }, t(k, 13, { color: "mute" }), fill(), v);
const segment = (items) =>
  row({ gap: 4, pad: 4, radius: 12, fill: "card" }, ...items.map(([value, on]) => row({ grow: 1, justify: "center", pad: [8, 12], radius: 9, fill: on ? "card2" : undefined }, t(value, 13.5, { weight: 600, color: on ? "text" : "mute" }))));

/** Settings: the title and its sections as tabs. This board only draws General, where Relay lives. */
function settingsFrame(tab, ...kids) {
  const tabsRow = row(
    { name: "settings-tabs", label: "Settings sections", gap: 4, pad: 4, radius: 12, fill: "panel", stroke: "line" },
    ...[["general", "General", "settings"], ["agents", "Agents", "term"], ["permissions", "Permissions", "hand"], ["projects", "Projects", "folder"], ["content", "Content", "grid"]].map(([id, value, g]) =>
      row({ name: `settings-${id}`, label: value, gap: 7, pad: [7, 14], radius: 9, fill: tab === id ? "card2" : undefined }, ic(g, 15, tab === id ? "text" : "mute"), t(value, 13.5, { weight: 600, color: tab === id ? "text" : "mute" })),
    ),
  );
  const machine = row(
    { name: "settings-machine", label: "Machine", gap: 8, pad: [8, 12], radius: 12, fill: "panel", stroke: "line" },
    ic("desk", 15, "text"), t("DESKTOP, this machine", 13.5, { weight: 600 }), ic("chevron", 14, "mute"),
  );
  return col({ h: 818, gap: 16, pad: [8, 120] }, row({ gap: 18 }, t("Settings", 22, { weight: 700 }), tabsRow, fill(), machine), ...kids);
}

// Restart moves into the card's header so the card keeps its facts and still leaves room for the network below.
const serviceSection = () =>
  section("Relay service", [
    kv("State", row({ gap: 6 }, dot("work"), t("Running on DESKTOP", 13))),
    kv("Version", t("3.0.0", 13)),
    kv("Started", t("Today 08:12", 13)),
    kv("Start with Windows", row({ gap: 6 }, tick(false), t("Off", 13, { color: "mute" }))),
  ], button(L, "Restart service", "plain", "retry", "restart"));

const badge = (value, on) =>
  row({ gap: 4, pad: [2, 8], radius: "pill", fill: on ? "accSoft" : "card2" }, on ? ic("crown", 11, "acc") : null, t(value, 11, { weight: 700, color: on ? "acc" : "mute" }));

/** One machine of the network, with when it was last seen. An offline one is dimmed but stays listed. */
const machineRow = ([name, seen, off = false]) =>
  row(
    { name: `machine-${slug(name)}`, label: name, gap: 10, pad: [9, 12], radius: 12, fill: "card", opacity: off ? 0.6 : undefined },
    ic(MACHINES[name], 15, "body"),
    t(name, 13.5, { weight: 700 }),
    fill(),
    dot(off ? "idle" : "work", 7),
    t(seen, 12, { color: "mute" }),
  );

// Each state of this machine on the network: hosting, a member of another host, and hosting again after the
// host left. Machines are listed host first.
const NETWORK = {
  host: {
    state: "Hosting on DESKTOP",
    host: true,
    count: "3 machines, 1 offline",
    machines: [["DESKTOP", "This machine, host"], ["LAPTOP", "Last seen 4 s ago"], ["OFFICE", "Offline, 2 h ago", true]],
    note: "Machines on this network find each other by themselves. Changes travel encrypted with the network's key; another device on the same Wi-Fi reads nothing.",
  },
  member: {
    state: "Member. LAPTOP is hosting.",
    host: false,
    count: "3 machines, 1 offline",
    machines: [["LAPTOP", "Host, last seen 2 s ago"], ["DESKTOP", "This machine"], ["OFFICE", "Offline, 2 h ago", true]],
    note: "If LAPTOP leaves, the next machine hosts by itself. Host here moves hosting to DESKTOP now.",
  },
  moved: {
    state: "Hosting on DESKTOP",
    host: true,
    count: "3 machines, 2 offline",
    // No note here: the notice says what happened, and the card keeps clear of it.
    machines: [["DESKTOP", "This machine, host"], ["LAPTOP", "Offline, 12 s ago", true], ["OFFICE", "Offline, 2 h ago", true]],
  },
};

/** The Relay network: who hosts, every machine with when it was last seen, and what this machine can do. */
function networkSection(key) {
  const n = NETWORK[key];
  return section(
    "Relay network",
    [
      row(
        { name: "network-state", label: n.state, gap: 10 },
        tile(n.host ? "crown" : "wifi", n.host ? "acc" : "body", "card"),
        t(n.state, 14, { weight: 700 }),
        badge(n.host ? "Host" : "Member", n.host),
      ),
      col({ name: "machines", label: "Machines", gap: 6 }, ...n.machines.map(machineRow)),
      n.note ? t(n.note, 12, { color: "mute" }) : null,
      row(
        { gap: 8 },
        button(L, "Add a machine", "pri", "plus", "add-machine"),
        n.host ? null : button(L, "Host here", "plain", "crown", "host-here"),
        fill(),
        button(L, "Leave", "ghost", null, "leave"),
      ),
    ],
    t(n.count, 12, { color: "mute" }),
    "relay-network",
  );
}

const plusSignedOut = () =>
  section("Relay+", [
    t(RELAY_PLUS, 13, { color: "body" }),
    row({}, button(L, "Sign in with Cosmic account", "plain", null, "sign-in-cosmic")),
  ], null, "relay-plus");

// Two facts a row: the signed-in card stays as short as the signed-out one, so the column fits the window.
const fact = (k, v) => col({ grow: 1, gap: 3 }, t(k, 11.5, { color: "mute" }), v);
const plusSignedIn = () =>
  section("Relay+", [
    row({ gap: 16, align: "start" }, fact("Account", row({ gap: 8 }, avatar(L, "person", 22, 12), t("alex", 13))), fact("Plan", t("Dawn, Relay+ included", 13))),
    row({ gap: 16, align: "start" }, fact("Devices", t("2 devices, DESKTOP and LAPTOP", 13)), fact("Usage", row({ gap: 10 }, progress(120 / 10240, 120, 6), t("120 MB of 10 GB", 13)))),
  ], row({ gap: 12 }, row({ gap: 6 }, dot("work", 7), t("Connected", 12, { color: "mute" })), button(L, "Sign out", "ghost", null, "sign-out")), "relay-plus");

// Locations, under Relay+ in the 3.0 flow, sits below the fold here: the two new cards take its room.
const general = (network, plus) =>
  settingsFrame(
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
      col({ grow: 1, gap: 16 }, serviceSection(), networkSection(network), plus === "in" ? plusSignedIn() : plusSignedOut()),
    ),
  );

const settingsHost = () => shell(general("host", "out"));
const settingsMember = () => shell(general("member", "in"));

const addMachine = () =>
  shell(general("host", "out"), {
    over: [
      scrim(),
      dialog({
        title: "Add a machine",
        sub: "Type this code on the other machine to pair it with this network.",
        kids: [
          col(
            { name: "pair-code", label: "Pairing code", gap: 6, pad: [18, 16], radius: 16, fill: "card", align: "center" },
            mono("7KX4QM", 40, { weight: 700, track: 0.16, color: "text" }),
            t("Valid until 18:42.", 12.5, { color: "mute" }),
          ),
          col(
            { gap: 8 },
            t("On the other machine: install HIVEM1ND and choose Join in setup, or run", 13, { color: "body" }),
            row({}, code("hivem1nd relan join 7KX4QM")),
          ),
        ],
        actions: [button(L, "Done", "pri", null, "done")],
        w: 520,
      }),
    ],
  });

const hostHere = () =>
  shell(general("member", "in"), {
    over: [
      scrim(),
      dialog({
        title: "Host the M1ND on this machine?",
        sub: "LAPTOP stops hosting and stays a member. Nothing is copied again.",
        actions: [button(L, "Cancel", "ghost", null, "cancel"), button(L, "Host here", "pri", "crown", "confirm-host-here")],
      }),
    ],
  });

const hostMoved = () => shell(general("moved", "in"), { offline: ["LAPTOP", "OFFICE"], over: [toast("LAPTOP left the network. DESKTOP is hosting now.", "crown")] });

// ---- the board ------------------------------------------------------------------------------------

const ROWS = [
  ["setup", "Setup", [
    ["mind", "Where the M1ND lives", setupMind, "The folder defaults to a local one, since each machine keeps its own copy; when a ReLAN is heard on the network setup leads with Join, keeps Migrate legacy M1ND as today, and offers Relay+ with Sign in with Cosmic account instead of Coming soon."],
    ["join", "Join the M1ND on this network", setupJoin(false), "Join asks for the 6-character code shown on the hosting machine, which pairs this machine once; Join stays off until all six characters are typed."],
    ["join-error", "A wrong code", setupJoin(true), "A wrong or expired code says so with the attempts left, and five wrong codes lock pairing for 10 minutes."],
    ["copying", "Copying over the LAN", setupCopying, "The first join copies the whole M1ND from the host into this machine's own folder, and every change after it travels over the LAN, encrypted with the network's key."],
    ["sign-in", "Sign in to Relay+", setupSignIn, "Sign in with Cosmic account opens the Cosmic sign-in in the browser and waits for it with Cancel; the tokens stay on this machine, never in the M1ND."],
    ["signed-in", "Signed in", setupSignedIn, "The dialog closes by itself and the Relay+ offer turns ticked with the account and its plan, next to Join, since Relay+ and the LAN network work together."],
  ]],
  ["settings", "Settings, General", [
    ["host", "Hosting", settingsHost, "The Relay service card keeps its facts with Restart in its header, and under it the Relay network card says who hosts, lists every machine with when it was last seen and offers Add a machine and Leave, above Relay+ signed out."],
    ["member", "A member", settingsMember, "On a member the card names the host and adds Host here beside Add a machine, and Relay+ signed in shows the account, the plan, the devices and the usage with Sign out."],
    ["add-machine", "Add a machine", addMachine, "Add a machine shows a code that pairs one machine and lasts 10 minutes, with both ways to use it: Join in setup, or the command line."],
    ["host-here", "Host here", hostHere, "Host here is the Overtake: it asks first, then this machine hosts at once while the previous host stays a member and nothing is copied again."],
    ["host-moved", "Hosting moved", hostMoved, "When the host leaves, the next machine hosts by itself after 10 seconds of silence and a notice says so, while the machine that left keeps working on its own copy and catches up when it is back."],
  ]],
];

const STEP_X = 1440 + 160;
const STEP_Y = 900 + 360;

const screens = [];
ROWS.forEach(([key, part, list], r) => {
  list.forEach(([id, title, root, note], i) => screens.push({ id: `${key}-${id}`, title: `${r + 1}.${i + 1} ${part}: ${title}`, x: i * STEP_X, y: r * STEP_Y, root, note }));
});

export default board({
  id: "hivem1nd-relay",
  title: "HIVEM1ND 3.0: Relay LAN and Relay+",
  note:
    "The setup and Settings screens of ReLAN, the transport over the local network with no account, and Relay+, the transport through the Cosmic account, for the owner to approve before the GUI is built. " +
    "Each machine keeps its own copy of the M1ND; any machine can host, and hosting moves when the host leaves or with Host here. The sample is invented.",
  screens,
  links: [
    { from: "setup-mind", to: "setup-join", at: "join", label: "Join" },
    { from: "setup-join", to: "setup-join-error", label: "A wrong code" },
    { from: "setup-join", to: "setup-copying", at: "join-code", label: "The code is right" },
    { from: "setup-mind", to: "setup-sign-in", at: "sign-in-cosmic", label: "Sign in with Cosmic account" },
    { from: "setup-sign-in", to: "setup-signed-in", label: "Signed in" },
    { from: "settings-host", to: "settings-add-machine", at: "add-machine", label: "Add a machine" },
    { from: "settings-member", to: "settings-host-here", at: "host-here", label: "Host here" },
    { from: "settings-member", to: "settings-host-moved", label: "LAPTOP leaves" },
  ],
});
