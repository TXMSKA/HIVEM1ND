// Void, the text editor and viewer base (approved prototype v5 of user/tools/void-text-reader).
// Pure black ground, one centered text column, compact rails. HIVEM1ND serves it as a standalone
// local page; other hosts embed the same base and add their own context through two named slots.
// Sizes follow reader.html: rails 56 wide, the left rail widens to 272 over the text, pill radii.

import { board } from "blueprint/board.mjs";
import { box, col, row, stack, text, icon, space, fill } from "blueprint/kit.mjs";
import { action, seg, popover, menuRow, dot, vr, hr } from "blueprint/ui.mjs";

const W = 1440;
const H = 900;
const RAIL = 56;
const WIDE = 272;

const slug = (value) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// ---- sample content: an invented game, English and Spanish ---------------

const LANG = { en: "English", es: "Spanish" };

const LANTERN = {
  key: "quest.lantern.03",
  en: {
    title: "The Lantern Road",
    paras: [
      "Mara lights the first lantern at the edge of the marsh. The path ahead is quiet, and the old bridge holds only if you cross it slowly.",
      "Follow the lanterns north. Each one you light shows a little more of the road.",
    ],
  },
  es: {
    title: "El camino de los faroles",
    paras: [
      "Mara enciende el primer farol al borde del pantano. El camino es tranquilo, y el viejo puente solo resiste si lo cruzas despacio.",
      "Sigue los faroles hacia el norte. Cada uno que enciendas muestra un poco más del camino.",
    ],
  },
};

const SPACES = [
  ["QL", "Quest log", 10],
  ["UI", "UI strings", 48],
  ["HB", "Handbook", 9],
];

// [number, title, marks]: bm bookmark, cm open comments, ed edited, done approved.
const SECTIONS = [
  ["Marsh", [["01", "First light", { done: 1 }], ["02", "The old bridge", { ed: 1 }], ["03", "The Lantern Road", { on: 1, bm: 1, cm: 2, ed: 1 }], ["04", "Reeds and fog", { done: 1 }]]],
  ["Hills", [["05", "The signal fire"], ["06", "Shepherd's offer", { bm: 1, done: 1 }], ["07", "Cold wind"]]],
  ["Harbor", [["08", "Night ferry", { done: 1 }], ["09", "The lamp keeper"], ["10", "Salt and rope", { cm: 1 }]]],
];

const TABLE = [
  ["ui.menu.play", "Play", "Jugar"],
  ["ui.menu.continue", "Continue", "Continuar"],
  ["ui.menu.options", "Options", "Opciones"],
  ["ui.menu.quit", "Quit to desktop", "Salir al escritorio"],
  ["ui.menu.credits", "Credits", "Créditos"],
  ["ui.menu.save", "Save and exit", "Guardar y salir"],
];

// ---- text pieces ---------------------------------------------------------

const MARKS = {
  del: { fill: "delbg", color: "del" },
  ins: { fill: "addbg", color: "add" },
  sel: { fill: "done", color: "title" },
};

/** Inline runs on one line: strings, `{ del | ins | sel: "…" }` marks and `{ caret: true }`. */
function runs(parts, { size = 19, color = "text", weight = 400 } = {}) {
  const kids = parts.flatMap((part) => {
    if (typeof part === "string") {
      const body = part.trimStart();
      return [part.length > body.length ? space(Math.round(size * 0.27)) : null, body ? text(body, { size, color, weight }) : null];
    }
    if (part.caret) return box({ w: 2, h: Math.round(size * 1.4), radius: "pill", fill: "text" });
    const [kind, value] = Object.entries(part)[0];
    return row({ pad: [0, 3], radius: "xs", fill: MARKS[kind].fill }, text(value, { size, color: MARKS[kind].color, weight, strike: kind === "del" }));
  });
  return row({}, ...kids);
}

const heading = (value) => text(value, { size: 23, weight: 700, color: "title", align: "center" });
const para = (value) => text(value, { size: 19, lh: 1.8, color: "text" });
const line = (parts) => (typeof parts === "string" ? text(parts, { size: 19, lh: 1.8, color: "text" }) : runs(parts));
const langLabel = (code) => text(code.toUpperCase(), { size: 13, color: "mute", align: "center", track: 0.12 });

const pill = (approved) =>
  row(
    { w: approved ? 84 : 76, h: 22, gap: 6, radius: "pill", justify: "center", fill: approved ? "addbg" : "field", name: "page-status", label: "Page status" },
    dot(approved ? "add" : "warm", 6),
    text(approved ? "Approved" : "Pending", { size: 11, color: approved ? "add" : "soft" }),
  );

