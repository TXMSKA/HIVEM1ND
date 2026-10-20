---
name: task
description: Creates a task file with the next id for a unit and leaves it a message that the task is ready.
---

# /task

Mind: {{mind}}
Argument: <unit> <text>

Locate the mind and the unit as the Locate section of `{{mind}}/rules.md` says; the formats of the records are in `{{mind}}/files.md`, and the steps name the files without repeating the formats.

## Steps

1. Read the state file of the target unit. When none exists, report that the unit is unknown, and stop. When its state names a lead other than the current unit, the task goes to that lead, which hands it over: `to` is the lead, and the Request opens with `For <unit>.`
2. Find the `tasks/` folder of the scope of the `to` unit: its project, its environment or the root of `user/`.
3. Take the highest id present plus one, three digits, and a slug from the first words of the text.
4. Write the task file with the headers of the Task section of files.md: `id`, `status: open`, `from` the current unit, or `user` when the person dictates the task, `to`, `date`, and `depends`, `design`, `requirements` and `work` when the text or the brief provide them; then the text as the Request section and an empty Report section. A session that cannot write the mind stops here and reports the task text, as rules.md says.
5. Tell the `to` unit that the task is ready: with the Relay tools, `send_message` with the subject `task <id> is ready` and one line pointing at the file; without them, the message file of `/msg`. The message waits when the unit is out.
