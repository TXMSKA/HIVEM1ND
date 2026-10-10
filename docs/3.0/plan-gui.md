# HIVEM1ND 3.0 GUI execution plan

Status: execution specification. Scope: approved plan section 6 and the editor screens of section 5. Execute the numbered steps in order in the caller-supplied isolated GUI worktree, cut from `feat/3.0` after both execution plans are committed. This document authorizes no implementation during task 030.

## File ownership

Every implementation file below is new. This is the complete GUI write boundary. A repeated file in later steps remains owned by this plan; an unlisted file is read-only. Runtime test artifacts are permitted only inside the temporary fixture root.

| File | Purpose | First step |
| --- | --- | --- |
| `gui/app/index.html` | Packaged browser shell | 3 |
| `gui/app/main.mjs` | Mount, navigation, lifecycle | 3 |
| `gui/app/api.mjs` | Authenticated HTTP and operation identity | 2 |
| `gui/app/stream.mjs` | SSE parsing, replay and reconnect | 2 |
| `gui/app/state.mjs` | Projection, selections and drafts | 2 |
| `gui/app/i18n.mjs` | English and neutral Spanish copy | 3 |
| `gui/app/styles.css` | Approved looks and responsive layout | 3 |
| `gui/app/components.mjs` | Safe DOM, icons, dialogs and feedback | 3 |
| `gui/app/lists.mjs` | Search, paging, windowing and folding | 4 |
| `gui/app/map-geometry.mjs` | Placement, coordinate conversion and hits | 5 |
| `gui/app/map.mjs` | Map gestures, selection and layout saves | 5 |
| `gui/app/hierarchy.mjs` | Hierarchy and project groups | 4 |
| `gui/app/chats.mjs` | Chat and mailbox presentation | 7 |
| `gui/app/inspector.mjs` | Unit, session, grants and deliveries | 8 |
| `gui/app/actions.mjs` | Confirmed desktop actions | 6 |
| `gui/app/settings.mjs` | Persistent settings and home access | 12 |
| `gui/app/qr.mjs` | Independent bounded browser QR encoder | 12 |
| `gui/app/qr-render.mjs` | Accessible local QR rendering | 12 |
| `gui/app/phone.mjs` | Phone exchange and restricted navigation | 13 |
| `gui/app/embed.mjs` | Viewer-specific embedding channel | 13 |
| `gui/app/editors.mjs` | Catalog, attachment, comment and Watch UI | 9 |
| `gui/app/blueprint.mjs` | Blueprint Lite presentation and editing | 10 |
| `gui/app/void.mjs` | Document, text editing, proposals and Focus | 11 |
| `gui/app/markup.mjs` | Safe rich-text tokens and offset mapping | 11 |
| `test/gui-fixture.mjs` | Standalone contract fixture and test controls | 1 |
| `test/gui-data.mjs` | Contract records, temporary disk seed and scenarios | 1 |
| `test/gui-fixture.test.mjs` | Fixture contract and isolation checks | 1 |
| `test/gui-transport.test.mjs` | API, snapshot, SSE and expiry checks | 2 |
| `test/gui-map.test.mjs` | Map geometry, gestures and save races | 5 |
| `test/gui-actions.test.mjs` | Unit, session, chat, approval and task checks | 6 |
| `test/gui-editors.test.mjs` | Editor, unknown-field, offset and proposal checks | 9 |
| `test/gui-shell.test.mjs` | Copy, look, QR, phone and embedding checks | 3 |
| `test/gui-browser.md` | Concrete browser scenarios and recorded results | 3 |

The core owns `gui/index.mjs`, the setup server if a host adjustment is necessary, package exports, service asset delivery, all engine/CLI/editor persistence code, migrations, installer scripts and project documentation. Preserve the existing `gui/index.html`, `gui/app.js` and `gui/styles.css` setup wizard. Do not edit any other file, add a package, change a script or import an engine/core source module.

The only shared interface is [the contract](contract.md). The browser receives its existing `HomeGrant.qrPayloads` strings and encodes them independently; the core also owns its own QR encoder for service use. This bounded duplication avoids a new shared source dependency, asset ABI or API route. It is intentional; neither implementation imports the other.

## Evidence and execution rules

Read the full contract, the approved private `plan-3.0.md`, the final Agreed sections of `brainstorm/relay-graph-vision.md`, and `screens-3.0/index.html` before step 1. The final Modern decision overrides the earlier Traditional/Softer decisions. The private sources are design inputs, never output locations.

| Existing source | Audit result and boundary |
| --- | --- |
| [Files](../../files.md), state/message/task sections | `user/` remains the private directory; units, chats and mailboxes are distinct; review gating belongs to the core |
| [Wizard page](../../gui/index.html), [wizard client](../../gui/app.js), [wizard server](../../gui/server.mjs) | Separate setup flow; its sessionStorage token and legacy envelopes must not be copied into the new app |
| [CLI](../../cli/index.mjs), setup handler at line 843; [desktop caller](../../gui/electron.mjs), line 97 | Both call the setup server; replacing wizard assets would break existing callers |
| [Blueprint format](../../features/blueprint/review/sketch-format.mjs), `validateSketch`, `renderScreen` | Useful geometry and format evidence; strict optional-field rejection and unauthenticated image URLs are incompatible with v3 |
| [Blueprint server](../../features/blueprint/server.mjs), sketch/comment handlers; [Blueprint checks](../../test/blueprint-sketch.test.mjs) | Standalone editor and legacy sidecar conventions; persistence changes belong to core |
| [Void reader](../../features/void/reader.html), `rich`, `inline`, navigation; [Void server](../../features/void/server.mjs), comments/version handlers; [Void checks](../../test/void.test.mjs) | Safe `b`/`i` rendering and stable page keys are retained; external font/icon requests and old routes are not |
| [Existing HTTP checks](../../test/interfaces-server.test.mjs) | Node test runner, temporary roots, real HTTP requests and `context.after` cleanup conventions |
| [Package](../../package.json) | Node 22+, plain modules and current dependencies; there is no browser build tool or browser test dependency |
| Reference only: the uncommitted 2.x GUI attempt in a local worktree outside the repo | Prior host/layout ideas only; rectangular rank layout, unit-as-chat projection and shared LAN authority are not adopted |

For each step, search at least three variants of the relevant symbol and trace both callers and callees before editing. Use `rg` when available; otherwise use `Select-String`. Read every file being changed in full when it is below 1000 lines; for larger files locate the region first, then read it and its callers. Read a neighboring file to retain conventions. New modules export only functions actually consumed by another module or a meaningful test.

All identifiers, code, comments and commits are English. Declare English as the UI base language; every new user-facing string has a neutral, professional Spanish translation at the same time. Wire enums remain English. Do not put client/model product names into explanatory prose or example copy; client enum values and existing file paths remain literal contract values. Do not use em dashes.

Use only Node built-ins, browser standards and current installed dependencies. No CDN, external font, analytics, QR service or runtime network dependency. Never start an OS login registration or an actual native session during GUI checks. Every fixture uses a real temporary mind, origin, repository and Cosmic directory; no test writes into the real mind. Close only fixture servers/streams and processes this test started.

Commands below are future execution gates, not evidence that task 030 implemented or ran the app. Run from the supplied worktree with PowerShell; `npm.cmd` avoids the machine's blocked `npm.ps1`. Finish each step's gate before its commit; commit only the listed files touched by that step, never push or merge from this plan.

## 1. Build the standalone contract fixture

Create `test/gui-data.mjs`: `createFixtureTree`, `seedRecords` and `scenarioData`. Use `mkdtemp(join(tmpdir(), "hivem1nd-gui-"))`; beneath it create `Cosmic/hivem1nd/user`, `Cosmic/hivem1nd-service`, `origin` and `repositories/shop`. Store representative exact-byte state, chat, task, layout, settings, editor and sidecar files. Hash actual bytes with SHA-256; never use a short legacy editor revision. Return only fixture-owned paths and a cleanup function that verifies each resolved target is inside the created root before recursive removal.

Seed canonical master, one root Overseer, an environment Overlord, an executive, Adjutant, Genesis, Incubator, duplicate display names in two projects, one unavailable machine, one live and one stopped session, direct/group/unlisted chats, mailbox history, approvals in every state, lead-gated and reviewable deliveries, a full-field board, a read-only module resource, bilingual Void text and proposals. Generate scenario sizes `1`, `4`, `40`, `400` and `1200`, including empty collections and malformed-entry issues.

