module: product
purpose: Writing down what a product is, for whom and what it must do at each stage, once and in one file, from the records the mind already holds; checking delivered work against it; and which tier of model does which kind of work.

# Product

What a product is tends to sit in four places at once: the dated lines of its brief, the scope files of the Overseer, its boards and its tasks. This module writes the one file that holds it, the product document, keeps that file true, and checks delivered work against its requirement IDs. Writing or reviewing a product document starts with [essentials.md](essentials.md). Match the work against the lines below, open the category file, and from it only the protocol steps it names. Work that matches no category is not covered here.

## Categories

- [scope](categories/scope.md): a product, feature or stage is being defined, requirements are cut into stages, something is excluded, or a request asks for behaviour no requirement holds.
- [requirements](categories/requirements.md): a product document or a family product document is written or changed, a requirement line is added or reworded, the check reports a product document missing or behind, or delivered work is accepted against requirement IDs.
- [delegation](categories/delegation.md): a piece of work is handed to a subagent or another client, a brief names a model and an effort, or a model row is added, tested or paused.

## Protocols

- [product-requirements](protocols/product-requirements.md): scope the product document of one product or one family, new or behind its brief.
- [requirement-acceptance](protocols/requirement-acceptance.md): scope a task whose `requirements` header lists IDs when it moves to review, and a stage before it is accepted.

What each step checks is in [steps.md](steps.md).

## Command

None. The protocols run through `/protocol <name>`, and `/brainstorm` stays the tool that drafts the text, as [essentials.md](essentials.md#approval) sets out.
