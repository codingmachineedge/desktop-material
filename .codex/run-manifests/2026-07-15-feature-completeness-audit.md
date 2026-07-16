# Desktop Material feature-completeness audit

- Mode: `publish`
- Objective: verify every publicly declared Desktop Material feature, close
  discovered gaps, create a compact root `ROADMAP.md`, expand
  screenshot/tutorial coverage, publish `main`, and clean merged
  branches/worktrees after remote verification.
- Authoritative inventories: `README.md`, `PLAN.md`, `HANDOFF.md`, root
  `ROADMAP.md`, `docs/wiki/User-Guide.md`, `docs/wiki/Feature-Gallery.md`,
  repository/branch menus, `PopupType`, preferences tabs, repository navigation
  tabs, and registered agent/CLI commands.
- Required mapping for each declared feature: implementation path, reachable UI
  or public command entry point, focused automated test or explicit exercised
  receipt, and user documentation.
- Static gates: no missing implementation paths in the milestone ledger; every
  non-test popup type is rendered; every public roadmap item has evidence; no
  stale unfinished/TODO status in public roadmap sources.
- Automated gates: repository-wide unit and script tests, TypeScript, ESLint,
  Prettier, production build, packaged/unpackaged smoke where available, and
  CI/Pages after push.
- UI gates: exact built source exercised on one isolated off-screen Win32
  desktop; minimum and desktop viewport checks; keyboard/focus, accessibility,
  long-name wrapping, and horizontal clipping review.
- Evidence hygiene: use synthetic disposable repositories and placeholder
  identities. Do not retain local usernames, home or temporary-directory paths,
  tokens, private repository names, account identifiers, or other
  machine-specific data in tracked manifests, logs, or captures.
- Screenshot set: privacy-safe captures made only from disposable fixtures for
  Pull All progress plus a representative cross-section of Material shell,
  clone, repository tools, Actions, settings, automation, providers, history,
  stashes, worktrees, and guided Git/GitHub workflows. Promote only inspected
  captures.
- Documentation targets: `README.md`, `ROADMAP.md`, `PLAN.md`, `HANDOFF.md`,
  `docs/wiki/`, `site/`, and tutorial/user-guide pages.
- Git publication: direct `origin/main` is authorized. Reject divergence, push
  without force, verify remote SHA and CI/Pages, then delete only branches
  proven merged and remove only worktrees tied to those merged branches.

## Completion receipt

- The registered-surface inventory is enforced by
  `app/test/unit/feature-registration-completeness-test.ts`: every `PopupType`,
  Preferences tab, repository section, public agent command, and M0–M19
  implementation path is registered and reachable.
- The detailed Pull All gate at `1bc8a226de` passed 1,041 unit tests, 15 script
  tests, focused progress/style/checkbox coverage, TypeScript, formatting,
  lint, the exact production build, and an inspected 1000×688 renderer with no
  unnamed repository checkboxes or horizontal overflow. The live result region
  and final action remained reachable.
- The July 16 release gate tested exact application source `c5205838df` through
  the production build and isolated off-screen interaction. The only later
  application-tree change through `36197bf6dd` was a portable-path correction
  in a tab-action test; the shipped renderer source did not change.
- Exact commit `36197bf6dd` passed CI run `29490902486` (lint, production
  builds/packages, unit and script tests, and Windows/macOS end-to-end smoke)
  and installer run `29490902407`. Pages run `29489043545` successfully
  deployed the current site and screenshot payload.
- A final focused checkout pass ran 37 feature-registration, Pull All,
  checkbox-accessibility, compact-style, and Pages-gallery tests with 37
  passing. The public Pages and seven-page wiki expose the inspected 51-image
  synthetic gallery.
- The remaining roadmap edits are documentation-only. No application source,
  screenshots, credentials, provider data, or user-specific paths change in
  the closure commit.
