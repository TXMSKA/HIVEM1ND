name: requests-and-caching
purpose: Make each view ask for what it needs once, avoid reading again what a change did not touch, and cache answers with the write that invalidates them.
scope: the requests a client makes to its own server and to others, polling and live updates, HTTP caching, client data caches, service workers and server-side caches
trigger: manual, on a slow view, a flood of requests in the network panel or a rate limit reached, and task close for a change to data loading, caching or live updates
repeat: once per application, and again whenever a view or a cache is added
inputs: the production build, the browser's network panel or a recorded HAR of each primary flow, the server's request log, the response headers of each resource type
stop: a cache would serve one person's data to another, in which case it is removed and reported; a flow cannot be recorded without changing a person's real data, in which case it runs on a copy or is recorded as not measured
report: the requests per view and per flow before and after, the duplicates and chains removed, the requests after one edit, the header table, every cache with its invalidating write, and the throttled timings

## Steps

1. Record the requests.
   Task: record a cold load, a warm load and each primary flow with the network panel or as a HAR. For every view, count the requests, the bytes, the requests made twice for the same resource, the chains of requests that wait on each other, and the polling intervals.
   Time: 30 minutes.
   Result: a table with one row per view and flow: requests, bytes, duplicates, longest chain and polling, from a recording that is kept with the report.

2. Remove duplicates and chains.
   Task: share one request among the parts of a view that need the same resource, and let a second caller join a request already in flight instead of sending its own. Send independent requests in parallel, and give a view that needs a chain one endpoint that answers what it needs. Ask only for the fields and the page a view shows, and batch per-item requests into one.
   Time: 2 hours.
   Result: duplicates at zero and no chain longer than two before the first view, in the table of step 1 recorded again.

3. Read less after a change.
   Task: after an edit, update the local state from the write's answer or from the event the server sends, and read again only what the change touched, never every list of the view. Replace polling with server events where the server offers them, or lengthen the interval with backoff, and stop background requests while the page is hidden.
   Time: 2 hours.
   Result: the requests sent after one typical edit, before and after, and zero requests sent by a hidden page during one minute.

4. Set the HTTP caching.
   Task: give files whose name carries a content hash `Cache-Control: public, max-age=31536000, immutable`; give HTML and API answers revalidation with an ETag or a modification date, or a short private age; compress text answers with Brotli or gzip; keep personal answers out of shared caches, following [essentials.md](../essentials.md), Caching.
   Time: 30 minutes.
   Result: a header table per resource type, revalidation answered with 304 on a warm load, and a warm load that transfers only what changed.

5. Keep one client cache.
   Task: hold fetched data in one client cache with a key per resource, show the cached answer while it is checked again, bound its size or age, tie every key to the writes that make it stale, and clear it when the person signs out.
   Time: 1 hour; a client that keeps no fetched data ends this step as not applicable.
   Result: a list of cached keys, each with the write that invalidates it, and a test that writes and then reads the fresh value.

6. Cache on the server last.
   Task: only after the queries are right, by [queries-and-n-plus-one](queries-and-n-plus-one.md), keep expensive computed answers in a server cache that the write path clears explicitly. A cache is never added to hide a query that grows with the data.
   Time: 1 hour; a server with no answer slower than its budget ends this step as not applicable.
   Result: latency and hit rate before and after for each cached answer, and a test that a write is visible on the next read.

7. Measure again.
   Task: record the flows of step 1 again on a throttled mid mobile network.
   Time: 20 minutes.
   Result: requests, bytes and time per flow before and after, none worse, and the budget of [essentials.md](../essentials.md), Budgets, met or the gap stated.
