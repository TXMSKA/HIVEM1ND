// The screen kit: a small tree of boxes, text and icons, laid out like a
// flexbox and drawn as SVG.
//
// A screen is written once as a tree and drawn in the plain skin. Text is
// measured in the browser with the real fonts, which is why the kit runs in
// the Review app rather than in a build step, and why every screen stays
// vector at any zoom.
//
// Layout is measured with the faces and weights of the skin the board is drawn
// in (see useSkin), so a board measures what the page draws.

import { ICONS } from "./icons.mjs";

// ---- extension points ----------------------------------------------------
//
// The shared kit is the base only. A repository adds what only it uses from
// its own docs/flows/kit/, without keeping a copy of this file: icons in
// extra-icons.mjs and node types in nodes.mjs (see blueprint.md). The viewer
// hands them over before it lays out or draws that repository's boards.

let extraIcons = {};
let extraNodes = {};

/** Sets the icons of the repository being drawn: name to SVG markup, over the shared set. */
export function useIcons(icons) {
  extraIcons = icons ?? {};
}

/**
 * Sets the node types of the repository being drawn: type name to
 * `{ measure(node, avail, stretch, axis, api), place?(node, x, y, w, h, api), draw(node, g) }`.
 */
export function useNodes(nodes) {
  extraNodes = nodes ?? {};
}

const iconOf = (name) => extraIcons[name] ?? ICONS[name];

// ---- nodes ---------------------------------------------------------------

const clean = (kids) => kids.flat(Infinity).filter((kid) => kid && typeof kid === "object");

export const box = (props = {}, ...kids) => ({ t: "box", dir: "col", ...props, kids: clean(kids) });
export const col = (props = {}, ...kids) => box({ ...props, dir: "col" }, ...kids);
export const row = (props = {}, ...kids) => box({ ...props, dir: "row" }, ...kids);
export const stack = (props = {}, ...kids) => box({ ...props, dir: "stack" }, ...kids);
export const text = (value, props = {}) => ({ t: "text", value: String(value), ...props });
export const icon = (name, props = {}) => ({ t: "icon", icon: name, ...props });
export const image = (props = {}) => ({ t: "image", ...props });
export const rule = (props = {}) => ({ t: "rule", ...props });
/**
 * A vector drawn in its own box on a 0..100 grid: the shapes a person draws
 * in Blueprint (ellipse, polygon, a pen stroke, a line or an arrow), which a
 * box with a radius cannot express. `d` is an SVG path on that grid.
 */
export const vector = (props = {}) => ({ t: "vector", ...props });

