---
name: qa
description: Runs every open project task in non-overlapping groups, verifies the results and records what passed or failed.
category: quality
---

# /qa

Mind: {{mind}}
Argument: none

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. List the tasks with `status: open` in the project.
2. Group them so that no two groups share a file, using the files named in each Request. Two tasks that share a file go to the same group.
3. Start one subagent per group, in one message, each with its tasks in full, the brief, the rules file and the order to implement on one branch per task.
4. When they return, verify each task first-hand where it runs: lint, build, and the behaviour in the browser, the editor or the console. Set `status: done` on each verified task and append what was verified to its Report. A task that fails stays `open` with the failure in its Report.
5. Report numbers: tasks done, tasks left open, groups run.
