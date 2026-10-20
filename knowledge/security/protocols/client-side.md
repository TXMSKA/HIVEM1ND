name: client-side
purpose: Prove code running in the browser does not turn a window message, a URL value or a socket frame into script, or into an action the server did not authorize.
scope: browser code that reads the URL, the fragment, browser storage or window messages, cross-window messaging, WebSocket and server-sent event endpoints, and the third-party scripts the page loads
trigger: task close
repeat: once
inputs: the client source and the build output, a browser with its console and network panel, a test session, a second origin under control
stop: script runs from a crafted URL, message or socket frame, which is reported at once and ends the protocol
report: the message handlers with their origin checks, the URL and storage values with the sink each reaches, the socket handshake and message checks, and the third-party script list with its integrity attributes

## Steps

1. Check every window message handler and sender.
   Task: `git grep -n -I -E 'addEventListener\( *.message|onmessage *=|postMessage\('`, with a planted `window.addEventListener("message", h)` as the positive control. Each receiving handler compares the event's origin with an exact list before it reads the data, and each sender names a target origin rather than `*`. Then send a message to the page from the second origin.
   Time: 20 minutes. Repository, plus a browser.
   Result: per handler its origin check quoted with file and line, zero handlers without one, zero senders posting data to `*`, and the message from the second origin ignored, with the console captured.

2. Follow URL and storage values into the page.
   Task: list the values the page reads from the URL, the referrer, browser storage and messages: `git grep -n -I -E 'location\.(hash|search|href)|document\.(URL|referrer)|URLSearchParams|(local|session)Storage\.getItem|event\.data'`, with a planted `location.hash` read as the positive control. Follow each to the sinks of step 4 of [injection-and-output](injection-and-output.md), to dynamic evaluation, and to a navigation that accepts a `javascript:` URL. Then load the page with a fragment and a query carrying `<img src=x onerror=alert(1)>` and `javascript:alert(1)`.
   Time: 30 minutes. Repository, plus a browser.
   Result: per value a line naming the sink it reaches and the escaping between them, and the crafted URLs executing nothing, with the console captured.

3. Authenticate and authorize every socket.
   Task: for each WebSocket or event-stream endpoint, read the handshake: it checks `Origin` against the exact list and authenticates the session, and every message that changes state is authorized like an HTTP request. Connect from the second origin and with no session, then send a message that acts on another account's object.
   Time: 25 minutes. Repository, plus running application.
   Result: the cross-origin and the anonymous handshakes refused with their status codes, and the cross-account message refused with the store unchanged. Without sockets, not applicable.

4. Pin the third-party scripts the page loads.
   Task: list every script loaded from another origin in the build output: `git grep --no-index -n -I -E '<script[^>]+src=.?https?://' -- dist build .next out`, with a planted `<script src=https://cdn.example/x.js>` as the positive control, plus the dynamic imports of remote URLs. Each carries `integrity` and `crossorigin` attributes or is served from the application's own origin, and is allowed by the content policy. The privacy side of the same list is step 3 of [personal-data](personal-data.md).
   Time: 15 minutes. Repository after a build.
   Result: per script its origin, the integrity attribute present or absent, and the policy entry that allows it; a script from another origin without integrity is a finding.