/** An n-sided regular polygon on the 0..100 grid, pointing up. */
export function polygonPath(sides = 3) {
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    points.push(`${(50 + 50 * Math.cos(angle)).toFixed(2)} ${(50 + 50 * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join(" L")} Z`;
}

export const ELLIPSE = "M50 0 A50 50 0 1 1 49.99 0 Z";
/** A fixed gap in the parent's main axis. */
export const space = (size) => ({ t: "space", size });
/** A gap that takes whatever the parent has left over. */
export const fill = (weight = 1) => ({ t: "space", size: 0, grow: weight });

// ---- type ----------------------------------------------------------------

export const SIZES = { micro: 10, "2xs": 11, xs: 12, sm: 14, base: 16, lg: 18, xl: 22, "2xl": 28, "3xl": 36 };

// The stacks text is measured in until a skin is given: the same system stacks
// the fallback theme draws with.
const FACES = {
  body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  display: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const measureCtx = document.createElement("canvas").getContext("2d");

let measureSkin = null;

/**
 * Sets the skin text is measured with: its `face()` and `weight()` decide the
 * font a line is measured in, the same two calls `draw` makes, so layout and
 * drawing agree. Call it once per board, before `layout`, with the skin the
 * board is drawn in. Without a skin the system stacks above are used.
 */
export function useSkin(skin) {
  measureSkin = skin ?? null;
}

function fontOf(node) {
  const size = typeof node.size === "number" ? node.size : SIZES[node.size ?? "sm"];
  const face = node.face ?? "body";
  const weight = node.weight ?? 400;
  const family = measureSkin?.face(face) ?? FACES[face];
  const drawn = measureSkin?.weight(face, weight) ?? weight;
  return { size, face, weight, css: `${drawn} ${size}px ${family}` };
}

function widthOf(str, font, track) {
  measureCtx.font = font.css;
  const chars = [...str].length;
  return measureCtx.measureText(str).width + (chars > 1 ? track * font.size * (chars - 1) : 0);
}

function ellipsize(str, max, font, track) {
  if (widthOf(str, font, track) <= max) return str;
  let low = 0;
  let high = str.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (widthOf(`${str.slice(0, mid).trimEnd()}…`, font, track) <= max) low = mid;
    else high = mid - 1;
  }
  return `${str.slice(0, low).trimEnd()}…`;
}

function wrap(node, max) {
  const font = fontOf(node);
  const track = node.track ?? 0;
  const raw = node.upper ? node.value.toUpperCase() : node.value;
  const limit = node.lines ?? (node.wrap === false ? 1 : Infinity);
  const out = [];
  for (const paragraph of raw.split("\n")) {
    if (limit === 1 || widthOf(paragraph, font, track) <= max) {
      out.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (!line || widthOf(next, font, track) <= max) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  const lines = out.length > limit ? out.slice(0, limit) : out;
  if (out.length > limit || limit === 1) {
    lines[lines.length - 1] = ellipsize(
      lines[lines.length - 1] + (out.length > limit ? "…" : ""),
      max,
      font,
      track,
    );
  }
  const widths = lines.map((line) => widthOf(line, font, track));
  const lh = Math.round(font.size * (node.lh ?? (node.face === "body" || !node.face ? 1.45 : 1.25)));
  return { lines, widths, lh, font, track };
}

// ---- layout --------------------------------------------------------------

function pads(pad) {
  if (pad === undefined) return [0, 0, 0, 0];
  if (typeof pad === "number") return [pad, pad, pad, pad];
  if (pad.length === 2) return [pad[0], pad[1], pad[0], pad[1]];
  if (pad.length === 3) return [pad[0], pad[1], pad[2], pad[1]];
  return pad;
}

const isBlock = (node) => node.t === "box" || node.t === "rule" || (node.t === "image" && node.w === undefined);

/**
 * Natural size of a node given the width it may use. `stretch` asks a block
 * to take the whole width, which is what a column does for its children
 * unless told to align them otherwise.
 */
function measure(node, avail, stretch = false, axis = "col") {
  switch (node.t) {
    case "space": {
      node._w = axis === "row" ? node.size : 0;
      node._h = axis === "col" ? node.size : 0;
      return;
    }
    case "text": {
      const max = typeof node.w === "number" ? node.w : Math.max(1, avail);
      node._text = wrap(node, max);
      const natural = Math.ceil(Math.max(0, ...node._text.widths));
      node._w = typeof node.w === "number" ? node.w : node.w === "fill" || stretch ? avail : natural;
      node._h = node._text.lines.length * node._text.lh;
      return;
    }
    case "icon": {
      node._w = node._h = node.size ?? 16;
      return;
    }
    case "vector": {
      node._w = typeof node.w === "number" ? node.w : avail;
      node._h = typeof node.h === "number" ? node.h : node._w;
      return;
    }
    case "image": {
      node._w = typeof node.w === "number" ? node.w : avail;
      node._h = typeof node.h === "number" ? node.h : Math.round(node._w / (node.ratio ?? 16 / 9));
      return;
    }
    case "rule": {
      const vertical = node.dir === "v";
      node._w = vertical ? 1 : typeof node.w === "number" ? node.w : avail;
      node._h = vertical ? (typeof node.h === "number" ? node.h : 0) : 1;
      return;
    }
    case "box":
      return measureBox(node, avail, stretch);
    default: {
      const extra = extraNodes[node.t];
      if (!extra) throw new Error(`Unknown node ${node.t}`);
      // `layout` lays a subtree out alone; `withMeasureSkin` runs work with text measured in another skin.
      extra.measure(node, avail, stretch, axis, { layout, withMeasureSkin });
      return;
    }
  }
}

function withMeasureSkin(skin, work) {
  const outer = measureSkin;
  measureSkin = skin ?? outer;
  try {
    return work();
  } finally {
    measureSkin = outer;
  }
}

function measureBox(node, avail, stretch) {
  const [pt, pr, pb, pl] = pads(node.pad);
  const gap = node.gap ?? 0;
  const fixedW = typeof node.w === "number" ? node.w : null;
  const W = fixedW ?? (stretch || node.w === "fill" ? avail : null);
  const inner = Math.max(0, (W ?? avail) - pl - pr);
  const kids = node.kids;
  let cw = 0;
  let ch = 0;

  if (node.dir === "row") {
    let used = 0;
    let grows = 0;
    for (const kid of kids) {
      if (kid.grow) {
        grows += kid.grow;
        continue;
      }
      measure(kid, Math.max(0, inner - used), false, "row");
      used += kid._w;
    }
    used += gap * Math.max(0, kids.length - 1);
    if (W === null) {
      // Hugging: a growing child counts at its natural width, and takes the
      // leftover later, once the row knows how wide it ended up.
      for (const kid of kids) {
        if (!kid.grow) continue;
        measure(kid, Math.max(0, inner - used), false, "row");
        used += kid._w;
      }
    } else {
      const left = Math.max(0, inner - used);
      for (const kid of kids) {
        if (!kid.grow) continue;
        const share = grows ? (left * kid.grow) / grows : 0;
        measure(kid, share, true, "row");
        kid._w = kid.t === "space" ? share : Math.max(kid._w, share);
      }
    }
    cw = kids.reduce((sum, kid) => sum + kid._w, 0) + gap * Math.max(0, kids.length - 1);
    ch = Math.max(0, ...kids.map((kid) => kid._h));
  } else if (node.dir === "stack") {
    for (const kid of kids) measure(kid, inner, kid.place === undefined, "col");
    cw = Math.max(0, ...kids.map((kid) => kid._w));
    ch = Math.max(0, ...kids.map((kid) => kid._h));
  } else {
    const alignStretch = (node.align ?? "stretch") === "stretch";
    if (W === null) {
      // A column that hugs its content is as wide as its widest child, not as
      // wide as the room it was offered: measure the children loose first,
      // then stretch the blocks to that width.
      for (const kid of kids) measure(kid, inner, false, "col");
      const hug = Math.max(0, ...kids.map((kid) => kid._w));
      if (alignStretch) for (const kid of kids) if (isBlock(kid)) measure(kid, hug, true, "col");
    } else {
      for (const kid of kids) measure(kid, inner, alignStretch && isBlock(kid), "col");
    }
    cw = Math.max(0, ...kids.map((kid) => kid._w));
    ch = kids.reduce((sum, kid) => sum + kid._h, 0) + gap * Math.max(0, kids.length - 1);
  }

  node._w = W ?? cw + pl + pr;
  node._h = typeof node.h === "number" ? node.h : Math.max(node.minH ?? 0, ch + pt + pb);
}

/** Final position and size. A box hands leftover room to its growing kids. */
function place(node, x, y, w, h) {
  node._x = x;
  node._y = y;
  node._w = w;
  node._h = h;
  if (node.t === "text") {
    const again = wrap(node, Math.max(1, w));
    if (again.lines.length <= node._text.lines.length) node._text = again;
    return;
  }
  if (node.t !== "box") {
    extraNodes[node.t]?.place?.(node, x, y, w, h, { place });
    return;
  }

  const [pt, pr, pb, pl] = pads(node.pad);
  const gap = node.gap ?? 0;
  const ix = x + pl;
  const iy = y + pt;
  const iw = Math.max(0, w - pl - pr);
  const ih = Math.max(0, h - pt - pb);
  const kids = node.kids;

  if (node.dir === "stack") {
    for (const kid of kids) {
      if (kid.place === undefined) {
        place(kid, ix, iy, iw, ih);
        continue;
      }
      const spot = typeof kid.place === "string" ? kid.place : "custom";
      let kx = ix;
      let ky = iy;
      if (spot.includes("center") || spot === "middle") kx = ix + (iw - kid._w) / 2;
      if (spot.includes("right")) kx = ix + iw - kid._w;
      if (spot === "center" || spot.startsWith("middle")) ky = iy + (ih - kid._h) / 2;
      if (spot.includes("bottom")) ky = iy + ih - kid._h;
      if (spot === "custom") {
        kx = ix + (kid.place.x ?? 0);
        ky = iy + (kid.place.y ?? 0);
      }
      kx += kid.dx ?? 0;
      ky += kid.dy ?? 0;
      place(kid, Math.round(kx), Math.round(ky), kid._w, kid._h);
    }
    return;
  }

  const rowDir = node.dir === "row";
  const main = rowDir ? iw : ih;
  const sizes = kids.map((kid) => (rowDir ? kid._w : kid._h));
  const total = sizes.reduce((a, b) => a + b, 0) + gap * Math.max(0, kids.length - 1);
  const grows = kids.reduce((sum, kid) => sum + (kid.grow ?? 0), 0);
  let left = main - total;
  if (grows && left > 0) {
    kids.forEach((kid, i) => {
      if (kid.grow) sizes[i] += (left * kid.grow) / grows;
    });
    left = 0;
  }

  const justify = node.justify ?? "start";
  let cursor = rowDir ? ix : iy;
  let between = gap;
  if (left > 0 && !grows) {
    if (justify === "center") cursor += left / 2;
    if (justify === "end") cursor += left;
    if (justify === "between" && kids.length > 1) between = gap + left / (kids.length - 1);
  }

  const align = node.align ?? (rowDir ? "center" : "stretch");
  kids.forEach((kid, i) => {
    const along = sizes[i];
    // A child that names its own alignment (`self`) keeps its size. One that
    // only names a size is still stretched across: a fixed `w` or `h` is the
    // size the parent measures it at, not the size it is placed at.
    const stretchKid = align === "stretch" && (kid.self ?? "stretch") === "stretch" && (isBlock(kid) || kid.t === "text");
    const across = rowDir
      ? stretchKid && kid.t !== "text"
        ? ih
        : kid._h
      : stretchKid
        ? iw
        : kid._w;
    const room = rowDir ? ih : iw;
    let offset = 0;
    const kidAlign = kid.self ?? align;
    if (kidAlign === "center") offset = (room - across) / 2;
    if (kidAlign === "end") offset = room - across;
    if (rowDir) place(kid, Math.round(cursor), Math.round(iy + offset), Math.round(along), Math.round(across));
    else place(kid, Math.round(ix + offset), Math.round(cursor), Math.round(across), Math.round(along));
    cursor += along + between;
  });
}

export function layout(root, width, height) {
  measure(root, width, true);
  place(root, 0, 0, width, height ?? root._h);
  return root;
}

/**
 * Where the node called `name` lands when `root` is laid out alone at
 * `width`, so a popover can be pinned to the control that opens it. The final
 * layout places everything again, so measuring early leaves no trace.
 */
export function locate(root, width, name, height) {
  layout(root, width, height);
  const stackOf = [root];
  while (stackOf.length) {
    const node = stackOf.pop();
    if (node.name === name) return { x: node._x, y: node._y, w: node._w, h: node._h };
    if (node.kids) stackOf.push(...node.kids);
  }
  throw new Error(`No node called ${name}`);
}

// ---- drawing -------------------------------------------------------------

const RADII = { none: 0, xs: 4, sm: 6, md: 10, lg: 14, xl: 20, pill: 999 };

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function radius(node) {
  const value = node.radius ?? 0;
  const r = typeof value === "number" ? value : RADII[value] ?? 0;
  return Math.min(r, node._w / 2, node._h / 2);
}

/**
 * Draws a laid-out tree. Every named node becomes a group carrying
 * `data-name` and `data-label`, which is what the comment tool selects, and
 * its rectangle is recorded so a pin or a link can find it again.
 */
export function draw(root, skin, ids) {
  // Names inside a muted subtree are not recorded: no comment pins to them.
  let muted = 0;
  const out = [];
  const rects = new Map();
  const seen = new Map();
  let clipCount = 0;
  // A node with `theme` repaints its subtree with its own roles, the way an
  // app that keeps its own palette tints its window. Plain ignores it: the
  // wireframe stays grey whatever the app wears.
  const themes = [];
  const paint = (role) => {
    if (role && themes.length && skin.id === "design") {
      const value = themes[themes.length - 1][role];
      if (value !== undefined) return value;
    }
    return skin.color(role);
  };

  function named(node) {
    if (!node.name || muted) return null;
    const count = seen.get(node.name) ?? 0;
    seen.set(node.name, count + 1);
    const name = count ? `${node.name}-${count + 1}` : node.name;
    rects.set(name, {
      x: node._x,
      y: node._y,
      w: node._w,
      h: node._h,
      label: node.label ?? name,
    });
    return name;
  }

  function walk(node) {
    if (node.theme) themes.push({ ...(themes[themes.length - 1] ?? {}), ...node.theme });
    const name = named(node);
    if (name) {
      out.push(
        `<g data-name="${esc(name)}" data-label="${esc(node.label ?? name)}"${node.opacity !== undefined ? ` opacity="${node.opacity}"` : ""}>`,
      );
    } else if (node.opacity !== undefined) out.push(`<g opacity="${node.opacity}">`);

    switch (node.t) {
      case "box": {
        const r = radius(node);
        if (node.shadow && skin.shadow) {
          // Two soft plates under the layer rather than a blur filter: a
          // filter is redrawn at every zoom step, and at a deep zoom a blur
          // the size of a dialog is what makes the board stutter. A theme may
          // name its own `shadow` colour, such as a grey that reads on black.
          const shade = (skin.id === "design" && themes[themes.length - 1]?.shadow) || paint("canvas");
          out.push(
            `<rect x="${node._x - 6}" y="${node._y + 14}" width="${node._w + 12}" height="${node._h + 10}" rx="${r + 6}" fill="${shade}" opacity="0.35"/>` +
              `<rect x="${node._x - 16}" y="${node._y + 26}" width="${node._w + 32}" height="${node._h + 20}" rx="${r + 16}" fill="${shade}" opacity="0.18"/>`,
          );
        }
        if (node.fill || node.stroke) {
          const strokeAttr = node.stroke
            ? ` stroke="${paint(node.stroke)}" stroke-width="${node.strokeWidth ?? 1}"${node.dash ? ` stroke-dasharray="${node.dash}"` : ""}`
            : "";
          const inset = node.stroke ? 0.5 : 0;
          out.push(
            `<rect x="${node._x + inset}" y="${node._y + inset}" width="${Math.max(0, node._w - inset * 2)}" height="${Math.max(0, node._h - inset * 2)}" rx="${r}" fill="${node.fill ? paint(node.fill) : "none"}"${strokeAttr}/>`,
          );
        }
        const rim = skin.id === "design" ? themes[themes.length - 1]?.rim : undefined;
        if (rim && node.stroke === "frame" && node._w > 120) {
          // A theme's `rim`: light caught on the top edge of a framed surface,
          // strongest in the middle and gone before the corners.
          const id = `${ids.prefix}-rim-${clipCount++}`;
          const inner = Math.min(r, node._h / 2);
          out.push(
            `<linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${rim}" stop-opacity="0"/><stop offset="0.3" stop-color="${rim}"/><stop offset="0.7" stop-color="${rim}"/><stop offset="1" stop-color="${rim}" stop-opacity="0"/></linearGradient>` +
              `<path d="M${node._x + inner} ${node._y + 1} H${node._x + node._w - inner}" stroke="url(#${id})" stroke-width="1.5" fill="none"/>`,
          );
        }
        if (node.dots) {
          // The dotted ground of Orpheus and Prism.
          out.push(
            `<rect x="${node._x}" y="${node._y}" width="${node._w}" height="${node._h}" rx="${r}" fill="url(#${ids.dots})"/>`,
          );
        }
        if (node.mesh) {
          // Blueprint's hexagonal ground, drawn once from the document's defs.
          out.push(
            `<rect x="${node._x}" y="${node._y}" width="${node._w}" height="${node._h}" rx="${r}" fill="url(#${ids.mesh})"/>`,
          );
        }
        if (node.edge) {
          // A single rule on one side, the way a rail or a header is ruled.
          const c = paint(node.edge.color ?? "border-subtle");
          const { side } = node.edge;
          // A wider rule stays inside the box, so it never reaches the next one.
          const w = node.edge.width ?? 1;
          const inset = w === 1 ? 0 : w / 2;
          const x1 = side === "right" ? node._x + node._w - (w === 1 ? 0.5 : inset) : side === "left" ? node._x + inset : node._x;
          const y1 = side === "bottom" ? node._y + node._h - (w === 1 ? 0.5 : inset) : side === "top" ? node._y + inset : node._y;
          const x2 = side === "bottom" || side === "top" ? node._x + node._w : x1;
          const y2 = side === "right" || side === "left" ? node._y + node._h : y1;
          out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`);
        }
        let closeClip = false;
        if (node.clip) {
          const id = `${ids.prefix}-clip-${clipCount++}`;
          out.push(
            `<clipPath id="${id}"><rect x="${node._x}" y="${node._y}" width="${node._w}" height="${node._h}" rx="${r}"/></clipPath><g clip-path="url(#${id})">`,
          );
          closeClip = true;
        }
        for (const kid of node.kids) walk(kid);
        if (closeClip) out.push("</g>");
        break;
      }
      case "text": {
        const { lines, lh, font, track } = node._text;
        const face = skin.face(font.face);
        const weight = skin.weight(font.face, font.weight);
        const anchor = node.align === "center" ? "middle" : node.align === "right" ? "end" : "start";
        const tx = anchor === "middle" ? node._x + node._w / 2 : anchor === "end" ? node._x + node._w : node._x;
        const color = paint(node.color ?? "text");
        const spans = lines
          .map(
            (line, i) =>
              `<tspan x="${tx}" y="${node._y + lh * i + lh / 2}">${esc(line)}</tspan>`,
          )
          .join("");
        out.push(
          `<text font-family="${esc(face)}" font-size="${font.size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" dominant-baseline="central"${track ? ` letter-spacing="${(track * font.size).toFixed(2)}"` : ""}${node.strike ? ' text-decoration="line-through"' : ""}>${spans}</text>`,
        );
        break;
      }
      case "icon": {
        const paths = iconOf(node.icon);
        if (!paths) throw new Error(`Unknown icon ${node.icon}`);
        const color = paint(node.color ?? "soft");
        out.push(
          `<svg x="${node._x}" y="${node._y}" width="${node._w}" height="${node._h}" viewBox="0 0 24 24" fill="${node.filled ? color : "none"}" stroke="${color}" stroke-width="${node.stroke ?? 2}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`,
        );
        break;
      }
      case "image": {
        const r = typeof node.radius === "number" ? node.radius : RADII[node.radius ?? "md"] ?? 0;
        if (node.src) {
          // A capture of something that exists, such as an app as it looks today.
          const id = `${ids.prefix}-clip-${clipCount++}`;
          out.push(
            `<clipPath id="${id}"><rect x="${node._x}" y="${node._y}" width="${node._w}" height="${node._h}" rx="${r}"/></clipPath>` +
              `<image href="${esc(node.src)}" x="${node._x}" y="${node._y}" width="${node._w}" height="${node._h}" preserveAspectRatio="${node.fit === "contain" ? "xMidYMid meet" : "xMidYMin slice"}" clip-path="url(#${id})"/>`,
          );
          break;
        }
        out.push(skin.image(node, r, ids));
        if (node.glyph && iconOf(node.glyph)) {
          const size = Math.min(node._w, node._h) * 0.36;
          out.push(
            `<svg x="${node._x + node._w - size * 0.95}" y="${node._y + node._h - size * 0.95}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${paint("dim")}" stroke-width="1.5" opacity="0.28" stroke-linecap="round" stroke-linejoin="round">${iconOf(node.glyph)}</svg>`,
          );
        }
        break;
      }
      case "vector": {
        const fill = node.fill ? paint(node.fill) : "none";
        const stroke = node.stroke ? paint(node.stroke) : "none";
        out.push(
          `<svg x="${node._x}" y="${node._y}" width="${node._w}" height="${node._h}" viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible">` +
            `<path d="${node.d}" fill="${fill}" stroke="${stroke}" stroke-width="${node.strokeWidth ?? 1.5}" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"${node.dash ? ` stroke-dasharray="${node.dash}"` : ""}/>` +
            `</svg>`,
        );
        break;
      }
      case "rule": {
        out.push(
          `<rect x="${node._x}" y="${node._y}" width="${node._w}" height="${node._h}" fill="${paint(node.color ?? "border-subtle")}"/>`,
        );
        break;
      }
      default:
        extraNodes[node.t]?.draw(node, api);
        break;
    }

    if (name || node.opacity !== undefined) out.push("</g>");
    if (node.theme) themes.pop();
  }

  // What a repository's node type draws with: the output, the walk, the colours and the skin of the
  // moment. `walk` draws a child (named children register for comments unless muted), `mute` runs work
  // with names dropped, `withSkin` runs work drawn in another skin and ids, `uid` makes an id.
  const api = {
    out,
    walk,
    paint,
    radius,
    esc,
    get skin() {
      return skin;
    },
    get ids() {
      return ids;
    },
    uid: (kind = "x") => `${ids.prefix}-${kind}-${clipCount++}`,
    mute(work) {
      muted += 1;
      try {
        work();
      } finally {
        muted -= 1;
      }
    },
    withSkin(nextSkin, nextIds, work) {
      const outerSkin = skin;
      const outerIds = ids;
      skin = nextSkin;
      ids = nextIds ?? ids;
      try {
        work();
      } finally {
        skin = outerSkin;
        ids = outerIds;
      }
    },
  };

  walk(root);
  return { svg: out.join(""), rects };
}
