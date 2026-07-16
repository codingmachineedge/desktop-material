# Desktop Material roadmap

Updated: **July 15, 2026**

Desktop Material's feature roadmap is complete through **M19**. This file is
the compact public source of truth; implementation details and historical test
receipts stay in [`PLAN.md`](PLAN.md) and [`HANDOFF.md`](HANDOFF.md).

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
| **M13** | **Complete** | Repository metadata, pinning/grouping, Pull All recovery, remotes, and submodules. |
| **M14** | **Complete** | History metadata search, commit graph, SVG controls, guarded deletion, and branch presets. |
| **M15** | **Complete** | Repository-wide stash management and Desktop Material CLI branding. |
| **M16** | **Complete** | Tab-aware multi-window lifecycle and serialized shared-profile mutation. |
| **M17** | **Complete** | GitLab, Bitbucket, and self-hosted GitLab accounts, clone browsing, and provider routing. |
| **M18** | **Complete** | Material Design 3 shell, responsive layouts, keyboard focus, accessibility, and clipping coverage. |
| **M19** | **Complete** | Guided Git/GitHub/provider parity: PR lifecycle, Releases, Issues, rules, patch series, commit rewrite, signing, LFS, worktrees, remotes, hooks, bisect, and triage. |

No feature wave is marked unfinished. New work is maintenance: it must close a
specific issue, pass the acceptance gates below, and be documented before it is
described as shipped.

## Current maintenance acceptance

| Work | State | Required proof |
|---|---|---|
| Detailed Pull All progress | **In verification** | Live per-repository state, bounded concurrency, completion summary, keyboard/accessibility semantics, compact-window clipping review, screenshot, tests, and push to `main`. |
| Repository-wide feature revalidation | **In progress** | Registered-surface inventory, implementation/test/doc mapping, full tests, production build, headless UI exercise, CI, and Pages. |
| Documentation gallery expansion | **In progress** | Inspected privacy-safe captures referenced from README, wiki, Pages, and tutorial. |

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
