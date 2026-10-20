# Essentials

Read first for a build from scratch or a pass over a whole surface: the floors and the starting values. The category files add a `Build:` recipe and the options per subcategory; the protocols prove the result. The brief and the project's existing tokens win over any value here.

## Floors

A surface that breaks one of these is not finished, whatever the direction asks.

- **Contrast.** Text at 4.5:1, large text at 3:1, non-text at 3:1 where the colour identifies the part, as in the rows below. Measured in every theme that ships and in every state, hover included. Disabled controls are exempt but stay readable.
- **Keyboard.** Every interactive element is reached with Tab in reading order and works with Enter or Space. Escape closes an overlay, focus is trapped only inside a modal, and it returns to a sensible control when an overlay closes.
- **Focus.** A visible ring on every stop, never hidden under a sticky region.
- **Targets.** At least 24 by 24 CSS pixels, 44 by 44 on touch.
- **Reflow.** No horizontal page scroll at 320 CSS pixels wide, and nothing lost under the reader's text spacing.
- **Colour is never the only cue.** Status, validity, selection and series carry a word, a shape or a position as well.
- **Every state is designed.** Empty, loading, error, success and disabled exist before the populated state is called done. Loading never moves the content around it.
- **Reduced motion is honoured** as [animation.md](animation.md#constraints) sets out: travel, scale and loops go, opacity and colour feedback stay.
- **Values live in tokens.** No colour, font size, gap, radius, duration or layer index written in a component.
- **Icons come from one published open icon set**, inline SVG, never emoji and never drawn by hand; with no set, a text label replaces the icon, as in [icons-and-media.md](icons-and-media.md#icons).
- **Structural words are part of the design pass.** Visible labels, a label that replaces a placeholder, accessible names, the reason a control is disabled, the action on an empty state, the recovery on an error and the skip link are written by the pass that builds the structure, then flagged for the copy pass, which reviews their words. Only persuasive and explanatory text waits for copy.

## Applying a floor to a design

A floor applies as its standard writes it, at its narrowest reading; a stricter house reading is named as one and never applied silently. Passing the floors is not a verdict on the design: [visual-critique](protocols/visual-critique.md) gives that. When an approved design misses a floor, the least visible means that meets it comes first.

- **Boundaries.** A control boundary at 3:1 takes the theme's own line hue at the lowest step that reaches it, never a near-white. A fill that tells the control apart removes the need for the border.
- **Text edited in place.** Reading text that can be edited keeps its look: a 3:1 bottom rule at rest, the full border on hover and focus, never a boxed form.
- **Instructions and readouts.** What the board draws bare stays bare on screen: the instruction is visually hidden and tied by `aria-describedby` or a status region.
- **Long motion.** Motion past 5 seconds gets one pause for the page, or each scene stays under 5 seconds; never a control under every scene.
- **A visible change is shown first.** A fix that adds or changes anything visible on an approved board is shown beside the board before it ships.
- **Behaviour stays off the design.** Notes on motion, keyboard and states live in the board's notes and in the code, never drawn on a screen.

## Build order

1. Plan in a few lines: subject, audience, primary job, mode from [direction.md](direction.md), four to six named colours with a role each, type roles, layout in one sentence, motion level, and the one place where boldness is spent. Palette, faces and the bold move come from the subject, through [direction.md](direction.md) and [defaults.md](defaults.md).
2. Write the token file: primitives, semantic roles, and the theme skeleton in [tokens.md](tokens.md#themes).
3. Lay the shell: skip link, header, navigation, main, one level-one heading per view, a document title per view.
4. Build each component with all its states at once, not the populated state first.
5. Verify with the protocols named in the [routing table](INDEX.md#routing).

## Default values

"Pack" marks this module's own choice. WCAG references are to version 2.2, level AA unless marked AAA. The mobile rows apply on mobile screens unless the project's design system sets sizes of its own.

| Value | Default | Source |
| --- | --- | --- |
| Text contrast | 4.5:1, placeholders included; large text 3:1, large being 18pt (about 24 CSS px) or 14pt bold (about 18.5 CSS px) | WCAG 1.4.3 |
| Non-text contrast | 3:1 against adjacent colours for the boundary of a control with no fill of its own, focus indicators, meaningful icons and chart marks; a button told apart by its fill needs no border contrast; a hover surface needs none of its own, the text on it does | WCAG 1.4.11 |
| Links in running text | underlined; colour alone needs 3:1 against the surrounding text plus another cue | WCAG 1.4.1, technique G183 |
| Focus ring | `outline: 2px solid` the focus role, `outline-offset: 2px`, 3:1 against what surrounds it; `scroll-padding-top` equal to any sticky header | WCAG 2.4.13 (AAA), 1.4.11, 2.4.11 |
| Pointer target | 24 by 24 CSS px minimum; 44 by 44 on touch and for primary controls; on a mobile screen 44 by 44 pt on iOS and 48 by 48 dp on Android, 8 apart | WCAG 2.5.8, 2.5.5 (AAA); pack |
| Input font size | 16 CSS px or more on phones and touch; desktop chrome keeps its compact size | pack, [forms-and-controls.md](forms-and-controls.md#fields) |
| Mobile text | body 16 to 17, smallest text 11 to 12, titles 24 and up | pack |
| Mobile controls | visual button height 40 to 56 with the touch area never below 44 (iOS) or 48 (Android); floating action button 56; rows and fields 44 to 56 | pack |
| Mobile bars | top bar 44 to 64, bottom bar 49 to 80, side margin 16; content and bars inset from the status bar, the camera cut-out and the home indicator, `env(safe-area-inset-*)` on the web | pack |
| Reflow and text spacing | 320 CSS px wide and 256 tall, a data table may scroll on its own axis; line height 1.5, paragraph spacing 2, letter spacing 0.12 and word spacing 0.16 times the font size; truncation only when the full value is reachable | WCAG 1.4.10, 1.4.12 |
| Measure | 55 to 60ch for a proportional sans, which gives 65 to 75 characters; no line over 80, confirmed by the computed method in [evidence.md](evidence.md#computed-number) | pack; WCAG 1.4.8 (AAA) caps at 80 |
| Line height | 1.5 for prose, 1.3 to 1.4 for compact interface text, 1.1 to 1.2 for display | WCAG 1.4.8 (AAA); pack |
| Type | ratio 1.2 on a 1rem body for apps, 1.125 when dense; fixed rem sizes on product screens, `clamp()` on marketing display; roles in [tokens.md](tokens.md#type-roles); largest text 6rem, tracking never below -0.04em; `tabular-nums` on compared figures | pack |
| Display role on a Persuade section | differs from body by more than size: its own face, or weight 700 or more with tracking near -0.02em | pack |
| Spacing | the scale and the three bands in [tokens.md](tokens.md#spacing-bands) | pack |
| Page width and breakpoints | content at 75rem, gutter 1rem below 40rem and 1.5rem above; breakpoints where the content breaks, starting from 40, 48, 64 and 80 rem; one column below 40rem | pack, [pages-and-sections.md](pages-and-sections.md#widths) |
| Radius, borders and elevation | one radius mix, 1 px borders at 3:1 when a border alone identifies a control, one shadow or one border per layer, as in [tokens.md](tokens.md#shape) | pack; WCAG 1.4.11 |
| Layers | content 0, sticky 10, dropdown and popover 20, drawer 30, modal 40, toast 50, as named tokens | pack |
| Motion | durations, curves and scale from the one table in [animation.md](animation.md#numbers) | pack |
| Feedback time | a visible response within about 400 ms | pack, [states.md](states.md#loading) |
| Moving content | anything that starts on its own and runs past 5 seconds gets pause, stop or hide, one control for the page; a loading indicator is exempt | WCAG 2.2.2 |
| Layout shift | 0 px movement of content under a loading indicator; page score at or below 0.1 | pack; cumulative layout shift threshold |
| Announcements | `role="status"` for success and progress, `role="alert"` for errors, as in [states.md](states.md#announcements) | WCAG 4.1.3 |
| Theme | `color-scheme` on the root, a System, Light and Dark choice when both ship, a `theme-color` meta per scheme, by the rule in [tokens.md](tokens.md#themes) | MDN `color-scheme`, `theme-color` |
| Icons | one open set, 1.25em in text and 20 or 24 px in controls, one stroke width, `currentColor` | pack, [icons-and-media.md](icons-and-media.md#icons) |
| Toast | the duration and the pause rules in [overlays.md](overlays.md#toast) | pack |
| Search | results as the person types, debounced 200 to 300 ms | pack |
| Controls by option count | a radio group up to five options, a select from six to ten, a filtered menu above ten | pack, [forms-and-controls.md](forms-and-controls.md#choosing-the-control) |
