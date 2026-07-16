# Clone-style Add Submodule release gate

- Mode: `publish`
- Objective: replace the inline Add Submodule form with the Clone dialog's
  Material provider/URL selection experience, while retaining submodule path
  and optional branch semantics.
- Source gates: exact-account credential affinity, repository-relative path
  validation, duplicate/occupied destination rejection, cancellation, bounded
  progress, success/error states, and refresh of the underlying Submodules tab.
- Automated gates: focused model, Git boundary, popup registration, and UI
  tests; TypeScript; ESLint; Prettier; production build.
- UI gates: exact built source on an isolated off-screen Win32 desktop at
  desktop and compact renderer sizes; named/reachable controls, keyboard
  operation, internal vertical scrolling, and no horizontal clipping.
- Evidence hygiene: use only synthetic repositories, placeholder identities,
  and a dedicated temporary root. Do not retain tokens, account names, local
  home paths, private repository names, or raw terminal output.
- Publication: commit and push `main` without force, update privacy-safe public
  documentation/screenshots and the wiki, verify Pages/CI, then leave the
  canonical checkout clean apart from explicitly preserved foreign work.
- Run id: `add-submodule-20260716-01`
- Owned temporary root:
  `%TEMP%\desktop-material-add-submodule-20260716-01`
- Headless desktop: `DesktopMaterialAddSubmodule2026071601`
- Expected state: synthetic `superproject` open to Repository settings →
  Submodules, with the Add Submodule popup on its URL tab; placeholder remote
  `https://example.invalid/shared-library.git`, checkout path
  `vendor/shared-library`, and optional branch `stable` visible in Review.
- Ordered interaction: open repository settings, choose Submodules, launch Add
  submodule, select URL, enter the synthetic source, enter the optional branch,
  inspect desktop and compact sizes, and exercise keyboard focus without
  submitting the network operation.
- Capture target: `docs/assets/screenshots/add-submodule-dialog.png`, light
  theme, privacy-safe synthetic content, desktop renderer followed by compact
  clipping/accessibility acceptance.

## Completion receipt

- Baseline: canonical `main` at
  `c096afb051c99a44e2065f0004f1f9f288aad8f0`; the unrelated untracked OAuth
  manifest remained byte-for-byte preserved and was excluded from staging.
- MCP preflight: scheduled task `LowLevelComputerUseMCP` was `Ready` and pointed
  to the fixed checkout/HTTP port. Checkout
  `806d9ba85e4afbc2af58d7499496babfa7c68891` on `main` served every low-level
  call with `client_ok=true` except the documented unsupported off-screen HWND
  resize/close attempts.
- Production build: the exact unpackaged command completed through MCP with
  `DESKTOP_SKIP_PACKAGE=1` and wrote the built app to `out`. System PATH lacked
  Yarn, so one CLI copy was confined to this run's owned Temp root, used only
  to expose the command, and removed before fixture creation; no global or
  repository helper was retained.
- Automated gates: focused model, Git, popup registration, UI, style, and Pages
  suites passed 53 tests across 12 suites; the complete unit sweep passed 1,190 tests across
  415 files and 297 suites. TypeScript, changed-file ESLint with repository
  rules, Prettier, diff checks, and production webpack/build gates passed.
- Headless ownership: desktop handle `1948`; exact launch PID `13704`; runtime
  app HWND `530515162`; owned CDP port `59317`. Only the synthetic fixture head
  `02ded5c6808675cf2f30e6dd34c03b585c0429a8`, isolated profile, and `.invalid`
  remotes were opened.
- Interaction fallback: the first HWND-targeted click was accepted, but the
  next PrintWindow frame was stale/black. The app's loopback CDP target then
  completed onboarding, loaded the fixture, opened Repository settings →
  Submodules → Add submodule, exercised provider-tab arrow keys, and populated
  the URL/path/branch review. The hidden desktop was never shown or switched to.
- Geometry/a11y: at the minimum logical `1000×688` renderer the dialog rect was
  `(129,59)-(919,677)`, document/body widths were `1000=1000`, scroll-region
  widths were `790=790`, `overflow-x:hidden`, all 10 interactive controls were
  named, and every required control/Review region was reachable. The MCP HWND
  resize could not resolve an off-screen handle; requested `700×650` CDP metric
  emulation was clamped by Electron/auto-fit and is not represented as native
  compact-width evidence.
- Accepted capture: `docs/assets/screenshots/add-submodule-dialog.png`,
  `1500×1032`, 109,198 bytes, SHA-256
  `9ebfe5d94f7f624736c6fada706ee15279754102735d01d63d201b322ad10834`.
  Original pixels were inspected for clipping, black tiles, private data, and
  synthetic identity before promotion.
- Pages gate: the assembled site passed at desktop `960×660` (content width
  `945=945`) and mobile `390×844` (`375=375`). All 54 image instances loaded,
  all 53 gallery cards rendered, and no horizontal overflow, outside control,
  or broken image was found. The milestone assets measured `960×660`,
  `944×808`, and `1500×1032` as expected. Exact HTTP PID `15872`, browser PID
  `12040`, loopback ports `59421`/`59422`, and the containment-checked Pages
  Temp root were removed and independently verified absent.
- Cleanup: graceful native close could not resolve the off-screen HWND. The
  saved PID was revalidated against its exact Electron path and owned profile,
  then terminated; the desktop reached zero windows, CDP had zero listeners,
  `close_headless_desktop` returned `closed=true`, and the containment-checked
  owned Temp root was removed and verified absent.
- Documentation allowlist: README, ROADMAP, HANDOFF, Pages, Home, User Guide,
  Feature Gallery, this manifest, the dedicated CDP verifier, and the accepted
  screenshot. Public publication is completed only after `origin/main`, Pages,
  CI, and the separate wiki remote are verified.
