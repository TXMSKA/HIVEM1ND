module: security
purpose: Security checks for a web application, split by the part of the application a change touches.

# Security

A build from scratch or a pass over a whole application starts with [essentials.md](essentials.md): the floor rules and the default values, in one file. Work on one part of an application reads this file, opens only the category the work touches, and from there only the protocols and topic sections it names. Each category file lists its subcategories with the requests and diffs that match them, the options with when to pick each, how to build it right the first time, and the files to open. Most changes touch one or two categories. When nothing below matches, the change has no security surface.

The work scales to the surface. Time limits in the protocols are ceilings, a step whose subject does not exist ends as not applicable with the reason, and a small application does not pay for a large one's pass.

## Categories

The order is the order of coverage in a full pass: what a stranger can reach without a credential comes first.

- [dependencies](categories/dependencies.md): the runtime, framework and package versions against their advisories, install scripts, the lockfile and the pipeline that installs.
- [secrets and configuration](categories/secrets-and-configuration.md): keys and environment values in the repository, the history, the client bundle and the pipeline, their scope and rotation.
- [deployment](categories/deployment.md): what the deployed host serves besides the application, default credentials, stock routes, the hosting shape and the pre-launch pass.
- [API](categories/api.md): endpoint inventory, authorization per object and per function, identity from the session, writable and returned fields, input validation, rate limits and idempotency.
- [identity](categories/identity.md): login, credential storage, sessions and cookies, signed tokens, reset and invitation links, the first account, throttling and the second factor.
- [payments](categories/payments.md): prices, checkout and fulfilment, inbound webhooks, subscriptions and refunds, card data and reconciliation.
- [outbound](categories/outbound.md): requests to URLs taken from input, image proxies, third-party APIs consumed and webhooks the service emits.
- [files](categories/files.md): upload, storage and serving, download access and the decoders that parse files.
- [web surface](categories/web-surface.md): headers and the content policy, transport, cookies, cross-site forgery, cross-origin access and framing, rendered content and redirects.
- [data](categories/data.md): queries, database accounts and privileges, row policies, migrations, sensitive fields, backups and exports.
- [model features](categories/model-features.md): where the model runs, tools and agency, injection through content, the system prompt, spend and generated output.
- [logging and errors](categories/logging-and-errors.md): failure handling, error responses, security events and alerts, secrets in records and retention.

## Routing

The protocol steps each category can call for, so a pass over a whole category needs no category file to find them. A scoped pass still opens the category and takes only the steps its matched subcategories name. What each step checks is one line in [steps.md](steps.md): steps are picked there, and a whole pass on a small surface opens only the protocols whose steps it will actually run.

| Category | Protocol steps |
| --- | --- |
| dependencies | version-floor 1 to 6; supply-chain 1 to 6 |
| secrets and configuration | secrets 1 to 7; supply-chain 4; deployment-surface 6 |
| deployment | deployment-surface 1 to 7; injection-and-output 3; [pre-launch.md](pre-launch.md) |
| API | access-control 1 to 7; injection-and-output 1, 7; resource-limits 1 to 6; payments-and-webhooks 4 |
| identity | authentication-and-session 1 to 7; resource-limits 1 |
| payments | payments-and-webhooks 1 to 6 |
| outbound | outbound-requests 1 to 5; logging-and-errors 2 |
| files | file-upload 1 to 6; deployment-surface 4; access-control 2 |
| web surface | headers-and-transport 1 to 7; cross-site-requests 1 to 5; injection-and-output 4 to 6; authentication-and-session 1 |
| data | injection-and-output 1, 2, 7; data-store 1 to 6; resource-limits 3; secrets 3; logging-and-errors 5 |
| model features | model-exposure 1 to 7; resource-limits 5; injection-and-output 4 |
| logging and errors | logging-and-errors 1 to 7 |

## Protocols

One line each, for the match made while planning. A category file says which steps apply to which subcategory.

- [version-floor](protocols/version-floor.md): scope the runtime, framework and view library versions and the lockfile.
- [supply-chain](protocols/supply-chain.md): scope the manifest, the lockfile, package manager settings, added dependencies and pipeline workflows.
- [secrets](protocols/secrets.md): scope keys, environment files, public-prefixed variables, the git history and the build output.
- [deployment-surface](protocols/deployment-surface.md): scope the deployed origin, static paths, stock and debug routes, bundled services, pipeline secrets and the hosting shape.
- [access-control](protocols/access-control.md): scope routes, handlers, server actions and jobs that read an identifier or a role from the request.
- [authentication-and-session](protocols/authentication-and-session.md): scope login, registration, reset, invitation and setup links, cookies, tokens, logout and second factor.
- [payments-and-webhooks](protocols/payments-and-webhooks.md): scope checkout, prices, subscriptions, refunds, provider calls and inbound webhooks.
- [outbound-requests](protocols/outbound-requests.md): scope outbound HTTP clients, URL fetching, image proxies, third-party APIs and emitted webhooks.
- [file-upload](protocols/file-upload.md): scope uploads, stored files, their serving path and the decoders that process them.
- [cross-site-requests](protocols/cross-site-requests.md): scope state-changing endpoints called from a browser, cross-origin settings and framing.
- [headers-and-transport](protocols/headers-and-transport.md): scope response headers, server and edge configuration, certificates and the HTTPS redirect.
- [injection-and-output](protocols/injection-and-output.md): scope queries, commands, file paths, templates, rendered content, redirects and deserialisers fed by input.
- [data-store](protocols/data-store.md): scope stores, their accounts and grants, row policies, migrations, backups and exports.
- [resource-limits](protocols/resource-limits.md): scope public endpoints, searches, exports, pagination, metered calls and business flows.
- [model-exposure](protocols/model-exposure.md): scope model calls, agents, tools, retrieval, system prompts and generated output.
- [logging-and-errors](protocols/logging-and-errors.md): scope exception handlers, error responses, log sinks, alert rules and retention.

## Topics

Read when a category or a step names them.

- [essentials.md](essentials.md): the floor and the default values with their sources. Read first for a build or a whole-application pass.
- [rules-of-engagement.md](rules-of-engagement.md): what a pass may touch and what it may never touch. Read before any request to a running application.
- [evidence.md](evidence.md): what counts as proof, the verdicts, the ranking of findings and the commands on any shell.
- [standards.md](standards.md): which published standard answers which question, with the editions current at the last check.
- [incidents.md](incidents.md): dated advisories, leaks and registry worms with what to check. New entries are appended there.
- [framework-traps.md](framework-traps.md): failures that belong to a framework rather than to a category.
- [pre-launch.md](pre-launch.md): the last pass on the deployed environment before going public.
- [address-ranges.md](address-ranges.md): the IPv4 and IPv6 ranges an outbound fetch refuses and where the check sits.
- [sessions-and-credentials.md](sessions-and-credentials.md), [api-conventions.md](api-conventions.md), [headers.md](headers.md), [payments.md](payments.md), [configuration.md](configuration.md): the reference values behind the options.

The command [cyberattack](features/cyberattack.md) runs the module against a whole application or against one part of it.

It is not a penetration test and it is not a certification. It produces findings with the evidence that proves each one and the evidence that would prove it fixed. Accepting a risk, building a threat model or submitting a domain to a list that takes months to leave is a person's decision, and the protocols say so at the step where it arises.
