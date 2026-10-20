module: security
purpose: Security checks for a web application, split by the part of the application a change touches.

# Security

A build from scratch or a pass over a whole application starts with [essentials.md](essentials.md). Work on one part reads this file, opens only the category the work touches, and from there only the protocol steps and topic sections its subcategories name. A change that matches no category has no security surface.

## Categories

In the order of coverage of a full pass: what a stranger reaches without a credential comes first.

- [dependencies](categories/dependencies.md): a runtime, framework or package version changes, a package is added, or the package manager or the install pipeline changes.
- [secrets and configuration](categories/secrets-and-configuration.md): a key, token, environment file or public-prefixed variable is added or moved, or a repository changes visibility.
- [deployment](categories/deployment.md): the hosting, a container, an infrastructure file, a bundled service or a static path changes, or a launch is near.
- [API](categories/api.md): a route, handler, server action or job is added or changed, or a flow spends a single-use or bounded value.
- [identity](categories/identity.md): login, registration, sessions, tokens, reset or invitation links, delegated sign-in, passkeys or a second factor.
- [payments](categories/payments.md): prices, checkout, the provider's webhooks, subscriptions, entitlements or refunds.
- [outbound](categories/outbound.md): the server fetches a URL, calls a third-party API, sends mail or emits a webhook.
- [files](categories/files.md): uploads, stored files, downloads or a decoder library.
- [web surface](categories/web-surface.md): headers, transport, cookies, cross-site requests, framing, rendered content, redirects, or browser code that reads the URL, messages or sockets.
- [data](categories/data.md): queries, database accounts, row policies, migrations, backups, exports or personal data.
- [model features](categories/model-features.md): model calls, tools, retrieval, system prompts or generated output.
- [logging and errors](categories/logging-and-errors.md): error handling, error responses, security events, alerts or retention.

## Protocols

One line each, the scope planning matches against. What each step checks is in [steps.md](steps.md).

- [version-floor](protocols/version-floor.md): the runtime, framework and view library versions and the lockfile.
- [supply-chain](protocols/supply-chain.md): the manifest, the lockfile, package manager settings, added dependencies and pipeline workflows.
- [secrets](protocols/secrets.md): keys, environment files, public-prefixed variables, the git history and the build output.
- [deployment-surface](protocols/deployment-surface.md): the deployed origin, static paths, stock and debug routes, bundled services, pipeline secrets, containers, infrastructure files and the hosting shape.
- [access-control](protocols/access-control.md): routes, handlers, server actions and jobs that read an identifier or a role from the request.
- [business-logic](protocols/business-logic.md): single-use and bounded values, multi-step flows and handlers that read then write one record.
- [authentication-and-session](protocols/authentication-and-session.md): login, registration, reset, invitation and setup links, cookies, tokens, logout, delegated sign-in, passkeys and the second factor.
- [payments-and-webhooks](protocols/payments-and-webhooks.md): checkout, prices, subscriptions, entitlements, refunds, provider calls and inbound webhooks.
- [outbound-requests](protocols/outbound-requests.md): outbound HTTP clients, URL fetching, image proxies, third-party APIs and emitted webhooks.
- [file-upload](protocols/file-upload.md): uploads, stored files, their serving path and the decoders that process them.
- [cross-site-requests](protocols/cross-site-requests.md): state-changing endpoints called from a browser, cross-origin settings and framing.
- [client-side](protocols/client-side.md): browser code that reads the URL, storage or window messages, sockets, and third-party scripts the page loads.
- [headers-and-transport](protocols/headers-and-transport.md): response headers, server and edge configuration, certificates and the HTTPS redirect.
- [injection-and-output](protocols/injection-and-output.md): queries, commands, file paths, templates, rendered content, redirects, mail headers and deserialisers fed by input.
- [data-store](protocols/data-store.md): stores, their accounts and grants, row policies, migrations, backups and exports.
- [personal-data](protocols/personal-data.md): forms, scripts and SDKs that collect personal data, consent, marketing mail, deletion and export, and the privacy, cookie, terms and refund pages.
- [resource-limits](protocols/resource-limits.md): public endpoints, searches, exports, pagination, metered calls and business flows.
- [model-exposure](protocols/model-exposure.md): model calls, agents, tools, retrieval, system prompts and generated output.
- [logging-and-errors](protocols/logging-and-errors.md): exception handlers, error responses, log sinks, alert rules and retention.

## Topics

Read when a category or a step names them.

- [essentials.md](essentials.md): the floor and the default values. Read first for a build or a whole pass.
- [rules-of-engagement.md](rules-of-engagement.md): what a pass may touch, test fixtures, secret values and the decisions left to a person. Read before any request to a running application.
- [evidence.md](evidence.md): what counts as proof, the commands on any shell, the verdicts and the ranking of findings.
- [steps.md](steps.md): what each protocol step checks, in a few words.
- [pre-launch.md](pre-launch.md): the order of the last pass on the deployed environment before going public.
- [standards.md](standards.md): which published standard answers which question, with the editions current at the last check.
- [incidents.md](incidents.md): dated advisories, leaks and registry worms with what to check, newest first.
- [framework-traps.md](framework-traps.md): failures that belong to a framework rather than to a category.
- [address-ranges.md](address-ranges.md): the ranges an outbound fetch refuses and where the check sits.
- [sessions-and-credentials.md](sessions-and-credentials.md), [api-conventions.md](api-conventions.md), [headers.md](headers.md), [payments.md](payments.md), [configuration.md](configuration.md): the rules and values behind the options.

The command [cyberattack](features/cyberattack.md) runs the module against a whole application or one part of it. It produces ranked findings with their evidence; it is not a penetration test and not a certification.
