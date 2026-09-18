# Identity

Who the caller is and how that is proved on every request: login, sessions, tokens, reset and invitation links, the first account, throttling and the second factor. The values behind every option are in [sessions-and-credentials.md](../sessions-and-credentials.md).

## Login and credential storage

**Applies when:** a login form, a registration flow or a password change is added; the hashing library or its parameters change; credentials are imported from another system.

**Options:**

- **Argon2id.** The first choice, at the working baseline of memory 64 MB, iterations 3 and parallelism 1, above the published minimum.
- **Scrypt.** When Argon2id is not available.
- **Bcrypt.** The fallback, with a work factor of 10 or more and a 72-byte maximum on the password.
- **Delegated sign-in through an identity provider.** When the application should hold no passwords at all. Moves the risk to the provider and the callback, which then needs its own review.

**Open:** step 4 of [authentication-and-session](../protocols/authentication-and-session.md); [sessions-and-credentials.md](../sessions-and-credentials.md#password-storage).

## Sessions and cookies

**Applies when:** a session store, a cookie or its attributes change; logout is built; a timeout is set; a privilege change happens inside a session.

**Options:**

- **Server-side session with a random identifier in a cookie.** The default for an application that serves its own pages. Revocation is a delete.
- **`SameSite=Lax` for the application, `Strict` for an administrative surface.** Both with `HttpOnly`, `Secure`, a `Path`, an expiry and the `__Host-` prefix.

**Open:** steps 1, 2 and 3 of [authentication-and-session](../protocols/authentication-and-session.md); [sessions-and-credentials.md](../sessions-and-credentials.md#cookie-attributes).

## Signed tokens

**Applies when:** a JSON web token or another signed token is issued or verified; a refresh flow is built; a third party must verify callers without calling the service.

**Options:**

- **Only when a third party must verify without calling the service.** Otherwise a server-side session is simpler and revocable.
- **Short lifetime in minutes plus a single-use refresh token.** When tokens are used. The signing key is a long random secret from the environment, the algorithm is pinned and `none` is rejected.

**Open:** step 7 of [authentication-and-session](../protocols/authentication-and-session.md); [sessions-and-credentials.md](../sessions-and-credentials.md#sessions-or-tokens).

## Password reset, invitations and the first account

**Applies when:** a reset flow, an invitation link, an email verification link or a setup link is built; the first administrative account is created; an old admin credential is migrated.

**Options:**

- **Random single-use token, bound to the account, expiring in minutes.** For every emailed link. A new token invalidates the old one, and the link goes only to the address already on file.
- **First account through a one-time setup link printed by the migration.** The owner goes through the same flow as any invited account, and any older password is discarded.
- **First account from a bootstrap variable.** Read only while the accounts table is empty and removed after first use. Simpler, with the variable as a secret for its short life.

**Open:** step 5 of [authentication-and-session](../protocols/authentication-and-session.md); [sessions-and-credentials.md](../sessions-and-credentials.md#reset-invitation-and-setup-links).

## Enumeration, throttling and bots

**Applies when:** a login, registration, reset or verification endpoint is added or its messages change; a lockout is configured; a form is exposed to strangers.

**Options:**

- **Uniform answers.** Same status, same text and same timing whether the account exists or not. Always.
- **Soft lock before hard lock.** A growing delay per account and per address, so an attacker cannot lock the owner out.
- **Bot protection proportional to the risk.** A honeypot field or a short delay for a contact form; proof of work or a challenge for a flow with value. A third-party challenge brings cookies and a privacy notice update.

**Open:** steps 4 and 6 of [authentication-and-session](../protocols/authentication-and-session.md); step 1 of [resource-limits](../protocols/resource-limits.md).

## Second factor

**Applies when:** a role administers money, accounts or content; a second factor is added or its recovery is built.

**Options:**

- **Passkeys.** Phishing-resistant, and the strongest choice where the population's devices support them.
- **Time-based one-time codes.** Widely supported, with recovery codes as the fallback.
- **Text messages.** A last resort only.

Whether the whole population needs a second factor is a person's decision.

**Open:** step 7 of [authentication-and-session](../protocols/authentication-and-session.md); [sessions-and-credentials.md](../sessions-and-credentials.md#second-factor).
