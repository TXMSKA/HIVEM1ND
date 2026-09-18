---
name: humanize
description: Rewrites text that reads as machine-written so that it reads as written by someone who knows the subject.
category: quality
---

# /humanize

Mind: {{mind}}
Argument: [target]

## Start

Locate the mind through the Mind line above. Read `machines/<host>.md` in its `user/` folder, where `<host>` is the hostname of this machine, and take the paths from its `Paths` section. Resolve the current project from the working directory against those paths, and the unit as the role of the current chat plus that project; executive roles use the role name alone. When no role is active, say so and ask which unit to act as, in one line. The layout of the mind and the format of every file are in `files.md`, next to `rules.md`: the steps name the files and do not repeat the formats.

## Steps

1. Resolve the target. With no argument, the target is the text in front of the command: the file, component or string set the session was working on, or the text just produced. With an argument, the target is that file, component or string set. Name the resolved target back in one line before changing anything, and ask when it is ambiguous.
2. Classify the target before rewriting. Legal and contractual text, defined terms, safety and consent language, technical reference, and anything quoted must stay unambiguous under adversarial reading. On those, remove filler only: no term, clause, obligation, number or quoted word changes. When the whole target is of that kind, say so, run the filler pass alone, and stop there.
3. Run [tell-removal](../protocols/tell-removal.md) on the rest of the target.
4. Run [surface-copy](../protocols/surface-copy.md) as well when the target is interface text, so that each string is judged by its own surface.
5. Run [copy-verification](../protocols/copy-verification.md) and report the figures it produces, before and after.
6. Report the changed strings, the figures, and every flagged word kept with the reason that kept it. Report the counts as a writing-quality result, never as a claim about who wrote the original.

## Composition

The command runs after other work in the same request, as in a request to build a component and humanize its copy. In that case the target is what the preceding work produced and nothing else: files the request did not touch are out of scope even when they fail the same checks. Run the preceding work first, then this command on its output.
