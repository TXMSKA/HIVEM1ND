# Outbound

Requests the server makes to other hosts: URLs taken from input, image proxies, third-party APIs, the mail it sends and the webhooks it emits. Inbound payment webhooks are in [payments.md](payments.md).

## Requests to URLs taken from input

Applies when: the server fetches a URL that came from a request: link previews, imports by URL, avatar fetching, document or screenshot rendering, user-registered webhooks.

Build: Allow only configured hosts over `https` on the expected port, refuse credentials in the URL, place the address check as [address-ranges.md](../address-ranges.md#where-the-check-sits) sets out, and set a timeout and a response size cap.

Options:

- **Allowlist of destination hosts, plus the address check on every hop.** The default. The allowlist decides where, the address check stops an allowed name that resolves inward. A denylist of hosts alone is bypass-prone.
- **No fetch of a raw URL at all.** The caller picks from known sources instead. Strongest, when the feature allows it.
- **A hardened metadata service that requires a session token.** Defence in depth, never the fix.

Open: steps 1 to 3 of [outbound-requests](../protocols/outbound-requests.md).

## Image proxies and optimization endpoints

Applies when: an image optimization endpoint is enabled; remote image hosts are configured; the framework's image component is used with remote sources.

Build: Configure the remote hosts explicitly, or serve local images only, and disable the formats the decoder cannot make safe.

Options:

- **Remote sources restricted to configured hosts.** The default.
- **Local images only.** Removes the fetch entirely.
- **Formats that cannot be made safe disabled.** The decoder side is in [files.md](files.md#processing-and-decoders).

Open: steps 1 and 2 of [outbound-requests](../protocols/outbound-requests.md); [framework-traps.md](../framework-traps.md#the-image-endpoint-is-a-server-side-fetch-proxy).

## Third-party APIs consumed

Applies when: an integration with a third-party API is added; its response reaches a query, a template, a file path or a decision.

Build: Give every call a timeout and a response size cap, parse the response with a schema, and fail closed when the third party fails.

Options:

- **Response parsed with a schema, with a timeout, a size limit and bounded redirects.** The default. A third party is a stranger with a contract.
- **Fail closed.** When the third party is down, the feature stops rather than falling back to a permissive default.

Open: step 4 of [outbound-requests](../protocols/outbound-requests.md); step 2 of [logging-and-errors](../protocols/logging-and-errors.md).

## Mail the service sends

Applies when: a contact form, an invitation, a reset, a notification or a newsletter puts a request value into a recipient, a sender, a reply address or a subject.

Build: Take recipients from the account on file or from an address parser that refuses line breaks, keep the sender fixed in configuration, and pass every other request value as a parameter of the mail library rather than as raw header text.

Options:

- **Fixed sender, recipient from the account on file.** The default for reset and notification mail.
- **Address parsed and refused on a line break.** When the recipient comes from a form, such as an invitation.

Open: step 8 of [injection-and-output](../protocols/injection-and-output.md); step 5 of [personal-data](../protocols/personal-data.md) for marketing mail.

## Webhooks the service emits

Applies when: the service sends events to other systems; users register delivery targets.

Build: Sign and deliver as [api-conventions.md](../api-conventions.md#webhooks-the-service-emits) sets out, with the values in [essentials.md](../essentials.md#default-values), and send every delivery target through the outbound checks.

Options:

- **Signed body, timestamp, event identifier, retries with backoff.** Always. One secret per receiver.
- **Delivery targets through the same allowlist and address checks as any outbound fetch.** When users register them.

Open: step 5 of [outbound-requests](../protocols/outbound-requests.md).
