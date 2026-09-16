---
name: catchup
description: Summarizes changes, authors, open work and unread messages since the unit's recorded state without changing files.
category: continuity
---

# /catchup

Mind: {{mind}}
Argument: none

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Read the unit's state file and its date, the log entries since that date, `git log` since the recorded commit, the open tasks and the unread messages.
2. Summarize in a few lines: what changed, who did it, what is open. No changes to any file.
