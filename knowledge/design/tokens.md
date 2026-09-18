# Tokens

Two layers. Components read the second one only.

## Primitive layer

The raw material of the design: the colour ramps, the font stack, the type scale, the spacing scale, the radius scale, the shadow scale and the texture layer. A primitive is named after what it is, never after where it is used. This layer is the whole of what a change of aesthetic is allowed to move.

## Semantic layer

The roles the interface actually speaks in, each pointing at a primitive: page surface, raised surface, sunken surface, primary text, secondary text, subtle border, default border, strong border, focus ring, accent, and one role per status. A component references a semantic role and nothing else.

The consequence that makes the split worth its cost: a new look is a new primitive set plus a re-point of the semantic layer. No component changes, and every contrast pair is re-measured in one place instead of hundreds.

## Rules

- A component that writes a colour literal has broken the layer. The search for hex and `rgba(` outside the token file returns no hits.
- A semantic role is added when a new meaning appears, never to hold a one-off value. A role used once is a literal with a longer name.
- Sizes come from the scale. A free font size, gap or radius written inline is the same failure as a literal colour.
- Contrast is a property of a semantic pair, so it is measured on the pair and recorded once per theme.

## Type roles

Type is a short list of named roles, not a range of sizes: display for the single page-defining statement when scale is earned, title for the page title, two or three heading roles for section and nested structure, lede for one orientation passage, body for reading, label for compact names, caption and metadata for subordinate context.

Peers share role, size, weight, line height and numeric treatment. One peer is never resized because its string is longer or its number is larger. The count of distinct font sizes in the stylesheet equals the count of roles.

## Spacing bands

Three bands, not one universal stack gap:

- Within a group, the smallest steps of the scale. A heading sits closer to its first paragraph than to what precedes it; a label, its value and its detail are identical across peers.
- Between groups, the middle steps.
- At a section turn, the large steps. The largest step of all is a chapter break between two substantial sections, never the default gap.

Every visible gap has exactly one owner. The container sets it, and its children do not add competing margins.

## Dark mode

Dark mode re-points the semantic layer at a second primitive set. It never inverts the first one.

- Pure black is not the page surface. Elevation reads as a lighter surface, not as a heavier shadow, because shadow disappears against a dark field.
- Accents desaturate. A saturated hue that reads as confident on a light page reads as a glare on a dark one.
- Every pair is re-measured after the re-point. A ratio that passes in one theme proves nothing about the other.
- The root declares its colour scheme so that form controls, scrollbars and the caret follow, and the browser interface colour matches the page background.
- A native select needs an explicit background colour and text colour, or it inherits a system pair that belongs to no theme.
