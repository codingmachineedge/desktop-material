# Desktop Material

**Desktop Material** is an independent Material Design 3 (M3 Expressive) remake of GitHub Desktop.
It is a fork of [desktop/desktop](https://github.com/desktop/desktop) (MIT) with the entire
application shell rebuilt around Material Design 3 — animated light/dark theming, dynamic type and
color tokens, and a browser-like, tabbed workspace — while keeping GitHub Desktop's complete Git
workflow intact underneath.

On top of that shell, Desktop Material ships multi-provider accounts and organizations, automation,
GitHub Actions and logs, agent access, searchable graph History, multiple stashes, pull-all,
multi-window workflows, per-account repository tabs, Git-backed settings and notifications, and a
non-modal dialog framework. The active parity roadmap turns audited Git, `gh`, REST, and GraphQL
capabilities into named app functions rather than a searchable command or endpoint catalogue.

> **Status:** Desktop Material is in **active development**. Preview builds are published from the
> project's [GitHub Releases](https://github.com/codingmachineedge/desktop-material/releases).
> Feature-parity references come from [desktop-plus](https://github.com/severity1/desktop-plus)
> (MIT). The current P0 function wave passed its exact off-screen production UI gate at
> `9e946fd527` on `mega-feature-update` and promotes through the normal reviewed `main` path.

![Desktop Material Changes view with the MD3 shell](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-workspace-changes.png)

---

## Contents

| Page | What it covers |
| --- | --- |
| [User Guide](User-Guide) | Task-oriented walkthrough for accounts, guided Git/GitHub functions, organizations, tabs, automation, Actions, History, stashes, pull-all, multi-window, and the MD3 shell. |
| [Automation](Automation) | Scheduled commit & push and pull, layered overrides, safety guards, and merge-all branches/worktrees. |
| [Regex Guide](Regex-Guide) | Filter chips, substring/regex modes, the regex builder, and the search surfaces that use them. |
| [Developer Guide](Developer-Guide) | Architecture for contributors — Electron windows, store/dispatcher flow, dugite, profile repos, agent server, CLI routing, and SCSS tokens. |
| [Agent API](Agent-API) | Shipped MCP, local REST, stdio proxy, and CLI access for safe AI-agent control. |
| [Living parity roadmap](https://github.com/codingmachineedge/desktop-material/blob/mega-feature-update/README.md#roadmaps) | Current named-function delivery waves, production UI gates, and the no-raw-command/API-browser product contract. |

---

## Available and production-verified

- **Material Design 3 Expressive shell** with animated light/dark theming and M3 color tokens: an
  app bar with an inline pill menu, a left icon navigation rail (Changes with a badge, History,
  Branches, Settings, account avatar), a floating pill toolbar with repository and branch chips and
  a sync pill, and floating radius-24 workspace cards with tri-state checkboxes, tonal status chips,
  token-based diff colors, and an inverse-surface undo banner.
- **Browser-like repository tabs** — per-account and bound to repos, with inline rename and
  per-tab title styling (bold/italic/underline, size, color, font family, alignment).
- **Multi-account** — multiple identities per host; each account carries its own tabs, repos, and
  settings. GitHub organizations expose their complete repository lists and can be selected when
  publishing. GitLab endpoints use PAT authentication and Bitbucket uses app passwords; both
  providers can browse and clone repositories without exposing credentials to the renderer or
  agent API.
- **Per-account settings in a local git repo** — every settings or tabs change auto-commits. Open
  **Edit → Settings History…** (`Ctrl+Alt+Z`) for a non-modal timeline with lazy diffs, undo, redo,
  and restore; each history action appends an audit commit.

![Live Settings history side sheet](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/settings-history-manager.png)

- **Non-modal dialogs** that float without blocking the app, drag by their headers, cascade, and
  come to front on focus. Preferences is an MD3 940×660 dialog with a left rail, an Active chip, and
  a pill footer; the repository and branch pickers are MD3 side sheets.

### Automation, CI, and agent control

- **Automation** — schedule guarded commit-and-push and pull at the global level, override either
  setting per account or repository, run commit-and-push immediately, and merge all branches or
  worktrees with per-target progress and Copilot-assisted conflict handling.
- **GitHub Actions** — filter runs by workflow, branch, event, or status; load later run pages while
  preserving them across polling/Refresh; re-run a complete run or failed jobs; switch current or
  historical attempts; load bounded job pages; search exact job logs; review pending environments;
  approve or reject eligible deployments; approve an eligible fork run; dispatch a workflow; and
  load later artifact pages before a native download with local digest comparison and explicit
  attestation-presence context.
- **Agent access** — opt in from Settings to start a token-gated MCP/REST server on a random
  loopback-only port. A stdio proxy and command-line client expose the same bounded commands for
  repositories, tabs, Git operations, automation, and workflow dispatch.

### Verified native Git and GitHub functions

- **Deepen shallow history** — Repository Tools detects the shallow boundary, reviews a bounded or
  complete deepen, runs the bundled Git recipe, and rechecks the repository state. The production
  fixture expanded from 3 visible commits to all 15.
- **Create a pull request** — choose the exact repository, account, base, and current head; compose
  the title and Markdown body; choose draft state; review; and submit without a raw command or API
  editor.
- **Actions artifacts** — select a workflow run and artifact, review size/expiry/source context,
  save through the native file picker, compare the downloaded SHA-256 with GitHub's digest, reveal
  the file, and distinguish attestation presence from cryptographic verification.
- **Actions pagination** — use purpose-built **Load more runs** and **Load more artifacts** controls.
  Provider-side filters, exact-account routing, cancellation, retained-page retry, and shifted-page
  de-duplication stay behind the workflow; no command, REST path, or GraphQL editor is exposed.
- **Actions run inspector** — choose the latest or a historical attempt, load 50-job pages through a
  named retry, open or re-run the exact loaded job, inspect pending environments and review history,
  submit a bounded deployment decision, and confirm eligible fork approval. Locked environments
  explain why they cannot be selected instead of exposing an API mutation editor.
- **Effective branch rules** — inspect reviews, checks, deployments, merge queue, signatures,
  history, update/delete/force policy, bypass context, and source rulesets. Signed-out and ambiguous
  repository-account states route to the relevant settings screen.

![Final full-history state after a verified deepen](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-history-deepening.png)

![Native pull-request creation success](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-create-pull-request.png)

![Actions artifact download and digest evidence](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-artifacts.png)

![Actions run page two retained after Refresh](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-pagination.png)

![Actions artifact page-two sentinel with wrapped text](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-artifact-page-two.png)

![Attempt-aware Actions job pagination with the recovered page-two job selected](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-jobs-pagination.png)

![Pending Actions deployment environments with long reviewer and protection details](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-pending-deployments.png)

![Effective branch rules inspector](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-effective-branch-rules.png)

![Automation preferences with global and account overrides](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-automation.png)

![Agent access with loopback and bearer-token controls](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-agent-access.png)

### History, stashes, repositories, and windows

- **History power tools** — search commits by title, message, tag, or hash and toggle a commit graph
  that renders ancestry lanes beside the filtered history.
- **Multiple stashes** — create and keep multiple entries, select one to inspect its files and diffs,
  then restore or discard that exact stash.
- **Repository power tools** — pin and group repositories, pull all with a per-repository result,
  use branch presets and default-branch controls, set a repository-specific editor, shallow-clone
  with a commit-depth control, manage cone-mode sparse checkout, and multi-clone in parallel or
  sequence with URL-only import/export. These are named, validated workflows rather than a raw Git,
  `gh`, or API-command catalogue.
- **Multi-window workflows** — open a repository or worktree in a separate window; each window keeps
  its own selected repository and persisted tab state while commands route to the correct window.
- **Notification centre** — a Git-backed Local view plus an account-aware GitHub inbox with
  All/Unread and participating-only filters, including a complete no-signed-in-account state.
- **Clipping-safe scaling** — choose 50–200% UI scaling; auto-fit caps the effective scale when a
  small window cannot contain the requested size. The latest Actions run-inspector gate reached a
  requested 200% base through five actual menu actions and safely auto-fit to 96% while preserving
  every title-bar, navigation, attempt, job, deployment, confirmation, and log control.
- **No page-level sideways scrolling** — task forms wrap text and stack controls when space narrows.
  Horizontal scrolling is reserved for spatial content such as code, diffs, and logs when needed.

![History search and commit ancestry graph](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-history-power-tools.png)

![Provider accounts for GitLab and Bitbucket](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-provider-accounts.png)

![Open repositories and worktrees in another window](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-multi-window-menu.png)

![Requested 200 percent UI scale auto-fitted without clipping](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-scale-200-autofit.png)

![Guided shallow clone with commit depth](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-shallow-clone.png)

![Guided sparse-checkout directory editor](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-sparse-checkout.png)

![Account-aware GitHub notifications](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-github-notifications.png)
