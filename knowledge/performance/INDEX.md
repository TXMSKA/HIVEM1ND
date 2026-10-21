module: performance
purpose: Making an application do less work for the same result: fewer redraws, a smaller first load, fewer and cached requests, and data access that does not grow with the data, each change proved by a measurement taken before and after.

# Performance

Slowness is found by measuring, never by reading the code and guessing. Every protocol here starts by recording the current figures on a production build, changes only what the figures point to, and ends by recording the same figures again on the same machine, build and data. Match the work against the lines below, open the category file, and from it only the protocol steps it names. Work that matches no category is not covered here.

## Categories

- [rendering](categories/rendering.md): redraws and wasted renders, long lists, live updates and timers that redraw the interface.
- [loading](categories/loading.md): the size of the first load, code splitting and lazy loading, scripts and third parties, stylesheets, images and fonts.
- [network](categories/network.md): requests per view, duplicates and waterfalls, reloading after a change, HTTP caching, client and server caches.
- [data-access](categories/data-access.md): N+1 queries, slow queries and indexes, locks and contention behind an endpoint or a job.

## Routing

Which protocol steps and topic sections the category sends work to. A category file is still opened for its `Build:` recipes and options.

| Category | Protocols and steps | Topic sections |
| --- | --- | --- |
| rendering | render-audit 1 to 6 | [essentials.md](essentials.md): Measuring, Budgets |
| loading | bundle-and-scripts 1 to 8; assets-and-media 4 to 6 of the design module for images and fonts | [essentials.md](essentials.md): Measuring, Budgets |
| network | requests-and-caching 1 to 7 | [essentials.md](essentials.md): Measuring, Caching |
| data-access | queries-and-n-plus-one 1 to 8 | [essentials.md](essentials.md): Measuring, Budgets |

## Running the protocols

A pass over a whole application runs, in this order, queries-and-n-plus-one, requests-and-caching, bundle-and-scripts and render-audit, since a slow query makes every request slow and a redundant request makes every view redraw. A change to one surface runs only the protocol of its category. Each step's line is in [steps.md](steps.md), so a pass opens only the protocols whose steps it runs.

## Protocols

- [render-audit](protocols/render-audit.md): scope a rendered interface that redraws, a component tree, a view layer, a long list or a canvas. Counts the renders of each slow interaction, removes the ones that change nothing on screen and proves the count went down.
- [bundle-and-scripts](protocols/bundle-and-scripts.md): scope the JavaScript and CSS an application ships, its chunks, its dependencies and its third-party scripts. Measures the first load, splits and lazy-loads what the first view does not need, removes dead weight and orders the scripts.
- [requests-and-caching](protocols/requests-and-caching.md): scope the requests a client makes to its own server and to others, and the caches between them. Removes duplicate, chained and repeated requests and caches what can be cached, with the write that invalidates it.
- [queries-and-n-plus-one](protocols/queries-and-n-plus-one.md): scope the data access behind an endpoint or a job, databases, ORMs and stores read from files. Finds queries that grow with the data and queries that are slow, fixes them and guards the count with a test.

A Time value is a ceiling, a step that does not apply ends as not applicable with its reason, and evidence the tool at hand cannot produce is recorded as missing instead of being estimated.

## Command

None. Each protocol runs through `/protocol <name>`, and planning lists the ones whose scope a task touches.
