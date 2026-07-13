# Desktop Material — Feature and Acceptance Plan

## Current status

Milestones **M0 through M18 are shipped on `main`** through historical
implementation baseline `b2699faccb07728fe9aa2838aa13355d71e172b0`.
The later guided parity milestone, **M19**, is implementation-complete through
integration checkpoint `a00e751c575c80dee345b1b51b1d411dcd20e911` on
`codex/guided-final-gate`. Every named P0, P1, P2, and Later capability is in
that source tree with focused regression evidence. M19 is not yet described as
shipped on `main`: exhaustive final gates, the exact production/off-screen
acceptance run, accepted screenshots, documentation/wiki synchronization, CI,
Pages, release verification, and cleanup remain open.

That checkpoint also changed the Windows unit launcher to run the full 360-file
suite in two bounded batches; its interim integration run exited successfully.
It is not the final post-merge acceptance result and must not replace the open
closing checklist below.

The M0–M18 baseline includes the responsive-shell correction prompted by the final
1450×997 review, its exact-size headless regression capture, the public
README/Pages/wiki propagation, the shared Node/jsdom UI-test storage fix, and
secure GitHub Actions log downloads with stale-response protection.
Installer release creation is pinned to the triggering `github.sha`, preventing
an overlapping documentation push from moving a generated tag to newer `main`.
It also includes bounded Pull All recovery through another signed-in account
for the exact HTTPS origin. The accepted proof image is committed at
`3acb0ba0dc69af6f2cfdd5e2967593158eac448d`.
A later secure clone account-fallback milestone is shipped at implementation
commit `0b4f25cc8e91eb62634e70f90e24f1a44d00dc9d`, with first reviewed `main`
baseline `3dc1ecc4d8daff6150980e47a13db4f3a61ec37a`. Clone now preserves the
hosted selection and proactively chooses the API-matched token-bearing account
for a generic URL, or the first eligible exact-origin account when lookup is
inconclusive. It remains unforced only when no eligible identity exists, then
silently retries another account only after an authentication/not-found failure
from that exact HTTPS origin while retaining any custom origin port.
Historical publication evidence is recorded below and in
[`HANDOFF.md`](HANDOFF.md). The closing M19 evidence checklist appears at the
end of this plan and must be filled only after each check actually succeeds.

## Product milestone ledger

