# Navigation

How a person knows where they are and gets somewhere else: bars, rails, tabs, breadcrumbs, in-page aids and pagination. Every screen answers where am I, where can I go, and how do I get out.

## Top bar and mobile menu

Applies when: the site header or the main menu changes; the navigation wraps at tablet width; a mobile menu is added; a request says "the header is cluttered".

Options:

- **A single-line bar** of five or fewer items at desktop, named for what they contain, fitting on one line at about 1024 CSS pixels.
- **A mobile menu** opening as a drawer, reachable with the thumb, returning focus on close, once the destinations do not fit one row at 320 CSS pixels; four or fewer short ones stay visible.
- **A sticky header** on long pages, never covering a focused element, softened where it overlaps content rather than ruled off.

Build: A `header` holding a labelled `nav` of links, `aria-current="page"` on the active one. Up to four short destinations stay visible on a phone, on a second row when needed; more go into a drawer opened by a button with `aria-expanded`.

Open: [responsive-behaviour](../protocols/responsive-behaviour.md); [accessibility](../protocols/accessibility.md), step 3; [overlays.md](../overlays.md), Drawer and sheet.

## Side rail

Applies when: an admin, an editor or an app gets a side navigation; the rail collapses; the active item is unclear; the identity block or sign-out is added.

Options:

- **A fixed rail with labels** on desktop, the product mark on top and identity at the foot.
- **A collapsed icon rail** below about 900 CSS pixels, each icon named.
- **A bottom bar of three to five destinations** on phones for apps whose main sections are peers.

Build: About 15rem fixed on the start side, the product mark on top and the identity block at the foot; below about 900 CSS pixels it collapses to 4rem of icons from the set, each with an accessible name and a tooltip. Without an icon set, use a top bar.

Open: [app-shell.md](../app-shell.md); [assets-and-media](../protocols/assets-and-media.md), steps 1 and 2.

## Tabs and view switchers

Applies when: content is split into tabs; a segmented control switches a view; a chart switches range; the active tab is shown only by colour.

Options:

- **Tabs** for peer views of one object, the active tab marked by more than colour.
- **A segmented control** for two to four modes of the same view.
- **Separate pages** when the views are not peers or need their own address.

Build: The tabs pattern: a `tablist` of `tab` elements with `aria-selected` and `aria-controls`, each with its `tabpanel`; arrow keys move between tabs, Tab moves into the panel, and a tab activates on focus when its panel shows at once. The active tab is marked by surface or underline as well as colour.

Open: [animation.md](../animation.md), Recipes; [colour-and-theming](../protocols/colour-and-theming.md), step 6; [dashboards.md](../dashboards.md), Charts.

## Breadcrumbs and wayfinding

Applies when: a hierarchy is three or more levels deep; the current page is not marked; a person cannot tell where they are.

Options:

- **Breadcrumbs** on sites with real depth.
- **An active state and a current-page announcement** on every navigation item.
- **Progress** in a multi-step flow instead of breadcrumbs.

Build: A labelled `nav` holding an ordered list, the current page last with `aria-current="page"` and not a link.

Open: [site-polish.md](../site-polish.md); [app-shell.md](../app-shell.md), Navigation link.

## In-page aids

Applies when: a page is long; a skip link, back to top, scroll progress or table of contents is requested; anchors land under a fixed header.

Options:

- **A skip link** to the main content, first in the keyboard order, always.
- **Back to top and scroll progress** on very long pages only.
- **Anchored headings** with scroll margin so a fixed header never covers them.

Build: A skip link as the first element in the body, hidden until focused and then shown where it covers nothing, pointing at `main` with an id and `tabindex="-1"`; `scroll-margin-top` on anchored headings equal to the sticky header height.

Open: [accessibility](../protocols/accessibility.md), steps 3 and 7; [site-polish.md](../site-polish.md).

## Pagination and loading more

Applies when: a list or a result set is paged, loads on scroll, or loads with a button.

Options:

- **Pages** when people need to return to a position or share it.
- **Load more** for browsing where position matters less.
- **Infinite scroll** only where nothing important sits in the footer.

Build: Links carrying the page in the address, such as `?page=2`, the current page marked with `aria-current="page"`, and focus moved to the result summary after a page change.

Open: [interface-states](../protocols/interface-states.md), step 4; [states.md](../states.md), Loading.
