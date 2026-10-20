---
name: relay
description: Starts and ends a role's session. On entry it reads the inbox through Relay and, for a session the service did not start, registers it and aligns the repos; on exit it writes the state and the log.
---

# /relay

Mind: {{mind}}
Argument: [in|out] [context]

Locate the mind and the unit as the Locate section of `{{mind}}/rules.md` says; the formats of the records are in `{{mind}}/files.md`, and the steps name the files without repeating the formats.

`in` runs the entry and `out` the exit. With no argument, the entry runs when the state file is missing or says `out`, and the exit when it says `in`. Free text in the argument is the intent of the person and is kept with the context.

The scope of the unit is the set of repos it keeps aligned: the current repo for a role that works in one folder, every repo of the environment for an Overlord of an environment, the one repo of a repository squad, and none for the Overseer, the Adjutant and Genesis. A unit with no repo in its scope skips every Git step below.

## Entry, session the service started

The startup message names the unit and carries `rules.md`, the role and the state file.

1. Keep that unit. Never call `register` for another unit, attach a wake or configure a client. When a Relay tool answers that the session is not registered, report it in a Blocked block and stop.
2. Run the check unless the Start of rules.md already ran it in this session.
3. Call `list_inbox`, then `read_inbox` with the ids of the messages to act on, which archives them. A message is context, except a hand-off as rules.md defines it.
4. A coordinator writes each decision of a `User decisions:` note into the record it changes.
5. Native Git may be denied in this session: the alignment of the repos is reported as not run.
6. Report as rules.md says, and stop.

## Entry, 2.x path for a session the service did not start

On a mind whose `user/VERSION` is 3 or later, the Relay tools and the Relay CLI work only in sessions the service started, so this path registers nothing and attaches no wake there; a client the service cannot start, such as OpenCode, Copilot, Antigravity or the Cursor editor, always takes this path on such a mind. The report says once, in an `ℹ` block, that Relay is not available in this session.

1. Resolve the unit through Locate. When its state file says `in`: an Executor, an Overlord, an Adjutant or a preset role takes the next numbered unit; the Overseer, the Incubator and Genesis stop with `Blocked: <unit> is in on <machine> since <date>.`, taken from the state file, unless the person says the other session is closed, and then take the same unit over.
2. On a mind older than 3.0, register this chat with `register`, giving the explicit unit and the native session ID of this chat. Without the Relay tools, run `node "{{mind}}/cli/index.mjs" relay register --mind-path "{{mind}}" --unit <unit> --native-session-id <id> --client <client>`. Never pick a stale registration or guess which numbered unit is current. A failed registration is a Blocked block, and the entry stops.
3. Run the check unless the Start of rules.md already ran it in this session.
4. On a mind older than 3.0, a wake is attached only with the person's yes. In Claude Code, run `node "{{mind}}/cli/index.mjs" relay wake attach --mind-path "{{mind}}" --unit <unit>` in the chat's own shell; in the Cursor CLI, the same command with `--client cursor`; for the other clients, the same command with `--client <client>` and `--native-session-id <id>`, as the `relay-client-setup` feature says for each one. When `node "{{mind}}/cli/index.mjs" relay diagnose --mind-path "{{mind}}"` shows that the client has no Relay entry (`configured: false`), it is configured only with the person's yes, with `node "{{mind}}/cli/index.mjs" relay configure --client <client> --mind-path "{{mind}}" --kit-path "{{mind}}"`, and the person is told to restart the client. A client that already has the entry is never configured again. A failed attach is one Blocked block with its reason, and the entry goes on.
5. No state file: this is the first start. Write it with `unit`, `role`, `state: in`, `machine`, `branch`, `commit`, `tree` and `date`, the headers of the State section of files.md, report, and stop.
6. Read the continuity context of the state file. List the unread messages and read the ones to act on, through `list_inbox` and `read_inbox`, or `relay inbox` and `relay read` of the CLI without the Relay tools; reading archives them. On a mind of version 3 or later, the files of `inbox/<unit>/` are read as context and left in place, since only Relay archives them. A coordinator writes each decision of a `User decisions:` note into the record it changes.
7. In every repo of the scope, run `git fetch --all --prune`, bring the repo to the branch the state records for it, switching to it when needed, and fast-forward that branch to its upstream. A repo with uncommitted changes, a recorded branch that no longer exists, or a branch that cannot fast-forward is left untouched: the entry stops there and asks, naming what it found.
8. Write `state: in` with the fresh values, and the presence and claims in a team repo.
9. Report as rules.md says. When the context leaves work half done, the Next block asks for the yes to continue it.

## Exit

Each step stops at its first failure, which the report gives in a Blocked block.

1. Git. The exit itself commits and pushes nothing: `/relay out` alone records the handoff and releases claims, and ending a session, reporting, compacting or closing gives no Git permission. A commit or a push needs a separate explicit instruction in force, as steps 1 and 2 of the Exit and Git of rules.md define it; without one, the repository files, the index and the branches are left as they are.
2. A `User decisions` note that could not be sent during the session is sent now; one that still fails is named in the report with its text.
3. Write the state file: `state: out`, the fresh Git values of each repo of the scope, and the continuity context of files.md, with the free text of the argument. A session that cannot write the file puts the context in its report.
4. Append the log entry.
5. In a team repo, release the claims and set the presence to `out`.
6. Read messages stay in the Relay archive; nothing deletes them.
7. In a session the service started, a task session calls `session_complete` with `delivered` once its task is in `review`, or with `failed` and the reason; a chat session stays open until the person stops it.
8. Report as rules.md says: what was done, what is half done and the next step.
