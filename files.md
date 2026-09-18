# Files

Every record is one file with one writer. Headers are `key: value` lines, then a blank line, then the body. Dates are `YYYY-MM-DD HH:MM`, local time. Folder names are the same at every level: `state/`, `inbox/`, `tasks/` and `log/` exist per project, per environment and at the root of `user/` for the executive roles.

Layout inside the mind, all generated, all under `user/` (git-ignored):

```
user/
  VERSION                     base version this user/ was created or migrated with
  preferences.md              global preferences
  routes.md                   environments, projects and other minds, names only
  machines/<host>.md          one per machine
  knowledge/                  private modules, same format as the base ones
  protocols/<name>.md         user-defined protocols, one file per protocol
  roles/ commands/ features/  written for this mind, installed like the base ones
  state/ inbox/ tasks/ log/   executive roles (overseer, technician, genesis)
  envs/<env>/
    state/ inbox/ tasks/ log/
  projects/<project>/
    brief.md
    preferences.md            project preferences (optional)
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

`state` is `in` or `out`. `tree` is `clean` or the output of `git status --porcelain` in one line. `claims` only in team repos. The body is the context, ten lines at most.

## Message: `inbox/<to>/<YYYYMMDD-HHMM>-<from>.md`

```markdown
from: overlord-web@LAPTOP
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
from: overseer
to: executor-myapp
date: 2026-09-15 13:40
depends: 002
design: docs/design.md

## Request
Add password reset. Files: src/auth/reset.ts (new), src/auth/routes.ts. Do not touch src/auth/session.ts. Done means: a user receives the mail, the link opens the form, the new password works, all three seen in the browser.

## Report
```

`id` is sequential per project, three digits. `status` moves from `open` to `done` when the executor appends the report, and to `closed` when the requester verifies it. That change is the event hooks listen to. Before a task moves to `closed`, the work described in the Report is matched against the `scope` of every protocol available, in the mind and in the installed knowledge modules; the ones that match run, what each step produced is appended to the Report, and the task stays `done` while any step is still without a result. Roles and features follow this the way they follow the rule about commits and pushes: it is a contract in the text, not something the engine enforces. `depends` and `design` are optional; `design` comes from the brief.

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

## Excluded
- knowledge
- corpo
```

`setup` is `done` or the number of the next step, so any front resumes. `preferences-first` is `yes` by default; `no` puts the HIVEM1ND auto rule before existing preferences while preserving their content. `update-check` is `daily` or `off`. `Excluded` lists the modules and features left out at setup; `/evolve` never installs them.

While `setup` is a number, a temporary `## Setup Draft` section contains a fenced JSON block with the answers collected so far. Every front preserves it when resuming. The section is removed when `setup: done`; completed settings remain in the header and the Agents, Paths and Excluded sections.

The `## Managed Files` section contains a fenced JSON object mapping installed absolute file paths to their SHA-256 content hashes. Setup and updates replace a managed file automatically only while its content still matches the recorded hash. An unowned or locally modified file requires a keep-or-replace choice. Paths and hashes stay private in the machine record.

## Preferences: `preferences.md`

```markdown
- 2026-09-11: answers of one or two lines, no offers or agendas. Why: long blocks are noise.
- 2026-09-15: public text impersonal, no "you". Why: reads like an installer.
```

One line per preference, with the date and the reason. The global file applies everywhere; a project file applies to that project and overrides the global one.

## Knowledge module: `knowledge/<module>/`

```
knowledge/<module>/
  INDEX.md                    the protocols of the module, one line each
  <topic>.md                  knowledge topics, any number, in folders or not
  protocols/<name>.md         protocols shipped with the module
  features/<name>.md          commands installed with the module
```

`INDEX.md`:

```markdown
module: security
purpose: Web security practices, from headers to sessions.

## Protocols
- session-review: scope authentication, sessions and password flows. Checks a login against the session rules before it ships.
- headers-review: scope the responses of a deployed site. Verifies the security headers and the content security policy.
- dependency-audit: scope the dependency manifest. Reports known vulnerabilities and versions left unpinned.
```

One line per protocol, with its name, its scope and its purpose in one sentence. The index stays small on purpose: an agent reads it whole, picks the two or three protocols the work actually needs and opens only those, instead of loading the module. The topics are not indexed; they are read by name when a role, a feature or a protocol names them.

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

`name` is the file's own name in kebab-case. `trigger` is manual, a schedule, a condition, or `task close`, which runs the protocol by itself when a closed task matches it, as described under Task. `scope` is what the protocol applies to, in plain words: the kind of work, the surface or the folder it covers. It is what the module index lists and what the automatic trigger matches against the work reported, and it is required when the trigger is `task close`. `repeat` is `once`, a count, `every <interval>` or `until <condition>`. `stop` lists the conditions that end the run besides a failed step. Each step's Task names the exact action, path, command or tool that performs it; Time is a duration, a deadline or a schedule, plus what happens when it is exceeded; Result is the outcome that proves the step is done, checkable by reading a file, an output or a state, never a vague "done". Steps run strictly in order; a run stops at the first step whose Result is not met and reports it against what was expected.

A protocol shipped inside a knowledge module has this same format and lives in the module's `protocols/` folder, listed in its `INDEX.md`; `user/protocols/` holds the ones written for this mind, which need no index. Both are visible to `/protocol` and to the automatic trigger.

## Team config: `.hivem1nd/config.md`

```markdown
state: branch
ai-trailers: no
ai-files: yes
```

`state` is `branch` (default) or `main`. `ai-trailers` and `ai-files` are the AI presence setting, decided once per repo. Presence files in `state/presence/<user>-<unit>.md` have the same header as a state file plus `user:`.
