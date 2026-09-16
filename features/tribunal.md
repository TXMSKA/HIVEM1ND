---
name: tribunal
description: Convenes three judges, cross-examines their findings and records an evidence-backed verdict without editing code.
category: quality
---

# /tribunal

Mind: {{mind}}
Argument: [task or range]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Build the case file: the original request, the diff or the delivered files, the brief, the design document when the brief names one, and every claim the executor made.
2. Start three judges in parallel, each with the full case file: a technical judge, an interface judge that returns N/A in one line when there is no interface, and a demanding product owner.
3. Cross-examination: each challenge from the product owner goes to the judge it concerns, to be answered with evidence, file and line, build output or the behaviour where it runs. A challenge without a verifiable answer lowers that dimension to OBSERVED.
4. Write the verdict: three rows, technical, interface, organizational, each APPROVED, OBSERVED or REJECTED, the blocking findings with file and line, and the list of fixes. Write it as a task file for the executor when there are fixes, and as a log entry otherwise. Never edit code.