const keyRow = (key, mark) =>
  row({ justify: "center", gap: 12, h: 24, name: "page-key", label: "Page key" }, text(key, { size: 12, color: "dim", track: 0.02 }), mark);

/** One language column; `focus` gives the block being edited its panel. */
const langCol = (code, kids, focus = false) =>
  col(
    { w: 540, gap: 18, name: `lang-${code}`, label: `${LANG[code]} text` },
    langLabel(code),
    col({ gap: 14, pad: focus ? [8, 10] : undefined, radius: 12, fill: focus ? "panel" : undefined, stroke: focus ? "line" : undefined }, kids),
  );

const readText = (lang) => [heading(lang.title), space(4), ...lang.paras.map(para)];

const body = (kids, { w = 580, top = 58, center = true } = {}) =>
  row({ justify: "center", align: center ? "center" : "start", pad: [top, 0, 32] }, col({ w }, kids));

const both = (focusEn = false) => row({ gap: 48, align: "start" }, langCol("en", readText(LANTERN.en), focusEn), langCol("es", readText(LANTERN.es)));

// ---- rails and chrome ----------------------------------------------------

const rbtn = (glyph, { ref, label, on = false, filled = false } = {}) =>
  stack({ w: 36, h: 36, radius: "pill", fill: on ? "hover" : undefined, name: ref, label }, icon(glyph, { size: 18, color: on ? "warm" : "mute", filled, place: "center" }));

const tbtn = (value, ref, label) =>
  stack({ w: 36, h: 36, radius: "pill", name: ref, label }, text(value, { size: 14, weight: 700, color: "mute", place: "center" }));

const sep = () => col({ gap: 0, pad: [5, 0] }, box({ w: 20, h: 1, fill: "line" }));

const chip = (initials, label, cur, named = true) =>
  stack(
    { w: 30, h: 30, radius: "pill", fill: cur ? "text" : "field", name: named ? `space-${slug(label)}` : undefined, label },
    text(initials, { size: 11, weight: 700, color: cur ? "canvas" : "mute", track: 0.04, place: "center" }),
  );

const leftRail = ({ h = H, cur = 0, search = false } = {}) =>
  col(
    { place: { x: 8, y: 8 }, w: RAIL, h: h - 16, pad: [10, 0], gap: 6, align: "center", radius: 28, fill: "panel", name: "left-rail", label: "Left rail" },
    rbtn("search", { ref: "search-button", label: "Search", on: search }),
    space(4),
    SPACES.map(([initials, label], k) => chip(initials, label, k === cur)),
  );

const wheel = () =>
  stack(
    { w: 22, h: 110, radius: "pill", fill: "field", clip: true, name: "page-wheel", label: "Page wheel" },
    box({ w: 22, h: 33, fill: "done", place: "bottom-center" }),
    col({ gap: 2, place: "center" }, [1, 2, 3].map(() => box({ w: 10, h: 2, radius: "pill", fill: "mute" }))),
  );

const slider = () =>
  stack(
    { w: 20, h: 70, name: "size-slider", label: "Size slider" },
    box({ w: 3, h: 70, radius: "pill", fill: "line", place: "center" }),
    box({ w: 3, h: 28, radius: "pill", fill: "done", place: "bottom-center" }),
    box({ w: 12, h: 12, radius: "pill", fill: "text", place: { x: 4, y: 36 } }),
  );

const rightRail = ({ x = W - 8 - RAIL, h = H, bookmark = false, changes = false } = {}) =>
  col(
    { place: { x, y: 8 }, w: RAIL, h: h - 16, pad: [14, 0], gap: 3, align: "center", radius: 28, fill: "panel", name: "right-rail", label: "Right rail" },
    row({ w: 46, h: 30, justify: "center", radius: 10, name: "page-number", label: "Page number field" }, text("3", { size: 19, weight: 700, color: "text" })),
    text("of 10", { size: 12, color: "dim" }),
    rbtn("arrowUp", { ref: "previous-page", label: "Previous page" }),
    wheel(),
    rbtn("arrowDown", { ref: "next-page", label: "Next page" }),
    sep(),
    rbtn("bookmark", { ref: "bookmark", label: "Bookmark", on: bookmark, filled: bookmark }),
    rbtn("history", { ref: "changes-button", label: "Changes against the original", on: changes }),
    rbtn("languages", { ref: "language-menu", label: "Language menu" }),
    fill(),
    row({ w: 46, h: 24, justify: "center", radius: 10, name: "size-percent", label: "Size percent field" }, text("100%", { size: 12, color: "soft" })),
    tbtn("A+", "size-up", "Larger text"),
    slider(),
    tbtn("A-", "size-down", "Smaller text"),
  );

