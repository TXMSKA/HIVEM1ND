# Data access

How an endpoint or a job reads and writes its data, and how that cost grows with the data.

## N+1 queries

Applies when: a list endpoint gets slower as the list grows, the query log shows one query per item, or an ORM relation is read inside a loop.

Options:

- **A join or an eager load of the relation**, the default.
- **One query with `IN` over the collected ids**, batched per request.
- **A directory read once and indexed**, for a store kept in files.

Build: load each relation a list shows together with the list, keep queries out of loops, and assert the query count of every list endpoint in a test with several items.

Open: [queries-and-n-plus-one](../protocols/queries-and-n-plus-one.md), steps 1 to 3 and 8.

## Slow queries and indexes

Applies when: a query takes more than 100 ms, the plan shows a full scan, a page deep in a list is slow, or one query dominates the total time.

Options:

- **An index that matches the filter and the sort**, the default.
- **Paging with a key from the last row**, instead of a large offset.
- **Fewer columns**, when the caller uses few.

Build: read the plan of every query a list or a search runs, index its filter and its sort, select only the columns used, and page with a key.

Open: [queries-and-n-plus-one](../protocols/queries-and-n-plus-one.md), steps 4, 5 and 7.

## Locks and contention

Applies when: requests wait on each other, a job blocks the interface, a transaction stays open across file or network work, or a deadlock appears.

Options:

- **Short transactions**, with file reads, network calls and rescans before or after them, the default.
- **Work split in slices** that release the lock in between, for a long pass.
- **A queue**, for slow work that does not need an answer now.

Build: hold a lock only around the write it protects, never call the network or rescan a folder inside it, release it between slices of a long pass, and measure the longest hold.

Open: [queries-and-n-plus-one](../protocols/queries-and-n-plus-one.md), step 6.
