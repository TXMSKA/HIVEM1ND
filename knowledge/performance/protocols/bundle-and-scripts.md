name: bundle-and-scripts
purpose: Ship less code before the first interaction: split and lazy-load what the first view does not need, remove dead and duplicated weight, and keep scripts and stylesheets from blocking the first paint.
scope: the JavaScript and CSS an application ships, its entry and lazy chunks, its dependencies, its third-party scripts and its stylesheets
trigger: manual, on a slow first load, on a dependency added, and task close for a change that adds a dependency, a route or a third-party script
repeat: once per application, and again whenever a dependency or a third-party script is added
inputs: the production build and its source maps, the dependency manifest, the browser's network and coverage panels, a bundle analyzer for the project's bundler
stop: the build produces no source maps and none can be produced, in which case steps 2 and 4 are recorded as not measurable; a removed dependency breaks a test, in which case it is restored and reported
report: the chunk table before and after, the heaviest dependencies and their users, the chunks made lazy with their trigger, the weight removed, the script table, the stylesheet coverage and the cold-load figures

## Steps

1. Measure what ships.
   Task: build for production and list every emitted chunk with its raw and compressed size. Load the first view with the cache disabled and the network throttled to a mid mobile profile, and record the transferred JavaScript and CSS, the largest contentful paint and the total blocking time.
   Time: 20 minutes.
   Result: the chunk table, the compressed JavaScript before the first interaction compared with the budget of [essentials.md](../essentials.md), Budgets, and the cold-load figures, each the median of three runs.

2. Map what is inside.
   Task: open the bundle analyzer of the project's bundler, or a source map explorer, on the production build. List the twenty heaviest modules and dependencies with their size, the route or feature that uses each, and any package present in two versions.
   Time: 20 minutes.
   Result: the list, every heavy dependency with at least one user named, and the duplicated packages with both versions.

3. Split by route and by feature.
   Task: load with a dynamic import every route, dialog, editor, chart, settings or admin area and large dependency that the first view does not show, each with a loading state that has the shape of what comes, and start loading a chunk on intent, such as hover or focus on its control, where the wait would show.
   Time: 2 hours.
   Result: each new lazy chunk named with its size and the action that loads it, the entry chunk smaller than in step 1, and no lazy chunk requested during the first paint, checked in the network panel.

4. Remove and replace weight.
   Task: remove dependencies nothing imports, import single functions instead of whole libraries, replace heavy packages with lighter ones or with the platform's own features where a test covers the use, make the bundler drop unused exports, and keep one version of each package.
   Time: 2 hours.
   Result: a list of dependencies removed or replaced with the compressed bytes saved by each, the duplicated packages of step 2 at one version, and the project's tests passing.

5. Order the scripts.
   Task: list every script the page loads with its origin, owner, purpose and loading mode. Make first-party scripts deferred or modules, load each third-party script after the first interaction or when the browser is idle unless the first view needs it, and remove any third-party script without an owner or a purpose.
   Time: 30 minutes.
   Result: the script table, zero scripts in the head without `defer`, `async` or `type="module"` unless the table states why, and zero third-party scripts without an owner.

6. Trim the stylesheets.
   Task: measure unused CSS on the first view with the coverage panel, remove rules nothing matches, inline or preload only what the first viewport needs, and load the rest without blocking the first paint.
   Time: 30 minutes.
   Result: the unused share of CSS before and after, and the count of render-blocking stylesheets before and after.

7. Measure again.
   Task: repeat the cold load of step 1 the same way. Images and fonts are measured and fixed with steps 4 to 6 of `assets-and-media` in the design module when that module is installed.
   Time: 20 minutes.
   Result: compressed JavaScript before the first interaction, largest contentful paint and total blocking time equal or lower than in step 1, the budget met or the gap stated, and no figure worse.

8. Guard the size.
   Task: add a size check to the build or the test run that fails when the entry chunk or the total JavaScript before the first interaction grows above the measured size plus a tenth. Prove it by importing a large unused dependency into the entry locally.
   Time: 30 minutes.
   Result: the check passes on the current build, fails with the large import, and its command is in the report.
