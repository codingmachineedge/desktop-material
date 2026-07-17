# API catalog, clone recovery, and crash containment publication manifest

- Mode: `publish`
- Milestone: product-complete REST/GraphQL root discovery, staged clone recovery with active pause/cancel, and renderer/main/elevated-process crash containment
- Date: 2026-07-17 (America/Toronto)
- Expected branch: `main`
- Expected remote: `origin` (`codingmachineedge/desktop-material`)
- Authorization: the user explicitly requested that every milestone be pushed and screenshot as work progresses.

## Expected UI state

1. A disposable repository is the only repository opened in the isolated app profile.
2. Repository Tools > GitHub API Explorer identifies the selected account's product catalog, exposes REST and GraphQL operation search/kind filtering, and renders exact pinned product provenance without navigating the renderer away from the app.
3. Clone Repository > batch clone displays a deterministic paused/recoverable queue; focused process-ownership tests separately prove pause/cancel waits for the active Git child before the terminal transition.
4. All proof surfaces remain vertically scrollable and have no document-width overflow at the declared viewport sizes.
5. A contained UI failure renders a bounded recovery card or non-fatal notice without exposing the original error message; fatal renderer setup failures follow the one-shot crash recovery path.

## Ordered hidden interactions

1. Preflight the fixed low-level MCP server, scheduled task command, and MCP checkout SHA.
2. Run the exact unpackaged production build through MCP `run_command`.
3. Create a unique owned `%TEMP%\desktop-material-p0-ui-*` run root containing a disposable Git repository, isolated Electron user-data directory, cleanup ledger, and screenshot staging directory.
4. Create one unique off-screen Win32 desktop and launch the exact built Electron binary with `--disable-gpu`, isolated `--user-data-dir`, and only the disposable repository in `--cli-open`.
5. Resolve the current HWND dynamically and capture a stable nonblank client-only frame.
6. Exercise the API catalog/search/provenance surface at 960×660 and the short/zoom-responsive layout at 640×480 or its equivalent CSS viewport; capture after each meaningful state.
7. Seed a credential-free v2 paused clone journal under the owned Temp root, inspect the recoverable queue in every responsive scenario, and capture it; use focused abort/close tests—not a synthetic GUI claim—as the process-termination receipt.
8. Run the existing responsive surface catalog across its eight viewport/zoom scenarios and record every registered page/surface result independently.
9. Inspect original-resolution captures for blank pixels, clipping, bottom reachability, private data, dimensions, and theme before promotion.
10. Gracefully close the revalidated HWND, use exact saved-PID termination only if required, close the owned desktop exactly once, and remove only containment-checked paths beneath the owned Temp run root.

## Screenshot targets

- Theme: light Material theme, with deterministic fixture-only identities.
- API target: `docs/assets/screenshots/material-api-product-catalog.png` at a client size of at least 960×660.
- Clone target: `docs/assets/screenshots/material-clone-active-recovery.png` at a client size of at least 960×660.
- Responsive evidence: unique Temp captures plus the tracked responsive matrix; only visually accepted documentation captures are promoted.

## Disposable paths and cleanup ledger

- Run root: a newly generated canonical `%TEMP%\desktop-material-p0-ui-*` directory; the exact resolved path will be recorded before creation.
- Fixture repository, isolated user data, screenshot staging, desktop name, launch PID, provider/helper PIDs, ports, HWND, and creation/close state will be recorded in the run ledger.
- No generic process-name termination, visible desktop switching, global input, or non-owned cleanup is permitted.

## Documentation allowlist

- `README.md`
- `site/index.html`
- `docs/wiki/Feature-Gallery.md`
- `docs/wiki/User-Guide.md`
- `docs/wiki/Developer-Guide.md`
- `docs/wiki/Agent-API.md`
- `docs/assets/screenshots/material-api-product-catalog.png`
- `docs/assets/screenshots/material-clone-active-recovery.png`
- `docs/verification/api-clone-crash-recovery-2026-07-17.json`
- `docs/verification/api-clone-crash-recovery-2026-07-17.md`
- `HANDOFF.md`
- this manifest

Implementation, generated catalogs, tests, and directly related styles are also in publication scope; unrelated files are excluded.

## Declared verification

- Focused REST/GraphQL generator, catalog, Explorer, and named-function tests.
- Focused clone fallback, Git abort, staging, journal, recovery, pause/cancel, and renderer shutdown tests.
- Focused renderer boundary/failure, crash recovery/window, IPC, shell, ordered web request, elevated runner, account persistence, and database migration tests.
- Full `npx --no-install tsc --noEmit --pretty false`.
- Repository-aware ESLint over every changed TypeScript/TSX/JS file.
- Prettier check over every changed supported source/data file and `git diff --check`.
- Exact MCP production build command:
  `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`
- Full unit suite after focused verification.
- Responsive surface matrix at all eight catalogued viewport/zoom scenarios.

## Publication and remote proof

- Reject unexpected remote divergence before staging.
- Inspect the full diff, staged diff, generated artifact hashes, and a secret-pattern scan.
- Commit the complete scoped milestone on `main`, push `origin/main` without force, and prove local/tracking/direct-remote SHA equality.
- Verify applicable CI, installer, and Pages runs for the exact pushed SHA; verify the live Pages references and promoted screenshot bytes/hashes when deployment completes.
- Audit all local/remote branches, worktrees, and stashes; preserve unrelated work and remove only fully integrated temporary state.

## Preflight receipt

- Fixed MCP `startup_status`: `ok=true`, task `LowLevelComputerUseMCP`, state `Running`, run level `Limited`.
- Scheduled task action, queried through MCP `run_command`: `C:\Users\Administrator\Documents\GitHub\lowlevel-computer-use-mcp\.venv\Scripts\python.exe -m lowlevel_computer_use_mcp.server --http --host 127.0.0.1 --port 8765`, working directory `C:\Users\Administrator\Documents\GitHub\lowlevel-computer-use-mcp`.
- MCP checkout, queried through MCP `run_command`: `8d6940be6a5f6e7c37de3f73acd2259fa7651efe`.
- Every preflight response returned `client_ok=true`; command responses returned `returncode=0` and `timed_out=false`.
- Publication checkout at preflight: `main` at `05d0dc295238b833a70b197bceb54e0ccc210398`; tracking and direct `origin/main` matched exactly; authenticated GitHub account `codingmachineedge` over HTTPS.
- Preserved parallel work: dirty linked worktree `.claude/worktrees/handoff-md-implementation-3b529c` on `claude/handoff-md-implementation-3b529c`, also based at `05d0dc295238b833a70b197bceb54e0ccc210398`, contains separate Docker/pull-theme/repository-font work and is excluded from this milestone until it is complete and safely integrated.
