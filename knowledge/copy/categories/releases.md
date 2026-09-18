# Release and change communication

Text that tells people what changed: changelogs, release notes, breaking change notices and commit messages. Readers scan these for the one line that concerns them. Defaults for the whole category: Plain tone, impersonal, result first, dash policy none, no emoji (see [options.md](../options.md)). Every subcategory runs [surface-copy](../protocols/surface-copy.md).

## Changelogs

Applies when: a CHANGELOG file, a version section, "write the changelog", patch notes, a list of changes between two tags.

Options: title-only entries by default, one self-describing title per line; a one-line note only where the reader must act. The fixed categories and ISO dates are not optional.

Open: [documents.md, Changelogs](../documents.md#changelogs).

## Release notes

Applies when: notes for a published release, a "what's new" dialog, an update summary sent to users.

Options: second person or impersonal, grouped by what the reader does, one line per change with a second only when action is needed. First person plural when a team signs them.

Open: [documents.md, Release notes](../documents.md#release-notes), and [claim-check](../protocols/claim-check.md) when the notes claim improvements.

## Breaking changes and deprecations

Applies when: a removed or renamed option, endpoint, command or setting, a migration guide, a deprecation warning printed at runtime.

Options: the first line says breaking or deprecated, with the version and the date; the replacement is spelled out. Never softened.

Open: [documents.md, Breaking changes and deprecations](../documents.md#breaking-changes-and-deprecations).

## Commit messages

Applies when: writing or reviewing a commit subject or body, squashing commits, "write the commit message".

Options: English, imperative, one idea per commit, subject under the length the project sets. Tool trailers follow the repository's own setting.

Open: [documents.md, Commit messages](../documents.md#commit-messages).
