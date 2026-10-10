# HIVEM1ND 3.0 core execution plan

This plan implements sections 2, 3, 4, 5 and 7 of the approved product plan. [The contract](contract.md) is normative for every shared record, route, event, capability, error and limit. Read it completely before step 1. This document supplies implementation decisions and checks, without creating a second shared type definition.

## Exact file ownership

Each row names one file the core builder may create or change. The GUI builder owns its browser files under `gui/app/` and its `test/gui-*` fixtures and checks. Neither builder edits the contract, the other plan, or the other's files. No instruction below authorizes another source file.

| File | Action | Responsibility |
| --- | --- | --- |
| `engine/service/paths.mjs` | Create | Local Cosmic paths and safe target resolution |
| `engine/service/identity.mjs` | Create | Canonical IDs, aliases and deterministic UUIDs |
| `engine/service/store.mjs` | Create | Byte reads, serial writes, journals and receipts |
| `engine/service/projection.mjs` | Create | V3 snapshots, lists and issues |
| `engine/service/events.mjs` | Create | Principal-aware event ring and SSE |
| `engine/service/units.mjs` | Create | Unit creation, leads, layout and settings |
| `engine/service/chats.mjs` | Create | Chat and mailbox operations and notices |
| `engine/service/approvals.mjs` | Create | Approval answers, grants and revocation |
| `engine/service/tasks.mjs` | Create | Task transitions, lead gating and undo |
| `engine/service/editors.mjs` | Create | Catalog, boards, texts, assets and comments |
| `engine/service/watch.mjs` | Create | Runtime activity and viewer-owned following |
| `engine/service/adapters.mjs` | Create | Genuine native capabilities and launch recovery |
| `engine/service/bridge.mjs` | Create | Owner-authenticated local native attachment |
| `engine/service/security.mjs` | Create | Permissions, tokens and audience checks |
| `engine/service/home.mjs` | Create | Temporary private-interface listeners |
| `engine/service/qr.mjs` | Create | Own fixed-version QR encoder and payload preflight |
| `engine/service/http.mjs` | Create | Bounded HTTP routing and static shell serving |
| `engine/service/mcp.mjs` | Create | Authenticated Streamable HTTP tools |
| `engine/service/service.mjs` | Create | Per-user singleton and subsystem lifetime |
| `engine/service/client.mjs` | Create | Same-user service attachment and forwarding |
| `engine/service/install.mjs` | Create | Login registration plans and ownership |
| `engine/service/README.md` | Create | Operator commands, isolation and failure behavior |
| `engine/sync/store.mjs` | Create | Eligible changes, compressed objects and versions |
| `engine/sync/pack.mjs` | Create | Pack framing, validation and dependency indexes |
| `engine/sync/limits.mjs` | Create | Durable rolling ledgers and message admission |
| `engine/sync/pulse.mjs` | Create | Adaptive timers and bounded publication |
| `engine/sync/origin.mjs` | Create | Machine-owned heads, beats and watchers |
| `engine/sync/apply.mjs` | Create | Owner validation, conflicts and import transactions |
| `engine/sync/media.mjs` | Create | Optional local media conversion |
| `engine/relay/store.mjs` | Change | Scoped identity compatibility and V3 record reading |
| `engine/relay/wake.mjs` | Change | Canonical bindings and in-process service adoption |
| `engine/relay/hooks.mjs` | Change | Service attachment, activity and permission fallback |
| `engine/relay/config.mjs` | Change | Owned hook configuration and synchronous gating |
| `engine/relay/mcp.mjs` | Change | Preserve stdio tools and forward core operations |
| `engine/relay/person.mjs` | Change | Canonical master and service-backed notices |
| `engine/setup.mjs` | Change | Cosmic defaults and completed setup service flow |
| `engine/lifecycle.mjs` | Change | Migration and service installation after update |
| `engine/uninstall.mjs` | Change | Remove only this installation's login registration |
| `cli/index.mjs` | Change | Service commands and task status/undo |
| `migrations/3.0.0.mjs` | Create | Idempotent person migration without data loss |
| `features/blueprint/review/sketch-format.mjs` | Change | Full-editor tolerance and deep retention in Lite |
| `gui/server.mjs` | Change | Preserve wizard assets and open completed service viewer |
| `gui/index.mjs` | Create | Contract host entry, viewer isolation and handle methods |
| `scripts/build.mjs` | Change | Core package validation and conditional browser checks |
| `scripts/zip-win.mjs` | Change | Delegate Windows artifact generation safely |
| `scripts/build-installer.mjs` | Create | Offline bundled runtime installer and reproducible ZIP |
| `package.json` | Change | Version, browser service entry and build commands |
| `package-lock.json` | Change | Root version metadata only |
| `test/core-fixture.mjs` | Create | Temporary minds, origins, Cosmic folders and cleanup |
| `test/core-identity.test.mjs` | Create | IDs, paths, revisions, receipts and journals |
| `test/core-migration.test.mjs` | Create | Person collision and repeated migration checks |
| `test/sync-pack.test.mjs` | Create | Independent binary decoder and malicious packs |
| `test/sync-pulse.test.mjs` | Create | Fake clock, windows, pulse and publication recovery |
| `test/sync-apply.test.mjs` | Create | Two-machine replication, ownership and conflicts |
| `test/sync-media.test.mjs` | Create | Real optional converter or explicit absence |
| `test/service-projection.test.mjs` | Create | Lists, status precedence and event snapshots |
| `test/service-messaging.test.mjs` | Create | Chat fanout, late read receipts and archive safety |
| `test/service-approvals.test.mjs` | Create | Owner answers, expiration and grant tombstones |
| `test/service-tasks.test.mjs` | Create | Transition authority, crash recovery and undo |
| `test/service-sessions.test.mjs` | Create | Native capability refusal and launch ledger |
| `test/service-lifecycle.test.mjs` | Create | Singleton, bootstrap, adoption and shutdown |
| `test/service-auth.test.mjs` | Create | Exact network checks and audience matrix |
| `test/service-api.test.mjs` | Create | Every contract route and boundary response |
| `test/service-qr.test.mjs` | Create | Fixed-version golden symbols and independent decoding |
| `test/service-editors.test.mjs` | Create | Revisions, unknown fields, comments and proposals |
| `test/service-mcp.test.mjs` | Create | Tools, RPC envelopes, identity and stdio forwarding |
| `test/service-install.test.mjs` | Create | Registration dry runs, offline payload and setup |
| `test/service-integration.test.mjs` | Create | Actual HTTP/SSE/stdio/sync integration without GUI |
| `test/relay-person.test.mjs` | Change | New master writes and retained legacy person reads |
| `test/relay-config.test.mjs` | Change | Synchronous supported permission hook configuration |
| `test/relay-hooks.test.mjs` | Change | Service attachment and native fallback expectations |
| `test/relay-cli.test.mjs` | Change | Shared service readiness and isolated forwarding |
| `test/relay-mcp.test.mjs` | Change | Service-backed stdio compatibility and protocol errors |
| `test/setup.test.mjs` | Change | Cosmic defaults and isolated registration injection |
| `test/blueprint-sketch.test.mjs` | Change | Full-field retention and current typed limits |

## Execution rules and starting point

The supplied builder worktree must be on its supplied core branch, cut from the final `feat/3.0` commit containing the contract and both execution plans. Do not automatically check out, reset or replace a branch. Verify with `git branch --show-current`, `git status --short`, and `git log -1 --oneline`; stop on unrelated changes and report them to the coordinator.

Use Node 22 or later, Node built-ins and the existing locked dependencies only. Do not install a test framework, QR package, HTTP framework, archive package, native terminal package or converter package. Keep code and product copy in English, with neutral professional Spanish where the contract permits localization. Do not introduce em dashes or client product names in prose; wire enums and existing filenames retain their specified names.

All tests create a new directory with `mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'))`. Put every test mind, repository, origin, client home, installed payload and Cosmic directory below that root. Assert the resolved paths are descendants before writes and recursive removal. Never write to the real mind or a real client home. Never register a real scheduled task, LaunchAgent or systemd unit. Tests inject a registration runner that records the planned executable and argument array and refuses actual execution. No test signals a PID obtained from a file; cleanup uses only its own `ChildProcess` handles.

Before modifying each existing file, read it completely if it has at most 1000 lines. For larger files, locate its function with three searches, then read that whole function and its callers. Follow neighbouring conventions. Existing entry points are `createSetupSession`, `SetupSession.install`, `evolve`, `uninstall`, `runCli`, `runRelayWake`, `createWizardServer`, `createRelay`, `createRelayWakeController`, `serveRelayMcp`, and `validateSketch`.

Run the exact check at the end of every numbered step before committing that step. Use `npm.cmd` on Windows because `npm.ps1` can be blocked by the local execution policy; `npm` is the non-Windows equivalent. Stage only files named by that step. Commits are authorized on the supplied 3.0 builder branch; do not push, merge, release, or rewrite public history here. A failed check is repaired before proceeding, never bypassed.

Keep intermediate steps runnable: domain modules accept explicit context functions for later security/listener/native dependencies. Tests supply these functions to test that domain behavior, never import an absent future module or create a fake production module. Add production imports/composition only when the dependency exists. Intermediate injected protocol tests do not establish native adapter availability; the final genuine-capability gates do.

## Ordered implementation

### Step 1. Establish identity, safe paths and durable operations

Create `engine/service/identity.mjs` with `canonicalJson`, `uuidV8`, `parseUnitId`, `parseTaskId`, `resolveUnit`, and `resolvePerson`. Implement contract 1 and 2.8, including case-insensitive matching, exact `user` person alias, `person:` registry aliases, scoped ambiguity, Windows device-name rejection and retained legacy `scopeId:"user"`. Never infer a role from a client enum. A new master state is root-scoped; `user/` remains the private directory.

The deterministic ID primitive is:

