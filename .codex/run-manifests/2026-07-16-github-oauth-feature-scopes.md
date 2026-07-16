# GitHub OAuth feature-scope milestone

- Mode: `publish`
- Run ID: `desktop-material-github-oauth-scopes-20260716`
- Milestone: request the complete, documented GitHub OAuth scope set required by Desktop Material's implemented GitHub features, while excluding unrelated destructive organization/account administration.
- Project: `%USERPROFILE%\Documents\GitHub\desktop-material`
- Remote/branch: `origin` / `main`
- Baseline: record the exact SHA, remote parity, and dirty-state allowlist during preflight.
- Expected UI state: GitHub sign-in explains the feature access being requested; permission-related API failures point users to re-authenticate; no raw token or consent response is captured.
- Background interactions: build the exact production app, launch one synthetic repository on one isolated Win32 headless desktop, inspect the sign-in/release permission guidance without opening an external browser or authorizing an account, and capture only privacy-safe local UI evidence.
- Disposable fixture: `%TEMP%\desktop-material-github-oauth-scopes-20260716` containing one synthetic repository, isolated app data, captures, saved launch PID, and cleanup receipts; no provider credentials or real repository data.
- Headless desktop: `DesktopMaterialOAuthScopes20260716`, created once and never shown or switched to.
- Screenshot target: `%TEMP%\desktop-material-github-oauth-scopes-20260716\captures\github-permission-guidance.png`, inspected at original resolution and removed with the owned run root.
- Documentation allowlist: this manifest only. Authentication screenshots must remain private.
- Tests: OAuth authorization URL/scope coverage, permission-error guidance, focused UI/model tests, TypeScript, Prettier/ESLint, exact production build, and isolated renderer geometry/a11y checks.
- Cleanup ledger: record the owned run root, desktop creation, saved launch PID, resolved HWND, app shutdown, zero-window poll, desktop close, and containment-checked Temp removal before push.
