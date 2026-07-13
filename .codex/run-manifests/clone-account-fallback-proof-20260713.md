# Clone account fallback headless proof

- Mode: `publish`
- Milestone: clone retries exact-origin signed-in accounts after an authentication or repository-not-found failure.
- Accepted UI state: Desktop Material opened the synthetic cloned repository after the first synthetic account was rejected and the fallback account succeeded without a credentials dialog.
- Ordered background interactions:
  1. Launch the production build on a uniquely named off-screen Win32 desktop with isolated user data.
  2. Open the clone-by-URL flow through HWND-targeted input.
  3. Enter the loopback HTTPS smart-Git fixture URL and an owned temporary destination.
  4. Submit the clone and wait for the repository view.
  5. Capture the resolved application HWND at 2048 x 1228 in light theme.
- Disposable fixture: `%TEMP%\desktop-material-clone-fallback-65b112e`; synthetic loopback identities and tokens only; removed after proof.
- Screenshot: `docs/assets/screenshots/material-clone-account-fallback.png`, light theme, 2048 x 1228, 140,143 bytes, SHA-256 `89bb755ad37f6d8537815d411526fa6e16aeee9cd16446deabbc17595cb3623c`.
- Documentation allowlist: this manifest, the screenshot, `README.md`, Pages gallery assets, `docs/wiki/`, `PLAN.md`, and `HANDOFF.md`.
- Validation: 1,906 tests across 627 suites (1,905 passed, one intentional skip), source lint, repository-wide Prettier, TypeScript, reproducible MCP production build, exact hidden-desktop clone, original-resolution image inspection and SHA-256, secret/privacy scan.
- Remote: `origin`.
- Expected branch: `codex/clone-account-fallback-proof` (root will integrate into `main`).
- Cleanup ledger: run `65b112e`; redacted fixture events recorded first-account rejection then fallback-account acceptance and pack service; exact Electron tree stopped; desktop closed once; synthetic credentials verified absent; loopback listener stopped; owned temporary tree removed.

