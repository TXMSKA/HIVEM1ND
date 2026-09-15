---
name: absorb
description: Stores a piece of feedback as a preference, for the current project or globally, with the date and the reason.
---

# /absorb

Mind: {{mind}}
Argument: <text>

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Decide the scope. Inside a project and about that project: `projects/<project>/preferences.md`. Otherwise global. When it is not clear, ask in one line with the two options.
2. Append one line with the date, the preference and the reason. Ask for the reason when the text does not give one.
3. In a team repo, a practice for the team is not absorbed here: it becomes a task file proposing it, for a person to approve.
