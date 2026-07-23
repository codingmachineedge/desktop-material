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

- a portable ZIP containing the complete packaged Windows application tree;
- a Squirrel current-user setup executable;
- a Windows Installer (`.msi`) package;
- NuGet packages and the `RELEASES` update-feed manifest.

The portable archive is not CI-only: a local Windows x64 production build
followed by `yarn package` writes `dist/GitHub Desktop-x64.zip` alongside the
installer outputs. This provides a directly movable build even when a remote
release run is unavailable. It contains the packaged application directory,
so extract the ZIP before starting the executable.

`script/windows-portable-zip.ts` uses the native
`%SystemRoot%\System32\tar.exe` ZIP writer so archive data is streamed instead
of retained in Node memory and ZIP64-capable tooling handles large package
entries. It writes to a controlled `.partial.zip`, lists the completed archive
to reject truncation or corruption, requires a non-empty result, and atomically
renames it to the final path. A stale destination or failed partial archive is
removed rather than mistaken for the current package. The destination must stay
outside the packaged source tree.

The automated release workflow publishes the x64 portable ZIP, setup
executable, MSI, `RELEASES`, and both exact-name copies of the full NuGet
package. It verifies that every required asset is non-empty before publication.
Automatic and Super Express packages share the validated
`<base>-z<12-digit-GitHub-run-ID>` version namespace so Squirrel can order
Releases across both lanes. The leading `z` also migrates installations from the
older incompatible `b…` and `s…` namespaces.
Current public builds are unsigned; adding signing requires the existing Azure
signing secret set and a reviewed workflow change.

## Publication boundary

`.github/workflows/build-installers.yml` runs only after the complete CI
workflow succeeds for `main`. It checks out the exact CI SHA, proves that SHA is
an eligible `main` push, requires a new unique release tag, builds and packages
Windows x64, revalidates the tag, and publishes one immutable non-draft Release.
A successful target superseded during the build remains published but
non-latest. The shared promotion helper only advances the update feed for
current `main`, reconciles the greatest valid same-SHA version, and demotes a
candidate if `main` changes during promotion. A failed CI publishes no Release.

Linux runners used for lint, Pages, or CodeQL are infrastructure only. They do
not produce Linux application packages. No macOS build, signing, packaging, or
E2E lane is part of the supported pipeline.

## Failure modes and verification

Build, unit, script, package, archive-create/list, installed-E2E, missing-asset,
invalid-version, existing-tag, and remote-query failures stop release
publication. A stale post-build head preserves its immutable Release without
promoting it to the updater feed.
The tracked CI safety test enforces the Windows-only matrix, requires the x64
portable ZIP as a non-empty release asset, and rejects macOS runners or Apple
signing inputs in the application workflow. Portable-ZIP and CI focused checks
passed 11/11 along with script TypeScript and focused lint, format, and diff
checks. The combined changed-surface gate passed 165/165 across 18 suites. A
complete local production package has not yet run for this change, so there is
not yet a full-size local installer/ZIP artifact receipt; remote release
verification is also pending.
