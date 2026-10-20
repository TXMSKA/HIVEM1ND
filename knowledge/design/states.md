# States

A surface is designed in every state it can reach, not only the populated one. The inventory and the captures run in [interface-states](protocols/interface-states.md).

## Empty

An empty state is a screen doing its hardest work: there is no content to carry the interface, so the interface has to explain itself. "No data available" fails on four counts at once: it does not say why there is nothing, it does not say what to do next, it gives no way to start, and it does not tell an expected empty list from an error or a missing permission.

A good one has four parts, in this order:

- **A title that names the real object.** "No projects yet", not "No data". The noun tells the reader which part of the product is empty.
- **A supporting visual**, so the screen reads as a deliberate state rather than a page that failed to render. A blank rectangle reads as a bug.
- **One or two sentences** that say why it is empty and what the first step is.
- **One primary action** that resolves it: create, import, retry, or adjust the filters.

The words and the action change with the cause, and the kinds never share one component blindly. The kinds are one list shared with the copy module, each with its cause, its action and its words: [microcopy.md, Empty states](../copy/microcopy.md#empty-states). When the copy module is not installed, the kinds are first use, cleared, no results, no permission and failed to load, each a component of its own.

When auditing, the first-use states come first, then empty search and filter results, including a filtered menu that matches nothing, then internal screens with little traffic.

## Loading

- **Immediate feedback on every activation**, within about 400 milliseconds; past that, a visible loading state.
- **Skeletons in the shape of the final layout**, occupying the same box as the content they stand in for, so nothing shifts when the data lands. A spinner in the middle of content is the weaker option.
- **A skeleton is built from the real component.** The same grid, the same classes and the same breakpoints render placeholder rows or cards: bars one line height tall per text line, the count equal to the page size or the last known count, and the same fixed heights as the real items. A responsive card grid therefore reflows its skeleton exactly as it reflows its cards.
- **Loading text and indicators never push content.** A loading message sits in a slot that already exists, or inside the control that started the work; one inserted above a list moves the list on every keystroke.
- **Every loading case is covered**: the first load, the next page, a refresh.
- **Determinate progress when the length is known**, and an honest estimate on long operations. Progress is never faked and completion is never delayed for a flourish.
- **Pace the bar so the wait ends fast.** The end of a wait weighs most in memory (peak-end), and a bar held near 99 percent ruins the whole wait. Where the mapping from work to bar is a choice, let the bar run slower early and faster at the close: the shown value may trail the real fraction but never lead it, never moves back, and reaches 100 percent exactly when the work ends.
- **Loading text names the real operation**, not a generic "Loading".
- **One slow component never blocks the whole screen.**

## Error

- **The message comes from the table of causes** in [microcopy.md, Table of causes](../copy/microcopy.md#table-of-causes), which gives each cause its place on the screen, its words and its next step. When the copy module is not installed, each cause still gets a written sentence naming what failed and how to recover, and an unknown cause a written fallback.
- **Raw text never reaches the screen.** An exception message, a stack frame, a status line, a response body, `undefined` or `[object Object]` is not shown; the request identifier from the server's answer may show as a small reference for support.
- **The failed part fails alone.** The error takes the place of the component that failed, with a retry, and the rest of the screen keeps working; a full page only when nothing on it can work, with a way out.
- **What the person entered is kept** through a network failure and a failed request.
- **Errors in a form sit at the field**, not in a toast; the rules are in [forms-and-controls.md](forms-and-controls.md#validation-and-submission).

## Success

- **Confirm the outcome**, and mention the next consequence only when it changes what the person does next.
- **Routine success is brief and certain.** Celebration is kept for real effort and first successes, and matched to how often it happens.
- **A submitted form ends in a success state**, or a page of its own after a conversion, never a silent reset.
- **Destructive actions offer an undo** when recovery is safe, or a confirmation that names the object and the consequence when it is not.

## Disabled

A disabled primary action is allowed only with a visible reason next to it; otherwise it stays enabled and validates on submit. The reason says what is missing and what unlocks it, tied by `aria-describedby`, and the unblocking action is one step away. It is a structural word, written by the design pass and flagged for the copy pass. Disabled content keeps enough contrast to be read, and never carries a saturated accent.

## Announcements

A message that appears without the person moving focus is announced from a region that is in the markup before the message arrives: success, progress and loading changes through `role="status"`, errors through `role="alert"`.

## Onboarding

- **The job is the first real success, fast.** Teach the few things that give most of the value and leave the rest to discovery in context.
- **Show rather than tell**, inside the real product rather than a separate tutorial mode, one thing at a time, with a visible skip.
- **Tours are short**: three or four steps on the first opening of a section, the rest behind a More control that continues the tour, skippable and replayable.
- **What was seen is remembered.** A dismissed tip never returns, and a returning person is never onboarded again.
