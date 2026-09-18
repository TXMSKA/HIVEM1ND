---
name: uify
description: Beautifies the surface in front of it, or the one named, running the design protocols that apply and recording the evidence each one asks for.
category: quality
---

# /uify

Mind: {{mind}}
Argument: [target or direction]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Resolve the subject. With no argument, the subject is whatever is in front of the session: the open page, the current view, the component last worked on. With an argument, read it as a scope or as a direction. A scope names a component, a view or a page and narrows the pass to it. A direction names an aesthetic, an addition such as an icon set or a narrative layer, or a change of look, and steers the pass instead of narrowing it. Say which reading was taken, in one line, before doing anything else.

2. Pick the protocols. Read [INDEX.md](../INDEX.md) and match the subject against the second column. Take the two or three protocols that apply and read only those. A direction always adds [theme-direction](../protocols/theme-direction.md). Name the chosen protocols in one line. Reading the whole module is a failure of this step, not thoroughness.

3. Write the plan before touching code. Name the concrete subject, its audience and its primary job, in one line each. Then write the design plan: the palette as four to six named values with the role of each, the type roles and the faces that carry them, the layout in one sentence, the alignment, and the one place where boldness is spent. Review the plan against the brief and against the defaults topic, rewrite whatever reads as a default rather than a choice, and say what changed. No file is edited before this exists.

4. Apply a direction through the token layer only. A direction moves the primitive colours, the font stack, the type scale, the radius scale, the shadow scale and the texture layer. The semantic roles keep their names and their meanings, and the component code does not change. A direction that requires a component to change is reported as a gap in the token layer, not absorbed silently.

5. Build, then verify in the browser. Run each chosen protocol's steps and produce the artifacts they name: the computed numbers, the screenshots of named states in both themes, the searches that return no hits, the keyboard walk transcript. A check that could not be run is reported as not run.

6. Hold the two floors. A pass never ships if a contrast pair falls below its target, 4.5:1 for body text, 3:1 for large text, 3:1 for non-text and the focus ring, or if the keyboard walk breaks at any stop. Either failure stops the pass, is fixed, and is measured again before anything else continues.

7. Report the evidence, not the effort. Give the protocols run, the numbers measured, the states captured, the findings ranked by the scale in the evidence topic with a fix against each, and whatever could not be verified.
