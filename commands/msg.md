---
name: msg
description: Sends a message to a unit through Relay, or writes it into the unit's inbox when Relay is not available.
---

# /msg

Mind: {{mind}}
Argument: <unit> <text>

Locate the mind and the unit as the Locate section of `{{mind}}/rules.md` says; the formats of the records are in `{{mind}}/files.md`, and the steps name the files without repeating the formats.

## Steps

1. Read the state file of the recipient, in its project, its environment or the root of `user/`. When none exists, report that the unit is unknown, and stop.
2. With the Relay tools, call `send_message` with `to` the unit, `subject` the first line of the text and `body` the text; then report the message id, and stop. A failed call is reported with its error, and the message is not written by hand.
3. Without the Relay tools, in a session the service did not start, write the message file into `inbox/<unit>/` of the recipient's scope, with the filename and the headers of the Message section of files.md: `id`, `from` the current unit, `to`, `machine`, `timestamp`, `date`, `priority: normal`, `subject`, `thread-id` (the `id` for a new thread), `reply-to`, `reply-requested: false`, `attachments: []`, a blank line and the text.
4. A recipient that is `out` reads the message on its next entry; nothing else is done to reach it.
