name: data-store
purpose: Prove every store is reached only by accounts holding the privileges they use, row policies stand where the browser reaches the data, migrations run only when asked, and a backup restores.
scope: databases, caches and object stores, their accounts and grants, row-level policies, migrations, backups and data exports
trigger: task close
repeat: once
inputs: the connection configuration per environment, database access with a read-only account, the migration scripts and the package scripts, the backup configuration
stop: a key that bypasses row policies is reachable from the browser, which is a P0, reported at once, and ends the protocol
report: the store inventory, the grants of each runtime account, the row policy table, the migration trigger, the encryption settings, and the restore result

## Steps

1. List every store and who connects to it.
   Task: from the source and the configuration, list every database, cache, queue and object store the application uses, the account each environment connects with, and where each connection string is read from. Search for a connection string written in the source: `git grep -n -I -i -E '(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?|redis|amqp)://[^ /]*:[^ /]*@'`, with a planted `postgres://u:p@host/db` as the positive control, beside the tree scan of step 1 of [secrets](secrets.md).
   Time: 20 minutes. Repository, plus the hosting configuration.
   Result: a table of store, environment, account and source of the connection string, with different accounts for development, preview and production, and zero connection strings with credentials in the source.

2. Give each runtime account only the privileges it uses.
   Task: read the grants of every account the application connects with, and look for accounts with a wildcard host or no password.
   Time: 20 minutes. Database access.
   Result: the grant list per account, holding no administrative privilege, no schema modification right in production, no write grant on a table the application only reads, and no access to other schemas; no superuser credential in the runtime configuration; a query result showing zero anonymous and zero wildcard host accounts. An embedded or file store has no accounts, so the step reads its equivalent: the runtime connection opened read-only or with an authorizer refusing schema changes and attached files, and the file permissions, each with a file reference; transport encryption in step 5 is then not applicable.

3. Where the browser reaches the data directly, enforce row policies on every table.
   Task: when a client key talks to the database or its generated API, list every table that key can reach, with row-level security on or off and the number of policies. With row-level security enabled and no policy, nothing is readable through the public key, which pushes teams toward the service key; the service key bypasses row policies and never reaches the browser. Then read a row belonging to one test account while authenticated as another, after reading it as its owner.
   Time: 40 minutes. Database access, plus running application.
   Result: every reachable table showing row-level security on and at least one policy naming the owning column, the owner's read returning the row and the cross-account read returning none, and the build-output value search of [evidence.md](../evidence.md#searching-for-a-secret-value) printing `no match` for the service key.

4. Run migrations with their own account and only on an explicit trigger.
   Task: read the package scripts and the deploy command: `git grep -n -I -i -E '(dev|build|start|install|prepare)[a-z:]*.? *:.*(migrate|migration|db push|db:push)' -- package.json`, with a planted `"dev": "prisma migrate dev"` line as the positive control. The migration runs only when an explicit variable is set in the hosting deploy command, never from the development server or the build script, and with an account that holds the schema rights the runtime account lacks.
   Time: 20 minutes. Repository, plus the deploy configuration.
   Result: zero package scripts that run a migration from the development or build command, the deploy command quoted with its explicit trigger, and the runtime grants from step 2 holding no schema modification right.

5. Encrypt in transit always, and at rest where the data calls for it.
   Task: confirm every connection to a store is encrypted, and list the fields holding personal data, credentials, tokens or payment references with how each is stored. Needs a person: which fields warrant encryption at rest beyond the disk.
   Time: 25 minutes. Database access, plus the source.
   Result: the connection encryption status per store read from the server, and the sensitive field list with the storage of each: hashed, encrypted with the key source named, or plain with the decision and a name against it.

6. Prove the backup restores, and keep test runs away from real data.
   Task: record the backup schedule, its encryption, where it is stored and who can read it. A restore of a production backup copies real records, so the owner runs it into a scratch environment, or the pass reads the record of the last restore test. List the test, seed and export scripts with the store each one targets: `git grep -n -I -l -i -E 'seed|fixture|truncate|drop table|deleteMany|db:reset' -- scripts test tests prisma package.json`, with a seed script known in the repository as the positive control.
   Time: 40 minutes. Backup configuration, plus the scripts.
   Result: the schedule, the encryption status and the access list; the last restore with its date and a row count per main table; and zero scripts whose target can resolve to the production store. Needs a person: the retention, and any restore that touches production.
