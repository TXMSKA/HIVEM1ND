# Shared sync API v1

```js
import { SYNC_API_VERSION, createSyncCoordinator } from 'onem1nd/sync';

const sync = await createSyncCoordinator({ store, domain, codec, origin, limits, clock, events });
await sync.resume();
// After the application's atomic domain commit and outbox insertion:
await sync.changed(changeIds);
await sync.flush();
const state = await sync.status();
await sync.close();
```

`SYNC_API_VERSION` is `1`, independent of the package version. These are the
only named exports. Importing the entry starts no service, GUI, HTTP listener,
native adapter, sign-in, heartbeat, timer, or origin watch. Creating a coordinator
claims its local store; `resume()` starts the origin watch and restores work.
The returned object has exactly `changed`, `flush`, `resume`, `close`, `status`.
All five methods return Promises. Await `resume()` before reporting sync ready.

## Consumer adapters

`store` supplies `machine`, `namespace`, absolute `localDirectory`, and `outbox`.
Machine names use the existing path-safe H1 machine identity rules. Namespace is
a nonempty string of at most 256 characters with no NUL or line breaks. Use the
same namespace and codec policy for peers. The origin adapter must isolate that
namespace and each writer; do not reuse one writer identity on two local stores.
The machine-local directory must be outside every synced root and outside the
consumer's live database. The engine writes only under
`localDirectory/sync-v1/<sha256(namespace)>/<machine>/` and rejects another live
owner of that directory. A dead process's ownership can be recovered on restart.
Ownership uses an exclusive, unreferenced TCP listener on `127.0.0.1` with an
ephemeral port and a random per-instance token, plus atomic contender tickets.
This private lifetime guard starts only when creating a coordinator; it is not
HTTP and has no heartbeat. Endpoint reuse with another token proves staleness;
ambiguous probes fail closed. A claim without the current endpoint shape is
stale. PID-only records came from an unshipped provisional build and require no
compatibility path. Ownership never inspects process birth or starts child
processes; no dependency is added. PID and port reuse cannot inherit ownership.

`await outbox.listCommitted()` returns an array of complete groups:

```js
{
  transactionId: '00000000-0000-4000-8000-000000000001',
  at: '2026-10-28T12:00:00.000Z',
  entries: [{
    id: '00000000-0000-4000-8000-000000000002',
    target: { table: 'documents', identity: 'consumer-owned-id' },
    operation: 'put',
    bytes: Buffer.from('approved record'),
    baseHash: null,
    messageId: null,
  }],
}
```

Transaction/change IDs are stable lowercase UUIDs, `at` is the original UTC ISO
timestamp with milliseconds, operation is `put` or `delete`, and `baseHash` is
null or a SHA-256 hexadecimal digest. A deletion has null or omitted bytes.
Targets are bounded JSON values, never interpreted as H1 file paths. A target's
canonical JSON representation is limited to 8192 bytes. `messageId` is null or a
stable logical-message ID, shared by changes belonging to that logical message.
The consumer commits its domain mutation and complete outbox group atomically.

`await outbox.ackStaged(transactionId, changeIds)` must be idempotent. The engine
calls it with the whole group only after compressed objects and an atomic group
manifest are durable. A retry recognizes the original committed group even if
serialization would now produce different bytes. IDs cannot be reused for a
different group or content. Published manifests remain for replay detection.

`domain` supplies async `validate(entry)`, `serialize(entry)`, and
`applyAtomic(group, context)`. Validation returns false or throws an error with
`retryable: false` to reject ineligible input. The original and serialized entry
are validated before staging. Serialization returns
`{target, bytes, baseHash, messageId}`; IDs, operation and time remain those of
the committed outbox. Omitted baseHash/messageId become null. Validation also
runs on incoming entries. H1's record rules stay in its existing Relay adapter.

`applyAtomic` receives the public group shape and context
`{machine, sequence, digest, imported: true}`. Return `'applied'`, `'replayed'`,
`'pending'`, or `{status: <one of those values>}`. The consumer owns the atomic,
idempotent transaction, durable import IDs, conflict retention and prevention of
import echo. Projections happen after its commit. A prepared import journal can
replay the callback after interruption; returning pending never advances the
pack checkpoint. Permanent callback errors quarantine that journal.

