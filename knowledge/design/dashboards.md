# Dashboards

A dashboard is read, not studied. It has a few seconds to say what the state of things is and where to go next, so its job is scanning speed and low cognitive load, not density.

This file covers what goes inside an overview surface and how it is arranged. The surrounding anatomy, the rail, the lead panel and the card grid, is in [app-shell.md](app-shell.md). The grid and the spacing bands are governed by [composition-and-layout](protocols/composition-and-layout.md), and every value comes from the tokens in [tokens.md](tokens.md).

## Layout

- **Work on a grid.** A grid gives the structure that carries hierarchy. Start from a plain wireframe and place each block by importance before any styling exists.
- **Order by importance, along the natural reading path.** The critical content sits along an F or Z path, so the eye lands on the outcome first and the supporting figures after.
- **Divide by concept.** One concept per card. A card carrying three unrelated figures is three cards.

## Cards

- **Summarize, then link.** A card carries the summary and an action that opens the detail. Long text belongs on the detail screen.
- **The whole card is the target when there is one action.** If the only thing a card does is open its detail, the entire card is clickable, not a link inside it, and the target then obeys the reach rules in [ux-laws.md](ux-laws.md). A card with two or more actions keeps them as separate controls and is not itself a link.
- **Mark the container.** A soft shadow or a border, so the card reads as one grouped unit, per uniform connectedness in [ux-laws.md](ux-laws.md). Subtle is the point: the edge marks the group, it does not add depth theatre.

## Figures

- **A number earns its tile by driving a decision.** A row of large figures that nobody acts on is the generic metric template, and it is removed rather than restyled. What remains shows the value, its unit, the period it covers and, where it matters, the comparison that says whether it is good.
- **Tabular numerals** on every figure that changes or sits beside a peer, so digits do not shift.

## Charts

- **Charts need their own navigation.** Switching the view and switching the date range are primary controls on the chart, visible without hunting, not buried in a global filter bar.
- **A chart only where a relationship is faster to see than to read.** Values alone never earn a chart. Magnitude and rank become length on one scale, change over time becomes a line on a shared axis, composition becomes proportion.
- **Colour encodes a series or a state, never decoration**, and every series has a second cue besides hue: a label at the end of the line, a pattern or a position.
- **Data the reader is acting on does not animate for style.** A chart that draws itself every time it loads delays the reading it exists for.

## Labels

- **Labels are the anchors for scanning.** Section titles, card labels and one naming convention let the eye jump to the right block instead of reading the page. Two cards naming the same metric differently break the scan.

## Checks

- [ ] Layout on a grid, with consistent alignment, critical content first along an F or Z path.
- [ ] One concept per card, each card grouped by shadow or border, summarizing and linking to detail.
- [ ] Whole card clickable when it has a single action.
- [ ] Every figure drives a decision and carries its unit and period.
- [ ] Charts expose a view switch and a date switch, and no series is told apart by colour alone.
- [ ] Section titles and labels consistent and scannable.
- [ ] Every value comes from the tokens.
