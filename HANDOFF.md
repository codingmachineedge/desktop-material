# Desktop Material — Final Handoff

## Outcome

The requested roadmap is implemented: **M0 through M18 are complete and
shipped on `main`** through final implementation baseline
`a346d0a569642e1c1b1180994cac4144890bf037`. The implementation, integration
fixes, exhaustive local validation, production build, hidden-desktop review,
responsive regression correction, public documentation, and canonical wiki
publication are complete. There is no remaining queued or in-flight feature
work in [`PLAN.md`](PLAN.md).

The final 1450×997 review found real horizontal clipping in the shell toolbar
and Changes card. The responsive flex/containment correction is now shipped,
covered by style regressions, and demonstrated by the tracked exact-size image
`material-responsive-overflow-fixed.png`. A separate final test run also found
and fixed Node's read-only `globalThis.localStorage` accessor colliding with
jsdom; that was a test-harness defect, not a product regression.

The final Actions review also reproduced the renderer's status-0 failure when
job-log downloads used a manual cross-origin redirect. The shipped correction
lets Electron follow the redirect automatically, while the installed
main-process same-origin filter tracks the request's initial origin and removes
`authentication`, `authorization`, and `cookie` headers before a cross-origin
hop. Renderer-visible download errors use a safe message that omits the
short-lived signed URL and query. The accepted 2048×1228 hidden-desktop proof
shows the real **Windows x64** job log loaded in the searchable, collapsible
viewer with no API error.

## Completed milestone summary

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
  `app/src/ui/actions/`, `app/src/main-process/same-origin-filter.ts`,
  `app/src/lib/agent-commands.ts`,
  `app/src/main-process/agent-server/`,
  `app/src/lib/agent-command-executor.ts`, `script/agent/`, and
  `docs/agent-api.md`.
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

The exhaustive final run on the same application/test tree shipped by
`a346d0a56964` recorded:

- **242 files and 618 suites** in the validation scope;
- **1,861 unit tests: 1,860 passed, 0 failed, 1 intentional skip**;
- `yarn lint`: **passed**;
- `yarn tsc --noEmit --skipLibCheck`: **passed**;
- focused version-history tests: **4 of 4 passed**;
- production unpackaged build: **passed** with
  `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`;
- build and GUI verification through the exact low-level MCP checkout at
  `beed66ca6ed2503e6170ee1e1158247f1c2f0140`;
- the reproducible build emitted `out/`, and Electron was exercised only on a
  uniquely named off-screen Win32 Headless Desktop with isolated fixture and
  user-data paths;
- all final promoted captures were visually inspected at original resolution,
  nonblank, and private-data-free. The standard captures are **1443×992** and
  the user-size responsive proof is **1450×997**. The live Actions job-log
  proof is **2048×1228** and contains no token value, signed URL, account name,
  local path, email address, or personal identifier.

### Final headless capture ledger

