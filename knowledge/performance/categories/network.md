# Network

How many requests each view makes, how they wait on each other, and what is kept so that it is not asked for again.

## Requests per view

Applies when: a view makes many requests, the same resource is fetched twice, requests wait on each other, or a rate limit is reached.

Options:

- **One shared request** for every part of a view that needs the same resource, the default.
- **Parallel requests**, for resources that do not depend on each other.
- **One endpoint that answers the view**, when the view needs a chain.
- **A batch**, instead of one request per item.

Build: name the requests of each view before building it, share one request per resource, let a second caller join a request in flight, send independent requests in parallel, and ask only for the fields and the page the view shows.

Open: [requests-and-caching](../protocols/requests-and-caching.md), steps 1, 2 and 7.

## After a change

Applies when: an edit reloads every list of the view, polling runs constantly, or a hidden page keeps sending requests.

Options:

- **Update from the write's answer**, the default.
- **Update from the server's event**, when the server sends one.
- **Read again only what the change touched**, when neither carries the new state.

Build: apply the write's answer to the local state, refresh only the views the change touched, replace polling with server events where the server offers them, and stop background work while the page is hidden.

Open: [requests-and-caching](../protocols/requests-and-caching.md), step 3.

## HTTP caching

Applies when: a warm load downloads files again, assets have no cache headers, or answers are not compressed.

Options:

- **A year and immutable** for files whose name carries a content hash.
- **Revalidation with an ETag or a modification date** for HTML and API answers.
- **No shared caching** for personal answers.

Build: hash the names of built assets, cache them for a year as immutable, revalidate everything else, compress text with Brotli or gzip, and mark personal answers private.

Open: [requests-and-caching](../protocols/requests-and-caching.md), step 4; [essentials.md](../essentials.md), Caching.

## Client and server caches

Applies when: the same data is fetched in several places, a computed answer is slow, or a cache shows stale data after a write.

Options:

- **One client cache with a key per resource**, the default for fetched data.
- **A server cache cleared by the write path**, for an expensive computed answer, after its queries are right.
- **No cache**, when the data changes on every read or is rarely read twice.

Build: give every cache its key, its bound and the write that invalidates it, show the cached answer while checking it again, clear the client cache on sign-out, and test that a write is visible on the next read.

Open: [requests-and-caching](../protocols/requests-and-caching.md), steps 5 and 6; [essentials.md](../essentials.md), Caching.
