---
name: humanize
description: Rewrites text by category so that it reads as written by someone who knows the subject, and shows the signals before and after.
category: quality
---

# /humanize

Mind: {{mind}}
Argument: [target]

## Start

With no active role, or with no mind installed, this paragraph is skipped and the command goes on with the target. When a role is active, locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

The command writes no state of the mind, only the target. When the mind cannot be located, it goes on with the target the request names instead of asking which unit to act as.

## Steps

1. Resolve the target. With no argument, the target is the text in front of the command: the file, component or string set the session was working on, or the text just produced. With an argument, the target is that file, component or string set. Name the resolved target back in one line before changing anything, and ask when it is ambiguous; in a run with nobody to ask, state the reading taken and go on. A target of more than a few strings, or one that spans pages, code and documents, reads [essentials.md](../essentials.md) first and builds its corpus as in [measures.md](../measures.md#the-corpus).
2. Run [rewrite-boundary](../protocols/rewrite-boundary.md). Text whose job is to be unambiguous under adversarial reading, legal, contractual, consent, safety and technical reference, is filler only; quoted text, identifiers and verbatim strings are untouchable. A quote already in the target is never deleted, whatever claim-check later finds about it. When the whole target is untouchable, say so and stop. When it is all filler only, run the filler pass alone and go to step 6.
3. Resolve the categories. Read [INDEX.md](../INDEX.md), take the protocols from its routing table, then read only the matching category files and, in each, only the subcategories whose Applies when lines match. Name the categories and subcategories in one line. Pick the protocol steps from [steps.md](../steps.md), which says what each one checks, and open only the protocols with a step that will actually run. On a whole product, the Defaults in [essentials.md](../essentials.md#defaults) and the `Build:` line of each matched subcategory stand in for the topic sections; a topic section is opened only for a string that fails them, and [tells.md](../tells.md) is read for its Combined pattern and Running the searches, plus the class a hit belongs to.
4. Take the baseline: the four signals in [measures.md](../measures.md#the-four-signals), tell density, dash density, sentence length standard deviation on prose, and word count, with filler-only text counted apart.
5. Rewrite. Take the option values from the project's voice file when one exists, otherwise from the category defaults and [essentials.md](../essentials.md#defaults), listing the values used; the pass creates a voice file only when the request asks for a voice, as [boundaries.md](../boundaries.md#the-voice-file) says, and otherwise lists a missing one as an open item. Run [tell-removal](../protocols/tell-removal.md) on the open sections, and every other protocol the routing table names for the matched categories, such as [surface-copy](../protocols/surface-copy.md), [claim-check](../protocols/claim-check.md) or [bilingual-copy](../protocols/bilingual-copy.md). The code that decides which words appear is part of the rewrite, as [boundaries.md](../boundaries.md#code-around-the-strings) lists; new elements, new files and changes of behaviour are open items unless the request includes code. A rule that needs a fact the target does not hold leaves the text as it is and lists the fact for the owner, and new text needing one gets the missing-fact marker.
6. Report. Run [copy-verification](../protocols/copy-verification.md) and give one table of the four signals before and after, with the word ratio derived from the two word counts, then the changed strings, then every flagged word kept with the reason that kept it, then the open items, the quotes and facts listed for the owner, and every check recorded as not verifiable. Report the counts as a writing-quality result, never as a claim about who wrote the original.

A small target takes the short path: a step with nothing to act on is named as not applicable in one line, and every protocol Time is a ceiling.

## Composition

The command runs after other work in the same request, as in a request to build a modal and humanize its text. In that case the target is what the preceding work produced and nothing else: files the request did not touch are out of scope even when they fail the same checks. Run the preceding work first, then this command on its output.
