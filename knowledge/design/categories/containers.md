# Containers

Surfaces that group content: cards, panels, lists and tables. Grouping with a card, a panel or a divider is a valid choice when it gathers one concept into a unit; the failure is a container that groups nothing or sits inside another of its kind.

## Cards

Applies when: cards are added, restyled or arranged in a grid; a card holds several unrelated figures; only a small link inside a card is clickable; cards sit inside cards; a request says "the cards look generic".

Options:

- **A card per concept**, marked by one soft shadow or one border, summarizing and linking to its detail.
- **The whole card as the target** when it has one action; separate controls, and a card that is not itself a link, when it has two or more.
- **No card**, spacing and a rule instead, when the grouping is already clear from proximity or the page is dense.
- **A grid that fills exactly**, as many cells as items, with mixed sizes when the content has a lead item.

Open: [composition-and-layout](../protocols/composition-and-layout.md), step 5; [dashboards.md](../dashboards.md), Cards; [ux-laws.md](../ux-laws.md), uniform connectedness; [defaults.md](../defaults.md), Page scaffolds.

## Panels and sections

Applies when: a page is divided into regions, a side panel or a lead panel is added, or sections change background to separate themselves.

Options:

- **Space and a heading** as the section boundary, the default on a continuous page.
- **A tinted band** within the same theme family to mark a change of topic; sections never invert the page theme.
- **A lead panel** at the top of an app overview, with a title and one status line.
- **A side panel** for detail next to a list on wide screens, a full screen or a sheet on phones.

Open: [composition-and-layout](../protocols/composition-and-layout.md); [app-shell.md](../app-shell.md), Overview; [tokens.md](../tokens.md), Themes.

## Lists and rows

Applies when: a list of records, files, messages or settings is built; rows are separated by borders; a list is long enough to scroll for a while.

Options:

- **A row list inside a panel**: each row a block with a radius and a hover surface, metadata small and secondary.
- **Grouped lists** with headers for settings and sectioned content.
- **One divider rule**, between rows or on the group, never both.
- **Virtualization or pagination** once the list runs to about a thousand rows.

Open: [app-shell.md](../app-shell.md), Lists and choices; [interface-states](../protocols/interface-states.md), step 7.

## Tables

Applies when: data is compared across columns; a table overflows on a phone; numbers do not align; a table has a rule on every cell.

Options:

- **A real table** when values are compared across columns: aligned numerals, a sticky header, sortable columns where it helps.
- **A row list** when each row is a thing rather than a set of values.
- **Cards on phones**: each row becomes a block with its labels, or the table scrolls on its own axis, which is the one place a second scroll axis is allowed.
- **Few rules**: zebra tint or row spacing instead of a grid of borders.

Open: [hierarchy-and-type](../protocols/hierarchy-and-type.md), step 5; [responsive-behaviour](../protocols/responsive-behaviour.md), step 4; [accessibility](../protocols/accessibility.md), step 6.
