# Protocol steps

What each step checks, in a few words. A pass picks its steps here and opens a protocol only when one of its steps will run; a step whose subject the map lacks ends as not applicable from this line.

- [version-floor](protocols/version-floor.md): 1 runtime calendar; 2 installed versions and imports; 3 vendor advisories; 4 audit, full tree; 5 platform's count; 6 deployed versions; 7 floor in the pipeline.
- [supply-chain](protocols/supply-chain.md): 1 install scripts refused; 2 minimum release age; 3 clean install; 4 pinned actions and token; 5 audit limits; 6 new dependency review.
- [secrets](protocols/secrets.md): 1 tree scan; 2 history scan; 3 values in the build; 4 tracked files and loader; 5 rotation first; 6 key per consumer; 7 scan in hook and pipeline.
- [deployment-surface](protocols/deployment-surface.md): 1 served environment files; 2 default credentials; 3 stock routes and leftovers; 4 directory listing; 5 public source maps; 6 pipeline secret scope; 7 hosting shape; 8 container images; 9 infrastructure files.
- [access-control](protocols/access-control.md): 1 endpoint inventory; 2 other account's objects; 3 privileged functions; 4 field writes and reads; 5 check inside the action; 6 identity from the session; 7 default denial.
- [business-logic](protocols/business-logic.md): 1 bounded values and guards; 2 parallel double spend; 3 skipped flow steps; 4 numbers out of bounds.
- [authentication-and-session](protocols/authentication-and-session.md): 1 cookie attributes; 2 rotation, logout, timeouts; 3 tokens in URLs and storage; 4 hashing and throttling; 5 emailed links; 6 enumeration; 7 token lifetimes and second factor; 8 delegated sign-in; 9 passkeys.
- [payments-and-webhooks](protocols/payments-and-webhooks.md): 1 client money fields; 2 tampered orders; 3 webhook signature; 4 replay and order; 5 paid state from provider; 6 card data and reconciliation; 7 entitlements.
- [outbound-requests](protocols/outbound-requests.md): 1 fetch sites; 2 internal addresses; 3 redirects and resolution; 4 third-party responses; 5 emitted webhook signatures.
- [file-upload](protocols/file-upload.md): 1 type by content; 2 generated names; 3 served as data; 4 decoder advisories; 5 size and expansion; 6 owner and rate limit.
- [cross-site-requests](protocols/cross-site-requests.md): 1 forgery token; 2 safe methods; 3 SameSite as depth; 4 cross-origin headers; 5 framing.
- [client-side](protocols/client-side.md): 1 message origins; 2 URL values into the page; 3 sockets; 4 script integrity.
- [headers-and-transport](protocols/headers-and-transport.md): 1 success and error headers; 2 published set; 3 stack headers; 4 dead headers; 5 enforcing policy; 6 HTTPS and strict transport; 7 certificate.
- [injection-and-output](protocols/injection-and-output.md): 1 input schemas; 2 bound queries; 3 shell and paths; 4 raw sinks; 5 policy blocks a script; 6 redirects and deserialisers; 7 probe set; 8 mail headers.
- [data-store](protocols/data-store.md): 1 stores and accounts; 2 grants; 3 row policies; 4 migrations; 5 encryption; 6 backups and test data.
- [personal-data](protocols/personal-data.md): 1 field inventory; 2 consent and age; 3 third-party scripts; 4 deletion and export; 5 unsubscribe; 6 notices.
- [resource-limits](protocols/resource-limits.md): 1 limit per entry point; 2 ceiling reached; 3 query bounds; 4 request bounds; 5 spend caps; 6 flow limits.
- [model-exposure](protocols/model-exposure.md): 1 key on the server; 2 tool privileges; 3 person before impact; 4 injection at the boundary; 5 public system prompt; 6 spend ceilings; 7 output as input; 8 retrieval filter.
- [logging-and-errors](protocols/logging-and-errors.md): 1 swallowed exceptions; 2 closed default; 3 internals in responses; 4 security events; 5 secrets in records; 6 alert fires; 7 retention and protection.
