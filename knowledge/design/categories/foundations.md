# Foundations

The layer every other category stands on: tokens, type, spacing, colour, shape, theme and writing direction. A change here moves the whole product, so it is made in the token file and measured once per theme.

## Tokens and layers

Applies when: a colour, size, radius, shadow, duration or font is written inline; a component is imported from a library; a request says "make it consistent", "clean up the styles" or "set up a design system"; a diff touches the token file.

Build: One token file loaded before any component: primitives named by what they are (a neutral ramp from 50 to 950, one accent ramp, one hue per status, the spacing and radius scales from [tokens.md](../tokens.md#spacing-bands), the type roles, the durations and curves from [animation.md](../animation.md#numbers), and the layer scale from [essentials.md](../essentials.md#default-values)), then semantic roles pointing at them (`--surface-page`, `--surface-raised`, `--surface-sunken`, `--text-primary`, `--text-secondary`, `--border-subtle`, `--border-control`, `--focus`, `--accent`, `--on-accent`, one per status). Components read roles only.

Options:

- **Two layers, primitives and semantic roles.** The default for anything that will be themed or restyled.
- **Adopt an official design system** when the product must match a platform or a public-sector standard. Install it whole, do not mix two, and do not override most of it.
- **Retune an owned component kit** when speed matters: every radius, colour, shadow and face moves onto the tokens before the first component lands.
- **Extract a token or a component** only after the same intent appears three times; earlier, duplication is cheaper than the wrong abstraction.

Open: [colour-and-theming](../protocols/colour-and-theming.md); [tokens.md, Primitive layer](../tokens.md#primitive-layer), [Semantic layer](../tokens.md#semantic-layer) and [Rules](../tokens.md#rules).

## Type

Applies when: headings, body text, labels or numerals change; a request says "better typography", "more hierarchy", "change the font"; text sizes are written outside a scale; a heading wraps badly.

Build: Body at 1rem with line height 1.5 and a ratio of 1.2 for the other roles, in rem. Each role (display, title, heading, body, label, caption) sets size, weight, line height and tracking together as one token group. Figures get `tabular-nums`. A Persuade section adds a display role in its own face, or at weight 700 or more with tracking near -0.02em and line height about 1.1.

Options:

- **One family** for a working app, on a fixed scale with steps of about 1.125 to 1.2; a Persuade section on the same surface still gets its display role.
- **A display face plus a text face** for a marketing or story page, when the display face carries the subject's own world. A second family is added only for a job the first cannot do.
- **Fluid display sizes** on marketing surfaces; fixed sizes on dense product and reading surfaces, which stay spatially predictable.

Open: [hierarchy-and-type](../protocols/hierarchy-and-type.md); [tokens.md, Type roles](../tokens.md#type-roles); [icons-and-media.md, Fonts](../icons-and-media.md#fonts) when the face does not load.

## Spacing and density

Applies when: gaps, padding or section heights change; a request says "too cramped", "too empty", "tighten it", "give it air"; sections stretch to the viewport; a child margin sits on top of a container gap.

Build: Gaps from the scale and the three bands in [tokens.md](../tokens.md#spacing-bands). Containers own their gaps through `gap` and padding and children carry no outer margin, with more space above a heading than below it.

Options:

- **Tight rhythm**, the default: the smaller value first, three bands of gap, one owner per gap.
- **Dense operational layout** for tools used all day: rules instead of boxes, tabular figures, more rows per screen.
- **Airy composition** only on a Persuade or Experience surface that has the content to fill it; a sparse section gets content or a tighter band, never more space.

Open: [composition-and-layout](../protocols/composition-and-layout.md); [tokens.md, Spacing bands](../tokens.md#spacing-bands) and [Density](../tokens.md#density).

## Colour and contrast

Applies when: a colour, a surface, a border or a shadow changes; a request says "more colour", "less colour", "it looks washed out", "brand colours"; text sits on an image or a tint; a state is shown by colour.

Build: Lay the surface out in greys first, then add one accent for actions, selection and focus and one hue per status. Measure every text role on every surface it sits on at 4.5:1, and every control border and the focus ring at 3:1, before the first component is built.

Options:

- **Restrained**: neutrals and one accent kept for actions, selection and state. Default for apps and reading.
- **Committed**: one saturated colour owns whole regions. For a surface that must be remembered.
- **Full palette**: three or four named roles, each with a job. For products with several real categories, such as a report where each category owns a colour.
- **Drenched**: the surface is the colour. For a single statement page.

Open: [colour-and-theming](../protocols/colour-and-theming.md); [direction.md, Choose the colour strategy](../direction.md#choose-the-colour-strategy); [tokens.md, Rules](../tokens.md#rules).

## Theme and dark mode

Applies when: a dark or light theme is added, a toggle is requested, a theme catalogue or user-made themes appear, the page flashes the wrong theme on load, form controls ignore the theme.

Build: Decide one theme or both by the rule in [tokens.md](../tokens.md#themes). For both, write each role once with `light-dark()`, set `color-scheme` on the root, add the System, Light and Dark control, the inline head script and one `theme-color` meta per scheme, as in the theme skeleton there, then measure the contrast table in each theme.

Options:

- **One theme**, when a sentence about the scene picks light or dark and nothing asks for both; no toggle.
- **Both themes**, following the system, with a System, Light and Dark choice, when the brief asks for both or the scene has no single answer.
- **A catalogue of themes** as closed, contrast-checked recipes, including themes a person makes, which are sanitized and versioned.

Open: [colour-and-theming](../protocols/colour-and-theming.md); [tokens.md, Themes](../tokens.md#themes) and [Dark mode](../tokens.md#dark-mode).

## Light theme

Applies when: a light theme is added to a dark product, derived from a chosen palette, restyled, or reported as glaring, washed out or looking inverted.

Build: Never invert. Give every source colour its job, keep the neutral hue and the accent hues, tint the off-white ground toward the neutral hue, keep white for raised layers with one soft shadow except in the dim character, give each accent a text, a fill and a tint value at the lightness its floor needs, and spend the saturated accent on small areas only.

Options:

- **Dim**, a grey ground with no surface near white and raised layers one soft step lighter, for people who find any bright field harsh.
- **Soft**, a deeper tinted ground and dark grey text near 8.5:1 to 11:1, for long reading and tools used for hours.
- **Standard**, an off-white ground and near-black text between 13:1 and 16:1, the default for apps.
- **Crisp**, the lightest ground and the darkest text, for dense data, editorial pages and outdoor use, still without a pure white page or pure black text.

Open: [light-theme](../protocols/light-theme.md); [light-themes.md](../light-themes.md); [colour-and-theming](../protocols/colour-and-theming.md), steps 3 to 6.

## Direction and restyle

Applies when: a request names a look ("switch to a medieval theme", "make it feel like a newspaper", "more premium", "less generic"), a brand changes, or a new surface needs its identity.

Build: Write the direction in one sentence and the contract in [direction.md](../direction.md#write-the-contract), list the files the pass may move, change only primitives, faces and assets, and recompute contrast in each theme.

Options:

- **Refine** inside the current identity: type, spacing and colour recalibration only.
- **Restyle by theme**: new primitives and faces, semantic roles and components untouched.
- **Replace the look**: a new direction contract and three variants on named axes.
- **A named direction** from [direction.md](../direction.md#named-directions), only when the brief asks for that look.

Open: [design-specificity](../protocols/design-specificity.md); [theme-direction](../protocols/theme-direction.md); [direction.md](../direction.md); [defaults.md](../defaults.md).

## Shape and depth

Applies when: radii, borders, shadows or elevation change; cards look like floating boxes; a request says "softer", "sharper", "flatter".

Build: The radius mix and the elevation of each layer as tokens, as in [tokens.md](../tokens.md#shape): one radius system, one shadow token or one border per layer, and lighter surfaces for higher layers in a dark theme.

Options:

- **One radius system** written down: all sharp, all soft, or a stated mix per component kind.
- **Flat**: separation by space and rules, for dense and reading surfaces.
- **Layered**: elevation by one shadow token or one border, never both.

Open: [colour-and-theming](../protocols/colour-and-theming.md), step 7; [tokens.md, Shape](../tokens.md#shape).

## Writing direction

Applies when: the product ships a right-to-left language such as Arabic or Hebrew, a string mixes directions, or a request says "support RTL".

Build: `dir` and `lang` on the root from the locale, and `dir` on any element whose content runs the other way. Spacing, borders, insets and alignment written with logical properties (`margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`), so the layout mirrors with no second stylesheet. Icons that point along the reading direction, such as back, forward, a breadcrumb chevron or a progress arrow, are mirrored; media controls, clocks, check marks and logos are not. Numbers, codes and identifiers stay left to right inside a right-to-left line.

Options:

- **Logical properties from the start**, the default for any product that may ship a right-to-left language.
- **A conversion pass** on an existing product: the search `(margin|padding|border)-(left|right)|[^-](left|right):|text-align:\s*(left|right)` over the stylesheets, each hit moved to its logical property before the language is added.

Open: [responsive-behaviour](../protocols/responsive-behaviour.md), step 4; [bilingual.md, Right-to-left languages](../../copy/bilingual.md#right-to-left-languages) for the words.
