# Documentation

Text people read to learn, to do a task, to look something up or to understand. The four needs take four forms, and mixing them is the most common documentation defect (https://diataxis.fr/). Defaults for the whole category: Plain tone, impersonal, dash policy none, no emoji (see [options.md](../options.md)). Its protocols are in the [routing table](../INDEX.md#routing).

## Tutorials

Applies when: "getting started", a first project walkthrough, a lesson, a quickstart that teaches.

Build: a title equal to the outcome; numbered steps from nothing to a working result, each one action and a sentence saying what appears; data entry merged into the step that shows its result; no branches.

Options: second person or imperative, short blocks.

Open: [documents.md, Tutorials](../documents.md#tutorials).

## How-to guides

Applies when: a page titled with a task, "how do I", a recipe, a runbook step list.

Build: title *{Verb} {object}*; first line the prerequisites; numbered steps, one action each, in the order they run.

Options: imperative, numbered steps.

Open: [documents.md, How-to guides](../documents.md#how-to-guides).

## Reference

Applies when: API, CLI, configuration or file format documentation, a parameter table, docstrings, an options list.

Build: one entry per item in the order of the product, every entry with the same fields in the same order: name, type, default, one sentence of what it does, an example.

Options: impersonal, fragment or one sentence per field; filler only for a rewrite pass.

Open: [documents.md, Reference](../documents.md#reference) and [rewrite-boundary](../protocols/rewrite-boundary.md).

## Explanation

Applies when: an architecture overview, a design rationale, a "why" page, a concepts section.

Build: prose in the order the reasoning depends on itself; the alternatives that were rejected, each with its reason.

Options: impersonal, prose line shape.

Open: [documents.md, Explanation](../documents.md#explanation) and [tells.md](../tells.md).

## Readmes

Applies when: a README, a package description, the first page of a repository or a module.

Build: sentence one what the project is, sentence two who it is for; then install and run as commands that work when pasted, or the missing-fact marker; then configuration and any demo accounts under their own headings.

Options: impersonal; headings kept for install, run, configuration and demo accounts whatever their length.

Open: [documents.md, Readmes](../documents.md#readmes).
