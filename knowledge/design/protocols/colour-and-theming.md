name: colour-and-theming
purpose: Keep colour on semantic tokens, carrying meaning, with every pair above its contrast target in each theme that ships.
scope: colour, tokens, surfaces, borders, shadows and light or dark themes
trigger: manual, on any change to colour, tokens, surfaces, borders, shadows, or a light or dark theme
repeat: once per surface, and again whenever a token is added or re-pointed
inputs: the token file, the component tree, the rendered page in each theme that ships
stop: a measured pair falls below its target and cannot be raised without leaving the palette, in which case the palette changes before the pass continues
report: the contrast table for each theme that ships, the count of colour literals outside the token file, and the count of colour-only cues

## Steps

1. Design in monochrome first.
   Task: build the surface with no hue at all, using position, scale, weight, density and space for hierarchy. Add colour back only where it distinguishes a series, encodes a state, or marks the one action the surface exists for.
   Time: 30 minutes.
   Result: a screenshot of the monochrome pass in which the reading order is already obvious, and one line per remaining colour naming what it encodes. Colour applied because a value is favourable or important encodes nothing and is removed.

2. Put colour on the layers.
   Task: define the primitives, point the semantic roles at them, and make every component read a semantic role, as set out in [tokens.md](../tokens.md).
   Time: 30 minutes.
   Result: the colour search in [defaults.md](../defaults.md), Searches, run over the stylesheets outside the token file, returns zero hits.

3. Measure every pair in the light theme.
   Task: compute the contrast of every text and surface pair, and of every non-text element that carries meaning: icons, chart marks, borders that indicate state, and the focus ring.
   Time: 20 minutes.
   Result: a table of computed ratios, every pair at or above its target in [essentials.md](../essentials.md#floors), Contrast, with large text as defined in its Default values.

4. Re-point for the second theme and measure again.
   Task: when the product ships two themes, point the semantic roles at the dark primitive set with the skeleton and the dark mode rules in [tokens.md](../tokens.md): no pure black page, desaturated accents, elevation as a lighter surface, the colour scheme declared on the root and the browser interface colour matched to the background. Then recompute the whole table. When it ships one theme by design, per the Theme rule in [tokens.md](../tokens.md), the step ends as not applicable with the scene sentence that chose the theme. In a refine of a product that ships one theme, the step ends as not applicable too, and a missing second theme is reported as open, not built.
   Time: 30 minutes at most.
   Result: a second full contrast table meeting the same numbers and a capture of the surface in each theme showing the same hierarchy, or the not applicable line.

5. Give every state its own reading.
   Task: give hover, active, focus and selected a visible change beyond a small shift of hue: a surface step, an underline, a border or a ring. Measure the text and non-text pairs in each state; a pair that is hard to drive in the browser is computed from the token pair its rule uses. A hover surface may lower the ratio of the text on it, as long as the pair stays above its target.
   Time: 15 minutes.
   Result: the computed ratio for each interactive element in rest, hover, active and focus, recorded per state, each at or above its target, and each state visibly different from rest.

6. Add the second cue.
   Task: find every place where colour alone carries the message: status, validity, series identity, selection. Add a shape, an icon with a text label, a position or a word.
   Time: 15 minutes.
   Result: the count of colour-only cues is zero, and a screenshot in greyscale still distinguishes every state and every chart series.

7. Keep the surfaces honest.
   Task: check the edges. Shadows carry an offset and a soft blur; a zero offset halo is decoration. Elevation is declared once, as a border or as a shadow, not both. Coloured borders stay at or below 1 pixel, except the selection indicator of a navigation item. Borders and shadows tint toward the background hue. Decoration never borrows the action colour, so the eye can still find the action. Nested radii stay concentric, with the child radius never larger than the parent; when the parent radius minus the padding is zero or less, the child takes the smallest radius step.
   Time: 15 minutes.
   Result: the search `box-shadow:[^;]*0 0 ` returns zero hits, the computed width of every coloured border outside navigation selection is at or below 1 pixel, on a restrained palette the accent appears only on actions, selection and state, and no decorative gradient, glow or glass surface remains that the brief did not ask for.