Create `test/gui-fixture.mjs`: `createGuiFixture({size,scenario,now})` using `node:http`, `node:crypto`, `node:fs/promises`, `node:path`, `node:os`, `node:url` and test-owned helpers only. Return `{origin,desktopUrl,phoneUrl,headers,control,close,root}` to tests. The fixture imports no CLI, engine, feature server, migration or host entry. Browser app pure modules may be imported where useful, but the fixture must implement validation independently enough to catch a malformed client request.

Serve only `gui/app/index.html` at `/` and `/gui/:viewerId/`, and the exact owned packaged app asset filenames from an explicit static map. While executing early steps, an app asset not yet created returns 404 on request without preventing fixture startup; initial fixture tests exercise the API only. Never generate a fake app file or read every future asset eagerly at startup. Enforce exact loopback Host and optional Origin, require Origin on protected writes, use the contract static security headers and viewer-specific frame policy. Do not serve arbitrary filesystem paths or directory listings. JSON success and errors have precisely these boundaries:

```js
function success(data, requestId, eventCursor, sync = "local") {
  return { contract: "hivem1nd-gui-v3", data,
    meta: { requestId, readAt: clock().toISOString(), eventCursor, sync } };
}
function failure(code, message, requestId, details = {}, retryAt = null) {
  return { error: { code, message, requestId, details, retryAt } };
}
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const hashBody = (body) => sha256(JSON.stringify(canonical(body)));
```

Implement contract sections 3.3 to 3.6 and 6.3 routes used by the app, keeping exact method/query/body/output schemas in the contract rather than inventing a second shared route file. GET coverage includes view, units, leads, squads, projects, machines, sessions, sync, layout, chats/messages, mailboxes/messages, approvals/answers/grants/revocations, tasks, waiting, settings, both editor catalogs/details, attachments/comments/assets/proposals and viewer. Mutation coverage includes units/lead/session/stop, layout, chats/post/read/manage, mailboxes/post/read, approval answer, grant revocation, task status/undo, settings/home, logout, editor register/create/replace/nodes/ranges/assets, attachments/comments/proposal answer, Watch and viewer. `/auth/local` and `/auth/home` use their exact exchange bodies; the fixture has no public approval-request control route.

Create route handlers incrementally as their screen steps are reached. Step 1 implements the seeded collection/detail reads, settings/viewer bootstrap, SSE, and layout plus message/read mutations needed for its stated wire tests; later screen steps implement their remaining mutations before those gates run. The initial handler inventory rejects unsupported methods with exact Allow, unknown query/body keys with the documented error, and missing routes with `404 not_found`. Contract list order, search fields, default filters, opaque cursor validation and `cursor_expired` are required. A cursor contains a filter hash, snapshot hash and position; filter changes are invalid, snapshot changes expire it. A failed individual record produces an issue while valid records remain available.

Serialize mutations through one global fixture mutation queue, covering every resource, principal and idempotency key. Compare the route's exact revision field before writes, write a sibling temporary file then rename, and emit events only after success. Receipts key by stable fixture principal plus idempotency UUID, not token; compare method/path/canonical body, return the original response on exact retry, and persist ordinary receipts beneath the temporary local directory so fixture restart can prove retry behavior. Authentication receipts are absent; home receipts remain memory-only. Include separate comments/attachment revisions. No failed or repeated mutation emits a second event.

The fixture mutation dispatcher has this order; each named handler supplies its exact contract validation and changes, not a generic success stub:

```js
async function mutate(request, route, body) {
  const principal = authenticate(request);
  authorize(principal, route, body); // phone/agent/object membership checks precede receipt return
  validateExactBody(route, body);
  const key = requireUuid(request.headers["idempotency-key"]);
  return enqueueMutation(async () => { // single global queue, including concurrent cross-route key reuse
    const previous = await receiptFor(principal.id, key);
    const identity = { method: request.method, path: route.requestPath, bodyHash: hashBody(body) };
    if (previous) {
      if (!sameIdentity(previous, identity)) throw domainError(409, "idempotency_conflict");
      return { status: previous.status, response: previous.response };
    }
    await route.checkPreconditions(body); // correct expectedRevision/comments field or runtime identity
    const prepared = await route.prepare(body, principal); // normalized write bytes and final projected data
    const response = prepared.status === 204 ? null
      : success(prepared.data, requestId(), plannedCursor(prepared.events.length), prepared.sync);
    if (route.runtime) {
      if (route.homeGrant) saveMemoryReceipt(principal.id, key, identity, prepared.status, response);
      else await saveReceipt(principal.id, key, identity, prepared.status, response);
      applyRuntimeChange(prepared); // prepared runtime changes cannot perform file writes or fail validation
      publishRuntimeEvents(prepared.events);
    } else {
      const intent = { id: transactionId(), principalId: principal.id, key, identity,
        writes: prepared.writes,
        receipt: { status: prepared.status, response, createdAt: clock().toISOString(),
          expiresAt: new Date(clock().valueOf() + 86400000).toISOString() },
        events: prepared.events, phase: "prepared" };
      await saveIntent(intent); // durable before the first resource write
      await finishIntent(intent); // exact prepared bytes, receipt and unique event records
      publishNewEventRecords(intent); // no emit from GET or receipt replay
    }
    return { status: prepared.status, response }; // 204 writes no response body
  });
}
```

`route.requestPath` is the validated concrete request pathname with its actual canonical IDs, not the route pattern. A repeated key on two different resources conflicts even when their bodies are equal. Keep receipt lookup, preparation, journal completion and event publication inside the single queue; do not replace it with resource-only locking.

Create `saveIntent`, `finishIntent`, `recoverIntents` and `publishNewEventRecords` in this same fixture module. `writes` is `[{path,beforeRevision,afterRevision,afterBytesBase64}]` with resolved fixture-owned paths and hashes of the exact bytes. Preparation chooses every message/comment/task/change ID, status, response body and event once. `saveIntent` atomically persists the complete record in the fixture's temporary local transactions directory before applying any write. `finishIntent` accepts only each file's prepared before/after hash, writes missing after bytes through siblings, then atomically saves the exact receipt. A third hash fails with an explicit fixture journal conflict rather than overwriting unrelated bytes.

Append event records with stable internal keys `<transactionId>:<eventIndex>` to a durable test-owned event ledger before broadcasting them; those internal keys never alter the public SSE envelope/ID. Mark intent committed after its writes, receipt and event records are durable. Existing ledger entries are never emitted again for retry/recovery. A crash between durable event recording and broadcast is resolved by startup snapshot/reset, not a duplicate logical mutation. `recoverIntents` completes prepared intents before accepting requests or projecting resources and never regenerates IDs, response/status or receipt expiry. Rebuild projection from recovered bytes. A renewed fixture viewer token retains the same stable principal ID for receipt lookup while service restart still rotates session tokens/cursors.

Runtime preparation has no synced/file resource writes. Home grant receipts remain memory-only; other runtime receipts use the ordinary fixture receipt store, and restart clears transient viewer/Watch/home state according to the contract. Home keys, short codes and links are never put into an intent, ordinary receipt or event ledger. Logout/Watch 204 retain the original empty-body outcome. Synthetic control events use the same queue so planned cursors cannot be overtaken during commit.

Expose only in-process controls: `control.emit(name,data,source)`, `advance(ms)`, `changeResource(id,change)`, `setFault({method,path,status,code,once,dropAfterCommit,crashAfterDataBeforeReceipt})`, `disconnectStreams()`, `restart()` and `revokeViewer(id)`. They let tests drive sync, activity, delayed answers, expiry, stale revisions, rate-limit Retry-After, a lost response and the journal fault. CLI `--scenario` supports `standard`, `empty`, `large`, `high-contrast`, `spanish`, `offline`, `stale-layout`, `editor-conflict`, `approval-expiry`, `home-expiry` and `embedded`. High-contrast/spanish seed the corresponding settings before mounting; stdin accepts documented fixture scenario commands without adding production HTTP endpoints.

Two fixture listeners may model desktop and home audiences on loopback for deterministic tests. Label this a transport simulation: production private-interface binding/subnet checks are core integration checks, not proven here. Still reject desktop/agent tokens on the home audience, forbid phone writes server-side, validate each listener's own exact authority/Origin and redact sensitive phone payloads. A browser phone token cannot become desktop by widening its viewport.

Create `test/gui-fixture.test.mjs` using real requests and `context.after`. Check exact envelope, valid SHA revisions, issue tolerance, own-root cleanup, Host/Origin/token errors, idempotency conflict, stale writes unchanged on disk, read non-consumption, paging expiration, event visibility and phone forbidden writes. Send the same principal/key concurrently to two different concrete routes/resources: exactly one commits and the other returns 409 idempotency_conflict. Inject crashAfterDataBeforeReceipt, restart on the same temporary root, obtain a renewed viewer token for that principal and retry the original operation: the exact prepared response/status/ID is returned, there is one resource mutation, one receipt and one logical event per prepared event key. Check the fixture import graph contains only its allowed sources. CLI prints its origin and saves generated viewer fragment links in a temporary owner-only `links.json`, avoiding token output in logs; Ctrl+C closes its own resources and cleans up.

