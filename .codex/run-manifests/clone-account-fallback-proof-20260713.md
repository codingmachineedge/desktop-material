# Clone account fallback headless proof

- Mode: `publish`
- Milestone: clone retries exact-origin signed-in accounts after an authentication or repository-not-found failure.
- Expected UI state: Desktop Material opens a synthetic cloned repository after the first synthetic account is rejected and the fallback account succeeds.
- Ordered background interactions:
  1. Launch the production build on a uniquely named off-screen Win32 desktop with isolated user data.
  2. Open the clone-by-URL flow through HWND-targeted input.
  3. Enter the loopback HTTPS smart-Git fixture URL and an owned temporary destination.
  4. Submit the clone and wait for the repository view.
  5. Capture the resolved application HWND at 2048 x 1228 in light theme.
- Disposable fixture: `%TEMP%\desktop-material-clone-account-fallback-<run-id>`; synthetic loopback identities and tokens only.
- Screenshot: `docs/assets/screenshots/material-clone-account-fallback.png`, light theme, 2048 x 1228.
- Documentation allowlist: this manifest, the screenshot, `README.md`, Pages gallery assets, `docs/wiki/`, `PLAN.md`, and `HANDOFF.md`.
- Validation: focused clone/account tests, source lint, Prettier, TypeScript, reproducible MCP production build, image inspection and SHA-256, secret/privacy scan.
- Remote: `origin`.
- Expected branch: `codex/clone-account-fallback-proof` (root will integrate into `main`).
- Cleanup ledger: run ID, owned temporary root, fixture, isolated user data, certificate/key, synthetic credential service and account names, server PID, desktop name/create state, application PID, resolved HWND, closure/removal results.