const leftWide = (kids, { h = H } = {}) =>
  col(
    { place: { x: 8, y: 8 }, w: WIDE, h: h - 16, pad: [10, 0], gap: 8, radius: 28, fill: "panel", stroke: "line", clip: true, name: "left-rail-open", label: "Left rail, widened" },
    row(
      { pad: [0, 10] },
      row(
        { grow: 1, h: 36, pad: [0, 12], gap: 8, radius: "pill", fill: "field", name: "rail-find", label: "Rail search field" },
        icon("search", { size: 16, color: "mute" }),
        text("Search", { size: 13, color: "dim" }),
      ),
    ),
    kids,
  );

const spaceRow = ([initials, label, count], cur = false) =>
  row(
    { h: 40, pad: [0, 12, 0, 13], gap: 10, name: `space-${slug(label)}`, label },
    chip(initials, label, cur, false),
    text(label, { size: 13, weight: 700, color: "name" }),
    fill(),
    text(String(count), { size: 11, color: "dim" }),
  );

const secLabel = (value) => row({ pad: [8, 12, 3, 53] }, text(value, { size: 11, color: "dim", track: 0.06 }));

const pageRow = (num, title, { on, bm, cm, ed, done } = {}) =>
  row(
    { pad: [0, 6] },
    row(
      { grow: 1, h: 28, pad: [0, 10, 0, 0], gap: 8, radius: 10, fill: on ? "on" : undefined, name: `page-${num}`, label: `Page ${num}, ${title}` },
      text(num, { w: 39, size: 11, color: on ? "soft" : "dim", align: "right" }),
      text(title, { size: 13, color: on ? "text" : "soft", lines: 1 }),
      fill(),
      bm ? icon("bookmark", { size: 12, color: "warm" }) : null,
      cm ? icon("messageCircle", { size: 12, color: "warm" }) : null,
      ed ? dot("edit", 5) : null,
      icon(done ? "circleCheck" : "circleDashed", { size: 12, color: done ? "add" : "dim" }),
    ),
  );

const questPages = (show = () => true) =>
  SECTIONS.flatMap(([section, pages]) => {
    const kept = pages.filter(show);
    return kept.length ? [secLabel(section), kept.map(([num, title, marks]) => pageRow(num, title, marks))] : [];
  });

const filterSeg = (active) => row({ pad: [0, 10] }, seg(["All", "Pending", "Approved"], active, { ref: "status-filter", stretch: true, w: WIDE - 20 }));

const screen = (...kids) => stack({ fill: "canvas", clip: true }, ...kids);

// ---- formatting bar and notices -----------------------------------------

const fbtn = (glyph, ref, label, on = false) =>
  stack({ w: 28, h: 28, radius: "pill", fill: on ? "hover" : undefined, name: ref, label }, icon(glyph, { size: 15, color: on ? "title" : "mute", place: "center" }));

const fmtBar = () =>
  row(
    { place: { x: Math.round((W - 520) / 2), y: 10 }, w: 520, h: 40, justify: "center", radius: "pill", fill: "panel", stroke: "line", name: "format-bar", label: "Formatting bar" },
    fbtn("undo2", "fmt-undo", "Undo"),
    fbtn("redo2", "fmt-redo", "Redo"),
    space(4),
    vr(16),
    space(4),
    fbtn("heading1", "fmt-heading-1", "Heading 1"),
    fbtn("heading2", "fmt-heading-2", "Heading 2"),
    fbtn("bold", "fmt-bold", "Bold", true),
    fbtn("italic", "fmt-italic", "Italic"),
    fbtn("underline", "fmt-underline", "Underline"),
    stack({ w: 28, h: 28, radius: "pill", name: "fmt-strikethrough", label: "Strikethrough" }, text("S", { size: 14, weight: 700, color: "mute", strike: true, place: "center" })),
    fbtn("type", "fmt-size", "Size"),
    fbtn("palette", "fmt-color", "Color"),
    space(4),
    vr(16),
    space(4),
    fbtn("list", "fmt-list", "Bullet list"),
    fbtn("listOrdered", "fmt-numbered-list", "Numbered list"),
    fbtn("quote", "fmt-quote", "Quote"),
    fbtn("code", "fmt-code", "Code"),
    fbtn("link", "fmt-link", "Link"),
    fbtn("table", "fmt-table", "Table"),
  );

const saved = () =>
  row({ place: "bottom-center", dy: -22, gap: 6, name: "saved-indicator", label: "Saved indicator" }, icon("check", { size: 12, color: "dim" }), text("Saved 10:42", { size: 12, color: "dim" }));

