---
name: uninstall
description: Removes what HIVEM1ND wrote on this machine, commands, skills, the auto rule line and the Relay entry for each attached agent, and reports what was kept and why.
---

# /uninstall

Mind: {{mind}}
Argument: none

## Steps

1. Run `npx hivem1nd uninstall --dry-run --mind-path "{{mind}}"` and show the plan: what would be removed, what would be kept and why, one Relay line per client and any warnings.
2. Ask for a yes before running `npx hivem1nd uninstall --mind-path "{{mind}}"`, without `--dry-run`. Report what was removed and what was kept. The Relay entry of a client goes only when it runs the CLI copy inside this mind; an entry that runs another kit, and everything else in that client's config, stays.
3. Ask separately whether to also delete the mind folder. On a yes, rerun with `--remove-mind` and report the result; when it is kept, explain the reason it gave.
