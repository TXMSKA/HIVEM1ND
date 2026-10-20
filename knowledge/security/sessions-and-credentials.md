# Sessions and credentials

Who the caller is, and how that is proved on every request. Every rule here exists because the opposite failure has a name: session fixation, account enumeration, credential stuffing, token forgery. The values are in [essentials.md](essentials.md#default-values) and the checks in [authentication-and-session](protocols/authentication-and-session.md).

## Identity comes from the session

The user identifier and the role are read from the server-side session or from a verified token. Nothing in the body, the query, the path parameters or the headers of a request decides who the caller is. A client-side check is a suggestion: the interface hides a button and the server enforces the rule.

## Sessions or tokens

| Choice | When | Cost |
| --- | --- | --- |
| Server-side session: a random identifier in a cookie, mapped to a store entry that holds only its hash | The default for an application that serves its own pages | One store lookup per request. Revocation is a delete. |
| Signed token, short lived, in minutes, with a single-use refresh token | Only when a third party must verify the caller without calling the service | Revocation needs a deny list or a short lifetime. The signing key is a secret with its own rotation. |

A signed token uses a long random secret loaded from the environment and never written in the source, and the verifier pins the expected algorithm and rejects `none`.

## Tokens in URLs

A session identifier, an access token or a refresh token never goes in a URL, a log line or browser storage; it travels in a cookie or in the `Authorization` header. Browser storage holds only what is local to the device.

The one exception is a single-use, short-lived, purpose-bound token in an emailed link, such as a reset, verification, invitation or setup link:

- The link's origin comes from configuration, never from the request's `Host` header.
- The token rides in the fragment where the flow allows, since the browser sends the fragment to no server, log or referrer.
- The page that receives it answers with `Referrer-Policy: no-referrer` and exchanges the token on first load for a short-lived value bound to that browser session; the token is spent by the exchange.

## Cookie attributes

`HttpOnly`, `Secure`, an explicit `SameSite` (`Lax` by default, `Strict` for an administrative surface), a `Path` and an expiry. The `__Host-` prefix keeps a subdomain from setting the cookie; the browser accepts it only with `Secure`, `Path=/`, no `Domain` attribute and from a secure origin. `SameSite` is defence in depth behind a forgery token, never the control.

## Session lifetime

The identifier rotates on login, on a privilege change and after a password change. A password change or reset invalidates every other session of the account. Sessions carry an idle and an absolute timeout, checked on every request against the stored last-seen and created times. Signing out deletes or revokes the session on the server; clearing the cookie alone leaves the session alive for whoever holds a copy.

## Password storage

Argon2id first, scrypt as the alternative and bcrypt as the fallback, at the parameters in [essentials.md](essentials.md#default-values). The salt is part of the algorithm and is never rolled by hand. How it runs matters as much as the parameters:

- Stored as a PHC string, which carries the algorithm, the parameters and the salt, so old hashes are upgraded at the next login.
- Taken from the runtime's standard library where it ships, which removes a native dependency.
- Bounded in concurrency: a small fixed number of hashes run at once, a short queue waits, and anything beyond answers 503.
- Compared in constant time, with a fixed dummy hash made at startup verified when no account matches, so both paths cost the same.

Plain text, MD5, SHA-1 and unsalted SHA-256 are never acceptable. Length is required rather than composition rules, and new passwords are refused when they appear on the bundled list of common passwords. A breached-password range service, queried with a hash prefix, adds coverage; it is an outbound dependency, and when it is unreachable the bundled list still applies.

## Uniform answers

Login, registration and reset answer with the same status, the same text and the same timing whether the account exists or not. The login error never says which factor failed.

- Login: the same message for an unknown account and a wrong password, and the dummy hash verified when no account matches.
- Registration confirms the address first: the endpoint always answers 202 with the same body; a new address receives a verification link and the account is created only when it is used; an address already registered receives a notice that someone tried to register it.
- Reset answers before the lookup: the response is sent first, and the lookup, the token and the mail happen after it.

## Throttling

Every endpoint a stranger can reach, login, registration, reset and verification, is rate limited per account and per address with backoff. Reset and verification mail is also limited per target address and answers the same when limited. A soft lock, a growing delay, comes before a hard lock, and consecutive failures on one account never exceed the ceiling in [essentials.md](essentials.md#default-values). The unlock path expires on its own or goes through the verified reset flow.

Under automated attack those limits fail: the traffic comes from thousands of addresses, credential stuffing tries one or two passwords per account, and every fake attempt burns a hash. A cheap risk check placed before the hash combines signals such as the client's TLS fingerprint, its failure rate and whether the device is known into one score: low goes on to the hash, medium gets a challenge, high is dropped before the hash runs.

## Reset, invitation and setup links

A reset token is random, single use, bound to the account, expires in minutes and is invalidated when used or when a new one is issued. The link goes only to the address already on file and is built as [Tokens in URLs](#tokens-in-urls) sets out. Only the hash of the token is stored. The new password is validated before the exchanged value is spent, so a rejected password does not burn the link. Using it revokes every other session of the account and marks the address verified; the user signs in afterwards. An invitation link follows the same rules.

The first administrative account gets no privileged path of its own:

- One-time setup link: the migration that creates the first account prints a single-use setup link, and the owner sets a username, a password and a second factor through the same flow any invited account uses. A password from an earlier scheme is discarded.
- Bootstrap variable: the first password is read from an environment variable only while the accounts table is empty, and the variable is removed after first use.

A login branch that accepts a legacy credential for one account is the pattern to avoid.

## Second factor

A second factor is required for anything that administers money, accounts or content: passkeys or time-based one-time codes, text messages only as a last resort. A passkey is verified against the relying party identifier and the exact origin list, per step 9 of [authentication-and-session](protocols/authentication-and-session.md). Whether the whole population needs one is a policy decision with a name against it.

The events these flows write are listed in step 4 of [logging-and-errors](protocols/logging-and-errors.md).