const thinHead = (value) => text(value, { size: 11, color: "mute", track: 0.1, upper: true });

// ---- screens -------------------------------------------------------------

// The default view: one language, the text centered, nothing else on screen.
const focus = () =>
  screen(
    body([col({ gap: 14, name: "focus-text", label: "Page text" }, readText(LANTERN.en))], { top: 0 }),
  );

const read = () =>
  screen(
    body([
      keyRow(LANTERN.key, pill(false)),
      space(22),
      stack(
        {},
        both(),
        stack({ w: 24, h: 24, radius: "pill", fill: "field", place: "top-right", dx: 34, dy: 66, name: "comment-bubble", label: "Open threads bubble" }, text("2", { size: 12, color: "warm", place: "center" })),
      ),
    ], { w: 1128 }),
    leftRail(),
    rightRail({ bookmark: true }),
  );

const spaces = () =>
  screen(
    body([keyRow(LANTERN.key, pill(false)), space(22), both()], { w: 1128 }),
    leftWide([
      filterSeg("All"),
      spaceRow(SPACES[0], true),
      questPages(),
      spaceRow(SPACES[1]),
      spaceRow(SPACES[2]),
    ]),
    rightRail({ bookmark: true }),
  );

const matchTail = (parts, sign, color) =>
  row({ gap: 8 }, text(sign, { w: 12, size: 14, color, align: "center" }), runs(parts, { size: 14, color: "soft" }));

const match = (pre, was, now, post, on = false) =>
  col(
    { gap: 4, pad: [8, 12], radius: 10, fill: on ? "hover" : undefined, stroke: on ? "line" : undefined, name: on ? "match-selected" : undefined, label: "Selected match" },
    matchTail([pre, { del: was }, post], "−", "del"),
    matchTail([pre, { ins: now }, post], "+", "add"),
  );

const head = (initials, label, count) =>
  row({ gap: 8, h: 28 }, stack({ w: 22, h: 22, radius: "pill", fill: "field" }, text(initials, { size: 10, weight: 700, color: "mute", place: "center" })), text(label, { size: 13, weight: 700, color: "name" }), fill(), text(count, { size: 11, color: "dim" }));

const pageHead = (num, title) => row({ pad: [0, 0, 0, 30], gap: 8 }, text(num, { size: 11, color: "dim" }), text(title, { size: 13, color: "soft" }));

const toggle = (label, on, ref, name) =>
  stack({ w: 30, h: 26, radius: 8, fill: on ? "on" : undefined, name: ref, label: name }, text(label, { size: 12, weight: 700, color: on ? "warm" : "mute", place: "center" }));

const searchField = (glyph, value, ref, label, tail, focus = false) =>
  row({ h: 40, pad: [0, 8, 0, 12], gap: 10, radius: 12, fill: "field", stroke: focus ? "dim" : undefined, name: ref, label }, icon(glyph, { size: 16, color: "mute" }), text(value, { size: 14, color: "text" }), fill(), tail);

const search = () =>
  screen(
    body(
      [
        col(
          { pad: 20, gap: 12, radius: 20, fill: "surface", stroke: "line" },
          searchField("search", "lantern", "find-field", "Find field", row({ gap: 2 }, toggle("Aa", false, "match-case", "Match case"), toggle("ab", false, "whole-word", "Whole word")), true),
          searchField("arrowLeftRight", "beacon", "replace-field", "Replace field"),
          row({ gap: 8 }, text("4 matches in 3 pages, 2 spaces", { size: 12, color: "mute" }), fill(), action("Replace", { ref: "replace-one", h: 30 }), action("Replace all", { primary: true, ref: "replace-all", h: 30 })),
          col({ gap: 4 }, head("QL", "Quest log", "3"), pageHead("03", "The Lantern Road"),
            match("Mara lights the first ", "lantern", "beacon", " at the edge of the marsh.", true),
            match("Follow the ", "lanterns", "beacons", " north.", false),
            pageHead("09", "The lamp keeper"),
            match("The keeper trims every ", "lantern", "beacon", " before dusk.")),
          col({ gap: 4 }, head("UI", "UI strings", "1"), pageHead("ui.hud.oil", "Lantern oil"),
            match("", "Lantern", "beacon", " oil: 3 left")),
        ),
      ],
      { w: 820, top: 70, center: false },
    ),
    leftRail({ search: true }),
    rightRail(),
  );

