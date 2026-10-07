import { PLAIN, SANS, MONO, pick, skinDefs } from "blueprint/skins.mjs";

// Atkinson Hyperlegible, latin subset, from docs/flows/assets/ through theme.css.
const ATKINSON = `"Atkinson Hyperlegible", ${SANS}`;

// Source: user/tools/void-text-reader/reader.html, approved prototype v5 CSS variables.
const tokens = {
  bg: "#000000", fg: "#e6e3dc", head: "#f4f2ee", name: "#cfccc4",
  soft: "#a9a69e", mute: "#8a877f", dim: "#5f5c55", line: "#262626",
  done: "#4a4740", edit: "#8f7f55", warm: "#c9a96b",
  add: "#7fb08a", addbg: "#14201a", del: "#b07f7f", delbg: "#201414",
  panel: "#0b0b0b", hover: "#171717", field: "#141414", on: "#1d1d1d",
};

export const VOID = {
  ...PLAIN, ...tokens,
  canvas: tokens.bg, surface: tokens.panel,
  "surface-2": tokens.field, "surface-3": tokens.on, glass: tokens.panel,
  "border-subtle": tokens.line, "line-strong": tokens.line, frame: tokens.line,
  title: tokens.head, text: tokens.fg, accent: tokens.warm,
  input: tokens.field, page: tokens.bg, "page-text": tokens.fg,
  primary: tokens.warm, "primary-hover": tokens.head, "on-primary": tokens.bg,
  wash: tokens.on, "on-wash": tokens.fg, "primary-border": tokens.edit,
  error: tokens.del, "error-wash": tokens.delbg, success: tokens.add,
  warning: tokens.warm, info: tokens.soft, overlay: "rgba(0, 0, 0, 0.78)",
  "cover-from": tokens.field, "cover-to": tokens.panel, white: tokens.head,
};

export const skins = {
  design: {
    id: "design", shadow: false,
    color: (role) => pick(VOID, role),
    face: (face) => face === "mono" ? MONO : ATKINSON,
    weight: (_face, weight) => weight,
    image(node, r) {
      return `<rect x="${node._x}" y="${node._y}" width="${node._w}" height="${node._h}" rx="${r}" fill="${VOID.field}" stroke="${VOID.line}"/>`;
    },
  },
};

export { skinDefs };
