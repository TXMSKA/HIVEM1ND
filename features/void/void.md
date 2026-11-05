---
name: void
description: Reads and changes Void texts through the editor tools and answers comments in the same text the embedded Void app uses.
category: planning
---

# /void

Mind: {{mind}}
Argument: [absolute path of a Void document]

Start: Locate in `rules.md` of the mind above. The tools write as the session's own unit.

A Void text holds a document or copy, one entry per page, in English and Spanish. Agents use the tools of the `onem1nd-relay` server. The person uses the real Void app embedded in ONEM1ND. When an agent may create or edit a text is in `rules.md` (Blueprint and Void).

## Tools

Answers and attachment work as for Blueprint: `{"contract":"hivem1nd-gui-v3","data":...}`, or an `error` with `isError`, and only for a unit attached to the text. <!-- Compatibility: stored schemas and wire contracts retain their existing identifiers. -->

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

## Show

Inside ONEM1ND, show the person a text with `app_open { app: "void", resourceId }`, or `path` (project-relative or absolute) with an optional `project`; `path` needs the file to be inside your session's file scope, and a project name that two projects share is refused. The desktop app switches to Void and opens the page; it never takes focus from another app, and a window that is not in front only flashes. The answer is `{ opened: true }`, or `{ opened: false, status: "not_running" }` when the desktop app is closed; do not start it. Outside ONEM1ND give the web link `https://void.txmska.com/`.

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
- `author` is `person` for the person and the unit for an agent; through the tools every message of the person reads `master`.

## End

- Stops when the change asked for is made and verified with `void_open`.
- Reports the text and what changed with the `rev` reached and any refused change with its error code.
