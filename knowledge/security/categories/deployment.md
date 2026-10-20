# Deployment

What the deployed environment serves beyond the application itself, how it is hosted and packaged, and the last pass before it goes public.

## Served files and listings

Applies when: the hosting or server configuration changes; a static directory is added; the build output changes; source maps are generated.

Build: Serve static files from one build output directory through a handler that decodes the requested path once, canonicalizes it, and refuses anything that resolves outside that directory, with no fallback to the project root. Listings stay off and source maps stay out of the deployed output.

Options:

- **Serve only the build output directory.** The default. Environment files, the git folder and configuration stay outside what the server can hand out.
- **Source maps not deployed.** The simplest choice.
- **Source maps deployed but restricted to internal access.** When production debugging needs them.
- **Directory listing disabled on every static path.** Always.

Open: steps 1, 4 and 5 of [deployment-surface](../protocols/deployment-surface.md); step 3 of [injection-and-output](../protocols/injection-and-output.md) for the static handler's own path resolution.

## Default credentials, stock routes and leftovers

Applies when: a bundled service, admin panel, database, cache, queue or dashboard is provisioned; a framework ships a stock admin, debug or health route; test accounts, sample endpoints or debug flags exist in the code.

Build: Provision no default account, answer a public health route with a status word only, and read debug flags from a variable production does not set.

Options:

- **Every default changed or disabled, and a deploy check that fails while one remains.** The default.
- **Stock routes removed.** When nothing uses them.
- **Stock routes moved off the public origin or put behind authentication with their own rate limit.** When they are needed.

Open: steps 2 and 3 of [deployment-surface](../protocols/deployment-surface.md).

## Hosting shape

Applies when: the application moves between a static export and a server, between hosts or operating systems, or behind a new proxy or edge; builds start running on every push.

Build: Record the hosting shape in the deploy configuration and set the trusted proxy hops to the number of proxies actually in front, zero when there are none.

Options:

- **Static export.** No framework server in production, so server-side advisories reach only the development server.
- **Self-hosted server.** Full control, and full exposure to advisories that depend on the host header, the operating system or the absence of a platform's edge.
- **Managed platform.** Some advisories are mitigated at the platform's edge, which is recorded rather than assumed.
- **Trusted proxy hops configured to match the proxies in front.** Always, so the client address a limit keys on is real.

Open: step 7 of [deployment-surface](../protocols/deployment-surface.md); [framework-traps.md](../framework-traps.md#the-same-version-a-different-exposure).

## Containers and infrastructure as code

Applies when: a container image file, a compose or orchestration file, or an infrastructure definition is added or changed; a storage bucket, a firewall rule or a cloud role is created.

Build: Build from a base image pinned by digest on a supported release, run as a non-root user, pass secrets as build secrets rather than arguments or layers, expose only the ports used, and never run privileged, on the host network or with the container runtime socket mounted. Infrastructure files open no administrative or database port to every address, keep storage private by default and grant roles by named action.

Options:

- **Minimal base image.** The default: fewer packages, fewer advisories.
- **Distroless or scratch image.** When the application needs no shell at run time; debugging moves to a separate image.
- **Configuration scanner in the pipeline.** Beside the search in the protocol, when one is available.

Open: steps 8 and 9 of [deployment-surface](../protocols/deployment-surface.md).

## Pipeline secrets

Applies when: the deploy pipeline gains a secret or a job that runs on forks.

Build: As in [secrets-and-configuration.md](secrets-and-configuration.md#pipeline-secrets).

Options: as in [secrets-and-configuration.md](secrets-and-configuration.md#pipeline-secrets).

Open: step 6 of [deployment-surface](../protocols/deployment-surface.md).

## Going public

Applies when: an application is about to go public, or a launch date is set.

Build: Run [pre-launch.md](../pre-launch.md) on the deployed environment and close it with zero open fails.

Options:

- **Pre-launch pass on the deployed environment, in rank order, closing with zero open fails.** The only option; a deferred fail is a risk accepted by a person.

Open: [pre-launch.md](../pre-launch.md).
