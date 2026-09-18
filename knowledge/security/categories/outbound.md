# Outbound

Requests the server makes to other hosts: URLs taken from input, image proxies, third-party APIs, and the webhooks the service sends. Inbound payment webhooks are in [payments.md](payments.md).

## Requests to URLs taken from input

**Applies when:** the server fetches a URL that came from a request: link previews, imports by URL, avatar fetching, document or screenshot rendering, user-registered webhooks.

**Options:**

- **Allowlist of destination hosts, plus every resolved address checked against [address-ranges.md](../address-ranges.md) on every hop.** The default. Both are needed: the allowlist decides where, the address check stops an allowed name that resolves inward. A denylist of hosts alone is bypass-prone.
- **No fetch of a raw URL at all.** The caller picks from known sources instead. Strongest, when the feature allows it.
- **A hardened metadata service that requires a session token.** Defence in depth, never the fix.

**Build:** Allow only configured hosts over `https` on the expected port, refuse credentials in the URL and address literals, check every resolved address against [address-ranges.md](../address-ranges.md) inside the connection's own lookup, follow redirects by hand a fixed few times with each hop checked again, and set a timeout and a response size cap.

**Open:** steps 1 to 3 of [outbound-requests](../protocols/outbound-requests.md).

## Image proxies and optimization endpoints

**Applies when:** an image optimization endpoint is enabled; remote image hosts are configured; the framework's image component is used with remote sources.

**Options:**

- **Remote sources restricted to configured hosts.** The default.
- **Local images only.** Removes the fetch entirely.
- **Formats that cannot be made safe disabled.** The decoder side is in [files.md](files.md#processing-and-decoders).

**Build:** Configure the remote hosts explicitly, or serve local images only, and disable the formats the decoder cannot make safe.

**Open:** steps 1 and 2 of [outbound-requests](../protocols/outbound-requests.md); [framework-traps.md](../framework-traps.md#the-image-endpoint-is-a-server-side-fetch-proxy).

## Third-party APIs consumed

**Applies when:** an integration with a third-party API is added; its response reaches a query, a template, a file path or a decision.

**Options:**

- **Response parsed with a schema, with a timeout, a size limit and bounded redirects.** The default. A third party is a stranger with a contract.
- **Fail closed.** When the third party is down, the feature stops rather than falling back to a permissive default.

**Build:** Give every call a timeout and a response size cap, parse the response with a schema, and fail closed when the third party fails.

**Open:** step 4 of [outbound-requests](../protocols/outbound-requests.md); step 2 of [logging-and-errors](../protocols/logging-and-errors.md).

## Webhooks the service emits

**Applies when:** the service sends events to other systems; users register delivery targets.

**Options:**

- **Signed body, timestamp, event identifier, retries with backoff.** Always. One secret per receiver.
- **Delivery targets through the same allowlist and address checks as any outbound fetch.** When users register them.

**Build:** Sign `id.timestamp.body` with a secret per receiver, send the identifier, timestamp and signature as headers, retry with backoff, and send every delivery target through the outbound checks. The values are in [essentials.md](../essentials.md).

**Open:** step 5 of [outbound-requests](../protocols/outbound-requests.md); [api-conventions.md](../api-conventions.md#webhooks-the-service-emits).
