# Navigation

How a person knows where they are and gets somewhere else: bars, rails, tabs, breadcrumbs, in-page aids and pagination. Every screen answers where am I, where can I go, and how do I get out.

## Top bar and mobile menu

Applies when: the site header or the main menu changes; the navigation wraps at tablet width; a mobile menu is added; a request says "the header is cluttered".

Options:

- **A single-line bar** of five or fewer items at desktop, named for what they contain, fitting on one line at about 1024 CSS pixels.
- **A mobile menu** opening as a drawer, reachable with the thumb, returning focus on close.
- **A sticky header** on long pages, never covering a focused element, softened where it overlaps content rather than ruled off.

Open: [responsive-behaviour](../protocols/responsive-behaviour.md); [accessibility](../protocols/accessibility.md), step 3; [overlays.md](../overlays.md), Drawer and sheet.

## Side rail

Applies when: an admin, an editor or an app gets a side navigation; the rail collapses; the active item is unclear; the identity block or sign-out is added.

Options:

- **A fixed rail with labels** on desktop, the product mark on top and identity at the foot.
- **A collapsed icon rail** below about 900 CSS pixels, each icon named.
- **A bottom bar of three to five destinations** on phones for apps whose main sections are peers.

Open: [app-shell.md](../app-shell.md); [assets-and-media](../protocols/assets-and-media.md), steps 1 and 2.

## Tabs and view switchers

Applies when: content is split into tabs; a segmented control switches a view; a chart switches range; the active tab is shown only by colour.

Options:

- **Tabs** for peer views of one object, the active tab marked by more than colour.
- **A segmented control** for two to four modes of the same view.
- **Separate pages** when the views are not peers or need their own address.

Open: [animation.md](../animation.md), Recipes; [colour-and-theming](../protocols/colour-and-theming.md), step 6; [dashboards.md](../dashboards.md), Charts.

## Breadcrumbs and wayfinding

Applies when: a hierarchy is three or more levels deep; the current page is not marked; a person cannot tell where they are.

Options:

- **Breadcrumbs** on sites with real depth.
- **An active state and a current-page announcement** on every navigation item.
- **Progress** in a multi-step flow instead of breadcrumbs.

Open: [site-polish.md](../site-polish.md); [app-shell.md](../app-shell.md), Navigation link.

## In-page aids

Applies when: a page is long; a skip link, back to top, scroll progress or table of contents is requested; anchors land under a fixed header.

Options:

- **A skip link** to the main content, first in the keyboard order, always.
- **Back to top and scroll progress** on very long pages only.
- **Anchored headings** with scroll margin so a fixed header never covers them.

Open: [accessibility](../protocols/accessibility.md), steps 3 and 7; [site-polish.md](../site-polish.md).

## Pagination and loading more

Applies when: a list or a result set is paged, loads on scroll, or loads with a button.

Options:

- **Pages** when people need to return to a position or share it.
- **Load more** for browsing where position matters less.
- **Infinite scroll** only where nothing important sits in the footer.

Open: [interface-states](../protocols/interface-states.md), step 4; [states.md](../states.md), Loading.
