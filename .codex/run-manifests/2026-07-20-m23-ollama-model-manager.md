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
