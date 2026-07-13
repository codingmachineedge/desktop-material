# Clone account fallback verification manifest

- Mode: `publish`
- Milestone: clone a private repository using another signed-in account
- Initial baseline: clean `main` at `10deb19592fa4a683ab32f836c1294ef5ccc6c6b`
- Accepted UI state: an HTTPS clone that was inaccessible to the initial account retried the next eligible exact-origin signed-in account without opening a credentials dialog, then opened the cloned repository normally
- Ordered background interactions: preflight exact MCP server; build; create disposable HTTPS smart-Git fixture and isolated user data; create one hidden desktop; launch exact built Electron PID; drive clone through HWND-targeted input; capture accepted state; close exact HWND/PID; close desktop; remove owned credentials and Temp paths
- Run ID: `65b112e`
- Disposable fixture root: owned `%TEMP%\desktop-material-clone-fallback-65b112e` directory, removed after verification
- Proof implementation: `0b4f25cc8e91eb62634e70f90e24f1a44d00dc9d`; first main proof baseline: `3dc1ecc4d8daff6150980e47a13db4f3a61ec37a`
- Fixture result: clean `main` at `c9eee876c4451d380f8cc7628b5971f624f9395f`; exact custom-port origin preserved
- Redacted fixture ledger: `server_ready`, `authentication_challenge_issued`, `first_account_rejected`, `fallback_account_accepted`, `advertisement_served`, `pack_served`
- Screenshot: `docs/assets/screenshots/material-clone-account-fallback.png`, light theme, 2048×1228, 140,143 bytes, SHA-256 `89bb755ad37f6d8537815d411526fa6e16aeee9cd16446deabbc17595cb3623c`
- Documentation allowlist: `README.md`, `site/index.html`, `docs/wiki/User-Guide.md`, `PLAN.md`, `HANDOFF.md`, promoted screenshot, implementation/tests, and this manifest
- Validation: 1,906 tests across 627 suites (1,905 passed, one intentional skip); `yarn lint:src`; repository-wide Prettier; `yarn tsc --noEmit --skipLibCheck`; reproducible production build through the exact MCP endpoint; hidden-desktop clone proof; original-resolution privacy inspection; privacy/secret scan
- Remote: `origin` = `https://github.com/codingmachineedge/desktop-material.git`
- Expected final branch: `main`
- Cleanup ledger: exact app tree stopped; hidden desktop `DMCloneFallback_65b112e` closed once; both synthetic credential entries removed and verified absent; exact fixture process tree and port 38443 stopped; owned temporary tree removed; no proof process, listener, credential, or temporary path remains
