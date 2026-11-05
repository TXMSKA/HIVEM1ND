# Cosmic account key store

This self-contained JavaScript adaptation follows `@txmska/cosmic` 0.1.0 (`src/keys`, `src/files.ts`, `src/paths.ts`, and its Windows helper). The private TypeScript package is not published, so ONEM1ND ships the compatible source and helper without requiring its checkout at install or runtime.

The store retains the version 1 JSON format, other accounts' entry bytes, atomic replacement, and the shared `.lock` protocol. Windows DPAPI uses CurrentUser and UTF-8 entropy `cosmic-account-key-v1`. The C# helper builds with the Windows .NET Framework compiler when absent; all child processes are hidden and use pipes for key material.

`test/relay-plus-store.test.mjs` adapts the package's own key-store conformance suite and adds bidirectional and concurrent exchange with an available reference checkout (`COSMIC_REFERENCE_ROOT`, defaulting to the local Cosmic checkout). That external checkout is only a test oracle. Cryptographic compatibility is not claimed until those tests pass with a working Windows DPAPI user profile.
