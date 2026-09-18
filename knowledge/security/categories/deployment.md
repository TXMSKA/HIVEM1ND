# Deployment

What the deployed environment serves beyond the application itself, how it is hosted, and the last pass before it goes public.

## Served files and listings

**Applies when:** the hosting or server configuration changes; a static directory is added; the build output changes; source maps are generated.

**Options:**

- **Serve only the build output directory.** The default. Environment files, the git folder and configuration stay outside what the server can hand out.
- **Source maps not deployed.** The simplest choice.
- **Source maps deployed but restricted to internal access.** When production debugging needs them.
- **Directory listing disabled on every static path.** Always.

**Open:** steps 1, 4 and 5 of [deployment-surface](../protocols/deployment-surface.md).

## Default credentials, stock routes and leftovers

**Applies when:** a bundled service, admin panel, database, cache, queue or dashboard is provisioned; a framework ships a stock admin, debug or health route; test accounts, sample endpoints or debug flags exist in the code.

**Options:**

- **Every default changed or disabled, and a deploy check that fails while one remains.** The default.
- **Stock routes removed.** When nothing uses them.
- **Stock routes moved off the public origin or put behind authentication with their own rate limit.** When they are needed. A public health route returns a status word and nothing else.

**Open:** steps 2 and 3 of [deployment-surface](../protocols/deployment-surface.md).

## Hosting shape

**Applies when:** the application moves between a static export and a server, between hosts or operating systems, or behind a new proxy or edge; builds start running on every push.

**Options:**

- **Static export.** No framework server in production, so server-side advisories reach only the development server. Features that need a server move elsewhere.
- **Self-hosted server.** Full control, and full exposure to advisories that depend on the host header, the operating system or the absence of a platform's edge.
- **Managed platform.** Some advisories are mitigated at the platform's edge, which is recorded rather than assumed.
- **Trusted proxy hops configured to match the proxies in front.** Always, so the client address a limit keys on is real.

**Open:** step 7 of [deployment-surface](../protocols/deployment-surface.md); [framework-traps.md](../framework-traps.md#the-same-version-a-different-exposure).

## Pipeline secrets

**Applies when:** the deploy pipeline gains a secret or a job that runs on forks.

**Options:** as in [secrets-and-configuration.md](secrets-and-configuration.md#pipeline-secrets).

**Open:** step 6 of [deployment-surface](../protocols/deployment-surface.md).

## Going public

**Applies when:** an application is about to go public, or a launch date is set.

**Options:**

- **Pre-launch pass on the deployed environment, in priority order, closing with zero open fails.** The only option; a deferred fail is a risk accepted by a person.

**Open:** [pre-launch.md](../pre-launch.md).
