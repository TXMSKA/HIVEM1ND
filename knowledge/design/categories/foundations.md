# Foundations

The layer every other category stands on: tokens, type, spacing, colour, shape and theme. A change here moves the whole product, so it is made in the token file and measured once per theme.

## Tokens and layers

Applies when: a colour, size, radius, shadow, duration or font is written inline; a component is imported from a library; a request says "make it consistent", "clean up the styles" or "set up a design system"; a diff touches the token file.

Options:

- **Two layers, primitives and semantic roles.** The default for anything that will be themed or restyled; components read roles only.
- **Adopt an official design system** when the product must match a platform or a public-sector standard. Install it whole, do not mix two, and do not override most of it.
- **Retune an owned component kit** when speed matters: every radius, colour, shadow and face moves onto the tokens before the first component lands, never left in its default state.
- **Extract a token or a component** only after the same intent appears three times; earlier, duplication is cheaper than the wrong abstraction.

Open: [colour-and-theming](../protocols/colour-and-theming.md); [tokens.md](../tokens.md), Primitive layer, Semantic layer, Rules.

## Type

Applies when: headings, body text, labels or numerals change; a request says "better typography", "more hierarchy", "change the font"; text sizes are written outside a scale; a heading wraps badly.

Options:

- **One family** for a working app, on a fixed scale with steps of about 1.125 to 1.2. The simplest hierarchy that holds.
- **A display face plus a text face** for a marketing or story page, when the display face carries the subject's own world. A second family is added only for a job the first cannot do.
- **Fluid display sizes** on marketing surfaces; fixed sizes on dense product and reading surfaces, which stay spatially predictable.
- **Tabular numerals** wherever numbers are compared or change.

Open: [hierarchy-and-type](../protocols/hierarchy-and-type.md); [tokens.md](../tokens.md), Type roles; [icons-and-media.md](../icons-and-media.md), Fonts, when the face does not load.

## Spacing and density

Applies when: gaps, padding or section heights change; a request says "too cramped", "too empty", "tighten it", "give it air"; sections stretch to the viewport; a child margin sits on top of a container gap.

Options:

- **Tight rhythm**, the default: the smaller value first, three bands of gap, one owner per gap.
- **Dense operational layout** for tools used all day: rules instead of boxes, tabular figures, more rows per screen.
- **Airy composition** only on a Persuade or Experience surface that has the content to fill it; a sparse section gets content or a tighter band, never more space.

Open: [composition-and-layout](../protocols/composition-and-layout.md); [tokens.md](../tokens.md), Spacing bands, Density.

## Colour and contrast

Applies when: a colour, a surface, a border or a shadow changes; a request says "more colour", "less colour", "it looks washed out", "brand colours"; text sits on an image or a tint; a state is shown by colour.

Options:

- **Restrained**: neutrals and one accent kept for actions, selection and state. Default for apps and reading.
- **Committed**: one saturated colour owns whole regions. For a surface that must be remembered.
- **Full palette**: three or four named roles, each with a job. For products with several real categories, such as a report where each category owns a colour.
- **Drenched**: the surface is the colour. For a single statement page.

Open: [colour-and-theming](../protocols/colour-and-theming.md); [direction.md](../direction.md), Choose the colour strategy; [tokens.md](../tokens.md), Rules.

## Theme and dark mode

Applies when: a dark or light theme is added, a toggle is requested, a theme catalogue or user-made themes appear, the page flashes the wrong theme on load, form controls ignore the theme.

Options:

- **One theme by design**, when the product is dark or light on purpose; no toggle.
- **Both themes following the system**, designed from the start, with a manual toggle only when either theme would lose the brand.
- **A catalogue of themes** as closed, contrast-checked recipes, including themes a person makes, which are sanitized and versioned.

Open: [colour-and-theming](../protocols/colour-and-theming.md); [tokens.md](../tokens.md), Themes, Dark mode.

## Direction and restyle

Applies when: a request names a look ("switch to a medieval theme", "make it feel like a newspaper", "more premium", "less generic"), a brand changes, or a new surface needs its identity.

Options:

- **Refine** inside the current identity: type, spacing and colour recalibration only.
- **Restyle by theme**: new primitives and faces, semantic roles and components untouched.
- **Replace the look**: a new direction contract and three variants on named axes.

Open: [design-specificity](../protocols/design-specificity.md), [theme-direction](../protocols/theme-direction.md); [direction.md](../direction.md); [defaults.md](../defaults.md).

## Shape and depth

Applies when: radii, borders, shadows or elevation change; cards look like floating boxes; a request says "softer", "sharper", "flatter".

Options:

- **One radius system** written down: all sharp, all soft, or a stated mix per component kind.
- **Flat**: separation by space and rules, for dense and reading surfaces.
- **Layered**: elevation by one soft offset shadow or one border, never both, lighter surfaces for higher layers in dark mode.

Open: [colour-and-theming](../protocols/colour-and-theming.md), step 7; [tokens.md](../tokens.md), Shape.
