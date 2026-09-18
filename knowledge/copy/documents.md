# Documents

Rules for documentation and for release and change communication. Each section is one subcategory.

Documentation splits into four forms that answer four different needs: tutorials, how-to guides, technical reference and explanation (Measured as a framework, https://diataxis.fr/). A page that mixes two of them fails both, so the first job on any documentation text is deciding which one it is.

## Tutorials

- A lesson with one path from nothing to a working result. No branches, no alternatives, no *you could also* (Convention).
- Every step produces something visible, and the text says what it should look like.
- Explanation is kept to the sentence the step needs; the rest links to an explanation page.
- Result to record: count of steps without a visible result, and count of branches offered.

## How-to guides

- The title names the task: *Rotate an access key*. The first line says what must already be in place.
- Numbered steps, one action each, in the order they run.
- No teaching. The reader already knows why and wants the steps.
- Result to record: count of steps with more than one action.

## Reference

Reference is austere on purpose (https://diataxis.fr/reference/).

- Describes, and does nothing else. Instruction, explanation, opinion and speculation belong in the other three forms.
- Its structure mirrors the structure of the product, so navigating one navigates the other.
- Neutral and consistent. A warmer paragraph in the middle of a reference page is a defect.
- Every entry carries the same fields in the same order as its neighbours.
- Examples are allowed and are the only place a reference page relaxes.
- Reference is filler-only for a rewrite pass (see [boundaries.md](boundaries.md)).
- Result to record: count of sentences that instruct, persuade or speculate, which must be zero, and count of entries whose field order differs from their neighbours.

## Explanation

- Prose, with the reasoning in the order it depends on itself. This is the one documentation form where paragraphs beat lists.
- Answers why and why not, including the alternatives that were rejected and the reason.
- Result to record: count of bulleted lists whose items are full sentences, each turned back into prose or justified.

## Readmes

- The first sentence says what the project is. The second says who it is for or what it replaces.
- Then how to install and how to run, as commands that work when pasted.
- No badges wall, no table of contents for a short file, no closing section thanking the reader (Convention).
- Result to record: the first two sentences, and whether each command was run as written.

## Changelogs

Written for humans, not machines (https://keepachangelog.com/en/1.1.0/).

- Fixed categories: Added, Changed, Deprecated, Removed, Fixed, Security. Nothing outside them.
- One entry per noteworthy change, from the point of view of the person using the release.
- Never a commit log dump. Merge commits and internal refactors are noise here.
- No entry that says *various improvements*, *bug fixes* or *general polish*. Each hides something the reader needed.
- Every version has a date in ISO form, latest first.
- Entry shape is an option (see [options.md](options.md)): title-only entries by default, one self-describing title per line with no description beneath (Practice: descriptive paragraphs under entries were rejected as noise); a one-line note only where the reader must act.
- Result to record: entries per category, and count of entries without a concrete subject, which must be zero.

## Release notes

- Grouped by what the reader does, not by the team that built it.
- The first line of each item names the change in the reader's words; the second, when needed, says what to do.
- Result to record: count of items written in internal names the reader never sees.

## Breaking changes and deprecations

- Stated as such, in the first line, with the version and the date it takes effect.
- Every one names what to do instead, with the replacement spelled out.
- Result to record: count of breaking changes or deprecations without a replacement, which must be zero.

## Commit messages

- English, imperative mood, one idea per commit: *Add password reset*, not *Added* or *Adds* (Convention).
- The subject says what changes; a body, when present, says why.
- Trailers crediting tools follow the repository's own setting and are never added by default (Convention).
- Result to record: count of subjects not in the imperative, and count of commits mixing unrelated changes.
