# User Guide

A task-oriented tour of Desktop Material's headline features. It assumes you already know the basic
GitHub Desktop workflow (clone, commit, push, branch, pull request) — that all still works. This
guide focuses on what Desktop Material adds on top.

- [Signing in](#signing-in)
- [Repository tabs](#repository-tabs)
- [Multi-clone](#multi-clone)
- [One-click commit & push](#one-click-commit--push)
- [Notification centre](#notification-centre)
- [GitHub Actions panel](#github-actions-panel)
- [UI scaling](#ui-scaling)

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
> that account's local settings repo. See [Automation](Automation) and the history manager in
> **Settings → History** if you ever need to undo, redo, or restore an earlier state.

---

## Multi-clone

The multi-clone window (see `07-clone.png`) clones **many repositories in one pass**.

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

The **bell** in the app chrome opens the **notification centre** side panel, which is backed by its
own local git repo.

- An **unread badge** on the bell shows how many notifications you haven't seen.
- **Mark read / unread** individually, or clear the badge in bulk.
- **Delete** notifications you no longer need.

Because the centre is backed by a git repo, its state is versioned along with the rest of your
per-account data.

---

## GitHub Actions panel

The **Actions** panel brings CI into the app:

- **Workflow runs** for the current repository, newest first.
- **Filters** by **status**, **branch**, and **event**, plus the standard search bar (chips + regex).
- **Re-run** a whole run or **re-run only the failed jobs**.
- Drill into a run to see its **jobs and steps**, and open the **in-app log viewer** to read output
  without leaving Desktop Material.
- Trigger manual workflows with the **`workflow_dispatch` dialog** — pick the workflow, ref, and
  inputs, and dispatch.

---

## UI scaling

Desktop Material scales its whole interface independently of the OS:

- Open the **scaling slider** and set anywhere from **50% to 200%**.
- Or choose **auto-fit to window**, which picks a scale that fits the current window size.

Combined with the animated light/dark theme, this lets you tune the workspace for a laptop panel, a
4K monitor, or a shared screen without touching system display settings.

---

**Next:** [Automation](Automation) · [Regex Guide](Regex-Guide) · [Developer Guide](Developer-Guide)
