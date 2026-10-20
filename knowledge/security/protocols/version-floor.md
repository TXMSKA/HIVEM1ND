name: version-floor
purpose: Fail anything running past its support date or below a published fix version.
scope: the runtime version, the framework and view library versions, the lockfile, and any runtime or framework upgrade
trigger: task close
repeat: once
inputs: the lockfile, or the manifest when no lockfile exists, the runtime version, the vendor advisory pages, the runtime support calendar
stop: none; a runtime past its end of life is reported at once and the steps go on, since the advisories of step 3 still rank the rest
report: the runtime version against its calendar status, one line per framework with installed version, fixed version, advisory identifier and advisory URL, the audit counts per severity with the package that pulls in each transitive entry, and the rank of each

## Steps

1. Read the runtime against its own calendar.
   Task: `node -v` in the project, and the deployed version from the running service rather than the development machine. Fetch the runtime's published support calendar in this pass, https://nodejs.org/en/about/previous-releases for this runtime, and read the status of that major. Other runtimes publish their own calendar and it is fetched the same way.
   Time: 10 minutes. Repository, plus one running-application read.
   Result: the major version and its status, one of Current, Active LTS or Maintenance LTS, with the calendar URL. A major listed as ended is a P1 per [evidence.md](../evidence.md#ranking-findings), reported at once. When the calendar cannot be fetched, the comparison is not verifiable, with the calendar URL a person must read; a status quoted from [standards.md](../standards.md) is never counted as the result.

2. Read what is installed, not what is declared.
   Task: `npm ls --all --depth=0` for the direct dependencies, then read the exact resolved versions of the framework, the view library and every runtime dependency from the lockfile. With no lockfile, or with no installed tree and no permission to install, read the manifest as [evidence.md](../evidence.md#version-comparison) sets out. For each declared package, search the source for its import: `git grep -c -I -E '(from|require\(|import\() *.<package>' -- ':(exclude)package.json' ':(exclude)*lock*'`, with a package known to be imported as the positive control.
   Time: 10 minutes. Repository.
   Result: a table of package and resolved version, taken from the lockfile, with the lockfile version format recorded, and the import count of each package. Without a lockfile, the table is marked as read from the manifest, and the missing lockfile is its own finding at P3, or P2 where the pipeline installs from the manifest. A package with zero imports still installs and keeps its line.

3. Compare each against its vendor advisories, fetched now.
   Task: for each framework and view library in the table, open the vendor's security advisories index and read the advisories covering the installed major, following [framework-traps.md](../framework-traps.md#how-a-version-step-is-actually-run). The entries in [incidents.md](../incidents.md) name advisories worth checking first.
   Time: 30 minutes. Repository, plus network access to the advisory pages.
   Result: one line per package: installed version, fixed version, advisory identifier, advisory URL, and one of not applicable, below the fix, or at or above the fix. Where the advisory depends on the hosting mode or the host operating system, both are recorded on the same line, and a static export with no framework server in production is recorded as exposed only in development. A version quoted from anything other than a page fetched in this pass is not a result, and neither is an age judgment such as "an old release". When the advisory pages are not fetched, the step is not run, with the reason.

4. Run the advisory database as a second pass, not as the first.
   Task: `npm audit` over the whole tree, development and transitive packages included, then `npm audit --omit=dev` beside it. Record the count per severity for each run, and for every entry the package, the installed version, the fixed version offered and, for a transitive package, the direct dependency that pulls it in (`npm ls <package> --all`). A hosting platform scans the whole tree, so a count taken with `--omit=dev` understates what it will show. Without a lockfile or without the tool, the step is not run, with the reason, and step 3 stands alone.
   Time: 15 minutes. Repository.
   Result: two counts per severity, full tree and production only, a fixed version against each entry, the parent of each transitive one, and each entry ranked per [evidence.md](../evidence.md#ranking-findings), with the import count of step 2 deciding whether the path is reachable. A clean audit is recorded as [evidence.md](../evidence.md#what-is-not-evidence) sets out.

5. Compare the count with the one the hosting platform shows.
   Task: when the platform scans the project (a security panel, or a build log that prints advisories), read its list and match it against step 4 by package and version. The platform's list comes from the person who can open it, as pasted text or a capture; it is never guessed.
   Time: 10 minutes. Repository, plus the platform's panel.
   Result: every entry on the platform's list is on the step 4 list or is recorded as a difference with the package and the version. A platform that does not scan is recorded as such.

6. Confirm the deployed build carries the versions just checked.
   Task: compare the lockfile in the deployment artifact against the one in the repository, or read the versions the running service reports. A floor proved in the repository says nothing about what is serving traffic.
   Time: 15 minutes. Running application.
   Result: the two lockfile hashes match, or the mismatched packages are listed with both versions. Where several repositories consume a shared package that declares the framework, every one of them resolves the same fixed version, or the exception is recorded with its reason.

7. Find the floor in the pipeline.
   Task: read the continuous integration definitions for a runtime version check and a full-tree audit that fail the build on a version below the floor or on a P1 entry. Proving that the job fails needs a lowered version: run the job's own command against a scratch copy of the manifest and lockfile with one version lowered, or run the job itself on a fixture branch per [rules-of-engagement.md](../rules-of-engagement.md#test-fixtures).
   Time: 20 minutes. Repository.
   Result: the job quoted with file and line, and its command exiting non-zero on the lowered copy, recorded with the output. A pipeline with no such job is a finding whose fix is the job.
