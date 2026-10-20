---
name: qa
description: Runs every open project task in non-overlapping groups, verifies the results and records what passed or failed.
category: quality
---

# /qa

Mind: {{mind}}
Argument: none

Start: Locate in `rules.md` of the mind above.

## Steps

1. List the tasks of the project in `open` whose `to` is this unit, or a member of its squad when this unit is their lead. A task whose `depends` names a task that is not `done` or `closed` is not run, and is reported with that reason.
2. Group the rest so that no two groups share a file, using the files named in each Request. Two tasks that share a file go to the same group, in id order.
3. Start one subagent per group, in one message, as Delegation in `rules.md` says: each in its own worktree from the current branch, with its tasks in full, the brief, `rules.md` and the order to implement on one branch per task. Each takes the row of `user/models.md` that the task's `work` header names, or the `subagent` row for builds from an approved plan.
4. When they return, verify each task first-hand where it runs: lint, build, and the behaviour in the browser, the editor or the console. Each check ends in a verdict of `files.md` (Verdicts); a task passes only when every check is pass or not applicable. A second agent command-line interface verifies the same task only when the person asks for it in that run.
5. Collect the protocols whose `trigger` is `task close` and whose `scope` covers what a verified task built: those its plan lists, those of the installed knowledge modules, `user/protocols/` and `user/projects/<project>/protocols/`. Ask the person once, in one line, naming each protocol with its tasks. A confirmed protocol runs and each Report records its result per step; a declined one is recorded as declined.
6. Append to each task's Report what was verified, with its evidence. A task that passed moves to `review` with `node "{{mind}}/cli/index.mjs" task status <project> <id> review --note "<one line>" --mind-path "{{mind}}"` on a mind whose `user/VERSION` is 3 or later, or by its `status` header on an earlier one. Exit code 3 means the task changed since it was read: read it again and retry once. A task that failed stays `open` with the failure in its Report.
7. When the executor of a task has a `lead`, the approval line is the lead's to write.
8. Remove each worktree with `git worktree remove`, never forced; the task branches stay for review.

## End

- Stops when every listed task is in `review`, is `open` with its failure, or is reported as not run.
- Reports the tasks moved to review, the tasks left open, the tasks not run with their reasons, and the groups run.
- When the tasks cite requirement IDs, it adds, per stage of the product document, the requirements met against the total. A requirement counts as met only when a `done` task cites it and every criterion has linked evidence in that task's Report; a task this run moved to `review` adds none.
