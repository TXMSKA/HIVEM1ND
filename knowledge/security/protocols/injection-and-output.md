name: injection-and-output
purpose: Prove untrusted data never becomes code, in the database, the shell, the page or a mail header.
scope: queries, commands, file paths, templates, rendered user content, redirects, mail headers and deserialisers fed by input
trigger: task close
repeat: once
inputs: the source tree, the running application, the probe set in step 7, a test mailbox
stop: a payload executes anywhere, which is reported at once and ends the protocol
report: the searches with their hit counts and controls, the allowlists with their allowed values, the probe results per parameter, the content security policy violation captured in the browser, and the raw headers of the mail tests

## Steps

1. Validate and normalize every input on the way in.
   Task: confirm every API handler, server action and form handler validates its input against an allowlist schema before using it, per [api-conventions.md](../api-conventions.md#input), with explicit limits on body size, field length and array length. A value is normalized and validated before it is stored, not only when it is rendered.
   Time: 40 minutes. Repository, plus running application.
   Result: a table of handler and the schema it applies, with no empty cell, and a request per handler carrying an oversized field, an oversized array and an unexpected type, each rejected with its status code and nothing written, read from the store.

2. Parameterize every query, and allowlist what cannot be parameterized.
   Task: search for queries assembled by concatenation or interpolation: `git grep -n -I -i -E '(query|execute|raw|sql|prepare)[A-Za-z]*\(.*(\+ *[A-Za-z_]|\$\{|%s|\.format\()'`, with a planted `db.query("SELECT * FROM t WHERE id = " + id)` as the positive control. Table names, column names and sort direction cannot be bound as parameters, so each one resolves through a server-side allowlist that maps a caller's value to a fixed identifier.
   Time: 40 minutes. Repository.
   Result: zero hits for a value interpolated into a query string, and one line per dynamic identifier with the full list of values its allowlist permits. An allowlist that falls through to the caller's value is a finding.

3. Never hand input to a shell or a path.
   Task: search for a shell given a string and for dynamic evaluation: `git grep -n -I -E '(exec|execSync|system|popen|shell_exec|spawn)\(|shell *[:=] *(true|True)|eval\(|new Function\('`, with planted `exec(cmd)` and `eval(x)` as the positive controls. Then search for filesystem paths built from a request value, the static file handler included: `git grep -n -I -E '(readFile|createReadStream|sendFile|open|join|resolve)[A-Za-z]*\([^)]*(req\.|params|query|body)'`, with a planted `fs.readFile(req.query.name)` as the positive control. Every such path is decoded once, canonicalized and checked to stay inside its base directory. Send `../` sequences, encoded variants such as `..%2f` and `%2e%2e/`, backslash forms and absolute paths to each one.
   Time: 30 minutes. Repository, plus running application.
   Result: zero hits for a shell invocation carrying an interpolated value or for dynamic evaluation, each survivor with a file and line reference and the fixed literal that makes it safe. Every traversal payload refused with its status code, and no file outside the base directory returned.

4. Encode at the sink.
   Task: search every raw insertion sink the stack offers: `git grep -n -I -E 'dangerouslySetInnerHTML|innerHTML|outerHTML|v-html|insertAdjacentHTML|document\.write|\|safe|\{\{\{|<%-|html_safe|mark_safe'`, with a planted `el.innerHTML = x` as the positive control, plus markup built by string concatenation. User-supplied styling reaches a style sink only as a validated value: `git grep -n -I -E 'cssText|style\.setProperty|<style'`, each hit read for its source.
   Time: 30 minutes. Repository.
   Result: zero hits, or each survivor listed with the sanitizer it passes through and that sanitizer's allowed tag and attribute list quoted. Where the code has an escaping helper, a sink fed without the helper its siblings use is a finding. HTML from users or editors passes the sanitizer before it is stored and again before it is rendered, and user styling arrives as closed recipes or schema-validated values, never as arbitrary CSS, markup or script.

5. Prove the policy stops an injected script.
   Task: read the enforcing content security policy as served, then put an inline script into an input that reaches a page and load that page in a browser with its console open.
   Time: 30 minutes. Running application, with a browser.
   Result: the policy header value as served, plus the console violation message showing the injected script blocked. A report-only policy does not count, per [evidence.md](../evidence.md#what-is-not-evidence). When no policy is served at all, the header read closes the step as a fail without a browser.

6. Close the redirect and the deserialiser.
   Task: send an absolute external URL, a protocol-relative URL and an encoded variant to every redirect parameter. Then search for a deserialiser that can construct arbitrary types: `git grep -n -I -E 'pickle\.loads?|yaml\.load\(|unserialize\(|Marshal\.load|ObjectInputStream|BinaryFormatter|node-serialize'`, with a planted `pickle.loads(body)` as the positive control. A server function endpoint has produced remote code execution this way, per [framework-traps.md](../framework-traps.md#server-functions-reachable-by-direct-request).
   Time: 30 minutes. Running application, plus a repository search.
   Result: one line per redirect payload with the status and the resulting location, all of which stay on the application's own host, and zero deserialisers reached by request data without a fixed schema in front of them.

7. Drive the probe set at every parameter.
   Task: send one harmless probe per class to every query parameter, body field, header and path segment the enumeration found, including the ones not reflected in a response: SQL `'` and `1 OR 1=1`, markup `<b>x</b>` and `<script>1</script>`, template `{{7*7}}` and `${7*7}`, command `;echo x` and `$(echo x)`, path `../`, and header `%0d%0aX-Probe:1`. No probe writes, deletes or sleeps.
   Time: 60 minutes. Running application.
   Result: per parameter and probe the status code and the rendered output: no markup rendered as markup, no `49`, no command output, no added header, and no database error text, stack trace or query fragment in any response body.

8. Keep line breaks out of mail headers.
   Task: list the code that sends mail: `git grep -n -I -E 'sendMail|send_mail|createTransport|smtplib|mail\('`, with a planted `transporter.sendMail(opts)` as the positive control, and read where each recipient, sender, reply address and subject comes from. Then put `x%0d%0aBcc:%20second@<test domain>` and a raw line break into each request value that reaches one, such as a contact form name, an invitation address or a reset address, with a second test mailbox under control as the added recipient.
   Time: 20 minutes. Running application, plus the test mailboxes.
   Result: each request refused or the line break stripped, proved by the raw headers of the message received, which hold one line per header and no added recipient, and by the second mailbox receiving nothing.
