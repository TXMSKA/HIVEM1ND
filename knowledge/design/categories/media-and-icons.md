# Media and icons

Icons, images, video, fonts, brand marks and texture: every asset a surface loads.

## Icons

Applies when: icons are added ("add icons"), an icon is drawn by hand, sets are mixed, an icon has a hardcoded colour, or an icon-only control has no name.

Options:

- **Icons where they replace reading**: navigation, toolbars, file types, status.
- **Icon with a label** by default; **icon only** in dense toolbars and collapsed rails, with an accessible name and a tooltip.
- **No icon** on headings and paragraphs.

Build: Pick one published open icon set and read its licence. Copy each glyph as inline SVG from the set's own files, remove fixed colours and sizes, draw in `currentColor` with one stroke width, 1.25em beside text and 20 or 24 CSS pixels in controls, `aria-hidden="true"` beside a label and an accessible name when alone. With no set available, the icon becomes its text label. Never emoji, never a hand-drawn path.

Open: [assets-and-media](../protocols/assets-and-media.md), steps 1 to 3; [icons-and-media.md](../icons-and-media.md), Icons, Choosing whether to add icons.

## Images and photography

Applies when: images are added, a page is slow, the layout jumps on load, a screenshot is served as PNG, or a hero lacks a real visual.

Options:

- **A real photograph or screenshot** of the subject, one decisive image rather than several weak ones.
- **An authored or generated image** sized for its slot at twice the displayed size.
- **A visible gap** when the real asset does not exist yet, never an invented one.

Build: WebP or AVIF at twice the rendered box, `width` and `height` or `aspect-ratio` set, `loading="lazy"` below the fold, `fetchpriority="high"` on the largest image of the first viewport, alternative text on every meaningful image, and a visible gap when the real asset does not exist.

Open: [assets-and-media](../protocols/assets-and-media.md), steps 4, 5 and 7; [icons-and-media.md](../icons-and-media.md), Images.

## Video

Applies when: a background video, a product demo or an embed is added.

Options:

- **A muted inline loop with a poster** for atmosphere, with a pause control past five seconds.
- **A player with controls, captions and a transcript** for content.
- **A poster image alone** under reduced motion or on a slow connection.

Build: `muted`, `playsinline` and `preload="none"` with a `poster`, a pause control on any loop past 5 seconds, captions and a transcript for content.

Open: [assets-and-media](../protocols/assets-and-media.md), step 5; [motion](../protocols/motion.md), step 7; [accessibility](../protocols/accessibility.md), step 7.

## Fonts

Applies when: a face is added or changed, text renders in a fallback face, text is invisible while loading, or text widths look wrong in development.

Options:

- **Self-hosted, subset WOFF2 with swap**, preloading only the first paint's faces.
- **The platform's system face** for a working app with no claim to its own world.
- **The brand's own face** from its assets, before any substitute.

Build: The platform system stack for a working app. Otherwise self-hosted WOFF2, subset to the characters in use, `font-display: swap`, a preload only for the first paint's faces, and the loaded source read back from the page.

Open: [assets-and-media](../protocols/assets-and-media.md), step 6; [icons-and-media.md](../icons-and-media.md), Fonts.

## Brand marks and logos

Applies when: a logo, a wordmark or a product mark is placed, redrawn or recoloured; a shared package is asked to carry a brand.

Options:

- **The mark traced from the brand's artwork**, the artwork winning over the brand sheet.
- **A neutral shared package** with no mark, tinted by the hosting product through tokens.
- **A simple monogram** for an invented brand in a prototype.

Build: The brand's own artwork as SVG. For an invented brand in a prototype, a monogram of one or two letters in the display role, inside a simple shape drawn from the tokens.

Open: [icons-and-media.md](../icons-and-media.md), Icons, Fonts; [app-shell.md](../app-shell.md), Never.

## Illustration and texture

Applies when: decorative illustrations, grain, paper, patterns or background textures are added, or a direction calls for a material world.

Options:

- **Texture from the subject's own world**, as a real raster asset, when the direction names a material.
- **Precise vector geometry** for diagrams and linework.
- **None**, which beats fake grain, sketch-style scenes or a gradient pretending to be a material.

Build: None by default; a real raster texture from the subject's world when the direction names one; precise vector geometry for diagrams.

Open: [direction.md](../direction.md), Restyle by theme; [defaults.md](../defaults.md), Surface habits.
