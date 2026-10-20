# Genesis setup

The setup Genesis runs while `setup` in `user/machines/<host>.md` is not `done`. Each step asks the question its number has in the Setup questions of [genesis.md](../genesis.md#setup-questions). After every step, the machine file is written with `setup:` set to the next step, so any front resumes there; the collected answers stay in its `Setup Draft` section, as [files.md](../../files.md#machine-machineshostmd) defines it, which every front preserves and the last step removes. The app and `hivem1nd init` run their own wizard; this file is the path for an agent with nothing installed.

## Steps

1. Language. Detected from the system; the question offers the other language.
2. Mind location. Two options: this folder, the default when the kit was cloned, or another folder given as a path. Any folder works: local, a cloud drive, a pendrive or a network location. When another mind is found in the chosen folder, its path is added to the routes without asking. The kit's own `fixtures/` folder is never a mind.
3. Discovery. Two options: scan this machine or select agents, then one item per agent to check, plus another agent, which shows the attach prompt at the end. Detection follows the [Adapters](../genesis.md#adapters).
4. Attach mode. For each selected agent, two options: on demand, running a command in the chat, or auto, where every new chat loads it.
5. Include. One item per feature in `features/` and per knowledge module in `knowledge/`, all checked by default, listing what those two folders actually contain; a folder that holds nothing besides a README is said so and skipped. Unchecked items go to `Excluded` in the machine file.
6. Projects. One or more folders. The scan covers four folder levels; deeper repositories need a closer parent folder. It finds git repositories, a folder with a `.git` inside, and guesses an environment per repo from its stack: a `ProjectSettings` folder means unity, a `package.json` means web, otherwise none. The result is shown to confirm or rename, then written to `user/routes.md` and the `Paths` section of the machine file.
7. Update check. The choice is recorded as `update-check` in the machine file.
8. Preferences. All optional and skippable as a block: the address style, free additional instructions, and, when preference files of an agent already exist, whether to keep them first.
9. Install. List the files and paths, resolve each conflict, and ask the question of this step. On a yes:
   1. Write the files of files.md: `user/VERSION` with the version of the kit's `package.json`; `user/preferences.md` with one line per answer of step 8, each with the date and "Why: chosen at setup", left empty when the block was skipped; `user/routes.md`; and `user/machines/<host>.md`, with `language:` from step 1.
   2. Copy the commands into each selected agent by the Copy scope of [genesis.md](../genesis.md#copy-scope), recording each installed file with its SHA-256 hash in `machines/<host>.managed.json`.
   3. For each agent in auto mode, add the rules line in the selected preference order: `HIVEM1ND: the mind is at <path>. Read <path>/rules.md first, then the role or command asked for.` The machine header records `preferences-first: yes` or `no`: yes places the line after existing preferences, no places it before them, and neither removes their content.
   4. Join the clients to Relay by the [Relay join](../genesis.md#relay-join).
   An existing command that is unowned or changed since installation is a conflict in the list, and it needs an explicit keep-or-replace choice before anything is written.
10. Done. Show the question of this step, then the attach prompt for the agents without adapter, if any, then write `setup: done` and remove the `Setup Draft` section.

The setup stops at a step whose write fails, keeps `setup:` at that step and reports it, so the next run resumes there.
