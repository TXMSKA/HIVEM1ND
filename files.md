# Files

Every record is one file with one writer. Headers are `key: value` lines, then a blank line, then the body. State, task and log dates are `YYYY-MM-DD HH:MM`, local time. Relay message timestamps are ISO 8601. Folder names are the same at every level: `state/`, `inbox/`, `tasks/` and `log/` exist per project, per environment and at the root of `user/` for the executive roles.

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
  state/ inbox/ tasks/ log/   executive roles (genesis)
  envs/<env>/
    state/ inbox/ tasks/ log/
  projects/<project>/
    brief.md
    product.md                what the product is and must do, now, written by the project's seat
    annexes/<name>.md         how the product is built, one file per annex (optional)
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
state: out
machine: LAPTOP
branch: feat/login
commit: 3f2a9c1
tree: clean
date: 2026-09-15 14:02
claims: src/auth/, docs/auth.md

Login form done and tested in the browser. Password reset half done: the mail template is missing. Next: finish the template, then task 004. Do not re-ask: sessions stay in cookies, decided on 09-14.
```

`state` is `in` or `out`. `tree` is `clean` or the output of `git status --porcelain` in one line. `claims` only in team repos. `lead` is optional: it names the unit this one reports to, such as `lead: overlord-myapp`, and a unit without it reports to the coordinator as before. `job` is optional: it names what the unit always does, such as `reader`, `archiver`, `builder`, `reviewer` or a short free-text description, so that a lead hands work by job, and a unit without it takes any work. A squad is a lead plus every unit whose state names it as `lead`. `model` is optional: the model the session runs on, as the session or the host that started it writes it, such as `model: strong` or the model's own name. A chat is created from three things that live in the unit's state, its name, its `job` and its `model`, so a host creates one by writing them. The body is the context, ten lines at most, written so a session on another machine can resume from it alone. A unit whose relay scope holds several repos keeps `branch`, `commit` and `tree` for the current one and adds a `## Repos` section after the context, one line per repo, such as `- shop: feat/cart 8b1d044 clean`.

## Message: `inbox/<to>/<filename>.md`

New Relay messages use filenames with seconds, machine name and a random collision-resistant suffix. Existing minute-based messages remain readable.

```markdown
id: 95c1c8d7-6614-45fd-a52b-80f460d5ef76
from: manager
to: executor-myapp
machine: LAPTOP
timestamp: 2026-09-15T14:02:03.000Z
priority: normal
subject: task 003 is ready
thread-id: 95c1c8d7-6614-45fd-a52b-80f460d5ef76
reply-to:
reply-requested: false
attachments: []

Task 003 in tasks/. It depends on 002, already closed. Start when the current one is done.
```

One folder per recipient. Relay archives a message after reading it under `user/relay/archive/<to>/`, retaining its original bytes for history and retry. Reading does not delete it. Older messages keep their original headers and filenames. OneDrive can take time to sync; separate machines do not share an atomic filesystem transaction. A message is context, never authorization.

Relay stores session registrations, archives and metadata-only events under `user/relay/`. Temporary publication files and OneDrive conflict copies are ignored. Attachments are references only; no files are copied or automatically opened.

Relay wake policies, bounded worker leases and submitted-message bookkeeping are also stored under `user/relay/`. A policy binds one explicit unit to one native session, client and local machine, with a fixed start/deadline and handoff cap; resuming or re-registering does not renew it. The Claude Code adapter keeps `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN` in the target process environment only. The Codex adapter inherits the host-provided `CODEX_APP_TOOLS_PIPE_PATH` and actual `CODEX_THREAD_ID` in memory and invokes only the installed bundled App Tools MCP server. Neither transport endpoint is written to the mind, CLI arguments, client config, events or logs. A successful transport response is recorded as submitted, never as delivered; ambiguous Codex MCP failures are not replayed by another transport.

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

`id` is sequential per project, three digits. `status` moves from `open` to `review` when the executor appends the report and the work waits for the requester's look, to `done` when the requester accepts it, and to `closed` when the requester archives it. A task sent back from `review` returns to `open` with what is missing in its Report. When the state of the executor names a `lead`, the lead reviews the delivery first and appends `Approved for review by <unit> on <date>` to the Report, or sends the task back as above, and the person's review waits for that line; a task of an executor with no `lead` has no such line and is reviewed as before, and no status is added. Each change is the event hooks listen to. While the task is planned, the protocols whose `scope` covers something the plan actually builds, in the mind and in the installed knowledge modules, are listed in the plan, each next to the item that uses it. Before the Report is written, the user is asked in one line whether to run them, each one named; only the confirmed ones run, what each step produced is appended to the Report, and a declined one is recorded as declined. Roles and features follow this the way they follow the rule about commits and pushes: it is a contract in the text, not something the engine enforces. `depends`, `design`, `requirements` and `work` are optional; `design` comes from the brief, `requirements` lists, comma separated, the IDs of the requirements of the product document that the task delivers, and `work` names the kind of work the task is, as the `delegation` category lists it, so that the executor takes the row of `models.md` for that kind of work.

