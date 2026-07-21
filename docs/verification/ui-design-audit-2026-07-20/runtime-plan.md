# Runtime plan: full UI parity audit against the supplied design ZIP

This document defines the repeatable runtime audit for `ui-design-audit-2026-07-20`.
It is a plan, not an execution receipt. A result may be called complete only when
the evidence and gates below have actually passed against the post-fix production
bundle.

## Outcome and coverage claim

The repository already has two complementary verification systems:

1. `.codex/verification/capture_gallery_cdp.js` is the broad semantic and visual
   state driver. It attaches to an already-running Electron production build on
   a hidden Win32 desktop, uses renderer-native/CDP interaction, enforces fixture
   and output containment, validates PNG dimensions and privacy, rejects duplicate
   images, and requires an exact canonical **68/68** output set.
2. `.codex/verification/verify_responsive_surface_matrix_cdp.js`, backed by
   `.codex/verification/responsive_surface_catalog.json`, is the exhaustive
   geometry/accessibility driver. Its current catalog inventories **85** rows
   (65 grouped surfaces plus 20 nested surfaces: 84 product rows and one
   deterministic clone-recovery row) and exercises eight viewport/zoom
   scenarios. The most recent tracked 79-row receipt predates this topology and
   cannot prove current completeness.

Neither system alone proves design parity. The audit therefore has four layers:

- register and reproduce the supplied prototype and its seven immutable PNGs;
- compare the 24 prototype-labeled surfaces in both themes (an exact 24 x 2,
  48-pair matrix) to their production counterparts;
- run the canonical 68-frame implementation gallery, separate exact five-frame
  design-target set, and current 85-surface responsive matrix against the exact
  post-fix build;
- run focused and full regression checks so a visual fix cannot silently break
  behavior, localization, accessibility, or another surface.

“Every element matches” means every inventoried element has one of these outcomes:

- `match`: exact token/semantic match and accepted visual/geometry comparison;
- `fixed`: mismatch was corrected and all post-fix gates passed;
- `intentional`: a documented product divergence explicitly approved by the
  user, with its reason and evidence;
- `not applicable`: only for a catalog row whose source-declared feature is not
  enabled in the deterministic fixture.

Any unexplained mismatch, missing route, uncaptured state, failed row, blocked
font/icon, or unregistered reference keeps the audit open.

Use `reference-inventory.md` in this directory as the traceability contract. It
contains 114 stable `REF-*` requirement IDs and distinguishes `MATCH`, `STATE`,
`AFFORDANCE`, `AMBIGUOUS`, and `ABSENT`. Runtime evidence and findings must cite
those IDs. A timer-backed prototype state is compared as UX rather than fake
backend logic; a no-op prototype affordance is a visual requirement only; an
ambiguity is resolved before failure; and an absent design topic does not cancel
a separate product requirement.

## Immutable inputs and source-of-truth rules

The archive supplied by the user is the design source of truth:

- archive SHA-256:
  `CDEC91773D202A076D8D700491F13EB065618DC986FA4F67D6909B02B61D8F86`;
- extracted interactive source:
  `<audit-root>\reference\Desktop Material v2.dc.html`;
- extracted v2 SHA-256:
  `C7000F1F2E7276F9F0BBDCD63225D432E445E257C49FAE72591DF3E455A0C9AE`;
- the repository copy `design/Desktop Material v2.dc.html` currently has a
  different SHA-256,
  `C4A57A159EA7CDF9D44D4995E075209894A6D14C7B2ED7CFD71A8DCAE23F4ADD`.

Do not silently substitute the tracked copy for the archive copy. Diff the two
as audit evidence, and update the tracked copy only as a separately reviewed
implementation/documentation decision.

The seven supplied files named `.png` are immutable registration targets. Their
bytes are actually JPEG/JFIF (`FF D8 FF E0 ... JFIF`), not PNG; all seven decode
to exactly 924 x 540. Preserve the filenames, hashes, dimensions, and JFIF
signatures as input provenance. Do not re-encode them merely to match the
extensions.

| File | Bytes | Decoded size | Actual encoding | SHA-256 |
| --- | ---: | ---: | --- | --- |
| `07-clone.png` | 31,708 | 924 x 540 | JPEG/JFIF | `9BA0B4030EFC90CB3B0F05503BBE1ACC93439846720D0E54BB8427705522F03A` |
| `regex-builder.png` | 25,594 | 924 x 540 | JPEG/JFIF | `9A1FA18C8C64E21D004B93E0CDDA2C24E3C37E96410E2F67EE141299F7AC6140` |
| `settings-accounts-dark.png` | 26,568 | 924 x 540 | JPEG/JFIF | `8DC197F225D15EDDA929D4DC75599015A0B156290DE5C8E7BACC12D4729590CC` |
| `settings-history-manager.png` | 30,924 | 924 x 540 | JPEG/JFIF | `B1CDC22F1F4B273DA42D3C4AE2C2C3A698A4D558FBB7F55973D43460E0A74EED` |
| `tab-text-style.png` | 33,654 | 924 x 540 | JPEG/JFIF | `476D3DE8DEEAE141A95DF0B5C829147134CE08FE537C93FB5BC75F6F3A9D26A4` |
| `workspace-changes-light.png` | 34,575 | 924 x 540 | JPEG/JFIF | `0CE1AA9E30D79F03438D8A38ADB2AA9D09B4B80DCDCBA4C5451EC32E2D4238C4` |
| `workspace-dark.png` | 36,051 | 924 x 540 | JPEG/JFIF | `01CFC8C587D01CF1DEFE7DED7A726A1DE7834A20AA5B597E23BA6733E27FDA79` |

The prototype root has a 1240 x 700 minimum and defaults to 100% UI zoom with
auto-fit enabled. At a 924-pixel viewport, its calculated CSS zoom is
`924 / 1240`, approximately `0.745`. Therefore:

- reproduce the supplied files at exactly 924 x 540 with prototype auto-fit on;
- also capture prototype and app at an unscaled logical 1240 x 725 registration
  canvas, with auto-fit off and 100% UI scale;
- normalize both logical captures through the same deterministic 924 x 540
  transform before whole-frame comparison;
