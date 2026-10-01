# Light themes

How a light theme is designed from a palette that already exists, usually the dark theme or a chosen brand palette, so the two read as one family and the light one is calm to look at for hours. The [light-theme](protocols/light-theme.md) protocol runs these sections in order and proves the result.

Values are given in OKLCH, written `L C h`: lightness from 0 to 1, chroma from 0 upward, hue in degrees. OKLCH is used because equal steps of L look like equal steps of lightness and the hue holds while L moves, which is exactly the move a light theme needs. The numbers are this pack's defaults; the brief, the scene and the measured contrast win over any of them.

## Why inversion fails

Inverting a dark theme, by hand or with a filter, turns its quiet ground into a sheet of pure white and its glowing accents into loud, saturated marks on that sheet. Three effects make the result hurt:

- **A bright field is mostly light.** A dark theme emits little light, so its accents can be bright. A light theme fills the screen with luminance, and every saturated area on top of it adds glare instead of focus.
- **Colour grows with luminance.** Colours look more colourful on a brighter field (the Hunt effect), and saturated colours look brighter than greys of the same lightness (the Helmholtz and Kohlrausch effect). An orange that was a gentle mark on navy becomes a shout on white.
- **Contrast is not symmetric.** Dark text on a light field and light text on a dark field are perceived differently, so the same ratio does not feel the same in both directions. A pair is designed for the polarity it ships in and measured there.

The elevation logic also flips. In a dark theme a higher layer is a lighter surface, because shadows vanish against a dark field. In a light theme the shadow works again: the ground is a tinted off-white, raised layers are whiter, and a soft shadow separates them.

## Read the source palette

Before any value is chosen, the source palette is converted to OKLCH and every colour is given its job: ground, surface, text, border, accent, status, data series, decoration. The light theme is derived by job, never by value. Three facts are taken from the source and carried over:

- **The neutral hue.** The hue the dark greys lean toward, cool slate, warm stone, violet ink, is the hue the light neutrals lean toward. This is what makes the two themes one family.
- **The accent hues.** Each accent keeps its hue, give or take a few degrees. Its lightness and chroma are redesigned.
- **The relationships.** Which colours are complements, which are analogous, which one is the action colour. The roles survive; the brightness relationships are rebuilt.

Decoration that only works on dark, glows, neon gradients, light text on photos, a white logo, is listed separately: it is replaced, not converted.

## Choose the contrast character