const edit = () =>
  screen(
    body([
      keyRow(LANTERN.key, pill(false)),
      space(22),
      row(
        { gap: 48, align: "start" },
        langCol("en", [heading(LANTERN.en.title), space(4), para(LANTERN.en.paras[0]), line(["Follow the lanterns", { caret: true }, " north. Each one you light shows a little more of the road."])], true),
        langCol("es", readText(LANTERN.es)),
      ),
    ], { w: 1128 }),
    fmtBar(),
    leftRail(),
    rightRail({ bookmark: true }),
    saved(),
  );

const cell = (value) => text(value, { size: 15, lh: 1.5, color: "text" });

const table = () =>
  screen(
    body(
      [
        keyRow("ui.menu"),
        space(18),
        row({ pad: [6, 12], gap: 0 }, text("KEY", { w: 190, size: 11, color: "mute", track: 0.1 }), col({ grow: 1 }, text("EN", { size: 11, color: "mute", track: 0.1 })), col({ grow: 1 }, text("ES", { size: 11, color: "mute", track: 0.1 }))),
        box({ h: 1, fill: "line" }),
        TABLE.map(([key, en, es], i) =>
          col(
            {},
            row(
              { pad: [10, 12], align: "start", fill: i === 3 ? "surface" : undefined },
              text(key, { w: 190, size: 11, color: "dim", lines: 1, lh: 1.9 }),
              col({ grow: 1, pad: [2, 6] }, cell(en)),
              i === 3
                ? col(
                    { grow: 1, pad: [2, 6], gap: 4, radius: 8, fill: "panel", stroke: "dim", name: "cell-edit", label: "Cell being edited" },
                    runs([es, { caret: true }], { size: 15 }),
                    text("19 characters", { size: 11, color: "dim", align: "right", name: "cell-count", label: "Character count" }),
                  )
                : col({ grow: 1, pad: [2, 6] }, cell(es)),
            ),
            box({ h: 1, fill: "#151515" }),
          ),
        ),
      ],
      { w: 980 },
    ),
    fmtBar(),
    leftRail({ cur: 1 }),
    rightRail(),
    saved(),
  );

const comments = () =>
  screen(
    body(
      [
        keyRow(LANTERN.key, pill(false)),
        space(22),
        heading(LANTERN.en.title),
        space(22),
        line("Mara lights the first lantern at the edge of the"),
        line("marsh. The path ahead is quiet, and the old bridge"),
        line("holds only if you cross it slowly."),
        space(20),
        line("Follow the lanterns north. Each one you light"),
        stack(
          { w: 580 },
          runs([{ sel: "shows a little more of the road." }]),
          stack({ w: 24, h: 24, radius: "pill", fill: "field", place: "middle-right", dx: 34, name: "add-comment", label: "Add comment bubble" }, icon("plus", { size: 14, color: "soft", place: "center" })),
        ),
      ],
      { w: 580, top: 120, center: false },
    ),
    col(
      { place: { x: 1046, y: 330 }, w: 290, pad: 12, gap: 8, radius: 16, fill: "field", stroke: "line", name: "thread-card", label: "Open thread" },
      text("shows a little more of the road.", { size: 13, color: "dim", lines: 1 }),
      col({ gap: 2 }, row({ gap: 8 }, text("Reviewer", { size: 13, weight: 700, color: "text" }), text("10:12", { size: 11, color: "dim" })), text("Is this still the right tone for the road? It reads a little hopeful.", { size: 13, lh: 1.5, color: "soft" })),
      col({ gap: 2 }, row({ gap: 8 }, text("Agent", { size: 13, weight: 700, color: "text" }), text("10:20", { size: 11, color: "dim" })), text("Kept it hopeful and shortened the line.", { size: 13, lh: 1.5, color: "soft" })),
      row({ h: 60, pad: 10, radius: 12, fill: "canvas", stroke: "line", align: "start", name: "reply-field", label: "Reply field" }, text("Reply", { size: 13, color: "dim" })),
      row({ gap: 6, justify: "end" }, action("Resolve", { ref: "resolve", h: 28 }), action("Reply", { primary: true, ref: "send-reply", h: 28 })),
    ),
    leftRail(),
    rightRail({ bookmark: true }),
  );