- do not infer parity from an unregistered native window capture at 924 x 540.

## Pre-runtime constraints and resolved static blockers

### P0 fixture-root containment mismatch

The manifest currently owns:

`%TEMP%\desktop-material-ui-audit-20260720-9f64a2c1`

The P0 setup and runtime drivers deliberately reject that name. These files all
require a direct child of the system Temp directory whose basename begins
`desktop-material-p0-ui-`:

- `.codex/verification/prepare_p0_fixture.ps1`;
- `.codex/verification/clone_p0_fixture.ps1`;
- `capture_gallery_cdp.js::assertOwnedDisposableFixture`;
- `verify_responsive_surface_matrix_cdp.js`.

Do not weaken those contracts. Retain the existing root for the immutable ZIP
extraction and create this separate sibling runtime root for the first pass:

`%TEMP%\desktop-material-p0-ui-baseline`

Add that exact root and all of its child paths to `cleanup-ledger.md` before it
is created. The path must be absent at fixture preparation time. Keep the
resolved root at or below 96 characters: dedicated appearance repositories add
as many as 139 characters below the root, and longer audit labels can cross the
Windows Git object-path limit even when the coordinator itself initializes.
Canonical gallery scenes mutate the fixture (for example, the final Cheap-LFS
scene creates an evidence branch and a large file), so independent final passes
must not share a mutated fixture/profile. Use fresh direct-Temp siblings with a
short bounded pass id, such as `desktop-material-p0-ui-g1` or
`desktop-material-p0-ui-r1`, and ledger each one before creation. Do not clone a
dirty post-gallery fixture into another pass.

### Prototype network and font dependencies

`support.js` loads pinned React 18.3.1, ReactDOM 18.3.1, and Babel 7.29.0 from
`unpkg.com`. The prototype also loads Roboto, Roboto Mono, Roboto Serif, and
Material Symbols Rounded from Google Fonts. An apparently rendered frame with
fallback fonts or missing symbol glyphs is not valid reference evidence.

The reference capture must record:

- successful status and SHA-256 for every fetched script, stylesheet, and font;
- no console error, page error, failed request, mixed-content request, or CSP
  failure;
- `document.fonts.status === 'loaded'` after `document.fonts.ready`;
- positive `document.fonts.check(...)` results for all four named families;
- the expected 24 unique `data-screen-label` values in a static source parse,
  plus the route-specific visible subset in each runtime capture.

For repeatability, fetch the pinned assets once into the owned audit root, hash
them, and route the exact prototype URLs to those local bytes in the audit-only
Playwright reference driver. Never modify the archived HTML to make it pass.

### The supplied clone frame is not currently route-reproducible from v2

`07-clone.png` shows the left Repository sheet in an inline clone-selection
mode. In the archived v2 source, `cloneMode` is initialized and reset to `false`
but has no route that sets it to `true`; the `Clone multiple repositories`
button instead sets `cloneDlgOpen: true`, closes the sheet, and opens the
separate `[data-screen-label="Clone repositories dialog"]` surface.

Treat `07-clone.png` as a required visual artifact, but do not claim it is a
registered v2 golden until its provenance is resolved. Record both:

- the exact 07 frame as a legacy/alternate design comparison target; and
- the reachable v2 Clone repositories dialog as the interactive source target.

If the user wants exact 07 behavior, implementing the inline sheet is a product
decision. If the v2 dialog is authoritative, document 07 as superseded rather
than masking the difference.

### Icon-system boundary

The prototype uses Material Symbols Rounded. The app now bundles the official
98-name design subset and maps the core app bar, disclosure, navigation rail,
theme, and History-tag surfaces to it. Extension-only and GitHub-native surfaces
retain Octicons as an approved product boundary. Do not mask either system in
parity images: runtime still must prove the bundled glyph face, variable axes,
baseline/fill state, and that each core-vs-extension mapping is correctly
classified.

### Bundled product typography

The product now has five pinned official offline WOFF2 assets: Roboto normal
400–700, Roboto Mono normal 400–500, Roboto Serif normal and italic 400–600,
and Material Symbols Rounded 100–700 with the exact 98 requested names.
`app/styles/fonts/font-assets-manifest.json` records the upstream CSS/font
responses, hashes, axes, and cache metadata; OFL-1.1 and Apache-2.0 texts are
checked in under `app/static/common/licenses/fonts/`. Runtime must still prove
the rebuilt bundle emitted those bytes and that every required face loads and is
used without fallback.

### Build resource-copy safety

`script/build.ts` now resolves a linked source root before copying, materializes
a real output directory, rejects nested symbolic links/junctions, and guards
build execution behind `require.main === module`. The unit contract demonstrates
that deleting `out/emoji/unicode` cannot traverse back into the source and that
an out-of-tree nested link is rejected. Final acceptance still requires a clean
production rebuild plus filesystem proof that `out/emoji` is a real contained
directory and that its source remained unchanged.

### 924 x 540 clipping is not automatically a product requirement

The supplied 924 x 540 frames visibly include scaling, dense-panel clipping, and
horizontal scrollbars. The auxiliary 390 x 640 thumbnail is likewise a scaled
desktop miniature, not a defined narrow responsive layout. Register those pixels
faithfully, but do not introduce production clipping merely to copy the capture.
The product responsive/accessibility gate remains authoritative unless the user
explicitly selects the clipped historical behavior.

Likewise, the prototype has clickable `div` elements without complete keyboard
semantics, roles without required ARIA state, and icon-only controls without
accessible names. Those are design-prototype defects to document, not
accessibility regressions to reproduce.

## Headless execution boundary

All GUI work must remain off the visible desktop. Use only:

- fixed MCP server: `http://127.0.0.1:8765/mcp`;
- fixed MCP checkout:
  `<Documents folder>\GitHub\lowlevel-computer-use-mcp`;
- MCP Python: `<MCP checkout>\.venv\Scripts\python.exe`;
- repository client:
  `.codex/skills/verify-desktop-material-headless/scripts/lowlevel_mcp_client.py`;
- one uniquely named desktop:
  `DesktopMaterialAudit-20260720-9f64a2c1`;
