# Data

The stores behind the application: databases, caches, object stores, their accounts, their policies, the scripts that change their shape, the copies made of them, and the personal data they hold. What a caller may read through an endpoint is in [api.md](api.md); this category is the store itself.

## Queries

Applies when: a query is added or changed; a search, filter or sort takes a value from the request; a table or column name is chosen at run time; a raw query sits beside an ORM.

Build: Bind every value, and map every dynamic table, column or sort direction through a fixed server-side table that never falls through to the caller's value.

Options:

- **Query builder or ORM with bound parameters.** The default. Values never touch the query text. Watch the escape hatches every ORM offers for raw fragments.
- **Hand-written query with bound parameters.** For queries the builder cannot express, with every value a parameter.
- **Dynamic identifiers through an allowlist.** Table names, column names and sort direction cannot be bound, so a caller's value maps to a fixed identifier.

Open: steps 1, 2 and 7 of [injection-and-output](../protocols/injection-and-output.md); step 3 of [resource-limits](../protocols/resource-limits.md) for query cost.

## Database accounts and privileges

Applies when: a connection string, a database user or a grant is added or changed; a new environment is provisioned; an audit starts.

Build: Connect the runtime with an account holding only data rights. An embedded or file store with no accounts gets the same effect from a runtime connection opened read-only where possible, or with an authorizer that refuses schema changes, attaching other files and settings changes, plus file permissions as the grant.

Options:

- **One runtime account per environment with only the grants it uses.** The default. No administrative privilege, no schema rights in production, read-only grants on tables the application only reads.
- **Separate read and write accounts.** When a large part of the application only reads.

Open: steps 1, 2 and 5 of [data-store](../protocols/data-store.md).

## Row policies and direct client access

Applies when: the browser or a mobile client talks to the database or its generated API with a public key; a table is added to a schema exposed that way; a service key appears in any code path.

Build: Enable row-level security with at least one policy naming the owning column on every table the client key reaches, or give the client key no table access and go through server endpoints. The service key stays on the server either way.

Options:

- **Every table reached from the client has row-level security and at least one real policy.** Required whenever a client key reaches the store.
- **No direct client access; everything through server endpoints.** Simpler to audit, at the cost of writing the endpoints.

Open: step 3 of [data-store](../protocols/data-store.md); step 3 of [secrets](../protocols/secrets.md) for the key value in the bundle; [configuration.md](../configuration.md#public-prefixes-are-public).

## Migrations

Applies when: a migration script, a schema change, a seed script or a first-account bootstrap is added; the build or deploy command changes.

Build: Put migrations in their own script run by the deploy command or by a person, never by the server, which refuses to boot while one is pending. The migration runs with an account the runtime does not hold, or through the embedded-store restriction above.

Options:

- **Migrations run from the deploy command behind an explicit variable.** The default. Never from the development server or the build script.
- **Migrations run by hand by a person.** For stores with no deploy pipeline, recorded each time.

Open: step 4 of [data-store](../protocols/data-store.md); [sessions-and-credentials.md](../sessions-and-credentials.md#reset-invitation-and-setup-links) when the migration creates the first account.

## Sensitive data, backups and exports

Applies when: a field holds personal data, credentials or payment references; a backup, dump, export or import is configured; test data or a seed is loaded; a restore is planned.

Build: Hash tokens and passwords, encrypt at rest, make the seed refuse a store that already holds accounts, and have tests create their own temporary store and delete it afterwards.

Options:

- **Encryption at rest by the store or the disk.** The default for everything. Protects a stolen disk, not a stolen connection.
- **Field-level encryption with a key outside the store.** For fields whose leak is serious on its own. Which fields qualify is a person's decision.
- **Hash instead of storing.** For values that only need comparing, such as passwords and tokens.
- **Backups restored on a schedule into a scratch environment.** A backup never restored is an assumption.

Open: steps 5 and 6 of [data-store](../protocols/data-store.md); step 5 of [logging-and-errors](../protocols/logging-and-errors.md) for personal data in records.

## Personal data, consent and notices

Applies when: a form, an import or a script collects data about a person; a consent box, a banner, a mailing list or an age screen is built; a third-party script or SDK is added; account deletion or export is built; a privacy, cookie, terms or refund page is written or linked.

Build: Keep one table of every personal field with its purpose, store, processor and retention, and build the consent record, the script list, the deletion path and the notices from it.

Options:

- **Collect only what a feature uses.** The default.
- **Consent per purpose, off by default, recorded.** For anything beyond what was asked for.
- **Notices written from the inventory.** So each agrees with what the code does.

Which regime applies, the retention periods and the wording of every notice are a person's decision. Nothing here is legal advice.

Open: steps 1 to 6 of [personal-data](../protocols/personal-data.md); step 5 of [logging-and-errors](../protocols/logging-and-errors.md) for personal data in records.
