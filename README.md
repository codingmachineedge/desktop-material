# Desktop Material

Desktop Material is an independent Material Design 3 (M3 Expressive) remake of [GitHub Desktop](https://github.com/desktop/desktop). It rebuilds the entire application shell around Material Design 3 while keeping GitHub Desktop's full Git workflow and the same underlying stack: [TypeScript](https://www.typescriptlang.org), [React](https://react.dev), [Electron](https://www.electronjs.org), and [Sass](https://sass-lang.com). This project is in active development.

> **Platform support:** Desktop Material is a Windows-only application. Windows
> x64 is the installer and portable-ZIP target; Windows x64/arm64 builds and
> Windows packaged E2E are the supported CI gates. macOS and Linux application
> packages are not produced or supported.

<img
  width="1072"
  src="docs/assets/screenshots/material-app-identity-workspace.png"
  alt="Desktop Material workspace with a profile-customized app name and logo, a favorite repository tab, the Material navigation rail, and the Changes view"
/>

![CI](https://github.com/Ding-Ding-Projects/desktop-material/actions/workflows/ci.yml/badge.svg?branch=main)

## Product scope

The numbered roadmap now extends through M27. M0–M21 and M23 have published
receipts, M22 retains its separately tracked visual refresh, and the exact
acceptance/publication state for M24–M27 is maintained in
[`ROADMAP.md`](ROADMAP.md). The July 22 feature continuation is published at
`f7b4760a13`: [CI `29972351158`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29972351158),
[code scanning `29972351173`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29972351173),
and [Build Installers `29973527338`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29973527338)
passed before the exact-target Windows release
[`v3.6.3-beta3-b0000040887`](https://github.com/Ding-Ding-Projects/desktop-material/releases/tag/v3.6.3-beta3-b0000040887)
published with all six required assets.

Cross-lane updater recovery is now published and installed. Commits
[`241cc90`](https://github.com/Ding-Ding-Projects/desktop-material/commit/241cc90ce90f240bad075edac7ebe43eea515df8)
and
[`04246fdf`](https://github.com/Ding-Ding-Projects/desktop-material/commit/04246fdf12c09446b88d2f40130581d603131c8e)
gave automatic and Super Express packages one alphabetic `z…` namespace that
sorts above legacy `b…`/`s…` builds without overflowing Squirrel's comparer.
[CI `29977738533`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29977738533),
[Build Installers `29978844761`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29978844761),
and
[Super Express `29980281736`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29980281736)
succeeded on exact source `04246fdf12`; a live legacy `s000000000201` install
automatically migrated, then visibly downloaded the greater same-SHA
`zadtbhvdfc` package and reached **Quit and Install Update**.

The July 23 Cheap LFS, batched-push, and responsive Releases continuation is
now published through corrective source
[`c22e29a03a`](https://github.com/Ding-Ding-Projects/desktop-material/commit/c22e29a03ac14b01e35ab7b1434fa288bc794307).
Exact-source CI `30055965807`, code scanning `30055965809`, Pages
`30055965817`, and cloud-compression run `30055965804` passed. Installer run
[`30057456712`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/30057456712)
then published the immutable six-asset exact-target Windows Release
[`v3.6.3-beta3-zadthusbjk`](https://github.com/Ding-Ding-Projects/desktop-material/releases/tag/v3.6.3-beta3-zadthusbjk).

The public
[`codingmachineedge/bambu-build`](https://github.com/codingmachineedge/bambu-build)
acceptance exercised **14,809,588,162 bytes across 8,305 files**, including ten
Cheap LFS pointers, through four UI-created and exact-SHA-proven batches. An
HTTP 408 left the first pending commit durable; the UI retry pushed that same
immutable SHA before continuing. Cloud run
[`30048474438`](https://github.com/codingmachineedge/bambu-build/actions/runs/30048474438)
reported **13 compressed, 0 kept raw, and 0 failed**, while retaining all 13
raw originals beside the 13 compressed assets. Final UI commit
[`712ad85`](https://github.com/codingmachineedge/bambu-build/commit/712ad85f92f9002474f0f13b6bb6991153d586af)
passed verifier run
[`30054805137`](https://github.com/codingmachineedge/bambu-build/actions/runs/30054805137)
and published its immutable manifest Release. A fresh UI clone restored all
ten logical hashes while Git retained 370–514-byte pointer blobs. Its first
automatic/manual materialization overlap produced two hash-identical CAS
recovery copies and prompted repository-scoped serialization; the exact final
corrected acceptance receipt remains in [`HANDOFF.md`](HANDOFF.md).

The persistent, visible/collapsible tab-group chips; localized command-palette
rows and appearance controls; deterministic bare-Alt menu sequencing; and
unit/script gates before Super Express packaging are included in the published
`f7b4760a13` checkpoint above. Its exact unpackaged production build and
isolated off-screen group/palette interaction passed, and the two accepted
synthetic-only captures appear below. The implementation ledger is in
[`PLAN.md`](PLAN.md), with exact publication evidence in
[`HANDOFF.md`](HANDOFF.md).

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
  History; inspect remote-only commits; preview an ordinary manual pull after
  a successful fetch; and run a reviewed pull/fetch batch across an exact
  repository subset
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

**Local Ollama model lifecycle (M23)**

- Add an **Ollama (local)** provider in **Settings → Copilot → Providers**, then
  open its purpose-built **Manage models** workspace without writing native API
  requests
- Inspect endpoint health/version, installed and running inventories, searchable
  model details, runtime allocation, capabilities, and bounded metadata with
  separate unavailable and partial states
- Pull with streamed progress and cancellation; copy or guarded-rename a model;
  load or unload it; and delete only after confirming the exact model name
- Synchronize Ollama's installed inventory back to that provider's selectable
  Copilot models. Management requires an exact loopback `/v1` base and derives
  only fixed native `/api/*` routes; remote HTTP/HTTPS hosts, arbitrary
  prefixes, credentials, queries, and fragments are rejected. The complete
  workspace follows English, playful Hong Kong Cantonese, or bilingual mode.
  See the
  [feature guide](docs/features/integrations/ollama-model-manager.md)

The accepted off-screen manager capture is a privacy-safe synthetic scene at
1452×1001. Its full health, inventory, search, running-state, pull cancellation
and rollback, completed pull, copy, rename, load, unload, confirmed-delete, and
provider-sync exercise is recorded in [`HANDOFF.md`](HANDOFF.md).

**Material Design 3 Expressive shell**
- App-bar branding with an inline pill menu
- Left icon navigation rail — Changes (with a badge), History, Branches, Settings, and the account avatar
- A floating pill toolbar with repository and branch chips, a small colour-coded CI result on the current branch, and a sync pill that shows an ahead badge; it measures the available lane and live ellipsis pressure, then moves Build & Run and, if needed, Commit & Push into an accessible **More** surface before labels clip
- Floating, radius-24 elevated workspace cards with an animated light/dark theme
- Full MD3 workspace surfaces: tri-state selection checkboxes, tonal status chips, token-based diff colors, an inverse-surface undo banner, and a redesigned welcome flow and blank slate
- A pure Material first-run Welcome task card and tonal workspace preview, paired with a Material 3 public landing page built from an expressive app bar, hero surface, principle cards, evidence gallery, and tonal calls to action

**Appearance customization**
- **Settings → Appearance** now contains only ordinary preferences such as language, theme, scale, repository-list behavior, branch sorting, formatting, and diff tab size. Custom visuals are never stuffed into a general Appearance page
- Choose an explicit, persisted language mode: **English**, respectful and playful
  **Hong Kong Cantonese**, or a compact **Bilingual** presentation. English is
  the safe fallback; Desktop Material does not silently replace the selection
  from the Windows locale
- Right-click an actual visual owner—or focus it and press `Shift+F10`—to open its editor beside that element. This covers the app identity/workspace, update bar, toolbar, repository list, tab strip, code/diff surface, individual Material feature entry points, each repository name/logo, each tab title, and the temporary-submodule Back control. Specialized Git context menus keep priority on their surrounding hit areas
- Every appearance owner has one versioned `setting.json` in its own local Git
  repository and its own **History** manager with lazy diffs, undo, redo, and
  restore. History actions append audit commits; the editor footer exposes the
  exact local path. Profile owners, feature IDs, repository instances, and tab
  instances never share a mutable timeline. A rapid slider/color burst persists
  only its latest normalized value before the existing commit debounce, while
  queued setting reads and History remain strict ordering barriers
- Repository-scoped workspace, toolbar, tab-strip, list-name, and logo values can inherit their profile owner. Toolbar appearance includes safe text color plus curated family, bounded size, emphasis, case, spacing, effect, and alignment controls; a repository can inherit those typography properties individually or clear its whole local layer. A local `desktop-material.appearance-id` UUID keeps those dedicated repositories stable when the working copy moves; the old aggregate config is migration/startup compatibility only
- The temporary-submodule Back owner offers **Tonal**, **Filled accent**, or **Outlined**, plus label choices. The vector repository-logo studio keeps bounded JSON import/export and safe code-native layers; an inherited row can jump to the profile default beside the same actual logo
- Toolbar measurement respects Icons only and compact density. Build & Run overflows first, followed by Commit & Push; widening the window or shortening a dynamic label restores the same mounted controls deterministically, while an open **More** surface remains stable until it closes

**Repository tabs**
- Browser-like repository tabs, per-account and bound to repos, with inline rename
- Per-tab title styling: right-click the actual title for bold/italic/underline, size, text color, background color, font family, and alignment, with curated palettes, recent colors, a custom picker, one-click return to default, and that tab's dedicated Git history. The clicked tab initializes before the editor opens; an in-progress profile transition gives localized retry guidance instead of escaping to the app crash boundary
- Collect tabs into named, curated-color groups. A visible chip before the first member shows its name, count, active state, and expanded/collapsed state; mouse, Enter, or Space really hides/restores the member tabs. Group actions, dialog copy, announcements, and accessible names follow English, playful Hong Kong-style Cantonese, or bilingual mode
- Group metadata persists across open/close and bulk-close operations, per-window reloads, profile history, and session imports. A group cannot cross the protected pinned/unpinned boundary. Deleting a group never closes its tabs
- Mark tabs as favorites, drag a repository folder onto the app to open or switch its tab, and export or import the current ordered tab session with pins, favorites, aliases, and per-tab appearance. Portable exports intentionally omit profile-local group definitions and `groupId` memberships, while import preserves the destination profile's existing groups
- Keep the original **Close Tabs Containing…** regex workflow, or use the guarded inverse **Close all tabs except those containing…** action. The inverse matches a case-insensitive literal substring across the visible label, repository alias/name, and local path; live counts and a bounded preview make the result reviewable, and an empty or zero-match query cannot confirm
- Pin important tabs and arrange each pinned or unpinned group manually with drag-and-drop or named keyboard move actions. Moving a member outside its named group ungroups only that tab; one-shot A→Z, Z→A, newest-opened, oldest-opened, repository-status, and favorites-first/last sorts keep every remaining named group together as one stable block. The chosen order persists without continuously reshuffling as repository status changes
- Use **Search tabs** to switch by name, alias, path, or clone URL, and narrow **Arrange tabs** with its literal multi-key filter without changing the all-tab scope of one-shot sorts

**Multi-account**
- Multiple accounts including multiple identities per host; per-account tabs, repos, and settings
- Repository-bound HTTPS Git fetch, pull, push, post-push refresh, scheduled
  sync, refspec fetch, and remote-HEAD discovery use the exact selected account.
  Background sync reuses a namespace- and target-validated local remote HEAD;
  an explicit fetch gives discovery five seconds and process-tree cleanup one
  final five-second grace window, so the advisory refresh has a ten-second hard
  settlement bound even when a child never reports closure. A renamed default
  is still discovered when the old branch exists. Concurrent callers share one
  in-flight system proxy lookup per URL instead of multiplying abandoned
  resolver work. Missing or invalid refs still perform one authenticated
  discovery. Legacy unbound organization repositories prefer a
  verified write-capable same-host identity, while a missing explicit binding
  fails closed instead of silently using another account
- GitHub browser sign-in requests the bounded feature scopes used by the app:
  repository/user access, workflow-file updates, notifications, read-only
  organization membership, and the `write:packages` grant used by the Cheap LFS
  GHCR path. Repository deletion, package deletion, and unrelated administrative
  scopes remain excluded; the registry documentation's PAT-classic-only caveat
  is recorded in the OCI feature guide
- Browse complete GitHub organization repository lists, filter cloning by organization, and choose an organization when publishing
- Add GitLab accounts, including self-hosted endpoints, with a personal access token; add Bitbucket accounts with an app password, then browse and clone their repositories from the provider tab
- Select all repositories with a mixed-state checkbox, or opt in to automatically clone only newly discovered repositories in the background. **Settings → Clone queue** keeps each signed-in account's base directory, parallel/sequential mode, and enabled state discoverable after the Clone dialog closes; auto-clone never opens an unsolicited progress dialog
- Pause and resume pending multi-clones, including after restart or an interrupted process. A bounded atomic recovery journal revalidates the exact destination, usable clean worktree, `HEAD`, and matching origin without deleting occupied folders; failed/review-required queues remain visible until explicitly dismissed
- Switching clone accounts clears stale repository selection and validation, reloads the exact account catalog, and keeps its latest async result from being overwritten by an older account/path check
- Clone a private repository from a generic HTTPS URL without a credential prompt when an eligible signed-in account matches the exact origin. Only authentication or repository-not-found ambiguity can try another exact-origin account; the successful account affinity is retained, while tokenless or stale tokenless bindings are skipped and missing, SSH, non-authentication, and cross-origin credentials never widen fallback
- The repository list can hide its automatically maintained Recent group from **Settings → Appearance**
- Filter the cloned-repository list independently by its exact bound account and provider service; local-only, unavailable-account, and unknown/signed-out scopes are explicit instead of inferred from a host name
- Repositories can be pinned from their context menu into a dedicated top group
- Provider triage consumes the same exact repository-account binding selected in Repository Settings. One valid matching identity can bind an unassigned repository; multiple matches require an explicit labelled choice; missing, stale, permission, and organization-SSO states route to the appropriate sign-in or account-management recovery without silently replacing a valid binding

**Versioned settings & history**
- Ordinary per-account settings remain in the profile Git repository and **Edit → Settings History…** (`Ctrl+Alt+Z`). Appearance and per-tab visual changes use the narrower element-local histories reached from their anchored editors
- Each appearance editor names and copies its exact local repository path; every element-local undo, redo, or restore appends an audit commit instead of rewriting history
- Right-click a History commit—or press the row's named **More actions** control, Context Menu key, or `Shift+F10`—for the same selection-aware reset, checkout, reorder, revert, branch, tag, cherry-pick, copy, and provider actions

**Non-modal dialog framework**
- Dialogs float without blocking the app, drag by their headers, cascade, and can be brought to front — the app stays fully interactive behind an open dialog
- Mouse-wheel and trackpad gestures scroll from anywhere over dialog content, with nested lists/editors retaining their own range and chaining to the outer body at an edge
- Preferences rebuilt as an MD3 940×660 dialog with a left rail, an Active chip, and a pill footer
- Repository and branch pickers are MD3 side sheets; the clone dialog is restyled to match
- Acknowledgement-only application errors default to dismissible red notices at the bottom right; choose traditional blocking dialogs in **Settings → Notifications**, while errors that require a decision, retry, sign-in, or remediation always remain dialogs. An error that names the affected repository's stale `.git/index.lock` offers a scoped **Remove lock file** action after Desktop confirms the repository is idle and the lock is old and unchanged
- GitHub sign-in and Git/SSH credential prompts use one recoverable FIFO, so
  concurrent host-key, passphrase, password, and generic authentication
  requests cannot be dropped by popup de-duplication

**Notification centre**
- A bell and right-hand side sheet backed by its own local git repo — search by title, message, or repository metadata; filter by event type; select all visible results; bulk mark read/unread or delete; and visibly confirm **Clear all**, with every change recoverable from Git-backed history
- Switch to a separate live GitHub inbox for any signed-in GitHub.com or Enterprise account; every available 50-item API page is fetched automatically with no 200-item display ceiling. Filter unread/all and participating threads, search titles/repositories/types/reasons, select visible results, open only validated provider links, bulk mark read/done, or confirm **Clear all** for the complete fetched inbox; partial failures remain visible for retry and remote threads are never copied into the local log

**Search everywhere, with a regex builder**
- Every search bar gains fuzzy / substring / regex filter modes, a case toggle, and per-list filter chips
- A full regex builder — anchors, character classes, quantifiers, groups, alternation, lookaround, all six flags, and a live tester — reachable from the search bars
- The `Ctrl+F` command palette uses wider, richer rows with a leading icon, title, optional search-term line, and localized group chip. Its anchored **Customize appearance** editor persists comfortable/compact density and independent icon/group/keyword visibility; Escape closes only the editor and restores toggle focus

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
- Installs dependencies, builds, and runs the selected profile in one action, streaming output to an MD3 log panel with a one-shot **Scroll to bottom** action, persisted auto-scroll that pauses when the user reads history, and persisted display-only long-line truncation that leaves the complete text available to **Copy all output**
- Auto-ignores build outputs (applies the matching `.gitignore` template + an artifacts section) before building
- Bounded auto-fix on failure through a per-repository choice of Codex CLI or OpenCode, stdin-only prompts, explicit install/auth/auto-approve consent, renderer-owned process-tree cancellation, and a Build & Run verification rerun unless **Stop** cancels it; plus a per-repo settings tab, bounded nested-project discovery, optional single-prompt UAC pre-elevation, and English, playful Hong Kong Cantonese, or bilingual labels

**Automation and GitHub Actions**
- Configure scheduled commit-and-push and pull globally, override them per account or repository, and rely on safety guards that skip unsafe repositories and preserve draft commit messages
- Run commit-and-push immediately, or merge all branches/worktrees with per-target progress and Copilot-assisted conflict handling
- Browse GitHub Actions runs in the repository rail, filter by workflow/branch/event/status, re-run all or failed jobs, inspect jobs and steps, securely download and search logs, and dispatch workflows with inputs
- Cancel only queued, running, waiting, or pending workflow runs from a Material confirmation that identifies the exact workflow/run, ref, actor, and commit when available. The app revalidates repository, account, run identity, and cancellable status before one normal cancellation request, prevents duplicate submission, then refreshes until GitHub reports a terminal state
- Dispatch **Build Installers / Express Release** from `main` when a release is urgent: lint, Windows x64 trampoline/unit/script tests, and packaging run in parallel, exact installed dependencies are content-cached, the complete installer payload is retained as a workflow artifact before publication, and one create-only command publishes deterministic exact-commit notes without replacing an existing tag
- Dispatch the separate **Super Express Release** workflow for an emergency fast lane: it runs the complete unit and script suites before building and packaging Windows x64, while skipping lint, E2E, and release-history generation. It restores the same exact dependency cache, writes notes from the checked-out commit, verifies every installer/feed asset, retains the complete payload, and publishes a uniquely versioned immutable Release for the exact dispatched `main` commit. Automatic and Super Express packages share one Squirrel-monotonic `z` version namespace, and only the greatest release for revalidated current `main` can own the update feed

**Agent access and command line**
- Enable an opt-in, token-gated local agent server from **Settings → Agent access**; it exposes MCP and REST on a random loopback-only port and never returns account credentials
- In **Paired LAN devices** mode, use **Open mobile connection page** to replace any old code and open a fresh five-minute, one-use pairing link in the default browser; the secret remains in the URL fragment and is never sent to the site server
- Use the bundled stdio proxy or command-line client to list accounts/repos/tabs, inspect status, clone, commit, fetch/pull/push, manage branches/tabs, run automation, and dispatch workflows
- Turn a validated REST catalog request or named GraphQL operation into a profile-backed **App function** from the API rail. Functions are bound to the exact repository, provider, and account; read functions extend the local MCP/REST agent catalog, while mutation functions always return to the visible review step

**Power-user history, stashes, and windows**
- Search History by title, message, tag, or hash and toggle a lane graph that visualizes commit ancestry
- Use the repository-wide Stash Manager to create, inspect, apply, pop, rename, branch from, or delete an exact stash while retaining partial-failure context
- Pull every repository from the repositories sheet with per-repository results; an ambiguous HTTPS authentication or not-found response can retry every remaining token-bearing signed-in account for that exact origin without displaying an identity or token
- Deepen or unshallow a repository from History/Repository Tools with the same exact-origin Desktop credential trampoline and bounded signed-in-account recovery when the default credential is rejected
- Use repository pinning/grouping, branch presets/default-branch controls, and per-repository editor overrides
- Add, lock, move, rename, repair, remove, or prune worktrees, and open repositories or worktrees in separate windows with isolated per-window selection and persisted tabs
- Choose **File → Add local repository → Auto-detect repositories…** to scan a parent folder with bounded, link-safe traversal, review the discovered Git repositories, and add them together

**Guided Git and provider administration**
- Manage cone-mode sparse checkout through a three-step **Choose/Adjust/Restore → Review selection → Apply and refresh** guide that remains visible above the scrolling editor and review content. State-aware guidance distinguishes empty, invalid, ready, running, and completed states; review freezes and shows every bounded normalized selection entry before Git updates and refreshes the worktree
- Exchange reviewed patch series, rewrite local commits from an explicit plan,
  configure commit/tag signing, administer Git LFS, and run bounded guided
  bisect sessions from named Repository Tools panels. The repository rail's
  direct **Large files** manager lists, searches, pins, and materializes
  Release- and OCI-backed Cheap LFS pointers. It owns the repository page's
  vertical scroll, so a long inventory stays reachable, and its direct
  **Open Cheap LFS settings** action opens **Repository settings → Build & run**.
  For Release storage, automatic
  uploads prefer the trusted, isolated `gh api` exact-range transport, avoiding
  Electron's crash-prone native upload pipe when GitHub CLI is available; the
  memory-bounded native path remains a compatibility fallback. Reconciliation
  scans up to 1,000 assets once then polls only an exact asset ID, fails closed
  on an incomplete asset, and retains the exact Release editor plus verified
  whole-batch drag/drop recovery. It reports throttled hash/staging progress,
  checks worst-case temporary space, polls cancelably for six hours, and creates
  ordered `.partNNN` range files above the per-asset limit. Flat case-safe
  assets map back to original nested paths; prerelease buckets hold at most
  1,000 assets without splitting a multipart file or manual batch; Materialize
  all shares one inventory per Release and verifies/reassembles original bytes
- Live public/private acceptance materialized and re-pinned deterministic 1 MiB payloads through the production Large files UI and native Windows picker, then pushed the resulting five-line pointers as real `main` history. See the [dated UI receipt](docs/verification/cheap-lfs-github-public-private-2026-07-22.md)
- Choose published-prerelease, GHCR, or Docker Hub Cheap LFS storage per
  repository. The OCI choices keep the full current object set in one logical
  image within explicit 4,096-object, 8,192-layer, and 8 MiB metadata proof
  bounds: additions and removals publish a new immutable manifest, reuse
  unchanged blobs, retention-tag every historical digest, and rewrite
  pointer-form files to the verified digest while leaving already materialized
  raw files intact. Existing Docker organization
  or collaborator namespaces are retained; verified materialized files can be
  migrated between GHCR and Docker Hub as a fresh full snapshot.
  Private-source chunks use AES-256-GCM with the intentionally tracked shared
  repository key; public OCI and public GitHub.com Release pointers can restore
  while signed out. Windows builds ship digest-pinned ORAS 1.3.2 plus its
  Apache-2.0 license; the ARM64 package currently runs that audited x64 binary
  through Windows 11 x64 emulation and fails closed if it cannot start. See
  [Cheap LFS OCI registry storage](docs/features/repository-management/cheap-lfs-oci-registry-backend.md)
- Automatic Cheap LFS preparation can run sequentially or with at most three
  files uploading at once. It cheap-stats the complete reviewed selection
  before content-proofing only oversized candidates, then shows per-file
  phases/bytes, worker and queue state, provider context, elapsed time,
  throughput, and ETA in a keyboard-accessible compact terminal below Commit.
  The panel also reports the selected-versus-recommended provider.
  Failed raw
  files stay selected for retry while unrelated changes and successful pointers
  may commit. The Changes filter can isolate files over the same 100 MiB
  threshold, and the default clone/open detector repairs both new and older
  pointer-only clones through verified local materialization. Private registry
  key validation accepts a Windows-hostile legacy path only when fresh Git
  status proves that exact selected path is deleted; a current unsafe path or a
  real OCI pointer in a control-plane path remains blocked
- When many ordinary small files approach a decimal 1.5 GB push, Desktop
  Material automatically creates and pushes commits with a conservative 1.4 GB
  changed-blob budget plus bounded path/proof overhead. It proves each
  fast-forward remote tip before creating the next commit, retains a durable
  retry checkpoint, and uses process-local no-delta/no-compression packing for
  only the immutable exact-SHA batch push so CPU-bound packing cannot strand an
  otherwise safe batch. Ordinary pushes and persistent Git configuration stay
  unchanged. It
  safely rebuilds an individually oversized, linear, clean local-only commit
  from an older app behind a compare-and-swap backup ref. Safe older commits
  retain their exact objects; a rebuilt oversized commit preserves its reviewed
  message/final tree but necessarily receives new IDs and loses commit
  signatures. See
  [Automatic commit and push batching](docs/features/repository-management/automatic-commit-push-batching.md)
- Use the primary toolbar or application-menu Pull action to fetch and review the exact current/upstream object IDs, ahead/behind state, configured integration route, and bounded incoming commits and files before Git changes a clean worktree. Confirmation revalidates the full reviewed OID and integrates it without a second fetch; a failed fetch cannot surface stale tracking data. English, playful Hong Kong Cantonese, and bilingual review copy follow the saved language mode, while scheduled and local-agent automation remain noninteractive. See [Reviewed ordinary Git pull previews](docs/features/repository-management/pull-previews.md)
- Rebase the current branch onto a searched target through a reviewed current→target summary with ahead/behind context and a bounded commit preview. Fresh preflight state blocks dirty or conflicted repositories and ongoing operations, exact refs are revalidated before Git starts, conflicts remain in the existing continue/abort flow, and Desktop Material never force-pushes automatically
- Manage every named remote with guarded add/rename/update/default/remove operations, and inspect or create exact known client hooks through the effective `core.hooksPath` without displaying hook contents or absolute paths. Remote rows stack before their name, URL, and controls collapse below a readable width, and the Repository Tools workspace keeps its diagnostics and results vertically reachable at compact heights
- Save a credential-vault-backed SSH working copy in **Repository Settings → Remote**, then Clone, inspect Status, Fetch, Pull, Push, or deploy Docker Compose. The paired remote site can list the same redacted host definitions and request a reviewed clone without receiving a password or key. Updates are fast-forward-only on the configured branch; Desktop never resets or force-checks out the host. Public site hosting remains explicit server configuration: point DNS at that SSH host and configure its reverse proxy, TLS certificate, and container port outside Desktop Material
- Add a submodule from **Repository settings → Submodules** through the same GitHub.com, Enterprise, URL, and GitLab/Bitbucket chooser used for cloning. The reviewed flow keeps exact-account credential affinity, validates a safe empty repository-relative path and optional branch, streams bounded progress, and offers real cancellation before refreshing the submodule list
- Open any initialized submodule with **Open temporary viewer**, or use the same action on a changed/new submodule commit card. The checked-out child opens read-only in the current workspace and is never added to the repository list, Recent group, or persisted last selection. The context bar provides both the customizable Back control and an obvious **Close viewer** action; either returns to the saved parent and clears temporary viewer state. The adjacent **Subtrees** tab embeds the full add, pull, push, and split manager. Stale, uninitialized, invalid-Git, traversal, sibling-prefix, and symlink/junction escape targets fail without importing anything
- Pin, hide, solo, and restore branch visibility; preview exact merge-tree conflict paths before a merge changes the worktree
- Triage bounded Issue and pull-request summaries for the exact selected GitHub, GitLab, or Bitbucket account/repository, including explicit provider-unavailable, unsupported, partial, and capped states

**Guided GitHub workflows**
- Compose pull requests with repository templates and metadata, then inspect, update, review, close/reopen, or merge the exact reviewed pull request through a fail-closed lifecycle
- Browse paginated Actions artifacts, download with bounded redirect and digest checks, and inspect the effective rules that apply to the current branch
- Use the repository Releases dashboard to compare loaded, stable, prerelease, and draft counts; search and status-filter its compact high-zoom catalog with an 800×560 small-screen gate proven at 100%, 125%, 150%, and 200%, readable size floors, and a wrapping English/Cantonese/bilingual tools disclosure; inspect authors, locale-aware 24-hour timestamps, targets, asset types, digests, and download totals; open a verified downloaded file or show it in Explorer; create reviewed releases publicly in one operation or save them as drafts; and keep bounded edit, publish, delete, upload, and download workflows. Browse, search, filter, inspect, edit, comment on, close, or reopen Issues through repository/account-bound review state
- Use the repository-contextual GitHub API functions surface, bound to the selected account and provider host, to run automatically added repository, issues, pull-request, release, and workflow actions as buttons; hide the API rail item when it is not needed, and reveal the full REST/GraphQL catalog only for advanced custom functions

### Responsiveness and resource lifecycle

- Reuse a valid local remote default during background sync; explicit fetches
  refresh it with a five-second bound so default-branch renames remain visible
- Collapse synchronous appearance bursts into one latest-value write without
  crossing queued `get()` reads, flushes, or owner-history operations
- Release same-origin request records on success, failure, and cancellation,
  preventing failed network requests from growing process-lifetime state
- Sandboxed Markdown previews remove capture listeners, cancel deferred scroll
  work, and release iframe references on unmount

**Fully Material, everywhere**
- The remaining stock surfaces — tooltips, menus, banners, autocomplete popups, segmented controls, split-buttons, dialog internals, History/CI surfaces — are re-tinted through the Material token system in both light and dark themes
- Every button now exposes a shared hover and keyboard-focus hint derived from its explicit help text, accessible name, or visible label; icon-only native buttons mounted later by dialogs and virtualized views receive the same non-native tooltip treatment
- Compact-height dialogs and tools keep named actions reachable without page-level horizontal clipping. In particular, the Regex Builder reflows its category/token grid and scrolls its body while preserving the tester and footer, and the Remote Manager protects readable field/control widths before stacking
- The exhaustive responsive gate inventories every repository rail page, preferences tab, repository-settings tab, clone tab, nested API/File History/notification surface, and safe menu dialog, then proves true-bottom reachability at desktop, minimum, narrow, short, wide, 125%, 150%, and minimum-window 200% scenarios

**Also shipped:** multi-clone with organization chips, parallel/sequential modes and URL-only import/export; one-click commit and push with a generated message; self-update checks against Desktop Material releases; SVG diff hardening and display controls; safer undo/reset/tag deletion confirmations; and responsive, keyboard-accessible MD3 surfaces throughout the app.

## Roadmap

The M0–M27 status, M22 visual-publication acceptance, current maintenance work,
and acceptance rules live in [`ROADMAP.md`](ROADMAP.md). Detailed implementation
and verification receipts remain in [`PLAN.md`](PLAN.md) and
[`HANDOFF.md`](HANDOFF.md).

## Screenshots

The compact selection below keeps this README scannable. The
[guided feature gallery](docs/wiki/Feature-Gallery.md) and
[task-oriented tutorial](docs/wiki/User-Guide.md) contain the full annotated
set.

The wiki now also includes a visual-learning layer: eight labeled workflow
diagrams—one on every wiki page—and seven conceptual illustrations covering the
safe Git loop, short-lived branches, conflict resolution, rebase, stash recovery,
automation, and account isolation. The diagrams are reproducible with
`node script/generate-wiki-diagrams.js`.

| Custom app identity | Material Welcome | Appearance customization | Dynamic toolbar overflow |
| --- | --- | --- | --- |
| <img src="docs/assets/screenshots/material-app-identity-workspace.png" alt="Workspace with a customized in-app logo and name plus a favorite repository tab" width="320"><br><sub>Profile app identity</sub> | <img src="docs/assets/screenshots/material-welcome.png" alt="Pure Material first-run Welcome task card and tonal workspace preview" width="320"><br><sub>Material Welcome</sub> | <img src="docs/assets/screenshots/material-customization.png" alt="Appearance editor anchored beside its actual element with History, a dedicated local Git path, and burst-safe persistence" width="320"><br><sub>Anchored owner · burst-safe history</sub> | <img src="docs/assets/screenshots/material-toolbar-overflow.png" alt="Narrow app bar with lower-priority actions moved into the More surface before clipping" width="320"><br><sub>Measured More behavior</sub> |

| Word-style tab appearance | Arrange tabs | Actions cancellation | Reviewed rebase |
| --- | --- | --- | --- |
| <img src="docs/assets/screenshots/material-tab-appearance-word.png" alt="Word-style tab appearance editor with typography, alignment, and independent text and background palettes" width="320"><br><sub>Per-tab appearance</sub> | <img src="docs/assets/screenshots/material-tab-arrange.png" alt="Arrange tabs surface with pinned and manual movement controls plus one-shot label, opened-date, and repository-status sorts" width="320"><br><sub>Persistent tab order</sub> | <img src="docs/assets/screenshots/material-actions-cancel.png" alt="Material workflow-run cancellation review naming the exact run, ref, actor, and commit" width="320"><br><sub>Exact-run cancellation</sub> | <img src="docs/assets/screenshots/material-rebase-review.png" alt="Reviewed current-branch rebase showing current to target, ahead and behind counts, and a bounded commit preview" width="320"><br><sub>Rebase review</sub> |

| Persistent tab groups | Rich command palette |
| --- | --- |
| <img src="docs/assets/screenshots/material-tab-groups.png" alt="Desktop Material workspace with a visible named tab-group chip and its repository member" width="520"><br><sub>Named chip · collapse/expand · restart persistence</sub> | <img src="docs/assets/screenshots/material-command-palette-appearance.png" alt="Command palette showing Ollama results beside the fully visible row appearance editor" width="520"><br><sub>Rich result rows · density and visibility controls</sub> |

| Live Cheap LFS pin and restore | Live cloud compression |
| --- | --- |
| <img src="docs/assets/screenshots/cheap-lfs-ui-acceptance.png" alt="Cheap LFS manager after a live private-repository UI pin with one verified pointer and its Materialize action" width="520"><br><sub>Public/private live GitHub · native picker · pushed pointer history</sub> | <img src="docs/assets/screenshots/cheap-lfs-cloud-compression.png" alt="Bilingual private-repository Cheap LFS manager with explicit cloud-compression consent and a compressed pointer row" width="520"><br><sub>Private opt-in · 99.9% smaller · local verified materialization</sub> |

| Detailed Cheap LFS commit progress | Compact Repository Releases at 200% |
| --- | --- |
| <img src="docs/assets/screenshots/cheap-lfs-commit-progress.png" alt="Changes sidebar with the Large files filter and a three-lane Cheap LFS terminal below Commit" width="520"><br><sub>Three lanes · queue/provider context · timing and ETA · keyboard disclosure</sub> | <img src="docs/assets/screenshots/material-github-releases-compact.png" alt="Accepted 200% Repository Releases frame from the 100–200% physical-size gate, with a complete first row and compact keyboard-accessible tools" width="520"><br><sub>100–200% gate · complete row · 24-hour time</sub> |

| Live 14.8 GB Bambu Cheap LFS restore |
| --- |
| <img src="docs/assets/screenshots/cheap-lfs-bambu-build-live.png" alt="Live public Bambu build Cheap LFS inventory with ten tracked Release-backed pointer objects" width="720"><br><sub>8,305 files · four proven UI batches · ten pointers · separate 10/10 clone hash proof</sub> |

<!-- markdownlint-disable MD013 -->

| Cross-lane automatic update recovery |
| --- |
| <img src="docs/assets/screenshots/auto-updater-update-ready.png" alt="About Desktop Material showing a newer alphabetic-z update ready for a legacy Super Express installation" width="720"><br><sub>Legacy s lane → shared z lane · real Squirrel download · ready to install</sub> |

<!-- markdownlint-enable MD013 -->

Cheap LFS can now install a reviewed, SHA-pinned GitHub Actions caller that
compresses Release objects sequentially without Actions artifacts or caches.
For a confirmed-public repository, Desktop Material automatically prepares the
owned caller in Changes; it starts running only after the user reviews, commits,
and pushes that workflow. Private repositories stay off until the user opts in,
then follow the same reviewed commit/push boundary. Failed or non-beneficial
objects keep their exact raw pointer and asset, while successful objects become
backward-compatible `part-deflate` records. Decompression always happens
locally in Desktop Material with bounded expansion plus original part and
whole-file SHA-256 verification. Live public and private Actions converted
separate 1 MiB objects to verified 1,033-byte side assets while retaining their
raw historical assets; both compressed pointers restored to the exact original
bytes through the app.

| Repository workflows | GitHub workflows | Accessibility and shell |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-repository-tools.png" alt="Repository Tools administration hub" width="420"><br><sub>Repository Tools</sub> | <img src="docs/assets/screenshots/material-actions-cache-manager.png" alt="Actions cache manager" width="420"><br><sub>Actions caches</sub> | <img src="docs/assets/screenshots/material-scale-200-autofit.png" alt="Two hundred percent scale auto-fit without clipping" width="420"><br><sub>200% auto-fit</sub> |
| <img src="docs/assets/screenshots/material-pull-all-account-fallback.png" alt="Pull All results for several repositories" width="420"><br><sub>Pull All</sub> | <img src="docs/assets/screenshots/material-native-pull-request.png" alt="Native pull request creation" width="420"><br><sub>Pull requests</sub> | <img src="docs/assets/screenshots/material-workspace-changes.png" alt="Desktop Material Changes workspace" width="420"><br><sub>Changes workspace</sub> |
| <img src="docs/assets/screenshots/material-stash-manager.png" alt="Repository-wide stash manager" width="420"><br><sub>Stash manager</sub> | <img src="docs/assets/screenshots/material-github-issues.png" alt="GitHub issue detail and lifecycle controls" width="420"><br><sub>Issues</sub> | <img src="docs/assets/screenshots/material-responsive-overflow-fixed.png" alt="Responsive workspace without horizontal clipping" width="420"><br><sub>Responsive clipping gate</sub> |

| Runtime tab search | History commit actions | Repository Tools at the true bottom |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-tab-search.png" alt="Runtime repository-tab search matching the active local fixture by name and path" width="420"><br><sub>Search and switch tabs</sub> | <img src="docs/assets/screenshots/material-history-context-actions.png" alt="History commit row with its named More actions control and hover hint" width="420"><br><sub>Right-click and keyboard-equivalent actions</sub> | <img src="docs/assets/screenshots/material-repository-tools-scroll.png" alt="Short Repository Tools workspace scrolled to its reachable final results surface" width="420"><br><sub>Verified bottom reachability</sub> |

| GitHub API functions |
| --- |
| <img src="docs/assets/screenshots/material-github-api-explorer.png" alt="Repository-bound GitHub API functions with runnable buttons and an advanced request builder" width="720"><br><sub>Auto-added read functions · hideable API rail item · reviewed custom requests</sub> |

| Custom repository-logo studio | Named API app functions |
| --- | --- |
| <img src="docs/assets/screenshots/material-repository-logo-studio.png" alt="Layered custom repository-logo studio with live preview, undo and redo, safe JSON transfer, and repository inheritance" width="520"><br><sub>Safe vector layers · profile default · repository override</sub> | <img src="docs/assets/screenshots/material-api-app-functions.png" alt="Named API app functions extending the selected repository through reviewed REST and GraphQL definitions" width="520"><br><sub>Versioned definitions · exact binding · reviewed execution</sub> |

| Temporary submodule repository navigation |
| --- |
| <img src="docs/assets/screenshots/material-submodule-context.png" alt="Initialized submodule opened temporarily in the workspace with a context bar and Back control to the persisted root repository" width="720"><br><sub>No repository import · customizable Back control · root return</sub> |

| Reviewed ordinary Git pull |
| --- |
| <img src="docs/assets/screenshots/material-pull-preview.png" alt="Reviewed ordinary Git pull showing exact branch identities, incoming commits, changed files, and a clean-worktree confirmation gate" width="720"><br><sub>Fresh fetch · exact reviewed OID · no second fetch</sub> |

| Advanced Git and collaboration workflows |
| --- |
| <img src="docs/assets/screenshots/advanced-workflows.png" alt="Tag lifecycle workspace showing local, pushed, and remote-only tags with bounded actions" width="720"><br><sub>Local and remote inventory · reviewed mutations · responsive workflow surface</sub> |

| Local Ollama model lifecycle |
| --- |
| <img src="docs/assets/screenshots/material-ollama-model-manager.png" alt="Ollama model manager with endpoint health, installed and running model inventory, selected model details, and lifecycle actions" width="720"><br><sub>Health · inventory · pull · copy/rename · load/unload · confirmed delete</sub> |

<details>
<summary><strong>Open 30 more verified screenshots</strong></summary>

| Clone and checkout | Repository administration | Accounts and automation |
| --- | --- | --- |
| <img src="docs/assets/screenshots/material-clone-account-fallback.png" alt="Exact-origin account fallback clone" width="360"><br><sub>Account-aware clone</sub> | <img src="docs/assets/screenshots/add-submodule-dialog.png" alt="Clone-style Add Submodule dialog reviewing a synthetic URL, checkout path, and tracked branch" width="360"><br><sub>Clone-style submodules</sub> | <img src="docs/assets/screenshots/material-remote-manager.png" alt="Named remote manager" width="360"><br><sub>Remote manager</sub> |
| <img src="docs/assets/screenshots/material-shallow-clone-safe.png" alt="Reviewed shallow clone" width="360"><br><sub>Shallow clone</sub> | <img src="docs/assets/screenshots/material-gitignore-manager.png" alt="Gitignore template manager" width="360"><br><sub>Gitignore manager</sub> | <img src="docs/assets/screenshots/material-automation.png" alt="Automation settings" width="360"><br><sub>Automation</sub> |
| <img src="docs/assets/screenshots/material-sparse-checkout-safe.png" alt="Guided sparse checkout with Review active, a locked editor, and the exact normalized selection" width="360"><br><sub>Guided sparse-checkout review</sub> | <img src="docs/assets/screenshots/material-history-deepening.png" alt="Full history after deepening" width="360"><br><sub>History deepening</sub> | <img src="docs/assets/screenshots/material-agent-access.png" alt="Local agent access settings" width="360"><br><sub>Agent access</sub> |
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

Desktop Material's automated releases provide a per-user x64 Windows installer.
The Windows package command also creates `dist/GitHub Desktop-x64.zip`, and the
gated release workflow requires that portable archive beside the installer
assets. A successful main CI run enters packaging directly; a manual express
dispatch runs lint, Windows x64 trampoline/unit/script tests, and packaging in
parallel. The packaging
job preserves the complete payload as a short-lived Actions artifact before
attempting its create-only GitHub Release, so installers remain available when
publication alone fails. Run this one line in Windows PowerShell 5.1 or
PowerShell 7; it does not require an administrator shell:

```powershell
Microsoft.PowerShell.Utility\Invoke-RestMethod 'https://raw.githubusercontent.com/Ding-Ding-Projects/desktop-material/main/script/install-windows.ps1' | Microsoft.PowerShell.Utility\Invoke-Expression
```

The [tracked installer script](script/install-windows.ps1) asks GitHub for this
exact repository's latest stable installer release, accepts only the installer
for the native architecture, verifies its release-asset size and GitHub SHA-256 digest,
checks any Authenticode signature, runs the Squirrel installer silently with
`/S`, and removes its controlled temporary directory. The current release
workflow publishes unsigned x64 builds, so the script reports that status and
stops on ARM64 until an ARM64 asset is available. Review the script before
running any remote command, or use the
[latest release page](https://github.com/Ding-Ding-Projects/desktop-material/releases/latest)
for a manual installer or portable-ZIP download. Extract the ZIP before running
the packaged executable. The focused archive/workflow contract is green; a
published baseline already contains the required installer, feed, and portable
ZIP assets. The updater-migration Releases additionally verify the complete
installer, feed, NuGet, MSI, and portable-ZIP payload on exact source
`04246fdf12`.

When GitHub Actions is actively building or packaging a newer exact commit but
has not yet published its Release, the About updater reports **New update coming
soon** in the selected English, playful Hong Kong Cantonese, or bilingual mode.
The state is transient and fails closed; normal Squirrel update behavior resumes
on the next check after publication. Automated Release notes list bounded,
sanitized commit subjects from the previous installer release through the exact
release SHA. CI, installer, and Pages runs use unique groups so a newer
invocation never cancels or replaces older running or pending work. See
[Automated update build status and release
notes](docs/features/integrations/automated-updates-and-release-notes.md).

## Building

Full instructions live in [`docs/contributing/setup.md`](docs/contributing/setup.md). In short, with Node 24.15.0:

```
yarn && yarn build:dev && yarn start
```

## Project site & docs

- Project site: https://ding-ding-projects.github.io/desktop-material/
- Wiki: https://github.com/Ding-Ding-Projects/desktop-material/wiki

## Credits & License

Desktop Material is built on [GitHub Desktop](https://github.com/desktop/desktop) (MIT), with feature-parity references from [desktop-plus](https://github.com/desktop-plus/desktop-plus) (MIT). Thanks to both projects and their contributors.

**[MIT](LICENSE)**

The MIT license grant is not for GitHub's trademarks, which include the logo designs. GitHub reserves all trademark and copyright rights in and to all GitHub trademarks. GitHub's logos include, for instance, the stylized Invertocat designs that include "logo" in the file title in the following folder: [logos](app/static/logos).

GitHub® and its stylized versions and the Invertocat mark are GitHub's Trademarks or registered Trademarks. When using GitHub's logos, be sure to follow the GitHub [logo guidelines](https://github.com/logos).
