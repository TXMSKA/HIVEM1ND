---
name: catchup
description: Summarizes changes, authors, open work and unread messages since the unit's recorded state without changing files.
category: continuity
---

# /catchup

Mind: {{mind}}
Argument: none

Start: Locate in `rules.md` of the mind above, skipping its step that asks for a unit. The unit is the session's own; a session with none takes the newest state file of the project as its reference.

## Steps

1. Read the reference state file: its `date`, its `commit` and the repos it names.
2. Read the log entries dated after it, `git log <commit>..HEAD` in each repo, and the tasks of the project in `open` and `review`. A commit the repo does not hold is reported as not run, with the reason.
3. List the unread messages as metadata only, with `list_inbox` or `relay inbox`. Reading them with `read_inbox` or `relay read` archives them, so this command never does.
4. Write nothing.

## End

- Stops after the summary.
- Reports in a few lines: what changed, who did it, what is open or waits for review, and the unread messages by sender and subject.
