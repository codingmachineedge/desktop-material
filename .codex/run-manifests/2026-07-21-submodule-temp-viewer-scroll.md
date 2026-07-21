# Submodule temporary viewer and dialog-wheel run manifest

- Mode: local-docs; delegated integration branch, explicitly no push or merge.
- Milestone: route changed/new submodule commit actions into the validated
  temporary read-only viewer, expose a visible Close action, and make wheel or
  trackpad scrolling work over all scrollable dialog content.
- Base: `origin/main` at `dce7b9417f30568171d37033b27fb176f92c8dd9`.
- Branch/worktree: `codex/submodule-temp-viewer-scroll` at
  `C:\Users\Administrator\Documents\GitHub\desktop-material-submodule-temp-viewer-scroll`.
- Expected UI: card and manager copy says temporary/read-only/no import; Close
  returns to the parent and clears temporary state; nested dialog controls keep
  their wheel range and chain to the outer body at an edge; a background dialog
  requests front on wheel interaction.
- Ordered headless interactions: preflight the fixed Lowlevel MCP; build the
  unpackaged production bundle; create a disposable Git fixture and user-data
  path; create one off-screen desktop; launch only the fixture; exercise the
  viewer and dialog wheel paths; capture and inspect; close exact owned
  window/PID/desktop; remove only owned Temp paths.
- Headless preflight: `startup_status` at `http://127.0.0.1:8765/mcp` timed out
  on 2026-07-21 before returning a receipt. No visible-desktop fallback is
  authorized; focused non-GUI verification continues and no screenshot is
  promoted unless the fixed endpoint later returns `ok: true`.
- Documentation allowlist: README, repository-management feature docs/index,
  ROADMAP, HANDOFF, wiki source, Pages source, and this manifest. Existing
  screenshots remain unchanged unless a complete off-screen capture passes.
- Tests: temporary path resolution/persistence, card copy/callback/localization,
  visible Close contract and responsive style, dialog descendant/nested/edge/
  prevented/stack wheel ownership, TypeScript, lint/format, diff checks, and
  production build only when the fixed Lowlevel MCP preflight is healthy.
- Remote: `https://github.com/Ding-Ding-Projects/desktop-material.git`.
- Publication: prohibited for this delegated task; commit only and hand the SHA
  to the parent agent for integration.
- Local result: 103/103 focused and existing-regression checks passed; root
  TypeScript no-emit, targeted ESLint, targeted Prettier, and `git diff --check`
  passed. The MCP preflight remained the only production/headless blocker, so
  no GUI launch, screenshot promotion, push, or merge occurred.
