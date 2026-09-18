# Icons and media

Where an icon comes from and how it is embedded, and how images, video and fonts reach the page without costing the first paint. The checks run in [assets-and-media](protocols/assets-and-media.md).

## Icons

- **Every functional icon comes from one published open icon set, never drawn.** A functional icon is a rail entry, a menu button, a control or a status glyph. It is taken as SVG from the set's own files: a copy already in the project, the set's published package or repository, or an icon search tool when one is available. A path drawn from memory produces the shape that was recalled, not the right one, and it is slower.
- **The licence is respected.** The set's licence is read before the first icon is copied. Permissive code licences such as MIT, ISC or Apache 2.0 ask for the copyright and licence notice to travel with the copied files: a licence file in the icon folder, or a comment in the file that holds the icons. A Creative Commons attribution licence asks for visible credit with a link to the licence, on a credits or about page. A set with no licence, or one that forbids the use, is not used.
- **Normalized on the way in.** Every glyph shares one stroke width and one grid, sized from the icon scale, 1.25em beside text and 20 or 24 CSS pixels in controls, and drawn in `currentColor`.
- **A text label when no set can be fetched.** When no set is in the project and none can be downloaded, each icon is replaced by its word. Fetching a set counts as a download: when the rules of the run require an approval before any download and nobody is there to give it, the set cannot be fetched, and the record says so. The replacement is a visible label, or a text button such as "Delete" or "Close". Chevrons for sorting and disclosure may come from the set or from a text character hidden from assistive technology, with the state carried by an attribute such as `aria-sort` or `aria-expanded`.
- **One set per surface.** Mixing sets on one surface is a defect, not a style: stroke widths, corner treatments and optical sizes stop agreeing. When a needed glyph is missing from the set, the closest glyph of the same set wins over a glyph from another.
- **Inline SVG in the source.** No hardcoded fill or stroke colour, and no width or height attributes: the icon inherits the current text colour and takes its size from the surrounding CSS, which is what lets a theme move it.
- **No icon runtime.** A package that ships every icon to the browser, or a runtime that fetches icons on load, is never added. The SVG lives in the source: no runtime cost and no extra origin in the content security policy.
- **Brand marks are drawings, not icons.** A logo, a wordmark or a product mark is the only hand-drawn path. When the artwork exists, the mark is traced from it rather than typeset, and when a brand sheet and the artwork disagree on a value, the artwork wins. A package shared by several brands carries no mark at all.
- **An icon that is the only content of a control has an accessible name.** An icon beside a text label is decorative and hidden from assistive technology.
- **Emoji never stand in for an icon set**, and neither do decorative Unicode glyphs such as a heavy check or a cross used as a close button.

## Choosing whether to add icons

Icons help where they speed recognition: a rail, a toolbar, a list of file types, a status. They slow reading where they decorate every heading or every paragraph. A request to add icons is answered by listing the places where a glyph replaces reading, and leaving the rest bare.

## Images

- **Format by content.** Photographs and screenshots as WebP or AVIF, never PNG. PNG stays for flat art with hard edges and transparency. A large screenshot saved as PNG commonly weighs twenty times its WebP equivalent.
- **Serve the displayed size.** Export at twice the CSS box, not at the original resolution. A wide original inside a small card is weight nobody sees.
- **Reserve the box.** Every image carries a width and a height, or an aspect ratio, so the page does not jump when it arrives.
- **Eager above the fold, lazy below.** Lazy loading on what starts off screen, high fetch priority on the largest image of the first viewport. Reversed, the cost is paid twice.
- **Find the largest paint by measuring it**, never by guessing which element it is.
- **A heavy image that cannot shrink paints progressively.** A non-progressive file drawn top to bottom on a cold load reads as broken; saving it progressive or interlaced removes the half-drawn frame.
- **Alternative text on every meaningful image**, and an empty alternative on a decorative one.
- **No invented content.** A missing screenshot, photo or testimonial stays visibly missing, or the slot is removed. A placeholder that looks real is a false claim.
- **The file in the repository is the file production serves.** When the two differ, what gets measured is not what anyone sees. Files nothing references are deleted rather than deployed.

## Video

Muted, inline on phones, no preload, and a poster frame. Without the poster the first frame is the empty background, which reads as a failed load. Autoplay is reserved for muted, non-essential loops, with the controls in [motion](protocols/motion.md).

## Fonts

- **Self-hosted, compressed as WOFF2, subset to the characters in use, and swapped in** so text is visible while the face loads. A font that blocks the text is a blank page.
- **Preload only what the first paint needs.** One preload too many competes with the one that matters.
- **Prove the real face loaded.** A development server can silently fall back to a system face under the original family name, and the loaded-fonts list still reports it as loaded. Read the source of the face from the loaded-fonts list, or measure a known string against the face's advance width. A fallback in development means checking the built output before judging any text width.
- **Before inventing a face, a colour or a mark, look for the brand's own assets.** A face that is not on a public font service is usually already in the brand's files.
