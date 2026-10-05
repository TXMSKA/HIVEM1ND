---
name: blueprint
description: Serves the screen-flow boards of every project on the machine in one local viewer and writes the comments left on them where agents read them.
category: planning
---

# /blueprint

Mind: {{mind}}
Argument: [project] [board]

Blueprint Lite is a temporary tool: one local server per machine draws the screen flows of any project and collects review comments on them. It is replaced when the full Blueprint ships.

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Ask `http://localhost:3300/api/boards`. When it answers, the server is already running: there is one per machine, and a second is never started. Otherwise start it in the background and leave it running: `node "{{mind}}/features/blueprint/server.mjs" --mind "{{mind}}"`. Port 3300 is fixed. To review from a phone on the same network, the server runs with `--lan` added: it then also answers on this machine's network addresses and prints one link per address with a key, which goes to the user. A server already running without `--lan` is restarted with it only when the user asks.
2. Open `http://localhost:3300/review/#project=<project>&board=<id>` for the project and board named in the argument, or the current project's first board when none is named. Without an argument, open the viewer and list the projects and boards it shows.
3. When the current project has no `docs/flows/boards/index.json`, say so and ask before creating the first board. A board is written in the repository, in the formats below, and appears in the viewer on the next reload: nothing is registered anywhere else.
4. To act on the review, read `docs/flows/comments/<board>.json` in the repository and take the threads whose `status` is `open`. Answer a thread by appending a message to its `messages` with the unit as `author`, and change the board only when the thread asks for it.
5. Stop the server only when the user asks. The viewer and the comment files survive a restart.

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
| `/api/comments/<project>/<board>` | GET reads, POST changes the comments of that board |

Requests are accepted only for the hosts `localhost:3300` and `127.0.0.1:3300`, and with `--lan` for this machine's network addresses on port 3300; a POST with a foreign `Origin` or a cross-site fetch is refused. A request on a network address needs the key printed at start, given once in the link and kept as a cookie; the key changes on every start. Pages run under a content security policy that allows the server's own scripts, styles and images only.

## Board format

A board lives in the repository, in `docs/flows/boards/`:

```text
docs/flows/boards/index.json     the list of boards
docs/flows/boards/<id>.mjs       one module per board
docs/flows/comments/<id>.json    the comments, written by the server
docs/flows/kit/skins.mjs         the theme of this project (see Theme)
docs/flows/kit/theme.css         optional @font-face rules for its fonts
docs/flows/kit/<name>.mjs        optional kit modules of this project
docs/flows/assets/               optional pictures
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
- The server changes the file by small operations (add, reply, status, remove) applied to the file as it is on disk, each written through a temporary file and a rename. A reply appended by hand is therefore kept, and shows in the viewer the next time its window takes focus.
- Comment text is at most 4000 characters, labels at most 160, and a request body at most 64 KB.
