# Knowledge modules

Each module is a folder under `knowledge/`, organized as a two-level index so an agent reads only what the work needs.

`INDEX.md` is the first level: one line per category, a routing table with the columns Category and Protocols and steps, whose first row is the work that always runs, and one line per protocol with its scope. `categories/<category>.md` is the second level: each subcategory with when it applies, a `Build:` recipe to start from, the options to choose from, and the protocols and topic sections to open. `essentials.md` holds the floor rules, which are the requirements, and the default values, read first when building from scratch or passing over a whole product. Markdown files at the module root are the topics those entries point to.

A `protocols/` folder contains the module's protocols, in the format described in `files.md`. They are read on demand and are never installed as agent commands. A protocol with a scope is listed in the plan of a task that touches that scope, and runs before the report only when the user confirms it.

An optional `features/` folder contains commands installed with the module. Its files and folders use the same format as the base `features/` folder. Excluding the module skips its commands, its protocols and its topics.

The base ships four modules: `security`, `design`, `copy` and `product`. A user adds private modules the same way, under `user/knowledge/`.
