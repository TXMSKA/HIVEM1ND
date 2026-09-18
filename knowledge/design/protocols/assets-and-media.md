name: assets-and-media
purpose: Keep icons from one fetched set, images and video light and stable, and the real fonts loaded.
scope: icons, images, video, fonts, logos and brand marks on any rendered surface
trigger: manual, on any icon, image, video, font or brand mark added or changed, and on a request to add icons or imagery
repeat: once per surface, and again whenever an asset is added
inputs: the component tree, the asset folder, the rendered page on a cold load, the network panel
stop: a brand mark or face is needed and the brand's own assets cannot be found, in which case the gap is reported rather than invented
report: the icon set and the count of icons fetched, the image table with format, rendered size and weight, the largest paint element and its time, and the loaded font sources

## Steps

1. Fetch the icons from one set.
   Task: list every functional icon on the surface, confirm it comes from one published set, and replace any hand-drawn or foreign glyph with the same set's glyph, following [icons-and-media.md](../icons-and-media.md). Brand marks are the only drawings, traced from the brand's artwork.
   Time: 20 minutes.
   Result: the set named, the count of icons per source equal to one source, and zero functional icons with a hand-written path.

2. Embed them inline and themeable.
   Task: paste each icon as inline SVG with its hardcoded colours and its width and height attributes removed, and give an accessible name to every icon that is the only content of a control.
   Time: 15 minutes.
   Result: the search for fill or stroke colour literals inside icons returns zero hits, no icon package appears in the dependency manifest, and every icon-only control has a name.

3. Place icons where they replace reading.
   Task: for a request to add icons, list the candidate places and keep only those where a glyph speeds recognition: navigation, toolbars, file types, status. Leave headings and paragraphs bare.
   Time: 10 minutes.
   Result: the list of places recorded with the reason for each, and a screenshot of the surface with the icons in place.

4. Right-size every image.
   Task: record each image's format, intrinsic size, rendered size and transfer weight. Convert photographs and screenshots to WebP or AVIF, export at twice the rendered box, and give every image a width and a height or an aspect ratio.
   Time: 30 minutes.
   Result: the image table with no photograph served as PNG, no intrinsic width above twice the rendered width, and zero images without reserved dimensions.

5. Order the loading.
   Task: measure which element is the largest paint on a cold load with throttling, give it high fetch priority, lazy-load every image that starts off screen, and give every video a poster, no preload, muted and inline playback.
   Time: 20 minutes.
   Result: the largest paint element named with its time from a cold, throttled load, the layout shift score below 0.1, and zero off-screen images loading eagerly.

6. Prove the fonts.
   Task: read the source of every loaded face from the loaded-fonts list in the running page, confirm each is self-hosted WOFF2 with a swap display, and preload only the faces the first paint uses.
   Time: 15 minutes.
   Result: every face listed with a real file source, not a local fallback under the original family name, and the preload count equal to the faces of the first viewport.

7. Leave no invented or orphaned asset.
   Task: find placeholders that look real, such as fake screenshots built from boxes, stock faces presented as the team or invented reviews, and files nothing references.
   Time: 15 minutes.
   Result: every placeholder is either replaced by a real asset, removed, or visibly marked as missing, and the search for unreferenced files in the asset folder returns zero hits.
