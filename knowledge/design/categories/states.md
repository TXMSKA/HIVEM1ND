# States

Every state a surface can reach besides the populated one: empty, loading, error, success, disabled, first use, not found. The inventory runs in [interface-states](../protocols/interface-states.md).

## Empty

Applies when: a list, a table, a search or a dashboard can have no content; a screen says "No data"; a filter can exclude everything.

Options:

- **First use**: create, or start from a template or an example.
- **Cleared by the person**: a light touch and an easy way back.
- **No results**: the query stays visible, with a way to clear or widen it.
- **No permission** and **failed to load**: explain and offer access or a retry, never an invitation to create.

Open: [interface-states](../protocols/interface-states.md), step 3; [states.md](../states.md), Empty.

## Loading

Applies when: data is fetched, a page loads slowly, a spinner sits in the middle of content, or content jumps when data lands.

Options:

- **Skeleton** in the shape of the final content: the default for content.
- **Spinner in the control** that started the work, keeping its label.
- **Determinate progress with an estimate** for long operations.
- **Optimistic update with rollback** when the result is almost always a success.

Open: [interface-states](../protocols/interface-states.md), step 4; [states.md](../states.md), Loading; [animation.md](../animation.md), Recipes.

## Error

Applies when: a request fails, a page cannot load, the network drops, a permission is missing, or a message reads "Something went wrong".

Options:

- **Inline at the field** for invalid input.
- **In place of the failed component** with a retry, leaving the rest of the screen working.
- **A full page** only when nothing on the screen can work, with a way out.

Open: [interface-states](../protocols/interface-states.md), steps 3 and 7; [states.md](../states.md), Error.

## Success

Applies when: a save, a submission, a purchase or a first achievement completes; a form resets silently.

Options:

- **A brief, certain confirmation** for routine actions.
- **A success state or a page of its own** after a submission or a conversion, saying what happens next.
- **A celebration** only for real effort or a first success.

Open: [interface-states](../protocols/interface-states.md), step 4; [states.md](../states.md), Success; [animation.md](../animation.md), Gates.

## Disabled

Applies when: a control is greyed out, a primary action is blocked until something is filled, or a request says "the button does nothing".

Options:

- **Disabled with an inline reason** and the unblocking action one step away.
- **Enabled with validation on press**, when the reasons are several or spread across the form.
- **Hidden**, only when the person can never use the control in this context.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 5; [states.md](../states.md), Disabled.

## First use and onboarding

Applies when: a new account lands on an empty product, a tour or tips are added, or a new feature is announced.

Options:

- **Learning inside the real product**, with example content.
- **A short tour** of three to seven steps built around one workflow, skippable and replayable.
- **A one-time hint** on a new feature, remembered once dismissed.

Open: [states.md](../states.md), Onboarding; [ux-laws.md](../ux-laws.md), peak-end and goal-gradient.

## Not found

Applies when: a missing page, a dead link or a removed record is reached.

Options:

- **A custom not-found page** with search and the main sections.
- **A record-level not found** inside the app shell, keeping the navigation.

Open: [site-polish.md](../site-polish.md), Build when the site calls for it; [states.md](../states.md), Error.
