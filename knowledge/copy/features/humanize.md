---
name: humanize
description: Rewrites text by category so that it reads as written by someone who knows the subject, and shows the signals before and after.
category: quality
---

# /humanize

Mind: {{mind}}
Argument: [target]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Resolve the target. With no argument, the target is the text in front of the command: the file, component or string set the session was working on, or the text just produced. With an argument, the target is that file, component or string set. Name the resolved target back in one line before changing anything, and ask when it is ambiguous.
2. Run [rewrite-boundary](../protocols/rewrite-boundary.md). Text whose job is to be unambiguous under adversarial reading, legal, contractual, consent, safety and technical reference, is filler only; quoted text, identifiers and verbatim strings are untouchable. When the whole target is untouchable, say so and stop. When it is all filler only, run the filler pass alone and go to step 6.
3. Resolve the categories. Read [INDEX.md](../INDEX.md), match the target against its category lines, then read only the matching category files and, in each, only the subcategories whose Applies when lines match. Name the categories and subcategories in one line.
4. Take the baseline: the four signals in [measures.md](../measures.md), tell density, dash density, sentence length standard deviation and word count.
5. Rewrite. Take the option values from the project's voice specification when one exists, otherwise from the category defaults. Run [tell-removal](../protocols/tell-removal.md) on the open sections, and every other protocol the matched subcategories name, such as [surface-copy](../protocols/surface-copy.md), [claim-check](../protocols/claim-check.md) or [bilingual-copy](../protocols/bilingual-copy.md). Protocols no matched subcategory names are not run.
6. Report. One table of the four signals before and after, with the word ratio, then the changed strings, then every flagged word kept with the reason that kept it. Report the counts as a writing-quality result, never as a claim about who wrote the original.

## Composition

The command runs after other work in the same request, as in a request to build a modal and humanize its text. In that case the target is what the preceding work produced and nothing else: files the request did not touch are out of scope even when they fail the same checks. Run the preceding work first, then this command on its output.
