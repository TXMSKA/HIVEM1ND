name: accessibility
purpose: Meet WCAG 2.2 level AA and keep the keyboard path whole.
trigger: manual, on any change that reaches the rendered page, and always before a surface ships
repeat: once per surface, and again after any change to markup, focus or colour
inputs: the rendered page, the markup, the token file, a keyboard
stop: the keyboard path is broken at any stop, in which case the pass stops and the break is fixed before anything else
report: the keyboard walk transcript, the contrast table, the undersized targets with their measurements, and the reflow measurement

## Steps

1. Use the elements that already do the work.
   Task: replace elements carrying behaviour they do not own: a division with a click handler becomes a button, a navigation control becomes an anchor so that modified clicks and the middle click still work, a data grid becomes a table, a control gets a label. Native semantics come before any ARIA attribute, and ARIA is added only where no element exists.
   Time: 30 minutes.
   Result: the search for click handlers on non-interactive elements returns zero hits, and every control has an accessible name, including the icon-only ones.

2. Walk the surface with the keyboard.
   Task: produce the keyboard walk transcript described in [evidence.md](../evidence.md), forward and back, activating each stop.
   Time: 30 minutes; a walk that cannot be completed is reported at the stop where it broke.
   Result: the transcript, complete from the first stop to the last and back, with every interactive element in the source appearing in it, no trap, and an order that follows the reading order.

3. Keep the focus visible and uncovered.
   Task: give every stop a visible focus ring, grouped on the container where the visual belongs to a group. Check that sticky headers, fixed footers, drawers and toolbars never cover a focused element, and that scroll margin on headings keeps an anchored target clear of a fixed header.
   Time: 20 minutes.
   Result: the search for a removed outline with no replacement returns zero hits, the focus ring measures 3:1 or above against its surroundings, and a screenshot of the focused element under each sticky region shows it fully visible.

4. Measure the targets.
   Task: read the bounding box of every pointer target in CSS pixels, including padding and any pseudo-element hit area.
   Time: 20 minutes.
   Result: every target measures at least 24 by 24 CSS pixels, or falls under an exception: an equivalent control elsewhere on the page that meets the size, a target inline in a sentence whose size the line height constrains, a target sized by the browser and not by the page, a target whose exact presentation is essential, or an undersized target spaced so that a 24 pixel circle centred on it intersects no other target. On touch, 44 by 44 is the working size, and a visual smaller than the target gets its hit area expanded rather than its box.

5. Meet the contrast numbers.
   Task: take the contrast tables from [colour-and-theming](colour-and-theming.md), or compute them here when that protocol did not run.
   Time: 15 minutes.
   Result: body and placeholder text at 4.5:1 or above, text at 18pt or 14pt bold and larger at 3:1 or above, interface components and meaningful graphics at 3:1 or above, in both themes, and no message carried by colour alone.

6. Survive the reader's own settings.
   Task: apply the text spacing a reader may set: line height at 1.5 times the font size, paragraph spacing at 2 times, letter spacing at 0.12 times and word spacing at 0.16 times. Then reflow the page to 320 CSS pixels wide and to 256 CSS pixels tall.
   Time: 20 minutes.
   Result: screenshots at both settings with no content lost, no clipping and no second scroll axis, except where a two-dimensional layout such as a data table genuinely needs one.

7. Give the page its landmarks.
   Task: add a skip link to the main content, mark the landmark regions, order the headings without skipping a level, and keep the document title matched to the current view. Decorative elements are hidden from assistive technology, media carries captions or a transcript, and its controls work from the keyboard.
   Time: 20 minutes.
   Result: the document outline with one level-one heading and no skipped level, the skip link appearing as the first keyboard stop in the transcript, and the title recorded for each view.
