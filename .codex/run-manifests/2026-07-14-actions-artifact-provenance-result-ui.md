<!-- markdownlint-disable MD013 -->

# Desktop Material Actions artifact provenance result UI

- Mode: `publish`
- Run id: `dm-actions-artifact-provenance-result-ui-20260714`
- Milestone: app-native review, selected-subject verification, and bounded result evidence
- Initial source: `d0373b7acaf5d3bd3899c56f1fd10bd8ac83e86e`
- Branch: `main`
- Expected remote: `origin` (`codingmachineedge/desktop-material`)
- Initial dirty-state baseline: clean and aligned with `origin/main`
- Exact MCP checkout: verify before build and capture
- Owned future off-screen desktop: `DesktopMaterialProvenanceResult-<run-id>`
- Disposable future fixture root: `%TEMP%\desktop-material-actions-provenance-result-ui-<run-id>`
- Screenshot targets: light and dark provenance review/result states at the supported 960×660 outer-window request, with narrow and short-height checks
- Authorized public mutations: focused source/docs commits, push to `main`, and ordinary GitHub Pages/wiki Markdown updates through the repository

## Scope

Complete the active roadmap items for the Actions artifact provenance review/result UI. Use the existing selected-account store orchestration and main-process verifier boundary; add only renderer-safe state and a modal that exposes the archive transport digest, one explicitly selected ZIP subject, fixed source/signer policy, selected account endpoint/login, normalized outcome, and bounded evidence. The UI must state that verifying one subject does not verify every file in the archive.

Required UI behavior:

1. Start only from a completed artifact download whose local digest exactly matches the provider digest.
2. Open a single vertically scrollable dialog with contained focus and Escape/Close cleanup.
3. Load the bounded review, display the selected repository account and fixed policy, and require one subject and signer selection before verification.
4. Reopen/recompute the selected subject through the store, display a separate subject digest, and render Verified, Unavailable, Not attested, Verification failed, Changed bytes, or Canceled without raw verifier/API output.
5. Keep archive and subject identity visibly separate and make long paths/digests wrap at narrow widths.
6. Dispose the exact review/download on close, repository/run/account replacement, unmount, and retry paths.

## Ordered verification

- Use the fixed low-level MCP HTTP server and off-screen Win32 Headless Desktop only; never show or focus the user's visible desktop.
- Build with `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod` through MCP.
- Use a deterministic disposable synthetic Actions fixture, isolated Electron user data, a unique hidden desktop, and a runtime-resolved app HWND.
- Exercise open review, subject selection, verify, normalized result, close, Escape, short height, narrow width, dark theme, and 200% base-scale layout checks by hwnd-targeted automation.
- Inspect every candidate PNG at original resolution before promotion.

## Documentation allowlist

- `README.md`
- `docs/wiki/Feature-Gallery.md`
- `docs/wiki/Home.md`
- `docs/wiki/User-Guide.md`
- `site/index.html`
- `docs/assets/screenshots/material-actions-artifact-provenance-review.png`
- `docs/assets/screenshots/material-actions-artifact-provenance-result.png`
- `HANDOFF.md`
- this manifest

## Completion gate

- Focused provenance store/UI tests, TypeScript, scoped lint/format, production bundle, diff/secret scan, and exact low-level headless smoke pass.
- Promoted screenshots are synthetic, nonblank, privacy-safe, and referenced by README, wiki, and Pages content.
- Commit intentionally on `main`, push `origin/main`, verify local/tracking/direct-remote SHA and CI/Pages state, then report the cleanup receipt.
