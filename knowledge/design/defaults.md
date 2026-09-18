# Defaults

A default is a treatment that arrives without a decision. Every item here is legitimate for some brief. The failure is not the treatment, it is reaching for it while the axis was free. When the brief pins a direction, the brief wins and the item is a choice; when the brief is silent, the item is a tell.

Recognising one means rewriting the element, not softening it.

## Template chrome

These carry no information and appear whatever the subject.

- A tracked, all-caps eyebrow or kicker above a heading. The heading carries its own weight.
- Section numbers such as 01, 02, 03 when the content is not a sequence the reader has to follow in order.
- Metadata strings joined with middle dots, and labels built as a word plus a spaced dash.
- An arrow glyph appended to link or button text.
- Monospace used as a costume for technical subject matter rather than for code, commands, paths, identifiers or measurement.
- Emoji or stray Unicode glyphs standing in for an icon set.
- A badge, pill or capsule around ordinary metadata.

## Page scaffolds

- A centred hero paragraph followed by a grid of identical cards as the structure of the page.
- The hero metric template: one big number, a small label, three supporting stats and an accent.
- Cards nested inside cards. Nesting is always wrong; the outer container should be spacing.
- Borders added to repair a hierarchy that typography failed to establish.
- Repeated sections that restate one conclusion at equal prominence. Each section answers a new question or it is cut.
- A modal for a task that needs neither interruption nor protected focus.

## Surface habits

- Decorative gradients, glows, blobs, stripes, grid backgrounds, glass and simulated paper.
- Gradient text. Emphasis comes from weight, size or position.
- A coloured left or right border thicker than 1 pixel on cards, list items, callouts or alerts.
- A shadow with no offset, or a hard offset shadow with no blur, outside a world that actually chose it.
- Sparklines, progress rings and soft rounded rectangles standing in for content that does not exist.
- A system font as the display voice of a page that claims its own world.
- Light or dark picked by product category rather than by the scene the interface is used in.

## Palette and type clusters

Generated interfaces cluster. Landing on one of these by accident means the axis was never decided:

- A warm cream page near #F4F1EA with a high contrast serif display and a terracotta accent near #D97757.
- A near black page with one acid green or vermilion accent.
- A broadsheet with hairline rules, zero radius and dense columns.
- The card kit: one radius on everything regardless of hierarchy, the same soft grey shadow under each surface, gradient washes as decoration.
- A tinted near black such as #0B0B0B or #111 standing in for black.

## Searches

Run these over the component tree. Each should return no hits, or each hit should carry a line reference and the sentence in the brief that earns it.

| Search | Finds |
| --- | --- |
| `text-transform:\s*uppercase` | All-caps labels and eyebrows |
| `letter-spacing:\s*0\.0[6-9]|letter-spacing:\s*0\.[1-9]` | Tracked-out small text |
| `>\s*0[0-9]\s*<` | Decorative section numbers |
| `→|·` | Appended arrows and middle-dot metadata |
| `font-family:[^;]*mono` | Monospace outside code and measurement |
| `linear-gradient|radial-gradient` | Decorative gradients and gradient text |
| `#[0-9a-fA-F]{3,8}|rgba?\(` | Colour written outside the token file |
| `border-radius` | Radius set outside the shape scale |
| `box-shadow:[^;]*0 0 ` | Zero offset halos |
| `transition:\s*all` | Unlisted transition properties |
| `outline:\s*none` | Focus rings removed |
