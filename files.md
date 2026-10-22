# Files

Every record is one file with one writer. Headers are `key: value` lines, then a blank line, then the body. State, task and log dates are `YYYY-MM-DD HH:MM`, local time. Relay message timestamps are ISO 8601. Folder names are the same at every level: `state/`, `inbox/`, `tasks/` and `log/` exist per project, per environment and at the root of `user/` for the executive roles. The person is `user` in the records written by hand, `master` (`root:master`) in the records the service writes, or a name of the `person:` header of a machine file. How the engine stores Relay records, the view contract and the managed files of a machine is in [engine/README.md](engine/README.md).

Layout inside the mind, all generated, all under `user/` (git-ignored):

```
user/
  VERSION                     base version this user/ was created or migrated with
  preferences.md              global preferences
  models.md                   which model does which kind of work, at which effort
  routes.md                   environments, projects and other minds, names only
  machines/<host>.md          one per machine
  machines/<host>.managed.json  the files installed on that machine and their hashes
  machines/<host>.report.md   what the last install or update on that machine wrote
  knowledge/                  private modules, same format as the base ones
  protocols/<name>.md         global protocols, for every project, one file per protocol
  roles/ commands/ features/  written for this mind, installed like the base ones
  state/ inbox/ tasks/ log/   executive roles (genesis, overseer, adjutant)
  brainstorm/<topic>.md       open questions of a topic of no project, deleted when empty
  overseer/                   the Overseer's memory: survey.md, plan.md, costs.md, one scope file per topic
  relay/                      Relay and service records: sessions, archive, events, wake, chats, approvals
  envs/<env>/
    state/ inbox/ tasks/ log/
  projects/<project>/
    brief.md
    product.md                what the product is and must do, now, written by the project's seat
    annexes/<name>.md         how the product is built, one file per annex (optional)
    brainstorm/<topic>.md     open questions of a topic being developed, deleted when empty (optional)
    preferences.md            project preferences (optional)
    protocols/<name>.md       local protocols, only for this project (optional)
    state/ inbox/ tasks/ log/
```

Team state, in the repo, on the `hivem1nd` branch mounted at `.hivem1nd/state/` (ignored by the code branches):

```
.hivem1nd/                    committed in main: config and overrides
  config.md
  roles/ features/ preferences.md   optional overrides
  state/                      the worktree of the hivem1nd branch
    presence/ inbox/ tasks/ log/
```

## State: `state/<unit>.md`

```markdown
unit: executor-myapp
unit-id: project:myapp:executor-myapp
role: executor
state: out
machine: LAPTOP
lead-id: env:web:overlord-web
lead: overlord-web
branch: feat/login
commit: 3f2a9c1
tree: clean
date: 2026-09-15 14:02
claims: src/auth/, docs/auth.md

Task: 003, password reset.
Step: the mail template; the form and the route are done.
Verified: the form and the route, `npm test` passed with 12 tests and the form was seen in the browser.
Remaining: the mail template, then task 004.
Blocker: none.
Authorizations: commit and push on feat/login, given by the person on 2026-09-15.
Decisions: sessions stay in cookies (brief Fact of 2026-09-14).
```

| Header | Written by | Meaning |
| --- | --- | --- |
| `unit` | the service, or the session on its first start | the unit name |
| `unit-id` | the service | `root:<unit>`, `env:<environment>:<unit>` or `project:<project>:<unit>` |
| `role` | the service | the role file the session receives, or `custom` |
| `role-name`, `role-description` | the service, for `custom` only | the name and the description the person wrote; the description is one JSON string, and the session receives it in place of a role file |
| `state` | the service and the session | `in` or `out` |
| `machine` | the service and the session | the host name |
| `lead-id`, `lead` | the service, or the session | the unit id and the name of the lead; a unit without them reports to the coordinator |
| `job` | the service, or the session | what the unit always does, such as `reader`, `reviewer` or a short description, so a lead hands work by job; a unit without it takes any work |
| `model` | the service or the host | the model the session runs on |
| `cluster-id` | the service | the cluster of the desktop app the unit belongs to |
| `runs-in` | the service | the client, model and effort chosen to launch the unit, one JSON object |
| `fresh` | the service, for the Overseer | `true` starts each session without the context of the previous one |
| `alias` | the service | the display name the person gave the unit |
| `removed` | the service | `true` once the unit is archived; nothing addresses it |
| `branch`, `commit`, `tree` | the session | the Git values of the current repo; `tree` is `clean` or the output of `git status --porcelain` in one line |
| `date` | the session | the time of the last write |
| `claims` | the session, in team repos only | the paths the unit claimed |