- HWND-targeted `mouse_click`, `type_text`, `win_send_keys`, `resize_window`,
  and `screenshot`, plus a revalidated-handle `window_action` close;
- renderer-native/CDP input after the initial stable PrintWindow capture.

Never call `show_headless_desktop`, global mouse/keyboard/focus/scroll tools, or
generic image-name termination. Never kill every `electron.exe`. If graceful
close fails, revalidate command line, PID, desktop, HWND, and CDP port, then
terminate only the exact saved launch PID.

`rendered_ok` proves only that screenshot transport worked. Every required PNG
must also pass pixel/dimension checks and original-resolution visual inspection.

## Exact preflight and build sequence

Use PowerShell variables with task-specific names; do not repurpose environment
or system option variables.

```powershell
$AuditGitHub = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'GitHub'
$AuditRepo = Join-Path $AuditGitHub 'desktop-material-ui-audit-20260720'
$AuditMcp = Join-Path $AuditGitHub 'lowlevel-computer-use-mcp'
$AuditPython = Join-Path $AuditMcp '.venv\Scripts\python.exe'
$AuditClient = Join-Path $AuditRepo '.codex\skills\verify-desktop-material-headless\scripts\lowlevel_mcp_client.py'
$AuditEndpoint = 'http://127.0.0.1:8765/mcp'
$AuditPass = 'baseline'
$AuditP0Root = Join-Path $env:TEMP "desktop-material-p0-ui-$AuditPass"
$AuditDesktop = 'DesktopMaterialAudit-20260720-9f64a2c1'
$AuditReferenceRoot = Join-Path $env:TEMP 'desktop-material-ui-audit-20260720-9f64a2c1\reference'
```

1. Prove the worktree, branch, remote, commit, clean baseline, Node/Yarn versions,
   and absence of the P0 root. Record the values in the run receipt.
2. Call `startup_status` through the fixed client:

   ```powershell
   & $AuditPython $AuditClient startup_status '{}' --url $AuditEndpoint --timeout 30
   ```

3. Through MCP `run_command`, query the scheduled task action and active service
   command line, and require both to resolve to the fixed checkout and port 8765.
   Also run `git rev-parse HEAD` in the MCP checkout. Every response must have
   `ok: true`; every command must additionally have `returncode: 0`,
   `timed_out: false`, and client `client_ok: true`.

   ```powershell
   $AuditServiceProbe = {
   $ErrorActionPreference = 'Stop'
   $fixed = Join-Path `
     (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'GitHub') `
     'lowlevel-computer-use-mcp'
   $tasks = @(
     Get-ScheduledTask | ForEach-Object {
       $task = $_
       foreach ($action in $task.Actions) {
         $line = "$( $action.Execute ) $( $action.Arguments )"
         if ($line -match 'lowlevel-computer-use-mcp|lowlevel_computer_use_mcp') {
           [pscustomobject]@{ task = $task.TaskName; execute = $action.Execute; arguments = $action.Arguments }
         }
       }
     }
   )
   $processes = @(
     Get-CimInstance Win32_Process |
       Where-Object { $_.Name -match '^python(w)?\.exe$' -and $_.CommandLine -match 'lowlevel[_-]computer[_-]use[_-]mcp' } |
       Select-Object ProcessId, ExecutablePath, CommandLine
   )
   [pscustomobject]@{
     fixedCheckout = (Resolve-Path -LiteralPath $fixed).Path
     head = (& git -C $fixed rev-parse HEAD).Trim()
     tasks = $tasks
     processes = $processes
   } | ConvertTo-Json -Depth 6 -Compress
   }.ToString()
   $AuditServiceParams = @{
     command = $AuditServiceProbe
     shell = $true
     cwd = $AuditMcp
     timeout = 60
   } | ConvertTo-Json -Compress
   & $AuditPython $AuditClient run_command $AuditServiceParams --url $AuditEndpoint --timeout 90
   ```

   Fail if there is no matching scheduled action or active process, if an action
   or process points outside `$AuditMcp`, or if its arguments do not bind the
   expected MCP service to port 8765.
4. Through MCP `run_command`, with `cwd` equal to `$AuditRepo`, run exactly:

   ```text
   npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod
   ```

   Set the MCP tool timeout to 3600 seconds and the client timeout above 3600.
   Abort if a dependency is missing; do not download or rebuild an unpinned
   dependency as a side effect.

   ```powershell
   $AuditBuildParams = @{
     command = 'npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod'
     shell = $true
     cwd = $AuditRepo
     timeout = 3600
   } | ConvertTo-Json -Compress
   & $AuditPython $AuditClient run_command $AuditBuildParams --url $AuditEndpoint --timeout 3660
   ```

5. Hash `out/main.js`, `out/index.html`, `out/keytar.node`, and
   `node_modules/electron/dist/electron.exe`. Those hashes bind every later
   receipt to the exact post-fix bundle.

## Deterministic fixture and provider setup

Run each setup command through MCP `run_command` with the audit worktree as its
working directory. The shown commands are the command values; quote resolved
absolute paths when constructing JSON.

Prepare a fresh root for each independent final gallery or responsive
theme-language pass. A diagnostic pass may stop at the first failure, but it may
not be relabeled as final evidence after a later scene mutated its fixture.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .codex\verification\prepare_p0_fixture.ps1 -RunRoot $AuditP0Root

powershell -NoProfile -ExecutionPolicy Bypass -File .codex\verification\start_p0_provider.ps1 -RunRoot $AuditP0Root -PythonExecutable $AuditPython -SourceRoot $AuditRepo -Port 0

powershell -NoProfile -ExecutionPolicy Bypass -File .codex\verification\probe_p0_provider.ps1 -RunRoot $AuditP0Root

powershell -NoProfile -ExecutionPolicy Bypass -File .codex\verification\clone_p0_fixture.ps1 -RunRoot $AuditP0Root

node .codex\verification\seed_batch_clone_recovery_fixture.js --run-root $AuditP0Root --user-data-path "$AuditP0Root\profile" --destination-root "$AuditP0Root\downloads"

