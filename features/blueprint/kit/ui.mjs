// Small controls for the windowed apps: the pieces a window's toolbar, lists
// and popovers are made of. They read roles only, so a themed window repaints
// them without a second version.

import { box, col, row, stack, text, icon, fill } from "./kit.mjs";

const slug = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A square icon button; `active` gives it the raised surface. */
export function btn(glyph, { size = 32, g = 18, active = false, tone, label, ref, stroke = false } = {}) {
  return stack(
    {
      w: size,
      h: size,
      radius: "md",
      fill: active ? "surface-3" : undefined,
      stroke: stroke ? "line" : undefined,
      name: ref ?? (label ? slug(label) : undefined),
      label,
    },
    icon(glyph, { size: g, color: tone ?? (active ? "title" : "soft"), place: "center" }),
  );
}

/** A text button: `primary` fills it with the accent, `ghost` drops the surface. */
export function action(label, { primary = false, ghost = false, glyph, h = 32, w, ref, tone, grow } = {}) {
  return row(
    {
      h,
      w,
      grow,
      pad: [0, glyph ? 12 : 14, 0, glyph ? 10 : 14],
      gap: 6,
      radius: "md",
      justify: "center",
      fill: primary ? "primary" : ghost ? undefined : "surface-2",
      stroke: primary || ghost ? undefined : "line",
      name: ref ?? slug(label),
      label,
    },
    glyph ? icon(glyph, { size: 16, color: primary ? "on-primary" : tone ?? "title" }) : null,
    text(label, { size: "sm", weight: 600, color: primary ? "on-primary" : tone ?? "title" }),
  );
}

/** A search or text field. */
export function input(placeholder, { w, h = 34, glyph = "search", value, kbd, focus = false, grow } = {}) {
  return row(
    { w, h, grow, pad: [0, kbd ? 6 : 10, 0, 10], gap: 8, radius: "md", fill: "surface-2", stroke: focus ? "primary" : "line", strokeWidth: focus ? 1.5 : 1 },
    glyph ? icon(glyph, { size: 16, color: "soft" }) : null,
    text(value ?? placeholder, { size: "sm", color: value ? "title" : "dim" }),
    fill(),
    kbd ? keycap(kbd) : null,
  );
}

export const keycap = (label) =>
  row({ h: 20, pad: [0, 6], radius: "xs", fill: "surface-3", stroke: "line" }, text(label, { size: 10, weight: 600, color: "soft" }));

export function checkbox(on = false, { size = 16, tone = "primary" } = {}) {
  return stack(
    { w: size, h: size, radius: 4, fill: on ? tone : undefined, stroke: on ? undefined : "line-strong", strokeWidth: 1.5 },
    on ? icon("check", { size: size - 4, color: "on-primary", stroke: 3, place: "center" }) : null,
  );
}

export const dot = (color, size = 8) => box({ w: size, h: size, radius: "pill", fill: color });

/** An unread or pending count. */
export const count = (n, { tone = "primary" } = {}) =>
  row({ h: 18, pad: [0, 6], radius: "pill", fill: tone, justify: "center" }, text(String(n), { size: 10, weight: 700, color: "on-primary" }));

/** Tabs with the accent line under the chosen one. */
export function tabs(options, active, { h = 40, gap = 20 } = {}) {
  return row(
    { h, gap, align: "stretch" },
    ...options.map((option) => {
      const on = option === active;
      return col(
        { h, name: `tab-${slug(option)}`, label: option },
        row({ grow: 1 }, text(option, { size: "sm", weight: on ? 600 : 500, color: on ? "title" : "soft" })),
        box({ h: 2, radius: "pill", fill: on ? "primary" : undefined }),
      );
    }),
  );
}

/** Two to five choices side by side; each option is a label or { label, icon, iconOnly }. */
export function seg(options, active, { ref, h = 32, stretch = false, w } = {}) {
  return row(
    { h, w, pad: 3, gap: 2, radius: "md", fill: "canvas", stroke: "line", name: ref, label: ref },
    ...options.map((option) => {
      const name = typeof option === "string" ? option : option.label;
      const glyph = typeof option === "string" ? null : option.icon;
      const on = name === active;
      return row(
        { h: h - 6, pad: [0, glyph && option.iconOnly ? 7 : 10], gap: 6, radius: "sm", justify: "center", grow: stretch ? 1 : undefined, fill: on ? "surface-3" : undefined, name: `${ref ?? "seg"}-${slug(name)}`, label: name },
        glyph ? icon(glyph, { size: 14, color: on ? "title" : "soft" }) : null,
        glyph && option.iconOnly ? null : text(name, { size: "xs", weight: on ? 600 : 500, color: on ? "title" : "soft" }),
      );
    }),
  );
}

/** A floating menu or popover, as a product draws its popups. */
export const popover = (props = {}, ...kids) =>
  col({ fill: "surface", stroke: "line-strong", radius: 14, shadow: true, pad: 6, gap: 2, ...props }, ...kids);

/** One row of a menu. */
export function menuRow(label, { glyph, hint, active = false, tone, lead, h = 34, ref } = {}) {
  return row(
    { h, pad: [0, 10], gap: 10, radius: "sm", fill: active ? "wash" : undefined, name: ref, label },
    lead ?? null,
    glyph ? icon(glyph, { size: 16, color: tone ?? (active ? "primary" : "soft") }) : null,
    text(label, { size: "sm", weight: active ? 600 : 400, color: tone ?? "title" }),
    fill(),
    hint ? text(hint, { size: "xs", color: "dim" }) : null,
  );
}

/** An on-off switch. */
export function switcher(on = true, { ref, label: name } = {}) {
  return stack(
    { w: 36, h: 20, radius: "pill", fill: on ? "primary" : "surface-3", stroke: on ? undefined : "line-strong", name: ref, label: name },
    box({ w: 14, h: 14, radius: "pill", fill: on ? "on-primary" : "soft", place: on ? "middle-right" : "middle-left", dx: on ? -3 : 3 }),
  );
}

/** A labelled drop-down, closed. */
export function select(value, { lead, w, h = 34, ref, name: title } = {}) {
  return row(
    { w, h, pad: [0, 8, 0, 10], gap: 8, radius: "md", fill: "surface-2", stroke: "line", name: ref, label: title ?? value },
    lead ?? null,
    text(value, { size: "sm", color: "title" }),
    fill(),
    icon("chevronDown", { size: 14, color: "soft" }),
  );
}

/** A thin progress bar. */
export function progress(fraction, { w = 160, h = 6, tone = "primary" } = {}) {
  return stack(
    { w, h, radius: "pill", fill: "surface-3" },
    box({ w: Math.max(h, Math.round(w * fraction)), h, radius: "pill", fill: tone, place: "middle-left" }),
  );
}

/** A small label above a group. */
export const label = (value, props = {}) => text(value, { size: "xs", weight: 600, color: "soft", ...props });

/** A one-pixel rule. */
export const hr = (props = {}) => box({ h: 1, fill: "border-subtle", ...props });
export const vr = (h = 24, props = {}) => box({ w: 1, h, fill: "line", ...props });

/** A coloured round mark with a glyph or an initial, for chats, people and sites. */
export function badge(color, { glyph, initial, size = 36, ink = "#ffffff", radius = "pill" } = {}) {
  return stack(
    { w: size, h: size, radius, fill: color },
    glyph ? icon(glyph, { size: Math.round(size * 0.5), color: ink, place: "center" }) : null,
    initial ? text(initial, { size: Math.round(size * 0.42), weight: 700, color: ink, place: "center" }) : null,
  );
}
