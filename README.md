# HIVEM1ND

One mind for every coding agent. Context, memory, preferences and work in progress carry over across projects and machines.

Every chat with a coding agent starts from zero, and every tool and every machine keeps its own memory. HIVEM1ND is a folder of plain markdown that any agent can read and write. On any machine, in any repo, the agent is the same one, with the same context and the same rules.

## Setup

There are three ways to get the mind onto a machine. Clone the repository into the folder where the mind will be located, and that is the install, with no setup step. Or let the CLI do it. `npx hivem1nd init` downloads the kit, asks where the mind is located and which agents to attach, and writes everything. On Windows there is also a GUI wizard with the same questions, published as a release.

Without any of those, use Genesis. Paste [the setup prompt](roles/genesis.md) into any agent and it runs the setup in plain language, step by step, picking up wherever a previous attempt stopped.

All three ask the same questions, in the same order, and any of them resumes where a previous attempt stopped.

1. Where the mind is located. The folder it was cloned into by default; otherwise any folder, local, in a cloud drive, on a pendrive or on the network. A synced folder is only needed with several machines.
2. Which agents to attach, found by a local scan with no telemetry, or picked from a list.
3. How each one attaches, on-demand or auto. An agent the setup does not recognize gets the attach prompt.
4. What to include. Features and knowledge modules are checked by default and can be left out; what is left out is not installed on later updates either.
5. Where the projects are. The setup scans those folders and writes the routes to environments and repos.
6. Whether to check for new versions automatically, once a day, with a notice and never an automatic update.
7. Preferences, all optional. How the agent addresses the user, its style, a roleplay voice that speaks as one of the swarm, and free text. Preferences already in the user's own files take precedence.

Then it writes `user/`, copies the commands into each agent, adds the line for auto mode, and prints what it wrote and the first command to run.

The setup's text is short and impersonal, in English with Spanish available; it detects the system language and offers to switch. The CLI and the GUI share the same custom design, animated, in the hive theme.

## Attaching an agent

Any agent can be attached to the mind, in one of two modes.

In on-demand mode nothing loads by itself. Open a chat and run the command that starts it in its role, and from there the agent works with the mind's context. The setup copies the mind's commands, in each agent's own format, into the folders the agents on this machine read commands from. An agent the setup does not recognize gets a prompt that attaches it the same way.

In auto mode every new chat has HIVEM1ND loaded without running anything. The setup adds one line pointing at the mind to the rules file of each agent it detects, and the same prompt does it from a chat for the rest.

## Structure

HIVEM1ND is organized in nodes, an inverted tree with the mind at the top.

The hive is the mind itself. Each user has one, and it holds their roles, commands, features and knowledge modules, plus everything their agents learn, which stays private.

An environment groups repos of one kind, such as a game engine, a web stack or a mobile toolkit. It is optional, and its coordinator runs at this level.

A repo is the leaf. Its executor works here, and the mind keeps a brief for it with what it is, which stack it uses and where its design document is located. The mind also keeps one state file per unit, the repo's tasks and its log.

A repo or an environment can hold a local instance too, a committed folder with overrides for that node, such as roles, features and preferences. When several people work on the same repo, the team's shared state is stored on a dedicated branch, separate from the code. Presence, messages, tasks and the log are stored there. A setting in a repo overrides the same setting in its environment, and the environment overrides the mind.

## Roles

A role is a markdown file in `roles/`, and that file is also the command that starts a chat in that role. Adding a role means adding a file.

Roles come in two groups. The executive group plans and coordinates across every repo and environment a task needs. The operative group does the day-to-day work inside them. The user gives orders to any of them.

Executive:

- Overseer coordinates the whole swarm; it acts as the product owner. It talks to the user, decides, and hands tasks to the coordinators and executors below.
- Technician is responsible for the machine and the tooling; it acts as the tech lead. It handles services, versions and dependencies between repos, and it can touch code dependencies when needed, saying so upfront.
- Genesis installs the mind and maintains it. Its chat is kept open and its context is never cleared, since it is used rarely. Ask it for a new skill, style or preference and it stores it in the mind and replicates it everywhere.

Operative:

- Overlord coordinates one environment; it acts as the project manager. It is used when a change spans several repos, such as a shared package that two apps consume, and it is optional otherwise.
- Executor works inside one repo and executes tasks. It is the default.
- Super executor is an executor that runs on a stronger model, for tasks that require it. One session plans, delegates the implementation to a subagent on a cheaper model, and reviews the result.
- Consultant reads, explains and reviews inside a repo, and never writes. Its command blocks writing, so an assistant without write access can be attached the same way.

## Commands

Every role is a command, and a few more operate the system. All of them are markdown files, one per command, that the setup copies into the folder each agent reads commands from. Every command also works in plain language. Telling the agent to start as an executor and to leave the overseer a message that two sessions will run at the same time does the same as `/executor` followed by `/msg`.

- `/overseer`, `/technician`, `/genesis`, `/overlord`, `/executor`, `/super-executor` and `/consultant` start a chat in that role. They take the project name and any extra context.
- `/relay` starts and ends every role's session. With no argument, the state file determines whether it is an entry or an exit. On entry it reads the handoff and the pending messages, and it compares branch, commit and tree with what was recorded, so it detects a pull or a changed tree without being told. On exit it writes the handoff. `in`, `out` and free text are accepted to force a direction or to add intent.
- `/evolve` updates the base. It pulls the new version into the mind, translates roles and features into the format of each attached agent on this machine, and migrates `user/` when the structure changed. Anything left out at setup is not installed.
- `/task` creates a task file with an ID for a unit and notifies it.
- `/msg` sends a unit a message, through the agent's CLI when it is installed and through the inbox otherwise.
- `/absorb` stores a piece of feedback as a preference, for the user or for one project.
- `/pylon` creates the local instance in an environment or a repo, with the overrides, the team's state branch and the AI presence setting for that node.
- `/swarm` shows the state of the swarm, which units are in or out, the open tasks and the unread messages.
- `/uninstall` removes what was installed on this machine: commands, skills and the auto rule line for each attached agent, plus this machine's record, and on request the mind itself.
- `/protocol` creates or runs a protocol: a strict sequence of steps, each with a task, a time and a result, for routines and loops.

