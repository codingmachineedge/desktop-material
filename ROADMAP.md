# Desktop Material roadmap

Updated: **July 23, 2026**

Desktop Material's numbered roadmap now extends through **M27**. M0–M21 and the
M23 Ollama manager have published receipts; M22's 73-scene visual refresh is
published byte-identically, and the exact acceptance/publication state for
M24–M27 is listed below. The July 22 tab-group, command-palette, Alt-key,
release-gate, and Cheap LFS UI continuation is implemented, locally accepted,
pushed to `main`, and verified through the exact-source CI, CodeQL, Pages, wiki,
and installer-release pipelines.
This file is the compact public source of truth; implementation details and
historical test receipts stay in [PLAN.md](PLAN.md) and
[HANDOFF.md](HANDOFF.md).

## July 24 settings search — **Implemented, locally accepted**

A search box in the Settings dialog rail filters a bilingual catalog of settings
by title, description, and keyword across every tab, highlights matches, badges
and dims tabs by match, and jumps to the owning tab on select. Reuses the shared
fuzzy/substring/regex filter control and regex builder (registered `preferences`
surface). Fully localized (English / Cantonese / bilingual), keyboard- and
screen-reader-accessible, tone-neutral. `tsc` clean; new filter/matching tests
15/15 with registry and i18n suites still green. Detail in
[HANDOFF.md](HANDOFF.md); feature doc under
`docs/features/identity-and-workspace/settings-search.md`.

## July 23 cross-lane updater recovery — **Verified**

Commits `241cc90ce9` and `04246fdf12` moved both release lanes into one
Squirrel-monotonic alphabetic `z` namespace and removed the legacy comparer's
decimal `Int32` overflow. Exact-source CI `29977738533` and installer run
`29978844761` succeeded; the latter published six-asset exact-target Release
`v3.6.3-beta3-zadtberjmv`. A live installed
`3.6.3-beta3-s000000000201` build automatically downloaded and applied it.
Super Express run `29980281736` then published the greater same-SHA
`v3.6.3-beta3-zadtbhvdfc`, and the isolated legacy UI visibly progressed from
**Downloading update…** to **Quit and Install Update**. The detailed receipt is
in [HANDOFF.md](HANDOFF.md).

## July 23 Cheap LFS + push batching — **Live acceptance and serialization correction complete**

- A verified bug audit of the serialization change corrected three
  materialize-flow defects: canceling Materialize all now cancels queued
  batches repository-wide (an automatic restore enqueued by a concurrent fetch
  could previously restart the canceled downloads), the panel reports partial
  failures ("N materialized; M failed and were left as pointers.") from the
  batch summary instead of unconditional success, and a canceled batch reloads
  the pinned-file list so completed files never keep a stale pointer state that
  also suppressed Remove's local-deletion warning. Single-file cancels remain
  scoped to their own request.
- Cheap LFS commit preparation now exposes sanitized per-file phases, bytes,
  success/failure counts, and the selected-versus-recommended storage route in
  a compact terminal below Commit. A persisted default-on toggle permits up to
  three transfers; sequential mode remains available. Failed raw large files
  stay selected for retry while successful pointers and unrelated safe changes
  can commit, and the Changes filter can isolate files over 100 MiB.
- The repository rail's **Large files** page owns its vertical scroll so long
  pointer inventories remain reachable. Its direct settings action opens
  **Repository settings → Build & run**, where the storage provider, automatic
  pinning, transfer concurrency, clone/open materialization, and cloud policy
  live.
- Repository settings select published GitHub prereleases, GHCR, or Docker Hub.
  The registry modes publish the full repository object set as one logical OCI
  image within 4,096-object, 8,192-layer, and 8 MiB config/manifest proof
  bounds, create a new immutable manifest for each add/remove snapshot, reuse
  unchanged blobs, retention-tag every published digest, and point Git only at
  verified immutable digests. A timed-out layer is rebuilt at half the previous
  bound down to 8 MiB; accepted blobs are reused, but an incomplete immutable
  layer is never appended to.
