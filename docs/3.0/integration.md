# HIVEM1ND 3.0.0 integration plan

Worktree: `HIVEM1ND-3-final`. Branch: `feat/3.0-final`, from `qa/3.0-046` at `b78b9c51a669a3f3ff550efd998d2ae62d66173c`.
The branch, HEAD and merge base were verified on 2026-10-13. The supplied board changes, archives, comments, final plan and Spanish register test were already present and remain untouched.

## Baseline

- `npm test`: exit 0, 924 tests, 923 passed, 0 failed, 1 skipped, 0 canceled. No failing test names.
- `npm run test:core`: exit 0, 791 tests, 790 passed, 0 failed, 1 skipped, 0 canceled. No failing test names.
- Both suites skipped `the home scan tolerates a directory it cannot list`, because this Windows process does not enforce that fixture's directory permissions.
- `npm run lint`: exit 0, 230 Markdown files inspected, 0 issues. Test pass/fail counts do not apply to lint.
- `npm run build`: exit 1. Source syntax checks completed, then `scripts/build.mjs:44` failed while running `npm pack`: `EPERM`, syscall `open`, in the npm cache temporary directory. No test cases run by build, so test pass/fail counts do not apply. The package archive gate remains failed. No source fix is inferred from a cache permission failure.

The four scripts were invoked again after the board revision to 83 screens. Windows commands use `npm.cmd`, the same npm scripts, because PowerShell blocks `npm.ps1`; no execution policy was changed.
The baseline is evidence about the supplied candidate. Proposed test code below has not been implemented or run. Browser checks are future gates, not observations from this planning session.
Document checks passed: 64 sequential tasks, 36 MECHANICAL and 28 JUDGMENT, no forward dependencies, eleven contract blocks and 83 unique screen entries in the seven required row counts. Literal edit programs for T001, T002 and T048 passed a read-only simulation with writes intercepted in memory. The final documentation lint inspected 231 files with zero issues; the build baseline remains failed.

## Governing requirements

Only `final.md` decisions 1 to 23 and packages P0 to P13 apply. After the P13 addition at `10b62b4`, the final board has row counts 10, 22, 11, 14, 11, 12 and 7, totaling 87 screens. The baseline and its original document-check counts remain historical evidence. T001 to T006 are committed and their task text is retained.
Older references in resolved review comments are historical. Current screen references and notes govern. The earlier 67-screen specification, sync picker, four Settings tabs and phone standing approvals are superseded.

MECHANICAL tasks contain literal patches or complete additions and tests. JUDGMENT tasks remain with the planner, who resolves the named implementation decision and implements the task before its dependents proceed.
The mechanical executor does not reinterpret a JUDGMENT task. A missing prerequisite, different before-text, failed assertion or failed proof stops that task. No guessed identifier, omitted step or substitute implementation is permitted.

Commands in tasks are future proof commands run at the repository root. A task's commit message describes its future isolated commit; this planning session makes no commit or push.
All new tests use temporary fixture data and injected OS/native runners. No test registers a real logon task, alters a real client configuration or starts an actual agent session.
Visual shorthand uses CSS pixels throughout: `padding 10x14` means 10 vertical and 14 horizontal pixels; `padding 10x12x10x14` means top/right/bottom/left; `24/700` means 24-pixel text at weight 700; `14.5/body` means 14.5-pixel text with the body token. Width, height, radius, gap, coordinates and hit-target values are literal. Board token aliases map `acc` to `--accent`, `accInk` to `--accent-ink`, `accSoft` to `--accent-soft`, `wait` to `--waiting`, `waitSoft` to `--waiting-soft`, `ok` to `--working`, and other names to their matching CSS custom properties. A token name never authorizes choosing another color.

## Contract amendments, before implementation

T001 inserts the following normative text into `docs/3.0/contract.md`. Existing authentication, idempotency, byte revisions, journal recovery, origin ownership, limits and unknown-field retention continue to apply.
Each block identifies its insertion section. Where an existing sentence or route disagrees, the block replaces that definition, rather than leaving two normative definitions.

### C01: section 2.1, default location, setup and lifetime

```text
The default M1ND folder is <local Cosmic>/.m1nd. The common root is resolved once by localCosmic: %LOCALAPPDATA%/Cosmic on Windows, ~/.local/share/Cosmic on Linux, and the existing Library/Application Support/Cosmic root on macOS. The Linux default does not change with XDG_DATA_HOME. An explicit cosmicPath or mindPath remains an explicit override.

Setup exposes four steps: install, location, service, ready. Folder selection is the synchronization choice. No sync selector, origin selector, Simple mode or Custom mode is presented. Relay+ is a disabled Coming soon notice; no account, purchase or Quantum provisioning operation is added. Existing folder transport stays internal.

Selecting a configured 3.0 M1ND joins it, preserving existing kit/private records and adding only this machine's registration and approved machine-local configuration. Selecting migration copies a detected 2.x M1ND into the new destination before migrations run. The legacy source is never opened for writing, renamed, unlinked or upgraded. Linked descendants are refused. Source and destination must be distinct and neither may contain the other.

Active legacy sessions are listed before migration. Confirming Close them and migrate closes verified locally owned legacy sessions after their work is saved. Offline sessions receive a closure requirement in the destination's migration handoff and close before 3.0 wake adoption when their machine next starts HIVEM1ND. No process is killed from an unverified persisted PID. Cancel leaves both trees unchanged. An incomplete safe shutdown blocks migration rather than claiming the session closed.

The local setup checkpoint is L/setup.json: {format:"hivem1nd-setup-v1",mode:"create"|"join"|"migrate",sourcePath:string|null,destinationPath:string,phase:"prepare"|"close-legacy"|"copy"|"migrate"|"configure"|"start"|"open"|"ready",completed:string[],error:null|{code:string,message:string},updatedAt:Time}. It contains no credential, native endpoint or agent secret. Completed phases are verified before reuse. Reopening a failed setup resumes its incomplete phase; Retry never recopies a completed migration or rewrites a joined M1ND.

startWithWindows is a machine-local boolean, absent meaning false. Setup never installs a logon registration by default. The same optional setting enables or removes the existing ownership-checked Windows task, Linux user service or supported macOS registration. Enabling is effective only after OS registration succeeds; disabling removes only the verified owned registration. Runtime service ownership and startup do not require registration.json. The service runs while an authorized host/session needs it; shared singleton and bootstrap protection remain unchanged. Idle origin behavior retains sections 2.9 and 2.10.
```

### C02: sections 2.2, 2.4, 2.7 and 3.3, aliases, groups and removal

```text
Unit adds alias:string|null and removed:boolean. The optional alias state header is a trimmed, single-line Unicode string of 1 to 128 code units; an empty header means null. CR, LF, NUL and control characters are forbidden. Setting an alias changes no unit, unit-id, role, lead-id, scope, task recipient, registration binding or filename. Search includes alias. Display combines alias and the original unit name; canonical UnitId remains the operation key. F2 and Rename start alias editing; Hierarchy double click centers the unit.

A personal Group is {id:UUID,title:string,members:UnitId[],chatId:UUID,createdAt:Time,revision:Revision,deleted:boolean}. title is trimmed, nonblank, single-line and at most 240 code units. members contains 1 to 255 distinct existing non-master UnitIds. Groups never write lead fields. Group records are P/gui/groups/<id>.json with format:"hivem1nd-group-v1". chatId equals id; the chat uses kind:"group" even for one non-master member, includes root:master, and is created atomically with the group. Ordinary direct-chat reuse is unchanged.

Group title/member edits update the linked chat metadata in the same transaction. Historical messages remain; current members authorize current reads/writes. Group deletion marks deleted:true and sets its linked chat listed:false and archived:true, leaving units, leads and direct chats unchanged. Archived chats are accessible through GET /chats?archived=true. Chat adds archived:boolean, absent meaning false. Undo restores the group and the prior chat metadata only if their post-change revisions still match.

GET /view adds groups:Group[]. Active unit collections omit removed units by default; GET /units accepts archived=true to inspect removed units. Unit removal requires confirmed:true, stops a verified running session first, then archives its state, mailbox visibility and associated direct chat. Tasks and repository files remain. Existing IDs remain reserved. Group membership and dependent lead handling are validated before commit; removing a lead with surviving reports returns 409 unit_has_reports until those reports are explicitly connected elsewhere. Removal is never a cascading deletion of units. The board's Undo restores the archived state and visibility, not a stopped native process.

PATCH /units/:unitId/alias accepts {alias:string|null,expectedRevision:Revision} and returns 200 Unit. DELETE /units/:unitId accepts {confirmed:true,expectedRevision:Revision} and returns 200 {unitId:UnitId,changeId:UUID,undoUntil:Time}; confirmed stop failure returns 409 stop_unavailable with no archive. Root master is not removable. Root Overseer with reports is not removable until those reports are reassigned.

GET /groups accepts List and returns List<Group>. POST /groups accepts {title:string,members:UnitId[]} and returns 201 Group. PATCH /groups/:groupId accepts {title?:string,members?:UnitId[],expectedRevision:Revision}, at least one editable key, and returns 200 Group. DELETE /groups/:groupId accepts {confirmed:true,expectedRevision:Revision} and returns 200 {groupId:UUID,changeId:UUID,undoUntil:Time}. Errors are 404 group_not_found, 422 invalid_members, 422 invalid_title, 409 revision_conflict and 409 chat_changed. Desktop alone mutates groups and unit alias/removal, using chat.manage and unit.create respectively; phone/agent writes return 403.

Personal zones derive a rounded rectangular bound around member circles and labels. They are not reporting squads or the existing project/environment arrangement keys. Moving member units uses existing layout writes. Folded personal folders remain viewer-local. group.changed emits {group:Group}; archived group data never contributes to active counts.
```

### C03: sections 2.3, 3.3 and 5, session mode and child CLI approval

```text
Session start adds runMode:"task"|"chat", default task for an Executor, and taskId:TaskId|null. task mode requires taskId or a nonblank task prompt; chat mode may start without a task. Session and session-request projections add runMode, taskId and launchKind:"cli"|"manual-app". Existing verified app registrations project manual-app and retain their canonical unit/lead. No builder role or product-created builder unit is introduced.

A task CLI closes only after the assigned task's terminal delivery/failure and acknowledged native shutdown. Chat CLI stays open until explicit stop. No elapsed timer fabricates completion. At 30 seconds without a verified start result, a launch remains uncertain or fails with launch_ambiguous when appropriate; Retry reconciles the same request ID and cannot spawn a second process. Cancel start marks an unconsumed request canceled; an already spawned process uses verified stop before canceled confirmation. Request state adds canceled.

POST /units/:unitId/session accepts {client:Client,prompt?:string|null,runMode?:"task"|"chat",taskId?:TaskId|null,expectedRevision:Revision}. POST /session-requests/:requestId/cancel accepts {} and returns 202 {requestId:UUID,state:"canceling"} or 200 {requestId:UUID,state:"canceled"}. A confirmed stop ends work; unsupported interruption reports 409 stop_unavailable rather than showing stopped.

session.open is an approval action with exact pattern {client:Client,machine:Name,unitId:UnitId,runMode:"task"|"chat",taskId:TaskId|null}. It is valid only for a bound chat session requesting another connected CLI for a registered unit on that machine. It never accepts executable, cwd, environment or shell text. alwaysAllowed is false; only approve or deny is valid. An approval permits exactly one child launch, tied to approvalId. Replayed/synced answers cannot create another child. The inspector displays the actual launchKind/client/machine, not an inferred app/CLI connection.
```

### C04: sections 2.4, 3.2, 3.4 and 7, sent state and Waiting

```text
A send waits at most 10000 milliseconds for its HTTP acknowledgment. Other GUI requests wait at most 30000 milliseconds, including body consumption. The server's request-body read limit remains 15000 milliseconds; it is distinct from the client response deadline. A timed-out write is unconfirmed, not proven absent. Retry retains the same Idempotency-Key and canonical payload. Reconciliation and receipt replay cannot create a second logical message or wake notice.

Message adds delivery:{state:"stored"|"delivered"|"read",deliveredAt:Time|null,readAt:Time|null}. Delivered means every current non-author recipient's notice has a verified submission acknowledgment, with no pending, failed or ambiguous recipient. Read means every such recipient explicitly acknowledged that message. A service-stored message with no recipient acknowledgment is stored. An agent reply is not itself a fabricated read receipt. The author can read aggregate receipt status; no foreign secret transport details are returned. Local optimistic states sending and unconfirmed are GUI-only.

Waiting adds state:"pending"|"answering"|"expired". Expired approval results remain visible under Ended without an answer, ordered newest first, with blocking:false. They do not increment counts.waiting, the waiting pill or a unit's waiting status. Requests already answered approved/denied do not appear in that section. Approval answers that await owner acknowledgment show answering, not approved.

The GUI announces Taking longer than usual when a pending non-send request enters its waiting state and includes elapsed time. At 30000 milliseconds it ends with Retry and a retained draft. Cancel aborts local waiting; it never claims to roll back a committed write. A send uses Not confirmed: the service did not answer in 10 s. Existing credentials and uncertain operations survive reconnection until their normal expiry.
```

### C05: sections 2.8, 2.9 and 3.6, library folders, moves, deletion and Undo

```text
Each registered project stores docs/flows/library.json: {format:"hivem1nd-library-v1",folders:[{id:UUID,title:string,kind:"blueprint"|"void",parentId:UUID|null}],items:{<ResourceId>:{folderId:UUID|null,title:string,updatedAt:Time}}}. Folder titles use Group title validation. Folder IDs are unique within a project; parent chains cannot cycle. Empty folders remain sync-eligible independently of catalog items. This file stores logical organization; renaming or moving within a project changes metadata, not resource identity/path. EditorSummary adds folderId:UUID|null and updatedAt:Time|null.

POST /blueprint/boards accepts {project:Name,path?:string,document:object,attached?:UnitId[],folderId?:UUID|null} and returns 201 Editor. POST /void/texts accepts {project:Name,path:string,document:object,attached?:UnitId[],folderId?:UUID|null} and returns 201 Editor. An omitted folderId means the project root. A supplied folder must exist in the target project with the matching editor kind. Document, initial history, catalog and selected-folder metadata are one transaction; a failed folder validation creates no resource. Every content/comment/title edit updates that item's updatedAt to the committed event time, not the viewer's last-read time. Existing resources without metadata project their latest document/comment modification time until the first managed edit records it.

GET /blueprint/boards and GET /void/texts accept existing List/project plus folderId?:UUID,openComments?:boolean,attachedAgents?:boolean,changedThisWeek?:boolean. q searches titles, board screen titles and node text, text page content and comment bodies across folders. Changed this week means since Monday 00:00 UTC of the current week. Boolean filters combine with AND. Matching ancestor folders open in the GUI; chips remain until explicitly removed.

GET /library/folders accepts List,project?:Name,kind:"blueprint"|"void" and returns List<{id:UUID,project:Name,kind:string,title:string,parentId:UUID|null,count:integer,revision:Revision}>. POST /library/folders accepts {project:Name,kind:"blueprint"|"void",title:string,parentId:UUID|null,expectedRevision:Revision|null} and returns 201 {folder:object,revision:Revision}. PATCH /library/folders/:folderId accepts {project:Name,title?:string,parentId?:UUID|null,expectedRevision:Revision} and returns 200 {folder:object,revision:Revision}. DELETE /library/folders/:folderId accepts {project:Name,confirmed:true,expectedRevision:Revision} and returns 200 {changeId:UUID,undoUntil:Time,removedResourceIds:ResourceId[]}. Deleting a folder removes its contained logical folders and editor resources in one transaction, after the confirmation names their counts; unrelated assets shared by surviving resources remain.

PATCH /editors/:resourceId/library accepts {title?:string,folderId?:UUID|null,expectedRevision:Revision,expectedLibraryRevision:Revision|null} and returns 200 Editor. POST /editors/:resourceId/duplicate accepts {project:Name,folderId:UUID|null,title:string,path:string,expectedRevision:Revision} and returns 201 Editor. A duplicate receives a new board/document identity, copies real content, deeply preserves unknown fields, starts its own history/original and copies no comments, proposals or attachments.

POST /editors/:resourceId/move accepts {project:Name,folderId:UUID|null,path:string,confirmedRepositoryChange:boolean,expectedRevision:Revision,expectedCommentsRevision:Revision|null,expectedAttachmentRevision:Revision|null,expectedLibraryRevision:Revision|null} and returns 200 {editor:Editor,previousId:ResourceId,changeId:UUID,undoUntil:Time}. A cross-project move requires confirmedRepositoryChange:true; it moves actual document, comments, history/original and owned referenced assets to the destination repository, updates catalog/binding/anchors, reserves a new deterministic ResourceId and publishes source tombstones plus destination writes as one transaction. Unknown fields and historical authors survive. Current attached units are revalidated at destination. Shared source assets referenced by surviving resources remain. A missing local repository returns 409 project_unavailable; destination collisions return 409 resource_exists. No git commit or push is performed.

DELETE /editors/:resourceId accepts {confirmed:true,expectedRevision:Revision,expectedCommentsRevision:Revision|null,expectedAttachmentRevision:Revision|null,expectedLibraryRevision:Revision|null} and returns 200 {resourceId:ResourceId,changeId:UUID,undoUntil:Time}. It removes the editor's document, private binding, comments and editor-owned history/original, after keeping an undo copy; surviving shared assets remain. Attached units receive one deterministic deletion notice. Committed historical copies remain in repository history without an automatic git operation.

POST /changes/:changeId/undo accepts {} and returns 200 {changeId:UUID,undoOf:UUID,resourceIds:ResourceId[]}. It restores a library/group/unit/repository deletion or move within 10000 milliseconds after its committed change. It validates all post-change revisions and destination absence before restoring. Expired undo returns 410 undo_expired; intervening edits return 409 undo_conflict. Archive of a unit/group never deletes its chat bytes. Durable undo copies are owner-protected outside credentials, associated with the transaction and recovered before success. Cleanup of an expired undo copy cannot remove surviving history.

library.changed emits {project:Name,kind:"blueprint"|"void",revision:Revision}; editor.removed emits {resourceId:ResourceId,changeId:UUID,undoUntil:Time}. Desktop alone manages library/undo via editor.write or chat.manage/unit.create for its originating object. Phone and attached agents cannot duplicate, move, remove, restore or manage folders. All new writes require Idempotency-Key and exact bodies; unknown keys return 400 unknown_field. Revisions and deletions remain transactional and sync-eligible after the catalog item is removed.
```

### C06: sections 2.8 and 3.6, import, sketches and History

```text
POST /blueprint/boards/import accepts {project:Name,path:string,title:string,folderId:UUID|null,legacyResourceId:ResourceId,document:object,expectedRevision:Revision} and returns 201 Editor. The document is the exact JSON export of the selected registered legacy board and its validated existing sketch. The desktop obtains that export through the locally owned Blueprint module exporter, limited to the registered module and repository kit. The HTTP service never executes a supplied module, accepts executable import text or replaces the source module. An unexportable source returns 422 import_unavailable; it never creates an empty substitute.

Hand sketches are ordinary screens and vector nodes in the board JSON: a root box for the sketch frame, vectors with kind:"pen", d:string, stroke:Color, strokeWidth:number and opacity:number. Pen, marker and eraser operate on that same document. No separate sketch editor/resource/sidecar is created for a new integrated sketch. Blueprint Lite preserves and renders these fields. Frame title, screen/page order, strokes and unknown data survive full replacement and sync. Asset.src is assets/<UUID>.<extension>, Asset.id is the complete filename, and stored bytes remain under the project's docs/flows/assets/; the GUI never adds the filesystem prefix to the wire reference.

Every editor change, including a comment or restore, creates immutable metadata at docs/flows/history/<ResourceId>/<historyId>.json: {format:"hivem1nd-editor-history-v1",id:UUID,resourceId:ResourceId,at:Time,by:UnitId,operation:string,documentPath:string,commentsPath:string|null,revision:Revision,commentsRevision:Revision|null}. Exact document bytes are kept at <historyId>.document.json and optional exact comment bytes at <historyId>.comments.json in the same directory; each independently follows the existing 16 MB object cap and is verified against its Revision. Existing Void .orig.json and .versions.jsonl remain compatible and are not discarded. A revision conflict preserves both incoming committed bytes and the person's draft before Keep mine or Reload resolves it. No restore overwrites current bytes without preserving their snapshot first.

GET /editors/:resourceId/history accepts List and returns List<{id:UUID,resourceId:ResourceId,at:Time,by:UnitId,operation:string,revision:Revision,commentsRevision:Revision|null,current:boolean}> ordered newest first. POST /editors/:resourceId/history/:historyId/restore accepts {expectedRevision:Revision,expectedCommentsRevision:Revision|null} and returns 200 Editor. History documents are validated, unknown fields preserved and current revision saved atomically before restore. Restore does not revive a stopped session or renew a permission. Errors are 404 history_not_found,409 revision_conflict,409 unsupported_fields_lost. editor.history.changed emits {resourceId:ResourceId,historyId:UUID,revision:Revision}.
```

### C07: sections 2.7, 2.8 and 3.6, Send to agent

```text
Shared person settings add sendToAgent:boolean, absent meaning true. PATCH /settings accepts sendToAgent?:boolean with its existing expectedRevision. Both comment composers share this preference; it is not per document, browser or thread. With no attached units, the checkbox is disabled and visually unchecked without changing the stored preference.

POST /editors/:resourceId/comments and POST /editors/:resourceId/comments/:threadId/replies add sendToAgent?:boolean. The GUI resolves its persisted person preference and sends the boolean explicitly. Omitted legacy-client input retains the prior true behavior. A false person comment stores the same comment/anchor/history and queues no notices, wakes or message admission. An attached agent reply with false notifies master only, never other attached agents; its person notice retains normal message admission. True queues existing deterministic recipient notices only after durable comment commit. Agents cannot edit person settings. The request's choice is retained with its idempotency receipt, not re-evaluated on Retry. No attached units produce an empty recipient array for a person comment and retain the note.
```

### C08: sections 2.8 and 3.6, Void editing and whole-replace undo

```text
Void page strings support Markdown in addition to retained b/i legacy markup. The editor renders bold, italic, strikethrough, H1/H2/H3, list, quote, code, validated link, table and project-local image as data through safe DOM construction. Raw HTML other than legacy b/i is literal text. javascript:, executable data URLs, event handlers and scripts are never executed. Existing k/language keys and unknown properties remain unchanged. Source view shows the exact stored string and keeps the same UTF-16 caret through a source/rendered offset map.

POST /void/replace accepts {items:[{resourceId:ResourceId,k:string,lang:string,start:integer,end:integer,expectedText:string,replacement:string,expectedRevision:Revision}],expectedCommentsRevisions:{<ResourceId>:Revision|null}} and returns 200 {changeId:UUID,editors:Editor[],matches:integer}. It is desktop-only, limited to 10000 replacements and existing 16 MB per-resource limits. All items validate before a single multi-resource transaction; ranges per page are nonoverlapping and applied in descending source order. 409 range_changed or revision_conflict writes nothing. POST /void/replace/:changeId/undo accepts {} and returns 200 {changeId:UUID,undoOf:UUID,editors:Editor[]}; all post-replace revisions must still match. This restores the whole replace in one operation and retains history. It is a document edit undo, distinct from the 10-second deletion undo.

Find options are caseSensitive:boolean,wholeWord:boolean,regularExpression:boolean and scope:"document"|"all". All means the accessible Texts library, not arbitrary disk files. Invalid regular expressions show an error and perform no edit. Search cannot block UI/service without a bound; regex evaluation has a cancellable worker deadline. A stale suggestion offers Edit passage, Ask again and Discard. Edit keeps the suggestion's expected text/base revision for final validation; accepting edited replacement never silently rebases an old suggestion.

POST /void/texts/:resourceId/proposals/:proposalId/answer adds replacement?:string when decision is accept. It validates the original base/expected text, journals the proposed replacement, commits the text/history and sidecar accepted state together. An edited suggestion has the same identity and retained discussion.
```

### C09: sections 2.7, 3.5, 4 and 6.3, Settings and permissions

```text
Look is modern|high-contrast|nebula|txmska|coffee-cat|ntk. The retained high-contrast wire value displays Nocturne; txmska displays Waves, coffee-cat displays Toxic and ntk displays Kinetic. Visible names in order are Modern, Nocturne, Nebula, Waves, Toxic and Kinetic. This Look type extends all former modern|high-contrast definitions in settings, auth/local, viewer, host handle and embedding without rewriting existing serialized values. Shared look/language/content preferences remain separate from machine-local configuration.

GET /settings accepts machine?:Name and returns {settings:object,revision:Revision|null,selectedMachine:Name,readOnly:boolean,reportedAt:Time|null,service:{machine:Name,state:"running"|"stopped"|"unknown",version:string|null,startedAt:Time|null,startWithWindows:boolean,revision:Revision|null},locations:{mind:string,staging:string},home:HomeStatus}. Locations/agents/permissions/projects belong to selectedMachine. An offline machine shows its latest sanitized report, readOnly:true. It is not silently changed on the local machine's behalf. Paths are shown only to authenticated desktop; phone receives no local absolute paths or opening secrets.

GET /settings/agents accepts machine?:Name and returns {machine:Name,readOnly:boolean,reportedAt:Time|null,revision:Revision|null,items:[{id:string,name:string,version:string|null,found:boolean,mode:"auto"|"on-demand",cli:{state:"connected"|"changes-needed"|"missing",changes:integer},app:{name:string|null,state:"connected"|"available"|"missing"}}]}. POST /settings/agents/scan accepts {machine:Name} and returns the same report; only the selected online owner scans. POST /settings/agents/find accepts {machine:Name,client:string,path:string} and returns the report after validating an installed known client path; it executes no arbitrary binary supplied by HTTP.

POST /settings/agents/:client/preview accepts {machine:Name,mode:"auto"|"on-demand",target:"cli"|"app",allowGit:false|true} and returns {previewId:UUID,revision:Revision|null,expiresAt:Time,changes:[{id:string,path:string,description:string,beforeHash:Hash|null,afterText:string,optional:boolean,selected:boolean}],restartRequired:boolean}. Preview writes no configuration. allowGit defaults false; its optional change is independently unchecked. Preview contains owned proposed text, with existing secrets redacted and retained by opaque local binding, never returned in afterText. The preview identity binds exact before hashes and selected changes.

POST /settings/agents/:client/apply accepts {machine:Name,previewId:UUID,changeIds:string[],expectedRevision:Revision|null} and returns {machine:Name,client:string,state:"connected",revision:Revision,keptCopies:integer}. Hash drift returns 409 configuration_changed. Only selected preview changes apply; owner-protected kept copies of original files exist before writes. Copy changes is a desktop clipboard action over the redacted proposed changes and makes no API write. DELETE /settings/agents/:client accepts {machine:Name,confirmed:true,expectedRevision:Revision} and returns {machine:Name,client:string,state:"disconnected",revision:Revision}; only owned changes are restored from kept copies and intervening foreign edits are preserved or return 409 configuration_changed. Required client reload is explicit and cannot silently stop unrelated sessions.

Git permission is {id:UUID,machine:Name,client:string,actions:["git.commit","git.push"],scope:"hivem1nd-started-sessions",grantedAt:Time,grantedBy:"root:master"}. It is local, separate from unit standing approvals, absent by default, and only selected sessions receive its scope. Existing sessions and manually started apps do not inherit it. A granted capability never itself instructs a commit or push.

GET /settings/permissions accepts machine?:Name and returns {machine:Name,readOnly:boolean,reportedAt:Time|null,unitGrants:[{unitId:UnitId,grant:Grant}],agentPermissions:object[],revision:Revision|null}. DELETE /settings/permissions/:permissionId accepts {machine:Name,expectedRevision:Revision} and returns 200 {permissionId:UUID,state:"revoked",revision:Revision}. Unit grant Revoke uses the retained owner-applied grant route, not this local permission route.

GET /settings/projects accepts machine?:Name and returns {machine:Name,readOnly:boolean,reportedAt:Time|null,revision:Revision|null,folders:[{id:UUID,path:string,environment:Name|null,repositories:[{id:Name,title:string,path:string,registered:boolean}]}]}. POST /settings/projects/folders accepts {machine:Name,path:string,environment:Name|null,expectedRevision:Revision|null} and returns the report after bounded repository discovery. DELETE /settings/projects/:projectId accepts {machine:Name,confirmed:true,expectedRevision:Revision} and returns {projectId:Name,changeId:UUID,undoUntil:Time,revision:Revision}. It unregisters visibility only; repository bytes remain untouched. Undo restores registration and catalog visibility, subject to the normal 10-second revision check.

GET /settings/content returns {revision:Revision|null,features:[{id:string,title:string,category:"planning"|"quality"|"continuity"|"other",included:boolean}],knowledge:[{id:string,title:string,included:boolean}],preferences:{addressStyle:"impersonal"|"formal"|"explanatory",additionalInstructions:string,keepExistingPreferencesFirst:boolean,updateChecks:"daily"|"off"}}. PATCH /settings/content accepts {includedFeatures:string[],includedKnowledge:string[],preferences:object,expectedRevision:Revision|null} with exactly those preference keys and returns the content report. Existing preferences and foreign client entries survive; configuration-affecting changes require the same concrete preview/apply workflow.

PATCH /settings/service accepts {machine:Name,startWithWindows:boolean,expectedRevision:Revision|null} and returns the selected service object. POST /settings/service/restart accepts {machine:Name} and returns 202 {state:"restarting",machine:Name}. An HTTP restart request delegates to the verified same-user launcher; a stopped listener is recovered through the existing host/launcher bridge, never a request to its dead port. New bootstrap/viewer credentials are read locally and kept in memory; drafts survive a confirmed reconnect. A host without this bridge shows actionable restart instructions instead of pretending the stopped service accepted an HTTP request.

machine.settings.changed emits {machine:Name,section:"agents"|"permissions"|"projects"|"service",reportedAt:Time,revision:Revision|null}. Reports are machine-owned sanitized records at P/machines/<machine>/settings.json; no credentials, native transport, configuration bytes, clipboard contents or kept-copy bytes are synced. Content emits settings.content.changed:{revision:Revision}. All mutation routes here are desktop-only and reuse settings.write except unit grant revocation. Remote writes require the selected machine online and verified owner execution; otherwise 409 machine_unavailable.
```

### C10: sections 6.2 and 7, phone approvals and pairing lock

```text
Approval adds desktopOnly:boolean, derived by the trusted service/adapter from the normalized action and not accepted as an agent-controlled false override. Phone can answer ordinary existing asks with approve or deny. approve-always on a phone returns 403 phone_read_only before a receipt, grant write or event. git.push approvals are desktop-only; session.open and one-time git.commit remain ordinary approve/deny asks; the phone receives their readable card with Standing approvals and pushes are answered on the computer. Exact process.run patterns invoking git push are normalized by the trusted adapter and likewise desktop-only; an arbitrary display string never decides permission. Accept and Send back remain allowed only for reviewable review tasks. Phone cannot undo, revoke, change configuration or edit resources, regardless of viewport.

For manual code pairing, five incorrect codes per peer and current grant lock pairing for 600000 milliseconds. Failures do not reset after one minute. On the first four failures, 401 invalid_home_key includes details:{triesLeft:integer} with 4,3,2,1 respectively. The fifth and requests during the lock return 429 pairing_locked with details:{triesLeft:0,lockedUntil:Time}, retryAt:Time and Retry-After seconds. Expired locks reset the failure count; generating a new desktop grant resets the lock immediately. Correct codes do not bypass an active lock. Credential values and entered codes are never persisted/logged or echoed. Existing global abuse/network checks and 12-hour grant expiry still apply.
```

### C11: presentation requirements following section 7

```text
Status differs by shape: working filled, waiting thick ring, idle thin ring. All interactive targets are at least 32 CSS pixels; 9-pixel visible resize handles have 32-pixel hit targets. Icon-only buttons have literal localized accessible names. Muted text meets 4.5:1 against every surface where displayed. Theme corrections use fills and the theme's quiet line hue, never bright or white container borders. QR scanner black/white and pure-black Focus remain their existing explicit exceptions.
```

## Tasks in execution order

### P0. Base

#### T001. Adopt the final contract

- Screens: all 83. Decisions: 1 to 22. Kind: MECHANICAL.
- Files: `docs/3.0/contract.md`, sections identified by C01 to C11.
- Change: run this complete documentation edit program over standard input with `node --input-type=module`. It inserts the literal blocks above under their primary sections and states their precedence over superseded definitions. The secondary sections named in each amendment are affected by that same normative block; they do not get divergent copies. Existing text is retained as reference and has no authority over a redefined field or route. No field or insertion location is selected by the executor.

```js
import { readFile, writeFile } from 'node:fs/promises';
const plan = (await readFile('docs/3.0/integration.md', 'utf8')).replaceAll('\r\n', '\n');
let contract = (await readFile('docs/3.0/contract.md', 'utf8')).replaceAll('\r\n', '\n');
if (contract.includes('Final integration amendment C01')) throw new Error('Final amendments are already present.');
const blocks = new Map([...plan.matchAll(/^### (C\d{2}):[^\n]*\n\n```text\n([\s\S]*?)\n```/gm)]
  .map((match) => [match[1], match[2]]));
if (blocks.size !== 11) throw new Error('Exactly eleven literal contract blocks are required.');
const placements = [
  ['C01', '### 2.1. Service configuration and heartbeat'],
  ['C02', '### 2.2. Units, person migration, sessions, and wake policies'],
  ['C03', '### 2.3. Session start request and result'],
  ['C04', '### 2.4. Mailboxes, chats, and messages'],
  ['C05', '### 2.8. Editor resources and attached units'],
  ['C06', '### 2.8. Editor resources and attached units'],
  ['C07', '### 2.7. Layout and settings'],
  ['C08', '### 2.8. Editor resources and attached units'],
  ['C09', '### 2.7. Layout and settings'],
  ['C10', '### 6.2. Phone capability allowlist'],
  ['C11', '## 7. Errors and limits'],
];
const insertions = new Map();
for (const [id, heading] of placements) {
  if (!blocks.has(id)) throw new Error('Missing contract block: ' + id);
  const content = '**Final integration amendment ' + id + '.**\n\n' + blocks.get(id);
  insertions.set(heading, [...(insertions.get(heading) ?? []), content]);
}
for (const [heading, content] of insertions) {
  const anchor = heading + '\n';
  if (contract.split(anchor).length !== 2) throw new Error('Unexpected section: ' + heading);
  contract = contract.replace(anchor, anchor + '\n' + content.join('\n\n') + '\n');
}
const precedence = 'The final integration amendments C01 through C11 replace earlier definitions of their named fields, defaults, operations, deadlines and presentation requirements. Earlier text remains valid only where these amendments do not redefine it.';
contract = contract.replace(/^(# [^\n]+)\n/, '$1\n\n' + precedence + '\n');
await writeFile('docs/3.0/contract.md', contract, 'utf8');
console.log('Inserted 11 final amendments.');
```

- Tests: no runtime test is added for a documentation-only change. The existing Markdown validator checks the amended contract.
- Proof: the edit program prints `Inserted 11 final amendments.`; `npm.cmd run lint` exits 0 with zero issues. The eleven numbered normative additions and their explicit precedence must appear in the contract diff.
- Depends on: none. Commit message: `Define the final integration contract`.

### P1. Setup, first run and installer

#### T002. Use the common Cosmic root and .m1nd default

- Screens: 1.2, 1.3, 1.7, 6.1. Decisions: 4. Kind: MECHANICAL.
- Files: `engine/service/paths.mjs`, `localCosmic`, `defaultMind`; `engine/setup.mjs`, defaultMindPath in `createSetupSession`, `cosmicMind`; `gui/electron.mjs`, `parseElectronOptions`; `cli/index.mjs`, `setupOptions`, `runService`; `test/final-paths.test.mjs`, new; `test/core-identity.test.mjs`, Linux default assertions; `test/setup.test.mjs`, default location assertion; `test/interfaces-cli.test.mjs`, Electron default fixture; `test/service-install.test.mjs`, installer default path assertions.
- Change: in `localCosmic`, remove the entire line `if (absolute(lib, env.XDG_DATA_HOME)) return lib.resolve(lib.join(env.XDG_DATA_HOME, 'Cosmic'));`. Add `export const COSMIC_ROOT_NAME = 'Cosmic';` and `export const MIND_DIRECTORY_NAME = '.m1nd';` after ONE_DRIVE_ENV. In the three retained localCosmic root expressions replace the literal `'Cosmic'` with COSMIC_ROOT_NAME. That constant names the shared root; each session resolves it once with localCosmic. Replace the complete `defaultMind` function with:

```js
export function defaultMind({ platform, env = {}, home } = {}) {
  const lib = library(platform);
  const localEnv = { ...env };
  if (platform === 'win32' && !localEnv.LOCALAPPDATA) {
    if (!absolute(lib, home)) throw new CoreError(422, 'invalid_path', 'The home directory must be absolute.');
    localEnv.LOCALAPPDATA = lib.join(home, 'AppData', 'Local');
  }
  return lib.join(localCosmic({ platform, env: localEnv, home }), MIND_DIRECTORY_NAME);
}
```

In setup's existing paths import, replace `{ localCosmic }` with `{ localCosmic, defaultMind, MIND_DIRECTORY_NAME }`. In the explicit cosmicPath branch replace only `path.join(path.resolve(options.cosmicPath), 'hivem1nd')` with `path.join(path.resolve(options.cosmicPath), MIND_DIRECTORY_NAME)`. Replace the complete `cosmicMind` function with:

```js
function cosmicMind(env, homeDir) {
  return defaultMind({ platform: process.platform, env, home: homeDir });
}
```

Add these imports:

```js
// gui/electron.mjs
import { defaultMind } from '../engine/service/paths.mjs';
// cli/index.mjs
import { defaultMind, MIND_DIRECTORY_NAME } from '../engine/service/paths.mjs';
```

In `gui/electron.mjs`, replace the signature with `export function parseElectronOptions(argv, homeDir, env = process.env) {` and replace its implicit assignment exactly:

```js
  if (!hasMindPath) options.mindPath = defaultMind({ platform: process.platform, env, home: options.homeDir });
```

In `cli/index.mjs`, replace `path.join(homeDir, "HIVEM1ND")` only in `setupOptions`'s lifecycle fallback with:

```js
defaultMind({ platform: process.platform, env, home: homeDir })
```

Replace `path.join(path.resolve(options.cosmicPath), "hivem1nd")` in `runService` with:

```js
path.join(path.resolve(options.cosmicPath), MIND_DIRECTORY_NAME)
```

Explicit paths and the lifecycle command's existing current-folder detection remain explicit overrides. Do not replace arbitrary existing M1ND path fixtures. Before a later full-suite proof, execute this complete assertion edit program over standard input with `node --input-type=module`:

```js
import { readFile, writeFile } from 'node:fs/promises';
const replacements = [
  ['test/core-identity.test.mjs', "path.posix.join('/home/example', '.local', 'share', 'Cosmic', 'hivem1nd')", "path.posix.join('/home/example', '.local', 'share', 'Cosmic', '.m1nd')", 1],
  ['test/core-identity.test.mjs', "'/var/data/Cosmic/hivem1nd'", "'/home/example/.local/share/Cosmic/.m1nd'", 1],
  ['test/setup.test.mjs', "path.join(homeDir, 'AppData', 'Local', 'Cosmic', 'hivem1nd')", "path.join(homeDir, 'AppData', 'Local', 'Cosmic', '.m1nd')", 1],
  ['test/service-install.test.mjs', "path.join(local, 'Cosmic', 'hivem1nd')", "path.join(local, 'Cosmic', '.m1nd')", 2],
];
for (const [file, before, after, count] of replacements) {
  const source = await readFile(file, 'utf8');
  if (source.split(before).length - 1 !== count) throw new Error('Unexpected default assertion: ' + file);
  await writeFile(file, source.replaceAll(before, after), 'utf8');
}
```

In `test/interfaces-cli.test.mjs`, add `import { defaultMind } from "../engine/service/paths.mjs";` and replace the complete test named `Electron defaults stay inside the selected test home` with:

```js
test("Electron defaults stay inside the selected test home", () => {
  const testHome = path.join(os.tmpdir(), "hivem1nd-electron-home");
  const overrideHome = path.join(os.tmpdir(), "hivem1nd-electron-override");
  const expected = (home) => defaultMind({ platform: process.platform, env: {}, home });
  assert.equal(parseElectronOptions([], testHome, {}).mindPath, expected(testHome));
  const options = parseElectronOptions(["--home-dir", overrideHome], testHome, {});
  assert.equal(options.homeDir, path.resolve(overrideHome));
  assert.equal(options.mindPath, expected(path.resolve(overrideHome)));
  const userData = path.join(os.tmpdir(), "hivem1nd-electron-profile");
  assert.equal(parseElectronOptions(['--user-data-dir=' + userData], testHome, {}).userDataDir, path.resolve(userData));
  const selected = path.join(testHome, 'explicit');
  assert.equal(parseElectronOptions(['--mind-path', selected], testHome, {}).mindPath, path.resolve(selected));
});
```

- Tests: create the complete file:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMind, localCosmic, MIND_DIRECTORY_NAME } from '../engine/service/paths.mjs';

test('the default M1ND shares the Cosmic root on Windows and Linux', () => {
  assert.equal(MIND_DIRECTORY_NAME, '.m1nd');
  const win = { platform: 'win32', env: { LOCALAPPDATA: 'C:\\fixture\\local' }, home: 'C:\\fixture\\home' };
  assert.equal(localCosmic(win), 'C:\\fixture\\local\\Cosmic');
  assert.equal(defaultMind(win), 'C:\\fixture\\local\\Cosmic\\.m1nd');
  assert.equal(defaultMind({ platform: 'win32', env: {}, home: 'C:\\fixture\\home' }), 'C:\\fixture\\home\\AppData\\Local\\Cosmic\\.m1nd');
  const linux = { platform: 'linux', env: { XDG_DATA_HOME: '/fixture/override' }, home: '/fixture/home' };
  assert.equal(localCosmic(linux), '/fixture/home/.local/share/Cosmic');
  assert.equal(defaultMind(linux), '/fixture/home/.local/share/Cosmic/.m1nd');
});
```

- Proof: `node --test test/final-paths.test.mjs test/core-identity.test.mjs test/interfaces-cli.test.mjs`; zero failures, all default paths include `.m1nd`, explicit selection survives, and Electron fixture tests supply an empty environment rather than consulting real machine paths. Existing path assertions are repaired here before T004's broader proofs.
- Depends on: T001. Commit message: `Place the default M1ND under the common Cosmic root`.

#### T003. Copy a legacy tree without writing its source

- Screens: 1.2, 1.4, 1.5. Decisions: 6, 8. Kind: MECHANICAL.
- Files: `engine/legacy-copy.mjs`, new `copyLegacyTree`; `test/final-legacy-copy.test.mjs`, new. T004 consumes this helper.
- Change: create the complete module:

```js
import { copyFile, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './service/identity.mjs';
import { assertNoLinks } from './service/paths.mjs';

function contains(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export async function copyLegacyTree(sourcePath, destinationPath) {
  await assertNoLinks(sourcePath);
  await assertNoLinks(destinationPath);
  const source = await realpath(sourcePath);
  const destination = path.resolve(destinationPath);
  if (contains(source, destination) || contains(destination, source)) {
    throw new CoreError(422, 'invalid_path', 'The source and destination must be separate folders.');
  }
  const sourceState = await lstat(source);
  if (!sourceState.isDirectory()) throw new CoreError(422, 'invalid_path', 'The legacy M1ND must be a folder.');
  await mkdir(destination, { recursive: false });
  let files = 0;
  async function copyDirectory(from, to) {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const input = path.join(from, entry.name);
      const output = path.join(to, entry.name);
      const state = await lstat(input);
      if (state.isSymbolicLink()) throw new CoreError(422, 'unsafe_path', 'Refusing to copy a linked legacy entry.');
      if (state.isDirectory()) {
        await mkdir(output, { recursive: false });
        await copyDirectory(input, output);
      } else if (state.isFile()) {
        await copyFile(input, output);
        files += 1;
      } else {
        throw new CoreError(422, 'unsafe_path', 'The legacy tree contains an unsupported entry.');
      }
    }
  }
  await copyDirectory(source, destination);
  return { files };
}
```

The destination is a checkpoint-owned new staging folder, never an existing selected folder. No automatic partial-tree deletion is added. T004 handles verified resumability and publishing the prepared copy.

- Tests: create the complete file:

```js
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyLegacyTree } from '../engine/legacy-copy.mjs';

test('legacy copying preserves source bytes and timestamps and refuses an existing target', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-copy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'legacy');
  const destination = path.join(root, 'copy');
  await mkdir(path.join(source, 'user'), { recursive: true });
  const file = path.join(source, 'user', 'record.md');
  await writeFile(file, Buffer.from('unit: user\r\n\r\nKeep these bytes.\r\n'));
  const before = await readFile(file);
  const time = (await stat(file)).mtimeMs;
  assert.deepEqual(await copyLegacyTree(source, destination), { files: 1 });
  assert.deepEqual(await readFile(path.join(destination, 'user', 'record.md')), before);
  assert.deepEqual(await readFile(file), before);
  assert.equal((await stat(file)).mtimeMs, time);
  await assert.rejects(copyLegacyTree(source, destination), { code: 'EEXIST' });
  await assert.rejects(copyLegacyTree(source, path.join(source, 'nested')), { code: 'invalid_path' });
  assert.deepEqual(await readFile(file), before);
});
```

- Proof: `node --test test/final-legacy-copy.test.mjs`; one passed test, zero failures. Source bytes and mtime remain identical.
- Depends on: T002. Commit message: `Copy legacy M1ND records without altering the source`.

#### T004. Reconcile joining, legacy shutdown and setup checkpoints

- Screens: 1.2 to 1.7. Decisions: 3, 5, 6, 8. Kind: JUDGMENT.
- Files: `engine/setup.mjs`, `initialize`, `answer`, `install`, `retryService`, `resumeInstalledService`, `buildPlan`, `completionResult`; `engine/install.mjs`, client configuration preparation/write boundary; `engine/legacy-copy.mjs`, `copyLegacyTree` caller contract; `migrations/3.0.0.mjs`, `migratePerson`, `finishMove` entry boundary; `engine/service/install.mjs`, `configureOwnedService`; `engine/relay/local-wake.mjs`, verified stop/adoption entry points; `test/setup.test.mjs`, `test/core-migration.test.mjs`, `test/service-install.test.mjs`, `test/install-ownership.test.mjs`.
- Change: decide the safe checkpoint and local session-closure ownership boundaries. Implement the eight checkpoint phases and fields enumerated in C01 literally; the four setup steps remain presentation states. Run all existing migrations only against the prepared copy; moving person files inside that copy is permitted. Joining a 3.0 tree must not call kit-copy, preference replacement or routes replacement. Create a destination migration closure handoff for offline machines and require it before wake adoption. Confirmed local shutdown must verify the existing native binding and save acknowledgment; no persisted PID signal is allowed. Preserve the existing retry-only-service behavior and verify completed checkpoints on reopen. Defaults use existing `applySimpleDefaults`, `discoverAgents`, `discoverContent`, `discoverHomeProjects` and the machine record, rather than a second discovery implementation.
  Setup detects agents and content with defaults but writes no agent configuration. Existing verified client connections remain usable; newly detected clients needing changes expose Review changes in Settings. Prepare their owned configuration plans without applying them; T052's reviewed Apply path owns those writes. Test this boundary against the current install path that otherwise configures clients automatically.
- Visible text: `Join this M1ND` / `Unirse a este M1ND`; `Join` / `Unirse`; `Close HIVEM1ND 2.x first` / `Cerrar HIVEM1ND 2.x primero`; `Close them and migrate` / `Cerrar las sesiones y migrar`; `A session on an offline machine closes the next time that machine starts HIVEM1ND.` / `Una sesión en una máquina desconectada se cierra la próxima vez que esa máquina inicia HIVEM1ND.` Details interpolate verified unit/client/machine data.
- Tests: add named cases `joining preserves every existing record except the joining machine record`, `legacy shutdown finishes before a destination copy`, `offline legacy ownership blocks wake adoption until closure`, `failed copy resumes only verified checkpoint entries`, `migration writes only destination paths`, `reopening a failed service step preserves completed copy and migration`. Hash complete source trees and track every write path, not only a selected file.
- Proof: `node --test test/setup.test.mjs test/core-migration.test.mjs test/service-install.test.mjs test/install-ownership.test.mjs`; zero failures, no real native/OS registrations, original source hashes unchanged in all migration cases and no unreviewed client-file writes.
- Depends on: T003. Commit message: `Resume safe setup without replacing joined or legacy records`.

#### T005. Separate runtime service startup from logon registration

- Screens: 1.5, 1.6, 1.7, 6.1. Decisions: 7, 8. Kind: JUDGMENT.
- Files: `engine/service/install.mjs`, `runServicePhases`, `configureOwnedService`, `installService`, `removeOwnedRegistration`; `engine/setup.mjs`, `configureService`; `scripts/build-installer.mjs`, `ownedInstallation`; `engine/service/service.mjs`, host ownership and shutdown; `test/service-install.test.mjs`, `test/service-lifecycle.test.mjs`, `test/interfaces-cli.test.mjs`.
- Change: decide the existing launcher lease used to retain the singleton for active hosts and sessions. Default installation writes protected payload/config and starts the runtime, with no scheduled task/systemd enable/LaunchAgent. `startWithWindows:false` is local, defaults absent to false, and is independent of runtime install ownership. `ownedInstallation` must recognize protected owned config and singleton metadata without requiring `registration.json`. Enabling/disabling the setting invokes only the existing verified owned registration functions; a failed registration leaves the prior setting and runtime state. Retain pulse/heartbeat requirements, with no new polling loop. The service progress row `Service registered for this user` describes its runtime ownership registration, not a logon task.
- Tests: add `default setup records zero logon registration runner calls`, `runtime ownership survives absent registration.json`, `enable startup records exactly one owned registration`, `disable startup preserves foreign registrations`, `registration failure preserves the prior startup setting`, `one active host prevents owned runtime shutdown`. Test Windows and Linux using injected runners only.
- Proof: `node --test test/service-install.test.mjs test/service-lifecycle.test.mjs test/interfaces-cli.test.mjs`; zero failures and zero real OS registrations.
- Depends on: T004. Commit message: `Make service logon registration an optional setting`.

#### T006. Render the four-step setup and its failure states

- Screens: 1.1 to 1.7. Decisions: 2, 3, 5, 6, 8, 22. Kind: JUDGMENT.
- Files: `engine/texts.mjs`, setup copy keys; `engine/setup.mjs`, `getStep`, `answer`, `back`; `gui/app.js`, `renderLocation`, step dispatch, `collectValues`, `submit`; `gui/styles.css`, setup form/progress/dialog classes; `gui/server.mjs`, wizard exact-body validation; `gui/electron.mjs`, `createWindowOptions`; `cli/index.mjs`, setup descriptor traversal; `test/setup.test.mjs`, `test/interfaces-server.test.mjs`, `test/interfaces-cli.test.mjs`.
- Change: decide descriptor compatibility for terminal setup while replacing the eight-step GUI. Use step IDs `install`, `location`, `service`, `ready` and step numbers 1 to 4. Remove mode/sync/origin controls. Location has Folder/Change, detected legacy checkbox on, disabled Use Relay+ with Coming soon; a selected 3.0 tree swaps legacy for Join this M1ND and Join. Service and Ready expose no Back. Service progress has five ordered rows: M1ND folder created and protected; Legacy M1ND copied and upgraded; Service registered for this user; Starting the service; Opening the Map. Failed rows show the actual safe cause and Retry; completed rows remain complete. Ready shows M1ND, Legacy M1ND when migrated, Service, Agents, Projects, then Open the Map. Counts and paths are actual data, not board samples.
  T002 already aligned the entry points and default-path assertions. Change the setup window's current 694 by 540 fixed bounds to a resizable 1440 by 900 initial window; verify the layout at the board viewport and a smaller supported viewport. No second desktop host is introduced.
- Visual values: centered setup width 640, padding 32, gap 22, radius 24, panel fill, line border; title 24/700; description 14.5/body; progress dots current 28x8, others 8x8; field padding 10x12, radius 12, card fill, line2; offer padding 12x14, gap 12, radius 14, waitSoft; tick 18; dialog 560 with padding 24, gap 18, radius 22; all controls at least 32. Brand at 32, 26, mark 28. Progress padding 14x16, gap 11, radius 14, card. Failed notice padding 12x14, gap 8, radius 14, error-soft with error line, headline 13.5/700, body 13.
- Copy: `Install HIVEM1ND` / `Instalar HIVEM1ND`; `Setup takes about a minute.` / `La instalación tarda aproximadamente un minuto.`; `Start setup` / `Iniciar la instalación`; `Control the Swarm from the Map` / `Controlar el Swarm desde el Mapa`; `Organize agents to reach objectives faster and better` / `Organizar agentes para alcanzar objetivos con más rapidez y mejores resultados`; `Relay is used for inter-session communication` / `Relay se utiliza para la comunicación entre sesiones`; `Where the M1ND lives` / `Dónde se guarda el M1ND`; `The M1ND holds your units, chats, boards and texts. Relay is optimized to run in cloud storage services for free syncing of your preferences.` / `El M1ND guarda unidades, chats, tableros y textos. Relay está optimizado para utilizar servicios de almacenamiento en la nube y sincronizar preferencias sin costo.`; `Migrate legacy M1ND` / `Migrar el M1ND anterior`; `Use Relay+` / `Utilizar Relay+`; `Coming soon` / `Próximamente`; `Sync your preferences on any device, phones included, through the same service as Nebula+.` / `Sincronizar preferencias en cualquier dispositivo, incluidos teléfonos, mediante el mismo servicio de Nebula+.`; `Starting the Relay service` / `Iniciando el servicio Relay`; `Installing` / `Instalando`; `HIVEM1ND is running` / `HIVEM1ND está en ejecución`; `Open the Map` / `Abrir el Mapa`; `Back` / `Volver`; `Continue` / `Continuar`; `Folder` / `Carpeta`; `Change` / `Cambiar`.
- Additional copy: `Step {step} of 4` / `Paso {step} de 4`; `A HIVEM1ND 2.x M1ND was found in {path}. It is copied and upgraded; the original stays untouched.` / `Se encontró un M1ND de HIVEM1ND 2.x en {path}. Se copia y actualiza; el original permanece intacto.`; `A HIVEM1ND 3.0 M1ND is already in this folder: {units} units, last used on {machine} at {time}. This machine joins it; nothing in it is replaced.` / `Esta carpeta ya contiene un M1ND de HIVEM1ND 3.0: {units} unidades, utilizado por última vez en {machine} a las {time}. Esta máquina se une al M1ND sin reemplazar su contenido.`; `These 2.x sessions still use the old M1ND. They are closed before the copy, so only the 3.0 service wakes sessions from now on. Their work is saved.` / `Estas sesiones de 2.x todavía utilizan el M1ND anterior. Se cierran antes de la copia para que solo el servicio de 3.0 active las sesiones. El trabajo se guarda.`; `One service per machine wakes your sessions and carries messages. It runs while HIVEM1ND needs it and uses nothing while idle.` / `Un servicio por máquina activa las sesiones y transporta mensajes. Se ejecuta mientras HIVEM1ND lo necesita y no consume recursos cuando está inactivo.`; `M1ND folder created and protected` / `Carpeta del M1ND creada y protegida`; `Legacy M1ND copied and upgraded` / `M1ND anterior copiado y actualizado`; `Service registered for this user` / `Servicio registrado para este usuario`; `Starting the service` / `Iniciando el servicio`; `Opening the Map` / `Abriendo el Mapa`; `The service did not start: port {port} is used by another program.` / `El servicio no se inició: otro programa utiliza el puerto {port}.`; `Nothing outside the M1ND folder was changed. Close that program and retry, or exit; setup resumes from this step when it is opened again.` / `No se modificó nada fuera de la carpeta del M1ND. Cerrar ese programa y reintentar, o salir; la instalación continúa desde este paso al abrirla de nuevo.`; `The service is running on {machine}. To add another machine, install HIVEM1ND there and choose the same M1ND folder.` / `El servicio está en ejecución en {machine}. Para agregar otra máquina, instalar HIVEM1ND allí y elegir la misma carpeta del M1ND.`; `Legacy M1ND` / `M1ND anterior`; `Migrated from 2.x, original untouched` / `Migrado desde 2.x, original intacto`; `{repositories} repositories in {folders} folders` / `{repositories} repositorios en {folders} carpetas`; `Agents, projects and content were detected with their defaults; Settings changes any of them.` / `Se detectaron agentes, proyectos y contenido con sus valores predeterminados. Se pueden cambiar desde Configuración.`
  The unchanged-scope sentence must be proved for the represented failure. A cause that affected a different scope uses its verified unchanged resources; no false untouched assertion is emitted.
- Tests: add four-step descriptors, no sync or mode fields, no Back on service/ready, busy/failed/success progress, Join and legacy mutual exclusivity, checkbox defaults, reopened failed step and accurate Ready counts. Replace old eight-step descriptor assertions in `test/setup.test.mjs`, `test/interfaces-server.test.mjs` and `test/interfaces-cli.test.mjs` with the complete four-step descriptor objects from this task's implementation; retain T002's default-path assertions.
- Proof: `node --test test/setup.test.mjs test/interfaces-server.test.mjs test/interfaces-cli.test.mjs`; zero failures; observed browser states match 1.1 to 1.7 before accepting this task.
- Depends on: T004, T005. Commit message: `Present four setup steps with resumable progress`.

#### T007. Keep the frame visible while opening and on first run

- Screens: 1.8, 1.9, 1.10. Decisions: 8, 20, 22. Kind: JUDGMENT.
- Files: `gui/app/main.mjs`, `mount`, `runBoot`, `renderStatus`, `renderFailure`, `renderWorkspace`, `openUnitForm`; `gui/app/styles.css`, boot/empty states; `gui/index.mjs`, folder reopen handoff; `test/gui-shell.test.mjs`, boot and empty fixtures; `test/gui-data.mjs`, empty/slow scenarios.
- Change: decide the safe folder handoff for Choose another folder without losing an existing host/draft. Show desktop frame immediately, then skeletons and Reading the M1ND. Read deadline is 30s. Failure retains frame, actual selected folder and Retry/Choose another folder. Empty collection with only master displays Create the Overseer, calls POST /units with unit:`overseer`, role:`overseer`, scope:{kind:`root`, name:null}, machine the current answering machine, position:{x: 372, y: 178}; no fabricated second master/Overseer. Success selects the created unit.
  Pass `deadlineMs: 30000` explicitly to the initial read until T018 establishes the shared default; this task has no dependency on a later task.
- Visual values: bar 52, status 30, workspace 818; side 266, map 760, inspector 366, gap 12, padding 0x12; skeleton radius 6, card2, padding 18, gap 14. Middle spinner 28; loading title 14/600, secondary 12.5/mute. Failure content 420 wide, centered, gap 12, error icon 24 in 52 circle; title 16/700, body 13; empty master 40 circle, dashed Overseer 64 circle centered 372, 178; inspector padding 32, gap 14.
- Copy: `Reading the M1ND` / `Leyendo el M1ND`; `The M1ND cannot be read` / `No se puede leer el M1ND`; `Choose another folder` / `Elegir otra carpeta`; `No units yet` / `Todavía no hay unidades`; `The Overseer comes first; create it from the inspector.` / `Crear primero el Overseer desde el inspector.`; `Your M1ND is empty` / `El M1ND está vacío`; `The Overseer coordinates every other unit. Create it first; then add Overlords and Executors from the Map.` / `El Overseer coordina las demás unidades. Crearlo primero y agregar después Overlords y Executors desde el Mapa.`; `Create the Overseer` / `Crear el Overseer`.
- Additional copy: `The Overseer goes here` / `El Overseer se coloca aquí`; `{path} did not answer in 30 s. The drive may be offline, or another program may hold the folder.` / `{path} no respondió en 30 s. La unidad puede estar desconectada o la carpeta puede estar bloqueada por otro programa.`; `{units} units, {groups} groups, {chats} chats, {boards} boards` / `{units} unidades, {groups} grupos, {chats} chats, {boards} tableros`; `Connecting to the service` / `Conectando con el servicio`; `Reading` / `Leyendo`; `M1ND not read` / `M1ND sin leer`.
- Tests: add delayed initial read with frame visible, timeout at 30000, Retry after failure, first-run creation once despite repeated click, failed first-run request retains empty state, inaccessible-folder cause with no credential exposure.
- Proof: `node --test test/gui-shell.test.mjs test/gui-transport.test.mjs`; zero failures and all three states verified in the running fixture at 1440 by 900.
- Depends on: T006. Commit message: `Show opening progress and the empty M1ND state`.

### P2. M1ND copy

#### T008. Keep product labels distinct from path and command identifiers

- Screens: all rows. Decisions: 2. Kind: MECHANICAL.
- Files: `engine/texts.mjs`, `text`; `gui/app/i18n.mjs`, `text`; `gui/index.mjs`, configuration error strings; `test/final-copy.test.mjs`, new.
- Change: in setup `text`, replace the reduce initializer `value,` with the following expression, leaving placeholder substitution after it:

```js
    value.replace(/(^|[^\p{L}\p{N}_{}/\\-])(mind|mente)(?=$|[^\p{L}\p{N}_{}/\\-])/giu, '$1M1ND'),
```

In GUI `text`, replace the complete return statement with:

```js
  return dictionary[key]
    .replace(/(^|[^\p{L}\p{N}_{}/\\-])(mind|mente)(?=$|[^\p{L}\p{N}_{}/\\-])/giu, '$1M1ND')
    .replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? ''));
```

In GUI COPY replace `"Leyendo la mente."` with `"Leyendo el M1ND."`, `"La mente no está disponible."` with `"El M1ND no está disponible."` and `"La mente es demasiado grande para cargarla de una vez."` with `"El M1ND es demasiado grande para cargarlo de una vez."`. In `gui/index.mjs`, replace each of its three literal `'The mind is not configured.'` strings with `'The M1ND is not configured.'`. Never apply this replacement to variables supplied by a person, filenames, flags or template parameter names.
In `engine/texts.mjs`, replace the Spanish `warningDependencyMissing` value exactly:

```js
    warningDependencyMissing: 'No se encontró una dependencia junto al kit, así que el M1ND no puede ejecutar los comandos que la utilizan: {name}. Ejecutar npm install en el kit y actualizar de nuevo.',
```

- Tests: create the complete file:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { text as setupText } from '../engine/texts.mjs';
import { dictionaryKeys, text as guiText } from '../gui/app/i18n.mjs';

test('visible setup and GUI templates use M1ND in both languages', async () => {
  const source = await readFile(new URL('../engine/texts.mjs', import.meta.url), 'utf8');
  const en = source.match(/\n  en: \{\n([\s\S]*?)\n  \},\n  es: \{/)?.[1];
  assert.ok(en);
  const setupKeys = [...en.matchAll(/^    (\w+): /gm)].map((match) => match[1]);
  for (const language of ['en', 'es']) {
    for (const key of setupKeys) {
      const label = setupText(language, key).replace(/\{\w+\}/g, '');
      assert.equal(/(?<![-\w/])(mind|mente)(?![-\w/])/iu.test(label), false, language + ':' + key);
    }
    for (const key of dictionaryKeys()) {
      assert.equal(/\b(mind|mente)\b/iu.test(guiText(language, key)), false, language + ':' + key);
    }
  }
});

test('M1ND copy never changes an interpolated path or a wire field', () => {
  const location = 'C:/fixture/mind/keep';
  assert.ok(setupText('en', 'attachedMachine', { mind: location }).includes(location));
  assert.ok(setupText('es', 'attachedMachine', { mind: location }).includes(location));
  assert.equal(guiText('en', 'loadingView'), 'Reading the M1ND.');
  assert.equal(guiText('es', 'loadingView'), 'Leyendo el M1ND.');
});
```

- Proof: `node --test test/final-copy.test.mjs test/spanish-register.test.mjs`; zero failures and no parameter/path changes.
- Depends on: T001. Commit message: `Use M1ND in visible bilingual labels`.

#### T009. Audit the remaining visible copy and neutral Spanish

- Screens: all 83. Decisions: 2, 22. Kind: JUDGMENT.
- Files: `engine/setup.mjs`, SERVICE_COPY; `cli/index.mjs`, help, `terminalCopy`, `mindText`, check findings; `gui/app/main.mjs`, hardcoded fallback labels; `gui/app/i18n.mjs`, COPY additions; `engine/service/identity.mjs`, `engine/service/paths.mjs`, `engine/service/projection.mjs`, `engine/service/service.mjs`, `engine/service/http.mjs`, safe errors; `test/spanish-register.test.mjs`, GUI source extraction; `test/gui-shell.test.mjs`, visible-copy cases.
- Change: decide the finite source-copy extraction boundary so user documents, technical enums and filenames are never rewritten. Replace every remaining product-facing mind/mente with M1ND, including safe core errors, wizard SERVICE_COPY and CLI help; preserve CLI spellings such as `--mind-path`, `--remove-mind` and function/field names. Add the exact bilingual strings specified by each UI task at the time that task runs. Spanish actions use infinitives; prose avoids second person. `Always for this unit` / `Siempre para esta unidad` replaces the visible Approve always label, while `approve-always` remains the wire decision. The visible six look names are proper names in both languages. No client/model name is invented in explanatory prose.
  T048 owns the look labels and all look-validation replacements. Preserve its listed before-text anchors here and in the earlier GUI tasks; T009's copy gate concerns M1ND and Spanish voice, while the final six-look label gate runs after T048.

Add these supplementary COPY entries. They close the static-label and explanation inventory for the UI tasks. Values in braces are data from the selected record, never fixed board sample values. The task owning the control uses these keys; sample document/chat content is fixture data and is not translated or rewritten by the copy layer.

```js
  finalHierarchy: ['Hierarchy', 'Jerarquía'],
  finalChats: ['Chats', 'Chats'],
  finalChain: ['Chain of command', 'Cadena de mando'],
  finalWithoutLead: ['Without an Overlord', 'Sin un Overlord'],
  finalServices: ['Services', 'Servicios'],
  finalPinned: ['Pinned', 'Fijados'],
  finalRecent: ['Recent', 'Recientes'],
  finalArchived: ['Archived', 'Archivados'],
  finalSearch: ['Search units, projects and chats', 'Buscar unidades, proyectos y chats'],
  finalNotifications: ['Notifications', 'Notificaciones'],
  finalSettings: ['Settings', 'Configuración'],
  finalMore: ['More', 'Más opciones'],
  finalPin: ['Pin', 'Fijar'],
  finalZoomIn: ['Zoom in', 'Acercar'],
  finalZoomOut: ['Zoom out', 'Alejar'],
  finalFit: ['Fit', 'Ajustar'],
  finalCancel: ['Cancel', 'Cancelar'],
  finalRetry: ['Retry', 'Reintentar'],
  finalSend: ['Send', 'Enviar'],
  finalApprove: ['Approve', 'Aprobar'],
  finalDeny: ['Deny', 'Denegar'],
  finalAccept: ['Accept', 'Aceptar'],
  finalOpenTask: ['Open task', 'Abrir tarea'],
  finalWhatChanges: ['What needs to change', 'Qué se debe cambiar'],
  finalSending: ['Sending', 'Enviando'],
  finalAnswerSent: ['Answer sent', 'Respuesta enviada'],
  finalWaitingConfirm: ['Waiting for the unit to confirm', 'Esperando la confirmación de la unidad'],
  finalStop: ['Stop', 'Detener'],
  finalStopSession: ['Stop session', 'Detener sesión'],
  finalCancelStart: ['Cancel start', 'Cancelar el inicio'],
  finalChooseClient: ['Choose another client', 'Elegir otro cliente'],
  finalStartSession: ['Start a session', 'Iniciar una sesión'],
  finalSessionLocation: ['{unit} on {machine}. The session runs in an agent CLI; only CLIs connected on that machine are offered.', '{unit} en {machine}. La sesión se ejecuta en una línea de comandos de un agente. Solo se ofrecen clientes conectados en esa máquina.'],
  finalCliConnected: ['CLI connected.', 'Línea de comandos conectada.'],
  finalCliChanges: ['Its CLI needs {count} changes first: Settings, Agents.', 'La línea de comandos necesita primero {count} cambios: Configuración, Agentes.'],
  finalChangesNeeded: ['Changes needed', 'Cambios necesarios'],
  finalExecutorLifecycle: ['An Executor applies one feature: by default it runs its task and closes. Opened on its own it is a chat, and from there it can open the CLIs it needs.', 'Un Executor implementa una función. De forma predeterminada, ejecuta su tarea y se cierra. Al abrirse por separado, permanece como chat y puede solicitar las líneas de comandos necesarias.'],
  finalManualStart: ["To run it by hand instead, open an agent's app and run {command}.", 'Para ejecutarlo manualmente, abrir una aplicación de agente y ejecutar {command}.'],
  finalStartingSession: ['Starting a session', 'Iniciando una sesión'],
  finalRequestSent: ['Request sent', 'Solicitud enviada'],
  finalStartingClient: ['Starting {client} on {machine}', 'Iniciando {client} en {machine}'],
  finalSessionConnected: ['Session connected', 'Sesión conectada'],
  finalClientTimeout: ['{client} did not answer in 30 seconds.', '{client} no respondió en 30 segundos.'],
  finalNoStart: ['Nothing was started. It may still be updating; try again, or choose another client.', 'No se inició ninguna sesión. El cliente puede estar actualizándose. Reintentar o elegir otro cliente.'],
  finalUncertainStart: ['The start was not confirmed. Retry checks the same request before starting another session.', 'No se confirmó el inicio. Reintentar comprueba la misma solicitud antes de iniciar otra sesión.'],
  finalQueuedDelivery: ['Sent now, it is delivered when the session connects', 'Se envía ahora y se entrega cuando la sesión se conecta'],
  finalNotRunning: ['{unit} is not running', '{unit} no está en ejecución'],
  finalNeedsOnline: ['Needs {machine} online', 'Se necesita {machine} conectada'],
  finalRunsIn: ['Runs in', 'Se ejecuta en'],
  finalReportsTo: ['Reports to', 'Reporta a'],
  finalMailbox: ['Mailbox', 'Buzón'],
  finalNotStarted: ['Not started', 'Sin iniciar'],
  finalDefaultModel: ["The client's default", 'Predeterminado del cliente'],
  finalNoLead: ['No Overlord', 'Sin Overlord'],
  finalNoMessages: ['No messages yet', 'Todavía no hay mensajes'],
  finalMailboxWait: ['Messages wait in its mailbox until a session starts.', 'Los mensajes permanecen en el buzón hasta que se inicia una sesión.'],
  finalComposerWait: ['It waits in the mailbox until a session starts', 'Permanece en el buzón hasta que se inicia una sesión'],
  finalGroupSummary: ['Group, {count} units', 'Grupo, {count} unidades'],
  finalSelection: ['{count} selected', '{count} seleccionadas'],
  finalSelectionHint: ['A drag on empty space selects; Shift adds', 'Arrastrar en el espacio vacío para seleccionar; Shift agrega unidades'],
  finalGroupHint: ['A group keeps these units together: a folder in Hierarchy, a zone on the Map and one group chat.', 'Un grupo reúne estas unidades en una carpeta de Jerarquía, una zona del Mapa y un chat grupal.'],
  finalNewGroupHint: ['A folder in Hierarchy, a zone on the Map and one group chat. Who reports to whom does not change.', 'Una carpeta de Jerarquía, una zona del Mapa y un chat grupal. Las relaciones de reporte no cambian.'],
  finalDeleteGroupTitle: ['Delete the group {title}?', '¿Eliminar el grupo {title}?'],
  finalDeleteGroupScope: ['Its folder and its zone go. Its chat moves to Archived in Chats. The {count} units, their chats and who they report to do not change.', 'Se eliminan la carpeta y la zona. El chat pasa a Archivados en Chats. Las {count} unidades, sus chats y sus relaciones de reporte no cambian.'],
  finalConnectTitle: ['Connect {unit}', 'Conectar {unit}'],
  finalConnectScope: ['{unit} will report to {lead}. Groups and chats do not change.', '{unit} reportará a {lead}. Los grupos y los chats no cambian.'],
  finalNewUnitHint: ['It appears on the Map at once; start its session when you need it.', 'La unidad aparece de inmediato en el Mapa. Iniciar su sesión cuando sea necesario.'],
  finalStopTitle: ['Stop the session of {unit}?', '¿Detener la sesión de {unit}?'],
  finalStopScope: ['Its work in progress stops. The unit keeps its chat, mailbox, tasks and groups, and a new session can start later.', 'Se detiene el trabajo en curso. La unidad conserva su chat, buzón, tareas y grupos. Se puede iniciar una sesión nueva después.'],
  finalRemoveUnitTitle: ['Remove {unit}?', '¿Quitar {unit}?'],
  finalRemoveUnitScope: ['It leaves the Map and Hierarchy. Its chat and mailbox move to Archived and its tasks stay in the project. A session running now is stopped first.', 'La unidad deja el Mapa y Jerarquía. Su chat y buzón pasan a Archivados y sus tareas permanecen en el proyecto. Primero se detiene cualquier sesión en ejecución.'],
  finalSendBackTitle: ['Send task {number} back', 'Devolver la tarea {number}'],
  finalSendBackScope: ['{unit} reads your note and the task goes back to open.', '{unit} recibe la nota y la tarea vuelve al estado abierto.'],
  finalTaskAccepted: ['Task {number} accepted', 'Tarea {number} aceptada'],
  finalNoComments: ['No comments yet', 'Todavía no hay comentarios'],
  finalBoardCommentHint: ['Select an element on the board and press C to comment on it.', 'Seleccionar un elemento del tablero y pulsar C para comentarlo.'],
  finalTextCommentHint: ['Select a passage to comment on it or to ask the agent for a change.', 'Seleccionar un pasaje para comentarlo o solicitar un cambio al agente.'],
  finalAttached: ['Attached', 'Adjuntos'],
  finalWatch: ['Watch', 'Seguir'],
  finalWatching: ['Watching', 'Siguiendo'],
  finalLive: ['Live', 'En directo'],
  finalCreateBoard: ['Create board', 'Crear tablero'],
  finalNewBoardHint: ["A board lives in a project's repository, in one of your folders.", 'El tablero se guarda en el repositorio de un proyecto, dentro de una de las carpetas.'],
  finalEmptyHint: ['Start with one frame and draw.', 'Comenzar con un marco y dibujar.'],
  finalDuplicateHint: ['Copy the screens of a board you choose; comments stay behind.', 'Copiar las pantallas del tablero seleccionado. Los comentarios no se copian.'],
  finalImportHint: ['A JSON copy is made next to the module and opened here; the module stays untouched.', 'Se crea una copia JSON junto al módulo y se abre aquí. El módulo permanece intacto.'],
  finalMoveTitle: ['Move {title} to {folder}?', '¿Mover {title} a {folder}?'],
  finalMoveScope: ["The folder {folder} belongs to another project. The board's file moves from the {source} repository to the {destination} repository, and both repositories show the change.", 'La carpeta {folder} pertenece a otro proyecto. El archivo del tablero se mueve del repositorio {source} al repositorio {destination}. Ambos repositorios muestran el cambio.'],
  finalMoveAction: ['Move to {folder}', 'Mover a {folder}'],
  finalDeleteTitle: ['Delete {title}?', '¿Eliminar {title}?'],
  finalDeleteBoardScope: ["Its screens, sketches and comments go with it, and attached agents are told. A copy committed before stays in the repository's history.", 'Se eliminan las pantallas, los bocetos y los comentarios, y se informa a los agentes adjuntos. Una copia confirmada antes permanece en el historial del repositorio.'],
  finalDeleteTextScope: ['The text and its comments go. A folder is deleted the same way and names how many texts it holds. Undo brings it back for 10 seconds.', 'Se eliminan el texto y sus comentarios. La confirmación de una carpeta indica cuántos textos contiene. Deshacer permite recuperarlos durante 10 segundos.'],
  finalDeleteFolderScope: ['This folder and its {count} items are removed. Undo brings them back for 10 seconds.', 'Se eliminan esta carpeta y sus {count} elementos. Deshacer permite recuperarlos durante 10 segundos.'],
  finalLook: ['Look', 'Aspecto'],
  finalPreviewHint: ["Each preview is drawn in the look's own palette; a choice applies at once.", 'Cada vista previa utiliza su propia paleta. El aspecto se aplica de inmediato.'],
  finalPhoneHint: ['See, chat and approve from your phone while it is on the same network. Access closes after 12 hours.', 'Consultar, conversar y aprobar desde el teléfono en la misma red. El acceso se cierra después de 12 horas.'],
  finalPhoneStatus: ['Open until {time}, {count} phone signed in', 'Abierto hasta las {time}, {count} teléfono conectado'],
  finalPhoneStatusPlural: ['Open until {time}, {count} phones signed in', 'Abierto hasta las {time}, {count} teléfonos conectados'],
  finalRunningOn: ['Running on {machine}', 'En ejecución en {machine}'],
  finalOn: ['On', 'Activado'],
  finalOff: ['Off', 'Desactivado'],
  finalThisMachine: ['{machine}, this machine', '{machine}, esta máquina'],
  finalMachineOffline: ['Offline since {time}: its last report, read only', 'Desconectada desde las {time}: último informe, solo lectura'],
  finalAgentsOn: ['Agents on {machine}', 'Agentes en {machine}'],
  finalScanned: ['Scanned {time}', 'Búsqueda realizada a las {time}'],
  finalCliExplanation: ['The command line is how HIVEM1ND runs your units: it opens a session for each task and closes it. Auto loads the M1ND rules in every session; On demand only when a HIVEM1ND command runs.', 'HIVEM1ND ejecuta las unidades desde la línea de comandos: abre una sesión por tarea y la cierra al terminar. Automático carga las reglas del M1ND en cada sesión. Bajo demanda las carga al ejecutar un comando de HIVEM1ND.'],
  finalAppExplanation: ["The desktop app is separate and optional: connecting it lets you write to an agent in its own window, and the M1ND wakes it when a message arrives.", 'La aplicación de escritorio es independiente y opcional. Conectarla permite escribir al agente en su propia ventana. El M1ND lo activa cuando llega un mensaje.'],
  finalManualExplanation: ["A unit can also be run by hand in an agent's app with its command, for example /executor shop. It joins the M1ND, keeps its place in the hierarchy and shows on the Map like any other.", 'También se puede ejecutar una unidad manualmente en una aplicación mediante su comando, por ejemplo /executor shop. Se une al M1ND, conserva su posición en Jerarquía y aparece en el Mapa.'],
  finalStandingExplanation: ['Each one was given with Always for this unit in a chat. Revoke takes it back; the next request asks again.', 'Cada aprobación se otorgó con Siempre para esta unidad en un chat. Revocar la retira. La siguiente solicitud vuelve a pedir aprobación.'],
  finalAgentPermissionExplanation: ['Given in Connect an agent, only for sessions HIVEM1ND starts on this machine. Commits and pushes still run only when a person asks for them.', 'Otorgados al conectar un agente, solo para las sesiones que HIVEM1ND inicia en esta máquina. Los commits y pushes se ejecutan únicamente ante una solicitud explícita.'],
  finalReviewExplanation: ['HIVEM1ND needs these changes on {machine}. Nothing is written until you apply them; Copy changes gives them to make by hand.', 'HIVEM1ND necesita estos cambios en {machine}. No se escribe nada hasta elegir Aplicar. Copiar cambios permite realizarlos manualmente.'],
  finalBackupExplanation: ['A copy of each file is kept; Disconnect puts it back.', 'Se conserva una copia de cada archivo. Desconectar la restaura.'],
  finalRestartClientExplanation: ['{client} is restarted after the changes to load them.', '{client} se reinicia después de los cambios para cargarlos.'],
  finalProjectDiscovery: ['Repositories inside a folder are found by themselves; each can be removed.', 'Los repositorios de cada carpeta se detectan automáticamente. Se puede quitar cada uno.'],
  finalPlanning: ['Planning', 'Planificación'],
  finalQuality: ['Quality', 'Calidad'],
  finalContinuity: ['Continuity', 'Continuidad'],
  finalOther: ['Other', 'Otras'],
  finalSecurityPack: ['Security', 'Seguridad'],
  finalDesignPack: ['Design', 'Diseño'],
  finalCopyPack: ['Copy', 'Redacción'],
  finalCodingPack: ['Coding', 'Programación'],
  finalSetupDiscovery: ['Found by setup: {folders} folders, {repositories} repositories', 'Detectados durante la instalación: {folders} carpetas, {repositories} repositorios'],
  finalRemoveProjectTitle: ['Remove {project} from the M1ND?', '¿Quitar {project} del M1ND?'],
  finalRemoveProjectScope: ['Its units, boards and texts stop showing here. The repository and its files stay on disk, untouched; adding the folder again brings them back.', 'Las unidades, los tableros y los textos dejan de aparecer aquí. El repositorio y sus archivos permanecen intactos en el disco. Agregar la carpeta de nuevo restaura su visibilidad.'],
  finalTypeCode: ['Or type this code', 'También se puede introducir este código'],
  finalAt: ['At', 'En'],
  finalAccessCloses: ['Access closes in {hours} h {minutes} min', 'El acceso se cierra en {hours} h {minutes} min'],
  finalNewCodeHint: ['A new code replaces this one; closing access signs the phone out.', 'Un código nuevo reemplaza al actual. Cerrar el acceso desconecta el teléfono.'],
  finalDone: ['Done', 'Listo'],
  finalTakingLonger: ['Taking longer than usual', 'Tardando más de lo habitual'],
  finalSlowExplanation: ['The service has not answered for {seconds} s. It stops waiting at 30 s and offers Retry.', 'El servicio no respondió durante {seconds} s. La espera termina a los 30 s y ofrece Reintentar.'],
```

- Tests: extend the register test to include GUI dictionaries and setup service copy. Extract mounted visible text from the existing states in both languages, retaining technical path/command exceptions by element identity. Report the exact element/key for a forbidden visible word or second-person Spanish form. T064 extends this same extraction to the completed 83 states; this task does not depend on future UI implementation.
- Proof: `node --test test/spanish-register.test.mjs test/final-copy.test.mjs test/gui-shell.test.mjs`; zero failures and both languages pass the current copy inventory. The complete final-state inventory is a T064 gate.
- Depends on: T008. Commit message: `Enforce neutral bilingual product copy across surfaces`.

### P3. Groups, aliases and unit removal

#### T010. Persist aliases without changing unit identity

- Screens: 2.3, 2.4. Decisions: 10. Kind: MECHANICAL.
- Files: `engine/service/units.mjs`, new `setUnitAlias` before `patchLayout`; `engine/service/projection.mjs`, `readUnit` and `searchText`; `test/service-projection.test.mjs`, imports and added case.
- Change: insert:

```js
export async function setUnitAlias(context, unitId, input) {
  const parsed = parseUnitId(unitId);
  const current = await readState(context, parsed);
  if (!current) throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  if (!Object.hasOwn(input ?? {}, 'alias')) throw new CoreError(422, 'invalid_body', 'An alias value is required.');
  const alias = input.alias === null ? '' : input.alias;
  if (typeof alias !== 'string' || alias.length > 128 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(alias)) {
    throw new CoreError(422, 'invalid_alias', 'The alias must be a single line of at most 128 characters.');
  }
  const next = replaceHeader(current.bytes, 'alias', alias.trim());
  const events = [
    { name: 'unit.changed', data: { unit: { id: parsed.id } } },
    { name: 'view.changed', data: { revision: hashBytes(next), collections: ['units', 'leads', 'squads'] } },
  ];
  return finish(context, {
    events,
    stage: [{ target: { kind: 'mind', path: current.relative }, bytes: next }],
  }, transactionOf(context, [{ resource: current.relative, recordPath: current.absolute,
    beforeRevision: input.expectedRevision, afterBytes: next }], events));
}
```

In `readUnit`'s blank object, append `alias:null` beside `unit`. In the successful return object immediately after `unit: headers.get('unit') || id.unit,`, insert `alias: headers.get('alias')?.trim() || null,`. In `searchText`'s units/leads branch replace its return expression with:

```js
    return [item.unit, item.alias, item.job, item.context].filter((value) => typeof value === 'string').join(' ');
```

- Tests: add `setUnitAlias` to the existing units import in `test/service-projection.test.mjs`, then append:

```js
test('an alias changes display and search without changing identity or lead', async (t) => {
  const fixture = await mind(t);
  const context = serviceContext(fixture);
  const relative = path.join(fixture.paths.mind, 'user', 'state', 'executor-blog.md');
  const original = Buffer.from('unit: executor-blog\nunit-id: root:executor-blog\nrole: executor\nstate: out\nmachine: DESKTOP\nlead-id: root:overseer\n\nalias: body content stays.\n');
  await writeFile(relative, original);
  const changed = await setUnitAlias(context, 'root:executor-blog', { alias: ' Blog ', expectedRevision: revisionOf(original) });
  assert.equal(changed.unit.id, 'root:executor-blog');
  assert.equal(changed.unit.unit, 'executor-blog');
  assert.equal(changed.unit.alias, 'Blog');
  assert.equal(changed.unit.leadId, 'root:overseer');
  const found = await readCollection(context, 'units', { q: 'Blog' });
  assert.equal(found.items.some((unit) => unit.id === 'root:executor-blog'), true);
  const beforeClear = await readFile(relative);
  const cleared = await setUnitAlias(context, 'root:executor-blog', { alias: null, expectedRevision: revisionOf(beforeClear) });
  assert.equal(cleared.unit.alias, null);
  assert.ok((await readFile(relative, 'utf8')).endsWith('\nalias: body content stays.\n'));
  await assert.rejects(setUnitAlias(context, 'root:executor-blog', { alias: 'Unsafe\nline', expectedRevision: cleared.unit.revision }), { code: 'invalid_alias' });
  await assert.rejects(setUnitAlias(context, 'root:executor-blog', { alias: 'Other', expectedRevision: revisionOf(original) }), { code: 'revision_conflict' });
});
```

- Proof: `node --test test/service-projection.test.mjs`; zero failures; alias clear preserves a body line also beginning `alias:`.
- Depends on: T001. Commit message: `Persist unit aliases while retaining canonical identity`.

#### T011. Expose the alias route and browser operation

- Screens: 2.3, 2.4. Decisions: 10. Kind: MECHANICAL.
- Files: `engine/service/http.mjs`, units import, ROUTES, `allowedBody`, `invoke`; `gui/app/actions.mjs`, new `setUnitAlias`; `test/service-api.test.mjs`, new route case inside existing service api describe.
- Change: append `setUnitAlias` to the core units named import; add the following route immediately after GET /units/:unitId:

```js
  ['PATCH', '/units/:unitId/alias', 'unit.create', 'D', 'setUnitAlias'],
```

Add this allowedBody entry:

```js
    'PATCH /units/:unitId/alias': ['alias', 'expectedRevision'],
```

Before the createUnit handler in `invoke`, insert:

```js
  if (route.handler === 'setUnitAlias') {
    const changed = await setUnitAlias(domain, params.unitId, body);
    return { status: 200, body: changed.unit };
  }
```

Append to `gui/app/actions.mjs`:

```js
export async function setUnitAlias(api, unit, alias, retained = null) {
  const operation = retained ?? createOperation({
    method: 'PATCH', path: '/units/:unitId/alias', params: { unitId: unit.id },
    body: { alias, expectedRevision: unit.revision },
  });
  return commit(api, operation);
}
```

- Tests: append inside the existing `describe`, where `boot` and `call` are in scope:

```js
test('alias HTTP writes return a complete unit and replay the same receipt', async (t) => {
  const { core, paths, fixture, token } = await boot(t);
  await writeBeat({ store: fixture.store, paths, now: () => fixture.clock.now }, 'running');
  const created = await call(core.http.port, 'POST', '/api/v1/units', {
    token, headers: { 'idempotency-key': randomUUID() },
    body: { unit: 'executor-blog', role: 'executor', scope: 'root', machine: fixture.machine },
  });
  assert.equal(created.status, 201);
  const key = randomUUID();
  const body = { alias: 'Blog', expectedRevision: created.json.data.revision };
  const target = '/api/v1/units/root%3Aexecutor-blog/alias';
  const first = await call(core.http.port, 'PATCH', target, { token, body, headers: { 'idempotency-key': key } });
  assert.equal(first.status, 200);
  assert.equal(first.json.data.alias, 'Blog');
  const repeated = await call(core.http.port, 'PATCH', target, { token, body, headers: { 'idempotency-key': key } });
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.json.data, first.json.data);
  const unknown = await call(core.http.port, 'PATCH', target, { token,
    body: { ...body, name: 'changed-id' }, headers: { 'idempotency-key': randomUUID() } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error.code, 'unknown_field');
});
```

- Proof: `node --test test/service-api.test.mjs test/service-projection.test.mjs`; zero failures, one identity and one alias effect after receipt replay.
- Depends on: T010. Commit message: `Expose revision-checked alias operations`.

#### T012. Use an alias-aware name without hiding the real unit name

- Screens: 2.3, 2.4, 2.9, 3.1. Decisions: 10. Kind: MECHANICAL.
- Files: `gui/app/hierarchy.mjs`, `unitRow`, `matches`, new `unitDisplayName`; `gui/app/inspector.mjs`, `renderUnit` title; `test/final-unit-labels.test.mjs`, new. T016 uses this helper in Map/chat rendering.
- Change: append to hierarchy:

```js
export function unitDisplayName(unit) {
  const id = String(unit?.unit ?? unit?.id ?? '');
  const alias = typeof unit?.alias === 'string' ? unit.alias.trim() : '';
  return alias ? alias + ' (' + id + ')' : id;
}
```

Replace `label: unit.unit` in `unitRow` with `label: unitDisplayName(unit)`. In `matches`, replace `[unit.unit, unit.job, unit.context]` with `[unit.unit, unit.alias, unit.job, unit.context]`. In inspector add `import { unitDisplayName } from './hierarchy.mjs';` and replace `text: unit?.unit ?? t("unknown")` with `text: unit ? unitDisplayName(unit) : t("unknown")`.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { unitDisplayName } from '../gui/app/hierarchy.mjs';

test('alias labels retain the actual unit name and preserve user text', () => {
  assert.equal(unitDisplayName({ id: 'project:blog:executor-blog', unit: 'executor-blog', alias: 'Blog' }), 'Blog (executor-blog)');
  assert.equal(unitDisplayName({ unit: 'executor-blog', alias: null }), 'executor-blog');
  assert.equal(unitDisplayName({ unit: 'executor-blog', alias: 'M1ND notes' }), 'M1ND notes (executor-blog)');
});
```

- Proof: `node --test test/final-unit-labels.test.mjs test/gui-map.test.mjs`; zero failures; scoped IDs remain operation keys.
- Depends on: T011. Commit message: `Display aliases beside stable unit names`.

#### T013. Bound personal group zones around actual members

- Screens: 2.7, 2.9. Decisions: 9. Kind: MECHANICAL.
- Files: `gui/app/map-geometry.mjs`, new `personalGroupBounds`; `gui/app/styles.css`, supporting Modern/Nocturne token definitions; `test/final-group-bounds.test.mjs`, new.
- Change: append:

```js
export function personalGroupBounds(memberIds, nodes, padding = 24) {
  const members = new Set(memberIds);
  const selected = nodes.filter((node) => members.has(node.id));
  if (!selected.length) return null;
  const left = Math.min(...selected.map((node) => node.x - node.radius));
  const right = Math.max(...selected.map((node) => node.x + node.radius));
  const top = Math.min(...selected.map((node) => node.y - node.radius));
  const bottom = Math.max(...selected.map((node) => node.y + node.radius + 24));
  return { x: left - padding, y: top - padding,
    w: right - left + padding * 2, h: bottom - top + padding * 2 };
}
```

The 24 pixels below each circle reserve its board label. Bounds derive from current positions. Zone radius is 22 in Modern/family looks and 10 in Nocturne; selected stroke is 2/accent, otherwise 1.4/ring; dash is 75; fill is accent-soft/ring-soft. The label starts 14 pixels from the left and 11 pixels above the top, with zone-label fill, radius 7, padding 2x8, gap 5, folder icon 12 and title 11.5/700. T016 implements the painting and tests moving every member without clipped labels.

Append these supporting tokens before the group painter needs them. T049 later adds the four family palettes. Every raw color here is a token definition copied from the final kit.

```css
:root {
  --accent-soft: rgba(189, 205, 121, 0.14);
  --waiting-soft: rgba(230, 192, 111, 0.12);
  --ring-soft: rgba(164, 138, 175, 0.14);
  --ground: #130e17;
  --me: #3a2c43;
  --me-text: #f5f1f6;
  --edge: rgba(164, 138, 175, 0.45);
  --selected: #2e3324;
  --label-bg: rgba(15, 11, 19, 0.75);
  --zone: rgba(164, 138, 175, 0.35);
  --zone-fill: rgba(164, 138, 175, 0.04);
  --zone-label: #120d16;
  --error: #e58e7c;
  --error-soft: rgba(229, 142, 124, 0.12);
  --error-ink: #1d0b08;
}
[data-look="high-contrast"] {
  --accent-soft: rgba(212, 176, 106, 0.14);
  --waiting-soft: rgba(212, 176, 106, 0.12);
  --ring-soft: rgba(212, 176, 106, 0.45);
  --ground: #050505;
  --me: #1b1b1b;
  --me-text: #f1efe9;
  --edge: #3d3d3d;
  --selected: #1f1a10;
  --label-bg: rgba(5, 5, 5, 0.8);
  --zone: #3a3a3a;
  --zone-fill: rgba(0, 0, 0, 0);
  --zone-label: #050505;
}
```

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { personalGroupBounds } from '../gui/app/map-geometry.mjs';

test('personal group bounds include member radii and labels without changing coordinates', () => {
  const nodes = [{ id: 'a', x: 100, y: 100, radius: 23 }, { id: 'b', x: 200, y: 300, radius: 28 }, { id: 'outside', x: 999, y: 999, radius: 30 }];
  const before = structuredClone(nodes);
  assert.deepEqual(personalGroupBounds(['a', 'b'], nodes), { x: 53, y: 53, w: 199, h: 323 });
  assert.deepEqual(nodes, before);
  assert.equal(personalGroupBounds(['missing'], nodes), null);
});
```

- Proof: `node --test test/final-group-bounds.test.mjs test/gui-map.test.mjs`; zero failures; nonmembers do not enlarge the zone.
- Depends on: T001. Commit message: `Derive personal group zones from their members`.

#### T014. Journal groups and their linked archived chats

- Screens: 2.7 to 2.10, 3.1. Decisions: 9, 16. Kind: JUDGMENT.
- Files: new `engine/service/groups.mjs`, `createGroup`, `patchGroup`, `removeGroup`, `listGroups`; `engine/service/chats.mjs`, explicit group chat creation and metadata edits; `engine/service/projection.mjs`, group records, archived chat filter/counts; `engine/service/http.mjs`, routes/body/query/invoke; `engine/service/events.mjs`, group visibility; `engine/service/import-events.mjs`, imported group/chat updates; `engine/service/store.mjs`, group transaction/undo authorization; `engine/sync/store.mjs`, eligible group records; `test/service-groups.test.mjs`, new; `test/service-api.test.mjs`, `test/sync-apply.test.mjs`; `test/gui-fixture.mjs`, group protocol implementation.
- Change: decide atomic group/chat preparation and revision handling so no orphan chat appears after a failed create. Implement C02 routes, records and event exactly, with one UUID for group/chat, canonical members and no lead mutation. Removal is a tombstone plus archived chat, rather than physical history deletion. Implement C05's ten-second generic undo for these objects first, using `POST /changes/:changeId/undo`, and share it with subsequent removal tasks. Return actual changed revision after durable commit, including replayed receipts. Archive filter is `archived=true`, distinct from existing unlisted retained direct chats.
- Tests: complete group validation, one-member group distinct from direct chat, cross-scope members, unchanged leads, title/member transaction, stale either record, crash after first write, receipt replay once, delete/archive without message removal, valid/expired/conflicting Undo, identical sync transaction on two fixture machines, denied phone/agent mutation.
- Proof: `node --test test/service-groups.test.mjs test/service-api.test.mjs test/sync-apply.test.mjs`; zero failures and no orphan chat or lead change under injected failures.
- Depends on: T011, T013. Commit message: `Keep personal groups and their chats in one transaction`.

#### T015. Add explicit browser group operations

- Screens: 2.8, 2.9, 2.10. Decisions: 9, 16. Kind: MECHANICAL.
- Files: `gui/app/actions.mjs`, new group/undo exports; `test/final-group-operations.test.mjs`, new.
- Change: append:

```js
export function createGroup(api, title, members, retained = null) {
  return commit(api, retained ?? createOperation({ method: 'POST', path: '/groups', body: { title, members } }));
}
export function patchGroup(api, group, change, retained = null) {
  return commit(api, retained ?? createOperation({ method: 'PATCH', path: '/groups/:groupId', params: { groupId: group.id },
    body: { ...change, expectedRevision: group.revision } }));
}
export function removeGroup(api, group, retained = null) {
  return commit(api, retained ?? createOperation({ method: 'DELETE', path: '/groups/:groupId', params: { groupId: group.id },
    body: { confirmed: true, expectedRevision: group.revision } }));
}
export function undoChange(api, changeId, retained = null) {
  return commit(api, retained ?? createOperation({ method: 'POST', path: '/changes/:changeId/undo', params: { changeId }, body: {} }));
}
```

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../gui/app/api.mjs';
import { createGroup, removeGroup, undoChange } from '../gui/app/actions.mjs';

test('group writes carry exact bodies and deletion undo uses its own route', async () => {
  const calls = [];
  const api = createApi({ location: { origin: 'http://127.0.0.1:12345', hash: '#session=fixture' }, history: { replaceState() {} },
    fetch: async (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
      return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data: {}, meta: { requestId: 'fixture', readAt: '2026-10-13T00:00:00.000Z', eventCursor: 'fixture:1', sync: 'local' } }), { status: 200 });
    } });
  await createGroup(api, 'Checkout launch', ['root:executor-shop']);
  await removeGroup(api, { id: '11111111-1111-4111-8111-111111111111', revision: 'a'.repeat(64) });
  await undoChange(api, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(calls[0].body, { title: 'Checkout launch', members: ['root:executor-shop'] });
  assert.deepEqual(calls[1].body, { confirmed: true, expectedRevision: 'a'.repeat(64) });
  assert.deepEqual(calls[2].body, {});
  assert.ok(calls[2].url.endsWith('/changes/22222222-2222-4222-8222-222222222222/undo'));
  assert.equal(new Set(calls.map((call) => call.key)).size, 3);
});
```

- Proof: `node --test test/final-group-operations.test.mjs test/gui-actions.test.mjs`; zero failures, one operation key per logical mutation.
- Depends on: T014. Commit message: `Add browser operations for personal groups and Undo`.

#### T016. Present groups, alias editing and the selection inspector

- Screens: 2.1 to 2.13, 3.1. Decisions: 9, 10, 16, 22. Kind: JUDGMENT.
- Files: `gui/app/hierarchy.mjs`, tree/flatten/activation; `gui/app/map.mjs`, `renderMap`, personal zone hit selection and group data; `gui/app/main.mjs`, `collectionRows`, `ensureMap`, `renderInspector`, `openUnitForm`, `messageSender`, `chatPanel`, group dialog/menu/toast; `gui/app/state.mjs`, groups selection/events; `gui/app/i18n.mjs`, group/alias keys; `gui/app/styles.css`, group/alias/selection panels; `test/gui-fixture.mjs`, group/alias protocol; `test/gui-map.test.mjs`, `test/gui-shell.test.mjs`.
- Change: decide keyboard/focus behavior and personal-zone overlap selection while retaining the existing free Map. My groups precedes Chain of command, with named folder-plus button, expandable folders and counts. Click folder/zone/chat selects one group. Group inspector shows title, Group/count, avatars, More, Members, Created, all member replies and Message the group. Selection inspector offers Save as group, Message all {count}, Connect to a lead, Clear selection. Message all creates an ordinary conversation without saving a personal Group. New group name/member chooser does not change leads. New unit adds optional Group after Reports to and persists membership only after successful unit creation. F 2 and Rename in More edit alias; Enter saves, Escape cancels; double click centers, never edits. Alias appears as separate emphasized 13.5/700 text and original name 11/mono/mute in Hierarchy, Map label/inspector/chat header. Undo sends the recorded previous alias under current revision, with no guessed value.
- Visual values: side 266, inspector 366, map 760; group rows gap 8, padding 6x8, radius 10, title 13.5/600, count 12; member rows indentation 24. Selection header 38avatar, padding 18x18x10, title 15/700; action column padding 8x18, gap 10. New group dialog 520, padding 24, gap 18, radius 22; chips padding 5x10, gap 6, radius-pill; New unit dialog 560 with three 14-gap pairs, fields 12radius. Existing role circles 40/master, 64/Overseer, 56/Overlord, 46/Executor, their role icon 18 or 22; group bounds/paint are T013. Working filled, waiting thick ring, idle thin ring.
- Copy: `My groups` / `Grupos propios`; `Save as group` / `Guardar como grupo`; `Message all {count}` / `Enviar un mensaje a las {count} unidades`; `Connect to a lead` / `Conectar a un líder`; `Clear selection` / `Borrar la selección`; `New group` / `Nuevo grupo`; `Create group` / `Crear grupo`; `Name` / `Nombre`; `Members` / `Miembros`; `Add` / `Agregar`; `Message the group` / `Enviar un mensaje al grupo`; `Every member sees every reply` / `Cada miembro ve todas las respuestas`; `Rename` / `Renombrar`; `Alias` / `Alias`; `Alias only. The id stays {unit}; Enter saves, Esc cancels.` / `Solo cambia el alias. El id permanece como {unit}; Enter guarda y Esc cancela.`; `Delete group` / `Eliminar grupo`; `Undo` / `Deshacer`.
- Tests: folder/zone/chat selection identity, groups above chain, no accidental lead edits, alias keyboard/menu/cancel/conflict/undo, double-click centering, selection recipient count, unit optional-group creation failure, archived group/Undo 10s and original direct chats retained. Verify existing 2.5/2.6 confirmation direction and rollback, with Saved/Undo only after authoritative commit, not a premature success toast.
- Proof: `node --test test/gui-map.test.mjs test/gui-actions.test.mjs test/gui-shell.test.mjs`; zero failures; GUI matches 2.1 to 2.13 including offline machine disabled reason.
- Depends on: T012, T015. Commit message: `Show personal groups and aliases throughout the Map`.

#### T017. Remove a unit through acknowledged stop and archive

- Screens: 2.18. Decisions: 16. Kind: JUDGMENT.
- Files: `engine/service/units.mjs`, `removeUnit`; `engine/service/adapters.mjs`, confirmed stop result; `engine/service/projection.mjs`, archived unit/mailbox visibility; `engine/service/http.mjs`, unit DELETE/archived query; `engine/service/groups.mjs`, member validation; `gui/app/actions.mjs`, removal operation; `gui/app/main.mjs`, More removal/confirmation/Undo; `test/service-units-removal.test.mjs`, new; `test/service-api.test.mjs`, `test/gui-shell.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide how an asynchronous native stop advances to the archival transaction without making a second stop request after recovery. Implement C02 with a removal journal, current unit revision and verified stop acknowledgment. Preserve tasks/repository bytes and reserve the unit ID. Reject removal of master or a lead with reports before any stop/archive. Retain group membership history and remove only active membership where the contract allows it, in the same transaction. Undo restores visibility and memberships under revision checks, never restarts a stopped process.
- Visual: 480 dialog, padding 24, gap 18, radius 22, panel, line2; title 18/700; body 13.5/mute; Cancel ghost, Remove unit error-fill/error-ink; 32 minimum target. Copy: `Remove {unit}?` / `Quitar {unit}?`; `It leaves the Map and Hierarchy. Its chat and mailbox move to Archived and its tasks stay in the project. A session running now is stopped first.` / `La unidad deja de aparecer en el Mapa y la Jerarquía. El chat y el buzón pasan a Archivados; las tareas permanecen en el proyecto. Una sesión en ejecución se detiene primero.`; `Remove unit` / `Quitar unidad`; `Archived` / `Archivados`.
- Tests: stopped/offline/native unsupported cases, crash after stop before archive, unchanged tasks/repo hashes, dependent-lead rejection, active membership removal, archived reads, replay once, Undo valid/expired/conflict and denied phone/agent writes.
- Proof: `node --test test/service-units-removal.test.mjs test/service-api.test.mjs test/gui-shell.test.mjs`; zero failures; stop acknowledgment precedes any archive event.
- Depends on: T014, T016. Commit message: `Archive removed units after verified session shutdown`.

### P4. Sessions and chats

#### T018. Bound non-send requests at thirty seconds

- Screens: 1.9, 2.16, 6.12. Decisions: 8, 20. Kind: MECHANICAL.
- Files: `gui/app/api.mjs`, REQUEST_DEADLINE_MS; `test/gui-transport.test.mjs`, existing deadline assertion and new test.
- Change: replace `export const REQUEST_DEADLINE_MS = 15_000;` with `export const REQUEST_DEADLINE_MS = 30_000;`. Replace `assert.equal(REQUEST_DEADLINE_MS, 15_000);` with `assert.equal(REQUEST_DEADLINE_MS, 30_000);`. Preserve the independent core request-body limit 15000.
- Tests: append to `test/gui-transport.test.mjs`:

```js
test('the GUI response deadline covers thirty seconds independently of send deadlines', () => {
  const { api } = harness({ fetch: async () => jsonResponse(200, envelope({})) });
  assert.equal(api.deadlineMs, 30000);
  assert.equal(STREAM_HANDSHAKE_MS, 30000);
  dispose(api);
});
```

- Proof: `node --test test/gui-transport.test.mjs`; zero failures, existing stalled-body and uncertain-retry tests still pass.
- Depends on: T001. Commit message: `Wait at most thirty seconds for GUI requests`.

#### T019. Keep send waits at ten seconds

- Screens: 3.2, 3.6, 6.10. Decisions: 20. Kind: MECHANICAL.
- Files: `gui/app/api.mjs`, new SEND_DEADLINE_MS and `request`; `test/gui-transport.test.mjs`, new assertion.
- Change: add `export const SEND_DEADLINE_MS = 10_000;` after REQUEST_DEADLINE_MS. Before `const parsed = await withDeadline(api, {`, insert:

```js
  const send = actualMethod === 'POST' && /^\/(chats|mailboxes)\/[^/]+\/messages$/.test(suffix);
```

Replace its `deadlineMs: options.deadlineMs,` property with:

```js
    deadlineMs: options.deadlineMs ?? (send ? SEND_DEADLINE_MS : undefined),
```

This selects a send's deadline without changing any operation ID, body or retry code. T024 supplies terminal unconfirmed feedback and separate concurrent drafts.

- Tests: add SEND_DEADLINE_MS to the existing api import and append:

```js
test('send timeout and general response timeout remain distinct', () => {
  assert.equal(SEND_DEADLINE_MS, 10000);
  assert.equal(REQUEST_DEADLINE_MS, 30000);
  assert.ok(SEND_DEADLINE_MS < REQUEST_DEADLINE_MS);
});
```

Extend the existing stalled-read test's fake timer case in T024 to assert actual selected deadlines for a chat post, mailbox post and ordinary request; this constant test alone does not prove route selection.

- Proof: `node --test test/gui-transport.test.mjs test/gui-actions.test.mjs`; zero failures and existing same-operation retries remain green.
- Depends on: T018. Commit message: `Give message sends a ten-second acknowledgment deadline`.

#### T020. Retain expired approvals without inflating Waiting

- Screens: 3.8. Decisions: 8, 20. Kind: MECHANICAL.
- Files: `engine/service/projection.mjs`, `loadMind`, `readPendingApprovals`, `assemble`, `countsOf`; `test/service-projection.test.mjs`, added case.
- Change: replace `readPendingApprovals(mind, issues)` at its call with `readPendingApprovals(mind, issues, now)`. Replace the complete function with:

```js
async function readPendingApprovals(mind, issues, now) {
  const items = [];
  for (const relative of await filesUnder(mind, 'user/relay/approvals')) {
    if (!relative.endsWith('/request.json')) continue;
    const bytes = await readSafe(mind, relative);
    if (!bytes) continue;
    try {
      const request = JSON.parse(bytes.toString('utf8'));
      const resultBytes = await readSafe(mind, relative.replace(/request\.json$/, 'result.json'));
      const result = resultBytes ? JSON.parse(resultBytes.toString('utf8')) : null;
      if (result?.state === 'approved' || result?.state === 'denied') continue;
      const expired = result?.state === 'expired' || Date.parse(request.expiresAt) <= now;
      const answers = await filesUnder(mind, relative.replace(/request\.json$/, 'answers'));
      const state = expired ? 'expired' : answers.some((file) => file.endsWith('.json')) ? 'answering' : 'pending';
      items.push({ id: 'approval:' + request.id, kind: 'approval', state,
        unitId: request.unitId ?? null, title: request.display ?? request.action ?? '',
        since: request.requestedAt ?? '', chatId: request.chatId ?? null, approvalId: request.id ?? null,
        taskId: null, messageId: null, blocking: !expired });
    } catch {
      issues.push({ path: relative, code: 'corrupt_resource', message: 'The approval could not be projected.' });
    }
  }
  return items;
}
```

Replace `new Set(waiting.map((item) => item.unitId).filter(Boolean))` with `new Set(waiting.filter((item) => item.state !== 'expired').map((item) => item.unitId).filter(Boolean))`. Replace `waiting: waiting.length,` in countsOf with `waiting: waiting.filter((item) => item.state !== 'expired').length,`. Retain expired items in the waiting collection. Reviews/questions/messages receive `state:'pending'` in their existing object literals, with no new file writes.

- Tests: append:

```js
test('expired asks stay readable and do not count as active Waiting', async (t) => {
  const fixture = await mind(t);
  const context = serviceContext(fixture);
  const id = '11111111-1111-4111-8111-111111111111';
  const directory = path.join(fixture.paths.mind, 'user', 'relay', 'approvals', id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'request.json'), JSON.stringify({ id, unitId: 'root:executor-shop', display: 'Push to the remote', requestedAt: '2026-10-09T12:00:00.000Z', expiresAt: '2026-10-09T12:02:00.000Z', chatId: null }));
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ state: 'expired' }));
  const view = await readProjection(context);
  const expired = view.waiting.find((item) => item.approvalId === id);
  assert.ok(expired);
  assert.equal(expired.state, 'expired');
  assert.equal(expired.blocking, false);
  assert.equal(view.counts.waiting, 0);
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ state: 'denied' }));
  assert.equal((await readProjection(context)).waiting.some((item) => item.approvalId === id), false);
});
```

- Proof: `node --test test/service-projection.test.mjs`; zero failures; expired detail is present but active count is 0.
- Depends on: T001. Commit message: `Keep ended asks visible without counting them as pending`.

#### T021. Separate active asks, reviews and ended asks

- Screens: 3.8, 7.6. Decisions: 20, 21. Kind: MECHANICAL.
- Files: `gui/app/inspector.mjs`, new `waitingSections`, `renderWaiting`; `gui/app/i18n.mjs`, COPY keys; `gui/app/styles.css`, `waiting-section-title`; `test/final-waiting-sections.test.mjs`, new.
- Change: append:

```js
export function waitingSections(items) {
  return [
    { key: 'asks', items: items.filter((item) => item.state !== 'expired' && item.kind !== 'review') },
    { key: 'reviews', items: items.filter((item) => item.state !== 'expired' && item.kind === 'review') },
    { key: 'endedWithoutAnswer', items: items.filter((item) => item.state === 'expired') },
  ];
}
```

Replace the complete `renderWaiting` function with:

```js
export function renderWaiting(document, items, t, onOpen, emptyAction = null) {
  const activeCount = (items ?? []).filter((item) => item.state !== 'expired').length;
  const block = element(document, 'section', { class: 'waiting-list', 'data-waiting': String(activeCount) });
  if (!items?.length) {
    block.append(element(document, 'p', { 'data-empty': 'waiting', text: t('emptyWaiting') }));
    block.append(element(document, 'p', { class: 'field-hint', 'data-empty-next': 'waiting', text: t('emptyWaitingNext') }));
    if (emptyAction) block.append(emptyAction);
  }
  for (const section of waitingSections(items ?? [])) {
    if (!section.items.length) continue;
    block.append(element(document, 'h3', { class: 'waiting-section-title', text: t(section.key) }));
    for (const item of section.items) {
      const attrs = {
        'data-waiting-item': item.id,
        'data-kind': item.kind ?? '',
        'data-state': item.state ?? 'pending',
        'data-approval': item.approvalId ?? '',
        'data-task': item.taskId ?? '',
        'data-chat': item.chatId ?? '',
        'data-message': item.messageId ?? '',
        'data-unit': item.unitId ?? '',
        text: (item.title || item.kind || '') + (item.state === 'expired' ? ' · ' + t('expiredAsk') : ''),
      };
      if (onOpen) block.append(element(document, 'button', { type: 'button', class: 'btn', ...attrs, onclick: () => onOpen(item) }));
      else block.append(element(document, 'p', attrs));
    }
  }
  return block;
}
```

Expired rows remain selectable for readable detail. Their detail has no answer action, as enforced by T024 and T053. Add these COPY entries:

```js
  asks: ['Asks', 'Solicitudes'],
  reviews: ['Reviews', 'Revisiones'],
  endedWithoutAnswer: ['Ended without an answer', 'Finalizadas sin respuesta'],
  expiredAsk: ['Expired', 'Vencida'],
```

Append CSS:

```css
.waiting-section-title { margin: 0; padding: 12px 8px 6px; font-size: 12.5px; font-weight: 600; letter-spacing: 0.04em; color: var(--mute); }
[data-look="high-contrast"] .waiting-section-title { font-size: 11.5px; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; }
```

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { waitingSections } from '../gui/app/inspector.mjs';

test('Waiting sections separate expired asks from active asks and reviews', () => {
  const ask = { id: 'a', kind: 'approval', state: 'answering' };
  const review = { id: 'b', kind: 'review', state: 'pending' };
  const ended = { id: 'c', kind: 'approval', state: 'expired' };
  assert.deepEqual(waitingSections([ask, review, ended]), [
    { key: 'asks', items: [ask] }, { key: 'reviews', items: [review] }, { key: 'endedWithoutAnswer', items: [ended] },
  ]);
});
```

- Proof: `node --test test/final-waiting-sections.test.mjs test/gui-shell.test.mjs`; zero failures; active counts and expired selection remain distinct.
- Depends on: T020. Commit message: `Group Waiting into asks reviews and ended requests`.

#### T022. Own one-task and chat CLI sessions and approval-gated children

- Screens: 2.14 to 2.17, 3.3, 3.4. Decisions: 11, 20. Kind: JUDGMENT.
- Files: `engine/service/adapters.mjs`, start request/result/ledger/stop and connected-client checks; `engine/service/approvals.mjs`, `requestApproval`, `answerApproval`, normalized session.open handling; `engine/service/http.mjs`, session body/cancel route; `engine/service/projection.mjs`, sessions/requests; `engine/relay/hooks.mjs`, completion/native manual registration; `engine/relay/mcp.mjs`, child session request forwarding; `engine/service/mcp.mjs`, bounded approval action; `gui/app/main.mjs`, `openSessionForm`, tracked start/cancel, chat work Stop; `gui/app/inspector.mjs`, Runs in field; `gui/app/i18n.mjs`, new run mode/actions; `test/service-sessions.test.mjs`, `test/service-approvals.test.mjs`, `test/gui-actions.test.mjs`, `test/gui-shell.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide genuine native completion/stop observation per supported connected client, and how child launch approval is consumed once. Implement C03 without arbitrary executable/cwd input, assuming no capability unavailable in the adapter. One task then closes is the default; Chat kept open remains until explicit stop. Manual app sessions preserve canonical hierarchy and identify their real launch source. No builder role is added. Stop during work uses the existing confirmed-stop boundary and retains task/chat/mailbox. Cancel start cannot race into a second spawn. 30s unconfirmed launch reconciles the existing request; copy never falsely says Nothing was started after an ambiguous spawn.
- Visual: 520 dialog, padding 24, gap 18, radius 22; client options compact padding 10x14, gap 14, radius 16; Runs as segment padding 4, gap 4, radius 12, card; selected cell padding 8x12, radius 9, card2, text 13.5/600; work indicator dots 7, gap 4, padding 10x14, radius 18, card, elapsed 12/mute, Stop ghost. Progress spinner 18; starting ring 60; unsupported/offline choices disabled with cause, still listed.
- Copy: `Runs in` / `Se ejecuta en`; `Runs as` / `Modo de ejecución`; `One task, then it closes` / `Una tarea y cerrar después`; `Chat, kept open` / `Chat abierto`; `Task or first message` / `Tarea o primer mensaje`; `Asks to open a session` / `Solicita abrir una sesión`; `Cancel start` / `Cancelar el inicio`; `Stop` / `Detener`; `Choose another client` / `Elegir otro cliente`; `Always for this unit` / `Siempre para esta unidad`. Client names appear only as connected-client/app facts and choices.
- Tests: exact mode/task fields; no task prompt rejected; default one-task closure on actual acknowledgment; chat retained; manual-app registration; one child per approved session.open; deny/timeout no child; offline machine preserved; ambiguous start same-request reconciliation; stop/cancel race; unavailability never fabricates native success.
- Proof: `node --test test/service-sessions.test.mjs test/service-approvals.test.mjs test/gui-actions.test.mjs test/gui-shell.test.mjs`; zero failures; native handles created only by isolated injected transports.
- Depends on: T017, T019, T021. Commit message: `Run task and chat sessions with explicit child approval`.

#### T023. Carry run mode and task identity in start operations

- Screens: 2.14, 2.15. Decisions: 11. Kind: MECHANICAL.
- Files: `gui/app/actions.mjs`, `startSession`; `test/final-session-mode.test.mjs`, new.
- Change: replace the complete `startSession` function with:

```js
export async function startSession(api, unit, client, prompt = null, retained = null, mode = {}) {
  const operation = retained ?? createOperation({
    method: 'POST', path: '/units/:unitId/session', params: { unitId: unit.id },
    body: { client, prompt, runMode: mode.runMode ?? 'task', taskId: mode.taskId ?? null, expectedRevision: unit.revision },
  });
  const result = await commit(api, operation);
  return { ...result, operation };
}
```

T022's form calls its final mode argument explicitly. This patch preserves existing call positions and retained operations.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../gui/app/api.mjs';
import { startSession } from '../gui/app/actions.mjs';

test('session operations keep mode task and revision through retries', async () => {
  const bodies = [];
  const api = createApi({ location: { origin: 'http://127.0.0.1:12345', hash: '#session=fixture' }, history: { replaceState() {} },
    fetch: async (url, options) => { bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data: { state: 'queued' }, meta: { requestId: 'fixture', readAt: '2026-10-13T00:00:00.000Z', eventCursor: 'fixture:1', sync: 'local' } }), { status: 202 }); } });
  const unit = { id: 'root:executor-shop', revision: 'a'.repeat(64) };
  const first = await startSession(api, unit, 'codex', 'Finish the task', null, { runMode: 'task', taskId: 'project:shop:029' });
  await startSession(api, unit, 'codex', 'Changed input', first.operation, { runMode: 'chat' });
  assert.deepEqual(bodies[0], { client: 'codex', prompt: 'Finish the task', runMode: 'task', taskId: 'project:shop:029', expectedRevision: 'a'.repeat(64) });
  assert.deepEqual(bodies[1], bodies[0]);
});
```

- Proof: `node --test test/final-session-mode.test.mjs test/gui-actions.test.mjs`; zero failures and retained mode/prompt bytes identical.
- Depends on: T022. Commit message: `Carry task and chat mode in session start requests`.

#### T024. Reconcile message receipts and independent optimistic sends

- Screens: 3.2, 3.3, 3.5, 3.6, 6.10, 6.12. Decisions: 20. Kind: JUDGMENT.
- Files: `engine/service/chats.mjs`, post/fanout/read aggregation; `engine/service/projection.mjs`, message projection/read receipts; `engine/service/http.mjs`, message delivery response; `gui/app/chats.mjs`, `createThread`, `postMessage`, `retryMessage`, `applyMessageRead`, settled draft generation; `gui/app/main.mjs`, `submitComposer`, `chatPanel`, `noteDelivery`, `paintActivity`, cancellation/reconnection; `test/service-messaging.test.mjs`, `test/gui-actions.test.mjs`, `test/gui-transport.test.mjs`, `test/gui-shell.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide aggregate delivery/read policy over recipients and map it to genuine persisted acknowledgments per C04. Introduce a per-operation pending-send map so submitting frees the composer immediately and the next draft is independent. Preserve a failed message's own text/key/payload, not whichever text is currently in the composer. Retry submits the identical retained operation once; double Retry joins that operation's in-flight promise. Late original acknowledgment merges with the optimistic row by operation/message identity. Read status comes from recipients, not master's own viewport read or an incoming reply. Show Taking longer than usual immediately for non-send pending requests, elapsed timing and Cancel; 30000 ends waiting. Send terminal text uses 10000. Reconnect resumes uncertain/retriable operations only under their original identity and requires deliberate conflict resolution for stale edits.
- Copy: `Sending` / `Enviando`; `Delivered {time}` / `Entregado {time}`; `Read {time}` / `Leído {time}`; `Not confirmed: the service did not answer in 10 s.` / `Sin confirmar: el servicio no respondió en 10 s.`; `Retry sends the same message once; it is never sent twice` / `Reintentar envía el mismo mensaje una sola vez, sin duplicarlo`; `Taking longer than usual` / `Está tardando más de lo habitual`; `The service has not answered for {seconds} s. It stops waiting at 30 s and offers Retry.` / `El servicio no respondió durante {seconds} s. La espera termina a los 30 s y permite reintentar.`
- Visual: own bubble me/me-text, padding 10x14, radius 18, body 14.5; metadata mono 12/700, time 12/mute; state 12/mute, check 12; unconfirmed error-line/error-text, Retry 12/700/accent. Composer stays separate with 32 minimum Send target. Pending notice wait-soft, padding 10x12, radius 14, spinner 15, gap 10, title 13/700, body 12.
- Tests: real recipient submitted/ambiguous/read aggregate; two sends with different keys/drafts; typing while first settles; response loss after durable commit; original late acknowledgment plus retry one row/one notice; consecutive Retry joins; actual selected 10s/30s timer cases; canceled local waiting no fabricated rollback; active work Stop; same-operation reconnection.
- Proof: `node --test test/service-messaging.test.mjs test/gui-actions.test.mjs test/gui-transport.test.mjs test/gui-shell.test.mjs`; zero failures and every loss/retry scenario has exactly one durable message and recipient notice.
- Depends on: T019, T022, T023. Commit message: `Keep message acknowledgments and retries unambiguous`.

#### T025. Select sent-line copy from authoritative receipt state

- Screens: 3.2, 3.5, 3.6. Decisions: 20. Kind: MECHANICAL.
- Files: `gui/app/chats.mjs`, new `sentLineState`; `test/final-sent-state.test.mjs`, new. T024's renderer calls this helper.
- Change: append:

```js
export function sentLineState(message) {
  if (message.failed) return { key: 'notConfirmed', at: null };
  if (message.pending) return { key: 'sending', at: null };
  if (message.delivery?.state === 'read') return { key: 'readReceipt', at: message.delivery.readAt };
  if (message.delivery?.state === 'delivered') return { key: 'deliveredReceipt', at: message.delivery.deliveredAt };
  return { key: 'storedReceipt', at: null };
}
```

The renderer uses its localized key and timestamp; `storedReceipt` is `Sent, awaiting delivery` / `Enviado, pendiente de entrega`, never Delivered. Literal labels for the other keys are in T024.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { sentLineState } from '../gui/app/chats.mjs';

test('sent-line state never turns local storage or own read into delivery', () => {
  assert.deepEqual(sentLineState({ read: true }), { key: 'storedReceipt', at: null });
  assert.deepEqual(sentLineState({ pending: true }), { key: 'sending', at: null });
  assert.deepEqual(sentLineState({ pending: true, failed: true }), { key: 'notConfirmed', at: null });
  assert.deepEqual(sentLineState({ delivery: { state: 'delivered', deliveredAt: 'time' } }), { key: 'deliveredReceipt', at: 'time' });
  assert.deepEqual(sentLineState({ delivery: { state: 'read', readAt: 'later' } }), { key: 'readReceipt', at: 'later' });
});
```

- Proof: `node --test test/final-sent-state.test.mjs test/gui-actions.test.mjs`; zero failures, stored/read-by-master is not recipient Read.
- Depends on: T024. Commit message: `Derive sent-line labels from recipient receipts`.

### P5. Shared library and deletions

#### T026. Search board content, text pages and comments

- Screens: 4.4, 5.1. Decisions: 15. Kind: MECHANICAL.
- Files: `engine/service/editors.mjs`, `editorSearchText`, `list`; `test/service-editors.test.mjs`, import and added case.
- Change: before `export async function list`, insert:

```js
export function editorSearchText(editor) {
  const values = [editor.title, editor.path, editor.id];
  for (const screen of editor.document?.screens ?? []) {
    values.push(screen.title);
    const walk = (node) => {
      if (!node) return;
      values.push(node.name, node.value);
      for (const child of node.kids ?? []) walk(child);
    };
    walk(screen.root);
  }
  for (const page of editor.document?.pages ?? []) {
    for (const [key, value] of Object.entries(page)) {
      if (key !== 'k' && typeof value === 'string') values.push(value);
    }
  }
  for (const thread of editor.threads ?? []) {
    for (const message of thread.messages ?? []) values.push(message.text);
  }
  return values.filter((value) => typeof value === 'string').join('\n').toLowerCase();
}
```

Replace this complete before line:

```js
    ? editors.filter((item) => `${item.title} ${item.path} ${item.id}`.toLowerCase().includes(needle))
```

with this complete after line:

```js
    ? editors.filter((item) => editorSearchText(item).includes(needle))
```

No other filter changes are made. No local file content is printed by the search helper.

- Tests: import editorSearchText in the existing core editor import and append:

```js
test('editor search includes screen labels nested text pages and comments', () => {
  const value = editorSearchText({ title: 'Cart page', path: 'docs/cart.json', document: {
    screens: [{ title: 'Empty cart', root: { name: 'Root', kids: [{ name: 'Continue button', value: 'Return to shop', kids: [] }] } }],
    pages: [{ k: 'intro', en: 'Relay manual', es: 'Manual de Relay' }],
  }, threads: [{ messages: [{ text: 'Add checkout errors' }] }] });
  for (const query of ['cart page', 'empty cart', 'continue button', 'return to shop', 'relay manual', 'manual de relay', 'checkout errors']) assert.ok(value.includes(query));
  assert.equal(editorSearchText({ document: { screens: [{ root: { kids: [] } }], pages: [] } }), '');
});
```

- Proof: `node --test test/service-editors.test.mjs`; zero failures, names/screens/comments match without changing resource revision.
- Depends on: T001. Commit message: `Search editor content and comment threads`.

#### T027. Provide exact library mutation envelopes

- Screens: 4.2, 4.3, 4.5, 4.6, 5.2, 5.3. Decisions: 15, 16. Kind: MECHANICAL.
- Files: `gui/app/editors.mjs`, new `libraryChange`, `duplicateEditor`, `moveEditor`, `deleteEditor`; `test/final-library-envelope.test.mjs`, new.
- Change: append:

```js
export function libraryChange(api, editor, title, folderId, libraryRevision, retained = null) {
  return perform(api, { method: 'PATCH', path: '/editors/:resourceId/library', params: { resourceId: editor.id ?? editor.resourceId },
    body: { title, folderId, expectedRevision: editor.revision, expectedLibraryRevision: libraryRevision } }, retained);
}
export function duplicateEditor(api, editor, destination, retained = null) {
  return perform(api, { method: 'POST', path: '/editors/:resourceId/duplicate', params: { resourceId: editor.id ?? editor.resourceId },
    body: { project: destination.project, folderId: destination.folderId, title: destination.title,
      path: destination.path, expectedRevision: editor.revision } }, retained);
}
export function moveEditor(api, editor, destination, libraryRevision, retained = null) {
  return perform(api, { method: 'POST', path: '/editors/:resourceId/move', params: { resourceId: editor.id ?? editor.resourceId },
    body: { project: destination.project, folderId: destination.folderId, path: destination.path,
      confirmedRepositoryChange: destination.confirmedRepositoryChange === true, expectedRevision: editor.revision,
      expectedCommentsRevision: editor.commentsRevision ?? null, expectedAttachmentRevision: editor.attachmentRevision ?? null,
      expectedLibraryRevision: libraryRevision } }, retained);
}
export function deleteEditor(api, editor, libraryRevision, retained = null) {
  return perform(api, { method: 'DELETE', path: '/editors/:resourceId', params: { resourceId: editor.id ?? editor.resourceId },
    body: { confirmed: true, expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision ?? null,
      expectedAttachmentRevision: editor.attachmentRevision ?? null, expectedLibraryRevision: libraryRevision } }, retained);
}
```

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../gui/app/api.mjs';
import { moveEditor, deleteEditor } from '../gui/app/editors.mjs';

test('moving and deleting retain all independent revision preconditions', async () => {
  const bodies = [];
  const api = createApi({ location: { origin: 'http://127.0.0.1:12345', hash: '#session=fixture' }, history: { replaceState() {} }, fetch: async (url, options) => {
    bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data: {}, meta: { requestId: 'fixture', readAt: '2026-10-13T00:00:00.000Z', eventCursor: 'fixture:1', sync: 'local' } }), { status: 200 });
  } });
  const editor = { id: '11111111-1111-4111-8111-111111111111', revision: 'a'.repeat(64), commentsRevision: 'b'.repeat(64), attachmentRevision: 'c'.repeat(64) };
  await moveEditor(api, editor, { project: 'api', folderId: null, path: 'docs/flows/boards/cart.json', confirmedRepositoryChange: true }, 'd'.repeat(64));
  await deleteEditor(api, editor, 'd'.repeat(64));
  for (const body of bodies) {
    assert.equal(body.expectedRevision, 'a'.repeat(64));
    assert.equal(body.expectedCommentsRevision, 'b'.repeat(64));
    assert.equal(body.expectedAttachmentRevision, 'c'.repeat(64));
    assert.equal(body.expectedLibraryRevision, 'd'.repeat(64));
  }
  assert.equal(bodies[0].confirmedRepositoryChange, true);
  assert.equal(bodies[1].confirmed, true);
});
```

- Proof: `node --test test/final-library-envelope.test.mjs`; one passed test, zero failures. Core route support is T028, not claimed by this transport test.
- Depends on: T026. Commit message: `Carry library revisions in editor management operations`.

#### T028. Journal folders, cross-repository moves and deletion Undo

- Screens: 4.1 to 4.6, 5.1 to 5.3. Decisions: 15, 16. Kind: JUDGMENT.
- Files: `engine/service/editors.mjs`, catalog/list/new management exports and atomic create-in-folder; `engine/service/store.mjs`, `catalogAllows`, transaction validation/commit/recovery and true delete operation; `engine/sync/store.mjs`, `stageTransaction`, eligible project path sets; `engine/sync/apply.mjs`, tombstone transaction validation; `engine/sync/origin.mjs`, catalog allowlist; `engine/service/events.mjs`, `library.changed` and `editor.removed` visibility; `engine/service/import-events.mjs`, library/removal/move invalidation; `engine/service/http.mjs`, C05 routes and exact schemas; `test/service-editors.test.mjs`, `test/service-api.test.mjs`, `test/sync-apply.test.mjs`, `test/gui-fixture.mjs`, `test/gui-fixture.test.mjs`.
- Change: decide the verified pre-catalog/source and post-catalog/destination authorization snapshots under one transaction. Current `afterBytes:null` creates an empty file, not a delete; add explicit journal entry `operation:'delete'` with retained before bytes and verified restart recovery, then stage a true sync tombstone. Implement C05 completely, including empty-folder eligibility, no orphan assets, logical same-project rename/move, physical cross-project content+sidecar+binding/history move, ResourceId remap, Watch invalidation, attached-unit validation, source/destination collision checks and ten-second Undo. Use the T014 generic undo service. Unavailable projects produce per-entry issues so one offline project does not hide every other library item. Publication cannot lose source tombstones when the new catalog no longer contains the removed item.
- Tests: one test per C05 route; exact unknown-body/query failure; source/destination revisions; full unknown-data retention; comment/history/asset movement; shared asset retained; one stale file causes zero writes; interruption at each journal phase; Undo expiry/conflict; pending sync resumes whole transaction; one logical notice per attached agent; offline project issues; denied phone/agent writes and replay idempotency.
- Proof: `node --test test/service-editors.test.mjs test/service-api.test.mjs test/sync-apply.test.mjs test/gui-fixture.test.mjs`; zero failures, moves/deletions replicate and recover without an empty-file substitute.
- Depends on: T014, T027. Commit message: `Manage library folders moves and deletions transactionally`.

#### T029. Render one shared searchable library and confirmations

- Screens: 4.1 to 4.6, 5.1 to 5.3. Decisions: 15, 16, 22. Kind: JUDGMENT.
- Files: `gui/app/editors.mjs`, `groupCatalog`, `loadCatalog`, folder/filter state and new shared `renderLibrary`; `gui/app/main.mjs`, `renderEditorSurfaces`, `openResourceForm`, management dialogs/Undo; `gui/app/i18n.mjs`, library strings; `gui/app/styles.css`, library/folder/menu/dialog rules; `test/gui-editors.test.mjs`, `test/gui-shell.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide focus restoration for inline rename, nested folders and cross-project move dialogs. Both editors call the same renderLibrary, with kind/project/data/actions arguments. Header order title, Filters, New folder, New board/text; search/clear; removable filter chips; folders and counts; children; More menu Rename, Duplicate, Move to folder, separator, Delete. New board requires Name, Project with repository hint, Folder, then Empty/Duplicate/Import options. Empty creates exactly one frame. Duplicate copies actual source content but no comments. Cross-project move has a distinct confirmation identifying both repositories. Delete names screens/sketches/comments or texts/folder contents and offers ten-second Undo after commit. Matching folders and ancestors open; chips persist; filters AND; changed-this-week uses C05 UTC boundary. Virtualized/paged loading must not search only the visible window.
  Import `element` from `./components.mjs` in `gui/app/editors.mjs` for the shared renderer. Retain that binding for T037; it must not be imported a second time.
- Visual: library 228 wide, panel 20radius, line; header padding 14x10x4x14, gap 2, title 15/700, tools 32/radius 8; search margin 6x10x4, padding 8x10, radius 11, card, accent line when query; chips padding 3x8, gap 5, pill, accent-soft/text 11.5/700; folders padding 7x8, gap 7, text 13/600, count 11.5; item padding 7x8x7x28, gap 8, radius 10, text 13, selected 700/card2. Menu 220, padding 6, gap 2, radius 14, card2, line2, rows 8x10, gap 10, icon 15, text 13.5, Delete error; filters 230. New-board dialog 560; other confirmation 480, padding 24, gap 18, radius 22. New text/board fields 32 minimum targets.
- Copy: `Boards` / `Tableros`; `Texts` / `Textos`; `Filters` / `Filtros`; `New folder` / `Nueva carpeta`; `New board` / `Nuevo tablero`; `New text` / `Nuevo texto`; `Search boards` / `Buscar tableros`; `Search texts` / `Buscar textos`; `Open comments` / `Comentarios abiertos`; `Attached agents` / `Agentes adjuntos`; `Changed this week` / `Modificado esta semana`; `Project: all` / `Proyecto: todos`; `Duplicate` / `Duplicar`; `Move to folder` / `Mover a una carpeta`; `Delete` / `Eliminar`; `Empty board` / `Tablero vacío`; `Duplicate a board` / `Duplicar un tablero`; `Import a Blueprint Lite 2.x board` / `Importar un tablero de Blueprint Lite 2.x`; `The board's file lives in this repository` / `El archivo del tablero se guarda en este repositorio`; `Delete text` / `Eliminar texto`; `Delete folder` / `Eliminar carpeta`; `Undo brings it back for 10 seconds.` / `Deshacer permite recuperarlo durante 10 segundos.`
- Tests: shared component identity; full-content search across folded folders; chip add/remove; inline rename Enter/Escape/failure; folder empty/filled counts; duplicate source fidelity; Project required; same/cross-repo move confirmation; delete scopes; countdown/Undo 10s; stable selection/caret through events; offline project issues.
- Proof: `node --test test/gui-editors.test.mjs test/gui-shell.test.mjs`; zero failures and running GUI matches every screen in this task, including physical move after real-core integration.
- Depends on: T027, T028. Commit message: `Share the library and destructive confirmations between editors`.

#### T030. Import real legacy board content beside its module

- Screens: 4.3. Decisions: 15, 18. Kind: JUDGMENT.
- Files: `features/blueprint/kit/board.mjs`, trusted export entry; `features/blueprint/review/sketch-format.mjs`, normalized schema; `features/blueprint/server.mjs`, registered local export boundary; `engine/service/editors.mjs`, import catalog/index collision handling; `engine/service/http.mjs`, import route/schema; `gui/app/main.mjs`, `submitJsonCopy`, import form; `test/service-editors.test.mjs`, `test/blueprint-sketch.test.mjs`, `test/gui-editors.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide the trusted desktop exporter that evaluates the already registered module with the project's approved kit and normalizes its layout, without executing HTTP-supplied code. Export all real screens/order/text/styles/links/sketches/unknown bounded fields. Import creates JSON beside the unchanged module and updates catalog/index identity deliberately so a legacyId collision cannot register a blank substitute. No starterBoard call is allowed in import or duplicate. Reject unsupported export explicitly with import_unavailable; preserve original module/hash and read-only history.
- Tests: nonempty module with nested text/styles/two pages/links/sketch; byte-identical original; next-to-module path; catalog legacy conversion collision; rejected outside/unregistered/linked source; exporter error creates no file; JSON unknown-field retention; no arbitrary uploaded module execution.
- Proof: `node --test test/service-editors.test.mjs test/blueprint-sketch.test.mjs test/gui-editors.test.mjs`; zero failures, real content counts match the exported source, original hash unchanged.
- Depends on: T028, T029. Commit message: `Import the actual legacy board into an editable JSON copy`.

### P6. Blueprint editing, sketches and History

#### T031. Scale normalized vector paths to their declared dimensions

- Screens: 4.7, 4.8. Decisions: 18. Kind: MECHANICAL.
- Files: `gui/app/blueprint.mjs`, `drawVector`; `test/gui-editors.test.mjs`, added case using existing SVG helpers.
- Change: immediately after `path.setAttribute("data-kind", kind || "pen");`, insert:

```js
    path.setAttribute('transform', 'scale(' + width / 100 + ' ' + height / 100 + ')');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
```

- Tests: append:

```js
test('board vectors use their declared dimensions and keep the stroke width', () => {
  const nodes = nodesOf(renderNode(svgDocument(), { id: 'stroke', name: 'Pen stroke', t: 'vector', kind: 'pen',
    place: { x: 0, y: 0 }, w: 270, h: 500, d: 'M0 0 L100 100', stroke: '#f5f1f6', strokeWidth: 2.2, fill: 'none' }, {}));
  const vector = nodes.find((item) => item.tag === 'path');
  assert.equal(vector.getAttribute('d'), 'M0 0 L100 100');
  assert.equal(vector.getAttribute('transform'), 'scale(2.7 5)');
  assert.equal(vector.getAttribute('vector-effect'), 'non-scaling-stroke');
  assert.equal(vector.getAttribute('stroke-width'), '2.2');
});
```

- Proof: `node --test test/gui-editors.test.mjs`; zero failures, a 270x500stroke fills that box rather than 100x100.
- Depends on: T030. Commit message: `Render normalized pen paths at their stored size`.

#### T032. Align authenticated asset identity with the real core

- Screens: 4.7, 4.8, 5.4. Decisions: 18, 19. Kind: MECHANICAL.
- Files: `gui/app/blueprint.mjs`, ASSET_SRC; `test/gui-fixture.mjs`, `prepareAsset`, `readAsset`; `test/gui-editors.test.mjs`, canonical source expectations and added test.
- Change: replace ASSET_SRC completely:

```js
const ASSET_SRC = /^assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp))$/;
```

Replace the complete fixture functions:

```js
async function prepareAsset(fx, resourceId, body) {
  const editor = await editorFor(fx, resourceId);
  if (editor.readOnly) throw new HttpError(409, 'read_only_resource', 'The resource is read only.');
  const bytes = Buffer.from(body.bytesBase64, 'base64');
  if (bytes.length > 10_000_000) throw new HttpError(413, 'asset_too_large', 'The asset is too large.');
  const extension = imageExtension(bytes, body.contentType);
  const assetId = uuid() + '.' + extension;
  const src = 'assets/' + assetId;
  const revision = sha256(bytes);
  return { status: 201, data: { id: assetId, src, contentType: body.contentType, bytes: bytes.length, revision,
    url: '/api/v1/editors/' + resourceId + '/assets/' + assetId },
    writes: [{ path: editorFile(fx, editor.project, 'docs/flows/' + src), beforeRevision: null,
      afterRevision: revision, afterBytesBase64: bytes.toString('base64') }], events: [] };
}

async function readAsset(fx, resourceId, assetId) {
  const editor = requireEditor(await projection(fx), resourceId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/.test(assetId)) {
    throw new HttpError(404, 'asset_not_found', 'The asset was not found.');
  }
  const extension = assetId.split('.').at(-1);
  const file = editorFile(fx, editor.project, 'docs/flows/assets/' + assetId);
  try {
    const bytes = await readFile(file);
    const contentType = extension === 'png' ? 'image/png' : extension === 'jpg' ? 'image/jpeg' : 'image/webp';
    imageExtension(bytes, contentType);
    return { bytes, contentType };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, 'asset_not_found', 'The asset was not found.');
  }
}
```

In the existing GUI editor test, replace the expected asset.src regex by `/^assets\/[0-9a-f-]{36}\.(png|jpg|webp)$/` and the literal `const missingSrc = "docs/flows/assets/11111111-1111-4111-8111-111111111111.png";` with `const missingSrc = "assets/11111111-1111-4111-8111-111111111111.png";`.

- Tests: import collectAssetRefs in the existing blueprint import and append:

```js
test('board asset references retain the core filename including extension', () => {
  const filename = '11111111-1111-4111-8111-111111111111.png';
  const refs = collectAssetRefs({ screens: [{ root: { kids: [
    { t: 'image', src: 'assets/' + filename }, { t: 'image', src: 'assets/' + filename },
    { t: 'image', src: 'docs/flows/assets/' + filename }, { t: 'image', src: 'https://invalid.example/image.png' },
  ] } }] });
  assert.deepEqual(refs.allowed, [{ src: 'assets/' + filename, id: filename }]);
  assert.deepEqual(refs.rejected, ['docs/flows/assets/' + filename, 'https://invalid.example/image.png']);
});
```

- Proof: `node --test test/gui-editors.test.mjs test/service-editors.test.mjs`; zero failures; authenticated asset GET uses the complete filename and rejected sources are never fetched.
- Depends on: T031. Commit message: `Use the core asset identity in the GUI and fixture`.

#### T033. Compute pointer move and corner resize changes without losing metadata

- Screens: 4.7. Decisions: 18. Kind: MECHANICAL.
- Files: `gui/app/blueprint.mjs`, new `dragNodeGeometry`; `test/final-board-geometry.test.mjs`, new.
- Change: append:

```js
export function dragNodeGeometry(node, dx, dy, corner = null) {
  const result = { place: { ...node.place }, w: node.w, h: node.h };
  if (corner === null) {
    result.place.x += dx;
    result.place.y += dy;
    return result;
  }
  if (!['nw', 'ne', 'sw', 'se'].includes(corner)) throw new RangeError('Invalid resize corner.');
  const west = corner.includes('w');
  const north = corner.includes('n');
  result.w = Math.min(16000, Math.max(1, node.w + (west ? -dx : dx)));
  result.h = Math.min(16000, Math.max(1, node.h + (north ? -dy : dy)));
  if (west) result.place.x += node.w - result.w;
  if (north) result.place.y += node.h - result.h;
  return result;
}
```

T035 passes deltas in the node parent's coordinate domain. Visible handles 9x9, radius 2, panel fill, accent 2line; hit target 32x32; selected outline accent 2/radius 4. Element bar offsetx-30, y+h+ 16, gap 10, padding 7x10, radius 12, panel, line2; dimensions mono 12. No ID/type/kids changes are sent by this helper.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { dragNodeGeometry } from '../gui/app/blueprint.mjs';

test('corner resizing fixes the opposite corner and keeps unknown placement fields', () => {
  const node = { place: { x: 20, y: 30, future: true }, w: 160, h: 40, marker: 'kept' };
  assert.deepEqual(dragNodeGeometry(node, 10, 5), { place: { x: 30, y: 35, future: true }, w: 160, h: 40 });
  assert.deepEqual(dragNodeGeometry(node, 10, 5, 'nw'), { place: { x: 30, y: 35, future: true }, w: 150, h: 35 });
  assert.deepEqual(dragNodeGeometry(node, 999, 999, 'nw'), { place: { x: 179, y: 69, future: true }, w: 1, h: 1 });
  assert.equal(node.marker, 'kept');
  assert.equal(node.place.x, 20);
  assert.throws(() => dragNodeGeometry(node, 0, 0, 'middle'), RangeError);
});
```

- Proof: `node --test test/final-board-geometry.test.mjs`; one passed test, zero failures; opposite corner remains fixed at its original position.
- Depends on: T031. Commit message: `Calculate bounded board drag and resize geometry`.

#### T034. Encode a hand stroke as a normal board vector

- Screens: 4.8. Decisions: 18. Kind: MECHANICAL.
- Files: `gui/app/blueprint.mjs`, new `handStrokeNode`; `test/final-hand-stroke.test.mjs`, new.
- Change: append:

```js
export function handStrokeNode(id, points, color, marker = false) {
  if (!Array.isArray(points) || points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new RangeError('A stroke needs at least two finite points.');
  }
  if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) throw new RangeError('Invalid stroke color.');
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const width = Math.max(1, Math.max(...points.map((point) => point.x)) - minX);
  const height = Math.max(1, Math.max(...points.map((point) => point.y)) - minY);
  const d = points.map((point, index) => (index === 0 ? 'M' : 'L')
    + ((point.x - minX) * 100 / width).toFixed(3) + ' ' + ((point.y - minY) * 100 / height).toFixed(3)).join(' ');
  return { id, name: marker ? 'Marker stroke' : 'Pen stroke', t: 'vector', kind: 'pen',
    place: { x: minX, y: minY }, w: width, h: height, d, fill: 'none', stroke: color,
    strokeWidth: 2.2, opacity: 1 };
}
```

The board specifies stroke width 2.2 and colors text/accent/wait. The default vector geometry uses those exact values; T035 decides the named marker gesture's behavior without inventing an unapproved palette. T035 resolves CSS tokens to approved persisted Color values and bounds points/frame to the schema, including 10000 nodes/depth 30. Eraser removes touched stroke nodes through existing remove-node operations, never paints background pixels into the board.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { handStrokeNode } from '../gui/app/blueprint.mjs';

test('a hand stroke stores normalized path geometry in a regular vector node', () => {
  const node = handStrokeNode('stroke-1', [{ x: 10, y: 20 }, { x: 280, y: 520 }], '#f5f1f6');
  assert.equal(node.d, 'M0.000 0.000 L100.000 100.000');
  assert.deepEqual(node.place, { x: 10, y: 20 });
  assert.equal(node.w, 270);
  assert.equal(node.h, 500);
  assert.equal(node.strokeWidth, 2.2);
  assert.equal(handStrokeNode('stroke-2', [{ x: 0, y: 0 }, { x: 5, y: 0 }], '#bdcd79', true).name, 'Marker stroke');
  assert.throws(() => handStrokeNode('stroke-3', [{ x: NaN, y: 0 }, { x: 1, y: 1 }], '#ffffff'), RangeError);
});
```

- Proof: `node --test test/final-hand-stroke.test.mjs test/blueprint-sketch.test.mjs`; zero failures; stroke JSON uses the existing node kind and reloads through T031.
- Depends on: T033. Commit message: `Represent hand sketches as ordinary board vectors`.

#### T035. Wire the in-place board tools and known rendering styles

- Screens: 4.7 to 4.13. Decisions: 17, 18, 22. Kind: JUDGMENT.
- Files: `gui/app/blueprint.mjs`, renderer/text/radius/clipping, hit testing, geometry helpers and pointer gestures; `gui/app/main.mjs`, `boardSurface`, `boardPoint`, `chooseBoardTarget`, tool/element bar, attach chooser; `gui/app/editors.mjs`, board draft/conflict state; `gui/app/i18n.mjs`, tool/attach/conflict copy; `gui/app/styles.css`, board controls/handles/preview; `test/gui-editors.test.mjs`, `test/gui-shell.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide pointer-to-parent coordinate mapping, marker semantics, gesture cancellation and overlapping selection. Select/Frame/Text/Draw/Comment are one toolbar beside attachments. Select supports drag, four resize handles, editable text and Fill. Respect node.size, weight, alignment, rectangle radius and clipping radius when painting. Draw creates a 300x560sketch frame beside a screen, strokes stored in the same JSON; reuse the standalone Void/Blueprint mechanisms by adapting their documented geometry rather than importing feature code into the browser. Attach chooser searches units/groups and expands selected group members to canonical unique IDs under attachment revision. Comments use element anchors and numbered pins. Watch follows actual committed activity; unchanged content/drafts remain usable while off. Conflict offers Show changes/Keep mine/Reload and must preserve both versions through T036.
- Visual: toolbar top-center 14, padding 6x8x6x12, gap 10, radius 14, panel, line; five tools 32, radius 8, selectedaccent/accent-ink. Sketch 300x560atadjacent screen x+ 350, y120, radius 18, dash 65, accent frame; normalized path 270x500at 15, 24, text stroke 2.2; swatches 22 visible/32 target with 14inner, three roles text/accent/wait; Pen, Marker, Eraser 12.5. Attach picker 300, padding 12, gap 8, radius 16, panel, line2, top 64; search 8x10, radius 10, card; rows 7x8, gap 10, tick 18. Comment popover 320, padding 14, gap 10, radius 16, panel, line2; breadcrumb 12/mute; editor field 10x12, radius 12; pin 26/wait; conflict banner below toolbar 66.
- Copy: `Select` / `Seleccionar`; `Frame` / `Marco`; `Text` / `Texto`; `Draw` / `Dibujar`; `Comment` / `Comentar`; `Fill` / `Relleno`; `Pen` / `Lápiz`; `Marker` / `Marcador`; `Eraser` / `Borrador`; `Attach agents` / `Adjuntar agentes`; `Search units and groups` / `Buscar unidades y grupos`; `Attach {count}` / `Adjuntar {count}`; `No agents attached` / `No hay agentes adjuntos`; `Show changes` / `Mostrar cambios`; `Keep mine` / `Conservar la versión propia`; `Reload` / `Volver a cargar`.
- Tests: nested parent drag, resize/zoom, pointer cancel and keyboard movement, no unknown-field loss, text size/radius/clip, strokes persisted/reloaded/Lite retained, marker/eraser, group attachment expansion, complete anchor, Watch and conflict behavior. Whole-board commit must merge a newer edit generation or retain a conflict, never replace later typing with an older response.
- Proof: `node --test test/gui-editors.test.mjs test/gui-shell.test.mjs test/blueprint-sketch.test.mjs`; zero failures and GUI matches 4.7 to 4.13.
- Depends on: T030, T032, T034. Commit message: `Edit and sketch on the same Blueprint board`.

#### T036. Preserve complete editor History and reversible conflict answers

- Screens: 4.13, 4.14, 5.1, 5.8, 5.9. Decisions: 18. Kind: JUDGMENT.
- Files: `engine/service/editors.mjs`, create/replace/node/range/comment/proposal operations and new history exports; `engine/service/http.mjs`, History routes/body/list; `engine/service/store.mjs`, history authorization/journal; `engine/sync/store.mjs`, `engine/sync/apply.mjs`, history path eligibility; `engine/service/events.mjs`, `editor.history.changed` visibility; `engine/service/import-events.mjs`, imported history event; `gui/app/editors.mjs`, history/conflict revision state; `gui/app/main.mjs`, Show changes/Keep mine/Reload/history selection; `test/service-editors.test.mjs`, `test/sync-apply.test.mjs`, `test/gui-editors.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide bounded immutable snapshot/object layout and complete author provenance. Implement C06 for board and text changes, including title-only edits and comments. Keep existing Void original/delta version sidecars intact. Every commit snapshots its document/comments atomically with its edit; Restore first keeps the current version. Show changes compares incoming/local draft. Both Keep mine and Reload preserve both byte sequences and their authors before replacing either. A restore updates current numeric Void rev, unknown-field preservation, comments placement and history metadata in one transaction. No file may exceed the existing 16 MBobject limit; report resource_too_large instead of truncating a snapshot.
  Preserve the existing `noticePlan` calls and comment message object construction as stable anchors for T039. History preparation adds entries/events to the same commit; it does not add message admission for a note with no recipient. Emit operation codes `create`, `rename`, `board-edit`, `sketch`, `text-edit`, `comment`, `proposal`, `conflict` and `restore` for those respective changes. T037 supplies the literal localized descriptions; raw operation codes remain wire data.
- Tests: creation/title/comment/node/range/proposal versions; author/source provenance; newest ordering/pagination; malformed snapshot refused; Restore and restore-back; exact comments revision; conflict both answers preserve both; stale restore zero writes; sync/transaction recovery; no silent history loss at bounds.
- Proof: `node --test test/service-editors.test.mjs test/sync-apply.test.mjs test/gui-editors.test.mjs`; zero failures, old and current versions both available after every conflict/restore.
- Depends on: T028, T035. Commit message: `Keep editor History through edits conflicts and restores`.

#### T037. Render history rows with Current and Restore

- Screens: 4.14, 5.1. Decisions: 18. Kind: MECHANICAL.
- Files: `gui/app/editors.mjs`, new `newestHistory`, `historyOperationKey` and `renderEditorHistory`; `gui/app/i18n.mjs`, keys; `gui/app/styles.css`, history rules; `test/final-history-order.test.mjs`, new pure helper test.
- Change: use T029's existing `element` import and append:

```js
export function newestHistory(items) {
  return [...items].sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.id.localeCompare(a.id));
}
export function historyOperationKey(operation) {
  const keys = { create: 'historyCreated', rename: 'historyRenamed', 'board-edit': 'historyBoardEdited',
    sketch: 'historySketchAdded', 'text-edit': 'historyTextEdited', comment: 'historyCommentAdded',
    proposal: 'historySuggestionAccepted', conflict: 'historyConflictResolved', restore: 'historyRestored' };
  return Object.hasOwn(keys, operation) ? keys[operation] : 'historyChanged';
}
export function renderEditorHistory(document, items, t, onRestore) {
  const panel = element(document, 'section', { class: 'editor-history', 'aria-label': t('history') });
  panel.append(element(document, 'h2', { text: t('history') }));
  for (const item of newestHistory(items)) {
    const row = element(document, 'article', { class: 'history-row', 'data-history-id': item.id });
    row.append(element(document, 'p', { text: item.by + ' · ' + item.at }), element(document, 'p', { text: t(historyOperationKey(item.operation)) }));
    if (item.current) row.append(element(document, 'span', { class: 'history-current', text: t('currentVersion') }));
    else row.append(element(document, 'button', { type: 'button', class: 'btn', text: t('restoreVersion'), onclick: () => onRestore(item) }));
    panel.append(row);
  }
  panel.append(element(document, 'p', { class: 'field-hint', text: t('restoreKeepsCurrent') }));
  return panel;
}
```

Add COPY keys:

```js
  history: ['History', 'Historial'],
  currentVersion: ['Current', 'Actual'],
  restoreVersion: ['Restore', 'Restaurar'],
  historyCreated: ['Created', 'Creado'],
  historyRenamed: ['Renamed', 'Renombrado'],
  historyBoardEdited: ['Edited the board', 'Editado el tablero'],
  historySketchAdded: ['Added a sketch', 'Agregado un boceto'],
  historyTextEdited: ['Edited the text', 'Editado el texto'],
  historyCommentAdded: ['Added a comment', 'Agregado un comentario'],
  historySuggestionAccepted: ['Accepted a suggestion', 'Aceptada una sugerencia'],
  historyConflictResolved: ['Resolved a conflict', 'Resuelto un conflicto'],
  historyRestored: ['Restored a version', 'Restaurada una versión'],
  historyChanged: ['Changed', 'Modificado'],
  restoreKeepsCurrent: ['Restoring keeps the current version in the list, so it can be restored back.', 'Restaurar conserva la versión actual en la lista para poder recuperarla después.'],
```

Append CSS:

```css
.editor-history { width: var(--editor-comments); padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; background: var(--panel); border-radius: var(--radius-panel); }
.history-row { padding: 10px 12px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; border-radius: 12px; background: var(--card); }
.history-row p { margin: 0; font-size: 13px; color: var(--body); }
.history-current { color: var(--accent); font-size: 12px; font-weight: 700; }
```

T036's caller passes paginated wire metadata and a revision-checked onRestore. The renderer selects literal localized descriptions without replacing the wire operation code.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { historyOperationKey, newestHistory } from '../gui/app/editors.mjs';

test('History sorts snapshots newest first without mutating the source', () => {
  const items = [{ id: 'a', at: '2026-10-13T00:00:00.000Z' }, { id: 'b', at: '2026-10-13T01:00:00.000Z' }];
  assert.deepEqual(newestHistory(items).map((item) => item.id), ['b', 'a']);
  assert.deepEqual(items.map((item) => item.id), ['a', 'b']);
  assert.equal(historyOperationKey('comment'), 'historyCommentAdded');
  assert.equal(historyOperationKey('unknown-legacy-change'), 'historyChanged');
  assert.equal(historyOperationKey('toString'), 'historyChanged');
});
```

- Proof: `node --test test/final-history-order.test.mjs test/gui-editors.test.mjs`; zero failures; only older versions expose Restore.
- Depends on: T036. Commit message: `Show editor versions and their restore action`.

### P7. Comment composer

#### T038. Persist the shared Send to agent preference

- Screens: 4.10, 4.13, 5.1 to 5.11. Decisions: 17. Kind: MECHANICAL.
- Files: `engine/service/units.mjs`, `patchSettings`; `engine/service/http.mjs`, PATCH /settings body; `test/service-projection.test.mjs`, added case.
- Change: after `hasLanguage`, add `const hasSendToAgent = Object.hasOwn(input ?? {}, 'sendToAgent');`. Replace the guard `if (!hasLook && !hasLanguage)` with `if (!hasLook && !hasLanguage && !hasSendToAgent)`. After language validation add:

```js
  if (hasSendToAgent && typeof input.sendToAgent !== 'boolean') throw new CoreError(422, 'invalid_body', 'Send to agent must be a boolean.');
```

After `if (hasLanguage) settings.language = input.language;`, insert:

```js
  settings.sendToAgent = hasSendToAgent ? input.sendToAgent : settings.sendToAgent ?? true;
```

Replace the HTTP allowedBody entry with:

```js
    'PATCH /settings': ['look', 'language', 'sendToAgent', 'expectedRevision'],
```

Absent preference reads as true at the composer, even before any settings write.

- Tests: append:

```js
test('Send to agent persists separately from theme and language', async (t) => {
  const fixture = await mind(t);
  const context = serviceContext(fixture);
  await patchSettings(context, { sendToAgent: false, expectedRevision: null });
  const file = path.join(fixture.paths.mind, 'user', 'gui', 'settings.json');
  const before = await readFile(file);
  assert.equal(JSON.parse(before).sendToAgent, false);
  await patchSettings(context, { language: 'es', expectedRevision: revisionOf(before) });
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.sendToAgent, false);
  assert.equal(saved.language, 'es');
  await assert.rejects(patchSettings(context, { sendToAgent: 'false', expectedRevision: revisionOf(await readFile(file)) }), { code: 'invalid_body' });
});
```

- Proof: `node --test test/service-projection.test.mjs`; zero failures; language/theme changes preserve false preference.
- Depends on: T001. Commit message: `Persist the shared comment notification preference`.

#### T039. Suppress attached-agent notices for a saved note

- Screens: 4.10, 4.13, 5.1. Decisions: 17. Kind: MECHANICAL.
- Files: `engine/service/editors.mjs`, createComment/replyComment, new commentRecipients; `engine/service/http.mjs`, comment/reply allowed bodies; `test/service-editors.test.mjs`, new recipient case.
- Change: insert before noticePlan:

```js
export function commentRecipients(context, input, attached, authorId) {
  if (input.sendToAgent !== undefined && typeof input.sendToAgent !== 'boolean') fail(422, 'invalid_body', 'Send to agent must be a boolean.');
  const recipients = recipientsFor(context, attached, authorId);
  return input.sendToAgent === false ? recipients.filter((unitId) => unitId === 'root:master') : recipients;
}
```

In createComment and replyComment, replace only the `recipientsFor(context, (await readAttachments(context, found.entry.id)).attached, authorId)` arguments passed to noticePlan with `commentRecipients(context, input, (await readAttachments(context, found.entry.id)).attached, authorId)`. In each of those two functions, replace `await admitComment(context, messageId);` or `await admitComment(context, message.id);` by the corresponding call guarded with `if (notices.entries.length)`. Keep document/comment/history commit independent of notices. Add `sendToAgent: input.sendToAgent !== false` on each new comment message object after text. The GUI sends its resolved persisted preference explicitly; legacy clients omitting it retain prior true behavior.

Replace exact HTTP entries:

```js
    'POST /editors/:resourceId/comments': ['text', 'expectedRevision', 'expectedCommentsRevision', 'anchor', 'sendToAgent'],
    'POST /editors/:resourceId/comments/:threadId/replies': ['text', 'expectedCommentsRevision', 'sendToAgent'],
```

- Tests: import commentRecipients in the existing editor import and append:

```js
test('Send to agent keeps local notes and only the person receives a suppressed agent reply', () => {
  const desktop = { principal: { audience: 'desktop', unitId: 'root:master' } };
  const attached = ['root:executor-shop', 'root:executor-shop', 'root:master'];
  assert.deepEqual(commentRecipients(desktop, {}, attached, 'root:master'), ['root:executor-shop']);
  assert.deepEqual(commentRecipients(desktop, { sendToAgent: false }, attached, 'root:master'), []);
  const agent = { principal: { audience: 'agent', unitId: 'root:executor-shop' } };
  assert.deepEqual(commentRecipients(agent, { sendToAgent: false }, attached, 'root:executor-shop'), ['root:master']);
  assert.throws(() => commentRecipients(desktop, { sendToAgent: 'false' }, attached, 'root:master'), { status: 422, code: 'invalid_body' });
});

test('a person note and its reply persist without message admission or fanout', async (t) => {
  const { fixture, context } = await shop(t);
  context.principal = { audience: 'desktop', unitId: 'root:master' };
  const board = await createBoard(context, { project: 'shop', document: sketch() });
  context.ledger = null;
  const note = await createComment(context, board.id, {
    text: 'Keep this as a note.', sendToAgent: false,
    expectedRevision: board.revision,
    expectedCommentsRevision: (await readComments(context, board.id)).commentsRevision,
    anchor: { screen: board.document.screens[0].id, label: 'Bag' },
  });
  assert.equal(note.thread.messages[0].sendToAgent, false);
  const replied = await replyComment(context, board.id, note.thread.id, {
    text: 'The note remains local.', sendToAgent: false,
    expectedCommentsRevision: note.commentsRevision,
  });
  assert.equal(replied.thread.messages.at(-1).sendToAgent, false);
  const stored = await readComments(context, board.id);
  assert.equal(stored.threads[0].messages.length, 2);
  for (const message of stored.threads[0].messages) {
    const fanout = path.join(fixture.paths.mind, 'user', 'relay', 'fanout', message.id + '.json');
    await assert.rejects(readFile(fanout), { code: 'ENOENT' });
  }
});
```

- Proof: `node --test test/service-editors.test.mjs`; zero failures; false person comments queue no recipient notices and consume no message admission.
- Depends on: T038. Commit message: `Save comment notes without notifying attached agents`.

#### T040. Share the persisted checkbox between both composers

- Screens: 4.1, 4.9 to 4.13, 5.1 to 5.11. Decisions: 17, 22. Kind: JUDGMENT.
- Files: `gui/app/editors.mjs`, comment/reply operation bodies and shared composer state; `gui/app/main.mjs`, `addEditorComment`, `sendEditorComment`, `replyToThread`, composer rendering; `gui/app/settings.mjs`, person setting load; `gui/app/i18n.mjs`, comment preference copy; `gui/app/styles.css`, checkbox/composer; `test/gui-fixture.mjs`, comment bodies/no-notice behavior; `test/gui-editors.test.mjs`, `test/gui-shell.test.mjs`, `test/service-api.test.mjs`.
- Change: decide preference-save conflict behavior so a composer toggle cannot change a pending comment's chosen payload. Read shared sendToAgent absent=true; explicit toggle PATCHes it under settings revision and both composers update from settings.changed. A comment operation captures the resolved boolean and attached IDs once. No attachment disables/unchecks the control visually while retaining the stored preference. A note still saves with its complete anchor/thread/history. False attached-agent sending never creates a wake; agent replies can still inform master. A lost setting response retries the same receipt; a new comment never silently adopts a later toggle.
- Visual: composer padding 12x14x16, gap 7; input padding 8x8x8x16, radius 22, card, line2; Send 34pill/accent; checkbox 16/radius 4, selectedaccent/checkaccent-ink, hit 32; rowgap 8, label 12.5/600, text; hint 12/mute; no-agent opacity 0.55. Comment popover values are T035.
- Copy: `Send to agent` / `Enviar al agente`; `No agents attached` / `No hay agentes adjuntos`; `Kept as a note, not sent` / `Guardado como nota, sin enviar`; `Notifies {count} attached agents` / `Notificar a {count} agentes adjuntos`; `Reply on the board` / `Responder en el tablero`; `Reply on the text` / `Responder en el texto`.
- Tests: both composers on default, false persists reopen/machine sync, absent attachments do not overwrite preference, suppression no admission/notices/wakes, one-notice true, setting conflict keeps visible choice, comment retry retains earlier boolean, agent reply person notification, phone checkbox absent.
- Proof: `node --test test/gui-editors.test.mjs test/gui-shell.test.mjs test/service-api.test.mjs`; zero failures; false survives navigation/restart and no recipient wake occurs.
- Depends on: T035, T037, T039. Commit message: `Share Send to agent across both comment composers`.

### P8. Void editor

#### T041. Preserve server-maintained text fields on replacement

- Screens: 5.4, 5.5, 5.7. Decisions: 19. Kind: MECHANICAL.
- Files: `engine/service/editors.mjs`, `replaceText`; `test/service-editors.test.mjs`, new core case.
- Change: immediately after `const incoming = validateText(input.document);` in replaceText, before preserveUnknown, insert:

```js
  incoming.rev = found.document.rev ?? 0;
  if (Object.hasOwn(found.document, 'history')) incoming.history = structuredClone(found.document.history);
  else delete incoming.history;
```

The existing later revision increment and .orig.json logic remain. Whole-editor saves may omit server-maintained fields; forged incoming values never replace them.

- Tests: append:

```js
test('Void replacement accepts omitted server fields and ignores forged revisions', async (t) => {
  const { context, localPath } = await shop(t);
  const created = await createText(context, { project: 'shop', path: 'docs/server-fields.json', document: {
    title: 'Notes', rev: 7, marker: { kept: true }, pages: [{ k: 'intro', en: 'Before', es: 'Antes' }],
  } });
  const originalPath = path.join(localPath, 'docs', 'server-fields.orig.json');
  const original = await readFile(originalPath);
  const first = await replaceText(context, created.id, { expectedRevision: created.revision, document: {
    title: 'Notes', marker: { kept: true }, pages: [{ k: 'intro', en: 'After', es: 'Antes' }],
  } });
  assert.equal(first.document.rev, 8);
  assert.deepEqual(first.document.marker, { kept: true });
  const second = await replaceText(context, created.id, { expectedRevision: first.revision, document: {
    ...structuredClone(first.document), rev: 9999, history: [{ forged: true }], pages: [{ k: 'intro', en: 'After again', es: 'Antes' }],
  } });
  assert.equal(second.document.rev, 9);
  assert.equal(Object.hasOwn(second.document, 'history'), false);
  assert.deepEqual(second.document.marker, { kept: true });
  assert.deepEqual(await readFile(originalPath), original);
});
```

- Proof: `node --test test/service-editors.test.mjs`; zero failures, unknown fields/original retained and forged server fields ignored.
- Depends on: T036. Commit message: `Keep text revision metadata owned by the core`.

#### T042. Serialize continuous saves while preserving later typing

- Screens: 5.4, 5.5. Decisions: 8, 19, 20. Kind: MECHANICAL.
- Files: `gui/app/void.mjs`, new `continuousSave`; `test/final-continuous-save.test.mjs`, new. T045 consumes it.
- Change: append:

```js
export function continuousSave({ save, revision, onState = () => {}, delayMs = 400 }) {
  let value = '';
  let generation = 0;
  let savedGeneration = 0;
  let attempt = null;
  let operation = null;
  let error = null;
  let timer = null;
  let running = null;
  let closed = false;
  function report(state) { if (!closed) onState({ state, value, generation, revision, error }); }
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (closed) return Promise.resolve();
    if (running) return running;
    if (error) return Promise.reject(error);
    running = (async () => {
      while (!closed && savedGeneration < generation) {
        attempt ??= { value, generation, revision };
        report('saving');
        try {
          const result = await save(attempt.value, attempt.revision, operation);
          const editor = result.data?.editor ?? result.data ?? result;
          revision = editor.revision ?? revision;
          savedGeneration = attempt.generation;
          attempt = null;
          operation = null;
        } catch (failure) {
          error = failure;
          operation = failure.operation ?? operation;
          report('not-saved');
          throw failure;
        }
      }
      report('saved');
    })().finally(() => { running = null; });
    return running;
  }
  return {
    queue(nextValue) {
      value = nextValue;
      generation += 1;
      report('saving');
      clearTimeout(timer);
      if (!error && !closed) timer = setTimeout(() => { void flush().catch(() => {}); }, delayMs);
    },
    flush,
    retry() { error = null; return flush(); },
    dispose() { closed = true; clearTimeout(timer); timer = null; },
    get dirty() { return savedGeneration < generation; },
  };
}
```

The 400msquiet interval is a fixed local editor implementation value. No request is retried automatically after uncertainty. Failed snapshots keep their operation until explicit Retry; later typing saves after that snapshot settles, under its returned revision. The editor retains the actual draft outside this controller when disposed.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { continuousSave } from '../gui/app/void.mjs';

test('continuous saving preserves typing during an earlier in-flight save', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const editor = continuousSave({ revision: 'first', delayMs: 60000, save: async (value, revision) => {
    calls.push({ value, revision });
    if (calls.length === 1) await gate;
    return { revision: 'revision-' + calls.length };
  } });
  editor.queue('First draft');
  const pending = editor.flush();
  editor.queue('Later draft');
  release();
  await pending;
  assert.deepEqual(calls, [{ value: 'First draft', revision: 'first' }, { value: 'Later draft', revision: 'revision-1' }]);
  assert.equal(editor.dirty, false);
  editor.dispose();
});

test('Retry retains an uncertain save operation while later typing remains queued', async () => {
  const retained = { id: 'same-operation' };
  const calls = [];
  let failed = false;
  const editor = continuousSave({ revision: 'first', delayMs: 60000, save: async (value, revision, operation) => {
    calls.push({ value, revision, operation });
    if (!failed) { failed = true; throw Object.assign(new Error('Unconfirmed'), { operation: retained }); }
    return { revision: 'saved' };
  } });
  editor.queue('Failed draft');
  await assert.rejects(editor.flush());
  editor.queue('Later draft');
  await editor.retry();
  assert.equal(calls[1].operation, retained);
  assert.equal(calls[1].value, 'Failed draft');
  assert.equal(calls[2].value, 'Later draft');
  assert.equal(calls[2].revision, 'saved');
  assert.equal(editor.dirty, false);
  editor.dispose();
});
```

- Proof: `node --test test/final-continuous-save.test.mjs`; two passed tests, zero failures and no later draft cleared by an earlier response.
- Depends on: T041. Commit message: `Serialize continuous saves without discarding newer drafts`.

#### T043. Find literal or regular-expression matches with explicit options

- Screens: 5.6. Decisions: 19. Kind: MECHANICAL.
- Files: `gui/app/void.mjs`, new `findTextMatches`; `test/final-find-matches.test.mjs`, new. T046 runs regular expressions in a bounded worker.
- Change: append:

```js
export function findTextMatches(source, query, { caseSensitive = false, wholeWord = false, regularExpression = false } = {}) {
  if (!query) return [];
  const pattern = regularExpression ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(pattern, caseSensitive ? 'gu' : 'giu');
  const word = (value) => /[\p{L}\p{M}\p{N}_]/u.test(value ?? '');
  const matches = [];
  for (const match of source.matchAll(expression)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!match[0].length) continue;
    if (wholeWord && (word([...source.slice(Math.max(0, start - 2), start)].at(-1)) || word([...source.slice(end, end + 2)].at(0)))) continue;
    matches.push({ start, end, text: match[0], captures: match.slice(1) });
    if (matches.length > 10000) throw new RangeError('Too many matches.');
  }
  return matches;
}
```

This helper operates on the already mapped visible-text string. T045/T046 map these offsets back to original source before edits. Invalid regex throws; the UI displays its localized error and performs no save.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { findTextMatches } from '../gui/app/void.mjs';

test('Find supports literal metacharacters case and whole-word Unicode text', () => {
  assert.equal(findTextMatches('a.b aXb', 'a.b').length, 1);
  assert.equal(findTextMatches('Machine machine', 'machine', { caseSensitive: true }).length, 1);
  assert.equal(findTextMatches('máquina máquinas', 'máquina', { wholeWord: true }).length, 1);
  assert.equal(findTextMatches('\u{10400}cat cat\u0301 cat', 'cat', { wholeWord: true }).length, 1);
  assert.deepEqual(findTextMatches('abc123', '(abc)([0-9]+)', { regularExpression: true })[0].captures, ['abc', '123']);
  assert.throws(() => findTextMatches('text', '[', { regularExpression: true }), SyntaxError);
  assert.deepEqual(findTextMatches('text', ''), []);
});
```

- Proof: `node --test test/final-find-matches.test.mjs`; one passed test, zero failures and literal dot never acts as regex wildcard.
- Depends on: T042. Commit message: `Find text with explicit case word and regex options`.

#### T044. Map a source caret into the rendered token domain

- Screens: 5.7. Decisions: 19. Kind: MECHANICAL.
- Files: `gui/app/markup.mjs`, new `plainCaretFromSource`; `test/final-caret-map.test.mjs`, new.
- Change: append:

```js
export function plainCaretFromSource(tokens, offset) {
  if (!Number.isInteger(offset) || offset < 0) return null;
  for (const token of tokens) {
    if (offset < token.sourceStart) return token.plainStart;
    if (offset <= token.sourceEnd) {
      if (token.type !== 'text') return token.plainStart;
      return token.plainStart + Math.min(offset - token.sourceStart, token.plainEnd - token.plainStart);
    }
  }
  return offset === (tokens.at(-1)?.sourceEnd ?? 0) ? tokens.at(-1)?.plainEnd ?? 0 : null;
}
```

T045's lossless Markdown tokenizer supplies the same sourceStart/sourceEnd/plainStart/plainEnd contract as the current tokenizer. Safe UTF-16 boundaries are checked before caret restoration; no caret is placed inside a surrogate pair. The opposite direction uses existing sourceBoundary with explicit start/end affinity.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { plainCaretFromSource, sourceBoundary, tokenizeMarkup, validUtf16Boundary } from '../gui/app/markup.mjs';

test('caret mapping keeps markup boundaries and source offsets distinct', () => {
  const source = '<b>A😀</b>';
  const tokens = tokenizeMarkup(source);
  assert.equal(plainCaretFromSource(tokens, 3), 0);
  assert.equal(plainCaretFromSource(tokens, 6), 3);
  assert.equal(sourceBoundary(source, 0, 'end'), 3);
  assert.equal(validUtf16Boundary(source, 5), false);
  assert.equal(plainCaretFromSource(tokens, source.length), 3);
  assert.equal(plainCaretFromSource(tokens, source.length + 1), null);
});
```

- Proof: `node --test test/final-caret-map.test.mjs test/gui-editors.test.mjs`; zero failures; source/rendered caret domains are not confused.
- Depends on: T041. Commit message: `Map source carets through rendered text tokens`.

#### T045. Adapt the existing Void editor for lossless in-place Markdown

- Screens: 5.4, 5.5, 5.7, 5.10, 5.11. Decisions: 8, 19, 22. Kind: JUDGMENT.
- Files: `features/void/text.mjs`, `plain`; `features/void/comments.mjs`, source/plain anchor relocation; `features/void/reader.html`, existing selection/editor semantics used as reference; `gui/app/markup.mjs`, tokenizer/render/offset metadata; `gui/app/void.mjs`, Document/save/caret/focus integration; `gui/app/main.mjs`, `voidSurface`, `saveVoid`, selection/format/source/focus tools; `engine/service/editors.mjs`, source and anchor validation; `gui/app/i18n.mjs`, format/save/source strings; `gui/app/styles.css`, in-place/format/source/focus rules; `test/void.test.mjs`, `test/service-editors.test.mjs`, `test/gui-editors.test.mjs`, `test/gui-shell.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide the lossless Markdown/legacy token mapping, newline normalization and browser editing model. Adapt existing Void behavior, stable k/language blocks and safe DOM rendering; do not build a parallel document format. Render Markdown and legacy b/i consistently in core and browser. Keep raw unsupported HTML literal. Validate link protocols and project asset identity. A selected passage shows exactly Bold/Italic/Strikethrough, H1/H2/H3, List/Quote/Code/Link/Table/Image/Comment in that order; collapsed selection hides it. Continuous save uses T042, retained editor drafts and generation-aware acknowledgment. Not saved appears at failure, Retry retains its exact operation; the current saveVoid's unconditional draft deletion must be removed. Source shows exact Markdown and caret via T044; returning preserves page/language/selection. Focus retains pure black, same text/draft/caret, arrows and mouse/Escape behavior.
- Visual: document 640x760, top 70, padding 44x56, radius 20, panel; title 26/700, subtitle 13/mute, body 15.5/1.65, heading 16/700; format bar gap 1, padding 4, radius 12, card2, line2, controls 32/radius 7, icons 14; selectionaccent-soft/caret 2x20accent. Source 640x760, top 70, padding 36x40, gap 6, radius 20, mono 13/1.6. Not-saved banner top 66, error-soft, radius 14, Retry; document top 110, height 720. Focus text 640, top 120, gap 18, title 28, body 17/1.8, caret 2x22; tools top 18, padding 8x10, gap 10, radius 14, panel/line; page dots 22 selected/8 other at bottom 28.
- Copy: `Saving` / `Guardando`; `Saved` / `Guardado`; `Not saved` / `Sin guardar`; `The change was not saved: the M1ND folder did not answer. The text stays here.` / `No se guardó el cambio: la carpeta del M1ND no respondió. El texto permanece aquí.`; `Bold` / `Negrita`; `Italic` / `Cursiva`; `Strikethrough` / `Tachado`; `List` / `Lista`; `Quote` / `Cita`; `Code` / `Código`; `Link` / `Enlace`; `Table` / `Tabla`; `Image` / `Imagen`; `Source` / `Fuente`; `The source view keeps the caret where it was in the Document view.` / `La vista de fuente conserva la posición del cursor de la vista Documento.`; `Document` / `Documento`; `Page {page} of {pages}` / `Página {page} de {pages}`.
- Tests: all format operations with exact source output; legacy/bilingual/unknown fields; newline/source-plain consistency; emoji/surrogate/tag affinity; safe/raw HTML/URLs/images; collapsed/multiblock selection; in-flight later typing; failed save and Retry; source/caret round trip; Focus tools/arrows/Escape same resource/caret; no extra submit form.
- Proof: `node --test test/void.test.mjs test/service-editors.test.mjs test/gui-editors.test.mjs test/gui-shell.test.mjs`; zero failures and actual GUI matches 5.4, 5.5, 5.7, 5.10, 5.11.
- Depends on: T040, T042, T044. Commit message: `Edit Void documents in place with continuous saving`.

#### T046. Replace matches across texts as one undoable transaction

- Screens: 5.6. Decisions: 19. Kind: JUDGMENT.
- Files: `engine/service/editors.mjs`, new batch replace/undo exports; `engine/service/http.mjs`, C08 routes, bounded bodies, `BROWSER_STATIC_FILES` entry `find-worker.mjs` and same-origin worker CSP; `engine/service/store.mjs`, multi-resource undo checks; `gui/app/find-worker.mjs`, new isolated regex worker; `gui/app/void.mjs`, Find state/worker lifecycle/replacement projection; `gui/app/main.mjs`, find bar and actions; `gui/app/i18n.mjs`, find strings; `gui/app/styles.css`, find bar/hits; `test/service-editors.test.mjs`, `test/gui-editors.test.mjs`, `test/gui-shell.test.mjs`, `test/service-install.test.mjs`, worker asset packaging; `test/gui-fixture.mjs`.
- Change: decide bounded regex worker lifecycle and capture-substitution semantics while preserving exact source ranges. Implement C08: document/all accessible texts, case/whole-word/regex, prev/next current hit, Replace/Replace all count, atomic validation and one whole-operation Undo. Use T043 only inside the cancellable worker for user regex; terminate after 100msCPU/wall budget and show explicit pattern-too-slow feedback. Matching count has 10000 cap. Map visible matches to safe source boundaries via T045. Snapshot all affected documents/comments before writing, apply descending nonoverlapping ranges and validate every post-replace revision before one undo. A partial failure changes no text. A regex pattern is data, never JavaScript source evaluated by eval.
  Create a module worker from `new URL('./find-worker.mjs', import.meta.url)` with `{type:'module'}`; allow `worker-src 'self'` while retaining the existing restrictive CSP for scripts. The worker imports `findTextMatches` from `void.mjs` without invoking DOM functions. Its message envelope is `{id:string,text:string,query:string,options:{caseSensitive:boolean,wholeWord:boolean,regularExpression:boolean}}`; the response is `{id:string,matches:{start:number,end:number,text:string,captures:string[]}[]}` or `{id:string,error:{code:'invalid_pattern'|'too_many_matches',message:string}}`. Map undefined captures to empty strings in the worker response. The helper enforces the fixed 10000-match cap. The main thread binds replies to the current generation and terminates abandoned/timed-out workers. Add `find-worker.mjs` to actual package/fixture static-asset checks.
- Visual: find bar 640, top 70, padding 12x14, gap 8, radius 16, panel, line2; find row card/radius 10, padding 8x10, active accent line, match count 12/mute; three toggles Aa, W, .* visible 30/hit 32, radius 8, line2; replacement row, Replace plain/Replace all primary; scope labels 12, active 700/accent; document top 222, height 600; all hitswait-soft, currentaccent/accent-ink.
- Copy: `Find and replace` / `Buscar y reemplazar`; `Match case` / `Distinguir mayúsculas`; `Whole word` / `Palabra completa`; `Regular expression` / `Expresión regular`; `{current} of {total}` / `{current} de {total}`; `Replace` / `Reemplazar`; `Replace all {count}` / `Reemplazar las {count} coincidencias`; `This document` / `Este documento`; `All texts` / `Todos los textos`; `Undo puts every replaced match back at once.` / `Deshacer recupera todas las coincidencias reemplazadas en una sola operación.`; `The pattern took too long. Change it and try again.` / `El patrón tardó demasiado. Cambiarlo y reintentar.`
- Tests: four option combinations, Unicode whole-word, regex invalid/zero-length/slow/captures, all-text paging, source mapping, one replacement/same text/all texts, one stale target zero writes, crash recovery, one Undo restores whole batch and conflicts on later edits.
- Proof: `node --test test/service-editors.test.mjs test/gui-editors.test.mjs test/gui-shell.test.mjs`; zero failures; entire batch/undo is atomic and slow regex cannot hang the GUI.
- Depends on: T043, T045. Commit message: `Replace matches across texts with a single Undo`.

#### T047. Edit a suggestion while preserving its original preconditions

- Screens: 5.8, 5.9. Decisions: 19. Kind: JUDGMENT.
- Files: `engine/service/editors.mjs`, `answerProposal`; `engine/service/http.mjs`, proposal body; `gui/app/void.mjs`, proposal draft/answer; `gui/app/main.mjs`, `appendProposals`, `answerVoid`, Edit passage/Ask again; `gui/app/i18n.mjs`, suggestion strings; `gui/app/styles.css`, suggestion edit/warning; `test/service-editors.test.mjs`, `test/gui-editors.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide how edited replacement text is kept in a local suggestion draft without changing original baseRevision/expectedText. Implement C08 replacement override on accept. Show Accept change, Edit, Discard for valid suggestions; an old one shows warning, Edit passage, Ask again, Discard. Edit passage opens current actual source through the same editor; Ask again makes a new revision-correct comment with persisted Send to agent. Never silently rebase or apply an old proposal. Retain discussion/proposal ID and transactionally commit accepted text/comments/history.
- Visual: suggested passage accent-soft, accent 2-pixel bottom line; reply indentation 18, card, padding 11x12, radius 16, gap 6; stale warning wait-soft, padding 11x12, radius 16, gap 8, alert 14/title 13/700, body 13; actions minimum 32 pixels.
- Copy: `Accept change` / `Aceptar cambio`; `Edit` / `Editar`; `Discard` / `Descartar`; `The text changed after this suggestion` / `El texto cambió después de esta sugerencia`; `Edit passage` / `Editar el pasaje`; `Ask again` / `Solicitar de nuevo`; `It was not applied. Edit the passage yourself, ask again on the current text, or discard it.` / `No se aplicó. Editar el pasaje, solicitar de nuevo sobre el texto actual o descartar la sugerencia.`
- Tests: edited valid replacement; unchanged expected text/base; stale edited accept zero writes; retry one acceptance/history entry; Ask again current anchor/preference; discard preserves discussion; unknown fields and numeric rev retained.
- Proof: `node --test test/service-editors.test.mjs test/gui-editors.test.mjs`; zero failures; stale suggestion remains explicit and never auto-applies.
- Depends on: T045, T046. Commit message: `Allow suggestion editing without rebasing stale changes`.

### P9. Settings, agents and permissions

#### T048. Accept all six looks throughout core, host, embed and fixture

- Screens: 6.1. Decisions: 14. Kind: MECHANICAL.
- Files: `engine/service/units.mjs`, look validation; `engine/service/http.mjs`, viewer/localPresentation guards; `gui/index.mjs`, startGui/setTheme guards; `gui/app/embed.mjs`, set-look; `gui/app/main.mjs`, three presentation clamps; `test/gui-fixture.mjs`, three look guards; `gui/app/i18n.mjs`, look labels; `test/gui-shell.test.mjs`, visible Nocturne expectation; `test/service-projection.test.mjs`, added case.
- Change: execute the following complete edit program with `node --input-type=module` over standard input. It refuses different before-text/counts and writes only the listed files. This program is an executable patch, not product code.

```js
import { readFile, writeFile } from 'node:fs/promises';
const single = "['modern', 'high-contrast', 'nebula', 'txmska', 'coffee-cat', 'ntk']";
const double = '["modern", "high-contrast", "nebula", "txmska", "coffee-cat", "ntk"]';
async function edit(file, before, after, count) {
  const source = await readFile(file, 'utf8');
  if (source.split(before).length - 1 !== count) throw new Error('Unexpected patch count: ' + file);
  await writeFile(file, source.replaceAll(before, after), 'utf8');
}
await edit('engine/service/units.mjs', "input.look !== 'modern' && input.look !== 'high-contrast'", '!' + single + '.includes(input.look)', 1);
await edit('engine/service/http.mjs', "body.look !== 'modern' && body.look !== 'high-contrast'", '!' + single + '.includes(body.look)', 1);
await edit('engine/service/http.mjs', "look !== 'modern' && look !== 'high-contrast'", '!' + single + '.includes(look)', 1);
await edit('gui/index.mjs', "['modern', 'high-contrast']", single, 2);
await edit('gui/app/embed.mjs', '["modern", "high-contrast"]', double, 1);
await edit('gui/app/main.mjs', 'choice.look === "high-contrast" ? "high-contrast" : "modern"', double + '.includes(choice.look) ? choice.look : "modern"', 3);
await edit('test/gui-fixture.mjs', '["modern", "high-contrast"]', double, 2);
await edit('test/gui-fixture.mjs', '[null, "modern", "high-contrast"]', '[null, "modern", "high-contrast", "nebula", "txmska", "coffee-cat", "ntk"]', 1);
await edit('gui/app/i18n.mjs', 'highContrast: ["High contrast", "Alto contraste"]', 'highContrast: ["Nocturne", "Nocturne"]', 1);
await edit('gui/app/i18n.mjs', 'modern: ["Modern", "Moderno"]', 'modern: ["Modern", "Modern"]', 1);
await edit('test/gui-shell.test.mjs', '"Alto contraste"', '"Nocturne"', 1);
```

Add COPY entries `nebula:['Nebula','Nebula'],waves:['Waves','Waves'],toxic:['Toxic','Toxic'],kinetic:['Kinetic','Kinetic']`. Use wire IDs exactly as C09; never substitute the board drawing ID `contrast` for high-contrast.

- Tests: append to `test/service-projection.test.mjs`:

```js
test('all six looks persist while existing high-contrast remains compatible', async (t) => {
  const fixture = await mind(t);
  const context = serviceContext(fixture);
  let revision = null;
  for (const look of ['modern', 'high-contrast', 'nebula', 'txmska', 'coffee-cat', 'ntk']) {
    await patchSettings(context, { look, expectedRevision: revision });
    const file = path.join(fixture.paths.mind, 'user', 'gui', 'settings.json');
    const bytes = await readFile(file);
    assert.equal(JSON.parse(bytes).look, look);
    revision = revisionOf(bytes);
  }
});
```

- Proof: `node --test test/service-projection.test.mjs test/gui-shell.test.mjs test/gui-fixture.test.mjs`; zero failures; persisted host and embedded choices retain all six wire values.
- Depends on: T038. Commit message: `Accept the six final looks across all presentation entry points`.

#### T049. Add the four family palettes as design tokens

- Screens: 6.1, all themed surfaces. Decisions: 14, 22. Kind: MECHANICAL.
- Files: `gui/app/styles.css`, appended palette selectors; `test/final-palettes.test.mjs`, new.
- Change: append the complete CSS. Roles not overridden inherit Modern, exactly as the board's FAMILY definitions. Raw colors occur only in token definitions.

```css
[data-look="nebula"] {
  --bg: #020102; --panel: #0a0708; --card: #171113; --card2: #21191b;
  --line: #2a1e21; --line2: #3d2b2f; --text: #f7f0f1; --body: #f7f0f1; --mute: #a38f92;
  --accent: #ff2d48; --accent-ink: #0a0708; --ring: #c8203a; --ground: #050304; --me: #21191b;
}
[data-look="txmska"] {
  --bg: #09060f; --panel: #11081e; --card: #1c1138; --card2: #201a52;
  --line: #1c1138; --line2: #381a72; --text: #f2e0ff; --body: #d4a8f5; --mute: #a493c2;
  --accent: #a855f7; --accent-ink: #09060f; --ring: #381a72; --ground: #0b0714; --me: #201a52;
}
[data-look="coffee-cat"] {
  --bg: #2c1c40; --panel: #3e2761; --card: #3d2860; --card2: #6942af;
  --line: rgba(105, 66, 175, 0.55); --line2: #6942af; --text: #f7f7f7;
  --body: rgba(247, 247, 247, 0.88); --mute: #d6d2dc;
  --accent: #a8f205; --accent-ink: #2c1c40; --ring: #a8f205; --ground: #26183a; --me: #6942af;
}
[data-look="ntk"] {
  --bg: #100e0c; --panel: #1a1714; --card: #26221e; --card2: #332e29;
  --line: #332e29; --line2: #4a433b; --text: #f5f1ec; --body: #cec5b9; --mute: #a79e93;
  --accent: #ff6b1a; --accent-ink: #120c06; --ring: #ff6b1a; --ground: #13110e; --me: #332e29;
}
```

T062 measures and corrects any contrast shortfall using these roles. The token source does not itself prove accessible contrast on card2 or alpha fills.

- Tests: create:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('every family look has a local palette and no remote asset requirement', async () => {
  const css = await readFile(new URL('../gui/app/styles.css', import.meta.url), 'utf8');
  for (const look of ['nebula', 'txmska', 'coffee-cat', 'ntk']) {
    const marker = '[data-look="' + look + '"]';
    const block = css.slice(css.indexOf(marker)).split('}')[0];
    assert.ok(block.includes('--accent:'));
    assert.ok(block.includes('--bg:'));
    assert.ok(block.includes('--mute:'));
  }
  assert.equal(/@import\s+url|https?:\/\//i.test(css), false);
});
```

- Proof: `node --test test/final-palettes.test.mjs test/gui-shell.test.mjs`; zero failures; six looks render using local assets only.
- Depends on: T048. Commit message: `Add the final Cosmic family palette tokens`.

#### T050. Build theme previews in their own palettes

- Screens: 6.1. Decisions: 14, 22. Kind: MECHANICAL.
- Files: `gui/app/settings.mjs`, new LOOK_OPTIONS and `renderLookPreview`; `gui/app/styles.css`, preview rules; `test/final-look-options.test.mjs`, new. T055 mounts previews.
- Change: append:

```js
export const LOOK_OPTIONS = Object.freeze([
  { id: 'modern', label: 'Modern' }, { id: 'high-contrast', label: 'Nocturne' },
  { id: 'nebula', label: 'Nebula' }, { id: 'txmska', label: 'Waves' },
  { id: 'coffee-cat', label: 'Toxic' }, { id: 'ntk', label: 'Kinetic' },
]);
export function renderLookPreview(document, look, selected, onChoose) {
  const button = element(document, 'button', { type: 'button', class: 'look-choice',
    'aria-label': look.label, 'aria-pressed': String(selected), onclick: () => onChoose(look.id) });
  const preview = element(document, 'span', { class: 'look-preview', 'data-look': look.id, 'aria-hidden': 'true' });
  preview.append(element(document, 'span', { class: 'look-preview-bar' },
    element(document, 'span', { class: 'look-preview-mark' }),
    element(document, 'span', { class: 'look-preview-modes' })));
  const panels = element(document, 'span', { class: 'look-preview-panels' });
  const side = element(document, 'span', { class: 'look-preview-side' });
  for (const width of [24, 20, 22]) side.append(element(document, 'span', {
    class: 'look-preview-line' + (width === 22 ? ' look-preview-accent' : ''), style: 'width: ' + width + 'px' }));
  const map = element(document, 'span', { class: 'look-preview-map' },
    element(document, 'span', { class: 'look-preview-node look-preview-node-one' }),
    element(document, 'span', { class: 'look-preview-node look-preview-node-two' }));
  const inspector = element(document, 'span', { class: 'look-preview-inspector' });
  for (const [width, height, ink] of [[32, 10, 'card'], [26, 10, 'me'], [30, 7, 'accent']]) {
    inspector.append(element(document, 'span', { class: 'look-preview-bubble look-preview-' + ink,
      style: 'width: ' + width + 'px; height: ' + height + 'px' }));
  }
  panels.append(side, map, inspector);
  preview.append(panels);
  const label = element(document, 'span', { class: 'look-preview-name' },
    element(document, 'span', { class: 'look-preview-radio', 'aria-hidden': 'true' }), look.label);
  button.append(preview, label);
  return button;
}
```

Append CSS:

```css
.look-choice { width: 166px; padding: 0; display: flex; flex-direction: column; gap: 8px; border: 0; background: transparent; text-align: left; }
.look-preview { position: relative; width: 166px; height: 100px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line2); overflow: hidden; }
.look-choice[aria-pressed="true"] .look-preview { outline: 2px solid var(--accent); outline-offset: -2px; }
.look-preview-bar { position: absolute; inset: 0 0 auto; height: 18px; display: flex; align-items: center; gap: 5px; padding: 0 8px; }
.look-preview-mark { width: 8px; height: 8px; border-radius: 2px; background: var(--accent); }
.look-preview-modes { width: 44px; height: 8px; margin: 0 auto; border-radius: 4px; background: var(--card2); }
.look-preview-panels { position: absolute; inset: 20px 0 auto; display: grid; grid-template-columns: 36px minmax(0, 1fr) 44px; gap: 4px; height: 80px; padding: 0 5px 5px; }
.look-preview-side, .look-preview-inspector { display: flex; flex-direction: column; gap: 4px; padding: 5px; border-radius: 7px; background: var(--panel); border: 1px solid var(--line); }
.look-preview-line { height: 5px; border-radius: 3px; background: var(--card2); flex: 0 0 auto; }
.look-preview-map { position: relative; border-radius: 7px; background: var(--ground); border: 1px solid var(--line); }
.look-preview-node { position: absolute; border-radius: 50%; border: 1.5px solid var(--accent); }
.look-preview-node-one { left: 30px; top: 26px; width: 14px; height: 14px; }
.look-preview-node-two { left: 62px; top: 50px; width: 12px; height: 12px; border-color: var(--ring); }
.look-preview-bubble { border-radius: 4px; flex: 0 0 auto; }
.look-preview-card { background: var(--card); }
.look-preview-me { background: var(--me); }
.look-preview-accent { background: var(--accent); }
.look-preview-name { min-height: 32px; display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--body); }
.look-preview-radio { width: 16px; height: 16px; border: 2px solid var(--line2); border-radius: 50%; display: grid; place-items: center; }
.look-choice[aria-pressed="true"] .look-preview-radio { border-color: var(--accent); }
.look-choice[aria-pressed="true"] .look-preview-radio::after { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.look-choice[aria-pressed="true"] .look-preview-name { color: var(--text); font-weight: 700; }
.look-preview[data-look="high-contrast"] .look-preview-bar { background: var(--panel); }
.look-preview[data-look="high-contrast"] .look-preview-panels { gap: 0; padding: 0; }
.look-preview[data-look="high-contrast"] .look-preview-side,
.look-preview[data-look="high-contrast"] .look-preview-inspector,
.look-preview[data-look="high-contrast"] .look-preview-map { border: 0; border-radius: 0; }
.look-preview[data-look="high-contrast"] .look-preview-map { background: var(--bg); }
```

T055 mounts the six complete previews in two rows of three, with 12-pixel gaps. Each preview has its own data-look and therefore its own token palette; the outer label uses the page palette. The miniature is decorative and the containing button owns its accessible name and selection state.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { LOOK_OPTIONS } from '../gui/app/settings.mjs';

test('look previews keep wire identity separate from visible names', () => {
  assert.deepEqual(LOOK_OPTIONS.map((look) => look.id), ['modern', 'high-contrast', 'nebula', 'txmska', 'coffee-cat', 'ntk']);
  assert.deepEqual(LOOK_OPTIONS.map((look) => look.label), ['Modern', 'Nocturne', 'Nebula', 'Waves', 'Toxic', 'Kinetic']);
  assert.equal(new Set(LOOK_OPTIONS.map((look) => look.id)).size, 6);
});
```

- Proof: `node --test test/final-look-options.test.mjs test/gui-shell.test.mjs`; zero failures; preview order and selected wire ID are exact.
- Depends on: T049. Commit message: `Preview every look in its own palette`.

#### T051. Publish machine-owned Settings reports and route mutations to their owner

- Screens: 6.1, 6.2, 6.4, 6.6, 6.8. Decisions: 7, 12, 13. Kind: JUDGMENT.
- Files: new `engine/service/settings.mjs`, `readMachineSettings`, `scanAgents`, `findAgent`, `readContent`, `writeContent`; `engine/service/http.mjs`, C09 GET/mutation/schema/body/query; `engine/service/service.mjs`, composeCore/settings owner execution/report publication; `engine/service/projection.mjs`, service/locations/sanitized report; `engine/records.mjs`, machine report compatibility; `engine/discovery.mjs`, existing agents/content/projects discovery; `engine/sync/store.mjs`, eligible machine report records; `engine/service/import-events.mjs`, machine.settings.changed; `test/service-settings.test.mjs`, new; `test/service-api.test.mjs`, `test/sync-apply.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide authenticated remote owner request/result records using existing service request infrastructure, with revision checks and offline read-only reports. Implement C09 schema exactly. Agents/Permissions/Projects/Locations are per selected machine; look/language/person comment preference and Content remain shared. Scanning/find is bounded, uses known adapters and never executes arbitrary binary/path commands. Reports include found version, connected CLI vs optional app, mode and change count. Publish sanitized machine-owned reports only; never client file contents, kept copies or credentials. Locations are actual paths from servicePaths, not the board's sample staging path. Offline mutation returns machine_unavailable, not local fallback.
- Tests: each route read/mutation/unknown-field; machine report integrity and last-report offline fallback; no secret/config-content serialization; remote owner-only execution; stale/replayed request; scan repeated idempotency; available/missing clients; malformed/unavailable paths; content preference retention and machine scope.
- Proof: `node --test test/service-settings.test.mjs test/service-api.test.mjs test/sync-apply.test.mjs`; zero failures; a selected offline machine causes zero local configuration writes.
- Depends on: T005, T048. Commit message: `Read and change Settings on the selected machine`.

#### T052. Review exact client configuration changes before applying them

- Screens: 6.2, 6.3. Decisions: 12. Kind: JUDGMENT.
- Files: `engine/service/settings.mjs`, preview/apply/disconnect exports; `engine/relay/config.mjs`, `buildClientConfig`, `atomicConfigWrite`, `configureRelayClient`, `unconfigureRelayClient`, backup merge/restore; `engine/install.mjs`, owned preview/apply assets; `engine/service/http.mjs`, client preview/apply/disconnect; `engine/service/adapters.mjs`, connected-client readiness and explicit reload; `test/service-settings.test.mjs`, `test/relay-config.test.mjs`, `test/install-ownership.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide protected preview binding, backup restoration and selected session scope without granting broad client permissions. Auto/On demand and app connect first produce a read-only preview with exact file descriptions, hashes and selected changes. Changes needed are pending until explicit Apply; Copy changes writes only clipboard text. Use existing pure configuration transforms and kept `.relay-backup` primitive; retain credential bytes through opaque local state rather than echoing them in preview. Hash drift invalidates preview. Keep original copies before every selected write and rollback partial writes. Disconnect restores owned original entries while preserving later foreign edits, or reports configuration_changed. Optional git change remains unchecked. Required client reload happens only under its reviewed action and owned sessions; never kill unrelated app work.
- Tests: zero writes on preview/copy/cancel, exact 2required changes, optional git initiallyfalse, stale hash, selected subset, partial failure rollback, foreign entries/secret fields preserved, Disconnect kept-copy restore/foreign drift, mode/app separate, target client/machine binding, one apply on retry.
- Proof: `node --test test/service-settings.test.mjs test/relay-config.test.mjs test/install-ownership.test.mjs`; zero failures and all preview/cancel/copy cases have no filesystem mutation.
- Depends on: T051. Commit message: `Review client configuration changes before applying them`.

#### T053. Scope and revoke permissions and classify desktop-only asks

- Screens: 3.4, 6.3, 6.5, 7.5, 7.6. Decisions: 11, 12, 21. Kind: JUDGMENT.
- Files: `engine/service/settings.mjs`, local agent permission ledger/revocation; `engine/service/approvals.mjs`, action normalization, desktop-only response/owner application; `engine/service/adapters.mjs`, session-scoped capability injection and trusted git classification; `engine/service/http.mjs`, permission routes and pre-receipt authorization; `engine/service/security.mjs`, safe permission details; `engine/service/projection.mjs`, sanitized unit grants/agent permissions; `test/service-settings.test.mjs`, `test/service-approvals.test.mjs`, `test/service-auth.test.mjs`, `test/service-sessions.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide a trusted structured classification for direct git.push and process.run push asks. Never determine phone authority from a display string or naive `git push` substring. Add `desktopOnly:boolean` to Approval projection, derived by the service/adapter from the normalized action; it is not an agent-controlled false override. Phone rejects desktopOnly answers before receipt replay, grants or notices. Agent git permission applies only to sessions HIVEM1ND starts on selected machine, stays separate from unit standing grants, and never authorizes performing a git operation without its explicit instruction. Revoke unit grants uses existing owner tombstones; Revoke agent permission prevents future affected operations/sessions and preserves unrelated configuration/permissions.
- Tests: explicit optional grant=false, scoped permitted launched session vs manual/foreign session, revocation blocks next request, owner remote tombstones, no global approval pattern, phone approve-always/push rejects before receipt; ordinary build, session.open and one-time commit approve/deny work, display spoof does not change desktopOnly, ambiguous normalization reports unsupported capability.
- Proof: `node --test test/service-settings.test.mjs test/service-approvals.test.mjs test/service-auth.test.mjs test/service-sessions.test.mjs`; zero failures; no standing/push permission can be created by phone.
- Depends on: T022, T052. Commit message: `Scope permissions to units machines and owned sessions`.

#### T054. Maintain project registration and shared Content without touching repository bytes

- Screens: 6.6, 6.7, 6.8. Decisions: 13, 16. Kind: JUDGMENT.
- Files: `engine/service/settings.mjs`, project/content operations; `engine/discovery.mjs`, `discoverProjects`, `discoverContent`, preference discovery; `engine/setup.mjs`, defaults reuse boundary; `engine/install.mjs`, managed content plan; `engine/records.mjs`, registration/preferences serialization; `engine/service/projection.mjs`, excluded project units/editors; `engine/service/http.mjs`, project/content routes; `test/service-settings.test.mjs`, `test/setup-projects.test.mjs`, `test/setup-knowledge.test.mjs`, `test/install-ownership.test.mjs`, `test/gui-fixture.mjs`.
- Change: decide registration exclusions and content preview/apply reuse so remove/readd is visibility, never disk deletion. Implement C09 root folders/optional environments/bounded auto-discovery, explicit remove repository confirmation and ten-second Undo. Removing hides that project's units/boards/texts for the selected machine while preserving tasks/files/other machines; readding restores them. Content includes feature categories planning/quality/continuity plus fallback other, knowledge packs and preferences addressStyle/additionalInstructions/keepExistingPreferencesFirst/updateChecks. Defaults/detected data are actual, not fixed sample rows. Any client configuration writes still use T052's preview/apply; preserve person/foreign preferences and managed ownership.
- Tests: register/discover/remove/readd/Undo, repo bytes hashes unchanged, offline machine read-only, exclusion persists rescans, environment retained, knowledge future modules/fallback category, shared content preference sync, existing preferences precedence, preview denial no client changes.
- Proof: `node --test test/service-settings.test.mjs test/setup-projects.test.mjs test/setup-knowledge.test.mjs test/install-ownership.test.mjs`; zero failures and repository byte hashes do not change on unregister/Undo.
- Depends on: T028, T051, T052, T053. Commit message: `Manage project visibility and shared Content from Settings`.

#### T055. Render five Settings tabs, machine selection and reviewed client changes

- Screens: 6.1 to 6.9. Decisions: 7, 12, 13, 14, 16, 21, 22. Kind: JUDGMENT.
- Files: `gui/app/settings.mjs`, `renderSettings`, General/Agents/Permissions/Projects/Content/review views; `gui/app/main.mjs`, `settingsSurface`, selected machine/load/mutation/toast; `gui/app/i18n.mjs`, Settings strings; `gui/app/styles.css`, settings sections/rows/tabs; `test/gui-shell.test.mjs`, `test/gui-fixture.mjs`, `test/gui-data.mjs`.
- Change: decide keyboard tabs, selected machine state and focus restoration from nested review/confirmation dialogs. General order and columns are the verification list below. Mount T050's six previews, with miniature three-panel content in each own palette. Remove visible origin/sync choice and replace it with disabled Relay+ Coming soon. Phone-open state shows expiry/phone count/Close access and actual QR dialog. Agents has CLI first and optional named app, detected versions, Auto/On demand, Review changes, Scan again, Find manually; mode/app actions open review rather than mutating directly. Review shows exact selected changes, scoped optional unchecked git permission, kept copy/Disconnect/restart note, Cancel/Copy changes/Apply count. Permissions lists standing unit grants and agent permissions with named Revoke. Projects displays actual roots/environment/repos, Add folder/removal confirmation/Undo. Content uses actual features/knowledge/preferences. Offline machine shows latest report read-only and clear cause. Keep existing QR verification/12hour expiry, never print or store opening secrets.
- Visual: Settings body 818, padding 8x120, gap 16; title 22/700; tab bar padding 4, gap 4, radius 12, panel, line; five tab cells 7x14, gap 7, radius 9, selected card2/text 13.5/600; machine picker padding 8x12, radius 12; menu 320, padding 6, gap 2, radius 14, card2, line2 atx 1000, y112. Columns gap 16; sections padding 20, gap 12, radius 18, panel, line. Agent row 68, gap 14, padding 0x14, radius 14, card, avatar 34; identity width 200; app column 190; mode 196 wide. Review dialog 600, padding 24, gap 18, radius 22; change padding 10x12, gap 12, radius 12, card, tick 18. Content preferences 420 wide. QR dialog 600, QR scanner 220plusquietzone, columns gap 22; minimum QR rendering retains 225 CSSpx per existing encoder contract.
- Copy: `General` / `General`; `Agents` / `Agentes`; `Permissions` / `Permisos`; `Projects` / `Proyectos`; `Content` / `Contenido`; `Machine` / `Máquina`; `Command line (CLI): runs your units` / `Línea de comandos (CLI): ejecutar las unidades`; `Desktop app: optional` / `Aplicación de escritorio: opcional`; `Auto` / `Automático`; `On demand` / `Bajo demanda`; `Connected` / `Conectado`; `Review changes` / `Revisar cambios`; `Scan again` / `Volver a buscar`; `Find manually` / `Buscar manualmente`; `Not found on this machine` / `No se encontró en esta máquina`; `Optional permission` / `Permiso opcional`; `Copy changes` / `Copiar cambios`; `Apply {count} changes` / `Aplicar {count} cambios`; `Disconnect` / `Desconectar`; `Standing approvals` / `Aprobaciones permanentes`; `Agent permissions` / `Permisos de agentes`; `Revoke` / `Revocar`; `Project folders` / `Carpetas de proyectos`; `Add folder` / `Agregar carpeta`; `No environment` / `Sin entorno`; `Remove repository` / `Quitar repositorio`; `Features` / `Funciones`; `Knowledge packs` / `Paquetes de conocimiento`; `Preferences` / `Preferencias`; `Address style` / `Estilo de trato`; `Impersonal` / `Impersonal`; `Formal` / `Formal`; `Explanatory` / `Explicativo`; `Additional instructions` / `Instrucciones adicionales`; `Keep existing preferences first` / `Conservar primero las preferencias existentes`; `Check for updates` / `Buscar actualizaciones`; `Daily` / `Diariamente`; `Start with Windows` / `Iniciar con Windows`; `Restart service` / `Reiniciar el servicio`; `Locations` / `Ubicaciones`; `Staging` / `Staging`; `Close access` / `Cerrar el acceso`.
- Tests: five tabs/machine switch, offline read-only, own-palette previews/immediate apply, mode review before writing, copy/cancel no mutation, optional unchecked permission, Revoke exact grant, repo confirmation/Undo no disk change, Content actual data, phone access count/expiry/secret cleanup, duplicate request key/revision failures.
- Proof: `node --test test/gui-shell.test.mjs test/gui-fixture.test.mjs test/service-settings.test.mjs`; zero failures and GUI matches 6.1 to 6.9 in en/es.
- Depends on: T050, T053, T054. Commit message: `Present machine-aware Settings and configuration review`.

#### T056. Recover a stopped service through its verified launcher

- Screens: 6.10, 6.11, 6.12. Decisions: 7, 8, 20. Kind: JUDGMENT.
- Files: `gui/index.mjs`, host recovery handle/bridge; `gui/electron.mjs`, verified launcher ownership; `gui/preload.cjs`, existing isolated browse-folder bridge extended with the reviewed recovery boundary; `engine/service/client.mjs`, owned readiness; `engine/service/install.mjs`, restart/start implementation; `engine/service/service.mjs`, singleton restart lifetime; `engine/service/http.mjs`, service restart route; `gui/app/main.mjs`, `renderFailure`, service/reconnect banners and bridge handoff; `gui/app/stream.mjs`, reconnect budget/credential reset; `test/service-lifecycle.test.mjs`, `test/gui-shell.test.mjs`, `test/interfaces-cli.test.mjs`.
- Change: decide the same-user launcher recovery bridge supported by existing browser/embedded/Electron entry points. A stopped listener cannot receive its own HTTP restart. Implement C09 restart delegation while running and bridge-driven recovery while stopped, with fresh protected bootstrap/viewer token in memory. Retain drafts/uncertain operations and current resource; reauthenticate phones after service restart. Hosts without an available bridge provide concrete existing launcher instructions in Details; never show success on a request to a dead port. Reconnecting shows retained work and Retry now, stopped shows Details/Restart service, slow request includes cancel/30s terminalRetry. No second service under global lock.
- Visual: banner top 40, busy/errorfills, padding 10x12x10x14, gap 10, radius 14; spinner 15; content 13; footer 30, last read 12.5; no bright or white border. Copy: `Reconnecting to the service. What you do is kept and sent when it answers.` / `Reconectando con el servicio. Las acciones se conservan y se envían cuando responde.`; `Retry now` / `Reintentar ahora`; `The Relay service stopped on {machine}.` / `El servicio Relay se detuvo en {machine}.`; `Details` / `Detalles`; `Restart service` / `Reiniciar el servicio`.
- Tests: running restart/offline bridge, owned lock/no duplicate process, new viewer isolation, drafts survive/retry receipt, phone revocation, bridge absent actionable Details, error cause, no token in postMessage/storage/logs, stopped state not inferred from one slow response.
- Proof: `node --test test/service-lifecycle.test.mjs test/gui-shell.test.mjs test/interfaces-cli.test.mjs`; zero failures and confirmed runtime recovery uses one owned singleton.
- Depends on: T005, T024, T055. Commit message: `Recover stopped services without losing pending work`.

### P10. Phone

#### T057. Lock a peer after five wrong codes for ten minutes

- Screens: 7.2, 7.3. Decisions: 21. Kind: MECHANICAL.
- Files: `engine/service/home.mjs`, pairing constants, openHome grant/bucket, exchange; `engine/service/security.mjs`, PUBLIC_DETAIL_KEYS; `test/service-home-lock.test.mjs`, new.
- Change: add `const PAIRING_ATTEMPT_LIMIT = 5;` and `const PAIRING_LOCK_MS = 600000;` after LIFETIME_MS. Add `pairing: new Map(),` to the grant object. Immediately after `context.grant = grant;` in openHome set `context.bucket = { peers: new Map(), grantFailures: [] };`. Replace the entire exchange function with:

```js
export async function exchange(context, input, peer) {
  const grant = context.grant;
  const bucket = context.bucket ?? { peers: new Map(), grantFailures: [] };
  context.bucket = bucket;
  const now = context.now();
  const peerId = peer ?? 'unknown';
  if (!grant?.enabled || now >= Date.parse(grant?.expiresAt ?? 0)) {
    if (grant?.enabled) await closeHome(context, { reason: 'expired' });
    throw new CoreError(410, 'home_expired', 'Home access is not active.');
  }
  if (!interfacesMatch(context, grant)) {
    await closeHome(context, { reason: 'closed' });
    throw new CoreError(410, 'home_expired', 'Home access is not active.');
  }
  const presented = presentedSecret(input);
  grant.pairing ??= new Map();
  let attempts = grant.pairing.get(peerId) ?? { failures: 0, lockedUntil: null };
  if (attempts.lockedUntil && now < Date.parse(attempts.lockedUntil)) throw pairingLocked(attempts.lockedUntil);
  if (attempts.lockedUntil) attempts = { failures: 0, lockedUntil: null };
  grant.pairing.set(peerId, attempts);
  assertHomeWindow(bucket, peerId, now);
  const isCode = Object.hasOwn(input, 'code');
  const expected = isCode ? grant.code : grant.key;
  if (!safeEqual(expected, presented)) {
    checkLimits(bucket, { homeFailure: true, peer: peerId }, now);
    if (isCode) {
      attempts.failures += 1;
      if (attempts.failures >= PAIRING_ATTEMPT_LIMIT) {
        attempts.lockedUntil = new Date(now + PAIRING_LOCK_MS).toISOString();
        throw pairingLocked(attempts.lockedUntil);
      }
      throw new CoreError(401, 'invalid_home_key', 'The home code does not match.', { triesLeft: PAIRING_ATTEMPT_LIMIT - attempts.failures });
    }
    throw new CoreError(401, 'invalid_home_key', 'The home key is not valid.');
  }
  attempts.failures = 0;
  const issued = context.credentials.issue({ audience: 'phone', expiresAt: grant.expiresAt });
  grant.tokens.add(issued.token);
  return { token: issued.token, audience: 'phone', expiresAt: grant.expiresAt, capabilities: issued.capabilities };
}

function pairingLocked(lockedUntil) {
  return new CoreError(429, 'pairing_locked', 'Pairing is locked for 10 minutes.', { triesLeft: 0, lockedUntil }, lockedUntil);
}
```

Append `triesLeft` and `lockedUntil` to PUBLIC_DETAIL_KEYS; add no credential-value keys. A lock applies to that peer/current grant for both manual-code and QR exchanges. Global grant abuse throttling remains independent. New desktop grant resets lock/counters.

- Tests: create the complete file:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeHome, exchange, openHome } from '../engine/service/home.mjs';
import { createCredentialStore, safeError } from '../engine/service/security.mjs';

function context() {
  const clock = { now: Date.parse('2026-10-13T12:00:00.000Z') };
  return { clock, now: () => clock.now, credentials: createCredentialStore({ now: () => clock.now }),
    interfaces: () => [{ name: 'Ethernet', address: '192.168.1.20', netmask: '255.255.255.0', internal: false }],
    listen: async (address) => ({ address: address.address, netmask: address.netmask, port: 43123, close: async () => {} }),
    bus: { emit() {} } };
}
async function lock(home) {
  for (let attempt = 1; attempt < 5; attempt += 1) {
    await assert.rejects(exchange(home, { code: '000000' }, '192.168.1.40'), (error) => {
      assert.equal(error.details.triesLeft, 5 - attempt);
      assert.equal(safeError(error, 'fixture').error.details.triesLeft, 5 - attempt);
      return error.status === 401;
    });
  }
  await assert.rejects(exchange(home, { code: '000000' }, '192.168.1.40'), (error) => error.code === 'pairing_locked'
    && error.status === 429 && error.details.triesLeft === 0 && Date.parse(error.retryAt) === home.clock.now + 600000);
}
test('five wrong codes lock that peer until the exact ten-minute boundary', async (t) => {
  const home = context();
  t.after(() => closeHome(home, { quiet: true }));
  const grant = await openHome(home);
  await lock(home);
  await assert.rejects(exchange(home, { code: grant.shortCode }, '192.168.1.40'), { code: 'pairing_locked' });
  await assert.rejects(exchange(home, { key: grant.key }, '192.168.1.40'), { code: 'pairing_locked' });
  assert.equal((await exchange(home, { code: grant.shortCode }, '192.168.1.41')).audience, 'phone');
  home.clock.now += 599999;
  await assert.rejects(exchange(home, { code: grant.shortCode }, '192.168.1.40'), { code: 'pairing_locked' });
  home.clock.now += 1;
  assert.equal((await exchange(home, { code: grant.shortCode }, '192.168.1.40')).audience, 'phone');
});
test('a replacement desktop grant clears locks and rejects the old grant', async (t) => {
  const home = context();
  t.after(() => closeHome(home, { quiet: true }));
  const old = await openHome(home);
  await lock(home);
  const next = await openHome(home);
  assert.equal((await exchange(home, { code: next.shortCode }, '192.168.1.40')).audience, 'phone');
  await assert.rejects(exchange(home, { key: old.key }, '192.168.1.40'), { code: 'invalid_home_key' });
});
test('code failures remain counted beyond a rolling minute before five attempts', async (t) => {
  const home = context();
  t.after(() => closeHome(home, { quiet: true }));
  await openHome(home);
  await assert.rejects(exchange(home, { code: '000000' }, '192.168.1.40'), (error) => error.details.triesLeft === 4);
  home.clock.now += 60001;
  await assert.rejects(exchange(home, { code: '000000' }, '192.168.1.40'), (error) => error.details.triesLeft === 3);
});
```

- Proof: `node --test test/service-home-lock.test.mjs test/service-auth.test.mjs`; zero failures and no real LAN listener, since listen is injected.
- Depends on: T001. Commit message: `Lock repeated wrong-code pairing for ten minutes`.

#### T058. Reject standing phone approvals before receipts and hide the control

- Screens: 7.5, 7.6. Decisions: 21. Kind: MECHANICAL.
- Files: `engine/service/approvals.mjs`, answerApproval; `engine/service/http.mjs`, objectFor; `gui/app/inspector.mjs`, renderApproval; `gui/app/main.mjs`, its two renderApproval callers; `test/service-phone-approval.test.mjs`, new.
- Change: immediately after assertMaster in answerApproval, add:

```js
  if (context.principal?.audience === 'phone' && input?.decision === 'approve-always') {
    throw new CoreError(403, 'phone_read_only', 'Standing approvals are answered on the computer.');
  }
```

In HTTP objectFor, before its agentScope dispatch, add:

```js
  if (credential?.audience === 'phone' && route.handler === 'answerApproval' && body?.decision === 'approve-always') {
    throw new CoreError(403, 'phone_read_only', 'Standing approvals are answered on the computer.');
  }
```

Replace the renderApproval signature with `export function renderApproval(document, approval, t, onAnswer, busy = false, allowAlways = true) {`. Replace its standing-control condition with `if (allowAlways && approval.alwaysAllowed !== false)`. Add `app.store.audience !== 'phone'` as sixth argument in both renderApproval calls, in renderWaitingRecord and renderInspector. Use credential audience, not width/layout.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { answerApproval } from '../engine/service/approvals.mjs';

test('a phone cannot create a standing approval before any persistence access', async () => {
  await assert.rejects(answerApproval({ principal: { unitId: 'root:master', audience: 'phone' } },
    '11111111-1111-4111-8111-111111111111', { decision: 'approve-always', expectedRevision: '0'.repeat(64) }),
  (error) => error.status === 403 && error.code === 'phone_read_only');
});
```

T059 adds real HTTP receipt/DOM tests, including widened phone/narrow desktop authority. This direct-core test deliberately has no store, proving rejection occurs before persistence.

- Proof: `node --test test/service-phone-approval.test.mjs`; one passed test, zero failures. Existing tests expecting phone approve-always are replaced by T059's denied cases; they are not silently skipped.
- Depends on: T053. Commit message: `Reserve standing approvals for the computer`.

#### T059. Render pairing, locked access and the restricted phone surface

- Screens: 7.1 to 7.7, 6.1, 6.9. Decisions: 21, 22. Kind: JUDGMENT.
- Files: `gui/app/phone.mjs`, `renderCodeEntry`, exchange; `gui/app/main.mjs`, `renderSignedOut`, `renderPhoneError`, `submitCode`, phone hierarchy/chat/waiting/expired views; `gui/app/inspector.mjs`, desktopOnly readable cards; `gui/app/i18n.mjs`, phone strings; `gui/app/styles.css`, code cells/phone states; `test/gui-fixture.mjs`, C10 authority/lock behavior; `test/gui-shell.test.mjs`, `test/service-auth.test.mjs`, `test/service-home-stream.test.mjs`, `test/service-api.test.mjs`.
- Change: decide one accessible six-character input with six visible cells and server-derived error/lock state. Pairing never stores/echoes codes or credentials. First four failures show triesLeft from details; fifth shows Pairing locked until server lockedUntil, no submit; replacement grant unlocks immediately. Phone chats use existing conversations only. Ordinary asks show Approve/Deny; standing approval options and push asks have only the readable computer-required guidance; session.open retains ordinary Approve/Deny. Reviews show Accept/Send back with required note and server reviewability; no Undo or editing controls. Twelve-hour expiry/desktop close/restart clears credentials/data and shows Type a new code. Preserve existing exact LAN network/audience checks and independent actual QR encoder.
- Visual: 390x844, phone 28radius; status 44, title 52, bottom navigation 64; pair content padding 60x24x24, gap 18, mark 56, title 22/700, body 14center; cells 40x50, gap 8, radius 12, card, accent filled/line2 empty, error on failure; locked/closed padding 120x28x24, gap 16, circle 64/icon 28. Hierarchy padding 6x10, rows 11x10, indent 24/42; chat padding 14, gap 12. All targets 32 minimum, phone targets 44where existing.
- Copy: `Open your M1ND` / `Abrir el M1ND`; `Type the code shown on your computer, in Settings, Open on the phone.` / `Introducir el código que aparece en el equipo, en Configuración, Abrir en el teléfono.`; `Or scan the QR code with the camera.` / `También se puede escanear el código QR con la cámara.`; `Opening` / `Abriendo`; `That code does not match.` / `El código no coincide.`; `Check it on the computer and try again; {count} tries left.` / `Comprobar el código en el equipo y reintentar; quedan {count} intentos.`; `Try again` / `Reintentar`; `Pairing locked` / `Vinculación bloqueada`; `Five codes did not match. Pairing stays locked for 10 minutes; a new code from the computer unlocks it at once.` / `Cinco códigos no coincidieron. La vinculación permanece bloqueada durante 10 minutos; un código nuevo desde el equipo la desbloquea de inmediato.`; `Standing approvals and pushes are answered on the computer.` / `Las aprobaciones permanentes y los pushes se responden en el equipo.`; `Access ended` / `Acceso finalizado`; `Phone access lasts 12 hours. Open it again from the computer: Settings, Open on the phone.` / `El acceso desde el teléfono dura 12 horas. Abrirlo de nuevo desde el equipo: Configuración, Abrir en el teléfono.`; `Type a new code` / `Introducir un código nuevo`.
- Tests: six cells/accessibility, paste/backspace/normalization, no storage, servercounts 4to 1, exact 10min/replacement unlock, no reply credentials in an error, widenedphone/narrowdesktop, HTTP standing/push rejection before receipt and allowed one-time session.open answers, no existing conversation creation, review note/lead gating, 12hour/close/restart revocation, actual QR decoding/Settings phone count. Replace old phone-standing-approval expected successes explicitly.
- Proof: `node --test test/gui-shell.test.mjs test/service-auth.test.mjs test/service-home-stream.test.mjs test/service-api.test.mjs`; zero failures and every 7.x state observed at 390 by 844.
- Depends on: T055, T057, T058. Commit message: `Complete restricted phone pairing and approval states`.

### P11. Accessibility across rows

#### T060. Distinguish working, waiting and idle by shape

- Screens: all 83. Decisions: 22. Kind: MECHANICAL.
- Files: `gui/app/styles.css`, status-dot and map-status; `test/final-status-shapes.test.mjs`, new.
- Change: replace the complete status-dot declarations with:

```css
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: transparent; box-shadow: inset 0 0 0 1.5px var(--idle); flex: none; }
.status-dot[data-status="working"] { background: var(--working); box-shadow: none; }
.status-dot[data-status="waiting"] { background: transparent; box-shadow: inset 0 0 0 2px var(--waiting); }
```

Replace map-status declarations through its idle rule, retaining later out/quota rules:

```css
.map-status { position: absolute; right: 1px; bottom: 1px; width: 11px; height: 11px; border-radius: var(--radius-circle); border: 2px solid var(--bg); background: transparent; box-shadow: inset 0 0 0 1.5px var(--idle); box-sizing: content-box; }
.map-status[data-status="working"] { background: var(--working); box-shadow: none; }
.map-status[data-status="waiting"] { background: transparent; box-shadow: inset 0 0 0 2px var(--waiting); }
.map-status[data-status="idle"] { background: transparent; box-shadow: inset 0 0 0 1.5px var(--idle); }
```

- Tests: create:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('status shapes remain distinguishable without their colors', async () => {
  const css = await readFile(new URL('../gui/app/styles.css', import.meta.url), 'utf8');
  const block = (selector) => css.slice(css.indexOf(selector)).split('}')[0];
  assert.ok(block('.status-dot {').includes('1.5px'));
  assert.ok(block('.status-dot[data-status="waiting"]').includes('2px'));
  assert.ok(block('.status-dot[data-status="working"]').includes('box-shadow: none'));
  assert.ok(block('.map-status[data-status="idle"]').includes('1.5px'));
  assert.ok(block('.map-status[data-status="working"]').includes('box-shadow: none'));
});
```

- Proof: `node --test test/final-status-shapes.test.mjs test/gui-map.test.mjs`; zero failures. T062 verifies actual rendered shapes at normal/zoomed sizes.
- Depends on: T059. Commit message: `Distinguish status through fill and ring thickness`.

#### T061. Give icon controls names and minimum hit targets

- Screens: all 83. Decisions: 22. Kind: MECHANICAL.
- Files: `gui/app/components.mjs`, new namedIconButton; `gui/app/styles.css`, minimum targets; `test/final-named-control.test.mjs`, new. Every new icon-only control in T016/T029/T035/T045/T055/T059 uses this helper or its same literal attribute contract.
- Change: append:

```js
export function namedIconButton(document, glyph, label, onClick) {
  if (typeof label !== 'string' || !label.trim()) throw new TypeError('An icon button needs an accessible name.');
  return element(document, 'button', { type: 'button', class: 'icon-button', 'aria-label': label,
    title: label, onclick: onClick }, icon(document, glyph));
}
```

Append CSS:

```css
button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]) { min-inline-size: 32px; min-block-size: 32px; }
.checkbox-target, .radio-target { display: inline-flex; align-items: center; min-inline-size: 32px; min-block-size: 32px; gap: 7px; }
.board-resize-hit { inline-size: 32px; block-size: 32px; padding: 0; border: 0; background: transparent; display: grid; place-items: center; }
.board-resize-dot { inline-size: 9px; block-size: 9px; border-radius: 2px; background: var(--panel); border: 2px solid var(--accent); }
```

Resize gesture controls use board-resize-hit wrapping board-resize-dot, with names `Resize top left`, `Resize top right`, `Resize bottom left`, `Resize bottom right` and Spanish `Cambiar el tamaño desde arriba a la izquierda`, `Cambiar el tamaño desde arriba a la derecha`, `Cambiar el tamaño desde abajo a la izquierda`, `Cambiar el tamaño desde abajo a la derecha`. Do not expand the visible 9pixelhandle to 32.

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { namedIconButton } from '../gui/app/components.mjs';

function documentStub() {
  const node = (tag) => ({ tag, attributes: new Map(), children: [],
    setAttribute(key, value) { this.attributes.set(key, value); },
    addEventListener() {}, append(...items) { this.children.push(...items); } });
  return { createElement: node, createElementNS: (_namespace, tag) => node(tag) };
}
test('icon buttons require an accessible name and retain a hidden decorative icon', () => {
  const document = documentStub();
  assert.throws(() => namedIconButton(document, 'settings', '', () => {}), TypeError);
  const button = namedIconButton(document, 'settings', 'Settings', () => {});
  assert.equal(button.attributes.get('aria-label'), 'Settings');
  assert.equal(button.children[0].attributes.get('aria-hidden'), 'true');
});
```

- Proof: `node --test test/final-named-control.test.mjs test/gui-shell.test.mjs`; zero failures; actual target sizes/names are checked across all states by T062/T064.
- Depends on: T060. Commit message: `Name icon controls and enforce minimum hit targets`.

#### T062. Measure six-theme contrast, keyboard flow and target geometry

- Screens: all 83. Decisions: 14, 22. Kind: JUDGMENT.
- Files: `gui/app/styles.css`, font declarations and measured role/fill corrections; `gui/styles.css`, setup font declarations; `gui/app/atkinson-400.woff2`, `gui/app/atkinson-400-italic.woff2`, `gui/app/atkinson-700.woff2`, `gui/app/atkinson-700-italic.woff2`, new byte-identical copies of the corresponding files in `docs/flows/assets/`; `engine/service/http.mjs`, `BROWSER_STATIC_FILES` and `contentType`; `gui/server.mjs`, font entries in `STATIC_FILES`; `scripts/build-installer.mjs`, packaged asset checks; `gui/app/components.mjs`, focus/naming corrections; `gui/app/main.mjs`, tab/dialog focus restoration; `gui/app/settings.mjs`, `gui/app/phone.mjs`, final control focus; `test/gui-shell.test.mjs`, accessibility state checks; `test/service-api.test.mjs`, font MIME/allowlist cases; `test/interfaces-server.test.mjs`, wizard font serving; `test/service-install.test.mjs`, font packaging; `test/gui-browser.md`, actual measurements/capture paths.
- Change: decide the smallest palette/fill corrections needed for every muted-text/background pair to meet 4.5: 1 and every interactive target 32 px. Measure alpha-composited colors and actual states in all six looks, including disabled hints, card2, Toxic sections, Focus hints and own-palette previews. Use quiet theme line hues/fills; never solve container contrast with bright/white borders. Preserve pure-black Focus and QR scanner colors. Observe keyboard order, one heading/skip link, Enter/Escape, dialogs, focus restoration, 32hittargets/9visiblehandles, 200%zoom, reduced motion and status shape distinctions. Correct muted colors only from measured evidence, not a color-name guess.
  Use the board's Atkinson Hyperlegible face from the four existing local font files. Add four `@font-face` rules named `Atkinson Hyperlegible`, with normal/italic styles and weights 400/700, `font-display: swap`, and the respective relative WOFF 2 URLs. Set `--font` to `"Atkinson Hyperlegible", system-ui, sans-serif` and use that face in setup. Permit only the four exact font basenames through app static serving, with `font/woff2`; wizard routes `/atkinson-400.woff2`, `/atkinson-400-italic.woff2`, `/atkinson-700.woff2`, `/atkinson-700-italic.woff2` map to those files under `gui/app/`. Verify actual package inclusion and both hosts' serving. No installer or font download is required.
- Tests: contrast matrix with exact foreground/background/composite ratio and selector/state; icon controls named; keyboard order/focus restoration; phone cells; target bounding rectangles; no clipped final item at zoom; grayscale/status shape; screen reader live announcements are neither silent nor repeated.
- Proof: `node --test test/gui-shell.test.mjs test/service-api.test.mjs test/interfaces-server.test.mjs test/service-install.test.mjs`; zero failures, packaged fonts served as `font/woff2`, plus every measured pair at least 4.5: 1 and target at least 32 pixels recorded in `test/gui-browser.md`. Node tests alone do not satisfy this browser gate.
- Depends on: T061. Commit message: `Meet contrast target and keyboard requirements in every look`.

### P13. Add to M1ND

Execute T065 to T072 in the order below after T062 and before T063. Retain these task numbers despite their position before the final gates. P13 extends C09 and T054; it does not replace the Settings reports, existing content preferences or repository visibility rules. The earlier tasks remain unchanged. No final gate begins with an unfinished P13 task.

The board's tool-server row is recognized but disabled in 3.0. Python used by a selected skill is a runtime requirement, not authorization to install Python or start a tool server. Source acquisition writes protected local staging; copying into the M1ND and registering a project occur only after the check and explicit confirmation. The code blocks below are future implementation instructions, not code installed by this documentation change.

#### T065. Define the Add to M1ND contract

- Screens: 2.19 to 2.22, 6.8 and the shared desktop bar in Map, Blueprint, Void and Settings. Decisions: 23. Kind: MECHANICAL.
- Files: `docs/3.0/contract.md`, section `### 2.7. Layout and settings`, addition C12 immediately below the heading. Existing C01 to C11 remain intact.
- Change: insert the following exact normative text. C12 extends the Content and project reports in C09 and governs the new operations, fields and ownership rules.

```text
Final integration amendment C12: Add to M1ND.

Add to M1ND accepts skills, repositories and docs. Tool servers are recognition-only candidates with supported:false and blockedReason:"after_3_0"; selection, placement and updates of tool servers return 422 unsupported_addition. No acquisition, inspection or placement runs package install scripts, Git hooks, imported scripts, npm, Python or a tool server. A skill's declared runtime requirements are shown as a caution and apply only to its selected units. Source checks are evidence about the accepted bytes, not a claim that imported instructions are trusted.

Source is {kind:"link"|"git"|"registry",url:string} or {kind:"folder",uploadId:UUID}. The GUI submits kind:"link"; the owner resolves its Git or registry identity before inspection. Explicit git/registry kinds bind a previously identified source, not a visible source-type selector. Links are public HTTPS URLs without user information, credential-bearing query strings or fragments. Private-network destinations and redirect targets are refused. A folder is uploaded as bounded file chunks, never as an arbitrary server filesystem path. Source resolution, extraction and all redirects have a 30000 ms deadline. Acquisition is bounded to 1024 regular files, 16 MiB per file, 64 MiB total decoded bytes, path depth 40, and 3 redirects. Symlinks, junctions, hard links, device files, absolute paths, traversal, Windows device names, alternate streams and case-insensitive duplicate paths are refused. Uploaded chunks contain at most 65536 decoded bytes. Credentials, environment/key files and source contents never appear in previews, events, diagnostics or receipts.

Pin is {kind:"commit"|"version"|"snapshot",value:string,digest:Hash}. A commit is its full immutable Git object ID, a registry version is its exact version plus verified archive digest, and a folder is its complete staged manifest digest. Branch names, tags and latest are resolved before review; they are never an accepted pin. publishedAt:Time|null comes from the pinned commit/release evidence, never a download time or file mtime. A folder without verifiable commit/release evidence has unknown age. Check is {pin:{ok:boolean,kind:string,value:string},license:{ok:boolean,value:string|null},age:{ok:boolean,days:integer|null,publishedAt:Time|null},scripts:{ok:boolean,noInstallScripts:boolean},runtime:{ok:boolean,verified:boolean,requirements:string[]},eligible:boolean}. Seven complete days, a verified pin, a reported license, supported kind, verified runtime evidence and verified no-install-script execution are required. Unknown dates, future dates, missing licenses, unknown runtime evidence and younger sources fail the check without an override. Declared installation scripts may exist but are never run. Runtime requirements never authorize an installation or broader client permission.

Candidate is {id:UUID,kind:"skill"|"repository"|"docs"|"tool-server",name:Name,title:string,description:string,path:string,supported:boolean,blockedReason:null|"after_3_0",requirements:string[],check:Check}. Every SKILL.md directory, standalone docs/documentation/knowledge tree, repository root and detected tool manifest is a separate candidate; nested skill support docs remain part of their skill. Raw manifest/script content is not returned. Candidate selection is separate from recognition. Scope is {everyUnit:boolean,units:UnitId[],groups:UUID[]}. Every unit is exclusive with explicit units/groups. Selected group members and direct units are deduplicated; removed units, root master and deleted groups are excluded. Empty or stale scope is refused. Group membership is resolved from current canonical records at each use; acceptance binds the reviewed group/unit revisions and rejects intervening changes.

Addition is {id:UUID,kind:"skill"|"repository"|"docs",name:Name,title:string,source:{kind:"git"|"registry"|"folder",display:string,url:string|null},sourcePath:string,pin:Pin,license:string,publishedAt:Time,requirements:string[],scope:Scope,unitCount:integer,machine:Name,projectId:Name|null,installedAt:Time,updatedAt:Time,revision:Revision,removed:boolean}. Shared records are P/additions/<id>.json. Accepted skill bytes are P/features/<name>/; accepted docs bytes are P/knowledge/<name>/. Kit files and preexisting private names are never replaced by Add. Candidate names collide case-insensitively. Scope/provenance and accepted content sync together; staged source bytes, uploads, previews, absolute checkout paths and kept copies stay in protected L/additions/. No credential or transport endpoint is synced. Repository paths are registered through the selected machine's C09 project operation and recorded in its existing machine mapping. Uploaded and downloaded repositories are published to an owned local checkout with a recovery record before registration. A dropped source remains unchanged; its absolute location is not inferred from uploaded data. Removing, unregistering or undoing a repository never deletes its checkout/source files.

POST /additions/uploads accepts {machine:Name,name:string} and returns 201 {uploadId:UUID,expiresAt:Time}. PUT /additions/uploads/:uploadId/chunks accepts {path:string,index:integer,total:integer,base64:string}, with index starting at 0 and total fixed per file, and returns 200 {uploadId:UUID,path:string,index:integer}. Exact replay is harmless; conflicting chunks fail. DELETE /additions/uploads/:uploadId accepts {} and returns 204, canceling unaccepted local staging only. No uploaded file enters the M1ND before acceptance.

POST /additions/previews accepts {machine:Name,source:Source,updateOf:UUID|null} and returns 202 Preview. GET /additions/previews/:previewId returns 200 Preview. DELETE /additions/previews/:previewId accepts {} and returns 204. Preview is {id:UUID,machine:Name,state:"inspecting"|"ready"|"failed"|"accepted",sourceDisplay:string,pin:Pin|null,candidates:Candidate[],choices:{units:[{id:UnitId,title:string}],groups:[{id:UUID,title:string,members:UnitId[]}]},scopeRevision:Revision|null,contentRevision:Revision|null,projectRevision:Revision|null,expiresAt:Time,error:null|{code:string,message:string},result:Acceptance|null}. Acceptance is the POST /additions result defined below. Choice labels and IDs come from the same canonical unit/group revision snapshot held privately by the owner and rechecked on acceptance. A review is owner/principal-bound, expires after 15 minutes, and binds acquired hashes, checks, target revisions and reviewed scope revisions. After acceptance, its consumed binding and result survive through the existing 24-hour receipt retention; staging can be disposed without deleting owner/request/hash proof. GET returns accepted/result during that retention. Cancellation cannot erase the accepted binding or undo a committed operation. Returning Back, cancellation and failed inspection do not mutate the M1ND, client configuration or repository registration.

POST /additions/previews/:previewId/retry accepts {} and returns 202 Preview. It retries a failed inspection under the same owner-bound preview ID and immutable resolved pin, with a new per-attempt operation identity retained through response loss. If no pin was resolved, resolve the original source again and require a new displayed check before acceptance. A resolved pin cannot silently change on Retry. Replayed initial POST only reconciles its initial response; it does not restart a failed inspection. An inspecting or accepted preview is returned without starting another acquisition. An expired unaccepted review returns 409 preview_expired. Lost acceptance responses use the accepted preview result or exact original acceptance receipt, never a second placement.

POST /additions accepts {machine:Name,previewId:UUID,selections:[{candidateId:UUID,scope:Scope}],expectedContentRevision:Revision|null,expectedProjectRevision:Revision|null,confirmed:true} and returns 201 {items:Addition[],changeId:UUID,undoUntil:Time,contentRevision:Revision|null,projectRevision:Revision|null}. At least one supported, eligible candidate and one allowed unit are required. A mixed selection commits as one recoverable acceptance, with exact receipt replay and no partial visible registration. A consumed preview cannot create another addition. A changed staged hash, scope or destination returns 409 and leaves the accepted state unchanged. Updates use POST /additions/previews with updateOf bound to the existing addition and the same source identity; they show the same check and require the same explicit acceptance. The old pin remains active until replacement commits. No background update changes accepted bytes.

GET /additions accepts machine?:Name and returns 200 {machine:Name,readOnly:boolean,items:Addition[]}. DELETE /additions/:additionId accepts {machine:Name,confirmed:true,expectedRevision:Revision} and returns 200 {additionId:UUID,changeId:UUID,undoUntil:Time,revision:Revision}. Remove revokes future scoped availability, archives owned imported content and provenance, preserves foreign edits and kit content, and uses the existing 10-second POST /changes/:changeId/undo. Undo checks post-change revisions. Scope controls service-owned session availability, including verified manually registered app sessions; it is not a global skill installation. Unknown client scope support fails closed. No Add operation changes client configuration without the existing C09 concrete preview/apply review.

C09 Content feature/knowledge items add additionId:UUID|null, origin:string|null, pin:Pin|null, scope:Scope|null, unitCount:integer, removable:boolean and revision:Revision|null; kit items use null provenance and removable:false. Existing included/category/preferences fields remain. C09 project repository items add additionId:UUID|null, origin:string|null and pin:Pin|null, preserving machine-local path authority. A registered project with zero units appears in GET /projects and GET /view, Hierarchy and the Map without fabricating a unit or Overlord. Its inspector shows origin, accepted pin, No units yet and New unit in <project>; no lead is created automatically.

All Add routes are authenticated desktop-only and reuse settings.write, including inspection and uploads. Phone and agent calls are rejected with 403 forbidden before receipt lookup, source reads or staging writes. Selected offline machines return 409 machine_unavailable; no local fallback is permitted. Unknown fields are rejected. Errors are 404 addition_not_found or preview_not_found; 409 preview_expired, preview_changed, scope_changed, source_changed, destination_changed, name_conflict or revision_conflict; 413 addition_too_large; 422 invalid_source, invalid_path, invalid_scope, check_failed or unsupported_addition; 503 source_unavailable, source_timeout, runtime_unavailable or scope_unavailable. A failed bounded source request exposes a safe cause and Retry, never source command output. additions.changed emits {additionId:UUID,operation:"add"|"update"|"remove"|"undo",revision:Revision}; it contains no preview or source bytes. Publication also emits the existing settings.content.changed or machine.settings.changed for the changed report, after durable acceptance.
```

Run this complete insertion program through `node --input-type=module` after creating no other files:

```js
import { readFile, writeFile } from 'node:fs/promises';
const plan = (await readFile('docs/3.0/integration.md', 'utf8')).replaceAll('\r\n', '\n');
const task = plan.split('#### T065. Define the Add to M1ND contract\n')[1]?.split('\n#### T066.')[0];
const block = task?.match(/```text\n([\s\S]*?)\n```/)?.[1];
if (!block?.startsWith('Final integration amendment C12:')) throw new Error('Missing literal C12 block.');
let contract = (await readFile('docs/3.0/contract.md', 'utf8')).replaceAll('\r\n', '\n');
if (contract.includes('Final integration amendment C12:')) throw new Error('C12 is already present.');
const anchor = '### 2.7. Layout and settings\n';
if (contract.split(anchor).length !== 2) throw new Error('Unexpected contract section 2.7.');
contract = contract.replace(anchor, anchor + '\n' + block + '\n');
await writeFile('docs/3.0/contract.md', contract, 'utf8');
console.log('Inserted Add to M1ND amendment C12.');
```

- Tests: no runtime test is added for a documentation-only task. The contract lint and the explicit insertion guard validate this change.
- Proof: the program prints `Inserted Add to M1ND amendment C12.`; `npm.cmd run lint` exits 0 with zero issues; the diff contains one C12 and unchanged C01 to C11.
- Depends on: T001, T054, T062. Commit message: `Define the Add to M1ND contract`.

#### T066. Recognize separate parts in a bounded source manifest

- Screens: 2.19, 2.20. Decisions: 23. Kind: MECHANICAL.
- Files: new `engine/service/addition-parts.mjs`, all code below; new `test/service-addition-parts.test.mjs`, all tests below. No source I/O or renderer is changed.
- Change: create the module exactly. Its input is the staged regular-file inventory from T068, not a filesystem path. Recognize each part independently, retain tool candidates as unsupported, and return runtime names without command text. Docs under a skill remain support files. A repository can be offered beside its contained skills/docs.

```js
import path from 'node:path';
import { parseFrontmatter } from '../records.mjs';
import { CoreError, uuidV8, validateName } from './identity.mjs';

export function additionPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\x00-\x1f\x7f:]/.test(value)) {
    throw new CoreError(422, 'invalid_path', 'The source path is not a regular relative path.');
  }
  const parts = value.split('/');
  if (parts.length > 40 || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new CoreError(422, 'invalid_path', 'The source path is not a regular relative path.');
  }
  return value;
}

function scalar(value, fallback, limit) {
  let result = String(value ?? fallback).trim();
  if (/^(['"])[\s\S]*\1$/.test(result)) result = result.slice(1, -1);
  if (!result || result.length > limit || /[\x00-\x1f\x7f]/.test(result)) {
    throw new CoreError(422, 'invalid_source', 'A source name or description is invalid.');
  }
  return result;
}

function packageData(file) {
  try {
    const value = JSON.parse(file.text);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.name != null && typeof value.name !== 'string'
      || value.description != null && typeof value.description !== 'string') throw new Error('Invalid manifest');
    return value;
  }
  catch { throw new CoreError(422, 'invalid_source', 'A package manifest is invalid.'); }
}

export function recognizeAdditionParts(entries, { repository = false, name = 'repository' } = {}) {
  if (!Array.isArray(entries) || entries.length > 1024) throw new CoreError(413, 'addition_too_large', 'The source has too many files.');
  const seen = new Set();
  let total = 0;
  const files = entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new CoreError(422, 'invalid_source', 'The source inventory is invalid.');
    const relative = additionPath(entry.path);
    if (entry.kind !== 'file' || !Number.isInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 16777216
      || entry.text !== null && typeof entry.text !== 'string') throw new CoreError(422, 'invalid_source', 'The source inventory is invalid.');
    if (seen.has(relative.toLowerCase())) throw new CoreError(422, 'invalid_path', 'The source contains colliding paths.');
    seen.add(relative.toLowerCase());
    total += entry.bytes;
    if (total > 67108864) throw new CoreError(413, 'addition_too_large', 'The source is too large.');
    if (entry.text !== null && Buffer.byteLength(entry.text, 'utf8') !== entry.bytes) {
      throw new CoreError(422, 'invalid_source', 'The source inventory does not match its bytes.');
    }
    return { ...entry, path: relative };
  }).sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const result = [];
  const skillRoots = files.filter(file => path.posix.basename(file.path) === 'SKILL.md')
    .map(file => path.posix.dirname(file.path));
  const within = (file, root) => root === '.' || file.path.startsWith(root + '/');
  const requirements = root => {
    const names = new Set();
    for (const file of files.filter(item => within(item, root))) {
      if (/\.py$/i.test(file.path)) names.add('Python');
      if (/\.(?:js|mjs|cjs)$/i.test(file.path)) names.add('Node.js');
      if (/\.sh$/i.test(file.path)) names.add('Bash');
      if (/\.ps1$/i.test(file.path)) names.add('PowerShell');
      if (/\.(?:exe|dll|so|dylib)$/i.test(file.path)) names.add('Native executable');
    }
    return [...names].sort();
  };
  const add = (kind, root, title, description) => {
    const itemName = scalar(title, name, 128);
    validateName(itemName, { label: 'addition name' });
    result.push({ id: uuidV8({ kind, path: root, name: itemName }), kind, name: itemName, title: itemName,
      description: scalar(description, itemName, 1000), path: root, supported: kind !== 'tool-server',
      blockedReason: kind === 'tool-server' ? 'after_3_0' : null, requirements: requirements(root) });
  };
  for (const file of files.filter(item => path.posix.basename(item.path) === 'SKILL.md')) {
    if (file.text === null) throw new CoreError(422, 'invalid_source', 'SKILL.md must be UTF-8 text.');
    const attributes = parseFrontmatter(file.text).attributes;
    const root = path.posix.dirname(file.path);
    add('skill', root, attributes.name ?? (root === '.' ? name : path.posix.basename(root)), attributes.description);
  }
  const docs = new Set();
  for (const file of files) {
    if (skillRoots.some(root => within(file, root))) continue;
    const parts = file.path.split('/');
    const index = parts.findIndex(part => ['docs', 'documentation', 'knowledge'].includes(part.toLowerCase()));
    if (index >= 0 && /\.(?:md|txt|rst|html|pdf|docx)$/i.test(file.path)) docs.add(parts.slice(0, index + 1).join('/'));
  }
  for (const root of [...docs].sort()) add('docs', root, path.posix.basename(root), 'Documentation');
  for (const file of files) {
    const base = path.posix.basename(file.path);
    if (file.text === null || !['package.json', 'mcp.json', '.mcp.json', 'tool-manifest.json'].includes(base)) continue;
    const manifest = packageData(file);
    const tool = base !== 'package.json' || manifest.mcpServers != null || manifest.mcp != null;
    if (tool) {
      const root = path.posix.dirname(file.path);
      const title = String(manifest.name ?? (root === '.' ? name : path.posix.basename(root))).replace(/^@[^/]+\//, '');
      if (!result.some(item => item.kind === 'tool-server' && item.path === root)) add('tool-server', root, title, manifest.description ?? 'Tool server');
    }
  }
  if (repository) add('repository', '.', name, 'Git repository');
  return result;
}
```

- Tests: create the complete test file:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { additionPath, recognizeAdditionParts } from '../engine/service/addition-parts.mjs';
const file = (path, text) => ({ path, kind: 'file', bytes: Buffer.byteLength(text), text });
test('a mixed repository offers separate skills docs repository and a disabled tool', () => {
  const parts = recognizeAdditionParts([
    file('pdf/SKILL.md', '---\nname: pdf\ndescription: Read PDF files\n---\nInstructions.\n'),
    file('pdf/scripts/read.py', 'print(1)\n'), file('pdf/docs/help.md', '# Skill support\n'),
    file('docx/SKILL.md', '---\nname: docx\ndescription: Word documents\n---\nInstructions.\n'),
    file('docs/guide.md', '# Project documentation\n'),
    file('tools/package.json', '{"name":"acme-files","mcp":true,"scripts":{"postinstall":"never execute"}}'),
  ], { repository: true, name: 'landing-site' });
  assert.deepEqual(parts.map(item => [item.kind, item.name]).sort(), [
    ['docs', 'docs'], ['repository', 'landing-site'], ['skill', 'docx'], ['skill', 'pdf'], ['tool-server', 'acme-files'],
  ]);
  assert.deepEqual(parts.find(item => item.name === 'pdf').requirements, ['Python']);
  assert.equal(parts.find(item => item.kind === 'tool-server').supported, false);
  assert.equal(parts.find(item => item.kind === 'tool-server').blockedReason, 'after_3_0');
  assert.equal(JSON.stringify(parts).includes('never execute'), false);
});
test('unsafe inventories fail before any candidate can be accepted', () => {
  for (const value of ['/root/file', '../file', 'a/../file', 'a\\file', 'C:/file', 'a:stream', 'CON/file', 'a./file']) {
    assert.throws(() => additionPath(value), error => error.code === 'invalid_path');
  }
  assert.throws(() => recognizeAdditionParts([file('docs/a.md', 'a'), file('DOCS/A.md', 'b')]), error => error.code === 'invalid_path');
  assert.throws(() => recognizeAdditionParts([{ path: 'a', kind: 'link', bytes: 0, text: null }]), error => error.code === 'invalid_source');
  assert.throws(() => recognizeAdditionParts(Array.from({ length: 1025 }, (_, index) => file(String(index), ''))), error => error.code === 'addition_too_large');
  for (const body of ['{', 'null', '[]', '{"name":42}']) {
    assert.throws(() => recognizeAdditionParts([file('package.json', body)]), error => error.code === 'invalid_source');
  }
});
```

- Proof: `node --test test/service-addition-parts.test.mjs`; 2 passed, 0 failed; mixed recognition retains one disabled tool and no script command appears in its projection.
- Depends on: T065. Commit message: `Recognize separate parts of an imported source`.

#### T067. Bind check eligibility and deduplicate unit scope

- Screens: 2.20, 2.21. Decisions: 23. Kind: MECHANICAL.
- Files: new `engine/service/addition-check.mjs`, all code below; new `test/service-addition-check.test.mjs`, all tests below.
- Change: create the pure check and scope module. The acquisition task supplies verified evidence; this module cannot infer a date, license or successful script policy from source claims. Runtime needs remain a caution, with actual selected-session support checked by T069.

```js
import { CoreError } from './identity.mjs';
export function checkAddition(candidate, evidence, nowMs) {
  const pin = evidence.pin;
  const pinned = evidence.pinVerified === true && /^[a-f0-9]{64}$/.test(pin?.digest ?? '')
    && (pin.kind === 'commit' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pin.value)
      || pin.kind === 'version' && typeof pin.value === 'string' && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(pin.value) && pin.value.length <= 128
      || pin.kind === 'snapshot' && pin.value === pin.digest);
  const published = typeof evidence.publishedAt === 'string' ? Date.parse(evidence.publishedAt) : NaN;
  const elapsed = Number.isFinite(published) && Number.isFinite(nowMs) ? nowMs - published : NaN;
  const days = Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed / 86400000) : null;
  const license = typeof evidence.license === 'string' && evidence.license.trim()
    && evidence.license.length <= 128 && !/[\x00-\x1f\x7f]/.test(evidence.license) ? evidence.license.trim() : null;
  const scripts = evidence.noInstallScripts === true;
  const ageOk = days !== null && days >= 7;
  return { pin: { ok: pinned, kind: pin?.kind ?? '', value: pin?.value ?? '' },
    license: { ok: license !== null, value: license }, age: { ok: ageOk, days, publishedAt: Number.isFinite(published) ? evidence.publishedAt : null },
    scripts: { ok: scripts, noInstallScripts: scripts },
    runtime: { ok: evidence.runtimeVerified === true && candidate.requirements.length === 0,
      verified: evidence.runtimeVerified === true, requirements: [...candidate.requirements] },
    eligible: candidate.supported === true && pinned && license !== null && ageOk && scripts && evidence.runtimeVerified === true };
}

export function resolveAdditionScope(scope, units, groups) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).some(key => !['everyUnit', 'units', 'groups'].includes(key))
    || typeof scope.everyUnit !== 'boolean' || !Array.isArray(scope.units) || !Array.isArray(scope.groups)
    || scope.units.length > 255 || scope.groups.length > 255 || scope.everyUnit && (scope.units.length || scope.groups.length)) {
    throw new CoreError(422, 'invalid_scope', 'Choose Every unit or specific units and groups.');
  }
  const known = new Set(units.filter(id => id !== 'root:master'));
  const selected = new Set(scope.everyUnit ? known : []);
  const selectedGroups = new Set();
  for (const id of scope.units) {
    if (!known.has(id)) throw new CoreError(409, 'scope_changed', 'A selected unit is no longer available.');
    selected.add(id);
  }
  for (const id of scope.groups) {
    const group = groups.find(item => item.id === id && item.deleted !== true);
    if (!group) throw new CoreError(409, 'scope_changed', 'A selected group is no longer available.');
    selectedGroups.add(id);
    for (const member of group.members) {
      if (!known.has(member)) throw new CoreError(409, 'scope_changed', 'A selected group changed its members.');
      selected.add(member);
    }
  }
  if (!selected.size) throw new CoreError(422, 'invalid_scope', 'Choose at least one available unit.');
  return { scope: { everyUnit: scope.everyUnit, units: [...new Set(scope.units)].sort(), groups: [...selectedGroups].sort() },
    unitIds: [...selected].sort(), unitCount: selected.size };
}
```

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAddition, resolveAdditionScope } from '../engine/service/addition-check.mjs';
const now = Date.parse('2026-10-13T12:00:00.000Z');
const candidate = { supported: true, requirements: ['Python'] };
const evidence = { pin: { kind: 'commit', value: 'a'.repeat(40), digest: 'b'.repeat(64) },
  pinVerified: true, license: 'MIT', publishedAt: '2026-10-06T12:00:00.000Z', noInstallScripts: true, runtimeVerified: true };
test('seven complete days pass while runtime requirements remain an explicit caution', () => {
  const check = checkAddition(candidate, evidence, now);
  assert.equal(check.eligible, true); assert.equal(check.age.days, 7); assert.equal(check.runtime.ok, false);
  assert.deepEqual(check.runtime.requirements, ['Python']);
  for (const patch of [ { publishedAt: '2026-10-06T12:00:00.001Z' }, { publishedAt: null },
    { publishedAt: '2026-10-14T12:00:00.000Z' }, { license: null }, { pinVerified: false }, { noInstallScripts: false }, { runtimeVerified: false } ]) {
    assert.equal(checkAddition(candidate, { ...evidence, ...patch }, now).eligible, false);
  }
  assert.equal(checkAddition({ ...candidate, supported: false }, evidence, now).eligible, false);
});
test('group and direct selection produce four distinct allowed units', () => {
  const units = ['root:master', 'root:adjutant', 'project:shop:one', 'project:shop:two', 'project:shop:three'];
  const groups = [{ id: 'checkout', members: units.slice(2), deleted: false }];
  const result = resolveAdditionScope({ everyUnit: false, units: ['root:adjutant', 'project:shop:one'], groups: ['checkout'] }, units, groups);
  assert.equal(result.unitCount, 4); assert.equal(result.unitIds.includes('root:master'), false);
  assert.equal(resolveAdditionScope({ everyUnit: true, units: [], groups: [] }, units, groups).unitCount, 4);
  for (const scope of [{ everyUnit: false, units: [], groups: [] }, { everyUnit: true, units: ['root:adjutant'], groups: [] },
    { everyUnit: false, units: ['root:master'], groups: [] }, { everyUnit: false, units: [], groups: ['missing'] }]) {
    assert.throws(() => resolveAdditionScope(scope, units, groups));
  }
  assert.throws(() => resolveAdditionScope({ everyUnit: false, units: [], groups: ['checkout'] }, units,
    [{ ...groups[0], members: ['project:shop:gone'] }]), error => error.code === 'scope_changed');
});
```

- Proof: `node --test test/service-addition-check.test.mjs`; 2 passed, 0 failed; the seven-day boundary is exact and the mixed selection counts four units once.
- Depends on: T066. Commit message: `Check pinned additions and resolve their unit scope`.

#### T068. Acquire immutable sources into owner-bound local previews

- Screens: 2.19, 2.20. Decisions: 23. Kind: JUDGMENT.
- Files: new `engine/service/addition-source.mjs`, `acquireAdditionSource`, `receiveAdditionChunk`, `disposeAdditionSource`, pin/license/date evidence and safe extraction; new `engine/service/additions.mjs`, `openAdditionUpload`, `writeAdditionChunk`, `inspectAddition`, `readAdditionPreview`, `cancelAdditionPreview`, `retryAdditionPreview`; `engine/service/http.mjs`, C12 upload/preview routes, `allowedBody`, `bodyLimitFor`, `objectFor`, `credentialFor`, `mutate`; `engine/service/service.mjs`, `composeCore`, injected acquisition runner and owner routing; `engine/service/security.mjs`, protected preview storage and safe error projection; new `test/service-addition-source.test.mjs`; new `test/service-additions.test.mjs`, preview/upload cases; `test/service-api.test.mjs`, desktop/phone/agent request matrix; `test/gui-fixture.mjs`, independent C12 preview/upload protocol.
- Change: settle exact Git/registry provider resolution and safe extraction while implementing C12 without another installer. Public registry links resolve package metadata/archive bytes directly; they never invoke a package manager. Git acquisition uses a bounded injected runner with hooks, credential helpers, submodules and external filters disabled, no shell, sanitized environment and no inherited private credentials. Every redirect/DNS address is checked before connecting. The full pin and manifest hash bind the staged bytes, not the mutable source link. Implement a timed inspection job returning 202 before the GUI waits, with authenticated polling of the same preview ID. Per-job acquisition ends at 30000 ms with source_timeout; other transport failures use source_unavailable and do not claim a timeout. Failure projects a safe code and retryable state. Jobs and uploads expire at 15 minutes, and owner/principal checks precede staging reads, writes and receipt lookup. Implement the C12 same-preview retry transition and preserve consumed owner/request/hash/result bindings for 24 hours; fifteen-minute review expiry only disposes unaccepted staging. Reject Add-route phone/agent audiences with `403 forbidden` before the existing generic phone mutation branch. Expose the privately bound unit/group choice snapshot and scopeRevision in Preview.
  Stage only under the verified local `L/additions/` root, using `assertLocalStaging`, `assertNoLinks`, `atomicWriteFile` and injected `protectLocalFile`. Validate every path with T066 before extracting or joining it; enforce link/device/size/chunk collision limits across the complete tree. Incomplete files cannot enter recognition. Preserve arbitrary binary support files without rendering their bytes. Resolve each part's nearest declared license and pinned commit/release date; do not substitute MIT, a download date or mtime. Local folder snapshots without credible date evidence remain inspectable with failed age check and a literal reason from T071. Source metadata is data, never code. Verify and augment T066 runtime hints from package engines, declared dependencies and script entry points without running them; an empty extension-derived array alone cannot prove that no runtime is needed. Unknown runtime evidence fails the check. Apply T066 recognition and T067 check per candidate. Unsupported tools remain disabled rows, with no install action.
  A dropped folder is uploaded through the chunk API; an absolute path or File.path supplied over HTTP is never accepted. Scope revisions and target Content/project revisions are captured for T069. Candidate requirements include verified declarative metadata, not only extension hints. Existing update targets bind kind, name and source identity; inspection leaves their accepted bytes active. Back and Cancel dispose only unaccepted local resources and never modify either source or M1ND. Repeated inspection, chunk upload and timeout retry retain operation/preview identity. No real network service, client configuration, native session or package manager is used by tests.
- Tests: in `test/service-addition-source.test.mjs`, use injected transport/runner fixtures for Git full pin, registry exact version/digest, mixed-source extraction, dropped chunks, root skill, nested skills, docs and disabled tool. Include 7-day boundary/unknown/future date, missing license, package postinstall that writes a sentinel if executed, private-network redirect, credential URL, bad digest, truncated archive, link/hardlink/device/traversal/device-name/alternate-stream/case collision, 1025 files, 16 MiB plus one file, 64 MiB plus one tree, interrupted/repeated/conflicting chunks, abort at 30000 ms and 15-minute expiry. Sentinels remain absent and fake execution counters remain zero. In `test/service-additions.test.mjs` and `test/service-api.test.mjs`, test exact bodies, wrong owner/machine/principal, offline selected machine, phone/agent rejection before staging/receipt, safe diagnostics with secret sentinel absent, preview cancellation and update inspection with hashes of M1ND/client/source unchanged. The fixture returns independent protocol records, not production recognition results.
- Proof: `node --test test/service-addition-source.test.mjs test/service-additions.test.mjs test/service-api.test.mjs test/gui-fixture.test.mjs`; 0 failures, 0 canceled; every rejected/canceled preview has unchanged M1ND/client/source hashes and zero installer/script/native launches.
- Depends on: T051, T065, T066, T067. Commit message: `Inspect pinned sources in protected local staging`.

#### T069. Accept scoped content and projects with recoverable ownership

- Screens: 2.20, 2.21, 2.22, 6.8. Decisions: 23. Kind: JUDGMENT.
- Files: `engine/service/additions.mjs`, `applyAdditions`, `removeAddition`, `readAdditions`, `readScopedAdditions`, acceptance/update recovery; `engine/service/settings.mjs`, T054 Content/project report extensions and registration reuse; `engine/install.mjs`, `installableAssetRoots`, `listInstallableAssets`, `planAgentAssets`, imported-content exclusion from global client installation; `engine/service/adapters.mjs`, `launch`, verified per-session content availability; `engine/service/bridge.mjs`, `createNativeLaunch`, native scoped capability binding; `engine/relay/local-wake.mjs`, verified manually registered app-session binding; `engine/service/projection.mjs`, `projectRecord`, zero-unit projects and provenance; `engine/service/service.mjs`, `configuredProjects`, selected-owner publication and project refresh; `engine/service/store.mjs`, owned content transaction authorization and `bindProjects`; `engine/service/http.mjs`, C12 read/apply/remove schema/authorization/dispatch; `engine/service/import-events.mjs`, accepted addition events; `engine/sync/store.mjs`, `stageTransaction`, accepted content/provenance eligibility; `engine/sync/apply.mjs`, imported bundle validation; `test/service-additions.test.mjs`, acceptance/scope/update/remove/Undo/recovery cases; `test/install-ownership.test.mjs`; `test/service-sessions.test.mjs`; `test/service-projection.test.mjs`; `test/sync-apply.test.mjs`; `test/gui-fixture.mjs`, independent accepted records and report extensions.
- Change: decide publication/recovery of local repository checkouts before the existing registration transaction, and implement all C12 accepted-state operations. Reuse T054 registration, machine path mapping, report publication and revision rules; refresh store/project/sync bindings without a service restart. The original dropped folder is not registered by an inferred path. Its uploaded snapshot and a downloaded repository are published to a protected owned checkout under `L/additions/repositories/<additionId>/`, with a byte-verified recovery record, then registered. The original dropped source is never rewritten. The ordinary M1ND journal does not authorize arbitrary repository-tree writes. Never fabricate an Overlord or unit to make the project appear.
  Skills use private `user/features/<name>/`, including their SKILL.md and support files; docs use private `user/knowledge/<name>/`. Preserve the reviewed license/NOTICE bytes in the owned package; an inherited license above the candidate root is included as its owned LICENSE file only after hash verification and collision checks. Preserve kit categories, private-name precedence and person preferences. Include accepted additions in T054 reports with origin, pin, scope, actual unit count, Remove and revision. Additions retain a separately owned manifest and tombstone; generic kit evolve cannot replace, delete or globally install them. Reuse owned file/hash planning, but do not send scoped assets through the current all-client `planAgentAssets` loop.
  Decide and prove the adapter-specific boundary that makes selected content available only to the canonical selected unit's service-owned CLI or verified app session. Resolve groups at use; prevent exposure through global client skills roots, a shared unfiltered retrieval route or merely an instruction to ignore content. A client without an enforceable scoped mechanism returns `scope_unavailable`, preserving accepted bytes and other clients. Runtime requirements do not create a tool process, install a runtime or broaden git/shell permission. If a required runtime is unavailable, return `runtime_unavailable` with the explicit requirement; no fallback installer. Configuration changes use T052 review/apply.
  Acceptance rechecks hashes, eligibility, current Content/project/scope revisions and local owner. A mixed selection is one recoverable transaction with the original receipt; any failing part leaves no partial visible Content/project registration. New-name collisions never replace kit/private content. Updates replace only owned accepted bytes after a new reviewed pin; foreign edits yield `destination_changed`, and the prior pin stays active until commit. Removal archives only owned imported content/provenance and revokes future availability; repository source/checkout bytes stay. Ten-second Undo shares T014/T028 revision gates. Publish source-free events and sync only the accepted shared bundle; do not sync absolute checkout paths or preview/staging credentials.
- Tests: `test/service-additions.test.mjs` must cover skill+support placement, docs knowledge pack placement, mixed atomic acceptance, C09 field retention, actual four-unit count, no global/client write, unit/group-only availability, group membership changes, deleted unit/group, unsupported client, unavailable Python, no runtime/script launch on Add, duplicate acceptance/receipt replay, stale preview/hash/scope/name/destination, shared Content sync, local repo mapping, zero-unit project projection, no fabricated unit/lead, interrupted checkout publication/registration/content write with verified reopen, update inspection without replacement, rejected update preserving prior pin, successful owned update, foreign edit preservation, Remove and valid/expired/conflicting Undo. `test/install-ownership.test.mjs` verifies evolve cannot globally install or prune accepted scoped content. `test/service-sessions.test.mjs` verifies two units on the same client see different allowed additions and verified manual sessions do not widen scope. `test/sync-apply.test.mjs` verifies accepted hashes/scopes/provenance on a second machine and absence of local preview paths, credentials and checkout bytes. Repository source/checkout inventories remain identical after Remove/Undo.
- Proof: `node --test test/service-additions.test.mjs test/service-settings.test.mjs test/install-ownership.test.mjs test/service-sessions.test.mjs test/service-projection.test.mjs test/sync-apply.test.mjs`; 0 failures, 0 canceled; rejected acceptance produces no partial visibility, unselected sessions receive no imported assets, and Remove/Undo leave repository bytes identical.
- Depends on: T014, T028, T052, T053, T054, T068. Commit message: `Accept scoped additions without replacing existing content`.

#### T070. Retain Add operations through uncertain responses

- Screens: 2.19 to 2.22, 6.8. Decisions: 23. Kind: MECHANICAL.
- Files: new `gui/app/add-api.mjs`, complete module below; new `test/gui-add-api.test.mjs`, complete tests below. Existing API deadlines and credentials are reused, not replaced.
- Change: create:

```js
import { createOperation, request } from './api.mjs';
async function mutation(api, spec, retained) {
  const operation = retained ?? createOperation(spec);
  try {
    const result = await request(api, operation.method, operation.path, { operation });
    result.operation = operation;
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && error.operation == null) error.operation = operation;
    throw error;
  }
}
export function beginAdditionUpload(api, machine, name, retained = null) {
  return mutation(api, { method: 'POST', path: '/additions/uploads', body: { machine, name } }, retained);
}
export function sendAdditionChunk(api, uploadId, chunk, retained = null) {
  const { path, index, total, base64 } = chunk;
  return mutation(api, { method: 'PUT', path: '/additions/uploads/:uploadId/chunks', params: { uploadId },
    body: { path, index, total, base64 } }, retained);
}
export function cancelAdditionUpload(api, uploadId, retained = null) {
  return mutation(api, { method: 'DELETE', path: '/additions/uploads/:uploadId', params: { uploadId }, body: {} }, retained);
}
export function inspectAdditionSource(api, machine, source, updateOf = null, retained = null) {
  return mutation(api, { method: 'POST', path: '/additions/previews', body: { machine, source, updateOf } }, retained);
}
export function getAdditionPreview(api, previewId) {
  return request(api, 'GET', '/additions/previews/:previewId', { params: { previewId } });
}
export function retryAdditionPreview(api, previewId, retained = null) {
  return mutation(api, { method: 'POST', path: '/additions/previews/:previewId/retry', params: { previewId }, body: {} }, retained);
}
export function cancelAdditionPreview(api, previewId, retained = null) {
  return mutation(api, { method: 'DELETE', path: '/additions/previews/:previewId', params: { previewId }, body: {} }, retained);
}
export function acceptAdditions(api, input, retained = null) {
  const { machine, previewId, selections, expectedContentRevision, expectedProjectRevision } = input;
  return mutation(api, { method: 'POST', path: '/additions', body: { machine, previewId, selections,
    expectedContentRevision, expectedProjectRevision, confirmed: true } }, retained);
}
export function getAdditions(api, machine) {
  return request(api, 'GET', '/additions', { query: { machine } });
}
export function removeAddition(api, machine, additionId, expectedRevision, retained = null) {
  return mutation(api, { method: 'DELETE', path: '/additions/:additionId', params: { additionId },
    body: { machine, confirmed: true, expectedRevision } }, retained);
}
```

- Tests: create:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../gui/app/api.mjs';
import { beginAdditionUpload, sendAdditionChunk, cancelAdditionUpload, inspectAdditionSource, getAdditionPreview, retryAdditionPreview,
  cancelAdditionPreview, acceptAdditions, getAdditions, removeAddition } from '../gui/app/add-api.mjs';
function fixture(statuses = []) {
  const calls = [];
  const api = createApi({ location: { origin: 'http://127.0.0.1:43210' },
    fetch: async (url, options) => {
      calls.push({ path: new URL(url).pathname + new URL(url).search, method: options.method,
        body: options.body == null ? null : JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
      const status = statuses.shift() ?? 200;
      return new Response(JSON.stringify(status < 400 ? { contract: 'hivem1nd-gui-v3', data: { accepted: true },
        meta: { requestId: 'fixture-request', readAt: '2026-10-13T12:00:00.000Z', eventCursor: '0', sync: 'local' } }
        : { error: { code: 'source_unavailable', message: 'The source did not answer.' } }),
        { status, headers: { 'Content-Type': 'application/json' } });
    } });
  api.token = 'public-fixture-token';
  return { api, calls };
}
test('Add operations send the exact contract fields and reject unsafe IDs', async () => {
  const { api, calls } = fixture();
  const uploadId = '11111111-1111-4111-8111-111111111111';
  const previewId = '22222222-2222-4222-8222-222222222222';
  const additionId = '33333333-3333-4333-8333-333333333333';
  await assert.rejects(sendAdditionChunk(api, '../foreign', { path: 'docs/a.md', index: 0, total: 1, base64: 'YQ==' }), error => error.code === 'invalid_path');
  await beginAdditionUpload(api, 'DESKTOP', 'folder');
  await sendAdditionChunk(api, uploadId, { path: 'docs/a.md', index: 0, total: 1, base64: 'YQ==' });
  await cancelAdditionUpload(api, uploadId);
  await inspectAdditionSource(api, 'DESKTOP', { kind: 'git', url: 'https://example.com/skills.git' });
  await getAdditionPreview(api, previewId);
  await retryAdditionPreview(api, previewId);
  await cancelAdditionPreview(api, previewId);
  await acceptAdditions(api, { machine: 'DESKTOP', previewId: 'preview', selections: [], expectedContentRevision: null, expectedProjectRevision: null });
  await getAdditions(api, 'DESKTOP');
  await removeAddition(api, 'DESKTOP', additionId, 'revision');
  assert.deepEqual(calls.map(call => [call.method, call.path]), [
    ['POST', '/api/v1/additions/uploads'], ['PUT', '/api/v1/additions/uploads/11111111-1111-4111-8111-111111111111/chunks'],
    ['DELETE', '/api/v1/additions/uploads/11111111-1111-4111-8111-111111111111'], ['POST', '/api/v1/additions/previews'],
    ['GET', '/api/v1/additions/previews/22222222-2222-4222-8222-222222222222'], ['POST', '/api/v1/additions/previews/22222222-2222-4222-8222-222222222222/retry'], ['DELETE', '/api/v1/additions/previews/22222222-2222-4222-8222-222222222222'],
    ['POST', '/api/v1/additions'], ['GET', '/api/v1/additions?machine=DESKTOP'], ['DELETE', '/api/v1/additions/33333333-3333-4333-8333-333333333333'],
  ]);
  assert.deepEqual(calls[3].body, { machine: 'DESKTOP', source: { kind: 'git', url: 'https://example.com/skills.git' }, updateOf: null });
  assert.deepEqual(calls[7].body, { machine: 'DESKTOP', previewId: 'preview', selections: [], expectedContentRevision: null,
    expectedProjectRevision: null, confirmed: true });
  assert.deepEqual(calls[9].body, { machine: 'DESKTOP', confirmed: true, expectedRevision: 'revision' });
  assert.equal(calls[4].key, undefined); assert.equal(calls[8].key, undefined);
});
test('Retry preserves the original Add operation body and idempotency identity', async () => {
  const { api, calls } = fixture([503, 201]);
  const input = { machine: 'DESKTOP', previewId: 'preview', selections: [{ candidateId: 'pdf',
    scope: { everyUnit: false, units: ['root:adjutant'], groups: [] } }], expectedContentRevision: 'before', expectedProjectRevision: null };
  let retained;
  try { await acceptAdditions(api, input); } catch (error) { retained = error.operation; }
  assert.ok(retained); input.selections[0].scope.units = ['root:other'];
  await acceptAdditions(api, input, retained);
  assert.equal(calls[0].key, calls[1].key); assert.deepEqual(calls[0].body, calls[1].body);
  assert.deepEqual(calls[1].body.selections[0].scope.units, ['root:adjutant']);
});
```

- Proof: `node --test test/gui-add-api.test.mjs test/gui-transport.test.mjs`; the two new tests pass, existing transport tests pass, 0 failures, 0 canceled. Retry retains the original payload and operation identity.
- Depends on: T018, T069. Commit message: `Retain Add operations for safe retries`.

#### T071. Render the Add discovery and check windows

- Screens: 2.19, 2.20, 2.21, 6.8 and shared desktop Add buttons. Decisions: 23. Kind: MECHANICAL.
- Files: new `gui/app/add-view.mjs`, complete copy/renderer below; `gui/app/styles.css`, append the complete CSS below; new `test/add-dom-fixture.mjs`, complete isolated DOM fixture below; new `test/gui-add-view.test.mjs`, complete tests below. T072 wires these renderers into the existing shell.
- Change: create the module. All product copy is literal below. Source descriptions remain third-party data, rendered with textContent. Never interpolate them into HTML or translate their instructions. Model fields are `language`, `stage` (`source` or `check`), `link`, `preview`, `selected` (candidate IDs), `scopes` (candidate-ID keyed Scope), `choices` (`units:[{id,title}]`, `groups:[{id,title,members}]`), `busy`, and `errorCode`. Actions are `onInspect`, `onDrop`, `onSelect`, `onScope`, `onContinue`, `onBack`, `onCancel`, `onAccept`, `onRetry`. Renderer output does not authorize a write.

```js
import { element, labelDialog, progressMark } from './components.mjs';
export const ADD_COPY = Object.freeze({
  title: ['Add to M1ND', 'Agregar al M1ND'],
  add: ['Add', 'Agregar'],
  linkHint: ['Paste a link to a repository or a registry, or drop a folder.', 'Pegar un enlace a un repositorio o registro, o soltar una carpeta.'],
  link: ['Link', 'Enlace'],
  found: ['Found in {source}, {kind} {pin}', 'Detectado en {source}, {kind} {pin}'],
  commit: ['commit', 'commit'], version: ['version', 'versión'], snapshot: ['snapshot', 'copia'],
  skill: ['Skill', 'Skill'], repository: ['Repository', 'Repositorio'], docs: ['Docs', 'Documentación'],
  'tool-server': ['Tool server', 'Servidor de herramientas'],
  docsDescription: ['Documentation', 'Documentación'], repositoryDescription: ['Git repository', 'Repositorio Git'],
  toolDescription: ['Available after 3.0', 'Disponible después de 3.0'],
  cancel: ['Cancel', 'Cancelar'], back: ['Back', 'Volver'], continue: ['Continue', 'Continuar'],
  inspect: ['Reading the source', 'Leyendo el origen'], adding: ['Adding', 'Agregando'],
  addName: ['Add {name}', 'Agregar {name}'], addMany: ['Add {count} items', 'Agregar {count} elementos'],
  checkSub: ['{kind} from {source}. Nothing is copied until you press {action}.', '{kind} de {source}. No se copia nada hasta seleccionar {action}.'],
  pinned: ['Pinned to {kind} {pin}', 'Fijado a {kind} {pin}'],
  unknownPin: ['The pin could not be verified', 'No se pudo verificar la versión fijada'],
  updateHint: ['updates wait for your yes', 'las actualizaciones requieren confirmación'],
  license: ['{license} license', 'Licencia {license}'],
  unknownLicense: ['License not reported', 'Licencia no informada'],
  age: ['Older than 7 days, no install scripts', 'Más de 7 días, sin ejecutar scripts de instalación'],
  young: ['Less than 7 complete days old', 'Antigüedad menor a 7 días completos'],
  unknownAge: ['Age could not be verified', 'No se pudo verificar la antigüedad'],
  scriptUnknown: ['No-install-script execution could not be verified', 'No se pudo verificar que no se ejecutaron scripts de instalación'],
  needs: ['Its scripts run {requirements}', 'Los scripts utilizan {requirements}'],
  noRuntime: ['No executable runtime required', 'No se requiere un entorno de ejecución'],
  unknownRuntime: ['Runtime requirements could not be verified', 'No se pudieron verificar los requisitos de ejecución'],
  native: ['Native executable', 'Ejecutable nativo'],
  onlyUnits: ['only in the units below', 'solo en las unidades seleccionadas'],
  who: ['Who can use it', 'Quién puede utilizarlo'], every: ['Every unit', 'Todas las unidades'],
  groupOne: ['Group, 1 unit', 'Grupo, 1 unidad'], groupMany: ['Group, {count} units', 'Grupo, {count} unidades'],
  originOne: ['from {source}, 1 unit', 'de {source}, 1 unidad'], originMany: ['from {source}, {count} units', 'de {source}, {count} unidades'],
  addedOne: ['{name} added for 1 unit', '{name} agregado para 1 unidad'], addedMany: ['{name} added for {count} units', '{name} agregado para {count} unidades'],
  remove: ['Remove', 'Quitar'], undo: ['Undo', 'Deshacer'], retry: ['Retry', 'Reintentar'],
  checkUpdates: ['Check for updates', 'Comprobar actualizaciones'],
  removeTitle: ['Remove {name}?', '¿Quitar {name}?'],
  removeContent: ['Its added content and access are removed. Kit content and source files stay. Undo is available for 10 s.', 'Se quitan el contenido agregado y su acceso. Se conservan el contenido del kit y los archivos de origen. Deshacer está disponible durante 10 s.'],
  removeRepository: ['The project leaves the Map and Hierarchy. Repository files and work stay. Undo is available for 10 s.', 'El proyecto se quita del Mapa y la Jerarquía. Se conservan los archivos del repositorio y el trabajo. Deshacer está disponible durante 10 s.'],
  projectOrigin: ['Project from {source}', 'Proyecto de {source}'],
  noUnits: ['No units yet', 'Sin unidades todavía'],
  repoPinned: ['The repository is pinned at commit {pin}. Add its first unit to start working on it.', 'El repositorio está fijado al commit {pin}. Agregar la primera unidad para comenzar a trabajar.'],
  newUnit: ['New unit in {project}', 'Nueva unidad en {project}'],
  repoAdded: ['{project} added', '{project} agregado'], newUnitShort: ['New unit', 'Nueva unidad'],
  newProject: ['new', 'nuevo'],
  failureHint: ['The selection is kept. Retry checks the saved operation before sending it again.', 'Se conserva la selección. Reintentar comprueba la operación guardada antes de volver a enviarla.'],
  error_source_unavailable: ['The source could not be read. Check the link and retry.', 'No se pudo leer el origen. Comprobar el enlace y reintentar.'],
  error_source_timeout: ['The source did not answer in 30 s.', 'El origen no respondió en 30 s.'],
  error_invalid_source: ['The source link or manifest is invalid.', 'El enlace o manifiesto de origen no es válido.'],
  error_invalid_path: ['The source contains an unsafe file path or link.', 'El origen contiene una ruta de archivo o enlace no seguro.'],
  error_addition_too_large: ['The source exceeds the file or size limit.', 'El origen supera el límite de archivos o tamaño.'],
  error_check_failed: ['The source did not pass its pin, license, age or script check.', 'El origen no superó la comprobación de versión, licencia, antigüedad o scripts.'],
  error_unsupported_addition: ['Tool servers are available after 3.0.', 'Los servidores de herramientas estarán disponibles después de 3.0.'],
  error_preview_expired: ['The check expired. Read the source again.', 'La comprobación venció. Leer el origen de nuevo.'],
  error_preview_changed: ['The reviewed source changed. Read it again.', 'Cambió el origen revisado. Leerlo de nuevo.'],
  error_source_changed: ['The source bytes changed. Read the source again.', 'Cambiaron los archivos de origen. Leer el origen de nuevo.'],
  error_scope_changed: ['The selected units or group members changed. Review the selection.', 'Cambiaron las unidades o integrantes del grupo seleccionados. Revisar la selección.'],
  error_invalid_scope: ['Choose at least one available unit or group.', 'Seleccionar al menos una unidad o grupo disponible.'],
  error_destination_changed: ['Existing content changed. It was not replaced.', 'Cambió el contenido existente. No se reemplazó.'],
  error_name_conflict: ['The name is already used by existing content. Nothing was replaced.', 'El nombre ya corresponde a contenido existente. No se reemplazó nada.'],
  error_revision_conflict: ['Content or project registration changed. Review the check again.', 'Cambió el contenido o registro de proyectos. Revisar la comprobación de nuevo.'],
  error_machine_unavailable: ['The selected machine is offline. Its files were not changed.', 'La máquina seleccionada está desconectada. No se modificaron sus archivos.'],
  error_runtime_unavailable: ['A required runtime is unavailable on the selected machine.', 'No está disponible un entorno de ejecución requerido en la máquina seleccionada.'],
  error_scope_unavailable: ['The selected client cannot provide content only to the selected units.', 'El cliente seleccionado no puede ofrecer el contenido solo a las unidades seleccionadas.'],
  error_addition_not_found: ['The addition is no longer available.', 'El elemento agregado ya no está disponible.'],
  error_preview_not_found: ['The source check is no longer available.', 'La comprobación de origen ya no está disponible.'],
  error_forbidden: ['Add to M1ND is available on the computer only.', 'Agregar al M1ND está disponible solo en la computadora.'],
  error_unknown: ['The operation could not be confirmed. Retry to check its state.', 'No se pudo confirmar la operación. Reintentar para comprobar su estado.'],
});
export function addText(language, key, values = {}) {
  const pair = ADD_COPY[key];
  if (!pair) throw new Error('Unknown Add copy key: ' + key);
  return pair[language === 'es' ? 1 : 0].replace(/\{([A-Za-z]+)\}/g, (_, name) => String(values[name] ?? ''));
}
function plus(document) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'add-plus');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 5v14M5 12h14'); svg.append(path); return svg;
}
export function addButton(document, language, onOpen, content = false) {
  const button = element(document, 'button', { type: 'button', class: content ? 'btn primary add-content' : 'add-button',
    'data-action': content ? 'add-content' : 'add-to-mind', 'aria-label': addText(language, 'title'), onclick: onOpen });
  button.append(plus(document), element(document, 'span', { text: addText(language, 'add') })); return button;
}
function button(document, text, id, handler, disabled, primary = false) {
  return element(document, 'button', { type: 'button', class: primary ? 'btn primary' : 'btn', 'data-action': id,
    disabled: disabled ? '' : null, text, onclick: handler });
}
function choice(document, title, checked, disabled, onChange, badge = null, description = null) {
  const row = element(document, 'label', { class: 'add-choice' + (checked ? ' is-selected' : '') });
  const input = element(document, 'input', { type: 'checkbox', disabled: disabled ? '' : null }); input.checked = checked;
  input.addEventListener('change', () => onChange?.(input.checked));
  row.append(input, element(document, 'strong', { text: title }));
  if (description) row.append(element(document, 'span', { class: 'add-description', text: description }));
  if (badge) row.append(element(document, 'span', { class: 'add-badge', text: badge })); return row;
}
function checkLine(document, ok, value, note = null) {
  const row = element(document, 'div', { class: 'add-check-line', 'data-check-ok': String(ok) });
  row.append(element(document, 'span', { class: ok ? 'add-check-dot complete' : 'add-check-dot caution', 'aria-hidden': 'true' }),
    element(document, 'span', { text: value }));
  if (note) row.append(element(document, 'span', { class: 'add-check-note', text: note })); return row;
}
function displayPin(pin) { return pin.kind === 'commit' ? pin.value.slice(0, 7) : pin.value; }
export function renderAdd(document, model, actions) {
  const t = (key, values) => addText(model.language, key, values);
  const selected = (model.preview?.candidates ?? []).filter(item => model.selected.includes(item.id));
  const accept = selected.length === 1 ? t('addName', { name: selected[0].title }) : t('addMany', { count: selected.length });
  const dialog = element(document, 'dialog', { class: 'add-dialog', 'data-add-stage': model.stage, 'aria-busy': String(model.busy) });
  const title = element(document, 'h2', { text: model.stage === 'check' ? accept : t('title') }); labelDialog(dialog, title); dialog.append(title);
  dialog.append(element(document, 'p', { class: 'add-subtitle', text: model.stage === 'check' && selected.length === 1
    ? t('checkSub', { kind: t(selected[0].kind), source: model.preview.sourceDisplay, action: accept }) : t('linkHint') }));
  if (model.stage === 'source') {
    const input = element(document, 'input', { type: 'url', id: 'add-link', 'aria-label': t('link'), class: 'add-link',
      disabled: model.busy ? '' : null, placeholder: 'https://', onchange: event => actions.onInspect?.(event.target.value) }); input.value = model.link;
    dialog.append(input);
    if (model.preview?.pin) dialog.append(element(document, 'p', { class: 'add-field-label', text: t('found', {
      source: model.preview.sourceDisplay, kind: t(model.preview.pin.kind), pin: displayPin(model.preview.pin) }) }));
    const found = element(document, 'div', { class: 'add-found', 'data-add-found': 'true' });
    for (const item of model.preview?.candidates ?? []) {
      const description = ['skill', 'tool-server'].includes(item.kind) ? item.description : t(item.kind === 'docs' ? 'docsDescription'
        : item.kind === 'repository' ? 'repositoryDescription' : 'toolDescription');
      const row = choice(document, item.title, model.selected.includes(item.id), model.busy || !item.supported,
        checked => actions.onSelect?.(item.id, checked), t(item.kind), description);
      if (!item.supported) row.children[0].setAttribute('aria-label', item.title + ', ' + t('toolDescription'));
      row.setAttribute('data-candidate-id', item.id); found.append(row);
    }
    dialog.append(found);
    dialog.addEventListener('dragover', event => event.preventDefault());
    dialog.addEventListener('drop', event => { event.preventDefault(); if (!model.busy) actions.onDrop?.(event); });
  } else {
    for (const item of selected) {
      const check = item.check;
      const block = element(document, 'section', { class: 'add-part-check', 'data-candidate-id': item.id });
      if (selected.length > 1) block.append(element(document, 'h3', { text: item.title }));
      const checks = element(document, 'div', { class: 'add-checks', 'aria-label': item.title });
      checks.append(checkLine(document, check.pin.ok, check.pin.ok ? t('pinned', { kind: t(check.pin.kind), pin: displayPin(check.pin) }) : t('unknownPin'), t('updateHint')),
        checkLine(document, check.license.ok, check.license.value ? t('license', { license: check.license.value }) : t('unknownLicense')),
        checkLine(document, check.age.ok && check.scripts.ok, !check.scripts.ok ? t('scriptUnknown') : check.age.ok ? t('age') : check.age.days === null ? t('unknownAge') : t('young')),
        checkLine(document, check.runtime.ok, check.runtime.requirements.length ? t('needs', {
          requirements: check.runtime.requirements.map(name => name === 'Native executable' ? t('native') : name).join(', '),
        }) : t(check.runtime.verified === false ? 'unknownRuntime' : 'noRuntime'), check.runtime.requirements.length ? t('onlyUnits') : null));
      block.append(checks, element(document, 'p', { class: 'add-field-label', text: t('who') }));
      const scope = model.scopes[item.id] ?? { everyUnit: false, units: [], groups: [] };
      const choices = element(document, 'div', { class: 'add-scope' });
      choices.append(choice(document, t('every'), scope.everyUnit, model.busy,
        checked => actions.onScope?.(item.id, 'everyUnit', null, checked)));
      for (const group of model.choices.groups) choices.append(choice(document, group.title, scope.groups.includes(group.id), model.busy,
        checked => actions.onScope?.(item.id, 'group', group.id, checked), group.members.length === 1 ? t('groupOne') : t('groupMany', { count: group.members.length })));
      for (const unit of model.choices.units) choices.append(choice(document, unit.title, scope.units.includes(unit.id), model.busy,
        checked => actions.onScope?.(item.id, 'unit', unit.id, checked)));
      block.append(choices); dialog.append(block);
    }
  }
  if (model.busy) dialog.append(element(document, 'p', { role: 'status', class: 'add-wait', text: t(model.stage === 'check' ? 'adding' : 'inspect') }));
  if (model.errorCode) {
    const error = element(document, 'div', { role: 'alert', class: 'add-error' });
    const key = 'error_' + model.errorCode;
    error.append(element(document, 'strong', { text: t(ADD_COPY[key] ? key : 'error_unknown') }), element(document, 'p', { text: t('failureHint') }));
    dialog.append(error);
  }
  const controls = element(document, 'div', { class: 'add-actions' });
  controls.append(button(document, t(model.stage === 'check' ? 'back' : 'cancel'), model.stage === 'check' ? 'add-back' : 'add-cancel',
    model.stage === 'check' ? actions.onBack : actions.onCancel, model.busy));
  const valid = selected.length > 0 && selected.every(item => item.supported && item.check.eligible
    && (model.scopes[item.id]?.everyUnit || model.scopes[item.id]?.units.length || model.scopes[item.id]?.groups.length));
  const next = button(document, model.busy ? t(model.stage === 'check' ? 'adding' : 'inspect')
    : model.errorCode ? t('retry') : model.stage === 'check' ? accept : t('continue'), model.stage === 'check' ? 'add-confirm' : 'add-continue',
    model.errorCode ? actions.onRetry : model.stage === 'check' ? actions.onAccept : actions.onContinue,
    model.busy || !model.errorCode && (model.stage === 'check' ? !valid : selected.length === 0), true);
  if (model.busy) {
    next.setAttribute('aria-busy', 'true');
    next.replaceChildren(progressMark(document, t(model.stage === 'check' ? 'adding' : 'inspect')));
  }
  controls.append(next);
  dialog.append(controls);
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!model.busy) actions.onCancel?.(); }); return dialog;
}
export function renderAddedContent(document, item, language, actions) {
  const t = (key, values) => addText(language, key, values);
  const row = element(document, 'div', { class: 'add-content-row', 'data-addition-id': item.additionId });
  const inclusion = choice(document, item.title, item.included, false, checked => actions.onIncluded?.(item, checked));
  inclusion.className = 'add-content-choice'; row.append(inclusion);
  row.append(element(document, 'button', { type: 'button', class: 'add-origin', title: t('checkUpdates'),
    'aria-label': t('checkUpdates') + ': ' + item.title, onclick: () => actions.onUpdate?.(item),
    text: t(item.unitCount === 1 ? 'originOne' : 'originMany', { source: item.origin, count: item.unitCount }) }));
  if (item.removable) row.append(button(document, t('remove'), 'remove-addition', () => actions.onRemove?.(item), false));
  return row;
}
```

Append this CSS. Modern values come directly from `bar`, `dialog`, `foundRow`, `checkLine`, `mapAddCheck` and `settingsContent`; token roles inherit the current look. Nocturne keeps the bar's 8-pixel button radius. The 18-pixel checkbox is inside a label target at least 32 pixels tall. The error/wait states use the existing error tokens supplied by earlier tasks.

```css
.add-button { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 7px 13px; border: 0; border-radius: 11px; background: var(--accent); color: var(--accent-ink); font: 700 13px var(--font); }
.add-plus { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
[data-look="high-contrast"] .add-button { border-radius: 8px; }
.add-dialog { width: 600px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow-y: auto; margin: auto; padding: 24px; border: 1px solid var(--line2); border-radius: 22px; background: var(--panel); color: var(--text); font-family: var(--font); }
.add-dialog { --add-scrim: rgba(4,2,6,0.62); }
.add-dialog::backdrop { background: var(--add-scrim); }
.add-dialog h2 { margin: 0 0 6px; font-size: 18px; font-weight: 700; }
.add-dialog h3 { margin: 0 0 8px; font-size: 14px; }
.add-subtitle { margin: 0 0 18px; font-size: 13.5px; line-height: 1.5; color: var(--mute); }
.add-link { box-sizing: border-box; width: 100%; min-height: 32px; padding: 11px 13px; border: 1px solid var(--accent); border-radius: 12px; background: var(--card); color: var(--text); font: 13px var(--mono); }
.add-field-label { margin: 18px 0 6px; color: var(--mute); font-size: 12.5px; font-weight: 600; }
.add-found, .add-scope { display: grid; gap: 6px; }
.add-choice { display: flex; align-items: center; gap: 12px; min-height: 32px; padding: 10px 12px; border: 1px solid transparent; border-radius: 12px; background: var(--card); font-size: 13.5px; cursor: pointer; }
.add-choice.is-selected { border-color: var(--accent); background: var(--card2); }
.add-choice strong { font-size: 14px; font-weight: 700; }
.add-choice input { appearance: none; flex: 0 0 18px; width: 18px; height: 18px; margin: 0; border: 2px solid var(--line2); border-radius: 4px; background: transparent; }
.add-choice input:checked { border-color: var(--accent); background: var(--accent); }
.add-choice input:checked::after { display: block; width: 8px; height: 4px; margin: 3px 2px; border: solid var(--accent-ink); border-width: 0 0 2px 2px; transform: rotate(-45deg); content: ''; }
.add-description { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--mute); }
.add-badge { margin-left: auto; padding: 2px 9px; border-radius: var(--radius-pill); background: var(--card2); color: var(--body); font-size: 12px; white-space: nowrap; }
.add-part-check + .add-part-check { margin-top: 18px; }
.add-checks { display: grid; gap: 8px; padding: 12px 14px; border-radius: 14px; background: var(--card); }
.add-check-line { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
.add-check-dot { box-sizing: border-box; flex: 0 0 12px; width: 12px; height: 12px; border-radius: var(--radius-circle); }
.add-check-dot.complete { background: var(--accent); }
.add-check-dot.caution { border: 2px solid var(--waiting); }
.add-check-note { margin-left: auto; font-size: 12px; color: var(--mute); }
.add-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.add-actions button { min-height: 32px; padding: 7px 12px; border-radius: 10px; font-size: 12.5px; font-weight: 600; }
.add-content-row { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 9px 12px; border: 1px solid var(--accent); border-radius: 10px; background: var(--card2); }
.add-content-row .add-origin { margin-left: auto; font-size: 12.5px; color: var(--accent); }
.add-content-row button.add-origin { padding: 0; border: 0; background: transparent; font-family: var(--font); cursor: pointer; }
.add-content-row input { accent-color: var(--accent); width: 18px; height: 18px; }
.add-content-choice { display: flex; align-items: center; gap: 10px; min-height: 32px; }
.add-content-row button { min-height: 32px; }
.add-content { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; }
.add-error { display: grid; gap: 8px; margin-top: 18px; padding: 12px 14px; border: 1px solid var(--error); border-radius: 14px; background: var(--error-soft); font-size: 13px; }
.add-error p { margin: 0; color: var(--body); }
.add-wait { margin: 18px 0 0; color: var(--body); font-size: 13px; }
@media (max-width: 720px) { .add-choice { flex-wrap: wrap; } .add-check-line { flex-wrap: wrap; } .add-check-note { margin-left: 22px; } .add-description { white-space: normal; } .add-content-row { flex-wrap: wrap; } }
```

- Tests: create `test/add-dom-fixture.mjs` exactly:

```js
class Node {
  constructor(tag, nodeType = 1, text = '') { this.tagName = tag.toUpperCase(); this.nodeType = nodeType; this.attributes = {}; this.children = []; this.listeners = {}; this.textContent = text; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, action) { this.listeners[name] = action; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
}
export const document = { createElement: name => new Node(name), createElementNS: (_namespace, name) => new Node(name),
  createTextNode: text => new Node('#text', 3, String(text)) };
export function nodes(root) { return [root, ...root.children.flatMap(child => child?.nodeType ? nodes(child) : [])]; }
export function copy(root) { return nodes(root).map(node => node.textContent).filter(Boolean).join('\n'); }
```

Create `test/gui-add-view.test.mjs` exactly:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADD_COPY, addText, addButton, renderAdd, renderAddedContent } from '../gui/app/add-view.mjs';
import { document, nodes, copy } from './add-dom-fixture.mjs';
const check = { pin: { ok: true, kind: 'commit', value: '4f2c9e1'.padEnd(40, '0') }, license: { ok: true, value: 'MIT' },
  age: { ok: true, days: 9, publishedAt: '2026-10-01T00:00:00.000Z' }, scripts: { ok: true, noInstallScripts: true },
  runtime: { ok: false, verified: true, requirements: ['Python'] }, eligible: true };
const pdf = { id: 'pdf', kind: 'skill', title: 'pdf', description: 'Reads, fills and merges PDF files', supported: true, check };
const model = { language: 'en', stage: 'source', link: 'https://example.com/skills', preview: { sourceDisplay: 'acme/agent-skills',
  pin: { kind: 'commit', value: check.pin.value }, candidates: [pdf, { ...pdf, id: 'docx', title: 'docx' },
    { ...pdf, id: 'tool', kind: 'tool-server', title: 'acme-files', description: 'Reads and writes cloud files', supported: false }] }, selected: ['pdf'],
  scopes: { pdf: { everyUnit: false, units: ['root:adjutant'], groups: ['checkout'] } },
  choices: { units: [{ id: 'root:adjutant', title: 'adjutant' }], groups: [{ id: 'checkout', title: 'Checkout launch', members: ['one', 'two', 'three'] }] }, busy: false, errorCode: null };
test('discovery lists mixed parts and disables the excluded tool with a named control', () => {
  const view = renderAdd(document, model, {});
  assert.match(copy(view), /Add to M1ND/); assert.match(copy(view), /Found in acme\/agent-skills, commit 4f2c9e1/);
  const rows = nodes(view).filter(node => node.getAttribute('data-candidate-id'));
  assert.deepEqual(rows.map(row => row.getAttribute('data-candidate-id')), ['pdf', 'docx', 'tool']);
  assert.equal(rows[2].children[0].getAttribute('disabled'), ''); assert.match(copy(rows[2]), /Reads and writes cloud files/);
  assert.match(rows[2].children[0].getAttribute('aria-label'), /Available after 3.0/);
  assert.equal(addButton(document, 'en', () => {}).getAttribute('aria-label'), 'Add to M1ND');
  assert.match(copy(renderAdd(document, { ...model, language: 'es' }, {})), /Agregar al M1ND/);
});
test('the check precedes unit selection and runtime caution does not imply installation', () => {
  const view = renderAdd(document, { ...model, stage: 'check' }, {});
  const text = copy(view);
  for (const value of ['Add pdf', 'Pinned to commit 4f2c9e1', 'MIT license', 'Older than 7 days, no install scripts',
    'Its scripts run Python', 'only in the units below', 'Who can use it', 'Every unit', 'Checkout launch', 'Group, 3 units', 'adjutant', 'Back']) assert.ok(text.includes(value), value);
  assert.ok(text.indexOf('MIT license') < text.indexOf('Who can use it'));
  assert.equal(nodes(view).filter(node => node.getAttribute('data-check-ok') === 'false').length, 1);
  const buttons = nodes(view).filter(node => node.tagName === 'BUTTON');
  assert.deepEqual(buttons.map(node => node.textContent), ['Back', 'Add pdf']);
  assert.equal(buttons[1].getAttribute('disabled'), null);
  const noScope = renderAdd(document, { ...model, stage: 'check', scopes: {} }, {});
  assert.equal(nodes(noScope).find(node => node.getAttribute('data-action') === 'add-confirm').getAttribute('disabled'), '');
});
test('added content preserves origin scope count and Remove while copy is bilingual', () => {
  const row = renderAddedContent(document, { title: 'pdf', included: true, additionId: 'owned', origin: 'acme/agent-skills', unitCount: 4, removable: true }, 'en', {});
  assert.match(copy(row), /from acme\/agent-skills, 4 units/); assert.match(copy(row), /Remove/);
  for (const [key, pair] of Object.entries(ADD_COPY)) {
    assert.equal(pair.length, 2); assert.equal(typeof addText('en', key), 'string'); assert.equal(typeof addText('es', key), 'string');
    assert.doesNotMatch(pair.join(' '), /\u2014/);
  }
  const malicious = renderAdd(document, { ...model, preview: { ...model.preview, candidates: [{ ...pdf, description: '<script>run()</script>' }] } }, {});
  assert.equal(nodes(malicious).some(node => node.tagName === 'SCRIPT'), false);
});
test('failed inspection retains an enabled Retry and unknown evidence is shown without a false claim', () => {
  let retried = 0;
  const failure = renderAdd(document, { ...model, preview: null, selected: [], errorCode: 'source_unavailable' }, { onRetry() { retried += 1; } });
  const retry = nodes(failure).find(node => node.getAttribute('data-action') === 'add-continue');
  assert.equal(retry.getAttribute('disabled'), null); assert.equal(retry.textContent, 'Retry'); retry.listeners.click(); assert.equal(retried, 1);
  const unknown = { ...pdf, check: { ...check, pin: { ok: false, kind: '', value: '' },
    runtime: { ok: false, verified: false, requirements: [] }, eligible: false } };
  const view = renderAdd(document, { ...model, stage: 'check', preview: { ...model.preview, candidates: [unknown] } }, {});
  assert.match(copy(view), /The pin could not be verified/); assert.match(copy(view), /Runtime requirements could not be verified/);
  assert.doesNotMatch(copy(view), /No executable runtime required/);
  const versioned = renderAdd(document, { ...model, preview: { ...model.preview, pin: { kind: 'version', value: '12.34.56-rc.10' } } }, {});
  assert.match(copy(versioned), /12\.34\.56-rc\.10/);
});
```

- Proof: `node --test test/gui-add-view.test.mjs test/gui-shell.test.mjs`; 4 new tests and existing shell tests pass, 0 failed, 0 canceled. Browser verification of exact bounds, all six looks, keyboard order, disabled tools and both languages is completed in T072/T064; this DOM fixture is not browser evidence.
- Depends on: T062, T067, T070. Commit message: `Render Add discovery checks and selected unit scopes`.

#### T072. Connect one Add window and show projects without units

- Screens: 2.19 to 2.22, 6.8 and every shared desktop bar. Decisions: 23. Kind: JUDGMENT.
- Files: new `gui/app/add-controller.mjs`, `openAdd`, `closeAdd`, source upload/inspection/check/accept/retry state and retained operations; `gui/app/main.mjs`, `renderBar`, mount/dispose, `settingsSurface`, project selection/inspector, shared modal and event refresh; `gui/app/settings.mjs`, T055 Content Add/provenance/Remove; `gui/app/hierarchy.mjs`, `buildHierarchy`, `flattenVisibleHierarchy`, zero-unit projects; `gui/app/map.mjs`, `createMap`, project circles and hit/selection integration; `gui/app/map-geometry.mjs`, `groupOriginsFor`, registered zero-unit project anchors; `gui/app/inspector.mjs`, `renderProject`; `gui/app/state.mjs`, project/addition report and retained Add draft, `additions.changed`; `engine/service/http.mjs`, `BROWSER_STATIC_FILES` add exact basenames `add-api.mjs`, `add-view.mjs`, `add-controller.mjs`; `test/gui-add-controller.test.mjs`, new; `test/gui-shell.test.mjs`; `test/gui-map.test.mjs`; `test/gui-fixture.mjs`; `test/gui-data.mjs`; `test/service-integration.test.mjs`; `test/service-api.test.mjs`; `test/gui-browser.md`, P13 observations only.
- Change: decide modal lifecycle/focus and project hit behavior, then compose T070/T071 against the completed T055 shell. The common desktop bar places the 32-pixel-or-larger `addButton` after modes and before Waiting, with icon 15, gap 6, padding 7x13, radius 11 in Modern and 8 in Nocturne, accent fill/ink, 13/700 label. Content's Features heading has its own Add with plus, using that same `openAdd` controller. Map, Blueprint, Void and Settings open the same one 600-pixel dialog, preserving their underlying selection, unsaved editor text and invoker. Phone and agent/embed audiences without desktop settings.write do not get this control or an alternate import path.
  The source step has the link/drop affordance, detection progress and separate candidate rows from T071. Debounce changed links by 300 ms; Enter inspects immediately; source reads carry the same retained operation and submit `{kind:"link",url:link}`. Source-type resolution is owned by the service, not guessed from a URL hostname in the browser. Chunk a dropped regular-file tree into 65536-byte chunks, rejecting symlinks and oversized/deep/duplicate paths before uploading; directory handles are traversed only within the dropped root. Never serialize File.path. Cancel disposes the owned preview/upload only. Continue selects the check stage without an acceptance request; Back retains candidate choices and scopes without repeating acquisition. Mixed selections show each part's check and scope in source order. Every unit clears explicit unit/group selections; explicit unit/group selection clears Every unit. Unit IDs and group IDs remain canonical, aliases affect labels only. C12 revision/eligibility rechecks remain authoritative.
  The accept button is the only placement request. It disables controls, displays a spinner in the pressed control and `Adding`, and retains exact fields/operation through response loss. A 30-second timeout ends local waiting, keeps the selection and offers Retry; reconciliation reads the same preview/receipt before another send. Preview state `accepted` settles from its stored result; state `failed` retries inspection through its C12 retry route using a retained per-attempt operation, not by replaying the initial 202. Close cannot claim cancellation of a committed Add. Group membership drift and expired checks require a new review, not a blind resubmission. Error keys and literal bilingual explanations come from T071; raw Git/package/script output never reaches the DOM. Returning from Cancel/Back/removal/Undo restores keyboard focus. Remove shows T071's confirmation with the actual name and correct content/repository explanation, then calls the C12 operation; Undo uses the existing ten-second change route.
  After skill acceptance open Settings, Content with its checked `renderAddedContent` row, actual origin and deduplicated unit count, Remove, and `addedOne`/`addedMany` toast with Undo. Docs appear in Knowledge packs with the same provenance/ownership affordances. Preserve all kit Features, Knowledge packs and Preferences. The imported origin text is a named Check for updates button, at least 32 pixels tall; it calls onUpdate and opens the same window/check/scopes and labels its new pin; the accepted old pin remains visible until replacement commits. No update is silently accepted on app open, event refresh, retry or a Settings checkbox.
  A repository acceptance loads the real `/projects` collection and selects its project in Hierarchy, Map and inspector. A project with `unitIds:[]` is represented as a project, not a synthetic Unit. Add it under Without an Overlord, with grid icon, zero count and its real project ID. On the board fixture place the new project circle at x320/y575 with diameter 46; real empty projects use the existing free-position layout placement and store their anchor in `layout.groups["project:" + projectId]` using its existing x/y position format. Never put a project ID in the UnitId-only `layout.nodes` map. Show the literal `new` / `nuevo` badge for a newly added empty project in Hierarchy and the zero count on its Map circle; after a real unit is created, show the actual count. `renderProject` uses the existing 366-pixel inspector, grid/title, origin subtitle `projectOrigin`, centered body padding 32/gap 12, title `noUnits` at 16/700, `repoPinned` at 13.5/mute/center, and primary `newUnit` button. It prefills the existing New unit dialog with that project and no Overlord, rather than creating a unit automatically. Success toast uses `repoAdded` and `newUnitShort`; count rises only after real unit creation.
  Project/addition events refresh report data while preserving the current mode, editor drafts and other inspector/chat state. Serve all three new browser module basenames through the existing exact static allowlist and verify they are packaged. Correct only measured P13 contrast/geometry/focus defects in the named files using current quiet theme tokens. Do not introduce a second desktop host, new package dependency, tool Connect UI or installer.
- Tests: `test/gui-add-controller.test.mjs` covers both entry points sharing one modal, en/es source/check, disabled tool, mixed selections, default no grant, actual canonical group/direct deduplication, 300 ms debounce/Enter, dropped chunk order/size and File.path exclusion, Continue/Back/Cancel with no acceptance, safe error mapping, in-button busy state, lost response and same-operation Retry, expired/stale checks, accepted Content placement/Undo, docs knowledge row, Remove confirmation/revision/foreign-edit failure and update check leaving old pin active. `test/gui-shell.test.mjs` checks Add before Waiting in Map/Blueprint/Void/Settings and absent on phone, Content Add opening the same controller, 32-pixel targets/names/focus restoration. `test/gui-map.test.mjs` checks a zero-unit registered project in Hierarchy/Map, project selection distinct from unit selection, inspector and prefilled New unit, no fabricated unit/lead, position persistence and subsequent real count. `test/service-integration.test.mjs` performs actual-core acceptance/read-back/reopen/sync/remove/Undo with injected acquisition/native/OS runners; fixture-only visual success cannot satisfy this integration test. `test/service-api.test.mjs` checks all three browser files' static MIME/allowlist. Observe 2.19 to 2.22 and the 6.8 Add control in both languages at 1440x900 and 720x600, all six looks, keyboard-only, 200% zoom and reduced motion; record actual outcomes in `test/gui-browser.md`.
- Proof: `node --test test/gui-add-api.test.mjs test/gui-add-view.test.mjs test/gui-add-controller.test.mjs test/gui-shell.test.mjs test/gui-map.test.mjs test/gui-fixture.test.mjs test/service-integration.test.mjs test/service-api.test.mjs`; 0 failed, 0 canceled; the named browser observations pass with recorded actual viewport/target/contrast evidence. T063/T064 remain the subsequent full-suite and 87-screen acceptance gates.
- Depends on: T016, T055, T062, T069, T070, T071. Commit message: `Connect Add to M1ND across desktop modes and Content`.

### P12. Verification

#### T063. Run the final automated gates and report every result

- Screens: all 83. Decisions: 1 to 22. Kind: MECHANICAL.
- Files: `test/gui-browser.md`, automated-gate evidence section only. No production file is changed in this task.
- Change: run each command below separately at the root and append its observed exit code/counts/failure names to the evidence file. Do not substitute a fixture for the actual full suite and do not hide a platform skip. Build cache failure must be resolved through a permitted writable npm cache/environment before this task can pass; no source change is made to bypass packaging.

```powershell
npm.cmd test
npm.cmd run test:core
npm.cmd run lint
npm.cmd run build
git diff --check
```

- Tests: existing full suite plus all added task tests. No mirrored implementation test is added for a command-running/evidence task.
- Proof: all five commands exit 0; npm test/core show 0 fail/0 canceled, all newly required tests executed; lint 0 issues; build prints packaged browser assets and the 3.0.0 archive; diffcheck has no output. The known Windows permission skip is named explicitly if still present. Never claim pass counts before observing them.
- Depends on: T062. Commit message: `Record the final automated integration checks`.

#### T064. Verify all final screens against the actual core and capture evidence

- Screens: all 87. Decisions: 1 to 23. Kind: JUDGMENT.
- Files: `test/gui-browser.md`, per-screen actual results and evidence; `test/gui-data.mjs`, final board sample/scenario state generation; `test/gui-fixture.mjs`, final independent protocol scenarios; `test/service-integration.test.mjs`, actual-core/GUI protocol coverage; `docs/3.0/verification/<reference>-<language>-modern.png`, 174 new captures, with reference drawn from the complete 87-entry verification list and language exactly `en` or `es`; `docs/3.0/verification/6.1-en-<look>.png`, five additional captures with look exactly `high-contrast`, `nebula`, `txmska`, `coffee-cat` or `ntk`. This closed naming rule defines every capture filename. These files are execution artifacts, not outputs of the current planning session.
- Change: decide reproducible scenario controls for real core persistence, client ownership and adverse states. Execute the verification list at 1440 by 900 on desktop and 390 by 844 on phone, in both languages. Check common chrome and contrast in all six looks. Record the 179 captures named above, reach steps, expected and actual elements, pass/fail, look, language, viewport, and whether the source is core or fixture. Use temporary M1NDs and repositories with injected client/OS adapters. Add source inspection/acceptance/update/removal, scoped session availability, empty-project registration, cross-project moves, assets, Void saves, History Restore, Undo, owner permissions and stopped-service recovery must exercise the actual core. Return defects to the owning task and repeat affected checks before the final full gate. Manual sessions and Windows/Linux service tests remain explicit release gates requiring platform access. Live-machine deployment is outside this planning task.
- Tests: all routes enumerated in C01 to C12, including authorization before receipt, exact schemas, status codes, revision conflicts, crash recovery, sync and states; all 87 screen reach cases; actual QR decoding; every disabled/error/loading/optimistic state; keyboard/scroll/zoom/contrast; no secret logging/storage/output.
- Proof: `node --test test/service-integration.test.mjs`; zero failures, plus 87/87 observed screen passes and no unresolved material risk in test/gui-browser.md. Capture references are real files; mocks or unrun commands do not count as browser evidence.
- Depends on: T063. Commit message: `Verify all final screens against the running integration`.

##### GUI verification list for T064

The following checks are mandatory execution work, not completed browser observations. Common chrome applies to every screen that uses it. Each entry gives reach steps followed by visible elements in drawing order. Check each item in English and Spanish using the literal copy in its owning task.
Use a temporary M1ND with the board's sample data. Paths, timestamps, counts and client versions are fixture data; real product values are dynamic. Mask generated pairing credentials in every stored capture and report.

Desktop common chrome: viewport 1440 by 900; top bar 52 pixels, workspace 818 pixels, footer 30 pixels. The bar contains the mark, HIVEM1ND, Map/Blueprint/Void modes with the active mode distinguished, the + Add button with the accessible name Add to M1ND, the Waiting pill when its active count is positive, Open on the phone, Notifications and Settings. Horizontal workspace padding and panel gaps are 12 pixels. Modern panels have a 20-pixel radius and panel fill; quiet borders use line. The footer contains the service shape and text, last read, and machine timestamps.
Common Map: Hierarchy/Chats tabs, search, My groups, Chain of command, Without an Overlord and Services; free unit circles, role icons, status shapes, names and lead lines; three drag hints; Zoom in, Zoom out, Fit and 100%; Incubator and Genesis controls; inspector. Map columns are 266, 760 and 366 pixels.
Common editor: shared library 228 pixels, canvas 796 pixels, comments or History 368 pixels. The toolbar is centered 14 pixels below the canvas top. Every icon control has a name. Nocturne uses its quiet palette and ruled layout; family looks use Modern layout.

###### Row 1: setup and first run

- **1.1 Install:** open setup without a configured M1ND. Brand at x32/y26; centered 640-pixel card; four progress markers and Step 1 of 4; Install HIVEM1ND; Setup takes about a minute.; graph icon and Control the Swarm from the Map; hierarchy icon and Organize agents to reach objectives faster and better; ray icon and Relay is used for inter-session communication; Start setup. No Back control.
- **1.2 Where the M1ND lives:** continue with a detected 2.x tree. Step 2 of 4; title and two-sentence M1ND/cloud-folder explanation; Folder label, default Cosmic/.m1nd path and Change; checked Migrate legacy M1ND, detected source and copied/original-untouched explanation; disabled Use Relay+, Coming soon and Nebula+ description; Back and Continue. No synchronization, origin or mode picker.
- **1.3 Join an existing M1ND:** choose a populated 3.0 fixture folder. Step 2 of 4; Folder, selected path and Change; checked Join this M1ND; actual unit count, last machine/time and nothing-replaced explanation; Relay+ notice; Back and Join. Verify that joining changes only approved joining-machine records.
- **1.4 Close 2.x sessions:** continue migration with owned local sessions and an offline remote legacy session. Location screen under scrim; 560-pixel dialog; Close HIVEM1ND 2.x first; saved-work and shutdown explanation; three rows with unit, client and machine; offline closure on next start note; Cancel and Close them and migrate. Cancel writes nothing.
- **1.5 Relay service:** confirm migration. Step 3 of 4; Starting the Relay service and lifetime description; five progress rows in T006 order; completed check circles and elapsed times; current spinner and time; pending ring; Installing busy control. No Back control.
- **1.6 A step failed:** inject a service port conflict. Retain Step 3, its title, description and completed rows; Starting the service has an error marker and 30 s; Opening the Map remains pending; notice names actual port cause, unchanged scope and reopen/resume behavior; Retry. Reopen and verify that completed copy/configuration phases do not repeat.
- **1.7 Ready:** finish startup. Step 4 of 4; HIVEM1ND is running; actual machine and same-folder instruction; summary rows M1ND/path, Legacy M1ND/original untouched when migrated, Service/status shape/Running, Agents/client list, Projects/repository and folder counts; detected-defaults/Settings note; Open the Map. No Back control.
- **1.8 Opening:** delay the initial read. Common desktop frame; left skeletons 200 by 30 and 230 by 34, followed by widths 150/190/120/170/140/180/110; centered 28-pixel spinner, Reading the M1ND and last-known counts; right skeletons 220 by 38 and 300 by 70, followed by widths 260/200/240 with height 44; footer Connecting to the service and Reading.
- **1.9 The M1ND cannot be read:** delay the folder read for 30 seconds. Retain frame and skeleton panels; centered 52-pixel error circle with 24-pixel alert; The M1ND cannot be read; actual selected folder, timeout and offline/held-folder explanation; Retry and Choose another folder; footer M1ND not read. No credential appears in the cause.
- **1.10 An empty M1ND:** load only root master. Hierarchy/Chats and search; No units yet and Overseer-first explanation; 40-pixel You circle; no lead lines or groups; dashed 64-pixel Overseer placeholder centered at x372/y178 and The Overseer goes here; inspector Your M1ND is empty, coordination explanation and Create the Overseer. Waiting pill is absent. Create once and select root:overseer.

###### Row 2: the Map

- **2.1 Map:** open the populated fixture with nothing selected. Common Map; My groups/API work folder/count; Chain of command, loose projects and Services; empty inspector with 56-pixel Map icon, title and selection explanation, working/asks/unread/groups summaries and New unit. Each node retains its position and reporting line.
- **2.2 A unit selected:** click executor-shop. Selected circle and connected lines; inspector avatar/name/status; Machine/Runs in/Model/Reports to facts; Pin and More; history messages; build ask with Approve/Always for this unit/Deny; delivered task with Accept/Send back/Open task; composer/Send and immediate-session-notification hint. Double click its Hierarchy row to center the same unit.
- **2.3 Rename:** select executor-blog, then use F 2 or More/Rename. Inline Blog input, caret/check, original unit name and alias explanation; Map and inspector retain the saved identity until confirmation. Enter saves and Escape cancels. Double click continues to center the unit.
- **2.4 Renamed:** save Blog. Hierarchy, Map, inspector and chat header show alias plus original unit name; No session; LAPTOP, manual-app Runs in, Mailbox and Reports to facts; existing messages; Message Blog composer; alias notice and Undo. Undo restores the previous alias with a revision check.
- **2.5 Connect:** drag overlord-web onto executor-site. Preview line and connection hint; 480-pixel dialog over scrim; Connect executor-site; reports-to explanation; source/target roles and names; Cancel and Connect. Personal groups and their chats retain membership.
- **2.6 Connected:** confirm the connection while delaying persistence. New line, Saving spinner beside the node and pending Reports to fact; selected executor-site facts and conversation/mailbox hint; committed confirmation and Undo. A failure shows the cause and never claims the change committed.
- **2.7 A selection:** drag on empty Map space around three units; use Shift to add one. Filled dashed marquee; three selected accent circles; inspector 3 selected and gesture hint; unit rows with name/alias/id/status; Save as group, Message all 3, Connect to a lead and Clear selection; personal-group explanation. The marquee adds canonical units once.
- **2.8 New group:** press Save as group. Retain the selection below scrim; 520-pixel dialog; New group and explanation; Name; Members with removable chips and Add; Cancel and Create group. Changing members does not change reporting relationships.
- **2.9 A group:** create the selected group. Expanded Hierarchy folder and member rows; dashed rounded zone and top-edge title; selected inspector title, Group/3 units, avatars and More; Members and Created facts; four participant reply bubbles; Message the group and Every member sees every reply; created notice and Undo. Folder, zone and chat select the same group.
- **2.10 Delete a group:** choose its More/Delete. Scrim and 480-pixel dialog; Delete the group {title}?; explanation names folder/zone removal, chat archive and retained units/direct chats/leads; Cancel and Delete group. Successful removal has Undo; linked conversation remains readable under Archived.
- **2.11 New unit:** press New unit and open Machine. Scrim and 560-pixel dialog; Name/Role, Project/Machine, Reports to/Group; current machine selected; offline LAPTOP disabled with offline-since reason; Cancel and Create unit. An offline choice cannot be submitted indirectly.
- **2.12 Creating:** submit valid unit fields while delaying creation. Form and typed values remain; fields disabled during the operation; Cancel and Creating spinner. Failure restores editing, retains every typed value and names the cause.
- **2.13 Created:** finish creation. Selected executor-mobile circle and increased project count; inspector name/No session; Machine, Runs in/Not started, Model/default and Reports to/No Overlord; No messages yet, mailbox explanation and Start session; composer; created notice and Start a session action.
- **2.14 Start a session:** press Start session. 520-pixel dialog; connected command-line choices and availability; configuration-needed choice disabled with Settings/Agents reason; Runs as choices One task then closes selected by default and Chat kept open; Executor lifecycle explanation; Task or first message; manual-command guidance; Cancel and Start session. Client names come from the detected connected-client list.
- **2.15 Starting:** delay the start result. Unit has a 60-pixel spinner and Starting a session status; progress Request sent, Starting the selected client on its machine, Session connected; Cancel start; composer and queued-delivery hint. Cancel reconciles any already-spawned process before reporting closure.
- **2.16 It did not start:** inject a verified start failure after 30 seconds. Request sent is complete, starting has an error, Session connected is pending; safe actual cause; Retry and Choose another client; unit and conversation retained. An uncertain spawn retains the operation ID for reconciliation.
- **2.17 Stop a session:** choose Stop for a live unit. Scrim and 480-pixel dialog; Stop the session of {unit}?; explanation names stopped work and retained unit/chat/mailbox/tasks/groups; Cancel and Stop session. Stopped appears only after verified native acknowledgment.
- **2.18 Remove a unit:** choose More/Remove for executor-mobile. Scrim and 480-pixel dialog; Remove {unit}?; explanation names Map/Hierarchy removal, archived chat/mailbox, retained tasks and session stop first; Cancel and Remove unit. After commit, Undo restores visibility; repository/task bytes remain identical.

- **2.19 Add to M1ND:** press + Add in the Map bar, or Content/Add. Retain the underlying mode, selection and unsaved drafts. Scrim and one 600-pixel dialog, padding 24/gap 18/radius 22/panel/line2; Add to M1ND; link-or-registry/drop-folder instruction; focused Link field in monospace 13 with padding 11x13/radius 12/card/accent line; Found in the actual source and pinned commit/version; separate pdf, docx and acme-files rows in the mixed fixture. Rows use padding 10x12/gap 12/radius 12; 18-pixel ticks; pdf checked with card2/accent, docx unchecked, acme-files disabled with Reads and writes cloud files, Tool server and the accessible Available after 3.0 reason. Cancel and Continue. Paste/drop inspection shows progress and ends at 30 s with safe cause/Retry; no imported content, project or client configuration is written before acceptance. Repeat from Blueprint, Void, Settings and 6.8; each opens this same window and preserves the invoker and underlying drafts. Verify dropped chunks privately with fixture sources; never show a credential or file body in a capture.
- **2.20 Check and who uses it:** select only pdf and press Continue. The same 600-pixel window has Add pdf and its actual Skill/source/no-copy-before-confirmation explanation. The check precedes scope choices: Pinned to commit/full accepted identity represented by the short commit display and updates wait for your yes; actual MIT license; Older than 7 days, no install scripts; Its scripts run Python and only in the units below. Three 12-pixel filled accent marks and the 12-pixel thick waiting ring distinguish the runtime caution; check container padding 12x14/gap 8/radius 14/card; text 13.5 and notes 12/mute. Who can use it follows: Every unit unchecked, Checkout launch selected with Group, 3 units, adjutant selected; four deduplicated actual units. Choices use 18-pixel ticks, padding 10x12/gap 12/radius 12, selected card2/accent. Back retains choices without accepting; Add pdf is the only placement control and displays a spinner while busy. Missing license/date/runtime evidence, younger-than-seven-days source and stale scope disable acceptance and name the reason. Verify docs/repository and multiple selected parts show their own check/scope, tool selection is impossible, full registry version is retained, and a reviewed update keeps the prior pin active until confirmation.
- **2.21 A skill in Content:** confirm the eligible pdf check for the selected group and adjutant. Open Settings/Content in the current machine context. Retain common bar with + Add, five Settings tabs, all existing Features/Knowledge packs/Preferences and the Features/Add action. The added checked pdf row sits beside kit content with padding 9x12/gap 10/radius 10/card2/accent line, pdf at 13/700, from acme/agent-skills, 4 units at 12.5/accent, and Remove. The toast reads pdf added for 4 units and Undo; count derives from current canonical scope. Remove asks with the actual name, imported-content/access removal, retained kit/source files and ten-second Undo; Cancel changes nothing and successful Undo restores the same owned bytes/scope. Verify docs appear as a knowledge pack with origin/Remove, accepted content survives reopen/sync, selected sessions receive it and unselected sessions do not, and no global client skills root changes. The origin control has the accessible name Check for updates: pdf and opens the same check; it does not replace content until accepted.
- **2.22 A repository on the Map:** accept the eligible landing-site repository fixture. Retain the existing units, lead lines, groups and chats. Hierarchy includes landing-site under Without an Overlord with the new badge; Map has its separate project circle at fixture x320/y575, diameter 46, grid icon and zero count, with no fabricated Unit or Overlord. Select it: 366-pixel inspector with grid/title landing-site and Project from github.com/acme/landing-site; centered body padding 32/gap 12; No units yet at 16/700; actual pinned-commit/first-unit instruction at 13.5/mute/center; New unit in landing-site. Toast landing-site added has New unit. That action opens the existing unit form with this project selected and no Overlord, without submitting it. Reopen keeps the actual project registration, origin, pin and layout.groups project anchor; group/lead gestures cannot turn the project circle into a unit. Remove/unregister and Undo preserve the repository/source checkout byte inventory.

###### Row 3: chats and Waiting

- **3.1 A chat:** select Chats, then the pinned executor conversation. Pinned/Recent lists with timestamps, unread counts and group preview; selected conversation in inspector; unit facts, history, ask/review cards and composer. Archived is reachable after group or unit deletion.
- **3.2 Sending:** submit a message while its POST is pending. Own bubble appears immediately with You, now, body and Sending/spinner; composer clears for the next draft. A second send has an independent operation and cannot replace the first pending bubble.
- **3.3 The agent is working:** acknowledge submission and emit actual busy activity. Own line has Delivered and time; working bubble has three dots, unit, elapsed time and Stop. Stop ends verified work and retains the conversation.
- **3.4 Asks to open a session:** request a child command line from an Executor chat. Working state and Stop remain; Asks to open a session card names the connected client and machine; Approve and Deny; active Waiting count increments. Approve permits one child spawn; Deny permits none.
- **3.5 The reply:** record the recipient's explicit read and reply. Read/time replaces Delivered on the own line; incoming reply has author, time and body. A viewport observation or an unrelated reply alone cannot manufacture a read receipt.
- **3.6 Not confirmed:** lose a send acknowledgment for 10 seconds. Own bubble remains; alert, Not confirmed: the service did not answer in 10 s. and Retry; composer hint states that the same message is sent once; later draft remains. Retry uses the retained key and leaves one persisted message.
- **3.7 Mailbox:** select offline Blog running manually in a desktop app. Alias and original unit name; No session; LAPTOP, manual-app Runs in, Mailbox unread count and Reports to; Blog is not running; offline-since and delivery-on-start explanation; disabled Start session with Needs LAPTOP online; retained messages, composer and mailbox hint.
- **3.8 Waiting on you:** press the Waiting pill. Back to Hierarchy, title, active count and search; Asks with build request/unit/time; Reviews with task/unit/time; Ended without an answer with expired push/unit/time/Expired; selected unit remains on Map with inspector cards. Expired items do not increase the active pill count.
- **3.9 Answer sent:** approve an ask while delaying its owner's acknowledgment. Card shows Answer sent/spinner and waiting-for-confirmation explanation; review card remains. Settled answer appears only after owner confirmation; Always permission is not granted prematurely.
- **3.10 Send back:** choose Send back on a review. Scrim and 480-pixel dialog; Send task {number} back; open-status/unit-note explanation; What needs to change field; Cancel and Send back. Empty notes are refused and typed drafts remain after failure.
- **3.11 Accepted:** accept a reviewable delivery. Approved build summary and Accepted task summary; unit idle and task done; Waiting pill disappears when its active count reaches zero; Task accepted notice and Undo. Undo through the existing task-status operation retains report history.

###### Row 4: Blueprint

- **4.1 A board:** open Blueprint and select an editable board without attachments. Boards library; Filters, New folder, New board; Search boards; project folders/counts/items; board artboards; toolbar Select, Frame, Text, Draw, Comment; No agents attached; Attach agents; Comments/title; No comments yet and C shortcut explanation; comment composer/Send; disabled unchecked Send to agent/No agents attached.
- **4.2 Board menu:** open an item's More control. Selected item remains selected; menu Rename, Duplicate, Move to folder/submenu indicator, separator, Delete in error color. Folder menus expose Rename/Delete and folder chevrons collapse children.
- **4.3 New board:** press New board. Scrim and 560-pixel dialog; title/repository explanation; Name and Project side by side; repository hint; Folder; Empty board selected; Duplicate a board/comment exclusion description; Import a Blueprint Lite 2.x board/module preservation description; Cancel/Create board. Empty produces one frame; duplicate/import preserves real selected content.
- **4.4 Search and filters:** search cart, enable Open comments, open Filters. Query/clear control; removable Open comments chip; matching shop/site folders open; matching item rows/comment counts; menu Open comments checked, Attached agents, Changed this week, separator, Project: all. Search also finds screen/node text and comments in folded folders.
- **4.5 Move to another project:** choose Move to folder with destination api. Scrim/480 dialog; Move {board} to api?; explanation names source/destination repositories and physical file movement; Cancel/Move to api. After commit document/sidecars/binding/history/assets are in destination, source deletion is staged, and Undo restores the bundle.
- **4.6 Delete a board:** choose Delete. Specific board title; screens/sketches/comments included; attached agents informed; previously committed repository history retained; Cancel/Delete board. Successful deletion shows Undo for ten seconds; no automatic git commit.
- **4.7 Edit the board:** select the sample button. Accent outline; four 9-pixel visible corner handles with 32-pixel targets; element bar Button, 160 × 40, divider, Fill swatch/action, Continue shopping text, More. Drag, resize, text and fill changes persist under revision; correct parent coordinates and known styles render on reload.
- **4.8 Sketch by hand:** choose Draw and draw beside a screen. Select/Frame/Text/Draw selected/Comment; three text/accent/wait ink swatches; Pen selected, Marker, Eraser; attached-unit chips; existing screen; Sketch title; 300 × 560 dashed frame; 270 × 500 normalized strokes; brush marker. Sketch is in the same board JSON and survives Lite read/write.
- **4.9 Attach agents:** press Attach agents. 300-pixel picker; Search units and groups; checkbox/icon/name rows for individual units and group; current selection and Attach count; Cancel/Attach 2 in the sample. Group selection expands canonical unique members; no attachment change before confirmation.
- **4.10 Comment:** select an element and press C. Selected border and numbered pin; 320-pixel popover; screen/element breadcrumb; draft field; checked Send to agent; attached recipients; Cancel/Comment. A complete anchor is required.
- **4.11 Comment sent:** submit. Numbered pin; author/time/body; recipient delivery line; agent work dots/name/detail; reply composer with persisted checkbox. False sends keep the note without a recipient wake.
- **4.12 Watch:** enable Watch and make an attached unit commit a drawing. Watching selected; shape preview with dashed border; unit cursor/name; numbered pin; reply author/time/Live and reply body; composer. Pan/focus follows the actual committed resource; Watch off stops automatic following.
- **4.13 Changed while editing:** retain local edit, receive an overlapping agent change and turn Send to agent off. Conflict banner names the unit; Show changes/Keep mine/Reload; unchecked checkbox/Kept as a note, not sent. Show changes compares both; either answer preserves both snapshots before replacing the chosen document.
- **4.14 History:** open History after creation, comment, agent drawing and conflict resolution. Board remains visible; History button selected; History/title panel; newest-first version rows with author/time/action; Current on current version; Restore on older versions; retention explanation. Restore and restore-back preserve the replaced current bytes.

###### Row 5: Void

- **5.1 Document:** open Void/select text. Texts library; Filters/New folder/New text/Search texts; Release/Manuals/Drafts folders/counts/items; toolbar Attached unit, Watch, divider, Find and replace, Source, Focus, divider, Saved; document title/subtitle/body/headings; Comments/title/empty passage-selection explanation; reply composer/Send to agent. The shared History action is available for texts as required by 4.14's note.
- **5.2 Rename and folders:** begin inline text rename and create a folder. Editable name/caret; surrounding folder counts; new folder already named and editable; selected document remains in place; Enter saves, Escape cancels; no separate editor flow.
- **5.3 Delete a text:** delete a text or populated folder. Scrim/specific title; text/comments included; folder confirmation gives its text count; ten-second Undo explanation; Cancel/Delete text or Delete folder. Undo restores every included resource and history.
- **5.4 Editing:** select a passage and type in Document. Selection/caret visible; Saving; floating format bar only while selection exists: Bold, Italic, Strikethrough, divider, H1, H2, H3, divider, List, Quote, Code, Link, Table, Image, Comment. Saving continues without a separate Send/Save form and preserves later typing.
- **5.5 Not saved:** make the M1ND/repository unavailable during save. Toolbar Not saved/error icon; failure banner gives folder cause and says text stays; Retry; exact latest draft remains visible. Retry settles the retained request once, then saves later queued typing.
- **5.6 Find and replace:** open Find. Find field/query/current and total count; Aa/Match case, W/Whole word, .* /Regular expression; replacement field; Replace/Replace all count; This document/All texts; one-Undo explanation; all hits highlighted, current hit distinct. Verify whole-batch Undo across multiple texts and invalid/slow regex feedback.
- **5.7 Source:** toggle Source with caret in edited content. Source selected; exact Markdown heading/emphasis/paragraph strings in monospace; caret at the equivalent source position; caret-preservation explanation. Toggle back retains resource, page, language, selection and draft.
- **5.8 A suggested change:** receive a current proposal. Highlighted proposed passage; person comment and agent reply; Accept change/Edit/Discard. Edit changes the replacement only; accept validates original base/expected source and both revisions.
- **5.9 An old suggestion:** change the proposal's base passage before accept. Current text remains; stale warning/icon/title; explanation that nothing was applied; Edit passage/Ask again/Discard. Stale request never silently rebases or writes.
- **5.10 Focus:** enter Focus. Pure black; 640-pixel text at top 120; quiet navigation/mouse/Escape hints; title/body/caret; no normal panels or bar. Arrows change pages while retaining the same resource/draft.
- **5.11 Focus, tools shown:** move pointer in Focus. Black and text remain; top tools Document, Page 1of 3, attached unit, Watch; page dots at bottom; Escape/Document returns with same caret/page/draft and focus restored.

###### Row 6: Settings and the service

- **6.1 Settings:** press gear. Title; tabs General, Agents, Permissions, Projects, Content; selected-machine picker. Left: Look previews Modern, Nocturne, Nebula then Waves, Toxic, Kinetic in own palettes/selected marker; immediate-choice note; Language English/Español; Phone on the home network description, current expiry/phone count, Close access, Open on the phone. Right: Relay service State, Version, Started, unchecked Start with Windows/Off, Restart service; Relay+/Coming soon/description; Locations actual M1ND/Staging paths. No Sync/Change origin section.
- **6.2 Agents:** select Agents. Agents on selected machine/scan time/Scan again; columns Agent, Command line(CLI): runs your units, Desktop app: optional. Rows in sample order Claude Code, Codex, Cursor, OpenCode, GitHub Copilot; actual CLI versions; Connected/Auto/On demand or changes-needed/Review changes; optional app connections named by client/app; missing client/Find manually. Explanations cover CLI lifecycle, optional app and manual command sessions. Mode/app actions open review before mutation.
- **6.3 Connect an agent:** press Review changes for sample Cursor CLI. 600-pixel dialog; Connect the Cursor CLI; no-write-before-Apply/Copy explanation; checked Relay server/mcp.json and hooks/hooks.json changes; Optional permission; unchecked scoped git commit/git push/cli-config.json change; explicit-request note; kept-copy/Disconnect note; restart note; Cancel/Copy changes/Apply 2 changes. Copy/Cancel preserve every client file byte.
- **6.4 Another machine:** open picker. 320-pixel menu/current machine/check; second machine/laptop/offline-since/latest-report-read-only explanation. Select offline machine; machine-owned Agents/Permissions/Projects/Locations change to its report and all mutation controls are disabled with the reason.
- **6.5 Permissions:** select Permissions. Standing approvals: unit, exact command, grant time, Revoke for each; Always for this unit explanation. Agent permissions: client, scoped git commit/git push, time, Revoke; machine/owned-session/explicit-instruction explanation. Revoke only named authority and verify next request asks again.
- **6.6 Projects:** select Projects. Project folders/title/detected counts; three sample roots; folder icon/path/optional Environment chip or No environment/More; repository chips/name/named remove control; Add folder; auto-discovery/removal explanation. Actual counts come from selected-machine report.
- **6.7 Remove a repository:** select sample shop removal. Scrim; Remove shop from the M1ND?; its units/boards/texts stop showing; repository/files untouched/readding restores explanation; Cancel/Remove repository. Successful unregister offers ten-second Undo; full repository hash remains identical.
- **6.8 Content:** select Content. The Features heading includes Add with a plus icon; it opens the same Add to M1ND window as the shared bar, preserving the selected tab/machine and preferences. Features columns Planning:Plan/Brainstorm/Task; Quality:QA/Tribunal/Cyberattack; Continuity:Relay/Catchup/Docs with inclusion states. Knowledge packs:Security/Design/Copy/Coding. Preferences:Address style/Impersonal/Formal/Explanatory; Additional instructions; Keep existing preferences first/On; Check for updates/Daily. Existing preference content survives; configuration writes use review.
- **6.9 Open on the phone:** press Open on the phone. 600-pixel dialog/title/same-network instruction; real black/white QR with quiet zone; Or type this code with generated six characters masked in captures; At/actual LAN origin; expiry; replacement/sign-out note; Close access/Done. Decode real QR privately; replacement/close clears old secret DOM/memory.
- **6.10 Reconnecting:** interrupt response while composing/sending. Selected Map/chat retained; reconnect banner/spinner/retained-work explanation/Retry now; own line Waiting for the service; footer reconnecting/last read. Recovery reconciles the same operation, not a second send.
- **6.11 Service stopped:** stop the owned fixture runtime. Map retained; stopped banner names machine; Details/Restart service; inspector summary; stopped service footer/last read. Restart uses verified launcher, not a dead HTTP port; no duplicate singleton.
- **6.12 Taking longer:** delay a non-send request for 12 seconds. Retained own line/composer; Taking longer than usual/spinner/elapsed explanation/30-second limit/Cancel. At 30 seconds waiting ends, Retry appears and retained operation is unchanged. Ordinary sends already stop waiting after 10 seconds.

###### Row 7: the phone

- **7.1 Pair:** open LAN shell without credential and enter code. 390 × 844; 44-pixel status/brand; mark 56; Open your M1ND; computer Settings/Open on the phone instruction; six 40 × 50 cells, gap 8, radius 12; filled accent/empty quiet lines; QR-camera note; Opening spinner during exchange. No password or code stored.
- **7.2 Wrong code:** submit one wrong code. Same six cells/error lines; alert/That code does not match.; computer-check/retry/4 tries left explanation; Try again. Next attempts show 3, 2, 1 from server details, not browser guesses.
- **7.3 Pairing locked:** submit fifth wrong code. 64-pixel error circle/alert 28; Pairing locked; five-failure/10-minute/new-code-unlocks explanation; no submit. Same-peer correct old code and QR fail until deadline; replacement desktop grant unlocks at once.
- **7.4 Hierarchy:** authenticate/open Hierarchy. 52-pixel title/mark/waiting count; full chain/indentation/icons/shaped statuses/sample ask count; Without an Overlord/data/mobile; Home network/access-expiry row; bottom Hierarchy/Chats/Waiting navigation. No editing/session/settings control.
- **7.5 A chat:** open existing executor chat. Unit header; incoming delivery message; Asks to run/build command/Approve/Deny only; delivered review/Accept/Send back; computer-required standing/push guidance; outgoing reply; composer/Send. Wider viewport still cannot add Always or other authority.
- **7.6 Waiting:** press Waiting. Title/count; Asks/unit/time/request/Approve/Deny; Reviews/unit/time/task/Accept/Send back; bottom navigation. Push asks remain readable with computer-required guidance and no answer button; ordinary session-open asks have Approve/Deny; direct forged API writes are rejected.
- **7.7 Access ended:** advance 12 hours or close access on computer. Authenticated data cleared; 64-pixel quiet wifi circle; Access ended; 12-hour/computer-reopen instruction; Type a new code. Credential/session/source fragments are removed and never logged.

## Verified survey corrections and additional integration findings

These findings refer to the candidate code, not the proposed tasks.

 1. Section 3's `1.3,1.4 Join an existing M1ND, close 2.x sessions: MISSING` is **PARTIAL**. `engine/setup.mjs:922` already checks attachment eligibility; `:941` selects the existing folder; `:970` excludes kit/version/preferences replacement during attachment. Shared routes are still rewritten at `:1001`; explicit 3.0 Join presentation and close 2.x/copy behavior are missing. T004 handles the difference.
 2. Section 3's `1.6,1.9 Failed step with resume, unreadable M1ND: MISSING` is **PARTIAL**. `engine/setup.mjs:163` resumes a saved draft; `:639` retains service failure; `:679` retries only service; `:700` resumes installed configuration. `test/service-install.test.mjs:31`, `the real wizard retries only service startup and opens its authenticated viewer`, verifies unchanged installed-rule mtime/no repeated registration. Four-step progress/cause copy and 30-second unreadable-folder presentation remain missing.
 3. Section 3's `4.14 History with Restore: MISSING` is **PARTIAL** for its combined editor scope. Void already persists original and version sidecars from `engine/service/editors.mjs:1257`, `:1300`, `:1354`, `:1361`, `:1436`, `:1693`. Blueprint complete snapshots, author-complete text History, list/Restore and conflict answer preservation remain missing. Existing text deltas are reused, not replaced by a second editor.
 4. Section 3's `2.x Map, connect, select, new unit, sessions, inspector: DONE` is **PARTIAL** against the final board. Reusable Map gestures and revision operations exist in `gui/app/map.mjs`; `gui/app/main.mjs:3342` lacks the final optional personal Group field and `:3425` lacks task/chat CLI mode; `gui/app/inspector.mjs:5` shows Client/role/job/scope rather than the final Runs in/alias-aware inspector. The separate missing-feature rows remain correct; this broad DONE row must not be treated as final visual acceptance.

The section 3 classifications for groups, alias, unit removal, shared library, send preference, 30-second limit and phone restrictions are corroborated by the route/validator/renderer audits. They are not assumed from the survey alone.
The following defects refine PARTIAL rows without inventing another work package:

- `gui/app/main.mjs:2256` imports a legacy board through starterBoard instead of real content. Its Empty path also creates two starter pages/screens, where 4.3 specifies one frame. T029/T030 replace those paths.
- Real assets use `assets/<UUID>.<extension>` and complete filename ID in `engine/service/editors.mjs:789`; GUI ASSET_SRC in `gui/app/blueprint.mjs:190` and its fixture use a docs prefix and extension-less ID. T032 aligns both with real core.
- `gui/app/void.mjs:97` deliberately omits server rev/history, while `engine/service/editors.mjs:1300` checks unknown-field retention before restoring them. The fixture accepts that save and masks the real-core rejection. T041 fixes it.
- `gui/app/blueprint.mjs:348` fails to scale normalized vectors; `:329` omits text size; rectangle/clip radius is omitted. T031/T035 cover those retained known styles.
- `engine/service/store.mjs:391` supports writes only and converts nullbytes to an empty file; editor sync staging skips no-byte entries. A delete must add real journal/tombstone behavior. Catalog authorization must retain the source pre-change allowlist while a move deletes its old identity. T028 owns this design.
- `scripts/build-installer.mjs:425` requires registration.json to recognize ownership, which conflicts with logon-off default. T005 removes that requirement without weakening ownership checks.
- `engine/relay/config.mjs:449` already keeps a backup and has pure previewable configuration transforms at `:310`; disconnect currently removes entries instead of restoring the kept copy. T052 adapts the existing implementation.
- Current GUI/core text stripping differ: `gui/app/markup.mjs:1` retains line separators after removing only b/i; `features/void/text.mjs:10` normalizes paragraph gaps. Markdown and caret/anchor behavior require one explicit compatible mapping, covered by T045.

## Risks and release gates

- P13 acquisition reads untrusted repositories, registry archives and folder uploads. Immutable hash/date/license/runtime evidence must be bound before acceptance; archive paths and network redirects cannot escape the named staging/transport limits. A source check does not certify the instructions as safe.
- Existing global client skill installation cannot enforce P13 unit/group selection. Availability must use verified scoped adapter bindings or report scope_unavailable; generic kit evolve must not install or prune imported content globally.
- Repository checkout publication is outside the ordinary M1ND journal. Its owned local recovery record and later project registration must prevent partial visibility and preserve checkout/source bytes through Remove and Undo.

- Legacy sessions may still have remote or uncertain ownership. Migration cannot claim shutdown from registry presence alone; offline closure must precede 3.0wake adoption. Original trees remain byte-identical.
- Joining currently rewrites shared routes and drafts inside the selected M1ND. The checkpoint/join change must preserve all shared records outside the explicitly reviewed machine write.
- Deletions and cross-repository moves span content, catalog, bindings, history, assets and sync authorization. Nullbytes is not deletion; source tombstones must remain eligible after catalog removal and recover as one transaction.
- Resource IDs derive from project/path. Cross-project movement necessarily remaps the identity and its derived bindings/notices/Watch; moving only metadata is insufficient.
- Full snapshots can exceed the 16 MBobject cap if document/comments are combined. Keep immutable document/comment objects separately from history metadata, with hashes and bounded pages; never truncate history or append full snapshots indefinitely to one JSONL file.
- A timed-out send/start/save may already have committed. Retried operations and launch reconciliation must retain identity and avoid duplicate writes, wakes or child processes.
- In-place editing introduces source/plain/DOM coordinate differences, UTF-16 boundaries, newline normalization and save-generation races. Current fixture behavior masks two real-core editor incompatibilities; actual integration gates are mandatory.
- Client previews may contain secret-bearing existing configuration. Only redacted proposed owned text leaves the owner process; kept copies are protected locally and are not synced. Disconnect must preserve later foreign edits.
- A stopped HTTP service cannot restart itself from its dead port. Host/browser recovery availability is an explicit JUDGMENT decision and verified launcher gate; adding a fake success route does not complete 6.11.
- Phone authority changes an existing contract exception. Rejection must happen before idempotency receipt replay; push classification is trusted structured data, not copy-string inspection.
- Muted theme text can fail contrast on card2 and alpha fills even when it passes on the main background. All six actual palette/surface pairs, Focus hints and disabled states require measurement.
- The baseline package build failed at npm-cache permissions. A successful package/build remains an execution gate; no packaging success is claimed by syntax checks or lint.
- The Windows directory-permission fixture is skipped in both baseline suites. The skip is reported; stronger permission behavior must be verified on the supported platform with suitable privileges during release QA.
- Native connected-client behavior, actual optional startup registration, phone LAN binding and cross-machine operation must be observed on supported runtime platforms before release. Future live-machine deployment is outside this document-writing authorization.

## JUDGMENT tasks retained by the planner

- T004: safe checkpoint phases, join preservation, verified legacy shutdown and offline closure before adoption.
- T005: existing runtime/host leases and ownership recognition without a logon record.
- T006: four-step descriptors, terminal compatibility, progress/failure rendering and final bilingual setup copy.
- T007: immediate desktop frame, first-run Overseer creation and safe choose-folder handoff.
- T009: finite visible-copy extraction and neutral Spanish enforcement without changing user content or technical paths.
- T014: atomic group/chat transactions, archive visibility and generic ten-second Undo.
- T016: personal zone/folder/chat selection, overlap hit behavior, alias editing/Undo and keyboard focus.
- T017: acknowledged session stop followed by recoverable unit archive and dependent-lead validation.
- T022: genuine one-task completion/chat lifetime and once-only child CLI approval consumption.
- T024: recipient receipt aggregation, independent optimistic drafts and uncertain/reconnected operation settlement.
- T028: true journaled deletion, pre/post catalog authorization, physical moves, identity remap and bundle Undo.
- T029: shared library/folder/filter component and focus-safe management confirmations.
- T030: registered trusted legacy exporter, normalization and catalog/index conversion without source mutation.
- T035: parent-space gesture geometry, known rendering styles, marker/eraser semantics and in-place board tools.
- T036: bounded complete History metadata/objects, author provenance, conflict copies and reversible Restore.
- T040: shared checkbox preference conflict handling and immutable choice on a pending comment.
- T045: lossless Markdown/legacy representation, source/plain/newline mapping, in-place selection and Focus caret.
- T046: bounded regex execution, capture substitution, all-text source ranges and one atomic whole-replace Undo.
- T047: editable suggestion draft with unchanged original base/expected source and explicit stale actions.
- T051: sanitized machine reports and authenticated selected-owner request/result routing.
- T052: exact configuration preview binding, kept-copy restoration, foreign-edit handling and reviewed reload.
- T053: session-scoped git permissions, revocation and trusted desktop-only approval classification.
- T054: repository visibility/exclusions/readd/Undo and shared Content preview/apply reuse.
- T055: five-tab/machine-aware Settings layout, review dialogs, own-palette previews and focus restoration.
- T056: verified same-user recovery bridge for a stopped service and safe draft/credential replacement.
- T059: accessible code input, server-derived lock state, restricted phone cards and expiry cleanup.
- T062: measured palette/fill corrections, target geometry and complete keyboard/live-region behavior.
- T064: reproducible actual-core scenarios, 87 screen captures and the final observed acceptance decision.
- T068: immutable source/provider resolution, bounded extraction/uploads, credible date/license/runtime evidence and owner-bound preview/retry retention.
- T069: recoverable checkout/content acceptance, session-scoped availability, ownership-preserving updates/removal and accepted bundle sync.
- T072: shared modal lifecycle/focus, uncertain-operation reconciliation and zero-unit project Map/Hierarchy integration.
