# Microcopy

Rules for the strings that sit inside a control or next to one, and for the messages an interface shows about its own state. Each section is one subcategory. A string belongs to exactly one section, and that section decides it; [surface-copy](protocols/surface-copy.md) is the pass that applies them. When a string fits two sections, the one whose rule ties it to other strings wins, because breaking that tie breaks more than one string (Convention): a card that is also a navigation destination follows Navigation, a page button that is also a call to action follows the call to action, and a first-use empty state follows Empty states with the Warm tone of onboarding.

## Buttons and controls

- A verb first, and the verb is the thing that will happen: *Save changes*, not *OK* or *Submit*.
- The label matches the heading of the thing it acts on, word for word where possible.
- Sentence case, no ending period (Microsoft style guide, https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice).
- Four words at most. A label that needs more is a label for a decision the screen has not explained yet (Convention).
- A destructive action names what it destroys: *Delete project*, never *Delete* alone.
- Result to record: count of labels not starting with a verb, and count over four words, each fixed or explained.

## Labels

- A field label names the value, in the words the person uses for it, and stays visible while the field is filled.
- The same object has the same name on every screen and every card. Two names for one metric break scanning (Convention).
- A label that reads clearly needs no sentence beneath it. Where a hint exists, try renaming the label to absorb it before keeping the hint (Practice).
- Result to record: count of objects with more than one name across the diff, which must be zero.

## Placeholders

