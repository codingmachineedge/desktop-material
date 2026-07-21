# Desktop Material API functions buttons run manifest

- Mode: `publish`
- Milestone: make the GitHub API rail item hideable, expose saved API functions as reusable action buttons in Repository tools, and keep the catalog/manual request builder behind an explicit advanced action
- Expected UI state: the API rail item can be hidden per repository and restored from Repository tools; Repository tools contains an API functions entry whose saved definitions run as buttons and route mutations through review; the API Explorer defaults to saved functions with the operation catalog/manual builder collapsed behind `Advanced request builder`
- Ordered background interactions: inspect existing API Explorer/function registry and Repository tools hub; implement persisted per-repository visibility, reusable function-button surface, focused tests and responsive styles; run the exact no-download build and focused checks; if the fixed headless MCP/build gate succeeds, exercise and inspect the hidden/restored/API-function states on an off-screen desktop; commit this branch, push it, merge to `main`, push `origin/main`, and clean only safely merged task state
- Disposable fixture path: unique owned `%TEMP%\\desktop-material-api-functions-20260720-*` root only if headless verification reaches the GUI phase
- Screenshot target/theme/dimensions: no screenshot promotion unless the rebuilt app passes the exact headless gate; if accepted, capture the Repository tools API functions surface in dark theme at the supported minimum window
- Documentation allowlist: this manifest; implementation and focused tests under `app/src`, `app/styles`, and `app/test`; relevant `README.md`, `ROADMAP.md`, `HANDOFF.md`, and categorized docs under `docs/wiki/`
- Tests: API Explorer/function-button component tests, repository-section/visibility tests, responsive style contracts, TypeScript, Prettier, `git diff --check`, secret scan, exact unpackaged production build, and headless interaction if available
- Remote: `origin` (`https://github.com/codingmachineedge/desktop-material.git`)
- Expected branch: `codex/api-functions-buttons-20260720`, based on `main`; push without force, then merge to `main`
- Active GitHub account: `codingmachineedge`
- Initial dirty-state baseline: `main` was clean except for the pre-existing modified `gemoji` submodule; the separate `codex/ui-design-audit-20260720` worktree was preserved
- Publication authorization: the user explicitly requested a worktree, push, and merge to `main`
- Cleanup ledger: before any GUI phase, record the run id, owned paths, headless desktop name, create state, launch PID, and runtime-resolved HWND; pair each created resource with finally-path cleanup

## Verification outcome

- Exact MCP endpoint preflight passed with `startup_status.ok=true`; the
  scheduled task resolved to the fixed lowlevel checkout and port `8765`, and
  the live MCP checkout SHA was `ed1427f69b20dcd66df1de2ae3c6ba6591e2e640`.
- Focused dependency-free checks passed: responsive API Explorer styles,
  per-repository API-tab visibility persistence, and repository section
  navigation. Prettier and `git diff --check` passed for the implementation,
  tests, documentation, and manifest.
- The React function-button test could not load because the shared checkout
  dependency tree has no `react` package.
- The exact no-download production build first failed because global `yarn`
  was absent. A retry through a temporary PATH shim invoking the pinned
  `vendor/yarn-1.21.1.js` reached compilation but failed on the pre-existing
  incomplete dependency tree (`registry-js`, `keytar`, `dugite`, and other
  packages were missing). No dependency was downloaded.
- No headless desktop, fixture, app launch, credential, or screenshot was
  created because the build prerequisite failed. The visible desktop was never
  shown, focused, resized, or used for input.
