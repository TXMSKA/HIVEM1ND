---
name: plan
description: Splits a request into ordered task files for the owning units and sends each unit a message without implementing it.
category: planning
---

# /plan

Mind: {{mind}}
Argument: <text>

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Read the routes and the briefs of the projects the request touches.
2. Split the request into task files, one per piece that can fail on its own, with `depends` set in dependency order and `to` set to the unit that owns each piece.
3. Write them and notify each unit by message. No implementation.
