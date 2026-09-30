// The coat of paint a board wears.
//
// This is the fallback theme. A repository brings its own by putting a
// skins.mjs in docs/flows/kit/, which the viewer uses instead of this file and
// which may build on the exports below (PLAIN, pick, SANS, MONO, skinDefs)
// so that it only has to state what differs.
//
// The fallback is greys on white in system fonts, for a repository that has
// not brought its own theme yet.
// A role that starts with "#" or "rgb" is drawn as that literal colour: that
// is content, such as a picture's own colours, not interface.

export const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO = 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const PLAIN = {
  canvas: "#ffffff",
  surface: "#f7f7f7",
  "surface-2": "#eeeeee",
  "surface-3": "#e3e3e3",
  glass: "rgba(247, 247, 247, 0.92)",
  hover: "#f1f1f1",
  "border-subtle": "#e2e2e2",
  line: "#d0d0d0",
  "line-strong": "#a9a9a9",
  frame: "#a9a9a9",
  title: "#1b1b1b",
  text: "#353535",
  soft: "#5c5c5c",
  dim: "#6e6e6e",
  accent: "#454545",
  input: "#ffffff",
  page: "#ffffff",
  "page-text": "#353535",
  primary: "#2a2a2a",
  "primary-hover": "#454545",
  "on-primary": "#ffffff",
  wash: "#ebebeb",
  "on-wash": "#2a2a2a",
  "primary-border": "#8c8c8c",
  error: "#9c3b3b",
  "error-wash": "#f6e9e9",
  success: "#3d7350",
  warning: "#7a5a12",
  info: "#3f5f86",
  overlay: "rgba(24, 24, 24, 0.34)",
  "cover-from": "#dadada",
  "cover-to": "#c9c9c9",
  white: "#ffffff",
  none: "none",
};

export function pick(palette, role) {
  if (!role) return "none";
  if (role.startsWith("#") || role.startsWith("rgb")) return role;
  const value = palette[role];
  if (value === undefined) throw new Error(`Unknown colour role ${role}`);
  return value;
}

export const skins = {
  design: {
    id: "design",
    shadow: false,
    color: (role) => pick(PLAIN, role),
    face: (face) => (face === "mono" ? MONO : SANS),
    weight: (face, weight) => (face === "display" ? 600 : weight),
    image(node, r) {
      const { _x: x, _y: y, _w: w, _h: h } = node;
      return (
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${PLAIN["surface-3"]}"/>` +
        `<path d="M${x + r} ${y + r} L${x + w - r} ${y + h - r} M${x + w - r} ${y + r} L${x + r} ${y + h - r}" stroke="${PLAIN.line}" stroke-width="1"/>`
      );
    },
  },
};

/** Patterns a box can ask for, once per document. */
export function skinDefs(prefix) {
  const ids = {
    prefix,
    shadow: `${prefix}-shadow`,
    mesh: `${prefix}-mesh`,
    dots: `${prefix}-dots`,
  };
  const svg =
    // A ground of flat hexagons, 17 px a side, in one faint line.
    `<pattern id="${ids.mesh}" width="51" height="29.445" patternUnits="userSpaceOnUse">` +
    `<path d="M0 14.722 L8.500 0 L25.500 0 L34.000 14.722 L25.500 29.445 L8.500 29.445 Z M34.000 14.722 L51.000 14.722" fill="none" stroke="#e2e2e2" stroke-width="1"/></pattern>` +
    // A 24 px grid of points.
    `<pattern id="${ids.dots}" width="24" height="24" patternUnits="userSpaceOnUse">` +
    `<circle cx="12" cy="12" r="1" fill="#d0d0d0"/></pattern>`;
  return { ids, svg };
}
