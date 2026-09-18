# Sessions and credentials

Who the caller is, and how that is proved on every request. Every rule here exists because the opposite failure has a name: session fixation, account enumeration, credential stuffing, token forgery. The checks are in [authentication-and-session](protocols/authentication-and-session.md).

## Identity comes from the session

The user identifier and the role are read from the server-side session or from a verified token. Nothing in the body, the query, the path parameters or the headers of a request decides who the caller is. A client-side check is a suggestion: the interface hides a button and the server enforces the rule.

## Sessions or tokens

| Choice | When | Cost |
| --- | --- | --- |
| Server-side session: a random identifier of at least 128 bits in a cookie, mapped to a row or a store entry | The default for an application that serves its own pages | One store lookup per request. Revocation is a delete. |
| Signed token such as a JSON web token, short lived, in minutes, with a refresh flow | Only when a third party must verify the caller without calling the service | Revocation needs a deny list or a short lifetime. The signing key becomes a secret with its own rotation. |

A signed token uses a long random secret loaded from the environment and never written in the source. The verifier pins the expected algorithm and rejects `none`. Keys rotate, and the refresh token is single use.

A session identifier or a token never goes in a URL, a log line or `localStorage`. Browser storage holds only what is local to the device; anything that belongs to the account lives on the server.

## Cookie attributes

`HttpOnly`, `Secure`, an explicit `SameSite` (`Lax` by default, `Strict` for an administrative surface), a `Path` and an expiry. The `__Host-` prefix is preferred so a subdomain cannot set the cookie; the browser accepts it only with `Secure`, `Path=/`, no `Domain` attribute and from a secure origin.

`SameSite` is not the forgery defence. It is defence in depth behind a token, for the reasons in [cross-site-requests](protocols/cross-site-requests.md).

## Session lifetime

The identifier rotates on login, on a privilege change and after a password change. A password change or reset invalidates every other session of the account. Sessions carry both an idle timeout and an absolute timeout. Signing out deletes or revokes the session on the server; clearing the cookie alone leaves the session alive for whoever holds a copy.

## Password storage

Argon2id is the first choice, with memory 64 MB, iterations 3 and parallelism 1 as the working baseline. The published minimum is 19 MiB of memory, an iteration count of 2 and 1 degree of parallelism, so the baseline sits above it. Scrypt is the alternative, and bcrypt the fallback, with a work factor of 10 or more and a maximum password length of 72 bytes, because most implementations ignore anything past it. The salt is part of the algorithm and is never rolled by hand. Hashes are compared in constant time.

Plain text, MD5, SHA-1 and unsalted SHA-256 are never acceptable. Length is required rather than composition rules, and new passwords are checked against a breached-password list.

## Uniform answers

Login, registration and reset answer with the same status, the same text and the same timing whether the account exists or not. A different answer is a user list for whoever asks. The login error never says which factor failed.

## Throttling

Every endpoint a stranger can reach, login, registration, reset and verification, is rate limited per account and per address with backoff. A soft lock, a growing delay, comes before a hard lock, so an attacker cannot keep the owner locked out. The unlock path expires on its own or goes through the verified reset flow. Bot protection is proportional to the risk: a honeypot field, a short delay, proof of work or a challenge. A third-party challenge brings cookies and a privacy notice update, so it is chosen deliberately.

## Reset, invitation and setup links

A reset token is random, single use, bound to the account, expires in minutes and is invalidated when used or when a new one is issued. The link goes only to the address already on file. An invitation link follows the same rules: never reusable.

The first administrative account gets no privileged path of its own. Two patterns hold up:

- **One-time setup link.** The migration that creates the first account prints a single-use setup link, and the owner sets a username, a password and a second factor through the same flow any invited account uses. A password from an earlier scheme is discarded rather than carried into the new row.
- **Bootstrap variable.** The first password is read from an environment variable only while the accounts table is empty, and the variable is removed after first use.

A login branch that accepts a legacy credential for one account is the pattern to avoid: it exists for one account and has to be maintained forever.

## Second factor

A second factor is required for anything that administers money, accounts or content. Time-based one-time codes or passkeys; text messages only as a last resort. Whether the whole population needs one is a policy decision with a name against it.

## Events

Login success and failure, reset, password change and role change are logged with the time, the account identifier and the address. Passwords, tokens and session identifiers are never logged. The event list is in [logging-and-errors](protocols/logging-and-errors.md).
