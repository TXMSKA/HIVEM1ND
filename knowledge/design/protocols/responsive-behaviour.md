name: responsive-behaviour
purpose: Hold the layout from 320 CSS pixels to ultra-wide, under real content and under touch.
scope: layout, text length, media and pointer input across viewport widths
trigger: manual, on any change to layout, text length, media or pointer input across widths
repeat: once per surface, and again whenever a breakpoint or a text slot is added
inputs: the rendered page, the breakpoint definitions, the longest and shortest real content available
stop: a breakpoint cannot be reached with the tooling at hand, in which case the untested width is named in the report rather than assumed to pass
report: one screenshot per named width, the overflow measurement at each, the computed input font size, and the touch targets below the working size

## Steps

1. Fix the widths to test.
   Task: pick the narrow width at 320 CSS pixels, the phone width in use, the tablet width, the laptop width and an ultra-wide width, which is simulated by halving the page zoom when no such display is available. Test the real breakpoints of the surface as well, not only the round numbers.
   Time: 10 minutes.
   Result: the list of widths recorded, each marked as measured or as simulated.

2. Capture and measure each width.
   Task: render the surface at every width on the list and read the document scroll width against the client width.
   Time: 30 minutes.
   Result: one screenshot per width, and scroll width equal to client width at each. Any inequality is recorded with the element that overflows.

3. Reflow before shrinking.
   Task: let the layout change its arrangement rather than its scale. Give grid and flex children a zero minimum width so text can truncate or clamp instead of forcing the track wider, and keep type and control sizes readable at every width instead of scaling the page down to fit.
   Time: 30 minutes.
   Result: every flex or grid child that holds text of unknown length computes a minimum width of zero, and the computed body font size is the same at the narrow width as at the wide one.

4. Run the real content.
   Task: fill every text slot with the shortest and the longest real value the data allows, and with a value longer than the design assumed. Run the lists at zero, one, typical and large counts. Numbers, dates and currencies are formatted by locale, not by string concatenation.
   Time: 30 minutes.
   Result: a screenshot per extreme at the narrow and the wide width with no clipped word, no broken box and no horizontal scroll. Long text wraps by default; a container that clamps or truncates does so only where the full value is reachable on focus, on activation or on a linked page, as in [accessibility](accessibility.md), step 6.

5. Make it work under a finger.
   Task: set every pointer target to at least 44 by 44 CSS pixels on touch, expanding the hit area rather than the visual when the visual has to stay small. Set the input font size to at least 16 CSS pixels so the phone browser does not zoom the page on focus, and leave browser zoom enabled: a fixed maximum scale or a disabled user scaling is never shipped.
   Time: 20 minutes.
   Result: the measured bounding box of every target at the touch widths, the computed input font size at or above 16 pixels, and the search `user-scalable\s*=\s*(no|0)|maximum-scale` over the markup returning zero hits.

6. Exercise the gestures.
   Task: give every drag, swipe, pinch or path gesture a tap alternative and a keyboard alternative, unless the gesture is essential to the task. Set the touch action so a double tap does not zoom a control, clear the drag state when the gesture is cancelled or focus is lost, and disable text selection while a drag is running.
   Time: 20 minutes; a surface with no gesture ends this step as not applicable.
   Result: a transcript per gesture showing the alternative path completing the same task, and a transcript of one interrupted gesture leaving no stuck state. A gesture exercised only through an emulated viewport is recorded as untested under touch.

7. Respect the edges of the device.
   Task: inset the content from the safe areas so no control sits under a notch, a rounded corner or a home indicator, and keep the sticky regions clear of the focus ring.
   Time: 15 minutes.
   Result: a screenshot at a width with insets applied showing no control clipped by a device edge.
