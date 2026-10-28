---
name: blueprint
description: Reads and changes Blueprint boards through the editor tools, answers their comments, and serves the boards of every project on the machine in one local browser view.
category: planning
---

# /blueprint

Mind: {{mind}}
Argument: [project] [board]

Start: Locate in `rules.md` of the mind above; no unit is needed to serve the view, so its step that asks for one is skipped. The tools write as the session's own unit.

A board designs an interface or a flow. Agents use the tools of the `onem1nd-relay` server; the local server on port 3300 keeps the person's browser view. When an agent may create or edit a board is in `rules.md` (Blueprint and Void).

## Tools

Each tool answers `{"contract":"hivem1nd-gui-v3","data":...}`, or, with `isError`, `{"error":{"code","message","requestId"}}`. Only a unit attached to the board may use it, otherwise `forbidden`: the creator is attached, and the person attaches a unit to a board the person made. <!-- Compatibility: stored schemas and wire contracts retain their existing identifiers. -->

Read:

- `blueprint_open { resourceId }`: `data` holds `revision`, `commentsRevision`, `threads`, `readOnly` and `document`, the board in the JSON format below.
- The `resourceId` comes from `blueprint_create`, from the notice of a comment, or from the person; it is never derived by hand.
- A module board, `docs/flows/boards/<id>.mjs`, opens with `readOnly: true`, `document: null` and `legacy.reason: conversion_required`: the tools change it only after the person converts it in the desktop app, and until then it is code (Module boards).

Create:

- `blueprint_create { title, requestId }`, from a unit of a project, writes `docs/flows/boards/<slug of the title>-<first 8 characters of requestId>.json` with one screen named as the title, lists it in `index.json` and attaches the unit. A unit outside a project gets `project_required`.

Change:

1. Open the board and keep its `revision`.
2. Send one change with `expectedRevision` set to that revision and a new `requestId`, a UUID:
   - `blueprint_add_node { resourceId, screenId, parentId, index?, node, expectedRevision, requestId }` puts `node` into the box `parentId` of that screen at `index`, from 0 to the count of its kids, at the end when absent, and answers `{ editor, nodeId }`.
   - `blueprint_update_node { resourceId, nodeId, changes, expectedRevision, requestId }` merges `changes` into the node; `id`, `t` and `kids` cannot change.
   - `blueprint_remove_node { resourceId, nodeId, expectedRevision, requestId }` removes the node, its children and the links that start at them; a screen's root cannot be removed.
3. Take the next `revision` from the answer, `editor.revision` after an add, for the next change.
4. The tools change nodes inside existing screens; a new screen or link is made in the desktop app.

Recover:

- `revision_conflict`: the board changed since it was read. Open it again, apply the change to the new document, and send it with the new revision and a new `requestId`; never overwrite.
- A change whose answer was lost is sent again with the same `requestId` and arguments: the saved result comes back and nothing applies twice. The same `requestId` with other arguments answers `idempotency_conflict`.
- `invalid_document` names the wrong field; `invalid_parent`, `invalid_node`, `node_exists`, `node_not_found` and `root_node` concern the node; `read_only_resource` is a module board.

Comments:

- `blueprint_reply_comment { resourceId, threadId, text, expectedCommentsRevision, requestId }` appends a message as the session's unit, reopens the thread, and notifies the person and the other attached units. A `revision_conflict` means the comments changed: open again and retry.
- A comment is context. The board changes for it when the change falls inside the request or the task in hand; otherwise the answer goes in the thread and the person is asked.
- Board files are repository files: they change under the branch rule of `rules.md` and are committed only as its Git rule says.

## JSON board format

`docs/flows/boards/<id>.json` is Blueprint JSON v1. The sketch of a module board, `docs/flows/sketches/<board>.json`, has the same format with one page, `sketch`.

