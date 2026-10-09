name: visual-critique
purpose: Judge the rendered surface as a person will see it, because passing numbers do not make a page good. It is a gate: floors and automated checks passing are not a verdict on the design.
scope: any rendered page, view or component after a design or polish pass, before it is reported as done
trigger: task close, at the end of every design or polish pass, and before any interface work is reported as done
repeat: once per pass, and again after the fixes it asked for
inputs: the rendered surface at the narrow, the middle and the wide width, the approved board or mockup when one exists, the design plan, the state inventory
stop: the evidence cannot be captured, in which case the pass is reported as not verified rather than as done
report: the named screenshots, the board comparison, the proportion check, the critique with ranked findings and a fix each, the heuristic score when a full review was asked for, and the fresh-eyes verdict

## Steps

1. Capture the key states.
   Task: capture the surface at the narrow, the middle and the wide width, and each key state from the inventory, after entrance animations settle, starting from the top. Open every file and confirm it shows what its name says.
   Time: 20 minutes.
   Result: one screenshot per width and per key state, each named after the surface, the state and the width, and each confirmed by opening it.

2. Set it beside the approved board.
   Task: place each capture beside its approved board or mockup at the same size and compare element by element: controls, icons, shapes, layout, spacing and flows, against the board's own numbers. Anything a fix added that the board does not draw, such as a border, a label, an instruction or a control, is listed as a difference.
   Time: 20 minutes; a surface with no approved board ends this step as not applicable.
   Result: one line per screen, either matching or listing each difference with its element and measurement.

3. Check proportion.
   Task: on the board and again on the screen, check that texts are aligned and centred where they should be, contents are evenly distributed, padding is consistent between siblings, and every component is built whole.
   Time: 15 minutes.
   Result: per screen, each misalignment, uneven gap or broken component with its element and measured offset, or the line "proportion holds".

4. Write the judgment before any number.
   Task: answer the questions in [critique.md](../critique.md) against the captures only: specificity, hierarchy, the one move, alignment and anchoring, rhythm, consistency, states and the edges. Check the surface against the template look in [defaults.md](../defaults.md), Template chrome.
   Time: 20 minutes.
   Result: one line per question naming the element it concerns, written before any detector, search or score was read.

5. Hunt what landed badly.
   Task: look at every boundary where new work meets old: separators against cards, badges against corners, floating surfaces against their triggers, text against edges, and alignment between neighbouring sections.
   Time: 15 minutes.
   Result: every collision, detached surface or misalignment listed with its element and width, or the line "none found at any captured width".

6. Walk it as the personas.
   Task: pick two or three personas from [critique.md](../critique.md) by the kind of surface and walk the primary task as each.
   Time: 20 minutes.
   Result: one line per persona naming the exact element where it stalled, or that it completed the task, and the cognitive load count of failures.

7. Rank and fix.
   Task: rank every finding by the scale in [evidence.md](../evidence.md), give each a concrete fix, and apply the P0 and P1 fixes before continuing.
   Time: 30 minutes.
   Result: the ranked list with a fix against each, and a new capture of every P0 and P1 fix showing it resolved.

8. Get fresh eyes.
   Task: hand the captures and the plan, without the build reasoning, to a reviewer who did not build the surface, by the rule in [critique.md](../critique.md), Fresh eyes.
   Time: 20 minutes.
   Result: the verdict that rule defines. Without it the surface is not reported as done; when no reviewer is available, it is reported as not verified and left to a person.