const history = () =>
  screen(
    body(
      [
        row(
          { gap: 56, align: "start" },
          col(
            { w: 560, gap: 6, name: "changes-text", label: "Changes against the original" },
            row({ gap: 10 }, thinHead("Changes against the original"), fill(), text("read-only", { size: 11, color: "dim" })),
            space(14),
            heading(LANTERN.en.title),
            space(10),
            line(["Mara lights the first ", { del: "lamp" }, { ins: "lantern" }, " at the edge"]),
            line(["of the marsh. The path ahead is ", { del: "calm" }, { ins: "quiet" }, ","]),
            line(["and the old bridge holds only if you ", { del: "pass" }, { ins: "cross" }]),
            line(["it slowly."]),
            space(20),
            line("Follow the lanterns north. Each one you light"),
            line("shows a little more of the road."),
          ),
          col(
            { w: 400, gap: 10, name: "version-list", label: "Version list" },
            thinHead("Versions of this page"),
            [
              ["10:42", "EN", "lamp", "lantern"],
              ["10:31", "EN", "calm", "quiet"],
              ["10:05", "ES", "pasarlo", "cruzarlo"],
              ["09:58", "EN", "pass", "cross"],
            ].map(([time, lang, before, after], i) =>
              col(
                { gap: 8, pad: 12, radius: 14, fill: "panel", stroke: "line" },
                row({ gap: 8 }, text(time, { size: 13, weight: 700, color: "text" }), row({ h: 18, pad: [0, 8], radius: "pill", fill: "field" }, text(lang, { size: 10, weight: 700, color: "mute" })), fill(), action("Restore", { glyph: "rotateCcw", h: 26, ghost: true, ref: `restore-${i + 1}` })),
                row({ gap: 8 }, text(before, { size: 13, color: "del", strike: true }), icon("arrowRight", { size: 12, color: "dim" }), text(after, { size: 13, color: "add" })),
              ),
            ),
          ),
        ),
      ],
      { w: 1016 },
    ),
    leftRail(),
    rightRail({ bookmark: true, changes: true }),
  );

const conflict = () =>
  screen(
    body([keyRow(LANTERN.key, pill(false)), space(22), both(true)], { w: 1128 }),
    row(
      { place: { x: Math.round((W - 880) / 2), y: 14 }, w: 880, h: 68, pad: [0, 16], gap: 14, radius: 20, fill: "panel", stroke: "edit", name: "conflict-bar", label: "File changed notice" },
      icon("triangleAlert", { size: 18, color: "warm" }),
      col({ gap: 2 }, text("An agent changed this page on disk", { size: 14, weight: 700, color: "title" }), text("Your edits to the English text are still here. Nothing is lost until you choose.", { size: 12, color: "soft" })),
      fill(),
      action("Keep mine", { ref: "keep-mine" }),
      action("Take theirs", { ref: "take-theirs" }),
      action("Compare", { glyph: "arrowLeftRight", ref: "compare" }),
    ),
    leftRail(),
    rightRail({ bookmark: true }),
  );

const lift = (num, title) =>
  row(
    { pad: [0, 6] },
    row(
      { grow: 1, h: 30, pad: [0, 10, 0, 6], gap: 8, radius: 10, fill: "hover", stroke: "dim", name: "dragged-row", label: "Row being dragged" },
      icon("gripVertical", { size: 14, color: "mute" }),
      text(num, { size: 11, color: "dim" }),
      text(title, { size: 13, color: "text" }),
    ),
  );

const dropLine = () => row({ pad: [2, 16] }, box({ grow: 1, h: 2, radius: "pill", fill: "warm", name: "drop-line", label: "Drop position" }));

const pages = () =>
  screen(
    body([keyRow(LANTERN.key, pill(false)), space(22), both()], { w: 1128 }),
    leftWide([
      spaceRow(SPACES[0], true),
      secLabel("Marsh"),
      pageRow("01", "First light", { done: 1 }),
      row(
        { pad: [0, 6] },
        row({ grow: 1, h: 30, pad: [0, 10, 0, 0], gap: 8, radius: 10, fill: "field", stroke: "dim", name: "rename-row", label: "Row being renamed" }, text("02", { w: 39, size: 11, color: "dim", align: "right" }), runs(["The old bridge", { caret: true }], { size: 13 })),
      ),
      pageRow("03", "The Lantern Road", { on: 1, bm: 1, cm: 2, ed: 1 }),
      pageRow("04", "Reeds and fog", { done: 1 }),
      secLabel("Hills"),
      pageRow("05", "The signal fire"),
      dropLine(),
      lift("06", "Shepherd's offer"),
      pageRow("07", "Cold wind"),
      spaceRow(SPACES[1]),
      spaceRow(SPACES[2]),
      row({ pad: [4, 10] }, action("New document", { glyph: "filePlus", ghost: true, ref: "new-document" })),
    ]),
    popover(
      { place: { x: 150, y: 250 }, w: 210, name: "page-menu", label: "Page context menu" },
      menuRow("New page", { glyph: "plus", ref: "menu-new-page" }),
      menuRow("Rename", { glyph: "pencil", ref: "menu-rename" }),
      menuRow("Move to section", { glyph: "move", ref: "menu-move", hint: "Marsh" }),
      menuRow("Delete", { glyph: "trash2", tone: "error", ref: "menu-delete" }),
    ),
    rightRail({ bookmark: true }),
  );

