# Changelog

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