- Verified-private source repositories encrypt each registry chunk with
  AES-256-GCM and intentionally share the key through the tracked private Git
  repository. The documentation calls out that this protects a registry-only
  leak, not anyone who can read the repository or its history. Private pointers
  bind the exact key id and the commit flow force-includes and proves that key.
  Commit-key path validation has one narrow legacy exception: it permits an
  otherwise Windows-hostile selected path only when a fresh, repository-bound
  status proves that exact path is deleted. Current nondeleted unsafe paths and
  real OCI pointers under control-plane paths remain fail-closed.
  Clone, pull, fetch, and open detection restores strict pointers by default,
  including old pointer-only clones; public registry and explicitly public
  GitHub.com Release restores can run while signed out.
- GHCR retains its documented 10 GB-per-layer and ten-minute transfer bounds;
  Docker Hub's changing plan, pull, storage, and fair-use limits remain provider
  policy rather than invented hard caps. The app recommends Git, Releases,
  private-source GHCR, or configured Docker Hub from the selected byte count
  without overriding the saved provider. Provider setup is a recommendation
  signal, not proof of live quota or organization policy. Same-provider updates
  retain existing Docker organization/collaborator targets; cross-provider
  migration requires exact materialized raws. A first public GHCR package fails
  before upload because GitHub creates it private; Releases, Docker Hub, or an
  already linked public package are the supported routes.
- Windows packaging pins ORAS 1.3.2 and ships its verified Apache-2.0 license.
  The ARM64 package currently depends on Windows 11 x64 emulation for that
  audited x64 binary. GitHub's OAuth scope reference grants package access to
  `write:packages`, while its registry page separately says PAT classic only;
  the non-mutating account challenge passed, but no live package mutation is
  claimed and a registry rejection fails closed.
- Ordinary Git changes are measured conservatively below a decimal 1.5 GB push
  ceiling, using a 1.4 GB changed-blob budget plus bounded path/proof overhead.
  Each batch is committed, durably checkpointed, pushed, and proven as the
  remote tip before the next commit exists; intent/pending transitions use
  atomic two-ref transactions. Push also detects
  older oversized local-only history: clean linear branches are protected by a
  compare-and-swap backup ref and safely rebuilt without force-push. Rebuilt
  batches preserve the reviewed message/final tree but receive new IDs, do not
  retain cryptographic signatures, and do not promise original author
  timestamps. App-owned
  commit commands use process-local `-c gc.auto=0` and validate HEAD so a valid
  commit followed by unrelated maintenance failure is reported once instead of
  duplicated.
- The public `codingmachineedge/bambu-build` acceptance exercised all
  **14,809,588,162 bytes and 8,305 payload files** through four UI-created,
  exact-SHA-proven batches. The first ordinary push received HTTP 408 and left
  its pending commit durable; the UI retry pushed that same immutable SHA before
  continuing. Cloud run `30048474438` processed the 13 Release objects one by
  one and reported **13 compressed, 0 kept raw, and 0 failed** while retaining
  all 13 raw originals, for 26 assets total. Final real-UI commit `712ad85`
  passed verifier run `30054805137` and published immutable manifest Release
  `bambu-build-verify-30054805137`.
- A fresh UI clone at `712ad85` restored all ten logical SHA-256 values while
  the committed Git objects remained 370–514-byte pointers. The first explicit
  Materialize-all action overlapped clone/open automatic materialization and
  reached two hash-identical CAS recovery copies. That integrity proof prompted
  repository-scoped serialization. The correction passes the affected
  disposable-Git concurrency and UI routing regressions; the promoted live
  ten-pointer inventory and separate 10/10 clone hashes preserve the real-UI
  evidence without misreporting a second multi-gigabyte rerun.

Focused local evidence passes **80/80** Release/OCI operations, **77/77**
registry transport/runtime cases, **117/117** disposable-Git batching cases,
**157/157** UI/settings/localization cases, **8/8** ORAS scripts, **19/19**
headless-verifier contracts, and **7/7** compact-shell style checks. The final
first-publication production build returned `0` after **400.46 seconds**
(**404.3 seconds wall**) and produced `out/renderer.css` with SHA-256
`6381556b36c295ba47ad90e8080f4079cbc61951bd7811ab9cb9fc3520638cb1`.
That is the historical initial `c3db37ea55` receipt. The corrected exact-source
build returned `0` after **390 seconds wall** (Yarn **387.64 seconds**) and
produced a 1,179,200-byte `out/renderer.css` with SHA-256
`6fba1434112ea5c02256a12e6ce8af42f5c870f0db5835155acb8075708d9d28`.

