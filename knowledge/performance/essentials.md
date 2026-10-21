# Performance essentials

The floor rules, which every performance change meets, and the default budgets, read first when building something new or passing over a whole application. A project that states its own budgets in its brief or product document uses those instead of the defaults.

## Measuring

- A figure is taken on a production build, never on a development server, and names its machine, browser or runtime, network profile and data volume.
- Every change carries a before and an after figure taken the same way. A change with no figure behind it is not a performance change and is not merged as one.
- Interface figures are taken with a throttled CPU (4 times slower) and network (a mid mobile profile) as well as unthrottled, since a fast development machine hides most of the cost.
- A figure is the median of at least three runs, and the spread is recorded when it is above a tenth of the median.
- Work is removed before it is cached, and cached before it is made faster: the cheapest render, request or query is the one that does not happen.
- Correctness comes first: the tests that passed before the change still pass after it, and a cache never returns data the person should not see or data older than the write they just made.
- Measurements use a copy of the data with the size of the real one. The live data of a person or a customer is read only with their permission and never changed.

## Budgets

Defaults, for an interface on a mid phone over a mid mobile network, and for a server on its production hardware.

- Interaction to next paint: 200 ms or less for every primary interaction.
- Largest contentful paint: 2.5 s or less on a cold load.
- Cumulative layout shift: below 0.1.
- Long tasks: no task above 50 ms while the person types or scrolls.
- Renders: an update redraws only the parts whose output changes; a list item that did not change is not rendered again.
- First load: 170 KB or less of compressed JavaScript before the first interaction, and no render-blocking script that the first view does not need.
- Requests: no resource fetched twice in one view, and no chain of more than two requests that wait on each other before the first view shows.
- Server: 200 ms or less at the 95th percentile for a read endpoint with real data volume, 500 ms for a write.
- Queries: the number of queries of an endpoint does not grow with the number of items it returns.

## Caching

- Every cache names the write that invalidates it, and a test proves that a write is visible on the next read.
- Files whose name carries a content hash are cached for a year as immutable; HTML and API answers are revalidated with an ETag or a modification date.
- Personal data is never stored in a shared cache, and a cache in the browser is cleared when the person signs out.
- A cache is bounded in size or in age, and its hit rate is measured; a cache that is rarely hit is removed.
