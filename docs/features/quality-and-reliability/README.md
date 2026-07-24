# Quality and reliability

This category documents cross-cutting responsiveness, lifecycle, and recovery
contracts that span more than one user workflow.

## Features

- [Responsiveness and resource
  lifecycle](responsiveness-and-resource-lifecycle.md) — avoid redundant remote
  discovery, hard-bound advisory process cleanup, coalesce stalled proxy work,
  serialize credential prompts, coalesce high-frequency appearance writes, and
  release request and markdown-preview resources deterministically.
- [Git operation auto-fix](git-operation-auto-fix.md) — a pure classifier that
  recognizes fixable Git failures (stale index.lock, auto-gc/maintenance hang,
  non-fast-forward push, forbidden org-remote push, detached-HEAD commit),
  proposes a safety-classed remediation, and surfaces a localized one-click
  "Fix it" action on the transient error notice without ever force-pushing.
- [Native large-repository
  handling](native-large-repository-handling.md) — per-repository large mode
  that extends gc/maintenance suppression to status/add/checkout/fetch plus a
  controlled repack, fail-closed stale-`index.lock` removal, an explicit
  status-computing state, suspended polling with one persistent notification for
  deleted repositories, and confirm-class nested-`.git` compression.

## API applicability

These contracts change local desktop scheduling and cleanup behavior. They add
no HTTP endpoint, so a Postman collection is not applicable.
