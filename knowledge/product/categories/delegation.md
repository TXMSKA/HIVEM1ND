# Delegation

Which tier of model does which kind of work, at which effort, and how a piece handed to someone else comes back. The kit speaks in tiers, never in model names: strong is the top model family of a client, mid its balanced family and light its small, fast family. Effort is one of low, medium, high, xhigh and max. The mind's `user/models.md` turns tiers into concrete rows and is the default when the user has not said otherwise; the user's call in the moment overrides it for that session and is never written into it. Defaults for the whole category: the seat verifies every delegated result, builders run their own tests, and a delegated piece gets a complete brief. The format of the table is in [files.md](../../../files.md#models-modelsmd). The category has no protocol.

## Tier and effort per kind of work

Applies when: a piece of work is about to start or to be handed to a subagent or another client, a brief has to name a model and an effort, or a request asks which model should do something.

Options:

- **Plan, scope, PRD and deep review**: strong tier, max effort. A wrong plan costs every build after it, so these get the most reasoning available.
- **Seat work**: strong tier, high effort, never delegated. Conversation, coordination, review of delegated output, design, boards and copy for people stay in the seat's own chat, since they depend on what the user said there.
- **Build from an approved plan**: mid tier, high effort, and xhigh for a hard piece, such as a change that crosses modules or a defect with no known cause.
- **Read-only gathering**: light tier, low effort. Research, inventories and status rounds only read and report, with their sources.
- **Mechanical edits from a written list**: mid tier, low effort, and the light tier as the fallback. Renames, moves and replacements where the list names every change.

Build: take the kind of work the piece belongs to and name its tier and effort in the brief. A piece that mixes kinds is split, or takes the highest tier among them. A piece with no written list is a build, however small, and a piece that decides something is plan work, not a build.

Open: [files.md](../../../files.md#models-modelsmd), the Work column.

## From tier to row

Applies when: a tier has to become a client, a model and an effort, a delegation is about to start, the user names a model, or a row is being added, tested or paused.

Options:

- **The row of `user/models.md` for the kind of work**, the default when the user has not said otherwise.
- **The user's call in the moment**, when the user names a client, a model or an effort. It holds for that session, and the table is left as it was.
- **The tier alone**, when the mind has no table: the model of that tier that the client offers, at the effort above.

Build: find the kind of work in the Work column and take the first `active` row; when its client is not available, take the next row of the fallback order. A `candidate` row has not been tested: it becomes `active` only after a real test, which is a piece the seat has verified and, for a client other than the seat's, a Relay live trial. A row changes only when a test changes it. A tool that stops being available is `paused`, never deleted, and keeps its history. Prices stay out of the table.

Open: [files.md](../../../files.md#models-modelsmd), the rules of the table; [genesis](../../../roles/genesis.md#adapters), the tiers of each client.

## Handing a piece over

Applies when: a piece is handed to a subagent or to another client, a delegated result comes back, or a builder reports.

Options:

- **A subagent of the same client**, the default for a piece that fits in one brief and shares no file with another.
- **Another client**, when the first `active` row for the kind of work names it or the user asks for it.

Build: a complete brief for each piece, with its part of the plan, absolute paths, what not to touch, what done looks like, and the tier and effort of its row. The builder runs its own lint and tests and reports the counts, passed, failed and skipped, never "all green" alone. The seat verifies every delegated result first-hand before it counts: it reruns the tests, lint and build and sees the behaviour where it runs, and a claim without evidence is not accepted. Verification is seat work and is not delegated. What the seat saw is what the table's Tested and Result record.

Open: [files.md](../../../files.md#models-modelsmd), Tested and Result.
