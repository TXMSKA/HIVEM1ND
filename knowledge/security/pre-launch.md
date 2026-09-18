# Pre-launch pass

The last pass before an application goes public. It runs on the deployed environment, never on a development machine, because every item below is a property of what is serving traffic. It repeats checks the protocols already define; what it adds is the order and the rule that nothing ships with an open fail.

Each item is recorded as pass, fail or not applicable, with the artifact from [evidence.md](evidence.md) that supports the verdict and the fix when it fails. Not applicable carries the reason, such as no payments or no model calls.

## Order

The order is priority: the items that lose money or accounts come first, so a pass cut short still covered them.

1. **Payments.** Webhook signatures verified and replays idempotent, prices computed on the server. Steps 2 to 4 of [payments-and-webhooks](protocols/payments-and-webhooks.md).
2. **Authentication.** Session identifier rotated on login and on password change, reset links single use and expiring, no account enumeration, lockout or delay after failed logins. Steps 2, 4, 5 and 6 of [authentication-and-session](protocols/authentication-and-session.md).
3. **Transport and requests.** HSTS live with a real max-age, forgery tokens in place, session cookies carrying `HttpOnly`, `Secure` and `SameSite`. Step 6 of [headers-and-transport](protocols/headers-and-transport.md), step 1 of [cross-site-requests](protocols/cross-site-requests.md), step 1 of [authentication-and-session](protocols/authentication-and-session.md).
4. **Model surfaces.** Injected instructions reach nothing privileged, usage capped per account, request size limited. Steps 4 and 6 of [model-exposure](protocols/model-exposure.md).
5. **Origins.** Cross-origin access restricted to an exact list of origins, never a wildcard with credentials. Step 4 of [cross-site-requests](protocols/cross-site-requests.md).
6. **Uploads.** The type allowlist enforced on the deployed storage path, not only in the handler. Steps 1 and 3 of [file-upload](protocols/file-upload.md).
7. **Infrastructure.** No environment file served, no default credential, stock admin routes removed, directory listing disabled, source maps off the public origin, from [deployment-surface](protocols/deployment-surface.md). Database privileges reduced to what the application uses and row policies on every table the browser reaches, steps 2 and 3 of [data-store](protocols/data-store.md). Security events written and readable, step 4 of [logging-and-errors](protocols/logging-and-errors.md).

## Closing rule

The pass closes with zero open fails. A fail that is deferred instead of fixed is a risk acceptance, which is a person's decision and is recorded with a name against it, as [rules-of-engagement.md](rules-of-engagement.md) sets out.
