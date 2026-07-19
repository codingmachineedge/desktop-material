# Repository CI status verification manifest

- Mode: `publish`
- Milestone: show a compact CI status logo on the selected repository page for
  the checked-out branch, including branches without a pull request, plus a
  top-edge app-update download bar with a user-selected color.
- Expected UI: the branch control in the repository toolbar shows a small,
  state-coloured CI icon when GitHub has checks for the current commit; hovering
  it identifies the CI result. While an update is downloading, a thin
  indeterminate bar appears along the workspace's top edge; Settings →
  Appearance controls its allowlisted palette.
- Interactions: open a GitHub-backed fixture repository with a valid checked-out
  branch and verify the toolbar remains usable at compact and regular widths.
- Fixture: disposable local clone and isolated user-data directory on the
  off-screen Headless Desktop.
- Screenshot target:
  `docs/assets/screenshots/material-repository-ci-status.png`.
- Documentation allowlist: this manifest, `README.md`,
  `docs/wiki/User-Guide.md`, and `HANDOFF.md`.
- Tests: focused CI status and toolbar tests, repository lint,
  `git diff --check`, exact MCP production build, clean/pushed `main`, and
  exact-SHA workflows.
- Remote/branch: `origin`, `main`.
- Initial baseline: clean `main` at
  `a928ff9c34e79747eec969efefdf35e42143aa95`; preserve all unrelated state.
