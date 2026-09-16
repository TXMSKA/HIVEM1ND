# Release

Node.js 22 or later and npm are required for development. Windows packaging runs on Windows.

## Verify

```sh
npm ci --ignore-scripts
npm run lint
npm test
npm run build
npm run dist:win
```

The build creates the npm archive under `dist/` and checks that the package contains the executable fronts and kit, with no private root `user/` data. The Windows build creates a zip archive; extracting it and running `HIVEM1ND.exe` starts the app without installing anything; the selected mind and attached agent configurations remain independent user data.

Dependency installation skips lifecycle scripts because the unused Squirrel backend includes an incompatible installer hook. The desktop runner downloads Electron on first use.

Before release, verify the terminal setup and browser wizard against isolated destinations, run the packaged Windows application, inspect the archive contents, and check that the release tag matches `package.json` and the changelog heading. A successful build alone is not installation verification.

## Publish

After the reviewed branch is merged, tag that merge commit as `v<version>`. Pushing the tag runs the Windows release workflow: checks, package creation, Windows zip creation and a GitHub release with the matching changelog entry. A manual workflow run builds downloadable artifacts without publishing a release.

The npm archive is published separately with `npm publish dist/hivem1nd-<version>.tgz --access public`, using the package owner's authenticated account. The `npx hivem1nd` entry point is available only after this step.

Repository visibility, Git pushes, tags and publication are deliberate release actions. Local development does not perform them.

## Signing

The Windows build is unsigned unless a signing certificate is supplied to the build environment through the packaging tool's signing configuration. Signing credentials never belong in the repository. An unsigned executable may trigger a Windows trust prompt or be blocked by Smart App Control.
