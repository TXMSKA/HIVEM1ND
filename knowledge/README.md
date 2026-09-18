# Knowledge modules

Each module is a folder under `knowledge/`. Markdown files in the module contain its knowledge topics.

`INDEX.md` lists what the module holds: one row per protocol, with its scope and its purpose in one line. An agent reads the index, decides which protocols the work needs and opens only those, so a large module costs little to consult.

A `protocols/` folder contains the module's protocols, in the format described in `files.md`. They are read on demand and are never installed as agent commands. A protocol with a scope also runs on its own when a task that touched that scope is closed.

An optional `features/` folder contains commands installed with the module. Its files and folders use the same format as the base `features/` folder. Excluding the module skips its commands, its protocols and its topics.

The base ships three modules: `security`, `design` and `copy`. A user adds private modules the same way, under `user/knowledge/`.
