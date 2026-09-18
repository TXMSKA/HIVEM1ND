# Motion

Everything that moves: entrances, feedback, transitions between states, scroll sequences, gestures and loading. [animation.md](../animation.md) holds the gates, the numbers and the recipes; [motion](../protocols/motion.md) measures them.

## Entrances and reveals

Applies when: content fades or slides in, a list staggers, a request says "animate it", "make it smooth" or "make it feel alive".

Options:

- **Fade and lift**, an acceptable finished default for entrances below the first viewport.
- **Stagger** for a group seen occasionally, 30 to 80 milliseconds per item.
- **Clip reveal** for one hero moment.
- **No entrance** on screens used all day and on anything in the first viewport that must be readable at once.

Open: [motion](../protocols/motion.md), steps 1, 2 and 5; [animation.md](../animation.md), Reveal motion carries hierarchy.

## Feedback

Applies when: buttons, links, cards or controls lack a hover or press reaction; a request says "it feels dead" or "add micro-interactions".

Options:

- **Press shrink** on every pressable element.
- **Hover reaction** inside the element's box, gated to hover-capable pointers.
- **A magnetic or tracking effect** on one call to action of a marketing page, smoothed through a spring.

Open: [motion](../protocols/motion.md), step 3; [animation.md](../animation.md), Hover and press motion is feedback.

## Transitions between states

Applies when: an overlay opens, a panel expands, content swaps in place, a tab changes, or a step advances.

Options:

- **Origin-aware growth** for menus, popovers and tooltips; **centred** for modals.
- **Crossfade** for content swapped in place; **continuity** when an element travels between two positions.
- **Direction-aware slide** for stepped flows.

Open: [motion](../protocols/motion.md), steps 2 and 4; [animation.md](../animation.md), State motion keeps the person oriented, Recipes.

## Scroll and storytelling

Applies when: a request says "add storytelling", "scroll animations" or "parallax"; a section pins; a sequence plays on scroll.

Options:

- **One committed gesture** that belongs to the subject, carried through a pinned or scrubbed sequence.
- **Parallax or scrub** for depth and pace on a story page.
- **Static storytelling** by sequence and pacing alone, when motion would cost the reading or the device.

Open: [design-specificity](../protocols/design-specificity.md), step 7; [animation.md](../animation.md), Scroll motion carries the story; [pages-and-sections.md](../pages-and-sections.md), Pacing and storytelling.

## Gestures and drag

Applies when: something is dragged, swiped, reordered or dismissed by hand, or a sheet is pulled.

Options:

- **Springs with velocity** for anything a hand drives, with friction at the boundaries.
- **A tap and a keyboard alternative** for every gesture that is not essential.

Open: [motion](../protocols/motion.md), step 4; [responsive-behaviour](../protocols/responsive-behaviour.md), step 6; [animation.md](../animation.md), Gesture motion follows the hand.

## Reduced motion

Applies when: any animation is added, a reduced motion rule sets every duration to near zero, or motion is reported as dizzying.

Options:

- **Keep the state change, drop the travel**: opacity and colour stay, movement goes.
- **A static alternative** for parallax, loops and scroll sequences.

Open: [motion](../protocols/motion.md), step 6; [animation.md](../animation.md), Constraints.