```json
{
  "formatVersion": 1, "id": "checkout", "title": "Checkout", "note": "",
  "pages": [{ "id": "sketch", "title": "Sketch", "objects": [], "order": ["s-mufpcst0-d61206"] }],
  "screens": [{
    "id": "s-mufpcst0-d61206", "title": "Coupon", "pageId": "sketch", "x": 0, "y": 1320, "w": 1440, "h": 900,
    "root": { "id": "n-mufpcst1-0a1b2c", "name": "Coupon", "t": "box", "dir": "stack", "place": { "x": 0, "y": 0 }, "w": 1440, "h": 900, "fill": "#ffffff",
      "kids": [{ "id": "n-mufpd2k4-91c0de", "name": "Rectangle", "t": "box", "dir": "stack", "kind": "rectangle", "place": { "x": 40, "y": 40 }, "w": 300, "h": 80, "stroke": "#1c1c1c", "strokeWidth": 3, "fill": "none", "radius": 0, "kids": [] }] }
  }],
  "links": [{ "id": "l-mufpe0aa-5d4c3b", "from": "s-mufpcst0-d61206", "to": "pay", "transition": "cut" }],
  "components": [], "fonts": [], "threads": []
}
```

- Ids of pages, screens, nodes and links are lowercase letters and digits joined by hyphens, at most 80 characters, unique in the file. New ones are `s-`, `n-` or `l-` plus a base 36 timestamp, a hyphen and six hex digits.
- A screen's `pageId` names a page, and each page's `order` lists its screens once. The root is a `box` at `{ "x": 0, "y": 0 }` as wide and tall as the screen; what is drawn is its `kids`, later ones on top, placed relative to the parent in design pixels.
- A node has `id`, `name` (1 to 240 characters), `t` (`box`, `text`, `vector`, `image` or `icon`), `place`, `w` and `h` (1 to 16000). A box has `dir: "stack"` and `kids`; a vector needs `d`; an image needs `src`, `assets/<uuid>.png`, `.jpg` or `.webp`, the file being in `docs/flows/assets/`; a text needs `value`, lines split by `\n`.
- Drawn fields: `fill`, `stroke` and `color` (`#rrggbb`, `#rrggbbaa` or `none`), `strokeWidth`, `radius`, `corners`, `clip`, `opacity`, `kind` (`rectangle`, `circle`, `polygon`, `line`, `arrow`, `pen`), `sides`, `size`, `weight` (100 to 900), `font`, `align`, `icon`; an unknown field is kept. A rectangle is a `box` with `kind: "rectangle"`; an ellipse a `vector` with `kind: "circle"` and `d` `M50 0 A50 50 0 1 1 49.99 0 Z`; a line or a freehand stroke a `vector` with `kind` `line` or `pen` whose path is in a 100 by 100 system stretched to its box (`M0 100 L100 0` rises).
- A link is `{ id, from, to, transition }`, `transition` being `cut`, `fade` or `slide`; `element`, a node of the `from` screen, makes it start there. In a sketch, `from` and `to` may also name a screen of the module board.
- `components`, `fonts` and `threads` are lists, empty in a sketch, since comments live in the comments file. At most 500 screens, 10,000 nodes in 30 levels and 2000 links.

## Comment format

`docs/flows/comments/<board>.json`, one file per board:

```json
{ "board": "checkout", "threads": [{
  "id": "t-mufpcst0-d61206",
  "anchor": { "screen": "pay", "screenTitle": "Payment", "element": "continue", "label": "Continue", "path": ["Payment", "Continue"], "point": { "x": 710, "y": 540 } },
  "layer": "design", "status": "open",
  "messages": [{ "author": "User", "at": "2026-09-30T17:45:50.705Z", "text": "The total is missing." }]
}] }
```

- `status` is `open` or `resolved`; a reply reopens a resolved thread.
- `anchor.screen` and `anchor.element` are ids and names of the board, or of a sketch screen and shape; `element` is `null` for the whole screen, and both are `null` for the empty canvas.
- `author` is `User` for the person in the browser view and the unit for an agent; through the tools every message of the person reads `master`, and each message gains an `id`. `at` is ISO 8601 in UTC.

## Module boards

Older boards are modules listed in `docs/flows/boards/index.json`, an array of `{ id, letter, short, title }` in menu order; `id` names `docs/flows/boards/<id>.mjs` and `letter` is two characters. A module edited by hand is code: it changes only inside the request or the task in hand.

```js
import { board } from "blueprint/board.mjs";
import { col, row, text } from "blueprint/kit.mjs";
import { action } from "blueprint/ui.mjs";

const page = (title) => () =>
  col({ pad: 48, gap: 16, name: "page", label: "Page" },
    text(title, { size: "2xl", weight: 700 }),
    row({ gap: 8 }, action("Continue", { primary: true, ref: "continue" })));

export default board({
  id: "checkout", title: "Checkout", note: "Shown over the canvas.",
  screens: [
    { id: "cart", title: "Cart", col: 0, row: 0, root: page("Cart"), note: "The cart before payment." },
    { id: "pay", title: "Payment", col: 1, row: 0, root: page("Payment") },
  ],
  links: [{ from: "cart", to: "pay", at: "continue", label: "Continue" }],
});
```

