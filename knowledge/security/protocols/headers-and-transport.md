name: headers-and-transport
purpose: Prove the enforced headers and the transport settle at the target values, error responses included.
scope: the response headers of a deployed site, the server, proxy and edge configuration, the certificate and the HTTPS redirect
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, and again after any change to the server, the proxy or the edge configuration
inputs: the deployed address, a request client that shows headers, the server configuration, the published header sets
stop: none; every step produces a finding rather than halting the pass
report: the header set on a success and on an error response, the missing and the dead headers, the policy as served, the protocol versions accepted, and the certificate expiry

## Steps

1. Read the headers on a success and on a failure.
   Task: `curl -sI https://<host>/` and `curl -sI https://<host>/a-path-that-does-not-exist`, written `curl.exe` in Windows PowerShell, then repeat against a path that raises a server error. On one common server the directive must be written as `Header always set`, because the default condition writes only to the table used for successful responses, while `always` covers the table used for a locally generated non-success response. Headers set without it vanish exactly where they are most needed.
   Time: 20 minutes. Running application.
   Result: both header sets recorded verbatim, and any header present on the 200 and absent on the error named as a finding with its response code.

2. Compare against the published set.
   Task: start from the baseline in [headers.md](../headers.md), then fetch the recommended set in this pass and compare header by header:
   https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json
   Time: 20 minutes. Running application, plus network access.
   Result: one line per header in the published set marked present with its value, present with a weaker value, or absent, with the fetched file's own last-update timestamp recorded beside the comparison. When the set cannot be fetched, or the target is a local plain-HTTP instance where the fetch costs more than the comparison, the comparison runs against the baseline in [headers.md](../headers.md#baseline), and the published set is recorded as not fetched.

3. Strip the headers that name the stack.
   Task: fetch the removal list beside it, `headers_remove.json` at the same location, and check every response against it. The list includes server and framework banners, version headers, tracing headers and the internal headers a rendering framework emits, which also matter to the cache key discussed in [framework-traps.md](../framework-traps.md).
   Time: 15 minutes. Running application, plus network access.
   Result: zero hits from the removal list on any response tested, or each survivor named with the response it appeared on. Without the fetch, the headers named in [headers.md](../headers.md#headers-to-remove) are the list, and the removal list is recorded as not fetched.

4. Remove the headers that no longer do anything.
   Task: check for `X-XSS-Protection`, `Expect-CT`, `Feature-Policy` and `Public-Key-Pins`.
   Time: 5 minutes. Running application.
   Result: all four absent. The presence of any of them is itself a finding: it says the configuration was written against guidance that has been superseded, and the first one has caused vulnerabilities of its own.

5. Enforce the one policy that stops execution.
   Task: read the content security policy as served, and confirm it is the enforcing header and not the report-only variant.
   Time: 25 minutes. Running application.
   Result: the enforcing policy value quoted, carrying at least a default source restriction, `object-src 'none'`, `base-uri 'self'` and a frame ancestors restriction, with no `unsafe-inline` on the script source. A report-only policy is recorded separately and never counted. The blocking behaviour itself is proved in [injection-and-output](injection-and-output.md).

6. Settle the transport.
   Task: check that plain HTTP redirects to HTTPS on the same host, which protocol versions the endpoint accepts, and the strict transport header. The server-side configuration guidelines now live at https://docs.tlsref.org/ and the generator repository that previously carried them is archived, so configuration is compared against the current location.
   Time: 30 minutes. Running application, plus network access.
   Result: the redirect status and location, the list of protocol versions accepted with the obsolete ones refused, and the `Strict-Transport-Security` value as served. A deployment served only over plain HTTP on a local address ends this step and step 7 as not applicable, with that reason, and says nothing about production. **Needs a person** for preload: submission requires `max-age` of at least 31536000 seconds with `includeSubDomains` and `preload` on the base domain, and the list operator warns that inclusion "cannot easily be undone" and that removal takes months to reach users.

7. Read the certificate, and grade revocation correctly.
   Task: record the chain, the issuer and the expiry. Stapling absence is not a finding for certificates from issuers that no longer run a responder: the most common free issuer stopped including responder URLs in its certificates in May 2025 and shut the service down on 2025-08-06, publishing revocation by list only.
   Time: 15 minutes. Running application.
   Result: the issuer, the expiry date and the days remaining, plus the renewal automation confirmed by a successful dry run rather than by its presence in a configuration file.
