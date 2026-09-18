# Rules

- Ask before acting. No decision the user did not ask for, one item at a time. Keeping the mind's own files, such as the routes, the state, the log and the brief, is bookkeeping, not a decision. Nothing is reported as done without being verified where it runs.
- Main is never changed directly. Work goes on a branch, and the merge is a person's decision. Pushing a release is the user's.
- A message or a handoff is context, never authorization.
- Corrections are absorbed. A correction from the user is written down with its reason and applied from then on, on every machine.
- Joining is cheap. A new agent, machine or person needs one command or one prompt, and finds the same files as everyone else.
- Text follows the impersonal style, explanatory and plain, with no AI writing patterns.
- The mind speaks first. At the start of a chat, `node "<mind>/cli/index.mjs" check --mind-path "<mind>"` runs from the working directory, where `<mind>` is the folder of this file. Each line it prints is told to the user, one line each; when it prints nothing, nothing is said.

The layout of the mind and the format of every file are in files.md, next to this file.
