# HIVEM1ND 3.0 GUI and core contract

Version: `hivem1nd-gui-v3`, 2026-10-10. This document defines the new 3.0 interface; it does not describe interfaces already implemented in 2.x. The approved plan, sections 2 to 7, and the final Agreed decisions govern scope. The approved screens govern presentation: Map, Hierarchy, Chats, inspector, Blueprint, Void Document and Focus, Settings, and the restricted phone view. Modern is the default look; High contrast is the other look.

The core owns persistence, validation, service lifetime, sync, authentication, session adapters, approvals, task transitions, and editor operations. The GUI owns rendering, selection, confirmations, keyboard interaction, and presentation. Every GUI mutation uses this API. MCP, hooks, CLI commands, and HTTP call the same core operations and emit the same events. No GUI code is required to implement the core; no core source is required to implement the GUI.

Node 22 or later, Node built-ins, and plain browser modules are the runtime. No new package is required. Quantum, live encryption transport, additional session clients, a desktop shell, Console, Reports, visual programming, and mind discovery for hosts remain outside 3.0.

## 1. Common types and operation rules

`M` is the resolved mind directory. `P` is `M/user`, the existing private data directory. `O` is the configured origin directory. `L` is the machine-local service directory, outside OneDrive and outside `O`. The person's **unit** changes from `user` to `master`; the private directory named `user/` is retained. All paths returned by the API are relative to `M`, use `/`, and never expose credentials. Project document paths are relative to that project's registered repository.

Names are 1 to 128 ASCII letters, digits, dots, underscores, or hyphens, beginning with a letter or digit; `.` and `..`, trailing dots, and Windows reserved device names (including a reserved basename before an extension) are forbidden. Unit/environment/project names use at most 80 characters and machine names at most 48, retaining existing scope limits and bounded filesystem components. Unit names are matched without regard to case, with the original spelling retained. New names are lowercase. Machine names retain registry spelling. UUIDs use lowercase canonical UUID strings. A `Hash` or `Revision` is 64 lowercase hexadecimal SHA-256 digits of exact file bytes; an absent resource has revision `null`.

| Type | Exact representation |
| --- | --- |
| `Scope` | `{kind:"root",name:null}` or `{kind:"environment",name:Name}` or `{kind:"project",name:Name}` |
| `UnitId` | `root:<unit>`, `env:<environment>:<unit>`, or `project:<project>:<unit>` |
| `TaskId` | `root:<digits>`, `env:<environment>:<digits>`, or `project:<project>:<digits>`; leading zeros retained |
| `ResourceId` | UUID assigned to an editor resource in the local catalog; stable across machines through project plus relative path |
| `ThreadId` | UUID for new threads, or the retained legacy Blueprint `t-<base36-time>-<6-hex>` ID |
| `MessageId` | existing explicit `[A-Za-z0-9_-]{1,180}` ID, new UUID, or derived `legacy-<32-hex>`; spelling/case remains unchanged |
| `Time` | UTC ISO 8601 with milliseconds, such as `2026-10-10T12:00:00.000Z` |
| `Source` | `{kind:"gui"\|"phone"\|"cli"\|"mcp"\|"hook"\|"sync"\|"service",id:string,unitId:UnitId\|null}` |
| `Attachment` | `{path:string,kind:string\|null}`; a reference, never a command or an automatic file copy |
| `Client` | `"claude"`, `"codex"`, or `"cursor"` for starting a session |

The scope directory `S` is `P` for root, `P/envs/<name>` for an environment, and `P/projects/<name>` for a project. Canonical IDs distinguish duplicate unit names in different scopes. New records include canonical IDs beside legacy name headers. Legacy names resolve in their own scope, then its environment, then root; an ambiguous match is `409 ambiguous_unit`, never a guessed recipient. `user` as the person's name resolves to `root:master`, including old sender, recipient, member, and lead fields. It is not a prefix alias for unrelated unit names.

The old registration `scopeId:"user"` means root scope, not the person's identity, and remains readable as root. Old `user@<machine>` senders and the registry's `person:` aliases identify master. New person registrations use `unit:"master"`, `unitId:"root:master"`, `scopeId:"root"`, and `client:"master"`. A role cannot be inferred from a product/client name.

Examples are illustrative records; hashes are recalculated from the actual bytes. JSON property order has no semantic meaning. Markdown records follow [Files](../../files.md): headers, one blank line, then body; new array/object headers contain single-line JSON. Existing local `YYYY-MM-DD HH:MM` dates remain readable. New Relay records and machine records use `Time`. UTF-8, BOM, CRLF, and LF input are accepted; writes use UTF-8 without BOM and LF.

Writers preserve unrelated headers and body sections. File mutations are serialized by local resource, written to a temporary sibling, then renamed. Links and junctions are not followed for writes or imports. Cross-machine edits are resolved by section 2.10, rather than by sharing a lock in the origin. Immutable records have one writer; every origin file belongs to one machine.

All mutation requests carry `Idempotency-Key: <UUID>`. A retry with the same principal, key, route, and canonical JSON body returns the original status and response without another notice, task note, session launch, or event. A different body under that key returns `409 idempotency_conflict`. Receipts survive service restart in `L/receipts/<principalHash>/<UUID>.json` for 24 hours: `{principalHash,method,path,bodyHash,status,response,createdAt,expiresAt}`. Principal hash is SHA-256 of the stable OS-user/actor/session identity, not of the replaceable bearer. Authentication exchanges are exempt and never saved as receipts. Home grant enable/disable idempotency is memory-only for the grant lifetime, so a home key is never persisted in a response receipt.

Existing file-backed resource writes require the revision field named by their route, including header-only edits; comments use expectedCommentsRevision, other files expectedRevision. A stale revision returns `409 revision_conflict` with `{currentRevision}` and writes nothing. Create operations instead require the resource not to exist. Read acknowledgments, runtime Watch/home controls, and session stop use their documented identity/state preconditions. Approval revision is SHA-256 of UTF-8 canonical JSON `[requestHash,sortedAnswerHashes,resultHashOrNull]`; thread revision is its comments-sidecar Hash. Canonical JSON sorts object keys recursively, retains array order, and uses JSON.stringify encoding without whitespace. `PUT` replaces the specified editable content; `PATCH` changes only the documented fields. Unknown request keys return `400 unknown_field`, except within editor documents/nodes, where unknown persisted fields are retained.

## 2. Files and records

### 2.1. Service configuration and heartbeat

The default mind is `%LOCALAPPDATA%/Cosmic/hivem1nd` on Windows, `~/Library/Application Support/Cosmic/hivem1nd` on macOS, and `${XDG_DATA_HOME}/Cosmic/hivem1nd` on Linux, falling back to `~/.local/share/Cosmic/hivem1nd` when unset or relative. A custom location retains a `Cosmic/` parent folder. Staging always remains in the local Cosmic directory.

`L` is `<local Cosmic>/hivem1nd-service/<mindKey>/<machine>`, where `mindKey` is the first 16 hex digits of SHA-256 of the resolved `M` path, lowercased on Windows. A resolved staging path in OneDrive, under `O`, or under another configured synced root is rejected. A user-selected mind inside OneDrive is supported; origin publication is still machine-owned.

There is one process per machine and OS user, not one per mind or host. `<local Cosmic>/hivem1nd-service/service.lock` and `active.json` are the global singleton lock/descriptor, with `{pid,mindPath,machine,localDirectory,startedAt}`. A different configured mind returns `409 service_mind_conflict`; it does not start a second process. Stale locks are reclaimed only after verifying the PID is no longer the same owned service. Starting/attaching waits up to ten seconds for atomic bootstrap publication, then returns `503 service_start_timeout` if unavailable.

`L/config.json` is local, owner-readable configuration, never synced:

```json
{
  "format": "hivem1nd-service-config-v1",
  "mindPath": "C:/Users/example/AppData/Local/Cosmic/hivem1nd",
  "machine": "DESKTOP",
  "origin": {"kind": "folder", "path": "D:/Cosmic/origin"},
  "stagingPath": "C:/Users/example/AppData/Local/Cosmic/hivem1nd-service/0123456789abcdef/DESKTOP/staging",
  "port": 0
}
```

`origin.kind` is `folder` or `onedrive`; `port:0` requests an available loopback port. `L/service.json` holds `{format:"hivem1nd-service-local-v1",pid,origin,startedAt}` for local discovery. It contains no token. `L/bootstrap.json` is the exact local handoff: `{format:"hivem1nd-bootstrap-v1",origin,secret:<32-random-byte-base64url>,startedAt}`. It is atomically written after binding, under an owner-only directory (POSIX 0700/0600 or Windows ACL restricted to the current user and SYSTEM), rotated at restart and removed at stop. Failure to establish/verify those permissions is `503 bootstrap_unavailable`, never a world-readable fallback. This secret authenticates only `/auth/local`; it is not a session token and is never returned through HTTP discovery or synced. The CLI/host reads it directly under the same OS user. The OS login registration and service lock are local, not mind records.

`O/machines/<machine>/service.json` is written only by that machine, mirrored into `P/machines/<machine>/service.json` on receipt:

```json
{
  "format": "hivem1nd-service-v1",
  "machine": "DESKTOP",
  "state": "running",
  "version": "3.0.0",
  "heartbeatAt": "2026-10-10T12:00:00.000Z",
  "startedAt": "2026-10-10T11:00:00.000Z"
}
```

`state` is `running` or `stopped`. A beat is published on startup and no more than once per 60 seconds while running; a final stopped record is permitted on shutdown. `answers` is true only for a running beat no older than 180 seconds and no more than 30 seconds in the future. Invalid or absent beats produce `answers:false` and an issue. Local service liveness also requires its held process lock. These metadata beats are the only periodic origin writes during idle operation; idle sync does not poll or publish empty packs.

### 2.2. Units, person migration, sessions, and wake policies

State remains `S/state/<unit>.md`; the body and existing `branch`, `commit`, `tree`, `claims`, `job`, and `model` conventions remain intact. New required identity fields on newly created states are `unit-id`, `role`, and `machine`. `role` is `overseer`, `adjutant`, `executive`, `overlord`, `executor`, `incubator`, `genesis`, or `master`. `lead-id` disambiguates `lead`; `approvals` is a JSON array.

```markdown
unit: executor-shop
unit-id: project:shop:executor-shop
role: executor
state: out
machine: DESKTOP
lead: overlord-web
lead-id: env:web:overlord-web
job: builder
model: strong
date: 2026-10-10 09:00
approvals: [{"id":"f605f169-8686-4a88-a213-7ca19703fd41","action":"process.run","pattern":{"command":"npm run build","cwd":"project:shop"},"grantedAt":"2026-10-10T12:00:00.000Z","grantedBy":"root:master"}]

Ready for the next task.
```

An approval grant has exactly `id`, `action`, `pattern`, `grantedAt`, and `grantedBy`. It belongs only to that state/unit. Revocation removes that grant by ID. Pattern matching is exact structured equality after adapter normalization, not shell globbing or an unrestricted regular expression; changing cwd, executable, arguments, or resource fails the match. Unsupported action kinds cannot receive an always grant.

Migration renames `P/state/user.md` to `P/state/master.md`, `S/inbox/user/` to `S/inbox/master/` where present, and `P/relay/archive/user/` to `P/relay/archive/master/`; person headers and chat memberships are canonicalized on the next write. The private `user/` directory, task filenames, historical message bytes, and session UUIDs do not change. Readers accept both person names. If both inboxes exist, they are merged by message ID with differing bytes preserved as conflict copies; neither is deleted before verified. If both state files exist, canonical master takes precedence and the other is kept as a conflict copy with a notice. Migration is idempotent and preserves the mind location.

Registrations remain `P/relay/sessions/<registrationId>.json`. Each new observation is an immutable registration, and the newest observation for a bound native session is projected. Stable `sessionId` is deterministic UUIDv8 (2.8) over `["session",machine,client,nativeSessionId,unitId]`, distinct from observation registrationId; legacy observations derive it using the same tuple. Approvals, start results, and stop routes use this stable session ID. The existing fields remain readable:

```json
{
  "kind": "registration", "registrationId": "317fe33f-ec4e-49f2-9ab1-7f2a71b1d9b1",
  "instanceId": "service-DESKTOP", "sessionId": "20c58b80-4d93-88cd-83b3-39d78f1d9d5d", "unit": "executor-shop", "unitId": "project:shop:executor-shop",
  "scopeId": "project:shop", "nativeSessionId": "native-session-1", "client": "codex", "machine": "DESKTOP",
  "registeredAt": "2026-10-10T12:00:00.000Z", "activity": "idle",
  "activityObservedAt": "2026-10-10T12:00:00.000Z", "quota": null, "quotaObservedAt": null
}
```

