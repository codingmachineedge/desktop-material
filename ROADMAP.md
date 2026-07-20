# Desktop Material roadmap

Updated: **July 20, 2026**

Desktop Material's feature roadmap is complete through the **M21 advanced
workflow wave** below, with the **M22 owner-scoped management and publication
wave** in its separately tracked visual acceptance and the **M23 full Ollama
model manager** complete, published, and remotely verified. This
file is the compact
public source of truth; implementation details and historical test receipts
stay in [`PLAN.md`](PLAN.md) and [`HANDOFF.md`](HANDOFF.md).

## Platform support

Desktop Material is Windows-only. The supported product gates are Windows
x64/arm64 builds, the Windows x64 full-unit and packaged-E2E lanes, and the
Windows x64 installer/release workflow. macOS and Linux application runtimes
and packages are outside the roadmap; non-Windows runners may still host
platform-neutral repository automation.

## M23 — Full Ollama manager — **Complete; published**

- **Settings → Copilot → Providers** offers an Ollama preset and a dedicated
  **Manage models** workspace instead of requiring native API editing.
- Health/version, installed inventory, running inventory, search/filter, and
  bounded model metadata remain separately refreshable, with explicit empty,
  unavailable, and partial states.
- Pull streams bounded progress and supports cancellation. Copy and guarded
  rename, load/unload, and exact-name confirmed deletion refresh the affected
  inventories without allowing concurrent actions to retarget another model.
- Successful inventory changes synchronize Ollama's installed models back to
  the provider's selectable Copilot models while retaining matching model
  settings and reporting any persistence split outcome.
- Management accepts only an exact loopback `/v1` provider base. Native
  `/api/*` routes are fixed from that origin, and every remote HTTP or HTTPS
  host, arbitrary prefix, saved `/api` base, embedded credential, query,
  fragment, oversized response, and stale request fails closed or remains
  bounded.
- The complete workspace follows English, playful Hong Kong Cantonese, and
  bilingual language modes plus keyboard, status-announcement, compact-window,
  and reduced-motion contracts. See the
  [Ollama model manager feature guide](docs/features/integrations/ollama-model-manager.md).
- Exact source `27ffc1af7dd1223809c69ea0f72ddab369869f31` passed the
  low-level-MCP production build in 213.16 seconds and the deterministic full
  lifecycle exercise. The accepted privacy-safe 1452×1001 capture is 128,903
  bytes with SHA-256
  `f1735c664248cd1b10a64e672dbbab24c95dabab99a62deeaf93557145a36509`;
  geometry reports zero overlaps and no horizontal overflow, and owned runtime
  cleanup completed. Exact-`main` Windows CI and CodeQL passed, the canonical
  wiki was synchronized, and the live Pages site plus the deployed image passed
  public HTTP and byte-for-byte asset checks.

## M22 — Owner-scoped management and complete visual refresh (July 19–20, 2026) — **Implementation complete; visual refresh paused**

- Every custom visual is edited from its actual owner with an anchored editor;
  each owner keeps a strict setting, independent local Git repository, and
  mutable undo/redo/restore history. General Appearance retains only ordinary
  preferences.
- Files over 100 MiB route through release-backed cheap LFS before every commit
  entry point. New uploads skip compression, remain raw, and split into verified
  ordered parts below GitHub's release-asset limit.
- Add Local Repository performs bounded parent-folder discovery. Repository
  Settings is wider and includes temporary submodule navigation, a full subtree
  manager, and a create-remote-repository-and-add-as-submodule workflow.
- Saved SSH hosts are available to the paired site through a redacted command
  contract for credential-vault-backed remote cloning.
- Collection managers are being audited for reviewed bulk actions, beginning
  with Releases and Actions and extending to every safe batchable list. Every
  actual search field is being audited against the shared regex-builder and
  invalid-pattern contract.
- All 68 published app screenshots used by README, Pages, and the wiki will be
  recaptured from a synthetic production build on an off-screen Win32 desktop.
  The new anchored-editor proof must display a privacy-safe collapsed local-repo
  path while its Copy action retains the exact path.

## M21 — Advanced workflow completeness (July 19, 2026) — **Complete**

- Exact account/repository identity, scalable repository and branch switching,
  reviewed multi-repository sync, and current-branch/all-ref history discovery.
- Native pull-request review and creation, activity notifications, rich checks
  and metadata context, plus exact fork branch/commit checkout.
- Selective, named, and external stash interoperability alongside complete
  reviewed tag lifecycle management.
