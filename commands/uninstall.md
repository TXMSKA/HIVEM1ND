---
name: uninstall
description: Removes what HIVEM1ND wrote on this machine, commands, skills and the auto rule line for each attached agent, and reports what was kept and why.
---

# /uninstall

Mind: {{mind}}
Argument: none

## Steps

1. Run `npx hivem1nd uninstall --dry-run --mind-path "{{mind}}"` and show the plan: what would be removed, what would be kept and why, and any warnings.
2. Ask for a yes before running `npx hivem1nd uninstall --mind-path "{{mind}}"`, without `--dry-run`. Report what was removed and what was kept.
3. Ask separately whether to also delete the mind folder. On a yes, rerun with `--remove-mind` and report the result; when it is kept, explain the reason it gave.
