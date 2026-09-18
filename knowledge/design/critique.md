# Critique

The measurable checks prove that a page is usable. They do not prove that it is good: contrast, overflow and focus gates have passed pages that were plainly ugly, with elements off centre and popups floating loose from their triggers. A perfect ratio on an ugly page is not a pass. This file is the method for the judgment the numbers cannot make; [visual-critique](protocols/visual-critique.md) runs it.

## Order

1. **Look before measuring.** The design judgment is written before any detector, search or score is read, because a clean scan anchors opinion.
2. **Look at the real thing.** Screenshots of the named key states, at the widths that matter, after entrance animations have settled, captured from the top, each file opened to confirm it shows what its name says. A capture taken and skimmed is not a look.
3. **Look for what landed badly.** Anything on top of, too close to, or inconsistent with what was already there: a separator touching a card, a badge colliding with a corner, a popover detached from its trigger, a heading centred in one section and aligned left in the next.
4. **Then measure**, and let the numbers confirm or overturn the judgment.

## Questions

- **Specificity.** Could an unrelated product use this surface unchanged? If yes, it is a default wearing the product's name. See [defaults.md](defaults.md).
- **Hierarchy.** Blurred until the words are unreadable, does the surface still show the primary element, the secondary one and the main groups, in that order?
- **The one move.** Is there exactly one place where boldness is spent, with everything around it quieter? A second element at the same scale as the focal point is shouting.
- **Alignment and anchoring.** Does every object sit on a shared edge, and does every floating surface stay attached to what opened it?
- **Rhythm.** Are the gaps on three bands, tight within groups and wider between them, with no band that reads as an empty page?
- **Consistency.** Do things that look alike behave alike, and does the same concept carry the same word and the same control everywhere?
- **States.** Were the empty, loading, error, success and disabled states looked at, or only the populated one?
- **Craft at the edges.** Selection colour, caret, scrollbars, focus rings, underline offsets and numerals: the surfaces nobody draws are where a built page and an assembled one differ.

## Heuristic score

For a fuller review, score ten usability heuristics from 0 to 4 each: visibility of system status, match with the real world, control and freedom, consistency, error prevention, recognition over recall, flexibility for experts, minimal design, recovery from errors, and help. A 4 means genuinely excellent; most real interfaces land between 20 and 32 of 40. A heuristic that cannot apply is marked not applicable and the total is rescaled. Scores are tracked across runs so a pass shows a trend, not a mood.

## Cognitive load

Eight checks, counted by failures: one focus per screen, content in chunks of four or fewer, related items grouped, a clear hierarchy, one decision at a time, four or fewer visible choices at each decision, nothing the person must remember from a previous screen, and detail disclosed progressively. Zero or one failure is light, two or three is moderate, four or more is overload. The laws behind these checks are in [ux-laws.md](ux-laws.md).

## Personas

Two or three, picked by the surface, each walked through with named elements rather than impressions.

| Persona | Walks the surface as | Picked for |
| --- | --- | --- |
| First-timer | The first action must be obvious within 5 seconds; icons carry labels | Landing, onboarding, forms, checkout |
| Power user | The core task in under a minute, with shortcuts and escape working | Dashboards, tools, admin |
| Keyboard and screen reader | Keyboard only, zoom at 200 percent, contrast at 4.5:1 | Every surface before it ships |
| Stress tester | Zero items and a thousand, a refresh mid-flow, odd and very long input | Forms, lists, checkout |
| Distracted on a phone | One thumb, a slow connection, 44 pixel targets, state kept after an interruption | Landing, checkout, onboarding |

## The report

A first impression in one line, two or three specific strengths, three to five priority issues each with what it is, why it matters and the concrete fix, the persona red flags naming exact elements, and then minor notes. Findings are ranked by the scale in [evidence.md](evidence.md). The wording is direct: "the submit button", never "some elements"; a fix, never "consider exploring".

## Fresh eyes

The final look comes from a reviewer who did not build the surface: a separate agent, or the same one the next day. A single agent with neither records the verdict as not verifiable with the tool at hand and leaves it to a person. Its verdict is one of four: recapture when the evidence was bad, rebuild when the result failed wholesale, fix with a list of at most eight items, or ship. A fix claimed but not visible in the new capture is unresolved, and a round that resolves nothing ends the loop.