**Check:** `node --test test/gui-fixture.test.mjs` exits 0 with no failed/skipped tests; all created disk paths resolve under the returned root. **Commit:** `Add the isolated GUI contract fixture`.

## 2. Implement authenticated requests, streaming and state

Create `gui/app/api.mjs`: `createApi`, `createOperation`, `request`, `retryOperation`, `fetchAsset` and `dispose`. Read `session` or `home` from the fragment once, immediately call `history.replaceState` preserving pathname and ordinary search, and keep credentials only in memory. Home is exchanged before protected reads in step 13. A reload after fragment removal shows the reopening/code-entry screen; never recover a token from storage. Never include tokens in query strings, errors or postMessage.

`createOperation` freezes `{id,method,path,body}` once for an explicit user action. Every mutation, including DELETE JSON and viewer/Watch/logout, uses that operation's `Idempotency-Key`; auth exchanges are exempt. Retry the same operation with exactly the same bytes/body. A conflict correction is a new user operation and a new key. GET uses no key. Encode each path ID once with `encodeURIComponent`; do not substitute labels or raw resource paths.

```js
function operationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
// getRandomValues also works for the plain HTTP home view.
// No randomUUID-only dependency on a secure browsing context is allowed.
```

`createApi` fixes its base to `${location.origin}/api/v1`. All API examples such as `/auth/local`, `/layout`, `/watch` and `/viewer` are contract route suffixes: append the validated suffix to that base exactly once, including auth exchanges and the event stream. Reject arbitrary absolute/network-relative URLs and an already-prefixed `/api/v1` suffix; never resolve a leading slash with `new URL(path, base)` because that discards the API prefix. The browser never calls `/mcp`. `Asset.url` follows its separate contract URL rule: resolve it against the current origin, verify the resulting same-origin asset URL before attaching a bearer, and fetch that verified URL without another API prefix.

Fetch with Authorization and application/json for a defined body. Accept 204 before JSON parsing, validate success contract/meta and safe error shape, and surface status/code/details/retryAt. Retry UI honors Retry-After and preserves drafts. Only network/unknown-outcome retries reuse a key; do not automatically repeat a rejected approval, task transition, session start or proposal with a new key. Fetch verified image bytes with the bearer, check MIME, then create/revoke a blob URL.

Create `gui/app/stream.mjs`: `createSseParser`, `subscribe`, `synchronize` and `close`. Use fetch streaming with Authorization and Last-Event-ID, never EventSource query credentials. Support UTF-8 split chunks, LF/CRLF/CR, comments, multiple data lines, empty fields and EOF without dispatching an incomplete frame. The parser's line-boundary core is:

```js
let line = "", afterCR = false;
function pushCharacters(text) {
  for (const character of text) {
    if (afterCR) {
      afterCR = false;
      if (character === "\n") continue;
    }
    if (character === "\r" || character === "\n") {
      acceptLine(line); line = "";
      afterCR = character === "\r";
    } else line += character;
  }
}
// acceptLine: blank dispatches a nonempty data frame and clears frame fields;
// ':' is a comment; split other lines at the first ':' and remove one space;
// join data values with LF; ignore IDs containing NUL; retain unknown events.
```

Validate `hivem1nd-events-v3`; an unknown additive event triggers no crash. Decode using `TextDecoder.decode(chunk,{stream:true})`. Bound a frame to the 16 MB snapshot/resource ceiling and fail visibly rather than accumulating unlimited data. Close reader/AbortController on navigation disposal, logout or revocation. There is one app stream, below the four-stream ceiling.

Create `gui/app/state.mjs`: `createStore`, `applyEvent`, `loadSnapshot`, `invalidateCollection`, `loadResource` and `setDraft`. Index units/chats/tasks/editors by canonical ID, maintain selected IDs, viewport and drafts separately from authoritative objects. Status/rollups/reviewable/answers come from the service; do not recompute authority from names or timestamps.

Open the stream and buffer events before snapshot reads. `/view` captures `meta.eventCursor` before file reads; after loading the snapshot and open resources, apply buffered events newer than that cursor. Compare cursor sequence only within one service-start UUID; never order SHA hashes. Equal resource revisions are duplicates; a differing revision schedules a deduplicated GET, whose request generation must still be current before committing its result. A dirty editor keeps its draft and shows an outside-change conflict.

On `stream.reset`, pause applying later events, clear stale cursor/page caches, refetch view/open editor/comments/attachments/settings/viewer as applicable, then drain the buffer. `413 view_too_large` switches to documented collection paging instead of rendering a partial view as complete. Reconnect with exponential delays 1, 2, 4, 8 and 15 seconds capped, randomized within 20%, no interval polling. 401/410 ends reconnect and clears credentials; 429 uses Retry-After. Keep offline drafts and uncertain operation IDs in memory and offer explicit retry after connection returns.

Create `test/gui-transport.test.mjs`: assert exact requested URLs for `/auth/local`, `/auth/home`, `/layout`, `/viewer` and the stream all begin with one `${location.origin}/api/v1` prefix. Assert a canonical ID containing reserved characters is encoded once in its route segment, already-prefixed/absolute URLs fail before fetch, and a verified Asset.url is used directly without a second prefix. Split a Unicode event at every byte boundary, mix line endings/keepalives, replay then reset, change snapshot during GET, deliver the same revision twice, return late GETs out of order, drop a committed mutation response, revoke/expire token and reset a 400-item list. Inject fetch/clock into pure code, but use the real fixture for wire behavior and lost responses.

**Check:** `node --test test/gui-fixture.test.mjs test/gui-transport.test.mjs` exits 0; lost-response retry produces one persisted record and one event; reset reaches the latest state without dropping or applying older data. **Commit:** `Add authenticated GUI transport and live state`.

## 3. Build the approved bilingual shell

Create `gui/app/index.html` with lang en, viewport, title, stylesheet `/app/styles.css`, an accessible loading main/status region and module script `/app/main.mjs`; no inline application script or style, remote imports or token markup. Both core and fixture explicitly map `/app/<owned app asset filename>` to `gui/app/<filename>` under the contract's allowlisted packaged-assets rule. Module-relative imports resolve beneath `/app/`; the identical shell works at `/gui/:viewerId/` and `/`. This is packaged static delivery, not another data API.

Create `components.mjs`: `element`, `icon`, `showDialog`, `showError`, `announce` and `setBusy`. Build record content with textContent. Static vetted SVG icons use createElementNS and hardcoded paths, never uploaded SVG or interpolated HTML. Native dialogs trap focus, offer Cancel, restore the invoking control, and support Escape. Async disabling applies only to the affected action, never the entire app.

Create `i18n.mjs`: `text(language,key,variables)` and complete equal-key `en`/`es` dictionaries. Include all status, empty, loading, conflict, unavailable, confirmation, expiry and permission copy. Initial entries include Map/Mapa, Hierarchy/Jerarquía, Chats/Chats, Waiting/Pendientes, Approve/Aprobar, Approve always/Aprobar siempre, Deny/Denegar, Accept/Aceptar, Send back/Devolver, Watch/Seguir, Document/Documento, Focus/Concentración, High contrast/Alto contraste and Settings/Configuración. Public copy is professional and impersonal; explain queued/submitted/ambiguous/failed without claiming that a reply already occurred.

Create `styles.css` from the approved set A and set M, adapting fixed frames to a usable responsive app. Modern defaults to layered floating panels, 20px panel radius, 12px gaps, pill controls and soft shadows. High contrast uses the approved black surfaces, strong borders and gold accent. Define all colors, radii, spacing and focus indicators as tokens; component CSS uses tokens only.

| Token | Modern | High contrast |
| --- | --- | --- |
| `--bg` | `#0f0b13` | `#050505` |
| `--panel` | `#18121d` | `#0b0b0b` |
| `--card` | `#211a27` | `#141414` |
| `--card2` | `#2b2232` | `#1b1b1b` |
| `--text` | `#f5f1f6` | `#f1efe9` |
| `--body` | `#d4ccd8` | `#c9c6bf` |
| `--mute` | `#aa9fb1` | `#8f8b85` |
| `--accent` | `#bdcd79` | `#d4b06a` |
| `--accent-ink` | `#1b200b` | `#1b1408` |
| `--ring` | `#a48aaf` | `#d4b06a` |
| `--working` | `#8fd19e` | `#8bc28a` |
| `--waiting` | `#e6c06f` | `#d4b06a` |

