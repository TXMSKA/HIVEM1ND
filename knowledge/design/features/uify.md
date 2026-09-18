---
name: uify
description: Beautifies the surface in front of it, a named target, or the whole surface along a stated direction, by resolving the design categories it touches and running their passes with evidence.
category: quality
---

# /uify

Mind: {{mind}}
Argument: [target or direction]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Read the argument. With none, the subject is what is in front of the session: the open page, the current view, the component last worked on. An argument that names something, such as `form`, `the pricing card` or `the header`, is a target and narrows the pass to it. An argument that describes a change, such as `switch to a medieval theme`, `add icons` or `add storytelling`, is a direction and steers the pass across the subject. A request that names a whole surface and then points at one defect is a target on that defect. Say the reading in one line; when two readings lead to different work, ask before going further.

2. Resolve the categories. Read [INDEX.md](../INDEX.md) and match the subject against the category lines, then open only the matching category files and, inside them, the subcategories whose use cases match. A target usually touches one to three subcategories; no argument means the categories the surface actually contains. A direction adds its own subcategory: a look goes to direction and restyle in foundations, `add icons` to icons in media and icons, `add storytelling` to storytelling in pages and composition and to scroll and storytelling in motion. Name the subcategories and the option taken in each, in one line.

3. Collect the passes. From the chosen subcategories, take the protocols and topic sections they name, deduplicated, and read only those. [visual-critique](../protocols/visual-critique.md) and [accessibility](../protocols/accessibility.md) are always in the set. Name the protocols in one line.

4. Plan before editing. Write the subject, its audience and its primary job in one line each, the mode of the surface, and the design plan: the palette as four to six named values with a role each, the type roles and faces, the layout in one sentence, the motion level, and the one place where boldness is spent. For a direction, add the direction contract from [direction.md](../direction.md). Check the plan against [defaults.md](../defaults.md) and rewrite whatever reads as a default. No file is edited before the plan exists, and none before the requester's yes when the change goes beyond a target they named.

5. Apply within the boundary. A target changes only the target; a neighbour that now looks inconsistent is reported, not fixed. A direction moves the primitive layer, the faces and the assets, and components only where the direction itself is the component change, such as adding icons. A direction that would force a component to change for a look alone is recorded as a gap in the token layer.

6. Verify in the browser. Run each collected protocol's steps against the rendered surface and produce the artifacts they ask for: computed numbers, named screenshots of each state in both themes where colour moved, searches with zero hits, the keyboard walk transcript, the written critique. A check that could not be run is reported as not run.

7. Hold the floors. The pass stops, is fixed and is measured again if any contrast pair falls below its target, 4.5:1 for body text, 3:1 for large text and 3:1 for non-text and the focus ring, or if the keyboard walk breaks at any stop. Nothing continues past either failure, whatever the direction asks.

8. Report the evidence. Give the reading, the subcategories and options taken, the protocols run, the numbers, the named captures, the findings ranked by the scale in [evidence.md](../evidence.md) with a fix against each, the fresh-eyes verdict, and whatever could not be verified. The evidence goes where the pass is reported, a task report when a task is open.
