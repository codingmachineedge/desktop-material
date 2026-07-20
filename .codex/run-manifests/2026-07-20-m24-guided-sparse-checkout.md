# Guided Sparse Checkout — M24 Run Manifest

## Mode and scope

- Mode: `publish`
- Milestone: M24 — guided sparse-checkout selection and review
- Product boundary: Windows x64/arm64 application only
- Requested scope: make the sparse-checkout dialog more guided; preserve the
  existing bounded cone-mode Git operations and cancellation behavior
- Expected branch: `main`
- Remote: `origin`
- Exact source: `9f99dbe64bc916e25c016f17bd22f2bdb652cb29`
- Initial baseline: clean `main == origin/main` before this manifest was added

## Expected product state

The production sparse-checkout sheet presents a three-step Choose/Adjust,
Review, and Apply/refresh rail. Guidance distinguishes empty, invalid, ready,
locked-review, running, and settled-result states. Review freezes and shows the
complete bounded normalized selection. A first enablement reports selected
roots; an enabled cone-mode update separately reports added, removed, and
unchanged selection entries without claiming to predict individual local
files. The Apply/result phase remains selected after success, cancellation, or
failure until the user edits or manually refreshes.

## Ordered headless Windows acceptance

1. Revalidate the exact low-level MCP HTTP server, scheduled-task launch
   contract, MCP checkout SHA, project branch, remote, and GitHub account.
2. Build exact source `9f99dbe64b` through MCP with the required unpackaged
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
   profile, open the sparse-checkout sheet, capture the Select state, enter
   `docs/`, open its frozen exact review, and capture the Review state. If the
   app-native hook fails, abort rather than touching the visible desktop.
7. Inspect both 1452×1001 dark-theme candidates at original resolution for the
   expected rail/review, clipping, overlap, blank pixels, private data, and
   dimensions. Promote only accepted candidates.
8. Close the exact revalidated HWND/PID, close the desktop once, stop owned
   fixtures, and remove only containment-checked owned Temp paths.

## Owned resources and cleanup ledger

- Run id: `m24-sparse-guide-9f99dbe-a1`
- Owned root: `%TEMP%\desktop-material-p0-ui-m24-sparse-guide-9f99dbe-a1`
- Fixture: owned root `fixture` child
- User data: owned root `profile` child
- Capture candidates: owned root `captures\sparse-guide` child
- Headless desktop: `DesktopMaterialSparseM24-9f99dbe-a1`
- CDP port: pending availability check immediately before launch
- Desktop create state/handle: pending
- Electron launch PID: pending
- Dynamically resolved HWND: pending
- Provider/fixture PIDs and ports: pending
- Cleanup proof: pending

## Screenshot and documentation allowlist

- `docs/assets/screenshots/material-sparse-checkout.png`
- `docs/assets/screenshots/material-sparse-checkout-safe.png`
- `README.md`
- `docs/features/repository-management/README.md`
- `docs/features/repository-management/sparse-checkout.md`
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
  audit build. The scheduled task runs the required fixed venv Python and
  `-m lowlevel_computer_use_mcp.server --http --host 127.0.0.1 --port 8765`
  from the fixed checkout at `ed1427f69b20dcd66df1de2ae3c6ba6591e2e640`.
- MCP `run_command` proved active GitHub account `codingmachineedge`, `main`,
  and the expected `origin` URL with `client_ok: true`, exit 0, and no timeout.
- A concurrent audit advanced `origin/main`; local `main` was fast-forwarded to
  exact source `9f99dbe64bc916e25c016f17bd22f2bdb652cb29` before M24 build work.
- After the initially clean baseline, 845 deleted image files appeared inside
  the `gemoji` submodule during the separate audit activity. They are unrelated
  and are preserved in submodule stash
  `c92556b9f422ac258eebabebb79a1a87a8a66a37` for exact-source build isolation;
  the stash must be restored byte-for-byte before completion.
- The first required build call failed before compilation because global Yarn
  is absent (`spawn yarn ENOENT`). No dependency was downloaded. The retry uses
  an owned Temp PATH shim that delegates only to repository-pinned
  `vendor/yarn-1.21.1.js` while leaving the required command unchanged.
- No fixture, desktop, app, or capture resource has been created yet.