| Milestone | Status | Delivered capability | Important implementation paths |
| --- | --- | --- | --- |
| **M0 — Publishing bootstrap** | **COMPLETE** | CI on `main`, Windows installer/release automation, Material README and Pages site, canonical wiki sources, and tracked screenshots. | `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `.github/workflows/build-installers.yml`, `site/`, `docs/wiki/`, `docs/assets/screenshots/` |
| **M1 — Per-account profiles** | **COMPLETE** | Token-safe settings profiles stored in one local Git repository per account, serialized writes, recovery, and account switching. | `app/src/models/profile.ts`, `app/src/lib/profiles/`, `app/src/lib/stores/profile-store.ts` |
| **M2 — Repository tabs** | **COMPLETE** | Browser-style repository tabs, profile persistence, rename/reorder/close operations, close-by-range or regex, and Word-style per-tab typography/color controls. | `app/src/models/repository-tab.ts`, `app/src/lib/stores/repository-tabs-store.ts`, `app/src/ui/repository-tabs/` |
| **M3 — Settings history** | **COMPLETE** | Git-backed settings history with lazy diffs, logical undo/redo, restore-to-point, audit commits, and reusable history UI. | `app/src/ui/version-history/`, `app/src/ui/settings-history/`, `app/src/lib/profiles/profile-git.ts` |
| **M4 — Non-modal dialogs** | **COMPLETE** | Draggable, stackable in-app dialogs and side sheets that leave the main app interactive, with modal behavior retained only where required. | `app/src/ui/dialog/`, `app/src/lib/popup-manager.ts`, `app/src/ui/app.tsx`, `app/styles/ui/_dialog.scss` |
| **M5 — Notification centre** | **COMPLETE** | Bell and right-side notification panel, unread controls, Git-backed notification log, and reusable notification history. | `app/src/models/notification-centre.ts`, `app/src/lib/stores/notification-centre-store.ts`, `app/src/ui/notifications/` |
| **M6 — Search and regex builder** | **COMPLETE** | Shared fuzzy, substring, and regex modes; case sensitivity; list filters; full block-based regex builder; and History search. | `app/src/lib/fuzzy-find.ts`, `app/src/ui/lib/filter-mode-control.tsx`, `app/src/ui/lib/regex-builder/`, `app/src/ui/history/` |
| **M7 — Multi-clone and transfer** | **COMPLETE** | Parallel/sequential multi-clone, batch progress, URL-only repository export/import, and secure exact-origin account fallback with persisted successful-account affinity. | `app/src/models/batch-clone.ts`, `app/src/lib/automation/clone-account-fallback.ts`, `app/src/lib/git/authentication-failure-origin.ts`, `app/src/lib/stores/batch-clone-store.ts`, `app/src/lib/stores/cloning-repositories-store.ts`, `app/src/ui/clone-repository/`, `app/src/lib/repo-list-file.ts`, `app/src/ui/repository-list-transfer/` |
| **M8 — Scaling and organizations** | **COMPLETE** | 50–200% user scaling, auto-fit, shortcuts, full GitHub organization repository browsing, and organization-aware clone selection. | `app/src/lib/zoom.ts`, `app/src/ui/preferences/appearance.tsx`, `app/src/ui/clone-repository/org-filter-chips.tsx`, `app/src/lib/stores/api-repositories-store.ts` |
| **M9 — Automation** | **COMPLETE** | One-click commit/push, global and per-repository schedules, safe auto-pull, merge-all for branches/worktrees, Copilot conflict handling, notifications, and summaries. | `app/src/lib/automation/`, `app/src/lib/stores/helpers/automation-scheduler.ts`, `app/src/ui/preferences/automation.tsx`, `app/src/ui/repository-settings/automation-overrides.tsx`, `app/src/ui/merge-all/` |
| **M10 — Actions panel** | **COMPLETE** | Workflow run filters, rerun actions, workflow dispatch inputs, job/step detail, and searchable in-app logs. | `app/src/lib/stores/actions-store.ts`, `app/src/lib/actions-workflow-inputs.ts`, `app/src/lib/actions-log-parser/`, `app/src/ui/actions/` |
| **M11 — Agent access** | **COMPLETE** | Localhost-only token-gated MCP and REST server, one shared redacted command contract, renderer execution bridge, stdio proxy, CLI, and Preferences controls. | `app/src/lib/agent-commands.ts`, `app/src/main-process/agent-server/`, `app/src/lib/agent-command-executor.ts`, `app/src/ui/preferences/agent-access.tsx`, `script/agent/`, `docs/agent-api.md` |
| **M12 — Desktop Plus quick wins** | **COMPLETE** | Telemetry disabled, Material destructive actions/icons, date and merge-commit styling, branch status/sort controls, hide-recent, permanent discard, Git identity, accessibility tooltips, and related parity controls. | `app/src/ui/changes/`, `app/src/ui/branches/`, `app/src/ui/repositories-list/`, `app/src/ui/preferences/`, `app/styles/ui/` |
| **M13 — Repository metadata and Pull All** | **COMPLETE** | Pinning, custom groups, branch pills, repository-specific defaults/editor override, bounded Pull All with exact-origin signed-in account fallback, multi-remote management, and full submodule management. | `app/src/lib/databases/repositories-database.ts`, `app/src/ui/repository-settings/`, `app/src/ui/pull-all/`, `app/src/lib/automation/pull-all.ts`, `app/src/lib/automation/pull-all-account-fallback.ts`, `app/src/lib/git/pull.ts`, `app/src/lib/trampoline/find-account.ts`, `app/src/lib/trampoline/trampoline-environment.ts` |
| **M14 — History power tools** | **COMPLETE** | Metadata-aware title/message/tag/hash search, shared fuzzy/regex timeline search, Material commit graph, guarded pushed-history deletion, sanitized SVG code/preview modes, and branch-name preset scripts/shortcuts. | `app/src/ui/history/`, `app/src/ui/diff/image-diffs/`, `app/src/ui/create-branch/`, `app/src/lib/git/` |
| **M15 — Stashes and Desktop Material CLI** | **COMPLETE** | Multiple stashes per branch, stash selection/context actions, and the rebranded Desktop Material command-line entry point. | `app/src/models/stash-entry.ts`, `app/src/lib/git/stash.ts`, `app/src/ui/stashing/`, `app/src/lib/desktop-material-cli.ts`, `app/src/cli/` |
| **M16 — Multi-window** | **COMPLETE** | Tab-aware window creation/routing, scoped selected repositories and tabs, safe shared-profile serialization, and multi-window menu/context actions. | `app/src/main-process/window-routing.ts`, `app/src/main-process/app-window.ts`, `app/src/main-process/main.ts`, `app/src/lib/window-scope.ts`, `app/test/unit/window-routing-test.ts` |
| **M17 — GitLab, Bitbucket, and self-hosted GitLab** | **COMPLETE** | Provider API foundation, GitLab PAT and Bitbucket sign-in, self-hosted endpoint support, provider clone browsing, cross-host PR/status routing, credential isolation, and provider documentation. | `app/src/lib/api.ts`, `app/src/lib/stores/accounts-store.ts`, `app/src/ui/preferences/accounts.tsx`, `app/src/ui/clone-repository/`, `docs/integrations/gitlab.md`, `docs/integrations/bitbucket.md` |
| **M18 — Final Material alignment** | **COMPLETE** | Full MD3 shell, tokens, motion, navigation rail, floating workspace cards, dialogs/sheets, de-stocked controls, final post-shell polish, accessibility coverage, and clipping/layout fixes across milestone surfaces. | `app/styles/_material.scss`, `app/styles/_material-shell.scss`, `app/styles/ui/`, `app/src/ui/app.tsx`, `app/test/unit/post-shell-style-test.ts`, `app/test/unit/ui/` |
| **M19 — Guided Git, GitHub, and provider parity** | **IMPLEMENTATION COMPLETE — FINAL ACCEPTANCE PENDING** | Native P0/P1/P2/Later workflows: PR lifecycle, Actions artifacts and effective rules, patch series, structured commit rewrite, signing, LFS, worktrees, branch visibility, merge-tree conflict preview, bisect, complete stash/remote/hooks administration, Releases/assets, richer GitHub Issues, and provider-neutral triage. | `app/src/ui/repository-tools/`, `app/src/ui/actions/`, `app/src/ui/github-pull-request-lifecycle/`, `app/src/ui/github-releases/`, `app/src/ui/github-issues/`, `app/src/ui/worktrees/`, `app/src/ui/stashing/`, `app/src/lib/provider-triage.ts` |

## M19 guided parity implementation ledger

| Wave | Status | Integrated named functions |
| --- | --- | --- |
| **Foundation** | **IMPLEMENTATION COMPLETE** | Bounded Repository Tools runner; file history/blame and guarded restore; status/health/maintenance/reflog; shallow clone/deepening; sparse checkout; archives; bundle export/verify/create-only import; Notifications and guided Issue creation. |
| **P0** | **IMPLEMENTATION COMPLETE** | Pull-request templates, reviewers, assignees, labels, review/update/close/reopen/merge; paginated Actions artifacts with bounded redirect/download/digest handling; effective current-branch rule inspection. |
| **P1** | **IMPLEMENTATION COMPLETE** | Patch-series export/import, structured local-commit rewrite, GitHub Releases/assets, commit/tag signing, Git LFS, and complete worktree lifecycle administration. |
| **P2** | **IMPLEMENTATION COMPLETE** | Persisted branch pin, hide, solo, and restore controls with clear filtered-state recovery. |
| **Later** | **IMPLEMENTATION COMPLETE** | Exact merge-tree conflict paths, guided bisect, complete repository-wide Stash Manager, guarded Remote Manager, safe Repository Hooks Manager, richer GitHub Issues, and exact-account GitHub/GitLab/Bitbucket triage. |
| **Closing acceptance** | **PENDING** | Exhaustive final union, exact production build, isolated off-screen interaction, inspected screenshots, `main` merge, CI/Pages/wiki/release verification, and owned-resource cleanup. |

## Additional completed product work

- The per-repository `.gitignore` manager, template catalogue, suggestions, and
  reversible marker-section merge live in `app/src/lib/gitignore/` and
  `app/src/ui/repository-settings/`.
- Build & Run detects Node, Rust, Go, .NET, Python, Java, Make, and CMake
  projects; handles multiple .NET projects; can install missing toolchains;
  streams logs; minimizes; and stores per-repository settings under
  `app/src/lib/build-run/`, `app/src/main-process/`, and
  `app/src/ui/build-run/`.
- Fork update checks and release feeds point to the Desktop Material repository,
  not the upstream GitHub Desktop updater.
- The `design/` prototype sources are published as a sanitized five-file set;
  sample identities and private-looking endpoints were replaced, while raster
  files with identifiers baked into pixels or metadata were intentionally
  excluded.
- GitHub Actions job logs use Electron-managed redirects so Chromium receives
  the signed-host body without an opaque status-0 response. The installed
  request filter strips authentication, authorization, and cookie headers on
  cross-origin hops; safe errors omit signed URLs, and late failures cannot
  overwrite a newer or closed job viewer.
- Pull All first attempts the repository's normal credential resolution. Only
  an HTTPS authentication failure or HTTPS not-found ambiguity can retry the
  remaining token-bearing signed-in accounts for that exact HTML origin. A
  repository-bound account is preferred, then the stable account order is
  retained; SSH and non-authentication failures are never retried.
- Clone preserves a valid hosted-account selection for the first attempt. For a
  generic URL it chooses the API-matched token-bearing account, or the first
  eligible exact-origin account when lookup is inconclusive, so Git does not
  open a manual credentials prompt. The attempt remains unforced only when no
  eligible identity exists. An HTTPS authentication/not-found ambiguity is
  bound to the rejecting origin; only remaining token-bearing accounts for that
  exact scheme, host, and port are eligible. The successful account key is
  persisted before initial repository matching and retained by single, batch,
  missing-repository, and retry-clone paths.
- Account selection, profile mutation serialization, export rendering,
  provider routing, submodule display, repository tooltips, and other integration
  regressions found during the merge waves were fixed before the final build.

## Architecture contracts that remain authoritative

1. Account identity is `getAccountKey(account) = endpoint#id`; provider ports do
   not fall back to login-only identity.
