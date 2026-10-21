# Protocol steps

What each protocol step checks, in a few words, so a pass can pick its steps from the [routing table](INDEX.md#routing) without opening every protocol. A protocol file is opened only when at least one of its steps will actually run; a step whose subject the application does not have ends as not applicable from its line here. Each protocol file holds the task, the time and the result that counts as evidence.

- [render-audit](protocols/render-audit.md): 1 primary interactions recorded, throttled; 2 renders counted, wasted ones marked; 3 a cause for each wasted render; 4 the work removed at its source; 5 interactions measured again; 6 a test that fails when the fix regresses.
- [bundle-and-scripts](protocols/bundle-and-scripts.md): 1 chunks and cold load measured; 2 heaviest and duplicated dependencies mapped; 3 routes and features split and lazy-loaded; 4 dead and heavy weight removed; 5 scripts deferred and third parties delayed; 6 unused and blocking CSS trimmed; 7 cold load measured again; 8 a size check in the build.
- [requests-and-caching](protocols/requests-and-caching.md): 1 requests per view and flow recorded; 2 duplicates and chains removed; 3 less read after a change, polling and hidden pages; 4 HTTP cache headers and compression; 5 one client cache with invalidation; 6 server cache only after the queries; 7 flows measured again, throttled.
- [queries-and-n-plus-one](protocols/queries-and-n-plus-one.md): 1 queries logged per request; 2 counts at 1, 10 and 100 items; 3 N+1 fixed with joins or batches; 4 slow queries and their plans; 5 indexes, columns and key paging; 6 locks held across slow work; 7 endpoints measured again; 8 a test on each query count.

A pass over a whole application starts from the first and the measuring steps of each protocol: render-audit 1 and 2, bundle-and-scripts 1 and 2, requests-and-caching 1, and queries-and-n-plus-one 1, 2 and 4. Any other step runs only when those figures point to its subject.
