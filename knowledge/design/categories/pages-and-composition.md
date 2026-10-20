# Pages and composition

Whole pages and how they are put together: the first viewport, landing sections, storytelling, the app shell, responsive structure, mobile screens, email layout and the finishing pass.

## First viewport and hero

Applies when: a hero is built or redesigned; a request says "the landing looks generic", "make the hero stronger"; the headline wraps into four lines; the hero is text over a gradient.

Build: A headline of two lines at most on a desktop in the display role, one supporting line, one primary and at most one secondary action, and a real visual beside it or none; a gradient never stands in for the visual.

Options:

- **Split** with text on one side and the real visual on the other: the safe strong default.
- **Typographic statement** when the message is the design.
- **Pinned hero** that transforms as the page scrolls, when the subject has a gesture to perform.
- **The tool itself** as the first viewport, for a product whose mechanism is its best argument.

Open: [design-specificity](../protocols/design-specificity.md), [composition-and-layout](../protocols/composition-and-layout.md), step 1; [pages-and-sections.md, First viewport](../pages-and-sections.md#first-viewport).

## Landing sections

Applies when: sections are added to a marketing page; features, pricing, proof, FAQ or a contact block are built; sections repeat one another.

Build: Each section a heading, a short paragraph and one visual or action, answering one new question; grids that fill exactly; a real close at the end.

Options:

- **One new question per section**, each with a short heading, a short paragraph and one visual or action.
- **Proof sections**: the product at work, case studies, real reviews, logos.
- **Conversion aids**: a call to action above the fold, a short FAQ, a response time promise near the contact form, a thank-you page.

Open: [composition-and-layout](../protocols/composition-and-layout.md), step 6; [pages-and-sections.md, Sections](../pages-and-sections.md#sections); [site-polish.md](../site-polish.md).

## Storytelling and pacing

Applies when: a request says "add storytelling", "make it tell a story", or "the page is monotonous".

Build: Order the sections from problem to mechanism to proof to close, then add at most one scroll sequence for the gesture, with every beat reachable without it.

Options:

- **Pacing** by varying density, scale, imagery and quiet within one language.
- **A scroll sequence** carrying one idea across beats.
- **A narrative order** of sections, from problem to mechanism to proof to close, without added motion.

Open: [pages-and-sections.md, Pacing and storytelling](../pages-and-sections.md#pacing-and-storytelling); [direction.md, Find the gesture](../direction.md#find-the-gesture); [motion category, Scroll and storytelling](motion.md#scroll-and-storytelling).

## App shell and admin layout

Applies when: an admin, a panel, an editor or a management suite is laid out; a product needs a rail, a lead panel and cards.

Build: Skip link, a top bar for up to about five sections or a rail beyond that, `main` with one level-one heading per view, a lead panel and a card grid on the overview, focus moved to the heading on a route change, and the document title updated per view.

Options:

- **Rail, lead panel, card grid, row lists**: the standard shell, restyled only through tokens.
- **Top bar and content** for apps with few sections.

Open: [app-shell.md](../app-shell.md); [dashboards.md](../dashboards.md).

## Responsive structure

Applies when: a layout breaks at some width, scrolls sideways, hides functions on phones, or a request says "fix mobile".

Build: Mobile first: one column below 40rem, structural changes at the widths where the content breaks, `min-width: 0` on grid and flex children that hold text, no horizontal page scroll at 320 CSS pixels.

Options:

- **Reflow** into fewer columns in the same order.
- **Reorder** so the primary content leads on narrow screens.
- **Container-driven components** that adapt to their slot rather than the viewport.

Open: [responsive-behaviour](../protocols/responsive-behaviour.md); [pages-and-sections.md, Widths](../pages-and-sections.md#widths).

## Mobile screens

Applies when: a screen is built or reviewed for a phone, native or web; a request says "the buttons are too small on the phone", "make it feel like an app"; bars, rows or margins need sizes.

Build: Use the mobile rows of [essentials.md](../essentials.md), Default values, as written unless the project's design system says otherwise. Size the touch area first and seat the visual inside it, keep the bars and the content inside the safe areas, and keep every gap on the 4 or 8 base.

Options:

- **The platform sizes** in the mobile rows of [essentials.md](../essentials.md): the default when the project sets none.
- **The project's design system sizes**, when it states them; they win over the platform values.
- **A hit area larger than the visual**, when a small icon or control has to stay small to look right.

Open: [responsive-behaviour](../protocols/responsive-behaviour.md), steps 5 and 7; [accessibility](../protocols/accessibility.md), step 4; [actions, Floating and sticky actions](actions.md#floating-and-sticky-actions); [ux-laws.md, Pointing and reach](../ux-laws.md#pointing-and-reach).

## Email layout

Applies when: an HTML email template is designed or built, transactional, digest or newsletter; a message renders broken in a mail client or in its dark mode.

Build: One column at most 600 CSS pixels wide, laid out with tables and inline styles, since mail clients drop most stylesheets; a system font stack; body text at 16 pixels with line height 1.5; one primary action as a styled link at least 44 pixels high, never an image; every image with a width, a height and alternative text, and the message still readable with images off; logos and marks checked on a dark background; the preview text set; a plain-text part with the same content; nothing that needs script, a form or a web font.

Options:

- **Plain text alone** for mail a person sends on someone's behalf, or for a product whose mail is mostly words.
- **A branded template** shared by every message, its colours and mark from the tokens.

Open: [accessibility](../protocols/accessibility.md), step 7; [messages.md, Email](../../copy/messages.md#email) for the words and the sender.

## Finishing a site

Applies when: a site works but feels rough, is about to launch, or a request says "polish it" or "make it feel finished".

Build: Walk the build-first list in [site-polish.md](../site-polish.md), then write the critique from captures before reading any number.

Options:

- **The build-first list**: search, mobile menu, hover states, form states, confirmation, FAQ, skip link, password toggle, copy button.
- **The by-site menu**: sticky header, progress bar, back to top, last updated, print styles, not-found page, breadcrumbs.
- **A critique pass** with fresh eyes before reporting it done.

Open: [site-polish.md](../site-polish.md); [visual-critique](../protocols/visual-critique.md); [accessibility](../protocols/accessibility.md).
