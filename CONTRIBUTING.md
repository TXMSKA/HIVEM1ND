# Contributing

One pull request per change. The merge is a maintainer's decision.

## Roles

A role is one Markdown file in `roles/`, based on the template in [Executor](roles/executor.md). Its frontmatter supplies a name and a description; its Role section defines the responsibility and boundaries.

## Commands

A command is one Markdown file in `commands/`, with a name, a description and the complete workflow.

## Features

A feature is a Markdown file in `features/`, or a folder containing the command and its scripts or templates.

## Knowledge modules

A knowledge module is a folder in `knowledge/` with Markdown topics and optional `features/`. Module features use the same format as base features. Command names must be unique across the selected content. See [the module format](knowledge/README.md).

## Verification

All text is in English and follows the impersonal style, without em dashes. Installer text includes Spanish alongside English.

`npm run lint`, `npm test` and `npm run build` must pass. Changes to installation, updates or team state require isolated tests that preserve existing files and cover failure and resume. Changes to the wizard require browser verification.