Not every theme needs maximum contrast. A light theme picks one character from the scene where it is used, and the floors in [essentials.md](essentials.md#floors) hold in all four.

- **Dim**: the whole page sits lower. The ground is a grey off-white well below the other characters, no surface comes near white, raised layers are one soft step lighter than the ground instead of white, chrome sits a step below, text is soft while every role keeps its floor, and accents run at low chroma. For people who find any bright field harsh, and for use in dim rooms. Its values are set per product and measured, not fixed here.
- **Soft**: a deeper, warmer or greyer ground, around L 0.95 to 0.965, and text that is dark but not black, around L 0.32 to 0.38, giving body text between about 8.5:1 and 11:1. For long reading, calm tools, anything used for hours. Hue contrast between accents carries more of the distinction than brightness does.
- **Standard**: ground around L 0.97 to 0.98, text around L 0.22 to 0.26, body text between 13:1 and 16:1. The default for apps.
- **Crisp**: ground up to L 0.985, text down to L 0.18, for dense data, editorial pages and outdoor use. Still no pure white page and no pure black text.

Pure black on pure white, 21:1, is never the goal: it is the inversion artefact this file exists to avoid.

## Ground and surfaces

- **The page ground is never pure white.** It is an off-white tinted toward the neutral hue, with chroma between 0.004 and 0.012: enough to belong to the palette, too little to read as a colour. A warm palette gets a warm ground, a cool palette a cool one. Warm hues read as cream or yellow sooner than cool ones, so a warm ground stays near the low end, around 0.006 or less, and a soft character sits lower than a crisp one.
- **White is a raised surface**, except in the dim character, where raised layers are one soft step lighter than the ground and nothing comes near white. Cards, menus, popovers and dialogs may be pure white or close to it, L 0.99 to 1, and they separate from the ground by that small step plus a soft shadow or a 1 pixel border. A white card on an off-white ground differs by about 1.05:1 to 1.1:1, which is enough for structure because the edge carries the rest.
- **Chrome is slightly tinted.** Sidebars, toolbars and sunken areas sit a step below the ground, around L 0.94 to 0.96, with a little more chroma, 0.01 to 0.02, so the frame of the app is quieter than its content. Text contrast is measured on this step too, because it is the lowest ground text sits on.
- **The ladder has four steps at most**: sunken or chrome, ground, raised, overlay. More steps are noise on a light field.

## Text

- Primary text is a dark neutral at the neutral hue, chroma 0.01 to 0.03, at the L the contrast character set. It is never `#000`.
- Secondary text sits around L 0.45 to 0.50 and still meets 4.5:1 on the chrome step, not only on the ground: on a cool ground near L 0.975, secondary text at L 0.52 drops to about 4.75:1 on chrome at L 0.95 and fails a step lower.
- Text on a tinted accent surface uses the accent's own dark shade, not grey: grey on colour looks dirty.
- A weight that read well as light text on dark may look heavy as dark text on light. Weights are checked again on the light theme, and a body weight one step lighter is allowed when the face supports it.

## Borders

- Decorative dividers are faint: about L 0.90 to 0.92 at the neutral hue.
- A border that alone tells a control apart from its ground needs 3:1 against that ground: around L 0.62 or darker on a ground near L 0.975, measured, because it shifts with chroma and hue. A control with its own fill can carry a lighter border, as long as the fill or the border reaches 3:1.
- Borders and shadows lean toward the neutral hue, never toward the accent.

## Accents

An accent in a light theme does two different jobs, and each job gets its own value:

- **Accent as text and icon** on the ground: the same hue, lowered in lightness until it meets 4.5:1 on the lowest surface it sits on. For most hues this lands between L 0.45 and 0.55; for yellow, orange and lime it lands lower, near L 0.50 or below, because their luminance is high at any given saturation.
- **Accent as fill** under a label, a primary button: lowered until its label meets 4.5:1. White labels suit blue, violet, red, green, and an orange darkened to about L 0.55. Yellow, amber, lime and cyan keep their light fill and take a dark label instead. Both labels are measured; the one that also reads better to the eye is kept.
- **Accent as tint**, a selected row, a badge-free highlight, a container: a pale version of the hue, L 0.92 to 0.96 and chroma 0.02 to 0.05, with text in the accent's dark shade.

Chroma is set for the new lightness, not copied. A neon accent from a dark theme, chroma above roughly 0.18, loses 10 to 25 percent of it on light, because the bright field already amplifies it. A pastel accent from a dark theme, chroma near 0.10, needs more chroma once it is darkened, or it turns grey and dull. Either way the brand colour stays recognisable by its hue. A darkened yellow drifts toward olive, so yellows and oranges move a few degrees toward red as they get darker, keeping them warm instead of muddy.

**The area budget.** A saturated accent covers a small share of the screen in a light theme, around a tenth at most: actions, selection, focus, small marks. Large areas that the dark theme painted in the accent take its tint instead. A loud colour spread over a large light area is the most common reason a light theme hurts to look at.

## Complementary and companion hues

When the source pairs a cool ground with a warm accent, navy with orange for instance, the inverted result is white with a bright orange, which glares. The light theme keeps the relationship and changes its weight:

- The cool family moves into the neutrals: a cool-tinted off-white ground, slate text, cool borders. The complement now works as hue contrast against a quiet field, not as brightness contrast against a dark one.
- The warm accent takes its deeper, quieter shade, a burnt orange or terracotta rather than a neon orange, and is spent on small marks.
- Two saturated complements of similar lightness never touch over a large edge: orange text on a blue fill vibrates. One of the pair is pale or dark enough to give a clear lightness step.
- A second accent comes from the same hue family or a split complement, at the same reduced chroma, with a job of its own.

## Elevation and shadows

- Raised layers use one soft shadow, two layers at most: a tight one for the edge and a wide, faint one for depth, for example a 1 to 2 pixel offset with 2 to 4 pixels of blur at 4 to 8 percent, plus a 4 to 12 pixel offset with 12 to 32 pixels of blur at 6 to 12 percent.
- The shadow colour is the neutral hue at low lightness with alpha, never pure black, and never the accent.
- A layer is separated by a shadow or by a border, not both, as in [tokens.md](tokens.md), Shape.
- Glows, outer halos and neon edges from the dark theme do not carry over. On a light field they read as smudges.

## States

Interactive states move the other way from dark. Hover on a light surface darkens a step, around L minus 0.03 to 0.05, or adds a faint tint of the accent; pressed goes one step further; selected takes the accent tint with a stronger edge. Focus keeps a ring that meets 3:1 against the ground and against the raised surface. Every state is measured, as in [colour-and-theming](protocols/colour-and-theming.md), step 5.

## Status, data and imagery

- Status colours follow the accent rules: a dark shade for text and icons, a pale tint for containers, the base shade only for small fills.
- Chart series are re-derived for the light field, mid lightness around L 0.55 to 0.65, each at 3:1 against the ground, still distinguishable in greyscale with a second cue.
- Images, illustrations and logos made for dark get light variants: a dark logo, illustrations without glow, photos without light text baked in.
- Gradients become flat tints or very low-contrast washes; a gradient that only worked as light on dark is removed.

## Precedents

Mature systems never invert. Material Design derives each role from tonal palettes, with primary at tone 40 on light and 80 on dark and neutral surfaces that carry a little of the source chroma. Radix Colors ships separate light and dark scales with fixed jobs per step. Catppuccin's light flavour keeps the hue family of every accent from its dark flavours, lowers its OKLCH lightness by about 0.13 to 0.23, raises the chroma of its pastels, and turns its yellow and peach toward red, on a cool-tinted ground near L 0.96 with text near L 0.44 rather than black. Solarized keeps its accents in both modes and mirrors the lightness steps of its neutrals so both modes hold the same brightness contrast, a soft character that proves low contrast can be deliberate, while its lighter accents show what the floors are for.
