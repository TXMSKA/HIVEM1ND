# Essentials

The one file to read first for a build from scratch or a pass over a whole application. It holds the floor of the discipline and the concrete values a builder would otherwise invent. The category files add a `Build:` line per subcategory for how to build each part, and the protocols prove it afterwards. Work on one part of an application starts from [INDEX.md](INDEX.md) instead.

## Floor

**Access.** Identity comes from the server-side session and nothing in the request. Every handler checks the caller against the record in its first statements, a record belonging to another account answers 404, and a route with no declared access rule refuses. Writes accept an allowlist of fields; responses are built by a view function and never send a stored record as it is.

**Input and output.** Every input passes an allowlist schema with length and count caps, and unknown fields are refused. Queries bind every value, and identifiers that cannot be bound map through a fixed table. A filesystem path from a request is canonicalized and refused outside its base directory. Output is escaped at every sink by the same helper, and an enforcing content policy sits behind it.

**Sessions and credentials.** A random identifier in a `__Host-` cookie, its hash in the store, replaced at login and deleted at logout, with an idle and an absolute timeout checked on every request. Passwords are hashed with the parameters below and compared in constant time. Login, registration and reset answer the same way whether the account exists, built as in [sessions-and-credentials.md](sessions-and-credentials.md#uniform-answers).

**Secrets.** Read once at startup from the environment into one object, the boot fails on a missing one, and no secret has a fallback in code. Environment files are ignored from the first commit, and an example file lists every variable with an empty value.

**Outbound.** A server-side fetch of a URL from input goes through a host allowlist, and every resolved address is checked against [address-ranges.md](address-ranges.md) inside the connection's own address lookup.

**Money.** The server computes every amount from its own catalog in integer minor units. A webhook is verified over the raw body before anything reads it, and its amount and currency are compared with the record before any state changes, per [payments.md](payments.md#webhooks-received).

**Files.** Type decided by the first bytes against an allowlist, a generated name, storage outside the web root, and serving through a handler that checks the owner and sends `nosniff` and `Content-Disposition: attachment`.

**Limits.** Every entry point has a rate limit keyed on the address and the account, every body a size cap, every list a page cap, every outbound call a timeout, and every model call an input cap and an output token cap.

**Failure.** Errors fail closed, the caller gets a stable code and a request identifier, and the log gets the detail without secrets, tokens or bodies. Security events carry time, actor, address and outcome.

**Supply.** A supported runtime line, a committed lockfile, install scripts refused by default and a minimum release age, per [categories/dependencies.md](categories/dependencies.md).

## Default values

Each value was read at the source on 2026-09-18. Where the source gives a range or a ceiling, the default is picked inside it and the pick is marked. Choosing another value inside the source's bounds is legitimate and is recorded.

| Setting | Default | Source |
| --- | --- | --- |
| Session identifier | At least 128 bits from a secure random generator; 32 random bytes | [1] V7.2.3 |
| Any other unguessable token (reset, verification, invitation, forgery token) | At least 128 bits from a secure random generator, stored hashed; a UUID does not qualify | [1] V11.5.1 |
| Session idle timeout | 30 minutes (pick; 15 to 30 for low risk, 2 to 5 for high value) | [2]; [3] AAL2 at most 1 hour |
| Session absolute timeout | 8 hours (pick; 4 to 8 for a working day) | [2]; [3] AAL2 at most 24 hours, AAL3 at most 12 |
| Reset or verification link sent by email | 30 minutes (pick), single use; never past 24 hours | [3] recovery codes by email; [4] |
| One-time code sent out of band | At most 10 minutes; a time-based code 30 seconds | [1] V6.5.5 |
| Password length | At least 15 characters without a second factor, 8 with one; at least 64 accepted; verified exactly as received | [1] V6.2.1, V6.2.8, V6.2.9; [3]; [5] |
| Password refusal list | At least the 3,000 most common passwords that fit the policy, plus a breached set at Level 2 | [1] V6.2.4, V6.2.12 |
| Failed login ceiling | A growing delay per account and per address; never more than 100 consecutive failures per account | [3] |
| Argon2id | m=19456 (19 MiB), t=2, p=1, stored as a PHC string | [6] |
| Scrypt, when Argon2id is missing | N=2^17, r=8, p=1 | [6] |
| Bcrypt, as a fallback | Cost 10 or more, passwords capped at 72 bytes | [6] |
| PBKDF2, only where a validated algorithm is required | HMAC-SHA256 at 600,000 iterations | [6] |
| Cookie | `__Host-` name, `Secure`, `HttpOnly`, explicit `SameSite`, `Path=/`, name and value under 4,096 bytes | [1] V3.3.1 to V3.3.5; [7] |
| Strict transport | `max-age` of at least 31536000, with `includeSubDomains` at Level 2 | [1] V3.4.1 |
| JSON body cap | 100 KiB, answering 413 above it | [8]; [9] |
| Unexpected `Content-Type` | Refused with 415 | [9] |
| Server header size and request timeouts | Keep or lower one runtime's defaults: headers 16 KiB, headers timeout 60 s, whole request 300 s | [10] |
| Upload size and count | The largest legitimate file for the feature, stated per endpoint, with a per-account file count and quota; archives checked for expanded size and entry count before extraction | [1] V5.2.1, V5.2.3, V5.2.4 |
| Webhook timestamp tolerance | 300 seconds; never 0, which disables the check | [11] |
| Webhook event identifiers kept | At least the provider's retry window; one provider retries for up to three days | [11] |
| Webhook secret rotation | Previous secret accepted for at most 24 hours | [11] |
| Emitted webhook | Secret of 24 to 64 random bytes, signature over `id.timestamp.body`, receiver timeout 15 to 30 seconds, payload under 20 kB | [12] |
| Outbound fetch | A timeout and a response size cap stated per integration; no published number | [1] V13.1.3 |
| Outbound address check | Every range in [address-ranges.md](address-ranges.md), IPv4 and IPv6 | [13]; [14] |
| Idempotency key | Stored with a fingerprint of the request; reused with another body 422, still in progress 409, missing where required 400 | [15] |
| Rate limit response | 429 with `Retry-After` | [9] |
| Model endpoint | Input size cap and explicit output token cap on every call, stubbed or not; the values are a decision | [1] V2.4.1 |

## Sources

1. OWASP Application Security Verification Standard 5.0.0, requirement identifiers as given: https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv
2. OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
3. NIST SP 800-63B-4, reauthentication, throttling, passwords and recovery codes: https://pages.nist.gov/800-63-4/sp800-63b.html and https://pages.nist.gov/800-63-4/sp800-63b/events/
4. OWASP Forgot Password Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
5. OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
6. OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
7. Set-Cookie reference, prefixes and the local host exception: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
8. Default body limit of a widely used JSON body parser, which warns that 5 MB or more already introduces risk: https://github.com/expressjs/body-parser#limit
9. OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
10. HTTP server defaults of one JavaScript runtime: https://nodejs.org/api/http.html
11. Webhook documentation of a major payment provider: https://docs.stripe.com/webhooks
12. Standard Webhooks specification: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
13. IANA IPv4 and IPv6 special-purpose address registries: https://www.iana.org/assignments/iana-ipv4-special-registry/ and https://www.iana.org/assignments/iana-ipv6-special-registry/
14. OWASP Server-Side Request Forgery Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
15. The Idempotency-Key HTTP header field, IETF draft 07: https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
