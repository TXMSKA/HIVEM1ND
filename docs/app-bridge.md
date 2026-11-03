# Embedded apps

The desktop Blueprint and Void modes load the published apps in separate
`WebContentsView` instances. Their persistent sessions are
`persist:app-blueprint` and `persist:app-void`. The kit includes no remote app
source. Browser and phone entries open ordinary app tabs without a bridge.

## Implementation files

The native host is in `gui/electron.mjs`, `gui/app-bridge.mjs` and the separate
`gui/app-preload.cjs`; `gui/preload.cjs` connects the verified local viewer.
Shared preferences live in the inert `gui/electron-preferences.mjs`. Only the
direct `gui/electron-entry.cjs` executable starts the desktop or packaged CLI;
importing the host or either entry module starts no app or migration.
The renderer uses `gui/app/embedded-apps.mjs`, with shell, translation and
style changes in `main.mjs`, `i18n.mjs` and `styles.css`. The former Blueprint,
Void, editor-library and find-worker clients and their exclusive tests were
removed; shared markup and the service editor API remain.

The service uses `engine/service/app-bridge.mjs` and `app-agents.mjs`, with
route/event integration in `http.mjs`, `events.mjs` and `local-watch.mjs`.
`engine/relay/person.mjs` adds ordered agent listing and explicit recipients
while retaining the existing API. Tests cover the bridge, native policy,
renderer, person fanout and real filesystem notifications; existing service
route and packaging assertions now reference the embedded renderer module.

## Native boundary

Only the top frame of the exact app origin may call the separate preload's
`window.cosmicBridge`. Methods are restricted by app. Other origins, subframes,
privileged URLs, downloads and browser permissions are denied; clipboard read
and write are the only permission exceptions. External HTTP and HTTPS links
open in the system browser.

The verified local viewer supplies its existing session to the main process.
The main process keeps that credential out of the app and calls
`POST /api/v1/app-bridge/call` with `{app, method, params, clientId}`. The route
uses the existing desktop authorization, Origin, Host and body checks. Reads,
handshakes and project selection create no receipts. File, storage, upload and
agent writes retain idempotency with response metadata only; receipts never
store document responses. Expired receipts are removed in bounded passes at
startup, during mutation activity and every minute. App calls have a separate
180-per-minute budget, leaving the viewer's budget available. Errors delivered
to the app contain only a contract `code`.

`hello {app, appVersion, protocol: 1}` returns `host: "ONEM1ND"`, the package
version, protocol, current locale, colour roles, visibility, the app's exact
method list and the person's name when the existing machine aliases supply it.
The host publishes `host.visible`, `host.locale` and `host.tokens` when they
change. Before closing, it emits `app.save` to loaded apps and waits up to
1.5 seconds for `app.saved`, then closes. An app that has never loaded needs
network access; later offline access depends on that app's service worker.
Same-document navigation on the verified origin preserves the connection,
visibility and viewer credential.

## File method parameters

The agreed contract names methods but does not prescribe their parameter or
result schemas. This implementation uses the following forms. Revisions are
SHA-256 hashes of the exact file bytes. Creating a file requires
`expectedRevision: null`; replacing it requires its last revision. Stale
revisions return `conflict`. Paths must belong to an eligible attached project;
traversal, links, hidden paths and Windows device or stream aliases are refused.

| Method | Parameters | Result |
| --- | --- | --- |
| `blueprint.locations` | `{}` | `[{id,name,path}]`, path is `docs/flows` |
| `blueprint.list` | `{location}` | `[{id,title,location,revision}]` |
| `blueprint.read` | `{location,id}` | `{id,location,document,text,revision}` |
| `blueprint.save` | `{location,id,text \| document,expectedRevision}` | `{id,location,revision}` |
| `blueprint.upload` | `{location,bytes \| base64,mime?}` | `{id,path,mime,size,revision}` |
| `blueprint.asset` | `{location,id}` | `{id,bytes,base64,mime,revision}` |
| `void.files.list` | `{location?}` | `[{path,name,project,size}]`; when bounded, `{entries,truncated:true,limit}` |
| `void.files.read` | `{path,location?}` | `{path,text,revision}` |
| `void.files.write` | `{path,location?,text \| document,expectedRevision}` | `{path,revision}` |
| `void.files.url` | `{path,location?}` | `{path,url,mime,revision}`, a data URL |
| `void.files.asset` | `{path,location?}` | `{path,bytes,base64,mime,revision}` |
| `void.files.attribution` | `{path,location?}` | `{path,by?}` |
| `void.storage.load` | `{key,location?}` | `{value,revision}` |
| `void.storage.save` | `{key,value,expectedRevision,location?}` | `{revision}` |
| `void.open.pick` | `{}` | Native file picker, then read result or `null` |
| `void.open.switchTo` | `{path}` or `{location}` | Read result or project identity |
| `void.project` | `{}` | `{id,name,path}` or `null` |
| `void.export.save` | `{name?,text \| bytes \| base64}` | `{saved,name?}` after native picker |
| `void.export.pdf` | `{name?,bytes? \| base64?}` | `{saved,name?}`, prints the current view when bytes are absent |