`activity` is `busy`, `idle`, `active`, `inactive`, or `null`. Quota is the adapter observation `{remaining:number|null,exhausted:boolean}` or `null`; observations older than 15 minutes are projected as unknown. `instanceId`, native transport endpoints, and process secrets are not returned to phone clients.

The owning service writes immutable `P/relay/session-status/<sessionId>/<eventId>.json`: `{"format":"hivem1nd-session-status-v1","sessionId":"20c58b80-4d93-88cd-83b3-39d78f1d9d5d","state":"stopped","machine":"DESKTOP","at":"2026-10-10T13:00:00.000Z","reason":"native-acknowledged"}`. States are `registered|stopping|stopped`; newest owner observation governs, and an old synced registration cannot revive a stopped native session. Resume requires a fresh verified native observation with a later timestamp, without renewing wake consent.

Wake policies remain `P/relay/wake/policies/<key>.json`; legacy keys are SHA-256 of `JSON.stringify([unit,nativeSessionId,client,machine])`. New keys use `unitId` in the first slot to disambiguate scope. The service accepts both and deduplicates the binding before adopting it.

```json
{
  "kind": "relay-wake-policy", "version": 1, "key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "binding": {"unit":"executor-shop","unitId":"project:shop:executor-shop","nativeSessionId":"native-session-1","client":"codex","machine":"DESKTOP"},
  "generation": "2bc1fd56-198e-438b-b8ce-0725b39f1d66", "enabled": true,
  "startedAt": "2026-10-10T12:00:00.000Z", "deadlineAt": "2026-10-10T16:00:00.000Z",
  "durationHours": 4, "extended": false, "unlimited": false, "maxHandoffs": 20, "manualConsent": false,
  "registrationId": "317fe33f-ec4e-49f2-9ab1-7f2a71b1d9b1", "disabledAt": null,
  "disabledReason": null, "pausedReason": null, "activity": {"value":"idle","observedAt":"2026-10-10T12:00:00.000Z"},
  "wakeCount": 0, "retryAt": null, "cooldownUntil": null, "lastError": null, "consecutiveErrors": 0,
  "deliveries": {}, "worker": {"state":"running","heartbeatAt":"2026-10-10T12:00:00.000Z"}
}
```

Delivery values retain `{state,attempts,lastAttemptAt,threadId,priority}` and adapter metadata. `state` includes `attempting`, `submitted`, `ambiguous`, `not_submitted`, and `failed`; retries of not_submitted wait for retryAt. Submitted and ambiguous attempts are never replayed through another transport. When old/new policy keys collide, adoption uses the earliest startedAt/deadline, the smaller remaining handoff budget, and the union of delivery IDs, with ambiguous/submitted dominating retriable states. Old aliases remain readable but only one canonical binding is scheduled. Fixed deadlines and handoff caps do not renew on resume. Existing native session bindings require a local hook/adapter reattachment; persisted registration alone cannot recreate a secret transport. One service adopts all policies for its own machine; old workers are stopped only after adoption and local lease transfer. Leases, locks, indexes, endpoints, and process IDs remain local; obsolete shared `workers/` and `locks/` are ignored.

### 2.3. Session start request and result

The initiating service writes immutable `P/relay/requests/<target-machine>/<requestId>.json`, which travels in its own packs. The target alone writes immutable `P/relay/request-results/<requestId>/<resultId>.json`. A fresh service beat is checked both before enqueue and at consumption. No request is redirected to another machine. The latest result is selected by `(at,id)`; terminal states never regress. A request carries `stateRevision`, the requested unit Hash, and the target rejects a changed unit with `unit_changed` rather than launching a different job/model/lead.

```json
{
  "format": "hivem1nd-session-request-v1", "id": "6a63040d-789b-4dc4-934e-6cc9db9c69f8",
  "unitId": "project:shop:executor-shop", "targetMachine": "DESKTOP", "requestedBy": "root:master",
  "sourceMachine": "LAPTOP", "client": "codex", "model": "strong", "leadId": "env:web:overlord-web",
  "job": "builder", "prompt": "Implement the approved task.", "stateRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "createdAt": "2026-10-10T12:00:00.000Z", "expiresAt": "2026-10-10T12:02:00.000Z"
}
```

```json
{
  "format": "hivem1nd-session-result-v1", "id": "2e0f6f3f-863e-4369-959c-5b27dfe6d42b",
  "requestId": "6a63040d-789b-4dc4-934e-6cc9db9c69f8", "machine": "DESKTOP", "state": "started",
  "sessionId": "20c58b80-4d93-88cd-83b3-39d78f1d9d5d", "error": null, "at": "2026-10-10T12:00:02.000Z"
}
```

Result `state` is `starting`, `started`, `failed`, or `expired`; `sessionId` is null before registration; `error` is null or `{code,message}`. The request is shown as `queued` before a result exists. Under a per-unit local launch lock, the target rechecks stateRevision, machine, and absence of another live/pending session before claiming the request. `L/session-starts/<requestId>.json` is `{requestId,phase:prepared|spawned|registered|failed,pid:null|integer,sessionId:null|UUID,at}`; it is durably recorded before spawning and reconciled after restart. An uncertain launch is failed with `launch_ambiguous`, never automatically spawned again. Cwd comes from the target machine's registered project path. No API executable, arbitrary cwd, or shell string is accepted. Client support/install is checked on the target. `prompt` is null or text; after successful registration it becomes exactly one first Relay message from `master`, identified by request ID. A retry does not post it twice. Start requests expire after 120 seconds.

### 2.4. Mailboxes, chats, and messages

Mailboxes remain `S/inbox/<unit>/<YYYYMMDD-HHMMSS>-<machine>-<UUID>.md`. Archives remain `P/relay/archive/<unit>/` for unambiguous legacy units; new scoped archives use `P/relay/archive/by-unit/<base64url(UnitId)>/`. A read archives original bytes; a late inbox twin with equal bytes is already read. Differing twins return `409 archive_collision` and stay visible. Read receipts are immutable `P/relay/read/<reader-machine>/<messageId>.json`: `{"format":"hivem1nd-read-v1","messageId":"69c03b50-819b-42be-b5f9-6a11809647a8","unitId":"root:master","readAt":"2026-10-10T12:01:00.000Z","machine":"LAPTOP"}`. They prevent another synced copy from waking a session again. For an old record without an explicit ID, retain `legacy-` plus the first 32 hex SHA-256 digits of `filename + NUL + rawToHeader + NUL + rawFromHeader + NUL + exactRawBytes`, using the final duplicate header value as the existing reader does. Alias normalization never changes this ID. Legacy local dates are returned as `date`, with `timestamp:null` when no valid ISO timestamp exists.

Chats are `P/relay/chats/<chatId>/chat.md` and message siblings in the same folder, not nested inside a unit mailbox:

```markdown
id: 0efb1be7-b006-476d-b0f6-4629d217ab82
title: Cart release
members: ["root:master","project:shop:executor-shop","env:web:overlord-web"]
pinned: false
listed: true
created: 2026-10-10T12:00:00.000Z
created-by: root:master
kind: group

```

`kind` is `direct` for master plus one unit, or `group` for master plus at least two units. Members are unique canonical IDs, at most 256. A direct chat is reused for the same pair, and reopening sets `listed:true`; creating a group always creates its own conversation. A chat does not alter leads or squads. `pinned` and `listed` are shared, not per-browser. Unlisting preserves all records. Closing an inspector only changes local selection. No physical chat deletion route exists.

Direct chat ID uses the deterministic UUID function in 2.8 over `["direct-chat",sortedMemberIds]`, preventing offline machines from creating duplicate direct histories. Groups use a random UUID. If no title is supplied, direct title is the other unit name; group title is comma-separated member names excluding master, truncated to 240 characters.

```markdown
id: 69c03b50-819b-42be-b5f9-6a11809647a8
from: master
from-id: root:master
to: chat:0efb1be7-b006-476d-b0f6-4629d217ab82
machine: LAPTOP
timestamp: 2026-10-10T12:00:01.000Z
priority: normal
subject: Cart release
thread-id: 0efb1be7-b006-476d-b0f6-4629d217ab82
reply-to:
reply-requested: false
attachments: []
kind: message

The delivery is ready for review.
```

For mailbox messages `to` is the legacy unit name and `to-id` is its canonical ID. `kind` is `message`, `chat-notice`, `approval-notice`, `task-notice`, `comment-notice`, `sync-notice`, or `conflict-notice`. A notice additionally carries `resource-id` and `notice-key`; it references the canonical content and never duplicates its full body. A post commits its message then queues one deterministic notice per other member, including master for agent replies. Notice key `<messageId>:<recipientId>` makes fanout restart-safe. All members see all replies in the chat; an offline member reads later. Notice deliveries remain `pending`, `submitted`, `ambiguous`, or `failed`; submission is not a claim of delivery or an immediate reply.

### 2.5. Approval request and answer

Immutable request: `P/relay/approvals/<approvalId>/request.json`. Immutable answer: `.../answers/<answerId>.json`; the requesting unit's machine applies the first valid answer and writes `.../result.json`. Its local hook waits at most 120 seconds.

```json
{
  "format": "hivem1nd-approval-v1", "id": "e80a0bf9-8fb4-4d64-9527-04524c9a2ecf",
  "unitId": "project:shop:executor-shop", "sessionId": "20c58b80-4d93-88cd-83b3-39d78f1d9d5d",
  "chatId": "0efb1be7-b006-476d-b0f6-4629d217ab82", "action": "process.run",
  "pattern": {"command":"npm run build","cwd":"project:shop"}, "display": "Run the project build",
  "alwaysAllowed": true, "requestedAt": "2026-10-10T12:00:00.000Z", "expiresAt": "2026-10-10T12:02:00.000Z"
}
```

```json
{"format":"hivem1nd-approval-answer-v1","id":"138b109d-dba0-4cdb-ab4b-bb3f39cacd60","approvalId":"e80a0bf9-8fb4-4d64-9527-04524c9a2ecf","decision":"approve-always","answeredBy":"root:master","machine":"LAPTOP","at":"2026-10-10T12:00:10.000Z"}
```

`decision` is `approve`, `approve-always`, or `deny`. Result is `{format:"hivem1nd-approval-result-v1",approvalId,state,answerId,grantId,at}`, where `state` is `approved`, `denied`, or `expired`, and absent IDs are null. Before result, the projection is `pending` or `answering` if an answer is awaiting sync. Always grants are applied only by the requesting service into the requesting unit's state, and only for the normalized action/pattern shown. A timeout produces `expired`; the adapter returns control to the client's own permission prompt, never to automatic approval. A stale/second answer returns `409 approval_resolved` or `410 approval_expired`. Existing always grants resolve locally without prompting and still emit an approval result event. Unsupported hooks report `approval_unavailable` and retain their native prompt.

Approval requests create/reuse the unit's direct chat if chatId is omitted; a supplied chat must contain master and that unit. Approval notices reference the request ID in that chat and wake master. Terminal result is written only once by the request owner: `{"format":"hivem1nd-approval-result-v1","approvalId":"e80a0bf9-8fb4-4d64-9527-04524c9a2ecf","state":"approved","answerId":"138b109d-dba0-4cdb-ab4b-bb3f39cacd60","grantId":"f605f169-8686-4a88-a213-7ca19703fd41","at":"2026-10-10T12:00:11.000Z"}`. Offline views can enqueue an answer but cannot claim execution until that result arrives.

For each submitted answer the owner writes `P/relay/approvals/<approvalId>/answer-results/<answerId>.json`: `{format:"hivem1nd-approval-answer-result-v1",answerId,approvalId,state:applied|rejected|expired,resultAnswerId:UUID|null,at}`. First valid received answer applies; other synced answers have a durable rejected/expired outcome, visible through GET detail. Answer submission returns its answerId so a remote 202 can be tracked. An expired approval can never acquire an always grant from a late answer.

Revocation is owner-applied. The initiator writes `P/relay/grant-revocations/<unit-machine>/<requestId>.json`: `{"format":"hivem1nd-grant-revocation-v1","id":"73e2a095-585f-4aeb-b66f-f1b2f0795f9b","unitId":"project:shop:executor-shop","grantId":"f605f169-8686-4a88-a213-7ca19703fd41","requestedBy":"root:master","at":"2026-10-10T12:01:00.000Z"}`. The owner removes it under the unit lock and writes `P/relay/grant-revocation-results/<requestId>.json`: `{format:"hivem1nd-grant-revocation-result-v1",requestId,unitId,grantId,state:"revoked",revision,at}`. It retains the revoked grant ID as a tombstone; incoming older state cannot resurrect that grant. A new grant requires a new approval/ID. Remote API response is 202 pending until owner result, local is 200 revoked. Every gated action rechecks that owner's current grants/tombstones.

### 2.6. Tasks and undo