const del = () =>
  screen(
    body([keyRow(LANTERN.key, pill(false)), space(22), both()], { w: 1128 }),
    leftRail(),
    rightRail({ bookmark: true }),
    box({ fill: "overlay" }),
    col(
      { place: "center", w: 440, pad: 24, gap: 12, radius: 20, fill: "surface", stroke: "line", shadow: true, name: "delete-dialog", label: "Delete page dialog" },
      text("Delete this page?", { size: 18, weight: 700, color: "title" }),
      text("The Lantern Road is removed from the list. It stays in the version log, so it can be restored from there.", { size: 14, lh: 1.5, color: "soft" }),
      row({ justify: "end", gap: 8, pad: [8, 0, 0] }, action("Cancel", { ref: "cancel-delete" }), action("Delete page", { tone: "error", ref: "confirm-delete" })),
    ),
  );

const statusSeg = (code, active) => row({ justify: "center" }, seg(["Pending", "Approved"], active, { ref: `status-${code}` }));

const status = () =>
  screen(
    body(
      [
        keyRow(LANTERN.key, pill(false)),
        space(14),
        row({ justify: "center" }, action("Approve all languages", { primary: true, glyph: "checkCheck", ref: "approve-all" })),
        space(22),
        row(
          { gap: 48, align: "start" },
          col({ w: 540, gap: 18 }, statusSeg("en", "Approved"), langCol("en", readText(LANTERN.en))),
          col({ w: 540, gap: 18 }, statusSeg("es", "Pending"), langCol("es", readText(LANTERN.es))),
        ),
      ],
      { w: 1128 },
    ),
    leftWide([
      filterSeg("Pending"),
      spaceRow(["QL", "Quest log", 3], true),
      questPages((page) => !page[2]?.done),
      spaceRow(["UI", "UI strings", 7]),
      spaceRow(["HB", "Handbook", 2]),
    ]),
    rightRail({ bookmark: true }),
  );

// ---- embedded in a host --------------------------------------------------

const EMBED_W = W - 48 - 330;
const EMBED_H = H - 40 - 24;

const hostBar = (props, ...kids) => row({ fill: "field", ...props }, ...kids);

const embedded = () =>
  col(
    { fill: "hover" },
    hostBar(
      { h: 40, pad: [0, 14], gap: 8 },
      [1, 2, 3].map(() => box({ w: 10, h: 10, radius: "pill", fill: "line" })),
      fill(),
      text("Host", { size: 12, weight: 700, color: "soft" }),
      fill(),
      space(34),
    ),
    row(
      { grow: 1, align: "stretch" },
      col({ w: 48, pad: [10, 0], gap: 6, align: "center", fill: "field", name: "host-activity-bar", label: "Host activity bar" }, ["folder", "search", "gitBranch", "settings2"].map((glyph) => stack({ w: 36, h: 36 }, icon(glyph, { size: 18, color: "mute", place: "center" })))),
      stack(
        { w: EMBED_W, fill: "canvas", clip: true, name: "void-base", label: "Void base" },
        body([keyRow(LANTERN.key, pill(false)), space(22), col({ gap: 18 }, langLabel("en"), readText(LANTERN.en))], { w: 580 }),
        leftRail({ h: EMBED_H }),
        rightRail({ x: EMBED_W - 8 - RAIL, h: EMBED_H, bookmark: true }),
        col(
          { place: { x: EMBED_W - 8 - RAIL - 8 - 40, y: 8 }, w: 40, pad: [6, 0], gap: 2, align: "center", radius: 14, stroke: "warm", dash: "4 4", name: "host-toolbar", label: "Slot: host-toolbar" },
          ["gitBranch", "externalLink", "ellipsis"].map((glyph) => stack({ w: 32, h: 32, radius: "pill" }, icon(glyph, { size: 16, color: "soft", place: "center" }))),
        ),
        text("host-toolbar", { place: { x: EMBED_W - 8 - RAIL - 8 - 110, y: 126 }, w: 110, size: 10, color: "warm", align: "right", track: 0.04 }),
      ),
      col(
        { w: 330, pad: 16, gap: 14, fill: "surface", stroke: "warm", dash: "4 4", name: "host-context", label: "Slot: host-context" },
        text("host-context", { size: 10, color: "warm", upper: true, track: 0.1 }),
        row({ gap: 8 }, icon("fileCode", { size: 16, color: "soft" }), text("Source file", { size: 13, weight: 700, color: "title" })),
        text("docs/quests.void.json", { size: 12, face: "mono", color: "soft" }),
        hr(),
        row({ gap: 8 }, icon("gitBranch", { size: 16, color: "soft" }), text("Repository", { size: 13, weight: 700, color: "title" })),
        text("main, 3 files changed", { size: 12, color: "soft" }),
        text("Anything the host knows about the page goes here.", { size: 12, lh: 1.5, color: "dim" }),
      ),
    ),
    hostBar({ h: 24, pad: [0, 14], gap: 12 }, text("Host status bar", { size: 11, color: "dim" }), fill(), text("Void base ready", { size: 11, color: "dim" })),
  );

