---
name: void
description: Opens a long text in a quiet reader where the person corrects and comments in place, saves every edit into the file on disk where agents read it, and tells the agent of comments and corrections.
category: planning
---

# /void

Mind: {{mind}}
Argument: [absolute path of a Void document]

Void shows a text one entry per page, both languages stacked on a black ground, for a person to read and correct. Each correction is saved into the document on disk, so an agent reads it without the person downloading, exporting or pasting anything. The person can also comment on a selection, see what an agent changed while the page is open, and have the document's agent told of a comment or a correction through Relay.

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Name the document. It is the absolute path given in the argument, or one written now in the format below, in any folder the work belongs to: a repository, or the project's folder in the mind. A document already open is read again right before any change, as Writing a document says.
2. Ask `http://localhost:3302/`. When it answers with the Void Text Reader page, the server is already running: there is one per machine, and a second is never started. Otherwise start it in the background and leave it running: `node "{{mind}}/features/void/server.mjs"`. Port 3302 is the default, and the Void product keeps 3301, so the two run together. When another program holds the port, the start prints `Port 3302 is in use` and exits: tell the user, start the server again with `--port <free number>` and use that port in every link that follows. The server takes the mind from `--mind <path>`, else the mind it is installed in, else the current folder when that is a mind, else `HIVEM1ND` in the home folder, and this machine's record from `--hostname <name>`, else the host name. To read from a phone on the same network, the server runs with `--lan` added: it then also answers on this machine's network addresses and prints one link per address with a key, which goes to the user with `&file=` and the document's encoded path appended. A server already running without `--lan` is restarted with it only when the user asks.
3. Open `http://localhost:3302/?file=<absolute path, URL-encoded>` and give the user that link.
4. To act on the corrections and comments, read the document itself. The pages that differ from `<name>.orig.json` are the edited ones, `<name>.versions.jsonl` holds every change in order, and `<name>.comments.json` holds the comments. A message from the person arrives through Relay as `user` when the person asked for it, and names the files to read.
5. To answer a comment, add a message to its thread in `<name>.comments.json`, as Comments says. The open page shows it within a second.
6. Stop the server only when the user asks. The document, its original, its versions and its comments survive a restart.

A quick look inside the chat, where the agent's client can show an HTML fragment, is `widget.html` with its `const PAGES=` line replaced by the document's `pages`. It reads only: its edits stay in that view and never reach the file, and it has no comments, live view or sending. Everything else is made in the page the server serves.

## Document format

A JSON file whose name ends in `.json`, other than `<name>.orig.json` and `<name>.comments.json`:

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

A save carries the text it was made from. When the file holds another text by then, because an agent changed it meanwhile, the two changes are joined word by word wherever they do not touch; where they do, the person's text stays and the history keeps both.

## Writing a document

An agent that changes a document reads it right before writing, keeps the `rev` it read, and writes the whole file at once. A document written from an older copy, with a lower or missing `rev`, is repaired on the server's next read or save: each later save whose page still holds the text from before that save is applied again and logged with `restored`, while a page the agent rewrote keeps the agent's text.

## Live view and changes

While a page has the document open, the server looks at the document and its comments file twice a second, and the page learns of a change made from outside within about a second, by server-sent events. The pages are updated in place: the text the person is typing in is never rewritten, and what the agent changed in it is joined when the person leaves it, as What a save does says. The words of the latest outside change are marked in the page, inserted words underlined on a green tint and removed words struck through, and a green dot on the page rail marks each page that changed. A new outside change replaces the marks of the previous one; a text the person edits loses its marks.

Each outside change is also appended to `<name>.versions.jsonl`, beside the person's saves, with `"by": "outside"` and the `rev` the document holds at that time, which it does not raise:

```json
{ "at": "2026-10-09T05:23:51.568Z", "rev": 4, "k": "Intro.Welcome", "lang": "en", "before": "...", "after": "...", "by": "outside" }
```

A change made while no page has the document open is not logged, and a page or a language the document gains is logged as an insertion.

The Changes control on the rail shows, per page, the difference between each text and the version before the latest entry in `<name>.versions.jsonl`, with inserted and removed words marked and a note of whether the person or an outside change made it. A page heading in the view goes to that page; Esc closes the view.

## Comments

Releasing the mouse, or finishing a keyboard selection with Shift, over a selection inside one text opens a comment box under it with the quoted words, a field, and the Send to agent choice. The box does not take the cursor, so the selection can still be typed over or edited; Tab from the text reaches it, and a box that nothing was typed in closes when the selection goes. A comment is saved in `<name>.comments.json`, next to the document, in the format of the full Void app, so either app reads what the other wrote:

```json
{
  "path": "handbook.json",
  "threads": [
    {
      "id": "24365999-5217-4734-b87a-fb17ee657a6b",
      "anchor": { "lang": "en", "quote": "First line.", "prefix": "Welcome\n", "suffix": "\n\nA new paragraph.", "k": "Intro.Welcome", "start": 8, "end": 19 },
      "to": "executor-alpha",
      "status": "open",
      "messages": [{ "author": "person", "at": "2026-10-09T05:23:32.137Z", "text": "Please reword this." }]
    }
  ]
}
```

