# Release and change communication

Text that tells people what changed: changelogs, release notes, breaking change notices and commit messages. Readers scan these for the one line that concerns them. Defaults for the whole category: Plain tone, impersonal, result first, dash policy none, no emoji (see [options.md](../options.md)). Its protocols are in the [routing table](../INDEX.md#routing).

## Changelogs

Applies when: a CHANGELOG file, a version section, "write the changelog", patch notes, a list of changes between two tags.

Build: `## [version] - YYYY-MM-DD`, then only the Keep a Changelog categories that have entries, one self-describing title per line: *Added* / *Send payment reminders by email*. Unknown dates are the missing-fact marker.

Options: title-only entries by default; a one-line note only where the reader must act.

Open: [documents.md, Changelogs](../documents.md#changelogs).

## Release notes

Applies when: notes for a published release, a "what's new" dialog, an update summary sent to users.

Build: group by what the reader does; per item, the change in the reader's words, then a second line only when the reader must act: *Reminders now go out at 9:00 AM in the client's time zone.*

Options: second person or impersonal; first person plural when a team signs them.

Open: [documents.md, Release notes](../documents.md#release-notes), and [claim-check](../protocols/claim-check.md) when the notes claim improvements.

## Breaking changes and deprecations

Applies when: a removed or renamed option, endpoint, command or setting, a migration guide, a deprecation warning printed at runtime.

Build: *Breaking in {version} ({date}): {what} is removed. Use {replacement} instead*, followed by the exact replacement command, option or code.

Options: impersonal, never softened.

Open: [documents.md, Breaking changes and deprecations](../documents.md#breaking-changes-and-deprecations).

## Commit messages

Applies when: writing or reviewing a commit subject or body, squashing commits, "write the commit message".

Build: *{Imperative verb} {what changes}* under the project's subject length, one idea; a body only for why.

Options: English, imperative; tool trailers as the repository's own setting decides.

Open: [documents.md, Commit messages](../documents.md#commit-messages).
