# States

A surface is designed in every state it can reach, not only the populated one. The inventory and the captures run in [interface-states](protocols/interface-states.md).

## Empty

An empty state is a screen doing its hardest work: there is no content to carry the interface, so the interface has to explain itself. "No data available" fails on four counts at once: it does not say why there is nothing, it does not say what to do next, it gives no way to start, and it does not tell an expected empty list from an error or a missing permission.

A good one has four parts, in this order:

- **A title that names the real object.** "No projects yet", not "No data". The noun tells the reader which part of the product is empty.
- **A supporting visual**, so the screen reads as a deliberate state rather than a page that failed to render. A blank rectangle reads as a bug.
- **One or two sentences** that say why it is empty and what the first step is.
- **One primary action** that resolves it: create, import, retry, or adjust the filters.

The copy and the action change with the cause, and the kinds never share one component blindly:

| Kind | Cause | Action |
| --- | --- | --- |
| First use | Nothing created yet | Create, or start from a template or an example. This is onboarding and carries the most weight |
| Cleared | The person emptied it | A light touch and an easy way to create again |
| No results | A search or a filter excluded everything | Clear or widen the filter, with the query still visible |
| No permission | Access is missing | Say why and how to get access, never imply the person has not started |
| Failed to load | Something broke | Say what failed and offer a retry |

When auditing, the first-use states come first, then empty search and filter results, including a filtered menu that matches nothing, then internal screens with little traffic.

## Loading

- **Immediate feedback on every activation**, within about 400 milliseconds; past that, a visible loading state.
- **Skeletons in the shape of the final layout**, occupying the same box as the content they stand in for, so nothing shifts when the data lands. A spinner in the middle of content is the weaker option.
- **A skeleton is built from the real component.** The same grid, the same classes and the same breakpoints render placeholder rows or cards: bars one line height tall per text line, the count equal to the page size or the last known count, and the same fixed heights as the real items. A responsive card grid therefore reflows its skeleton exactly as it reflows its cards.
- **Loading text and indicators never push content.** A loading message sits in a slot that already exists, or inside the control that started the work; one inserted above a list moves the list on every keystroke.
- **Every loading case is covered**: the first load, the next page, a refresh.
- **Determinate progress when the length is known**, and an honest estimate on long operations. Progress is never faked and completion is never delayed for a flourish.
- **Loading text names the real operation**, not a generic "Loading".
- **One slow component never blocks the whole screen.**

## Error

- **What failed, why when it is known, and how to recover**, in the interface's own voice, never vague and never blaming the person. Internal codes do not lead.
- **Each cause gets its own treatment**: invalid input shows at the field, an expired session returns to sign-in and back, a missing permission explains itself, a missing page offers a way out, a rate limit says when to try again, a server failure gives a plain message and a retry.
- **Network failures** explain, offer a retry, and keep what the person entered.
- **Errors in a form sit at the field**, not in a toast; the rules are in [forms-and-controls.md](forms-and-controls.md).

## Success

- **Confirm the outcome**, and mention the next consequence only when it changes what the person does next.
- **Routine success is brief and certain.** Celebration is kept for real effort and first successes, and matched to how often it happens.
- **A submitted form ends in a success state**, or a page of its own after a conversion, never a silent reset.
- **Destructive actions offer an undo** when recovery is safe, or a confirmation that names the object and the consequence when it is not.

## Disabled

A disabled control says inline what is missing and what unlocks it, and the unblocking action is one step away. The reason is a structural word, written by the design pass and flagged for the copy pass. A disabled primary action is valid when that reason is present. Disabled content keeps enough contrast to be read, and never carries a saturated accent.

## Announcements

Every state that appears without the person moving focus, such as a loading change, a success or an error, is announced through a polite live region.

## Onboarding

- **The job is the first real success, fast.** Teach the few things that give most of the value and leave the rest to discovery in context.
- **Show rather than tell**, inside the real product rather than a separate tutorial mode, one thing at a time, with a visible skip.
- **Tours are short**, three to seven steps, built around a workflow, skippable and replayable.
- **What was seen is remembered.** A dismissed tip never returns, and a returning person is never onboarded again.