node .codex\verification\manage_p0_credential.js set "$AuditP0Root\provider\ready.json" "$AuditRepo\out\keytar.node"
```

The provider readiness file contains a token. Never print, copy, attach, commit,
or include its raw contents in a command result. The start/probe/credential
helpers emit safe receipts without exposing the token.

Before launch require:

- fixture branch/upstream and shallow-clone assertions from
  `clone_p0_fixture.ps1`;
- provider probe success for repository metadata, releases, issues, branch
  rules, Actions runs/jobs/logs/artifacts/caches/deployments, and CORS;
- credential `set` receipt with `present: true` but no token;
- no path/junction escape beneath the P0 root;
- an unused loopback CDP port selected dynamically and recorded.

## Electron launch and first-paint gate

1. Call `create_headless_desktop` exactly once for `$AuditDesktop`.
2. Recheck the Electron binary hash after the build.
3. Call `launch_on_headless_desktop` with the direct Electron command, not a
   shell wrapper, so the returned PID is the app process:

   ```text
   "<repo>\node_modules\electron\dist\electron.exe" "<repo>\out\main.js" --disable-gpu --disable-features=CalculateNativeWinOcclusion --user-data-dir="<P0-root>\profile" --remote-debugging-address=127.0.0.1 --remote-debugging-port=<dynamic-port> --cli-open="<P0-root>\fixture"
   ```

   The only `--cli-open` target is the owned fixture.

   ```powershell
   $AuditCreateParams = @{ name = $AuditDesktop } | ConvertTo-Json -Compress
   & $AuditPython $AuditClient create_headless_desktop $AuditCreateParams --url $AuditEndpoint --timeout 30

   $AuditElectron = Join-Path $AuditRepo 'node_modules\electron\dist\electron.exe'
   $AuditMain = Join-Path $AuditRepo 'out\main.js'
   $AuditProfile = Join-Path $AuditP0Root 'profile'
   $AuditFixture = Join-Path $AuditP0Root 'fixture'
   $AuditLaunchCommand = '"{0}" "{1}" --disable-gpu --disable-features=CalculateNativeWinOcclusion --user-data-dir="{2}" --remote-debugging-address=127.0.0.1 --remote-debugging-port={3} --cli-open="{4}"' -f $AuditElectron, $AuditMain, $AuditProfile, $AuditCdpPort, $AuditFixture
   $AuditLaunchParams = @{ name = $AuditDesktop; command = $AuditLaunchCommand } | ConvertTo-Json -Compress
   & $AuditPython $AuditClient launch_on_headless_desktop $AuditLaunchParams --url $AuditEndpoint --timeout 60
   ```

4. Save the returned PID. Poll `list_headless_windows` to a deadline and resolve
   the Desktop Material HWND dynamically from the current desktop, title, class,
   dimensions, PID provenance, and CDP target. Never hard-code a handle.

   ```powershell
   $AuditListParams = @{ name = $AuditDesktop } | ConvertTo-Json -Compress
   & $AuditPython $AuditClient list_headless_windows $AuditListParams --url $AuditEndpoint --timeout 30
   ```

5. Take a `client_only: true` Lowlevel screenshot before using any coordinate or
   CDP input. Require a stable nonblank frame on two consecutive captures, the
   expected client dimensions, no crash/error surface, and no user/private path.

   ```powershell
   $AuditFirstPaint = Join-Path $AuditP0Root 'captures\first-paint.png'
   $AuditShotParams = @{
     hwnd = [int64]$AuditHwnd
     client_only = $true
     output_path = $AuditFirstPaint
   } | ConvertTo-Json -Compress
   & $AuditPython $AuditClient screenshot $AuditShotParams --url $AuditEndpoint --timeout 60
   ```

   `screenshot` and input calls use `hwnd`. The current `resize_window` model
   expects `target: { handle: <HWND> }`, and `window_action` expects `handle`.
   Re-list the hidden desktop immediately before either handle-based call. If
   alternate-desktop native resize cannot resolve the revalidated handle, keep
   the native window unchanged and use CDP device metrics for audit viewports;
   never move or focus the window on the visible desktop.
6. Use CDP only after that first-paint proof. The app-native pattern already used
   by the gallery is the preferred fallback when Chromium ignores posted
   background input:

   ```javascript
   require('electron').ipcRenderer.emit('menu-event', {}, '<menu-event>')
   ```

7. Keep the native HWND and saved PID revalidated throughout the run. CDP
   emulation is for renderer metrics and screenshots; it does not replace native
   hidden-desktop ownership.

## Reference capture and registration driver

Use the audit-only reference driver with its deterministic CLI:

```text
node .codex/verification/capture_design_reference_cdp.js --source "<reference>\Desktop Material v2.dc.html" --assets "<reference-cache>" --out "<P0-root>\reference-captures" --width 924 --height 540 --logical-width 1240 --logical-height 725
```

The static driver and its contract are now present at
`.codex/verification/capture_design_reference_cdp.js` and
`.codex/verification/capture_design_reference_cdp_contract.test.js`. Sixteen
fresh-page routes cover the exact union of 24 source labels. Canonical planning
owns 48 output captures and an exact 24-label x two-theme logical coverage gate.
This records harness capability only; it is not an execution receipt. Its runtime
contract mirrors the production gallery:

- source and all referenced assets must remain inside the owned reference or
  cache roots;
- output files must be new, named from an allowlist, and written with exclusive
  creation;
- browser is headless/off-screen and never uses an existing user profile;
- console, request, font, animation-settle, generated-PNG signature, exact
  dimensions, SHA-256, duplicate-frame, and privacy checks are mandatory; the
  seven supplied registration inputs retain their pinned JPEG/JFIF signatures;
- the driver exposes `--list true`, `--route <name>`, and `--canonical true`;
- each route resets to a fresh page so state cannot leak;
- animations and caret blinking are disabled only after their design tokens are
  separately recorded; capture waits two animation frames after the final state;
- it emits a JSON route ledger containing actions, expected screen labels,
  observed labels, fonts, viewport, UI scale, theme, PNG path/hash, and failures.

Reference-registration routes for the supplied PNGs:

| PNG | Fresh-page route in archived v2 | Expected surface |
| --- | --- | --- |
| `workspace-changes-light.png` | initial page; no click | Changes workspace, light |
| `workspace-dark.png` | click `button[title="Toggle theme"]`, then the Changes `button[title="Search filters"]` | Changes workspace with filters open, dark |
| `tab-text-style.png` | click `button[title="Tab text style"]` | `[data-screen-label="Tab format popover"]` |
| `regex-builder.png` | click the Changes `button[title="Search filters"]`, then the `Regex builder` button | `[data-screen-label="Regex builder"]` |
| `settings-history-manager.png` | click `button[title="Settings history"]` | `[data-screen-label="Undo history manager"]` |
| `settings-accounts-dark.png` | toggle theme, click `button[title="Settings"]`, select `Accounts` if needed | `[data-screen-label="Settings dialog"]` on Accounts, dark |
| `07-clone.png` | unresolved in v2; separately capture app-bar `button[aria-haspopup="true"]`, then `button[title="Clone multiple repositories"]` | expected v2 dialog differs from supplied inline-sheet image |

Registration succeeds only when the first six fresh captures reproduce their
supplied states at 924 x 540 without missing assets and the clone discrepancy is
resolved or explicitly classified. Pixel metrics are diagnostic; any visible
registration difference must be explained before using that route as a golden.

## Prototype-to-production surface map

The archived v2 prototype exposes 24 unique `data-screen-label` surfaces. The
table below is the minimum parity traversal. “Entry” is an action, not a brittle
coordinate. Production selectors are already present in the source or gallery.

| Prototype label | Prototype entry | Production entry and assertion | Existing gallery scene/evidence |
| --- | --- | --- | --- |
| Title bar | initial | `#desktop-app-title-bar` | `workspace-changes`, shell style tests |
| Tab strip | initial | `.repository-tab-strip` | `workspace-changes`, `tab-search`, `tab-arrange`, `tab-style` |
| App bar | initial | `#desktop-app-toolbar` | `workspace-changes`, `toolbar-overflow` |
| Navigation rail | initial | `nav.repository-rail` | all repository-section scenes |
| Main pane | initial | `#desktop-app-contents` and active repository content | `workspace-changes` |
| Changes panel | initial, or rail button `Changes` | menu event `show-changes`; `.changes-panel-header`, `.filtered-changes-list` | `workspace-changes` |
| Commit composer | initial | `[role="group"][aria-label="Create commit"]`, `.commit-button` | `workspace-changes`, `cheap-lfs-preparing` |
| Diff pane | select a file | `.diff-container` | `workspace-changes` |
| History panel | rail button `History` | menu event `show-history`; `#commit-list` | `history` |
| Commit detail | History, choose a commit | `#commit-list .list-item`, then `.commit-details` | `history`, `history-context-actions` |
| Actions panel | rail button `Actions` | repository rail `Actions`; `.actions-view` | `actions-runs` |
| Workflow run detail | Actions, choose a run | `button.actions-run-select`; `.actions-run-details` | `actions-run-details`, job/artifact/deployment scenes |
| Workflow manager | Actions, `button[title="Manage workflows"]` | `button[aria-label="Manage workflows"]`; `.actions-workflow-management` | audit-design `workflow-manager`; responsive `repository.actions.workflow-manager` |
| Workflow catalog | Workflow manager, `New workflow` | `.actions-new-workflow-button`; `.workflow-catalog-dialog` | audit-design `workflow-catalog`; responsive `repository.actions.workflow-catalog` |
| Run workflow popover | Actions, `button[title^="Run a workflow"]` | `.actions-run-workflow-button`; `.workflow-dispatch-dialog` | audit-design `workflow-dispatch`; responsive `repository.actions.workflow-dispatch` |
| Repository sheet | app-bar `button[aria-haspopup="true"]` | menu event `choose-repository`; `#foldout-container .repository-list` | `repositories-sheet` |
| Branch sheet | rail button `Branches` | menu event `show-branches`; `.branches-container` | `branches-sheet`, `merge-all` |
| Settings dialog | `button[title="Settings"]` | menu event `show-preferences`; `#preferences` | `settings`, settings section scenes |
| Account switcher | `button[title="Switch account"]` | `button[aria-label="Switch account"]`; `.account-switcher` | audit-design `account-switcher`; responsive `repository.account-switcher` |
| Notification centre | `button[title="Notifications"]` | `[aria-label^="Notifications"]`; `.notification-centre-panel` | `notification-center`, bulk/GitHub scenes |
| Tab format popover | `button[title="Tab text style"]` | context-click `.repository-tab.active .repository-tab-label`; `.anchored-appearance-editor .element-appearance-editor` | `tab-style`, `anchored-appearance` |
| Undo history manager | `button[title="Settings history"]` | menu event `show-settings-history`; `.versioned-store-history-panel`, `.versioned-store-history-diff` | `settings-history` |
| Regex builder | `Search filters` then `Regex builder` | History: `.history-filter-chips-toggle`, `.history-regex-builder-chip`; `.regex-builder-dialog` | `regex-builder` |
| Clone repositories dialog | Repository sheet then `button[title="Clone multiple repositories"]` | menu event `clone-repository`; `dialog.clone-repository` | canonical `clone-fallback`/`shallow-clone-dialog`; audit-design `clone-dialog-design` |

