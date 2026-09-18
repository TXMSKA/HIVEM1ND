name: request-forgery
purpose: Prove a cross-site request cannot act and a server-side fetch cannot reach the metadata service.
trigger: manual, on any state-changing form, and on any request the server makes to a URL it did not fix itself
repeat: once per audit, and again whenever a form, a webhook, a URL parameter or an outbound client is added
inputs: the route table, the outbound request sites in the source, a session, a request client, a host under control for redirect tests
stop: an outbound request reaches the metadata address, which is a P0 and is reported before the pass continues
report: the token result per state-changing endpoint, the outbound fetch sites with their allowlists, the metadata payload results, the redirect behaviour, and the cross-origin policy as served

## Steps

1. Require a token on every state change.
   Task: send each state-changing request with a valid session and no token, then with a token issued to a different session. Both categories are graded as access control failures on the current application list, which names cross-site request forgery and server-side request forgery among the weaknesses of its first entry.
   Time: 40 minutes. Running application.
   Result: one line per endpoint with the status code for each case, all denials. An endpoint that accepts either case is a finding regardless of what the cookie attributes say.

2. Do not let a cookie attribute stand in for the token.
   Task: confirm the cookie attributes from [authentication-and-session](authentication-and-session.md) are present, and record that they are defence in depth. The grace window after a cookie is set, in which some browsers still send a `Lax`-defaulted cookie on a cross-site `POST`, is enough to matter, so the synchronizer token or the signed double submit bound to the session remains the control.
   Time: 10 minutes. Running application.
   Result: the attribute line recorded, and the token result from step 1 named as the control in the report.

3. Find every place the server fetches a URL it did not choose.
   Task: search the source for outbound HTTP clients and record which of them build a URL from a request value: webhooks, link previews, imports, avatar fetching, PDF and screenshot rendering, and the image optimization endpoint, which is a server-side fetch proxy with a cache in front of it whatever its route is called.
   Time: 40 minutes. Repository.
   Result: a table of call site, the value it takes from the request, and the allowlist in front of it with its entries listed. A denylist is recorded as a finding in itself: published guidance is explicit that "Deny-lists are bypass-prone. Prefer allow-lists."

4. Send the metadata addresses through every one of them.
   Task: through each site found in step 3, request the cloud metadata endpoints the published guidance names, `169.254.169.254` and `metadata.google.internal`, plus loopback, private ranges and the encoded and alternative notations of each.
   Time: 40 minutes. Running application. Only against the application under test, per [rules-of-engagement.md](../rules-of-engagement.md).
   Result: one line per site and payload with the status code and the response body length. Every one refused. Where the platform offers a hardened metadata service that requires a session token, its enablement is recorded as defence in depth and never as the fix.

5. Close the redirect and the name resolution gaps.
   Task: point an outbound fetch at a host under control that answers with a redirect to an internal address, and at a name that resolves to one. An allowlist checked on the hostname before resolution, or before a redirect, is not an allowlist.
   Time: 30 minutes. Running application, plus a host under control.
   Result: redirect following disabled, or the destination re-validated after each hop, proved by the redirect test returning a refusal. Plus the resolved address checked rather than the hostname, proved by the resolution test returning a refusal.

6. Read the cross-origin settings as served.
   Task: check the cross-origin resource sharing response for a credentialed request, and the frame ancestors restriction.
   Time: 15 minutes. Running application.
   Result: the allowed origin echoed only for origins on a fixed list, never a wildcard alongside credentials and never a reflection of the request's own origin, recorded as request origin against response header for each origin tested.