Tasks remain `S/tasks/<id>-<slug>.md`, with `open`, `review`, `done`, and `closed` as the only statuses. A status operation preserves the Request and existing Report and appends the supplied note under `## Report` with actor and local date. Accept maps `review` to `done`; Send back maps `review` to `open` and requires a nonblank note. For a unit with a lead, the existing `Approved for review by <unit> on <date>` line is required before master acceptance. A closed task is readable through detail/list filters.

Undo records are immutable `P/relay/task-undo/<base64url(TaskId)>/<changeId>.json`:

```json
{
  "format": "hivem1nd-task-change-v1", "id": "57ef3286-6722-429d-9306-4e523b634e57",
  "kind": "status", "taskId": "project:shop:029", "actor": "root:master", "machine": "LAPTOP",
  "at": "2026-10-10T12:00:00.000Z", "previousStatus": "review", "status": "done",
  "beforeRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "afterRevision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "note": "Accepted.", "undoOf": null
}
```

An undo record uses `kind:"undo"`, reversed statuses, and `undoOf:<changeId>`. It restores the previous **status**, keeps earlier notes and appends an undo audit note. Only the latest non-undone status change whose `afterRevision` is still current can be undone. Otherwise return `409 undo_conflict`; if none exists, `409 nothing_to_undo`. A local journal `L/transactions/<UUID>.json` holds `{resource,beforeRevision,afterRevision,afterBytesBase64,recordPath,record,phase}` with `phase:prepared|committed`; restart completes or verifies both writes before publishing success/events. No undo record is published for a failed status edit.

Allowed transitions are `open->review`, `review->done`, `review->open`, `done->closed`, and `closed->open`; all others are `422 invalid_transition`. Master can review only tasks addressed to its person aliases as requester and satisfying lead gating. Agent capabilities may deliver `open->review` only for their assigned task; a lead may send its delivery back. Master may mark its own requested task delivered when recording a delivery on the desktop. Task deliveries create one notice in the unit's direct chat, including taskId, status, and reviewable; imported deliveries deduplicate by taskId plus revision. This supplies inspector Accept/Send back controls without parsing text in messages.

For master, `reviewable` is true exactly when status is review, task.from resolves to master or a registry person alias, and either the executor has no current lead or its Report contains the current scope-resolved lead's approval line. The lead's own review is allowed when it is that executor's current lead. Task requester may archive done or reopen closed; master may do so for its own requested tasks. Assigned agent may reopen its returned open task's work but cannot accept its own delivery. Unauthorized transitions return 403 forbidden; undo requires the original actor or task requester and passes the same ownership checks.

The new CLI `hivem1nd task status <project> <id> <status> [--note <text>]` and `hivem1nd task undo <project> <id>` call these same operations using the current revision. A verified native binding uses its agent credential/actor; otherwise the same-user desktop invocation uses a local master viewer credential. Their JSON output is the API's data value. Exit codes are 0 success, 2 usage/validation, 3 conflict, and 1 other failure; stderr prints the error code and message. These commands do not accept a delivery on another person's behalf without the caller's normal authority.

### 2.7. Layout and settings

Shared Map arrangement is `P/gui/layout.json`:

```json
{"format":"hivem1nd-layout-v1","nodes":{"root:master":{"x":380,"y":56},"project:shop:executor-shop":{"x":84,"y":246}},"groups":{"project:shop":{"x":214,"y":664,"collapsed":false}},"updatedAt":"2026-10-10T12:00:00.000Z","machine":"LAPTOP"}
```

Positions are finite canvas coordinates in CSS pixels, from -100000 to 100000. Group keys are `project:<name>` or `env:<name>`. Missing coordinates get a deterministic initial placement by sorted ID; unrelated coordinates survive a move. Selection, inspector, zoom, viewport, Focus position, and locally folded lists stay in browser memory/storage, not shared layout. Connections edit `lead-id` in state, not layout edges. Units with no Overlord are grouped by project. One canonical root Overseer is rendered; legacy duplicates produce issues and are not extra cards. Adjutant and executive appear beside that line; Incubator and Genesis are services.

`P/gui/settings.json` is shared: `{"format":"hivem1nd-settings-v1","look":"modern","language":"en"}`. `look` is `modern` or `high-contrast`; `language` is `en` or `es`. Absence returns these defaults. API wire enums remain English; user-facing Spanish is neutral and impersonal. Home-network enablement, key, short code, phone credentials, host embed overrides, and service ports are ephemeral/local and never written here or synced.

### 2.8. Editor resources and attached units

`P/gui/resources.json` is a shared catalog, populated from registered project paths and explicit desktop registration. It never accepts an absolute path from a phone or agent:

```json
{"format":"hivem1nd-resources-v1","resources":[{"id":"f359bb5c-9d80-4b96-ad33-e9b99e523f52","kind":"blueprint","project":"shop","path":"docs/flows/boards/cart.json","legacyId":"cart"},{"id":"10943b49-2c8a-4b30-b3aa-2d431e34a551","kind":"void","project":"shop","path":"docs/release.json","legacyId":null}]}
```

Resource IDs use deterministic UUIDv8: SHA-256 of UTF-8 canonical JSON `["editor",kind,project,normalizedRelativePath]`, take the first 16 digest bytes, set byte 6 high nibble to 8 and byte 8 high bits to binary 10, and format as a UUID. Relative paths remove `.` segments, use `/`, retain case, and reject `..`; registry project spelling is used. This same function with a different namespace array derives direct chat and legacy message IDs. Legacy comment message input is `["comment-message",resourceId,threadId,index,author,at,text]`; original stored author spelling and zero-based index are retained for hashing. It is never regenerated after adding an explicit ID. A project without a local registered path returns `409 project_unavailable` for editor operations.

Registration allows regular JSON files within that registered repository, excluding `.orig.json`, `.comments.json`, and version/history sidecars from Void discovery. Registered legacy Blueprint `.mjs` boards are metadata-only read-only resources: Editor has `document:null,legacy:{id,path,reason:"conversion_required"}`. There is no existing server-side JSON parser for their function-based trees. They remain readable through the existing standalone Blueprint viewer; integrated editing requires an explicit JSON export/copy supplied by desktop through board creation. The service never executes an uploaded module or silently pretends it is an empty editable board. No general filesystem browse or arbitrary executable import route is part of the contract.

Blueprint keeps `docs/flows/boards/index.json`, existing `.mjs` boards, `docs/flows/sketches/<board>.json`, `docs/flows/comments/<board>.json`, and `docs/flows/assets/`. Full-editor JSON defaults to `docs/flows/boards/<board>.json`; it and a sketch use the same format. For every JSON resource, `legacyId=document.id` and its board ID is unique per project even with a custom document path; a collision is `409 board_id_exists`. Its comments always use `docs/flows/comments/<id>.json`. A legacy module is not silently overwritten. Index entries remain `{id,letter,short,title}` with unknown properties retained. Comment sidecars are `{board:<legacyId>,threads:[...]}`.

```json
{
  "formatVersion": 1, "id": "cart", "title": "Cart", "note": "", "pages": [{"id":"main","title":"Main","objects":[],"order":["empty"],"start":"empty"}],
  "screens": [{"id":"empty","title":"Empty cart","pageId":"main","x":0,"y":0,"w":390,"h":844,
    "root":{"id":"root","name":"Root","t":"box","place":{"x":0,"y":0},"w":390,"h":844,"dir":"stack","kids":[]}}],
  "links": [], "components": [], "fonts": [], "threads": []
}
```

Required node fields are `id`, `name`, `t`, `place:{x,y}`, `w`, and `h`. Type `t` is `box|text|vector|image|icon`; boxes contain `dir:"stack"` and `kids:Node[]`; text has `value`, vectors `d`, images `src`, icons `icon`. IDs are lowercase alphanumeric/hyphen strings up to 80 characters, unique within the board; the board document id may retain legacy mixed case. Removing a node removes its subtree and associated link/element references atomically.

| Editor structure | Exact typed fields and validation |
| --- | --- |
| Board | `formatVersion:1,id:string,title:string,note:string,pages:Page[],screens:Screen[],links:Link[],components:JSON[],fonts:JSON[],threads:JSON[]`; all arrays required, at least one page |
| Page | `id,title:string,objects:JSON[],order:ScreenId[],start?:ScreenId`; order is unique, includes every screen of that page exactly once; start is in order |
| Screen | `id,title,pageId:string,x,y:number,w,h:number,root:Node`; x/y finite, w/h 1..16000; root box has place `{x:0,y:0}` and matching w/h |
| Link | `id,from,to:string,element?:NodeId,transition:cut\|fade\|slide,direction?:left\|right\|up\|down,duration?:number,easing?:string`; duration 0..10000 milliseconds; endpoints are screens and element belongs to from screen |
| Node | required fields above, place coordinates finite, w/h 1..16000, name at most 240; value/d/icon/font/src strings; src is a project-local assets reference, never javascript/data HTML |
| Known node styles | colors `fill,stroke,color` are `#rrggbb`, `#rrggbbaa`, or `none`; strokeWidth 0..100, radius/corners 0..8000, corners four numbers, clip boolean, opacity 0..1, kind `rectangle\|circle\|polygon\|line\|arrow\|pen`, sides integer 3..64, size 1..1000, weight integer 100..900, align `left\|center\|right` |
| Full-editor properties | `valign,shadows,blur,pixelate` and other unknown data are opaque bounded JSON retained without interpretation by Lite |

Sketches may retain links to adjacent legacy boards from the same project's index; missing external endpoints are shown unresolved rather than deleted. Newly created full boards require internal references. Existing optional link fields are preserved even if Lite does not use their easing/style values.

Unknown properties at document, page, screen, link, node, component, font, and thread levels are accepted as bounded JSON and preserved deeply. Lite neither draws nor rewrites unknown fields. A node patch cannot change `id`, `t`, or `kids`; add/remove operations change structure. Other supplied properties merge recursively, replacing a supplied style array as a whole. Full replacement must preserve unknown data for surviving IDs or returns `409 unsupported_fields_lost`; explicitly removed objects need not retain their data, but references and orphaned comments are handled atomically. Existing validators that strip/reject optional full-editor fields must be changed. No blank-board recovery overwrites a malformed record.

Void keeps the registered `<name>.json` document and `<name>.orig.json`, `<name>.versions.jsonl`, `<name>.comments.json` sidecars:

```json
{"title":"Release notes","rev":0,"pages":[{"k":"Intro.Welcome","en":"<b>Welcome</b>\nA first paragraph.","es":"<b>Bienvenida</b>\nUn primer párrafo."}]}
```

`k` is unique per document; language fields are strings, `rev` is a nonnegative integer (missing legacy value means 0), unknown fields are preserved. Original is created once and never overwritten. Each text change increments `rev` and appends `{at,rev,k,lang,before,after}` to versions JSONL; external imports add `by:"outside"`. API `revision` is the full file Hash, distinct from numeric `rev` and the legacy Blueprint 32-hex revision. Rendering permits only the existing `b`/`i` markup; links, scripts, handlers, and arbitrary HTML are not executed.

Void comment sidecar remains `{path:<basename>,threads:[...]}`. Thread shape is `{id:ThreadId,anchor,to,status,messages}`; `to` is a legacy recipient or null, `status` is `open|resolved`, messages are `{id:UUID,author,authorId,at,text}`. Blueprint retains its native `{id,anchor,layer,status,messages}`, with `layer:"design"`; old `plain` is accepted/preserved. Projection adds `to:null` for Blueprint. Legacy messages without IDs get the stable derived ID above. Author is derived from credentials; the person's legacy `person`/`user`/`User` author becomes `master` in the projection, without rewriting history.

```json
{"path":"release.json","threads":[{"id":"b37ea5c9-31a6-43ea-aed4-63e842c41f37","anchor":{"lang":"en","k":"Intro.Welcome","start":0,"end":7,"quote":"Welcome","prefix":"","suffix":"\nA first paragraph."},"to":null,"status":"open","messages":[{"id":"5511f09e-0cda-4b15-8d58-8c79821b148f","author":"master","authorId":"root:master","at":"2026-10-10T12:00:00.000Z","text":"Clarify the introduction."}]}]}
```

Void anchors use UTF-16 offsets in the rendered plain text of one `k`/`lang`, with `b`/`i` tags stripped and paragraph separators retained; quote must match at creation. Prefix and suffix are at most 48 code units. Subsequent relocation uses quote and surrounding text; returned `place:{start,end,exact}` or null is derived, never persisted. Missing anchors stay visible as unplaced threads. Blueprint anchors retain `{screen:string|null,screenTitle:string|null,element:string|null,label:string,path:string[],point:{x,y}}`: point is integer board pixels, label at most 160, path at most ten strings; both IDs null means empty canvas, element null means whole screen. Projection adds `place:{screenId,nodeId,x,y}` when resolvable, otherwise null. Replies reopen resolved threads. Threads are not deleted by removing an anchor.

