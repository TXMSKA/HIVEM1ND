name: visual-critique
purpose: Judge the rendered surface as a person will see it, because passing numbers do not make a page good.
scope: any rendered page, view or component after a design or polish pass, before it is reported as done
trigger: manual, at the end of every design or polish pass, and before any interface work is reported as done
repeat: once per pass, and again after the fixes it asked for
inputs: the rendered surface at the narrow, the middle and the wide width, the design plan, the state inventory
stop: the evidence cannot be captured, in which case the pass is reported as not verified rather than as done
report: the named screenshots, the critique with ranked findings and a fix each, the heuristic score when a full review was asked for, and the fresh-eyes verdict

## Steps

1. Capture the key states.
   Task: capture the surface at the narrow, the middle and the wide width, and each key state from the inventory, after entrance animations settle, starting from the top. Open every file and confirm it shows what its name says.
   Time: 20 minutes.
   Result: one screenshot per width and per key state, each named after the surface, the state and the width, and each confirmed by opening it.

2. Write the judgment before any number.
   Task: answer the questions in [critique.md](../critique.md) against the captures only: specificity, hierarchy, the one move, alignment and anchoring, rhythm, consistency, states and the edges.
   Time: 20 minutes.
   Result: one line per question naming the element it concerns, written before any detector, search or score was read.

3. Hunt what landed badly.
   Task: look at every boundary where new work meets old: separators against cards, badges against corners, floating surfaces against their triggers, text against edges, and alignment between neighbouring sections.
   Time: 15 minutes.
   Result: every collision, detached surface or misalignment listed with its element and width, or the line "none found at any captured width".

4. Walk it as the personas.
   Task: pick two or three personas from [critique.md](../critique.md) by the kind of surface and walk the primary task as each.
   Time: 20 minutes.
   Result: one line per persona naming the exact element where it stalled, or that it completed the task, and the cognitive load count of failures.

5. Rank and fix.
   Task: rank every finding by the scale in [evidence.md](../evidence.md), give each a concrete fix, and apply the P0 and P1 fixes before continuing.
   Time: 30 minutes.
   Result: the ranked list with a fix against each, and a new capture of every P0 and P1 fix showing it resolved.

6. Get fresh eyes.
   Task: hand the captures and the plan, without the build reasoning, to a reviewer who did not build the surface, by the rule in [critique.md](../critique.md), Fresh eyes.
   Time: 20 minutes.
   Result: the verdict that rule defines, or the step recorded as not verifiable with the tool at hand.
