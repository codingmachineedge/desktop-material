# Desktop Material roadmap

Updated: **July 21, 2026**

Desktop Material's feature roadmap is complete through the **M21 advanced
workflow wave** below, with the **M22 owner-scoped management and publication
wave** in its separately tracked visual acceptance and the **M23 full Ollama
model manager** complete, published, and remotely verified. The **M24 guided
sparse-checkout workflow** has completed implementation and local acceptance.
The **M25 repository-bound API functions** are implemented and the **M26 Cheap
LFS / Express Release** family is built. This file is the compact public source
of truth; implementation details and historical test receipts stay in
[PLAN.md](PLAN.md) and [HANDOFF.md](HANDOFF.md).

## M27 — Reviewed pull previews — **Implementation and local acceptance complete**

Toolbar and application-menu pulls now fetch first and open a blocking review
of the exact current/upstream refs and OIDs, ahead/behind topology, effective Git
integration strategy, and bounded incoming commit/file summaries. Confirmation
revalidates the frozen identity, strategy configuration, and clean worktree,
then integrates the reviewed upstream commit without a second superproject
fetch. Detached, dirty, conflicted, stale, failed-fetch, busy, and unsafe
fast-forward-only states remain non-destructive. Focused tests, TypeScript,
lint/format checks, the production build, and an isolated off-screen Win32 pull
exercise passed; remote CI, Pages, and release verification follow the `main`
push recorded in [HANDOFF.md](HANDOFF.md).

## M26 — Cheap LFS / Express Release — **Implementation complete; publication verification pending**

- **Release-backed large-file storage**: The repository rail's **Large files**
  manager can pin working-tree files over 100 MiB to GitHub Release assets,
  leaving small human-readable pointers at their tracked paths. Automatic pinning
  gates on commit entry points and downloads materialize detected pointers after
  clone, pull, user fetch, or open under one cancelable batch. Multi-gigabyte
  files are split into ordered raw parts smaller than 2 GiB with whole-file and
  per-part SHA-256 verification. The manager lists and searches committed
  pointers, restores individually or all at once, and never requires browsing or
  decoding release asset names externally.
- **Manual browser handoff**: When the trusted GitHub CLI path cannot complete
  safely, a browser-assisted upload handoff plans every remaining file, splits
  sources into ordered .partNNN files in a flat bounded folder, opens the
  Release editor and Explorer simultaneously, polls for uploads with bounded
  retry intervals, accepts only new exact-name/size assets, re-hashes every
  source before writing pointers, and records a version-2 manifest of original
  nested paths and flat asset ranges.
- **Express Release fast lane**: A workflow_dispatch-only emergency release path
  checks out the exact SHA, restores the dependency cache, skips lint and all test
  suites, builds and packages Windows x64 directly, verifies the Squirrel/
  installer/portable payload, writes a local note from the checked-out commit,
  preserves an uncompressed artifact, and publishes one uniquely tagged release.
- **Super Express Release**: Combines the package base with its run number and
  attempt into NuGet-compatible unique immutable tags. Has no shared concurrency
  group so newer dispatches cannot cancel older ones. Failed or cancelled main CI
  still runs the package lane for a recoverable Actions artifact but cannot publish.
- **Build & Run integration**: Two new preferences — "Pin large files before
  committing" and "Download large files after cloning" — are both enabled by
  default. The Large files surface is reachable from both the repository rail and
  Repository Tools hub.
- See the feature guide at
  [docs/features/repository-management/release-backed-cheap-lfs.md](docs/features/repository-management/release-backed-cheap-lfs.md).

## July 21 CI lint newline repair — **Local verification complete; remote verification pending**

- CI run `29879526652` failed its Lint job only because `opencode.json` lacked
  the final newline required by Prettier; no OpenCode setting or permission was
  changed.
- The full CI-equivalent `yarn lint` gate now passes locally. Exact-commit
  remote CI and installer Release verification remain pending.

## July 21 pull-preview and Cheap LFS hardening — **Locally verified**

