# Identity

Who the caller is and how that is proved on every request: login, sessions, tokens, reset and invitation links, the first account, throttling, delegated sign-in and the second factor. The values behind every option are in [sessions-and-credentials.md](../sessions-and-credentials.md) and [essentials.md](../essentials.md#default-values).

## Login and credential storage

Applies when: a login form, a registration flow or a password change is added; the hashing library or its parameters change; credentials are imported from another system.

Build: Hash as [sessions-and-credentials.md](../sessions-and-credentials.md#password-storage) sets out, at the parameters in [essentials.md](../essentials.md#default-values).

Options:

- **Argon2id.** The first choice, at the parameters in [essentials.md](../essentials.md#default-values) or higher where memory allows.
- **Scrypt.** When Argon2id is not available.
- **Bcrypt.** The fallback, with its 72-byte limit on the password.
- **Delegated sign-in through an identity provider.** When the application should hold no passwords at all, below.

Open: step 4 of [authentication-and-session](../protocols/authentication-and-session.md).

## Sessions and cookies

Applies when: a session store, a cookie or its attributes change; logout is built; a timeout is set; a privilege change happens inside a session.

Build: Issue 32 random bytes, store only their hash, and set the attributes in [sessions-and-credentials.md](../sessions-and-credentials.md#cookie-attributes). Replace the identifier at login and delete the one presented, delete the row at logout, and check both timeouts from [essentials.md](../essentials.md#default-values) on every request.

Options:

- **Server-side session with a random identifier in a cookie.** The default for an application that serves its own pages. Revocation is a delete.
- **`SameSite=Lax` for the application, `Strict` for an administrative surface.**

Open: steps 1, 2 and 3 of [authentication-and-session](../protocols/authentication-and-session.md).

## Signed tokens

Applies when: a JSON web token or another signed token is issued or verified; a refresh flow is built; a third party must verify callers without calling the service.

Build: Issue one only when a third party must verify it. Pin the algorithm in the verifier, keep the lifetime in minutes, make the refresh token single use, and load the signing key from the environment at the length in [essentials.md](../essentials.md#default-values).

Options:

- **Only when a third party must verify without calling the service.** Otherwise a server-side session is simpler and revocable.
- **Short lifetime in minutes plus a single-use refresh token.** When tokens are used.

Open: step 7 of [authentication-and-session](../protocols/authentication-and-session.md); [sessions-and-credentials.md](../sessions-and-credentials.md#sessions-or-tokens).

## Delegated sign-in

Applies when: sign-in through an OAuth 2 or OpenID Connect provider is added or changed; a redirect URI is registered; accounts are linked to a provider identity.

Build: Register an exact list of redirect URIs, send a single-use `state` bound to the browser session and PKCE with `S256`, exchange the code once on the server, validate the ID token's signature, algorithm, `iss`, `aud`, `exp` and `nonce`, and link the account by `iss` and `sub`.

Options:

- **Authorization code with PKCE, exchanged on the server.** The only flow for a web application.
- **Account linking by a verified email address.** Only when the provider marks the address verified, and only after the person signs in to the existing account.

Open: step 8 of [authentication-and-session](../protocols/authentication-and-session.md).

## Password reset, invitations and the first account

Applies when: a reset flow, an invitation link, an email verification link or a setup link is built; the first administrative account is created; an old admin credential is migrated.

Build: Follow [sessions-and-credentials.md](../sessions-and-credentials.md#reset-invitation-and-setup-links), with the link built as [its token rule](../sessions-and-credentials.md#tokens-in-urls) sets out.

Options:

- **Random single-use token, bound to the account, expiring in minutes.** For every emailed link.
- **First account through a one-time setup link printed by the migration.** The owner goes through the same flow as any invited account.
- **First account from a bootstrap variable.** Read only while the accounts table is empty and removed after first use.

Open: step 5 of [authentication-and-session](../protocols/authentication-and-session.md).

## Enumeration, throttling and bots

Applies when: a login, registration, reset or verification endpoint is added or its messages change; a lockout is configured; a form is exposed to strangers; login is hit by automated attempts.

Build: Build the uniform answers of [sessions-and-credentials.md](../sessions-and-credentials.md#uniform-answers) and the throttling of [its next section](../sessions-and-credentials.md#throttling), under the ceiling in [essentials.md](../essentials.md#default-values).

Options:

- **Soft lock before hard lock.** A growing delay per account and per address, so an attacker cannot lock the owner out.
- **A cheap risk check before the expensive hash.** For a login under automated attack, where address blocking, per-account limits and lockouts each fail alone.
- **Bot protection proportional to the risk.** A honeypot field or a short delay for a contact form; proof of work or a challenge for a flow with value.

Open: steps 4 and 6 of [authentication-and-session](../protocols/authentication-and-session.md); step 1 of [resource-limits](../protocols/resource-limits.md).

## Second factor

Applies when: a role administers money, accounts or content; a second factor or a passkey is added, or its recovery is built.

Build: Offer passkeys with the relying party identifier from configuration and the origin checked against an exact list, or time-based codes with a 30 second step; store recovery codes hashed, and require full re-authentication before the factor or the recovery address changes.

Options:

- **Passkeys.** Phishing-resistant, and the strongest choice where the population's devices support them.
- **Time-based one-time codes.** Widely supported, with recovery codes as the fallback.
- **Text messages.** A last resort only.

Whether the whole population needs a second factor is a person's decision.

Open: steps 7 and 9 of [authentication-and-session](../protocols/authentication-and-session.md); [sessions-and-credentials.md](../sessions-and-credentials.md#second-factor).