For every row record:

- entry action and observed selector;
- bounding box, computed layout/display/overflow, typography, colors, borders,
  radius, elevation, icon, state layer, and enabled/selected/focus state;
- visible text and accessible name/role/state;
- reference and app PNG hashes at the registered dimensions;
- outcome and, if mismatched, exact owning source/style/test files.

Controls within a surface are not covered merely because the containing surface
was captured. Enumerate every visible button, link, input, textarea, select,
checkbox, radio, switch, slider, chip, tab, list option, tree/grid row, badge,
menu item, progress/status indicator, tooltip target, and scroll owner from both
DOMs. Diff the inventories by role, normalized label, state, order, and owner.

## Runtime dimensions, themes, languages, and states

### Design-registration matrix

- 924 x 540, reference auto-fit on: all seven supplied states.
- 1240 x 725, 100% scale and auto-fit off: the exact 24-label x two-theme
  reference matrix (48 label-theme pairs), with no missing or duplicate pair.
- 1280 x 800 and 1440 x 900: all 24 mapped production surfaces in light and
  dark, including hover/focus/pressed/selected/disabled where applicable.
- 760 x 720: every mapped sheet, dialog, popover, navigation view, and form in
  both themes.
- Canonical production gallery baseline: 1440 x 960, exact 68 outputs.
- Audit-design production set: exact five outputs for account switcher, workflow
  manager, workflow catalog, workflow dispatch, and the authoritative v2 clone
  dialog.