- Changed-file trees, persisted diff context, structured CSV/TSV comparison,
  TGA preview, broader editor discovery, WSL/network paths, global ignores,
  allowlisted Git command presets, patch import/export, and guarded bulk branch
  deletion.
- Live GitHub Projects with bounded last-known-good offline cache behavior and
  explicit stale/error states. All 30 source demands are mapped in the
  [feature ledger](docs/features/github-desktop-demand-backlog.md).

## M20 — Platform wave (July 17–18, 2026) — **Complete**

- Secure LAN agent access with QR pairing, per-device vault tokens,
  revocation, and the Docker-hosted mobile console (timeouts aligned to the
  agent's 65-second command budget).
- SSH working-copy management with vault-only credential storage and opt-in,
  fast-forward-only Docker Compose deployment after matching app pushes, plus the
  verified one-line Windows installer on README, wiki, and Pages (with a
  copy button and celebration pulse).
- Submodules everywhere: clone-list badges with a pre-clone details dialog
  (clone any submodule as its own repository), the in-place Submodule
  Manager on the repo page with search and status chips, and
  worktree-from-commit on the History right-click menu.
- Material in-app context menus with per-action icons and type-to-filter,
  the Ctrl+F master command palette, Actions Runs/Workflows/Caches tabs
  with per-tab filter bars, clone visibility chips (public/private/forked),
  real account switching, and OAuth-scope re-authorization for Releases.
- Complete GitHub notification pagination with a confirmed, retryable Clear all,
  plus a repository Releases dashboard with status totals, search/filter modes,
  rich release and asset metadata, and operation-specific recovery states.
- Compact-window clipping fixes across dialogs and the tools hub, pointer
  hit-testing fixes in the clone surfaces, and a full 63-image gallery
  refresh captured from this build.

## Ongoing maintenance

The previously queued appearance, regex, submodule configuration, subtree,
notification automation, release-backed large-file, log-history, and tools
catalog work is now represented by completed maintenance rows and its exact
receipts rather than a stale future-work list. New work must be added with a
named scope and its own acceptance evidence before it is described as queued or
shipped.

## Milestones

| Milestone | Status | Delivered scope |
|---|---|---|
| **M0** | **Complete** | CI, installers, Pages, wiki sources, README, and screenshot publishing. |
| **M1** | **Complete** | Per-account, Git-versioned settings profiles and recovery. |
| **M2** | **Complete** | Persistent browser-style repository tabs and tab styling. |
| **M3** | **Complete** | Settings history with diffs, undo, redo, and restore. |
| **M4** | **Complete** | Draggable, stackable non-modal dialogs and side sheets. |
| **M5** | **Complete** | Git-backed notification centre and notification history. |
| **M6** | **Complete** | Shared fuzzy/substring/regex search and regex builder. |
| **M7** | **Complete** | Multi-clone, URL-only transfer, Select all, automatic new-repository cloning, and exact-origin account recovery. |
| **M8** | **Complete** | 50–200% scaling, auto-fit, and organization-aware browsing. |
| **M9** | **Complete** | Commit/push and pull automation, Pull All, Merge All, and layered scheduling. |
| **M10** | **Complete** | GitHub Actions runs, jobs, logs, reruns, dispatch, artifacts, provenance, caches, and deployment review. |
| **M11** | **Complete** | Token-gated loopback MCP/REST agent access, stdio proxy, and CLI. |
| **M12** | **Complete** | Desktop Plus parity controls, telemetry defaults, identity, sorting, destructive actions, and accessibility labels. |
| **M13** | **Complete** | Repository metadata, pinning/grouping, Pull All recovery, remotes, and clone-style submodule management. |
| **M14** | **Complete** | History metadata search, commit graph, SVG controls, guarded deletion, and branch presets. |
| **M15** | **Complete** | Repository-wide stash management and Desktop Material CLI branding. |
| **M16** | **Complete** | Tab-aware multi-window lifecycle and serialized shared-profile mutation. |
| **M17** | **Complete** | GitLab, Bitbucket, and self-hosted GitLab accounts, clone browsing, and provider routing. |
| **M18** | **Complete** | Material Design 3 shell, responsive layouts, keyboard focus, accessibility, and clipping coverage. |
| **M19** | **Complete** | Guided Git/GitHub/provider parity: PR lifecycle, Releases, Issues, rules, patch series, commit rewrite, signing, LFS, worktrees, remotes, hooks, bisect, and triage. |
| **M20** | **Complete** | Secure LAN agent access, provider inbox and Releases depth, submodule workflows, Material context menus, compact-surface fixes, and refreshed gallery evidence. |
| **M21** | **Complete** | Thirty demand-backed identity, PR, stash/tag, navigation, diff, integration, and Projects workflow closures with bounded safety contracts. |
| **M22** | **Implementation complete; visual refresh paused** | Owner-scoped anchored appearance/history, raw split cheap LFS, repository discovery and submodule/subtree expansion, safe cross-manager bulk/regex coverage, verified by build/tests; 68-image publication refresh remains pending. |
| **M23** | **Complete; published** | Full Ollama health/version, installed/running inventory, search/filter/details, cancellable pull, copy/rename, load/unload, confirmed delete, authoritative provider-model sync, guarded endpoints, localized accessible states, and accepted privacy-safe off-screen evidence. |

The completed milestone waves remain shipped. The temporary-submodule
navigation and CI/release hardening items below completed local acceptance and
the correction commit `98d93ccc` passed its full remote CI matrix, CodeQL, and
gated installer publication. The owned app, provider, CDP listener, credential,
headless desktop, and fixture root were cleaned after the final post-build
regression. The detailed Pages, wiki, asset, and topology receipts are recorded
in `HANDOFF.md` and the canonical wiki.

## Current maintenance acceptance

| Work | State | Required proof |
|---|---|---|
| M23 full Ollama model manager | **Complete; published** | Endpoint/parser, lifecycle, synchronization, stale-request, localization, accessibility, and responsive-layout tests; exact low-level-MCP production build; deterministic loopback Ollama exercise; original-resolution privacy-safe manager capture; runtime cleanup; pushed Windows CI and CodeQL; canonical wiki synchronization; live Pages and public-asset verification; and final topology cleanup are complete. |
| M22 integrated owner-scoped management wave | **Implementation merged locally; final acceptance in progress** | Cheap-LFS/SSH/discovery checkpoint `cdedb4afb8` is already on `origin/main`. The combined owner-scoped appearance/repository-management commit is rebased locally as `04581544cf`; TypeScript and 166 focused tests pass. Remote-repository submodule creation is implemented and focused-tested. Remaining proof is the expanded bulk/regex audit, final exact MCP build, full 68-image privacy-safe headless refresh, full unit/lint/format gates, push, remote CI/CodeQL/Pages/wiki verification, and topology cleanup. |
| Temporary submodule repository navigation and explicit language modes | **Complete; release verified** | Run `20260718-232824-ci-10-pass-submodule-navigation` opened only initialized submodules; kept temporary children out of the repository list, Recent, tabs, and persisted last selection; returned nested navigation to the persisted root; rejected stale, invalid-Git, traversal, sibling-prefix, and symlink/junction escape targets; covered all Back styles/labels and exact English, playful Hong Kong Cantonese, and bilingual modes; and passed restart, keyboard, compact, dark, 200%-requested auto-fit, ten accepted screenshot passes, and a post-build 1440×960 child/read-only/Back regression. A later fresh-bundle race regression synchronously exercised duplicate Open and Back activation: it preserved one persisted repository and tab, restored the root once, and showed no error. Initial remote CI exposed a macOS arm64 symlink-error ordering issue; correction `98d93ccc` passed all seven CI jobs and published `v3.6.3-beta3-b0000000165`. |
| CI updater port and release gating | **Complete; release verified** | Local contracts verify a per-job exact loopback updater URL at build and runtime, successful exact-SHA CI gating before installer publication, immutable-tag and `origin/main` checks both before packaging and immediately before publication, required non-empty assets, least-privilege release-PR read access, and one publication action. The original failed CI correctly skipped its downstream installer run. The correction passed remote Windows packaged E2E, all remaining matrix jobs, CodeQL, and [Build Installers 29697597981](https://github.com/codingmachineedge/desktop-material/actions/runs/29697597981), which published the five required assets in `v3.6.3-beta3-b0000000165`. |
| Profile, repository, feature, and tab appearance customization | **Owner-scoped implementation complete locally; publication pending** | Each actual visual owner now opens its own anchored editor and owns an independent strict setting, local Git repository, and mutable history. Repository owners inherit matching profile owners without sharing commits; individual tab titles and feature IDs stay isolated. Language is an ordinary preference, and the monolithic custom-visual Appearance surfaces are retired. Focused behavior, race, recovery, focus, and history tests pass; final 68-image and remote acceptance remains part of M22. |
| App identity and portable tab workspace | **Complete** | Verified profile-backed app logo/name typography and effects, favorites, folder-drop tab opening, current-tab session import/export, appropriate right-click customization/history context, unknown-key migration safety, restart persistence, 38 named identity controls, compact no-overflow geometry, and inspected headless evidence. |
| Measured app-bar overflow | **Complete** | Verified live label measurement, Icons only/compact footprints, Build & Run then Commit & Push overflow order, mounted-state and focus continuity, deterministic widening restore, and `material-toolbar-overflow.png`. |
| Material Welcome and landing page | **Complete** | Verified the first-run task card and compact fallback, the Material landing structure and keyboard path, and inspected `material-welcome.png`. |
| Guarded tab close and arrangement | **Complete** | Preserved the original regex **Close Tabs Containing…** action; verified case-insensitive literal inverse-close matching, counts/preview/zero-match protection, pinned-tab safety, drag and keyboard movement, pin-group boundaries, stable one-shot label/opened/status sorts, persisted order, focus, announcements, and multi-window isolation. |
| Actions workflow-run cancellation | **Complete** | Verified exact repository/account/run revalidation, cancellable-status gating, one normal cancel request with duplicate suppression, accepted-response polling, stale and terminal transitions, bounded provider errors, focus return, and compact confirmation layout. |
| Reviewed current-branch rebase | **Complete** | Verified target search, current→target and ahead/behind context, bounded commit preview, fresh dirty/conflict/operation guards, exact ref/SHA revalidation, cancel-before-start, conflict continue/abort routing, protected-branch guidance, and no automatic force push. |
| Provider account binding and OAuth scope alignment | **Complete** | Verified repository-settings binding propagation without reopening, unique-match auto-binding, explicit multiple-account choice, no-match/stale/permission/SSO recovery, generation safety, no silent replacement of a valid binding, and the bounded `repo user workflow notifications read:org` sign-in scope set. |
| Compact Repository Tools, Remote Manager, and Regex Builder | **Complete** | Verified vertical reachability at short heights; readable remote name/URL/control columns before a stacked fallback; reflowed Regex Builder categories/tokens with a scrollable body and reachable footer; named controls, focus, zoom, and no page-level horizontal overflow. |
| Detailed Pull All progress | **Complete** | Verified live per-repository state, bounded concurrency, completion summary, keyboard/accessibility semantics, compact-window containment, focused and full-suite coverage, the exact production build, and inspected off-screen evidence on `main`. |
| Clone-style Add Submodule | **Complete** | Verified hosted-provider and URL selection, exact-account affinity, reviewed relative path/branch, duplicate and occupied-path rejection, bounded progress, cancellation, list refresh, keyboard labels, and minimum-window containment. |
| Repository-wide feature revalidation | **Complete** | The historical revalidation verified the registered-surface and M0–M19 implementation inventory, focused and repository-wide tests, production builds/packages, isolated headless interaction, exact-SHA CI and installer runs, Pages, the seven-page wiki, and its then-current 52-image documentation gallery. |
| Documentation gallery expansion | **M22 full refresh in progress** | README, wiki, and Pages now declare 68 app screenshots. All 68 must be recaptured from the final production build with synthetic data; stale monolithic appearance scenes are being replaced by actual-owner anchored scenes, and specialized large-file, repository-discovery, and submodule-management frames are being added. Final completion requires original-resolution privacy inspection and byte-identical Pages/wiki delivery. |
| Complete notifications and Releases dashboard | **Complete** | Verified every GitHub notification page, confirmed local/remote Clear all with partial-failure retention, release status metrics and loaded-result search/filtering, rich asset metadata, scoped retries, responsive layout, and inspected headless evidence. |

## Acceptance gates

A roadmap or maintenance item is complete only when all applicable evidence is
present:

1. The implementation is reachable from a named UI, CLI, or agent workflow.
2. Focused tests cover success, failure, cancellation/stale state, and safety
   boundaries appropriate to the feature.
3. TypeScript, lint, formatting, repository-wide tests, and production build
   pass.
4. UI work passes desktop and compact-window keyboard, focus, screen-reader,
   scaling, overflow, and clipping checks.
5. Privacy-safe screenshots are inspected at original resolution and published
   in the relevant README, wiki, Pages, and tutorial surfaces.
6. The exact commit is pushed to `main`, remote CI/Pages are green, and any
   temporary branch/worktree is removed only after merge verification.

## Evidence index

- [`PLAN.md`](PLAN.md) — complete implementation ledger and architecture
  contracts.
- [`HANDOFF.md`](HANDOFF.md) — build, test, headless UI, screenshot, privacy,
  publication, and cleanup receipts.
- [Run manifests](.codex/run-manifests/) — exact milestone commands and capture
  records.
- [Feature gallery](docs/wiki/Feature-Gallery.md) — user-facing screenshot
  index.
