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

export function board({ id, title, note, screens, links = [] }) {
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
  return { id, title, note, screens, links };
}