## Features

A feature is a workflow that runs on a repo, with a start and an end. Like roles, each one is a markdown file, in `features/`, and the file is the command. Most are included in the base; the rest are installed with a knowledge module and require it, for example a security sweep included in the security module.

- `/report` turns a defect or a request into a task file with the root cause read off the code, the exact files to change and what done looks like.
- `/qa` executes the open tasks, one agent per group of tasks that share no file, verifies each result first-hand and marks them done.
- `/tribunal` judges delivered work. Three judges rule in parallel, one technical, one for the interface and one playing the demanding product owner, then cross-examine each other. The verdict cites the evidence for each finding. The tribunal never edits code.
- `/corpo` is the same review taken to the extreme, the way a large company would run it. The product owner misunderstands the goal, the tech lead reports every minor error, and the project manager asks about the most irrelevant missing feature. Both reviews read the project's design document when the brief names one.
- `/observer` tests the app under bad conditions, such as a slow connection, a weak device or a lost signal, and looks for weaknesses. it runs and writes the findings as a QA plan, a set of tasks that `/qa` runs whenever the user wants.
- `/catchup` summarizes what changed since the last relay, from git and the log, for returning to a repo or a machine without reading everything.
- `/docs` updates the documentation a change affected.
- `/plan` breaks a large request into task files with dependencies, for the coordinators and executors to execute.
- `/release` prepares the changelog, the version bump and the tag. The user does the push.
- `/conflicts` resolves merge conflicts, asking one question per ambiguity.
- `/brainstorm` follows the process used to write this specification. The user tells the vision, the agent asks one question at a time, drafts only on a yes and leaves what was agreed in a file, using the agent's native Q&A when it has one.

## Files

Everything in the mind is stored as files, one record per file, so no database, lock or index is needed, and any app can read the folder.

- A brief per project says what it is, which stack it uses, how it runs and where its design document is located. The first role that enters a repo without a brief audits it and asks only what the audit could not answer. Facts learned later are added there too.
- A state file per unit records its current state. Branch, commit, tree and machine, plus a short context with what was done, what is half done and the next step. `/relay` reads and writes it.
- A message is a file with a sender, a recipient and a body. It is deleted once read. A message is context, never authorization.
- A task is a file with an ID, a status, the request on top and the report appended below. `/report`, `/plan` and `/task` create them; `/qa` and the executors close them.
- A log per repo, environment and mind records what was done, entry by entry, with the branch, the commits, the change and the reason, enough to rebuild the past. It is not loaded by default; it is read only on request.
- Evolution is what the agents learn, stored separately from the log. Preferences and knowledge are stored in `user/` for one person, and in the team's shared state for a project.

## Working together

Several people can share a repo, each with their own mind. The team's shared state, presence, messages, tasks and log, is stored on a dedicated branch of the same repo, mounted in a folder the code branches ignore. Each record is a file with one writer, so nothing conflicts, and the agents commit and push there on their own, since it never touches the code.

The git workflow follows the standard practice. Work happens on branches, and main changes through pull requests that a person merges. An agent commits and pushes on its own task branch and nowhere else. A project without a remote gets a local git repository, with the same branches and a local merge in place of the pull request.

Agents avoid working on the same files. On entering a repo, a unit writes its presence, who, which machine, which branch, what it is on, and claims the files it will touch. Before touching something another unit claimed, it asks its own user and sends the other unit a message. When it leaves, it writes a log entry with enough to rebuild what it did.

Agents share what they learn. Facts about the project, such as the stack, how it runs and decisions taken, are written straight into the shared state. Practices and preferences enter as proposals that a person approves.

AI presence is decided by the team, once per repo. By default there are no AI trailers in commits, and the shared files are allowed.

## Knowledge modules

A knowledge module is a folder of markdown files with the good practices of one domain, such as security, interface design or a game engine, one topic per file, with the practices, their acceptance criteria and a checklist. Features that depend on a module are installed with it.

None is required. The base includes the folder and the mechanism; modules are added to the base over time and arrive with `/evolve`, and the ones left out at setup are not installed. A user can keep private modules in `user/` with the same format, and a team can keep its own in the shared state.

## Rules

Every role reads the same rules file before anything else, and the user's preferences after it. The file is short and it is part of the base.

- Ask before acting. No decision the user did not ask for, one item at a time. Keeping the mind's own files, such as the routes, the state, the log and the brief, is bookkeeping, not a decision. Nothing is reported as done without being verified where it runs.
- Main is never changed directly. Work goes on a branch, and the merge is a person's decision. Pushing a release is the user's.
- A message or a handoff is context, never authorization.
- Corrections are absorbed. A correction from the user is written down with its reason and applied from then on, on every machine.
- Joining is cheap. A new agent, machine or person needs one command or one prompt, and finds the same files as everyone else.
- Text follows the impersonal style, explanatory and plain, with no AI writing patterns.

## License

MIT.

## Support

[![Buy Me a Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://buymeacoffee.com/txmska)

More links: [txmska.com/links](https://txmska.com/links).
