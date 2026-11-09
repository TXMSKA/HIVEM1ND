# Cosmic sign-in

## Commands

`onem1nd sign-in` is the interactive command. `--language en|es` selects the terminal text. Without it, the language follows the environment.

`--json`, and any run whose input or output is not a terminal, prints one JSON result and does not open a browser or prompt. A pending sign-in or approval keeps that single line, then holds the service connection until the listener or requester finishes.

`onem1nd relay-plus sign-in` still parses, as a hidden alias of `onem1nd sign-in`. It is absent from help and from command output.

`onem1nd relay-plus status` and `onem1nd relay-plus sign-out` stay. On a terminal they use the account-state screens. Otherwise they print JSON.

`onem1nd relay-plus unlock` reads the password from standard input when that input is not a terminal. At most one trailing line ending is removed. Spaces stay. `recover` still reads the phrase from standard input, and a terminal uses hidden input. `--password`, `--phrase` and `--fingerprint` are rejected. `approve` is not in help; the service answers `approval_retired`.

## Fixture

`test/fixtures/cosmic-keys-vectors.json` is an exact copy of Quantum `docs/keys-vectors.json` at commit `f999f553ca3f5f205231e317872f8add7108f75c`. The git blob is `48e19a657da657322ffeb88ace52fc222545cdbc`.

`test/fixtures/sign-in-board-output.json` records board `0e1a1d00-5c05-4a11-9e7a-20261108a001`. The terminal tests read that board when it is on this machine, and the fixture otherwise. `scripts/extract-sign-in-board.mjs` rewrites the fixture from the board file.

## Crypto

Password envelopes and the approval requester live in `engine/relay-plus/account-key.mjs`, `engine/relay-plus/approval.mjs` and the vendored `engine/relay-plus/cosmic-keys` store. The build does not depend on `@txmska/cosmic/signin`. That package exists only in the unpushed Cosmic-login-crypto worktree.

## Local end-to-end test

The disposable run is one explicitly enabled pass of `test/relay-plus-sign-in-e2e.test.mjs`. Ordinary `npm test` skips it. In PowerShell, set `$env:ONEM1ND_SIGNIN_E2E='1'` and run `node --test test/relay-plus-sign-in-e2e.test.mjs`; remove that environment variable afterward. The helper requires Node 24 or newer and Windows MySQL 8.4 (`MYSQLD_PATH` may name the executable).

The helper exports only Quantum commit `f999f553ca3f5f205231e317872f8add7108f75c` into an owned `.tmp/signin-e2e-*` directory. It installs and builds there, verifies the exact vector bytes, creates a random-port MySQL server and applies every archived migration through `0036_oauth_key_handoff`. Dependency preparation retains existing npm and Node trust settings; the API receives only process essentials and disposable settings, with provider transports absent and external fetch blocked. No source checkout dependencies or live `.env` files are used.

The headless HTTP driver uses independent site cookie jars, real mail-capture OTP and CSRF, and the real ONEM1ND local control route and PKCE callback. It contains password, shared-store restart, phrase-only legacy, browser-session approval, rejection/cancellation/expiry, pending-consent, device-revocation and encrypted-history scenarios. Both `relayPlus.baseUrl` and `relayPlus.siteUrl` use that run's loopback origin. Acceptance uses `/` or `/es/`; password recovery uses `/security/` or `/es/security/`. This driver is API-only and does not verify account-site HTML or browser UI.

The test writes scenario verdicts to `.tmp/signin-e2e-result.json`, without account secrets or mail. Its `finally` closes owned runtimes and listeners, stops only the API child it started, shuts down its MySQL through SQL and the recorded child handle, checks port release, and removes private runtime data. An unsuccessful run retains only its archive, exported app/dependencies and preparation marker for diagnosis; a prepared directory can be reused through `ONEM1ND_SIGNIN_E2E_PREPARED_ROOT` without reinstalling or rebuilding.

The new-account scenario plays the site's part of the setup handoff with the site's own `appKeyHandoff.ts`: it reads the secret from the app's URL fragment, saves the password envelope and posts the sealed K with the authorization.

## New account

Every sign-in opts into the setup handoff: the authorization URL carries `keyHandoff=1` and a fresh 32-byte secret in `#keyHandoffSecret=`, and the code exchange asks for `keyHandoff:true`. When the site returns a handoff, ONEM1ND opens it only for that exchange's account and the exact launch (app, redirect, PKCE challenge and state), then writes K to the shared key store. A missing or unusable handoff is ignored, and the password, approval or phrase path opens the data as before.

## Use Vault

`engine/relay-plus/vault.mjs` follows Quantum `docs/keys.md`, Local Vault password provider, through the copied client in `engine/relay-plus/vault-client`. The choice shows while Vault is installed on this computer, locked included, and only for an account with a password envelope. Choosing it asks for the Vault password only when Vault is locked. An unlocked Vault without a saved Cosmic password for the signed-in email hides the choice for that account; that answer, a conflict, an unreachable Vault or a saved password that does not open the data all continue to the typed password. The Cosmic password stays in the service process and is never returned, logged or cached. Tests use a fake provider; the real Vault service was not run here.

## Open gap

"Computer limit reached" has no signal the app can see. `device_limit` is returned to the site authorization POST. The app callback accepts only a valid code and a matching state. The screen is not rendered.
