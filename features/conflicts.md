---
name: conflicts
description: Resolves compatible merge or rebase conflicts, asks about incompatible hunks and verifies the build before completion.
category: quality
---

# /conflicts

Mind: {{mind}}
Argument: none

Start: Locate in `rules.md` of the mind above; no unit is needed, so its step that asks for one is skipped.

## Steps

1. Confirm that a merge or a rebase is in progress (`git status` names it) and list the conflicted files with `git diff --name-only --diff-filter=U`. With none in progress, stop and say so.
2. For each hunk, resolve it when both sides are compatible, keeping what each side meant. When they are not, ask one question through the client's native question tool when it has one, showing both sides, and resolve it as answered.
3. Stage the resolved files and run the build and the tests: the brief's `build` and the repository's test script. A fail stops here and the merge stays unfinished.
4. Completing the merge or the rebase (`git commit`, `git rebase --continue`) is a commit: it runs only when the person asked for the merge to be completed, and never with main checked out. With main checked out, the work stops after staging.

## End

- Stops when every conflict is resolved and the checks pass, at a failed check, or at an unanswered question.
- Reports the files resolved, each question with its answer, the build and the tests as pass or fail, and whether the merge was completed.