- Reviewed pull previews now require fresh status, preserve one atomic raw
  strategy snapshot, stream a bounded changed-file parse, and keep busy/modal
  phase locks, accessibility state, and footer actions consistent. The accepted
  privacy-safe pull-preview screenshot is 960×660.
- Cheap LFS cancellation now requires confirmation. The GitHub CLI fallback
  streams uploads with bounded retry and reconciliation, verifies digests,
  redacts credential-bearing diagnostics, and uses 1 MiB chunks. Browser handoff
  staging creates only regular nonempty files through verified same-volume
  hardlinks or bounded copies—never symlinks—and recognizes verified partial
  uploads so a resumed handoff prepares only missing objects. Fresh and final
  complete Release inventories fence pointer publication.
- Exact commits `98bd712f2f` and `484ebc0210` correct overlapping Express
  Installer runs: every successful stale target publishes its own immutable
  Release, but it cannot steal Latest from current `main`. Publication uses a
  fresh promotion check with verified demotion instead of GitHub's lossy shared
  concurrency queue. A real failed upstream CI remains failed. The focused
  workflow contract passes **8/8**.
- The pre-integration Cheap LFS gate passes **189/189**, including **23/23**
  manual staging/resume checks. On the final rebased tree, expanded Cheap
  LFS/Release coverage passes **207/207** and pull-preview coverage passes
  **81/81**. TypeScript, configured targeted ESLint, Prettier,
  feature-document markdownlint, and diff integrity are green.
- The already published baseline Release
  [`v3.6.3-beta3-s000000000201`][release-s201]
  targets `fa4806971c` and contains all six required installer assets. It does
  not claim publication of the later hardening batch. At the user's direction,
  no future CI run is awaited for this batch and the GitHub Projects board is
  deliberately outside this completion scope.

[release-s201]: https://github.com/Ding-Ding-Projects/desktop-material/releases/tag/v3.6.3-beta3-s000000000201

## July 21 Settings queue and mobile connection — **Implementation complete; publication verification pending**

- **Settings → Clone queue**: Exposes the existing account-scoped automatic clone
  policy after the Clone dialog closes. Users choose an absolute base directory,
  parallel (up to three) or sequential mode, and the enabled state for every
  signed-in hosted account. Policies are stored by stable account identity with
  at most 32 entries per account, 5,000 seen URLs per policy, and a maximum of
  500 newly discovered repositories in one batch. Discovery continues after Settings
  closes without opening an unsolicited progress dialog.
- **Settings → Agent access → Open mobile connection page**: Available as a
  discoverable card in every mode, actionable only while Paired LAN mode is running.
  Each activation replaces the old code, opens a fresh five-minute one-use /connect
  link in the default browser, and keeps the secret in the URL fragment. The button
  stays disabled until paired mode is active.
- Both surfaces have explicit English, playful Hong Kong-style Cantonese, and compact
  bilingual copy, accessible labels/status, bounded failure behavior, and
  responsive-surface registration. Exact production build, off-screen interaction/
  screenshot acceptance, pushed-SHA CI, Pages/wiki sync, and Release verification
  remain to be recorded.

## July 21 responsiveness hardening — **Local implementation complete**

Publication verification is pending.

- Valid, locally resolvable remote defaults no longer trigger a potentially
  multi-minute online git remote set-head -a scan during background sync.
  Explicit fetches give discovery five seconds and process-tree cleanup one
  final five-second grace window, so a rename is detected even if the old
  target still exists and a missing child close cannot exceed the ten-second
  hard settlement bound. Clone cancellation retains strict full-close waiting.
  Missing, invalid, or dangling refs retain exact-account discovery.
- Concurrent environment preparation shares one in-flight proxy resolver per
  exact URL. Repeated timeout callers cannot multiply identical unresolved
  operating-system work; settled or failed entries are evicted.
- Concurrent GitHub, Git, and SSH credential prompts settle through one
  recoverable FIFO instead of allowing popup de-duplication or forced removal
  to strand a caller. Replaced popup owners receive one explicit replacement
  settlement; replacing sign-in state does not clear the new owner's flow.
- High-frequency appearance updates coalesce into one latest-value store
  mutation without crossing queued get() reads, flushes, or owner-history
  operations.
