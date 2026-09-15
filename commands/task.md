---
name: task
description: Creates a task file with the next id for a unit and leaves it a message that the task is ready.
---

# /task

Mind: {{mind}}
Argument: <unit> <text>

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Resolve the project from the unit name and its `tasks/` folder.
2. Take the highest id present plus one, three digits, and a slug from the first words of the text.
3. Write the task file with `status: open`, `from` the current unit, `to` the target, the date, and the text as the Request section. `depends` and `design` are added when the text or the brief provide them.
4. Write a message to `inbox/<unit>/` saying the task is ready. The message waits if the unit is not in.
