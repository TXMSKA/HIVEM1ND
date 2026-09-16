---
name: release
description: Prepares a local release from commits since the last tag and reports the commands needed to publish it.
category: continuity
---

# /release

Mind: {{mind}}
Argument: none

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Read the commits since the last tag on the current branch.
2. Write the changelog entry from them, bump the version in the project's version file, and create the tag locally.
3. Report the commands the user runs to push the branch and the tag. Never push.
