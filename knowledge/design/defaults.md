# Defaults

A default is a treatment that arrives without a decision. Every item here is legitimate for some brief. The failure is not the treatment, it is reaching for it while the axis was free. When the brief pins a direction, the brief wins and the item is a choice; when the brief is silent, the item is a tell. The test for the whole surface: if the look could be guessed from the product category alone, it is a default.

Recognising one means rewriting the element, not softening it.

## Template chrome

These carry no information and appear whatever the subject.

- A tracked, all-caps label above every heading of a marketing page. Rationed, a few such labels can orient a long page; on every section they are noise. In an app shell, a small label naming a card's kind is a choice.
- Section numbers such as 01, 02, 03 when the content is not a sequence the reader has to follow in order.
- Metadata strings joined with middle dots, more than one separator per line, and labels built as a word plus a spaced dash.
- An arrow glyph appended to link or button text.
- A sentence of meta commentary under a heading or under a field, explaining what the element already says.
- Step labels that are numbers alone, where a verb would say what happens.
- Monospace used as a costume for technical subject matter rather than for code, commands, paths, identifiers or measurement.
- Emoji or stray Unicode glyphs standing in for an icon set.
- A badge, pill or capsule around ordinary metadata.
- Version or build labels, scroll cues, rotated vertical text and decorative crosshair lines on a page that is not about any of them.

## Page scaffolds

- A centred hero paragraph followed by a row of identical icon, heading and text cards as the structure of the page.
- The hero metric template: one big number, a small label, three supporting stats and an accent, when no figure drives a decision.
- Cards nested inside cards. The inner level becomes spacing. Cards that group one concept each are a valid choice, not a default.
- Borders added to repair a hierarchy that typography failed to establish.
- Repeated sections that restate one conclusion at equal prominence. Each section answers a new question or it is cut.
- A modal for a task that needs neither interruption nor protected focus.
- Content bands stretched to the viewport height so each one fills a screen.

## Surface habits

- Decorative gradients, glows, blobs, stripes, grid backgrounds, glass and simulated paper, cloth or metal made from CSS.
- Gradient text. Emphasis comes from weight, size or position.
- A coloured left or right border thicker than 1 pixel on cards, callouts or alerts. The selection indicator of a navigation item is the exception.
- A shadow with no offset, a hard offset shadow with no blur outside a world that actually chose it, or a 1 pixel border under a wide soft shadow on the same card.
- Sparklines, progress rings and soft rounded rectangles standing in for content that does not exist.
- A fake product screenshot built from styled boxes, a gradient where the hero's real visual belongs, and round invented numbers presented as data.
- A system font as the display voice of a page that claims its own world.
- Light or dark picked by product category rather than by the scene the interface is used in.
- Motion used as the concept: parallax, hover lifts and reveals scattered over every section instead of one committed gesture. A fade and lift entrance is a finished default and not a tell by itself.

## Palette and type clusters

Generated interfaces cluster. Landing on one of these by accident means the axis was never decided:

- A warm cream page near #F4F1EA with a high contrast serif display and a terracotta accent near #D97757, or the same cream with brass, clay or oxblood accents and espresso text.
- A near black or blue-black slate page with one acid green, neon or vermilion accent and glowing edges.
- A broadsheet with hairline rules, zero radius, an italic display serif and small tracked monospace labels.
- The card kit: one radius on everything regardless of hierarchy and gradient washes as decoration.
- A tinted near black such as #0B0B0B or #111 standing in for black.
- A serif chosen because the brief is creative, or a bookish subject defaulting to cream and serif.

## Searches

Run these over the component tree. Each should return no hits, or each hit should carry a line reference and the sentence in the brief that earns it.

| Search | Finds |
| --- | --- |
| `text-transform:\s*uppercase` | All-caps labels and eyebrows |
| `letter-spacing:\s*0\.0[6-9]|letter-spacing:\s*0\.[1-9]` | Tracked-out small text |
| `>\s*0[0-9]\s*<` | Decorative section numbers |
| `→|·` | Appended arrows and middle-dot metadata |
| `font-family:[^;]*mono` | Monospace outside code and measurement |
| `linear-gradient|radial-gradient|repeating-linear-gradient` | Decorative gradients, stripes and gradient text |
| `feTurbulence` | Fake grain and paper texture |
| `#[0-9a-fA-F]{3,8}|rgba?\(` | Colour written outside the token file |
| `border-radius` | Radius set outside the shape scale |
| `box-shadow:[^;]*0 0 ` | Zero offset halos |
| `min-height:\s*100s?d?vh` | Content bands stretched to the viewport |
| `transition:\s*all` | Unlisted transition properties |
| `scale\(0\)` | Scale entrances from nothing |
| `outline:\s*none` | Focus rings removed |