The promoted 1440×960 English Cheap LFS frame is 113,869 bytes with SHA-256
`3d6358567126e3ce0504b04c4489abbfd473b77546bd82dac834553d50fe9333`.
All **36/36** named assertions, including `noBlockingDialog`, passed; one real
pointer selection settled the over-limit diff and the frame proves all three
worker rows. The final 640×960 bilingual frame is 85,175 bytes with SHA-256
`1b99c827d1b5b2cf05298fb1255873acdf0502f72a40437c378c0be7bb989e50`.
It also passed all **36/36** named assertions after one real pointer attempt,
kept the progress surface at y=942 inside the y=944 panel, and used only the
compiled source bundle with no diagnostic style injection.

The corrected compact Repository Releases proof ran at 100%, 125%, 150%, and
200% in one 960×660 physical viewport. The promoted 200% frame is 89,856 bytes
with SHA-256
`8e29ac666a0832d353126d8dd759200ba7e853016a940501e5c7cbdbb1cf992a`;
its 480×330 CSS viewport shows one complete 53.5 px release row, 24-hour `HH:mm`
timestamps, a wrapping bilingual disclosure, and no horizontal overflow. The
125% case now activates the 800×560 compact gate at 768×528 CSS; every compact
scale measures a 176 px panel, at least a 52 px row, 30 px target floors, a 9 px
text floor, three metric columns, and the latest card spanning two. Native Enter
expanded and collapsed the compact tools; available actions retained focus
semantics and the no-next-page pagination control remained correctly disabled.
The gallery source now contains **77** inspected images.

The historical initial combined changed suite passed **151/151**. The corrected
Releases style/localization/UI plus Pages contracts pass **55/55**. A final
152-test integrated rerun ran for 693 seconds without an observed failure, then
was stopped cleanly during the disposable-Git batching suite at the user's
explicit immediate-push request; no aggregate pass is claimed and the complete
rerun remains a handoff item.

