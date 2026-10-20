---
name: docs
description: Updates only the documentation affected by the current diff or a supplied commit range.
category: continuity
---

# /docs

Mind: {{mind}}
Argument: [range]

Start: Locate in `rules.md` of the mind above; no unit is needed, so its step that asks for one is skipped.

## Steps

1. Take the diff of the current branch against the branch it was cut from (`git diff <base>...HEAD`, the default branch when unsure), or the range the person gives.
2. Search the documentation for each file, symbol, command and option the diff changed, with several spellings; `git grep -n -i -e <name>` runs the same in a POSIX shell and in PowerShell. Open each document found. An empty search counts only with its scope recorded and a positive control: the same search first finds a name known to be documented.
3. Update the affected documents on the same branch. A document the diff does not affect is not touched. Nothing is committed.
4. Verify: each changed statement matches the code it describes, at file and line; each link and path in the changed text resolves; the repository's documentation lint passes when it has one. A fail is fixed before the end, or reported.

## End

- Stops after the verification.
- Reports each document updated with what changed, the lint as pass, fail or not run with the reason, and any statement left not verifiable.
