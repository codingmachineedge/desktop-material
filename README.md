# Desktop Material

Desktop Material is an independent Material Design 3 (M3 Expressive) remake of [GitHub Desktop](https://github.com/desktop/desktop). It rebuilds the entire application shell around Material Design 3 while keeping GitHub Desktop's full Git workflow and the same underlying stack: [TypeScript](https://www.typescriptlang.org), [React](https://react.dev), [Electron](https://www.electronjs.org), and [Sass](https://sass-lang.com). This project is in active development.

<img
  width="1072"
  src="docs/assets/screenshots/material-workspace-changes.png"
  alt="Desktop Material workspace showing the Changes view: a left icon navigation rail, a floating pill toolbar with repository and branch chips, browser-like repository tabs, and a floating Material Design 3 card with tri-state checkboxes and a commit composer"
/>

![CI](https://github.com/codingmachineedge/desktop-material/actions/workflows/ci.yml/badge.svg?branch=main)

## Product scope

The complete M0–M19 roadmap is shipped on `main`. The compact status summary is
below; the implementation ledger is in [`PLAN.md`](PLAN.md), and detailed
acceptance receipts are in [`HANDOFF.md`](HANDOFF.md).

The post-M19 adaptive customization maintenance release described below is
shipped on `main`. Its exact production build, off-screen interaction review,
compact and zoomed layout checks, safety boundaries, and seven privacy-safe
captures are recorded in [`HANDOFF.md`](HANDOFF.md); the existing M0–M19
receipts remain historical evidence for their original releases. All current
maintenance acceptance items are complete.

**Material Design 3 Expressive shell**
- App-bar branding with an inline pill menu
- Left icon navigation rail — Changes (with a badge), History, Branches, Settings, and the account avatar
- A floating pill toolbar with repository and branch chips and a sync pill that shows an ahead badge; it measures the available lane and live ellipsis pressure, then moves Build & Run and, if needed, Commit & Push into an accessible **More** surface before labels clip
- Floating, radius-24 elevated workspace cards with an animated light/dark theme
- Full MD3 workspace surfaces: tri-state selection checkboxes, tonal status chips, token-based diff colors, an inverse-surface undo banner, and a redesigned welcome flow and blank slate
- A pure Material first-run Welcome task card and tonal workspace preview, paired with a Material 3 public landing page built from an expressive app bar, hero surface, principle cards, evidence gallery, and tonal calls to action

**Appearance customization**
- Twelve app defaults in **Settings → Appearance**: accent color, surface color, surface depth, interface font, code/diff font, animation, toolbar labels, toolbar density, repository-list density, tab density, tab width, and tab-close-button behavior
- App defaults are versioned with the active profile in its local Git history, so they follow the selected profile and participate in the existing settings-history workflow
- Six repository-only overrides in **Repository Settings → Appearance**: accent color, surface color, toolbar labels, toolbar density, tab density, and tab width. Each field can inherit **Use app default**; explicit values stay in the repository's local `.git/config` and are neither committed nor shared
- Toolbar measurement respects Icons only and compact density. Build & Run overflows first, followed by Commit & Push; widening the window or shortening a dynamic label restores the same mounted controls deterministically, while an open **More** surface remains stable until it closes

**Repository tabs**
- Browser-like repository tabs, per-account and bound to repos, with inline rename
- Per-tab title styling: bold/italic/underline, size, text color, background color, font family, and alignment, with curated palettes, recent colors, a custom picker, and one-click return to the default
- Keep the original **Close Tabs Containing…** regex workflow, or use the guarded inverse **Close all tabs except those containing…** action. The inverse matches a case-insensitive literal substring across the visible label, repository alias/name, and local path; live counts and a bounded preview make the result reviewable, and an empty or zero-match query cannot confirm
- Pin important tabs and arrange each pinned or unpinned group manually with drag-and-drop or named keyboard move actions. **Arrange tabs** also offers one-shot A→Z, Z→A, newest-opened, oldest-opened, **Needs attention first**, and **Clean first** sorts; the chosen order persists without continuously reshuffling as repository status changes

**Multi-account**
- Multiple accounts including multiple identities per host; per-account tabs, repos, and settings
- GitHub browser sign-in requests the bounded feature scopes used by the app: repository/user access, workflow-file updates, notifications, and read-only organization membership. Unrelated destructive and administrative OAuth scopes are intentionally excluded
- Browse complete GitHub organization repository lists, filter cloning by organization, and choose an organization when publishing
- Add GitLab accounts, including self-hosted endpoints, with a personal access token; add Bitbucket accounts with an app password, then browse and clone their repositories from the provider tab
- Select all repositories with a mixed-state checkbox, or opt in to automatically clone newly discovered repositories while the clone dialog remains open
- Clone a private repository from a generic HTTPS URL without a credential prompt when an eligible signed-in account matches the exact origin. Only authentication or repository-not-found ambiguity can try another exact-origin account; the successful account affinity is retained, while tokenless or stale tokenless bindings are skipped and missing, SSH, non-authentication, and cross-origin credentials never widen fallback
- The repository list can hide its automatically maintained Recent group from **Settings → Appearance**
- Repositories can be pinned from their context menu into a dedicated top group
- Provider triage consumes the same exact repository-account binding selected in Repository Settings. One valid matching identity can bind an unassigned repository; multiple matches require an explicit labelled choice; missing, stale, permission, and organization-SSO states route to the appropriate sign-in or account-management recovery without silently replacing a valid binding

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
- At the supported minimum window size, a requested 200% scale safely auto-fits below the requested maximum, keeping the title bar, navigation, Appearance controls, and footer visible without horizontal clipping; the latest P0 gate measured 94%, while the earlier screenshot below records a 96% viewport

**Per-repo `.gitignore` manager**
- Open **Repository → Manage .gitignore…** for a manager that auto-suggests templates from your repo's contents, a searchable catalog of ~19 templates grouped by category, one-click apply/remove, and a raw editor — all merged into marked, reversible sections

**One-click Build & Run**
- Auto-detects bounded, nested project roots and runnable profiles for Node/npm/yarn/pnpm/bun, Deno, Rust, Go, .NET, Python, Java/Kotlin, PHP, Ruby, Swift, Dart/Flutter, Elixir, Scala, Haskell, Zig, Make, and CMake; each choice shows its project folder so similarly named profiles are unambiguous
- Installs dependencies, builds, and runs the selected profile in one action, streaming output to an MD3 log panel with responsive wrapping and no clipped project names
- Auto-ignores build outputs (applies the matching `.gitignore` template + an artifacts section) before building
- Bounded auto-fix on failure, a per-repo Build & Run settings tab, bounded discovery of nested projects, and optional single-prompt UAC pre-elevation

**Automation and GitHub Actions**
- Configure scheduled commit-and-push and pull globally, override them per account or repository, and rely on safety guards that skip unsafe repositories and preserve draft commit messages
- Run commit-and-push immediately, or merge all branches/worktrees with per-target progress and Copilot-assisted conflict handling
- Browse GitHub Actions runs in the repository rail, filter by workflow/branch/event/status, re-run all or failed jobs, inspect jobs and steps, securely download and search logs, and dispatch workflows with inputs
- Cancel only queued, running, waiting, or pending workflow runs from a Material confirmation that identifies the exact workflow/run, ref, actor, and commit when available. The app revalidates repository, account, run identity, and cancellable status before one normal cancellation request, prevents duplicate submission, then refreshes until GitHub reports a terminal state

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
- Rebase the current branch onto a searched target through a reviewed current→target summary with ahead/behind context and a bounded commit preview. Fresh preflight state blocks dirty or conflicted repositories and ongoing operations, exact refs are revalidated before Git starts, conflicts remain in the existing continue/abort flow, and Desktop Material never force-pushes automatically
- Manage every named remote with guarded add/rename/update/default/remove operations, and inspect or create exact known client hooks through the effective `core.hooksPath` without displaying hook contents or absolute paths. Remote rows stack before their name, URL, and controls collapse below a readable width, and the Repository Tools workspace keeps its diagnostics and results vertically reachable at compact heights
- Add a submodule from **Repository settings → Submodules** through the same GitHub.com, Enterprise, URL, and GitLab/Bitbucket chooser used for cloning. The reviewed flow keeps exact-account credential affinity, validates a safe empty repository-relative path and optional branch, streams bounded progress, and offers real cancellation before refreshing the submodule list
- Pin, hide, solo, and restore branch visibility; preview exact merge-tree conflict paths before a merge changes the worktree
- Triage bounded Issue and pull-request summaries for the exact selected GitHub, GitLab, or Bitbucket account/repository, including explicit provider-unavailable, unsupported, partial, and capped states

**Guided GitHub workflows**
- Compose pull requests with repository templates and metadata, then inspect, update, review, close/reopen, or merge the exact reviewed pull request through a fail-closed lifecycle
- Browse paginated Actions artifacts, download with bounded redirect and digest checks, and inspect the effective rules that apply to the current branch
- Browse and manage GitHub Releases and assets with bounded transfers; browse, search, filter, inspect, edit, comment on, close, or reopen Issues through repository/account-bound review state

**Fully Material, everywhere**
- The remaining stock surfaces — tooltips, menus, banners, autocomplete popups, segmented controls, split-buttons, dialog internals, History/CI surfaces — are re-tinted through the Material token system in both light and dark themes
- Compact-height dialogs and tools keep named actions reachable without page-level horizontal clipping. In particular, the Regex Builder reflows its category/token grid and scrolls its body while preserving the tester and footer, and the Remote Manager protects readable field/control widths before stacking

**Also shipped:** multi-clone with organization chips, parallel/sequential modes and URL-only import/export; one-click commit and push with a generated message; self-update checks against Desktop Material releases; SVG diff hardening and display controls; safer undo/reset/tag deletion confirmations; and responsive, keyboard-accessible MD3 surfaces throughout the app.

## Roadmap

The complete M0–M19 status, completed maintenance work, and acceptance rules now
live in [`ROADMAP.md`](ROADMAP.md). Detailed implementation and verification
receipts remain in [`PLAN.md`](PLAN.md) and [`HANDOFF.md`](HANDOFF.md).

## Screenshots

The compact selection below keeps this README scannable. The
[guided feature gallery](docs/wiki/Feature-Gallery.md) and
[task-oriented tutorial](docs/wiki/User-Guide.md) contain the full annotated
set.

| Material Welcome | Appearance customization | Dynamic toolbar overflow |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-welcome.png" alt="Pure Material first-run Welcome task card and tonal workspace preview" width="420"><br><sub>Material Welcome</sub> | <img src="docs/assets/screenshots/material-customization.png" alt="Appearance preferences with active-profile defaults and repository inheritance guidance" width="420"><br><sub>Profile and repository appearance</sub> | <img src="docs/assets/screenshots/material-toolbar-overflow.png" alt="Narrow app bar with lower-priority actions moved into the More surface before clipping" width="420"><br><sub>Measured More behavior</sub> |

| Word-style tab appearance | Arrange tabs | Actions cancellation | Reviewed rebase |
| --- | --- | --- | --- |
| <img src="docs/assets/screenshots/material-tab-appearance-word.png" alt="Word-style tab appearance editor with typography, alignment, and independent text and background palettes" width="320"><br><sub>Per-tab appearance</sub> | <img src="docs/assets/screenshots/material-tab-arrange.png" alt="Arrange tabs surface with pinned and manual movement controls plus one-shot label, opened-date, and repository-status sorts" width="320"><br><sub>Persistent tab order</sub> | <img src="docs/assets/screenshots/material-actions-cancel.png" alt="Material workflow-run cancellation review naming the exact run, ref, actor, and commit" width="320"><br><sub>Exact-run cancellation</sub> | <img src="docs/assets/screenshots/material-rebase-review.png" alt="Reviewed current-branch rebase showing current to target, ahead and behind counts, and a bounded commit preview" width="320"><br><sub>Rebase review</sub> |

| Repository workflows | GitHub workflows | Accessibility and shell |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-repository-tools.png" alt="Repository Tools administration hub" width="420"><br><sub>Repository Tools</sub> | <img src="docs/assets/screenshots/material-actions-cache-manager.png" alt="Actions cache manager" width="420"><br><sub>Actions caches</sub> | <img src="docs/assets/screenshots/material-scale-200-autofit.png" alt="Two hundred percent scale auto-fit without clipping" width="420"><br><sub>200% auto-fit</sub> |
| <img src="docs/assets/screenshots/material-pull-all-account-fallback.png" alt="Pull All results for several repositories" width="420"><br><sub>Pull All</sub> | <img src="docs/assets/screenshots/material-native-pull-request.png" alt="Native pull request creation" width="420"><br><sub>Pull requests</sub> | <img src="docs/assets/screenshots/material-workspace-changes.png" alt="Desktop Material Changes workspace" width="420"><br><sub>Material workspace</sub> |
| <img src="docs/assets/screenshots/material-stash-manager.png" alt="Repository-wide stash manager" width="420"><br><sub>Stash manager</sub> | <img src="docs/assets/screenshots/material-github-issues.png" alt="GitHub issue detail and lifecycle controls" width="420"><br><sub>Issues</sub> | <img src="docs/assets/screenshots/material-responsive-overflow-fixed.png" alt="Responsive workspace without horizontal clipping" width="420"><br><sub>Responsive clipping gate</sub> |

<details>
<summary><strong>Open 30 more verified screenshots</strong></summary>

| Clone and checkout | Repository administration | Accounts and automation |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-clone-account-fallback.png" alt="Exact-origin account fallback clone" width="360"><br><sub>Account-aware clone</sub> | <img src="docs/assets/screenshots/add-submodule-dialog.png" alt="Clone-style Add Submodule dialog reviewing a synthetic URL, checkout path, and tracked branch" width="360"><br><sub>Clone-style submodules</sub> | <img src="docs/assets/screenshots/material-remote-manager.png" alt="Named remote manager" width="360"><br><sub>Remote manager</sub> |
| <img src="docs/assets/screenshots/material-shallow-clone-safe.png" alt="Reviewed shallow clone" width="360"><br><sub>Shallow clone</sub> | <img src="docs/assets/screenshots/material-gitignore-manager.png" alt="Gitignore template manager" width="360"><br><sub>Gitignore manager</sub> | <img src="docs/assets/screenshots/material-automation.png" alt="Automation settings" width="360"><br><sub>Automation</sub> |
| <img src="docs/assets/screenshots/material-sparse-checkout-safe.png" alt="Reviewed sparse checkout" width="360"><br><sub>Sparse checkout</sub> | <img src="docs/assets/screenshots/material-history-deepening.png" alt="Full history after deepening" width="360"><br><sub>History deepening</sub> | <img src="docs/assets/screenshots/material-agent-access.png" alt="Local agent access settings" width="360"><br><sub>Agent access</sub> |
| <img src="docs/assets/screenshots/material-branches-sheet.png" alt="Branches side sheet" width="360"><br><sub>Branches</sub> | <img src="docs/assets/screenshots/material-repositories-sheet.png" alt="Repositories side sheet" width="360"><br><sub>Repositories</sub> | <img src="docs/assets/screenshots/material-multi-window-menu.png" alt="Open repository in a new window" width="360"><br><sub>Multi-window</sub> |
| <img src="docs/assets/screenshots/material-history-power-tools.png" alt="History search and graph" width="360"><br><sub>History search</sub> | <img src="docs/assets/screenshots/material-branch-merge-all.png" alt="Merge all progress" width="360"><br><sub>Merge All</sub> | <img src="docs/assets/screenshots/material-notification-center.png" alt="Notification centre" width="360"><br><sub>Notifications</sub> |
| <img src="docs/assets/screenshots/regex-builder.png" alt="Block-based regular expression builder" width="360"><br><sub>Regex builder</sub> | <img src="docs/assets/screenshots/settings-history-manager.png" alt="Settings history side sheet" width="360"><br><sub>Settings history</sub> | <img src="docs/assets/screenshots/material-settings.png" alt="Material settings dialog" width="360"><br><sub>Settings</sub> |

| Pull requests and rules | Actions | Releases, issues, and providers |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-create-pull-request.png" alt="Create pull request success" width="360"><br><sub>Create pull request</sub> | <img src="docs/assets/screenshots/material-actions-job-log.png" alt="Searchable Actions job log" width="360"><br><sub>Job log</sub> | <img src="docs/assets/screenshots/material-github-releases.png" alt="GitHub Releases workspace" width="360"><br><sub>Releases</sub> |
| <img src="docs/assets/screenshots/material-effective-branch-rules.png" alt="Effective branch rules" width="360"><br><sub>Branch rules</sub> | <img src="docs/assets/screenshots/material-actions-artifact-download.png" alt="Actions artifact download and digest" width="360"><br><sub>Artifact download</sub> | <img src="docs/assets/screenshots/material-provider-triage.png" alt="Provider-neutral triage" width="360"><br><sub>Provider triage</sub> |
| <img src="docs/assets/screenshots/material-actions-pending-deployments.png" alt="Pending deployment review" width="360"><br><sub>Deployment review</sub> | <img src="docs/assets/screenshots/material-actions-pagination.png" alt="Actions run pagination" width="360"><br><sub>Run pagination</sub> | <img src="docs/assets/screenshots/material-github-notifications.png" alt="GitHub notifications" width="360"><br><sub>GitHub notifications</sub> |
| <img src="docs/assets/screenshots/material-actions-jobs-pagination.png" alt="Attempt-aware Actions jobs" width="360"><br><sub>Attempt-aware jobs</sub> | <img src="docs/assets/screenshots/material-actions-artifact-page-two.png" alt="Actions artifact page two" width="360"><br><sub>Artifact pagination</sub> | <img src="docs/assets/screenshots/material-actions-artifacts.png" alt="Actions artifact provenance details" width="360"><br><sub>Artifact provenance</sub> |

</details>

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
