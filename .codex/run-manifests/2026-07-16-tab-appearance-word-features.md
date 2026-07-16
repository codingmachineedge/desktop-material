# Word-style tab appearance milestone

- Mode: `publish`
- Run ID: `desktop-material-tab-appearance-word-20260716`
- Milestone: expand the repository-tab appearance editor with a dense, accessible, Microsoft Word-like formatting toolkit while preserving the existing Material visual language.
- Project: `%USERPROFILE%\Documents\GitHub\desktop-material`
- Remote/branch: `origin` / `main`
- Baseline: record the exact SHA and dirty-state allowlist during preflight.
- Expected UI state: the tab appearance popover offers grouped text emphasis, decoration, alignment, font, size, case, spacing, foreground color, highlight color, preview, clear/reset actions, keyboard-operable controls, and responsive scrolling without clipping.
- Design references: `design/Desktop Material.dc.html`, `design/Desktop Material v2.dc.html`, the existing Account Manager hierarchy, and the supplied Word-like tab-formatting screenshot.
- Background interactions: build the exact production app, launch it with one synthetic repository on one isolated Win32 headless desktop, open tab appearance, exercise every new control group, verify persistence/reset/clear behavior, resize to the supported minimum, and capture the final populated editor.
- Disposable fixture: `%TEMP%\desktop-material-tab-appearance-word-20260716` containing one synthetic repository, isolated app data, captures, saved launch PID, and cleanup receipts; no provider credentials or real repository data.
- Headless desktop: `DesktopMaterialTabAppearance20260716`, created once and never shown or switched to.
- Screenshot target: `%TEMP%\desktop-material-tab-appearance-word-20260716\captures\tab-appearance-word.png`, light theme, privacy-safe synthetic repository, visually inspected at original resolution and then removed with the owned run root.
- Documentation allowlist: this manifest only. The coordinating customization release owns final screenshot promotion and README/wiki/site publication.
- Tests: tab appearance model/store/rendering interactions, persistence and migration coverage, accessibility names and keyboard behavior, responsive/clipping style contracts, TypeScript, Prettier/ESLint, exact production build, and isolated renderer geometry/a11y checks.
- Cleanup ledger: record the owned run root, desktop creation, saved launch PID, resolved HWND, app shutdown, zero-window poll, desktop close, and containment-checked Temp removal before publication.

## Verification record

- Baseline: clean canonical `main` at `1bc8a226de12996ffd01625aac69d4777ec2087f`; `origin/main` matched before implementation.
- Build: the exact required unpackaged production command completed through the HTTP MCP server after exposing the repository's vendored Yarn through a temporary ignored shim; the shim was removed immediately after each build and no dependency was downloaded.
- Interaction fallback: HWND-targeted background clicks/keys invalidated Chromium's frame but did not change renderer state. A localhost-only Electron CDP port was therefore used on the same off-screen desktop, as permitted by the gate fallback; it was closed with the owned app process.
- UI assertions: the final built popover opened with title `Tab appearance`; all required controls were named; `missing=[]`; its rect `(150,100)-(502,663)` was contained by the `1000x688` renderer viewport; horizontal scroll was `342 <= 342`; overflow was `hidden/auto`.
- Reachability assertion: after scrolling at the app's resulting minimum renderer viewport (`1000x691`), the editor rect `(150,100)-(502,666)` stayed contained, `scrollWidth=342`, `clientWidth=342`, `scrollTop=152.93`, and the last highlight swatch rect `(456,640)-(482,666)` was reachable.
- Resize limitation: the MCP native HWND resize tool could not resolve the off-screen HWND. CDP metric emulation did not honor the requested `520x420` CSS size in Electron, and `window.resizeTo` was clamped to the app/OS minimum above. Final native-width acceptance is intentionally left to the coordinating release task.
- Evidence: private baseline/open/bottom captures were inspected at original resolution; no capture was promoted. The source release owns final screenshots and README/wiki/site publication.
- Tests: focused model/store/profile/UI/style coverage passed `66/66`; TypeScript, changed-file ESLint, and Prettier passed. The broader unit sweep exceeded its 240-second bound without a reported failure; its exact owned Node process tree was terminated and focused coverage was rerun successfully.
- Cleanup: created desktop handle `856`; exact launch PIDs `13340`, `16640`, and `11636` were terminated only after their revalidated app HWNDs; the final zero-window poll returned `count=0`; desktop close returned `closed=true`; the containment-checked owned Temp root was removed and no private capture remains.