Comment-based Void suggestions preserve the approved Accept change and Discard controls. Optional `proposal` on a comment message is `{id:UUID,state:pending|accepted|discarded,k,lang,start,end,expectedText,replacement,baseRevision:Revision,createdBy:UnitId,createdAt:Time,decidedBy:UnitId|null,decidedAt:Time|null}`. It lives in that same `.comments.json` sidecar, not another text format. Pending proposals leave document bytes unchanged. Accept validates baseRevision and the exact serialized source slice, then applies the replacement with normal history and marks accepted in one journaled transaction. Discard leaves the document unchanged and marks discarded, preserving discussion. A stale proposal returns `409 proposal_stale` and remains visible; it is never automatically rebased/applied. Desktop alone answers proposals; phone's Accept is task acceptance only.

Attached units are kept separately at `P/relay/editors/<resourceId>.json`, so the source formats remain compatible:

```json
{"format":"hivem1nd-editor-binding-v1","resourceId":"f359bb5c-9d80-4b96-ad33-e9b99e523f52","kind":"blueprint","attached":["project:shop:executor-shop","env:web:overlord-web"],"updatedAt":"2026-10-10T12:00:00.000Z"}
```

The array is unique canonical IDs, at most 256. New person comments and replies queue deterministic Relay notices to attached units; an agent reply notifies the other attached units and master, excluding its own author. Notice key `<commentMessageId>:<recipientId>` prevents duplicate wakes. The GUI displays queued/submitted/failed status, not a promise that an agent has answered. Replies are read from the same sidecar and immediately generate SSE. A corrupt sidecar returns `409 corrupt_resource`; it is never treated as an empty thread list. Repository documents are synced only through their catalog project-relative identity, mapped to each machine's registered repo; absolute local paths do not travel.

### 2.9. Local staging, packs, and head

```text
L/
  staging/objects/<sha256>.br
  staging/changes/<changeId>.json
  outgoing/<12-digit-sequence>.pack
  received/<machine>/head.json
  received/objects/<sha256>.br
  sync-ledger.json
  sync-versions.json
  receipts/<principalHash>/<requestId>.json
  transactions/<requestId>.json
O/
  machines/<machine>/service.json
  machines/<machine>/packs/<12-digit-sequence>.pack
  machines/<machine>/head.json
```

Object hashes are over original bytes before Brotli compression. A change record is `{format:"hivem1nd-change-v1",id,machine,at,target,operation,hash,size,baseHash,messageId,transactionId:null|UUID}`, with `operation:put|delete`, and null `hash`/zero `size` for a tombstone. `target` is `{kind:"mind",path:<M-relative path>}` or `{kind:"project",project,path:<repo-relative path>}`. Only the private mind records and cataloged editor resources/sidecars/assets are eligible; kit code, `.git`, credentials, local leases, staging, and the origin are excluded. Unknown targets/escaped paths are rejected. Deletions are explicit tombstones and never remove chat history through unlisting.

```json
{"format":"hivem1nd-change-v1","id":"acf021e1-7193-49bc-aa28-3a3e4e418928","machine":"LAPTOP","at":"2026-10-10T12:00:00.000Z","target":{"kind":"mind","path":"user/gui/layout.json"},"operation":"put","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":320,"baseHash":null,"messageId":null,"transactionId":null}
```

Pack framing is byte-exact: four ASCII bytes `H1P3`, uint32 big-endian outer-header byte length, UTF-8 JSON outer header, then payload. Outer header fields are `{format:"hivem1nd-pack-v1",machine,sequence,payloadBytes,payloadHash,encryption}`. `sequence` is a positive integer; `payloadHash` is SHA-256 of the transmitted payload. For 3.0, `encryption` is `{algorithm:"none"}`. Payload starts with uint32 big-endian index byte length, UTF-8 JSON index, then concatenated compressed object blobs. Object offsets are relative to the first blob byte.

```json
{"format":"hivem1nd-pack-index-v1","compression":"br","objects":[{"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","offset":0,"compressedBytes":120,"rawBytes":320}],"changes":[],"dependencies":[],"transactions":[]}
```

Every staged change is included in `changes` with the schema above; empty example arrays only illustrate framing. Each listed blob is one complete Brotli stream of that object's exact bytes. Objects already present in a validated published pack are omitted; the index also contains `dependencies:[{hash,machine,sequence,packHash}]` for every omitted referenced object. Each dependency must name a pack already committed in its owner's head before this pack is published. Readers fetch dependencies first and verify the specified hashes, avoiding a missing-object deadlock across machines. Identical object bytes do not erase distinct path mutations. Packs are immutable, written via temporary files before the owner's head is atomically replaced. A crash before head replacement leaves an unreferenced pack; restart verifies/reuses it without reusing a committed sequence for different bytes.

```json
{
  "format": "hivem1nd-head-v1", "machine": "LAPTOP", "sequence": 1,
  "updatedAt": "2026-10-10T12:00:02.000Z",
  "packs": [{"sequence":1,"file":"000000000001.pack","hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","bytes":600}]
}
```

Head pack hash covers the entire pack file, and bytes is its exact length. Sequences increase monotonically; the list contains all committed packs in order. There is no compaction or shared manifest in 3.0. Readers reject regressions, duplicate sequence names with changed hashes, wrong owner names, invalid lengths, missing dependencies, and digest mismatches without applying that pack. Failed packs produce one master notice and a sync issue; later valid retries resume from the last applied sequence.

Path ownership is checked on import, not inferred from the claimed JSON machine alone. A request-result, session-status, approval-result/answer-result, and grant-revocation-result must be published by the machine bound by its verified request/session; machine heartbeats only by their directory owner; read receipts only by their reader-machine directory owner. Original message machine/from-id must match its registered originating actor except deterministic system notices. An owner mismatch is `422 invalid_record_owner`. Configured folder writers are trusted participants; these checks do not claim cryptographic origin authentication before Quantum.

A dependency not yet delivered by the folder provider is pending, not corrupt. `L/received/pending/<machine>/<sequence>.json` holds `{packHash,dependencies,firstSeenAt}` and retries when any relevant head/object arrives or a watcher restarts. True hash/owner/length mismatches are errors. Related task+undo, text+history+proposal, create-unit+layout, and other multi-file commits carry one transactionId and index entry `{id,changeIds:UUID[]}`. They stay out of staging/projection while locally prepared; all their changes go in the same pack and are validated/journaled/applied as one group before checkpoint/events. The reader uses its own local transaction journal to recover interrupted groups, preventing a delivered task without its undo history.

