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
- [Clone account fallback](#clone-account-fallback)
- [Guided Git, GitHub, and provider functions](#guided-git-github-and-provider-functions)
- [Guided Feature Gallery](Feature-Gallery)
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

### Export / import repo lists

- **Export** writes the selected repositories to a list file containing **URLs only** — no tokens,
  no credentials.
- **Import** loads such a list back into the checkbox selection, so you can re-clone the same set on
  another machine or share a curated set with a teammate.

---

## Clone account fallback

When you clone from a hosted repository list, Desktop Material keeps the selected signed-in account
with the clone request. For a generic HTTPS URL, it prefers the token-bearing signed-in account that
matches the repository, or the first eligible signed-in account when repository lookup is
inconclusive. Eligibility always requires the remote's exact HTTPS origin. When an eligible account
exists, Git receives credentials through the app without opening a manual credential prompt.

If the first attempt ends in HTTPS authentication failure or repository-not-found ambiguity,
Desktop Material can try the remaining token-bearing accounts for that same origin in stable order.
SSH failures and non-authentication errors stop immediately. Tokenless accounts are ignored, and a
selected account that is missing or no longer has credentials cannot silently supply another
identity inside the credential request. A different-origin submodule keeps its normal credential
resolution, and its failure cannot unlock account fallback for the repository being cloned.

The account that actually completes the clone is retained with the new repository for later
operations. Account selection remains inside the app, is removed when the operation ends, and is
never written to Git child environments or logs.

![Desktop Material workspace after a generic HTTPS repository clone completed through exact-origin signed-in account fallback without displaying a credential prompt](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-clone-account-fallback.png)

---

## Guided Git, GitHub, and provider functions

Desktop Material turns useful Git, GitHub CLI, and GitHub API capabilities into **named,
task-specific workflows**. You choose an action, complete a focused form, review any destructive
or worktree-changing step, and receive the result in the app. The product UI is not a searchable
catalogue of raw commands or API endpoints.

The complete guided implementation described here still needs the final exact-tree production and
off-screen acceptance gate before publication; earlier screenshots prove only the historical trees
named in their evidence manifests.

The [Guided Feature Gallery](Feature-Gallery) is the synthetic-data visual manifest for the 14
guided views. Its presence does not pre-claim the remaining publication gates.

### Shallow clone

Open **File → Clone repository… → URL** when you need only recent history:

1. Enter the repository URL and local path.
2. Enable **Shallow clone**.
3. Set **Commit depth** to the number of commits to fetch.
4. Review the summary, then choose **Clone**.

The form explains that it fetches the current branch and recursive submodules. If you need older
history later, use the named deepen-history action in **Repository tools**.

![Reviewed shallow clone with a bounded commit depth](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-shallow-clone-safe.png)

![Deepen-history result without displaying the signed-in account used](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-history-deepen.png)

### Sparse checkout

Open **Repository → Manage sparse checkout…** to keep selected directories in a large worktree.
The side panel reports whether sparse checkout is enabled, explains cone mode, and accepts one
repository-relative directory per line. It normalizes slashes and rejects absolute paths,
traversal, option-like input, control characters, blanks, and duplicates before the review step.

Choose **Review enable** only after the valid-directory count matches your intent. The disabled
state leaves all working-tree paths eligible to appear locally.

These forms wrap labels and stack actions as space narrows. Page-level sideways scrolling is not
part of the workflow; only inherently spatial content such as code, diffs, and logs may scroll
horizontally when preserving columns is necessary.

![Validated cone-mode sparse-checkout review](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-sparse-checkout-safe.png)

### Repository Tools administration

Open **Repository → Repository tools…** for the reviewed administration workspaces:

- **Patch series** exports a bounded commit range and imports an inspected series without exposing
  a free-form shell.
- **Rewrite local commits** builds an explicit reorder/reword/squash/fixup/drop plan, previews the
  resulting sequence, and revalidates the reviewed HEAD before starting.
- **Signing** inspects effective commit/tag signing settings and applies a reviewed configuration;
  **Git LFS** inspects availability, attributes, tracked patterns, and guarded lifecycle operations.
- **Guided bisect** reviews exact good/bad commits, resumes an existing session, records good/bad/
  skip verdicts for the displayed commit, and resets safely when finished.
- **Repository hooks** reports the effective hooks directory and known client hooks without showing
  script contents or absolute paths. Create-only and disable/restore actions revalidate the exact
  reviewed file and configuration before mutation.
- **Provider triage** binds the selected account and repository to bounded Issue and pull-request
  summaries for GitHub, GitLab, or Bitbucket. It exposes safe provider links and explicit partial,
  capped, unsupported, and error states; Bitbucket Issues are explicitly unsupported.

![Named Repository Tools administration hub](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-repository-tools.png)

![Account- and repository-bound provider triage with bounded results](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-provider-triage.png)

### Branch, worktree, stash, remote, and conflict controls

- Use a branch context menu to **pin**, **hide**, or **solo** a branch; the filtered-state controls
  make restoring hidden branches explicit. Merge previews show exact paths from `merge-tree` before
  the worktree is changed.
- The Worktrees view supports reviewed add, lock/unlock, move, rename, repair, remove, and prune
  operations, while preserving the existing open-in-new-window workflow.
- The repository-wide Stash Manager can create, inspect, apply, pop, rename, branch from, or delete
  the exact selected stash and keeps partial-success details visible.
- **Repository settings → Remote** manages every named remote through reviewed add, rename, URL/
  push-URL update, default selection, and guarded removal operations.

![Repository-wide stash manager with an exact selected entry](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-stash-manager.png)

![Reviewed named-remote administration](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-remote-manager.png)

### GitHub lifecycle workspaces

- Pull-request creation loads repository templates and available reviewers, assignees, and labels.
  The lifecycle dialog then inspects exact details, updates metadata, submits a review, closes or
  reopens, and merges only the reviewed pull request and head state.
- The Actions view pages artifacts beyond the first result set, downloads through bounded
  credential-stripping redirects, records a local digest and attestation-presence context, and
  shows the effective rules for the current branch.
- **Releases** pages repository releases and assets, reviews create/update/delete operations, and
  uses bounded cancelable upload/download transfers that present filenames rather than local paths.
- **Issues** supports bounded browse/search/filter/sort/pagination, exact detail and comments,
  metadata edits, new comments, and close/reopen operations tied to the reviewed issue snapshot.

![Native pull-request creation with bounded metadata](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-native-pull-request.png)

![Bounded Actions artifact download with a locally computed digest](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-artifact-download.png)

![Repository-bound Releases and assets workspace](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-github-releases.png)

![Issue detail, comments, and reviewed lifecycle controls](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-github-issues.png)

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

- **Workflow runs** for the current repository, newest first.
- **Filters** by **workflow**, **status**, **branch**, and **event**.
- **Re-run** a whole run or **re-run only the failed jobs**.
- Drill into a run to see its **jobs and steps**, and open the **in-app log viewer** to read output
  without leaving Desktop Material. Search the loaded log to isolate a command, warning, or error.
- Page through the run's **artifacts**, review size/expiry/attestation-presence context, and download
  an exact artifact through the bounded transfer path with a local digest.
- Inspect the **effective branch rules** applied to the current branch, including partial or
  unavailable provider states without treating them as an empty rule set.
- Trigger manual workflows with the **`workflow_dispatch` dialog** — pick the workflow, ref, and
  inputs, and dispatch.

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
  window size, 200% auto-fits to 96% so the title bar, navigation rail, Appearance cards, value,
  and footer remain visible without horizontal clipping.

Combined with the animated light/dark theme, this lets you tune the workspace for a laptop panel, a
4K monitor, or a shared screen without touching system display settings.

The 1450×997 responsive regression check keeps the toolbar and complete Changes card inside the
viewport—including filter, changed-file, summary, description, settings, and commit controls—with
no page-level horizontal overflow.

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
- Use the `.gitignore` manager and one-click Build & Run for project-aware cleanup and execution.

SSH and non-authentication failures never start account fallback. The selected stable account key
stays in the app's internal trampoline map; its selector field is removed from the Git options
before spawn and never enters child, hook, Git LFS, or log environments. A missing same-origin
selection fails closed, while credential requests from cross-origin submodules retain normal
account resolution. Successful fallback uses the neutral result **Pull completed using another
signed-in account.**

![Pull all completing with another signed-in account without exposing its identity](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-pull-all-account-fallback.png)

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
