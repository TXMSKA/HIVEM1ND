name: data-store
purpose: Prove every store is reached only by accounts holding the privileges they use, row policies stand where the browser reaches the data, migrations run only when asked, and a backup restores.
scope: databases, caches and object stores, their accounts and grants, row-level policies, migrations, backups and data exports
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, and again after any change to a grant, a policy, a migration script or the backup configuration
inputs: the connection configuration per environment, database access with a read-only account, the migration scripts and the package scripts, the backup configuration
stop: a key that bypasses row policies is reachable from the browser, or the runtime connects as a superuser, which is a P0 and is reported before the pass continues
report: the store inventory, the grants of each runtime account, the row policy table, the migration trigger, the encryption settings, and the restore result

## Steps

1. List every store and who connects to it.
   Task: from the source and the configuration, list every database, cache, queue and object store the application uses, the account each environment connects with, and where each connection string is read from.
   Time: 20 minutes. Repository, plus the hosting configuration.
   Result: a table of store, environment, account and source of the connection string. Development, preview and production use different accounts, and no connection string appears in the source, checked with the value search from [secrets](secrets.md).

2. Give each runtime account only the privileges it uses.
   Task: read the grants of every account the application connects with, and look for accounts with a wildcard host or no password.
   Time: 20 minutes. Database access.
   Result: the grant list per account, holding no administrative privilege, no schema modification right in production, no write grant on a table the application only reads, and no access to other schemas. No superuser credential appears in the runtime configuration. A query result shows zero anonymous accounts and zero wildcard host accounts. An embedded or file store has no accounts, so the step reads its equivalent instead: the runtime connection opened read-only or with an authorizer refusing schema changes and attached files, and the file permissions, each with a file reference; transport encryption in step 5 is then not applicable.

3. Where the browser reaches the data directly, enforce row policies on every table.
   Task: when a client key talks to the database or its generated API, list every table that key can reach, with row-level security on or off and the number of policies. With row-level security enabled and no policy, the published behaviour is that no data is accessible through the API with the public key, which pushes teams toward the service key; the service key bypasses row policies and never reaches the browser. Then read a row belonging to one test account while authenticated as another.
   Time: 40 minutes. Database access, plus running application.
   Result: a table with every reachable table showing row-level security on and at least one policy that names the owning column, the cross-account read returning no row, and zero hits for the service key value in the build output.

4. Run migrations with their own account and only on an explicit trigger.
   Task: read the package scripts and the deploy command. The migration runs only when an explicit variable is set in the hosting build or deploy command, never from the development server or the build script, and with an account that holds the schema rights the runtime account lacks.
   Time: 20 minutes. Repository, plus the deploy configuration.
   Result: zero package scripts that run a migration from the development or build command, the deploy command quoted with its explicit trigger, and the runtime account's grants from step 2 showing no schema modification right.

5. Encrypt in transit always, and at rest where the data calls for it.
   Task: confirm every connection to a store is encrypted, and list the fields holding personal data, credentials, tokens or payment references with how each is stored. **Needs a person**: which fields warrant encryption at rest beyond the disk is a decision.
   Time: 25 minutes. Database access, plus the source.
   Result: the connection encryption status per store read from the server, and the sensitive field list with the storage of each: hashed, encrypted with the key source named, or plain with the decision and a name against it.

6. Prove the backup restores, and keep test runs away from real data.
   Task: record the backup schedule, its encryption, where it is stored and who can read it. Restore the latest backup into a scratch environment. Confirm that no test, seed or export script can write to the production store, and that a test session never exports over or imports into real data.
   Time: 40 minutes. Backup configuration, plus a scratch environment.
   Result: the schedule, the encryption status and the access list, a restore that completes with a row count per main table, and zero scripts whose target can resolve to the production store. **Needs a person** for retention and for any restore that touches production.
