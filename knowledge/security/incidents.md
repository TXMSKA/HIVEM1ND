# Incidents

A dated log of incidents, advisories and leaks worth knowing when auditing an application. Each entry says what happened in two or three sentences and what to check because of it. The newest entry goes at the top.

An entry is added only after its facts were read at the source named in it, and the date is the date of the advisory or the first public report, not the date it was logged. A version in an entry is never used as the answer in a pass: the step fetches the advisory again and compares against the number on that page, per [framework-traps.md](framework-traps.md).

Entry format:

```markdown
## YYYY-MM-DD: short title

What happened, in two or three sentences, with the identifier.
Source: the advisory or report URL.
Check: what an audit looks for because of it, and the protocol step that does it.
Categories: the categories in INDEX.md it belongs to.
```

## 2026-08-25: Remote code execution on framework servers hosted on Windows

A path traversal in the framework's pathname handling allowed unauthenticated remote code execution when the server ran on a Windows filesystem, with both routers in use and without cache components. CVE-2026-75604, GHSA-p293-qw3h-jr36, critical, CVSS 9.0. Affected `next` from 13.4.0 below 15.5.24 and from 16.0.0 below 16.3.3, patched in 15.5.24 and 16.3.3.
Source: https://github.com/advisories/GHSA-p293-qw3h-jr36
Check: the host operating system of every deployment is recorded next to the framework version, because the same version is exploitable on one host and not on another. Where several repositories share a package that declares the framework as a dependency, one fixed version is pinned across all of them, since a consumer on an older version pulls the shared package back into the vulnerable range. A repository whose output is a purely static export runs no framework server in production, so its exposure is limited to the development server; that is recorded as the reason for a lower rank, not as a pass. Steps 1 to 3 of [version-floor](protocols/version-floor.md).
Categories: dependencies, deployment.

## 2026-08-25: Remote code execution through AVIF images in the image optimization endpoint

A flaw in `libheif`, reached through the image processing library the framework uses for optimization, allowed unauthenticated remote code execution when AVIF files were processed. GHSA-2xp9-vwfh-vxw4, critical, CVSS 9.5, no CVE assigned at the time of reading. Affected `next` from 10.0.0 below 15.5.24 and below 16.3.3, patched in 15.5.24 and 16.3.3. The vendor mitigation was to disable AVIF optimization until the fix propagated.
Source: https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4
Check: the image endpoint is a decoder exposed to the network. The image processing library is read from the lockfile alongside the framework, and a format that cannot be made safe is disabled in the configuration. Step 4 of [file-upload](protocols/file-upload.md), step 3 of [version-floor](protocols/version-floor.md).
Categories: files, outbound, dependencies.

## 2026-08-04: ChainDrop registry worm

A self-propagating worm of the Shai-Hulud family poisoned more than 400 packages on the npm registry. Entry was through stolen maintainer credentials, and it spread through stolen publishing tokens and continuous integration publishing access. The payload ran from a `preinstall` hook and harvested registry, source host, cloud, cluster and vault credentials, including runner and workflow secrets. Many poisoned versions had no matching commit, tag or release in the source repository.
Source: https://www.microsoft.com/en-us/security/blog/2026/08/04/chaindrop-supply-chain-compromise-anatomy-self-propagating-worm/
Check: install scripts refused by default and a minimum release age set, per steps 1 and 2 of [supply-chain](protocols/supply-chain.md). A version with no source commit or tag behind it is a signal worth reading in step 6. Caches and artifact stores are part of the cleanup, because a poisoned tarball survives there after the registry removes it.
Categories: dependencies, secrets and configuration.

## 2025-12-03: Remote code execution in the server components protocol

Unsafe deserialisation of the payload sent to a server function endpoint allowed unauthenticated remote code execution. CVE-2025-55182, CVSS 10.0. Affected React 19.0, 19.1.0, 19.1.1 and 19.2.0, patched in 19.0.1, 19.1.2 and 19.2.1. The vulnerable code lives in `react-server-dom-webpack`, `react-server-dom-parcel` and `react-server-dom-turbopack`, which several frameworks and bundlers depend on or bundle.
Source: https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components
Check: the version check reads both the framework and the view library from the lockfile, because a framework on a fixed release can still resolve a vulnerable view library underneath it. Step 2 of [version-floor](protocols/version-floor.md), step 6 of [injection-and-output](protocols/injection-and-output.md).
Categories: dependencies, API.

## 2025-11-24: Shai-Hulud 2.0 registry worm

A second self-replicating worm backdoored 796 npm packages. It added a `preinstall` script, which runs earlier than the first wave's `postinstall`, and harvested environment variables, local credentials, cloud credentials and secrets from cloud secret managers, publishing them to new repositories created with the victim's own source host credentials.
Source: https://securitylabs.datadoghq.com/articles/shai-hulud-2.0-npm-worm/
Check: steps 1 and 2 of [supply-chain](protocols/supply-chain.md). A developer machine and a runner that hold publishing tokens are the targets, so those tokens are scoped and short lived, per [secrets](protocols/secrets.md).
Categories: dependencies, secrets and configuration.

## 2025-09-23: Shai-Hulud registry worm

A self-replicating worm compromised more than 500 npm packages, scanned the environment for source host tokens and cloud keys, exfiltrated them, and published poisoned versions of every package the stolen tokens could reach. The public alert recommended reviewing lockfiles for affected versions, pinning to releases from before the compromise, rotating developer credentials and requiring phishing-resistant multifactor authentication on developer accounts.
Source: https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem
Check: the lockfile, not the manifest, is searched for affected versions. Steps 1 to 3 of [supply-chain](protocols/supply-chain.md); rotation per step 5 of [secrets](protocols/secrets.md).
Categories: dependencies, secrets and configuration.

## 2025-08-06: A major free certificate issuer shut down its revocation responder

The most common free certificate issuer stopped including responder URLs in its certificates in May 2025 and shut the responder down on 2025-08-06, publishing revocation by list only.
Source: https://letsencrypt.org/2025/08/06/ocsp-service-has-reached-end-of-life
Check: missing stapling is not a finding for certificates from that issuer. Step 7 of [headers-and-transport](protocols/headers-and-transport.md).
Categories: web surface.

## 2025-03-21: Middleware authorization bypass through an internal header

Middleware carrying the authorization check could be skipped by sending the internal header the framework uses to mark a subrequest. CVE-2025-29927, GHSA-f82v-jwr5-mffw, critical, CVSS 9.1. Affected `next` 12.0.0 to 12.3.4, 13.0.0 to 13.5.8, 14.0.0 to 14.2.24 and 15.0.0 to 15.2.2, patched in 12.3.5, 13.5.9, 14.2.25 and 15.2.3. The advisory also gives an infrastructure mitigation: strip the header from external requests.
Source: https://github.com/advisories/GHSA-f82v-jwr5-mffw
Check: every endpoint is tested by direct request, with the check inside the handler rather than in middleware in front of it. Step 5 of [access-control](protocols/access-control.md).
Categories: API, identity.

## 2024-05-09: Request forgery through the host header in server actions

A server action performing a redirect to a relative path could be made to fetch from an attacker-chosen host by modifying the `Host` header, in self-hosted deployments. CVE-2024-34351, GHSA-fr5h-rqp8-mj6g, high, CVSS 7.5. Affected `next` from 13.4.0 below 14.1.1, patched in 14.1.1.
Source: https://github.com/advisories/GHSA-fr5h-rqp8-mj6g
Check: self-hosting changes the exposure of the same version, so the hosting mode is recorded with the version. Step 3 of [outbound-requests](protocols/outbound-requests.md).
Categories: outbound, deployment.
