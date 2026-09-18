# Dependencies

What the application runs on and what it installs: the runtime, the framework, the view library, every package in the lockfile, the package manager's settings and the pipeline that installs them. Known advisories and registry worms are in [incidents.md](../incidents.md).

## Version floor and advisories

**Applies when:** an audit starts; the runtime, the framework or the view library is upgraded; an advisory is published for anything in the lockfile.

**Options:**

- **Compare the lockfile against the vendor advisories fetched in the pass.** Always. A dependency audit runs beside it and never replaces it.
- **Runtime on a supported line of its own calendar.** A runtime past its end of life fails regardless of any advisory.

**Build:** Start on a runtime major its calendar lists as supported, pin exact versions of the framework and the view library, commit the lockfile from the first install, and read each one against its advisories page before the first release.

**Open:** [version-floor](../protocols/version-floor.md); [framework-traps.md](../framework-traps.md#how-a-version-step-is-actually-run).

## Install-time safety

**Applies when:** the package manager configuration changes; a package that runs install scripts is added; a registry worm is reported.

**Options:**

- **Install scripts refused by default, with an explicit list of packages allowed to build.** The default.
- **Minimum release age of about a week.** So a version poisoned hours ago cannot resolve.
- **Both together.** What would have stopped every recent registry worm.

**Build:** Before the first install, set `ignore-scripts=true` and a minimum release age of seven days in the project's package manager configuration file, and list each package allowed to build with its reason.

**Open:** steps 1 and 2 of [supply-chain](../protocols/supply-chain.md).

## Lockfile and continuous integration

**Applies when:** the lockfile is committed or regenerated; a workflow installs dependencies; a workflow action is added or updated.

**Options:**

- **Clean install from the committed lockfile.** Always in the pipeline.
- **Actions pinned to a full commit hash.** The only immutable reference.
- **Untrusted values passed through an environment variable, never interpolated into a script body.**

**Build:** The pipeline installs with the clean install command from the committed lockfile, pins every action to a full commit hash, starts from a read-only token and passes untrusted values through environment variables.

**Open:** steps 3 and 4 of [supply-chain](../protocols/supply-chain.md).

## Adding a dependency

**Applies when:** a package is added or moves to a new major.

**Options:**

- **A stated reason, its scripts and published files read, its maintainer change checked, a source tag behind the version.** For every addition.
- **Write the small thing instead.** When the package does little and brings much.
- **Remove what nothing imports.** At every pass.

**Build:** Use what the runtime ships before adding a package. For each package added, write down the reason, its lifecycle scripts, its published files and the source tag behind the version, and remove what nothing imports.

**Open:** steps 5 and 6 of [supply-chain](../protocols/supply-chain.md).

## Shared packages across repositories

**Applies when:** several repositories consume a shared package, locally or from a registry, that declares the framework or the view library; a critical advisory lands on that framework.

**Options:**

- **One fixed version pinned in every consumer.** The default after a critical advisory.
- **The view library as a peer dependency.** So each tree holds one copy.
- **A consumer excluded from the pin.** Only with the reason recorded, such as a static export with no server in production.

**Build:** Declare the view library as a peer dependency of the shared package and pin one fixed framework version in every consumer.

**Open:** step 5 of [version-floor](../protocols/version-floor.md); [framework-traps.md](../framework-traps.md#one-version-across-repositories-that-share-a-package).