The production app may enforce a larger minimum native window. Sub-minimum sizes
are renderer/CDP emulation tests, not claims that the native Win32 frame can be
resized below its supported minimum.

### Existing exhaustive responsive matrix

Run all current 85 catalog rows against all existing scenarios. The exact set is
84 product surfaces plus the paused/interrupted clone-recovery surface. It now
includes Global ignore, account switcher, workflow manager, workflow catalog,
and workflow dispatch. The ledger must derive and report the count from the
catalog rather than trust the historical 79-row receipt.

| Scenario | Physical viewport | App zoom | Effective CSS viewport |
| --- | ---: | ---: | ---: |
| `desktop` | 1000 x 687 | 100% | 1000 x 687 |
| `minimum` | 640 x 480 | 100% | 640 x 480 |
| `narrow` | 480 x 640 | 100% | 480 x 640 |
| `short` | 960 x 420 | 100% | 960 x 420 |
| `wide` | 1600 x 900 | 100% | 1600 x 900 |
| `zoom-125` | 1000 x 687 | 125% | approximately 800 x 550 |
| `zoom-150` | 1000 x 687 | 150% | approximately 667 x 458 |
| `minimum-zoom-200` | 640 x 480 | 200% | 320 x 240 |

The responsive verifier now accepts `--theme light|dark` and
`--language-mode english|cantonese|bilingual`, retaining English/light defaults.
Its schema-v2 receipt fails closed unless requested, persisted, body/document,
and Appearance-UI state agree for the run and every row. It also requires a
contained exact loopback provider readiness file, strips the token while reading
bounded synthetic identity, safely hydrates the account/repository/Actions
state, proves zero provider mutation requests, and gates every settled viewport
on loaded bundled fonts. None of those static contracts is a runtime result.

The gallery has the same reviewed theme/language options and fail-closed
presentation/font receipts. Canonical remains exactly 68 outputs; the separate
audit-design catalog is exactly five outputs and cannot be combined with
canonical mode or an arbitrary scene list.

Required matrix:

- all 85 rows x all eight viewports in English/light;
- all 85 rows x `desktop`, `minimum`, `narrow`, `short`, and
  `minimum-zoom-200` in English/dark;
- all 85 rows x `desktop`, `minimum`, `narrow`, `short`, and
  `minimum-zoom-200` in Cantonese and bilingual, light and dark;
- additional 760 x 720 design-audit coverage for the 24 mapped prototype
  surfaces in bilingual mode, the highest text-width-risk combination.

Language checks must use the persisted Appearance setting
`select[name="languageMode"]` and assert the body
`data-dm-language-mode` value after reload. The existing submodule CDP verifier
already demonstrates this exact English/Cantonese/bilingual persistence pattern
and should be reused. Check fallback behavior, HTML language, visible primary and
secondary labels, accessible names, no duplicate announcements, and no clipping.
The archived prototype is English-only; non-English passes are layout and product
contract checks, not copy-parity comparisons.

### State coverage within each element class

For each applicable primitive, capture or programmatically assert:

- rest, hover, focus-visible, pressed, selected/checked, disabled, loading, and
  error states;
- empty, one-item, many-item, long-label, long-path, and overflow states;
- sheet/dialog open and closed ownership, backdrop, escape/close route, and
  restoration of the underlying page;
- keyboard traversal and activation, not only pointer activation;
- light/dark transitions, system-theme smoke, reduced motion, and 50–200% UI
  scaling/auto-fit persistence;
- English, Cantonese, and bilingual persistence across app reload.

Destructive controls are inspected without activation unless a disposable
fixture-specific verifier already supplies a safe, identity-revalidated route.

## Production capture commands

After first paint and deterministic seeding, list scenes with the parser's
required value form:

```powershell
node .codex\verification\capture_gallery_cdp.js --list true
```

Run the canonical gallery into a new owned directory:

```powershell
node .codex\verification\capture_gallery_cdp.js --run-root $AuditP0Root --port $AuditCdpPort --canonical true --theme light --language-mode english --out "$AuditP0Root\captures\gallery-1440x960" --fixture-path "$AuditP0Root\fixture" --width 1440 --height 960
```

The output directory must not exist or contain prior filenames. Require the
terminal receipt `CANONICAL 68/68 exact output set`. Retain all PNG SHA-256 values
and the driver's semantic/privacy receipts.

Run targeted design-state captures at 924 x 540, 1240 x 725, 1280 x 800,
1440 x 900, and 760 x 720. Use explicit scene lists and fresh output directories.
Do not run canonical mode and `--scenes` together. At minimum the targeted set is:

```text
workspace-changes,history,branches-sheet,repositories-sheet,settings,
settings-accounts,settings-history,anchored-appearance,notification-center,
tab-style,regex-builder,actions-runs,actions-run-details,clone-fallback
```

Run the separate exact audit-design set into another new owned output directory:

```powershell
node .codex\verification\capture_gallery_cdp.js --run-root $AuditP0Root --port $AuditCdpPort --audit-design true --theme light --language-mode english --out "$AuditP0Root\captures\audit-design-924x540" --fixture-path "$AuditP0Root\fixture" --width 924 --height 540
```

Require `AUDIT_DESIGN 5/5 exact output set`. Its five surfaces are account
switcher, workflow manager, workflow catalog, workflow dispatch, and the
reachable authoritative v2 clone dialog. This set is additive; it does not
change the canonical 68-output contract.

Run the responsive ledger into fresh owned paths:

