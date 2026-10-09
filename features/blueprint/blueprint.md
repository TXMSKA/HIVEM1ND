---
name: blueprint
description: Serves the screen-flow boards of every project on the machine in one local viewer and writes the comments left on them where agents read them.
category: planning
---

# /blueprint

Mind: {{mind}}
Argument: [project] [board]

Blueprint Lite is a temporary tool: one local server per machine draws the screen flows of any project, collects review comments on them and keeps the sketches people draw on them. It is replaced when the full Blueprint ships.

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Ask `http://localhost:3300/api/boards`. When it answers, the server is already running: there is one per machine, and a second is never started. Otherwise start it in the background and leave it running: `node "{{mind}}/features/blueprint/server.mjs" --mind "{{mind}}"`. Port 3300 is fixed. To review from a phone on the same network, the server runs with `--lan` added: it then also answers on this machine's network addresses and prints one link per address with a key, which goes to the user. A server already running without `--lan` is restarted with it only when the user asks.
2. Open `http://localhost:3300/review/#project=<project>&board=<id>` for the project and board named in the argument, or the current project's first board when none is named. Without an argument, open the viewer and list the projects and boards it shows.
3. When the current project has no `docs/flows/boards/index.json`, say so and ask before creating the first board. A board is written in the repository, in the formats below, and appears in the viewer on the next reload: nothing is registered anywhere else.
4. To act on the review, read `docs/flows/comments/<board>.json` in the repository and take the threads whose `status` is `open`. Answer a thread by appending a message to its `messages` with the unit as `author`, and change the board only when the thread asks for it.
5. To act on a sketch, read `docs/flows/sketches/<board>.json` in the repository, in the format under Sketches. A person draws screens there to be read and prototyped, and a reference image is a request to recreate it as a screen of the board: its thread in the comments file is where to report. A message from Relay with the subject `Blueprint comment` or `Blueprint reference` names the file and the thread to answer in.
6. Stop the server only when the user asks. The viewer, the sketches and the comment files survive a restart.

## How it is served

One process, bound to `127.0.0.1:3300`, Node built-ins only. The projects are the ones in `user/routes.md` (`Projects` section) that have a path in this machine's record (`Paths` section) and whose repository holds `docs/flows/boards/index.json`. They are read on every request, so a repository that gains its first board, or a project added to the mind, shows up on the next reload without a restart.

| URL | What it serves |
| --- | --- |
| `/review/` | The viewer, with a project dropdown and, under each project, its boards |
| `/kit/<file>` | The shared kit: `kit.mjs`, `board.mjs`, `icons.mjs`, `ui.mjs`, `skins.mjs` (the fallback theme) |
| `/p/<project>/boards/...` | `docs/flows/boards/` of the repository |
| `/p/<project>/kit/...` | `docs/flows/kit/` of the repository: its theme, its extra modules and any kit file it keeps its own copy of. A shared-kit file the repository lacks is answered from the shared kit |
| `/p/<project>/assets/...` | `docs/flows/assets/` of the repository |
| `/api/boards` | Every board of every project, with its `project`, `id`, `short`, `title` and `url` |
| `/api/comments/<project>/<board>` | GET reads, POST changes the comments of that board. A POST that adds or replies may carry `send: true`, which also sends the comment to the agent of the project (see Sending to the agent) |
| `/api/agent/<project>` | GET: `{ "agent": { "unit", "awake" } }` for the unit a comment of that project would go to, `{ "agent": null }` when it has none. Reading it writes nothing to the mind |
| `/api/sketch/<project>/<board>` | GET reads, PUT saves the sketch of that board (see Sketches). The board must be in `index.json` |
| `/api/images/<project>` | POST saves a picture, sent as its own bytes, in `docs/flows/assets/` and answers `{ "src", "url", "bytes" }` |
| `/api/reference/<project>/<board>` | POST asks the agent to recreate the reference image of a screen of the sketch (see Reference images) |
| `/api/live` | GET: the changes an agent makes to the files of the boards, as server-sent events or, for a page without them, as events since a cursor (see Live refresh) |

