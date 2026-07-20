# Guided Sparse Checkout — M24 Run Manifest

## Mode and scope

- Mode: `publish`
- Milestone: M24 — guided sparse-checkout selection and review
- Product boundary: Windows x64/arm64 application only
- Requested scope: make the sparse-checkout dialog more guided; preserve the
  existing bounded cone-mode Git operations and cancellation behavior
- Expected branch: `main`
- Remote: `origin`
- Exact accepted application source:
  `255ad0c2283dd3a86328808a373a5438526bdaec`
- Initial baseline: clean `main == origin/main` before this manifest was added

## Expected product state

The production sparse-checkout sheet presents a three-step
Choose/Adjust/Restore, Review selection, and Apply and refresh rail. Guidance
distinguishes empty, invalid, ready, locked-review, running, and settled-result
states. Review freezes and shows the complete bounded normalized selection. A
first enablement reports selected roots; an enabled cone-mode update separately
reports added, removed, and unchanged selection entries without claiming to
predict individual local files. The Apply/result phase remains selected after
success, cancellation, or failure until the user edits or manually refreshes.

## Ordered headless Windows acceptance

1. Revalidate the exact low-level MCP HTTP server, scheduled-task launch
   contract, MCP checkout SHA, project branch, remote, and GitHub account.
2. Build exact source `255ad0c228` through MCP with the required unpackaged
   production command and no dependency download.
3. Create one owned Temp root with a deterministic disposable Git fixture,
   isolated application profile, provider fixture state, capture candidates,
   and cleanup ledger.
4. Create one uniquely named off-screen Win32 desktop, then launch the absolute
   built Electron executable with `--disable-gpu`, an isolated
   `--user-data-dir`, a unique loopback CDP port, and only the fixture as
   `--cli-open`.
5. Resolve the live Desktop Material HWND dynamically and prove a stable,
   nonblank client-only capture before any input.
6. Use the existing capture-only app-native driver to seed the deterministic
   profile, open the sparse-checkout sheet, capture the Choose state, enter
   `docs/`, open its frozen exact review, and capture the Review state. If the
   app-native hook fails, abort rather than touching the visible desktop.
7. Inspect both 1452×1001 light-theme candidates at original resolution for the
   expected rail/review, clipping, overlap, blank pixels, private data, and
   dimensions. Promote only accepted candidates.
8. Close the exact revalidated HWND/PID, close the desktop once, stop owned
   fixtures, and remove only containment-checked owned Temp paths.

## Owned resources and cleanup ledger

- Run id: `m24-sparse-guide-2d74e2b-a2`
- Owned root:
  `%TEMP%\desktop-material-p0-ui-m24-sparse-guide-2d74e2b-a2`
- Fixture: owned root `fixture` child
- Accepted user data: owned root `profile-promote` child
- Accepted capture candidates: owned root `captures\sparse-guide-promote` child
- Headless desktop: `DesktopMaterialSparseM24-2d74e2b-a2`, created once as
  `WinSta0\DesktopMaterialSparseM24-2d74e2b-a2`, handle `980`
- CDP port: `59434`
- Accepted Electron launch PID: `6204`
- Accepted dynamically resolved HWND: `27133064`
- Provider PIDs/port: `13916` and `33244` on loopback port `63440`
- Cleanup proof: complete; see the execution ledger

## Screenshot and documentation allowlist

- `docs/assets/screenshots/material-sparse-checkout.png`
- `docs/assets/screenshots/material-sparse-checkout-safe.png`
- `README.md`
- `docs/features/repository-management/README.md`
- `docs/features/repository-management/sparse-checkout.md`
- `docs/wiki/Feature-Gallery.md`
- `docs/wiki/User-Guide.md`
- `site/index.html`
- `ROADMAP.md`
- `HANDOFF.md`
- `PLAN.md`
- this run manifest

## Declared validation

- sparse-checkout parser, physical Git safety, UI behavior, and static contracts
- TypeScript `--noEmit`, targeted ESLint, Prettier, and `git diff --check`
- 41-test gallery-driver contract
- exact production build through `http://127.0.0.1:8765/mcp`
- stable HWND-targeted pre-input capture and original-resolution candidate
  inspection
- SHA-256 verification after candidate promotion
- final diff, conflict-marker, private-path, and secret scans
- pushed exact-SHA Windows CI, Pages, release/installer, and wiki verification
- final branch/worktree/stash topology proof and clean `main == origin/main`

## Execution ledger

- Fixed MCP `startup_status` passed after the single server finished a separate
  audit build. The scheduled task ran the required fixed venv Python and
  `-m lowlevel_computer_use_mcp.server --http --host 127.0.0.1 --port 8765`
  from the fixed checkout at `ed1427f69b20dcd66df1de2ae3c6ba6591e2e640`.
- MCP `run_command` proved active GitHub account `codingmachineedge`, `main`,
  and the expected `origin` URL with `client_ok: true`, exit 0, and no timeout.
- Guided selection/review landed in `83dbe4c628` and its complete bounded
  review/result behavior in `55a94bb468`. Original-resolution review then
  exposed that the workflow rail scrolled away or covered content; commits
  `9ebae109ba`, `083e4a378d`, and `255ad0c228` refined it into a persistent
  guide region above the scroller with compact-width containment.
- A concurrent audit advanced `origin/main` several times. Every change was
  fetched and inspected. The accepted application source was pushed and proven
  equal to remote `main` before and after its definitive build.
- After the initially clean baseline, 845 deleted image files appeared inside
  the `gemoji` submodule during separate audit activity. M24 never owned,
  staged, discarded, or committed that state. Its final observation is exactly
  845 deletions, no other nested change, and no stash.
- The first required build call failed before compilation because global Yarn
  is absent (`spawn yarn ENOENT`). No dependency was downloaded. The retry uses
  an owned Temp PATH shim that delegates only to repository-pinned
  `vendor/yarn-1.21.1.js` while leaving the required command unchanged.
- The definitive required build of exact source `255ad0c228` returned
  `client_ok: true`, exit code 0, no timeout, and completed in 254.90 seconds.
  Webpack emitted the production main/renderer/crash/highlighter bundles; the
  production builder copied dependencies/static resources, packaged emoji,
  validated SASS variables, and intentionally skipped installer packaging.
- The disposable provider probe passed its API, CORS, Git, pagination,
  artifact, branch-rule, and blocked-push contracts. Only synthetic identities
  and loopback endpoints were used. Production and development credential
  namespaces were deleted and independently read back as absent.
- Two pre-input HWND captures were byte-identical, rendered, and nonblank at
  960×660/89,998 bytes, SHA-256
  `3575af8fe9e8e0221488246f95a18dee4e664577a2555e38fe27d7ad8bc3b2d5`.
- The accepted Choose frame is 1452×1001, 112,506 bytes, SHA-256
  `8ee7149da7eb045bcda347067dcf2d88c32a626829402c97a52df2d60b2a3576`.
  The accepted Review frame is 1452×1001, 125,413 bytes, SHA-256
  `d536c936e1888c5ea7712bb746ec6eac302ae204edd170ab55379455aeda6a5d`.
  Both were inspected at original resolution and promoted byte-for-byte.
- Cleanup is complete. The accepted HWND was revalidated; background close
  failed closed, so only saved PID `6204` was command-line revalidated and
  stopped. The desktop reached zero windows and closed once with `closed:true`;
  provider PIDs `13916`/`33244`, provider port `63440`, CDP port `59434`, both
  credentials, and the containment-checked owned Temp root are absent. The
  visible desktop was never shown or focused.
