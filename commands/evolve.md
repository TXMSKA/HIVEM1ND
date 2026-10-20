---
name: evolve
description: Updates the mind base, applies private migrations in order and reinstalls the included commands for this machine.
---

# /evolve

Mind: {{mind}}
Argument: none

## Steps

1. Pick the base. Every run of this command passes `--json`.
   - When `{{mind}}` is a Git checkout, run `npx hivem1nd evolve --json --mind-path "{{mind}}" --kit-path "{{mind}}"`.
   - Otherwise run `npx hivem1nd evolve --json --mind-path "{{mind}}"`, so the newly fetched package is the base.
2. Explain the reported version, migrations, base files, files written per agent and warnings, and report the Relay lines, one per client: configured now (that client needs a restart), already configured or not available. Roles, commands and features that live in the mind install alongside the ones the kit ships, and a name the kit already uses keeps the kit version and reports the one it skipped.
3. A run that stops on conflicts exits with code 1, reports `completed` as false and lists each conflict with its allowed `choices`. Ask for each conflict whether to keep or replace it (for a link, whether to replace it or omit it), then rerun the same command with one `--conflict "<path>=<choice>"` per conflict. The command stops when a run reports `completed` as true, or when the person declines a choice, which is reported as not run.
