# User Guide

A task-oriented tour of Desktop Material's features. It assumes you already know the basic GitHub
Desktop workflow (clone, commit, push, branch, pull request) — that all still works. This guide
focuses on what Desktop Material adds on top.

**Feature guide**

The complete M0–M19 roadmap is published on `main`. This guide also covers the current maintenance
release: adaptive appearance and profile app identity, favorite/portable tabs, Material entry surfaces, guarded tab management, workflow-run
cancellation, reviewed rebase, repository-account propagation, bounded OAuth scopes, and compact
surface corrections, plus the repository-contextual GitHub API Explorer. Exact build, off-screen UI, publication, and cleanup receipts are recorded in
the repository's `HANDOFF.md` only as each release is verified.
The [Guided Feature Gallery](Feature-Gallery) is the canonical 63-function visual index: every
catalogued function or state owns one distinct screenshot rather than borrowing an overview image.

- [The shell](#the-shell)
- [Material first run](#material-first-run)
- [Signing in](#signing-in)
- [Repository tabs](#repository-tabs)
- [Appearance customization](#appearance-customization)
- [Settings history](#settings-history)
- [Non-modal dialogs](#non-modal-dialogs)
- [Multi-clone](#multi-clone)
- [Guided Git and GitHub functions](#guided-git-and-github-functions)
- [GitHub API Explorer](#github-api-explorer)
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
- **A floating pill toolbar** across the top carrying repository, worktree, branch, and sync
  controls. When the measured width gets tight, **Build & Run** moves into the keyboard-accessible
  **More toolbar actions** surface first, then **Commit & Push** follows. Widening the window
  restores each action automatically before its label can clip.
- **Browser-like repository tabs** (see [Repository tabs](#repository-tabs)) above the workspace.
- **Floating, radius-24 workspace cards** for Changes, the diff, History, and the empty/welcome
  states, with tri-state selection checkboxes, tonal status chips, token-based diff colors, and an
  inverse-surface undo banner.

The whole shell has an **animated light/dark theme**. Everything below tells you how to drive it.

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

## Repository tabs

The workspace is **browser-like and tabbed**. Each tab is **bound to a repository and an account**,
so a tab always opens in the identity that owns it.

### Open a tab

- Click **+** on the tab strip to open a new tab, then pick a repository, **or**
- Middle-click / use the context menu on a repository in the list to open it in a new tab, **or**
- Drag one or more local repository folders onto the app. An existing repository switches instantly;
  a new valid repository is added and opened as a tab.

Tabs persist per account — reopening the app restores that account's tabs.

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

### App defaults in the active profile

Open **Settings → Appearance**. The callout at the top identifies these controls as app defaults
for the active profile. All 12 are saved through the profile's local Git-backed settings history:

1. **Accent color** — Blue, Violet, Teal, Green, Amber, or Rose.
2. **Surface color** — Tonal or Neutral.
3. **Surface depth** — Standard, Subtle, or Flat.
4. **Interface font** — Material (Roboto) or the system font.
5. **Code and diff font** — platform default, Consolas, or SF Mono.
6. **Animation** — follow the system setting or reduce motion.
7. **Toolbar labels** — Automatic, Prefer labels, or Icons only.
8. **Toolbar density** — Comfortable or Compact.
9. **Repository list density** — Comfortable or Compact.
10. **Tab density** — Comfortable or Compact.
11. **Tab width** — Compact, Standard, or Wide.
12. **Tab close buttons** — On hover, Always, or Active tab only.

The same page also owns the active profile's **default repository logo**. Repositories inherit this
editable vector design unless they save a local override, so switching profiles can change both the
workspace defaults and the repository identity shown in tabs and the repository list.

Changing profile switches these defaults with the rest of that account's settings. Open
**Edit → Settings History…** (`Ctrl+Alt+Z`) to inspect, undo, redo, or restore an appearance change
without rewriting the profile history.

### App identity in the active profile

At the top of **Settings → Appearance**, use the live **App identity** preview to customize the
in-app name and logo. Logo controls cover visibility, built-in/custom artwork, shape, size, inset,
rotation, gap, border, shadow, and colors. Name controls cover font, width, weight, case, size,
spacing, opacity, bold/italic/underline/strikethrough/small-caps, highlight, and text effects. Use
**Clear name formatting** for typography only or **Reset identity** for the entire identity.

The result follows the active profile, participates in Settings History, and restores after an app
restart. It does not rename the signed executable or operating-system icon. Right-click an
appropriate shell element to open its customization route and see the owning profile Git-history
path; repository surfaces instead identify that repository and can open its commit history.

![Profile-customized app identity restored in the Material workspace](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-app-identity-workspace.png)

### Repository-local overrides

Open **Repository settings → Appearance** when one project needs a different workspace. The page
groups the six optional workspace-chrome overrides — **accent color**, **surface color**, **toolbar
labels**, **toolbar density**, **tab density**, and **tab width** — and provides one action to
inherit every profile default again. Each field starts at **Use app default** and independently
inherits the active-profile value until changed.

These six values and an optional custom repository-logo document are stored under
`desktop-material.appearance` in the repository's local `.git/config`. They are not committed and
are not shared with collaborators. Interface/code fonts, surface depth, motion, repository-list
density, and tab close-button behavior intentionally remain profile defaults; individual tab
text/background styling remains in the profile's tab history.

### Advanced repository logo studio

The **Custom repository logo** studio appears in both **Settings → Appearance** (the profile
default) and **Repository settings → Appearance** (the selected repository's local override). It is
a full editable vector workbench rather than a group of logo dropdowns:

- Start from the repository-mark, monogram, or repository-name preset and watch the live preview.
- Choose a rounded square, circle, square, or hexagon; use a solid or gradient fill; then tune
  colors, gradient angle, border, and shadow.
- Compose up to eight mark and text layers. Reorder or remove layers and edit their mark/text
  source, font, weight, letter spacing, color, position, scale, rotation, and opacity.
- Use **Undo** and **Redo** while experimenting. A repository override can return to **Inherit
  profile logo** without changing the profile design.
- **Export JSON…** saves the portable design and **Import JSON…** validates a version 1 document
  before adding it to the current settings edit. Save the settings window to apply an import.

Logo JSON is capped at 16 KiB, text and layer counts are bounded, and every value is normalized to
the supported model. The studio never stores uploaded image bytes, HTML, or executable/raw SVG.
Tabs and repository-list rows render only the app's own code-generated SVG projection of that safe
model.

![Layered custom repository-logo studio with a live preview and safe vector controls](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-repository-logo-studio.png)

![Profile-backed Appearance preferences with repository override guidance](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-customization.png)

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
The side panel reports whether sparse checkout is enabled, explains cone mode, and accepts one
repository-relative directory per line. It normalizes slashes and rejects absolute paths,
traversal, option-like input, control characters, blanks, and duplicates before the review step.

Choose **Review enable** only after the valid-directory count matches your intent. The verified
disabled state below leaves all working-tree paths eligible to appear locally.

![Sparse-checkout directory editor in its disabled state](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-sparse-checkout.png)

These forms wrap labels and stack actions as space narrows. Page-level sideways scrolling is not
part of the workflow; only inherently spatial content such as code, diffs, and logs may scroll
horizontally when preserving columns is necessary.

### Rebase the current branch

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
  seen. Search titles and messages, filter by notification type, select every visible result, and
  apply **Mark read**, **Mark unread**, or **Delete selected** as one history-backed change. **Clear
  all** opens an inline confirmation and the notification history can restore the removed entries
  later.
- **GitHub** uses an explicit account selector with **All**, **Unread**, and **Participating only**
  controls. Search loaded titles, repositories, types, and reasons; select all visible matches;
  then mark them read or done in bulk. Changing account, source, filter, or search safely resets the
  scoped selection. When no account is signed in, the complete **No signed-in accounts** state
  remains visible and tells you to sign in before refreshing the inbox.

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

![Dismissible bottom-right acknowledgement-only error notice](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-error-notice.png)

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
- Open **Repository settings → Submodules** and choose **Add submodule…** to browse GitHub.com,
  Enterprise, GitLab, or Bitbucket with the appropriate exact account, or enter an HTTPS, SSH, or
  local Git URL. Review the repository-relative checkout path and optional branch; Desktop rechecks
  duplicate/occupied destinations immediately before Git, reports bounded clone progress, and lets
  you cancel the running operation before refreshing the managed list.
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

**Next:** [Automation](Automation) · [Regex Guide](Regex-Guide) · [Developer Guide](Developer-Guide)
