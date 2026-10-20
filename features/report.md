---
name: report
description: Investigates a defect or request and writes an evidence-backed task for the project executor without changing code.
category: planning
---

# /report

Mind: {{mind}}
Argument: <text>

Start: Locate in `rules.md` of the mind above.

## Steps

1. Read the text as a defect or a request. Search the repo for the symbols it names, with several spellings; `git grep -n -i -e <name>` runs the same in a POSIX shell and in PowerShell. Open the files found. An empty search counts only with its scope recorded and a positive control: the same search first finds a symbol known to exist.
2. Find the root cause and cite it as file and line. When the cause is not in the code, say where it is, such as configuration, data, the environment or another repo, with the evidence.
3. Create the task with `/task` for the project's executor; `/task` routes it to the lead when the executor has one. The Request holds the cause with file and line, the exact files to change, what not to touch, and what done looks like as checks an agent can verify.
4. Change no code.

## End

- Stops when the task is written, or when no cause is found; then nothing is written.
- Reports the task id and the cause in one line, or what was searched and where when no cause was found.
