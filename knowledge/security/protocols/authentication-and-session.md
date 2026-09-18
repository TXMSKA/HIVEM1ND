name: authentication-and-session
purpose: Prove a session cannot be forged, fixed, replayed or kept alive after logout.
trigger: manual, on any login, registration, password reset, token issue, cookie or logout path
repeat: once per audit, and again after any change to the session store, the cookie attributes or the reset flow
inputs: test accounts created for the pass, a request client that shows headers, the session store, the source of the credential handling
stop: a session identifier survives logout or does not change at login, which is reported before the pass continues
report: the cookie attribute line as served, the identifier before and after login, the replay results, the enumeration comparison, and the token lifetimes

## Steps

1. Read the cookie exactly as it is served.
   Task: `curl -sI https://<host>/<login-path>` and read every `Set-Cookie` line, on the login response and on the response that establishes the session.
   Time: 15 minutes. Running application.
   Result: the verbatim attribute line per cookie. The session cookie carries `HttpOnly`, `Secure` and an explicit `SameSite`, and is named with the `__Host-` prefix, which the browser only accepts with `Secure` set, `Path=/` and no `Domain` attribute, and only from a secure origin.

2. Prove the identifier rotates and dies.
   Task: record the session identifier before authenticating, authenticate, record it again. Then log out and replay the pre-logout identifier against an authenticated endpoint.
   Time: 20 minutes. Running application, with a read against the session store.
   Result: the two identifiers differ, the replayed identifier returns 401, and the session row is gone from the store or marked revoked. A logout that only clears the cookie leaves the session alive and is a finding.

3. Do not let the cookie attribute carry the forgery defence.
   Task: confirm a synchronizer token or a signed double submit token bound to the session on every state-changing request. `SameSite` is defence in depth: some browsers apply `Lax` as a default in a more permissive form that still sends the cookie on a cross-site `POST` when the cookie was set within the previous two minutes, which is a usable window.
   Time: 25 minutes. Running application.
   Result: a state-changing `POST` carrying a valid session and no token returns 403, recorded with the status code, and the same request with a token belonging to a different session also returns 403.

4. Check how credentials are stored and how often they may be tried.
   Task: read the hashing algorithm and its parameters from the source. Then drive repeated failed logins against one account and against many accounts from one address.
   Time: 30 minutes. Repository, plus running application.
   Result: the algorithm and its work factor quoted from the source with a file reference, and the status code at which the lockout or throttle engages, per account and per address, with the count that triggered it.

5. Make the reset flow single use and short lived.
   Task: request a reset, use the link, then use it again. Request a second reset while the first is unused. Let one expire.
   Time: 25 minutes. Running application.
   Result: the second use of a consumed link fails with its status code, the earlier token is invalidated when a new one is issued, and an expired token fails, each recorded as a request and response pair.

6. Close the enumeration channels.
   Task: compare the status, the body and the response timing for a registered and an unregistered account, on login, on reset and on registration.
   Time: 20 minutes. Running application.
   Result: identical status and body in both cases, and response timings recorded as a range per case with the two ranges overlapping.

7. Set the token lifetimes and the second factor.
   Task: record the access token lifetime and the refresh behaviour, replaying a refresh token that has already been exchanged. **Needs a person**: what lifetime is acceptable, and whether a second factor is required for the population using the application, are policy decisions.
   Time: 20 minutes. Running application.
   Result: the access token lifetime in seconds, and a replayed refresh token rejected with its status code. The policy decision is recorded with a name against it.
