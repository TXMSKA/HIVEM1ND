name: deployment-surface
purpose: Prove the deployed environment exposes nothing the application did not mean to serve: no environment file, no default credential, no stock route, no listing, no source map, and no container or infrastructure setting that opens the host.
scope: the deployed origin, hosting and container configuration, infrastructure files, static paths, stock and debug routes, bundled services and pipeline secrets
trigger: task close
repeat: once
inputs: the deployed address, a request client, the build output, the list of bundled services with their administrative interfaces, the container and infrastructure files
stop: an environment file is served, or a default credential is still in place on a reachable service, which is a P0, reported at once, and ends the protocol
report: the status code per probed path, the default credential inventory, the stock routes and leftovers with their state, the listing results, the source map results, the pipeline secret scoping, the shape of each host, and the container and infrastructure readings

## Steps

1. Request the environment files over HTTP.
   Task: the status-code-only request of [evidence.md](../evidence.md#commands-on-any-shell) for `https://<host>/.env`, and the same for `.env.local`, `.env.production`, `.git/config` and any configuration file the stack keeps at its root. The repository and the client bundle are covered by [secrets](secrets.md); this step covers what the web server itself hands out. Positive control: a path the site serves, such as `/`, returning 200 through the same command.
   Time: 10 minutes. Running application.
   Result: one line per path with its status code, every one 404 or 403, and no response body containing a variable assignment.

2. Read every default credential and the check that refuses it.
   Task: list every component that ships with a default account or password: the admin panel, the database, the cache, the queue, the monitoring tool and any bundled dashboard. Read where each credential is set and whether the deploy refuses to proceed while a default remains. A default credential is never tried against a live service; the evidence is the configuration and the provisioning record. The refusal is proved by running the deploy check alone against a scratch copy of the configuration that holds the vendor default.
   Time: 30 minutes. Repository, plus the provisioning configuration.
   Result: one line per component naming where its credential is set and that it is not the vendor default, and the check exiting non-zero on the scratch copy, with its output. A missing check is a finding whose fix is the check.

3. Find the stock routes and the leftovers.
   Task: request the framework's and the platform's stock administrative, debug, status and health endpoints by their documented paths. Then list the test accounts, sample endpoints and debug flags in the code and read whether any is enabled in production, including a development server reachable from outside.
   Time: 20 minutes. Running application.
   Result: one line per stock path with its status code for an anonymous caller: 404, or 401 or 403. A health endpoint left public returns a status word and nothing else, with its body quoted. Zero test accounts, sample endpoints or debug flags active in production, each read by request or from the production configuration.

4. Request each static directory for a listing.
   Task: request each static directory by its path with a trailing slash, including upload, asset and build output directories.
   Time: 10 minutes. Running application.
   Result: one line per directory with its status code, none returning an index of its contents.

5. Keep source maps off the public origin.
   Task: count the map files in the build output, Unix shell `find dist build .next -name '*.map' 2>/dev/null | wc -l`, PowerShell `(Get-ChildItem dist, build, .next -Recurse -Filter *.map -ErrorAction SilentlyContinue).Count`, and list the files that reference one with `git grep --no-index -l -I -F 'sourceMappingURL' -- dist build .next`. Request each map path from the deployed origin.
   Time: 15 minutes. Repository after a build, plus running application.
   Result: the map count in the deployed output, and every map path requested from the public origin returning 404 or 403, with its status code.

6. Scope the pipeline secrets to the jobs that use them.
   Task: read the continuous integration configuration and list every secret name with the jobs and branches that can read it: `git grep -n -I -E 'secrets\.[A-Za-z0-9_]+' -- .github .gitlab-ci.yml`, with a planted `${{ secrets.SAMPLE }}` as the positive control. A deploy credential readable by a job that runs on an untrusted branch or a fork is a finding.
   Time: 20 minutes. Repository, plus the pipeline settings.
   Result: a table of secret name, the jobs that read it and the branches they run on, with no secret exposed to a job that does not use it.

7. Record the shape of the host.
   Task: record how the application is served: a static export or a running server, self-hosted or on a managed platform, the host operating system, the proxies in front of it, and whether the build runs on every push. Advisories depend on these, per [framework-traps.md](../framework-traps.md#the-same-version-a-different-exposure), and so does the client address a rate limit keys on.
   Time: 15 minutes. Deploy configuration, plus running application.
   Result: one line per deployment with each property and where it was read, and the number of trusted proxy hops configured, matching the proxies actually in front.

8. Read each container image and how it runs.
   Task: list the base image, user, build arguments and exposed ports of each image, and the runtime flags that open the host: `git grep -n -I -E '^ *(FROM|USER|ARG|ENV|EXPOSE) |privileged: *true|network_mode: *host|hostNetwork: *true|hostPID: *true|docker\.sock'`, with the `FROM` line of each image file as the positive control. Where the image is built, search its layer history for each secret value with the history form of [evidence.md](../evidence.md#searching-for-a-secret-value), `docker history --no-trunc <image>` standing in place of `git log --all -p`.
   Time: 20 minutes. Repository, plus the built image when one is available.
   Result: per image the base pinned by digest on a supported release, a non-root user, only the ports needed, zero privileged, host network, host process or runtime socket settings, and `no match` for every secret value in the layer history. Without containers, not applicable.

9. Read the infrastructure files for open access.
   Task: search the infrastructure definitions in the repository for open ranges, public storage and wildcard grants: `git grep -n -I -E '0\.0\.0\.0/0|::/0|public-read|AllUsers|allUsers|Principal.{0,4}\*|Action.{0,4}\*'`, with a planted `cidr_blocks = [0.0.0.0/0]` as the positive control; run a configuration scanner as well when one is installed.
   Time: 20 minutes. Repository.
   Result: each hit with file and line and the resource it opens; zero administrative or database ports open to every address, and zero public buckets holding uploads, backups or exports. An open range meant to be public is recorded as intended. Needs a person: which exposures are intended. Without infrastructure files, not applicable.
