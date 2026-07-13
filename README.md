# Desktop Material

Desktop Material is an independent Material Design 3 (M3 Expressive) remake of [GitHub Desktop](https://github.com/desktop/desktop). It rebuilds the entire application shell around Material Design 3 while keeping GitHub Desktop's full Git workflow and the same underlying stack: [TypeScript](https://www.typescriptlang.org), [React](https://react.dev), [Electron](https://www.electronjs.org), and [Sass](https://sass-lang.com). This project is in active development.

<img
  width="1072"
  src="docs/assets/screenshots/material-workspace-changes.png"
  alt="Desktop Material workspace showing the Changes view: a left icon navigation rail, a floating pill toolbar with repository and branch chips, browser-like repository tabs, and a floating Material Design 3 card with tri-state checkboxes and a commit composer"
/>

![CI](https://github.com/codingmachineedge/desktop-material/actions/workflows/ci.yml/badge.svg?branch=main)

## Shipped today

These features are implemented and live on `main`.

**Material Design 3 Expressive shell**
- App-bar branding with an inline pill menu
- Left icon navigation rail — Changes (with a badge), History, Branches, Settings, and the account avatar
- A floating pill toolbar with repository and branch chips and a sync pill that shows an ahead badge
- Floating, radius-24 elevated workspace cards with an animated light/dark theme
- Full MD3 workspace surfaces: tri-state selection checkboxes, tonal status chips, token-based diff colors, an inverse-surface undo banner, and a redesigned welcome flow and blank slate

**Repository tabs**
- Browser-like repository tabs, per-account and bound to repos, with inline rename
- Per-tab title styling: bold/italic/underline, size, color, font family, alignment

**Multi-account**
- Multiple accounts including multiple identities per host; per-account tabs, repos, and settings
- Browse complete GitHub organization repository lists, filter cloning by organization, and choose an organization when publishing
- Add GitLab accounts, including self-hosted endpoints, with a personal access token; add Bitbucket accounts with an app password, then browse and clone their repositories from the provider tab
- The repository list can hide its automatically maintained Recent group from **Settings → Appearance**
- Repositories can be pinned from their context menu into a dedicated top group

**Versioned settings & history**
- Per-account settings stored in a local git repo — every settings/tabs change auto-commits. Open **Edit → Settings History…** (`Ctrl+Alt+Z`) for a non-modal timeline with lazy diffs, undo, redo, and restore; each history action adds an audit commit instead of rewriting history

**Non-modal dialog framework**
- Dialogs float without blocking the app, drag by their headers, cascade, and can be brought to front — the app stays fully interactive behind an open dialog
- Preferences rebuilt as an MD3 940×660 dialog with a left rail, an Active chip, and a pill footer
- Repository and branch pickers are MD3 side sheets; the clone dialog is restyled to match

**Notification centre**
- A bell and right-hand side sheet backed by its own local git repo — unread badges, mark read/unread, delete, mark-all, and a git-backed history you can undo/restore
- Switch to a separate live GitHub inbox for any signed-in GitHub.com or Enterprise account, filter unread/all and participating threads, load bounded pages, open only validated provider links, mark read, and confirm mark-done without copying remote threads into the local log

**Search everywhere, with a regex builder**
- Every search bar gains fuzzy / substring / regex filter modes, a case toggle, and per-list filter chips
- A full regex builder — anchors, character classes, quantifiers, groups, alternation, lookaround, all six flags, and a live tester — reachable from the search bars

**Repository safety and cleanup**
- A context-menu option can permanently discard changes without sending files to the trash, including untracked files, for large cleanup operations where the regular discard flow would be slow
- Local-only branches use a clear publish indicator, including branches whose configured upstream was deleted
- Branch lists can be sorted by last activity or alphabetically from **Settings → Appearance**
- The commit composer can show the effective Git author name/email plus the winning config scope and file before commit
- Merge commits use a distinct, subdued italic summary in History so integration points are easy to scan

**Dynamic UI scaling**
- A UI-scale slider (50–200%) in Preferences → Appearance plus auto-fit-to-window that shrinks the interface to fit smaller windows (on by default), composing with `Ctrl` `+` / `-` / `0`
- At the supported minimum window size, a requested 200% scale safely auto-fits to 96%, keeping the title bar, navigation, Appearance controls, and footer visible without horizontal clipping

**Per-repo `.gitignore` manager**
- Open **Repository → Manage .gitignore…** for a manager that auto-suggests templates from your repo's contents, a searchable catalog of ~19 templates grouped by category, one-click apply/remove, and a raw editor — all merged into marked, reversible sections

**One-click Build & Run**
- Detects the project's build profile (Node/pnpm/yarn, Rust, Go, .NET, Python, Java, Make/CMake), then installs dependencies, builds, and runs it in one action, streaming output to an MD3 log panel
- Auto-ignores build outputs (applies the matching `.gitignore` template + an artifacts section) before building
- Bounded auto-fix on failure, a per-repo Build & Run settings tab, and optional single-prompt UAC pre-elevation

**Automation and GitHub Actions**
- Configure scheduled commit-and-push and pull globally, override them per account or repository, and rely on safety guards that skip unsafe repositories and preserve draft commit messages
- Run commit-and-push immediately, or merge all branches/worktrees with per-target progress and Copilot-assisted conflict handling
- Browse GitHub Actions runs in the repository rail, filter by workflow/branch/event/status, re-run all or failed jobs, inspect jobs and steps, read searchable logs, and dispatch workflows with inputs

**Agent access and command line**
- Enable an opt-in, token-gated local agent server from **Settings → Agent access**; it exposes MCP and REST on a random loopback-only port and never returns account credentials
- Use the bundled stdio proxy or command-line client to list accounts/repos/tabs, inspect status, clone, commit, fetch/pull/push, manage branches/tabs, run automation, and dispatch workflows

**Power-user history, stashes, and windows**
- Search History by title, message, tag, or hash and toggle a lane graph that visualizes commit ancestry
- Keep multiple named stashes visible in Changes, inspect each stash's files and diffs, then restore or discard the selected entry
- Pull every repository from the repositories sheet with per-repository results; use repository pinning/grouping, branch presets/default-branch controls, and per-repository editor overrides
- Open repositories and worktrees in separate windows with isolated per-window selection and persisted tabs

**Fully Material, everywhere**
- The remaining stock surfaces — tooltips, menus, banners, autocomplete popups, segmented controls, split-buttons, dialog internals, History/CI surfaces — are re-tinted through the Material token system in both light and dark themes

**Also shipped:** multi-clone with organization chips, parallel/sequential modes and URL-only import/export; one-click commit and push with a generated message; self-update checks against Desktop Material releases; SVG diff hardening and display controls; safer undo/reset/tag deletion confirmations; and responsive, keyboard-accessible MD3 surfaces throughout the app.

## Roadmaps

These are living delivery roadmaps for the active `mega-feature-update` branch. An item moves to **Done** only after its implementation and focused checks are committed and pushed. UI milestones additionally require an off-screen production build, interactive exercise, and inspected screenshots before the evidence and documentation tasks can be marked done.

Last updated: **July 13, 2026**. The detailed, reproducible evidence ledger is the [Git, GitHub, and GitKraken parity run manifest](.codex/run-manifests/2026-07-12-git-gh-interactive-audit.md).

### Delivery roadmap

| Status | Milestone | Completion evidence |
|---|---|---|
| **Done** | Inventory the installed Git 2.55 and GitHub CLI 2.96 command trees | Complete command catalogs are parsed internally for coverage tracking rather than presented as a command-search product |
| **Done** | Inventory the official GitHub REST and GraphQL surfaces | REST baseline: 790 paths, 1,196 operations, and 51 categories; GraphQL baseline: 252 current mutations, plus 16 deprecated mutations retained only for coverage accounting |
| **Done** | Add a bounded recipe-execution foundation for guided functions | Internal `git`/`gh` execution only, no shell, repository-bound working directory, output/input limits, cancellation, ownership cleanup, credential-command blocking, and no raw command/API search surface in the app |
| **Done** | Run repository functions through the bundled Git runtime | The production app resolves and executes bundled Git 2.53.0.windows.3, including Repository Tools, instead of depending on a separately installed system Git |
| **Done** | Add safe GitHub feature request/response contracts | Selected-host relative paths, traversal rejection, mutation confirmation, bounded streamed responses, safe-header allowlisting, and deep credential redaction |
| **Done** | Extend native Actions controls | Run/job reruns, normal and force cancellation, workflow enable/disable, confirmations, and responsive long-metadata containment |
| **Done** | Harden responsive containment on audited app surfaces | Settings, floating surfaces, the repository rail and toolbar, repository-function buttons, Merge All, Pull All, Build & Run, Actions, and the screenshot gallery wrap, stack, clamp, or vertically scroll instead of widening their page shells |
| **Done** | Add the first guided repository-function batch | Status summary, repository health, recent-signature audit, maintenance preview/run, reflog recovery, ZIP/TAR export from `HEAD`, full-history bundle export, and read-only bundle verification use fixed safe recipes, purpose-built controls, confirmation, streaming results, exact cancel, native save/reveal, and repository refresh—without a raw command search/editor |
| **Done** | Complete guarded full-history bundle export, verification, and import | An inspected bundle can create a new local branch without overwriting an existing ref; actual off-screen import completed, and standard bundle advertisements such as the pseudo-ref `HEAD` are ignored rather than rejected or offered as import targets |
| **Done** | Keep Notifications identities and signed-out state responsive | Long local notification-source identities wrap within the panel, while the GitHub inbox presents a complete `No signed-in accounts` option without clipped or oversized text |
| **Active** | Expand audited Git capabilities as named functions | File history/blame, restore-file-version, signature audit, source archives, full-history bundle workflows, guided shallow cloning, and sparse-checkout administration are done; guided history deepening is implemented at `462b0c7281` and awaits the fresh off-screen UI gate, while patch-series exchange, structured commit rewriting, signing, LFS, worktrees, and the later Git administration functions below follow |
| **Active** | Expand named GitHub functions on a hardened transport | GitHub.com REST versioning, credential/header precedence, the bounded/cancellable multi-account Notifications inbox, and guided native Issue creation are done; the first native pull-request creation slice is implemented at `af5fd32078`, hardened at `853c3c3d7d`, and bound to exact remotes at `5d50500e40`, with code review/focused checks complete and the UI gate pending. The first Actions artifact browse/download/digest slice at `cec14273a1` was hardened at `170473d4d9`, then independently reviewed and corrected at `c6ce9a7661` with an isolated Electron `ClientRequest` redirect/stream boundary, exact underlying-request cancellation, strict path validation, authorization invalidation, account-aware async generations, and stable Actions identity; 84 focused tests plus TypeScript and touched-file lint/format checks pass, while the production UI gate remains active. PR metadata/lifecycle, artifact pagination beyond the first 100, effective branch rules, and Releases/assets remain sequenced |
| **Done** | Complete the official GitKraken Desktop history comparison | Official surviving 0.6–6.0 posts plus 7.x–12.3 release archives were deduplicated into current-app coverage, implementable local gaps, and explicitly separated proprietary/cloud services |
| **Done — current verified slice** | Build and interactively verify every changed UI off-screen | The exact MCP production build passes, and the isolated app exercised bundled Repository Tools, create-only bundle import, shallow clone, sparse checkout review, and both Notifications sources. Regular and minimum-supported-window checks reported equal document/client widths with no visible clipping, overlap, oversized text, or page-level sideways scroll |
| **Published; Pages promotion awaiting `main`** | Refresh README, wiki, Pages, and screenshot evidence | README, in-repository wiki sources, the public GitHub wiki, Pages source, and three inspected 1000×687 screenshots are pushed. A branch-targeted Pages build assembled successfully, but the protected `github-pages` environment correctly rejected deployment because only `main` may publish; the site will promote through the normal `main` merge path |

### Capability roadmap

| Area | Available now | Next native interactive milestones | Long-tail access |
|---|---|---|---|
| **Git** | Core repository, branch, commit, diff, rename-following file history/line blame, confirmed working-tree file-version restore, signature audit, stash, remote, worktree, merge, rebase, fetch/pull/push, automation, guarded cleanup, guided bounded-history shallow cloning, cone-mode sparse-checkout administration, guided source-archive export, portable full-history bundle export/verification, and guarded create-only branch import from inspected bundles | Deepen shallow history; export/import patch series; structured local-commit rewrite; signing setup; Git LFS and complete worktree administration; then merge-tree preview, bisect, stash, remotes, and hooks | Fixed, audited Git recipes may power named app functions, but the UI exposes task-specific controls and results rather than a raw command list |
| **GitHub CLI** | Native repository, pull-request reading, guided Issue authoring, multi-account Notifications triage, Actions browsing/logs/dispatch/rerun/cancel, account, organization, clone, fork, and publish foundations | Verify and enrich native pull-request creation, then add review/update/merge; verify the artifact downloader and add interactive pagination beyond its first 100 results; inspect effective branch rules; manage releases/assets; richer Issue workflows | `gh` can back provider-scoped functions internally; users interact with purpose-built forms, previews, confirmations, and results |
| **GitHub REST and GraphQL** | Account-scoped API layer, safe request/confirmation/redaction contracts, a bounded/cancellable Notifications inbox with conditional polling and pagination, and exact-provider native Issue creation | Verify/correct the first permission-aware native pull-request creation slice; verify the first bounded Actions artifact download/digest slice and add pagination; then add PR templates/metadata/lifecycle, effective branch-rule inspection, Releases/assets, general bounded pagination, and selected security/deployment/administration functions | The full schema is coverage evidence and an implementation checklist, not an endpoint browser; supported operations become named app features |
| **GitKraken parity references** | Graph, diff, rename-following file history/blame, commit/stash/branch/remote/worktree flows, shallow clone and sparse-checkout controls, repository tabs, provider accounts, themes, search, automation, multi-window work, and many Material-native productivity tools | Evaluate editor and terminal workflows, undo/redo breadth, branch pin/filter/activity, Gitflow/hooks/signing, richer PR/issues/Launchpad-style triage, conflict prevention, and agent-session worktrees | Proprietary GitKraken cloud, enterprise, AI, and collaboration services remain reference points, not copied services, branding, or assets |

Effective branch-rules follow-up: use GraphQL `bypassForcePushAllowances` to resolve selected-account actor scope before promoting a protected branch with force pushes enabled from **Unknown**. The current REST-only inspector intentionally fails closed instead of guessing.

### Native parity waves

| Priority | Guided app functions | State |
|---|---|---|
| **Delivered foundation** | Repository status/health/maintenance/reflog tools; file history/blame and restore; bounded shallow clone; sparse checkout; source archives; full bundle export/verify/import; Notifications and guided Issue creation | **Done; each completed slice remains listed here as the roadmap advances** |
| **P0 — verification pending** | Deepen a shallow repository's history; create a pull request through the first native compose/review/submit slice; browse and safely download a workflow run's first bounded artifact page with local digest and attestation-presence context | **History deepening is pushed at `462b0c7281`; native PR creation is pushed at `af5fd32078` plus hardening `853c3c3d7d` and exact-remote binding `5d50500e40`, with 25 focused tests independently rerun; Actions artifacts are pushed at `cec14273a1` plus hardening `170473d4d9` and independently reviewed Electron/runtime correction `c6ce9a7661`, with 84 focused tests passing. All three still require the fresh production/off-screen UI gate before Done** |
| **P0 — active next** | Finish wiring and independent review of the effective branch-rules inspector; enrich PR creation with templates/reviewers/assignees/labels; review, update, and merge a pull request; add interactive Actions artifact pagination beyond the first 100 | **In progress** |
| **P1** | Export and import patch series; rewrite local commits through a structured reviewable plan; manage Releases and assets; configure commit/tag signing; manage Git LFS; administer every worktree lifecycle operation | **Planned** |
| **P2** | Pin, hide, solo, and restore branch visibility with clear persisted state | **Planned** |
| **Later** | Preview conflicts with merge-tree; guide bisect sessions; complete stash and remote managers; manage repository hooks; add richer Issue workflows; provide provider-neutral triage | **Sequenced after P2** |
| **Reference only** | GitKraken Cloud Workspaces/Patches, Team presence, Launchpad sync, Insights, Code Review service, shared AI credits, organization policy, and on-prem commercial services | **Not copied** |

### Verification roadmap

- Do not require sideways scrolling in page or dialog shells wherever responsive wrapping or stacking can preserve usability. Horizontal scrolling is reserved for intrinsically spatial code, diff, and log surfaces.
- Verify desktop and minimum supported windows, 50–200% UI scaling, light/dark themes, long repository/branch/host names, destructive confirmations, keyboard focus, and screen-reader labels.
- Commit and push each coherent milestone. Documentation and screenshots must name the exact verified commit and must never claim an unbuilt state was exercised.

## Screenshots

| | |
|---|---|
| ![Automation preferences with global and account-level schedules](docs/assets/screenshots/material-automation.png) | ![Git-backed notification centre](docs/assets/screenshots/material-notification-center.png) |
| **Automation** — guarded commit/push and pull schedules with layered overrides | **Notifications** — unread state, history, restore, and cleanup |
| ![History search and commit graph](docs/assets/screenshots/material-history-power-tools.png) | ![Merge all branches dialog](docs/assets/screenshots/material-branch-merge-all.png) |
| **History power tools** — commit search, filters, and ancestry graph | **Merge all** — branches/worktrees with per-target progress |
| ![Agent access preferences](docs/assets/screenshots/material-agent-access.png) | ![GitLab and Bitbucket provider accounts](docs/assets/screenshots/material-provider-accounts.png) |
| **Agent access** — opt-in loopback MCP/REST with bearer-token controls | **Provider accounts** — GitHub, GitLab, Bitbucket, and self-hosted endpoints |
| ![Open repository and worktree in a new window](docs/assets/screenshots/material-multi-window-menu.png) | ![Live Settings history side sheet](docs/assets/screenshots/settings-history-manager.png) |
| **Multi-window** — isolated repository/worktree windows and persisted tabs | **Settings history** — Git-backed timeline, diff, Undo, Redo, restore-to-point |
| ![Appearance settings at a requested 200% scale auto-fitted to 96%](docs/assets/screenshots/material-scale-200-autofit.png) | ![Desktop Material Changes view](docs/assets/screenshots/material-workspace-changes.png) |
| **200% auto-fit** — minimum-window dark-theme verification with no clipped controls | **Workspace shell** — Material navigation, toolbar, cards, and commit flow |

## Building

Full instructions live in [`docs/contributing/setup.md`](docs/contributing/setup.md). In short, with Node 24.15.0:

```
yarn && yarn build:dev && yarn start
```

## Project site & docs

- Project site: https://codingmachineedge.github.io/desktop-material/
- Wiki: https://github.com/codingmachineedge/desktop-material/wiki

## Credits & License

Desktop Material is built on [GitHub Desktop](https://github.com/desktop/desktop) (MIT), with feature-parity references from [desktop-plus](https://github.com/say25/desktop-plus) (MIT). Thanks to both projects and their contributors.

**[MIT](LICENSE)**

The MIT license grant is not for GitHub's trademarks, which include the logo designs. GitHub reserves all trademark and copyright rights in and to all GitHub trademarks. GitHub's logos include, for instance, the stylized Invertocat designs that include "logo" in the file title in the following folder: [logos](app/static/logos).

GitHub® and its stylized versions and the Invertocat mark are GitHub's Trademarks or registered Trademarks. When using GitHub's logos, be sure to follow the GitHub [logo guidelines](https://github.com/logos).