Requests are accepted only for the hosts `localhost:3300` and `127.0.0.1:3300`, and with `--lan` for this machine's network addresses on port 3300; a POST with a foreign `Origin` or a cross-site fetch is refused. A request on a network address needs the key printed at start, given once in the link and kept as a cookie; the key changes on every start. Pages run under a content security policy that allows the server's own scripts, styles and images only. Every route that writes (comments, sketches, pictures, references) takes the same checks: it needs the host, the key on a network address, a same-origin request and, where it takes JSON, a JSON content type. A body is read up to its limit and refused with 413 past it: 64 KB for a comment or a reference request, 2 MB for a sketch, 8 MB for a picture. File names are made by the server (a board id from `index.json`, a generated UUID for a picture), so no path comes from the request.

## Board format

A board lives in the repository, in `docs/flows/boards/`:

```text
docs/flows/boards/index.json     the list of boards
docs/flows/boards/<id>.mjs       one module per board
docs/flows/comments/<id>.json    the comments, written by the server
docs/flows/sketches/<id>.json    the sketch of the board, written by the server (see Sketches)
docs/flows/kit/skins.mjs         the theme of this project (see Theme)
docs/flows/kit/theme.css         optional @font-face rules for its fonts
docs/flows/kit/<name>.mjs        optional kit modules of this project
docs/flows/assets/               optional pictures, and the ones added in the viewer
```

`index.json` is an array. Order is the order in the viewer. `project` is not written: the server takes it from the project's name in the mind.

```json
[
  { "id": "checkout", "letter": "CH", "short": "Checkout", "title": "Checkout: cart, payment and receipt" }
]
```

`id` is lowercase words joined by hyphens and is the file name of the module. `letter` is two characters for the menu, `short` the menu label, `title` the full title.

A board module exports a board as its default export. The kit is imported by the bare name `blueprint/`, which the server maps to the one shared copy:

```js
import { board } from "blueprint/board.mjs";
import { col, row, text } from "blueprint/kit.mjs";
import { action } from "blueprint/ui.mjs";

const page = (title) => () =>
  col({ pad: 48, gap: 16, name: "page", label: "Page" },
    text(title, { size: "2xl", weight: 700 }),
    row({ gap: 8 }, action("Continue", { primary: true, ref: "continue" })));

export default board({
  id: "checkout",
  title: "Checkout",
  note: "Shown in the note over the canvas.",
  screens: [
    { id: "cart", title: "Cart", col: 0, row: 0, root: page("Cart"), note: "The cart before payment." },
    { id: "pay", title: "Payment", col: 1, row: 0, root: page("Payment") },
  ],
  links: [{ from: "cart", to: "pay", at: "continue", label: "Continue" }],
});
```

