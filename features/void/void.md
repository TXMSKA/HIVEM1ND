---
name: void
description: Opens a long text in a quiet reader where the person corrects it in place, and saves every edit into the file on disk where agents read it.
category: planning
---

# /void

Mind: {{mind}}
Argument: [absolute path of a Void document]

Void shows a text one entry per page, both languages stacked on a black ground, for a person to read and correct. Each correction is saved into the document on disk, so an agent reads it without the person downloading, exporting or pasting anything.

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Name the document. It is the absolute path given in the argument, or one written now in the format below, in any folder the work belongs to: a repository, or the project's folder in the mind. A document already open is read again right before any change, as Writing a document says.
2. Ask `http://localhost:3301/`. When it answers, the server is already running: there is one per machine, and a second is never started. Otherwise start it in the background and leave it running: `node "{{mind}}/features/void/server.mjs"`. Port 3301 is fixed. To read from a phone on the same network, the server runs with `--lan` added: it then also answers on this machine's network addresses and prints one link per address with a key, which goes to the user with `&file=` and the document's encoded path appended. A server already running without `--lan` is restarted with it only when the user asks.
3. Open `http://localhost:3301/?file=<absolute path, URL-encoded>` and give the user that link.
4. To act on the corrections, read the document itself. The pages that differ from `<name>.orig.json` are the edited ones, and `<name>.versions.jsonl` holds every change in order.
5. Stop the server only when the user asks. The document, its original and its versions survive a restart.

A quick look inside the chat, where the agent's client can show an HTML fragment, is `widget.html` with its `const PAGES=` line replaced by the document's `pages`. It reads only: its edits stay in that view and never reach the file. Corrections are made in the page the server serves.

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

`k` is the entry's key, unique in the document. `en` and `es` are plain text: `\n` is a line, `\n\n` a paragraph break, and a line holding only `<b>..</b>` or `<i>..</i>` is drawn as a heading. No other markup is read. `rev` counts the saves and is written by the server; a new document leaves it out or sets it to 0.

## What a save does

Leaving an edited block, with Esc or a click elsewhere, saves it under the page it was made on, as plain text in the same format, never as HTML. The first save writes the untouched document beside it as `<name>.orig.json`, which is never overwritten. Every save raises `rev` and appends one line to `<name>.versions.jsonl`:

```json
{ "at": "2026-10-03T08:00:00.000Z", "rev": 4, "k": "Intro.Welcome", "lang": "en", "before": "...", "after": "..." }
```

A page that differs from the original is marked "edited" in the reader. When a save fails, the reader says "not saved" beside the key.

## Writing a document

An agent that changes a document reads it right before writing, keeps the `rev` it read, and writes the whole file at once. A document written from an older copy, with a lower or missing `rev`, is repaired on the server's next read or save: each later save whose page still holds the text from before that save is applied again and logged with `restored`, while a page the agent rewrote keeps the agent's text.

## How it is served

One process, Node built-ins only, bound to `127.0.0.1:3301`.

| URL | What it serves |
| --- | --- |
| `/?file=<path>` | The reader, opening that document |
| `/api/doc?file=<path>` | GET: the document's `title`, `pages` and the keys of the `edited` pages |
| `/api/save?file=<path>` | POST `{ k, lang, text }`: saves one text of one page; saves run one at a time |

The path must be absolute and end in `.json`; an `.orig.json` file is refused. Requests are accepted only for the hosts `localhost:3301` and `127.0.0.1:3301`, and with `--lan` for this machine's network addresses on port 3301; a POST with a foreign `Origin` or a cross-site fetch is refused. A request on a network address needs the key printed at start, given once in the link and kept as a cookie; the key changes on every start. The reader loads the Atkinson Hyperlegible face from Google Fonts.

## Keys

Left and Up go to the previous page, Right and Down to the next, Home and End to the first and the last. Plus and minus change the size, 0 resets it. The page number and the size on the rail are typed: Enter goes there, Esc cancels. Esc also leaves editing.
