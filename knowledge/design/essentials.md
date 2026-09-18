# Essentials

The one file to read first for a build from scratch or a pass over a whole surface: the floors and the starting values, so a small product gets its first version right without opening the whole module. The category files add options and a `Build:` recipe per subcategory; the protocols prove the result. The brief and the project's existing tokens win over any value here.

## Floors

A surface that breaks one of these is not finished, whatever the direction asks.

- **Contrast.** Text at 4.5:1, large text at 3:1, and non-text at 3:1: control borders, meaningful icons, chart marks and the focus ring. Measured in every theme that ships and in every state, hover included. Disabled controls are exempt but stay readable.
- **Keyboard.** Every interactive element is reached with Tab in reading order and works with Enter or Space. Escape closes an overlay, focus is trapped only inside a modal, and it returns to a sensible control when an overlay closes.
- **Focus.** A visible ring on every stop, never hidden under a sticky region.
- **Targets.** At least 24 by 24 CSS pixels, 44 by 44 on touch.
- **Reflow.** No horizontal page scroll at 320 CSS pixels wide, and nothing lost under the reader's text spacing.
- **Colour is never the only cue.** Status, validity, selection and series carry a word, a shape or a position as well.
- **Every state is designed.** Empty, loading, error, success and disabled exist before the populated state is called done. Loading never moves the content around it.
- **Reduced motion is honoured.** Travel goes, opacity and colour feedback stay.
- **Values live in tokens.** No colour, font size, gap, radius, duration or layer index written in a component.
- **Icons come from one published open icon set**, inline SVG, never emoji and never drawn by hand. When no set can be fetched, as [icons-and-media.md](icons-and-media.md), Icons, defines it, a text label replaces the icon.
- **Structural words are part of the design pass.** Visible labels, accessible names, the reason a control is disabled, the action on an empty state, the recovery on an error and the skip link are written by the pass that builds the structure, then flagged for the copy pass. Only persuasive and explanatory text waits for copy.

## Build order

