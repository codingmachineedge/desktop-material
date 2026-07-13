# Desktop Material File History and Blame run manifest

- Mode: `publish`
- Milestone: add a bounded, native, Git-backed File History and Blame workflow with rename following, guarded file selection, responsive accessible UI, focused tests, and off-screen verification
- Expected UI state: a tracked repository file exposes File History from an existing contextual surface; the history view lists bounded commits and lets the user inspect bounded line-blame metadata without horizontal page/dialog scrolling; long paths, authors, and subjects wrap or ellipsize; metadata cards stack at compact widths; only the source-code pane may scroll horizontally; controls remain reachable at short heights and high zoom
- Ordered background interactions: audit existing Git helpers, file context menus, popup/dialog plumbing, diff/history components, styles, and test patterns; implement dependency-free parsers and bounded Git helpers; add an interactive entry point and responsive dialog; run focused tests and style-contract tests; preflight the exact low-level MCP endpoint; run the reproducible unpackaged build without dependency downloads; create an isolated temporary Git fixture and user-data directory only if the MCP/build gate succeeds; launch and exercise Electron solely on an off-screen Win32 desktop; capture and inspect evidence only after successful interaction; clean up only owned temporary state; inspect diffs; scan for secrets; commit and push coherent increments; verify remote SHA
- Disposable fixture path: unique owned `%TEMP%\\desktop-material-file-history-blame-20260712-*` run root, created only after MCP preflight and a successful build
- Screenshot target/theme/dimensions: if the exact headless gate succeeds, capture regular and compact dark-theme File History/Blame states at milestone-specific PNG paths under `docs/assets/screenshots/`; do not promote or claim screenshots if the fixed MCP environment is unavailable
- Documentation allowlist: this manifest; implementation and focused tests under `app/src`, `app/styles`, and `app/test`; only on successful screenshot promotion, the corresponding screenshot assets plus narrowly-scoped README, wiki, Pages, and HANDOFF references
- Tests: dependency-free parser/helper unit tests; UI/style contract tests; focused lint/typecheck where available; reproducible unpackaged production build through the exact MCP `run_command`; off-screen interaction/no-overflow geometry checks only after successful preflight/build; full diff review; secret scan
- Remote: `origin` (`https://github.com/codingmachineedge/desktop-material.git`)
- Expected branch: `codex/file-history-blame`, based on and initially tracking `origin/mega-feature-update`; push without force
- Active GitHub account: `codingmachineedge`
- Initial dirty-state baseline: clean at `0460351fa372dd37d1476e8afd9f32ce28da1e9a`
- Publication authorization: the user explicitly requested continuous commits and pushes from all agents
- Cleanup ledger: before any GUI phase, record the run id, resolved owned paths, headless desktop name, create state, launch PID, and runtime-resolved HWND; pair each created resource with finally-path cleanup
- Scope exclusions: do not edit CLI Workbench, GitHub API Workbench, or their tests; avoid `app/src/ui/repository.tsx`; do not add an endpoint/command search list as a substitute for the native workflow

## Verification outcome

- Exact MCP endpoint preflight: passed with `startup_status.ok=true`; the installed task is running as `LowLevelComputerUseMCP`
- Runtime task action: `%USERPROFILE%\Documents\GitHub\lowlevel-computer-use-mcp\.venv\Scripts\python.exe -m lowlevel_computer_use_mcp.server --http --host 127.0.0.1 --port 8765`, working directory `%USERPROFILE%\Documents\GitHub\lowlevel-computer-use-mcp`
- MCP checkout SHA: `806d9ba85e4afbc2af58d7499496babfa7c68891`
- Reproducible build gate: blocked before compilation because the MCP service environment has no installed `yarn` command; the required no-download command returned `spawn yarn ENOENT`
- GUI/evidence cleanup ledger: no fixture, user-data path, headless desktop, Electron process, HWND, or screenshot was created because the build prerequisite failed
- Focused checks: dependency-free parser and UI/style contract tests passed; TypeScript `--noEmit`, Prettier, and diff checks passed
- Existing environment limitation: the Git fixture integration suite cannot initialize because the pre-existing dependency tree lacks `keytar.node`; no dependency was downloaded or rebuilt
