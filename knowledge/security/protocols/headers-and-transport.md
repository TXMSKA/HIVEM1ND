name: headers-and-transport
purpose: Prove the enforced headers and the transport settle at the target values, error responses included.
scope: the response headers of a deployed site, the server, proxy and edge configuration, the certificate and the HTTPS redirect
trigger: task close
repeat: once
inputs: the deployed address, a request client that shows headers, the server configuration, the published header sets
stop: none; every step produces its own verdict
report: the header set on a success and on an error response, the missing and the dead headers, the policy as served, the protocol versions accepted, and the certificate expiry

## Steps

1. Read the headers on a success and on a failure.
   Task: `curl -sI https://<host>/` and `curl -sI https://<host>/a-path-that-does-not-exist`, written `curl.exe` in Windows PowerShell, then repeat against a path that raises a server error. On one common server the directive must be written as `Header always set`, because the default condition writes only to the table used for successful responses; headers set without it vanish exactly where they are most needed.
   Time: 20 minutes. Running application.
   Result: both header sets recorded verbatim, and any header present on the 200 and absent on the error named as a finding with its response code.

2. Compare against the published set.
   Task: start from the baseline in [headers.md](../headers.md#baseline), then fetch the recommended set in this pass and compare header by header:
   https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json
   Time: 20 minutes. Running application, plus network access.
   Result: one line per header in the published set marked present with its value, present with a weaker value, or absent, with the fetched file's own last-update timestamp beside the comparison. When the set cannot be fetched, or the target is a local plain-HTTP instance, the comparison runs against the baseline and the published set is recorded as not fetched.

3. Strip the headers that name the stack.
   Task: fetch the removal list beside it, `headers_remove.json` at the same location, and check every response against it. The list includes server and framework banners, version headers, tracing headers and the internal headers a rendering framework emits, which also matter to the cache key, per [framework-traps.md](../framework-traps.md#cache-poisoning-of-rendered-routes).
   Time: 15 minutes. Running application, plus network access.
   Result: zero headers from the removal list on any response tested, or each survivor named with the response it appeared on. Without the fetch, [headers.md](../headers.md#headers-to-remove) is the list, and the removal list is recorded as not fetched.

4. Remove the headers that no longer do anything.
   Task: check for the four dead headers named in [headers.md](../headers.md#headers-to-remove).
   Time: 5 minutes. Running application.
   Result: all four absent; the presence of any of them is a finding.

5. Enforce the one policy that stops execution.
   Task: read the content security policy as served and confirm it is the enforcing header, as [evidence.md](../evidence.md#what-is-not-evidence) requires.
   Time: 25 minutes. Running application.
   Result: the enforcing policy value quoted, carrying at least a default source restriction, `object-src 'none'`, `base-uri 'self'` and a frame ancestors restriction, with no `unsafe-inline` on the script source. The blocking behaviour itself is proved in step 5 of [injection-and-output](injection-and-output.md).

6. Settle the transport.
   Task: check that plain HTTP redirects to HTTPS on the same host, which protocol versions the endpoint accepts, and the strict transport header. The server-side configuration guidelines now live at https://docs.tlsref.org/, and the generator repository that carried them before is archived.
   Time: 30 minutes. Running application, plus network access.
   Result: the redirect status and location, the protocol versions accepted with the obsolete ones refused, and the `Strict-Transport-Security` value as served. A deployment served only over plain HTTP on a local address ends this step and step 7 as not applicable, and says nothing about production. Needs a person: preload, per [headers.md](../headers.md#preload).

7. Read the certificate, and grade revocation correctly.
   Task: record the chain, the issuer and the expiry. Stapling absence is not a finding for certificates from an issuer that no longer runs a responder, per [incidents.md](../incidents.md).
   Time: 15 minutes. Running application.
   Result: the issuer, the expiry date and the days remaining, plus the renewal automation proved by a dry run the owner runs, or by its last log, rather than by its presence in a configuration file.