2. Profile settings, tabs, flushes, history actions, and multi-window mutations
   use the same serialized profile queue.
3. `VersionedStoreHistory` remains the shared settings/notification history UI.
4. Batch clone consumes sanitized URL-only items; exports never contain tokens.
5. Filter modes and regex parsing use the shared bounded search infrastructure.
6. Automation posts results to the notification centre and never lets a
   background failure block the foreground UI.
7. Agent access stays localhost-only, opt-in, token-gated, origin-checked,
   size-bounded, and redacted.
8. Desktop Plus behavior is adapted under its MIT license, but visuals continue
   to use Desktop Material's `--md-sys-*` token system.
9. No token may be written to a profile repository, notification repository,
   export file, screenshot, log, or agent response.
10. Pull All account fallback remains HTTPS-only and exact-origin. Its forced
    account selector is internal to the trampoline, is never placed in a Git
    child environment, and is removed after the operation. Missing same-origin
    credentials fail closed; cross-origin submodules use normal credential
    resolution.
11. Clone account fallback remains HTTPS-auth/not-found-only and is scoped to
    the origin that rejected the credential, including any non-default port.
    A generic URL selects the API-matched token-bearing identity or the first
    eligible exact-origin identity and remains unforced only when none exists.
    Account selectors stay internal to the trampoline; the successful stable
    account key is persisted for later repository matching and retries without
    exposing a token, login, selector, or credentials dialog.