- Failed/cancelled Electron requests release their same-origin tracking entry,
  and unmounted sandboxed Markdown previews remove capture listeners, cancel
  deferred work, and release iframe references.
- Deterministic regressions cover a never-settling remote scan and terminator,
  late termination rejection, same-URL proxy coalescing, the strict clone
  barrier, every prompt family, a 500-update burst, failed request-ID reuse, and
  25 Markdown reloads.
  Exact rebased-source full tests, low-level-MCP production build, off-screen UI
  evidence, push, CI, Pages, wiki, and release receipts remain to be recorded.

## M25 — Repository-bound API functions — **Implementation complete; verification pending**

- Eligible GitHub repositories automatically receive a curated set of
  repository, issue, pull-request, release, and workflow read functions.
- Saved functions appear as runnable buttons in the API surface and in
  **Repository tools → API functions**; the raw REST/GraphQL catalog is now an
  advanced custom-function surface.
- The API rail item can be hidden per repository and restored from Repository
  tools. Mutations remain behind the existing exact-request review boundary.
- The feature guide is
  [docs/features/integrations/github-api-functions.md](docs/features/integrations/github-api-functions.md).

## Agent HTTP API — **Implemented** (part of M25–M26)

- Desktop Material ships an opt-in local agent server listening on 127.0.0.1 at
  a random port, with sessionless MCP JSON-RPC and REST compatibility surfaces.
- Three transport modes: **Local only** (loopback), **Paired LAN devices** (private
  IPv4 with five-minute one-use pairing codes and vault-backed tokens), and **YOLO
  LAN** (explicit confirmation, no auth, unsafe).
