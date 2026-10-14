// A board: screens placed on a canvas, and the links between them.
//
// A screen names its column and row and the board turns those into canvas
// positions, so a flow reads left to right and a branch drops below the step
// it leaves from, the way a flow is sketched on paper. A link can start from a
// named element inside its screen, which is how the arrow says which button
// leads where.

export const SCREEN_W = 1440;
export const SCREEN_H = 900;
export const GAP_X = 360;
export const GAP_Y = 420;

export function board({ id, title, note, screens, links = [], ...fields }) {
  const ids = new Set();
  for (const screen of screens) {
    if (ids.has(screen.id)) throw new Error(`Duplicate screen ${screen.id}`);
    ids.add(screen.id);
    screen.w ??= SCREEN_W;
    screen.h ??= SCREEN_H;
    screen.x ??= Math.round((screen.col ?? 0) * (SCREEN_W + GAP_X));
    screen.y ??= Math.round((screen.row ?? 0) * (SCREEN_H + GAP_Y));
  }
  for (const link of links) {
    if (!ids.has(link.from)) throw new Error(`Link from unknown screen ${link.from}`);
    if (!ids.has(link.to)) throw new Error(`Link to unknown screen ${link.to}`);
  }
  return { ...fields, id, title, note, screens, links };
}

/** Export the evaluated, registered module with the same layout and skin as Review. */
export function exportBoard(source, { layout, normalize, skin, sketch = null } = {}) {
  if (!source || !Array.isArray(source.screens) || typeof layout !== "function" || typeof normalize !== "function") throw new Error("import_unavailable");
  const screens = source.screens.map((screen) => {
    const root = typeof screen.root === "function" ? screen.root() : screen.root;
    if (!root) throw new Error("import_unavailable");
    return { ...screen, root: layout(structuredClone(root), screen.w ?? SCREEN_W, screen.h ?? SCREEN_H) };
  });
  return normalize({ ...source, screens }, { skin, sketch });
}
