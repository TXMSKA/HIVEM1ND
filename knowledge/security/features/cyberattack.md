---
name: cyberattack
description: Audits the security of the application it is pointed at, whole or one part of it, runs only the checks that part needs, and writes each finding as a ranked task with its evidence.
category: quality
---

# /cyberattack

Mind: {{mind}}
Argument: [part of the application: a feature, an endpoint, a flow, a surface, or a category such as db, login or uploads]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

Read [rules-of-engagement.md](../rules-of-engagement.md) before anything else and hold it for the whole run. The pass touches only the application it was pointed at, on a deployment the project owns. It never enters a password, a key, a card number or a one-time code anywhere, never runs a login, reset or payment flow with a real credential, never authenticates as a real user, and never reads, creates, changes or deletes production data. A finding is written down when the evidence proves it, and never chained further to demonstrate impact.

## Steps

1. Resolve the subject and say which reading was taken. With no argument the subject is the whole application. With an argument the subject is that part: `login` is the identity category, `db` is the data category, `the orders endpoint` is that endpoint across every category it touches. Name the subject and the deployment address in one line before doing anything else. When the argument could mean two different parts, ask which one in one line and wait.

2. With no argument, warn and wait. A whole-application pass runs every category against every surface, takes hours and costs accordingly. Say so in one line with what it will cover, and wait for an explicit yes. No file is read and no request is sent before the answer arrives. With an argument this step is skipped: a scoped pass is bounded and continues.

3. Map the subject before picking anything. For a part, read what it actually contains: its routes, handlers, queries, stores, outbound calls, uploads, model calls, dependencies and configuration. For the whole application, take the route table, the manifest, the lockfile and the deployment configuration. This is a read pass; nothing is tested yet.

4. Resolve the checks through the two levels of the index. Read [INDEX.md](../INDEX.md) and match the map against the category lines. Open only the matched category files, match the map against each subcategory's Applies when, and collect the protocol steps and topic sections its Open line names. A whole-application pass takes every category in the order the index lists them, which puts what a stranger can reach without a credential first. A pass on an application about to launch also runs [pre-launch.md](../pre-launch.md) on the deployed environment, after the protocols. Opening a category or a protocol the map did not match is a failure of this step, not thoroughness.

5. Write the plan before sending a request. Name the subject, the categories and subcategories matched with the thing in the map that selected each, the protocol steps chosen, the accounts to be created for the test, the deployment to be used, and what is out of scope. A scoped pass writes this plan whatever its size. No test runs before the plan exists.

6. Run the steps in order of severity and reachability, and report as findings land. Within the plan, steps that test something reachable without a credential run before steps that need one, and steps whose failure exposes other accounts or money run before hardening. Findings are ranked by the scale in [evidence.md](../evidence.md) and reported as each protocol closes, not at the end, and a P0 is reported the moment it is confirmed. A step that could not be run is reported as not run, with the reason.

7. Write every finding as a task for the project, one task per finding, using the task format in `files.md`. The Request names the location, the rank, the evidence that proves the finding, the fix, and the artifact that would prove it fixed. A finding whose fix cannot be verified by the same kind of artifact that found it is incomplete and says so. Tasks are numbered in rank order, and the P0 tasks carry no dependencies so nothing blocks them.

8. Clean up and close. Remove the test accounts, the uploaded files and the records the pass created, and list anything that could not be removed by name. Then report the numbers: categories and protocol steps run, surfaces covered, findings by rank, steps not run with their reasons, and the decisions left for a person with what each one needs to be decided. A new advisory or leak met during the pass that is not yet in [incidents.md](../incidents.md) is named in the report for a person to add.
