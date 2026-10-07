---
name: cleaner
description: Measures how bloated the mind is, proposes every cleanup in one list for a single yes, applies it and verifies that nothing was lost.
category: continuity
---

# /cleaner

Mind: {{mind}}
Argument: none

## Start

Locate the mind through the Mind line above. Run `node "{{mind}}/cli/index.mjs" check --mind-path "{{mind}}" --json` from the working directory: the `mind` field holds what crossed a threshold, the sizes behind it and the thresholds themselves. The startup check offers this command with one line when any threshold is crossed. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Measure, without writing anything. The check lists preferences over 20 KB, a brief over 15 KB, states `in` older than 3 days or left by another machine that has relayed out since, more than 500 MB of files that are not records, a machine file over 15 KB and more than 1000 Relay history files. Measure the rest by hand, per mind. Global and project preferences: size, lines, duplicate or contradicting lines, orders tied to the moment (which tool, model, effort or quota to use), and lines that belong to the conversation guide when the mind has one. Briefs: size, and Facts superseded by a newer line. Read messages still in `inbox/` that Relay already archived, and the growth of the Relay archive and events. Evidence and binary folders, found from `mind.sizes.files`. Machine files whose `## Managed Files` section is large. In each repo of the machine's `Paths`: merged branches, stale worktrees and untracked leftovers.
2. Propose. One list, grouped by what it touches, one short line per change with its size effect, such as `myapp brief: 3 Facts superseded, 46 KB to 31 KB`. A consolidated preference or brief shows its new text in full under its line. A new line follows `/absorb`: only standing rules are kept, an order tied to the moment is dropped, and a line replaces the one it contradicts. Evidence asks for the destination folder in the same list. Ask once for one yes, and let the user strike lines. Nothing is applied without it, and every branch, worktree or file to delete is named in the list and needs that yes explicitly.
3. Apply what was approved, in this order. Write one log entry first (`log/<YYYYMMDD-HHMM>-cleaner.md` at the root of `user/`), holding the full replaced text of every file about to change, then rewrite preferences and briefs in place: duplicates merged, superseded and moment-bound lines dropped, conversation-guide lines moved to the guide, the `date: text. Why: reason` and Facts formats kept. Mark each stale state `out` with one appended line saying why. Delete read inbox messages the Relay archive already holds, and Relay history older than the cut-off the list named. Move large evidence out of the mind: copy it to the folder the user named, compare file count and bytes, remove the original, record the folder as `evidence:` in the `Paths` section of this machine file and leave the relative path in the brief. Move the `## Managed Files` section of this machine file to `machines/<host>.managed.json`, the same path-to-hash map, and remove the section; the file of another machine is left for that machine, its only writer. Delete merged branches with `git branch -d`, remove stale worktrees with `git worktree remove` and clean listed leftovers, never with force, never the current or default branch, never pushing.
4. Verify. Run the check again and report the sizes before and after in one line. Confirm nothing was lost: the log entry holds every replaced text, each moved folder matches its original, each deleted branch was merged. A failed confirmation is reported with what failed, and the pass stops there.
