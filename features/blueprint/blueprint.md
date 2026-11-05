---
name: blueprint
description: Reads and changes Blueprint format 4 boards through the editor tools and answers comments in the same board the embedded Blueprint app uses.
category: planning
---

# /blueprint

Mind: {{mind}}
Argument: [project] [board]

Start: Locate in `rules.md` of the mind above. The tools write as the session's own unit. When an agent may create or edit a board is in `rules.md` (Blueprint and Void).

A board designs an interface or a flow. Agents use the tools of the `onem1nd-relay` server. The person uses the real Blueprint app embedded in ONEM1ND; its `blueprint.list`, `blueprint.read` and `blueprint.save` bridge methods access the same repository files as the tools.

## Tools

Each tool answers `{"contract":"hivem1nd-gui-v3","data":...}`, or, with `isError`, `{"error":{"code","message","requestId"}}`. Only a unit attached to the board may use it, otherwise `forbidden`: the creator is attached, and the person attaches a unit to a board the person made. <!-- Compatibility: stored schemas and wire contracts retain their existing identifiers. -->

Read:

- `blueprint_open { resourceId }`: `data` holds `revision`, `commentsRevision`, `threads`, `readOnly` and `document`. The document is Blueprint format 4; `threads` is the board's own `threads` array.
- The `resourceId` comes from `blueprint_create`, from the notice of a comment, or from the person; it is never derived by hand.
- A module board opens with `readOnly: true`, `document: null` and `legacy.reason: conversion_required`. Its legacy export stays available for import; conversion needs the person's approval.

Create:

- `blueprint_create { title, requestId }`, from a unit of a project, writes `docs/flows/boards/<id>.json` in format 4 with one frame, lists it in `index.json` and attaches the unit. A unit outside a project gets `project_required`.

Change:

1. Open the board and keep its `revision`, the SHA-256 hash of its exact file bytes.
2. Send one change with `expectedRevision` set to that revision and a fresh UUID `requestId`:
   - `blueprint_add_node { resourceId, screenId, parentId, index?, node, expectedRevision, requestId }` inserts a format 4 node into the box `parentId` in the frame `screenId`; `index` is from zero through the number of children, and absent means append. It answers `{ editor, nodeId }`.
   - `blueprint_update_node { resourceId, nodeId, changes, expectedRevision, requestId }` merges validated format 4 fields into a node; `id`, `t` and `kids` cannot change.
   - `blueprint_remove_node { resourceId, nodeId, expectedRevision, requestId }` removes the node, its descendants and their outgoing links. A frame root cannot be removed. Threads on deleted targets remain as orphans.
3. Use the returned `revision`, or `editor.revision` after an add, for the next change.
4. New frames, pages and links are made in the Blueprint app. The tools use the existing argument name `screenId` for a format 4 frame.

Recover:

- `conflict`: the board changed since it was read, including a comment change. Open again, reapply only the intended change to the latest document, and send its revision and a new `requestId`; never overwrite unrelated edits.
- If a change's answer was lost, resend the same `requestId` and arguments: the saved result comes back without applying twice. Reusing a `requestId` with different arguments answers `idempotency_conflict`.
- `invalid_document` identifies invalid board data; `invalid_parent`, `invalid_node`, `node_exists`, `node_not_found` and `root_node` concern the node; `read_only_resource` is a module board.

Comments:

- `blueprint_reply_comment { resourceId, threadId, text, expectedCommentsRevision, requestId }` appends a plain-text reply with a fresh reply ID, the session's unit as `author` and a UTC `createdAt`, preserving existing replies and `resolved`. Replying does not resolve or reopen a thread.
- `commentsRevision` is the same SHA-256 board revision as `revision`. The compatible argument `expectedCommentsRevision` checks that whole-board revision; `conflict` means reopen and retry against the latest board.
- Threads live in `document.threads`, never a separate comments file. Read the thread's path and replies before answering. Never fabricate the person's or Lyra's approval.
- A comment is context. Change the board for it inside the request or task in hand; otherwise answer in the thread and ask the person.
- Board files are repository files, under the branch and Git rules of `rules.md`.

## Show

Inside ONEM1ND, show the person a board with `app_open { app: "blueprint", resourceId }`, or `path` (`docs/flows/boards/<id>.json`) with an optional `project`; `path` needs the file to be inside your session's file scope, and a project name that two projects share is refused. The desktop app switches to Blueprint and opens the board; it never takes focus from another app, and a window that is not in front only flashes. The answer is `{ opened: true }`, or `{ opened: false, status: "not_running" }` when the desktop app is closed; do not start it. Outside ONEM1ND give the web link `https://blueprint.txmska.com/review/<id>`.

