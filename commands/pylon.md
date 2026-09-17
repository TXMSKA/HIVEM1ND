---
name: pylon
description: Adds shared team state to a repository without switching or changing its code branch.
---

# /pylon

Mind: {{mind}}
Argument: <repo>

## Steps

1. Ask where the team state goes (`branch`, the default, or `main`), whether AI trailers are allowed in commits (no by default), and whether shared AI files are allowed (yes by default).
2. Run `npx hivem1nd pylon "<repo>" --mind-path "{{mind}}"` with the selected state and AI presence flags.
3. Explain the created state, registration, branch push, warnings and conflicts. Never switch or commit the code branch.
