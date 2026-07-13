# Desktop Material

Desktop Material is an independent Material Design 3 (M3 Expressive) remake of [GitHub Desktop](https://github.com/desktop/desktop). It rebuilds the entire application shell around Material Design 3 while keeping GitHub Desktop's full Git workflow and the same underlying stack: [TypeScript](https://www.typescriptlang.org), [React](https://react.dev), [Electron](https://www.electronjs.org), and [Sass](https://sass-lang.com). This project is in active development.

<img
  width="1072"
  src="docs/assets/screenshots/material-workspace-changes.png"
  alt="Desktop Material workspace showing the Changes view: a left icon navigation rail, a floating pill toolbar with repository and branch chips, browser-like repository tabs, and a floating Material Design 3 card with tri-state checkboxes and a commit composer"
/>

![CI](https://github.com/codingmachineedge/desktop-material/actions/workflows/ci.yml/badge.svg?branch=main)

## Shipped today

The complete M0–M19 roadmap is live on `main`. Exact app source
`5e80e678d062b65a82c0991b352e5a861c7469e5` passed the reproducible production
build and isolated hidden-desktop interaction gate. Documentation and the exact
14-image acceptance set were published in `main` union
`a890ab579c63651e5089ee433b259f0fc9198fbf`; final code/release baseline
`a0c2f19433631d577979c8c8a88a5151f5ab0656` passed all seven jobs in
[CI 29274841990](https://github.com/codingmachineedge/desktop-material/actions/runs/29274841990)
and published the verified public
[b0000000083 release](https://github.com/codingmachineedge/desktop-material/releases/tag/v3.6.3-beta3-b0000000083).
The corresponding Pages deployment, canonical wiki, screenshot hashes,
privacy scan, artifact purge, and owned-resource cleanup are complete.

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
- Clone a private repository from a generic HTTPS URL without a credential prompt when an eligible signed-in account matches the exact origin. Only authentication or repository-not-found ambiguity can try another exact-origin account; the successful account affinity is retained, while tokenless or stale tokenless bindings are skipped and missing, SSH, non-authentication, and cross-origin credentials never widen fallback
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
- Browse GitHub Actions runs in the repository rail, filter by workflow/branch/event/status, re-run all or failed jobs, inspect jobs and steps, securely download and search logs, and dispatch workflows with inputs

**Agent access and command line**
- Enable an opt-in, token-gated local agent server from **Settings → Agent access**; it exposes MCP and REST on a random loopback-only port and never returns account credentials
- Use the bundled stdio proxy or command-line client to list accounts/repos/tabs, inspect status, clone, commit, fetch/pull/push, manage branches/tabs, run automation, and dispatch workflows

**Power-user history, stashes, and windows**
- Search History by title, message, tag, or hash and toggle a lane graph that visualizes commit ancestry
- Use the repository-wide Stash Manager to create, inspect, apply, pop, rename, branch from, or delete an exact stash while retaining partial-failure context
- Pull every repository from the repositories sheet with per-repository results; an ambiguous HTTPS authentication or not-found response can retry every remaining token-bearing signed-in account for that exact origin without displaying an identity or token
- Deepen or unshallow a repository from History/Repository Tools with the same exact-origin Desktop credential trampoline and bounded signed-in-account recovery when the default credential is rejected
- Use repository pinning/grouping, branch presets/default-branch controls, and per-repository editor overrides
- Add, lock, move, rename, repair, remove, or prune worktrees, and open repositories or worktrees in separate windows with isolated per-window selection and persisted tabs

**Guided Git and provider administration**
- Exchange reviewed patch series, rewrite local commits from an explicit plan, configure commit/tag signing, administer Git LFS, and run bounded guided bisect sessions from named Repository Tools panels
- Manage every named remote with guarded add/rename/update/default/remove operations, and inspect or create exact known client hooks through the effective `core.hooksPath` without displaying hook contents or absolute paths
- Pin, hide, solo, and restore branch visibility; preview exact merge-tree conflict paths before a merge changes the worktree
- Triage bounded Issue and pull-request summaries for the exact selected GitHub, GitLab, or Bitbucket account/repository, including explicit provider-unavailable, unsupported, partial, and capped states

**Guided GitHub workflows**
- Compose pull requests with repository templates and metadata, then inspect, update, review, close/reopen, or merge the exact reviewed pull request through a fail-closed lifecycle
- Browse paginated Actions artifacts, download with bounded redirect and digest checks, and inspect the effective rules that apply to the current branch
- Browse and manage GitHub Releases and assets with bounded transfers; browse, search, filter, inspect, edit, comment on, close, or reopen Issues through repository/account-bound review state

**Fully Material, everywhere**
- The remaining stock surfaces — tooltips, menus, banners, autocomplete popups, segmented controls, split-buttons, dialog internals, History/CI surfaces — are re-tinted through the Material token system in both light and dark themes

**Also shipped:** multi-clone with organization chips, parallel/sequential modes and URL-only import/export; one-click commit and push with a generated message; self-update checks against Desktop Material releases; SVG diff hardening and display controls; safer undo/reset/tag deletion confirmations; and responsive, keyboard-accessible MD3 surfaces throughout the app.

## Roadmaps

These are living delivery roadmaps for Desktop Material. **Implementation done**
means the named source, focused regressions, and review fixes are committed and
pushed. **Acceptance done** is a separate closing state that additionally
requires the exact production build, off-screen interaction, inspected
identity-safe screenshots, exhaustive repository gates, and published `main`
evidence.

Last updated: **July 13, 2026**. The current closing checklist is the
[guided final-gate run manifest](.codex/run-manifests/2026-07-13-guided-final-gate.md);
the earlier inventory and proof history remains in the
[Git, GitHub, and GitKraken parity manifest](.codex/run-manifests/2026-07-12-git-gh-interactive-audit.md).

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
| **Shipped** | Expand audited Git capabilities as named functions | Exact app source `5e80e678…` was production-built and exercised off-screen across shallow clone/deepening, sparse checkout, Repository Tools, Stash Manager, Remote Manager, and cross-account recovery; final `a0c2f194…` CI/release evidence is green |
| **Shipped** | Expand named GitHub and provider functions on hardened transports | Exact app source `5e80e678…` was exercised against a synthetic loopback provider across native PR creation, Actions logs/artifacts, Releases, Issues, and provider triage; the exact public evidence is recorded in `HANDOFF.md` |
| **Done** | Complete the official GitKraken Desktop history comparison | Official surviving 0.6–6.0 posts plus 7.x–12.3 release archives were deduplicated into current-app coverage, implementable local gaps, and explicitly separated proprietary/cloud services |
| **Done** | Build and interactively verify representative changed UI off-screen | Exact app source `5e80e678…` passed the MCP production build and final hidden-desktop clone/Pull All/deepen plus Foundation/P0/P1/Later interactions. All 14 clean accepted frames come from that exact build and are recorded in PLAN/HANDOFF |
| **Published** | Refresh README, wiki, Pages, and screenshot evidence | Union `a890ab579c…`, Pages run `29272714314`, wiki commit `9f9c8010c8…`, and all 40 raw-main/Pages PNG comparisons are verified; final code/release evidence is `a0c2f19433…` |

### Capability roadmap

| Area | Implemented in the integration tree | Final acceptance evidence | Long-tail access |
|---|---|---|---|
| **Git** | Core repository/branch/commit/diff workflows plus file history/blame/restore, signature audit, shallow clone/deepening, sparse checkout, archives, bundles, patch series, structured local-commit rewrite, signing, LFS, complete worktree administration, branch visibility, merge-tree conflict paths, guided bisect, Stash Manager, Remote Manager, and Repository Hooks Manager | Exact-build interaction at `5e80e678…`; final Windows/macOS CI and release at `a0c2f194…` | Fixed, audited Git recipes power named task controls; there is no raw command search/editor |
| **GitHub** | Account-scoped Notifications; guided Issue and pull-request creation; complete PR template/metadata/review/update/close/reopen/merge lifecycle; Actions runs/logs/mutations/artifact pagination and bounded download/digest handling; effective branch rules; Releases/assets; and richer Issues | Synthetic exact-account interaction at `5e80e678…`; exact-`main` CI/release at `a0c2f194…` | `gh`, REST, and GraphQL may back provider-scoped functions internally; users see purpose-built forms, previews, confirmations, and results |
| **Providers** | Exact-account GitHub/GitLab/Bitbucket repository triage with bounded Issue/PR projections, filters, attention buckets, safe links, and explicit unsupported/partial/capped/error states | Synthetic provider-triage interaction plus published responsive screenshots and exact-`main` gates are complete. Bitbucket Issues remain explicitly unsupported | Provider APIs remain adapters behind one neutral task surface; raw payloads, tokens, and repository paths are not retained |
| **GitKraken parity references** | Graph, diff, history/blame, commit/stash/branch/remote/worktree flows, shallow/sparse controls, tabs, provider accounts, themes, search, automation, multi-window work, hooks/signing, richer PR/Issues triage, and conflict preview are represented by native guided functions | Validate the final responsive union and document any future independently selected local capability | Proprietary GitKraken cloud, enterprise, AI, and collaboration services remain reference points, not copied services, branding, or assets |

### Native parity waves

| Priority | Guided app functions | State |
|---|---|---|
| **Delivered foundation** | Repository status/health/maintenance/reflog tools; file history/blame and restore; bounded shallow clone/deepening; sparse checkout; source archives; full bundle export/verify/import; Notifications; and guided Issue creation | **SHIPPED** |
| **P0** | Native pull-request compose plus templates/metadata/review/update/close/reopen/merge; Actions artifact redirect hardening, pagination, bounded download/digest/attestation context; effective branch rules | **SHIPPED** |
| **P1** | Patch-series export/import; structured local-commit rewrite; Releases/assets; commit/tag signing; Git LFS; complete worktree lifecycle administration | **SHIPPED** |
| **P2** | Persisted branch pin/hide/solo/restore controls | **SHIPPED** |
| **Later** | Exact merge-tree conflict preview; guided bisect; complete Stash and Remote Managers; Repository Hooks Manager; richer GitHub Issues; provider-neutral triage | **SHIPPED** |
| **Reference only** | GitKraken Cloud Workspaces/Patches, Team presence, Launchpad sync, Insights, Code Review service, shared AI credits, organization policy, and on-prem commercial services | **Not copied** |

### Verification roadmap

- Do not require sideways scrolling in page or dialog shells wherever responsive wrapping or stacking can preserve usability. Horizontal scrolling is reserved for intrinsically spatial code, diff, and log surfaces.
- Verify desktop and minimum supported windows, 50–200% UI scaling, light/dark themes, long repository/branch/host names, destructive confirmations, keyboard focus, and screen-reader labels.
- Commit and push each coherent milestone. Documentation and screenshots must name the exact verified commit and must never claim an unbuilt state was exercised.

#### Closing evidence checklist

- [x] Record accepted app source `5e80e678d062b65a82c0991b352e5a861c7469e5` and its successful exact MCP production build; repeat exhaustive repository gates after the documentation/image union is final.
- [x] Exercise that exact production bundle on one isolated off-screen desktop, including deterministic cross-account clone recovery and representative Foundation/P0/P1/Later surfaces.
- [x] Inspect all 14 synthetic-only exact-`5e80e678…` capture candidates at original resolution and record dimensions, bytes, and SHA-256; promote only those exact files with the final documentation union.
- [x] Merge the accepted tree to `main`; verify CI `29274841990`, Pages `29272714314`, wiki `9f9c8010c8…`, installer `29274842059`, public release `v3.6.3-beta3-b0000000083`, and every downloaded asset digest.
- [x] Verify owned processes, desktops, credentials, fixtures, worktrees, and temporary roots are removed; leave `main` clean and equal to `origin/main`, Actions enabled, and the artifact inventory empty.

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
| ![Appearance settings at a requested 200% scale auto-fitted to 96%](docs/assets/screenshots/material-scale-200-autofit.png) | ![Responsive regression proof at 1450 by 997 showing the toolbar and Changes controls fully contained with no horizontal overflow](docs/assets/screenshots/material-responsive-overflow-fixed.png) |
| **200% auto-fit** — minimum-window dark-theme verification with no clipped controls | **Responsive fit** — 1450×997 proof that toolbar and Changes controls fit without horizontal overflow |
| ![Shallow-clone controls using a synthetic repository](docs/assets/screenshots/material-shallow-clone-safe.png) | ![Synthetic generic HTTPS clone completed through another exact-origin signed-in account](docs/assets/screenshots/material-clone-account-fallback.png) |
| **Shallow clone** — bounded depth and submodule controls | **Clone fallback** — token-bearing exact-origin recovery, persisted affinity, no credential prompt |
| ![Pull all repositories showing a synthetic repository pulled through another signed-in account](docs/assets/screenshots/material-pull-all-account-fallback.png) | ![Cone-mode sparse-checkout review using synthetic paths](docs/assets/screenshots/material-sparse-checkout-safe.png) |
| **Pull All fallback** — every eligible exact-origin account can be tried without exposing identity | **Sparse checkout** — validated repository-relative directories and explicit review |
| ![History deepening completed through another signed-in account](docs/assets/screenshots/material-history-deepen.png) | ![Guarded Remote Manager using synthetic remotes](docs/assets/screenshots/material-remote-manager.png) |
| **History deepening** — deepen/unshallow through the Desktop credential trampoline | **Remote Manager** — reviewed add, rename, update, default, and remove operations |
| ![Repository-wide Stash Manager using a synthetic repository](docs/assets/screenshots/material-stash-manager.png) | ![Synthetic GitHub Actions job log in the searchable in-app viewer](docs/assets/screenshots/material-actions-job-log.png) |
| **Stash Manager** — exact-stash create, inspect, apply, pop, branch, rename, and delete | **Actions logs** — safe redirects, search, groups, and stale-response protection |
| ![Actions artifact with local digest verification](docs/assets/screenshots/material-actions-artifact-download.png) | ![Synthetic GitHub release and asset management](docs/assets/screenshots/material-github-releases.png) |
| **Actions artifacts** — bounded download, computed digest, and attestation context | **Releases** — reviewed release and arbitrary-asset transfers |
| ![Synthetic GitHub issue detail and comment](docs/assets/screenshots/material-github-issues.png) | ![Provider-neutral synthetic issue and pull-request triage](docs/assets/screenshots/material-provider-triage.png) |
| **GitHub Issues** — bounded search, metadata, comments, close, and reopen | **Provider triage** — exact-account GitHub, GitLab, and Bitbucket projections |
| ![Named guarded Git tools for a synthetic repository](docs/assets/screenshots/material-repository-tools.png) | ![Native pull request created against a synthetic loopback provider](docs/assets/screenshots/material-native-pull-request.png) |
| **Repository Tools** — named bounded Git workflows without a raw command surface | **Native pull request** — template and metadata review with a synthetic success receipt |

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
