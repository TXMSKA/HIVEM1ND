module: design
purpose: Interface design by category, from tokens to whole pages, with the passes that prove it.

Read this file, open only the category the work touches, and from there only the protocols and topic sections it names. A change that matches no category is not a design change.

## Categories

- [foundations](categories/foundations.md): tokens, type, spacing and density, colour, theme and dark mode, direction and restyle, shape and depth.
- [text-and-content](categories/text-and-content.md): headings, body text and reading, lists and FAQs, figures in text, quotes and proof, code and copyable values.
- [inputs-and-controls](categories/inputs-and-controls.md): text input, select and menu of options, checkbox and radio, toggle, date and number, search.
- [forms](categories/forms.md): layout, validation and errors, submission and success, multi step, sign-up and first use.
- [actions](categories/actions.md): buttons, links, action menus, floating and sticky actions, copy and share.
- [containers](categories/containers.md): cards, panels and sections, lists and rows, tables.
- [navigation](categories/navigation.md): top bar and mobile menu, side rail, tabs, breadcrumbs, in-page aids, pagination.
- [overlays](categories/overlays.md): modal, drawer and sheet, popover, toast, tooltip, banners and consent.
- [states](categories/states.md): empty, loading, error, success, disabled, first use, not found.
- [data-display](categories/data-display.md): dashboards, charts, metrics, dense tables, live values.
- [media-and-icons](categories/media-and-icons.md): icons, images, video, fonts, brand marks, illustration and texture.
- [motion](categories/motion.md): entrances, feedback, state transitions, scroll and storytelling, gestures, reduced motion.
- [pages-and-composition](categories/pages-and-composition.md): hero, landing sections, storytelling, app shell, responsive structure, finishing a site.

## Protocols

- accessibility: scope any rendered page, component or view before it ships. Meets WCAG 2.2 AA and keeps the keyboard path whole.
- assets-and-media: scope icons, images, video, fonts and brand marks. Keeps icons from one fetched set, media light and the real fonts loaded.
- colour-and-theming: scope colour, tokens, surfaces, borders, shadows and themes. Keeps colour on tokens with every pair above its contrast target.
- composition-and-layout: scope page structure, grids, sections, spacing and containers. Gives each reading moment one dominant object on a shared grid.
- design-specificity: scope new surfaces and passes that set the visual direction. Separates choices made for the brief from defaults.
- forms-and-inputs: scope forms, fields, selects, dates, search and submit flows. Keeps presses low, blocks explained and errors in place.
- hierarchy-and-type: scope headings, body copy, type scale, measure and numerals. Makes one reading order obvious on named roles.
- interface-states: scope anything that loads, fails, is empty, is disabled or succeeds. Designs and proves every state.
- motion: scope transitions, animations, reveals, scroll effects and gestures. Keeps motion purposeful, short, compositor-only and reducible.
- responsive-behaviour: scope layout, text length, media and pointer input across widths. Holds the layout from 320 CSS pixels to ultra-wide.
- theme-direction: scope a stated aesthetic, restyle or brand change. Applies a look through the primitive layer without losing contrast.
- visual-critique: scope any rendered surface after a design or polish pass. Judges it as a person will see it before it is reported done.

The command [uify](features/uify.md) runs the module on a surface, a target or a direction.
