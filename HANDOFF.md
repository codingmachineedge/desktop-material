# Desktop Material — Final Handoff

## Outcome

The original requested roadmap is implemented: **M0 through M18 are complete and
shipped on `main`** through final implementation baseline
`b2699faccb07728fe9aa2838aa13355d71e172b0`. The implementation, integration
fixes, exhaustive local validation, production build, hidden-desktop review,
responsive regression correction, public documentation, and canonical wiki
publication are complete. There is no remaining queued or in-flight feature
work in [`PLAN.md`](PLAN.md).

The later guided Git and GitHub expansion is a separate living roadmap. This
handoff records the completed functions integrated from that work without
claiming that its remaining README roadmap items are finished.

### Guided roadmap completion run — live status

The final guided-roadmap completion is active on
`codex/guided-final-gate`. Integration checkpoint `ced95bf0f6` contains the
privacy-safe cross-account clone and Pull All recovery, hardened Actions logs
and artifact transfer, the complete native pull-request lifecycle, interactive
artifact pagination, effective branch-rule inspection, patch-series exchange,
complete worktree lifecycle administration, branch pin/hide/solo/restore,
exact merge-tree conflict paths, signing and Git LFS administration,
structured local-commit rewriting, guided bisect sessions, the complete
repository-wide native stash manager, and reviewed GitHub Releases/assets
management with secure arbitrary asset transfers. Each completed phase was
committed and pushed after its focused security, TypeScript, lint, formatting,
and privacy gates passed. The bisect integration union passed 75 focused
Git/model/UI/style/sibling tests; the stash integration passed 46 focused
Git/UI/style tests; and the Releases branch passed 180 combined affected tests
before root repeated its focused transfer/API/store/UI gate and TypeScript
check.

The complete remote manager, repository hooks, and richer Issue workflows are
in isolated worktrees. Provider-neutral triage follows those integrations.
Nothing in this live section claims publication on `main`: final production
build, off-screen
interaction, accepted screenshots, documentation/wiki synchronization, CI,
Pages, installer release, and cleanup remain mandatory gates before this run
can be closed.

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

Pull All now keeps its normal, unforced credential attempt first. If that
attempt produces only an HTTPS authentication failure or HTTPS not-found
ambiguity, it can try the remaining token-bearing signed-in accounts for the
exact HTML origin. The repository-bound account is preferred, followed by the
stable account order. The accepted isolated proof advanced cleanly from proof A
`dd0bbb04b04da50d42fa55245bc89a1426f01488` to proof B
`1d58935cf4ef9645f08e2fb3aa68e364ab382676`; its redacted sequence was primary
account rejected, fallback account accepted. The neutral renderer result is
exactly `Pull completed using another signed-in account.` and does not expose
which account or token succeeded.

Secure clone account fallback is also complete. A hosted clone preserves the
user-selected account for its first attempt. A generic URL clone chooses the
API-matched token-bearing account, or the first eligible exact-origin account
when lookup is inconclusive, specifically to avoid a manual credentials prompt;
it remains unforced only when no eligible identity exists. Only an HTTPS
authentication/not-found ambiguity can silently try another token-bearing
account for the exact rejecting origin, including a non-default port. The
successful stable account key is persisted before initial repository matching
and remains attached to single, batch, missing-repository, and retry-clone
flows. The implementation is `0b4f25cc8e91eb62634e70f90e24f1a44d00dc9d`;
its first reviewed `main` baseline is
`3dc1ecc4d8daff6150980e47a13db4f3a61ec37a`.

## Guided-function integration

The privacy-safe squash integration adds the completed guided-function work
without importing the feature branch's original commit ancestry. The integrated
product behavior includes:

- bounded shallow clone plus later history deepening;
- validated cone-mode sparse checkout;
- native file history/blame and guarded repository bundle/archive/signature
  tools;
- an account-aware GitHub notification inbox;
- guided GitHub issue and pull-request creation;
- confirmed Actions mutations; and
- responsive task forms whose controls wrap or stack instead of causing
  page-level sideways scrolling.

The pull-request slice's exact-remote binding and the first Actions artifact
browse/download/digest slice are present in this sanitized source snapshot but
are not yet shipped capabilities. Independent review still requires userinfo,
alternate-SSH, and cross-repository REST corrections for pull requests, plus
chained-redirect hardening and focused security regressions for artifact
downloads, before either slice can join `main`. This snapshot therefore remains
an integration base, not a final publication candidate.

### Sanitized squash verification

The integration uses the source tree at `5d50500e40edac023336434a5bff3ced32df881e`
on top of `main` baseline `f84903c6acd3f8e9d3d632887ee93a01258f1896`.
The source delta was applied as one squash, so its original commit authors are
not part of this branch's ancestry. The integration gate recorded:

