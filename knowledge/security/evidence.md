# Evidence

A protocol step is finished when it has produced an artifact. Five kinds count: a command with its output, a status code line, a version comparison, a search with its control, and a query result. A step reported as "reviewed", "checked" or "looks fine" was not run, and is recorded as not run.

## Command with its output

The command exactly as executed, the directory it ran in, and the output it produced, trimmed but never paraphrased. A command whose output is not recorded proves that the command exists, not that it passed.

Every command carries one mark: repository, when it reads files and needs no service, or running application, when it needs the application up at a known address. A running-application command also records the address and the build it hit, because the same command against a stale deployment is evidence about the stale deployment.

## Time and proportion

The time on a protocol step is a ceiling, not a budget. A step whose subject does not exist, such as payments in an application that takes none, ends at once as not applicable with the reason. A small application gets a short pass: the evidence required is the same, the volume of it is proportional to the surface.

## Commands on any shell

Commands are written once for a Unix shell and for Windows PowerShell, and both forms are given where they differ. A search expression sits in single quotes and holds no quote character, so the same line runs in both shells, Windows PowerShell 5.1 included; a quote in the searched text is matched with `.`. `git grep` is the search tool on both.

| Need | Unix shell | Windows PowerShell |
| --- | --- | --- |
| A request client | `curl` | `curl.exe`, since `curl` can be an alias of another command |
| Status code only | `curl -s -o /dev/null -w '%{http_code}' <url>` | `curl.exe -s -o NUL -w '%{http_code}' <url>` |
| Search tracked files | `git grep -n -I -E '<expression>'` | the same |
| Search ignored files, such as build output | `git grep --no-index -n -I -E '<expression>' -- dist build .next`, from the project root; a missing folder is skipped | the same |
| Search a planted control | `git -C <scratch> grep --no-index -n -I -E '<expression>'` | the same |
| List tracked environment files | `git ls-files ':(glob)**/.env*'` | the same |
| Search the history | `git log --all --oneline -G '<expression>'` | the same |

On Windows the request client is called as `curl.exe` from every shell, so the same line works wherever the pass runs.

A missing tool never blocks a pass. The step records which tool was missing and uses the fallback the protocol names; where no fallback can produce the evidence, the step ends as not verifiable.

### Searching for a secret value

The value is read from the environment inside the command, or from the secret store's read command placed where the variable stands, and only the verdict is printed, per [rules-of-engagement.md](rules-of-engagement.md#secret-values). `NAME` stands for the variable. In the Unix forms the value reaches the search on standard input or through a process substitution, never as an argument.

Build output, Unix shell:

```sh
if [ -z "$NAME" ]; then echo 'NAME: not set'; elif printf '%s\n' "$NAME" | git grep --no-index -q -F -f - -- dist build .next; then echo 'NAME: match'; else echo 'NAME: no match'; fi
```

Build output, PowerShell:

```powershell
$v = $env:NAME; if (-not $v) { 'NAME: not set' } elseif (Get-ChildItem dist, build, .next -Recurse -File -ErrorAction SilentlyContinue | Select-String -SimpleMatch -Pattern $v -List | Select-Object -First 1) { 'NAME: match' } else { 'NAME: no match' }
```

History, Unix shell:

```sh
if [ -z "$NAME" ]; then echo 'NAME: not set'; elif git log --all -p | grep -q -F -f <(printf '%s\n' "$NAME"); then echo 'NAME: match'; else echo 'NAME: no match'; fi
```

History, PowerShell:

```powershell
$v = $env:NAME; if (-not $v) { 'NAME: not set' } elseif (git log --all -p | Select-String -SimpleMatch -Pattern $v | Select-Object -First 1) { 'NAME: match' } else { 'NAME: no match' }
```

The positive control runs the same line with a variable set to a string the scope is known to hold, such as the page title in the build output or a line of the first commit, and prints match. `not set` is not verifiable, never a pass.

## Status code

