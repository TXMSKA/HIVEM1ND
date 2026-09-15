---
name: msg
description: Writes a message into a unit's inbox and, when its agent has a CLI and the unit is in, tells it to read the inbox.
---

# /msg

Mind: {{mind}}
Argument: <unit> <text>

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Resolve the recipient's inbox folder from the unit name: project, environment or root.
2. Write the message file with `from`, `to`, `date`, `subject` (the first line of the text) and the body.
3. If the recipient's agent has a CLI installed on this machine and the unit is `in`, run it once with the instruction to read its inbox. Otherwise nothing else: the file waits.
