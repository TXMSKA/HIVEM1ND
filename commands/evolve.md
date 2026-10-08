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
   - Otherwise, when `{{mind}}/user/VERSION` carries a prerelease tag (a hyphen, as in `2.0.0-experimental.3`), never run the published package, which does not follow a prerelease line. Use a local clone of the kit repository on the branch named by the tag (`experimental` for `2.0.0-experimental.3`): the clone is the repository whose `package.json` is named `hivem1nd`, and the Paths in `{{mind}}/user/machines/<host>.md` are the first place to look. Fast-forward it with `git -C "<clone>" pull --ff-only`, without switching its branch, then run `node "<clone>/cli/index.mjs" evolve --json --mind-path "{{mind}}" --kit-path "<clone>"`. When the machine has no such clone (a clone on another branch does not count), stop and report that one is needed: a local clone of the kit repository on the branch named by the tag.
   - Otherwise run `npx hivem1nd evolve --json --mind-path "{{mind}}"`, so the newly fetched package is the base.
2. Explain the reported version, migrations, base files, files written per agent and warnings. Roles, commands and features that live in the mind install alongside the ones the kit ships, and a name the kit already uses keeps the kit version and reports the one it skipped. A run that stops on conflicts exits with code 1, reports `completed` as false and lists each conflict with its allowed `choices`. Ask for each conflict whether to keep or replace it (for a link, whether to replace it or omit it), then rerun the same command with one `--conflict "<path>=<choice>"` per conflict.
