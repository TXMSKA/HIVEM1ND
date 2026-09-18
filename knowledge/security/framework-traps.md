# Framework traps

Some failures belong to a framework rather than to a category. They are worth their own steps because the generic protocol does not find them: the code looks correct, the pattern is the documented one, and the hole is in the layer underneath.

The version numbers below were read at the vendor advisory pages named, on 2026-09-17. **A version in this file is never used as the answer.** The step fetches the advisory and compares the installed version against the number on that page in the same pass, because a fixed version is superseded the moment the next advisory lands. What this file is for is knowing which pages to fetch and what shape of failure to look for.

## Authorization skipped through a trusted internal header

Middleware that carries the authorization check can be bypassed when the framework trusts an internal header on an inbound request. The request arrives with the header set, the framework believes the request already passed through middleware, and the check never runs.

Advisory: GHSA-f82v-jwr5-mffw, CVE-2025-29927, "Authorization Bypass in Next.js Middleware", critical, CVSS 9.1. Affected 12.0.0 to 12.3.4, 13.0.0 to 13.5.8, 14.0.0 to 14.2.24 and 15.0.0 to 15.2.2. Patched in 12.3.5, 13.5.9, 14.2.25 and 15.2.3. The advisory also gives an infrastructure mitigation: strip the header from external requests before they reach the application.
Source: https://github.com/advisories/GHSA-f82v-jwr5-mffw

The lesson outlives the advisory. Middleware is a convenience, and the control belongs where the work happens. [access-control](protocols/access-control.md) tests each endpoint by direct request for exactly this reason.

## Server functions reachable by direct request

Server actions and server functions are routed endpoints. The page that renders the form does not gate them: a request built by hand reaches the function whatever the page decided. Authorization belongs inside each action, in its first statements, and not on the page or the layout that renders it.

Two advisories mark the boundary. Server actions performing a relative redirect were vulnerable to request forgery through the host header in self-hosted deployments: CVE-2024-34351, GHSA-fr5h-rqp8-mj6g, high, CVSS 7.5, affecting 13.4 through 14.1.0 and patched in 14.1.1 (https://github.com/vercel/next.js/security/advisories/GHSA-fr5h-rqp8-mj6g).

The server components protocol itself carried an unauthenticated remote code execution through unsafe deserialisation of the payload sent to a server function endpoint: CVE-2025-55182, CVSS 10.0, disclosed 2025-12-03. The affected releases were React 19.0, 19.1.0, 19.1.1 and 19.2.0, patched in 19.0.1, 19.1.2 and 19.2.1. The vulnerable code lives in the `react-server-dom-webpack`, `react-server-dom-parcel` and `react-server-dom-turbopack` packages, and the vendor names several frameworks and bundlers that depended on, had peer dependencies for, or bundled them.
Source: https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components

This is the reason the version check reads **both** the framework and the view library. A framework pinned to a fixed release can still resolve a vulnerable view library underneath it, and a lockfile is the only place that question is answered.

## The image endpoint is a server-side fetch proxy

An image optimization endpoint takes a URL from the query string and fetches it from the server. That is a request forgery primitive with a cache in front of it, whatever it is called in the routing table. It must refuse the cloud metadata address, private ranges and loopback, and it must restrict remote sources to configured hosts.

The same endpoint is also a decoder exposed to the network, and the decoder is third-party. One advisory, "Unauthenticated Remote Code Execution in Image Optimization API when AVIF files are used", critical, CVSS 9.5, no CVE assigned at the time of reading, affected 10.0.0 up to 15.5.24 and releases below 16.3.3, patched in 15.5.24 and 16.3.3. The flaw was in the image library underneath, and the vendor mitigation was to disable AVIF optimization.
Source: https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4

Both properties are tested: the fetch boundary in [request-forgery](protocols/request-forgery.md), the decoder in [file-upload](protocols/file-upload.md).

## Cache poisoning of rendered routes

A server-rendered route in front of a shared cache turns a response-splitting or header-reflection bug into a stored one. The cache key is the thing to read: any header that reaches the response but is not in the key lets one request's output be served to everyone else. Internal framework headers that name the matched path, the cache state or a redirect are part of this surface and are stripped at the edge.

The header removal list used by [headers-and-transport](protocols/headers-and-transport.md) includes those internal headers by name, which is a convenient way to find out whether they are leaving the edge at all.

## How a version step is actually run

1. Read the installed versions from the lockfile, not the manifest.
2. Fetch the vendor's security advisories index for each framework and view library in that list, in the pass, and read the advisories that cover the installed major.
3. Record installed version, fixed version, advisory identifier and advisory URL, one line each.
4. A dependency audit runs alongside this and does not replace it: an advisory published hours ago, or one the registry never indexed, will not appear in it.
