name: supply-chain
purpose: Prove what installs is what was reviewed, and that a freshly poisoned release cannot land.
trigger: manual, on any dependency change, lockfile change, build pipeline or continuous integration workflow
repeat: once per audit, and again on every dependency addition or major upgrade
inputs: the manifest, the lockfile, the package manager configuration, the pipeline definitions
stop: an install script runs during a clean install without being listed, which is reported before the pass continues
report: the two settings with the values the tool reports back, the install command used by the pipeline, the action pinning count, the audit counts, and the review note per added package

## Steps

1. Refuse install scripts by default.
   Task: set the package manager to run no lifecycle scripts, and list the few packages that genuinely need a build step explicitly. The setting is `ignore-scripts` for npm, default false, documented as "npm does not run scripts specified in package.json files". The equivalent for pnpm is `ignoreScripts`, which is configured in the workspace or global configuration file rather than in an npm-style configuration file.
   Time: 25 minutes. Repository.
   Result: `npm config get ignore-scripts` returns `true`, and a fresh install into an empty directory produces an install log containing no lifecycle script output. The explicitly allowed packages are listed by name with the reason each one needs a build.

2. Refuse versions that are too young to have been looked at.
   Task: set a minimum release age of about a week. The npm setting is `min-release-age`, default null, documented as building the tree "such that only versions that were available more than the given number of days ago will be installed". The pnpm setting is `minimumReleaseAge`, in the workspace or global configuration. These two settings, together with step 1, are what would have stopped every recent registry worm.
   Time: 20 minutes. Repository.
   Result: `npm config get min-release-age` returns the configured value, and an install that would resolve a version published inside the window fails, recorded with the command output.

3. Install from the lockfile in the pipeline, never resolve fresh.
   Task: continuous integration uses the clean install command. It requires a lockfile to exist, and where the lockfile disagrees with the manifest it "will exit with an error, instead of updating the package lock", and it "will never write to package.json or any of the package-locks".
   Time: 20 minutes. Repository.
   Result: the pipeline log showing the clean install command, and a job run against a deliberately mismatched lockfile that exits non-zero with the mismatch error.

4. Pin the pipeline's own dependencies and shrink its token.
   Task: pin every workflow action to a full length commit hash, which the platform documents as "the only way to use an action as an immutable release". Set the default token to read access on repository contents and raise it per job where a job needs more. Pass untrusted values through an intermediate environment variable rather than interpolating them into a script body.
   Time: 40 minutes. Repository.
   Result: a search across the workflow files returning zero action references by tag or branch, the token permission block quoted, and zero direct interpolations of an untrusted context value into a script.

5. Run the audit, and read the result for what it is.
   Task: `npm audit --audit-level=high` and record what comes back.
   Time: 10 minutes. Repository.
   Result: the advisory count at high and critical with the fixed version offered for each. A clean result is recorded as a clean audit and nothing more: it does not read install scripts, and a version poisoned in the last few hours has no advisory yet.

6. Read what a new dependency actually ships.
   Task: for every added package and every new major, read its lifecycle scripts and the file list it publishes, and check the maintainer change since the last version. Provenance attestation proves where a package was built, not that it is safe: every recent registry worm published from a legitimately authenticated session. **Needs a person**: accepting a package whose scripts do real work is a decision.
   Time: 20 minutes per added package. Repository.
   Result: per added package, the contents of its lifecycle scripts or a note that it declares none, the published file list, and the acceptance recorded with a name against it.