- A screen is `{ id, title, col, row, root }`. `id` is lowercase letters, digits and hyphens. The size is 1440 by 900 unless `w` and `h` are given, and `x` and `y` place it freely instead of `col` and `row`. `root` is a function returning the tree of the screen. An optional `note` is a short explanation of the screen: a click on the screen shows it in the note over the canvas in place of the board's note, and a click on the empty canvas brings the board's note back.
- A link is `{ from, to, at?, label? }`: screen ids, the `name` of the element the arrow leaves from, and a caption. Present, at the top of the viewer, plays the board through its links like a prototype, starting at the last screen clicked or the first one: a click on the `at` element opens the `to` screen, and a link without `at` is a button in the player's bar, named by its `label`.
- A tree is made of `box`, `col`, `row`, `stack`, `text`, `icon`, `image`, `rule`, `vector`, `space` and `fill` from `blueprint/kit.mjs`. The controls in `blueprint/ui.mjs` (buttons, fields, tabs, menus, switches) are built from them. Layout props: `pad`, `gap`, `w`, `h` (a number, or `"fill"` for `w`), `grow`, `align`, `justify`, `radius` (`none`, `xs`, `sm`, `md`, `lg`, `xl`, `pill` or a number), `fill`, `stroke`, `shadow`, `clip`. Text props: `size` (`micro` to `3xl` or a number), `weight`, `color`, `align`, `lines`, `upper`, `face` (`body` or `mono`).
- Colours are role names of the theme (`canvas`, `surface`, `line`, `title`, `text`, `soft`, `primary`, `error`, and the rest of the palette in the project's `skins.mjs`) or a literal `#rrggbb`. An unknown role stops the board from drawing. See Theme for where the palette and the fonts come from.
- A node with a `name` (and a human `label`) can be commented on and can start a link. Names are lowercase letters and digits joined by hyphens or dots. A name used twice on a screen gets `-2`, `-3` after it.
- Icons are Lucide names from `icons.mjs`. A repository adds its own, such as brand marks, in `docs/flows/kit/extra-icons.mjs` (see Extending the kit). A picture is an `image` with `src` set to `/p/<project>/assets/<file>`.

## Extending the kit

The shared kit is the base only: what a single project uses lives in that project. A repository adds it from `docs/flows/kit/` without keeping a copy of `kit.mjs`. Both files are plain modules the repository controls, so they may import from another path or a package. The viewer registers them for that repository's boards only, before it lays out or draws them. A repository that keeps its own `kit.mjs` is unaffected.

- `extra-icons.mjs`: the default export (or `ICONS`) is an object of icon name to SVG markup, drawn in a 24 by 24 box like the shared icons (`filled: true` on the node fills instead of stroking). A name in both takes the repository's drawing.
- `extra-nodes.mjs`: the default export (or `NODES`) is an object of node type to `{ measure, draw, place? }`. A board builds the node itself (`{ t: "<type>", ...props, kids }`). `measure(node, avail, stretch, axis, api)` must set `node._w` and `node._h`; its `api` has `layout(tree, w, h)` (lays a subtree out alone) and `withMeasureSkin(skin, work)` (measures text in another skin). `place(node, x, y, w, h, api)` is optional and runs when the parent places the node. `draw(node, g)` pushes SVG into `g.out`; `g` has `walk(child)` (draws a child; a named child is recorded for comments and links, so a node that draws its children with `walk` makes them pinnable), `mute(work)` (names inside are not recorded, so a comment pins to the node as a whole), `withSkin(skin, ids, work)` (draws in another skin), `uid(kind)` (an id under the screen's prefix), `paint(role)`, `radius(node)`, `esc(text)`, and the current `skin` and `ids`.

## Theme

A board is drawn with the theme of its own repository, never with a neutral one. The shared kit supplies the engine (layout, drawing, icons, controls) and, as a fallback only, a grey theme in system fonts. The repository supplies the look:

- `docs/flows/kit/skins.mjs` exports `skins` (an object of layers, each with `id`, `shadow`, `color(role)`, `face(face)`, `weight(face, weight)` and `image(node, r, ids)`) and `skinDefs(prefix)` (gradients and patterns, returning `{ ids, svg }`). Name the layer `design`; the viewer draws that layer only, with no layer switch.
- The palette is the repository's own tokens: copy the values of its design tokens (CSS variables, theme file) into the roles of `skins.mjs`, with a comment naming the source, so a token changed there is changed here. It must define every role the engine draws with; start from `import { PLAIN, SANS, MONO, pick, skinDefs } from "blueprint/skins.mjs"` and spread `PLAIN` under the repository's own values so that a role it does not override still resolves.
- Fonts are the repository's own. Name them in `face()`; the viewer waits for those faces, then hands the skin to the engine (`useSkin(skin)`), which measures every line with the same `face()` and `weight()` that draw it, so layout matches what is drawn. Bring the font files in `docs/flows/kit/theme.css` (`@font-face` rules only, with `url()` pointing at `/p/<project>/assets/<file>`, the files being in `docs/flows/assets/`). A Google Fonts stylesheet the repository's own `docs/flows/review/index.html` already links is linked too, and is the only outside host the viewer will allow.
- A repository written for its own viewer keeps working unchanged: a picture named from the root (`/assets/<file>`, in a board or in a skin) is read from that repository's `docs/flows/assets/`, and the `@font-face` rules of its `docs/flows/review/review.css` are applied, with a file named as `/fonts/<file>` taken from `docs/flows/fonts/`, `public/fonts/`, `src/app/fonts/` or `app/fonts/` of the repository, whichever has it.
- A repository with no `skins.mjs` falls back to the shared grey theme in system fonts.
- Kit files are taken from the repository first: a `docs/flows/kit/kit.mjs`, `board.mjs`, `icons.mjs` or `ui.mjs` is used in place of the shared one, and the shared file answers only where the repository has none. A repository that keeps its own engine copy therefore draws exactly as it did before; one that drops the copy follows the shared engine. The shared engine lets a child with a fixed `w` (in a column) or `h` (in a row) be stretched across unless it names `self`, pads of three values are top, sides and bottom, and a dialog shadow is two plates of 0.35 and 0.18 opacity. Keep `kit.mjs`, `icons.mjs` and `skins.mjs` of a repository from the same generation, because they import each other. Repository-only modules (for example a set of backoffice components) live in the same folder and are imported by relative path.

A repository written for an earlier local viewer keeps working: a board that imports `../kit/kit.mjs`, `board.mjs`, `icons.mjs`, `ui.mjs` or `skins.mjs` by relative path gets the repository's copy when it has one, and the shared copy otherwise. The repository's own `review/` folder and server script are not used.

## Comment format

Comments live in `docs/flows/comments/<board>.json`, one file per board, created by the first comment. The file is plain JSON, read and written by both the viewer and agents:

```json
{
  "board": "checkout",
  "threads": [
    {
      "id": "t-mufpcst0-d61206",
      "anchor": {
        "screen": "pay",
        "screenTitle": "Payment",
        "element": "continue",
        "label": "Continue",
        "path": ["Payment", "Continue"],
        "point": { "x": 710, "y": 540 }
      },
      "layer": "design",
      "status": "open",
      "messages": [
        { "author": "User", "at": "2026-09-30T17:45:50.705Z", "text": "The total is missing." },
        { "author": "executor-shop", "at": "2026-09-30T18:02:11.000Z", "text": "Added the total under the cart lines." }
      ]
    }
  ]
}
```

- `id` is `t-` plus a base 36 timestamp, a hyphen and six hex digits. `status` is `open` or `resolved`. `layer` is `design`, the layer the board was drawn in; older files may hold `plain`.
- `anchor.screen` and `anchor.element` are ids and names from the board; `element` is `null` for a comment on the whole screen, and both are `null` for a comment on the empty canvas. `label` and `path` are the human trail shown in the viewer, at most ten entries. `point` is a position in board pixels.
- Each message is `{ author, at, text }` with an ISO 8601 time in UTC. The viewer writes `User`; an agent writes its unit name.
- The first message of a thread is the review comment. A reply from the viewer reopens a resolved thread.
- The server changes the file by small operations (add, reply, status, remove) applied to the file as it is on disk, each written through a temporary file and a rename. A reply appended by hand is therefore kept, and shows in the viewer as soon as it is written (see Live refresh).
- Comment text is at most 4000 characters, labels at most 160, and a request body at most 64 KB.
- A thread may be anchored to a screen of the sketch: `anchor.screen` is its id, and `anchor.element` the id of a shape on it. Ids of a sketch are lowercase for that reason.

## Sending to the agent

The comment box, the reply box and the reference card (see Reference images) end in a choice under a hairline: a checkbox, "Send to agent", and at the right the unit it sends to. A dot before the unit is solid green while that unit's wake is on and hollow while it is off, and screen readers are told "wake on" or "wake off". With the box checked the main button reads "Comment and send", "Reply and send" or "Add reference and send"; unchecked, "Comment", "Reply" or "Add reference".

- The unit is the agent of the project: the unit `in` for that project's scope in Relay, an executor first and, among units of one kind, the one whose state record is newest, as `engine/relay/person.mjs` decides. The wake is on when the unit has an enabled wake policy that is not paused or past its deadline. The page asks `/api/agent/<project>` when a board opens and when its window takes focus.
- One answer is kept for every box, in the browser's `localStorage` under `review.send`: turned off once, it stays off in the comment box, the reply box and the reference card until it is turned on. The first time it is on. A browser that keeps nothing still keeps the answer for the page.
- A project with no agent shows the box disabled and "No agent for this project" in place of the unit. What is written is saved without a message.
- The comment is saved first, exactly as without the box. Then the server sends one Relay message from the unit `user` to the agent: the subject is `Blueprint comment: <board> / <element or screen>` (the element's label, else the screen's title, else `board`), the body quotes the comment and gives the project, the board id, the screen, the element and the thread id, and asks the agent to answer by appending a message to that thread in `docs/flows/comments/<board>.json`; the one attachment is the absolute path of that file.
- The answer to a POST that sent is the comments document plus `"saved": true` and `"relay"`: `{ "sent": true, "to": "<unit>", "id": "<message id>" }`, or `{ "sent": false, "reason": "no-agent" | "failed" }`. A message that fails never costs the comment, and the page says so under the thread: "Comment saved. The message to the agent was not sent: ...". A POST without `send` answers the comments document as before.
- The server opens its channel to Relay (`createPersonRelay`) on the first message, registered once as the unit `user` under the tool name `blueprint`, so a server that never sends writes nothing to the mind.

## Sketches

A person draws screens on a board so an agent can read them and prototype. Sketch is a tool of the tools bar, next to Move and Comment (key S). The sketch of a board is one file, `docs/flows/sketches/<board>.json`, saved by the server a moment after every change, and the viewer draws its screens beside the other screens of the board with a dashed edge. The board module and `index.json` are not touched, so a repository's own viewer keeps working. Only screens of the sketch can be edited; the screens of the board can be commented on and be the ends of an arrow.

The bar along the bottom has:

- Select (V), Screen (F), Rectangle (R), Ellipse (O), Line (L), Pen (P), Text (T) and Arrow between screens (A), as tools. Drag to draw; a click draws a standard shape (160 by 100, a screen of 1440 by 900). After a shape the tool goes back to Select, except Pen. Arrow joins two screens: press on one and drag to the other.
- Add a picture (I), and Reference image (see Reference images). A picture is pasted from the clipboard or picked from a file (PNG, JPEG or WebP, at most 8 MB) and placed in the middle of the selected screen, or of the one most in view.
- The line colour and the fill, which also change the selected shape.
- Previous and next item (`[` and `]`), Undo (Ctrl Z), Redo (Ctrl Shift Z or Ctrl Y), Delete (Delete or Backspace), and whether the sketch is saved.

A shape or a screen is selected by a click, or by the keys `[` and `]`, which walk the screens, the shapes on each and the arrows. It moves by dragging, or with the arrow keys (1 pixel, 10 with Shift); it resizes by its handles, or with Ctrl and the arrow keys; a click on the empty paper selects the screen, which moves by its title. A text scales by its corner handles and a picture keeps its proportions. Enter edits a text or renames a screen, and a double click edits a text. Enter with a drawing tool chosen places a standard shape on the selected screen, and with Arrow chosen it takes the selected screen as the start: `[` and `]` then choose the end, and Enter joins them. Escape steps back. Only the pen needs a pointer.

Every change is one step of the history, kept while the page is open. The sketch is read again when the file changes on disk and when the window takes focus (see Live refresh), unless the page has changes it has not saved. A save carries the revision the page read (a hash of the file), and the server refuses it with 409 when the file has changed since: an agent's edit is shown and kept, and the page's last change is the one lost.

### Sketch format

The file is Blueprint JSON v1, the format of the full Blueprint, as a board with one page, `sketch`:

```json
{
  "formatVersion": 1,
  "id": "checkout",
  "title": "Checkout",
  "note": "",
  "pages": [{ "id": "sketch", "title": "Sketch", "objects": [], "order": ["s-mufpcst0-d61206"] }],
  "screens": [
    {
      "id": "s-mufpcst0-d61206",
      "title": "Coupon",
      "pageId": "sketch",
      "x": 0,
      "y": 1320,
      "w": 1440,
      "h": 900,
      "root": {
        "id": "n-mufpcst1-0a1b2c",
        "name": "Coupon",
        "t": "box",
        "dir": "stack",
        "place": { "x": 0, "y": 0 },
        "w": 1440,
        "h": 900,
        "fill": "#ffffff",
        "kids": [
          { "id": "n-mufpd2k4-91c0de", "name": "Rectangle", "t": "box", "dir": "stack", "kind": "rectangle", "place": { "x": 40, "y": 40 }, "w": 300, "h": 80, "stroke": "#1c1c1c", "strokeWidth": 3, "fill": "none", "radius": 0, "kids": [] }
        ]
      }
    }
  ],
  "links": [{ "id": "l-mufpe0aa-5d4c3b", "from": "s-mufpcst0-d61206", "to": "pay", "transition": "cut" }],
  "components": [],
  "fonts": [],
  "threads": []
}
```

What is drawn is stored as the element v1 has for it. A screen is a `screens` entry whose `root` is a box the size of the screen, and what is drawn on it is the `kids` of that box, later ones on top. Positions are relative to the parent, in design pixels.

| Drawn | v1 element |
| --- | --- |
| Rectangle | `box` with `kind: "rectangle"`, `stroke`, `strokeWidth`, `fill`, `radius` |
| Ellipse | `vector` with `kind: "circle"` and the v1 circle path `M50 0 A50 50 0 1 1 49.99 0 Z`, stretched to its box |
| Line | `vector` with `kind: "line"`, whose path runs corner to corner of its box in the 100 by 100 system of v1 (`M0 100 L100 0` rises) |
| Freehand stroke | `vector` with `kind: "pen"`, whose path is the points of the stroke as `M` and `L` in the same system, `fill: "none"` |
| Text | `text` with `value` (lines are separated by `\n`), `size`, `weight`, `color`, `align` |
| Picture | `image` with `src: "assets/<uuid>.png"` (or `.jpg`, `.webp`), the file being `docs/flows/assets/<uuid>.<ext>` of the repository |
| Arrow between screens | an entry of `links`: `{ id, from, to, transition: "cut" }`; `element`, the id of a shape of the `from` screen, makes it start there |

Freehand strokes and arrows between screens are already in v1 (`kind: "pen"` and `links`), so they need nothing added. The one extension is for the arrows: **the `from` and `to` of a link may name a screen of the board module** (`docs/flows/boards/<id>.mjs`) as well as a screen of the sketch, because a screen drawn by hand is usually a step between screens that exist. The full Blueprint keeps links inside one file, so a consumer of plain v1 drops the arrows whose ends are not in the file; the check that Lite runs on a save is v1 with that one allowance, and a sketch whose arrows end inside it passes the full Blueprint's own validation.

Lite reads and writes a subset of v1, and refuses a file outside it with the field that is wrong (the viewer then shows the reason and never overwrites the file):

- Ids (of screens, shapes, arrows and the page) are lowercase letters and digits joined by hyphens, at most 80 characters, and not used twice in the file, because a comment names a screen or a shape by that id. The page makes them as `s-`, `n-` and `l-` plus a base 36 timestamp, a hyphen and six hex digits.
- A node has the fields `id`, `name`, `t`, `dir`, `place`, `w`, `h`, `fill`, `stroke`, `strokeWidth`, `radius`, `corners`, `clip`, `opacity`, `kind`, `sides`, `d`, `value`, `size`, `weight`, `font`, `color`, `align`, `icon`, `src` and `kids`. Colours are `#rrggbb`, `#rrggbbaa` or `none`. `runs`, `states`, `tokens`, components and the other fields of v1 are not used. An `icon` node is kept and drawn as a placeholder.
- `components`, `fonts` and `threads` are empty lists, and each page's `objects` is empty: the comments are in `comments/<board>.json`, and nothing is drawn outside a screen.
- At most 500 screens, 10,000 nodes in 30 levels and 2000 arrows, and a file of at most 2 MB when it is saved from the viewer.

An agent may edit the file by hand, as it edits the comments: keep the ids unique and lowercase, keep each root as wide and tall as its screen, and the viewer shows the change as soon as the file is written. `GET /api/sketch/<project>/<board>` answers `{ "revision", "sketch", "problem" }`, with an empty sketch when the file does not exist yet, and `sketch: null` with the reason in `problem` when the file is not valid. `PUT` takes `{ "base": "<revision>", "sketch": {...} }`, with `base` empty for a file that does not exist; it answers `{ "revision", "sketch" }`, `400` with the reason for a sketch outside the format, or `409` with the current `{ "revision", "sketch", "problem" }` when the file changed.

### Reference images

A person gives an image as the reference for a screen with Reference image in the sketch bar: a card takes a picture (PNG, JPEG or WebP, at most 8 MB), an optional note, and the choice to send it to the agent. The picture is saved in `docs/flows/assets/`, and a new sketch screen, titled `Reference: <file name>`, is added with the picture filling it (the size of the picture, scaled down to at most 1440 by 2400), as a node named `Reference`. The sketch is saved before anything is sent.

With the choice on, `POST /api/reference/<project>/<board>` with `{ "screen": "<sketch screen id>", "note": "<text, optional>" }` finds the picture in the saved sketch, opens a thread on that screen (the first message is the note, or "Recreate this reference image as a screen of the board."), and sends the agent one Relay message from `user`: the subject is `Blueprint reference: <board> / <screen title>`, the body names the project, the board, the sketch screen, the absolute paths of the picture and of the sketch file, and the thread, and asks the agent to recreate the picture as a screen of the board's module and to report in that thread, which is where the person reads the answer. The attachments are the absolute paths of the picture and of the comments file. The answer is the comments document plus `thread`, `saved` and `relay`, as for a comment. With the choice off, the picture and its screen are added and nothing is asked.

## Live refresh

A page that has a board open shows what an agent writes without a reload. While at least one page listens, the server looks every 200 ms at the size and time of the files of each project with boards: `docs/flows/boards/` (`index.json` and the board modules), `docs/flows/sketches/` and `docs/flows/comments/`. Nothing is looked at while no page is open, and a folder that does not exist yet is picked up when it appears. The files are polled rather than watched with `fs.watch`, which loses events on synced folders, on replaced files and on folders created later.

`GET /api/live` is the one route. With `Accept: text/event-stream` it is a stream of server-sent events: `ready` (`{ "cursor" }`) once the first look is done, then `change` with `{ "project", "kind", "board" }` for each file an agent wrote. `kind` is `index` (`index.json`, with `board` null), `board` (`boards/<id>.mjs`), `sketch` or `comments`. A comment line every 20 seconds keeps the connection open, and the browser reconnects by itself when it drops. Any other GET is the polling fallback, for a browser without EventSource or a stream that is refused: it answers `{ "cursor", "resync", "events" }` with the events since `?after=<cursor>`, and without `after` only the first cursor. `resync` is true when the cursor belongs to an earlier run of the watch or is too old, and the page then reads everything again. A page that polls keeps the watch going for 15 seconds after each ask. The route takes the same host and key checks as the others and writes nothing.

- One agent write is one event. A file is told once it has been still for 300 ms, so a file written in steps is one event, and one that keeps changing is told anyway every 3 seconds. Two files are two events: the sketch and the comments of a board are told apart.
- What the server writes for a page is not told. A comment, a reply or a sketch save is noted by its digest before it lands, and a change that matches one of those is passed over, so a page never refreshes over its own save. The same file written by an agent is told.
- A project that gains its first board while a page listens is told as one `index` event, and a file taken away is a change too. Temporary files, pictures and anything that is not a board's file are not changes.

The page acts on an event for the board it shows. An `index` event of any project reads the list of boards again, and opens the first board when the viewer had none.

- `board`: the module is imported again and the screens are laid out and drawn from it, with the camera, the selection, the open composer or thread and the sketch as they are. A module that fails to build or to draw leaves the last one that drew, with a message. Only the module of the board is read again: a module that it imports needs a reload of the page.
- `sketch`: the file is read again. When the page has nothing unsaved, the sketch on screen is replaced (the selection stays while its shape exists; the undo history of the sketch starts again). When the page has changes of its own, a save in flight settles first, and if it still holds changes, a text being edited or a drag, nothing is replaced: a quiet notice, "The agent changed this board. Reload to see it.", offers Reload, which reads the board, the sketch and the comments from the disk over what the page holds. A save made on the old revision is refused with 409 as before, and the notice goes with it.
- `comments`: the threads are read again, and an open thread, a half-written reply and a composer stay as they are.

What an outside change touched is outlined on the board for six seconds in the violet of the agent: a screen of the board that differs, a screen of the sketch that is new, moved or lost a shape, the shapes of a sketch screen that are new or differ, or the anchor of a thread with a new message. A line in the status says it, for example "The agent changed Cart and Payment." The outline holds, then fades over its last 2.5 seconds; with reduced motion asked for, it holds and goes.

When the stream reconnects, or polling begins, the page reads the list, the board, the sketch and the comments again, because events may have been missed. The window taking focus still reads the sketch and the comments.
