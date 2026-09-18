name: version-floor
purpose: Fail anything running past its support date or below a published fix version.
scope: the runtime version, the framework and view library versions, the lockfile, and any runtime or framework upgrade
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, and again after any change to the lockfile or the runtime
inputs: the lockfile, or the manifest when no lockfile exists, the runtime version, the vendor advisory pages, the runtime support calendar
stop: the runtime is past its end of life, in which case the pass stops and that is the only finding until it is raised
report: the runtime version against its calendar status, one line per framework with installed version, fixed version, advisory identifier and advisory URL, and the audit counts at high and critical

## Steps

1. Read the runtime against its own calendar.
   Task: `node -v` in the project, and the deployed version from the running service rather than the development machine. Fetch the runtime's published support calendar in this pass, https://nodejs.org/en/about/previous-releases for this runtime, and read the status of that major. Other runtimes publish their own calendar and it is fetched the same way.
   Time: 10 minutes. Repository, plus one running-application read.
   Result: the major version and its status, one of Current, Active LTS or Maintenance LTS, with the calendar URL. A major listed as ended is a P0: no advisory will be issued for it again, so no later step can compensate. When the calendar cannot be fetched, the version is recorded and the comparison is not verifiable with the tool at hand, with the calendar URL a person must read; a status quoted from [standards.md](../standards.md) is named with its check date and never counted as the result.

2. Read what is installed, not what is declared.
   Task: `npm ls --all --depth=0` for the direct dependencies, then read the exact resolved versions of the framework, the view library and every runtime dependency from the lockfile. A manifest range is an intention; the lockfile is what shipped. With no lockfile, or with no installed tree and no permission to install, read the manifest instead: an exact pin is taken as the version, and a range is taken as the lowest version it admits, since that version can install. A dependency the source never imports is listed too, because it still installs.
   Time: 10 minutes. Repository.
   Result: a table of package and resolved version, taken from the lockfile, with the lockfile version format recorded. Without a lockfile, the table is marked as read from the manifest, and the missing lockfile is its own finding at P3, or P2 where the pipeline installs from the manifest. The table always feeds step 3.

3. Compare each against its vendor advisories, fetched now.
   Task: for each framework and view library in the table, open the vendor's security advisories index and read the advisories covering the installed major. A framework that is declared but never imported gets its line too, because it still installs. Follow the procedure in [framework-traps.md](../framework-traps.md), which names the traps worth looking for and the pages that carry them.
   Time: 30 minutes. Repository, plus network access to the advisory pages.
   Result: one line per package: installed version, fixed version, advisory identifier, advisory URL, and one of not applicable, below the fix, or at or above the fix. Where the advisory depends on the hosting mode or the host operating system, both are recorded on the same line, and a static export with no framework server in production is recorded as exposed only in development. A version quoted from anything other than a page fetched in this pass is not a result, and neither is an age judgment such as "an old release" or "well below current". When the advisory pages are not fetched, for any reason, the step is recorded as not run with that reason, and the report lists it under the steps not run. The entries in [incidents.md](../incidents.md) name advisories worth checking first.

4. Run the advisory database as a second pass, not as the first.
   Task: `npm audit --audit-level=high`. Record the count and the fixed version offered for each entry. The audit needs a lockfile; without one, or without the tool, the step ends as not run with the reason, and step 3 stands alone.
   Time: 10 minutes. Repository.
   Result: the advisory count at high and critical with a fixed version against each. A clean audit is recorded as a clean audit and nothing more, for the reasons in [evidence.md](../evidence.md).

5. Confirm the deployed build carries the versions just checked.
   Task: compare the lockfile in the deployment artifact against the one in the repository, or read the versions the running service reports. A floor proved in the repository says nothing about what is serving traffic.
   Time: 15 minutes. Running application.
   Result: the two lockfile hashes match, or the mismatched packages are listed with both versions. Where several repositories consume a shared package that declares the framework, every one of them resolves the same fixed version, or the exception is recorded with its reason.

6. Put the floor in the pipeline.
   Task: add the runtime check and the audit to continuous integration so a version below the floor fails the build rather than appearing in the next audit.
   Time: 20 minutes. Repository.
   Result: a pipeline run against a deliberately lowered version that exits non-zero, recorded with the job output.