## Prior M0–M18 integrated validation evidence

The exhaustive historical run on the same application/test tree shipped by
`b2699faccb07728fe9aa2838aa13355d71e172b0` recorded:

- unit suite: **1,880 tests — 1,879 passed, 0 failed, 1 intentional skip**;
- repository-wide `yarn lint:src`: **passed**;
- repository-wide Prettier validation: **passed**;
- `yarn tsc --noEmit --skipLibCheck`: **passed**;
- production unpackaged build: **passed** for the identical application source,
  using
  `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`;
- the build and GUI verification path used the exact low-level MCP checkout at
  SHA `beed66ca6ed2503e6170ee1e1158247f1c2f0140`;
- an isolated HTTPS fixture proved a clean Pull All advance from proof A
  `dd0bbb04b04da50d42fa55245bc89a1426f01488` to proof B
  `1d58935cf4ef9645f08e2fb3aa68e364ab382676`: the redacted sequence was
  primary account rejected, fallback account accepted, and the renderer
  displayed exactly `Pull completed using another signed-in account.`;
- all promoted final milestone captures were inspected at original resolution,
  were nonblank, and contained no private data. The standard ledger is
  **1443×992**; the final responsive proof is the user's exact **1450×997**
  client size.

### Secure clone account fallback validation

The later clone hardening tree at implementation commit
`0b4f25cc8e91eb62634e70f90e24f1a44d00dc9d`, first reviewed on `main` at
`3dc1ecc4d8daff6150980e47a13db4f3a61ec37a`, recorded:

