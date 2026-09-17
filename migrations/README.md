# Migrations

Each `<version>.mjs` file exports its version, `idempotent = true` and an async `migrate` function. A migration changes only private files under the supplied `user/` path and must be safe to resume after any partial failure. The engine records each completed version and applies matching versions once, in SemVer order.
