# Security

Security work runs as protocols. This file is the whole map. Read it, pick the two or three protocols the work in hand actually needs, and read only those.

Reading every protocol before every change is the wrong way to use the module. It spends context on rules the change cannot break and turns into a checklist nobody runs. A protocol that is not read is cheaper than a protocol that is skimmed.

Match the work against the second column: the words there describe a diff or a request, not a discipline. Most changes match two or three rows. When nothing matches, the change has no security surface and no protocol applies.

| Protocol | Applies when | Purpose |
| --- | --- | --- |
| [version-floor](protocols/version-floor.md) | Any audit, any runtime or framework upgrade, any version in the manifest or the lockfile | Fail anything running past its support date or below a published fix version |
| [secrets](protocols/secrets.md) | Any key, token, password, connection string, environment file, build output or log | Prove no live credential reaches the repository, the client bundle or a log line |
| [access-control](protocols/access-control.md) | Any route, endpoint, server action, job or query that reads an identifier from the request | Prove every object and every function checks the caller against the record |
| [authentication-and-session](protocols/authentication-and-session.md) | Any login, registration, password reset, token issue, cookie or logout path | Prove a session cannot be forged, fixed, replayed or kept alive after logout |
| [injection-and-output](protocols/injection-and-output.md) | Any query, command, template, redirect, deserialiser or value rendered from input | Prove untrusted data never becomes code, in the database, the shell or the page |
| [supply-chain](protocols/supply-chain.md) | Any dependency change, lockfile change, build pipeline or continuous integration workflow | Prove what installs is what was reviewed, and that a freshly poisoned release cannot land |
| [headers-and-transport](protocols/headers-and-transport.md) | Any deployed response, server or proxy configuration, certificate or cookie attribute | Prove the enforced headers and the transport settle at the target values, errors included |
| [request-forgery](protocols/request-forgery.md) | Any state-changing form, and any request the server makes to a URL it did not fix itself | Prove a cross-site request cannot act and a server-side fetch cannot reach the metadata service |
| [file-upload](protocols/file-upload.md) | Any upload, import, avatar, attachment, archive, generated document or image transform | Prove an uploaded file cannot execute, cannot come back as script, and cannot exhaust the disk |
| [resource-limits](protocols/resource-limits.md) | Any public endpoint, search, export, batch job, paid call or unbounded query | Prove every entry point has a ceiling and that reaching it costs the caller, not the service |
| [logging-and-errors](protocols/logging-and-errors.md) | Any error path, exception handler, log statement, alert rule or retention setting | Prove failures close, records carry no secrets, and an attack in progress raises something |
| [model-exposure](protocols/model-exposure.md) | Any model call, agent, tool, retrieval index or generated value that reaches a user or a system | Prove an injected instruction reaches nothing privileged and that spend has a hard ceiling |

Every protocol ends in artifacts: a status code, a command with its output, a version comparison, a search that returns no hits, or a query result. A step whose result is "reviewed" or "looks fine" is a step that was not run.

Four topics at the module root back the protocols and are read only when a step points at them:

- [standards.md](standards.md) names which published standard answers which question, with the editions current at the last check.
- [evidence.md](evidence.md) defines what counts as proof for each kind of check and how findings are ranked.
- [framework-traps.md](framework-traps.md) holds the failures that belong to a framework rather than to a category, with the advisories that fixed them.
- [rules-of-engagement.md](rules-of-engagement.md) sets what a pass may touch and what it may never touch.

The command [cyberattack](features/cyberattack.md) runs the module against a whole application or against one feature.

## What this module is not

It is not a penetration test and it is not a certification. It produces findings with the evidence that proves each one and the evidence that would prove it fixed. Deciding to accept a risk, to build a threat model, or to put a domain on a list that takes months to leave, is a person's decision, and the protocols say so at the step where it arises.
