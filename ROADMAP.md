# Desktop Material roadmap

Updated: **July 18, 2026**

Desktop Material's feature roadmap is complete through **M19**, plus the
**M20 platform wave** below. This file is the compact public source of truth;
implementation details and historical test receipts stay in
[`PLAN.md`](PLAN.md) and [`HANDOFF.md`](HANDOFF.md).

## M20 — Platform wave (July 17–18, 2026) — **Complete**

- Secure LAN agent access with QR pairing, per-device vault tokens,
  revocation, and the Docker-hosted mobile console (timeouts aligned to the
  agent's 65-second command budget).
- SSH working-copy management with vault-only credential storage and opt-in,
  fast-forward-only Docker Compose deployment after matching app pushes, plus the
  verified one-line Windows installer on README, wiki, and Pages (with a
  copy button and celebration pulse).
- Submodules everywhere: clone-list badges with a pre-clone details dialog
  (clone any submodule as its own repository), the in-place Submodule
  Manager on the repo page with search and status chips, and
  worktree-from-commit on the History right-click menu.
- Material in-app context menus with per-action icons and type-to-filter,
  the Ctrl+F master command palette, Actions Runs/Workflows/Caches tabs
  with per-tab filter bars, clone visibility chips (public/private/forked),
  real account switching, and OAuth-scope re-authorization for Releases.
- Complete GitHub notification pagination with a confirmed, retryable Clear all,
  plus a repository Releases dashboard with status totals, search/filter modes,
  rich release and asset metadata, and operation-specific recovery states.
- Compact-window clipping fixes across dialogs and the tools hub, pointer
  hit-testing fixes in the clone surfaces, and a full 63-image gallery
  refresh captured from this build.

## Next up (queued)

- Per-repository Appearance revamp: standalone photo-editor-grade logo
  studio, full color chooser, and Word-grade typography — each element in
  its own Git-backed history store.
- Regex builder on **every** search/filter bar (including the Actions job
  log) with per-bar customizable appearance.
- Submodule config manager, per-submodule row decoration, a git subtree
  manager, and beginner-simple submodule documentation.
- Notification-triggered webhook/script automation builder (context-menu
  entry), release-backed large-file storage, an in-app log viewer with
  verbose mode and Git-backed log history, tools-catalog reorganization,
  and Easter eggs.

## Milestones

| Milestone | Status | Delivered scope |
|---|---|---|
| **M0** | **Complete** | CI, installers, Pages, wiki sources, README, and screenshot publishing. |
| **M1** | **Complete** | Per-account, Git-versioned settings profiles and recovery. |
| **M2** | **Complete** | Persistent browser-style repository tabs and tab styling. |
| **M3** | **Complete** | Settings history with diffs, undo, redo, and restore. |
| **M4** | **Complete** | Draggable, stackable non-modal dialogs and side sheets. |
| **M5** | **Complete** | Git-backed notification centre and notification history. |
| **M6** | **Complete** | Shared fuzzy/substring/regex search and regex builder. |
| **M7** | **Complete** | Multi-clone, URL-only transfer, Select all, automatic new-repository cloning, and exact-origin account recovery. |
| **M8** | **Complete** | 50–200% scaling, auto-fit, and organization-aware browsing. |
| **M9** | **Complete** | Commit/push and pull automation, Pull All, Merge All, and layered scheduling. |
| **M10** | **Complete** | GitHub Actions runs, jobs, logs, reruns, dispatch, artifacts, provenance, caches, and deployment review. |
| **M11** | **Complete** | Token-gated loopback MCP/REST agent access, stdio proxy, and CLI. |
| **M12** | **Complete** | Desktop Plus parity controls, telemetry defaults, identity, sorting, destructive actions, and accessibility labels. |
| **M13** | **Complete** | Repository metadata, pinning/grouping, Pull All recovery, remotes, and clone-style submodule management. |
| **M14** | **Complete** | History metadata search, commit graph, SVG controls, guarded deletion, and branch presets. |
| **M15** | **Complete** | Repository-wide stash management and Desktop Material CLI branding. |
| **M16** | **Complete** | Tab-aware multi-window lifecycle and serialized shared-profile mutation. |
| **M17** | **Complete** | GitLab, Bitbucket, and self-hosted GitLab accounts, clone browsing, and provider routing. |
| **M18** | **Complete** | Material Design 3 shell, responsive layouts, keyboard focus, accessibility, and clipping coverage. |
| **M19** | **Complete** | Guided Git/GitHub/provider parity: PR lifecycle, Releases, Issues, rules, patch series, commit rewrite, signing, LFS, worktrees, remotes, hooks, bisect, and triage. |

No feature wave or current maintenance item is unfinished. New work must close
a specific issue, pass the acceptance gates below, and be documented before it
is described as shipped.

## Current maintenance acceptance

| Work | State | Required proof |
|---|---|---|
| Profile, repository, and tab appearance customization | **Complete** | Verified all 13 active-profile defaults, including default-off Desktop Material feature highlighting with an explicit fork-only allowlist, profile local-Git history, all six repository-local overrides and inheritance, Word-style per-tab typography plus independent text/background palettes, restart persistence, light/dark/compact layouts, and inspected appearance evidence. |
| App identity and portable tab workspace | **Complete** | Verified profile-backed app logo/name typography and effects, favorites, folder-drop tab opening, current-tab session import/export, appropriate right-click customization/history context, unknown-key migration safety, restart persistence, 38 named identity controls, compact no-overflow geometry, and inspected headless evidence. |
| Measured app-bar overflow | **Complete** | Verified live label measurement, Icons only/compact footprints, Build & Run then Commit & Push overflow order, mounted-state and focus continuity, deterministic widening restore, and `material-toolbar-overflow.png`. |
| Material Welcome and landing page | **Complete** | Verified the first-run task card and compact fallback, the Material landing structure and keyboard path, and inspected `material-welcome.png`. |
| Guarded tab close and arrangement | **Complete** | Preserved the original regex **Close Tabs Containing…** action; verified case-insensitive literal inverse-close matching, counts/preview/zero-match protection, pinned-tab safety, drag and keyboard movement, pin-group boundaries, stable one-shot label/opened/status sorts, persisted order, focus, announcements, and multi-window isolation. |
| Actions workflow-run cancellation | **Complete** | Verified exact repository/account/run revalidation, cancellable-status gating, one normal cancel request with duplicate suppression, accepted-response polling, stale and terminal transitions, bounded provider errors, focus return, and compact confirmation layout. |
| Reviewed current-branch rebase | **Complete** | Verified target search, current→target and ahead/behind context, bounded commit preview, fresh dirty/conflict/operation guards, exact ref/SHA revalidation, cancel-before-start, conflict continue/abort routing, protected-branch guidance, and no automatic force push. |
| Provider account binding and OAuth scope alignment | **Complete** | Verified repository-settings binding propagation without reopening, unique-match auto-binding, explicit multiple-account choice, no-match/stale/permission/SSO recovery, generation safety, no silent replacement of a valid binding, and the bounded `repo user workflow notifications read:org` sign-in scope set. |
| Compact Repository Tools, Remote Manager, and Regex Builder | **Complete** | Verified vertical reachability at short heights; readable remote name/URL/control columns before a stacked fallback; reflowed Regex Builder categories/tokens with a scrollable body and reachable footer; named controls, focus, zoom, and no page-level horizontal overflow. |
| Detailed Pull All progress | **Complete** | Verified live per-repository state, bounded concurrency, completion summary, keyboard/accessibility semantics, compact-window containment, focused and full-suite coverage, the exact production build, and inspected off-screen evidence on `main`. |
| Clone-style Add Submodule | **Complete** | Verified hosted-provider and URL selection, exact-account affinity, reviewed relative path/branch, duplicate and occupied-path rejection, bounded progress, cancellation, list refresh, keyboard labels, and minimum-window containment. |
| Repository-wide feature revalidation | **Complete** | Verified the registered-surface and M0–M19 implementation inventory, focused and repository-wide tests, production builds/packages, isolated headless interaction, exact-SHA CI and installer runs, Pages, the seven-page wiki, and the 52-image documentation gallery. |
| Documentation gallery expansion | **Complete** | Current adaptive-customization, submodule, and app-identity captures are shared by README, wiki, Pages, and tutorial; the guided gallery now contains 53 images. |
| Complete notifications and Releases dashboard | **Complete** | Verified every GitHub notification page, confirmed local/remote Clear all with partial-failure retention, release status metrics and loaded-result search/filtering, rich asset metadata, scoped retries, responsive layout, and inspected headless evidence. |

## Acceptance gates

A roadmap or maintenance item is complete only when all applicable evidence is
present:

1. The implementation is reachable from a named UI, CLI, or agent workflow.
2. Focused tests cover success, failure, cancellation/stale state, and safety
   boundaries appropriate to the feature.
3. TypeScript, lint, formatting, repository-wide tests, and production build
   pass.
4. UI work passes desktop and compact-window keyboard, focus, screen-reader,
   scaling, overflow, and clipping checks.
5. Privacy-safe screenshots are inspected at original resolution and published
   in the relevant README, wiki, Pages, and tutorial surfaces.
6. The exact commit is pushed to `main`, remote CI/Pages are green, and any
   temporary branch/worktree is removed only after merge verification.

## Evidence index

- [`PLAN.md`](PLAN.md) — complete implementation ledger and architecture
  contracts.
- [`HANDOFF.md`](HANDOFF.md) — build, test, headless UI, screenshot, privacy,
  publication, and cleanup receipts.
- [Run manifests](.codex/run-manifests/) — exact milestone commands and capture
  records.
- [Feature gallery](docs/wiki/Feature-Gallery.md) — user-facing screenshot
  index.