The body is the continuity context: one line per field, in this order, written so a session on another machine resumes from it alone. A field with nothing to hold is `none`; a long detail goes into a file the line names.

- Task: the active task, its id and title, or the request in hand.
- Step: the step reached, and the exact point where the work stopped.
- Verified: what was checked, with the command, file or behaviour and its verdict.
- Remaining: the work left, in order.
- Blocker: what stops the work, and who can remove it.
- Authorizations: each yes in force, what it covers and who gave it.
- Decisions: decisions not to ask again, each with its source.

A unit whose relay scope holds several repos keeps `branch`, `commit` and `tree` for the current one and adds a `## Repos` section after the context, one line per repo, such as `- shop: feat/cart 8b1d044 clean`. A squad is a lead plus every unit whose state names it. The rule of one session per unit is in [rules.md](rules.md#start).

## Message: `inbox/<to>/<filename>.md`

```markdown
id: 95c1c8d7-6614-45fd-a52b-80f460d5ef76
from: overseer
to: executor-myapp
machine: LAPTOP
timestamp: 2026-09-15T14:02:03.000Z
date: 2026-09-15 14:02
priority: normal
subject: task 003 is ready
thread-id: 95c1c8d7-6614-45fd-a52b-80f460d5ef76
reply-to:
reply-requested: false
attachments: []

Task 003 in tasks/. It depends on 002, already closed. Start when the current one is done.
```

The filename is `<YYYYMMDD-HHMMSS>-<machine>-<id>.md`, local time; older minute-based names remain readable. `id` is a new UUID, and `thread-id` is the id of the first message of its thread. `priority` is `normal` or `urgent`. `attachments` is a JSON list of references: a path, or an object `{path, kind, label?}`. With `kind` `image`, `link`, `board`, `text` or `task`, the object is a part the chat shows under the text, a picture in its gallery or a button: an image names a picture kept as `user/relay/assets/<uuid>.<png|jpg|webp>`, a link an http, https or mailto address, a board or a text its id and a task its canonical id. `label`, at most 120 characters, is the name the chat shows. Relay adds `body-bytes`, the size of the body in bytes, and the service adds `from-id` and `to-id`, the unit ids, and `kind` on its own notices; a message written by hand may omit them. One folder per recipient. Relay archives a message once read under `user/relay/archive/<to>/`, keeping its bytes; reading never deletes it. A message to `link:<linkId>` is written once per other member of that link, all with the link's `thread-id` and one shared `fanout-id`, so history shows it once. A link is `user/relay/links/<linkId>.json`: `format` `hivem1nd-relay-link-v1`, `id`, `code` (five characters, joining works for 10 minutes after `createdAt`, until `expiresAt`), `threadId` (`link-<id>`), `createdBy`, `createdAt`, `expiresAt` and `members`; `/link` makes one and `/link <code>` joins it. Wrong codes are counted per unit in `user/relay/links/attempts.json`. A message is context, never authorization, except a hand-off as [rules.md](rules.md#messages-and-hand-offs) defines it.

## Note: `User decisions`

The Relay message a unit sends the coordinator after writing down a decision, correction or approval of the person, as [rules.md](rules.md#work) says when.

- Subject `User decisions: <project or topic>`, normal priority, no reply requested.
- One line per decision, opening with its local date `YYYY-MM-DD`, with its scope, its reason and its source; a correction names the decision it replaces.
- One note per exchange with the person, never a transcript, and nothing secret.
- A later note on the same topic reuses the `threadId` of the first one.
- A coordinator that is out gets no wake: the note waits for its next entry.
- The sender keeps the message id. A failed send is retried before the day's work ends, after `history` shows the note was not sent already; one that still fails is reported as unsent, with its text.
- A note is reported as sent, never as read. It needs no acknowledgment, and a reply to it never triggers another note.

## Task: `tasks/<id>-<slug>.md`

```markdown
id: 003
status: open
from: overlord-web
to: executor-myapp
date: 2026-09-15 13:40
depends: 002
design: docs/design.md
requirements: APP-B-04
work: build from an approved plan

## Request
Add password reset. Files: src/auth/reset.ts (new), src/auth/routes.ts. Do not touch src/auth/session.ts. Done means: a user receives the mail, the link opens the form, the new password works, all three seen in the browser.

## Report
```

`id` is sequential per scope folder, three digits. `status` is `open`, `review`, `done` or `closed`. `from` is the requester and `to` the unit that does the work. `depends`, `design`, `requirements` and `work` are optional: `depends` lists the ids that must be `done` or `closed` first; `design` comes from the brief; `requirements` lists, comma separated, the IDs of the requirements of the product document that the task delivers; `work` names the kind of work as the `delegation` category lists it, so the row of `models.md` for that kind of work is taken. The service adds `task-id` (`<scope id>:<id>`, such as `project:myapp:003`), `title`, `from-id`, `to-id`, `cluster-id` and `plan-id` to the tasks it writes. A task is created through [/task](commands/task.md) or by the service.

A status changes by hand in a session the service did not start, and otherwise through `hivem1nd task status <project> <id> <status> [--note <text>]`, which the service checks against the table below and refuses with exit code 3 on a conflict, such as a task changed since it was read, and 2 on a change the table does not allow. Status changes, each one the event hooks listen to:

| Change | Actor | Precondition | Evidence |
| --- | --- | --- | --- |
| `open` to `review` | the unit in `to`, its lead, or the person | the work is verified where it runs | the Report: what was done, what was not, how to verify it, and the verdict of each check |
| lead approval, staying in `review` | the lead the `to` unit's state names | the lead reviewed the delivery first-hand | the line `Approved for review by <lead> on <date>` in the Report, `<date>` being the task's `date` header |
| `review` to `done` | the person; never a unit | the lead approval, when the `to` unit has a lead | the acceptance of the person |
| `review` to `open` | the lead, the requester, or the QA unit of the project | what is missing is known | what is missing, written in the Report |
| `done` to `closed` | the requester | none | the task is archived |
| `closed` to `open` | the requester | a reason | the reason, written in the Report |

A task of a unit without a lead has no approval line, and the person reviews it once it is in `review`. A task sent back twice for the same gap is not sent back a third time: the reviewer reports it to the person with both Reports. A requirement counts as met only when a `done` task cites it in `requirements` and every criterion of the requirement has linked evidence in that task's Report.

Protocols of a task, a contract of the text that the engine does not enforce, like [Exit and Git](rules.md#exit-and-git):

- While the task is planned, the protocols whose `scope` covers something the plan actually builds, in the mind and in the installed knowledge modules, are listed in the plan, each next to the item that uses it.
- Before the Report is written, the person is asked in one line whether to run them, each one named.
- Only the confirmed ones run; the verdict of each step is appended to the Report, and a declined one is recorded as declined.

## Verdicts

Every check ends in one of these verdicts, with the same words in every report.

| Verdict | Meaning | Next |
| --- | --- | --- |
| pass | the Result was observed as stated | the next step |
| fail | the Result was observed and differs | the step ends and the fail is recorded with the expected and the observed Result; the next step runs unless the `stop` line of the protocol says otherwise |
| not applicable | the subject of the step is absent, with the reason | the next step |
| not run | the step was skipped, with the reason: declined, a boundary, missing access | the next step; the run cannot end as pass |
| not verifiable | the step ran and the tool at hand cannot produce the evidence, with the reason | the next step; the run cannot end as pass |

A run passes only when every step is pass or not applicable; not run and not verifiable never count as pass. The run reports every fail at the end, and waits for the person only before acting on them. A run that a `stop` line ended resumes at the failed step once the cause is fixed.

## Brief: `projects/<project>/brief.md`

```markdown
project: myapp
env: web
stack: Next.js 15, MySQL 8
run: npm run dev
build: npm run build
design: docs/design.md
repo: github.com/user/myapp
stage: production
version: 1.4.2

## Facts
- 2026-09-12: the blog is stored in MySQL and edited from /admin; the JSON files are gone.
- 2026-09-14: sessions stay in cookies; no JWT.
- 2026-09-15: a forgotten password is reset by mail (product: Requirements/Beta).
```

No paths. Paths are per machine and live in the machine file. The first role that enters a project without a brief writes the header from its audit and asks only what the audit could not answer. A Fact that changes a product document carries the pointer `(product: <section>)`, such as `(product: Requirements/Beta)`, and shrinks to one line once the product document holds the text.

`stage` and `version` are optional and kept by the seat of the project. `stage` is the working stage: `pre-production`, plan work before the first build (design, brainstorm, scope) at version 0.x; `production`, changes and features from 1.0, where a fix adds a patch, a feature a minor and a milestone a major; `post-production`, review, QA, polish and release. The version says where the project stands; it never touches the package and is not a release. The release stage of the product is in the product document. The format of the product document follows.

## Product: `projects/<project>/product.md`

```markdown
project: myapp
family: shop
stage: beta
updated: 2026-09-15
voice: docs/voice.md
board: docs/flows/boards/index.json

## Problem and audience
Owners of small shops who write a blog and have no developer: changing a post or recovering a lost password means asking someone.

## Value
The owner edits posts and recovers access alone, from /admin.

## Requirements

### Alpha
- APP-A-01: the owner creates, edits and deletes a post from /admin. Accepted when: a post created in /admin shows on the public blog after a reload and is gone after deletion.

### Beta
- APP-B-04: a user who forgot the password sets a new one by mail. Accepted when: a reset request sends one mail, its link opens the form once, and the new password logs in.

### Release
- APP-R-01: every post reads with scripts blocked. Accepted when: each post opens and shows its full text in a browser with scripts disabled.

## Out of scope
- Comments from readers.

## Plans
Free and Plus. The prices are in the price table of `projects/shop/product.md`.

## Floors
- Local first: a draft survives a lost connection and is saved when it returns.
- Privacy: no third-party script on the public blog.
- Weak devices: a post shows its full text within 3 seconds on a phone profile with the CPU slowed four times and a slow 4G connection.
- Platforms: current desktop and phone browsers.

## Depends on
- Products: shop-checkout
- Shared contracts: sign-in

## Open questions
- Does a reset link expire after one hour or after a day?

## Annexes
- architecture: annexes/architecture.md
```

The product document is the current truth about a product: what it is, for whom, and what it must do at each stage. Every project has one, written and kept by that project's own seat. It holds what is true now; status and order of work never enter it. `project` is the product's project name. `family` is the project of the family the product belongs to, whose own product document is `projects/<family>/product.md`; the family product document names itself in `family`. A field with nothing to point at, such as a product with no family or no board yet, is written `none`. `stage` is `alpha`, `beta` or `release`, the release stage the product is in now, apart from the working stage in the brief. `updated` is the date, `YYYY-MM-DD`, of the last edit. `voice` and `board` are paths relative to the repository, as in the brief: the product document points to the voice specification and to the boards and never copies them.

A product document has these sections, in this order:

- Problem and audience: who the product is for and what they cannot do, or do badly, today.
- Value: what changes for them, in plain nouns.
- Requirements: one group per stage, `### Alpha`, `### Beta` and `### Release`, and one line per requirement with its ID and its acceptance criterion. The ID is `<CODE>-<A|B|R>-<NN>`, such as `APP-B-04`: `CODE` is the product's short uppercase code, which never changes, the letter is the stage and `NN` is a number within the stage. An ID is never reused for another requirement, and a requirement that changes stage takes a new ID. The criterion is something a reviewer can observe, such as a screen state, a figure, a file or the output of a command, never a quality word such as fast or simple.
- Out of scope: what the product deliberately does not do, one line each.
- Plans: the names of the plans the product is offered in. Prices are not repeated here; they are in the price table of the family product document.
- Floors: what holds at every stage, one line each for local first, privacy, weak devices and platforms.
- Depends on: two lines, `- Products: <project>, <project>` for the products of the family it needs and `- Shared contracts: <name>, <name>` for the contracts it uses, each written `none` when empty.
- Open questions: what is not decided yet. A question leaves the list when it is answered, and the answer goes into the section it belongs to.
- Annexes: the last section, one line per annex, `- <name>: <path>`, or `none` when the product has no annex. An annex lives in `projects/<project>/annexes/<name>.md`, beside the product document and written by the same seat, and its path is relative to the product document, such as `annexes/architecture.md`; one that already lives in the repository is named by its repository path instead, as `voice` and `board` are, and is not copied. An annex holds the how, such as the architecture, the data model and the integrations, and the product document holds the what and for whom. An annex never restates a requirement; it cites its ID.

The family product document has the same sections, where Requirements are the ones every product of the family meets, under the family's own code, and adds four: Rules, what holds for every product and is never restated in a product document; Product map, one line per product with its name, its code and what it is for, its stage staying in its own product document; Stages, what alpha, beta and release mean in the family; and Design direction, the path of the design document, never a copy of it. The family product document holds the price table once, in Plans, with one row per plan and every price written with currency and period.

One home per fact. Each fact is written once, in the file that owns it, and every other file refers to it by ID or by section instead of restating it:

- Product document: what the product is and for whom, now.
- Brief: the dated why, and the technical header.
- Scope file in `user/overseer/`, or brainstorm file: open questions only, while a topic is being defined. Agreed text leaves it in the same turn, into the product document or, for a project with a seat, into the brief Fact and the Relay note that hand it to the seat, and an empty file is deleted.
- Survey and plan in `user/overseer/`: status and order of work.
- Boards: the UI.
- Annex: the how of the product, such as its architecture, data model and integrations.
- Task: the how of one piece of work, in its Architecture section when it has one.

The seat of the project, its Product Manager when it has one, otherwise its Executor or the unit that works in that project, writes and keeps the project's product document and its annexes, one writer per file. It drafts the product document from the records and edits it in the turn a product decision is taken, with `updated` set and the brief Fact left as one line with its pointer. A requirement changes only on a decision of the user. The coordinator, the Overseer unit when the mind has one and otherwise the environment's Overlord, reviews each product document against the user's decisions and approves it with the user. It drafts a product document only for a project that has no seat, and it owns the family product document, which it drafts part by part with the user. A product decision taken with the coordinator is written by the coordinator as a brief Fact with its `(product: <section>)` pointer plus a Relay note to the project's seat, subject `Product decision: <project>`, one line naming the section, normal priority, no reply requested. The seat edits the product document, and the check reports the gap until it does. A seat that edits its product document sends the coordinator its `User decisions` note, so that the change is reviewed; a Product Manager, like every preset role, sends it only when the person asks. The `product-requirements` protocol of the `product` knowledge module writes a product document, and `/brainstorm` drafts its text.

Depends on is data. After a change to a product document that touches a shared contract, whoever edited it, the seat or the coordinator, sends one Relay note to each product listed in that product document's Depends on: subject `Product change: <project>`, one line naming the sections or IDs changed, normal priority, no reply requested. The unit of each product comes from its state file, and a missing or ambiguous unit is reported to the user, never guessed. No code sends it; the roles do.

The check reports a project with a `brief.md` and no `product.md`. When the working directory resolves to a project, one line names that project; when it resolves to none, as for an executive seat at the mind root, one line gives the number of such projects and is absent at zero. `--json` carries the full list, each project with its brief path, under `mind.product.missing`. The check also compares `updated` with the date of the newest Fact in the same project's brief that carries a pointer, and a product document older than that Fact is reported. A Fact without a pointer never triggers it, however new, and a product document updated on the day of the Fact or later is not reported. A product document over 20 KB is listed for `/cleaner`.

## Log: `log/<YYYYMMDD-HHMM>-<unit>.md`

```markdown
unit: executor-myapp
date: 2026-09-15 14:02
branch: feat/login
commits: 3f2a9c1..8b1d044
task: 003

Added the reset flow in src/auth/reset.ts and its route. The mail template is a plain-text stub, to be replaced. Verify: request a reset from /login, open the link from the console output, set a new password, log in.
```

One entry per piece of work, written on exit. Nothing loads it by default; it is read on request.

## Routes: `routes.md`

```markdown
## Environments
- web: myapp, shop
- unity: mygame

## Projects
- myapp (web)
- shop (web)
- mygame (unity)
- tool

## Minds
- D:\team-mind
```

Names only. `Minds` lists other minds this one can read, when there are any.

## Machine: `machines/<host>.md`

```markdown
machine: LAPTOP
mind: D:\mind
language: en
preferences-first: yes
update-check: daily
last-check: 2026-09-15
setup: done

## Agents
- claude-code: on-demand
- cursor: auto

## Paths
- web: C:\Users\me\GitHub
- myapp: C:\Users\me\GitHub\myapp
- mygame: C:\Users\me\Unity\mygame
- evidence: D:\evidence

## Excluded
- knowledge
- corpo
```

`setup` is `done` or the number of the next step, so any front resumes. It reaches `done` only when every asset of that run was written, left unchanged or answered for; anything unwritten leaves the number of the install step, so the next run finishes it. `preferences-first` is `yes` by default; `no` puts the HIVEM1ND auto rule before existing preferences while preserving their content. `update-check` is `daily` or `off`. `Excluded` lists the modules and features left out at setup; `/evolve` never installs them. The optional `evidence` path is where `/cleaner` moves large evidence and binary folders out of the mind; the brief keeps the relative path.

The optional `person:` header is a comma-separated list of names the person goes by in the records, used to tell their requests and questions apart.

While `setup` is a number, a temporary `## Setup Draft` section contains a fenced JSON block with the answers collected so far. Every front preserves it when resuming. The section is removed when `setup: done`; completed settings remain in the header and the Agents, Paths and Excluded sections.

The installed files of the machine and their hashes are in `machines/<host>.managed.json`, beside the machine file, as [engine/README.md](engine/README.md#managed-files) describes.

## Install report: `machines/<host>.report.md`

```markdown
machine: LAPTOP
date: 2026-09-21 10:30
action: install
written: 143
omitted: 2
unwritten: 0
links-replaced: 1

## Omitted
- C:\Users\me\.claude\skills\qa\SKILL.md: left uninstalled behind the link C:\Users\me\.claude\skills

## Links replaced
- C:\Users\me\.agents\skills

## Warnings
- ...
```

One file per machine, replaced by every install, attach and update, so what a run did outlives the window it ran in. `action` is `install`, `attach` or `evolve`. `written` counts the files of that run; `omitted` the ones the user left uninstalled; `unwritten` the ones that failed without an answer, which is also what keeps `setup` from reaching `done`; `links-replaced` the links removed to write behind them. Each section exists only when it has entries.

## Preferences: `preferences.md`

```markdown
- 2026-09-11: answers of one or two lines, no offers or agendas. Why: long blocks are noise.
- 2026-09-15: public text impersonal, no "you". Why: reads like an installer.
```

One line per preference, with the date and the reason. The global file applies everywhere; a project file applies to that project and overrides the global one.

## Models: `models.md`

```markdown
updated: 2026-09-15

# Models

Which model does which kind of work, at which effort, for every seat and every delegation of this mind. It is the default when the user has not said otherwise.

| Work | Client | Model | Effort | Status | Tested | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Plan, scope, product document, deep review | <client> (seat) | strong model | max | active | 2026-09-12 | plans held up in review |
| Seat work | <client> (seat) | strong model | high | active | 2026-09-12 | every seat; never delegated |
| Build from an approved plan | subagent | mid model | high; xhigh for hard pieces | active | 2026-09-14 | test counts held when the seat reran them |
| Build from an approved plan | <client> | mid model | high | active while paid | 2026-09-14 | two tasks built, counts held |
| Read-only gathering | subagent | light model | low | active | 2026-09-14 | sources cited, conflicts found |
| Mechanical edits from a written list | subagent | mid model | low | candidate | not yet | |
| Mechanical edits from a written list | subagent | light model | low | candidate | not yet | |

Fallback order for builds: mid model on subagent, then mid model on <client>.
Fallback order for mechanical edits: mid model on subagent, then light model on subagent.
```

The table says which model, at which effort, does each kind of work. `updated` is the date, `YYYY-MM-DD`, of the last edit. The kit speaks in tiers, strong, mid and light, and never in model names: the example holds tier words in the Model column, and the mind's file holds the concrete model of each row. The `delegation` category lists the kinds of work with the tier and effort of each, and the Adapters section of `roles/genesis.md` maps the tiers to the models of each client.

There is one row per kind of work and client, so a kind of work has several rows when several clients can do it. Work is the kind of work, worded as in the `delegation` category. Client is the key of a Relay wake adapter, or `subagent` for a subagent of the seat's own client, optionally followed by a note in parentheses, such as `(seat)` for work done in the user's own chat. Effort is `low`, `medium`, `high`, `xhigh` or `max`, with a note after a semicolon where hard pieces differ. Status is `active`, `paused` or `candidate`, optionally followed by a short qualifier, such as `active while paid`. Tested is the date, `YYYY-MM-DD`, of the test that last changed the row, several dates comma separated, or `not yet`, and Result is one line of what the test showed. The last lines, one per kind of work that has a fallback, `Fallback order for <work>: <row>, then <row>.`, name for that kind of work the rows to take in order when the first is not available, each row written as its model on its client.

A row changes only when a test changes it. A tool moves from `candidate` to `active` only after a real test: a piece the seat has verified first-hand and, for a client other than the seat's, a Relay live trial. A tool that stops being available, such as a subscription that ends, is `paused`, never deleted, and keeps its history. Prices never enter the table; they stay in the mind's cost notes. The user's call in the moment, which client, model or effort to use now, overrides the table for that session and is never written into it.

When `models.md` does not exist, setup writes it from the Adapters mapping; after that the coordinator, the Overseer unit when the mind has one and otherwise the environment's Overlord, edits it in the turn a test changes a row. The check reads the Client column: a row whose first word is neither the key of a Relay wake adapter nor `subagent` is reported with its Work and its client. A missing file, a file without a table and a valid row stay silent, and the measurement never fails the check.

## Delegation

How a unit hands pieces of its work to subagents or to other agents, with the rows of `models.md`.

- A delegated piece can fail on its own and shares no file with another piece; small pieces that fit one brief go together. A task is delegated only when its `depends` are `done` or `closed`.
- Its brief holds its part of the plan, absolute paths, what not to touch, what done looks like, and the client, model and effort of its row in `user/models.md`, the first `active` one and then the fallback order, unless the person said otherwise for the session.
- Pieces run one after another on the task branch. Parallel pieces on one repo get a worktree each from the task branch, merged back once reviewed, and each brief names the shared resources not to touch, such as the branch, the index, ports and databases.
- Each result is reviewed first-hand by the delegating unit: file and line, build output, the behaviour where it runs; a claim without evidence is not accepted. A piece that fails twice on one brief is done by the delegating unit itself, and its report says so.

## Knowledge module: `knowledge/<module>/`

```
knowledge/<module>/
  INDEX.md                    the first level: categories, a routing table to protocol steps, and protocols, one line each
  essentials.md               the floor rules and default values, read first for a build from scratch or a whole pass
  steps.md                    what each protocol step checks, in a few words, so a pass opens only the protocols it runs
  categories/<category>.md    the second level: subcategories with use cases, a build recipe, options and files to open
  <topic>.md                  knowledge topics, any number, read when a category or protocol names them
  protocols/<name>.md         protocols shipped with the module
  features/<name>.md          commands installed with the module
```

`INDEX.md`:

```markdown
module: security
purpose: Web application security by category, with the checks that prove it.

Read this file, open only the category the work touches, and from there only the protocols and topic sections it names.

## Categories
- [identity](categories/identity.md): login, sessions and cookies, signed tokens, password reset, second factor.
- [api](categories/api.md): endpoint inventory, authorization per object, input validation, rate limits.

## Routing
| Category | Protocols and steps |
| --- | --- |
| every change | access-control 1 |
| identity | authentication-and-session 1 to 6 |
| api | access-control 1 to 4 |

## Protocols
- authentication-and-session: scope login, sessions and password flows. Checks a login against the session rules before it ships.
- access-control: scope any endpoint that reads an identifier from the request. Proves one account cannot reach another's objects.
```

`categories/<category>.md`, one section per subcategory:

```markdown
## Password reset

Applies when: a reset flow is added or changed, or a request mentions forgotten passwords.

Build: answer the same way whether the account exists, email a single-use link that expires, invalidate every session on use.

Options:
- Emailed single-use link, the default.
- Code typed into the open session, when the link would open on another device.

Open: [authentication-and-session](../protocols/authentication-and-session.md), step 5; [sessions-and-credentials.md](../sessions-and-credentials.md), Reset.
```

The routing table has two columns, Category and Protocols and steps, and no topic column, since the Open line of a subcategory names its topics; its first row is the work that always runs, such as `every rendered surface` in design or `every run` in copy.

A pack serves two jobs. Building something new starts from the floors of `essentials.md`, which are the requirements, and the `Build:` line of each subcategory it touches, which is a recipe to start from; a plan cites each subcategory it uses by its heading link, such as `categories/forms.md#layout`. Auditing runs the protocols. A link from one pack into another carries a local fallback rule, used when that module is not installed. Protocol times are ceilings, a step that does not apply ends as not applicable, and evidence the tool at hand cannot produce is recorded as not verifiable instead of blocking the pass ([Verdicts](#verdicts)).

The index stays small on purpose. An agent reads it whole, opens the one category the work touches, and from there only the protocols and topic sections that subcategory names, instead of loading the module. A new subcategory is a section in its category file; a new category is a file plus one line in the index; a new check is a protocol named from the subcategories that need it. The protocol lines, with their scope, are also what planning matches against to list the protocols a task offers to run.

A module under `user/knowledge/` has the same layout. A folder of notes becomes one by writing its index, by hand or by having an agent read the folder and write it. Excluding a module at setup leaves out its topics, its protocols and its features alike.

## Protocol: `protocols/<name>.md`

```markdown
name: nightly-build
purpose: Build and smoke test the app every morning, before the team starts.
scope: the build of one repository, from the last commit on main
trigger: schedule
repeat: every 1 day
inputs: repo C:\Users\me\GitHub\myapp, branch main
stop: three failures in a row
report: pass or fail per step, and the final build path

## Steps

1. Pull the latest commit on main.
   Task: `git pull origin main` in the repo path.
   Time: 2 minutes; abort the run if it does not finish in time.
   Result: `git rev-parse HEAD` prints the same commit as `git rev-parse origin/main`.

2. Build.
   Task: `npm run build` in the repo path.
   Time: 10 minutes; abort the run if it does not finish in time.
   Result: the command exits 0 and `dist/` holds files written by this run.

3. Smoke test.
   Task: open the app and check the login screen loads.
   Time: 5 minutes.
   Result: the login screen is visible in the browser.
```

`name` is the file's own name in kebab-case. `trigger` is `manual`, `schedule`, `condition` or `task close`, which lists the protocol in the plan of a task that matches it and runs it before the Report only with the person's yes, as described under [Task](#task-tasksid-slugmd). `scope` is what the protocol applies to, in plain words: the kind of work, the surface or the folder it covers. It is what the module index lists and what planning matches against the work, and it is required when the trigger is `task close`. `repeat` is `once`, a count, `every <interval>` or `until <condition>`. `stop` lists the conditions that end the run, such as a fail that the later steps cannot run without. Each step's Task names the exact action, path, command or tool that performs it; Time is a duration, a deadline or a schedule, plus what happens when it is exceeded; Result is the outcome that proves the step is done, checkable by reading a file, an output or a state, never a vague "done". `## Steps` may open with a short introduction, and a short reference section, such as the launch commands the steps use, may follow the steps. Steps run strictly in order, and each ends in one verdict of [Verdicts](#verdicts): a fail ends its step and is recorded against the expected Result, and the next step runs unless the `stop` line says otherwise; not applicable, not run and not verifiable carry their reason.

A Result is something an agent can verify: a command and its expected output, a file and line, a count. An empty search is evidence only with its scope recorded and a positive control: the same search first finds a planted or known hit. A search command runs in a POSIX shell and in PowerShell, or gives both forms.

A protocol shipped inside a knowledge module has this same format and lives in the module's `protocols/` folder, listed in its `INDEX.md`; `user/protocols/` holds the global ones written for this mind, and `user/projects/<project>/protocols/` the local ones of one project, which exist only while that project is the current one; neither needs an index. All of them are visible to `/protocol` and to planning.

## Team config: `.hivem1nd/config.md`

```markdown
state: branch
ai-trailers: no
ai-files: yes
```

`state` is `branch` (default) or `main`. `ai-trailers` and `ai-files` are the AI presence setting, decided once per repo. Presence files in `state/presence/<user>-<unit>.md` have the same header as a state file plus `user:`.
