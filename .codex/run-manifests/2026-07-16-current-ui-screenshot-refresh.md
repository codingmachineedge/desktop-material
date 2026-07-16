# Current UI screenshot refresh gate

- Mode: `publish`
- Milestone: add a persistent App identity editor for the displayed app name,
  logo, brand color, and Word-style name typography, then replace every stale
  screenshot published by README, Pages, and in-repository/separate wiki
  documentation with one canonical current-UI asset set, preserving shared
  filenames where practical.
- Expected branch/remote: canonical `main` → `origin/main`, fast-forward push
  only. The user's standing instruction to always push authorizes publication.
- Initial foreign-work rule: preserve the unrelated untracked OAuth-scope run
  manifest byte-for-byte and leave the detached foreign worktree untouched.
- Run id: `screenshot-refresh-20260716-01`
- Owned temporary root: `%TEMP%\desktop-material-screenshot-refresh-20260716-01`
- Headless desktop: `DesktopMaterialScreenshotRefresh2026071601`
- Build gate: exact unpackaged production build through the fixed low-level MCP
  server using `npx --no-install cross-env RELEASE_CHANNEL=development
  DESKTOP_SKIP_PACKAGE=1 yarn build:prod`; do not download dependencies.
- Fixture/profile: deterministic synthetic repository and provider data plus an
  isolated Electron user-data directory entirely beneath the owned Temp root.
- Capture inventory: derive the unique PNG asset list from README, `site/`, and
  `docs/wiki/`; classify each as current, recapturable application UI, or
  historical evidence. Replace every recapturable stale image with a freshly
  inspected current build capture and make all publishers reference the same
  canonical file.
- Expected UI state: light Material theme, synthetic repository/account data,
  current navigation and dialogs, and the new App identity surface with live
  preview, reset, validated logo/name/color controls, and complete name-font
  controls. No private paths, names, tokens, repositories, or desktop content.
  Each capture must be nonblank, unclipped, and at its documented
  viewport/dimensions.
- Ordered interaction: build; create fixture/profile and one hidden desktop;
  launch the exact built app; complete onboarding; open each inventoried surface
  through HWND-targeted input or an isolated loopback CDP fallback when the
  off-screen Chromium compositor rejects background input; capture and inspect;
  promote only accepted images; close and clean exact owned resources.
- Documentation allowlist: `README.md`, `site/`, `docs/wiki/`, `HANDOFF.md`,
  screenshot assets under `docs/assets/screenshots/`, this manifest, and bounded
  verification helpers under `.codex/verification/` when required.
- Tests: App identity model/persistence/migration/live-preview/accessibility and
  responsive-style checks; screenshot-reference and broken-image inventory;
  Pages desktop/mobile clipping and accessibility gate; Markdown/HTML structure
  checks; TypeScript/lint/format/diff; exact production build; public
  README/Pages/wiki image verification after push.
- Cleanup ledger (populate during run): owned Temp paths, hidden desktop handle,
  exact launch PID/HWND, loopback ports, capture hashes, close result, and final
  absence checks.

## Completion receipt

- The fixed implementation is
  `4e797f52b9ecb4d77f40bfa1e11629fb2f8e3b95`. It adds profile-backed app
  identity, rich name/logo typography, favorite tabs, one-shot favorite sorts,
  repository-folder drop, bounded current-tab session import/export, and
  profile/repository ownership context on appropriate right-click surfaces.
  Unknown newer appearance/session keys remain intact while known fields are
  independently normalized.
- The exact low-level MCP preflight passed at `http://127.0.0.1:8765`. Its
  configured interpreter was
  `C:\Users\Administrator\Documents\GitHub\lowlevel-computer-use-mcp\.venv\Scripts\python.exe`;
  the fixed MCP checkout was
  `806d9ba85e4afbc2af58d7499496babfa7c68891`.
- The required MCP production build ran
  `npx --no-install cross-env RELEASE_CHANNEL=development
  DESKTOP_SKIP_PACKAGE=1 yarn build:prod` and returned code 0 with no timeout.
  The MCP client wall time was 170.5 seconds (Yarn reported 168.87 seconds),
  and the unpackaged result was built to `out` without downloading a runtime or
  dependency.
- TypeScript, scoped ESLint, scoped Prettier, staged diff/secret scans, and the
  screenshot-reference gate passed. The complete test runner exercised 420
  files: 1,218 tests in 306 suites, all passing. Focused identity, migration,
  tab, drop, transfer, context-menu, and Pages checks also passed. Repository
  Markdown lint remains unsuitable as an acceptance gate because its existing
  README/wiki baseline reports hundreds of untouched MD013/MD036 violations.
- All GUI work stayed on off-screen Win32 desktop
  `DesktopMaterialScreenshotRefresh2026071601` (creation handle `1828`) with
  isolated CDP port `9337`. Native HWND resize was not available through the
  MCP window surface, so the approved CDP metrics fallback supplied the compact
  renderer gate. PrintWindow reliably captured a fresh launch's first paint but
  did not repaint post-CDP interactions; private interaction evidence therefore
  remained under the owned Temp root, while the promoted public screenshot came
  from a fresh rebuilt-app MCP capture.
- Restart persistence reopened `Material Workbench` with the Sparkle identity,
  expanded Calibri text, 95% opacity, glow, pill highlight, strong logo border,
  soft shadow, and a 22 px logo. All 38 uniquely named identity controls were
  reachable. Normal document/body/pane/identity width pairs were
  `1000/1000`, `1001/1001`, `694/694`, and `633/633`; compact CDP pairs were
  `645/645`, `645/645`, `383/383`, and `322/322`. No control was outside the
  compact horizontal viewport.
- Favorite/arrange verification found one favorite tab and all eight named
  sorts. The popover was bounded at `(448,104)-(888,573)` with
  `clientWidth=scrollWidth=430`. Export and import dialogs were horizontally
  bounded, and the folder-drop status overlay stayed inside `(22,52)-(978,668)`
  at the 1000×688 renderer viewport.
- The public MCP capture
  `docs/assets/screenshots/material-app-identity-workspace.png` is 1443×992,
  166,398 bytes, SHA-256
  `45504266edf337f36a5a6bde0932e1b7ab740d33009e7d8c04a866979e506533`.
  It was reopened at original resolution and contains only synthetic fixture
  state. README, Pages, and in-repository wiki sources share it; 55 distinct
  screenshot references resolve with zero missing files, Pages exposes 54
  unique gallery images, and the guided wiki table covers 53 images.
- Exact owned launch PID `11388`/HWND `315884768` was gracefully stopped before
  the final build. The rebuilt launch used PID `2148`/HWND `54920934`; it was
  revalidated, gracefully stopped with `force=false`, and the named desktop
  reached zero windows before its single successful close. Earlier owned launch
  PIDs `6652`, `13284`, `14204`, and `7928` had likewise been individually
  cleaned. The containment-checked Temp root
  `%TEMP%\desktop-material-screenshot-refresh-20260716-01` was removed and
  read back absent. The visible desktop and unrelated Electron processes were
  never focused, resized, terminated, or otherwise used.
- The unrelated OAuth-scope manifest remained untracked and byte-identical at
  SHA-256
  `01685d027056cc887455215075bf6ef8234283cef1385bcac6bb2971abb88fc3`;
  the detached foreign release worktree was not touched.
