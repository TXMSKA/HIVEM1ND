# Pre-launch pass

The last pass before an application goes public. It runs on the deployed environment, never on a development machine, because every item is a property of what serves traffic. It adds no check of its own: it orders the protocol steps below and closes only with zero open fails.

Each item ends in one of the verdicts in [evidence.md](evidence.md#verdicts), with the artifact behind it and the fix when it fails. An item whose subject the application lacks, such as payments or model calls, is not applicable with the reason.

## Order

Rank order: what a stranger reaches without a credential, and what leaks a secret, another account or money, comes first, so a pass cut short still covered it.

1. Served files and stock routes. No environment or git file served, no default credential in place, no stock or debug route open, no listing, no public source map, no secret value in the bundle. Steps 1 to 5 of [deployment-surface](protocols/deployment-surface.md); step 3 of [secrets](protocols/secrets.md).
2. Access control. Another account's objects, privileged functions, the check inside each action and the default denial. Steps 2, 3, 5 and 7 of [access-control](protocols/access-control.md).
3. Payments and entitlements. Prices on the server, webhooks verified and idempotent, the paid state from the provider, entitlements from the mirrored state. Steps 2 to 5 and 7 of [payments-and-webhooks](protocols/payments-and-webhooks.md).
4. Authentication. Rotation and logout, credential storage and throttling, emailed links, enumeration, delegated sign-in and passkeys. Steps 2, 4, 5, 6, 8 and 9 of [authentication-and-session](protocols/authentication-and-session.md).
5. Versions and supply. The runtime on a supported line, frameworks at or above their fix, the deployed build carrying them, the pipeline installing from the lockfile. Steps 1, 3 and 6 of [version-floor](protocols/version-floor.md); steps 3 and 5 of [supply-chain](protocols/supply-chain.md).
6. Business logic. A single-use value spent once under parallel requests, and flows that cannot be skipped. Steps 2 and 3 of [business-logic](protocols/business-logic.md).
7. Outbound requests. Internal and metadata addresses refused through every fetch, redirects and resolution included. Steps 2 and 3 of [outbound-requests](protocols/outbound-requests.md).
8. Injection and output. Paths, an injected script blocked, redirects and mail headers. Steps 3, 5, 6 and 8 of [injection-and-output](protocols/injection-and-output.md).
9. Transport and cross-site requests. HTTPS and strict transport, headers on errors, the session cookie, forgery tokens, cross-origin access and framing. Steps 1, 5 and 6 of [headers-and-transport](protocols/headers-and-transport.md); steps 1, 4 and 5 of [cross-site-requests](protocols/cross-site-requests.md); step 1 of [authentication-and-session](protocols/authentication-and-session.md).
10. Browser code. Message origins, URL values reaching the page, and sockets. Steps 1 to 3 of [client-side](protocols/client-side.md).
11. Uploads. Type by content on the deployed storage path, files served as data, the owner checked. Steps 1, 3 and 6 of [file-upload](protocols/file-upload.md).
12. Model surfaces. The key on the server, injection reaching nothing privileged, caps, and retrieval filtered by the caller. Steps 1, 4, 6 and 8 of [model-exposure](protocols/model-exposure.md).
13. Store and infrastructure. Grants, row policies, container images and infrastructure files. Steps 2 and 3 of [data-store](protocols/data-store.md); steps 8 and 9 of [deployment-surface](protocols/deployment-surface.md).
14. Limits. A limit on every entry point and every flow with value. Steps 1, 2 and 6 of [resource-limits](protocols/resource-limits.md).
15. Logging and errors. No internals in error responses, and security events written and readable. Steps 3 and 4 of [logging-and-errors](protocols/logging-and-errors.md).
16. Personal data and notices. Consent, scripts before a choice, deletion, unsubscribe and notices matching the code. Steps 2 to 6 of [personal-data](protocols/personal-data.md).

## Readiness topics

A production-readiness statement names which topics apply, which are solved and which are pending, and "works locally" is never the evidence. Its security topics are answered by this pass:

- Secrets and keys: item 1, and step 6 of [secrets](protocols/secrets.md) for one least-privilege key per consumer.
- IAM: the grants of item 13, and the key scope in [secrets-and-configuration](categories/secrets-and-configuration.md#key-scope-and-rotation).
- OAuth, signed tokens and key rotation: steps 7 and 8 of [authentication-and-session](protocols/authentication-and-session.md).
- TLS, encryption in transit and at rest: item 9, and step 5 of [data-store](protocols/data-store.md).
- CORS, request forgery and injection: items 8 and 9.
- WAF and DDoS: no step of their own; the pass records whether a WAF or a provider's flood protection stands in front of the public origin, or that none does, beside the limits of item 14.

The other topics of such a statement, such as resilience, delivery and observability, are engineering and are not part of this pass.

## Closing rule

The pass closes with zero open fails. A fail deferred instead of fixed is a risk acceptance, a decision recorded with a name against it, as [rules-of-engagement.md](rules-of-engagement.md#where-the-pass-stops-and-a-person-decides) sets out.