- TypeScript `--noEmit --skipLibCheck`: **passed**;
- all 50 added or modified unit-test files: **307 passed, 0 failed**;
- the dedicated clone-account/shallow-clone semantic-union set: **67 passed, 0
  failed**;
- the final pull-request/API regression rerun after source-tip hardening: **49
  passed, 0 failed**;
- repository code/config Prettier and targeted Markdown Prettier: **passed**;
  and
- cached diff, conflict-marker, unmerged-path, local-user-path, personal-name,
  raw PID/HWND, common-key, and screenshot-reference scans: **passed**. The one
  token-shaped value retained by the scan is a deliberate synthetic response-
  redaction fixture.

The README remains the authority for guided functions that are still planned or
in progress. No unimplemented item is promoted to shipped status here.

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
  `docs/agent-api.md`.
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
- all final promoted captures were visually inspected at original resolution,
  nonblank, and private-data-free. The standard captures are **1443×992** and
  the user-size responsive proof is **1450×997**. The live Actions job-log
  proof is **2048×1228** and contains no token value, signed URL, account name,
  local path, email address, or personal identifier.

### Secure clone account fallback validation

The later clone hardening tree at implementation commit
`0b4f25cc8e91eb62634e70f90e24f1a44d00dc9d`, first reviewed on `main` at
`3dc1ecc4d8daff6150980e47a13db4f3a61ec37a`, recorded:

- **627 suites and 1,906 tests: 1,905 passed, 0 failed, 1 intentional skip**;
- full source lint, repository-wide Prettier, and TypeScript: **passed**;
- the exact MCP-driven unpackaged production build: **passed**;
- an isolated hidden-desktop HTTPS smart-Git sequence of account A rejected,
  then account B silently accepted, with the cloned repository clean on `main`
  at `c9eee876c4451d380f8cc7628b5971f624f9395f`;
- preservation of the fixture's custom-port exact origin, with no credentials
  dialog shown; and
- complete cleanup of every owned application/server process, listener, Temp
  path, and synthetic credential entry.

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
| `docs/assets/screenshots/material-pull-all-account-fallback.png` | 2048×1228 | 114,222 | `80674cf75511c1238bcf527e6e678ffd3d46e4cc36ee2455ebd4b8cecf1c0991` |
| `docs/assets/screenshots/material-clone-account-fallback.png` | 2048×1228 | 140,143 | `89bb755ad37f6d8537815d411526fa6e16aeee9cd16446deabbc17595cb3623c` |

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
- The viewer ignores a late rejection from an older job after another job is
  opened, and closing the viewer clears loading/error state so an in-flight
  request cannot repopulate it. Focused tests cover both races.
- Release publication explicitly targets the triggering `github.sha`, so an
  overlapping documentation push cannot move a generated tag to newer `main`.
- A sanitized live API check confirmed an authenticated 302 to an HTTPS signed
  blob, followed by an unauthenticated `text/plain` 200 response with the CORS
  policy required by the renderer. No token, signed URL, or log body was
  printed during that metadata check.
- The exact `a346d0a569642e1c1b1180994cac4144890bf037` production build loaded the
  real Windows x64 log on the off-screen desktop. The accepted original-size
  capture is `material-actions-job-log.png`; its dimensions and digest are in
  the final capture ledger above.

## Secure Pull All account fallback

- The repository's normal credential resolution always runs first, without a
  forced selector.
- Retry eligibility is limited to the ambiguity between HTTPS authentication
  failure and HTTPS repository-not-found. SSH remotes and non-authentication
  errors are never retried with other accounts.
- Only token-bearing signed-in accounts whose configured HTML endpoint has the
  exact remote origin are candidates. The repository-bound account is preferred
  among the remaining candidates, then stable account order is preserved.
- The forced account selector is kept in the internal trampoline map, removed
  after the operation, and stripped before spawning Git. It never enters a Git,
  hook, LFS, or other child-process environment and is not emitted to logs.
- A missing exact-origin selection fails closed for that origin. A cross-origin
  submodule scopes the selector away and follows normal credential resolution.
- The accepted off-screen proof uses only synthetic loopback and repository
  labels. It shows `1 pulled, 0 skipped, 0 failed.` and the exact neutral result
  `Pull completed using another signed-in account.` without exposing an account
  name or token.

## Secure clone account fallback

- A valid hosted-tab account selection is forced for the first clone attempt.
  For a generic URL, `getPreferredGenericCloneAccountKey` chooses the
  API-matched token-bearing account or, if lookup is inconclusive, the first
  eligible exact-origin account. Only a clone with no eligible identity keeps
  normal unforced behavior, preventing an avoidable credentials prompt.
- Only HTTPS authentication failure or HTTPS repository-not-found ambiguity can
  start fallback. SSH, malformed URLs, certificate failures, transport errors,
  and other non-authentication failures are not retried across accounts.
- Eligible candidates are token-bearing signed-in accounts whose configured
  HTML endpoint has the same scheme, host, and port as the origin that rejected
  the credential. Lookalike hosts, scheme changes, and port changes fail closed.
