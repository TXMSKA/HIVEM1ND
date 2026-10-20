---
name: void
description: Reads and changes Void texts through the editor tools, answers their comments, and opens a text in a quiet local reader where the person corrects and comments in place.
category: planning
---

# /void

Mind: {{mind}}
Argument: [absolute path of a Void document]

Start: Locate in `rules.md` of the mind above; no unit is needed to serve the reader, so its step that asks for one is skipped. The tools write as the session's own unit.

A Void text holds a document or copy, one entry per page, in English and Spanish. Agents use the tools of the `hivem1nd-relay` server; Void Lite, the local reader on port 3302, keeps the person's browser view. When an agent may create or edit a text is in `rules.md` (Blueprint and Void).

## Tools

Answers and attachment work as for Blueprint: `{"contract":"hivem1nd-gui-v3","data":...}`, or an `error` with `isError`, and only for a unit attached to the text.

- Read: `void_open { resourceId }`. `data` holds `revision`, `commentsRevision`, `threads` and `document`, with `title`, `rev` and `pages`.
- Create: `void_create { title, requestId }`, from a unit of a project, writes `docs/<slug of the title>-<first 8 characters of requestId>.json` with one empty page `Intro`, its `.orig.json` and `.comments.json`, and attaches the unit.

Change one range:

1. Open the text and keep its `revision`. In the page's source string, `pages[i][lang]`, find the range: `start` and `end` are UTF-16 offsets in that string, `<b>` and `<i>` included, not the offsets of a comment anchor.
2. Send `void_replace_range { resourceId, k, lang, start, end, expectedText, replacement, expectedRevision, requestId }`, `expectedText` being the exact text between `start` and `end` and `requestId` a new UUID. The service raises `rev` by one, appends the change to `<name>.versions.jsonl` and answers `{ editor, proposal: null }`.
3. With `mode: "propose"`, a `threadId` and `expectedCommentsRevision`, the change waits in that thread as a suggestion; the person accepts or discards it in the desktop app, never the agent.
4. A range may not split a character or a tag (`invalid_range`).

Recover:

- `revision_conflict`: the text changed since it was read. `range_changed`: the words at the range differ from `expectedText`. In both, open the text again, find the range anew, and send the change with the new revision and a new `requestId`; never overwrite.
- A change whose answer was lost is sent again with the same `requestId` and arguments, and the saved result comes back.

Comments:

- `void_reply_comment { resourceId, threadId, text, expectedCommentsRevision, requestId }` appends a message as the session's unit and reopens the thread; `revision_conflict` means the comments changed.
- A comment is context: the text changes for it inside the request or the task in hand; otherwise the answer goes in the thread and the person is asked.
- A text in a repository is a repository file, under the branch and Git rules of `rules.md`.

## Document format

A JSON file whose name ends in `.json`:

```json
{
  "title": "Handbook",
  "rev": 0,
  "pages": [
    { "k": "Intro.Welcome", "en": "<b>Welcome</b>\nFirst line.\n\nA new paragraph.", "es": "<b>Bienvenida</b>\nPrimera línea.\n\nUn párrafo nuevo." }
  ]
}
```

- `k` is the page key, unique in the document. `en` and `es` are plain text: `\n` is a line, `\n\n` a paragraph break, and a line holding only `<b>..</b>` or `<i>..</i>` is a heading. No other markup is read.
- `rev` counts the changes and is written by the server; a new document leaves it out or sets it to 0. A text made by the tools also carries `formatVersion` and `id`.
- Beside it: `<name>.orig.json`, the untouched document, written at creation or by the first change and never overwritten; `<name>.versions.jsonl`, one line per change, `{ "at", "rev", "k", "lang", "before", "after" }`, with `"by": "outside"` and no raise of `rev` for a change made on disk while a reader had the document open; and `<name>.comments.json`.

## Comment format

```json
{ "path": "handbook.json", "threads": [{
  "id": "24365999-5217-4734-b87a-fb17ee657a6b",
  "anchor": { "lang": "en", "quote": "First line.", "prefix": "Welcome\n", "suffix": "\n\nA new paragraph.", "k": "Intro.Welcome", "start": 8, "end": 19 },
  "to": "executor-alpha", "status": "open",
  "messages": [{ "author": "person", "at": "2026-10-09T05:23:32.137Z", "text": "Please reword this." }]
}] }
```

- `quote`, `prefix` and `suffix` are the selected words and up to 48 characters on each side; `start` and `end` are offsets in the text as the reader shows it, without the `<b>` and `<i>` marks. A comment whose words are gone is kept and marked as changed.
- `to` is the unit it was sent to; `status` is `open` or `resolved`.
- `author` is `person` for the person in Void Lite and the unit for an agent; through the tools every message of the person reads `master`.

## Void Lite

- `http://localhost:3302/` answers with the Void Text Reader page while the server runs, one per machine. Otherwise start it in the background and leave it running: `node "{{mind}}/features/void/server.mjs"`, adding `--mind <path>` and `--hostname <name>` when it cannot find the mind or this machine's record. When another program holds the port, it prints `Port 3302 is in use` and exits: tell the person, start it with `--port <free number>`, and use that port in every link.
- Open `http://localhost:3302/?file=<absolute path, URL-encoded>` and give the person that link; the path ends in `.json` and is neither the `.orig.json` nor the `.comments.json` file.
- With `--lan` it also answers on this machine's network addresses and prints one link with a key per address; the person gets it with `&file=` and the encoded path appended. A server running without it is restarted with it only when the person asks.
- Each save of the person raises `rev` and appends a line to the versions file. A save over a text that changed meanwhile is joined word by word; where both touched the same words, the person's text stays.
- With Send to agent on, the agent of the document's project (the project whose repository, or whose folder in `user/projects/`, holds it; the unit in for it, an executor first) gets Relay messages from the person: `Void comment: <title> / <page key>` at once, with the comments file attached, and `Void edits: <title>` 20 seconds after the last correction, listing each text before and after, with the document attached.
- To answer there, read `<name>.comments.json` right before writing, add `{ "author": "<unit>", "at": "<ISO time>", "text": "..." }` to the thread's `messages`, set `status` to resolve it, and write the file whole; the page shows it within a second.
- A document written by hand is read right before, keeps the `rev` it read, and is written whole. A write from an older copy is repaired on the next read: each later save of the person whose page still holds its earlier text is applied again and logged as `restored`, and a page the agent rewrote keeps the agent's text.
- `widget.html`, with its `const PAGES=` line replaced by the document's `pages`, is a read-only look inside a chat that shows HTML; its edits never reach the file.
- Stop the server only when the person asks; the document, its original, its versions and its comments survive a restart.

## End

- Stops when the change asked for is made and verified with `void_open`, or after the link is given to the person.
- Reports the text and what changed with the `rev` reached, or the link, and any refused change with its error code.
