# Agent-facing text

Text whose reader is an agent, or that an agent writes on someone else's behalf. The failure here is not tone but ambiguity and noise: an instruction read two ways is followed one of them. Defaults for the whole category: English, Plain tone, impersonal, imperative for instructions, one rule per line, dash policy none, no emoji (see [options.md](../options.md)). Its protocols are in the [routing table](../INDEX.md#routing).

## Prompts and briefs

Applies when: a prompt or brief for another agent or a subagent, a task file, a handoff message, "write the prompt for".

Build: first line the task; then owned paths, forbidden paths and the done condition as a checkable result; then the context the receiver needs and nothing another agent is doing.

Options: impersonal and imperative, plain text.

Open: [agent-text.md, Prompts and briefs](../agent-text.md#prompts-and-briefs).

## Rules and instruction files

Applies when: a rules file for an agent, a skill or command definition, a role description, a style guide an agent will follow.

Build: one imperative rule per line with its reason on the same line: *Commit only when asked. A commit is hard to take back.*

Options: impersonal and imperative, one rule per line.

Open: [agent-text.md, Rules and instruction files](../agent-text.md#rules-and-instruction-files) and [tell-removal](../protocols/tell-removal.md).

## Knowledge topics

Applies when: a knowledge file, a reference note for agents, a protocol, a module index.

Build: a heading per rule set; each rule with its source or its mark; protocol steps that end in a checkable result; no narration of how the topic was written.

Options: impersonal, claim level no claims, prose or one rule per line.

Open: [agent-text.md, Knowledge topics](../agent-text.md#knowledge-topics) and [measures.md](../measures.md).

## Documents another person authors

Applies when: filling in a design document, a brief, a specification or a plan whose content belongs to someone else, "put my notes into the document".

Build: the author's words and labels in the author's order; open questions written as questions; proposed sections marked as proposed.

Options: the author's own voice, untouched; a rewrite pass only when the author asks for one.

Open: [agent-text.md, Documents another person authors](../agent-text.md#documents-another-person-authors) and [boundaries.md](../boundaries.md).
