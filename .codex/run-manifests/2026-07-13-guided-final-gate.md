# Desktop Material guided-function final gate manifest

- Mode: `publish`
- Milestone: finish and publish the privacy-safe guided-function integration,
  including cross-account clone/Pull All fallback, native pull-request creation,
  safe Actions artifact and job-log transfer, shallow-history deepening,
  sparse-checkout administration, file-history path containment, and the closed
  guided Git runner.
- Expected branch: `codex/guided-final-gate` for integration and evidence, then
  `main` only after every declared gate passes.
- Remote: `origin` = `https://github.com/codingmachineedge/desktop-material.git`
- Initial baseline: preserve the clean tracked state at the final integration
  SHA. No personal worktree path, account credential, signed URL, or provider
  response body may enter a capture or tracked file.
- Preflight evidence (2026-07-13): the fixed HTTP MCP endpoint returned
  `ok: true`; scheduled task `LowLevelComputerUseMCP` runs the `uv` launcher
  from `%USERPROFILE%\AppData\Local\Microsoft\WinGet\Links` with
  `run --directory %USERPROFILE%\Documents\GitHub\lowlevel-computer-use-mcp
  lowlevel-computer-use-mcp --http --host 127.0.0.1 --port 8765`; that checkout
  is `beed66ca6ed2503e6170ee1e1158247f1c2f0140`; the active GitHub identity is
  `codingmachineedge`; Actions is enabled with all actions allowed and no
  queued or active worker. The exact accepted code/test source for the GUI
  phase is clean, remote-exact
  `32b7bb6b955f1b1a58388e12aea5d54810148d4f`: all 363 unit files passed in
  two Windows-safe batches, script tests passed 15/15, application and script
  TypeScript passed, repository-wide Prettier and ESLint passed, diff/conflict
  and personal-data scans passed, and high-confidence secret matches are zero.
  The required MCP production build returned `client_ok: true`, return code
  `0`, and `timed_out: false` after rebuilding the production bundles, bundled
  Git helpers, Sass validation, licenses, and unpackaged `out` tree.
- Expected UI states:
  1. The URL clone form shows bounded shallow-clone controls and completes a
     synthetic exact-origin clone without exposing its disposable path.
  2. A bounded shallow repository shows its current shallow state, a reviewed
     deepen operation, successful refresh, and the updated shallow state.
  3. Cone-mode sparse checkout shows validated directories and a safe reviewed
     operation without exposing the disposable fixture path.
  4. Native pull-request creation reaches compose, immutable review, and a
     synthetic success receipt against the loopback GitHub Enterprise fixture;
     it performs no public pull-request mutation.
  5. Actions shows a synthetic run, jobs, readable job log, artifact digest and
     attestation-presence context, a successful authenticated same-endpoint
     artifact download, local SHA-256 result, and reveal-ready destination.
  6. Pull All shows one successful repository result whose detail says another
     signed-in account completed the pull; the fixture ledger records account A
     rejected before account B and never records a token.
  7. GitHub Releases shows bounded release and asset creation/update/deletion
     controls against the in-memory loopback fixture only.
  8. GitHub Issues shows bounded search, compose, metadata, comment, close, and
     reopen state; provider triage shows exact-origin GitHub/GitLab/Bitbucket
     parsing without a public mutation.
  9. Repository Tools shows shallow/deepen, sparse checkout, patch series,
     structured commit rewrite, bisect, signing, LFS, worktree, branch
     visibility, merge-tree preview, bundle, and hooks surfaces using only the
     disposable repository.
  10. The repository-wide Stash Manager and Repository Settings Remote Manager
      show their complete bounded review surfaces without exposing the owned
      Temp root.
  11. Regular and compact window checks cover light and dark themes; requested
     50%, 100%, and 200% UI scaling with auto-fit; long synthetic repository,
     branch, and host labels; destructive-confirmation focus; keyboard paths;
     and screen-reader names and roles. They have no clipping, overlap,
     oversized text, black compositor tiles, or document-level horizontal
     overflow.
