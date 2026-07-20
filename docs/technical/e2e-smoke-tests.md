# E2E Smoke Tests

This document explains the end-to-end smoke test harness added for GitHub
Desktop, what it covers, how it runs locally and in CI, and which repository
files make up the implementation.

Desktop Material is Windows-only. The supported packaged smoke lane installs
and exercises Windows x64; inherited non-Windows fixture branches are not
product or release targets.

## Overview

The smoke suite uses Playwright's Electron support to launch the real Desktop
application and drive a small set of critical user paths. The focus is not broad
UI coverage. The suite is intended to protect the app's highest-risk integration
boundaries:

- app startup and first-run flow
- opening an existing repository
- committing and switching branches
- Windows updater state transitions

The suite is deliberately small and runs serially in one Electron session. That
keeps it practical for CI and useful for iterative development.

## What The Suite Covers

The current smoke spec lives in `app/test/e2e/app-launch.e2e.ts` and covers:

- launching Desktop and completing the welcome flow
- opening the smoke repository from disk
- verifying the changed file appears in the diff
- creating a commit
- creating a branch and switching back
- verifying startup update checks against the mock update server
- verifying About dialog update states
- verifying update-available and quit-during-download behavior

These tests intentionally mix UI assertions with repository-level verification by
checking Git state directly in the smoke repository.

## File Layout

The main files added or changed for the E2E harness are:

- `app/test/e2e/app-launch.e2e.ts`
  - the smoke suite itself
- `app/test/e2e/e2e-fixtures.ts`
  - Playwright/Electron fixtures, launch mode selection, tracing, video output,
    and Windows updater cleanup
- `app/test/e2e/mock-update-server.ts`
  - an in-process HTTP server used to simulate Windows updater responses
- `app/test/e2e/test-helpers.ts`
  - helpers for creating and validating the smoke test repository
- `app/test/e2e/playwright.config.ts`
  - Playwright configuration for the smoke suite

## How The App Is Launched

The fixture supports three effective launch modes.

### Installed app

If `DESKTOP_E2E_APP_PATH` is set, the fixture launches the executable at that
path. This is the mode used by CI after the app has been packaged and installed.

This matters most on Windows, where Squirrel update behavior depends on running
from a real installed application layout.

### Packaged app

If `DESKTOP_E2E_APP_PATH` is not set and `DESKTOP_E2E_APP_MODE` is not set to
`unpackaged`, the fixture resolves the packaged app path from `dist` and launches
that executable directly.

This is the default E2E mode because CI uses production-like packaged artifacts.

### Unpackaged app

If `DESKTOP_E2E_APP_MODE=unpackaged`, the fixture launches `out/main.js`
instead of a packaged executable.

This mode exists for local iteration. It avoids the need to fully package and
sign the app just to run the smoke suite while still using a production webpack
bundle and staged resources.

## Local Commands

The branch adds two ways to run the suite locally.

### Packaged mode

```bash
yarn test:e2e:packaged
```

This builds a packaged production app and then runs the E2E suite.

### Unpackaged mode

```bash
yarn test:e2e:unpackaged
```

This builds a production-configured staged app in `out/` and runs the same E2E
suite against `out/main.js`.

The unpackaged build path uses `DESKTOP_SKIP_PACKAGE=1` so `script/build.ts`
stages the app without invoking the final packaging step.

### Default alias

```bash
yarn test:e2e
```

This remains the packaged path and is equivalent to `yarn test:e2e:packaged`.

## Smoke Repository Setup

The suite uses a throwaway local Git repository created in the system temp
directory.

`app/test/e2e/test-helpers.ts` is responsible for:

- creating the repository
- initializing Git
- configuring a local author name and email
- creating an initial commit
- adding an uncommitted smoke file used by the tests

The tests then verify Desktop's behavior both through the UI and by checking the
repository state directly with Git commands.

## Updater Testing

Updater behavior is tested through a local HTTP server defined in
`app/test/e2e/mock-update-server.ts`.

### Build-time updater URL override

`app/app-info.ts` now uses `DESKTOP_E2E_UPDATES_URL` when present. This is what
lets E2E builds point the app at the local mock update server instead of the
real update service.

