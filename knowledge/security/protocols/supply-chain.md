name: supply-chain
purpose: Prove what installs is what was reviewed, and that a freshly poisoned release cannot land.
scope: the manifest, the lockfile, package manager settings, added dependencies and the continuous integration workflows
trigger: task close
repeat: once
inputs: the manifest, the lockfile, the package manager configuration, the pipeline definitions, a scratch folder outside the repository
stop: an install script runs during a clean install without being listed, which is reported at once and ends the protocol
report: the two settings with the values the tool reports back, the install command used by the pipeline, the action pinning count, the audit reading, and the review note per added package

## Steps

1. Read the install scripts and whether they are refused by default.
   Task: read the lifecycle scripts the manifest declares, `preinstall`, `install`, `postinstall` and `prepare`: a script that downloads, pipes or executes remote code is a P1 finding on its own. Then read the project's own package manager configuration file, since `npm config get` also reports the machine's settings. The npm setting is `ignore-scripts`, default false; the pnpm one is `ignoreScripts`, in the workspace or global configuration file. Install once into an empty scratch folder outside the repository, from a copy of the manifest and the lockfile.
   Time: 25 minutes. Repository, plus the scratch folder.
   Result: the manifest's lifecycle scripts quoted, or a note that it declares none; `npm config get ignore-scripts` returning `true` from the project directory; the scratch install log holding no lifecycle script output; and the packages allowed to build listed by name with the reason each one needs it. A setting left at its default is a finding whose fix is the setting.

2. Read the minimum release age.
   Task: read the project's configuration for a minimum release age of about a week. The npm setting is `min-release-age`, in days, added in npm 11.10.0 (https://github.com/npm/cli/blob/latest/CHANGELOG.md) and documented as building the tree "such that only versions that were available more than the given number of days ago will be installed"; record `npm -v` beside it, since an older npm ignores the setting. The pnpm setting is `minimumReleaseAge`. These two settings, with step 1, are what would have stopped every recent registry worm.
   Time: 20 minutes. Repository, plus the scratch folder.
   Result: `npm config get min-release-age` returning the configured value from the project directory, the npm version at or above 11.10.0, and an install in the scratch folder of a version published inside the window failing, recorded with the command output. A missing setting is a finding whose fix is the setting.

3. Install from the lockfile in the pipeline, never resolve fresh.
   Task: read the pipeline's install command. The clean install command requires a lockfile, and where the lockfile disagrees with the manifest it "will exit with an error, instead of updating the package lock". Prove it in the scratch folder: change one version in the copied manifest and run the clean install there.
   Time: 20 minutes. Repository, plus the scratch folder.
   Result: the pipeline's install line quoted with file and line, and the scratch clean install exiting non-zero with the mismatch error.

4. Read the pinning of the pipeline's own dependencies and its token.
   Task: list the workflow actions referenced by tag or branch rather than by a full commit hash, which the platform documents as "the only way to use an action as an immutable release": `git grep -n -I -E -e 'uses: *[^ .][^ ]*@' --and --not -e '@[0-9a-f]{40}( |$)' -- .github/workflows`. Read the default token permissions, and list the untrusted values interpolated into a script body rather than passed through an environment variable: `git grep -n -I -E '\$\{\{ *(github\.event\.|github\.head_ref|inputs\.)' -- .github/workflows`, each hit read for whether it sits in a `run:` block. Positive control: a planted workflow line `uses: actions/checkout@v4` and a planted `run: echo ${{ github.event.issue.title }}`, each found by its expression.
   Time: 40 minutes. Repository.
   Result: zero action references by tag or branch, the token permission block quoted with read access to contents as the default, and zero untrusted values interpolated into a `run:` block, each count recorded with its expression and control.

5. Read the audit for what it is.
   Task: take the audit counts from step 4 of [version-floor](version-floor.md); this step adds what they do not prove.
   Time: 5 minutes. Repository.
   Result: the counts and ranks from that step quoted, with the note in [evidence.md](../evidence.md#what-is-not-evidence) beside them. Without that step, this one is not run.

6. Read what a new dependency actually ships.
   Task: for every added package and every new major, record the reason it is needed, read its lifecycle scripts and the file list it publishes, check the maintainer change since the last version, and check that the version has a matching commit or tag in its source repository. List the packages nothing imports with the import count of step 2 of [version-floor](version-floor.md). Provenance attestation proves where a package was built, not that it is safe: every recent registry worm published from a legitimately authenticated session. Needs a person: accepting a package whose scripts do real work.
   Time: 20 minutes per added package. Repository.
   Result: per added package, the reason, its lifecycle scripts or a note that it declares none, the published file list, the source commit or tag, and the acceptance recorded with a name against it. Plus the unused packages, each a finding whose fix is its removal.
