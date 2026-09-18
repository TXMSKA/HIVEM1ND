# Animation

Motion earns its place when it carries meaning: it tells the story of the page, it establishes hierarchy, or it confirms that an action registered. Motion that does none of those three is decoration, and decoration costs load, attention and accessibility.

This file is the catalogue: the gates an animation passes, the patterns by purpose, the numbers, and the recipes per component. The measured checks run in [motion](protocols/motion.md).

## Gates

An animation is built only when it passes all four, in order. Most candidates fail one, and that is the expected result.

1. **Frequency.** An action performed a hundred times a day, such as a keyboard shortcut, a command palette or core navigation, never animates. One performed tens of times a day, such as hover and list navigation, animates barely or not at all. Occasional surfaces, such as modals, drawers, toasts and settings, take standard motion. Rare and first-time moments, such as onboarding, a first success or an empty state being filled, are where expressive motion lives. A keyboard shortcut, the command palette, focus movement and list navigation by arrow keys never animate; an overlay opened by Enter on a button keeps its standard motion, so no input modality has to be detected.
2. **Purpose.** The motion gives feedback, keeps two positions spatially connected, shows a change of state, softens a change that would otherwise jar, or explains something on a marketing or onboarding surface. If the purpose cannot be said in one sentence, it is not built.
3. **Budget.** It fits the durations below. A moment that only works slow and showy fails.
4. **Function.** It does not stand between the person and what they are reading or doing. Data being read or acted on does not animate for style.

## Surfaces set the level

- **A working app stays quiet on purpose.** Feedback on press, overlays that grow from their trigger, a short crossfade of about 180 milliseconds between states, and nothing else.
- **A marketing or story page may carry one committed gesture.** One movement that belongs to the subject, stated in a line before any design exists, performed once and well, with the chrome around it quiet. One gesture with an argument beats a dozen effects spread across the page.
- **Personality is held across the product.** A playful product can bounce; a dashboard stays crisp. One bouncy component inside a crisp product is a defect.
- **Motion that is claimed ships.** A plan that promises movement delivers working movement or drops to a static design; a half-built motion layer is worse than none.

## Patterns by purpose

### Scroll motion carries the story

- **Parallax.** Layers moving at different speeds to build depth as the page advances.
- **Scrub.** The animation is tied to scroll progress rather than to a timer, so the reader controls the pace.
- **Pin and transform.** A section holds in place while its content changes through a sequence, when several beats belong to one idea. Variants: a stack of cards pinned in turn, each shrinking slightly as the next arrives; a horizontal track scrubbed while its wrapper is pinned; a path that draws itself along the scroll.
- Scroll motion belongs to marketing and story surfaces, never to daily functional screens.

### Reveal motion carries hierarchy

- **Fade and lift.** A short fade with a small upward translation. Simple, reliable, and an acceptable finished default for entrances.
- **Stagger.** Items entering one after another, which tells the eye the order in which they matter. Only on views seen occasionally, never on a list scrolled all day.
- **Clip reveal.** Content uncovered by a moving mask, for a single hero moment rather than as a general entrance.
- Reveals fire once, when the element enters the viewport with a margin of about 100 pixels. Re-firing on every pass fights the reader.

### Hover and press motion is feedback

- **Press.** A pressable element shrinks slightly while held, so it feels physical. Feedback starts on pointer down and the action commits on release.
- **Magnetic call to action.** A button drifting slightly toward the cursor, smoothed through a spring rather than bound directly to the pointer.
- **Image zoom.** The image scales inside its frame. The frame does not move, so the surrounding layout never shifts.
- **Text shift.** An underline, a label or an icon reacting to the pointer: the cheapest way to make a link feel alive.
- Hover motion is gated to devices that report both hover and a fine pointer, because touch fires a hover on tap. Press feedback needs no gate.

### State motion keeps the person oriented

- **Crossfade.** One state fades out while the next fades in, in the same place. When the two visibly double up, a blur of about 2 pixels and a dip in opacity during the swap hides the overlap.
- **Continuity.** Before and after stay visibly connected: a rectangle that resizes, an element that travels from a thumbnail into a card, a status pill that morphs as its content changes.
- **Direction.** Content moves one way going forward and the opposite way going back, in stepped flows and paged views.
- **Origin.** A menu, popover or tooltip grows out of the control that opened it. A modal stays centred.
- **Enter and exit on the same path.** A surface leaves the way it came, which makes swiping it away feel obvious.

### Gesture motion follows the hand

- A dragged element tracks the pointer one to one, keeps the offset from where it was grabbed, and keeps tracking when the pointer leaves it.
- Release carries its velocity into the settle. A flick dismisses on speed alone, above about 0.11 pixels per millisecond, whatever the distance.
- A boundary resists with growing friction and springs back, never stops dead.
- Extra touch points during a drag are ignored, so changing fingers does not make the element jump.

### Ambient motion is rare

Pulse, float, shimmer, marquee and typewriter loops run only where motion carries a meaning such as a live status. At most one marquee per page, and informational sections stay still.

