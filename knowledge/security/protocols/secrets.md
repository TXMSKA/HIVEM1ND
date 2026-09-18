name: secrets
purpose: Prove no live credential reaches the repository, the client bundle or a log line.
trigger: manual, on any key, token, password, connection string, environment file or build output
repeat: once per audit, and again after any change to the environment files or the build configuration
inputs: the working tree, the full git history, the build output, the scanner of choice, the provider consoles
stop: a live credential is confirmed, in which case rotation starts before any remaining step
report: hits per scanner over the tree and over the history, the build-output search per secret value, the tracked environment files, and the rotation status of every confirmed credential

## Steps

1. Scan the working tree.
   Task: `gitleaks dir -v .` in the project. The command names changed in recent releases: `detect` and `protect` still work but are deprecated and hidden from the help output, and the current commands are `git`, `dir` and `stdin`. Check the tool's own current documentation before writing the command into a pipeline.
   Time: 10 minutes. Repository.
   Result: the hit count with the command output. Zero, or each hit with its file and line.

2. Scan the whole history, and separate live from merely present.
   Task: `gitleaks git -v --log-opts="--all" .` for every ref. Then run a verifying scanner, which calls the provider to find out whether the credential still works: `trufflehog git file://<repo-directory> --results=verified --fail`, run from the parent directory, because it clones the repository to a temporary location before scanning.
   Time: 20 minutes. Repository, plus network access for verification.
   Result: the gitleaks hit count across all refs, and the verifying scanner's exit code, 0 for no results and 183 for results found under `--fail`. Only some scanners verify, so an unverified hit stays a finding until it is shown to be a sample value.

3. Search the build output for the value, not for the name.
   Task: build the application, then search every output directory for the literal value of each server-side secret: `grep -rFl "<value>" dist build .next 2>/dev/null`. A framework that inlines variables carrying a public prefix puts them in the bundle by design, and the only check that catches a secret given that prefix by mistake is a search for what it contains.
   Time: 20 minutes. Repository, after a build.
   Result: zero hits for every server-side secret value, recorded per secret. A hit is a P0, and the secret is treated as public.

4. Check what the repository tracks.
   Task: `git ls-files | grep -E '(^|/)\.env'` and read every example or sample environment file that comes back from `git ls-files`.
   Time: 10 minutes. Repository.
   Result: zero tracked environment files holding real values, and the example file's contents showing placeholders that authenticate nothing.

5. Rotate first, then scrub, and assume the leak is permanent.
   Task: for every confirmed live credential, rotate it at the provider before rewriting anything. Rewriting history is the second action, never the fix: forks, clones, mirrors and caches survive a rewrite, so anything that reached a public repository is public from then on. **Needs a person**: the rotation order and the outage it causes are a decision, not a check.
   Time: as long as the rotation takes.
   Result: the old credential returns an authentication failure from the provider, recorded with the request and the response. The history rewrite is recorded beside it as secondary, with the name of whoever ordered the rotation.

6. Close the door behind the fix.
   Task: add the tree scan to a pre-commit hook and the history scan to continuous integration.
   Time: 20 minutes. Repository.
   Result: a commit carrying a test credential rejected by the hook, with the hook output, and a pipeline job that exits non-zero on the same commit.
