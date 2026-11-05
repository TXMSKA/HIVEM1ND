# Release

Node.js 22 or later and npm are required for development. Windows packaging runs on Windows.

## Verify

```sh
npm ci --ignore-scripts
npm run lint
npm test
npm run build
npm run dist:win -- --node-zip <path to node-v22.23.3-win-x64.zip>
```

The Windows build bundles the official `node-v22.23.3-win-x64.zip` from nodejs.org and checks its SHA-256 before building; it stops with its usage line when the zip is not given, and saves the archive under `dist/` unless `--output` names another file.

The build creates the npm archive under `dist/` and checks that the package contains the executable fronts and kit, with no private root `user/` data. The Windows build creates a zip archive; extracting it and running `ONEM1ND.exe` starts the app without installing anything; the selected mind and attached agent configurations remain independent user data.

Dependency installation skips lifecycle scripts because the unused Squirrel backend includes an incompatible installer hook. The desktop runner downloads Electron on first use.

Before release, verify the terminal setup and browser wizard against isolated destinations, run the packaged Windows application, inspect the archive contents, and check that the release tag matches `package.json` and the changelog heading. A successful build alone is not installation verification.

## Publish

After the reviewed branch is merged, tag that merge commit as `onem1nd-v<version>`, for example `onem1nd-v1.0.0-beta.1`. Pushing the tag runs the Windows release workflow: checks, package creation, Windows zip creation and a GitHub release with the matching changelog entry, marked as a prerelease when the version has a suffix such as `-beta.1`. The workflow stops when the tag does not equal `onem1nd-v` plus the version in `package.json`. A manual workflow run builds downloadable artifacts without publishing a release.

The npm archive is published separately with `npm publish dist/onem1nd-<version>.tgz --access public`, using the package owner's authenticated account. The `npx onem1nd` entry point is available only after this step.

Repository visibility, Git pushes, tags and publication are deliberate release actions. Local development does not perform them.

## ONEM1ND launch day

Nothing here runs before the joint Beta launch. Each step is a deliberate release action; do them in this order.

1. Rename the repository: GitHub, TXMSKA/HIVEM1ND, Settings, Repository name, `ONEM1ND`; then in every clone run `git remote set-url origin https://github.com/TXMSKA/ONEM1ND.git`.
2. Publish the package: `npm publish dist/onem1nd-1.0.0-beta.1.tgz --access public --tag beta`. Also making it `latest` is a choice for Tom to confirm first: `npm dist-tag add onem1nd@1.0.0-beta.1 latest`.
3. Deprecate the old package: `npm deprecate hivem1nd "Renamed to onem1nd. Install with: npm i -g onem1nd"`.
4. Tag and release: `git tag onem1nd-v1.0.0-beta.1` on the merge commit, then `git push origin onem1nd-v1.0.0-beta.1`. The Windows release workflow (`.github/workflows/release.yml`) covers this step: it builds the zip and the archive, creates the GitHub release with the changelog entry and marks it as a prerelease. Check that the release lists the installers.
5. TXMSKA pages: the TXMSKA seat updates the name, the links and the download on the TXMSKA pages.
6. Check afterwards: the README badges render; `https://github.com/TXMSKA/HIVEM1ND` redirects to the new URL; `npm i -g onem1nd` works on a clean machine; a machine with a 2.x mind runs `onem1nd evolve` without a downgrade error and runs the `3.0.0-onem1nd` migration once.

## Signing

The Windows build is unsigned unless a signing certificate is supplied to the build environment through the packaging tool's signing configuration. Signing credentials never belong in the repository. An unsigned executable may trigger a Windows trust prompt or be blocked by Smart App Control.
