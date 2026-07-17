# Navigation, context actions, and scroll containment — 2026-07-16

## Goals

- Give every button a discoverable hover and keyboard-focus hint without native `title` tooltips.
- Restore reliable right-click and keyboard context actions, beginning with History commit rows, and keep menu actions aligned with the effective selection.
- Add filtering to Arrange Tabs, a runtime tab search/switcher, and account/service filters for cloned repositories.
- Fix Repository Tools so its full document can scroll to the true bottom at every supported viewport size.
- Add regression coverage that exercises the real CSS cascade, context-menu ownership, selection targeting, and scroll-to-bottom reachability.

## Safety boundaries

- Preserve destructive-action confirmations and existing repository/account affinity.
- Do not expose credentials, unrestricted commands, or cross-account fallbacks.
- Keep all production verification on the off-screen Win32 Headless Desktop through the exact low-level MCP server.
- Accept only current app-native pixels from the isolated process/profile; reject stale or global-desktop captures.

## Planned verification

- Focused model, UI, style, accessibility, and registration tests.
- Full TypeScript, repository-aware ESLint, Prettier, and `git diff --check`.
- Exact production build through MCP:
  `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`.
- Off-screen interaction at regular, minimum-supported, short, and zoomed geometries, including a true scroll-to-bottom assertion for Repository Tools.
- Original-pixel screenshot inspection, documentation refresh where behavior is user-facing, exact process/window/port cleanup, commit, push, and direct-remote proof.

## Receipts

- Baseline before this milestone: local `main`, `origin/main`, and direct remote `main` all pointed
  to `43af181fdd8be6123bda2322f4d2ce93dd3728f2`; one default worktree, no stashes, and no unrelated
  dirty files. The only carried edits were the final CI receipt for the immediately preceding
  notification milestone.
- Focused navigation, filters, context ownership, control primitives, and compiled-style coverage
  passed `51/51` tests across `14` suites before the hidden run. The hidden run found one additional
  pointer/focus precedence defect; its regression test then passed `5/5` and is included in the final
  combined gate.
- Full `tsc --noEmit`, repository-aware ESLint, targeted Prettier, and `git diff --check` passed
  before production verification. Final checks are repeated after documentation promotion.
- Fixed MCP preflight passed with `startup_status.ok=true`; scheduled task
  `LowLevelComputerUseMCP` runs the expected venv Python from the fixed checkout at
  `C:\Users\Administrator\Documents\GitHub\lowlevel-computer-use-mcp` on `127.0.0.1:8765`.
  The checkout was `8d6940be6a5f6e7c37de3f73acd2259fa7651efe`, and all preflight commands returned
  `client_ok=true` without timeout.
- The first exact build failed closed because the scheduled-task environment no longer resolved a
  global `yarn`. An already-installed npm-cache Yarn 1.22 launcher exposed the repository-pinned
  `vendor/yarn-1.21.1.js`; no package or dependency was downloaded. The required command remained
  `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`.
  Both subsequent exact MCP production builds completed successfully (`134.8s` and `129.6s`), the
  latter after the hidden run's tooltip-precedence correction.
- The accepted isolated run used PID `16380`, HWND `33423838`, CDP port `58377`, desktop
  `DesktopMaterialNavContext-20260716-02`, and the owned Temp root
  `desktop-material-p0-ui-nav-20260716-02`. The stable pre-input MCP capture was nonblank and showed
  only the synthetic `git-source` fixture. Chromium background pointer targeting was unreliable on
  the alternate desktop, so the retained verifier dispatches the same bounded renderer mouse events
  and intercepts only `show-contextual-menu` IPC to compare serialized menu payloads; it never
  invokes an action or exposes the visible desktop.
- Runtime tab search and Arrange filtering stayed fully within the `1000×687` CSS viewport with no
  horizontal overflow. Search matched exactly one synthetic tab by name/path; Arrange reported
  `1 of 1 tabs`, then a deterministic no-results state. Repository scopes persisted the exact
  `unassigned` + `local` conjunction and left the synthetic row reachable.
- History exposed `11` virtualized commit rows. Right-click and More produced byte-for-byte equal
  label sequences including reset, checkout, reorder, revert, branch, tag, cherry-pick, SHA copy,
  and provider entries. The shared More tooltip rendered, and the delegated Settings hint owned a
  real Tooltip target without a native `title`.
- Repository Tools owned `overflow-x:hidden` and `overflow-y:auto`; the exact bottom was reached at
  regular `1000×687` (`1423/1423`), minimum `640×480` (`2264/2264`), short `960×420`
  (`1674/1674`), and 150% zoom (CSS `667×458`, `2171.33/2171`) layouts. At each geometry the last
  named results control was inside both the scroll surface and viewport, and document/body widths
  matched their scroll widths.
- Accepted current-pixel captures were inspected at original resolution and promoted with matching
  SHA-256: `material-tab-search.png` (`1000×687`, `91,055` bytes,
  `1a18b970c9aaffe4716be61cbbc84afa34cad6395a9e2e35bdfe48472396abc5`),
  `material-history-context-actions.png` (`1000×687`, `92,197` bytes,
  `c5c2b722a4c79979ce3973ed8ce921fb1eac661caa1c03ace2317d4f81ef0ec0`), and
  `material-repository-tools-scroll.png` (`960×420`, `29,840` bytes,
  `d39dad61015ca333fbb95d388a8d75d7484a662d85f068e99a4b5fefa80f8b45`). They contain no
  credential, personal account, or non-fixture repository data.
- App-native quit removed the window but left the exact owned Electron root alive; after command-line
  revalidation only PID `16380` was terminated. The desktop then reported zero windows, closed once,
  and the containment-checking cleanup helper removed the exact owned Temp root.
- The final combined source, compiled-style, interaction, Pages, and 61-item wiki-gallery gate
  passed `82/82` tests across `17` suites. Final `tsc --noEmit`, repository-aware ESLint (with only
  the expected ignored-verifier warning), formatting, JavaScript syntax, and diff-integrity checks
  passed after screenshot and documentation promotion.