`path` is the file name of the document. `anchor.k` is the page key and `anchor.lang` the language. `quote`, `prefix` and `suffix` are the selected words and up to 48 characters on each side, and `start` and `end` are the offsets of the quote in the text as the reader shows it: the lines and paragraph breaks of the page without the `<b>` and `<i>` marks. The words are found again by the quote with its surroundings, the copy nearest `start` when they repeat, and by similarity when the page was edited inside them; a comment whose words are gone is kept, shown at the top of its text and marked as changed. `to` is the unit the comment was sent to, when it was sent. `status` is `open` or `resolved`, and `author` is `person` for what the person writes and the agent's unit for what an agent writes. An agent answers by adding a message to `messages` and may resolve the thread by setting `status`; the file is written whole, so it is read again right before the change.

Open comments are drawn as highlights, with a numbered button in the margin of the page that opens the thread. Clicking highlighted words opens it too. A thread takes replies and is resolved or opened again; a reply to a resolved thread opens it. A resolved thread keeps its button, dimmed, and loses its highlight. A comment file that cannot be read is never replaced: the comment is refused with the reason, and the file is left as it is.

## Send to agent

The comment box and the rail share one choice, Send to agent, remembered in the browser under `localStorage` key `vtr:send`; it is on until the person turns it off, and then it stays off in every box. It names the agent the document's messages go to, with a dot that is green when that agent's wake is on and hollow when it is off, and the same in words for a screen reader. The agent is the one unit that is in for the document's project, an Executor first, found through Relay; the project is the one whose repository holds the document, when routes.md names it and this machine's record gives it a path, or the project whose folder `user/projects/<project>/` holds it. A document with no project, or a project with no unit in, has no agent: the choice is disabled and says "No agent for this document".

With the choice on, the primary button reads "Comment and send". The server saves the comment first and then sends one message as the unit `user`, through the person channel of Relay, with the subject `Void comment: <title> / <page key>`, a body that quotes the selection, gives the comment, the page, the language and the line, and lists the earlier messages of a reply, and the absolute path of the comments file as the attachment. A reply is sent the same way, and resolving sends nothing. A send that fails or has no agent never loses the comment: the box says it was saved and that the message was not sent, and why.

The person's own corrections are sent too, in one message: every save made with the choice on is held, and 20 seconds after the last of them the agent is sent a message with the subject `Void edits: <title>`, listing each page text changed with its text before and after, and the document as the attachment. A text changed several times is listed once, from its first before to its last after, and a text put back as it was is not listed. Turning the choice off drops the corrections still waiting. The page says whether they were sent. A batch still waiting when the server stops is not sent, and the versions file holds the corrections.

## How it is served

One process, Node built-ins only, bound to `127.0.0.1:3302` unless `--port` names another.

| URL | What it serves |
| --- | --- |
| `/?file=<path>` | The reader, opening that document |
| `/api/doc?file=<path>` | GET: the document's `title`, `pages`, the keys of the `edited` pages, the `agent` (`{ unit, awake }` or null) and the comment `threads`, each with its `place` in the page now (`{ start, end, exact }` or null) |
| `/api/save?file=<path>` | POST `{ k, lang, text, base, send }`: saves one text of one page and answers with `edited`, `threads` and the `text` kept; saves run one at a time |
| `/api/comment?file=<path>` | POST `{ op: "add", k, lang, quote, prefix, suffix, start, text, send }`, `{ op: "reply", id, text, send }` or `{ op: "status", id, status }`: answers with `thread`, `threads` and `sent` (`null`, `{ sent: true, to, id }` or `{ sent: false, reason, message? }`) |
| `/api/agent?file=<path>` | GET: the document's `agent` |
| `/api/changes?file=<path>` | GET: the pages with a previous version, each text with its diff as runs of `equal`, `delete` and `insert` |
| `/api/send?file=<path>` | POST `{ send: false }`: drops the corrections waiting to be sent |
| `/api/events?file=<path>` | GET: a server-sent event stream: `ready` once the page is being watched, `doc` (the document, with the `changes` as diff runs), `comments` (the threads) and `sent` (the result of sending corrections) |

The path must be absolute and end in `.json`; an `.orig.json` or `.comments.json` file is refused. Requests are accepted only for the hosts `localhost:3302` and `127.0.0.1:3302`, and with `--lan` for this machine's network addresses on port 3302; a POST with a foreign `Origin` or a cross-site fetch is refused. A request on a network address needs the key printed at start, given once in the link and kept as a cookie; the key changes on every start. The reader loads the Atkinson Hyperlegible face from Google Fonts.

## Keys

Left and Up go to the previous page, Right and Down to the next, Home and End to the first and the last. Plus and minus change the size, 0 resets it. The page number and the size on the rail are typed: Enter goes there, Esc cancels. Esc also closes a comment box or the Changes view, and then leaves editing. In a comment box, Ctrl+Enter or Cmd+Enter sends the field.
