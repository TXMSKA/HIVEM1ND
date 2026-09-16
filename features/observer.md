---
name: observer
description: Tests a project under adverse conditions and writes reproducible weakness reports as open tasks.
category: quality
---

# /observer

Mind: {{mind}}
Argument: [conditions]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Read the brief and the stack. Pick the conditions that apply: slow connection, lost signal, weak device, low storage, large data sets, concurrent users, malformed input, and any the user adds.
2. For each condition, simulate it where the tooling allows (network throttling, device emulation, offline mode) and reason from the code where it does not. Every finding cites evidence.
3. Write the findings as task files, `status: open`, one per weakness, with what was observed, where and how to reproduce it. Together they are the QA plan; `/qa` runs them when the user wants.
4. The run may add a light remark to a finding, such as "Whoops! I really don't know how I managed to catch that", never in place of the evidence.