Use system font fallbacks; the screen's hosted font requests are not runtime dependencies. Desktop shell: bar 52px, footer 30px, left panel near 266px, flexible Map with min-width 0, inspector near 366px. At narrower desktop widths inspector opens as a dismissible panel; a desktop credential remains desktop. Phone capability determines the restricted layout. Scroll containers need min-height 0 and actual overflow, not the mockup's clipped sample lists. Add visible text/icons for status, not color alone, 44px phone targets, reduced-motion support and usable 200% zoom.

Create `main.mjs`: `mount`, `navigate`, `renderShell` and `dispose`. At this step import only modules already created in steps 1 to 3; render the shell and authenticated snapshot summaries, with a localized temporary panel message for screens whose implementation is not yet reached. Do not import nonexistent Map/editor/settings modules or pretend their interactions work. Each later step adds its completed module to the navigation/mount registry in main.mjs and removes that panel message. These are temporary construction states, never final features; step 14 verifies every production mode renders its completed module.

The finished shell mounts real state into Map, Blueprint, Void and Settings; Hierarchy/Chats stay left and the selected inspector right. No Sessions, Console or Reports screen. When no selection exists, render meaningful empty inspector guidance. Footer shows service/sync issues and last read time from API metadata without polling origin. Render unread/waiting counts from complete projection data. Effective presentation is the desktop viewer override if nonnull, otherwise shared settings. Get/PATCH viewer and the embed channel run only with viewer.write capability; phone boot reads its permitted settings and keeps drafts locally.

Create `test/gui-shell.test.mjs` for equal translation keys, unknown-key failures, no external assets/token storage, capability layout selection and presentation precedence. Create `test/gui-browser.md` with result rows for the scenarios in this plan, including viewport/look/language, expected result, observed result, failure and evidence location. Browser checks are mandatory because Node tests cannot prove scrolling, focus or visual matching.

**Check:** `node --test test/gui-shell.test.mjs` and `npm.cmd run lint` exit 0. Start `node test/gui-fixture.mjs --scenario standard`; use its temporary links file to open the desktop link at 1440x900 and 1024x768, then at 200% zoom. Repeat with `--scenario high-contrast` and `--scenario spanish` until the settings UI exists in step 12. Modern shell proportions/palette match set M and High contrast set A, with no clipped inspector shell or console errors; later gates verify the completed screen interiors. Record actual observations in `test/gui-browser.md`. **Commit:** `Add the approved bilingual GUI shell`.

## 4. Make every collection searchable and scalable

Create `gui/app/lists.mjs`: `createPagedList`, `loadNext`, `setQuery`, `windowRange` and `renderWindow`. Use documented list routes with q/limit/cursor and exact route-specific filters. Search after 150ms quiet, cancel stale fetches and keep a request generation so an old query cannot overwrite a newer one. Fetch 100 rows per page, stop only at null nextCursor, show total/issues and explicit loading/empty/error states. 409 cursor_expired reloads the current filtered list from page 1 and restores focus by ID; 400 invalid_cursor does not become an infinite retry.

```js
function windowRange(scrollTop, height, rowHeight, count, overscan = 8) {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}
```

Window compact fixed-height unit/chat/task/editor/search rows only. Chat message bodies and comments have variable heights: page older history, render bounded batches and preserve a measured scroll anchor rather than pretending they share fixed height. Preserve roving keyboard focus/aria-posinset/aria-setsize by ID; bring a focused offscreen row into the window. Render fewer than 100 compact rows at a 900px viewport even with 1200 records. There is no 100-item truncation masquerading as complete.

Create `hierarchy.mjs`: `buildHierarchy`, `flattenVisibleHierarchy`, `toggleGroup` and `activateUnit`. Derive relationships from canonical leadId, never chat membership or client names. Visited IDs prevent legacy cycles from recursing forever; show the supplied issue. Render one root Overseer; duplicate legacy Overseer entries are issues, not extra cards. Adjutant/executive appear beside that line; Genesis/Incubator form Services. Units with no Overlord ancestor group by their project; environment/root loose units use their own scope heading.

Fold large groups, initially show 8 members, and expose localized Show N more. Search reveals matching ancestors/groups without permanently changing the locally folded state. Display active records first using contract list order; do not hide out/unknown units from search. Single click selects; double click centers the Map, selects the node and opens its direct chat in the inspector. On phone, select an existing chat only; do not create a conversation.

Extend `state.mjs`, `main.mjs` and `test/gui-shell.test.mjs` with paging fallback and generation tests. Add tests for 1/4/40/400/1200 rows, duplicate labels in different scopes, folded searched items, cycles, q changes during fetch, expired cursor and keyboard navigation to the final item.

**Check:** `node --test test/gui-shell.test.mjs test/gui-transport.test.mjs` exits 0. Fixture scenario large: search for the 1200th unit, expand its group and activate it by keyboard; total remains correct, fewer than 100 compact rows are mounted, and results remain correct after an incoming list change. Record scrolling/focus in `test/gui-browser.md`. **Commit:** `Add searchable and bounded GUI lists`.

## 5. Implement free Map placement and exact hit testing

Create `map-geometry.mjs`: `initialPositions`, `toWorld`, `toScreen`, `hitNode`, `marqueeIds`, `edgeEndpoints` and `fitBounds`. Initial missing positions use sorted canonical IDs, compact circles and separated scope groups, not a top-down rectangular tree. Keep every saved position unchanged and never persist automatically merely by opening the Map.

```js
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function initialPositions(units, saved, groupOrigins) {
  const positions = structuredClone(saved.nodes ?? {});
  const buckets = new Map();
  for (const unit of [...units].sort(byId)) {
    if (positions[unit.id]) continue;
    const key = groupKeyForUnit(unit); // canonical scope/Overlord ancestry
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(unit);
  }
  for (const [key, members] of [...buckets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const origin = groupOrigins[key];
    members.forEach((unit, index) => {
      const ring = Math.floor(index / 8) + 1;
      const angle = (index % 8) * Math.PI / 4 - Math.PI / 2;
      positions[unit.id] = { x: origin.x + Math.cos(angle) * ring * 96,
        y: origin.y + Math.sin(angle) * ring * 96 };
    });
  }
  return positions;
}
const toWorld = (client, rect, view) => ({
  x: (client.x - rect.left - view.x) / view.zoom,
  y: (client.y - rect.top - view.y) / view.zoom,
});
function hitNode(point, nodes, zoom) {
  return [...nodes].reverse().find((node) =>
    Math.hypot(point.x - node.x, point.y - node.y) <= node.radius + 6 / zoom) ?? null;
}
function marqueeIds(a, b, nodes) {
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  return nodes.filter((n) => n.x >= left && n.x <= right && n.y >= top && n.y <= bottom)
    .map((n) => n.id); // center inclusion is the deterministic selection rule
}
```

Build `groupKeyForUnit` from the already indexed canonical hierarchy: an Overlord and units with that Overlord ancestor use a local `lead:<UnitId>` bucket; units without one use `project:<name>`, `env:<name>` or the local `root` bucket. Persisted group keys are only project/environment keys allowed by the contract; squad/root buckets and their visual outlines are derived locally, never submitted as unknown group IDs.

Before bucketing, place missing root master/Overseer near `{x:380,y:56}` and `{x:380,y:160}` and missing Adjutant/executive along that line; mark them positioned so the ring algorithm does not place them a second time. Genesis/Incubator form a services bucket. `groupOrigins` uses a persisted scope group's x/y when present, otherwise sorted buckets at `{x:220+(index%3)*360,y:360+floor(index/3)*360}`. A squad whose lead already has a saved position uses that lead's saved position as its visual center, retaining every member's saved coordinate. Persisted collapsed state applies only to its scope group. Outlines contain visible saved members, even after free movement outside the initial ring; never drag members back into a derived group automatically. All fallback placement is repeatable for an identical snapshot. Bound coordinates to contract finite -100000..100000 values.

Create `map.mjs`: `renderMap`, `pointerDown`, `pointerMove`, `pointerUp`, `cancelGesture` and `centerUnit`. Draw SVG relationships behind circles and DOM node buttons above; render edges from lead to subordinate and trim lines at circle radii. Labels are compact with details in the inspector. Pan/zoom is browser-local, bounded 0.25..2.5; wheel zoom around the pointer preserves its world coordinate. Use CSS pixels independently of devicePixelRatio.

