# Tokens

Two layers. Components read the second one only.

## Primitive layer

The raw material of the design: the colour ramps, the font stack, the type scale, the spacing scale, the radius scale, the shadow scale, the motion durations and curves, and the texture layer. A primitive is named after what it is, never after where it is used. This layer is the whole of what a change of aesthetic is allowed to move.

## Semantic layer

The roles the interface actually speaks in, each pointing at a primitive: page surface, raised surface, sunken surface, primary text, secondary text, subtle border, default border, strong border, focus ring, accent, and one role per status. A component references a semantic role and nothing else.

The consequence that makes the split worth its cost: a new look is a new primitive set plus a re-point of the semantic layer. No component changes, and every contrast pair is re-measured in one place instead of hundreds.

## Rules

- A component that writes a colour literal has broken the layer. The search for hex and `rgba(` outside the token file returns no hits. In a small app the token file can be a `:root` block at the top of its only stylesheet, as in [defaults.md](defaults.md), Searches.
- A semantic role is added when a new meaning appears, never to hold a one-off value. A role used once is a literal with a longer name.
- Sizes come from the scale. A free font size, gap or radius written inline is the same failure as a literal colour. Breakpoints, border widths, the focus ring width, the target size, icon sizes, durations and layer indices are tokens too; a dimension that belongs to one component, such as a column width, may stay in that component in rem.
- Contrast is a property of a semantic pair, so it is measured on the pair and recorded once per theme.
- Layers stack on a short named scale: content, sticky regions, overlays, the modal, the toast. A stacking value outside that scale is a literal.
- An imported component adopts the tokens before it lands. A component that carries its own colours, radii or fonts is a re-skin that will fail later.

## Type roles

Type is a short list of named roles, not a range of sizes: display for the single page-defining statement when scale is earned, title for the page title, two or three heading roles for section and nested structure, lede for one orientation passage, body for reading, label for compact names, caption and metadata for subordinate context.

- Hierarchy comes from size, weight and line height together. Weight adds emphasis without taking space.
- Line height falls as size rises: tight on display, looser on body, tighter again in dense data.
- Tracking depends on size: slightly negative on large display, neutral on body, slightly positive on small labels. Never below -0.04em.
- Emphasis inside a heading uses the italic or the bold of the same family, never a word set in another face.
- Sizes and spacing are set in relative units so a reader's larger text setting grows the layout instead of breaking it.
- Peers share role, size, weight, line height and numeric treatment. One peer is never resized because its string is longer or its number is larger. The count of distinct font sizes on visible text is no higher than the count of roles; two roles may share a size and differ by weight or colour.

## Spacing bands

Three bands, not one universal stack gap:

- Within a group, the smallest steps of the scale. A heading sits closer to its first paragraph than to what precedes it; a label, its value and its detail are identical across peers.
- Between groups, the middle steps.
- At a section turn, the large steps. The largest step of all is a chapter break between two substantial sections, never the default gap.

Every visible gap has exactly one owner. The container sets it, and its children do not add competing margins.

## Density

Vertical rhythm defaults tight. Large empty bands read as an unfinished page, not as breathing room, so the tighter value is the first one tried.

- A content section is never stretched to the viewport height to fill a screen.
- A section's padding is never stacked on top of a child's margin.
- A section that looks sparse gets more content or a tighter band, never more space. If it still reads empty, that is reported rather than padded around.
- Dense operational screens go further: rules of 1 pixel instead of boxes, and tabular numerals on every figure.

## Shape

One radius system per product, written down: all sharp, all soft, or a stated mix such as fully rounded buttons, medium cards and small inputs, applied everywhere. Nested radii stay concentric, with the inner radius equal to the outer radius minus the padding between them. When that is zero or less, the inner surface takes the smallest radius step, or is dropped when it only repeats the outer one.

## Themes

- **One rule for how many themes.** A product ships one theme when a sentence about the scene where it is used, per [direction.md](direction.md), picks light or dark, and nothing asks for both; that theme ships alone, with no toggle. It ships both when the brief asks for both or the scene has no single answer, such as a tool used through the day and into the evening. Both themes are then designed from the start, follow the system preference by default, offer a manual choice, and load without flashing the wrong one. In a refine the number of themes is part of the look: a product that ships one theme keeps it, the pass fixes only its floors, and a second theme this rule would ask for is reported as open with its fix, not built.
- **The manual choice** is one control with three options, System, Light and Dark, System selected until the person picks another. It sits in the settings or the account menu of an app, or at the end of the top bar of a site. The choice is stored in the browser under one key, applied as a `data-theme` attribute on the root by a small inline script in the head before the stylesheet paints, and removed again when the person picks System.
- **One theme per page.** Sections do not invert the page theme. Tint steps inside the same family are fine.
- **A theme catalogue is a set of closed recipes.** When a product offers several themes or lets a person make one, each theme is a primitive set validated for contrast before it applies, never arbitrary CSS, markup or script. A background is a recipe from a fixed list, and a person's theme is sanitized, contrast checked and versioned.

## Dark mode

Dark mode re-points the semantic layer at a second primitive set. It never inverts the first one.

- Pure black is not the page surface, and pure white is not the text. Elevation reads as a lighter surface, not as a heavier shadow, because shadow disappears against a dark field.
- Accents lose a little saturation. A saturated hue that reads as confident on a light page reads as a glare on a dark one, while the brand colour stays recognisable.
- Every pair is re-measured after the re-point. A ratio that passes in one theme proves nothing about the other.
- The root declares its colour scheme so that form controls, scrollbars and the caret follow, and the browser interface colour matches the page background: one `theme-color` meta per scheme, each with its `media` query, equal to the page surface token.
- A native select needs an explicit background colour and text colour, or it inherits a system pair that belongs to no theme.
- Text on a translucent surface needs more contrast and a slightly heavier weight than on a solid one, and a solid fallback exists for the reduced transparency preference.

### Theme skeleton

Each semantic role is written once, with both values, through `light-dark()`, which follows the used colour scheme. The system preference and the manual choice then differ only in the `color-scheme` they set, so the dark values are never duplicated between a media query and an override.

```css
:root { color-scheme: light dark; }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }

:root {
  --surface-page: light-dark(var(--grey-50), var(--grey-950));
  --text-primary: light-dark(var(--grey-900), var(--grey-100));
  --accent: light-dark(var(--blue-700), var(--blue-300));
}
```

```html
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f7f7f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16181b" media="(prefers-color-scheme: dark)">
<script>
  try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
</script>
```

`light-dark()` needs the `color-scheme` property set, as above, and is supported by current browsers since 2024. A product that must support older browsers writes each role twice instead, once on `:root` and once in one block whose selector lists both `:root[data-theme="dark"]` and `:root:not([data-theme="light"])` inside `@media (prefers-color-scheme: dark)`, generated from one source list so the two cannot drift. When a manual choice overrides the system, the `theme-color` meta is updated by the same script.