`codec` supplies `{format, version, encryption, encode, decode}`. Format and
encryption are explicit identifiers; version is a positive integer.
`await encode(pack)` transforms bytes of the maintained compressed H1 pack into
encoded bytes; `await decode(bytes)` returns those original pack bytes. Both
return Uint8Array/Buffer. The shared envelope binds namespace, codec policy,
writer, sequence, length and digest, then verifies maintained pack framing,
compression, hashes, dependencies and bounds. Encryption and local key access
belong to the codec. An encrypted consumer must enforce authenticated encryption
in these callbacks and reject plaintext. No keys belong in entries or errors.
Relay retains its existing none-encryption folder behavior.

## Origin boundary

The required async callbacks are:

```js
publishPack({ machine, sequence, digest, bytes }, { signal })
readHead(machine, { signal })
readPack(machine, sequence, { signal })
listMachines({ signal })
reconcile({ signal })
close()
```

`watch(onChange, onError)` is synchronous and returns an unsubscribe function.
Notifications and watch errors trigger the same serialized reconcile path as
`resume()`. `reconcile` refreshes provider visibility and does not apply records.
`listMachines` returns machine names. Invalid individual names are skipped and
reported with `machine: null`; valid entries still publish and reconcile. A
malformed whole list or one exceeding 10000 entries is rejected. All normal publication, dependency reads,
incoming application and recovery use these callbacks, with no filesystem
origin fallback. Outgoing packet bytes are journaled locally before publication;
recovery resends the identical digest and sequence with an idempotent ledger
charge. The adapter must honor AbortSignal, immutable packet creation and
monotonic head replacement, including cancellation during a write.

Publish returns `{machine, sequence, digest, ackScope}` matching the packet.
The accepted scopes are `'filesystem'` and `'provider-confirmed'`. Filesystem
placement does not imply provider propagation. Provider confirmation requires
independent evidence supplied by that adapter; the engine never invents it.

`readPack` returns encoded Uint8Array/Buffer or null. `readHead` returns null or
the maintained head shape:

```js
{
  format: 'hivem1nd-head-v1', machine: 'WRITER', sequence: 1,
  updatedAt: '2026-10-28T12:00:00.000Z',
  packs: [{ sequence: 1, file: '000000000001.pack', hash: digest, bytes: length }],
}
```

Heads retain immutable history. Missing heads, packs, sequence members or
dependencies stay pending without checkpoint advancement. Invalid framing,
hashes, ownership, namespaces, codec policy or domain schema quarantine that
input by fingerprint. Every explicit `resume()` revalidates quarantined incoming
heads and packs against the consumer's current codec and domain, including
quarantined apply journals after full packet verification. Codec metadata is read
from the supplied codec object at each use, so an in-process policy update can
be retried. This does not skip an immutable bad sequence: it remains blocked
until validation succeeds, then later sequences can apply. Watch notifications
continue to skip known quarantines. Successful revalidation clears incoming and
dependency quarantine markers; unchanged framing errors do not repeat events. Quarantine
markers contain safe error metadata, without record bodies, targets or keys.

## Scheduling, limits and lifecycle

`changed(ids)` is only a post-commit notification. It drains all committed
groups, so a lost or partial ID notification cannot split a group. `resume()`
recovers incoming/outgoing journals, drains outbox and staging, restores the
existing pulse timers, and reconciles heads. `flush()` returns one shared
in-flight Promise, drains the outbox, and requests one publication from the same
pulse. Deferred groups remain durable and scheduled. It does not promise that
every queued group fits in one pack or propagates to peers immediately.
Flush reports the remaining staged group count in `pending`, and includes any
publication completed through journal recovery in its publication result.

The existing pulse keeps 2 quiet/10 maximum seconds, 4/30 at 80% of a limit,
and one in-flight publication. `limits` defaults to
`{messages: 60, messageBytes: 1000000, syncBytes: 50000000,
operationTimeoutMs: 10000, retryDelayMs: 2000}`. The three quota values are the
fixed approved v1 thresholds. Deadlines/retry delay
are integer milliseconds from 1 through 120000. Publication and receipt use the
shared durable ledger, separate from Relay's admission counters. Logical counts
use messageId; bytes of a logical message are summed across its entries within
each transaction for the 1 MB bound.
Groups are capped at 10000 entries, 60 logical messages and 64 MB of unique raw
objects; each object is at most 16 MB and each encoded pack at most 50 MB.
Oversized groups are rejected together. Publication/receipt accounting remains
durable and idempotent. Hard-limit retries use the existing ledger's retryAt.

