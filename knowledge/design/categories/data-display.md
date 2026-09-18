# Data display

Surfaces that report numbers: dashboards and overviews, charts, metrics, dense data tables and values that change live.

## Dashboards and overviews

Applies when: an overview, a home screen of an app or an admin landing is built; a dashboard feels busy; a request says "make the dashboard clearer".

Options:

- **Lead panel plus card grid**: a title and one status line, then one concept per card, critical content first along an F or Z path.
- **A focused overview** of three or four figures that each drive a decision, when the dashboard grew by accretion.
- **A report** with one committed category colour carrying the whole page, when the dashboard is read as a document.

Open: [composition-and-layout](../protocols/composition-and-layout.md); [dashboards.md](../dashboards.md), Layout, Cards; [app-shell.md](../app-shell.md), Overview.

## Charts

Applies when: a chart is added or restyled; series are told apart by colour only; a chart has no range control; a chart draws itself on every load.

Options:

- **No chart** when the values alone answer the question; a table or a sentence is faster.
- **Length on one scale** for magnitude and rank, **a line on a shared axis** for change over time, **proportion** for composition.
- **Direct labels** at the end of each series instead of a legend when there are few series.
- **A streaming chart** only for data that arrives live and scrolls with time.

Open: [colour-and-theming](../protocols/colour-and-theming.md), step 6; [dashboards.md](../dashboards.md), Charts; [composition-and-layout](../protocols/composition-and-layout.md), step 2.

## Metrics and figures

Applies when: big numbers, stat tiles, counters or comparisons are added; figures shift width; a row of numbers nobody acts on sits at the top.

Options:

- **A figure with its unit, period and comparison**, when it drives a decision.
- **A figure in plain layout** without a box on dense screens.
- **Removal**, when no decision depends on it.

Open: [dashboards.md](../dashboards.md), Figures; [hierarchy-and-type](../protocols/hierarchy-and-type.md), step 5; [defaults.md](../defaults.md), Page scaffolds.

## Dense data tables

Applies when: a table holds many rows and columns for daily work, is filtered and sorted, or is exported.

Options:

- **A dense table** with tabular numerals, a sticky header, sorting and filtering, and virtualization past about a thousand rows.
- **Column choice** for wide data: the person hides and reorders columns.
- **Row detail** in a side panel rather than an expanding row, when the detail is long.

Open: [containers.md](containers.md), Tables; [interface-states](../protocols/interface-states.md), step 7.

## Live and changing values

Applies when: values update in real time, counters tick, prices change, or status indicators pulse.

Options:

- **Digits that roll or morph in place** on tabular numerals, for a value the eye follows.
- **A quiet update** with no motion for values that change often.
- **A status dot** only when it carries a real state, at most one per section, with a text label.

Open: [animation.md](../animation.md), Recipes, Ambient motion is rare; [colour-and-theming](../protocols/colour-and-theming.md), step 6.
