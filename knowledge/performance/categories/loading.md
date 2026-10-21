# Loading

What the first view downloads and runs before the person can use it.

## Code splitting and lazy loading

Applies when: the first load is slow, the entry chunk grows, a route, dialog, editor or chart loads code the first view does not show, or a heavy dependency is added.

Options:

- **Split by route**, the default for an application with several screens.
- **Load a feature on intent**, on hover or focus of its control, for a dialog, an editor or a chart.
- **Keep it in the entry**, for code the first view runs.

Build: import each route and each large feature dynamically, give every lazy part a loading state with the shape of what comes, preload on intent where the wait would show, and keep the compressed JavaScript before the first interaction within the budget.

Open: [bundle-and-scripts](../protocols/bundle-and-scripts.md), steps 1 to 3 and 7 to 8; [essentials.md](../essentials.md), Budgets.

## Dependencies

Applies when: a package is added, the bundle grows without a feature, a package appears in two versions, or a whole library is imported for one function.

Options:

- **The platform's own feature**, when a test covers the use.
- **A lighter package** with the same behaviour.
- **One function imported**, instead of the whole library.

Build: check the compressed size of a package before adding it, import only what is used, keep one version of each package, and remove what nothing imports.

Open: [bundle-and-scripts](../protocols/bundle-and-scripts.md), steps 2 and 4.

## Scripts and third parties

Applies when: analytics, chat widgets, tag managers, ads or embeds are added, or a script blocks the first paint.

Options:

- **Deferred or module scripts** for first-party code, the default.
- **After the first interaction or when idle**, for third-party scripts the first view does not need.
- **Removed**, for a script without an owner or a purpose.

Build: give every script an owner and a purpose, load first-party code as deferred modules, delay third parties, and keep no render-blocking script the first view does not need.

Open: [bundle-and-scripts](../protocols/bundle-and-scripts.md), step 5.

## Stylesheets

Applies when: CSS blocks the first paint, most of a stylesheet is unused on the first view, or styles load from several files.

Options:

- **One stylesheet for the first view and the rest loaded later**, the default for a large application.
- **One small stylesheet**, for a small surface.

Build: keep the CSS of the first viewport small and loaded first, remove rules nothing matches, and load the rest without blocking the first paint.

Open: [bundle-and-scripts](../protocols/bundle-and-scripts.md), step 6.

## Images and fonts

Applies when: images or fonts are added, the largest paint is an image, or text flashes or shifts while a face loads.

Build: follow the Images and Fonts recipes of the design module's media-and-icons category when that module is installed: WebP or AVIF at twice the rendered box, reserved dimensions, lazy loading below the fold, high priority on the largest image, and self-hosted WOFF2 faces with a swap display, preloading only the faces of the first viewport.

Open: the design module's assets-and-media protocol, steps 4 to 6.