The request and the response status, recorded as one line: the actor, the method, the path, the identifier used, and the code returned. Authorization evidence is a table of these, one row per role against one endpoint, because a single passing request proves one path and the failure being looked for is the path nobody tried.

A 404 counts as a denial only beside its positive control: the same request made as the owner returns 2xx, so the route exists and the 404 comes from the check. A 2xx where a denial was expected is the finding. A 500 is also a finding: the check was reached by an input it did not expect, and it belongs to [logging-and-errors](protocols/logging-and-errors.md) as well.

## Version comparison

The installed version, the fixed version from the advisory, and the advisory identifier, on one line. The installed version is read from the lockfile or from the running process, never from the manifest range. Where no lockfile exists, an exact pin is read as the version and a range as the lowest version it admits, the line is marked as read from the manifest, and the missing lockfile is a finding of its own.

The comparison is made against the vendor advisory fetched in the same pass, and the advisory URL is recorded beside the numbers. A number written in a document is worth nothing once the document is a month old.

## Search that returns no hits

The negative checks run as searches, and the finished result is zero hits. Three things are recorded with it:

- The scope: the paths searched, and whether ignored and build files were included.
- The expression, exactly as run.
- The positive control: a hit the same expression finds with the same flags, either a known line inside the scope or a planted line in a scratch folder outside the repository, searched with the planted-control command above. Each protocol step names its planted sample.

A zero without its control is recorded as not run. Hits that remain carry a file and line reference and the reason each may stand. A search narrowed until it returned nothing is a finding about the search.

## Query result

The state of the data after an action, read from the store rather than from the response body. A write that was supposed to be rejected is proved rejected by the row being unchanged, because a handler can return 403 and still have written.

## What is not evidence

- A clean dependency audit is evidence of a clean dependency audit. It does not read install scripts, and a version poisoned in the last few hours has no advisory yet.
- A refusal from a model is not evidence that an injection failed. The pass condition is that the injected instruction reached nothing privileged, proved on the tool call and the credential boundary.
- A report-only content security policy is not an enforcing policy and never counts as one; it is recorded separately.
- A header present on a 200 is not a header present on a 500, and a test that only ran against a local build is not a statement about production.

## Verdicts

Every check ends in one of the five verdicts of [files.md](../../files.md#verdicts): pass, fail, not applicable, not run and not verifiable. A security pass adds two rules:

- A fail ends its step, not the pass. The finding is reported and the protocol goes on with its next step, because the next step tests a different path; a failure the protocol's `stop` line names ends that protocol, and the pass goes on with the next protocol in the plan.
- Not run names the reason, such as no session or a fixture without a yes, and not verifiable names the tool missing and what a person must check and where.

Not run and not verifiable are reported and never count as pass. Nothing ships with an open fail, and a fail deferred instead of fixed is a risk acceptance, a decision as [rules-of-engagement.md](rules-of-engagement.md#where-the-pass-stops-and-a-person-decides) sets out.

## Ranking findings

| Rank | Meaning | When it is fixed |
| --- | --- | --- |
| P0 | Exploitable without a credential, exposes another account's data, or leaks a secret | Immediately, reported the moment it is confirmed |
| P1 | Needs a credential or a condition the attacker can reach, and crosses a boundary when it lands | Before the change ships |
| P2 | Weakens a defence without crossing a boundary on its own | In the next pass |
| P3 | Hardening with no path to impact found | When there is time |

Fixed mappings:

- A package advisory rated critical or high with a reachable path is P1 and blocks a release. It counts as reachable until the import search of [version-floor](protocols/version-floor.md) step 2, with its control, shows that no shipped code loads the package; it then ranks P2. Moderate is P2 and low is P3.
- A runtime major past its end of life is P1.

Every finding carries the location, the rank, the evidence that proves it, the impact in one line, the fix, and the evidence that would prove it fixed. A finding without a fix is an observation, and a finding whose fix cannot be verified by the same kind of artifact that found it is incomplete.
