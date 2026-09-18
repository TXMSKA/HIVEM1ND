name: injection-and-output
purpose: Prove untrusted data never becomes code, in the database, the shell or the page.
scope: queries, commands, file paths, templates, rendered user content, redirects and deserialisers fed by input
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, and again whenever a query, a template sink or a redirect target is added
inputs: the source tree, the running application, a payload set
stop: a payload executes anywhere, which is a P0 and is reported before the pass continues
report: the searches and their hit counts, the allowlists with their allowed values, the payload results per parameter, and the content security policy violation captured in the browser

## Steps

1. Validate and normalize every input on the way in.
   Task: confirm every API handler, server action and form handler validates its input against an allowlist schema before using it, per [api-conventions.md](../api-conventions.md), with explicit limits on body size, field length and array length. Normalize and validate a value before it is stored, not only when it is rendered, so a stored value cannot become an injection the day a new template forgets to escape it.
   Time: 40 minutes. Repository, plus running application.
   Result: a table of handler and the schema it applies, with no empty cell, and a request per handler carrying an oversized field, an oversized array and an unexpected type, each rejected with its status code and nothing written, read from the store.

2. Parameterize every query, and allowlist what cannot be parameterized.
   Task: search the source for queries assembled by concatenation or interpolation. Table names, column names and sort direction cannot be bound as parameters, so each one resolves through a server-side allowlist that maps a caller's value to a fixed identifier.
   Time: 40 minutes. Repository.
   Result: zero hits for a value interpolated into a query string, and one line per dynamic identifier with the full list of values its allowlist permits. An allowlist that falls through to the caller's value is a finding.

3. Never hand input to a shell or a path.
   Task: search for process execution that passes a shell a string, and for dynamic evaluation of any kind. Then search for filesystem paths built from a request value, the static file handler included: every such path is decoded once, canonicalized and checked to stay inside its base directory, and an incoming value is never concatenated into a path. Send `../` sequences, encoded variants such as `..%2f` and `%2e%2e/`, backslash forms and absolute paths to each one.
   Time: 30 minutes. Repository, plus running application.
   Result: zero hits for a shell invocation carrying an interpolated value, and zero hits for `eval`, `new Function` and equivalents. Each survivor carries a file and line reference and the fixed literal that makes it safe. Every traversal payload is refused with its status code, and no file outside the base directory is returned.

4. Encode at the sink.
   Task: search every raw insertion sink the stack offers, such as `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `v-html`, `insertAdjacentHTML`, a template filter that disables escaping, and any markup built by string concatenation.
   Time: 30 minutes. Repository.
   Result: zero hits, or each survivor listed with the sanitizer it passes through and that sanitizer's allowed tag and attribute list quoted. Where the code has an escaping helper, every sink is compared against its siblings: a sink fed without the helper the others use is a finding even when the search looks routine. HTML from users or editors passes the sanitizer before it is stored and again before it is rendered. User-supplied styling, themes or layout are accepted as closed recipes or schema-validated values, never as arbitrary CSS, markup or script, and the search for such a value reaching a style or markup sink unvalidated returns zero hits.

5. Enforce the policy that stops execution.
   Task: a content security policy is the only header that stops a script from executing. Serve an enforcing policy, then attempt to render an injected inline script and read the browser console.
   Time: 30 minutes. Running application, with a browser.
   Result: the policy header value as served, plus the console violation message showing the injected script blocked. A report-only policy is recorded separately and never counted as enforcement. When no policy is served at all, the header read closes the step as a fail without a browser.

6. Close the redirect and the deserialiser.
   Task: send an absolute external URL, a protocol-relative URL and an encoded variant to every redirect parameter. Then check whether any user-controlled data reaches a deserialiser that can construct arbitrary types, which is how a server function endpoint has produced remote code execution before, as recorded in [framework-traps.md](../framework-traps.md).
   Time: 30 minutes. Running application, plus a repository search.
   Result: one line per redirect payload with the status and the resulting location, all of which stay on the application's own host. Plus zero hits for a deserialiser reached by request data without a fixed schema in front of it.

7. Drive the payload set at every parameter.
   Task: send the standard payload set to every query parameter, body field, header and path segment the enumeration found, including the ones that are not reflected in a response.
   Time: 60 minutes. Running application.
   Result: per parameter, the status code and the rendered output. No payload executes, and no database error text, stack trace or query fragment appears in any response body.