## Brief: `projects/<project>/brief.md`

```markdown
project: myapp
env: web
stack: Next.js 15, MySQL 8
run: npm run dev
build: npm run build
design: docs/design.md
repo: github.com/user/myapp

## Facts
- 2026-09-12: the blog is stored in MySQL and edited from /admin; the JSON files are gone.
- 2026-09-14: sessions stay in cookies; no JWT.
- 2026-09-15: a forgotten password is reset by mail (product: Requirements/Beta).
```

No paths. Paths are per machine and live in the machine file. The first role that enters a project without a brief writes the header from its audit and asks only what the audit could not answer. A Fact that changes a product document carries the pointer `(product: <section>)`, such as `(product: Requirements/Beta)`, and shrinks to one line once the product document holds the text. The format of the product document follows.

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
- Weak devices: the public blog is usable on a five-year-old phone.
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
- Scope file in `user/manager/`, or brainstorm file: open questions only, while a topic is being defined. Agreed text leaves it in the same turn, into the product document or, for a project with a seat, into the brief Fact and the Relay note that hand it to the seat, and an empty file is deleted.
- Survey and plan in `user/manager/`: status and order of work.
- Boards: the UI.
- Annex: the how of the product, such as its architecture, data model and integrations.
- Task: the how of one piece of work, in its Architecture section when it has one.

The seat of the project, its Executor or the unit that works in that project, writes and keeps the project's product document and its annexes, one writer per file. It drafts the product document from the records and edits it in the turn a product decision is taken, with `updated` set and the brief Fact left as one line with its pointer. A requirement changes only on a decision of the user. The coordinator, the Manager unit when the mind has one and otherwise the environment's Overlord, reviews each product document against the user's decisions and approves it with the user. It drafts a product document only for a project that has no seat, and it owns the family product document, which it drafts part by part with the user. A product decision taken with the coordinator is written by the coordinator as a brief Fact with its `(product: <section>)` pointer plus a Relay note to the project's seat, subject `Product decision: <project>`, one line naming the section, normal priority, no reply requested. The seat edits the product document, and the check reports the gap until it does. A seat that edits its product document sends the coordinator its `User decisions` note, so that the change is reviewed. The `product-requirements` protocol of the `product` knowledge module writes a product document, and `/brainstorm` drafts its text.

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

While `setup` is a number, a temporary `## Setup Draft` section contains a fenced JSON block with the answers collected so far. Every front preserves it when resuming. The section is removed when `setup: done`; completed settings remain in the header and the Agents, Paths and Excluded sections.

The managed files live beside the machine file, in `machines/<host>.managed.json`: one JSON object mapping installed absolute file paths to their SHA-256 content hashes, so the machine file keeps only the header, Agents, Paths and Excluded. Setup, attach and updates read and write that file. A machine file from an older install still carries the map in a `## Managed Files` section holding a fenced JSON object; it is read from there while the JSON file does not exist, and the next write moves it out and removes the section. Setup and updates replace a managed file automatically only while its content still matches the recorded hash; a kit copy in the mind also counts as managed while it matches the hash another machine of the mind recorded for the same path. Text matches under either line ending, because machines that share a mind may check the kit out with different ones: a file that already holds the same text as the kit is left as it is and recorded as it is on disk, and binary content is compared byte for byte. An unowned or locally modified file requires a keep-or-replace choice; a run without a terminal lists the choices and exits with code 1 instead of asking. Paths and hashes stay private in the machine record. A symbolic link or a Windows junction standing where files have to be written is one choice for every file behind it: replacing it removes the link and keeps the folder it points at, and omitting it leaves those files uninstalled, where the next `check` lists them as missing.

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

