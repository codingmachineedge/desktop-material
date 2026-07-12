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
| **M3 — Settings history manager** | `4114fa2`, `b89b9ce`, wiki `c818fd5` | Shared Git-backed history UI, lazy diffs, logical undo/redo, restore-to-point, audit commits, menu/shortcut wiring, tab/settings reconciliation, live screenshot, and published README/Pages/wiki docs. Verified live on an isolated Win32 Headless Desktop. |
| **M4 — Non-modal dialogs** | `690ea60a`, `e9cf5b3d` | Non-modal floating dialog framework: drag-by-header, bring-to-front, cascade, pointer-events-none layer so the app stays interactive behind open dialogs. Preferences rebuilt as the MD3 940×660 dialog (left rail + Active chip + pill footer). Verified live headless: the app is interactive behind open dialogs. |
| **M18 — MD3 shell visual clone** | 17 commits `…`→`80be0f6e` | Full visual clone of the design prototype: MD3 color/motion/shape tokens + 16 keyframes; app-bar branding + pill inline menu; floating pill toolbar with repo/branch chips + a sync pill with an ahead badge; left icon navigation rail (Changes badge/History/Branches/Settings/avatar); floating radius-24 workspace cards; full MD3 workspace surfaces (tri-state checkboxes, tonal status chips, token diff colors, inverse-surface undo banner, redesigned welcome flow + blank slate); repository & branch left side sheets; clone dialog restyle + tab-style popover. Verified live headless. |

Working tree is clean; everything is pushed. The visual-clone wave landed at `80be0f6e02`
(shell + M4). Remaining M18 scope is pixel-polish follow-ups.

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
- The [GitHub wiki](https://github.com/codingmachineedge/desktop-material/wiki)
  is initialized and all six canonical pages are published at wiki commit
  `c818fd5b6859a12ed297fe93334bd5a434fe9cc8`. Live `Home` and `User Guide`
  return HTTP 200, contain the M3 Settings History content, and render the exact
  raw-main screenshot URL.

## Published state after the visual clone (M18 shell + M4)

- The MD3 shell + M4 code shipped through `80be0f6e02`.
- A docs-accuracy pass then rewrote **README**, the **`site/`** Pages source, and the wiki
  **Home** and **User Guide** to split **Shipped today** (multi-account M1, repo tabs M2, settings
  history M3, non-modal dialogs M4, the full MD3 shell) from **On the roadmap** (notification centre,
  regex builder, multi-clone, automation, Actions panel, MCP server, gitignore manager, Build & Run,
  org support, UI scaling, GitLab/Bitbucket, desktop-plus parity). This corrects earlier docs that
  described notification centre, automation, and regex search as if shipped.
- New hero + gallery screenshots are tracked under `docs/assets/screenshots/`
  (`material-workspace-changes.png` is the hero). The wiki pages reference them via raw-main URLs.
- The Automation, Regex Guide, and Agent API wiki pages remain as roadmap design docs and are now
  labelled **Planned** on the wiki Home page.

## Critical environment setup

- Use the repository runtime from `.tool-versions` (**Node 24.15.0**). The M3 full
  suite was verified with the bundled Node 24.14 runtime. System Node 26 exposes an
  experimental global `localStorage` that collides with the test runner; run the unit
  suite with **`node --no-experimental-webstorage`** (the test-runner flag that
  disables that global) to run green on Node 26. Node 24.15.0 remains the release
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

## Visual clone + M4 verification evidence (at `80be0f6e02`)

- Full unit suite: **1,521 tests; 1,520 passed, 1 skipped, 0 failed** (run under Node with
  `--no-experimental-webstorage`; see the environment note above).
- Production unpackaged build through the exact lowlevel MCP server: passed; webpack emitted `out/`.
- Live UI smoke on an isolated Win32 Headless Desktop, driven only by HWND-bound background input:
  - The **MD3 shell** renders — icon navigation rail, floating pill toolbar with repo/branch chips
    and the sync pill, repository tabs, and the floating Changes card.
  - The **repository and branch side sheets** open and list their content.
  - **Preferences** opens as the MD3 940×660 dialog with the left rail, Active chip, and pill footer.
  - **Non-modal interactivity confirmed**: with a dialog open, the app behind it still responds to
    input (the pointer-events-none dialog layer works as designed).
- Promoted screenshots (all fresh, verified): `material-workspace-changes.png` (hero),
  `material-history.png`, `material-welcome.png`, `material-settings.png`,
  `material-repositories-sheet.png`, `material-branches-sheet.png`.

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

The MD3 shell visual clone and **M4 non-modal dialogs** are done. The immediate queue is:

1. **Gitignore manager** — per-repo `.gitignore` editing with template auto-suggest.
2. **Unhide flag-gated features** — flip safe `feature-flag.ts` gates on for production and port
   unshipped upstream branch work (see `hidden-features-audit.md` in the session workflow dir).
3. **One-click Build & Run** — detect the project, install dependencies, and run it in one action.
4. Then the planned milestones: **M5** notification centre → **M6** search/regex builder →
   **M7** multi-clone + export/import → **M8** UI scaling + orgs → **M9** automation →
   **M10** Actions panel → **M11** MCP server → **M12–M17** desktop-plus parity + self-hosted GitLab.

Overarching constraint: the UI must faithfully match the design prototype. M3 was adapted from
`Desktop Material v2.dc.html` in the supplied `Material Design UI Recreation.zip`; verify each
screen with the headless pipeline above. The screenshot/verify scripts live in the session
workflow dir.

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
