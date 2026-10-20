# Contributing

One pull request per change. The merge is a maintainer's decision.

## Roles

A role is one Markdown file in `roles/`, and it installs as the command of its frontmatter `name`. The name is lowercase words joined by hyphens and must not collide with any role, command or feature of the kit, of an included knowledge module or of a mind: two kit files with one name stop the install, and a name a mind reuses is skipped with a warning. The QA preset is named `qa-agent` because `/qa` is a feature.

A session receives [rules.md](rules.md), its role file and its state file together, and the three must fit 24,000 characters as JSON. A role file stays well under that, and holds only what is its own: the start, work and exit every role shares live in `rules.md` and are pointed to, never copied. A folder inside `roles/` is never installed, so a file a role reads only sometimes, such as the setup steps of Genesis in `roles/genesis/setup.md`, goes there.

`{{mind}}` is replaced by the path of the mind when a role or a command is installed, so it appears only where that path belongs, such as the `Mind:` line.

Every role follows this skeleton, with each section present:

```markdown
---
name: <command name>
description: <one sentence>
---

# <Role>

Mind: {{mind}}
Unit: <unit name, and what happens when that unit is already in>
Argument: <what the command takes>

Start, work and exit follow `rules.md` of the mind, read first when the session did not receive it; this file adds only what is specific to the role.

## Mission

<what the role is for, in two or three sentences>

## Limits and permissions

- <what it never does, and what needs a yes beyond the Authority of rules.md>

## Reads

- <each file it reads, and when>

## Start

The Start of rules.md<, then what is its own>.

## Procedures

- <one instruction per bullet: the condition, the action, the result, and what to do when it fails>

## Exit

The Exit of rules.md<, then what is its own>.
```

## Commands

A command is one Markdown file in `commands/`, with a name, a description and the complete workflow as numbered steps. Each step is one instruction with its condition, its action and its result, and the workflow says when it stops and what it reports. A command that needs the unit opens with the Locate line of the existing commands instead of its own.

## Features

A feature is a Markdown file in `features/`, or a folder containing the command and its scripts or templates.

## Knowledge modules

A knowledge module is a folder in `knowledge/` with Markdown topics, an `INDEX.md` listing its protocols with their scope, an optional `protocols/` folder and an optional `features/`. Module features use the same format as base features. Command names must be unique across the selected content. A protocol step states a result that can be checked by reading a file, an output or a measurement. See [the module format](knowledge/README.md).

## Verification

All text is in English and follows the impersonal style, without em dashes. Installer text includes Spanish alongside English.

`npm run lint`, `npm test` and `npm run build` must pass. Changes to installation, updates or team state require isolated tests that preserve existing files and cover failure and resume. Changes to the wizard require browser verification.
