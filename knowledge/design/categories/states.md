# States

Every state a surface can reach besides the populated one: empty, loading, error, success, disabled, first use, not found. The inventory runs in [interface-states](../protocols/interface-states.md).

## Empty

Applies when: a list, a table, a search or a dashboard can have no content; a screen says "No data"; a filter can exclude everything.

Build: One component per kind: a title naming the object, a small visual from the icon set or none, one or two sentences with the reason, and one action. These words are structural: the design pass writes them and flags them for copy.

Options:

- **First use**: create, or start from a template or an example.
- **Cleared by the person**: a light touch and an easy way back.
- **No results**: the query stays visible, with a way to clear or widen it.
- **No permission** and **failed to load**: explain and offer access or a retry, never an invitation to create.

Open: [interface-states](../protocols/interface-states.md), step 3; [states.md, Empty](../states.md#empty); [microcopy.md, Empty states](../../copy/microcopy.md#empty-states) for the kinds and their words.

## Loading

Applies when: data is fetched, a page loads slowly, a spinner sits in the middle of content, or content jumps when data lands.

Build: A skeleton built from the real component, on the same grid and breakpoints, with bars one line height tall and a count equal to the page size; loading text only in a slot that already exists or inside the control that started the work; then the shift measurement in [evidence.md, Computed number](../evidence.md#computed-number).

Options:

- **Skeleton** in the shape of the final content: the default for content.
- **Spinner in the control** that started the work, keeping its label.
- **Determinate progress with an estimate** for long operations.
- **Optimistic update with rollback** when the result is almost always a success.

Open: [interface-states](../protocols/interface-states.md), step 4; [states.md, Loading](../states.md#loading); [animation.md, Recipes](../animation.md#recipes).

## Error

Applies when: a request fails, a page cannot load, the network drops, a permission is missing, or a message reads "Something went wrong".

Build: In place of the failed component: what failed and a retry button, the rest of the screen still working, the message in a `role="alert"` region, and what was typed kept. The message comes from the table of causes in [microcopy.md](../../copy/microcopy.md#table-of-causes), with a written fallback, never from the exception or the response body.

Options:

- **Inline at the field** for invalid input.
- **In place of the failed component** with a retry, leaving the rest of the screen working.
- **A full page** only when nothing on the screen can work, with a way out.

Open: [interface-states](../protocols/interface-states.md), steps 3 and 7; [states.md, Error](../states.md#error).

## Success

Applies when: a save, a submission, a purchase or a first achievement completes; a form resets silently.

Build: A state in place for small actions, announced in a status region, saying what happened and what comes next; a toast only for a result that needs no answer.

Options:

- **A brief, certain confirmation** for routine actions.
- **A success state or a page of its own** after a submission or a conversion, saying what happens next.
- **A celebration** only for real effort or a first success.

Open: [interface-states](../protocols/interface-states.md), step 4; [states.md, Success](../states.md#success); [animation.md, Gates](../animation.md#gates).

## Disabled

Applies when: a control is greyed out, a primary action is blocked until something is filled, or a request says "the button does nothing".

Build: A disabled primary action is allowed only with a visible reason next to it; otherwise it stays enabled and validates on submit. The reason is tied by `aria-describedby`; the disabled control takes neutral colours rather than the accent and stays readable.

Options:

- **Disabled with a visible reason next to it** and the unblocking action one step away.
- **Enabled with validation on press**, when the reasons are several or spread across the form.
- **Hidden**, only when the person can never use the control in this context.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 5; [states.md, Disabled](../states.md#disabled).

## First use and onboarding

Applies when: a product, game, section or app inside a product opens for the first time, a new account lands on an empty product, a tour or tips are added, or a new feature is announced.

Build: Teach each section or app on its first opening: one line on what it does, then three or four key things; the rest waits behind a More control that continues the tour. Keep the section usable while the tour shows, remember the dismissal, and give every menu option a line saying what it does. Show a first-use empty state inside the real product, with an example or a template and one primary action. Never teach everything at once.

Options:

- **Learning inside the real product**, with example content.
- **A short section tour** of three or four key things, with the rest behind a More control that continues the tour, skippable and replayable.
- **A one-time hint** on a new feature, remembered once dismissed.

Open: [states.md, Onboarding](../states.md#onboarding); [ux-laws.md, Time and memory of the flow](../ux-laws.md#time-and-memory-of-the-flow).

## Not found

Applies when: a missing page, a dead link or a removed record is reached.

Build: A page inside the shell with the navigation kept, a sentence saying what was not found, and search or links to the main sections.

Options:

- **A custom not-found page** with search and the main sections.
- **A record-level not found** inside the app shell, keeping the navigation.

Open: [site-polish.md, Build when the site calls for it](../site-polish.md#build-when-the-site-calls-for-it); [states.md, Error](../states.md#error).