1. Plan in a few lines: subject, audience, primary job, mode from [direction.md](direction.md), four to six named colours with a role each, type roles, layout in one sentence, motion level, and the one place where boldness is spent.
2. Write the token file: primitives, semantic roles, and the theme skeleton in [tokens.md](tokens.md), Themes.
3. Lay the shell: skip link, header, navigation, main, one level-one heading per view, a document title per view.
4. Build each component with all its states at once, not the populated state first.
5. Verify with the protocols named in the [routing table](INDEX.md#routing): contrast table, keyboard walk, widths, states, critique.

## Default values

Sources marked "pack" are this module's own choice, stated so a builder does not have to invent one. WCAG references are to version 2.2, level AA unless marked AAA.

| Value | Default | Source |
| --- | --- | --- |
| Body text contrast | 4.5:1 or above, placeholders included | WCAG 1.4.3 |
| Large text contrast | 3:1 or above; large is 18pt (about 24 CSS px), or 14pt bold (about 18.5 CSS px) | WCAG 1.4.3 |
| Non-text contrast | 3:1 against adjacent colours, for control borders, focus indicators, meaningful icons and chart marks | WCAG 1.4.11 |
| Hover and active states | every state pair still meets its target; a hover treatment needs no contrast of its own, the text on it does | WCAG 1.4.11 |
| Links in running text | underlined; colour alone needs 3:1 against the surrounding text plus another cue | WCAG 1.4.1, technique G183 |
| Focus ring | `outline: 2px solid` the focus role, `outline-offset: 2px`, 3:1 against what surrounds it | WCAG 2.4.13 (AAA) names a 2 px solid outline as the easiest pass; 1.4.11 |
| Focus under sticky regions | `scroll-padding-top` equal to the sticky header height | WCAG 2.4.11, technique C43 |
| Pointer target | 24 by 24 CSS px minimum; 44 by 44 on touch and for primary controls | WCAG 2.5.8; 2.5.5 (AAA) |
| Input font size | 16 CSS px or more | pack, [forms-and-controls.md](forms-and-controls.md): phone browsers zoom smaller inputs |
| Reflow | 320 CSS px wide, 256 CSS px tall; a data table may scroll on its own axis | WCAG 1.4.10 |
| Text spacing test | line height 1.5, paragraph spacing 2, letter spacing 0.12, word spacing 0.16, each times the font size | WCAG 1.4.12 |
| Truncation | allowed only when the full value is reachable on focus, on activation or on a linked page | WCAG 1.4.12 understanding |
| Measure | 65 to 75 characters for prose, never above 80; `ch` is the width of the zero and most letters are narrower, so a proportional sans usually needs about 55 to 60ch to land in range, confirmed by the computed method in [evidence.md](evidence.md) | pack, [hierarchy-and-type](protocols/hierarchy-and-type.md); WCAG 1.4.8 (AAA) caps at 80 |
| Body line height | 1.5 for prose, 1.3 to 1.4 for compact interface text, 1.1 to 1.2 for display | WCAG 1.4.8 (AAA) for prose; pack for the rest |
| Type scale | ratio 1.2 on a 1rem body for apps (1.125 when dense); fixed rem sizes on product screens, `clamp()` on marketing display | pack, [foundations](categories/foundations.md) |
| Type roles | display, title, two heading roles, lede, body, label, caption; roles may share a size and differ by weight or colour | pack, [tokens.md](tokens.md) |
| Display role on a Persuade section | differs from body by more than size: its own face, or weight 700 or more with tracking near -0.02em | pack, [foundations](categories/foundations.md), Type |
| Largest text and tracking | at most 6rem; letter spacing never below -0.04em | pack, [hierarchy-and-type](protocols/hierarchy-and-type.md), step 4 |
| Numerals | `font-variant-numeric: tabular-nums` on figures that are compared or change | pack, [foundations](categories/foundations.md) |
| Spacing scale | 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6 rem; within a group 0.25 to 0.75, between groups 1 to 1.5, section turns 2 to 4 | pack, bands from [tokens.md](tokens.md) |
| Page width | content contained at 75rem, gutter 1rem below 40rem and 1.5rem above | pack |
| Breakpoints | where the content breaks; the usual starting set is 40, 48, 64 and 80 rem (640, 768, 1024, 1280 px) | pack, [pages-and-sections.md](pages-and-sections.md), Widths |
| Radius | one stated mix: 0.375rem controls, 0.75rem containers, full round for switches and avatars; inner radius is outer minus padding, and at zero or below it takes the smallest step | pack, [tokens.md](tokens.md), Shape |
| Borders | 1 px; a border that marks a control reaches 3:1 | WCAG 1.4.11; pack |
| Elevation | one soft offset shadow or one border, never both; in dark themes a lighter surface instead | pack, [tokens.md](tokens.md) |
| Layers | content 0, sticky 10, dropdown and popover 20, drawer 30, modal 40, toast 50, as named tokens | pack, order from [tokens.md](tokens.md), Rules |
| Durations | press 100 to 160 ms, tooltip 125 to 200, menu 150 to 250, modal 200 to 300, drawer and toast up to 500, crossfade about 180 | pack, [animation.md](animation.md), Numbers |
| Easing | decelerate `cubic-bezier(0.23, 1, 0.32, 1)`, in and out `cubic-bezier(0.77, 0, 0.175, 1)`, sheet `cubic-bezier(0.32, 0.72, 0, 1)`, linear for progress | pack, [animation.md](animation.md) |
| Scale in motion | entrances from 0.9 to 0.97, press at 0.97 | pack, [animation.md](animation.md) |
| Feedback time | a visible response within about 400 ms | pack, [states.md](states.md), Loading |
| Moving content | anything that starts on its own and runs past 5 seconds gets pause, stop or hide; a loading indicator is exempt | WCAG 2.2.2 |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` drops travel and loops | WCAG 2.3.3 (AAA), technique C39 |
| Layout shift | 0 px movement of content under a loading indicator; page score at or below 0.1 | pack, [interface-states](protocols/interface-states.md), step 4; cumulative layout shift threshold at the 75th percentile |
| Status messages | `role="status"` for results and success, `role="alert"` for errors, present in the markup before the message arrives | WCAG 4.1.3 |
| Theme | `color-scheme` on the root, System, Light and Dark choice, stored per browser, a `theme-color` meta per scheme | MDN `color-scheme`, `prefers-color-scheme`, `theme-color`; skeleton in [tokens.md](tokens.md) |
| Icons | one open set, 1.25em in text and 20 or 24 px in controls, one stroke width across the surface, `currentColor` | pack, [icons-and-media.md](icons-and-media.md) |
| Toast | bottom corner, 6 s, pausing on hover, focus and hidden tab; longer when it carries an undo | pack, [overlays.md](overlays.md) |
| Search | results as the person types, debounced 200 to 300 ms | pack |
| Controls by option count | 2 to 4: radios or a segmented control; 5 to about 10: a select; 10 or more: a menu with a filter | pack, [forms-and-controls.md](forms-and-controls.md) |

The palette, the faces and the one bold move come from the subject, through [direction.md](direction.md) and [defaults.md](defaults.md).
