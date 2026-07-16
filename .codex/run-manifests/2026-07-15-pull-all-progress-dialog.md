# Pull All progress dialog milestone

- Mode: `publish`
- Run ID: `desktop-material-pull-all-progress-019f68ca`
- Milestone: detailed Pull All progress dialog and documentation cleanup
- Project: `%USERPROFILE%\Documents\GitHub\desktop-material`
- Remote/branch: `origin` / `main`
- Expected UI state: Pull All shows a non-modal, repository-by-repository progress surface with totals, current operation, result state, and safe recovery context. Dismissing to the background preserves one in-flight session; reopening rejoins it instead of starting a duplicate pull.
- Background interactions: launch the exact built app on an isolated headless Win32 desktop; open a disposable repository fixture; open Repositories; start Pull All; capture the progress surface and completed result state.
- Disposable fixture: unique owned `%TEMP%` run root containing synthetic repository names and loopback-only Git responses; no real provider data or credentials.
- Owned run root: `%TEMP%\desktop-material-pull-all-progress-019f68ca`; fixture repositories under `fixture\`, isolated app data under `user-data\`, captures under `captures\`, and cleanup record at `cleanup-ledger.json`.
- Headless desktop: `DesktopMaterialPullAll019f68ca` (create exactly once, never show or switch to it).
- Screenshot targets: `docs/assets/screenshots/material-pull-all-progress.png` and any required updated README/wiki/Pages references; inspect original dimensions, clipping, blank pixels, and privacy safety before promotion.
- Screenshot presentation: light Material theme, final 1440×960 client capture plus a compact-width validation capture retained under the owned run root.
- Documentation allowlist: `README.md`, `PLAN.md`, `HANDOFF.md`, `docs/wiki/Home.md`, `docs/wiki/User-Guide.md`, `site/index.html`, `docs/README.md`, `docs/process/roadmap.md`, and the screenshot target.
- Focused tests: Pull All concurrency/progress tests; real React interaction coverage for live status, background dismiss/reopen, final summary, errors, and stale listeners; TypeScript; lint/Prettier; and the required headless accessibility/clipping check.
- Cleanup ledger: record the run root, desktop name, launch PID, resolved HWND, and cleanup results in the final handoff update.