Body drag moves a circle; its explicit outer connection handle starts a connection from that source. Empty-space drag starts a marquee. Pointer capture owns the gesture; Escape/pointercancel discards it and restores the pre-drag positions. A 4px client-space threshold distinguishes click from drag. Shift adds/toggles selection. Dragging several selected nodes applies one world delta to their baseline positions, not accumulated pointer deltas. Group selection offers Message as group and Connect actions. Provide equivalent keyboard controls: Enter opens inspector, Space toggles selection, arrows move a selected circle by 10 canvas pixels, Shift+arrows by 1, and a named Connect button opens the same confirmation flow.

Create `test/gui-map.test.mjs`: deterministic saved/missing coordinates, circles in overlapped draw order, pan/zoom/DPI transformations, reverse marquee, group delta, pointer cancellation, group collapse, edge trimming and keyboard movement. Test actual controller handlers with a minimal event target and request adapter, not assertions against source text.

**Check:** `node --test test/gui-map.test.mjs` exits 0. Browser: move one circle locally, select three in a reverse-direction marquee, zoom and drag again, cancel a drag with Escape, double click Hierarchy and verify center/selection. Step 6 adds persistence and step 7 adds direct-chat activation; do not call those incomplete actions in this gate. No rectangular tree replaces free placement. Record both looks in `test/gui-browser.md`. **Commit:** `Add free Map placement and selection`.

## 6. Add race-safe layout, connections, units and sessions

Extend `map.mjs`: `queueLayoutPatch`, `flushLayout`, `applyRemoteLayout` and `refreshCurrentLayout`. Keep an authoritative `{layout,revision}`, one in-flight operation, an authoritative observation generation, and pending per-ID edits tagged with monotonically increasing local edit generations. Capture each edited ID's authoritative base coordinate on its first unsaved edit. The response to an older save must not erase a newer drag or a remote observation received after that commit.

```js
async function flushLayout() {
  if (inFlight || pending.size === 0) return;
  const batch = new Map(pending);
  const nodes = Object.fromEntries([...batch].map(([id, edit]) => [id, edit.position]));
  const operation = api.createOperation("PATCH", "/layout", {
    nodes, expectedRevision: authoritative.revision,
  });
  const observedAtDispatch = layoutObservationGeneration;
  inFlight = operation;
  try {
    const result = await api.request(operation);
    if (layoutObservationGeneration === observedAtDispatch) {
      authoritative = result.data;
      layoutObservationGeneration += 1;
    } else {
      await refreshCurrentLayout(); // an SSE observation may be newer than this HTTP response
    }
    for (const [id, edit] of batch) {
      if (pending.get(id)?.generation === edit.generation) pending.delete(id);
    }
    renderPositions(overlay(authoritative.layout.nodes, pending));
  } catch (error) {
    if (error.code === "revision_conflict") await reconcileLayoutConflict(batch);
    else retainRetryOperation(operation); // unknown outcome retries the frozen body/key
  } finally {
    inFlight = null;
  }
  // Continue only successful/uncontested pending work, never an unresolved conflict.
  if (!layoutConflict && !retryOperation && pending.size) queueMicrotask(flushLayout);
}
```

`applyRemoteLayout` accepts only a newer processed event cursor within the same service-start UUID, updates authoritative data and increments layoutObservationGeneration. `refreshCurrentLayout` uses the step 2 snapshot/buffer procedure and GET generation guard: an observation arriving during its GET invalidates that response, drains the buffered newer event and coalesces a latest GET rather than overwriting it. Differing hashes never establish age. Until a current refresh succeeds, leave successful-batch cleanup queued and block another flush; failure keeps the draft and the successful operation identity available for explicit reconciliation.

`reconcileLayoutConflict` GETs latest layout through the same guard. Unrelated remote coordinates are retained. An edited ID whose remote coordinate equals its captured base can retry once with the newest revision and a new operation; a remotely changed same ID prompts Keep local position or Use incoming position. Keep local is explicit and uses the newly fetched revision; Use incoming removes only that pending ID. Groups use the same queue/generation logic, with a separate groups patch field. Do not PUT the whole layout, delete unrelated coordinates, compare hash order or spin on repeated 409s. Apply incoming layout while overlaying still-pending edits; defer conflicting IDs until resolved.

Create `actions.mjs`: `connectUnits`, `createUnit`, `startSession`, `stopSession` and `trackSessionRequest`. On dragging source A onto target B, show the exact localized relationship “B will report to A.” Confirm before `PUT /units/:B/lead` with `{leadId:A,confirmed:true,expectedRevision:B.revision}`. Never reverse it. Multi-connect issues one confirmed operation per selected subordinate, preserving per-target errors and success. Reject self/master/cycle-looking input locally for clear feedback, but server validation governs. Changing a lead never changes chat members; group messaging never changes a lead.

New unit form uses name, explicit role, scope, machine, optional lead/job/model and position. Show machine answers and issues, disable unavailable choices, still handle server `machine_unavailable` naming the exact machine before any successful state/layout change. `overseer_exists`, `unit_exists`, `invalid_lead` and null-revision malformed units stay visible. Session form lists only the machine's enabled installed contract client IDs; selected unit supplies model/job/lead/machine, never arbitrary executable/cwd. Prompt is optional plain text.

Start is queued after 202; track request through SSE and documented detail GET on reconnect, not an interval poll. Show queued/starting/started/failed/expired separately and reveal session only after started. Stop needs confirmation and accepts only supported local sessions; 202 means stopping until native acknowledgment. Never display a simulated successful start/stop for unsupported adapters. `unit_changed`, `unit_in_use`, `client_unavailable`, `remote_session`, `stop_unavailable` and `launch_ambiguous` retain safe retry feedback.

Create `test/gui-actions.test.mjs`; extend fixture handlers/control and `test/gui-map.test.mjs` for response/drag overlap, unrelated remote move, a remote layout event after save commit but before its older HTTP response, another event during the reconciliation GET, same-ID conflict, lost-response retry, exact connection direction, partial multi-connect, machine unavailability, queued failure and confirmed stop. No actual client process is launched.

**Check:** `node --test test/gui-map.test.mjs test/gui-actions.test.mjs` exits 0; two rapid drags persist the latest coordinate while another unit's remote move survives. Browser: confirm/cancel connection, group-connect one invalid target, create on an unavailable machine, start into queued/failed and stop into stopping/stopped. Record observed states. **Commit:** `Add confirmed Map actions and safe layout saves`.

## 7. Implement saved chats and offline mailboxes

Create `chats.mjs`: `loadChats`, `openDirectChat`, `openGroupChat`, `loadMessages`, `postMessage`, `acknowledgeVisible`, `manageChat` and `openMailbox`. Use the contract Chat objects, not unit states. Direct desktop activation POSTs `/chats` with selected member IDs and reuses the returned ID; multiple selected units create a saved group with master automatically included by the service. Do not compute direct chat UUIDs in the UI.

Chats list pinned first then recent activity; expose Pin, Remove from list and Reopen retained chat with expectedRevision. Inspector Close clears local selection only. Removing sends listed false and leaves history; no physical-delete route exists. Group header shows canonical members and never edits hierarchy. Rename is absent because the contract has no title PATCH.

Newest message page arrives chronologically; nextCursor loads older pages and prepends without overlap while preserving first visible message ID/offset. `before` and cursor never coexist. Deduplicate by message ID, not text/timestamp. An incoming message scrolls to bottom only when already within 24px of the bottom; otherwise show New messages. Posts preserve body/subject/replyTo/attachments/priority, show pending sync and notification states, and keep composer text until a durable response. Unknown-outcome retry reuses the same operation.

Only acknowledge IDs after their content is rendered and visible in the active chat, in batches at most 200. Filter notice/read events by destination and reader; late older messages remain unread until explicitly shown and acknowledged. A chat receipt never archives its agent mailbox notice. Mailbox detail GET remains non-consuming; explicit Mark read calls its route. Master may inspect any mailbox, phone acknowledges only master's. Show archive_collision without claiming success or silently hiding the message.

Extend fixture chat/mailbox handlers with direct reuse, group creation, list/unlist, explicit IDs, read/all archive filter and chronological older pages. Extend `test/gui-actions.test.mjs` with direct reuse, distinct groups, retained unlisted history, all group replies, late older unread, read visibility, double-submit/lost response, partial notification failure and 429 composer retention.

**Check:** `node --test test/gui-actions.test.mjs test/gui-transport.test.mjs` exits 0. Browser: double click Hierarchy and verify Map centering, selection and direct chat, create a three-member group, receive two replies, pin/unlist/reopen, prepend older history without jumping, and inspect an offline mailbox without auto-reading it. Record both empty and 400-message cases. **Commit:** `Add saved chats and explicit mailbox reads`.

## 8. Complete inspector, approvals, deliveries and Waiting

