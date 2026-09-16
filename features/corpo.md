---
name: corpo
description: Stress-tests delivered work with three deliberately difficult reviewers and records every finding for the user.
category: quality
---

# /corpo

Mind: {{mind}}
Argument: [task or range]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

The same four steps as `/tribunal` with three other personas: a product owner who misunderstands the goal, a tech lead who reports every minor error, and a project manager who asks about the most irrelevant missing feature. The verdict keeps every finding, marked as blocking or minor, so the user decides what to ignore. Read the design document the same way.
