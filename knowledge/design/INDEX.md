module: design
purpose: Interface design by category, from tokens to whole pages, with the passes that prove it.

Read this file, open only the category the work touches, and from there only the protocols and topic sections it names. A change that matches no category is not a design change.

A build from scratch or a pass over a whole surface reads [essentials.md](essentials.md) first: the floors and the default values in one file. The routing table below then names the protocols without opening every category; a category file is opened when one of its options has to be chosen or its `Build:` recipe is needed.

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

## Routing

Which protocol steps and topic sections each category sends work to. accessibility and visual-critique run on every rendered surface. What each step checks is one line in [steps.md](steps.md): steps are picked there, and a whole pass on a small surface opens only the protocols whose steps it will actually run. A topic is read by the sections named after its file, not whole; a file named alone is read whole.

| Category | Protocols and steps | Topic sections |
| --- | --- | --- |
| foundations | colour-and-theming 1 to 7; hierarchy-and-type 1, 2, 6; composition-and-layout 4; design-specificity; theme-direction only for a restyle | tokens: Rules, Type roles, Spacing bands, Themes, or whole for a build; direction: Read the request first, Name the mode; defaults: In a refine, Searches |
| text-and-content | hierarchy-and-type 1 to 7; responsive-behaviour 4 | tokens: Type roles; pages-and-sections: Sections; defaults: Template chrome; site-polish: Build first |
| inputs-and-controls | forms-and-inputs 1 to 4, 8; accessibility 4 | forms-and-controls: Fields, Choosing the control, Menus and selects, Dates, Search |
| forms | forms-and-inputs 1, 2, 5 to 7; interface-states 3 to 6 | forms-and-controls: Validation and submission, Layout and flow; states: Error, Success, Disabled |
| actions | interface-states 4, 6; colour-and-theming 5, 6; accessibility 1; responsive-behaviour 5, 7 | animation: Gates, Recipes; ux-laws: Decision cost and attention, Pointing and reach; overlays: Popover and menu |
| containers | composition-and-layout 4, 5; hierarchy-and-type 5; interface-states 7; responsive-behaviour 4; accessibility 6 | dashboards: Cards; app-shell: Overview, Lists and choices; defaults: Page scaffolds |
| navigation | accessibility 3, 7; responsive-behaviour 2, 5; colour-and-theming 6; interface-states 4; assets-and-media 1, 2 for a rail | app-shell: Rail, Navigation link; overlays: Drawer and sheet; site-polish: Build first |
| overlays | accessibility 2; interface-states 5, 6; forms-and-inputs 4; motion 2, 4 | overlays: Choosing the kind and the section of each kind used; animation: Recipes |
| states | interface-states 1 to 7; forms-and-inputs 5 | states: the section of each state present; animation: Gates |
| data-display | composition-and-layout 2; colour-and-theming 6; hierarchy-and-type 5; interface-states 7 | dashboards: Layout, Cards, Figures, Charts; app-shell: Overview |
| media-and-icons | assets-and-media 1 to 7; accessibility 7; motion 7 for video | icons-and-media: Icons, Choosing whether to add icons, Images, Fonts |
| motion | motion 1 to 7; design-specificity 7 for a story page; responsive-behaviour 6 for gestures | animation: Gates, Numbers, Recipes, Constraints; pages-and-sections: Pacing and storytelling for a story page |
| pages-and-composition | composition-and-layout 1 to 7; design-specificity; responsive-behaviour 1 to 5 | pages-and-sections: First viewport, Sections, Widths; direction: Find the gesture; app-shell; site-polish |

## Running the protocols

- **Proportion.** A protocol scales to the surface. Each Time is a ceiling, not a target. A step whose search or inventory finds nothing to act on, or whose subject the surface does not have, ends as not applicable with the reason in one line, and the run continues.
- **Tools.** Every search is given as a pattern for `rg`, which runs the same in PowerShell and in a Unix shell; the fallbacks are in [evidence.md](evidence.md), Portable commands.
- **Evidence a tool cannot produce** is recorded as not verifiable with the tool at hand, with what a person must check, and the pass continues. The cases are in [evidence.md](evidence.md), Tool limits.

## Protocols

- accessibility: scope any rendered page, component or view before it ships. Meets WCAG 2.2 AA and keeps the keyboard path whole.
- assets-and-media: scope icons, images, video, fonts and brand marks. Keeps icons from one published set, media light and the real fonts loaded.
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
