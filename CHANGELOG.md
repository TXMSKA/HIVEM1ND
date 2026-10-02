# Changelog

## 1.3.0 - 2026-10-02

- The design pack designs light themes instead of inverting dark ones: a `light-themes.md` topic and a `light-theme` protocol that read the source palette by the job of each colour, pick a dim, soft, standard or crisp contrast character, tint an off-white ground toward the neutral hue, keep white for raised layers outside the dim character, give each accent a text, a fill and a tint value at the lightness its floor needs, keep saturated colour to small areas, and judge both themes side by side. A light theme subcategory joins foundations.
- Switching machines takes one command on each side. The exit of `/relay` commits and pushes everything uncommitted in the repos of the unit's scope, on a new branch when the changes sit on the default branch, writes a state that resumes on another machine with nothing else, and clears the conversation; running it is the yes for those commits and pushes. The entry fetches, brings each repo to the branch recorded on exit and fast-forwards it, stopping only on uncommitted changes or a branch that cannot fast-forward, and asks for the yes to continue the half-done work. The scope is the current repo for a role in one repo, the environment for the Overlord and every project for the Overseer; a unit with several repos records each one in a `## Repos` section of its state.
- Present plays a Blueprint Lite board as a prototype: one screen at a time, fitted to the window, where a click on a control a link leaves from opens the screen it leads to. A click that misses lights the controls that lead somewhere, Back and Backspace return to the previous screen, and Escape goes back to the board.
- A Blueprint Lite screen can carry its own `note`. A click on the screen shows it in the note over the canvas, and a click on the empty canvas brings the board's note back.
- Blueprint Lite kit extension points: a repository adds its own icons (`docs/flows/kit/extra-icons.mjs`) and node types (`docs/flows/kit/extra-nodes.mjs`, measure and draw) over the shared kit without keeping a copy of `kit.mjs`.
- Blueprint Lite, the `/blueprint` feature: one local server per machine, on port 3300, draws the screen-flow boards of every project at once. Projects come from the mind (the machine record's paths and the routes), a project shows in the viewer when its repository has `docs/flows/boards/index.json`, and the comments made in the viewer are written to that repository's `docs/flows/comments/<board>.json`, where agents read them. The board and comment formats are documented in the feature. It ships as a folder with its scripts, and it is a temporary tool that the full Blueprint replaces. The shared kit measures text in the faces and weights of the skin it is drawn in, and follows the repository engines for three-value padding, stretched fixed-size children and dialog shadows, so a repository can drop its own `kit.mjs`.
- A feature folder is listed by its category in the content step of the installer, the same as a feature file.
- Manager, a new operative role: it talks the work through with the user, writes the task, hands the implementation and its QA to subagents or to another agent through its command-line interface, and reviews the result. It runs on a strong model at low or medium effort and names the effort a task needs before raising it.
- Tasks gain a `review` status between `open` and `done`: the executor sets it when it appends the report, the requester sets `done` on accepting the work and `closed` on archiving it. The swarm command counts tasks in review.
- The entry report of every role and of the relay command is laid out one block per fact, each led by a contextual icon, with the findings of the check first.
- Every role works without progress updates and reports once, when the work is done, with what was done and what is pending.

## 1.2.0 - 2026-09-21

- An install is never reported as done over files it did not write: a symbolic link or a Windows junction standing where files belong stops the run and asks, replacing the link by default and keeping the folder it points at, with omitting available as an explicit choice.
- Every install, attach and update writes `user/machines/<host>.report.md` with what it wrote, omitted or replaced.
- Attaching a machine is its own flow: a mind already installed is detected, simple mode attaches to it and custom mode asks at the mind location step, leaving the mind's content, preferences and version untouched.
- Roles, commands and features in `user/roles`, `user/commands` and `user/features` install like the ones the kit ships, so a role private to one mind stays out of the published folder.

## 1.1.1 - 2026-09-18

- OpenCode and VS Code attach in auto mode without manual steps: the rules line goes into the OpenCode global rules file and into a VS Code user instructions file.
- The attach prompt names the literal mind placeholder to replace instead of the mind path.
- Executor, Super executor and the plan command read the knowledge modules while planning, and write the build rules of the categories a task touches into the task as requirements.
- Protocols are a confirmation instead of a silent run: planning lists the ones whose scope matches the work, and each runs before the report only with the user's yes. The protocol command also lists the protocols of the knowledge modules.
- Executor delegates the implementation by default: the plan is split into pieces that share no file, each sent to a subagent on the next cheaper model and reviewed against the plan, with small pieces grouped into one brief. Pieces run one after another on the task branch, and only parallel pieces get their own worktree. A single concrete change, or the user saying so, is implemented directly. Super executor follows the same method.
- Local protocols per project in `user/projects/<project>/protocols/`, used only while that project is the current one, next to the global ones in `user/protocols/`.

## 1.1.0 - 2026-09-17

- Three chat roles that work from the mind alone, without a shell or a repository: executive decisions, technical direction and marketing.
- Security, design and copy knowledge modules, each with the command it installs: a security audit, a design and interface pass, and a rewrite of copy that reads as written by an AI, whole or scoped to one feature.
- Knowledge modules with an index of their protocols, so an agent loads the ones the work needs instead of the module.
- Protocols that run by themselves when a task is closed, matched against the work by their scope.
- Migration command, absorbing the rules, memories and notes an agent or a repository already holds, and leaving every original untouched.
- Roles, commands and features written inside the mind installed for every attached agent.

## 1.0.0 - 2026-09-15

- Shared rules, record formats, seven roles and example mind and team records.
- Relay, task, message and preference commands.
- Genesis setup and generic attachment for agents without an adapter.
- Shared setup engine with local discovery, resumable steps and reviewed installation.
- English and Spanish terminal setup and local browser wizard.
- Base updates, migrations, team state and swarm status commands.
- Eleven project workflows, including reports, QA, reviews and release preparation.
- Windows desktop setup application.
- Uninstall command and kit script, removing managed commands, skills, rule lines and the machine record, with a dry run and an optional mind removal.
- Markdown checks, engine tests, package checks and Windows release workflow.
