# Design

Interface work runs as protocols. This file is the whole map. Read it, pick the two or three protocols the work in hand actually needs, and read only those.

Reading every protocol before every change is the wrong way to use the module. It spends context on rules the change cannot break and turns into a checklist nobody runs. A protocol that is not read is cheaper than a protocol that is skimmed.

Match the work against the second column: the words there describe a diff or a request, not a discipline. Most changes match two or three rows. When nothing matches, the change is not a design change and no protocol applies.

| Protocol | Applies when | Purpose |
| --- | --- | --- |
| [design-specificity](protocols/design-specificity.md) | A new surface or page, or any pass that sets or changes the visual direction | Separate what was chosen for this brief from what would appear on any brief |
| [hierarchy-and-type](protocols/hierarchy-and-type.md) | Any change to headings, body copy, type scale, weights, measure or numerals | Make one reading order obvious and keep every size on a named role |
| [composition-and-layout](protocols/composition-and-layout.md) | Any change to page structure, grid, spacing, sections, cards or containers | Give each reading moment one dominant object on a shared grid |
| [colour-and-theming](protocols/colour-and-theming.md) | Any change to colour, tokens, surfaces, borders, shadows, or a light or dark theme | Keep colour on semantic tokens and every pair above its contrast target |
| [interface-states](protocols/interface-states.md) | Any control, form, list or table, and anything that loads, fails or can be empty | Design and prove every state, not only the populated one |
| [motion](protocols/motion.md) | Any transition, animation, transform, reveal or scroll effect | Keep motion short, compositor-only, purposeful and reducible |
| [accessibility](protocols/accessibility.md) | Any change that reaches the rendered page, and always before a surface ships | Meet WCAG 2.2 AA and keep the keyboard path whole |
| [responsive-behaviour](protocols/responsive-behaviour.md) | Any change to layout, text length, media or pointer input across widths | Hold the layout from 320 CSS pixels to ultra-wide under real content |
| [theme-direction](protocols/theme-direction.md) | A stated aesthetic, a restyle, a brand change or a request to change the look | Apply a look through the primitive layer without breaking contrast or code |

Every protocol ends in artifacts: a computed number, a screenshot of a named state, a search that returns no hits, or a transcript. A step whose result is an opinion is a step that was not run.

Three topics at the module root back the protocols and are read only when a step points at them:

- [defaults.md](defaults.md) lists the category defaults and template chrome that appear whatever the subject, with the searches that find them.
- [tokens.md](tokens.md) defines the primitive and semantic layers, what a theme may move and what it may not.
- [evidence.md](evidence.md) defines how each kind of result is produced and recorded, and how findings are ranked.

The command [uify](features/uify.md) runs the module end to end on a page, a view or a component.
