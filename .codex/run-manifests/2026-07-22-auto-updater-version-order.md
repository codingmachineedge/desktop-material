# Auto-updater version-order run manifest

- Run ID: `2026-07-22-auto-updater-version-order`
- Mode: `publish`
- User report: an installed Desktop Material build repeatedly reports that it
  is current even when a newer GitHub Release exists.
- Confirmed cause: local Squirrel package
  `3.6.3-beta3-s000000000201` compares above latest normal package
  `3.6.3-beta3-b0000040887`; both automatic and manual checks log that the local
  version is greater than the remote version.
- Intended repair: both release lanes use one validated
  `<base>-z<12-digit-GitHub-run-ID>` namespace, create immutable non-latest
  Releases, and reconcile the greatest valid package version for freshly
  revalidated current `main` before advancing the Squirrel feed.
- Required UI acceptance: from the installed legacy `s…` build, open **About →
  Check for updates** on an isolated off-screen Win32 desktop and prove the
  newly published `z…` Release is offered instead of **You have the latest
  version**. Keep the user's visible desktop untouched.
- Owned implementation files: `.github/workflows/build-installers.yml`,
  `.github/workflows/super-express-release.yml`,
  `.github/scripts/promote-current-release.sh`, `script/release-version.js`,
  `script/release-version.d.ts`, `script/release-version-test.ts`,
  `app/test/e2e/mock-update-server.ts`,
  `app/test/unit/ci-workflow-safety-test.ts`, and
  `app/test/unit/super-express-release-workflow-test.ts`.
- Owned documentation files/hunks: `README.md`, `ROADMAP.md`,
  `docs/features/integrations/automated-updates-and-release-notes.md`,
  `docs/technical/packaging.md`, `docs/wiki/User-Guide.md`, and the final current
  completion receipt in `HANDOFF.md`.
- Concurrent task boundary: the Cheap LFS commit-progress task owns its separate
  run manifest plus commit-message/progress, preferences, operations, styles,
  localization, focused tests, screenshot, and feature-document changes. Its
  files must be preserved and excluded from updater commits. Shared
  README/ROADMAP/wiki hunks require integration rather than replacement.
- Starting commit: `fbe0550cd3b5ba2ab06e1fb8eb433aef11d159ea` on local/remote `main`.
- Verification: focused version/workflow tests, script suite, relevant updater
  E2E, TypeScript, ESLint/Prettier, shell syntax, production build, remote CI and
  release assets/feed, installed legacy-to-`z` UI transition, Pages/wiki sync,
  and final branch/worktree/stash audit.