- **627 suites and 1,906 tests: 1,905 passed, 0 failed, 1 intentional skip**;
- full `yarn lint:src`, repository-wide Prettier, and
  `yarn tsc --noEmit --skipLibCheck`: **passed**;
- the exact MCP-driven unpackaged production build: **passed**;
- a synthetic HTTPS smart-Git proof in which account A was rejected and account
  B was accepted silently, producing a clean clone on `main` at
  `c9eee876c4451d380f8cc7628b5971f624f9395f`;
- custom-port exact-origin matching remained intact and no credentials dialog
  appeared; and
- every owned proof process, listener, Temp path, and synthetic credential
  entry was removed after the accepted capture.

| Historical accepted capture | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `material-agent-access.png` | 1443×992 | 110,128 | `644891eaa37c878cb577065822681ee8fd33a018a92e0b89822b43e67393ef93` |
| `material-automation.png` | 1443×992 | 87,304 | `efe45408a390301294d5e23193b619eec858fcef4abb147d82709513c5bb3843` |
| `material-branch-merge-all.png` | 1443×992 | 116,134 | `c5cb41e17d67c627758ef43620c255c8272f85ed182a741c086a80d735c8719e` |
| `material-history-power-tools.png` | 1443×992 | 122,930 | `fe8b6323d77663467b2a6ae887d5e277e31b8dc84f0e35cec2332537ec7fd28a` |
| `material-multi-window-menu.png` | 1443×992 | 115,719 | `9a6cbcbb4c257eac3312b76f8ed0077a6a123901a6bee9b7793b926a61310c66` |
| `material-notification-center.png` | 1443×992 | 111,723 | `f8d0cf33723b1c9793d165ab39fd0cec2ccd41b50136d36f6be9c3d34b7d4709` |
| `material-provider-accounts.png` | 1443×992 | 117,558 | `91ab46ec566676f0c87534f5e72795e31a62adeecf6bf2597e533920ff428cff` |
| `material-scale-200-autofit.png` | 1443×992 | 104,599 | `6fc094a466cef3a540d3bef08db7468e6d9312c9d2242c5abf0df6f9b4fafe05` |
| `material-workspace-changes.png` | 1443×992 | 123,162 | `3155b321f9aabb73ee6a40000c69f8931f1915920216818a362ec974cc3a4621` |
| `material-responsive-overflow-fixed.png` | 1450×997 | 132,049 | `160c622c6630d96eda26b5ff3be6705c31dbe55d6ffa6d1376575425770278bf` |
| `material-actions-job-log.png` | 2048×1228 | 155,579 | `6f8a96a9bff8a9c76f89b44aaf3c84a71574aed11ef994db93d12d2749ca0409` |
| `material-pull-all-account-fallback.png` | 2048×1228 | 114,222 | `80674cf75511c1238bcf527e6e678ffd3d46e4cc36ee2455ebd4b8cecf1c0991` |
| `material-clone-account-fallback.png` | 2048×1228 | 140,143 | `89bb755ad37f6d8537815d411526fa6e16aeee9cd16446deabbc17595cb3623c` |

