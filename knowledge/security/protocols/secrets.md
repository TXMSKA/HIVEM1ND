name: secrets
purpose: Prove no credential reaches the repository, its history, the client bundle or a log line, without the pass ever handling a secret value.
scope: keys, tokens, passwords, connection strings, environment files, public-prefixed variables, the git history and the build output
trigger: task close
repeat: once
inputs: the working tree, the full git history, the build output, the scanner of choice, the names of the server-side secrets with their values in the environment
stop: a server-side secret value is found in the build output, which is a P0, reported at once, and ends the protocol, with its rotation handed to the person
report: hits per scanner over the tree and over the history by file and line, the value search verdict per secret, the tracked environment files, and the rotation status of every credential found as the person confirmed it

Every step follows [rules-of-engagement.md](../rules-of-engagement.md#secret-values): no value is printed, pasted or passed as an argument, and no credential is tried against its provider.

## Steps

1. Scan the working tree.
   Task: `gitleaks dir -v --redact .` in the project; the current commands are `git`, `dir` and `stdin`, and the tool's own documentation is checked before a command goes into a pipeline. Without the scanner, the fallback runs on any shell with git alone and prints the matched name, never the value: `git grep -n -o -I -i -E '(api[_-]?key|secret|token|passw(or)?d|private[_-]?key|connection[_-]?string).{0,3}[:=]'` and `git grep -n -o -I -E 'BEGIN [A-Z ]*PRIVATE KEY'`, plus the same with `--no-index` over untracked files; the missing scanner is recorded. Positive control: planted lines `api_key = sample-value` and `-----BEGIN RSA PRIVATE KEY-----`, each found by its expression.
   Time: 10 minutes. Repository.
   Result: the hit count with the command output, zero or each hit with its file and line. Each hit is a finding until the person confirms it is a sample value.

2. Scan the whole history.
   Task: `gitleaks git -v --redact --log-opts="--all" .` for every ref. Without the scanner, `git log --all --oneline -G '<expression>'` with each expression of step 1 lists the commits that added or removed a match, with a line of the first commit as the positive control. Liveness is never tested: no scanner runs with verification on.
   Time: 20 minutes. Repository.
   Result: the hit count across all refs with each commit, file and line. Each hit is a finding; whether it is still live is read by the person in the provider's console and recorded with the date and the name.

3. Search the build output for each value, not for its name.
   Task: build the application, then run the build-output value search of [evidence.md](../evidence.md#searching-for-a-secret-value) once per server-side secret named in the example environment file. A framework that inlines variables carrying a public prefix puts them in the bundle by design, and only a search for what a secret contains catches one given that prefix by mistake. Then list the public-prefixed variables: `git grep -n -o -I -E '(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|PUBLIC_)[A-Z0-9_]+'`, with a planted `VITE_SAMPLE` as the positive control.
   Time: 20 minutes. Repository, after a build.
   Result: `no match` for every server-side secret, with the control line printing `match`; a `match` is a P0, and the secret is treated as public. Plus each public-prefixed variable shown to be a key designed to be public, per [configuration.md](../configuration.md#public-prefixes-are-public).

4. Check what the repository tracks and how configuration loads.
   Task: `git ls-files ':(glob)**/.env*'`, which works on any shell. Read only the example and sample files it returns; for any other, count the assigned values without printing them, `git grep -c -E '^[A-Za-z0-9_]+ *= *[^ ]' -- <file>`, with a planted `API_KEY=sample` line as the positive control. Search for a fallback beside a secret read: `git grep -n -I -E '(process\.env|import\.meta\.env)\.[A-Za-z0-9_]+ *(\|\||\?\?)'` and `git grep -n -I -E '(os\.getenv|os\.environ\.get)\([^)]*,'`, with planted `const k = process.env.API_KEY || x` and `os.getenv(KEY, x)` as the positive controls. Start the application once with one required secret unset.
   Time: 10 minutes. Repository, plus one start.
   Result: a count of zero for every tracked environment file other than the example, the example file showing placeholders, zero fallbacks beside a secret read, and the start failing with the variable's name.

5. Hand the rotation to the person, then scrub, and assume the leak is permanent.
   Task: for every credential found, the person rotates it at the provider before anything is rewritten. Rewriting history is the second action, never the fix: forks, clones, mirrors and caches survive a rewrite. Needs a person: the rotation order and the outage it causes.
   Time: as long as the rotation takes.
   Result: per credential, the provider's console showing the old credential revoked, as the person confirmed it, with the date and the name; the history rewrite recorded beside it as secondary.

6. Give each consumer its own key with the least privilege it needs.
   Task: list every credential name with the consumer that holds it: the browser, the server, continuous integration, a developer machine. Publishing tokens for a package registry or a source host are listed too, because a registry worm spreads through exactly those. The scope each one carries is read by the person in the provider's console, or from the repository where scopes are declared.
   Time: 25 minutes. Repository, plus the person's reading of the consoles.
   Result: a table of credential name, consumer, environment and scope, with no credential shared across consumers, projects or environments, and no consumer holding a scope it does not use.

7. Find the scan in the hook and the pipeline.
   Task: read the pre-commit hook and the continuous integration definitions for the tree scan and the history scan. Proving that a commit carrying a credential is refused needs a test credential, a fixture written only as [rules-of-engagement.md](../rules-of-engagement.md#test-fixtures) sets out, with a provider's documented example key.
   Time: 20 minutes. Repository.
   Result: the hook and the job quoted with file and line, and, on the fixture branch, the hook refusing the commit and the job exiting non-zero, each with its output; without the yes for the fixture, that part is not run. A missing hook or job is a finding whose fix is the scan.
