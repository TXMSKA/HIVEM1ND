name: outbound-requests
purpose: Prove a request the server makes cannot be steered to an internal address, a third-party answer is handled as untrusted input, and a webhook the service emits can be verified by its receiver.
scope: outbound HTTP clients, URL fetching, link previews, imports, image proxies and optimization endpoints, document and screenshot rendering, calls to third-party APIs, and webhooks the service sends
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, and again whenever an outbound client, a URL parameter, a third-party integration or an emitted webhook is added
inputs: the outbound request sites in the source, a request client, a host under control for redirect and resolution tests, the webhook sender code
stop: an outbound request reaches the metadata address or an internal service, which is a P0 and is reported before the pass continues
report: the outbound fetch sites with their allowlists, the metadata payload results, the redirect and resolution results, the timeouts and response limits per integration, and the signing fields of emitted webhooks

## Steps

1. Find every place the server fetches a URL it did not choose.
   Task: search the source for outbound HTTP clients and record which of them build a URL from a request value: webhooks registered by users, link previews, imports, avatar fetching, document and screenshot rendering, and the image optimization endpoint, which is a server-side fetch proxy with a cache in front of it whatever its route is called, per [framework-traps.md](../framework-traps.md).
   Time: 40 minutes. Repository.
   Result: a table of call site, the value it takes from the request, and the allowlist in front of it with its entries listed. A raw URL from a request fetched as sent is a finding, and so is a denylist: published guidance is explicit that "Deny-lists are bypass-prone. Prefer allow-lists."

2. Send the metadata addresses through every one of them.
   Task: the proof target by default is the application's own loopback address, such as `http://127.0.0.1:<its port>/`, which proves the fetch without reaching anything else. Then, through each site found in step 1, request the ranges in [address-ranges.md](../address-ranges.md), IPv4 and IPv6, the mapped form `::ffff:127.0.0.1`, the decimal, octal and hexadecimal notations of loopback, and the cloud metadata endpoints the published guidance names, `169.254.169.254` and `metadata.google.internal`. A metadata address is sent only through a deployment the owner controls, and what it returns is recorded, never used.
   Time: 40 minutes. Running application. Only against the application under test, per [rules-of-engagement.md](../rules-of-engagement.md).
   Result: one line per site and payload with the status code and the response body length, every one refused. Where the platform offers a hardened metadata service that requires a session token, its enablement is recorded as defence in depth and never as the fix.

3. Close the redirect and the name resolution gaps.
   Task: point an outbound fetch at a host under control that answers with a redirect to an internal address, and at a name that resolves to one. An allowlist checked on the hostname before resolution, or before a redirect, is not an allowlist. A self-hosted deployment also sends a request with a modified `Host` header to every handler that builds a URL from it, per [incidents.md](../incidents.md).
   Time: 30 minutes. Running application, plus a host under control.
   Result: redirect following disabled, or the destination re-validated after each hop, proved by the redirect test returning a refusal. The resolved address is checked rather than the hostname, inside the connection's own lookup or by connecting to the checked address, proved by the resolution test returning a refusal, with the check's location quoted from the source. Address literals are refused or checked separately, since they skip the lookup, per [address-ranges.md](../address-ranges.md#where-the-check-sits). No handler fetches from the host named in a modified header. Without a host under control, the redirect and resolution tests are not run and the source reading stands as the evidence.

4. Treat what a third party sends back as untrusted input.
   Task: for each third-party API the application calls, read how the response is used. It passes the same schema validation as a request from a stranger, with a timeout, a maximum response size and a bounded number of redirects, and a failure of the third party fails closed rather than falling through to a permissive default.
   Time: 30 minutes. Repository.
   Result: one line per integration with its timeout in seconds, its response size limit, the schema it is parsed with, and the behaviour on failure. An integration with no timeout, or whose response reaches a query, a template or a file path unvalidated, is a finding.

5. Sign every webhook the service emits.
   Task: read the sender. Each delivery carries a signature over the raw body with a shared secret per receiver, a timestamp, and an event identifier for deduplication, and failed deliveries retry with backoff. Delivery targets registered by users go through the allowlist and the address checks of steps 2 and 3.
   Time: 20 minutes. Repository, plus running application.
   Result: a captured delivery showing the signature, timestamp and event identifier headers, the documented verification procedure for receivers, and a delivery target set to an internal address refused with its status code.
