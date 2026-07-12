# Desktop Material — Session Handoff

This document captures the working state and the environment setup needed to
build, run, and verify the app. The full feature plan lives in
[`PLAN.md`](PLAN.md); this file is the "how to pick up where we left off".

## What shipped this session (all on `main`)

| Area | Commit(s) | Notes |
| --- | --- | --- |
| **M0 — Publishing** | `d367c92` | README rewrite, Material Design 3 GitHub Pages site under `site/` (live at https://codingmachineedge.github.io/desktop-material/), wiki sources under `docs/wiki/`, screenshots in `docs/assets/screenshots/`, CI enabled on `main`. |
| **Installer + release** | `52b2abf` (+ `75a28a5`) | `.github/workflows/build-installers.yml` builds the **Windows** installer and publishes a **full GitHub release on every push to `main`** (direct-to-release, no artifacts; macOS dropped). |
| **CI fixes** | `e50a6df` | Formatted a pre-existing Prettier violation (`app/styles/ui/_button.scss`); switched CI off the unavailable `macos-14-xlarge` runner to `macos-14`. |
| **M1 — Per-account profiles** | `9826361` | Each account gets a git repo under `userData/profiles/<sanitized>/` that auto-commits UI-settings changes. Verified: 15 unit tests, built + passed Windows E2E-smoke on CI. |
| **M2 — Repository tabs** | `18b3876`, `007845c` | Browser-style tab strip + per-tab "Tab text style" editor. **Verified headlessly matching the design prototype.** |
| **M3 — Settings history manager** | `4114fa2`, `b89b9ce` | Shared Git-backed history UI, lazy diffs, logical undo/redo, restore-to-point, audit commits, menu/shortcut wiring, tab/settings reconciliation, live screenshot, and published docs. Verified live on an isolated Win32 Headless Desktop. |

Working tree is clean; everything is pushed.

## Published M3 state

- Published M3 content SHA: `b89b9cedb2d232b2ea313f7bc11b7508c1573d54`
  (the later handoff-only update does not alter the shipped app, site, or image).
- Code SHA `4114fa2bb00d8dfc67c84b7ed16d0f506050bb30` passed
  [CI](https://github.com/codingmachineedge/desktop-material/actions/runs/29176909891)
  and [Build Installers](https://github.com/codingmachineedge/desktop-material/actions/runs/29176909881).
- Documentation SHA `b89b9cedb2d232b2ea313f7bc11b7508c1573d54`
  passed [CI](https://github.com/codingmachineedge/desktop-material/actions/runs/29177022962)
  and [Deploy Pages](https://github.com/codingmachineedge/desktop-material/actions/runs/29177022975).
- The [live project site](https://codingmachineedge.github.io/desktop-material/)
  and its Settings history image return HTTP 200. The live PNG is 108,337
  bytes and exactly matches the tracked SHA-256
  `abbcc34aa02949d2144f008c9ed10b4414f721843890643d65d8e0b9360c3da1`.
- [Release `v3.6.3-beta3-build.8`](https://github.com/codingmachineedge/desktop-material/releases/tag/v3.6.3-beta3-build.8)
  is public, non-draft, non-prerelease, cites the exact code SHA, and contains
  three non-empty GitHub-digested assets (NUPKG, EXE, MSI).
- Canonical wiki Markdown and raw-main screenshot embeds are ready under
  `docs/wiki/`. The GitHub wiki git remote is still uninitialized; its first
  public `Home` page must be created once through the web UI after action-time
  confirmation, then all six canonical pages can be pushed normally.

## Critical environment setup

- Use the repository runtime from `.tool-versions` (**Node 24.15.0**). The M3 full
  suite was verified with the bundled Node 24.14 runtime. System Node 26 has an
  unrelated test-runner `localStorage` incompatibility, so it is not the release
  validation runtime.
- `node_modules/electron/dist/electron.exe` is present and the production build
  runs from the repository. If a future install loses native modules on VS 2026,
  refresh the repo-local `node-gyp` from a current global install, then run
  `npm rebuild` and `yarn run postinstall`.
- Do not download dependencies during an unattended capture. The reproducible
  build uses only installed packages.

## How to run and verify the UI without touching the real desktop

Use the exact lowlevel MCP checkout at
`C:\Users\cntow\Documents\GitHub\lowlevel-computer-use-mcp` (verified commit
`beed66ca6ed2503e6170ee1e1158247f1c2f0140`) through its HTTP endpoint
`http://127.0.0.1:8765/mcp`. The repeatable client and safety workflow live in
`.codex/skills/verify-desktop-material-headless/`.

1. Build through MCP `run_command`:
   `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`.
2. Create unique Temp fixture/user-data paths and one uniquely named Win32
   Headless Desktop.
3. Launch `node_modules/electron/dist/electron.exe --disable-gpu out/main.js`
   on that desktop with the isolated paths, then discover the current HWND.
4. Use only HWND-bound background clicks/keys and PrintWindow screenshots. Never
   call `show_headless_desktop`, focus a normal window, or send global input.
5. Inspect the Temp screenshot at original resolution before promoting it, then
   revalidate the exact HWND/PID, close the app and desktop, and remove owned
   Temp paths.

## M3 verification evidence

- Focused M3/regression suite: **56/56 passed**.
- Full unit suite under Node 24.14: **1,519 tests; 1,518 passed, 1 skipped, 0 failed**.
- Standalone popup regression under Node 26: **26/26 passed**.
- `yarn tsc --noEmit --skipLibCheck`: passed.
- Repository-wide `yarn lint`: passed.
- Production unpackaged build through the exact lowlevel MCP server: passed;
  webpack emitted `out/` successfully.
- Live UI smoke: Settings history opened on an isolated Headless Desktop, then
  Undo and Redo were exercised with HWND-bound background clicks.
- Promoted screenshot: `docs/assets/screenshots/settings-history-manager.png`,
  **1443×992**, SHA-256
  `abbcc34aa02949d2144f008c9ed10b4414f721843890643d65d8e0b9360c3da1`.
- `git diff --check` and the changed-file secret scan passed.

## Architecture added (for continuing the plan)

- **Profiles (M1):** `app/src/models/profile.ts`, `app/src/lib/profiles/*`,
  `app/src/lib/stores/profile-store.ts`. Settings writes, tab writes, flushes,
  history reads, and history mutations share one per-profile queue so concurrent
  changes cannot be folded into an undo/redo operation or lost.
- **Tabs (M2):** `app/src/models/repository-tab.ts`,
  `app/src/lib/stores/repository-tabs-store.ts`,
  `app/src/ui/repository-tabs/*`, styles in
  `app/styles/ui/_repository-tabs.scss`. The strip mounts in `app.tsx`
  `renderApp()` above the toolbar; selection→tab is hooked in `index.tsx`.
- **History (M3):** `app/src/ui/version-history/*` is the reusable history UI;
  `app/src/ui/settings-history/*` is its settings wrapper. Profile history APIs
  provide paged commits, selected-file diffs, logical multi-level undo/redo, and
  restore-to-point without rewriting history. Menu, popup, dispatcher, and app
  store wiring make Settings history non-modal. Restores rebind an active tab by
  repository ID/path and refresh active diffs when whitespace settings change.

## Next up (see PLAN.md for detail)

**M4 — broaden non-modal behavior across the remaining dialogs**, using the M3
Settings history side sheet as the reference surface. Then M5 notification
centre → M6 search/regex builder → M7 multi-clone + export/import → M8 UI scaling + orgs
→ M9 automation → M10 Actions panel → M11 MCP server → M12 GHCR manager →
M13–17 desktop-plus parity + self-hosted GitLab. Overarching constraint: the UI
must faithfully match the design prototype. M3 was adapted from
`Desktop Material v2.dc.html` in the supplied
`Material Design UI Recreation.zip`; verify each screen with the headless
pipeline above.

## Gotchas

- Keep settings, tabs, flushes, and history actions on the same profile queue;
  splitting them reintroduces lost updates and corrupt undo/redo semantics.
- Preserve restored-tab reconciliation by both repository ID and normalized path,
  and refresh active diffs after restoring whitespace preferences.
- Keep tokens out of profile repos, exports, and any agent bridge — the
  settings registry is an allowlist by construction.
- `build-installers.yml` cuts a release on every non-docs push to `main`; this
  is intentional (per request) but consumes CI minutes.
- The user commits directly to the repo too (e.g. `PLAN.md`) — pull before large
  local work.
