# Headers

The response headers an application sends, with the baseline values a pass compares against. The published recommended set is fetched in the pass by [headers-and-transport](protocols/headers-and-transport.md); this topic is the baseline to start from and the reasons behind it.

## Where headers are set

Headers are set from the application or its server configuration, never from a file a visitor can fetch. The content security policy lives in one place in the code, and a new host, embed or third-party script edits that policy and the privacy and legal pages in the same change, so the policy and what the site declares never drift apart.

Headers are verified with `curl -I` against the deployed origin, never against a local build, and on an error response as well as on a success.

## Baseline

| Header | Baseline value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | Start at `default-src 'self'` and add only what is served. Nonces or hashes for inline scripts that cannot be moved out. `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` unless something embeds the site. No `unsafe-inline` on the script source. | The only header that stops an injected script from executing. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`, once HTTPS is stable | Keeps the browser on HTTPS after the first visit. |
| `X-Content-Type-Options` | `nosniff` | Stops the browser from reinterpreting a file as script. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Keeps paths and query strings out of other sites' logs. |
| `Permissions-Policy` | Deny camera, microphone, geolocation and payment unless the feature exists | A feature not used cannot be abused by injected content. |
| `X-Frame-Options` | `DENY`, alongside `frame-ancestors` | Framing protection for browsers that ignore the policy directive. |
| `Cache-Control` | `no-store` on every authenticated or personal response | Keeps account data out of shared caches and the browser's cache. |

A response that renders no page, such as a JSON API, carries `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, since it loads nothing. A user file served back adds `sandbox` to its policy, so a document that carries script cannot run it on the application's origin. A service with no cross-origin consumers can add `Cross-Origin-Resource-Policy: same-origin`.

A content security policy is tightened in report-only mode first and then switched to the enforcing header. A report-only policy is recorded separately and never counted as enforcement.

## Headers to remove

Server and framework banners, version headers, tracing headers and the internal headers a rendering framework emits name the stack to a stranger and can reach the cache key, per [framework-traps.md](framework-traps.md). The published removal list is fetched in the pass.

Four headers no longer do anything and are removed where found: `X-XSS-Protection`, `Expect-CT`, `Feature-Policy` and `Public-Key-Pins`. Their presence says the configuration was written against superseded guidance, and the first one has caused vulnerabilities of its own.

## Preload

Submitting a domain to the HSTS preload list requires `max-age` of at least 31536000 seconds with `includeSubDomains` and `preload` on the base domain. The list operator warns that inclusion cannot easily be undone and that removal takes months to reach users, so submission is a person's decision.
