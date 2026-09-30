---
name: relay
description: Starts and ends a role's session. On entry it reads the state and the inbox; on exit it writes the state and the log.
---

# /relay

Mind: {{mind}}
Argument: [in|out] [context]

## Start

Locate the mind through the Mind line above. Before anything else, run `node "{{mind}}/cli/index.mjs" check --mind-path "{{mind}}" --json` from the working directory. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. The current project is the `project` of the check, which resolves the working directory against those paths. Resolve the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Resolve the unit: role plus project, with a number appended when that unit is already `in`. Locate `state/<unit>.md` in the project, the environment or the root of `user/`, and the presence file in the team state when the repo has one.
2. No state file: first start. Write it with `state: in`, machine, branch, commit, tree and date, and stop here.
3. State `out`, or `in` given: entry. Read the context, then every file in `inbox/<unit>/`. Compare with the repo: hostname against `machine`, `git rev-parse HEAD` against `commit`, `git status --porcelain` against `tree`, the current branch against `branch`. Same machine and same tree means continue. Recorded commit is an ancestor of HEAD means new commits or a pull, say so and continue. Different branch, or a commit not in the history, means stop and report; never pull, never switch. Free text is the user's intent and is kept with the context. Write `state: in` with the fresh values, write presence and claims in a team repo, and report one block per fact, a blank line between blocks, each block led by a contextual icon and never an emotional one: the findings of the check other than its message and task counts, and of this comparison, one block each, then the unit with a state icon, the messages with a mail icon and the next step with an arrow, plus a blocked line with a warning icon only when something blocks.
4. State `in`, or `out` given: exit. Write the state file with `state: out`, the fresh git values and the context (done, half done, next step, decisions not to re-ask, free text if given, ten lines at most). Append the log entry. Release the claims and set the presence to `out`. Delete the messages read during the session.