| Screenshot | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-agent-access.png` | 1443×992 | 110,128 | `644891eaa37c878cb577065822681ee8fd33a018a92e0b89822b43e67393ef93` |
| `docs/assets/screenshots/material-automation.png` | 1443×992 | 87,304 | `efe45408a390301294d5e23193b619eec858fcef4abb147d82709513c5bb3843` |
| `docs/assets/screenshots/material-branch-merge-all.png` | 1443×992 | 116,134 | `c5cb41e17d67c627758ef43620c255c8272f85ed182a741c086a80d735c8719e` |
| `docs/assets/screenshots/material-history-power-tools.png` | 1443×992 | 122,930 | `fe8b6323d77663467b2a6ae887d5e277e31b8dc84f0e35cec2332537ec7fd28a` |
| `docs/assets/screenshots/material-multi-window-menu.png` | 1443×992 | 115,719 | `9a6cbcbb4c257eac3312b76f8ed0077a6a123901a6bee9b7793b926a61310c66` |
| `docs/assets/screenshots/material-notification-center.png` | 1443×992 | 111,723 | `f8d0cf33723b1c9793d165ab39fd0cec2ccd41b50136d36f6be9c3d34b7d4709` |
| `docs/assets/screenshots/material-provider-accounts.png` | 1443×992 | 117,558 | `91ab46ec566676f0c87534f5e72795e31a62adeecf6bf2597e533920ff428cff` |
| `docs/assets/screenshots/material-scale-200-autofit.png` | 1443×992 | 104,599 | `6fc094a466cef3a540d3bef08db7468e6d9312c9d2242c5abf0df6f9b4fafe05` |
| `docs/assets/screenshots/material-workspace-changes.png` | 1443×992 | 123,162 | `3155b321f9aabb73ee6a40000c69f8931f1915920216818a362ec974cc3a4621` |
| `docs/assets/screenshots/material-responsive-overflow-fixed.png` | 1450×997 | 132,049 | `160c622c6630d96eda26b5ff3be6705c31dbe55d6ffa6d1376575425770278bf` |
| `docs/assets/screenshots/material-actions-job-log.png` | 2048×1228 | 155,579 | `6f8a96a9bff8a9c76f89b44aaf3c84a71574aed11ef994db93d12d2749ca0409` |

Earlier verified captures, including
`docs/assets/screenshots/settings-history-manager.png`, remain tracked; that M3
image is also 1443×992 and has SHA-256
`abbcc34aa02949d2144f008c9ed10b4414f721843890643d65d8e0b9360c3da1`.

## Published design sanitization

The previously local `design/` prototype is now pushed as five auditable source
files: both `.dc.html` prototypes, `design/README.md`, the regex guide, and
`support.js`. Sample names, handles, email addresses, initials, and the private
GitLab-style hostname were replaced with generic examples while the public
`codingmachineedge` repository identity was preserved.

The original thumbnail, seven raster captures, and UUID-named upload were not
published because personal-like identifiers were baked into their pixels and
some carried image metadata. HTML parsing, embedded JavaScript compilation,
local-link checks, Prettier, personal-identifier scanning, and common-secret
pattern scanning all pass on the published source-only set.

## Release automation hardening

- Installer versions use the NuGet-compatible form
  `3.6.3-beta3-b00000000NN`, avoiding the prior dotted prerelease
  normalization failure.
- Squirrel feed processing accepts the final unterminated `RELEASES` record,
  so the required non-architecture full NUPKG alias is always published.
- Installer outputs attach directly to a real public release; the Build
  Installers workflow itself retains no Actions artifacts.
- Documentation-only pushes intentionally skip installer production, while CI
  remains enabled for every push to `main`.
- Existing queued/in-progress runs were canceled when requested. After the
  subsequent enable instruction, no new runs were canceled and all ten
  repository Actions workflows report `active`.

## Secure Actions job-log downloads

- `API.fetchWorkflowJobLogs` uses Electron's automatic redirect path, avoiding
  Chromium's opaque status-0 response for manual cross-origin redirects.
- The already-installed `same-origin-filter` records each request's initial
  origin by request ID and strips authentication, authorization, and cookie
  headers from every cross-origin continuation. Same-origin requests preserve
  their required headers.
- Unit regressions cover redirect following, cross-origin credential removal,
  same-origin header preservation, expired logs, the 5 MB display cap, and
  signed-query-safe failure messages.
- A sanitized live API check confirmed an authenticated 302 to an HTTPS signed
  blob, followed by an unauthenticated `text/plain` 200 response with the CORS
  policy required by the renderer. No token, signed URL, or log body was
  printed during that metadata check.
- The exact `a346d0a569642e1c1b1180994cac4144890bf037` production build loaded the
  real Windows x64 log on the off-screen desktop. The accepted original-size
  capture is `material-actions-job-log.png`; its dimensions and digest are in
  the final capture ledger above.

## Headless verification environment

- Project: `%USERPROFILE%\Documents\GitHub\desktop-material`
- MCP checkout: `%USERPROFILE%\Documents\GitHub\lowlevel-computer-use-mcp`
- Required MCP SHA: `beed66ca6ed2503e6170ee1e1158247f1c2f0140`
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

## Root-finalized publication and accessibility evidence

The closing gate is complete:

- **Code and CI:** final implementation baseline
  `aeaba02818c3a7c13a6ba78554b2917188b7a9ba` passed all seven jobs in
  [CI 29219750257](https://github.com/codingmachineedge/desktop-material/actions/runs/29219750257).
- **Installer and release:**
  [Build Installers 29219750294](https://github.com/codingmachineedge/desktop-material/actions/runs/29219750294)
  succeeded at that exact SHA with zero workflow artifacts. Public, non-draft,
  non-prerelease release
  [`v3.6.3-beta3-b0000000072`](https://github.com/codingmachineedge/desktop-material/releases/tag/v3.6.3-beta3-b0000000072)
  has exactly five uploaded, non-empty assets and an exact-SHA lightweight tag.
  The non-architecture full NUPKG is 307,543,167 bytes; independently streamed
  SHA-1 `0cf684825502c692bd7c61d091132afbbd840a28` matches `RELEASES`, and SHA-256
  `5183826ac72a3248fb005292e3744ea431c8a3fcfb2ca25915afb62dc423bf8d`
  matches the GitHub asset digest.
- **Pages and README:** screenshot/site baseline
  `9e2bd120aafbb89c7ca7de544fd16cd943ec7169` passed
  [Pages 29219686071](https://github.com/codingmachineedge/desktop-material/actions/runs/29219686071).
  The [repository](https://github.com/codingmachineedge/desktop-material) and
  [Pages site](https://codingmachineedge.github.io/desktop-material/) return
  HTTP 200, reference the responsive and Actions log proofs, and serve all 16
  distinct README/site screenshot assets byte-for-byte with their tracked
  SHA-256.
- **Wiki:** the canonical six-file mirror is pushed at
  `72b8eac8bb2f76f3499bedd3f96bc7ea6c295202`. The live
  [Home](https://github.com/codingmachineedge/desktop-material/wiki) and
  [User Guide](https://github.com/codingmachineedge/desktop-material/wiki/User-Guide)
  return HTTP 200 and render the 1450×997 responsive proof; the final User
  Guide source also embeds the 2048×1228 Actions job-log proof from raw `main`.
- **Accessibility and clipping:** the exact-size hidden-desktop review shows
  every repository/worktree/branch/sync/one-click/build toolbar control, all
  Changes filter/composer controls, and no horizontal scrollbar. The supported
  minimum remains contained, and requested 200% scaling auto-fits to 96% when
  required. Keyboard/name/role/focus and 50–200% zoom regressions pass; recorded
  light/dark core contrast pairs meet WCAG AA for normal text.
- **Privacy:** the sanitized five-file design set and the full tracked tree pass
  targeted personal-identifier and common-secret scans. Public local-path
  examples use `%USERPROFILE%`.
- **Git and delegation:** every delegated commit is merged into `main`, every
  delegated branch was pushed, and completed agent worktrees were removed only
  after clean-state, remote-SHA, and ancestry checks.

The final PLAN/HANDOFF closeout is documentation-only, so installer and Pages
workflows correctly do not apply to it. Its exact pushed `main` SHA and
successful CI URL are recorded in the final task response because a commit
cannot include its own hash.

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
- `build-installers.yml` intentionally publishes a release on qualifying
  non-documentation pushes to `main`; verify whether a docs-only merge is
  correctly skipped before reporting the final release state.
