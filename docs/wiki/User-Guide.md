# User Guide

![The everyday repository loop from inspecting changes through safe synchronization](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/diagrams/workspace-loop.svg)

The safest rhythm is simple: inspect, stage, commit, then synchronize. The tools below add power without changing that basic loop.

![A conceptual safe Git workflow from working files to reviewed cloud synchronization](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/concepts/safe-git-workflow.png)

A task-oriented tour of Desktop Material's features. It assumes you already know the basic GitHub
Desktop workflow (clone, commit, push, branch, pull request) — that all still works. This guide
focuses on what Desktop Material adds on top.

> Desktop Material is supported on Windows only. Use the published Windows x64
> installer; macOS and Linux application packages are not produced or
> supported.

**Feature guide**

The complete M0–M21 roadmap is published on `main`. M22 keeps its separate
visual-publication acceptance, and this guide includes the M23 Ollama model
manager. It also covers the verified adaptive maintenance set and M21 workflow
closure: appearance and profile app identity, favorite/portable tabs, Material
entry surfaces, guarded tab management, workflow-run
cancellation, reviewed rebase, repository-account propagation, bounded OAuth scopes, compact
surface corrections, temporary submodule navigation, and its explicit language and Back-control
appearance modes, plus the repository-contextual GitHub API Explorer. Exact build, off-screen UI,
publication, and cleanup receipts are recorded in the repository's `HANDOFF.md` only as each release
is verified.

The temporary-submodule changeset completed its local ten-pass, final post-build
child/Back, and fresh-bundle duplicate Open/Back race inspections, including
read-only mutation boundaries and owned headless-resource cleanup. Initial
remote CI caught a macOS error-ordering defect without publishing; correction
`98d93ccc` passed its full remote CI gate and published
`v3.6.3-beta3-b0000000165`. Exact publication receipts are in `HANDOFF.md`.

The [Guided Feature Gallery](Feature-Gallery) is the canonical 66-function visual index: every
catalogued function or state owns one distinct screenshot rather than borrowing an overview image.

