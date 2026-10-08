module: product
purpose: Writing down what a product is, for whom and what it must do at each stage, once and in one file, from the records the mind already holds, and which tier of model does which kind of work.

# Product

What a product is tends to sit in four places at once: the dated lines of its brief, the scope files of the Manager, its boards and its tasks. This module writes the one file that holds it, the product document, in the format of [files.md](../../files.md#product-projectsprojectproductmd), and keeps that file true. It also holds the rules for delegating the work that builds the product. Match the work against the lines below, open the category file, and from it only the protocol steps it names. Work that matches no category is not covered here.

## Categories

- [requirements](categories/requirements.md): the product document of a product or a family, its requirements per stage with acceptance criteria, its out-of-scope list, its annexes, and keeping it current.
- [delegation](categories/delegation.md): the tier of model and the effort of each kind of work, how the mind's model table turns a tier into a row, and how a delegated piece is briefed and verified.

## Routing

Which protocol steps and topic sections the category sends work to. A category file is still opened for its `Build:` recipes and options.

| Category | Protocols and steps | Topic sections |
| --- | --- | --- |
| requirements | product-requirements 1 to 7 | [files.md](../../files.md#product-projectsprojectproductmd): the sections, One home per fact, Depends on |
| delegation | none | [files.md](../../files.md#models-modelsmd): the table, its rules and the fallback order |

## Protocols

- [product-requirements](protocols/product-requirements.md): scope the product document of one product or one family, new or behind its brief. Gathers the sources, writes the requirements per stage with criteria a reviewer can observe, and checks them against the brief, the boards and the voice.

A Time value is a ceiling, a step that does not apply ends as not applicable with its reason, and a source that does not exist is recorded as missing instead of being filled in.

## Command

None. The protocol runs through `/protocol product-requirements`, and `/brainstorm` stays the tool that drafts the text: a piece is drafted after a yes on its substance, shown, and written into the product document after a yes on the text.
