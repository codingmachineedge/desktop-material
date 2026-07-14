# Desktop Material Git and GitHub CLI parity run manifest

- Mode: `publish`
- Milestone: audit the complete installed `git` and `gh` command surfaces, add useful missing interactive Desktop Material capabilities, remove clipping/overlap/oversized-text defects, refresh documentation and screenshot evidence, and publish each completed increment
- Expected UI state: every newly supported Git/GitHub workflow is reachable through native interactive controls; affected views remain legible without clipping, overlap, or oversized text at the verified window sizes and themes
- Ordered background interactions: inventory installed CLI surfaces and existing app coverage; preflight the exact low-level MCP endpoint; implement and test independent increments; run the reproducible unpackaged build; create a deterministic disposable Git fixture and isolated user-data directory; create one off-screen Win32 desktop; launch built Electron; resolve HWND at runtime; capture before input; exercise only HWND-targeted controls; recapture after meaningful actions and resizing; inspect original pixels; close by revalidated HWND; close the headless desktop; publish verified documentation and code increments
- Disposable fixture path: unique owned `%TEMP%\\desktop-material-git-gh-audit-20260712-*` run root, created only after MCP preflight and the first successful build
- Screenshot target/theme/dimensions: milestone-specific PNG files under `docs/assets/screenshots/`; capture both relevant light/dark states and compact/regular window dimensions where the affected surface supports them; promote only visually accepted, nonblank, private-data-free captures
- Documentation allowlist: this manifest, `README.md`, `HANDOFF.md`, relevant `docs/wiki/*.md`, relevant Pages sources under `site/`, screenshot assets under `docs/assets/screenshots/`, and implementation/test files required by the audited capabilities
- Tests: focused unit/component/integration tests per increment; lint; typecheck; reproducible unpackaged production build; off-screen interaction smoke tests; original-resolution screenshot inspection; Git diff review; secret scan
- Remote: `origin` (`https://github.com/codingmachineedge/desktop-material.git`)
- Expected branch: `mega-feature-update`, tracking `origin/mega-feature-update`; push without force after each completed increment
- Active GitHub account: `codingmachineedge`
- Initial dirty-state baseline: clean at `74b30ce17ce04c040042623f9e2bea7b89368889`
- Publication authorization: explicit user request to have the primary agent and all subagents commit and push continuously
- Cleanup ledger: record run id, owned paths, headless desktop name, creation state, launch PID, and resolved HWND before each GUI phase; remove only resolved paths beneath the owned run root