- [The shell](#the-shell)
- [Install on Windows](#install-on-windows)
- [Material first run](#material-first-run)
- [Signing in](#signing-in)
- [Local Ollama model management](#local-ollama-model-management)
- [Repository tabs](#repository-tabs)
- [Appearance customization](#appearance-customization)
- [Settings history](#settings-history)
- [Non-modal dialogs](#non-modal-dialogs)
- [Multi-clone](#multi-clone)
- [Advanced Git and collaboration workflows](#advanced-git-and-collaboration-workflows)
- [Guided Git and GitHub functions](#guided-git-and-github-functions)
- [GitHub API Explorer](#github-api-explorer)
- [One-click commit & push](#one-click-commit--push)
- [Notification centre](#notification-centre)
- [GitHub Actions panel](#github-actions-panel)
- [Repository Releases](#repository-releases)
- [UI scaling](#ui-scaling)
- [Automation and merge-all](#automation-and-merge-all)
- [History search and graph](#history-search-and-graph)
- [Multiple stashes](#multiple-stashes)
- [Repository power tools](#repository-power-tools)
- [Multi-window workflows](#multi-window-workflows)
- [Agent access and CLI](#agent-access-and-cli)

---

## Advanced Git and collaboration workflows

M21 adds progressively disclosed controls around the familiar Desktop flow:

- Use the repository sheet to search, filter by account/provider/status, pin or
  hide repositories, and run Pull/Fetch All only after reviewing the exact
  selected subset. History can switch between the current branch and all refs
  to reveal commits that exist only on remote branches or tags.
- Open a pull request workspace to inspect its summary, checks, changed-file
  tree, and expanded diff context; comment and reply, resolve conversations,
  submit an approval or change request, and update supported metadata. The
  creation composer discovers bounded repository templates and optional
  metadata before an immutable final review. Fork checkout separately reviews
  the exact source repository, branch, and commit before fetching.
- Open Stash Manager to create a named stash from selected files or manage any
  stash visible to Git, including entries made outside the app. Repository
  Tools exposes tag creation, fetch, push, move, signing, pruning, and deletion;
  destructive tag and bulk-branch actions identify the exact refs first and
  retain recovery information.
- In Changes, switch the file list to a directory tree, choose persisted diff
  context, compare CSV/TSV rows and cells, and preview TGA images. Editor actions
  understand the expanded editor catalog plus WSL paths. Settings and Repository
  Tools expose global-ignore editing, allowlisted custom Git presets, reviewed
  patch import/export, and network/WSL path diagnostics.
- Open GitHub Projects from Repository Tools for the current account-bound
  repository. A successful bounded load refreshes the local cache; while
  offline, the workspace labels and shows only the last-known-good snapshot.

The complete [30-item feature ledger](https://github.com/codingmachineedge/desktop-material/blob/main/docs/features/github-desktop-demand-backlog.md)
links to behavior, recovery, security, and test details for every workflow.

![Advanced tag lifecycle workspace with local, pushed, and remote-only tags](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/advanced-workflows.png)

---

## Install on Windows

Desktop Material's automated releases currently provide an x64 per-user
installer. Open Windows PowerShell 5.1 or PowerShell 7 as your normal user and
run:

```powershell
Microsoft.PowerShell.Utility\Invoke-RestMethod 'https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/script/install-windows.ps1' | Microsoft.PowerShell.Utility\Invoke-Expression
```

The command loads the
[tracked installer script](https://github.com/codingmachineedge/desktop-material/blob/main/script/install-windows.ps1)
from this repository. The script then:

1. queries `codingmachineedge/desktop-material` for its newest non-draft,
   non-prerelease GitHub release;
2. requires exactly one installer matching the native Windows architecture and
   validates that its HTTPS URL belongs to this repository;
3. checks the reported byte count and GitHub SHA-256 release-asset digest, then
   requires any Authenticode signature to be valid;
4. runs the per-user Squirrel installer silently with `/S`; and
5. removes the installer from its unique, bounded temporary directory.

The current automated workflow publishes unsigned x64 installers. The script
warns about the missing signature after verifying the GitHub digest, and it
stops rather than selecting a different package on ARM64 or 32-bit Windows. To
inspect or download the asset yourself, use the
[latest release page](https://github.com/codingmachineedge/desktop-material/releases/latest).

## Creating a GitHub release

Open **Repository → Release Manager** and select **New release**. Enter the tag,
target, name, and notes. **Publish immediately** is enabled by default; leave it
enabled, select **Review changes**, verify that Publication says **Publish
immediately**, and select **Publish release**. Desktop Material sends one direct
public-release request rather than creating a draft first. Turn **Publish
immediately** off only when you intentionally want an unpublished draft.
Review the tracked script before running any remote command.

---

## The shell

Desktop Material rebuilds the GitHub Desktop shell around Material Design 3. The chrome you work in
every day is made of a few pieces:

- **A left icon navigation rail** with entries for **Changes** (with a count badge), **History**,
  **Branches**, **Settings**, and your **account avatar** at the bottom.
- **A floating pill toolbar** across the top carrying repository, worktree, branch, and sync
  controls. When the measured width gets tight, **Build & Run** moves into the keyboard-accessible
  **More toolbar actions** surface first, then **Commit & Push** follows. Widening the window
  restores each action automatically before its label can clip. For GitHub-backed repositories,
  the branch control also shows a small colour-coded CI logo for the current commit; hover it for
  the result, such as **CI checks: successful**.
- **Browser-like repository tabs** (see [Repository tabs](#repository-tabs)) above the workspace.
- **Floating, radius-24 workspace cards** for Changes, the diff, History, and the empty/welcome
  states, with tri-state selection checkboxes, tonal status chips, token-based diff colors, and an
  inverse-surface undo banner.

The whole shell has an **animated light/dark theme**. Everything below tells you how to drive it.
While an app update downloads, a thin indeterminate progress bar appears at the
top of the workspace. Choose **Settings → Appearance → Update progress color**
to inherit the accent or select blue, violet, teal, green, amber, or rose.
These update controls, the current-commit CI status tooltip, and the temporary
submodule-navigation copy use the explicit language mode saved under
**Language**: English, playful Hong Kong Cantonese, or a compact
bilingual presentation. English is the fallback; the operating-system locale
does not silently replace the saved choice.

![Desktop Material workspace with a profile-customized app identity and favorite repository tab](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-app-identity-workspace.png)

![Narrow toolbar with Build and Run and Commit and Push available from More without clipping](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-toolbar-overflow.png)

---

## Material first run

The welcome page is a Material task surface rather than a separate stock onboarding skin. It keeps
the **Sign in with GitHub.com**, **GitHub Enterprise**, and **Continue without signing in** routes in
one focused card, preserves keyboard focus and sign-in progress, and explains that repositories stay
local to the device. A tonal preview introduces the repository-focused workspace; at compact window
sizes the preview steps away so the setup task remains unclipped.

![Material first-run welcome with a focused setup card and tonal workspace preview](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-welcome.png)

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

Open the repositories side sheet to narrow cloned repositories by **Repository account** and
**Repository service**. The filters combine: for example, choose one exact account and GitLab, or
choose **No available account** and **Local only**. Signed-out/stale bindings remain explicit under
**Unknown or signed out**; the app does not guess a provider from a hostname.

GitHub browser sign-in requests only the feature scopes used by Desktop Material: repository/user
access, workflow-file updates, notifications, and read-only organization membership. It does not
request unrelated repository deletion, administrative key, package, codespace, audit, or gist
scope families.

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

### Assign an account to a repository

Repository-bound provider features use **Repository settings → Repository account** as their one
source of truth. If Provider Triage opens while the repository is unassigned, Desktop Material
automatically uses the account only when exactly one signed-in identity matches the provider and
endpoint. With multiple matches, choose a labelled account and select **Use this account**; this
prevents cross-account API calls. With no match, use **Sign in** or **Manage accounts**.

If the saved account has been signed out, lost permission, or needs organization SSO, the tool asks
you to re-authenticate or authorize SSO instead of claiming the repository is unassigned. Changing
the account in Repository Settings propagates to Provider Triage immediately; an existing valid
explicit binding is never silently replaced.

---

## Local Ollama model management

Open **Settings → Copilot → Providers**, choose **Add provider…**, select
**Ollama (local)**, and save the preset. Its default URL is
`http://127.0.0.1:11434/v1`; Ollama runs locally without an API key. Choose
**Manage models** on the saved provider to open the lifecycle workspace.

The manager keeps service discovery, inventory, and mutations explicit:

1. Check the endpoint health and Ollama version. Installed and running models
   load independently, so a partial response does not erase usable data.
2. Search all installed models or filter to running models. Select one to
   inspect bounded size, digest, family, format, parameter, quantization,
   capability, license, and runtime details when Ollama reports them.
3. Pull a model by name and follow streamed progress; cancel only that pull if
   needed. Copy a model, or rename it through copy-then-delete with a visible
   partial result if the original cannot be removed.
4. Load or unload the selected model. Delete requires inline confirmation that
   names the exact model and warns that the action cannot be undone.

After an inventory-changing operation, Desktop Material synchronizes the
installed Ollama names back to that provider's selectable Copilot models. The
installed inventory is authoritative, while settings for still-matching model
identifiers are retained. A successful Ollama request followed by a failed
provider-settings update is reported as a split outcome rather than a complete
success.

Only HTTP or HTTPS loopback endpoints (`localhost`, `127.0.0.1`, or `[::1]`)
are accepted. The saved provider path must be exactly `/v1`; the manager derives
that loopback origin and appends only fixed native `/api/*` routes. Every remote
host, arbitrary prefix, saved `/api` base, embedded credential, query string,
and URL fragment is rejected. Stale requests are aborted when the provider
changes, response text stays bounded, and credentials are never added to
management URLs or logs.

Every label, validation message, progress announcement, confirmation, and
accessible name follows the selected **English**, playful **Hong Kong
Cantonese**, or **English / 香港粵語** mode. The manager is keyboard reachable
and reflows for compact Preferences windows.

The accepted 1452×1001 off-screen scene exercised health, inventory, search,
running-state filtering, pull cancellation and rollback, completed pull, copy,
rename, load, unload, confirmed deletion, and provider synchronization. It uses
synthetic fixture data, passes privacy inspection, and has no overlapping or
horizontally overflowing manager controls.

![Ollama model manager with endpoint health, installed and running inventory, details, and lifecycle controls](https://raw.githubusercontent.com/Ding-Ding-Projects/desktop-material/main/docs/assets/screenshots/material-ollama-model-manager.png)

---

## Repository tabs

The workspace is **browser-like and tabbed**. Each tab is **bound to a repository and an account**,
so a tab always opens in the identity that owns it.

### Open a tab

- Click **+** on the tab strip to open a new tab, then pick a repository, **or**
- Middle-click / use the context menu on a repository in the list to open it in a new tab, **or**
- Drag one or more local repository folders onto the app. An existing repository switches instantly;
  a new valid repository is added and opened as a tab.

Tabs persist per account — reopening the app restores that account's tabs.

### Auto-detect repositories in a folder

Open **File → Add local repository…** and choose **Auto-detect repositories…**. Pick a parent
folder rather than one repository. Desktop Material performs a bounded scan that does not follow
symbolic links or junctions, skips generated/dependency folders, and stops descending when it finds
a repository. Review the relative paths in the result, then add all discovered repositories in one
step. You can still edit the path and use the normal single-repository flow at any time.

### Rename a tab

Double-click a tab's title (or use its context menu → **Rename**) to edit the label **inline**. The
rename is local to the tab and does not touch the repository name on disk or on the remote.

### Style a tab's title

Open a tab's context menu → **Text style** to open the styling popover. Per tab
you can set:

- **Weight** — bold on/off
- **Italic** and **underline**
- **Size**
- **Text color** — choose from the palette or use a custom color
- **Background color** — choose independently from the same palette or use a custom color
- **Font family**
- **Alignment**

The picker keeps a short recent-colors row for reuse. Styling is per tab, so you can give a
production repository a strong background while leaving a scratch repository muted and italic to
tell them apart at a glance.

> Tab layout and styling are part of your per-account settings, so every change **auto-commits** to
> that account's local settings repo. Open **Edit → Settings History…** or press `Ctrl+Alt+Z` if
> you ever need to inspect, undo, redo, or restore an earlier state.

![Word-style tab appearance editor with typography, alignment, and independent text and background palettes](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-tab-appearance-word.png)

### Close matching tabs safely

The tab-strip menu keeps both directions explicit:

- **Close Tabs Containing…** uses the existing regular-expression workflow to close matching tabs.
- **Close all tabs except those containing…** keeps tabs whose visible label, repository alias/name,
  or local path contains a case-insensitive literal query. Review the live kept, closed, and pinned
  counts plus the bounded preview before confirming. Empty input and a query with zero matches
  cannot confirm, so this action cannot accidentally become close-all.

Pinned tabs are protected in both bulk-close directions. Unpin one explicitly before including it
in a bulk close.

### Pin and arrange tabs

Use the star control or context menu to mark a tab as a **Favorite**, and use **Pin tab** when it
must remain in the leading group. Open
**Arrange tabs** to:

- drag a tab within its current pin group;
- use the named **Move left**, **Move right**, **Move first**, and **Move last** keyboard actions;
- apply one-shot **A to Z**, **Z to A**, **Newest opened**, **Oldest opened**,
  **Needs attention first**, **Clean first**, **Favorites first**, or **Favorites last** ordering.

Each sort is a one-time edit: later repository-status changes do not reshuffle the strip. The saved
order remains manually editable and restores with the account/window tab state. Pin or unpin a tab
explicitly before moving it across the group boundary.

Use the strip's **Search tabs** button to find and switch to an open repository by its visible name,
alias, local path, or clone URL. **Arrange tabs** has a separate **Filter tabs** field for narrowing
the manual-order rows; the one-shot sort buttons still apply to every open tab and say so explicitly.

![Arrange tabs surface with pinned and manual movement controls plus one-shot label, opened-date, and repository-status sorts](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-tab-arrange.png)

![Runtime repository-tab search matching an active repository by name and path](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-tab-search.png)

### Export or import the current tabs

Choose **File → Export current tabs…** to save a portable JSON description of the open tab order,
active tab, aliases, pins, favorites, and per-tab appearance. The file includes local repository
paths but never account tokens or credentials. Choose **File → Import current tabs…** to validate a
file, preview it, then replace the current tabs or merge with them; missing folders are skipped
without destructively clearing a usable current session.

---

## Appearance customization

### Ordinary preferences and visual owners

**Settings → Appearance** contains ordinary preferences only: explicit English, Hong Kong
Cantonese, or bilingual language mode; theme and scale; repository-list behavior; branch sorting;
formatting; and diff tab size. Visual customization belongs to the thing being changed.

Right-click an actual element—or focus it and press `Shift+F10`—to open its editor beside that
owner. Supported owners include the app identity/workspace, update progress bar, toolbar,
repository list, repository tab strip, code/diff surface, each reviewed Material feature entry
point, each repository name and logo, each tab title, and the temporary-submodule Back control.
Right-clicking a row or frame outside the specialized owner still opens its normal Git context
menu.

Each owner has one strict `setting.json` in its own local Git repository. The anchored editor shows
and copies that exact path and opens the owner's **History** manager. Undo, redo, and restore append
audit commits; they never reset or rewrite a successful timeline. Switching profiles switches the
profile, feature, repository-element, and tab-element repository roots and closes stale editors.

The app identity editor covers the code-native logo and in-app name, geometry, color, typography,
spacing, emphasis, and effects. It does not rename the signed executable or operating-system icon.

![Profile-customized app identity restored in the Material workspace](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-app-identity-workspace.png)

### Repository, logo, and tab owners

Repository Settings has no Appearance tab. Right-click the selected repository workspace,
toolbar, or tab-strip background for its repository-specific values and an **Edit profile default**
route. Right-click the actual repository-list name for Word-style typography or its actual logo for
the safe vector studio. A repository can inherit the profile owner; **Edit profile default** keeps
that profile editor anchored beside the same real logo.

A local `desktop-material.appearance-id` UUID identifies the working copy across path moves. Each
workspace, toolbar, tabs, list-name, and logo value still owns a separate local Git repository. The
old aggregate `desktop-material.appearance` payload is read only as a migration/startup compatibility
source, not as the mutable history.

The vector logo workbench provides:

- Start from the repository-mark, monogram, or repository-name preset and watch the live preview.
- Choose a rounded square, circle, square, or hexagon; use a solid or gradient fill; then tune
  colors, gradient angle, border, and shadow.
- Compose up to eight mark and text layers. Reorder or remove layers and edit their mark/text
  source, font, weight, letter spacing, color, position, scale, rotation, and opacity.
- Use **Undo** and **Redo** while experimenting. A repository override can return to **Inherit
  profile logo** without changing the profile design.
- **Export JSON…** for a portable design and bounded version-1 **Import JSON…**.

Logo JSON is capped at 16 KiB, text and layer counts are bounded, and every value is normalized to
the supported model. The studio never stores uploaded image bytes, HTML, or executable/raw SVG.
Tabs and repository-list rows render only the app's code-generated SVG projection. Right-click an
actual tab title for its own typography/color editor, dedicated repository, and history; structural
tab state remains separate.

![Layered custom repository-logo studio with a live preview and safe vector controls](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-repository-logo-studio.png)

![Appearance editor anchored beside its actual owner with History and a dedicated local Git path](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-customization.png)

---

## Settings history

Desktop Material records ordinary per-account preferences and structural tab state in the account
settings repository. Open **Edit → Settings History…** or press `Ctrl+Alt+Z` for that non-modal
timeline. Visual owners deliberately do not share it: use the **History** action in an anchored
appearance editor for that element's narrower Git repository.

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

Changing the account clears repository selections from the previous identity before loading the new
account's list. If a provider refresh fails, use **Try again** in the same view; a stale repository
cannot remain selected for cloning under the replacement account.

![Block-based regex builder with live repository-name testing](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/regex-builder.png)

On a compact or zoomed viewport, the builder stacks its category and building-block areas before
cards clip. Its body scrolls vertically while the live tester and footer actions remain reachable;
the dialog does not require page-level horizontal scrolling.

### Export / import repo lists

- **Export** writes the selected repositories to a list file containing **URLs only** — no tokens,
  no credentials.
- **Import** loads such a list back into the checkbox selection, so you can re-clone the same set on
  another machine or share a curated set with a teammate.

### Background auto-clone

In the GitHub clone view, select the account, base directory, and parallel or one-at-a-time mode,
then enable **Automatically clone new repositories**. Desktop Material records the current provider
list as a baseline; it does not immediately clone every existing repository. Repositories discovered
after that baseline are queued into the chosen directory in the background.

Discovery continues for the app lifetime after the Clone window closes. It refreshes periodically,
does not open a progress dialog on its own, and posts a notification when a background queue starts
or when refresh needs attention. The policy is account-specific and rejects invalid directories,
oversized provider lists, duplicate/unsafe URLs, and URLs containing embedded credentials.

### Pause, resume, and crash recovery

The batch progress surface can be hidden while cloning continues. Choose **Pause remaining** to stop
new queue items from starting; clones already running finish, and **Resume** safely continues the
pending work. **Cancel remaining** marks work that has not started as skipped, while **Retry failed**
starts only failed items again.

Queue transitions are durably journaled. If the renderer or app closes during a clone, the next
launch restores the queue in a paused state and labels formerly running rows **interrupted**. Resume
then inspects each destination before invoking Git again:

- an empty destination can be retried;
- a clean, non-bare worktree with a valid `HEAD` and the exact matching `origin` is accepted as the
  completed clone; and
- an occupied, incomplete, linked, bare, tracked-modified, or differently bound destination is left
  untouched and marked for review.

Recovery never deletes or moves destination contents. The bounded journal stores queue metadata and
stable account references, never provider tokens or credential-bearing clone URLs.

---

## Guided Git and GitHub functions

Desktop Material turns useful Git, GitHub CLI, and GitHub API capabilities into **named,
task-specific workflows**. You choose an action, complete a focused form, review any destructive
or worktree-changing step, and receive the result in the app. Expert API integration is kept in the
separate repository-contextual Explorer below; it does not turn the guided Git workflows into a raw
command console.

### GitHub API Explorer

Open **API** in the repository rail to work against the GitHub host and account explicitly bound to
the selected repository. The Explorer never falls back to another identity on the same host.

- Search the complete current catalog of **1,206 REST operations** by method, path, summary, or
  operation ID, narrow it by category, or choose the **New operations** scope to see exactly the
  **10 operations added since the prior pinned 2026-03-10 catalog**.
- Select a catalog result to populate its method and repository-aware path, or switch between the
  **REST** and **GraphQL** request builders for an explicit request.
- Read requests can run directly. REST write methods and GraphQL mutations first show a
  **Review GitHub API mutation** step with the exact account and request preview; they run only
  after **Run reviewed request** is confirmed.
- The response view exposes status and allowlisted diagnostic headers, bounds and truncates the
  displayed body, and recursively redacts credential-shaped values before rendering them.

#### Save API requests as app functions

The **App functions** panel turns a validated REST catalog request or named GraphQL operation into a
reusable extension of Desktop Material. Enter a lowercase function name and description, then choose
**Add current request as function**. Each saved function includes a generated argument schema and
can be run, edited from the current request, or removed in the same panel.

Functions follow the active profile and appear only for the exact repository, remote, GitHub host,
and account binding used when they were created. Read functions can run from the panel or through
the local Agent API as `github_api_<function-name>` tools. A write or destructive function must run
through the API tab's visible mutation-review flow; an agent cannot bypass that confirmation.
Credentials are neither accepted in a function template nor stored with one.

![Named repository-bound API app functions with reviewed execution](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-api-app-functions.png)

![Repository-contextual GitHub API Explorer with a searchable operation catalog, REST request builder, and bounded redacted response](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-github-api-explorer.png)

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

Repository Tools owns its vertical scroll region. At normal, minimum, short-height, and 150% zoom
layouts, scrolling reaches the exact final results surface without moving the whole document or
clipping controls below the viewport.

![Short Repository Tools workspace scrolled to its reachable final results surface](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-repository-tools-scroll.png)

### Sparse checkout

Open **Repository → Manage sparse checkout…** to keep selected directories in a large worktree.
The side panel reports whether sparse checkout is enabled and guides each change through
**Select → Review → Apply**:

1. **Select** one repository-relative directory root per line. Slashes are normalized, while
   absolute paths, traversal, option-like input, control characters, blanks, duplicates, and
   over-limit selections are rejected. State-aware guidance says whether the selection is empty,
   needs correction, or is ready for review.
2. **Review** the frozen normalized selection before Git changes the worktree. The bounded review
   shows every selected root. When cone mode is already enabled, it also reports added, removed,
   and unchanged selection entries; these counts describe directory-root entries rather than
   predicting individual local files.
3. **Apply** the reviewed operation and let Desktop Material refresh repository state. Cancellation
   remains available while Git is changing the worktree. Success, cancellation, or failure stays
   on the result phase until you edit the selection or request a manual refresh.

Choose **Review enable** only after the valid-directory count and exact normalized review match
your intent. Reapply and disable have their own review confirmations; disabling restores the full
tracked working tree without changing commits or history. The verified disabled state below leaves
all working-tree paths eligible to appear locally.

![Sparse-checkout directory editor in its disabled state](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-sparse-checkout.png)

These forms wrap labels and stack actions as space narrows. Page-level sideways scrolling is not
part of the workflow; only inherently spatial content such as code, diffs, and logs may scroll
horizontally when preserving columns is necessary.

### Rebase the current branch

![Commit checkpoints moving in order onto a newer main-line history](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/concepts/safe-rebase.png)

Open **Branch → Rebase current branch…**, then search for and select the target/base branch. The
review shows the current→target relationship, ahead/behind context, and a bounded preview of commits
that would be replayed.

Before Git starts, Desktop Material refreshes repository state and blocks unresolved conflicts,
dirty changes, and another ongoing operation. It also revalidates the exact current and target refs,
so a stale branch picker cannot launch a different rebase. You can cancel while that preflight is
running. If Git reports conflicts after start, resolve them through the existing continue/abort
flow. Protected branches receive explicit guidance, and the app never force-pushes automatically;
review any later force-with-lease decision separately.

![Reviewed current-branch rebase showing current to target, ahead and behind counts, and a bounded commit preview](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-rebase-review.png)

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

![A short-lived feature branch passing review and merging into the stable line](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/concepts/short-lived-branch.png)

For quick, low-ceremony commits, use **one-click commit & push**:

1. Stage the changes you want (or commit everything shown in **Changes**).
2. Press the **one-click commit & push** action.
3. **Copilot writes the commit message** from your staged diff.
4. Desktop Material commits and pushes in a single step.

This is a convenience path built on the normal commit machinery — you can always fall back to
writing the message yourself in the **Changes** view. For scheduled, unattended commits and pushes,
see [Automation](Automation).

When a selected file is larger than GitHub's ordinary 100 MiB object limit and release-backed
**cheap LFS** is available, every commit entry point prepares it before invoking Git. The commit
button reports **Preparing…**, upload progress, and final source verification; only the small-pointer
commit says **Committing … to _branch_**. New uploads skip compression: a file fitting the release-asset cap is
stored as one raw asset, while a larger file is split into ordered raw ranges. Downloads verify each
range and the complete file before replacing the pointer. Existing compressed cheap-LFS pointers
remain readable for backward compatibility.

---

## Notification centre

The **bell** in the app chrome opens the **notification centre** side panel. Its two named views
keep local app events separate from GitHub inbox items:

- **Local** is backed by its own git repo. An unread badge shows how many notifications you have not
  seen. Search titles and messages, filter by notification type, select every visible result, and
  apply **Mark read**, **Mark unread**, or **Delete selected** as one history-backed change. **Clear
  all** opens an inline confirmation and the notification history can restore the removed entries
  later.
- **GitHub** uses an explicit account selector with **All**, **Unread**, and **Participating only**
  controls. Refresh follows every available 50-item API page automatically, so older entries no
  longer stop at 50 or require **Load more**. Search the complete fetched titles, repositories,
  types, and reasons; select all visible matches; then mark them read or done in bulk. **Clear all**
  names the exact fetched count and requires confirmation before marking the complete selected
  GitHub inbox done with bounded concurrency. Any failed threads stay visible for retry. Changing
  account, source, filter, or search safely cancels stale work and resets the scoped selection. When
  no account is signed in, the complete **No signed-in accounts** state remains visible and tells
  you to sign in before refreshing the inbox.

The account, filters, and empty state are part of the guided inbox workflow rather than a `gh`
command or GitHub API search screen.

![Filtered Local notifications selected for bulk triage](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-notification-bulk-actions.png)

![GitHub notification view with the no-signed-in-account state](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-github-notifications.png)

### Error presentation

Acknowledgement-only failures appear as dismissible red notices in the bottom-right corner by
default, without blocking the task underneath. A notice can expose bounded diagnostic details when
they differ from the user-facing message. In **Settings → Notifications**, choose either
**Bottom-right notice** or **Blocking dialog** for these acknowledgement-only errors. Failures that
need a retry, authentication choice, external remediation, or another real decision remain dialogs
regardless of that preference.

When Git reports the affected repository's exact stale `.git/index.lock`, the notice includes
**Remove lock file**. Desktop first confirms that its own repository operations are idle, then
refuses recent, linked, non-file, or changed locks before atomically quarantining and removing the
verified stale file. Retry the original Git operation after the notice closes.

![Bottom-right Git lock error notice with Remove lock file recovery](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-error-notice.png)

---

## GitHub Actions panel

The **Actions** panel brings CI into the app:

- **Workflow runs** for the current repository, newest first. When more are available, choose
  **Load more runs**; already loaded pages remain visible across background polling and **Refresh**.
- **Filters** by **workflow**, **status**, **branch**, and **event**.
- **Re-run** a whole run or **re-run only the failed jobs**.
- For a run that is queued, running, waiting, or pending, choose **Cancel run**. The Material review
  names the workflow and run number plus its branch/ref, actor, and commit when GitHub supplied
  them. Desktop Material revalidates the selected repository/account/run and live cancellable state
  immediately before one normal cancel request, disables duplicate submission, and refreshes until
  GitHub reports cancelled or another terminal state. Authentication/SSO and stale/conflict errors
  keep specific recovery guidance visible; force-cancel is not the primary action.
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

![Material workflow-run cancellation review naming the exact run, ref, actor, and commit](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-cancel.png)

![Actions artifact with digest match and attestation-presence context](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-artifacts.png)

![Actions cache manager with usage totals, refs, wrapped keys, and delete controls](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-cache-manager.png)

![Headless Actions run pagination with the page-two sentinel retained](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-pagination-headless.png)

![Headless Actions artifact inventory with bounded pagination](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-artifacts-headless.png)

![Headless Actions sentinel evidence with wrapped content and no clipping](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-sentinel-headless.png)

![Actions workflow-run pagination with 51 filtered runs retained after Refresh](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-pagination.png)

![Actions artifact page two with a deliberately long wrapping sentinel name](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-artifact-page-two.png)

![Attempt-aware Actions job pagination with an exact recovered page-two job](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-jobs-pagination.png)

![Pending Actions deployment environments with long reviewer and protection details](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-actions-pending-deployments.png)

The historical M0–M19 production gates exercised 50→51 filtered runs, 30→31 artifacts, and current/historical 50→51
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

## Repository Releases

Open **Releases** from the repository rail to work with the selected GitHub repository without
losing its account context. The dashboard summarizes the releases currently loaded, including
stable, prerelease, and draft counts, combined asset/download totals, and the latest stable release.

- Search the loaded catalog with fuzzy, substring, or regular-expression matching, optionally
  case-sensitive, and combine it with the **Published**, **Pre-release**, or **Draft** status filter.
  The result count always says how many loaded releases are shown; **Load more releases** expands the
  catalog before filtering when GitHub reports another bounded page.
- Select a release to inspect its status, author, tag, target branch or commit, creation and publish
  times, notes, asset count, and total downloads. Open the exact provider release page when GitHub
  supplies a validated repository URL.
- Asset cards show file type, size, upload dates, download count, and digest when available. Existing
  guarded actions still create or edit drafts, publish or delete a reviewed release, upload or delete
  an asset, and download an asset through bounded transfer and integrity checks.
- Initial loading, asset loading, no-releases, no-filter-match, invalid-regex, and provider-error states
  remain distinct. A failed release or asset request names the failed operation and retries that same
  scope without discarding already loaded data.

![Releases dashboard with status summary, searchable catalog, selected metadata, and assets](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-github-releases.png)

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

The responsive toolbar gate measures the space its controls actually need. As the window narrows,
**Build & Run** enters **More toolbar actions** first and **Commit & Push** enters next; the
repository, worktree, branch, and sync controls remain available in the app bar. Opening More keeps
the moved actions keyboard reachable. After the surface closes and the window widens, Commit & Push
and then Build & Run return to their original positions, with no page-level horizontal overflow.

The Pages gallery also has a dedicated accessibility/clipping check at 960×660 and 390×844. It
passes with zero axe violations, matching document/body widths, and no horizontally outside
elements.

![Requested 200 percent UI scale auto-fitted to 96 percent at the minimum window size](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-scale-200-autofit.png)

![Responsive regression proof at 1450 by 997 with toolbar and Changes controls fully contained and no horizontal overflow](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-responsive-overflow-fixed.png)

![Measured narrow toolbar with its complete More actions surface](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-toolbar-overflow.png)

---

## Automation and merge-all

![Two conflicting file streams reconciled into one verified result](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/concepts/conflict-resolution.png)

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

Right-click a commit row for reset, checkout, reorder, revert, branch, tag, cherry-pick, copy, and
provider actions. The row's named **More actions** button, the Context Menu key, and `Shift+F10`
open the same action set. Invoking an unselected commit targets only that row; invoking a member of
the current multi-selection preserves the selection for eligible multi-commit actions.

![History search and commit graph](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-history-power-tools.png)

![History commit row with its named More actions control and hover hint](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-history-context-actions.png)

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
  lock/repair/remove/prune worktree operations from the Worktrees view. Remote names and URLs wrap
  only when genuinely long; before a field/control column becomes unreadable, each row changes to a
  single-column layout with fetch/push controls and actions in keyboard order.
- In the same **Remote** settings page, save a non-secret SSH working-copy definition and keep its
  password or key passphrase in the operating-system credential vault. Turn on **Deploy Docker
  Compose after pushes to this source remote** to deploy only after Desktop Material successfully
  pushes that named remote. The SSH checkout must already be on the pushed branch; the app fetches
  that exact branch, requires a fast-forward merge, and then runs
  `docker compose up --detach --build`. A mismatched branch or non-fast-forward update stops without
  a reset, force operation, or automatic checkout. **Deploy Docker now** runs the same bounded,
  output-redacted SSH recipe on demand.
- Open the wider **Repository settings → Submodules** surface and choose **Add submodule…** to browse GitHub.com,
  Enterprise, GitLab, or Bitbucket with the appropriate exact account, or enter an HTTPS, SSH, or
  local Git URL. Review the repository-relative checkout path and optional branch; Desktop rechecks
  duplicate/occupied destinations immediately before Git, reports bounded clone progress, and lets
  you cancel the running operation before refreshing the managed list. The same tab shows a Back
  preview: right-click it (or press `Shift+F10`) to open that element's appearance editor beside
  it. Changes remain staged with the rest of Repository Settings until **Save**. The adjacent
  **Subtrees** tab embeds the full add, pull, push, and split manager. The same managed list opens
  as the Submodule Manager from the Tools tab's **Nested repositories** category, and clone-list
  rows show a submodule badge whose details dialog can clone any submodule as its own repository.
  New to submodules? The beginner-friendly [Submodules](Submodules) page walks the whole workflow
  in plain words and pictures.
- On any initialized Submodule Manager row, choose **Open & manage** to use that checked-out
  child in the current workspace without importing it. It does not enter the repository list,
  Recent, or the persisted last selection. The context bar's Back control returns to the saved
  root repository; repeated Open or Back activation is coalesced, so it cannot create another tab
  or repository entry. Right-click the actual Back control to open the same anchored editor and
  save its profile-wide style or label immediately.
  Uninitialized, stale, invalid-Git, traversal, sibling-prefix, and symlink/junction escape targets
  fail without changing repository persistence, and the manager stays available for recovery.

- Use the `.gitignore` manager and one-click Build & Run for project-aware cleanup and execution. Build & Run discovers common nested projects across Node, Deno, Rust, Go, .NET, Python, JVM, PHP, Ruby, Swift, Dart/Flutter, Elixir, Scala, Haskell, Zig, Make, and CMake; choose a profile by its displayed project folder when several projects share a language or toolchain.
- Open **Repository tools** for the full set of named, reviewed Git functions. Diagnostics cover the
  status summary, repository health check, commit-signature audit, branch sync overview, contributor
  summary, nearest-tag version description, whitespace/conflict-marker audit, an ignored-files
  preview, and a commit-notes view. **Inspect and search** adds **Line authorship**, which shows the
  commit, author, and date behind every line of one picked tracked file; **Search tracked
  content**, a bounded literal-text search across tracked files with file and line references that
  can optionally be scoped to one branch, tag, HEAD, or commit ID — a matchless search completes
  cleanly rather than reporting an error; and **Edit commit notes**, which saves, replaces, or
  removes the free-form Git note on one commit only after a dedicated review step that shows the
  exact commit and note text. Maintenance covers the
  maintenance preview and run, a fully-merged-branch audit, unreachable-object prune preview, and a
  two-step untracked cleanup: **Preview untracked cleanup** lists exactly what would be deleted, and
  **Remove untracked files** deletes it only after its own destructive confirmation (tracked and
  ignored files are always preserved). Recovery covers the reflog view and an unreachable-commit
  finder for locating work lost to a deleted branch or reset. Every function runs a fixed, reviewed
  Git recipe — there is no shell and no editable command line; the only accepted inputs are a picked
  in-repository file and one bounded line of literal search text.

At compact heights, the Repository Tools workspace itself scrolls vertically so the Diagnostics
section, results, and later actions remain reachable without a horizontal page scrollbar.

SSH and non-authentication failures never start account fallback. The selected stable account key
stays in the app's internal trampoline map; its selector field is removed from the Git options
before spawn and never enters child, hook, Git LFS, or log environments. A missing same-origin
selection fails closed, while credential requests from cross-origin submodules retain normal
account resolution. Successful fallback uses the neutral result **Pull completed using another
signed-in account.**

![Pull all completing with another signed-in account without exposing its identity](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-pull-all-account-fallback.png)

![Named Repository Tools administration hub](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-repository-tools.png)

![Reviewed named-remote administration](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-remote-manager.png)

![Clone-style Add Submodule review with a synthetic URL, checkout path, and tracked branch](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/add-submodule-dialog.png)

![Initialized submodule opened temporarily with a context bar and Back control to the persisted root repository](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-submodule-context.png)

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
commit, fetch/pull/push, branch creation/merge, tab selection, automation status/runs, Actions
workflow dispatch, and the active profile's repository-bound named API read functions. It never
returns provider credentials. See [Agent API](Agent-API) for command and security details.

![Agent access connection and token controls](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-agent-access.png)

---

**Next:** [Automation](Automation) · [Submodules](Submodules) · [Regex Guide](Regex-Guide) · [Developer Guide](Developer-Guide)
