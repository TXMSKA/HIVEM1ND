---
name: protocol
description: Runs a named protocol step by step, creates one from a name or plain words, or lists the existing ones.
---

# /protocol

Mind: {{mind}}
Argument: [protocol-name]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. No name in the argument, and no plain-words request for a new protocol: list every file in `user/protocols/` with its `name` and `purpose` frontmatter fields, one line each, and stop. No files there: say so and stop.
2. A name is given and `user/protocols/<name>.md` exists: run it.
   - Read the frontmatter and the steps in order.
   - For each step, perform its Task within its Time, then report the actual outcome against its Result.
   - Stop at the first step whose Result is not met: report the mismatch and wait for the user. Never continue past it.
   - When every step meets its Result, apply the protocol's repeat rule (run once, run the remaining count, wait for the next interval, or check the until condition) and stop at any of its stop conditions.
   - At the end, report exactly what the protocol's `report` line asks for.
3. A name is given and no file exists, or the user asks in plain words for a new protocol: create one.
   - Ask only for what is missing: purpose, trigger, inputs and paths, repeat rule, stop conditions, what to report, and each step's Task, Time and Result.
   - Write `user/protocols/<name>.md` in kebab-case with the frontmatter and the numbered steps.
   - Show the written file and wait for confirmation; a protocol is never run the same turn it is created.
