name: colour-and-theming
purpose: Keep colour on semantic tokens, carrying meaning, with every pair above its contrast target in both themes.
trigger: manual, on any change to colour, tokens, surfaces, borders, shadows, or a light or dark theme
repeat: once per surface, and again whenever a token is added or re-pointed
inputs: the token file, the component tree, the rendered page in both themes
stop: a measured pair falls below its target and cannot be raised without leaving the palette, in which case the palette changes before the pass continues
report: the contrast table for both themes, the count of colour literals outside the token file, and the count of colour-only cues

## Steps

1. Design in monochrome first.
   Task: build the surface with no hue at all, using position, scale, weight, density and space for hierarchy. Add colour back only where it distinguishes a series, encodes a state, or marks the one action the surface exists for.
   Time: 30 minutes.
   Result: a screenshot of the monochrome pass in which the reading order is already obvious, and one line per remaining colour naming what it encodes. Colour applied because a value is favourable or important encodes nothing and is removed.

2. Put colour on the layers.
   Task: define the primitives, point the semantic roles at them, and make every component read a semantic role, as set out in [tokens.md](../tokens.md).
   Time: 30 minutes.
   Result: the search for hex values and colour functions outside the token file returns zero hits.

3. Measure every pair in the light theme.
   Task: compute the contrast of every text and surface pair, and of every non-text element that carries meaning: icons, chart marks, borders that indicate state, and the focus ring.
   Time: 20 minutes.
   Result: a table of computed ratios. Body text and placeholder text at 4.5:1 or above; text at 18pt, or 14pt bold, and larger at 3:1 or above; non-text and the focus ring at 3:1 or above.

4. Re-point for dark and measure again.
   Task: point the semantic roles at the dark primitive set, following the dark mode rules in [tokens.md](../tokens.md): no pure black page, desaturated accents, elevation as a lighter surface, the colour scheme declared on the root and the browser interface colour matched to the background. Then recompute the whole table.
   Time: 30 minutes.
   Result: a second full contrast table meeting the same numbers, and a screenshot of the surface in each theme showing the same hierarchy.

5. Give every state its own reading.
   Task: raise contrast on hover, active and focus rather than lowering it, and measure each one.
   Time: 15 minutes.
   Result: the computed ratio for each interactive element is higher in hover, active and focus than at rest, recorded per state.

6. Add the second cue.
   Task: find every place where colour alone carries the message: status, validity, series identity, selection. Add a shape, an icon with a text label, a position or a word.
   Time: 15 minutes.
   Result: the count of colour-only cues is zero, and a screenshot in greyscale still distinguishes every state and every chart series.

7. Keep the surfaces honest.
   Task: check the edges. Shadows carry an offset and a soft blur; a zero offset halo is decoration. Coloured borders stay at or below 1 pixel. Borders and shadows tint toward the background hue. Nested radii stay concentric, with the child radius never larger than the parent.
   Time: 15 minutes.
   Result: the search for zero offset shadows returns zero hits, the computed width of every coloured border is at or below 1 pixel, and no decorative gradient, glow or glass surface remains that the brief did not ask for.