Create `inspector.mjs`: `renderUnit`, `renderSession`, `renderGrants`, `renderApproval`, `renderTask`, `renderWaiting` and `openTaskDetail`. Render role/scope/lead/job/model/context/branch/date, session activity/quota/wake and machine answers from contract data; null observations say Unknown. Unit status is never inferred from state in alone. Waiting is its own filtered collection, using supplied underlying IDs once and reviewable gating.

Extend `actions.mjs`: `answerApproval`, `revokeGrant`, `changeTaskStatus` and `undoTask`. Approval controls use current approval revision and exact approve/approve-always/deny enum. Approve always identifies one unit, exact action and normalized pattern; hide/disable it when alwaysAllowed false. Remote 202 says Answer queued, tracks answerId through documented answer detail/SSE, and becomes approved only after owner result. Handle applied/rejected/expired and 409/410 without a second answer. Never interpret expiry as approval.

Grant revocation uses DELETE JSON with the unit revision, displays pending for remote 202 and tracks requestId to revoked; do not remove it optimistically before owner result. Present exact pattern safely, with no shell execution. Task detail shows Request/Report/requirements/status/approval evidence, Accept only for reviewable review tasks, and Send back with a required nonblank note. Send back maps review to open; Accept maps review to done. Desktop offers documented archive/reopen/delivery only with corresponding authority; phone offers only the two review transitions. Undo uses current task revision, preserves notes and handles nothing_to_undo/undo_conflict. A task notice opens structured taskId instead of parsing message prose.

Extend fixture/task/approval outcomes and `test/gui-actions.test.mjs`: lead-gated delivery disabled, current reviewable accepted, blank return note refused, stale task unchanged, undo external-edit conflict, always unavailable, queued answer rejection/expiry, grant revocation pending and retry deduplication. Update i18n and main for master mailbox, Waiting overlay, issues and counts.

**Check:** `node --test test/gui-actions.test.mjs` exits 0. Browser: pending approval to answering to approved, expired approval, unit-specific grant revoke, blocked delivery, Accept, Send back with note, Undo then external conflict; Waiting empties only after final outcomes. Record observations in `test/gui-browser.md`. **Commit:** `Add inspector approvals and task review controls`.

## 9. Add shared editor presentation, comments and Watch

Create `editors.mjs`: `loadCatalog`, `openEditor`, `registerResource`, `createResource`, `setAttachments`, `loadComments`, `createComment`, `replyComment`, `resolveComment`, `startWatch`, `stopWatch` and `handleActivity`. Catalog groups by project/title with search/paging. Desktop registration accepts existing project-relative paths only; new resource creation uses the contract JSON shapes. Read-only legacy module shows conversion_required, original path and an explicit Create JSON copy form; do not execute/import the module or overwrite it.

Editor state is `{resourceId,kind,authoritative,revision,commentsRevision,attachmentRevision,draft,baseRevision,dirty,conflict}`. Attachments use their own revision from GET attachments/Editor. Comments creation checks document and comments revisions; reply/resolve uses expectedCommentsRevision, never thread ID as a file revision. A request generation per resource prevents a late prior editor GET from replacing current selection. `comment.changed` import with null thread refetches the whole sidecar, including removed threads; corrupt_resource is shown rather than an empty resource overwrite.

Choose attached canonical units in a searchable picker, max 256, and PUT the full intended unique list with its binding revision. UI shows queued/submitted/ambiguous/failed notices exactly, without promising immediate replies. Comment pins use derived place when available; unplaced/orphaned threads remain in the sidebar and can be replied to/resolved. Reply reopens a resolved thread. No body-provided author exists.

Watch is off initially. Node/chat Watch POSTs `{unitId,chatId?}`; editor Watch includes explicit resourceId and an attached unit. Store returned watchId; DELETE uses `{}` and accepts 204. Waiting means no recent attached activity, not an empty editor. Only this viewer's watch.changed opens the corresponding editor and labels Watching plus unit. Retain drafts per resource while switching; Watch cannot silently discard an unsaved draft.

Cache editor.activity for data refresh, but pan/highlight only when the active viewer-owned Watch is state watching and both activity.unitId and activity.resourceId match it exactly. Watch off, waiting, another unit editing the same board or another resource never moves selection/viewport/Focus. Fast matching events may fetch the latest revision rather than animating invented intermediate work. Detachment/stop/restart clears following when instructed by events; turning Watch off disables automatic focus immediately, keeps the editor open and never stops work or changes authority. A pending stop suppresses later focus events until its DELETE outcome is reconciled.

For desktop credentials with viewer.write, dirty browser changes PATCH `/viewer` with dirty true/false through the normal operation mechanism; coalesce unchanged values. Never GET/PATCH viewer for phone credentials. Phone chat/mailbox/return-note drafts stay in local memory and do not publish viewer dirty state. A shared editor refresh never clears a local unsaved form. Discard/Reopen or explicit reapply to a new base resolves conflict; no automatic unknown-content replacement. Desktop viewer isDirty covers uncommitted text, node, resource and message/comment forms across resources, and clears only after the corresponding form is durable or deliberately discarded.

Create `test/gui-editors.test.mjs` and extend fixture editor/comments/binding/Watch handlers. Check separate revision failures, outside changes while dirty, unplaced threads, corrupt sidecar, replies reopening, attached-unit notice outcomes, explicit resource authority, Watch waiting/switch/off and two isolated desktop viewers. Emit activity with Watch off and from an unrelated unit on the same board; data may refresh but selection/viewport/Focus must remain unchanged. Register/create board/text/resource forms stay desktop-only.

**Check:** `node --test test/gui-editors.test.mjs test/gui-transport.test.mjs` exits 0. Browser: attach two units, add/reply/resolve comment, observe notification failure and real fixture reply, start Watch and verify selected resource kind/header and following label, stop following, then change selected resource during a delayed fetch. Steps 10 and 11 verify canvas/text focus after those renderers exist. Current selection and draft survive. **Commit:** `Add live editor comments and viewer Watch`.

## 10. Build Blueprint Lite without losing full-editor fields

Create `blueprint.mjs`: `renderBoard`, `indexNodes`, `renderNode`, `hitBoardNode`, `patchNode`, `addNode`, `removeNode`, `replaceBoard` and `uploadAsset`. Render pages/screens/order, canvas links and nested box/text/vector/image/icon types using the exact board schema. Use DOM SVG elements and safe attribute allowlists; node source is data. Use explicit known style validation, safe font family handling and no CSS/HTML injection. Do not draw valign/shadows/blur/pixelate or opaque later properties.

Preserve the authoritative document with structuredClone. A property edit sends only changes plus expectedRevision to node PATCH; it cannot change id/type/kids. Add POST and remove DELETE use expectedRevision; root deletion is refused. Screen/page/link edits use a full document clone from the latest accepted base, changing only intended IDs/fields. Preserve unknown data at document/page/screen/link/node/component/font/thread levels deeply; preserve optional arrays and unknown link properties. Never rebuild the document from visible inspector fields.

```js
function editedBoard(authoritative, edit) {
  const document = structuredClone(authoritative.document);
  edit(document); // alters only the named fields or explicitly removed IDs
  return { document, expectedRevision: authoritative.revision };
}
function updateNodeOperation(editor, nodeId, fields) {
  const changes = structuredClone(fields);
  for (const key of ["id", "t", "kids"]) {
    if (key in changes) throw new Error("Structural fields require a structural operation.");
  }
  return { changes, expectedRevision: editor.revision };
}
```

Board geometry accumulates screen position plus every ancestor place. Hit test descendants in reverse paint order, honoring clipping ancestors and circle/vector boundaries. Text boxes use their documented box; path hits use isPointInFill/isPointInStroke on the SVG geometry when available and a conservative box fallback clearly limited to selection. Reuse the Map coordinate convention. Pan/zoom/selection is local, not document data. Preserve unresolved legacy external links visibly instead of dropping them; newly created board links must have valid internal endpoints. Read-only/malformed resources disable editing without substituting a blank board.

Asset upload sends exact contentType/bytesBase64 with size validation, receives Asset.src and uses that source in an image node. GET Asset.url must be same-origin/allowlisted and bearer-fetched into a blob URL; revoke object URLs on replacement/unmount/logout. Existing node src never becomes a direct unauthenticated filesystem/image URL. Handle missing/invalid assets and server conversion results without inventing a different reference format.

Extend fixture board validation and `test/gui-editors.test.mjs` with a document containing sentinel unknown data at every level, nested arrays, the four full-editor properties, nonempty components/fonts/threads, optional easing and an unresolved legacy link. Patch one known field, then do one full replacement and compare all surviving sentinel values. Check 409 unsupported_fields_lost, root refusal, concurrent node update, subtree deletion/refetch with orphan comments, clip-aware hit tests and authenticated asset cleanup.