## Blueprint JSON format 4

The authoritative format and validation are Blueprint's `packages/blueprint/docs/blueprint-format.md` and `packages/blueprint/src/core/model.ts`. Tools validate the entire board before saving. JSON contains data, never executable functions, HTML, external image URLs or filesystem paths.

```json
{
  "formatVersion": 4,
  "id": "6f6c8dde-fc4a-4585-a8dc-d06aaf3e808a",
  "title": "Checkout",
  "note": "",
  "pages": [{ "id": "d98db874-e118-4c43-9ab3-0f165240a09f", "title": "Page", "objects": [], "order": ["bdafc1dd-bf15-4be0-a8cf-ffac1d74c744"] }],
  "screens": [{
    "id": "bdafc1dd-bf15-4be0-a8cf-ffac1d74c744", "title": "Payment",
    "pageId": "d98db874-e118-4c43-9ab3-0f165240a09f", "x": 0, "y": 0, "w": 1440, "h": 900,
    "root": { "id": "3b768057-33c2-401a-9d8a-e05abb35c906", "name": "Payment", "t": "box", "dir": "stack", "place": { "x": 0, "y": 0 }, "w": 1440, "h": 900, "kids": [] }
  }],
  "links": [], "components": [], "fonts": [], "threads": []
}
```

- Use fresh canonical UUIDs for new IDs and keep them stable and unique across the board. `pageId` references a page; its `order` lists frames and optional `start` selects the entry frame.
- Frame `x/y` places it on the board. Its root is a `box` at `{ "x": 0, "y": 0 }` with the frame's dimensions. Children use parent-relative design pixels; loose nodes live in a page's `objects`.
- Nodes have `id`, `name`, `t`, `place`, `w`, `h`. Types are `box`, `text`, `vector`, `image` and `icon`. Boxes use `dir: "stack"` and `kids`; text uses plain `value`; vector `d` uses a 100 by 100 coordinate system. Assets are relative `assets/<uuid>.<type>` references resolved by the host, stored in `docs/flows/assets/`.
- Links use `{ id, from, to, element?, transition }`, stay inside one page and optionally name a stable source node ID. Transitions are `cut`, `fade`, `slide` and `smart`. Components, fonts, styles, tokens, shared texts, language, interaction states and other optional fields follow the authoritative format; preserve unrelated fields when editing.
- Format 4 adds optional shared `texts`, text-node `textRef`, frame `lang` (`en` or `es`), box `imagePlaceholder` and row-stack `fitCross`. A linked text retains literal `value` and optional `runs` for drawing. Do not replace shared definitions with local text inadvertently.
- Boards are bounded to 5 MB, 100 pages, 500 frames, 10,000 nodes and 30 levels. Unknown nested fields and invalid known values fail validation.

A thread inside `threads` has this shape:

```json
{
  "id": "7a8725b4-51ab-4ab0-a095-50896ea3fa89",
  "screen": "bdafc1dd-bf15-4be0-a8cf-ffac1d74c744",
  "path": ["bdafc1dd-bf15-4be0-a8cf-ffac1d74c744", "3b768057-33c2-401a-9d8a-e05abb35c906"],
  "resolved": false,
  "replies": [{ "id": "2ea45491-645c-4b23-b7dd-d1ef7cd0d168", "author": "executor-project", "text": "The total is now visible.", "createdAt": "2026-10-31T12:00:00.000Z" }]
}
```

Its path starts at the frame and follows its root and ancestors through the target. Deleted targets retain their thread as an orphan. Replies are plain text, with existing IDs and authors preserved.

## Older boards and conversion

Module boards in `docs/flows/boards/*.mjs` and their `docs/flows/kit/*` support files remain readable for import. Agents never create or edit module boards, old sketch files or separate comment files through this workflow.

Conversion uses Blueprint's `tools/convert-flows/` only with the person's explicit approval. Do not convert automatically on open, rewrite existing module boards or remove originals. JSON formats 1, 2 and 3 migrate in memory to format 4 without adding optional fields; saving writes format 4. Newer unsupported formats are never rewritten.

## End

Stop when the requested change is verified with `blueprint_open`. Report the board, the revision reached and any refused change with its error code.