```powershell
node .codex\verification\verify_responsive_surface_matrix_cdp.js --port $AuditCdpPort --run-root $AuditP0Root --repository-path "$AuditP0Root\fixture" --theme light --language-mode english --ledger "$AuditP0Root\captures\responsive-ledger.json" --capture-directory "$AuditP0Root\captures\responsive-short"
```

For the added theme/language combinations, use distinct new ledger and capture
paths. The verifier must record requested and observed theme/language in every
evidence row; a profile mutation without observed-state proof is not a pass.
Require the bounded provider identity/remote hydration receipt, bundled-font
receipt, and provider-mutation delta of zero in the final schema-v2 ledger.

## Comparison method and acceptance gates

### Reference registration

- exact 924 x 540 decoded dimensions, immutable input hashes, and the pinned
  JPEG/JFIF signatures behind the seven `.png` filenames;
- all expected assets/fonts loaded and no browser/runtime errors;
- expected route and screen-label set present, with no leaked prior route;
- first six supplied frames visually reproduce from fresh v2 routes;
- clone artifact discrepancy resolved/classified before parity sign-off.

### Semantic/component parity

- no missing or extra unreviewed role/label/control in the 24-surface inventory;
- correct hierarchy, order, ownership, modal/non-modal semantics, selection,
  disabled/loading/error states, and keyboard route;
- every visible icon reviewed; no silent icon mask;
- text differences caused only by deterministic fixture content are recorded as
  data differences, while font family, size, weight, line height, tracking,
  wrapping, truncation, and alignment still match their design target;
- every divergence has an owner and a disposition. Zero unexplained rows.

### Token and computed-style parity

Compare normalized computed values, not only source strings:

- all `--md-sys-color-*`, diff/status colors, shapes, elevations, typography,
  motion durations/easings, opacity/state layers, and focus-ring tokens;
- color-role use in both themes, including contrast and disabled opacity;
- geometry at registered logical size: bounding edges, gaps, padding, control
  heights, radii, stroke width, shadows, and scroll owners;
- tolerance is at most 1 CSS pixel for hard geometry and 2 CSS pixels for text
  baseline/rasterization. Token colors and declared dimensions must match exactly
  after normalization unless an approved divergence says otherwise.

### Image comparison

Produce, for every design-state pair:

- aligned reference and production PNGs;
- absolute-difference heatmap;
- alpha overlay/blink pair;
- region-level metrics for shell, panel, main content, and open overlay;
- machine-readable masks with reasons.

Masks may cover synthetic data strings, clock-like values, commit SHAs, and
fixture-specific paths after those elements' geometry/typography are checked
separately. Masks may not hide controls, icons, labels, borders, focus, clipping,
or a whole mismatching component. Metrics are triage aids, not waivers: the gate
is zero visible unexplained discrepancy after original-resolution review.

### Responsive/accessibility gate

For every required responsive receipt:

- no document/body/required-target horizontal overflow;
- every vertical scroll owner can reach its bottom;
- no overflow trap without a user-reachable scroll owner;
- final control and dialog form/footer remain reachable;
- no control overlap or clipping;
- no unnamed visible button;
- observed viewport and real `webFrame` zoom equal the requested values;
- correct theme and language observed;
- only source-declared conditional rows may be N/A;
- zero failed, blocked, or missing required rows.

### Privacy and artifact gate

- no real username, home path, Temp root, token, credential service secret,
  private repository, or unrelated window in a candidate;
- generated-PNG signature, exact dimensions, nonblank content, unique SHA, and
  reasonable file size; the immutable supplied inputs are separately gated as
  JPEG/JFIF despite their `.png` filenames;
- public promotion only after inspection; candidate and responsive evidence stay
  in the owned Temp root unless deliberately documented/promoted;
- no raw provider readiness file in logs or repository.

## Post-fix regression ladder

Run this ladder after the last UI change, not only before it.

### 1. Focused tests for every touched owner

Add or update a regression that names the mismatching component/token/state.
Use `node script/test.mjs` with all applicable files. Likely parity owners include:

```text
app/test/unit/material-controls-style-test.ts
app/test/unit/shell-chrome-v2-style-test.ts
app/test/unit/side-sheets-v2-style-test.ts
app/test/unit/settings-dialog-v2-style-test.ts
app/test/unit/clone-dialog-v2-style-test.ts
app/test/unit/history-panel-v2-style-test.ts
app/test/unit/notification-centre-v2-style-test.ts
app/test/unit/regex-builder-v2-style-test.ts
app/test/unit/tab-session-and-context-style-test.ts
app/test/unit/dialog-responsive-style-test.ts
app/test/unit/compact-shell-style-test.ts
app/test/unit/compact-settings-style-test.ts
app/test/unit/floating-surface-style-test.ts
app/test/unit/sheet-and-pill-geometry-style-test.ts
app/test/unit/material-context-menu-style-test.ts
app/test/unit/appearance-customization-style-test.ts
app/test/unit/actions-workflow-v2-style-test.ts
app/test/unit/app-menu-v2-style-test.ts
app/test/unit/material-welcome-style-test.ts
app/test/unit/responsive-surface-catalog-test.ts
app/test/unit/bundled-fonts-test.ts
app/test/unit/material-symbol-test.tsx
app/test/unit/material-symbol-shell-contract-test.ts
app/test/unit/build-copy-test.ts
app/test/unit/i18n-test.ts
```

Relevant component tests under `app/test/unit/ui/` include control/component/text
primitives, layout/message components, tab bar/item/style editor, Settings
history, Appearance, notification centre, Actions view/run inspector, regex test
area, and repository lists. Select by the actual diff; do not rewrite snapshots
or string assertions merely to bless an unexplained visual change.

### 2. Full UI/style regression set

