# Motion

Everything that moves: entrances, feedback, transitions between states, scroll sequences, gestures and loading. [animation.md](../animation.md) holds the gates, the numbers and the recipes; [motion](../protocols/motion.md) measures them.

## Entrances and reveals

Applies when: content fades or slides in, a list staggers, a request says "animate it", "make it smooth" or "make it feel alive".

Build: None in the first viewport or on screens used all day. Below the fold, a fade and a lift of about 8 pixels at the entrance duration in [animation.md](../animation.md#numbers), on the decelerate curve, fired once.

Options:

- **Fade and lift**, an acceptable finished default for entrances below the first viewport.
- **Stagger** for a group seen occasionally, at the stagger step in [animation.md](../animation.md#numbers).
- **Clip reveal** for one hero moment.
- **No entrance** on screens used all day and on anything in the first viewport that must be readable at once.

Open: [motion](../protocols/motion.md), steps 1, 2 and 5; [animation.md, Reveal motion carries hierarchy](../animation.md#reveal-motion-carries-hierarchy).

## Feedback

Applies when: buttons, links, cards or controls lack a hover or press reaction; a request says "it feels dead" or "add micro-interactions".

Build: `transform: scale(0.97)` on `:active` at the press duration and a hover change of colour or surface at the hover duration, both from [animation.md](../animation.md#numbers), hover gated to `(hover: hover) and (pointer: fine)`; every transition lists its properties.

Options:

- **Press shrink** on every pressable element.
- **Hover reaction** inside the element's box, gated to hover-capable pointers.
- **A magnetic or tracking effect** on one call to action of a marketing page, smoothed through a spring.

Open: [motion](../protocols/motion.md), step 3; [animation.md, Hover and press motion is feedback](../animation.md#hover-and-press-motion-is-feedback).

## Transitions between states

Applies when: an overlay opens, a panel expands, content swaps in place, a tab changes, or a step advances.

Build: Menus grow from their trigger from scale 0.95, modals from 0.96, content swaps by a crossfade, each at its duration in [animation.md](../animation.md#numbers); only `transform`, `opacity` and `clip-path` animate.

Options:

- **Origin-aware growth** for menus, popovers and tooltips; **centred** for modals.
- **Crossfade** for content swapped in place; **continuity** when an element travels between two positions.
- **Direction-aware slide** for stepped flows.

Open: [motion](../protocols/motion.md), steps 2 and 4; [animation.md, State motion keeps the person oriented](../animation.md#state-motion-keeps-the-person-oriented) and [Recipes](../animation.md#recipes).

## Scroll and storytelling

Applies when: a request says "add storytelling", "scroll animations" or "parallax"; a section pins; a sequence plays on scroll.

Build: Write the one gesture in a line first, build it scrubbed by scroll, and give it a static fallback that shows every beat under reduced motion and without script.

Options:

- **One committed gesture** that belongs to the subject, carried through a pinned or scrubbed sequence.
- **Parallax or scrub** for depth and pace on a story page.
- **Static storytelling** by sequence and pacing alone, when motion would cost the reading or the device.

Open: [design-specificity](../protocols/design-specificity.md), step 7; [animation.md, Scroll motion carries the story](../animation.md#scroll-motion-carries-the-story); [pages-and-sections.md, Pacing and storytelling](../pages-and-sections.md#pacing-and-storytelling).

## Gestures and drag

Applies when: something is dragged, swiped, reordered or dismissed by hand, or a sheet is pulled.

Build: Pointer events with a spring settle, `touch-action` set on the draggable surface, the drag state cleared on cancel, and a tap and a keyboard alternative for every gesture that is not essential.

Options:

- **Springs with velocity** for anything a hand drives, with friction at the boundaries.
- **A tap and a keyboard alternative** for every gesture that is not essential.

Open: [motion](../protocols/motion.md), step 4; [responsive-behaviour](../protocols/responsive-behaviour.md), step 6; [animation.md, Gesture motion follows the hand](../animation.md#gesture-motion-follows-the-hand).

## Reduced motion

Applies when: any animation is added, a reduced motion rule sets every duration to near zero, or motion is reported as dizzying.

Build: One `@media (prefers-reduced-motion: reduce)` block beside the motion tokens that removes travel, scale and loops and keeps opacity and colour changes.

Options:

- **Keep the state change, drop the travel**: opacity and colour stay, movement goes.
- **A static alternative** for parallax, loops and scroll sequences.

Open: [motion](../protocols/motion.md), step 6; [animation.md, Constraints](../animation.md#constraints).
