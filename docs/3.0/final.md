# HIVEM1ND 3.0.0: final build plan

Date: 2026-10-13. Owner: the Overmind. Status: general plan; the detailed integration plan is written from it by Codex (section 5).

The Blueprint board `hivem1nd-3-flow` ("HIVEM1ND 3.0", `docs/flows/boards/hivem1nd-3-flow.mjs`, 83 screens) is the source of truth for the product requirements of 3.0: what a person sees and does, every state and every text. A screen is named by its reference, row and place: `2.4` is the fourth screen of row 2. Rows: 1 setup and first run, 2 the Map, 3 chats and what waits on the person, 4 Blueprint, 5 Void, 6 settings and the service, 7 the phone. Each screen's `note` states its behavior. Where this plan, `contract.md`, `plan-core.md` or `plan-gui.md` disagree with the board, the board wins for what a person sees and does; the contract wins for wire formats, and a wire format the board needs and the contract lacks is added to the contract first.

## 1. Sources

- The board and its resolved comment threads (`docs/flows/comments/hivem1nd-3-flow.json`).
- `docs/3.0/contract.md`, `plan-core.md` and `plan-gui.md`: still valid except where section 2 amends them.
- The candidate code: worktree `HIVEM1ND-3-qa`, branch `qa/3.0-046` at `b78b9c5` (the task 046 repair tree, committed on 2026-10-13). The `fix/3.0-046-*` branches are ancestors of it.
- The survey of the candidate against the board (section 3) and an audit of the board for frictions and errors (Sonnet 5.5, 2026-10-13), whose findings the board now answers.

## 2. Decisions

1. One board. The other 3.0 boards are in `docs/flows/archive/`; nothing is built from them.
2. Visible text says "M1ND" wherever it said "mind" (English) or "mente" (Spanish). Code identifiers, file names, CLI commands and flags keep `mind`.
3. Setup has four steps: Install (1.1), Where the M1ND lives (1.2), Starting the Relay service (1.5, no Back), Ready (1.7). There is no sync choice: the folder is the sync, since a folder inside a cloud storage service syncs through it. Relay+ is announced as coming soon (1.2, 6.1). Agents, projects, content and preferences are detected with defaults during setup and changed in Settings.
4. The default M1ND folder is `.m1nd` under the common Cosmic root: `%LOCALAPPDATA%\Cosmic\.m1nd` on Windows, `~/.local/share/Cosmic/.m1nd` on Linux. One constant holds the root.
5. A folder that already holds a 3.0 M1ND is joined, never replaced (1.3): the second machine's path.
6. A 2.x M1ND found on the machine is offered by Migrate legacy M1ND, ticked by default (1.2). Its running 2.x sessions are closed first (1.4), then it is copied and upgraded; the original is never written.
7. Start with Windows is optional and off by default (6.1). Setup registers nothing at logon; the service runs while HIVEM1ND needs it and idles at no cost.
8. A failure always says why and what did not change, with a way out: a failed setup step resumes on reopen (1.6), an unreadable M1ND stops at 30 s (1.9), a failed save keeps the text (5.5).
9. A group of the person's own is one entity in three places: a folder under My groups in Hierarchy, a zone on the Map and one group chat (2.7 to 2.9). It never changes who reports to whom. Deleting it archives its chat (2.10).
10. Renaming a unit sets an alias (F2 or the More menu, 2.3); the id never changes and is shown beside it. A double click in Hierarchy centers the unit on the Map.
11. Units run in an agent's command line: HIVEM1ND opens a session per task and closes it. An Executor runs one task and closes by default; as a chat it stays open and may open other CLIs, each with the person's approval (2.14, 3.4). A unit can also run by hand in an agent's app with its command, as in 2.x; it keeps its place in the hierarchy and shows on the Map. The inspector says where each unit runs. There are no builder units.
12. Agents (6.2): each agent's command line first (Auto or On demand loading), its desktop app optional. Every change to an agent's configuration is listed before it is written (6.3), with Apply or Copy changes, a kept copy and Disconnect. Git commit and push is a separate, unticked, scoped permission. Permissions (6.5) lists standing approvals ("Always for this unit") and agent permissions, each with Revoke.
13. Settings has tabs General, Agents, Permissions, Projects and Content, and a machine selector (6.4): Agents, Permissions, Projects and Locations are per machine; an offline machine shows its last report, read only.
14. Looks: Modern (default), Nocturne (the former High contrast), Nebula, Waves (TXMSKA), Toxic (Coffee Cat Studios) and Kinetic (NTK), each previewed in its own palette (6.1). Contrast floors are met with fills and the theme's quiet line hue, never with bright or white borders.
15. Blueprint and Void share one library: search, filters, folders, New item, New folder, and per item Rename, Duplicate, Move to folder, Delete. A board belongs to a project and its repository (4.3); moving it to another project's folder says the file changes repository (4.5).
16. Deleting a board, a text, a folder, a group, a unit or a repository asks first, names what goes and what stays, and offers Undo (4.6, 5.3, 2.10, 2.18, 6.7). Removing a repository never touches its files.
17. The comment composer of Blueprint and Void has Send to agent: on by default, kept at the value left, disabled with no agent attached.
18. Blueprint boards are edited in place with the agents' tools (select, frame, text, draw, comment) and hand sketches live on the same board (4.7, 4.8). Every change is kept in History with Restore (4.14); a conflict's answers both keep a copy.
19. Void edits in place: format bar over a selection, continuous saving, Find and replace with one undo, Markdown source view (5.4 to 5.7).
20. A send waits 10 s and a request 30 s; without an answer the line says Not confirmed and Retry sends the same message once, never twice (3.6, 6.12). An agent at work can be stopped (3.3).
21. The phone answers asks with Approve and Deny only; standing approvals and pushes are answered on the computer (7.5, 7.6). Five wrong codes lock pairing for 10 minutes (7.3). Settings shows while phone access is open (6.1).
22. Accessibility: status is told by shape as well as colour (filled, thick ring, thin ring), interactive targets are 32 px or more, icon-only controls carry names, and muted text meets 4.5:1 on every look.

