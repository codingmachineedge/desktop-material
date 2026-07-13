# Desktop Material — Final Handoff

## Outcome

The requested roadmap is implemented: **M0 through M18 are complete and
shipped on `main`** through the pre-documentation integration SHA
`4da59bd38308fff45b48f09819d08cbc356ee946`. The implementation work, merge
fixes, full local validation, production build, and final headless screenshots
are complete. There is no remaining queued or in-flight feature work in
[`PLAN.md`](PLAN.md).

This file deliberately does **not** claim that the final documentation merge is
already public. After these two closing documents are merged, the root
integrator must verify the resulting `main` SHA, applicable CI and Pages runs,
README/site assets, canonical wiki publication, and the final
accessibility/clipping gate. That post-merge evidence belongs in the root's
final response.

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
  `app/src/ui/actions/`, `app/src/lib/agent-commands.ts`,
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
- all final promoted captures were visually inspected at original resolution,
  nonblank, private-data-free, and exactly **1443×992**.

### Final headless capture ledger

| Screenshot | Bytes | SHA-256 |
| --- | ---: | --- |
| `docs/assets/screenshots/material-agent-access.png` | 110,128 | `644891eaa37c878cb577065822681ee8fd33a018a92e0b89822b43e67393ef93` |
| `docs/assets/screenshots/material-automation.png` | 87,304 | `efe45408a390301294d5e23193b619eec858fcef4abb147d82709513c5bb3843` |
| `docs/assets/screenshots/material-branch-merge-all.png` | 116,134 | `c5cb41e17d67c627758ef43620c255c8272f85ed182a741c086a80d735c8719e` |
| `docs/assets/screenshots/material-history-power-tools.png` | 127,723 | `2df21a9a1f5cb9f39b541a5678583d5c314d4254e12a615f9369b462af92d797` |
| `docs/assets/screenshots/material-multi-window-menu.png` | 115,719 | `9a6cbcbb4c257eac3312b76f8ed0077a6a123901a6bee9b7793b926a61310c66` |
| `docs/assets/screenshots/material-notification-center.png` | 111,723 | `f8d0cf33723b1c9793d165ab39fd0cec2ccd41b50136d36f6be9c3d34b7d4709` |
| `docs/assets/screenshots/material-provider-accounts.png` | 117,558 | `91ab46ec566676f0c87534f5e72795e31a62adeecf6bf2597e533920ff428cff` |
| `docs/assets/screenshots/material-workspace-changes.png` | 123,162 | `3155b321f9aabb73ee6a40000c69f8931f1915920216818a362ec974cc3a4621` |

Earlier verified captures, including
`docs/assets/screenshots/settings-history-manager.png`, remain tracked; that M3
image is also 1443×992 and has SHA-256
`abbcc34aa02949d2144f008c9ed10b4414f721843890643d65d8e0b9360c3da1`.

## Headless verification environment

- Project: `C:\Users\cntow\Documents\GitHub\desktop-material`
- MCP checkout: `C:\Users\cntow\Documents\GitHub\lowlevel-computer-use-mcp`
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

Until root completes that gate, the correct status is: **all implementation
milestones and local/headless verification are complete; final public
verification for the documentation merge is pending root finalization**.

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
