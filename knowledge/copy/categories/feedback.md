# Feedback

What the interface says about its own state: something failed, something is blocked, something is about to happen, something worked, or there is nothing to show. Defaults for the whole category: Plain tone, one sentence, result first, dash policy none, no jokes (see [options.md](../options.md)). Its protocols are in the [routing table](../INDEX.md#routing).

## Errors

Applies when: "improve this error message", a validation message, a failed request, a toast or banner reporting a failure, an error page, a string containing *invalid*, *error* or *failed*.

Options: second person when the fix is the reader's action, impersonal when the system failed. A fix the reader makes is one instruction that carries the cause; a system failure is one sentence for the cause and one for the next step. Sign-in never says which credential was wrong. The error code, when shown, follows the sentence and never replaces it.

Build: a field the reader fixes gets one instruction that carries the cause: *Enter a due date*, *Enter an email address like name@example.com*. A system failure gets the cause, the next step and, where true, that the input was kept: *The invoice was not saved. Try again; your entries are still here.* Sign-in gets one message for either credential: *The email or password is incorrect.*

Open: [microcopy.md, Errors](../microcopy.md#errors).

## Blocked controls

Applies when: a control is disabled, greyed out or hidden until a condition is met, or "why can't the form be submitted".

Options: one sentence naming what is missing and what unlocks it, as an instruction.

Build: *{What is missing} to {what it unlocks}*, placed at the control: *Add a client email to send this invoice*.

Open: [microcopy.md, Blocked controls](../microcopy.md#blocked-controls).

## Warnings and confirmations

Applies when: a confirmation dialog, "are you sure", a delete, reset, overwrite, publish or payment that cannot be undone, a warning banner before a risky action.

Options: a title naming the action and the object, one sentence of consequence, two buttons that say what they do. Safety wording already in place is filler only (see [boundaries.md](../boundaries.md)).

Build: title as a question naming action and object: *Delete invoice 2041?*; one sentence of consequence: *It cannot be restored.*; buttons *Delete invoice* and *Keep invoice*, the safe one the default.

Open: [microcopy.md, Warnings and confirmations](../microcopy.md#warnings-and-confirmations), and [rewrite-boundary](../protocols/rewrite-boundary.md) when the text carries safety or consent language.

## Success

Applies when: a form submits, a save completes, a payment goes through, a toast reports that something worked.

Options: one line, what happened and what happens next. No exclamation beyond one, no celebration.

Build: *{Object} {past participle}.* then what happens next when something does: *Invoice sent. The client gets a reminder if it is unpaid on the due date.*

Open: [microcopy.md, Success](../microcopy.md#success).

## Empty states

Applies when: "No data available", an empty list, table, inbox or search result, a screen with nothing to show, a permission screen.

Options: a title naming the object, one or two sentences, one action. Warm tone is allowed for the first-use kind and never for the error kind.

Build: title *No {objects} yet* for first use, *No {objects} match {query}* for no results, the cause for an error; one sentence of why and the first step; one action: *Create invoice*, *Clear filters*, *Try again*.

Open: [microcopy.md, Empty states](../microcopy.md#empty-states). The first-use kind also belongs to [onboarding.md](onboarding.md).

## Loading and progress

Applies when: a spinner, skeleton or progress bar gets a label, a long operation reports its progress, "Loading..." appears in a diff.

Options: a fragment naming the object; steps or a count for long work.

Build: *Loading {objects}*; for long work *{Step} {current} of {total}* or a count: *Importing 40 of 120 invoices*.

Open: [microcopy.md, Loading and progress](../microcopy.md#loading-and-progress).
