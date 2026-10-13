# HIVEM1ND service

`node cli/index.mjs service run` starts the configured mind's shared service.
The service holds one lock per OS user, serves the bundled `gui/app` interface,
and owns HTTP, events, sync, native sessions, and wake policies. Another mind
cannot take over an occupied user lock. A viewer logout closes that viewer;
closing the setup wizard does not stop the service.

`service install --dry-run` describes login registration without changing the
OS. An ordinary install queries the platform manager before writing and verifies
the result afterward. It preserves an existing registration unless its identity
and digest prove ownership. Uninstall checks the same ownership before removing
registration. Windows uses Task Scheduler, macOS uses a user LaunchAgent,
and Linux uses a systemd user unit. Tests inject these managers; their success
does not certify an actual login trigger.

New minds default to the local Cosmic `hivem1nd` folder. An explicitly selected
existing mind retains its location, including OneDrive. The configured origin
is preserved during later setup or evolve. Machine-local configuration, staging,
and import journals remain outside the mind, origin, and synced roots.

Setup writes configuration before starting the service. A failed service phase
keeps setup at Install; evolve records the new version only after service setup
succeeds. Retry resumes the service phases without copying the mind again. A successful start opens an
authenticated local viewer. Bootstrap credentials are owner-protected and are
not native-agent credentials.

On Windows, `whoami.exe /user` identifies the current owner's SID and
`icacls.exe` verifies private bootstrap files for that owner and SYSTEM.
A real login registration was not verified by the injected-manager tests.

File watchers observe eligible mind files and registered project resources.
Local commits and incoming groups share a serialization barrier with observation.
External Void edits preserve exact document bytes and append outside history in
one sync group. Own saves and incoming changes do not produce duplicate history
or outgoing echoes. Local import journals recover before observation starts;
known files removed while the service was closed become deletion records.

Compressed packs reuse verified committed blobs while retaining logical message
counts. Publication and receipt enforce the rolling message and byte limits.
Interrupted publication retains staging, missing dependencies remain pending,
and conflicts preserve losing bytes. Real OneDrive and SMB provider behavior
requires separate acceptance beyond temporary shared-folder tests.

Owned native launches register only after the native protocol confirms a session.
An ephemeral grant binds the unit, client, machine, and owned process to the
service. Stdio MCP uses the service's HTTP core operations. Fresh role entry may
initialize its default consent window; retry, attach, and expiry do not renew an
existing window. Supported hooks use the shared controller and retain the native
prompt whenever a verified approval cannot be obtained.

Native protocol fixtures prove protocol handling and local service integration.
They do not prove signed-in submission to Claude, Codex, or Cursor. Full release
acceptance also requires an isolated real Windows registration and logon test.
Neither test may silently reuse a person's live profile or replace a live task.

The current normative interface is [the 3.0 contract](../../docs/3.0/contract.md).
Integrated verification covers core tests, browser flows, offline packaging,
temporary-home installation, update, ownership refusal, and rollback. Record the
actual source identity and outputs for each candidate; earlier branch results
are historical evidence, not a passing result for a changed tree.