`location` accepts an attached project's name, ID, root path or `docs/flows`
path. Void also accepts absolute files within those projects. Otherwise its
paths are relative to the selected project. A single attached project is
selected automatically; with several projects and no selection,
`void.project` returns `null`. Selecting an attached repository in the Map
switches the current Void project. Void storage is local service state,
separated by project and key. Binary data travels through the authenticated
HTTP service as base64 and through native IPC as an `ArrayBuffer` in `bytes`.

Blueprint boards are ordinary `boards/<id>.json` files; reads preserve their
stored text. Saves validate format 4 with Blueprint's schema at `026b172`;
the document ID must match the filename. The agent editor tools write these
same files, including comments in `threads`, with SHA-256 byte revisions and
`conflict` on a stale revision. `expectedCommentsRevision` is the board's
revision too. Module boards remain read-only imports and are never converted
automatically. Assets are `assets/<uuid>.<ext>`.

The contract's section 5 contains no numeric upload limits. The bridge adopts
the existing editor limits: 10,000,000 bytes per image, 200 assets and
50,000,000 total bytes per project assets directory. The existing editor image
validator verifies complete PNG, JPEG and WebP images and their dimensions;
SVG and GIF uploads are refused. Document and storage values are limited to
16,000,000 bytes; native exports to 32 MiB. File discovery omits hidden and
dependency/build directories, lists JSON, Markdown, text, HTML and `.void`
files, and is bounded to 2,000 files and 20,000 directory entries per listing.
The returned `limit` identifies the file or entry bound that stopped a listing.
Native input is checked before serialization; buffers become base64 directly
without expansion into number arrays. Windows path matching, observation and
file locks share one case-insensitive key. The board ID `index` is reserved for
the existing legacy catalog.

## Agents and change events

`agents.list {location}` returns active project units, executor first, as
`[{unit,name,awake}]`. `agents.send` accepts the agreed `kind`, optional `to`,
`document`, `threadId`, `subject`, `body` and `attachment`. A document or
attachment is an existing project file path, `{path}`, or a Blueprint board
ID. It sends through the person's existing channel as canonical `root:master`
and uses the existing editor fanout. No active project unit returns `no_agent`.
The outer request receipt keeps retries from delivering the same message twice.
Agent sends are limited to six per project per minute across app instances,
16 KiB of body text and 32 KiB for the request. Oversized input returns
`invalid`; an exhausted send budget returns `unavailable`.

Service changes travel through the authenticated event stream as `app.bridge`
metadata only to desktop subscribers, outside the durable replay ring, and
are forwarded by the verified viewer before durable cursor filtering or
snapshot buffering. The app receives
`blueprint.changed`, `blueprint.locations`, `void.files.changed`, `void.project`
and `agents.changed`. File changes are batched once per observer pass and agent
changes coalesce for 50 milliseconds into one event per project for both apps.
Known writer units are included as `by`. Saves update the watch baseline, and
the originating app instance filters its own save events. App project selection
produces no broadcast; host project switches are delivered locally after
selection succeeds. Event payloads contain no document bodies.

The native host renews `POST /api/v1/app-bridge/activity` every 30 seconds for
loaded apps, including hidden views, and clears it on signout or disposal.
This internal desktop control route has a separate 12-per-minute budget and
creates no receipt. Activity expires after 90 seconds without renewal. Only
Blueprint's board and asset directories and Void's selected project are
observed, including files absent from the legacy catalog. The observer resumes
bounded slices of at most 400 entries, 32 changed-file reads, 16,000,000 bytes
and a 40-millisecond processing budget, retaining at most 50,000 file records.
Its baseline reads file metadata rather than document bodies. Unreadable and
rejected entries are skipped and counted; observer failures cannot prevent
signature saving or service startup.

## Verification

Run `npm run test:core`, `node --test test/gui-*.test.mjs`, `npm run lint` and
`npm run build`. The standalone native check is
`node test/gui-app-bridge-electron.mjs`; it opens hidden, non-focusable windows
at X=-2560, Y=0 with dimensions 1463x914, loads both published apps, checks the
preload handshake and attempts an offline reload in each partition. It uses
a checkout-local profile, with isolated Windows environment and native Electron
paths. Independent child (110 seconds) and parent (120 seconds) watchdogs bound
the check; every outcome prints one result per app and a final result. It
reports failure if Electron cannot run or the app does not support offline
access. Add `--imports-only` for the no-window regression that imports host and
entry modules in a real Electron browser process without starting the app or
a migration. No dependencies were added.