## 3. Where the candidate stands

DONE means present and matching the board; PARTIAL means short of it; MISSING means absent. References are to the candidate worktree.

| Board | Feature | State |
| --- | --- | --- |
| 1.1 to 1.7 | Four-step setup, no Back while installing | MISSING: eight steps (`engine/texts.mjs`), Back on install (`gui/app.js`) |
| 1.2 | Migrate legacy M1ND by copy | MISSING: attaches in place (`engine/setup.mjs`), moves files (`migrations/3.0.0.mjs`) |
| 1.3, 1.4 | Join an existing M1ND, close 2.x sessions | MISSING |
| 1.6, 1.9 | Failed step with resume, unreadable M1ND | MISSING |
| 1.2, 6.1 | Default folder `.m1nd` | PARTIAL: `%LOCALAPPDATA%\Cosmic\hivem1nd` |
| 6.1 | Start with Windows off by default | MISSING: logon task always registered (`engine/setup.mjs`, `engine/service/install.mjs`) |
| all | "M1ND" in visible text | MISSING: about 37 strings, mostly `engine/texts.mjs` |
| 1.8, 1.10 | Loading skeleton, empty M1ND | MISSING |
| 2.x | Map, connect, select, new unit, sessions, inspector | DONE |
| 2.7 to 2.10 | My groups | MISSING: zones only from overlord, project or environment |
| 2.3, 2.4 | Alias | MISSING: no unit update route |
| 2.14, 3.4 | Runs as one task or chat, approval to open a CLI | MISSING |
| 2.18 | Remove a unit | MISSING |
| 3.2 to 3.6 | Delivered, Read, Not confirmed with one retry | PARTIAL |
| 3.3 | Stop an agent at work | MISSING |
| 3.8 | Ended without an answer | PARTIAL: expired asks drop out |
| 4.1 to 4.6, 5.1 to 5.3 | Shared library | PARTIAL: list, create and search only |
| 4.7, 4.8 | Edit in place, hand sketches | PARTIAL, MISSING |
| 4.14 | History with Restore | MISSING |
| 4.10, 4.13, 5.x | Send to agent | MISSING |
| 5.4 to 5.7 | Format bar, saving states, Find and replace, source view | MISSING or PARTIAL |
| 6.1 to 6.8 | Settings tabs, machine selector, looks, agents, permissions, projects, content | PARTIAL: look buttons, language, phone, service and sync basics |
| 6.10, 6.11 | Reconnecting and stopped banners | PARTIAL, MISSING |
| 6.12 | 30 s request limit | MISMATCH: 15 s (`gui/app/api.mjs`) |
| 7.3, 7.5 | Phone lock, no standing approvals on the phone | MISSING |

## 4. Work packages

Each package lists its screens. The integration plan splits each into tasks with exact files, functions and code, so that the executor assumes nothing.

- P0. Base: cut `feat/3.0-final` from `qa/3.0-046` (`b78b9c5`) and bring in `docs/flows`, `test/spanish-register.test.mjs` and this plan. Record the baseline of `npm test`, `npm run test:core`, `npm run lint` and `npm run build`.
- P1. Setup, first run and installer (1.1 to 1.10, 6.1): decisions 3 to 8.
- P2. M1ND copy (all rows): decision 2, with a test that fails on visible "mind" or "mente".
- P3. Groups, aliases and unit removal (2.3, 2.4, 2.7 to 2.10, 2.18, 3.1): decisions 9, 10 and 16, contract first.
- P4. Sessions and chats (2.14 to 2.16, 3.2 to 3.8): decisions 11 and 20.
- P5. Shared library and deletions (4.1 to 4.6, 5.1 to 5.3): decisions 15 and 16.
- P6. Blueprint editing, sketches and History (4.7, 4.8, 4.13, 4.14): decision 18.
- P7. Comment composer (4.10, 4.13, 5.x): decision 17.
- P8. Void editor (5.4 to 5.9): decision 19.
- P9. Settings, agents and permissions (6.1 to 6.8, 6.10 to 6.12): decisions 7, 12, 13, 14 and 20.
- P10. Phone (7.1 to 7.7): decision 21.
- P11. Accessibility across rows: decision 22.
- P12. Verification: every screen compared with the running GUI at 1440 by 900 (phone at 390 by 844), element by element, with captures; tests for each new route and state; `npm test`, `test:core`, `lint` and `build` green.

## 5. How the work runs

1. Codex writes the integration plan in `docs/3.0/integration.md`: one task per change with its files, functions, exact code where it matters, tests and the proving command, each marked MECHANICAL or JUDGMENT.
2. Grok in the Cursor CLI executes the MECHANICAL tasks in order, one commit per task on `feat/3.0-final`, no push.
3. The same Codex session verifies plan against board against the commits, fixes or returns what fails, and does the JUDGMENT tasks.
4. The Overmind runs the final verification (P12) and reports to Tom.
5. Then tests and deploy: live test on SCOUT and MOTHERSHIP.

Codex and Cursor exchange tasks and reports through Relay. Merges, releases and publication wait for Tom.