```powershell
node script/test.mjs app/test/unit/material-controls-style-test.ts app/test/unit/shell-chrome-v2-style-test.ts app/test/unit/side-sheets-v2-style-test.ts app/test/unit/settings-dialog-v2-style-test.ts app/test/unit/clone-dialog-v2-style-test.ts app/test/unit/history-panel-v2-style-test.ts app/test/unit/notification-centre-v2-style-test.ts app/test/unit/regex-builder-v2-style-test.ts app/test/unit/tab-session-and-context-style-test.ts app/test/unit/dialog-responsive-style-test.ts app/test/unit/compact-shell-style-test.ts app/test/unit/compact-settings-style-test.ts app/test/unit/floating-surface-style-test.ts app/test/unit/sheet-and-pill-geometry-style-test.ts app/test/unit/material-context-menu-style-test.ts app/test/unit/appearance-customization-style-test.ts app/test/unit/actions-workflow-v2-style-test.ts app/test/unit/app-menu-v2-style-test.ts app/test/unit/material-welcome-style-test.ts app/test/unit/responsive-surface-catalog-test.ts app/test/unit/i18n-test.ts app/test/unit/ui
```

Then run the repository's full unit suite if time permits the release gate:

```powershell
yarn test:unit
```

### 3. Verification-harness contracts

```powershell
node --test .codex/verification/capture_gallery_cdp_contract.test.js
node --test .codex/verification/verify_responsive_surface_matrix_cdp_contract.test.js
node --test .codex/verification/capture_design_reference_cdp_contract.test.js
```

Also run the contract tests for any other verifier modified by the fixes,
especially language sweep, notification/navigation, Actions, repository logo,
API explorer, or submodule drivers. The listed contracts own the new
theme/language arguments, provider/font gates, reference 24 x 2 matrix, and
audit-specific exact output set.

### 4. Static checks

Run the repository's normal TypeScript, scoped lint, and formatting checks for
all touched TypeScript/TSX/SCSS/JSON/Markdown files. At minimum:

```powershell
npx --no-install tsc --noEmit -p tsconfig.json
```

Use package scripts for lint/Prettier rather than downloading tools. Inspect the
full diff for hard-coded color values, selector drift, disabled accessibility
semantics, or accidental fixture/reference paths.

### 5. Exact production rebuild

Repeat the Lowlevel MCP production build command and re-hash emitted artifacts.
All final runtime captures must come from this rebuild; earlier captures become
diagnostic only.

### 6. Hidden-desktop runtime regression

- repeat the Lowlevel first-paint stable frame;
- run canonical gallery and require exact 68/68;
- run the separate additive audit-design gallery and require exact 5/5;
- run all design-state captures in both themes;
- run the complete responsive/language matrix with zero failures;
- rerun every directly affected feature-specific CDP verifier;
- compare post-fix frames to both design reference and pre-fix evidence to prove
  the intended delta and no adjacent regression.

### 7. Packaged E2E, with a safety qualification

`yarn test:e2e:unpackaged`/the packaged E2E suite is useful for welcome, add
repository, diff, commit, branch, updater/About, trace, and video smoke coverage.
It is not the primary visual audit harness: it covers a narrow set, does not use
the alternate Win32 desktop, and its current teardown generically terminates
`Update.exe` and `GitHubDesktop.exe` by image name.

Run it only in controlled CI or a dedicated environment where no user-owned
process can be affected, or harden teardown to exact owned PIDs first. Do not run
that generic teardown on the user's active machine merely to add a green check.

## Evidence ledger and completion criteria

Retain these machine-readable receipts under the owned P0 root until review:

- archive/file hash inventory and tracked-vs-archive diff;
- reference resource/font/network ledger;
- reference route ledger, supplied-image registration captures, and exact
  24-label x two-theme logical matrix;
- prototype and app semantic/control inventories;
- token/computed-style comparisons;
- per-surface geometry and image-diff reports;
- canonical 68-output and audit-design five-output gallery ledgers;
- responsive theme/language ledgers;
- build artifact hashes and test results;
- PID/HWND/CDP/desktop lifecycle and cleanup receipt.

Promote only reviewed, privacy-safe screenshots and summarized audit reports.
The final report must list every mismatch, owning source, disposition, fix commit,
and post-fix evidence. It must also call out the archived-v2/tracked-v2 difference,
clone-frame provenance, font resource state, and any approved icon divergence.

The audit is complete only when:

1. all immutable inputs still match their hashes;
2. all 48 label-theme pairs in the 24-surface reference matrix and every nested
   control have a disposition;
3. the seven supplied 924 x 540 JPEG/JFIF states named `.png` are registered or
   explicitly resolved, including clone;
4. canonical gallery 68/68, audit-design 5/5, the current 85-row responsive
   matrix, theme/language passes, focused/full tests, static checks, and final
   production build pass;
5. every required screenshot was visually inspected at original resolution;
6. there are zero unexplained visual, semantic, geometry, accessibility,
   localization, privacy, or cleanup failures;
7. all intended code/docs are committed and pushed by the owning task, and the
   pushed commit is the one whose bundle and evidence passed.

## Deterministic cleanup

Use a `finally` path even after an audit failure:

1. re-list the named hidden desktop and revalidate the exact app HWND;
2. attempt `window_action` close with that handle;
3. if the alternate-desktop handle cannot be resolved, revalidate the saved PID,
   command line, executable, user-data path, fixture path, desktop, and CDP port,
   then terminate only that PID;
4. poll until the owned window and CDP listener are gone;
5. delete the disposable credential and verify absence:

   ```powershell
   node .codex\verification\manage_p0_credential.js delete "$AuditP0Root\provider\ready.json" "$AuditRepo\out\keytar.node"
   node .codex\verification\manage_p0_credential.js verify-absent "$AuditP0Root\provider\ready.json" "$AuditRepo\out\keytar.node"
   ```

6. stop only the provider PID recorded by its safe readiness receipt; never kill
   Python generically;
7. close `DesktopMaterialAudit-20260720-9f64a2c1` only after it has zero owned
   windows;
8. run `.codex/verification/cleanup_p0_fixture.ps1 -RunRoot $AuditP0Root` only
   after its provider/process containment checks pass;
9. retain the immutable reference root until all comparisons are complete, then
   remove it only through the separately recorded audit-root cleanup;
10. mark every path, PID, HWND, port, credential, provider, and desktop entry
    complete in `cleanup-ledger.md`.

Failure evidence may be summarized in tracked documentation, but a live process,
credential, desktop, listener, or owned Temp directory must never be left behind
silently.
