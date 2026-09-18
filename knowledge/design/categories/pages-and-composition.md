# Pages and composition

Whole pages and how they are put together: the first viewport, landing sections, storytelling, the app shell, responsive structure and the finishing pass.

## First viewport and hero

Applies when: a hero is built or redesigned; a request says "the landing looks generic", "make the hero stronger"; the headline wraps into four lines; the hero is text over a gradient.

Options:

- **Split** with text on one side and the real visual on the other: the safe strong default.
- **Typographic statement** when the message is the design.
- **Pinned hero** that transforms as the page scrolls, when the subject has a gesture to perform.
- **The tool itself** as the first viewport, for a product whose mechanism is its best argument.

Build: A headline of two lines at most on a desktop in the display role, one supporting line, one primary and at most one secondary action, and a real visual beside it or none; a gradient never stands in for the visual.

Open: [design-specificity](../protocols/design-specificity.md), [composition-and-layout](../protocols/composition-and-layout.md), step 1; [pages-and-sections.md](../pages-and-sections.md), First viewport.

## Landing sections

Applies when: sections are added to a marketing page; features, pricing, proof, FAQ or a contact block are built; sections repeat one another.

Options:

- **One new question per section**, each with a short heading, a short paragraph and one visual or action.
- **Proof sections**: the product at work, case studies, real reviews, logos.
- **Conversion aids**: a call to action above the fold, a short FAQ, a response time promise near the contact form, a thank-you page.

Build: Each section a heading, a short paragraph and one visual or action, answering one new question; grids that fill exactly; a real close at the end.

Open: [composition-and-layout](../protocols/composition-and-layout.md), step 6; [pages-and-sections.md](../pages-and-sections.md), Sections; [site-polish.md](../site-polish.md).

## Storytelling and pacing

Applies when: a request says "add storytelling", "make it tell a story", or "the page is monotonous".

Options:

- **Pacing** by varying density, scale, imagery and quiet within one language.
- **A scroll sequence** carrying one idea across beats.
- **A narrative order** of sections, from problem to mechanism to proof to close, without added motion.

Build: Order the sections from problem to mechanism to proof to close, then add at most one scroll sequence for the gesture, with every beat reachable without it.

Open: [pages-and-sections.md](../pages-and-sections.md), Pacing and storytelling; [direction.md](../direction.md), Find the gesture; [motion category](motion.md), Scroll and storytelling.

## App shell and admin layout

Applies when: an admin, a panel, an editor or a management suite is laid out; a product needs a rail, a lead panel and cards.

Options:

- **Rail, lead panel, card grid, row lists**: the standard shell, restyled only through tokens.
- **Top bar and content** for apps with few sections.

Build: Skip link, a top bar for up to about five sections or a rail beyond that, `main` with one level-one heading per view, a lead panel and a card grid on the overview, focus moved to the heading on a route change, and the document title updated per view.

Open: [app-shell.md](../app-shell.md); [dashboards.md](../dashboards.md).

## Responsive structure

Applies when: a layout breaks at some width, scrolls sideways, hides functions on phones, or a request says "fix mobile".

Options:

- **Reflow** into fewer columns in the same order.
- **Reorder** so the primary content leads on narrow screens.
- **Container-driven components** that adapt to their slot rather than the viewport.

Build: Mobile first: one column below 40rem, structural changes at the widths where the content breaks, `min-width: 0` on grid and flex children that hold text, no horizontal page scroll at 320 CSS pixels.

Open: [responsive-behaviour](../protocols/responsive-behaviour.md); [pages-and-sections.md](../pages-and-sections.md), Widths.

## Finishing a site

Applies when: a site works but feels rough, is about to launch, or a request says "polish it" or "make it feel finished".

Options:

- **The build-first list**: search, mobile menu, hover states, form states, confirmation, FAQ, skip link, password toggle, copy button.
- **The by-site menu**: sticky header, progress bar, back to top, last updated, print styles, not-found page, breadcrumbs.
- **A critique pass** with fresh eyes before reporting it done.

Build: Walk the build-first list in [site-polish.md](../site-polish.md), then write the critique from captures before reading any number.

Open: [site-polish.md](../site-polish.md); [visual-critique](../protocols/visual-critique.md); [accessibility](../protocols/accessibility.md).
