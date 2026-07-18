# Desktop Material — Active parity handoff

## Outcome

The complete **M0 through M19** Material and guided Git/GitHub roadmap is shipped
on `main`; it turns audited capabilities into named, interactive app functions.
The separately guarded expert GitHub API Explorer is contextualized by the
selected repository and bound to its selected account and provider host. It
reviews mutations and bounds and redacts responses rather than acting as an
unrestricted command console.

The first four-function P0 wave is implemented, pushed, and production-UI
verified at exact source SHA `9e946fd527e5843b2fdba5de675a5476b0c80445`:
guided history deepening, native pull-request creation, Actions artifact
download/digest context, and effective branch-rules inspection. The typed
operation registry is also complete. Actions workflow-run and artifact
pagination then passed its exact production UI gate at
`0aca4420df88a0865a0223530b956209e131431d`. Attempt-aware job pagination,
exact job logs/re-runs, pending deployment reviews, and fork-run approval now
pass their production UI gate at
`2f40d8949aaa7ae4ce5418cd949c28c643da0a37`. Cryptographic artifact
attestation review/result UI, Actions cache manager, bounded Pull Request
Center, Release Manager, Issue Hub, and the named Git functions are all shipped
as the accepted M19 parity wave.

The current Pages source, README, and in-repository wiki sources are on `main`.
Pages deployment remains subject to the protected reviewed `main` promotion
path; historical branch-only publication receipts below are retained as
provenance rather than current status.

## 2026-07-18 multi-account push owner routing

- Push now passes the selected repository's resolved `accountKey` to Desktop's
  in-process credential trampoline. When multiple GitHub accounts share the
  same host, Git therefore authenticates as the repository owner instead of
  whichever account the credential helper happens to encounter first.
- The selector is stable account metadata, never a token, and is stripped
  before Git starts; it does not enter argv, the child environment, remote
  URLs, or logs. Explicit repository bindings remain authoritative, while
  legacy repositories keep the existing endpoint fallback.
- Regression coverage in `push-authenticated-git-test.ts` proves the account
  key reaches the credential-only execution option and does not leak into the
  environment. The focused account/push suite passes 10/10 and repository lint
  passes.
- Headless MCP preflight passed after restarting its existing scheduled task
  (server checkout `beed66ca6ed2503e6170ee1e1158247f1c2f0140`). The required
  production build could not launch the app because compilation stops on a
  pre-existing TypeScript error in `app/src/ui/preferences/agent-access.tsx`,
  outside this change. No screenshot was promoted for this non-visual fix.

## 2026-07-18 Build terminal OpenCode handoff and add-instead recovery

- After the user reviews consent and starts **Fix with opencode**, the launch
  dialog now closes, restores the Build & Run terminal, and leaves the entire
  OpenCode stream there. The detached repair still re-runs the real build to
  determine success; it no longer traps progress in a blocking log dialog.
- Detached `opencode run` has no interactive TUI answer surface. Its scoped
  config therefore denies the `question` tool (including overriding a global
  `ask` value for this repair), and the repair prompt tells the agent to make
  the safest minimal reasonable choice and explain it in terminal output rather
  than waiting on an invisible question. Existing edit/bash preferences remain
  preserved unless their scoped defaults were absent.
- A clone destination containing files now presents **Try to add instead** in
  the error banner. It sends that exact path through the existing add-repository
  flow, preserves the selected account binding, and closes only after a
  repository was successfully added.
- Repository lint passes and the focused push, path, OpenCode helper/runner,
  launch-dialog, and Build-panel suites pass 31/31. Production launch remains
  blocked by the pre-existing `agent-access.tsx` compilation error recorded
  above, so no misleading screenshot was promoted.

## 2026-07-18 direct public release creation

- Release Manager now opens **New release** rather than **New draft**. New
  releases default to **Publish immediately**, show the selected publication
  state in the immutable review, and submit a single GitHub create-release
  request with `draft: false`; successful completion reports `Published <tag>`.
- Turning **Publish immediately** off retains the reviewed unpublished-draft
  path. Existing drafts still retain their separate **Review publish** action.
- The previously shipped clone add-instead control now imports its Button
  component correctly, and the locally declared release API fixtures include
  the direct-create method. After restoring the already-locked QR dependency,
  the exact no-download MCP production build succeeds.
- Release API/store/view coverage passes 29/29, including exact `draft: false`
  request bodies, public-by-default review, explicit draft opt-out, account
  routing, stale review protection, and provider-safe failures.

## 2026-07-18 Build & Run OSS-fleet stress test

A 21-repository open-source corpus (express, vite, fresh, ripgrep, gin,
Newtonsoft.Json, flask, junit5, commons-lang, guzzle, sinatra, Alamofire,
dart args, elixir plug, scalatra, aeson, zls, jq, nlohmann/json,
awesome-compose, traefik) was cloned and driven through
`probeRepository`/`detectProfiles`. Findings and fixes:

- **Windows batch shims could never spawn.** Node's CVE-2024-27980 hardening
  makes `spawn` throw `EINVAL` for `.cmd`/`.bat` targets under
  `shell: false`, so npm/yarn/pnpm and Gradle/Maven wrapper stages failed
  instantly on Windows. The runner now routes resolved batch shims through
  `cmd.exe /d /s /c` with a strict argv allow-list (`batchSpawnSpec`) and
  verbatim arguments; any argument cmd.exe could reinterpret is refused,
  never escaped. Verified end-to-end with a real `npm install` in the
  express clone (exit 0, 403 packages).
- **Go run targets.** `go run .` was emitted even for library modules (gin)
  and cmd-layout apps (traefik). Detection now runs the root package only
  when `main.go` exists, otherwise prefers `cmd/<module-basename>` (parsed
  from `go.mod`, `/vN`-aware) with an alphabetical fallback; libraries get
  build-only profiles with an explicit reason.
- **XML solutions.** `.slnx` files rank and build like `.sln`:
  Newtonsoft.Json now surfaces `dotnet build Src/Newtonsoft.Json.slnx`
  (verified `dotnet restore` exit 0 on .NET SDK 11).
- **Auxiliary manifests.** A tooling-only `Gemfile` (Alamofire's fastlane)
  and a packaging `Dockerfile` (guzzle) no longer outrank the primary
  ecosystem in the same directory; both demote with an explicit
  `auxiliary to another ecosystem here` reason.
- New env-gated corpus suite
  `app/test/unit/lib/build-run/real-world-fleet-test.ts` (point
  `BUILD_RUN_FLEET_DIR` at a directory of clones) asserts non-throwing
  probing, at least one positive-score profile, shell-free argv commands,
  and deterministic ranking for every repo; it skips itself entirely in CI.

The sync pill also gained its missing state: **diverged** (ahead and behind
at once) now renders the pull shape in the amber family
(`--dm-sync-diverged-bg/on` over new `--dm-amber-on-container` tokens in
both themes) instead of borrowing the pull tone, so the pill signals that a
push will follow the offered pull. The post-shell style contract covers the
new state alongside the original five.

## 2026-07-18 UI fixes: submodule diff, subtree access, oversized→cheap-LFS

- **Submodule changes view revamped.** `submodule-diff.tsx` was restyled to
  Material Design 3 (tonal icon tile, path chip, info cards, an old → new
  SHA transition) and its stale "GitHub Desktop" branding fixed to the
  canonical `DefaultAppDisplayName` ("Desktop Material") — note
  `package.json`'s `productName`/`__APP_NAME__` is still the old string, so
  that path would not have fixed it. Added a "View on GitHub" action.
- **Subtree Manager always reachable.** Ungated the Tools-hub subtree entry
  from `subtreeCount > 0` so any Git repo shows it (subtrees are a pure-git
  feature) — the dialog's empty state now guides the user to add a first
  subtree. Submodule/cheap-LFS gating unchanged.
- **Oversized files auto-pin to cheap LFS.** When auto-pin-on-commit is on
  and the repo is Releases-capable, the "Files too large" (100 MB) warning
  is **pre-empted** — the commit proceeds and `_commitIncludedChanges`
  pins the oversized files to a release, committing pointers. When auto-pin
  is off/unavailable the warning still shows but gains a "Pin to release
  (cheap LFS)" button (a `forceAutoPinLargeFiles` flag through the commit
  path) gated on releases availability.

## 2026-07-18 Cheap-LFS automation and Commit & push all

- **Auto-materialize on detect (default on).** After a clone, a pull that
  brought pointers, a fetch, or on repo open, committed cheap-LFS pointers
  are automatically downloaded and reassembled into their real bytes —
  gated on a Releases-capable account, cancelable via a per-repo
  AbortController (also the re-entrancy guard), with a `cheap-lfs`
  completion notification. A manual **Materialize all** button in the
  Large files & storage panel runs the same batch with inline progress.
- **Auto-pin large files on commit (default on).** At commit time, any
  selected file over the ~100 MB push-size threshold that isn't already a
  pointer is pinned to the release (splitting >2 GiB) and committed as a
  pointer, so oversized files never break a push. A pin failure **aborts
  the commit** (emitError + return false before `createCommit`) rather
  than committing a half-pinned tree; a notification lists what was
  pinned. Gated on `getGitHubReleasesAvailability === 'available'`.
- **Repo-list "Commit & push all (pull first)".** A button next to
  Pull all opens a confirmation dialog listing the affected (non-clean)
  repositories and a required, user-confirmed commit message, then runs a
  bounded worker pool (concurrency 3, order-preserving) that per repo
  skips-if-clean, pulls first (conflicts isolate the repo as failed, never
  auto-resolved), commits all local changes with the user's identity/
  signing/hooks (not the bot-author path), and pushes (never forced).
  Per-repo failures are isolated so one repo never blocks the batch;
  progress uses the persistent PullAll-style run.

## 2026-07-18 Account, clone, and Releases fixes

- **Auto-switch account to the repo owner.** On selecting a repository the
  active account (positional `accounts[0]`, which drives the rail avatar
  and the unbound endpoint-fallback) now reorders to the repo's owning
  account, so the visible identity and unbound actions follow the repo.
  It reuses `getAccountForRepository`, so explicit bindings are respected
  and a signed-out/mismatched binding is never clobbered; it only fires
  when the owner actually differs (no churn), writes no binding, and never
  re-auths. Global toggle in Advanced preferences, default on.
- **Multi-clone no longer rejects a non-empty base folder.** The clone
  dialog only enforces the empty-folder rule for single-repo clones; with
  more than one repository selected each clones into its own
  `<base>/<name>` subfolder, validated per-repo by the batch flow.
- **Releases "could not load safely" now logs its cause.** The releases
  store logged nothing when it fell back to the guarded message; it now
  records the operation, status, error name, and a bounded message (no
  tokens) so the real cause — network/proxy vs. validation vs. scope —
  shows up in the Log History viewer. Confirmed the list validation is not
  over-strict (empty release lists load) and that scope failures surface
  as clear 401/403/404 messages, not the fallback.

## 2026-07-18 Cheap LFS — 2 GiB streamed uploads and auto-split larger files

- **Streamed uploads:** the release-asset upload path no longer buffers the
  whole file in RAM — it streams from disk with backpressure, hashing while
  streaming, Content-Length from the validated stat size, redirect handling
  unchanged. The per-asset cap rose from 128 MiB to **2 GiB** (GitHub's real
  release-asset limit). The `ReleaseUploadFetcher` contract now takes a
  streamable `{ path, offset, length }` source instead of a `Uint8Array`.