Placeholder text is not a label. It disappears on input, strains memory, blocks checking answers before submit, is overlooked or read as a default value, and often fails contrast (Measured, https://www.nngroup.com/articles/form-design-placeholders/).

- A visible label outside the field carries the meaning. The label that replaces a placeholder is written by the design pass and its words reviewed here; with no design pass and no code in the request, the missing label is listed as an open item.
- A placeholder, when used at all, shows an example of the format, never an instruction needed later.
- Result to record: count of fields whose only label is a placeholder, which must be zero.

## Helper text

- None by default, under a field or under a heading (Practice: helper lines under clearly labelled fields were cut as noise, and the same applied to subheadings under headings).
- A constraint that matters before typing, such as a password rule, lives in an indicator that reacts as the person types. A constraint that matters after is stated by the error.
- Conflict, resolved: the placeholder study above asks for hints that stay visible. A live indicator is visible and persistent, so it satisfies that finding without a static sentence printed before anything went wrong.
- Result to record: count of static helper lines kept, each with the constraint that could not be shown live.

## Tooltips

- Supplementary only. Nothing needed to complete the task lives only in a tooltip (Convention).
- One fragment or one sentence. Never a repeat of the visible label.
- No instructions pinned to abstract places, such as a hint telling the person to click a decorative element (Practice).
- Result to record: count of tooltips carrying information found nowhere else on the screen.

## Navigation and menus

- Places are nouns, actions are verbs. A menu mixing the two is two menus. The verb rule for short labels in [bilingual.md](bilingual.md#add-the-verb-to-short-labels) covers controls that act, never places, so a navigation item stays a noun in every language.
- An item names the object it opens, in the same words as the heading of the page it opens.
- Order by frequency of use or by the order of the work, never alphabetically by accident.
- Result to record: count of items whose destination heading differs from the item text.

## Errors

Guidelines from https://www.nngroup.com/articles/error-message-guidelines/.

- Placed next to the thing that caused it. On a form, focus moves to the first failing field.
- Says precisely what happened. A generic message is a failure even when polite.
- Shape. When the reader fixes it, one instruction that carries the cause: *Enter a due date*, *Enter an amount of 1 or more*; the GOV.UK patterns are *Enter*, *Select* and *must be*, with no *please*, *sorry*, *valid*, *invalid* or *oops* (https://design-system.service.gov.uk/components/error-message/). When the system failed, an impersonal cause, then the next step, then, where true, that the input was kept: *The invoice was not saved. Try again; your entries are still here.*
- Sign-in and account lookup are the exception to precision: one message for a wrong email and a wrong password, so the message does not reveal which accounts exist (https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). *The email or password is incorrect.*
- A message key shared by call sites that need different causes is split, one key per cause (see [boundaries.md](boundaries.md#code-around-the-strings)). Until it is split, the shared string says the most specific thing true at every call site, and the split is listed as open.
- Says what to do next. Identifying the problem is half the message.
- No blame words. *Invalid* and *illegal* describe the person, not the input.
- No jokes, no raw jargon, no bare error code as the whole message.
- The input is preserved, so the person edits what they typed.
- Not shown before the field is finished, except where the field is known to be error-prone.
- Result to record: for each error string, placement, cause, next step and input preserved, each ticked or exempted in writing.

### Table of causes

Every failure maps to one row through its code or status, in the code around the strings; a cause with no row takes the fallback, never the exception text or the response body. A clause saying the input or the changes are kept is written only where it is true. The design module's [states.md](../design/states.md#error) places each message on the screen; the words are decided here (Convention for the rows; the field shape from GOV.UK and the sign-in row from OWASP, above).

| Cause | Where it shows | Words | Next step |
| --- | --- | --- | --- |
| Missing or wrong value | At the field, focus on the first | One instruction that carries the cause: *Enter a due date*, *Enter an email address like name@example.com* | The field itself |
| Value out of range or too long | At the field | The limit inside the instruction: *Enter an amount of 1 or more*, *Use 80 characters or fewer* | The field itself |
| File too large or of a refused type | On the file's row | The limit: *The file is larger than 10 MB*, *Upload a PDF or a PNG* | Replace or remove the file |
| Wrong sign-in | Above the form | One message for either credential: *The email or password is incorrect.* | Try again, or reset the password |
| Session expired | A dialog over the page, then back to the same place | *The session ended. Sign in again to continue; the changes are kept.* | Sign in |
| Missing permission | In place of the content | What is missing and who grants it: *Only workspace owners can change billing.* | Request access |
| Not found | Inside the shell, navigation kept | What was not found: *This invoice was deleted or never existed.* | Search, or the main sections |
| Conflict with another change | At the save | *Someone else changed this invoice. Review their changes before saving.* | Review and save |
| Rate limit | At the action | When to try again: *Too many attempts. Try again in 5 minutes.* | Wait, then retry |
| Offline or network failure | A banner, or in place of the failed part | *No connection. The changes are kept and sent when the connection returns.* | Retry |
| Server failure | In place of the failed part | Impersonal cause, next step, input kept: *The invoice was not saved. Try again; your entries are still here.* | Retry |
| Unknown cause | In place of the failed part | The written fallback: *The action did not complete. Try again, and if it fails again, contact support with reference {request_id}.* | Retry, then support |

## Blocked controls

- A disabled primary action is allowed only with a visible reason next to it; otherwise it stays enabled and validates on submit (Convention).
- The reason says what is missing and what unlocks it, and the unlocking action is one step away: a disabled save becomes *Complete the email to continue*, with focus on that field.
- Applies to every critical control, not only submit.
- Result to record: count of disabled controls without a reason, which must be zero.

## Warnings and confirmations

Guidelines from https://www.nngroup.com/articles/confirmation-dialog/.

- Only for serious consequences that cannot be undone. A confirmation on a routine action trains people to click through all of them.
- The title and body name the action and the object: *Delete the project Q3 plan and its 14 files?*, not *Are you sure?*.
- Buttons say what they do, *Delete project* and *Keep project*, never *Yes* and *No*, and the destructive one is not the default.
- For the most dangerous operations, a non-standard confirmation such as typing the object's name.
- Result to record: count of confirmations with generic button labels or a generic question, which must be zero.

## Success

- After any submission, a real confirmation states what happened and, when there is one, what happens next: *Message sent. A reply usually arrives within two days.* A silent reset is a failure.
- One line. No celebration beyond it (Convention).
- A surface that saves on its own shows one status line: *Saving*, then *Saved*, or *Not saved* with the cause and *Retry*; an age such as *Saved 2 minutes ago* follows the relative-time row of [options.md](options.md#numbers-dates-currency-and-quotation-marks).
- Result to record: count of submissions without a success state.

## Undo

- After a reversible action, the result with its object in the past tense and one *Undo* button: *Invoice deleted.* / *Undo*; for several items, the count: *3 invoices deleted.* (Convention).
- An action that offers an undo is never preceded by *Are you sure?*: the undo replaces the confirmation, which Warnings and confirmations above keeps for what cannot be undone.
- After the undo, the reverse result: *Invoice restored.*
- An undo promises only its window. An action that becomes final somewhere else, such as emptying the bin, takes a confirmation instead.
- Result to record: count of reversible actions guarded by a confirmation, and of undo messages without their object.

## Empty states

The kind decides the content (Carbon empty states pattern, https://v10.carbondesignsystem.com/patterns/empty-states-pattern/). This list of five kinds is the one the design module's [states.md](../design/states.md#empty) builds from (Convention):

| Kind | Cause | Action | Words |
| --- | --- | --- | --- |
| First use | Nothing created yet; the onboarding moment | Create, or start from a template or an example | *No invoices yet* / *Create the first one to start tracking payments.* / *Create invoice*, Warm tone allowed |
| Cleared | The person emptied it | A light touch and a way to add again | *No open tasks* / *New tasks show up here.* / *Add task* |
| No results | A search or a filter excluded everything | Clear or widen it, with the query still visible | *No invoices match "acme"* / *Clear filters* |
| No permission | Access is missing | Say why and how to get access, never imply the person has not started | *Only workspace owners can see billing* / *Request access* |
| Failed to load | Something broke | Say what failed and offer a retry | *Invoices did not load* / *Try again* |

- The title names the real object: *No projects yet*, not *No data*.
- One or two sentences say why it is empty and what the first step is.
- One primary action, matched to the kind: create, clear the filter, retry or request access. Not two.
- Nothing about parts of the product that are not this one.
- When the product has no control for the first step, the empty state says only why it is empty, and the missing action is reported as a gap, never invented or pointed at a control that does not exist.
- Result to record: count of empty states without a next action, and count of kinds sharing one string, both zero.

## Loading and progress

- Name what is loading: *Loading invoices*, not *Loading*.
- A long operation shows how far along it is and what remains, in steps or a count.
- Result to record: count of loading strings without an object.

## Onboarding steps

- No onboarding at all unless the product needs information to start or works unlike familiar patterns; help at the first encounter with a feature beats a tour up front (https://www.nngroup.com/articles/mobile-app-onboarding/).
- Each step states the outcome the person gets, then the action, in that order.
- One action per step. A step with two actions is two steps.
- Skippable, and saying so is part of the copy. The skip is visible on every step, with progress shown as *Step {current} of {total}* (same source).
- Shape of a step: a title that is the outcome, at most one sentence of body, one primary button that performs the action, and a secondary *Skip this step*. Plain: *Add your first client* / *Invoices need someone to send them to.* / *Add client*. Warm: *Who are you billing?* / *Add a client and your first invoice is one step away.* / *Add client*.
- No welcome paragraph that teaches nothing. The first screen either does something or is removed.
- Result to record: steps counted, actions per step counted, and the word ratio against the previous version.

## Permission requests

- Before the browser or system prompt, one title says what is asked and what the person gets, in their terms: *Allow notifications to hear when a client pays* (Convention).
- The buttons name the choice, *Allow notifications* and *Not now*, at equal weight; never *OK*, and never a refusal worded to shame.
- After a denial: what is off, what it costs and where to turn it on: *Notifications are off. Turn them on in the browser settings to hear when a client pays.*
- A request already in place that asks for consent is filler only for a rewrite (see [boundaries.md](boundaries.md#filler-only)).
- Result to record: count of requests without a reason, and of refusal buttons worded to shame.

## Alternative text

Guidelines from the W3C alt decision tree, https://www.w3.org/WAI/tutorials/images/decision-tree/.

- Says what the image shows or does here, in a fragment or one sentence: the finding of a chart, the destination of a linked image, the words inside an image of text.
- Never begins with *Image of*, *Picture of* or *Photo of*: assistive technology already says it is an image.
- A decorative image gets an empty alternative, never a description.
- A chart or a diagram gets a short alternative with its finding, and its data in the page or in a linked table.
- No file names and no keyword lists.
- Result to record: count of meaningful images without alternative text, of alternatives beginning with *image of*, and of decorative images described.
