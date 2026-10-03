---
name: relay
description: Starts and ends a role's session. On entry it fetches, aligns the repos with the recorded branches and reads the state and the inbox; on exit it commits and pushes everything, writes the state and the log, and clears the conversation.
---

# /relay

Mind: {{mind}}
Argument: [in|out] [context]

## Start

Locate the mind through the Mind line above. Before anything else, run `node "{{mind}}/cli/index.mjs" check --mind-path "{{mind}}" --json` from the working directory. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. The current project is the `project` of the check, which resolves the working directory against those paths. Resolve the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

The scope of the unit is the set of repos the relay keeps in sync: the current repo for a role that works in one folder, and every repo of the environment for the Overlord. A role that works without a repo skips the git work of both steps and only compares and reports.

## Steps

1. Resolve the unit: role plus project, with a number appended when that unit is already `in`. Locate `state/<unit>.md` in the project, the environment or the root of `user/`, and the presence file in the team state when the repo has one.
2. No state file: first start. Write it with `state: in`, machine, branch, commit, tree and date, and stop here.
3. State `out`, or `in` given: entry. Read the context, then every file in `inbox/<unit>/`. In every repo of the scope, run `git fetch --all --prune`, then bring the repo to the branch the state records for it, switching to it when needed, and fast-forward that branch to its upstream. A repo with uncommitted changes, a recorded branch that no longer exists, or a branch that cannot fast-forward is left untouched: the step stops there and asks, naming what it found. Free text is the user's intent and is kept with the context. Write `state: in` with the fresh values, write presence and claims in a team repo, and report one block per fact, a blank line between blocks, each block led by a contextual icon and never an emotional one: the findings of the check other than its message and task counts, and what the alignment changed, one block each, then the unit with a state icon, the messages with a mail icon and the next step with an arrow, plus a blocked line with a warning icon only when something blocks. When the context leaves work half done, the next block asks for the yes to continue it.
4. State `in`, or `out` given: exit. Running the exit is the user's yes for the commits and pushes it makes. In every repo of the scope with uncommitted changes, commit them on the current branch, or on a new branch named after the work when the current branch is the default branch, with a message that follows the repo's rules and its AI presence setting, then push every branch that is ahead of its remote or has none. A repo with no remote keeps its commits local and the report says so. Write the state file with `state: out`, the fresh git values and a context written for a session that starts on another machine with nothing else: done, half done with the exact point where it stopped, the next step, decisions not to re-ask, free text if given, ten lines at most. Append the log entry. Release the claims and set the presence to `out`. Delete the messages read during the session. Last, clear the conversation where the agent can clear it itself; otherwise the report ends asking the user to clear it.
