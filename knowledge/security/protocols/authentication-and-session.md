name: authentication-and-session
purpose: Prove a session cannot be forged, fixed, replayed or kept alive after logout, and that no account can be listed, guessed or taken over through reset, invitation or setup.
scope: login, registration, password reset, invitation and setup links, session cookies, token issue and refresh, logout and second factor
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, and again after any change to the session store, the cookie attributes, the credential storage or the reset flow
inputs: test accounts created for the pass, a request client that shows headers, the session store, the source of the credential handling
stop: a session identifier survives logout or does not change at login, which is reported before the pass continues
report: the cookie attribute line as served, the identifier before and after login, the replay results, the credential storage parameters, the throttling results, the link results, the enumeration comparison, and the token lifetimes

## Steps

1. Read the cookie exactly as it is served.
   Task: `curl -sI https://<host>/<login-path>` and read every `Set-Cookie` line, on the login response and on the response that establishes the session.
   Time: 15 minutes. Running application.
   Result: the verbatim attribute line per cookie. The session cookie carries `HttpOnly`, `Secure`, an explicit `SameSite`, a `Path` and an expiry, and is named with the `__Host-` prefix, which the browser only accepts with `Secure` set, `Path=/` and no `Domain` attribute, and only from a secure origin. The attribute values are in [sessions-and-credentials.md](../sessions-and-credentials.md).

2. Prove the identifier rotates and dies.
   Task: record the session identifier before authenticating, authenticate, record it again. Change the password and record it a third time. Then log out and replay the pre-logout identifier against an authenticated endpoint. Read the idle timeout and the absolute timeout from the configuration, and let a session pass each one.
   Time: 30 minutes. Running application, with a read against the session store.
   Result: the identifier differs after login and again after the password change, every other session of that account is revoked by the change, the replayed identifier returns 401, and the session row is gone from the store or marked revoked. Both timeouts are recorded in seconds, and a session past each one returns 401. A logout that only clears the cookie leaves the session alive and is a finding.

3. Keep the session out of places that leak.
   Task: search the source for a session identifier or a token written to a URL, a log statement or `localStorage`, and read the browser storage and the address bar after logging in.
   Time: 20 minutes. Repository, plus a browser.
   Result: zero hits for each pattern, recorded with the search expressions, and the browser storage after login holding no session identifier or token.

4. Check how credentials are stored and how often they may be tried.
   Task: read the hashing algorithm and its parameters from the source, against the baseline in [sessions-and-credentials.md](../sessions-and-credentials.md). Then drive repeated failed logins against one account and against many accounts from one address, and stop at the point the throttle engages, per [rules-of-engagement.md](../rules-of-engagement.md).
   Time: 30 minutes. Repository, plus running application.
   Result: the algorithm and its parameters quoted from the source with a file reference, a constant-time comparison, and a breached-password check on new passwords. The status code at which the lockout or progressive delay engages, per account and per address, with the count that triggered it. The unlock path is recorded too: it expires on its own or goes through the verified reset flow, and an attacker cannot use it to keep the owner locked out.

5. Make every emailed link single use and short lived.
   Task: request a reset, use the link, then use it again. Request a second reset while the first is unused. Let one expire. Drive repeated reset requests for one address. Repeat the reuse and expiry tests on invitation links and on the setup link that creates the first administrative account, and read how the first account is created.
   Time: 30 minutes. Running application, plus a repository read.
   Result: the second use of a consumed link fails with its status code, the earlier token is invalidated when a new one is issued, an expired token fails, and the endpoint rate limit engages with its status code, each recorded as a request and response pair. The first administrative account is created through the same flow as any invited account or from a bootstrap variable read only while the accounts table is empty, and no login branch accepts a legacy credential for a single account.

6. Close the enumeration channels.
   Task: compare the status, the body and the response timing for a registered and an unregistered account, on login, on reset and on registration.
   Time: 20 minutes. Running application.
   Result: identical status and body in both cases, and response timings recorded as a range per case with the two ranges overlapping.

7. Set the token lifetimes and the second factor.
   Task: record the access token lifetime and the refresh behaviour, replaying a refresh token that has already been exchanged. For signed tokens, read where the signing secret comes from, confirm the verifier pins the expected algorithm, and send a token with the algorithm set to `none` and one signed with a different algorithm. Record which roles require a second factor and which factors are accepted. **Needs a person**: what lifetime is acceptable, and whether a second factor is required for the population using the application, are policy decisions.
   Time: 30 minutes. Repository, plus running application.
   Result: the access token lifetime in seconds, a replayed refresh token rejected with its status code, and both forged tokens rejected with theirs. The signing secret is long, random and loaded from the environment, never a literal in the source, with the search for it returning zero hits and the key rotation procedure named. Every role that administers money, accounts or content requires a second factor, and the policy decision is recorded with a name against it.
