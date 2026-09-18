# Containers

Surfaces that group content: cards, panels, lists and tables. Grouping with a card, a panel or a divider is a valid choice when it gathers one concept into a unit; the failure is a container that groups nothing or sits inside another of its kind.

## Cards

Applies when: cards are added, restyled or arranged in a grid; a card holds several unrelated figures; only a small link inside a card is clickable; cards sit inside cards; a request says "the cards look generic".

Options:

- **A card per concept**, marked by one soft shadow or one border, summarizing and linking to its detail.
- **The whole card as the target** when it has one action; separate controls, and a card that is not itself a link, when it has two or more.
- **No card**, spacing and a rule instead, when the grouping is already clear from proximity or the page is dense.
- **A grid that fills exactly**, as many cells as items at every width, with mixed sizes when the content has a lead item. Auto-fit columns suit open-ended collections, where a short last row is expected.

Build: One concept per card with one border or one soft shadow; the whole card is the target through one stretched link when it has one action. For a known count, column counts that divide it at each breakpoint, or a lead card that spans; `repeat(auto-fit, minmax(min(100%, 17.5rem), 1fr))` only for open-ended collections.

Open: [composition-and-layout](../protocols/composition-and-layout.md), step 5; [dashboards.md](../dashboards.md), Cards; [ux-laws.md](../ux-laws.md), uniform connectedness; [defaults.md](../defaults.md), Page scaffolds.

## Panels and sections

Applies when: a page is divided into regions, a side panel or a lead panel is added, or sections change background to separate themselves.

Options:

- **Space and a heading** as the section boundary, the default on a continuous page.
- **A tinted band** within the same theme family to mark a change of topic; sections never invert the page theme.
- **A lead panel** at the top of an app overview, with a title and one status line.
- **A side panel** for detail next to a list on wide screens, a full screen or a sheet on phones.

Build: Sections separated by space and a heading; a tinted band stays inside the page theme; an overview opens with a lead panel holding a label, a title and one status line.

Open: [composition-and-layout](../protocols/composition-and-layout.md); [app-shell.md](../app-shell.md), Overview; [tokens.md](../tokens.md), Themes.

## Lists and rows

Applies when: a list of records, files, messages or settings is built; rows are separated by borders; a list is long enough to scroll for a while.

Options:

- **A row list inside a panel**: each row a block with a radius and a hover surface that keeps its text at target, metadata small and secondary.
- **Grouped lists** with headers for settings and sectioned content.
- **One divider rule**, between rows or on the group, never both.
- **Virtualization or pagination** once the list runs to about a thousand rows.

Build: A `ul` of rows, each a block with one target and a hover surface one step from the list surface, its text still at its contrast target; one divider rule between rows or none.

Open: [app-shell.md](../app-shell.md), Lists and choices; [interface-states](../protocols/interface-states.md), step 7.

## Tables

Applies when: data is compared across columns; a table overflows on a phone; numbers do not align; a table has a rule on every cell.

Options:

- **A real table** when values are compared across columns: aligned numerals, a sticky header, sortable columns where it helps.
- **A row list** when each row is a thing rather than a set of values.
- **Cards on phones**: each row becomes a block with its labels, or the table scrolls on its own axis, which is the one place a second scroll axis is allowed.
- **Few rules**: zebra tint or row spacing instead of a grid of borders.

Build: A real `table` with a `caption` and `th` with `scope`; numeric columns right-aligned in `tabular-nums`; a sticky header; sortable columns as a `button` inside the `th`, with `aria-sort` on the sorted header only. Where the columns start to squeeze, each row becomes a card with its labels, or the table scrolls inside its own container.

Open: [hierarchy-and-type](../protocols/hierarchy-and-type.md), step 5; [responsive-behaviour](../protocols/responsive-behaviour.md), step 4; [accessibility](../protocols/accessibility.md), step 6.
