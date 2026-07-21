# UI design audit run manifest

- Run ID: `ui-design-audit-2026-07-20`
- Mode: `publish`
- Milestone: full Desktop Material UI parity audit against the supplied
  `Material Design UI Recreation (1).zip`
- Source archive SHA-256:
  `CDEC91773D202A076D8D700491F13EB065618DC986FA4F67D6909B02B61D8F86`
- Expected UI state: every reachable Desktop Material surface, dialog, sheet,
  toolbar, tab, menu, field, chip, list row, status, empty/error/loading state,
  theme, language mode, and responsive breakpoint is inventoried and compared
  with the interactive `Desktop Material v2.dc.html` prototype and its seven
  924 x 540 reference screenshots.
- Background-only interaction order: preflight the fixed Lowlevel MCP server;
  build the unpackaged app; create a disposable Git fixture and isolated user
  data; launch on one uniquely named Win32 headless desktop; capture the base
  workspace; traverse navigation, workspace states, repository/branch sheets,
  clone, settings, history manager, tab appearance, regex builder, automation,
  Actions, notifications, provider/account surfaces, language modes, light/dark
  themes, and representative responsive widths; close the exact audited HWND
  and remove only owned temporary paths.
- Disposable fixture root:
  `<system temporary folder>\desktop-material-ui-audit-20260720-9f64a2c1\fixture`
- Screenshot targets: native `924 x 540` reference size for direct comparisons,
  plus `1280 x 800`, `1440 x 900`, and narrow `760 x 720` coverage where the
  implementation exposes additional or responsive UI; light and dark themes.
- Documentation allowlist:
  `docs/verification/ui-design-audit-2026-07-20/**`,
  `docs/assets/screenshots/ui-design-audit-2026-07-20/**`,
  `docs/verification/README.md`, `docs/wiki/**`, `README.md`, `ROADMAP.md`, and
  `HANDOFF.md`.
- Declared verification: archive integrity/inventory; prototype route and
  control inventory; implementation surface inventory; production unpackaged
  build; deterministic headless UI traversal; original-resolution screenshot
  inspection; focused UI/style tests; Markdown/link checks; full diff and
  secret scan; remote commit, CI, Pages, release, and image verification.
- Remote: `https://github.com/Ding-Ding-Projects/desktop-material.git`
- Audit branch: `codex/ui-design-audit-20260720`
- Expected integration branch: `main`
- Starting commit: `6398c6b843be25008a32527b46a2c5d0f51db284`
- Initial audit-worktree state: clean and tracking `origin/main`.
- Initial default-worktree state: clean `main`, fast-forwarded to
  `origin/main` at the starting commit.
- Active GitHub account: `codingmachineedge`.