`clock` supplies `now`, `setTimeout`, `clearTimeout`, defaulting to Node's clock.
Every origin call has a bounded deadline and AbortSignal. Codec/domain/outbox
callbacks also have bounded waits; those adapters must complete their own
atomic/idempotent work safely if cancellation occurs. A timeout does not discard
durable work. Publication failures retain Relay's default 2-second retry hold.
Incoming pending work retries on watch/reconnect notifications or `resume()`;
there is no additional polling or batching loop.

`events` is optional, either a function or an object with `push(event)`.
It receives notifications, never durable work. Errors have only
`{code, retryable, operation, machine, sequence}`, with a fixed safe Error message
when rejected. Callback error messages, details, record bytes, keys and targets
are not forwarded. Explicit retryability is retained; known schema/hash codes
are permanent, I/O/offline/deadline failures are retryable. Unknown codes become
`sync_failed`. Callback failures can reject changed/resume/flush; a transport
failure during pulse publication resolves as a deferred publication result.
Missing or invalid local keys, locked key access and transport authentication
failures are retryable by default. `authentication_failed` from the actual
decode callback means failed authenticated decryption and is permanent by
default. An explicit boolean `retryable` always wins. Callback-supplied
`operation` cannot change the actual call boundary or its classification.
Retryable errors retain the staged group, immutable prepared packet and retry
timer without setting `publicationBlocked`. Only the packet being prepared or
published can quarantine outgoing IDs; committed packets cannot inherit later
unrelated failures. Timer-driven work catches failures in both its main path and
its cleanup, reports only safe metadata, and uses the same pulse timer to retry
when disk I/O prevents ordinary timer restoration. Quarantine writes become
durable before skipped IDs are removed from the pulse's pending work.

`await status()` reads durable evidence. `groups` contains transaction/change
IDs and states `'durable-local'`, `'pending'`, `'published-to-origin'`,
`'provider-confirmed'`, or `'quarantined'`. Counts are groups: `durableLocal`
includes all locally retained groups, `pending` includes unstaged committed
groups, `publishedToOrigin` includes provider-confirmed groups, and
`providerConfirmed` counts only that scope. `incomingPending` lists incomplete
incoming work; `quarantined` counts quarantine markers. Status also includes
aggregate state, limits, lastError, machine, namespace, apiVersion, closed and
`publicationBlocked`. A permanently rejected prepared packet retains its
immutable writer sequence and blocks further publication for that writer until
the consumer/operator repairs the provider or restores the local sync store;
the engine never discards or rewrites that packet automatically.
Status does not stage, acknowledge, publish or apply work.

`close()` is idempotent. It stops timers and notifications, unsubscribes,
aborts bounded work, closes the origin and releases the owner claim. It never
forces a publication or deletes unfinished staging/journals. Subsequent
changed/flush/resume calls report closed; status remains readable.
If removing the ownership ticket fails, close still releases its kernel guard
and in-process reservation, returns a safe retryable error, and permits a new
coordinator to recover the retained work.

## Acceptance boundary

The standalone fixture and targeted sync/service suites prove this shared Node boundary and
Relay regressions. They do not certify an actual Nebula build, user-cloud
provider, mounted network share, or physical-device propagation. The shared
package window remains open until both real consumers pass and the owning
coordinator closes it. No new dependency is introduced.

## P1 verification record, 2026-10-28

Source changes: `package.json`, `engine/sync/index.mjs`,
`engine/sync/{store,pulse,pack,origin,apply,ownership}.mjs`, `scripts/build.mjs`,
`fixtures/sync-consumer.mjs`, `fixtures/sync-owner-child.mjs`,
`fixtures/sync-timer-fault.mjs`, `fixtures/sync-owner-release-fault.mjs`, `test/sync-api.test.mjs`,
`test/sync-ownership.test.mjs`, this document and `UNSTABLE.md`.
Relay already uses the maintained pulse/store/pack/apply implementation, so
`engine/service/service.mjs` needs no composition change.

The explicit v1 choices are JSON opaque targets; a byte-transform codec with
required format/version/encryption identifiers; filesystem/provider-confirmed
scope strings; group counts in asynchronous status; fixed approved quotas;
10-second operation deadlines and the existing 2-second failure hold by default;
per-transaction logical-message byte aggregation; and retention of quarantined
prepared writer sequences rather than automatic reuse. Adapter details and
recovery responsibilities are specified above.