```js
function uuidV8(input) {
  const bytes = createHash('sha256').update(canonicalJson(input), 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

`canonicalJson` recursively sorts object keys, retains array order, accepts bounded JSON only, rejects nonfinite numbers and excessive depth/arrays, and produces ordinary JSON.stringify bytes. Hash resources from exact raw bytes, never line-ending-normalized text. Parse BOM/CRLF/LF records without changing the bytes used for revision or legacy message ID. Preserve final duplicate header values and untouched body sections when changing a header.

Create `engine/service/paths.mjs`: `localCosmic`, `defaultMind`, `servicePaths`, `safeRelative`, `resolveTarget`, `assertNoLinks`, and `assertLocalStaging`. Implement every OS default in contract 2.1, including absolute-only XDG variables, resolved mindKey, and Windows lowercase hashing. Resolve `M`, `O`, staging and configured synced roots before comparing components. Refuse staging equal to or below any origin/synced root or detected OneDrive root, including paths reached through a junction. Refuse links/junctions in a write path and ancestor chain. Repository targets require the locally registered project path and catalog eligibility, never an API-supplied absolute path.

Create `engine/service/store.mjs`: `withLocks`, `readBytes`, `readRecord`, `checkRevision`, `atomicWrite`, `exclusiveRecord`, `commitTransaction`, `recoverTransactions`, and `withReceipt`. `withLocks` sorts canonical resource keys, acquires them in that order and releases in finally, including document/comments/state locks. `atomicWrite` uses an exclusive sibling temp, writes and fsyncs bytes, closes, renames, and cleans its own temp on failure. Existing unsafe/malformed records produce errors rather than fabricated editable defaults.

Use the contract 2.6 journal for single task mutations, and a local superset `{id,phase,entries:[{resource,beforeRevision,afterRevision,afterBytesBase64,recordPath,record}]}` for multi-file transactions. Write a prepared journal durably before any target replacement. Recheck all revisions and safe parents under locks, stage every after-image, then finish all entries, mark committed and recover/verify on restart. Prepared resources are hidden from projection/staging until recovery completes. An unexpected third-party change during recovery is preserved as a conflict and reported; do not overwrite it merely because a journal exists. Emit events and admit staged changes only after the entire group is durable.

`withReceipt` hashes stable principal identity, method, decoded canonical route and canonical body. Serialize duplicate keys with the operation so two concurrent retries cannot both write. Save only safe status/response envelopes for 24 hours under contract 1. Same key/different input is 409. Authentication never gets a receipt; home controls use memory-only receipts. Transaction and receipt recovery must return the original IDs, not create another record or event.

Acquire a principal/key lock before route/resource locks, even when two requests target different routes. Before replacing any target, the prepared journal includes `receipt:{principalHash,key,method,path,bodyHash,status,body,requestId,eventCursor,createdAt,expiresAt}` with the exact already-allocated response and operation IDs, together with all after-images. The response cursor is captured before the corresponding operation read. Recovery finishes after-images, writes this exact receipt, records emitted/staged markers and only then exposes the operation to new reads/retries. A crash between target rename and receipt rename cannot generate a second ID or reapply the mutation. Receipt files never contain credentials, bootstrap/HomeGrant secrets or native endpoints; home-specific responses use only the memory mechanism.

Create `test/core-fixture.mjs` with `makeCoreFixture`, `spawnOwned`, `request`, `readEvents`, `advanceClock`, and `dispose`. It supplies injected OS paths, clock, timers, machine and native capabilities; it imports no GUI fixture. Add identity/path/receipt/journal checks in `test/core-identity.test.mjs`, including different-scope same names, a Windows device basename with extension, junction refusal, absent revision null, stale revisions, concurrent retry, crash after the first transaction file and crash before receipt publication.

Check: `node --test test/core-identity.test.mjs`. Expected: all tests pass, no files outside the fixture root, one event/record for a retried mutation and recovered transactions complete before reads. Commit: `Establish safe core identity and durable operations`.

### Step 2. Migrate the person without rewriting history

Create `migrations/3.0.0.mjs` exporting `version = '3.0.0'`, `idempotent = true`, and `migrate({userPath})`. Reuse step 1 safe byte operations. Rename root state and every scoped inbox named `user` plus the legacy person archive as contract 2.2 specifies. Do not rename the `user/` private directory, other names beginning with user, task filenames, session UUIDs or historical message bytes.

Enumerate regular files without following links. If the target is absent, move verified bytes atomically. If both inboxes exist, parse IDs without aliasing raw headers first, compare bytes by ID, retain exact duplicates once, and preserve differing records under deterministic conflict names. Never delete the source before verifying target/conflict hashes. If both state files exist, retain canonical master, preserve the other as a conflict copy and produce one deterministic master notice. Record migration progress locally so interrupted moves resume safely; a second migration changes nothing and adds no notice.

Change `engine/relay/store.mjs` in `registeredScope`, `resolveUnit`, `register`, `parseMessage`, `serializeMessage`, and public registration conversion. Recognize master and the exact person aliases, new `unitId`/stable `sessionId`, canonical root scope, scoped archives and V3 object attachment headers, while retaining old string attachments and legacy output compatibility. New observations carry both legacy unit and canonical ID. Legacy message IDs remain hashes of the original bytes/headers; alias projection never changes them. Replace the old body-only 256 KiB rejection for V3 records with the contract's complete-record decimal cap and do not silently truncate.

Change `engine/relay/person.mjs` `createPersonRelay` to send as canonical master through its existing lower-level createRelay dependency now; preserve lazy registration/no-write-on-open and existing project selection. Accept an injected operation facade for isolated tests, but do not import the absent service/client.mjs. Step 20 replaces the production transport after that module exists. The tool cannot manufacture an agent capability from a saved observation.

Add `test/core-migration.test.mjs`: repeated/interrupted migration, state collisions, same-ID differing inbox bytes, BOM/CRLF history, old sender aliases, duplicate scoped names, unchanged private root and ordinary `user-helper` unit. Existing direct store checks must continue passing.

Change `test/relay-person.test.mjs` in the new-send/registration cases to expect author/unit/client master and canonical root:master. New registrations never emit client user; only genuine historical client:user inputs remain readable. Keep those historical user inputs and assert their old bytes/IDs survive. Inject the isolated operation client, so lazy-open and project selection are tested without starting a real login service. Replace its arbitrary absolute new attachment with a registered temporary resource reference while retaining a separate historical-string read case.

Check: `node --test test/core-migration.test.mjs test/relay-store.test.mjs test/relay-person.test.mjs`. Expected: all pass, both conflicting contents survive, historical bytes and stable IDs are unchanged. Commit: `Migrate person records to master without losing history`.

### Step 3. Stage eligible bytes and implement the binary pack

Create `engine/sync/store.mjs` with `observeLocalChange`, `stageTransaction`, `eligibleTargets`, `readObject`, and `ackPublished`. Implement contract 2.9/2.10 paths exactly. Hash original bytes, compress once with Brotli, publish object files exclusively, retain separate changes for distinct targets even when their hashes match, and create explicit delete tombstones. Enumerate only private data and registered editor documents/sidecars/referenced assets. Exclude kit code, `.git`, machine-local secrets/leases, origin/staging, temporary files and conflict copies. Initial eligible files are staged once as baseline versions. Updates from validated imports carry an apply marker and are never restaged; clear that marker only after observed byte hashes match the committed import.

Create `engine/sync/pack.mjs` `encodePack`, `decodePack`, `validateHead`, `resolveDependencies`, and `countLogicalMessages`. Binary framing must follow contract 2.9. Use byte lengths, never string lengths:

```js
function framed(header, payload) {
  const json = Buffer.from(canonicalJson(header), 'utf8');
  const prefix = Buffer.alloc(8);
  prefix.write('H1P3', 0, 'ascii');
  prefix.writeUInt32BE(json.length, 4);
  return Buffer.concat([prefix, json, payload]);
}
function payloadOf(index, blobs) {
  const json = Buffer.from(canonicalJson(index), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return Buffer.concat([length, json, ...blobs]);
}
```

Sort included object hashes and calculate contiguous offsets into the blob area. Include every complete change and complete transaction group in the index. A referenced object may be omitted only with a dependency naming a previously validated, head-committed pack. The encoder never assumes a bare object filename in the origin proves publication. `encryption` is exactly `{algorithm:'none'}`; reject Quantum/encryption configuration with unsupported_origin. Document the reserved AES envelope, AAD, nonce, tag and key separation by referring to contract 2.9, but do not wire live encryption or key provisioning.

Decoder sequence: bound file length, verify magic, read bounded unsigned lengths without overflow, decode JSON with fatal UTF-8, validate exact formats/schema and owner, verify payloadBytes/payloadHash and whole-pack head digest, validate all offsets/ranges/unique objects/change IDs/transaction membership, then expand each complete Brotli stream with `maxOutputLength`. Reject overlapping blobs, extra trailing bytes, duplicate hash entries, invalid tombstones, object hash/raw length mismatch, excessive expanded aggregate and invalid paths before exposing an object. Raw objects are at most 16 MB, aggregate at most 64 MB, transmitted pack at most 50 MB, and index arrays at most 10000. A malformed compressed stream never reaches a target.

Dependencies are recursively read with a visited `(machine,sequence,packHash)` set, a bounded graph and verified heads. A referenced committed pack temporarily missing from a folder provider is pending, persisted at the contract pending path and retried on relevant watcher events/restart. A different digest, owner or length is corruption. Validate cycles as errors; do not spin/retry them. Compute logical counts from decoded canonical records/new comment IDs, not `change.messageId`; deterministic valid notices and repeated IDs are exempt, but a forged notice is not.

Add `test/sync-pack.test.mjs` using a manually assembled Buffer decoder separate from production `decodePack`. Exercise ASCII/non-ASCII headers, dependency omission, same bytes at two paths, delete framing, malformed lengths, trailing/overlapping blobs, hash corruption, decompression bomb, transactions split between packs, unknown target and requested encryption. Assert failures have no filesystem application side effect.

Check: `node --test test/sync-pack.test.mjs`. Expected: exact framing round-trips, every invalid pack is rejected before application, and missing committed dependencies remain pending. Commit: `Implement staged content objects and validated binary packs`.

### Step 4. Enforce three durable rolling limits

Create `engine/sync/limits.mjs` with `admitMessage`, `reservePublication`, `reserveReceipt`, `chargeMetadata`, `limitsFor`, and `retryAtFor`. Use contract 7's decimal limits and three independent ledger phases. Prune by the local admission/publication/receipt time, not untrusted remote timestamps. Persist reservations with the transaction/publication journal so crash recovery cannot double-charge or lose a completed charge.

Admission measures the actual complete stored message or added comment/proposal record before writing: 1000000 bytes maximum and 60 logical messages per machine per rolling 60000 ms. All message paths, including native preload, mailbox/chat post, MCP reply and comment proposal use this function. Fanout notices do not consume another logical slot. Local non-message edits can succeed with pending sync. Publication/receipt charge exact transmitted pack plus changed head/beat bytes independently against 50000000 bytes per rolling 3600000 ms. Byte-identical `(machine,sequence,fullPackHash)` or metadata `(machine,path,contentHash)` retries count once.

Compute retry time by sorting the active entries' expiry times and expiring enough entries to fit the proposed message and byte charge; choose the later sufficient time when both dimensions block. Never use the oldest entry blindly. Return contract Limits and exact phase details; Retry-After is ceiling seconds. At 80 percent of either active publication dimension report slowing; at a hard limit report paused. One deterministic master notice per phase/window is exempt from recursive charging. Service beats pause at the byte limit and genuinely expire, then resume at allowance expiry.

Extend `test/sync-pulse.test.mjs` with fake clocks: 60th/61st admission, 1000000/1000001 complete bytes, multibyte UTF-8 and header overhead, separate phase accounting, persisted restart windows, duplicate metadata, truthful beat expiry, and simultaneous message/byte retry calculation.

Check: `node --test test/sync-pulse.test.mjs`. Expected: the 61st post writes nothing; complete-byte overflow is 413; unrelated local editing remains durable/pending; repeated digest charges once. Commit: `Enforce durable admission publication and receipt limits`.

### Step 5. Publish single-owner origins and apply complete imports

Create `engine/sync/origin.mjs` `publishPack`, `publishBeat`, `readHead`, `watchOrigin`, and `closeOrigin`. Only the local machine writes its own directory. Write a pack through an exclusive temporary sibling, verify its digest, then atomically replace that machine's bounded head. Retain every committed entry, increasing sequence and fixed filename. Journal the selected outgoing sequence and bytes before publication. On restart reuse a verified unreferenced pack only if its bytes match the prepared journal; never reuse a committed sequence for other bytes. Reject head regression, reordered/duplicated sequences or changed committed hashes. Ignore temporary/incomplete files.

Create `engine/sync/apply.mjs` `validateOwner`, `compareVersions`, `preserveConflict`, and `applyPack`. Validate record ownership from verified referenced request/session records, not claimed machine fields: contract 2.9 supplies the owner rules. Validate all pack targets, objects and complete transaction groups before any journaled application. A missing local project registration is pending project_unavailable with an issue; it is not mapped to another repository or absolute path.

Compare version tuples `(parsed UTC milliseconds,machine,id)`; reject timestamps more than 30 seconds ahead. Local unsynced edits already have version metadata and participate. If incoming loses and differs from the winner, retain incoming bytes as the specified sibling; if incoming wins over a mismatched base, retain local losing bytes first. Do not create a conflict for identical content. For delete-versus-edit, retain losing content before deleting, and retain winner tombstone metadata permanently. An old edit can never revive a newer tombstone. Immutable ID/different bytes is corrupt_resource, with neither variant overwritten.

Conflict paths are derived within the same validated target root, sanitized machine and compact UTC stamp; an existing namesake is reused only with equal digest, otherwise append the change UUID. Conflict copies stay outside automatic eligibility. Queue one deterministic conflict notice with the relative path, stage that notice as the service's own change, and emit sync.conflict after preservation/application is durable. Prevent repeated notices on retry.

Grant revocation tombstones override imported older grants. A new grant with a new ID remains eligible. Related document/history/proposal and task/undo changes share a transactionId and apply as one group. Checkpoint received head, versions and ledger only after every group is durable; a failed pack never advances applied sequence. Recovered complete groups produce events once using a persisted operation marker.

`watchOrigin` uses `fs.watch` on the machines directory and discovered machine folders; reconcile directory/head state on startup, rename events, watcher error and restart. A missing filename requests a rescan. It retries pending dependencies when their heads/objects arrive. Debounce event storms locally; do not add a periodic origin poll. Distinguish temporary provider incompleteness from a validated corrupt pack; preserve the last applied sequence in either case.

Add `test/sync-apply.test.mjs` with two temporary local minds and a shared temporary origin: out-of-order conflicts, equal-time tie breaks, delete wins/edit wins, local unpublished edit, immutable collision, wrong approval/result owner, a missing dependency arriving later, crash mid-group, head replacement crash, link traversal and one machine unable to register the target project. Verify contents and checkpoint files, not only emitted counts.

Check: `node --test test/sync-apply.test.mjs test/sync-pack.test.mjs`. Expected: both variants survive every conflict, no tombstone resurrection, correct owner rejection before writes, and pending receipt resumes without double charge. Commit: `Publish machine-owned heads and recover safe replicated changes`.

### Step 6. Schedule the adaptive pulse without idle polling

Create `engine/sync/pulse.mjs` `createPulse` with injectable `{now,setTimeout,clearTimeout}`, plus `changed`, `flush`, `resume`, and `close`. Maintain firstChangeAt, lastChangeAt, pending change IDs, one timer, one flush promise and a retryAt. Do not start a quiet timer for zero changes. An import never calls `changed` for its imported records.

Use this scheduling rule, recalculating it on each local change and allowance change:

```js
function nextDue(now, first, last, limits) {
  if (first === null) return null;
  if (limits.state === 'paused') return Date.parse(limits.retryAt);
  const slow = limits.state === 'slowing';
  return Math.max(now, Math.min(last + (slow ? 4000 : 2000), first + (slow ? 30000 : 10000)));
}
```

At flush, lock the prepared outgoing batch; admit at most the remaining publication message slots and at most 60 messages, never split a transaction group or an object. Build the bounded candidate pack and candidate head first to know exact byte charges. If the group/pack does not fit the remaining window, persist pending and schedule sufficient retryAt; local work remains staged. Reject a single intrinsically oversized object/group with an issue rather than retrying it forever. Continue an offline backlog in later windows in creation order, preserving every distinct eligible mutation and complete transaction group.

Publish once, then acknowledge just the successfully included staged IDs. Changes arriving during the flush remain queued for the next timer. A repeated flush shares its promise; shutdown cancels timers and leaves uncommitted staging durable. Failed publication retains the journal/objects and emits an error plus deduplicated notice. No empty pack/head is written after an idle timer or an unchanged read. Periodic beat scheduling is separate and obeys step 4.

Extend `test/sync-pulse.test.mjs`: quiet burst at 2 seconds, continuous flow flush at 10, slowing at 4/30, hard pause/resume, changes during a flush, restarted backlog across windows, transaction groups that do not fit, crash before/after head commit and idle watcher behavior. Instrument origin read/write calls and advance the fake clock by an hour.

Check: `node --test test/sync-pulse.test.mjs test/sync-apply.test.mjs`. Expected: no empty packs or origin polling while idle; only allowed beat metadata changes; exactly one bounded pulse for a burst. Commit: `Schedule adaptive sync pulses and resume offline backlogs`.

### Step 7. Convert supported media locally when available

Create `engine/sync/media.mjs` `findConverter` and `convertMedia`. Resolve an installed ffmpeg executable locally, run it with an argument array and shell false, use fixture/local temporary files and bounded timeout/output, and retain its owned child handle. New verified image uploads convert to WebP; eligible video media converts to WebM. No external conversion server or downloaded package is used. Preserve original bytes if the executable is absent or conversion fails, and record an issue for a failed conversion. Conversion failure does not block text messages or documents.

Validate the converted file signature, size and expected type before replacing the staged object; never label original bytes with the converted extension. Canonical board JSON containing references is not itself sent to ffmpeg. Converted references and asset bytes are committed together before the API response. Do not re-encode an already imported/converted object or immutable historical media record.

Add `test/sync-media.test.mjs`. The absence path uses a temporary PATH with no converter. If a genuine converter exists, run one small known PNG generated with Node built-ins through it in the fixture and verify WebP RIFF/WEBP signature and references. Otherwise record that the optional real conversion check was unavailable; do not fake converter success.

Check: `node --test test/sync-media.test.mjs`. Expected: absence preserves exact bytes and text works; an installed converter produces verified local output; no remote upload occurs. Commit: `Convert staged media with an optional local converter`.

### Step 8. Project the complete mind and replay committed events

Create `engine/service/projection.mjs` with `readProjection`, `readCollection`, `readDetail`, `paginate`, `waitingFor`, `statusFor`, and `collectIssues`. Read scoped states, tasks, machine records/beats, immutable registrations/status events, chats/mailboxes, catalogs and sidecars without consuming anything. Reuse record parsers and the existing view's status precedence, not its old count/body limits or public shape. Leave `engine/view.mjs` and `hivem1nd-view-v1` unchanged. Emit the objects, null/default rules, search fields, ordering, derived IDs, project-chain filtering and counts in contract 3.2 through 3.4. Malformed individual records become safe relative-path issues; malformed states have unknown status and null revision. An inaccessible root is 503.

Freshness uses the injected clock: service beat at most 180 seconds old and no more than 30 seconds future means answers; a stopped beat means no. Activity/quota older than 15 minutes becomes null/unknown, not idle confidence. A terminal session status overrides older observations. Resolve one canonical Overseer from state and expose duplicate issues; derive squads/leads from lead state, not chat members. Deduplicate Waiting by its underlying approval/task/message/question ID and keep review gating. Layout/settings are read from their prescribed private records with documented defaults only when absent.

Pagination first computes the complete validated filtered/sorted collection, total and issues, then slices. The base64url cursor contains contract identifier, hash of canonical normalized filters, snapshot hash and position. Decode with strict size/type/position bounds; filter changes are invalid_cursor and snapshot changes cursor_expired. Message pagination selects the newest bounded slice before returning chronological order; before and cursor are exclusive. Full view measures actual UTF-8 envelope bytes and returns view_too_large over 16 MB, with usable list guidance. No silent truncation.

Create `engine/service/events.mjs` with `createEventBus`, `emit`, `captureCursor`, `subscribe`, `replay`, and `closePrincipal`. Use one random startup UUID and increasing integer; keep 1000 events for at most ten minutes. Copy safe event data at durable commit time and preserve the original cursor on replay. Apply principal visibility first, then AND filters only where fields exist; global service/settings/sync/reset events pass. Register the live subscription before replay/snapshot work, buffering events during that work to close the race. Capture every response meta.eventCursor before asynchronous snapshot reads. Equal resource revisions are duplicates; SHA hashes are never ordered.

Implement every event named in contract 4: stream.ready, stream.reset, service.changed, unit.changed, view.changed, session.changed, session.request.changed, chat.changed, message.created, message.read, notification.changed, approval.requested, approval.answered, approval.grant.changed, task.changed, layout.changed, settings.changed, home.changed, blueprint.changed, void.changed, editor.attachments.changed, comment.changed, void.proposal.changed, editor.asset.created, viewer.changed, editor.activity, watch.changed, sync.changed, sync.conflict, and issue.changed. Use the contract payloads rather than inventing aliases. Persisted operation markers deduplicate recovered commits; runtime activity never requires synced storage. Watch/viewer payloads are visible only to their owner. Phone serialization removes secrets/native endpoints before entering its stream.

SSE uses fetch bearer authentication, exact Last-Event-ID syntax, a 15-second comment heartbeat and bounded backpressure. Close a stalled stream rather than accumulating memory. Unknown/pruned/startup-mismatched cursor sends reset then ready; a valid cursor replays permitted newer events then ready. Revocation closes streams immediately. No heartbeat polls the origin.

Add `test/service-projection.test.mjs` for status precedence, stale/future beats, duplicate scoped names, Waiting deduplication, complete counts beyond one page, malformed entries, message ordering, cursor invalidation, revision-equal deduplication and a commit between cursor capture and file read. Check replay age/count, viewer isolation and revocation using real streamed responses once step 16 wires HTTP; initially test the event bus directly.

Check: `node --test test/service-projection.test.mjs`. Expected: complete truthful lists/counts, deterministic cursor failures, no consuming GET, and no missing concurrent event or other-viewer replay. Commit: `Project scoped mind data and replay committed service events`.

### Step 9. Create units and persist lead, layout and settings changes

Create `engine/service/units.mjs` with `createUnit`, `connectLead`, `patchLayout`, and `patchSettings`. Validate contract enums and scoped IDs through identity.mjs. Creation checks the selected machine's current answers before any state/layout write, rejects an existing canonical ID or second Overseer, validates the chosen lead and creates state plus initial position in one transaction. Store role, unit-id, machine, job/model and lead-id in the specified state representation; do not derive launch arguments from GUI strings later.

`connectLead` requires confirmed true and the current raw state revision. Master cannot receive a lead. Resolve both ends in canonical scope; reject missing/invalid leads and any cycle by walking the entire proposed lead chain with a visited set. Save only the target's lead header and retain all other headers, body, grants and unknown state data. A multi-target user gesture remains independent confirmed requests, not a partial hidden batch.

`patchLayout` preserves every unrelated node/group, validates all canonical units/group IDs and finite coordinates within plus/minus 100000, and checks null/actual revision. Shared group collapsed state is persisted; selection, zoom and viewer drafts are not. `patchSettings` changes only look/language, defaults modern/en on an absent file and requires at least one documented field. Emit the specific change and derived view event only after durable commit/staging. Add these operations to `test/service-projection.test.mjs`: offline machine, duplicate Overseer, cross-scope cycle, master lead refusal, untouched position preservation, concurrent drag/settings conflict, invalid numbers and duplicate receipt retry.

Check: `node --test test/service-projection.test.mjs test/core-identity.test.mjs`. Expected: validation failures write no state/layout, stale revisions preserve the newer bytes, and each successful group yields one complete event set. Commit: `Persist validated units leads layout and settings`.

### Step 10. Save chats, mailbox acknowledgments and deterministic fanout

Create `engine/service/chats.mjs` with `createChat`, `patchChat`, `postChat`, `postMailbox`, `readChat`, `readMailbox`, `queueNotice`, and `recoverNotifications`. Implement contract 2.4 and 3.4 paths and record shapes. A direct chat sorts/deduplicates master plus selected unit and uses the deterministic UUIDv8 tuple; a group gets a new UUID and includes master, with at most 256 unique existing members. Creating an existing direct chat returns its original history. Unlisting/pinning changes chat.md under revision checks without removing any message or membership.

Message author comes exclusively from credential/verified local binding. Validate bounded string body, subject, priority, same-destination reply IDs and up to 64 typed attachment references before admission. Empty body is permitted for subject/attachment-only posts; comments still require nonblank text. Serialize the complete immutable record before charging. Commit the message and pending fanout descriptors together; deterministic notices use the message-recipient key and resource ID, exclude the author, and never duplicate a logical charge. Deliver a chat reply to the chat, not a guessed mailbox. Offline mailbox destinations remain durable. Notification submitted means native input was acknowledged, not that the agent answered. Ambiguous submission is never automatically replayed; retain pending/failed/ambiguous visible outcomes through restart.

Chat read validates every explicit acknowledged ID and membership, then writes one immutable receipt under the reader-machine namespace. Only those IDs become read; a late older-timestamp message stays unread. A mailbox read validates all IDs and target archive collisions before moving anything, copies/verifies exact bytes before source removal, journals the batch, preserves identical late twins as already read and fails archive_collision on same ID/different bytes. Inspecting detail/history never archives. Reading a chat does not read an agent's notice. Desktop master may explicitly read another mailbox; bound agents only their own and phone only master's. Return actual remaining unread and alreadyReadIds as specified.

Add `test/service-messaging.test.mjs`: direct reuse, group membership limits, pin/unlist retained history, empty-body subject/attachment-only chat and mailbox posts, UTF-8 complete-byte caps, author forgery, cross-chat replies, fanout retry/restart, ambiguous native submission, late receipts/twins, mixed valid/invalid read IDs, archive collision and crash midway through a read transaction. Check projection and emitted message/chat/notification/view events against actual files.

Check: `node --test test/service-messaging.test.mjs test/sync-pulse.test.mjs`. Expected: one post/fanout per request, immutable history retained, every explicit read is atomic, and late messages remain unread. Commit: `Persist chats mailbox reads and restart-safe notices`.

### Step 11. Resolve native approvals on their owner and revoke grants safely

Create `engine/service/approvals.mjs` with `normalizeAction`, `requestApproval`, `answerApproval`, `consumeAnswers`, `approvalRevision`, `revokeGrant`, and `consumeRevocations`. Implement contract 2.5 records exactly. The requesting binding fixes unit/session/machine; a supplied chat must contain that unit and master. Only the request owner can publish its result and answer-result outcomes. Requests expire 120 seconds from creation; persist the request before notifying and start a local deadline timer. On restart inspect elapsed requests without renewing their lifetime.

Normalize the three supported action shapes exactly: process.run command plus registered normalized cwd, file.write resource plus normalized eligible relative path, network.request uppercase method plus exact normalized origin and path. Compare canonical normalized JSON for grants; never use shell globs, regex or prefix matches. A native operation lacking exact information has alwaysAllowed false; unsupported action is unsupported_action and returns control to the native prompt. Revocation tombstones take precedence over imported older state grants. A new grant has a new UUID.

`answerApproval` checks the composite approvalRevision and expiry under lock, creates an immutable answer and returns queued if the owner is remote. The owner serially chooses the first valid received answer, publishes result plus per-answer applied/rejected/expired outcome, and atomically adds a unit-scoped grant for approve-always only when native support and exact normalization permit. Later answers cannot change the decision. ApprovalRevision is the hash of canonical request-hash, sorted answer-hashes and result-hash, so pending remote answers still invalidate a stale dialog. Recheck attachment and native session liveness before resuming the operation. A deny, timeout, delivery failure or service error never turns into allow.

Grant revoke creates a revision-checked immutable owner-directed request and returns pending remotely; owner removes the ID, writes tombstone/result and preserves unrelated/new grants together. A result is not fabricated on the requesting viewer's machine. Emit approval/unit/grant/waiting/notices after the actual owner commit. Native decisions resolve once; durable result replay cannot rerun a gated operation.

Add `test/service-approvals.test.mjs` for competing local/remote answers, expired requests, unsupported always, normalized exact matching, restored older state, new grant ID after revoke, owner tampering, stale dialog, restart and adapter failure. Use two fixture services for remote ownership; fake transports test protocol failure paths only, never assert a fake installed client is a working adapter.

Check: `node --test test/service-approvals.test.mjs test/sync-apply.test.mjs`. Expected: exactly one owner decision, every answer has truthful terminal feedback, no default allow, and revoked grant IDs cannot revive. Commit: `Resolve owner-bound approvals and durable grant revocations`.

### Step 12. Apply task transitions and undo without losing Reports

Create `engine/service/tasks.mjs` with `loadTask`, `reviewAuthority`, `changeStatus`, `undoStatus`, and `recoverTaskChanges`. Parse header values while preserving Request, Report and unknown sections/line endings. Implement the exact transition graph and authority in contract 2.6: an assigned bound unit can submit review; its current lead records lead approval where needed; master accepts only a reviewable review and can send it back with a nonblank note. Closing done and reopening closed follow the documented requester/lead/master authority. Resolve legacy requester aliases to master without rewriting task history.

Under the task lock verify raw revision, valid transition, required note and current lead approval before preparing a transaction. Append the note/audit rather than replacing Report. Each durable status change gets one UUID immutable change record recording before/after revision, statuses, actor and note. Journal task and record together; on crash finish or preserve the conflicting third-party bytes through step 1 recovery. A no-op status is status_unchanged. `undoStatus` permits only the latest non-undone record whose afterRevision equals current bytes; restore its former status, retain all appended notes and append the undo audit with a new changeId/undoOf. Determine undone IDs from subsequent immutable kind:undo records; never rewrite the original status record. Commit task plus the new undo record together. Undo requires the original actor or task requester and normal ownership checks. An external edit invalidates undo; do not infer it from status alone.

Add `test/service-tasks.test.mjs` for the whole transition/actor table, changed lead, missing lead approval, send-back note, repeated Request/Report preservation, stale revisions, repeated receipt, intervening external edit, multiple undo and crash after task but before record. Include Windows CRLF and UTF-8 notes. CLI bindings will call these operations in step 20, rather than duplicate mutation logic.

Check: `node --test test/service-tasks.test.mjs test/service-projection.test.mjs`. Expected: only authorized edges commit, lead gating remains intact, Report survives, and undo cannot erase a newer external edit. Commit: `Journal authorized task transitions and conflict-safe undo`.

### Step 13. Start and stop genuine native sessions with a durable launch ledger

Create `engine/service/adapters.mjs` with `probeClients`, `createNativeAdapter`, `enqueueStart`, `consumeStart`, `recoverStarts`, `registerNative`, and `stopSession`. The adapter interface is `{probe,create,send,observe,requestPermission,stop,close}`; returned capabilities distinguish create, resume, stop, exact approval and model selection. Existing wake adapters remain the verified resume paths for attached sessions. Executable presence alone is installed, not start support. Only the three contract Client enum values can start; other existing adapters retain wake compatibility. Missing/disabled/schema-incompatible/native-login-unavailable creation returns client_unavailable. An unsupported external-session stop returns stop_unavailable, never a fabricated stopped observation.

Resolve commands as executable plus argument array, shell false, windowsHide true; resolve Windows native wrappers to their actual Node entry/executable using existing adapter conventions rather than invoking an arbitrary command string. Probe local `--help`/version and protocol initialization with bounded timeout/output. Retain only process handles spawned by this service. Validate every native response against the installed protocol's documented shape. Keep provider login/config in the native client; do not read/search/export OAuth tokens. If a requested model cannot be selected through verified installed capabilities, fail explicitly before launch rather than ignoring the state model.

For the `codex` enum, use the documented stdio backend `app-server --listen stdio://`. Exchange newline JSON-RPC initialize with clientInfo name/title/version then initialized. `thread/start` with registered cwd and supported model produces nativeSessionId from result.thread.id; omit approval-policy overrides and inherit the person's native config. Send input through `turn/start` with threadId and typed text input; an active turn uses turn/steer with expectedTurnId. Interrupt uses turn/interrupt then waits for the matching interrupted turn/completed. Owner backend exit confirms session stop; close stdin and wait, then signal only the owned child if necessary. Approval requests item/commandExecution/requestApproval and item/fileChange/requestApproval use actual native request IDs; accept/decline/cancel are verified decisions. Exact file grants require genuine prior file item/path data. Reject missing exact details for always policy. See the [official native backend reference](https://learn.chatgpt.com/docs/app-server); check generated schema/help locally before accepting optional fields.

For the `cursor` enum, use the native ACP backend `agent acp`, newline JSON-RPC. Initialize protocolVersion 1, clientCapabilities fs readTextFile/writeTextFile false and terminal false, then authenticate with the advertised existing-login method. `session/new` with registered cwd and mcpServers returns the genuine sessionId; prompt takes that sessionId and typed text content. Negotiate model through advertised installed session capabilities, failing an unsupported requested model. Permission requests choose an actual offered allow-once/reject-once option; grants still choose once per exact operation. Cancel waits for native completion and owned backend exit before stopped. Do not copy the reference's unconditional permission allow. The [official ACP transport example](https://cursor.com/docs/cli/acp) and [session setup specification](https://agentclientprotocol.com/protocol/v1/session-setup) define framing and capability negotiation; unsupported requests get a safe protocol error, never silent approval.

For the `claude` enum, probe the installed CLI's print, verbose, stream-json input/output, session-id and model flags, then start the genuine stream process in the registered cwd with a newly generated UUID native session ID. Wait for its system initialization event carrying the matching session ID and successful existing-login startup before registration. Feed only the initialization instruction needed to load the unit/job/lead and remain ready; the optional task prompt is not embedded in that instruction. Subsequent input uses verified stream-json user messages. Stop is available only for the owned process and completes on actual exit. Supported synchronous PreToolUse returns the documented permission decision; inability to represent/fallback safely makes gating unavailable. Use the [official CLI reference](https://code.claude.com/docs/en/cli-reference) and [hook decision reference](https://code.claude.com/docs/en/hooks#pretooluse) to confirm installed shapes; do not use permission bypass flags. Missing initialization or installed stream support fails without registering success.

All backends supply a startup instruction identifying the canonical unit and reading its existing role/job/lead context from safe registered files. Protocol requests are bounded, IDs correlate exactly, output is untrusted text and stderr is redacted. Native endpoints and credentials stay in memory; no synced observation, API error, event, log, argv or registration contains a token/pipe URL. Provider-native authentication failure is surfaced safely.

Enqueue validates answers, current unit revision, existing active use, enabled genuine capability and prompt admission size. Write the immutable request addressed to the selected machine with 120-second expiry. The consumer acquires a canonical per-unit launch lock as well as the request lock, then rechecks answers, expiry, stateRevision, no active or pending session, local registered cwd and capability. Persist the pending unit reservation in its prepared L/session-starts/requestId journal before native creation; maintain that claim through spawned with actual process/native ID proof and registered with the stable session ID. Recover unresolved unit reservations before accepting new starts. Two different request IDs for the same unit cannot both claim or spawn. Write the owner result progression only after each genuine phase; started requires native initialization plus persisted registration. Result projection is monotonic and terminal never regresses.

Recovery first reconciles the journal with a currently verified owned/native connection. Prepared with no possible side effect can retry; spawned or an uncertain crash gap cannot blindly create another session. Mark launch_ambiguous when the effect cannot be proved, retain the issue and require explicit fresh user request. Persist a consumed marker before handing input to a backend; attempted-but-unacknowledged input is ambiguous, never replayed. The optional preload becomes exactly one first Relay message from master after successful registration, keyed by requestId, and uses normal admission/fanout. A crash before/after that message is resolved by the immutable key and receipt. Late results do not revive an expired/stopped session.

Add `test/service-sessions.test.mjs`: each unavailable enum, unsupported model, stale state, no heartbeat, expiry, remote owner, prepared/spawned/registered crash boundaries, terminal nonregression, preload exactly once, no endpoint leaks and stop acknowledgment. Protocol fixture transcripts exercise parser failures and durable recovery only. Genuine installed-backend smoke tests run in a disposable repository with service-owned children, no build/commit instructions and a harmless short response; if executable/login/quota is absent, report that real capability as unavailable. A transcript or mocked process never proves native support. Existing attach is also tested without killing the caller's session.

Submit concurrent different request IDs for the same canonical unit, including restart with a spawned reservation; prove only one native create call and one successful result, with unit_in_use for the competing claim.

Check: `node --test test/service-sessions.test.mjs test/service-messaging.test.mjs`. Expected: no unsupported client produces a started registration, uncertain launch never duplicates, preload follows genuine registration once, and stopped requires acknowledgment. Commit: `Launch verified native sessions with crash-safe ownership`.

### Step 14. Own one service process and adopt bounded wake policies

Create `engine/service/service.mjs` with `startService`, `attachOrStart`, `acquireServiceLock`, `adoptWake`, `writeBeat`, and `stopService`. Require a configured mind and local config before starting; no host discovery or automatic installation. Every startup first acquires an OS-owned private guard socket bound to exactly 127.0.0.1 at one deterministic per-user port: `49152 + uint16BE(SHA256(actual OS SID or numeric uid),0) % 16384`. Obtain the real SID/uid from the OS, never supplied machine/client names. The guard has no API/data, closes accepted connections, has no alternative-port fallback and is held for the service lifetime through descriptor cleanup. OS crash cleanup releases it automatically. A rare unrelated port collision is a safe availability failure.

Only the guard owner may create/reclaim the global per-user Cosmic service.lock by exclusive creation, or mutate active/bootstrap/ownership descriptors. Check the private owner nonce/PID marker and exact descriptor digest. If stale, re-read unchanged metadata before replacing it while still holding the guard. On EADDRINUSE, attach only after proving the existing service through protected bootstrap, matching actual user/mind/machine/start descriptor and exact origin; a live different mind is service_mind_conflict. An unrelated occupant is service_unavailable; an owned/already-starting service that fails to publish bootstrap within ten seconds is service_start_timeout. Both fail with no file mutation or signal to the occupant. PID liveness probes never signal or kill. This guard serializes stale reclaim across processes; a second contender cannot erase the first contender's fresh lock.

At this step, accept subsystem factories for listener, bootstrap/security, bridge and future home/MCP/editors; lifecycle tests supply test-owned factories that expose actual local readiness and close behavior. Import only already-created production modules. Step 16 composes the real security/HTTP factories and subsequent steps attach the real remaining domains. This staging proves singleton/adoption lifetime now, not nonexistent GUI/native functionality; the final service has no test-factory fallback.

Startup order is config/path validation, lock, journal/receipt recovery, migrations/adoption, ephemeral credential store, loopback listener, bootstrap/active descriptor, local bridge, projection/file watchers, origin watcher/pulse and in-process wake policy adoption, then running beat. Roll back handles and owned descriptors on any failed stage. Persist active/service descriptors with contract fields only. Store the owner nonce only in the private lock/local ownership marker alongside the exact descriptor digest; do not add it to a shared descriptor. One service owns one wake controller and all native connections; no viewer, hook, stdio client or ordinary CLI starts a separate per-session worker. Child runtime startup receives configuration via inherited environment/IPC, with no secrets in arguments.

Change `engine/relay/wake.mjs` binding normalization/key generation and policy persistence to accept canonical unitId while reading legacy bindings. Merge duplicates with earliest existing deadline, smaller remaining budget, union delivery IDs and submitted/ambiguous dominance. Never renew a deadline or unlimited consent through migration/adoption. Keep attempted-to-ambiguous recovery, bounded retries, busy deferral, handoff budget and per-binding local lease. Service-owned leases use its nonce and controller; takeover is explicit after the old lease is dead/released, not two simultaneous sinks. Existing workers observe adoption and voluntarily stop/release; signal only a worker actually spawned/retained by this invocation. A lost unknown worker stays an issue until lease expiry. Do not kill a PID from old files.

Create `engine/service/bridge.mjs` `openBridge`, `attachNative`, `dispatchLocal`, and `closeBridge`. This is a machine-local authenticated IPC transport for legacy operations and endpoint handoff, not a new GUI HTTP API. Use a private Unix socket below L or a random Windows named pipe; protect its descriptor/credential with bootstrap permissions and authenticate every message. Strict bounded JSON carries operation, correlation UUID and verified binding; native endpoint proof/secret is transferred only over this local channel into memory. Authenticate bootstrap owner separately from bound agent authority. Attachment checks the explicit canonical unit, current native identity plus the existing adapter's genuine endpoint handshake, machine and policy. Saved registration alone is insufficient. Issue an in-memory agent credential only after successful native verification; attachment changes/revocation invalidate it. Forward legacy register/send/read/history/reminder/activity and wake-policy operations to the same service operation layer under its normal authority and ledgers.

On service restart, adopt persisted observations/policies without reconstructing ephemeral endpoints. Pause unavailable transport with a safe reason and await native hook/MCP reattachment. Terminal session-status records prevent old registration revival. Startup plus at-most-once-per-minute beat uses origin byte allowance; local answers-expiry timers emit truthful changes even if no file event occurs. Graceful stop revokes viewers/HomeGrant/agents, closes SSE/bridge/listeners/watchers/timers, closes owned native backends/controllers, preserves staging, writes allowed stopped beat, then removes descriptors only after the private lock nonce still matches and their exact digest remains the one recorded by this owner. A host handle logout does not call stopService.

Add `test/service-lifecycle.test.mjs`: two concurrently spawned service attempts with one instance, different-mind refusal, stale lock races, descriptor PID reuse without unsafe signaling, bootstrap readiness, adoption with expired policies/ambiguous deliveries, reconnect requirement, graceful stop and crash recovery. The fixture owns every process it starts and verifies no per-session worker was spawned. Keep legacy controller-level tests running against injected sinks to verify their established bounded delivery behavior.

Fixture users get separate test-owned guard ports; same-user contenders share one injected private port. Use barriers where A/B inspect a stale owner, A wins the guard and installs a fresh descriptor, then B resumes. B must attach/refuse without removing A's files or opening another listener. Test an unrelated occupied guard, no fallback, actual crash release and guard retention until descriptor cleanup finishes.

Check: `node --test test/service-lifecycle.test.mjs test/relay-wake.test.mjs`. Expected: one service per fixture user, no deadline/budget refresh, no duplicated sink and no signal to an unowned PID. Commit: `Own one per-user service and adopt existing wake policies`.

### Step 15. Protect bootstrap credentials, network peers and audiences

Create `engine/service/security.mjs` with `protectLocalFile`, `verifyLocalPermissions`, `createCredentialStore`, `authorize`, `checkPeer`, `checkHost`, `checkOrigin`, `checkLimits`, and `safeError`. POSIX L/secret parents are 0700 and bootstrap 0600, verified after creation. On Windows obtain the current user's SID through a bounded local OS query, disable ACL inheritance on the protected directory/file, set allow rules only for that SID and SYSTEM, and verify the resulting ACL before exposing bootstrap. Use a PowerShell script supplied as a fixed encoded program with literal path/SID arguments, never string-built shell commands. Use native ACL cmdlets to enumerate access rules and owner; inherited or broad/readable principals fail bootstrap_unavailable. This is actual protected-file behavior, independent of registration dry runs. Tests operate on temporary files, verify ACLs where supported and inject failure to prove no token is exposed on failure. Protect config/bridge secret descriptors too.

Credential storage is memory-only random 32-byte base64url tokens with stable principal identity, audience, bindings, capabilities, expiry and viewer overrides. Compare decoded fixed-size secret buffers timing-safely. Rotation/revocation removes streams, Watch and pending native capabilities. Do not persist bearer tokens in receipts/config/messages or log bodies/Authorization/fragments. Validate bootstrap on same-user reads through permissions and exact origin/startup descriptor; refuse world-readable fallback.

Loopback accepts only remoteAddress 127.0.0.1 or its exact IPv4-mapped form, exact Host `127.0.0.1:<actual-port>` and, when supplied, exact loopback Origin. Every write including native forwarding requires that Origin. Reject localhost, other 127/8, IPv6 loopback, suffix matches, duplicate/forwarded hosts and cross-site headers. No CORS headers/OPTIONS allowance. LAN sockets use their exact bound private IPv4 and port for Host/Origin and strict same-interface subnet peers from the netmask; no trust in forwarding headers. A full desktop/agent token is rejected on LAN even if otherwise valid.

Authorize by route operation and object membership, never GUI visibility. Desktop gets exactly contract 6.3 capabilities. Phone gets exactly read, chat.post, master.read, approval.answer, task.accept, task.send-back: all safe detail/list/settings/event reads; post only an existing chat or existing recipient mailbox as master; acknowledge only master chat/mailbox reads; approve/deny including supported always; reviewable review to done/open only. Unit/chat creation, pins, layout/settings/home writes, grant revoke, session control, undo, editors/comments/assets/proposals/Watch/viewer writes all return phone_read_only. Bootstrap is never a phone upgrade path. Agents get only contract 6.1's explicit own-unit/session/approval details and own-filtered events, own/member messaging/read acknowledgments, assigned task delivery/current-lead send-back, attached editor operations and own approval requests. General mind/foreign mailbox/settings/grant reads are forbidden. Re-evaluate attachment/lead/session on every operation, not merely token issuance. Agent cannot answer the person's approvals or accept its own delivery.

Enforce contract 7 HTTP/JSON/SSE caps while streaming; exact decimal byte counts, four streams/principal, 240 requests/minute and home exchange limits of five failed attempts per peer and 30 across the grant per rolling minute. Use both peer and grant counters so changing peers cannot bypass the global cap. Reject overlong URL/header before parsing; request timeout is 15 seconds. Require supported JSON media type for writes, unknown keys and duplicate query keys are rejected. Authentication counters never write an idempotent receipt. safeError strips absolute paths, stack/native output/credentials and returns common envelope with requestId and precise retry time.

Add `test/service-auth.test.mjs`: a table of every audience versus every write family, master-only acknowledgments, attached/detached agent, mixed token/listener, exact/malicious Host/Origin/peer cases, fake forwarded headers, IPv4/netmask edge cases, ACL failure, expiry/logout, body streaming overflow, depth/array/header/URL caps, request/SSE counters and no secret-bearing error. Use injected socket metadata for otherwise inaccessible LAN cases and genuine local sockets for transport tests.

Check: `node --test test/service-auth.test.mjs test/service-lifecycle.test.mjs`. Expected: fail-closed bootstrap, all phone-forbidden writes fail before side effects, exact listener authority and safe bounded errors. Commit: `Enforce private bootstrap network checks and credential audiences`.

### Step 16. Wire the complete bounded HTTP API and packaged shell

Create `engine/service/http.mjs` with `createHttpServer`, `routeTable`, `readJsonBody`, `decodeId`, `respond`, `serveStatic`, and `serveEvents`. Route dispatch order is peer/Host/Origin, size/rate checks, credential/audience, exact route schema, principal/key receipt lock, resource locks/revision checks, durable domain operation, safe response. Public auth/static exceptions are explicit. Every mutation except auth requires Idempotency-Key; DELETE bodies are JSON where specified. An unavailable/malformed resource is not replaced by a success-shaped default. Method mismatch returns 405 and exact Allow. Return contract meta/requestId/sync values and safe common errors; binary asset/SSE/204 are the only non-JSON success cases.

Use this dispatcher structure for protected JSON routes. Declare `parseRequestTarget(rawTarget,listenerOrigin)` requiring a relative target beginning with one slash, rejecting absolute URLs, network-path references, backslashes, traversal and alternate origins before URL normalization, then returning a URL against the already validated listener origin. Declare `matchRoute(method,pathname)` returning a table entry plus once-decoded canonical params; `validateQuery(route,searchParams)` consumes URLSearchParams without collapsing duplicate entries; `validateBody` applies that entry's exact contract schema; `canonicalRoute(route,params)` uses the decoded canonical identity for receipts. Each domain `prepare(input)` allocates stable IDs and returns `{entries,eventSpecs,status,data,sync}` without modifying target files; store.commitTransaction commits it with its exact response/receipt as step 1 specifies. Read handlers accept the same input but return data only. The real signatures in store/security/context must match this structure:

```js
async function dispatchJson(req, res, context) {
  const requestId = randomUUID();
  const eventCursor = context.events.captureCursor();
  try {
    context.security.checkPeer(req, context.listener);
    context.security.checkHost(req, context.listener);
    context.security.checkOrigin(req, context.listener);
    context.security.checkLimits(req, context.listener);
    const url = parseRequestTarget(req.url, context.listener.origin);
    const { route, params } = matchRoute(req.method, url.pathname);
    const principal = context.security.authenticate(req, context.listener);
    await context.security.authorize(principal, route.operation, params);
    const query = validateQuery(route, url.searchParams);
    const body = route.write ? validateBody(route, await readJsonBody(req, route.bodyCap)) : null;
    const input = { principal, params, query, body, requestId, eventCursor };
    const envelope = (data, sync) => ({
      contract: 'hivem1nd-gui-v3', data,
      meta: { requestId, readAt: new Date(context.now()).toISOString(), eventCursor, sync },
    });
    if (!route.write) return respond(res, 200, envelope(await route.read(input), 'local'));
    const key = requireUuidHeader(req, 'idempotency-key');
    const receiptInput = {
      principal: principal.stableId, key, method: req.method,
      path: canonicalRoute(route, params), body, requestId, eventCursor,
    };
    const result = await context.store.withReceipt(receiptInput, async receipt => {
      const prepared = await route.prepare(input);
      prepared.response = {
        status: prepared.status,
        body: prepared.status === 204 ? null : envelope(prepared.data, prepared.sync),
      };
      prepared.receipt = receipt;
      return context.store.commitTransaction(prepared);
    });
    return respond(res, result.status, result.body);
  } catch (error) {
    const safe = context.security.safeError(error, requestId);
    return respond(res, safe.status, safe.body, safe.headers);
  }
}
```

Authorization runs before receipt lookup on every retry. withReceipt owns the stable principal/key lock across routes, and commitTransaction writes the prepared response into the same journal before after-images become durable. respond suppresses body for 204 and preserves Retry-After/Allow. Adapt the separate auth/HomeGrant memory-only/static/SSE/binary paths explicitly; do not persist a secret-bearing response through this generic wrapper. Capture cursor before asynchronous reads, including read routes, rather than at response time.

Implement this whole route inventory. Paths in the table have `/api/v1` prefix except `/mcp`. D means desktop, P means phone with the restrictions in step 15, and A means verified agent with object restrictions. Read authorization does not grant an adjacent write. The contract's exact query/body/result table is normative; do not add body fields or routes to ease GUI work.

| Methods and relative paths | Domain handler | Audience |
| --- | --- | --- |
| GET /view, /units, /leads, /squads, /projects, /machines, /sync | projection.readCollection/readProjection | D, P |
| GET /sessions | projection.readCollection | D, P; A forced bound-unit filter |
| GET /units/:unitId | projection.readDetail | D, P; A bound unit only |
| POST /units | units.createUnit | D |
| PUT /units/:unitId/lead | units.connectLead | D |
| POST /units/:unitId/session | adapters.enqueueStart | D |
| GET /session-requests/:requestId | projection.readDetail | D, P; A own |
| POST /sessions/:sessionId/stop | adapters.stopSession | D |
| GET /layout | projection.readDetail | D, P |
| PATCH /layout | units.patchLayout | D |
| GET /chats, /chats/:chatId, /chats/:chatId/messages | projection.readCollection/readDetail | D, P; A member |
| POST /chats | chats.createChat | D |
| POST /chats/:chatId/messages | chats.postChat | D, P; A member |
| POST /chats/:chatId/read | chats.readChat | D, P master; A self |
| PATCH /chats/:chatId | chats.patchChat | D |
| GET /mailboxes, /mailboxes/:unitId/messages, /mailboxes/:unitId/messages/:messageId | projection.readCollection/readDetail | D, P; A own |
| POST /mailboxes/:unitId/messages | chats.postMailbox | D, P master; A bound sender |
| POST /mailboxes/:unitId/read | chats.readMailbox | D, P master; A self |
| GET /approvals, /approvals/:approvalId, /approvals/:approvalId/answers/:answerId | projection.readCollection/readDetail | D, P; A own |
| POST /approvals/request | approvals.requestApproval | A |
| POST /approvals/:approvalId/answer | approvals.answerApproval | D, P |
| GET /units/:unitId/approval-grants | projection.readCollection | D, P |
| DELETE /units/:unitId/approval-grants/:grantId | approvals.revokeGrant | D |
| GET /grant-revocations/:requestId | projection.readDetail | D, P |
| GET /tasks, /tasks/:taskId, /waiting | projection.readCollection/readDetail | D, P; A assigned/current lead |
| POST /tasks/:taskId/status | tasks.changeStatus | D, P review accept/send-back; A permitted edge |
| POST /tasks/:taskId/undo | tasks.undoStatus | D; A original actor/requester only |
| GET /settings | projection.readDetail | D, P safe fields |
| PATCH /settings | units.patchSettings | D |
| POST /settings/home-network | home.openHome/closeHome | D |
| POST /auth/local | security.createDesktopViewer | bootstrap loopback only |
| POST /auth/home | home.exchange | public LAN only |
| POST /auth/logout | security.revoke | calling D or P |
| GET /blueprint/boards, /blueprint/boards/:resourceId | editors.list/readEditor | D, P; A attached |
| POST /editors/register | editors.registerResource | D |
| POST /blueprint/boards | editors.createBoard | D |
| PUT /blueprint/boards/:resourceId | editors.replaceBoard | D; A attached |
| POST /blueprint/boards/:resourceId/nodes | editors.addNode | D; A attached |
| PATCH /blueprint/boards/:resourceId/nodes/:nodeId | editors.updateNode | D; A attached |
| DELETE /blueprint/boards/:resourceId/nodes/:nodeId | editors.removeNode | D; A attached |
| GET /void/texts, /void/texts/:resourceId | editors.list/readEditor | D, P; A attached |
| POST /void/texts | editors.createText | D |
| PUT /void/texts/:resourceId | editors.replaceText | D; A attached |
| POST /void/texts/:resourceId/ranges | editors.replaceRange | D; A attached |
| GET /void/texts/:resourceId/proposals | editors.listProposals | D, P; A attached |
| POST /void/texts/:resourceId/proposals/:proposalId/answer | editors.answerProposal | D |
| GET /editors/:resourceId/attachments | editors.readAttachments | D, P; A attached |
| PUT /editors/:resourceId/attachments | editors.writeAttachments | D |
| GET /editors/:resourceId/comments | editors.listComments | D, P; A attached |
| POST /editors/:resourceId/comments | editors.createComment | D; A attached |
| POST /editors/:resourceId/comments/:threadId/replies | editors.replyComment | D; A attached |
| PATCH /editors/:resourceId/comments/:threadId | editors.setCommentStatus | D; A attached |
| GET /editors/:resourceId/assets/:assetId | editors.readAsset | D, P; A attached |
| POST /editors/:resourceId/assets | editors.createAsset | D |
| POST /watch, DELETE /watch/:watchId | watch.start/stop | D owner |
| GET /viewer, PATCH /viewer | security.readViewer/patchViewer | D owner |
| GET /events | events.subscribe | D, P; A scoped |
| POST /mcp; GET /mcp returns 405 | mcp.dispatch | A local only |

Routes whose later domain handler is not yet written return a named 503 service_unavailable now through an explicit handler map; do not import absent files. Replace those entries with real handlers at steps 17 through 20. HTTP validation/auth tests can already prove denial before handler dispatch. Complete coverage at step 24 forbids remaining unavailable placeholders except genuinely unavailable assets/native capabilities.

Public static reads serve only the packaged browser shell and explicit allowlist. Map `/app/` to `gui/app/` and allow exactly index.html, styles.css, main.mjs, api.mjs, stream.mjs, state.mjs, i18n.mjs, components.mjs, lists.mjs, map-geometry.mjs, map.mjs, hierarchy.mjs, chats.mjs, inspector.mjs, actions.mjs, settings.mjs, qr.mjs, qr-render.mjs, phone.mjs, embed.mjs, editors.mjs, blueprint.mjs, void.mjs, markup.mjs. `/` uses that index; `/gui/:viewerId/` uses the same shell only for a current matching desktop viewer and its exact frame-ancestors. These assets are the contract's packaged-static allowance, not new API types. Resolve allowlist names directly under configured assetDir and reject links/traversal; no mind file/static catch-all. Default assetDir points to packaged gui/app, while core tests inject a temporary shell/module/CSS. Missing independent GUI assets returns 503 for shell reads and does not prevent API/service startup.

Set CSP default/script/style/connect self, object/base none, verified image object URLs only, frame-ancestors none or the exact validated embedded host for that viewer route, nosniff, Referrer-Policy no-referrer and no-store. Nonembedded routes set X-Frame-Options DENY. Never weaken API Origin to embed host. Viewer presentation/dirty is memory-only; an update emits only viewer.changed to that viewer. Logout disposes its Watch and streams and returns 204.

Finish `service.mjs` production composition with available security/http/events/core domains and explicit dependency injection for future editor/home/MCP handlers. Add `test/service-api.test.mjs` whose route cases each assert success schema/status for an implemented fixture operation plus malformed body/query/path/method denial; later steps fill editor/home/MCP successes. Cover no-body routes, duplicate/unknown query fields, once-decoded IDs, JSON Content-Type, receipt reuse across different routes, exact Allow, static traversal, missing assets and binary asset errors. Extend projection/auth/lifecycle tests to real HTTP/SSE.

Check: `node --test test/service-api.test.mjs test/service-auth.test.mjs test/service-projection.test.mjs test/service-lifecycle.test.mjs`. Expected: all implemented route families work on real loopback, future routes fail safely, static absence leaves APIs usable, and snapshot/replay races pass. Commit: `Serve the complete authenticated HTTP route boundary`.

### Step 17. Open temporary home access and encode real QR symbols

Create `engine/service/home.mjs` with `eligibleAddresses`, `openHome`, `closeHome`, `exchange`, and `status`. Enumerate noninternal private IPv4 interfaces, sorting interface name then address. Validate an explicit addresses list against those exact current addresses; when omitted use the first. Reject public/IPv6/duplicate/unavailable interfaces. Bind each selected address explicitly, never 0.0.0.0, with a genuine actual port and per-interface peer/netmask checks. Prepare all listeners before activation; a failed bind closes every newly opened listener and leaves no partial grant. Re-enable first revokes the previous grant and every phone token/stream, even if the replacement fails.

Generate a 32-byte base64url key and unbiased six-character code using randomInt over the contract alphabet. Keep both memory-only. All returned links and qrPayloads are exactly the bound `http://IP:port/#home=key` strings; preflight every string with qr.mjs before making the grant active. Expire at openedAt plus 43200000 ms, with a local timer and immediate revocation on restart/listener loss/disable. Exchanges accept exactly key or code, compare safely, use listener/peer/global authentication counters and issue memory-only phone tokens expiring at the same instant. Exchange never extends grant lifetime. SSE home.changed contains status/reason only, never key/code/link. Settings/read status omits credentials; enable response gets memory-only idempotence handling.

Re-read local networkInterfaces on each LAN authorization/exchange and every 15 seconds while a grant is active, comparing the selected address and netmask exactly. Interface removal/change need not close a Node socket automatically; a mismatch closes the affected listener and revokes its phone credentials, and loss of the grant's selected interface closes the grant with home.changed. This local interface timer exists only during home access and never reads the origin. Add injected address disappearance/netmask-change checks, beyond explicit server.close tests.

Create `engine/service/qr.mjs` with `encodeQr`, `penalty`, `formatBits`, and `toSvg` if local CLI rendering needs it. Implement an independent byte-mode version 5-L encoder with no package, network endpoint or GUI import. The GUI independently encodes contract qrPayloads; bounded algorithm duplication avoids a shared implementation ABI or new API route. Use this fixed specification: 37 by 37 modules, 108 data codewords, one block with 26 Reed-Solomon parity codewords, 134 total codewords, 7 zero remainder bits, alignment center (30,30), dark module (8,29), maximum 106 UTF-8 bytes. Reject 107 bytes before producing a partial symbol. These are the [primary QR version/capacity facts](https://www.qrcode.com/en/about/version.html); compare independently against the [primary reference encoder](https://www.nayuki.io/page/qr-code-generator-library), without vendoring it.

Append bits MSB first: mode 0100, eight-bit byte count, exact UTF-8 bytes, up to four terminator zeros, then zero to a byte boundary. Pad alternating EC/11 hexadecimal bytes to 108. Compute GF(256) multiplication with primitive polynomial 0x11D, generator roots alpha^0 through alpha^25, alpha=2. This independently written division is sufficient for the only block:

```js
function multiply(a, b) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) result ^= a;
    b >>>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return result;
}
function parity(data) {
  let generator = [1], root = 1;
  for (let degree = 0; degree < 26; degree++) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, i) => {
      next[i] ^= coefficient;
      next[i + 1] ^= multiply(coefficient, root);
    });
    generator = next;
    root = multiply(root, 2);
  }
  const work = [...data, ...Array(26).fill(0)];
  for (let i = 0; i < 108; i++) {
    const factor = work[i];
    for (let j = 0; j < generator.length; j++) work[i + j] ^= multiply(factor, generator[j]);
  }
  return work.slice(108);
}
```

Maintain separate boolean modules/function masks. Draw timing row/column 6 alternating even coordinates. Draw finder centers (3,3), (33,3), (3,33) over clipped 9-square regions: max(abs(dx),abs(dy)) is dark except distances 2 and 4, which are white. Draw the sole 5-square alignment at (30,30), dark except distance 1. Reserve both format strips and the dark module before data. Version information is absent for version 5.

For error level L, format data is `(1 << 3) | mask`. Divide data shifted left ten by BCH generator 0x537 and XOR the combined 15 bits with 0x5412. Place LSB bits 0..5 at (8,i), 6 at (8,7), 7 at (8,8), 8 at (7,8), 9..14 at (14-i,8). Second copy bits 0..7 at (36-i,8), 8..14 at (8,22+i); set (8,29) dark. Coordinates are x,y, storage modules[y][x]. These cells are all function cells.

Place concatenated data/parity MSB bits in two-column stripes starting x=36, moving left by two; when x=6 use x=5. Traverse rows bottom-to-top when `((x+1)&2)===0`, otherwise top-to-bottom, right column then left, skipping function cells. After 1072 codeword bits put seven zeros. Assert exactly 1079 writable cells consumed. For each candidate mask flip only nonfunction cells using these predicates, then write its format bits:

| Mask | Flip when |
| --- | --- |
| 0 | (x+y) % 2 = 0 |
| 1 | y % 2 = 0 |
| 2 | x % 3 = 0 |
| 3 | (x+y) % 3 = 0 |
| 4 | (floor(x/3)+floor(y/2)) % 2 = 0 |
| 5 | (x*y)%2 + (x*y)%3 = 0 |
| 6 | ((x*y)%2 + (x*y)%3) % 2 = 0 |
| 7 | ((x+y)%2 + (x*y)%3) % 2 = 0 |

Choose minimum penalty, lowest mask breaks ties: horizontal/vertical same-color run length at least five adds 3 plus length minus five; each monochrome 2-square adds 3; each 1:1:3:1:1 dark/light finder-like run with at least four light modules before or after adds 40 per qualifying side, treating the exterior quiet zone as light; every full 5-percent departure from 50-percent darkness adds 10. Keep a forced-mask option only for verification. Raster/SVG rendering adds four white modules on each edge and integer scale; SVG contains only generated paths/rectangles and fixed dimensions, no payload markup. The encoder's actual matrix is the result, never a placeholder pattern.

Add `test/service-qr.test.mjs`: forced-mask-0 symbols serialized as 37 LF-joined strings of 0/1 with no final LF have SHA-256 `83549c0a12eb68c8716657575309cb4255bb529bfd795aebb1570b256ec34549` for `http://192.168.1.23:43123/#home=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, and `28571cbdad17176449c375be5ff4484c96ab69a72384c1fbe30595e2a902a1f5` for 106 x bytes. Those independent primary-reference goldens are mandatory. Implement an independent test extractor that reads format BCH, unmasks and walks codewords, verifies Reed-Solomon syndromes and decodes exact bytes. Cover multibyte boundaries, 107-byte rejection, all masks, function cells and quiet zone. Add home cases to service-auth/api tests: 12-hour exact expiry, re-enable, all-or-nothing bind, code rate limit, listener loss, phone-token revocation and no secret in events/logs/config/origin.

Check: `node --test test/service-qr.test.mjs test/service-auth.test.mjs test/service-api.test.mjs`. Expected: both golden digests and independent decode pass; only exact bound payloads activate; every old grant/token stops working on revoke/expiry. Commit: `Encode valid QR symbols and time-bound home access`.

### Step 18. Save full Blueprint data and make Lite preserve unsupported fields

Create `engine/service/editors.mjs` catalog/board sections: `registerResource`, `discoverResources`, `readEditor`, `list`, `validateBoard`, `preserveUnknown`, `createBoard`, `replaceBoard`, `addNode`, `updateNode`, `removeNode`, `readAttachments`, `writeAttachments`, `readAsset`, and `createAsset`. Implement contract 2.8 paths/IDs/index behavior and registered-project resolution. Discover only eligible regular files under a locally registered repository. Legacy modules are metadata-only read-only with document null; never execute them. Register is idempotent for the same normalized project/kind/path. Missing local project is project_unavailable, not a substituted path. Creating JSON never overwrites a legacy module or another catalog/index ID.

Validate the complete bounded board: document id/title/rev-compatible shape, every screen/root/node/link ID and references, type and required geometry, unique IDs, box children, order/page relationships, finite coordinates, and contract 7 size/depth/node/link limits. Accept bounded JSON unknown fields recursively at every level, including nonempty components, fonts, threads and page objects, plus future shadows/blur/pixelate/valign. Known typed enums and numeric limits remain exactly strict as contract 2.8 specifies; unknown property names and explicitly opaque data are accepted, not invalid values for known type/kind/align/transition fields. Renderers may ignore unsupported drawing data, but persisted replacement cannot discard it.

`preserveUnknown` walks matching surviving document/screen/node/link/page/component IDs and nested plain objects. For full replacement, an unknown property that existed on a surviving entity must still exist with its retained structure/value unless the submitted value explicitly preserves/replaces that property; missing nested unknown data is unsupported_fields_lost. Array identity matches by its documented stable ID/key, never by index; otherwise preserve the whole unsupported array. Legitimately removed nodes/screens remove their unknown data together, not other survivors. Patch recursively merges plain objects, replaces arrays, retains a supplied opaque null as a JSON value, forbids id/t/kids mutation and revalidates the entire result. It is not RFC 7396 null deletion. A patch to known geometry does not reconstruct the node or strip fields.

Create board plus index/catalog/attachments as one transaction. Preserve index unknown properties and unrelated entries. Add node resolves screen and box parent, validates insertion index and unique subtree IDs; update node applies bounded merge patch; remove node rejects root and removes descendants, order references and links referencing them in the same transaction. Comments anchored to removed IDs stay visible as unplaced/orphaned, not deleted. Every operation checks current document revision under the same locks as related sidecars. Commit/stage first, then emit blueprint.changed and activity for a bound agent.

Attachments live in the prescribed per-resource record; unique canonical existing unit IDs at most 256, null revision means absent. Desktop writes them under revision checks; agent requests recheck current attachment each call. Detachment revokes that resource's authority and clears its activity, never deletes comments or history. A service start creates master only when needed by normal messaging, not an editor read.

Asset reads are authenticated and require a registered resource reference/catalog-created asset under docs/flows/assets. Revalidate parent links, allowed signature/extension and content hash; only PNG/JPEG/WebP, never HTML/SVG. New upload validates strict base64, decoded 10000000-byte cap and actual image signature before UUID naming. Optional conversion from step 7 occurs locally before extension/type is chosen. Asset+reference commit together and returns actual authenticated URL/bytes/hash. No arbitrary asset path or directory listing exists; imported asset is immutable and not reconverted.

Change `features/blueprint/review/sketch-format.mjs` `validateSketch`, known-field validators, newSketch/mutation helpers and serialization-facing returns. Raise resource limits to contract 7, accept all bounded unknown fields throughout full boards and retain them in objects through add/update/remove/geometry operations. Keep known required geometry/IDs/tree/reference validation. Remove rejection merely because fonts/components/threads/page objects are nonempty or optional drawing properties are unknown. No build/core import into portable Lite; use existing standalone conventions and keep its legacy API shape. Existing `test/blueprint-sketch.test.mjs` must remain valid; new full-field retention assertions go in service-editors.test.mjs using the portable formatter directly.

Change `test/blueprint-sketch.test.mjs` obsolete unknown-property/nonempty arrays rejection cases to exact deep retention assertions for document script data, screen build metadata, node states/runs and link label, without executing/rendering them. Replace outdated title/name 200 limits with 240, duration 2000 limit with 10000, and per-kids 2000 assumptions with board/global 10000 limits. Keep actual typed enum, link/tree/asset safety, SVG escaping and geometry checks. Add opaque null preservation and deep unknown survivors through each Lite mutation; do not weaken real schema tests to make the gate pass.

Remove extra old Lite-only restrictions where the contract specifies a bounded string or finite number: screen/node x/y are finite without the shared Map's plus/minus 100000 bound; vector d, font, text value and board note use typed string/global serialized-size limits rather than old private regex/length caps. Keep src restricted to registered project assets and known style/color/type fields strict. Change obsolete 1e6-coordinate and string-regex refusal tests into round-trip/escaped-rendering tests; remove executable interpolation through escaping rather than falsely rejecting valid persisted source. Existing standalone external-board links may remain unresolved as contract permits, while new full boards require internal links. Use contract limits for title/name/page counts, not old private numbers.

Add `test/service-editors.test.mjs` board/catalog/assets cases: full unknown-field fixture through open/drag/add/patch/remove/save, nested arrays/objects, full replacement field loss, cross-screen duplicate IDs, invalid root/link/order, read-only module, board-id/path collision, absent project, scoped attachment names, detach credential, asset traversal/signature/limit/conversion and concurrent different callers using one expected revision. Inspect raw persisted files and sidecars for retention. Wire these real HTTP handlers into http.mjs/service.mjs now, eliminating their step-16 unavailable entries.

Check: `node --test test/service-editors.test.mjs test/blueprint-sketch.test.mjs test/service-api.test.mjs`. Expected: Lite retains full unsupported data, stale concurrent edit returns 409, a removed node leaves its comments readable, and all board/asset routes work with temporary repositories. Commit: `Persist full Blueprint resources and retain unknown Lite fields`.

### Step 19. Journal Void edits, comment proposals and viewer-local Watch

Extend `engine/service/editors.mjs` text/comments sections with `validateText`, `createText`, `replaceText`, `replaceRange`, `listProposals`, `answerProposal`, `readComments`, `listComments`, `createComment`, `replyComment`, `setCommentStatus`, `observeExternal`, and `notifyAttached`. Keep the native Void file/sidecar/history conventions; reuse existing safe plain/anchor relocation helpers, not legacy lossy save/fallback functions. Validate stable unique k keys and bounded language-string pages while preserving unknown page/document fields. Server controls numeric rev/history; raw-byte SHA revision is the concurrency token. Create orig exclusively once, never replace it after edits.

`replaceText` diffs language strings by stable k/lang, increments rev exactly once per committed document change, appends complete before/after records with the new rev and preserves unrelated history bytes. `replaceRange` checks exact raw revision, k/lang, half-open UTF-16 offsets and expectedText against the serialized source string; reject offsets inside a surrogate pair or a literal b/i tag, including tag endpoints that split its spelling. Empty replacement supports deletion. Never silently fuzzy-merge a stale editing range. Normal apply transaction contains text, orig-if-missing and appended versions; no partial event/staging.

Strict comments reading treats absence as an empty native sidecar, but malformed existing JSON/schema is corrupt_resource and never overwritten. Retain every unknown thread/message/anchor property. Derive stable IDs for legacy messages from the exact stored original author/time/text/index tuple only if absent; projecting user as master does not change hashing/history. New comments/replies use credential author, immutable message UUID and current time; require nonblank text up to 10000 characters. A thread reply reopens resolved state. Creation validates both document and comments revision plus anchors; reply/status validates comments revision. Rendered Void anchors use plain UTF-16 after b/i removal, paragraph separators, quote/prefix/suffix and 48 context characters; use existing findAnchor relocation. Blueprint anchors validate current screen/node or board point; removals retain unplaced threads. Never strip unrendered anchors to force success.

Propose creates a pending proposal comment message with exact source range/expectedText/replacement/baseRevision and commentsRevision without editing text/history. Accept is desktop-only, requires current document and comments revisions plus the proposal's exact baseRevision/source slice, and journals text/history/proposal-state together. Stale returns proposal_stale without a partial accept; discard writes only the proposal terminal state under both revision checks. A second answer returns proposal_resolved. Agent can apply assigned edits or propose comment suggestions but cannot accept its own suggestion. Preserve Report-like unknown thread history when updating status/proposal metadata.

For every newly committed comment/proposal/reply queue deterministic notifications keyed by its stable message ID and attached recipient ID, include master for agent replies, exclude author and use one logical admission from step 4. Persist pending descriptors together with the sidecar operation; recover fanout from IDs on startup. Deliver a short resource/thread reference with a safe registered attachment, not an absolute native path. Native wake submission outcomes are visible per recipient. An immediate reply is desired but never claimed until real native action; no duplicate sends on retry/ambiguous status.

Watch registered resources using fs.watch and per-resource serialized reconciliation with last raw hashes; re-open on rename/error/missing filename. External complete valid text changes append versions entries with by outside once, preserving native numeric rev behavior and exact before/after values; malformed/partial reads produce issues and wait for a subsequent watcher event/restart rescan, never an empty overwrite. External board/comment changes produce resource/import events and update issues. Distinguish own committed hashes to suppress duplicate events/history; imported group already supplies its atomic history and is not logged as another external edit. No file watcher emits activity on behalf of an agent without a verified attached operation.

Create `engine/service/watch.mjs` `recordActivity`, `start`, `stop`, `resolveActivity`, `clearUnit`, `clearResource`, and `disposeViewer`. Memory-only activity is latest `(at,resourceId)` per bound unit, expiring at 15 minutes. Open/successful edit/reply emits editor.activity with the contract focus; failed/stale/unauthorized calls emit none. Watch validates attachment and optional chat membership; explicit resource wins. No current activity means waiting. Records are owned by viewer token, reconnect retains them within that token lifetime, logout/detach/session stop/restart removes or waits as contract specifies. Off never gates persistence/events; no agent tool or background event starts a person's Watch. Emit watch.changed only to its owner, never another viewer or phone.

Extend `test/service-editors.test.mjs`: bilingual Void, orig/history preservation, non-BMP/tag source boundaries, rendered-anchor relocation, external once-only history, corrupt sidecar, concurrent comment/text saves, propose/apply distinction, stale/second accept, crashes at every text/history/proposal file, notification retry/author exclusion, attached reauthorization, Watch off/owner isolation/latest tie/15-minute expiry/detach/session stop. Wire every text/comment/Watch handler into HTTP/service. Existing Void standalone tests remain read-only unchanged; the integrated service uses full contract limits.

Check: `node --test test/service-editors.test.mjs test/void.test.mjs test/service-messaging.test.mjs test/service-api.test.mjs`. Expected: source revisions prevent lost edits, proposals atomically accept once, malformed sidecars survive, deterministic wakes deduplicate and Watch changes only its owner display state. Commit: `Journal live Void comments proposals and isolated Watch activity`.

### Step 20. Forward HTTP MCP, stdio, hooks and CLI through the same service

Create `engine/service/mcp.mjs` `toolSchemas`, `dispatch`, `validateRpc`, and `callTool`. Implement contract 5's protocol exactly: POST Content-Type is application/json, and its Accept header contains both application/json and text/event-stream; calls return JSON, notifications return 202, GET returns 405 Allow POST, and no MCP session ID is issued. initialize accepts only 2025-03-26 and advertises tools/listChanged false and serverInfo version 3.0.0. JSON-RPC parse/request/method/schema failures use -32700/-32600/-32601/-32602; domain errors are isError true text containing common error envelope. Success contains text JSON with contract/data, not a different editor shape. Authenticate and exact network checks before RPC execution.

Publish all eight editor tools and their exact required/optional arguments from the contract: blueprint_open, blueprint_add_node, blueprint_update_node, blueprint_remove_node, blueprint_reply_comment, void_open, void_replace_range, void_reply_comment. additionalProperties false applies to tool arguments; bounded unknown JSON applies inside board/node/change payloads only. Each mutation's UUID requestId is the operation's Idempotency-Key. Open has no document write but records authorized activity. Every call rechecks native session, attachment and bound author. Agent arguments cannot change actor, unit, author or filesystem path. Successful edits emit their resource event regardless of Watch; activity follows the durable resource/history/comment commit.

Create `engine/service/client.mjs` with `connectService`, `request`, `subscribe`, `bindNative`, `legacyOperation`, and `close`. Attach/start through the global lock, read the protected bootstrap, validate origin/mind/machine/start descriptor, then request an isolated local viewer or verified native binding. Use exact Origin/Authorization on all forwarded calls and IPC for existing operations not in the public HTTP contract. Preserve request UUID/body through transport retries, respect retryAt/expiry, and expose safe domain errors. Native endpoint handoff uses bridge only and never writes a token to disk. A CLI transport disconnect does not recreate an unproved binding or renew wake consent.

Change `engine/relay/mcp.mjs` `serveRelayMcp` and existing tool dispatch to use the service client/bridge, preserving all eleven legacy RELAY_TOOLS names/schemas and structured legacy result compatibility. Add the eight contract editor tools to its list and forward their operations. Legacy register needs an explicit unit and genuine native attachment; a correlation session ID alone is not native proof. Old mutation schemas without requestId receive one generated UUID per incoming call, kept unchanged for its internal forwarding retries; a new caller retry without a stable request key is a new call, never pretend exactly-once across unrelated stdio invocations. Preserve bounded line streaming, proper split UTF-8 decoding and serving after malformed input; allow bounded board payloads to contract size without truncating. Keep stdio's existing supported versions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05; reject a genuinely unsupported requested version. Its internal HTTP connection separately negotiates the pinned 2025-03-26 endpoint. No stdio process owns a wake worker.

Change `engine/relay/hooks.mjs` `runRelayHook`, lifecycle handlers and supported permission handler to attach to the service and forward native identity/activity/end events through bridge/client. SessionStart reattaches ephemeral native transport only after its adapter handshake; busy/idle hooks update the shared controller. Remove normal worker spawning. Unsupported permission hooks retain native prompting. Supported synchronous gating persists approval, waits for the owner result up to 120 seconds through SSE with a single bounded status request on connection loss, then returns verified allow/deny or native ask/fallback. Error, timeout, missing exact action shape, expired binding or adapter delivery failure never returns allow. Do not configure unsupported before-submit/tool events merely because another adapter has them.

Change `engine/relay/config.mjs` native hook builders/merge ownership: supported PreToolUse is synchronous, not async true, with native timeout long enough for the 120-second deadline plus bounded transport overhead. Emit exact verified native decision output in hooks, and keep lifecycle timeout/quoting semantics. Existing foreign config/comments/permissions survive; only this kit's owned commands/MCP entries are updated. Unconfigure removes only matching owned entries. Native backends without an installed synchronous hook use their verified server-side request_permission/app-server bridge or keep native prompts; no invented hook/event names. Never persist bearer/native endpoints in client config.

Change `engine/relay/person.mjs` production createPersonRelay transport to lazy service client, replacing step 2's direct writer while preserving existing result shape/project selection and no-write-on-open. Change `cli/index.mjs` parseArgs/help/runCli/runRelay/runRelayWake: add `service run|install|uninstall|status` and contract `task status <project> <id> <status> [--note text]` / `task undo <project> <id>`. Service run accepts configured mind/local paths, service install uses step 22, status reads safe descriptor/service state, uninstall removes owned registration. Task commands fetch current revision then call the same task operation as API; verified native callers use their agent binding, otherwise same-user invocation obtains a short-lived master viewer and logs it out. JSON stdout is data value; exits 0/2/3/1 and safe code/message stderr match the contract. Reject unknown flags, duplicate fields and arbitrary executable/cwd overrides.

Ordinary Relay commands use client/bridge operations so message admission, receipts, archives, sync and event behavior is identical to HTTP. Wake attach/enable/disable/status operates on shared service policies; report service readiness and actual delivery status, never a per-session spawned worker. Legacy internal wake watch may remain only as the old worker's cooperative adoption/exit path and direct controller test entry, not a newly spawned normal path. Disable/end revokes only that binding, not the service or another native session. Keep existing unsupported start clients excluded without removing their wake adapters.

Change `test/relay-config.test.mjs` PreToolUse expectation from async true to synchronous supported hook and its bounded timeout. Change `test/relay-hooks.test.mjs` worker-spawn/readiness cases to injected shared service attachment with zero worker spawns, exact transport-proof refusal and native timeout/error fallback; keep unread contextual reminders and activity/index behavior checks at the appropriate shared controller layer. Change `test/relay-cli.test.mjs` attach cases to actual fixture service readiness/owned connection and no worker creation, keep explicit selected-target refusal/parser/error coverage, and replace test named-pipe strings standing in for installed support with injected failure/protocol unit cases. Its real CLI case starts/closes only a fixture service owned by that test. Change `test/relay-mcp.test.mjs` unsupported initialize case to protocol error and add supported initialization, inject verified fixture binding/isolated service rather than declaring native support from a test client enum, and retain old tool schemas/result/UTF-8/invalid-input cases. Person regression tests now use the real fixture service facade. These changes must preserve historical-read coverage rather than replacing all user inputs with master.

Add `test/service-mcp.test.mjs` using real POST/stdio requests: all schemas/tools, identity forgery, detached resource, protocol/content headers, notifications, error codes, duplicate request UUID, mutation history/event order, proposal authority, stream races and hook timeout/failure. Wire the real MCP and client/bridge operation maps into service/http; no unavailable placeholder remains for implemented operations.

Check: `node --test test/service-mcp.test.mjs test/relay-mcp.test.mjs test/relay-hooks.test.mjs test/relay-config.test.mjs test/relay-cli.test.mjs test/relay-person.test.mjs test/service-tasks.test.mjs`. Expected: old tool schemas remain usable through isolated service forwarding, all eight editors work, one shared wake owner, and no timeout/error approves an action. Commit: `Forward MCP hooks and CLI operations through the shared service`.

### Step 21. Export isolated browser host handles without a desktop process

Create `gui/index.mjs` named `startGui` exactly as contract 6.3. Validate required resolved configured mindPath and supported embed/presentation arguments before starting anything; embedded true requires one exact http/https hostOrigin. Use service/client.mjs to attach/start once, authenticate local with protected bootstrap, and return the specified origin/url/token/viewerId/embedded/capabilities and handle methods. URL is the exact viewer fragment URL, never a query token. This Node host entry does not import browser gui/app code, create a browser window or start a desktop runtime.

Subscribe to viewer-specific SSE for dirty and overrides, initialized dirty false before mount. `setTheme` and `setLanguage` PATCH only that viewer's transient presentation and resolve Promise<void>; shared defaults remain settings operations. `isDirty` reads last observed own-viewer state. `stop` is idempotent, aborts reconnect/streams, logs out that viewer and releases only its handle; service stays running for other viewers/native sessions. Startup/auth/subscription failure cleans its own issued viewer/streams. Two simultaneous hosts get independent credentials/embed origins/dirty state and the same underlying service.

Change `package.json` version to 3.0.0, main to gui/index.mjs and exports to `{ ".":"./gui/index.mjs", "./gui":"./gui/index.mjs" }`, retaining any actual preexisting explicit entries. The current manifest has no exports map. CLI bin and dependencies remain unchanged. Root `start` becomes `node cli/index.mjs service run` with explicit configured mind argument requirements; no default desktop GUI launch. Keep existing desktop dev/files/dependencies unused for compatibility rather than removing them in this task. Change only package-lock.json top-level version and packages[""].version to 3.0.0; dependency versions/integrities/graph stay byte-equivalent. Do not run npm install or silently ship 2.x metadata with a 3.0 service. The future release/history rewrite remains coordinator work.

Extend `test/service-lifecycle.test.mjs` and `test/service-api.test.mjs` with two real host handles, external current service attachment, missing/unconfigured mind, different active mind, invalid hostOrigin, own-only dirty/events, presentation isolation, repeated stop and no service termination. Check both package-root and ./gui exports from package resolution and bound-viewer shell CSP using temporary injected assets; GUI browser integration is deferred only to the merged QA gate.

Check: `node --test test/service-lifecycle.test.mjs test/service-api.test.mjs`. Expected: one service, two isolated handles, valid ./gui resolution, missing mind writes nothing, and stop revokes one viewer while the other continues. Commit: `Export isolated web viewer handles from the GUI entry`.

### Step 22. Configure Cosmic setup and ownership-safe login registration

Create `engine/service/install.mjs` with `planRegistration`, `installService`, `uninstallService`, `verifyOwnedRegistration`, `bootstrapConfig`, and `registrationRunner`. Separate pure plan generation from execution; tests always inject a recording dry runner. Resolve Node, stable installed kit CLI, mind, machine, Cosmic/local staging and origin before generating an action. Store a local ownership record containing installation ID, executable/arguments, registration name/path and content digest. Never place credentials or synced native configuration in a registration. A missing/mismatched/unowned registration is a conflict, not something to overwrite with force.

Windows generates a UTF-16LE task XML under the protected local directory with a unique per-user service name. Escape XML text and quote each Windows argument with the correct backslash-before-quote/trailing-backslash rule, rejecting NUL/newlines. Use the current SID, InteractiveToken logon, LeastPrivilege, current-user logon trigger, StartWhenAvailable, IgnoreNew instances, no execution time limit, and exact bundled/system Node Command plus CLI service run arguments and working directory. Plan `schtasks.exe /Create /XML <file> /TN <owned-name>` only after an absent/verified owned query; replacing owned content uses an explicit owned update. No admin account, password, SYSTEM principal or highest privilege. Uninstall queries and compares executable/args/XML digest before `/Delete /TN <owned-name> /F`. The [primary scheduler XML reference](https://learn.microsoft.com/en-us/windows/win32/taskschd/logon-trigger-example--xml-) and [logon-type definitions](https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-logontype) establish the OS format; tests only record these commands.

macOS writes the owned plist below the injected/current user's Library/LaunchAgents, with stable label, ProgramArguments array, WorkingDirectory, RunAtLoad and bounded restart policy. XML-escape text; no shell command or system LaunchDaemon. Plan current-user launchctl bootstrap/bootout commands with the actual UID and verify existing label/file ownership first. Linux writes an owned user unit below absolute XDG_CONFIG_HOME or home/.config/systemd/user: Type=simple, exact escaped ExecStart argument tokens, WorkingDirectory, Restart=on-failure, RestartSec=5, WantedBy=default.target; plan `systemctl --user daemon-reload`, enable/start and owned disable/stop. Escape percent specifiers and quotes correctly, reject line injection, and report unavailable user manager rather than switching to root or linger. Use the [primary per-user launch reference](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) and [primary service unit source](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml). No test runs these registration commands.

`bootstrapConfig` validates exact contract 2.1 config and local staging exclusions, persists it with private permissions before service start, and rejects unsupported Quantum/encryption. Default mind comes from localCosmic/hivem1nd; a custom Cosmic parent appends hivem1nd. New setup's default local folder origin is a separate `localCosmic/hivem1nd-origin/<mindKey>` folder, outside mind/staging. An explicitly chosen OneDrive origin/mind is allowed but staging stays under local Cosmic. Existing installed mind location remains unchanged on attach/evolve; require explicit origin choice/config when none exists. Migration/adoption never silently resets the chosen origin or wake consent.

Change `engine/setup.mjs` createSetupSession/constructor/getStep/answer/buildPlan/install/completionResult/computeMindPresets. Add Cosmic as the first/default location preset using service paths with injected home/env/platform; retain explicit custom/legacy/OneDrive choices and resumable draft answers. Add originKind folder/onedrive and originPath text fields to the existing generic step 2. Labels/help live in this module's bounded en/es copy for these new fields; do not write unowned texts.mjs. Persist answers in existing local draft/machine paths with no secret. Validate mind/origin/staging safe paths on answer and again before installation, retaining existing conflict preview and all-or-nothing base-file preflight.

Accept an explicit `serviceSetup` flow option and injected service installer/runner. Preserve the low-level library's default false for existing independent planning/install callers; ordinary CLI init/evolve and the Windows installer explicitly set true, so user-facing setup always configures/installs/starts the service. A dry-run runner returns truthful planned status and never pretends OS installation completed. After successful base install, migrate/adopt, bootstrap local config, install owned registration, attach/start and obtain the viewer URL. Record any partial failure and offer retry of the failed phase without repeating copied files/registrations. Completed flow opens the service GUI and does not stop it when the wizard closes. Use the stable payload/global kit CLI with its resolved production dependencies for registration and hook/MCP forwarding; do not point Node at a mind copy lacking node_modules. Existing mind copies of kit data remain managed normally.

Change `gui/server.mjs` createWizardServer's completed install path to call an injected openCompletedViewer function with the service viewer URL once. Keep old static gui/index.html/app.js/styles.css, existing wizard token/network checks and step envelopes. CLI initialization supplies that opener; server tests can record it. Browser state waits for install completion as before. A missing independently built GUI shell yields clear pending viewer availability without changing API/config/registration outcome. Change `engine/lifecycle.mjs` evolve completion to run the same explicit serviceSetup phases after safe migration/copy/client configuration and before reporting fully completed; expose safe phase failure/retry without claiming success. Leave a 2.x existing mind where it is. Change `engine/uninstall.mjs` uninstall to plan/remove only the matching owned registration before deleting its ownership record, retain modified/unowned registration and report it, close only an authenticated owned service connection, and preserve existing private-data/unmanaged-file safeguards. Dry-run only describes actions.

Change `cli/index.mjs` setupOptions/runInit/evolve and service command execution to thread serviceSetup true plus optional injected dry runner/installer dependencies. Expose service install --dry-run as a plan-only command and configured --origin-kind/--origin-path/--cosmic-path inputs for explicit configuration; no command discovers or writes an unrelated mind. Existing library tests that do not request serviceSetup remain OS-inert. Change `test/setup.test.mjs` default/preset expectations to Cosmic, inject all OS locations below its root, and preserve explicit legacy preset/installed-mind resume tests. Its serviceSetup cases inject recording runner and viewer opener, then verify config exists before actual fixture service startup. Add `test/service-install.test.mjs` for all three OS registration plans, spaces/quotes/percent/non-ASCII paths, current SID/user privilege, identical reinstall, foreign/modified registration, dry-run zero OS calls, config safety, migration twice and failed phase recovery. Existing relay/setup/lifecycle/uninstall checks retain their explicit library behavior without OS registration.

Create `engine/service/README.md` operator sections for configured run/install --dry-run/status/uninstall, Cosmic/origin separation, per-user singleton/mind conflict, native capability errors/reattachment, terminal ambiguity, home expiry, offline limits/conflict copies and the authorized integrated QA procedure. Describe only implemented behavior and safe relative error information. Do not alter root/feature docs outside ownership.

Check: `node --test test/service-install.test.mjs test/setup.test.mjs test/relay-setup.test.mjs test/lifecycle.test.mjs test/uninstall.test.mjs test/interfaces-server.test.mjs`. Expected: all registration runners are recorded dry runs, config precedes startup, existing mind paths/history survive and reinstall/uninstall touches only verified ownership. Commit: `Configure Cosmic setup and ownership-safe login service plans`.

### Step 23. Build a reproducible offline Windows installer payload

Create `scripts/build-installer.mjs` with `readInputs`, `verifyRuntime`, `readArchive`, `collectPayload`, `productionPackages`, `crc32`, `writeZip`, `installPayload`, `dryRun`, and CLI entry. Export pure build/install functions for tests without running on import. The artifact is `hivem1nd-3.0.0-win-x64.zip` containing install.cmd, the bundled Node runtime/license, complete kit payload, locked production node_modules, a manifest and generated Node installer entry. It is a guided installer ZIP, not the old desktop-runtime archive. Generated payload files are build artifacts under validated temporary stage/dist, not new repository-owned source files.

Require explicit `--node-zip <absolute-file>` pointing to the pinned official `node-v22.23.3-win-x64.zip`. Its exact SHA-256 is `2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71`; extracted win-x64 Node executable SHA-256 is `9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e`. Verify both before copying/launching and verify its actual --version. Use the [version-specific official checksums](https://nodejs.org/download/release/v22.23.3/SHASUMS256.txt), never a mutable latest URL. Build performs no runtime download; a missing input fails with clear input instructions. Include the official runtime license. Changing the pin requires an explicit reviewed update of version, filename and both hashes.

Read ZIP central directory with strict signatures, count/length/offset bounds, stored/deflated methods only, no encryption, CRC and expanded-size caps. Extract only validated expected node.exe/license members into a temporary stage. Reject absolute/traversal/backslash ambiguity, links, duplicate normalized names, unsupported ZIP64 and archive bombs. Use Node inflateRaw maxOutputLength before allocation. Never execute an unverified supplied runtime. Kit input comes from the verified npm package or the same package-file allowlist as build.mjs, excluding private mind/test/git/dist/credentials. Copy no arbitrary current worktree secret.

Bundle all current locked production dependencies and their transitive graph, because bundled Node alone has neither npm nor the runtime libraries. Traverse package-lock packages from root dependencies by Node resolution location, retaining only reachable production/optional packages required by the current platform; verify installed package name/version against lock before copying. Reject absent/mismatched dependencies rather than downloading them. Preserve legal license/package metadata and nested dependency resolution, reject links/outside-root files, exclude dev-only packages and executable install scripts from execution. Do not run npm install, npm ci, postinstall or a package lifecycle script. Runtime smoke imports engine discovery/setup/config and @clack/prompts/jsonc-parser/smol-toml using the staged bundled Node with PATH containing no system Node/npm and network disabled by test context. The payload must work without a runtime package manager.

The installer entry, generated from a literal audited source template inside build-installer.mjs, validates its manifest/file hashes, chooses the current user's local Cosmic stable kit directory and copies to a versioned sibling stage before atomic activation. It does not recursively erase an existing install. Reject links/junctions and a mismatched active mind/service; preserve prior payload on failure. Keep mind data/config outside the kit activation. install.cmd uses its own quoted directory and runtime/node.exe to run that entry; no system Node requirement, shell-evaluated path, network or privilege elevation. Pass no secrets in command arguments. The entry opens the existing setup wizard through CLI init --gui with bundled Node/stable kit, waits for user-selected mind/origin and completed base installation, then step 22 config/login/service/viewer flow. An existing setup can resume. Installing a payload does not start an unconfigured service before the wizard writes config.

`--dry-run --output <temporary-dir>` performs real safe extraction/staging/import verification and generates the registration plan through an injected recorder, but never registers a task or writes a real home/mind. Tests drive the real staged wizard HTTP answers within fixture paths, exercise migration and start a test-owned service, then close all owned handles. The real installer also accepts explicit --dry-run to show planned paths/actions without activation/OS registration. Do not treat dry-run as a successful real install.

Implement deterministic ZIP output with Node only: sort normalized UTF-8 relative names by byte order; fixed DOS timestamp 1980-01-01 00:00:00; method 0 stored data; UTF-8 flag; zero extra/comment fields; regular-file Unix mode in external attributes; local header signature 0x04034b50, central 0x02014b50 and end 0x06054b50. Compute CRC32 from initial 0xffffffff using reflected polynomial 0xedb88320, eight shifts/XORs per byte, final xor 0xffffffff. Local records include version-needed 20, CRC, compressed/raw length and name length; central records include those values and exact local offset; end records count, central size/offset. Reject any count over 65535 or offset/size over uint32, never silently wrap/require ZIP64. Manifest hashes every payload file with deterministic version/runtime/lock inputs; omit clock, username, absolute build paths and random stage names. The ZIP's digest is reproducible for the same exact inputs.

Change `scripts/zip-win.mjs` to delegate this builder with explicit runtime input and remove the old desktop copy/tar path. Before recursive cleanup, resolve the stage/output target, verify it is a strict descendant of the intended temporary/workspace dist root, and reject links/root/outside targets. Use one native filesystem implementation; no enumerated paths handed to another shell for deletion. Clean only the builder-created stage, never an existing user install/archive directory.

Change `scripts/build.mjs` syntax/package validation to require gui/index.mjs and every core service/sync module, preserve every existing wake adapter and wizard asset requirement, and remove gui/electron.mjs as a required service entry. Retain current private-file exclusion checks. Core build with no gui/app directory passes and reports browser assets unavailable for standalone packaging; if that directory is present, verify every static allowlist file is packaged. Integrated installer release packaging requires all browser assets and cannot ship an empty shell. No fabricated GUI files or core import of GUI tests. Add package scripts `installer:win` and `dist:win` pointing at this builder; pack:win may remain as an explicitly unused legacy desktop command, with no electron-builder.yml changes.

The installer CLI has concrete modes: without --dry-run it always requires every browser allowlist asset and fails before producing a distributable ZIP if any is absent. With --dry-run it permits a missing browser tree, records browserAssets unavailable and makes only a clearly labeled dry-run artifact, never an install-ready release. Pure builder tests call the exported build function with a temporary assetDir containing their own minimal valid static fixture files, so reproducibility is tested without creating/editing gui/app. Reject fixture assetDir overrides for a normal release CLI invocation. Normal npm build remains the conditional standalone package gate described above; installer release is the strict gate.

Replace package.json test wildcard with a portable Node invocation that enumerates `test/` regular `.test.mjs` filenames, sorts them and spawns process.execPath with `['--test', ...exactPaths]`, forwarding stdio and exit status. Add test:core using the same enumeration excluding names starting gui-. Tests require no shell glob expansion on Node 22/Windows. Keep npm.cmd build as the existing verified package command.

Set these exact package.json scripts, preserving unrelated scripts:

```json
{
  "test": "node -e \"const fs=require('node:fs'),cp=require('node:child_process');const files=fs.readdirSync('test',{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name.endsWith('.test.mjs')).map(entry=>'test/'+entry.name).sort();const result=cp.spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});if(result.error)throw result.error;process.exit(result.status??1)\"",
  "test:core": "node -e \"const fs=require('node:fs'),cp=require('node:child_process');const files=fs.readdirSync('test',{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name.endsWith('.test.mjs')&&!entry.name.startsWith('gui-')).map(entry=>'test/'+entry.name).sort();const result=cp.spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});if(result.error)throw result.error;process.exit(result.status??1)\"",
  "installer:win": "node scripts/build-installer.mjs",
  "dist:win": "node scripts/build-installer.mjs"
}
```

Extend `test/service-install.test.mjs`: two builds with identical inputs yield byte-identical ZIP/digest; parse headers/CRC independently; malicious traversal/CRC/offset/compression/runtime digest fails before activation; dependencies resolve offline; generated script/registration quoting; dry-run activation/config/OS-call separation; stage cleanup boundaries; integrated asset omission fails release package. On non-Windows, still verify ZIP/digests/registration source but report executable smoke unavailable; do not claim a foreign binary ran. Build tests use an externally supplied verified cached runtime and skip only that real-binary portion if the input is absent, recording the limitation explicitly. All ZIP/container algorithm and dry-run ownership checks remain mandatory.

Check: `node --test test/service-install.test.mjs`, then `npm.cmd run build`. Expected: independent ZIP verification/reproducibility and dry-run cases pass, staged runtime imports succeed when the pinned input is supplied, no OS registration/network/dependency install occurs, and the package excludes private files. Commit: `Build a reproducible offline Windows service installer`.

### Step 24. Verify the standalone core and hand off integrated QA

Add `test/service-integration.test.mjs` using only core-fixture and real service/client/HTTP/SSE/stdio: two temporary machines sharing one folder origin; master/agent native proof supplied by test-owned protocol fixtures for authorization tests; a genuine optional backend smoke remains separately labeled. Run message/chat/comment fanout, task delivery/lead review/accept/undo, approval answer/grant/revoke, board/text/range/proposal commits, Watch, host handle logout, sync conflict/deletion/dependency delay, paused limits, crash/restart recovery, service ownership and home expiry end to end. Assert raw bytes/history/versions/receipts/terminal owner results and emitted contract data together. No test imports gui-fixture or assumes GUI implementation files are available.

Complete service-api.test.mjs inventory so every contract route has its concrete handler/success fixture and at least one boundary/authority failure. Remove all step-16 handler placeholders for completed domains. Only genuine native/asset absence may report unavailable. Verify phone allowlist and agent own/attached scope across real transport; receipts preserve IDs/response after crash; imported transaction event follows every related file; stale external editor/task edit produces conflict without data loss. Snapshot cursor race and SSE reconnect/visibility are mandatory. Audit tests changed in earlier steps so no old master/Lite/hook expectation is left failing or removed without equivalent meaningful coverage.

Run `npm.cmd run test:core`, `npm.cmd run lint`, and `npm.cmd run build` once. Expected: all standalone core/current regression tests pass, markdown has zero issues, verified package reports 3.0.0 and private exclusions, and no GUI-owned module is required for the core gate. If the pinned Windows runtime input is available, run its builder through `node scripts/build-installer.mjs --node-zip <verified-cache-file> --dry-run --output <fixture-root>/artifact` inside service-install.test.mjs's programmatic process invocation and verify offline smoke. No literal placeholder command is counted as passed. Record exact input/version, genuine adapter availability and any skipped external prerequisite; do not declare those unavailable smoke checks passed.

Compare git diff names to the exact ownership table and ensure no GUI-owned/private files were changed. Record step results, test outputs, genuine capability limitations and artifact hashes in engine/service/README.md's build verification section; do not create an unlisted report file. Commit the final test/verification changes only after all mandatory checks pass. Do not push, merge or release.

The coordinator's later merged QA runs the real browser against this real service, not the GUI fixture: both looks/languages and approved desktop/phone/editor screens; static allowlist/CSP/embedding; QR scans decode the exact live private URL; phone approve/accept/send-back and forbidden writes; live native edits/comments/Watch with genuine available clients; two services in separate temporary machine contexts sharing the temporary origin; offline backlog/conflicts; the bundled installer staged offline and driven through the wizard with OS registration still injected. Use only temporary paths/test-owned children on both machines. A real system registration, public history rewrite and release require the owner's separate workflow and are not builder checks. The core builder hands off its branch/artifact evidence; it does not edit GUI files to fix an integration mismatch.

Check: `npm.cmd run test:core`, `npm.cmd run lint`, and `npm.cmd run build`. Expected: complete passing standalone evidence, exact ownership, no real registration/mind writes/unowned process termination, and an explicit integrated QA handoff. Commit: `Verify the standalone core and document integrated QA handoff`.