- HTTP routes include /api/v1/info, /api/v1/commands, legacy /api/v1/command/<name>,
  /mcp for sessionless MCP, /api/v1/remote/* for pairing status/devices, and
  /api/v1/remote/status for unauthenticated transport metadata.
- Version 1 command catalog covers discovery (list-accounts, list-repositories, etc.),
  repository selection (open-repository, select-repository, close-tab), clone and Git
  operations (clone, clone-batch, commit, fetch, pull, push, create-branch, merge-
  branch), automation (get-automation-status, run-automation, trigger-workflow), and
  named API functions. Built-in read functions appear as github_api_<name>.
- Concurrency is bounded to eight running plus 64 waiting requests with a 64 KiB body
  limit. Every POST requires Content-Type: application/json.
- See the feature guide at
  [docs/features/agent-api/local-agent-http-api.md](docs/features/agent-api/local-agent-http-api.md).

## Platform support

Desktop Material is Windows-only. The supported product gates are Windows
x64/arm64 builds, the Windows x64 full-unit and packaged-E2E lanes, and the
Windows x64 installer/portable-ZIP release workflow. macOS and Linux application
runtimes and packages are outside the roadmap; non-Windows runners may still
host platform-neutral repository automation.

## 2026-07-21 maintenance — Codex CLI build repair — **Implementation complete; integration verification pending**

Failed Build & Run stages and free-form repository requests can use Codex or
OpenCode, with a provider choice persisted per repository. Codex detection is
shell-free. Noninteractive work uses bounded stdin context, a workspace-write
sandbox, explicit per-run approval policy, ephemeral state, ignored user config
and rules, disabled lifecycle hooks, bounded streaming, and renderer-owned
process-tree cancellation. Trusted project Codex config remains part of the
repository trust boundary because Codex CLI 0.144 has no verified blanket MCP-
disable override. Installation and authentication stay explicit: the UI shows the
official npm package command and terminal login guidance, never asks for a
credential. Agent completion never implies success — Desktop Material reruns the
selected Build & Run profile unless the user cancels; **Stop** suppresses that
rerun. See the feature guide at
[docs/features/integrations/local-ai-build-fix.md](docs/features/integrations/
local-ai-build-fix.md).

## M24 — Guided sparse checkout — **Local acceptance complete; publication verification pending**

The existing bounded cone-mode sparse-checkout operation is now a persistent
**Choose/Adjust/Restore → Review selection** flow with search, fuzzy filtering,
preview counts, zero-match protection, and confirmed execution. Sparse files are
tracked alongside the normal commit history and survive repo moves. See the feature
guide at [docs/features/repository-management/sparse-checkout.md](docs/features/
repository-management/sparse-checkout.md).

## M23 — Full Ollama manager — **Complete; published**

A purpose-built local Ollama lifecycle workspace separates health/version, installed
inventory, running state, and selected-model details. Supports search/filter, streamed
pull with cancellation, copy and guarded rename, load/unload, and confirmed delete.
Synchronizes the authoritative installed inventory back to the provider's selectable
Copilot model list. Endpoint validation requires one terminal /v1, permits only an
exact loopback base, and rejects remote hosts, arbitrary prefixes, credential-bearing
URLs, queries, and fragments. See the feature guide at
[docs/features/integrations/ollama-model-manager.md](docs/features/integrations/
ollama-model-manager.md).

## M22 — Owner-scoped management and complete visual refresh (July 19–20, 2026) — **Implementation complete; visual acceptance in progress**

Owner-scoped appearance customization via anchored right-click editors. Each owner
stores one bounded versioned setting.json in its own local Git repository below the
app's ppearance-elements user-data root. The General Appearance page holds ordinary
preferences only; Repository Settings has no Appearance tab. Toolbar and typography
owners are separate with full font/color controls. Tab strip follows a guarded
organization contract with pinned tabs, inverse-close matching, drag/keyboard movement,
and stable sorts.

## M21 — Advanced workflow completeness (July 19, 2026) — **Complete**

M21 closes the 30 demand-backed workflow gaps identified in the July 19 research brief.
The canonical item-by-item map is at
[docs/features/github-desktop-demand-backlog.md](docs/features/github-desktop-
demand-backlog.md). Implementation extends existing account, repository, Git, provider,
store/dispatcher, and Material UI contracts without introducing a new application HTTP
endpoint.

## M20 — Platform wave (July 17–18, 2026) — **Complete**

Platform support hardened: Windows x64/arm64 builds, full-unit and packaged-E2E lanes,
installer/portable-ZIP release workflow.

## Ongoing maintenance

- The uild-installers.yml workflow publishes exactly one uniquely tagged release after
  CI succeeds for every same-repository main push, including documentation-only pushes.
  Verify the exact SHA, CI gate, release target, and required non-empty assets for each
  final push.
- Keep account identity on endpoint#id; never collapse provider accounts by login or host
  alone.
- Keep profile settings, tab mutations, history operations, and multi-window updates on the
  serialized profile queue.
- Keep secrets out of profile/notification Git repositories, exports, logs, screenshots, and
  agent responses.
- Preserve Material token usage when adapting upstream or Desktop Plus code; do not import
  their branding or SCSS wholesale.

## Current maintenance acceptance

The following items track the current cycle's progress against all six acceptance gates:

| Feature / Gate | Status | Key Evidence |
|---|---|---|
| M26 Cheap LFS / Express Release | **Implementation complete** | 165/165 changed-surface tests across 18 suites; 34/34 transfer and localization tests; exact-source production build passed; comprehensive pointer-test, operations-test, manual-upload-test, automation-test, commit-entry-points-test, commit-status-refresh-test, github-release-transfer-test coverage; multi-part split upload with SHA-256 verification; browser handoff with version-2 manifest; super-express release workflow verified 4/4 focused tests |
| July 21 Settings queue and mobile connection | **Implementation complete** | Verified empty-account copy, persisted-policy hydration, required-directory validation, parallel/sequential changes, enable/disable dispatch, English/Cantonese/bilingual rendering, responsive-surface registration |
| July 21 responsiveness hardening | **Local implementation complete** | Deterministic regressions verified for remote scan terminator, late termination rejection, same-URL proxy coalescing, strict clone barrier, every prompt family, 500-update burst, failed request-ID reuse, and 25 Markdown reloads |
| M25 Repository-bound API functions | **Implementation complete** | Built-in function seeding verified; function-button execution tested; per-repository rail visibility persistence checked; responsive Explorer styles verified |
| Agent HTTP API | **Implemented** | All eight shipped route patterns audited; all 24 static command names verified; unit coverage spans REST forms, MCP discovery and calls, dynamic named functions, token rejection/rotation, Host/Origin policy, body limits, pairing expiry, device revocation, LAN mode boundaries, gateway policy, browser-link generation, unavailable-mode handling, queue bounds, shutdown, and redaction |
| M24 Guided sparse checkout | **Local acceptance complete** | Verified case-insensitive literal inverse-close matching, counts/preview/zero-match protection, pinned-tab safety, drag and keyboard movement, pin-group boundaries, stable one-shot label/opened/status sorts, persisted order, focus, announcements, and multi-window isolation |
| Actions workflow-run cancellation | **Complete** | Verified exact repository/account/run revalidation, cancellable-status gating, one normal cancel request with duplicate suppression, accepted-response polling, stale and terminal transitions, bounded provider errors, focus return, and compact confirmation layout |
| Reviewed current-branch rebase | **Complete** | Verified target search, current→target and ahead/behind context, bounded commit preview, fresh dirty/conflict/operation guards, exact ref/SHA revalidation, cancel-before-start, conflict continue/abort routing, protected-branch guidance, and no automatic force push |
| Provider account binding and OAuth scope alignment | **Complete; Git transport routing verified locally** | Verified repository-settings binding propagation without reopening, unique-match auto-binding, explicit multiple-account choice, no-match/stale/permission/SSO recovery, generation safety, no silent replacement of a valid binding, and the bounded epo user workflow notifications read:org sign-in scope set. HTTPS fetch, pull, push, post-push refresh, scheduled sync, refspec fetch, and remote-HEAD routing now preserve the exact stable repository account key; unbound organization remotes prefer a verified write-capable identity and missing explicit bindings fail closed |
| Compact Repository Tools, Remote Manager, and Regex Builder | **Complete** | Verified vertical reachability at short heights; readable remote name/URL/control columns before a stacked fallback; reflowed Regex Builder categories/tokens with a scrollable body and reachable footer; named controls, focus, zoom, and no page-level horizontal overflow |
| Detailed Pull All progress | **Complete** | Verified live per-repository state, bounded concurrency, completion summary, keyboard/accessibility semantics, compact-window containment, focused and full-suite coverage, the exact production build, and inspected off-screen evidence on main |
| Clone-style Add Submodule | **Complete** | Verified hosted-provider and URL selection, exact-account affinity, reviewed relative path/branch, duplicate and occupied-path rejection, bounded progress, cancellation, list refresh, keyboard labels, and minimum-window containment |
| Repository-wide feature revalidation | **Complete** | The historical revalidation verified the registered-surface and M0–M19 implementation inventory, focused and repository-wide tests, production builds/packages, isolated headless interaction, exact-SHA CI and installer runs, Pages, the seven-page wiki, and its then-current 52-image documentation gallery |
| Documentation gallery expansion | **M22 full refresh in progress** | README, wiki, and Pages now declare 66 app screenshots. All 66 must be recaptured from the final production build with synthetic data; stale monolithic appearance scenes are being replaced by actual-owner anchored scenes, and specialized large-file, repository-discovery, and submodule-management frames are being added. Final completion requires original-resolution privacy inspection and byte-identical Pages/wiki delivery |
| Complete notifications and Releases dashboard | **Complete** | Verified every GitHub notification page, confirmed local/remote Clear all with partial-failure retention, release status metrics and loaded-result search/filtering, rich asset metadata, scoped retries, responsive layout, and inspected headless evidence |

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
6. The exact commit is pushed to main, remote CI/Pages are green, and any
   temporary branch/worktree is removed only after merge verification.

## Evidence index

- [PLAN.md](PLAN.md) — complete implementation ledger and architecture
  contracts.
- [HANDOFF.md](HANDOFF.md) — build, test, headless UI, screenshot, privacy,
  publication, and cleanup receipts.
- [Run manifests](.codex/run-manifests/) — exact milestone commands and capture
  records.
- [Feature gallery](docs/wiki/Feature-Gallery.md) — user-facing screenshot index.
