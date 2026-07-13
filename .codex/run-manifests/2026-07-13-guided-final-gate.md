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
- Expected UI states:
  1. A bounded shallow repository shows its current shallow state, a reviewed
     deepen operation, successful refresh, and the updated shallow state.
  2. Cone-mode sparse checkout shows validated directories and a safe reviewed
     operation without exposing the disposable fixture path.
  3. Native pull-request creation reaches compose, immutable review, and a
     synthetic success receipt against the loopback GitHub Enterprise fixture;
     it performs no public pull-request mutation.
  4. Actions shows a synthetic run, jobs, readable job log, artifact digest and
     attestation-presence context, a successful authenticated same-endpoint
     artifact download, local SHA-256 result, and reveal-ready destination.
  5. Regular and compact window checks have no clipping, overlap, oversized
     text, black compositor tiles, or document-level horizontal overflow.
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
  2048 x 1228 captures promoted only after original-resolution inspection to
  `docs/assets/screenshots/material-history-deepen.png`,
  `docs/assets/screenshots/material-sparse-checkout-safe.png`,
  `docs/assets/screenshots/material-native-pull-request.png`, and
  `docs/assets/screenshots/material-actions-artifact-download.png`; take an
  additional compact geometry capture under the owned Temp root for layout
  validation without necessarily publishing it.
- Documentation allowlist: this manifest; the four accepted screenshots;
  `README.md`; `PLAN.md`; `HANDOFF.md`; `site/index.html`; and the relevant
  actual image references in `docs/wiki/Home.md` and
  `docs/wiki/User-Guide.md`. The separate GitHub wiki receives the same
  canonical privacy-safe content and images only after `main` is final.
- Tests: focused clone/Pull All/PR/Actions/runner/file-history/sparse/shallow/UI
  suites; full unit corpus; `yarn lint:src`; repository-wide `yarn prettier`;
  `yarn tsc --noEmit --skipLibCheck`; `git diff --check`; conflict-marker,
  secret, signed-URL, email, personal-name, and local-path scans; reproducible
  MCP production build; deterministic off-screen interactions; original-image
  inspection and hashes; final remote/CI/Pages/release/wiki verification.
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

