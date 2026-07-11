# Desktop Material

**Desktop Material** is an independent Material Design 3 (M3 Expressive) remake of GitHub Desktop.
It is a fork of [desktop/desktop](https://github.com/desktop/desktop) (MIT) with the entire
application shell rebuilt around Material Design 3 — animated light/dark theming, dynamic type and
color tokens, and a browser-like, tabbed workspace — while keeping GitHub Desktop's complete Git
workflow intact underneath.

On top of that shell, Desktop Material adds a large expansion of power-user features: multi-account
sign-in (including several identities per host), per-account repository tabs with rich title
styling, multi-repository cloning, automation (scheduled commit/push and pull, merge-all with
Copilot conflict resolution), a GitHub Actions panel, a notification centre, and regex-powered
search on every search bar.

> **Status:** Desktop Material is in **active development**. It is not yet released — there are no
> download links or version numbers to publish. Feature-parity references come from
> [desktop-plus](https://github.com/severity1/desktop-plus) (MIT).

---

## Contents

| Page | What it covers |
| --- | --- |
| [User Guide](User-Guide) | Task-oriented walkthrough of the headline features — sign-in, tabs, multi-clone, one-click commit & push, notifications, Actions, UI scaling. |
| [Automation](Automation) | Scheduled auto commit & push, auto pull, and merge-all — with the exact safety rules that gate each one. |
| [Regex Guide](Regex-Guide) | How the search bars work: filter chips, regex mode, and the regex builder. Mirrors the in-app help. |
| [Developer Guide](Developer-Guide) | Architecture for contributors — Electron main/renderer, the store/dispatcher state flow, dugite, per-account profile repos, the agent server, and the SCSS token system. |
| [Agent API](Agent-API) | The built-in MCP server and local HTTP/CLI fallback for AI-agent control — what it exposes and how it is secured. |

---

## Feature highlights

- **Material Design 3 Expressive shell** with animated light/dark theming and M3 color tokens.
- **Browser-like repository tabs** — per-account and bound to repos, with inline rename and
  per-tab title styling (bold/italic/underline, size, color, font family, alignment).
- **Multi-account** — multiple identities per host; each account carries its own tabs, repos, and
  settings.
- **Per-account settings in a local git repo** — every settings or tabs change auto-commits, with a
  full undo history manager (undo / redo / restore to any commit).
- **Multi-clone** — select many repositories with checkboxes, filter by org chips, clone in parallel
  or one-by-one, and export/import repo lists (URLs only).
- **Regex search everywhere** — filter chips, a regex-mode toggle, and a full regex builder on every
  search bar.
- **One-click commit & push** — Copilot writes the commit message.
- **Automation** — scheduled auto commit & push and auto pull, with a global default and per-repo
  overrides.
- **Merge-all branches/worktrees** into the default branch with Copilot conflict resolution, then
  delete merged branches and push.
- **GitHub Actions panel** — workflow runs, status/branch/event filters, re-run / re-run-failed, job
  steps, an in-app log viewer, and a `workflow_dispatch` dialog.
- **Notification centre** — a bell and side panel backed by its own local git repo; unread badge,
  mark read/unread, delete.
- **GitHub organization support** — browse and clone full org repo lists, and publish into an org.
- **Dynamic UI scaling** — a 50–200% slider plus auto-fit to window.
- **Non-modal dialogs** that float without blocking the app and drag by their headers.
- **Built-in MCP server** (plus a local HTTP/CLI fallback) for AI-agent control.
- **Self-hosted GitLab sign-in** (endpoint + personal access token) and GitLab/Bitbucket
  integration.
- **Desktop-plus parity** — commit search, commit graph, multiple stashes, repo pinning/grouping,
  pull-all, and more.
