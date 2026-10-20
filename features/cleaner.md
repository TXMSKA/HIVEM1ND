---
name: cleaner
description: Measures how bloated the mind is, proposes every cleanup in one list for a single yes, applies it and verifies that nothing was lost.
category: continuity
---

# /cleaner

Mind: {{mind}}
Argument: none

Start: Locate in `rules.md` of the mind above; no unit is needed, so its step that asks for one is skipped. The startup check offers this command in one line when a threshold is crossed.

## Steps

1. Measure, writing nothing. Run `node "{{mind}}/cli/index.mjs" check --mind-path "{{mind}}" --json` from the working directory: its `mind` field holds what crossed a threshold, the sizes behind it and the thresholds. The check covers preferences over 20 KB, a brief over 15 KB, a product document over 20 KB, states `in` older than 3 days or left by another machine that has relayed out since, more than 500 MB of files that are not records, a machine file over 15 KB and more than 1000 Relay history files. Measure the rest by hand:
   - Global and project preferences: size, lines, duplicate or contradicting lines, orders tied to the moment (which tool, model, effort or quota to use), and lines that belong to the conversation guide when the mind has one.
   - Briefs: size, Facts superseded by a newer line, and Facts with a `product:` pointer whose text the product document already holds.
   - Product documents: size, `mind.product.stale` and `mind.product.missing`.
   - Relay: inbox files whose twin in `user/relay/archive/<to>/` holds the same bytes, and the size of `user/relay/archive/` and `user/relay/events/`.
   - Evidence and binary folders, from `mind.sizes.files`, and machine files whose `## Managed Files` section is large.
   - In each repo of the machine's `Paths`: merged branches, stale worktrees and untracked leftovers.
2. Propose one list, grouped by what it touches, one short line per change with its size effect, such as `myapp brief: 3 Facts superseded, 46 KB to 31 KB`.
   - A Fact the product document already holds is proposed as one line with its pointer.
   - A product document over its size or behind its brief, and a project with a brief and no product document, are listed for the writer of the product document (the seat, or the coordinator for a family or a project with no seat), with no edit proposed.
   - A consolidated preference or brief shows its new text in full under its line. A new line follows `/absorb`: only standing rules are kept, an order tied to the moment is dropped, and a line replaces the one it contradicts.
   - Evidence asks for its destination folder in the same list.
   - The Relay archive is listed with its size and kept: read messages stay in it, and nothing deletes them. Events past a cut-off the list names may go.
   - Every branch, worktree or file to delete is named.
3. Ask once for one yes, and let the person strike lines. Nothing is applied without it; a struck line is skipped.
4. Apply what was approved, in this order:
   - Write one log entry first, `log/<YYYYMMDD-HHMM>-cleaner.md` at the root of `user/`, holding the full replaced text of every file about to change.
   - Rewrite preferences and briefs in place: duplicates merged, superseded and moment-bound lines dropped, Facts the product document holds shrunk to one line with their pointer, conversation-guide lines moved to the guide, the `date: text. Why: reason` and Facts formats kept.
   - Mark each stale state `out` with one appended line saying why.
   - Delete the inbox files whose archive twin holds the same bytes, and the Relay events older than the cut-off. A twin with different bytes is unread and stays.
   - Move large evidence out of the mind: copy it to the folder the person named, compare file count and bytes, remove the original, record the folder as `evidence:` in the `Paths` section of this machine file and leave the relative path in the brief.
   - Move the `## Managed Files` section of this machine file to `machines/<host>.managed.json`, the same path-to-hash map, and remove the section. Another machine's file is left to that machine.
   - Delete merged branches with `git branch -d`, remove stale worktrees with `git worktree remove` and clean the listed leftovers: never forced, never the current or the default branch, never pushed.
5. Verify. Run the check again. Confirm that nothing was lost: the log entry holds every replaced text, each moved folder matches its original, each deleted branch was merged. A failed confirmation stops the pass.

## End

- Stops after the verification, at a failed confirmation, or without the yes.
- Reports the sizes before and after in one line, what was applied, what was struck, and any failed confirmation with what failed.
