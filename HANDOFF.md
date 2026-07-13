# Desktop Material — Active parity handoff

## Outcome

The legacy **M0 through M18** Material foundation remains shipped on `main`.
The newer Git, GitHub CLI, GitHub API, and GitKraken-parity roadmap is active on
`mega-feature-update`; it deliberately turns audited capabilities into named,
interactive app functions instead of exposing a searchable command/API list.

The first four-function P0 wave is implemented, pushed, and production-UI
verified at exact source SHA `9e946fd527e5843b2fdba5de675a5476b0c80445`:
guided history deepening, native pull-request creation, Actions artifact
download/digest context, and effective branch-rules inspection. The next
checkpoint is a typed operation registry that removes arbitrary
renderer-supplied Git argv, followed by the Pull Request Center, Actions
completion, Issue Hub, and Release Manager listed in the README roadmap.

This handoff does not claim that branch-only Pages assets are already live on
`main`. Pages remains protected to the normal reviewed `main` promotion path;
the separate wiki was merged rather than overwritten and published at exact
wiki SHA `cf115fec684278f44cceced279651b7f288b2ddd`.

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
| **M7** | **COMPLETE** | Parallel/sequential multi-clone plus URL-only repository export/import. |
| **M8** | **COMPLETE** | 50–200% UI scaling, auto-fit, and full GitHub organization repository browsing. |
| **M9** | **COMPLETE** | One-click commit/push, schedulers, safe auto-pull, and merge-all branches/worktrees. |
| **M10** | **COMPLETE** | GitHub Actions runs, reruns, workflow dispatch, job detail, and searchable logs. |
| **M11** | **COMPLETE** | Secure localhost MCP/REST agent server, renderer bridge, stdio proxy, CLI, and Preferences UI. |
| **M12** | **COMPLETE** | Desktop Plus quick-win parity: telemetry off, status/sort controls, Material actions, identity, permanent discard, hide-recent, and accessibility tooltips. |
| **M13** | **COMPLETE** | Repository metadata/defaults, pinning/grouping, branch pills, Pull all, remotes, and submodules. |
| **M14** | **COMPLETE** | History metadata/regex search, commit graph, guarded deletion, SVG preview, and branch presets. |
| **M15** | **COMPLETE** | Multiple stashes per branch and the rebranded Desktop Material CLI. |
| **M16** | **COMPLETE** | Tab-aware multi-window lifecycle, routing, scoping, and serialized profile mutation. |
| **M17** | **COMPLETE** | GitLab/Bitbucket providers, self-hosted GitLab PAT flow, clone browsing, and cross-host PR/status routing. |
| **M18** | **COMPLETE** | Full Material shell and final post-shell polish, including layout, clipping, and accessibility regression coverage. |

Additional shipped work includes the `.gitignore` manager, Build & Run with
toolchain/project handling, multi-remote and submodule managers, fork-owned
updating, and the merge-wave integration fixes listed in Git history.

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
  `app/src/lib/stores/batch-clone-store.ts`,
  `app/src/ui/clone-repository/`, `app/src/lib/repo-list-file.ts`, and
  `app/src/ui/repository-list-transfer/`.
- **Automation:** `app/src/lib/automation/`,
  `app/src/lib/stores/helpers/automation-scheduler.ts`,
  `app/src/ui/preferences/automation.tsx`,
  `app/src/ui/repository-settings/automation-overrides.tsx`, and
  `app/src/ui/merge-all/`.
- **Actions and agent access:** `app/src/lib/stores/actions-store.ts`,
  `app/src/ui/actions/`, `app/src/lib/agent-commands.ts`,
  `app/src/main-process/agent-server/`,
  `app/src/lib/agent-command-executor.ts`, `script/agent/`, and
  `docs/wiki/Agent-API.md`.
- **Repository parity:** `app/src/lib/databases/repositories-database.ts`,
  `app/src/ui/repository-settings/`, `app/src/ui/pull-all/`,
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

## Final integrated validation evidence

The final pre-documentation integration run at `4da59bd383` recorded:

- **239 files** in the integration validation scope;
- **1,850 unit tests: 1,849 passed, 0 failed, 1 intentional skip**;
- `yarn lint`: **passed**;
- `yarn tsc --noEmit --skipLibCheck`: **passed**;
- production unpackaged build: **passed** with
  `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`;
- build and GUI verification through the exact low-level MCP checkout at
  `beed66ca6ed2503e6170ee1e1158247f1c2f0140`;
- the reproducible build emitted `out/`, and Electron was exercised only on a
  uniquely named off-screen Win32 Headless Desktop with isolated fixture and
  user-data paths;
- all captures in that earlier final set were visually inspected at original
  resolution, nonblank, private-data-free, and exactly **1443×992**.

### Final headless capture ledger

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

## Root-finalized publication and accessibility gate

After merging these closing docs, root must perform and report all of the
following against the resulting final `main` SHA:

1. **Git state:** local `main` equals `origin/main`; no delegated branch content
   remains unmerged; unrelated pre-existing files remain untouched.
2. **CI:** every applicable CI, Pages, and release workflow is successful or
   correctly skipped for that exact SHA. Include the workflow URLs.
3. **Pages and README:** public pages return HTTP 200, show the final shipped
   ledger rather than roadmap labels, and serve each referenced screenshot with
   the tracked hash.
4. **Wiki:** push the canonical `docs/wiki/` mirror, record the wiki commit, and
   verify the live pages plus raw-main screenshot references.
5. **Accessibility:** keyboard navigation and focus order work; interactive
   controls have accessible names, roles, and state; focus remains visible;
   dark/light contrast and disabled/error states remain legible; no regression
   exists in list tooltip, dialog, tab, Actions, agent-access, or provider
   surfaces.
6. **Clipping and scaling:** inspect the supported minimum viewport and the
   **1443×992** verification viewport in light/dark themes and representative
   50%, 100%, 150%, and 200% scaling. Confirm no clipped file rows, FABs,
   search/filter rows, branch controls, tab actions, remote/submodule controls,
   Pull-all content, workflow/log controls, or horizontal page overflow.
7. **Final evidence:** record the pushed SHA, workflow URLs, public URLs, wiki
   SHA, response status, screenshot names/sizes/hashes, and audit result.

For the legacy M0-M18 foundation, final public verification still follows that
gate. The newer function-first parity roadmap is intentionally active: the P0
four-function slice is production-verified, its documentation publication is in
progress, and the typed-operation/PR/Actions/Issue/Release waves remain next.

## Maintenance constraints

- Keep account identity on `endpoint#id`; never collapse provider accounts by
  login or host alone.
- Keep profile settings, tab mutations, history operations, and multi-window
  updates on the serialized profile queue.
- Keep secrets out of profile/notification Git repositories, exports, logs,
  screenshots, and agent responses.
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
