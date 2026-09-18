# Secrets and configuration

Keys, tokens, passwords, connection strings and every value that changes per environment: where they live, who holds them, how they leak and what happens when they do. The rules behind the options are in [configuration.md](../configuration.md).

## Repository and history

**Applies when:** an environment file, key file or credential is added, renamed or deleted; an audit starts; a repository is about to change visibility.

**Options:**

- **Secrets outside the tree, an ignored local environment file, an example file with empty values.** The default.
- **Scanner in the pre-commit hook and in continuous integration.** Always.
- **On a leak: rotate first, rewrite history second.** The rewrite never replaces the rotation.

**Build:** Ignore the environment files before the first commit, commit an example file with every variable empty and one line of documentation each, and run a secret scan in the pre-commit hook and in the pipeline.

**Open:** steps 1, 2, 4, 5 and 7 of [secrets](../protocols/secrets.md).

## Client bundle and public prefixes

**Applies when:** a variable with a public prefix is added; a server module is imported from a component that renders in the browser; the build configuration changes.

**Options:**

- **Only keys designed to be public carry a public prefix.** Such as a restricted database key with row policies behind it.
- **Server-only marker on modules that read secrets.** Turns an accidental import into a build failure.
- **Value search over the build output.** Always, since a name search misses a secret given the wrong prefix.

**Build:** Mark every module that reads a secret as server-only, give a public prefix only to keys designed to be public, and search the build output for each secret value after every build.

**Open:** step 3 of [secrets](../protocols/secrets.md); [framework-traps.md](../framework-traps.md#server-only-code-reaching-the-client-bundle).

## Environment and startup

**Applies when:** a required variable is added; configuration is read in a new place; a branch on the environment name appears.

**Options:**

- **Validate every variable once at startup into a typed object.** The default. A missing secret crashes the boot.
- **Same code in every environment.** Behaviour differs only by values.

**Build:** One configuration module reads every variable once at boot into a frozen object, fails with the variable's name when a required one is missing, supplies no fallback for any secret, and refuses a signing secret shorter than the minimum in [essentials.md](../essentials.md).

**Open:** step 4 of [secrets](../protocols/secrets.md); [configuration.md](../configuration.md#validated-at-startup).

## Key scope and rotation

**Applies when:** a key is created, shared, rotated or given to a new consumer; a publishing token for a registry or source host is issued.

**Options:**

- **One key per consumer and environment, at the least privilege it needs.** The default.
- **Publishing tokens for registries and source hosts listed like any other key.** Registry worms spread through them, per [incidents.md](../incidents.md).
- **Rotation order and outage.** A person's decision.

**Build:** Create one key per consumer and environment at the least privilege it needs, list each in a table with its owner, and give every signing secret a current and a previous variable so it can rotate without an outage.

**Open:** steps 5 and 6 of [secrets](../protocols/secrets.md).

## Pipeline secrets

**Applies when:** a continuous integration workflow reads a secret; a deploy credential is added; a job runs on forks or untrusted branches.

**Options:**

- **Secrets scoped to the jobs and branches that use them.** The default.
- **Read-only default token raised per job.** Always.

**Build:** Expose each secret only to the job that uses it, never to jobs triggered from forks or untrusted branches, and raise the default token per job.

**Open:** step 6 of [deployment-surface](../protocols/deployment-surface.md); step 4 of [supply-chain](../protocols/supply-chain.md).
