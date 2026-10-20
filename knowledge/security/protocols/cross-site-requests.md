name: cross-site-requests
purpose: Prove a request sent from another site cannot act with the visitor's session, read a credentialed response or frame the application.
scope: state-changing forms and endpoints called from a browser, cookie-authenticated requests, cross-origin resource sharing and framing settings
trigger: task close
repeat: once
inputs: the route table, a test session, a request client that shows headers, a second origin under control for the cross-origin tests
stop: a state-changing request succeeds from another origin with the visitor's session, which is a P0, reported at once, and ends the protocol
report: the token result per state-changing endpoint, the state-changing handlers reached by a safe method, the cookie attribute line, the cross-origin policy as served per origin tested, and the framing result

## Steps

1. Require a token on every state change.
   Task: send each state-changing request with a valid session and no token, then with a token issued to a different session, with the request carrying its own token as the positive control. The control is a synchronizer token or a signed double submit token bound to the session, or the framework's built-in protection that implements one. The OWASP Top 10:2025 grades cross-site request forgery under A01 Broken Access Control.
   Time: 40 minutes. Running application.
   Result: one line per endpoint with the status code for each case: the own token accepted, both other cases denied. An endpoint that accepts either case is a finding whatever the cookie attributes say. Endpoints that run before a session exists, such as login, registration and reset, refuse a request carrying `Sec-Fetch-Site: cross-site` or a foreign `Origin`. Without a test session, a source with no token check on any state change is the finding, from the repository.

2. Keep state changes off the safe methods.
   Task: list the handlers bound to `GET` or `HEAD`: `git grep -n -I -E '\.(get|head)\(|export (async )?function (GET|HEAD)|@GetMapping|methods=.?GET'`, with a known read handler as the positive control, and read each for a write, a send, a delete or a setting change. A safe method carries no token and is sent by any link or image on any site.
   Time: 20 minutes. Repository.
   Result: zero handlers on a safe method that change state, recorded with the expression, or each survivor with a file and line reference as a finding.

3. Record the cookie attributes as defence in depth, not as the control.
   Task: read the session cookie's `SameSite` value from step 1 of [authentication-and-session](authentication-and-session.md). One browser applies `Lax` as a default in a more permissive form: "a cookie that is at most 2 minutes old will be sent on a top-level cross-site POST request" (https://www.chromium.org/updates/same-site/faq/), which is a usable window. Cross-origin resource sharing is not a forgery defence either: it governs who may read a response, not who may send the request.
   Time: 10 minutes. Running application.
   Result: the attribute line recorded, and the token result from step 1 named as the control in the report.

4. Read the cross-origin settings as served.
   Task: send credentialed requests carrying an allowed origin, an unlisted origin, the `null` origin and a lookalike of the allowed one, and read the response headers.
   Time: 20 minutes. Running application.
   Result: one line per origin tested with the `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials` values returned. The origin is echoed only for entries on the fixed list, never as a wildcard alongside credentials and never as a reflection of the request's own origin; only the methods and headers needed are allowed.

5. Refuse to be framed.
   Task: read the frame ancestors directive and `X-Frame-Options` on the pages that carry a session, against [headers.md](../headers.md#baseline), then load one inside a frame on the second origin.
   Time: 10 minutes. Running application, with a browser.
   Result: the header values quoted and the framed load refused, with the browser console message captured. When both headers are absent, the header read alone closes the step as a fail and no browser is needed. A page meant to be embedded names its allowed parents in `frame-ancestors`.
