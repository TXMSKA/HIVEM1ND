---
name: conflicts
description: Resolves compatible merge or rebase conflicts, asks about incompatible hunks and verifies the build before completion.
category: quality
---

# /conflicts

Mind: {{mind}}
Argument: none

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. On a merge or rebase with conflicts, list the conflicted files.
2. For each hunk, resolve it when both sides are compatible. When they are not, ask one question through the agent's native Q&A when it has one.
3. Build after resolving. Report the files resolved and the questions asked. Never complete the merge with a failing build.
