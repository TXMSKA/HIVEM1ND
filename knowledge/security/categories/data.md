# Data

The stores behind the application: databases, caches, object stores, their accounts, their policies, the scripts that change their shape, and the copies made of them. What a caller may read through an endpoint is in [api.md](api.md); this category is the store itself.

## Queries

**Applies when:** a query is added or changed; a search, filter or sort takes a value from the request; a table or column name is chosen at run time; a raw query sits beside an ORM.

**Options:**

- **Query builder or ORM with bound parameters.** The default. Values never touch the query text. Watch the escape hatches every ORM offers for raw fragments.
- **Hand-written query with bound parameters.** For queries the builder cannot express. Acceptable when every value is a parameter, never concatenated, not even an internal value.
- **Dynamic identifiers through an allowlist.** Table names, column names and sort direction cannot be bound, so a caller's value maps to a fixed identifier through a server-side allowlist that never falls through to the value itself.

**Build:** Bind every value, and map every dynamic table, column or sort direction through a fixed server-side table that never falls through to the caller's value.

**Open:** steps 1, 2 and 7 of [injection-and-output](../protocols/injection-and-output.md); step 3 of [resource-limits](../protocols/resource-limits.md) for query cost.

## Database accounts and privileges

**Applies when:** a connection string, a database user or a grant is added or changed; a new environment is provisioned; an audit starts.

**Options:**

- **One runtime account per environment with only the grants it uses.** The default. No administrative privilege, no schema rights in production, read-only grants on tables the application only reads.
- **Separate read and write accounts.** When a large part of the application only reads. More configuration, a smaller blast radius for the read paths.

**Build:** Connect the runtime with an account holding only data rights. An embedded or file store with no accounts gets the same effect from a runtime connection opened read-only where possible, or with an authorizer that refuses schema changes, attaching other files and settings changes, plus file permissions as the grant.

**Open:** steps 1, 2 and 5 of [data-store](../protocols/data-store.md).

## Row policies and direct client access

**Applies when:** the browser or a mobile client talks to the database or its generated API with a public key; a table is added to a schema exposed that way; a service key appears in any code path.

**Options:**

- **Every table reached from the client has row-level security and at least one real policy.** Required whenever a client key reaches the store. The backend is not the only guardian: the database decides which rows each caller sees. With row-level security enabled and no policy, nothing is readable through the public key, which is safe but pushes teams to reach for the service key.
- **No direct client access; everything through server endpoints.** The client key holds no table access at all. Simpler to audit, at the cost of writing the endpoints.
- **The service key stays on the server.** It bypasses row policies and never reaches a browser, whichever option is chosen.

**Build:** Enable row-level security with at least one policy naming the owning column on every table the client key reaches, or give the client key no table access and go through server endpoints.

**Open:** step 3 of [data-store](../protocols/data-store.md); step 3 of [secrets](../protocols/secrets.md) for the key value in the bundle; [configuration.md](../configuration.md#public-prefixes-are-public).

## Migrations

**Applies when:** a migration script, a schema change, a seed script or a first-account bootstrap is added; the build or deploy command changes.

**Options:**

- **Migrations run from the deploy command behind an explicit variable.** The default. Never from the development server or the build script, where they run against whatever the environment points at.
- **Migrations run by hand by a person.** For stores with no deploy pipeline. Slower, and recorded each time.
- **Either way, a migration account separate from the runtime account**, so the runtime holds no schema rights.

**Build:** Put migrations in their own script run by the deploy command or by a person, never by the server, which refuses to boot while one is pending. The migration runs with an account the runtime does not hold, or through the embedded-store restriction above.

**Open:** step 4 of [data-store](../protocols/data-store.md); [sessions-and-credentials.md](../sessions-and-credentials.md#reset-invitation-and-setup-links) when the migration creates the first account.

## Sensitive data, backups and exports

**Applies when:** a field holds personal data, credentials or payment references; a backup, dump, export or import is configured; test data or a seed is loaded; a restore is planned.

**Options:**

- **Encryption at rest by the store or the disk.** The default for everything. Protects a stolen disk, not a stolen connection.
- **Field-level encryption with a key outside the store.** For fields whose leak is serious on its own. Costs searchability, and the key becomes a secret with its own rotation. Which fields qualify is a person's decision.
- **Hash instead of storing.** For values that only need comparing, such as passwords and tokens.
- **Backups restored on a schedule into a scratch environment.** A backup never restored is an assumption. Test, seed and export scripts never resolve to the production store, and a test session never exports over real data.

**Build:** Hash tokens and passwords, encrypt at rest, make the seed refuse a store that already holds accounts, and have tests create their own temporary store and delete it afterwards.

**Open:** steps 5 and 6 of [data-store](../protocols/data-store.md); step 5 of [logging-and-errors](../protocols/logging-and-errors.md) for personal data in records.
