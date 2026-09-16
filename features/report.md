---
name: report
description: Investigates a defect or request and writes an evidence-backed task for the project executor without changing code.
category: planning
---

# /report

Mind: {{mind}}
Argument: <text>

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Read the text as a defect or a request. Search the repo for the symbols it names, with several variants, and open the files found.
2. Find the root cause and cite it as file and line. When the cause is not in the code, say where it is.
3. Write a task file: `status: open`, `from` the current unit, `to` the project's executor, the Request with the cause, the exact files to change, what not to touch and what done looks like.
4. Report the task id. No code changes.
