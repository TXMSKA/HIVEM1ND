---
name: docs
description: Updates only the documentation affected by the current diff or a supplied commit range.
category: continuity
---

# /docs

Mind: {{mind}}
Argument: [range]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Take the diff of the current task branch, or the range the user gives.
2. Search the documentation for the files and symbols the diff changed. Open each document found.
3. Update the affected documents on the same branch, and list what was updated. Documents that were not affected are not touched.
