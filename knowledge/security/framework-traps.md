# Framework traps

Some failures belong to a framework rather than to a category. They are worth their own steps because the generic protocol does not find them: the code looks correct, the pattern is the documented one, and the hole is in the layer underneath. This topic holds the shapes of those failures. The dated advisories that taught each one are in [incidents.md](incidents.md).

## Authorization skipped through a trusted internal header

Middleware that carries the authorization check can be bypassed when the framework trusts an internal header on an inbound request. The request arrives with the header set, the framework believes the request already passed through middleware, and the check never runs. Middleware is a convenience, and the control belongs where the work happens. [access-control](protocols/access-control.md) tests each endpoint by direct request for this reason, and stripping internal headers at the edge is the infrastructure mitigation.

## Server functions reachable by direct request

Server actions and server functions are routed endpoints. The page that renders the form does not gate them: a request built by hand reaches the function whatever the page decided. Authorization belongs inside each action, in its first statements, and not on the page or the layout that renders it.

The payload sent to a server function endpoint is also deserialised by the view library, and that deserialiser has carried an unauthenticated remote code execution. The version check therefore reads both the framework and the view library: a framework pinned to a fixed release can still resolve a vulnerable view library underneath it, and the lockfile is the only place that question is answered.

## Server-only code reaching the client bundle

A module that reads secrets or the database is imported by a component that renders in the browser, and the bundler ships it. A server-only marker on such modules turns the mistake into a build failure instead of a leak. When the marker breaks a build, the fix is a separate entry point for the server part, never removing the marker. The value search in [secrets](protocols/secrets.md) is what proves nothing got through.

## The image endpoint is a server-side fetch proxy

An image optimization endpoint takes a URL from the query string and fetches it from the server. That is a request forgery primitive with a cache in front of it, whatever it is called in the routing table. It must refuse the cloud metadata address, private ranges and loopback, and restrict remote sources to configured hosts.

The same endpoint is a decoder exposed to the network, and the decoder is third-party. Both properties are tested: the fetch boundary in [outbound-requests](protocols/outbound-requests.md), the decoder in [file-upload](protocols/file-upload.md).

## The same version, a different exposure

A framework advisory often depends on how the application is hosted: self-hosted or on a managed platform, on one operating system or another, as a server or as a static export. The version alone does not answer whether a deployment is exposed. The hosting mode, the operating system of the host and whether a server runs in production at all are recorded next to the version. A static export runs no framework server in production, so a server-side advisory reaches only the development server; the version is still raised, at a lower rank.

## One version across repositories that share a package

When several repositories consume a shared package that declares the framework or the view library, a critical advisory is fixed by pinning one fixed version in every one of them. A consumer left on an older version pulls the shared package back into the vulnerable range, and two copies of the view library in one tree break in ways that hide the version actually running. The shared package declares the view library as a peer dependency so the consumer's copy is the only one. A repository excluded from the pin is recorded with the reason.

## Cache poisoning of rendered routes

A server-rendered route in front of a shared cache turns a response-splitting or header-reflection bug into a stored one. The cache key is the thing to read: any header that reaches the response but is not in the key lets one request's output be served to everyone else. Internal framework headers that name the matched path, the cache state or a redirect are part of this surface and are stripped at the edge. The removal list used by [headers-and-transport](protocols/headers-and-transport.md) includes them by name.

## How a version step is actually run

1. Read the installed versions from the lockfile, not the manifest.
2. Fetch the vendor's security advisories index for each framework and view library in that list, in the pass, and read the advisories that cover the installed major.
3. Record installed version, fixed version, advisory identifier and advisory URL, one line each, plus the hosting mode and host operating system when the advisory depends on them.
4. A dependency audit runs alongside this and does not replace it: an advisory published hours ago, or one the registry never indexed, will not appear in it.