- **Auto-split:** a file larger than 2 GiB is split into `partNNN` assets
  (each ≤ 2 GiB), uploaded via byte-range streaming into the same release,
  with the mutation review re-fetched before each part. The pointer format
  is back-compatible: single-asset pointers are byte-for-byte unchanged;
  multi-part pointers append one `part <sha256> <size> <name>` line per
  part, and parsing validates that the parts' sizes sum to the whole-file
  size. Materialize downloads and verifies each part, concatenates in order
  while streaming the whole-file digest, verifies digest+size, then
  atomically replaces the pointer — any failure leaves the pointer intact.

## 2026-07-18 Clone progress — stage, %, speed, ETA, submodule phase

The clone progress experience was enriched from a bare bar into a Material
readout: the git **stage** (Receiving objects / Resolving deltas / Checking
out) with a numeric percentage, **transfer speed** and a derived **ETA**
(rolling-window rate in the store), and a distinct **Fetching submodules**
phase (indeterminate) that was previously an opaque pin near 100%. The git
progress parser now captures the throughput segment it used to discard;
multi-clone rows surface each repo's stage/description/percent, not just a
bar.

## 2026-07-18 Notification automations (context-menu-only, safety-gated)

A right-click **Automations…** entry on any notification row (the only
entry point) opens a builder for rules that fire a **webhook** or a **local
command** when a matching notification arrives. Non-negotiable safety, all
verified: every rule is **disabled by default** and its `enabled` flag is
**re-clamped to false on load**, so a rule restored/synced/imported through
its Git-backed store can never fire until deliberately armed in the current
session; webhooks run main-process-only on an isolated session with the
full SSRF guard set (manual redirects, https-only, credentials omit,
bounded response, content templated into the body never the URL); commands
run `shell:false` with every substituted argument re-validated against the
argv allowlist (refused, never escaped); and a receipt loop-guard stops an
automation firing on its own follow-up notification.

## 2026-07-18 Build & Run — fix errors with opencode

When a Build & Run stage fails, the panel now offers **Fix with opencode**:
launch the opencode AI coding agent to diagnose and fix the errors,
auto-installing it if missing, and running it in repo-scoped auto-approve
("yolo") mode.

- Plumbing: a pure install planner (npm `opencode-ai@latest` on every
  platform — no remote-script paths), argv/prompt/config builders
  (`opencode run --auto --dir <cwd>`, prompt bounded and passed via
  **stdin** so it never flows through the Windows batch-shim allowlist,
  a repo-root `opencode.json` permission block scoped `external_directory:
  deny`), and a main-process `OpencodeRunner` (detect via
  `opencode --version` + `opencode auth list`, install, run-fix, IPC,
  shutdown teardown).
- Success is measured by **re-running Build & Run** after the fix, never
  by opencode's exit code (it is known to exit 0 on failure).
- UI: a `PopupType.OpencodeFix` consent dialog — detect → (install with
  the exact command shown / prompt for `opencode auth login` /
  ready) → run with live streamed output and cancel → verify via the
  re-run, reporting Fixed or still-fails.
- Safety: the **offer** defaults on (so a failed build always surfaces
  it — merely showing the button is harmless), but **auto-approve
  (yolo)** defaults **off** and is an explicit per-repo toggle carrying a
  warning; installing opencode and enabling yolo are each separately
  consented; the prompt is fed via stdin; and yolo is strictly scoped to
  the repo's `--dir`.

## 2026-07-18 GitHub API Explorer — functions-first

The Explorer was reorganized from a browse-first catalog into a
functions-first surface (presentation only — no execution, review,
redaction, scoping, or persistence machinery changed):

- The saved runnable-function registry ("App functions") is now the
  primary surface at the top, retitled **API functions** with copy that
  frames them as saved, repo/account-bound, review-gated calls.
- The descriptive operation lists are reframed as a secondary **operation
  picker** ("Add a function from an operation" / "…from a GraphQL root"),
  and each row gained a one-click **Create function** button that
  prefills the builder and focuses the save-as-function form, so browsing
  an operation flows straight into creating a runnable function.
- The raw request builder is relabeled **Manual request** and kept as the
  always-available fallback — still the only surface when a catalog is
  unavailable (fail-closed GHES).
- Every guard chokepoint is unchanged: mutation review, response
  bounding/redaction, and endpoint/account scoping all still gate every
  request.

## 2026-07-18 Release-backed "cheap LFS"

A new **Large files & storage** tools-hub category hosts a cheap-LFS panel:
instead of real Git LFS, a chosen large file is uploaded to a GitHub
Release asset and a small text **pointer file** is committed in its place;
materialize downloads the asset and restores the real bytes.

- Plumbing: `api.fetchReleaseByTag` + a store `getReleaseByTag`; a pure
  pointer model (`cheap-lfs/pointer.ts` — serialize/parse, path-safety
  validator stricter than repository-lfs, CRLF/BOM-tolerant read,
  stable `\n` write); and `cheap-lfs/operations.ts` with streamed
  sha256 hashing, `pinFileToRelease` (128 MiB cap enforced before hash,
  find-or-create-draft-release, upload, write pointer),
  `materializePointer` (download to a same-volume sibling temp, verify
  sha256 **and** size, atomically rename over the tracked file — working
  around the download layer's refuse-to-overwrite), and a bounded
  `listCheapLfsPointers` working-tree scan.
- Panel: review-gated, lists pointers with the FilterModeControl search,
  per-row Materialize with progress/cancel, and a Pin flow (file picker,
  tracked-path + tag form, inline cap/path validation) — plus explicit
  copy that this is **not** real Git LFS, other clients see only the
  pointer text, and draft-release assets are visible only to signed-in
  app users until published.
- Honest limits recorded: 128 MiB upload cap (buffered upload), draft vs
  published visibility, and the same-volume temp-replace assumption.

## 2026-07-18 Repository Tools catalog reorganization

The tools hub's taxonomy was rebuilt for scanability: seven
plain-language categories ordered by everyday frequency — Status &
branches, Search & inspect, Commits & history, Nested repositories
(gated, submodules + subtrees), Cleanup & maintenance, Share & transfer,
Repair & recovery — with entries alphabetical within each (enforced by a
shared comparator, rule documented on `HubCategoryOrder`). All 24 entry
ids and titles are unchanged; ~15 vague descriptions were rewritten as
one-line "what you'd use this for" sentences. Category headers gained
one-line subtitles, filter chips derive from the categories actually
present, and a latent invalid-HTML-id bug in the detail-pane header was
fixed with a slugifier. Contract, responsive, and RTL suites extended
additively.

## 2026-07-18 Git subtree manager

A full subtree vertical slice mirroring the submodule manager (the bundled
dugite git 2.53 ships contrib `git-subtree`, verified by a memoized
capability probe that still gates the UI defensively):

- Plumbing in `git/subtree.ts`: `discoverSubtrees` (trailer-driven —
  `git log --grep=git-subtree-dir:` through the existing `getCommits`
  trailer parsing, deduped by prefix), `addSubtree` / `pullSubtree` /
  `pushSubtree` (URL-resolved sources, `envForRemoteOperation` +
  `credentialAccountKey` + auth-error handling, progress via the
  fetch/push parsers — no `--progress` flag, git-subtree rejects unknown
  options), `splitSubtree` returning the split-head SHA, and prefix
  validation that rejects before spawning.
- `PopupType.SubtreeManager` / `PopupType.AddSubtree` dialogs: discovered
  list (short split/merge SHAs), required FilterModeControl search,
  per-row inline Pull/Push/Split editors (remote select + custom-URL
  fallback, ref, squash on pull, branch on split), and an add dialog
  composed from the add-submodule building blocks (provider tabs +
  account picker + URL tab, squash default on).
- Tools-hub entry (Maintenance) gated by discovered-subtree count,
  following the pinned submodule gating idiom; contract, modality, and
  RTL suites extended.

## 2026-07-18 Submodule config manager

Every submodule row in the Submodule Manager (and the Repository Settings
Submodules tab) gained a **Configure** action opening a per-submodule
config dialog:

- Edits the tracked `.gitmodules` keys — URL (`git submodule set-url` +
  sync), branch (`set-branch --branch/--default`), update strategy,
  ignore, shallow (tri-state), and fetchRecurseSubmodules — with an
  "inherit default" sentinel that clears a key, diff-only saves that call
  exactly the changed operations in order, and per-step inline errors.
- Action row: Sync, Init (uninitialized only), and a confirmed
  force-Deinit.
- New plumbing: file-targeted `git config -f` helpers in config.ts
  (idempotent unset), `setSubmoduleUrl` / `setSubmoduleBranch` /
  `setSubmoduleConfigKey` (value-validated before spawning git) /
  `initSubmodule` / `deinitSubmodule` in git/submodule.ts (removeSubmodule
  now reuses deinit), and `.gitmodules` parsing extended so
  `IManagedSubmodule` carries the four config keys.
- `PopupType.SubmoduleConfig` registered as a normal modal popup; the
  submodule contract test and popup-modality test pin the new surface.

## 2026-07-18 In-app log viewer, verbose logging, Git-backed log history

Logging is now a first-class, inspectable surface:

- A renderer `LogStore` (modeled on the notification-centre store) tees
  every logged line into a Git-backed repository at
  `<userData>/log-history/` tracking `app.log` (working file capped at the
  last 5000 lines; full history stays in Git), with debounced
  "Capture log activity" commits, undo/redo/restore, and the shared
  history surface.
- A dependency-free log sink hook in the renderer logging shim forwards
  every formatted line; debug lines flow only when verbose logging is on.
- New **Verbose logging (debug level)** checkbox in Advanced preferences,
  persisted and plumbed over a new `set-verbose-logging` IPC channel so
  the main process raises the previously hardcoded winston file-transport
  level from `info` to `debug` at runtime.
- New non-modal **Log history** dialog (`PopupType.LogHistory`) — a thin
  wrapper over the shared `VersionedStoreHistory` panel, so timeline,
  diffs, undo/redo/restore, and the FilterModeControl search (with the
  regex builder) come standard. Reachable from Help → View Log History
  and the command palette ("View log history").

## 2026-07-18 Regex builder on every filter bar

Every persistent search/filter surface in the app now carries the shared
`FilterModeControl` cluster (fuzzy/substring/regex mode cycle, match-case
toggle, and the regex-builder launcher) with its mode persisted per surface.
The wave covered the 23 surfaces that lacked it: the three
`SectionFilterList` consumers that only needed a `filterListId` (worktrees,
account picker, Copilot model picker); the five Actions surfaces (runs
filter, workflow manager, workflow catalog, cache manager, and the
find-in-job-log search with mode-aware match navigation); the six
shell/tab surfaces (command palette, Material context-menu filter, tab
search, arrange tabs, close-tabs-containing — its inverse "keep" variant
deliberately stays a documented literal substring for destructive-action
safety — and the tab-style-editor font search); the five repository
surfaces (in-diff search with mode-aware occurrence navigation, submodule
manager, gitignore templates, tools catalog, provider triage); and the
four GitHub views (issues search, REST + GraphQL API-explorer catalogs,
notification centre). Bespoke one-off regex toggles were replaced by the
shared control everywhere they existed. All `FilterModeControl` and
regex-builder buttons now declare `type="button"` so dialog-form hosts
(the command palette) cannot implicitly submit. A completeness sweep
confirmed no remaining filter bar lacks the affordance; compact popovers
hide the launcher label via their own SCSS while keeping the aria-label.

## 2026-07-17 Docker builds, sync-pill vibes, auto-build-on-pull, and list typography

The three urgent goals previously recorded at the top of this handoff are
implemented on `claude/handoff-md-implementation-3b529c`:

- **Docker build actions.** Build & Run detects `Dockerfile` and Docker
  Compose (`docker-compose.yml`/`.yaml`, `compose.yml`/`.yaml`) projects as a
  first-class `docker` ecosystem with argv-encoded `docker build .`,
  `docker compose build`, and `docker compose up` stages, a `docker --version`
  toolchain probe, nested-directory manifest markers, and stable
  `docker:image` / `docker:compose` profile ids (compose outranks the plain
  image build when both exist). Docker deliberately does not suppress the
  generic Make fallback — a Dockerfile packages a project without replacing
  its native build — and stays out of the winget auto-install path.
- **Sync-pill vibes.** Every push/pull toolbar state now carries a
  `push-pull-button--<state>` modifier on both pill shapes (single-button and
  split-button, whose backgrounds live on different DOM nodes), themed through
  new `--dm-sync-*` background/on-color token pairs: neutral fetch, secondary
  container pull, primary container push, green publish, and error-container
  force push, whose ahead/behind badge and disclosure chevron also adopt the
  error family. The aliases are declared on `body` — not `:root` — so dark
  theme, curated accent palettes, and the neutral surface variant all flow
  through the var() substitution; publish gained a dedicated
  `--dm-green-on-container` tone that passes AA on the 0.75-opacity
  description line.
- **Auto build after pull.** A per-repository, default-off Build & Run
  preference `autoBuildOnPull` ("Build after pulling new commits") starts the
  selected profile only when an interactive pull actually moves the branch tip
  to a new commit, no build-run is already in flight, and both tips are valid
  branches — decided by the pure, tested `shouldAutoBuildAfterPull` helper.
  Build problems never surface as pull failures. The preference participates
  in the repository equality hash so saving the checkbox takes effect
  immediately, the post-pull read re-resolves the live repository instance
  (the pull can swap in a refreshed instance whose state is keyed by a new
  hash), and the localhost agent API's `pull` command passes
  `autoBuild: false` so a remote command can never spawn build or run
  processes as a side effect.
- **Repository-list fonts.** Repository appearance overrides gained a
  validated `listNameStyle` Word-style typography field — curated font
  family, size clamped to the row-safe `MaxListNameFontSize` (18px),
  bold/italic, and the rest of the tab title-style model — stored beside the
  logo in the repository's local `desktop-material.appearance` Git config,
  resolved and LRU-cached through the shared bounded logo loader in one
  config read, applied to the list row's name through `tabTitleStyleToCss`,
  and edited in Repository Settings → Appearance with a live preview that
  reproduces the row's real base typography.

A three-dimension adversarial review (correctness, security/invariants, and
UI/style consistency, with every finding independently re-verified against
the code) confirmed nine defects, all fixed before commit: the
stale-preference equality hash, agent-surface auto-build exposure, the
light-theme accent freeze of `:root`-declared aliases, the 32px-size versus
29px-row mismatch, publish description contrast, the force-push badge color
mismatch, the misleading typography preview baseline, the stale post-pull tip
read after a mid-pull repository refresh, and docker suppressing make.

Local verification in this checkout: 105 focused tests across the build-run,
appearance, and style-contract suites pass, including 11 Docker detection
cases, 9 auto-build decision cases, the new typography validation cases, and
a new sync-pill style contract; repository-wide `tsc --noEmit` introduces
zero new errors against the pre-change baseline; changed-file Prettier and
repository-rule ESLint are clean. The loader, list-row, and Git-config
round-trip suites were extended for the new appearance payload but cannot
execute in this checkout because it lacks the `dugite`/`@testing-library`
dependencies; they run in CI. No production build or headless UI gate was run
for this wave.

A parallel implementation of the same three goals on
`claude/ui-clipping-material-design-g5g3n9` was superseded by this reviewed
wave when the branches were merged to `main`; that branch's distinct
clipping/token/accessibility polish pass (next section) was kept in full.

## 2026-07-17 clipping, Material-token, and accessibility polish pass

A dedicated audit swept all 219 stylesheets and the Material shell components
for text clipping, pre-Material styling leftovers, and keyboard accessibility.
Dialogs now use the MD3 extra-large radius and level-3 elevation instead of the
legacy 6px Primer card; the title bar, window controls, CI status popover,
avatar stack, tab bar, tooltips, toast/repository `kbd` chips, and commit drag
badge all route through `--md-sys-*`/`--dm-*` tokens (with a new `--dm-on-green`
on-color for dark-mode contrast). Fixed pixel heights on app-bar chips,
repository tabs, menu rows, dialog headers, and buttons became min-heights so
larger user-selected interface fonts grow controls instead of clipping, the CI
check-run description lost its hard 250×12px clip box, and the branch list
description gained the ellipsis treatment. Keyboard users can now see the tab
close button on focus, the tab rename input has an accessible name and focus
ring, the tab-strip search fields have focus-within indicators, split-button
dropdown options highlight tonally on focus-visible, and notification unread
state is exposed to screen readers rather than being color-only. Validated
with a full Sass compile, TypeScript, ESLint (custom rules), Prettier, all 31
style-contract suites (110 tests), and the affected component suites
(258 tests), all passing.

## 2026-07-17 Build & Run auto-build hardening

The one-click Build & Run auto-build now works across every detected
ecosystem, on every supported host, including complex builds whose
dependencies must be installed automatically:

- **Toolchain auto-install is no longer Windows-only.** The pure
  `planToolchainInstall` mapping now covers winget on Windows (extended from 5
  ecosystems to Node/Bun, Python, Go, Rust, .NET, Deno, Java via Temurin JDK
  plus Gradle/Maven, PHP, Ruby with DevKit, Elixir, sbt, Swift, Zig, CMake,
  and GNU Make), Homebrew on macOS (same coverage plus Composer, Dart,
  Flutter and the Haskell toolchain; the JDK installs as the `temurin` cask so
  wrappers and `/usr/bin/java` find it, and brew steps are never elevated),
  and runtime-provisioned package managers on every platform including Linux:
  `yarn`/`pnpm` via Corepack, `pipenv`/`poetry` via pip, and Bundler via gem.
- **Missing-dependency auto-fix covers every dependency-managed ecosystem.**
  `planRemediation` now receives the plan's install-stage commands and
  proposes ordered multi-command remediations. Build/run stages that fail on
  missing packages re-run the profile's install commands (or a sensible
  ecosystem default) before retrying: Node missing-module errors, Python
  `ModuleNotFoundError`, `go mod tidy` for missing go.sum entries, `cargo
  fetch`, `dotnet restore` on NU1101/NETSDK1004, `composer install` on a
  missing `vendor/autoload.php`, `bundle install` on `Bundler::GemNotFound`,
  `mix deps.get`, `dart pub get`, `swift package resolve`, `sbt update`, and
  a bounded plain retry for transient Gradle/Maven resolution failures. The
  Python venv fix is now correctly scoped to the install stage, and the
  per-stage retry budget is unchanged.