Reserved future encrypted envelope is `{algorithm:"aes-256-gcm",keyId,nonce,tag}`, with a 12-byte random nonce and 16-byte tag encoded base64url. The complete index/blob payload is encrypted after compression, so paths and content are hidden. The authenticated additional data is UTF-8 `hivem1nd-pack-v1:<machine>:<sequence>:<keyId>`. One account key or team key is held outside synced files; member removal rotates the team key, account deletion removes its account key. Quantum credentials, provisioning, and transport are not implemented in 3.0; configuration requesting encryption or Quantum returns `422 unsupported_origin`, rather than silently sending unencrypted data. The reserved algorithm uses [Node crypto](https://nodejs.org/api/crypto.html); object compression uses [Node Brotli](https://nodejs.org/api/zlib.html#brotli-compression).

### 2.10. Pulse, conflict, and limits ledger

A new staged change starts a two-second quiet timer, with ten seconds maximum from the first change. At 80% of either rolling limit in section 7, quiet delay becomes four seconds and maximum delay 30 seconds. At a hard limit publication pauses until its `retryAt`; local work remains staged. No timer sends an empty pack. File-system watching of the origin machines directory and heads triggers reads; startup and watcher restart rescan. Incoming changes are not restaged as new local edits. An idle machine does not poll the origin; service beats remain as specified in 2.1.

Last-writer conflict order is `(at,machine,id)`, lexicographic after parsing UTC time; machine and UUID break equal-time ties. Future times more than 30 seconds ahead are rejected. A change whose `baseHash` does not match and whose content differs creates a sibling `<name>.conflict-<machine>-<YYYYMMDDTHHMMSSmmmZ>` for the losing bytes, followed by a master notice. Conflict copies are excluded from automatic staging unless explicitly adopted. For a deletion concurrent with an edit, the losing content is retained before deleting the original. An immutable ID with differing bytes is corruption, not a last-writer edit. Clock-based conflict resolution is an approved default, not a claim that clocks are perfectly synchronized.

`L/sync-versions.json` is `{format:"hivem1nd-sync-versions-v1",targets:{<sha256(canonical target JSON)>:{hash,at,machine,id,deleted}}}` and retains winner metadata even for tombstones. Initial files without metadata are staged once as local baseline changes. A local observer compares the new content Hash with that metadata and updates it before publication. Import validates all paths, objects, and conflicts before journaled application and checkpoint, so arrival order cannot replace a newer winner. A local unsynced edit is compared as a version, not silently overwritten. Mind records projected onto a OneDrive mind are applied by the service as in the plan; the origin's own packs remain single-writer even if OneDrive also transports that projection.

`L/sync-ledger.json` holds `{format:"hivem1nd-sync-ledger-v1",admitted:[{id,at}],outgoing:[{id,at,messages,bytes}],incoming:{<machine>:[{id,at,messages,bytes}]},applied:{<machine>:sequence}}`. Admission, publication, and receipt are separate counters with their own local times; publishing an admitted post does not charge admission twice. Windows expire independently and survive restart. Head sequence is advanced only after complete validation/application. Publication splits an offline backlog into packs of at most 60 logical messages and never sends a pack whose messages exceed the remaining publication window. An oversized-but-valid backlog waits for successive windows; receive pauses a pack until enough allowance exists. Byte-identical pack/head/service retries are charged once by digest/version, while every new heartbeat/head version is charged. Limits are enforced on publish and receive; a sender is never trusted merely because its head claims small counts. At the hard byte limit service beats also pause, making the machine honestly unavailable after expiry, and resume when allowance returns.

Media is converted on the sending machine to WebP/WebM through an installed ffmpeg before staging; if absent, original media is preserved. It is never a new npm dependency or a requirement for text operations. Account keys and media are not uploaded to a conversion server in 3.0.

## 3. HTTP service API

### 3.1. Transport, envelopes, lists, and schema notation

The local listener binds only `127.0.0.1`, default port 0. Routes below have prefix `/api/v1`; this prefix is distinct from the response contract version. Every protected request uses `Authorization: Bearer <token>`. JSON writes use `Content-Type: application/json`; no multipart or arbitrary binary write endpoint exists. A query/body marked `none` has no parameters/body; an empty mutation body is `{}`. All query keys not documented for that route are rejected. Path IDs are percent-encoded once; decoded slashes, backslashes, traversal, or double-encoded separators are invalid.

Success is `{contract:"hivem1nd-gui-v3",data:<value>,meta:{requestId,readAt,eventCursor,sync}}`. `sync` is `local`, `pending`, or `published`; success means the local operation is durable, not that a remote service has acted. Status is 200 unless the table specifies 201 (created), 202 (queued), or 204 (no body). No entity response is a raw filename to be parsed by the GUI.

Lists accept `q` (case-insensitive substring, at most 200 characters), `limit` (1 to 200, default 50), and `cursor` (opaque base64url, at most 1024 characters) wherever `List` is named. `List<T>` is `{items:T[],total:number,nextCursor:string|null,issues:Issue[]}`. Ordering is stated below, with ID as the final tie-breaker. The page cursor holds contract, filter hash, snapshot revision, and position; changed filters return `400 invalid_cursor`, changed snapshots `409 cursor_expired`. Detail reads are non-consuming. Missing fields are null, empty collections are empty arrays/objects as typed. `?` marks optional input; every other input key is required. Outputs permit additive unknown keys.

`Issue` is `{path:string|null,code:string,message:string}`. Bad individual files become issues while valid items remain readable; inaccessible mind root returns `503 mind_unavailable`. Old view reader limits are not silently inherited for chat/editor records. Legacy `hivem1nd-view-v1` remains unchanged for existing hosts; the service exposes the new projection below.

### 3.2. Public data objects

| Object | Required fields |
| --- | --- |
| `Unit` | `id:UnitId,unit:Name,role:<2.2 enum>,scope:Scope,leadId:UnitId\|null,job:string\|null,model:string\|null,machine:Name\|null,state:in\|out,status:unknown\|out\|quota\|waiting\|working\|idle,context:string,date:string\|null,branch:string\|null,revision:Revision\|null,sessionIds:UUID[],approvalGrants:Grant[],position:{x,y}\|null` |
| `Machine` | `id:Name,state:running\|stopped\|unknown,version:string\|null,heartbeatAt:Time\|null,answers:boolean,clients:[{id:string,enabled:boolean,installed:boolean\|null}],issues:Issue[]` |
| `Session` | `id:UUID,unitId:UnitId,client:string,machine:Name,nativeSessionId:string\|null,registeredAt:Time,activity:busy\|idle\|active\|inactive\|null,quota:{remaining:number\|null,exhausted:boolean}\|null,wake:{enabled:boolean,deadlineAt:Time\|null,pausedReason:string\|null},state:registered\|starting\|stopping\|stopped\|unknown` |
| `Squad` | `id:string,leadId:UnitId\|null,scope:Scope,members:UnitId[],rollup:{working,idle,waiting,out,attention}` with integer counters |
| `Project` | `id:Name,environment:Name\|null,title:string,unitIds:UnitId[],available:boolean,product:{stage:alpha\|beta\|release\|null,updated:string\|null,requirements:{alpha:{total,met},beta:{total,met},release:{total,met}}}\|null`; requirement values are nonnegative integers |
| `Chat` | `id:UUID,title:string,kind:direct\|group,members:UnitId[],pinned:boolean,listed:boolean,createdAt:Time,revision:Revision,lastMessage:Message\|null,unread:number` |
| `Message` | `id:MessageId,fromId:UnitId\|null,toId:string,machine:Name\|null,timestamp:Time\|null,date:string\|null,priority:normal\|urgent,subject:string,body:string,threadId:string,replyTo:MessageId\|null,replyRequested:boolean,attachments:Attachment[],kind:<2.4 enum>,read:boolean,notice:{resourceId:string,key:string}\|null` |
| `Grant` | `{id:UUID,action:string,pattern:<5 action shape>,grantedAt:Time,grantedBy:UnitId}` |
| `Approval` | request fields from 2.5 plus `state:pending\|answering\|approved\|denied\|expired,revision:Revision,answer:<2.5 answer>\|null,grantId:UUID\|null,answerOutcomes:<2.5 answer-result>[]` |
| `Task` | `id:TaskId,number:string,scope:Scope,title:string,status:open\|review\|done\|closed,fromId:UnitId\|null,toId:UnitId\|null,date:string\|null,requirements:string[],approvedBy:UnitId\|null,reviewable:boolean,revision:Revision,request:string,report:string,undoAvailable:boolean` |
| `Waiting` | `id:string,kind:approval\|review\|question\|message,unitId:UnitId\|null,title:string,since:string,chatId:UUID\|null,approvalId:UUID\|null,taskId:TaskId\|null,messageId:MessageId\|null,blocking:boolean` |
| `EditorSummary` | `id:ResourceId,kind:blueprint\|void,project:Name,title:string,path:string,readOnly:boolean,revision:Revision,attached:UnitId[],openThreads:number,activity:{unitId:UnitId,at:Time}\|null` |
| `Editor` | all `EditorSummary` fields plus `document:object\|null,legacy:null\|{id,path,reason:"conversion_required"},attachmentRevision:Revision\|null,commentsRevision:Revision\|null,threads:Thread[]` |
| `Thread` | fields from 2.8 plus `place:<2.8 derived anchor variant>\|null,revision:Revision,notifications:[{unitId:UnitId,state:pending\|submitted\|ambiguous\|failed}]` |
| `Proposal` | exactly the optional comment-message proposal fields in 2.8, plus `resourceId:ResourceId,threadId:ThreadId,commentsRevision:Revision` |
| `Asset` | `{id:string,src:string,contentType:string,bytes:integer,revision:Hash,url:string}`; url is an authenticated same-origin read path |

Unit status priority is unknown, out, quota, waiting, working, idle, as in the existing view; state-in alone does not imply working. Leads and squads come from state, never chat membership. `attention` counts quota and unknown. Waiting contains pending approvals, reviewable tasks, legacy person questions, and person mailbox messages asking for replies. Reviews retain lead gating. Legacy `Waiting on user:`/person aliases are accepted; new text says `Waiting on master:`. Waiting order is blocking first, newest since next; duplicate underlying items appear once. Active units precede idle/out in unit lists, then name. Machine lists sort by name; sessions newest first; tasks review, open, done, closed then date descending; chats pinned first then latest activity; editors project then title.

Missing legacy body/title/subject values project to empty strings; missing dates/unknown identities to null; other missing values use the documented defaults. A malformed state has null revision and unknown status, never an editable fabricated state. Squads use ID `lead:<UnitId>` or `loose:<scopeKind>:<scopeName-or-root>`. Waiting IDs are `approval:<id>`, `review:<TaskId>`, `message:<MessageId>`, or `question:<UnitId>:<sha256(question text)>`.

Search fields are units name/job/context; leads name/job; squads lead/member names; projects name/title; machines name; sessions unit/client/machine; chats title/member names; messages subject/body/sender; approvals display/action/unit; tasks number/title/report; waiting title/unit; editors title/project/path; grants action/canonical pattern JSON; mailboxes unit; threads message text/author/anchor label. Squads/projects/mailboxes sort by ID, approvals pending first then requestedAt descending, grants grantedAt descending, threads first-message time ascending; all use ID as final tie-breaker. Boolean queries are literal `true` or `false`; enum filters use the corresponding object's enum.

### 3.3. Mind, units, machines, sessions, and layout

| Method and path | Query | Body | Data and specific errors |
| --- | --- | --- | --- |
| `GET /view` | `project?:Name` | none | `{mind:{version,machine,project},units:Unit[],leads:UnitId[],squads:Squad[],projects:Project[],machines:Machine[],sessions:Session[],chats:Chat[],tasks:Task[],waiting:Waiting[],counts:object,issues:Issue[]}`; full bounded snapshot, `413 view_too_large` with instructions to use lists if over 16 MB |
| `GET /units` | List, `project?,machine?,leadId?,status?` | none | `List<Unit>` |
| `GET /units/:unitId` | none | none | `Unit`; `404 unit_not_found` |
| `GET /leads` | List, `project?` | none | `List<Unit>` for units referenced as leads, plus canonical Overseer |
| `GET /squads` | List, `project?,leadId?` | none | `List<Squad>` |
| `GET /projects` | List | none | `List<Project>` |
| `GET /machines` | List | none | `List<Machine>` |
| `GET /sessions` | List, `unitId?,machine?,state?` | none | `List<Session>` |
| `GET /sync` | none | none | `{state:idle\|pending\|publishing\|paused\|error,pendingChanges:integer,limits:Limits,incoming:[{machine:Name,limits:Limits}],retryAt:Time\|null,error:null\|{code,message}}` |
| `POST /units` | none | `{unit:Name,role:string,scope:Scope,machine:Name,leadId?:UnitId\|null,job?:string\|null,model?:string\|null,position?:{x,y}}` | 201 `Unit`; `409 unit_exists`, `409 machine_unavailable` with `{machine,heartbeatAt}`, `409 overseer_exists`, `422 invalid_lead` |
| `PUT /units/:unitId/lead` | none | `{leadId:UnitId\|null,confirmed:true,expectedRevision:Revision}` | updated `Unit`; target reports to source, `409 lead_cycle`, `422 invalid_lead`; master cannot have a lead |
| `POST /units/:unitId/session` | none | `{client:Client,prompt?:string\|null,expectedRevision:Revision}` | 202 `{requestId,state:"queued",expiresAt}`; `409 unit_in_use`, `409 machine_unavailable`, `422 client_unavailable`; model/job/lead/machine from unit state |
| `GET /session-requests/:requestId` | none | none | `{requestId,unitId,machine,state:queued\|starting\|started\|failed\|expired,sessionId,error,expiresAt}`; `404 request_not_found` |
| `POST /sessions/:sessionId/stop` | none | `{confirmed:true}` | 202 `{sessionId,state:"stopping"}`; local adapter only, `409 remote_session`, `409 stop_unavailable`; marks stopped only after native acknowledgment |
| `GET /layout` | none | none | `{layout:<2.7>,revision:Revision\|null}` |
| `PATCH /layout` | none | `{nodes?:{<UnitId>:{x,y}},groups?:{<groupId>:{x,y,collapsed}},expectedRevision:Revision\|null}` | `{layout,revision}`; at least one patch, `422 unknown_unit`, no deleting unrelated positions |

The view counts are `{units,leads,squads,projects,machines,sessions,chats,waiting,open,review,done,closed,unread,issues}`. All count integers are computed from the full projection, not a page. `project` filters project-scoped data plus the root/environment leads and shared person needed to show the chain. Unlisted chats stay out unless explicitly queried. No screen is named Sessions; session facts are available in the Map inspector. Unit creation checks the selected machine before any state/layout write. Multi-selection connects through one confirmed lead operation per target with independent conflict feedback. A group message uses chat creation, not those operations.

### 3.4. Chats, mailbox reads, approvals, and tasks

| Method and path | Query | Body | Data and specific errors |
| --- | --- | --- | --- |
| `GET /chats` | List, `unitId?,listed?:boolean` default true, `pinned?:boolean` | none | `List<Chat>`; `listed=false` permits reopening retained history |
| `POST /chats` | none | `{members:UnitId[],title?:string}` | 201 `Chat`, or 200 reused direct `Chat`; master is included automatically, two or more selected agents create a saved group; `422 invalid_members` |
| `GET /chats/:chatId` | none | none | `Chat`; `404 chat_not_found` |
| `GET /chats/:chatId/messages` | List, `before?:MessageId` | none | `List<Message>`; latest page returned chronologically, cursor walks older pages; before and cursor are mutually exclusive |
| `POST /chats/:chatId/messages` | none | `{body:string,subject?:string,replyTo?:MessageId\|null,attachments?:Attachment[],priority?:normal\|urgent}` | 201 `{message:Message,notifications:[{unitId,state}]}`; sender from credential, `403 not_chat_member`, `422 invalid_reply` |
| `POST /chats/:chatId/read` | none | `{messageIds:MessageId[]}` max 200 | `{chatId,readIds:MessageId[],unread:number}`; actual remaining unread count, later/late-arriving messages stay unread |
| `PATCH /chats/:chatId` | none | `{pinned?:boolean,listed?:boolean,expectedRevision:Revision}` | `Chat`; at least one field; unlist is `listed:false`, reopen is `listed:true` |
| `GET /mailboxes` | List | none | `List<{unitId,unread,total}>` |
| `GET /mailboxes/:unitId/messages` | List, `state?:unread\|read\|all` default unread | none | `List<Message>`, newest first; includes archive for read/all |
| `GET /mailboxes/:unitId/messages/:messageId` | none | none | `Message`, no archive side effect; `404 message_not_found` |
| `POST /mailboxes/:unitId/messages` | none | same message body as chat post, plus `replyRequested?:boolean` | 201 `Message`; mailbox delivery works for an offline unit |
| `POST /mailboxes/:unitId/read` | none | `{messageIds:MessageId[]}` max 200 | `{unitId,readIds:MessageId[],alreadyReadIds:MessageId[]}`; `409 archive_collision`; validates all IDs before archiving |
| `GET /approvals` | List, `unitId?,state?` default pending | none | `List<Approval>` |
| `GET /approvals/:approvalId` | none | none | `Approval` |
| `POST /approvals/request` | none | `{action:string,pattern:object,display:string,chatId?:UUID,alwaysAllowed:boolean}` | 202 `Approval`; agent/hook credential only, identity from binding; `422 unsupported_action`, native fallback on failure |
| `POST /approvals/:approvalId/answer` | none | `{decision:approve\|approve-always\|deny,expectedRevision:Revision}` | 202 or 200 `{approval:Approval,answerId:UUID}`; queued or locally resolved; `409 approval_resolved`, `410 approval_expired`, `422 always_unavailable` |
| `GET /approvals/:approvalId/answers/:answerId` | none | none | `{answerId,approvalId,state:queued\|applied\|rejected\|expired,resultAnswerId:UUID\|null,at:Time\|null}` |
| `GET /units/:unitId/approval-grants` | List | none | `List<Grant>` |
| `DELETE /units/:unitId/approval-grants/:grantId` | none | `{expectedRevision:Revision}` | 202 remote/200 local `{requestId,unitId,grantId,state:pending\|revoked,revision:Revision\|null}`; `404 grant_not_found`; deletion body is JSON |
| `GET /grant-revocations/:requestId` | none | none | same revocation result, pending until owner result |
| `GET /tasks` | List, `project?,unitId?,status?` default open/review/done | none | `List<Task>`; status may be a comma-separated subset including closed |
| `GET /tasks/:taskId` | none | none | `Task`; `404 task_not_found` |
| `POST /tasks/:taskId/status` | none | `{status:open\|review\|done\|closed,note?:string,expectedRevision:Revision}` | `{task:Task,changeId:UUID}`; unchanged status `409 status_unchanged`, `409 review_not_ready`, `422 note_required` |
| `POST /tasks/:taskId/undo` | none | `{expectedRevision:Revision}` | `{task:Task,changeId:UUID,undoOf:UUID}`; `409 nothing_to_undo`, `409 undo_conflict` |
| `GET /waiting` | List, `unitId?,kind?` | none | `List<Waiting>` |

Chat read receipts are immutable `P/relay/chats/<chatId>/read/<base64url(UnitId)>/<machine>/<receiptId>.json`: `{"format":"hivem1nd-chat-read-v1","chatId":"0efb1be7-b006-476d-b0f6-4629d217ab82","unitId":"root:master","machine":"LAPTOP","messageIds":["69c03b50-819b-42be-b5f9-6a11809647a8"],"at":"2026-10-10T12:01:00.000Z"}`. Only the explicit acknowledged IDs are read; a late message with an older timestamp remains unread. Reading the person's chat does not archive an agent's mailbox notice. The GUI marks reads explicitly after content is visible. Agent read operations acknowledge only their own membership/mailbox; desktop master can inspect and explicitly read any mailbox. Phone uses only master's read acknowledgments.

Chat page ordering is `(timestamp-or-date,id)`; no timestamp means it sorts first. `before` excludes that message and all newer messages. Select the newest `limit` matches within that range, then return them chronologically. nextCursor walks toward older messages without overlap. total counts all matches for filters before pagination (and before the optional before boundary), including read messages. A new snapshot invalidates old cursors as specified above. Reply IDs must exist in the same chat/mailbox thread.

### 3.5. Settings and home network

| Method and path | Query | Body | Data and specific errors |
| --- | --- | --- | --- |
| `GET /settings` | none | none | `{settings:<2.7>,revision,service:{machine,version,originKind,syncState},home:HomeStatus}`; phone response omits opening key/code/link |
| `PATCH /settings` | none | `{look?:modern\|high-contrast,language?:en\|es,expectedRevision:Revision\|null}` | `{settings,revision}`; at least one setting |
| `POST /settings/home-network` | none | `{enabled:true,addresses?:string[]}` or `{enabled:false}` | enabled: 201 `HomeGrant`; disabled: 200 `HomeStatus`; desktop only, `422 invalid_home_address`, `503 listener_unavailable`; re-enable revokes previous grant |
| `POST /auth/home` | none | exactly `{key:string}` or `{code:string}` | `{token:string,audience:"phone",expiresAt:Time,capabilities:string[]}`; public exchange on LAN listener only; `401 invalid_home_key`, `410 home_expired`, `429 auth_rate_limited` |
| `POST /auth/local` | none | `{embedded:boolean,hostOrigin:string\|null,look:modern\|high-contrast\|null,language:en\|es\|null}` | 201 `{token,viewerId,origin,url,capabilities,expiresAt:null}`; loopback-only bootstrap-secret bearer, `401 invalid_bootstrap`, `422 invalid_host_origin` |
| `POST /auth/logout` | none | `{}` | 204; revokes the calling viewer/phone credential and its Watch state without stopping service |

`HomeStatus` is `{enabled:boolean,openedAt:Time|null,expiresAt:Time|null,addresses:[{origin:string}],remainingSeconds:number}`. `HomeGrant` adds `{key:string,shortCode:string,links:[string],qrPayloads:[string]}`. A key is 32 random bytes in base64url. A short code is six random characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, case-insensitive on entry. Each link and QR payload is the exact string `http://<selected-IP>:<actual-port>/#home=<key>`; QR encodes that UTF-8 URL through the kit's own encoder. Browser removes the fragment immediately after reading it and does not send the key in query strings, referrers, or logs. Code entry begins at that listener's `/` page.

Home access closes at `openedAt + 12 hours`, explicit disable, re-enable, or service restart. Exchange does not extend it. Phone tokens expire at the same instant and are revoked when the grant closes. Home status and expiry countdown require no polling after SSE subscription. Failure to bind any requested address leaves no active partial grant and returns an error.

### 3.6. Blueprint, Void, comments, and Watch

Both editor namespaces use ResourceId, not filesystem paths. Listed data operations are independently authenticated and revision checked. `GET` is never a consuming read. View and Focus are browser modes over the same Void document, with no separate document or mutation API.

| Method and path | Query | Body | Data and specific errors |
| --- | --- | --- | --- |
| `GET /blueprint/boards` | List, `project?` | none | `List<EditorSummary>` |
| `POST /editors/register` | none | `{kind:blueprint\|void,project:Name,path:string}` | 201 `Editor` or 200 existing registration; desktop only, `404 resource_not_found`, `422 invalid_path`; records existing JSON/legacy module without creating content |
| `POST /blueprint/boards` | none | `{project:Name,path?:string,document:<2.8 board>,attached?:UnitId[]}` | 201 `Editor`; default path from document id, `409 resource_exists`, `422 invalid_document` |
| `GET /blueprint/boards/:resourceId` | none | none | `Editor`; `409 corrupt_resource` |
| `PUT /blueprint/boards/:resourceId` | none | `{document:object,expectedRevision:Revision}` | `Editor`; `409 unsupported_fields_lost`, `409 read_only_resource` |
| `POST /blueprint/boards/:resourceId/nodes` | none | `{screenId:string,parentId:string,index?:integer,node:Node,expectedRevision:Revision}` | `{editor:Editor,nodeId:string}`; parent must be a box, index 0 through kids length, default append, `409 node_exists`, `422 invalid_parent` |
| `PATCH /blueprint/boards/:resourceId/nodes/:nodeId` | none | `{changes:object,expectedRevision:Revision}` | `Editor`; ID/type cannot change, `404 node_not_found`, `422 invalid_node` |
| `DELETE /blueprint/boards/:resourceId/nodes/:nodeId` | none | `{expectedRevision:Revision}` | `Editor`; root cannot be removed, `422 root_node`; descendant/link references removed atomically |
| `GET /void/texts` | List, `project?` | none | `List<EditorSummary>` |
| `POST /void/texts` | none | `{project:Name,path:string,document:<2.8 text>,attached?:UnitId[]}` | 201 `Editor`; creates orig once, `409 resource_exists` |
| `GET /void/texts/:resourceId` | none | none | `Editor` |
| `PUT /void/texts/:resourceId` | none | `{document:object,expectedRevision:Revision}` | `Editor`; numeric rev/history maintained by core, caller cannot forge them |
| `POST /void/texts/:resourceId/ranges` | none | `{k:string,lang:string,start:integer,end:integer,expectedText:string,replacement:string,expectedRevision:Revision,mode?:apply\|propose,threadId?:ThreadId,expectedCommentsRevision?:Revision}` | `{editor:Editor,proposal:Proposal\|null}`; apply is default; propose requires a thread and comments revision; source offsets half-open UTF-16, no split surrogate pairs/tags; `409 range_changed`, `422 invalid_range` |
| `GET /void/texts/:resourceId/proposals` | List, `state?:pending\|accepted\|discarded` default pending | none | `List<Proposal>` |
| `POST /void/texts/:resourceId/proposals/:proposalId/answer` | none | `{decision:accept\|discard,expectedRevision:Revision,expectedCommentsRevision:Revision}` | `{editor:Editor,proposal:Proposal}`; desktop only, `409 proposal_stale`, `409 proposal_resolved` |
| `GET /editors/:resourceId/attachments` | none | none | `{attached:UnitId[],revision:Revision\|null}` |
| `PUT /editors/:resourceId/attachments` | none | `{attached:UnitId[],expectedRevision:Revision\|null}` | `{attached,revision}`; `422 unknown_unit` |
| `GET /editors/:resourceId/comments` | List, `status?:open\|resolved\|all` default all | none | `List<Thread>` plus `commentsRevision` |
| `POST /editors/:resourceId/comments` | none | `{anchor:object,text:string,expectedRevision:Revision,expectedCommentsRevision:Revision\|null}` | 201 `{thread:Thread,commentsRevision}`; anchor from 2.8, `409 anchor_changed` |
| `POST /editors/:resourceId/comments/:threadId/replies` | none | `{text:string,expectedCommentsRevision:Revision}` | `{thread,commentsRevision}`; reopens resolved, `404 thread_not_found` |
| `PATCH /editors/:resourceId/comments/:threadId` | none | `{status:open\|resolved,expectedCommentsRevision:Revision}` | `{thread,commentsRevision}` |
| `GET /editors/:resourceId/assets/:assetId` | none | none | 200 verified image bytes with Content-Type, ETag Hash, no-store; errors use JSON; `404 asset_not_found`, `422 invalid_asset` |
| `POST /editors/:resourceId/assets` | none | `{contentType:image/png\|image/jpeg\|image/webp,bytesBase64:string}` | 201 `Asset`; desktop only; decoded limit 10 MB, signature checked, `413 asset_too_large`, `422 invalid_asset` |
| `POST /watch` | none | `{unitId:UnitId,resourceId?:ResourceId,chatId?:UUID}` | `{watchId:UUID,state:waiting\|watching,unitId,resourceId:ResourceId\|null}`; viewer-local, `403 not_attached`, `422 invalid_chat_member` if a supplied chat does not contain that unit |
| `DELETE /watch/:watchId` | none | `{}` | 204; ends display following, not agent work |

Comment body is plain text. Creating/replying requires nonblank text of at most 10000 characters. Human comment identity is master; MCP identity is the bound unit. Desktop can change attachments; agents can edit/reply only on attached resources. Unplaced threads can still be replied to/resolved. The core resolves and validates both text and comments revisions before creating a thread; reply/resolution checks the sidecar's revision. Void range offsets deliberately differ from rendered comment-anchor offsets; the GUI/MCP open response provides original strings for editing and derived placements for comments.

New assets use random UUID filenames with the verified stored extension under the project's `docs/flows/assets/`; Asset.src is that relative assets reference. Existing local assets referenced by a registered resource remain readable through this route. Only registered/referenced assets within that namespace are served or synced. The browser fetches with its bearer and uses an object URL; a raw image tag cannot bypass authentication. A present ffmpeg converts new PNG/JPEG to WebP before the response/staging; otherwise the original verified type is retained. Asset routes accept no executable HTML/SVG. Upload body cap is 16 MB including base64 overhead.

Watch is off by default and never gates persistence/events. It follows the chosen unit's most recent `editor.activity` by `(at,resourceId)`; explicit resourceId wins and requires that unit to be attached. If no activity within 15 minutes exists, it waits. Detachment/session stop clears that activity; a service restart clears Watch and activity. Each viewer token owns its Watch records and receives only its own watch events; reconnect within that viewer's lifetime retains following, logout/handle stop removes it. Watch on a node/chat sends this request; `watch.changed` opens the correct Blueprint/Void mode and marks Watching plus unit identity. `editor.activity` supplies focused screen/node or text range, so the viewer can pan/highlight each committed step. Turning Watch off stops automatic focus; the current editor remains usable. Mouse movement restores Void's tools in Focus, arrow keys navigate text, Escape returns to Document; these are GUI behavior, not separate service commands.

## 4. Server-sent events

`GET /api/v1/events` accepts `unitId?`, `chatId?`, and `resourceId?` filters, and `Last-Event-ID` header. Filters are ANDed where an event has those fields; global service/settings/sync/reset events always pass. Auth uses fetch streaming with Authorization, not a query token. Response is `text/event-stream`, `Cache-Control:no-store`, `X-Accel-Buffering:no`; a `: keepalive` comment is sent every 15 seconds and is not an origin poll.

Event ID is `<service-start-UUID>:<increasing-integer>`. Each event has `event:<name>` and one JSON `data` line containing `{contract:"hivem1nd-events-v3",at:Time,machine:Name,source:Source,data:<payload>}`. The SSE id is the replay cursor, distinct from resource revision. Local commits, validated imports, and runtime state changes emit events once; retries/unchanged reads emit none. Imported changes use `source.kind:"sync"`. Related record writes complete before an event is sent. Phone receives only payloads permitted by section 6, never native endpoints, keys, or token-bearing receipts.

| Event | Payload | Fires when |
| --- | --- | --- |
| `stream.ready` | `{cursor,readAt,capabilities}` | subscription accepted; no mutation |
| `stream.reset` | `{reason:"cursor_expired"\|"service_restarted",cursor}` | replay unavailable; client refetches view and open resources before applying later events |
| `service.changed` | `{machine:Machine}` | start/stop/new service beat or answers changes at three-minute expiry |
| `unit.changed` | `{unit:Unit}` | create, lead, state, or approval-grant change |
| `view.changed` | `{revision:Hash,collections:string[]}` | a change affects derived lists/counts/legacy waiting; refetch affected lists |
| `session.changed` | `{session:Session}` | registration, activity, quota, wake, or confirmed stop |
| `session.request.changed` | `{requestId,unitId,machine,state,sessionId,error}` | request queued or target result/expiry changes |
| `chat.changed` | `{chat:Chat}` | create, pin, list/unlist, or last-message/unread change |
| `message.created` | `{chatId:UUID\|null,mailboxId:UnitId\|null,message:Message}` | a durable message or notice is committed; exactly one destination field is nonnull |
| `message.read` | `{chatId:UUID\|null,mailboxId:UnitId\|null,readerId:UnitId,messageIds:MessageId[],unread:number}` | explicit read receipt changes unread |
| `notification.changed` | `{noticeKey,unitId,resourceId,state:pending\|submitted\|ambiguous\|failed,error:null\|{code,message}}` | deterministic fanout/wake submission state changes |
| `approval.requested` | `{approval:Approval}` | gated request created, including automatic grant resolution |
| `approval.answered` | `{approval:Approval}` | answer queued, resolved, denied, or timeout |
| `approval.grant.changed` | `{unitId,grantId,operation:granted\|revoked,revision}` | unit-scoped always policy changes |
| `task.changed` | `{task:Task,changeId:UUID\|null,undoOf:UUID\|null}` | committed status/undo or external task edit; external edits have null changeId |
| `layout.changed` | `{layout:object,revision}` | Map positions/groups committed/imported |
| `settings.changed` | `{settings:object,revision}` | look/language committed/imported |
| `home.changed` | `{home:HomeStatus,reason:opened\|closed\|expired\|replaced}` | grant changes; never contains key/code |
| `blueprint.changed` | `{resourceId,revision,operation:create\|replace\|add-node\|update-node\|remove-node\|import,nodeId:string\|null}` | board commit/import; client fetches latest full board |
| `void.changed` | `{resourceId,revision,rev,operation:create\|replace\|replace-range\|import,k:string\|null,lang:string\|null}` | text commit/import with history durable |
| `editor.attachments.changed` | `{resourceId,attached:UnitId[],revision}` | binding changes |
| `comment.changed` | `{resourceId,thread:Thread\|null,commentsRevision,operation:create\|reply\|resolve\|reopen\|import}` | comment sidecar commit/import; import uses null thread and forces full refetch, including removed threads |
| `void.proposal.changed` | `{resourceId,proposal:Proposal,commentsRevision}` | pending suggestion saved, accepted with history, or discarded |
| `editor.asset.created` | `{resourceId,asset:Asset}` | verified asset committed/imported |
| `viewer.changed` | `{viewerId,embedded,hostOrigin,look,language,dirty}` | transient presentation/draft state changes, sent only to that viewer |
| `editor.activity` | `{resourceId,kind:blueprint\|void,unitId,at,focus:{screenId,nodeId}\|{k,lang,start,end}\|null}` | attached MCP open or successful edit/reply; focus shows the latest committed step |
| `watch.changed` | `{watchId,unitId,resourceId,state:waiting\|watching\|stopped}` | requester starts/stops following or active resource changes; only its authenticated viewer receives it |
| `sync.changed` | `{state:idle\|pending\|publishing\|paused\|error,pendingChanges,limits:Limits,retryAt:Time\|null,error:null\|{code,message}}` | staging, pulse, limit, or validation state changes |
| `sync.conflict` | `{target:object,winnerMachine,copyPath,at}` | losing bytes preserved and master notice queued |
| `issue.changed` | `{issue:Issue,resolved:boolean}` | malformed/inaccessible record issue appears or clears |

The replay ring retains up to 1000 events for at most ten minutes, scoped to principal visibility. Replay never returns another viewer's Watch/presentation events. An unknown/old cursor sends reset followed by ready; a current cursor replays newer permitted events followed by ready. Clients buffer live events while fetching a snapshot. `meta.eventCursor` is captured before reading snapshot files, never after asynchronous reads; events after that cursor are retained/replayed even when a concurrent change is already reflected in the snapshot. The client applies buffered events newer than that cursor, treats equal revisions as duplicates, and refetches latest on a differing revision. SHA revisions have no ordering. Watch may fetch the latest committed state when steps arrive faster than rendering; it never invents an uncommitted cursor animation. Disconnect does not undo work. Expired/revoked credentials close their streams, and reconnect returns 401/410.

## 5. MCP tools and hook interface

The Relay service exposes local `POST /mcp` using JSON-RPC 2.0 and [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), protocol version `2025-03-26`. `initialize` returns `{protocolVersion,capabilities:{tools:{listChanged:false}},serverInfo:{name:"hivem1nd-relay",version:"3.0.0"}}`; `notifications/initialized` returns HTTP 202, `ping` returns `{}`, `tools/list` returns the schemas below. POST Accept contains `application/json` and `text/event-stream`; this server responds with JSON for calls, 202 for notifications. GET `/mcp` returns 405 with `Allow:POST`; GUI SSE remains a separate stream. No MCP session ID is issued; the bearer binds the native session. Unsupported protocol versions fail initialization. The existing CLI stdio adapter remains supported and forwards the same operations, without creating another wake worker.

An agent capability is generated locally for a verified native registration and held in process memory; it binds unitId/sessionId, allowed attached resources, and the existing wake deadline. It is not the person's desktop token. Identity cannot be supplied or changed through tool arguments. Host and Origin checks in section 6 apply; local stdio forwarding supplies the exact service Origin. New HTTP editor tools do not give agents access to unit creation, home-network settings, person approvals, or arbitrary file paths. Existing Relay tools remain available through their existing names/schemas; an agent chat post must include its chat destination and replies stay in that chat.

For each tool, `inputSchema` is JSON Schema `{type:"object",additionalProperties:false,properties:<listed typed fields>,required:<all without ?>}`. String IDs are the types in section 1, nonnegative integer offsets are half-open UTF-16, `revision` is a Hash, and schemas supply the limits in section 7. Board/node/document inputs accept bounded unknown properties as specified in 2.8. `requestId:UUID` is required on every mutating tool and maps to Idempotency-Key; read tools omit it.

| Tool name | Input properties | Output value and events |
| --- | --- | --- |
| `blueprint_open` | `{resourceId:ResourceId}` | `Editor`; `editor.activity` with null focus |
| `blueprint_add_node` | `{resourceId,screenId:string,parentId:string,index?:integer,node:Node,expectedRevision:Revision,requestId:UUID}` | `{editor,nodeId}`; `blueprint.changed`, `editor.activity` |
| `blueprint_update_node` | `{resourceId,nodeId:string,changes:object,expectedRevision:Revision,requestId:UUID}` | `Editor`; `blueprint.changed`, `editor.activity` |
| `blueprint_remove_node` | `{resourceId,nodeId:string,expectedRevision:Revision,requestId:UUID}` | `Editor`; `blueprint.changed`, `editor.activity` |
| `blueprint_reply_comment` | `{resourceId,threadId:ThreadId,text:string,expectedCommentsRevision:Revision,requestId:UUID}` | `{thread,commentsRevision}`; `comment.changed`, `notification.changed`, `editor.activity` |
| `void_open` | `{resourceId:ResourceId}` | `Editor`; `editor.activity` with null focus |
| `void_replace_range` | `{resourceId,k:string,lang:string,start:integer,end:integer,expectedText:string,replacement:string,expectedRevision:Revision,mode?:apply\|propose,threadId?:ThreadId,expectedCommentsRevision?:Revision,requestId:UUID}` | `{editor,proposal}`; apply emits `void.changed`, propose emits `comment.changed` and `void.proposal.changed`; both emit `editor.activity` |
| `void_reply_comment` | `{resourceId,threadId:ThreadId,text:string,expectedCommentsRevision:Revision,requestId:UUID}` | `{thread,commentsRevision}`; `comment.changed`, `notification.changed`, `editor.activity` |

Tool success returns `{content:[{type:"text",text:<JSON string of {contract:"hivem1nd-gui-v3",data:value}>}],isError:false}`. Domain failure returns `{content:[{type:"text",text:<JSON string of error envelope>}],isError:true}` without modifying resources. Protocol failures use JSON-RPC `-32700` parse error, `-32600` invalid request, `-32601` unknown method/tool, or `-32602` invalid schema; error data holds the common API code/details. HTTP authentication fails before JSON-RPC execution. A read-only open emits activity only after checking attachment authority; it writes no document.

Watch is requested by the person through `/watch`; there is no agent tool that opens the person's screen. Every successful tool change emits its resource event even with Watch off. Derived `view.changed`, `chat.changed`, and `message.created` fire as relevant when notices alter those projections. Agent replies use the credential-bound author, so an arbitrary `author`/`from` argument is rejected.

Explicit assigned writing applies changes with mode apply. A suggested revision in response to a person comment uses mode propose, creating a comment reply with the proposal and Accept change/Discard controls; Watch does not implicitly grant permission to accept it. The original request/body remains the source of authority. No proposal is accepted by an agent token.

The hook calls `/approvals/request` with its agent credential and normalized action, then listens to approval SSE or polls the single approval detail while waiting at most two minutes. Native clients without a usable hook explicitly fall back to their own prompt. A service failure/expiry is not an allow response. Known actions are `process.run` with exact `{command,cwd}`, `file.write` with `{resource,path}`, and `network.request` with `{method,origin,path}`; adapters refuse persistent approval for any normalization they cannot make exact. No action on one unit confers authority on another.

## 6. Authentication, network checks, and embedding

### 6.1. Exact checks and credential audiences

Each desktop viewer has its own session token and viewerId, created by `/api/v1/auth/local` after the owner-only bootstrap secret authenticates the exact loopback request. Both token and viewerId are bound in memory; the token is 32 random bytes base64url, compared in constant time, and expires on viewer logout/stop or service restart. The URL is `/gui/<viewerId>/#session=<token>`, with the fragment immediately removed. The token stays in memory, not localStorage, cookies, configuration, origin, or logs. The viewer's own token identifies Watch/overrides without a caller-supplied viewer header. There is no unauthenticated endpoint that returns it.

Every request, including static assets and MCP, checks its listener's actual bound authority. Local socket remote address must be exactly `127.0.0.1` or `::ffff:127.0.0.1`; Host must be exactly `127.0.0.1:<port>`, including the actual port; Origin, if present, must be exactly `http://127.0.0.1:<port>`. Protected writes require that Origin even for native local callers. `localhost`, other 127 addresses, IPv6 loopback, user-info, trailing dots, suffix matches, forwarded host/proto overrides, and wildcard origins are not accepted. Invalid Host returns 400; invalid socket/Origin returns 403. Forwarded headers never expand trust. CORS is disabled; cross-origin OPTIONS is rejected.

Home listeners bind only selected non-internal private IPv4 addresses from the machine's interfaces (10/8, 172.16/12, 192.168/16), each with its actual allocated port, never `0.0.0.0`. Remote peers must belong to that interface's IPv4 subnet. Host is that literal `<IP>:<port>`, and supplied Origin is exactly `http://<IP>:<port>`; writes and home exchange require that Origin. Subnet checks use the interface netmask, not a hostname or proxy header. No WAN port forwarding or automatic router configuration is requested. Selected interface loss closes its listener and revokes affected phone credentials.

Public GET/HEAD `/`, `/gui/<viewerId>/`, and allowlisted packaged assets contain only the static application shell; `/api/v1/auth/home` is the sole public credential exchange. `/api/v1/auth/local` instead requires the local bootstrap-secret bearer. These bootstrap exceptions carry no mind data. All other routes, including read APIs, events, and MCP, require a session bearer. No token is accepted in query parameters. Static HTML has `Referrer-Policy:no-referrer`, no external scripts, `X-Content-Type-Options:nosniff`, CSP `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'`, and no-store caching. Uploaded editor content is rendered as data, never scripts. A viewer route sets only that viewer's frame-ancestors value; it never broadens the entire service's framing policy.

Credential audience is enforced server-side, regardless of viewport or user agent. Full desktop/agent credentials are rejected on LAN listeners. A phone credential cannot obtain full authority by reaching the local listener, changing Origin, or supplying a role/body sender. Agent credentials are accepted only on the local listener for their bound tools/hooks/own messaging. Tokens, home keys, short codes, and native endpoints are redacted from logs and errors.

Agent HTTP allowlist is `/mcp`; bound-unit/session `POST /approvals/request`; own-unit session/approval detail and own-unit filtered events; list/detail/read/post for chats containing the bound unit; own mailbox list/detail/read plus post to an existing recipient; assigned task delivery or current-lead review under 2.6; and read/document/node/range/comment operations for currently attached editor resources. It excludes settings, home auth, viewer controls, grant decisions/revocation, units/lead/layout writes, session launch/stop, catalog creation/registration, attachment PUT, asset upload, proposal answers, and Watch. Attachment/membership checks run on every call, not only token issuance. General mind/foreign mailbox reads are master-only. Audience visibility is applied before SSE query filters or global-event exceptions; an agent stream never receives another unit's session/approval or an unattached resource. Native adapter registration authenticates the genuine local session binding through its existing process transport; it cannot claim a new unit by an arbitrary HTTP argument.

### 6.2. Phone capability allowlist

Phone can read `/view`, all collection/detail GET routes, settings without secrets, and events with sensitive session internals removed. It can post messages in an existing chat, post a mailbox message as master, acknowledge master's reads, answer an existing approval including Approve always for that unit/action, and change a **reviewable** task from `review` to `done` or `open` with the required note. It can log out. Missing direct conversations are opened by desktop or the service's approval flow; phone does not create a new group/conversation record.

Every other write is `403 phone_read_only`: unit creation/connection, session start/stop, layout, settings, home enable/disable, chat creation/pin/unlist, grant revocation, undo, other task transitions, documents, comments, attachments, resource registration, Watch, and MCP. Approval always is the explicit approved exception that records a unit grant. Accept and Send back are the explicit task exceptions. Read of any agent mailbox is allowed, but phone cannot mark an agent's mail read. The UI exposes Hierarchy, Chats, Waiting and an optional read-only Map; server permission does not depend on hidden buttons.

Home exchange limits are five failed attempts per peer per rolling minute and 30 across the grant per minute; exceeding either returns `429 auth_rate_limited` with Retry-After. Correct key/code exchange still requires the listener/socket/Origin checks. `capabilities` is exactly `["read","chat.post","master.read","approval.answer","task.accept","task.send-back"]`; desktop receives its broader API capabilities. These values also arrive with `stream.ready`.

### 6.3. Host entry `hivem1nd/gui`

The package adds `exports["./gui"] = "./gui/index.mjs"`. Named export:

```js
startGui({ mindPath, embedded = false, hostOrigin = null, look = null, language = null })
// Promise<{ origin, url, token, viewerId, embedded, capabilities, setTheme, setLanguage, isDirty, stop }>
```

`mindPath` is a required resolved directory; the host already knows its mind. The entry attaches to the same user's existing service for that mind/machine or starts `hivem1nd service run` once under the global per-user lock. It reads L/bootstrap.json and calls `/auth/local` with the exact Origin, bootstrap-secret bearer, and supplied embed/presentation values. It starts the GUI, API, events, origin watcher, pulse, wake policies, and local MCP in that shared service; it does not start a second per-host worker or Electron. A missing/unconfigured mind returns `mind_not_configured` with no automatic installation or discovery; a different active mind returns service_mind_conflict. The installer/setup wizard remains a separate flow and eventually opens this GUI URL.

`origin`, `url`, `token`, and `viewerId` describe the exact loopback endpoint and isolated desktop viewer credential; `embedded` echoes the argument. `look` is null or `modern|high-contrast`, and `language` null or `en|es`. `setTheme(look)` and `setLanguage(language)` return Promise<void> and call that viewer's transient PATCH below; persistent settings use `/settings`. `isDirty()` returns the last observed boolean for this viewer's uncommitted editor form/draft state, false before mount, maintained by its event stream. `stop()` is idempotent, returns Promise<void>, logs out that viewer, closes its streams, and releases its handle; the login service continues for other hosts and agents.

Desktop capabilities are exactly `["read","chat.post","chat.manage","mailbox.read","approval.answer","grant.revoke","task.status","task.undo","unit.create","unit.connect","session.start","session.stop","layout.write","settings.write","home.manage","editor.read","editor.write","comment.write","proposal.answer","asset.write","watch","viewer.write"]`.

| Method and path | Query | Body | Data and errors |
| --- | --- | --- | --- |
| `GET /api/v1/viewer` | none | none | `{viewerId,embedded,hostOrigin,look,language,dirty}`; credential-bound viewer only |
| `PATCH /api/v1/viewer` | none | `{look?:modern\|high-contrast\|null,language?:en\|es\|null,dirty?:boolean}` | same viewer object; ephemeral, no expectedRevision; at least one key; 403 for non-desktop tokens |

Embedding uses an iframe with the returned fragment URL. `hostOrigin` is null or one exact `http:`/`https:` origin; embedded true requires a nonnull hostOrigin. It changes that viewer route's CSP `frame-ancestors` to that exact value, omits X-Frame-Options DENY for that route, and registers a viewer channel, never an API Origin/CORS exception. Messages use `{contract:"hivem1nd-embed-v1",viewerId,type:"ready"|"dirty"|"set-look"|"set-language"|"close",value}`; origin and source window are checked in both directions. Ready returns `{viewerId,capabilities}`, dirty is boolean, set-look/language carry the enums, close has null value. The iframe posts ready/dirty to its exact parent origin; accepted parent presentation messages call its own viewer PATCH, and close calls logout. Core handle methods use HTTP/SSE and require no access to a browser window. No filesystem/native session credentials are sent through postMessage. Nonembedded viewers use frame-ancestors none and X-Frame-Options DENY.

## 7. Errors and limits

```json
{
  "error": {
    "code": "machine_unavailable", "message": "The selected machine does not answer.",
    "requestId": "2992787c-7ef5-4f24-ad6d-8a083826d4a6",
    "details": {"machine":"DESKTOP","heartbeatAt":null}, "retryAt": null
  }
}
```

All API errors have `code`, safe professional `message`, UUID `requestId`, object `details` (empty if unnecessary), and `retryAt:Time|null`. No stack traces, arbitrary local paths, keys, or tokens are exposed. Messages may be localized; codes and structured details are stable. Global errors apply to every route in addition to the table's specific errors:

| Status | Codes and meaning |
| --- | --- |
| 400 | `invalid_json`, `invalid_body`, `unknown_field`, `invalid_query`, `invalid_cursor`, `invalid_host`, `invalid_path` |
| 401 | `invalid_session`, missing/invalid/revoked token |
| 403 | `invalid_origin`, `loopback_only`, `peer_not_allowed`, `forbidden`, `phone_read_only`, `not_attached` |
| 404 | `not_found` or the named missing resource |
| 405 | `method_not_allowed`, with exact Allow methods |
| 409 | `revision_conflict` and the operation's state/identity conflicts |
| 410 | `home_expired`, `approval_expired`, expired one-time capability |
| 413 | `body_too_large`, `message_too_large`, `view_too_large`, `resource_too_large`, `pack_too_large` |
| 414/415 | `uri_too_long` / `unsupported_media_type` |
| 422 | valid JSON that violates an operation's schema or scope |
| 429 | `message_rate_limited`, `sync_rate_limited`, `auth_rate_limited`, or `request_rate_limited`, with Retry-After seconds |
| 500/503 | `internal_error` / `service_unavailable`, `mind_unavailable`, or an unavailable required adapter |

`Limits` is `{messages:{used,max:60,windowSeconds:60},messageBytes:{max:1000000},syncBytes:{used,max:50000000,windowSeconds:3600},state:normal|slowing|paused,retryAt:Time|null}`. MB is decimal. The message cap covers the complete UTF-8 stored record, including headers/body/attachment references; HTTP JSON escaping is separately bounded. The legacy 256 KiB body limit is superseded by this total cap for 3.0. Sixty logical user/agent messages per machine in a rolling minute includes preloaded prompts and comments delivered through Relay; deterministic notices for one post do not multiply that count. The 61st post returns 429 before writing a message/notice. A 1,000,001-byte message returns 413, never a truncated success.

The 50,000,000-byte rolling hourly charge covers transmitted pack file bytes including framing, plus heartbeat/head bytes; each receiving machine independently charges the publisher at receipt before import. Decompression/validation limits apply even for a tiny compressed payload. Publication that would exceed the window returns/announces paused state and retryAt and keeps local staging; receive pauses that machine's offending pack, never partially applies it. API message writes blocked by rate limits return 429 with details `{machine,limits}`; other durable local edits may succeed with `meta.sync:"pending"` and Limits shown by sync events. One notice per limit window reaches master's mailbox, exempt from recursive message charging, and includes the window and retry time. No account-wide paid-server limit is invented for the folder-only release.

Limits.messages.used in GET /sync and sync.changed is the outgoing publication counter; each incoming entry uses that publisher's receipt counter. A message-admission 429 uses admitted usage and adds `details.phase:"admission"`; publication/receipt errors use `phase:"publication"|"receipt"`. Message counts are derived from verified canonical message records and newly added comment-message/proposal IDs, excluding valid deterministic notices and duplicate IDs; change.messageId alone is not trusted. `retryAt` is the earliest ledger-entry expiry that frees enough message and byte allowance for the operation, using the later time when both are exhausted; Retry-After is its ceiling seconds from now. A pack's unique byte charge is keyed by `(machine,sequence,fullPackHash)`, metadata by `(machine,path,contentHash)`; missing-dependency retries do not charge it again.

General HTTP caps: URL 2048 bytes, headers 8192 bytes, 240 non-SSE requests per principal per rolling minute, request body 2,000,000 bytes except board/text replacement at 16,000,000, request read timeout 15 seconds. Body lengths are measured while streaming, even without Content-Length. At most four SSE connections per principal; additional connections return 429. A static fetch counts toward local request limits; authentication has its own stricter counters.

JSON depth is at most 40, any array at most 10000 items. Blueprint has at most 500 screens, 10000 nodes, nesting depth 30, and 2000 links, with total serialized board at most 16 MB. Void documents are at most 16 MB, with at most 2000 pages. Comments text is at most 10000 characters, title/subject at most 240, attachment count at most 64 with path at most 2048 characters. A pack is at most 50 MB transmitted, 64 MB expanded, 10000 changes/objects, and each object at most 16 MB expanded; objects cannot be split across files to bypass message limits. Head length is at most 16 MB. Temporary/incomplete publication files are ignored. Paging returns issues for inaccessible entries, never follows links, and never silently reports a truncated list as complete.

## 8. Open points with defaults

These points do not block parallel builds. Until a reviewed contract change replaces them, the stated default is normative for both builders.

| Point to settle | Default if unanswered |
| --- | --- |
| Native session launch/stop support and hook coverage on each platform | Use only an installed enabled adapter; unsupported start/stop reports the named error, unsupported gating keeps the client's native prompt; no simulated approval or replay |
| Multiple home-network interfaces | Bind every selected private IPv4 interface; with addresses omitted select the first interface ordered by interface name then address; display the exact bound links; no IPv6/public binding in 3.0 |
| Full-editor resources already stored as modules or outside registered repos | Discover modules read-only and preserve existing source; desktop creates an explicit JSON copy; outside-repo resources remain unavailable until a project path is registered |
| Default policy for suggested text changes versus assigned writing | Assigned edits use apply; a suggestion replying to a comment uses propose and waits for desktop Accept change/Discard; Watch never changes authority |
| Cross-machine simultaneous approval answers and clock conflict ties | Requesting service serializes the first valid received answer; later answers get resolved feedback; file conflicts use `(at,machine,id)` and preserve losing bytes |
| Pack index growth/compaction and stronger origin trust | Keep all machine-owned immutable packs and bounded heads, report size limits; compaction, account-wide quotas, authentication against hostile origin writers, and Quantum provisioning require a later contract |

The approved private-directory naming remains `user/`; only the person unit becomes master. Blueprint unknown-field retention, phone permissions, 12-hour expiry, message/sync limits, and canonical resource revisions are settled requirements, not optional defaults.

## 9. Existing implementation references

The contract overrides incompatible 2.x behavior only where stated above. Source references are evidence for retained formats, not dependencies a builder must inspect to understand the interface.

| Reference | Retained behavior or change boundary |
| --- | --- |
| [files.md](../../files.md), state/message/task/view sections | private `user/` root, scoped state/task paths, headers, lead approval line, archive semantics, unchanged legacy view contract |
| [Relay store](../../engine/relay/store.mjs), lines 182 to 190, 532 to 536, 698 to 717, 1048 to 1054, 1097 to 1105 | message encoding, private root, policies/local state, immutable registration, unique message filenames |
| [Person Relay](../../engine/relay/person.mjs), lines 29 to 57 | current person sender must migrate to master; offline mail remains distinct from a chat |
| [Wake service](../../engine/relay/wake.mjs), lines 116 to 133 and 653 to 670 | fixed consent window/handoff limits and ambiguous transport attempts |
| [Wizard server](../../gui/server.mjs), lines 144 to 161, 185 to 222, 305 to 314 | random bearer, exact socket/Host/Origin, static bootstrap exception; LAN receives separate limited authority |
| [View](../../engine/view.mjs), lines 303 to 351 and 475 to 501 | status/rollup precedence; old `chats` were unit states and become separate units in v3 |
| [Blueprint server](../../features/blueprint/server.mjs), [Blueprint format](../../features/blueprint/review/sketch-format.mjs) | current board/sketch/comment paths and format; strict unknown-field rejection is superseded |
| [Void server](../../features/void/server.mjs) | original/version/comment sidecars, stable page keys, numeric revision, and anchor relocation |
| [CLI](../../cli/index.mjs) and [Relay MCP](../../engine/relay/mcp.mjs) | existing commands and stdio tools remain; service, task status/undo, HTTP editor tools, and package GUI export are new |

The uncommitted 2.x GUI worktree is reference-only. Its rendering and host handle informed interface names; its shared LAN bearer, lack of expiry, and unit-as-chat projection are not adopted. No file in that worktree is part of this delivery.