- The credential helper records only the rejected origin and internal stable
  account selector. Neither a token nor selector is added to a Git child
  environment, command line, log, screenshot, or error message.
- A successful fallback account key propagates through clone completion and is
  persisted before initial API matching. Single clone, batch clone,
  missing-repository recovery, and retry actions therefore keep the account
  that actually succeeded instead of rebinding to the first same-host account.
- The accepted 2048×1228 light-theme capture is
  `material-clone-account-fallback.png`. The redacted server ledger proves
  account A rejected, account B accepted, advertisement served, and pack served;
  the cloned repository is clean at
  `c9eee876c4451d380f8cc7628b5971f624f9395f`, and no credentials dialog appears.

## Guided Git and GitHub evidence

On 2026-07-13, a subsequent exact off-screen run verified three named,
task-specific app functions at **1000×687**. The app presents focused controls
and state for these
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

The retained Notifications PNG was reopened at original resolution and matched
the source capture's SHA-256. Other captures from that run are not included;
fresh neutral-path captures are required before their guided UI is published.
No bundle-import or issue-creation screenshot is included in this evidence set.
Task forms follow a no-page-level-sideways-scroll policy: labels wrap and action
groups stack when practical, while horizontal scrolling is reserved for spatial
code, diff, or log content.

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

## Previous root-finalized publication and accessibility evidence

The most recent completed closing gate before this guided-function integration
recorded:

- **Code and CI:** final implementation baseline
  `b2699faccb07728fe9aa2838aa13355d71e172b0` passed all seven jobs in
  [CI 29225926836](https://github.com/codingmachineedge/desktop-material/actions/runs/29225926836).
- **Installer and release:**
  [Build Installers 29225926808](https://github.com/codingmachineedge/desktop-material/actions/runs/29225926808)
  succeeded at that exact SHA with zero workflow artifacts. Public, non-draft,
  non-prerelease release
  [`v3.6.3-beta3-b0000000076`](https://github.com/codingmachineedge/desktop-material/releases/tag/v3.6.3-beta3-b0000000076)
  has exactly five uploaded, non-empty assets and an exact-SHA lightweight tag.
  Both full NUPKG aliases are 307,547,223 bytes with SHA-256
  `3a4b0bd30668b2480f9820dab62ca7cfa13f2b58e976ce7454c024942029f365`.
- **Pages and README:** screenshot/site baseline
  `3acb0ba0dc69af6f2cfdd5e2967593158eac448d` passed
  [Pages 29227302226](https://github.com/codingmachineedge/desktop-material/actions/runs/29227302226).
  The [repository](https://github.com/codingmachineedge/desktop-material) and
  [Pages site](https://codingmachineedge.github.io/desktop-material/) return
  HTTP 200. The Pages and raw-main Pull All proof URLs both serve the tracked
  114,222 bytes with SHA-256
  `80674cf75511c1238bcf527e6e678ffd3d46e4cc36ee2455ebd4b8cecf1c0991`.
- **Wiki:** the canonical six-file mirror is pushed at
  `2d169244373f27a6b08f6c9594ec433ff561880b`. The live
  [Home](https://github.com/codingmachineedge/desktop-material/wiki) and
  [User Guide](https://github.com/codingmachineedge/desktop-material/wiki/User-Guide)
  return HTTP 200 and render the 1450×997 responsive proof; the final User
  Guide source also embeds the 2048×1228 Actions job-log proof from raw `main`.
  The published User Guide embeds the 2048×1228 Pull All account-fallback proof
  through its raw-main URL.
- **Accessibility and clipping:** the exact-size hidden-desktop review shows
  every repository/worktree/branch/sync/one-click/build toolbar control, all
  Changes filter/composer controls, and no horizontal scrollbar. The supported
  minimum remains contained, and requested 200% scaling auto-fits to 96% when
  required. Keyboard/name/role/focus and 50–200% zoom regressions pass; recorded
  light/dark core contrast pairs meet WCAG AA for normal text.
- **Privacy:** the sanitized five-file design set and the full tracked tree pass
  targeted personal-identifier and common-secret scans. Public local-path
  examples use `%USERPROFILE%`; the Pull All proof contains only synthetic
  loopback/repository labels and no real identity, token, local path, or email.
- **Secure clone implementation checkpoint:** implementation commit
  `0b4f25cc8e91eb62634e70f90e24f1a44d00dc9d` is present in first reviewed
  `main` baseline `3dc1ecc4d8daff6150980e47a13db4f3a61ec37a`.

Those links and checks remain evidence for their stated historical baselines;
they are not presented as validation of this code integration. Because the
guided-function squash changes application code, its eventual `main` SHA needs
fresh CI, installer/release applicability, Pages, and public-documentation
verification before the repository-wide closing gate can be called current.

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
