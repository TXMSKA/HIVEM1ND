name: theme-direction
purpose: Apply a stated aesthetic through the primitive layer, without hardcoding it into components and without losing contrast.
trigger: manual, on a stated aesthetic, a restyle, a brand change or a request to change the look
repeat: once per direction
inputs: the direction in the requester's own words, the token file, the component tree, the rendered page in both themes
stop: the direction cannot be reached without dropping a pair below its contrast target, in which case the direction is adjusted and the requester is told which part changed and why
report: the direction in one sentence, the primitive set before and after, the files the diff touched, and the contrast tables recomputed in both themes

## Steps

1. Write the direction down.
   Task: restate the direction in one sentence, naming the world it comes from and what in that world is visual: its materials, its lettering, its surfaces, its light. A direction named only as a style word is not yet a direction, and the material behind it is what produces the values.
   Time: 15 minutes.
   Result: the sentence recorded, plus three to six concrete references from that world, each naming a material, a surface or a letterform rather than a mood.

2. Draw the boundary.
   Task: list what the direction is allowed to move: the primitive colour ramps, the font stack, the type scale, the radius scale, the shadow scale and the texture layer. Everything else holds. The semantic roles keep their names and their meanings, and no component changes.
   Time: 10 minutes.
   Result: the list of files the pass may touch, written before the first edit.

3. Build the new primitive set.
   Task: write the new primitives and re-point the semantic roles at them, following [tokens.md](../tokens.md). Source and self-host a display face whose character matches the direction. The nearest installed system face is a failure, not a fallback, and a platform sans is never the display voice of a page that claims its own world.
   Time: 45 minutes.
   Result: the primitive set recorded as named values with a role each, and the font files present in the project rather than referenced by family name alone.

4. Prove the components did not move.
   Task: read the diff of the pass.
   Time: 10 minutes.
   Result: the diff touches only the files listed in step 2, and the search for colour literals, font families and radius values in the component tree returns zero hits. A component that had to change is recorded as a finding against the token layer, not absorbed into the pass.

5. Recompute the contrast.
   Task: rebuild the contrast tables for both themes after the re-point, as in [colour-and-theming](colour-and-theming.md).
   Time: 20 minutes.
   Result: both tables meeting 4.5:1 for body text, 3:1 for large text, and 3:1 for non-text and the focus ring. A direction that lowers any pair below its target is adjusted at the primitive, never shipped and never excused by the aesthetic.

6. Keep the path intact.
   Task: repeat the keyboard walk from [accessibility](accessibility.md) on the restyled surface, because a new focus ring, a new radius or a new texture can hide what was visible before.
   Time: 20 minutes.
   Result: a transcript identical in stops and order to the one before the pass, with the focus ring visible at every stop.

7. Spend the direction in one place.
   Task: pick the single element that carries the new world, and let everything around it stay quiet. A direction applied evenly across every surface reads as a skin; applied to one element it reads as a decision.
   Time: 20 minutes.
   Result: a before and after screenshot pair of the first viewport in both themes, with the one carrying element named, and the count of elements that took the direction and were returned to neutral.
