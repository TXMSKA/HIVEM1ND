---
name: evolve
description: Updates the mind base, applies private migrations in order and reinstalls the included commands for this machine.
---

# /evolve

Mind: {{mind}}
Argument: none

## Steps

1. When `{{mind}}` is a Git checkout, run `npx hivem1nd evolve --mind-path "{{mind}}" --kit-path "{{mind}}"`. Otherwise run `npx hivem1nd evolve --mind-path "{{mind}}"`, so the newly fetched package is the base.
2. Explain the reported version, migrations, base files, files written per agent and warnings. Roles, commands and features that live in the mind install alongside the ones the kit ships, and a name the kit already uses keeps the kit version and reports the one it skipped. For each conflict, ask whether to keep or replace it, then rerun with those choices.