## Numbers

| Motion | Duration |
| --- | --- |
| Press feedback, toggle, checkbox | 100 to 160 ms |
| Tooltip, small popover | 125 to 200 ms |
| Dropdown, select, menu | 150 to 250 ms |
| Modal | 200 to 300 ms |
| Drawer, sheet, toast travelling its own size | up to 500 ms |
| Marketing reveal, explanatory sequence | may run longer, never delaying readable content |

- **Interface motion stays at or under 300 milliseconds.** A select that opens in 180 feels faster than one that opens in 400. Exits run shorter than entrances: slow where the person decides, fast where the system answers.
- **Easing by direction.** Entering and exiting use a decelerating curve. Moving or morphing on screen uses a symmetric in-and-out curve. Hover and colour changes use the plain ease. Constant motion such as a spinner, a marquee or a progress fill uses linear. An accelerating curve is never used on interface motion, because it delays the first movement exactly when the eye is watching.
- **Curves are explicit.** The built-in keywords are weak. Working values: a strong decelerate `cubic-bezier(0.23, 1, 0.32, 1)`, a strong in-and-out `cubic-bezier(0.77, 0, 0.175, 1)`, and a sheet curve `cubic-bezier(0.32, 0.72, 0, 1)`. New curves extend the project's motion tokens instead of starting a parallel set.
- **Springs for anything a hand drives.** A spring starts from the current value and can be grabbed and reversed mid-flight. Default interface spring: no bounce, settling in about 0.3 to 0.4 seconds. Bounce, kept between 0.1 and 0.3, is added only after a gesture that carried momentum, such as a flick or a drag release.
- **Scale never starts at zero.** An entrance starts between 0.9 and 0.97 together with zero opacity; press feedback sits between 0.95 and 0.98.
- **Distances are relative.** A drawer or toast hidden off screen is translated by 100 percent of its own size, so it works at any height. Staggered items rise about 8 pixels.
- **Stagger** sits between 30 and 80 milliseconds per item, and never blocks interaction while it plays.
- **Blur** stays under 20 pixels; above that it drops frames.

## Recipes

- **Press.** Transform only, about 160 milliseconds on the strong decelerate, shrinking to 0.97.
- **Menu or popover.** Origin at the trigger; opacity and transform at about 200 milliseconds on the strong decelerate, from scale 0.95 and zero opacity.
- **Tooltip.** Same shape at about 125 milliseconds from scale 0.97. The first tooltip waits a short delay so it does not open by accident; once one is open, its neighbours open at once with no animation, which makes a toolbar feel fast.
- **Modal.** Centred; about 250 milliseconds from scale 0.96 and zero opacity, with the backdrop fading over the same time so both read as one surface.
- **Drawer or sheet.** Closed is offset by its full size; it travels on the sheet curve in up to 500 milliseconds, and turns into a spring once it can be dragged.
- **Toast.** Enters from its edge by its full height with a fade, leaves through the same edge, and uses transitions rather than keyframes because toasts stack and retrigger. Its timer pauses while the tab is hidden and while the pointer rests on it.
- **Accordion.** Height and opacity at about 200 milliseconds, with the height measured rather than animated to automatic. Height is tolerated here only.
- **Tabs.** A duplicate of the tab row styled as active, clipped to the active tab, with the clip animated on change, so text and background switch in one motion.
- **Hold to confirm.** For a destructive action a single click could fire by accident: a fill grows across the button over about 2 seconds, linear because it is progress, and snaps back in about 200 milliseconds on release.
- **Number change.** Tabular numerals, with the digits rolling or morphing in place rather than the text re-rendering.
- **Loading.** A skeleton in the shape of the final layout. A spinner that turns faster makes the same wait feel shorter.

## Choosing the tool

The cheapest mechanism that works: a CSS transition for a state toggle, the starting-style rule for an entrance on mount, a CSS animation for predetermined motion during load, the browser's native animation interface for programmatic control, and a motion library only for springs, layout animation, exits and gestures. A library is never installed for a fade. One animation engine per component tree, and every effect cleans up when its component leaves. A whole component such as a toast, a drawer or a menu comes from a headless accessible primitive rather than being hand-rolled, which loses focus management.

## Constraints

- **Honour reduced motion.** Under the reduced motion preference, travel, springs, parallax and loops go; opacity and colour feedback stay, so every confirmation still happens. The fallback ships with the animation, not after it.
- **Never delay critical content.** A reveal or a stagger on the first meaningful paint makes the reader wait for text that was already loaded. Entrance motion applies below the fold, or after the content is readable.
- **Hover never moves layout.** Motion on hover stays inside the element's box.
- **Animate transform and opacity.** Clip path is the sanctioned third property. Width, height, padding, margin, top and left are never animated, because each forces layout on every frame.
- **Check contrast through the whole animation.** A mid-transition opacity can drop text below its contrast floor on a dark surface even though the start and end states pass.
- **Keep it interruptible.** Input is never locked while a transition runs, and an interrupted animation retargets from where it is on screen, not from where it was going.
