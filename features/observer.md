---
name: observer
description: Tests a project under adverse conditions and writes reproducible weakness reports as open tasks.
category: quality
---

# /observer

Mind: {{mind}}
Argument: [conditions]

Start: Locate in `rules.md` of the mind above.

## Steps

1. Read the brief and the stack. Pick the conditions that apply: slow connection, lost signal, weak device, low storage, large data sets, concurrent users, malformed input, and any the person adds.
2. For each condition, simulate it where the tooling allows (network throttling, device emulation, offline mode) and reason from the code where it does not; a finding reasoned from the code says so. Every finding cites evidence: a reproduction with its output, or file and line.
3. Create one task per weakness with `/task` for the project's executor, holding what was observed, where, and the steps to reproduce it. Together they are the QA plan, which `/qa` runs when the person wants.
4. A condition that could not be tested is recorded as not run, with the reason.

## End

- Stops when every picked condition has a result.
- Reports per condition: pass, fail with its task id, not applicable, or not run with the reason.
