module: product
purpose: Writing down what a product is, for whom and what it must do at each stage, once and in one file, from the records the mind already holds.

# Product

What a product is tends to sit in four places at once: the dated lines of its brief, the scope files of the Manager, its boards and its tasks. This module writes the one file that holds it, the PRD, in the format of [files.md](../../files.md#prd-projectsprojectprdmd), and keeps that file true. Match the work against the line below, open the category file, and from it only the protocol steps it names. Work that matches no category is not product work.

## Categories

- [requirements](categories/requirements.md): the PRD of a product or a family, its requirements per stage with acceptance criteria, its out-of-scope list, and keeping it current.

## Routing

Which protocol steps and topic sections the category sends work to. A category file is still opened for its `Build:` recipes and options.

| Category | Protocols and steps | Topic sections |
| --- | --- | --- |
| requirements | product-requirements 1 to 7 | [files.md](../../files.md#prd-projectsprojectprdmd): the sections, One home per fact, Depends on |

## Protocols

- [product-requirements](protocols/product-requirements.md): scope the PRD of one product or one family, new or behind its brief. Gathers the sources, writes the requirements per stage with criteria a reviewer can observe, and checks them against the brief, the boards and the voice.

A Time value is a ceiling, a step that does not apply ends as not applicable with its reason, and a source that does not exist is recorded as missing instead of being filled in.

## Command

None. The protocol runs through `/protocol product-requirements`, and `/brainstorm` stays the tool that drafts the text: a piece is drafted after a yes on its substance, shown, and written into the PRD after a yes on the text.
