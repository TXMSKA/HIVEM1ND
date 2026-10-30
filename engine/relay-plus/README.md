# Relay+ Beta client

The client targets Quantum contract `1.0.0-beta.1`, commit `1513657`.
`onem1nd/relay-plus` exports the account, keys, messages, transport and feed clients.
The desktop screens retain the approved Coming soon card.

## Local service and CLI

`POST /api/v1/relay-plus` requires a desktop credential with `home.manage` and a
UUID `Idempotency-Key`. Its results are cached in memory, never in synced mutation
receipts. Supported actions are `sign-in`, `status`, `sign-out`, `create-key`,
`recover`, `request-approval`, `inbox`, `outbox`, `inspect`, `approve`, `accept`,
`publish`, `delivered` and `read`. Token material is never returned by this route.

The CLI exposes the account and approval actions through `onem1nd relay-plus`.
`sign-in` prints the Cosmic authorization URL; the service owns the PKCE callback.
`recover` reads its phrase from standard input, never an argument. Approval uses
`--device-id`, `--message-id` and `--fingerprint`; compare the fingerprint with
the one shown on the requesting machine. Inspecting does not mark a message as
delivered. Accepting marks delivery only after importing the key durably.

Machine-local service config accepts `relayPlus: {baseUrl,siteUrl,enabled,mindId}`.
`mindId` is required after sign-in: use the same unique id on every computer of
one M1ND, and different ids for different M1NDs of an account.
The API defaults to `https://quantum.txmska.com`, with Cosmic authorization at
`https://cosmic.txmska.com/authorize/`. HTTP is permitted only on loopback.
Tokens, pending approval private keys and change cursors remain in the protected
`relay-plus/` folder beneath the local service directory. Config contains no keys.

## Replication

The dataset is `hivem1nd`. Only the local computer writes its own
`writers/<computerId>/<generation>/packs/<sequence>.enc` and
`heads/<sequence>.enc`. Heads are encrypted, packs preserve the existing codec.
The next head is uploaded before older own heads are deleted; packs are retained.
Immutable retries compare existing bytes, and incompatible objects refuse with
`object_conflict`. Reads continue after `relayplus_required`; fresh bootstrap
capabilities restore publishing after renewal. A single aggregate held request
wakes replication. Cursors persist after applying changes; expired cursors rebuild
through bootstrap and full listings before the captured cursor is saved.

## Cosmic account and M1ND keys

The account content key K follows Quantum `docs/keys.md` at `1513657`.
ONEM1ND reads the signed-in account's entry in
`<Cosmic>/shared/keys/account.json` first. A missing entry requires the account's
24-word Cosmic recovery phrase and `GET /v1/keys`; the existing `phrase` envelope
uses `QNT_PBKDF2_SHA256_AES256GCM_V1` with the site's versioned binary format,
PBKDF2-SHA256 at 600,000 iterations and algorithm-name additional data.
An account without that envelope is directed to the Cosmic account site to save
its phrase. ONEM1ND never writes `phrase`, `public`, or a device envelope for K,
and never requires a Cosmic site session to recover it.

The standalone adaptation in `cosmic-keys/` ships the private Cosmic package's
store format, lock protocol and DPAPI CurrentUser helper with entropy
`cosmic-account-key-v1`. This avoids a runtime/install dependency on another
checkout or an unpublished TypeScript package. Other accounts' entry bytes are
preserved. The helper compiles through the Windows .NET compiler without
PowerShell; subprocesses use `windowsHide` and keys travel through pipes.

K is never a pack or head encryption key. HKDF-SHA256 uses empty salt and info
`cosmic/account/hivem1nd/<purpose>` for `heads` and `mind-key`.
Each M1ND retains its existing ReLAN key and key id, or creates random material
when no prior key or remote head exists. That same material is saved as the
local ReLAN key, so both transports use identical immutable pack bytes and hashes.
An incompatible existing M1ND key is refused rather than rewriting history.

Every encrypted head contains the M1ND id and its sealed key. The inner
`QNT_AES256GCM_V1` envelope binds account id, M1ND id and purpose as additional
data. The enclosing head is encrypted with the derived `heads` key and binds
account, object path and key id. New computers open heads and import the M1ND key
before creating or publishing packs. The generation namespace is the SHA-256
digest of the M1ND id; different M1NDs remain separate inside the registered layout.
No separate key object is published.

For approval, the new computer publishes a temporary X25519 public key through
a Relay+ message. The person compares its fingerprint on both computers before
the signed-in computer wraps K with
`QNT_X25519_HKDF_SHA256_AES256GCM_V1`. Its HKDF salt concatenates ephemeral and
recipient raw public keys; info is the algorithm name, and additional data binds
account, purpose, request and receiving device. Account approval also works when
the two computers use different M1NDs. The receiver authenticates the sender
and pending request, stores K in the Cosmic store, then acknowledges delivery.
Replays and mismatched fingerprints are refused.

## Verification

Unit tests use local contract fakes. `test/relay-plus-integration.test.mjs` skips
unless `RELAY_PLUS_TEST_URL` and `RELAY_PLUS_TEST_TOKEN` select an already running
disposable loopback Quantum. It refuses non-loopback targets. Throwaway server
exports, database files, account values and local proof logs belong only in
`.tmp/`, excluded from version control and Markdown lint.

The 065.1 local proof used frozen Quantum and disposable MySQL 8.4: 14 contract
checkpoints and the integration test passed, including the site's real recovery
envelope, plan-loss reads, revocation, actual 410 recovery and message expiry
without deleting packs. The exact run and cleanup are recorded in
`.tmp/fix1-local-proof-results.md`.

Actual DPAPI protection fails under this session's isolated Windows user in both
the unchanged Cosmic package and this adaptation. Consequently, bidirectional
store compatibility and the complete two-service proof with real shared stores
remain unproved. The reference conformance and cross-package tests are retained
as failing evidence; there is no plaintext fallback.

Five additional isolated-runtime checkpoints passed with explicitly injected
in-memory account stores, including approval, edits both ways, offline catch-up,
third-computer phrase recovery and plan-loss reads. That run later hit the local
server rate limit; it is not a complete passing acceptance run or a test of full
HTTP application projections. The tracked dual-transport test separately proves
actual loopback ReLAN plus Relay+ convergence with unchanged bytes and no duplicates.

Final focused account/key/runtime/service/transport/no-PowerShell checks passed
24/24; GUI checks passed 551/551. The full non-GUI run recorded 1,787 passes,
19 failures, one cancellation and five skips. Eight failures are the unavailable
DPAPI operations; one Relay+ service snapshot taken during edits passes in the
final focused run. Other failures include migration timeout, service lifecycle,
projection/MCP/media checks and Windows process/shortcut checks; that full run is
not green. See `.tmp/fix1-core.log` for the original diagnostics. Lint and the
package build passed.
