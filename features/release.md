---
name: release
description: Prepares a local release from commits since the last tag and reports the commands needed to publish it.
category: continuity
---

# /release

Mind: {{mind}}
Argument: none

Start: Locate in `rules.md` of the mind above; no unit is needed, so its step that asks for one is skipped.

## Steps

1. Check the branch. With main or the default branch checked out, or with uncommitted changes, stop and say so: a release is prepared on a release or task branch with a clean tree.
2. Read the commits since the last tag on the current branch: `git describe --tags --abbrev=0`, then `git log <tag>..HEAD`; with no tag, every commit.
3. Read the current version from the repository's own version file: the `version` of `package.json`, or the file the repository already bumps, such as `pyproject.toml`, `Cargo.toml` or `VERSION`. The brief's `version` is a planning number, never the release version. Propose the next version from the commits: a fix adds a patch, a feature a minor, a breaking change a major.
4. Run the build and the tests: the brief's `build` and the repository's test script. A fail stops here.
5. Write the changelog entry from the commits into the repository's changelog, `CHANGELOG.md` at its root when it has none, and bump the version in the version file.
6. Show the diff and the proposed tag, in the form the existing tags use (`v<version>` when there are none), and ask for one yes to commit those two files and tag that commit locally. Without the yes, the files stay changed and uncommitted.
7. Never push.

## End

- Stops after the tag, at a failed check, or without the yes.
- Reports the version, the tag, the build and the tests as pass or fail, and the commands the person runs to publish, `git push origin <branch>` and `git push origin <tag>`, never run here.
