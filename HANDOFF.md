# Desktop Material — Active parity handoff

## Outcome

The complete **M0 through M19** Material and guided Git/GitHub roadmap is shipped
on `main`; it deliberately turns audited capabilities into named, interactive
app functions instead of exposing a searchable command/API list.

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
