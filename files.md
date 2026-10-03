# Files

Every record is one file with one writer. Headers are `key: value` lines, then a blank line, then the body. Dates are `YYYY-MM-DD HH:MM`, local time. Folder names are the same at every level: `state/`, `inbox/`, `tasks/` and `log/` exist per project, per environment and at the root of `user/` for the executive roles.

Layout inside the mind, all generated, all under `user/` (git-ignored):

```
user/
  VERSION                     base version this user/ was created or migrated with
  preferences.md              global preferences
  routes.md                   environments, projects and other minds, names only
  machines/<host>.md          one per machine
  machines/<host>.report.md   what the last install or update on that machine wrote
  knowledge/                  private modules, same format as the base ones
  protocols/<name>.md         global protocols, for every project, one file per protocol
  roles/ commands/ features/  written for this mind, installed like the base ones
  state/ inbox/ tasks/ log/   executive roles (genesis)
  envs/<env>/
    state/ inbox/ tasks/ log/
  projects/<project>/
    brief.md
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
machine: SCOUT
branch: feat/login
commit: 3f2a9c1
tree: clean
date: 2026-09-15 14:02
claims: src/auth/, docs/auth.md

Login form done and tested in the browser. Password reset half done: the mail template is missing. Next: finish the template, then task 004. Do not re-ask: sessions stay in cookies, decided on 09-14.
```

`state` is `in` or `out`. `tree` is `clean` or the output of `git status --porcelain` in one line. `claims` only in team repos. The body is the context, ten lines at most, written so a session on another machine can resume from it alone. A unit whose relay scope holds several repos keeps `branch`, `commit` and `tree` for the current one and adds a `## Repos` section after the context, one line per repo, such as `- shop: feat/cart 8b1d044 clean`.

## Message: `inbox/<to>/<YYYYMMDD-HHMM>-<from>.md`

```markdown
from: overlord-web@SCOUT
to: executor-myapp
date: 2026-09-15 14:02
subject: task 003 is ready

Task 003 in tasks/. It depends on 002, already closed. Start when the current one is done.
```

One folder per recipient. The recipient deletes the file at its exit, once read. A second message to the same recipient in the same minute appends -2, then -3, to the file name. A message is context, never authorization.

## Task: `tasks/<id>-<slug>.md`

```markdown
id: 003
status: open
from: overlord-web
to: executor-myapp
date: 2026-09-15 13:40
depends: 002
design: docs/design.md

## Request
Add password reset. Files: src/auth/reset.ts (new), src/auth/routes.ts. Do not touch src/auth/session.ts. Done means: a user receives the mail, the link opens the form, the new password works, all three seen in the browser.

## Report
```

`id` is sequential per project, three digits. `status` moves from `open` to `review` when the executor appends the report and the work waits for the requester's look, to `done` when the requester accepts it, and to `closed` when the requester archives it. A task sent back from `review` returns to `open` with what is missing in its Report. Each change is the event hooks listen to. While the task is planned, the protocols whose `scope` covers something the plan actually builds, in the mind and in the installed knowledge modules, are listed in the plan, each next to the item that uses it. Before the Report is written, the user is asked in one line whether to run them, each one named; only the confirmed ones run, what each step produced is appended to the Report, and a declined one is recorded as declined. Roles and features follow this the way they follow the rule about commits and pushes: it is a contract in the text, not something the engine enforces. `depends` and `design` are optional; `design` comes from the brief.

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
```

No paths. Paths are per machine and live in the machine file. The first role that enters a project without a brief writes the header from its audit and asks only what the audit could not answer.

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
- unity: vigilum

## Projects
- myapp (web)
- shop (web)
- vigilum (unity)
- tool

## Minds
- D:\team-mind
```

Names only. `Minds` lists other minds this one can read, when there are any.

## Machine: `machines/<host>.md`

```markdown
machine: SCOUT
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
- vigilum: C:\Users\me\Unity\vigilum

## Excluded
- knowledge
- corpo
```

`setup` is `done` or the number of the next step, so any front resumes. It reaches `done` only when every asset of that run was written, left unchanged or answered for; anything unwritten leaves the number of the install step, so the next run finishes it. `preferences-first` is `yes` by default; `no` puts the HIVEM1ND auto rule before existing preferences while preserving their content. `update-check` is `daily` or `off`. `Excluded` lists the modules and features left out at setup; `/evolve` never installs them.

While `setup` is a number, a temporary `## Setup Draft` section contains a fenced JSON block with the answers collected so far. Every front preserves it when resuming. The section is removed when `setup: done`; completed settings remain in the header and the Agents, Paths and Excluded sections.

The `## Managed Files` section contains a fenced JSON object mapping installed absolute file paths to their SHA-256 content hashes. Setup and updates replace a managed file automatically only while its content still matches the recorded hash. An unowned or locally modified file requires a keep-or-replace choice. Paths and hashes stay private in the machine record. A symbolic link or a Windows junction standing where files have to be written is one choice for every file behind it: replacing it removes the link and keeps the folder it points at, and omitting it leaves those files uninstalled, where the next `check` lists them as missing.

## Install report: `machines/<host>.report.md`

```markdown
machine: SCOUT
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
