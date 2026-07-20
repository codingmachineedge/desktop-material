# Building and Packaging Desktop Material

Desktop Material is built, packaged, tested, and released as a Windows-only
application. The repository retains some inherited upstream platform adapters,
but macOS and Linux packages are not supported product outputs.

## Build pipeline

`yarn build:prod` uses the Webpack configuration under `app/` and
`script/build.ts` to create the production renderer, main process, crash view,
syntax highlighter, CLI, styles, source maps, licenses, and staged Electron
resources. The canonical product version is `app/package.json#version`.

The CI workflow builds Windows x64 and Windows arm64 on `windows-2022`. Windows
x64 runs the full unit suite, and both architectures run the script tests and
packaging gate. The supported packaged end-to-end lane installs and exercises
Windows x64.

## Windows packaging

`yarn package` runs `script/package.ts` and `electron-winstaller` to create:

- a Squirrel current-user setup executable;
- a Windows Installer (`.msi`) package;
- NuGet packages and the `RELEASES` update-feed manifest; and
- a portable application archive during the CI build.

The automated release workflow publishes the x64 setup executable, MSI,
`RELEASES`, and both exact-name copies of the full NuGet package. It verifies
that every required asset is non-empty before publication. Current public
builds are unsigned; adding signing requires the existing Azure signing secret
set and a reviewed workflow change.

## Publication boundary

`.github/workflows/build-installers.yml` runs only after the complete CI
workflow succeeds for `main`. It checks out the exact CI SHA, proves that SHA is
still current `origin/main`, requires a new unique release tag, builds and
packages Windows x64, revalidates both the branch and tag, and publishes one
non-draft release. A failed or stale CI head publishes nothing.

Linux runners used for lint, Pages, or CodeQL are infrastructure only. They do
not produce Linux application packages. No macOS build, signing, packaging, or
E2E lane is part of the supported pipeline.

## Failure modes and verification

Build, unit, script, package, installed-E2E, missing-asset, stale-head, existing
tag, and remote-query failures stop release publication. The tracked CI safety
test enforces the Windows-only matrix and rejects macOS runners or Apple signing
inputs in the application workflow.
