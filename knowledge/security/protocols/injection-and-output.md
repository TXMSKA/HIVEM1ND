name: injection-and-output
purpose: Prove untrusted data never becomes code, in the database, the shell or the page.
trigger: manual, on any query, command, template, redirect, deserialiser or value rendered from input
repeat: once per audit, and again whenever a query, a template sink or a redirect target is added
inputs: the source tree, the database account, the running application, a payload set
stop: a payload executes anywhere, which is a P0 and is reported before the pass continues
report: the searches and their hit counts, the allowlists with their allowed values, the payload results per parameter, and the content security policy violation captured in the browser

## Steps

1. Parameterize every query, and allowlist what cannot be parameterized.
   Task: search the source for queries assembled by concatenation or interpolation. Table names, column names and sort direction cannot be bound as parameters, so each one resolves through a server-side allowlist that maps a caller's value to a fixed identifier.
   Time: 40 minutes. Repository.
   Result: zero hits for a value interpolated into a query string, and one line per dynamic identifier with the full list of values its allowlist permits. An allowlist that falls through to the caller's value is a finding.

2. Give the application account only the privileges it uses.
   Task: read the grants of the account the application connects with, and check for accounts with a wildcard host or no password.
   Time: 20 minutes. Database access.
   Result: the grant list for the application account, holding no administrative privilege, no schema modification right in production and no access to other schemas. Plus a query result showing zero anonymous accounts and zero wildcard host accounts, and the connection confirmed as encrypted.

3. Never hand input to a shell.
   Task: search for process execution that passes a shell a string, and for dynamic evaluation of any kind.
   Time: 20 minutes. Repository.
   Result: zero hits for a shell invocation carrying an interpolated value, and zero hits for `eval`, `new Function` and equivalents. Each survivor carries a file and line reference and the fixed literal that makes it safe.

4. Encode at the sink.
   Task: search every raw insertion sink the stack offers, such as `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `v-html`, `insertAdjacentHTML`, a template filter that disables escaping, and any markup built by string concatenation.
   Time: 30 minutes. Repository.
   Result: zero hits, or each survivor listed with the sanitizer it passes through and that sanitizer's allowed tag and attribute list quoted.

5. Enforce the policy that stops execution.
   Task: a content security policy is the only header that stops a script from executing. Serve an enforcing policy, then attempt to render an injected inline script and read the browser console.
   Time: 30 minutes. Running application, with a browser.
   Result: the policy header value as served, plus the console violation message showing the injected script blocked. A report-only policy is recorded separately and never counted as enforcement.

6. Close the redirect and the deserialiser.
   Task: send an absolute external URL, a protocol-relative URL and an encoded variant to every redirect parameter. Then check whether any user-controlled data reaches a deserialiser that can construct arbitrary types, which is how a server function endpoint has produced remote code execution before, as recorded in [framework-traps.md](../framework-traps.md).
   Time: 30 minutes. Running application, plus a repository search.
   Result: one line per redirect payload with the status and the resulting location, all of which stay on the application's own host. Plus zero hits for a deserialiser reached by request data without a fixed schema in front of it.

7. Drive the payload set at every parameter.
   Task: send the standard payload set to every query parameter, body field, header and path segment the enumeration found, including the ones that are not reflected in a response.
   Time: 60 minutes. Running application.
   Result: per parameter, the status code and the rendered output. No payload executes, and no database error text, stack trace or query fragment appears in any response body.
