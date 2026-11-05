// Schema and semantic validation from Blueprint 026b172, packages/blueprint/src/core/model.ts
// and migrations.ts, with the font face fields (weight, style) from af453c7. Keep aligned with that
// upstream format; geometry-only traversal is omitted.
import { z } from "zod";
z.config({ jitless: true });
const SUPPORTED_FORMAT = 4;
export class BoardReadError extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}
const migrations = {
  1: v => ({ ...v, formatVersion: 2 }),
  2: v => ({ ...v, formatVersion: 3 }),
  3: v => ({ ...v, formatVersion: 4 }),
};
function migrateBoard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BoardReadError("unreadable");
  const input = value, version = input.formatVersion;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) throw new BoardReadError("unreadable");
  if (version > SUPPORTED_FORMAT) throw new BoardReadError("newer");
  let next = input, at = version;
  while (at < SUPPORTED_FORMAT) {
    const migrate = migrations[at];
    if (!migrate) throw new BoardReadError("unreadable");
    next = migrate(next); at++;
  }
  return next;
}
const id = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
const color = z.string().regex(/^(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?|none)$/);
const dimension = z.number().finite().min(1).max(16000);
const coordinate = z.number().finite().min(-100000).max(100000);
const shadow = z.object({ x: z.number().finite().min(-200).max(200), y: z.number().finite().min(-200).max(200), blur: z.number().finite().min(0).max(200), color, inset: z.boolean().optional(), visible: z.boolean().optional() }).strict();
const ratio = z.number().finite().min(0).max(1);
const angle = z.number().finite().min(-180).max(180);
const nonnegative = z.number().finite().min(0).max(16000);
const lineHeightSchema = z.number().finite().min(1).max(4000);
const letterSpacingSchema = z.number().finite().min(-100).max(1000);
const safeLink = z.string().max(2000).refine(v => /^https?:\/\//i.test(v));
const asset = z.string().regex(/^assets\/[0-9a-f-]{36}\.(png|jpg|webp|woff2|ttf|otf)$/);
const runSchema = z.object({ text: z.string().max(20000), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), href: safeLink.optional(), color: color.optional() }).strict();
const sharedTextValueSchema = z.object({ value: z.string().max(20000), runs: z.array(runSchema).max(1000).optional() }).strict().refine(v => !v.runs || v.runs.map(run => run.text).join("") === v.value);
const sharedTextSchema = z.object({ id, name: z.string().trim().min(1).max(200), values: z.object({ en: sharedTextValueSchema.optional(), es: sharedTextValueSchema.optional() }).strict() }).strict();
const stopSchema = z.object({ pos: ratio, color, opacity: ratio }).strict();
const stops = z.array(stopSchema).min(2).max(64);
const fillSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color, opacity: ratio, visible: z.boolean() }).strict(),
  z.object({ type: z.literal("linear"), angle, stops, visible: z.boolean() }).strict(),
  z.object({ type: z.literal("radial"), stops, visible: z.boolean(), center: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().optional(), size: z.number().min(0.05).max(4).optional() }).strict(),
  z.object({ type: z.literal("image"), src: asset, fit: z.enum(["fill", "fit", "crop", "tile"]), visible: z.boolean() }).strict(),
]);
const fillsSchema = z.array(fillSchema).max(32);
const anchorSchema = z.object({ h: z.enum(["left", "center", "right", "stretch"]), v: z.enum(["top", "middle", "bottom", "stretch"]) }).strict();
const stackSchema = z.object({ dir: z.enum(["column", "row"]), gap: nonnegative, pad: nonnegative, align: z.enum(["start", "center", "end", "stretch"]), grow: z.boolean(), fitCross: z.literal(true).optional() }).strict().refine(v => !v.fitCross || v.dir === "row" && v.align !== "stretch");
const gridSchema = z.object({ type: z.enum(["columns", "rows", "grid"]), count: z.number().int().min(1).max(1000), gutter: nonnegative, margin: nonnegative, size: z.number().finite().min(1).max(16000).optional(), color, opacity: ratio, visible: z.boolean() }).strict().refine(v => v.type === "grid" ? v.size !== undefined : v.size === undefined);
const overrideSchema = z.object({ value: z.string().max(20000).optional(), runs: z.array(runSchema).max(1000).optional(), fill: color.optional(), fills: fillsSchema.optional(), color: color.optional(), src: asset.optional(), hidden: z.boolean().optional(), textRef: id.nullable().optional() }).strict();
const styleRefsSchema = z.object({ fill: id.optional(), stroke: id.optional(), color: id.optional(), text: id.optional() }).strict();
const textStyleSchema = z.object({ id, name: z.string().trim().min(1).max(200), font: z.string().max(100).regex(/^[\p{L}\p{N} _-]+$/u), size: z.number().finite().min(1).max(1000), weight: z.number().int().min(100).max(900), lineHeight: lineHeightSchema.optional(), letterSpacing: letterSpacingSchema.optional() }).strict();
const stylesSchema = z.object({ colors: z.array(z.object({ id, name: z.string().trim().min(1).max(200), color }).strict()).max(1000), texts: z.array(textStyleSchema).max(1000) }).strict();
const nodeState = z.object({
  fill: color.optional(), scale: z.number().finite().min(.5).max(2).optional(), shadows: z.array(shadow).max(4).optional(),
  duration: z.number().int().min(0).max(2000).optional(), easing: z.enum(["ease-out", "ease-in-out", "linear"]).optional(),
}).strict();
const guideSchema = z.object({ axis: z.enum(["x", "y"]), pos: coordinate }).strict();
const nodeSchema = z.lazy(() => z.object({
  id, name: z.string().min(1).max(200), t: z.enum(["box", "text", "vector", "image", "icon"]),
  dir: z.literal("stack").optional(), place: z.object({ x: coordinate, y: coordinate }).strict(), w: dimension, h: dimension,
  fill: color.optional(), stroke: color.optional(), strokeWidth: z.number().min(0).max(100).optional(),
  radius: z.number().min(0).max(8000).optional(), corners: z.tuple([z.number().min(0).max(8000),z.number().min(0).max(8000),z.number().min(0).max(8000),z.number().min(0).max(8000)]).optional(),
  clip: z.boolean().optional(), fitContent: z.boolean().optional(), opacity: z.number().min(0).max(1).optional(),
  kind: z.enum(["rectangle", "circle", "polygon", "line", "arrow", "pen", "path"]).optional(), sides: z.number().int().min(3).max(64).optional(),
  d: z.string().max(100000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]*$/).optional(),
  value: z.string().max(20000).optional(), size: z.number().min(1).max(1000).optional(), weight: z.number().int().min(100).max(900).optional(),
  paddingX: z.number().finite().min(0).max(8000).optional(), font: z.string().max(100).regex(/^[\p{L}\p{N} _-]+$/u).optional(), color: color.optional(), align: z.enum(["left", "center", "right"]).optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(), shadows: z.array(shadow).max(4).optional(),
  blur: z.number().finite().min(0).max(100).optional(), pixelate: z.number().int().min(2).max(64).optional(),
  runs: z.array(runSchema).max(1000).optional(),
  icon: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/).optional(), src: asset.optional(), componentId: id.optional(), sourceId: id.optional(), kids: z.array(nodeSchema).max(2000).optional(),
  tokens: z.object({ fill: z.string().min(1).max(200).optional(), stroke: z.string().min(1).max(200).optional(), color: z.string().min(1).max(200).optional(), radius: z.string().min(1).max(200).optional(), size: z.string().min(1).max(200).optional(), font: z.string().min(1).max(200).optional(), weight: z.string().min(1).max(200).optional() }).strict().optional(),
  states: z.object({ hover: nodeState.optional(), pressed: nodeState.optional() }).strict().optional(), manualParent: z.boolean().optional(),
  guides: z.array(guideSchema).max(1000).optional(),
  rotation: angle.optional(), pivot: z.object({ x: ratio, y: ratio }).strict().optional(), flipX: z.boolean().optional(), flipY: z.boolean().optional(),
  anchor: anchorSchema.optional(), stack: stackSchema.optional(), fills: fillsSchema.optional(),
  strokeAlign: z.enum(["inside", "center", "outside"]).optional(), strokeGradient: fillSchema.refine(f => f.type === "linear" || f.type === "radial").optional(), dash: z.tuple([z.number().finite().min(0).max(1000), z.number().finite().min(0).max(1000)]).refine(v => v[0] + v[1] > 0).optional(),
  backgroundBlur: z.number().finite().min(0).max(100).optional(),
  blend: z.enum(["normal", "darken", "multiply", "color-burn", "lighten", "screen", "color-dodge", "overlay", "soft-light", "hard-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]).optional(),
  effectsHidden: z.array(z.enum(["blur", "pixelate", "backgroundBlur"])).max(3).refine(v => new Set(v).size === v.length).optional(),
  lineHeight: lineHeightSchema.optional(), letterSpacing: letterSpacingSchema.optional(), sizing: z.enum(["auto-width", "auto-height", "fixed"]).optional(),
  overrides: z.record(id, overrideSchema).refine(v => Object.keys(v).length <= 10000).optional(), grids: z.array(gridSchema).max(32).optional(),
  hidden: z.boolean().optional(), locked: z.boolean().optional(), mask: z.literal(true).optional(), styleRefs: styleRefsSchema.optional(),
  textRef: id.optional(), imagePlaceholder: z.literal(true).optional(),
}).strict());
function componentOrder(board) {
  const all=nodes(board), done=new Set (), active=new Set (), ordered =[];
  function visit(component) {
    if(done.has(component.id))return;
    if(active.has(component.id))throw new Error("component_cycle");
    active.add(component.id);
    const original=all.find(n=>n.node.id===component.nodeId)?.node;
    for(const node of original?nodesIn(original):[])if(node.componentId){const dependency=board.components.find(c=>c.id===node.componentId);if(dependency)visit(dependency);}
    active.delete(component.id);done.add(component.id);ordered.push(component);
  }
  board.components.forEach(visit);return ordered;
}
const boardSchema = z.object({
  formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), id, title: z.string().min(1).max(200), note: z.string().max(2000),
  styles: stylesSchema.optional(),
  texts: z.array(sharedTextSchema).max(1000).optional(),
  pages: z.array(z.object({ id, title: z.string().min(1).max(200), objects: z.array(nodeSchema).max(2000), start: id.optional(), order: z.array(id).max(500), guides: z.array(guideSchema).max(1000).optional() }).strict()).min(1).max(100),
  screens: z.array(z.object({ id, title: z.string().min(1).max(200), pageId: id, x: coordinate, y: coordinate, w: dimension, h: dimension, root: nodeSchema, build: z.object({ url: safeLink }).strict().optional(), lang: z.enum(["en", "es"]).optional() }).strict()).max(500),
  links: z.array(z.object({
    id, from: id, to: id, element: id.optional(), transition: z.enum(["cut", "fade", "slide", "smart"]),
    open: z.enum(["screen", "overlay"]).optional(),
    overlay: z.object({ position: z.enum(["center", "top", "bottom", "manual"]), closeOutside: z.boolean(), dim: z.boolean() }).strict().optional(),
    direction: z.enum(["left", "right", "up", "down"]).optional(),
    duration: z.number().int().min(0).max(2000).optional(), easing: z.enum(["ease-out", "ease-in-out", "linear"]).optional(),
  }).strict()).max(2000),
  components: z.array(z.object({ id, nodeId: id, title: z.string().min(1).max(200) }).strict()).max(500),
  fonts: z.array(z.object({ id, family: z.string().regex(/^[\p{L}\p{N} _-]{1,100}$/u), src: asset, weight: z.number().int().min(100).max(900).optional(), style: z.enum(["normal", "italic"]).optional() }).strict()).max(100),
  tokens: z.object({ source: z.string().max(300), syncedAt: z.string().datetime(), values: z.array(z.object({ name: z.string().min(1).max(200), css: z.string().regex(/^--[A-Za-z0-9_-]{1,200}$/), type: z.enum(["color", "dimension", "fontFamily", "fontWeight", "other"]), value: z.string().max(500) }).strict()).max(2000) }).strict().optional(),
  threads: z.array(z.object({ id, screen: id.optional(), page: id.optional(), path: z.array(id).max(30), marker: z.object({ x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) }).strict().optional(), resolved: z.boolean(), resolvedBy: z.string().min(1).max(100).optional(), resolvedAt: z.string().datetime().optional(), replies: z.array(z.object({ id, author: z.string().max(100), text: z.string().max(20000), createdAt: z.string().datetime() }).strict()).max(1000) }).strict()).max(2000),
}).strict();
function validateKnownBoard(value) {
  // Bound recursion before the recursive schema, including V03 effect data on large boards.
  let count = 0;
  function bounded(v, depth) {
    if (depth > 65 || ++count > 120000) throw new Error("invalid");
    if (v && typeof v === "object") for (const child of Object.values(v)) bounded(child, depth + 1);
  }
  bounded(value, 0);
  const board = boardSchema.parse(value);
  const ids = new Set ();
  const take = (key) => { if (ids.has(key)) throw new Error("invalid"); ids.add(key); };
  board.pages.forEach(p => take(p.id)); board.screens.forEach(s => take(s.id));
  board.styles?.colors.forEach(style => take(style.id)); board.styles?.texts.forEach(style => take(style.id));
  board.texts?.forEach(text => take(text.id));
  const all = nodes(board);
  if (all.length > 10000 || all.some(n => n.path.length > 30)) throw new Error("invalid");
  all.forEach(n => take(n.node.id));
  board.components.forEach(c => { take(c.id); if (!all.some(n => n.node.id === c.nodeId && n.node.t === "box")) throw new Error("invalid"); });
  for (const n of all) if (n.node.componentId && !board.components.some(c => c.id === n.node.componentId)) throw new Error("invalid");
  for (const c of board.components) {
    const original = all.find(n => n.node.id === c.nodeId) .node;
    if (original.componentId || nodesIn(original).some(n => n.componentId === c.id)) throw new Error("invalid");
  }
  componentOrder(board);
  for (const s of board.screens) if (!board.pages.some(p => p.id === s.pageId) || s.root.w !== s.w || s.root.h !== s.h) throw new Error("invalid");
  for (const p of board.pages) {
    const own = board.screens.filter(s => s.pageId === p.id).map(s => s.id);
    if (p.order.some(s => !own.includes(s)) || new Set(p.order).size !== p.order.length || (p.start && !own.includes(p.start))) throw new Error("invalid");
  }
  for (const link of board.links) {
    take(link.id);
    const from = board.screens.find(s => s.id === link.from), to = board.screens.find(s => s.id === link.to);
    if (!from || !to || from.pageId !== to.pageId || (link.element && !nodesIn(from.root).some(n => n.id === link.element))) throw new Error("invalid");
  }
  const faced = new Set();
  for (const font of board.fonts) {
    take(font.id); if (!/\.(woff2|ttf|otf)$/.test(font.src)) throw new Error("invalid");
    // An entry without weight and style is the old form and is left as it was; the others are one per family, weight and style.
    if (font.weight !== undefined || font.style !== undefined) { const face = JSON.stringify([font.family, font.weight, font.style ?? "normal"]); if (faced.has(face)) throw new Error("invalid"); faced.add(face); }
  }
  for (const { node } of all) {
    if (node.t === "box" && (!node.kids || node.dir !== "stack")) throw new Error("invalid");
    if (node.t === "image" && (!node.src || !/\.(png|jpg|webp)$/.test(node.src))) throw new Error("invalid");
    if (node.t === "vector" && !node.d) throw new Error("invalid");
    if (node.runs && node.runs.map(r => r.text).join("") !== node.value) throw new Error("invalid");
    if (node.stack && node.t !== "box") throw new Error("invalid");
    if (node.mask && (node.t !== "box" || (node.kids?.length ?? 0) < 2)) throw new Error("invalid");
    if (node.grids && !board.screens.some(screen => screen.root === node)) throw new Error("invalid");
    if (node.overrides && !node.componentId) throw new Error("invalid");
    if (node.sizing && node.t !== "text") throw new Error("invalid");
    if (node.textRef !== undefined && node.t !== "text") throw new Error("invalid");
    if (node.imagePlaceholder !== undefined && node.t !== "box") throw new Error("invalid");
    for (const override of Object.values(node.overrides ?? {})) if (override.runs && override.runs.map(run => run.text).join("") !== override.value) throw new Error("invalid");
  }
  for (const thread of board.threads) {
    take(thread.id);
    if (new Set(thread.path).size !== thread.path.length || !thread.replies.length || !thread.screen === !thread.page) throw new Error("invalid");
    const anchor = all.find(n => n.node.id === thread.path.at(-1));
    if (thread.screen) {
      if (thread.path.length < 2 || thread.path[0] !== thread.screen) throw new Error("invalid");
      // A frame thread whose layer has left every frame keeps its last frame path as an inactive orphan.
      if (anchor?.screen && JSON.stringify(anchor.path) !== JSON.stringify(thread.path)) throw new Error("invalid");
    } else {
      if (!board.pages.some(p => p.id === thread.page) || !thread.path.length && !thread.marker) throw new Error("invalid");
      if (anchor && !anchor.screen && JSON.stringify(anchor.path) !== JSON.stringify(thread.path)) throw new Error("invalid");
    }
    thread.replies.forEach(reply => { take(reply.id); if (!reply.author.trim() || !reply.text.trim()) throw new Error("invalid"); });
  }
  return board;
}
export function validateBoard(value) {
  try { return validateKnownBoard(migrateBoard(value)); }
  catch (error) { if (error instanceof BoardReadError) throw error; throw new BoardReadError("unreadable"); }
}
function nodesIn(root) { return [root, ...(root.kids ?? []).flatMap(nodesIn)]; }
function nodes(board) {
 const out = [];
 const walk = (node, page, path, screen) => {
  out.push({ node, page, screen, path: [...path, node.id] });
  for (const child of node.kids ?? []) walk(child, page, [...path, node.id], screen);
 };
 for (const page of board.pages) {
  for (const node of page.objects) walk(node, page, []);
  for (const screen of board.screens.filter(screen => screen.pageId === page.id)) walk(screen.root, page, [screen.id], screen);
 }
 return out;
}
