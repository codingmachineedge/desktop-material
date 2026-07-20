# Ollama Model Manager — M23 Run Manifest

## Mode and scope

- Mode: `publish`
- Milestone: M23 — full Ollama model manager
- Product boundary: Windows x64/arm64 application only
- Requested scope: add the Ollama model manager only; do not implement the
  worktree-manager or close-tabs regex-builder requests in this run
- Expected branch: `main`
- Remote: `origin`

## Expected product state

The existing Copilot model/provider preferences gain a purpose-built Ollama
manager that can connect to a configured local Ollama endpoint, report service
health/version, list and filter installed models, inspect model metadata and
running state, pull models with bounded progress and cancellation, copy models,
delete models through confirmation, and start or stop a model without exposing
raw API editing. Empty, loading, unavailable, partial, success, cancellation,
and failure states remain responsive and keyboard accessible.

## Headless Windows acceptance

1. Build the exact implementation through the low-level MCP HTTP server.
2. Create a unique owned Temp run root containing an isolated app user-data
   directory and a deterministic loopback Ollama fixture.
3. Create one uniquely named off-screen Win32 desktop.
4. Launch the absolute built Electron binary with `--disable-gpu`, the isolated
   user-data directory, and only the disposable fixture repository as
   `--cli-open`.
5. Resolve the live Desktop Material HWND dynamically.
6. Navigate with HWND-bound background input to Copilot model/provider
   preferences and exercise service discovery, installed-model inventory,
   search/filter, details, pull/progress/cancel, copy, run/stop, and confirmed
   deletion against the synthetic loopback fixture.
7. Capture an identity-safe 1452×1001 dark-theme manager overview with no
   clipping, blank regions, personal data, credentials, or real provider writes.
8. Close the exact HWND/PID, stop the fixture, close the desktop exactly once,
   and remove only verified owned Temp paths.

## Screenshot and documentation targets

- Screenshot: `docs/assets/screenshots/material-ollama-model-manager.png`
- README: feature summary, roadmap evidence, and screenshot gallery
- Pages: `site/index.html`
- Canonical wiki: `docs/wiki/User-Guide.md` and/or
  `docs/wiki/Feature-Gallery.md`
- Handoff: `HANDOFF.md`
- Plan: `PLAN.md`

## Declared validation

- Focused Ollama API/model/store/UI/style tests
- Adjacent Copilot BYOK/provider/model preference tests
- TypeScript `--noEmit`
- targeted ESLint and Prettier
- production build through the exact low-level MCP HTTP server
- original-resolution screenshot inspection and SHA-256 verification
- final diff, conflict-marker, personal-data, and secret scans
- pushed exact-SHA Windows CI, Pages, installer/release applicability, wiki
  synchronization, artifact cleanup, and clean `main == origin/main`

## Cleanup ledger

The implementation run must append its unique run id, owned Temp root, fixture
paths and ports, headless desktop name, create state, Electron PID, and resolved
HWND before launching the app. Every created resource must be verified absent
before this manifest can be marked complete.

## Execution ledger (complete)

- Run id: `m23-49bcbf-a7e3`.
- Exact MCP endpoint: `http://127.0.0.1:8765/mcp`; scheduled task and checkout
  were revalidated at `547a102a49169d41da876de217856229ab7c03a1`.
- Exact application build: source `27ffc1af7dd1223809c69ea0f72ddab369869f31`;
  the required unpackaged production command returned `client_ok: true`, exit
  code 0, and no timeout after 213.16 seconds.
- Owned P0 root: `%TEMP%\desktop-material-p0-ui-m23-49bcbf-a7e3`;
  isolated profile, fixture clone, capture directory, and provider state are
  contained beneath it. Synthetic provider PID `20484`, loopback port `58441`,
  Copilot feature enabled, disposable credential login `material-verifier-p0`.
- Owned Ollama root: `%TEMP%\desktop-material-ollama-m23-49bcbf-a7e3`;
  synthetic fixture PID `37392`, loopback port `55326`, version `0.12.6`, and
  4.2-second minimum pull duration. The retained probe passed live cancellation
  and all five deterministic failure modes before resetting the fixture.
- Owned CDP port: `60586` (confirmed unused when reserved; recheck immediately
  before launch).
- Headless desktop: `DesktopMaterialOllamaM23-49bcbf-a7e3`, created exactly
  once as `WinSta0\DesktopMaterialOllamaM23-49bcbf-a7e3` with owned handle
  `932`; never shown or switched to the visible desktop.
- The first Ollama-start wrapper retained an output pipe after the child became
  ready. Only the wedged MCP scheduled task was restarted; both owned fixture
  PIDs survived, and the full MCP preflight plus Ollama probe passed afterward.
- Initial validation launch PID `8140` and dynamically resolved Desktop
  Material HWND `25035724` were revalidated before every action. The targeted
  Win32 shortcut was accepted but did not navigate Chromium, so the run used
  only the owned loopback CDP fallback. The strict gate found and fixed an
  over-tall manager layout; the exact saved PID was then terminated after the
  HWND close request was ignored, and both PID and CDP listener were absent
  before rebuilding.
- Final post-rebuild Electron PID `31564` and dynamically resolved HWND
  `4392214` ran on the same owned desktop. The attach-only verifier exercised
  health/version, inventory/details, capability search, running scope,
  pull-progress cancellation with atomic rollback, successful pull, provider
  synchronization, copy, rename, load, unload, confirmed deletion, and reset.
- The first otherwise-valid capture, SHA-256
  `49581c28dbd7b946e323cb86d96cadfea4dc9d0f2991c01c2fbedb3cc5f1fae5`,
  was rejected during original-resolution review because the settings footer
  visually covered the lower editors. It was removed from the owned root, the
  product layout and verifier contract were fixed, and the application was
  rebuilt before the final run.
- Accepted capture: `material-ollama-model-manager.png`, 128,903 bytes,
  1452×1001, SHA-256
  `f1735c664248cd1b10a64e672dbbab24c95dabab99a62deeaf93557145a36509`.
  The receipt reports varied pixels, zero control overlaps, no horizontal
  overflow, manager/preferences containment, all controls above the footer,
  named accessible controls, and `privacySafe: true`. The promoted tracked
  image matched those bytes exactly.
- Cleanup completed in order: the exact HWND close attempt was ignored, the
  revalidated saved PID was terminated, the CDP listener disappeared, the
  disposable credential was deleted and independently verified absent, the P0
  provider was stopped, both containment-checked fixture roots were removed,
  and the one headless desktop was closed. Final checks found no owned PIDs,
  process command-line references, or listeners on ports `58441`, `55326`, or
  `60586`; reopening the desktop name failed with Win32 error 2 as expected.
