# Web surface

What the browser receives and what another site can make it do: headers, the content policy, transport, cookies, forgery, cross-origin access, framing, rendered content and redirects.

## Headers and the content policy

**Applies when:** a response header, the server, proxy or edge configuration changes; a third-party script, font, embed or host is added; an inline script appears.

**Options:**

- **Headers set from the application or the server configuration.** The default, verified on the deployed origin on a success and on an error.
- **Content policy with nonces or hashes.** For inline scripts that cannot be moved out. Stricter, and needs the rendering layer to emit the nonce.
- **Content policy by allowlisted hosts.** Simpler for static sites, weaker when an allowed host serves user content.
- **Report-only first, enforcing after.** While tightening. Report-only never counts as enforcement.

**Open:** steps 1 to 5 of [headers-and-transport](../protocols/headers-and-transport.md); [headers.md](../headers.md).

## Transport and certificates

**Applies when:** a domain, certificate, redirect, proxy or TLS setting changes; HSTS is added or preload is considered.

**Options:**

- **Redirect plain HTTP to HTTPS on the same host, with HSTS at a real max-age.** Once HTTPS is stable.
- **HSTS preload.** Only by a person's decision, since removal takes months.
- **Automated renewal proved by a dry run.** Rather than trusted from a configuration file.

**Open:** steps 6 and 7 of [headers-and-transport](../protocols/headers-and-transport.md); [headers.md](../headers.md#preload).

## Cookies

**Applies when:** a cookie is set, renamed or given new attributes; a subdomain is added.

**Options:** the attributes and the `__Host-` prefix are set by the identity choices in [identity.md](identity.md#sessions-and-cookies).

**Open:** step 1 of [authentication-and-session](../protocols/authentication-and-session.md).

## Cross-site request forgery

**Applies when:** a form, a state-changing endpoint called from a browser, or a cookie-authenticated request is added; a handler on `GET` writes something.

**Options:**

- **Synchronizer token bound to the session.** The default for server-rendered forms.
- **Signed double submit token.** For applications that cannot keep token state on the server.
- **The framework's built-in protection.** When it implements one of the two above and is left enabled.
- **`SameSite` cookies.** Defence in depth only, never the control, because of the grace window in which a cross-site `POST` still carries a defaulted cookie.

**Open:** steps 1 to 3 of [cross-site-requests](../protocols/cross-site-requests.md).

## Cross-origin sharing and framing

**Applies when:** a cross-origin setting is added or widened; another origin calls the API with credentials; the site is embedded somewhere, or must not be.

**Options:**

- **Exact list of origins, only the methods and headers needed, credentials only where required.** The default, locked down before launch.
- **No cross-origin access at all.** When the API is only called from its own origin.
- **Framing refused, or allowed parents named explicitly.**

**Open:** steps 4 and 5 of [cross-site-requests](../protocols/cross-site-requests.md).

## Rendered content and scripts

**Applies when:** user or editor content is rendered; a raw HTML sink is used; markdown or rich text is added; users can supply themes, styles or layout.

**Options:**

- **Escaping by the template engine.** The default for everything that is not meant to be markup.
- **Sanitizer with an explicit tag and attribute allowlist, on the way in and on the way out.** For content that must stay markup. Two guards on the same value is the intended state.
- **Closed recipes for user styling.** Users pick from validated presets and values, never arbitrary CSS, markup or script.

**Open:** steps 4 and 5 of [injection-and-output](../protocols/injection-and-output.md); step 5 of [headers-and-transport](../protocols/headers-and-transport.md).

## Redirects

**Applies when:** a redirect reads its target from a parameter, such as a return URL after login.

**Options:**

- **Allowlist of paths or hosts.** The default. An open redirect is a phishing tool carrying the site's own domain.
- **Relative paths only.** Simpler, and still checked against protocol-relative and encoded forms.

**Open:** step 6 of [injection-and-output](../protocols/injection-and-output.md).
