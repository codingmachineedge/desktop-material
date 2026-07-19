# Desktop Material

Desktop Material is an independent Material Design 3 (M3 Expressive) remake of [GitHub Desktop](https://github.com/desktop/desktop). It rebuilds the entire application shell around Material Design 3 while keeping GitHub Desktop's full Git workflow and the same underlying stack: [TypeScript](https://www.typescriptlang.org), [React](https://react.dev), [Electron](https://www.electronjs.org), and [Sass](https://sass-lang.com). This project is in active development.

<img
  width="1072"
  src="docs/assets/screenshots/material-app-identity-workspace.png"
  alt="Desktop Material workspace with a profile-customized app name and logo, a favorite repository tab, the Material navigation rail, and the Changes view"
/>

![CI](https://github.com/codingmachineedge/desktop-material/actions/workflows/ci.yml/badge.svg?branch=main)

## Product scope

The complete M0–M21 roadmap is shipped on `main`. The compact status summary is
below; the implementation ledger is in [`PLAN.md`](PLAN.md), and detailed
acceptance receipts are in [`HANDOFF.md`](HANDOFF.md).

The M20 platform wave and earlier post-M19 adaptive customization maintenance
release described below are shipped on `main`. Their exact production build,
off-screen interaction review, compact and zoomed layout checks, safety
boundaries, and seven privacy-safe captures are recorded in
[`HANDOFF.md`](HANDOFF.md); the existing M0–M19 receipts remain historical
evidence for their original releases. The July 18–19 temporary-submodule
navigation and delivery-hardening changes have completed ten-pass off-screen
local acceptance, post-build child/Back regression, a final duplicate Open/Back
race regression, and owned headless-resource cleanup. The earlier accepted
exact MCP build returned zero in 215.38 seconds (217 seconds wall time). After
the later stale-parent correction, the same MCP command rebuilt the renderer,
but its client stream detached before returning a receipt; the resulting fresh
bundle passed the final off-screen race regression. The full local gate passed
237 focused checks, 66 temporary-context lifecycle checks, 32 localization
checks, all 562 unit-test files (3,986 passing tests and one skipped), and 16
script tests, plus TypeScript, lint, and workflow validation. The first
implementation commit (`751c9aef`) exposed a macOS arm64 error-ordering defect
and correctly produced no release. Its focused correction (`98d93ccc`) passed
the full [CI matrix](https://github.com/codingmachineedge/desktop-material/actions/runs/29696805239)
and [CodeQL](https://github.com/codingmachineedge/desktop-material/actions/runs/29696805243),
then published the immutable [Windows release `v3.6.3-beta3-b0000000165`](https://github.com/codingmachineedge/desktop-material/releases/tag/v3.6.3-beta3-b0000000165).
The detailed Pages, wiki, asset, and cleanup receipts are maintained in
[`HANDOFF.md`](HANDOFF.md).

**Advanced Git and collaboration workflows (M21)**

- Keep multiple provider identities bound to the right repository; pin, hide,
  filter, and switch large repository sets; search current-branch or all-ref
  History; inspect remote-only commits; and run a reviewed pull/fetch batch
  across an exact repository subset
- Review and create pull requests without leaving the app: inspect files in a
  tree, expand diff context, comment, reply, resolve, approve, request changes,
  edit metadata, inspect checks, receive activity notifications, and safely
  check out an exact branch or commit from another fork
- Stash only selected files, name and manage multiple stashes—including stashes
  created outside Desktop Material—and manage the complete local/remote tag
  lifecycle with reviewed destructive operations and recovery receipts
- Compare CSV/TSV data structurally, preview TGA images, open files through a
  broader editor catalog or WSL, work with network/WSL repository paths, manage
  the global ignore file, import/export patch series, run allowlisted custom Git
  command presets, and delete reviewed local branches in bulk
- Browse live GitHub Projects and a bounded last-known-good offline cache, while
  retaining existing Copilot commit-message controls and one-click editor
  actions. The [30-item demand ledger](docs/features/github-desktop-demand-backlog.md)
  links each request to its behavior, safety boundary, and verification contract

**Material Design 3 Expressive shell**
- App-bar branding with an inline pill menu
- Left icon navigation rail — Changes (with a badge), History, Branches, Settings, and the account avatar
- A floating pill toolbar with repository and branch chips, a small colour-coded CI result on the current branch, and a sync pill that shows an ahead badge; it measures the available lane and live ellipsis pressure, then moves Build & Run and, if needed, Commit & Push into an accessible **More** surface before labels clip
- Floating, radius-24 elevated workspace cards with an animated light/dark theme
- Full MD3 workspace surfaces: tri-state selection checkboxes, tonal status chips, token-based diff colors, an inverse-surface undo banner, and a redesigned welcome flow and blank slate
- A pure Material first-run Welcome task card and tonal workspace preview, paired with a Material 3 public landing page built from an expressive app bar, hero surface, principle cards, evidence gallery, and tonal calls to action

**Appearance customization**
- Seventeen app defaults in **Settings → Appearance**: accent color, update-progress color, surface color, surface depth, interface font, code/diff font, animation, toolbar labels, toolbar density, repository-list density, tab density, tab width, tab-close-button behavior, language mode, the temporary-submodule Back style and label, and opt-in Desktop Material feature highlighting. The thin top-edge bar appears only while an app update is downloading and defaults to the active accent color
- Choose an explicit, persisted language mode: **English**, respectful and playful
  **Hong Kong Cantonese**, or a compact **Bilingual** presentation. English is
  the safe fallback; Desktop Material does not silently replace the selection
  from the Windows locale
- Customize the temporary-submodule Back control as **Tonal**, **Filled accent**,
  or **Outlined**, with **Back to parent**, the parent repository name, or an
  icon-only presentation whose accessible name still identifies the destination
- **Highlight Desktop Material features** is off by default. Turn it on to add a non-animated accent edge and an `M` or **Material** badge to explicitly classified fork-only navigation, repository-tab tools, notifications, toolbar, menu, and command entry points; upstream and mixed GitHub Desktop controls stay neutral
- A live **App identity** editor for the in-app logo, app name, logo geometry/border/shadow, colors, font, width, weight, case, size, spacing, opacity, emphasis, highlight, and text effects. Identity follows the active profile and restores across restart; signed binaries and the operating-system icon remain unchanged
- A safe vector **Custom repository logo** studio with presets, editable mark/text layers, colors, transforms, live preview, undo/redo, bounded JSON import/export, a profile default, and per-repository inheritance. The resolved design follows the repository into its tab and repository-list row; executable/raw SVG is never stored
- App defaults are versioned with the active profile in its local Git history, so they follow the selected profile and participate in the existing settings-history workflow
- Six repository-only overrides in **Repository Settings → Appearance**: accent color, surface color, toolbar labels, toolbar density, tab density, and tab width. Each field can inherit **Use app default**; explicit values stay in the repository's local `.git/config` and are neither committed nor shared
- Toolbar measurement respects Icons only and compact density. Build & Run overflows first, followed by Commit & Push; widening the window or shortening a dynamic label restores the same mounted controls deterministically, while an open **More** surface remains stable until it closes

**Repository tabs**
- Browser-like repository tabs, per-account and bound to repos, with inline rename
- Per-tab title styling: bold/italic/underline, size, text color, background color, font family, and alignment, with curated palettes, recent colors, a custom picker, and one-click return to the default
- Mark tabs as favorites, drag a repository folder onto the app to open or switch its tab, and export or import the current ordered tab session with pins, favorites, aliases, and per-tab appearance
- Keep the original **Close Tabs Containing…** regex workflow, or use the guarded inverse **Close all tabs except those containing…** action. The inverse matches a case-insensitive literal substring across the visible label, repository alias/name, and local path; live counts and a bounded preview make the result reviewable, and an empty or zero-match query cannot confirm
- Pin important tabs and arrange each pinned or unpinned group manually with drag-and-drop or named keyboard move actions. **Arrange tabs** also offers one-shot A→Z, Z→A, newest-opened, oldest-opened, repository-status, and favorites-first/last sorts; the chosen order persists without continuously reshuffling as repository status changes
- Use **Search tabs** to switch by name, alias, path, or clone URL, and narrow **Arrange tabs** with its literal multi-key filter without changing the all-tab scope of one-shot sorts

**Multi-account**
- Multiple accounts including multiple identities per host; per-account tabs, repos, and settings
- GitHub browser sign-in requests the bounded feature scopes used by the app: repository/user access, workflow-file updates, notifications, and read-only organization membership. Unrelated destructive and administrative OAuth scopes are intentionally excluded
- Browse complete GitHub organization repository lists, filter cloning by organization, and choose an organization when publishing
- Add GitLab accounts, including self-hosted endpoints, with a personal access token; add Bitbucket accounts with an app password, then browse and clone their repositories from the provider tab
- Select all repositories with a mixed-state checkbox, or opt in to automatically clone only newly discovered repositories in the background. Auto-clone keeps the saved account/base-directory/mode policy and never opens an unsolicited progress dialog
- Pause and resume pending multi-clones, including after restart or an interrupted process. A bounded atomic recovery journal revalidates the exact destination, usable clean worktree, `HEAD`, and matching origin without deleting occupied folders; failed/review-required queues remain visible until explicitly dismissed
- Switching clone accounts clears stale repository selection and validation, reloads the exact account catalog, and keeps its latest async result from being overwritten by an older account/path check
- Clone a private repository from a generic HTTPS URL without a credential prompt when an eligible signed-in account matches the exact origin. Only authentication or repository-not-found ambiguity can try another exact-origin account; the successful account affinity is retained, while tokenless or stale tokenless bindings are skipped and missing, SSH, non-authentication, and cross-origin credentials never widen fallback
- The repository list can hide its automatically maintained Recent group from **Settings → Appearance**
- Filter the cloned-repository list independently by its exact bound account and provider service; local-only, unavailable-account, and unknown/signed-out scopes are explicit instead of inferred from a host name
- Repositories can be pinned from their context menu into a dedicated top group
- Provider triage consumes the same exact repository-account binding selected in Repository Settings. One valid matching identity can bind an unassigned repository; multiple matches require an explicit labelled choice; missing, stale, permission, and organization-SSO states route to the appropriate sign-in or account-management recovery without silently replacing a valid binding

**Versioned settings & history**
- Per-account settings stored in a local git repo — every settings/tabs change auto-commits. Open **Edit → Settings History…** (`Ctrl+Alt+Z`) for a non-modal timeline with lazy diffs, undo, redo, and restore; each history action adds an audit commit instead of rewriting history
- Right-click appropriate shell and repository surfaces for a direct customization route plus the exact owning profile or local repository history context; specialized editing/context menus retain priority
- Right-click a History commit—or press the row's named **More actions** control, Context Menu key, or `Shift+F10`—for the same selection-aware reset, checkout, reorder, revert, branch, tag, cherry-pick, copy, and provider actions

**Non-modal dialog framework**
- Dialogs float without blocking the app, drag by their headers, cascade, and can be brought to front — the app stays fully interactive behind an open dialog
- Preferences rebuilt as an MD3 940×660 dialog with a left rail, an Active chip, and a pill footer
- Repository and branch pickers are MD3 side sheets; the clone dialog is restyled to match
- Acknowledgement-only application errors default to dismissible red notices at the bottom right; choose traditional blocking dialogs in **Settings → Notifications**, while errors that require a decision, retry, sign-in, or remediation always remain dialogs. An error that names the affected repository's stale `.git/index.lock` offers a scoped **Remove lock file** action after Desktop confirms the repository is idle and the lock is old and unchanged

**Notification centre**
- A bell and right-hand side sheet backed by its own local git repo — search by title, message, or repository metadata; filter by event type; select all visible results; bulk mark read/unread or delete; and visibly confirm **Clear all**, with every change recoverable from Git-backed history
- Switch to a separate live GitHub inbox for any signed-in GitHub.com or Enterprise account; every available 50-item API page is fetched automatically with no 200-item display ceiling. Filter unread/all and participating threads, search titles/repositories/types/reasons, select visible results, open only validated provider links, bulk mark read/done, or confirm **Clear all** for the complete fetched inbox; partial failures remain visible for retry and remote threads are never copied into the local log

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
- Turn a validated REST catalog request or named GraphQL operation into a profile-backed **App function** from the API rail. Functions are bound to the exact repository, provider, and account; read functions extend the local MCP/REST agent catalog, while mutation functions always return to the visible review step

**Power-user history, stashes, and windows**
- Search History by title, message, tag, or hash and toggle a lane graph that visualizes commit ancestry
- Use the repository-wide Stash Manager to create, inspect, apply, pop, rename, branch from, or delete an exact stash while retaining partial-failure context
- Pull every repository from the repositories sheet with per-repository results; an ambiguous HTTPS authentication or not-found response can retry every remaining token-bearing signed-in account for that exact origin without displaying an identity or token
- Deepen or unshallow a repository from History/Repository Tools with the same exact-origin Desktop credential trampoline and bounded signed-in-account recovery when the default credential is rejected
- Use repository pinning/grouping, branch presets/default-branch controls, and per-repository editor overrides
- Add, lock, move, rename, repair, remove, or prune worktrees, and open repositories or worktrees in separate windows with isolated per-window selection and persisted tabs

**Guided Git and provider administration**
- Exchange reviewed patch series, rewrite local commits from an explicit plan, configure commit/tag signing, administer Git LFS, and run bounded guided bisect sessions from named Repository Tools panels. Release-backed cheap LFS adaptively DEFLATE-compresses each upload part when that saves at least 1%, leaves already-compressed data raw, and transparently verifies/restores the original bytes
- Rebase the current branch onto a searched target through a reviewed current→target summary with ahead/behind context and a bounded commit preview. Fresh preflight state blocks dirty or conflicted repositories and ongoing operations, exact refs are revalidated before Git starts, conflicts remain in the existing continue/abort flow, and Desktop Material never force-pushes automatically
- Manage every named remote with guarded add/rename/update/default/remove operations, and inspect or create exact known client hooks through the effective `core.hooksPath` without displaying hook contents or absolute paths. Remote rows stack before their name, URL, and controls collapse below a readable width, and the Repository Tools workspace keeps its diagnostics and results vertically reachable at compact heights
- Save a credential-vault-backed SSH working copy in **Repository Settings → Remote** and optionally deploy Docker Compose after this app successfully pushes its matching remote. The remote checkout must be on the pushed branch: Desktop Material fetches that exact branch, permits only a fast-forward merge, then runs `docker compose up --detach --build`; branch mismatches and non-fast-forward updates fail without resetting or force-checking out the server. Public site hosting remains explicit server configuration: point DNS at that SSH host and configure its reverse proxy, TLS certificate, and container port outside Desktop Material
- Add a submodule from **Repository settings → Submodules** through the same GitHub.com, Enterprise, URL, and GitLab/Bitbucket chooser used for cloning. The reviewed flow keeps exact-account credential affinity, validates a safe empty repository-relative path and optional branch, streams bounded progress, and offers real cancellation before refreshing the submodule list
- Open any initialized submodule from the Submodule Manager as a temporary repository in the current workspace. It is not added to the repository list, Recent group, or persisted last selection; a profile-customizable Back control returns to the root repository that opened it. Stale, uninitialized, invalid-Git, traversal, sibling-prefix, and symlink/junction escape targets fail without importing anything
- Pin, hide, solo, and restore branch visibility; preview exact merge-tree conflict paths before a merge changes the worktree
- Triage bounded Issue and pull-request summaries for the exact selected GitHub, GitLab, or Bitbucket account/repository, including explicit provider-unavailable, unsupported, partial, and capped states

**Guided GitHub workflows**
- Compose pull requests with repository templates and metadata, then inspect, update, review, close/reopen, or merge the exact reviewed pull request through a fail-closed lifecycle
- Browse paginated Actions artifacts, download with bounded redirect and digest checks, and inspect the effective rules that apply to the current branch
- Use the repository Releases dashboard to compare loaded, stable, prerelease, and draft counts; search and status-filter the catalog; inspect authors, dates, targets, asset types, digests, and download totals; create reviewed releases publicly in one operation or save them as drafts; and keep bounded edit, publish, delete, upload, and download workflows. Browse, search, filter, inspect, edit, comment on, close, or reopen Issues through repository/account-bound review state
- Use the repository-contextual GitHub API Explorer, bound to the selected account and provider host, to search all 1,206 REST operations, isolate exactly the 10 additions since the prior pinned 2026-03-10 catalog, switch between REST and GraphQL, review mutations before they run, and inspect bounded, credential-redacted responses

**Fully Material, everywhere**
- The remaining stock surfaces — tooltips, menus, banners, autocomplete popups, segmented controls, split-buttons, dialog internals, History/CI surfaces — are re-tinted through the Material token system in both light and dark themes
- Every button now exposes a shared hover and keyboard-focus hint derived from its explicit help text, accessible name, or visible label; icon-only native buttons mounted later by dialogs and virtualized views receive the same non-native tooltip treatment
- Compact-height dialogs and tools keep named actions reachable without page-level horizontal clipping. In particular, the Regex Builder reflows its category/token grid and scrolls its body while preserving the tester and footer, and the Remote Manager protects readable field/control widths before stacking
- The exhaustive responsive gate inventories every repository rail page, preferences tab, repository-settings tab, clone tab, nested API/File History/notification surface, and safe menu dialog, then proves true-bottom reachability at desktop, minimum, narrow, short, wide, 125%, 150%, and minimum-window 200% scenarios

**Also shipped:** multi-clone with organization chips, parallel/sequential modes and URL-only import/export; one-click commit and push with a generated message; self-update checks against Desktop Material releases; SVG diff hardening and display controls; safer undo/reset/tag deletion confirmations; and responsive, keyboard-accessible MD3 surfaces throughout the app.

## Roadmap

The complete M0–M20 status, completed maintenance work, and acceptance rules now
live in [`ROADMAP.md`](ROADMAP.md). Detailed implementation and verification
receipts remain in [`PLAN.md`](PLAN.md) and [`HANDOFF.md`](HANDOFF.md).

## Screenshots

The compact selection below keeps this README scannable. The
[guided feature gallery](docs/wiki/Feature-Gallery.md) and
[task-oriented tutorial](docs/wiki/User-Guide.md) contain the full annotated
set.

| Custom app identity | Material Welcome | Appearance customization | Dynamic toolbar overflow |
| --- | --- | --- | --- |
| <img src="docs/assets/screenshots/material-app-identity-workspace.png" alt="Workspace with a customized in-app logo and name plus a favorite repository tab" width="320"><br><sub>Profile app identity</sub> | <img src="docs/assets/screenshots/material-welcome.png" alt="Pure Material first-run Welcome task card and tonal workspace preview" width="320"><br><sub>Material Welcome</sub> | <img src="docs/assets/screenshots/material-customization.png" alt="Appearance preferences with explicit language mode and temporary-submodule Back button style and label controls" width="320"><br><sub>Language and navigation</sub> | <img src="docs/assets/screenshots/material-toolbar-overflow.png" alt="Narrow app bar with lower-priority actions moved into the More surface before clipping" width="320"><br><sub>Measured More behavior</sub> |

| Word-style tab appearance | Arrange tabs | Actions cancellation | Reviewed rebase |
| --- | --- | --- | --- |
| <img src="docs/assets/screenshots/material-tab-appearance-word.png" alt="Word-style tab appearance editor with typography, alignment, and independent text and background palettes" width="320"><br><sub>Per-tab appearance</sub> | <img src="docs/assets/screenshots/material-tab-arrange.png" alt="Arrange tabs surface with pinned and manual movement controls plus one-shot label, opened-date, and repository-status sorts" width="320"><br><sub>Persistent tab order</sub> | <img src="docs/assets/screenshots/material-actions-cancel.png" alt="Material workflow-run cancellation review naming the exact run, ref, actor, and commit" width="320"><br><sub>Exact-run cancellation</sub> | <img src="docs/assets/screenshots/material-rebase-review.png" alt="Reviewed current-branch rebase showing current to target, ahead and behind counts, and a bounded commit preview" width="320"><br><sub>Rebase review</sub> |

| Repository workflows | GitHub workflows | Accessibility and shell |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-repository-tools.png" alt="Repository Tools administration hub" width="420"><br><sub>Repository Tools</sub> | <img src="docs/assets/screenshots/material-actions-cache-manager.png" alt="Actions cache manager" width="420"><br><sub>Actions caches</sub> | <img src="docs/assets/screenshots/material-scale-200-autofit.png" alt="Two hundred percent scale auto-fit without clipping" width="420"><br><sub>200% auto-fit</sub> |
| <img src="docs/assets/screenshots/material-pull-all-account-fallback.png" alt="Pull All results for several repositories" width="420"><br><sub>Pull All</sub> | <img src="docs/assets/screenshots/material-native-pull-request.png" alt="Native pull request creation" width="420"><br><sub>Pull requests</sub> | <img src="docs/assets/screenshots/material-workspace-changes.png" alt="Desktop Material Changes workspace" width="420"><br><sub>Changes workspace</sub> |
| <img src="docs/assets/screenshots/material-stash-manager.png" alt="Repository-wide stash manager" width="420"><br><sub>Stash manager</sub> | <img src="docs/assets/screenshots/material-github-issues.png" alt="GitHub issue detail and lifecycle controls" width="420"><br><sub>Issues</sub> | <img src="docs/assets/screenshots/material-responsive-overflow-fixed.png" alt="Responsive workspace without horizontal clipping" width="420"><br><sub>Responsive clipping gate</sub> |

| Runtime tab search | History commit actions | Repository Tools at the true bottom |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-tab-search.png" alt="Runtime repository-tab search matching the active local fixture by name and path" width="420"><br><sub>Search and switch tabs</sub> | <img src="docs/assets/screenshots/material-history-context-actions.png" alt="History commit row with its named More actions control and hover hint" width="420"><br><sub>Right-click and keyboard-equivalent actions</sub> | <img src="docs/assets/screenshots/material-repository-tools-scroll.png" alt="Short Repository Tools workspace scrolled to its reachable final results surface" width="420"><br><sub>Verified bottom reachability</sub> |

| Complete GitHub API Explorer |
| --- |
| <img src="docs/assets/screenshots/material-github-api-explorer.png" alt="Repository-contextual GitHub API Explorer with a searchable REST catalog, REST and GraphQL request builder, and bounded redacted response" width="720"><br><sub>1,206 REST operations · exactly 10 new since the prior pinned 2026-03-10 catalog · reviewed mutations</sub> |

| Custom repository-logo studio | Named API app functions |
| --- | --- |
| <img src="docs/assets/screenshots/material-repository-logo-studio.png" alt="Layered custom repository-logo studio with live preview, undo and redo, safe JSON transfer, and repository inheritance" width="520"><br><sub>Safe vector layers · profile default · repository override</sub> | <img src="docs/assets/screenshots/material-api-app-functions.png" alt="Named API app functions extending the selected repository through reviewed REST and GraphQL definitions" width="520"><br><sub>Versioned definitions · exact binding · reviewed execution</sub> |

| Temporary submodule repository navigation |
| --- |
| <img src="docs/assets/screenshots/material-submodule-context.png" alt="Initialized submodule opened temporarily in the workspace with a context bar and Back control to the persisted root repository" width="720"><br><sub>No repository import · customizable Back control · root return</sub> |

<details>
<summary><strong>Open 30 more verified screenshots</strong></summary>

| Clone and checkout | Repository administration | Accounts and automation |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-clone-account-fallback.png" alt="Exact-origin account fallback clone" width="360"><br><sub>Account-aware clone</sub> | <img src="docs/assets/screenshots/add-submodule-dialog.png" alt="Clone-style Add Submodule dialog reviewing a synthetic URL, checkout path, and tracked branch" width="360"><br><sub>Clone-style submodules</sub> | <img src="docs/assets/screenshots/material-remote-manager.png" alt="Named remote manager" width="360"><br><sub>Remote manager</sub> |
| <img src="docs/assets/screenshots/material-shallow-clone-safe.png" alt="Reviewed shallow clone" width="360"><br><sub>Shallow clone</sub> | <img src="docs/assets/screenshots/material-gitignore-manager.png" alt="Gitignore template manager" width="360"><br><sub>Gitignore manager</sub> | <img src="docs/assets/screenshots/material-automation.png" alt="Automation settings" width="360"><br><sub>Automation</sub> |
| <img src="docs/assets/screenshots/material-sparse-checkout-safe.png" alt="Reviewed sparse checkout" width="360"><br><sub>Sparse checkout</sub> | <img src="docs/assets/screenshots/material-history-deepening.png" alt="Full history after deepening" width="360"><br><sub>History deepening</sub> | <img src="docs/assets/screenshots/material-agent-access.png" alt="Local agent access settings" width="360"><br><sub>Agent access</sub> |
| <img src="docs/assets/screenshots/material-branches-sheet.png" alt="Branches side sheet" width="360"><br><sub>Branches</sub> | <img src="docs/assets/screenshots/material-repositories-sheet.png" alt="Repositories side sheet" width="360"><br><sub>Repositories</sub> | <img src="docs/assets/screenshots/material-multi-window-menu.png" alt="Open repository in a new window" width="360"><br><sub>Multi-window</sub> |
| <img src="docs/assets/screenshots/material-history-power-tools.png" alt="History search and graph" width="360"><br><sub>History search</sub> | <img src="docs/assets/screenshots/material-branch-merge-all.png" alt="Merge all progress" width="360"><br><sub>Merge All</sub> | <img src="docs/assets/screenshots/material-notification-bulk-actions.png" alt="Filtered Local notification centre with visible selection and bulk actions" width="360"><br><sub>Bulk notification triage</sub> |
| <img src="docs/assets/screenshots/regex-builder.png" alt="Block-based regular expression builder" width="360"><br><sub>Regex builder</sub> | <img src="docs/assets/screenshots/settings-history-manager.png" alt="Settings history side sheet" width="360"><br><sub>Settings history</sub> | <img src="docs/assets/screenshots/material-error-notice.png" alt="Bottom-right Git lock error notice with a Remove lock file recovery action" width="360"><br><sub>Stale-lock recovery</sub> |

| Pull requests and rules | Actions | Releases, issues, and providers |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-create-pull-request.png" alt="Create pull request success" width="360"><br><sub>Create pull request</sub> | <img src="docs/assets/screenshots/material-actions-job-log.png" alt="Searchable Actions job log" width="360"><br><sub>Job log</sub> | <img src="docs/assets/screenshots/material-github-releases.png" alt="Releases dashboard with status summary and selected release metadata" width="360"><br><sub>Releases dashboard</sub> |
| <img src="docs/assets/screenshots/material-effective-branch-rules.png" alt="Effective branch rules" width="360"><br><sub>Branch rules</sub> | <img src="docs/assets/screenshots/material-actions-artifact-download.png" alt="Actions artifact download and digest" width="360"><br><sub>Artifact download</sub> | <img src="docs/assets/screenshots/material-provider-triage.png" alt="Provider-neutral triage" width="360"><br><sub>Provider triage</sub> |
| <img src="docs/assets/screenshots/material-actions-pending-deployments.png" alt="Pending deployment review" width="360"><br><sub>Deployment review</sub> | <img src="docs/assets/screenshots/material-actions-pagination.png" alt="Actions run pagination" width="360"><br><sub>Run pagination</sub> | <img src="docs/assets/screenshots/material-github-notifications.png" alt="GitHub notifications" width="360"><br><sub>GitHub notifications</sub> |
| <img src="docs/assets/screenshots/material-actions-jobs-pagination.png" alt="Attempt-aware Actions jobs" width="360"><br><sub>Attempt-aware jobs</sub> | <img src="docs/assets/screenshots/material-actions-artifact-page-two.png" alt="Actions artifact page two" width="360"><br><sub>Artifact pagination</sub> | <img src="docs/assets/screenshots/material-actions-artifacts.png" alt="Actions artifact provenance details" width="360"><br><sub>Artifact provenance</sub> |

</details>

## Install on Windows

Desktop Material's automated releases currently provide a per-user x64 Windows
installer. Run this one line in Windows PowerShell 5.1 or PowerShell 7; it does
not require an administrator shell:

```powershell
Microsoft.PowerShell.Utility\Invoke-RestMethod 'https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/script/install-windows.ps1' | Microsoft.PowerShell.Utility\Invoke-Expression
```

The [tracked installer script](script/install-windows.ps1) asks GitHub for this
exact repository's newest published release, accepts only the installer for the
native architecture, verifies its release-asset size and GitHub SHA-256 digest,
checks any Authenticode signature, runs the Squirrel installer silently with
`/S`, and removes its controlled temporary directory. The current release
workflow publishes unsigned x64 builds, so the script reports that status and
stops on ARM64 until an ARM64 asset is available. Review the script before
running any remote command, or use the
[latest release page](https://github.com/codingmachineedge/desktop-material/releases/latest)
for a manual download.

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
