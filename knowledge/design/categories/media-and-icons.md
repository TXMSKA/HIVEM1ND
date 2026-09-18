# Media and icons

Icons, images, video, fonts, brand marks and texture: every asset a surface loads.

## Icons

Applies when: icons are added ("add icons"), an icon is drawn by hand, sets are mixed, an icon has a hardcoded colour, or an icon-only control has no name.

Options:

- **Icons where they replace reading**: navigation, toolbars, file types, status.
- **Icon with a label** by default; **icon only** in dense toolbars and collapsed rails, with an accessible name and a tooltip.
- **No icon** on headings and paragraphs.

Open: [assets-and-media](../protocols/assets-and-media.md), steps 1 to 3; [icons-and-media.md](../icons-and-media.md), Icons, Choosing whether to add icons.

## Images and photography

Applies when: images are added, a page is slow, the layout jumps on load, a screenshot is served as PNG, or a hero lacks a real visual.

Options:

- **A real photograph or screenshot** of the subject, one decisive image rather than several weak ones.
- **An authored or generated image** sized for its slot at twice the displayed size.
- **A visible gap** when the real asset does not exist yet, never an invented one.

Open: [assets-and-media](../protocols/assets-and-media.md), steps 4, 5 and 7; [icons-and-media.md](../icons-and-media.md), Images.

## Video

Applies when: a background video, a product demo or an embed is added.

Options:

- **A muted inline loop with a poster** for atmosphere, with a pause control past five seconds.
- **A player with controls, captions and a transcript** for content.
- **A poster image alone** under reduced motion or on a slow connection.

Open: [assets-and-media](../protocols/assets-and-media.md), step 5; [motion](../protocols/motion.md), step 7; [accessibility](../protocols/accessibility.md), step 7.

## Fonts

Applies when: a face is added or changed, text renders in a fallback face, text is invisible while loading, or text widths look wrong in development.

Options:

- **Self-hosted, subset WOFF2 with swap**, preloading only the first paint's faces.
- **The platform's system face** for a working app with no claim to its own world.
- **The brand's own face** from its assets, before any substitute.

Open: [assets-and-media](../protocols/assets-and-media.md), step 6; [icons-and-media.md](../icons-and-media.md), Fonts.

## Brand marks and logos

Applies when: a logo, a wordmark or a product mark is placed, redrawn or recoloured; a shared package is asked to carry a brand.

Options:

- **The mark traced from the brand's artwork**, the artwork winning over the brand sheet.
- **A neutral shared package** with no mark, tinted by the hosting product through tokens.
- **A simple monogram** for an invented brand in a prototype.

Open: [icons-and-media.md](../icons-and-media.md), Icons, Fonts; [app-shell.md](../app-shell.md), Never.

## Illustration and texture

Applies when: decorative illustrations, grain, paper, patterns or background textures are added, or a direction calls for a material world.

Options:

- **Texture from the subject's own world**, as a real raster asset, when the direction names a material.
- **Precise vector geometry** for diagrams and linework.
- **None**, which beats fake grain, sketch-style scenes or a gradient pretending to be a material.

Open: [direction.md](../direction.md), Restyle by theme; [defaults.md](../defaults.md), Surface habits.
