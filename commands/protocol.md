---
name: protocol
description: Runs a named protocol step by step, creates one from a name or plain words, or lists the existing ones.
---

# /protocol

Mind: {{mind}}
Argument: [protocol-name]

## Start

Locate the mind and the unit as the Locate section of `{{mind}}/rules.md` says; the formats of the records are in `{{mind}}/files.md`, and the steps name the files without repeating the formats.

## Steps

1. No name in the argument, and no plain-words request for a new protocol: list every protocol in `user/protocols/`, in `user/projects/<project>/protocols/` of the current project, and in the `protocols/` folder of every installed knowledge module, in `knowledge/` and `user/knowledge/` of the mind, with its `name` and `purpose` fields, one line each, and stop. No files there: say so and stop.
2. A name is given and a protocol with that name exists in any of those folders: run it. When the same name exists in more than one, the local one of the current project wins over the global one, and the global one over a module's.
   - Read the frontmatter and the steps in order.
   - For each step, perform its Task within its Time, then report the actual outcome against its Result with one verdict of the Verdicts table of `{{mind}}/files.md`.
   - A fail ends its step: record the expected and the observed Result, and go on with the next step unless the protocol's `stop` line says otherwise; a run that a `stop` line ended resumes at that step after the fix.
   - A step that is not applicable, not run or not verifiable is recorded with its reason and the run goes on; not run and not verifiable never count as a pass.
   - Report every fail at the end of the run, and wait for the person before acting on any of them.
   - When every step is pass or not applicable, apply the protocol's repeat rule (run once, run the remaining count, wait for the next interval, or check the until condition) and stop at any of its stop conditions; otherwise the run ends without a pass and reports the steps that kept it from one.
   - At the end, report exactly what the protocol's `report` line asks for.
3. A name is given and no file exists, or the user asks in plain words for a new protocol: create one.
   - Ask only for what is missing: purpose, trigger, inputs and paths, repeat rule, stop conditions, what to report, and each step's Task, Time and Result.
   - Ask whether it is global, for every project, or local to the current project, unless the request already says so.
   - Write it in kebab-case with the frontmatter and the numbered steps, in `user/protocols/<name>.md` when global or in `user/projects/<project>/protocols/<name>.md` when local.
   - Show the written file and wait for confirmation; a protocol is never run the same turn it is created.
