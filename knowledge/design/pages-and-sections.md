# Pages and sections

How a page is composed from its first viewport to its close. The measured checks run in [composition-and-layout](protocols/composition-and-layout.md) and [responsive-behaviour](protocols/responsive-behaviour.md); the finishing additions a site needs are in [site-polish.md](site-polish.md).

## First viewport

- **A thesis, not a header.** Within seconds the visitor knows what this is, why it matters and what to do. The first screen shows the mechanism or the evidence at full scale rather than a masthead and orientation copy.
- **Memory test.** A visitor who saw only the first screen can describe something concrete an hour later, not only a mood.
- **Four text elements at most**: an optional short label, the headline, one supporting line, and the actions. Trust strips, bullets and pricing teasers go in the sections below.
- **The headline fits in two lines on a desktop** and the supporting line in about twenty words. A headline that breaks into four lines means the size is wrong, not the copy. Type size and image size are planned together.
- **One primary action and at most one secondary**, visible without scrolling, each labelled in three words or fewer and fitting on one line.
- **A real visual.** Text over a gradient is a placeholder. The visual is a real screenshot, a photograph, a working piece of the product or an authored image; a fake product screenshot built from styled boxes is refused.
- **Presence comes from type and asset, not padding.** Top padding stays modest; a hero that needs more presence grows its type or its image. A full-height hero uses the dynamic viewport unit so it does not jump on phones.
- **Layout options.** A split with text on one side and the asset on the other; a typographic statement when the message is the design; text masking video or an image; a pinned hero that transforms as the page scrolls. Centred works when the message itself is the design.

## Sections

- **Each section answers a new question.** Two sections that restate one claim in new words add length, not substance, and are merged. Proof beats claims: show the product at work.
- **A section's default shape** is a short heading, a short paragraph, and one visual or one action. More needs a reason.
- **Vary the families.** A layout family appears once per page, and no more than two image-and-text alternating rows run in a row before a full-width, stacked or grid section breaks the run.
- **Grids fill exactly.** A bento or feature grid has as many cells as items: three items become one plus two, five become two plus three. No empty tile, and no row of identical cards as the whole structure of the page.
- **Lists on marketing pages stay short.** The top three to five items with a link to the rest, rather than a dump.
- **Specification lists avoid a rule on every row.** A few labelled clusters, or three or four headline values with the rest behind a disclosure.
- **Logos** sit in their own band directly under the hero, as real marks that work in both themes, never as plain text.
- **Quotes** run three lines at most, attributed with a name and a role.
- **Short labels above headings are rationed** on marketing pages: a few across the page, never one on every section. In an app shell a small label naming a card's kind is a choice, per [app-shell.md](app-shell.md).
- **End on a real close**: a final action, a summary or a next step, not a fade into the footer.

## Pacing and storytelling

- **Pace the scroll.** Vary density, scale, imagery and quiet within one visual language. A dense passage earns a quiet one after it.
- **Storytelling is a sequence the reader controls.** Pinned sections that change through several beats, a horizontal track scrubbed by vertical scroll, a path that draws as the reader advances, a stack of cards replacing each other. Each carries one idea across beats; none is added for its own sake.
- **One committed gesture per page**, from [direction.md](direction.md), beats effects spread across every section.
- **Storytelling never hides content.** Everything a scroll sequence reveals is also reachable without it, under reduced motion and without script.

## Geometry of the content

Map the material to a visual variable before choosing components: magnitude and rank to position or length on one scale, change over time to horizontal order, composition to proportion, a threshold to distance from a boundary, a process to connection and sequence, alternatives to aligned rows or deliberately contrasted columns.

## Widths

- Page content is contained at a comfortable maximum width and centred; reading prose takes about six or seven columns of a twelve-column desktop grid, evidence may take the full width.
- Breakpoints sit where the content breaks, commonly near 640, 768, 1024 and 1280 CSS pixels. A component that appears in several contexts responds to its container rather than to the viewport.
- Responsive change is structural: reorder, collapse, reflow, reveal. Core functions are never hidden on small screens, and a tablet restructures into two columns rather than stretching the phone layout.
- Every multi-column section states its single-column arrangement below the tablet width in the same component.
