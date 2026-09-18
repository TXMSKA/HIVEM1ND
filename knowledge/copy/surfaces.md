# Surfaces

One checklist per surface. A string belongs to exactly one surface, and the checklist of that surface decides it. The rules shared by all seven are at the end.

## Product page

The page that has to say what the thing is before it says anything else.

- The first sentence names what the product is and who it is for, in plain nouns. Nothing before it.
- Every claim carries a number, a name or a date. A claim that cannot carry one is cut, not softened.
- Feature headings start with a verb and describe the outcome, not the mechanism.
- No word from the promotional part of the flag list in [tells.md](tells.md) survives the deletion test here, because on this surface those words are exactly the ones doing no work.
- Result to record: word ratio against the previous version, and the count of claims with a referent against claims without.

## Empty state

Three kinds, and the kind decides the content (Carbon empty states pattern, https://v10.carbondesignsystem.com/patterns/empty-states-pattern/):

1. No data yet, on first use.
2. A result of what the person just did, such as a search with no matches.
3. Data exists but cannot be shown, which is an error state wearing an empty state.

- Say what will appear here once there is something, in concrete terms.
- One primary action, as a button or a direct link in the message. Not two.
- No dead ends: when a useful next step exists, it is in the message.
- No product jargon, and nothing about parts of the app that are not this one.
- Result to record: count of empty states without a next action, which must be zero.

## Error

Guidelines from https://www.nngroup.com/articles/error-message-guidelines/.

- Placed next to the thing that caused it, not in a corner far from the field.
- Says precisely what happened. A generic message is a failure even when it is polite.
- Says what to do next. Identifying the problem is half the message.
- No blame words. *Invalid* and *illegal* describe the person, not the input.
- No jokes. An error repeats, and a joke that repeats is worse each time.
- No raw jargon or bare error codes as the whole message.
- The input is preserved. The person edits what they typed instead of starting over.
- Not shown before the field has been finished, except where the field is known to be error-prone.
- Result to record: for each error string, the four marks placement, cause, next step, input preserved, each ticked or exempted in writing.

## Button and control

- A verb first, and the verb is the thing that will happen. *Save changes*, not *OK*, not *Submit*.
- The label matches the heading of the thing it acts on, word for word where possible.
- Sentence case, no ending period (Microsoft style guide, https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice).
- Under four words. A label that needs more words is a label for a decision the screen has not explained yet.
- A destructive action names what is destroyed: *Delete project*, never *Delete*.
- Result to record: count of labels not starting with a verb, and count over four words. Both explained or fixed.

## Onboarding

- Each step states the outcome the person gets, then the action, in that order.
- One action per step. A step with two actions is two steps.
- Skippable, and saying so is part of the copy.
- No welcome paragraph that teaches nothing. The first screen either does something or is removed.
- Second person is used sparingly and never twice in one sentence.
- Result to record: steps counted, actions per step counted, and the word ratio against the previous version.

## Changelog

Written for humans, not machines (https://keepachangelog.com/en/1.1.0/).

- Fixed categories: Added, Changed, Deprecated, Removed, Fixed, Security. Nothing outside them.
- One entry per noteworthy change, from the point of view of the person using the release.
- Never a commit log dump. Merge commits and internal refactors are noise here.
- No entry that says *various improvements*, *bug fixes* or *general polish*. Each of those hides something the reader needed.
- Every version has a date in ISO form, latest first.
- Breaking changes and deprecations are stated as such, with what to do instead.
- Result to record: entries per category, and the count of entries without a concrete subject, which must be zero.

## Documentation and reference

Reference is austere on purpose (https://diataxis.fr/reference/).

- Describes, and does nothing else. Instruction, explanation, opinion and speculation belong in tutorials, how-to guides and explanation, not here.
- Its structure mirrors the structure of the product, so that navigating one navigates the other.
- Neutral and consistent. A warmer paragraph in the middle of a reference page is a defect, not a kindness.
- Every entry carries the same fields in the same order as its neighbours.
- Examples are allowed and are the only place a reference page relaxes, because an example is still a description.
- Result to record: count of sentences that instruct, persuade or speculate, which must be zero, and the count of entries whose field order differs from their neighbours.

## Rules shared by every surface

- Lead with what matters. The first words are the ones a person scanning will read.
- Start statements with a verb, cut *you can* where it is not needed, and avoid *there is*, *there are* and *there were* (https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice).
- Sentence case for headings and labels, no ending period on a heading.
- Say it aloud. A string that cannot be said in one breath is rewritten.
- Whether contractions are used is a Convention, decided once in the voice specification, and then applied everywhere without exception.
