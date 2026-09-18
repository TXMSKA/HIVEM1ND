---
name: cyberattack
description: Attacks the application it is pointed at, or the feature named, running the security protocols that apply and writing each finding as a ranked task with its evidence.
category: quality
---

# /cyberattack

Mind: {{mind}}
Argument: [feature or surface]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

Read [rules-of-engagement.md](../rules-of-engagement.md) before anything else and hold it for the whole run. The pass touches only the application it was pointed at, on a deployment the project owns. It never enters a password, a key, a card number or a one-time code anywhere, never authenticates as a real user, and never creates, changes or deletes production data. A finding is written down when the evidence proves it, and never chained further to demonstrate impact.

## Steps

1. Resolve the subject and say which reading was taken. With no argument the subject is the whole application. With an argument the subject is that feature, view, endpoint group or surface. Name the subject and the deployment address in one line before doing anything else.

2. With no argument, ask before starting. A whole-application pass runs every protocol in the module against every surface, takes hours and costs accordingly. Say so in one line with what it will cover, and wait for a yes. No file is read and no request is sent before the answer arrives. With an argument, this step is skipped: a feature pass is bounded and starts immediately.

3. Map the subject before picking anything. For a feature, read what it actually contains: its routes, its handlers, its queries, its outbound calls, its uploads, its model calls, its dependencies and its configuration. For a whole application, take the route table, the manifest, the lockfile and the deployment configuration. This is a read pass; nothing is tested yet.

4. Pick the protocols from what the map holds. Read [INDEX.md](../INDEX.md) and match the map against the second column. A whole-application pass runs the protocols in the order the index gives them, which starts at the version floor and the secrets because a finding there changes what the rest of the pass means. A feature pass runs only the protocols its map matched, and names them in one line with the thing in the map that selected each. Reading the whole module is a failure of this step, not thoroughness.

5. Write the plan before sending a request. Name the surfaces in scope, the protocols chosen, the accounts to be created for the test, the deployment to be used, and what is explicitly out of scope. A feature pass writes this plan whatever its size. No test runs before the plan exists.

6. Run each protocol's steps in order and report as each protocol closes, not at the end. A run that reports only at the end hides a P0 for hours. Each protocol's findings go out as soon as that protocol finishes, ranked by the scale in [evidence.md](../evidence.md), and a P0 goes out the moment it is confirmed without waiting for the protocol to close. A step that could not be run is reported as not run, with the reason.

7. Write every finding as a task for the project, one task per finding, using the task format in `files.md`. The Request names the location, the rank, the evidence that proves the finding, the fix, and the artifact that would prove it fixed. A finding whose fix cannot be verified by the same kind of artifact that found it is incomplete and says so. Tasks are ordered by rank, and the P0 tasks carry no dependencies so nothing blocks them.

8. Clean up and close. Remove the test accounts, the uploaded files and the records the pass created, and list anything that could not be removed by name. Then report the numbers: protocols run, surfaces covered, findings by rank, steps not run with their reasons, and the decisions left for a person with what each one needs in order to be decided.