**Check:** `node --test test/gui-editors.test.mjs` exits 0; all unknown sentinel values survive both saves and malformed/read-only bytes remain unchanged. Browser: render a multi-page full-field board, edit a nested node, add/remove shape, upload an image, comment on a node, receive a committed activity focus, then provoke an outside edit conflict. Record both looks. **Commit:** `Add compatible Blueprint Lite editing`.

## 11. Build Void Document, safe ranges, proposals and Focus

Create `markup.mjs`: `tokenizeMarkup`, `renderMarkup`, `plainText`, `sourceBoundary` and `createTextAnchor`. Recognize only exact `<b>`, `</b>`, `<i>`, `</i>` tags; all other input is rendered literally through text nodes. Build a DocumentFragment with vetted b/i elements, never assign uploaded HTML. Preserve original source strings and language/page unknown fields. Rendered comment offsets are UTF-16 offsets in tag-stripped text; range edits are UTF-16 offsets in the original serialized source. These domains must never be confused.

The tokenizer walks original source, records each token's sourceStart/sourceEnd and each visible text run's plainStart/plainEnd, and tracks open tag boundaries. For selection from rendered text, map through text-node run metadata; choose the source offset of the corresponding visible code unit, not an index in innerHTML. A collapsed boundary has separate start/end affinity around zero-width tags. Reject a source edit boundary inside a tag or between a high/low surrogate; do not silently round it. Comment anchors use tag-stripped quote/prefix/suffix and the exact half-open plain offsets required by contract 2.8.

```js
function validUtf16Boundary(source, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return false;
  const before = source.charCodeAt(offset - 1), after = source.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
function rangeRequest(editor, k, lang, start, end, replacement) {
  const source = editor.document.pages.find((page) => page.k === k)[lang];
  if (end < start || !validUtf16Boundary(source, start) || !validUtf16Boundary(source, end)
      || boundaryInsideTag(source, start) || boundaryInsideTag(source, end)) {
    throw new Error("The selected source range is invalid.");
  }
  return { k, lang, start, end, expectedText: source.slice(start, end), replacement,
    expectedRevision: editor.revision };
}
```

Create `void.mjs`: `renderDocument`, `beginTextEdit`, `saveRange`, `replaceDocument`, `renderProposal`, `answerProposal`, `enterFocus`, `leaveFocus`, `moveFocus` and `showTools`. Default is Document: title, stable page k, language blocks, comments/attached-unit toolbar and Focus. Source-aware textarea editing provides an explicit safe editing path where a rendered selection cannot map unambiguously. Save uses a ranges apply operation; a whole-document edit clones the original and uses PUT without forging numeric rev/history. Show source range_changed/revision_conflict, keep draft, fetch latest and require deliberate reapplication.

Pending suggestion shows expected text/replacement, author and Accept change/Discard. Acceptance sends both current document revision and comments revision; it applies only if the proposal base is still valid. Discard changes sidecar state only. On proposal_stale retain the visible pending suggestion and discussion; never rebase/apply it automatically. Response and subsequent events update document/comments together, avoiding a transient accepted label on unchanged text. Phone sees suggestions as read-only; its Accept action always means task acceptance.

Focus sets pure black via dedicated tokens, hides bar/sidebars/tools while retaining readable text and keyboard focus, and keeps the same document/draft. Left/Up move to previous page, Right/Down next page, respecting bounds and ignoring inputs/textareas/contenteditable. Escape returns to Document. Pointer movement immediately restores page tools; keyboard navigation can hide them again without losing position. Do not convert Focus into a separate resource or API route. Use focus-visible/reduced-motion rules and return to the invoking Focus control when leaving.

Extend fixture text/proposal operations and `test/gui-editors.test.mjs`: b/i nesting, literal script/link/handler input, emoji and UTF-16 boundaries, tags crossing selections, plain/source offset difference, bilingual stable keys, unknown data retention, exact expectedText, comments/doc concurrency, proposal accept/discard/stale, outside edits and Focus navigation. Assert disk original stays unchanged and fixture history increments only once for a durable apply.

**Check:** `node --test test/gui-editors.test.mjs` exits 0. Browser: open Document, edit bold text containing an emoji, comment on a rendered quote, accept/discard/stale suggestions, enter pure-black Focus, navigate with arrows, move mouse to show tools and Escape to Document. No uploaded markup executes and the same page/draft survives. **Commit:** `Add Void Document and Focus editing`.

## 12. Add settings, home access and a real bounded QR

Create `settings.mjs`: `renderSettings`, `saveSettings`, `openHome`, `closeHome`, `renderHomeGrant` and `updateExpiry`. Settings PATCH uses current revision/null and shared look/language only; host overrides remain in viewer. Show service machine/version/originKind/syncState, issues and limits without exposing filesystem credentials. Home enable uses enabled true and optional selected address strings; disable uses enabled false. Re-enable confirmation explains replacement/revocation. Failed binding yields no partial active grant.

Keep grant key/code/link/qrPayloads in memory only for that grant. Select each returned bound address and render its exact returned link/code, not a guessed host/port. Countdown uses expiresAt plus browser time and home.changed, never polling or extending expiry. Clear secret DOM/memory on close/expiry/replacement/logout. GET settings/home.changed do not restore an opening key. A grant opened elsewhere can show active status and Close; displaying a fresh QR requires an explicit replacement, not an invented secret GET route.

Create `qr.mjs`: `encodeHomeQr(payload)` as independent QR Model 2, fixed version 5, error correction L, byte mode and mask 0. The browser is bounded to the contract's ASCII home URL. Version 5 uses 37x37 modules, 108 data codewords, 26 error-correction codewords in one block, 134 total codewords and seven remainder bits. Reject non-ASCII or more than 106 UTF-8 bytes; never truncate a URL. The contracted longest IPv4/port/key URL fits this bound. Core retains its independent encoder; no shared runtime module or API addition exists.

