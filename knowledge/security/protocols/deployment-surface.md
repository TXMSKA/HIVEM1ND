name: deployment-surface
purpose: Prove the deployed environment exposes nothing the application did not mean to serve: no environment file, no default credential, no stock route, no listing and no source map.
scope: the deployed origin, hosting and container configuration, static paths, stock and debug routes, bundled services and pipeline secrets
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, before every launch, and again after any change to the hosting, the build output or the bundled services
inputs: the deployed address, a request client, the build output, the list of bundled services with their administrative interfaces
stop: an environment file or a working default credential is reachable from outside, which is a P0 and is reported before the pass continues
report: the status code per probed path, the default credential inventory with the state of each, the stock routes and leftovers with their state, the listing results per static path, the source map results, the pipeline secret scoping, and the shape of each host

## Steps

1. Request the environment files over HTTP.
   Task: `curl -s -o /dev/null -w "%{http_code}" https://<host>/.env`, written `curl.exe -s -o NUL` in Windows PowerShell, and the same for `.env.local`, `.env.production`, `.git/config` and any configuration file the stack keeps at its root. The repository and the client bundle are covered by [secrets](secrets.md); this step covers what the web server itself will hand out.
   Time: 10 minutes. Running application.
   Result: one line per path with its status code, every one 404 or 403, and no response body containing a variable assignment.

2. Change every default credential, and fail the deploy while one remains.
   Task: list every component that ships with a default account or password: the admin panel, the database, the cache, the queue, the monitoring tool and any bundled dashboard. Confirm each default was changed or disabled, and add a deploy check that refuses to proceed while a default is still in place. The pass never tries a default credential against a live service by entering it; the evidence is the configuration and the provisioning record, per [rules-of-engagement.md](../rules-of-engagement.md).
   Time: 30 minutes. Repository, plus the provisioning configuration.
   Result: the inventory with one line per component naming where its credential is set and that it is not the vendor default, and a deploy run with a default restored that exits non-zero, recorded with its output.

3. Remove or close the stock routes and the leftovers.
   Task: request the framework's and the platform's stock administrative, debug, status and health endpoints by their documented paths. Each one is removed, moved off the public origin, or put behind authentication, with its own rate limit. Then list the test accounts, sample endpoints and debug flags that exist in the code and confirm none is enabled in production, including a development server reachable from outside.
   Time: 20 minutes. Running application.
   Result: one line per stock path with its status code for an anonymous caller: 404, or 401 or 403. A health endpoint left public returns a status word and nothing else, with its body quoted. Zero test accounts, sample endpoints or debug flags active in production, each checked by request or by reading the production configuration.

4. Disable directory listing on every static path.
   Task: request each static directory by its path with a trailing slash, including upload, asset and build output directories, so a misplaced file is never enumerable.
   Time: 10 minutes. Running application.
   Result: one line per directory with its status code, none returning an index of its contents.

5. Keep source maps off the public origin.
   Task: search the build output for `.map` files and for `sourceMappingURL` comments, then request each map path from the deployed origin. Maps are either not deployed or restricted to internal access, so neither the source nor the values embedded in it leak.
   Time: 15 minutes. Repository after a build, plus running application.
   Result: the count of map files in the deployed output, and every map path requested from the public origin returning 404 or 403, recorded with its status code.

6. Scope the pipeline secrets to the jobs that use them.
   Task: read the continuous integration configuration and list every secret with the jobs and branches that can read it. A deploy credential readable by a job that runs on an untrusted branch or a fork is a finding.
   Time: 20 minutes. Repository, plus the pipeline settings.
   Result: a table of secret, the jobs that read it and the branches they run on, with no secret exposed to a job that does not use it.

7. Record the shape of the host.
   Task: record how the application is served: a static export or a running server, self-hosted or on a managed platform, the host operating system, the proxies in front of it, and whether the build runs on every push. Advisories depend on these, per [framework-traps.md](../framework-traps.md), and so does the client address a rate limit keys on.
   Time: 15 minutes. Deploy configuration, plus running application.
   Result: one line per deployment with each property and where it was read, and the number of trusted proxy hops the application is configured with, matching the proxies actually in front of it.