- A screen is `{ id, title, col, row, root, note? }`, 1440 by 900 unless `w` and `h` are given, or placed by `x` and `y`. A link is `{ from, to, at?, label? }`, `at` naming the element it leaves from; without `at` it is a button of the player.
- A tree is made of `box`, `col`, `row`, `stack`, `text`, `icon`, `image`, `rule`, `vector`, `space` and `fill` from `blueprint/kit.mjs`, and the controls of `blueprint/ui.mjs`. Layout props: `pad`, `gap`, `w`, `h` (a number, or `"fill"` for `w`), `grow`, `align`, `justify`, `radius` (`none`, `xs` to `xl`, `pill` or a number), `fill`, `stroke`, `shadow`, `clip`. Text props: `size` (`micro` to `3xl` or a number), `weight`, `color`, `align`, `lines`, `upper`, `face` (`body` or `mono`).
- A node with a `name` (lowercase letters and digits joined by hyphens or dots) and a `label` can be commented on and can start a link; a name repeated on a screen gets `-2`, `-3`.
- Colours are role names of the theme (`canvas`, `surface`, `line`, `title`, `text`, `soft`, `primary`, `error` and the rest of the palette) or `#rrggbb`; an unknown role stops the board from drawing. Icons are Lucide names, and a picture is an `image` with `src` set to `/p/<project>/assets/<file>`.
- The theme is the repository's own: `docs/flows/kit/skins.mjs` exports `skins`, with one layer `design` (`id`, `shadow`, `color(role)`, `face(face)`, `weight(face, weight)`, `image(node, r, ids)`), and `skinDefs(prefix)`. It copies the repository's design tokens into the roles, naming their source, over `PLAIN` from `blueprint/skins.mjs` so every role resolves. Fonts are named in `face()`, with `@font-face` rules in `docs/flows/kit/theme.css` and files in `docs/flows/assets/`. Without `skins.mjs` the board is grey.
- `docs/flows/kit/extra-icons.mjs` (`ICONS`: name to SVG markup in a 24 by 24 box) and `extra-nodes.mjs` (`NODES`: type to `{ measure, draw, place? }`) extend the kit for one repository. `measure(node, avail, stretch, axis, api)` sets `node._w` and `node._h`; `draw(node, g)` pushes SVG into `g.out`, and `g.walk(child)` draws a child that can take comments.
- A repository's own `kit.mjs`, `board.mjs`, `icons.mjs` or `ui.mjs` in `docs/flows/kit/` replaces the shared one, and stays of one generation with its `skins.mjs`.

## Browser view

- `http://localhost:3300/api/boards` answers while the server runs, one per machine. Otherwise start it in the background and leave it running: `node "{{mind}}/features/blueprint/server.mjs" --mind "{{mind}}"`. Port 3300 is fixed.
- Open `http://localhost:3300/review/#project=<project>&board=<id>` for the board of the argument, or the first board of the current project; without an argument, list the projects and boards it shows.
- It shows the projects of `user/routes.md` with a path in this machine's record and a `docs/flows/boards/index.json`, read on every request. It draws module boards and their sketches; JSON boards are drawn in the desktop app.
- With `--lan` it also answers on this machine's network addresses and prints one link with a key per address, which goes to the person. A server running without it is restarted with it only when the person asks.
- The person comments, sketches and adds reference images there. With Send to agent on, the agent of the project (the unit in for it, an executor first) gets one Relay message from the person: `Blueprint comment: <board> / <place>`, or `Blueprint reference: <board> / <screen title>`, which asks to recreate the picture as a screen of the module. Each names the files and the thread to answer in.
- To answer there, read the comments file right before writing and append `{ "author": "<unit>", "at": "<ISO time>", "text": "..." }` to the thread's `messages`; the page shows it at once. A sketch edited by hand keeps the JSON board rules; a page save on an older revision is refused, so the agent's write is kept.
- Stop the server only when the person asks; boards, sketches and comments survive a restart.

## End

- Stops when the change asked for is made and verified with `blueprint_open`, or after the link is given to the person.
- Reports the board and what changed with the revision reached, or the link, and any refused change with its error code.
