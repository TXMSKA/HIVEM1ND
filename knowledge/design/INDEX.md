module: design
purpose: Interface design by category, from tokens to whole pages, with the passes that prove it.

Read this file, open only the category the work touches, and from there only the protocols and topic sections it names; a change that matches no category is not a design change. A build from scratch or a whole-surface pass reads [essentials.md](essentials.md) first. A `Build:` line is the recipe to start from, the floors in essentials.md are what a surface must meet, and a plan cites a subcategory by its heading link, such as `categories/forms.md#layout`.

## Categories

- [foundations](categories/foundations.md): tokens, type, spacing and density, colour, theme and dark mode, light theme, direction and restyle, shape and depth, writing direction.
- [text-and-content](categories/text-and-content.md): headings, body text and reading, lists and FAQs, figures in text, quotes and proof, code and copyable values.
- [inputs-and-controls](categories/inputs-and-controls.md): text input, select and menu of options, checkbox and radio, toggle, date and number, search, file upload and drop zone, rich-text editor.
- [forms](categories/forms.md): layout, validation and errors, submission and success, consent and honest choices, multi step, sign-up and first use, settings and autosave.
- [actions](categories/actions.md): buttons, links, action menus, floating and sticky actions, copy and share.
- [containers](categories/containers.md): cards, panels and sections, lists and rows, tables.
- [navigation](categories/navigation.md): top bar and mobile menu, side rail, tabs, breadcrumbs, in-page aids, pagination.
- [overlays](categories/overlays.md): modal, drawer and sheet, popover, toast, tooltip, banners and consent, permission requests.
- [states](categories/states.md): empty, loading, error, success, disabled, first use, not found.
- [data-display](categories/data-display.md): dashboards, charts, metrics, dense tables, live values.
- [media-and-icons](categories/media-and-icons.md): icons, images, video, fonts, brand marks, illustration and texture.
- [motion](categories/motion.md): entrances, feedback, state transitions, scroll and storytelling, gestures, reduced motion.
- [pages-and-composition](categories/pages-and-composition.md): hero, landing sections, storytelling, app shell, responsive structure, mobile screens, email layout, finishing a site.

## Routing

The protocol steps each category sends work to. [steps.md](steps.md) says what each step checks, and a protocol is opened only when one of its steps will run. Topic sections are read as the Open line of each subcategory touched, or a protocol step, names them. How a step ends and records its evidence is in [evidence.md](evidence.md).

| Category | Protocols and steps |
| --- | --- |
| every rendered surface | accessibility 1 to 7; visual-critique 1 to 8 |
| foundations | colour-and-theming 1 to 7; light-theme 1 to 8 (light theme); hierarchy-and-type 1, 2, 6; composition-and-layout 4; responsive-behaviour 4 (right-to-left); design-specificity 1 to 7; theme-direction 1 to 7 (restyle) |
| text-and-content | hierarchy-and-type 1 to 7; responsive-behaviour 4 |
| inputs-and-controls | forms-and-inputs 1 to 4, 6 to 8 |
| forms | forms-and-inputs 1, 2, 5 to 7, 9; interface-states 3 to 6 |
| actions | interface-states 4, 6; colour-and-theming 5, 6; responsive-behaviour 5, 7 |
| containers | composition-and-layout 4, 5; hierarchy-and-type 5; interface-states 7; responsive-behaviour 4 |
| navigation | responsive-behaviour 2, 5; colour-and-theming 6; interface-states 4; assets-and-media 1, 2 (rail) |
| overlays | interface-states 5, 6; forms-and-inputs 4; motion 2, 4 |
| states | interface-states 1 to 7; forms-and-inputs 5 |
| data-display | composition-and-layout 2; colour-and-theming 6; hierarchy-and-type 5; interface-states 7; device-reach 1 to 4, 8, 10 (live or animated chart) |
| media-and-icons | assets-and-media 1 to 7; motion 7 (video); device-reach 1 to 4, 8, 10 (video or heavy background) |
| motion | motion 1 to 7; design-specificity 7 (story page); responsive-behaviour 6 (gestures); device-reach 1 to 4, 8 to 10; device-reach 5 (canvas, WebGL or heavy filters) |
| pages-and-composition | composition-and-layout 1 to 7; design-specificity 1 to 7; responsive-behaviour 1 to 5; device-reach 1 to 4, 8, 10 (before a page ships); device-reach 6, 7 (desktop or Linux build) |

## Protocols

- accessibility: scope any rendered page, component or view before it ships. WCAG 2.2 AA and a whole keyboard path.
- assets-and-media: scope icons, images, video, fonts and brand marks. One icon set, light media, the real fonts.
- colour-and-theming: scope colour, tokens, surfaces, borders, shadows and themes. Colour on tokens, every pair above its target.
- composition-and-layout: scope page structure, grids, sections, spacing and containers. One dominant object per moment, on a shared grid.
- design-specificity: scope new surfaces and passes that set the visual direction. Choices for the brief, not defaults.
- device-reach: scope any surface, animation, background or build that ships to users. The approved default smooth on low-end profiles.
- forms-and-inputs: scope forms, fields, selects, dates, search, uploads and submit flows. Few presses, explained blocks, errors in place, honest choices.
- hierarchy-and-type: scope headings, body copy, type scale, measure and numerals. One reading order on named roles.
- interface-states: scope anything that loads, fails, is empty, is disabled or succeeds. Every state designed and proved.
- light-theme: scope a light theme built, derived from a dark theme or a chosen palette, or restyled. By the job of each colour, never by inversion.
- motion: scope transitions, animations, reveals, scroll effects and gestures. Purposeful, short, compositor-only, reducible.
- responsive-behaviour: scope layout, text length, writing direction, media and pointer input across widths. From 320 CSS pixels to ultra-wide.
- theme-direction: scope a stated aesthetic, restyle or brand change. A look through the primitive layer, contrast kept.
- visual-critique: scope any rendered surface after a design or polish pass. The gate before done: board, proportion and a judged look.

The command [uify](features/uify.md) runs the module on a surface, a target or a direction.
