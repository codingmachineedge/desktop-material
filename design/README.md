# Desktop Material — M3 Expressive prototype

An interactive, single-file design prototype of **Desktop Material** — GitHub Desktop's Git
workflow fully rewritten in **Material Design 3 Expressive**, with animation and transitions on
every element. Built directly on the codebase's own token architecture: every color in the
prototype is a \`--md-sys-*\` custom property lifted verbatim from
\`app/styles/_material.scss\` (light + dark), so the design maps 1:1 onto the implementation.

**Open \`Desktop Material v2.dc.html\`** in a browser. Everything is clickable.

## Features

**Core workspace**
- Changes view: filterable file list, tri-state include checkboxes, real per-file diffs, commit
  composer (summary/description, co-authors, length hint), undo-commit banner
- History view: commit list with avatars, tags, unpushed markers; commit detail with file list + diff
- Repositories & Branches side sheets; push/pull/fetch states with progress
- Animated light/dark theme (Appearance cards + app-bar toggle), springy staggered motion, ripples

**Feature-expansion plan coverage**
- **Browser-like tabs** — per-account tabs bound to repositories; rename inline (double-click);
  per-tab title styling: bold / italic / underline, size, color, font family, alignment
- **Multi-account** — account switcher on the rail avatar; per-account tabs, repos, and settings
- **Per-account settings git repo** — every tabs/settings change auto-commits (sha chip pulses);
  full **undo history manager** with undo / redo / restore-to-any-commit
- **Multi-clone** — dedicated Clone window with full repo details (description, language, size,
  stars, forks, visibility, default branch), org filter chips, checkboxes, parallel / one-by-one
  progress
- **Search upgrades everywhere** — every search bar has filter chips, a regex mode toggle, and a
  full **regex builder** (anchors, classes, quantifiers, groups, alternation, lookaround, all six
  flags, live tester) plus an in-dialog **How regex works** guide — see
  [docs/regex-guide.md](docs/regex-guide.md)
- **One-click commit & push** — Copilot writes the message; phase progress in the app bar
- **Automation settings** — auto commit & push and auto pull with intervals (Settings → Automation)
- **Merge-all** — merge every branch into development from the Branches sheet, Copilot conflict
  resolution, merged branches deleted, then push
- **GitHub Actions panel** — workflow runs with status/branch/event filters, re-run / re-run
  failed, job steps, in-app log viewer, and a workflow_dispatch dialog
- **Notification centre** — bell + side panel backed by its own local notifications repo;
  unread badge, mark read/unread, delete, mark-all
- **UI scaling** — 50–200% slider + auto-fit to window (Settings → Appearance)
- **Non-modal dialogs** — Settings, Clone, and the Regex builder float without blocking the app
  and drag by their headers
- **GitLab self-hosted sign-in** — endpoint + personal-access-token entry (Settings → Accounts)

## Screenshots

The original derived screenshots and editor thumbnail are intentionally omitted from this
publishable source bundle. They contained synthetic account fixture labels baked into the image
pixels; removing the derived images avoids publishing identity-like data. Open
\`Desktop Material v2.dc.html\` to render the sanitized interactive prototype and capture fresh
screenshots when needed.

## Token mapping

| Prototype | Codebase |
| --- | --- |
| \`--md-sys-color-*\` light/dark sets | \`app/styles/_material.scss\` (verbatim) |
| Spring/emphasized easings, motion durations | proposed \`--md-sys-motion-*\` additions (shown in the sample diff) |
| Shell surfaces, pill tabs, state layers | \`app/styles/_material-shell.scss\` |
| Type: Roboto / Roboto Mono | \`--font-family-sans-serif\` |
| Icons | Material Symbols Rounded |

## Notes

- This prototype was produced in a design environment with no access to your git remote. The
  source bundle is now tracked alongside the implementation milestones.
- Sample data (branches, commits, workflow runs, clone candidates) mirrors the real repository and
  its feature-expansion plan.
- Upstream: GitHub Desktop (MIT). Feature parity references: desktop-plus (MIT).