## Historical root-finalized publication evidence

The M0–M18 publication gate was closed with this evidence:

1. Final implementation baseline `b2699faccb07728fe9aa2838aa13355d71e172b0`
   passed all seven jobs in
   [CI 29225926836](https://github.com/codingmachineedge/desktop-material/actions/runs/29225926836).
2. [Build Installers 29225926808](https://github.com/codingmachineedge/desktop-material/actions/runs/29225926808)
   succeeded for that exact commit and published public, non-draft,
   non-prerelease release
   [`v3.6.3-beta3-b0000000076`](https://github.com/codingmachineedge/desktop-material/releases/tag/v3.6.3-beta3-b0000000076).
   Its lightweight tag resolves exactly to the build SHA; all five uploaded
   assets are non-empty, and the workflow retained zero artifacts. Both full
   NUPKG aliases are 307,547,223 bytes with SHA-256
   `3a4b0bd30668b2480f9820dab62ca7cfa13f2b58e976ce7454c024942029f365`.
3. Pull All proof baseline `3acb0ba0dc69af6f2cfdd5e2967593158eac448d`
   passed
   [Pages run 29227302226](https://github.com/codingmachineedge/desktop-material/actions/runs/29227302226).
   Its Pages and raw-main image URLs both return the tracked 114,222 bytes with
   SHA-256 `80674cf75511c1238bcf527e6e678ffd3d46e4cc36ee2455ebd4b8cecf1c0991`.
4. The canonical six-file `docs/wiki/` mirror is published at wiki commit
   `2d169244373f27a6b08f6c9594ec433ff561880b`; the live Home and User Guide
   return HTTP 200, and the published User Guide embeds the Pull All proof
   through its raw-main URL.
5. The final headless audit verified the exact 1450×997 review size, the
   supported minimum behavior, and requested 200% scaling auto-fit. Toolbar,
   Changes search/filter/composer controls, rows, actions, and the page shell no
   longer clip or produce horizontal overflow. Existing accessibility tests
   cover names, roles, focus, keyboard paths, and 50–200% zoom bounds; recorded
   light/dark contrast pairs meet WCAG AA for normal text.
6. The published design set and the tracked repository pass targeted personal
   identifier and common-secret scans. Account-specific Windows paths use
   `%USERPROFILE%` in public documentation.

The secure clone implementation commit
`0b4f25cc8e91eb62634e70f90e24f1a44d00dc9d` is present in first reviewed
`main` baseline `3dc1ecc4d8daff6150980e47a13db4f3a61ec37a`.

The later guided-function integration intentionally excludes privacy-tainted
feature ancestry. Its named P0/P1/P2/Later corrections and focused regressions
are now present at the M19 checkpoint recorded above. This document does not
reuse historical CI, installer, release, Pages, wiki, or screenshot evidence as
proof for that newer source tree.

## M19 closing evidence checklist

- [ ] Replace the integration checkpoint with the exact final accepted source
  SHA and record exhaustive unit, lint, TypeScript, formatting, diff, privacy,
  and production-build results.
- [ ] Record the deterministic synthetic cross-account clone ledger and exact
  off-screen interaction matrix for representative Foundation/P0/P1/P2/Later
  surfaces.
- [ ] Add only inspected, identity-safe screenshots, with dimensions, byte
  counts, SHA-256 digests, and their exact source/build SHA.
- [ ] Record the merge to `main`, exact-SHA CI, Pages, canonical wiki,
  installer/release, release-asset/digest, and public live-URL evidence.
- [ ] Record cleanup of every owned process, hidden desktop, credential,
  fixture, temporary root, and completed worktree; finish with clean local
  `main` equal to `origin/main`.
