# Knowledge modules

Each module is a folder under `knowledge/`, organized as a two-level index so an agent reads only what the work needs.

`INDEX.md` is the first level: one line per category, a routing table from each category to the protocol steps it uses, and one line per protocol with its scope. `categories/<category>.md` is the second level: each subcategory with when it applies, a `Build:` recipe for getting it right the first time, the options to choose from, and the protocols and topic sections to open. `essentials.md` holds the floor rules and default values, read first when building from scratch or passing over a whole product. Markdown files at the module root are the topics those entries point to.

A `protocols/` folder contains the module's protocols, in the format described in `files.md`. They are read on demand and are never installed as agent commands. A protocol with a scope is listed in the plan of a task that touches that scope, and runs before the report only when the user confirms it.

An optional `features/` folder contains commands installed with the module. Its files and folders use the same format as the base `features/` folder. Excluding the module skips its commands, its protocols and its topics.

The base ships three modules: `security`, `design` and `copy`. A user adds private modules the same way, under `user/knowledge/`.