CI does not use a shared fixed updater port. The
`.github/actions/setup-e2e-update-port` action asks the operating system for a
currently available port on `127.0.0.1`, closes the selection probe, and writes
the exact `http://127.0.0.1:<port>/update` value to the job environment. The
production build and packaged test process consume that same value, so the URL
compiled into the app matches the mock server started at runtime. The mock
server rejects non-HTTP, non-loopback, credential-bearing, query/fragment, or
non-`/update` overrides rather than widening its listening surface.

The July 19 local recovery gate also exercised the production bundle through an
owned loopback provider and off-screen Win32 desktop. Its ten accepted passes
covered launch, Submodule Manager gating, temporary child context, Back, restart,
Appearance persistence, compact keyboard operation, dark/auto-fit rendering,
all language modes, and representative application regressions. A final
post-build 1440×960 child/read-only/Back regression passed before the owned app,
provider, CDP listener, credential, desktop, and fixture root were removed. A
later fresh-bundle race regression synchronously exercised duplicate Open and
Back activation; it preserved one persisted repository and tab, restored the
root once, and showed no error. This headless gate complements the installed
Windows x64 packaged-E2E job, which passed in correction CI `29696805239` using
the same per-job loopback updater URL.

### Windows behavior

For Windows, the mock server serves Squirrel.Windows-style responses.

- requests for `RELEASES` receive a text manifest
- requests for `.nupkg` receive a fake long-lived binary response

The fake package download stays open rather than completing, which keeps the
app in the "Downloading update…" state without requiring a valid signed update
package.

### Mock server control plane

The mock server exposes a simple control surface under `/_control/`.

The tests use it to:

- switch between `no-update` and `update-available`
- reset the captured request log
- inspect which requests the app made

## CI Design

The `e2e-smoke` job in `.github/workflows/ci.yml` runs separately from the main
`build` job.

It currently:

- checks out the repository
- uses the shared CI environment setup action
- selects a currently available per-job loopback updater port and exports one
  exact `/update` URL
- builds the production app with `DESKTOP_E2E_UPDATES_URL` pointed at the mock
  server
- uses the shared Windows signing action when needed
- packages the app
- installs the app on Windows x64
- exports `DESKTOP_E2E_APP_PATH`
- runs `yarn test:e2e:run:packaged`
- uploads `playwright-videos` as artifacts so traces and videos are retained

The CI job intentionally tests production-like packaged or installed artifacts.
This catches failures that do not show up when running only webpack output.

## Windows-Specific Notes

Windows needed a few extra pieces to keep the suite stable.

- the per-job loopback selection avoids depending on a historical fixed port
  that may fall inside a Windows excluded range or already belong to another
  service
- the smoke suite only runs updater coverage against an installed app path on
  Windows
- the workflow installs the generated Squirrel setup executable silently and
  discovers the installed `GitHubDesktop.exe` path
- installer failures dump Squirrel log files for diagnosis
- the E2E fixtures kill lingering `Update.exe` and `GitHubDesktop.exe` process
  trees during teardown to avoid hangs and races with the mock server

## Videos, Traces, and Diagnostics

The suite writes output to `playwright-videos`.

Artifacts include:

- Playwright videos recorded through the Electron fixture
- trace zip files saved from the Playwright context

The workflow uploads that directory as an artifact so CI failures can be
inspected after the run completes.

The fixture also forwards renderer console errors and page errors to the job log
to make failures easier to diagnose when the app dies before Playwright can make
useful assertions.

## Limitations And Tradeoffs

- The suite is intentionally narrow. It protects critical integration paths, not
  the entire UI surface.
- Updater tests simulate update availability rather than downloading valid
  signed release artifacts.
- Windows updater behavior is realistic only when running from an installed app,
  which is why CI uses installer-based setup there.
- Local unpackaged mode is meant for fast iteration, not as a perfect substitute
  for packaged/install-time validation.

## When To Use Which Mode

- Use `yarn test:e2e:unpackaged` when iterating locally on the smoke suite or
  nearby app behavior.
- Use `yarn test:e2e:packaged` when you need parity with the packaged runtime.
- Rely on the CI `e2e-smoke` job for the final check against production-like
  packaged and installed artifacts.

For the July 18–19 recovery changeset, the exact remote Windows result remains a
publication receipt rather than a locally inferred success.
