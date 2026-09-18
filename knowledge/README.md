# Knowledge modules

Each module is a folder under `knowledge/`, organized as a two-level index so an agent reads only what the work needs.

`INDEX.md` is the first level: one line per category and one line per protocol with its scope. `categories/<category>.md` is the second level: each subcategory with when it applies, the options to choose from, and the protocols and topic sections to open. Markdown files at the module root are the topics those entries point to.

A `protocols/` folder contains the module's protocols, in the format described in `files.md`. They are read on demand and are never installed as agent commands. A protocol with a scope also runs on its own when a task that touched that scope is closed.

An optional `features/` folder contains commands installed with the module. Its files and folders use the same format as the base `features/` folder. Excluding the module skips its commands, its protocols and its topics.

The base ships three modules: `security`, `design` and `copy`. A user adds private modules the same way, under `user/knowledge/`.