The six review fixes additionally choose explicit `resume()` as the retry
boundary for receiver-state quarantines; retain the original callback operation
only on engine-created safe errors; isolate bad list entries; reuse the existing
pulse timer for secondary I/O failures; and use a token-authenticated kernel
lifetime guard for store ownership. The subsequent owner-claim correction removes
all legacy PID inspection and treats records without an endpoint shape as stale.

Node v26.6.0, after all six review fixes: `node --test test/sync-api.test.mjs`
passed 46/46, including 23 new review regressions. All nine
`test/sync-*.test.mjs` files together with `service-import-events` and
`service-integration` passed 177/177 with no skips. These include six ownership
tests for ignored PID-only and obsolete records, live endpoints, concurrent creators, crash
recovery, reused ports and uncertain probes. Eleven additional Relay/service
regressions passed: seven MCP cases, group HTTP receipts, imported editor
history, OpenCode busy deferrals and lifecycle checking. Lint passed with 251
Markdown files and zero issues. Build passed and packaged 437 files. The
standalone fixture also passed from the final extracted package archive,
using the named subpath export, with lost notification and pending-close recovery.
The original three `.work/review-sync/repro*.mjs` scripts now show isolated bad
machine names, recovery from temporary key absence with one publication, no
retroactive quarantine of committed groups, and both incoming packs applied
with zero remaining quarantines. Strict-rejection subprocesses cover EPERM in
failure records, ledger reads while rearming, issues records and quarantine
records; another covers safe close and same-process reacquisition after an
ownership-ticket unlink fails. Independent QA's extra fault repros also pass.
All checks are hidden/headless, and test state and caches remain in the checkout.

After removing the provisional PID compatibility path,
`node --test test/no-powershell.test.mjs` passed 1/1 without an exemption, and
all nine `test/sync-*.test.mjs` files passed 163/163 with no skips. Endpoint
exclusion, concurrent acquisition, crash recovery, token reuse and uncertain
probes remain covered; PID-only and obsolete records are ignored without
launching a process. Lint passed with 251 Markdown files and zero issues;
build passed with 437 packaged files, and the extracted package fixture passed.
Evidence for this correction is in `.work/sync-no-shell-qa/`:
`no-powershell.log`, `sync.log`, `lint.log`, `build.log` and `artifact.log`.

Artifact: `dist/onem1nd-1.0.0-beta.1.tgz`, API version 1, package version 1.0.0-beta.1.
SHA-256: `abec0fac097ed06e85840f27aa130e222fb30478d39361acb60f4bd9cdaaf356`.
This is a local provisional build, not a published or owner-accepted consumer pin.

During the initial P1 verification, `npm run test:core` was attempted but did not pass or finish: Windows denied
`taskkill /T /F` on a task-owned disposable process, reproduced independently
with status 1 and `Acceso denegado`. The stalled full run was interrupted.
Other reported failures passed in isolation: OpenCode busy timing, group HTTP
receipts, imported editor history and three MCP cases. The MCP fixtures require
`RELAY_LOCAL_STATE_DIR` inside the checkout; their default per-profile wake
directory was denied by the sandbox. Checkout-contained temporary fixtures also
require `GIT_CEILING_DIRECTORIES` at the checkout to avoid parent repository
discovery. These environment settings do not change product code or mask native
test failures. Full-core completion and native process cleanup remain unverified.

An initial delegated regression invocation used the existing system-temp fixture
default before subsequent checks were confined to the checkout. Those initial
temporary paths and their cleanup were not retained as evidence. No neighboring
ReLAN checkout or OneDrive source was changed. No commit, push, merge or tag ran.
Actual Nebula acceptance and coordinator closure of the shared package window
remain outside this checkout-only task. Execution evidence is retained in
`.work/sync-final-qa/` and `.work/sync-core-final.log` in the checkout.
The six-fix verification evidence is in `.work/sync-fixes-qa/`, including
`api-verified.log`, `sync-service-verified.log`, `relay-mcp.log`,
`relay-regressions.log`, `editor-import-regression.log`, `repro*.log`,
`qa-*.log` and `artifact.log`. Two deliberately crashed initial timer fixtures
are preserved there under `retained-first-run/`; current child fixtures use
their parent test's cleanup boundary.
