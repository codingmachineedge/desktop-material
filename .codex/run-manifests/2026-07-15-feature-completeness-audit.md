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
