# Migrations

Each `<version>.mjs` file exports its version, `idempotent = true` and an async `migrate` function. Ordinary migrations change only private files under the supplied `user/` path and must be safe to resume after any partial failure. The engine records each completed version and applies matching versions once, in SemVer order.

`3.0.0-onem1nd.mjs` also runs when upgrading an existing 3.0.0 installation without changing the package version. Launchers run it before resolving the local mind and service. Its explicit context accepts `cosmicPath`, `homeDir`, `env`, `kitPath`, `platform` and injected operating-system boundaries for isolated tests. It copies and hashes the legacy local data before retiring it, journals configuration writes in Cosmic, preserves ownership receipts and handwritten entries, and replaces verified login registrations and command shims. The checkpoint allows a second launch to resume interrupted work without duplicating registrations.
