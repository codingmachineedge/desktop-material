# User Guide

A task-oriented tour of Desktop Material's features. It assumes you already know the basic GitHub
Desktop workflow (clone, commit, push, branch, pull request) — that all still works. This guide
focuses on what Desktop Material adds on top.

**Feature guide**

The original M0–M18 baseline is published on `main`. The guided M19 functions in this guide are
implementation-complete in the current integration tree; final production/off-screen acceptance,
`main` promotion, and public evidence remain pending.

- [The shell](#the-shell)
- [Signing in](#signing-in)
- [Repository tabs](#repository-tabs)
- [Settings history](#settings-history)
- [Non-modal dialogs](#non-modal-dialogs)
- [Multi-clone](#multi-clone)
- [Guided Git and GitHub functions](#guided-git-and-github-functions)
- [One-click commit & push](#one-click-commit--push)
- [Notification centre](#notification-centre)
- [GitHub Actions panel](#github-actions-panel)
- [UI scaling](#ui-scaling)
- [Automation and merge-all](#automation-and-merge-all)
- [History search and graph](#history-search-and-graph)
- [Multiple stashes](#multiple-stashes)
- [Repository power tools](#repository-power-tools)
- [Multi-window workflows](#multi-window-workflows)
- [Agent access and CLI](#agent-access-and-cli)

---

## The shell

Desktop Material rebuilds the GitHub Desktop shell around Material Design 3. The chrome you work in
every day is made of a few pieces:

- **A left icon navigation rail** with entries for **Changes** (with a count badge), **History**,
  **Branches**, **Settings**, and your **account avatar** at the bottom.
- **A floating pill toolbar** across the top carrying a **repository chip** and a **branch chip**,
  plus a **sync pill** that shows an ahead badge when you have commits to push.
- **Browser-like repository tabs** (see [Repository tabs](#repository-tabs)) above the workspace.
- **Floating, radius-24 workspace cards** for Changes, the diff, History, and the empty/welcome
  states, with tri-state selection checkboxes, tonal status chips, token-based diff colors, and an
  inverse-surface undo banner.

The whole shell has an **animated light/dark theme**. Everything below tells you how to drive it.

![Desktop Material Changes view with the MD3 shell](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-workspace-changes.png)

---

## Signing in

Open **Settings → Accounts** to manage sign-ins. Desktop Material supports **multiple accounts at
once** and, unlike stock GitHub Desktop, **multiple identities on the same host** — for example two
GitHub.com accounts, or a work and a personal GitHub Enterprise identity side by side.

### Add a GitHub / GitHub Enterprise account

1. In **Settings → Accounts**, choose **Add account**.
2. Pick **GitHub.com** or **GitHub Enterprise** and complete the browser sign-in.
3. The new identity appears in the accounts list. You can add another on the same host without
   signing the first one out.

Each account keeps its **own tabs, repositories, and settings**. Switching the active account
switches the whole workspace to that identity's context.

### Add a self-hosted GitLab account

Desktop Material signs in to self-hosted GitLab with an **endpoint + personal access token (PAT)**
rather than a browser OAuth flow:

1. In **Settings → Accounts**, choose **Add account → GitLab (self-hosted)**.
2. Enter your instance **endpoint** (for example `https://gitlab.example.com`).
3. Paste a **personal access token** with the scopes you need (typically `api`, `read_repository`,
   `write_repository`).
4. Save. The GitLab identity now behaves like any other account — its repos are browsable and
   cloneable, and it can own its own tabs.

> Bitbucket and hosted GitLab integrations follow the same pattern. Tokens are stored with your
> platform credential store and are **never exposed** through the agent API.

![GitLab and Bitbucket account controls](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-provider-accounts.png)

### Browse organizations and publish into one

When a GitHub account belongs to organizations, the clone view loads the account's organization
list and adds filter chips. Select an organization to browse its complete repository list; if one
organization fails to load, the view reports that error without hiding the repositories already
available. The publish dialog uses the same organization list, so choose the owner before creating
the remote repository.

---

## Repository tabs

The workspace is **browser-like and tabbed**. Each tab is **bound to a repository and an account**,
so a tab always opens in the identity that owns it.

### Open a tab

- Click **+** on the tab strip to open a new tab, then pick a repository, **or**
- Middle-click / use the context menu on a repository in the list to open it in a new tab.

Tabs persist per account — reopening the app restores that account's tabs.

### Rename a tab

Double-click a tab's title (or use its context menu → **Rename**) to edit the label **inline**. The
rename is local to the tab and does not touch the repository name on disk or on the remote.

### Style a tab's title

Open a tab's context menu → **Text style** to open the styling popover (see
`tab-text-style.png`). Per tab you can set:

- **Weight** — bold on/off
- **Italic** and **underline**
- **Size**
- **Color**
- **Font family**
- **Alignment**

Styling is per tab, so you can make a production repo bold-red and a scratch repo muted-italic to
tell them apart at a glance.

> Tab layout and styling are part of your per-account settings, so every change **auto-commits** to
> that account's local settings repo. Open **Edit → Settings History…** or press `Ctrl+Alt+Z` if
> you ever need to inspect, undo, redo, or restore an earlier state.

---

## Settings history

Desktop Material records every per-account settings and repository-tab change as a commit in that
account's local settings repo. Open **Edit → Settings History…** or press `Ctrl+Alt+Z` to open the
non-modal right-side sheet; the workspace remains usable while it is open.

- Select a timeline entry to lazily load its changed files and diff.
- Choose **Undo last** to reverse the latest logical change, or **Redo** to replay an undone change.
- Use an entry's restore action to confirm and restore the complete settings state at that point.
- Choose **Load more** when the timeline contains more entries than the first page.
- Undo, redo, and restore all append audit commits, so the history itself is never rewritten.

![Live Settings history side sheet](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/settings-history-manager.png)

---

## Non-modal dialogs

Desktop Material's dialogs are **non-modal floating surfaces** — the main window stays fully
interactive while a dialog is open.

- **Drag a dialog by its header** to reposition it, and keep working in the app behind it.
- **Click or focus a dialog to bring it to front**; multiple open dialogs **cascade** so you can see
  them all.
- OS-native pickers (file open/save) stay native.

**Preferences** is the reference surface: an MD3 940×660 dialog with a left navigation rail, an
**Active** chip on the current section, and a pill footer. The **repository** and **branch** pickers
open as MD3 **side sheets** rather than blocking modals.

![Preferences as an MD3 dialog](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-settings.png)

![Repository navigation side sheet](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-repositories-sheet.png)

![Branch navigation and status side sheet](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-branches-sheet.png)

---

# Power workflows

## Multi-clone

The multi-clone window clones **many repositories in one pass**.

1. Open **Clone → Multiple repositories** (or the multi-clone entry in the repositories menu).
2. The list shows every repository available to the active account. Use the **search bar** — with
   filter chips, regex mode, and the regex builder (see the [Regex Guide](Regex-Guide)) — to narrow
   it down.
3. Use **org filter chips** to limit the list to a specific organization.
4. **Tick the checkboxes** for the repositories you want.
5. Choose the clone mode:
   - **Parallel** — clone all selected repos at once (fast; heavier on network/disk).
   - **One-by-one** — clone sequentially (gentler; easier to watch progress and spot failures).
6. Start the clone. Progress is shown per repository.

![Block-based regex builder with live repository-name testing](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/regex-builder.png)

### Export / import repo lists

- **Export** writes the selected repositories to a list file containing **URLs only** — no tokens,
  no credentials.
- **Import** loads such a list back into the checkbox selection, so you can re-clone the same set on
  another machine or share a curated set with a teammate.

---

## Guided Git and GitHub functions

Desktop Material turns useful Git, GitHub CLI, and GitHub API capabilities into **named,
task-specific workflows**. You choose an action, complete a focused form, review any destructive
or worktree-changing step, and receive the result in the app. The product UI is not a searchable
catalogue of raw commands or API endpoints.

### Shallow clone

Open **File → Clone repository… → URL** when you need only recent history:

1. Enter the repository URL and local path.
2. Enable **Shallow clone**.
3. Set **Commit depth** to the number of commits to fetch.
4. Review the summary, then choose **Clone**.

The form explains that it fetches the current branch and recursive submodules. If you need older
history later, use the named deepen-history action in **Repository tools**.

![Shallow clone with a commit-depth control](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-shallow-clone.png)

### Deepen shallow history

Open the **Tools** rail, find **History depth**, and choose **Check history status**. When Git reports
a shallow boundary, choose **Review bounded deepen** to fetch a specific number of older commits or
**Review full history** to remove the boundary deliberately. The review names the selected remote,
scope, and consequence before the bundled Git runtime starts. Progress is cancellable, and the app
rechecks the marker when the fetch completes.

The production fixture began with 3 visible commits and finished with all 15; the clean screenshot
below shows the final state. The raw verification receipt is retained in the P0 run manifest.

![Repository Tools showing full history after a verified deepen](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-history-deepening.png)

### Sparse checkout

Open **Repository → Manage sparse checkout…** to keep selected directories in a large worktree.
The side panel reports whether sparse checkout is enabled, explains cone mode, and accepts one
repository-relative directory per line. It normalizes slashes and rejects absolute paths,
traversal, option-like input, control characters, blanks, and duplicates before the review step.

Choose **Review enable** only after the valid-directory count matches your intent. The verified
disabled state below leaves all working-tree paths eligible to appear locally.

![Sparse-checkout directory editor in its disabled state](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-sparse-checkout.png)

These forms wrap labels and stack actions as space narrows. Page-level sideways scrolling is not
part of the workflow; only inherently spatial content such as code, diffs, and logs may scroll
horizontally when preserving columns is necessary.

### Create a pull request

Open **Branch → Create pull request** while the head branch is checked out:

1. Confirm the exact target repository and signed-in account.
2. Choose the base branch; the current local branch is the fixed head.
3. Enter a title and optional Markdown description, and choose whether to create a draft.
4. Select **Review pull request** and verify repository, account, base/head, title, body, and draft
   state.
5. Select **Create pull request**. The success receipt offers **Done** and **Open on GitHub**.

The app rejects ambiguous remote syntax and routes account problems to repository settings. The
workflow does not expose `gh pr create`, editable arguments, or a raw REST request.

![Native pull-request creation success with wrapped content](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-create-pull-request.png)

### Inspect effective branch rules

Open **Repository → Inspect branch rules…**. The non-modal sheet combines classic protection and
rulesets for the checked-out branch into plain-language sections for reviews, checks, deployments,
merge queue, verified signatures, linear history, update/delete/force policy, bypass context, and
source rulesets. Use **Refresh** to load the same exact branch again.

If no matching account is signed in, **Open account settings** is shown. If more than one account
matches a legacy repository, **Open repository settings** opens the real repository-account picker;
saving one records its stable `endpoint#id` identity. Unknown or partial policy evidence is stated
instead of guessed.

![Effective branch rules with long checks and policy details wrapped](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-effective-branch-rules.png)

---

## One-click commit & push

For quick, low-ceremony commits, use **one-click commit & push**:

1. Stage the changes you want (or commit everything shown in **Changes**).
2. Press the **one-click commit & push** action.
3. **Copilot writes the commit message** from your staged diff.
4. Desktop Material commits and pushes in a single step.

This is a convenience path built on the normal commit machinery — you can always fall back to
writing the message yourself in the **Changes** view. For scheduled, unattended commits and pushes,
see [Automation](Automation).

---

## Notification centre

The **bell** in the app chrome opens the **notification centre** side panel. Its two named views
keep local app events separate from GitHub inbox items:

- **Local** is backed by its own git repo. An unread badge shows how many notifications you have not
  seen; you can mark items read/unread or delete them.
- **GitHub** uses an explicit account selector with **All**, **Unread**, and **Participating only**
  controls. When no account is signed in, the complete **No signed-in accounts** state remains
  visible and tells you to sign in before refreshing the inbox.

The account, filters, and empty state are part of the guided inbox workflow rather than a `gh`
command or GitHub API search screen.

![GitHub notification view with the no-signed-in-account state](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-github-notifications.png)

---

## GitHub Actions panel

The **Actions** panel brings CI into the app:

- **Workflow runs** for the current repository, newest first. When more are available, choose
  **Load more runs**; already loaded pages remain visible across background polling and **Refresh**.
- **Filters** by **workflow**, **status**, **branch**, and **event**.
- **Re-run** a whole run or **re-run only the failed jobs**.
- Drill into a run, choose the **current or a historical attempt**, and use **Load more jobs** to
  append the next bounded 50-job page. A failed later page keeps the jobs already loaded and offers
  the same named retry. Every loaded job retains its exact **View logs** and **Re-run job** actions.
- Open the **in-app log viewer** to read output without leaving Desktop Material. Search the loaded
  log to isolate a command, warning, or error; only the spatial log body may pan horizontally.
- Inspect **pending deployment environments** and prior review history. Select only environments
  for which the signed-in account is eligible, enter a required bounded comment, review the exact
  approve/reject intent, and confirm. Locked environments keep their explanation visible.
- When GitHub marks a first-time fork run as eligible, use the separate **Approve fork run**
  confirmation. It is never inferred from a deployment decision.
- Trigger manual workflows with the **`workflow_dispatch` dialog** — pick the workflow, ref, and
  inputs, and dispatch.
- Select a run artifact to review its name, size, creation/expiry, workflow source, and GitHub digest.
  Choose **Load more artifacts** to append the next bounded page. A failed later page keeps the
  cards you already loaded and lets you retry that same page.
  **Download archive** opens the native save picker; after transfer, Desktop computes SHA-256 locally,
  reports whether it matches, and offers **Show in folder**.
- **Check attestations** reports whether an attestation record is present. Presence is not presented as
  cryptographic verification: signer, signature, timestamp, source identity, and policy still need a
  future verification function.

![Actions artifact with digest match and attestation-presence context](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-artifacts.png)

![Actions cache manager with usage totals, refs, wrapped keys, and delete controls](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-cache-manager.png)

![Headless Actions run pagination with the page-two sentinel retained](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-pagination-headless.png)

![Headless Actions artifact inventory with bounded pagination](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-artifacts-headless.png)

![Headless Actions sentinel evidence with wrapped content and no clipping](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-sentinel-headless.png)

![Actions workflow-run pagination with 51 filtered runs retained after Refresh](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-pagination.png)

![Actions artifact page two with a deliberately long wrapping sentinel name](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-artifact-page-two.png)

![Attempt-aware Actions job pagination with an exact recovered page-two job](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-jobs-pagination.png)

![Pending Actions deployment environments with long reviewer and protection details](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-pending-deployments.png)

The production gates exercised 50→51 filtered runs, 30→31 artifacts, and current/historical 50→51
job pages, including a deliberate later-page 503→200 retry. Exact job log/re-run, deployment review,
and fork approval mutations ran only against the isolated provider. At regular and short windows
plus a requested 200% base with auto-fit, document and body widths matched and the measured Actions
surfaces had no clipping, overlap, outside controls, oversized text, or page-level sideways
scrolling. Modal focus and scrim ownership were also contained. These are named app controls; there
is no `gh` command, API-path, or GraphQL editor.

Job-log downloads follow GitHub's signed redirect automatically. Desktop Material's main-process
request filter tracks the original request and removes authentication, authorization, and cookie
headers before any cross-origin hop. Download errors also omit signed URLs and query strings. The
live Windows x64 proof below shows the resulting searchable, collapsible log viewer.

![Windows x64 GitHub Actions job log loaded securely in the searchable in-app viewer](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-job-log.png)

---

## UI scaling

Desktop Material scales its whole interface independently of the OS:

- Open the **scaling slider** and set anywhere from **50% to 200%**.
- Or choose **auto-fit to window**, which picks a scale that fits the current window size.
- Auto-fit treats your slider value as the requested maximum. If the window is too small, it caps
  the effective scale instead of multiplying the requested scale again. At the supported minimum
  window size, 200% auto-fits below that maximum so the title bar, navigation rail, Appearance
  cards, value, and footer remain visible without horizontal clipping. The latest P0 gate measured
  94%; the older screenshot below records a 96% viewport.

Combined with the animated light/dark theme, this lets you tune the workspace for a laptop panel, a
4K monitor, or a shared screen without touching system display settings.

The 1450×997 responsive regression check keeps the toolbar and complete Changes card inside the
viewport—including filter, changed-file, summary, description, settings, and commit controls—with
no page-level horizontal overflow.

The Pages gallery also has a dedicated accessibility/clipping check at 960×660 and 390×844. It
passes with zero axe violations, matching document/body widths, and no horizontally outside
elements.

![Requested 200 percent UI scale auto-fitted to 96 percent at the minimum window size](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-scale-200-autofit.png)

![Responsive regression proof at 1450 by 997 with toolbar and Changes controls fully contained and no horizontal overflow](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-responsive-overflow-fixed.png)

---

## Automation and merge-all

Open **Settings → Automation** to configure the two background schedules:

1. Turn on **Automatically commit and push** and/or **Automatically pull**.
2. Pick an interval for each enabled operation.
3. Under **Account overrides**, let an identity inherit the global value or override its enabled
   state and interval.
4. For one repository, open **Repository settings → Automation** and inherit or override the two
   schedules again.

Automation targets the selected repository only. Before each run it checks repository state,
upstream availability, conflicts, in-progress Git operations, and draft commit text. An unsafe
repository is skipped rather than overwritten. See [Automation](Automation) for the complete guard
table.

The Branches and Worktrees views also expose **Merge all branches** and **Merge all worktrees**.
Confirm the target, follow each row's progress, and review any skipped or failed target. When
Copilot conflict assistance is available, it participates inside the same guarded workflow.

![Automation preferences with global and account overrides](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-automation.png)

![Merge all branches with per-target progress](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-branch-merge-all.png)

---

## History search and graph

Open **History** and use the search field to match a commit's title, message, tag, or hash. The
results retain the normal commit detail view. Toggle **Show commit graph** to add ancestry lanes and
merge edges beside the unfiltered list; turn the graph off when a compact list is more useful.

![History search and commit graph](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-history-power-tools.png)

---

## Multiple stashes

Create a stash from the Changes workflow whenever work must be set aside. Desktop Material keeps
all stash entries instead of treating only the newest one as available:

1. Expand **Stashes** in Changes and select an entry by its label.
2. Inspect that stash's file list and individual diffs before acting.
3. Choose apply or pop for the exact entry, or review rename, create-branch, and delete actions.
4. If Git completes only part of an operation, keep the reported state visible and inspect the
   repository before retrying instead of assuming an all-or-nothing result.

Switching branches can still offer to stash local work, and the resulting entry appears in the same
list.

![Repository-wide stash manager with an exact selected entry](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-stash-manager.png)

---

## Repository power tools

- Open the repositories side sheet and choose **Pull all** to fetch/pull every eligible repository;
  review the per-repository result instead of assuming the batch succeeded as one unit. If the
  normal pull ends in an HTTPS authentication or repository-not-found ambiguity, Desktop Material
  can try the remaining token-bearing signed-in accounts whose HTML origin exactly matches that
  remote. A repository-bound identity is preferred within the otherwise stable account order.
- Pin important repositories from their context menu, hide the automatically maintained Recent
  group if desired, and use grouping to keep large repository lists manageable.
- Use branch presets/default-branch controls when creating or switching branches; pin, hide, solo,
  and restore branch visibility from branch context and filtered-state controls.
- Set a repository-specific external editor when the global editor is not appropriate.
- Manage every named remote in **Repository settings → Remote**, and administer add/move/rename/
  lock/repair/remove/prune worktree operations from the Worktrees view.
- Use the `.gitignore` manager and one-click Build & Run for project-aware cleanup and execution. Build & Run discovers common nested projects across Node, Deno, Rust, Go, .NET, Python, JVM, PHP, Ruby, Swift, Dart/Flutter, Elixir, Scala, Haskell, Zig, Make, and CMake; choose a profile by its displayed project folder when several projects share a language or toolchain.

SSH and non-authentication failures never start account fallback. The selected stable account key
stays in the app's internal trampoline map; its selector field is removed from the Git options
before spawn and never enters child, hook, Git LFS, or log environments. A missing same-origin
selection fails closed, while credential requests from cross-origin submodules retain normal
account resolution. Successful fallback uses the neutral result **Pull completed using another
signed-in account.**

![Pull all completing with another signed-in account without exposing its identity](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-pull-all-account-fallback.png)

![Named Repository Tools administration hub](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-repository-tools.png)

![Reviewed named-remote administration](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-remote-manager.png)

![Reviewed gitignore template catalogue](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-gitignore-manager.png)

---

## Multi-window workflows

Right-click a repository and choose **Open in new window**. Worktree context menus offer **Open
Worktree in New Window** as well. Each window maintains its own selected repository and repository
tabs, and native/menu/CLI actions route to the correct window. Closing and reopening the app
restores the persisted window tab state.

![Open a repository or worktree in another window](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-multi-window-menu.png)

---

## Agent access and CLI

Open **Settings → Agent access** and turn on **Enable local agent server**. The panel shows the
random loopback address, MCP URL, and bearer token; reveal/copy the token only for a trusted local
client, and use **Regenerate token** to disconnect existing clients immediately.

- HTTP-capable MCP clients connect to the displayed `/mcp` URL with an
  `Authorization: Bearer …` header.
- Stdio-only clients run `node script/agent/mcp-stdio-proxy.js`.
- Scripts can start with `node script/agent/desktop-agent.js info` and use the fallback command-line
  client for the same bounded command contract.

The contract covers account/repository/tab discovery, repository status, single/batch clone,
commit, fetch/pull/push, branch creation/merge, tab selection, automation status/runs, and Actions
workflow dispatch. It never returns provider credentials. See [Agent API](Agent-API) for command and
security details.

![Agent access connection and token controls](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-agent-access.png)

---

**Next:** [Automation](Automation) · [Regex Guide](Regex-Guide) · [Developer Guide](Developer-Guide)