The full Cheap LFS folder aggregate remains deliberately reported as
**261/262** only because one wall-clock policy case exceeded its harness budget
under concurrent heavy Git work; its isolated rerun passed **8/8**. The older
1,466.27-second build and its failed narrow attempt remain labeled as historical
interim evidence in the
[dated local receipt](docs/verification/cheap-lfs-commit-progress-2026-07-23.md).
Historical initial integration commit
[`c3db37ea55`](https://github.com/Ding-Ding-Projects/desktop-material/commit/c3db37ea5524b91f9603151ae5d1107205f16a59)
is an ancestor of current corrective source
[`c22e29a03a`](https://github.com/Ding-Ding-Projects/desktop-material/commit/c22e29a03ac14b01e35ab7b1434fa288bc794307),
which preserves every updater receipt commit. The responsive correction raises
the compact pane's text/control floors, lets bilingual disclosure copy wrap,
localizes its new controls, and widens the combined compact gate for 125%. Its exact-source build,
four-scale headless geometry/keyboard proof, original-pixel review, capture
promotion, and owned-resource cleanup passed locally. Cloud run `30055965804`,
CI `30055965807`, CodeQL `30055965809`, and Pages `30055965817` passed for exact
`c22e29a03a`; installer run `30057456712` published immutable six-asset
exact-target Release `v3.6.3-beta3-zadthusbjk`. The Bambu cloud, manifest
verifier, immutable manifest Release, and initial 10/10 fresh-clone hash proof
are complete; only the serialized-materialization rerun and final image remain
open.

## July 22 tab groups, command palette, and input/release reliability — **Implementation and publication verified**

- Named/color-coded group chips now show member counts and real expanded state;
  collapsing hides member tabs and the chip restores them by mouse, Enter, or
  Space. Group mutations announce their result and retain focus safely.
- Group definitions and collapse state survive tab opens/closes, bulk closes,
  imports, per-window persistence, legacy mirroring, reload, and unknown-field
  round trips. A group cannot cross the pinned/unpinned boundary. Portable
  session export intentionally omits profile-local group definitions and
  `groupId` memberships.
- Tab-group actions and the rich command-palette shell/rows/appearance editor
  now follow English, playful Hong Kong-style Cantonese, or bilingual mode.
  Palette density plus icon/group/keyword visibility remains persisted and
  repaired safely.
- Bare Alt uses an explicit one-press state machine, so repeats, other keys,
  modifiers, prevented events, modal transitions, and out-of-order releases do
  not leak into the next menu toggle.
- Super Express Release now runs complete unit and script suites before build/
  package while continuing to skip lint, E2E, and history-generated notes;
  release pull requests target `main`.
- The previously published baseline `7edca120c5` passed
  [CI `29895625564`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29895625564),
  [code scanning `29895625583`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29895625583),
  and [Build Installers `29896993449`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29896993449),
  which published
  [`v3.6.3-beta3-b0000040881`](https://github.com/Ding-Ding-Projects/desktop-material/releases/tag/v3.6.3-beta3-b0000040881)
  with six required assets. Those are baseline receipts only. The current
  continuation's exact unpackaged production build passed through the fixed MCP
  endpoint, and off-screen interaction accepted the restart-restored collapsible
  group chip plus the fully visible rich-row palette editor. Two inspected
  1000×687 captures now appear in README, Pages, and wiki sources. Final source
  checkpoint `f7b4760a13894f0320f7b361f055f6fba40d913f` passed exact-source CI
  `29972351158`, CodeQL `29972351173`, and Pages `29972351147`; wiki commit
  `407cbf260c229e9f8e7fd86062afad83e5080f63` is synchronized, and installer run
  `29973527338` published six-asset Release `v3.6.3-beta3-b0000040887` from the
  exact tag.

## M27 — Reviewed pull previews — **Implementation, acceptance, and publication verified**

Toolbar and application-menu pulls now fetch first and open a blocking review
of the exact current/upstream refs and OIDs, ahead/behind topology, effective Git
integration strategy, and bounded incoming commit/file summaries. Confirmation
revalidates the frozen identity, strategy configuration, and clean worktree,
then integrates the reviewed upstream commit without a second superproject
fetch. Detached, dirty, conflicted, stale, failed-fetch, busy, and unsafe
fast-forward-only states remain non-destructive. Focused tests, TypeScript,
lint/format checks, the production build, and an isolated off-screen Win32 pull
exercise passed. Exact-source CI, CodeQL, Pages, synchronized wiki, and the
six-asset Windows x64 Release are verified for the `main` push recorded in
[HANDOFF.md](HANDOFF.md).

## M26 — Cheap LFS / Express Release — **Live cloud Actions/UI and source publication verified**

- **Release-backed large-file storage**: The repository rail's **Large files**
  manager can pin working-tree files over 100 MiB to GitHub Release assets,
  leaving small human-readable pointers at their tracked paths. Automatic pinning
  gates on commit entry points and downloads materialize detected pointers after
  clone, pull, user fetch, or open under one cancelable batch. Multi-gigabyte
  files are split into ordered raw parts of at most 1.5 GiB with whole-file and
  per-part SHA-256 verification. The manager lists and searches committed
  pointers, restores individually or all at once, and never requires browsing or
  decoding release asset names externally.
- **Cloud compression**: Public repositories receive an automatic reviewed
  caller; private repositories remain off until explicit persisted consent.
  The SHA-pinned Action streams one Release object at a time directly to a
  raw-DEFLATE side asset, never uses Actions artifact/cache storage, updates
  only verified beneficial objects to v1 `part-deflate`, retains every raw
  historical asset, and leaves failed/non-beneficial pointers cloneable.
  Desktop Material is the only decompressor and verifies bounded expanded
  bytes locally. Focused real-action, policy, failure, UI, and materialization
  tests pass. Retained public/private production-UI caller commits triggered
  successful Actions runs that adopted 1,033-byte side assets, and both bot
  pointers restored locally to the exact original 1 MiB SHA-256. A preceding
  public draft-tag 404 also proved the raw pointer and asset remain usable after
  a failed run. Draft lookup is bounded to 10,000 releases; a missing bounded
  draft or a full 1,000-asset Release fails safely without pointer adoption.
- **Manual browser handoff**: When the trusted GitHub CLI path cannot complete
  safely, a browser-assisted upload handoff plans every remaining file, splits
  sources into ordered .partNNN files in a flat bounded folder, opens the
  Release editor and Explorer simultaneously, polls for uploads with bounded
  retry intervals, accepts only new exact-name/size assets, re-hashes every
  source before writing pointers, and records a version-2 manifest of original
  nested paths and flat asset ranges.
- **Super Express Release fast lane**: A workflow_dispatch-only emergency
  release path checks out the exact SHA, restores the dependency cache, runs the
  complete unit and script suites, then builds and packages Windows x64
  directly. It skips lint, E2E, and history-generated notes, verifies the
  Squirrel/installer/portable payload, writes a local note from the checked-out
  commit, preserves an uncompressed artifact, and publishes one uniquely tagged
  release.
- **Cross-lane updater ordering**: Automatic and Super Express packages now use
  one validated `z` plus fixed-width, nine-letter base-26 GitHub run-ID
  namespace. It sorts above the legacy `b…`/`s…` lanes that stranded Super
  Express installations, keeps reruns deterministic, and avoids the legacy
  Squirrel `Int32` overflow caused by long numeric prerelease tails. Both
  workflows create
  immutable non-latest Releases, then revalidate current `main` and reconcile
  the greatest same-SHA version before promotion. No shared concurrency group
  cancels older work. Failed or cancelled main CI still retains a recoverable
  package artifact but cannot publish.
- **Build & Run integration**: "Pin large files before committing", "Upload up
  to three large files at once", and "Download large files after cloning" are
  enabled by default. A persisted storage-provider selector adds published
  prerelease, GHCR, and Docker Hub choices. The Large files surface is reachable
  from both the repository rail and Repository Tools hub.
- **Live GitHub and Desktop Material UI acceptance**: Retained public and
  private test repositories each contain pushed UI-created five-line pointers,
  draft-prerelease 1 MiB assets, and the generated Cheap LFS logo. Fresh clones
  resolved to the exact UI commits and retained pointers instead of Git LFS
  objects. The production app materialized and re-pinned both payloads through
  the Large files UI and native picker using an explicitly authorized temporary
  secure-store bridge that was deleted and verified absent after the runs. See
  the
  [dated receipt](docs/verification/cheap-lfs-github-public-private-2026-07-22.md).
- **Source publication receipt**: Exact checkpoint `f7b4760a13894f0320f7b361f055f6fba40d913f`
  passed CI, CodeQL, and Pages; the seven-page wiki is synchronized and the live
  gallery serves all 73 figures. The downstream installer workflow published
  latest Release `v3.6.3-beta3-b0000040887` from that exact tag with all six
  required Windows x64 assets.
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

- The `build-installers.yml` workflow publishes exactly one uniquely tagged release after
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

<!-- markdownlint-disable MD013 -->

| Feature / Gate | Status | Key Evidence |
|---|---|---|
| Cross-lane automatic updater migration | **Complete; both release lanes and installed UI verified** | `241cc90` introduced the shared lane and `04246fdf` corrected the legacy integer-overflow boundary. CI `29977738533`, installer run `29978844761`, Super Express run `29980281736`, two six-asset exact-target `z…` Releases, automatic `s000000000201` migration, and the real download/ready UI are verified. |
| July 22 tab groups, palette, Alt, and release gates | **Complete; source publication verified** | Source contracts cover persistence, pin-boundary safety, portable-export stripping, three language modes, rich palette rows/appearance, deterministic bare-Alt sequencing, Super Express test-before-build, and release-PR `main` targeting. The production build and off-screen acceptance passed; source `f7b4760a13` passed CI, CodeQL, Pages, synchronized wiki publication, and exact-tag six-asset Release verification. |
| M26 Cheap LFS / Express Release | **Complete; live public/private UI and source publication verified** | Retained public/private repositories contain pushed UI-created raw pointers and exact 1 MiB draft-release assets. Public automatic setup and private explicit opt-in produced successful Actions runs `29969707165` and `29969957449`; each bot commit adopted a verified 1,033-byte `part-deflate` asset while retaining raw history. Both compressed pointers restored through the production UI to SHA-256 `30e14955…`; failed public run `29967844734` left its raw pointer cloneable and UI-materializable. Source `f7b4760a13` passed CI, CodeQL, Pages/wiki publication, cleanup audit, and exact-tag six-asset Release verification. |
| July 21 Settings queue and mobile connection | **Implementation complete** | Verified empty-account copy, persisted-policy hydration, required-directory validation, parallel/sequential changes, enable/disable dispatch, English/Cantonese/bilingual rendering, responsive-surface registration |
| July 21 responsiveness hardening | **Local implementation complete** | Deterministic regressions verified for remote scan terminator, late termination rejection, same-URL proxy coalescing, strict clone barrier, every prompt family, 500-update burst, failed request-ID reuse, and 25 Markdown reloads |
| M25 Repository-bound API functions | **Implementation complete** | Built-in function seeding verified; function-button execution tested; per-repository rail visibility persistence checked; responsive Explorer styles verified |
| Agent HTTP API | **Implemented** | All eight shipped route patterns audited; all 24 static command names verified; unit coverage spans REST forms, MCP discovery and calls, dynamic named functions, token rejection/rotation, Host/Origin policy, body limits, pairing expiry, device revocation, LAN mode boundaries, gateway policy, browser-link generation, unavailable-mode handling, queue bounds, shutdown, and redaction |
| M24 Guided sparse checkout | **Local acceptance complete** | Verified case-insensitive literal inverse-close matching, counts/preview/zero-match protection, pinned-tab safety, drag and keyboard movement, pin-group boundaries, stable one-shot label/opened/status sorts, persisted order, focus, announcements, and multi-window isolation |
| Actions workflow-run cancellation | **Complete** | Verified exact repository/account/run revalidation, cancellable-status gating, one normal cancel request with duplicate suppression, accepted-response polling, stale and terminal transitions, bounded provider errors, focus return, and compact confirmation layout |
| Reviewed current-branch rebase | **Complete** | Verified target search, current→target and ahead/behind context, bounded commit preview, fresh dirty/conflict/operation guards, exact ref/SHA revalidation, cancel-before-start, conflict continue/abort routing, protected-branch guidance, and no automatic force push |
| Provider account binding and OAuth scope alignment | **Complete; Git transport routing verified locally** | Verified repository-settings binding propagation without reopening, unique-match auto-binding, explicit multiple-account choice, no-match/stale/permission/SSO recovery, generation safety, no silent replacement of a valid binding, and the bounded `repo user workflow notifications read:org` sign-in scope set. HTTPS fetch, pull, push, post-push refresh, scheduled sync, refspec fetch, and remote-HEAD routing now preserve the exact stable repository account key; unbound organization remotes prefer a verified write-capable identity and missing explicit bindings fail closed |
| Compact Repository Tools, Remote Manager, and Regex Builder | **Complete** | Verified vertical reachability at short heights; readable remote name/URL/control columns before a stacked fallback; reflowed Regex Builder categories/tokens with a scrollable body and reachable footer; named controls, focus, zoom, and no page-level horizontal overflow |
| Detailed Pull All progress | **Complete** | Verified live per-repository state, bounded concurrency, completion summary, keyboard/accessibility semantics, compact-window containment, focused and full-suite coverage, the exact production build, and inspected off-screen evidence on main |
| Clone-style Add Submodule | **Complete** | Verified hosted-provider and URL selection, exact-account affinity, reviewed relative path/branch, duplicate and occupied-path rejection, bounded progress, cancellation, list refresh, keyboard labels, and minimum-window containment |
| Repository-wide feature revalidation | **Complete** | The historical revalidation verified the registered-surface and M0–M19 implementation inventory, focused and repository-wide tests, production builds/packages, isolated headless interaction, exact-SHA CI and installer runs, Pages, the seven-page wiki, and its then-current 52-image documentation gallery |
| Live Bambu build Cheap LFS acceptance | **Remote storage, clone integrity, and serialization correction complete** | A public 14,809,588,162-byte, 8,305-file payload completed four proven UI batches after an HTTP 408 retry, cloud run `30048474438` reported 13/0/0 with raw fallback retained across 26 assets, UI commit `712ad85` passed verifier `30054805137`, and a fresh UI clone restored 10/10 hashes from 370–514-byte committed pointers. The first automatic/manual overlap prompted a normalized-checkout queue now covered by deterministic concurrency regressions; the live ten-pointer UI frame is promoted separately from the clone hash receipt. |
| Documentation gallery expansion | **77-scene source catalog** | README, wiki, and Pages source catalog 77 named visual scenes. Existing images remain in place unless a new deterministic capture passes original-resolution privacy inspection; the July 23 continuation adds the Cheap LFS commit-progress, compact Releases, and live Bambu build frames to the prior group-chip, rich-palette, raw Cheap LFS, cloud-compression, and updater images. Remote rendering is checked as part of the exact-source publication receipt rather than encoded as mutable roadmap state. |
| Complete notifications and Releases dashboard | **Complete** | Verified every GitHub notification page, confirmed local/remote Clear all with partial-failure retention, release status metrics and loaded-result search/filtering, rich asset metadata, scoped retries, responsive layout, and inspected headless evidence |

<!-- markdownlint-enable MD013 -->

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
