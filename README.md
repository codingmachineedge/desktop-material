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

These are living delivery roadmaps for the active `mega-feature-update` branch. An item moves to **Done** only after its implementation and focused checks are committed and pushed. UI milestones additionally require an off-screen production build, interactive exercise, and inspected screenshots before the evidence and documentation tasks can be marked done.

Last updated: **July 12, 2026**. The detailed, reproducible evidence ledger is the [Git, GitHub, and GitKraken parity run manifest](.codex/run-manifests/2026-07-12-git-gh-interactive-audit.md).

### Delivery roadmap

| Status | Milestone | Completion evidence |
|---|---|---|
| **Done** | Inventory the installed Git 2.55 and GitHub CLI 2.96 command trees | Complete command catalogs are parsed at runtime rather than maintained as a stale hard-coded list |
| **Done** | Inventory the official GitHub REST and GraphQL surfaces | REST baseline: 790 paths, 1,196 operations, and 51 categories; GraphQL baseline: 32 query fields and 268 mutation fields |
| **Done** | Add a bounded CLI execution foundation | `git`/`gh` only, no shell, repository-bound working directory, output/input limits, cancellation, ownership cleanup, credential-command blocking, and bundled-Git environment support |
| **Done** | Add safe request contracts for a GitHub API workbench | Selected-host relative paths, traversal rejection, mutation confirmation, bounded streamed responses, safe-header allowlisting, and deep credential redaction |
| **Done** | Extend native Actions controls | Run/job reruns, normal and force cancellation, workflow enable/disable, confirmations, and responsive long-metadata containment |
| **Done** | Remove known compact-layout sideways overflow | Settings, floating surfaces, repository rail, toolbar, Merge All, Pull All, Build & Run, Actions, and screenshot gallery now wrap, stack, clamp, or vertically scroll at compact sizes |
| **Active** | Expose the CLI foundation through an interactive Workbench | Searchable live catalog, safe previews, risk labels, destructive confirmation, streaming output, input, cancel, keyboard access, and repository refresh |
| **Active** | Harden GitHub transport and expose the API foundation interactively | Current GitHub.com API versioning, credential/header precedence, REST operation picker, GraphQL document mode, permissions/rate limits, pagination, cancellation, and destructive confirmation |
| **Active** | Complete the official GitKraken Desktop history comparison | Deduplicated 0.x–12.x feature matrix, current-app coverage, implementable local features, and clearly separated proprietary/cloud services |
| **Blocked — environment** | Build and interactively verify every changed UI off-screen | The exact headless verifier passes preflight, but this checkout has no installed root dependencies or `cross-env`; the mandated no-download gate therefore refuses to launch an unbuilt app |
| **Queued after build** | Refresh README, wiki, Pages, and screenshot evidence | Capture at desktop and compact widths, inspect original pixels for clipping/overlap/oversized text, record hashes, then publish the same verified state |

### Capability roadmap

| Area | Available now | Next native interactive milestones | Long-tail access |
|---|---|---|---|
| **Git** | Core repository, branch, commit, diff, history, stash, remote, worktree, merge, rebase, fetch/pull/push, automation, and guarded cleanup workflows | Archive/bundle and patch exchange; richer blame/file history; signature verification; reflog recovery and repository health; complete remote/worktree/stash administration; bisect, sparse/shallow, range-diff, notes, grep, and config tools | The repository-bound CLI Workbench keeps the full installed `git` catalog reachable with explicit argv and risk review |
| **GitHub CLI** | Native repository, pull-request reading, Actions browsing/logs/dispatch/rerun/cancel, account, organization, clone, fork, and publish foundations | Notifications; complete issue and PR authoring/review/merge; releases/assets; labels/milestones; rulesets/settings/collaborators; Actions artifacts/caches/runners/secrets/variables/environments; Projects and Discussions | The CLI Workbench keeps the full installed `gh` catalog reachable while blocking credential-revealing commands |
| **GitHub REST and GraphQL** | Account-scoped API layer plus safe Workbench request/confirmation/redaction contracts | Version and permission awareness; schema-driven REST; parsed GraphQL queries/mutations; rate limits; bounded pagination; security, deployment, Pages, organization, team, and administration surfaces | The API Workbench will cover supported operations without arbitrary hosts, token fields, shell execution, or unrestricted headers |
| **GitKraken parity references** | Graph, diff, commit/stash/branch/remote/worktree flows, repository tabs, provider accounts, themes, search, automation, multi-window work, and many Material-native productivity tools | Evaluate blame/history, editor and terminal workflows, undo/redo breadth, shallow/sparse controls, branch pin/filter/activity, Gitflow/hooks/signing, richer PR/issues/Launchpad-style triage, conflict prevention, and agent-session worktrees | Proprietary GitKraken cloud, enterprise, AI, and collaboration services remain reference points, not copied services, branding, or assets |

### Verification roadmap

- Keep page and dialog shells free of horizontal scrolling wherever responsive wrapping or stacking can preserve usability; only bounded code, diff, log, and JSON panes may scroll sideways.
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
