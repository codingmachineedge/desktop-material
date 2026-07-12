# Desktop Material

**Desktop Material** is an independent Material Design 3 (M3 Expressive) remake of GitHub Desktop.
It is a fork of [desktop/desktop](https://github.com/desktop/desktop) (MIT) with the entire
application shell rebuilt around Material Design 3 — animated light/dark theming, dynamic type and
color tokens, and a browser-like, tabbed workspace — while keeping GitHub Desktop's complete Git
workflow intact underneath.

On top of that shell, Desktop Material has shipped a first wave of power-user features: multi-account
sign-in (including several identities per host), per-account repository tabs with rich title styling,
a Git-backed per-account settings history, and a non-modal dialog framework. A large further
expansion — automation, a GitHub Actions panel, a notification centre, regex-powered search, and
multi-clone — is planned and tracked in the project plan.

> **Status:** Desktop Material is in **active development**. Preview builds are published from the
> project's [GitHub Releases](https://github.com/codingmachineedge/desktop-material/releases).
> Feature-parity references come from [desktop-plus](https://github.com/severity1/desktop-plus)
> (MIT).

![Desktop Material Changes view with the MD3 shell](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-workspace-changes.png)

---

## Contents

| Page | What it covers |
| --- | --- |
| [User Guide](User-Guide) | Task-oriented walkthrough — sign-in, repository tabs, the MD3 shell, Settings history, and non-modal dialogs (shipped), plus a preview of the planned features. |
| [Automation](Automation) | **Planned.** Scheduled auto commit & push, auto pull, and merge-all — with the safety rules that will gate each one. |
| [Regex Guide](Regex-Guide) | **Planned.** How the search bars will work: filter chips, regex mode, and the regex builder. |
| [Developer Guide](Developer-Guide) | Architecture for contributors — Electron main/renderer, the store/dispatcher state flow, dugite, per-account profile repos, and the SCSS token system. |
| [Agent API](Agent-API) | **Planned.** The built-in MCP server and local HTTP/CLI fallback for AI-agent control. |

> The **Automation**, **Regex Guide**, and **Agent API** pages describe roadmap features that are
> **not yet implemented**. They are kept as living design docs; the User Guide is the accurate guide
> to what ships today.

---

## Shipped today

- **Material Design 3 Expressive shell** with animated light/dark theming and M3 color tokens: an
  app bar with an inline pill menu, a left icon navigation rail (Changes with a badge, History,
  Branches, Settings, account avatar), a floating pill toolbar with repository and branch chips and
  a sync pill, and floating radius-24 workspace cards with tri-state checkboxes, tonal status chips,
  token-based diff colors, and an inverse-surface undo banner.
- **Browser-like repository tabs** — per-account and bound to repos, with inline rename and
  per-tab title styling (bold/italic/underline, size, color, font family, alignment).
- **Multi-account** — multiple identities per host; each account carries its own tabs, repos, and
  settings.
- **Per-account settings in a local git repo** — every settings or tabs change auto-commits. Open
  **Edit → Settings History…** (`Ctrl+Alt+Z`) for a non-modal timeline with lazy diffs, undo, redo,
  and restore; each history action appends an audit commit.

![Live Settings history side sheet](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/settings-history-manager.png)

- **Non-modal dialogs** that float without blocking the app, drag by their headers, cascade, and
  come to front on focus. Preferences is an MD3 940×660 dialog with a left rail, an Active chip, and
  a pill footer; the repository and branch pickers are MD3 side sheets.

## On the roadmap (not yet implemented)

- **Notification centre** — a bell and side panel backed by its own local git repo; unread badge,
  mark read/unread, delete.
- **Regex search everywhere** — filter chips, a regex-mode toggle, and a full regex builder on every
  search bar.
- **Multi-clone** — select many repositories with checkboxes, filter by org chips, clone in parallel
  or one-by-one, and export/import repo lists (URLs only).
- **Automation** — one-click commit & push (Copilot writes the message), scheduled auto commit &
  push and auto pull, and merge-all branches/worktrees with Copilot conflict resolution.
- **GitHub Actions panel** — workflow runs, status/branch/event filters, re-run / re-run-failed, job
  steps, an in-app log viewer, and a `workflow_dispatch` dialog.
- **Built-in MCP server** (plus a local HTTP/CLI fallback) for AI-agent control.
- **Gitignore manager** with template auto-suggest, and **one-click Build & Run**.
- **GitHub organization support** and **dynamic UI scaling** (50–200% slider plus auto-fit).
- **Self-hosted GitLab sign-in** (endpoint + personal access token) and GitLab/Bitbucket
  integration.
- **Desktop-plus parity** — commit search, commit graph, multiple stashes, repo pinning/grouping,
  pull-all, and more.