The parameters and oracle comparison are checked against [the primary QR implementation](https://github.com/nayuki/QR-Code-generator/blob/master/typescript-javascript/qrcodegen.ts). Implement the bounded algorithm below independently; there is no downloaded/vendored runtime library. Mask 0 is a valid fixed standard mask, so no adaptive mask-selection algorithm is needed for this fixed home-link encoder.

```js
function encodeHomeQr(payload) {
  const bytes = new TextEncoder().encode(payload);
  if (!/^[\x20-\x7e]+$/.test(payload) || bytes.length > 106) throw new RangeError("QR payload does not fit.");
  const bits = [];
  const append = (value, count) => { for (let i = count - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  append(4, 4); append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, 864 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => n * 2 + b, 0));
  for (let pad = 0; data.length < 108; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);
  const multiply = (a, b) => {
    let result = 0;
    while (b) { if (b & 1) result ^= a; b >>>= 1; a <<= 1; if (a & 256) a ^= 0x11d; }
    return result;
  };
  let polynomial = [1], root = 1;
  for (let degree = 0; degree < 26; degree += 1) {
    const next = Array(polynomial.length + 1).fill(0);
    polynomial.forEach((coefficient, i) => { next[i] ^= coefficient; next[i + 1] ^= multiply(coefficient, root); });
    polynomial = next; root = multiply(root, 2);
  }
  const remainder = Array(26).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift(); remainder.push(0);
    for (let i = 0; i < 26; i += 1) remainder[i] ^= multiply(polynomial[i + 1], factor);
  }
  const codewords = [...data, ...remainder];
  const size = 37;
  const matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const set = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    matrix[y][x] = Boolean(dark); reserved[y][x] = true;
  };
  for (let i = 0; i < size; i += 1) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [33, 3], [3, 33]]) {
    for (let y = -4; y <= 4; y += 1) for (let x = -4; x <= 4; x += 1) {
      const distance = Math.max(Math.abs(x), Math.abs(y));
      set(cx + x, cy + y, distance !== 2 && distance !== 4);
    }
  }
  for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) {
    set(30 + x, 30 + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
  }
  // L format bits are 01 and mask 0, giving five-bit format data 01000.
  const formatData = 8;
  let bch = formatData;
  for (let i = 0; i < 10; i += 1) bch = (bch << 1) ^ ((bch >>> 9) * 0x537);
  const format = ((formatData << 10) | bch) ^ 0x5412;
  const bit = (i) => Boolean((format >>> i) & 1);
  for (let i = 0; i < 6; i += 1) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
  let position = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let row = 0; row < size; row += 1) {
      const y = upward ? size - 1 - row : row;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (reserved[y][x]) continue;
        const dark = position < codewords.length * 8
          && Boolean((codewords[position >>> 3] >>> (7 - (position & 7))) & 1);
        matrix[y][x] = dark !== ((x + y) % 2 === 0); // mask includes remainder modules
        position += 1;
      }
    }
  }
  if (position !== 1079) throw new Error("Invalid QR module count.");
  return matrix;
}
```

Create `qr-render.mjs`: `renderQr(matrix,label)`, using createElementNS for an SVG with a four-module white quiet zone, black integer module rectangles/path, 45x45 viewBox, at least 225 CSS pixels, crisp edges and a localized accessible title. QR colors are scanner black/white tokens in both looks; decorative theme colors never replace them. Do not encode the short code or a reconstructed link when qrPayloads contains the exact URL.

Extend `test/gui-shell.test.mjs` with independent golden SHA-256 values: serialize 37 strings of 37 `0`/`1` characters with LF between rows and no final LF. For `http://192.168.1.23:43123/#home=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, expect `83549c0a12eb68c8716657575309cb4255bb529bfd795aebb1570b256ec34549`; for 106 `x` bytes, expect `28571cbdad17176449c375be5ff4484c96ab69a72384c1fbe30595e2a902a1f5`. These came from forced byte-mode version-5-L mask-0 output of the primary implementation, with ECC boosting disabled. Reject 107 bytes and non-ASCII. Test replaced/expired grant cleanup, multi-address links, failure/no active grant and settings stale revision.

**Check:** `node --test test/gui-shell.test.mjs test/gui-fixture.test.mjs` exits 0 and both QR goldens match. Browser: change both looks/languages, enable/replace/close a home grant, switch bound link, scan the actual rendered QR with a phone camera and verify its decoded exact fixture payload without opening production access. Advance fixture time 12 hours and verify secrets disappear. Record QR scan and expiry. **Commit:** `Add settings and bounded home QR access`.

## 13. Enforce the phone surface and isolate embedded viewers

Create `phone.mjs`: `exchangeHomeFragment`, `renderCodeEntry`, `exchangeCode`, `renderPhone`, `canPerform` and `logout`. Remove #home before the exact POST auth/home key exchange; manual six-character code is case-insensitive input and uses code only. Show invalid_home_key/home_expired/auth_rate_limited with Retry-After, clear entered secrets, and retain no key/token in browser storage. Exchange never extends the 12-hour grant.

Use returned capabilities and credential audience, never viewport/user agent, to choose phone authority. Phone navigation is Hierarchy, Chats and Waiting; selecting a missing direct chat displays the desktop-created-conversation requirement. It posts only in existing chat, can send a master mailbox message, acknowledges master's reads, answers existing approval and accepts/returns only reviewable review tasks. It cannot create/manage chat, create/connect unit, launch/stop, move layout, change settings/home, revoke grants, undo, register/edit document/comments/attachments/assets, answer proposals or Watch. Optional editor detail is read-only and has no mutation shortcut. The server fixture must still reject every forbidden write if the handler is called directly.

Create `embed.mjs`: `startEmbedChannel`, `publishReady`, `publishDirty`, `handleParentMessage` and `dispose`. Start this module only for a desktop credential with viewer.write, then read credential-bound `/viewer`. Phone boot never enters this channel or calls viewer routes. Use this exact envelope, no additional identity/credentials:

```js
function publish(type, value) {
  if (!viewer.embedded || !viewer.hostOrigin) return;
  window.parent.postMessage({ contract: "hivem1nd-embed-v1", viewerId: viewer.viewerId,
    type, value }, viewer.hostOrigin);
}
async function handleParentMessage(event) {
  const message = event.data;
  if (event.source !== window.parent || event.origin !== viewer.hostOrigin
      || message?.contract !== "hivem1nd-embed-v1"
      || message.viewerId !== viewer.viewerId) return;
  if (message.type === "set-look" && ["modern", "high-contrast"].includes(message.value)) {
    await patchOwnViewer({ look: message.value });
  } else if (message.type === "set-language" && ["en", "es"].includes(message.value)) {
    await patchOwnViewer({ language: message.value });
  } else if (message.type === "close" && message.value === null) await logoutOwnViewer();
}
```

Only ready/dirty go from iframe to exact parent; only set-look/set-language/close are accepted from it. Ready value is `{viewerId,capabilities}`, dirty boolean. Presentation PATCH changes this viewer only; shared settings are unaffected. Own viewer.changed updates its effective look/language and dirty acknowledgment; another viewer's events never change it. Close/logout clears this viewer's Watch/drafts/stream and sends no stop-service command. Core host handle methods remain core-owned HTTP/SSE behavior; the GUI imports no package host entry.

Extend `test/gui-shell.test.mjs` with a phone 390x844 and desktop-token narrow-layout capability matrix, all forbidden direct handler attempts, invalid/replaced/expired code, no secret storage, wrong source/origin/viewer/contract postMessage, two independently themed/dirty viewers and idempotent logout. Count fixture requests during phone boot, composing and retrying a message/return note: exactly zero GET/PATCH viewer calls are permitted. Fixture embedding browser scenario uses a test-owned host HTML generated under its temporary root and served from a second exact loopback origin; do not add a production host route or committed host file.

**Check:** `node --test test/gui-shell.test.mjs test/gui-fixture.test.mjs test/gui-editors.test.mjs` exits 0. Browser: phone writes existing chat and reviews a task but exposes no editing/unit creation; widening it grants nothing. Embed two viewers, change one look/language, dirty one form, close it and verify the other remains connected. Forged sibling/wrong-origin messages do nothing. Record keyboard/touch and expiry. **Commit:** `Add restricted phone and isolated embedded viewers`.

## 14. Finish GUI verification and preserve the boundary

Complete `test/gui-browser.md`, fixing findings only in the ownership table. Re-read the whole changed diff for dead imports, exposed secrets, incomplete states, broken focus restoration, stale request generations, unrevoked blob URLs and cross-viewer state. Do not mark a browser check passed from a Node test or a mocked DOM.

Run the six GUI test files plus fixture checks explicitly, avoiding shell wildcard differences:

```powershell
node --test test/gui-fixture.test.mjs test/gui-transport.test.mjs test/gui-map.test.mjs test/gui-actions.test.mjs test/gui-editors.test.mjs test/gui-shell.test.mjs
npm.cmd run lint
git diff --check
git status --short
```

All tests exit 0 with no failure/skip, lint is clean, diff check is empty, and git status contains only GUI-owned implementation files. Have `test/gui-shell.test.mjs` traverse the app/fixture import graph with Node built-ins and fail on core/engine/CLI/feature imports or external package/URL references; parse the ownership table for the filename boundary without turning it into a new production interface.

In a real browser with fixture-only data, record these final scenarios: 1/4/40/400/1200 items; search/folds/last row; modern/high-contrast; en/es; 1440x900/1024x768/390x844/200% zoom; keyboard focus/contrast/reduced motion; offline stream/replay/reset/expired session; stale and uncertain mutation; two drags against a remote move; confirmed lead direction/group independence; unavailable machine/session outcomes; unread late message/unlisted retained chat; queued/expired approval/lead-gated delivery/undo conflict; all-level unknown board retention; safe assets; Void source/plain offsets/emoji/stale proposal/Focus; Watch off/waiting/following; grant replacement/12-hour expiry/QR scan; phone forbidden actions; two isolated embeds.

For each row include actual pass/fail, viewport/look/language, the exercised fixture scenario and evidence. Leave failures explicit until repaired; do not invent screenshots, timings or accessibility measurements. Node gates prove pure/wire behavior; browser gates prove rendering/focus/scrolling. No actual OS login unit, native session or service on the real mind runs here.

**Check:** the four commands above succeed and every applicable browser result is recorded as observed, with no unresolved failure. Core integration is a separate later gate after both branches are reviewed/merged: actual host entry/static serving, genuine private-interface phone binding, service-owned QR use, real persistence/events, supported session adapters and multi-machine sync are not claimed by GUI fixture results. **Commit:** `Verify the complete GUI against its isolated fixture`.

## Likely failure points and handoff

There are 14 ordered steps and 33 owned implementation files. Highest-risk steps are 2 (snapshot/SSE ordering and credential expiry), 5 and 6 (coordinate domains, connection direction and save races), 9 to 11 (separate revisions, unknown fields, safe source offsets and proposals), 12 (QR codeword/format/remainder correctness) and 13 (audience and viewer isolation). The exact command/observed-result gates in those steps are mandatory.

The fixture's loopback home audience is intentionally a simulation, so real LAN subnet enforcement remains an integration check. The core and browser QR implementations remain independent over the existing payload string. No unresolved API, ownership or presentation decision is required to start the GUI build.