- **GUI-launched builds on macOS/Linux now find their toolchains.**
  `resolveRunEnv` appends the well-known Homebrew and per-user tool
  directories (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.cargo/bin`,
  `~/go/bin`, `~/.local/bin`, `~/.deno/bin`, `~/.bun/bin`,
  `~/.pub-cache/bin`, `~/.dotnet/tools`, `~/.mix/escripts`) to PATH off
  Windows, mirroring the existing registry-based PATH refresh on Windows, so
  both the initial probe and the post-install re-check see what a terminal
  would.

The runner threads install commands into the auto-fix planner and executes
multi-command remediations sequentially with the existing cancellation
checks; the Repository settings auto-install copy and the plan/type docs now
describe the cross-platform behaviour. Focused verification in this
environment: the rewritten `auto-fix`/`toolchain-install` suites plus the
existing detect/gitignore suites pass (128 tests), the IPC-contract,
toolbar-overflow-layout, and post-shell style suites pass (32 tests), and
repository-wide `tsc --noEmit --skipLibCheck`, changed-file ESLint with the
repository rule directory, and Prettier are clean. No production UI gate was
run in this Linux container.

## 2026-07-17 recovery, custom logos, app functions, and responsive completion

Clone account changes now invalidate stale provider selections and reload the
new account before a repository can be chosen. Automatic clone work is owned by
an app-lifetime background store instead of a blocking dialog. Its versioned
journal preserves queued, running, paused, interrupted, failed, and
review-required items across renderer or process restarts, with explicit
pause/resume/retry/dismiss controls. Clone recovery rejects credential-bearing
URLs, unsafe canonical paths, origin mismatches, non-owned worktrees, symlink
escapes, and time-of-check/time-of-use path changes; displayed failures redact
credential material. Recovery finalizes only repositories which were actually
added to the app: a temporarily unavailable completed clone remains journaled,
visibly needs attention, exposes **Retry adding repositories**, and cannot emit
or suppress its completion summary prematurely.

Repository appearance now includes a code-native vector logo studio rather
than another set of dropdowns. Profiles can define a default and individual
repositories can inherit or override it. The bounded model supports presets,
text and mark layers, transforms, colors, live preview, undo/redo, and guarded
JSON import/export without accepting raw SVG. The selected logo propagates to
the repository list and open tabs through the shared bounded loader.

The API surface now exposes saved, versioned **app functions** with stable
names, exact repository/provider/account bindings, reviewed mutation behavior,
bounded redacted output, SHA-256 fingerprints, and the same catalog through the
app, local Agent API, MCP, and REST adapters. Malformed persisted state fails
closed and never stores credentials. The GitHub API Explorer can create,
inspect, execute, update, reload, and remove these functions.

The final review also replaced three regex-based GraphQL token strippers with
one shared lexical scanner. Comments are recognized only outside strings,
ordinary escapes and escaped triple quotes in block strings remain contained,
and malformed strings fail closed. Exact lexical-decoy regressions prove that a
retained mutation cannot be classified or invoked as a noninteractive read.

The responsive smoke catalog accounts for every registered repository page,
preferences page, repository-settings page, clone and notification tab, File
History surface, and safely orchestrated dialog/menu surface. All 76 applicable
rows passed all eight viewport/zoom scenarios; the three unavailable fixture
integrations are explicit N/A rows, with zero failures, blockers, missing rows,
document-width overflows, unreachable scroll bottoms, or unnamed buttons. The
scenarios include the 320×240 CSS viewport produced by 200% zoom as well as
short, portrait, standard, and wide layouts. The complete 79-row evidence is in
`docs/verification/responsive-surface-matrix-2026-07-17.json` (SHA-256
`108c4c444feda61bb890d341cc83fb5bc27c008695fe9f384114d6499ed9532b`).

| Promoted screenshot | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-repository-logo-studio.png` | 960×660 | 110,716 | `791c67e611a87c9e7e716616c1031c3bf696cd8acdb7f98aa1fbdffb36858777` |
| `docs/assets/screenshots/material-api-app-functions.png` | 944×1000 | 126,774 | `10d635a3e884902d4e791258e9cb470c83be0b268aa4e88aaab537601bb6a3f5` |

The exact required unpackaged production build completed through the fixed MCP
endpoint in 365.14 seconds under concurrent verification load, without a
timeout or dependency download. Full TypeScript, repository-aware ESLint over
77 changed source files, Prettier over 113 supported files, and diff-integrity
checks passed. The final sequential unit run covered 457 files in two batches:
3,139 tests across 863 suites, with 3,138 passing, zero failures, and one
intentional skip. The focused script harness also passed all 15 tests; the
post-review clone/API audit passed all 59 tests.

The first remote CI attempt (`29571690398`) then caught two existing
account-binding tests whose clone destination was hard-coded as a Windows path;
the strengthened absolute-path contract correctly rejected that fixture on
macOS. The tests now derive the same parent/name destination with the host
platform's `path.resolve` instead of weakening production validation. The
account-binding, batch model/journal/recovery, and auto-clone retest passed all
48 tests locally before the corrective push.

The hidden run used only `DesktopMaterialP0_20260717_0139`, saved app PID
`8700`, provider PIDs `14392`/`6460`, provider port `61130`, and CDP port
`61241`. The generic alternate-desktop close route failed closed, after which
the exact revalidated app PID was terminated gracefully. The disposable
credential was deleted and read back absent; all recorded PIDs and both ports
reached zero; the named desktop closed exactly once; and the containment-checked
owned Temp root was removed and verified absent.

### Publication checkpoint

- The implementation, evidence ledger, screenshots, and canonical docs were
  committed and pushed without force at
  `fb15895289341f2e197fe9857e55ebfefab65497`. The platform-neutral test-fixture
  correction and its failure receipt were pushed at
  `a052e322f6fa47a6bc26fc7baf737fc747065ed2`.
- Corrective CI run `29572459399` completed successfully for exact SHA
  `a052e322f6fa47a6bc26fc7baf737fc747065ed2`: lint, Windows x64/arm64, macOS
  x64/arm64, and Windows/macOS E2E smoke all passed. Corrective Build Installers
  run `29572459417` also completed successfully, including Windows x64.
- Pages run `29571690395` completed successfully for the implementation SHA.
  The live page returned 200 with both new gallery entries; the raw logo-studio
  and API-function PNGs returned their exact promoted byte lengths and SHA-256
  values.
- The separate wiki preserved its remote-only `Images/` directory and overlaid
  only Agent API, Developer Guide, Feature Gallery, and User Guide. Wiki
  `master` was committed and pushed without force at
  `905047f4cc7e0934516ea0ebaf79c4510f4385ed`; local, tracking, and direct remote
  SHAs matched. The rendered gallery returned 200 with all 63 named entries and
  both new images, and the rendered User Guide contained the new API-function
  and logo guidance.
- After remote proof, the containment-checked disposable wiki checkout was sent
  to the Recycle Bin and verified absent. Main had one worktree, one local
  branch, no stashes, and no unintegrated or divergent tip.

## 2026-07-16 navigation, context actions, and scroll containment

Repository tabs now have a runtime search/switcher across labels, aliases,
paths, and clone URLs. Arrange Tabs has its own literal multi-key filter while
one-shot sorts continue to apply to all open tabs. The repositories side sheet
adds independent exact-account and provider-service scopes, including explicit
local-only, unavailable-account, and unknown/signed-out states.

Every button receives a discoverable shared hover and keyboard-focus hint.
History commit rows own their specialized context path: right-click, Context
Menu, `Shift+F10`, and the named More button all build the same action set from
the effective selection, so an unselected clicked row cannot accidentally act
on an unrelated multi-selection.

Repository Tools now wins the real compiled Material-card cascade with an
owned vertical scroll region. The production gate reached its exact bottom at
regular, `640×480`, `960×420`, and 150% zoom layouts with the final named
control inside both the surface and viewport.

| Promoted screenshot | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-tab-search.png` | 1000×687 | 91,055 | `1a18b970c9aaffe4716be61cbbc84afa34cad6395a9e2e35bdfe48472396abc5` |
| `docs/assets/screenshots/material-history-context-actions.png` | 1000×687 | 92,197 | `c5c2b722a4c79979ce3973ed8ce921fb1eac661caa1c03ace2317d4f81ef0ec0` |
| `docs/assets/screenshots/material-repository-tools-scroll.png` | 960×420 | 29,840 | `d39dad61015ca333fbb95d388a8d75d7484a662d85f068e99a4b5fefa80f8b45` |

The exact hidden-desktop verifier and safety/build/geometry receipts live in
`.codex/run-manifests/2026-07-16-navigation-context-scroll.md`. The app process,
desktop, CDP listener, and disposable fixture were removed after promotion.

The **July 16 adaptive customization maintenance release** also passed its exact
production build and off-screen interaction gate at tested code source
`c5205838dfc5ee2b7ce80ce488215a2cd903bb26`. It adds profile/repository/tab
appearance, measured app-bar overflow, pure Material entry surfaces, guarded
tab close/arrangement, workflow-run cancellation, reviewed rebase,
repository-account propagation, bounded OAuth scopes, and compact-surface
corrections. Its detailed acceptance receipt and seven inspected captures are
recorded below.

The final feature-completeness audit closes every current roadmap maintenance
item. Detailed Pull All progress passed its production/headless/a11y gate at
`1bc8a226de`; exact shipped commit `36197bf6dd` then passed CI run
`29490902486` and installer run `29490902407`. Pages run `29489043545`
deployed the then-current 51-image gallery, and the public seven-page wiki carries
the same inspected release documentation. A final focused checkout pass added
37/37 green registration, Pull All, checkbox, compact-style, and Pages-gallery
tests to those repository-wide and off-screen receipts.

## 2026-07-16 notification triage and error notices

The notification centre now supports explicit Local/GitHub sources, text
search, source-appropriate filters, select-all-visible, and bounded bulk
triage. Local rows can be marked read or unread and deleted together in one
history-backed mutation; GitHub rows can be marked read or done only within
the loaded account/filter context. The former trash-only affordance is now an
explicit **Clear all** action with a visible non-modal confirmation and a
notification-history recovery explanation.

Generic errors that previously opened a blocking acknowledgement-only dialog
now appear as bounded, dismissible red notices in the bottom-right corner by
default. **Preferences → Notifications → Application errors** can restore the
legacy blocking-dialog style. Authentication, retry, file-size, Copilot, and
other flows that require a decision or remediation remain dialogs regardless
of that preference. Safe error summaries continue to be written to the local
notification history independently of the transient notice stack.

| Promoted screenshot | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-error-notice.png` | 1000×687 | 101,359 | `953467ac7846bf01ec3090b01b15938c35e7be2ee73bd0638e1df3bfeaf3fe0b` |
| `docs/assets/screenshots/material-notification-bulk-actions.png` | 1029×600 | 101,445 | `b3ca2875c1080733e832df49bc0680e7711ad650809c33149382f96fe8cf7c32` |

Focused notification, error-routing, preference, profile-history,
responsive-style, and React interaction coverage first passed `68/68` tests
across 21 suites. The final combined source, Pages, and 58-item wiki-gallery
gate passed `84/84` tests across 24 suites. Full TypeScript,
repository-aware ESLint, targeted Prettier, diff integrity, and the exact
unpackaged production build also passed; the final MCP build emitted every
webpack target in 131.72 seconds without a timeout or dependency download.

The accepted app-native geometry had equal document/body client and scroll
widths. The normal error notice stayed fixed entirely inside a 1000×687 CSS
viewport with no card overflow. In the short-height notification gate, the
panel stayed inside a 1029×600 CSS viewport; its source surface measured
374/374 pixels client/scroll width and 473/486 pixels client/scroll height
with `overflow-y:auto`. Exactly three filtered rows were selected, all named
bulk controls were reachable, and the Clear-all recovery confirmation remained
visible. Both promoted PNGs were reopened at original resolution and contain
only the deterministic `git-source` fixture and synthetic error copy.

The fixed low-level MCP ran only on the uniquely named off-screen desktop. The
final saved launch PID `12760`, runtime HWND `7406868`, and CDP port `57931`
were revalidated. The alternate-desktop generic close path failed closed, so
only the exact owned Electron process set was terminated; the listener reached
zero, the desktop listed zero windows and closed, and the containment-checked
Temp root was removed. A stale post-interaction HWND frame was rejected because
its hash matched the pre-interaction frame; only current app-native pixels were
promoted.

### Publication checkpoint

- Main implementation, documentation, verifier, and screenshots were committed
  and pushed without force at
  `67411a6bfaed2d411b35bd9e9026e487f23bc54a`.
- Pages workflow `29552951424` completed successfully for that exact SHA. The
  live Pages render referenced the bulk-action image, and both raw-main PNGs
  returned 200 with their exact promoted byte lengths.
- Build Installers workflow `29552951386` completed successfully for that exact
  SHA; its Windows x64 installer job passed.
- CI workflow `29552951433` completed successfully for that exact SHA: lint,
  Windows and macOS E2E smoke, Windows x64/arm64, and macOS x64/arm64 all passed.
- The separate wiki preserved its remote-only `Images/` directory and overlaid
  only the four reviewed canonical Markdown files. Wiki `master` was committed
  and pushed without force at
  `5ac1ebfa3427fab7b3d49ebe2cea7ff010a715c5`; local, tracking, and direct remote
  SHAs matched. Live Feature Gallery and User Guide renders contained the new
  guidance, and the containment-checked temporary checkout was removed.

## 2026-07-16 GitHub API Explorer release

The repository rail now includes a GitHub API Explorer contextualized by the
exact selected repository and bound to its selected saved account and provider
host. Its complete searchable catalog contains all 1,206 current REST
operations and identifies exactly 10 operations added since the prior pinned
2026-03-10 catalog. The request builder supports REST and GraphQL, requires
exact-request review before a mutation can run, and keeps displayed response
headers and bodies bounded and credential-redacted.

The accepted evidence uses the deterministic synthetic
`material-fixture-owner/material-fixture` repository and provider identity. The
catalog's **New operations** scope shows 10 of 10 operations; the selected
repository custom-pattern read completed with a synthetic 200 response. No
personal account, credential, or private repository identifier appears in the
capture.

| Promoted screenshot | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-github-api-explorer.png` | 944×1000 | 129,807 | `0115fb552e5212d7d326eb36197e4499f03dd99707b0ebb18c5c3fddf6082228` |

README, Pages, User Guide, and Feature Gallery sources now reference this
evidence. The machine-checked guided gallery therefore contains 56 distinct
named functions or states, each backed by one distinct tracked PNG.

The exact unpackaged production build passed twice through the off-screen MCP
runner; the final rebuilt-source run exited 0 without a timeout in 126.5
seconds. The accepted app-native client was 944×1000 physical pixels
(983×1041 CSS pixels at DPR 0.9599999785), with equal document/body client and
scroll widths and no element outside the horizontal viewport. The verifier
confirmed 10 rows and 10 **New** badges, the expanded synthetic repository path,
the 200 response, and both deterministic custom-pattern names. The disposable
credential was deleted and read back absent; the saved Electron and provider
PIDs, their two loopback ports, the uniquely named desktop, and the
containment-checked fixture root were all confirmed gone after capture.

## 2026-07-16 function screenshot catalog

The wiki now treats the Guided Feature Gallery as a machine-checked visual
catalog: 56 named, user-facing workflows or states each own one distinct PNG.
Core History browsing, local Agent access, and the repository-contextual GitHub
API Explorer are included in the manifest and its rendered image body. Eight unused
legacy captures with obsolete or clipped UI were removed, leaving no tracked
PNG unassigned and no screenshot reused for a second catalog row. Home, User
Guide, and Developer Guide link or describe the same canonical catalog, and a
focused unit contract rejects missing, duplicate, unrendered, or unassigned
assets.

The exact MCP endpoint and scheduled task passed preflight against low-level
checkout `806d9ba85e4afbc2af58d7499496babfa7c68891`. The service PATH no longer
contained a global Yarn command, so the first build stopped before compilation.
A temporary owned shim then invoked the already-cached Yarn Classic package in
offline mode; the required `npx --no-install cross-env
RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod` command
completed with code 0, no timeout, and no dependency download.

The compact visual check used only hidden desktop
`DesktopMaterialFunctionCatalog2026071601` (creation handle `972`), launch PID
`7624`, runtime HWND `4392554`, CDP port `9347`, and the synthetic
`material-fixture@example.invalid` identity. The first 960×660 MCP frame was
clean and the Configure Git renderer measured 1000/1000 document and body
widths with seven named controls and no horizontal clipping. Native hidden-HWND
resize was unavailable. A later post-CDP PrintWindow frame retained stale
compositor regions, so it was rejected and no replacement image was promoted;
the catalog uses only previously inspected current assets. The exact PID,
listener, hidden desktop, disposable fixture/profile/captures, and owned Temp
root were all verified absent after cleanup. The unrelated OAuth manifest and
detached foreign worktree remained untouched.

## 2026-07-16 clone-style Add Submodule release

**Repository settings → Submodules → Add submodule…** now opens a dedicated
Material popup with the same GitHub.com, GitHub Enterprise, URL, and GitLab &
Bitbucket source model as Clone. Hosted tabs preserve exact-account affinity
and repository browsing; URL mode accepts validated HTTPS, SSH, and local Git
sources. The review binds the source to a safe repository-relative checkout
path plus an optional tracked branch before Git starts.

The Git boundary revalidates duplicate and occupied destinations against the
live superproject immediately before spawn, forwards the selected credential
account only to the remote operation, reports bounded clone progress, and owns
an abort signal plus exact process callback. While Git runs, inputs freeze but
**Cancel operation** remains active; success refreshes the underlying managed
submodule list.

Verification is green: 53 focused model/UI/Git/popup/style/Pages tests,
TypeScript, changed-file ESLint and Prettier, the complete 1,190-test suite, and the exact
unpackaged production build. The build and UI gate ran through low-level MCP
checkout `806d9ba85e4afbc2af58d7499496babfa7c68891` on the single hidden desktop
`DesktopMaterialAddSubmodule2026071601`. The visible desktop was never shown,
focused, resized, or used for input.

Chromium accepted the initial HWND-targeted onboarding click but its next
PrintWindow frame became a stale black compositor surface, so the isolated
loopback CDP endpoint was used for renderer interaction and capture. At the
app's minimum logical `1000×688` renderer, the popup measured `(129,59)` to
`(919,677)`, document/body widths were `1000=1000`, the internal scroll region
was `790=790`, every required control was named and keyboard-reachable, and the
review retained the synthetic source/path/branch. Native off-screen resize was
unavailable; a requested `700×650` CDP emulation was clamped to the app's
supported logical minimum/auto-fit behavior and is recorded as a limitation,
not as a native-size claim.

The accepted `1500×1032` screenshot is
`docs/assets/screenshots/add-submodule-dialog.png` (109,198 bytes, SHA-256
`9ebfe5d94f7f624736c6fada706ee15279754102735d01d63d201b322ad10834`).
It contains only the synthetic `superproject` and `.invalid` URL. README,
Pages, Home, User Guide, and Feature Gallery sources reference it, bringing the
guided gallery to 52 inspected images. The exact launch PID `13704`, its
windows, CDP listener `59317`, hidden desktop, ephemeral tooling, profile,
fixture, and owned Temp root were revalidated and removed; the desktop reached
zero windows before closing.

The assembled Pages source also passed the isolated browser gate at desktop
`960×660` and mobile `390×844` viewports: all 54 image instances loaded, all 53
gallery cards rendered, document/body widths matched their scroll widths, and
no control or content crossed the viewport. Its exact HTTP/browser PIDs,
loopback ports, profile, hidden desktop, and containment-checked Temp root were
then removed and verified absent.

## 2026-07-13 P0 production UI gate

The exact unpackaged production build passed with:

`npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`

The build took 108.72 seconds. It ran at `9e946fd527` through the exact
low-level MCP checkout `806d9ba85e4afbc2af58d7499496babfa7c68891` on one
off-screen Win32 desktop. The visible user desktop was never shown, focused, or
used for input. A loopback-only synthetic provider, disposable profile, true
shallow Git fixture, and reserved `.invalid` repository identity kept all
mutations and credentials out of public GitHub and the normal Desktop profile.

### Functional receipts

- **History deepening:** the fixture started with a real shallow marker and 3
  visible commits. The bounded review fetched older history from `origin`; the
  app then reported full history. Direct Git verification returned
  `--is-shallow-repository=false`, 15 commits, branch
  `feature/material-verification`, and upstream
  `origin/feature/material-verification`.
- **Native pull requests:** the purpose-built compose, review, and submit flow
  created provider-only PRs #73 and #74 from `feature/material-verification` to
  `main`. Long titles and Markdown bodies wrapped. The provider recorded
  authorized HTTP 201 mutations; no public PR was created.
- **Actions artifact:** the native Save dialog wrote the deterministic
  2,097,728-byte archive. Its local SHA-256 exactly matched the provider digest:
  `ff2e29e2ab05d44fb7e66c8242a8d74895232ad7ea2258255b91a9145fa5a783`.
  The app reported attestation presence while explicitly withholding a
  cryptographic-verification claim.
- **Effective branch rules:** refresh loaded classic protection plus two
  rulesets into seven plain-language sections with 12 state badges and no
  alert. Signed-out and two-matching-account states exposed complete routes to
  Accounts or Repository settings. The repository picker showed both accounts;
  saving one persisted `http://localhost:54612/api/v3#7130701`.

### Responsive, focus, and clipping receipts

- At the product-enforced minimum outer width of 960, the auto-fit renderer had
  a 1000 CSS-pixel viewport and `document.scrollWidth === clientWidth === 1000`.
- The requested base scale reached 200% through **View → Zoom in**. Auto-fit
  displayed the interface at 94% for the minimum window; the Appearance dialog
  showed both values and stayed bounded at the shortest supported height.
- At outer height 660, dense Branch Rules and confirmation content scrolled
  vertically inside its surface. Geometry inspection found no element outside
  the viewport and no document-level horizontal overflow.
- Branch Rules and Sparse Checkout were opened together. The front sheet owned
  focus and dismissal; closing it restored focus to Sparse Checkout. Both
  remained non-modal and horizontally contained.
- Long repository, branch, check, deployment, artifact, digest, path, account,
  title, and body values wrapped. No measured state had clipped controls,
  overlapping/oversized text, or page-level sideways scrolling. Horizontal
  scrolling remains reserved for intrinsically spatial code, diff, and log
  content.

Win32 background input and the native Save dialog were exercised through the
low-level server. Chromium ignored background-posted clicks and PrintWindow
occasionally returned stale/black compositor pixels, so the allowlisted
app-native CDP fallback drove renderer controls and captured the stable original
surface. Every promoted candidate was reopened at original resolution.

| Promoted screenshot | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-history-deepening.png` | 944×660 | 70,047 | `a03f313b604ade9eb4458aaccffe2807c7580e53651215d52b75d9ddbfc181e2` |
| `docs/assets/screenshots/material-create-pull-request.png` | 944×660 | 76,575 | `93c8ec71c65e73414419d46214dd5849a128908e7336b08786ab677cd9f48022` |
| `docs/assets/screenshots/material-actions-artifacts.png` | 944×1000 | 106,252 | `326a27a927fa668444487f0dff3ef71c8b81eaf53e5d300b554d07a62541ae42` |
| `docs/assets/screenshots/material-effective-branch-rules.png` | 944×1000 | 107,573 | `7a4533aa0e9b40644ac2fb55ceb3fe0788ccb502137e370fd1762925a685bfd6` |

The two 944×1000 captures intentionally preserve tall original viewports of the
dense Actions and Branch Rules states, including their visible internal scroll
positions. They are original screenshots, not stitched or resized images.

### 2026-07-14 post-merge production launch

The post-merge source at `b6e78eecf3638fcdb1a81d27e7275c84e641a5f6` was rebuilt
with the exact unpackaged production command and launched on one uniquely named
off-screen Win32 desktop. The disposable HTTPS fixture and isolated profile were
removed after capture. Chromium ignored the permitted background-posted welcome
events, so this receipt intentionally records the stable launch surface rather
than claiming a deeper renderer state that was not exercised.

| Promoted screenshot | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-post-merge-welcome.png` | 960×660 | 150,763 | `c0e5cd5e56fe0cc839446256a8439789229627bc932b91421b418377fcf68d5a` |

> Provenance note (2026-07-17): this capture was later retired in the "one
> screenshot per visual function" catalog dedup and is no longer tracked or
> referenced. The row is retained as a historical receipt; the byte length and
> SHA-256 describe the file as it existed at this checkpoint.

The Pages publish layout was also assembled exactly under the owned run root.
All 21 images loaded with nonzero natural dimensions. At 944×660 the document
width was 929 with matching scroll/client widths and zero visible overflows. At
390×844 mobile emulation the document width was 375 with matching widths; the
four P0 cards collapsed into one 259-pixel-wide column with wrapped captions.
Desktop, P0-gallery, and mobile-P0 captures were visually inspected before
cleanup. All 33 formerly parent-relative screenshot URLs in the Pages source
were corrected to publish-root-relative paths.

Cleanup completed: the exact disposable development-channel credential was
deleted and read back absent; the app, provider, CDP endpoint, provider port,
and off-screen desktop were gone; and the containment-checked owned Temp root
was removed. No normal Desktop profile or public provider state was changed.

### Publication checkpoint

- Main-repository evidence, roadmap, wiki sources, Pages source, and four PNGs
  were committed and pushed on `mega-feature-update` at
  `949eca9a29f266f9aa21451718c92d71fe0a4701`; local, tracking, and direct
  remote SHAs matched.
- The separate wiki's existing extra guidance was preserved while the P0 Home
  and User Guide content was merged. Four local `Images/` assets avoid raw-main
  404s before branch promotion. Wiki `master` was committed and pushed at
  `cf115fec684278f44cceced279651b7f288b2ddd`; local, tracking, and direct
  remote SHAs matched.
- Public Home and User Guide renders showed the current named-function text and
  all four image links; each raw wiki image returned successfully. Pages source
  remains branch-only. Workflow run `29260862943` checked out the exact branch
  SHA, configured Pages, assembled the publish directory, and uploaded the
  artifact successfully. The deploy job was then rejected because
  `mega-feature-update` is not allowed by the `github-pages` environment's
  branch protection; live deployment still follows the reviewed `main` path.
- The verified clean temporary wiki checkout was containment-checked beneath
  `%TEMP%`, removed, and confirmed absent after its remote SHA matched.

## 2026-07-13 Actions pagination production UI gate

The exact unpackaged production build at
`0aca4420df88a0865a0223530b956209e131431d` passed on the isolated desktop
`DesktopMaterialActions-20260713-29de6ec7`. The build used the same exact
production command and completed in 112.3 seconds.

### Pagination and responsive receipts

- The **Success** filter loaded 50→51 workflow runs through the named **Load
  more runs** control. The deliberately long page-two sentinel appeared, and
  all 51 runs plus the sentinel remained after **Refresh**.
- The selected run loaded 30→31 artifacts through **Load more artifacts**. The
  long page-two artifact name wrapped, and both load-more controls disappeared
  when their bounded collections were complete.
- Provider requests contained exact `per_page=50&page=1|2&status=success` run
  paths and `per_page=30&page=1|2` artifact paths. No GitHub API mutation was
  made; POST traffic was limited to the fixture's smart-HTTP `git-upload-pack`
  fetches.
- At the supported 960×660 minimum/short window, the renderer was 1000×690 CSS
  pixels. Document and body client/scroll widths matched, and measured
  overflow, clipped controls, outside controls, and overlaps were all empty.
- Five actual **View → Zoom in** actions moved the requested base through
  100→110→125→150→175→200%. Auto-fit held the effective scale at 94%; the same
  geometry gate remained clean.
- The first pass caught a real flex-shrink defect in the run-detail **Close**
  button. The header button now keeps its intrinsic width, the exact source was
  rebuilt, and the full 51-run/31-artifact interaction passed.

| Promoted screenshot | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-actions-pagination.png` | 960×660 | 95,213 | `3250eaee8b6fc69b06dceb6439f04ee45e68351229ac87db003d04c27c4dd7a2` |
| `docs/assets/screenshots/material-actions-artifact-page-two.png` | 960×660 | 83,960 | `5310197657763fc1269639d5b3c8c3998393ae36e6077e71e274877e51dbdb8b` |

The Pages layout was also assembled under the owned run root with all 33
tracked PNGs. Its 23 referenced images and 22 gallery cards loaded at nonzero
natural dimensions. At 960×660 and 390×844, document/body widths matched the
viewport and measured overflow/outside arrays were empty; original desktop and
mobile captures showed both new cards and wrapped captions.

### Publication and cleanup receipt

- Main-repository evidence and both PNGs were committed and pushed at
  `1d81472595b1e01ff457425668cd8afa41f3bf2f`; local, tracking, and direct remote
  SHAs matched.
- The separate wiki's extra job-log and responsive guidance was preserved.
  Home, User Guide, and two local `Images/` assets were committed and pushed at
  `2585cf7977b14d5792a1addb8b9a7c9f944e1e84`; local, tracking, and direct remote
  SHAs matched. The live rendered pages show the new named controls and both
  image links.
- Pages run `29270933754` checked out exact source `1d81472595`, configured
  Pages, assembled the publish directory, and uploaded the `github-pages`
  artifact. The downloaded 3,051,520-byte tar contains both PNGs with the exact
  tracked hashes. Deployment was correctly rejected because
  `mega-feature-update` is not allowed by the protected `github-pages`
  environment.
- The exact app/provider PIDs and ports exited, the dummy credential was
  deleted and read back absent, the hidden desktop was closed once, and the
  containment-checked owned Temp root was removed and confirmed absent. The
  visible desktop, normal app profile, and public provider state were never
  touched.

See `.codex/run-manifests/2026-07-13-actions-pagination-ui-gate.md` for the
complete fixture, request, interaction, geometry, publication, and cleanup
record.

## Legacy M0-M18 milestone summary

| Milestone | Status | Shipped result |
| --- | --- | --- |
| **M0** | **COMPLETE** | CI, Pages, Windows installer/release workflow, README, wiki sources, and screenshot pipeline. |
| **M1** | **COMPLETE** | Token-safe per-account settings repositories with serialized Git history and recovery. |
| **M2** | **COMPLETE** | Persistent browser-style repository tabs with range/regex close controls and rich per-tab styling. |
| **M3** | **COMPLETE** | Reusable Git-backed settings history, diffs, undo/redo, and restore-to-point. |
| **M4** | **COMPLETE** | Draggable non-modal dialogs and Material side sheets that preserve background interaction. |
| **M5** | **COMPLETE** | Notification centre with unread controls, Git-backed event log, and notification history. |
| **M6** | **COMPLETE** | Shared fuzzy/substring/regex search modes, filters, and full regex builder. |
| **M7** | **COMPLETE** | Parallel/sequential multi-clone, URL-only repository export/import, and secure exact-origin clone account fallback with persisted affinity. |
| **M8** | **COMPLETE** | 50–200% UI scaling, auto-fit, and full GitHub organization repository browsing. |
| **M9** | **COMPLETE** | One-click commit/push, schedulers, safe auto-pull, and merge-all branches/worktrees. |
| **M10** | **COMPLETE** | GitHub Actions runs, reruns, workflow dispatch, job detail, and searchable logs. |
| **M11** | **COMPLETE** | Secure localhost MCP/REST agent server, renderer bridge, stdio proxy, CLI, and Preferences UI. |
| **M12** | **COMPLETE** | Desktop Plus quick-win parity: telemetry off, status/sort controls, Material actions, identity, permanent discard, hide-recent, and accessibility tooltips. |
| **M13** | **COMPLETE** | Repository metadata/defaults, pinning/grouping, branch pills, bounded Pull All with exact-origin account fallback, remotes, and submodules. |
| **M14** | **COMPLETE** | History metadata/regex search, commit graph, guarded deletion, SVG preview, and branch presets. |
| **M15** | **COMPLETE** | Multiple stashes per branch and the rebranded Desktop Material CLI. |
| **M16** | **COMPLETE** | Tab-aware multi-window lifecycle, routing, scoping, and serialized profile mutation. |
| **M17** | **COMPLETE** | GitLab/Bitbucket providers, self-hosted GitLab PAT flow, clone browsing, and cross-host PR/status routing. |
| **M18** | **COMPLETE** | Full Material shell and final post-shell polish, including layout, clipping, and accessibility regression coverage. |

Additional shipped work includes the `.gitignore` manager, Build & Run with
toolchain/project handling, multi-remote and submodule managers, fork-owned
updating, and the merge-wave integration fixes listed in Git history.

### Build & Run detection gate

Build & Run now walks bounded nested project roots and presents the project
folder beside every profile name. The detector covers Node package-manager
metadata (including modern `bun.lock` and `packageManager`), Deno, Rust, Go,
.NET, Python entrypoints and packaging files, Java/Kotlin build files, PHP,
Ruby, Swift packages, Dart/Flutter, Elixir/Phoenix, Scala/SBT, Haskell, Zig,
Make, and CMake. Settings and the toolbar use the same stable
`<profile> — <project folder>` display name; long labels wrap in settings and
ellipsize only in the compact toolbar/panel header.

Focused evidence for this gate is in
`app/test/unit/lib/build-run/detect-test.ts` and
`app/test/unit/post-shell-style-test.ts`. The exact production webpack bundles
compile, but this checkout still lacks the packaged Electron runtime and the
native `printenvz` package binary, so an interactive Electron headless capture
cannot be claimed until those dependencies are restored.

## Merged implementation ledger

These are the first paths to inspect when maintaining each subsystem:

- **Profiles, tabs, and history:** `app/src/lib/profiles/`,
  `app/src/lib/stores/profile-store.ts`,
  `app/src/lib/stores/repository-tabs-store.ts`,
  `app/src/ui/repository-tabs/`, `app/src/ui/version-history/`, and
  `app/src/ui/settings-history/`.
- **Notifications and search:**
  `app/src/lib/stores/notification-centre-store.ts`,
  `app/src/ui/notifications/`, `app/src/lib/fuzzy-find.ts`,
  `app/src/ui/lib/filter-mode-control.tsx`, and
  `app/src/ui/lib/regex-builder/`.
- **Clone, organizations, and transfer:**
  `app/src/lib/automation/clone-account-fallback.ts`,
  `app/src/lib/git/authentication-failure-origin.ts`,
  `app/src/lib/git/clone.ts`, `app/src/lib/stores/batch-clone-store.ts`,
  `app/src/lib/stores/cloning-repositories-store.ts`,
  `app/src/lib/stores/repositories-store.ts`,
  `app/src/ui/clone-repository/`, `app/src/lib/repo-list-file.ts`, and
  `app/src/ui/repository-list-transfer/`.
- **Automation:** `app/src/lib/automation/`,
  `app/src/lib/stores/helpers/automation-scheduler.ts`,
  `app/src/ui/preferences/automation.tsx`,
  `app/src/ui/repository-settings/automation-overrides.tsx`, and
  `app/src/ui/merge-all/`.
- **Actions and agent access:** `app/src/lib/stores/actions-store.ts`,
  `app/src/ui/actions/`, `app/src/main-process/same-origin-filter.ts`,
  `app/src/lib/agent-commands.ts`,
  `app/src/main-process/agent-server/`,
  `app/src/lib/agent-command-executor.ts`, `script/agent/`, and
  `docs/wiki/Agent-API.md`.
- **Repository parity:** `app/src/lib/databases/repositories-database.ts`,
  `app/src/ui/repository-settings/`, `app/src/ui/pull-all/`,
  `app/src/lib/automation/pull-all.ts`,
  `app/src/lib/automation/pull-all-account-fallback.ts`,
  `app/src/lib/git/pull.ts`, `app/src/lib/trampoline/find-account.ts`,
  `app/src/lib/trampoline/trampoline-environment.ts`,
  `app/src/ui/history/`, `app/src/ui/diff/image-diffs/`,
  `app/src/ui/stashing/`, and `app/src/cli/`.
- **Providers and windows:** `app/src/lib/api.ts`,
  `app/src/lib/stores/accounts-store.ts`,
  `app/src/main-process/window-routing.ts`,
  `app/src/main-process/app-window.ts`, `app/src/lib/window-scope.ts`, and
  `docs/integrations/`.
- **Material UI:** `app/styles/_material.scss`,
  `app/styles/_material-shell.scss`, `app/styles/ui/`, and
  `app/src/ui/app.tsx`.

## Prior integrated validation evidence

The exhaustive run on the earlier application/test tree shipped by
`b2699faccb07728fe9aa2838aa13355d71e172b0` recorded:

- **1,880 unit tests: 1,879 passed, 0 failed, 1 intentional skip**;
- `yarn lint:src`: **passed**;
- repository-wide Prettier validation: **passed**;
- `yarn tsc --noEmit --skipLibCheck`: **passed**;
- production unpackaged build: **passed** with
  `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`;
- build and GUI verification through the exact low-level MCP checkout at
  `beed66ca6ed2503e6170ee1e1158247f1c2f0140`;
- isolated HTTPS integration proof: clean advance from
  `dd0bbb04b04da50d42fa55245bc89a1426f01488` to
  `1d58935cf4ef9645f08e2fb3aa68e364ab382676`, with only the redacted
  primary-rejected/fallback-accepted sequence retained;
- the reproducible build emitted `out/`, and Electron was exercised only on a
  uniquely named off-screen Win32 Headless Desktop with isolated fixture and
  user-data paths;
- all captures in that earlier final set were visually inspected at original
  resolution, nonblank, private-data-free, and exactly **1443×992**.

### Secure clone account fallback validation

| Screenshot | Bytes | SHA-256 |
| --- | ---: | --- |
| `docs/assets/screenshots/material-agent-access.png` | 110,128 | `644891eaa37c878cb577065822681ee8fd33a018a92e0b89822b43e67393ef93` |
| `docs/assets/screenshots/material-automation.png` | 87,304 | `efe45408a390301294d5e23193b619eec858fcef4abb147d82709513c5bb3843` |
| `docs/assets/screenshots/material-branch-merge-all.png` | 116,134 | `c5cb41e17d67c627758ef43620c255c8272f85ed182a741c086a80d735c8719e` |
| `docs/assets/screenshots/material-history-power-tools.png` | 122,930 | `fe8b6323d77663467b2a6ae887d5e277e31b8dc84f0e35cec2332537ec7fd28a` |
| `docs/assets/screenshots/material-multi-window-menu.png` | 115,719 | `9a6cbcbb4c257eac3312b76f8ed0077a6a123901a6bee9b7793b926a61310c66` |
| `docs/assets/screenshots/material-notification-center.png` | 111,723 | `f8d0cf33723b1c9793d165ab39fd0cec2ccd41b50136d36f6be9c3d34b7d4709` |
| `docs/assets/screenshots/material-provider-accounts.png` | 117,558 | `91ab46ec566676f0c87534f5e72795e31a62adeecf6bf2597e533920ff428cff` |
| `docs/assets/screenshots/material-workspace-changes.png` | 123,162 | `3155b321f9aabb73ee6a40000c69f8931f1915920216818a362ec974cc3a4621` |

Earlier verified captures, including
`docs/assets/screenshots/settings-history-manager.png`, remain tracked; that M3
image is also 1443×992 and has SHA-256
`abbcc34aa02949d2144f008c9ed10b4414f721843890643d65d8e0b9360c3da1`.

### 2026-07-13 guided Git and GitHub evidence

A subsequent exact off-screen run verified three named, task-specific app
functions at **1000×687**. The app presents focused controls and state for these
tasks; it does not expose a searchable list of raw Git/`gh` commands or API
endpoints.

- **GitHub notifications:** the GitHub tab, account selector, inbox filters,
  refresh guard, and complete no-signed-in-account state fit without clipped
  labels.
- **Sparse checkout:** the disabled-state side panel explains cone mode,
  validates repository-relative directories, and provides an explicit review
  step before enabling the worktree change.
- **Shallow clone:** the URL clone form exposes a named toggle and numeric
  commit-depth field, explains current-branch/submodule scope, and points users
  to Repository tools for later deepening.

| Screenshot | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-github-notifications.png` | 1000×687 | 81,465 | `53f40a94a6ead19b73c6c3302d0eb60b0effd050c7b018b43dd76d4b2072a354` |
| `docs/assets/screenshots/material-sparse-checkout.png` | 1000×687 | 60,070 | `49a7182f5fd9eb7e0a86d6c20a1ed5b5f388b9063c87d033bfef63d42b7b37e7` |
| `docs/assets/screenshots/material-shallow-clone.png` | 1000×687 | 67,271 | `337e7a967b538de22bdd560ff9393ff35619fd1ea76e6ff8aea7827793befd59` |

Each promoted PNG was reopened at original resolution and matched the source
capture's SHA-256. No bundle-import or issue-creation screenshot is included in
this evidence set. Task forms follow a no-page-level-sideways-scroll policy:
labels wrap and action groups stack when practical, while horizontal scrolling
is reserved for spatial code, diff, or log content.

## Headless verification environment

- Project: `C:\Users\Administrator\Documents\GitHub\desktop-material`
- MCP checkout: `C:\Users\Administrator\Documents\GitHub\lowlevel-computer-use-mcp`
- MCP SHA used by the P0 gate: `806d9ba85e4afbc2af58d7499496babfa7c68891`
- MCP endpoint: `http://127.0.0.1:8765/mcp`
- Skill and client: `.codex/skills/verify-desktop-material-headless/`
- Accepted application source/build:
  `5e80e678d062b65a82c0991b352e5a861c7469e5`
- Release runtime: Node **24.15.0** from `.tool-versions`; when system Node 26
  is used for tests, disable its experimental web storage global.

The safety contract is mandatory:

1. Write a run manifest and record the initial dirty-state baseline.
2. Preflight the scheduled MCP task and exact MCP source SHA.
3. Build without downloading dependencies.
4. Create one uniquely named off-screen desktop and one owned Temp run root.
5. Launch the absolute Electron binary with isolated `--user-data-dir` and
   disposable `--cli-open`; save the returned PID and discover the live HWND.
6. Use only HWND-bound background input and `client_only` screenshots. Never
   call `show_headless_desktop`, focus a normal window, or send global input.
7. Treat `rendered_ok` as transport success only; inspect pixels at original
   resolution for blank frames, theme, clipping, private data, and dimensions.
8. Revalidate HWND/PID before close; use exact saved-PID termination only as a
   fallback; close the desktop exactly once; delete only the owned Temp root.

The proof cleanup completed after screenshot promotion. The exact saved app
process was terminated only after its background close request was ignored;
the fixture then stopped through its owned stop marker, both loopback listeners
were absent, the hidden desktop listed zero remaining windows and was closed
exactly once, and both synthetic credential entries were verified absent. The
owned path alias, safe working root, and Temp run root were each resolved to
their recorded exact target before removal and are all verified absent. All
completed agent worktrees were subsequently verified clean and merged before
removal; local `main` was synchronized with `origin/main`.

## M19 final publication and repository evidence

- **Code and CI:** final code/release baseline
  `a0c2f19433631d577979c8c8a88a5151f5ab0656` passed all seven jobs in
  [CI 29274841990](https://github.com/codingmachineedge/desktop-material/actions/runs/29274841990):
  Lint, Windows x64/arm64, macOS x64/arm64, and both packaged E2E smoke lanes.
  The formerly failing Windows x64 and macOS arm64 full-unit lanes both passed.
- **Installer and release:**
  [Build Installers 29274842059](https://github.com/codingmachineedge/desktop-material/actions/runs/29274842059)
  succeeded for exact SHA `a0c2f194…` and published public, non-draft,
  non-prerelease release
  [`v3.6.3-beta3-b0000000083`](https://github.com/codingmachineedge/desktop-material/releases/tag/v3.6.3-beta3-b0000000083).
  Its lightweight tag points directly to that commit. Each asset URL returned
  HTTP 200; every asset was streamed independently, and computed bytes/SHA-256
  matched the release metadata:

The complete function-first parity roadmap is now shipped: the P0 four-function
slice, typed operation boundary, Actions run/artifact pagination,
attempt/job/log/re-run, deployment review, fork approval, cryptographic artifact
attestation review/result UI, Actions cache management, bounded PR/Release and
Issue waves, and the named Git functions are all accepted. The complete M19
ledger remains the source of truth for that acceptance.

## 2026-07-13 Actions run inspector production UI gate

The exact unpackaged production build at
`2f40d8949aaa7ae4ce5418cd949c28c643da0a37` passed on the isolated
off-screen desktop. The build used the required no-download production command
and completed in 115 seconds. The visible user desktop was never shown,
focused, resized, or used for input.

This roadmap slice exists as named app functions rather than a command or API
catalogue. The run detail pane selects the latest or a historical attempt,
loads strict 50-job pages, retains page one through a later-page retry, and
sends an exact loaded job to the bounded log transfer or re-run mutation.
Run-level pending deployments and review history load independently; selected
approvable environments use a dedicated required 1–1024-character decision
dialog, while an eligible first-time fork run has a separate confirmation.

Every new API/store surface stays on the repository-selected same-endpoint account. Current jobs use the fixed latest-attempt path, historical jobs use the fixed attempt path, deployment reviews send only normalized environment ids/state/comment, and fork approval is bodyless. Same-run attempt changes abort and generation-guard stale jobs; repository/account/run changes also cancel child work. Artifacts are now correctly labelled as run-level outputs across all attempts.

Focused implementation evidence is green: TypeScript `--noEmit`, targeted ESLint with the repository rule directory, responsive style contracts, and 124/124 Actions checks across 22 suites. Those checks cover strict bounded parsing (including single-byte response streams), fixed paths and bodies, permission-aware bounded errors, exact-account routing, current→historical stale-request cancellation, latest-attempt page revalidation, shortened-page stopping, 50→51 retained retry, exact recovered-job log/re-run targeting, 101-attempt bounded navigation, locked deployment selection, required bounded comments, approval submission, separate fork confirmation, consuming modal scrims, and contained/restored focus.

The deterministic provider checkpoint is also green. Eleven provider tests plus
the live probe cover inspector run `84152` at attempt 2, 51 current and 51
historical jobs, current sentinel `85101`, historical sentinel `85050`, a
one-time current page-two 503, exact bodyless re-run/fork mutations, exact
bounded deployment-review bodies, redirected log content without credentials,
two eligibility-distinct environments, stateful history, unchanged artifact
integrity, and blocked Git receive-pack.

### Interaction, request, and responsive receipts

- The real app loaded the current 50→51 jobs through a deliberate 503→200
  retry, selected attempt 1, loaded its 50→51 historical jobs, opened the exact
  recovered logs, and confirmed the exact loaded job re-run.
- Exact provider links resolved run `84152`, current job `85101`, historical job
  `85050`, and environment `86101`. The isolated provider recorded exactly
  three POSTs: job `85101` re-run (201, bodyless), run `84152` pending-deployment
  review (204, exact normalized body SHA-256
  `32a6c1c2d4615f352f1d0060b11e688d3cf020146027c4ada23d56e82e460be8`),
  and run `84152` fork approval (204, bodyless). No public GitHub state was
  touched.
- A first production pass caught a real short-window defect: the deployment
  dialog footer extended 7 pixels below the renderer because its layer was
  positioned against the tall scrolled Actions view. The layer now uses fixed
  viewport positioning; the exact source was rebuilt and the same modal passed.
- The full interaction passed in a 1000×687 CSS renderer captured at a true
  960×660. Regular-height, supported short-height, and requested 200%-base
  states also passed. Auto-fit preserved the user base while applying a 96%
  effective scale. Document and body client/scroll widths matched in every
  receipt; overflow, clipped controls, outside controls, sibling overlaps, and
  oversized text arrays were empty.
- Job-log, deployment-review, and fork-review dialogs each produced exactly one
  modal and one interactive scrim; focus stayed contained while open and was
  restored after close. The spatial log body remains the sole intentional
  horizontal-pan surface.

| Promoted screenshot | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-actions-jobs-pagination.png` | 960×660 | 111,675 | `0e61eb4e66c20bffbeac76c79eebb9508d44160cb104feb8fc47f2617dc94b90` |
| `docs/assets/screenshots/material-actions-pending-deployments.png` | 944×808 | 98,249 | `6eea1333755d5edad469c8d0d06b8a3d62e43c991e6bc9de5e98080dee75c1bc` |

Both promoted PNGs were reopened at original resolution after copying and
matched their accepted run captures. README, in-repository wiki, and Pages
sources now reference them. The assembled local Pages layout loaded 25 nonzero
images across 24 gallery cards. At 960×660, document/body client and scroll
widths were all 945; at 390×844 they were all 375. Overflow and outside-control
arrays were empty, and original desktop/mobile captures showed the two new
cards with wrapped captions and no sideways scrolling.

### Publication and cleanup receipt

- Primary-repository evidence and both promoted PNGs were pushed at
  `6d00ab73531d5359d821b6fccef2bf9ffffb3035`; local, tracking, and direct remote
  SHA matched with a clean worktree.
- The existing live wiki's newer M19 content was preserved while the Actions
  Home/User Guide sections were merged. Wiki commit
  `e4f4a49a973a442078369c61b7c6da9696fd38a7` is on the direct remote, with both
  screenshots stored as local `Images/` assets. Public Home, User Guide, raw
  sources, and both PNG responses were verified; the images returned 200 with
  the exact 111,675/98,249 byte sizes.
- [Pages run `29283239381`](https://github.com/codingmachineedge/desktop-material/actions/runs/29283239381)
  checked out the exact evidence SHA and passed checkout, configuration,
  assembly, and upload. Artifact `8292133247` contained 41 traversal/link-safe
  entries; its HTML and both PNG Git blobs exactly matched the pushed source.
  Deployment correctly stopped before a runner because the protected
  `github-pages` environment does not allow `mega-feature-update`.
- The fixture remote was restored to its `.invalid` identity. The exact
  loopback dummy credential was deleted and read back absent. Only the
  revalidated owned app, Pages Edge, and provider PID trees were terminated;
  ports `62208`, `62209`, and `64402` were absent afterward. Both owned desktops
  reached zero windows, closed exactly once, and then returned not found. The
  containment-checked run root and separate wiki clone were removed with
  `Test-Path=false`. The visible user desktop remained untouched.

## 2026-07-14 Actions cache and screenshot refresh

The Actions provenance/result UI and cache-manager slice is complete at exact
source SHA `e282eb2fce` on `main`. The cache manager now starts after the repository's
selected-account subscription, survives late Fetch-origin association, and
keeps cache state when a concurrent workflow refresh completes. The page uses a
scrollable vertical layout so long cache keys, refs, usage, and destructive
controls remain visible without page-level sideways scrolling.

The synthetic loopback provider adds three bounded cache records and usage,
single-delete, and delete-by-key routes. Exact headless verification ran on
`DesktopMaterialActionsCache-20260714-8c4f` with the cached Electron 42.0.1
runtime, provider `http://localhost:51008/api/v3`, and renderer CDP port 51111.
The pagination gate loaded 51 successful workflow runs and 31 artifacts with
both page-two sentinels and empty overflow/clipping/outside/overlap receipts.
The cache gate displayed 3 caches using 836.8 MiB, all cache cards, and all
delete controls in an inspected original-resolution 960×660 PNG.

Promoted evidence is referenced by README, the three in-repo wiki pages, and
the Pages gallery:

- `material-actions-cache-manager.png`
- `material-actions-pagination-headless.png`
- `material-actions-artifacts-headless.png`
- `material-actions-sentinel-headless.png`

Focused formatting, TypeScript, Actions cache/store/UI tests (30/30), fake
provider tests (12/12), and scoped ESLint passed. Webpack completed in the
exact `build:prod` command, but packaging remains environment-blocked because
`node_modules\printenvz\build\Release\printenvz.exe` is absent; no dependency
was downloaded or synthesized.

## 2026-07-14 accessibility and clipping gate

The Pages source was exercised in system Edge headless mode at 960×660 and
390×844. Both viewports passed with zero axe accessibility violations, matching
document/body client and scroll widths, and zero visible elements extending past
the horizontal viewport. The existing page gallery remained fully contained at
both widths.

The audit found and fixed two real accessibility defects: the footer skipped
from page-level `h2` sections to `h4` headings, and the in-text roadmap link had
insufficient contrast without a non-color distinction. Footer headings now use
the correct `h3` level, and section links are underlined with a visible offset.

Focused source/style coverage passed 27/27 tests, including the new Pages
accessibility contracts and existing compact-shell, post-shell, Actions, and
responsive style contracts. The exact production webpack bundles also compiled
successfully. The Electron interaction portion could not launch in this checkout
because the installed Electron package has no runtime binary and Playwright's
bundled browser is absent; the build's packaging step remains blocked by the
known missing `node_modules\printenvz\build\Release\printenvz.exe`. No runtime or
dependency was downloaded.

## 2026-07-16 adaptive customization production gate

The exact tested code source, fixed verification checkout, production build,
launched renderer, and captured UI all matched
`c5205838dfc5ee2b7ce80ce488215a2cd903bb26`. The unpackaged production build
completed successfully in 147.1 seconds through the repository's exact
low-level computer-use service. All input, resize, capture, and inspection work
stayed on an off-screen Win32 desktop; the visible user desktop was never shown,
focused, or used for input.

The interaction gate verified:

- all 12 active-profile defaults, six repository-local overrides and
  inheritance, per-tab typography/color persistence, profile local-Git history,
  repository-local config isolation, and restart restoration;
- measured **More toolbar actions** behavior at the clipping boundary, including
  mounted-state/focus continuity and deterministic widening restoration;
- guarded inverse tab close with literal matching, live counts, zero-match and
  pinned-tab protection, plus drag/keyboard arrangement and six stable one-shot
  sorts that persist without reacting continuously to status changes;
- exact workflow-run cancellation identity/status revalidation, one normal
  cancellation request, duplicate suppression, accepted-response polling to a
  terminal state, and no force-cancel request;
- current-branch rebase review, fresh ref/repository preflight, deliberate
  conflict routing through the existing continue/abort surface, exact branch
  restoration after abort, and no force push;
- immediate Provider Triage resolution of the exact repository-account binding
  saved in Repository Settings, including restart and refresh without replacing
  a valid explicit binding; and
- compact/zoomed Repository Tools, Remote Manager, Regex Builder, confirmation,
  and popover geometry with named controls, focus return, reachable final
  actions, vertical scrolling where needed, and no page-level horizontal
  clipping.

Focused model/store/UI/migration/stale-state/accessibility coverage, TypeScript,
lint, formatting, diff checks, and the exact production build passed for the
tested code source. Documentation and screenshot publication are committed only
after that fixed source gate; direct fast-forward `main`, CI/Pages, and wiki
receipts therefore belong to the later publication commit rather than being
retroactively claimed for the captured code SHA.

Seven privacy-safe captures were inspected at original resolution:

| Capture | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-welcome.png` | 1440×960 | 146,428 | `28f0b56ef43347fad0bbe7e0bcb824d7c3df2c39e444a022fb7145c51b6991ca` |
| `docs/assets/screenshots/material-customization.png` | 1440×960 | 109,343 | `a9b1493641c69840df6467612dc6f32fa5603404ac5e9b34ac776e7399dc79db` |
| `docs/assets/screenshots/material-toolbar-overflow.png` | 1440×960 | 167,132 | `67d64944736d37dd521028d55557a2bb7a9d42d8940aa8051d2ef875c5f021c5` |
| `docs/assets/screenshots/material-tab-appearance-word.png` | 1440×960 | 167,878 | `4df433b6bf3b58993299032d6d19e0ded5da3acb0a37f53e6b7109686df7a569` |
| `docs/assets/screenshots/material-tab-arrange.png` | 1440×960 | 160,546 | `ce6a43a088b650d14bca158d12776d8dd4dcca5bf89d3f1d52720ddefda85470` |
| `docs/assets/screenshots/material-actions-cancel.png` | 1440×960 | 133,083 | `6dceb918e322b2f30ee574a51e815e32f5d4b272f250811b20202a409bec731c` |
| `docs/assets/screenshots/material-rebase-review.png` | 1440×960 | 153,207 | `145c5b54320116ce41bdc0b17eb9e726a8cb0dbaf0988886011a862d8cc189de` |

## 2026-07-16 profile identity and portable tab workspace

The exact implementation commit is
`4e797f52b9ecb4d77f40bfa1e11629fb2f8e3b95`. It adds a persistent,
profile-backed **App identity** editor with a shared live/title-bar brand,
validated built-in or custom logos, geometry, borders, shadows, colors, and
Word-style name typography. Font, width, weight, case, size, spacing, opacity,
bold, italic, underline, strikethrough, small caps, highlight, and fixed text
effects restore across restart without changing the signed executable or
operating-system icon. Migration retains unknown newer identity and tab-style
keys while validating every known field before persistence or CSS use.

Repository tabs now support favorites, favorites-first/last stable one-shot
sorting inside pin groups, local repository-folder drop to add/open/switch, and
bounded JSON export/import of the current order, active tab, aliases, pins,
favorites, and appearance. Runtime ids and credentials are excluded; malformed,
oversized, relative-only, duplicate, and missing-path entries fail or skip
safely, and a replace import never destroys a usable session when no repository
can be resolved. Appropriate shell, title, tab, and repository surfaces expose
right-click customization plus the exact profile-history or repository Git
ownership path; editable and specialized context menus retain priority.

The complete runner passed 1,218/1,218 tests across 420 files and 306 suites.
TypeScript, scoped ESLint/Prettier, staged diff and secret scans, focused
accessibility/context/session tests, and the exact MCP production build passed.
The build used the fixed low-level service and returned successfully in 170.5
seconds without downloading dependencies.

All interaction stayed on off-screen desktop
`DesktopMaterialScreenshotRefresh2026071601`. Because native hidden-HWND resize
was unavailable, the approved CDP viewport fallback verified all 38 unique
identity controls at a 645×645 renderer viewport. Document, body, preference
pane, and identity surfaces had matching client/scroll widths; no required
control clipped horizontally. Restart restoration, the eight arrange actions,
favorite state, export/import dialogs, and folder-drop overlay passed their
bounded geometry gates. This native-width limitation is explicit; the renderer
gate did not claim a second native resize mechanism.

The freshly rebuilt MCP screenshot
`docs/assets/screenshots/material-app-identity-workspace.png` is 1443×992,
166,398 bytes, SHA-256
`45504266edf337f36a5a6bde0932e1b7ab740d33009e7d8c04a866979e506533`.
README, Pages, and wiki sources share the asset. Fifty-five distinct published
screenshot references resolve locally with none missing; Pages presents 54
unique gallery images and the guided wiki table catalogs 53. The screenshot was
inspected at original resolution and contains synthetic state only.

Exact owned PID/HWND pairs `11388`/`315884768` and `2148`/`54920934` were
gracefully stopped, the hidden desktop reached zero windows and closed once,
and the containment-checked Temp root was removed. The visible desktop and
unrelated Electron processes were untouched. The foreign OAuth-scope manifest
remained untracked and byte-identical; the detached release worktree was not
modified.

## 2026-07-16 final repository integration and cleanup

The integration baseline immediately before this memory-only update is
`ea76808dca482d2ce6f78c1fb5de27a6dc6f2462`. Both previously untracked run
manifests are committed. Detached worktree commit
`991b57bc1b098e78e4ae43b1ac0b1b76fb74ebe3` is merged into `main`, and the
superseded Pull All stash commit
`183ee8648e77be6b43b3899d3b81c4361099504a` is retained as merged history
without replacing the newer published implementation. Both integration merges
preserved tree `28e5840b55d989cc8ef0514f1f3c2ca5673a41b8` exactly.

The stash was dropped after its commit became reachable from `main`. The clean
detached worktree at
`C:\Users\Administrator\.codex\worktrees\3e3c\desktop-material`, its empty
parent directory, and stale worktree metadata were removed. The final audit at
that baseline reported zero dirty files, zero stashes, no unmerged local or
remote branches, one local branch (`main`), one remote branch (`origin/main`),
one canonical worktree, and `0/0` divergence between `main` and `origin/main`.

## Maintenance constraints

- Keep account identity on `endpoint#id`; never collapse provider accounts by
  login or host alone.
- Keep profile settings, tab mutations, history operations, and multi-window
  updates on the serialized profile queue.
- Keep secrets out of profile/notification Git repositories, exports, logs,
  screenshots, and agent responses.
- Keep Pull All fallback limited to HTTPS auth/not-found ambiguity and
  token-bearing exact-origin accounts, with repository preference plus stable
  order. Never retry SSH/non-auth failures, expose the selector to Git children,
  relax same-origin fail-closed behavior, or force it across submodule origins.
- Keep clone fallback limited to the HTTPS auth/not-found ambiguity reported by
  the rejecting exact origin, including its port. Preserve hosted selection,
  proactive eligible generic-account selection, no-eligible-only unforced
  behavior, successful-account persistence, and the internal-only selector;
  never add a credentials-dialog fallback.
- Keep agent access localhost-only, opt-in, token-gated, origin-checked, and
  response-redacted.
- Preserve Material token usage when adapting upstream or Desktop Plus code;
  do not import their branding or SCSS wholesale.
- Keep named Git and GitHub workflows responsive: prefer wrapping and stacked
  controls over page-level sideways scrolling, with spatial code/diff/log
  surfaces as the narrow exception.
- `build-installers.yml` intentionally publishes a release on qualifying
  non-documentation pushes to `main`; verify whether a docs-only merge is
  correctly skipped before reporting the final release state.