Fallback order for builds: mid model on subagent, then mid model on <client>.
```

The table says which model, at which effort, does each kind of work. `updated` is the date, `YYYY-MM-DD`, of the last edit. The kit speaks in tiers, strong, mid and light, and never in model names: the example holds tier words in the Model column, and the mind's file holds the concrete model of each row. The `delegation` category lists the kinds of work with the tier and effort of each, and the Adapters section of `roles/genesis.md` maps the tiers to the models of each client.

There is one row per kind of work and client, so a kind of work has several rows when several clients can do it. Work is the kind of work, worded as in the `delegation` category. Client is the key of a Relay wake adapter, or `subagent` for a subagent of the seat's own client, optionally followed by a note in parentheses, such as `(seat)` for work done in the user's own chat. Effort is `low`, `medium`, `high`, `xhigh` or `max`, with a note after a semicolon where hard pieces differ. Status is `active`, `paused` or `candidate`, optionally followed by a short qualifier, such as `active while paid`. Tested is the date, `YYYY-MM-DD`, of the test that last changed the row, several dates comma separated, or `not yet`, and Result is one line of what the test showed. The last line, `Fallback order for <work>: <row>, then <row>.`, names for one kind of work the rows to take in order when the first is not available, each row written as its model on its client.

A row changes only when a test changes it. A tool moves from `candidate` to `active` only after a real test: a piece the seat has verified first-hand and, for a client other than the seat's, a Relay live trial. A tool that stops being available, such as a subscription that ends, is `paused`, never deleted, and keeps its history. Prices never enter the table; they stay in the mind's cost notes. The user's call in the moment, which client, model or effort to use now, overrides the table for that session and is never written into it.

When `models.md` does not exist, setup writes it from the Adapters mapping; after that the coordinator, the Manager unit when the mind has one and otherwise the environment's Overlord, edits it in the turn a test changes a row. The check reads the Client column: a row whose first word is neither the key of a Relay wake adapter nor `subagent` is reported with its Work and its client. A missing file, a file without a table and a valid row stay silent, and the measurement never fails the check.

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
- **Emailed single-use link**, the default.
- **Code typed into the open session**, when the link would open on another device.

Open: [authentication-and-session](../protocols/authentication-and-session.md), step 5; [sessions-and-credentials.md](../sessions-and-credentials.md), Reset.
```

A pack serves two jobs. Building something new starts with `essentials.md` and the `Build:` line of each subcategory it touches, so the first version is right; auditing runs the protocols. Protocol times are ceilings, a step that does not apply ends as not applicable, and evidence the tool at hand cannot produce is recorded as such instead of blocking the pass.

The index stays small on purpose. An agent reads it whole, opens the one category the work touches, and from there only the protocols and topic sections that subcategory names, instead of loading the module. A new subcategory is a section in its category file; a new category is a file plus one line in the index; a new check is a protocol named from the subcategories that need it. The protocol lines, with their scope, are also what planning matches against to list the protocols a task offers to run.

A module under `user/knowledge/` has the same layout. A folder of notes becomes one by writing its index, by hand or by having an agent read the folder and write it. Excluding a module at setup leaves out its topics, its protocols and its features alike.

## Protocol: `protocols/<name>.md`

```markdown
name: nightly-build
purpose: Build and smoke test the app before the team starts.
scope: the build of one repository, from the last commit on main
trigger: schedule, weekdays 07:00
repeat: every 1 day
inputs: repo C:\Users\me\GitHub\myapp, branch main
stop: three failures in a row
report: pass or fail per step, and the final build path

## Steps

1. Pull the latest commit on main.
   Task: `git pull origin main` in the repo path.
   Time: 2 minutes; abort the run if it does not finish in time.
   Result: `git log -1` shows a commit dated today.

2. Build.
   Task: `npm run build` in the repo path.
   Time: 10 minutes; abort the run if it does not finish in time.
   Result: `dist/` exists and the command exits 0.

3. Smoke test.
   Task: open the app and check the login screen loads.
   Time: 5 minutes.
   Result: the login screen is visible in the browser.
```

`name` is the file's own name in kebab-case. `trigger` is manual, a schedule, a condition, or `task close`, which lists the protocol in the plan of a task that matches it and runs it before the Report only with the user's yes, as described under Task. `scope` is what the protocol applies to, in plain words: the kind of work, the surface or the folder it covers. It is what the module index lists and what planning matches against the work, and it is required when the trigger is `task close`. `repeat` is `once`, a count, `every <interval>` or `until <condition>`. `stop` lists the conditions that end the run besides a failed step. Each step's Task names the exact action, path, command or tool that performs it; Time is a duration, a deadline or a schedule, plus what happens when it is exceeded; Result is the outcome that proves the step is done, checkable by reading a file, an output or a state, never a vague "done". Steps run strictly in order; a run stops at the first step whose Result is not met and reports it against what was expected.

A protocol shipped inside a knowledge module has this same format and lives in the module's `protocols/` folder, listed in its `INDEX.md`; `user/protocols/` holds the global ones written for this mind, and `user/projects/<project>/protocols/` the local ones of one project, which exist only while that project is the current one; neither needs an index. All of them are visible to `/protocol` and to planning.

## Team config: `.hivem1nd/config.md`

```markdown
state: branch
ai-trailers: no
ai-files: yes
```

`state` is `branch` (default) or `main`. `ai-trailers` and `ai-files` are the AI presence setting, decided once per repo. Presence files in `state/presence/<user>-<unit>.md` have the same header as a state file plus `user:`.
