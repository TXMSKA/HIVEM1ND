name: authentication-and-session
purpose: Prove a session cannot be forged, fixed, replayed or kept alive after logout, and that no account can be listed, guessed or taken over through reset, invitation, setup, delegated sign-in or a passkey.
scope: login, registration, password reset, invitation and setup links, session cookies, token issue and refresh, logout, delegated sign-in, passkeys and the second factor
trigger: task close
repeat: once
inputs: test accounts as allowed by [rules-of-engagement.md](../rules-of-engagement.md#test-accounts), a request client that shows headers, the test session store, the source of the credential handling, a browser that offers a virtual authenticator
stop: a session identifier survives logout or does not change at login, which is reported at once and ends the protocol
report: the cookie attribute line as served, the identifier before and after login, the replay and expiry results, the credential storage parameters, the throttling results, the link results, the enumeration comparison, the token lifetimes, and the delegated sign-in and passkey readings

## Steps

1. Read the cookie exactly as it is served.
   Task: `curl -sI https://<host>/<login-path>`, written `curl.exe` in Windows PowerShell, and read every `Set-Cookie` line, on the login response and on the response that establishes the session.
   Time: 15 minutes. Running application.
   Result: the verbatim attribute line per cookie, matching [sessions-and-credentials.md](../sessions-and-credentials.md#cookie-attributes): `HttpOnly`, `Secure`, an explicit `SameSite`, a `Path`, an expiry and the `__Host-` prefix.

2. Prove the identifier rotates and dies.
   Task: first read the repository, on every pass: the logout route and what it does to the server-side session, and the idle and absolute timeouts checked on each request, with file references. Then record the session identifier before authenticating, authenticate, record it again, change the password and record it a third time. Log out and replay the pre-logout identifier. For the timeouts, move a test session's last-seen and created times past each limit in the test store, then send one request with it.
   Time: 30 minutes. Repository, plus running application with the test session store.
   Result: the repository read names a logout route that deletes or revokes the server-side session and both timeouts in seconds; any one of the three absent is a finding, and the runtime test that depends on it is not run. At runtime, the identifier differs after login and again after the password change, every other session of that account is revoked by the change, the replayed identifier returns 401 with the session row gone or marked revoked, and each moved session returns 401. A logout that only clears the cookie is a finding.

3. Keep the session out of places that leak.
   Task: search the source for a session identifier or a token written to a URL, a log statement or browser storage: `git grep -n -I -i -E '(localStorage|sessionStorage)\.setItem\([^)]*(token|session|jwt|auth)'`, `git grep -n -I -i -E '(console\.[a-z]+|logger\.[a-z]+|log\.[a-z]+)\([^)]*(token|password|secret|session|authorization|cookie)'` and `git grep -n -I -i -E '[?&](token|access_token|session|sid|jwt|auth)='`, with planted `localStorage.setItem(token, t)`, `logger.info(token)` and `/cb?token=x` as the positive controls. Then read the browser storage and the address bar after logging in. The one URL allowed is the emailed link of [sessions-and-credentials.md](../sessions-and-credentials.md#tokens-in-urls).
   Time: 20 minutes. Repository, plus a browser.
   Result: zero hits for each expression outside that link's flow, and the browser storage after login holding no session identifier or token.

4. Check how credentials are stored and how often they may be tried.
   Task: read the hashing algorithm and its parameters from the source, against [essentials.md](../essentials.md#default-values). Then drive repeated failed logins against one account and against many accounts from one address, stopping at the first refusal, per [rules-of-engagement.md](../rules-of-engagement.md#what-a-pass-may-never-do).
   Time: 30 minutes. Repository, plus running application.
   Result: the algorithm and its parameters quoted with a file reference, a constant-time comparison, and a breached-password check on new passwords. The status code at which the delay or lock engages, per account and per address, with the count that triggered it, and the unlock path, which expires on its own or goes through the verified reset flow.

5. Make every emailed link single use and short lived.
   Task: request a reset, use the link, then use it again. Request a second reset while the first is unused. Let one expire, or move its creation time in the test store. Drive repeated reset requests for one address up to the first refusal. Repeat the reuse and expiry tests on invitation links and on the setup link that creates the first administrative account, and read how the first account is created.
   Time: 30 minutes. Running application, plus a repository read.
   Result: the second use of a consumed link failing with its status code, the earlier token invalidated when a new one is issued, an expired token failing, and the endpoint rate limit engaging with its status code, each recorded as a request and response pair. The first account is created as [sessions-and-credentials.md](../sessions-and-credentials.md#reset-invitation-and-setup-links) sets out, and no login branch accepts a legacy credential for a single account.

6. Close the enumeration channels.
   Task: compare the status, the body and the response timing for a registered and an unregistered account, on login, on reset and on registration, against [sessions-and-credentials.md](../sessions-and-credentials.md#uniform-answers).
   Time: 20 minutes. Running application.
   Result: identical status and body in both cases, and response timings recorded as a range per case with the two ranges overlapping.

7. Set the token lifetimes and the second factor.
   Task: record the access token lifetime and the refresh behaviour, replaying a refresh token that has already been exchanged. For signed tokens, read where the signing secret comes from, confirm the verifier pins the expected algorithm, and send a token with the algorithm set to `none` and one signed with a different algorithm. Search for a signing secret written as a literal: `git grep -n -I -i -E '(jwt|signing|session|token)[_-]?secret *[:=] *.?[A-Za-z0-9+/=_-]{16,}'`, with a planted `JWT_SECRET = 0123456789abcdef0123` as the positive control. Record which roles require a second factor and which factors are accepted. Needs a person: the acceptable lifetime, and whether the whole population needs a second factor.
   Time: 30 minutes. Repository, plus running application.
   Result: the access token lifetime in seconds, a replayed refresh token rejected with its status code, both forged tokens rejected with theirs, zero literal signing secrets, the secret loaded from the environment at the length in [essentials.md](../essentials.md#default-values), the key rotation procedure named, and every role that administers money, accounts or content requiring a second factor.

8. Check delegated sign-in from the request to the callback.
   Task: read the client configuration and the callback handler for an OAuth 2 or OpenID Connect provider. The registered redirect URIs are an exact list with no wildcard or prefix match, read by the person in the provider's console or from the repository where they are declared. The authorization request carries a single-use `state` bound to the browser session and PKCE with `S256`. The callback compares `state`, exchanges the code once on the server, and for OpenID Connect validates the ID token: signature against the provider's published keys, the pinned algorithm, `iss`, `aud` equal to the client identifier, `exp`, and the `nonce` it sent. The account is linked by the provider's `iss` and `sub`, never by an email address the provider has not marked verified. Then replay a used callback URL and send one with an altered `state`, against the application only.
   Time: 30 minutes. Repository, plus running application with a provider test account the owner supplies.
   Result: each check quoted with file and line, the replayed callback and the altered `state` refused with their status codes, and the redirect list recorded. Without delegated sign-in, not applicable; without a provider test account, the runtime part is not run.

9. Check passkeys against their origin and relying party.
   Task: read the registration and authentication options and the verifier. The relying party identifier comes from configuration and equals the registrable domain the site is served from. The verifier checks the client data `type`, its `origin` against an exact list, a challenge generated on the server, single use and short lived, the relying party hash, the user presence flag and user verification as the policy requires, and the signature with the stored public key of that credential, bound to one account. Then, with the browser's virtual authenticator, replay an authentication response and send one whose challenge belongs to another session.
   Time: 25 minutes. Repository, plus running application with a browser.
   Result: each check quoted with file and line, and the replayed and mismatched responses refused with their status codes. Without passkeys, not applicable.