- Ordered background interactions: verify the exact low-level MCP server,
  scheduled-task command, and MCP checkout SHA; run the required unpackaged
  production build through MCP; create one owned Temp run root, deterministic
  Git/bare-remote fixture, loopback synthetic GitHub API, isolated user-data,
  synthetic keychain entry, capture directory, and cleanup ledger; create one
  uniquely named off-screen Win32 desktop; launch the exact built Electron PID;
  resolve its HWND at runtime; take a stable client-only pre-input capture; use
  only HWND-targeted input and captures, falling back to the documented local
  Playwright/CDP app hook only if Chromium rejects background input; recapture
  after each meaningful state; inspect accepted PNGs at original resolution;
  close the exact app HWND/PID; close the desktop exactly once; delete the exact
  synthetic keychain entry, stop the exact loopback listener, and remove only
  resolved owned paths beneath the run root.
- Disposable fixture path: unique owned
  `%TEMP%\desktop-material-guided-final-20260713-*`; screenshot-visible labels
  use only `guided-proof`, `octo-proof`, `material-proof`, and public repository
  names.
- Screenshot target, theme, and dimensions: light Material theme, regular
  2048 x 1228 client-area captures promoted only after original-resolution
  inspection to `docs/assets/screenshots/material-clone-account-fallback.png`,
  `docs/assets/screenshots/material-pull-all-account-fallback.png`,
  `docs/assets/screenshots/material-shallow-clone-safe.png`,
  `docs/assets/screenshots/material-history-deepen.png`,
  `docs/assets/screenshots/material-sparse-checkout-safe.png`,
  `docs/assets/screenshots/material-native-pull-request.png`,
  `docs/assets/screenshots/material-actions-job-log.png`,
  `docs/assets/screenshots/material-actions-artifact-download.png`,
  `docs/assets/screenshots/material-github-releases.png`,
  `docs/assets/screenshots/material-github-issues.png`,
  `docs/assets/screenshots/material-provider-triage.png`,
  `docs/assets/screenshots/material-repository-tools.png`,
  `docs/assets/screenshots/material-stash-manager.png`, and
  `docs/assets/screenshots/material-remote-manager.png`; retain compact,
  dark-theme, and scaling-matrix captures under the owned Temp root for
  validation without necessarily publishing them.
- Documentation allowlist: this manifest; the fourteen accepted screenshots;
  `README.md`; `PLAN.md`; `HANDOFF.md`; `site/index.html`; and the relevant
  actual image references in `docs/wiki/Home.md`, `docs/wiki/User-Guide.md`,
  and `docs/wiki/Developer-Guide.md`. The separate GitHub wiki receives the
  same canonical privacy-safe content and images only after `main` is final.
- Tests: focused clone/Pull All/PR/Actions/runner/file-history/sparse/shallow/UI,
  accessibility, focus, scaling, theme, and responsive suites; full unit corpus;
  `yarn lint:src`; repository-wide `yarn prettier`; `yarn tsc --noEmit
  --skipLibCheck`; `git diff --check`; conflict-marker, secret, signed-URL,
  email, personal-name, and local-path scans; reproducible MCP production build;
  deterministic off-screen interactions; original-image inspection and hashes;
  final remote/CI/Pages/release/wiki verification.
- Publish gate: reject remote divergence; commit and push coherent checkpoints
  without force; land only reviewed privacy-safe ancestry on `main`; require
  all applicable workflow jobs to finish successfully; require the public
  non-draft/non-prerelease installer release and its expected nonempty assets;
  delete transient Actions artifacts and verify zero remain.
- Cleanup ledger: record the run id, resolved owned paths, synthetic keychain
  service/login, listener PID/port, desktop name, desktop create state, exact
  Electron launch PID, and runtime-resolved HWND before the GUI phase. Pair each
  created resource with one finally-path cleanup and record the verified-absent
  result here after the run.
