name: light-theme
purpose: Design a light theme from the palette that already exists, by the job of each colour instead of by inversion, so it is calm to look at, belongs to the same family and meets every floor.
scope: a light theme built, derived from a dark theme or a chosen palette, restyled, or reported as glaring, washed out or inverted
trigger: task close, and manual whenever a light theme is added, derived or changed
repeat: once per light theme, and again whenever its source palette changes
inputs: the source palette (the dark theme's tokens or the chosen palette), the token file, the scene sentence from the brief, the rendered surface in each theme that ships
stop: an accent cannot meet its floor at any lightness that keeps its hue recognisable, in which case the requester is told which colour and offered its nearest hue that does
report: the source table with each colour's job, the contrast character and why, the light values beside the dark ones, the contrast table of the light theme, the glow search, the area check and the paired captures with the written verdict

## Steps

1. Read the source palette.
   Task: convert every colour of the source to OKLCH and give each one its job: ground, surface, text, border, accent, status, data series or decoration. Record the neutral hue, each accent hue and which colours are complements, as in [light-themes.md](../light-themes.md), Read the source palette. List apart the decoration that only works on dark.
   Time: 20 minutes.
   Result: a table with one row per source colour: the value, its OKLCH, its job, and the light job it will take. No light value is written before the table exists.

2. Choose the contrast character.
   Task: pick dim, soft, standard or crisp from the scene sentence, as in [light-themes.md](../light-themes.md), Choose the contrast character, and set the ground from the neutral hue with chroma between 0.004 and 0.012.
   Time: 10 minutes.
   Result: one sentence naming the character and the reason, and the ground value, which is not `#fff`, `#ffffff`, `white` or L 1.

3. Build the surface ladder.
   Task: set chrome, ground, raised and overlay as in [light-themes.md](../light-themes.md), Ground and surfaces, with white allowed only on raised layers and never in the dim character, and the shadow tokens as in Elevation and shadows.
   Time: 20 minutes.
   Result: four surface values at most, each with its L, the step between ground and raised recorded, and each raised layer separated by one shadow or one border, not both, with the shadow colour taken from the neutral hue.

4. Set text and borders, and measure them.
   Task: set primary and secondary text and the border steps at the neutral hue, then compute every text pair on every surface it sits on, the chrome step included, and every control border against its ground.
   Time: 20 minutes.
   Result: a contrast table with primary text and secondary text at 4.5:1 or above on the lowest surface each one sits on, control borders that stand alone at 3:1 or above, and no text token at `#000`.

5. Re-derive the accents.
   Task: for each accent, keep its hue and set three values, text, fill and tint, as in [light-themes.md](../light-themes.md), Accents. Adjust chroma for the new lightness, move darkened yellows and oranges toward red, measure the white and the dark label on each fill and keep the one that passes and reads better. Then apply Complementary and companion hues to every pair the source table marked.
   Time: 30 minutes.
   Result: a table of each accent in dark and in light, its three light values with their ratios, every text value at 4.5:1 on the lowest surface it sits on, every fill label at 4.5:1, and no adjacent pair of saturated complements at similar lightness.

6. Spend the accent on small areas.
   Task: on a capture of each key screen in the light theme, estimate the share of the viewport covered by saturated accent, and move any large accent area to the accent tint.
   Time: 15 minutes.
   Result: the share per screen, each around a tenth or less, and a list of the areas moved to the tint.

7. Carry over status, data, states and imagery.
   Task: apply [light-themes.md](../light-themes.md), States and Status, data and imagery: status colours as dark shade, tint and small fill; chart series re-derived and measured; hover and pressed darkening on light surfaces; the focus ring measured on the ground and on raised layers; light variants for logos, illustrations and photos with baked-in text; glows and neon gradients removed.
   Time: 30 minutes.
   Result: every status and series pair at its target, every state ratio recorded per [colour-and-theming](colour-and-theming.md), step 5, the search `box-shadow:[^;]*0 0 |drop-shadow\(0 0 ` returning no hit in the light theme, and the list of assets given a light variant.

8. Judge both themes side by side.
   Task: capture the same key screens in dark and in light at the same size and run [visual-critique](visual-critique.md), steps 4, 7 and 8, on the pair. Write the judgment before reading any number: whether the light one is calm to look at for a long session, whether the two read as one family, and where the eye goes first. Check that no light token is the arithmetic inversion of its dark counterpart.
   Time: 20 minutes.
   Result: the paired captures, the written verdict naming any glare, washed-out area or inverted look with its fix, the fixes applied, and a final verdict that the light theme passes.