export default board({
  id: "void",
  title: "Void: the text editor and viewer base",
  note: "Void reads and edits plain-text documents written by agents, on a pure black ground with the text always in one centered column. By default only the text shows, with no distractions. Every edit is saved to disk, keeping the original and a version log.",
  screens: [
    { id: "history", title: "History", col: 1, row: 0, root: history, note: "Changes against the original as insertions and deletions, read-only, next to the versions of the page with a Restore on each." },
    { id: "focus", title: "Focus", col: 0, row: 1, root: focus, note: "The default view: one language, the text centered on black and nothing else. The rails stay hidden until the pointer moves or a key is pressed." },
    { id: "read", title: "Read with controls", col: 1, row: 1, root: read, note: "The controls, shown while the pointer moves and fading out after a few seconds of stillness: compact rails, the page with its languages side by side when chosen, a status mark, the page wheel and size controls." },
    { id: "comments", title: "Comments", col: 1, row: 2, root: comments, note: "A selected phrase shows the + bubble in the margin; an open thread sits beside the text with a reply field and Resolve." },
    { id: "conflict", title: "Conflict", col: 1, row: 3, root: conflict, note: "The file changed on disk while open: a calm bar with Keep mine, Take theirs and Compare. With no conflict, the page reloads and a small line reading Reloaded from disk shows briefly." },
    { id: "spaces", title: "Spaces", col: 2, row: 0, root: spaces, note: "The left rail widened over the text: spaces, pages by section with bookmark, comment, edited and status marks, filtered by status." },
    { id: "search", title: "Search", col: 2, row: 1, root: search, note: "Find and replace across all spaces: toggles for case and whole word, matches grouped by space and page with a before and after preview." },
    { id: "edit", title: "Edit", col: 2, row: 2, root: edit, note: "A page in edit mode: the formatting bar with undo and redo, the caret in the text and a quiet saved indicator." },
    { id: "embedded", title: "Embedded in a host", col: 2, row: 3, root: embedded, note: "The contract every host follows: the host's chrome around the base and two named slots, host-toolbar next to the right rail and host-context as a side panel." },
    { id: "pages", title: "Pages", col: 3, row: 0, root: pages, note: "Managing pages from the widened rail: inline rename, a row dragged to a new position, the context menu and a New document action at the space level." },
    { id: "status", title: "Status", col: 3, row: 1, root: status, note: "Approving a page: a status control per language, Approve all languages, and the rail filtered to pending." },
    { id: "table", title: "Table", col: 3, row: 2, root: table, note: "Short UI strings shown as one table, key then one column per language, with one cell being edited and its character count." },
    { id: "delete", title: "Delete page", col: 4, row: 0, root: del, note: "Confirm before deleting a page; the page stays in the version log." },
  ],
  links: [
    { from: "focus", to: "read", label: "Pointer moves" },
    { from: "focus", to: "edit", at: "focus-text", label: "Click the text" },
    { from: "read", to: "spaces", at: "left-rail", label: "Spaces" },
    { from: "read", to: "search", at: "search-button", label: "Search" },
    { from: "read", to: "edit", at: "lang-en", label: "Click the text" },
    { from: "edit", to: "table", at: "fmt-table", label: "Table" },
    { from: "read", to: "comments", at: "comment-bubble", label: "Comments" },
    { from: "read", to: "history", at: "changes-button", label: "Changes" },
    { from: "read", to: "conflict", label: "File changed on disk" },
    { from: "spaces", to: "pages", at: "page-03", label: "Manage pages" },
    { from: "pages", to: "delete", at: "menu-delete", label: "Delete" },
    { from: "spaces", to: "status", at: "status-filter-pending", label: "Pending" },
    { from: "read", to: "embedded", label: "Inside a host" },
  ],
});
